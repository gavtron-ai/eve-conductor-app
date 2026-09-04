// PURE dogma-fit plumbing — no Vite asset imports so node fixtures can run
// the exact shipped code: ParsedFit → engine fit shape, and attribute
// extraction from the engine's result. Used by dogmaStats.ts (the loader).
import type { ParsedFit } from './skillRelevance';
import { summarize, type FitSummary, type EngineResult } from './fitSummary';
import { simWeapons, resonanceLayers, defensesOf, type SimWeapon, type ResonanceLayers, type Defenses } from './fitSim';
import { projectedCycles, commandBursts, type ProjectedModule, type ProjRefusal, type CommandBurst } from './projectedCycle';

export interface EsfDataShapes {
  types: Record<string, { name: string; groupID: number; categoryID: number }>;
  typeDogma: Record<string, { dogmaAttributes: { attributeID: number; value: number }[]; dogmaEffects: { effectID: number; isDefault: boolean }[] }>;
}

// fitting-slot effects: which slot a module occupies (from its own dogma).
// Ids verified against the bundled dogmaEffects.pb2: 11=loPower, 12=hiPower,
// 13=medPower — NOT the 11/13/21 misremembering that briefly lived here.
export const SLOT_EFFECT: Record<number, string> = {
  11: 'Low',
  12: 'High',
  13: 'Medium',
  2663: 'Rig',
  3772: 'SubSystem',
  6306: 'Service',
};

/**
 * PROPULSION MODULES — the biggest single lever on the two numbers a battle
 * sim cares most about. Measured on the shipped wasm (Rifter + 5MN Y-T8
 * Compact MWD): Active gives signature 210 and 3213 m/s; Online gives 35 and
 * 456. Mass rises 1.067M -> 1.567M too, so align time is 47% longer, and the
 * capacitor swings from -6.014 GJ/s (dry in 27 s) to -2.639 (54 s).
 *
 * Every fit that arrives as EFT text or from ESI is scored with the prop mod
 * RUNNING, because toEsfFit marks every non-offline module Active and neither
 * format has any notation for "fitted, powered, not cycling". Only the Fit
 * Wizard could ever express it.
 *
 * Discriminator verified by decoding: effects 6731 `moduleBonusAfterburner`
 * (74 published types) and 6730 `moduleBonusMicrowarpdrive` (73) partition
 * published group 46 EXACTLY — 147 types, none missed, none outside.
 */
export const EFFECT_AFTERBURNER = 6731;
export const EFFECT_MICROWARPDRIVE = 6730;

export function isPropModule(data: EsfDataShapes, typeId: number): boolean {
  const es = data.typeDogma[typeId]?.dogmaEffects ?? [];
  return es.some((e) => e.effectID === EFFECT_AFTERBURNER || e.effectID === EFFECT_MICROWARPDRIVE);
}

/**
 * Return the fit with its propulsion modules switched off.
 *
 * 'Online', NOT 'Passive': Passive is EVE's OFFLINE state, which also refunds
 * the module's CPU and powergrid and removes the microwarpdrive's -25%
 * capacity penalty. A player who stops cycling their MWD still pays for it.
 *
 * Modules already Passive are left alone — those were deliberately offlined by
 * the user (EFT's /OFFLINE, or the wizard's offline state), and promoting them
 * to Online would charge the fit for something it had switched off.
 */
export function withPropModulesOff(fit: EsfFitShape, data: EsfDataShapes): EsfFitShape {
  return {
    ...fit,
    modules: fit.modules.map((m) =>
      (m.state === 'Active' || m.state === 'Overload') && isPropModule(data, m.type_id)
        ? { ...m, state: 'Online' }
        : m),
  };
}

/**
 * ACTIVE RESIST HARDENER, from BASE type dogma. The classification is
 * MEASURED (2026-08-19 probe, PLAN v0.114.0): an activation cost (attr 6)
 * plus a duration (attr 73) plus resist self-marking — shield AND armor
 * hardeners carry resistance-bonus attrs 984–987 (nonzero), the Reactive
 * Armor Hardener carries resonance multipliers 267–270 (≠ 1). The probe
 * verified the non-matches too: passive plates/membranes/DCU/amps and
 * Siege/Triage/Bastion all lack attr 6. Mirrors moduleCycle.hardenerDrain,
 * which applies the same rule to ENGINE-FINAL items.
 */
export function isActiveResistHardener(data: EsfDataShapes, typeId: number): boolean {
  const td = data.typeDogma[typeId];
  if (!td) return false;
  const a = new Map(td.dogmaAttributes.map((x) => [x.attributeID, x.value]));
  if (!((a.get(6) ?? 0) > 0) || !((a.get(73) ?? 0) > 0)) return false;
  return [984, 985, 986, 987].some((id) => (a.get(id) ?? 0) !== 0)
    || [267, 268, 269, 270].some((id) => a.has(id) && a.get(id) !== 1);
}

/**
 * The fit with its active resist hardeners switched off — the SECOND engine
 * pass behind the sim's hardeners-dry resonance. 'Online', not 'Passive',
 * for the same reason as the prop toggle above: a hardener that stops
 * cycling still occupies its slot and fitting.
 */
export function withResistHardenersOff(fit: EsfFitShape, data: EsfDataShapes): EsfFitShape {
  return {
    ...fit,
    modules: fit.modules.map((m) =>
      (m.state === 'Active' || m.state === 'Overload') && isActiveResistHardener(data, m.type_id)
        ? { ...m, state: 'Online' }
        : m),
  };
}

/**
 * A STABLE NAME for one fitted module, so a state override survives a re-parse.
 *
 * toEsfFit assigns the index by a per-rack counter, so "High3" is the third
 * high-slot module in item order and stays that as long as the fit does. It is
 * deliberately NOT the type id: a fit with three identical launchers has three
 * separately switchable modules, which is the whole point of a toggle.
 */
export const moduleKey = (m: EsfModule): string => `${m.slot.type}${m.slot.index}`;

export type ModuleState = 'Passive' | 'Online' | 'Active' | 'Overload';

/**
 * Apply per-module state overrides.
 *
 * This is what makes "what does my shield booster actually buy me" answerable:
 * switch it off and the same fit is re-scored with everything else identical.
 * Rigs and subsystems are skipped — they have no run state in EVE and the
 * engine expects them Passive.
 */
export function withModuleStates(
  fit: EsfFitShape, states: Record<string, ModuleState> | undefined,
): EsfFitShape {
  if (!states || Object.keys(states).length === 0) return fit;
  return {
    ...fit,
    modules: fit.modules.map((m) => {
      if (m.slot.type === 'Rig' || m.slot.type === 'SubSystem') return m;
      const want = states[moduleKey(m)];
      return want ? { ...m, state: want } : m;
    }),
  };
}

/**
 * Per-SLOT charges.
 *
 * The Battle Sim keyed ammo by module TYPE, so three Tracking Computer IIs
 * shared one script selector and could never carry different scripts — which
 * is exactly how they are flown (one optimal, one tracking). Keyed by slot,
 * every copy is its own decision, the same way module states already are.
 *
 * `null` unloads. A key naming a slot that does not exist is ignored.
 */
export function withModuleCharges(
  fit: EsfFitShape, charges: Record<string, number | null> | undefined,
): EsfFitShape {
  if (!charges || Object.keys(charges).length === 0) return fit;
  return {
    ...fit,
    modules: fit.modules.map((m) => {
      const k = moduleKey(m);
      if (!(k in charges)) return m;
      const want = charges[k];
      if (want === null || want === undefined) {
        const { charge, ...rest } = m;
        void charge;
        return rest as EsfModule;
      }
      return { ...m, charge: { type_id: want } };
    }),
  };
}

/**
 * WHICH STATES A MODULE CAN ACTUALLY BE IN.
 *
 * Offering "running" and "overloaded" for a 1600mm plate is offering a state
 * that does not exist — a passive module is only ever online or offline.
 *
 * The discriminator is the effect CATEGORY, verified by decoding: an active
 * module carries a category-1 effect and an overloadable one a category-5.
 * Measured: Large Shield Booster II [0,1,4,5], 200mm AutoCannon II [0,1,2,4,5],
 * versus 1600mm Steel Plates II / Ballistic Control System II / Damage Control
 * II / Nanofiber Internal Structure II, all [0,4].
 */
export const EFFECT_CATEGORY_ACTIVE = 1;
export const EFFECT_CATEGORY_OVERLOAD = 5;

export function moduleStateOptions(
  typeId: number,
  data: EsfDataShapes,
  effects: Record<string, { effectCategory?: number }>,
): ModuleState[] {
  const cats = new Set(
    (data.typeDogma[typeId]?.dogmaEffects ?? [])
      .map((e) => effects[String(e.effectID)]?.effectCategory)
      .filter((c): c is number => c !== undefined),
  );
  const states: ModuleState[] = [];
  if (cats.has(EFFECT_CATEGORY_ACTIVE)) states.push('Active');
  if (cats.has(EFFECT_CATEGORY_OVERLOAD)) states.push('Overload');
  states.push('Online', 'Passive');
  return states;
}

/**
 * SWAP THE MODULE IN A SLOT.
 *
 * "What if this were a plate instead" is the question a battle sim exists to
 * answer, and until now the only way to ask it was to edit the fit somewhere
 * else and come back. A swap replaces the type in one slot; the charge is
 * DROPPED with it, because a charge that fitted the old module almost never
 * fits the new one and carrying it over would quietly produce an illegal load.
 *
 * `null` empties the slot. Rigs and subsystems are swappable too — changing a
 * T3 subsystem legitimately changes the whole ship — but the CALLER decides
 * what to offer, since rack legality is a browse-time question.
 */
export function withModuleSwaps(
  fit: EsfFitShape, swaps: Record<string, number | null> | undefined,
): EsfFitShape {
  if (!swaps || Object.keys(swaps).length === 0) return fit;
  const out: EsfModule[] = [];
  for (const m of fit.modules) {
    const k = moduleKey(m);
    if (!(k in swaps)) { out.push(m); continue; }
    const want = swaps[k];
    if (want === null || want === undefined) continue; // slot emptied
    // the charge does not travel: it belonged to the module that left
    out.push({ type_id: want, slot: m.slot, state: m.state });
  }
  return { ...fit, modules: out };
}

/** does this fit have a prop mod that is currently cycling? */
export const hasRunningPropModule = (fit: EsfFitShape, data: EsfDataShapes): boolean =>
  fit.modules.some((m) => (m.state === 'Active' || m.state === 'Overload') && isPropModule(data, m.type_id));

export interface EsfModule {
  type_id: number;
  slot: { type: string; index: number };
  state: string;
  charge?: { type_id: number };
}

export interface EsfFitShape {
  ship_type_id: number;
  modules: EsfModule[];
  drones: { type_id: number; state: string }[];
  /** pilot implant type-ids (EVE Conductor extension to the vendored
   * engine) — +% CPU/PG/cap hardwirings change the OUTPUT numbers */
  implants: number[];
}

/**
 * RACK CAPACITY — how many modules a hull can actually hold.
 *
 * EFT text cannot say which copies are in CARGO: the game blank-line-separates
 * every rack, so "the bit after the blank line" identifies nothing. A spare
 * Damage Control riding in the hold therefore arrived as an ordinary item and
 * toEsfFit SLOTTED it — its bonus counted, its CPU counted, and it appeared in
 * the Battle Sim's module list as something you could switch on.
 *
 * The hull answers the question without any parsing: it publishes how many
 * slots each rack has, so anything past that count is not fitted. Ids are the
 * same ones wizardFits uses (hiSlots 14, medSlots 13, lowSlots 12, rigSlots
 * 1137, maxSubSystems 1367), plus the T3 subsystem modifiers, because a
 * strategic cruiser publishes 0/0/0 and gets every slot from its subsystems.
 */
const RACK_CAPACITY_ATTR: Record<string, number> = {
  High: 14, Medium: 13, Low: 12, Rig: 1137, SubSystem: 1367,
};
const RACK_MOD_ATTR: Record<string, number> = { High: 1374, Medium: 1375, Low: 1376 };

function rackCapacity(hullId: number, data: EsfDataShapes, subsystemIds: number[]): Record<string, number> {
  const attr = (typeId: number, id: number) =>
    data.typeDogma[typeId]?.dogmaAttributes?.find((a) => a.attributeID === id)?.value ?? 0;
  const out: Record<string, number> = {};
  for (const [rack, id] of Object.entries(RACK_CAPACITY_ATTR)) {
    const mod = RACK_MOD_ATTR[rack];
    const fromSubs = mod === undefined
      ? 0
      : subsystemIds.reduce((n, sid) => n + Math.round(attr(sid, mod)), 0);
    const published = Math.round(attr(hullId, id));
    // A HULL THAT DECLARES NOTHING IS NOT A HULL WITH NO SLOTS. We cannot tell
    // "genuinely zero" from "this attribute is missing", and guessing zero
    // silently unfits the whole ship — which is a far worse failure than
    // letting a spare through. Enforce only where the data actually speaks.
    out[rack] = published > 0 || fromSubs > 0
      ? Math.max(0, published + fromSubs)
      : Number.POSITIVE_INFINITY;
  }
  // a Service slot count is not published the same way; leave it unbounded
  out.Service = Number.POSITIVE_INFINITY;
  return out;
}

/** hull drone bandwidth, and each drone's share of it */
const ATTR_DRONE_BANDWIDTH = 1271;
const ATTR_DRONE_BANDWIDTH_USED = 1272;
/** EVE's hard ceiling on drones in space for any sub-capital: Drones V */
const MAX_ACTIVE_DRONES = 5;

/**
 * WHICH DRONES ARE ACTUALLY IN SPACE — the single rule, used by every path
 * that builds an engine fit.
 *
 * It lived inline in toEsfFit, and the Fit Wizard builds its engine fit
 * somewhere else entirely (wizardFits.variationEsfFit) — so the wizard kept
 * the old "up to 25, all Active" behaviour and reported several flights'
 * DPS for the same fit the Fit Library scored correctly. A rule that matters
 * for money must have exactly one implementation.
 */
export interface DroneAllocation {
  drones: { type_id: number; state: string }[];
  /** aboard but NOT in space — named so a panel can say why */
  benchedDrones: string[];
  droneBandwidth: number;
  droneBandwidthUsed: number;
}

export function allocateDrones(
  hullId: number,
  bay: { typeId: number; name: string; qty: number }[],
  data: EsfDataShapes,
): DroneAllocation {
  const hullBandwidth = data.typeDogma[hullId]?.dogmaAttributes
    ?.find((a) => a.attributeID === ATTR_DRONE_BANDWIDTH)?.value ?? 0;
  let bandwidthLeft = hullBandwidth;
  let active = 0;
  const drones: { type_id: number; state: string }[] = [];
  const benchedDrones: string[] = [];
  for (const item of bay) {
    if (data.types[item.typeId]?.categoryID !== 18) continue; // only real drones fly
    const use = data.typeDogma[item.typeId]?.dogmaAttributes
      ?.find((a) => a.attributeID === ATTR_DRONE_BANDWIDTH_USED)?.value ?? 0;
    let benched = 0;
    for (let i = 0; i < item.qty; i++) {
      // a drone with no published bandwidth cost (fighters, oddities) is
      // still subject to the count limit
      const fitsBandwidth = hullBandwidth <= 0 || use <= 0 || bandwidthLeft >= use;
      if (active < MAX_ACTIVE_DRONES && fitsBandwidth) {
        drones.push({ type_id: item.typeId, state: 'Active' });
        active++;
        bandwidthLeft -= use;
      } else {
        benched++;
      }
    }
    if (benched > 0) benchedDrones.push(`${item.name} x${benched}`);
  }
  return {
    drones,
    benchedDrones,
    droneBandwidth: hullBandwidth,
    droneBandwidthUsed: Math.max(0, hullBandwidth - bandwidthLeft),
  };
}

/** convert a parsed EFT fit into the engine's fit shape. Items that are
 * neither slotted modules nor drones (cargo ammo, spare charges) are NOT
 * part of the flown fit and are skipped — reported in `nonFit`. Items the
 * data bundle doesn't know are reported in `missingData` (callers must
 * REFUSE to compute stats then — a partial fit's numbers are lies). */
export function toEsfFit(fit: ParsedFit, data: EsfDataShapes): {
  esfFit: EsfFitShape;
  nonFit: string[];
  missingData: string[];
  /** drones aboard that CANNOT be in space (bandwidth or the 5-drone cap) —
   * excluded from the stats and named, so the panel can say so rather than
   * silently flattering the DPS */
  benchedDrones: string[];
  droneBandwidth: number;
  droneBandwidthUsed: number;
} {
  if (fit.shipId === null) throw new Error('no hull');
  const modules: EsfModule[] = [];
  const drones: { type_id: number; state: string }[] = [];
  const nonFit: string[] = [];
  const missingData: string[] = [];
  // the HULL is data too — an unknown hull id would panic inside the wasm
  // (opaque "unreachable") instead of the designed refusal
  if (!data.typeDogma[fit.shipId] || !data.types[fit.shipId]) {
    missingData.push(fit.shipName || `hull #${fit.shipId}`);
  }
  // drones are allocated by the ONE shared rule (see allocateDrones) — the
  // bay is collected here and handed over after the module walk
  const bay: { typeId: number; name: string; qty: number }[] = [];

  // AMMO THAT IS IN A GUN IS NOT CARGO. parseFit records a loaded charge
  // twice on purpose — once paired to its module (for the engine) and once as
  // its own item (so Missile Bombardment still counts as a relevant skill) —
  // and the second copy has no slot effect, so it used to fall through to
  // nonFit. The panel then told the user their loaded ammo was "not part of
  // the flown fit" while simultaneously simulating it. Only a genuine SURPLUS
  // beyond what the guns hold is cargo. Charges past the copy count are never
  // loaded (the module walk below reads item.charges[i] for i < qty), so the
  // tally is capped the same way.
  const loadedCharges = new Map<number, number>();
  for (const item of fit.items) {
    for (const c of item.charges.slice(0, item.qty)) {
      loadedCharges.set(c, (loadedCharges.get(c) ?? 0) + 1);
    }
  }

  const slotCounters: Record<string, number> = {};
  /** modules past what the hull can hold — spares in the hold, reported */
  const overflow: string[] = [];
  // subsystems must be known BEFORE the rack sizes, because a T3 publishes
  // 0/0/0 and gets every slot from them
  const subsystemIds = fit.items
    .filter((it) => (data.typeDogma[it.typeId]?.dogmaEffects ?? []).some((e) => e.effectID === 3772))
    .flatMap((it) => Array<number>(it.qty).fill(it.typeId));
  const capacity = rackCapacity(fit.shipId, data, subsystemIds);
  for (const item of fit.items) {
    const td = data.typeDogma[item.typeId];
    const t = data.types[item.typeId];
    if (!td || !t) {
      missingData.push(item.name);
      continue;
    }
    const slotType = td.dogmaEffects.map((e) => SLOT_EFFECT[e.effectID]).find((s) => s !== undefined);
    if (slotType) {
      for (let i = 0; i < item.qty; i++) {
        // PAST THE RACK'S CAPACITY IT IS NOT FITTED. This is the only reliable
        // way to tell a spare in the hold from a fitted module, because EFT
        // text cannot express cargo.
        if ((slotCounters[slotType] ?? 0) >= (capacity[slotType] ?? Number.POSITIVE_INFINITY)) {
          overflow.push(item.name);
          continue;
        }
        const index = (slotCounters[slotType] = (slotCounters[slotType] ?? 0) + 1);
        // the last `offlineQty` copies are fitted but OFFLINE (no CPU/PG/
        // cap — engine state Passive); which exact copy is offline is not
        // knowable from a merged stack, only the count is
        const offline = i >= item.qty - item.offlineQty;
        const charge = item.charges[i]; // per-copy; beyond the list = unloaded
        modules.push({
          type_id: item.typeId,
          slot: { type: slotType, index },
          state: offline || slotType === 'Rig' || slotType === 'SubSystem' ? 'Passive' : 'Active',
          ...(charge !== undefined ? { charge: { type_id: charge } } : {}),
        });
      }
    } else if (t.categoryID === 18) {
      bay.push({ typeId: item.typeId, name: item.name, qty: item.qty });
    } else if (item.qty > (loadedCharges.get(item.typeId) ?? 0)) {
      nonFit.push(item.name); // genuinely spare: cargo ammo, boosters, …
    }
  }
  const alloc = allocateDrones(fit.shipId, bay, data);
  drones.push(...alloc.drones);
  // a spare in the hold is exactly as "not part of the flown fit" as cargo ammo
  for (const name of overflow) if (!nonFit.includes(name)) nonFit.push(name);
  return {
    esfFit: { ship_type_id: fit.shipId, modules, drones, implants: [] },
    nonFit,
    missingData,
    benchedDrones: alloc.benchedDrones,
    droneBandwidth: alloc.droneBandwidth,
    droneBandwidthUsed: alloc.droneBandwidthUsed,
  };
}

export const ATTR = {
  cpuOutput: 48,
  cpuLoad: 49,
  powerOutput: 11,
  powerLoad: 15,
  upgradeCapacity: 1132,
  /** per-RIG calibration cost — the engine never writes hull upgradeLoad
   * (1152), so calibration load is summed from the rig items themselves */
  upgradeCost: 1153,
  capacitorCapacity: 482,
  rechargeRate: 55,
  capacitorPeakDelta: -5,
  capacitorDepletesIn: -7,
};

/** hull attributes come back as a JS Map (serde) — tolerate object form too */
export function attrValue(attributes: unknown, id: number): number {
  let entry: { value?: number | null; base_value?: number } | undefined;
  if (attributes instanceof Map) entry = attributes.get(id) as typeof entry;
  else if (attributes && typeof attributes === 'object')
    entry = (attributes as Record<string, typeof entry>)[String(id)];
  if (!entry) return 0;
  return entry.value ?? entry.base_value ?? 0;
}

export interface FitStats {
  cpu: { load: number; output: number };
  power: { load: number; output: number };
  calibration: { load: number; output: number };
  cap: {
    capacity: number;
    rechargeRate: number;
    /** GJ/s at peak recharge; >= 0 = cap stable */
    peakDelta: number;
    /** seconds until dry; NEGATIVE = stable (engine convention) */
    depletesIn: number;
  };
  /** items excluded because they aren't part of the flown fit (cargo ammo) */
  nonFit: string[];
  /** drones ABOARD but not in space (over bandwidth, or past the 5-drone
   * ceiling). Their damage is deliberately NOT in the numbers below — spare
   * flights used to be counted as firing, which inflated drone DPS several
   * times over. Named so the panel can say why. */
  benchedDrones: string[];
  /** EVERY attribute the engine computed for the hull, id → final value —
   * the full fitting-window attributes panel */
  hullAttributes: Map<number, number>;
  /** ids the HULL ITSELF carries in the SDE. The engine also materializes
   * defaults for anything its effect graph touches (a Rifter came back with
   * "Maximum Jump Range"), so the panel shows this set only. */
  hullOwnAttributes: Set<number>;
  /** the numbers a fit is judged by: damage, tank, speed, targeting */
  summary: FitSummary;
  /** per-weapon inputs for the APPLICATION layer (range, tracking, explosion
   * radius, ammo damage types). Extracted here so the simulation runs off the
   * same single engine pass everything else uses — a graph computed from a
   * second, differently-built fit would eventually disagree with the panel
   * above it, which is exactly how the drone-DPS bug happened. */
  simWeapons: SimWeapon[];
  /** hull resistances per layer, for EHP against a chosen damage profile
   * rather than the even 25/25/25/25 split `summary.ehp` assumes */
  resonance: ResonanceLayers;
  /** the ship's OWN local repair, and the measured second at which its
   * capacitor gives out — the honest deadline on that repair */
  defenses: Defenses;
  /** everything this fit PROJECTS at other ships — webs, painters,
   * disruptors, neuts, nos, scrams, remote reps, cap transfer — with
   * engine-final strengths (extraction keyed by effect id) */
  projected: ProjectedModule[];
  /** projected classes seen but refused with a stated reason (damp/ECM need
   * a lock model; mutated modules missing data) — never silently dropped */
  projRefused: ProjRefusal[];
  /** an ACTIVE module requiring skill 3454 High Speed Maneuvering is fitted
   * — the data's own filter for what a warp scrambler shuts down (ABs
   * require 3450 and are exempt) */
  mwdFitted: boolean;
  /** command bursts this fit runs, buff values engine-final (hull, skills
   * and mindlinks folded) */
  bursts: CommandBurst[];
  /** metres — engine-final char attr 458: drones deal NOTHING to a target
   * further than this from their owner (base 20 km, +5 km/lvl Drone
   * Avionics, +3 km/lvl Advanced, +20 km per Drone Link Augmentor) */
  droneControlRangeM: number | null;
}

export interface CalcResultShape {
  hull: { attributes: unknown };
  /** the engine's character row — drone control range (458) lives HERE, not
   * on the hull (measured: all-V Guardian char 458 = 60,000; 80,000 with a
   * Drone Link Augmentor; hull 458 is absent entirely) */
  char?: { attributes: unknown };
  items: {
    type_id: number;
    state?: string;
    slot: { type?: string } | string;
    attributes: unknown;
    charge?: { type_id: number; attributes: unknown } | null;
  }[];
}

/** every hull attribute the engine produced, as id → final value */
function allAttributes(attributes: unknown): Map<number, number> {
  const out = new Map<number, number>();
  const put = (k: unknown, v: unknown) => {
    const id = Number(k);
    const e = v as { value?: number | null; base_value?: number } | undefined;
    if (!Number.isFinite(id) || !e) return;
    const val = e.value ?? e.base_value;
    if (typeof val === 'number' && Number.isFinite(val)) out.set(id, val);
  };
  if (attributes instanceof Map) {
    for (const [k, v] of attributes) put(k, v);
  } else if (attributes && typeof attributes === 'object') {
    for (const [k, v] of Object.entries(attributes)) put(k, v);
  }
  return out;
}

export function extractStats(
  result: CalcResultShape,
  nonFit: string[],
  hullOwn: Set<number> = new Set(),
  benchedDrones: string[] = [],
): FitStats {
  const a = result.hull.attributes;
  // calibration: the engine does NOT accumulate hull upgradeLoad — sum the
  // rigs' own upgradeCost (verified: hull 1152 absent, rig items carry 1153)
  const calibrationLoad = result.items
    .filter((it) => (typeof it.slot === 'string' ? it.slot === 'Rig' : it.slot?.type === 'Rig'))
    .reduce((s, it) => s + attrValue(it.attributes, ATTR.upgradeCost), 0);
  return {
    cpu: { load: attrValue(a, ATTR.cpuLoad), output: attrValue(a, ATTR.cpuOutput) },
    power: { load: attrValue(a, ATTR.powerLoad), output: attrValue(a, ATTR.powerOutput) },
    calibration: { load: calibrationLoad, output: attrValue(a, ATTR.upgradeCapacity) },
    cap: {
      capacity: attrValue(a, ATTR.capacitorCapacity),
      rechargeRate: attrValue(a, ATTR.rechargeRate) / 1000,
      peakDelta: attrValue(a, ATTR.capacitorPeakDelta),
      depletesIn: attrValue(a, ATTR.capacitorDepletesIn),
    },
    nonFit,
    benchedDrones,
    hullAttributes: allAttributes(a),
    hullOwnAttributes: hullOwn,
    summary: summarize(result as unknown as EngineResult),
    simWeapons: simWeapons(result as unknown as EngineResult),
    resonance: resonanceLayers(result as unknown as EngineResult),
    defenses: defensesOf(result as unknown as EngineResult),
    ...(() => {
      const proj = projectedCycles(result as unknown as EngineResult);
      const burst = commandBursts(result as unknown as EngineResult);
      return {
        projected: proj.projected,
        projRefused: [...proj.refused, ...burst.notes],
        bursts: burst.bursts,
      };
    })(),
    droneControlRangeM: (() => {
      const ca = result.char?.attributes;
      if (!ca) return null;
      const e = ca instanceof Map ? ca.get(458) as { value?: number | null; base_value?: number } | undefined
        : (ca as Record<string, { value?: number | null; base_value?: number }>)[String(458)];
      const v = e?.value ?? e?.base_value;
      return typeof v === 'number' && Number.isFinite(v) ? v : null;
    })(),
    // the scram filter, read the way the scram itself reads it: an active
    // module whose requiredSkill1 (attr 182) is 3454 High Speed Maneuvering
    mwdFitted: result.items.some((it) => {
      const st = (it.state ?? '').toLowerCase();
      if (st !== 'active' && st !== 'overload') return false;
      const attrs = it.attributes;
      const get = (k: number): number | undefined => {
        const e = attrs instanceof Map
          ? attrs.get(k) as { value?: number | null; base_value?: number } | undefined
          : (attrs as Record<string, { value?: number | null; base_value?: number }>)?.[String(k)];
        const v = e?.value ?? e?.base_value;
        return typeof v === 'number' ? v : undefined;
      };
      return get(182) === 3454;
    }),
  };
}
