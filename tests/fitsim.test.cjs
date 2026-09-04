// FIXTURES FOR THE APPLICATION LAYER — hand-computed, against the SHIPPED code.
//
// Every expectation here is either an analytic identity (a point where the
// formula must give exactly 0.5, or exactly 1) or a number worked out by hand
// below. Nothing is eyeballed from a run.
const S = require('./sim/lib/fitSim.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n      got=${JSON.stringify(got)}\n     want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const close = (label, got, want, tol = 1e-9) => {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${got} want=${want}`}`);
  ok ? pass++ : fail++;
};

// ===========================================================================
// 1. TURRET CHANCE TO HIT — the analytic anchor points.
//    hit = 0.5 ^ [ (angular*sigRes/(tracking*sig))^2 + (max(0,d-optimal)/falloff)^2 ]
// ===========================================================================
// a clean turret: optimal 10 km, falloff 5 km, tracking 0.1, sigRes 40000
const turret = {
  typeId: 1, kind: 'turret', cycleSeconds: 5,
  volley: { em: 0, thermal: 0, kinetic: 100, explosive: 0 },
  optimal: 10000, falloff: 5000, tracking: 0.1, sigResolution: 40000,
};

eq('1a a motionless target inside optimal is a certain hit',
  S.turretChanceToHit(turret, 5000, 0, 100), 1);
close('1b at optimal+falloff with no transversal the range term alone halves it',
  S.turretChanceToHit(turret, 15000, 0, 100), 0.5);
close('1c at optimal+2*falloff the exponent is 4, so 0.5^4',
  S.turretChanceToHit(turret, 20000, 0, 100), 0.0625);
// tracking term = 1 when angular*sigRes == tracking*sig
//   angular = tracking*sig/sigRes = 0.1*100/40000 = 0.00025 rad/s
close('1d the tracking term alone halves it at its characteristic angular velocity',
  S.turretChanceToHit(turret, 5000, 0.00025, 100), 0.5);
// both terms at 1 => exponent 2 => 0.25
close('1e both terms together multiply, they do not average',
  S.turretChanceToHit(turret, 15000, 0.00025, 100), 0.25);
// double the signature, halve the tracking difficulty
close('1f a target twice the size is twice as easy to track',
  S.turretChanceToHit(turret, 5000, 0.0005, 200), 0.5);
eq('1g no falloff past optimal is a hard wall, not a divide-by-zero',
  S.turretChanceToHit({ ...turret, falloff: 0 }, 10001, 0, 100), 0);
eq('1h ...but exactly at optimal it still hits',
  S.turretChanceToHit({ ...turret, falloff: 0 }, 10000, 0, 100), 1);

// ===========================================================================
// 2. TURRET DAMAGE MULTIPLIER — 0.5 * min(h^2 + 0.98h + 0.0501, 6h)
// ===========================================================================
close('2a a certain hit averages slightly OVER 1x, because 1% wreck at 3x',
  S.turretDamageMultiplier(1), 1.01505);
// at h=0.01 the wrecking branch binds exactly: 0.5*6*0.01 = 0.03 = 0.01*3
close('2b at 1% hit chance the only hits are wrecking hits: 0.01 x 3',
  S.turretDamageMultiplier(0.01), 0.03);
eq('2c zero hit chance is zero damage', S.turretDamageMultiplier(0), 0);
// h=0.5: 0.5*min(0.25+0.49+0.0501, 3) = 0.5*0.7901
close('2d half hit chance', S.turretDamageMultiplier(0.5), 0.39505);
eq('2e the multiplier is monotonic in hit chance',
  [0, 0.1, 0.25, 0.5, 0.75, 1].map(S.turretDamageMultiplier)
    .every((v, i, a) => i === 0 || v > a[i - 1]), true);

// ===========================================================================
// 3. MISSILES — the formula whose exponent convention was nearly wrong.
//    min(1, S/E, ((S/E)*(Ve/Vt))^drf)
//
//    Values below are the REAL Scourge Rage Torpedo, read from the shipped
//    bundle: expRadius 697 m, expVelocity 67 m/s, drf 0.967.
// ===========================================================================
const torp = {
  typeId: 2, kind: 'missile', cycleSeconds: 12,
  volley: { em: 0, thermal: 0, kinetic: 1000, explosive: 0 },
  expRadius: 697, expVelocity: 67, drf: 0.967, maxRange: 30000,
};

// stationary Raven, sig 410: velocity term drops out, S/E binds
close('3a vs a stationary battleship only the signature term binds (410/697)',
  S.missileDamageFactor(torp, 410, 0), 410 / 697, 1e-12);
// a huge stationary target: capped at 1, never above
eq('3b application is never over 100%', S.missileDamageFactor(torp, 20000, 0), 1);
// moving Raven at 113 m/s: ((410/697)*(67/113))^0.967
{
  const want = Math.min(1, 410 / 697, Math.pow((410 / 697) * (67 / 113), 0.967));
  close('3c vs a moving battleship the velocity term binds', S.missileDamageFactor(torp, 410, 113), want, 1e-12);
}
// THE DIRECTION TEST — the one the log(drf)/log(5.5) convention gets backwards.
{
  const slow = S.missileDamageFactor(torp, 35, 365);
  const fast = S.missileDamageFactor(torp, 35, 3000);
  eq('3d a FASTER target takes LESS missile damage (the sign of the exponent)', fast < slow, true);
  eq('3e ...and a torpedo barely scratches a fast frigate', fast < 0.02, true);
}
eq('3f a missile past its flight range simply does not arrive',
  S.applicationOf(torp, { name: 't', signatureRadius: 410, velocity: 0, resonance: S.NO_RESISTS },
    { distance: 30001, transversal: 0 }), 0);
close('3g ...and inside it, applies normally',
  S.applicationOf(torp, { name: 't', signatureRadius: 410, velocity: 0, resonance: S.NO_RESISTS },
    { distance: 29999, transversal: 0 }), 410 / 697, 1e-12);

// ===========================================================================
// 4. TRANSVERSAL vs ANGULAR — why orbiting close is how you survive.
//    Same transversal speed, different range: angular = transversal/distance.
// ===========================================================================
{
  // A turret with realistic tracking (a 425mm AutoCannon II reads 33.8; the
  // 0.1 used above is artillery-grade and misses everything at any range,
  // which would make this comparison 0 < 0 and prove nothing).
  const tracker = { ...turret, tracking: 10 };
  const target = { name: 'bs', signatureRadius: 400, velocity: 500, resonance: S.NO_RESISTS };

  // BOTH distances are inside optimal, so the range term is exactly 0 and the
  // only thing that changes is angular velocity = transversal / distance.
  const near = S.applicationOf(tracker, target, { distance: 2000, transversal: 200 });
  const far = S.applicationOf(tracker, target, { distance: 8000, transversal: 200 });
  eq('4a the same transversal is far harder to track up close', near < far, true);
  // at 2000 m: angular 0.1, term = 0.1*40000/(10*400) = 1 exactly -> 0.5 hit
  close('4a2 ...and the near case is exactly the half-hit point',
    S.turretChanceToHit(tracker, 2000, 0.1, 400), 0.5);
  // at 8000 m: angular 0.025, term = 0.25, exponent 0.0625
  close('4a3 ...while the far case barely notices', S.turretChanceToHit(tracker, 8000, 0.025, 400),
    Math.pow(0.5, 0.0625), 1e-12);
  eq('4b a target with zero transversal at optimal is hit fully',
    S.applicationOf(tracker, target, { distance: 10000, transversal: 0 }),
    S.turretDamageMultiplier(1));
}

// ===========================================================================
// 5. RESISTS — applied to the damage TYPES, never to a pre-summed scalar.
// ===========================================================================
{
  // 1000 kinetic vs a target with 60% kinetic resist and 0% everything else
  const target = {
    name: 'r', signatureRadius: 100000, velocity: 0,
    resonance: { em: 1, thermal: 1, kinetic: 0.4, explosive: 1 },
  };
  const w = { ...turret, volley: { em: 0, thermal: 0, kinetic: 1000, explosive: 0 }, cycleSeconds: 10 };
  const r = S.appliedDps([w], target, { distance: 0, transversal: 0 });
  close('5a raw dps ignores resists', r.raw, 100);
  close('5b applied dps is cut by the kinetic resonance x the hit multiplier',
    r.applied, 100 * 0.4 * S.turretDamageMultiplier(1), 1e-12);

  // split damage must be resisted per type, not by an average resonance
  const split = { ...w, volley: { em: 500, thermal: 0, kinetic: 500, explosive: 0 } };
  const rs = S.appliedDps([split], target, { distance: 0, transversal: 0 });
  close('5c half EM half kinetic meets two different resonances',
    rs.applied, (500 * 1 + 500 * 0.4) / 10 * S.turretDamageMultiplier(1), 1e-12);
}

// ===========================================================================
// 6. CLASSIFICATION from engine items — turret vs missile vs untracked.
// ===========================================================================
{
  const at = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), { value: v }]));
  // 51 cycle, 64 mult, 160 tracking, 54 optimal, 158 falloff, 620 sigRes
  const gun = S.simWeapon({
    type_id: 10, state: 'Active', attributes: at({ 51: 5000, 64: 2, 160: 0.1, 54: 10000, 158: 5000, 620: 40000 }),
    charge: { type_id: 11, attributes: at({ 117: 50 }) },
  });
  eq('6a a tracking module is a turret', gun.kind, 'turret');
  eq('6b its damage comes from the CHARGE, times the module multiplier', gun.volley.kinetic, 100);
  eq('6c and its signature resolution is read, not assumed', gun.sigResolution, 40000);

  const launcher = S.simWeapon({
    type_id: 20, state: 'Active', attributes: at({ 51: 12000, 212: 1 }),
    charge: { type_id: 21, attributes: at({ 117: 400, 654: 697, 653: 67, 1353: 0.967, 281: 7200, 37: 1500 }) },
  });
  eq('6d an explosion radius on the charge makes it a missile', launcher.kind, 'missile');
  eq('6e flight range is velocity x flight time (1500 x 7.2 s)', launcher.maxRange, 10800);
  eq('6f the drf is carried through untouched', launcher.drf, 0.967);

  const smartbomb = S.simWeapon({
    type_id: 30, state: 'Active', attributes: at({ 51: 10000, 114: 300 }), charge: null,
  });
  eq('6g damage with no tracking and no explosion is untracked', smartbomb.kind, 'untracked');
  eq('6h and it applies in full',
    S.applicationOf(smartbomb, { name: 'x', signatureRadius: 1, velocity: 9999, resonance: S.NO_RESISTS },
      { distance: 0, transversal: 9999 }), 1);

  eq('6i an OFFLINE module is not a weapon',
    S.simWeapon({ type_id: 40, state: 'Passive', attributes: at({ 51: 5000, 160: 0.1, 114: 10 }) }), null);
  eq('6j an UNLOADED turret has no damage and is not simulated',
    S.simWeapon({ type_id: 50, state: 'Active', attributes: at({ 51: 5000, 160: 0.1 }), charge: null }), null);
}

// ===========================================================================
// 7. EHP BY DAMAGE PROFILE — the hole in the tank, which an even split hides.
// ===========================================================================
{
  const at = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), { value: v }]));
  // a classic armour tank: strong EM/therm, weak explosive
  // 265 armorHP; 267 em, 268 explosive, 269 kinetic, 270 thermal resonance
  const result = {
    hull: { attributes: at({ 265: 10000, 267: 0.1, 268: 0.5, 269: 0.35, 270: 0.35, 263: 0, 9: 0 }) },
    items: [],
  };
  const even = S.tankAgainst(result, { em: 25, thermal: 25, kinetic: 25, explosive: 25 });
  // weighted resonance = (0.1+0.5+0.35+0.35)/4 = 0.325 -> 10000/0.325
  close('7a even profile uses the mean resonance', even.armor, 10000 / 0.325, 1e-6);
  const angels = S.tankAgainst(result, { em: 0, thermal: 0, kinetic: 0, explosive: 100 });
  close('7b a pure-explosive attacker meets only the explosive hole', angels.armor, 10000 / 0.5, 1e-6);
  eq('7c ...which is a WORSE number than the even split implies', angels.armor < even.armor, true);
  const amarr = S.tankAgainst(result, { em: 100, thermal: 0, kinetic: 0, explosive: 0 });
  close('7d a pure-EM attacker meets the strong face', amarr.armor, 10000 / 0.1, 1e-6);
  eq('7e the spread between best and worst case is 5x here',
    Math.round(amarr.armor / angels.armor), 5);
  eq('7f layers with no HP contribute nothing', even.shield, 0);
}

// ===========================================================================
// 8. CURVES — shape, endpoints, and monotonicity where it is guaranteed.
// ===========================================================================
{
  const target = { name: 'bs', signatureRadius: 400, velocity: 0, resonance: S.NO_RESISTS };
  const pts = S.rangeCurve([turret], target, { maxRange: 40000, transversal: 0, steps: 40 });
  eq('8a one point per step, inclusive of both ends', pts.length, 41);
  eq('8b the curve starts at zero range', pts[0].x, 0);
  eq('8c and ends at the requested range', pts[40].x, 40000);
  eq('8d inside optimal it is flat at full damage', pts[5].y, pts[0].y);
  eq('8e it never increases with range', pts.every((p, i) => i === 0 || p.y <= pts[i - 1].y + 1e-12), true);
  eq('8f and it has decayed to nearly nothing far outside falloff', pts[40].y < pts[0].y * 0.001, true);

  const sig = S.signatureCurve([turret], { ...target, signatureRadius: 1 },
    { distance: 15000, transversal: 400, maxSig: 2000, steps: 20 });
  eq('8g bigger targets are easier to hit, monotonically',
    sig.every((p, i) => i === 0 || p.y >= sig[i - 1].y - 1e-12), true);

  // a missile fit: the transversal graph must still bite, via target VELOCITY
  const tv = S.transversalCurve([torp], { ...target, signatureRadius: 400, velocity: 0 },
    { distance: 10000, maxTransversal: 2000, steps: 20 });
  eq('8h a missile boat loses damage to target speed even though it cannot miss',
    tv[20].y < tv[0].y, true);
  eq('8i ...and that curve is monotonic too',
    tv.every((p, i) => i === 0 || p.y <= tv[i - 1].y + 1e-12), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
