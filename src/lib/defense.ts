// Competition-adjusted economics: what an order war actually COSTS.
// Paper profit ignores that a contested item makes you reprice over and over,
// and every reprice charges a fee. All three inputs are measured, not guessed:
//  - YOUR reprice pace: from your own order-event log (how often you actually
//    update orders). If you historically don't babysit, your defense cost is
//    genuinely lower — you pay in queue position instead.
//  - Reprice fee size: from YOUR ledger's matched broker fees (relist charges
//    as a fraction of the placement fee). Falls back to EVE's ~50%-of-broker
//    baseline, labeled as such, until real data exists.
//  - Rival tempo: the live book's own issued timestamps (undercut heat).
import { ledger, attributeBrokerFees } from './ledger';
import { useAuth } from './auth';
import type { Heat } from './heat';

/** shared sizing conventions: how long an order is assumed to work the book */
export const FILL_WINDOW_DEFAULT_DAYS = 2;
export const FILL_WINDOW_CAP_DAYS = 7;

/** Advanced Broker Relations — per its ESI description (verified): each level
 * adds 6 percentage points to the standard Relist Discount of 50%. */
const ABR_SKILL_ID = 16597;

export interface DefenseModel {
  /** my observed reprices per order-day (team-wide) */
  myPacePerDay: number;
  /** orders the pace was measured over (confidence) */
  paceOrders: number;
  /** relist charge as a fraction of the placement fee */
  relistFeeRatio: number;
  /** where the ratio came from, best available first */
  relistSource: 'measured' | 'skills' | 'baseline';
  /** ABR level used when relistSource is 'skills' */
  abrLevel?: number;
}

/** relist fee ratio from the team's best Advanced Broker Relations level
 * (trader-duty characters first — they do the listing) */
function skillRelistRatio(): { ratio: number; level: number } | null {
  const chars = useAuth.getState().characters;
  const traders = chars.filter((c) => c.tradeRole === 'trader' && c.skills);
  const pool = traders.length > 0 ? traders : chars.filter((c) => c.skills);
  let best: number | null = null;
  for (const c of pool) {
    const l = c.skills?.[ABR_SKILL_ID];
    if (l !== undefined) best = Math.max(best ?? 0, l);
  }
  if (best === null) return null;
  return { ratio: Math.max(0, 0.5 - 0.06 * best), level: best };
}

let cacheKey = '';
let cache: DefenseModel | null = null;

/** measured defense model from my own history (cached per ledger state) */
export function defenseModel(): DefenseModel {
  const skills = skillRelistRatio();
  const key = `${ledger.orderEvents.length}:${ledger.fees.length}:${skills?.level ?? 'x'}`;
  if (cache && key === cacheKey) return cache;

  // pace: reprices per order-day, over orders observed with ≥1 event
  const byOrder = new Map<number, number[]>();
  for (const e of ledger.orderEvents) {
    (byOrder.get(e.orderId) ?? byOrder.set(e.orderId, []).get(e.orderId)!).push(e.issued);
  }
  let reprices = 0;
  let orderDays = 0;
  for (const issues of byOrder.values()) {
    const uniq = [...new Set(issues)].sort((a, b) => a - b);
    reprices += uniq.length - 1;
    orderDays += Math.max(1, (Date.now() - uniq[0]) / 86_400_000);
  }
  const myPacePerDay = orderDays > 0 ? reprices / orderDays : 0;

  // relist fee ratio: later matched fees vs the first (placement) fee
  const attr = attributeBrokerFees();
  const feesByOrder = new Map<number, number[]>();
  for (const f of [...ledger.fees].sort((a, b) => a.date - b.date)) {
    if (f.kind !== 'brokers_fee') continue;
    const ev = attr.byFee.get(f.id);
    if (!ev) continue;
    (feesByOrder.get(ev.orderId) ?? feesByOrder.set(ev.orderId, []).get(ev.orderId)!).push(f.amount);
  }
  let ratios: number[] = [];
  for (const list of feesByOrder.values()) {
    if (list.length >= 2 && list[0] > 0) {
      for (let i = 1; i < list.length; i++) ratios.push(list[i] / list[0]);
    }
  }
  ratios = ratios.filter((r) => r > 0 && r < 2);
  // best available truth: my actual paid fees > my skills' exact formula >
  // the untrained 50% baseline
  let relistFeeRatio: number;
  let relistSource: DefenseModel['relistSource'];
  if (ratios.length >= 3) {
    relistFeeRatio = ratios.sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
    relistSource = 'measured';
  } else if (skills) {
    relistFeeRatio = skills.ratio;
    relistSource = 'skills';
  } else {
    relistFeeRatio = 0.5;
    relistSource = 'baseline';
  }

  cache = {
    myPacePerDay,
    paceOrders: byOrder.size,
    relistFeeRatio,
    relistSource,
    abrLevel: skills?.level,
  };
  cacheKey = key;
  return cache;
}

// ---- heat forecast: leading indicators, BEFORE the book shows the war ----

export type HeatForecast = 'early' | 'heating' | 'cooling' | null;

/**
 * Predict competition direction from history-derived leading indicators:
 * - heating: orders-per-traded-unit (crowding) rising ≥25% vs the 30d norm —
 *   competitors are flowing in; expect defense costs to climb.
 * - cooling: crowding down ≥20% — rivals leaving; margins may recover.
 * - early: demand (volume rate) up ≥30% while crowding is NOT rising — the
 *   window where you profit BEFORE the crowd arrives.
 */
export function heatForecast(
  crowd7: number | null,
  crowd30: number | null,
  vol7: number | null,
  vol30: number | null,
): HeatForecast {
  const crowdRatio = crowd7 !== null && crowd30 !== null && crowd30 > 0 ? crowd7 / crowd30 : null;
  const volGrowth = vol7 !== null && vol30 !== null && vol30 > 0 ? vol7 / vol30 : null;
  if (crowdRatio !== null && crowdRatio >= 1.25) return 'heating';
  if (volGrowth !== null && volGrowth >= 1.3 && (crowdRatio === null || crowdRatio <= 1.1)) return 'early';
  if (crowdRatio !== null && crowdRatio <= 0.8) return 'cooling';
  return null;
}

/** rival reprices/day implied by the front line's issued-timestamp ages */
export function rivalTempoPerDay(heat: Heat | null | undefined): number | null {
  if (!heat) return null;
  const medianDays = Math.max(heat.medianAgeMs / 86_400_000, 1 / 96); // ≥15 min
  // each front-line order reprices roughly once per 2× its median age
  return Math.min(24, heat.rivals / (2 * medianDays));
}

export interface DefenseEstimate {
  /** expected ISK/day spent on reprice fees defending this order */
  costPerDay: number;
  /** expected reprices/day (min of my pace and rival pressure) */
  repricesPerDay: number;
  perReprice: number;
  assumedPace: boolean;
}

/**
 * Expected defense cost for listing `qty` units at `price` with base broker
 * rate `brokerRate`. Null when there's no live heat to read pressure from.
 */
export function estimateDefense(
  heat: Heat | null | undefined,
  price: number,
  qty: number,
  brokerRate: number,
): DefenseEstimate | null {
  const tempo = rivalTempoPerDay(heat);
  if (tempo === null) return null;
  const m = defenseModel();
  // I defend at MY historical pace, and no more often than the war demands;
  // with no personal history yet, assume a modest defender (≤3/day)
  const assumedPace = m.paceOrders < 5;
  const pace = assumedPace ? Math.min(tempo, 3) : Math.min(tempo, m.myPacePerDay);
  const perReprice = m.relistFeeRatio * brokerRate * price * qty;
  return { costPerDay: pace * perReprice, repricesPerDay: pace, perReprice, assumedPace };
}

/**
 * Structural "ease of entry": what makes an item attract crowds regardless of
 * its current heat — anyone can join a market that needs little capital, no
 * real hauling, and pays a fat margin. Two or more factors = open door.
 */
export function entryEase(unitCost: number, unitM3: number, margin: number | null): {
  easy: boolean;
  factors: string[];
} {
  const factors: string[] = [];
  if (unitCost < 5_000_000) factors.push('cheap per unit (low capital to enter)');
  if (unitM3 < 100) factors.push('tiny to haul (no logistics barrier)');
  if (margin !== null && margin > 0.2) factors.push('fat margin (attracts sharks)');
  return { easy: factors.length >= 2, factors };
}
