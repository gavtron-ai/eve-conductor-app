// PER-PLAYER SETUP, IN A FILE — not compiled into the app.
//
// There is ONE build of EVE Conductor and it belongs to nobody. Everything
// that identifies a particular player — which EVE application their logins
// go through, what their hauling ship is called, where their corporation's
// map lives — is read from this file at startup.
//
// That buys three things at once:
//   1. the app can be handed to anyone, because it carries nothing personal;
//   2. a player's setup survives reinstalls and can be copied to a new
//      machine by copying one small file;
//   3. there is no "personal build" that could be shared by accident.
//
// It lives in Documents beside the stats folder so it is easy to find and
// easy to back up. NO TOKENS ARE EVER WRITTEN HERE — EVE rotates refresh
// tokens and a copied one revokes the live session, so logging in is always
// done fresh on each machine (RULE 7).
const fs = require('fs');
const path = require('path');

const FOLDER_NAME = 'EVE Conductor';
const FILE_NAME = 'config.json';

const README = `EVE Conductor — your setup
=============================

config.json holds the settings that are YOURS rather than the app's:

  eveClientId       the EVE application your logins go through
  transitShipName   the exact name of the ship whose cargo counts as
                    "in transit" (leave empty if you don't haul)
  apertureUrl       your corporation's web map, embedded as the Aperture
                    module (leave empty to turn the module off)

The app writes this file for you when you fill in Settings -> Your setup.
You can also edit it by hand; the app reads it at startup.

- SAFE TO COPY to another machine — this is your setup, not your data.
- NO LOGIN TOKENS ARE STORED HERE. EVE rotates them, and a copied token
  revokes your session, so you log in fresh on each machine.
- Deleting this file only resets your setup. Your trading history lives in
  "EVE Conductor Stats (Do Not Delete)", which is a different folder.

anthropic.json (optional, separate file) enables AI-written fight
summaries on battle reports — set it from Settings -> AI fight
summaries, or by hand:

  { "apiKey": "sk-ant-...", "model": "claude-sonnet-5" }   (model optional)

That file IS a secret — unlike config.json it must NOT be copied to
anyone else, and it never goes in a backup. Without it the app still
writes a plain summary from the same computed facts.
`;

/** the only keys this file is allowed to carry */
const KEYS = ['eveClientId', 'transitShipName', 'apertureUrl'];

/** anything token-shaped must never be written, whatever the caller passed */
const looksSecret = (v) =>
  typeof v === 'string' &&
  (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./.test(v) || /^[A-Za-z0-9_-]{40,}$/.test(v));

function configDir(documentsPath) {
  const dir = path.join(documentsPath, FOLDER_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
  return dir;
}

const configPath = (documentsPath) => path.join(configDir(documentsPath), FILE_NAME);

/** the stored setup, or empty values when there is no file yet */
function read(documentsPath) {
  const empty = { eveClientId: '', transitShipName: '', apertureUrl: '' };
  try {
    const p = path.join(documentsPath, FOLDER_NAME, FILE_NAME);
    if (!fs.existsSync(p)) return empty;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const out = { ...empty };
    for (const k of KEYS) {
      if (typeof raw?.[k] === 'string') out[k] = raw[k];
    }
    return out;
  } catch {
    // a corrupt or unreadable config must not stop the app starting — the
    // user simply sees an unconfigured setup and can fill it in again
    return empty;
  }
}

/**
 * Merge a patch into the stored setup. Written atomically (tmp + rename) so
 * a crash mid-write cannot leave a half-file that reads as "unconfigured".
 * Returns the new full setup, or null when the write failed.
 */
function write(documentsPath, patch) {
  try {
    const current = read(documentsPath);
    const next = { ...current };
    for (const k of KEYS) {
      const v = patch?.[k];
      if (typeof v !== 'string') continue;
      // an EVE client id is a 32-char hex string and is NOT a secret; anything
      // longer and opaque is refused rather than quietly stored
      if (k !== 'eveClientId' && looksSecret(v)) continue;
      next[k] = v.trim();
    }
    const target = configPath(documentsPath);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, target);
    return next;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLONE LABELS AND ALERTS — the user's own work, kept portable.
//
// The clone REGISTRY (which pods have been seen, their implant fingerprints)
// lives in userData: it is re-observed automatically and losing it costs
// nothing. But the NAMES and the "do not undock in this" ALERTS are typed by
// hand, and userData is exactly what a full uninstall deletes — which is how
// they were lost once already. They belong beside config.json, where they
// survive a reinstall and can be copied to another machine.
// ---------------------------------------------------------------------------

const CLONES_FILE = 'clones.json';

/** { [fingerprint]: { customName?, alert?: { blink, color } } } */
function readClones(documentsPath) {
  try {
    const p = path.join(documentsPath, FOLDER_NAME, CLONES_FILE);
    if (!fs.existsSync(p)) return {};
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (!raw || typeof raw !== 'object') return {};
    const out = {};
    for (const [sig, v] of Object.entries(raw)) {
      if (typeof sig !== 'string' || !v || typeof v !== 'object') continue;
      const rec = {};
      if (typeof v.customName === 'string' && v.customName.trim() !== '') {
        rec.customName = v.customName.slice(0, 40);
      }
      if (v.alert && typeof v.alert === 'object') {
        rec.alert = {
          blink: Boolean(v.alert.blink),
          color: /^#[0-9a-f]{6}$/i.test(String(v.alert.color ?? '')) ? String(v.alert.color) : '#ff4d4d',
        };
      }
      if (rec.customName || rec.alert) out[sig] = rec;
    }
    return out;
  } catch {
    // a corrupt file must not stop the app — the in-app registry still works
    return {};
  }
}

/** replace the stored labels wholesale; written atomically like config.json */
function writeClones(documentsPath, byFingerprint) {
  try {
    const target = path.join(configDir(documentsPath), CLONES_FILE);
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(byFingerprint ?? {}, null, 2)}
`, 'utf8');
    fs.renameSync(tmp, target);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  FOLDER_NAME, FILE_NAME, CLONES_FILE, configDir, configPath, read, write, KEYS,
  readClones, writeClones,
};
