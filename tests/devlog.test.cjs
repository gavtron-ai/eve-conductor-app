// Fixtures for the SHIPPED electron/devlog.cjs.
//
// RULE 7 IS THE POINT: EVE rotates refresh tokens, and a leaked one revokes
// the live session. A diagnostics file that quietly captured one would be
// worse than having no diagnostics at all. So the scrubber is tested first
// and hardest — including the cases where the secret is NOT under an
// obviously-named key.

const fs = require('fs');
const os = require('os');
const path = require('path');
const devlog = require(process.argv[2] || '../electron/devlog.cjs');

const NL = String.fromCharCode(10);
let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : `   ${extra}`}`);
  cond ? pass++ : fail++;
};
const eq = (label, got, want) =>
  ok(label, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);

// a real-shaped EVE refresh token and a real-shaped JWT access token
const REFRESH = 'gEyM1lqLpQ2vXcT8wZbN4rK9sD3fH6jA0uY7iO5eR1tW';
const JWT = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IkpXVC1TaWduYXR1cmUtS2V5In0.eyJzY3AiOlsiZXNpLXdhbGxldCJdLCJzdWIiOiJDSEFSQUNURVI6RVZFOjk1NDY0OTUifQ.abcdef123456';

// ---- 1. NAMED SECRET KEYS ------------------------------------------------
const scrubbed = devlog.scrub({
  accessToken: JWT,
  refreshToken: REFRESH,
  refresh_token: REFRESH,
  Authorization: `Bearer ${JWT}`,
  clientSecret: 'hunter2',
  api_key: 'abc',
  password: 'p',
  characterName: 'Chad Chaddington Sr',
  wallet: 1234567,
});
eq('accessToken is redacted', scrubbed.accessToken, '[redacted]');
eq('refreshToken is redacted', scrubbed.refreshToken, '[redacted]');
eq('snake_case refresh_token too', scrubbed.refresh_token, '[redacted]');
eq('an Authorization header too', scrubbed.Authorization, '[redacted]');
eq('clientSecret too', scrubbed.clientSecret, '[redacted]');
eq('api_key too', scrubbed.api_key, '[redacted]');
eq('password too', scrubbed.password, '[redacted]');
// ...while ordinary diagnostics survive, or the log would be useless
eq('a character name is KEPT', scrubbed.characterName, 'Chad Chaddington Sr');
eq('a wallet balance is KEPT', scrubbed.wallet, 1234567);

// ---- 2. A SECRET UNDER AN INNOCENT KEY -----------------------------------
// this is the case a key-name blocklist alone would miss
const sneaky = devlog.scrub({ value: JWT, note: 'from the sso callback' });
eq('a JWT under a harmless key is caught by SHAPE', sneaky.value, '[redacted:jwt]');
eq('...and the surrounding note survives', sneaky.note, 'from the sso callback');
eq('a bare JWT string is caught', devlog.scrub(JWT), '[redacted:jwt]');

// ---- 3. NESTING AND ARRAYS ----------------------------------------------
const nested = devlog.scrub({ characters: [{ name: 'A', refreshToken: REFRESH }] });
eq('a token nested in an array of objects is redacted',
  nested.characters[0].refreshToken, '[redacted]');
eq('...and its sibling survives', nested.characters[0].name, 'A');
const deep = devlog.scrub({ a: { b: { c: { d: { e: { f: { g: { token: REFRESH } } } } } } } });
ok('runaway nesting is cut off rather than followed forever',
  JSON.stringify(deep).includes('[deep]'), JSON.stringify(deep));

// ---- 4. NOTHING ELSE IS DESTROYED ---------------------------------------
eq('null survives', devlog.scrub(null), null);
eq('a number survives', devlog.scrub(42), 42);
eq('a boolean survives', devlog.scrub(false), false);
eq('a short string survives', devlog.scrub('radar tick ok'), 'radar tick ok');
// a long HUMAN string (spaces, punctuation) is truncated so the log stays
// readable — but a long OPAQUE blob is a credential until proven otherwise
const longHuman = ('could not create the fitting because ' + 'x '.repeat(200)).slice(0, 500);
ok('a long human-readable message is truncated, not dropped',
  devlog.scrub(longHuman).startsWith('could not create') && devlog.scrub(longHuman).includes('chars]'),
  devlog.scrub(longHuman).slice(0, 80));
ok('a long OPAQUE blob is redacted, not truncated — it could be a token',
  devlog.scrub('x'.repeat(500)) === '[redacted:opaque]',
  devlog.scrub('x'.repeat(500)).slice(0, 40));
ok('...and so is a 40-char base64url string (EVE refresh token shape)',
  devlog.scrub('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0') === '[redacted:opaque]');
ok('a 39-char one is NOT (below the threshold, keeps short ids readable)',
  devlog.scrub('A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t') === 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t');

// ---- 5. THE WRITE PATH ---------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'evelog-'));
devlog.append(tmp, [
  { t: Date.now(), level: 'info', area: 'radar', msg: 'tick ok', data: { ms: 1200 } },
  { t: Date.now(), level: 'error', area: 'trends', msg: 'tick FAILED', data: { refreshToken: REFRESH } },
]);
const dir = path.join(tmp, devlog.FOLDER_NAME);
const file = fs.readdirSync(dir).find((f) => /^conductor-.*\.log$/.test(f));
ok('a log file was created', Boolean(file), fs.readdirSync(dir).join(','));
const body = fs.readFileSync(path.join(dir, file), 'utf8');
ok('THE TOKEN IS NOT IN THE FILE', !body.includes(REFRESH), body.slice(0, 300));
ok('...and the redaction marker is', body.includes('[redacted]'));
ok('the useful part survived', body.includes('tick ok') && body.includes('1200'));
ok('a README explains the folder is disposable', fs.existsSync(path.join(dir, 'README.txt')));

const lines = body.split(NL).filter(Boolean);
eq('one JSON object per line', lines.length, 2);
const first = JSON.parse(lines[0]);
eq('...with an ISO timestamp', typeof first.t === 'string' && first.t.endsWith('Z'), true);
eq('...the area', first.area, 'radar');
eq('...and the level', first.level, 'info');

// a newline inside a message must not break the one-object-per-line contract
devlog.append(tmp, [{ level: 'warn', area: 'x', msg: `a${NL}b${NL}c` }]);
const after = fs.readFileSync(path.join(dir, file), 'utf8').split(NL).filter(Boolean);
eq('an embedded newline cannot split a record', after.length, 3);
eq('...it is folded to a space', JSON.parse(after[2]).msg, 'a b c');

// ---- 6. PRUNING ----------------------------------------------------------
const oldDay = new Date(Date.now() - 40 * 86_400_000).toISOString().slice(0, 10);
const newDay = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
fs.writeFileSync(path.join(dir, `conductor-${oldDay}.log`), 'old' + NL);
fs.writeFileSync(path.join(dir, `conductor-${newDay}.log`), 'recent' + NL);
devlog.prune(tmp);
ok(`a ${devlog.KEEP_DAYS}-day-old log is deleted`, !fs.existsSync(path.join(dir, `conductor-${oldDay}.log`)));
ok('a recent one is kept', fs.existsSync(path.join(dir, `conductor-${newDay}.log`)));
ok('and so is today\'s', fs.existsSync(path.join(dir, file)));

// ---- 7. IT MUST NEVER THROW INTO THE APP --------------------------------
let threw = null;
try {
  devlog.append('Z:/definitely/not/a/real/path', [{ msg: 'x' }]);
  devlog.append(tmp, null);
  devlog.append(tmp, []);
  devlog.prune('Z:/nope');
  devlog.tail('Z:/nope');
} catch (e) { threw = e.message; }
eq('an unwritable path, junk input and a bad read all stay silent', threw, null);
eq('tail of a missing folder is empty, not an exception', devlog.tail('Z:/nope'), '');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${NL}${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
