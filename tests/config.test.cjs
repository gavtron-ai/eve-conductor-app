// Fixtures for the SHIPPED electron/appConfig.cjs.
//
// THE POINT: there is now ONE anonymous build, and every player's setup lives
// in a file. That file is therefore load-bearing in two directions — it must
// never lose a working setup, and it must never become a place a token ends
// up (RULE 7: EVE rotates refresh tokens; a copied one revokes the session).

const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../electron/appConfig.cjs');

const NL = String.fromCharCode(10);
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : `   ${extra}`}`);
  cond ? pass++ : fail++;
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evecfg-'));

// ---- 1. A FRESH INSTALL IS EMPTY, NOT BROKEN ---------------------------
eq('no file yet reads as an unconfigured setup', cfg.read(tmp),
  { eveClientId: '', transitShipName: '', apertureUrl: '' });
ok('...and reading did not create a config file',
  !fs.existsSync(path.join(tmp, cfg.FOLDER_NAME, cfg.FILE_NAME)));

// ---- 2. WRITING, AND THE FILE THAT RESULTS ------------------------------
let out = cfg.write(tmp, { eveClientId: 'abc123', transitShipName: 'MY HAULER' });
eq('a write returns the full new setup', out,
  { eveClientId: 'abc123', transitShipName: 'MY HAULER', apertureUrl: '' });
eq('...and reading it back agrees', cfg.read(tmp), out);
ok('a README explains the folder', fs.existsSync(path.join(tmp, cfg.FOLDER_NAME, 'README.txt')));

// a PARTIAL write must not blank the fields it did not mention
out = cfg.write(tmp, { apertureUrl: 'https://map.example/1' });
eq('a partial write leaves other fields alone', out,
  { eveClientId: 'abc123', transitShipName: 'MY HAULER', apertureUrl: 'https://map.example/1' });

// deliberately clearing a field must stick
out = cfg.write(tmp, { transitShipName: '' });
eq('a field can be deliberately cleared', out.transitShipName, '');
eq('...and the others survive that too', out.eveClientId, 'abc123');
eq('...and it stays cleared on the next read', cfg.read(tmp).transitShipName, '');

// whitespace is trimmed — a trailing space in a ship name would silently
// stop the exact-name match from ever succeeding
eq('values are trimmed', cfg.write(tmp, { transitShipName: '  SPACED  ' }).transitShipName, 'SPACED');

// ---- 3. NO TOKENS, EVER (RULE 7) ---------------------------------------
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJDSEFSQUNURVI6RVZFOjk1NDY0OTUifQ.sig123456';
const REFRESH = 'gEyM1lqLpQ2vXcT8wZbN4rK9sD3fH6jA0uY7iO5eR1tW';
const before = cfg.read(tmp);
cfg.write(tmp, { transitShipName: REFRESH });
eq('a refresh-token-shaped value is REFUSED as a ship name',
  cfg.read(tmp).transitShipName, before.transitShipName);
cfg.write(tmp, { apertureUrl: JWT });
eq('a JWT is refused as a map URL', cfg.read(tmp).apertureUrl, before.apertureUrl);
const body = fs.readFileSync(path.join(tmp, cfg.FOLDER_NAME, cfg.FILE_NAME), 'utf8');
ok('NEITHER TOKEN IS IN THE FILE', !body.includes(REFRESH) && !body.includes(JWT), body);

// unknown keys are not stored — the file holds setup, nothing else
cfg.write(tmp, { accessToken: JWT, password: 'hunter2', somethingElse: 'x' });
const keys = Object.keys(JSON.parse(fs.readFileSync(path.join(tmp, cfg.FOLDER_NAME, cfg.FILE_NAME), 'utf8')));
eq('only the three setup keys are ever written', keys.sort(), [...cfg.KEYS].sort());

// a 32-char hex client id is NOT a secret and must survive
eq('a real EVE client id is stored, not mistaken for a token',
  cfg.write(tmp, { eveClientId: '0123456789abcdef0123456789abcdef' }).eveClientId,
  '0123456789abcdef0123456789abcdef');

// ---- 4. IT MUST NEVER LOSE A WORKING SETUP -----------------------------
const good = cfg.read(tmp);
// a corrupt file reads as empty rather than throwing...
fs.writeFileSync(path.join(tmp, cfg.FOLDER_NAME, cfg.FILE_NAME), '{ this is not json');
eq('a corrupt file reads as unconfigured instead of crashing', cfg.read(tmp),
  { eveClientId: '', transitShipName: '', apertureUrl: '' });
// ...and writing over it restores a valid file
eq('writing over a corrupt file works', cfg.write(tmp, { eveClientId: good.eveClientId }).eveClientId,
  good.eveClientId);

// wrong types in the file are ignored per-field, not fatal
fs.writeFileSync(path.join(tmp, cfg.FOLDER_NAME, cfg.FILE_NAME),
  JSON.stringify({ eveClientId: 42, transitShipName: 'KEPT', apertureUrl: null }));
eq('a non-string field falls back to empty', cfg.read(tmp).eveClientId, '');
eq('...while the valid field beside it survives', cfg.read(tmp).transitShipName, 'KEPT');

// an unwritable location returns null instead of throwing into the app
eq('an unwritable path reports failure rather than throwing',
  cfg.write('Z:/definitely/not/real', { eveClientId: 'x' }), null);
eq('...and reading one is empty, not an exception', cfg.read('Z:/nope'),
  { eveClientId: '', transitShipName: '', apertureUrl: '' });

// the write is atomic: no .tmp file is left behind
const dirFiles = fs.readdirSync(path.join(tmp, cfg.FOLDER_NAME));
ok('no temp file is left after a write', !dirFiles.some((f) => f.endsWith('.tmp')), dirFiles.join(','));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${NL}${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
