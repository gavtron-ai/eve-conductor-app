// IMPLANTS, WITH SLOTS — the one place that knows what a pod can physically hold.
//
// THE ENGINE ENFORCES NOTHING. Measured against the shipped wasm:
//   · two implants in the same slot BOTH apply (162.5 → 175.695 CPU, i.e.
//     ×1.06 × 1.02 — a pod that cannot exist)
//   · the same implant passed twice applies twice
//   · Cybernetics 0 still receives a grade-5 hardwiring's full bonus
//   · a module, mineral or skill id passed as an implant is silently ignored
//
// So any code that hands implants to the engine — a character's real pod, or a
// candidate set from a search — has to be filtered HERE first, or it will
// print a number for a loadout nobody can wear. That was the "silly
// limitation" worth removing: the slot is right there in attribute 331.
//
// Decoded from the shipped bundle (837 published implants):
//   slots 1-10, populated 62/61/63/62/60/171/99/93/91/74
//   plus exactly ONE oddity — Genolution 'Auroral' AU-79 at implantness 79,
//   which is published, wearable, collides with nothing, and changes no number
//   (its dogmaEffects list is empty). It gets its own slot rather than being
//   rejected as out-of-range.
//   334 pieces belong to named SETS, and every one of them sits in slots 1-6.
//   836 of 837 require Cybernetics at level 1-5; AU-79 requires nothing.
import { logWarn } from './devlog';

export const ATTR_IMPLANTNESS = 331;
export const SKILL_CYBERNETICS = 3411;
/** requiredSkillN / requiredSkillNLevel — note the pairing is NOT sequential
 * for slots 5 and 6 (1287 is skill FIVE's level, 1288 is skill SIX's) */
const REQ_PAIRS: [number, number][] = [
  [182, 277], [183, 278], [184, 279], [1285, 1286], [1289, 1287], [1290, 1288],
];

export interface ImplantLookup {
  types: Record<string, { name: string; published?: boolean }>;
  typeDogma: Record<string, { dogmaAttributes: { attributeID: number; value: number }[] }>;
}

const attrOf = (data: ImplantLookup, typeId: number, attrId: number): number | undefined =>
  data.typeDogma[String(typeId)]?.dogmaAttributes.find((a) => a.attributeID === attrId)?.value;

/** which slot this implant occupies, or undefined if it is not an implant */
export function implantSlot(data: ImplantLookup, typeId: number): number | undefined {
  const v = attrOf(data, typeId, ATTR_IMPLANTNESS);
  return v === undefined ? undefined : Math.round(v);
}

export const isImplant = (data: ImplantLookup, typeId: number): boolean =>
  implantSlot(data, typeId) !== undefined;

/** the Cybernetics level this implant needs, or 0 if it needs none */
export function cyberneticsFor(data: ImplantLookup, typeId: number): number {
  for (const [skillAttr, levelAttr] of REQ_PAIRS) {
    if (Math.round(attrOf(data, typeId, skillAttr) ?? 0) === SKILL_CYBERNETICS) {
      return Math.round(attrOf(data, typeId, levelAttr) ?? 0);
    }
  }
  return 0;
}

export interface PodProblem {
  typeId: number;
  name: string;
  reason: string;
}

export interface NormalizedPod {
  /** the implants that may legally be worn together, in the given order */
  accepted: number[];
  /** what was dropped, and why — never silently discarded */
  rejected: PodProblem[];
}

/**
 * Reduce a list of implant ids to a pod that can physically exist.
 *
 * Order matters: the FIRST occupant of a slot wins, so a caller testing a
 * candidate implant puts it first and the displaced one is reported. A real
 * pod read from ESI should never collide; if it does, that is worth logging
 * rather than quietly resolving.
 *
 * `cybernetics` is the pilot's actual level. Pass null to skip the check —
 * meaningful only when scoring a hypothetical pilot who will train it.
 */
export function normalizePod(
  ids: readonly number[],
  data: ImplantLookup,
  cybernetics: number | null,
): NormalizedPod {
  const accepted: number[] = [];
  const rejected: PodProblem[] = [];
  const taken = new Map<number, number>(); // slot → the id that claimed it
  const seen = new Set<number>();
  const nameOf = (id: number) => data.types[String(id)]?.name ?? `#${id}`;

  for (const id of ids) {
    const slot = implantSlot(data, id);
    if (slot === undefined) {
      rejected.push({ typeId: id, name: nameOf(id), reason: 'not an implant' });
      continue;
    }
    if (seen.has(id)) {
      rejected.push({ typeId: id, name: nameOf(id), reason: 'the same implant twice' });
      continue;
    }
    const holder = taken.get(slot);
    if (holder !== undefined) {
      rejected.push({
        typeId: id,
        name: nameOf(id),
        reason: `slot ${slot} already holds ${nameOf(holder)}`,
      });
      continue;
    }
    if (cybernetics !== null) {
      const need = cyberneticsFor(data, id);
      if (need > cybernetics) {
        rejected.push({
          typeId: id,
          name: nameOf(id),
          reason: `needs Cybernetics ${need}, pilot has ${cybernetics}`,
        });
        continue;
      }
    }
    seen.add(id);
    taken.set(slot, id);
    accepted.push(id);
  }
  return { accepted, rejected };
}

/**
 * The same, but for a pod that came from ESI and is therefore supposed to be
 * real. Anything rejected here is a genuine surprise — a data-bundle gap, or
 * an implant CCP changed — so it is logged rather than passed over.
 */
export function normalizeRealPod(
  ids: readonly number[],
  data: ImplantLookup,
  cybernetics: number | null,
  who: string,
): number[] {
  const { accepted, rejected } = normalizePod(ids, data, cybernetics);
  if (rejected.length > 0) {
    logWarn('implants', `${who}: dropped ${rejected.length} implant(s) that cannot be worn together`, {
      rejected: rejected.map((r) => `${r.name} — ${r.reason}`),
    });
  }
  return accepted;
}
