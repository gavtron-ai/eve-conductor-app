// SHIP HISTORY — the authoritative answer to "what was I flying, and where,
// at any moment." The EVE game log never names your hull, but the app
// already reads /characters/{id}/ship/ + /location/ for the overlay; this
// collector PERSISTS those observations (only when they CHANGE) to an aux
// NDJSON, so the Live Combat timeline can draw a real ship band instead of
// guessing from weapons.
//
// HONEST LIMIT: it only knows what it recorded while the Conductor was
// running and the character logged in — spans before this collector ran,
// or while the app was closed, read "not recorded" rather than a guess.
import { getCurrentShip, getLocation } from './esiChar';
import { useAuth } from './auth';

export const SHIP_WATCH_INTERVAL_MS = 60_000;
const FILE = 'ship-history.ndjson';

export interface ShipRecord {
  t: number;
  characterId: number;
  shipTypeId: number;
  /** the pilot's custom ship name, when set (ESI ship_name) */
  shipName: string;
  systemId: number;
}

/** last observation per character, to log only transitions */
const last = new Map<number, string>();
let cache: ShipRecord[] | null = null;

async function load(): Promise<ShipRecord[]> {
  if (cache) return cache;
  cache = [];
  const bridge = window.appInfo?.stats;
  if (!bridge) return cache;
  try {
    const raw = await bridge.auxRead(FILE);
    if (raw) {
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue;
        try { cache.push(JSON.parse(line) as ShipRecord); } catch { /* skip corrupt line */ }
      }
    }
  } catch { /* no history yet */ }
  return cache;
}

/**
 * One watcher pass: for every logged-in character, record ship+system if it
 * changed since the last observation. Cheap (a couple of 5s-cached ESI
 * routes per character) and on the background lane. Never throws.
 */
export async function runShipWatchTick(): Promise<number> {
  const chars = useAuth.getState().characters.filter((c) => c.refreshToken);
  const bridge = window.appInfo?.stats;
  const now = Date.now();
  const fresh: ShipRecord[] = [];
  for (const c of chars) {
    try {
      const [ship, loc] = await Promise.all([
        getCurrentShip(c.characterId),
        getLocation(c.characterId).catch(() => ({ solar_system_id: 0 })),
      ]);
      const sig = `${ship.ship_type_id}|${ship.ship_name}|${loc.solar_system_id}`;
      if (last.get(c.characterId) === sig) continue; // unchanged — no record
      last.set(c.characterId, sig);
      fresh.push({
        t: now, characterId: c.characterId, shipTypeId: ship.ship_type_id,
        shipName: ship.ship_name ?? '', systemId: loc.solar_system_id,
      });
    } catch { /* offline / token gap — try again next tick */ }
  }
  if (fresh.length > 0) {
    (await load()).push(...fresh);
    if (bridge) {
      try { await bridge.auxAppend(FILE, fresh.map((r) => JSON.stringify(r))); } catch { /* in-memory still works */ }
    }
  }
  return fresh.length;
}

export interface ShipSegment {
  characterId: number;
  shipTypeId: number;
  shipName: string;
  systemId: number;
  t0: number;
  /** end of this hull's span — the next record's time, or Infinity (current) */
  t1: number;
}

/** the character's hull segments overlapping [from, to], each spanning from
 * its record until the next change. PURE given the loaded history. */
export async function shipSegments(charId: number, from: number, to: number): Promise<ShipSegment[]> {
  const recs = (await load())
    .filter((r) => r.characterId === charId)
    .sort((a, b) => a.t - b.t);
  const segs: ShipSegment[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const end = i + 1 < recs.length ? recs[i + 1].t : Infinity;
    if (end < from || r.t > to) continue; // outside the window
    segs.push({
      characterId: charId, shipTypeId: r.shipTypeId, shipName: r.shipName,
      systemId: r.systemId, t0: Math.max(r.t, from), t1: Math.min(end, to),
    });
  }
  return segs;
}

/** synchronous segment lookup from the in-memory cache (the collector keeps
 * it warm) — for render paths that cannot await */
export function shipSegmentsSync(charId: number, from: number, to: number): ShipSegment[] {
  if (!cache) return [];
  const recs = cache.filter((r) => r.characterId === charId).sort((a, b) => a.t - b.t);
  const segs: ShipSegment[] = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    const end = i + 1 < recs.length ? recs[i + 1].t : Infinity;
    if (end < from || r.t > to) continue;
    segs.push({
      characterId: charId, shipTypeId: r.shipTypeId, shipName: r.shipName,
      systemId: r.systemId, t0: Math.max(r.t, from), t1: Math.min(end, to),
    });
  }
  return segs;
}

/** force a re-read from disk into the cache — used on mount and to recover
 * if the first load happened before the stats bridge was ready (which would
 * otherwise freeze an empty cache for the session). */
export async function reloadShipHistory(): Promise<ShipRecord[]> {
  cache = null;
  return load();
}

/** prime the cache so the first render has data (called on mount) */
export const primeShipHistory = (): Promise<ShipRecord[]> => reloadShipHistory();
