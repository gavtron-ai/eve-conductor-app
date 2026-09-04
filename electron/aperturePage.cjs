// APERTURE, READ THE WAY THE OWNER READS IT — as his own logged-in page.
//
// The owner's system list lives in his corp's private Aperture map
// (a Next.js SPA at his configured URL). His manual flow: open the map, click
// "Map info", switch to the "Systems" tab, Ctrl-A, Ctrl-C, paste into the
// Theft Conductor. This does the whole thing for him with NOTHING on screen:
// a hidden BrowserWindow loads that same map on the SAME persistent session
// the visible Aperture webview uses (partition "persist:aperture"), so it is
// already authenticated — no login, no API key, no request to the corp's
// servers beyond the identical page load his browser already makes. It then
// opens Map info → Systems in the background DOM and reads the systems table
// out, exactly what his Ctrl-A/Ctrl-C would copy.
//
// INTEGRITY (RULE 3): it returns text ONLY when the systems table is actually
// present (the "Region / Constellation" header is the proof). If he is not
// logged in, or the map never rendered, it returns '' and the button says so
// rather than importing a half-loaded or empty list.
const { BrowserWindow } = require('electron');

/** one background load at a time — a second press joins the first */
let inFlight = null;

const PAGE_TIMEOUT_MS = 25_000;
const POLL_MS = 700;

// Runs INSIDE the map page. Ensures the Map-info → Systems popup is open, then
// returns the systems table. Robust to how the SPA renders the popup — whether
// it mounts the dialog only when open, or keeps it in the DOM and toggles
// display — by keying every decision off VISIBILITY, never mere DOM presence:
//   · the Systems tab is visible ONLY when the popup is open, so its
//     visibility is the "popup open?" signal (no reliance on [role=dialog])
//   · "Map info" is only clicked when the popup is closed, so we never toggle
//     an open popup shut; clicking the Systems tab when already on it is a no-op
//   · a table only counts when it is actually rendered (offsetParent) AND its
//     header reads System + Region — a hidden or wrong table is ignored
// Idempotent across the caller's polls. Returns { ok, text, rowCount, src }.
const EXTRACT = `
  (async () => {
    const vis = (el) => !!el && el.offsetParent !== null;
    // pick the INNERMOST element whose text matches — a container (the top bar,
    // a tab strip) also contains the label, and clicking a container does
    // nothing; the real button is the match with no matching descendant
    const byText = (re, sel) => {
      const all = [...document.querySelectorAll(sel)].filter((e) => re.test((e.textContent || '').trim()));
      return all.find((e) => !all.some((o) => o !== e && e.contains(o))) || all[0];
    };
    const CLICKABLE = 'button,[role="button"],[role="tab"],a,div,span,li';
    const systemsTab = () => byText(/^systems(\\s*\\(\\d+\\))?$/i, CLICKABLE);
    const visibleTable = () => {
      for (const t of document.querySelectorAll('table')) {
        if (!vis(t)) continue;
        const h = (((t.tHead && t.tHead.innerText) || (t.rows[0] && t.rows[0].innerText) || '')).toLowerCase();
        if (h.indexOf('system') !== -1 && h.indexOf('region') !== -1 && (t.innerText || '').trim()) return t;
      }
      return null;
    };

    let t = visibleTable();
    if (!t) {
      // open the popup only if it isn't already (the Systems tab is visible
      // exactly when it is open) — clicking "Map info" while open would close it
      if (!vis(systemsTab())) {
        const mi = byText(/map\\s*info/i, CLICKABLE);
        if (mi) { mi.click(); await new Promise((r) => setTimeout(r, 450)); }
      }
      const tab = systemsTab(); // now visible if the popup opened
      if (tab) { tab.click(); await new Promise((r) => setTimeout(r, 450)); }
      t = visibleTable();
    }
    if (t) {
      const rows = (t.tBodies && t.tBodies[0]) ? t.tBodies[0].rows.length : Math.max(0, t.rows.length - 1);
      return { ok: true, text: t.innerText, rowCount: rows, src: 'table' };
    }
    // fallback: no <table>, but the tab may render the systems as a grid. body
    // innerText is exactly what his Ctrl-A/Ctrl-C copies (and excludes hidden
    // nodes), and the Theft Conductor parser discards page chrome. Gate on the
    // header so we NEVER return a map that isn't actually showing its systems.
    const body = document.body.innerText || '';
    const ok = /region\\s*\\/\\s*constellation/i.test(body);
    return { ok, text: ok ? body : '', rowCount: -1, src: 'body' };
  })()
`;

/**
 * Load the configured Aperture map in a hidden, already-authenticated window
 * and return the copied text of its Systems table (tab-separated, the same
 * shape as a manual Ctrl-C). Returns '' if the map could not be read
 * (not logged in, wrong URL, never rendered) — the caller surfaces that.
 */
async function fetchSystems(url) {
  const target = String(url || '').trim();
  if (!/^https?:\/\//i.test(target)) return ''; // only load a real http(s) map
  if (inFlight) return inFlight; // a second press joins the first load
  inFlight = (async () => {
    let win = null;
    try {
      win = new BrowserWindow({
        show: false,
        width: 1600,
        height: 1200,
        webPreferences: {
          sandbox: true,
          nodeIntegration: false,
          contextIsolation: true,
          // THE SAME SESSION the visible Aperture webview uses — this is what
          // makes the background load authenticated without any login step
          partition: 'persist:aperture',
          backgroundThrottling: false,
        },
      });
      win.webContents.setAudioMuted(true);
      await win.loadURL(target);
      const deadline = Date.now() + PAGE_TIMEOUT_MS;
      // STABILITY, not a first glimpse: the map data streams in after load, so
      // the Systems tab can render 0 rows then fill. Accept only when two
      // consecutive reads agree on the row count (and the header is present).
      let lastCount = -2;
      while (Date.now() < deadline) {
        try {
          const r = await win.webContents.executeJavaScript(EXTRACT, true);
          if (r && r.ok && typeof r.text === 'string' && r.text.trim()) {
            if (r.rowCount === lastCount) return r.text; // stable
            lastCount = r.rowCount;
          } else {
            lastCount = -2;
          }
        } catch {
          lastCount = -2; // navigating / not ready — keep polling
        }
        await new Promise((res) => setTimeout(res, POLL_MS));
      }
      return ''; // never yielded a systems table — caller explains why
    } catch {
      return '';
    } finally {
      try { if (win && !win.isDestroyed()) win.destroy(); } catch { /* gone */ }
      inFlight = null;
    }
  })();
  return inFlight;
}

module.exports = { fetchSystems };
