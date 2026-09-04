// APERTURE IMPORT — parseSystemList against the OWNER'S REAL copied text.
//
// v0.129.0 added a "pull from Aperture" button: the app loads his logged-in
// corp map in a hidden window, opens Map info → Systems, and reads the table
// out. Whether that background read drives the popup can only be verified on
// his machine (his private authenticated session) — but the SECOND half, what
// parseSystemList does with the copied text, is verifiable here against the
// EXACT string he pasted from his map (Ctrl-A/Ctrl-C of the Systems tab).
//
// Ground truth from his screenshots + paste (map "FLORIDA", 7 systems):
//   Airkio  H   k-space  (import)
//   J141848 C3  wormhole (skip)
//   J100001 C2  wormhole (skip, alias "Home")
//   J220654 C1  wormhole (skip)
//   Jita    H   k-space  (import)
//   Kuhri   L   k-space  (import)
//   Neda    L   k-space  (import)
// => 4 k-space imported, 3 wormholes skipped.

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { parseSystemList } = require('./sim/lib/theft.js');

let passed = 0;
let failed = 0;
const eq = (label, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g === w) { passed++; }
  else { failed++; console.error(`FAIL ${label}\n  got:  ${g}\n  want: ${w}`); }
};
const has = (label, arr, name) => {
  if (arr.includes(name)) { passed++; }
  else { failed++; console.error(`FAIL ${label}: expected ${name} in ${JSON.stringify(arr)}`); }
};

const TAB = String.fromCharCode(9);
const NL = String.fromCharCode(10);
const row = (cells) => cells.join(TAB);

// ---- 1. the isolated Systems TABLE (what the <table>.innerText read returns) ----
const tableText = [
  row(['System', 'Region / Constellation', 'Sec', 'Status', 'Statics']),
  row(['Airkio', 'Lonetrek / Karnola', 'H', 'unknown', '—']),
  row(['J141848', 'C-R00015 / C-C00151', 'C3', 'unknown', 'L']),
  row(['J100001 (Home)', 'B-R00004 / B-C00023', 'C2', 'friendly', 'C3, H']),
  row(['J220654', 'A-R00002 / A-C00008', 'C1', 'unknown', 'H']),
  row(['Jita', 'The Forge / Kimotoro', 'H', 'unknown', '—']),
  row(['Kuhri', 'Khanid / Homroon', 'L', 'unknown', '—']),
  row(['Neda', 'Khanid / Homroon', 'L', 'unknown', '—']),
].join(NL);

{
  const r = parseSystemList(tableText);
  eq('table: 4 k-space imported', r.systemIds.length, 4);
  eq('table: matched names', r.matched.slice().sort(), ['Airkio', 'Jita', 'Kuhri', 'Neda']);
  eq('table: 3 wormholes skipped', r.wormholes.slice().sort(), ['J100001', 'J141848', 'J220654']);
  // the column header ("System") and other chrome must never resolve to a system
  const badIds = r.systemIds.filter((id) => typeof id !== 'number');
  eq('table: no junk ids', badIds, []);
}

// ---- 2. the WHOLE-PAGE select-all copy (the body.innerText fallback) — his
// actual paste, chrome and all. Must yield the identical set. ----
const pageText = [
  'ApertureAperture',
  'EVE 03:55',
  'FLORIDA',
  'corp · wh · 7 systems',
  '2121667732',
  'Map',
  'Signatures',
  'Signature Search',
  'Select a system on the map to view its signatures.',
  'Inspector',
  'Routes',
  'Intel',
  'Structures',
  'Kill Statistics',
  'System Graph',
  'System Killboard',
  'Select a system, connection, or note to edit.',
  'Aperture — collaborative wormhole mapping for EVE Online',
  'Credits',
  'EVE Online and all related trademarks are property of Fenris Creations.',
  'FLORIDA',
  'corp · wh',
  '',
  row(['System', 'Region / Constellation', 'Sec', 'Status', 'Statics']),
  row(['Airkio', 'Lonetrek / Karnola', 'H', 'unknown', '—']),
  row(['J141848', 'C-R00015 / C-C00151', 'C3', 'unknown', 'L']),
  row(['J100001 (Home)', 'B-R00004 / B-C00023', 'C2', 'friendly', 'C3, H']),
  row(['J220654', 'A-R00002 / A-C00008', 'C1', 'unknown', 'H']),
  row(['Jita', 'The Forge / Kimotoro', 'H', 'unknown', '—']),
  row(['Kuhri', 'Khanid / Homroon', 'L', 'unknown', '—']),
  row(['Neda', 'Khanid / Homroon', 'L', 'unknown', '—']),
].join(NL);

{
  const r = parseSystemList(pageText);
  eq('page: 4 k-space imported', r.systemIds.length, 4);
  eq('page: matched names', r.matched.slice().sort(), ['Airkio', 'Jita', 'Kuhri', 'Neda']);
  eq('page: 3 wormholes skipped', r.wormholes.slice().sort(), ['J100001', 'J141848', 'J220654']);
  // page chrome that happens to be an EVE thing must not sneak in:
  // "Intel", "Routes", "Map", "Credits", "FLORIDA" (the map name, not a system)
  // — none are EVE systems, so the set stays exactly the four above.
  has('page: has Airkio', r.matched, 'Airkio');
  has('page: has Neda', r.matched, 'Neda');
}

// ---- 3. the two reads must agree (background table read == his manual copy) ----
{
  const a = parseSystemList(tableText).systemIds.slice().sort((x, y) => x - y);
  const b = parseSystemList(pageText).systemIds.slice().sort((x, y) => x - y);
  eq('table read == page read', a, b);
}

console.log(`aperture_import.test: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
