// Fixtures for src/lib/piYield.ts — CCP's published extractor yield formula.
//
// The reference values here are re-derived INLINE from the official dev-docs
// formula (developers.eveonline.com/docs/guides/pi/, read 2026-08-31),
// independently of the lib's code, so a transcription slip in either place
// shows up as a mismatch. The ground truth beyond that is the in-game
// program window, whose bar chart is this exact formula.

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : `   ${extra}`}`);
  cond ? pass++ : fail++;
};
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

const Y = require('./pi/piYield.js');

// ---- the dev-docs worked example: 171000s at 1800s cycles = 95 cycles ----
const sched = Y.yieldSchedule(6965, 1800, 171000);
eq('the dev-docs example program has 95 cycles', sched.length, 95);

// ---- cycle 0 and cycle 40, re-derived inline from the published formula --
const ref = (q, cycleSec, i) => {
  const barWidth = cycleSec / 900;
  const t = (i + 0.5) * barWidth;
  const decay = q / (1 + t * 0.012);
  const phase = Math.pow(q, 0.7);
  const sinStuff = Math.max(
    (Math.cos(phase + t / 12) + Math.cos(phase / 2 + t / 5) + Math.cos(t / 2)) / 3, 0);
  return Math.floor(barWidth * decay * (1 + 0.8 * sinStuff));
};
eq('cycle 0 matches the formula re-derived inline', sched[0], ref(6965, 1800, 0));
eq('cycle 40 matches too', sched[40], ref(6965, 1800, 40));
eq('...and the last cycle', sched[94], ref(6965, 1800, 94));

// ---- structural truths of the curve -------------------------------------
ok('every per-cycle yield is a non-negative integer',
  sched.every((y) => Number.isInteger(y) && y >= 0));
const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
ok('extraction DECAYS: first tenth of the program out-yields the last tenth',
  avg(sched.slice(0, 9)) > avg(sched.slice(-9)),
  `first=${avg(sched.slice(0, 9))} last=${avg(sched.slice(-9))}`);
// sin_stuff is in [0,1], so cycle 0 is bounded by barWidth*decay0*[1, 1.8]
const bw = 2, decay0 = 6965 / (1 + 1 * 0.012);
ok('cycle 0 sits inside the wobble envelope',
  sched[0] >= Math.floor(bw * decay0) - 1 && sched[0] <= bw * decay0 * 1.8,
  `y0=${sched[0]} env=[${Math.floor(bw * decay0)}, ${Math.round(bw * decay0 * 1.8)}]`);

// ---- the magnitude fact that motivated the fix ---------------------------
// per-hour truth ~ 4*q*decay*wobble regardless of cycle length (barWidth
// cancels), while the old qty*3600/cycle "nominal" varies with the cycle
// chosen. Measured against this implementation 2026-08-31:
//   30min cycles / 2d -> nominal 1.19x low   1h cycles / 2d -> 2.38x low
const avgPerHour = Y.programAvgPerHour(6965, 1800, 171000);
const nominal = 6965 * (3600 / 1800);
ok('the dev-docs example: nominal runs ~1.19x low', avgPerHour / nominal > 1.1 && avgPerHour / nominal < 1.3,
  `ratio=${(avgPerHour / nominal).toFixed(2)}`);
ok('per-hour average is (nearly) cycle-independent: 30min vs 1h within 2%',
  Math.abs(Y.programAvgPerHour(6965, 3600, 2 * 86400) / Y.programAvgPerHour(6965, 1800, 2 * 86400) - 1) < 0.02);
ok('1h-cycle nominal (q/h) understates the 2-day truth >2x',
  Y.programAvgPerHour(6965, 3600, 2 * 86400) / 6965 > 2.2);
ok('...but bounded by the theoretical ceiling 4*q*1.8/h',
  avgPerHour < 4 * 6965 * 1.8);

// ---- programAvgPerHour is exactly schedule-sum over schedule-hours -------
const hours = (95 * 1800) / 3600;
ok('avg/h == sum(schedule)/hours', Math.abs(avgPerHour - sched.reduce((a, b) => a + b, 0) / hours) < 1e-9);

// ---- degenerate inputs stay silent ---------------------------------------
eq('zero quantity -> empty schedule', Y.yieldSchedule(0, 1800, 171000), []);
eq('zero duration -> empty schedule', Y.yieldSchedule(6965, 1800, 0), []);
eq('zero qty -> 0 avg', Y.programAvgPerHour(0, 1800, 171000), 0);
ok('a shorter-than-one-cycle program yields nothing', Y.yieldSchedule(6965, 1800, 900).length === 0);

console.log(`piyield.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
