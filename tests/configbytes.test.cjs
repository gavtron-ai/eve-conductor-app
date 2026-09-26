// v0.233.0 (audit E6): the hand-editable files, read from REAL BYTES. Notepad saves "UTF-8 with BOM"
// or "UTF-16 LE" when asked; a byte order mark made JSON.parse throw and every reader returned empty —
// a re-saved config.json silently lost the EVE application id. These fixtures write config.json, the
// portable clone labels and the haul log in four encodings (plus Windows line ends) and read every
// value back through the SHIPPED electron/appConfig.cjs; then the same for the clone registry and the
// backup import's text.
const fs = require('fs');
const os = require('os');
const path = require('path');
const cfg = require('../electron/appConfig.cjs');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// the four ways an editor writes the same text
const enc = {
  'utf8': (t) => Buffer.from(t, 'utf8'),
  'utf8-bom': (t) => Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(t, 'utf8')]),
  'utf16le-bom': (t) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(t, 'utf16le')]),
  'utf16be-bom': (t) => { const b = Buffer.from(t, 'utf16le'); b.swap16(); return Buffer.concat([Buffer.from([0xfe, 0xff]), b]); },
};
const CRLF = (t) => t.replace(/\n/g, '\r\n');

// ---- the decoder itself
eq('1 decodeTextBytes: UTF-8 with BOM → the text without the mark', cfg.decodeTextBytes(enc['utf8-bom']('{"a":1}')), '{"a":1}');
eq('2 UTF-16 LE with BOM', cfg.decodeTextBytes(enc['utf16le-bom']('{"a":"ü€"}')), '{"a":"ü€"}');
eq('3 UTF-16 BE with BOM', cfg.decodeTextBytes(enc['utf16be-bom']('{"a":"ü€"}')), '{"a":"ü€"}');
eq('4 plain UTF-8, and a stray U+FEFF in the text itself', [cfg.decodeTextBytes(enc.utf8('{"a":1}')), cfg.decodeTextBytes(Buffer.from('﻿{"a":2}', 'utf8'))], ['{"a":1}', '{"a":2}']);
eq('5 an empty file decodes to an empty string (and readJsonFile then throws, caught by every reader)', cfg.decodeTextBytes(Buffer.alloc(0)), '');

// ---- the three files, in each encoding, with Windows line ends
const CONFIG = '{\n  "eveClientId": "0123456789abcdef0123456789abcdef",\n  "transitShipName": "Hauler One",\n  "apertureUrl": "",\n  "chainHome": "Florida"\n}\n';
const CLONES = '{\n  "1,2,3": { "customName": "Snake", "alert": { "blink": true, "color": "#00aaff" } },\n  "4,5": { "customName": "Learning" }\n}\n';
const HAULS = '{\n  "v": 1,\n  "hauls": [ { "t": 1, "isk": 1500000, "from": "J123456", "note": "salvage" } ]\n}\n';
for (const [name, e] of Object.entries(enc)) {
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), `etc-bytes-${name}-`));
  const dir = path.join(docs, cfg.FOLDER_NAME); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, cfg.FILE_NAME), e(CRLF(CONFIG)));
  fs.writeFileSync(path.join(dir, cfg.CLONES_FILE), e(CRLF(CLONES)));
  fs.writeFileSync(path.join(dir, cfg.HAULS_FILE), e(CRLF(HAULS)));
  const c = cfg.read(docs);
  eq(`6 config.json as ${name} + CRLF: every value read`, [c.eveClientId, c.transitShipName, c.apertureUrl, c.chainHome], ['0123456789abcdef0123456789abcdef', 'Hauler One', '', 'Florida']);
  eq(`7 clone labels as ${name}: names and the alert read`, cfg.readClones(docs), { '1,2,3': { customName: 'Snake', alert: { blink: true, color: '#00aaff' } }, '4,5': { customName: 'Learning' } });
  eq(`8 the haul log as ${name}: the entry read`, cfg.readHauls(docs).hauls, [{ t: 1, isk: 1500000, from: 'J123456', note: 'salvage' }]);
  // the write side merges into what was read and writes PLAIN bytes: a BOM'd file is healed, not doubled
  cfg.write(docs, { transitShipName: 'Hauler Two' });
  const bytes = fs.readFileSync(path.join(dir, cfg.FILE_NAME));
  eq(`9 after a write the file is plain UTF-8 (no mark) and keeps the id read from the ${name} file`, [bytes[0] === 0x7b || bytes[0] === 0x0a, cfg.read(docs).eveClientId, cfg.read(docs).transitShipName], [true, '0123456789abcdef0123456789abcdef', 'Hauler Two']);
  fs.rmSync(docs, { recursive: true, force: true });
}

// ---- a truncated file still reads as empty (never a crash), whatever the mark
{
  const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'etc-bytes-trunc-'));
  const dir = path.join(docs, cfg.FOLDER_NAME); fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, cfg.FILE_NAME), enc['utf8-bom']('{"eveClientId": "abc'));
  eq('10 a truncated config reads as the empty setup', cfg.read(docs).eveClientId, '');
  fs.rmSync(docs, { recursive: true, force: true });
}

// ---- the clone registry (userData) through the same decoder
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etc-bytes-reg-'));
  const userData = path.join(tmp, 'userData'); const documents = path.join(tmp, 'Documents');
  fs.mkdirSync(userData); fs.mkdirSync(documents);
  const electronPath = require.resolve('electron');
  require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: {
    app: { getPath: (k) => (k === 'userData' ? userData : documents), on: () => {} },
    ipcMain: { handle: () => {}, on: () => {} }, BrowserWindow: { getAllWindows: () => [] },
  } };
  fs.writeFileSync(path.join(userData, 'clone-registry.json'), enc['utf16le-bom'](CRLF('{ "v": 1, "chars": { "7": { "9,9": { "seen": 5, "customName": "Kept" } } } }\n')));
  const C = require('../electron/cloneStore.cjs');
  eq('11 a registry saved as UTF-16 LE with BOM is read, not moved aside as corrupt', [C.all().chars['7']['9,9'].customName, fs.readdirSync(userData).some((f) => f.includes('.corrupt-'))], ['Kept', false]);
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ---- the backup import's text (file.text() keeps a leading U+FEFF)
{
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.window = { appInfo: undefined, localStorage: global.localStorage };
  const B = require('./sim/lib/backup.js');
  B.importBackupText('﻿{"format":"nope"}').then(() => eq('12 (unreachable)', 1, 0), (e) => eq('12 a backup text with a leading mark parses — the error is about the format, not "unreadable JSON"', String(e.message), 'Not an EVE Conductor backup file.'))
    .then(() => { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail > 0 ? 1 : 0); });
}
