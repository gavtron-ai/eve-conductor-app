// THE SECOND SHELF-LOAD OF HOME DIGESTS (v0.209.0) — the wider chain digest, trade, planets,
// theft, hauls, logins and the corp's killmail glances, each pinned by hand. Every name and id is
// made up.
const CD = require('./sim/lib/chainDigest.js');
const S = require('./sim/lib/homeStats.js');
const K = require('./sim/lib/corpStats.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };
const DAY = 86_400_000, H = 3_600_000, M = 1_000_000;
const now = Date.UTC(2026, 8, 20, 12, 0, 0);

// ---- C: the chain. Home "Florida" (C4) → J111111 (C3A) → J333333 (C2); → J222222 (C5B, a Pulsar); → Jita (HS). J444444 unlinked.
const parsed = {
  sigs: [
    { sig: 'A-1', group: 'Ore', system: 'J111111', cls: 'C3', name: 'Test Deposit', ageH: 1 },                // 300,000
    { sig: 'A-2', group: 'Data', system: 'J333333', cls: 'C2', name: 'Unsecured Frontier Database', ageH: 2 },  // 88,400,000
    { sig: 'A-3', group: 'Ore', system: 'J333333', cls: 'C2', name: 'Small Deposit', ageH: 2 },                // 30,000
    { sig: 'A-4', group: 'Relic', system: 'J222222', cls: 'C5', name: 'Forgotten Core Data Field', ageH: 3 },   // 279,000,000
    { sig: 'A-5', group: 'Gas', system: 'Florida', cls: 'C4', name: 'No Such Reservoir', ageH: 1 },            // unvalued
    { sig: 'A-6', group: 'Data', system: 'J444444', cls: 'C3', name: 'Unsecured Frontier Receiver', ageH: 9 },  // 75,100,000, unlinked
    { sig: 'A-7', group: 'Wormhole', system: 'Florida', cls: 'C4', name: '', ageH: 1 },
    { sig: 'A-8', group: 'Gas', system: 'J222222', cls: 'C5', name: 'Test Reservoir', ageH: 30 },              // 100 × 1,000 + 1,000 × 10 = 110,000
    { sig: 'A-9', group: 'Combat', system: 'J111111', cls: 'C3', name: '', ageH: null },                       // nobody scanned it: unvalued, unscanned, no age
  ],
  edges: [['Florida', 'J111111'], ['J111111', 'J333333'], ['Florida', 'J222222'], ['Florida', 'Jita']],
  systems: new Set(['Florida', 'J111111', 'J222222', 'J333333', 'J444444', 'Jita']),
  clsOf: new Map([['Florida', 'C4'], ['J111111', 'C3'], ['J222222', 'C5'], ['J333333', 'C2'], ['J444444', 'C3'], ['Jita', 'HS']]),
  tagOf: new Map([['J111111', 'A'], ['J222222', 'B']]),
  effectOf: new Map([['J222222', 'Pulsar']]),
  source: 'map feed',
};
const tables = { gas: { 'Test Reservoir': [{ gas: 'Fullerite-C320', units: 100 }, { gas: 'Fullerite-C50', units: 1000 }] }, ore: { 'Test Deposit': [{ ore: 'Gneiss', units: 1000 }, { ore: 'Prismatic Gneiss', units: 500 }, { ore: 'Kernite', units: 2000 }], 'Small Deposit': [{ ore: 'Gneiss', units: 300 }] } };
const price = (n) => ({ Gneiss: 100, 'Prismatic Gneiss': 200, Kernite: 50, 'Fullerite-C320': 1000, 'Fullerite-C50': 10 }[n] ?? null);
const d = CD.digestChain(parsed, 'Florida', now, price, tables);
check('C1 the totals carry the new sites: 442,830,000 + 110,000 of gas = 442,940,000; 8 sites, 2 of them unvalued', d.totalIsk === 442_940_000 && d.sites === 8 && d.unvalued === 2 && d.v === 2, `${d.totalIsk} ${d.sites} ${d.unvalued}`);
const c50 = d.gases.find((g) => g.family === 'C50'), c320 = d.gases.find((g) => g.family === 'C320');
check('C2 gas, cloud by cloud: C320 100 units = 100,000 · C50 1,000 units = 10,000 — each valued on that gas alone, C50 listed before C320', d.gases.map((g) => g.family).join(',') === 'C50,C320' && c320.units === 100 && c320.isk === 100_000 && c320.where[0].isk === 100_000 && c320.where[0].hops === 1 && c50.isk === 10_000 && c50.sites === 1);
check('C3 ISK by distance: at home 1 site worth nothing yet · 1 jump 4 sites 279,410,000 · 2 jumps 2 sites 88,430,000 · unlinked 1 site 75,100,000',
  d.byHop.map((h) => `${h.hops}:${h.sites}:${h.isk}`).join(' ') === '0:1:0 1:4:279410000 2:2:88430000 null:1:75100000', d.byHop.map((h) => `${h.hops}:${h.sites}:${h.isk}`).join(' '));
check('C4 within one jump of home: 5 sites, 279,410,000 — the unlinked system is never "within" anything', JSON.stringify(CD.withinHops(d, 1)) === '{"isk":279410000,"sites":5}' && CD.withinHops(d, 9).sites === 7);
check('C5 nearest per activity: Data → J333333 (2 jumps) then the unlinked J444444; Ore → J111111 then J333333', d.nearest.Data.map((s) => s.system).join(',') === 'J333333,J444444' && d.nearest.Ore.map((s) => s.system).join(',') === 'J111111,J333333' && d.nearest.Combat[0].isk === null);
check('C6 the ways to known space: Jita (HS), 1 jump; the one effect on the chain: J222222 C5B, a Pulsar, 1 jump', JSON.stringify(d.exits) === '[{"system":"Jita","cls":"HS","hops":1}]' && JSON.stringify(d.effects) === '[{"system":"J222222","cls":"C5","tag":"B","effect":"Pulsar","hops":1}]');
check('C7 map freshness: 5 signatures under 3 h, 2 between 3 and 12, none 12–24, 1 over a day; 1 with no age; 1 not scanned down (the wormhole does not count)', d.ages.map((a) => a.count).join(',') === '5,2,0,1' && d.noAge === 1 && d.unscanned === 1, d.ages.map((a) => a.count).join(','));
check('C8 systems per class, ladder order: C2 1 · C3 2 · C4 1 · C5 1 · HS 1', d.classes.map((c) => `${c.cls}${c.systems}`).join(' ') === 'C21 C32 C41 C51 HS1');
check('C9 a v1 digest left on disk by 0.207 is refused rather than half-read', CD.sanitizeDigest({ v: 1, at: 1, top: [], rocks: [], ways: [], totalIsk: 1 }) === null && CD.sanitizeDigest(JSON.parse(JSON.stringify(d))).gases.length === 2);

// ---- T: trade
const pt = (t, stock, transit, listed, escrow, wallets) => ({ t, stock, transit, listed, escrow, wallets });
const ly = S.layersDigest([pt(now - DAY, 1, 1, 1, 1, 1), pt(now, 1000, 0, 500, 250, 250)]);
check('T1 where the ISK sits, from the LATEST snapshot: 2,000 = stock 50% · transit 0 · sell orders 25% · escrow 12.5% · wallets 12.5%', ly.total === 2000 && ly.at === now && ly.rows.map((r) => r.frac).join(',') === '0.5,0,0.25,0.125,0.125' && S.layersDigest([]) === null);
const sales = [
  { date: Date.UTC(2026, 8, 20, 1), typeId: 34, qty: 10, revenue: 1000, profit: 200, costBasis: 700 },
  { date: Date.UTC(2026, 8, 19, 23, 59), typeId: 34, qty: 5, revenue: 600, profit: null, costBasis: null },   // loot: revenue, no profit claimed
  { date: Date.UTC(2026, 8, 17, 10), typeId: 35, qty: 1, revenue: 500, profit: -50, costBasis: 520 },
  { date: Date.UTC(2026, 8, 17, 11), typeId: 36, qty: 2, revenue: 300, profit: 100, costBasis: 180 },
];
const bs = S.bestSellers(sales);
check('T2 best sellers by REALIZED profit: item 34 +200 on 1,600 revenue in 2 sales (the loot sale adds revenue, no profit), then 36 +100, then 35 −50 — the worst', bs.rows.map((r) => `${r.typeId}:${r.profit}:${r.revenue}:${r.sales}`).join(' ') === '34:200:1600:2 36:100:300:1 35:-50:500:1' && bs.worst.typeId === 35 && bs.items === 3);
const pd = S.profitByDay(sales, now, 3);
check('T3 three EVE days, oldest first, empty days kept: 18th nothing · 19th 600 revenue, no profit · 20th +200 on 1,000; the 17th is outside', pd.bars.map((b) => `${b.day.slice(8)}:${b.profit}:${b.revenue}:${b.sales}`).join(' ') === '18:0:0:0 19:0:600:1 20:200:1000:1' && pd.profit === 200 && pd.revenue === 1600 && pd.best.day === '2026-09-20');
const inv = S.inventoryDigest([{ typeId: 34, qty: 10, unitCost: 5, date: 100 }, { typeId: 34, qty: 5, unitCost: 8, date: 50 }, { typeId: 35, qty: 0, unitCost: 99, date: 1 }, { typeId: 36, qty: 2, unitCost: 100, date: 70 }]);
check('T4 unsold stock at cost: 10×5 + 5×8 = 90 of item 34, 2×100 = 200 of item 36 → 290 in 3 lots of 2 items; the sold-out lot is gone; oldest lot dated 50', inv.atCost === 290 && inv.lots === 3 && inv.items === 2 && inv.oldestAt === 50 && inv.top.map((r) => `${r.typeId}:${r.cost}`).join(' ') === '36:200 34:90');
const ev = S.eventsDigest([
  { t: now - H, kind: 'outbid_sell', typeId: 1 }, { t: now - 2 * H, kind: 'outbid_sell', typeId: 2 }, { t: now - 3 * H, kind: 'outbid_buy', typeId: 3 },
  { t: now - 4 * H, kind: 'sale', typeId: 1, isk: 100 }, { t: now - 5 * H, kind: 'sale', typeId: 1, isk: 250 }, { t: now - 6 * H, kind: 'rival_reprice', typeId: 2 },
  { t: now - 7 * H, kind: 'mkt_hour', typeId: 2 }, { t: now - 25 * H, kind: 'outbid_sell', typeId: 9 }], now);
check('T5 the market in 24 h: 2 sells undercut, 1 buy outbid, 2 sales for 350, 1 rival move; the hourly market line and yesterday\'s event are not part of it; newest first', ev.outbidSell === 2 && ev.outbidBuy === 1 && ev.sales === 2 && ev.salesIsk === 350 && ev.rivalMoves === 1 && ev.recent.length === 6 && ev.recent[0].t === now - H);

// ---- P: planets
check('P1 the PI tab\'s own bands: ranks 0 and 2 need you NOW · 3 and 5 soon · 6 and 7 are tuning · 9 is fine', JSON.stringify(S.piBands([0, 2, 3, 5, 6, 7, 9, 9].map((rank) => ({ rank })))) === '{"total":8,"now":2,"soon":2,"tune":2,"ok":2}');
const pl = (planetName, characterName, rank, value, fullFrac, heads, expired, at, contents = []) => ({ planetName, characterName, rank, value, fullFrac, hoursToFull: null, extractorCount: heads, expiredExtractors: expired, extractorExpiry: at, contents });
const planets = [
  pl('I', 'Pilot A', 0, 1500, 0.9, 2, 1, now - H, [{ typeId: 1, name: 'Water', amount: 100, value: 1000 }, { typeId: 2, name: 'Bacteria', amount: 10, value: 500 }]),
  pl('II', 'Pilot A', 9, 500, 0.2, 1, 0, now + 5 * H, [{ typeId: 1, name: 'Water', amount: 50, value: 500 }]),
  pl('III', 'Pilot B', 9, 100, 0.1, 1, 0, now + 30 * H), pl('IV', 'Pilot B', 9, 0, 0, 0, 0, null)];
const rs = S.extractorResets(planets, now);
check('P2 resets: the planet with a dead head first, then the soonest program end; the factory planet is not listed; 1 dead, 1 ending within a day', rs.rows.map((r) => r.planetName).join(',') === 'I,II,III' && rs.expired === 1 && rs.within24h === 1);
const pp = S.piProducts(planets);
check('P3 what is on the ground: Water 150 units worth 1,500, Bacteria 10 worth 500 → 2,000 in 2 kinds', pp.rows.map((r) => `${r.name}:${r.amount}:${r.value}`).join(' ') === 'Water:150:1500 Bacteria:10:500' && pp.value === 2000 && pp.kinds === 2);
check('P4 by pilot: A has 2 planets, 1 needing him now, 2,000 stored, fullest 90%; B 2 planets, none, 100', JSON.stringify(S.piByPilot(planets)) === JSON.stringify([{ characterName: 'Pilot A', planets: 2, now: 1, value: 2000, fullest: 0.9 }, { characterName: 'Pilot B', planets: 2, now: 0, value: 100, fullest: 0.1 }]));

// ---- R: robberies
const raids = [
  { t: now - H, systemId: 1, kind: 'raided', intoWindowMin: 10 }, { t: now - 2 * DAY, systemId: 1, kind: 'raided', intoWindowMin: 30 }, { t: now - 9 * DAY, systemId: 1, kind: 'raided', intoWindowMin: 99 },
  { t: now - 3 * H, systemId: 2, kind: 'raided', intoWindowMin: 20 }, { t: now - 4 * H, systemId: 2, kind: 'raided' },
  { t: now - 5 * H, systemId: 3, kind: 'survived' }, { t: now - 6 * H, systemId: 3, kind: 'survived' }, { t: now - 7 * H, systemId: 4, kind: 'survived' }, { t: now - 8 * H, systemId: 4, kind: 'survived' },
  { t: now - 9 * H, systemId: 5, kind: 'unknown' }, { t: now - 10 * H, systemId: 5, kind: 'mine' }];
const hot = S.raidHot(raids, now, 7);
check('R1 most robbed in 7 days: systems 1 and 2 with two each (the 9-day-old one is outside) — the more recent first', hot.rows.map((r) => `${r.systemId}:${r.raided}`).join(' ') === '1:2 2:2' && hot.systems === 2 && hot.rows[0].lastAt === now - H);
const oc = S.raidOutcomes(raids, now, 7);
check('R2 of the windows the watcher could call: 4 robbed, 4 survived → 50%; the unknown close and my own mark are in neither; median 20 min into the window (of 10, 20, 30)', oc.raided === 4 && oc.survived === 4 && oc.unknown === 1 && oc.rate === 0.5 && oc.medianIntoMin === 20);
const hrs = S.byEveHour([Date.UTC(2026, 8, 1, 3, 5), Date.UTC(2026, 8, 2, 3, 50), Date.UTC(2026, 8, 3, 15, 0)]);
check('R3 by EVE hour: two at 03, one at 15 → the peak is 03', hrs.hours[3] === 2 && hrs.hours[15] === 1 && hrs.peak === 3 && hrs.total === 3 && S.byEveHour([]).peak === null);

// ---- H: hauls, logins, wallets
const hd = S.haulsDigest([{ at: now - DAY, site: 'Site A', isk: 100 * M, system: 'J123456' }, { at: now - 40 * DAY, site: 'Site A', isk: 300 * M, system: 'J123456' }, { at: now - 2 * DAY, site: 'Site B', isk: 150 * M, system: 'J123456' }], now);
check('H1 my hauls: 3 logged, 550m in all, 250m in the last 30 days (2 hauls); best site by average is A (200m over 2); the last one was A yesterday', hd.count === 3 && hd.total === 550 * M && hd.recent === 250 * M && hd.recentCount === 2 && hd.best.site === 'Site A' && hd.best.mean === 200 * M && hd.last.at === now - DAY);
const chars = [{ characterId: 1, name: 'A', refreshToken: 'x', expiresAt: 0, lastSync: 5, wallet: 5 }, { characterId: 2, name: 'B', refreshToken: null, expiresAt: 0, lastSync: null, wallet: null }, { characterId: 3, name: 'C', refreshToken: 'y', expiresAt: 0, lastSync: 7, wallet: 10 }];
const lg = S.loginsDigest(chars, [3]);
check('H2 logins: B has no session and C was refused on the last read → both need logging in, listed first; A is fine', lg.rows.map((r) => `${r.name}:${r.state}`).join(' ') === 'B:relogin C:relogin A:ok' && lg.relogin === 2);
const wl = S.walletsDigest(chars);
check('H3 wallets: C 10, A 5 → 15; B\'s is unknown and says so rather than counting as 0', wl.rows.map((r) => r.name).join(',') === 'C,A' && wl.total === 15 && wl.unknown === 1);

// ---- K: the corp from its killmails — the leaderboard fixture's ten mails (corp 100; pilots 1, 2, 3)
const MIN = 60_000, T0 = 1_800_000_000_000;
const us = (char, dmg, fb = false, ship = 610) => ({ char, corp: 100, ship, dmg, fb });
const them = (char, dmg = 0, ship = 700) => ({ char, corp: 200, ship, dmg });
const mails = [
  { id: 1, t: T0, value: 100 * M, victim: them(91, 1000, 600), attackers: [us(1, 600, true), us(2, 300, false, 611), { char: 50, corp: 300, ship: 701, dmg: 100 }] },
  { id: 2, t: T0 + MIN, value: 10 * M, victim: them(91, 50, 670), attackers: [us(2, 50, true, 611)] },
  { id: 3, t: T0 + 2 * MIN, value: 40 * M, victim: us(1, 5000, false, 601), attackers: [them(92, 5000)] },
  { id: 4, t: T0 + 3 * MIN, value: 5 * M, victim: us(1, 400, false, 670), attackers: [them(92, 400)] },
  { id: 5, t: T0 + 200 * MIN, value: 200 * M, victim: them(93, 1500, 602), attackers: [us(3, 1000, true, 612), { char: 0, corp: 1000125, ship: 0, dmg: 500 }] },
  { id: 6, t: T0 + 201 * MIN, value: 20 * M, victim: us(2, 1000, false, 603), attackers: [us(3, 100, true, 612), them(94, 900)] },
  { id: 7, t: T0 + 400 * MIN, value: 1000 * M, victim: { char: 0, corp: 200, ship: 35832, dmg: 1000 }, attackers: [us(1, 500), us(2, 500, true, 611)] },
  { id: 7, t: T0 + 400 * MIN, value: 1000 * M, victim: { char: 0, corp: 200, ship: 35832, dmg: 1000 }, attackers: [us(1, 500), us(2, 500, true, 611)] },
  { id: 9, t: T0 + 402 * MIN, value: 300 * M, victim: { char: 0, corp: 100, ship: 35832, dmg: 9000 }, attackers: [them(95, 9000)] },
  { id: 10, t: T0 + 500 * MIN, value: 30 * M, victim: them(96, 300, 604), attackers: [us(1, 100), us(1, 200, true)] },
];
const ct = K.corpTotals(mails, 100, null);
check('K1 the corp: 5 kills for 100 + 10 + 200 + 1,000 + 30 = 1,340m · 3 pilot losses for 40 + 5 + 20 = 65m (the friendly-fire death is a loss, the corp structure is not) · 95.4% · 3 pilots', ct.kills === 5 && ct.destroyed === 1340 * M && ct.losses === 3 && ct.lost === 65 * M && Math.abs(ct.efficiency - 1340 / 1405) < 1e-12 && ct.pilots === 3, JSON.stringify(ct));
check('K2 the biggest kill is the 1b structure (counted once though it came in twice); the biggest loss is pilot 1\'s 40m hull', ct.biggestKill.id === 7 && ct.biggestLoss.id === 3 && ct.biggestLoss.char === 1 && ct.biggestLoss.ship === 601);
const late = K.corpTotals(mails, 100, T0 + 200 * MIN);
check('K3 from the fifth mail on: 3 kills for 1,230m, 1 loss for 20m', late.kills === 3 && late.destroyed === 1230 * M && late.losses === 1 && late.lost === 20 * M);
const feed = K.killFeed(mails, 100, 3);
check('K4 the feed, newest first: kill 10, kill 7 (2 corp pilots on it), loss 6 — the corp structure never shows', feed.map((f) => `${f.kind}${f.id}`).join(' ') === 'kill10 kill7 loss6' && feed[1].pilots === 2 && K.killFeed(mails, 100, 99).length === 8);
const hf = K.hullsFlown(mails, 100, null);
check('K5 what the corp flies, one use per pilot per mail: hull 610 ×3 and 611 ×3, then 601, 603 (each lost once) and 612 — C shooting his corp mate is not a use, a pod is not a hull', hf.rows.map((r) => `${r.ship}:${r.uses}:${r.lost}`).join(' ') === '610:3:0 611:3:0 601:1:1 603:1:1 612:1:0' && hf.hulls === 5, hf.rows.map((r) => `${r.ship}:${r.uses}:${r.lost}`).join(' '));
const en = K.enemies(mails, 100, null);
check('K6 who the corp meets: corporation 200 — 5 kills on them (1,340m), on 3 of our losses (65m); the outsider who shared a kill, the NPC and our own corp are nobody\'s enemy', en.corps === 1 && JSON.stringify(en.rows[0]) === JSON.stringify({ corp: 200, killed: 5, lostTo: 3, destroyed: 1340 * M, lost: 65 * M }));
check('K7 eight kills and losses to place on the clock', K.fightTimes(mails, 100, null).length === 8 && K.fightTimes(mails, 100, T0 + 400 * MIN).length === 2);

// ---- D: the catalogue, tripled
const D = require('./sim/lib/dashlets.js');
const T = require('./sim/lib/chainTables.js');
const G = require('./sim/lib/homeGrid.js');
check('D1 three times the first store: 14 dashlets became at least 42, on ten shelves, none of them empty', D.DASHLETS.length >= 42 && D.CATEGORIES.length === 10 && D.CATEGORIES.every((c) => D.byCategory(c.id).length >= 2), String(D.DASHLETS.length));
const clouds = new Set(); for (const specs of Object.values(T.GAS_SITES)) for (const c of specs) clouds.add(CD.gasShort(c.gas));
check('D2 every gas on offer is a cloud the gas tables carry', D.GASES.every((g) => clouds.has(g)), D.GASES.filter((g) => !clouds.has(g)).join(','));
const BOARD_IDS = require('./sim/lib/leaderboard.js').BOARDS.map((b) => b.id);
check('D3 every board the Board leader dashlet offers is a real leaderboard board', D.dashletOf('lb-board').options[0].choices.every((c) => BOARD_IDS.includes(c.v)) && D.dashletOf('lb-board').options[0].choices.length === BOARD_IDS.length);
check('D4 titles name their option: gas, activity, distance, board and range', D.dashTitle(D.dashletOf('chain-gas'), { gas: 'C540' }) === 'C540 finder' && D.dashTitle(D.dashletOf('chain-activity'), {}) === 'Combat sites' && D.dashTitle(D.dashletOf('chain-near'), { jumps: '3' }) === 'Within 3 jumps' && D.dashTitle(D.dashletOf('lb-board'), { board: 'whale', range: '30' }) === 'Most valuable kill · 30 days' && D.dashTitle(D.dashletOf('corp-totals'), {}) === 'The corp · 7 days');
check('D5 a note is free text: kept as typed, cut at 600 characters, never replaced by a "default choice"', D.optionOf(D.dashletOf('notes'), { text: 'buy nanite paste' }, 'text') === 'buy nanite paste' && D.optionOf(D.dashletOf('notes'), { text: 'x'.repeat(900) }, 'text').length === 600 && D.optionOf(D.dashletOf('notes'), undefined, 'text') === '');
check('D6 a board saved by 0.208 still loads: its dashlet ids and sizes all still exist', G.sanitizeHome({ boards: [{ id: 'b1', name: 'Home', items: ['chain-isk:L', 'chain-ore:M', 'chain-ways:L', 'raid-windows:L', 'raid-log:M', 'pi-planets:M', 'net-worth:XL', 'orders:S', 'trade-today:M', 'last-fights:L', 'lb-medals:M', 'pilots:L', 'eve-clock:S', 'collectors:M'].map((x, i) => ({ id: 'd' + i, kind: x.split(':')[0], size: x.split(':')[1], x: 0, y: i })) }] }, D.sizesOf).boards[0].items.every((it, i) => it.size === ['L', 'M', 'L', 'L', 'M', 'M', 'XL', 'S', 'M', 'L', 'M', 'L', 'S', 'M'][i]));

console.log(`homestats.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
