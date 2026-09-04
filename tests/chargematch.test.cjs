// FIXTURES FOR pairCharges() — recovering the module<->charge link that ESI
// throws away. Run against the SHIPPED compiled code.
//
// The bar: place a charge ONLY when the answer is forced, and when it is not,
// refuse out loud. A guessed loadout is worse than an admitted gap.
const { pairCharges } = require('./sim/lib/chargeMatch.js');
const { canLoad } = require('./sim/lib/fitCharges.js');
const { toEft } = require('./sim/lib/fitSerial.js');
const { parseFit } = require('./sim/lib/skillRelevance.js');
const { toEsfFit } = require('./sim/lib/dogmaFit.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n      got=${JSON.stringify(got)}\n     want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// ---- a controlled catalog -------------------------------------------------
// chargeGroup attrs are 604/605/606/609/610; 128 is chargeSize.
const CRUISE = 19739, CRUISE_AMMO = 24533, NOVA_CRUISE = 24537;
const BCS = 22291;                      // no charge groups at all
const RAIL_S = 568, RAIL_M = 569;       // same charge GROUP, different SIZE
const AMMO_S = 1000, AMMO_M = 1001;
const AUTOCANNON = 484, PROJ_AMMO = 1002;
const GRP_CRUISE = 385, GRP_HYBRID = 83, GRP_PROJ = 83;

const D = (attrs) => ({ dogmaAttributes: attrs.map(([attributeID, value]) => ({ attributeID, value })) });
const data = {
  types: {
    [CRUISE]: { name: 'Cruise Missile Launcher II', groupID: 510, published: true },
    [CRUISE_AMMO]: { name: 'Scourge Fury Cruise Missile', groupID: GRP_CRUISE, published: true },
    [NOVA_CRUISE]: { name: 'Nova Fury Cruise Missile', groupID: GRP_CRUISE, published: true },
    [BCS]: { name: 'Ballistic Control System II', groupID: 367, published: true },
    [RAIL_S]: { name: '150mm Railgun II', groupID: 74, published: true },
    [RAIL_M]: { name: '250mm Railgun II', groupID: 74, published: true },
    [AMMO_S]: { name: 'Antimatter Charge S', groupID: GRP_HYBRID, published: true },
    [AMMO_M]: { name: 'Antimatter Charge M', groupID: GRP_HYBRID, published: true },
    [AUTOCANNON]: { name: '425mm AutoCannon II', groupID: 55, published: true },
    [PROJ_AMMO]: { name: 'Republic Fleet EMP L', groupID: GRP_PROJ, published: true },
  },
  typeDogma: {
    [CRUISE]: D([[604, GRP_CRUISE]]),
    [CRUISE_AMMO]: D([]),
    [NOVA_CRUISE]: D([]),
    [BCS]: D([]),
    // both railguns take hybrid charges; SIZE is what separates them
    [RAIL_S]: D([[604, GRP_HYBRID], [128, 1]]),
    [RAIL_M]: D([[604, GRP_HYBRID], [128, 2]]),
    [AMMO_S]: D([[128, 1]]),
    [AMMO_M]: D([[128, 2]]),
    [AUTOCANNON]: D([[604, GRP_PROJ], [128, 3]]),
    [PROJ_AMMO]: D([[128, 3]]),
  },
};

const hi = (typeId, n, extra = {}) =>
  Array.from({ length: n }, (_, i) => ({ type_id: typeId, quantity: 1, flag: `HiSlot${i}`, ...extra }));

// ---------------------------------------------------------------------------
// 1. THE FORCED CASE — six launchers, one ammo row. Nothing else can take it.
// ---------------------------------------------------------------------------
{
  const items = [...hi(CRUISE, 6), { type_id: BCS, quantity: 2, flag: 'LoSlot0' },
    { type_id: CRUISE_AMMO, quantity: 6, flag: 'Cargo' }];
  const r = pairCharges(items, data);
  eq('1a all six launchers end up loaded',
    r.items.filter((i) => i.type_id === CRUISE && i.chargeTypeId === CRUISE_AMMO).length, 6);
  eq('1b the ammo row is gone from cargo (it is IN the guns now)',
    r.items.filter((i) => i.type_id === CRUISE_AMMO).length, 0);
  eq('1c the inference is reported', r.inferred,
    [{ moduleTypeId: CRUISE, chargeTypeId: CRUISE_AMMO, count: 6 }]);
  eq('1d nothing was ambiguous', r.ambiguous, []);
  eq('1e the BCS is untouched', r.items.find((i) => i.type_id === BCS).chargeTypeId, undefined);
}

// ---------------------------------------------------------------------------
// 2. SPARES — 100 rounds for 6 guns: load 6, the other 94 stay cargo.
// ---------------------------------------------------------------------------
{
  const items = [...hi(CRUISE, 6), { type_id: CRUISE_AMMO, quantity: 100, flag: 'Cargo' }];
  const r = pairCharges(items, data);
  eq('2a six loaded', r.items.filter((i) => i.chargeTypeId === CRUISE_AMMO).length, 6);
  eq('2b ninety-four left in cargo',
    r.items.find((i) => i.type_id === CRUISE_AMMO && i.chargeTypeId === undefined).quantity, 94);
}

// ---------------------------------------------------------------------------
// 3. NOT ENOUGH — 4 rounds for 6 guns. Four load; two stay honestly empty.
// ---------------------------------------------------------------------------
{
  const items = [...hi(CRUISE, 6), { type_id: CRUISE_AMMO, quantity: 4, flag: 'Cargo' }];
  const r = pairCharges(items, data);
  eq('3a four loaded', r.items.filter((i) => i.chargeTypeId === CRUISE_AMMO).length, 4);
  eq('3b two left unloaded',
    r.items.filter((i) => i.type_id === CRUISE && i.chargeTypeId === undefined).length, 2);
  eq('3c no ammo left over', r.items.filter((i) => i.type_id === CRUISE_AMMO).length, 0);
}

// ---------------------------------------------------------------------------
// 4. TWO AMMO TYPES, ONE RACK — the fit does not say which was loaded.
//    THIS MUST REFUSE. Guessing Scourge over Nova would be inventing a
//    damage type, and damage type is the whole point of the graph.
// ---------------------------------------------------------------------------
{
  const items = [...hi(CRUISE, 6),
    { type_id: CRUISE_AMMO, quantity: 6, flag: 'Cargo' },
    { type_id: NOVA_CRUISE, quantity: 6, flag: 'Cargo' }];
  const r = pairCharges(items, data);
  eq('4a nothing was loaded', r.items.filter((i) => i.chargeTypeId !== undefined).length, 0);
  eq('4b both ammo types are reported ambiguous', r.ambiguous.length, 2);
  eq('4c and the reason names the competition',
    /compete/.test(r.ambiguous[0].reason), true);
  eq('4d both ammo rows survive untouched',
    r.items.filter((i) => i.type_id === CRUISE_AMMO || i.type_id === NOVA_CRUISE).length, 2);
}

// ---------------------------------------------------------------------------
// 5. CHARGE SIZE — the trap. Small and medium railguns share a charge GROUP.
//    Size must keep S ammo out of the M gun.
// ---------------------------------------------------------------------------
{
  eq('5a S ammo loads the S gun', canLoad(data, RAIL_S, AMMO_S), true);
  eq('5b S ammo does NOT load the M gun', canLoad(data, RAIL_M, AMMO_S), false);
  eq('5c M ammo does NOT load the S gun', canLoad(data, RAIL_S, AMMO_M), false);
  const items = [...hi(RAIL_M, 4), { type_id: AMMO_M, quantity: 4, flag: 'Cargo' },
    { type_id: AMMO_S, quantity: 50, flag: 'Cargo' }];
  const r = pairCharges(items, data);
  eq('5d only the size-matched ammo is loaded',
    r.items.filter((i) => i.chargeTypeId === AMMO_M).length, 4);
  eq('5e the wrong-size ammo is not ambiguous, it simply does not fit', r.ambiguous, []);
  eq('5f and it stays in cargo at full quantity',
    r.items.find((i) => i.type_id === AMMO_S).quantity, 50);
}

// ---------------------------------------------------------------------------
// 6. ASSETS SHAPE — a charge filed under its module's OWN slot flag, which is
//    how an assembled ship comes back. It must not be mistaken for a module.
// ---------------------------------------------------------------------------
{
  const items = [...hi(CRUISE, 6), { type_id: CRUISE_AMMO, quantity: 6, flag: 'HiSlot0' }];
  const r = pairCharges(items, data);
  eq('6a still loads all six', r.items.filter((i) => i.chargeTypeId === CRUISE_AMMO).length, 6);
  eq('6b and the stray slot row is consumed',
    r.items.filter((i) => i.type_id === CRUISE_AMMO && i.chargeTypeId === undefined).length, 0);
}

// ---------------------------------------------------------------------------
// 7. A KNOWN PAIRING IS NEVER OVERWRITTEN — the Fit Wizard already knows.
// ---------------------------------------------------------------------------
{
  const items = [...hi(CRUISE, 6, { chargeTypeId: NOVA_CRUISE }),
    { type_id: CRUISE_AMMO, quantity: 6, flag: 'Cargo' }];
  const r = pairCharges(items, data);
  eq('7a the declared Nova load survives',
    r.items.filter((i) => i.chargeTypeId === NOVA_CRUISE).length, 6);
  eq('7b nothing got re-pointed at the cargo ammo',
    r.items.filter((i) => i.chargeTypeId === CRUISE_AMMO).length, 0);
}

// ---------------------------------------------------------------------------
// 8. NO WEAPONS AT ALL — an industrial full of ore must come back untouched.
// ---------------------------------------------------------------------------
{
  const items = [{ type_id: BCS, quantity: 1, flag: 'LoSlot0' },
    { type_id: CRUISE_AMMO, quantity: 500, flag: 'Cargo' }];
  const r = pairCharges(items, data);
  eq('8a identical item list back', r.items, items);
  eq('8b nothing inferred', r.inferred, []);
  eq('8c nothing ambiguous', r.ambiguous, []);
}

// ---------------------------------------------------------------------------
// 9. END TO END — the whole reason this exists. ESI items through the real
//    pipeline, and the launchers arrive at the engine LOADED.
// ---------------------------------------------------------------------------
{
  const esf = {
    types: {
      638: { name: 'Raven', groupID: 27, categoryID: 6 },
      [CRUISE]: { name: 'Cruise Missile Launcher II', groupID: 510, categoryID: 7 },
      [CRUISE_AMMO]: { name: 'Scourge Fury Cruise Missile', groupID: GRP_CRUISE, categoryID: 8 },
    },
    typeDogma: {
      638: { dogmaAttributes: [], dogmaEffects: [] },
      [CRUISE]: { dogmaAttributes: [], dogmaEffects: [{ effectID: 12, isDefault: true }] },
      [CRUISE_AMMO]: { dogmaAttributes: [], dogmaEffects: [] },
    },
  };
  const esiItems = [...hi(CRUISE, 6), { type_id: CRUISE_AMMO, quantity: 6, flag: 'Cargo' }];

  const before = toEsfFit(parseFit(toEft('Raven', 'x', esiItems)), esf);
  eq('9a BEFORE: zero launchers reach the engine loaded',
    before.esfFit.modules.filter((m) => m.charge).length, 0);

  const after = toEsfFit(parseFit(toEft('Raven', 'x', pairCharges(esiItems, data).items)), esf);
  eq('9b AFTER: all six reach the engine loaded',
    after.esfFit.modules.filter((m) => m.charge && m.charge.type_id === CRUISE_AMMO).length, 6);
  eq('9c AFTER: the ammo is no longer double-reported as cargo', after.nonFit, []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
