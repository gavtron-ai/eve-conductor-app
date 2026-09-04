// battleNarrative: the fight digest and its phase splitter (v0.100.0).
//
// Every expectation below is HAND-COMPUTED from the declared rules:
//   - a >= 10 min lull between killmails splits phases (PHASE_GAP_MINUTES)
//   - a flip of who-is-dying splits only when it sustains 3 consecutive
//     killmails (PHASE_FLIP_SUSTAIN) and never right at the list's end
//   - more than 4 phases collapse: smallest-ISK phase folds into the
//     neighbour closest in time (prev wins ties)
//   - pods (type 670 / 33328) count separately from ships
//   - fmtIsk: >=1e9 -> x.xxb, >=1e6 -> round m, else round k
// ESI name resolution is mocked: every id resolves to "E<id>".
const path = require('path');
const nar = require('./sim/lib/battleNarrative.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};
const ok = (l, b) => eq(l, Boolean(b), true);

// names come back "E<id>" — deterministic, no network
global.fetch = async (_url, opts) => ({
  ok: true,
  json: async () => JSON.parse(opts.body).map((id) => ({ id, name: `E${id}` })),
});

const T0 = Date.UTC(2026, 0, 15, 12, 0, 0); // 2026-01-15T12:00:00Z
const min = (m, s = 0) => T0 + (m * 60 + s) * 1000;
let nextId = 1;
/** side 'T' = their victim (ally 200), 'O' = our victim (ally 100, corp 55) */
const km = (tMs, side, over = {}) => ({
  id: nextId++,
  time: tMs,
  system: over.system ?? 900,
  victim: side === 'T'
    ? { ally: 200, corp: 201, char: 21, ship: over.ship ?? 24692, lossValue: over.isk ?? 50e6 }
    : { ally: 100, corp: 55, char: over.char ?? 12, ship: over.ship ?? 605, lossValue: over.isk ?? 50e6 },
  attackers: side === 'T'
    ? [{ ally: 100, corp: 55, char: over.att ?? 11, ship: 17715 }]
    : [{ ally: 200, corp: 201, char: 22, ship: 17738 }],
});
const fd = (kms) => ({ kms, teams: [[100], [200]], myEntity: 100 });
const digest = (kms) => nar.buildFightDigest(fd(kms), 55);

(async () => {
  // ---- N1: the 10-minute lull splits, a 5-minute one does not ----
  // kills at 12:00, 12:05 (gap 5m — together), 12:15:30 (gap 10m30s — split)
  let d = await digest([km(min(0), 'T'), km(min(5), 'T'), km(min(15, 30), 'T')]);
  eq('N1 phase count', d.phases.length, 2);
  eq('N1 boundary', [d.phases[0].end, d.phases[1].start], ['12:05', '12:15']);

  // ---- N2a: a SUSTAINED flip (3 our losses) splits ----
  // victims T T T O O O one minute apart -> flip at km 4 sustains 3 mails
  d = await digest([km(min(0), 'T'), km(min(1), 'T'), km(min(2), 'T'),
    km(min(3), 'O'), km(min(4), 'O'), km(min(5), 'O')]);
  eq('N2a sustained flip splits', d.phases.length, 2);
  eq('N2a split point', d.phases[1].start, '12:03');
  // ---- N2b: a 2-mail blip does NOT split (third mail flips back) ----
  d = await digest([km(min(0), 'T'), km(min(1), 'T'), km(min(2), 'T'),
    km(min(3), 'O'), km(min(4), 'O'), km(min(5), 'T')]);
  eq('N2b blip does not split', d.phases.length, 1);
  // ---- N2c: a flip in the last 2 mails has nothing to sustain it ----
  d = await digest([km(min(0), 'T'), km(min(1), 'T'), km(min(2), 'T'),
    km(min(3), 'T'), km(min(4), 'O'), km(min(5), 'O')]);
  eq('N2c end-of-list flip does not split', d.phases.length, 1);

  // ---- N3: 5 gap-split phases collapse to 4, smallest into nearest ----
  // P0@12:00 (1000m), P1@12:10 (10m), P2@12:30 (500m), P3@12:40 (300m),
  // P4@12:50 (200m). Smallest is P1; prev gap 10m <= next gap 20m, so P1
  // folds into P0. Survivors: [P0+P1], P2, P3, P4.
  d = await digest([
    km(min(0), 'T', { isk: 1000e6 }), km(min(10), 'T', { isk: 10e6 }),
    km(min(30), 'T', { isk: 500e6 }), km(min(40), 'T', { isk: 300e6 }),
    km(min(50), 'T', { isk: 200e6 }),
  ]);
  eq('N3 collapsed to max', d.phases.length, 4);
  eq('N3 P1 folded into P0', [d.phases[0].start, d.phases[0].end], ['12:00', '12:10']);
  eq('N3 P0 keeps both kills', d.phases[0].theirsLost.ships, 2);
  eq('N3 P2 untouched', d.phases[1].start, '12:30');

  // ---- N4: digest arithmetic on a hand-summed 3-mail fight ----
  // A 12:00 theirs Abaddon-24692 1,866,000,000 in sys 900
  // B 12:01 theirs pod-670           10,000 in sys 900
  // C 12:02 ours   605          570,000,000 in sys 901
  // totals: 2,436,010,000 -> "2.44b"; theirs 1,866,010,000 -> "1.87b";
  // ours 570,000,000 -> "570m"; T T O with the O unsustained -> one phase
  d = await digest([
    km(min(0), 'T', { isk: 1866e6 }),
    km(min(1), 'T', { ship: 670, isk: 10e3 }),
    km(min(2), 'O', { isk: 570e6, system: 901 }),
  ]);
  eq('N4 one phase', d.phases.length, 1);
  eq('N4 total kills', d.fight.totalKills, 3);
  eq('N4 total lost', d.fight.totalLost, '2.44b');
  eq('N4 duration', d.fight.durationMin, 2);
  eq('N4 systems in order', d.fight.systems, ['E900', 'E901']);
  eq('N4 their losses', [d.theirs.shipsLost, d.theirs.podsLost, d.theirs.iskLost], [1, 1, '1.87b']);
  eq('N4 our losses', [d.ours.shipsLost, d.ours.podsLost, d.ours.iskLost], [1, 0, '570m']);
  eq('N4 pilots per side', [d.ours.pilots, d.theirs.pilots], [2, 2]);
  eq('N4 lead groups', [d.ours.leadGroups, d.theirs.leadGroups], [['E100'], ['E200']]);
  eq('N4 my corp', d.ours.myCorp, { name: 'E55', pilotCount: 2, pilots: ['E11', 'E12'] });
  // notable: the 10k pod is under the 100m floor; sorted by value desc
  eq('N4 notables', d.phases[0].notable.map((x) => [x.ship, x.value, x.side]),
    [['E24692', '1.87b', 'theirs'], ['E605', '570m', 'ours']]);
  const t = nar.templateWriteup(d);
  ok('N4 template names the loss trade', t.includes('they lost 1 ship and 1 pod (1.87b)')
    && t.includes('we lost 1 ship (570m)'));

  // ---- N5: the corp pilot list caps at 4 names but keeps the count ----
  d = await digest([11, 12, 13, 14, 15].map((c, i) => km(min(i), 'T', { att: c })));
  eq('N5 cap', [d.ours.myCorp.pilotCount, d.ours.myCorp.pilots.length], [5, 4]);
  ok('N5 template says count not names', nar.templateWriteup(d).includes('5 E55 pilots in fleet'));

  // ===================================================================
  // v0.100.0 review fixes — each pins a defect an adversarial reviewer
  // confirmed against the first cut of this file.
  // ===================================================================

  // ---- N6: a lone whored blip mid-fight must NOT split the phase ----
  // T T T O T T T at 1-min spacing. The O fails the 3-mail sustain test;
  // the T after it used to count as a flip away from the O and split there.
  // Measuring the flip against the PHASE's side (theirs) keeps it whole.
  d = await digest(['T', 'T', 'T', 'O', 'T', 'T', 'T'].map((s, i) => km(min(i), s)));
  eq('N6 lone blip keeps one phase', d.phases.length, 1);
  eq('N6 the blip is still counted', [d.phases[0].theirsLost.ships, d.phases[0].oursLost.ships], [6, 1]);
  // a 2-mail blip (still under the 3-mail sustain rule) also holds
  d = await digest(['T', 'T', 'T', 'O', 'O', 'T', 'T', 'T'].map((s, i) => km(min(i), s)));
  eq('N6 two-mail blip keeps one phase', d.phases.length, 1);
  // ...but a real 3-mail turnaround still splits (N2a's rule survives)
  d = await digest(['T', 'T', 'T', 'O', 'O', 'O', 'O'].map((s, i) => km(min(i), s)));
  eq('N6 real turnaround still splits', d.phases.length, 2);

  // ---- N7: the digest is clamped to the FIGHT, not the padded window ----
  // br.evetools is asked for ±15 min around the fight, so an unrelated gank
  // 12 min before it comes back in the same response. Fight span 12:00-12:20.
  // Fight span 12:00-12:10, three kills 5 min apart (one phase); the gank
  // 12 min earlier is inside the padded analyze window but not the fight,
  // and its 12-min lead-in would have opened a phantom phase of its own.
  const span = { startMs: min(0), endMs: min(10) };
  const withGank = [km(min(-12), 'T', { isk: 900e6 }), km(min(0), 'T'), km(min(5), 'T'), km(min(10), 'T')];
  d = await nar.buildFightDigest(fd(withGank), 55, span);
  eq('N7 the bystander gank is excluded', d.fight.totalKills, 3);
  eq('N7 the fight starts when the fight started', d.fight.start, '12:00');
  eq('N7 duration is the fight, not the window', d.fight.durationMin, 10);
  eq('N7 no phantom phase', d.phases.length, 1);
  eq('N7 its ISK is not credited to us', d.fight.totalLost, '150m');
  // unclamped, the same input reproduces the defect — proof the span is what fixed it
  d = await nar.buildFightDigest(fd(withGank), 55);
  eq('N7 (control) unclamped shows the old numbers',
    [d.fight.start, d.fight.totalKills, d.phases.length, d.fight.totalLost], ['11:48', 4, 2, '1.05b']);

  // ---- N7b: the fight is a CLUSTER, not the corp's own killmail span ----
  // Our corp's mails run 12:00-12:10, but the fight opened at 11:56 and its
  // last kill landed 12:14 — all contiguous (<=10 min apart), all the same
  // fight. Clamping hard to the corp span amputated both ends on a real
  // 88-killmail roam and made the write-up disagree with its own BR link.
  d = await nar.buildFightDigest(fd([
    km(min(-4), 'T'), km(min(0), 'T'), km(min(10), 'T'), km(min(14), 'T'),
  ]), 55, span);
  eq('N7b contiguous stragglers on both ends are kept', d.fight.totalKills, 4);
  eq('N7b the fight starts when the FIGHT started', [d.fight.start, d.fight.end], ['11:56', '12:14']);
  // ...but a gap on the far side still ends it: 12:10 -> 12:25 is 15 min
  d = await nar.buildFightDigest(fd([
    km(min(0), 'T'), km(min(10), 'T'), km(min(25), 'T'),
  ]), 55, span);
  eq('N7b a later, separate fight is still excluded',
    [d.fight.totalKills, d.fight.end], [2, '12:10']);

  // ---- N8: a killmail with no usable time is dropped, never narrated ----
  // time 0 sorts first and used to date the whole write-up to 1970-01-01
  d = await nar.buildFightDigest(fd([
    { ...km(min(1), 'T'), time: 0 }, km(min(2), 'T'), km(min(3), 'T'),
  ]), 55);
  eq('N8 the 1970 killmail is gone', [d.fight.date, d.fight.start], ['2026-01-15', '12:02']);
  eq('N8 duration is sane', d.fight.durationMin, 1);
  // and if NOTHING has a usable time there is no honest write-up to give
  let threw = '';
  try {
    await nar.buildFightDigest(fd([{ ...km(min(1), 'T'), time: 0 }]), 55);
  } catch (e) { threw = e.message; }
  ok('N8 an all-untimed fight refuses rather than invents', /usable time/.test(threw));

  // ---- N9: fmtIsk picks its tier AFTER rounding ----
  // 999,999,999 rounded at the m tier is 1000m, which must read 1.00b
  d = await digest([km(min(0), 'T', { isk: 999999999 })]);
  eq('N9 999.999m reads as b', d.fight.totalLost, '1.00b');
  d = await digest([km(min(0), 'T', { isk: 999500000 })]);
  eq('N9 the boundary case too', d.fight.totalLost, '1.00b');
  d = await digest([km(min(0), 'T', { isk: 999499999 })]);
  eq('N9 just below stays m', d.fight.totalLost, '999m');

  // ---- N10: singular grammar on a one-of-everything fight ----
  d = await digest([km(min(0), 'T')]);
  const t1 = nar.templateWriteup(d);
  ok('N10 "1 killmail" not "1 killmails"', /\b1 killmail,/.test(t1) && !/1 killmails/.test(t1));
  ok('N10 "1 pilot" not "1 pilots"', /\(1 pilot\)/.test(t1) && !/1 pilots/.test(t1));

  // ---- N11: unpriced mails make ISK totals a FLOOR, marked '≥' ----
  // A mail arriving via a character's live ESI feed has no zkb price yet
  // (lossValue 0). Presenting the sum without a marker would undercount
  // the fight as if it were exact.
  d = await digest([km(min(0), 'T', { isk: 100e6 }), km(min(1), 'T', { isk: 0 })]);
  eq('N11 total is a floor', d.fight.totalLost, '≥100m');
  eq('N11 side total too', d.theirs.iskLost, '≥100m');
  // fully priced fights stay exact — no stray prefix
  d = await digest([km(min(0), 'T', { isk: 100e6 })]);
  eq('N11 priced fights stay exact', d.fight.totalLost, '100m');

  // ---- N12: the killboard view — loss rows, credits, leaderboards (v0.105.0) ----
  // One enemy loss: our pilots 11 (4200 dmg) and 13 (800 dmg, final blow).
  // One of ours lost: their pilot 21 (2000 dmg, final blow).
  // Hand-computed: our leaderboard = 11 (4200), 13 (800, 1 fb);
  // theirs = 21 (2000, 1 fb). Efficiency: we lost 50m, destroyed 200m
  // -> ours 80%, theirs 20%.
  const kmsN12 = [
    { id: 1, time: min(0), system: 900,
      victim: { ally: 200, corp: 201, char: 21, ship: 24692, dmg: 5000, lossValue: 200e6 },
      attackers: [
        { ally: 100, corp: 55, char: 11, ship: 17715, dmg: 4200, fb: false },
        { ally: 100, corp: 55, char: 13, ship: 602, dmg: 800, fb: true },
      ] },
    { id: 2, time: min(1), system: 900,
      victim: { ally: 100, corp: 55, char: 12, ship: 605, dmg: 2000, lossValue: 50e6 },
      attackers: [{ ally: 200, corp: 201, char: 21, ship: 17738, dmg: 2000, fb: true }] },
  ];
  d = await nar.buildFightDigest(fd(kmsN12), 55);
  eq('N12 efficiency', [d.ours.efficiency, d.theirs.efficiency], [80, 20]);
  eq('N12 isk numbers', [d.ours.iskLostNum, d.ours.iskDestroyedNum], [50e6, 200e6]);
  eq('N12 our leaderboard', d.ours.dmgLeaders.map((l) => [l.name, l.dmg, l.finalBlows]),
    [['E11', 4200, 0], ['E13', 800, 1]]);
  eq('N12 their leaderboard', d.theirs.dmgLeaders.map((l) => [l.name, l.dmg, l.finalBlows]),
    [['E21', 2000, 1]]);
  eq('N12 their loss row credits', [
    d.theirs.losses[0].ship, d.theirs.losses[0].pilot, d.theirs.losses[0].isk,
    d.theirs.losses[0].topDmg.name, d.theirs.losses[0].finalBlow.name,
  ], ['E24692', 'E21', '200m', 'E11', 'E13']);
  eq('N12 our loss row credits', [
    d.ours.losses[0].pilot, d.ours.losses[0].topDmg.name, d.ours.losses[0].finalBlow.name,
  ], ['E12', 'E21', 'E21']);
  // analyze-sourced mails have no fb flag: finalBlow must be ABSENT, not wrong
  d = await nar.buildFightDigest(fd([{ id: 3, time: min(0), system: 900,
    victim: { ally: 200, corp: 201, char: 21, ship: 24692, dmg: 100, lossValue: 10e6 },
    attackers: [{ ally: 100, corp: 55, char: 11, ship: 17715, dmg: 100 }] }]), 55);
  eq('N12 no fb flag -> no final blow claim',
    [d.theirs.losses[0].finalBlow, d.theirs.losses[0].topDmg.name], [undefined, 'E11']);

  // ---- N13: the org tree — corps under their alliance umbrella (v0.106.0) ----
  // Our side: alliance 100 with corps 55 (pilots 11,13) and 56 (pilot 14),
  // plus unallied corp 70 (pilot 15). Their side: alliance 200, corp 201.
  // Hand-computed: ours = [ally 100 {corps 55(2), 56(1)}, ally 0 {corp 70(1)}],
  // sorted by pilots; corp 55 before 56 within the umbrella.
  const kmsN13 = [
    { id: 10, time: min(0), system: 900,
      victim: { ally: 200, corp: 201, char: 21, ship: 24692, dmg: 100, lossValue: 10e6 },
      attackers: [
        { ally: 100, corp: 55, char: 11, ship: 1, dmg: 50 },
        { ally: 100, corp: 55, char: 13, ship: 1, dmg: 30 },
        { ally: 100, corp: 56, char: 14, ship: 1, dmg: 10 },
        { ally: 0, corp: 70, char: 15, ship: 1, dmg: 5 },
      ] },
  ];
  d = await nar.buildFightDigest({ kms: kmsN13, teams: [[100, 70], [200]], myEntity: 100 }, 55);
  eq('N13 org tree', d.ours.orgs.map((o) => [o.allyId, o.allyName, o.pilots,
    o.corps.map((c) => [c.id, c.name, c.pilots])]),
  [
    [100, 'E100', 3, [[55, 'E55', 2], [56, 'E56', 1]]],
    [0, null, 1, [[70, 'E70', 1]]],
  ]);
  eq('N13 their org tree', d.theirs.orgs.map((o) => [o.allyId, o.pilots]), [[200, 1]]);
  eq('N13 loss row carries killmail id', d.theirs.losses[0].killmailId, 10);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
