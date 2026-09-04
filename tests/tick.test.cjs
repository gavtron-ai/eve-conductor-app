// THE TICK SIMULATION. These fixtures exist because a closed-form
// time-to-kill silently gets focus fire, kill order and cap-limited repair
// wrong, and a formula has nowhere to put any of them.
const { simulateBattle } = require('./sim/lib/battleTick.js');

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

const NO_RES = { em: 1, thermal: 1, kinetic: 1, explosive: 1 };
const NO_DEF = { shieldRepairHps: 0, armorRepairHps: 0, shieldPassiveHps: 0, capOutSeconds: null };

/** an untracked weapon applies in full at any range — isolates the SIM from
 * the application maths, which fitsim.test already covers */
const gun = (dps) => ({
  typeId: 1, kind: 'untracked', cycleSeconds: 1,
  volley: { em: dps, thermal: 0, kinetic: 0, explosive: 0 },
});

const ship = (id, side, hp, dps, extra = {}) => ({
  id, name: id, side,
  weapons: dps > 0 ? [gun(dps)] : [],
  layers: [{ name: 'Shield', hp, resonance: NO_RES },
           { name: 'Armor', hp: 0, resonance: NO_RES },
           { name: 'Hull', hp: 0, resonance: NO_RES }],
  defenses: NO_DEF,
  signatureRadius: 100000,
  flying: { speed: 0, angleDeg: 0 },
  range: 1000,
  ...extra,
});

// ---------------------------------------------------------------------------
// 1. THE BASELINE: a 1v1 must agree with the arithmetic.
// ---------------------------------------------------------------------------
{
  // A: 1000 hp, 100 dps. B: 500 hp, 50 dps. A kills B at 10 s; B has done 500.
  const r = simulateBattle([ship('A', 'a', 1000, 100), ship('B', 'b', 500, 50)], { step: 0.05 });
  eq('1a the side that kills first wins', r.winner, 'a');
  close('1b ...at 500 hp / 100 dps = 5 s', r.seconds, 5, 0.1);
  const A = r.ships.find((s) => s.id === 'A');
  close('1c the loser still landed 5 s of damage', 1000 * A.remaining[0], 1000 - 250, 20);
  eq('1d and is recorded as alive', A.alive, true);
  eq('1e while the loser is not', r.ships.find((s) => s.id === 'B').alive, false);
}

// ---------------------------------------------------------------------------
// 2. FOCUS FIRE. THE WHOLE REASON THIS EXISTS.
//    Three attackers of 100 dps against two defenders. Killing one defender
//    removes its damage for the rest of the fight — a closed-form TTK that
//    assumes constant incoming cannot express that.
// ---------------------------------------------------------------------------
{
  const r = simulateBattle([
    ship('A1', 'a', 2000, 100), ship('A2', 'a', 2000, 100), ship('A3', 'a', 2000, 100),
    ship('B1', 'b', 600, 200), ship('B2', 'b', 600, 200),
  ], { step: 0.05 });
  eq('2a the outnumbering side wins', r.winner, 'a');
  const deaths = r.events.filter((e) => e.kind === 'death');
  eq('2b both defenders die', deaths.length, 2);
  // 300 dps focused onto 600 hp = 2 s for the first kill
  close('2c the first kill lands at 600/300', deaths[0].t, 2, 0.15);
  // after that only ONE defender is shooting, so the second takes another 2 s
  close('2d and the second 2 s later', deaths[1].t, 4, 0.2);
  eq('2e the survivors are all on side a', r.ships.filter((s) => s.alive).every((s) => s.side === 'a'), true);
}

// ---------------------------------------------------------------------------
// 3. KILL ORDER CHANGES THE OUTCOME. Same ships, different priority.
//    One enemy is fragile and dangerous; the other is tough and harmless.
//    Shooting the dangerous one first must leave you healthier.
// ---------------------------------------------------------------------------
{
  const setup = () => [
    ship('Me', 'a', 4000, 100),
    ship('Glass', 'b', 400, 300),   // fragile, hits hard
    ship('Brick', 'b', 4000, 10),   // tough, harmless
  ];
  const byName = (want) => (_s, enemies) =>
    enemies.find((e) => e.alive && e.ship.id === want) ?? enemies.find((e) => e.alive) ?? null;

  const smart = simulateBattle(setup(), { step: 0.05, pickTarget: byName('Glass') });
  const dumb = simulateBattle(setup(), { step: 0.05, pickTarget: byName('Brick') });
  const hpOf = (r) => r.ships.find((s) => s.id === 'Me').remaining[0];

  eq('3a killing the dangerous ship first is survivable', smart.winner, 'a');
  eq('3b killing the tough one first is not', dumb.winner, 'b');
  eq('3c ...and the difference is entirely kill order', hpOf(smart) > 0, true);
}

// ---------------------------------------------------------------------------
// 4. REPAIR, AND THE CAPACITOR THAT LIMITS IT.
// ---------------------------------------------------------------------------
{
  // 100 incoming, 60 repaired -> net 40. 400 hp lasts 10 s.
  const repper = ship('R', 'b', 400, 0, {
    defenses: { shieldRepairHps: 60, armorRepairHps: 0, shieldPassiveHps: 0, capOutSeconds: null },
  });
  const r = simulateBattle([ship('A', 'a', 9999, 100), repper], { step: 0.05 });
  close('4a repair extends the fight to hp/(dps-rep)', r.seconds, 10, 0.4);

  // the same ship, but the capacitor dies at 3 s
  const dry = ship('R', 'b', 400, 0, {
    defenses: { shieldRepairHps: 60, armorRepairHps: 0, shieldPassiveHps: 0, capOutSeconds: 3 },
  });
  const r2 = simulateBattle([ship('A', 'a', 9999, 100), dry], { step: 0.05 });
  eq('4b a cap-out is reported as an event',
    r2.events.some((e) => e.kind === 'capOut'), true);
  // 3 s at net 40 = 120 stripped; the remaining 280 at full 100 = 2.8 s
  close('4c and the fight ends sooner once the reps stop', r2.seconds, 3 + 2.8, 0.4);
  eq('4d which is sooner than with a stable capacitor', r2.seconds < r.seconds, true);

  // passive regen does NOT stop at cap-out
  const passive = ship('P', 'b', 400, 0, {
    defenses: { shieldRepairHps: 0, armorRepairHps: 0, shieldPassiveHps: 60, capOutSeconds: 1 },
  });
  const r3 = simulateBattle([ship('A', 'a', 9999, 100), passive], { step: 0.05 });
  close('4e passive regen keeps working after the capacitor is dry', r3.seconds, 10, 0.4);
}

// ---------------------------------------------------------------------------
// 5. STALEMATE is a real outcome, not an infinite loop.
// ---------------------------------------------------------------------------
{
  const tank = ship('T', 'b', 100, 0, {
    defenses: { shieldRepairHps: 1000, armorRepairHps: 0, shieldPassiveHps: 0, capOutSeconds: null },
  });
  const r = simulateBattle([ship('A', 'a', 9999, 10), tank], { step: 0.25, maxSeconds: 60 });
  eq('5a nobody wins', r.winner, null);
  eq('5b and the sim says so rather than returning a time', r.seconds, null);
  close('5c it stopped at the limit rather than looping', r.elapsed, 60, 0.5);
}

// ---------------------------------------------------------------------------
// 6. A SHIP WITH NO GUNS still dies; a fight with no guns at all ends nowhere.
// ---------------------------------------------------------------------------
{
  const r = simulateBattle([ship('A', 'a', 1000, 100), ship('B', 'b', 300, 0)], { step: 0.05 });
  eq('6a an unarmed ship is still killable', r.winner, 'a');
  close('6b in exactly hp/dps', r.seconds, 3, 0.1);
  const none = simulateBattle([ship('A', 'a', 100, 0), ship('B', 'b', 100, 0)],
    { step: 0.25, maxSeconds: 10 });
  eq('6c two unarmed ships stalemate', none.winner, null);
}

// ---------------------------------------------------------------------------
// 7. ORDER INDEPENDENCE: two ships firing in the same tick must not depend on
//    their position in the array.
// ---------------------------------------------------------------------------
{
  const a = simulateBattle([ship('A', 'a', 500, 100), ship('B', 'b', 500, 100)], { step: 0.05 });
  const b = simulateBattle([ship('B', 'b', 500, 100), ship('A', 'a', 500, 100)], { step: 0.05 });
  eq('7a a perfectly even fight is a draw either way', [a.winner, b.winner], [null, null]);
  close('7b and both sides die at the same moment', a.elapsed, b.elapsed, 1e-9);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
