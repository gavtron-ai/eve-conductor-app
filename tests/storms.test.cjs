// v0.109.0 fixtures — metaliminal storm tracking + surplus-bay bank estimate.
//
// S* — storms.ts: parseStormDate year inference, parseStormTrack HTML → rows
//      (newest-per-storm, chrome rows ignored), stormExposure ring math over
//      an injected toy graph (strong = 0–1 jumps, weak = 2–3).
// B* — raidWatch.ts: bankEstimate (time since last KNOWN empty; anchored
//      only when a raid was actually witnessed) and the firstSeenMs stat.
// All expected values hand-computed before the code ran.

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
const NL = String.fromCharCode(10);
const files = new Map();
global.window = {
  appInfo: {
    stats: {
      auxRead: async (n) => (files.has(n) ? files.get(n) : null),
      auxWrite: async (n, c) => { files.set(n, c); },
      auxAppend: async (n, lines) => {
        files.set(n, (files.get(n) ?? '') + lines.join(NL) + NL);
      },
    },
  },
};

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const { parseStormDate, parseStormTrack, stormExposure } = require('./sim/lib/storms.js');

// ===== S1. DATE PARSING (EVE time = UTC, no year printed) =================
// now = 2026-08-19 12:00 UTC
const NOW = Date.UTC(2026, 7, 19, 12, 0);
// S1a: a normal past report — same year. Aug-18@18:03 → 2026-08-18T18:03Z.
eq('S1a same-year past report', parseStormDate('Aug-18@18:03', NOW), Date.UTC(2026, 7, 18, 18, 3));
// S1b: December report read on Jan 1 — MUST resolve to LAST year.
// now = 2026-01-01 12:00 UTC; Dec-31@23:50 as 2026 would be ~365d ahead
// (> 48h) → 2025-12-31T23:50Z.
eq('S1b year boundary rolls back', parseStormDate('Dec-31@23:50', Date.UTC(2026, 0, 1, 12, 0)),
  Date.UTC(2025, 11, 31, 23, 50));
// S1c: 22h in the FUTURE (clock skew) is within the 48h tolerance — kept
// this year. Aug-20@10:00 vs now Aug-19 12:00 = +22h.
eq('S1c near-future stays this year', parseStormDate('Aug-20@10:00', NOW), Date.UTC(2026, 7, 20, 10, 0));
// S1d/e: garbage and unknown month → null, never a guess.
eq('S1d garbage → null', parseStormDate('yesterday', NOW), null);
eq('S1e unknown month → null', parseStormDate('Xyz-18@18:03', NOW), null);

// ===== S2. PAGE PARSING ====================================================
// Shaped like the real page (verified 2026-08-19): a 7-cell row per storm,
// whitespace everywhere, chrome rows with fewer cells. The OLD Exotic A row
// comes FIRST to prove newest-per-storm replacement.
const TD = (s) => `<td>${s}</td>`;
const row = (cells) => `<tr>${NL}  ${cells.map(TD).join(NL + '  ')}${NL}</tr>`;
const html = [
  '<table class="table table-striped"><thead><tr><th>Region</th><th>System</th></tr></thead><tbody>',
  row(['Placid', 'Old-Sys', 'Exotic A', 'Exotic', 'Aug-15@10:00', '80', 'Old Scout']),
  row(['Querious', 'K-YI1L', 'Exotic A', 'Exotic', 'Aug-18@18:03', '9', 'Roderik Reckeless']),
  row(['Curse', 'VOL-MI', 'Gamma A', 'Gamma', 'Aug-18@05:20', '22', 'Kyr Thellere']),
  '<tr><td>page</td><td>chrome</td></tr>', // too few cells — ignored
  row(['Nowhere', 'X-1', 'Weird A', 'Rainbow', 'Aug-18@05:20', '1', 'Nobody']), // unknown type — ignored
  '</tbody></table>',
].join(NL);
const reports = parseStormTrack(html, NOW);
eq('S2a two storms parsed (chrome + unknown type + stale dupe dropped)',
  reports.length, 2);
const exoticA = reports.find((r) => r.name === 'Exotic A');
eq('S2b newest report wins per storm', exoticA.system, 'K-YI1L');
eq('S2c fields parsed', {
  region: exoticA.region, type: exoticA.type,
  reportedMs: exoticA.reportedMs, hours: exoticA.hoursInSystem, by: exoticA.reportedBy,
}, {
  region: 'Querious', type: 'Exotic',
  reportedMs: Date.UTC(2026, 7, 18, 18, 3), hours: 9, by: 'Roderik Reckeless',
});

// ===== S3. EXPOSURE RINGS ==================================================
// Toy graph. Electric B centred at id 100 covers {100:0, 101:1, 102:2};
// Plasma A centred at id 103 covers {103:0, 102:1, 101:2}. ZZZ resolves to
// nothing and must contribute nothing.
const rep = (system, name, type) => ({
  system, name, type, region: 'R', reportedMs: NOW, hoursInSystem: 1, reportedBy: 'S',
});
const resolve = (n) => ({ AAA: 100, BBB: 103 }[n]);
const within = (id) => new Map(
  id === 100 ? [[100, 0], [101, 1], [102, 2]]
  : id === 103 ? [[103, 0], [102, 1], [101, 2]]
  : [],
);
const exp = stormExposure(
  [rep('AAA', 'Electric B', 'Electric'), rep('BBB', 'Plasma A', 'Plasma'), rep('ZZZ', 'Gamma A', 'Gamma')],
  resolve, within,
);
eq('S3a centre is ring 0', exp.get(100).map((m) => [m.type, m.ring]), [['Electric', 0]]);
// 101 sits in BOTH storms — strongest (lowest ring) sorted first
eq('S3b overlap sorted strongest-first', exp.get(101).map((m) => [m.type, m.ring]),
  [['Electric', 1], ['Plasma', 2]]);
eq('S3c weak ring from the other side', exp.get(102).map((m) => [m.type, m.ring]),
  [['Plasma', 1], ['Electric', 2]]);
eq('S3d unresolvable centre contributes nothing', exp.size, 4); // 100,101,102,103 only
eq('S3e centre name carried for the popup', exp.get(102)[0].centerName, 'BBB');

// ===== B. BANK ESTIMATE ====================================================
// The surplus bay: a raid drops ALL of it, so last-witnessed-raid is a real
// "known empty" anchor. Times below are exact multiples of a day for clean
// hand math (1d = 86,400,000 ms).
(async () => {
  const DAY = 86_400_000;
  const NOW2 = 1_760_000_000_000;
  const ev = (t, planetId, kind, extra) => JSON.stringify({ t, planetId, systemId: 900, kind, ...extra });
  files.set('theft-raids.ndjson', [
    // planet 41: survived 6d ago (first seen), raided 2.5d ago → anchored 2.5d
    ev(NOW2 - 6 * DAY, 41, 'survived'),
    ev(NOW2 - 2.5 * DAY, 41, 'raided', { intoWindowMin: 30 }),
    // planet 42: ONLY survived, 5d ago → unanchored floor of 5d
    ev(NOW2 - 5 * DAY, 42, 'survived'),
    // planet 44: raided 4d ago but the user emptied it HIMSELF 1d ago →
    // the newest known-empty wins: anchored 1d
    ev(NOW2 - 4 * DAY, 44, 'raided', { intoWindowMin: 10 }),
    ev(NOW2 - 1 * DAY, 44, 'mine'),
  ].join(NL) + NL);

  const { raidHistory, bankEstimate, emptyStats } = require('./sim/lib/raidWatch.js');
  const { byPlanet } = await raidHistory();

  eq('B1 witnessed raid anchors the clock', bankEstimate(byPlanet.get(41), NOW2), { days: 2.5, anchored: true });
  eq('B2 firstSeenMs is the oldest observation', byPlanet.get(41).firstSeenMs, NOW2 - 6 * DAY);
  eq('B3 survived-only gives an UNanchored floor', bankEstimate(byPlanet.get(42), NOW2), { days: 5, anchored: false });
  eq('B4 own raid beats an older observed raid', bankEstimate(byPlanet.get(44), NOW2), { days: 1, anchored: true });
  eq('B5 never observed → null, never a guess', bankEstimate(emptyStats(), NOW2), null);

  // ===== B6. FILL CURVE (v0.131) — banked loot in STANDARD HAULS ==========
  // Verified game mechanic (EVE Uni Orbital_Skyhook + CCP Skyhook Enhancements
  // FAQ, 2026-08-22): theft window every 3–4 days; one window's pile ≈ one
  // standard haul; surplus rolls over and keeps stacking with NO cap. So
  // cycles = days ÷ 3.5, UNCAPPED — 100% = one haul, and it reads past 100%.
  const { bankCycles, SKYHOOK_CYCLE_DAYS } = require('./sim/lib/raidWatch.js');
  eq('B6a cycle length is the 3–4 day midpoint', SKYHOOK_CYCLE_DAYS, 3.5);
  eq('B6b empty → 0 hauls', bankCycles(0), 0);
  eq('B6c half a cycle → 0.5 hauls', bankCycles(1.75), 0.5);
  eq('B6d one full window → exactly 1 haul (100%)', bankCycles(3.5), 1);
  eq('B6e a skipped window → 2 hauls (200%, NOT clamped)', bankCycles(7), 2);
  eq('B6f a long-neglected silo keeps stacking (uncapped)', bankCycles(14), 4);
  eq('B6g negative days never underflow', bankCycles(-5), 0);
  // bankCycles is the TRUE (uncapped) accumulation — kept for the tooltip that
  // explains a pinned-full bar can hold multiple windows' worth
  eq('B6h 3.5d = 1.0 cycles', Math.round(bankCycles(3.5) * 100), 100);
  eq('B6i 7d = 2.0 cycles', Math.round(bankCycles(7) * 100), 200);
  eq('B6j 1.75d = 0.5 cycles', Math.round(bankCycles(1.75) * 100), 50);
  eq('B6k 14d = 4.0 cycles', Math.round(bankCycles(14) * 100), 400);

  // ===== B7. IN-GAME BAR (v0.140) — MEASURED day-counter, ~125 d to full ===
  // Calibrated 2026-08-24 from four bar readings paired with app-witnessed
  // raid dates (LEARNINGS/skyhook-fill-calibration.md): the bar fills ~1
  // tic/day on a ~125-tic gauge. Expected values hand-computed as
  // round(min(1, days/125)*100).
  const { barFillPct, SKYHOOK_BAR_DAYS_TO_FULL } = require('./sim/lib/raidWatch.js');
  eq('B7a measured days-to-full is 125', SKYHOOK_BAR_DAYS_TO_FULL, 125);
  eq('B7b empty → 0%', barFillPct(0), 0);
  eq('B7c one theft window (3.5d) → 3% (a sliver, not full!)', barFillPct(3.5), 3);
  eq('B7d the 16P-PX I reading: 3.25d → 3%', barFillPct(3.25), 3);
  eq('B7e the 16P-PX VI reading: 15.35d → 12%', barFillPct(15.35), 12);
  eq('B7f the 6GWE-A reading: 27d → 22%', barFillPct(27), 22);
  eq('B7g the YQTK-R IX reading: 40d → 32%', barFillPct(40), 32);
  eq('B7h 125d → exactly full', barFillPct(125), 100);
  eq('B7i a 300-day hoard CLAMPS to 100%', barFillPct(300), 100);
  eq('B7j negative days → 0%', barFillPct(-3), 0);

  console.log(`${NL}storms.test: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
})();
