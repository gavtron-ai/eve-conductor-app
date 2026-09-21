// BASELINE MERGE (v0.213.0) — an update's newer seed fills the GAPS in a user's own history and
// never double-counts. Every expectation below is worked out by hand from the inputs.
//   node tests/baseline.test.cjs
const fs = require('fs');
const os = require('os');
const path = require('path');
const B = require('../electron/baseline.cjs');

let passed = 0, failed = 0;
const check = (label, cond, extra) => { if (cond) passed++; else { failed++; console.log('FAIL ' + label + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };
const H = 3_600_000;
const T0 = Date.UTC(2026, 7, 1, 0, 0, 0); // 2026-08-01 00:00 UTC

// ---------------------------------------------------------------- raid log
// the seed watched four hours; the user's own app watched hour 1 only
const seed = [
  { t: T0 + 10 * 60_000, planetId: 1, systemId: 9, kind: 'survived', windowMin: 120 },            // hour 0 — user absent → IN
  { t: T0 + H + 5 * 60_000, planetId: 2, systemId: 9, kind: 'raided', intoWindowMin: 20 },        // hour 1 — user was watching → OUT
  { t: T0 + 2 * H + 1_000, planetId: 3, systemId: 9, kind: 'raided', intoWindowMin: 40 },         // hour 2 — but the user saw planet 3's window himself at hour 1 → OUT (same window)
  { t: T0 + 3 * H, planetId: 4, systemId: 9, kind: 'survived' },                                   // hour 3 — user holds this exact event (from an older seed) → already
  { t: T0 + 3 * H + 60_000, planetId: 5, systemId: 9, kind: 'unknown', blindTailMin: 9 },         // hour 3 — the user's only event that hour came from the seed → IN
  { t: T0 + 4 * H, planetId: 6, systemId: 9, kind: 'mine', note: 'secret' },                       // personal → never
  { t: T0 + 4 * H, planetId: 7, systemId: 9, kind: 'raided', resolvedBy: 'bar', wasKind: 'survived' }, // changed by a bar reading → never
];
const own = [
  { t: T0 + H + 7 * 60_000, planetId: 3, systemId: 9, kind: 'raided', intoWindowMin: 31 },        // his own observation (not in the seed)
  { t: T0 + 3 * H, planetId: 4, systemId: 9, kind: 'survived' },                                   // identical to the seed's
  { t: T0 + 2 * H + 30 * 60_000, planetId: 8, systemId: 9, kind: 'mine' },                         // his own mark: watching nothing
];
const m = B.mergeRaidEvents(own, seed);
check('R1 two events fill gaps: planet 1 (hour 0) and planet 5 (hour 3)', m.add.length === 2 && m.add[0].planetId === 1 && m.add[1].planetId === 5, m.add);
check('R2 counts: 1 already held, 1 in a watched hour, 1 same window', m.already === 1 && m.watched === 1 && m.sameWindow === 1, m);
check('R3 personal kinds and bar-changed verdicts never travel', !m.add.some((e) => e.planetId === 6 || e.planetId === 7));
check('R4 only impersonal fields travel', Object.keys(m.add[1]).sort().join() === 'blindTailMin,kind,planetId,systemId,t', Object.keys(m.add[1]));
check('R5 a second merge of the same seed adds nothing', B.mergeRaidEvents([...own, ...m.add], seed).add.length === 0);
// a "mine" event in hour 2 must NOT make hour 2 watched — planet 3 was kept out by the same-window rule alone
const m2 = B.mergeRaidEvents(own.filter((e) => e.planetId !== 3), seed);
check('R6 without his own planet-3 event: hour 1 is unwatched, so planets 1, 2, 3 and 5 come in', m2.add.map((e) => e.planetId).join() === '1,2,3,5', m2.add.map((e) => e.planetId));
// 12 h is the same window, 13 h is not
const near = B.mergeRaidEvents([{ t: T0, planetId: 1, systemId: 9, kind: 'survived' }], [{ t: T0 + 12 * H, planetId: 1, systemId: 9, kind: 'raided' }, { t: T0 + 13 * H + 1, planetId: 1, systemId: 9, kind: 'raided' }]);
check('R7 same planet within 12 h = the same window (out); past it = another window (in)', near.add.length === 1 && near.add[0].t === T0 + 13 * H + 1 && near.sameWindow === 1, near);
check('R8 an empty own log takes every feed verdict (5 of 7)', B.mergeRaidEvents([], seed).add.length === 5);

// ---------------------------------------------------------------- radar
const day = (d, rp) => ({ d, rp, fi: rp * 10, fk: rp * 1000, co: 1, bp: 5 });
const covDay = (d, n) => ({ d, n, cv: new Array(24).fill(0), ms: n * 1_800_000 });
const seedCov = [
  { r: 1, days: [covDay('2026-08-01', 48), covDay('2026-08-02', 48), covDay('2026-08-03', 48), covDay('2026-08-05', 48)], na: 192, cva: new Array(24).fill(8) },
  { r: 2, days: [covDay('2026-08-02', 48), covDay('2026-08-04', 0)], na: 48, cva: new Array(24).fill(2) },
];
const seedSummary = [
  { r: 1, t: 34, s: 0, days: [day('2026-08-01', 1), day('2026-08-02', 2), day('2026-08-03', 3), day('2026-08-05', 5)], hfa: new Array(24).fill(7), hra: new Array(24).fill(7) },
  { r: 1, t: 35, s: 1, days: [day('2026-08-02', 20)], hfa: new Array(24).fill(1), hra: new Array(24).fill(1) },
  { r: 2, t: 34, s: 0, days: [day('2026-08-02', 9)], hfa: new Array(24).fill(1), hra: new Array(24).fill(1) },
];
const mkOwn = () => ({
  cov: [{ r: 1, days: [covDay('2026-08-02', 10)], na: 10, cva: new Array(24).fill(1) }],
  // 08-03 is in his summary although his coverage does not know it (older data): still HIS day
  sum: [{ r: 1, t: 34, s: 0, days: [day('2026-08-02', 200), day('2026-08-03', 300)], hfa: new Array(24).fill(4), hra: new Array(24).fill(4) }],
});
const exclude = new Set(['2026-08-05']); // "today"
const o = mkOwn();
const cand = B.radarCandidates(o.cov, seedCov, exclude);
check('D1 candidates from coverage: region 1 = 08-01 + 08-03 (not his 08-02, not today), region 2 = 08-02 (a day with n = 0 is no day)', [...cand.get(1)].join() === '2026-08-01,2026-08-03' && [...cand.get(2)].join() === '2026-08-02', [...cand]);
const picked = B.pickSeedRows(seedSummary, cand);
check('D2 only rows for candidate days are picked (item 35 had none)', picked.length === 2 && picked[0].rows.length === 2 && picked[1].r === 2, picked);
const r = B.applyRadar(o.sum, o.cov, seedCov, picked, cand);
const e34 = o.sum.find((e) => e.r === 1 && e.t === 34);
check('D3 his summary knew 08-03 → only 08-01 comes in for region 1; his 08-02 and 08-03 rows are untouched', e34.days.map((d) => `${d.d}:${d.rp}`).join() === '2026-08-01:1,2026-08-02:200,2026-08-03:300', e34.days);
check('D4 rows added = 2 (r1 08-01, r2 08-02), region-days added = 2', r.rowsAdded === 2 && r.daysAdded === 2, r);
check('D5 the all-time histograms are NOT added to (4 stays 4); a new entry starts them at 0', e34.hfa[0] === 4 && o.sum.find((e) => e.r === 2).hfa[0] === 0);
check('D6 coverage: region 1 gains 08-01 only, sorted; all-time count untouched (10)', o.cov[0].days.map((d) => d.d).join() === '2026-08-01,2026-08-02' && o.cov[0].na === 10, o.cov[0]);
check('D7 coverage: region 2 is created with its one day and a zero all-time', o.cov[1].r === 2 && o.cov[1].days.length === 1 && o.cov[1].na === 0);
// merging the same seed again changes nothing
const cand2 = B.radarCandidates(o.cov, seedCov, exclude);
const r2 = B.applyRadar(o.sum, o.cov, seedCov, B.pickSeedRows(seedSummary, cand2), cand2);
check('D8 a second merge adds nothing (08-03 is refused again by his summary)', r2.rowsAdded === 0 && r2.daysAdded === 0, r2);
// the ring: 31 newest days stay
const big = { cov: [], sum: [{ r: 1, t: 34, s: 0, days: Array.from({ length: 31 }, (_, i) => day(`2026-09-${String(i + 1).padStart(2, '0')}`.replace('2026-09-31', '2026-10-01'), 1)), hfa: [], hra: [] }] };
const c3 = B.radarCandidates(big.cov, seedCov, new Set());
B.applyRadar(big.sum, big.cov, seedCov, B.pickSeedRows(seedSummary, c3), c3);
check('D9 the 31-day ring keeps the newest: August seed days fall off a full September', big.sum[0].days.length === 31 && big.sum[0].days[0].d === '2026-09-01', big.sum[0].days[0]);

// ---------------------------------------------------------------- the launch step, on disk
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'etc-baseline-'));
const bdir = path.join(tmp, 'baseline'); const sdir = path.join(tmp, 'stats');
fs.mkdirSync(bdir); fs.mkdirSync(sdir);
const nd = (list) => list.map((e) => JSON.stringify(e)).join('\n') + '\n';
fs.writeFileSync(path.join(bdir, 'theft-raids.ndjson'), nd(seed));
fs.writeFileSync(path.join(bdir, 'radar-summary.json'), JSON.stringify(seedSummary));
fs.writeFileSync(path.join(bdir, 'radar-coverage.json'), JSON.stringify(seedCov));
fs.writeFileSync(path.join(bdir, 'baseline.json'), JSON.stringify({ id: 'abc', builtAt: 'x' }));
const o2 = mkOwn();
fs.writeFileSync(path.join(sdir, 'theft-raids.ndjson'), nd(own));
fs.writeFileSync(path.join(sdir, 'radar-summary.json'), JSON.stringify(o2.sum));
fs.writeFileSync(path.join(sdir, 'radar-coverage.json'), JSON.stringify(o2.cov));
fs.writeFileSync(path.join(sdir, 'radar-wip.json'), JSON.stringify({ day: '2026-08-01', rows: [], cov: [] }));
const now = Date.UTC(2026, 7, 5, 12);
const seededNow = B.seedBaseline(bdir, sdir);
check('L1 the stamp is not copied into the stats folder; nothing was missing', seededNow.seeded.length === 0 && !fs.existsSync(path.join(sdir, 'baseline.json')), seededNow);
const res = B.mergeBaseline(bdir, sdir, seededNow.seeded, now);
check('L2 raids: 2 appended, own lines still first and untouched', res.raids.added === 2 && fs.readFileSync(path.join(sdir, 'theft-raids.ndjson'), 'utf8').startsWith(nd(own)), res.raids);
// 08-01 is the day in his unsaved radar-wip → excluded; 08-03 is his; so only region 2's 08-02 comes in
check('L3 radar: the wip day (08-01) and today are left out → 1 region-day, 1 row', res.radar.regionDays === 1 && res.radar.rows === 1 && res.errors.length === 0, res);
check('L4 no .tmp files left, marker written', !fs.readdirSync(sdir).some((f) => f.endsWith('.tmp')) && JSON.parse(fs.readFileSync(path.join(sdir, 'baseline-merged.json'), 'utf8')).id === 'abc');
check('L5 the same baseline is never merged twice', B.mergeBaseline(bdir, sdir, [], now) === null);
fs.writeFileSync(path.join(bdir, 'baseline.json'), JSON.stringify({ id: 'def' }));
const again = B.mergeBaseline(bdir, sdir, [], now);
check('L6 a new stamp with the same content merges nothing new', again && again.raids.added === 0 && again.radar.rows === 0, again);
// a fresh install: everything is copied, nothing is merged, the marker is still written
const fresh = path.join(tmp, 'fresh');
const s3 = B.seedBaseline(bdir, fresh);
const r3 = B.mergeBaseline(bdir, fresh, s3.seeded, now);
check('L7 fresh install: 3 files copied, no merge work, marker written', s3.seeded.length === 3 && r3 && r3.raids === undefined && r3.radar === undefined && fs.existsSync(path.join(fresh, 'baseline-merged.json')), { s3, r3 });
// an old bake without a stamp: copy-only, exactly as before
fs.rmSync(path.join(bdir, 'baseline.json'));
check('L8 no stamp → no merge', B.mergeBaseline(bdir, sdir, [], now) === null);
// a broken own summary is left exactly as it was
fs.writeFileSync(path.join(bdir, 'baseline.json'), JSON.stringify({ id: 'ghi' }));
fs.writeFileSync(path.join(sdir, 'radar-summary.json'), '{broken');
fs.writeFileSync(path.join(sdir, 'radar-coverage.json'), '[]');
const broken = B.mergeBaseline(bdir, sdir, [], now);
check('L9 an unreadable own summary: error recorded, file untouched', broken.errors.length === 1 && fs.readFileSync(path.join(sdir, 'radar-summary.json'), 'utf8') === '{broken' && fs.readFileSync(path.join(sdir, 'radar-coverage.json'), 'utf8') === '[]', broken);
fs.rmSync(tmp, { recursive: true, force: true });

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
