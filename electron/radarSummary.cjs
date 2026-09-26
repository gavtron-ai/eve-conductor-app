// THE RADAR SUMMARY ON DISK (v0.229.0, audit B2) — one file per region, compact.
//
// Until 0.228 the whole summary was ONE file, radar-summary.json: 111,609 entries, 136.8 MB,
// parsed whole into the renderer (1.1 s, ~500 MB of heap), rewritten whole at every day's
// rollover, and baked whole into the installer. Measured on that file: rounding saves 1 %
// (the numbers are integers already); the bytes are the day rings — 109 of 130 MB — in their
// repeated key names ("d","rp","fi","fk","co","bp") and date strings. So:
//   · one file per region: radar-summary-<regionId>.json — an install loads only the regions it
//     watches (the owner's: 2 of 5), and a rollover rewrites only the regions that had rows;
//   · the compact encoding below: no key names, dates as day numbers, ISK as integers —
//     130.5 MB → 64.6 MB on the same data (−50 %).
// Both processes read and write it: this module (main: migration, the seed merge, the
// builder) and src/lib/radarSummaryFormat.ts (the renderer) — tests/radarsummary.test.cjs
// proves the two codecs agree byte for byte.
//
// v2 file: {"v":2,"r":<regionId>,"entries":[[t, s, [[dayNum, rp, fi, fk, co, bp], …], hfa[24], hra[24]], …]}
//   dayNum = UTC days since 1970-01-01 ("2026-08-23" → 20689); fk and hfa rounded to whole ISK
//   (an ISK sum has two decimals at most; the ring's per-day totals are whole ISK anyway);
//   bp (best price) keeps two decimals.
const fs = require('fs');
const path = require('path');

const LEGACY = 'radar-summary.json';
const LEGACY_KEPT = 'radar-summary.legacy.json';
const REGION_FILE = /^radar-summary-(\d+)\.json$/;
const regionFile = (r) => `radar-summary-${r}.json`;

const DAY = 86_400_000;
const dayNum = (d) => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY);
const dayStr = (n) => new Date(n * DAY).toISOString().slice(0, 10);
const r2 = (x) => Math.round(x * 100) / 100;

/** v1 entries (objects with r) of ONE region → the v2 file text */
function encodeRegion(regionId, entries) {
  const rows = [];
  for (const e of entries) {
    if (e.r !== regionId) continue;
    rows.push([
      e.t, e.s,
      (e.days ?? []).map((d) => [dayNum(d.d), d.rp, d.fi, Math.round(d.fk), d.co, r2(d.bp)]),
      (e.hfa ?? new Array(24).fill(0)).map(Math.round),
      (e.hra ?? new Array(24).fill(0)).map(Math.round),
    ]);
  }
  return JSON.stringify({ v: 2, r: regionId, entries: rows });
}

/** the v2 file text → v1 entries (objects with r, the shape every reader uses); throws on anything else */
function decodeRegion(text) {
  const doc = JSON.parse(text);
  if (!doc || doc.v !== 2 || typeof doc.r !== 'number' || !Array.isArray(doc.entries)) throw new Error('not a v2 region summary');
  return doc.entries.map(([t, s, days, hfa, hra]) => ({
    r: doc.r, t, s,
    days: days.map(([dn, rp, fi, fk, co, bp]) => ({ d: dayStr(dn), rp, fi, fk, co, bp })),
    hfa, hra,
  }));
}

/** v1 whole-summary entries → Map<regionId, entries> */
function splitByRegion(entries) {
  const by = new Map();
  for (const e of entries) {
    if (!e || typeof e.r !== 'number') continue;
    (by.get(e.r) ?? by.set(e.r, []).get(e.r)).push(e);
  }
  return by;
}

const writeAtomic = (p, content) => { const tmp = `${p}.tmp`; fs.writeFileSync(tmp, content); fs.renameSync(tmp, p); };

/** the region files present in a stats folder */
function listRegionFiles(dir) {
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((f) => REGION_FILE.test(f)).map((f) => ({ name: f, regionId: Number(REGION_FILE.exec(f)[1]) }));
}

/** read one region's entries; [] when the file is absent; throws when it is unreadable */
function readRegion(dir, regionId) {
  const p = path.join(dir, regionFile(regionId));
  if (!fs.existsSync(p)) return [];
  return decodeRegion(fs.readFileSync(p, 'utf8'));
}

function writeRegion(dir, regionId, entries) {
  writeAtomic(path.join(dir, regionFile(regionId)), encodeRegion(regionId, entries));
}

/**
 * The one-time move from the single blob to per-region files, run in the main process at every
 * launch (idempotent) BEFORE the seed is copied or merged — so a seed's region file can never
 * land on top of a user's unsplit history. Rule 3: a region file that already exists is left
 * alone (a partial earlier run, or the user's own newer data); every written file is READ BACK
 * and its entry count compared before the blob is renamed to radar-summary.legacy.json (kept,
 * deletable from Settings). Anything that fails leaves everything as it was.
 * @returns {null | {regions: number[], entries: number, bytesBefore: number, bytesAfter: number, ms: number, skipped: number[]} | {error: string}}
 */
function migrateRadarSummary(dir) {
  const legacy = path.join(dir, LEGACY);
  if (!fs.existsSync(legacy)) return null;
  const t0 = Date.now();
  try {
    const raw = fs.readFileSync(legacy, 'utf8');
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) throw new Error('the summary is not a list');
    const by = splitByRegion(entries);
    const written = [];
    const skipped = [];
    let bytesAfter = 0;
    for (const [r, list] of by) {
      const p = path.join(dir, regionFile(r));
      if (fs.existsSync(p)) { skipped.push(r); continue; }
      const text = encodeRegion(r, list);
      writeAtomic(p, text);
      const back = decodeRegion(fs.readFileSync(p, 'utf8'));
      if (back.length !== list.length) throw new Error(`region ${r}: wrote ${list.length} entries, read back ${back.length}`);
      written.push(r);
      bytesAfter += text.length;
    }
    fs.renameSync(legacy, path.join(dir, LEGACY_KEPT));
    return { regions: written, skipped, entries: entries.length, bytesBefore: raw.length, bytesAfter, ms: Date.now() - t0 };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

module.exports = { LEGACY, LEGACY_KEPT, REGION_FILE, regionFile, dayNum, dayStr, encodeRegion, decodeRegion, splitByRegion, listRegionFiles, readRegion, writeRegion, migrateRadarSummary };
