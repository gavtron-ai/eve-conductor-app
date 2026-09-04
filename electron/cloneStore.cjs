// THE CLONE REGISTRY — every pod the app has ever seen a character wearing.
//
// WHY THE MAIN PROCESS OWNS IT: three renderers need this data (the main
// window records observations, the overlay draws alerts, the config window
// edits it). localStorage would give each window its own copy and lose
// writes when two of them save at once, so it lives in one JSON file here
// and every change is broadcast.
//
// A clone is identified by its IMPLANT FINGERPRINT — the sorted list of
// implant type ids. ESI only names clones you are NOT currently wearing
// (see cloneNames.ts), so the fingerprint is what lets a name, or a custom
// label, or a "do not undock in this" alert, stick to a clone at all.
const { app, ipcMain, BrowserWindow } = require('electron');
const appConfig = require('./appConfig.cjs');
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'clone-registry.json';
/** a fingerprint neither seen nor matched in this long is dead weight —
 * except one the user has named or flagged, which is never dropped */
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;
/** runaway guard; a real pilot has far fewer */
const MAX_PER_CHAR = 128;
const SAVE_DEBOUNCE_MS = 400;

let data = { v: 1, chars: {} };
let saveTimer = null;
let loaded = false;
/** the file EXISTS but we could not read it. Saving now would overwrite the
 * user's only copy with an empty registry, so we refuse to write at all
 * until the bad file has been moved aside. */
let loadFailed = false;

const filePath = () => path.join(app.getPath('userData'), FILE_NAME);

function load() {
  if (loaded) return;
  loaded = true;
  let raw;
  try {
    raw = fs.readFileSync(filePath(), 'utf8');
  } catch (err) {
    // genuinely no file yet — an empty registry IS the truth, safe to save.
    // Anything else (locked by a backup scan, permissions) is NOT.
    if (err && err.code !== 'ENOENT') loadFailed = true;
    return;
  }
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  if (parsed && typeof parsed === 'object' && parsed.chars && typeof parsed.chars === 'object') {
    data = parsed;
    return;
  }
  // INTEGRITY RULE: the file is there but unusable. Never silently replace
  // it with an empty registry — every custom name and alert would be gone
  // with no error. Move it aside so it can be recovered, and only then
  // allow writing again.
  try {
    fs.renameSync(filePath(), `${filePath()}.corrupt-${Date.now()}`);
    console.error(`[clones] registry unreadable — kept a copy as ${FILE_NAME}.corrupt-*`);
  } catch {
    loadFailed = true; // could not even move it — do not write over it
  }
}

/**
 * MIRROR THE HAND-TYPED PARTS TO THE PORTABLE CONFIG.
 *
 * The registry itself lives in userData and is re-observed automatically, so
 * losing it costs nothing. Custom names and alerts are different: they are
 * typed by hand, and a full uninstall deletes userData — which is exactly how
 * they were lost once. They are keyed by implant FINGERPRINT, not by
 * character, so the same pod recognised on another character (or after a
 * re-login) carries its name with it.
 */
function exportLabels() {
  const out = {};
  for (const byChar of Object.values(data.chars ?? {})) {
    for (const [sig, rec] of Object.entries(byChar ?? {})) {
      if (!isPinned(rec)) continue;
      const e = {};
      if (rec.customName) e.customName = rec.customName;
      if (rec.alert) e.alert = rec.alert;
      // first writer wins: two characters in the same pod agree by definition
      if (!out[sig]) out[sig] = e;
    }
  }
  return out;
}

function saveLabels() {
  try {
    appConfig.writeClones(app.getPath('documents'), exportLabels());
  } catch {
    // the portable copy is a safety net, never a blocker
  }
}

/** adopt hand-typed labels from the portable file into a freshly loaded
 * registry. Only fills GAPS — anything already in the registry wins, because
 * that is the copy the user has been editing this session. */
function adoptLabels() {
  let stored;
  try {
    stored = appConfig.readClones(app.getPath('documents'));
  } catch {
    return;
  }
  const sigs = Object.keys(stored ?? {});
  if (sigs.length === 0) return;
  let adopted = 0;
  for (const byChar of Object.values(data.chars ?? {})) {
    for (const [sig, rec] of Object.entries(byChar ?? {})) {
      const s = stored[sig];
      if (!s) continue;
      if (!rec.customName && s.customName) { rec.customName = s.customName; adopted++; }
      if (!rec.alert && s.alert) { rec.alert = s.alert; adopted++; }
    }
  }
  if (adopted > 0) console.log(`[clones] restored ${adopted} label(s) from the portable config`);
}

function saveSoon() {
  if (loadFailed) return; // never overwrite a file we failed to read
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
}

/** ATOMIC: write a temp file then rename over the target. A plain
 * writeFileSync truncates the live file the instant it opens, so a crash,
 * a power cut or a full disk mid-write leaves a half-written registry —
 * which is exactly the corruption load() then has to cope with. */
function saveNow() {
  saveLabels();
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (loadFailed) return;
  const target = filePath();
  const tmp = `${target}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data), 'utf8');
    fs.renameSync(tmp, target);
  } catch {
    // the registry is a convenience — never take the app down over it
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
  }
}

function broadcast() {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('clones-changed', data);
  }
}

/** a record the user has invested in must survive pruning */
const isPinned = (rec) => Boolean(rec.customName || rec.alert);

function prune(byChar, now) {
  const entries = Object.entries(byChar);
  const live = entries.filter(([, r]) => isPinned(r) || now - (r.seen ?? 0) < MAX_AGE_MS);
  live.sort((a, b) => {
    // pinned records outrank recency so the cap can never evict them
    const pa = isPinned(a[1]) ? 1 : 0;
    const pb = isPinned(b[1]) ? 1 : 0;
    if (pa !== pb) return pb - pa;
    return (b[1].seen ?? 0) - (a[1].seen ?? 0);
  });
  return Object.fromEntries(live.slice(0, MAX_PER_CHAR));
}

/**
 * Record one observation of a clone.
 * `worn` marks the clone the character is wearing RIGHT NOW (from
 * /implants/); jump clones come through with worn=false and may carry the
 * name EVE holds for them.
 *
 * DELIBERATELY NOT ERASING: an observation without a name never clears a
 * name already known. Jumping out of a clone leaves the body behind as a
 * newly created jump clone, and whether EVE carries the old name onto it is
 * unverified — forgetting on sight would wipe the name of the clone the
 * pilot uses most, every time they jump.
 */
function record(obs, now = Date.now()) {
  load();
  if (!obs || typeof obs !== 'object') return;
  const { characterId, sig } = obs;
  if (!Number.isFinite(characterId) || typeof sig !== 'string' || sig === '') return;

  const key = String(characterId);
  const byChar = { ...(data.chars[key] ?? {}) };
  const prev = byChar[sig] ?? {};
  byChar[sig] = {
    ...prev,
    implants: Array.isArray(obs.implants) ? obs.implants : prev.implants ?? [],
    names: Array.isArray(obs.names) ? obs.names : prev.names ?? [],
    // the derived label (LEARNING / SNAKE / PG+CAP) — shown in the config
    // window so the user can see what a clone reads as today
    label: obs.label ?? prev.label ?? '',
    characterName: obs.characterName ?? prev.characterName ?? '',
    esiName: obs.esiName ? obs.esiName : prev.esiName ?? '',
    first: prev.first ?? now,
    seen: now,
    lastWorn: obs.worn ? now : prev.lastWorn ?? 0,
  };
  data.chars[key] = prune(byChar, now);
  saveSoon();
}

/** many observations in one go, ONE broadcast — a 12-character poll would
 * otherwise fire 12+ redraws a second across three windows */
function recordMany(list, now = Date.now()) {
  if (!Array.isArray(list) || list.length === 0) return;
  for (const obs of list) record(obs, now);
  broadcast();
}

/** the user's own edits: custom name and alert */
function setConfig(cfg) {
  load();
  if (!cfg || !Number.isFinite(cfg.characterId) || typeof cfg.sig !== 'string') return data;
  const rec = data.chars[String(cfg.characterId)]?.[cfg.sig];
  if (!rec) return data;
  if ('customName' in cfg) rec.customName = String(cfg.customName ?? '').slice(0, 40);
  if ('alert' in cfg) {
    rec.alert = cfg.alert
      ? {
          blink: Boolean(cfg.alert.blink),
          // a colour is only ever written into a CSS variable, but validate
          // it anyway — never interpolate unvalidated text into styles
          color: /^#[0-9a-f]{6}$/i.test(String(cfg.alert.color ?? '')) ? String(cfg.alert.color) : '#ff4d4d',
        }
      : null;
  }
  if (!rec.customName) delete rec.customName;
  if (!rec.alert) delete rec.alert;
  saveLabels();   // hand-typed work goes to the portable file immediately
  saveSoon();
  broadcast();
  return data;
}

function forget(cfg) {
  load();
  if (!cfg || !Number.isFinite(cfg.characterId) || typeof cfg.sig !== 'string') return data;
  const byChar = data.chars[String(cfg.characterId)];
  if (byChar) delete byChar[cfg.sig];
  saveSoon();
  broadcast();
  return data;
}

function all() {
  load();
  return data;
}

function register() {
  // pick up any labels a previous install (or another machine) left behind
  load();
  adoptLabels();
  ipcMain.handle('clones-all', () => all());
  ipcMain.on('clones-record', (_e, list) => recordMany(list));
  ipcMain.handle('clones-set', (_e, cfg) => setConfig(cfg));
  ipcMain.handle('clones-forget', (_e, cfg) => forget(cfg));
  // a name typed 100ms before quitting must still be there next launch
  app.on('before-quit', () => saveNow());
}

module.exports = {
  register, all, record, recordMany, setConfig, forget, prune, saveNow,
  _reset: (d) => { data = d ?? { v: 1, chars: {} }; loaded = true; loadFailed = false; },
};
