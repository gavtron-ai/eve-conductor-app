// HOME DASHBOARD (v0.207.0) — the grid's placement rules, the dashlet catalogue, the chain
// digest and the small per-dashlet digests, pinned with hand-computed expectations. Every system
// name below is made up.
const G = require('./sim/lib/homeGrid.js');
const D = require('./sim/lib/dashlets.js');
const CD = require('./sim/lib/chainDigest.js');
const H = require('./sim/lib/homeDigests.js');
const C = require('./sim/lib/chain.js');
const T = require('./sim/lib/chainTables.js');
const F = require('./sim/lib/favorites.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };
const pos = (items) => items.map((i) => `${i.id}:${i.size}@${i.x},${i.y}`).join(' ');

// ---- G: the grid. 8 columns; S 1×1, M 2×1, L 2×2, XL 4×2
check('G1 the four versions and the grid width', JSON.stringify(G.SIZE_CELLS) === '{"S":{"w":1,"h":1},"M":{"w":2,"h":1},"L":{"w":2,"h":2},"XL":{"w":4,"h":2}}' && G.GRID_COLS === 8);
let it = [];
it = G.addItem(it, 'a', 'L');   // 0,0 (2×2)
it = G.addItem(it, 'b', 'M');   // 2,0 (2×1)
it = G.addItem(it, 'c', 'XL');  // 4,0 (4×2)
it = G.addItem(it, 'd', 'S');   // row 0 is full (2+2+4) → first free is 2,1
it = G.addItem(it, 'e', 'M');   // 3,1? no: 2,1 taken by d; 3,1 is free for w=2 (3,4)? col 4 belongs to XL → no; next row 2: 0,2
check('G2 adding fills the first free spot in reading order', pos(it) === 'd1:L@0,0 d2:M@2,0 d3:XL@4,0 d4:S@2,1 d5:M@0,2', pos(it));
// drop the small one (d4) on the large one's corner: it takes 0,0 and L is pushed under it;
// M at 2,0 stays; d5 (was 0,2) must go under the L: L now 0,1..2 → d5 at 0,3
const mv = G.moveItem(it, 'd4', 0, 0);
check('G3 a drop takes the cell and pushes what was there down — nothing overlaps', pos(mv) === 'd1:L@0,1 d2:M@2,0 d3:XL@4,0 d4:S@0,0 d5:M@0,3', pos(mv));
check('G4 …and no two dashlets ever overlap', mv.every((a) => mv.every((b) => a === b || !G.overlaps(a, b))));
// dropped far below everything, a dashlet floats up to the first row it fits in: d5 (M) dropped at 6,9 →
// columns 6-7 are under the XL (rows 0-1) → lands at 6,2
check('G5 dropped in empty space it floats up (no orphan holes)', pos(G.moveItem(it, 'd5', 6, 9)).endsWith('d5:M@6,2'), pos(G.moveItem(it, 'd5', 6, 9)));
check('G6 a drop past the right edge is pulled back inside the grid', G.moveItem(it, 'd3', 7, 0).find((i) => i.id === 'd3').x === 4);
// make d2 (M at 2,0) wide: XL needs cols 2-5, collides with d3 XL at 4,0 → d2 first at y 0, d3 pushed to y 2; d4 (2,1) is under d2 → pushed to 2,2
const rs = G.resizeItem(it, 'd2', 'XL');
check('G7 another version of a dashlet keeps its corner; what it now covers moves down', pos(rs) === 'd1:L@0,0 d2:XL@2,0 d3:XL@4,2 d4:S@2,2 d5:M@0,2', pos(rs));
const rm = G.removeItem(it, 'd1');
check('G8 removing one lets the rest float up: d5 rises from row 2 to row 0', pos(rm) === 'd2:M@2,0 d3:XL@4,0 d4:S@2,1 d5:M@0,0', pos(rm));
check('G9 the cell under the pointer: 170 px cells, 12 px gaps → (400, 190) is cell 2,1; an XL cannot start right of column 4', JSON.stringify(G.cellAt(400, 190, 170, 12, 'S')) === '{"x":2,"y":1}' && G.cellAt(1400, 0, 170, 12, 'XL').x === 4);
let many = []; for (let i = 0; i < 70; i++) many = G.addItem(many, 'k', 'S');
check('G10 a board holds 60 dashlets (it is a glance, not a report): 60 small ones are seven rows of eight and a row of four', many.length === 60 && G.MAX_ITEMS === 60 && G.rowsUsed(many) === 8 && many.filter((i) => i.y === 7).length === 4);
// the grid always fills the window; how many cells across is the board's own density
const wide = G.setBoardCols({ boards: [{ id: 'b1', name: 'Home', items: it }], active: 'b1' }, 'b1', 12);
check('G11 12 across: nothing has to move (L 0,0 · M 2,0 · XL 4,0 · S 2,1 · M 0,2) and a new small one takes column 8 of the top row', pos(wide.boards[0].items) === pos(it) && wide.boards[0].cols === 12 && pos(G.addItem(wide.boards[0].items, 'n', 'S', undefined, 12)).endsWith('d6:S@8,0'), pos(wide.boards[0].items));
const narrow = G.setBoardCols({ boards: [{ id: 'b1', name: 'Home', items: it }], active: 'b1' }, 'b1', 6);
// 6 across: the XL (4 wide at column 4) must come back to column 2, where the M sits → the M (same row, further left) settles first, the XL goes under it and under the L's right edge: row 1? it overlaps d4 (S at 2,1) → the S (row 1) settles before the XL (row 0 is taken) …
check('G12 6 across: the wide one is pulled back inside and everything still fits without overlapping, nothing past column 6', narrow.boards[0].cols === 6 && narrow.boards[0].items.every((i) => i.x + G.SIZE_CELLS[i.size].w <= 6) && narrow.boards[0].items.every((a) => narrow.boards[0].items.every((b) => a === b || !G.overlaps(a, b))), pos(narrow.boards[0].items));
// re-pack the five (L 0,0 · M 2,0 · XL 4,0 · S 2,1 · M 0,2) 12 across, in reading order L, M, XL, S, M: L 0,0 · M 2,0 · XL 4,0 · S 8,0 · M 9,0
check('G14 re-pack uses the new width: 12 across the five fit in the top two rows, the small one and the second medium beside the wide one', pos(G.repack(it, 12)) === 'd1:L@0,0 d2:M@2,0 d3:XL@4,0 d4:S@8,0 d5:M@9,0', pos(G.repack(it, 12)));
check('G13 a nonsense column count is refused; a board saved without one is 8 across; the choice survives the disk', G.setBoardCols(G.EMPTY_HOME, 'b1', 7) === G.EMPTY_HOME && G.colsOf({}) === 8 && G.colsOf({ cols: 10 }) === 10 && G.sanitizeHome({ boards: [{ id: 'b1', name: 'Wide', cols: 12, items: [] }, { id: 'b2', name: 'Odd', cols: 9, items: [] }] }, D.sizesOf).boards.map((b) => b.cols ?? 8).join(',') === '12,8');

// boards
let hs = G.EMPTY_HOME;
hs = G.addBoard(hs, '  Mining   day  ');
check('B1 a new board is opened, named (trimmed) and active', hs.boards.length === 2 && hs.boards[1].name === 'Mining day' && hs.active === 'b2');
hs = G.withItems(hs, 'b2', G.addItem([], 'chain-ore', 'M', { rock: 'Gneiss' }));
check('B2 items go to the named board only; options ride along', G.activeBoard(hs).items[0].cfg.rock === 'Gneiss' && hs.boards[0].items.length === 0);
check('B3 removing the active board falls back to the first; the last board is emptied, never removed', G.removeBoard(hs, 'b2').active === 'b1' && G.removeBoard(G.removeBoard(hs, 'b2'), 'b1').boards.length === 1);
let eight = G.EMPTY_HOME; for (let i = 0; i < 12; i++) eight = G.addBoard(eight, '');
check('B4 eight boards at most; an unnamed one is "Board n"', eight.boards.length === 8 && eight.boards[7].name === 'Board 8');
const dirty = { active: 'zz', boards: [{ id: 'b1', name: '', items: [
  { id: 'd1', kind: 'chain-isk', size: 'XL', x: 0, y: 0 },        // XL is not a version of chain-isk → its first size (S)
  { id: 'd1', kind: 'eve-clock', size: 'S', x: 0, y: 0 },          // same id and same cell → renumbered, pushed DOWN (0,1); the M after it to 0,2
  { id: 'd9', kind: 'no-such-dashlet', size: 'S', x: 3, y: 0 },    // dropped
  { kind: 'net-worth', size: 'M', x: 'q', y: null, cfg: { range: '30', junk: 5 } }, null] }, 'junk'] };
const clean = G.sanitizeHome(dirty, D.sizesOf);
check('S1 from disk: unknown dashlets and junk dropped, an impossible size falls to the smallest, ids made unique, overlaps settled', pos(clean.boards[0].items) === 'd1:S@0,0 d2:S@0,1 d3:M@0,2' && clean.active === 'b1' && clean.boards[0].name === 'Board 1' && JSON.stringify(clean.boards[0].items[2].cfg) === '{"range":"30"}', pos(clean.boards[0].items));
check('S2 nothing stored → one empty board called Home', G.sanitizeHome(undefined, D.sizesOf).boards[0].name === 'Home');

// ---- D: the catalogue
check('D1 every dashlet: unique id, a shelf that exists, at least one version, smallest first', new Set(D.DASHLETS.map((d) => d.id)).size === D.DASHLETS.length
  && D.DASHLETS.every((d) => D.CATEGORIES.some((c) => c.id === d.category) && d.sizes.length > 0 && d.sizes.every((s, i) => i === 0 || G.SIZE_ORDER.indexOf(s) > G.SIZE_ORDER.indexOf(d.sizes[i - 1]))));
check('D2 every shelf has something on it, and every title bar leads to a real tab (or nowhere, on purpose)', D.CATEGORIES.every((c) => D.byCategory(c.id).length > 0) && D.DASHLETS.every((d) => d.dest === '' || !!F.destOf(d.dest)), D.DASHLETS.filter((d) => d.dest && !F.destOf(d.dest)).map((d) => d.id).join(','));
const ore = D.dashletOf('chain-ore');
check('D3 an option falls back to its default when the stored value is not a choice', D.optionOf(ore, { rock: 'Kernite' }, 'rock') === 'Kernite' && D.optionOf(ore, { rock: 'Cheese' }, 'rock') === 'Gneiss' && D.optionOf(ore, undefined, 'rock') === 'Gneiss');
check('D4 the title carries the option that names it', D.dashTitle(ore, { rock: 'Kernite' }) === 'Kernite finder' && D.dashTitle(D.dashletOf('net-worth'), { range: '30' }) === 'Trading value · 30 days' && D.dashTitle(D.dashletOf('eve-clock')) === 'EVE time');
// every rock on offer must be a family the app's own ore tables can produce, or the option is dead
const fams = new Set();
for (const tbl of [T.ORE_SITES, T.KSPACE_ORE]) for (const specs of Object.values(tbl)) for (const r of specs) fams.add(C.rockFamily(r.ore));
const dead = ore.options[0].choices.map((c) => c.v).filter((r) => !fams.has(r));
check('D5 every ore on offer exists in the ore tables', dead.length === 0, 'not in tables: ' + dead.join(', '));

// ---- C: the chain digest. Home "Florida" (C4). Off home: J111111 (C3, letter A) → J333333 (C2) beyond it;
// J222222 (C5, letter B); Jita (HS). J444444 is on the map with no link.
const parsed = {
  sigs: [
    { sig: 'AAA-111', group: 'Ore', system: 'J111111', cls: 'C3', name: 'Test Deposit', ageH: 1 },                 // 1000×100 + 500×200 + 2000×50 = 300,000
    { sig: 'AAA-112', group: 'Data', system: 'J333333', cls: 'C2', name: 'Unsecured Frontier Database', ageH: 2 },   // 88,400,000
    { sig: 'AAA-113', group: 'Ore', system: 'J333333', cls: 'C2', name: 'Small Deposit', ageH: 2 },                 // 300×100 = 30,000
    { sig: 'AAA-114', group: 'Relic', system: 'J222222', cls: 'C5', name: 'Forgotten Core Data Field', ageH: 3 },    // 279,000,000
    { sig: 'AAA-115', group: 'Gas', system: 'Florida', cls: 'C4', name: 'No Such Reservoir', ageH: 1 },             // not in any table → unvalued
    { sig: 'AAA-116', group: 'Data', system: 'J444444', cls: 'C3', name: 'Unsecured Frontier Receiver', ageH: 9 },   // 75,100,000, not linked
    { sig: 'AAA-117', group: 'Wormhole', system: 'Florida', cls: 'C4', name: '', ageH: 1 },                         // never counted
  ],
  edges: [['Florida', 'J111111'], ['J111111', 'J333333'], ['Florida', 'J222222'], ['Florida', 'Jita']],
  systems: new Set(['Florida', 'J111111', 'J222222', 'J333333', 'J444444', 'Jita']),
  clsOf: new Map([['Florida', 'C4'], ['J111111', 'C3'], ['J222222', 'C5'], ['J333333', 'C2'], ['J444444', 'C3'], ['Jita', 'HS']]),
  tagOf: new Map([['J111111', 'A'], ['J222222', 'B']]),
  effectOf: new Map(),
  source: 'map feed · 6 systems known',
};
const tables = { gas: {}, ore: { 'Test Deposit': [{ ore: 'Gneiss', units: 1000 }, { ore: 'Prismatic Gneiss', units: 500 }, { ore: 'Kernite', units: 2000 }], 'Small Deposit': [{ ore: 'Gneiss', units: 300 }] } };
const price = (n) => ({ Gneiss: 100, 'Prismatic Gneiss': 200, Kernite: 50 }[n] ?? null);
const dg = CD.digestChain(parsed, 'Florida', 1_700_000_000_000, price, tables);
check('C1 ISK on field = the tab\'s unfiltered total: 300,000 + 30,000 + 88.4m + 75.1m + 279m = 442,830,000; 6 sites, 1 unvalued', dg.totalIsk === 442_830_000 && dg.sites === 6 && dg.unvalued === 1, `${dg.totalIsk} ${dg.sites} ${dg.unvalued}`);
check('C2 by activity: Ore 330,000 in 2 · Data 163.5m in 2 · Relic 279m in 1 · Gas nothing valued in 1 · Combat none', dg.byGroup.Ore.isk === 330_000 && dg.byGroup.Ore.count === 2 && dg.byGroup.Data.isk === 163_500_000 && dg.byGroup.Relic.isk === 279_000_000 && dg.byGroup.Gas.count === 1 && dg.byGroup.Gas.unvalued === 1 && dg.byGroup.Combat.count === 0);
check('C3 the richest sites, richest first — the unlinked one is there with no distance; the unvalued one is not', dg.top.map((s) => `${s.system}/${s.hops}`).join(' ') === 'J222222/1 J333333/2 J444444/null J111111/1 J333333/2' && dg.top[0].tag === 'B');
const gn = dg.rocks.find((r) => r.family === 'Gneiss'), ke = dg.rocks.find((r) => r.family === 'Kernite');
check('C4 Gneiss (any grade): 2 sites, 1,000 + 500 + 300 = 1,800 units, valued ON GNEISS ALONE = 100,000 + 100,000 + 30,000 = 230,000; nearest first', gn.sites === 2 && gn.units === 1800 && gn.isk === 230_000 && gn.where.map((w) => `${w.system}/${w.hops}/${w.isk}`).join(' ') === 'J111111/1/200000 J333333/2/30000', JSON.stringify(gn));
check('C5 Kernite: 1 site, 2,000 units, 100,000 — and no third rock', ke.sites === 1 && ke.units === 2000 && ke.isk === 100_000 && dg.rocks.length === 2);
check('C6 the ways out of home, A→Z: J111111 (C3A) 2 systems · 3 sites · 88,730,000 — J222222 (C5B) 1 · 1 · 279m — Jita (HS) 1 · 0 · 0; home\'s own gas is down no way',
  dg.ways.map((w) => `${w.first}|${CD.wayChip(w)}|${w.systems}|${w.sites}|${w.isk}`).join(' ') === 'J111111|C3A|2|3|88730000 J222222|C5B|1|1|279000000 Jita|HS|1|0|0' && dg.ways[0].byGroup.Ore === 330_000 && dg.ways[0].byGroup.Data === 88_400_000, dg.ways.map((w) => `${w.first}|${CD.wayChip(w)}|${w.systems}|${w.sites}|${w.isk}`).join(' '));
const lost = CD.digestChain(parsed, 'Nowhere', 1, price, tables);
check('C7 an origin that is not on the reading: totals still stand, but no distances and no ways are claimed', lost.originOk === false && lost.totalIsk === 442_830_000 && lost.ways.length === 0 && lost.top.every((s) => s.hops === null));
check('C8 a digest survives the disk as plain JSON; another shape is refused', CD.sanitizeDigest(JSON.parse(JSON.stringify(dg))).totalIsk === 442_830_000 && CD.sanitizeDigest({ v: 2 }) === null && CD.sanitizeDigest(null) === null);

// ---- W: trading value. total = stock + transit + listed + escrow + wallets
const DAY = 86_400_000, now = 100 * DAY;
const pt = (t, wallets) => ({ t, stock: 1000, transit: 0, listed: 500, escrow: 250, wallets });
const series = [pt(now - 10 * DAY, 1000), pt(now - 8 * DAY, 2000), pt(now - 3 * DAY, 3000), pt(now - 1 * DAY - 1000, 4250), pt(now - 3600_000, 5250)];
const w7 = H.worthDigest(series, now, 7);
check('W1 7 days: measured from the last point AT OR BEFORE the start (the −8 d one, 3,750) to the latest (7,000): +3,250 = +86.67%', w7.total === 7000 && w7.delta === 3250 && w7.deltaWallets === 3250 && w7.deltaGoods === 0 && Math.abs(w7.deltaPct - 3250 / 3750) < 1e-12 && w7.baseAt === now - 8 * DAY && w7.covers === true && w7.spark.length === 4);
const w1 = H.worthDigest(series, now, 1);
check('W2 24 h: baseline is the point just over a day old (6,000): +1,000', w1.delta === 1000 && w1.baseAt === now - DAY - 1000);
const w30 = H.worthDigest(series, now, 30);
check('W3 30 days asked, 10 recorded: measured from the first point and SAYS it does not cover the range', w30.delta === 7000 - 2750 && w30.covers === false && w30.baseAt === now - 10 * DAY);
check('W4 one point: a value, no change claimed; no points: nothing', H.worthDigest([pt(now, 5)], now, 7).delta === null && H.worthDigest([], now, 7) === null);
const long = []; for (let i = 0; i < 500; i++) long.push(pt(now - (500 - i) * 60_000, i));
check('W5 the sparkline is thinned to at most 61 points and always ends on the latest', H.worthDigest(long, now, 1).spark.length <= 61 && H.worthDigest(long, now, 1).spark.at(-1).v === 1750 + 499);

// ---- O: orders
const od = H.ordersDigest({ 34: [{ price: 10, remain: 100, bestOther: 9.5 }, { price: 10, remain: 50, bestOther: null }], 35: [{ price: 5, remain: 10, bestOther: 6 }] }, { 36: [{ price: 4, remain: 1000, bestOther: 4.1 }, { price: 4, remain: 10, bestOther: 3 }] });
check('O1 three sells worth 1,000 + 500 + 50 = 1,550, ONE undercut (a rival at 9.5 under my 10; alone or beaten-by-me do not count); two buys worth 4,040, ONE outbid', od.sells === 3 && od.undercut === 1 && od.sellValue === 1550 && od.buys === 2 && od.outbid === 1 && od.buyValue === 4040);

// ---- P: planets
const pl = (planetName, problem, rank, fullFrac, fullAt, value) => ({ characterName: 'Pilot', planetName, systemName: 'J123456', problem, rank, fullFrac, fullAt, extractorExpiry: null, advice: '', value });
const pd = H.piDigest([pl('I', 'ok', 5, 0.2, now + 5 * DAY, 10), pl('II', 'storage-full', 0, 1, null, 20), pl('III', 'extractor-expiring', 2, 0.5, now + 2 * DAY, 30), pl('IV', 'ok', 5, 0.6, now - DAY, 40)], now);
check('P1 four planets, two need attention, one is urgent, 100 ISK stored; worst first, fuller first among equals; the next fill is the soonest FUTURE one', pd.total === 4 && pd.attention === 2 && pd.urgent === 1 && pd.value === 100 && pd.worst.map((p) => p.planetName).join(',') === 'II,III,IV,I' && pd.nextFullAt === now + 2 * DAY);

// ---- R: raid windows + the robbery log
const place = (id) => ({ systemName: 'S' + id, regionName: 'R', jumps: id === 3 ? null : id });
const wins = [{ planetId: 1, systemId: 5, startMs: now - 600_000, endMs: now + 1_800_000 }, { planetId: 2, systemId: 2, startMs: now - 60_000, endMs: now + 600_000 },
  { planetId: 3, systemId: 3, startMs: now - 1, endMs: now + 5 }, { planetId: 4, systemId: 4, startMs: now + 1_200_000, endMs: now + 9_000_000 },
  { planetId: 5, systemId: 1, startMs: now + 2 * 3_600_000, endMs: now + 3 * 3_600_000 }, { planetId: 6, systemId: 6, startMs: now - 9_000_000, endMs: now - 1 }];
const wd = H.windowsDigest(wins, now, place, true);
check('R1 open windows closing soonest first (planet 2 in 10 min, then 1 in 30); opening within the hour (planet 4 in 20 min); out of reach and already closed left out', wd.open.map((r) => r.planetId).join(',') === '2,1' && wd.soon.map((r) => r.planetId).join(',') === '4' && wd.open[0].inMs === 600_000 && wd.listed === 5 && wd.inReach === 4);
check('R2 with no reach set nothing is left out for distance', H.windowsDigest(wins, now, place, false).open.length === 3);
const rl = H.raidLogDigest([{ t: now - 3_600_000, systemId: 1, planetId: 1, kind: 'raided' }, { t: now - 2 * DAY, systemId: 2, planetId: 2, kind: 'raided' }, { t: now - 100, systemId: 3, planetId: 3, kind: 'survived' }, { t: now - 9 * DAY, systemId: 4, planetId: 4, kind: 'raided' }], now);
check('R3 only "raided" verdicts count: 1 in a day, 2 in a week, newest first; watching since the oldest event of any kind', rl.day === 1 && rl.week === 2 && rl.recent.map((e) => e.systemId).join(',') === '1,2,4' && rl.watchedSince === now - 9 * DAY);

// ---- L: pilots, the clock, the wording
const pr = H.pilotsDigest([{ t: 5, characterId: 1, shipTypeId: 10, shipName: '', systemId: 100 }, { t: 9, characterId: 1, shipTypeId: 11, shipName: '', systemId: 101 }, { t: 7, characterId: 2, shipTypeId: 12, shipName: '', systemId: 102 }], [{ characterId: 2, name: 'B' }, { characterId: 1, name: 'A' }, { characterId: 3, name: 'C' }]);
check('L1 the LAST transition per character, most recently seen first; a character never seen is listed with nothing', pr.map((p) => `${p.name}:${p.last ? p.last.shipTypeId : '-'}`).join(' ') === 'A:11 B:12 C:-');
const ck = H.eveClock(Date.UTC(2026, 8, 20, 9, 30, 0));
check('L2 09:30 EVE → downtime in 1 h 30; at 11:05 the server is in its downtime window and the next is 23 h 55 away', ck.hhmm === '09:30' && ck.toDowntimeMs === 5_400_000 && ck.date === '2026-09-20' && !ck.inDowntimeWindow && H.eveClock(Date.UTC(2026, 8, 20, 11, 5, 0)).inDowntimeWindow && H.eveClock(Date.UTC(2026, 8, 20, 11, 5, 0)).toDowntimeMs === 86_100_000);
check('L3 wording: ages and countdowns', H.agoShort(30_000) === 'just now' && H.agoShort(59 * 60_000) === '59 min ago' && H.agoShort(3 * 3_600_000) === '3 h ago' && H.agoShort(3 * DAY) === '3 d ago' && H.inShort(0) === 'now' && H.inShort(61_000) === '2 min' && H.inShort(5_400_000) === '1 h 30 min');

console.log(`home.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
