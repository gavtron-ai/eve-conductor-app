// v0.232.0 (audit E5): the clone registry in the main process — electron/cloneStore.cjs had no fixture.
// Electron is stubbed (app paths → a temp folder, no IPC, no windows) so the real module runs: recording
// observations, the fingerprint prune (90 days, 128 per character, pinned records never evicted), the
// user's edits (name length, colour validation), forgetting, the debounced atomic save, a damaged file
// moved aside, and the refusal to write over a file that could not be read.
const fs = require('fs');
const os = require('os');
const path = require('path');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etc-clones-'));
const userData = path.join(tmp, 'userData'); const documents = path.join(tmp, 'Documents');
fs.mkdirSync(userData); fs.mkdirSync(documents);
const electronPath = require.resolve('electron');
require.cache[electronPath] = { id: electronPath, filename: electronPath, loaded: true, exports: {
  app: { getPath: (k) => (k === 'userData' ? userData : documents), on: () => {} },
  ipcMain: { handle: () => {}, on: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
} };
const C = require('../electron/cloneStore.cjs');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const REG = path.join(userData, 'clone-registry.json');
const DAY = 86_400_000;
const T0 = 1_800_000_000_000;
const obs = (characterId, sig, over = {}) => ({ characterId, sig, implants: sig.split(',').map(Number), names: [], label: 'LEARNING', characterName: 'Pilot', worn: true, ...over });

(async () => {
  C._reset();
  // ---- recording
  C.record(obs(1, '1,2,3'), T0);
  C.record(obs(1, '4,5', { worn: false, esiName: 'Snake' }), T0 + 1000);
  let d = C.all();
  eq('1 two fingerprints recorded for the character, with first/seen/lastWorn/lastListed as observed (the prune keeps them newest first — sorted here by fingerprint)',
    Object.entries(d.chars['1']).sort((a, b) => a[0].localeCompare(b[0])).map(([sig, r]) => [sig, r.first, r.seen, r.lastWorn, r.lastListed, r.esiName]),
    [['1,2,3', T0, T0, T0, 0, ''], ['4,5', T0 + 1000, T0 + 1000, 0, T0 + 1000, 'Snake']]);
  C.record(obs(1, '4,5', { worn: true, esiName: '' }), T0 + 2000);
  eq('2 a later observation without a name never erases the name known', [C.all().chars['1']['4,5'].esiName, C.all().chars['1']['4,5'].lastWorn], ['Snake', T0 + 2000]);
  eq('3 junk observations are ignored', (() => { C.record(null); C.record({ characterId: 'x', sig: '1' }); C.record({ characterId: 2, sig: '' }); return Object.keys(C.all().chars); })(), ['1']);

  // ---- the save: debounced, atomic, to userData
  await wait(500);
  eq('4 the registry is on disk after the debounce, and no .tmp is left', [fs.existsSync(REG), fs.readdirSync(userData).filter((f) => f.endsWith('.tmp'))], [true, []]);
  eq('5 …holding what memory holds', JSON.parse(fs.readFileSync(REG, 'utf8')).chars['1']['4,5'].esiName, 'Snake');

  // ---- the prune: age, cap, pinned
  C._reset();
  const byChar = {};
  for (let i = 0; i < 130; i++) byChar[`sig${i}`] = { seen: T0 - i * 3_600_000 };  // 130 fingerprints, one an hour older each (all within 90 days)
  byChar['old-but-named'] = { seen: T0 - 400 * DAY, customName: 'Keeper' };  // 400 days old, named
  byChar['old-unnamed'] = { seen: T0 - 100 * DAY };                            // 100 days old, nothing
  const pruned = C.prune(byChar, T0);
  eq('6 a 100-day-old unnamed fingerprint is dropped; a named one is kept however old', ['old-unnamed' in pruned, 'old-but-named' in pruned], [false, true]);
  eq('7 the cap is 128 per character, newest first, and the named one counts among them (131 live → 128: the named one + sig0…sig126)', [Object.keys(pruned).length, 'sig0' in pruned, 'sig127' in pruned, 'sig126' in pruned], [128, true, false, true]);
  eq('7b the age rule alone: 130 fingerprints one a DAY older each → only the 90 younger than ninety days survive', Object.keys(C.prune(Object.fromEntries(Array.from({ length: 130 }, (_, i) => [`d${i}`, { seen: T0 - i * DAY }])), T0)).length, 90);

  // ---- the user's edits
  C._reset({ v: 1, chars: { '1': { '1,2,3': { seen: T0, implants: [1, 2, 3], names: [] } } } });
  C.setConfig({ characterId: 1, sig: '1,2,3', customName: 'x'.repeat(60), alert: { blink: true, color: 'javascript:alert(1)' } });
  const r = C.all().chars['1']['1,2,3'];
  eq('8 a custom name is cut to 40 characters; a colour that is not #rrggbb becomes the default red', [r.customName.length, r.alert], [40, { blink: true, color: '#ff4d4d' }]);
  C.setConfig({ characterId: 1, sig: '1,2,3', alert: { blink: false, color: '#00AaFf' } });
  eq('9 a valid colour is kept as typed', C.all().chars['1']['1,2,3'].alert, { blink: false, color: '#00AaFf' });
  C.setConfig({ characterId: 1, sig: '1,2,3', customName: '', alert: null });
  eq('10 clearing both removes the keys (the record is no longer pinned)', ['customName' in C.all().chars['1']['1,2,3'], 'alert' in C.all().chars['1']['1,2,3']], [false, false]);
  eq('11 an edit for an unknown fingerprint changes nothing', (() => { const before = JSON.stringify(C.all()); C.setConfig({ characterId: 1, sig: 'nope', customName: 'x' }); return JSON.stringify(C.all()) === before; })(), true);
  C.forget({ characterId: 1, sig: '1,2,3' });
  eq('12 forget removes the fingerprint', C.all().chars['1'], {});

  // ---- a damaged file is moved aside, not overwritten; an unreadable one blocks writes
  await wait(500);
  fs.writeFileSync(REG, '{not json');
  C._reset(); C._reset(undefined); // back to "not loaded" is not exposed — reload through a fresh module instance
  delete require.cache[require.resolve('../electron/cloneStore.cjs')];
  const C2 = require('../electron/cloneStore.cjs');
  C2.record(obs(7, '9,9'), T0);
  const corrupt = fs.readdirSync(userData).filter((f) => f.startsWith('clone-registry.json.corrupt-'));
  eq('13 a damaged registry is kept as a .corrupt-* copy and a fresh one starts', [corrupt.length, Object.keys(C2.all().chars)], [1, ['7']]);
  await wait(500);
  eq('14 …and the fresh one is written', JSON.parse(fs.readFileSync(REG, 'utf8')).chars['7']['9,9'].seen, T0);

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
