// PER-MODULE REPAIR CYCLES AND THE CAPACITOR.
//
// Every engine number below is a REAL MEASUREMENT taken from the shipped wasm
// on 2026-08-09 with all-V skills, not an invention. The fit context is named
// on each one because the hull bonus is baked in (a Myrmidon repairs 37.5%
// harder than an unbonused hull, and that is why 518 becomes 712.25).
//
// These fixtures assert facts about EVE. If EVE changes they should fail.
const {
  chargeCount, repairCycles, dutyHpsOf, burstHpsOf,
  capAfter, capRecharge, capPeakRecharge,
} = require('./sim/lib/moduleCycle.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};
const close = (l, g, w, tol) => {
  const ok = Math.abs(g - w) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `   got=${g} want=${w}`}`);
  ok ? pass++ : fail++;
};

// build an EngineItem the way the wasm actually returns one
const item = (typeId, effects, attrs, opts = {}) => ({
  type_id: typeId,
  state: opts.state ?? 'Active',
  effects,
  attributes: new Map(Object.entries(attrs).map(([k, v]) => [Number(k), { value: v }])),
  charge: opts.charge ? { type_id: opts.charge, attributes: new Map() } : null,
});
const fit = (items, hull = {}) => ({
  hull: { attributes: new Map(Object.entries(hull).map(([k, v]) => [Number(k), { value: v }])) },
  items,
});

// ---------------------------------------------------------------------------
// 1. THE CHARGE COUNT. Two opposite failure modes in one function.
// ---------------------------------------------------------------------------
{
  // MEASURED engine values, and the WHOLE number EVE actually gives you
  eq('1a 425mm AutoCannon II holds 120 rounds, not 119',
    chargeCount(119.99999821186069), 120);
  eq('1b Heavy Missile Launcher II holds 40', chargeCount(40.00000248352692), 40);
  // 42 m3 of module, 12 m3 per Navy Cap Booster 400 -> you fit THREE.
  // Rounding would hand the fit a fourth cycle of repair it does not have.
  eq('1c a Large ASB with Navy 400s holds 3, not 3.5 and not 4',
    chargeCount(3.5000000000000018), 3);
  eq('1d ...with Navy 800s (24 m3) it holds 1', chargeCount(1.7499999999999984), 1);
  eq('1e a Medium ASB with Navy 200s holds 2', chargeCount(2.333333333333333), 2);
  eq('1f a Small ASB with Navy 50s holds 4', chargeCount(4.666666666666666), 4);
  eq('1g a Large AAR holds 64 nanite paste', chargeCount(64), 64);
  eq('1h a module with no charge has no clip', chargeCount(undefined), undefined);
  eq('1i and neither has one that holds nothing', chargeCount(0), undefined);
}

// ---------------------------------------------------------------------------
// 2. A PLAIN SHIELD BOOSTER must reproduce the engine's own hp/s.
//    Large Shield Booster II on a Drake: engine -49 = 68.9999999999924
// ---------------------------------------------------------------------------
{
  const r = repairCycles(fit([
    item(10858, [4, 13, 16], { 68: 276, 73: 4000, 6: 144 }),
  ]));
  eq('2a one shield booster is found', r.cycles.length, 1);
  eq('2b as a shield repairer', r.cycles[0].kind, 'shield');
  close('2c 276 hp every 4 s is the engine\'s 69 hp/s', r.cycles[0].burstHps, 69, 1e-9);
  eq('2d and it is NOT an ancillary', r.cycles[0].ancillary, false);
  eq('2e so burst and duty are the same number', r.cycles[0].dutyHps, r.cycles[0].burstHps);
  close('2f it costs 144 GJ per activation', r.cycles[0].capPerCycle, 144, 0);
  eq('2g a shield booster heals at the START of its cycle', r.cycles[0].timing, 'start');
  eq('2h nothing was refused', r.refused.length, 0);
}

// ---------------------------------------------------------------------------
// 3. THE BUG. A Large Ancillary Shield Booster on a Drake.
//    The engine returns NO -49 for this module, so the app reported 0 tank.
//    Measured: 68=390, 73=4000, 6=0 (charges pay instead), 1795=60000,
//    56=1, -8=3.5000000000000018
// ---------------------------------------------------------------------------
{
  const r = repairCycles(fit([
    item(4391, [13, 16, 4936],
      { 68: 390, 73: 4000, 6: 0, 1795: 60000, 56: 1, '-8': 3.5000000000000018 },
      { charge: 11289 }),
  ]));
  eq('3a an ancillary shield booster is NOT zero tank', r.cycles.length, 1);
  eq('3b it is recognised as ancillary', r.cycles[0].ancillary, true);
  close('3c it restores 390 per cycle', r.cycles[0].amount, 390, 0);
  eq('3d holding three charges', r.cycles[0].charges.count, 3);
  eq('3e for three cycles', r.cycles[0].charges.cycles, 3);
  close('3f then 60 s of silence', r.cycles[0].charges.reloadSeconds, 60, 0);
  // WHILE IT RUNS: 390 / 4 s
  close('3g burst is 97.5 hp/s', burstHpsOf(r.cycles, 'shield'), 97.5, 1e-9);
  // ACROSS THE RELOAD: 3 x 390 hp over (3 x 4 + 60) s = 1170 / 72
  close('3h but it only sustains 16.25 hp/s', dutyHpsOf(r.cycles, 'shield'), 16.25, 1e-9);
  eq('3i which is the whole point: burst and duty differ 6-fold',
    r.cycles[0].burstHps / r.cycles[0].dutyHps > 5.9, true);
  // charges pay the capacitor cost, so it draws nothing while loaded
  close('3j and it costs no capacitor while loaded', r.cycles[0].capPerCycle, 0, 0);
}

// ---------------------------------------------------------------------------
// 4. THE MULTIPLIER THE ENGINE DOES NOT APPLY.
//    Large Ancillary Armor Repairer + Nanite Repair Paste on a Myrmidon.
//    Measured: 84=712.25, 73=11250, 6=400, 1795=60000, 56=8, -8=64,
//    1886=3 — and the engine has NOT multiplied by it.
// ---------------------------------------------------------------------------
{
  const loaded = repairCycles(fit([
    item(41475, [13, 16, 5275],
      { 84: 712.25, 73: 11250, 6: 400, 1795: 60000, 56: 8, '-8': 64, 1886: 3 },
      { charge: 28668 }),
  ]));
  close('4a paste triples the repair: 712.25 x 3', loaded.cycles[0].amount, 2136.75, 1e-9);
  eq('4b 64 paste at 8 per cycle is 8 cycles', loaded.cycles[0].charges.cycles, 8);
  close('4c burst 2136.75 / 11.25 s', loaded.cycles[0].burstHps, 189.93333333333334, 1e-9);
  // 8 x 2136.75 = 17094 hp over (8 x 11.25 + 60) = 150 s
  close('4d sustained across the reload', loaded.cycles[0].dutyHps, 113.96, 1e-9);
  eq('4e an armour repairer heals at the END of its cycle', loaded.cycles[0].timing, 'end');
  close('4f and unlike the shield ancillary it still burns cap',
    loaded.cycles[0].capPerCycle, 400, 0);

  // the SAME module with no paste is a plain repairer at the base amount
  const empty = repairCycles(fit([
    item(41475, [13, 16, 5275],
      { 84: 712.25, 73: 11250, 6: 400, 1795: 60000, 56: 8, 1886: 3 }),
  ]));
  close('4g with no paste it repairs 712.25, NOT 2136.75', empty.cycles[0].amount, 712.25, 1e-9);
  eq('4h and has no charges to run out of', empty.cycles[0].charges, null);
}

// ---------------------------------------------------------------------------
// 5. WHAT MUST NOT BE COUNTED AS YOUR OWN TANK.
// ---------------------------------------------------------------------------
{
  // a remote armour repairer carries attribute 84 exactly like a local one.
  // Only the EFFECT id distinguishes them, which is why effects are read.
  const remote = repairCycles(fit([
    item(23790, [6188, 13, 16], { 84: 1265, 73: 11250, 6: 400 }),
  ]));
  eq('5a a REMOTE armour repairer is not your own tank', remote.cycles.length, 0);

  const remoteShield = repairCycles(fit([
    item(23792, [6186, 13, 16], { 68: 276, 73: 4000, 6: 144 }),
  ]));
  eq('5b nor is a remote shield booster', remoteShield.cycles.length, 0);

  const off = repairCycles(fit([
    item(10858, [4, 13, 16], { 68: 276, 73: 4000, 6: 144 }, { state: 'Passive' }),
  ]));
  eq('5c a module that is switched off repairs nothing', off.cycles.length, 0);

  const overheated = repairCycles(fit([
    item(10858, [4, 13, 16], { 68: 320, 73: 3400, 6: 144 }, { state: 'Overload' }),
  ]));
  eq('5d an OVERLOADED one does count', overheated.cycles.length, 1);
}

// ---------------------------------------------------------------------------
// 6. REFUSE RATHER THAN MISLEAD. An abyssal module can carry the repair
//    effect with no amount or no duration. Zero would be indistinguishable
//    from a fit with no tank at all.
// ---------------------------------------------------------------------------
{
  const noAmount = repairCycles(fit([item(60001, [27], { 73: 11250, 6: 400 })]));
  eq('6a a repairer with no amount is refused, not scored 0', noAmount.cycles.length, 0);
  eq('6b and is reported by type id', noAmount.refused.length, 1);
  eq('6c saying which side it belonged to', noAmount.refused[0].kind, 'armor');

  const noDuration = repairCycles(fit([item(60002, [4], { 68: 276 })]));
  eq('6d likewise one with no cycle duration', noDuration.refused.length, 1);
}

// ---------------------------------------------------------------------------
// 7. HULL REPAIR, which nothing counted before.
// ---------------------------------------------------------------------------
{
  const r = repairCycles(fit([item(3653, [26, 13, 16], { 83: 285, 73: 10500, 6: 90 })]));
  eq('7a a hull repairer is found', r.cycles.length, 1);
  eq('7b as hull', r.cycles[0].kind, 'hull');
  close('7c 285 hp per 10.5 s', r.cycles[0].burstHps, 285 / 10.5, 1e-12);
}

// ---------------------------------------------------------------------------
// 8. THE CAPACITOR. Verified shape, not a quoted formula.
// ---------------------------------------------------------------------------
{
  const cap = { capacity: 5000, tau: 800 };

  // the peak sits at 25% capacitor — the reason a cap-unstable fit can idle
  // stably at a quarter bar
  close('8a peak recharge is 2.5 x Cmax / tau',
    capPeakRecharge(cap), (2.5 * 5000) / 800, 1e-12);
  close('8b and it occurs at 25% capacitor',
    capRecharge(0.25 * 5000, cap), capPeakRecharge(cap), 1e-12);
  let best = 0, bestAt = 0;
  for (let f = 0.01; f < 1; f += 0.001) {
    const v = capRecharge(f * 5000, cap);
    if (v > best) { best = v; bestAt = f; }
  }
  close('8c ...confirmed by sweeping the whole bar', bestAt, 0.25, 0.002);

  // a full capacitor neither gains nor loses
  close('8d a full capacitor recharges at zero', capRecharge(5000, cap), 0, 1e-9);
  close('8e and stays full', capAfter(5000, 30, cap), 5000, 1e-9);

  // an EMPTY capacitor does recover — sqrt(0) is a valid starting point
  eq('8f an empty capacitor recovers', capAfter(0, 10, cap) > 0, true);

  // THE CLOSED FORM MUST AGREE WITH ITS OWN DERIVATIVE. If capAfter and
  // capRecharge described different curves, a simulation that jumps between
  // events would drift away from one that steps.
  let stepped = 1000;
  const dt = 0.001;
  for (let i = 0; i < 20000; i++) stepped += capRecharge(stepped, cap) * dt;
  const jumped = capAfter(1000, 20, cap);
  close('8g integrating the rate matches the closed form', stepped, jumped, 0.02);

  // and jumping in one step matches jumping in many
  let many = 1000;
  for (let i = 0; i < 40; i++) many = capAfter(many, 0.5, cap);
  close('8h and the jump composes exactly', many, jumped, 1e-9);

  // degenerate hulls must not produce NaN
  eq('8i a hull with no capacitor is handled',
    Number.isFinite(capAfter(0, 5, { capacity: 0, tau: 0 })), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
