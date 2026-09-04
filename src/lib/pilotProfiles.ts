// WHO IS FLYING IT — the three pilots a fit can be scored as.
//
//   character — this player's actual trained skills and worn implants
//   optimal   — every skill at V
//   minimum   — exactly the prerequisites, at exactly their required levels,
//               and nothing else: "can I legally undock this at all?"
//
// The gap between the last two is the question worth asking on both sides of a
// fight: what does the fit do for someone who has barely earned it, versus
// someone who has everything?
//
// TWO THINGS THE ENGINE WILL NOT DO FOR US, both measured:
//   · It NEVER refuses a fit the pilot cannot legally fly. A hull with its
//     racial skill at 0 returns the same max_state as one at V, so "you cannot
//     undock this" has to be our own judgement, not an engine error.
//   · An ABSENT skill key is not level 0 — the SDE assumes 1. Every profile is
//     therefore padded across all of `allSkills`, which is what dogmaStats
//     already does for characters.
import { allSkills, skillInfo, type ParsedFit } from './skillRelevance';
import type { EsfDataShapes } from './dogmaFit';

export type ProfileKind = 'character' | 'optimal' | 'minimum';

export const PROFILE_LABEL: Record<ProfileKind, string> = {
  character: 'this character',
  optimal: 'all skills V',
  minimum: 'bare minimum',
};

/**
 * requiredSkillN → its level attribute. THE PAIRING INTERLEAVES: 1289
 * (requiredSkill5) takes its level from 1287, and 1290 (requiredSkill6) from
 * 1288. Getting those two backwards would silently mis-state the entry bar on
 * exactly the highest-investment hulls in the game — T3s, carriers, FAXes.
 * Slot 6 has zero occurrences in the shipped bundle; it is handled anyway.
 */
const REQ_PAIRS: [number, number][] = [
  [182, 277], [183, 278], [184, 279], [1285, 1286], [1289, 1287], [1290, 1288],
];

const attrOf = (data: EsfDataShapes, typeId: number, attrId: number): number | undefined =>
  data.typeDogma[String(typeId)]?.dogmaAttributes.find((a) => a.attributeID === attrId)?.value;

/** the skills this ONE type declares directly, as [skillId, level] */
export function directRequirements(data: EsfDataShapes, typeId: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [skillAttr, levelAttr] of REQ_PAIRS) {
    const skill = Math.round(attrOf(data, typeId, skillAttr) ?? 0);
    if (skill > 0) out.push([skill, Math.round(attrOf(data, typeId, levelAttr) ?? 1)]);
  }
  return out;
}

export interface SkillRequirement {
  skillId: number;
  name: string;
  level: number;
  /** what asked for it — the hull, a module, or another skill */
  because: string;
}

export interface MinimumProfile {
  skills: Record<number, number>;
  requirements: SkillRequirement[];
  /** fit types the bundle has no dogma for — the profile is NOT trustworthy
   * when this is non-empty, because a missing type simply requires nothing */
  unresolved: string[];
}

/**
 * The transitive closure of everything a fit demands, at the highest level any
 * requirer asks for.
 *
 * TERMINATION DOES NOT DEPEND ON THE GRAPH BEING ACYCLIC, and that matters:
 * decoding the shipped bundle finds two self-referencing skills, Polaris and
 * Omnipotent (both GM-only), each listing ITSELF as its own prerequisite. A
 * naive walk hangs on them. Here a skill is recursed into at most once —
 * `seen` is checked before descending — so any graph terminates. Levels still
 * settle correctly because a prerequisite edge is a property of the skill, not
 * of the level being demanded.
 */
export function minimumProfile(fit: ParsedFit, data: EsfDataShapes): MinimumProfile {
  const need = new Map<number, { level: number; because: string }>();
  const seen = new Set<number>();
  const unresolved: string[] = [];
  const nameOf = (id: number) => data.types[String(id)]?.name ?? `#${id}`;

  const demand = (skillId: number, level: number, because: string) => {
    const cur = need.get(skillId);
    if (cur === undefined || level > cur.level) {
      need.set(skillId, { level: Math.max(1, Math.min(5, level)), because });
    }
    if (seen.has(skillId)) return; // ← the loop guard; see the note above
    seen.add(skillId);
    for (const [pre, lvl] of directRequirements(data, skillId)) {
      if (pre === skillId) continue; // Polaris / Omnipotent require themselves
      demand(pre, lvl, nameOf(skillId));
    }
  };

  const consider = (typeId: number, label: string) => {
    if (!data.typeDogma[String(typeId)]) {
      unresolved.push(label);
      return;
    }
    for (const [skillId, level] of directRequirements(data, typeId)) demand(skillId, level, label);
  };

  if (fit.shipId !== null) consider(fit.shipId, fit.shipName || 'the hull');
  for (const item of fit.items) consider(item.typeId, item.name);

  // padded across EVERY skill: an absent key means level 1 to the SDE, which
  // would quietly hand the "bare minimum" pilot a level it has not earned
  const skills: Record<number, number> = {};
  for (const s of allSkills) skills[s.id] = 0;
  for (const [id, v] of need) skills[id] = v.level;

  const requirements = [...need.entries()]
    .map(([skillId, v]) => ({
      skillId,
      name: skillInfo(skillId)?.name ?? nameOf(skillId),
      level: v.level,
      because: v.because,
    }))
    .sort((a, b) => b.level - a.level || a.name.localeCompare(b.name));

  return { skills, requirements, unresolved };
}

/** every skill at V. Proven maximal: lowering any one of 511 skills improved
 * no displayed metric in 40,880 engine checks, so no relevance filter is
 * needed and none can be wrong. */
export function optimalSkills(): Record<number, number> {
  const skills: Record<number, number> = {};
  for (const s of allSkills) skills[s.id] = 5;
  return skills;
}

/** does this pilot meet every requirement the fit declares? The engine will
 * not tell us — it scores an unflyable fit happily. */
export function canFly(
  fit: ParsedFit, data: EsfDataShapes, skills: Record<number, number> | null,
): { ok: boolean; missing: SkillRequirement[] } {
  const { requirements } = minimumProfile(fit, data);
  const have = skills ?? {};
  const missing = requirements.filter((r) => (have[r.skillId] ?? 0) < r.level);
  return { ok: missing.length === 0, missing };
}
