// "WHY DOES THIS FIT GO ON THEIR CHARACTER AND NOT MINE?"
//
// Given two characters and one fit, work out which skills the OTHER
// character has that would actually fix this character's CPU / powergrid /
// calibration / capacitor shortfall — and by how much.
//
// MEASURED, NOT GUESSED. Every number here comes from re-running the dogma
// engine with one skill raised to the other character's level and reading
// the resource back. No table of "skills that affect CPU", no assumption
// about how a bonus applies: if the engine says the headroom moved, it
// moved.
//
// THE ONE THING THAT WOULD BE A LIE, stated in the UI rather than hidden:
// these per-skill gains DO NOT ADD UP. EVE stacking-penalises multiple
// bonuses to the same attribute, so training two skills yields less than
// the sum of their individual gains. That is why the total for training
// everything is measured separately instead of summed.
import { allSkills, skillInfo, skillModAttrs, extraTypeName } from './skillRelevance';
import type { ParsedFit } from './skillRelevance';
import { calculateFitStats, calculateFromEsfFit, getEsfData } from './dogmaStats';
import type { FitStats, EsfFitShape } from './dogmaFit';
import { getType } from './typedb';

export type ResourceKey = 'cpu' | 'power' | 'calibration' | 'cap';

/** headroom, i.e. how much of the resource is SPARE. Bigger is always
 * better, for every resource — so a positive delta is always an improvement
 * and the UI never has to special-case a direction. */
export function headroom(s: FitStats, r: ResourceKey): number {
  switch (r) {
    case 'cpu': return s.cpu.output - s.cpu.load;
    case 'power': return s.power.output - s.power.load;
    case 'calibration': return s.calibration.output - s.calibration.load;
    // cap: GJ/s at the peak point. >= 0 is stable; more is better either way
    case 'cap': return s.cap.peakDelta;
  }
}

export const RESOURCE_UNIT: Record<ResourceKey, string> = {
  cpu: ' tf', power: ' MW', calibration: '', cap: ' GJ/s',
};

export const RESOURCE_LABEL: Record<ResourceKey, string> = {
  cpu: 'CPU', power: 'powergrid', calibration: 'calibration', cap: 'capacitor',
};

/**
 * Attributes that plausibly move each resource — used ONLY to shortlist
 * which of the other character's higher skills are worth an engine run.
 * Anything this misses still shows up in the measured total, which is why
 * the total is computed separately and the difference is reported rather
 * than swept under the rug.
 */
export const RESOURCE_ATTRS: Record<ResourceKey, number[]> = {
  // 48 cpuOutput (ship), 50 cpu (module draw), 49 cpuLoad
  cpu: [48, 50, 49],
  // 11 powerOutput, 30 power (module draw), 15 powerLoad
  power: [11, 30, 15],
  // 1132 upgradeCapacity, 1153 upgradeCost (per-rig)
  calibration: [1132, 1153],
  // 482 capacitorCapacity, 55 rechargeRate, 6 capacitorNeed (module draw)
  cap: [482, 55, 6],
};

export interface GapSkill {
  skillId: number;
  name: string;
  from: number;
  to: number;
  /** measured headroom improvement from raising JUST this skill */
  gain: number;
}

export interface GapImplant {
  typeId: number;
  name: string;
  /** implantness 1-10; null when the catalog hasn't loaded */
  slot: number | null;
  /** the implant of MINE this one would displace — an implant slot holds
   * exactly one, so "plug theirs in" really means "swap mine out", and
   * pretending otherwise would overstate the gain */
  replaces?: { typeId: number; name: string };
  gain: number;
}

export interface GapResult {
  /** skills that measurably help, biggest first */
  rows: GapSkill[];
  /** implants of theirs that measurably help, biggest first */
  implants: GapImplant[];
  /** headroom with THEIR WHOLE CLONE plugged in (own skills unchanged) —
   * the answer to "is it the clone rather than the training?" */
  theirClone: number | null;
  /** this character's headroom now */
  base: number;
  /** headroom if EVERY skill the other character has higher were trained —
   * measured in one run, NOT summed from the rows (stacking penalties) */
  bestPossible: number;
  /** how many of the other character's higher skills were tested */
  tested: number;
  /** higher skills that were NOT individually tested (no modifier rows for
   * this resource). They are still included in bestPossible. */
  untested: number;
  unit: string;
}

interface Opts {
  fit?: ParsedFit;
  esfFit?: EsfFitShape;
  mine: Record<number, number>;
  myImplants: number[] | null;
  theirs: Record<number, number>;
  theirImplants?: number[] | null;
  resource: ResourceKey;
  /** return true to abandon the sweep (the user moved on) */
  cancelled?: () => boolean;
}

const run = async (o: Opts, skills: Record<number, number>, implants?: number[] | null): Promise<FitStats> => {
  const imp = implants === undefined ? o.myImplants : implants;
  return o.esfFit
    ? calculateFromEsfFit(o.esfFit, skills, imp)
    : calculateFitStats(o.fit!, skills, imp);
};

/** dogma attr 331 "implantness" — which of the ten implant slots a type
 * occupies. A slot holds exactly one implant, which is what makes plugging
 * theirs in a SWAP rather than an addition. */
const ATTR_IMPLANTNESS = 331;
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

const implantName = (id: number): string =>
  getType(id)?.name ?? extraTypeName(id) ?? `implant #${id}`;

/**
 * Which of the other character's skills would fix this resource, measured
 * one at a time. Returns rows sorted by real gain.
 */
export async function fittingGapSkills(o: Opts): Promise<GapResult> {
  const unit = RESOURCE_UNIT[o.resource];
  const baseStats = await run(o, o.mine);
  const base = headroom(baseStats, o.resource);

  // every skill the other character has at a HIGHER level
  const gaps = allSkills
    .map((s) => ({ id: s.id, from: o.mine[s.id] ?? 0, to: o.theirs[s.id] ?? 0 }))
    .filter((g) => g.to > g.from);

  const implantResult = await implantGap(o, base);

  if (gaps.length === 0) {
    return { rows: [], base, bestPossible: base, tested: 0, untested: 0, unit, ...implantResult };
  }

  // ONE run with everything they have — the honest ceiling, and a cheap way
  // to answer "no skill of theirs helps here" without sweeping at all
  const allSkillsRaised: Record<number, number> = { ...o.mine };
  for (const g of gaps) allSkillsRaised[g.id] = g.to;
  const bestPossible = headroom(await run(o, allSkillsRaised), o.resource);

  const EPS = 1e-6;
  if (bestPossible - base <= EPS) {
    return { rows: [], base, bestPossible, tested: 0, untested: gaps.length, unit, ...implantResult };
  }

  const watched = new Set(RESOURCE_ATTRS[o.resource]);
  const candidates = gaps.filter((g) => skillModAttrs(g.id).some((a) => watched.has(a)));
  const rows: GapSkill[] = [];
  for (const g of candidates) {
    if (o.cancelled?.()) break;
    const s = await run(o, { ...o.mine, [g.id]: g.to });
    const gain = headroom(s, o.resource) - base;
    if (gain > EPS) {
      rows.push({ skillId: g.id, name: skillInfo(g.id)?.name ?? `Skill #${g.id}`, from: g.from, to: g.to, gain });
    }
  }
  rows.sort((a, b) => b.gain - a.gain);
  return {
    rows,
    base,
    bestPossible,
    tested: candidates.length,
    untested: gaps.length - candidates.length,
    unit,
    ...implantResult,
  };
}

/**
 * Which of the OTHER character's implants would help — measured the same
 * way, and modelled as a SWAP: an implant slot holds one implant, so
 * plugging theirs into an occupied slot displaces mine. Reporting the gain
 * as if both could coexist would overstate it, sometimes wildly (two CPU
 * hardwirings in slot 7).
 */
async function implantGap(o: Opts, base: number): Promise<{ implants: GapImplant[]; theirClone: number | null }> {
  const mine = o.myImplants ?? [];
  const theirs = o.theirImplants ?? [];
  if (theirs.length === 0) return { implants: [], theirClone: null };

  // what their whole clone would do for me — one run, and the answer to
  // "is it the clone rather than the training?"
  let theirClone: number | null = null;
  try {
    theirClone = headroom(await run(o, o.mine, theirs), o.resource);
  } catch {
    theirClone = null; // an implant the engine has no data for — say nothing
  }

  const candidates = theirs.filter((id) => !mine.includes(id));
  if (candidates.length === 0) return { implants: [], theirClone };

  const slots = await implantSlots([...new Set([...mine, ...candidates])]);
  const EPS = 1e-6;
  const rows: GapImplant[] = [];
  for (const id of candidates) {
    if (o.cancelled?.()) break;
    const slot = slots.get(id) ?? null;
    // a slot holds ONE implant: theirs displaces whatever of mine is there
    const displaced = slot === null ? undefined : mine.find((m) => slots.get(m) === slot);
    const swapped = [...mine.filter((m) => m !== displaced), id];
    try {
      const gain = headroom(await run(o, o.mine, swapped), o.resource) - base;
      if (gain > EPS) {
        rows.push({
          typeId: id,
          name: implantName(id),
          slot,
          replaces: displaced === undefined ? undefined : { typeId: displaced, name: implantName(displaced) },
          gain,
        });
      }
    } catch {
      // an implant with no dogma data is SKIPPED, never counted as zero
    }
  }
  rows.sort((a, b) => b.gain - a.gain);
  return { implants: rows, theirClone };
}
