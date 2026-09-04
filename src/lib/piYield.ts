// EXTRACTOR YIELD — CCP's own published formula, implemented verbatim.
//
// Source: EVE Developer Documentation, "Planetary Industry" guide
// (developers.eveonline.com/docs/guides/pi/), read 2026-08-31. The guide
// feeds ESI extractor_details fields straight into this code, which settles
// a fact the app previously got WRONG: ESI's qty_per_cycle is the BASE
// value of a decaying wobble curve, NOT the per-cycle amount. The real
// yield of cycle i is
//
//   barWidth  = cycle_time / 900            (cycle length in 15-min units)
//   t         = (i + 0.5) * barWidth
//   decay     = qty_per_cycle / (1 + t * 0.012)
//   phase     = qty_per_cycle ** 0.7
//   sinStuff  = max((cos(phase + t/12) + cos(phase/2 + t/5) + cos(t/2)) / 3, 0)
//   yield_i   = floor(barWidth * decay * (1 + 0.8 * sinStuff))
//
// Per-hour truth is ~4 * qty * decay*wobble regardless of cycle length
// (barWidth cancels), while the old qty_per_cycle * 3600/cycle_time figure
// varies with the cycle chosen — probed against this implementation it runs
// 1.19x low (30min cycles, 2d) to 2.38x low (1h cycles, 2d) across common
// programs. Same formula, measured 2026-08-31.
//
// CALIBRATION: the in-game program window draws exactly these per-cycle
// bars, so one side-by-side look at any live program confirms (or refutes)
// this implementation against the client. Until then the numbers carry the
// confidence of official documentation, not of an in-game measurement.

const DECAY_FACTOR = 0.012;
const NOISE_FACTOR = 0.8;

/** per-cycle yields for a whole program — the in-game bar chart */
export function yieldSchedule(qtyPerCycle: number, cycleTimeSec: number, durationSec: number): number[] {
  if (qtyPerCycle <= 0 || cycleTimeSec <= 0 || durationSec <= 0) return [];
  const cycles = Math.floor(durationSec / cycleTimeSec);
  const barWidth = cycleTimeSec / 900;
  const phase = Math.pow(qtyPerCycle, 0.7);
  const out: number[] = [];
  for (let i = 0; i < cycles; i++) {
    const t = (i + 0.5) * barWidth;
    const decay = qtyPerCycle / (1 + t * DECAY_FACTOR);
    const sinStuff = Math.max(
      (Math.cos(phase + t * (1 / 12)) + Math.cos(phase / 2 + t * (1 / 5)) + Math.cos(t * 0.5)) / 3,
      0,
    );
    out.push(Math.floor(barWidth * decay * (1 + NOISE_FACTOR * sinStuff)));
  }
  return out;
}

/** whole-program average rate — the honest number to balance factories
 * against, because the cheap-to-store P0 buffer smooths the wobble and the
 * early-heavy/late-light decay across the program */
export function programAvgPerHour(qtyPerCycle: number, cycleTimeSec: number, durationSec: number): number {
  const sched = yieldSchedule(qtyPerCycle, cycleTimeSec, durationSec);
  if (sched.length === 0) return 0;
  const hours = (sched.length * cycleTimeSec) / 3600;
  return sched.reduce((a, b) => a + b, 0) / hours;
}
