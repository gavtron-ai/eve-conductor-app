// RUNS INSIDE THE CORP MAP PAGE (v0.200) — executed through the Aperture
// module's <webview> (the user's own logged-in map, in the main window).
// Returns { sigText, sigHeader, graph, probe }:
//   · sigText — the "Signature Search" table, one row per line, cells
//     tab-separated, built CELL BY CELL from the DOM (v0.200.1: innerText
//     glued the class chip onto the system name and put a newline inside
//     the header cell — the first real read showed "J102409C4C")
//   · graph   — the drawn chain: React-Flow nodes (id, text, position,
//     size) and edges (id, aria-label "Edge from A to B", any data-source/
//     data-target, and the path's d attribute for the geometry fallback)
//   · probe   — STRUCTURE only, for the developer: which data feeds the
//     page loaded (paths, no query strings), counts, a masked row sample
//     (letters → A/a, digits → 9, known tokens kept), edge attributes, and
//     (v0.200.2) the SHAPE of the map's own JSON feeds — key names and
//     value types, strings masked — so the next version can read the
//     complete signature list from the feed instead of from whatever the
//     panel happens to be showing.
//
// READS ONLY, and (v0.200.2) TOUCHES NOTHING the user is doing: it no
// longer clicks the map's tabs. If the Signature Search table is not on
// screen, sigText is empty and probe.tableVisible says so; the window
// keeps its last reading and tells the user.
export const CHAIN_EXTRACT = `
  (async () => {
    const tStart = performance.now();
    const vis = (el) => !!el && el.offsetParent !== null;
    const squash = (s) => (s || '').replace(/\\s+/g, ' ').trim();
    const txt = (el) => squash(el && el.innerText);
    // a cell's text with a space between every leaf element (chips, icons,
    // labels) — innerText alone glues inline siblings together
    const cellText = (cell) => {
      const leaves = [...cell.querySelectorAll('*')].filter((e) => e.children.length === 0);
      if (leaves.length === 0) return txt(cell);
      const parts = leaves.map((e) => txt(e)).filter(Boolean);
      // text nodes that sit directly in the cell (outside any element)
      const direct = [...cell.childNodes].filter((n) => n.nodeType === 3).map((n) => squash(n.textContent)).filter(Boolean);
      return squash([...direct, ...parts].join(' '));
    };
    const sigTable = () => [...document.querySelectorAll('table')].find((t) => {
      if (!vis(t)) return false;
      const h = ((t.tHead && t.tHead.innerText) || (t.rows[0] && t.rows[0].innerText) || '').toLowerCase();
      return h.includes('sig') && h.includes('group') && h.includes('system');
    }) || null;
    const t = sigTable();
    const rows = t ? [...t.rows] : [];
    const isHeader = (r) => r.querySelector('th') && !r.querySelector('td');
    const headerRows = rows.filter(isHeader);
    const dataRows = rows.filter((r) => !isHeader(r));
    const rowText = (r) => [...r.cells].map(cellText).join('\\t');
    const sigText = dataRows.map(rowText).join('\\n');
    const sigHeader = headerRows.map(rowText).join(' | ');

    const num = (s) => { const n = parseFloat(s); return Number.isFinite(n) ? n : 0; };
    const nodes = [...document.querySelectorAll('.react-flow__node')].map((n) => {
      const m = /translate\\(\\s*(-?[\\d.]+)px?\\s*,\\s*(-?[\\d.]+)px?\\s*\\)/.exec(n.style.transform || '');
      return {
        id: n.getAttribute('data-id') || '', text: txt(n).slice(0, 120),
        x: m ? num(m[1]) : 0, y: m ? num(m[2]) : 0, w: n.offsetWidth || 0, h: n.offsetHeight || 0,
      };
    });
    const edges = [...document.querySelectorAll('.react-flow__edge')].map((e) => {
      const p = e.querySelector('path[d]');
      return {
        id: e.getAttribute('data-id') || e.getAttribute('data-testid') || e.id || '',
        label: e.getAttribute('aria-label') || '',
        src: e.getAttribute('data-source') || '', tgt: e.getAttribute('data-target') || '',
        d: p ? (p.getAttribute('d') || '').slice(0, 400) : '',
      };
    });
    const resources = [...performance.getEntriesByType('resource')]
      .filter((r) => /xmlhttprequest|fetch|other/.test(r.initiatorType))
      .map((r) => { try { const u = new URL(r.name); return u.origin === location.origin ? u.pathname : u.origin + u.pathname; } catch { return ''; } })
      .filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 40);
    // structure-only masking: known tokens kept, everything else A/a/9
    const KEEP = /^(combat|ore|gas|relic|data|wormhole|c[1-6]|h|l|hs|ls|ns|ago|0\\.0|—|-)$/i;
    const mask = (s) => s.split(' ').map((tok) => (KEEP.test(tok) ? tok : tok.replace(/[A-Z]/g, 'A').replace(/[a-z]/g, 'a').replace(/[0-9]/g, '9'))).join(' ');
    const maskedRows = dataRows.slice(0, 3).map((r) => [...r.cells].map((c) => mask(cellText(c))));
    // how the map colours its EFFECT badges (v0.201.3): for each drawn
    // node, any descendant whose text/title names an effect, with its
    // computed colours — structure only, so the summary can adopt the
    // map's own palette
    const EFFECT_RE = /pulsar|magnetar|wolf|black\\s*hole|red\\s*giant|cataclysmic/i;
    const effectStyles = {};
    for (const n of document.querySelectorAll('.react-flow__node')) {
      for (const el of n.querySelectorAll('*')) {
        const label = squash((el.getAttribute('title') || el.getAttribute('aria-label') || '') + ' ' + (el.children.length === 0 ? (el.textContent || '') : ''));
        const m = EFFECT_RE.exec(label);
        if (!m) continue;
        const key = m[0].toLowerCase().replace(/\\s+/g, '');
        if (effectStyles[key]) continue;
        const cs = getComputedStyle(el);
        effectStyles[key] = { tag: el.tagName.toLowerCase(), cls: (el.getAttribute('class') || '').slice(0, 60), color: cs.color, bg: cs.backgroundColor, border: cs.borderColor, fill: el.getAttribute('fill') || cs.fill, text: mask(label).slice(0, 30) };
      }
    }
    // …and the FULL palette from the map's own front-end code (v0.201.4):
    // effects not drawn today have no badge to measure, so the page's
    // same-origin scripts are searched for each effect's name next to a
    // colour literal. Structure only: effect → colour.
    const effectPalette = {};
    const paletteScan = { files: 0, bytes: 0, hits: 0, cached: false, ms: 0 };
    const tPalette = performance.now();
    // ONCE PER PAGE LOAD (v0.202.7): the scan below fetches and reads every
    // same-origin script and stylesheet — measured 28 files, 2.6 MB, on
    // EVERY read — for a palette that cannot change until the page reloads.
    // The result is kept on the page's window and reused.
    const prior = window.__etcPaletteScan;
    if (prior && prior.palette && prior.scan) {
      Object.assign(effectPalette, prior.palette);
      Object.assign(paletteScan, prior.scan);
      paletteScan.cached = true;
    } else try {
      // every same-origin script and stylesheet the page has loaded — the
      // map's route chunks arrive through dynamic import(), so
      // document.scripts alone misses them; performance timings see all
      const seen = new Set();
      const urls = [];
      const push = (u) => { try { const a = new URL(u, location.href); if (a.origin !== location.origin || seen.has(a.href)) return; seen.add(a.href); urls.push(a.href); } catch { /* skip */ } };
      for (const s of document.scripts) if (s.src) push(s.src);
      for (const l of document.querySelectorAll('link[rel="stylesheet"][href]')) push(l.href);
      for (const r of performance.getEntriesByType('resource')) if (/\\.(m?js|css)(\\?|$)/i.test(r.name)) push(r.name);
      for (const u of urls.slice(0, 40)) {
        let code = '';
        try { const r = await fetch(u, { credentials: 'include' }); if (!r.ok) continue; code = await r.text(); } catch { continue; }
        if (code.length > 12000000) continue;
        paletteScan.files++; paletteScan.bytes += code.length;
        for (const name of ['pulsar', 'magnetar', 'wolf', 'black hole', 'blackhole', 'red giant', 'redgiant', 'cataclysmic']) {
          if (effectPalette[name]) continue;
          const re = new RegExp(name.replace(' ', '[\\\\s_-]?'), 'ig');
          let m; let guard = 0;
          while ((m = re.exec(code)) && guard++ < 300) {
            // the colour that belongs to a name FOLLOWS it (magnetar:"#e06fdf")
            // — the map's real palette sits right after a status-colour
            // object, so a colour before the name is someone else's
            const after = code.slice(m.index, m.index + 60);
            const COLOUR = /#[0-9a-f]{8}\\b|#[0-9a-f]{6}\\b|#[0-9a-f]{3}\\b|(?:rgba?|hsla?|oklch|oklab)\\([^)]*\\)|bg-\\[[^\\]]+\\]|["\\x27]([0-9a-f]{6})["\\x27]/i;
            const col = COLOUR.exec(after);
            if (col) { paletteScan.hits++; effectPalette[name] = { color: col[0], from: u.split('/').pop().slice(0, 40), near: code.slice(Math.max(0, m.index - 40), m.index + 120).replace(/\\s+/g, ' ') }; break; }
          }
        }
      }
    } catch { /* the palette is a nicety */ }
    paletteScan.ms = Math.round(performance.now() - tPalette);
    if (!paletteScan.cached) window.__etcPaletteScan = { palette: effectPalette, scan: { ...paletteScan } };
    const tFeed = performance.now();

    // the map's own JSON feeds, SHAPE ONLY (v0.200.2): same origin, same
    // login, the same paths the page itself just loaded. Strings masked,
    // numbers typed, arrays summarised by length + first item.
    const shape = (v, depth) => {
      if (v === null || v === undefined) return 'null';
      if (Array.isArray(v)) return depth <= 0 ? 'array' : { array: v.length, item: v.length ? shape(v[0], depth - 1) : 'empty' };
      if (typeof v === 'object') { if (depth <= 0) return 'object'; const o = {}; for (const k of Object.keys(v).slice(0, 40)) o[k] = shape(v[k], depth - 1); return o; }
      if (typeof v === 'string') return 'str:' + mask(squash(v)).slice(0, 24);
      return typeof v;
    };
    // THE FEED (v0.200.3): the map document and its system data, raw, for
    // the renderer to read (chainFeed.ts infers the field roles). The
    // probe keeps their shape too. Per-system signature lists are fetched
    // by a second script once the system ids are known.
    const api = {};
    const apiItems = {};
    const feed = { mapId: '', map: null, systemData: null, status: {} };
    const pathId = (re, list) => list.map((p) => (re.exec(p) || [])[1]).find(Boolean) || '';
    const mid = (/\\/maps?\\/(\\d+)/.exec(location.pathname) || [])[1] || pathId(/^\\/api\\/map\\/(\\d+)/, resources);
    feed.mapId = mid;
    if (mid) {
      const paths = ['/api/map/' + mid, '/api/map/' + mid + '/system-data'];
      for (const p of paths) {
        try {
          const r = await fetch(p, { credentials: 'include', headers: { accept: 'application/json' } });
          const ct = r.headers.get('content-type') || '';
          feed.status[p] = { status: r.status, type: ct.slice(0, 40) };
          if (!r.ok || !/json/i.test(ct)) { api[p] = feed.status[p]; continue; }
          const text = await r.text();
          if (text.length > 4000000) { api[p] = { status: r.status, tooLarge: text.length }; continue; }
          const j = JSON.parse(text);
          api[p] = { status: r.status, shape: shape(j, 4) };
          // the log flattens deep objects, so the item shapes of every list
          // near the root are recorded FLAT, one entry per list
          const lists = (v, path, depth) => {
            if (!v || typeof v !== 'object' || depth > 3) return;
            if (Array.isArray(v)) { if (v.length && v[0] && typeof v[0] === 'object') apiItems[p + ' ' + path] = shape(v[0], 1); return; }
            for (const k of Object.keys(v)) lists(v[k], path ? path + '.' + k : k, depth + 1);
          };
          lists(j, '', 0);
          if (p.endsWith('/system-data')) feed.systemData = j; else feed.map = j;
        } catch (e) { api[p] = { error: String((e && e.message) || e).slice(0, 80) }; feed.status[p] = api[p]; }
      }
    }
    return {
      sigText, sigHeader,
      graph: { nodes, edges },
      feed,
      probe: {
        tableVisible: !!t, mapId: mid,
        // where the guest's time went (v0.202.7): the palette scan, the feed
        // fetches, and the whole script — read from the log after a real open
        timings: { paletteMs: paletteScan.ms, feedMs: Math.round(performance.now() - tFeed), totalMs: Math.round(performance.now() - tStart) },
        resources,
        tables: [...document.querySelectorAll('table')].map((x) => ((x.rows[0] && x.rows[0].innerText) || '').replace(/\\s+/g, ' ').slice(0, 80)),
        rfNodes: nodes.length, rfEdges: edges.length, svgs: document.querySelectorAll('svg').length,
        canvases: document.querySelectorAll('canvas').length,
        dataRows: dataRows.length, headerRows: headerRows.length, maskedRows, effectStyles, effectPalette, paletteScan,
        nodeSample: nodes.slice(0, 4).map((n) => ({ ...n, text: mask(n.text) })),
        edgeSample: edges.slice(0, 4).map((e) => ({ id: e.id, label: e.label, src: e.src, tgt: e.tgt, d: e.d.slice(0, 60) })),
        api, apiItems,
        title: document.title, mapTitle: txt(document.querySelector('h1,h2,[class*="title"]')).slice(0, 80),
      },
    };
  })()
`;

/**
 * Second script: one system's signature list per drawn system, from the
 * same route the page uses, four requests at a time. Ids are embedded as
 * JSON so nothing from the page can smuggle code in.
 */
export function chainSigsScript(mapId: string, systemIds: readonly string[]): string {
  const ids = JSON.stringify(systemIds.filter((s) => /^[\w-]+$/.test(s)).slice(0, 200));
  const mid = JSON.stringify(String(mapId).replace(/[^\w-]/g, ''));
  return `
  (async () => {
    const ids = ${ids}; const mid = ${mid}; const out = {};
    let i = 0;
    const one = async () => {
      while (i < ids.length) {
        const sid = ids[i++]; const p = '/api/map/' + mid + '/systems/' + sid + '/signatures';
        try {
          const r = await fetch(p, { credentials: 'include', headers: { accept: 'application/json' } });
          const ct = r.headers.get('content-type') || '';
          if (!r.ok || !/json/i.test(ct)) { out[sid] = { __status: r.status }; continue; }
          out[sid] = await r.json();
        } catch (e) { out[sid] = { __error: String((e && e.message) || e).slice(0, 80) }; }
      }
    };
    await Promise.all([one(), one(), one(), one()]);
    return out;
  })()`;
}

export interface ChainNodeDom { id: string; text: string; x: number; y: number; w: number; h: number }
export interface ChainEdgeDom { id: string; label: string; src: string; tgt: string; d: string }
export interface ChainFeedRaw {
  mapId: string;
  map: unknown;
  systemData: unknown;
  status: Record<string, { status?: number; type?: string; error?: string }>;
}

/** what the Aperture module makes of the feed, posted to the window */
export interface FeedRead {
  systems: { id: string; label: string; jcode: string; cls: string; eveId: string; tag: string; effect: string }[];
  /** pairs of system ids */
  edges: [string, string][];
  sigs: { sig: string; group: string; system: string; cls: string; name: string; ageH: number | null }[];
  /** the map's own home system, when its document names one */
  home: { id: string; label: string } | null;
  report: unknown;
  status: ChainFeedRaw['status'];
}

export interface ChainExtract {
  sigText: string;
  sigHeader: string;
  graph: { nodes: ChainNodeDom[]; edges: ChainEdgeDom[] };
  feed?: ChainFeedRaw;
  feedRead?: FeedRead | null;
  probe: Record<string, unknown> & { tableVisible?: boolean };
}
