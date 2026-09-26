// v0.235.0 (audit E4): tokens at rest, encrypted by the main process. Electron is stubbed with a
// reversible fake safeStorage so the real electron/tokenVault.cjs runs: a pair set is on disk as
// bytes that do not contain the token, and comes back; forget; the atomic write; a machine without
// encryption keeps nothing on disk and says so; a file that cannot be decrypted is never written
// over; and the pure refresh decision (reuse the vault's fresh pair, refresh with the vault's token
// when it is about to expire, never with a caller's stale one).
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etc-vault-'));
let encryptionOn = true;
const fake = {
  isEncryptionAvailable: () => encryptionOn,
  // a fake cipher: byte-wise XOR with a key and a marker — good enough to prove the plaintext is not on disk
  encryptString: (s) => Buffer.concat([Buffer.from('VAULT1'), Buffer.from(s, 'utf8').map((b) => b ^ 0x5a)]),
  decryptString: (buf) => { if (buf.subarray(0, 6).toString() !== 'VAULT1') throw new Error('not ours'); return Buffer.from(buf.subarray(6)).map((b) => b ^ 0x5a).toString('utf8'); },
};
const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: { app: { getPath: () => tmp }, safeStorage: fake } };
const V = require('../electron/tokenVault.cjs');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const FILE = path.join(tmp, 'tokens.enc');
const pair = (id, n) => ({ characterId: id, characterName: `Pilot ${id}`, accessToken: `access-${id}-${n}`, refreshToken: `refresh-${id}-${n}`, expiresAt: 1_800_000_000_000 });

// ---- store and read back
V._reset();
eq('1 an empty vault: available, nothing stored, no file', [V.status(), fs.existsSync(FILE)], [{ available: true, loadFailed: false, count: 0 }, false]);
eq('2 a pair is kept', V.set(pair(1, 1)), true);
eq('3 …and the file exists, without the token in plaintext', [fs.existsSync(FILE), fs.readFileSync(FILE).includes('refresh-1-1'), fs.readdirSync(tmp).some((f) => f.endsWith('.tmp'))], [true, false, false]);
V.set(pair(2, 1));
eq('4 both come back by id, and all() keys by id string', [V.get(1).refreshToken, V.get(2).characterName, Object.keys(V.all())], ['refresh-1-1', 'Pilot 2', ['1', '2']]);
V._reset(); // a fresh process
eq('5 a new process reads the file back', [V.get(1).accessToken, V.status().count], ['access-1-1', 2]);
eq('6 a refresh replaces the pair', (() => { V.set(pair(1, 2)); V._reset(); return V.get(1).refreshToken; })(), 'refresh-1-2');
eq('7 forget removes one and keeps the other', (() => { V.forget(1); V._reset(); return Object.keys(V.all()); })(), ['2']);
eq('8 junk is refused', [V.set(null), V.set({ characterId: 3 }), V.set({ characterId: 'x', accessToken: 'a', refreshToken: 'r' })], [false, false, false]);

// ---- no encryption on this machine: nothing on disk, and the status says so
fs.rmSync(FILE); V._reset(); encryptionOn = false;
eq('9 without encryption a set is refused and no file appears', [V.set(pair(5, 1)), fs.existsSync(FILE), V.status().available], [false, false, false]);
encryptionOn = true; V._reset();

// ---- a file that cannot be decrypted is never overwritten
fs.writeFileSync(FILE, Buffer.from('garbage that is not ours'));
V._reset();
eq('10 an undecryptable file → loadFailed, nothing loaded, a set is refused, the file untouched', [V.status().loadFailed, V.status().count, V.set(pair(1, 1)), fs.readFileSync(FILE).toString()], [true, 0, false, 'garbage that is not ours']);
fs.rmSync(FILE); V._reset();

// ---- the refresh decision
const T = 1_800_000_000_000;
const stored = { accessToken: 'a', refreshToken: 'r-vault', expiresAt: T + 10 * 60_000 };
eq('11 no vault entry: refresh with the caller\'s token (the migration path)', V.decideRefresh(null, 'r-caller', T), { action: 'refresh', refreshToken: 'r-caller' });
eq('12 no vault entry and no caller token: nothing to do', V.decideRefresh(null, '', T), { action: 'none' });
eq('13 the vault holds a pair good for 10 min and the caller\'s is stale: hand the vault\'s back, ask EVE nothing', V.decideRefresh(stored, 'r-old', T), { action: 'reuse', tokens: stored });
eq('14 …the same when the caller already holds it (no refresh token is ever burnt for a valid access token)', V.decideRefresh(stored, 'r-vault', T), { action: 'reuse', tokens: stored });
eq('15 the vault\'s access token expires within the margin: refresh, with the VAULT\'s refresh token, whatever the caller sent', V.decideRefresh({ ...stored, expiresAt: T + 30_000 }, 'r-old', T), { action: 'refresh', refreshToken: 'r-vault' });
eq('16 the margin is one minute', V.REUSE_MARGIN_MS, 60_000);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
