// "MAKE IT FIT" — the fit does not fit; what is the CHEAPEST way to fix it?
//
// A different question from the gap sweep in fitGap.ts. That one asks "what
// does the other character have that I don't". This one asks "this fit is
// over CPU (or power, or calibration) FOR ME — what do I actually have to
// do?", and answers in the order a player would rather hear it:
//
//   1. TRAIN SKILLS      — free, permanent, and helps every future fit
//   2. ONE IMPLANT       — costs ISK, so the CHEAPEST grade that works
//   3. IMPLANT + SKILLS  — when neither alone is enough
//   4. CHANGE THE FIT    — nothing available closes it, and saying so plainly
//                          is more useful than a plan that cannot work
//
// EVERY ANSWER IS MEASURED through the same dogma engine as the fit itself.
// Nothing here is estimated from a percentage: a remedy is only reported once
// running the fit WITH that remedy applied actually produces enough headroom.
// That matters because stacking penalties mean the sum of individual gains is
// not the gain of the combination — quoting the sum would be exactly the
// plausible-but-wrong number this project keeps banning.
import { calculateFitStats, calculateFromEsfFit, getEsfData } from './dogmaStats';
import { allSkills, skillInfo, skillModAttrs, extraTypeName, type ParsedFit } from './skillRelevance';
import { getType } from './typedb';
import { isAncillary } from './ancillaryTypes';
import type { EsfFitShape, FitStats } from './dogmaFit';
import { headroom, RESOURCE_ATTRS, RESOURCE_UNIT, type ResourceKey, type GapSkill } from './fitGap';
import { implantSlot, cyberneticsFor, type ImplantLookup } from './implants';

/**
 * Attributes that make an implant a FITTING implant for a resource. Each was
 * confirmed by decoding the bundle and listing the published implants that
 * carry it — NOT from the attribute name reading plausibly:
 *   424 `cpuOutputBonus2`             → Zainou 'Gypsy' CPU Management EE-6xx
 *   313 `powerEngineeringOutputBonus` → Inherent 'Squire' Power Grid EG-6xx
 *   1079 `capacitorCapacityBonus`     → Inherent 'Squire' Capacitor EM-8xx
 * (Genolution Core Augmentation CA-1/CA-2 carry several of these at 1.5.)
 *
 * `cap` was 312 here, which is `durationSkillBonus` — carried by exactly ONE
 * published implant line, Inherent 'Noble' Repair Systems RS-6xx, whose values
 * are NEGATIVE because it shortens an armour repairer's cycle. It adds no
 * capacitor whatsoever, so a fit that ran dry was being offered repair-cycle
 * implants that could not possibly fix it.
 */
const IMPLANT_BONUS_ATTR: Partial<Record<ResourceKey, number[]>> = {
  cpu: [424],
  power: [313],
  cap: [1079],
};
/** Cybernetics — every fitting implant requires it at some level.
 * Slot lookup and the (six-slot) Cybernetics check now live in lib/implants.ts
 * so this file and the Battle Sim cannot drift apart on what a pod can hold. */
const SKILL_CYBERNETICS = 3411;
const ATTR_IMPLANTNESS = 331;

export interface FitFixImplant {
  typeId: number;
  name: string;
  /** the % bonus it carries — "lowest required" means the smallest of these */
  bonus: number;
  /** Cybernetics level it needs, and whether this character has it */
  needsCybernetics: number;
  hasCybernetics: boolean;
  /** an implant of theirs this would displace — a slot holds exactly one */
  replaces?: { typeId: number; name: string };
}

export interface FitFix {
  resource: ResourceKey;
  unit: string;
  /** how short the fit is right now, as a positive number */
  shortBy: number;
  kind: 'skills' | 'implant' | 'implant+skills' | 'impossible';
  /** skills to train to V (kinds 'skills' and 'implant+skills') */
  skills: GapSkill[];
  /** the implant to plug in (kinds 'implant' and 'implant+skills') */
  implant?: FitFixImplant;
  /** the headroom the remedy actually produced, measured */
  resulting: number;
  /** one sentence for the UI */
  summary: string;
}

export interface FixOpts {
  fit?: ParsedFit;
  esfFit?: EsfFitShape;
  /** THIS character's skills — only what they can actually change */
  mine: Record<number, number>;
  myImplants: number[] | null;
  resource: ResourceKey;
  /** return true to abandon the search (the user moved on) */
  cancelled?: () => boolean;
}

const run = (o: FixOpts, skills: Record<number, number>, implants?: number[] | null): Promise<FitStats> => {
  const imp = implants === undefined ? o.myImplants : implants;
  return o.esfFit
    ? calculateFromEsfFit(o.esfFit, skills, imp)
    : calculateFitStats(o.fit!, skills, imp);
};

const implantName = (id: number): string =>
  getType(id)?.name ?? extraTypeName(id) ?? `implant #${id}`;

async function implantSlots(ids: number[]): Promise<Map<number, number | null>> {
  const out = new Map<number, number | null>();
  try {
    const data = await getEsfData();
    for (const id of ids) {
      const v = data.typeDogma[String(id)]?.dogmaAttributes
        .find((a) => a.attributeID === ATTR_IMPLANTNESS)?.value;
      out.set(id, v === undefined ? null : Math.round(v));
    }
  } catch {
    for (const id of ids) out.set(id, null);
  }
  return out;
}

/** every fitting implant for a resource, CHEAPEST BONUS FIRST — the user
 * asked for the "lowest required implant", and a +1% hardwiring costs a
 * fraction of a +6% */
async function fittingImplants(resource: ResourceKey): Promise<
  { typeId: number; bonus: number; reqLevel: number; slot: number }[]
> {
  const attrs = IMPLANT_BONUS_ATTR[resource];
  if (!attrs) return [];
  const out: { typeId: number; bonus: number; reqLevel: number; slot: number }[] = [];
  try {
    const data = await getEsfData();
    const lookup = data as unknown as ImplantLookup;
    for (const [idStr, td] of Object.entries(data.typeDogma)) {
      const id = Number(idStr);
      // UNPUBLISHED types are not obtainable. Suggesting one as the fix for a
      // fit is advice the player cannot act on.
      if (!(data.types[idStr] as { published?: boolean } | undefined)?.published) continue;
      const slot = implantSlot(lookup, id);
      if (slot === undefined) continue;
      const a = td.dogmaAttributes as { attributeID: number; value: number }[];
      const bonus = a.find((x) => attrs.includes(x.attributeID))?.value;
      if (bonus === undefined || bonus <= 0) continue;
      // Cybernetics can be declared in ANY of the six requiredSkill slots —
      // checking only requiredSkill1 silently dropped candidates, and wrongly
      // admitted implants gated on something else entirely.
      out.push({ typeId: id, bonus, reqLevel: cyberneticsFor(lookup, id), slot });
    }
  } catch {
    return [];
  }
  // Smallest sufficient bonus first. NOT price order: the bundle carries no
  // prices and metaGroupID is 0 for every implant, so a special-edition
  // Genolution Core Augmentation (+1.5%) genuinely does sort below a Zainou
  // 'Gypsy' EE-602 (+2%) despite costing orders of magnitude more. The
  // popover therefore shows the bonus and slot and lets the player judge —
  // it does not claim to have found the cheapest one to buy.
  out.sort((a, b) => a.bonus - b.bonus);
  return out;
}

/**
 * How to make an over-budget fit fit, for ONE character and ONE resource.
 * Returns null when it already fits — there is nothing to solve.
 */
export async function makeItFit(o: FixOpts): Promise<FitFix | null> {
  const unit = RESOURCE_UNIT[o.resource];
  const base = headroom(await run(o, o.mine), o.resource);
  if (base >= 0) return null;
  const shortBy = -base;
  const EPS = 1e-6;
  const mineImplants = o.myImplants ?? [];

  // candidate skills: THIS character's, below V, that touch this resource
  const watched = new Set(RESOURCE_ATTRS[o.resource]);
  const trainable = allSkills
    .map((s) => ({ id: s.id, from: o.mine[s.id] ?? 0 }))
    .filter((g) => g.from < 5)
    .filter((g) => skillModAttrs(g.id).some((a) => watched.has(a)));

  // one run with EVERY candidate at V: the ceiling training can reach, and a
  // cheap way to rule tier 1 out without sweeping at all
  const allTrained: Record<number, number> = { ...o.mine };
  for (const g of trainable) allTrained[g.id] = 5;
  const skillCeiling = trainable.length > 0
    ? headroom(await run(o, allTrained), o.resource)
    : base;

  /** measure each candidate on its own, against a given implant set */
  const measure = async (implants?: number[]): Promise<GapSkill[]> => {
    const rows: GapSkill[] = [];
    const baseHere = headroom(await run(o, o.mine, implants), o.resource);
    for (const g of trainable) {
      if (o.cancelled?.()) break;
      const gain = headroom(await run(o, { ...o.mine, [g.id]: 5 }, implants), o.resource) - baseHere;
      if (gain > EPS) {
        rows.push({ skillId: g.id, name: skillInfo(g.id)?.name ?? `Skill #${g.id}`, from: g.from, to: 5, gain });
      }
    }
    return rows.sort((a, b) => b.gain - a.gain);
  };

  /** the SMALLEST set that actually closes the gap — greedy by measured gain,
   * then CONFIRMED by running the fit with exactly that set trained */
  const smallestSet = async (
    rows: GapSkill[], implants?: number[],
  ): Promise<{ set: GapSkill[]; got: number } | null> => {
    const chosen: GapSkill[] = [];
    const skills: Record<number, number> = { ...o.mine };
    for (const r of rows) {
      if (o.cancelled?.()) break;
      chosen.push(r);
      skills[r.skillId] = 5;
      const got = headroom(await run(o, skills, implants), o.resource);
      if (got >= 0) return { set: [...chosen], got };
    }
    return null;
  };

  // ---- TIER 1: training alone -------------------------------------------
  if (skillCeiling >= 0) {
    const best = await smallestSet(await measure());
    if (best) {
      return {
        resource: o.resource, unit, shortBy, kind: 'skills', skills: best.set, resulting: best.got,
        summary: best.set.length === 1
          ? `Train ${best.set[0].name} to V`
          : `Train to V: ${best.set.map((s) => s.name).join(', ')}`,
      };
    }
  }

  // ---- TIER 2: one implant, the cheapest that works ----------------------
  const implants = await fittingImplants(o.resource);
  const slots = implants.length > 0
    ? await implantSlots([...new Set([...mineImplants, ...implants.map((i) => i.typeId)])])
    : new Map<number, number | null>();

  /** plugging one in DISPLACES whatever occupies its slot */
  const withImplant = (typeId: number) => {
    const slot = slots.get(typeId) ?? null;
    const displaced = slot === null ? undefined : mineImplants.find((m) => slots.get(m) === slot);
    return {
      list: [...mineImplants.filter((m) => m !== displaced), typeId],
      replaces: displaced === undefined ? undefined : { typeId: displaced, name: implantName(displaced) },
    };
  };

  const cyber = o.mine[SKILL_CYBERNETICS] ?? 0;
  let strongest: { i: (typeof implants)[number]; swap: ReturnType<typeof withImplant> } | null = null;

  for (const i of implants) {
    if (o.cancelled?.()) break;
    const swap = withImplant(i.typeId);
    let got: number;
    try {
      got = headroom(await run(o, o.mine, swap.list), o.resource);
    } catch {
      continue; // no dogma data for it — skip, never count as zero
    }
    if (got >= 0) {
      return {
        resource: o.resource, unit, shortBy, kind: 'implant', skills: [], resulting: got,
        implant: {
          typeId: i.typeId, name: implantName(i.typeId), bonus: i.bonus,
          needsCybernetics: i.reqLevel, hasCybernetics: cyber >= i.reqLevel,
          replaces: swap.replaces,
        },
        summary: `Plug in ${implantName(i.typeId)}${swap.replaces ? ` (replaces ${swap.replaces.name})` : ''}`,
      };
    }
    if (!strongest || i.bonus > strongest.i.bonus) strongest = { i, swap };
  }

  // ---- TIER 3: the strongest implant AND training ------------------------
  if (strongest && trainable.length > 0 && !o.cancelled?.()) {
    const best = await smallestSet(await measure(strongest.swap.list), strongest.swap.list);
    if (best) {
      const i = strongest.i;
      return {
        resource: o.resource, unit, shortBy, kind: 'implant+skills', skills: best.set, resulting: best.got,
        implant: {
          typeId: i.typeId, name: implantName(i.typeId), bonus: i.bonus,
          needsCybernetics: i.reqLevel, hasCybernetics: cyber >= i.reqLevel,
          replaces: strongest.swap.replaces,
        },
        summary: `${implantName(i.typeId)} + train ${best.set.map((s) => s.name).join(', ')} to V`,
      };
    }
  }

  // ---- TIER 4: it cannot be trained or implanted into fitting -------------
  return {
    resource: o.resource, unit, shortBy, kind: 'impossible', skills: [],
    resulting: Math.max(skillCeiling, base),
    summary: 'Nothing closes this — the fit itself has to change',
  };
}

// ===========================================================================
// WHICH RESOURCES ACTUALLY STOP THIS FIT WORKING
//
// Not the same as "the bar is past 100%". CPU, powergrid and calibration are
// HARD limits: over them, the fit does not go on the ship at all. Capacitor
// is not — a cap-unstable fit is flown deliberately every day, and treating
// instability as a fitting failure would put a wrench on almost every combat
// fit in the game and train the user to ignore it.
//
// Capacitor only counts when the fit genuinely runs DRY, and even then only
// when the verdict is trustworthy: an Ancillary Shield Booster with no
// charges loaded drains capacitor that a charged one would not touch, and a
// Capacitor Booster with no charges injects nothing. Judging cap from an
// unloaded fit measures the loadout, not the fit. So if there are ancillary
// modules and any of them is empty, cap is reported as UNKNOWN rather than
// broken.
// ===========================================================================

export interface CapVerdict {
  /** the fit runs dry AND the reading can be trusted */
  runsDry: boolean;
  /** ancillary modules present that have no charges loaded */
  unloaded: string[];
  /** true when we decline to judge cap because of the above */
  unknown: boolean;
}

/**
 * Is capacitor a real problem for this fit? `groupOf` resolves a type id to
 * its inventory group (injected so this stays testable without the catalog).
 */
export function capacitorVerdict(stats: FitStats, fit: ParsedFit | undefined): CapVerdict {
  const ancillaries = (fit?.items ?? []).filter((i) => isAncillary(i.typeId));
  // a module is "loaded" when the parsed fit gave it at least one charge
  const unloaded = ancillaries.filter((i) => (i.charges ?? []).length === 0).map((i) => i.name);

  // depletesIn < 0 is the engine's "stable" sentinel
  const dry = stats.cap.depletesIn >= 0;
  if (!dry) return { runsDry: false, unloaded, unknown: false };
  if (unloaded.length > 0) return { runsDry: false, unloaded, unknown: true };
  return { runsDry: true, unloaded, unknown: false };
}

/** the resources that genuinely stop this fit working, worst first */
export function fittingProblems(
  stats: FitStats,
  fit: ParsedFit | undefined,
): { resources: ResourceKey[]; cap: CapVerdict } {
  const out: ResourceKey[] = [];
  // HARD limits — over these the fit cannot be fitted at all
  for (const r of ['cpu', 'power', 'calibration'] as const) {
    if (headroom(stats, r) < 0) out.push(r);
  }
  const cap = capacitorVerdict(stats, fit);
  if (cap.runsDry) out.push('cap');
  return { resources: out, cap };
}
