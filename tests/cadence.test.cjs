// v0.237.0 (round-two P2): the policy page's CADENCE claims are held to the code's constants. The
// page says "every 55 s", "5 min when nobody is watching", "every 6 s", "once a minute", "every
// 30 minutes", "48 sweeps a day", "1.1 s apart", "kept in memory for the hour", "10–30 minutes",
// "every 11 min", "every 5 min", "an hour" — each of those is a number in a source file, and a
// change to either side without the other fails here. The compiled libraries are read where they
// load under node; OVERLAY_POLL_MS is read from its source line (overlayFeed pulls the ESF data
// files in at load, which the fixture compile does not carry).
const fs = require('fs');
const path = require('path');
const src = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const policy = src('src/help/policy.tsx');
const traffic = policy.slice(policy.indexOf('POLICY_TRAFFIC'), policy.indexOf('POLICY_QA'));
const rowOf = (service) => {
  const i = traffic.indexOf(`service: '${service}'`);
  if (i < 0) return '';
  const j = traffic.indexOf('service:', i + 10);
  return traffic.slice(i, j < 0 ? undefined : j);
};
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { appInfo: undefined, localStorage: global.localStorage, addEventListener: () => {} };
const C = require('./sim/lib/charState.js');
const R = require('./sim/lib/radar.js');
const T = require('./sim/lib/trends.js');
const P = require('./sim/lib/pi.js');
const K = require('./sim/lib/constants.js');
const N = require('./sim/lib/netMeter.js');
const Z = require('../electron/zkill.cjs');
const U = require('../electron/updatePolicy.cjs');
const OVERLAY_POLL_MS = Number(/export const OVERLAY_POLL_MS = ([\d_]+);/.exec(src('src/lib/overlayFeed.ts'))[1].replace(/_/g, ''));

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const says = (row, text) => row.includes(text);

// ---- ESI, characters
const chars = rowOf('ESI (CCP) — characters');
eq('1 "every 55 s" ↔ ONLINE_TTL_S', [says(chars, `every ${C.ONLINE_TTL_S} s`), C.ONLINE_TTL_S], [true, 55]);
eq('2 "5 min when nobody is watching" ↔ ONLINE_IDLE_TTL_S', [says(chars, `${C.ONLINE_IDLE_TTL_S / 60} min when nobody is watching`), C.ONLINE_IDLE_TTL_S], [true, 300]);
eq('3 "every 6 s while the overlay" ↔ OVERLAY_POLL_MS; the attentive TTL sits under it', [says(chars, `every ${OVERLAY_POLL_MS / 1000} s while the overlay`), OVERLAY_POLL_MS, C.ATTENTIVE_TTL_S * 1000 <= OVERLAY_POLL_MS], [true, 6000, true]);
eq('4 "otherwise once a minute" ↔ IDLE_TTL_S', [says(chars, 'otherwise once a minute'), C.IDLE_TTL_S], [true, 60]);
eq('5 "Planets every 11 min" ↔ PI_INTERVAL_MS', [says(chars, `Planets every ${P.PI_INTERVAL_MS / 60_000} min`), P.PI_INTERVAL_MS], [true, 660_000]);
eq('6 "trend books every 5 min" ↔ TRENDS_INTERVAL_MS', [says(chars, `trend books every ${T.TRENDS_INTERVAL_MS / 60_000} min`), T.TRENDS_INTERVAL_MS], [true, 300_000]);

// ---- ESI, market radar
const radar = rowOf('ESI (CCP) — market radar');
eq('7 "every 30 minutes" ↔ RADAR_INTERVAL_MS; "48 sweeps a day" ↔ DIFFS_PER_DAY', [says(radar, `every ${R.RADAR_INTERVAL_MS / 60_000} minutes`), says(radar, `${R.DIFFS_PER_DAY} sweeps a day`), R.DIFFS_PER_DAY], [true, true, 48]);

// ---- Trade Finder scans (v0.244.0): the row's two numbers are the scanner's constants (read from the source — scanner.ts loads the type database)
const scan = rowOf('ESI (CCP) — Trade Finder scans');
const scannerSrc = src('src/lib/scanner.ts');
const ENRICH_CONCURRENCY = Number(/export const ENRICH_CONCURRENCY = (\d+);/.exec(scannerSrc)[1]);
const FAST_ENRICH_LIMIT = Number(/export const FAST_ENRICH_LIMIT = (\d+);/.exec(scannerSrc)[1]);
eq('7b the scan row: "N reads in flight" ↔ ENRICH_CONCURRENCY, "top N" ↔ FAST_ENRICH_LIMIT', [scan.length > 0, says(scan, `${ENRICH_CONCURRENCY} reads in flight`), says(scan, `top ${FAST_ENRICH_LIMIT}`)], [true, true, true]);

// ---- EVE login: since 0.235.0 the exchange runs in the main process; the page must name it and the meter must label it
const login = rowOf('EVE login (CCP)');
eq('8 the login host has a row of its own and the meter labels it the same way', [login.length > 0, N.hostLabel('https://login.eveonline.com/v2/oauth/token')], [true, 'EVE login (CCP)']);

// ---- zKillboard
const zk = rowOf('zKillboard');
eq('9 "1.1 s apart" ↔ MIN_GAP_MS', [says(zk, `${Z.MIN_GAP_MS / 1000} s apart`), Z.MIN_GAP_MS], [true, 1100]);
eq('10 "kept in memory for the hour" ↔ CACHE_MS', [says(zk, 'kept in memory for the hour'), Z.CACHE_MS], [true, 3_600_000]);

// ---- Fuzzwork
const fw = rowOf('Fuzzwork');
eq('11 "10–30 minutes" ↔ PRICE_TTL_MS (10 min); the stock refresh is the 30', [says(fw, `${K.PRICE_TTL_MS / 60_000}–30 minutes`), K.PRICE_TTL_MS], [true, 600_000]);

// ---- GitHub
const gh = rowOf('GitHub');
eq('12 "an hour" ↔ CHECK_EVERY_MS', [says(gh, 'an hour'), U.CHECK_EVERY_MS], [true, 3_600_000]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
