// Storm Track page fetch — MAIN process only, because evescoutrescue.com
// sends no CORS header so the renderer cannot read it. This module fetches
// EXACTLY one hard-coded URL and returns raw HTML; parsing stays in the
// renderer where it is pure and fixture-tested. No generic fetch proxy is
// exposed — the renderer cannot ask main to fetch arbitrary URLs.
const STORM_TRACK_URL = 'https://evescoutrescue.com/home/stormtrack.php';

// identified like every other request the app makes (ua.cjs, v0.199.2)
const { USER_AGENT } = require('./ua.cjs');

/** raw page HTML, or '' on any failure (the renderer treats '' as
 * tracker-unreachable and says so rather than inventing storm data) */
async function stormPage() {
  try {
    const res = await fetch(STORM_TRACK_URL, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return '';
    return await res.text();
  } catch {
    return '';
  }
}

module.exports = { stormPage, STORM_TRACK_URL };
