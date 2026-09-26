// 2026-09-23 (code signing): the update feed is repaired after the installer is signed.
//   patchLatestYml — the installer's sha512 and size replaced in the file entry and at the top level,
//   every other line byte-identical; a file whose shape is not the one electron-builder writes is
//   reported (touched count) so the caller refuses to write it.
//   buildBlockMap (electron-builder's own) on a file of this fixture's making: the sha512 it returns is
//   the file's real SHA-512 (base64), the size is the file's size, and the blockmap file is gzip.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

(async () => {
  const R = await import('../scripts/repair-feed.mjs');

  // ---- patchLatestYml on the shape electron-builder 26 writes (measured from release/latest.yml)
  const yml = [
    'version: 0.238.0',
    'files:',
    '  - url: EVE-Conductor-Setup-0.238.0.exe',
    '    sha512: OLDOLDOLD==',
    '    size: 111',
    'path: EVE-Conductor-Setup-0.238.0.exe',
    'sha512: OLDOLDOLD==',
    "releaseDate: '2026-09-23T17:14:02.191Z'",
    '',
  ].join('\n');
  const r = R.patchLatestYml(yml, 'EVE-Conductor-Setup-0.238.0.exe', 'NEWNEWNEW==', 222);
  eq('1 three lines touched: the file entry\'s sha512 and size, and the top-level sha512', r.touched, 3);
  eq('2 the patched file', r.text.split('\n'), [
    'version: 0.238.0',
    'files:',
    '  - url: EVE-Conductor-Setup-0.238.0.exe',
    '    sha512: NEWNEWNEW==',
    '    size: 222',
    'path: EVE-Conductor-Setup-0.238.0.exe',
    'sha512: NEWNEWNEW==',
    "releaseDate: '2026-09-23T17:14:02.191Z'",
    '',
  ]);
  // a second file entry (the portable build, if it were ever in the feed) is left alone
  const two = yml.replace('path:', '  - url: EVE-Conductor-Portable-0.238.0.exe\n    sha512: PORTABLE==\n    size: 333\npath:');
  const r2 = R.patchLatestYml(two, 'EVE-Conductor-Setup-0.238.0.exe', 'NEWNEWNEW==', 222);
  eq('3 another file entry is untouched', [r2.touched, r2.text.includes('sha512: PORTABLE=='), r2.text.includes('size: 333')], [3, true, true]);
  // the emergency marker lines (updatePolicy.cjs) survive
  const marked = yml + 'emergency: true\nemergencyReason: harming a partner\n';
  const r3 = R.patchLatestYml(marked, 'EVE-Conductor-Setup-0.238.0.exe', 'NEWNEWNEW==', 222);
  eq('4 lines the app adds to the feed survive', [r3.touched, r3.text.endsWith('emergency: true\nemergencyReason: harming a partner\n')], [3, true]);
  eq('5 a file without the top-level sha512 reports 2, so the caller refuses to write', R.patchLatestYml(yml.replace('\nsha512: OLDOLDOLD==', ''), 'EVE-Conductor-Setup-0.238.0.exe', 'X', 1).touched, 2);

  // ---- buildBlockMap on a file of our own
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'feedrepair-'));
  const file = path.join(tmp, 'EVE-Conductor-Setup-9.9.9.exe');
  const bytes = crypto.randomBytes(300_000);
  fs.writeFileSync(file, bytes);
  const info = await R.buildBlockMap(file, 'gzip', file + '.blockmap');
  const sha = crypto.createHash('sha512').update(bytes).digest('base64');
  eq('6 electron-builder\'s blockmap builder returns the file\'s real SHA-512 (base64) and size', [info.sha512 === sha, info.size], [true, 300_000]);
  const bm = fs.readFileSync(file + '.blockmap');
  eq('7 the blockmap file is gzip and non-trivial', [bm[0], bm[1], bm.length > 100], [0x1f, 0x8b, true]);
  // sign-like change: append bytes (a real signature appends a certificate table) → different sha, different blockmap
  fs.appendFileSync(file, crypto.randomBytes(5_000));
  const info2 = await R.buildBlockMap(file, 'gzip', file + '.blockmap');
  eq('8 after the bytes change the sha512 and size change with them', [info2.sha512 !== info.sha512, info2.size], [true, 305_000]);
  fs.rmSync(tmp, { recursive: true, force: true });

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.log('FAIL: fixture died: ' + (e && e.stack || e)); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
