// FIGHT SPLITTING (v0.204.0) — which corp killmails are the same fight, read
// from who fought whom, where, and at what tempo. Every scenario is small
// enough to work by hand; the first one is the failure measured on the real
// feed (time alone chaining two crews into one battle).
const F = require('./sim/lib/fightSplit.js');
const br = require('./sim/lib/battleReport.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };
const MIN = 60_000;
const T0 = Date.parse('2026-09-19T00:00:00Z');
const CORP = 55, ALLY = 100;
// pilots: friends 1-9 (corp 55, alliance 100); 20 = an alliance mate in another corp;
// enemies 101-109 (alliance 200), 201-205 (corp 300, no alliance); 0 = an NPC row
const P = (char) => (char === 0 ? { ally: 0, corp: 1000125, char: 0 }
  : char < 20 ? { ally: ALLY, corp: CORP, char } : char === 20 ? { ally: ALLY, corp: 56, char }
    : char < 200 ? { ally: 200, corp: 210, char } : { ally: 0, corp: 300, char });
let nextId = 1;
/** a killmail: minute offset (may be fractional), system, victim, attackers */
const km = (min, system, victim, attackers) => ({ id: nextId++, t: T0 + Math.round(min * MIN), system, victim: P(victim), attackers: attackers.map(P) });
const split = (mails) => F.splitFights(mails, { corpId: CORP });
const ids = (f) => f.mails.map((m) => m.id).sort((a, b) => a - b).join(',');
const X = 31000001, Y = 31000002, Z = 30000142;

// ---- A: sides
const sideMails = [km(0, X, 101, [1, 2, 20]), km(1, X, 3, [101, 102, 201, 0])];
check('A1 the home alliance is read off the corp\'s own pilots; a corp with no alliance gives 0', F.homeAlliance(sideMails, CORP) === ALLY && F.homeAlliance([{ id: 9, t: 0, system: X, victim: { ally: 0, corp: CORP, char: 1 }, attackers: [] }], CORP) === 0);
const s1 = F.sidesOf(sideMails[0], CORP, ALLY), s2 = F.sidesOf(sideMails[1], CORP, ALLY);
check('A2 a friend killed someone: friends = the corp AND alliance pilots on it, the foe is the victim', [...s1.friends].sort().join(',') === '1,2,20' && [...s1.foes].join(',') === '101' && [...s1.foeGroups].join(',') === '200');
check('A3 a friend died: the foes are the attackers — both enemy groups; the NPC row adds its group but no pilot', [...s2.friends].join(',') === '3' && [...s2.foes].sort().join(',') === '101,102,201' && [...s2.foeGroups].sort((a, b) => a - b).join(',') === '200,300,1000125');

// ---- B: THE MEASURED FAILURE — two crews, two systems, the same hour, kills interleaved
nextId = 1;
const crewA = [0, 2, 4, 6, 8, 10, 40, 42].map((m) => km(m, X, 101 + (m % 3), [1, 2, 3]));       // crew 1-3 vs alliance 200 in X
const crewB = [1, 3, 5, 7, 9, 38, 41].map((m) => km(m, Y, 201 + (m % 3), [4, 5, 6]));             // crew 4-6 vs corp 300 in Y
const both = [...crewA, ...crewB];
const old = br.clusterFights(both.slice().sort((a, b) => b.t - a.t), 40 * MIN);
check('B1 the old rule (40 min of corp-wide quiet) makes ONE battle of it: 15 mails, two systems, two crews', old.length === 1 && old[0].length === 15);
const b = split(both);
check('B2 the splitter keeps the crews apart, and each crew\'s late kills (30 min on, a different victim, the same enemy group) are round two of THEIR fight', b.length === 2 && b.every((f) => new Set(f.mails.map((m) => m.system)).size === 1) && b.map((f) => f.mails.length).sort().join(',') === '7,8', b.map((f) => f.mails.length).join('|'));
check('B3 every killmail lands in exactly one fight', b.reduce((n, f) => n + f.mails.length, 0) === 15 && new Set(b.flatMap((f) => f.mails.map((m) => m.id))).size === 15);
check('B4 fights newest-first, each fight\'s mails newest-first; input order does not matter', b[0].mails[0].t >= b[1].mails[0].t && b.every((f) => f.mails.every((m, i) => i === 0 || f.mails[i - 1].t >= m.t)) && JSON.stringify(split(both.slice().reverse()).map(ids)) === JSON.stringify(b.map(ids)));

// ---- C: how a fight ENDS — by its own tempo
nextId = 1;
const brawl = [0, 0.5, 1, 1.5, 2, 2.5].map((m) => km(m, X, 101, [1, 2, 3]));                    // a kill every 30 s
check('C1 quiet limits: under 4 mails 10 min; 30 s tempo → 6 min (the floor); 2 min tempo → 12; 5 min tempo → 15 (the cap)', F.quietLimit(brawl.slice(0, 3)) === 10 * MIN && F.quietLimit(brawl) === 6 * MIN
  && F.quietLimit([0, 2, 4, 6].map((m) => km(m, X, 101, [1]))) === 12 * MIN && F.quietLimit([0, 5, 10, 15].map((m) => km(m, X, 101, [1]))) === 15 * MIN);
const afterBrawl = (min, victim) => split([...brawl, km(2.5 + min, X, victim, [1, 2, 3])]);
check('C2 a fast brawl is over after 6 quiet minutes: the same pilots killing SOMEONE ELSE 7 min later is a new fight', afterBrawl(7, 201).length === 2 && afterBrawl(5, 201).length === 1);
nextId = 1;
const camp = [0, 3, 6, 9, 12].map((m) => km(m, Z, 201 + (m % 3), [1, 2]));                       // a slow camp: a kill every 3 min
check('C3 a slow camp (every 3 min → 15 min limit) keeps a different victim 12 min later; 16 min later it is a new fight', split([...camp, km(24, Z, 101, [1, 2])]).length === 1 && split([...camp, km(28.5, Z, 101, [1, 2])]).length === 2);
nextId = 1;
check('C4 a young fight (2 mails) gets 10 minutes: 9 min later joins, 11 min later does not', split([km(0, X, 101, [1]), km(1, X, 102, [1]), km(10, X, 205, [1])]).length === 1 && split([km(0, X, 101, [1]), km(1, X, 102, [1]), km(12, X, 205, [1])]).length === 2);

// ---- D: the join reasons, one at a time
nextId = 1;
const d1 = split([km(0, X, 101, [1, 2]), km(2, X, 205, [7, 8])]);
check('D1 same-moment: same system within 3 min joins even with nobody and no enemy in common (the fringe of a brawl)…', d1.length === 1 && d1[0].joins['same-moment'] === 1);
check('D2 …at 4 min it does not', split([km(0, X, 101, [1, 2]), km(4, X, 205, [7, 8])]).length === 2);
const d3 = split([km(0, X, 101, [1, 2, 3]), km(4, Y, 102, [1, 2, 9])]);
check('D3 moved: another system, 2 of the 3 friends the same AND the same enemy group → one running fight', d3.length === 1 && d3[0].joins.moved === 1);
check('D4 the same crew next door against a DIFFERENT enemy: within 5 min it spilled, at 8 min it is another fight', split([km(0, X, 101, [1, 2, 3]), km(4, Y, 201, [1, 2, 9])])[0].joins.spilled === 1 && split([km(0, X, 101, [1, 2, 3]), km(8, Y, 201, [1, 2, 9])]).length === 2);
check('D5 the same ENEMY elsewhere but a different crew is not your fight moving: separate', split([km(0, X, 101, [1, 2, 3]), km(4, Y, 102, [7, 8, 9])]).length === 2);
const d6 = split([km(0, X, 101, [1, 2, 3, 4]), km(1, X, 102, [1, 2, 3, 4]), km(26, X, 103, [1, 2, 5])]);
check('D6 round two: same system, same enemy group, 2 of 3 friends back, 25 min later → the same fight', d6.length === 1 && d6[0].joins['round-two'] === 1);
check('D7 …35 min later it is a new fight; and 25 min later against someone else it is too', split([km(0, X, 101, [1, 2, 3, 4]), km(1, X, 102, [1, 2, 3, 4]), km(36, X, 103, [1, 2, 5])]).length === 2 && split([km(0, X, 101, [1, 2, 3, 4]), km(1, X, 102, [1, 2, 3, 4]), km(26, X, 201, [1, 2, 5])]).length === 2);
check('D8 a pod a minute after its ship is the same fight (the victim is already in it)', split([km(0, X, 3, [101, 102]), km(1, X, 3, [101])]).length === 1);
check('D9 an alliance mate from another corp counts as crew: pilot 20 carries the fight next door', split([km(0, X, 101, [20, 1]), km(3, Y, 102, [20, 1])]).length === 1);

// ---- E: two skirmishes that a later killmail ties together
nextId = 1;
const e = split([km(0, X, 101, [1, 2]), km(1, Y, 102, [4, 5]), km(3, X, 103, [1, 2, 4, 5])]);
check('E1 crew 1-2 in X and crew 4-5 in Y, both against alliance 200; then all four on one kill in X → ONE fight, merged', e.length === 1 && e[0].mails.length === 3 && e[0].merged === 1, JSON.stringify(e.map((f) => [ids(f), f.merged])));
check('E2 …without that killmail they stay two', split([km(0, X, 101, [1, 2]), km(1, Y, 102, [4, 5])]).length === 2);

// ---- G: why it started and ended
nextId = 1;
const g = split([km(0, X, 101, [1, 2]), km(1, X, 102, [1, 2]), km(21, X, 201, [7, 8]), km(22, X, 202, [7, 8])]);
check('G1 two fights in one system 20 min apart: the first ENDED with 20 min of quiet, the second STARTED 20 min after; nothing follows the second', g.length === 2 && g[1].endedByQuietMs === 20 * MIN && g[0].startedAfterMs === 20 * MIN && g[0].endedByQuietMs === null && g[1].startedAfterMs === null);
check('G2 tempo is the median gap: 1 min here', g[0].tempoMs === MIN && F.tempoWords(40_000) === 'every 40 s' && F.tempoWords(3 * MIN) === 'every 3 min');
check('G3 the line the tab shows', F.fightWhy(g[1]) === 'grouped by: same system, same people ×1 — kills every 60 s — ended: 20 min of quiet before these pilots or this system appear again' && /^a single killmail/.test(F.fightWhy(split([km(99, Z, 101, [1])])[0])), F.fightWhy(g[1]));

// ---- R: what belongs in the summary
const r = (id, victim, attackers) => ({ id, victim: { char: victim }, attackers: attackers.map((c) => ({ char: c })) });
const seed = [r(1, 101, [1, 2]), r(2, 3, [101, 102])];
const analysed = [r(1, 101, [1, 2]), r(2, 3, [101, 102]), r(3, 102, [20]), r(4, 301, [302, 303]), r(5, 303, [102]), r(6, 304, [303]), r(7, 305, [0])];
const kept = F.relevantKms(analysed, seed).map((k) => k.id).join(',');
check('R1 kept: the fight\'s own mails, an ally killing an enemy of the fight (3), and a third party dying to one (5); dropped: strangers shooting strangers (4), and 6 — it shares a pilot only with 5, and the net does not widen', kept === '1,2,3,5', kept);
check('R2 an NPC row (char 0) never links anything; with no seed everything is kept', !/7/.test(kept) && F.relevantKms(analysed, []).length === 7);

// ---- W: each system gets its own window
const w = br.fightTimings([{ system: X, t: T0 }, { system: X, t: T0 + 10 * MIN }, { system: Y, t: T0 + 30 * MIN }, { system: Y, t: T0 + 31 * MIN }]);
check('W1 X is asked for 00:00–00:10 ± 10 min, Y for 00:30–00:31 ± 10 min — not both for the whole 31 minutes', w.length === 2
  && w[0].systemID === String(X) && w[0].start === (T0 - 10 * MIN) / 1000 && w[0].end === (T0 + 20 * MIN) / 1000
  && w[1].systemID === String(Y) && w[1].start === (T0 + 20 * MIN) / 1000 && w[1].end === (T0 + 41 * MIN) / 1000, JSON.stringify(w));

// ---- O: the poster — what a fight's card says at a glance (v0.204.1)
nextId = 1;
const priced = (m, value) => ({ ...m, victim: { ...m.victim, lossValue: value } });
const posterMails = [
  priced(km(0, X, 101, [1, 2, 20]), 300e6),      // we killed 101 (alliance 200): ours 1,2,20
  priced(km(1, X, 102, [1, 3]), 200e6),          // we killed 102 (alliance 200): + 3
  priced(km(2, X, 2, [103, 104, 201, 0]), 80e6), // we lost pilot 2 to 103,104 (alliance 200), 201 (corp 300) and a rat
  priced(km(3, X, 201, [1]), 0),                 // we killed 201 — no price yet
];
const po = F.fightPoster(posterMails, CORP, ALLY);
check('O1 ships seen: ours 1,2,3 and the alliance mate 20 = 4; theirs 101,102,103,104,201 = 5 (the rat has no pilot)', po.ours === 4 && po.theirs === 5, JSON.stringify([po.ours, po.theirs]));
check('O2 ISK: destroyed 300m + 200m + 0 = 500m over 3 kills; lost 80m over 1 loss; one killmail unpriced', po.destroyed === 500e6 && po.lost === 80e6 && po.kills === 3 && po.losses === 1 && po.unpriced === 1);
check('O3 who it was against, most pilots first: alliance 200 with 4, corp 300 with 1, then the rats\' corp with none', po.enemies.map((e) => [e.id, e.pilots]).join('|') === '200,4|300,1|1000125,0', JSON.stringify(po.enemies));
check('O4 a fight with no losses and no enemy pilot seen twice counts each once', F.fightPoster([priced(km(0, X, 101, [1]), 1), priced(km(1, X, 101, [1]), 1)], CORP, ALLY).theirs === 1);

// ---- H: the time, in words (EVE days)
const NOW = Date.parse('2026-09-19T08:30:00Z');
const at = (iso) => Date.parse(iso);
const h1 = F.fightWhen(at('2026-09-19T05:07:00Z'), at('2026-09-19T05:37:00Z'), NOW);
check('H1 this morning: Today 05:07 · 30 min · 3 h ago (173 min rounds to 3 h)', h1.day === 'Today' && h1.clock === '05:07' && h1.length === '30 min' && h1.ago === '3 h ago', JSON.stringify(h1));
const h2 = F.fightWhen(at('2026-09-18T23:23:00Z'), at('2026-09-19T00:35:00Z'), NOW);
check('H2 last night across midnight: Yesterday 23:23 · 1 h 12 min', h2.day === 'Yesterday' && h2.clock === '23:23' && h2.length === '1 h 12 min' && h2.ago === '8 h ago', JSON.stringify(h2));
const h3 = F.fightWhen(at('2026-09-16T14:49:00Z'), at('2026-09-16T14:49:20Z'), NOW);
check('H3 three days back: the weekday, under a minute, 3 d ago', h3.day === 'Wednesday' && h3.length === 'under a minute' && h3.ago === '3 d ago', JSON.stringify(h3));
const h4 = F.fightWhen(NOW - 20 * MIN, NOW - 20_000, NOW);
check('H4 just ended: 20 min long, just now; 40 min after it: 40 min ago; a week back shows the date', h4.length === '20 min' && h4.ago === 'just now' && F.fightWhen(NOW - 60 * MIN, NOW - 40 * MIN, NOW).ago === '40 min ago' && F.fightWhen(at('2026-09-10T10:00:00Z'), at('2026-09-10T11:00:00Z'), NOW).day === '2026-09-10' && F.fightWhen(at('2026-09-10T10:00:00Z'), at('2026-09-10T11:00:00Z'), NOW).length === '1 h');

// ---- M: one mark per killmail in the Log Visualizer (v0.204.1)
const KI = require('./sim/lib/killIntel.js');
const mark = (id, t, kind, finalBlow, extra = {}) => ({ id, hash: 'h' + id, t, kind, system: X, value: 39e6, victimName: 'Victim ' + id, victimCharId: 900 + id, victimShipId: 670, finalBlow, ...extra });
// four of your characters' feeds: kill 1 is on all four (one landed the final blow); kill 2 on two; mail 3 is a kill for one pilot and the LOSS of another
const lists = [
  [mark(1, 100, 'kill', false), mark(2, 200, 'kill', false), mark(3, 300, 'kill', false)],
  [mark(1, 100, 'kill', true), mark(2, 200, 'kill', false)],
  [mark(1, 100, 'kill', false, { victimName: '', hash: '' })],
  [mark(1, 100, 'kill', false), mark(3, 300, 'loss', false), mark(3, 300, 'loss', false)],
];
const merged = KI.mergeKillMarks(lists);
check('M1 eight feed rows are three killmails, oldest first', merged.length === 3 && merged.map((k) => k.id).join(',') === '1,2,3');
check('M2 kill 1: four of your pilots on it, the final blow kept, name and hash kept from a feed that had them', merged[0].pilots === 4 && merged[0].finalBlow === true && merged[0].victimName === 'Victim 1' && merged[0].hash === 'h1');
check('M3 mail 3 is a LOSS if any of your characters is the victim; a feed listing it twice is still one pilot', merged[2].kind === 'loss' && merged[2].pilots === 2);
const sum = (ks) => ks.filter((k) => k.kind !== 'loss').reduce((s, k) => s + k.value, 0);
check('M4 the money: the raw rows claimed 7 kill rows (3 + 2 + 1 + 1) × 39m = 273m destroyed; merged it is 2 kills × 39m = 78m', sum(lists.flat()) === 273e6 && sum(merged) === 78e6);
check('M5 nothing in → nothing out; one feed passes through with pilots 1', KI.mergeKillMarks([]).length === 0 && KI.mergeKillMarks([[mark(9, 1, 'kill', false)]])[0].pilots === 1);
// ---- O5: the corporations whose LOGOS the card shows (v0.204.2), same four killmails as O1–O4
check('O5 our corps by pilots: corp 55 with pilots 1,2,3 then the alliance mate\'s corp 56 with one', po.corps.ours.map((c) => [c.id, c.pilots]).join('|') === '55,3|56,1', JSON.stringify(po.corps.ours));
check('O6 their corps: corp 210 (alliance 200) with 101-104, corp 300 with 201; the rat row has no pilot and shows no logo', po.corps.theirs.map((c) => [c.id, c.pilots]).join('|') === '210,4|300,1', JSON.stringify(po.corps.theirs));

// ---- T: the timeline's numbers (v0.204.2) — only ever sums of killmails
const TL = require('./sim/lib/fightTimeline.js');
const cum = (o, t) => ({ ours: { ships: o[0], pods: o[1], isk: o[2], dmg: o[3], seen: o[4] }, theirs: { ships: t[0], pods: t[1], isk: t[2], dmg: t[3], seen: t[4] } });
const tp = (t, side, pod, c) => ({ t, killmailId: t, side, shipId: 1, ship: 'Hull', pilotId: 9, pilot: 'P', iskNum: 0, isk: '', dmgTaken: 0, attackers: 1, pod, cum: c });
// they lose a ship (200m, 5000 dmg), then its pod (10m, 400), then we lose a ship (50m, 2000)
const PTS = [tp(1000, 'theirs', false, cum([0, 0, 0, 0, 2], [1, 0, 200e6, 5000, 1])), tp(61000, 'theirs', true, cum([0, 0, 0, 0, 2], [1, 1, 210e6, 5400, 1])), tp(121000, 'ours', false, cum([1, 0, 50e6, 2000, 3], [1, 1, 210e6, 5400, 1]))];
const ser = (m) => TL.timelineSeries(PTS, m).map((s) => [s.t, s.ours, s.theirs]);
check('T1 ships lost: a zero at the first kill, then 0/1, 0/1 (the pod is not a hull), 1/1', JSON.stringify(ser('ships')) === JSON.stringify([[1000, 0, 0], [1000, 0, 1], [61000, 0, 1], [121000, 1, 1]]), JSON.stringify(ser('ships')));
check('T2 ISK lost includes the pod: 200m → 210m for them, 50m for us', JSON.stringify(ser('isk').slice(1)) === JSON.stringify([[1000, 0, 200e6], [61000, 0, 210e6], [121000, 50e6, 210e6]]));
check('T3 damage taken and pilots seen read the same running totals', JSON.stringify(ser('damage').slice(1).map((r) => r.slice(1))) === '[[0,5000],[0,5400],[2000,5400]]' && JSON.stringify(ser('pilots').slice(1).map((r) => r.slice(1))) === '[[2,1],[2,1],[3,1]]');
check('T4 the y axis tops at the larger side and is never 0; an empty fight has no series', TL.seriesMax(TL.timelineSeries(PTS, 'isk')) === 210e6 && TL.seriesMax([]) === 1 && TL.timelineSeries([], 'ships').length === 0);
check('T5 the hover target is the nearest killmail; a tie goes to the earlier one', TL.nearestIndex(PTS, 0) === 0 && TL.nearestIndex(PTS, 40000) === 1 && TL.nearestIndex(PTS, 31000) === 0 && TL.nearestIndex(PTS, 999999) === 2 && TL.nearestIndex([], 5) === -1);
check('T6 a step path holds the value until the next killmail: across, then up', TL.stepPath([[0, 10], [5, 10], [9, 4]]) === 'M0.0,10.0 H5.0 V10.0 H9.0 V4.0' && TL.stepPath([]) === '');
check('T7 four modes, each with its own honest note', TL.TIMELINE_MODES.map((m) => m.key).join(',') === 'ships,isk,damage,pilots' && TL.TIMELINE_MODES.every((m) => m.note.length > 20));
console.log(`fightsplit.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
