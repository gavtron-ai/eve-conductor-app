// Fixtures for the SHIPPED fitFix.ts rules.
//
// THE CORRECTION THIS ENCODES (user, v0.61.3): capacitor is NOT a fitting
// failure. CPU, powergrid and calibration are HARD limits — over them the fit
// does not go on the ship at all. A cap-unstable fit is flown deliberately
// every day, and putting a wrench on it would flag almost every combat fit in
// the game and train the user to ignore the icon.
//
// And even when the cap runs dry, the reading is only trustworthy if the
// ancillary modules are CHARGED: an Ancillary Shield Booster with no charges
// drains capacitor a charged one would not touch, and a Capacitor Booster
// with no charges injects nothing. Judging cap from an unloaded fit measures
// the loadout, not the fit.

const NL = String.fromCharCode(10);
global.window = { appInfo: {} };
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : `   ${extra}`}`);
  cond ? pass++ : fail++;
};

const { fittingProblems, capacitorVerdict } = require('./fx/fitFix.js');
const { isAncillary, ANCILLARY_COUNT } = require('./fx/ancillaryTypes.js');

// ===== A. THE GENERATED ANCILLARY SET ===================================
// real ids from CCP's own group table
const MED_CAP_BOOSTER = 577;       // Medium Capacitor Booster I  (group 76)
const LARGE_ASB = 4391;            // Large Ancillary Shield Booster (1156)
const ANCILLARY_CURRENT_ROUTER = 25956; // a RIG (group 781) — the name trap

ok(`the set is populated (${ANCILLARY_COUNT} types)`, ANCILLARY_COUNT > 50);
ok('a Capacitor Booster is ancillary', isAncillary(MED_CAP_BOOSTER));
ok('an Ancillary Shield Booster is ancillary', isAncillary(LARGE_ASB));
ok('a plain module is not', !isAncillary(2048));
ok('an Ancillary Armor Repairer is ancillary', isAncillary(33076));
// THE TRAP: matching by NAME would have caught this rig and wrongly
// suppressed a genuine capacitor problem
ok('an "Ancillary Current Router" RIG is NOT treated as an ancillary module',
  !isAncillary(ANCILLARY_CURRENT_ROUTER));

// ===== B. WHAT COUNTS AS A FITTING FAILURE ==============================
const stats = (over = {}) => ({
  cpu: { load: 100, output: 200 },
  power: { load: 100, output: 200 },
  calibration: { load: 100, output: 400 },
  cap: { capacity: 1000, rechargeRate: 100, peakDelta: 5, depletesIn: -1 },
  ...over,
});
const fitWith = (items) => ({ shipId: 587, shipName: 'Rifter', items, unresolved: [], extraFits: 0 });
const mod = (typeId, name, charges = []) => ({ typeId, name, qty: 1, offlineQty: 0, charges });

// a comfortable fit has no problems at all
eq('a fit within every budget has no problems',
  fittingProblems(stats(), fitWith([])).resources, []);

// the HARD limits
eq('over CPU is a problem',
  fittingProblems(stats({ cpu: { load: 250, output: 200 } }), fitWith([])).resources, ['cpu']);
eq('over powergrid is a problem',
  fittingProblems(stats({ power: { load: 250, output: 200 } }), fitWith([])).resources, ['power']);
eq('over calibration is a problem',
  fittingProblems(stats({ calibration: { load: 500, output: 400 } }), fitWith([])).resources, ['calibration']);
eq('several at once are all reported, hard limits first',
  fittingProblems(stats({ cpu: { load: 250, output: 200 }, power: { load: 250, output: 200 } }), fitWith([])).resources,
  ['cpu', 'power']);

// ===== C. CAPACITOR — THE CORRECTION ====================================
// cap-unstable but NOT dry is not a fitting failure. This is the case that
// used to put a wrench on nearly every combat fit.
const unstable = stats({ cap: { capacity: 1000, rechargeRate: 100, peakDelta: -50, depletesIn: -1 } });
eq('a cap-UNSTABLE-looking fit that is still stable is NOT a problem',
  fittingProblems(unstable, fitWith([])).resources, []);

// runs dry, no ancillaries at all -> a real problem
const dry = stats({ cap: { capacity: 1000, rechargeRate: 100, peakDelta: -50, depletesIn: 180 } });
eq('a fit that RUNS DRY with no ancillaries is a problem',
  fittingProblems(dry, fitWith([])).resources, ['cap']);

// runs dry, ancillary present and LOADED -> still a real problem
eq('runs dry with a CHARGED ancillary is still a problem',
  fittingProblems(dry, fitWith([mod(LARGE_ASB, 'Large Ancillary Shield Booster', [12547])])).resources,
  ['cap']);

// runs dry, ancillary present and EMPTY -> we decline to judge
const emptyAsb = fitWith([mod(LARGE_ASB, 'Large Ancillary Shield Booster', [])]);
eq('runs dry with an EMPTY ancillary is NOT reported',
  fittingProblems(dry, emptyAsb).resources, []);
let v = capacitorVerdict(dry, emptyAsb);
eq('...it is reported as UNKNOWN rather than fine', v.unknown, true);
eq('...and names the module that needs charges', v.unloaded, ['Large Ancillary Shield Booster']);
eq('...and does not claim it runs dry', v.runsDry, false);

// an empty CAPACITOR BOOSTER counts the same way
const emptyBooster = fitWith([mod(MED_CAP_BOOSTER, 'Medium Capacitor Booster I', [])]);
eq('an empty Capacitor Booster also suppresses the cap verdict',
  fittingProblems(dry, emptyBooster).resources, []);

// ONE empty among several loaded is still enough to withhold judgement
const mixed = fitWith([
  mod(LARGE_ASB, 'Large Ancillary Shield Booster', [12547]),
  mod(MED_CAP_BOOSTER, 'Medium Capacitor Booster I', []),
]);
eq('one empty ancillary among loaded ones still withholds the verdict',
  fittingProblems(dry, mixed).resources, []);

// the RIG must not suppress anything — this is the name trap in action
const withRig = fitWith([mod(ANCILLARY_CURRENT_ROUTER, 'Large Ancillary Current Router I', [])]);
eq('an Ancillary Current Router RIG does not suppress a real cap problem',
  fittingProblems(dry, withRig).resources, ['cap']);

// a STABLE fit with empty ancillaries is simply fine — no verdict needed
v = capacitorVerdict(stats(), emptyAsb);
eq('a stable fit is not "unknown" just because an ancillary is empty', v.unknown, false);
eq('...and is not a problem', v.runsDry, false);

// hard limits are unaffected by any of the capacitor logic
eq('an empty ancillary does NOT suppress an over-CPU problem',
  fittingProblems(stats({ cpu: { load: 250, output: 200 } }), emptyAsb).resources, ['cpu']);

console.log(`${NL}${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
