// IMPLANT SLOTS — the model that exists because the ENGINE enforces nothing.
// Against the SHIPPED compiled code.
const I = require('./sim/lib/implants.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};

// A controlled catalog. Real ids and real slots, decoded from the bundle:
// Zainou 'Gypsy' CPU Management EE-602/604/606 are slot 6; the Genolution
// Core Augmentation line spans slots 1-4; AU-79 is the one oddity at 79.
const EE602 = 27070, EE604 = 27072, EE606 = 27074;
const CA1 = 33328, CA2 = 33329.1, AU79 = 33329;
const SQUIRE = 27101;         // slot 5 powergrid
const RIFTER = 587;           // not an implant at all
const D = (attrs) => ({ dogmaAttributes: attrs.map(([attributeID, value]) => ({ attributeID, value })) });
const data = {
  types: {
    [EE602]: { name: "Zainou 'Gypsy' CPU Management EE-602", published: true },
    [EE604]: { name: "Zainou 'Gypsy' CPU Management EE-604", published: true },
    [EE606]: { name: "Zainou 'Gypsy' CPU Management EE-606", published: true },
    [SQUIRE]: { name: "Inherent Implants 'Squire' Power Grid Management EG-605", published: true },
    [CA1]: { name: 'Genolution Core Augmentation CA-1', published: true },
    [AU79]: { name: "Genolution 'Auroral' AU-79", published: true },
    [RIFTER]: { name: 'Rifter', published: true },
  },
  typeDogma: {
    // 331 implantness; 182/277 = requiredSkill1 + level (3411 = Cybernetics)
    [EE602]: D([[331, 6], [424, 2], [182, 3411], [277, 1]]),
    [EE604]: D([[331, 6], [424, 4], [182, 3411], [277, 3]]),
    [EE606]: D([[331, 6], [424, 6], [182, 3411], [277, 5]]),
    [SQUIRE]: D([[331, 5], [313, 5], [182, 3411], [277, 4]]),
    [CA1]: D([[331, 1], [313, 1.5], [1079, 1.5], [182, 3411], [277, 1]]),
    // the published oddity: slot 79, no Cybernetics requirement, inert
    [AU79]: D([[331, 79], [422, 1]]),
    [RIFTER]: D([[4, 1067000]]),
  },
};

// ---------------------------------------------------------------------------
// 1. SLOTS
// ---------------------------------------------------------------------------
eq('1a a hardwiring reports its slot', I.implantSlot(data, EE602), 6);
eq('1b a different line, a different slot', I.implantSlot(data, SQUIRE), 5);
eq('1c a ship is not an implant', I.implantSlot(data, RIFTER), undefined);
eq('1d isImplant agrees', [I.isImplant(data, EE602), I.isImplant(data, RIFTER)], [true, false]);
eq('1e the slot-79 oddity keeps its own slot rather than being rejected',
  I.implantSlot(data, AU79), 79);

// ---------------------------------------------------------------------------
// 2. CYBERNETICS — declared in any of the SIX requiredSkill slots
// ---------------------------------------------------------------------------
eq('2a EE-602 needs Cybernetics 1', I.cyberneticsFor(data, EE602), 1);
eq('2b EE-606 needs Cybernetics 5', I.cyberneticsFor(data, EE606), 5);
eq('2c the oddity needs none', I.cyberneticsFor(data, AU79), 0);
{
  // the SAME implant, declaring Cybernetics in requiredSkill4 instead
  const alt = {
    types: { 999: { name: 'Odd Hardwiring', published: true } },
    typeDogma: { 999: D([[331, 8], [1285, 3411], [1286, 4]]) },
  };
  eq('2d a requirement in slot FOUR is still found', I.cyberneticsFor(alt, 999), 4);
}
{
  // slot FIVE's level is attribute 1287, NOT 1290 — the pairing interleaves
  const alt = {
    types: { 998: { name: 'Deep Hardwiring', published: true } },
    typeDogma: { 998: D([[331, 8], [1289, 3411], [1287, 3]]) },
  };
  eq('2e requiredSkill5 pairs with attribute 1287, not the next id',
    I.cyberneticsFor(alt, 998), 3);
}

// ---------------------------------------------------------------------------
// 3. ONE IMPLANT PER SLOT. The engine applies BOTH — measured on the shipped
//    wasm as 162.5 -> 175.695 CPU, i.e. x1.06 x 1.02, a pod that cannot exist.
// ---------------------------------------------------------------------------
{
  const r = I.normalizePod([EE606, EE604, EE602], data, 5);
  eq('3a only the FIRST occupant of slot 6 survives', r.accepted, [EE606]);
  eq('3b the other two are reported, not dropped silently', r.rejected.length, 2);
  eq('3c and the reason names the slot and the holder',
    /slot 6 already holds/.test(r.rejected[0].reason), true);
}
{
  const r = I.normalizePod([EE606, SQUIRE, CA1], data, 5);
  eq('3d different slots all fit together', r.accepted, [EE606, SQUIRE, CA1]);
  eq('3e nothing rejected', r.rejected, []);
}
{
  const r = I.normalizePod([EE602, EE602], data, 5);
  eq('3f the same implant twice is refused', r.accepted, [EE602]);
  eq('3g ...and named as such', r.rejected[0].reason, 'the same implant twice');
}
eq('3h the slot-79 oddity collides with nothing',
  I.normalizePod([EE606, SQUIRE, CA1, AU79], data, 5).accepted.length, 4);

// ---------------------------------------------------------------------------
// 4. CYBERNETICS GATING. The engine gives a grade-5 bonus to a pilot with
//    Cybernetics 0. It must not reach the engine at all.
// ---------------------------------------------------------------------------
{
  const r = I.normalizePod([EE606], data, 0);
  eq('4a Cybernetics 0 cannot wear a grade-5 hardwiring', r.accepted, []);
  eq('4b and is told why', r.rejected[0].reason, 'needs Cybernetics 5, pilot has 0');
}
eq('4c Cybernetics 3 can wear the grade-3', I.normalizePod([EE604], data, 3).accepted, [EE604]);
eq('4d ...but not the grade-5', I.normalizePod([EE606], data, 3).accepted, []);
eq('4e passing null skips the check entirely (a pilot who WILL train it)',
  I.normalizePod([EE606], data, null).accepted, [EE606]);
eq('4f the no-requirement oddity is wearable at Cybernetics 0',
  I.normalizePod([AU79], data, 0).accepted, [AU79]);

// ---------------------------------------------------------------------------
// 5. JUNK. The engine silently ignores a non-implant id; we say so.
// ---------------------------------------------------------------------------
{
  const r = I.normalizePod([RIFTER, EE602], data, 5);
  eq('5a a ship id is refused', r.accepted, [EE602]);
  eq('5b with a plain reason', r.rejected[0].reason, 'not an implant');
  eq('5c an unknown id is refused too', I.normalizePod([12345678], data, 5).accepted, []);
}

// ---------------------------------------------------------------------------
// 6. ORDER IS THE CALLER'S LEVER — a search puts its candidate first and the
//    displaced implant is named, which is what the wrench popover reports.
// ---------------------------------------------------------------------------
{
  const r = I.normalizePod([EE606, EE602], data, 5);
  eq('6a candidate first wins the slot', r.accepted, [EE606]);
  eq('6b and the displaced one is identifiable', r.rejected[0].typeId, EE602);
  eq('6c reversing the order reverses the outcome',
    I.normalizePod([EE602, EE606], data, 5).accepted, [EE602]);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
