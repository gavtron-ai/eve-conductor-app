// zKILLBOARD — the JSON API only, from the main process, identified.
//
// v0.199.1 replaced zkillPage.cjs, which loaded the corp's killboard PAGE
// in a hidden Chromium window with a plain browser user agent so that
// Cloudflare's bot check would pass, then scraped the kill links. That is
// scraping a site that bans scrapers, while hiding who we are — the app's
// single largest third-party exposure (POLICY-AUDIT-2026-09-12 C1). Gone.
//
// What this costs, measured 2026-09-12 with the headers zKill itself sends:
// the corporation list endpoints are cached `max-age=3600`, so a kill by a
// corp member who is NOT logged into Conductor can take up to an hour to
// appear here. Kills involving the user's own logged-in characters come
// live from ESI regardless, and a Director token makes the whole corp feed
// live from ESI (battleReport.ts merges all three). Same reports, later.
//
// zKill's stated API rules, followed here: identify yourself with a
// User-Agent that carries contact (the public repo URL — no personal
// email may ship), keep requests spaced, honour 429 + Retry-After.

const { USER_AGENT } = require('./ua.cjs');
const HEADERS = { Accept: 'application/json', 'User-Agent': USER_AGENT };
/** at most one request in flight, and this long between two of them */
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 15_000;
/** how long to wait after a 429 with no Retry-After header */
const DEFAULT_BACKOFF_MS = 20_000;

let chain = Promise.resolve();
let lastAt = 0;

/** serialised, spaced GET → parsed JSON array, or [] on any failure */
function getRows(url) {
  const run = async () => {
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    for (let attempt = 0; attempt < 2; attempt++) {
      lastAt = Date.now();
      let res;
      try {
        res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        return [];
      }
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? ra * 1000 : DEFAULT_BACKOFF_MS));
        continue;
      }
      if (!res.ok) return [];
      try {
        const rows = await res.json();
        return Array.isArray(rows) ? rows : [];
      } catch {
        return [];
      }
    }
    return [];
  };
  const p = chain.then(run, run);
  chain = p.catch(() => undefined);
  return p;
}

/** a raw zKill list row, trimmed to what the app reads */
const row = (k) => ({
  killmail_id: k.killmail_id,
  zkb: {
    hash: k.zkb && k.zkb.hash ? k.zkb.hash : null,
    totalValue: k.zkb && typeof k.zkb.totalValue === 'number' ? k.zkb.totalValue : 0,
    locationID: k.zkb && k.zkb.locationID ? k.zkb.locationID : 0,
    npc: !!(k.zkb && k.zkb.npc),
  },
});
const valid = (r) => r.killmail_id && r.zkb.hash;

/**
 * A CORPORATION's recent kills and losses (up to 200 each) — the feed the
 * Battle Reports tab clusters into fights. Cached by zKill for an hour.
 */
async function corpKillmails(corpId) {
  if (!corpId) return { kills: [], losses: [] };
  const kills = (await getRows(`https://zkillboard.com/api/kills/corporationID/${corpId}/`)).slice(0, 200).map(row).filter(valid);
  const losses = (await getRows(`https://zkillboard.com/api/losses/corporationID/${corpId}/`)).slice(0, 200).map(row).filter(valid);
  return { kills, losses };
}

/** a CHARACTER's recent killmails — kills AND losses in one feed; the
 * caller classifies by whether the character is the victim */
async function charKillmails(characterId) {
  if (!characterId) return [];
  return (await getRows(`https://zkillboard.com/api/characterID/${characterId}/`)).slice(0, 200).map(row).filter(valid)
    .map((r) => ({ killmail_id: r.killmail_id, hash: r.zkb.hash, value: r.zkb.totalValue }));
}

/** a SYSTEM's recent killmails (default: the last hour) — the Theft
 * Conductor's route gatecamp check; details come from ESI per mail */
async function systemKills(systemId, pastSeconds) {
  if (!systemId) return [];
  // zKillboard caps pastSeconds at 7 days; default to the last hour
  const secs = Math.min(604800, Math.max(300, Number(pastSeconds) || 3600));
  return (await getRows(`https://zkillboard.com/api/systemID/${systemId}/pastSeconds/${secs}/`)).slice(0, 250).map(row).filter(valid)
    .map((r) => ({ killmail_id: r.killmail_id, hash: r.zkb.hash, value: r.zkb.totalValue, locationId: r.zkb.locationID, npc: r.zkb.npc }));
}

module.exports = { corpKillmails, charKillmails, systemKills, USER_AGENT };
