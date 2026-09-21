// CORP LEADERBOARD (v0.208.0; widened v0.210.0) — every rule of the board pinned on a hand-made set
// of killmails. Corp 100 has pilots 1 (A), 2 (B) and 3 (C); everyone else is an outsider; char 0 is
// an NPC or a structure. All ids are made up.
const L = require('./sim/lib/leaderboard.js');
const X = require('./sim/lib/leaderboardExtras.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };
const MIN = 60_000, DAY = 86_400_000, T0 = 1_800_000_000_000, M = 1_000_000;   // T0 = 2027-01-15 08:00 EVE
const us = (char, dmg, fb = false, ship = 610) => ({ char, corp: 100, ship, dmg, fb });
const them = (char, dmg = 0, ship = 700) => ({ char, corp: 200, ship, dmg });
const mails = [
  // m1 — a 100m kill: A 600 (final blow), B 300, an outsider 100 → total 1,000; A did the most
  { id: 1, t: T0, system: 31, value: 100 * M, victim: them(91, 1000, 600), attackers: [us(1, 600, true), us(2, 300, false, 611), { char: 50, corp: 300, ship: 701, dmg: 100 }] },
  // m2 — B pods the same pilot alone: a kill, a final blow, top damage — but a capsule is never a solo kill
  { id: 2, t: T0 + MIN, system: 31, value: 10 * M, victim: them(91, 50, 670), attackers: [us(2, 50, true, 611)] },
  // m3, m4 — A loses his ship (40m) and then his pod (5m)
  { id: 3, t: T0 + 2 * MIN, system: 31, value: 40 * M, victim: us(1, 5000, false, 601), attackers: [them(92, 5000)] },
  { id: 4, t: T0 + 3 * MIN, system: 31, value: 5 * M, victim: us(1, 400, false, 670), attackers: [them(92, 400)] },
  // m5 — C alone with an NPC on the mail, on a BATTLESHIP: 1,000 of 1,500 damage → 200m × 2/3; the NPC does not spoil the solo
  { id: 5, t: T0 + 200 * MIN, system: 32, value: 200 * M, victim: them(93, 1500, 602), attackers: [us(3, 1000, true, 612), { char: 0, corp: 1000125, ship: 0, dmg: 500 }] },
  // m6 — B dies with corp mate C on the mail: B's loss, nobody's kill
  { id: 6, t: T0 + 201 * MIN, system: 32, value: 20 * M, victim: us(2, 1000, false, 603), attackers: [us(3, 100, true, 612), them(94, 900)] },
  // m7 — a 1b structure (no pilot): A and B 500 each, B the final blow → both "did the most", 500m each by share
  { id: 7, t: T0 + 400 * MIN, system: 33, value: 1000 * M, victim: { char: 0, corp: 200, ship: 35832, dmg: 1000 }, attackers: [us(1, 500), us(2, 500, true, 611)] },
  // the same mail again (two feeds overlap) — counted once
  { id: 7, t: T0 + 400 * MIN, system: 33, value: 1000 * M, victim: { char: 0, corp: 200, ship: 35832, dmg: 1000 }, attackers: [us(1, 500), us(2, 500, true, 611)] },
  // m9 — the corp's own structure dies: no pilot, nobody's loss
  { id: 9, t: T0 + 402 * MIN, system: 33, value: 300 * M, victim: { char: 0, corp: 100, ship: 35832, dmg: 9000 }, attackers: [them(95, 9000)] },
  // m10 — the NEXT EVE day: A is on a mail twice (100 and 200): one kill, the bigger row speaks for him → 30m × 200/300; alone → solo
  { id: 10, t: T0 + 2000 * MIN, system: 31, value: 30 * M, victim: them(96, 300, 604), attackers: [us(1, 100), us(1, 200, true)] },
  // m11 — C holds a point and fires nothing (0 damage) while an outsider does the killing: a kill, and an ASSIST
  { id: 11, t: T0 + 2001 * MIN, system: 34, value: 50 * M, victim: them(97, 800, 605), attackers: [us(3, 0, false, 612), { char: 51, corp: 300, ship: 701, dmg: 800, fb: true }] },
];
const fights = [[1, 2, 3, 4], [5, 6], [7, 9]]; // m10 and m11 are in none → fights of their own
const classOf = (ship) => ({ 602: 'battleship', 610: 'cruiser', 611: 'cruiser', 612: 'cruiser', 601: 'frigate', 603: 'frigate' }[ship] ?? 'other');
const base = { mails, corpId: 100, fights, classOf };
const stats = L.pilotStats(base);
const by = Object.fromEntries(stats.map((s) => [s.char, s]));
const A = by[1], B = by[2], C = by[3];

check('P1 everyone with activity is on the board, and only corp pilots: A, B, C — most kills first, damage breaks the tie', stats.map((s) => s.char).join(',') === '1,2,3');
check('P2 A: 3 kills (m1, m7, m10 once), 2 final blows, damage 600 + 500 + 200 = 1,300', A.kills === 3 && A.finalBlows === 2 && A.damage === 1300, JSON.stringify(A));
check('P3 A: ISK on mails 100 + 1,000 + 30 = 1,130m; by damage share 60 + 500 + 20 = 580m', A.iskOn === 1130 * M && Math.abs(A.iskShare - 580 * M) < 1, String(A.iskShare));
check('P4 A: did the most on m1, tied on m7, and on m10 → 3; solo on m10 only → 1', A.topDamage === 3 && A.solo === 1);
check('P5 A: 2 losses for 45m, one of them a pod', A.losses === 2 && A.iskLost === 45 * M && A.pods === 1);
check('P6 A: 3 fights (the first, the structure, and m10 on its own); 2 of them without a loss', A.fights === 3 && A.fightsClean === 2);
check('P7 A: biggest kill is the 1b structure; flies hull 610 (3 mails) over 601 (1); the pod is not a hull', A.biggest.id === 7 && A.biggest.value === 1000 * M && A.hull === 610 && A.hulls === 2);
check('P8 B: 3 kills, 2 final blows (the pod, the structure), damage 850, share 30 + 10 + 500 = 540m, top on the pod and the tie → 2, no solo (a capsule)', B.kills === 3 && B.finalBlows === 2 && B.damage === 850 && Math.abs(B.iskShare - 540 * M) < 1 && B.topDamage === 2 && B.solo === 0);
check('P9 B: the friendly-fire mail IS his loss (20m); 3 fights, 2 clean', B.losses === 1 && B.iskLost === 20 * M && B.fights === 3 && B.fightsClean === 2);
check('P10 C: 2 kills — shooting B earned him nothing; solo on m5 despite the NPC, not on m11 (an outsider is on it); 200m × 1,000 / 1,500 = 133.33m and nothing for the kill he did no damage on', C.kills === 2 && C.solo === 1 && C.finalBlows === 1 && Math.abs(C.iskShare - 200 * M * (1000 / 1500)) < 1 && C.iskOn === 250 * M && C.losses === 0 && C.fights === 2 && C.fightsClean === 2);
check('P11 the corp structure that died is nobody\'s loss; outsiders and NPCs are nobody on the board', stats.length === 3 && stats.reduce((t, s) => t + s.losses, 0) === 3);

// ---- v0.210.0: what else a killmail can tell
check('N1 an ASSIST is a kill with no damage at all — the trace of a point or a jam: C 1, nobody else', C.assists === 1 && A.assists === 0 && B.assists === 0);
check('N2 kill streaks, in the order things happened: A kill · loss · loss · kill · kill → 2; B kill · kill · loss · kill → 2; C kill · kill → 2', A.streak === 2 && B.streak === 2 && C.streak === 2);
check('N3 first blood = on the first kill of a fight that had at least two: only the opening fight (m1 then m2) qualifies → A and B; C\'s one-kill fights do not', A.firstBloods === 1 && B.firstBloods === 1 && C.firstBloods === 0);
check('N4 the most damage on one kill: A 600 (m1), B 500 (m7), C 1,000 (m5) — never the 0-damage assist', A.maxHit.dmg === 600 && A.maxHit.id === 1 && B.maxHit.dmg === 500 && C.maxHit.dmg === 1000 && C.maxHit.id === 5);
check('N5 EVE days with a killmail: A 2 (the 15th and m10 on the 16th), C 2, B 1; systems: A 31 + 33 = 2, B 31 + 32 + 33 = 3, C 32 + 34 = 2', A.days === 2 && C.days === 2 && B.days === 1 && A.systems === 2 && B.systems === 3 && C.systems === 2);
check('N6 wingmen: A and B shared kills with each other → 1 each; C never shared a kill with a corp mate (shooting one does not count)', A.mates === 1 && B.mates === 1 && C.mates === 0);
check('N7 by victim: B killed a capsule; A and B a thing with no pilot; C a battleship (big game)', B.podKills === 1 && A.podKills === 0 && A.structureKills === 1 && B.structureKills === 1 && C.structureKills === 0 && C.bigGame === 1 && A.bigGame === 0);
check('N8 the spoons: A\'s dearest loss is the 40m hull and he lost 2 ships in one fight; B 20m and 1', A.biggestLoss.id === 3 && A.biggestLoss.value === 40 * M && A.worstFight === 2 && B.biggestLoss.value === 20 * M && B.worstFight === 1 && C.biggestLoss === null);
check('N9 hull classes come from the hull\'s inventory group; a capsule is a capsule whatever its group; an unknown hull is "other"', L.classOfGroup(25) === 'frigate' && L.classOfGroup(27) === 'battleship' && L.classOfGroup(485) === 'capital' && L.classOfGroup(832) === 'cruiser' && L.classOfGroup(undefined, 670) === 'capsule' && L.classOfGroup(99999) === 'other' && L.classOfGroup(undefined) === 'other');

// ---- the boards
const rank = (id) => L.rankBoard(stats, L.BOARDS.find((b) => b.id === id)).map((r) => `${r.char}#${r.rank}`).join(' ');
check('R1 most kills: A and B share first, C is THIRD (1, 1, 3)', rank('kills') === '1#1 2#1 3#3', rank('kills'));
check('R2 heavy hitter: A 1,300 · C 1,000 · B 850', rank('damage') === '1#1 3#2 2#3');
check('R3 ISK destroyed by share: A 580m · B 540m · C 133m', rank('iskShare') === '1#1 2#2 3#3');
check('R4 lone wolf lists only those with a solo kill: A and C', rank('solo') === '1#1 3#1');
check('R5 untouchable needs 3 fights: A and B (2 clean each); C with two fights is left off', rank('untouchable') === '1#1 2#1');
const trade = L.rankBoard(stats, L.BOARDS.find((b) => b.id === 'trade'));
check('R6 trade balance: B 540 / 560 = 96.4% over A 580 / 625 = 92.8%; C has two mails → not ranked', trade.map((r) => r.char).join(',') === '2,1' && Math.abs(trade[0].value - 540 / 560) < 1e-9 && Math.abs(trade[1].value - 580 / 625) < 1e-9);
check('R7 the wooden spoons: big spender A 45m then B 20m; pod express A alone; expensive taste A 40m, B 20m; whelped needs two ships in one fight → A', rank('spender') === '1#1 2#2' && rank('pods') === '1#1' && rank('bigLoss') === '1#1 2#2' && rank('whelp') === '1#1');
check('R8 the new boards: one big hit C · A · B; helping hand and big game C alone; egg hunter B; demolition, first blood, wingman A and B; regular (2+ days) A and C; hangar queen (2+ hulls) A and B; globetrotter B 3, then A and C on 2; a streak of 2 for all three',
  rank('maxHit') === '3#1 1#2 2#3' && rank('assist') === '3#1' && rank('bigGame') === '3#1' && rank('podKills') === '2#1' && rank('structures') === '1#1 2#1' && rank('firstBlood') === '1#1 2#1' && rank('mates') === '1#1 2#1'
  && rank('days') === '1#1 3#1' && rank('hulls') === '1#1 2#1' && rank('systems') === '2#1 1#2 3#2' && rank('streak') === '1#1 2#1 3#1', ['maxHit', 'days', 'hulls', 'systems', 'streak'].map((b) => `${b}: ${rank(b)}`).join(' | '));
const medals = L.medalTable(stats);
const md = Object.fromEntries(medals.map((m) => [m.char, m]));
check('R9 medals over the 21 honour boards: A 15 gold + 3 silver = 51 · B 13 gold, 2 silver, 2 bronze = 45 · C 6 gold, 2 silver, 6 bronze = 28', md[1].gold === 15 && md[1].silver === 3 && md[1].bronze === 0 && md[1].points === 51 && md[2].gold === 13 && md[2].silver === 2 && md[2].bronze === 2 && md[2].points === 45 && md[3].gold === 6 && md[3].silver === 2 && md[3].bronze === 6 && md[3].points === 28 && medals.map((m) => m.rank).join(',') === '1,2,3', JSON.stringify(medals));
check('R10 25 boards: 21 honour, 4 spoons that award nothing; every board sits in a group that exists; ids are unique', L.BOARDS.length === 25 && L.BOARDS.filter((b) => b.honour).length === 21 && L.BOARDS.filter((b) => !b.honour).map((b) => b.id).join(',') === 'spender,bigLoss,pods,whelp' && L.BOARDS.every((b) => L.BOARD_GROUPS.some((g) => g.id === b.group)) && new Set(L.BOARDS.map((b) => b.id)).size === 25 && L.BOARD_GROUPS.every((g) => L.BOARDS.some((b) => b.group === g.id)));
const moves = L.rankMoves(medals, [{ char: 2, rank: 1 }, { char: 1, rank: 2 }]);
check('R11 against the window before (B first, A second, C not on it): A is up one, B down one, C is new', moves.get(1) === 1 && moves.get(2) === -1 && moves.get(3) === null);

// ---- windows
const late = L.pilotStats({ ...base, since: T0 + 200 * MIN });
const lb = Object.fromEntries(late.map((s) => [s.char, s]));
check('W1 from m5 on: A has 2 kills and no loss; B 1 kill and his loss; C 2 kills; fights are counted inside the window only', lb[1].kills === 2 && lb[1].losses === 0 && lb[1].fights === 2 && lb[2].kills === 1 && lb[2].losses === 1 && lb[2].fights === 2 && lb[3].kills === 2);
const early = Object.fromEntries(L.pilotStats({ ...base, until: T0 + 400 * MIN }).map((s) => [s.char, s]));
check('W2 a window can END too (a finished month): up to but not including m7 → A 1 kill, B 2, C 1', early[1].kills === 1 && early[2].kills === 2 && early[3].kills === 1);
const now = Date.UTC(2026, 8, 20, 12, 0, 0);
const w7 = L.windowSpan(L.WINDOWS.find((w) => w.id === '7'), now), wm = L.windowSpan(L.WINDOWS.find((w) => w.id === 'month'), now), wl = L.windowSpan(L.WINDOWS.find((w) => w.id === 'last-month'), now), wa = L.windowSpan(L.WINDOWS.find((w) => w.id === 'all'), now);
check('W3 7 days: from now − 7 d, open-ended; the window before is the 7 days before that', w7.span.since === now - 7 * DAY && w7.span.until === null && w7.before.since === now - 14 * DAY && w7.before.until === now - 7 * DAY);
check('W4 "this month" starts on the 1st at 00:00 EVE and is compared with last month; "last month" is 1 Aug → 1 Sep, compared with July; "everything" has nothing before it', wm.span.since === Date.UTC(2026, 8, 1) && wm.span.until === null && wm.before.since === Date.UTC(2026, 7, 1) && wm.before.until === Date.UTC(2026, 8, 1)
  && wl.span.since === Date.UTC(2026, 7, 1) && wl.span.until === Date.UTC(2026, 8, 1) && wl.before.since === Date.UTC(2026, 6, 1) && wa.before === null);
check('W5 the window before is only compared with when it is held WHOLE: held from 10 days ago cannot judge a 7-day window\'s predecessor; held from 20 days ago can', L.beforeIsHeld(now - 10 * DAY, w7.before) === false && L.beforeIsHeld(now - 20 * DAY, w7.before) === true && L.beforeIsHeld(null, w7.before) === false && L.beforeIsHeld(now - 99 * DAY, null) === false);

// ---- how far back the board can honestly reach
check('V1 a window inside what is held is just the window; one reaching past it is SHORTENED and says so; "everything" is what is held', JSON.stringify(L.coverage(now - 5 * DAY, now, 3)) === JSON.stringify({ since: now - 3 * DAY, asked: now - 3 * DAY, short: false })
  && L.coverage(now - 5 * DAY, now, 7).since === now - 5 * DAY && L.coverage(now - 5 * DAY, now, 7).short === true && L.coverage(now - 5 * DAY, now, null).short === false);
check('V1b nothing known yet about completeness (the first moment of a session): the range is still honoured as asked — never "everything" — and marked unknown, so no tick is shown', L.coverage(null, now, 7).since === now - 7 * DAY && L.coverage(null, now, 7).unknown === true && L.coverage(now - 5 * DAY, now, 3).unknown === undefined);
check('V2 neither list full → as far back as zKillboard goes (no floor)', L.completeSince([{ full: false, oldestT: 5, overlap: false }, { full: false, oldestT: 9, overlap: false }], null) === null);
check('V3 a FULL list may be missing older mails: complete only from its oldest row; two full lists → the LATER of the two', L.completeSince([{ full: true, oldestT: 500, overlap: false }, { full: false, oldestT: 100, overlap: false }], null) === 500 && L.completeSince([{ full: true, oldestT: 500, overlap: false }, { full: true, oldestT: 800, overlap: false }], null) === 800);
check('V4 a full list that reaches into what was already held keeps the earlier completeness (300); one that does not resets it', L.completeSince([{ full: true, oldestT: 900, overlap: true }, { full: true, oldestT: 950, overlap: true }], 300) === 300 && L.completeSince([{ full: true, oldestT: 900, overlap: true }, { full: true, oldestT: 950, overlap: false }], 300) === 950 && L.completeSince([{ full: true, oldestT: 900, overlap: true }], null) === 900);
check('V5 values read: ISK through the app\'s formatter, a share as a percentage, damage shortened', L.fmtBoardValue(0.9643, 'pct', String) === '96.4%' && L.fmtBoardValue(1300, 'dmg', String) === '1.3k' && L.fmtBoardValue(2_500_000, 'dmg', String) === '2.50m' && L.fmtBoardValue(7, 'n', String) === '7' && L.fmtBoardValue(5, 'isk', (n) => `${n} ISK`) === '5 ISK');

// ---- the hall of fame
const hof = X.hallOfFame(base);
check('H1 records: the 1b structure is the biggest kill (A and B on it); A\'s 40m hull the biggest loss; C\'s 1,000 on the battleship the hardest hit', hof.biggestKill.mail === 7 && hof.biggestKill.chars.join(',') === '1,2' && hof.biggestLoss.mail === 3 && hof.biggestLoss.chars[0] === 1 && hof.hardestHit.value === 1000 && hof.hardestHit.chars[0] === 3 && hof.hardestHit.mail === 5);
check('H2 the longest streak is 2, shared by all three; the most kills in one fight: B with 2 in the opening fight', hof.longestStreak.value === 2 && hof.longestStreak.chars.join(',') === '1,2,3' && hof.mostKillsInFight.value === 2 && hof.mostKillsInFight.chars.join(',') === '2');
check('H3 the busiest day is 2027-01-15 with 4 kills; the biggest fight is the opening one: 2 pilots, 2 kills, 2 losses on 4 mails (three fights tie on pilots — the one with the most mails wins)', hof.busiestDay.day === '2027-01-15' && hof.busiestDay.value === 4 && JSON.stringify(hof.biggestFight) === JSON.stringify({ pilots: 2, kills: 2, losses: 2, mails: 4, startT: T0 }));

// ---- a pilot's card
const pa = X.pilotProfile(base, 1);
check('C1 A\'s card: first on the medals table with 51 points; his places list starts with boards he leads', pa.medal.rank === 1 && pa.medal.points === 51 && pa.places[0].rank === 1 && pa.places.some((p) => p.id === 'trade' && p.rank === 2 && p.of === 2) && pa.places.some((p) => p.id === 'whelp' && p.rank === 1));
check('C2 when he fights: 3 mails in the 08:00 hour, 1 at 14:00, 1 at 17:00', pa.hours[8] === 3 && pa.hours[14] === 1 && pa.hours[17] === 1 && pa.hours.reduce((t, n) => t + n, 0) === 5);
check('C3 what he flies: hull 610 three times, never lost; 601 once, lost — a cruiser pilot who lost a frigate', JSON.stringify(pa.hulls) === '[{"ship":610,"uses":3,"lost":0},{"ship":601,"uses":1,"lost":1}]' && JSON.stringify(pa.classes) === '[{"cls":"cruiser","uses":3},{"cls":"frigate","uses":1}]');
check('C4 the people in his story: outsider 92 killed him twice (nemesis); he killed 91 and 96 once each → the lower id; B was on 2 of his kills (his buddy)', JSON.stringify(pa.nemesis) === '{"char":92,"n":2}' && JSON.stringify(pa.prey) === '{"char":91,"n":1}' && JSON.stringify(pa.buddy) === '{"char":2,"n":2}');
check('C5 his mails, newest first: kill 10 · kill 7 · loss 4 · loss 3 · kill 1 — with his damage, his final blows and what he flew', pa.recent.map((r) => `${r.kind}${r.id}`).join(' ') === 'kill10 kill7 loss4 loss3 kill1' && pa.recent[0].dmg === 200 && pa.recent[0].fb === true && pa.recent[0].flew === 610 && pa.recent[3].flew === 601);
check('C6 a pilot who is not on the board has no card', X.pilotProfile(base, 999) === null);

// ---- the corp's days, and the text for chat
const cd = X.corpDays(base, T0 + 3 * DAY);
check('D1 one row per EVE day up to today, empty days kept: the 15th 4 kills (1,310m) and 3 losses (65m) by 3 pilots; the 16th 2 kills (80m) by 2; the 17th and 18th nothing', cd.map((d) => `${d.day.slice(8)}:${d.kills}:${d.losses}:${d.pilots}`).join(' ') === '15:4:3:3 16:2:0:2 17:0:0:0 18:0:0:0' && cd[0].destroyed === 1310 * M && cd[0].lost === 65 * M && cd[1].destroyed === 80 * M);
// 2027-01-15 is a Friday: its week starts Monday 2027-01-11; 200 days on is 2027-08-03
const weeks = X.corpDays({ ...base, since: T0 }, T0 + 200 * DAY);
check('D2 past 92 days the rows are WEEKS labelled by their Monday: the first holds all six kills and three losses (both days fall in the week of 11 January), 30 rows to cover 200 days', weeks[0].bucket === 'week' && weeks[0].day === '2027-01-11' && weeks[0].kills === 6 && weeks[0].losses === 3 && weeks.length === 30 && weeks.every((w) => new Date(w.day + 'T00:00:00Z').getUTCDay() === 1), weeks.length + ' ' + weeks[0].day);
const monthsRows = X.corpDays({ ...base, since: T0 }, T0 + 600 * DAY);
check('D3 past 550 days they are calendar MONTHS: January 2027 first, 21 of them to September 2028', monthsRows[0].bucket === 'month' && monthsRows[0].day === '2027-01-01' && monthsRows[0].kills === 6 && monthsRows.length === 21, String(monthsRows.length) + ' ' + monthsRows[monthsRows.length - 1].day);
const txt = X.boardText({ corpName: 'Test Corp', window: '7 days', since: T0, stats, nameOf: (c) => ({ 1: 'Alpha', 2: 'Bravo', 3: 'Charlie' }[c]), isk: (n) => `${n / M}m`, fmt: (v, u) => L.fmtBoardValue(v, u, (n) => `${n / M}m`) });
check('T1 the chat text: a title with the window and the pilot count, the medals, one line per board naming EVERY pilot tied for first', txt.startsWith('🏆 Test Corp — leaderboard · 7 days (since 2027-01-15) · 3 pilots') && txt.includes('1. Alpha — 51 pts (🥇15 🥈3)') && txt.includes('🗡 Most kills: Alpha, Bravo — 3') && txt.includes('🕸 Assists (tackle & EWAR): Charlie — 1') && txt.includes('🐋 Most valuable kill: Alpha, Bravo — 1000m') && txt.endsWith('public killmails only — the same ruler for everyone'), txt);

// ---- v0.211.0: the sanity check's finds, the archive's trimming, and free time ranges
const solo = L.pilotStats({ corpId: 100, classOf: (s) => ({ 800: 'cruiser', 33475: 'structure' }[s] ?? 'other'), mails: [
  { id: 50, t: T0, value: 9 * M, victim: them(80, 900, 800), attackers: [us(7, 900, true)] },          // a cruiser, alone: a solo kill
  { id: 51, t: T0 + MIN, value: 3 * M, victim: them(81, 400, 33475), attackers: [us(7, 400, true)] },   // a tractor unit, alone: its OWNER is the victim, but it is no ship
] })[0];
check('S1 popping a deployable alone is NOT a solo kill (it has an owner on the mail, but it is no ship): 2 kills, 1 solo, 1 structure killed', solo.kills === 2 && solo.solo === 1 && solo.structureKills === 1);
const blob = { id: 60, t: T0, value: 100 * M, victim: them(82, 12750, 800), attackers: [us(8, 500, true), ...Array.from({ length: 49 }, (_, i) => ({ char: 1001 + i, corp: 300, ship: 701, dmg: (i + 1) * 10 }))] };
const slim = L.compactMail(blob, 100, 10);
const sb = L.pilotStats({ corpId: 100, mails: [blob] })[0], ss = L.pilotStats({ corpId: 100, mails: [slim] })[0];
check('S2 a 50-attacker mail trimmed to 10 rows for the archive: the corp row and the 9 biggest outsiders stay; the other 40 become a count (40), their damage (10 + … + 400 = 8,200) and their best hit (400); a small mail is left alone', slim.attackers.length === 10 && slim.attackers[0].char === 8 && JSON.stringify(slim.others) === '{"players":40,"dmg":8200,"max":400}' && L.compactMail(blob, 100, 60) === blob, JSON.stringify(slim.others));
check('S3 …and every number the board reads is IDENTICAL before and after: 100m × 500 / 12,750 = 3,921,568.63 by share, top damage, not solo', Math.abs(sb.iskShare - 100 * M * 500 / 12750) < 0.01 && sb.iskShare === ss.iskShare && sb.topDamage === 1 && ss.topDamage === 1 && sb.solo === 0 && ss.solo === 0 && sb.damage === ss.damage && sb.kills === ss.kills);
const may = L.monthSpan('2026-05');
check('W6 any month: May 2026 is 1 May 00:00 up to 1 June 00:00 EVE, compared with April; nonsense is refused', may.span.since === Date.UTC(2026, 4, 1) && may.span.until === Date.UTC(2026, 5, 1) && may.before.since === Date.UTC(2026, 3, 1) && may.before.until === Date.UTC(2026, 4, 1) && L.monthSpan('2026-13') === null && L.monthSpan('May') === null);
const ds = L.dateSpan('2026-05-03', '2026-05-09', now);
check('W7 two dates, BOTH included: 3 → 9 May is seven whole days, compared with the seven before; swapped dates are put right; no end = up to now; a date that does not exist is refused', ds.span.since === Date.UTC(2026, 4, 3) && ds.span.until === Date.UTC(2026, 4, 10) && ds.before.since === Date.UTC(2026, 3, 26) && ds.before.until === Date.UTC(2026, 4, 3)
  && L.dateSpan('2026-05-09', '2026-05-03', now).span.since === Date.UTC(2026, 4, 3) && L.dateSpan('2026-05-03', '', now).span.until === null && L.dateSpan('2026-02-30', '', now) === null && L.dateSpan('soon', '', now) === null);
const wy = L.windowSpan(L.WINDOWS.find((w) => w.id === 'year'), now);
check('W8 this year runs from 1 January and is compared with all of last year; 90 days with the 90 before', wy.span.since === Date.UTC(2026, 0, 1) && wy.before.since === Date.UTC(2025, 0, 1) && wy.before.until === Date.UTC(2026, 0, 1) && L.windowSpan(L.WINDOWS.find((w) => w.id === '90'), now).before.since === now - 180 * DAY);
check('W9 the months a history read walks, newest first, across a new year; the months held, for the picker', L.monthsBackFrom(Date.UTC(2026, 1, 10), 3).join(',') === '2026-02,2026-01,2025-12,2025-11' && L.monthsBackFrom(now, 0).join(',') === '2026-09' && L.monthsHeld(mails, null).join(',') === '2027-01' && L.monthsHeld(mails, T0 + 9999 * DAY).length === 0);

// ---- v0.212.0: what is held, month by month. now = 20 Sep 2026; June and July read whole, August only partly, nothing of May
const cells = L.coverageCells({ counts: new Map([['2026-09', 109], ['2026-08', 40], ['2026-07', 160], ['2026-06', 186]]), whole: ['2026-06', '2026-07'], completeSince: Date.UTC(2026, 8, 15), now, monthsBack: 4, reading: null, view: { since: Date.UTC(2026, 6, 10), until: Date.UTC(2026, 7, 5) } });
check('G1 the coverage strip, oldest first: May nothing · June whole · July whole · August PARTIAL (held, but not known to be all of it) · September current', cells.map((c) => `${c.ym.slice(5)}:${c.state}:${c.mails}`).join(' ') === '05:none:0 06:whole:186 07:whole:160 08:partial:40 09:current:109');
check('G2 a view from 10 July to 4 August touches July and August only — and is NOT complete, because August is partial', cells.filter((c) => c.inView).map((c) => c.ym).join(',') === '2026-07,2026-08' && L.viewIsComplete(cells) === false);
const c2 = L.coverageCells({ counts: new Map([['2026-09', 109], ['2026-08', 130]]), whole: [], completeSince: Date.UTC(2026, 7, 1), now, monthsBack: 2, reading: '2026-07', view: { since: Date.UTC(2026, 7, 1), until: null } });
check('G3 complete since 1 August makes August WHOLE even though no history read marked it; July is being read; an open-ended view from 1 August covers August and September and IS complete', c2.map((c) => c.state).join(',') === 'reading,whole,current' && c2.filter((c) => c.inView).map((c) => c.ym).join(',') === '2026-08,2026-09' && L.viewIsComplete(c2) === true);

const R = now - 2 * DAY;   // the newest lists reach back two days
check('G4 completeness is a chain: lists reaching back 2 days + this month read 1 day ago (the lists reach past that) + August, July, June whole → complete from 1 June', L.heldFloor({ now, recentFloor: R, curYm: '2026-09', curReadAt: now - DAY, whole: ['2026-06', '2026-07', '2026-08'] }) === Date.UTC(2026, 5, 1));
check('G5 a missing link ends it: July not whole → complete from 1 August, however many older months are held', L.heldFloor({ now, recentFloor: R, curYm: '2026-09', curReadAt: now - DAY, whole: ['2026-05', '2026-06', '2026-08'] }) === Date.UTC(2026, 7, 1));
check('G6 this month read 5 days ago but the lists only reach back 2: kills in between are missing → complete only from the lists; the same when the month on record is last month', L.heldFloor({ now, recentFloor: R, curYm: '2026-09', curReadAt: now - 5 * DAY, whole: ['2026-08'] }) === R && L.heldFloor({ now, recentFloor: R, curYm: '2026-08', curReadAt: now - DAY, whole: ['2026-07'] }) === R);
check('G7 a list that was not full is everything zKillboard has (0); nothing read yet → nothing claimed', L.heldFloor({ now, recentFloor: 0, curYm: null, curReadAt: null, whole: [] }) === 0 && L.heldFloor({ now, recentFloor: null, curYm: '2026-09', curReadAt: now, whole: ['2026-08'] }) === null);

console.log(`leaderboard.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
