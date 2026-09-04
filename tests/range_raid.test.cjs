// Fixtures for two more v60.31 fixes:
//  A. buyOrderReaches() — MyOrders compared BUY orders station-only, so a
//     region-range bid a few jumps out (which is taking the stock you are
//     bidding for) did not count as beating you. It is now exported from
//     trends.ts and used by all three surfaces.
//  B. raidWatch gap rule — the raid diff ran against prevSnap with no age
//     check, so any gap was written to the permanent log as if it had been
//     watched: windows that elapsed unseen were logged 'survived' (the exact
//     inversion of the truth).

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

// ===== A. BUY ORDER RANGE ================================================
const { buyOrderReaches } = require('./r3/trends.js');

const JITA_STATION = 60003760;
const JITA_SYS = 30000142;
const NEIGHBOUR_SYS = 30000144;   // "within 1 jump" in the stubbed topology
const FAR_SYS = 30002187;         // outside it

const bid = (over) => ({ location_id: 99, system_id: FAR_SYS, range: 'station', ...over });

eq('a bid sitting in MY station competes',
  buyOrderReaches(bid({ location_id: JITA_STATION }), JITA_STATION, JITA_SYS), true);
eq('a REGION-range bid anywhere competes — this is the one that was missed',
  buyOrderReaches(bid({ range: 'region' }), JITA_STATION, JITA_SYS), true);
eq('a station-range bid in another station does NOT',
  buyOrderReaches(bid({ range: 'station' }), JITA_STATION, JITA_SYS), false);
eq('a bid in the SAME system competes whatever its range',
  buyOrderReaches(bid({ system_id: JITA_SYS, range: 'station' }), JITA_STATION, JITA_SYS), true);
eq('a 1-jump bid from a neighbouring system competes',
  buyOrderReaches(bid({ system_id: NEIGHBOUR_SYS, range: '1' }), JITA_STATION, JITA_SYS), true);
eq('a 1-jump bid from far away does not',
  buyOrderReaches(bid({ system_id: FAR_SYS, range: '1' }), JITA_STATION, JITA_SYS), false);

// honest degradation: missing data must never be read as "reaches"
eq('an unknown home system falls back to station-only',
  buyOrderReaches(bid({ range: '5' }), JITA_STATION, 0), false);
eq('a row with no system_id falls back to station-only',
  buyOrderReaches({ location_id: 99, range: '5' }, JITA_STATION, JITA_SYS), false);
eq('a nonsense range is not treated as unlimited',
  buyOrderReaches(bid({ system_id: NEIGHBOUR_SYS, range: 'solarsystem' }), JITA_STATION, JITA_SYS), false);
eq('...but a same-system bid still competes (same system is checked first)',
  buyOrderReaches(bid({ system_id: JITA_SYS, range: 'whatever' }), JITA_STATION, JITA_SYS), true);

// ===== B. THE RAID WATCHER'S GAP RULE ====================================
const theft = require('./r3/theft.js');
let feed = [];
theft.fetchRaidableSkyhooks = async () => feed;

const raid = require('./r3/raidWatch.js');
const MIN = 60_000;
const hook = (planetId, endsInMin) => ({
  planetId,
  solarSystemId: 30000142,
  endMs: Date.now() + endsInMin * MIN,
  startMs: Date.now() - 10 * MIN,
});
const logLines = () => (files.get('theft-raids.ndjson') ?? '').split(NL).filter(Boolean).length;

(async () => {
  // ---- a NORMAL cadence still records ------------------------------------
  feed = [hook(1, 30), hook(2, 30)];
  await raid.runRaidWatchTick();                 // baseline
  feed = [hook(1, 30)];                          // planet 2 vanished mid-window
  const n1 = await raid.runRaidWatchTick();      // immediately after: a real diff
  eq('back-to-back looks DO record a transition', n1 > 0, true);
  eq('...and it reads as a raid, not a survival',
    /"kind":"raided"/.test(files.get('theft-raids.ndjson') ?? ''), true);

  // ---- an 8-HOUR gap must record nothing ---------------------------------
  const before = logLines();
  files.set('theft-wip.json', JSON.stringify({
    t: Date.now() - 8 * 3_600_000,
    snap: [hook(1, 30), hook(2, 30), hook(3, 30)],
  }));
  for (const k of Object.keys(require.cache)) if (k.includes('raidWatch')) delete require.cache[k];
  const raid2 = require('./r3/raidWatch.js');
  await raid2.restoreRaidWip();

  feed = [hook(1, 30)];                          // 2 and 3 gone across the gap
  const n2 = await raid2.runRaidWatchTick();
  eq('an 8-HOUR gap records NOTHING — it cannot know what happened', n2, 0);
  eq('...the permanent log is untouched', logLines(), before);

  // ...but the baseline IS re-seeded, so the NEXT pair of looks works
  feed = [];                                     // planet 1 vanishes too
  const n3 = await raid2.runRaidWatchTick();
  eq('the very next look is usable again', n3 > 0, true);
  eq('...and it recorded something new', logLines() > before, true);

  console.log(`${NL}${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
