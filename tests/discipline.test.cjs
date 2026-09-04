// v0.110.0 — INJECT REPPING: the human tank discipline as a per-ship flag.
// Every expected value below was hand-traced through the declared phase
// order (LAND 6 < REP_END 7 < REP_START 8; discipline wakes push into
// REP_START) before the code ran.
//
// The discipline (community-verified: shield boosters heal at cycle START
// so waiting is free; passive shield regen peaks at 25%; guides hold reps
// to ~25–33%; sticks must land whole):
//   D1  shield reps HELD until the 30% band, hysteresis off at 55%,
//       no cycle whose heal would overflow — vs the greedy free-runner
//   D2  armour reps: no band (end-timing heal — waiting low is suicide),
//       but never a wasted cycle
//   D3  the Phoenix miniature: identical fit, identical attacker — the
//       greedy AI wastes a stick into a full capacitor and overheals, and
//       DIES; the disciplined pilot converts every GJ to landed heals and
//       LIVES

const { simulateBattleEvents, DISC_REP_ON_FRAC, DISC_REP_OFF_FRAC } =
  require('./sim/lib/battleEvents.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};
const close = (l, g, w, tol) => {
  const ok = g !== null && g !== undefined && Math.abs(g - w) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `   got=${g} want=${w}`}`);
  ok ? pass++ : fail++;
};

const NO_RES = { em: 1, thermal: 1, kinetic: 1, explosive: 1 };
const DEAD_CAP = { capacity: 1e9, tau: 1e12 };

const gun = (dmg, cycle, extra = {}) => ({
  typeId: 1, kind: 'untracked', capPerCycle: 0,
  volley: { em: dmg, thermal: 0, kinetic: 0, explosive: 0 },
  cycleSeconds: cycle, ...extra,
});

const ship = (id, side, o = {}) => ({
  id, name: id, side,
  weapons: o.weapons ?? [],
  repairs: o.repairs ?? [],
  capBoosters: o.capBoosters,
  capBoosterReserve: o.capBoosterReserve,
  injectDiscipline: o.injectDiscipline,
  capacitor: o.capacitor ?? DEAD_CAP,
  layers: o.layers ?? [
    { name: 'Shield', hp: o.shield ?? 0, resonance: NO_RES },
    { name: 'Armor', hp: o.armor ?? 0, resonance: NO_RES },
    { name: 'Hull', hp: o.hull ?? 0, resonance: NO_RES },
  ],
  shieldRechargeSeconds: o.shieldRechargeSeconds,
  signatureRadius: 100000,
  flying: o.flying ?? { speed: 0, angleDeg: 0 },
  range: o.range ?? 1000,
});

const rep = (kind, amount, cycle, o = {}) => ({
  typeId: 9, kind, amount, cycleSeconds: cycle,
  capPerCycle: o.cap ?? 0,
  timing: o.timing ?? (kind === 'shield' ? 'start' : 'end'),
  ancillary: !!o.charges,
  charges: o.charges ?? null,
  burstHps: amount / cycle,
  dutyHps: amount / cycle,
});

// sanity: the declared band the traces below assume
eq('band constants as documented', [DISC_REP_ON_FRAC, DISC_REP_OFF_FRAC], [0.30, 0.55]);

// ===========================================================================
// D1. SHIELD BAND + NO WASTE vs THE GREEDY FREE-RUNNER.
//     Victim: shield 100 / hull 10, booster 20 hp per 2 s costing 5 GJ,
//     cap 60, NO recharge, NO passive regen. Attacker: 10 dmg every 1 s,
//     14-round clip (volleys t=0..13), then silence. maxSeconds 30.
//
//     GREEDY (flag off) hand-trace — rep free-runs from t=0, volley lands
//     before same-t heal:
//       t=0  volley→90, heal +10→100 (cap 55)
//       t=2,4,..,12  two volleys down 20, heal +20 back to 100
//                    (cap 50,45,40,35,30,25 after t=2..12)
//       t=13 volley→90;  t=14 heal +10→100 (cap 20)
//       t=16,18,20,22 shield full — heal 0, cap 15,10,5,0 (WASTE)
//       t=24 cap 0 < 5 → the rep STARVES (capStarved on the timeline)
//       heals 10+6·20+10 = 140 · final shield 100 · capMin 0
//     DISCIPLINED hand-trace — held until the band. (FIRST TRACE WAS WRONG
//     here and the engine was right: t=0..6 is SEVEN volleys, so the band
//     opens at t=6, not t=7 — the whole sawtooth shifts one second early.)
//       t=0..5   rep held (band off) — after t=5's volley shield is 40
//       t=6      volley→30 = 30% → band ON, missing 70 ≥ 20 → heal→50 (cap 55)
//       t=8,10,12 two volleys→30, heal→50 (cap 50,45,40)
//       t=13     last volley → 40
//       t=14     shield 40 (in-band), missing 60 → heal→60 (cap 35)
//       t=16     frac .60 ≥ .55 → band OFF → held for good
//       heals 5·20 = 100 · final shield 60 (0.60) · capMin 35/60 · no starve
//     (`remaining` reports FRACTIONS of each layer, not hit points.)
// ===========================================================================
{
  const clip14 = () => gun(10, 1, { clip: { size: 14, perCycle: 1, reloadSeconds: 9999 } });
  const mk = (disc) => simulateBattleEvents([
    ship('A', 'a', { weapons: [clip14()], hull: 10 }),
    ship('V', 'b', {
      shield: 100, hull: 10,
      repairs: [rep('shield', 20, 2, { cap: 5 })],
      capacitor: { capacity: 60, tau: 1e12 },
      injectDiscipline: disc,
    }),
  ], { maxSeconds: 30 });

  const greedy = mk(false).ships.find((x) => x.id === 'V');
  const disc = mk(true).ships.find((x) => x.id === 'V');
  eq('D1a greedy free-run heals (incl. clamped waste)', greedy.healsApplied, 140);
  // the 1e12-τ trickle leaves a vanishing remainder, never exactly zero
  close('D1b greedy runs its capacitor to (numerically) dry', greedy.capMinFrac, 0, 1e-9);
  // 60 GJ spent to end exactly where it started — the signature greedy waste
  eq('D1c greedy ends on a FULL shield with an empty tank', greedy.remaining[0], 1);

  eq('D1d disciplined heals — every cycle lands whole', disc.healsApplied, 100);
  eq('D1e disciplined shield parks at 0.60 (band off at ≥55%)', disc.remaining[0], 0.6);
  close('D1f disciplined cap never below 35/60', disc.capMinFrac, 35 / 60, 1e-9);
  const discTl = mk(true).events.filter((e) => e.kind === 'capStarved');
  eq('D1g disciplined never starves', discTl.length, 0);
}

// ===========================================================================
// D2. ARMOUR REPS: NO BAND (end-timing heal — holding to 30% with a heal
//     that lands seconds later is how ships die), but NO WASTED CYCLE: a
//     cycle starts only once the FULL heal fits.
//     Victim: armour 100 / hull 10, repairer 30 hp per 4 s (heal at END),
//     free cap. Attacker: 10 dmg per 1 s, 5-round clip (t=0..4), silence.
//
//     DISCIPLINED: t=0 volley→90 (missing 10 < 30 → held);  t=1 →80 (20 —
//     held);  t=2 →70, missing 30 → cycle starts, heal lands t=6:
//     t=3 →60, t=4 →50, t=6 +30 → 80. Next start t=6: missing 20 → held.
//     heals 30 · final armour 80.
//     GREEDY: cycle from t=0 (full armour), heal t=4: armour 90−40+30=80?
//     trace: t=0 volley→90, cycle starts; volleys t=1..4 →50; t=4 heal
//     (end of t=0 cycle) +30 →80; next cycle t=4, heal t=8: missing 20 →
//     +20 → 100 (10 hp of the cycle WASTED); cycles keep running, heal 0.
//     heals 50 · final armour 100.
// ===========================================================================
{
  const clip5 = () => gun(10, 1, { clip: { size: 5, perCycle: 1, reloadSeconds: 9999 } });
  const mk = (disc) => simulateBattleEvents([
    ship('A', 'a', { weapons: [clip5()], hull: 10 }),
    ship('V', 'b', {
      armor: 100, hull: 10,
      repairs: [rep('armor', 30, 4)],
      injectDiscipline: disc,
    }),
  ], { maxSeconds: 30 });

  const greedy = mk(false).ships.find((x) => x.id === 'V');
  const disc = mk(true).ships.find((x) => x.id === 'V');
  eq('D2a greedy armour heals (10 hp overhealed away)', greedy.healsApplied, 50);
  eq('D2b greedy tops the armour back to full (fraction 1)', greedy.remaining[1], 1);
  eq('D2c disciplined waits for a FULL cycle to fit (one heal)', disc.healsApplied, 30);
  eq('D2d disciplined armour parks at 0.80, rep held after', disc.remaining[1], 0.8);
}

// ===========================================================================
// D3. THE PHOENIX MINIATURE — identical fit, identical attacker; only the
//     pilot differs. Victim: shield 100 / hull 10, booster 20 hp / 2 s at
//     20 GJ, capacitor 60 GJ with NO recharge, cap injector 40 GJ per
//     stick, 4 sticks carried (1 loaded + 3 cargo) = 220 GJ lifetime =
//     11 rep cycles = 220 hp of healing. Attacker: 10 dmg / 1 s, 30-round
//     clip = 300 raw damage. maxSeconds 60.
//
//     Ledger, greedy: burns stick #1 AT T=0 into a FULL capacitor — the
//     whole 40 GJ (2 cycles = 40 hp) clamps away — and overheals ~10 hp
//     more in the opening seconds: ≤ 100 + 180 − 10 = 270 hp against 300
//     incoming → the shield collapses, the 10-hp hull follows: DIES.
//     Ledger, disciplined: reps held to the 30% band, every stick lands
//     whole ONLY when the cap has room and the reps are running: full
//     100 + 220 = 320 hp against 300 → LIVES (stalemate, winner null).
// ===========================================================================
{
  const clip30 = () => gun(10, 1, { clip: { size: 30, perCycle: 1, reloadSeconds: 9999 } });
  const mk = (disc) => simulateBattleEvents([
    ship('A', 'a', { weapons: [clip30()], hull: 10 }),
    ship('V', 'b', {
      shield: 100, hull: 10,
      repairs: [rep('shield', 20, 2, { cap: 20 })],
      capacitor: { capacity: 60, tau: 1e12 },
      capBoosters: [{
        injectGj: 40, cycleSeconds: 2,
        charges: { count: 1, perCycle: 1, cycles: 1, reloadSeconds: 1 },
      }],
      capBoosterReserve: 4,
      injectDiscipline: disc,
    }),
  ], { maxSeconds: 60 });

  const g = mk(false);
  const d = mk(true);
  const gv = g.ships.find((x) => x.id === 'V');
  const dv = d.ships.find((x) => x.id === 'V');
  eq('D3a greedy pilot DIES (stick wasted at t=0 into a full cap)', gv.alive, false);
  eq('D3b greedy loss decides the fight for the attacker', g.winner, 'a');
  eq('D3c disciplined pilot LIVES on the same fit', dv.alive, true);
  eq('D3d nobody died — stalemate, not a win', d.winner, null);
  eq('D3e disciplined converted every GJ: 11 full cycles landed', dv.healsApplied, 220);
}

// ===========================================================================
// D4. DISCIPLINE × THE SHARED POOL (v0.111.0) — an ASB whose reloads eat
//     capBoosterReserve, flown both ways. Victim: shield 200 / hull 10,
//     ASB 20 hp / 2 s (2-charge magazine, 3 s reload), reserve 4 = 2
//     loaded + 2 cargo, cap-free. Attacker: 10 dmg / 1 s, 14-round clip
//     (volleys t=0..13).
//
//     DISCIPLINED: held until t=13 (volley 14 → 60 = 30%): heal→80 (1
//     left), t=15 heal→100 (0), t=17 reload (pool 2) done t=20: heal→120
//     (1 left), t=22 frac 0.60 ≥ 55% → band OFF. 3 whole heals = 60 hp,
//     shield 0.60, ONE STICK STILL BANKED in the module.
//     GREEDY: t=0 overheals (+10 of 20 — waste), t=2 +20 (0 left), t=4
//     reload done t=7: +20, t=9 +20 (0), t=11 reload: pool EMPTY → dry;
//     four volleys unanswered → shield 130 = 0.65, 70 hp healed, every
//     stick gone. (Ends HIGHER here only because the clip ran out — D3 is
//     where the waste kills; this one pins the pool/discipline interplay.)
// ===========================================================================
{
  const asb = () => rep('shield', 20, 2, {
    charges: { count: 2, perCycle: 1, cycles: 2, reloadSeconds: 3 },
  });
  const clip14 = () => gun(10, 1, { clip: { size: 14, perCycle: 1, reloadSeconds: 9999 } });
  const mk = (disc) => simulateBattleEvents([
    ship('A', 'a', { weapons: [clip14()], hull: 10 }),
    ship('V', 'b', {
      shield: 200, hull: 10, repairs: [asb()],
      capBoosterReserve: 4, injectDiscipline: disc,
    }),
  ], { maxSeconds: 40 });
  const g = mk(false).ships.find((x) => x.id === 'V');
  const d = mk(true).ships.find((x) => x.id === 'V');
  eq('D4a greedy ASB: 70 hp incl. 10 overhealed, pool emptied', g.healsApplied, 70);
  eq('D4b greedy parks at 0.65 once dry', g.remaining[0], 0.65);
  eq('D4c disciplined ASB: 3 whole heals, zero waste', d.healsApplied, 60);
  eq('D4d disciplined parks at 0.60 with a stick banked', d.remaining[0], 0.6);
}

// ===========================================================================
// D5. STICKS FIRE LOW, NEVER MERELY BECAUSE THEY FIT (v0.112.0 — the
//     owner's Phoenix caught v0.110 chain-injecting from ~90% cap: on a
//     capital capacitor "the injection fits" is true almost always, so the
//     gate now also demands cap ≤ 35%).
//     Victim: shield 200 / hull 10, rep 20 hp / 2 s at a heavy 300 GJ,
//     capacitor 1000 (no recharge), booster 350 GJ / stick, cycle 2,
//     1-per-magazine + 1 s reload, FIVE sticks carried. Attacker:
//     10 dmg / 1 s, 14-round clip (t=0..13). maxSeconds 40.
//
//     DISCIPLINED trace: reps held to the band → t=13 (60 = 30%): rep
//     spends → cap 700 (70% — stick HELD despite fitting: missing 300 <
//     350 anyway); t=15: cap 400 (40% — fits now: missing 600 ≥ 350, but
//     40% > 35% → HELD — the exact case v0.110 got wrong); t=17: cap 100
//     (10% ≤ 35% → ONE stick fires, +350 → 450); t=19: shield 120 = 60%
//     ≥ 55% → band OFF. Exactly 1 injection, at t=17, 4 sticks banked.
//     GREEDY control: the booster free-runs from t=0 against a FULL
//     capacitor — all 5 sticks burned by t=12 (t=0,3,6,9,12), the first
//     landing 0 GJ — before the tank has spent anything at all.
// ===========================================================================
{
  const clip14 = () => gun(10, 1, { clip: { size: 14, perCycle: 1, reloadSeconds: 9999 } });
  const mk = (disc) => simulateBattleEvents([
    ship('A', 'a', { weapons: [clip14()], hull: 10 }),
    ship('V', 'b', {
      shield: 200, hull: 10,
      repairs: [rep('shield', 20, 2, { cap: 300 })],
      capacitor: { capacity: 1000, tau: 1e12 },
      capBoosters: [{
        injectGj: 350, cycleSeconds: 2,
        charges: { count: 1, perCycle: 1, cycles: 1, reloadSeconds: 1 },
      }],
      capBoosterReserve: 5,
      injectDiscipline: disc,
    }),
  ], { maxSeconds: 40 });

  const d = mk(true);
  const g = mk(false);
  const dInj = d.events.filter((e) => e.kind === 'injected');
  const gInj = g.events.filter((e) => e.kind === 'injected');
  eq('D5a disciplined: exactly ONE stick, at t=17', dInj.map((e) => e.t), [17]);
  eq('D5b ...and it lands WHOLE', dInj[0].detail, '350 of 350 GJ landed');
  eq('D5c greedy free-runs all 5 sticks before the tank spends a GJ',
    gInj.map((e) => e.t), [0, 3, 6, 9, 12]);
  eq('D5d greedy burns the first stick into a FULL cap (0 GJ landed)',
    gInj[0].detail, '0 of 350 GJ landed');
}

// ===========================================================================
// D6. JUST-IN-TIME INJECTION (v0.113.0) — "run dry → inject → boost →
//     wait", the capital doctrine: a rep that cannot pay its cycle PULLS a
//     held stick at that exact instant; sticks never sit idle as neut food.
//     Geometry chosen so the 25% band trigger CANNOT explain the sticks
//     (cap parks at 0.30 — above the band — yet below the rep's cost):
//     capacitor 1000, rep 20 hp / 2 s at 350 GJ, inject 350, magazine 4,
//     reserve 12. Attacker: 10 dmg / 1 s, 20-round clip (t=0..19).
//
//     Trace: band ON t=13 (shield 60 = 30%):
//       t=13  pay 1000→650 (0.65 — held), heal→80
//       t=15  pay 650→300 (0.30 > 0.25 — still held), heal→80
//       t=17  cap 300 < 350 → JIT stick (+350→650), pay→300, heal→80
//       t=19  the booster's own cycle re-checks at 0.30 and HOLDS —
//             then the rep pulls it anyway (JIT), pay→300, heal→80
//       t=21  volleys over; shield 80 in-band → JIT, heal→100
//       t=23  JIT, heal→120;  t=25: 0.60 ≥ 55% → band OFF, all quiet
//     Injections exactly [17,19,21,23], every one landing WHOLE.
// ===========================================================================
{
  const clip20 = () => gun(10, 1, { clip: { size: 20, perCycle: 1, reloadSeconds: 9999 } });
  const out = simulateBattleEvents([
    ship('A', 'a', { weapons: [clip20()], hull: 10 }),
    ship('V', 'b', {
      shield: 200, hull: 10,
      repairs: [rep('shield', 20, 2, { cap: 350 })],
      capacitor: { capacity: 1000, tau: 1e12 },
      capBoosters: [{
        injectGj: 350, cycleSeconds: 2,
        charges: { count: 4, perCycle: 1, cycles: 4, reloadSeconds: 1 },
      }],
      capBoosterReserve: 12,
      injectDiscipline: true,
    }),
  ], { maxSeconds: 40 });
  const inj = out.events.filter((e) => e.kind === 'injected');
  const v = out.ships.find((x) => x.id === 'V');
  eq('D6a JIT sticks at the rep instants, never on the injector clock',
    inj.map((e) => e.t), [17, 19, 21, 23]);
  eq('D6b every JIT stick lands whole',
    inj.every((e) => e.detail === '350 of 350 GJ landed'), true);
  eq('D6c the tank never misses a beat (6 whole heals)', v.healsApplied, 120);
  eq('D6d shield parks at 0.60, band off', v.remaining[0], 0.6);
  eq('D6e no starvation ever', out.events.filter((e) => e.kind === 'capStarved').length, 0);
}

// ===========================================================================
// D7. CYCLE-SYNCED, RESERVE-DEFENDING PULLS (v0.116.0 — the owner's
//     correction: sticks time against the TANK'S cycles, and fire when
//     paying would dip below the 25% reserve, not merely when unpayable).
//     Victim: shield 200, rep 20 hp / 4 s at 300 GJ, capacitor 1000,
//     injector 350 GJ on a deliberately OFFSET 3 s clock (its own chain
//     must stay silent — tanked fits are pull-only). 14-round 10 dmg clip.
//     Band ON t=13 (60 = 30%). Rep instants: 13, 17, 21, 25.
//       t=13  cap 1000: 700 after pay ≥ 250 reserve → no stick, pay → 700
//       t=17  400 ≥ 250+300? cap 700 < 550? no (700 ≥ 550) → pay → 400
//       t=21  400 < 300+250 → PULL (fits: missing 600 ≥ 350) → 750,
//             pay → 450 — one stick, AT the rep instant, cap still ≥ 25%
//       t=25  shield 120 = 60% ≥ 55% → band OFF, quiet
//     v0.113 would have waited until the rep was UNPAYABLE (t=25, cap
//     100 < 300) — the reserve-defending trigger sticks one cycle sooner
//     and never lets the cap fall through the recharge peak.
// ===========================================================================
{
  const clip14 = () => gun(10, 1, { clip: { size: 14, perCycle: 1, reloadSeconds: 9999 } });
  const out = simulateBattleEvents([
    ship('A', 'a', { weapons: [clip14()], hull: 10 }),
    ship('V', 'b', {
      shield: 200, hull: 10,
      repairs: [rep('shield', 20, 4, { cap: 300 })],
      capacitor: { capacity: 1000, tau: 1e12 },
      capBoosters: [{
        injectGj: 350, cycleSeconds: 3,
        charges: { count: 4, perCycle: 1, cycles: 4, reloadSeconds: 1 },
      }],
      capBoosterReserve: 8,
      injectDiscipline: true,
    }),
  ], { maxSeconds: 40 });
  const v = out.ships.find((x) => x.id === 'V');
  eq('D7a one stick, AT the rep instant, defending the 25% reserve',
    out.events.filter((e) => e.kind === 'injected').map((e) => e.t), [21]);
  eq('D7b three whole heals, tank never blinks', v.healsApplied, 60);
}

console.log(`\ndiscipline.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
