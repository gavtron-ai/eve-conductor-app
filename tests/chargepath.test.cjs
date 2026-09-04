// DOES A CHARGE SURVIVE THE TRIP FROM ESI INTO THE DOGMA ENGINE?
//
// The Fit Library reads every character's SAVED IN-GAME FITTINGS from ESI and
// renders them through:
//     ESI items -> toEft() -> parseFit() -> toEsfFit() -> engine -> summarize()
// (FitInspector.tsx:24 is literally `parseFit(toEft(...))`.)
//
// ESI stores a fitting's ammo under the Cargo flag, so nothing in that chain
// knows WHICH launcher the ammo belongs to. fitSerial.toEft only emits the
// inline "Module, Charge" form when the caller supplies chargeTypeId — and the
// only caller that does is the Fit Wizard.
//
// This measures what that costs. Run against the SHIPPED compiled code.
const { toEft } = require('./sim/lib/fitSerial.js');
const { parseFit } = require('./sim/lib/skillRelevance.js');
const { toEsfFit } = require('./sim/lib/dogmaFit.js');
const { summarize } = require('./sim/lib/fitSummary.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n      got=${JSON.stringify(got)}\n     want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// ids resolved from the SHIPPED typedb, not from memory
const RAVEN = 638, LAUNCHER = 19739, AMMO = 24533, BCS = 22291;

// minimal dogma shapes: effect 12 = hiPower, 11 = loPower
const data = {
  types: {
    [RAVEN]: { name: 'Raven', groupID: 27, categoryID: 6 },
    [LAUNCHER]: { name: 'Cruise Missile Launcher II', groupID: 510, categoryID: 7 },
    [AMMO]: { name: 'Scourge Fury Cruise Missile', groupID: 385, categoryID: 8 },
    [BCS]: { name: 'Ballistic Control System II', groupID: 367, categoryID: 7 },
  },
  typeDogma: {
    [RAVEN]: { dogmaAttributes: [], dogmaEffects: [] },
    [LAUNCHER]: { dogmaAttributes: [], dogmaEffects: [{ effectID: 12, isDefault: true }] },
    [AMMO]: { dogmaAttributes: [], dogmaEffects: [] },
    [BCS]: { dogmaAttributes: [], dogmaEffects: [{ effectID: 11, isDefault: true }] },
  },
};

// ---------------------------------------------------------------------------
// A. THE ESI PATH — exactly the item list CCP returns for a saved fitting:
//    six launchers in HiSlot0..5, and the ammo as ONE Cargo row of six.
// ---------------------------------------------------------------------------
const esiItems = [
  ...Array.from({ length: 6 }, (_, i) => ({ type_id: LAUNCHER, quantity: 1, flag: `HiSlot${i}` })),
  { type_id: BCS, quantity: 2, flag: 'LoSlot0' },
  { type_id: AMMO, quantity: 6, flag: 'Cargo' },
];

const esiEft = toEft('Raven', 'Missile Boat', esiItems);
console.log('--- EFT produced from the ESI fitting ---');
console.log(esiEft.split('\n').map((l) => '    ' + l).join('\n'));

const esiFit = parseFit(esiEft);
const esiLauncher = esiFit.items.find((i) => i.typeId === LAUNCHER);

eq('A1 ESI: hull resolves', esiFit.shipId, RAVEN);
eq('A2 ESI: six launchers present', esiLauncher.qty, 6);
eq('A3 ESI: launcher carries NO charges', esiLauncher.charges, []);
eq('A4 ESI: nothing failed to resolve', esiFit.unresolved, []);

const esiEsf = toEsfFit(esiFit, data);
const esiLoaded = esiEsf.esfFit.modules.filter((m) => m.type_id === LAUNCHER && m.charge);
eq('A5 ESI: launchers handed to the engine LOADED', esiLoaded.length, 0);
eq('A6 ESI: the ammo is reported as not-part-of-the-fit', esiEsf.nonFit, ['Scourge Fury Cruise Missile']);

// ---------------------------------------------------------------------------
// B. WHAT THAT COSTS — summarize() on an engine result shaped like the one the
//    engine returns for those unloaded launchers. A launcher has no damage
//    attributes of its own (114/116/117/118 live on the MISSILE), so with no
//    charge attached there is nothing to sum.
// ---------------------------------------------------------------------------
const attrs = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), { value: v }]));
// 51 = cycle speed (ms), 64 = damage multiplier, 114/116/117/118 = damage by type
const launcherAttrs = attrs({ 51: 12000, 64: 1 });
const ammoAttrs = attrs({ 117: 396, 37: 4500, 281: 12000 }); // kinetic 396, vel, flight time

const hull = { attributes: attrs({ 263: 7000, 265: 6000, 9: 6000, 37: 130, 4: 99300000, 70: 0.1 }) };

const unloadedResult = {
  hull,
  items: Array.from({ length: 6 }, () => ({
    type_id: LAUNCHER, state: 'Active', slot: { type: 'High' }, attributes: launcherAttrs, charge: null,
  })),
};
const loadedResult = {
  hull,
  items: Array.from({ length: 6 }, () => ({
    type_id: LAUNCHER, state: 'Active', slot: { type: 'High' }, attributes: launcherAttrs,
    charge: { type_id: AMMO, attributes: ammoAttrs },
  })),
};

const unloaded = summarize(unloadedResult);
const loaded = summarize(loadedResult);

eq('B1 unloaded launchers produce ZERO dps', unloaded.dps, 0);
eq('B2 unloaded launchers produce ZERO volley', unloaded.volley, 0);
eq('B3 unloaded launchers do not even appear in the weapon list', unloaded.weapons.length, 0);
// 396 kinetic x 1 multiplier x 6 launchers / 12 s cycle = 198 dps
eq('B4 loaded, the same fit is worth this much dps', Math.round(loaded.dps), 198);
eq('B5 loaded, the weapons appear', loaded.weapons.length, 6);
eq('B6 loaded, missile reach is derived (4500 m/s x 12 s)', loaded.weapons[0].missileRange, 54000);
console.log(`    -> the ESI path loses ${Math.round(loaded.dps)} of ${Math.round(loaded.dps)} dps on this fit (100%)`);

// ---------------------------------------------------------------------------
// C. CONTROL — the Fit Wizard path, where the pairing IS known. Same helpers,
//    same parser. If this passes, the defect is isolated to the ESI source.
// ---------------------------------------------------------------------------
const wizardItems = [
  ...Array.from({ length: 6 }, (_, i) => ({
    type_id: LAUNCHER, quantity: 1, flag: `HiSlot${i}`, chargeTypeId: AMMO,
  })),
  { type_id: BCS, quantity: 2, flag: 'LoSlot0' },
];
const wizFit = parseFit(toEft('Raven', 'Missile Boat', wizardItems));
const wizLauncher = wizFit.items.find((i) => i.typeId === LAUNCHER);
eq('C1 wizard: each of the six copies carries its charge', wizLauncher.charges, [AMMO, AMMO, AMMO, AMMO, AMMO, AMMO]);
const wizEsf = toEsfFit(wizFit, data);
eq('C2 wizard: all six reach the engine LOADED',
  wizEsf.esfFit.modules.filter((m) => m.type_id === LAUNCHER && m.charge).length, 6);
// SEPARATE, SMALLER DEFECT, now fixed: parseFit adds the charge as its own
// FitItem as well as pairing it (skillRelevance needs the item so Missile
// Bombardment counts as relevant). toEsfFit had no way to tell that item from
// real cargo, so LOADED ammo was announced as "not part of the flown fit"
// while being simulated. Only a genuine surplus counts as cargo now.
eq('C3 wizard: loaded ammo is no longer announced as cargo', wizEsf.nonFit, []);

// ...and a real surplus still is. 6 loaded + 20 spare = the ammo IS cargo too.
const spareItems = [
  ...Array.from({ length: 6 }, (_, i) => ({
    type_id: LAUNCHER, quantity: 1, flag: `HiSlot${i}`, chargeTypeId: AMMO,
  })),
  { type_id: AMMO, quantity: 20, flag: 'Cargo' },
];
const spareEsf = toEsfFit(parseFit(toEft('Raven', 'Missile Boat', spareItems)), data);
eq('C4 wizard: a genuine spare stack is still reported as cargo',
  spareEsf.nonFit, ['Scourge Fury Cruise Missile']);
eq('C5 wizard: and the guns are still loaded',
  spareEsf.esfFit.modules.filter((m) => m.charge).length, 6);

// ---------------------------------------------------------------------------
// D. IS THE PAIRING RECOVERABLE? The ammo is unambiguous here: exactly one
//    fitted module group can load Scourge Fury Cruise Missile. Prove the
//    matching problem is well-posed before writing a solver for it.
// ---------------------------------------------------------------------------
const { compatibleCharges, takesCharges } = require('./sim/lib/fitCharges.js');
const chargeData = {
  types: {
    [LAUNCHER]: { name: 'Cruise Missile Launcher II', groupID: 510, published: true },
    [AMMO]: { name: 'Scourge Fury Cruise Missile', groupID: 385, published: true },
    [BCS]: { name: 'Ballistic Control System II', groupID: 367, published: true },
  },
  typeDogma: {
    // 604 = chargeGroup1 -> group 385 (Advanced Cruise Missile)
    [LAUNCHER]: { dogmaAttributes: [{ attributeID: 604, value: 385 }] },
    [AMMO]: { dogmaAttributes: [] },
    [BCS]: { dogmaAttributes: [] },
  },
};
eq('D1 the launcher declares it takes charges', takesCharges(chargeData, LAUNCHER), true);
eq('D2 the BCS does not', takesCharges(chargeData, BCS), false);
eq('D3 the ammo is a legal load for the launcher',
  compatibleCharges(chargeData, LAUNCHER).includes(AMMO), true);
const canTake = [LAUNCHER, BCS].filter((m) => compatibleCharges(chargeData, m).includes(AMMO));
eq('D4 exactly ONE fitted module can take it -> the assignment is forced', canTake, [LAUNCHER]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
