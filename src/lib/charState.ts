// CHARACTER STATE — where each pilot is, what they fly, whether they are logged in: ONE reader,
// shared by the overlay, the ship watcher and the mining watch (v0.221.0, audit item A1).
//
// WHAT IT REPLACES. The overlay asked ESI for every character's ship AND location on every
// 6-second tick, logged in or not, overlay window open or not — 12 characters ≈ 345,000 requests
// a day per user — and the ship watcher asked for the same two things again every minute on its
// own (≈ 35,000 more). Nobody had counted. The rules now:
//   · ask /online/ first (cached 55 s while someone is watching, 5 min when nobody is) and ask a
//     pilot who is OFFLINE for nothing else — their last known ship and system stand;
//   · a pilot who is online is read every tick only while it matters — the overlay window is
//     open, or the mining watch needs to know who docked or moved; otherwise once a minute;
//   · every answer is cached to ESI's own `expires` (never shorter than asked), and the caches
//     are shared, so the ship watcher's read is free when the overlay just made it;
//   · a failed refresh keeps the last answer for one more poll, exactly as before.
// The fetchers are injectable so the fixture suite can count what is asked; the real ones load
// esiChar lazily, so this module (and its fixtures) never drag the browser-only auth store in.

export interface ShipInfo { ship_type_id: number; ship_item_id?: number; ship_name: string }
export interface LocInfo { solar_system_id: number; station_id?: number; structure_id?: number }
type Answer<T> = Promise<{ data: T; expiresIn: number | null }>;
export interface Fetchers {
  online(id: number): Answer<{ online: boolean }>;
  ship(id: number): Answer<ShipInfo>;
  location(id: number): Answer<LocInfo>;
}
const OVERLAY = { lane: 'overlay' as const };
export const DEFAULT_FETCHERS: Fetchers = {
  online: async (id) => (await import('./esiChar')).esiAuth<{ online: boolean }>(`/characters/${id}/online/`, undefined, id, OVERLAY),
  ship: async (id) => (await import('./esiChar')).esiAuth<ShipInfo>(`/characters/${id}/ship/`, undefined, id, OVERLAY),
  location: async (id) => (await import('./esiChar')).esiAuth<LocInfo>(`/characters/${id}/location/`, undefined, id, OVERLAY),
};

/** how long an answer is trusted, in seconds — the floor; ESI's own `expires` can lengthen it */
export const ONLINE_TTL_S = 55;
export const ONLINE_IDLE_TTL_S = 300;
export const ATTENTIVE_TTL_S = 5;
export const IDLE_TTL_S = 60;

interface Entry<T> { data: T; until: number }
const onlineCache = new Map<number, Entry<boolean>>();
const shipCache = new Map<number, Entry<ShipInfo>>();
const locCache = new Map<number, Entry<LocInfo>>();
/** what was actually asked of ESI — the number the audit wanted */
export const charStateCounts = { online: 0, ship: 0, location: 0, skippedOffline: 0 };

async function cached<T>(cache: Map<number, Entry<T>>, id: number, ttlS: number, fetcher: () => Answer<T>, now: number, count: () => void): Promise<{ data: T; fresh: boolean } | null> {
  const hit = cache.get(id);
  if (hit && now < hit.until) return { data: hit.data, fresh: false };
  try {
    count();
    const r = await fetcher();
    const ttl = Math.max(ttlS, r.expiresIn ?? 0);
    cache.set(id, { data: r.data, until: now + ttl * 1000 });
    return { data: r.data, fresh: true };
  } catch {
    return hit ? { data: hit.data, fresh: false } : null;
  }
}

export interface CharState {
  /** null = never answered */
  online: boolean | null;
  ship: ShipInfo | null;
  loc: LocInfo | null;
  /** which of the three were asked of ESI on this call */
  asked: { online: boolean; ship: boolean; loc: boolean };
}

/**
 * One pilot's state. `attentive` = someone needs it live (the overlay window is open, or the
 * mining watch is on): ship and location are then trusted for 5 s, otherwise for a minute; the
 * online flag for 55 s, otherwise five minutes. An OFFLINE pilot costs nothing but the flag.
 */
export async function readCharState(id: number, attentive: boolean, fx: Fetchers = DEFAULT_FETCHERS, now = Date.now()): Promise<CharState> {
  const asked = { online: false, ship: false, loc: false };
  const on = await cached(onlineCache, id, attentive ? ONLINE_TTL_S : ONLINE_IDLE_TTL_S, async () => { const r = await fx.online(id); return { data: r.data.online, expiresIn: r.expiresIn }; }, now, () => { asked.online = true; charStateCounts.online++; });
  const online = on ? on.data : null;
  if (online === false) {
    charStateCounts.skippedOffline++;
    return { online, ship: shipCache.get(id)?.data ?? null, loc: locCache.get(id)?.data ?? null, asked };
  }
  const ttl = attentive ? ATTENTIVE_TTL_S : IDLE_TTL_S;
  const [ship, loc] = await Promise.all([
    cached(shipCache, id, ttl, () => fx.ship(id), now, () => { asked.ship = true; charStateCounts.ship++; }),
    cached(locCache, id, ttl, () => fx.location(id), now, () => { asked.loc = true; charStateCounts.location++; }),
  ]);
  return { online, ship: ship?.data ?? null, loc: loc?.data ?? null, asked };
}

/** the last known state without asking anyone (the ship watcher between reads, the rig) */
export function lastKnown(id: number): { online: boolean | null; ship: ShipInfo | null; loc: LocInfo | null } {
  return { online: onlineCache.get(id)?.data ?? null, ship: shipCache.get(id)?.data ?? null, loc: locCache.get(id)?.data ?? null };
}

/** for the fixture suite */
export function _resetCharState(): void {
  onlineCache.clear(); shipCache.clear(); locCache.clear();
  charStateCounts.online = 0; charStateCounts.ship = 0; charStateCounts.location = 0; charStateCounts.skippedOffline = 0;
}
