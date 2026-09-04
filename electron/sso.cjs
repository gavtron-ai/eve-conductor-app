// EVE SSO (OAuth2 + PKCE, native-app flow) — runs entirely in the Electron main
// process: the renderer never touches the token endpoint, and the auth code
// arrives on a loopback HTTP server that only exists during login.
const http = require('http');
const crypto = require('crypto');
const { shell } = require('electron');

// 53138 ON PURPOSE: Trade Conductor's OWN application + port — Fleet
// Conductor keeps 53137; the two apps share nothing at the SSO layer
const SSO_PORT = 53138;
const CALLBACK_PATH = '/callback';
const AUTH_URL = 'https://login.eveonline.com/v2/oauth/authorize/';
const TOKEN_URL = 'https://login.eveonline.com/v2/oauth/token';
// must be a subset of the scopes enabled on the registered application.
// Only scopes the app actually uses are requested — an unused scope on a
// locally-stored token is pure risk.
const SCOPES = [
  'esi-skills.read_skills.v1',
  'esi-characters.read_standings.v1',
  'esi-assets.read_assets.v1',
  'esi-wallet.read_character_wallet.v1',
  'esi-clones.read_clones.v1',
  'esi-clones.read_implants.v1',
  'esi-fittings.read_fittings.v1',
  // Fit Wizard saves variations into the in-game fitting manager. Tokens
  // only carry scopes requested AT LOGIN, so characters logged in before
  // v56 must re-login once — the UI says so instead of failing obscurely.
  'esi-fittings.write_fittings.v1',
  'esi-markets.read_character_orders.v1',
  // Planetary Industry (v0.60.36). Tokens only carry scopes requested AT
  // LOGIN, so characters logged in before this must re-login once — the PI
  // module says so rather than showing empty planets.
  'esi-planets.manage_planets.v1',
  'esi-location.read_location.v1',
  'esi-location.read_ship_type.v1',
  'esi-location.read_online.v1',
  'esi-ui.open_window.v1',
  'esi-ui.write_waypoint.v1',
  'esi-universe.read_structures.v1',
  'esi-search.search_structures.v1',
  // Battle Reports (v0.103.0): zkill's API runs ~30 min behind its own
  // website (measured — the site listed a loss all three API endpoint
  // styles were missing), so the fight feed merges each logged-in
  // character's OWN killmails live from ESI. Tokens only carry scopes
  // requested AT LOGIN — characters must re-login once, and the EVE
  // application's scope list must include this first.
  'esi-killmails.read_killmails.v1',
  // v0.103.1: the WHOLE corp's killmails, live — the owner cares about the
  // corp, not just his own mails. ESI grants this feed only to characters
  // holding the Director role; for everyone else the request 403s and the
  // per-character feeds above still apply.
  'esi-killmails.read_corporation_killmails.v1',
].join(' ');
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function decodeJwtPayload(token) {
  const payload = token.split('.')[1];
  return JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

async function exchangeToken(body) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Host: 'login.eveonline.com',
    },
    body: new URLSearchParams(body).toString(),
    // WITHOUT THIS a hung SSO exchange hangs FOREVER: the renderer awaits the
    // IPC promise, the overlay's per-character read never settles, and the
    // feed froze every box on its last good data — which is how one pod
    // overlay got "stuck on the wrong ship" after a reship. A failed refresh
    // is recoverable (retry next poll); a hung one wedged the whole overlay.
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error_description || json.error || `SSO token HTTP ${res.status}`);
  }
  const payload = decodeJwtPayload(json.access_token);
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in - 30) * 1000,
    characterId: Number(String(payload.sub).split(':').pop()),
    characterName: payload.name,
  };
}

/** Waits for exactly one valid callback hit, then shuts the server down. */
function waitForCallback(expectedState) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, `http://localhost:${SSO_PORT}`);
      if (url.pathname !== CALLBACK_PATH) {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const ok = code && state === expectedState;
      res.writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(
        ok
          ? '<body style="font-family:sans-serif;background:#0d0d0d;color:#c3c2b7;text-align:center;padding-top:20vh"><h2 style="color:#fff">Login complete</h2><p>You can close this tab and return to EVE Conductor.</p></body>'
          : '<body style="font-family:sans-serif;text-align:center;padding-top:20vh"><h2>Login failed</h2><p>State mismatch or missing code — try again from the app.</p></body>',
      );
      if (ok) {
        cleanup();
        resolve(code);
      }
    });
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('Login timed out — no callback received within 5 minutes.'));
    }, LOGIN_TIMEOUT_MS);
    function cleanup() {
      clearTimeout(timer);
      server.close();
    }
    server.on('error', (e) => {
      cleanup();
      reject(e.code === 'EADDRINUSE'
        ? new Error(`Port ${SSO_PORT} is in use — close the conflicting app and retry.`)
        : e);
    });
    server.listen(SSO_PORT, '127.0.0.1');
  });
}

/** Full login: open the system browser, catch the callback, exchange the code. */
async function login(clientId) {
  if (!clientId) throw new Error('Set your EVE application Client ID first (Settings → EVE login).');
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));

  const codePromise = waitForCallback(state); // listen before opening the browser
  const params = new URLSearchParams({
    response_type: 'code',
    redirect_uri: `http://localhost:${SSO_PORT}${CALLBACK_PATH}`,
    client_id: clientId,
    scope: SCOPES,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  });
  shell.openExternal(`${AUTH_URL}?${params.toString()}`);

  const code = await codePromise;
  return exchangeToken({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    code_verifier: verifier,
  });
}

async function refresh(clientId, refreshToken) {
  if (!clientId || !refreshToken) throw new Error('Not logged in.');
  return exchangeToken({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
  });
}

module.exports = { login, refresh, SSO_PORT, CALLBACK_PATH, SCOPES };
