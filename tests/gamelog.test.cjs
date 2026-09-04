// v0.118.0 — EVE GAME LOG PARSING. Every input below is a VERBATIM line
// from the owner's real Gamelogs (sampled 2026-08-20, mid-PvP with URSA.),
// spaces and stray markup included — the parser is tested against what the
// client actually writes, not what documentation claims it writes.

const { parseGameLogLine, parseGameLogHeader, stripMarkup } =
  require('./sim/lib/gamelogParse.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};

// ---- G1: outgoing damage (artillery, player target with corp+ship tag) ----
{
  const raw = '[ 2026.08.21 01:16:21 ] (combat) <color=0xff00ffff><b>689</b> <color=0x77ffffff><font size=10>to</font> <b><color=0xffffffff>Will Arts[URSA.](Orthrus)</b><font size=10><color=0x77ffffff> - 1400mm Howitzer Artillery II - Grazes';
  const e = parseGameLogLine(raw);
  eq('G1 outgoing damage parses whole', e, {
    t: Date.UTC(2026, 7, 21, 1, 16, 21), kind: 'dmgOut', amount: 689,
    entity: 'Will Arts[URSA.](Orthrus)', weapon: '1400mm Howitzer Artillery II', quality: 'Grazes',
  });
}

// ---- G2: incoming damage, weapon name containing hyphens (SD-300-I) ----
{
  const raw = '[ 2026.08.21 01:22:28 ] (combat) <color=0xffcc0000><b>12</b> <color=0x77ffffff><font size=10>from</font> <b><color=0xffffffff>Orco Manic[URSA.](Vedmak)</b><font size=10><color=0x77ffffff> - Stigmella SD-300-I - Penetrates';
  const e = parseGameLogLine(raw);
  eq('G2 incoming damage, hyphenated weapon survives the split', e, {
    t: Date.UTC(2026, 7, 21, 1, 22, 28), kind: 'dmgIn', amount: 12,
    entity: 'Orco Manic[URSA.](Vedmak)', weapon: 'Stigmella SD-300-I', quality: 'Penetrates',
  });
}

// ---- G3: two-word quality ("Glances Off") ----
{
  const raw = '[ 2026.08.21 01:22:28 ] (combat) <color=0xffcc0000><b>7</b> <color=0x77ffffff><font size=10>from</font> <b><color=0xffffffff>Orco Manic[URSA.](Vedmak)</b><font size=10><color=0x77ffffff> - Stigmella SD-300-I - Glances Off';
  const e = parseGameLogLine(raw);
  eq('G3 two-word quality', [e.quality, e.amount], ['Glances Off', 7]);
}

// ---- G4: the group miss — the client writes it with NO markup at all ----
{
  const raw = '[ 2026.08.21 01:20:40 ] (combat) Your group of 1400mm Howitzer Artillery II misses Michael Marsh completely - 1400mm Howitzer Artillery II';
  const e = parseGameLogLine(raw);
  eq('G4 grouped miss (plain text)', [e.kind, e.entity, e.weapon],
    ['missOut', 'Michael Marsh', '1400mm Howitzer Artillery II']);
}

// ---- G5: energy neutralized (outgoing — no "by"), corp ticker inline ----
{
  const raw = '[ 2026.08.20 17:26:55 ] (combat) <color=0xffe57f7f><b>50 GJ</b><color=0x77ffffff><font size=10> energy neutralized </font><b><color=0xffffffff><font size=12><color=0xFFFF5900><b>Exequror Navy Issue</b></color></font> <font size=10><color=0xFF7FFF1F><b>ASOFC</b> </color></font></b><color=0x77ffffff><font size=10> - Small Infectious Scoped Energy Neutralizer</font>';
  const e = parseGameLogLine(raw);
  eq('G5 neut out: GJ + target + module', [e.kind, e.amount, e.entity, e.weapon],
    ['neutOut', 50, 'Exequror Navy Issue ASOFC', 'Small Infectious Scoped Energy Neutralizer']);
}

// ---- G6: remote shield boost received (a 0-amount cycle still counts) ----
{
  const raw = '[ 2026.08.21 01:21:04 ] (combat) <color=0xffccff66><b>0</b><color=0x77ffffff><font size=10> remote shield boosted by </font><b><color=0xffffffff><font size=12><color=0xFFFF5900><b>Tengu</b></color></font> </b><color=0x77ffffff><font size=10> - Gistum C-Type Medium Remote Shield Booster</font>';
  const e = parseGameLogLine(raw);
  eq('G6 remote rep received', [e.kind, e.amount, e.entity, e.weapon],
    ['repIn', 0, 'Tengu', 'Gistum C-Type Medium Remote Shield Booster']);
}

// ---- G7: warp disruption attempt → ewar with clean text ----
{
  const raw = '[ 2026.08.21 01:17:35 ] (combat) <color=0xffffffff><b>Warp disruption attempt</b> <color=0x77ffffff><font size=10>from</font> <color=0xffffffff><b><font size=12><color=0xFFFF5900><b>Osprey Navy Issue</b></color></font> </b> <color=0x77ffffff><font size=10>to <b><color=0xffffffff></font><font size=12><color=0xFFFF5900><b>Naga</b></color></font> ';
  const e = parseGameLogLine(raw);
  eq('G7 warp disruption is ewar with readable text', [e.kind, e.text],
    ['ewar', 'Warp disruption attempt from Osprey Navy Issue to Naga']);
}

// ---- G8: hints and other non-combat categories are NOT activity ----
{
  eq('G8 hint lines are null', parseGameLogLine(
    '[ 2026.08.20 16:46:20 ] (hint) Attempting to join a channel'), null);
}

// ---- G9: the session header block ----
{
  const head = [
    '------------------------------------------------------------',
    '  Gamelog',
    '  Listener: Charles Charlington',
    '  Session Started: 2026.08.20 16:46:17',
    '------------------------------------------------------------',
  ].join('\n');
  eq('G9 header: listener + session start', parseGameLogHeader(head),
    { listener: 'Charles Charlington', sessionStart: '2026.08.20 16:46:17' });
}

// ---- G10: markup stripping collapses the client's spacing ----
{
  eq('G10 stripMarkup', stripMarkup('<b>a</b>  <font size=10> b </font>c'), 'a b c');
}

// ---- G11: engagement clustering (v0.119.1 — the fight chips) ----
{
  const { engagements } = require('./sim/lib/gamelogParse.js');
  const dmg = (t, kind) => ({ t: t * 1000, kind, amount: 100 });
  const ev = [
    // fight 1: three damage events inside 20 s
    dmg(0, 'dmgOut'), dmg(10, 'dmgIn'), dmg(20, 'dmgOut'),
    // noise: ewar mid-gap must neither split nor extend anything
    { t: 300_000, kind: 'ewar', text: 'x' },
    // two lonely events 10 min later — below the 3-event floor, dropped
    dmg(620, 'dmgOut'), dmg(630, 'dmgOut'),
    // fight 2: four events starting 10 min after those
    dmg(1240, 'dmgIn'), dmg(1250, 'dmgIn'), dmg(1260, 'dmgOut'), dmg(1270, 'dmgOut'),
  ];
  eq('G11 engagements: cluster, drop noise, keep order', engagements(ev), [
    { t0: 0, t1: 20_000, n: 3 },
    { t0: 1_240_000, t1: 1_270_000, n: 4 },
  ]);
}

// ---- G12: non-combat activity (mining, bounty, ECM) — real formats ----
{
  const mine = parseGameLogLine('[ 2026.07.25 18:39:53 ] (mining) <color=0x77ffffff>You mined <font size=12><color=#ff8dc169>125<color=0x77ffffff><font size=10> units of <color=0xffffffff><font size=12>Gneiss IV-Grade');
  eq('G12a mining yield', [mine.kind, mine.amount, mine.ore], ['mine', 125, 'Gneiss IV-Grade']);
  const resid = parseGameLogLine('[ 2026.07.25 18:39:53 ] (mining) <color=0x77ffffff>Additional 125 units depleted from asteroid as residue');
  // v0.162: residue is a first-class kind now (shown as waste, still never
  // added to yield — G15a proves the totals keep it separate)
  eq('G12b residue parses as its own kind', [resid.kind, resid.amount], ['residue', 125]);
  const bty = parseGameLogLine('[ 2026.08.08 03:19:50 ] (bounty) <font size=12><b><color=0xff00aa00>23,500 ISK</b><color=0x77ffffff> added to next bounty payout (payment adjusted)');
  eq('G12c bounty ISK, comma stripped', [bty.kind, bty.isk], ['bounty', 23500]);
  const jam = parseGameLogLine('[ 2026.08.10 01:00:00 ] (combat) <color=0xffffffff>Basilisk // Bjorn Skjeggestad<color=0x77ffffff> jammed - Ladar ECM II');
  eq('G12d ECM jam ON you', [jam.kind, jam.entity, jam.weapon], ['jammed', 'Basilisk · Bjorn Skjeggestad', 'Ladar ECM II']);
  const repOut = parseGameLogLine('[ 2026.07.26 05:43:08 ] (combat) 0 remote armor repaired to Leshak // Gator Gatington  - Large Remote Armor Repairer II');
  eq('G12e rep OUT ship-pilot entity', [repOut.kind, repOut.entity], ['repOut', 'Leshak · Gator Gatington']);
  const q = parseGameLogLine('[ 2026.08.20 12:00:00 ] (question) Are you sure?');
  eq('G12f question category ignored', q, null);
}

// ---- G13: reship markers from notify/None (undock/disembark/clone jump) ----
{
  const dis = parseGameLogLine('[ 2026.07.26 01:02:26 ] (notify) Disembarking from ship');
  eq('G13a disembark -> reship', [dis.kind, dis.text], ['reship', 'left ship (reshipping)']);
  const cj = parseGameLogLine('[ 2026.07.26 01:02:26 ] (notify) Starting clone jumping');
  eq('G13b clone jump -> reship', [cj.kind, cj.text], ['reship', 'clone jump']);
  const ud = parseGameLogLine('[ 2026.07.25 18:27:31 ] (None) Undocking from Jita IV - Moon 4 - Caldari Navy Assembly Plant to Jita solar system.');
  eq('G13c undock names the station', [ud.kind, ud.text], ['reship', 'undocked from Jita IV - Moon 4 - Caldari Navy Assembly Plant']);
  const chatter = parseGameLogLine('[ 2026.07.26 01:02:26 ] (notify) Your Mining Foreman Burst II has applied bonuses');
  eq('G13d other notify chatter is still ignored', chatter, null);
}

// ---- G14: the three (mining) line shapes — VERBATIM from the owner's
// 2026-08-28 session files, markup included (measured, not guessed) ----
{
  const { miningStats } = require('./sim/lib/gamelogParse.js');
  const y = parseGameLogLine('[ 2026.08.28 03:06:34 ] (mining) <color=0x77ffffff>You mined <font size=12><color=#ff8dc169>137<color=0x77ffffff><font size=10> units of <color=0xffffffff><font size=12>Gneiss IV-Grade');
  eq('G14a plain yield', y, { t: Date.UTC(2026, 7, 28, 3, 6, 34), kind: 'mine', amount: 137, ore: 'Gneiss IV-Grade' });
  const c = parseGameLogLine('[ 2026.08.28 03:07:16 ] (mining) <color=#fff0ff45>Critical mining success!<color=0x77ffffff><font size=10> You mined an additional <color=#fff0ff45><font size=12>411<color=0x77ffffff><font size=10> units of <color=0xffffffff><font size=12>Gneiss IV-Grade');
  eq('G14b critical success', c, { t: Date.UTC(2026, 7, 28, 3, 7, 16), kind: 'mineCrit', amount: 411, ore: 'Gneiss IV-Grade' });
  const r = parseGameLogLine('[ 2026.08.28 03:07:01 ] (mining) <color=0x77ffffff>Additional <font size=12><color=#ffff454b>137<color=0x77ffffff><font size=10> units depleted from asteroid as residue');
  eq('G14c residue (no ore in the line)', r, { t: Date.UTC(2026, 7, 28, 3, 7, 1), kind: 'residue', amount: 137 });

  // ---- G15: miningStats, HAND-COMPUTED ----
  // events: mine 137 Gneiss @t=1s · residue 137 @t=1s (same tick → Gneiss)
  //         mine 20 C72 @t=16s · crit 411 Gneiss @t=16s
  //         residue 21 @t=16.5s (nearest mine = C72 at 0.5s away)
  //         residue 5 @t=99999s (no mine within 5s → unattributed)
  const ev = [
    { t: 1000, kind: 'mine', amount: 137, ore: 'Gneiss IV-Grade' },
    { t: 1000, kind: 'residue', amount: 137 },
    { t: 16000, kind: 'mine', amount: 20, ore: 'Fullerite-C72' },
    { t: 16000, kind: 'mineCrit', amount: 411, ore: 'Gneiss IV-Grade' },
    { t: 16500, kind: 'residue', amount: 21 },
    { t: 99999000, kind: 'residue', amount: 5 },
  ];
  const s = miningStats(ev);
  eq('G15a totals: normal 137+20, crit 411, total 568, residue 163',
    [s.normal, s.crit, s.total, s.residue, s.cycles, s.critCycles],
    [157, 411, 568, 163, 2, 1]);
  eq('G15b byOre order + attribution', s.byOre, [
    ['Gneiss IV-Grade', { normal: 137, crit: 411, residue: 137, cycles: 1, critCycles: 1 }],
    ['Fullerite-C72', { normal: 20, crit: 0, residue: 21, cycles: 1, critCycles: 0 }],
    ['(unattributed)', { normal: 0, crit: 0, residue: 5, cycles: 0, critCycles: 0 }],
  ]);

  // ---- G15c: MULTI-CHARACTER attribution — two alts on the SAME tick.
  // Char A mines Veldspar and char B mines Scordite at t=1000; char B's
  // residue at t=1000 must go to SCORDITE (its own log), never to A's ore,
  // even though A's mine event is equally close in time. ----
  const ev2 = [
    { t: 1000, kind: 'mine', amount: 100, ore: 'Veldspar', ck: '#111' },
    { t: 1000, kind: 'mine', amount: 50, ore: 'Scordite', ck: '#222' },
    { t: 1000, kind: 'residue', amount: 50, ck: '#222' },
    { t: 1000, kind: 'residue', amount: 100, ck: '#111' },
  ];
  const s2 = miningStats(ev2);
  eq('G15c residue stays inside its own character\'s log',
    s2.byOre.map(([ore, o]) => [ore, o.residue]),
    [['Veldspar', 100], ['Scordite', 50]]);
}

console.log(`\ngamelog.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
