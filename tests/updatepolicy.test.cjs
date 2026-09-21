// EMERGENCY UPDATES (v0.217.0) — the marker in the feed file, and how the app reads it.
//   node tests/updatepolicy.test.cjs
const P = require('../electron/updatePolicy.cjs');
const yaml = require('js-yaml'); // the parser electron-updater itself uses on latest.yml

let passed = 0, failed = 0;
const check = (label, cond, extra) => { if (cond) passed++; else { failed++; console.log('FAIL ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

// a real latest.yml, as electron-builder writes it
const YML = [
  'version: 0.217.0',
  'files:',
  '  - url: EVE-Conductor-Setup-0.217.0.exe',
  '    sha512: abc==',
  '    size: 101588266',
  'path: EVE-Conductor-Setup-0.217.0.exe',
  'sha512: abc==',
  "releaseDate: '2026-09-21T03:31:40.000Z'",
  '',
].join('\n');

// ---- reading
check('E1 an ordinary feed entry is not an emergency', P.emergencyOf(yaml.load(YML)).emergency === false);
check('E2 nothing / junk is not an emergency', !P.emergencyOf(null).emergency && !P.emergencyOf('x').emergency && !P.emergencyOf({}).emergency);
check('E3 only a real boolean counts — the STRING "true" does not', P.emergencyOf({ emergency: 'true' }).emergency === false && P.emergencyOf({ emergency: 1 }).emergency === false);
check('E4 the reason is only read when it IS an emergency', P.emergencyOf({ emergency: false, emergencyReason: 'x' }).reason === '');

// ---- writing, then reading back THROUGH THE SAME PARSER the updater uses
const reason = 'Stops the app loading a third party\'s site: "Aperture" — see notes #12';
const marked = P.withEmergencyMarker(YML, reason);
const back = yaml.load(marked);
check('W1 the marked file still parses and keeps every original field', back.version === '0.217.0' && back.files[0].sha512 === 'abc==' && back.path === 'EVE-Conductor-Setup-0.217.0.exe', back);
check('W2 …and reads back as an emergency with the exact reason (quotes, colon, hash survive)', P.emergencyOf(back).emergency === true && P.emergencyOf(back).reason === reason, P.emergencyOf(back));
check('W3 marking twice does not double the fields', (P.withEmergencyMarker(marked, 'again').match(/^emergency:/gm) || []).length === 1 && yaml.load(P.withEmergencyMarker(marked, 'again')).emergencyReason === 'again');
check('W4 publishing WITHOUT the flag clears a marker left from an earlier run', P.emergencyOf(yaml.load(P.withEmergencyMarker(marked, null))).emergency === false && P.withEmergencyMarker(marked, null) === YML, P.withEmergencyMarker(marked, null));
check('W5 an emergency with no reason is refused', (() => { try { P.withEmergencyMarker(YML, '   '); return false; } catch { return true; } })());
check('W6 a long, multi-line reason is flattened and cut to 240', (() => { const r = P.emergencyOf(yaml.load(P.withEmergencyMarker(YML, 'a\n b ' + 'x'.repeat(400)))).reason; return r.length === 240 && r.startsWith('a b x'); })());
check('W7 Windows line endings in the file are handled', P.emergencyOf(yaml.load(P.withEmergencyMarker(YML.replace(/\n/g, '\r\n'), 'r'))).emergency === true);

// ---- the numbers the app runs on
check('N1 a one-minute warning, an hourly check', P.EMERGENCY_COUNTDOWN_MS === 60_000 && P.CHECK_EVERY_MS === 3_600_000);

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
