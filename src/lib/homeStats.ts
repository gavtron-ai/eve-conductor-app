// MORE OF WHAT THE HOME DASHLETS SHOW (v0.209.0) — the second shelf-load of PURE digests. Same
// contract as homeDigests.ts: nothing fetches, nothing guesses; each turns data the app already
// holds into a glance, and a figure that cannot be stood behind comes back null.
import type { WorthPoint } from './homeDigests';
import { minOf, maxOf } from './nums';

const DAY = 86_400_000;

// ---- where the ISK sits (the latest trading-value snapshot's layers)
export const LAYERS: { key: keyof Omit<WorthPoint, 't'>; label: string; color: string }[] = [
  { key: 'stock', label: 'hangar stock', color: '#3987e5' }, { key: 'transit', label: 'in transit', color: '#7fc8ff' },
  { key: 'listed', label: 'sell orders', color: '#8dc169' }, { key: 'escrow', label: 'buy escrow', color: '#e0a13a' }, { key: 'wallets', label: 'wallets', color: '#9085e9' },
];
export interface LayerRow { key: string; label: string; color: string; value: number; frac: number }
export function layersDigest(series: readonly WorthPoint[]): { at: number; total: number; rows: LayerRow[] } | null {
  if (series.length === 0) return null;
  const last = series.reduce((a, b) => (b.t > a.t ? b : a));
  const total = LAYERS.reduce((t, l) => t + last[l.key], 0);
  return { at: last.t, total, rows: LAYERS.map((l) => ({ ...l, value: last[l.key], frac: total > 0 ? last[l.key] / total : 0 })) };
}

// ---- what sold (the ledger's own FIFO sales)
export interface SaleLite { date: number; typeId: number; qty: number; revenue: number; profit: number | null; costBasis: number | null }
export interface SellerRow { typeId: number; qty: number; revenue: number; profit: number; sales: number }
/** items by realized profit; a sale with no cost basis adds revenue and no profit (never guessed) */
export function bestSellers(sales: readonly SaleLite[], keep = 8): { rows: SellerRow[]; worst: SellerRow | null; items: number } {
  const acc = new Map<number, SellerRow>();
  for (const s of sales) {
    let r = acc.get(s.typeId);
    if (!r) { r = { typeId: s.typeId, qty: 0, revenue: 0, profit: 0, sales: 0 }; acc.set(s.typeId, r); }
    r.qty += s.qty; r.revenue += s.revenue; r.profit += s.profit ?? 0; r.sales++;
  }
  const rows = [...acc.values()].sort((a, b) => b.profit - a.profit || b.revenue - a.revenue || a.typeId - b.typeId);
  const last = rows[rows.length - 1];
  return { rows: rows.slice(0, keep), worst: last && last.profit < 0 ? last : null, items: rows.length };
}
export interface DayBar { day: string; profit: number; revenue: number; sales: number }
/** one bar per EVE (UTC) day, the last `days` of them, empty days included, oldest first */
export function profitByDay(sales: readonly SaleLite[], now: number, days: number): { bars: DayBar[]; profit: number; revenue: number; best: DayBar | null } {
  const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
  const bars: DayBar[] = [];
  for (let i = days - 1; i >= 0; i--) bars.push({ day: dayOf(now - i * DAY), profit: 0, revenue: 0, sales: 0 });
  const byDay = new Map(bars.map((b) => [b.day, b]));
  for (const s of sales) { const b = byDay.get(dayOf(s.date)); if (b) { b.profit += s.profit ?? 0; b.revenue += s.revenue; b.sales++; } }
  const busy = bars.filter((b) => b.sales > 0);
  return { bars, profit: bars.reduce((t, b) => t + b.profit, 0), revenue: bars.reduce((t, b) => t + b.revenue, 0), best: busy.length > 0 ? busy.reduce((a, b) => (b.profit > a.profit ? b : a)) : null };
}

// ---- unsold stock the ledger still carries at cost
export interface LotLite { typeId: number; qty: number; unitCost: number; date: number }
export interface InventoryDigest { atCost: number; lots: number; items: number; oldestAt: number | null; top: { typeId: number; qty: number; cost: number; oldestAt: number }[] }
export function inventoryDigest(lots: readonly LotLite[], keep = 6): InventoryDigest {
  const acc = new Map<number, { typeId: number; qty: number; cost: number; oldestAt: number }>();
  for (const l of lots) {
    if (l.qty <= 0) continue;
    let r = acc.get(l.typeId);
    if (!r) { r = { typeId: l.typeId, qty: 0, cost: 0, oldestAt: l.date }; acc.set(l.typeId, r); }
    r.qty += l.qty; r.cost += l.qty * l.unitCost; r.oldestAt = Math.min(r.oldestAt, l.date);
  }
  const rows = [...acc.values()].sort((a, b) => b.cost - a.cost || a.typeId - b.typeId);
  const live = lots.filter((l) => l.qty > 0);
  return { atCost: rows.reduce((t, r) => t + r.cost, 0), lots: live.length, items: rows.length, oldestAt: live.length > 0 ? minOf(live.map((l) => l.date)) : null, top: rows.slice(0, keep) };
}

// ---- the market talking back (the trend watcher's events)
export interface EventLite { t: number; kind: string; typeId: number; price?: number; rival?: number; isk?: number; qty?: number; side?: 'sell' | 'buy' }
export const FEED_KINDS = ['outbid_sell', 'outbid_buy', 'sale', 'rival_new', 'rival_reprice', 'rival_gone'];
export interface EventsDigest { outbidSell: number; outbidBuy: number; sales: number; salesIsk: number; rivalMoves: number; recent: EventLite[] }
export function eventsDigest(events: readonly EventLite[], now: number, hours = 24, keep = 8): EventsDigest {
  const inWin = events.filter((e) => now - e.t <= hours * 3_600_000 && e.t <= now && FEED_KINDS.includes(e.kind));
  const n = (k: string) => inWin.filter((e) => e.kind === k).length;
  return {
    outbidSell: n('outbid_sell'), outbidBuy: n('outbid_buy'), sales: n('sale'), salesIsk: inWin.filter((e) => e.kind === 'sale').reduce((t, e) => t + (e.isk ?? 0), 0),
    rivalMoves: n('rival_new') + n('rival_reprice') + n('rival_gone'),
    recent: [...inWin].sort((a, b) => b.t - a.t).slice(0, keep),
  };
}

// ---- planets: resets, products, pilots
export interface PiLite {
  characterName: string; planetName: string; rank: number; value: number; fullFrac: number; hoursToFull: number | null;
  extractorExpiry: number | null; extractorCount: number; expiredExtractors: number;
  contents: { typeId: number; name: string; amount: number; value: number }[];
}
/** the PI tab's own bands: rank ≤ 2 "need you NOW" (full, all heads dead, filling); 3–5 worth a
 * trip soon (some heads dead, a program ending, idle factories); above that is tuning */
export const PI_NOW_RANK = 2, PI_SOON_RANK = 5;
export interface PiBands { total: number; now: number; soon: number; tune: number; ok: number }
export function piBands(planets: readonly { rank: number }[]): PiBands {
  const now = planets.filter((p) => p.rank <= PI_NOW_RANK).length;
  const soon = planets.filter((p) => p.rank > PI_NOW_RANK && p.rank <= PI_SOON_RANK).length;
  const tune = planets.filter((p) => p.rank > PI_SOON_RANK && p.rank < 9).length;
  return { total: planets.length, now, soon, tune, ok: planets.length - now - soon - tune };
}
export interface ResetRow { characterName: string; planetName: string; at: number | null; expired: number; heads: number }
/** planets with extractors, dead heads first, then the soonest program end */
export function extractorResets(planets: readonly PiLite[], now: number): { rows: ResetRow[]; expired: number; within24h: number } {
  const rows = planets.filter((p) => p.extractorCount > 0)
    .map((p) => ({ characterName: p.characterName, planetName: p.planetName, at: p.extractorExpiry, expired: p.expiredExtractors, heads: p.extractorCount }))
    .sort((a, b) => (b.expired > 0 ? 1 : 0) - (a.expired > 0 ? 1 : 0) || (a.at ?? 1e18) - (b.at ?? 1e18) || a.planetName.localeCompare(b.planetName));
  return { rows, expired: rows.filter((r) => r.expired > 0).length, within24h: rows.filter((r) => r.expired === 0 && r.at !== null && r.at - now <= DAY && r.at > now).length };
}
export interface ProductRow { typeId: number; name: string; amount: number; value: number }
export function piProducts(planets: readonly PiLite[], keep = 8): { rows: ProductRow[]; value: number; kinds: number } {
  const acc = new Map<number, ProductRow>();
  for (const p of planets) for (const c of p.contents) {
    let r = acc.get(c.typeId);
    if (!r) { r = { typeId: c.typeId, name: c.name, amount: 0, value: 0 }; acc.set(c.typeId, r); }
    r.amount += c.amount; r.value += c.value;
  }
  const rows = [...acc.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
  return { rows: rows.slice(0, keep), value: rows.reduce((t, r) => t + r.value, 0), kinds: rows.length };
}
export interface PilotPlanets { characterName: string; planets: number; now: number; value: number; fullest: number }
export function piByPilot(planets: readonly PiLite[]): PilotPlanets[] {
  const acc = new Map<string, PilotPlanets>();
  for (const p of planets) {
    let r = acc.get(p.characterName);
    if (!r) { r = { characterName: p.characterName, planets: 0, now: 0, value: 0, fullest: 0 }; acc.set(p.characterName, r); }
    r.planets++; r.value += p.value; r.fullest = Math.max(r.fullest, p.fullFrac); if (p.rank <= PI_NOW_RANK) r.now++;
  }
  return [...acc.values()].sort((a, b) => b.now - a.now || b.value - a.value || a.characterName.localeCompare(b.characterName));
}

// ---- robberies, from the raid watcher's verdict log
export interface VerdictLite { t: number; systemId: number; kind: string; intoWindowMin?: number }
const inDays = (e: { t: number }, now: number, days: number) => now - e.t <= days * DAY && e.t <= now;
export function raidHot(events: readonly VerdictLite[], now: number, days: number, keep = 8): { rows: { systemId: number; raided: number; lastAt: number }[]; systems: number } {
  const acc = new Map<number, { systemId: number; raided: number; lastAt: number }>();
  for (const e of events) {
    if (e.kind !== 'raided' || !inDays(e, now, days)) continue;
    let r = acc.get(e.systemId);
    if (!r) { r = { systemId: e.systemId, raided: 0, lastAt: 0 }; acc.set(e.systemId, r); }
    r.raided++; r.lastAt = Math.max(r.lastAt, e.t);
  }
  const rows = [...acc.values()].sort((a, b) => b.raided - a.raided || b.lastAt - a.lastAt || a.systemId - b.systemId);
  return { rows: rows.slice(0, keep), systems: rows.length };
}
/** robberies by EVE hour of day (0–23) — when the thieves are awake */
export function byEveHour(times: readonly number[]): { hours: number[]; peak: number | null; total: number } {
  const hours = new Array<number>(24).fill(0);
  for (const t of times) hours[new Date(t).getUTCHours()]++;
  const max = maxOf(hours);
  return { hours, peak: max > 0 ? hours.indexOf(max) : null, total: times.length };
}
export interface OutcomeDigest { raided: number; survived: number; unknown: number; rate: number | null; medianIntoMin: number | null }
/** of the windows the watcher could call, how many ended robbed. "unknown" closes are left out of
 * the rate — they are neither — and a survived window may still hide a late raid in its blind tail */
export function raidOutcomes(events: readonly VerdictLite[], now: number, days: number): OutcomeDigest {
  const win = events.filter((e) => inDays(e, now, days));
  const raided = win.filter((e) => e.kind === 'raided');
  const survived = win.filter((e) => e.kind === 'survived').length;
  const mins = raided.map((e) => e.intoWindowMin).filter((m): m is number => typeof m === 'number').sort((a, b) => a - b);
  return {
    raided: raided.length, survived, unknown: win.filter((e) => e.kind === 'unknown').length,
    rate: raided.length + survived > 0 ? raided.length / (raided.length + survived) : null,
    medianIntoMin: mins.length > 0 ? mins[Math.floor(mins.length / 2)] : null,
  };
}

// ---- the player's own loot log
export interface HaulLite { at: number; site: string; isk: number; system: string }
export interface HaulsDigest { count: number; total: number; recent: number; recentCount: number; best: { site: string; mean: number; n: number } | null; last: HaulLite | null }
export function haulsDigest(hauls: readonly HaulLite[], now: number, days = 30): HaulsDigest {
  const recent = hauls.filter((h) => inDays({ t: h.at }, now, days));
  const bySite = new Map<string, { site: string; sum: number; n: number }>();
  for (const h of hauls) { let r = bySite.get(h.site); if (!r) { r = { site: h.site, sum: 0, n: 0 }; bySite.set(h.site, r); } r.sum += h.isk; r.n++; }
  const best = [...bySite.values()].map((r) => ({ site: r.site, mean: r.sum / r.n, n: r.n })).sort((a, b) => b.mean - a.mean || a.site.localeCompare(b.site))[0] ?? null;
  return {
    count: hauls.length, total: hauls.reduce((t, h) => t + h.isk, 0), recent: recent.reduce((t, h) => t + h.isk, 0), recentCount: recent.length, best,
    last: hauls.length > 0 ? hauls.reduce((a, b) => (b.at > a.at ? b : a)) : null,
  };
}

// ---- logins: whose session the app can still use
export interface LoginLite { characterId: number; name: string; refreshToken: string | null; expiresAt: number; lastSync: number | null; wallet: number | null }
export type LoginState = 'ok' | 'relogin';
export interface LoginRow { characterId: number; name: string; state: LoginState; lastSync: number | null; wallet: number | null }
/** a character with no refresh token, or one ESI refused on the last team read, needs logging in again */
export function loginsDigest(chars: readonly LoginLite[], failed: readonly number[]): { rows: LoginRow[]; relogin: number } {
  const rows = chars.map((c) => ({ characterId: c.characterId, name: c.name, state: (!c.refreshToken || failed.includes(c.characterId) ? 'relogin' : 'ok') as LoginState, lastSync: c.lastSync, wallet: c.wallet }))
    .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === 'relogin' ? -1 : 1));
  return { rows, relogin: rows.filter((r) => r.state === 'relogin').length };
}
export function walletsDigest(chars: readonly LoginLite[]): { rows: { characterId: number; name: string; wallet: number; lastSync: number | null }[]; total: number; unknown: number } {
  const rows = chars.filter((c) => c.wallet !== null).map((c) => ({ characterId: c.characterId, name: c.name, wallet: c.wallet!, lastSync: c.lastSync })).sort((a, b) => b.wallet - a.wallet || a.name.localeCompare(b.name));
  return { rows, total: rows.reduce((t, r) => t + r.wallet, 0), unknown: chars.length - rows.length };
}
