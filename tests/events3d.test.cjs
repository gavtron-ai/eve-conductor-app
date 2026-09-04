// TRUE 3D MOTION (v0.93.0). Every expected value below was computed BY HAND
// (or is explicitly labelled a model-internal regression pin). These assert
// the geometry the 1D model could never express: three ships with two
// distinct same-side positions, elevation, emergent orbit behaviour, and
// ordnance that chases real trajectories.
const {
  simulateBattleEvents, DECLARED,
} = require('./sim/lib/battleEvents.js');

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
const inBand = (l, g, lo, hi) => {
  const ok = g !== null && g !== undefined && g >= lo && g <= hi;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `   got=${g} band=[${lo}, ${hi}]`}`);
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
  projected: o.projected,
  droneControlRangeM: o.droneControlRangeM,
  capacitor: o.capacitor ?? DEAD_CAP,
  layers: o.layers ?? [
    { name: 'Shield', hp: o.shield ?? 0, resonance: NO_RES },
    { name: 'Armor', hp: o.armor ?? 0, resonance: NO_RES },
    { name: 'Hull', hp: o.hull ?? 0, resonance: NO_RES },
  ],
  signatureRadius: o.sig ?? 100000,
  flying: o.flying ?? { speed: 0, angleDeg: 0 },
  range: o.range ?? 1000,
  commandedRange: o.commandedRange,
  pos0: o.pos0,
  behaviour: o.behaviour,
  anchorId: o.anchorId,
  tauActive: o.tauActive,
  scanRes: o.scanRes,
  sensor: o.sensor,
});

const dist3 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// ---------------------------------------------------------------------------
// G0. THE DECLARED SET actually changed - the tick is real, the old range
//     convention is gone.
// ---------------------------------------------------------------------------
eq('G0a SERVER_TICK_SECONDS is 1', DECLARED.SERVER_TICK_SECONDS, 1);
eq('G0b true positions declared', DECLARED.TRUE_POSITIONS_3D, true);
eq('G0c the per-ship range convention is dead', DECLARED.RANGE_IS_PER_SHIP, undefined);
eq('G0d lead-pursuit missiles declared', DECLARED.MISSILE_INTERCEPT_LEAD_PURSUIT, true);

// ---------------------------------------------------------------------------
// G1. THE OWNER'S SCENARIO - the fixture the 1D model could never express.
//     Guardian at the origin. Tengu parked at 10 km. Hyena circles the
//     Guardian at EXACTLY 100 km (legacy dial 90 = the analytic circle) at
//     2000 m/s, period 2*pi*1e5/2000 = 314.159 s.
//     HAND-DERIVED: Tengu-Hyena distance = sqrt(10^2 + 100^2 - 2*10*100*
//     cos(0.02t)) km - minimum 90 km (t=0 exactly), maximum 110 km at the
//     half period; 1 Hz sampling misses the true extremes by well under a
//     metre at this angular rate (0.02 rad/s). Guardian-Hyena is EXACTLY
//     100 km at every sample - the circle is analytic.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('T', 'a', { shield: 1e6, range: 10000 }),
    ship('H', 'a', { shield: 1e6, range: 100000, flying: { speed: 2000, angleDeg: 90 } }),
    ship('G', 'b', { shield: 1e6 }),
  ], { maxSeconds: 340 });
  let minTH = Infinity, maxTH = -Infinity, maxGHerr = 0, maxZ = 0;
  for (const row of r.series) {
    const dTH = dist3(row.pos.T, row.pos.H);
    const dGH = dist3(row.pos.G, row.pos.H);
    if (dTH < minTH) minTH = dTH;
    if (dTH > maxTH) maxTH = dTH;
    maxGHerr = Math.max(maxGHerr, Math.abs(dGH - 100000));
    maxZ = Math.max(maxZ, Math.abs(row.pos.H[2]));
  }
  close('G1a Tengu-Hyena minimum is 90 km (t=0 exact)', minTH, 90000, 1e-6);
  inBand('G1b Tengu-Hyena maximum reaches 110 km (1 Hz sample slop < 1 m)',
    maxTH, 109999, 110000 + 1e-6);
  close('G1c Guardian-Hyena is EXACTLY 100 km at every sample', maxGHerr, 0, 1e-6);
  close('G1d the legacy orbit stays in its declared plane (z = 0)', maxZ, 0, 1e-9);
  close('G1e Hyena range series reads its target distance (100 km)',
    r.series[0].range.H, 100000, 1e-6);
}

// ---------------------------------------------------------------------------
// G2. THE LIVE BUG, GEOMETRIC FOREVER: the Guardian's 60 km-control drones
//     deal EXACTLY ZERO to a Hyena circling it at 100 km - the pair distance
//     that gates control is the CONSTANT 100 km circle radius. The drones DO
//     fly out (chase solve: |1e5 - 700| / 2500 = 39.72 s to the shell) and
//     then hit for nothing.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('H', 'a', { shield: 1e6, range: 100000, flying: { speed: 2000, angleDeg: 90 } }),
    ship('G', 'b', {
      shield: 1e6, droneControlRangeM: 60000,
      weapons: [gun(100, 4, { kind: 'drone', droneSpeed: 2500, droneOrbit: 700 })],
    }),
  ], { maxSeconds: 120 });
  const G = r.ships.find((x) => x.id === 'G');
  const H = r.ships.find((x) => x.id === 'H');
  close('G2a drones beyond control range deal EXACTLY zero', G.damageDealt, 0, 1e-12);
  eq('G2b the Hyena is untouched', H.remaining[0], 1);
  eq('G2c nobody finishes it', r.winner, null);
}

// ---------------------------------------------------------------------------
// G3. ELEVATION IS REAL - vector kinematics no dial could fake. Attacker
//     parked at range 10 km, elevation 45 degrees: pos0 = (10000/sqrt(2), 0,
//     10000/sqrt(2)). Target at the origin flies HORIZONTALLY at 500 m/s
//     (behaviour 'vector'). True vectors give transversal = |d x u|/|d| =
//     500/sqrt(2) = 353.5533905932738 - the old model output 0 or 500 from
//     the dial, never this split.
// ---------------------------------------------------------------------------
{
  const E = 7071.067811865476; // 10000 / sqrt(2)
  const r = simulateBattleEvents([
    ship('A', 'a', { shield: 1e6, pos0: { x: E, y: 0, z: E } }),
    ship('B', 'b', {
      shield: 1e6, flying: { speed: 500, angleDeg: 0 },
      behaviour: { kind: 'vector', dir: { x: 1, y: 0, z: 0 } },
    }),
  ], { maxSeconds: 5 });
  const at = (t) => r.series.find((p) => p.t === t);
  close('G3a range opens at exactly 10 km slant', at(0).range.A, 10000, 1e-9);
  close('G3b the 45-degree transversal split: 500/sqrt(2)',
    at(0).transversal.A, 353.5533905932738, 1e-9);
  close('G3c the horizontal runner moves as commanded (t=1 range)',
    at(1).range.A, Math.hypot(E - 500, 0, E), 1e-6);
  close('G3d target speed rides the vector', at(2).speed.B, 500, 1e-9);
}

// ---------------------------------------------------------------------------
// G4. NON-COPLANAR QUARTET - the anti-planar guard. Three attackers on the
//     three axes at 10 km, target at the origin: every pairwise attacker
//     distance is 10*sqrt(2) km and the four ships span a tetrahedron of
//     volume 1e12/6 - impossible in any planar or collinear collapse.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('X', 'a', { shield: 1e6, pos0: { x: 10000, y: 0, z: 0 } }),
    ship('Y', 'a', { shield: 1e6, pos0: { x: 0, y: 10000, z: 0 } }),
    ship('Z', 'a', { shield: 1e6, pos0: { x: 0, y: 0, z: 10000 } }),
    ship('O', 'b', { shield: 1e6 }),
  ], { maxSeconds: 3 });
  const p = r.series[0].pos;
  const RT2 = 14142.135623730951; // 10000 * sqrt(2)
  close('G4a X-Y span', dist3(p.X, p.Y), RT2, 1e-9);
  close('G4b Y-Z span', dist3(p.Y, p.Z), RT2, 1e-9);
  close('G4c X-Z span', dist3(p.X, p.Z), RT2, 1e-9);
  const det = p.X[0] * (p.Y[1] * p.Z[2] - p.Y[2] * p.Z[1])
    - p.X[1] * (p.Y[0] * p.Z[2] - p.Y[2] * p.Z[0])
    + p.X[2] * (p.Y[0] * p.Z[1] - p.Y[1] * p.Z[0]);
  close('G4d tetrahedron volume 1e12/6 - genuinely three-dimensional',
    Math.abs(det) / 6, 1e12 / 6, 1);
}

// ---------------------------------------------------------------------------
// G5. THE ORBIT CONTROLLER, tau = 0: tangent-point pursuit converges onto
//     the commanded circle and polygon-orbits it. HAND-DERIVED BAND: every
//     leg is a chord of the tangent line, whose closest approach to the
//     centre is exactly R; a 500 m/s ship overshoots the tangent point by at
//     most a full chord, so the radius at any vertex lies in
//     [R, sqrt(R^2 + L^2)] = [10000, 10012.4922...]. Convergence from 20 km
//     takes ~35 ticks (the tangent distance shrinks ~500 m per tick).
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      shield: 1e6, range: 20000, flying: { speed: 500, angleDeg: 0 },
      behaviour: { kind: 'orbit', radiusM: 10000 },
    }),
    ship('B', 'b', { shield: 1e6 }),
  ], { maxSeconds: 120 });
  let lo = Infinity, hi = -Infinity;
  for (const row of r.series) {
    if (row.t < 60) continue;
    const d = dist3(row.pos.A, row.pos.B);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  const HI = Math.sqrt(10000 * 10000 + 500 * 500);
  inBand('G5a settled orbit never dips inside the commanded circle', lo, 10000 - 1e-6, HI);
  inBand('G5b ... and never wanders past the chord bound sqrt(R^2+L^2)', hi, 10000 - 1e-6, HI + 1e-6);
  close('G5c a tau-less ship keeps full speed on the polygon', r.series.at(-1).speed.A, 500, 1e-9);
}

// ---------------------------------------------------------------------------
// G6. ORBIT INFLATION EMERGES - the heavy/fast case. tau = 20 s at 4000 m/s
//     commanded onto a 500 m orbit: the lag law cannot turn that tightly and
//     the orbit settles far outside the commanded ring with real speed loss
//     (EVE's documented MWD-orbit behaviour). The exact settled numbers are
//     a MODEL-INTERNAL REGRESSION PIN of the declared controller (game-truth
//     calibration is a pending in-game measurement); the qualitative asserts
//     - far outside 500 m, well below 4000 m/s - are the physics.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      shield: 1e6, range: 20000, flying: { speed: 4000, angleDeg: 0 },
      tauActive: 20,
      behaviour: { kind: 'orbit', radiusM: 500 },
    }),
    ship('B', 'b', { shield: 1e6 }),
  ], { maxSeconds: 300 });
  let lo = Infinity, hi = -Infinity, vlo = Infinity, vhi = -Infinity;
  for (const row of r.series) {
    if (row.t < 200) continue;
    const d = dist3(row.pos.A, row.pos.B);
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
    vlo = Math.min(vlo, row.speed.A);
    vhi = Math.max(vhi, row.speed.A);
  }
  inBand('G6a the settled orbit sits FAR outside the commanded 500 m', lo, 2000, 1e9);
  inBand('G6b speed is genuinely lost to turning (documented behaviour)', vhi, 100, 3999);
  // THE STEADY-STATE IDENTITY of the declared law (model-internal, the
  // closed-form cross-check): a settled circle at speed v under tau-lag
  // requires r = tau*v^2/sqrt(vmax^2 - v^2). The polygon wobbles around the
  // curve, so assert the midpoints agree within 15%.
  const vMid = (vlo + vhi) / 2;
  const rMid = (lo + hi) / 2;
  const rPredicted = 20 * vMid * vMid / Math.sqrt(4000 * 4000 - vMid * vMid);
  inBand('G6c emergent radius sits on the declared steady-state curve (15%)',
    rMid / rPredicted, 0.85, 1.15);
  console.log(`      (model-internal settled values: r in [${lo.toFixed(1)}, ${hi.toFixed(1)}], v in [${vlo.toFixed(1)}, ${vhi.toFixed(1)}]; curve predicts r=${rPredicted.toFixed(1)} at v=${vMid.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
// G7. DETERMINISM IN 3D - orbits, elevation, a spiral dial and seeded ECM
//     together: same seed, byte-identical fight; and the ECM actually drew.
// ---------------------------------------------------------------------------
{
  const ecm = {
    slotKey: 'Med1', kind: 'ecm', cycleSeconds: 20, capPerCycle: 0,
    optimal: 1e6, falloff: 0, rows: [],
    jamStrength: { grav: 10, ladar: 10, mag: 10, radar: 10 },
    jamSeconds: 20,
  };
  const build = () => [
    ship('A1', 'a', {
      shield: 5e4, weapons: [gun(120, 2.3)], scanRes: 500,
      sensor: { attr: 211, strength: 20 },
      pos0: { x: 8000, y: 0, z: 6000 },
      behaviour: { kind: 'orbit', radiusM: 8000 },
      flying: { speed: 900, angleDeg: 0 }, tauActive: 4,
    }),
    ship('A2', 'a', {
      shield: 4e4, weapons: [gun(80, 1.7)], scanRes: 600,
      sensor: { attr: 209, strength: 18 },
      range: 12000, flying: { speed: 400, angleDeg: 45 },
    }),
    ship('B1', 'b', {
      shield: 6e4, weapons: [gun(150, 3.1)], scanRes: 400,
      sensor: { attr: 210, strength: 22 }, projected: [ecm],
    }),
  ];
  const r1 = simulateBattleEvents(build(), { maxSeconds: 200, seed: 7 });
  const r2 = simulateBattleEvents(build(), { maxSeconds: 200, seed: 7 });
  eq('G7a same seed, byte-identical 3D fight', JSON.stringify(r1) === JSON.stringify(r2), true);
  inBand('G7b the ECM really rolled (draws > 0)', r1.drawCount, 1, 1e6);
}

// ---------------------------------------------------------------------------
// G8. ORDNANCE OUTLIVES ITS SHOOTER'S SIDE - mutual annihilation. A's slow
//     missile (10 km at 1000 m/s = 10 s flight) is in the air when B's gun
//     kills A at t=0. The missile still lands at t=10 and kills B: winner
//     null, decided at 10.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      hull: 1, range: 10000,
      weapons: [gun(100, 60, {
        kind: 'missile', missileVelocity: 1000, maxRange: 20000,
        expRadius: 100, expVelocity: 1e9, drf: 1,
      })],
    }),
    ship('B', 'b', { shield: 50, weapons: [gun(10, 1)] }),
  ], { maxSeconds: 60 });
  eq('G8a mutual annihilation', r.winner, null);
  const B = r.ships.find((x) => x.id === 'B');
  close('G8b the orphaned missile lands at its true intercept t=10', B.diedAt, 10, 1e-9);
  close('G8c decided when the last death landed', r.seconds, 10, 1e-9);
}

// ---------------------------------------------------------------------------
// G9. DRONES ARRIVE AT THE SHELL, NOT THE CENTRE - travel to a stationary
//     target 10.7 km out with a 700 m orbit radius at 2000 m/s is EXACTLY
//     (10700-700)/2000 = 5.0 s; the first volley fires on arrival.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      shield: 1e6, range: 10700,
      weapons: [gun(100, 4, { kind: 'drone', droneSpeed: 2000, droneOrbit: 700 })],
    }),
    ship('B', 'b', { shield: 100 }),
  ], { maxSeconds: 60 });
  const B = r.ships.find((x) => x.id === 'B');
  close('G9a shell arrival at exactly 5 s kills on the first volley', B.diedAt, 5, 1e-9);
}

// ---------------------------------------------------------------------------
// G10. KITING DRONES OUT IS REAL - a 600 m/s runner outpaces 500 m/s drones
//      forever; they never arrive, and deal nothing.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      shield: 1e6, range: 5000,
      weapons: [gun(100, 4, { kind: 'drone', droneSpeed: 500, droneOrbit: 700 })],
    }),
    ship('B', 'b', { shield: 100, flying: { speed: 600, angleDeg: 180 } }),
  ], { maxSeconds: 60 });
  const A = r.ships.find((x) => x.id === 'A');
  close('G10a outrun drones never land a volley', A.damageDealt, 0, 1e-12);
  eq('G10b the runner lives', r.winner, null);
}

// ---------------------------------------------------------------------------
// G11. ANCHOR DEATH (v0.98.2) - a ship whose EXPLICIT anchor dies re-anchors
//      on its NEAREST LIVING ALLY (logged), never on the enemy. S keeps
//      range 5 km on ally A2; when A2 dies, the nearest ally is A3 at
//      (30 km, 0, 0) - S burns over and holds the exact 5 km ring there
//      (tau-less keep-at-range is the analytic circle, so sampled distance
//      is exact).
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('S', 'a', {
      shield: 1e6, range: 10000, flying: { speed: 400, angleDeg: 0 },
      behaviour: { kind: 'keepAtRange', rangeM: 5000 }, anchorId: 'A2',
    }),
    ship('A2', 'a', { shield: 50, range: 20000 }),
    ship('A3', 'a', { shield: 1e6, range: 30000 }),
    ship('B', 'b', { shield: 1e6, weapons: [gun(100, 4)] }),
  ], { maxSeconds: 90 });
  const lost = r.events.find((e) => e.kind === 'anchorLost');
  eq('G11a the anchor loss is on the timeline', lost !== undefined, true);
  eq('G11b ...and names the NEW anchor (the nearest living ally)',
    lost?.detail?.includes('A3') ?? false, true);
  const at85 = r.series.find((p) => p.t === 85);
  const d = dist3(at85.pos.S, at85.pos.A3);
  close('G11c S holds its exact 5 km ring on the new anchor', d, 5000, 1);
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
