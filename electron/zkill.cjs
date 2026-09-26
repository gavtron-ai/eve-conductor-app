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
// email may ship), keep requests spaced, honour 429 + Retry-After, and
// (v0.237.0, round-two R4) "cache responses locally": an answer is kept in
// memory for as long as its own Cache-Control max-age says (an hour when
// the header is missing), so opening Battle Reports or the Leaderboard
// twice within the hour asks once. A cached answer counts as no request.

const { USER_AGENT } = require('./ua.cjs');
const HEADERS = { Accept: 'application/json', 'User-Agent': USER_AGENT };
// v0.221.0: what this process asks of zKillboard, per UTC day (in memory) — folded into the app's net meter
const meter = { day: '', count: 0, cached: 0 };
const rollDay = () => { const d = new Date().toISOString().slice(0, 10); if (meter.day !== d) { meter.day = d; meter.count = 0; meter.cached = 0; } };
const countRequest = () => { rollDay(); meter.count++; };
const countCached = () => { rollDay(); meter.cached++; };
const zkillMeter = () => ({ ...meter });
/** at most one request in flight, and this long between two of them */
const MIN_GAP_MS = 1100;
const TIMEOUT_MS = 15_000;
/** how long to wait after a 429 with no Retry-After header */
const DEFAULT_BACKOFF_MS = 20_000;
/** how long an answer is reused when it carries no Cache-Control max-age — zKill's own list cache */
const CACHE_MS = 3_600_000;
/** the longest any max-age is honoured, whatever the header says */
const CACHE_MAX_MS = 24 * 3_600_000;
/** answers kept at once; the oldest goes first */
const CACHE_ENTRIES = 200;

/** PURE: how long an answer may be reused, from its Cache-Control header (ms; 0 = do not keep) */
function cacheTtlMs(cacheControl) {
  const cc = String(cacheControl || '').toLowerCase();
  if (/(^|[,\s])(no-store|no-cache)([,\s;]|$)/.test(cc)) return 0;
  const m = /(^|[,\s])max-age=(\d+)/.exec(cc);
  if (!m) return CACHE_MS;
  return Math.min(Number(m[2]) * 1000, CACHE_MAX_MS);
}

const cache = new Map(); // url → { until, rows }
const remember = (url, rows, ttl, now) => {
  if (ttl <= 0) return;
  if (cache.size >= CACHE_ENTRIES) cache.delete(cache.keys().next().value);
  cache.set(url, { until: now + ttl, rows });
};
const recall = (url, now) => {
  const hit = cache.get(url);
  if (!hit) return null;
  if (hit.until <= now) { cache.delete(url); return null; }
  return hit.rows;
};
const cacheStats = () => ({ entries: cache.size });

let chain = Promise.resolve();
let lastAt = 0;

/** serialised, spaced GET → parsed JSON array, or [] on any failure (strict: null on failure, so a
 * caller that must tell "nothing there" from "could not read" can) */
function getRows(url, strict) {
  const FAIL = strict ? null : [];
  const kept = recall(url, Date.now());
  if (kept !== null) { countCached(); return Promise.resolve(kept); }
  const run = async () => {
    const again = recall(url, Date.now()); // a call queued behind the one that fetched this very URL
    if (again !== null) { countCached(); return again; }
    const wait = lastAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    for (let attempt = 0; attempt < 2; attempt++) {
      lastAt = Date.now();
      let res;
      try {
        countRequest();
        res = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        return FAIL;
      }
      if (res.status === 429) {
        const ra = Number(res.headers.get('retry-after'));
        await new Promise((r) => setTimeout(r, Number.isFinite(ra) && ra > 0 ? ra * 1000 : DEFAULT_BACKOFF_MS));
        continue;
      }
      if (!res.ok) return FAIL;
      try {
        const rows = await res.json();
        if (!Array.isArray(rows)) return FAIL;
        remember(url, rows, cacheTtlMs(res.headers.get('cache-control')), Date.now());
        return rows;
      } catch {
        return FAIL;
      }
    }
    return FAIL;
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
async function corpKillmails(corpId, page) {
  if (!corpId) return { kills: [], losses: [] };
  // PAGES (v0.208.0, the leaderboard's "reach further back"): measured 2026-09-20 — page 2 is the
  // next 200, strictly older, no overlap with page 1. Page 1 keeps the bare URL (zKill's cache key).
  const p = Math.min(10, Math.max(1, Math.floor(Number(page) || 1)));
  const tail = p > 1 ? `page/${p}/` : '';
  const kills = (await getRows(`https://zkillboard.com/api/kills/corporationID/${corpId}/${tail}`)).slice(0, 200).map(row).filter(valid);
  const losses = (await getRows(`https://zkillboard.com/api/losses/corporationID/${corpId}/${tail}`)).slice(0, 200).map(row).filter(valid);
  return { kills, losses };
}

/** a CHARACTER's recent killmails — kills AND losses in one feed; the
 * caller classifies by whether the character is the victim */
async function charKillmails(characterId) {
  if (!characterId) return [];
  return (await getRows(`https://zkillboard.com/api/characterID/${characterId}/`)).slice(0, 200).map(lossRow).filter((r) => r.killmail_id && r.hash);
}

/** a list row with what picks a loss WITHOUT opening it: zKill's rows carry
 * the kill time and the victim (measured 2026-09-19: 200 of 200 rows); a
 * row that lacks them reports 0 and the caller asks ESI instead */
const lossRow = (k) => ({
  killmail_id: k.killmail_id,
  hash: k.zkb && k.zkb.hash ? k.zkb.hash : null,
  value: k.zkb && typeof k.zkb.totalValue === 'number' ? k.zkb.totalValue : 0,
  time: Date.parse(k.killmail_time || '') || 0,
  victimCharId: (k.victim && Number(k.victim.character_id)) || 0,
  victimShipId: (k.victim && Number(k.victim.ship_type_id)) || 0,
});

const OWNER_SEGMENT = { character: 'characterID', corporation: 'corporationID', alliance: 'allianceID' };
/**
 * LOSSES OF ONE HULL by a character, a corporation or an alliance (v0.203.1)
 * — the Log Visualizer's enemy-fit reader: the pilot's own losses of the hull
 * you fought, and, when there are none, their corp mates' ("it is pretty
 * common to share fits amongst corp mates"). One request, the same spacing
 * and identification as every other call here; zKill caches it for an hour.
 * Measured 2026-09-19 on all three owner kinds: the filter holds on every row.
 */
async function shipLosses(kind, id, shipTypeId) {
  const seg = OWNER_SEGMENT[kind];
  if (!seg || !id || !shipTypeId) return [];
  return (await getRows(`https://zkillboard.com/api/losses/${seg}/${id}/shipTypeID/${shipTypeId}/`)).slice(0, 200).map(lossRow).filter((r) => r.killmail_id && r.hash);
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

/**
 * ONE killmail's list row by its id (v0.203.2) — Battle Reports knows a
 * loss's kill id but not always its hash, and CCP's public killmail route
 * needs both. Measured 2026-09-19: /api/killID/<id>/ answers one row with
 * the hash, cached for an hour. null when zKill does not know the kill.
 */
async function killRef(killId) {
  if (!killId) return null;
  const rows = (await getRows(`https://zkillboard.com/api/killID/${killId}/`)).map(lossRow).filter((r) => r.killmail_id && r.hash);
  return rows[0] || null;
}

/**
 * ONE PAGE OF ONE MONTH of a corporation's kills or losses (v0.211.0, the leaderboard's history).
 * MEASURED 2026-09-20: /year/Y/month/M/ returns exactly that month (a past August: 43 rows = zKill's
 * own monthly stat; page 2 came back empty), it reaches at least 18 months back, and every row already
 * carries the whole killmail — attackers with damage, final blow, hull and ids — so the history needs
 * no ESI read at all. Rows are trimmed HERE to what the board reads (no items, no positions). `ok:
 * false` = the read failed; `n` = rows zKill returned (200 = a full page, ask for the next).
 */
const part = (p) => ({ ally: (p && p.alliance_id) || 0, corp: (p && p.corporation_id) || 0, char: (p && p.character_id) || 0, ship: (p && p.ship_type_id) || 0, dmg: (p && (p.damage_done ?? p.damage_taken)) || 0, ...(p && p.final_blow ? { fb: true } : {}) });
const trimRows = (raw) => {
  const rows = [];
  for (const k of raw) {
    const t = Date.parse((k && k.killmail_time) || '');
    if (!k || !k.killmail_id || !k.victim || !Number.isFinite(t)) continue;
    rows.push({ id: k.killmail_id, t, system: k.solar_system_id || 0, value: (k.zkb && typeof k.zkb.totalValue === 'number' ? k.zkb.totalValue : 0), victim: part(k.victim), attackers: (Array.isArray(k.attackers) ? k.attackers : []).map(part) });
  }
  return rows;
};
/** THE NEWEST 200 kills or losses, whole killmails (v0.212.0): the leaderboard's quick refresh — two
 * requests and no ESI reads, where it used to hydrate up to 400 killmails from ESI on every visit */
async function corpRecent(corpId, kind) {
  if (!corpId || (kind !== 'kills' && kind !== 'losses')) return { ok: false, n: 0, rows: [] };
  const raw = await getRows(`https://zkillboard.com/api/${kind}/corporationID/${corpId}/`, true);
  return raw === null ? { ok: false, n: 0, rows: [] } : { ok: true, n: raw.length, rows: trimRows(raw) };
}
async function corpMonth(corpId, kind, year, month, page) {
  const y = Math.floor(Number(year)), m = Math.floor(Number(month)), p = Math.min(50, Math.max(1, Math.floor(Number(page) || 1)));
  if (!corpId || (kind !== 'kills' && kind !== 'losses') || !(y >= 2003 && y <= 2100) || !(m >= 1 && m <= 12)) return { ok: false, n: 0, rows: [] };
  const raw = await getRows(`https://zkillboard.com/api/${kind}/corporationID/${corpId}/year/${y}/month/${m}/${p > 1 ? `page/${p}/` : ''}`, true);
  if (raw === null) return { ok: false, n: 0, rows: [] };
  return { ok: true, n: raw.length, rows: trimRows(raw) };
}

module.exports = { zkillMeter, corpKillmails, corpMonth, corpRecent, charKillmails, systemKills, shipLosses, killRef, USER_AGENT, MIN_GAP_MS, CACHE_MS, CACHE_MAX_MS, cacheTtlMs, cacheStats };
