// THE CORP KILLBOARD, READ THE WAY THE OWNER READS IT — as a web page.
//
// Measured 2026-08-17: zkill's WEBSITE showed a 30-minute-old loss that
// every API endpoint style was still missing (their list APIs are cached
// ~30 min behind; the site renders from the live DB). The owner "never has
// issues with zkill" because he reads the site — so the app now does too:
// a hidden BrowserWindow loads the corporation page exactly like his
// Chrome (full Chromium, JS enabled, so Cloudflare's interstitial runs and
// passes), and every /kill/{id} link on it is extracted. Ids are all that
// is needed — each one's hash and price come from the per-killmail
// endpoint, which serves even mails the list APIs lack (measured).
//
// This requires NO login scopes and NO corp roles: it works for any corp
// member, which is what makes the tool shareable inside the corp.
const { BrowserWindow, app } = require('electron');
// identifies the app without the owner's email compiled into shared builds
// (the shareability guard caught the literal in v0.186's asar)
const USER_AGENT = `EVE-Conductor/${app?.getVersion?.() ?? 'dev'}`;

/** one page load per press is the ceiling — same load as a human visit */
let inFlight = null;

const PAGE_TIMEOUT_MS = 25_000;
const POLL_MS = 700;

/** a plain Chrome UA: the bundled Chromium version without the app tokens —
 * Cloudflare treats it as the ordinary browser it actually is */
const chromeUa = (ses) => ses.getUserAgent()
  .replace(/\s?Electron\/[^\s]+/, '')
  .replace(/\s?EVEConductor\/[^\s]+/, '');

const EXTRACT = `
  (() => {
    const ids = [...document.querySelectorAll('a[href*="/kill/"]')]
      .map((a) => ((a.getAttribute('href') || '').match(/\\/kill\\/(\\d+)\\//) || [])[1])
      .filter(Boolean).map(Number);
    return [...new Set(ids)];
  })()
`;

async function corpPageKillIds(corpId) {
  if (inFlight) return inFlight; // a second press joins the first load
  inFlight = (async () => {
    let win = null;
    try {
      win = new BrowserWindow({
        show: false,
        width: 1280,
        height: 2000, // tall: the recent list must be in the initial render
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
          // persistent partition: Cloudflare's clearance cookie survives
          // between presses, so only the first load pays the interstitial
          partition: 'persist:zkill-page',
          backgroundThrottling: false,
        },
      });
      win.webContents.setAudioMuted(true);
      win.webContents.setUserAgent(chromeUa(win.webContents.session));
      await win.loadURL(`https://zkillboard.com/corporation/${corpId}/`);
      const deadline = Date.now() + PAGE_TIMEOUT_MS;
      // STABILITY, not a first glimpse: the very first render carries only
      // the top-kills boxes (measured live: a press returned 6 ids while
      // the full page holds ~56). Accept only when two consecutive polls
      // agree — the list has finished rendering by then.
      let lastCount = -1;
      while (Date.now() < deadline) {
        try {
          const ids = await win.webContents.executeJavaScript(EXTRACT, true);
          if (Array.isArray(ids) && ids.length >= 5 && ids.length === lastCount) {
            return ids.sort((a, b) => b - a);
          }
          lastCount = Array.isArray(ids) ? ids.length : -1;
        } catch { lastCount = -1; /* navigating (interstitial) — keep polling */ }
        await new Promise((res) => setTimeout(res, POLL_MS));
      }
      return []; // page never yielded — the report falls back to the APIs
    } catch {
      return [];
    } finally {
      try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* gone */ }
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * A CHARACTER's recent killmails from zKillboard's REST API — main-process
 * fetch (no CORS), returning id + hash + ISK for each. Unlike the corp
 * PAGE reader above this uses the JSON /api/, which is cached ~30 min
 * behind the live site (measured, stated in the UI) but needs no window
 * and no login. Kills AND losses come back in one feed; the caller
 * classifies by whether the character is the victim.
 */
async function charKillmails(characterId) {
  if (!characterId) return [];
  try {
    const res = await fetch(`https://zkillboard.com/api/characterID/${characterId}/`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 200).map((k) => ({
      killmail_id: k.killmail_id,
      hash: k.zkb && k.zkb.hash ? k.zkb.hash : null,
      value: k.zkb && typeof k.zkb.totalValue === 'number' ? k.zkb.totalValue : 0,
    })).filter((k) => k.killmail_id && k.hash);
  } catch {
    return [];
  }
}

/**
 * A SYSTEM's recent killmails from zKillboard (last hour) — main-process fetch
 * (no CORS). Returns id + hash + ISK + zkb.locationID + npc flag for each, so
 * the Theft Conductor's route gatecamp check can count PLAYER kills, place them
 * on a gate (via locationID), and link each one back to zKillboard. Details
 * (attacker ships for bubble detection, victim ship) come from the per-killmail
 * ESI route the caller fetches — this is just the cheap live index.
 */
async function systemKills(systemId, pastSeconds) {
  if (!systemId) return [];
  // zKillboard caps pastSeconds at 7 days; default to the last hour
  const secs = Math.min(604800, Math.max(300, Number(pastSeconds) || 3600));
  try {
    const res = await fetch(`https://zkillboard.com/api/systemID/${systemId}/pastSeconds/${secs}/`, {
      headers: {
        Accept: 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return [];
    const rows = await res.json();
    if (!Array.isArray(rows)) return [];
    return rows.slice(0, 250).map((k) => ({
      killmail_id: k.killmail_id,
      hash: k.zkb && k.zkb.hash ? k.zkb.hash : null,
      value: k.zkb && typeof k.zkb.totalValue === 'number' ? k.zkb.totalValue : 0,
      locationId: k.zkb && k.zkb.locationID ? k.zkb.locationID : 0,
      npc: !!(k.zkb && k.zkb.npc),
    })).filter((k) => k.killmail_id && k.hash);
  } catch {
    return [];
  }
}

module.exports = { corpPageKillIds, charKillmails, systemKills };
