// WHAT THE HOME DASHLETS SHOW (v0.207.0) — one small PURE function per dashlet, each turning
// data a collector ALREADY holds into the handful of numbers a glance needs. Nothing here
// fetches; nothing here guesses: a number that cannot be stood behind comes back null and the
// dashlet says why (rule 3: a missing point beats a misleading one).

// ---- trading value (the net-worth collector's own series)
export interface WorthPoint { t: number; stock: number; transit: number; listed: number; escrow: number; wallets: number }
export const worthTotal = (p: WorthPoint): number => p.stock + p.transit + p.listed + p.escrow + p.wallets;
export interface WorthDigest {
  at: number; total: number;
  /** the change over the range; null when there is only one point to stand on */
  delta: number | null; deltaPct: number | null;
  /** the same change split in two: what the WALLETS did, and what the goods (stock, transit, sell
   * orders, escrow) did — a wallet transfer is not trading, and the dashlet must not read as if it were */
  deltaWallets: number | null; deltaGoods: number | null;
  /** the point the change is measured from, and whether the series really covers the range */
  baseAt: number | null; covers: boolean;
  spark: { t: number; v: number }[];
}
export const SPARK_MAX = 60;
export function worthDigest(series: readonly WorthPoint[], now: number, rangeDays: number): WorthDigest | null {
  if (series.length === 0) return null;
  const s = [...series].sort((a, b) => a.t - b.t);
  const last = s[s.length - 1];
  const from = now - rangeDays * 86_400_000;
  // the baseline: the last point AT OR BEFORE the start of the range; a younger series starts
  // at its own first point and says so (covers = false)
  let base: WorthPoint | null = null;
  for (const p of s) { if (p.t <= from) base = p; else break; }
  const covers = base !== null;
  if (!base) base = s[0];
  const inRange = s.filter((p) => p.t >= base!.t);
  const step = Math.max(1, Math.ceil(inRange.length / SPARK_MAX));
  const spark = inRange.filter((_, i) => i % step === 0 || i === inRange.length - 1).map((p) => ({ t: p.t, v: worthTotal(p) }));
  const total = worthTotal(last);
  const b = worthTotal(base);
  const one = base.t === last.t;
  const dw = last.wallets - base.wallets;
  return { at: last.t, total, delta: one ? null : total - b, deltaPct: one || b <= 0 ? null : (total - b) / b, deltaWallets: one ? null : dw, deltaGoods: one ? null : total - b - dw, baseAt: one ? null : base.t, covers, spark };
}

// ---- my orders (the app-wide order refresh)
export interface OrderLite { price: number; remain: number; bestOther: number | null }
export interface OrdersDigest { sells: number; buys: number; undercut: number; outbid: number; sellValue: number; buyValue: number }
export function ordersDigest(sellsByType: Record<number, readonly OrderLite[]>, buysByType: Record<number, readonly OrderLite[]>): OrdersDigest {
  const flat = (m: Record<number, readonly OrderLite[]>) => Object.values(m).flat();
  const sells = flat(sellsByType), buys = flat(buysByType);
  return {
    sells: sells.length, buys: buys.length,
    // a rival at MY station on MY side of the book with a better price
    undercut: sells.filter((o) => o.bestOther !== null && o.bestOther < o.price).length,
    outbid: buys.filter((o) => o.bestOther !== null && o.bestOther > o.price).length,
    sellValue: sells.reduce((t, o) => t + o.price * o.remain, 0),
    buyValue: buys.reduce((t, o) => t + o.price * o.remain, 0),
  };
}

// ---- planets (the PI collector's cached states)
export interface PlanetLite {
  characterName: string; planetName: string; systemName: string; problem: string; rank: number;
  fullFrac: number; fullAt: number | null; extractorExpiry: number | null; advice: string; value: number;
}
export interface PiDigest { total: number; attention: number; urgent: number; value: number; worst: PlanetLite[]; nextFullAt: number | null }
const URGENT = new Set(['storage-full', 'extractor-expired']);
export function piDigest(planets: readonly PlanetLite[], now: number, keep = 8): PiDigest {
  const sorted = [...planets].sort((a, b) => a.rank - b.rank || b.fullFrac - a.fullFrac);
  const future = planets.map((p) => p.fullAt).filter((t): t is number => t !== null && t > now);
  return {
    total: planets.length,
    attention: planets.filter((p) => p.problem !== 'ok').length,
    urgent: planets.filter((p) => URGENT.has(p.problem)).length,
    value: planets.reduce((t, p) => t + (p.value || 0), 0),
    worst: sorted.slice(0, keep),
    nextFullAt: future.length > 0 ? Math.min(...future) : null,
  };
}

// ---- raid windows (the raid watcher's own last snapshot of CCP's public feed)
export interface WindowLite { planetId: number; systemId: number; startMs: number; endMs: number }
export interface WindowRow extends WindowLite { systemName: string; regionName: string; jumps: number | null; open: boolean; inMs: number }
export const SOON_MS = 3_600_000;
export interface WindowsDigest { open: WindowRow[]; soon: WindowRow[]; listed: number; inReach: number; hasReach: boolean }
/** `place` names a system and gives its distance; null distance = outside the player's reach
 * (left out when a reach exists at all). Open windows closing soonest first, then the ones
 * opening within the hour, soonest first; ties go to the nearer. */
export function windowsDigest(
  list: readonly WindowLite[], now: number,
  place: (systemId: number) => { systemName: string; regionName: string; jumps: number | null },
  hasReach: boolean,
): WindowsDigest {
  const rows: WindowRow[] = [];
  for (const w of list) {
    if (w.endMs <= now) continue;
    const p = place(w.systemId);
    if (hasReach && p.jumps === null) continue;
    const open = w.startMs <= now;
    rows.push({ ...w, ...p, open, inMs: open ? w.endMs - now : w.startMs - now });
  }
  const near = (a: WindowRow, b: WindowRow) => a.inMs - b.inMs || (a.jumps ?? 99) - (b.jumps ?? 99);
  return {
    open: rows.filter((r) => r.open).sort(near),
    soon: rows.filter((r) => !r.open && r.inMs <= SOON_MS).sort(near),
    listed: list.filter((w) => w.endMs > now).length, inReach: rows.length, hasReach,
  };
}

// ---- robberies seen (the raid watcher's verdict log)
export interface RaidLite { t: number; systemId: number; planetId: number; kind: string; intoWindowMin?: number; windowMin?: number }
export interface RaidLogDigest { day: number; week: number; recent: RaidLite[]; watchedSince: number | null }
export function raidLogDigest(events: readonly RaidLite[], now: number, keep = 6): RaidLogDigest {
  const raided = events.filter((e) => e.kind === 'raided').sort((a, b) => b.t - a.t);
  return {
    day: raided.filter((e) => now - e.t <= 86_400_000).length,
    week: raided.filter((e) => now - e.t <= 7 * 86_400_000).length,
    recent: raided.slice(0, keep),
    watchedSince: events.length > 0 ? Math.min(...events.map((e) => e.t)) : null,
  };
}

// ---- where everyone is (the ship watcher's transition log)
export interface ShipLite { t: number; characterId: number; shipTypeId: number; shipName: string; systemId: number }
export interface PilotRow { characterId: number; name: string; last: ShipLite | null }
/** the LAST transition recorded per character — "last seen", never "is now": the watcher only
 * writes when hull or system changes, and only while the app runs */
export function pilotsDigest(records: readonly ShipLite[], chars: readonly { characterId: number; name: string }[]): PilotRow[] {
  const last = new Map<number, ShipLite>();
  for (const r of records) { const p = last.get(r.characterId); if (!p || r.t >= p.t) last.set(r.characterId, r); }
  return chars.map((c) => ({ characterId: c.characterId, name: c.name, last: last.get(c.characterId) ?? null }))
    .sort((a, b) => (b.last?.t ?? 0) - (a.last?.t ?? 0) || a.name.localeCompare(b.name));
}

// ---- EVE time
export const DOWNTIME_UTC_HOUR = 11;
export interface EveClock { hhmm: string; date: string; toDowntimeMs: number; inDowntimeWindow: boolean }
export function eveClock(now: number): EveClock {
  const d = new Date(now);
  const pad = (n: number) => String(n).padStart(2, '0');
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DOWNTIME_UTC_HOUR, 0, 0);
  const toDowntimeMs = (next > now ? next : next + 86_400_000) - now;
  return {
    hhmm: `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`,
    date: d.toISOString().slice(0, 10),
    toDowntimeMs,
    // the server is normally back within a quarter of an hour of 11:00
    inDowntimeWindow: d.getUTCHours() === DOWNTIME_UTC_HOUR && d.getUTCMinutes() < 15,
  };
}

// ---- shared wording
export function agoShort(ms: number): string {
  if (ms < 0) ms = 0;
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}
export function inShort(ms: number): string {
  if (ms <= 0) return 'now';
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} d ${h % 24} h`;
}
