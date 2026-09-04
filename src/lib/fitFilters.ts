// PURE eligibility checks for the Fit Wizard's module browser filters:
// can THIS character use it, does it fit THIS hull, does it fit in what's
// LEFT of CPU/PG. All attribute ids verified against the bundled data.
import type { EsfDataShapes } from './dogmaFit';
import { requiredSkillsOf } from './skillRelevance';

/** module fitting costs (attr ids verified: cpu 50, power 30) */
export const ATTR_CPU = 50;
export const ATTR_POWER = 30;
/** rig size must match the hull's (1547 on both) */
const ATTR_RIG_SIZE = 1547;
/** rig calibration cost (rigs carry NO cpu/power — checking those alone
 * let over-calibration rigs through the "fits what's left" filter) */
export const ATTR_UPGRADE_COST = 1153;
/** T3 subsystems bind to ONE hull through this attribute (verified: all 48
 * published subsystems carry it, nothing else does) */
const ATTR_FITS_TO_SHIP_TYPE = 1380;
/** hull whitelists: a module carrying ANY of these may only be fitted to
 * the listed ship types / groups (ids verified in the bundle) */
const CAN_FIT_TYPE = [1302, 1303, 1304, 1305, 1944, 2103, 2463, 2486, 2487, 2488, 2758, 5948];
const CAN_FIT_GROUP = [1298, 1299, 1300, 1301, 1872, 1879, 1880, 1881, 2065, 2396,
  2476, 2477, 2478, 2479, 2480, 2481, 2482, 2483, 2484, 2485];

const attrOf = (data: EsfDataShapes, typeId: number, attrId: number): number | undefined =>
  data.typeDogma[typeId]?.dogmaAttributes.find((a) => a.attributeID === attrId)?.value;

/** every skill requirement this character does NOT meet (empty = usable) */
export function missingSkillsFor(typeId: number, skills: Record<number, number> | null): [number, number][] {
  if (!skills) return []; // unknown skills → don't claim anything is missing
  return requiredSkillsOf(typeId).filter(([id, lvl]) => (skills[id] ?? 0) < lvl);
}

/**
 * Can this module physically go on this hull? Enforces the two hard rules
 * the SDE encodes: RIG SIZE must match, and any canFitShipType/Group
 * whitelist must include the hull. (Slot availability is handled by the
 * wheel itself.) Unknown/absent data = allowed — never hide a module on a
 * guess.
 */
// HARDPOINTS (measured 2026-08-30 against the bundle: hull attr 101 =
// launcherSlotsLeft, 102 = turretSlotsLeft; module effect 40 =
// launcherFitted, 42 = turretFitted — LML II carries 40, 250mm Rail 42,
// DC II neither; Ferox Navy Issue reads 0 launcher / 6 turret). The
// wizard recommended launchers for turret boats because NOTHING checked
// these — the "fits but causes an overage" report.
export const ATTR_LAUNCHER_HARDPOINTS = 101;
export const ATTR_TURRET_HARDPOINTS = 102;
const EFFECT_LAUNCHER_FITTED = 40;
const EFFECT_TURRET_FITTED = 42;

const hasEffect = (data: EsfDataShapes, typeId: number, effectId: number): boolean =>
  (data.typeDogma[typeId]?.dogmaEffects ?? []).some((e) => e.effectID === effectId);

/** does this module occupy a launcher hardpoint? */
export const usesLauncherHardpoint = (data: EsfDataShapes, typeId: number): boolean =>
  hasEffect(data, typeId, EFFECT_LAUNCHER_FITTED);
/** does this module occupy a turret hardpoint? */
export const usesTurretHardpoint = (data: EsfDataShapes, typeId: number): boolean =>
  hasEffect(data, typeId, EFFECT_TURRET_FITTED);

/** the hull's hardpoint counts (0 when the attribute is absent) */
export function hullHardpoints(data: EsfDataShapes, hullId: number): { launcher: number; turret: number } {
  return {
    launcher: Math.round(attrOf(data, hullId, ATTR_LAUNCHER_HARDPOINTS) ?? 0),
    turret: Math.round(attrOf(data, hullId, ATTR_TURRET_HARDPOINTS) ?? 0),
  };
}

export function moduleFitsHull(typeId: number, hullId: number, data: EsfDataShapes): boolean {
  // T3 subsystems: bound to exactly one hull
  const fitsTo = attrOf(data, typeId, ATTR_FITS_TO_SHIP_TYPE);
  if (fitsTo !== undefined && Math.round(fitsTo) !== hullId) return false;

  // a hardpoint module on a hull with ZERO hardpoints of that kind can
  // never fit, no matter how empty the fit is (a launcher on a Ferox Navy
  // Issue) — remaining-count checks live in moduleFitsRemaining
  if (usesLauncherHardpoint(data, typeId) && hullHardpoints(data, hullId).launcher === 0) return false;
  if (usesTurretHardpoint(data, typeId) && hullHardpoints(data, hullId).turret === 0) return false;

  const rig = attrOf(data, typeId, ATTR_RIG_SIZE);
  if (rig !== undefined) {
    const hullRig = attrOf(data, hullId, ATTR_RIG_SIZE);
    if (hullRig !== undefined && Math.round(rig) !== Math.round(hullRig)) return false;
  }

  // the two whitelists are a UNION, not an AND: canFitShipGroup carries the
  // ship CLASSES, canFitShipType bolts on individual exception hulls whose
  // group is deliberately absent. ANDing them hid every Command Burst,
  // covops cloak, MJD… (they'd fit nothing at all — CCP ships no such item)
  const allowedTypes = CAN_FIT_TYPE.map((a) => attrOf(data, typeId, a)).filter((v): v is number => v !== undefined);
  const allowedGroups = CAN_FIT_GROUP.map((a) => attrOf(data, typeId, a)).filter((v): v is number => v !== undefined);
  if (allowedTypes.length > 0 || allowedGroups.length > 0) {
    const hullGroup = data.types[hullId]?.groupID;
    const typeMatch = allowedTypes.some((v) => Math.round(v) === hullId);
    const groupMatch = hullGroup !== undefined && allowedGroups.some((v) => Math.round(v) === hullGroup);
    if (!typeMatch && !groupMatch) return false;
  }
  return true;
}

/** can this module be OVERHEATED? true when it carries any effect in the
 * overload category (5) — the same test the game uses to enable the
 * overheat state */
export function overloadable(typeId: number, data: EsfDataShapes & { dogmaEffects?: Record<string, { effectCategory?: number }> }): boolean {
  const effects = data.typeDogma[typeId]?.dogmaEffects ?? [];
  const defs = data.dogmaEffects;
  if (!defs) return false;
  return effects.some((e) => defs[String(e.effectID)]?.effectCategory === 5);
}

/** does the module's raw CPU/PG cost fit in what's left? (raw costs — the
 * character's fitting-reduction skills are already reflected in the
 * REMAINING figures this is compared against, and module-side reductions
 * like Advanced Weapon Upgrades are not modeled here: stated in the UI) */
export function moduleFitsRemaining(
  typeId: number,
  data: EsfDataShapes,
  cpuLeft: number,
  pgLeft: number,
  /** rig calibration left — rigs cost calibration and NO cpu/pg */
  calibrationLeft = Infinity,
  /** the module being REPLACED: its cost frees up when it comes out, so
   * a straight swap must not be judged against the fit that still has it */
  outgoingTypeId?: number,
  /** free launcher/turret hardpoints (v0.177 — a 7th turret on a 6-point
   * hull passed every cpu/pg check and then didn't fit in game) */
  launchersLeft = Infinity,
  turretsLeft = Infinity,
): boolean {
  const back = (attr: number) => (outgoingTypeId !== undefined ? attrOf(data, outgoingTypeId, attr) ?? 0 : 0);
  const cpu = attrOf(data, typeId, ATTR_CPU) ?? 0;
  const pg = attrOf(data, typeId, ATTR_POWER) ?? 0;
  const cal = attrOf(data, typeId, ATTR_UPGRADE_COST) ?? 0;
  if (usesLauncherHardpoint(data, typeId)) {
    const credit = outgoingTypeId !== undefined && usesLauncherHardpoint(data, outgoingTypeId) ? 1 : 0;
    if (1 > launchersLeft + credit) return false;
  }
  if (usesTurretHardpoint(data, typeId)) {
    const credit = outgoingTypeId !== undefined && usesTurretHardpoint(data, outgoingTypeId) ? 1 : 0;
    if (1 > turretsLeft + credit) return false;
  }
  return (
    cpu <= cpuLeft + back(ATTR_CPU) + 1e-6 &&
    pg <= pgLeft + back(ATTR_POWER) + 1e-6 &&
    cal <= calibrationLeft + back(ATTR_UPGRADE_COST) + 1e-6
  );
}
