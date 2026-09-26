// TOKENS AT REST (v0.235.0, audit E4). Until 0.234 every character's access and refresh token
// sat in plaintext inside the renderer's localStorage (the auth blob) — readable by anything that
// could read the profile folder. Now the MAIN process keeps them in one file, userData/tokens.enc,
// encrypted with Electron's safeStorage (Windows: DPAPI under the user's login; macOS: the Keychain;
// Linux: the desktop's keyring when there is one). The renderer holds tokens in memory only, its
// persisted blob strips them, and every login and refresh runs HERE, so all windows see one pair.
//
// Rule 3, as with the ledger and the clone registry: a file that exists but cannot be read is never
// overwritten (writes are refused until it is moved aside); a machine without encryption keeps the
// old behaviour (tokens in the renderer's store) and the log says so at every start.
// Nothing here ever logs a token value.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const FILE = 'tokens.enc';
/** a stored access token still good for this long is handed back without asking EVE again */
const REUSE_MARGIN_MS = 60_000;

let cache = null;
let loadFailed = false;

function available() {
  try { return Boolean(safeStorage && safeStorage.isEncryptionAvailable()); } catch { return false; }
}
const filePath = () => path.join(app.getPath('userData'), FILE);

function load() {
  if (cache) return cache;
  cache = new Map();
  if (!available()) return cache;
  const p = filePath();
  if (!fs.existsSync(p)) return cache;
  try {
    const obj = JSON.parse(safeStorage.decryptString(fs.readFileSync(p)));
    for (const [k, v] of Object.entries(obj ?? {})) {
      if (v && typeof v.refreshToken === 'string' && typeof v.accessToken === 'string') cache.set(Number(k), v);
    }
  } catch {
    loadFailed = true; // never write over what could not be read
  }
  return cache;
}

function saveNow() {
  if (!available() || loadFailed) return false;
  const obj = Object.fromEntries([...load().entries()].map(([k, v]) => [String(k), v]));
  const target = filePath();
  const tmp = `${target}.tmp`;
  try {
    fs.writeFileSync(tmp, safeStorage.encryptString(JSON.stringify(obj)));
    fs.renameSync(tmp, target);
    return true;
  } catch {
    try { fs.unlinkSync(tmp); } catch { /* nothing to clean up */ }
    return false;
  }
}

/** remember a character's pair (after a login or a refresh); false when it could not be kept on disk */
function set(t) {
  if (!t || !Number.isFinite(t.characterId) || typeof t.accessToken !== 'string' || typeof t.refreshToken !== 'string') return false;
  load().set(t.characterId, { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: Number(t.expiresAt) || 0, characterName: String(t.characterName ?? '') });
  return saveNow();
}
const get = (characterId) => load().get(characterId) ?? null;
function forget(characterId) {
  load().delete(characterId);
  return saveNow();
}
/** every stored pair, keyed by character id — what a window loads at start */
const all = () => Object.fromEntries([...load().entries()].map(([k, v]) => [String(k), v]));
const status = () => { const count = load().size; return { available: available(), loadFailed, count }; }; // load first: it is what sets loadFailed

/**
 * PURE: what a refresh request from a window should do. A window may hold a pair the vault has
 * since rotated (another window refreshed, or an earlier session did): handing it the vault's
 * current pair costs nothing and never burns a refresh token; only when the vault's own access
 * token is about to expire does EVE get asked — with the vault's refresh token, never the caller's.
 * @returns {{ action: 'reuse', tokens: object } | { action: 'refresh', refreshToken: string } | { action: 'none' }}
 */
function decideRefresh(stored, callerRefreshToken, now) {
  if (!stored) return callerRefreshToken ? { action: 'refresh', refreshToken: callerRefreshToken } : { action: 'none' };
  if (stored.expiresAt - now > REUSE_MARGIN_MS && stored.refreshToken !== callerRefreshToken) return { action: 'reuse', tokens: stored };
  if (stored.expiresAt - now > REUSE_MARGIN_MS) return { action: 'reuse', tokens: stored };
  return { action: 'refresh', refreshToken: stored.refreshToken };
}

module.exports = {
  FILE, REUSE_MARGIN_MS, available, load, saveNow, set, get, forget, all, status, decideRefresh,
  _reset: () => { cache = null; loadFailed = false; },
};
