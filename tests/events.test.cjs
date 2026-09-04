// THE DISCRETE EVENT SIMULATION. Every expected value below was computed BY
// HAND before the code ran — these assert facts about how an EVE fight works,
// with the repair amounts and clip sizes measured from the shipped engine.
const {
  simulateBattleEvents, DECLARED, STACKING_C, stackingFactor,
} = require('./sim/lib/battleEvents.js');
const { capAfter, capWakeSeconds } = require('./sim/lib/moduleCycle.js');
const { simulateBattle } = require('./sim/lib/battleTick.js');

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
const DEAD_CAP = { capacity: 1e9, tau: 1e12 }; // effectively no recharge, never binding

/** an untracked gun: full application at any range — isolates the EVENT
 * arithmetic from the application maths, which fitsim.test covers */
const gun = (dmg, cycle, extra = {}) => ({
  typeId: 1, kind: 'untracked', capPerCycle: 0,
  volley: { em: dmg, thermal: 0, kinetic: 0, explosive: 0 },
  cycleSeconds: cycle, ...extra,
});

const ship = (id, side, o = {}) => ({
  id, name: id, side,
  weapons: o.weapons ?? [],
  repairs: o.repairs ?? [],
  // the helper predates projections and silently DROPPED this field — a
  // fixture logi ran with no modules and its heals asserted trivially
  projected: o.projected,
  droneControlRangeM: o.droneControlRangeM,
  capBoosters: o.capBoosters,
  capBoosterReserve: o.capBoosterReserve,
  capacitor: o.capacitor ?? DEAD_CAP,
  capStartFrac: o.capStartFrac,
  capPolicy: o.capPolicy,
  layers: o.layers ?? [
    { name: 'Shield', hp: o.shield ?? 0, resonance: NO_RES },
    { name: 'Armor', hp: o.armor ?? 0, resonance: NO_RES },
    { name: 'Hull', hp: o.hull ?? 0, resonance: NO_RES },
  ],
  shieldRechargeSeconds: o.shieldRechargeSeconds,
  signatureRadius: 100000,
  flying: o.flying ?? { speed: 0, angleDeg: 0 },
  range: o.range ?? 1000,
  commandedRange: o.commandedRange,
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

// ---------------------------------------------------------------------------
// F1. REPAIR TIMING DECIDES THE FIGHT — same numbers, different timing.
//     1000 hp pool, 300 hp repair per 4 s, two 600-damage volleys at t=0 and
//     t=2 (a 2-round clip, then silence).
//     SHIELD (heals at cycle START): t=0 volley→400, heal→700; t=2→100. LIVES.
//     ARMOUR (heals at cycle END, t=4): t=0 volley→400; t=2→−200. DIES AT 2.
// ---------------------------------------------------------------------------
{
  const burst = gun(600, 2, { clip: { size: 2, perCycle: 1, reloadSeconds: 9999 } });
  const shieldTank = simulateBattleEvents([
    ship('A', 'a', { weapons: [burst], hull: 1 }),
    ship('S', 'b', { shield: 1000, repairs: [rep('shield', 300, 4)] }),
  ], { maxSeconds: 60 });
  eq('F1a the shield tank SURVIVES the double volley', shieldTank.winner, null);
  const S = shieldTank.ships.find((x) => x.id === 'S');
  eq('F1b ...alive', S.alive, true);

  const armorTank = simulateBattleEvents([
    ship('A', 'a', { weapons: [burst], hull: 1 }),
    ship('R', 'b', { armor: 1000, repairs: [rep('armor', 300, 4)] }),
  ], { maxSeconds: 60 });
  eq('F1c the armour tank DIES on identical numbers', armorTank.winner, 'a');
  close('F1d ...at exactly t=2, inside the end-of-cycle window', armorTank.seconds, 2, 1e-9);
}

// ---------------------------------------------------------------------------
// F2. THE ANCILLARY BURST WINDOW — measured LASB values: 390 hp / 4 s,
//     3 charges, then 60 s of silence. Incoming 320 every 4 s, in phase.
//     While charged the booster out-heals the volley (clamped at max). The
//     4th volley meets an empty booster: hp walks down 320 per 4 s from 2000
//     (heal at t=8 restored the t=8 volley). Death when cumulative loss
//     ≥ 2000: volleys at t=12..36 = 7 volleys × 320 = 2240 ≥ 2000 → t=36.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(320, 4)], hull: 1 }),
    ship('B', 'b', {
      shield: 2000,
      repairs: [rep('shield', 390, 4, {
        charges: { count: 3, perCycle: 1, cycles: 3, reloadSeconds: 60 },
      })],
    }),
  ], { maxSeconds: 300 });
  eq('F2a the ASB fit dies INSIDE the reload window', r.winner, 'a');
  close('F2b at exactly t=36 — hand-walked volley by volley', r.seconds, 36, 1e-9);
  eq('F2c the reload was a real event', r.events.some((e) => e.kind === 'reloadStart'), true);
  // heals: t=0,4,8 land 390 each but clamp at 2000 → +320 each = 960
  const B = r.ships.find((x) => x.id === 'B');
  close('F2d three clamped heals of 320', B.healsApplied, 960, 1e-9);
}

// ---------------------------------------------------------------------------
// F3. THE CLIP SILENCE KILLS THE SMOOTHING.
//     120-round clip (the measured 425mm AutoCannon count), 100 dmg / 1 s,
//     10 s reload. 12,100 hp: 120 volleys (t=0..119) leave 100 hp at t=119;
//     the smoothed model (92.3 dps sustained) would kill at ~131.1 s of
//     continuous fire — but the REAL fight has silence in [120, 130): the
//     killing volley waits for the reload and lands at exactly t=130.
// ---------------------------------------------------------------------------
{
  const ac = gun(100, 1, { clip: { size: 120, perCycle: 1, reloadSeconds: 10 } });
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [ac], hull: 1 }),
    ship('B', 'b', { shield: 12100 }),
  ], { maxSeconds: 300 });
  close('F3a the kill waits for the reload: t=130 exactly', r.seconds, 130, 1e-9);
  // and a target that dies before the clip empties never sees a reload
  const quick = simulateBattleEvents([
    ship('A', 'a', { weapons: [ac], hull: 1 }),
    ship('B', 'b', { shield: 500 }),
  ], { maxSeconds: 60 });
  close('F3b 500 hp dies on the 5th volley at t=4', quick.seconds, 4, 1e-9);
  eq('F3c with no reload event', quick.events.some((e) => e.kind === 'reloadStart'), false);
}

// ---------------------------------------------------------------------------
// F4. MISSILE FLIGHT AND KILL CREDIT AFTER DEATH.
//     A (100 hp) fires a torpedo at t=0 with 5 s flight (5000 m at 1000
//     m/s); B's 50-damage volleys at t=0 and t=2 kill A on the second. The
//     torpedo still lands at t=5 and kills B: mutual annihilation — no
//     winner, but a real decision time.
// ---------------------------------------------------------------------------
{
  const torp = gun(1000, 100, {
    kind: 'missile', missileVelocity: 1000, maxRange: 50000,
    expRadius: 1, expVelocity: 1000, drf: 1,
    clip: { size: 1, perCycle: 1, reloadSeconds: 9999 },
  });
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [torp], shield: 100, range: 5000 }),
    ship('B', 'b', { weapons: [gun(50, 2)], shield: 900, range: 5000 }),
  ], { maxSeconds: 60 });
  const A = r.ships.find((x) => x.id === 'A');
  const B = r.ships.find((x) => x.id === 'B');
  close('F4a A dies to the 2nd volley at t=2', A.diedAt, 2, 1e-9);
  close('F4b the torpedo STILL lands: B dies at t=5', B.diedAt, 5, 1e-9);
  eq('F4c mutual annihilation has no winner', r.winner, null);
  close('F4d but a real decision time', r.seconds, 5, 1e-9);
  close('F4e and the dead shooter gets the kill credit', A.damageDealt, 900, 1e-9);
}

// ---------------------------------------------------------------------------
// F5. THE CAPACITOR IS A QUANTITY, AND FEATHERING HOLDS THE FLOOR.
//     Repper costs 100 GJ / 2 s on a 1000 GJ / tau=500 s capacitor.
//     Recharge at high cap is weak (~2 GJ/s), so 'always' walks the cap down
//     toward empty; 'feather 25%' refuses any cycle that would cross 250 GJ.
// ---------------------------------------------------------------------------
{
  // capacitor 1000 GJ with NO meaningful recharge (tau 1e12) so the ledger is
  // exact: 'always' affords 10 cycles (1000/100); 'feather 25%' refuses any
  // cycle that would end below 250, so it stops after 7 (cap 300). The
  // attacker's 50-per-second chip keeps the shield below max so every heal
  // genuinely lands: 10 x 10 = 100 healed vs 7 x 10 = 70.
  const tank = (policy) => ship('B', 'b', {
    shield: 50000,
    repairs: [rep('shield', 10, 2, { cap: 100 })],
    capacitor: { capacity: 1000, tau: 1e12 },
    capPolicy: { rep0: policy },
  });
  const chip = gun(50, 1);
  const always = simulateBattleEvents([
    ship('A', 'a', { weapons: [chip], hull: 1 }), tank({ mode: 'always' }),
  ], { maxSeconds: 120 });
  const feather = simulateBattleEvents([
    ship('A', 'a', { weapons: [chip], hull: 1 }), tank({ mode: 'feather', floorFrac: 0.25 }),
  ], { maxSeconds: 120 });
  const bAlways = always.ships.find((x) => x.id === 'B');
  const bFeather = feather.ships.find((x) => x.id === 'B');
  eq('F5a running flat-out drains below the floor', bAlways.capMinFrac < 0.25, true);
  eq('F5b feathering NEVER crosses it', bFeather.capMinFrac >= 0.25 - 1e-9, true);
  close('F5c flat-out healed exactly its 10 affordable cycles', bAlways.healsApplied, 100, 1e-9);
  close('F5d feathering healed exactly 7 and held the rest', bFeather.healsApplied, 70, 1e-9);
}

// ---------------------------------------------------------------------------
// F6. THE CAPACITOR INVERSE ROUND-TRIPS AGAINST THE VERIFIED CLOSED FORM.
// ---------------------------------------------------------------------------
{
  const model = { capacity: 5000, tau: 800 };
  let worst = 0;
  for (let i = 1; i <= 20; i++) {
    const c0 = (i / 21) * 4000;
    const ct = c0 + 500;
    const w = capWakeSeconds(c0, ct, model);
    worst = Math.max(worst, Math.abs(capAfter(c0, w, model) - ct));
  }
  close('F6a 20 round-trips within 1e-9', worst, 0, 1e-9);
  eq('F6b full is unreachable by recharge', capWakeSeconds(100, 5000, model), null);
  eq('F6c already there costs nothing', capWakeSeconds(500, 400, model), 0);
}

// ---------------------------------------------------------------------------
// F7. CAP BOOSTER INJECTION WAKES A STARVED MODULE.
//     Cap 100 GJ, effectively no recharge. Repper costs 60/cycle (2 s).
//     t=0: rep pays 60 → 40 left. t=2: cannot afford, recharge can never get
//     there → parks. Booster (12 s cycle) injects 80 at t=12 → 120→clamp 100,
//     wakes the repper, which pays again; parks again at 14. Heals: t=0 and
//     t=12 = 2 heals of 10.
// ---------------------------------------------------------------------------
{
  // cap starts at 20 GJ of 100 (capStartFrac 0.2), no meaningful recharge.
  // A 5000-damage opening volley keeps the shield well below max. t=0: the
  // booster (phase WAKE, before the repper) injects 80 -> 100; the repper
  // pays 60 -> 40 and heals 10. t=2: 40 < 60, the repper computes a wake so
  // far away it is effectively parked. t=12: the second charge injects 80 ->
  // ~100, WAKES the sleeper, it pays and heals again. Exactly two heals.
  const alpha = gun(5000, 9999, { clip: { size: 1, perCycle: 1, reloadSeconds: 99999 } });
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [alpha], hull: 1 }),
    ship('B', 'b', {
      shield: 50000,
      repairs: [rep('shield', 10, 2, { cap: 60 })],
      capacitor: { capacity: 100, tau: 1e12 },
      capStartFrac: 0.2,
      capBoosters: [{
        typeId: 2, injectGj: 80, cycleSeconds: 12,
        charges: { count: 2, perCycle: 1, cycles: 2, reloadSeconds: 9999 },
      }],
    }),
  ], { maxSeconds: 20 });
  const B = r.ships.find((x) => x.id === 'B');
  close('F7a exactly two heals: t=0, and the injection-woken one at t=12',
    B.healsApplied, 20, 1e-9);
  // the repper was SLEEPING (wake reachable in principle), not parked
  eq('F7b no starvation report — it slept and was woken', r.events.filter((e) => e.kind === 'capStarved').length, 0);

  // and a module whose cost EXCEEDS the whole capacitor parks with one report
  const r2 = simulateBattleEvents([
    ship('A', 'a', { weapons: [alpha], hull: 1 }),
    ship('B', 'b', {
      shield: 50000,
      repairs: [rep('shield', 10, 2, { cap: 150 })],
      capacitor: { capacity: 100, tau: 1e12 },
    }),
  ], { maxSeconds: 20 });
  eq('F7c an unaffordable-ever module reports starvation ONCE',
    r2.events.filter((e) => e.kind === 'capStarved').length, 1);
  close('F7d and never heals', r2.ships.find((x) => x.id === 'B').healsApplied, 0, 1e-9);
}

// ---------------------------------------------------------------------------
// F8. PASSIVE REGEN IS LEVEL-DEPENDENT — the same law as the capacitor.
//     Shield 10000, tau 100 s. One 5000-damage volley at t=0, then peace.
//     The sim's shield at t=30 must equal capAfter(5000, 30) on the shield's
//     own curve — NOT 5000 + 30×peak (the flat-peak model the critic killed:
//     it would claim 12,500 → clamp 10,000, full — twice the real recovery).
// ---------------------------------------------------------------------------
{
  const alpha = gun(5000, 9999, { clip: { size: 1, perCycle: 1, reloadSeconds: 99999 } });
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [alpha], hull: 1 }),
    ship('B', 'b', { shield: 10000, shieldRechargeSeconds: 100 }),
  ], { maxSeconds: 30 });
  const want = capAfter(5000, 30, { capacity: 10000, tau: 100 });
  const B = r.ships.find((x) => x.id === 'B');
  close('F8a shield after 30 s of peace follows the closed form',
    B.remaining[0] * 10000, want, 1e-6);
  eq('F8b which is NOT full — the flat-peak model would say it was',
    B.remaining[0] < 0.999, true);
}

// ---------------------------------------------------------------------------
// F9. SPOOL RAMPS AND RESETS ON TARGET SWITCH.
//     Volley 1000, +50% per cycle (perCycle 0.5, max 2), cycle 1 s.
//     B1 (1500 hp): t=0 ×1.0 = 1000 → 500 left; t=1 ×1.5 = 1500 → dead.
//     Switch to B2 (1800 hp): if spool RESET, t=2 lands ×1.0 = 1000 → 800
//     left, t=3 ×1.5 → dead at 3. If spool (wrongly) survived, t=2 ×2.0
//     would kill instantly — the death time separates the two.
// ---------------------------------------------------------------------------
{
  const dis = gun(1000, 1, { spool: { perCycle: 0.5, max: 2 } });
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [dis], hull: 1 }),
    ship('B1', 'b', { shield: 1500 }),
    ship('B2', 'b', { shield: 1800 }),
  ], { maxSeconds: 60 });
  const b1 = r.ships.find((x) => x.id === 'B1');
  const b2 = r.ships.find((x) => x.id === 'B2');
  close('F9a first target falls to the ramped 2nd volley', b1.diedAt, 1, 1e-9);
  close('F9b the ramp RESET for the second target: dead at 3, not 2', b2.diedAt, 3, 1e-9);
}

// ---------------------------------------------------------------------------
// F10. MOTION: A CLOSING SHIP ACTUALLY CLOSES (the frozen-range bug).
//      Missile boat at 20 km closing at 500 m/s toward commanded 5 km. Its
//      missile reaches only 10 km. Frozen range = zero damage forever. With
//      motion: range 20000−500t reaches 10000 at t=20 — the first volley in
//      reach is the t=20 cycle (cycle 4 s: volleys at 20, 24, …).
// ---------------------------------------------------------------------------
{
  const lrm = gun(100, 4, {
    kind: 'missile', missileVelocity: 2000, maxRange: 10000,
    expRadius: 1, expVelocity: 1000, drf: 1,
  });
  const r = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [lrm], hull: 1, range: 20000, commandedRange: 5000,
      flying: { speed: 500, angleDeg: 0 },
    }),
    ship('B', 'b', { shield: 100, range: 20000 }),
  ], { maxSeconds: 120 });
  const B = r.ships.find((x) => x.id === 'B');
  // volley fired at t=20 from 10000 m, flight 5 s → lands t=25
  close('F10a the first volley in reach lands at t=25', B.diedAt, 25, 1e-9);
  eq('F10b so the closing ship WON — frozen range would stalemate', r.winner, 'a');
}

// ---------------------------------------------------------------------------
// F11. DETERMINISM: the same input twice is byte-identical.
// ---------------------------------------------------------------------------
{
  const build = () => [
    ship('A1', 'a', { weapons: [gun(90, 1.7), gun(45, 0.9)], shield: 4000, repairs: [rep('shield', 120, 3.1)] }),
    ship('A2', 'a', { weapons: [gun(70, 2.3)], armor: 5000, repairs: [rep('armor', 200, 6)] }),
    ship('B1', 'b', { weapons: [gun(130, 2.1)], shield: 6000 }),
    ship('B2', 'b', { weapons: [gun(60, 1.3)], armor: 3500 }),
  ];
  const r1 = simulateBattleEvents(build(), { maxSeconds: 300 });
  const r2 = simulateBattleEvents(build(), { maxSeconds: 300 });
  eq('F11a identical inputs, identical fights', JSON.stringify(r1), JSON.stringify(r2));
  const same = build();
  const r3 = simulateBattleEvents(same, { maxSeconds: 300 });
  const r4 = simulateBattleEvents(same, { maxSeconds: 300 });
  eq('F11b even reusing the SAME input objects (no mutation)', JSON.stringify(r3), JSON.stringify(r4));
}

// ---------------------------------------------------------------------------
// F12. DIFFERENTIAL VS THE TICK SIM — where smoothing is harmless, they
//      agree; the death time may differ by up to one weapon cycle plus one
//      tick (the critic's corrected bound), no more.
// ---------------------------------------------------------------------------
{
  const ev = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(100, 1)], shield: 2000 }),
    ship('B', 'b', { weapons: [gun(80, 1)], shield: 1500 }),
  ], { maxSeconds: 120 });
  const tickShip = (id, side, hp, dps) => ({
    id, name: id, side,
    weapons: dps > 0 ? [{ typeId: 1, kind: 'untracked', cycleSeconds: 1, capPerCycle: 0, volley: { em: dps, thermal: 0, kinetic: 0, explosive: 0 } }] : [],
    layers: [{ name: 'Shield', hp, resonance: NO_RES }, { name: 'Armor', hp: 0, resonance: NO_RES }, { name: 'Hull', hp: 0, resonance: NO_RES }],
    defenses: { shieldRepairHps: 0, armorRepairHps: 0, shieldPassiveHps: 0, capOutSeconds: null },
    signatureRadius: 100000, flying: { speed: 0, angleDeg: 0 }, range: 1000,
  });
  const tick = simulateBattle([tickShip('A', 'a', 2000, 100), tickShip('B', 'b', 1500, 80)], { step: 0.25 });
  eq('F12a same winner', ev.winner, tick.winner);
  // event sim: B (1500 hp / 100 per volley) dies on the 15th volley at t=14
  close('F12b event-sim death on the 15th volley', ev.seconds, 14, 1e-9);
  close('F12c tick sim within one cycle + one tick', tick.seconds, 14, 1 + 0.25 + 1e-9);
}

// ---------------------------------------------------------------------------
// F13. THE STACKING CONSTANT IS THE MEASURED ONE.
//      Recovered from the engine: 3 Tracking Enhancer IIs (falloffBonus
//      +9.5%) moved a 425mm AutoCannon's falloff 16931.25 → 20317.5 →
//      23849.169… → 26570.756…; inverting s(k)=e^(−(k/c)²) gives c=2.67 at
//      both testable indices. The shipped constant must BE that measurement.
// ---------------------------------------------------------------------------
{
  eq('F13a STACKING_C is the measured 2.67', STACKING_C, 2.67);
  const vals = [16931.25, 20317.5, 23849.16904198241, 26570.755810400224];
  // the first module is unpenalised, so the bonus IS the first ratio: +20%
  const b = vals[1] / vals[0] - 1;
  for (let n = 2; n <= 3; n++) {
    const s = (vals[n] / vals[n - 1] - 1) / b;
    close(`F13b index ${n - 1} penalty matches stackingFactor`, stackingFactor(n - 1), s, 1e-6);
  }
}

// ---------------------------------------------------------------------------
// F14. HULL REPAIR EXISTS (nothing counted it before this file).
//      100 hull hp, 30 hp/3 s hull rep (END timing), incoming 25 per 3 s in
//      phase: volley t=0 →75; heal t=3 (before the t=3 volley? heal is
//      REP_END phase 6, volley LAND phase 5 — volley first): t=3 volley →50,
//      heal →80 … net −25+30 = +5 per cycle after the first: it climbs.
//      The attacker can never finish: stalemate.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(25, 3)], hull: 1 }),
    ship('B', 'b', { hull: 100, repairs: [rep('hull', 30, 3)] }),
  ], { maxSeconds: 60 });
  eq('F14a a hull-repped ship out-heals the chip damage', r.winner, null);
  const B = r.ships.find((x) => x.id === 'B');
  eq('F14b and is alive', B.alive, true);
}

// ---------------------------------------------------------------------------
// F15. PERFORMANCE GATE: 10 ships, 600 s stalemate, median of 5 < 100 ms.
// ---------------------------------------------------------------------------
{
  const fleet = [];
  for (let i = 0; i < 5; i++) {
    fleet.push(ship(`A${i}`, 'a', {
      weapons: [gun(1, 1.1 + i * 0.13), gun(1, 2.3 + i * 0.07)],
      shield: 1e9, repairs: [rep('shield', 100, 4)],
      capacitor: { capacity: 5000, tau: 800 },
    }));
    fleet.push(ship(`B${i}`, 'b', {
      weapons: [gun(1, 1.7 + i * 0.11)],
      armor: 1e9, repairs: [rep('armor', 100, 6, { cap: 40 })],
      capacitor: { capacity: 4000, tau: 700 },
    }));
  }
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    simulateBattleEvents(fleet, { maxSeconds: 600 });
    times.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  times.sort((a, b) => a - b);
  const median = times[2];
  console.log(`      (median ${median.toFixed(1)} ms over 5 runs)`);
  eq('F15a a 600 s 10-ship stalemate simulates in under 100 ms', median < 100, true);
}

// ---------------------------------------------------------------------------
// F16. OPEN OUT TO A HOLD RANGE — the "keep at range 15" story from a 5 km
//      start: fly straight OUT (180) at 500 m/s, arrive at t=20, circle.
//      The attacker's missile reaches 14 km ON PAPER — but the runner is
//      RECEDING, and under MISSILE_INTERCEPT_LEAD_PURSUIT (v0.93.0) a
//      receding target shrinks the real reach: a volley launched at range r
//      catches at r/(v_m−500) but expires at 14000/v_m, so reach is
//      r ≤ 14000·(1−500/1e9) = 13999.993 m. The t=18 volley launches at
//      EXACTLY 14000 m — 7 mm out — and dies in flight (this is EVE's
//      documented "outrun the missile" mechanic emerging; the old model's
//      launch-range gate landed it). Hand-derivation: volleys t=0..16 have
//      r = 5000+500t ≤ 13000 ✓ → NINE land.
//      (v0.92 pinned 10 under the retired at-launch-range convention.)
// ---------------------------------------------------------------------------
{
  const lrm = gun(100, 2, {
    // expRadius == victim sig makes the sig term exactly 1; the huge
    // explosion velocity clamps the velocity term — full application
    kind: 'missile', missileVelocity: 1e9, maxRange: 14000,
    expRadius: 100, expVelocity: 1e9, drf: 1,
  });
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [lrm], hull: 1, range: 5000 }),
    ship('B', 'b', {
      shield: 1e9, sig: 100, range: 5000, commandedRange: 15000,
      flying: { speed: 500, angleDeg: 180 },
    }),
  ], { maxSeconds: 60 });
  const A = r.ships.find((x) => x.id === 'A');
  close('F16a nine volleys catch the receding runner (t=18 dies 7 mm short)',
    A.damageDealt, 9 * 100, 1e-6);
  eq('F16b then the hold range keeps it safe forever', r.winner, null);
}

// ---------------------------------------------------------------------------
// F17. THE SERIES RECORDS THE GEOMETRY — range/speed/transversal per second,
//      which the replay map and the distance/transversal charts consume.
//      Same scenario as F16: the runner's sampled range must walk
//      5000 + 500·t until it holds at 15000.
// ---------------------------------------------------------------------------
{
  const runner = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(1, 1000)], hull: 1, range: 5000 }),
    ship('B', 'b', {
      shield: 1e9, range: 5000, commandedRange: 15000,
      flying: { speed: 500, angleDeg: 180 },
    }),
  ], { maxSeconds: 30 });
  const at = (t) => runner.series.find((p) => p.t === t);
  close('F17a range at t=0 is the start', at(0).range.B, 5000, 1e-6);
  close('F17b at t=10 it has opened 5 km', at(10).range.B, 10000, 1e-6);
  close('F17c at t=25 it HOLDS at 15 km', at(25).range.B, 15000, 1e-6);
  close('F17d speed is recorded', at(10).speed.B, 500, 1e-9);
  // before arrival it flies straight away (no tangential); after arriving it
  // circles (angle 90) and its whole speed becomes transversal
  close('F17e transversal is zero on the run', at(10).transversal.B, 0, 1e-9);
  close('F17f and the full 500 once it orbits', at(25).transversal.B, 500, 1e-9);
}

// ---------------------------------------------------------------------------
// F18. HULL ZERO IS DEAD — even while passive shield regen trickles.
//      Caught live: a Guardian ground to zero hull sat "alive" forever on a
//      few regenerating shield points, because death checked TOTAL hp.
//      Shield 1000 (with regen), armor 500, hull 400; volleys of 300/2s:
//      the pool grinds down; the moment HULL empties the ship must die,
//      regardless of what the shield has crept back to.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(300, 2)], hull: 1 }),
    ship('B', 'b', {
      layers: [
        { name: 'Shield', hp: 1000, resonance: NO_RES },
        { name: 'Armor', hp: 500, resonance: NO_RES },
        { name: 'Hull', hp: 400, resonance: NO_RES },
      ],
      shieldRechargeSeconds: 50, // aggressive regen — the old bug's fuel
    }),
  ], { maxSeconds: 300 });
  eq('F18a the ship DIES when its hull empties', r.winner, 'a');
  const B = r.ships.find((x) => x.id === 'B');
  eq('F18b hull is the layer that killed it', B.remaining[2], 0);
  eq('F18c and death happened long before the time limit', r.seconds < 60, true);
}

// ---------------------------------------------------------------------------
// F19. THE DEAD DO NOT REGENERATE — a corpse's chart line stays down.
//      Caught live: a killed Hyena's shield regenerated to 98% after death
//      (the sampler advanced corpses on the closed form) and its line curved
//      back up. The series and the final `remaining` must both stay at the
//      death values forever.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(5000, 1, { clip: { size: 3, perCycle: 1, reloadSeconds: 9999 } })], hull: 1 }),
    // dies at t=2 (shield 4000 + armor 4000 + hull 4000 vs 5000-volleys),
    // with strong passive regen that must NOT resurrect the line
    ship('B', 'b', {
      layers: [
        { name: 'Shield', hp: 4000, resonance: NO_RES },
        { name: 'Armor', hp: 4000, resonance: NO_RES },
        { name: 'Hull', hp: 4000, resonance: NO_RES },
      ],
      shieldRechargeSeconds: 20,
    }),
    // a second target keeps the fight alive past the death so the sampler runs
    ship('C', 'b', { shield: 1e9 }),
  ], { maxSeconds: 60 });
  const B = r.ships.find((x) => x.id === 'B');
  close('F19a the ship died', B.diedAt, 2, 1e-9);
  eq('F19b final remaining is all zeros — no post-mortem regen',
    JSON.stringify(B.remaining), JSON.stringify([0, 0, 0]));
  const after = r.series.filter((p2) => p2.t > 3).map((p2) => p2.hp.B);
  eq('F19c and the series stays flat at zero after death',
    after.every((v) => v === 0), true);
  const death = r.events.find((e) => e.kind === 'death' && e.who === 'B');
  eq('F19d the death names its killer', death.detail, 'killed by A');
}

// ---------------------------------------------------------------------------
// F20. DRONE CONTROL RANGE — drones deal NOTHING to a target beyond their
//      owner's control range (engine-final char 458: all-V Guardian 60 km).
//      Caught live: a Guardian's drones were fighting at 100 km. Same drone,
//      same target, owner inside vs outside 60 km:
// ---------------------------------------------------------------------------
{
  const drone = (dmg) => ({
    typeId: 2488, kind: 'drone', capPerCycle: 0,
    volley: { em: dmg, thermal: 0, kinetic: 0, explosive: 0 },
    cycleSeconds: 4, tracking: 5000, sigResolution: 25,
    droneSpeed: 4000, droneOrbit: 1000,
  });
  const mk = (range) => simulateBattleEvents([
    { ...ship('A', 'a', { hull: 1, range, sig: 100 }),
      weapons: [drone(100)], droneControlRangeM: 60000 },
    ship('B', 'b', { shield: 1e9, sig: 400, range }),
  ], { maxSeconds: 60 });
  const inside = mk(59000);
  const outside = mk(100000);
  eq('F20a inside control range the drone fights',
    inside.ships.find((x) => x.id === 'A').damageDealt > 0, true);
  close('F20b at 100 km on a 60 km control range it deals NOTHING',
    outside.ships.find((x) => x.id === 'A').damageDealt, 0, 1e-12);
  // and with no control range provided (old inputs), behaviour is unchanged
  const legacy = simulateBattleEvents([
    { ...ship('A', 'a', { hull: 1, range: 100000, sig: 100 }), weapons: [drone(100)] },
    ship('B', 'b', { shield: 1e9, sig: 400, range: 100000 }),
  ], { maxSeconds: 60 });
  eq('F20c undefined control range stays unlimited (legacy inputs)',
    legacy.ships.find((x) => x.id === 'A').damageDealt > 0, true);
}

// ---------------------------------------------------------------------------
// F21. PAIR DISTANCES — the collinear world. Caught live: a Guardian
//      "keeping 10 km" (its scalar vs the Tengu) shot a Hyena orbiting at
//      100 km AS IF SHE WERE AT 10 KM — its 60 km-control drones killed her
//      in 30 s. Every pair now uses its own distance:
//      the near attacker (10 km) is hittable, the far one (100 km) is not.
// ---------------------------------------------------------------------------
{
  const drone = {
    typeId: 2488, kind: 'drone', capPerCycle: 0,
    volley: { em: 100, thermal: 0, kinetic: 0, explosive: 0 },
    cycleSeconds: 4, tracking: 5000, sigResolution: 25,
    droneSpeed: 4000, droneOrbit: 1000,
  };
  const r = simulateBattleEvents([
    ship('NEAR', 'a', { weapons: [gun(1, 1000)], shield: 1e9, range: 10000, sig: 400 }),
    ship('FAR', 'a', { weapons: [gun(1, 1000)], shield: 1e9, range: 100000, sig: 400 }),
    { ...ship('G', 'b', { shield: 500, range: 10000, sig: 100 }),
      weapons: [drone], droneControlRangeM: 60000 },
  ], { maxSeconds: 30 });
  // the target's drones focus the nearest-death enemy: both attackers have
  // 1e9 shields, ties by hpTotal → first found. Whoever is targeted, damage
  // must only land on a pair distance INSIDE 60 km. NEAR took damage or FAR
  // took none — assert the far ship is untouched:
  const far = r.ships.find((x) => x.id === 'FAR');
  eq('F21a the 100 km attacker is untouchable by 60 km-control drones',
    far.remaining[0], 1);

  // and a remote rep between ALLIES uses their separation on the axis:
  // logi at 10 km cannot reach a wingmate at 100 km (90 km apart, rep
  // optimal 8 km), but CAN reach one at 12 km (2 km apart)
  const repMod = (o) => ({ typeId: 9, kind: 'remoteShield', cycleSeconds: 4, capPerCycle: 0,
    optimal: 8000, falloff: 0, resistAttr: 2116,
    rep: { layer: 'shield', amount: 500, timing: 'start', charges: null }, ...o });
  const mk = (wingRange) => simulateBattleEvents([
    ship('L', 'a', { projected: [repMod({})], shield: 1e9, range: 10000 }),
    ship('W', 'a', { weapons: [gun(1, 1000)], shield: 50000, range: wingRange }),
    ship('T', 'b', { weapons: [gun(800, 2)], shield: 1e9, range: 10000 }),
  ], { maxSeconds: 20 });
  // remote heals credit the HEALER's ledger (healsApplied on the logi)
  const nearL = mk(12000).ships.find((x) => x.id === 'L');
  const farL = mk(100000).ships.find((x) => x.id === 'L');
  eq('F21b a logi 2 km from its wingmate heals it', nearL.healsApplied > 0, true);
  close('F21c 90 km down the axis it heals NOTHING', farL.healsApplied, 0, 1e-9);
}

// ---------------------------------------------------------------------------
// CAP BOOSTER RESERVE (v0.108.0) — the carried pool runs dry.
// Same shape as F7a: rep heal 10 / cycle at 60 GJ, cap 100 starting at 20
// (cannot afford a cycle), booster injects 80 per charge, module holds 2,
// reload 10 s, booster cycle 12 s. HAND TRACE with reserve 3 (total carried):
//   init: load takes min(2,3)=2, pool left 1
//   t=0  inject (1 of load), t=12 inject (2 of load)
//   t=24 reload takes min(2,1)=1, pool 0 -> next start t=34
//   t=34 inject (3rd and last), t=46 reload takes 0 -> DRY
// One heal per injection (cap falls back under 60 after each cycle), so
// 3 injections = 30 hp healed in 60 s. Unlimited control: injections at
// t=0,12,34,46 (reload full at 24 and 58) = 4 heals = 40 hp.
{
  const boosted = (reserve) => ship('B', 'b', {
    shield: 50000,
    repairs: [rep('shield', 10, 2, { cap: 60 })],
    capacitor: { capacity: 100, tau: 1e12 },
    capStartFrac: 0.2,
    capBoosters: [{
      typeId: 2, injectGj: 80, cycleSeconds: 12,
      charges: { count: 2, perCycle: 1, cycles: 2, reloadSeconds: 10 },
    }],
    capBoosterReserve: reserve,
  });
  // the attacker must chunk the shield FIRST: a heal only applies up to the
  // hp actually missing (caught by this very fixture's first run — a token
  // 1-damage gun left the shield full and healsApplied read 1, not 30)
  const alphaR = gun(100, 1);
  const limited = simulateBattleEvents([ship('A', 'a', { weapons: [alphaR], hull: 1 }), boosted(3)], { maxSeconds: 60 });
  const unlimited = simulateBattleEvents([ship('A', 'a', { weapons: [alphaR], hull: 1 }), boosted(undefined)], { maxSeconds: 60 });
  const BL = limited.ships.find((x) => x.id === 'B');
  const BU = unlimited.ships.find((x) => x.id === 'B');
  close('R1a reserve 3 -> exactly 3 injections worth of heals (30 hp)', BL.healsApplied, 30, 1e-9);
  close('R1b unlimited -> 4 injections in 60 s (40 hp)', BU.healsApplied, 40, 1e-9);
}

// ---------------------------------------------------------------------------
// N-OF-THE-SAME EXPANSION (v0.108.0) — pure, hand-computed.
{
  const { expandCounts } = require('./sim/lib/battleEvents.js');
  const base = [ship('solo', 'a'), ship('trio', 'a'), ship('foe', 'b')];
  const out = expandCounts(base, (id) => (id === 'trio' ? 3 : 1));
  eq('X1a ids expand with #k, first copy keeps the id',
    out.map((x) => x.id), ['solo', 'trio', 'trio#2', 'trio#3', 'foe']);
  eq('X1b names mark the copies',
    out.map((x) => x.name), ['solo', 'trio', 'trio ×2', 'trio ×3']
      .slice(0, 4).concat(['foe']));
  eq('X1c count is capped at 50', expandCounts([ship('x', 'a')], () => 999).length, 50);
  eq('X1d nonsense counts mean 1', expandCounts([ship('x', 'a')], () => NaN).length, 1);
}

// ---------------------------------------------------------------------------
// R2. THE SHARED STICK POOL (v0.111.0) — ancillary shield boosters eat the
//     SAME cap booster charges as the injector, so capBoosterReserve now
//     covers both. ASB: 10 hp / 2 s, 2-charge magazine, 5 s reload.
//     Reserve 3 = 2 loaded + 1 in cargo. One 50-damage volley at t=0.
//     Hand-trace: heal t=0 (+10→60, 1 left), t=2 (+10→70, 0 left);
//     t=4 reload (pool has 1 ≥ 1) → done t=9: take 1, pool 0; heal t=9
//     (+10→80); t=11 reload attempt: pool 0 → DRY FOR GOOD.
//     Unlimited (blank reserve): heals t=0,2,9,11,18 → full at 100.
// ---------------------------------------------------------------------------
{
  const asb = () => rep('shield', 10, 2, {
    charges: { count: 2, perCycle: 1, cycles: 2, reloadSeconds: 5 },
  });
  const alpha = () => gun(50, 1, { clip: { size: 1, perCycle: 1, reloadSeconds: 9999 } });
  const mk = (reserve) => simulateBattleEvents([
    ship('A', 'a', { weapons: [alpha()], hull: 10 }),
    ship('V', 'b', { shield: 100, hull: 10, repairs: [asb()], capBoosterReserve: reserve }),
  ], { maxSeconds: 30 });
  const lim = mk(3).ships.find((x) => x.id === 'V');
  const unl = mk(undefined).ships.find((x) => x.id === 'V');
  eq('R2a ASB reserve 3 -> 3 heals then dry (30 hp)', lim.healsApplied, 30);
  eq('R2b ASB dry parks the shield at 0.80', lim.remaining[0], 0.8);
  eq('R2c blank reserve keeps the old unlimited reloads (50 hp)', unl.healsApplied, 50);
  eq('R2d unlimited tops back to full', unl.remaining[0], 1);
}

// ---------------------------------------------------------------------------
// R3. LOAD ORDER WHEN THE POOL IS SHORT — DECLARED: the ASBs (the tank
//     itself) fill first, then the injectors. Reserve 3 against an ASB
//     magazine of 2 and an injector magazine of 2: ASB loads 2, injector
//     loads 1, cargo 0.
//     The split is made OBSERVABLE through a cap-starved plain booster:
//     cap starts at 0 with no recharge (EVE's curve is exactly zero at
//     empty), so the 20-hp plain booster (40 GJ/cycle) cycles ONCE per
//     40 GJ injection. One 80-damage volley at t=0 opens the gap.
//     ASB-first ledger: ASB 10+10, injector 1 × 40 GJ → plain rep 1 × 20
//     → 40 hp healed. (Injector-first would read 50.)
// ---------------------------------------------------------------------------
{
  const asb = () => rep('shield', 10, 2, {
    charges: { count: 2, perCycle: 1, cycles: 2, reloadSeconds: 5 },
  });
  const out = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(80, 1, { clip: { size: 1, perCycle: 1, reloadSeconds: 9999 } })], hull: 10 }),
    ship('V', 'b', {
      shield: 100, hull: 10,
      repairs: [asb(), rep('shield', 20, 2, { cap: 40 })],
      capBoosters: [{
        injectGj: 40, cycleSeconds: 2,
        charges: { count: 2, perCycle: 1, cycles: 2, reloadSeconds: 1 },
      }],
      capBoosterReserve: 3,
      capacitor: { capacity: 100, tau: 1e12 },
      capStartFrac: 0,
    }),
  ], { maxSeconds: 30 }).ships.find((x) => x.id === 'V');
  eq('R3a short pool: ASBs load before injectors (40 hp, not 50)', out.healsApplied, 40);
}

// ---------------------------------------------------------------------------
// R4. THE ADJACENT CLASS — ancillary ARMOUR repairers run on NANITE PASTE,
//     a different resource: reserve 0 must not touch them. AAR 30 hp / 4 s
//     (heal at END), 2-charge magazine, 3 s reload; one 150-damage volley.
//     Cycles start t=0,4 (heals t=4,8), reload t=8→11, cycles t=11,15
//     (heals t=15,19), reload t=19→22, cycle t=22 (heal t=26 → FULL 200).
//     5 × 30 = 150 hp healed with capBoosterReserve ZERO.
// ---------------------------------------------------------------------------
{
  const aar = () => rep('armor', 30, 4, {
    charges: { count: 2, perCycle: 1, cycles: 2, reloadSeconds: 3 },
  });
  const out = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(150, 1, { clip: { size: 1, perCycle: 1, reloadSeconds: 9999 } })], hull: 10 }),
    ship('V', 'b', { armor: 200, hull: 10, repairs: [aar()], capBoosterReserve: 0 }),
  ], { maxSeconds: 40 }).ships.find((x) => x.id === 'V');
  eq('R4a AAR paste ignores an EMPTY stick pool (150 hp healed)', out.healsApplied, 150);
  eq('R4b armour back to full on paste alone', out.remaining[1], 1);
}

// ---------------------------------------------------------------------------
// E1/E2. THE PROGRESS EXTENSION (v0.117.0, owner's rule): "a fight with a
//     visible ending must be allowed to reach it; only a true stalemate may
//     be cut off." Opt-in via extendWhileProgressing; default behaviour is
//     byte-identical to before.
//
//     E1  CONVERGING PAST THE HORIZON: 10 dmg/s into 350 shield + 50 hull
//     (400 hp total, no tank) dies at t=39 — beyond maxSeconds 30. Without
//     the flag: cut off, stalemate. With it: every volley sets a new hp
//     low (progress), the horizon slides, Team A wins at 39.1... exactly
//     t=39 (hull zeroed by the 40th volley).
//
//     E2  TRUE EQUILIBRIUM STOPS: a free unlimited 20 hp/2s rep against
//     10 dmg/s sawtooths 80↔100 forever. The all-time low (80) is set at
//     t=2 and never beaten → lastProgress=2. At the 30 s boundary the
//     stall window (120 s) still covers t=2, so ONE extension fires and is
//     clamped to hardMax = 4×30 = 120; at t=120 the fight has been still
//     for 118 s → stop. Stalemate, elapsed exactly 120, nobody dead.
// ---------------------------------------------------------------------------
{
  const mk = (extend) => simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(10, 1)], hull: 10 }),
    ship('V', 'b', { shield: 350, hull: 50 }),
  ], { maxSeconds: 30, extendWhileProgressing: extend });
  const cut = mk(false);
  const ext = mk(true);
  eq('E1a without the flag the fight is cut off at 30 (stalemate)',
    [cut.winner, cut.seconds], [null, null]);
  eq('E1b with it, the converging fight reaches its ending',
    [ext.winner, Math.round(ext.seconds)], ['a', 39]);

  const eq2 = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(10, 1)], hull: 10 }),
    ship('V', 'b', { shield: 100, hull: 10, repairs: [rep('shield', 20, 2)] }),
  ], { maxSeconds: 30, extendWhileProgressing: true });
  eq('E2a a true equilibrium still stalemates', [eq2.winner, eq2.seconds], [null, null]);
  eq('E2b ...after one clamped extension to hardMax (elapsed 120)', eq2.elapsed, 120);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
