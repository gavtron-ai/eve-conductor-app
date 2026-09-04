// Fixtures for normalizedRates() in the SHIPPED radar.ts.
//
// THE POINT: the user wants the market sweep slowed down as much as the ESI
// budget needs, "as long as we account for the adjustment in the data".
// Coverage used to be counted in TICKS and scaled by a hardcoded
// DIFFS_PER_DAY, so the moment the cadence changed every historical rate
// silently re-scaled. It is now counted in observed MILLISECONDS, which makes
// the cadence a free variable. These fixtures are the proof.

global.window = { appInfo: {} };
const { normalizedRates, coveredMs } = require('./cl/radar.js');

let pass = 0, fail = 0;
const near = (label, got, want, tol) => {
  const ok = got !== null && Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${got} want≈${want}±${tol}`}`);
  ok ? pass++ : fail++;
};
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const HOUR = 3_600_000;
const day = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/** one item's daily rows: 240 units filled on each of the last 2 days */
const entry = (fi) => ({
  r: 10000002, t: 34, s: 0,
  days: [
    { d: day(2), rp: 10, fi, fk: fi * 1000, co: 3, bp: 5 },
    { d: day(1), rp: 10, fi, fk: fi * 1000, co: 3, bp: 5 },
  ],
  hfa: new Array(24).fill(0), hra: new Array(24).fill(0),
});

// ---- a FULLY observed pair of days: the rate is just the daily total ----
const fullCover = {
  days: [
    { d: day(2), n: 48, cv: [], ms: 24 * HOUR },
    { d: day(1), n: 48, cv: [], ms: 24 * HOUR },
  ],
  na: 96, cva: [],
};
near('two fully-watched days at 240/day reads as 240/day',
  normalizedRates(entry(240), fullCover, 7).fi, 240, 0.001);
near('...and coverage is 2 of the 7 days', normalizedRates(entry(240), fullCover, 7).covPct, 2 / 7, 0.001);

// ---- HALF observed: the same fills imply DOUBLE the daily rate ----------
const halfCover = {
  days: [
    { d: day(2), n: 24, cv: [], ms: 12 * HOUR },
    { d: day(1), n: 24, cv: [], ms: 12 * HOUR },
  ],
  na: 48, cva: [],
};
near('240 fills seen in HALF a day each = 480/day',
  normalizedRates(entry(240), halfCover, 7).fi, 480, 0.001);

// ---- THE CADENCE CHANGE. Same wall-clock coverage, half as many ticks:
// the answer must NOT move. Under the old tick-scaling it halved.
const slowCover = {
  days: [
    { d: day(2), n: 24, cv: [], ms: 24 * HOUR },  // 60-min sweep, full day
    { d: day(1), n: 24, cv: [], ms: 24 * HOUR },
  ],
  na: 48, cva: [],
};
near('HALVING THE SWEEP RATE does not change the measured rate',
  normalizedRates(entry(240), slowCover, 7).fi, 240, 0.001);
const slowest = {
  days: [
    { d: day(2), n: 6, cv: [], ms: 24 * HOUR },   // 4-hour sweep, full day
    { d: day(1), n: 6, cv: [], ms: 24 * HOUR },
  ],
  na: 12, cva: [],
};
near('...nor does an EIGHTH of the sweep rate',
  normalizedRates(entry(240), slowest, 7).fi, 240, 0.001);

// ---- OLD DATA (no `ms`) is read at the cadence it was taken at ----------
eq('a legacy day (48 ticks, no ms) infers a full 24h', coveredMs({ n: 48 }), 24 * HOUR);
eq('a legacy half-day infers 12h', coveredMs({ n: 24 }), 12 * HOUR);
eq('a recorded ms always wins over the tick count', coveredMs({ n: 1, ms: 5 * HOUR }), 5 * HOUR);
const legacyCover = {
  days: [
    { d: day(2), n: 48, cv: [] },   // pre-v60.31: count only
    { d: day(1), n: 48, cv: [] },
  ],
  na: 96, cva: [],
};
near('PRE-EXISTING history still reads exactly as it always did',
  normalizedRates(entry(240), legacyCover, 7).fi, 240, 0.001);

// ---- mixed old and new days in one window --------------------------------
const mixed = {
  days: [
    { d: day(2), n: 48, cv: [] },                  // legacy full day
    { d: day(1), n: 12, cv: [], ms: 24 * HOUR },   // new, slower, full day
  ],
  na: 60, cva: [],
};
near('a legacy day and a slow new day average correctly',
  normalizedRates(entry(240), mixed, 7).fi, 240, 0.001);

// ---- honest refusals -----------------------------------------------------
eq('no coverage rows at all in the window = no answer',
  normalizedRates(entry(240), { days: [{ d: day(30), n: 48, cv: [] }], na: 48, cva: [] }, 7), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
