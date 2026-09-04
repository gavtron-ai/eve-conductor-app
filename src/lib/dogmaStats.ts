// REAL fitting statistics via the vendored EVEShip.fit dogma engine (MIT,
// built from EVEShipFit/dogma-engine v7.1.0 → src/vendor/dogma-engine) and
// its release-tagged SDE protobuf bundle (src/data/esf, see build:esfdata).
//
// The engine is the same four-pass dogma evaluation eveship.fit runs in
// production: every attribute of hull+modules+charges+drones computed with
// the character's ACTUAL skill levels, stacking penalties included, plus a
// tick-by-tick capacitor simulation (stable, or seconds until dry).
//
// INTEGRITY GATE: if the engine, data, or any fit item fails to load or
// resolve, callers get an error — never a number computed from a partial
// fit (RULES #3). Pure conversion/extraction lives in dogmaFit.ts so node
// fixtures exercise the exact shipped logic.
import protobuf from 'protobufjs';
import initWasm, { init as dogmaInit, calculate as dogmaCalculate } from '../vendor/dogma-engine/esf_dogma_engine';
import wasmUrl from '../vendor/dogma-engine/esf_dogma_engine_bg.wasm?url';
import protoText from '../data/esf/esf.proto?raw';
import typesUrl from '../data/esf/types.pb2?url';
import typeDogmaUrl from '../data/esf/typeDogma.pb2?url';
import dogmaEffectsUrl from '../data/esf/dogmaEffects.pb2?url';
import dogmaAttributesUrl from '../data/esf/dogmaAttributes.pb2?url';
import groupsUrl from '../data/esf/groups.pb2?url';
import marketGroupsUrl from '../data/esf/marketGroups.pb2?url';
import esfVersion from '../data/esf/esf-version.json';
import { allSkills, type ParsedFit } from './skillRelevance';
import { toEsfFit, extractStats, SLOT_EFFECT, withPropModulesOff, withResistHardenersOff, withModuleStates, withModuleCharges, withModuleSwaps, type FitStats, type EsfDataShapes, type CalcResultShape, type EsfFitShape, type ModuleState } from './dogmaFit';
import dogmaLicense from '../vendor/dogma-engine/LICENSE?raw';
import { calcInWorker, WORKER_UNAVAILABLE } from './dogmaClient';
import { logWarn } from './devlog';
import { normalizeRealPod, SKILL_CYBERNETICS, type ImplantLookup } from './implants';

/** MIT notice for the vendored engine — must ship with the app */
export const DOGMA_ENGINE_LICENSE: string = dogmaLicense;

export type { FitStats } from './dogmaFit';

export const ESF_DATA_TAG: string = (esfVersion as { tag: string }).tag;

/** the full loaded catalog — engine shapes plus the browse metadata the
 * Fit Wizard's trees need (market hierarchy, group names, faction ids on
 * the decoded type objects) */
export interface EsfCatalog extends EsfDataShapes {
  marketGroups: Record<string, { name: string; parentGroupID?: number }>;
  groups: Record<string, { name: string; categoryID: number }>;
  /** effect definitions — the wizard needs effectCategory to know which
   * modules can be overheated */
  dogmaEffects: Record<string, { effectCategory?: number }>;
}

interface EsfData extends EsfCatalog {
  dogmaAttributes: Record<string, { name: string }>;
  attrIdByName: Map<string, number>;
}

declare global {
  interface Window {
    get_dogma_attributes?: unknown;
    get_dogma_attribute?: unknown;
    get_dogma_effects?: unknown;
    get_dogma_effect?: unknown;
    get_type?: unknown;
    type_name_to_id?: unknown;
    attribute_name_to_id?: unknown;
  }
}

let ready: Promise<EsfData> | null = null;

async function fetchPb(url: string, root: protobuf.Root, message: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${message}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const decoded = root.lookupType(message).decode(buf) as unknown as { entries: Record<string, unknown> };
  return decoded.entries;
}

async function load(): Promise<EsfData> {
  const root = protobuf.parse(protoText).root;
  const [types, typeDogma, dogmaAttributes, dogmaEffects, groups, marketGroups] = await Promise.all([
    fetchPb(typesUrl, root, 'esf.Types'),
    fetchPb(typeDogmaUrl, root, 'esf.TypeDogma'),
    fetchPb(dogmaAttributesUrl, root, 'esf.DogmaAttributes'),
    fetchPb(dogmaEffectsUrl, root, 'esf.DogmaEffects'),
    fetchPb(groupsUrl, root, 'esf.Groups'),
    fetchPb(marketGroupsUrl, root, 'esf.MarketGroups'),
  ]);
  const data = {
    types, typeDogma, dogmaAttributes, dogmaEffects, groups, marketGroups,
    attrIdByName: new Map(
      Object.entries(dogmaAttributes).map(([id, a]) => [(a as { name: string }).name, Number(id)]),
    ),
  } as EsfData;

  // the WASM's data callbacks (contract from EVEShipFit/dogma-engine wasm/mod.rs)
  window.get_dogma_attributes = (typeId: number) => data.typeDogma[typeId]?.dogmaAttributes ?? [];
  window.get_dogma_attribute = (attrId: number) => data.dogmaAttributes[attrId];
  window.get_dogma_effects = (typeId: number) => data.typeDogma[typeId]?.dogmaEffects ?? [];
  window.get_dogma_effect = (effectId: number) => data.dogmaEffects[effectId];
  window.get_type = (typeId: number) => data.types[typeId];
  window.type_name_to_id = (name: string) => {
    for (const [id, t] of Object.entries(data.types)) if (t.name === name) return Number(id);
    return undefined;
  };
  window.attribute_name_to_id = (name: string) => data.attrIdByName.get(name);

  await initWasm(wasmUrl);
  dogmaInit();
  return data;
}

/** the loaded data bundle in its shared shape — the Fit Wizard reads slot
 * layouts, module categories, and browse trees from it */
export async function getEsfData(): Promise<EsfCatalog> {
  return ensureDogma();
}

export function ensureDogma(): Promise<EsfData> {
  ready ??= load().catch((e: unknown) => {
    ready = null; // allow retry after a transient failure
    throw e;
  });
  return ready;
}

/** every dogma attribute id present anywhere in the fit (hull + items) —
 * feeds relevantForFit's "the fit must HAVE the attribute a fit-wide skill
 * modifies" filter. ZERO-valued attributes don't count: CCP stamps all four
 * sensor-strength attrs on every hull with three at 0, and boosting a zero
 * stays zero (a Stormbringer is Gravimetric; the other three Compensation
 * skills do nothing for it). */
export async function fitAttributeSets(fit: ParsedFit): Promise<Map<number, Set<number>>> {
  const data = await ensureDogma();
  const out = new Map<number, Set<number>>();
  const addType = (typeId: number) => {
    if (out.has(typeId)) return;
    const set = new Set<number>();
    for (const a of data.typeDogma[typeId]?.dogmaAttributes ?? []) {
      if (a.value !== 0) set.add(a.attributeID);
    }
    out.set(typeId, set);
  };
  if (fit.shipId !== null) addType(fit.shipId);
  for (const i of fit.items) {
    const t = data.types[i.typeId];
    const td = data.typeDogma[i.typeId];
    if (!t || !td) continue;
    // ONLY things that are part of the flown fit: slotted modules, charges
    // (ammo), drones. A Mobile Tractor Unit in cargo carries all four
    // sensor strengths — it must not make Radar Compensation "relevant"
    const slotted = td.dogmaEffects.some((e) => SLOT_EFFECT[e.effectID] !== undefined);
    if (slotted || t.categoryID === 8 || t.categoryID === 18) addType(i.typeId);
  }
  return out;
}

/**
 * Same calculation, but from an ALREADY-BUILT engine fit — the Fit Wizard
 * uses this so module run states (offline/online/active/overheated) survive;
 * EFT text cannot express overheating.
 */
export interface CalcOpts {
  /** false = simulate with propulsion modules ONLINE but not cycling. Default
   * true, which is what every fit has always been scored as — the toggle is
   * opt-in so no existing number moves without the user asking. */
  propRunning?: boolean;
  /** per-module run state, keyed by dogmaFit.moduleKey ("High3", "Low1", …).
   * Applied AFTER the prop-mod pass, so an explicit choice always wins. */
  moduleStates?: Record<string, ModuleState>;
  /** per-SLOT charge, keyed the same way. Three tracking computers are three
   * separate script decisions, not one. */
  moduleCharges?: Record<string, number | null>;
  /** true = simulate with the active resist hardeners ONLINE but not cycling
   * — the "hardeners dry" resonance the battle sim swaps to when the
   * capacitor can no longer feed them. Same semantics as propRunning. */
  resistHardenersOff?: boolean;
  /** replace the module in a slot, or empty it. Applied FIRST, because states
   * and charges are keyed by slot and describe whatever ends up there. */
  moduleSwaps?: Record<string, number | null>;
}

export async function calculateFromEsfFit(
  esfFit: EsfFitShape,
  charSkills: Record<number, number> | null,
  charImplants: number[] | null = null,
  /** drones the CALLER already benched (it built the fit, so only it knows) —
   * without this the wizard's panel could never show the "not counted" note */
  benchedDrones: string[] = [],
  opts: CalcOpts = {},
): Promise<FitStats> {
  const data = await ensureDogma();
  const missing: string[] = [];
  const check = (id: number) => { if (!data.typeDogma[id] || !data.types[id]) missing.push(String(id)); };
  check(esfFit.ship_type_id);
  for (const m of esfFit.modules) { check(m.type_id); if (m.charge) check(m.charge.type_id); }
  for (const d of esfFit.drones) check(d.type_id);
  for (const id of charImplants ?? []) check(id);
  if (missing.length > 0) throw new Error(`no dogma data for type id(s): ${missing.join(', ')}`);
  const skills: Record<string, number> = {};
  for (const s of allSkills) skills[String(s.id)] = charSkills?.[s.id] ?? 0;
  // ONE GATE for every surface: the engine happily stacks two implants in the
  // same slot and ignores Cybernetics entirely, so a pod is made legal here or
  // the numbers describe a loadout nobody can wear.
  const legalPod = normalizeRealPod(
    charImplants ?? [], data as unknown as ImplantLookup,
    charSkills?.[SKILL_CYBERNETICS] ?? null, 'fit wizard',
  );
  const swapped = withModuleSwaps(esfFit, opts.moduleSwaps);
  const proped = opts.propRunning === false ? withPropModulesOff(swapped, data) : swapped;
  const posed = withModuleCharges(withModuleStates(
    opts.resistHardenersOff ? withResistHardenersOff(proped, data) : proped,
    opts.moduleStates,
  ), opts.moduleCharges);
  const withImplants = { ...posed, implants: legalPod };
  const hullOwnIds = (data.typeDogma[esfFit.ship_type_id]?.dogmaAttributes ?? []).map((a) => a.attributeID);
  return runEngine(withImplants, skills, hullOwnIds, benchedDrones, []);
}

/**
 * Full dogma calculation for one character. skills = the character's synced
 * levels; every known skill is passed explicitly (untrained = 0) because the
 * SDE otherwise assumes level 1. implants = the character's synced plugged-in
 * implant type-ids (they move the OUTPUT numbers — a +3% CPU hardwiring is
 * the difference between a fit closing and not).
 */
export async function calculateFitStats(
  fit: ParsedFit,
  charSkills: Record<number, number> | null,
  charImplants: number[] | null = null,
  opts: CalcOpts = {},
): Promise<FitStats> {
  const data = await ensureDogma();
  const built = toEsfFit(fit, data);
  const { nonFit, missingData, benchedDrones } = built;
  const swapped = withModuleSwaps(built.esfFit, opts.moduleSwaps);
  const proped = opts.propRunning === false ? withPropModulesOff(swapped, data) : swapped;
  const esfFit = withModuleCharges(withModuleStates(
    opts.resistHardenersOff ? withResistHardenersOff(proped, data) : proped,
    opts.moduleStates,
  ), opts.moduleCharges);
  if (missingData.length > 0) {
    // a number computed from a partial fit is a lie — refuse instead
    throw new Error(`no dogma data for: ${missingData.join(', ')}`);
  }
  // implants the data bundle doesn't know would panic inside the wasm
  const unknownImplants = (charImplants ?? []).filter((id) => !data.typeDogma[id] || !data.types[id]);
  if (unknownImplants.length > 0) {
    throw new Error(`no dogma data for implant id(s): ${unknownImplants.join(', ')}`);
  }
  esfFit.implants = normalizeRealPod(
    charImplants ?? [], data as unknown as ImplantLookup,
    charSkills?.[SKILL_CYBERNETICS] ?? null, fit.shipName || 'fit',
  );
  const skills: Record<string, number> = {};
  for (const s of allSkills) skills[String(s.id)] = charSkills?.[s.id] ?? 0;
  const hullOwnIds = (fit.shipId !== null ? data.typeDogma[fit.shipId]?.dogmaAttributes ?? [] : [])
    .map((a) => a.attributeID);
  return runEngine(esfFit, skills, hullOwnIds, benchedDrones, nonFit);
}


/**
 * ONE PLACE where a fit meets the engine.
 *
 * Prefers the Web Worker — 22-30 ms of synchronous wasm per call is a dropped
 * frame on the renderer thread, and the sweeps (Make It Fit, ammo comparison,
 * the implant search) run hundreds of calls back to back. Falls back to the
 * in-process engine if the worker is unavailable, so a packaging or sandbox
 * change degrades performance instead of removing the feature.
 *
 * `nonFit` is applied on THIS side: the worker is told nothing about which
 * items were excluded as cargo, because that is a property of how the caller
 * built the fit, not of the calculation.
 */
async function runEngine(
  esfFit: EsfFitShape,
  skills: Record<string, number>,
  hullOwnIds: number[],
  benchedDrones: string[],
  nonFit: string[],
): Promise<FitStats> {
  try {
    const stats = await calcInWorker(esfFit, skills, hullOwnIds, benchedDrones);
    return nonFit.length > 0 ? { ...stats, nonFit } : stats;
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    if (msg !== WORKER_UNAVAILABLE) {
      // a real calculation error from inside the worker — do NOT silently
      // recompute it on the main thread, it would fail identically
      throw e;
    }
    logWarn('dogma', 'no worker — scoring this fit on the main thread');
    const result = dogmaCalculate(esfFit, skills) as CalcResultShape;
    return extractStats(result, nonFit, new Set(hullOwnIds), benchedDrones);
  }
}
