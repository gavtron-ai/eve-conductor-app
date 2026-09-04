// v0.176.0 — RAID WATCH CLASSIFICATION + BAR RESOLUTION (pure).
// The gap being closed: a raider who links near the window end and steals
// AFTER the timer used to be recorded as 'survived'. Verdicts now come
// from the SERVER's snapshot clock (Last-Modified; feed cache max-age=300
// measured 2026-08-30) and the ambiguous tail is an honest 'unknown'.

const { diffRaidSnapshots, resolveWithBar } = require('./sim/lib/raidWatch.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};

const MIN = 60_000;
const T0 = 1_800_000_000_000;
const HOOK = (planetId, startMs, endMs) => [planetId, { planetId, systemId: 30_000_001, startMs, endMs }];
const snap = (...hooks) => new Map(hooks);

// window: T0 .. T0+120min (the measured 2h windows)
const START = T0, END = T0 + 120 * MIN;

// R1: removed while clearly open → raided, timed by the SERVER clock
{
  const prev = snap(HOOK(1, START, END));
  const evs = diffRaidSnapshots(prev, snap(), START + 40 * MIN, START + 45 * MIN);
  eq('R1 mid-window removal = raided @currLM', evs.map((e) => [e.kind, e.intoWindowMin, e.windowMin]),
    [['raided', 45, 120]]);
}

// R2: boundary straddled with a WATCHED tail (blind 4 min) → survived + blindTail
{
  const prev = snap(HOOK(2, START, END));
  const evs = diffRaidSnapshots(prev, snap(), END - 4 * MIN, END + 1 * MIN);
  eq('R2 watched close = survived, blind tail recorded', evs.map((e) => [e.kind, e.blindTailMin]),
    [['survived', 4]]);
}

// R3: tail UNOBSERVED (blind 12 min > 7-min honesty bound) → unknown
{
  const prev = snap(HOOK(3, START, END));
  const evs = diffRaidSnapshots(prev, snap(), END - 12 * MIN, END + 1 * MIN);
  eq('R3 blind tail = unknown', evs.map((e) => [e.kind, e.blindTailMin]), [['unknown', 12]]);
}

// R4: listed clearly PAST its end, then vanished — the late-link signature;
// honestly unknown until the experiment settles the mechanic
{
  const prev = snap(HOOK(4, START, END));
  const evs = diffRaidSnapshots(prev, snap(), END + 3 * MIN, END + 8 * MIN);
  eq('R4 past-end listing then removal = unknown', evs.map((e) => [e.kind]), [['unknown']]);
}

// R5: removal observed inside the 90s boundary grace — NOT called raided
{
  const prev = snap(HOOK(5, START, END));
  const evs = diffRaidSnapshots(prev, snap(), END - 5 * MIN, END - 60_000);
  eq('R5 inside grace = not raided (survived w/ tail)', evs.map((e) => e.kind), ['survived']);
}

// R6: vanished before its window even opened → nothing recorded
{
  const prev = snap(HOOK(6, START, END));
  const evs = diffRaidSnapshots(prev, snap(), START - 10 * MIN, START - 5 * MIN);
  eq('R6 pre-window churn ignored', evs.length, 0);
}

// ---- bar resolution: reading R tics at T ⇒ last emptied ≈ T − R days ----
const DAY = 24 * 3600_000;

// B1: unknown at ≈ the estimated emptying → it WAS the raid
{
  const readMs = T0 + 30 * DAY;
  const ev = [{ t: readMs - 5 * DAY, planetId: 9, systemId: 1, kind: 'unknown' }];
  const { resolved, changed } = resolveWithBar(ev, 9, readMs, 5);
  eq('B1 matching unknown resolves to raided', [changed, resolved[0].kind, resolved[0].resolvedBy],
    [1, 'raided', 'bar']);
}

// B2: unknown AFTER the last emptying → nothing was taken then → survived
{
  const readMs = T0 + 30 * DAY;
  const ev = [{ t: readMs - 2 * DAY, planetId: 9, systemId: 1, kind: 'unknown' }];
  const { resolved, changed } = resolveWithBar(ev, 9, readMs, 10);
  eq('B2 unknown after emptying resolves to survived', [changed, resolved[0].kind], [1, 'survived']);
}

// B3: unknown OLDER than the emptying stays honestly unresolved
{
  const readMs = T0 + 30 * DAY;
  const ev = [{ t: readMs - 20 * DAY, planetId: 9, systemId: 1, kind: 'unknown' }];
  const { changed } = resolveWithBar(ev, 9, readMs, 5);
  eq('B3 older unknown untouched', changed, 0);
}

// B4: other planets untouched; a survived far from the emptying untouched
{
  const readMs = T0 + 30 * DAY;
  const ev = [
    { t: readMs - 5 * DAY, planetId: 7, systemId: 1, kind: 'unknown' },
    { t: readMs - 12 * DAY, planetId: 9, systemId: 1, kind: 'survived' },
  ];
  const { changed } = resolveWithBar(ev, 9, readMs, 5);
  eq('B4 scoping respected', changed, 0);
}

// B5: STEALTH RAID — the feed said 'survived' but the bar dates the
// emptying right there: overturned to raided, counted as stealth.
// (Survivorship-bias fix: raiders who know these feeds are tracked can
// link at the end on purpose; Gavin found a "very full" silo at ~2%.)
{
  const readMs = T0 + 30 * DAY;
  const ev = [
    { t: readMs - 5 * DAY, planetId: 9, systemId: 1, kind: 'survived', blindTailMin: 3 },
    { t: readMs - 9 * DAY, planetId: 9, systemId: 1, kind: 'survived', blindTailMin: 2 },
  ];
  const { resolved, changed, stealthConfirmed } = resolveWithBar(ev, 9, readMs, 5);
  eq('B5 stealth raid overturns the matching survived only',
    [changed, stealthConfirmed, resolved[0].kind, resolved[0].wasKind, resolved[1].kind],
    [1, 1, 'raided', 'survived', 'survived']);
}

// B6: a survived already resolved by an earlier bar reading is never
// re-flipped by a later, contradictory one
{
  const readMs = T0 + 30 * DAY;
  const ev = [{ t: readMs - 5 * DAY, planetId: 9, systemId: 1, kind: 'survived', resolvedBy: 'bar' }];
  const { changed, stealthConfirmed } = resolveWithBar(ev, 9, readMs, 5);
  eq('B6 bar-resolved verdicts are settled', [changed, stealthConfirmed], [0, 0]);
}

console.log(`\nraidwatch.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
