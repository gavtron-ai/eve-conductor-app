// v0.225.0 (audit A2): the market radar sweeps only the regions of the hubs the user watches — by
// default the duty hubs of the team's traders (Jita alone when there are none), or an explicit list
// from Settings → Market radar. Before, it swept all five built-in regions for everyone: measured on
// 2026-09-23 at 408 + 184 + 117 + 73 + 120 = 902 pages a sweep, 48 sweeps a day = 43,296 requests
// and ≈1.3 GB on the wire per install per day. These fixtures drive the SHIPPED pure functions.
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { appInfo: undefined, localStorage: global.localStorage };
const { resolveRadarRegions, automaticRadarHubIds, sweepCost, DIFFS_PER_DAY, RADAR_INTERVAL_MS } = require('./sim/lib/radar.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const FORGE = 10000002, DOMAIN = 10000043, SINQ = 10000032, HEIMATAR = 10000030, METRO = 10000042, CUSTOM_REGION = 10000069;
const hubs = [
  { id: 'jita', name: 'Jita', kind: 'station', locationId: 60003760, regionId: FORGE, builtin: true },
  { id: 'amarr', name: 'Amarr', kind: 'station', locationId: 60008494, regionId: DOMAIN, builtin: true },
  { id: 'dodixie', name: 'Dodixie', kind: 'station', locationId: 60011866, regionId: SINQ, builtin: true },
  { id: 'rens', name: 'Rens', kind: 'station', locationId: 60004588, regionId: HEIMATAR, builtin: true },
  { id: 'hek', name: 'Hek', kind: 'station', locationId: 60005686, regionId: METRO, builtin: true },
  // a user's own hub in a region the built-ins do not cover, and a second hub inside The Forge
  { id: 'sys-30000001', name: 'My structure', kind: 'structure', locationId: 1000000000001, regionId: CUSTOM_REGION },
  { id: 'sys-30000142', name: 'Perimeter', kind: 'system', locationId: 30000142, regionId: FORGE },
];

// ---- automatic: the traders' duty hubs
eq('no characters → Jita alone', automaticRadarHubIds([], hubs), ['jita']);
eq('traders without a duty hub, and haulers, count for nothing → Jita alone',
  automaticRadarHubIds([{ tradeRole: 'trader' }, { tradeRole: 'hauler', homeHubId: 'amarr' }, { role: 'x' }], hubs), ['jita']);
eq('two traders at Jita and Amarr, a hauler at Dodixie → Jita + Amarr, in team order, no duplicates',
  automaticRadarHubIds([
    { tradeRole: 'trader', homeHubId: 'jita' }, { tradeRole: 'hauler', homeHubId: 'dodixie' },
    { tradeRole: 'trader', homeHubId: 'amarr' }, { tradeRole: 'trader', homeHubId: 'jita' },
  ], hubs), ['jita', 'amarr']);
eq('a trader whose duty hub is a CUSTOM hub is followed (the old code only knew the built-ins)',
  automaticRadarHubIds([{ tradeRole: 'trader', homeHubId: 'sys-30000001' }], hubs), ['sys-30000001']);
eq('a duty hub id that no longer exists is skipped',
  automaticRadarHubIds([{ tradeRole: 'trader', homeHubId: 'gone' }, { tradeRole: 'trader', homeHubId: 'hek' }], hubs), ['hek']);

// ---- regions: null/undefined = automatic; a list = exactly that; regions never repeat
const team = [{ tradeRole: 'trader', homeHubId: 'jita' }, { tradeRole: 'trader', homeHubId: 'amarr' }];
eq('undefined setting (an install from before 0.225.0) → the duty hubs\' regions', resolveRadarRegions(undefined, team, hubs), [FORGE, DOMAIN]);
eq('null setting → the same', resolveRadarRegions(null, team, hubs), [FORGE, DOMAIN]);
eq('null with no traders → The Forge only', resolveRadarRegions(null, [], hubs), [FORGE]);
eq('an empty list → nothing is swept', resolveRadarRegions([], team, hubs), []);
eq('an explicit list wins over the team', resolveRadarRegions(['rens', 'hek'], team, hubs), [HEIMATAR, METRO]);
eq('two hubs in one region count that region once; unknown ids are dropped',
  resolveRadarRegions(['jita', 'sys-30000142', 'nope', 'jita'], team, hubs), [FORGE]);
eq('all five built-ins → the five regions, in hub order',
  resolveRadarRegions(['jita', 'amarr', 'dodixie', 'rens', 'hek'], team, hubs), [FORGE, DOMAIN, SINQ, HEIMATAR, METRO]);

// ---- cost: pages measured on 2026-09-23, 48 sweeps a day (30-minute cadence)
eq('48 sweeps a day at the 30-minute cadence', [DIFFS_PER_DAY, RADAR_INTERVAL_MS], [48, 1_800_000]);
const measured = new Map([[FORGE, 408], [DOMAIN, 184], [SINQ, 117], [HEIMATAR, 73], [METRO, 120]]);
eq('all five regions: 902 pages a sweep = 43,296 requests a day (the audit\'s number)',
  sweepCost([FORGE, DOMAIN, SINQ, HEIMATAR, METRO], measured), { pagesPerSweep: 902, requestsPerDay: 43_296, unknown: [] });
eq('Jita alone: 408 pages = 19,584 a day', sweepCost([FORGE], measured), { pagesPerSweep: 408, requestsPerDay: 19_584, unknown: [] });
eq('Jita + Amarr: 592 pages = 28,416 a day', sweepCost([FORGE, DOMAIN], measured), { pagesPerSweep: 592, requestsPerDay: 28_416, unknown: [] });
eq('no region → zero, not null', sweepCost([], measured), { pagesPerSweep: 0, requestsPerDay: 0, unknown: [] });
eq('a region not yet swept is named, and the known ones still add up', sweepCost([FORGE, CUSTOM_REGION], measured), { pagesPerSweep: 408, requestsPerDay: 19_584, unknown: [CUSTOM_REGION] });
eq('nothing measured yet → null, not a fake zero', sweepCost([CUSTOM_REGION], new Map()), { pagesPerSweep: null, requestsPerDay: null, unknown: [CUSTOM_REGION] });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
