// Fixtures for the v60.31 fit-math fixes, against the SHIPPED compiled code.
//
//  A. toEsfFit() — every drone in the BAY used to be handed to the engine as
//     'Active' (up to 25), so spare flights were counted as firing. Neither
//     drone bandwidth nor the 5-drone ceiling was modelled.
//  B. rackSizes() — Loki/Tengu/Legion/Proteus publish hiSlots=0/medSlots=0/
//     lowSlots=0; every slot comes from the fitted SUBSYSTEMS, which were
//     never read, so a T3 opened with an empty fitting window.

const { toEsfFit } = require('./r3/dogmaFit.js');
const { rackSizes, normalizeFitLayout, emptyVariation, newWizardFit } = require('./r3/wizardFits.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// ---------------------------------------------------------------------------
// A. DRONES
// ---------------------------------------------------------------------------
const ATTR_BW = 1271, ATTR_BW_USED = 1272;
const VEXOR = 626, HOBGOBLIN = 2456, OGRE = 2444, RIFTER = 587;

// a hull with 75 Mbit/s of bandwidth (a real Vexor), light drones at 5 each,
// heavies at 25 each. Numbers chosen so the two limits bite separately.
const data = {
  types: {
    [VEXOR]: { name: 'Vexor', groupID: 26, categoryID: 6 },
    [RIFTER]: { name: 'Rifter', groupID: 25, categoryID: 6 },
    [HOBGOBLIN]: { name: 'Hobgoblin I', groupID: 100, categoryID: 18 },
    [OGRE]: { name: 'Ogre I', groupID: 101, categoryID: 18 },
  },
  typeDogma: {
    [VEXOR]: { dogmaAttributes: [{ attributeID: ATTR_BW, value: 75 }], dogmaEffects: [] },
    [RIFTER]: { dogmaAttributes: [{ attributeID: ATTR_BW, value: 0 }], dogmaEffects: [] },
    [HOBGOBLIN]: { dogmaAttributes: [{ attributeID: ATTR_BW_USED, value: 5 }], dogmaEffects: [] },
    [OGRE]: { dogmaAttributes: [{ attributeID: ATTR_BW_USED, value: 25 }], dogmaEffects: [] },
  },
};
const fitWith = (items) => ({ shipId: VEXOR, shipName: 'Vexor', items, unresolved: [], extraFits: 0 });
const drone = (typeId, name, qty) => ({ typeId, name, qty, offlineQty: 0, charges: [] });

// 10 light drones aboard: bandwidth allows 15, but only FIVE can be in space
let r = toEsfFit(fitWith([drone(HOBGOBLIN, 'Hobgoblin I', 10)]), data);
eq('10 light drones aboard -> only 5 are active', r.esfFit.drones.length, 5);
eq('...the other 5 are named, not silently dropped', r.benchedDrones, ['Hobgoblin I x5']);
eq('...bandwidth used is 5 x 5', r.droneBandwidthUsed, 25);

// 25 aboard — the old code's exact cap. Must still be 5.
r = toEsfFit(fitWith([drone(HOBGOBLIN, 'Hobgoblin I', 25)]), data);
eq('25 aboard (the OLD limit) is still only 5 active', r.esfFit.drones.length, 5);
eq('...and 20 benched', r.benchedDrones, ['Hobgoblin I x20']);

// BANDWIDTH, not the count, is the binding limit for heavies: 75 / 25 = 3
r = toEsfFit(fitWith([drone(OGRE, 'Ogre I', 5)]), data);
eq('5 heavy drones but only 75 Mbit/s -> 3 in space', r.esfFit.drones.length, 3);
eq('...2 benched by bandwidth', r.benchedDrones, ['Ogre I x2']);
eq('...bandwidth is fully spent', r.droneBandwidthUsed, 75);
eq('...and the hull figure is reported', r.droneBandwidth, 75);

// exactly at both limits: nothing benched, nothing invented
r = toEsfFit(fitWith([drone(HOBGOBLIN, 'Hobgoblin I', 5)]), data);
eq('exactly 5 lights fit with room to spare', r.esfFit.drones.length, 5);
eq('...nothing is benched', r.benchedDrones, []);
eq('...using 25 of 75', r.droneBandwidthUsed, 25);

// a hull with NO drone bay at all
r = toEsfFit({ ...fitWith([drone(HOBGOBLIN, 'Hobgoblin I', 5)]), shipId: RIFTER }, data);
eq('a zero-bandwidth hull still respects the 5-drone cap', r.esfFit.drones.length, 5);

// mixed bay: the count limit applies ACROSS stacks, not per stack
r = toEsfFit(fitWith([drone(HOBGOBLIN, 'Hobgoblin I', 4), drone(OGRE, 'Ogre I', 4)]), data);
eq('a mixed bay caps at 5 drones TOTAL', r.esfFit.drones.length, 5);
eq('...4 lights (20) + 1 heavy (25) = 45 Mbit/s', r.droneBandwidthUsed, 45);
eq('...the rest are benched', r.benchedDrones, ['Ogre I x3']);

// ---------------------------------------------------------------------------
// B. TECH III RACK SIZES
// ---------------------------------------------------------------------------
const LOKI = 29990, SUB_HI = 45591, SUB_MED = 45592, SUB_LOW = 45593;
const t3data = {
  types: {
    [LOKI]: { name: 'Loki', groupID: 963, categoryID: 6 },
    [SUB_HI]: { name: 'Loki Offensive - Turret', groupID: 970, categoryID: 32 },
    [SUB_MED]: { name: 'Loki Defensive - Shield', groupID: 971, categoryID: 32 },
    [SUB_LOW]: { name: 'Loki Engineering - Power', groupID: 972, categoryID: 32 },
    [RIFTER]: { name: 'Rifter', groupID: 25, categoryID: 6 },
  },
  typeDogma: {
    // a real Loki: 0 / 0 / 0 base, 5 rigs, 4 subsystems
    [LOKI]: { dogmaAttributes: [
      { attributeID: 14, value: 0 }, { attributeID: 13, value: 0 }, { attributeID: 12, value: 0 },
      { attributeID: 1137, value: 3 }, { attributeID: 1367, value: 4 },
    ], dogmaEffects: [] },
    [SUB_HI]:  { dogmaAttributes: [{ attributeID: 1374, value: 4 }, { attributeID: 1375, value: 1 }], dogmaEffects: [] },
    [SUB_MED]: { dogmaAttributes: [{ attributeID: 1375, value: 3 }], dogmaEffects: [] },
    [SUB_LOW]: { dogmaAttributes: [{ attributeID: 1376, value: 3 }, { attributeID: 1375, value: 1 }], dogmaEffects: [] },
    // a normal hull, to prove nothing regressed
    [RIFTER]: { dogmaAttributes: [
      { attributeID: 14, value: 4 }, { attributeID: 13, value: 3 }, { attributeID: 12, value: 3 },
      { attributeID: 1137, value: 3 }, { attributeID: 1367, value: 0 },
    ], dogmaEffects: [] },
  },
};
const slot = (typeId) => ({ typeId });

// THE BUG: reading the hull alone gives a Loki an empty fitting window
eq('a bare Loki genuinely has no slots yet',
  rackSizes(LOKI, t3data), { high: 0, med: 0, low: 0, rig: 3, sub: 4 });

eq('one turret subsystem gives it 4 high and 1 mid',
  rackSizes(LOKI, t3data, [slot(SUB_HI)]), { high: 4, med: 1, low: 0, rig: 3, sub: 4 });

eq('a full subsystem set adds up across all three racks',
  rackSizes(LOKI, t3data, [slot(SUB_HI), slot(SUB_MED), slot(SUB_LOW)]),
  { high: 4, med: 5, low: 3, rig: 3, sub: 4 });

eq('empty subsystem sockets contribute nothing',
  rackSizes(LOKI, t3data, [slot(SUB_HI), { typeId: null }, { typeId: null }]),
  { high: 4, med: 1, low: 0, rig: 3, sub: 4 });

// rigs and subsystem count stay hull-only — a subsystem cannot grant rig slots
eq('rig slots stay hull-only', rackSizes(LOKI, t3data, [slot(SUB_HI), slot(SUB_MED)]).rig, 3);
eq('subsystem slots stay hull-only', rackSizes(LOKI, t3data, [slot(SUB_HI)]).sub, 4);

// a normal ship is completely unaffected by the change
eq('a Rifter is unchanged with no subsystems',
  rackSizes(RIFTER, t3data), { high: 4, med: 3, low: 3, rig: 3, sub: 0 });
eq('...and unchanged when passed an empty sub rack',
  rackSizes(RIFTER, t3data, []), { high: 4, med: 3, low: 3, rig: 3, sub: 0 });

// ---- the layout must RESIZE per variation, not globally ------------------
const sizesFor = (v) => rackSizes(LOKI, t3data, v.sub);
const fit = {
  id: 'f1', name: 'Loki', hullId: LOKI,
  variations: [
    { ...emptyVariation('turret', rackSizes(LOKI, t3data, [slot(SUB_HI)])), sub: [slot(SUB_HI), { typeId: null }, { typeId: null }, { typeId: null }] },
    { ...emptyVariation('shield', rackSizes(LOKI, t3data, [slot(SUB_MED)])), sub: [slot(SUB_MED), { typeId: null }, { typeId: null }, { typeId: null }] },
  ],
};
const norm = normalizeFitLayout(fit, sizesFor);
eq('variation A gets ITS subsystem\'s 4 high slots', norm.fit.variations[0].high.length, 4);
eq('variation B, with a different subsystem, gets 0 high', norm.fit.variations[1].high.length, 0);
eq('...and 3 mids of its own', norm.fit.variations[1].med.length, 3);
eq('one shared size map would have flattened them — it does not',
  norm.fit.variations[0].high.length !== norm.fit.variations[1].high.length, true);

// a module in a slot that disappears is moved to cargo and REPORTED
const shrink = {
  id: 'f2', name: 'Loki', hullId: LOKI,
  variations: [{
    ...emptyVariation('v', { high: 4, med: 1, low: 0, rig: 3, sub: 4 }),
    high: [slot(999), { typeId: null }, { typeId: null }, { typeId: null }],
    sub: [{ typeId: null }, { typeId: null }, { typeId: null }, { typeId: null }], // subsystem removed
  }],
};
const shrunk = normalizeFitLayout(shrink, sizesFor);
eq('removing the subsystem removes the high slots', shrunk.fit.variations[0].high.length, 0);
eq('...and the module in them is moved to cargo, not lost',
  shrunk.fit.variations[0].cargo.some((c) => c.typeId === 999), true);
eq('...and reported to the user', shrunk.movedToCargo.length, 1);



// ---------------------------------------------------------------------------
// C. THE TWO ENGINE-FIT BUILDERS MUST AGREE
//
// The drone caps were first written into toEsfFit only. The Fit Wizard builds
// its engine fit somewhere else entirely (variationEsfFitFull), so it kept the
// old "up to 25, all Active" behaviour: the SAME fit scored one way in the Fit
// Library and another in the wizard, and the wizard's was the inflated one.
// A rule that decides money must have exactly one implementation.
// ---------------------------------------------------------------------------
const { variationEsfFitFull } = require('./r3/wizardFits.js');

const wizFit = { id: 'w', name: 'Vexor', hullId: VEXOR, variations: [] };
const wizVar = (drones) => ({
  id: 'v', name: 'v', high: [], med: [], low: [], rig: [], sub: [],
  drones, cargo: [],
});

for (const [label, bay] of [
  ['10 light drones', [{ typeId: HOBGOBLIN, qty: 10 }]],
  ['5 heavy drones (bandwidth-bound)', [{ typeId: OGRE, qty: 5 }]],
  ['a mixed bay', [{ typeId: HOBGOBLIN, qty: 4 }, { typeId: OGRE, qty: 4 }]],
  ['exactly 5 lights', [{ typeId: HOBGOBLIN, qty: 5 }]],
]) {
  const viaLibrary = toEsfFit(
    fitWith(bay.map((b) => drone(b.typeId, data.types[b.typeId].name, b.qty))), data);
  const viaWizard = variationEsfFitFull(wizFit, wizVar(bay), data);
  eq(`wizard and library agree on drones in space — ${label}`,
    viaWizard.esfFit.drones.length, viaLibrary.esfFit.drones.length);
  eq(`...and on how many are benched — ${label}`,
    viaWizard.benchedDrones.length, viaLibrary.benchedDrones.length);
}

// the specific case the audit named: a Vexor with 5 mediums flies 3
const vexor5med = variationEsfFitFull(wizFit, wizVar([{ typeId: OGRE, qty: 5 }]), data);
eq('a Vexor with 5 heavy drones flies exactly 3 in the WIZARD too',
  vexor5med.esfFit.drones.length, 3);
eq('...and the wizard now names the 2 it benched', vexor5med.benchedDrones.length, 1);

console.log(`${pass} passed, ${fail} failed (incl. cross-surface agreement)`);
process.exit(fail ? 1 : 0);
