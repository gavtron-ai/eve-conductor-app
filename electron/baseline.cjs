// BASELINE SEEDING (v0.188; merging since v0.213.0) — an install starts with the project's
// collected market / skyhook history instead of a cold start, and every UPDATE brings the newer
// history with it.
//
// The installer carries resources/baseline/ (built by scripts/build-baseline.mjs from an
// ALLOWLIST — only impersonal, publicly derived measurements: radar summary / coverage and the
// skyhook raid history; never wallets, orders, fits, trend events, or anything a player marked
// himself). On launch, BEFORE any window exists:
//   1. a baseline file MISSING from the user's stats folder is copied in (as before);
//   2. v0.213.0: a baseline NEWER than the last one merged fills the GAPS in the user's own
//      history — the hours and days his app was not watching. It never replaces, never
//      double-counts, and never touches what he observed himself:
//      · raid log: a seed event is APPENDED only when the user recorded nothing of his own in
//        that hour AND holds no verdict for the same planet within 12 h (MEASURED on 52,706
//        events: the same planet never yields two verdicts less than 63.9 h apart, so ±12 h can
//        only ever be the same window seen by two watchers). The file is only ever appended to.
//      · radar: a whole REGION-DAY is taken from the seed only when the user has no coverage and
//        no rows for that region on that day (and it is not today, nor the day in his unsaved
//        radar-wip). The rings are merged; the ALL-TIME hour histograms are left alone — they
//        cannot be split by day, so adding them would double-count.
// Rule 3 (integrity gates): anything that fails leaves the user's files exactly as they were.
const fs = require('fs');
const path = require('path');

const RAIDS = 'theft-raids.ndjson';
const SUMMARY = 'radar-summary.json';
const COVERAGE = 'radar-coverage.json';
const STAMP = 'baseline.json';
const MARKER = 'baseline-merged.json';
const FEED_KINDS = new Set(['raided', 'survived', 'unknown']);
const HOUR = 3_600_000;
const SAME_WINDOW_MS = 12 * HOUR;
const SUMMARY_RING = 31;
const COVERAGE_RING = 62;

/**
 * @param {string} baselineDir  resources/baseline in the installed app
 * @param {string} statsDir     the user's stats folder (created if absent)
 * @returns {{seeded: string[], skipped: string[]}}
 */
function seedBaseline(baselineDir, statsDir) {
  const seeded = [];
  const skipped = [];
  let files = [];
  try {
    files = fs.readdirSync(baselineDir).filter((f) => !f.startsWith('.') && f !== STAMP);
  } catch {
    return { seeded, skipped }; // no baseline packed (dev run) — nothing to do
  }
  fs.mkdirSync(statsDir, { recursive: true });
  for (const f of files) {
    const dest = path.join(statsDir, f);
    if (fs.existsSync(dest)) {
      skipped.push(f);
      continue;
    }
    fs.copyFileSync(path.join(baselineDir, f), dest);
    seeded.push(f);
  }
  return { seeded, skipped };
}

// ---------------------------------------------------------------- raid log (PURE)
const parseLines = (raw) => {
  const out = [];
  for (const line of String(raw).split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a torn line is skipped */ }
  }
  return out;
};
const raidKey = (e) => `${e.planetId}:${e.kind}:${e.t}`;
const isFeed = (e) => e && FEED_KINDS.has(e.kind) && typeof e.t === 'number' && typeof e.planetId === 'number' && e.resolvedBy === undefined;

/** PURE: which seed events fill gaps in the user's own raid log */
function mergeRaidEvents(own, seed) {
  const seedFeed = seed.filter(isFeed);
  const seedKeys = new Set(seedFeed.map(raidKey));
  const ownKeys = new Set();
  const watchedHours = new Set();
  const byPlanet = new Map();
  for (const e of own) {
    if (!e || typeof e.t !== 'number') continue;
    ownKeys.add(raidKey(e));
    if (!FEED_KINDS.has(e.kind)) continue;
    // an event the seed does not hold is something THIS app saw: he was watching that hour
    if (!seedKeys.has(raidKey(e))) watchedHours.add(Math.floor(e.t / HOUR));
    (byPlanet.get(e.planetId) ?? byPlanet.set(e.planetId, []).get(e.planetId)).push(e.t);
  }
  const add = [];
  let already = 0, watched = 0, sameWindow = 0;
  for (const e of seedFeed) {
    if (ownKeys.has(raidKey(e))) { already++; continue; }
    if (watchedHours.has(Math.floor(e.t / HOUR))) { watched++; continue; }
    if ((byPlanet.get(e.planetId) ?? []).some((t) => Math.abs(t - e.t) <= SAME_WINDOW_MS)) { sameWindow++; continue; }
    // only the impersonal fields travel
    const clean = { t: e.t, planetId: e.planetId, systemId: e.systemId, kind: e.kind };
    for (const k of ['intoWindowMin', 'windowMin', 'blindTailMin']) if (typeof e[k] === 'number') clean[k] = e[k];
    add.push(clean);
    ownKeys.add(raidKey(e));
    (byPlanet.get(e.planetId) ?? byPlanet.set(e.planetId, []).get(e.planetId)).push(e.t);
  }
  return { add, already, watched, sameWindow };
}

// ---------------------------------------------------------------- radar (PURE)
/** PURE: the region-days only the seed covers. `exclude` = dates never taken (today, the wip day) */
function radarCandidates(ownCov, seedCov, exclude) {
  const ownDates = new Map((ownCov ?? []).map((c) => [c.r, new Set((c.days ?? []).map((d) => d.d))]));
  const cand = new Map();
  for (const c of seedCov ?? []) {
    const mine = ownDates.get(c.r) ?? new Set();
    const dates = (c.days ?? []).filter((d) => d.n > 0 && !mine.has(d.d) && !exclude.has(d.d)).map((d) => d.d);
    if (dates.length > 0) cand.set(c.r, new Set(dates));
  }
  return cand;
}
/** PURE: the seed's day rows for the candidate region-days, and nothing else of it */
function pickSeedRows(seedSummary, cand) {
  const picked = [];
  for (const e of seedSummary ?? []) {
    const dates = cand.get(e.r);
    if (!dates) continue;
    const rows = (e.days ?? []).filter((d) => dates.has(d.d));
    if (rows.length > 0) picked.push({ r: e.r, t: e.t, s: e.s, rows });
  }
  return picked;
}
/** PURE: put the picked rows into the user's summary and coverage (both are changed in place) */
function applyRadar(ownSummary, ownCov, seedCov, picked, cand) {
  // a day the user's SUMMARY knows although his coverage does not (older data) is his, too
  for (const e of ownSummary) {
    const dates = cand.get(e.r);
    if (dates) for (const d of e.days ?? []) dates.delete(d.d);
  }
  const byKey = new Map(ownSummary.map((e) => [`${e.r}:${e.t}:${e.s}`, e]));
  const byDate = (a, b) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);
  let rowsAdded = 0;
  for (const p of picked) {
    const dates = cand.get(p.r);
    const rows = p.rows.filter((d) => dates.has(d.d));
    if (rows.length === 0) continue;
    let e = byKey.get(`${p.r}:${p.t}:${p.s}`);
    if (!e) {
      e = { r: p.r, t: p.t, s: p.s, days: [], hfa: new Array(24).fill(0), hra: new Array(24).fill(0) };
      byKey.set(`${p.r}:${p.t}:${p.s}`, e);
      ownSummary.push(e);
    }
    const have = new Set(e.days.map((d) => d.d));
    const fresh = rows.filter((d) => !have.has(d.d));
    e.days = [...e.days, ...fresh].sort(byDate).slice(-SUMMARY_RING);
    rowsAdded += fresh.length;
  }
  let daysAdded = 0;
  for (const c of seedCov ?? []) {
    const dates = cand.get(c.r);
    if (!dates || dates.size === 0) continue;
    let mine = ownCov.find((x) => x.r === c.r);
    if (!mine) { mine = { r: c.r, days: [], na: 0, cva: new Array(24).fill(0) }; ownCov.push(mine); }
    const fresh = (c.days ?? []).filter((d) => dates.has(d.d));
    mine.days = [...mine.days, ...fresh].sort(byDate).slice(-COVERAGE_RING);
    daysAdded += fresh.length;
  }
  return { rowsAdded, daysAdded };
}

// ---------------------------------------------------------------- the launch step
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const writeAtomic = (p, content) => { const tmp = `${p}.tmp`; fs.writeFileSync(tmp, content); fs.renameSync(tmp, p); };
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * Fill the gaps in the user's history from a baseline newer than the last one merged.
 * Synchronous on purpose: it must finish before the renderer reads (and later rewrites) the files.
 * @returns {null | {id: string, ms: number, raids?: object, radar?: object, errors: string[]}}
 */
function mergeBaseline(baselineDir, statsDir, justSeeded = [], now = Date.now()) {
  const stamp = readJson(path.join(baselineDir, STAMP));
  if (!stamp || typeof stamp.id !== 'string') return null; // an old or absent bake: copy-only, as before
  const markerPath = path.join(statsDir, MARKER);
  if (readJson(markerPath)?.id === stamp.id) return null;
  const t0 = Date.now();
  const res = { id: stamp.id, ms: 0, errors: [] };

  if (!justSeeded.includes(RAIDS)) {
    try {
      const seedPath = path.join(baselineDir, RAIDS); const ownPath = path.join(statsDir, RAIDS);
      if (fs.existsSync(seedPath) && fs.existsSync(ownPath)) {
        const own = parseLines(fs.readFileSync(ownPath, 'utf8'));
        const m = mergeRaidEvents(own, parseLines(fs.readFileSync(seedPath, 'utf8')));
        if (m.add.length > 0) fs.appendFileSync(ownPath, m.add.map((e) => JSON.stringify(e)).join('\n') + '\n');
        res.raids = { added: m.add.length, already: m.already, watched: m.watched, sameWindow: m.sameWindow };
      }
    } catch (e) { res.errors.push(`raids: ${e instanceof Error ? e.message : String(e)}`); }
  }

  if (!justSeeded.includes(SUMMARY) && !justSeeded.includes(COVERAGE)) {
    try {
      const seedCov = readJson(path.join(baselineDir, COVERAGE));
      const ownCovPath = path.join(statsDir, COVERAGE); const ownSumPath = path.join(statsDir, SUMMARY);
      const ownCov = fs.existsSync(ownCovPath) ? readJson(ownCovPath) : [];
      if (Array.isArray(seedCov) && Array.isArray(ownCov) && fs.existsSync(ownSumPath)) {
        const exclude = new Set([utcDay(now)]);
        // the day still sitting in the unsaved accumulator is flushed OVER that date later
        try {
          const fd = fs.openSync(path.join(statsDir, 'radar-wip.json'), 'r'); const buf = Buffer.alloc(96);
          fs.readSync(fd, buf, 0, 96, 0); fs.closeSync(fd);
          const m = /"day":"(\d{4}-\d\d-\d\d)"/.exec(buf.toString('utf8')); if (m) exclude.add(m[1]);
        } catch { /* no wip */ }
        const cand = radarCandidates(ownCov, seedCov, exclude);
        if (cand.size > 0) {
          // the two big files are parsed ONE AFTER THE OTHER (134 MB each, ~500 MB parsed)
          const picked = pickSeedRows(readJson(path.join(baselineDir, SUMMARY)), cand);
          const ownSummary = readJson(ownSumPath);
          if (!Array.isArray(ownSummary)) throw new Error('own summary unreadable — left alone');
          const r = applyRadar(ownSummary, ownCov, seedCov, picked, cand);
          if (r.rowsAdded > 0 || r.daysAdded > 0) {
            writeAtomic(ownSumPath, JSON.stringify(ownSummary));
            writeAtomic(ownCovPath, JSON.stringify(ownCov));
          }
          res.radar = { regionDays: r.daysAdded, rows: r.rowsAdded };
        } else res.radar = { regionDays: 0, rows: 0 };
      }
    } catch (e) { res.errors.push(`radar: ${e instanceof Error ? e.message : String(e)}`); }
  }

  res.ms = Date.now() - t0;
  try { writeAtomic(markerPath, JSON.stringify({ id: stamp.id, builtAt: stamp.builtAt ?? null, mergedAt: now, ...res })); } catch { /* it is tried again next launch */ }
  return res;
}

module.exports = { seedBaseline, mergeBaseline, mergeRaidEvents, radarCandidates, pickSeedRows, applyRadar };
