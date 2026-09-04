// ROUTE GATECAMP INTEL — the deep-dive behind the Theft Conductor's route ⓘ.
//
// For the shortest gate route to a skyhook, this pulls each system's recent
// killmails (zKillboard, last hour, main-process — no CORS) and enriches a
// bounded sample from ESI so the popup can show, per system:
//   · how many PLAYER ships died there in the last hour
//   · WHERE (on which gate, via zkb.locationID → a "Stargate (X)" name, or in
//     space when it resolves to something else / nothing)
//   · whether a BUBBLE was almost certainly up (an interdictor or HIC was on
//     the kill — the only reliable killmail signal for a bubble)
//   · a clickable kill list so you can open any mail on zKillboard
//
// Everything is a live index + immutable killmails, so both are cached hard.
import { esiFetch } from './esiRate';
import { getType } from './typedb';

const ESI = 'https://esi.evetech.net/latest';

/** Interdictors (group 541) + Heavy Interdiction Cruisers (group 894). One of
 * these on a killmail means a bubble was up in all but pathological cases — it
 * is the only bubble signal a killmail actually carries. Anchored Mobile Warp
 * Disruptors leave no attacker trace, so a quiet anchored bubble can be missed;
 * the column is "bubble seen", never "no bubble". */
const BUBBLE_SHIP_IDS = new Set<number>([
  22456, 22464, 22452, 22460, // Sabre, Flycatcher, Heretic, Eris (interdictors)
  12013, 11995, 12017, 12021, // Broadsword, Onyx, Devoter, Phobos (HICs)
]);

export interface RouteKill {
  id: number;
  hash: string;
  value: number;
  time: string | null;
  victimShip: string;
  where: string; // 'Gate to X' | a celestial name | 'in space'
  onGate: boolean;
  bubble: boolean;
}

export interface RouteSystemKills {
  systemId: number;
  systemName: string;
  /** total PLAYER ship kills in the window (the full count, not the sample) */
  shipKills: number;
  /** epoch ms of the most recent sampled kill — drives the hot/cold rating */
  lastKillMs: number | null;
  /** a sampled kill had an interdictor/HIC on it */
  bubble: boolean;
  /** short summary of where the sampled kills happened */
  where: string;
  /** the sampled, enriched kills (clickable in the popup) */
  kills: RouteKill[];
}

const SAMPLE_PER_SYSTEM = 12; // enrich at most this many kills/system (bounded cost)

const kmCache = new Map<string, unknown>();
async function killmail(id: number, hash: string): Promise<Record<string, unknown> | null> {
  const key = `${id}/${hash}`;
  if (kmCache.has(key)) return kmCache.get(key) as Record<string, unknown> | null;
  try {
    const r = await esiFetch(`${ESI}/killmails/${id}/${hash}/`, { headers: { Accept: 'application/json' } }, { lane: 'background' });
    const j = r.ok ? await r.json() : null;
    kmCache.set(key, j);
    return j;
  } catch {
    return null;
  }
}

const nameCache = new Map<number, string>();
/** Resolve ids → names. /universe/names is ALL-OR-NOTHING (one unresolvable id,
 * e.g. a player structure, fails the whole batch — see battleNarrative), so on
 * a batch failure fall back to resolving each id alone and drop the bad ones. */
async function resolveNames(ids: number[]): Promise<void> {
  const need = [...new Set(ids.filter((x) => x > 0 && !nameCache.has(x)))];
  if (need.length === 0) return;
  const post = async (batch: number[]): Promise<void> => {
    const r = await esiFetch(`${ESI}/universe/names/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(batch),
    }, { lane: 'background' });
    if (!r.ok) throw new Error(String(r.status));
    const arr = (await r.json()) as { id: number; name: string }[];
    for (const n of arr) nameCache.set(n.id, n.name);
  };
  try {
    await post(need);
  } catch {
    for (const id of need) {
      try { await post([id]); } catch { nameCache.set(id, ''); }
    }
  }
}

export function whereFrom(locName: string): { where: string; onGate: boolean } {
  if (!locName) return { where: 'in space', onGate: false };
  const m = locName.match(/^Stargate \((.+)\)$/);
  if (m) return { where: `Gate to ${m[1]}`, onGate: true };
  return { where: locName, onGate: false };
}

/** true when this ship hull is an interdictor or HIC — the killmail bubble tell */
export function isBubbleShip(typeId: number): boolean {
  return BUBBLE_SHIP_IDS.has(typeId);
}

export function summarize(kills: RouteKill[]): string {
  if (kills.length === 0) return '';
  const counts = new Map<string, number>();
  for (const k of kills) counts.set(k.where, (counts.get(k.where) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([w, c]) => (c > 1 ? `${w} ×${c}` : w))
    .join(', ');
}

/**
 * Pull recent-kill intel for every system on a route (in order). Player kills
 * only (NPC kills are excluded — a rat isn't a gatecamp). Returns one row per
 * system, ready for the popup table. Empty rows (no kills) are kept so the
 * table shows the whole route.
 */
export async function fetchRouteKills(
  path: { id: number; name: string }[],
  windowSecs = 3600,
): Promise<RouteSystemKills[]> {
  const bridge = window.appInfo?.zkill?.systemKills;
  // 1. per-system live index over the chosen window, player kills only
  const feeds = await Promise.all(path.map(async (s) => {
    const raw = bridge ? await bridge(s.id, windowSecs).catch(() => []) : [];
    return { s, player: raw.filter((k) => !k.npc) };
  }));
  // 2. enrich a bounded sample per system with killmail detail
  const jobs = feeds.flatMap(({ s, player }) =>
    player.slice(0, SAMPLE_PER_SYSTEM).map((k) => ({ s, k })));
  const kms = await Promise.all(jobs.map((j) => killmail(j.k.killmail_id, j.k.hash)));
  // 3. resolve gate/celestial names (and victim ships typedb can't name)
  const ids: number[] = [];
  jobs.forEach((j, i) => {
    if (j.k.locationId) ids.push(j.k.locationId);
    const vId = (kms[i]?.victim as { ship_type_id?: number } | undefined)?.ship_type_id ?? 0;
    if (vId && !getType(vId)) ids.push(vId);
  });
  await resolveNames(ids);
  // 4. assemble per system
  const bySystem = new Map<number, RouteKill[]>();
  jobs.forEach((j, i) => {
    const km = kms[i];
    const victim = (km?.victim as { ship_type_id?: number } | undefined) ?? {};
    const vId = victim.ship_type_id ?? 0;
    const ship = vId ? (getType(vId)?.name ?? nameCache.get(vId) ?? `type ${vId}`) : '';
    const { where, onGate } = whereFrom(nameCache.get(j.k.locationId) ?? '');
    const attackers = (km?.attackers as { ship_type_id?: number }[] | undefined) ?? [];
    const bubble = attackers.some((a) => a.ship_type_id != null && BUBBLE_SHIP_IDS.has(a.ship_type_id));
    const list = bySystem.get(j.s.id) ?? bySystem.set(j.s.id, []).get(j.s.id)!;
    list.push({
      id: j.k.killmail_id, hash: j.k.hash, value: j.k.value,
      time: (km?.killmail_time as string | undefined) ?? null,
      victimShip: ship, where, onGate, bubble,
    });
  });
  return feeds.map(({ s, player }) => {
    const kills = bySystem.get(s.id) ?? [];
    const times = kills.map((k) => (k.time ? Date.parse(k.time) : NaN)).filter((n) => !Number.isNaN(n));
    return {
      systemId: s.id, systemName: s.name,
      shipKills: player.length,
      lastKillMs: times.length ? Math.max(...times) : null,
      bubble: kills.some((k) => k.bubble),
      where: summarize(kills),
      kills,
    };
  });
}
