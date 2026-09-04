// ONE schedule computation, shared by the Trends tab (investigate) and the
// My Orders advice column (act). Data-honesty rules: time-based act-signals
// come ONLY from the unbiased station-fill observation (mkt_hour events) —
// never from the user's own fill times, which are biased by when they held
// top spot. Signals start with the FIRST observed fills and sharpen daily;
// below MKT_MIN_DAYS they are labeled EARLY ESTIMATE (user decision: show
// the improving estimate with its basis rather than hiding it).
import type { TrendEvent } from './trends';

export const REC_MIN_SALES = 30;
export const REC_MIN_OUTBIDS = 20;
export const REC_MIN_DAYS = 7;
export const MKT_MIN_DAYS = 5;

/** best contiguous 3-hour window (wrap-around); ties prefer the window whose
 * MIDDLE hour carries the most weight, so peaks sit centered, not clipped */
export function best3h(byHour: number[]): { start: number; count: number } {
  let best = -1;
  let bestMid = -1;
  let bi = 0;
  for (let h = 0; h < 24; h++) {
    const c = byHour[h] + byHour[(h + 1) % 24] + byHour[(h + 2) % 24];
    const mid = byHour[(h + 1) % 24];
    if (c > best || (c === best && mid > bestMid)) {
      best = c;
      bestMid = mid;
      bi = h;
    }
  }
  return { start: bi, count: best };
}

/** is this UTC hour inside the 3-hour window starting at `start`? */
export const inWindow3h = (hourUtc: number, start: number): boolean =>
  (hourUtc - start + 24) % 24 < 3;

export interface SystemSchedule {
  systemId: number;
  /** enough of the user's own outbid/sale history for the Trends card */
  coreReady: boolean;
  /** ANY unbiased station fills observed — time-based signals start here and
   * sharpen daily (user decision: no hard day-gate; the basis is always shown) */
  marketReady: boolean;
  /** ≥5 distinct days — the estimate is considered solid */
  mktSolid: boolean;
  mktDays: number;
  mktIsk: number;
  /** prime selling window from MARKET fills (ISK-weighted) — null until ready */
  prime: { start: number; sharePct: number } | null;
  /** undercut-pressure window (from the user's outbid events) */
  noise: { start: number; sharePct: number } | null;
  /** prime and noise overlap ≥2 of 3 hours — position pays during the war */
  overlap: boolean;
  /** the user's own sales window — BIASED (investigation only, never advice) */
  mySales: { start: number; sharePct: number } | null;
  nSales: number;
  nOutbids: number;
  spanDays: number;
}

/**
 * THE WINDOW THE ADVICE IS ACTUALLY COMPUTED OVER.
 *
 * MyOrders' advice column and the Trends "when to act" card are meant to be
 * the same answer shown twice — Trends says so in as many words ("the My
 * Orders advice column ACTS on these windows"). They used to disagree: Trends
 * recomputed everything over the user's selected 7d/30d/90d/All range while
 * MyOrders was hardcoded to 30 days, so picking any other range silently
 * changed prime.start, mktDays, mktSolid and even ready-vs-learning on a card
 * that still claimed parity. Both now read this constant, so the claim is
 * enforced by construction rather than by comment.
 */
export const ADVICE_WINDOW_MS = 30 * 86_400_000;

/**
 * Per-system schedules from the trend event history. `events` = full list
 * (the caller windows core events; market fills always use the same window).
 */
export function computeSchedules(events: TrendEvent[], windowMs: number): Map<number, SystemSchedule> {
  const now = Date.now();
  const cutoff = windowMs === Infinity ? 0 : now - windowMs;

  interface Acc {
    sales: number[];
    outbids: number[];
    mkt: number[];
    nSales: number;
    nOutbids: number;
    mktIsk: number;
    mktDays: Set<string>;
    /** oldest IN-WINDOW event for THIS system. spanDays used to be one global
     * number taken from events[0] — the oldest entry of the entire never-pruned
     * log, across every system and every kind (it could even be a net-worth
     * snapshot). So a system first traded yesterday inherited the tracking age
     * of the oldest system on the books: the readiness gate below passed on
     * data that had nothing to do with it, and the card printed "over N days"
     * next to a sale count gathered over one. */
    first: number;
  }
  const bySys = new Map<number, Acc>();
  const acc = (id: number): Acc => {
    let a = bySys.get(id);
    if (!a) {
      a = {
        sales: new Array(24).fill(0),
        outbids: new Array(24).fill(0),
        mkt: new Array(24).fill(0),
        nSales: 0,
        nOutbids: 0,
        mktIsk: 0,
        mktDays: new Set(),
        first: Infinity,
      };
      bySys.set(id, a);
    }
    return a;
  };

  for (const e of events) {
    if (e.t < cutoff) continue;
    const h = new Date(e.t).getUTCHours();
    if (e.kind === 'sale') {
      const a = acc(e.systemId);
      a.sales[h] += 1;
      a.nSales += 1;
      a.first = Math.min(a.first, e.t);
    } else if (e.kind === 'outbid_sell' || e.kind === 'outbid_buy') {
      const a = acc(e.systemId);
      a.outbids[h] += 1;
      a.nOutbids += 1;
      a.first = Math.min(a.first, e.t);
    } else if (e.kind === 'mkt_hour') {
      if (e.side === 'buy') continue; // bid-side flow is radar's business
      const a = acc(e.systemId);
      a.mkt[h] += e.isk ?? 0;
      a.mktIsk += e.isk ?? 0;
      a.mktDays.add(new Date(e.t).toISOString().slice(0, 10));
      a.first = Math.min(a.first, e.t);
    }
  }

  const out = new Map<number, SystemSchedule>();
  for (const [systemId, a] of bySys) {
    const marketReady = a.mktIsk > 0;
    const mktSolid = a.mktDays.size >= MKT_MIN_DAYS;
    // how long THIS system has been tracked, inside the selected window —
    // the same span the counts beside it were gathered over
    const spanDays = a.first === Infinity ? 0 : (now - a.first) / 86_400_000;
    const coreReady =
      a.nSales >= REC_MIN_SALES && a.nOutbids >= REC_MIN_OUTBIDS && spanDays >= REC_MIN_DAYS;
    const mw = marketReady ? best3h(a.mkt) : null;
    const ow = a.nOutbids > 0 ? best3h(a.outbids) : null;
    const sw = a.nSales > 0 ? best3h(a.sales) : null;
    const overlap =
      mw !== null && ow !== null
        ? [0, 1, 2].filter((k) => inWindow3h((mw.start + k) % 24, ow.start)).length >= 2
        : false;
    out.set(systemId, {
      systemId,
      coreReady,
      marketReady,
      mktSolid,
      mktDays: a.mktDays.size,
      mktIsk: a.mktIsk,
      prime: mw ? { start: mw.start, sharePct: Math.round((100 * mw.count) / Math.max(1, a.mktIsk)) } : null,
      noise: ow ? { start: ow.start, sharePct: Math.round((100 * ow.count) / Math.max(1, a.nOutbids)) } : null,
      overlap,
      mySales: sw ? { start: sw.start, sharePct: Math.round((100 * sw.count) / Math.max(1, a.nSales)) } : null,
      nSales: a.nSales,
      nOutbids: a.nOutbids,
      spanDays,
    });
  }
  return out;
}
