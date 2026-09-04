// THE IMPLANT SOLVER. The search logic is tested against a SYNTHETIC scorer
// that reproduces the composition law measured on the real engine, so the
// fixtures pin the SEARCH — the thing that can be structurally wrong — rather
// than re-measuring dogma.
//
// The law (measured, API-NOTES.md): M = product of every present piece's set
// multiplier; each piece's bonus x M, including its own factor. An Omega
// carries a large multiplier and NO bonus of its own, which is exactly why a
// per-slot search cannot see it.
const { solveImplants } = require('./sim/lib/implantSolver.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};

// --- a catalog shaped like the real one ------------------------------------
// A five-piece set (slots 1-5) each +10, plus an Omega in slot 6 that is worth
// NOTHING alone and multiplies the set by 3.
const D = (attrs) => ({ dogmaAttributes: attrs.map(([attributeID, value]) => ({ attributeID, value })) });
const types = {};
const typeDogma = {};
const SET = [];
['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].forEach((g, i) => {
  const id = 100 + i;
  SET.push(id);
  types[id] = { name: `High-grade Snake ${g}`, published: true };
  // 331 implantness, 182/277 Cybernetics 1, 900 = the set's own bonus
  typeDogma[id] = D([[331, i + 1], [182, 3411], [277, 1], [900, 10]]);
});
const OMEGA = 106;
SET.push(OMEGA);
types[OMEGA] = { name: 'High-grade Snake Omega', published: true };
typeDogma[OMEGA] = D([[331, 6], [182, 3411], [277, 5]]);   // NO bonus of its own

// a plain hardwiring in slot 7, worth a flat 5, in no set
const HW = 200, HW_BIG = 201;
types[HW] = { name: 'Zainou Something HW-601', published: true };
typeDogma[HW] = D([[331, 7], [182, 3411], [277, 1], [900, 5]]);
types[HW_BIG] = { name: 'Zainou Something HW-605', published: true };
typeDogma[HW_BIG] = D([[331, 7], [182, 3411], [277, 5], [900, 9]]);

// a grade-5 piece the low-Cybernetics pilot cannot wear
const LOCKED = 300;
types[LOCKED] = { name: 'Zainou Locked HW-610', published: true };
typeDogma[LOCKED] = D([[331, 8], [182, 3411], [277, 5], [900, 50]]);

const data = { types, typeDogma };

/** the measured composition law, as a scorer */
const bonusOf = (id) => typeDogma[id]?.dogmaAttributes.find((a) => a.attributeID === 900)?.value ?? 0;
const score = async (implants) => {
  const hasOmega = implants.includes(OMEGA);
  const setPieces = implants.filter((id) => SET.includes(id));
  const mult = hasOmega ? 3 : 1;
  const fromSet = setPieces.reduce((n, id) => n + bonusOf(id), 0) * mult;
  const fromHw = implants.filter((id) => !SET.includes(id)).reduce((n, id) => n + bonusOf(id), 0);
  return fromSet + fromHw;
};

(async () => {
  // -------------------------------------------------------------------------
  // 1. THE WHOLE POINT: the Omega must be picked, and only a whole-set search
  //    can pick it — alone it scores exactly the same as an empty slot.
  // -------------------------------------------------------------------------
  eq('1a an Omega alone is worth nothing', await score([OMEGA]), 0);
  eq('1b ...exactly as much as no implants at all', await score([]), 0);
  eq('1c but it triples the set', await score(SET), 150);

  const r = await solveImplants({ data, cybernetics: 5, score });
  eq('1d the solver finds the full set', r.setName, 'High-grade Snake');
  eq('1e including the Omega a per-slot search could never see',
    r.implants.includes(OMEGA), true);
  eq('1f and it beats the baseline', r.score > r.baseline, true);
  eq('1g the baseline is reported so the gain is visible', r.baseline, 0);

  // -------------------------------------------------------------------------
  // 2. REFINEMENT fills the slots the set did not use, measured on top.
  // -------------------------------------------------------------------------
  eq('2a slot 7 is filled from outside the set', r.implants.includes(HW_BIG) || r.implants.includes(HW), true);
  eq('2b and the pod is legal — one per slot, no duplicates',
    new Set(r.implants).size, r.implants.length);
  // six set pieces + slot-7 hardwiring + the slot-8 one: refinement fills
  // EVERY slot the set left open, each measured on top of the last
  eq('2c every free slot is filled, not just the first', r.implants.length, 8);
  eq('2d the strongest reachable hardwiring wins its slot', r.implants.includes(HW_BIG), true);
  eq('2e ...and the weaker one in the same slot is not also worn',
    r.implants.includes(HW), false);

  // -------------------------------------------------------------------------
  // 3. CYBERNETICS gates the search, not just the result.
  // -------------------------------------------------------------------------
  const low = await solveImplants({ data, cybernetics: 1, score });
  eq('3a a grade-5 Omega is unreachable at Cybernetics 1', low.implants.includes(OMEGA), false);
  eq('3b ...and so is the grade-5 hardwiring', low.implants.includes(HW_BIG), false);
  eq('3c the affordable hardwiring is still taken', low.implants.includes(HW), true);
  eq('3d and the locked grade-5 never appears', low.implants.includes(LOCKED), false);
  eq('3e a lower-skilled pilot scores strictly worse', low.score < r.score, true);

  // -------------------------------------------------------------------------
  // 4. HONESTY: it reports what it searched and how much engine time it spent.
  // -------------------------------------------------------------------------
  eq('4a it names what was NOT searched', /NOT searched/.test(r.searched), true);
  eq('4b it counts its engine runs', r.engineRuns > 0, true);
  eq('4c runners-up are kept so a cheaper set can be chosen', r.considered.length > 1, true);
  eq('4d best first', r.considered[0].score >= r.considered[1].score, true);
  eq('4e the no-implant case is always among them',
    r.considered.some((x) => x.label === 'no implants'), true);

  // -------------------------------------------------------------------------
  // 5. CANCELLATION and refusal.
  // -------------------------------------------------------------------------
  eq('5a a cancelled search returns null',
    await solveImplants({ data, cybernetics: 5, score, cancelled: () => true }), null);
  eq('5b a scorer that cannot score anything returns null',
    await solveImplants({ data, cybernetics: 5, score: async () => null }), null);

  // -------------------------------------------------------------------------
  // 6. THE OBJECTIVE IS THE CALLER'S. Invert it and the answer inverts —
  //    proving nothing about "better" is baked into the search.
  // -------------------------------------------------------------------------
  const inverted = await solveImplants({
    data, cybernetics: 5, score: async (ids) => -(await score(ids)),
  });
  eq('6a with an inverted objective the empty pod wins', inverted.implants, []);
  eq('6b so no notion of "good" is hardcoded in the search', inverted.setName, null);

  // -------------------------------------------------------------------------
  // 7. PRICES. The app already holds an average price for every type in the
  //    game (one cached ESI call), so a pod can be costed — and the CHEAPEST
  //    thing that still beats doing nothing is usually the interesting answer.
  // -------------------------------------------------------------------------
  const prices = new Map([
    [100, 50e6], [101, 50e6], [102, 50e6], [103, 50e6], [104, 50e6], [OMEGA, 2e9],
    [HW, 5e6], [HW_BIG, 400e6], [LOCKED, 900e6],
  ]);
  const priced = await solveImplants({ data, cybernetics: 5, score, prices });
  eq('7a the winning pod is costed', priced.cost > 0, true);
  eq('7b and it is the sum of its pieces',
    priced.cost, priced.implants.reduce((n, id) => n + (prices.get(id) ?? 0), 0));
  eq('7c a cheapest-that-still-helps option is offered', priced.bestValue !== null, true);
  eq('7d ...and it is no dearer than the winner', priced.bestValue.cost <= priced.cost, true);
  eq('7e it still beats doing nothing', priced.bestValue.score > priced.baseline, true);
  const unpriced = await solveImplants({ data, cybernetics: 5, score });
  eq('7f with no prices supplied, nothing is invented',
    [unpriced.cost, unpriced.bestValue], [null, null]);

  // -------------------------------------------------------------------------
  // 8. DEEP MODE searches strictly more, and never does worse.
  // -------------------------------------------------------------------------
  const quick = await solveImplants({ data, cybernetics: 5, score, perSlotCandidates: 1 });
  const deep = await solveImplants({ data, cybernetics: 5, score, deep: true });
  eq('8a deep spends more engine runs', deep.engineRuns > quick.engineRuns, true);
  eq('8b and never scores worse', deep.score >= quick.score, true);
  eq('8c it says it looked at everything', /EVERY reachable/.test(deep.searched), true);
  // the old wording claimed "the N strongest", which was a lie — nothing
  // sorted them. It now states the count plainly and nothing more.
  eq('8d a bounded search states its per-slot count',
    /1 hardwirings per remaining slot/.test(quick.searched), true);
  eq('8e ...and never claims they were the strongest',
    /strongest/.test(quick.searched), false);

  // -------------------------------------------------------------------------
  // 9. EVERY candidate is costed, and the GRADE LADDER is offered — "the
  //    runner-up should at least be the next lower version of the same
  //    implant", which a list of unrelated sets never was.
  // -------------------------------------------------------------------------
  // add a Mid-grade sibling of the whole set, cheaper and weaker
  ['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon'].forEach((g, i2) => {
    const id = 400 + i2;
    types[id] = { name: `Mid-grade Snake ${g}`, published: true };
    typeDogma[id] = D([[331, i2 + 1], [182, 3411], [277, 1], [900, 6]]);
    prices.set(id, 8e6);
  });
  types[406] = { name: 'Mid-grade Snake Omega', published: true };
  typeDogma[406] = D([[331, 6], [182, 3411], [277, 5]]);
  prices.set(406, 200e6);
  const MID = [400, 401, 402, 403, 404, 406];
  const score2 = async (implants) => {
    const mult = (implants.includes(OMEGA) ? 3 : 1) * (implants.includes(406) ? 2 : 1);
    const setSum = implants.filter((id) => SET.includes(id) || MID.includes(id))
      .reduce((n, id) => n + bonusOf(id), 0) * mult;
    const hw = implants.filter((id) => !SET.includes(id) && !MID.includes(id))
      .reduce((n, id) => n + bonusOf(id), 0);
    return setSum + hw;
  };
  const laddered = await solveImplants({ data, cybernetics: 5, score: score2, prices });
  eq('9a every candidate carries a price',
    laddered.considered.every((x) => typeof x.cost === 'number'), true);
  eq('9b the shortlist offers a same-line downgrade',
    laddered.considered.some((x) => /grade down|->/.test(x.label)), true);
  eq('9c a cheaper option really is cheaper than the winner',
    laddered.bestValue.cost < laddered.cost, true);
  eq('9d ...and the winner is still the highest scoring',
    laddered.considered[0].score, laddered.score);
  eq('9e the Mid-grade sibling is among the options considered',
    laddered.considered.some((x) => /Mid-grade Snake/.test(x.label)), true);



  // --- 10. THE PLATEAU (v0.97.4) -------------------------------------------
  // A QUANTISED objective, like a fight whose death time snaps to the
  // victim's rep-cycle grid: single hardwirings cannot cross the step, only
  // the PAIR can. Caught live: "now it seems that I can not see
  // hardwirings?" - the strict one-at-a-time sweep stalled and the winning
  // set showed no hardwirings at all.
  //
  // Scorer: floor(raw / 10) over ONLY the three plateau hardwirings (the
  // shared catalog's big slot-8 piece must not shortcut the test). Singles:
  // floor(5/10) = floor(9/10) = 0 - no single gain. Any slot-7 pick plus
  // the slot-8 piece: floor((5|9 + 5)/10) = 1 - only the bundle crosses.
  {
    const HW2 = 210;
    types[HW2] = { name: 'Eifyr Other OT-801', published: true };
    typeDogma[HW2] = D([[331, 8], [182, 3411], [277, 1], [900, 5]]);
    const stepScore = async (implants) => {
      const raw = implants.filter((id) => [200, 201, 210].includes(id))
        .reduce((n, id) => n + bonusOf(id), 0);
      return Math.floor(raw / 10);
    };
    const r = await solveImplants({ data, cybernetics: 5, score: stepScore });
    eq('10a the plateau jump finds the two-implant combo (score 1)',
      r.score, 1);
    eq('10b the winning pod carries BOTH hardwirings',
      r.implants.length >= 2
        && r.implants.some((id) => id === 200 || id === 201)
        && r.implants.includes(210), true);
  }

  // --- 11. THE EMPTY SEED IS ALWAYS REFINED (v0.97.4) -----------------------
  // When one set strictly leads (a real margin gain), the quick search's
  // single seed became that set and bare hardwirings vanished from the
  // shortlist. The empty pod must ALWAYS be refined too.
  {
    const r = await solveImplants({ data, cybernetics: 5, score });
    const bare = r.considered.find((x) => x.label === 'no implants + hardwirings');
    eq('11a the bare-hardwirings refinement is in the shortlist', bare !== undefined, true);
    eq('11b ...and it actually wears hardwirings', (bare?.implants.length ?? 0) > 0, true);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
