// v0.114.0 — ACTIVE RESIST HARDENERS: resists are only as alive as the
// capacitor feeding them. Every expected value hand-traced through the
// declared phase order (hardener chain at WAKE 1, volleys at LAND 6 —
// a same-second failure drops the resists BEFORE that second's volley).
//
//   H1  greedy: the cap runs dry, the hardeners drop at the exact cycle
//       the capacitor cannot pay, and every later volley lands at the
//       hardeners-DRY resonance — the ship dies 10 s sooner than the
//       unlimited-cap control
//   H2  disciplined + sticks: JIT/wake injections keep the hardeners fed
//       and the resists NEVER collapse — same fit dies at the control's
//       time, 10 s later than greedy H1
//   H3  the armour layer collapses the same way (sweep: dryResonance is
//       per-layer, not shield-only)

const { simulateBattleEvents } = require('./sim/lib/battleEvents.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};

const NO_RES = { em: 1, thermal: 1, kinetic: 1, explosive: 1 };
const HARD_RES = { em: 0.5, thermal: 0.5, kinetic: 0.5, explosive: 0.5 };
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
  hardeners: o.hardeners,
  capacitor: o.capacitor ?? DEAD_CAP,
  layers: o.layers ?? [
    { name: 'Shield', hp: o.shield ?? 0, resonance: o.shieldRes ?? NO_RES },
    { name: 'Armor', hp: o.armor ?? 0, resonance: o.armorRes ?? NO_RES },
    { name: 'Hull', hp: o.hull ?? 0, resonance: NO_RES },
  ],
  signatureRadius: 100000,
  flying: o.flying ?? { speed: 0, angleDeg: 0 },
  range: o.range ?? 1000,
});

// ===========================================================================
// H1. GREEDY COLLAPSE. Victim: shield 2000 at 50% resists (hardeners UP),
//     100% through when DRY; hardener bill 50 GJ / 10 s; capacitor 100, NO
//     recharge. Attacker: 100 dmg / 1 s, unlimited.
//     Cap: pays t=0 (→50), t=10 (→0); t=20 CANNOT PAY → hardenersDown at
//     t=20, before that second's volley (WAKE 1 < LAND 6).
//     Shield: t=0..19 at 50/volley → 1000 left; t=20..29 at 100 → 0 after
//     t=29; the 10-hp hull dies at t=30.
//     CONTROL (bottomless cap): 2000/50 = 40 volleys → hull dies t=40.
// ===========================================================================
{
  const mk = (cap) => simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(100, 1)], hull: 10 }),
    ship('V', 'b', {
      shield: 2000, hull: 10, shieldRes: HARD_RES,
      hardeners: { capPerCycle: 50, cycleSeconds: 10, dryResonance: [NO_RES, NO_RES, NO_RES] },
      capacitor: cap,
    }),
  ], { maxSeconds: 120 });
  const dry = mk({ capacity: 100, tau: 1e12 });
  const ctl = mk(DEAD_CAP);
  eq('H1a hardeners drop at the exact unpayable cycle (t=20)',
    dry.events.filter((e) => e.kind === 'hardenersDown').map((e) => e.t), [20]);
  eq('H1b resist collapse kills 10s sooner',
    dry.ships.find((x) => x.id === 'V').diedAt, 30);
  eq('H1c bottomless-cap control never drops, dies at 40', [
    ctl.events.filter((e) => e.kind === 'hardenersDown').length,
    ctl.ships.find((x) => x.id === 'V').diedAt,
  ], [0, 40]);
}

// ===========================================================================
// H2. DISCIPLINE + STICKS KEEP THE RESISTS ALIVE. Same victim, plus a
//     100 GJ injector (4 sticks, all loaded) and inject repping ON.
//     CYCLE-SYNCED (v0.116.0): the pull happens at the HARDENER'S OWN
//     cycle start, and only when the whole stick lands — t=0: pay →50;
//     t=10: a 100 GJ stick does NOT fit in 50 of headroom, pay →0;
//     t=20: cap 0, stick fits whole → pull +100 AND pay in the same
//     second (nothing idles for neuts); t=30: pay →0; t=40: pull + pay.
//     Injections at t=20 and t=40 — the hardeners NEVER drop, so the
//     ship dies exactly when the bottomless-cap control does: t=40.
//     (Before v0.116 the spend-hook injected at t=10/30, mid-way between
//     cycles — the owner's "inject on the module's cycle" correction.)
// ===========================================================================
{
  const out = simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(100, 1)], hull: 10 }),
    ship('V', 'b', {
      shield: 2000, hull: 10, shieldRes: HARD_RES,
      hardeners: { capPerCycle: 50, cycleSeconds: 10, dryResonance: [NO_RES, NO_RES, NO_RES] },
      capacitor: { capacity: 100, tau: 1e12 },
      capBoosters: [{
        injectGj: 100, cycleSeconds: 10,
        charges: { count: 4, perCycle: 1, cycles: 4, reloadSeconds: 1 },
      }],
      capBoosterReserve: 4,
      injectDiscipline: true,
    }),
  ], { maxSeconds: 120 });
  const v = out.ships.find((x) => x.id === 'V');
  eq('H2a sticks keep the hardeners up — no collapse',
    out.events.filter((e) => e.kind === 'hardenersDown').length, 0);
  eq('H2b injections ride the HARDENER cycles (t=20, t=40)',
    out.events.filter((e) => e.kind === 'injected').map((e) => e.t), [20, 40]);
  eq('H2c same death as the bottomless control — resists never blinked',
    v.diedAt, 40);
}

// ===========================================================================
// H3. THE ARMOUR LAYER COLLAPSES THE SAME WAY (dryResonance is per-layer).
//     Armour 1500 at 50% resists, dry = 100% through; same 50 GJ / 10 s
//     hardener on a 100 GJ cap. Drop at t=20: t=0..19 at 50 → 500 left;
//     t=20..24 at 100 → 0 after t=24; hull dies t=25. Control: 30 volleys
//     of 50 → hull dies t=30.
// ===========================================================================
{
  const mk = (cap) => simulateBattleEvents([
    ship('A', 'a', { weapons: [gun(100, 1)], hull: 10 }),
    ship('V', 'b', {
      armor: 1500, hull: 10, armorRes: HARD_RES,
      hardeners: { capPerCycle: 50, cycleSeconds: 10, dryResonance: [NO_RES, NO_RES, NO_RES] },
      capacitor: cap,
    }),
  ], { maxSeconds: 120 });
  const dry = mk({ capacity: 100, tau: 1e12 });
  const ctl = mk(DEAD_CAP);
  eq('H3a armour hardeners drop at t=20',
    dry.events.filter((e) => e.kind === 'hardenersDown').map((e) => e.t), [20]);
  eq('H3b dry armour dies at 25, powered control at 30', [
    dry.ships.find((x) => x.id === 'V').diedAt,
    ctl.ships.find((x) => x.id === 'V').diedAt,
  ], [25, 30]);
}

console.log(`\nhardener.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
