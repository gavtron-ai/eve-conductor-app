// CHAIN SUMMARY (v0.200) — parser, graph walk, valuation and filters,
// pinned with hand-computed expectations. The signature rows are copied
// from Gavin's Signature Search panel (2026-09-13 screenshot).
const C = require('./sim/lib/chain.js');
const T = require('./sim/lib/chainTables.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };

// A: the table as innerText — cells tab-separated, a header row, an icon-less sig cell
const TABLE = [
  'SIG\tGROUP\tSYSTEM\tNAME\tAGE',
  'AC6-000\tOre\tJ102409 C4C\tCommon Perimeter Deposit\t7h ago',
  'AHF-430\tCombat\tMJI3-8 0.0\tGuristas Hidden Hub\t5h ago',
  'APH-650\tData\tJ145555 C3B\tUnsecured Frontier Database\t1h ago',
  'AQZ-632\tCombat\tJ214440 C4D\tFrontier Barracks\t2h ago',
  'AUM-784\tWormhole\tHole Tanked C4F\t—\t1h ago',
  'AWD-864\tCombat\tJ120354 C5A\tOruze Osobnyk\t7h ago',
  'AYX-360\tCombat\tJ145555 C3B\tOutpost Frontier Stronghold\t1h ago',
  'BDQ-174\tWormhole\tHomebase C2\t—\t1h ago',
  'BFB-743\tCombat\tChardalane L\tSerpentis Hideaway\t1h ago',
  'BJP-516\tOre\tJ235852 C2B\tAverage Frontier Deposit\t2h ago',
  'BKU-991\t—\tJ110411 C3D\t—\t1h ago',
].join('\n');
const sigs = C.parseSigSearch(TABLE);
check('A1 eleven rows parsed (header skipped)', sigs.length === 11, String(sigs.length));
check('A2 class from "C4C" is C4 and the letter is dropped', sigs[0].system === 'J102409' && sigs[0].cls === 'C4', JSON.stringify(sigs[0]));
check('A3 k-space 0.0 → NS', sigs[1].cls === 'NS' && sigs[1].system === 'MJI3-8');
check('A4 custom two-word label kept whole', sigs[4].system === 'Hole Tanked' && sigs[4].cls === 'C4', JSON.stringify(sigs[4]));
check('A5 lowsec letter L → LS', sigs[8].cls === 'LS' && sigs[8].system === 'Chardalane');
check('A6 age "7h ago" → 7', sigs[0].ageH === 7);
check('A7 unnamed row keeps an empty name', sigs[10].name === '' && sigs[10].group === 'Other');
check('A8 age helper: 23m → 0.38h, 2d → 48h', Math.abs(C.parseAge('23m ago') - 23 / 60) < 1e-9 && C.parseAge('2d ago') === 48);

// B: graph from React-Flow-style ids
const nodeIds = ['homebase', 'j120452', 'j145848', 'j214440', 'j145555', 'jita'];
const edgeIds = ['rf__edge-homebase-j120452', 'e-j120452-j145848', 'j120452-j214440', 'reactflow__edge-j214440-j145555', 'jita-homebase'];
const edges = C.edgesFromIds(nodeIds, edgeIds);
check('B1 every edge id resolves to a pair', edges.length === 5, JSON.stringify(edges));
const hops = C.hopsFrom('homebase', edges);
check('B2 home is 0, static is 1, two deep is 2, three deep is 3', hops.get('homebase') === 0 && hops.get('j120452') === 1 && hops.get('j145848') === 2 && hops.get('j145555') === 3, JSON.stringify([...hops]));
check('B3 k-space neighbour of home is 1 hop', hops.get('jita') === 1);
check('B4 an unconnected system is absent', !hops.has('nowhere'));
const n1 = C.systemOfNodeText('C4 A J145848 C3 C4', ['J145848', 'Homebase']);
const n2 = C.systemOfNodeText('C2 Homebase 🏠 C3 H', ['J145848', 'Homebase']);
const n3 = C.systemOfNodeText('C4 F Hole Tanked C3 C5', ['Hole Tanked']);
check('B5 node text → J-code + class', n1.system === 'J145848' && n1.cls === 'C4', JSON.stringify(n1));
check('B6 node text → custom home label', n2.system === 'Homebase' && n2.cls === 'C2', JSON.stringify(n2));
check('B7 node text → two-word label', n3.system === 'Hole Tanked', JSON.stringify(n3));
const n4 = C.systemOfNodeText('C2 Homebase 🏠 C3 H', []);
const n5 = C.systemOfNodeText('C4 E Shadow Garden C3 C4', []);
const n6 = C.systemOfNodeText('L Chardalane Placid', []);
check('B8 home node with no sig row and a glyph → Homebase', n4.system === 'Homebase' && n4.cls === 'C2', JSON.stringify(n4));
check('B9 labelled two-word custom name with no sig row', n5.system === 'Shadow Garden' && n5.cls === 'C4', JSON.stringify(n5));
check('B10 k-space node keeps its name, region dropped by the caller', n6.cls === 'LS' && n6.system.startsWith('Chardalane'), JSON.stringify(n6));

// C: valuation with hand-set prices
const price = (n) => ({ 'Fullerite-C50': 100, 'Fullerite-C60': 200, 'Arkonor': 1000, 'Bistot': 900, 'Gneiss': 30, 'Kernite': 10, 'Omber': 8, 'Pyroxeres': 5 })[n] ?? null;
const tables = { gas: T.GAS_SITES, ore: T.ORE_SITES };
const v1 = C.valueSig({ sig: 'X', group: 'Combat', system: 'J', cls: 'C4', name: 'Frontier Barracks', ageH: 1 }, price, tables);
check('C1 Frontier Barracks = 86.7M blue loot', v1.isk === 86_700_000, JSON.stringify(v1));
const v2 = C.valueSig({ sig: 'X', group: 'Gas', system: 'J', cls: 'C1', name: 'Barren Perimeter Reservoir', ageH: 1 }, price, tables);
check('C2 Barren = 12,000×100 + 6,000×200 = 2.4M', v2.isk === 12_000 * 100 + 6_000 * 200, JSON.stringify(v2));
const v3 = C.valueSig({ sig: 'X', group: 'Ore', system: 'J', cls: 'C2', name: 'Common Perimeter Deposit', ageH: 1 }, price, tables);
const expect3 = 20_000 * 1000 + 30_000 * 900 + 40_000 * 30 + 300_000 * 10 + 300_000 * 8 + 520_000 * 5;
check('C3 Common Perimeter Deposit priced rock by rock', v3.isk === expect3, `${v3.isk} vs ${expect3}`);
const v4 = C.valueSig({ sig: 'X', group: 'Combat', system: 'K', cls: 'NS', name: 'Guristas Hidden Hub', ageH: 1 }, price, tables);
check('C4 k-space anomaly outside the bounty table carries no estimate and says so', v4.isk === null && /not in the bounty table/.test(v4.basis), JSON.stringify(v4));
// v0.201: k-space bounties, k-space gas/ore tables and the player's own hauls
const tablesK = { ...tables,
  kcombat: { 'Guristas Hidden Hub': { isk: 21_500_000, faction: 'Guristas', tier: 'Hidden Hub', ships: 40, waves: 9 } },
  kgas: { 'Amber Nebula': [{ gas: 'Amber Mykoserocin', units: 3_000 }] },
  kore: { 'Small Asteroid Cluster|HS': [{ ore: 'Kernite', units: 1_000 }], 'Small Asteroid Cluster': [{ ore: 'Arkonor', units: 10 }] },
  hauls: (site, group) => (site === 'Ruined Sansha Temple Site' && group === 'Relic' ? { isk: 33_000_000, basis: 'your average of 2 hauls · last 2026-09-15' } : null),
};
const priceK = (n) => ({ ...{ 'Fullerite-C50': 100, 'Fullerite-C60': 200, 'Arkonor': 1000, 'Bistot': 900, 'Gneiss': 30, 'Kernite': 10, 'Omber': 8, 'Pyroxeres': 5 }, 'Amber Mykoserocin': 500 })[n] ?? null;
const k1 = C.valueSig({ sig: 'X', group: 'Combat', system: 'K', cls: 'NS', name: 'Guristas Hidden Hub', ageH: 1 }, priceK, tablesK);
check('K1 a k-space anomaly in the bounty table: 21.5M with the rat and wave counts in the basis', k1.isk === 21_500_000 && /40 rats in 9 waves/.test(k1.basis) && /before ESS/.test(k1.basis), JSON.stringify(k1));
const k2 = C.valueSig({ sig: 'X', group: 'Gas', system: 'K', cls: 'LS', name: 'Amber Nebula', ageH: 1 }, priceK, tablesK);
check('K2 a k-space gas site priced from its clouds: 3,000 × 500', k2.isk === 1_500_000 && /3,000 Amber Mykoserocin/.test(k2.basis), JSON.stringify(k2));
const k3 = C.valueSig({ sig: 'X', group: 'Ore', system: 'K', cls: 'HS', name: 'Small Asteroid Cluster', ageH: 1 }, priceK, tablesK);
const k4 = C.valueSig({ sig: 'X', group: 'Ore', system: 'K', cls: 'NS', name: 'Small Asteroid Cluster', ageH: 1 }, priceK, tablesK);
check('K3 the security-specific ore entry wins for HS (1,000 Kernite = 10k), the plain one otherwise (10 Arkonor = 10k)', k3.isk === 10_000 && /Kernite/.test(k3.basis) && k4.isk === 10_000 && /Arkonor/.test(k4.basis), JSON.stringify([k3, k4]));
const k5 = C.valueSig({ sig: 'X', group: 'Relic', system: 'J', cls: 'C2', name: 'Ruined Sansha Temple Site', ageH: 1 }, priceK, tablesK);
check('K4 a pirate relic site takes the player\'s own average with its basis', k5.isk === 33_000_000 && /your average of 2 hauls/.test(k5.basis), JSON.stringify(k5));
const k6 = C.valueSig({ sig: 'X', group: 'Relic', system: 'J', cls: 'C2', name: 'Ruined Guristas Crystal Quarry', ageH: 1 }, priceK, tablesK);
check('K5 a pirate site with no hauls says how to start one', k6.isk === null && /log a haul/.test(k6.basis), JSON.stringify(k6));
const k7 = C.valueSig({ sig: 'X', group: 'Relic', system: 'J', cls: 'C1', name: 'Forgotten Perimeter Coronation Platform', ageH: 1 }, priceK, tablesK);
check('K6 a sleeper relic site keeps its fixed blue loot even when hauls exist for other sites', k7.isk === 12_800_000);
const k8 = C.valueSig({ sig: 'X', group: 'Combat', system: 'J', cls: 'C3', name: '', ageH: 1 }, priceK, tablesK);
check('K7 an unnamed combat signature is "unnamed"; an unnamed relic is "unscanned"', k8.basis === 'unnamed' && C.valueSig({ sig: 'X', group: 'Relic', system: 'J', cls: 'C3', name: '', ageH: 1 }, priceK, tablesK).basis === 'unscanned');
const v5 = C.valueSig({ sig: 'X', group: 'Gas', system: 'J', cls: 'C5', name: 'Vital Core Reservoir', ageH: 1 }, price, tables);
check('C5 gas with no prices at all → null, says so', v5.isk === null && v5.basis === 'no prices');

// D: summary + filters over the parsed rows with a small chain
const chainEdges = [['Homebase', 'J120452'], ['J120452', 'J214440'], ['J214440', 'J145555'], ['J120452', 'J145848'], ['Homebase', 'Chardalane']];
const h = C.hopsFrom('Homebase', chainEdges);
const all = C.summarize(sigs, h, { maxHops: null, classes: new Set(), groups: new Set(), maxAgeH: null }, price, tables);
check('D1 wormhole rows excluded by default, named + unnamed activities kept', all.rows.every((r) => r.group !== 'Wormhole') && all.rows.length === 9, String(all.rows.length));
check('D2 combat tile sums only valued sites (Barracks 86.7 + Outpost 45.1 + Osobnyk 164.7)', all.byGroup.Combat.isk === 86_700_000 + 45_100_000 + 164_700_000 && all.byGroup.Combat.unvalued === 2, JSON.stringify(all.byGroup.Combat));
const near = C.summarize(sigs, h, { maxHops: 2, classes: new Set(), groups: new Set(), maxAgeH: null }, price, tables);
check('D3 holes ≤ 2 drops J145555 (3 out) and systems not on the chain', near.rows.every((r) => r.hops !== null && r.hops <= 2) && !near.rows.some((r) => r.system === 'J145555'), JSON.stringify(near.rows.map((r) => [r.system, r.hops])));
const c4 = C.summarize(sigs, h, { maxHops: null, classes: new Set(['C4']), groups: new Set(['Combat']), maxAgeH: null }, price, tables);
check('D4 class C4 + Combat → exactly Frontier Barracks', c4.rows.length === 1 && c4.rows[0].name === 'Frontier Barracks', JSON.stringify(c4.rows.map((r) => r.name)));
const fresh = C.summarize(sigs, h, { maxHops: null, classes: new Set(), groups: new Set(), maxAgeH: 3 }, price, tables);
check('D5 max age 3 h drops the 5 h and 7 h rows', fresh.rows.every((r) => r.ageH === null || r.ageH <= 3) && fresh.rows.length === 6, String(fresh.rows.length));
check('D6 rows sort nearest first, then richest', all.rows[0].hops === 1 && (all.rows[0].value.isk ?? 0) >= (all.rows[1].value.isk ?? 0) || all.rows[0].hops < all.rows[1].hops);

// E: v0.200.1 — what the REAL map showed on the first press (2026-09-14):
// innerText glued the class chip to the name; node text starts with a
// count and may carry a glyph tag; edge ids are bare numbers, so edges
// resolve from data attributes, React Flow's aria-label, or geometry.
const g1 = C.parseSystemCell('J102409C4C');
const g2 = C.parseSystemCell('Hole TankedC4F');
const g3 = C.parseSystemCell('MJI3-80.0');
const g4 = C.parseSystemCell('ChardalaneL');
const g5 = C.parseSystemCell('MJI3-8');
const g6 = C.parseSystemCell('J102409 C4 C');
const g7 = C.parseSystemCell('J102409 C4 🐊');
check('E1 glued J-code + chip + tag', g1.system === 'J102409' && g1.cls === 'C4', JSON.stringify(g1));
check('E2 glued two-word label', g2.system === 'Hole Tanked' && g2.cls === 'C4', JSON.stringify(g2));
check('E3 glued nullsec 0.0', g3.system === 'MJI3-8' && g3.cls === 'NS', JSON.stringify(g3));
check('E4 glued lowsec letter', g4.system === 'Chardalane' && g4.cls === 'LS', JSON.stringify(g4));
check('E5 a capital-letter name with no chip is never split', g5.system === 'MJI3-8' && g5.cls === '', JSON.stringify(g5));
check('E6 chip and tag as separate cells', g6.system === 'J102409' && g6.cls === 'C4', JSON.stringify(g6));
check('E7 glyph tag after the chip', g7.system === 'J102409' && g7.cls === 'C4', JSON.stringify(g7));
const TABLE2 = [
  '\tAC6-000\t🪨 Ore\tJ102409C4C\tCommon Perimeter Deposit\t7h ago\t',
  '\tAHF-430\tCombat\tMJI3-80.0\tGuristas Hidden Hub\t5h ago\t',
].join('\n');
const sigs2 = C.parseSigSearch(TABLE2);
check('E8 leading empty cell, icon in the group cell, glued chip → still Ore / C4', sigs2.length === 2 && sigs2[0].group === 'Ore' && sigs2[0].cls === 'C4' && sigs2[0].system === 'J102409', JSON.stringify(sigs2[0]));
check('E9 glued nullsec row → NS', sigs2[1].cls === 'NS' && sigs2[1].system === 'MJI3-8', JSON.stringify(sigs2[1]));
const n7 = C.systemOfNodeText('42 C2 🐊 Homebase C3 H', []);
const n8 = C.systemOfNodeText('3 H Zaveral Aridia', []);
const n9 = C.systemOfNodeText('4 C3 C J142951 H', []);
const n10 = C.systemOfNodeText('42 C2 🐊 Homebase C3 H', ['Homebase']);
check('E10 count + class + glyph + label + statics', n7.system === 'Homebase' && n7.cls === 'C2', JSON.stringify(n7));
check('E11 count + highsec + name + region', n8.cls === 'HS' && n8.system.startsWith('Zaveral'), JSON.stringify(n8));
check('E12 count + class + letter tag + J-code + static', n9.system === 'J142951' && n9.cls === 'C3', JSON.stringify(n9));
check('E13 known label wins with the count prefix present', n10.system === 'Homebase' && n10.cls === 'C2', JSON.stringify(n10));
// resolveEdges: nodes laid out by hand — A at (0,0) 100×40, B at (300,0) 100×40, Cn at (0,200) 100×40
const N = [{ id: '1', x: 0, y: 0, w: 100, h: 40 }, { id: '618', x: 300, y: 0, w: 100, h: 40 }, { id: '1805', x: 0, y: 200, w: 100, h: 40 }];
const E = [
  { id: '12766', label: 'Edge from 1 to 618', src: '', tgt: '', d: '' },
  { id: '12774', label: '', src: '1', tgt: '1805', d: '' },
  { id: '12775', label: '', src: '', tgt: '', d: 'M100,20 C200,20 200,20 300,20' },   // A's right edge → B's left edge
  { id: '12776', label: '', src: '', tgt: '', d: 'M50,40 L50,200' },                  // A's bottom → C's top
  { id: '12777', label: '', src: '', tgt: '', d: 'M900,900 L950,950' },               // nowhere near a node
  { id: '12778', label: 'Edge from 1 to 999', src: '', tgt: '', d: '' },              // unknown node id
];
const R = C.resolveEdges(N, E);
check('E14 aria-label resolves', R.pairs.some(([a, b]) => a === '1' && b === '618') && R.how.label === 1, JSON.stringify(R));
check('E15 data attributes resolve', R.pairs.some(([a, b]) => a === '1' && b === '1805') && R.how.attr === 1, JSON.stringify(R.how));
check('E16 geometry resolves both drawn paths, drops the stray and the unknown id', R.how.geom === 2 && R.how.none === 2 && R.pairs.length === 4, JSON.stringify(R));
const ends = C.pathEnds('M 12.5,-3 L 40 50 Q 1 2 60.25 70');
check('E17 pathEnds takes the first and last coordinate pair', ends && ends.a[0] === 12.5 && ends.a[1] === -3 && ends.b[0] === 60.25 && ends.b[1] === 70, JSON.stringify(ends));
// hidden-because-unknown counts: two rows with no class and no hops
const sigs3 = [
  { sig: 'A', group: 'Combat', system: 'X', cls: '', name: 'Frontier Barracks', ageH: 1 },
  { sig: 'B', group: 'Combat', system: 'Y', cls: 'C4', name: 'Frontier Barracks', ageH: 1 },
];
const h3 = new Map([['Y', 1]]);
const s3 = C.summarize(sigs3, h3, { maxHops: null, classes: new Set(['C4']), groups: new Set(), maxAgeH: null }, price, tables);
check('E18 class filter reports the row it hid for having no class', s3.rows.length === 1 && s3.hiddenNoClass === 1 && s3.hiddenNoHops === 0, JSON.stringify([s3.rows.length, s3.hiddenNoClass, s3.hiddenNoHops]));
const s4 = C.summarize(sigs3, h3, { maxHops: 2, classes: new Set(), groups: new Set(), maxAgeH: null }, price, tables);
check('E19 distance filter reports the row it hid for having no distance', s4.rows.length === 1 && s4.hiddenNoHops === 1 && s4.unreachable === 1, JSON.stringify([s4.rows.length, s4.hiddenNoHops, s4.unreachable]));

// F: v0.200.2 — sleeper relic/data sites priced by their guards' blue loot
const f1 = C.valueSig({ sig: 'X', group: 'Relic', system: 'J', cls: 'C1', name: 'Forgotten Perimeter Coronation Platform', ageH: 1 }, price, tables);
const f2 = C.valueSig({ sig: 'X', group: 'Data', system: 'J', cls: 'C5', name: 'Unsecured Frontier Enclave Relay', ageH: 1 }, price, tables);
const f3 = C.valueSig({ sig: 'X', group: 'Relic', system: 'J', cls: 'C2', name: 'Ruined Guristas Crystal Quarry', ageH: 1 }, price, tables);
const f4 = C.valueSig({ sig: 'X', group: 'Data', system: 'J', cls: 'C6', name: 'Unsecured Core Emergence', ageH: 1 }, price, tables);
check('F1 C1 relic = 12.8M guards\' blue loot, cans flagged extra', f1.isk === 12_800_000 && /cans extra/.test(f1.basis), JSON.stringify(f1));
check('F2 C5 data = 329.9M (the wiki total, not the pre-hack 114M)', f2.isk === 329_900_000, JSON.stringify(f2));
check('F3 pirate relic stays unpriced and says why', f3.isk === null && /random/.test(f3.basis), JSON.stringify(f3));
check('F4 C6 data = 627.1M', f4.isk === 627_100_000 && f4.basis.includes('C6 data'), JSON.stringify(f4));
check('F5 all 24 sleeper hack sites tabulated, 12 relic + 12 data, 4 per class', (() => {
  const v = Object.values(C.HACK_BLUE_LOOT);
  const perCls = [1, 2, 3, 4, 5, 6].map((c) => v.filter((x) => x.cls === c).length);
  return v.length === 24 && v.filter((x) => x.kind === 'Relic').length === 12 && perCls.every((n) => n === 4);
})(), JSON.stringify(Object.keys(C.HACK_BLUE_LOOT).length));
const sigsF = [
  { sig: 'A', group: 'Relic', system: 'J', cls: 'C3', name: 'Forgotten Frontier Quarantine Outpost', ageH: 1 },
  { sig: 'B', group: 'Data', system: 'J', cls: 'C3', name: 'Unsecured Frontier Database', ageH: 1 },
  { sig: 'C', group: 'Data', system: 'J', cls: 'C3', name: 'Local Guristas Mainframe', ageH: 1 },
];
const sF = C.summarize(sigsF, null, { maxHops: null, classes: new Set(), groups: new Set(), maxAgeH: null }, price, tables);
check('F6 relic tile 76.5M, data tile 88.4M with one unvalued pirate site', sF.byGroup.Relic.isk === 76_500_000 && sF.byGroup.Data.isk === 88_400_000 && sF.byGroup.Data.unvalued === 1, JSON.stringify([sF.byGroup.Relic, sF.byGroup.Data]));

// G: v0.200.4 — a system focus from the chain drawing
const sG = C.summarize(sigs, h, { maxHops: null, classes: new Set(), groups: new Set(), maxAgeH: null, systems: new Set(['J145555']) }, price, tables);
check('G1 system focus keeps only that system\'s rows (Outpost + Database)', sG.rows.length === 2 && sG.rows.every((r) => r.system === 'J145555'), JSON.stringify(sG.rows.map((r) => r.name)));
const sG2 = C.summarize(sigs, h, { maxHops: null, classes: new Set(), groups: new Set(), maxAgeH: null, systems: new Set() }, price, tables);
check('G2 an empty focus set means all systems', sG2.rows.length === all.rows.length);

// H: v0.200.5 — the map's per-system tag from node text
check('H1 letter tag after the class', C.tagOfNodeText('4 C3 C J142951 H') === 'C' && C.tagOfNodeText('C3 B J135355 L') === 'B');
check('H2 glyph tag', C.tagOfNodeText('42 C2 🐊 Homebase C3 H') === '🐊');
check('H3 no tag on a k-space node whose name follows the class', C.tagOfNodeText('3 H Zaveral Aridia') === '' && C.tagOfNodeText('H Jita The Forge') === '');
check('H4 a J-code right after the class is not a tag', C.tagOfNodeText('C4 J102409 C3') === '');
// v0.201.4 — the real map also prefixes an AGE badge ("4h") and a pilot count before the class
check('H5 age and count badges before the class are skipped for the tag', C.tagOfNodeText('4h 5 C6 A J100501 C4') === 'A' && C.tagOfNodeText('7h C3 A J131304 L') === 'A' && C.tagOfNodeText('9h 1 C6 A J140555 C6') === 'A');
const nB = C.systemOfNodeText('4h 5 C6 A J100501 C4', []);
const nC = C.systemOfNodeText('7h C3 A J131304 L', []);
check('H6 …and for the class and name', nB.system === 'J100501' && nB.cls === 'C6' && nC.system === 'J131304' && nC.cls === 'C3', JSON.stringify([nB, nC]));

console.log(`chain.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
