// v0.229.0 (audit B2): the radar summary as one compact file per region. Fixtures on the SHIPPED
// codec in electron/radarSummary.cjs and its renderer twin (src/lib/radarSummaryFormat.ts,
// compiled to sim/lib): the two encode byte-identically and decode to the same entries; a round
// trip keeps every field the readers use; the one-time migration splits the old blob into region
// files, reads each back, and only then renames the blob — and leaves everything alone when it
// cannot. Sizes on a hand-built entry show why: no key names, day numbers, whole ISK.
const fs = require('fs');
const os = require('os');
const path = require('path');
const M = require('../electron/radarSummary.cjs');
global.window = { appInfo: undefined };
const R = require('./sim/lib/radarSummaryFormat.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got).slice(0, 300)}\n   want ${JSON.stringify(want).slice(0, 300)}`}`);
  ok ? pass++ : fail++;
};

const FORGE = 10000002, DOMAIN = 10000043;
const hist = (seed) => Array.from({ length: 24 }, (_, h) => (h * 7 + seed) % 11);
const entry = (r, t, s, days, seed = 1) => ({ r, t, s, days, hfa: hist(seed).map((v) => v * 1000.4), hra: hist(seed + 3) });
const day = (d, rp, fi, fk, co, bp) => ({ d, rp, fi, fk, co, bp });
const e1 = entry(FORGE, 34, 0, [day('2026-08-23', 27, 168, 329919000.49, 32, 1940000.005), day('2026-08-24', 26, 108, 208683000, 33, 1918000)]);
const e2 = entry(FORGE, 34, 1, [day('2026-09-01', 3, 10, 12345.6, 4, 5.129)], 5);
const e3 = entry(DOMAIN, 587, 0, [day('2026-09-22', 1, 2, 3, 4, 5.5)], 9);
const all = [e1, e2, e3];

// ---- dates
eq('1 dayNum: 2026-08-23 → 20688 (UTC days since 1970), and back', [M.dayNum('2026-08-23'), M.dayStr(20688), R.dayNum('2026-08-23'), R.dayStr(20688)], [20688, '2026-08-23', 20688, '2026-08-23']);
eq('2 dayNum: 1970-01-01 is 0, 2000-02-29 round-trips (leap day)', [M.dayNum('1970-01-01'), M.dayStr(M.dayNum('2000-02-29'))], [0, '2000-02-29']);

// ---- the two codecs
const textM = M.encodeRegion(FORGE, all);
const textR = R.encodeRegion(FORGE, all);
eq('3 main and renderer encode The Forge byte-identically (Domain\'s entry left out)', textM === textR, true);
const doc = JSON.parse(textM);
eq('4 the v2 shape: v, r, and rows without key names', [doc.v, doc.r, doc.entries.length, doc.entries[0].length, doc.entries[0][0], doc.entries[0][1]], [2, FORGE, 2, 5, 34, 0]);
eq('5 a day row: [dayNum, rp, fi, fk (whole ISK), co, bp (2 dp)]', doc.entries[0][2][0], [20688, 27, 168, 329919000, 32, 1940000.01]);
eq('6 the hour histograms: hfa rounded to whole ISK, hra as it was', [doc.entries[0][3][1], doc.entries[0][4][1]], [Math.round(e1.hfa[1]), e1.hra[1]]);
const backM = M.decodeRegion(textM);
const backR = R.decodeRegion(textR);
eq('7 both decode to the same entries', JSON.stringify(backM) === JSON.stringify(backR), true);
eq('8 the round trip keeps r, t, s, the dates, counts, and ISK to the whole unit', backM.map((e) => [e.r, e.t, e.s, e.days.map((d) => [d.d, d.rp, d.fi, d.fk, d.co, d.bp])]),
  [[FORGE, 34, 0, [['2026-08-23', 27, 168, 329919000, 32, 1940000.01], ['2026-08-24', 26, 108, 208683000, 33, 1918000]]], [FORGE, 34, 1, [['2026-09-01', 3, 10, 12346, 4, 5.13]]]]);
eq('9 a second encode of the decoded entries is byte-identical (the rounding is idempotent)', M.encodeRegion(FORGE, backM) === textM, true);
eq('10 the compact text is smaller than the same entries as v1 objects', textM.length < JSON.stringify(all.filter((e) => e.r === FORGE)).length, true);
let threw = 0;
for (const bad of ['[]', '{"v":1,"r":1,"entries":[]}', '{"v":2,"entries":[]}', 'nope']) { try { M.decodeRegion(bad); } catch { threw++; } }
eq('11 anything that is not a v2 region file throws (never silently empty)', threw, 4);
eq('12 splitByRegion groups by r and drops junk', [...M.splitByRegion([...all, null, { t: 1 }]).entries()].map(([r, l]) => [r, l.length]), [[FORGE, 2], [DOMAIN, 1]]);

// ---- the migration on disk
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etc-radarsummary-'));
const legacy = path.join(tmp, 'radar-summary.json');
eq('13 no blob → nothing to do (null)', M.migrateRadarSummary(tmp), null);
fs.writeFileSync(legacy, JSON.stringify(all));
const m = M.migrateRadarSummary(tmp);
eq('14 the blob is split into a file per region, read back, and renamed', [m.regions, m.skipped, m.entries, fs.existsSync(legacy), fs.existsSync(path.join(tmp, 'radar-summary.legacy.json'))], [[FORGE, DOMAIN], [], 3, false, true]);
eq('15 the region files decode to the entries', [M.readRegion(tmp, FORGE).length, M.readRegion(tmp, DOMAIN).map((e) => e.t)], [2, [587]]);
eq('16 the files listed, with their region ids', M.listRegionFiles(tmp).map((f) => f.regionId).sort(), [FORGE, DOMAIN]);
eq('17 a second run finds no blob (idempotent)', M.migrateRadarSummary(tmp), null);
eq('18 bytes: after < before', m.bytesAfter < m.bytesBefore, true);
// a partial earlier run: The Forge already split — left alone, the rest done
fs.rmSync(path.join(tmp, 'radar-summary-' + DOMAIN + '.json'));
fs.rmSync(path.join(tmp, 'radar-summary.legacy.json'));
M.writeRegion(tmp, FORGE, [entry(FORGE, 999, 0, [day('2026-09-23', 1, 1, 1, 1, 1)])]); // the user's newer Forge file
fs.writeFileSync(legacy, JSON.stringify(all));
const m2 = M.migrateRadarSummary(tmp);
eq('19 an existing region file is never overwritten; the others are written; the blob still renamed', [m2.regions, m2.skipped, M.readRegion(tmp, FORGE).map((e) => e.t), M.readRegion(tmp, DOMAIN).length], [[DOMAIN], [FORGE], [999], 1]);
// a broken blob: nothing changes
fs.rmSync(path.join(tmp, 'radar-summary-' + DOMAIN + '.json'));
fs.rmSync(path.join(tmp, 'radar-summary.legacy.json'));
fs.writeFileSync(legacy, '[{"r":1,');
const m3 = M.migrateRadarSummary(tmp);
eq('20 a broken blob: an error, the blob untouched, no region file written', [typeof m3.error, fs.readFileSync(legacy, 'utf8'), fs.existsSync(path.join(tmp, 'radar-summary-1.json'))], ['string', '[{"r":1,', false]);
eq('21 readRegion of an absent region is [] (a region the radar never watched)', M.readRegion(tmp, 12345), []);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
