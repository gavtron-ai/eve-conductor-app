// RAID HISTORY — who is actually getting robbed, measured not guessed.
//
// The raidable-skyhook feed is a ROLLING list: a skyhook appears when its
// theft window opens (or is about to) and drops out when the window ends —
// OR when the silo is emptied. So diffing consecutive snapshots yields real
// observations:
//   · vanished while its window still had time left  → RAIDED by someone
//   · still present when the window elapsed          → SURVIVED untouched
// That is the same transitions-not-state-dumps discipline the market radar
// uses, and it needs no authentication.
//
// HONEST CAVEATS (stated in the UI too): a mid-window disappearance is
// almost certainly a raid, but could also be the structure dying or being
// unanchored. Nothing tells us WHO raided it. Observations are only made
// between two SUCCESSFUL fetches — a failed poll never invents an event.
//
// ESS has no ESI data at all, so its "history" is only what the user logs
// by hand (kind 'mine'), clearly labelled as self-reported.
import { fetchRaidableSkyhooksMeta, type RaidableSkyhook } from './theft';
import { logInfo, logWarn } from './devlog';

/** MEASURED 2026-08-30: the feed is server-cached max-age=300 (a new body
 * every ~5 min). Polling at HALF that period guarantees we see EVERY
 * server snapshot, so the removal interval between consecutive
 * Last-Modified stamps is one server period (~5 min), not two. */
export const RAID_WATCH_INTERVAL_MS = 150_000;
const FILE = 'theft-raids.ndjson';
const WIP = 'theft-wip.json';
/** the end-of-window ambiguity experiment + full verdict audit trail —
 * NDJSON in the Do-Not-Delete stats dir, one object per line */
const EXP_FILE = 'theft-raid-experiment.ndjson';
/** a removal observed this close to the boundary could be CCP clock jitter
 * rather than a raid */
const END_GRACE_MS = 90_000;
/** a window whose final stretch went UNOBSERVED longer than this cannot
 * honestly be called survived — one server period plus slack. Beyond it
 * the verdict is 'unknown'. */
const HONEST_TAIL_MS = 7 * 60_000;

export interface RaidEvent {
  /** ms epoch of the observation */
  t: number;
  planetId: number;
  systemId: number;
  /** raided = vanished mid-window · survived = window elapsed while listed
   *  (late raid inside the final blindTailMin+link-time NOT ruled out) ·
   *  unknown = the close was not observed well enough to call either way
   *  (the "showed up at the end, linked, stole after the timer" gap) ·
   *  mine = the user marked it themselves · bar = a manual bar reading */
  kind: 'raided' | 'survived' | 'mine' | 'unknown' | 'bar';
  /** minutes from window start to the observation (raided only) */
  intoWindowMin?: number;
  /** window length in minutes (raided/survived/unknown) */
  windowMin?: number;
  /** minutes of the window's tail that went unobserved before its end —
   * the span a late raid could hide in (survived/unknown) */
  blindTailMin?: number;
  /** user note (mine only) */
  note?: string;
  /** filled tics of the surplus bar, 0–125 (bar only) */
  tics?: number;
  /** an 'unknown' later resolved by evidence records how */
  resolvedBy?: 'bar';
  /** a STEALTH RAID: this event was recorded 'survived' from the feed and
   * later overturned by a bar reading — the raider linked near the end
   * and finished after the timer, invisible to every feed tracker. The
   * count of these IS the measured invisible-raid rate. */
  wasKind?: 'survived';
}

let events: RaidEvent[] | null = null;
let prevSnap: Map<number, RaidableSkyhook> | null = null;
/** WHEN prevSnap was taken. A diff is only evidence about the span between
 * two LOOKS — without this the watcher could not tell a 5-minute gap from an
 * overnight one, and wrote both into the permanent log as if it had been
 * watching the whole time. */
let prevSnapAt = 0;

/**
 * The widest gap between two looks that still supports a verdict. Past this
 * the app was simply not watching, and BOTH conclusions become fabrications:
 *  - a skyhook whose window elapsed unseen is written 'survived' when it may
 *    well have been robbed — the exact inversion of the signal;
 *  - one that vanished mid-window is written 'raided' with intoWindowMin
 *    measured from the RECOVERY tick, inflating the "hit fast (~Nm)" median
 *    the user times his own runs by.
 * Rule 3: record NOTHING rather than a misleading value. Re-baseline instead.
 */
const MAX_DIFF_GAP_MS = 3 * RAID_WATCH_INTERVAL_MS;

async function loadEvents(): Promise<RaidEvent[]> {
  if (events) return events;
  events = [];
  const bridge = window.appInfo?.stats;
  if (bridge) {
    try {
      const raw = await bridge.auxRead(FILE);
      if (raw) {
        for (const line of raw.split('\n')) {
          if (!line.trim()) continue;
          try {
            events.push(JSON.parse(line) as RaidEvent);
          } catch {
            // skip a corrupt line rather than lose the file
          }
        }
      }
    } catch {
      // no history yet
    }
  }
  return events;
}

async function appendEvents(list: RaidEvent[]): Promise<void> {
  if (list.length === 0) return;
  (await loadEvents()).push(...list);
  const bridge = window.appInfo?.stats;
  if (bridge) {
    try {
      await bridge.auxAppend(FILE, list.map((e) => JSON.stringify(e)));
    } catch {
      // in-memory history still works this session
    }
  }
}

/** the raw observation log (oldest first) */
export async function raidEvents(): Promise<RaidEvent[]> {
  return [...(await loadEvents())];
}

/**
 * PURE: diff two consecutive feed snapshots into observations.
 *
 * `prevObsMs`/`currObsMs` are the SERVER's Last-Modified stamps for each
 * snapshot (fetch-time fallback): a removal happened somewhere inside
 * (prevObsMs, currObsMs]. Verdicts (v0.176, closing the "linked at the
 * end, stole after the timer" mislabel — that case was written 'survived'):
 *   · removal complete ≥90s BEFORE the window end     → raided (definitive)
 *   · boundary straddled, tail watched (≤7 min blind) → survived, with the
 *     blind tail recorded — a late raid inside it is NOT ruled out
 *   · tail unobserved (>7 min blind), or the entry was
 *     listed clearly PAST its end before vanishing    → unknown
 */
export function diffRaidSnapshots(
  prev: Map<number, RaidableSkyhook>,
  curr: Map<number, RaidableSkyhook>,
  prevObsMs: number,
  currObsMs: number,
): RaidEvent[] {
  const out: RaidEvent[] = [];
  for (const [planetId, was] of prev) {
    if (curr.has(planetId)) continue; // still listed — nothing concluded yet
    if (currObsMs < was.startMs) continue; // vanished before its window even opened
    const windowMin = Math.max(0, Math.round((was.endMs - was.startMs) / 60_000));
    const blindTailMin = Math.max(0, Math.round((was.endMs - prevObsMs) / 60_000));
    if (currObsMs <= was.endMs - END_GRACE_MS) {
      out.push({
        t: currObsMs, planetId, systemId: was.systemId, kind: 'raided',
        intoWindowMin: Math.max(0, Math.round((currObsMs - was.startMs) / 60_000)),
        windowMin,
      });
    } else if (prevObsMs > was.endMs + END_GRACE_MS) {
      // it was listed clearly PAST its own end and then vanished — the
      // signature a link-in-progress WOULD leave if CCP keeps linked hooks
      // listed (the running experiment settles whether that mechanic
      // exists; until then this is honestly unknown)
      out.push({ t: was.endMs, planetId, systemId: was.systemId, kind: 'unknown', blindTailMin: 0, windowMin });
    } else if (blindTailMin * 60_000 <= HONEST_TAIL_MS) {
      out.push({ t: was.endMs, planetId, systemId: was.systemId, kind: 'survived', blindTailMin, windowMin });
    } else {
      out.push({ t: was.endMs, planetId, systemId: was.systemId, kind: 'unknown', blindTailMin, windowMin });
    }
  }
  return out;
}

/** Last-Modified of the snapshot prevSnap came from (0 = unknown/legacy) */
let prevSnapLM = 0;

/** append raw lines to the experiment audit file — analysis-grade detail
 * the compact events file does not carry */
async function expLog(rows: object[]): Promise<void> {
  if (rows.length === 0) return;
  const bridge = window.appInfo?.stats;
  if (!bridge) return;
  try {
    await bridge.auxAppend(EXP_FILE, rows.map((r) => JSON.stringify(r)));
  } catch { /* audit trail is best-effort */ }
}

/** one watcher pass: snapshot the feed, record what changed */
export async function runRaidWatchTick(): Promise<number> {
  const { list, lastModifiedMs } = await fetchRaidableSkyhooksMeta(); // throws → caller skips, no events
  const curr = new Map(list.map((s) => [s.planetId, s]));
  let recorded = 0;
  const now = Date.now();
  const currLM = lastModifiedMs ?? now;
  // THE EXPERIMENT: is a skyhook with a theft link IN PROGRESS kept listed
  // past its window end? Any entry the SERVER (not our stale fetch) shows
  // beyond its own end is the evidence — logged every pass, checked later.
  const pastEnd = list.filter((s) => currLM > s.endMs + 30_000);
  if (pastEnd.length > 0) {
    logInfo('raidwatch', 'EXPERIMENT: entries listed PAST their window end', {
      lm: new Date(currLM).toISOString(),
      entries: pastEnd.map((s) => `${s.systemId}/${s.planetId} end ${new Date(s.endMs).toISOString()} (+${Math.round((currLM - s.endMs) / 1000)}s)`),
    });
  }
  await expLog([{
    k: 'tick', t: now, lm: currLM, listed: list.length,
    open: list.filter((s) => currLM >= s.startMs && currLM < s.endMs).length,
    pastEnd: pastEnd.map((s) => ({ p: s.planetId, sys: s.systemId, end: s.endMs, overBySec: Math.round((currLM - s.endMs) / 1000) })),
  }]);

  if (prevSnap && currLM <= prevSnapLM && prevSnapLM !== 0) {
    // SAME server snapshot as last time (the 5-min cache) — no new
    // information; only our look time advances
    prevSnapAt = now;
    return 0;
  }
  if (prevSnap && now - prevSnapAt <= MAX_DIFF_GAP_MS) {
    const prevLM = prevSnapLM !== 0 ? prevSnapLM : prevSnapAt;
    const evs = diffRaidSnapshots(prevSnap, curr, prevLM, currLM);
    if (evs.length > 0) {
      await appendEvents(evs);
      recorded = evs.length;
      // the audit trail carries the full interval every verdict rests on
      await expLog(evs.map((e) => ({ k: 'verdict', ...e, prevLM, currLM })));
      logInfo('raidwatch', `recorded ${evs.length} verdict(s)`, {
        verdicts: evs.map((e) => `${e.systemId}/${e.planetId}: ${e.kind}${e.kind === 'raided' ? ` @${e.intoWindowMin}m/${e.windowMin}m` : ''}${e.blindTailMin !== undefined ? ` blindTail ${e.blindTailMin}m` : ''}`),
      });
    }
  } else if (prevSnap) {
    // NEVER SILENTLY. The gap is why nothing was recorded, and that is worth
    // saying — a quiet skip reads identically to "nothing happened".
    logWarn('raidwatch', 'gap too wide — re-baselining WITHOUT recording', {
      gapMin: Math.round((now - prevSnapAt) / 60_000),
      limitMin: MAX_DIFF_GAP_MS / 60_000,
      why: 'windows that elapsed unseen cannot honestly be called survived or raided',
    });
    await expLog([{ k: 'gap', t: now, gapMin: Math.round((now - prevSnapAt) / 60_000) }]);
  }
  prevSnap = curr;
  prevSnapAt = now;
  prevSnapLM = currLM;
  const bridge = window.appInfo?.stats;
  if (bridge) {
    try {
      await bridge.auxWrite(WIP, JSON.stringify({ t: Date.now(), lm: currLM, snap: [...curr.values()] }));
    } catch {
      // wip is a nicety
    }
  }
  return recorded;
}

/** restore the last snapshot after a restart so the first diff still works */
export async function restoreRaidWip(): Promise<void> {
  const bridge = window.appInfo?.stats;
  if (!bridge || prevSnap) return;
  try {
    const raw = await bridge.auxRead(WIP);
    if (!raw) return;
    const wip = JSON.parse(raw) as { t: number; snap: RaidableSkyhook[] };
    // The old rule here trusted anything under 6 HOURS, which is far wider
    // than a raid window — a snapshot that stale can only produce invented
    // verdicts. Restore it with its real age and let the same gap rule in
    // runRaidWatchTick decide whether it may be diffed at all; a stale one
    // still seeds the baseline so the NEXT pair of looks is usable.
    if (typeof wip.t === 'number' && Array.isArray(wip.snap)) {
      prevSnap = new Map(wip.snap.map((s) => [s.planetId, s]));
      prevSnapAt = wip.t;
      prevSnapLM = typeof (wip as { lm?: number }).lm === 'number' ? (wip as { lm?: number }).lm! : 0;
    }
  } catch {
    // fine — the next two ticks rebuild the baseline
  }
}

export interface RaidStats {
  /** completed windows we actually observed the end of (unknowns excluded) */
  observed: number;
  raided: number;
  /** raided / observed — null until at least one full window was seen */
  raidRate: number | null;
  /** median minutes into the window when raiders hit it */
  medianIntoWindowMin: number | null;
  lastRaidedMs: number | null;
  /** window closes we could NOT call either way — a late raid may hide here */
  unknown: number;
  lastUnknownMs: number | null;
  /** feed-'survived' verdicts OVERTURNED by a bar reading — raids that
   * finished after the window closed, invisible to every feed tracker.
   * This count is the measured stealth-raid rate. */
  stealthRaids: number;
  /** share of OBSERVED raids landing in the final 15 min of their window —
   * how often the "linked at the end" pattern actually occurs here */
  lateRaidShare: number | null;
  /** the user's own marked raids */
  mine: number;
  lastMineMs: number | null;
  /** the OLDEST observation of this target — how far back the watch goes */
  firstSeenMs: number | null;
}

const EMPTY: RaidStats = {
  observed: 0, raided: 0, raidRate: null, medianIntoWindowMin: null,
  lastRaidedMs: null, unknown: 0, lastUnknownMs: null, stealthRaids: 0,
  lateRaidShare: null, mine: 0, lastMineMs: null, firstSeenMs: null,
};

function summarize(list: RaidEvent[]): RaidStats {
  const raided = list.filter((e) => e.kind === 'raided');
  const survived = list.filter((e) => e.kind === 'survived');
  const unknown = list.filter((e) => e.kind === 'unknown');
  const mine = list.filter((e) => e.kind === 'mine');
  const observed = raided.length + survived.length;
  const mins = raided.map((e) => e.intoWindowMin ?? 0).sort((a, b) => a - b);
  const late = raided.filter((e) =>
    e.windowMin !== undefined && e.intoWindowMin !== undefined && e.windowMin - e.intoWindowMin <= 15);
  return {
    observed,
    raided: raided.length,
    raidRate: observed > 0 ? raided.length / observed : null,
    medianIntoWindowMin: mins.length > 0 ? mins[Math.floor(mins.length / 2)] : null,
    lastRaidedMs: raided.length > 0 ? Math.max(...raided.map((e) => e.t)) : null,
    unknown: unknown.length,
    lastUnknownMs: unknown.length > 0 ? Math.max(...unknown.map((e) => e.t)) : null,
    stealthRaids: raided.filter((e) => e.wasKind === 'survived').length,
    lateRaidShare: raided.length > 0 ? late.length / raided.length : null,
    mine: mine.length,
    lastMineMs: mine.length > 0 ? Math.max(...mine.map((e) => e.t)) : null,
    firstSeenMs: list.length > 0 ? Math.min(...list.map((e) => e.t)) : null,
  };
}

/** per-skyhook (planet) history and per-system history, from the whole log */
export async function raidHistory(): Promise<{
  byPlanet: Map<number, RaidStats>;
  bySystem: Map<number, RaidStats>;
}> {
  const all = await loadEvents();
  const byPlanetEv = new Map<number, RaidEvent[]>();
  const bySystemEv = new Map<number, RaidEvent[]>();
  for (const e of all) {
    (byPlanetEv.get(e.planetId) ?? byPlanetEv.set(e.planetId, []).get(e.planetId)!).push(e);
    (bySystemEv.get(e.systemId) ?? bySystemEv.set(e.systemId, []).get(e.systemId)!).push(e);
  }
  const byPlanet = new Map<number, RaidStats>();
  for (const [k, v] of byPlanetEv) byPlanet.set(k, summarize(v));
  const bySystem = new Map<number, RaidStats>();
  for (const [k, v] of bySystemEv) bySystem.set(k, summarize(v));
  return { byPlanet, bySystem };
}

export const emptyStats = (): RaidStats => ({ ...EMPTY });

/** the user marking a target they hit themselves (skyhook: planetId; ESS: 0) */
export async function markRaidedByMe(systemId: number, planetId = 0, note?: string): Promise<void> {
  await appendEvents([{ t: Date.now(), planetId, systemId, kind: 'mine', note }]);
}

// ---------------------------------------------------------------------------
// BAR READINGS — ground truth resolving 'unknown' window closes.
// The surplus bar fills ~1 tic/day on a ~125-tic gauge (measured, the
// v0.140 calibration campaign), so a single in-game reading dates the last
// emptying: R filled tics at time T ⇒ last emptied ≈ T − R days.
// ---------------------------------------------------------------------------

const TIC_MS = 24 * 3600_000; // 1 tic ≈ 1 day
const BAR_TOL_MS = 1.5 * TIC_MS;

/**
 * PURE: resolve this planet's events against a bar reading.
 *   · unknown at ≈ (T − R days)      → that WAS the emptying → raided
 *   · unknown AFTER the last emptying → nothing was taken then → survived
 *   · unknown before it              → an emptying happened later; the
 *     older close stays honestly unresolved
 *   · SURVIVED at ≈ the emptying     → the feed was WRONG — a stealth
 *     raid (linked near the end, finished after the timer, invisible to
 *     every tracker). Overturned to raided with wasKind:'survived'; the
 *     count of these flips is the MEASURED invisible-raid rate. (v0.178,
 *     after the user found a "should be very full" silo at ~2%: observed
 *     raid timing is survivorship-biased — raiders who know these feeds
 *     are tracked can hide on purpose, so 'survived' is falsifiable
 *     evidence, never settled truth.)
 */
export function resolveWithBar(
  list: RaidEvent[], planetId: number, readMs: number, tics: number,
): { resolved: RaidEvent[]; changed: number; stealthConfirmed: number } {
  const lastEmptiedEst = readMs - tics * TIC_MS;
  let changed = 0;
  let stealthConfirmed = 0;
  const resolved = list.map((e) => {
    if (e.planetId !== planetId || e.t > readMs) return e;
    if (e.kind === 'unknown') {
      if (Math.abs(e.t - lastEmptiedEst) <= BAR_TOL_MS) {
        changed += 1;
        return { ...e, kind: 'raided' as const, resolvedBy: 'bar' as const };
      }
      if (e.t > lastEmptiedEst + BAR_TOL_MS) {
        changed += 1;
        return { ...e, kind: 'survived' as const, resolvedBy: 'bar' as const };
      }
      return e;
    }
    if (e.kind === 'survived' && e.resolvedBy === undefined
      && Math.abs(e.t - lastEmptiedEst) <= BAR_TOL_MS) {
      changed += 1;
      stealthConfirmed += 1;
      return { ...e, kind: 'raided' as const, resolvedBy: 'bar' as const, wasKind: 'survived' as const };
    }
    return e;
  });
  return { resolved, changed, stealthConfirmed };
}

/** record an in-game bar reading and let it resolve past unknowns AND
 * overturn feed-'survived' verdicts a stealth raid falsified; the events
 * file is rewritten in place (memory + disk stay in step) */
export async function applyBarReading(systemId: number, planetId: number, tics: number): Promise<number> {
  const all = await loadEvents();
  const readMs = Date.now();
  const { resolved, changed, stealthConfirmed } = resolveWithBar(all, planetId, readMs, tics);
  events = resolved;
  await appendEvents([{ t: readMs, planetId, systemId, kind: 'bar', tics }]);
  const bridge = window.appInfo?.stats;
  if (bridge && changed > 0) {
    try {
      await bridge.auxWrite(FILE, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
    } catch { /* memory is already consistent; disk catches up next append */ }
  }
  if (stealthConfirmed > 0) {
    logWarn('raidwatch', `STEALTH RAID CONFIRMED by bar reading on ${systemId}/${planetId}`, {
      tics, lastEmptiedEst: new Date(readMs - tics * TIC_MS).toISOString(),
      flips: stealthConfirmed,
      meaning: 'the feed recorded survived; the bar proves it was emptied — a link finished after the window closed',
    });
    await expLog([{ k: 'stealth', t: readMs, planetId, systemId, tics, flips: stealthConfirmed }]);
  }
  logInfo('raidwatch', `bar reading ${tics} tics on ${systemId}/${planetId}`, {
    lastEmptiedEst: new Date(readMs - tics * TIC_MS).toISOString(),
    resolved: changed, stealthConfirmed,
  });
  return changed;
}

// ---------------------------------------------------------------------------
// BANKED ESTIMATE. The game mechanics that make this honest (EVE University's
// Orbital Skyhook page + CCP's Skyhook Enhancements patch notes/FAQ, re-checked
// 2026-08-22): a skyhook harvests continuously; HALF of all production lands in
// the Surplus Bay; a successful raid takes the ENTIRE Surplus Bay; the theft
// window recurs every 3–4 DAYS. CCP publishes NO units-per-hour rate, so the
// app measures the one thing it truly knows — TIME banked since the silo was
// last known empty — and never invents units.
//
// THE FILL CURVE (this is what v0.109 got wrong, and what daily raiding exposed
// — fixed v0.131): the surplus accumulates ~LINEARLY, and one window's worth
// (~3–4 days) is ONE standard raidable haul. Crucially, if a window is skipped
// the surplus ROLLS OVER and KEEPS accumulating with no published cap — CCP:
// the next window "would have 6-8 days worth of reagents inside AND SO ON". So
// banked loot ≈ days-since-empty ÷ one cycle, measured in *standard hauls*, and
// it is UNBOUNDED — NOT a 0–100% fraction of some fixed max. The old model
// pegged 100% at 7 days (two cycles) and clamped there: it showed a fully
// raidable one-cycle skyhook as "50%" (telling you to wait on a target already
// worth hitting) and made a 30-day hoard look identical to a 7-day one.
//
// The estimate is an UPPER BOUND, for two stated reasons:
//  · the owner can empty their own skyhook at any time, invisibly to us;
//  · a raid during a watcher gap (app offline) is unobserved.
// The verdict column carries the counterweight: 'usually survives' + zero
// activity means nobody is emptying it, which is when the bound is tight.
// ---------------------------------------------------------------------------

/**
 * The theft window recurs every 3–4 days; the surplus that has piled up between
 * windows is ONE standard raidable haul. Midpoint of the 3–4 day range — the
 * unit the fill bar is denominated in ("1 haul" / "100%"). The surplus keeps
 * accumulating past one cycle with no cap, so the bar reads past 100%.
 */
export const SKYHOOK_CYCLE_DAYS = 3.5;

/** Banked loot as a MULTIPLE of one standard (single-window) haul, from the
 * days-since-empty. 1.0 = a normal full haul ready; 2.0 = a skipped window's
 * worth; unbounded (the surplus rolls over and keeps stacking under the hood). */
export function bankCycles(days: number): number {
  return Math.max(0, days) / SKYHOOK_CYCLE_DAYS;
}

/**
 * DAYS for the in-game Surplus Bay bar to fill 0→100%. MEASURED, not guessed:
 * the owner paired pixel-counted bar readings with app-witnessed raid dates on
 * four skyhooks (2026-08-23/24) and they agree on ONE linear rate — the bar is
 * a day-counter, ~1 tic/day on its ~125-tic gauge:
 *   planet A : raid seen  3.25 d ago →   3 tics (live in-game count)
 *   planet B : raid seen 15.35 d ago → ~15.7 tics (12.4%)
 *   planet C : raid seen 27.0  d ago → ~27 tics (22%)
 *   planet D : ~40 tics (32%) with no raid seen in 30 d of watching —
 *              consistent (raided ~10 d before the watch began)
 * One theft window (~3.5 d) is therefore only ~3% of the bar — a "full" bar
 * means ~4 MONTHS of surplus.
 */
export const SKYHOOK_BAR_DAYS_TO_FULL = 125;

/**
 * The IN-GAME silo bar, mirrored. When you warp to a skyhook its model shows a
 * fill bar for the Surplus Bay that CANNOT read over 100% (observed in game).
 * Clamped to [0,100]: ~0.8%/day (1 tic/day), pinning at 100% after ~125 days
 * just like the real bar. The "Last raided" age carries what the bar can't.
 */
export function barFillPct(days: number): number {
  return Math.round(Math.min(1, Math.max(0, days) / SKYHOOK_BAR_DAYS_TO_FULL) * 100);
}

/** ms of the last time the silo was KNOWN empty — an observed raid or your own
 * "I raided it" mark, whichever is newer; 0 if never seen emptied. Anchors both
 * the bank estimate and the "Last raided" column. */
export function lastEmptiedMs(s: RaidStats): number {
  return Math.max(s.lastRaidedMs ?? 0, s.lastMineMs ?? 0);
}

export interface BankEstimate {
  /** days since the silo was last KNOWN empty (observed raid, or your own) */
  days: number;
  /** true = anchored to a witnessed raid; false = never seen raided, so
   * `days` is only "days of watching without a raid" (a weaker floor) */
  anchored: boolean;
}

/** PURE: time banked in the surplus bay, from measured history. null = the
 * watcher has never observed this skyhook at all. */
export function bankEstimate(s: RaidStats, nowMs: number): BankEstimate | null {
  const emptied = Math.max(s.lastRaidedMs ?? 0, s.lastMineMs ?? 0);
  if (emptied > 0) return { days: (nowMs - emptied) / 86_400_000, anchored: true };
  if (s.firstSeenMs !== null) return { days: (nowMs - s.firstSeenMs) / 86_400_000, anchored: false };
  return null;
}

/**
 * Raid-worthiness verdict from measured history. Fast, frequent raids mean
 * the silo is usually empty by the time you arrive; a long survival record
 * means an uncontested full silo.
 */
export function raidVerdict(s: RaidStats): { txt: string; cls: string; tip: string } | null {
  if (s.observed < 2) {
    if (s.observed === 0 && s.unknown > 0) {
      return {
        txt: '· unresolved',
        cls: 'dim',
        tip: `${s.unknown} window close(s) could not be called either way (the tail was not observed cleanly — a late link finishing after the timer hides exactly there). A bar reading resolves them.`,
      };
    }
    return s.observed === 0
      ? null
      : {
          txt: '· learning',
          cls: 'dim',
          tip: `Only ${s.observed} completed window observed so far — the app needs a few more before it will call this contested or quiet.`,
        };
  }
  const rate = s.raidRate ?? 0;
  const med = s.medianIntoWindowMin;
  if (rate >= 0.6) {
    return {
      txt: med !== null ? `🩸 hit fast (~${med}m)` : '🩸 contested',
      cls: 'flag warn',
      tip: `Raided in ${s.raided} of ${s.observed} observed windows${med !== null ? `, typically ~${med} minutes after the window opens` : ''}. Rivals farm this one — expect an empty silo unless you are early.`,
    };
  }
  if (rate <= 0.2) {
    return {
      txt: '🕊 usually survives',
      cls: 'flag good',
      tip: `Only ${s.raided} of ${s.observed} observed windows were raided — nobody local is farming it, so the silo is usually still full. Best value per trip.`,
    };
  }
  return {
    txt: `⚖ ${Math.round(rate * 100)}% raided`,
    cls: 'flag info',
    tip: `Raided in ${s.raided} of ${s.observed} observed windows${med !== null ? ` (median ~${med}m in)` : ''}.`,
  };
}
