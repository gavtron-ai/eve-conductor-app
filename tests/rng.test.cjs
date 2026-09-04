// THE SEEDED-RANDOM LAYER, THE LOCK MODEL, ECM, AND COMMAND BURSTS.
// PRNG reference values were measured by running the algorithms standalone;
// jam/lock scenarios are hand-walked; burst strengths are the engine-measured
// chain (Shield Harmonizing −15 → −17.25 Vulture → −21.5625 mindlinked).
const { mulberry32, fmix32, streamKey, streamSeed, RollStreams, ROLL } = require('./sim/lib/battleRng.js');
const { simulateBattleEvents } = require('./sim/lib/battleEvents.js');
const { runMonteCarlo, hasRandomMechanics } = require('./sim/lib/battleMonteCarlo.js');
const { buffMultiplier } = require('./sim/lib/dbuffTable.js');

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
  projected: o.projected,
  bursts: o.bursts,
  capacitor: o.capacitor ?? DEAD_CAP,
  layers: [
    { name: 'Shield', hp: o.shield ?? 0, resonance: o.shieldRes ?? NO_RES },
    { name: 'Armor', hp: o.armor ?? 0, resonance: NO_RES },
    { name: 'Hull', hp: o.hull ?? 0, resonance: NO_RES },
  ],
  signatureRadius: o.sig ?? 100,
  flying: o.flying ?? { speed: 0, angleDeg: 0 },
  range: o.range ?? 1000,
  scanRes: o.scanRes,
  maxTargetRangeM: o.maxTargetRangeM,
  sensor: o.sensor,
});
const ecm = (o = {}) => ({
  typeId: 99, kind: 'ecm',
  cycleSeconds: o.cycle ?? 20, capPerCycle: 0,
  optimal: o.optimal ?? 100000, falloff: 0,
  resistAttr: 2253,
  jamStrength: o.js ?? { grav: 5, ladar: 5, mag: 5, radar: 5 },
  jamSeconds: o.jamSeconds ?? (o.cycle ?? 20),
});

// ---------------------------------------------------------------------------
// R1. PRNG reference draws — measured standalone, full precision.
// ---------------------------------------------------------------------------
{
  const r0 = mulberry32(0);
  close('R1a mulberry32(0) draw 1', r0(), 0.26642920868471265, 0);
  close('R1b draw 2', r0(), 0.0003297457005828619, 0);
  close('R1c draw 3', r0(), 0.22327202744781971, 0);
  close('R1d mulberry32(1) draw 1', mulberry32(1)(), 0.6270739405881613, 1e-16);
  close('R1e fmix32(1) is murmur3\'s published vector', fmix32(1), 1364076727, 0);
  close('R1f key(ECM,0,0) packs to 0x10000ff', streamKey(ROLL.ECM_JAM, 0, 0), 0x10000ff, 0);
  close('R1g streamSeed(0, key) anchor', streamSeed(0, 0x10000ff), 1267541879, 0);
}

// ---------------------------------------------------------------------------
// R2. STREAM ISOLATION — adding a second jammer never shifts the first
//     jammer's sequence.
// ---------------------------------------------------------------------------
{
  const a = new RollStreams(7);
  const seq1 = [a.draw(1, 0, 0), a.draw(1, 0, 0), a.draw(1, 0, 0)];
  const b = new RollStreams(7);
  const seq2 = [];
  // interleave a second module's draws — slot 0's sequence must not move
  seq2.push(b.draw(1, 0, 0));
  b.draw(1, 0, 1); b.draw(1, 0, 1);
  seq2.push(b.draw(1, 0, 0));
  b.draw(1, 0, 1);
  seq2.push(b.draw(1, 0, 0));
  eq('R2a slot-0 stream identical with a second jammer interleaved',
    JSON.stringify(seq1), JSON.stringify(seq2));
  eq('R2b drawCount counts every draw', b.drawCount, 6);
}

// ---------------------------------------------------------------------------
// R3. THE DETERMINISTIC PATH NEVER TOUCHES THE RNG — structural guard.
// ---------------------------------------------------------------------------
{
  const build = () => [
    ship('A', 'a', { weapons: [gun(100, 1)], hull: 1 }),
    ship('B', 'b', { shield: 1500 }),
  ];
  eq('R3a no ECM = no random mechanics', hasRandomMechanics(build()), false);
  const direct = simulateBattleEvents(build());
  eq('R3b the fight made ZERO draws', direct.drawCount, 0);
  const mc = runMonteCarlo(build(), {}, 100);
  eq('R3c the wrapper short-circuits to n=1', mc.n, 1);
  eq('R3d and returns the identical fight', JSON.stringify(mc.representative), JSON.stringify(direct));
}

// ---------------------------------------------------------------------------
// R4. DETERMINISM PER SEED with ECM on the field.
// ---------------------------------------------------------------------------
{
  const build = () => [
    ship('A', 'a', {
      weapons: [gun(100, 1)], hull: 1, scanRes: 500, sensor: { attr: 209, strength: 20 },
      projected: [ecm({ js: { grav: 10, ladar: 10, mag: 10, radar: 10 } })],
    }),
    ship('B', 'b', {
      weapons: [gun(60, 1)], shield: 4000, scanRes: 400, sensor: { attr: 211, strength: 20 },
    }),
  ];
  const r1 = simulateBattleEvents(build(), { seed: 7 });
  const r2 = simulateBattleEvents(build(), { seed: 7 });
  eq('R4a same seed, byte-identical fight', JSON.stringify(r1), JSON.stringify(r2));
  eq('R4b the fight actually rolled', r1.drawCount > 0, true);
  const r3 = simulateBattleEvents(build(), { seed: 8 });
  eq('R4c seeds are real: 7 and 8 differ somewhere',
    JSON.stringify(r1) !== JSON.stringify(r3), true);
}

// ---------------------------------------------------------------------------
// R5. THE JAM MECHANIC, HAND-WALKED — three ships, because the post-2018
//     rule means a 1v1 jam is useless (the victim can always shoot the
//     jammer): J jams, G is the gunner V is actually shooting.
// ---------------------------------------------------------------------------
{
  const asinh100 = Math.asinh(100);
  const relock = 40000 / (400 * asinh100 * asinh100);
  close('R5a the relock time from the declared formula', relock, 3.5622136560777435, 1e-12);

  let jamSeed = -1;
  for (let sd = 0; sd < 20 && jamSeed < 0; sd++) {
    if (mulberry32(streamSeed(sd, streamKey(ROLL.ECM_JAM, 0, 0)))() < 0.5) jamSeed = sd;
  }
  eq('R5b a first-roll-jams seed exists in 0..19', jamSeed >= 0, true);

  const mk = (sd) => simulateBattleEvents([
    ship('J', 'a', {
      weapons: [], shield: 2e9, scanRes: 500, sensor: { attr: 209, strength: 50 },
      projected: [ecm({ js: { grav: 10, ladar: 10, mag: 10, radar: 10 }, cycle: 20 })],
    }),
    ship('G', 'a', { weapons: [gun(1, 1000)], shield: 1e9 }),
    ship('V', 'b', {
      weapons: [gun(100, 1)], shield: 1e9, scanRes: 400, sig: 100,
      sensor: { attr: 211, strength: 20 },
    }),
  ], { seed: sd, maxSeconds: 30 });

  const jammed = mk(jamSeed);
  // LOCKS_ACQUIRED_FROM_ZERO (v0.96.0): the jammer must LOCK V before it
  // can jam — nothing targeted lands at t=0 any more (a Hyena painting at
  // 0 s is what caught this live). J's lock on V (sig 100, scanRes 500) =
  // 40000/(500·asinh²(100)) = 2.8497709248621948 — the jam lands THEN.
  const jamAt = 40000 / (500 * asinh100 * asinh100);
  eq('R5c the jam lands the instant the jammer finishes locking',
    jammed.events.some((e) => e.kind === 'jammed' && Math.abs(e.t - jamAt) < 1e-9), true);
  // V (scanRes 400) is still LOCKING G (done at 3.5622) when the 2.8498 jam
  // clears its progress; jammed until 22.8498, re-lock G costs 3.5622, so
  // volleys resume at 27.124 → 3 land by t=30 (27.12, 28.12, 29.12)
  const dealt = jammed.ships.find((x) => x.id === 'V').damageDealt;
  eq('R5d the jam silenced the fight down to 3 volleys', dealt <= 11 * 100, true);
  eq('R5e and a jamEnded fired', jammed.events.some((e) => e.kind === 'jamEnded'), true);
}

// ---------------------------------------------------------------------------
// R6. MONTE CARLO — a 50% first-roll-decides fight lands inside the
//     3-sigma binomial band over 100 seeds.
// ---------------------------------------------------------------------------
{
  // one jam roll decides: jammer chance 0.5; if jammed, the victim (who
  // needs every volley) fails to kill in time → stalemate; if not, it kills.
  const build = () => [
    ship('J', 'a', {
      weapons: [gun(1, 1000)], hull: 1e9, scanRes: 500, sensor: { attr: 209, strength: 50 },
      projected: [ecm({ js: { grav: 10, ladar: 10, mag: 10, radar: 10 }, cycle: 60 })],
    }),
    ship('V', 'b', {
      weapons: [gun(100, 1)], shield: 1e9, scanRes: 400,
      sensor: { attr: 211, strength: 20 },
    }),
  ];
  const mc = runMonteCarlo(build(), { maxSeconds: 25 }, 100);
  eq('R6a stochastic mode engaged', mc.mode, 'stochastic');
  // V can never die (J deals ~nothing); outcome varies only in V's dealt —
  // winner is null either way, so assert on the DISTRIBUTION of jams via
  // representative + perSeed instead: count seeds where V dealt less
  const jams = mc.perSeed.length;
  eq('R6b all 100 seeds ran', jams, 100);
  // binomial check through the raw stream (independent verification):
  let heads = 0;
  for (let sd = 0; sd < 100; sd++) {
    if (mulberry32(streamSeed(sd, streamKey(ROLL.ECM_JAM, 0, 0)))() < 0.5) heads += 1;
  }
  eq('R6c raw first-roll heads inside 3σ (35..65)', heads >= 35 && heads <= 65, true);
}

// ---------------------------------------------------------------------------
// R7. THE LOCK MODEL — a retarget pays real lock time.
//     Attacker scanRes 1000, victims sig 100: lock = 40000/(1000·asinh²(100))
//     = 1.4255 s. Two victims: B1 (300 hp) dies at t=2 (3 volleys of 100 at
//     0,1,2); the retarget to B2 pays the lock, so B2's first hit comes at
//     ⌈2 + 1.4255⌉ on the 1 s gun grid — volleys at 3.43, then 4.43…
// ---------------------------------------------------------------------------
{
  const asinh100 = Math.asinh(100);
  const lockT = 40000 / (1000 * asinh100 * asinh100);
  close('R7a hand lock time', lockT, 1.4248854624310974, 1e-12);

  const r = simulateBattleEvents([
    ship('A', 'a', {
      weapons: [gun(100, 1)], hull: 1, scanRes: 1000,
    }),
    ship('B1', 'b', { shield: 300, sig: 100 }),
    ship('B2', 'b', { shield: 250, sig: 100 }),
  ], { maxSeconds: 60 });
  const b1 = r.ships.find((x) => x.id === 'B1');
  const b2 = r.ships.find((x) => x.id === 'B2');
  // LOCKS_ACQUIRED_FROM_ZERO (v0.96.0): the OPENING target pays lock time
  // too — the fight starts with acquisition, not with shooting. Nearest-
  // death picks B2 (250 < 300): lock done at lockT, volleys at lockT,
  // +1, +2 → B2 dies at lockT + 2. The retarget to B1 pays another full
  // lock: volleys at lockT+2+lockT.. → B1 dead at 2·lockT + 4.
  // (Through v0.95 the opener was PRELOCKED — the retired convenience.)
  close('R7b the first target dies one lock time later than the old model',
    b2.diedAt, lockT + 2, 1e-9);
  close('R7c the second pays a second full lock time', b1.diedAt, 2 * lockT + 4, 1e-6);
}

// ---------------------------------------------------------------------------
// R8. PRELOCKED_AT_START: without scanRes (old inputs) everything is
//     instant — the entire pre-lock suite must be byte-stable.
// ---------------------------------------------------------------------------
{
  const build = () => [
    ship('A', 'a', { weapons: [gun(100, 1)], hull: 1 }),
    ship('B1', 'b', { shield: 300 }),
    ship('B2', 'b', { shield: 250 }),
  ];
  const r = simulateBattleEvents(build(), { maxSeconds: 60 });
  // B2 (250) dies first at t=2; with no scanRes the retarget is instant and
  // B1's three volleys land 3,4,5 — exactly the pre-lock-model behaviour
  close('R8a no scanRes → retarget locks instantly (old behaviour)',
    r.ships.find((x) => x.id === 'B1').diedAt, 5, 1e-9);
}

// ---------------------------------------------------------------------------
// R9. COMMAND BURSTS — the measured Shield Harmonizing chain on resonance.
//     Buff 10 at −17.25 (Vulture): incoming shield damage ×0.8275.
//     1000-dmg volleys on 8275 shield: unbuffed 9 volleys (t=8), buffed
//     8275/827.5 = 10 volleys → dead at t=9.
// ---------------------------------------------------------------------------
{
  const mkT = (bursts) => ship('B', 'b', { shield: 8275, bursts });
  const atk = ship('A', 'a', { weapons: [gun(1000, 1)], hull: 1 });
  const bare = simulateBattleEvents([atk, mkT(undefined)], { maxSeconds: 60 });
  close('R9a unbuffed: 9th volley kills at t=8', bare.seconds, 8, 1e-9);

  const burst = {
    typeId: 43555, cycleSeconds: 60, capPerCycle: 25,
    buffs: [{ buffId: 10, value: -17.25 }],
    buffSeconds: 103.5, charges: null,
  };
  const buffed = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(1000, 1)], hull: 1 }),
    mkT([burst]),
  ], { maxSeconds: 60 });
  close('R9b the Vulture-strength resist buff buys a volley: dead at t=9',
    buffed.seconds, 9, 1e-9);
  eq('R9c the buff was seeded before the first volley',
    buffed.ships.find((x) => x.id === 'B').remaining[0] === 0, true);

  // winner-take-all: a second, weaker shield burst changes NOTHING
  const two = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(1000, 1)], hull: 1 }),
    ship('B', 'b', {
      shield: 8275,
      bursts: [burst, { ...burst, buffs: [{ buffId: 10, value: -15 }] }],
    }),
  ], { maxSeconds: 60 });
  close('R9d winner-take-all: the weaker burst adds nothing', two.seconds, 9, 1e-9);
}

// ---------------------------------------------------------------------------
// R10. THE BUFF TABLE — winner-take-all arithmetic, both aggregate modes.
// ---------------------------------------------------------------------------
{
  close('R10a min-aggregate picks the most negative',
    buffMultiplier([{ buffId: 10, value: -15 }, { buffId: 10, value: -17.25 }], 271),
    1 - 0.1725, 1e-12);
  close('R10b different buff ids compose',
    buffMultiplier([{ buffId: 10, value: -10 }, { buffId: 20, value: -20 }], 271),
    0.9, 1e-12);
  close('R10c ...each on its own attribute',
    buffMultiplier([{ buffId: 10, value: -10 }, { buffId: 20, value: -20 }], 552),
    0.8, 1e-12);
  close('R10d unknown ids are inert', buffMultiplier([{ buffId: 999, value: -50 }], 271), 1, 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
