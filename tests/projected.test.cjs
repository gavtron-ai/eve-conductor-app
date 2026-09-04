// PROJECTED EFFECTS — webs, painters, disruptors, neuts, nos, scram,
// remote repair, cap transfer. Every expected value was computed
// INDEPENDENTLY (python, closed forms) before the sim ran. Module strengths
// are the engine-measured finals (Web II -60, Painter II +37.5, TD II
// -21.4875, MEN II 180 GJ, Heavy Stasis Grappler II -85 with 1 km + 10 km
// falloff, Hurricane MWD pair 1433.74/1437.5 vs 225/250).
const { simulateBattleEvents } = require('./sim/lib/battleEvents.js');
const { projFalloffScale } = require('./sim/lib/projectedCycle.js');

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

/** a missile whose applied fraction is exactly expVelocity / targetSpeed
 * (sig term clamps at 1 because expRadius == victim sig), landing instantly */
const probeMissile = (dmg, cycle, expVelocity, victimSig) => gun(dmg, cycle, {
  kind: 'missile', missileVelocity: 1e9, maxRange: 1e12,
  expRadius: victimSig, expVelocity, drf: 1,
});

const ship = (id, side, o = {}) => ({
  id, name: id, side,
  weapons: o.weapons ?? [],
  repairs: o.repairs ?? [],
  projected: o.projected,
  capBoosters: o.capBoosters,
  capacitor: o.capacitor ?? DEAD_CAP,
  capStartFrac: o.capStartFrac,
  capPolicy: o.capPolicy,
  layers: o.layers ?? [
    { name: 'Shield', hp: o.shield ?? 0, resonance: NO_RES },
    { name: 'Armor', hp: o.armor ?? 0, resonance: NO_RES },
    { name: 'Hull', hp: o.hull ?? 0, resonance: NO_RES },
  ],
  shieldRechargeSeconds: o.shieldRechargeSeconds,
  signatureRadius: o.sig ?? 100,
  flying: o.flying ?? { speed: 0, angleDeg: 0 },
  range: o.range ?? 1000,
  propPair: o.propPair,
  tauActive: o.tauActive,
  tauInactive: o.tauInactive,
  resists: o.resists,
  nosOverride: o.nosOverride,
});

const proj = (kind, o = {}) => ({
  typeId: 99, kind,
  cycleSeconds: o.cycle ?? 5,
  capPerCycle: o.cap ?? 0,
  optimal: o.optimal ?? 100000,
  falloff: o.falloff ?? 0,
  resistAttr: o.resistAttr,
  rows: o.rows,
  drainGj: o.drainGj,
  transferGj: o.transferGj,
  blockStrength: o.blockStrength,
  rep: o.rep,
});

const web = (pct, o = {}) => proj('web', { rows: [{ modifies: 37, value: pct, stackable: false }], ...o });
const painter = (pct, o = {}) => proj('painter', { rows: [{ modifies: 552, value: pct, stackable: false }], ...o });

const dealtOf = (r, id) => r.ships.find((x) => x.id === id).damageDealt;

// ---------------------------------------------------------------------------
// P1. A WEB CHANGES APPLIED DAMAGE — Web II's measured -60%.
//     Victim commands 1000 m/s; webbed cap = 400. The probe missile applies
//     exactly Ve/Vt = 100/400 = 0.25 (was 0.1 unwebbed at 100/1000).
//     10 volleys of 1000 → dealt = 2500 exactly.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [probeMissile(1000, 1, 100, 100)],
      projected: [web(-60)],
      hull: 1,
    }),
    ship('B', 'b', { shield: 1e9, sig: 100, flying: { speed: 1000, angleDeg: 90 } }),
  ], { maxSeconds: 9.5 });
  close('P1a webbed victim eats 4x the missile damage', dealtOf(r, 'A'), 10 * 1000 * 0.25, 1e-6);

  const unwebbed = simulateBattleEvents([
    ship('A', 'a', { weapons: [probeMissile(1000, 1, 100, 100)], hull: 1 }),
    ship('B', 'b', { shield: 1e9, sig: 100, flying: { speed: 1000, angleDeg: 90 } }),
  ], { maxSeconds: 9.5 });
  close('P1b ...against 0.1 applied without the web', dealtOf(unwebbed, 'A'), 10 * 1000 * 0.1, 1e-6);
}

// ---------------------------------------------------------------------------
// P2. TWO WEBS STACK WITH THE MEASURED PENALTY, in separate leases.
//     1000 × 0.4 × (1 − 0.6·e^(−(1/2.67)²)) = 191.4112046079046 m/s.
//     Applied fraction 100/191.4112… = 0.5224354561941373.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [probeMissile(1000, 1, 100, 100)],
      projected: [web(-60), web(-60)],
      hull: 1,
    }),
    ship('B', 'b', { shield: 1e9, sig: 100, flying: { speed: 1000, angleDeg: 90 } }),
  ], { maxSeconds: 9.5 });
  close('P2a the second web is stacking-penalized: s(1)=0.86912',
    dealtOf(r, 'A'), 10 * 1000 * 0.5224354561941373, 1e-6);
}

// ---------------------------------------------------------------------------
// P3. A PAINTER GROWS THE SIGNATURE — measured +37.5%.
//     Sig 100 → 137.5 against expRadius 137.5: the sig term goes from
//     100/137.5 = 0.727272… to exactly 1. (Stationary target isolates it.)
// ---------------------------------------------------------------------------
{
  const painted = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [probeMissile(1000, 1, 1000, 137.5)],
      projected: [painter(37.5)],
      hull: 1,
    }),
    ship('B', 'b', { shield: 1e9, sig: 100 }),
  ], { maxSeconds: 9.5 });
  close('P3a painted: the full volley lands', dealtOf(painted, 'A'), 10 * 1000 * 1.0, 1e-6);

  const bare = simulateBattleEvents([
    ship('A', 'a', { weapons: [probeMissile(1000, 1, 1000, 137.5)], hull: 1 }),
    ship('B', 'b', { shield: 1e9, sig: 100 }),
  ], { maxSeconds: 9.5 });
  close('P3b unpainted: 100/137.5 of it', dealtOf(bare, 'A'), 10 * 1000 * (100 / 137.5), 1e-6);
}

// ---------------------------------------------------------------------------
// P4. A TRACKING DISRUPTOR CUTS A TURRET'S REACH — measured −21.4875% on
//     optimal AND falloff. Turret at optimal+falloff hits exactly 50%
//     (mult 0.7550…); disrupted, the same range is much deeper into falloff.
// ---------------------------------------------------------------------------
{
  const turret = (dmg) => gun(dmg, 1, {
    kind: 'turret', tracking: 1000, sigResolution: 100,
    optimal: 10000, falloff: 5000,
  });
  const td = proj('trackingDisruptor', {
    rows: [
      { modifies: 160, value: -21.4875, stackable: false },
      { modifies: 54, value: -21.4875, stackable: false },
      { modifies: 158, value: -21.4875, stackable: false },
    ],
  });
  // stationary ships at 15000 m: undisrupted = optimal+falloff exactly
  const mk = (disrupted) => simulateBattleEvents([
    ship('A', 'a', { weapons: [turret(1000)], hull: 1, range: 15000, sig: 100 }),
    ship('B', 'b', {
      shield: 1e9, sig: 100, range: 15000,
      projected: disrupted ? [td] : undefined,
    }),
  ], { maxSeconds: 9.5 });
  const clean = mk(false);
  const jammed = mk(true);
  // hit at optimal+falloff = 0.5 → mult = 0.5·(0.25+0.49+0.0501) = 0.39505
  close('P4a clean turret at optimal+falloff lands its textbook 0.39505',
    dealtOf(clean, 'A'), 10 * 1000 * 0.5 * (0.25 + 0.98 * 0.5 + 0.0501), 1e-6);
  // disrupted: optimal 7851.25, falloff 3925.625 → over = (15000−7851.25)/3925.625
  const over = (15000 - 10000 * 0.785125) / (5000 * 0.785125);
  const hit = Math.pow(0.5, over * over);
  const mult = 0.5 * Math.min(hit * hit + 0.98 * hit + 0.0501, 6 * hit);
  close('P4b disrupted, the same range lands only the hand-computed fraction',
    dealtOf(jammed, 'A'), 10 * 1000 * mult, 1e-6);
  // the exact ratio is 0.0793/0.39505 = 0.2007 — an 80% damage cut
  eq('P4c which is an ~80% cut', dealtOf(jammed, 'A') < 0.21 * dealtOf(clean, 'A'), true);
}

// ---------------------------------------------------------------------------
// P5. A NEUT DRAINS AT CYCLE END, SCALED BY FALLOFF — MEN II's measured
//     180 GJ / 12 s, 10 km + 5 km. At 12 km: 180 × 0.5^(0.4²) = 161.1045…
//     Victim cap 1000 GJ, no recharge: after the t=12 drain it holds
//     1000 − 161.1045… → capMinFrac = 0.8388954872329650.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [gun(1, 1000)], hull: 1, range: 12000,
      projected: [proj('neut', { cycle: 12, drainGj: 180, optimal: 10000, falloff: 5000 })],
    }),
    ship('B', 'b', { shield: 1e9, range: 12000, capacitor: { capacity: 1000, tau: 1e12 } }),
  ], { maxSeconds: 13 });
  const B = r.ships.find((x) => x.id === 'B');
  close('P5a the falloff-scaled drain landed once at t=12',
    B.capMinFrac, 1 - 161.10451276703503 / 1000, 1e-9);
  eq('P5b and was logged', r.events.some((e) => e.kind === 'neuted'), true);
}

// ---------------------------------------------------------------------------
// P6. THE RESIST GATE — a cap battery's measured 2045 = 0.75.
//     Same neut at optimal: 180 × 0.75 = 135 GJ.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [gun(1, 1000)], hull: 1,
      projected: [proj('neut', { cycle: 12, drainGj: 180, optimal: 10000, falloff: 5000, resistAttr: 2045 })],
    }),
    ship('B', 'b', {
      shield: 1e9, capacitor: { capacity: 1000, tau: 1e12 },
      resists: { 2045: 0.75 },
    }),
  ], { maxSeconds: 13 });
  close('P6a the battery keeps a quarter of the energy',
    r.ships.find((x) => x.id === 'B').capMinFrac, 1 - 135 / 1000, 1e-9);
}

// ---------------------------------------------------------------------------
// P7. THE NOS GATE — drains only while the victim's cap FRACTION is higher.
//     Equal fractions: nothing moves. A Blood hull (nosOverride) drains
//     regardless.
// ---------------------------------------------------------------------------
{
  const mk = (override) => simulateBattleEvents([
    ship('A', 'a', {
      weapons: [gun(1, 1000)], hull: 1,
      capacitor: { capacity: 1000, tau: 1e12 }, capStartFrac: 1,
      nosOverride: override,
      projected: [proj('nos', { cycle: 5, drainGj: 36, optimal: 10000, falloff: 5000 })],
    }),
    ship('B', 'b', { shield: 1e9, capacitor: { capacity: 500, tau: 1e12 }, capStartFrac: 1 }),
  ], { maxSeconds: 6 });
  const gated = mk(false);
  const blood = mk(true);
  close('P7a equal fractions: the nos moves nothing',
    gated.ships.find((x) => x.id === 'B').capMinFrac, 1, 1e-12);
  close('P7b a Blood hull ignores the gate: 36 GJ gone',
    blood.ships.find((x) => x.id === 'B').capMinFrac, 1 - 36 / 500, 1e-9);
}

// ---------------------------------------------------------------------------
// P8. LOGISTICS — a remote shield booster holds a target alive.
//     Victim 2000 hp under 300-dmg volleys every 4 s (in phase): unhealed it
//     dies at t=24 (7th volley). A 680-hp remote heal each 4 s (measured
//     LRSB II) out-heals the damage: stalemate, and the same-instant order
//     is LAND then heal (alpha still beats the rep on the tie).
// ---------------------------------------------------------------------------
{
  const unhealed = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(300, 4)], hull: 1 }),
    ship('B', 'b', { shield: 2000 }),
  ], { maxSeconds: 120 });
  close('P8a unhealed, the 7th volley kills at t=24', unhealed.seconds, 24, 1e-9);

  const healed = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(300, 4)], hull: 1 }),
    ship('B', 'b', { shield: 2000 }),
    ship('L', 'b', {
      shield: 1e9,
      projected: [proj('remoteShield', {
        cycle: 4,
        rep: { layer: 'shield', amount: 680, timing: 'start', charges: null },
      })],
    }),
  ], { maxSeconds: 120 });
  eq('P8b with logi on the field, nobody dies', healed.winner, null);
  eq('P8c and the heals were logged', healed.events.some((e) => e.kind === 'repped'), true);
}

// ---------------------------------------------------------------------------
// P9. A DEAD LOGI DELIVERS NOTHING — armour remote heals land at cycle END
//     only if the source survived its whole cycle.
//     The logi (400 hp) dies at t=3 to a 400-dmg volley; its 6 s armour
//     cycle started at t=0 and would land 512 at t=6 — it never does.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [gun(400, 100, { clip: { size: 1, perCycle: 1, reloadSeconds: 9999 } })],
      hull: 1,
    }),
    // attacker shoots the LOGI first (nearest death: 400 < 10000)
    ship('B', 'b', { armor: 10000 }),
    ship('L', 'b', {
      shield: 400,
      projected: [proj('remoteArmor', {
        cycle: 6,
        rep: { layer: 'armor', amount: 512, timing: 'end', charges: null },
      })],
    }),
  ], { maxSeconds: 30 });
  // wait — the volley fires at t=0, killing L instantly; its cycle never ran.
  // Delay the shot: clip 1 at t=0 kills L at t=0 (phase LAND 5) AFTER the
  // logi's projStart (phase 3) locked its cycle at t=0. The pending heal for
  // B must then never land.
  const L = r.ships.find((x) => x.id === 'L');
  const B = r.ships.find((x) => x.id === 'B');
  close('P9a the logi died at t=0', L.diedAt, 0, 1e-9);
  close('P9b its locked-in heal never landed', L.healsApplied, 0, 1e-9);
  close('P9c the ward is untouched but unhealed', B.remaining[1] * 10000, 10000, 1e-9);
}

// ---------------------------------------------------------------------------
// P10. THE SCRAM — signature bloom vanishes the instant the prop dies, and
//      speed decays on the measured inertia ramp.
//      Rifter pair (critic-verified): active 3240.481413519456 m/s, inactive
//      456.25; tauInactive 2.3047200343430244 s. Sig pair 1437.5 / 250.
//      Probe missile expRadius 1437.5, Ve huge → factor = sig-term only:
//      volley t=0 (scram already live, sig 250): 250/1437.5. Confirms
//      SIG_FOLLOWS_PROP_STATE at the same instant.
//      A second run with Ve=1000 measures the SPEED ramp: volley t=0 factor
//      1000/3240.4814…, volley t=2 factor 1000/1625.2953805162042 (v(2) on
//      the ramp — hand-evaluated closed form).
// ---------------------------------------------------------------------------
{
  const pair = {
    activeMaxVel: 3240.481413519456, activeSig: 1437.5,
    inactiveMaxVel: 456.25, inactiveSig: 250,
    blockable: true,
  };
  const sigRun = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [probeMissile(1000, 1, 1e9, 1437.5)],
      projected: [proj('scram', { cycle: 5, blockStrength: 1, optimal: 9000 })],
      hull: 1,
    }),
    ship('B', 'b', {
      shield: 1e9, sig: 1437.5, propPair: pair,
      tauActive: 3.3847200504, tauInactive: 2.3047200343430244,
      flying: { speed: 3240.481413519456, angleDeg: 90 },
    }),
  ], { maxSeconds: 0.5 });
  close('P10a the bloom is GONE for the very first volley: sig 250',
    dealtOf(sigRun, 'A'), 1000 * (250 / 1437.5), 1e-6);
  eq('P10b and the scram was logged', sigRun.events.some((e) => e.kind === 'scrammed'), true);

  // a sig-neutral pair isolates the SPEED ramp (the first draft reused the
  // Rifter sig pair and the sim — correctly, per SIG_FOLLOWS_PROP_STATE —
  // used the pair's 250 rather than the ship field, inflating the sig term)
  const speedPair = { ...pair, activeSig: 100, inactiveSig: 100 };
  const speedRun = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [probeMissile(1000, 2, 1000, 100)],
      projected: [proj('scram', { cycle: 30, blockStrength: 1, optimal: 9000 })],
      hull: 1,
    }),
    ship('B', 'b', {
      shield: 1e9, sig: 100, propPair: speedPair,
      tauActive: 3.3847200504, tauInactive: 2.3047200343430244,
      flying: { speed: 3240.481413519456, angleDeg: 90 },
    }),
  ], { maxSeconds: 3 });
  const want = 1000 * (1000 / 3240.481413519456) + 1000 * (1000 / 1625.2953805162042);
  // tolerance 0.01: the probe missile still takes 1 µs to fly, and the sim
  // — MORE exactly than the hand value — evaluates v at the LAND instant,
  // a microsecond down the ramp
  close('P10c two volleys ride the inertia ramp: v(0) then v(2)',
    dealtOf(speedRun, 'A'), want, 0.01);
}

// ---------------------------------------------------------------------------
// P11. A GRAPPLER IS A WEB WITH REAL FALLOFF — measured -85%, 1 km optimal,
//      10 km falloff. At 6 km: scale 0.5^(0.5²) = 0.8408964…, so the victim
//      flies at 1000×(1−0.85×0.8408964…) = 285.238047… m/s and the probe
//      missile applies 100/285.238… A binary range gate would have left the
//      victim at full speed.
// ---------------------------------------------------------------------------
{
  const r = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [probeMissile(1000, 1, 100, 100)],
      projected: [proj('web', {
        rows: [{ modifies: 37, value: -85, stackable: false }],
        optimal: 1000, falloff: 10000, cycle: 2,
      })],
      hull: 1, range: 6000,
    }),
    ship('B', 'b', { shield: 1e9, sig: 100, range: 6000, flying: { speed: 1000, angleDeg: 90 } }),
  ], { maxSeconds: 9.5 });
  close('P11a the grappler tapers instead of gating',
    dealtOf(r, 'A'), 10 * 1000 * 0.350584366425563, 1e-6);
  close('P11b the falloff law itself round-trips',
    projFalloffScale(6000, 1000, 10000), 0.8408964152537145, 1e-12);
  eq('P11c hard cutoff when there is no falloff', projFalloffScale(6000, 1000, 0), 0);
}

// ---------------------------------------------------------------------------
// P12. CAP TRANSFER WAKES A STARVED ALLY — 351 GJ (measured LRCT II) into a
//      repper that parked on an empty capacitor brings its heals back.
// ---------------------------------------------------------------------------
{
  const rep = { typeId: 9, kind: 'shield', amount: 50, cycleSeconds: 2, capPerCycle: 60,
    timing: 'start', ancillary: false, charges: null, burstHps: 25, dutyHps: 25 };
  const mk = (withXfer) => simulateBattleEvents([
    ship('A', 'a', {
      weapons: [gun(5000, 9999, { clip: { size: 1, perCycle: 1, reloadSeconds: 99999 } })],
      hull: 1,
    }),
    ship('B', 'b', {
      shield: 50000, repairs: [rep],
      capacitor: { capacity: 100, tau: 1e12 }, capStartFrac: 0.7,
    }),
    ...(withXfer ? [ship('L', 'b', {
      shield: 1e9,
      projected: [proj('capTransfer', { cycle: 5, transferGj: 351 })],
    })] : []),
  ], { maxSeconds: 12 });
  const dry = mk(false);
  const fed = mk(true);
  // dry: cap 70 → one 60-GJ cycle at t=0, then parked: exactly 1 heal (50)
  close('P12a unfed, the repper heals once and starves',
    dry.ships.find((x) => x.id === 'B').healsApplied, 50, 1e-9);
  // hand-walked: native heal t=0 (cap 70→10), starve at t=2; transfers land
  // at t=5 and t=10 (cycle END), each waking the repper for one 50-hp heal
  close('P12b fed by the transmitter it heals at t=0, 5 and 10: exactly 150',
    fed.ships.find((x) => x.id === 'B').healsApplied, 150, 1e-9);
}

// ---------------------------------------------------------------------------
// P13. DETERMINISM SURVIVES THE WHOLE PROJECTED STACK.
// ---------------------------------------------------------------------------
{
  const build = () => [
    ship('A1', 'a', {
      weapons: [probeMissile(500, 1.7, 400, 120)],
      projected: [web(-60), proj('neut', { cycle: 6, drainGj: 90, optimal: 8000, falloff: 4000 })],
      shield: 5000, sig: 120, range: 9000,
    }),
    ship('A2', 'a', { weapons: [gun(200, 2.3)], armor: 6000, range: 9000 }),
    ship('B1', 'b', {
      weapons: [gun(260, 2.1)], shield: 7000, sig: 120, range: 9000,
      capacitor: { capacity: 2000, tau: 600 },
      flying: { speed: 800, angleDeg: 90 },
      projected: [painter(37.5)],
    }),
    ship('B2', 'b', {
      shield: 1e9,
      projected: [proj('remoteShield', {
        cycle: 4, rep: { layer: 'shield', amount: 400, timing: 'start', charges: null },
      })],
    }),
  ];
  const r1 = simulateBattleEvents(build(), { maxSeconds: 200 });
  const r2 = simulateBattleEvents(build(), { maxSeconds: 200 });
  eq('P13a identical inputs, byte-identical fights', JSON.stringify(r1), JSON.stringify(r2));
  const same = build();
  const r3 = simulateBattleEvents(same, { maxSeconds: 200 });
  const r4 = simulateBattleEvents(same, { maxSeconds: 200 });
  eq('P13b even reusing the same objects (no input mutation)', JSON.stringify(r3), JSON.stringify(r4));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
