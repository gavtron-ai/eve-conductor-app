// MINING WATCH (v0.202.0) — "is every miner still pulling at full rate?"
//
// THE SIGNAL. Every mining cycle that completes writes ONE "(mining) You
// mined N units of ORE" line to that character's own game log (measured
// 2026-08-28; crit and residue lines are extras on the same cycle and are
// not counted). A module cycles at a fixed length while it runs, so the
// lines from M running modules arrive as M events every cycle. Nothing is
// written when a module SHUTS DOWN — a broken crystal, a depleted rock, a
// full hold, a pilot who forgot to restart — so a shutdown is only visible
// as lines that stop coming. That is what this watches for.
//
// THE MODEL, per character:
//   period P    the cycle length, found from the events themselves: the
//               smallest lag (15 s … 10 min) at which ≥ 90 % of events have
//               a successor exactly one lag later (±2 s). Needs 4 events.
//   cur         events in the window of 4 periods ending at the LAST event
//               (anchored on an event, so a steady M-module run always
//               counts exactly 4·M — no boundary noise)
//   peak        the 80th percentile of that count over every event of the
//               last 30 minutes: what this character normally manages.
//               (Not the maximum — measured 2026-09-15: one real session
//               spiked to 18 lines in a window against a norm of 12–13,
//               and the maximum would have called the next twenty minutes
//               a rate drop.)
//   gap         time since the last event
//   quiet       gap > P — this character has missed at least one slot
//
//   REDUCED     cur at most dropRatio × peak (¾ by default) and at least two
//               short (one crystal swap is one missed slot and stays
//               silent), the current unbroken run at least a window long
//               (so a crew move does not read as a rate drop afterwards),
//               and the shortfall held for the reaction DELAY (30 s by
//               default, the pilot's own knob — measured 2026-09-15 on the
//               owner's logs: his crew cycles every ~15 s, so "two slots"
//               alone is a 30-s retarget, not a shutdown; the CEO wants
//               modules back online as soon as possible, so the default
//               is short and the slider goes to zero).
//   STOPPED     no line for a whole period (never less than 30 s) plus the
//               same reaction delay.
//
// WHAT IS DELIBERATELY NOT AN ALERT (the CEO's rule: "do not notify when
// every single miner stops, that happens a lot when moving"):
//   · nobody else in the crew is still mining — the whole crew stopped, a
//     move or an unload run; and for two cycles after the first of them
//     resumes, so the slow ones locking rocks are not named;
//   · the character has docked or left the system they mined in — an
//     unload trip;
//   · the character changed ship — a new fit, history discarded;
//   · a lone miner stopping (one character IS the whole crew).
// A reduced alert clears once the rate is back for a few cycles, or after
// half an hour at the lower rate (it becomes the new normal); a stopped
// alert clears when they mine again, dock, move, or after 15 minutes.
//
// Pure functions — the fixture suite runs this exact code.

export interface MiningSample { charId: number; charName: string; t: number }

export interface MinerLoc {
  online: boolean;
  docked: boolean;
  systemId: number | null;
  shipTypeId: number | null;
}

export type MinerStatus = 'idle' | 'ok' | 'reduced' | 'stopped';

export interface MiningAlert {
  charId: number;
  charName: string;
  kind: 'stopped' | 'reduced';
  /** ms epoch when this alert was first raised */
  since: number;
}

export interface MinerState {
  charId: number;
  charName: string;
  /** 'mine' event times, ms, sorted, at most KEEP_MS old */
  events: number[];
  period: number | null;
  status: MinerStatus;
  cur: number;
  peak: number;
  active: boolean;
  quiet: boolean;
  quietSince: number | null;
  /** where (and in what) the last mining event happened */
  homeSystemId: number | null;
  homeShipTypeId: number | null;
  /** when the current shortfall was first seen (the reduced hold clock) */
  reducedSince: number | null;
  alertKind: 'stopped' | 'reduced' | null;
  alertSince: number | null;
}

export interface FleetState {
  /** true while nobody in the crew has completed a cycle within a period —
   * the whole crew stopped (a move, an unload run) or nobody mines at all */
  fleetMove: boolean;
  /** when the last crew move ended (someone resumed) */
  moveEndedAt: number | null;
}

export interface WatchState { miners: MinerState[]; fleet: FleetState }

export const TOL_MS = 2_000;
export const MIN_PERIOD_MS = 8_000;
export const MAX_PERIOD_MS = 600_000;
/** events older than this are forgotten */
export const KEEP_MS = 30 * 60_000;
/** the period is estimated from this much recent history */
export const LOOKBACK_MS = 20 * 60_000;
export const WINDOW_PERIODS = 4;
/** the anchored window is 4 P minus this, so the burst exactly 4 P back is
 * excluded even when the estimate is a second short */
export const WINDOW_SLACK_MS = 6_000;
/** a miner counts as quiet after a period, but never sooner than this */
export const QUIET_MIN_MS = 30_000;
export const REDUCED_MIN_DROP = 2;
/** the baseline is this percentile of the anchored counts, not their max */
export const PEAK_PERCENTILE = 0.8;
export const MOVE_GRACE_MIN_MS = 90_000;

/** the pilot's knobs (the overlay settings window, ⛏ Mining Alert) */
export interface WatchOptions {
  /** how much longer than the bare minimum to wait before naming someone:
   * a shortfall must hold this long; silence must last a period plus this */
  delayMs: number;
  /** a shortfall counts when the count is at most this share of normal
   * (and at least two lines short) */
  dropRatio: number;
  /** a "not mining" line leaves the screen after this */
  keepStoppedMs: number;
}
export const DEFAULT_WATCH_OPTIONS: WatchOptions = { delayMs: 30_000, dropRatio: 0.75, keepStoppedMs: 15 * 60_000 };
export const MOVE_GRACE_PERIODS = 2;
/** an alert younger than this blinks on the overlay */
export const FRESH_MS = 20_000;

export const emptyWatch = (): WatchState => ({ miners: [], fleet: { fleetMove: false, moveEndedAt: null } });

/** index of the first element ≥ x */
function lowerBound(a: readonly number[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}
/** index of the first element > x */
function upperBound(a: readonly number[], x: number): number {
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] <= x) lo = mid + 1; else hi = mid; }
  return lo;
}
/** events in (lo, hi] */
function countIn(a: readonly number[], lo: number, hi: number): number {
  return upperBound(a, hi) - upperBound(a, lo);
}
function hasNear(a: readonly number[], x: number, tol: number): boolean {
  const i = lowerBound(a, x - tol);
  return i < a.length && a[i] <= x + tol;
}

/** the share of evaluable events that must have a successor one lag later.
 * Measured 2026-09-15 on the owner's sessions: his 15-s pairs sit at
 * 0.80–0.88 at the true lag because rocks deplete and get retargeted every
 * minute or so; 0.9 left those sessions with no period, or a spurious long
 * one. Spurious short lags measured 0.45–0.73. */
export const SUPPORT_MIN = 0.8;

/**
 * The cycle length, from the events alone. A lag "qualifies" when at least
 * SUPPORT_MIN of the evaluable events (those whose successor would already
 * be due) have a successor one lag later, ±2 s. Because of that tolerance
 * the qualifying lags form a small plateau around the true cycle (178…182 s
 * for an exact 180); the estimate is the plateau's centre. Two guards
 * against coincidence: a lag must be judged on at least half the events
 * (and at least 3), and it may not exceed twice the 90th-percentile gap
 * between consecutive lines — a lag of minutes cannot be the cycle of a
 * stream that writes every few seconds. Null with fewer than 4 events in
 * the lookback, or when no lag qualifies (a transition in progress — the
 * caller keeps its previous estimate).
 */
export function estimatePeriod(events: readonly number[], now: number): number | null {
  const from = lowerBound(events, now - LOOKBACK_MS);
  const ts = events.slice(from, upperBound(events, now));
  if (ts.length < 4) return null;
  const gaps: number[] = [];
  for (let i = 1; i < ts.length; i++) gaps.push(ts[i] - ts[i - 1]);
  gaps.sort((a, b) => a - b);
  const p90 = gaps[Math.min(gaps.length - 1, Math.ceil(0.9 * gaps.length) - 1)];
  const maxLag = Math.min(MAX_PERIOD_MS, Math.max(MIN_PERIOD_MS, 2 * p90));
  const minEvaluable = Math.max(3, Math.ceil(ts.length / 2));
  const qualifies = (c: number): boolean | null => {
    let evaluable = 0, hits = 0;
    for (const t of ts) {
      if (t + c + TOL_MS > now) break;
      evaluable++;
      if (hasNear(ts, t + c, TOL_MS)) hits++;
    }
    if (evaluable < minEvaluable) return null;
    return hits >= SUPPORT_MIN * evaluable;
  };
  for (let c = MIN_PERIOD_MS; c <= maxLag; c += 1000) {
    const q = qualifies(c);
    if (q === null) return null;
    if (!q) continue;
    let hi = c;
    while (hi + 1000 <= maxLag && qualifies(hi + 1000) === true) hi += 1000;
    return Math.round((c + hi) / 2000) * 1000;
  }
  return null;
}

/** the anchored window length for a period */
export const windowFor = (period: number): number => Math.max(1000, WINDOW_PERIODS * period - WINDOW_SLACK_MS);

/** the start of the run the last event belongs to: walk back while
 * consecutive events are no more than a period apart */
export function runStart(events: readonly number[], period: number): number {
  let i = events.length - 1;
  while (i > 0 && events[i] - events[i - 1] <= period + TOL_MS) i--;
  return events[i];
}

const freshMiner = (charId: number, charName: string): MinerState => ({
  charId, charName, events: [], period: null, status: 'idle', cur: 0, peak: 0,
  active: false, quiet: false, quietSince: null, homeSystemId: null, homeShipTypeId: null,
  reducedSince: null, alertKind: null, alertSince: null,
});

const UNKNOWN_LOC: MinerLoc = { online: true, docked: false, systemId: null, shipTypeId: null };

/**
 * One step: fold new samples in, re-measure every miner, apply the crew
 * rules, and return the alerts to show. `locs` is what ESI says about each
 * character right now (absent = a character the app has no login for:
 * treated as online, undocked, location unknown — dock/move suppression
 * then cannot apply to them).
 */
export function updateWatch(
  prev: WatchState, samples: readonly MiningSample[], locs: ReadonlyMap<number, MinerLoc>, now: number,
  opts: WatchOptions = DEFAULT_WATCH_OPTIONS,
): { state: WatchState; alerts: MiningAlert[] } {
  const delay = Math.max(0, opts.delayMs);
  const dropRatio = Math.min(1, Math.max(0, opts.dropRatio));
  const byId = new Map<number, MinerState>();
  for (const m of prev.miners) byId.set(m.charId, { ...m, events: m.events.slice() });
  const touched = new Set<number>();
  for (const s of samples) {
    let m = byId.get(s.charId);
    if (!m) { m = freshMiner(s.charId, s.charName); byId.set(s.charId, m); }
    if (s.charName) m.charName = s.charName;
    m.events.push(s.t);
    touched.add(s.charId);
  }

  const miners: MinerState[] = [];
  for (const m of byId.values()) {
    const loc = locs.get(m.charId) ?? UNKNOWN_LOC;
    if (touched.has(m.charId)) m.events.sort((a, b) => a - b);
    // forget the old
    const keepFrom = lowerBound(m.events, now - KEEP_MS);
    if (keepFrom > 0) m.events = m.events.slice(keepFrom);
    // a ship change is a new fit: history discarded
    if (loc.shipTypeId !== null && m.homeShipTypeId !== null && loc.shipTypeId !== m.homeShipTypeId) {
      m.events = []; m.period = null; m.homeSystemId = null; m.homeShipTypeId = null;
    }
    if (touched.has(m.charId) && !loc.docked) {
      if (loc.systemId !== null) m.homeSystemId = loc.systemId;
      if (loc.shipTypeId !== null) m.homeShipTypeId = loc.shipTypeId;
    }
    m.active = false; m.quiet = false; m.quietSince = null; m.cur = 0; m.peak = 0;
    if (!loc.online || m.events.length === 0) {
      m.status = 'idle';
      // drop miners with nothing left to remember
      if (m.events.length === 0) continue;
      miners.push(m);
      continue;
    }
    const est = estimatePeriod(m.events, now);
    if (est !== null) m.period = est;
    if (m.period === null) { m.status = 'idle'; miners.push(m); continue; }
    const P = m.period;
    const w = windowFor(P);
    const last = m.events[m.events.length - 1];
    const gap = now - last;
    m.cur = countIn(m.events, last - w, last);
    const counts: number[] = [];
    for (const e of m.events) {
      if (e - w < now - KEEP_MS) continue;
      counts.push(countIn(m.events, e - w, e));
    }
    counts.sort((a, b) => a - b);
    m.peak = counts.length > 0 ? counts[Math.min(counts.length - 1, Math.ceil(PEAK_PERCENTILE * counts.length) - 1)] : 0;
    // still "a miner" while any two events are in memory (30 min): a
    // stopped alert must outlive the windows it was measured from
    m.active = m.events.length >= 2;
    const quietAfter = Math.max(P, QUIET_MIN_MS) + TOL_MS;
    m.quiet = gap > quietAfter;
    m.quietSince = m.quiet ? last + quietAfter : null;
    // silence for a whole period (never under 30 s) plus the reaction delay
    const stoppedAfter = quietAfter + delay;
    // a shortfall counts only once the current unbroken run is a whole
    // window long — right after a crew move the window is short of events
    // for a reason that is not a shutdown
    const shortfall = m.cur <= Math.min(m.peak - REDUCED_MIN_DROP, dropRatio * m.peak)
      && runStart(m.events, P) <= last - w;
    if (!m.active) { m.status = 'idle'; m.reducedSince = null; }
    else if (gap > stoppedAfter) { m.status = 'stopped'; m.reducedSince = null; }
    else if (shortfall) { m.status = 'reduced'; if (m.reducedSince === null) m.reducedSince = now; }
    else { m.status = 'ok'; m.reducedSince = null; }
    miners.push(m);
  }
  miners.sort((a, b) => a.charId - b.charId);

  // the crew rule: a stopped miner is named only while someone else in the
  // crew is still completing cycles. Nobody mining = the whole crew
  // stopped (or never started) — a move, an unload run — and the CEO's
  // rule says that is not worth a word.
  const activeMiners = miners.filter((m) => m.active && m.status !== 'idle');
  const fleetMove = !activeMiners.some((m) => !m.quiet);
  const fleet: FleetState = {
    fleetMove,
    moveEndedAt: prev.fleet.fleetMove && !fleetMove ? now : prev.fleet.moveEndedAt,
  };

  const alerts: MiningAlert[] = [];
  for (const m of miners) {
    const loc = locs.get(m.charId) ?? UNKNOWN_LOC;
    const last = m.events.length > 0 ? m.events[m.events.length - 1] : 0;
    if (m.status === 'stopped') {
      const moved = m.homeSystemId !== null && loc.systemId !== null && loc.systemId !== m.homeSystemId;
      const grace = fleet.moveEndedAt !== null && last < fleet.moveEndedAt
        && now < fleet.moveEndedAt + Math.max(MOVE_GRACE_MIN_MS, MOVE_GRACE_PERIODS * (m.period as number));
      if (loc.docked || moved || fleetMove || grace) { m.alertKind = null; m.alertSince = null; continue; }
      const since = m.alertKind === 'stopped' && m.alertSince !== null ? m.alertSince : now;
      m.alertKind = 'stopped'; m.alertSince = since;
      if (now - since <= opts.keepStoppedMs) alerts.push({ charId: m.charId, charName: m.charName, kind: 'stopped', since });
    } else if (m.status === 'reduced' && !loc.docked && !m.quiet && m.reducedSince !== null && now - m.reducedSince >= delay) {
      // (!quiet: a miner whose lines have already stopped is on the way to
      // "stopped" — naming a rate drop for one tick first is a flicker,
      // measured at the end of real sessions)
      const since = m.alertKind === 'reduced' && m.alertSince !== null ? m.alertSince : m.reducedSince + delay;
      m.alertKind = 'reduced'; m.alertSince = since;
      alerts.push({ charId: m.charId, charName: m.charName, kind: 'reduced', since });
    } else {
      m.alertKind = null; m.alertSince = null;
    }
  }
  alerts.sort((a, b) => (a.kind === b.kind ? b.since - a.since : a.kind === 'stopped' ? -1 : 1));
  return { state: { miners, fleet }, alerts };
}

/** the on-screen line for an alert */
export function alertText(a: MiningAlert, now: number): string {
  const min = Math.max(0, Math.floor((now - a.since) / 60_000));
  const age = min === 0 ? 'just now' : `${min} min`;
  return a.kind === 'stopped' ? `not mining · ${age}` : `rate down · ${age}`;
}
