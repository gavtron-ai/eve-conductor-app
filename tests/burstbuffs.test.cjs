// MODULE-ATTRIBUTE COMMAND BUFFS + BURST JAMMERS. Charge values are the
// engine-measured finals (Active Shielding/Rapid Repair −15, Extension +15,
// Rapid Deployment/Interdiction +22.5, Evasive −11.25 dual; Burst Jammer II
// strength 9 range 18 km at all-V). Every expected number hand-walked.
const { simulateBattleEvents } = require('./sim/lib/battleEvents.js');
const { runMonteCarlo, hasRandomMechanics } = require('./sim/lib/battleMonteCarlo.js');
const { mulberry32, streamSeed, streamKey, ROLL } = require('./sim/lib/battleRng.js');

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
  layers: o.layers ?? [
    { name: 'Shield', hp: o.shield ?? 0, resonance: NO_RES },
    { name: 'Armor', hp: o.armor ?? 0, resonance: NO_RES },
    { name: 'Hull', hp: o.hull ?? 0, resonance: NO_RES },
  ],
  signatureRadius: o.sig ?? 100,
  flying: o.flying ?? { speed: 0, angleDeg: 0 },
  range: o.range ?? 1000,
  commandedRange: o.commandedRange,
  propPair: o.propPair,
  tauActive: o.tauActive,
  scanRes: o.scanRes,
  sensor: o.sensor,
});
const rep = (kind, amount, cycle, o = {}) => ({
  typeId: 9, kind, amount, cycleSeconds: cycle,
  capPerCycle: o.cap ?? 0,
  timing: o.timing ?? (kind === 'shield' ? 'start' : 'end'),
  ancillary: false, charges: null,
  burstHps: amount / cycle, dutyHps: amount / cycle,
});
const burst = (buffs, o = {}) => ({
  typeId: 43555, cycleSeconds: 60, capPerCycle: 0,
  buffs, buffSeconds: o.dur ?? 1000, charges: null,
});

// ---------------------------------------------------------------------------
// BB1. ACTIVE SHIELDING (−15) shortens the shield booster cycle AND cap.
//      390 hp / 4 s → 3.4 s cycle. Under 200-dmg volleys every 1 s on a
//      10,000 shield (damage keeps it below max so heals land in full):
//      in 60 s, heals at t=0, 3.4, 6.8 … = 1 + floor(60/3.4) = 18 heals of
//      390 = 7,020 healed (unbuffed: 1 + floor(60/4) = 16 → 6,240).
// ---------------------------------------------------------------------------
{
  const mk = (withBurst) => simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(200, 1)], hull: 1 }),
    ship('B', 'b', {
      shield: 10000,
      repairs: [rep('shield', 390, 4)],
      bursts: withBurst ? [burst([{ buffId: 11, value: -15 }])] : undefined,
    }),
  ], { maxSeconds: 60.5 });
  const bare = mk(false).ships.find((x) => x.id === 'B');
  const buffed = mk(true).ships.find((x) => x.id === 'B');
  // the t=0 heal lands on a shield only 200 below max (one volley) and
  // clamps to +200; every later heal is full
  close('BB1a unbuffed: 200 + 15 full heals', bare.healsApplied, 200 + 15 * 390, 1e-6);
  close('BB1b Active Shielding: 200 + 17 full heals — the cycle is 3.4 s',
    buffed.healsApplied, 200 + 17 * 390, 1e-6);
}

// ---------------------------------------------------------------------------
// BB2. RAPID REPAIR (−15) covers HULL repairers too (both require Repair
//      Systems — measured). Hull rep 30/3 s → 2.55 s cycle.
//      END-timing heals land at 2.55, 5.1, … : floor(60/2.55) = 23 heals
//      (unbuffed: floor(60/3) = 20).
// ---------------------------------------------------------------------------
{
  const mk = (withBurst) => simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(50, 1)], hull: 1 }),
    ship('B', 'b', {
      hull: 5000,
      repairs: [rep('hull', 30, 3)],
      bursts: withBurst ? [burst([{ buffId: 14, value: -15 }])] : undefined,
    }),
  ], { maxSeconds: 60.4 });
  const bare = mk(false).ships.find((x) => x.id === 'B');
  const buffed = mk(true).ships.find((x) => x.id === 'B');
  close('BB2a unbuffed hull rep: 20 end-of-cycle heals', bare.healsApplied, 20 * 30, 1e-6);
  close('BB2b Rapid Repair reaches the hull rep: 23 heals', buffed.healsApplied, 23 * 30, 1e-6);
}

// ---------------------------------------------------------------------------
// BB3. SHIELD EXTENSION (+15) raises the CEILING — heals fill the headroom.
//      Shield 1000; one 500 volley at t=0 → 500; one 800-hp heal at t≈0
//      (start timing, after LAND in phase order): unbuffed clamps at 1000
//      (+500), Extension clamps at 1150 (+650).
// ---------------------------------------------------------------------------
{
  const alpha = gun(500, 9999, { clip: { size: 1, perCycle: 1, reloadSeconds: 99999 } });
  const mk = (withBurst) => simulateBattleEvents([
    ship('A', 'a', { weapons: [alpha], hull: 1 }),
    ship('B', 'b', {
      shield: 1000,
      repairs: [rep('shield', 800, 5)],
      bursts: withBurst ? [burst([{ buffId: 12, value: 15 }])] : undefined,
    }),
  ], { maxSeconds: 4 });
  const bare = mk(false).ships.find((x) => x.id === 'B');
  const buffed = mk(true).ships.find((x) => x.id === 'B');
  close('BB3a unbuffed heal clamps at base max: +500', bare.healsApplied, 500, 1e-6);
  close('BB3b Extension raises the ceiling: +650', buffed.healsApplied, 650, 1e-6);
}

// ---------------------------------------------------------------------------
// BB4. RAPID DEPLOYMENT (+22.5) — a prop ship closes faster.
//      MWD ship, active max 1000, commanded 1000, from 20 km to hold 5 km:
//      unbuffed arrives at 15000/1000 = 15 s; buffed flies 1225 m/s and
//      arrives at 15000/1225 = 12.2449 s. Assert via the kill: a missile
//      with 5 km reach kills a 100-hp target with the first in-reach volley
//      (2 s cycle grid): unbuffed first volley ≥15 s → t=16; buffed → t=14.
// ---------------------------------------------------------------------------
{
  const lrm = gun(100, 2, {
    kind: 'missile', missileVelocity: 1e9, maxRange: 5000,
    expRadius: 100, expVelocity: 1e9, drf: 1,
  });
  const pair = { activeMaxVel: 1000, activeSig: 100, inactiveMaxVel: 200, inactiveSig: 100, blockable: true };
  const mk = (withBurst) => simulateBattleEvents([
    ship('A', 'a', {
      weapons: [lrm], hull: 1, range: 20000, commandedRange: 5000,
      flying: { speed: 1000, angleDeg: 0 }, propPair: pair, sig: 100,
      bursts: withBurst ? [burst([{ buffId: 22, value: 22.5 }])] : undefined,
    }),
    ship('B', 'b', { shield: 100, sig: 100, range: 20000 }),
  ], { maxSeconds: 60 });
  const bare = mk(false);
  const buffed = mk(true);
  // +5e-6 s: the probe missile still flies 5 km at 10^9 m/s
  close('BB4a unbuffed: first in-reach volley at t=16', bare.seconds, 16, 1e-4);
  close('BB4b Rapid Deployment closes sooner: kill at t=14', buffed.seconds, 14, 1e-4);
}

// ---------------------------------------------------------------------------
// BB5. INTERDICTION MANEUVERS (+22.5) stretches a web's reach.
//      Web optimal 10,000 (hard); victim orbiting at 1000 m/s at 11,500 m.
//      Unbuffed: out of reach, full speed. Buffed: 12,250 m reach → webbed
//      to 400 m/s. Probe missile (Ve 100 = sig-clamped Ve/Vt): dealt per
//      volley 100/1000 vs 100/400.
// ---------------------------------------------------------------------------
{
  const probe = gun(1000, 1, {
    kind: 'missile', missileVelocity: 1e9, maxRange: 1e12,
    expRadius: 100, expVelocity: 100, drf: 1,
  });
  const web = { typeId: 99, kind: 'web', cycleSeconds: 5, capPerCycle: 0,
    optimal: 10000, falloff: 0, resistAttr: 2115,
    rows: [{ modifies: 37, value: -60, stackable: false }] };
  const mk = (withBurst) => simulateBattleEvents([
    ship('A', 'a', {
      weapons: [probe], projected: [web], hull: 1, range: 11500,
      bursts: withBurst ? [burst([{ buffId: 21, value: 22.5 }])] : undefined,
    }),
    ship('B', 'b', { shield: 1e9, sig: 100, range: 11500, flying: { speed: 1000, angleDeg: 90 } }),
  ], { maxSeconds: 9.5 });
  close('BB5a out of web reach: 0.1 applied', mk(false).ships[0].damageDealt, 10 * 1000 * 0.1, 1e-6);
  close('BB5b Interdiction stretches the web there: 0.25 applied',
    mk(true).ships[0].damageDealt, 10 * 1000 * 0.25, 1e-6);
}

// ---------------------------------------------------------------------------
// BJ1. BURST JAMMER — an AoE lock BREAK, seeded and per-victim.
//      Strength 9 vs sensor 9: chance 1 (deterministic). Victim inside the
//      18 km bubble loses its locks every 30 s cycle and pays a full
//      re-lock (scanRes 400 vs sig 100 = 3.5622 s of silence per break). A
//      victim OUTSIDE the bubble is untouched. Guns: 100 dmg / 1 s.
//      LOCKS_ACQUIRED_FROM_ZERO (v0.96.0): BOTH victims now open with the
//      3.5622 s acquisition (the t=0 break costs the inside ship nothing
//      extra — it was still locking anyway), so the burst's price shows on
//      the MID-FIGHT break at t=30: the window runs to 59.5 s to catch it.
//      HAND-WALK — outside: volleys 3.5622+k ≤ 59.5 → 56 land. Inside:
//      27 volleys (3.5622..29.5622), break at 30, re-lock done 33.5622,
//      then 26 more (33.5622..58.5622) → 53. The break cost exactly the 3
//      volleys of its silence (30.56, 31.56, 32.56).
// ---------------------------------------------------------------------------
{
  const bj = { typeId: 2117, kind: 'burstJam', cycleSeconds: 30, capPerCycle: 0,
    optimal: 18000, falloff: 0, resistAttr: 2253,
    jamStrength: { grav: 9, ladar: 9, mag: 9, radar: 9 } };
  const mk = (victimRange) => simulateBattleEvents([
    ship('J', 'b', { projected: [bj], shield: 1e9, range: victimRange }),
    ship('V', 'a', {
      weapons: [gun(100, 1)], hull: 1, range: victimRange,
      scanRes: 400, sig: 100, sensor: { attr: 211, strength: 9 },
    }),
  ], { seed: 0, maxSeconds: 59.5 });
  const inside = mk(10000);
  const outside = mk(25000);
  eq('BJ1a inside the bubble the victim is lock-broken',
    inside.events.some((e) => e.kind === 'jammed' && /burst/.test(e.detail ?? '')), true);
  const dealtIn = inside.ships.find((x) => x.id === 'V').damageDealt;
  const dealtOut = outside.ships.find((x) => x.id === 'V').damageDealt;
  close('BJ1b outside pays only the opening acquisition: 56 volleys', dealtOut, 5600, 1e-6);
  close('BJ1c inside also pays the mid-fight break: 53 volleys', dealtIn, 5300, 1e-6);
}

// ---------------------------------------------------------------------------
// BJ2. Burst jammers engage the Monte Carlo (they are a random mechanic).
// ---------------------------------------------------------------------------
{
  const bj = { typeId: 2117, kind: 'burstJam', cycleSeconds: 30, capPerCycle: 0,
    optimal: 18000, falloff: 0, resistAttr: 2253,
    jamStrength: { grav: 5, ladar: 5, mag: 5, radar: 5 } };
  const fleet = [
    ship('J', 'b', { projected: [bj], shield: 1e9 }),
    ship('V', 'a', { weapons: [gun(100, 1)], hull: 1, scanRes: 400, sensor: { attr: 211, strength: 10 } }),
  ];
  eq('BJ2a hasRandomMechanics sees the burst jammer', hasRandomMechanics(fleet), true);
  const mc = runMonteCarlo(fleet, { maxSeconds: 10 }, 20);
  eq('BJ2b the wrapper runs stochastic', mc.mode, 'stochastic');
  eq('BJ2c 20 seeds ran', mc.perSeed.length, 20);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
