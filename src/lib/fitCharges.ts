// WHICH AMMO FITS WHICH WEAPON — PURE, so fixtures run this exact code.
//
// A module declares the charge GROUPS it accepts, and turrets additionally
// declare a chargeSize that the charge must match. Both come from dogma.
//
// THE TRAP, verified against the shipped catalog: the chargeGroup attributes
// are NOT contiguous. They are 604, 605, 606, 609, 610 — attributes 607 and
// 608 are something else entirely, so the obvious `604..608` range would
// silently miss chargeGroup4/5 (every Advanced Heavy Missile, for one) while
// pulling in unrelated attributes.
import type { ParsedFit } from './skillRelevance';

export const CHARGE_GROUP_ATTRS = [604, 605, 606, 609, 610] as const;
export const ATTR_CHARGE_SIZE = 128;

export interface DogmaLookup {
  types: Record<string, { name: string; groupID: number; published: boolean; metaGroupID?: number }>;
  typeDogma: Record<string, { dogmaAttributes: { attributeID: number; value: number }[] }>;
}

const attrOf = (data: DogmaLookup, typeId: number, attrId: number): number | undefined =>
  data.typeDogma[String(typeId)]?.dogmaAttributes.find((a) => a.attributeID === attrId)?.value;

/** the charge groups a module accepts (empty = it takes no charges) */
export function chargeGroupsOf(data: DogmaLookup, moduleTypeId: number): number[] {
  const da = data.typeDogma[String(moduleTypeId)]?.dogmaAttributes ?? [];
  const groups = da
    .filter((a) => (CHARGE_GROUP_ATTRS as readonly number[]).includes(a.attributeID) && a.value > 0)
    .map((a) => Math.round(a.value));
  return [...new Set(groups)];
}

export const takesCharges = (data: DogmaLookup, moduleTypeId: number): boolean =>
  chargeGroupsOf(data, moduleTypeId).length > 0;

/**
 * Every published charge this module can load, by type id.
 * chargeSize is only compared when BOTH sides declare one — missiles use
 * the group alone, and a charge with no size (scan probes) must not be
 * filtered out by a module that has one.
 */
export function compatibleCharges(data: DogmaLookup, moduleTypeId: number): number[] {
  const groups = new Set(chargeGroupsOf(data, moduleTypeId));
  if (groups.size === 0) return [];
  const size = attrOf(data, moduleTypeId, ATTR_CHARGE_SIZE);
  const out: number[] = [];
  for (const [idStr, t] of Object.entries(data.types)) {
    if (!t.published || !groups.has(t.groupID)) continue;
    const id = Number(idStr);
    if (size !== undefined) {
      const cs = attrOf(data, id, ATTR_CHARGE_SIZE);
      if (cs !== undefined && Math.round(cs) !== Math.round(size)) continue;
    }
    out.push(id);
  }
  return out;
}

/**
 * Can this module load this charge? The same test compatibleCharges applies,
 * but asked about ONE pair instead of scanning the whole catalog — the charge
 * matcher asks it thousands of times while rebuilding a fit library.
 *
 * `published` is deliberately NOT checked here: the question is whether a
 * charge ALREADY SITTING IN A REAL FIT belongs in that module, and an
 * unpublished/legacy charge someone actually owns still loads.
 */
export function canLoad(data: DogmaLookup, moduleTypeId: number, chargeTypeId: number): boolean {
  const groups = chargeGroupsOf(data, moduleTypeId);
  if (groups.length === 0) return false;
  const charge = data.types[String(chargeTypeId)];
  if (!charge || !groups.includes(charge.groupID)) return false;
  const size = attrOf(data, moduleTypeId, ATTR_CHARGE_SIZE);
  const cs = attrOf(data, chargeTypeId, ATTR_CHARGE_SIZE);
  // size is compared only when BOTH declare one (missiles match on group
  // alone; a charge with no size must not be excluded by a module with one)
  return size === undefined || cs === undefined || Math.round(size) === Math.round(cs);
}

/** the charges that work in EVERY one of these weapons — swapping ammo is
 * only meaningful for the ones the whole group can actually load */
export function chargesForAll(data: DogmaLookup, moduleTypeIds: number[]): number[] {
  const lists = moduleTypeIds.map((id) => new Set(compatibleCharges(data, id)));
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  return [...first].filter((id) => rest.every((s) => s.has(id)));
}

/** weapons in a fit that take ammo, grouped by module type */
export function ammoWeapons(
  data: DogmaLookup,
  items: { typeId: number; qty: number }[],
): { typeId: number; qty: number; name: string }[] {
  return items
    .filter((i) => takesCharges(data, i.typeId))
    .map((i) => ({ typeId: i.typeId, qty: i.qty, name: data.types[String(i.typeId)]?.name ?? `#${i.typeId}` }));
}


/**
 * The same fit with ONE ammo loaded into every copy of one weapon type.
 *
 * Lived privately inside FitInspector, which meant the Battle Sim could not
 * answer "what if I loaded Barrage" at all — and a fit with no ammo scores
 * exactly zero, because a turret carries no damage of its own. Shared so the
 * two surfaces cannot disagree about what loading a charge means.
 *
 * `null` unloads. Charges beyond the copy count are never read (toEsfFit walks
 * item.charges[i] for i < qty), so the array is sized to the stack.
 */
export function withAmmo(
  fit: ParsedFit, weaponTypeId: number, chargeTypeId: number | null,
): ParsedFit {
  return {
    ...fit,
    items: fit.items.map((it) =>
      it.typeId === weaponTypeId
        ? {
          ...it,
          charges: chargeTypeId === null
            ? []
            : Array(Math.max(1, it.qty)).fill(chargeTypeId) as number[],
        }
        : it),
  };
}

/**
 * Apply a whole map of weaponTypeId → chargeTypeId.
 *
 * `null` is an EXPLICIT "leave it empty", which is different from the weapon
 * simply not being in the map: the first is a choice the user made and must
 * survive, the second means "whatever the fit already had".
 */
export function withAmmoMap(fit: ParsedFit, ammo: Record<number, number | null>): ParsedFit {
  let out = fit;
  for (const [weapon, charge] of Object.entries(ammo)) {
    out = withAmmo(out, Number(weapon), charge);
  }
  return out;
}

/** does this charge actually deal damage? A probe launcher and a command burst
 * both take charges and neither is a weapon — flagging them "empty (no damage)"
 * in red told the player to fix something that was never broken. */
export function chargeDealsDamage(data: DogmaLookup, chargeTypeId: number): boolean {
  const a = data.typeDogma[String(chargeTypeId)]?.dogmaAttributes ?? [];
  return a.some((x) => [114, 116, 117, 118].includes(x.attributeID) && x.value > 0);
}
