// BACKUP LISTING + RADAR MONTHS (v0.220.0) — electron/stats.cjs against a real temp folder.
// The export used to read every aux file into one JSON string (measured 2026-09-23: 784 MB →
// "Invalid string length"). Now: big files, the raw radar months and the public killmail archive
// are left out and NAMED; the radar months can be listed and deleted — and nothing else can.
//   node tests/statsbackup.test.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const stats = require('../electron/stats.cjs');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'etc-backup-'));
const dir = stats.statsDir(docs);
fs.mkdirSync(dir, { recursive: true });
const put = (name, content) => fs.writeFileSync(path.join(dir, name), content);
put('theft-raids.ndjson', '{"t":1,"kind":"raided"}\n');
put('ship-history.ndjson', '{"a":1}\n');
put('fits-backup-2026-08-01.json', '[]');
put('radar-wip.json', '{"day":"2026-09-23","rows":[],"cov":[]}');
put('radar-coverage.json', '[]');
put('radar-2026-08.ndjson', 'x\n');                                              // a raw month: write-only
put('radar-2026-09.ndjson', 'y\n');
put('battle-corp-killmails.ndjson', '{"id":1}\n');                                // public, re-read by itself
put('radar-summary.json', Buffer.alloc(stats.BACKUP_MAX_BYTES + 1, 0x20).toString()); // the pre-0.229 blob (too big, and radar history)
put('radar-summary-10000002.json', '{"v":2,"r":10000002,"entries":[]}');           // a small region summary: radar history, not carried
put('radar-summary.legacy.json', '[]');                                            // the blob kept after its split
put('notes.txt', 'not an aux file');                                             // never listed

const r = stats.listAuxFiles(docs);
eq('B1 carried: the small, real history files, sorted', r.files.map((f) => f.name),
  ['fits-backup-2026-08-01.json', 'radar-coverage.json', 'radar-wip.json', 'ship-history.ndjson', 'theft-raids.ndjson']);
eq('B2 carried files come with their content', r.files.find((f) => f.name === 'theft-raids.ndjson').content, '{"t":1,"kind":"raided"}\n');
eq('B3 left out, each with its reason', r.skipped.map((f) => [f.name, f.why.replace(/^\d+ MB/, 'N MB')]), [
  ['battle-corp-killmails.ndjson', 'public data the app re-reads by itself'],
  ['radar-2026-08.ndjson', 'raw radar rows — no longer written, read by nothing'],
  ['radar-2026-09.ndjson', 'raw radar rows — no longer written, read by nothing'],
  ['radar-summary-10000002.json', 'radar history — tens of MB; the installer\'s seed carries the shared part'],
  ['radar-summary.json', 'radar history — tens of MB; the installer\'s seed carries the shared part'],
  ['radar-summary.legacy.json', 'raw radar rows — no longer written, read by nothing'],
]);
eq('B4 the skipped entries carry their size', r.skipped.find((f) => f.name === 'radar-summary.json').size, stats.BACKUP_MAX_BYTES + 1);
eq('B5 a whole backup payload of what is carried stringifies without trouble', typeof JSON.stringify({ auxFiles: r.files, auxSkipped: r.skipped }), 'string');

// ---- the radar months
// v0.229.0: the pre-0.229 summary blob kept after its split is listed and deleted with the raw months
eq('R1 the raw months and the kept blob are listed with sizes', stats.listRadarMonths(docs), [{ name: 'radar-2026-08.ndjson', size: 2 }, { name: 'radar-2026-09.ndjson', size: 2 }, { name: 'radar-summary.legacy.json', size: 2 }]);
const d = stats.deleteRadarMonths(docs);
eq('R2 deleting removes exactly those and reports the bytes', d, { deleted: 3, bytes: 6 });
eq('R3 nothing else was touched (README.txt is the folder\'s own)', fs.readdirSync(dir).sort(), ['README.txt', 'battle-corp-killmails.ndjson', 'fits-backup-2026-08-01.json', 'notes.txt', 'radar-coverage.json', 'radar-summary-10000002.json', 'radar-summary.json', 'radar-wip.json', 'ship-history.ndjson', 'theft-raids.ndjson']);
eq('R4 a second delete finds nothing', stats.deleteRadarMonths(docs), { deleted: 0, bytes: 0 });
eq('R5 radar-summary.json and radar-wip.json never match the month pattern', stats.listRadarMonths(docs), []);

fs.rmSync(docs, { recursive: true, force: true });
console.log(`statsbackup.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
