// PER-SCREEN ZOOM (v0.200.8) — the pure parts: steps, clamping, parsing.
const Z = require('./sim/lib/zoom.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };

check('S1 steps run 70 % → 200 % through 100 %', Z.ZOOM_STEPS[0] === 0.7 && Z.ZOOM_STEPS[Z.ZOOM_STEPS.length - 1] === 2 && Z.ZOOM_STEPS.includes(1));
check('S2 stepping up from 100 % → 110 %, down → 90 %', Z.stepZoom(1, 1) === 1.1 && Z.stepZoom(1, -1) === 0.9);
check('S3 the ends hold: up from 200 % stays 200 %, down from 70 % stays 70 %', Z.stepZoom(2, 1) === 2 && Z.stepZoom(0.7, -1) === 0.7);
check('S4 from between steps, the nearest step in that direction (1.05 → 1.1 up, → 1 down)', Z.stepZoom(1.05, 1) === 1.1 && Z.stepZoom(1.05, -1) === 1);
check('S5 clamp: 3 → 2, 0.1 → 0.7, "1.25" → 1.25, garbage → 1', Z.clampZoom(3) === 2 && Z.clampZoom(0.1) === 0.7 && Z.clampZoom('1.25') === 1.25 && Z.clampZoom('x') === 1 && Z.clampZoom(undefined) === 1);
check('S6 parse: a good map survives, bad values dropped, out-of-range clamped', JSON.stringify(Z.parseZooms('{"trade":1.25,"pi":"big","chain-summary":9,"battle":null}')) === JSON.stringify({ trade: 1.25, 'chain-summary': 2 }));
check('S7 parse: garbage, arrays and nothing → {}', JSON.stringify(Z.parseZooms('nope')) === '{}' && JSON.stringify(Z.parseZooms('[1,2]')) === '{}' && JSON.stringify(Z.parseZooms(null)) === '{}');
check('S8 labels', Z.zoomLabel(1) === '100%' && Z.zoomLabel(1.25) === '125%' && Z.zoomLabel(0.7) === '70%');

console.log(`zoom.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
