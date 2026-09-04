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
const AUX_NAME = /^(radar|theft|fits)-[A-Za-z0-9._-]+\.(ndjson|json)$/;

/** returns the full path written, so a caller can VERIFY rather than assume
 * (an undefined return read as failure once already) */
function writeAuxFile(documentsPath, name, content) {
  if (!AUX_NAME.test(name)) throw new Error('bad aux file name');
  const full = path.join(statsDir(documentsPath), name);
  fs.writeFileSync(full, String(content));
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

/** every radar/aux file with its name — for backups */
function listAuxFiles(documentsPath) {
  const dir = statsDir(documentsPath);
  return fs
    .readdirSync(dir)
    .filter((f) => AUX_NAME.test(f))
    .sort()
    .map((f) => ({ name: f, content: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

module.exports = { FOLDER_NAME, statsDir, appendEvents, readAllEvents, listEventFiles, importEventFiles, writeAuxFile, readAuxFile, appendAuxLines, listAuxFiles, listAuxNames };
