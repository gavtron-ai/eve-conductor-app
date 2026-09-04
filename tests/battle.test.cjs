// PILOT PROFILES and LAYER-BY-LAYER TIME TO KILL. Shipped compiled code.
const P = require('./sim/lib/pilotProfiles.js');
const S = require('./sim/lib/fitSim.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};
const close = (l, g, w, tol = 1e-6) => {
  const ok = Math.abs(g - w) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `   got=${g} want=${w}`}`);
  ok ? pass++ : fail++;
};

// ids: hull needs Minmatar Frigate 3; that needs Spaceship Command 1.
// The gun needs Small Projectile Turret 3 AND Gunnery 2.
const HULL = 587, MINFRIG = 3329, SPACESHIP = 3327, GUN = 484, SPT = 3311, GUNNERY = 3300;
const SELFLOOP = 99999;
const D = (a) => ({ dogmaAttributes: a.map(([attributeID, value]) => ({ attributeID, value })) });
const data = {
  types: {
    [HULL]: { name: 'Rifter' }, [MINFRIG]: { name: 'Minmatar Frigate' },
    [SPACESHIP]: { name: 'Spaceship Command' }, [GUN]: { name: '200mm AutoCannon II' },
    [SPT]: { name: 'Small Projectile Turret' }, [GUNNERY]: { name: 'Gunnery' },
    [SELFLOOP]: { name: 'Polaris' },
  },
  typeDogma: {
    // 182/277 = requiredSkill1 + level
    [HULL]: D([[182, MINFRIG], [277, 3]]),
    [MINFRIG]: D([[182, SPACESHIP], [277, 1]]),
    [SPACESHIP]: D([]),
    [GUN]: D([[182, SPT], [277, 3], [183, GUNNERY], [278, 2]]),
    [SPT]: D([[182, GUNNERY], [277, 1]]),
    [GUNNERY]: D([]),
    // THE HANG: a skill listing ITSELF as its own prerequisite. Two of these
    // exist in the shipped bundle (Polaris, Omnipotent), both GM-only.
    [SELFLOOP]: D([[182, SELFLOOP], [277, 5]]),
  },
};
const fit = {
  shipId: HULL, shipName: 'Rifter', fitName: '', unresolved: [], extraFits: 0,
  items: [{ typeId: GUN, name: '200mm AutoCannon II', qty: 3, charges: [], offlineQty: 0 }],
};

// ---------------------------------------------------------------------------
// 1. THE RECURSIVE CLOSURE
// ---------------------------------------------------------------------------
{
  const m = P.minimumProfile(fit, data);
  const lvl = (id) => m.skills[id];
  eq('1a the hull requirement is taken directly', lvl(MINFRIG), 3);
  eq('1b its OWN prerequisite is pulled in too', lvl(SPACESHIP), 1);
  eq('1c the module requirement', lvl(SPT), 3);
  eq('1d ...and the deeper one it implies', lvl(GUNNERY), 2);
  eq('1e nothing else is granted — an untouched skill stays 0', lvl(12345) ?? 0, 0);
  // FOUR distinct skills: Minmatar Frigate, Spaceship Command, Small
  // Projectile Turret, Gunnery. (The hull and the gun are types, not skills.)
  eq('1f four skills demanded in total', m.requirements.length, 4);
  eq('1g and each one says who asked for it',
    m.requirements.find((r) => r.skillId === SPACESHIP).because, 'Minmatar Frigate');
}
{
  // GUNNERY is demanded at 2 by the gun and at 1 by Small Projectile Turret.
  // The HIGHEST demand must win, whichever order the walk happens to reach.
  const m = P.minimumProfile(fit, data);
  eq('1h the highest demand wins when two requirers disagree', m.skills[GUNNERY], 2);
}

// ---------------------------------------------------------------------------
// 2. TERMINATION — a self-referencing skill must not hang the closure.
// ---------------------------------------------------------------------------
{
  const loopFit = {
    ...fit,
    items: [{ typeId: SELFLOOP, name: 'Polaris', qty: 1, charges: [], offlineQty: 0 }],
  };
  const m = P.minimumProfile(loopFit, data);   // hangs forever if unguarded
  eq('2a a self-requiring skill terminates', m.skills[SELFLOOP], 5);
  eq('2b and appears exactly once', m.requirements.filter((r) => r.skillId === SELFLOOP).length, 1);
}

// ---------------------------------------------------------------------------
// 3. PADDING — an ABSENT skill key means level 1 to the SDE, not 0.
// ---------------------------------------------------------------------------
{
  const m = P.minimumProfile(fit, data);
  const zeros = Object.values(m.skills).filter((v) => v === 0).length;
  eq('3a every known skill is present in the map, not just the demanded ones',
    Object.keys(m.skills).length > 400, true);
  eq('3b and the undemanded ones are explicitly 0', zeros > 400, true);
  const opt = P.optimalSkills();
  eq('3c optimal sets every skill to 5',
    Object.values(opt).every((v) => v === 5), true);
  eq('3d over the same domain', Object.keys(opt).length, Object.keys(m.skills).length);
}

// ---------------------------------------------------------------------------
// 4. CAN THIS PILOT FLY IT? The engine never refuses, so we must.
// ---------------------------------------------------------------------------
{
  eq('4a a pilot with nothing cannot fly it', P.canFly(fit, data, {}).ok, false);
  eq('4b ...and is told exactly what is missing',
    P.canFly(fit, data, {}).missing.length, 4);
  const min = P.minimumProfile(fit, data).skills;
  eq('4c the minimum profile CAN fly it, by construction', P.canFly(fit, data, min).ok, true);
  eq('4d all-V can fly it', P.canFly(fit, data, P.optimalSkills()).ok, true);
  // one level short on one skill is still a no
  const short = { ...min, [MINFRIG]: 2 };
  eq('4e one level short is still unflyable', P.canFly(fit, data, short).ok, false);
  eq('4f and it names the one', P.canFly(fit, data, short).missing[0].name, 'Minmatar Frigate');
}

// ---------------------------------------------------------------------------
// 5. UNRESOLVED TYPES — a type the bundle does not know REQUIRES NOTHING,
//    which would silently under-state the entry bar. It must be reported.
// ---------------------------------------------------------------------------
{
  const odd = {
    ...fit,
    items: [...fit.items, { typeId: 777777, name: 'Mystery Module', qty: 1, charges: [], offlineQty: 0 }],
  };
  const m = P.minimumProfile(odd, data);
  eq('5a the unknown type is reported', m.unresolved, ['Mystery Module']);
  eq('5b the known requirements still resolve', m.skills[MINFRIG], 3);
}

// ---------------------------------------------------------------------------
// 6. LAYER-BY-LAYER TTK. A blended resonance is wrong when the layers differ.
// ---------------------------------------------------------------------------
{
  const target = { name: 't', signatureRadius: 100000, velocity: 0, resonance: S.NO_RESISTS };
  // 100 pure EM per second
  const w = [{
    typeId: 1, kind: 'untracked', cycleSeconds: 1,
    volley: { em: 100, thermal: 0, kinetic: 0, explosive: 0 },
  }];
  // shield is TRANSPARENT to EM (resonance 1.0), armor blocks 90% of it
  const layers = [
    { name: 'Shield', hp: 1000, resonance: { em: 1, thermal: 1, kinetic: 1, explosive: 1 } },
    { name: 'Armor', hp: 1000, resonance: { em: 0.1, thermal: 1, kinetic: 1, explosive: 1 } },
    { name: 'Hull', hp: 500, resonance: { em: 0.5, thermal: 1, kinetic: 1, explosive: 1 } },
  ];
  const r = S.timeToKill(w, target, { distance: 0, transversal: 0 }, layers, false);
  close('6a shield: 1000 hp at 100 dps', r.perLayer[0].seconds, 10);
  close('6b armor: 90% resisted, so 10 dps -> 100 s', r.perLayer[1].seconds, 100);
  close('6c hull: 50% resisted, 500 hp at 50 dps', r.perLayer[2].seconds, 10);
  close('6d total is the SUM of the layers', r.seconds, 120);
  // the blended-average answer would be badly wrong
  const avg = (1 + 0.1 + 0.5) / 3;
  const blended = (1000 + 1000 + 500) / (100 * avg);
  eq('6e a single blended resonance would understate this fight', blended < r.seconds, true);
}

// ---------------------------------------------------------------------------
// 7. TTK REFUSES when the target cannot actually be killed.
// ---------------------------------------------------------------------------
{
  const target = { name: 't', signatureRadius: 100000, velocity: 0, resonance: S.NO_RESISTS };
  const w = [{
    typeId: 1, kind: 'untracked', cycleSeconds: 1,
    volley: { em: 100, thermal: 0, kinetic: 0, explosive: 0 },
  }];
  // armour is IMMUNE to EM
  const layers = [
    { name: 'Shield', hp: 100, resonance: { em: 1, thermal: 1, kinetic: 1, explosive: 1 } },
    { name: 'Armor', hp: 1000, resonance: { em: 0, thermal: 1, kinetic: 1, explosive: 1 } },
  ];
  const r = S.timeToKill(w, target, { distance: 0, transversal: 0 }, layers, false);
  eq('7a an unkillable layer reports null, not Infinity', r.perLayer[1].seconds, null);
  eq('7b and the whole fight is "never"', r.seconds, null);
  close('7c the layer it CAN strip is still reported', r.perLayer[0].seconds, 1);
}

// ---------------------------------------------------------------------------
// 8. SUSTAINED vs ALPHA in TTK.
// ---------------------------------------------------------------------------
{
  const target = { name: 't', signatureRadius: 100000, velocity: 0, resonance: S.NO_RESISTS };
  const w = [{
    typeId: 1, kind: 'missile', cycleSeconds: 1, cycleSecondsWithReload: 2,
    volley: { em: 0, thermal: 0, kinetic: 100, explosive: 0 },
    expRadius: 1, expVelocity: 1000, drf: 1,
  }];
  const layers = [{ name: 'Shield', hp: 1000, resonance: S.NO_RESISTS }];
  const alpha = S.timeToKill(w, target, { distance: 0, transversal: 0 }, layers, false);
  const sust = S.timeToKill(w, target, { distance: 0, transversal: 0 }, layers, true);
  close('8a alpha kills it in 10 s', alpha.seconds, 10);
  close('8b counting the reload, 20 s', sust.seconds, 20);
}


// ---------------------------------------------------------------------------
// 9. GEOMETRY — transversal is DERIVED from what the ships are doing.
// ---------------------------------------------------------------------------
{
  const g = (ab, as, r, tb, ts) =>
    S.geometryOf({ behaviour: ab, speed: as, range: r }, { behaviour: tb, speed: ts }, 1000);

  eq('9a orbiting spends the whole speed across the line of sight',
    S.tangentialSpeed('orbit', 500), 500);
  eq('9b keeping at range spends none of it', S.tangentialSpeed('keepAtRange', 500), 0);
  eq('9c closing spends none of it either', S.tangentialSpeed('approach', 500), 0);
  eq('9d sitting still, obviously none', S.tangentialSpeed('stationary', 500), 0);

  // an orbiting attacker vs a stationary target: transversal is its own speed
  const a = g('orbit', 500, 10000, 'stationary', 0);
  eq('9e transversal is the orbiting ship\'s own speed', a.transversal, 500);
  close('9f angular velocity is transversal / range', a.angularVelocity, 0.05);
  eq('9g and the engagement distance is the chosen range', a.engagement.distance, 10000);

  // BOTH orbiting: the contributions ADD (counter-rotating, the hard case)
  const b = g('orbit', 500, 10000, 'orbit', 300);
  eq('9h two orbiting ships add their tangential speeds', b.transversal, 800);

  // an attacker that just closes has NO transversal, however fast it is
  const c = g('approach', 4000, 5000, 'stationary', 0);
  eq('9i a charging ship presents no transversal at all', c.transversal, 0);
  eq('9j ...so its angular velocity is zero', c.angularVelocity, 0);

  // the TARGET moving still creates a tracking problem for a still attacker
  const d = g('stationary', 0, 10000, 'orbit', 1200);
  eq('9k a stationary shooter still faces the target\'s own orbit', d.transversal, 1200);

  // MISSILES read the target's speed, which depends on what it is doing
  eq('9l a stationary target cannot outrun an explosion',
    g('orbit', 500, 10000, 'stationary', 900).targetSpeed, 0);
  eq('9m a moving one can', g('orbit', 500, 10000, 'keepAtRange', 900).targetSpeed, 900);
  eq('9n ...even while keeping at range, which is still moving',
    S.movingSpeed('keepAtRange', 900), 900);

  // closing to zero must not divide by zero
  const z = g('orbit', 500, 0, 'stationary', 0);
  eq('9o zero range gives zero angular rather than Infinity', z.angularVelocity, 0);
}

// ---------------------------------------------------------------------------
// 10. THE ZERO THAT LOOKED LIKE A BUG: an unloaded fit scores exactly 0, and
//     that must be distinguishable from "it missed".
// ---------------------------------------------------------------------------
{
  const at = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), { value: v }]));
  // an UNLOADED turret: tracking and cycle, but no charge and no own damage
  const empty = S.simWeapon({
    type_id: 1, state: 'Active', slot: { type: 'High' },
    attributes: at({ 51: 5000, 160: 10, 54: 10000, 158: 5000 }), charge: null,
  });
  eq('10a an unloaded turret is not a weapon at all', empty, null);
  const target = { name: 't', signatureRadius: 400, velocity: 0, resonance: S.NO_RESISTS };
  const r = S.appliedDps([], target, { distance: 1000, transversal: 0 });
  eq('10b so a fit with no ammo produces exactly zero', r.applied, 0);
  eq('10c ...and zero RAW too, which is how the UI tells it apart from a miss',
    r.raw, 0);
}


// ---------------------------------------------------------------------------
// 11. AMMO SELECTION — the shared transform both surfaces now use.
// ---------------------------------------------------------------------------
{
  const C = require('./sim/lib/fitCharges.js');
  const GUN2 = 484, AMMO_A = 1001, AMMO_B = 1002;
  const base = {
    shipId: 587, shipName: 'Rifter', fitName: '', unresolved: [], extraFits: 0,
    items: [
      { typeId: GUN2, name: 'gun', qty: 3, charges: [], offlineQty: 0 },
      { typeId: 999, name: 'other', qty: 1, charges: [], offlineQty: 0 },
    ],
  };
  const loaded = C.withAmmo(base, GUN2, AMMO_A);
  eq('11a every copy of the stack is loaded',
    loaded.items.find((i) => i.typeId === GUN2).charges, [AMMO_A, AMMO_A, AMMO_A]);
  eq('11b other modules are untouched',
    loaded.items.find((i) => i.typeId === 999).charges, []);
  eq('11c the original fit is not mutated',
    base.items.find((i) => i.typeId === GUN2).charges, []);
  eq('11d null unloads it again',
    C.withAmmo(loaded, GUN2, null).items.find((i) => i.typeId === GUN2).charges, []);

  const mapped = C.withAmmoMap(base, { [GUN2]: AMMO_B });
  eq('11e a whole map applies', mapped.items.find((i) => i.typeId === GUN2).charges,
    [AMMO_B, AMMO_B, AMMO_B]);
  eq('11f an empty map changes nothing',
    C.withAmmoMap(base, {}).items.find((i) => i.typeId === GUN2).charges, []);
  // a weapon not in the fit must not invent an item
  eq('11g a choice for a weapon that is not fitted is ignored',
    C.withAmmoMap(base, { 77777: AMMO_A }).items.length, 2);
}


// ---------------------------------------------------------------------------
// 12. A DRONE'S ORBIT IS ITS OWN STAT (attribute 154 proximityRange), not a
//     player setting. Verified in the bundle: Hobgoblin 1000, Hammerhead 2000,
//     Ogre 4000 — light / medium / heavy.
// ---------------------------------------------------------------------------
{
  const at = (o) => new Map(Object.entries(o).map(([k, v]) => [Number(k), { value: v }]));
  const drone = (proximity) => S.simWeapon({
    type_id: 1, state: 'Active', slot: { type: 'DroneBay' },
    attributes: at({ 51: 4000, 64: 1, 118: 100, 160: 1, 620: 400, 37: 1200, 154: proximity }),
    charge: null,
  });
  const light = drone(1000);
  const heavy = drone(4000);
  eq('12a the drone carries its own orbit radius', light.droneOrbit, 1000);
  eq('12b a heavy drone orbits further out', heavy.droneOrbit, 4000);

  const fast = { name: 'f', signatureRadius: 100, velocity: 1000, resonance: S.NO_RESISTS };
  // wider orbit = LOWER angular velocity = better tracking, all else equal
  const a = S.applicationOf(light, fast, { distance: 5000, transversal: 0 });
  const b = S.applicationOf(heavy, fast, { distance: 5000, transversal: 0 });
  eq('12c the wider orbit tracks better', b > a, true);

  // the engagement override must NOT beat the drone's own stat
  const withOverride = S.applicationOf(light, fast, { distance: 5000, transversal: 0, droneOrbit: 4000 });
  eq('12d the radius on the drone wins over any caller default', withOverride, a);

  // a drone with no published radius still works, via the fallback
  const bare = drone(undefined);
  eq('12e a drone with no radius published falls back rather than dividing by zero',
    Number.isFinite(S.applicationOf(bare, fast, { distance: 5000, transversal: 0 })), true);
}


// ---------------------------------------------------------------------------
// 13. EXPLICIT EMPTY vs NO CHOICE, and "is this even a weapon".
// ---------------------------------------------------------------------------
{
  const C = require('./sim/lib/fitCharges.js');
  const GUN3 = 484, AMMO_X = 1001;
  const base = {
    shipId: 587, shipName: 'Rifter', fitName: '', unresolved: [], extraFits: 0,
    items: [{ typeId: GUN3, name: 'gun', qty: 2, charges: [AMMO_X, AMMO_X], offlineQty: 0 }],
  };
  // null in the map is a REAL choice and must unload a fit that came loaded
  eq('13a an explicit null unloads a loaded weapon',
    C.withAmmoMap(base, { [GUN3]: null }).items[0].charges, []);
  // absence means "leave what the fit had"
  eq('13b absence from the map leaves it alone',
    C.withAmmoMap(base, {}).items[0].charges, [AMMO_X, AMMO_X]);

  // damage test: a probe or a command burst charge is not damage
  const D2 = (a) => ({ dogmaAttributes: a.map(([attributeID, value]) => ({ attributeID, value })) });
  const dd = {
    types: { 10: { name: 'EMP S', groupID: 1, published: true },
             11: { name: 'Core Scanner Probe', groupID: 2, published: true },
             12: { name: 'Shield Burst', groupID: 3, published: true } },
    typeDogma: {
      10: D2([[114, 9]]),          // em damage
      11: D2([[128, 1]]),          // a probe: size, no damage
      12: D2([[68, 5]]),           // a burst: a bonus, no damage
    },
  };
  eq('13c a real round deals damage', C.chargeDealsDamage(dd, 10), true);
  eq('13d a scanner probe does not', C.chargeDealsDamage(dd, 11), false);
  eq('13e nor does a command burst charge', C.chargeDealsDamage(dd, 12), false);
  eq('13f a zero-damage row still counts as no damage',
    C.chargeDealsDamage({ types: { 13: {} }, typeDogma: { 13: D2([[114, 0]]) } }, 13), false);
}


// ---------------------------------------------------------------------------
// 14. LOCAL REPAIR. Measured on the shipped engine: a Large Shield Booster II
//     reports -49 = 69.0 hp/s (276 HP over a 4.0 s cycle) and the capacitor
//     runs dry at a measured 52 s. Reps must run to that deadline, not forever.
// ---------------------------------------------------------------------------
{
  // 1000 hp, 100 dps incoming, 40 hp/s repaired, cap stable
  eq('14a repair slows a layer: 1000 / (100-40)', S.layerSeconds(1000, 100, 40, null, 0), 1000 / 60);
  // repair OUTPACES damage and the cap never gives out -> it never falls
  eq('14b a layer that out-reps the damage never falls', S.layerSeconds(1000, 40, 100, null, 0), null);
  // same, but the capacitor dies at 30 s -> it survives 30 s then takes it raw
  eq('14c ...until the capacitor gives out, then it dies normally',
    S.layerSeconds(1000, 40, 100, 30, 0), 30 + 1000 / 40);
  // repair losing, and the cap outlasts the layer -> cap is irrelevant
  eq('14d when the layer falls before the cap does, cap does not matter',
    S.layerSeconds(1000, 100, 40, 999, 0), 1000 / 60);
  // repair losing, cap dies first -> two phases
  eq('14e two phases when the cap dies mid-layer',
    S.layerSeconds(1000, 100, 40, 10, 0), 10 + (1000 - 600) / 100);
  // THE SHARED CAPACITOR: elapsed time on earlier layers eats the deadline
  eq('14f the capacitor does not reset between layers',
    S.layerSeconds(1000, 100, 40, 30, 30), 1000 / 100);
  eq('14g ...and a partly-spent cap still helps for what is left',
    S.layerSeconds(1000, 100, 40, 30, 20), 10 + (1000 - 600) / 100);
  // no damage at all
  eq('14h a layer taking no damage never falls', S.layerSeconds(1000, 0, 0, null, 0), null);
  eq('14i a layer with no hp is already gone', S.layerSeconds(0, 100, 0, null, 0), 0);

  // end to end through timeToKill
  const target = { name: 't', signatureRadius: 100000, velocity: 0, resonance: S.NO_RESISTS };
  const w = [{ typeId: 1, kind: 'untracked', cycleSeconds: 1,
    volley: { em: 100, thermal: 0, kinetic: 0, explosive: 0 } }];
  const layers = [{ name: 'Shield', hp: 1000, resonance: S.NO_RESISTS },
                  { name: 'Armor', hp: 500, resonance: S.NO_RESISTS }];
  const bare = S.timeToKill(w, target, { distance: 0, transversal: 0 }, layers, false);
  const repped = S.timeToKill(w, target, { distance: 0, transversal: 0 }, layers, false,
    { shieldRepairHps: 50, armorRepairHps: 0, capOutSeconds: null });
  close('14j without reps: 1000/100 + 500/100', bare.seconds, 15);
  close('14k with 50 hp/s on shield: 1000/50 + 500/100', repped.seconds, 25);
  eq('14l and the repaired layer says so', repped.perLayer[0].repairHps, 50);
  eq('14m the unrepaired one does not', repped.perLayer[1].repairHps, undefined);
  eq('14n a ship that out-reps everything is unkillable',
    S.timeToKill(w, target, { distance: 0, transversal: 0 }, layers, false,
      { shieldRepairHps: 500, armorRepairHps: 0, capOutSeconds: null }).seconds, null);
}


// ---------------------------------------------------------------------------
// 15. MODULE STATE OVERRIDES — switching one module and re-scoring is the
//     whole point, so the key must be stable and the override must be exact.
// ---------------------------------------------------------------------------
{
  const DF = require('./sim/lib/dogmaFit.js');
  const mk = (type, index, state, type_id) => ({ type_id, slot: { type, index }, state });
  const fit = {
    ship_type_id: 587,
    modules: [
      mk('High', 1, 'Active', 100), mk('High', 2, 'Active', 100),
      mk('Medium', 1, 'Active', 200),
      mk('Low', 1, 'Active', 300),
      mk('Rig', 1, 'Passive', 400),
      mk('SubSystem', 1, 'Passive', 500),
    ],
    drones: [], implants: [],
  };
  eq('15a the key is rack + index, not the type id', DF.moduleKey(fit.modules[1]), 'High2');
  eq('15b two identical modules get DIFFERENT keys',
    DF.moduleKey(fit.modules[0]) !== DF.moduleKey(fit.modules[1]), true);

  const off = DF.withModuleStates(fit, { High2: 'Passive' });
  eq('15c only the named module changes', off.modules.map((m) => m.state),
    ['Active', 'Passive', 'Active', 'Active', 'Passive', 'Passive']);
  eq('15d the original is not mutated', fit.modules[1].state, 'Active');

  const hot = DF.withModuleStates(fit, { Medium1: 'Overload' });
  eq('15e overload is settable', hot.modules[2].state, 'Overload');

  // rigs and subsystems have no run state in EVE and the engine expects Passive
  const rigged = DF.withModuleStates(fit, { Rig1: 'Active', SubSystem1: 'Overload' });
  eq('15f a rig cannot be switched on', rigged.modules[4].state, 'Passive');
  eq('15g nor a subsystem', rigged.modules[5].state, 'Passive');

  eq('15h an empty override map is a no-op', DF.withModuleStates(fit, {}), fit);
  eq('15i so is undefined', DF.withModuleStates(fit, undefined), fit);
  eq('15j a key for a module that is not there is ignored',
    DF.withModuleStates(fit, { High9: 'Passive' }).modules.map((m) => m.state),
    ['Active', 'Active', 'Active', 'Active', 'Passive', 'Passive']);
}


// ---------------------------------------------------------------------------
// 16. HEADINGS. A ship flies any direction; four presets could not say that.
// ---------------------------------------------------------------------------
{
  const T = (sp, a) => S.tangentialOf(sp, a);
  close('16a straight at the target is pure radial', T(1000, 0), 0, 1e-9);
  close('16b across is the whole speed', T(1000, 90), 1000, 1e-9);
  close('16c straight away is still no transversal', T(1000, 180), 0, 1e-9);
  close('16d the other way across is NEGATIVE', T(1000, 270), -1000, 1e-9);
  close('16e 45 degrees splits it', T(1000, 45), 1000 * Math.SQRT1_2, 1e-9);
  close('16f closing rate is the cosine', S.radialOf(1000, 0), 1000, 1e-9);
  close('16g ...and negative when running away', S.radialOf(1000, 180), -1000, 1e-9);

  const g = (as, aa, ts, ta, range) =>
    S.geometryFrom({ speed: as, angleDeg: aa, range }, { speed: ts, angleDeg: ta }, 1000);

  // CO-ROTATING: both across the same way -> transversals CANCEL
  close('16h two ships circling the same way cancel', g(500, 90, 500, 90, 10000).transversal, 0, 1e-9);
  // COUNTER-ROTATING: opposite -> they ADD
  close('16i circling opposite ways adds them', g(500, 90, 500, 270, 10000).transversal, 1000, 1e-9);
  eq('16j which is now the choice, not a worst-case assumption',
    g(500, 90, 500, 90, 10000).transversal < g(500, 90, 500, 270, 10000).transversal, true);

  // SPEED IS NOT AUTOMATICALLY MAXIMUM
  close('16k half speed, half the transversal', g(250, 90, 0, 0, 10000).transversal, 250, 1e-9);
  close('16l and a stopped ship presents none', g(0, 90, 0, 0, 10000).transversal, 0, 1e-9);

  close('16m angular velocity is transversal over range', g(500, 90, 0, 0, 10000).angularVelocity, 0.05, 1e-9);
  eq('16n zero range does not divide by zero', g(500, 90, 0, 0, 0).angularVelocity, 0);

  // EACH ship's dial reads 0 = toward ITS enemy (the UI's own labels: the
  // target's "approach" button also sets 0). Head-on therefore means BOTH at
  // 0, and the gap closes at the SUM. The original fixture here fed the
  // target 180 and called it head-on — pinning dead-code arithmetic whose
  // sign made a fleeing target pull the range IN once motion went live.
  const head = g(500, 0, 300, 0, 10000);
  close('16o head-on closing rates add', head.closingSpeed, 800, 1e-9);
  close('16p ...with no transversal at all', head.transversal, 0, 1e-9);
  // and a tail chase at equal speeds goes nowhere
  close('16o2 a chase cancels: one closing, one fleeing', g(500, 0, 500, 180, 10000).closingSpeed, 0, 1e-9);

  // the presets still work through the same model
  eq('16q the presets map onto angles', S.PRESET_ANGLE.orbit, 90);
  eq('16r closing is zero degrees', S.PRESET_ANGLE.approach, 0);
  const viaPreset = S.geometryOf({ behaviour: 'orbit', speed: 500, range: 10000 },
    { behaviour: 'stationary', speed: 900 }, 1000);
  close('16s the preset wrapper agrees with the angle form', viaPreset.transversal, 500, 1e-9);
  eq('16t a stationary target still cannot outrun an explosion', viaPreset.targetSpeed, 0);
}


// ---------------------------------------------------------------------------
// 17. RACK CAPACITY — a spare in the hold must not be fitted, and a hull with
//     no published slot data must not be unfitted entirely.
// ---------------------------------------------------------------------------
{
  const DF = require('./sim/lib/dogmaFit.js');
  const HI = 100, LOW = 200, SHIP = 300, SHIP_NODATA = 301;
  const Dg = (attrs, effs) => ({
    dogmaAttributes: attrs.map(([attributeID, value]) => ({ attributeID, value })),
    dogmaEffects: (effs || []).map((effectID) => ({ effectID, isDefault: true })),
  });
  const d = {
    types: { [HI]: { name: 'Gun', groupID: 1, categoryID: 7 },
             [LOW]: { name: 'Plate', groupID: 2, categoryID: 7 },
             [SHIP]: { name: 'Hull', groupID: 3, categoryID: 6 },
             [SHIP_NODATA]: { name: 'Mystery Hull', groupID: 3, categoryID: 6 } },
    typeDogma: {
      // 14 hiSlots = 3, 12 lowSlots = 2
      [SHIP]: Dg([[14, 3], [12, 2]], []),
      [SHIP_NODATA]: Dg([], []),
      [HI]: Dg([], [12]),    // effect 12 = hiPower
      [LOW]: Dg([], [11]),   // effect 11 = loPower
    },
  };
  const mk = (shipId, hiQty) => ({
    shipId, shipName: 'x', fitName: '', unresolved: [], extraFits: 0,
    items: [{ typeId: HI, name: 'Gun', qty: hiQty, charges: [], offlineQty: 0 }],
  });

  const exact = DF.toEsfFit(mk(SHIP, 3), d);
  eq('17a three guns in three high slots all fit', exact.esfFit.modules.length, 3);
  eq('17b and nothing is called cargo', exact.nonFit, []);

  const spare = DF.toEsfFit(mk(SHIP, 5), d);
  eq('17c only three of five can be fitted', spare.esfFit.modules.length, 3);
  eq('17d the other two are reported as not part of the fit', spare.nonFit, ['Gun']);

  // THE REGRESSION THIS CAUSED: a hull whose slot attributes are absent must
  // not silently unfit the entire ship.
  const unknown = DF.toEsfFit(mk(SHIP_NODATA, 5), d);
  eq('17e a hull with no published slot data fits everything rather than nothing',
    unknown.esfFit.modules.length, 5);
  eq('17f ...and reports no phantom cargo', unknown.nonFit, []);
}


// ---------------------------------------------------------------------------
// 18. APPLIED CAN EXCEED PAPER, AND THAT IS CORRECT.
//     One turret shot in a hundred is a WRECKING hit at 300% damage and lands
//     regardless of tracking, so a turret that never misses averages 101.5% of
//     nominal. The Battle Sim showed "Landing 101%", which looked like a bug
//     and was a mislabelled column. DO NOT CLAMP THIS.
// ---------------------------------------------------------------------------
{
  close('18a a certain hit averages 1.015x, not 1.0', S.turretDamageMultiplier(1), 1.01505, 1e-9);
  eq('18b so applied damage legitimately exceeds paper', S.turretDamageMultiplier(1) > 1, true);

  const turret = {
    typeId: 1, kind: 'turret', cycleSeconds: 1,
    volley: { em: 100, thermal: 0, kinetic: 0, explosive: 0 },
    optimal: 10000, falloff: 5000, tracking: 100, sigResolution: 40000,
  };
  // a big, stationary target well inside optimal: nothing can miss
  const sitting = { name: 't', signatureRadius: 40000, velocity: 0, resonance: S.NO_RESISTS };
  const r = S.appliedDps([turret], sitting, { distance: 1000, transversal: 0 });
  close('18c applied is 101.5% of raw against a target that cannot be missed',
    r.applied / r.raw, 1.01505, 1e-9);

  // MISSILES have no wrecking hit and are capped at 1
  const missile = {
    typeId: 2, kind: 'missile', cycleSeconds: 1,
    volley: { em: 100, thermal: 0, kinetic: 0, explosive: 0 },
    expRadius: 100, expVelocity: 1000, drf: 1,
  };
  const m = S.appliedDps([missile], sitting, { distance: 1000, transversal: 0 });
  close('18d a missile never exceeds 100% of paper', m.applied / m.raw, 1, 1e-12);

  // and a smartbomb applies exactly in full, never more
  const bomb = {
    typeId: 3, kind: 'untracked', cycleSeconds: 1,
    volley: { em: 100, thermal: 0, kinetic: 0, explosive: 0 },
  };
  const b = S.appliedDps([bomb], sitting, { distance: 0, transversal: 0 });
  close('18e nor does an untracked weapon', b.applied / b.raw, 1, 1e-12);
}


// ---------------------------------------------------------------------------
// 19. PASSIVE SHIELD REGEN — a whole tanking style that was excluded. It costs
//     NO capacitor, so unlike a booster it never stops.
// ---------------------------------------------------------------------------
{
  // 100 incoming, 30 passive -> effectively 70
  close('19a passive regen reduces the incoming rate',
    S.layerSeconds(700, 100, 0, null, 0, 30), 10, 1e-9);
  eq('19b passive regen alone can make a layer unkillable',
    S.layerSeconds(700, 100, 0, null, 0, 120), null);
  // it keeps working AFTER the capacitor dies, unlike the booster
  close('19c a booster stops at cap-out; passive regen does not',
    S.layerSeconds(1000, 100, 50, 10, 0, 25),
    // phase 1: 100 - 25 - 50 = 25/s for 10 s -> 250 stripped
    // phase 2: 100 - 25 = 75/s for the remaining 750
    10 + 750 / 75, 1e-9);
  eq('19d and with enough of it the ship survives the cap running dry',
    S.layerSeconds(1000, 100, 50, 10, 0, 150), null);

  // end to end
  const target = { name: 't', signatureRadius: 100000, velocity: 0, resonance: S.NO_RESISTS };
  const w = [{ typeId: 1, kind: 'untracked', cycleSeconds: 1,
    volley: { em: 100, thermal: 0, kinetic: 0, explosive: 0 } }];
  const layers = [{ name: 'Shield', hp: 1000, resonance: S.NO_RESISTS },
                  { name: 'Armor', hp: 500, resonance: S.NO_RESISTS }];
  const passive = S.timeToKill(w, target, { distance: 0, transversal: 0 }, layers, false,
    { shieldRepairHps: 0, armorRepairHps: 0, shieldPassiveHps: 50, capOutSeconds: null });
  close('19e passive doubles the shield time here', passive.perLayer[0].seconds, 20, 1e-9);
  close('19f but does NOTHING for armour', passive.perLayer[1].seconds, 5, 1e-9);
  eq('19g and the shield row reports the rate', passive.perLayer[0].repairHps, 50);
}

// ---------------------------------------------------------------------------
// 20. PER-SLOT CHARGES. Three tracking computers are three script decisions.
// ---------------------------------------------------------------------------
{
  const DF = require('./sim/lib/dogmaFit.js');
  const TC = 500, OPTIMAL = 600, TRACKING = 601;
  const fit = {
    ship_type_id: 587,
    modules: [
      { type_id: TC, slot: { type: 'Medium', index: 1 }, state: 'Active' },
      { type_id: TC, slot: { type: 'Medium', index: 2 }, state: 'Active' },
      { type_id: TC, slot: { type: 'Medium', index: 3 }, state: 'Active' },
    ],
    drones: [], implants: [],
  };
  const mixed = DF.withModuleCharges(fit, { Medium1: OPTIMAL, Medium2: TRACKING });
  eq('20a each slot takes its OWN script',
    mixed.modules.map((m) => m.charge?.type_id ?? null), [OPTIMAL, TRACKING, null]);
  eq('20b the original is untouched', fit.modules[0].charge, undefined);

  const loaded = DF.withModuleCharges(fit, { Medium1: OPTIMAL, Medium2: OPTIMAL, Medium3: OPTIMAL });
  const cleared = DF.withModuleCharges(loaded, { Medium2: null });
  eq('20c null empties exactly one slot',
    cleared.modules.map((m) => m.charge?.type_id ?? null), [OPTIMAL, null, OPTIMAL]);
  eq('20d an empty map is a no-op', DF.withModuleCharges(fit, {}), fit);
  eq('20e a key for a slot that is not there is ignored',
    DF.withModuleCharges(fit, { High7: OPTIMAL }).modules.map((m) => m.charge ?? null),
    [null, null, null]);
}


// ---------------------------------------------------------------------------
// 21. LEGAL MODULE STATES. A plate has no "running" — offering one offers a
//     state that does not exist. Category 1 = activatable, 5 = overloadable,
//     verified by decoding: Large Shield Booster II [0,1,4,5], 200mm AutoCannon
//     II [0,1,2,4,5], versus 1600mm Steel Plates II / BCS II / Damage Control
//     II / Nanofiber II, all [0,4].
// ---------------------------------------------------------------------------
{
  const DF = require('./sim/lib/dogmaFit.js');
  const ACTIVE = 10, PASSIVE = 11, NOHEAT = 12;
  const data = {
    types: {}, typeDogma: {
      [ACTIVE]: { dogmaAttributes: [], dogmaEffects: [{ effectID: 1 }, { effectID: 4 }, { effectID: 5 }] },
      [PASSIVE]: { dogmaAttributes: [], dogmaEffects: [{ effectID: 2 }, { effectID: 4 }] },
      [NOHEAT]: { dogmaAttributes: [], dogmaEffects: [{ effectID: 1 }, { effectID: 4 }] },
    },
  };
  // effectId -> category
  const effects = { 1: { effectCategory: 1 }, 2: { effectCategory: 0 },
                    4: { effectCategory: 4 }, 5: { effectCategory: 5 } };

  eq('21a an active, overloadable module offers all four states',
    DF.moduleStateOptions(ACTIVE, data, effects), ['Active', 'Overload', 'Online', 'Passive']);
  eq('21b a PASSIVE module offers only online and offline',
    DF.moduleStateOptions(PASSIVE, data, effects), ['Online', 'Passive']);
  eq('21c ...so it can never be set to running', 
    DF.moduleStateOptions(PASSIVE, data, effects).includes('Active'), false);
  eq('21d an active module that cannot be overheated omits overload',
    DF.moduleStateOptions(NOHEAT, data, effects), ['Active', 'Online', 'Passive']);
  eq('21e an unknown type still offers the safe pair',
    DF.moduleStateOptions(999, data, effects), ['Online', 'Passive']);
}


// ---------------------------------------------------------------------------
// 22. SWAPPING THE MODULE IN A SLOT.
// ---------------------------------------------------------------------------
{
  const DF = require('./sim/lib/dogmaFit.js');
  const GUN = 100, PLATE = 200, AMMO = 300;
  const fit = {
    ship_type_id: 587,
    modules: [
      { type_id: GUN, slot: { type: 'High', index: 1 }, state: 'Active', charge: { type_id: AMMO } },
      { type_id: GUN, slot: { type: 'High', index: 2 }, state: 'Active', charge: { type_id: AMMO } },
      { type_id: PLATE, slot: { type: 'Low', index: 1 }, state: 'Online' },
    ],
    drones: [], implants: [],
  };
  const swapped = DF.withModuleSwaps(fit, { High2: PLATE });
  eq('22a the named slot takes the new module',
    swapped.modules.map((m) => m.type_id), [GUN, PLATE, PLATE]);
  eq('22b the slot itself is unchanged', swapped.modules[1].slot, { type: 'High', index: 2 });
  eq('22c the run state survives the swap', swapped.modules[1].state, 'Active');
  // THE CHARGE MUST NOT TRAVEL: ammo for a gun is not ammo for a plate
  eq('22d the old charge is dropped, not carried onto the new module',
    swapped.modules[1].charge, undefined);
  eq('22e ...while an untouched slot keeps its charge',
    swapped.modules[0].charge, { type_id: AMMO });

  const emptied = DF.withModuleSwaps(fit, { High1: null });
  eq('22f null removes the module entirely',
    emptied.modules.map((m) => m.type_id), [GUN, PLATE]);
  eq('22g and the remaining slots keep their own indices',
    emptied.modules.map((m) => m.slot.index), [2, 1]);

  eq('22h an empty map is a no-op', DF.withModuleSwaps(fit, {}), fit);
  eq('22i so is undefined', DF.withModuleSwaps(fit, undefined), fit);
  eq('22j a key for a slot that is not there changes nothing',
    DF.withModuleSwaps(fit, { Low9: GUN }).modules.length, 3);
  eq('22k the original fit is never mutated', fit.modules[1].type_id, GUN);
}


// ---------------------------------------------------------------------------
// 23. A DUEL HAS TWO SIDES. The return-fire geometry is the SAME engagement
//     seen from the other end — relative tangential velocity has the same
//     magnitude whichever ship you stand on — so a symmetric pair must produce
//     symmetric transversal.
// ---------------------------------------------------------------------------
{
  const A = { speed: 500, angleDeg: 90, range: 10000 };
  const B = { speed: 300, angleDeg: 270 };
  const fwd = S.geometryFrom(A, B, 1000);
  const back = S.geometryFrom({ ...B, range: A.range }, A, 1000);
  close('23a transversal is the same from either end', fwd.transversal, back.transversal, 1e-9);
  close('23b ...and so is the angular velocity', fwd.angularVelocity, back.angularVelocity, 1e-9);
  close('23c the range is shared', fwd.engagement.distance, back.engagement.distance, 1e-9);

  // a mirror match must be exactly even
  const mirror = S.geometryFrom({ speed: 400, angleDeg: 90, range: 5000 }, { speed: 400, angleDeg: 90 }, 1000);
  close('23d two identical ships flying identically have zero relative transversal',
    mirror.transversal, 0, 1e-9);

  // symmetric by meaning, not by sign: whichever ship charges, the GAP
  // closes at the same rate (the old assertion had them opposite — under
  // that sign a target pressing "approach" flew away)
  const c1 = S.geometryFrom({ speed: 500, angleDeg: 0, range: 10000 }, { speed: 0, angleDeg: 0 }, 1000);
  const c2 = S.geometryFrom({ speed: 0, angleDeg: 0, range: 10000 }, { speed: 500, angleDeg: 0 }, 1000);
  close('23e a ship charging you closes at the same rate you would charging it',
    c1.closingSpeed, c2.closingSpeed, 1e-9);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
