// HAULS (v0.201) — the paste parser, the file guard and the averages.
const H = require('./sim/lib/hauls.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };
const DAY = 86_400_000;
const T0 = Date.parse('2026-09-15T00:00:00Z');

// the in-game inventory copy (Name<TAB>Quantity<TAB>Group<TAB>Category<TAB>Size<TAB>Volume<TAB>Est. price)
const PASTE = [
  'Name\tQuantity\tGroup\tCategory\tSize\tVolume\tEst. Price',
  'Intact Armor Plates\t2\tSalvaged Materials\tMaterial\t\t0.02 m3\t1,234,567.89 ISK',
  'Ancient Coordinates Database\t3\tAncient Salvage\tMaterial\t\t0.03 m3\t',
  'Intact Armor Plates\t1\tSalvaged Materials\tMaterial\t\t0.01 m3\t',
  '',
  'Sleeper Data Library x 12',
  '4 x Neural Network Analyzer',
  'Lone Tag',
].join('\n');
const items = H.parseLootPaste(PASTE);
const q = (n) => items.find((i) => i.name === n)?.qty;
check('P1 header skipped, tab rows read, repeats merged (2 + 1 plates)', q('Intact Armor Plates') === 3 && q('Ancient Coordinates Database') === 3, JSON.stringify(items));
check('P2 "x 12" and "4 x" forms, a bare name = 1', q('Sleeper Data Library') === 12 && q('Neural Network Analyzer') === 4 && q('Lone Tag') === 1, JSON.stringify(items));
check('P3 five distinct items, nothing from the header or the blank line', items.length === 5 && !items.some((i) => /^name$/i.test(i.name)));
check('P4 thousands separators in a quantity', H.parseLootPaste('Veldspar\t12,345\tOre')[0].qty === 12345);

// the file guard
const f = H.parseHaulsFile({ v: 1, hauls: [
  { id: 'a', at: T0, site: 'Ruined Sansha Temple Site', group: 'Relic', cls: 'C2', system: 'J1', isk: 20_000_000 },
  { id: 'b', at: T0 + DAY, site: 'Ruined Sansha Temple Site', group: 'Relic', cls: 'C2', system: 'J1', isk: 40_000_000.4 },
  { id: 'c', at: T0, site: 'Ruined Guristas Crystal Quarry', group: 'Relic', cls: 'LS', system: 'K', isk: 60_000_000 },
  { id: 'd', at: T0, site: 'Central Sansha Data Mining Site', group: 'Data', cls: 'C1', system: 'J2', isk: 5_000_000 },
  { site: 'no isk' }, { isk: -5, site: 'negative' }, 'junk', null,
] });
check('F1 four well-formed hauls kept, junk dropped, ISK rounded', f.hauls.length === 4 && f.hauls[1].isk === 40_000_000, JSON.stringify(f.hauls.map((h) => h.isk)));
check('F2 a bare array is accepted too', H.parseHaulsFile([{ site: 'X', isk: 1 }]).hauls.length === 1);

// averages
const s = H.haulStats(f.hauls);
const temple = s.lookup('Ruined Sansha Temple Site', 'Relic');
check('A1 a site with two hauls → their mean (30M), count 2, last = the later date, not a tier borrow', temple && temple.mean === 30_000_000 && temple.n === 2 && temple.last === T0 + DAY && temple.tier === false, JSON.stringify(temple));
const borrowed = s.lookup('Ruined Blood Raider Crystal Quarry', 'Relic');
check('A2 a Ruined relic never run borrows the Ruined tier across factions: (20+40+60)/3 = 40M over 3', borrowed && borrowed.tier === true && borrowed.mean === 40_000_000 && borrowed.n === 3, JSON.stringify(borrowed));
check('A3 a Data tier does not borrow from Relic hauls', s.lookup('Local Guristas Mainframe', 'Data') === null && s.lookup('Central Serpentis Sparking Transmitter', 'Data').mean === 5_000_000);
check('A4 a site with no tier word and no hauls → null', s.lookup('Something Odd', 'Relic') === null);
check('A5 tier words: Crumbling/Decayed/Ruined, Local/Regional/Central, Forgotten/Unsecured; else empty', H.tierOf('Decayed Angel Mass Grave') === 'Decayed' && H.tierOf('Regional Serpentis Data Fortress') === 'Regional' && H.tierOf('Forgotten Perimeter Gateway') === 'Forgotten' && H.tierOf('Guristas Hidden Hub') === '');
check('A6 basis text names the count, the tier borrow and the date', /your average of 2 hauls · last 2026-09-16/.test(H.haulBasis(temple, 'Ruined Sansha Temple Site')) && /3 hauls in Ruined sites/.test(H.haulBasis(borrowed, 'Ruined Blood Raider Crystal Quarry')));

console.log(`hauls.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
