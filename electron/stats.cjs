// Long-term trend-stats storage OUTSIDE the install/userData folders, so it
// survives app updates and even deleting the app entirely. Lives in the user's
// Documents as "EVE Conductor Stats (Do Not Delete)". Append-only NDJSON, one
// file per month.
const fs = require('fs');
const path = require('path');

const FOLDER_NAME = 'EVE Conductor Stats (Do Not Delete)';

const README = `EVE Conductor — long-term trend statistics
=================================================

This folder holds your trading trend history (outbid events, sales, per-system
stats) collected by EVE Conductor. It lives here — OUTSIDE the app's
install folder — precisely so that updating, reinstalling, or deleting the app
does NOT erase your history.

- Safe to back up or sync.
- Deleting this folder permanently loses your trend history.
- Files are plain NDJSON (one JSON event per line, grouped by month); the app
  reads them all on startup.
`;

/** stats dir under the given documents path; created (with README) on demand */
function statsDir(documentsPath) {
  const dir = path.join(documentsPath, FOLDER_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
  return dir;
}

/** append NDJSON event lines to the current month's file */
function appendEvents(documentsPath, lines) {
  if (!Array.isArray(lines) || lines.length === 0) return;
  const dir = statsDir(documentsPath);
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM
  const file = path.join(dir, `trend-events-${month}.ndjson`);
  fs.appendFileSync(file, lines.map((l) => String(l).replace(/\n/g, ' ')).join('\n') + '\n');
}

/** every stored event line, oldest file first — includes imported files from
 * other machines (any trend-events-*.ndjson), per the multi-machine plan */
function readAllEvents(documentsPath) {
  const dir = statsDir(documentsPath);
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^trend-events-[A-Za-z0-9._-]+\.ndjson$/.test(f))
    .sort();
  return files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
}

/** every event file with its name — for backups that preserve file identity */
function listEventFiles(documentsPath) {
  const dir = statsDir(documentsPath);
  return fs
    .readdirSync(dir)
    .filter((f) => /^trend-events-[A-Za-z0-9._-]+\.ndjson$/.test(f))
    .sort()
    .map((f) => ({ name: f, content: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

/**
 * Merge imported event files into the stats folder: per file, append only the
 * lines not already present (exact-line dedupe). Never deletes or rewrites —
 * importing an old backup can't lose newer local events. Returns lines added.
 */
function importEventFiles(documentsPath, files) {
  const dir = statsDir(documentsPath);
  let added = 0;
  for (const f of Array.isArray(files) ? files : []) {
    // strict name check — no path separators can sneak into the folder
    if (typeof f?.name !== 'string' || !/^trend-events-[A-Za-z0-9._-]+\.ndjson$/.test(f.name)) continue;
    const file = path.join(dir, f.name);
    const have = new Set(
      fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [],
    );
    const fresh = String(f.content ?? '')
      .split('\n')
      .filter((l) => l.trim() && !have.has(l));
    if (fresh.length > 0) {
      fs.appendFileSync(file, fresh.join('\n') + '\n');
      added += fresh.length;
    }
  }
  return added;
}

/** radar/theft/fits + auxiliary files: strict names, same folder.
 * `fits-` was added for the Fitting Library's pre-sync backup — that tool
 * deletes fits in game, where EVE has no undo, so the snapshot belongs in
 * the long-term stats folder alongside the other never-delete data. */
// `ship-` and `battle-` joined in v0.208.0. MEASURED 2026-09-20: the ship watcher had been writing
// `ship-history.ndjson` since it was built, this pattern refused the name, appendAuxLines returns
// quietly on a bad name and the reader's throw was caught — so the file never existed and Live
// Combat's ship band forgot everything at each restart. `battle-` holds the leaderboard's killmails.
const AUX_NAME = /^(radar|theft|fits|ship|battle|ledger)-[A-Za-z0-9._-]+\.(ndjson|json)$/;

/** returns the full path written, so a caller can VERIFY rather than assume
 * (an undefined return read as failure once already) */
function writeAuxFile(documentsPath, name, content) {
  if (!AUX_NAME.test(name)) throw new Error('bad aux file name');
  const full = path.join(statsDir(documentsPath), name);
  // written beside the file and moved over it (v0.212.0): the killmail archive is rewritten whole
  // at tens of MB, and a crash halfway through a plain write would leave half a file
  const tmp = `${full}.tmp`;
  fs.writeFileSync(tmp, String(content));
  fs.renameSync(tmp, full);
  return full;
}

function readAuxFile(documentsPath, name) {
  if (!AUX_NAME.test(name)) throw new Error('bad aux file name');
  const p = path.join(statsDir(documentsPath), name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
}

function appendAuxLines(documentsPath, name, lines) {
  if (!AUX_NAME.test(name) || !Array.isArray(lines) || lines.length === 0) return;
  fs.appendFileSync(
    path.join(statsDir(documentsPath), name),
    lines.map((l) => String(l).replace(/\n/g, ' ')).join('\n') + '\n',
  );
}

/** aux files as NAMES ONLY (+size/mtime). listAuxFiles reads every file's
 * full content — fine for a backup export, ruinous for listing the fit
 * backups next to an 11 MB radar log. */
function listAuxNames(documentsPath) {
  const dir = statsDir(documentsPath);
  return fs
    .readdirSync(dir)
    .filter((f) => AUX_NAME.test(f))
    .map((f) => {
      const st = fs.statSync(path.join(dir, f));
      return { name: f, size: st.size, mtime: st.mtimeMs };
    })
    .sort((a, b) => b.mtime - a.mtime);
}

/** public data the app reads again by itself: tens of MB that a backup does not need to carry */
const NOT_IN_BACKUPS = new Set(['battle-corp-killmails.ndjson']);
// v0.226.0: the ledger file is in every backup already, as the `ledger` field (merged by ids on import)
const IN_BACKUP_FIELD = new Set(['ledger-v1.json']);
/** the radar's raw daily rows (written until v0.220.0, read by nothing, hundreds of MB a month) and,
 * since v0.229.0, the pre-0.229 summary blob kept after its split — both deletable from Settings */
const RADAR_MONTH = /^radar-\d{4}-\d{2}\.ndjson$|^radar-summary\.legacy\.json$/;
/** the per-region summaries (v0.229.0): tens of MB each; the installer's seed carries the shared part */
const RADAR_SUMMARY = /^radar-summary(-\d+)?\.json$/;
/** a backup is one JSON string in the renderer; V8 refuses strings past ~512 MB–1 GB, and a
 * 137 MB summary alone made the export throw (measured 2026-09-23: 784 MB → "Invalid string
 * length"). Files over this are left out and NAMED in the export's result. */
const BACKUP_MAX_BYTES = 20 * 1024 * 1024;

/** every aux file a backup can carry, with its content — and the ones it cannot, with why */
function listAuxFiles(documentsPath) {
  const dir = statsDir(documentsPath);
  const files = []; const skipped = [];
  for (const f of fs.readdirSync(dir).filter((n) => AUX_NAME.test(n)).sort()) {
    const full = path.join(dir, f);
    let size = 0; try { size = fs.statSync(full).size; } catch { continue; }
    if (NOT_IN_BACKUPS.has(f)) { skipped.push({ name: f, size, why: 'public data the app re-reads by itself' }); continue; }
    if (IN_BACKUP_FIELD.has(f)) { skipped.push({ name: f, size, why: 'in the backup already, as its ledger field' }); continue; }
    if (RADAR_MONTH.test(f)) { skipped.push({ name: f, size, why: 'raw radar rows — no longer written, read by nothing' }); continue; }
    if (RADAR_SUMMARY.test(f)) { skipped.push({ name: f, size, why: 'radar history — tens of MB; the installer\'s seed carries the shared part' }); continue; }
    if (size > BACKUP_MAX_BYTES) { skipped.push({ name: f, size, why: `${(size / 1048576).toFixed(0)} MB — too big for a JSON backup` }); continue; }
    files.push({ name: f, content: fs.readFileSync(full, 'utf8') });
  }
  return { files, skipped };
}

/** the raw radar month files on disk (v0.220.0: no longer written; the user may delete them) */
function listRadarMonths(documentsPath) {
  const dir = statsDir(documentsPath);
  return fs.readdirSync(dir).filter((f) => RADAR_MONTH.test(f)).sort().map((f) => { let size = 0; try { size = fs.statSync(path.join(dir, f)).size; } catch { /* gone */ } return { name: f, size }; });
}
/** delete ONLY the raw radar month files — nothing else matches the pattern */
function deleteRadarMonths(documentsPath) {
  const dir = statsDir(documentsPath);
  let deleted = 0, bytes = 0;
  for (const { name, size } of listRadarMonths(documentsPath)) {
    if (!RADAR_MONTH.test(name)) continue;
    try { fs.rmSync(path.join(dir, name)); deleted++; bytes += size; } catch { /* locked or gone — reported by the count */ }
  }
  return { deleted, bytes };
}

module.exports = { FOLDER_NAME, statsDir, appendEvents, readAllEvents, listEventFiles, importEventFiles, writeAuxFile, readAuxFile, appendAuxLines, listAuxFiles, listAuxNames, listRadarMonths, deleteRadarMonths, BACKUP_MAX_BYTES };
