// v0.245.0: the dashlets that cannot work while the Aperture link is off are named as such, and the
// starter board never lays one down. Runs against the compiled library (tests/sim/lib/dashlets.js).
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { appInfo: undefined, localStorage: global.localStorage, addEventListener: () => {} };
const D = require('./sim/lib/dashlets.js');
const A = require('./sim/lib/apertureAccess.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const off = D.DASHLETS.filter((s) => D.dashletUnavailable(s) !== null).map((s) => s.id);
eq('1 the Aperture link is off (the premise of this fixture)', A.APERTURE_FEATURES_AVAILABLE, false);
eq('2 exactly the map-fed dashlets and the haul log are unavailable', off,
  ['chain-isk', 'chain-ways', 'chain-near', 'chain-activity', 'chain-exits', 'chain-effects', 'chain-fresh', 'chain-shape', 'chain-ore', 'chain-gas', 'hauls']);
eq('3 every other dashlet is available', D.DASHLETS.filter((s) => D.dashletUnavailable(s) === null).length, D.DASHLETS.length - off.length);
eq('4 the reason says what, why and where to read more', [D.UNAVAILABLE_REASON.startsWith('Temporarily unavailable'), D.UNAVAILABLE_REASON.includes('Help → Aperture'), D.UNAVAILABLE_REASON.includes('does not contact Aperture')], [true, true, true]);
const starter = D.starterItems();
eq('5 the starter board lays down none of them (3 of the 14 entries skipped)', [starter.length, starter.filter(([k]) => off.includes(k))], [11, []]);
eq('6 every starter entry names a real dashlet', starter.filter(([k]) => !D.dashletOf(k)).map(([k]) => k), []);
eq('7 the raw list still holds the chain entries — they return when the link does', D.STARTER.filter(([k]) => off.includes(k)).map(([k]) => k), ['chain-isk', 'chain-ways', 'chain-exits']);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
