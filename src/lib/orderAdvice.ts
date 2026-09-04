// WHAT TO DO ABOUT ONE ORDER — the single most consequential function in the
// app: it is the column the user acts from every day, and a wrong answer here
// costs real ISK. It lived inside MyOrders.tsx, where it could not be reached
// by a fixture; it is pure, so it belongs in a place where its rules can be
// PROVEN rather than eyeballed. Nothing about the logic changed in the move.
import { MKT_MIN_DAYS, inWindow3h, type SystemSchedule } from './schedule';
import { isk } from './format';
import type { Heat } from './heat';
import type { MyOrder } from './esiChar';

export const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
export const win3 = (start: number) => `${hh(start)}–${hh((start + 3) % 24)}`;

/** ms until the next UTC occurrence of hour h */
export function msUntilHour(h: number): number {
  const now = new Date();
  const t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), h, 0, 0);
  const ms = t - now.getTime();
  return ms > 0 ? ms : ms + 86_400_000;
}

export function fmtWait(ms: number): string {
  const m = Math.round(ms / 60_000);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** fraction of the order already filled */
export const fillFrac = (o: MyOrder) => (o.volume_total - o.volume_remain) / Math.max(1, o.volume_total);

export interface Advice { txt: string; cls: string; tip: string; rank: number }
/**
 * What to DO about this order. Trends is where you INVESTIGATE; this column
 * is where you ACT. Time-based signals (act NOW / fix by HH:00) come ONLY
 * from the unbiased station-fill observation (everyone's fills, ≥5 days) —
 * before that threshold the advice stays time-free rather than confidently
 * wrong.
 */
export function adviceFor(
  r: {
    edge: number | null; heat: Heat | null; order: MyOrder; systemId: number;
    underwater?: boolean; breakEven?: number | null; paid?: number | null;
  },
  sched: SystemSchedule | undefined,
  windows?: number[] | null,
): { txt: string; cls: string; tip: string; rank: number } {
  const beaten = r.edge !== null && r.edge < -1e-9;
  const fill = fillFrac(r.order);
  const hot = r.heat?.level === 'hot';
  const nowH = new Date().getUTCHours();

  // NEVER TELL THE USER TO PRICE FURTHER BELOW COST. Every branch after this
  // one ends in "reprice", and the beaten button next to it copies a price
  // strictly UNDER the station best — so on an order already netting less
  // than the stock cost, the whole column was advice to pay a relist fee in
  // order to lose more per fill. The ⚠ loss chip two columns to the left was
  // saying the opposite at the same time. This check comes FIRST, before the
  // radar windows and before the prime-hours logic, because none of that
  // timing matters when the trade itself is underwater: the real decision is
  // hold for a better book or cut and move on, and only the user can make it.
  if (r.underwater) {
    const be = r.breakEven;
    return {
      txt: '🛑 below cost — hold or cut',
      cls: 'flag warn',
      rank: 0,
      tip:
        `This order's price already nets LESS than the stock cost${r.paid != null ? ` (${isk(r.paid)}/unit)` : ''}`
        + `${be != null ? `; you break even at ${isk(be)} gross` : ''}. `
        + (beaten
          ? 'You are also beaten — but undercutting here only pays a relist fee to lose more on every fill. '
          : '')
        + 'This is a hold-or-cut decision, not a repricing one: wait for the book to recover, or accept the loss deliberately. The app will not recommend a price for you here.',
    };
  }

  // RADAR-grade multi-window advice: the profitable-hours SET for THIS item
  // and THIS order's real margin (fix whenever expected captured profit in
  // the hour beats one reprice fee — multiple windows per day are normal)
  if (beaten && windows && windows.length > 0) {
    const list = windows.map((h) => hh(h)).join(', ');
    if (windows.includes(nowH))
      return {
        txt: `⚔ fix — sale window (${windows.length}/day)`,
        cls: 'flag warn',
        rank: 0,
        tip: `You are beaten INSIDE one of this item's ${windows.length} profitable reprice windows (${list} EVE) — hours where this item's own measured fill flow × your order's margin outweighs one reprice fee (assumes ~50% capture when on top; from the market radar's per-item fill clock). Click the beaten tag to fix now.`,
      };
    let best = 25;
    for (const h of windows) {
      const wait = (h - nowH + 24) % 24;
      if (wait > 0 && wait < best) best = wait;
    }
    const nextH = windows.find((h) => (h - nowH + 24) % 24 === best) ?? windows[0];
    const wait = msUntilHour(nextH);
    return {
      txt: `🕐 next window in ${fmtWait(wait)}`,
      cls: 'flag warn',
      rank: 2,
      tip: `Beaten, but outside this item's profitable reprice windows (${list} EVE — ${windows.length}/day, from ITS own radar fill clock × your order's margin vs one reprice fee). Retake the top ~${fmtWait(wait)} from now (at ${hh(nextH)})${hot ? '; the book is hot — fixing between windows just feeds the war' : ''}.`,
    };
  }
  const market = sched?.marketReady ? sched : null;
  const primeNow = market?.prime ? inWindow3h(nowH, market.prime.start) : false;
  const basis = market
    ? market.mktSolid
      ? `Based on ${market.mktDays} days of station-fill observation (everyone's fills, ISK-weighted) — keeps sharpening as more data lands.`
      : `EARLY ESTIMATE — only ${market.mktDays} day(s) of station-fill observation so far; the window sharpens every day and this note disappears at ${MKT_MIN_DAYS} days.`
    : sched
      ? 'No station fills observed here yet — advice is standing/heat only until the watcher sees the first market activity.'
      : 'No trend data for this system yet — advice is standing/heat only.';

  if (beaten) {
    if (market?.prime) {
      if (primeNow)
        return {
          txt: '⚔ act NOW — prime hours',
          cls: 'flag warn',
          rank: 0,
          tip: `You are beaten DURING the prime selling window (${market.prime.sharePct}% of this station's sales land ${win3(market.prime.start)} EVE). Every minute off the top spot right now costs real fills — click the beaten tag to fix. ${basis}`,
        };
      const wait = msUntilHour(market.prime.start);
      return {
        txt: `🕐 fix in ${fmtWait(wait)}`,
        cls: 'flag warn',
        rank: 2,
        tip: `Beaten — WAIT ${fmtWait(wait)} (until ${hh(market.prime.start)} EVE), then retake the top for the prime selling window (${win3(market.prime.start)}, ${market.prime.sharePct}% of station sales)${hot ? '. The book is hot right now — fixing early just feeds the tick war' : ''}. ${basis}`,
      };
    }
    if (hot)
      return {
        txt: '⏳ time your fix',
        cls: 'flag warn',
        rank: 2,
        tip: `Beaten on a HOT book — a tick war. Fixing now likely gets undercut again in minutes; make ONE deliberate reprice rather than feeding the war. ${basis}`,
      };
    return {
      txt: '⚑ fix now',
      cls: 'flag warn',
      rank: 1,
      tip: `Beaten on a CALM book — one fix will likely stick. Click the beaten tag: it copies the beating price and opens the game window. ${basis}`,
    };
  }
  if (fill >= 0.8)
    return {
      txt: '📦 restock soon',
      cls: 'flag info',
      rank: 3,
      tip: '≥80% filled and winning — line up the next batch (Trade Finder → allocator) so the pipeline never idles.',
    };
  if (market?.prime && primeNow && hot)
    return {
      txt: '🛡 hold — prime hours',
      cls: 'flag good',
      rank: 4,
      tip: `On top during the prime selling window (${win3(market.prime.start)} EVE) with a hot book — fills are landing now; check back before the window ends. ${basis}`,
    };
  if (hot)
    return {
      txt: '🛡 hold the spot',
      cls: 'flag good',
      rank: 4,
      tip: `On top of a HOT book — expect to defend again soon; keep this one on your radar. ${basis}`,
    };
  return {
    txt: '✓ leave it',
    cls: 'flag good',
    rank: 5,
    tip: 'Winning on a calm book — repricing now would only pay fees.',
  };
}
