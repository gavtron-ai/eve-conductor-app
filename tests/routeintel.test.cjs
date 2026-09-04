// ROUTE INTEL (v0.134) — the pure parsing behind the route gatecamp popup.
// The I/O (zKillboard + ESI fetches) can't be fixtured offline, but the two
// pure helpers that shape what the popup shows can, and are worth pinning.

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
// routeIntel imports typedb (getType) which reads bundled JSON — harmless here.

const { whereFrom, isBubbleShip, summarize } = require('./sim/lib/routeIntel.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// ---- whereFrom: killmail location name → human "where" + on-gate flag ----
eq('R1 stargate name → "Gate to X" + onGate', whereFrom('Stargate (Amarr)'), { where: 'Gate to Amarr', onGate: true });
eq('R2 nullsec gate dest with dashes', whereFrom('Stargate (319-3D)'), { where: 'Gate to 319-3D', onGate: true });
eq('R3 a station is not a gate', whereFrom('Jita IV - Moon 4 - Caldari Navy Assembly Plant'),
  { where: 'Jita IV - Moon 4 - Caldari Navy Assembly Plant', onGate: false });
eq('R4 empty/unresolved → in space, not on a gate', whereFrom(''), { where: 'in space', onGate: false });

// ---- isBubbleShip: interdictor / HIC hulls only ----
eq('R5 Sabre is a bubbler', isBubbleShip(22456), true);
eq('R6 Onyx (HIC) is a bubbler', isBubbleShip(11995), true);
eq('R7 a Rifter is not', isBubbleShip(587), false);
eq('R8 a pod is not', isBubbleShip(670), false);

// ---- summarize: group sampled kills by where, most-common first ----
const k = (where) => ({ id: 1, hash: 'h', value: 0, time: null, victimShip: '', where, onGate: false, bubble: false });
eq('R9 groups + counts, commonest first',
  summarize([k('Gate to Amarr'), k('Gate to Amarr'), k('in space')]),
  'Gate to Amarr ×2, in space');
eq('R10 single location, no ×1 noise', summarize([k('Gate to Hek')]), 'Gate to Hek');
eq('R11 no kills → empty', summarize([]), '');

console.log(`routeintel.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
