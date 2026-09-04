// RELOAD, and DRONES-ARE-NOT-TURRETS. Against the SHIPPED compiled code.
//
// Every number below was measured by running the shipped WASM under node
// (app/probe-reload.mjs), not estimated.
const { summarize } = require('./sim/lib/fitSummary.js');
const S = require('./sim/lib/fitSim.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};
const close = (l, g, w, tol = 1e-6) => {
  const ok = Math.abs(g - w) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `   got=${g} want=${w}`}`);
  ok ? pass++ : fail++;
};

const at = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), { value: v }]));
const hull = { attributes: at({ 263: 1000, 265: 1000, 9: 1000 }) };

// ===========================================================================
// 1. RELOAD — the real Caracal numbers off the shipped engine.
//    5x Rapid Light Missile Launcher II: duration 3222.18 ms, cycle-with-
//    reload 4972.179891345704 ms, clip 20, reload 1749.9998913457039 ms.
//    Engine reported hull -12 = 247.50324314593286, hull -13 = 160.39242694904948.
// ===========================================================================
const RLML = 24519, FURY = 24515;
const launcher = () => ({
  type_id: RLML, state: 'Active', slot: { type: 'High' },
  attributes: at({ 51: 3222.1800000000003, 64: 1, '-8': 20.00000124176346,
    '-15': 1749.9998913457039, '-16': 4972.179891345704 }),
  charge: { type_id: FURY, attributes: at({ 117: 159.50000000000003 }) },
});
{
  const r = summarize({ hull, items: Array.from({ length: 5 }, launcher) });
  close('1a alpha dps matches the engine hull -12', r.dps, 247.50324314593286, 1e-6);
  close('1b SUSTAINED dps matches the engine hull -13', r.dpsSustained, 160.39242694904948, 1e-6);
  eq('1c sustained is materially lower — this is the 35% the app was hiding',
    Math.round((1 - r.dpsSustained / r.dps) * 100), 35);
  close('1d per-weapon sustained', r.weapons[0].dpsSustained, 32.078485389809896, 1e-6);
  // A Rapid Light Missile Launcher II holds TWENTY missiles. This fixture used
  // to assert the engine's raw 20.00000124176346 — a fact about the arithmetic
  // rather than about EVE, which is exactly backwards. The engine's -8 is an
  // unrounded capacity/volume division; the clip is a whole number of rounds.
  eq('1e a Rapid Light Missile Launcher II holds 20 missiles', r.weapons[0].clipSize, 20);
  close('1f reload seconds', r.weapons[0].reloadSeconds, 1.7499998913457039, 1e-9);
}

// ===========================================================================
// 2. AUTOCANNONS BARELY CARE — 120 rounds, 83 ms reload. Engine: -12 =
//    134.41889968935163, -13 = 128.0933047841225 for 3x 200mm AutoCannon II.
// ===========================================================================
{
  const gun = () => ({
    type_id: 2889, state: 'Active', slot: { type: 'High' },
    attributes: at({ 51: 1687.5, 64: 1, '-8': 120.00000745058077,
      '-15': 83.33332815931959, '-16': 1770.8333281593195 }),
    charge: { type_id: 12608, attributes: at({ 114: 75.61063730507905 }) },
  });
  const r = summarize({ hull, items: Array.from({ length: 3 }, gun) });
  // 1e-4 not 1e-6: the per-shot EMP damage above was transcribed to 16 digits
  // from a reverse-computed value, so the INPUT carries ~1e-9 relative error.
  // The engine figures on the right are exact; the gap is my transcription.
  close('2a alpha', r.dps, 134.41889968935163, 1e-4);
  close('2b sustained', r.dpsSustained, 128.0933047841225, 1e-4);
  eq('2c only a 5% haircut, unlike the launcher',
    Math.round((1 - r.dpsSustained / r.dps) * 100), 5);
}

// ===========================================================================
// 3. THE SMARTBOMB TRAP. A Small EMP Smartbomb II has NO charge, NO clip and
//    no reloadTime in the SDE — yet the engine hands back speedOfReload 10000
//    and cycleWithReload 17500, and its hull -13 (13.33) comes back HIGHER
//    than its alpha -12 (9.33), which is impossible. Neither must be believed.
// ===========================================================================
{
  const bomb = {
    type_id: 14212, state: 'Active', slot: { type: 'High' },
    // note: duration lives on 73, not 51, for a smartbomb
    attributes: at({ 73: 7500, 114: 70, '-15': 10000, '-16': 17500 }),
    charge: null,
  };
  const r = summarize({ hull, items: [bomb] });
  close('3a alpha dps is 70 em over a 7.5 s cycle', r.dps, 9.333333333333334, 1e-9);
  eq('3b a weapon with no charge reports NO sustained figure', r.weapons[0].dpsSustained, undefined);
  close('3c ...and contributes its full alpha to the sustained total, because it '
    + 'genuinely does sustain it', r.dpsSustained, 9.333333333333334, 1e-9);
  eq('3d sustained is never above alpha', r.dpsSustained <= r.dps, true);
  eq('3e no clip size is invented', r.weapons[0].clipSize, undefined);
}

// ===========================================================================
// 4. DRONES ARE NOT TURRETS.
//    Ogre II publishes tracking 0.54, optimal 4200, falloff 5000 — measured
//    from the SHIP those made a Dominix read ZERO applied dps at 30 km.
// ===========================================================================
const ogre = {
  type_id: 2446, state: 'Active', slot: { type: 'DroneBay' },
  attributes: at({ 51: 4000, 64: 1, 118: 120, 160: 0.54, 54: 7218.75, 158: 5000, 620: 400, 37: 1200 }),
  charge: null,
};
{
  const w = S.simWeapon(ogre);
  eq('4a a DroneBay slot classifies as a drone, not a turret', w.kind, 'drone');
  eq('4b its own optimal is NOT used as a range limit', w.optimal, undefined);
  eq('4c its speed is carried for the caveat', w.droneSpeed, 1200);

  const target = { name: 'cruiser', signatureRadius: 145, velocity: 0, resonance: S.NO_RESISTS };
  const near = S.applicationOf(w, target, { distance: 1000, transversal: 0 });
  const far = S.applicationOf(w, target, { distance: 30000, transversal: 0 });
  eq('4d a stationary target is hit just as hard at 30 km as at 1 km', far, near);
  eq('4e ...and that is full application, not zero', far, S.turretDamageMultiplier(1));

  // the OLD behaviour, for the record: as a turret it would be dead at 30 km
  const asTurret = { ...w, kind: 'turret', optimal: 7218.75, falloff: 5000 };
  eq('4f scored as a hull turret the same drone reads zero at 30 km',
    S.applicationOf(asTurret, target, { distance: 30000, transversal: 0 }) < 0.001, true);
}

// ===========================================================================
// 5. DRONE TRACKING STILL BITES — against a FAST target, at the drone's own
//    orbit. This is the honest half: drones do struggle with fast frigates.
// ===========================================================================
{
  const w = S.simWeapon(ogre);
  const frig = { name: 'frig', signatureRadius: 35, velocity: 1500, resonance: S.NO_RESISTS };
  const slow = { name: 'bs', signatureRadius: 400, velocity: 0, resonance: S.NO_RESISTS };
  const vsFrig = S.applicationOf(w, frig, { distance: 5000, transversal: 0, droneOrbit: 1000 });
  const vsBs = S.applicationOf(w, slow, { distance: 5000, transversal: 0, droneOrbit: 1000 });
  eq('5a a heavy drone applies far worse to a fast frigate', vsFrig < vsBs * 0.5, true);
  // angular = 1500/1000 = 1.5 rad/s; term = 1.5*400/(0.54*35) = 31.75 -> ~0
  eq('5b ...in fact almost nothing', vsFrig < 0.01, true);
  eq('5c a tighter orbit means MORE angular velocity and worse tracking',
    S.applicationOf(w, frig, { distance: 5000, transversal: 0, droneOrbit: 500 })
    <= S.applicationOf(w, frig, { distance: 5000, transversal: 0, droneOrbit: 5000 }), true);
  eq('5d the SHIPS\' transversal is irrelevant to a drone',
    S.applicationOf(w, slow, { distance: 5000, transversal: 3000, droneOrbit: 1000 }), vsBs);
}

// ===========================================================================
// 6. DRONE CONTROL RANGE — the real limit, and only when the caller knows it.
// ===========================================================================
{
  const w = S.simWeapon(ogre);
  const t = { name: 'bs', signatureRadius: 400, velocity: 0, resonance: S.NO_RESISTS };
  eq('6a inside control range the drone fights',
    S.applicationOf(w, t, { distance: 40000, transversal: 0, droneControlRange: 60000 }) > 0, true);
  eq('6b past it, nothing',
    S.applicationOf(w, t, { distance: 70000, transversal: 0, droneControlRange: 60000 }), 0);
  eq('6c with no control range supplied, NO limit is claimed',
    S.applicationOf(w, t, { distance: 500000, transversal: 0 }) > 0, true);
  eq('6d the un-skilled base is EVE\'s 20 km', S.BASE_DRONE_CONTROL_RANGE, 20000);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
