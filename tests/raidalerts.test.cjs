// RAID ALERTS (v0.137) — the pure shaping of the overlay's nearby-raid box.
// The overlay + ESI feed can't be driven headless; this pins the filtering,
// open/soon state, last-raid age, and ordering that decide what he's told.

const { buildRaidAlerts } = require('./sim/lib/raidAlerts.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

const NOW = 1_000_000_000_000; // fixed clock
const MIN = 60_000, DAY = 86_400_000;

// reach: system -> jumps from map (viaId = which mapped system it's measured
// from, as reachFrom now reports). 100=0j(on map),101=2j,102=3j,103=5j(too far)
const reach = new Map([
  [100, { jumps: 0, viaId: 100 }],
  [101, { jumps: 2, viaId: 100 }],
  [102, { jumps: 3, viaId: 100 }],
  [103, { jumps: 5, viaId: 100 }],
]);
const names = { 100: 'HOME', 101: 'TWO', 102: 'THREE', 103: 'FAR' };
const ptypes = { 9001: 'Lava', 9002: 'Ice', 9003: 'Lava', 9004: 'Lava' };
const raids = { 9001: NOW - 2 * DAY, 9002: 0, 9003: NOW - 30 * DAY, 9004: 0 };
const get = {
  systemName: (id) => names[id] ?? `#${id}`,
  planetType: (pid) => ptypes[pid] ?? null,
  lastRaidMs: (pid) => raids[pid] ?? 0,
};

const feed = [
  { planetId: 9001, systemId: 101, startMs: NOW - 10 * MIN, endMs: NOW + 50 * MIN }, // OPEN, 2j, raided 2d ago
  { planetId: 9002, systemId: 100, startMs: NOW + 90 * MIN, endMs: NOW + 180 * MIN }, // SOON, 0j
  { planetId: 9003, systemId: 102, startMs: NOW - 5 * MIN, endMs: NOW + 25 * MIN },   // OPEN, 3j, raided 30d ago
  { planetId: 9004, systemId: 103, startMs: NOW - 5 * MIN, endMs: NOW + 25 * MIN },   // 5j — FILTERED OUT
];

const out = buildRaidAlerts(feed, reach, 3, NOW, get);

eq('A1 too-far (5j) dropped, 3 remain', out.length, 3);
eq('A2 5j system never appears', out.some((r) => r.systemName === 'FAR'), false);
// ordering: OPEN first (nearest open first), then SOON
eq('A3 order = open@2j, open@3j, soon', out.map((r) => `${r.state}:${r.jumps}`), ['open:2', 'open:3', 'soon:0']);
// the 2d-ago open one
const a = out[0];
eq('A4 open minsLeft = until close (~50m)', a.minsLeft, 50);
eq('A5 planet type carried', a.planetType, 'Lava');
eq('A6 lastRaidDays ~2', Math.round(a.lastRaidDays), 2);
// the soon one
const soon = out.find((r) => r.state === 'soon');
eq('A7 soon minsLeft = until open (~90m)', soon.minsLeft, 90);
eq('A8 never-seen-raided -> lastRaidDays null', soon.lastRaidDays, null);
// radius 0 keeps only on-map systems
eq('A9 radius 0 -> only the 0j soon one', buildRaidAlerts(feed, reach, 0, NOW, get).map((r) => r.systemName), ['HOME']);
// empty feed -> empty
eq('A10 empty feed -> []', buildRaidAlerts([], reach, 3, NOW, get), []);
// via information (v0.138): each alert names the mapped system it's measured from
eq('A11 via carried from reach', a.viaName, 'HOME');
// openOnly (v0.138): drop everything not raidable RIGHT NOW
const openOnly = buildRaidAlerts(feed, reach, 3, NOW, get, true);
eq('A12 openOnly keeps only open windows', openOnly.map((r) => `${r.state}:${r.systemName}`), ['open:TWO', 'open:THREE']);
eq('A13 openOnly drops the soon one', openOnly.some((r) => r.state === 'soon'), false);

console.log(`raidalerts.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
