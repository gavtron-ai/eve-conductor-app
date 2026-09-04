// APPLIED DAMAGE — what a fit actually does to a specific target at a specific
// range, as opposed to the paper DPS the rest of the app reports.
//
// fitSummary answers "how much damage does this fit emit". That number is the
// same whether you are shooting a stationary freighter or an orbiting frigate,
// and says so honestly in its own header: "Weapon range/tracking/application
// are NOT modelled". This module is the missing half.
//
// PURE — no engine, no browser, no Vite imports. It consumes the dogma
// engine's ALREADY-COMPUTED per-item attributes (post-skills, post-stacking,
// post-ammo) and does the application arithmetic on top. Fixtures therefore
// run the exact shipped code.
//
// EVERY ATTRIBUTE ID AND EVERY CONSTANT BELOW WAS READ OUT OF THE SHIPPED
// esf BUNDLE, not recalled. The two that would have been wrong from memory:
//
//   · Turret signature resolution is attribute 620, named `optimalSigRadius`,
//     NOT "signatureResolution" (which does not exist). Verified = 40000 on a
//     425mm AutoCannon II. Most sources fold that 40000 into the formula as a
//     constant; reading the attribute is correct for the turrets that differ.
//
//   · The missile damage reduction factor (1353) in the current SDE is
//     ALREADY the normalized exponent, 0.60–1.00 — Mjolnir XL Torpedo reads
//     exactly 1.0, matching CCP's published scale. The widely-quoted
//     log(drf)/log(5.5) conversion applies to an OLDER representation and
//     yields a NEGATIVE exponent here, which makes a missile apply BETTER the
//     faster its target runs. Companion attribute 1354
//     (aoeDamageReductionSensitivity) is absent from every missile in the
//     bundle, so 1353 is used directly.
import type { EngineItem, EngineResult } from './fitSummary';
import {
  repairCycles, dutyHpsOf, burstHpsOf, capacitorOf, capBoosters, chargeCount, hardenerDrain,
  type RepairCycle, type RepairRefusal, type CapacitorModel, type CapBoosterCycle, type HardenerDrain,
} from './moduleCycle';

export type DamageType = 'em' | 'thermal' | 'kinetic' | 'explosive';
export const DAMAGE_TYPES: DamageType[] = ['em', 'thermal', 'kinetic', 'explosive'];
export type Damage = Record<DamageType, number>;

export const ZERO_DAMAGE: Damage = { em: 0, thermal: 0, kinetic: 0, explosive: 0 };
export const totalDamage = (d: Damage): number => d.em + d.thermal + d.kinetic + d.explosive;

/** ids verified against the bundled dogmaAttributes (see header) */
const A = {
  cycleSpeed: 51,
  duration: 73,
  damageMultiplier: 64,
  em: 114, explosive: 116, kinetic: 117, thermal: 118,
  cycleWithReload: -16,    // engine pseudo-attribute: cycle amortising reload
  optimal: 54,
  falloff: 158,
  tracking: 160,
  sigResolution: 620,      // optimalSigRadius — 40000 on a 425mm AutoCannon II
  expRadius: 654,          // aoeCloudSize
  expVelocity: 653,        // aoeVelocity
  drf: 1353,               // aoeDamageReductionFactor — already the exponent
  flightTime: 281,         // explosionDelay, ms
  maxVelocity: 37,
  // A drone's OWN orbit radius is attribute 416 entityFlyRange — probed
  // 2026-08-10 across every drone class (Hobgoblin II 700, Hammerhead II
  // 1400, Ogre II 2800) and cross-validated against EVE Uni's published
  // drone orbit figures, which match exactly. Attribute 154 is
  // proximityRange (1000/2000/4000 on the same drones) — a DIFFERENT thing
  // (plausibly the engagement/switch threshold) that this file wrongly read
  // as the orbit radius through v0.92: a 30-43% error in drone angular
  // velocity. Kept only as the sentry fallback below.
  proximityRange: 154,
  entityFlyRange: 416,
  capacitorNeed: 6,
  reloadTimeMs: 1795,
  chargeRate: 56,
  chargeAmount: -8,
  reactivationDelay: 669,  // ms — Bomb Launcher I reads 80000 post-skill
  spoolPerCycle: 2733,     // damageMultiplierBonusPerCycle, engine-final
  spoolMax: 2734,          // damageMultiplierBonusMax, engine-final
  shieldRes: { em: 271, explosive: 272, kinetic: 273, thermal: 274 },
  armorRes: { em: 267, explosive: 268, kinetic: 269, thermal: 270 },
  hullRes: { em: 113, explosive: 111, kinetic: 109, thermal: 110 },
  shieldHp: 263, armorHp: 265, structureHp: 9,
  signatureRadius: 552,
  // ENGINE PSEUDO-ATTRIBUTES for local repair, verified against HP/duration on
  // the shipped wasm: a Large Shield Booster II reports -49 = 68.9999... which
  // is exactly its 276 HP over a 4.000 s cycle; a Large Armor Repairer II
  // reports -45 = 81.7777... = 920 over 11.25 s. Overheating flows through
  // automatically (69.0 -> 89.3), because module state reaches the engine.
  shieldRepairHps: -49,
  armorRepairHps: -45,
  /** PASSIVE shield regeneration. Peak rate is 2.5 x capacity / recharge time
   * — the same identity this app already uses for the capacitor bar. Verified
   * on a Tengu: 5625 HP over a 1,050,000 ms recharge = 13.4 hp/s peak. This is
   * a whole tanking style and excluding it made a passive fit look naked. */
  shieldCapacity: 263,
  shieldRechargeRate: 479,
  /** seconds until the capacitor is dry; NEGATIVE means stable */
  capDepletesIn: -7,
};

/** CCP's default turret signature resolution, used only when a turret does
 * not publish attribute 620 at all */
const DEFAULT_SIG_RESOLUTION = 40000;

const val = (attributes: unknown, id: number): number | undefined => {
  let e: { value?: number | null; base_value?: number } | undefined;
  if (attributes instanceof Map) e = attributes.get(id) as typeof e;
  else if (attributes && typeof attributes === 'object') e = (attributes as Record<string, typeof e>)[String(id)];
  if (!e) return undefined;
  const v = e.value ?? e.base_value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
const num = (attributes: unknown, id: number, dflt = 0): number => val(attributes, id) ?? dflt;

// ---------------------------------------------------------------------------
// what we simulate
// ---------------------------------------------------------------------------

export type WeaponKind = 'turret' | 'missile' | 'drone' | 'untracked';

export interface SimWeapon {
  typeId: number;
  kind: WeaponKind;
  /** damage per volley by type, INCLUDING the damage multiplier */
  volley: Damage;
  cycleSeconds: number;
  chargeTypeId?: number;
  /** turrets */
  optimal?: number;
  falloff?: number;
  tracking?: number;
  sigResolution?: number;
  /** drones: their own flight speed, for the note that they take time to arrive */
  droneSpeed?: number;
  /** the radius THIS drone orbits its target at (attribute 416
   * entityFlyRange — measured; 154 proximityRange was wrong through v0.92),
   * which sets the angular velocity it has to track and where its travel
   * leg ends — read from the drone, never asked */
  droneOrbit?: number;
  /** missiles */
  expRadius?: number;
  expVelocity?: number;
  drf?: number;
  /** hard ceiling: a missile that expires simply does not arrive */
  maxRange?: number;
  /** seconds per cycle once reloading is amortised; undefined = never reloads.
   * THE SMOOTHING — engine pseudo -16. The closed-form panels still read it;
   * the discrete event simulation must NEVER touch it (it amortises the reload
   * silence that decides alpha-versus-tank fights). */
  cycleSecondsWithReload?: number;
  /** slot identity, e.g. "High3" — deterministic ordering and policy key */
  slotKey?: string;
  /** GJ per activation (attr 6) — energy/hybrid turrets draw capacitor,
   * projectiles and launchers do not. 0 when absent. */
  capPerCycle: number;
  /** a real clip: whole rounds (chargeCount of -8), charges per cycle (56),
   * and the reload silence (1795, ms→s). Undefined = never reloads. */
  clip?: { size: number; perCycle: number; reloadSeconds: number };
  /** attr 669 moduleReactivationDelay, seconds — a Bomb Launcher waits 80 s
   * AFTER its cycle before it may fire again */
  reactivationSeconds?: number;
  /** Triglavian spool, read off the ENGINE item so hull bonuses are folded in
   * (measured: Vedmak 2734=2.125, Ikitursa 4.25, same module). The engine
   * reports the UNSPOOLED damage; the ramp state is entirely the sim's. */
  spool?: { perCycle: number; max: number };
  /** m/s of the missile itself (charge attr 37) — flight time to a target at
   * range r is r/velocity, and the volley lands THAT much later */
  missileVelocity?: number;
}

export interface SimTarget {
  name: string;
  /** metres */
  signatureRadius: number;
  /** m/s — the speed used for MISSILE application */
  velocity: number;
  /** resonance per damage type: 1 = no resistance, 0.4 = 60% resist */
  resonance: Damage;
}

/** no resists at all — the honest default when the user has not named a target */
export const NO_RESISTS: Damage = { em: 1, thermal: 1, kinetic: 1, explosive: 1 };

const damageOf = (attributes: unknown, mult: number): Damage => ({
  em: num(attributes, A.em) * mult,
  thermal: num(attributes, A.thermal) * mult,
  kinetic: num(attributes, A.kinetic) * mult,
  explosive: num(attributes, A.explosive) * mult,
});

const isActive = (state?: string) => state === 'Active' || state === 'Overload';

/**
 * Turn one engine item into something simulatable, or null if it is not a
 * weapon. Classification is by WHICH APPLICATION ATTRIBUTES IT CARRIES, not by
 * group: a turret publishes tracking, a missile's charge publishes an
 * explosion radius, and anything that deals damage with neither (smartbombs,
 * bombs, doomsdays) applies in full and is marked 'untracked' rather than
 * quietly given a tracking curve it does not have.
 */
export function simWeapon(item: EngineItem): SimWeapon | null {
  if (!isActive(item.state)) return null;
  const cycleMs = num(item.attributes, A.cycleSpeed) || num(item.attributes, A.duration);
  if (cycleMs <= 0) return null;

  const mult = val(item.attributes, A.damageMultiplier) ?? 1;
  // a turret/launcher carries no damage of its own — it is on the charge.
  // Drones and smartbombs carry theirs directly.
  const chargeAttrs = item.charge?.attributes;
  const own = damageOf(item.attributes, mult);
  const fromCharge = chargeAttrs ? damageOf(chargeAttrs, mult) : ZERO_DAMAGE;
  const volley = totalDamage(fromCharge) > 0 ? fromCharge : own;
  if (totalDamage(volley) <= 0) return null;

  // Only a weapon that CONSUMES a charge reloads. The engine returns a 10 s
  // speedOfReload for a smartbomb, which has no clip at all — see fitSummary.
  const withReload = item.charge ? val(item.attributes, A.cycleWithReload) : undefined;

  // THE DISCRETE TRUTH, alongside the amortised number. A real clip only
  // exists where a real charge is loaded — the engine invents -8/-15 for
  // chargeless modules (a smartbomb reads a 10 s reload it does not have).
  const clipSize = item.charge ? chargeCount(val(item.attributes, A.chargeAmount)) : undefined;
  const reloadMs = item.charge ? val(item.attributes, A.reloadTimeMs) : undefined;
  const reactivationMs = val(item.attributes, A.reactivationDelay);
  const spoolPer = val(item.attributes, A.spoolPerCycle);
  const spoolMax = val(item.attributes, A.spoolMax);
  const slotType0 = typeof item.slot === 'string' ? item.slot : item.slot?.type;
  const slotIndex = typeof item.slot === 'object' ? (item.slot as { index?: number })?.index : undefined;

  const base = {
    typeId: item.type_id,
    volley,
    cycleSeconds: cycleMs / 1000,
    cycleSecondsWithReload: withReload !== undefined && withReload > 0 ? withReload / 1000 : undefined,
    chargeTypeId: item.charge?.type_id,
    slotKey: slotType0 ? `${slotType0}${slotIndex ?? ''}` : undefined,
    capPerCycle: val(item.attributes, A.capacitorNeed) ?? 0,
    // A clip is only a MECHANIC when its reload is a real silence. Lasers
    // hold one crystal with a 0.01 ms "reload" (measured: Heavy Pulse Laser
    // II clip 1, reload 9.99e-6 s — crystals never deplete), and a
    // disintegrator's 500-round clip reloads in 0.01 ms. Simulating those
    // as reloads produced 237 phantom reload events in one 300 s Ashimmu
    // fight and would reset a disintegrator's spool for no in-game reason.
    // One second is far below every real reload (10 s guns, 35 s rapids,
    // 60 s ancillaries) and far above every phantom (0.01 ms).
    clip: clipSize !== undefined && reloadMs !== undefined && reloadMs >= 1000
      ? {
        size: clipSize,
        perCycle: val(item.attributes, A.chargeRate) ?? 1,
        reloadSeconds: reloadMs / 1000,
      }
      : undefined,
    reactivationSeconds: reactivationMs !== undefined && reactivationMs > 0
      ? reactivationMs / 1000 : undefined,
    spool: spoolPer !== undefined && spoolPer > 0 && spoolMax !== undefined && spoolMax > 0
      ? { perCycle: spoolPer, max: spoolMax }
      : undefined,
  };

  const tracking = val(item.attributes, A.tracking);

  // DRONES ARE NOT BOLTED TO THE HULL — they fly to the target.
  //
  // They publish trackingSpeed, optimal and falloff exactly like a turret, so
  // classifying on those attributes made a Dominix with five Ogre IIs read
  // 482 applied dps at 1 km and ZERO at 30 km: the engine was measuring the
  // drone's 7.2 km optimal from the SHIP. Drones close the distance
  // themselves; what limits them is drone control range, not gun range.
  //
  // The engine labels their slot DroneBay. Verified against the shipped wasm:
  // it reports a slot for EVERY item — High/Med/Low/Rig/SubSystem for modules,
  // DroneBay for drones — so 'DroneBay' is an exact test. A missing slot is
  // NOT a drone signal; treating it as one would silently turn any item the
  // caller built without slot metadata into a range-immune weapon.
  const slotType = typeof item.slot === 'string' ? item.slot : item.slot?.type;
  if (slotType === 'DroneBay') {
    const flyRange = val(item.attributes, A.entityFlyRange);
    return {
      ...base,
      kind: 'drone',
      tracking,
      sigResolution: val(item.attributes, A.sigResolution) ?? DEFAULT_SIG_RESOLUTION,
      droneSpeed: val(item.attributes, A.maxVelocity),
      // orbit radius = 416 entityFlyRange (measured; 154 was wrong). SENTRY
      // drones read ~0 here because they do not orbit at all — they are
      // stationary turrets, which NO current model expresses (they also
      // never "arrive" in the event sim, since their travel speed is ~0).
      // They keep the old proximity fallback so their behaviour is
      // unchanged-but-known-wrong rather than differently wrong — a named
      // refusal pending a real stationary-turret model.
      droneOrbit: flyRange !== undefined && flyRange >= 10
        ? flyRange : val(item.attributes, A.proximityRange),
    };
  }

  if (tracking !== undefined && tracking > 0) {
    return {
      ...base,
      kind: 'turret',
      tracking,
      optimal: num(item.attributes, A.optimal),
      falloff: num(item.attributes, A.falloff),
      sigResolution: val(item.attributes, A.sigResolution) ?? DEFAULT_SIG_RESOLUTION,
    };
  }

  // missile application lives on the CHARGE, and so does its reach
  const expRadius = chargeAttrs ? val(chargeAttrs, A.expRadius) : undefined;
  if (expRadius !== undefined && expRadius > 0) {
    const flightTime = chargeAttrs ? num(chargeAttrs, A.flightTime) : 0;
    const velocity = chargeAttrs ? num(chargeAttrs, A.maxVelocity) : 0;
    return {
      ...base,
      kind: 'missile',
      expRadius,
      expVelocity: chargeAttrs ? val(chargeAttrs, A.expVelocity) : undefined,
      drf: chargeAttrs ? val(chargeAttrs, A.drf) : undefined,
      maxRange: flightTime > 0 && velocity > 0 ? (velocity * flightTime) / 1000 : undefined,
      missileVelocity: velocity > 0 ? velocity : undefined,
    };
  }

  return { ...base, kind: 'untracked' };
}

/** every simulatable weapon in an engine result */
export const simWeapons = (result: EngineResult): SimWeapon[] =>
  result.items.map(simWeapon).filter((w): w is SimWeapon => w !== null);

// ---------------------------------------------------------------------------
// TURRETS
// ---------------------------------------------------------------------------

/**
 * Chance that a single shot lands.
 *
 *   hit = 0.5 ^ [ (angular · sigRes / (tracking · sig))² + (max(0, d − optimal) / falloff)² ]
 *
 * The two terms are independent and each contributes a halving at its own
 * characteristic scale: at optimal+falloff the range term alone gives 0.5.
 */
export function turretChanceToHit(
  w: SimWeapon,
  distance: number,
  /** target's angular velocity relative to you, rad/s */
  angularVelocity: number,
  targetSigRadius: number,
): number {
  const tracking = w.tracking ?? 0;
  const sigRes = w.sigResolution ?? DEFAULT_SIG_RESOLUTION;
  if (tracking <= 0 || targetSigRadius <= 0) return 0;
  const trackingTerm = (angularVelocity * sigRes) / (tracking * targetSigRadius);
  const falloff = w.falloff ?? 0;
  const over = Math.max(0, distance - (w.optimal ?? 0));
  // no falloff and past optimal = a hard wall, not a divide by zero
  const rangeTerm = falloff > 0 ? over / falloff : (over > 0 ? Infinity : 0);
  const exponent = trackingTerm * trackingTerm + rangeTerm * rangeTerm;
  if (!Number.isFinite(exponent)) return 0;
  return Math.pow(0.5, exponent);
}

/**
 * Average damage multiplier for a given hit chance, over the whole
 * distribution of hit qualities:
 *
 *   0.5 · min(hit² + 0.98·hit + 0.0501,  6·hit)
 *
 * A normal hit rolls uniformly across 50–149% of base damage; 1% of shots are
 * wrecking hits at 300% and land regardless of tracking. The second branch is
 * that wrecking-only regime — at hit = 0.01 it gives exactly 0.01 × 3 = 0.03,
 * and at hit = 1 the first gives 1.015, the small surplus wrecking hits add
 * over nominal. Both limits are asserted in the fixtures.
 */
export function turretDamageMultiplier(chanceToHit: number): number {
  const h = Math.max(0, Math.min(1, chanceToHit));
  return 0.5 * Math.min(h * h + 0.98 * h + 0.0501, 6 * h);
}

// ---------------------------------------------------------------------------
// MISSILES
// ---------------------------------------------------------------------------

/**
 * Fraction of a missile's damage that lands:
 *
 *   min( 1,  S/E,  ((S/E) · (Ve/Vt)) ^ drf )
 *
 * S = target signature, E = explosion radius, Ve = explosion velocity,
 * Vt = target velocity, drf = attribute 1353 used DIRECTLY as the exponent
 * (see the header — the log(drf)/log(5.5) conversion belongs to an older
 * representation and inverts the curve against fast targets).
 *
 * A stationary target drops the velocity term entirely and is limited only by
 * S/E: a torpedo still over-applies against a battleship-sized signature.
 */
export function missileDamageFactor(
  w: SimWeapon,
  targetSigRadius: number,
  targetVelocity: number,
): number {
  const E = w.expRadius ?? 0;
  if (E <= 0) return 1;
  const sigTerm = targetSigRadius / E;
  const Ve = w.expVelocity ?? 0;
  const drf = w.drf ?? 1;
  // a target that is not moving cannot outrun the explosion
  if (targetVelocity <= 0 || Ve <= 0) return Math.min(1, sigTerm);
  const velTerm = Math.pow(sigTerm * (Ve / targetVelocity), drf);
  return Math.max(0, Math.min(1, sigTerm, velTerm));
}

// ---------------------------------------------------------------------------
// APPLIED DPS
// ---------------------------------------------------------------------------

export interface Engagement {
  /** metres between the two ships */
  distance: number;
  /** target's TRANSVERSAL velocity in m/s — the component across your line of
   * sight. Angular velocity is transversal/distance, so the same transversal
   * is far harder to track up close; that is the whole reason to orbit. */
  transversal: number;
  /**
   * How far from the target a drone sits, in metres. Drones fly to the target
   * and orbit it, so their tracking problem is set by THIS radius and the
   * target's own speed — not by the range between the two SHIPS.
   *
   * ONLY a fallback: the drone publishes its own radius in attribute 416
   * (entityFlyRange), and that is used when present. This exists for callers
   * holding a SimWeapon built without it. Default 500 m (the SDE default).
   */
  droneOrbit?: number;
  /**
   * The pilot's drone control range, in metres. NOT available from the engine:
   * droneControlDistance (458) has its base on typeId 1373 CharacterType,
   * which is not part of a fit and never gets evaluated. The caller composes
   * it (20 km base + Drone Avionics + Advanced Drone Avionics + any Drone Link
   * Augmentor) or leaves it undefined, in which case no range limit is claimed.
   */
  droneControlRange?: number;
}

/** EVE's un-skilled drone control range, from CharacterType 1373 */
export const BASE_DRONE_CONTROL_RANGE = 20000;
/** SDE default of attr 416 entityFlyRange (probed 2026-08-10) — used only
 * when a caller supplies no drone data at all */
export const DEFAULT_DRONE_ORBIT = 500;

/** the fraction of this weapon's volley that lands, 0..1 */
export function applicationOf(w: SimWeapon, target: SimTarget, e: Engagement): number {
  switch (w.kind) {
    case 'turret': {
      const angular = e.distance > 0 ? e.transversal / e.distance : 0;
      return turretDamageMultiplier(turretChanceToHit(w, e.distance, angular, target.signatureRadius));
    }
    case 'drone': {
      // out of control range the drone is not fighting at all
      if (e.droneControlRange !== undefined && e.distance > e.droneControlRange) return 0;
      if (w.tracking === undefined || w.tracking <= 0) return 1;
      // the drone has closed to ITS OWN orbit radius (attribute 416, e.g.
      // 700 m for a Hobgoblin, 2800 for an Ogre — measured); the angular
      // velocity it faces comes from the TARGET's speed at that radius, not
      // from the ships' separation. The engagement override exists only for
      // callers with no drone data.
      const orbit = Math.max(1, w.droneOrbit ?? e.droneOrbit ?? DEFAULT_DRONE_ORBIT);
      const angular = target.velocity / orbit;
      // no range term: the drone is sitting on top of its target
      return turretDamageMultiplier(turretChanceToHit(w, 0, angular, target.signatureRadius));
    }
    case 'missile': {
      // missiles do not fall off — they either arrive or expire
      if (w.maxRange !== undefined && e.distance > w.maxRange) return 0;
      return missileDamageFactor(w, target.signatureRadius, target.velocity);
    }
    default:
      return 1; // smartbombs and the like: no tracking model to apply
  }
}

/** volley after the target's resistances */
export function afterResists(volley: Damage, resonance: Damage): number {
  return volley.em * resonance.em
    + volley.thermal * resonance.thermal
    + volley.kinetic * resonance.kinetic
    + volley.explosive * resonance.explosive;
}

export interface AppliedDps {
  /** dps that actually lands, after application AND resists */
  applied: number;
  /** the same, once reloading is amortised — what a fight longer than one clip
   * actually looks like */
  appliedSustained: number;
  /** dps the fit emits — the paper number, for the ratio */
  raw: number;
  perWeapon: {
    typeId: number; chargeTypeId?: number;
    applied: number; appliedSustained: number; raw: number; application: number;
  }[];
}

export function appliedDps(weapons: SimWeapon[], target: SimTarget, e: Engagement): AppliedDps {
  let applied = 0;
  let appliedSustained = 0;
  let raw = 0;
  const perWeapon: AppliedDps['perWeapon'] = [];
  for (const w of weapons) {
    const app = applicationOf(w, target, e);
    const rawDps = totalDamage(w.volley) / w.cycleSeconds;
    // resists apply to the damage TYPES, so they cannot be folded into a
    // single scalar before the split is known
    const landed = afterResists(w.volley, target.resonance) * app;
    const appliedDpsHere = landed / w.cycleSeconds;
    // a weapon that never reloads sustains its full rate
    const sustainedHere = landed / (w.cycleSecondsWithReload ?? w.cycleSeconds);
    applied += appliedDpsHere;
    appliedSustained += sustainedHere;
    raw += rawDps;
    perWeapon.push({
      typeId: w.typeId, chargeTypeId: w.chargeTypeId,
      applied: appliedDpsHere, appliedSustained: sustainedHere, raw: rawDps, application: app,
    });
  }
  return { applied, appliedSustained, raw, perWeapon };
}

// ---------------------------------------------------------------------------
// CURVES — the graphs
// ---------------------------------------------------------------------------

export interface CurvePoint { x: number; y: number }

const series = (from: number, to: number, steps: number): number[] =>
  Array.from({ length: steps + 1 }, (_, i) => from + ((to - from) * i) / steps);

/** applied dps as the target moves away, at a fixed transversal */
export function rangeCurve(
  weapons: SimWeapon[], target: SimTarget,
  { maxRange, transversal, steps = 100 }: { maxRange: number; transversal: number; steps?: number },
): CurvePoint[] {
  return series(0, maxRange, steps).map((distance) => ({
    x: distance,
    y: appliedDps(weapons, target, { distance, transversal }).applied,
  }));
}

/** applied dps as the target's transversal rises, at a fixed range */
export function transversalCurve(
  weapons: SimWeapon[], target: SimTarget,
  { distance, maxTransversal, steps = 100 }: { distance: number; maxTransversal: number; steps?: number },
): CurvePoint[] {
  return series(0, maxTransversal, steps).map((transversal) => ({
    x: transversal,
    // a target with transversal is a target that is MOVING, and missiles care
    // about speed however it is directed — the two graphs must agree
    y: appliedDps(weapons, { ...target, velocity: Math.max(target.velocity, transversal) },
      { distance, transversal }).applied,
  }));
}

/** applied dps against ever-larger targets — the "can I hit a frigate" graph */
export function signatureCurve(
  weapons: SimWeapon[], target: SimTarget,
  { distance, transversal, maxSig, steps = 100 }:
  { distance: number; transversal: number; maxSig: number; steps?: number },
): CurvePoint[] {
  return series(1, maxSig, steps).map((signatureRadius) => ({
    x: signatureRadius,
    y: appliedDps(weapons, { ...target, signatureRadius }, { distance, transversal }).applied,
  }));
}

// ---------------------------------------------------------------------------
// TANK — EHP against a damage profile, not against an average
// ---------------------------------------------------------------------------

/** a normalized attacker profile: how their damage splits across the types */
export const DAMAGE_PROFILES: { name: string; damage: Damage }[] = [
  { name: 'Even (25/25/25/25)', damage: { em: 25, thermal: 25, kinetic: 25, explosive: 25 } },
  { name: 'Amarr / EM-Therm', damage: { em: 55, thermal: 45, kinetic: 0, explosive: 0 } },
  { name: 'Caldari / Kin-Therm', damage: { em: 0, thermal: 30, kinetic: 70, explosive: 0 } },
  { name: 'Gallente / Therm-Kin', damage: { em: 0, thermal: 65, kinetic: 35, explosive: 0 } },
  { name: 'Minmatar / Exp-Kin', damage: { em: 2, thermal: 12, kinetic: 34, explosive: 52 } },
  { name: 'Guristas / Kinetic', damage: { em: 0, thermal: 21, kinetic: 79, explosive: 0 } },
  { name: 'Blood Raiders / EM', damage: { em: 62, thermal: 38, kinetic: 0, explosive: 0 } },
  { name: 'Sansha / EM-Therm', damage: { em: 60, thermal: 40, kinetic: 0, explosive: 0 } },
  { name: 'Serpentis / Therm-Kin', damage: { em: 0, thermal: 68, kinetic: 32, explosive: 0 } },
  { name: 'Angel / Exp-Kin', damage: { em: 2, thermal: 12, kinetic: 39, explosive: 47 } },
];

/**
 * Effective HP of one layer against a damage profile.
 *
 * The weighted-resonance identity: a layer survives 1/(weighted resonance)
 * times its raw HP. Weighting by the profile is what makes this different from
 * the even-split number the rest of the app shows — an armour tank with a hole
 * in explosive is not "average" against Angels.
 */
export function layerEhp(hp: number, resonance: Damage, profile: Damage): number {
  const share = totalDamage(profile);
  if (hp <= 0 || share <= 0) return 0;
  const weighted = (profile.em * resonance.em
    + profile.thermal * resonance.thermal
    + profile.kinetic * resonance.kinetic
    + profile.explosive * resonance.explosive) / share;
  return weighted > 0 ? hp / weighted : hp;
}

const resonanceOf = (attributes: unknown, ids: Record<DamageType, number>): Damage => ({
  em: num(attributes, ids.em, 1),
  thermal: num(attributes, ids.thermal, 1),
  kinetic: num(attributes, ids.kinetic, 1),
  explosive: num(attributes, ids.explosive, 1),
});

export interface ResonanceLayers {
  shield: Damage;
  armor: Damage;
  structure: Damage;
}

/** the three layers' resistances, straight off the engine's hull result */
export function resonanceLayers(result: EngineResult): ResonanceLayers {
  const h = result.hull.attributes;
  return {
    shield: resonanceOf(h, A.shieldRes),
    armor: resonanceOf(h, A.armorRes),
    structure: resonanceOf(h, A.hullRes),
  };
}

export interface TankProfile {
  shield: number;
  armor: number;
  structure: number;
  total: number;
  /** the layers' resonances, so a panel can show WHERE the hole is */
  shieldResonance: Damage;
  armorResonance: Damage;
  structureResonance: Damage;
}

/** EHP by layer against one attacker profile, from the engine's hull result */
export function tankAgainst(result: EngineResult, profile: Damage): TankProfile {
  const h = result.hull.attributes;
  const shieldResonance = resonanceOf(h, A.shieldRes);
  const armorResonance = resonanceOf(h, A.armorRes);
  const structureResonance = resonanceOf(h, A.hullRes);
  const shield = layerEhp(num(h, A.shieldHp), shieldResonance, profile);
  const armor = layerEhp(num(h, A.armorHp), armorResonance, profile);
  const structure = layerEhp(num(h, A.structureHp), structureResonance, profile);
  return {
    shield, armor, structure, total: shield + armor + structure,
    shieldResonance, armorResonance, structureResonance,
  };
}

/** the target a fit is being judged against, built from an engine result —
 * lets one fit be simulated shooting another */
export function targetFrom(result: EngineResult, name: string): SimTarget {
  const h = result.hull.attributes;
  // the WORST layer is what an attacker meets first on a shield ship and last
  // on a hull tank; for application we only need the hull's own numbers
  return {
    name,
    signatureRadius: num(h, A.signatureRadius, 1),
    velocity: num(h, A.maxVelocity),
    resonance: resonanceOf(h, A.shieldRes),
  };
}

// ---------------------------------------------------------------------------
// TIME TO KILL — the number that makes this a battle sim rather than a chart
// ---------------------------------------------------------------------------

/**
 * Damage that LANDS, split by type, before any resistance is applied.
 *
 * This is the piece `appliedDps` cannot give you: it folds resists in per
 * weapon and returns a scalar, so the same result cannot then be re-applied
 * against a second layer. And it must be, because the three layers of a real
 * ship have genuinely different resistances — on an engine-computed armour
 * cruiser they differ by up to 2.9x and the ORDERING even inverts by damage
 * type, so a single blended figure mis-states time-to-kill badly.
 */
export function landedDamagePerSecond(
  weapons: SimWeapon[], target: SimTarget, e: Engagement, sustained: boolean,
): Damage {
  const out: Damage = { ...ZERO_DAMAGE };
  for (const w of weapons) {
    const app = applicationOf(w, target, e);
    if (app <= 0) continue;
    const cycle = sustained ? (w.cycleSecondsWithReload ?? w.cycleSeconds) : w.cycleSeconds;
    if (cycle <= 0) continue;
    for (const t of DAMAGE_TYPES) out[t] += (w.volley[t] * app) / cycle;
  }
  return out;
}

export interface Layer {
  name: string;
  hp: number;
  resonance: Damage;
}

export interface TimeToKill {
  /** seconds to strip every layer, or null when the target cannot be killed
   * at this range with these weapons */
  seconds: number | null;
  /** per-layer seconds, in the order damage actually eats them */
  perLayer: {
    name: string; seconds: number | null; ehp: number; dps: number;
    /** raw HP/s this layer repairs, when it does */
    repairHps?: number;
  }[];
  /** the effective HP of the whole ship AGAINST THIS ATTACKER's damage mix —
   * not against an even split, and not against a named profile */
  ehpVsThisDamage: number;
}

/**
 * Seconds to strip shield, then armour, then hull, each against its own
 * resistances and against the ACTUAL damage mix arriving.
 *
 * Repair enters as each module's DUTY-CYCLE AVERAGE (reload gaps amortised)
 * with the engine's measured capacitor deadline as a hard stop. That is the
 * honest limit of a closed form: it cannot see a volley landing inside an
 * armour repairer's end-of-cycle window or an ancillary's 60-second silence.
 * The discrete event simulation (battleEvents.ts) models those exactly and is
 * the headline; this remains the quick per-layer breakdown beside it.
 */
export function timeToKill(
  weapons: SimWeapon[], target: SimTarget, e: Engagement, layers: Layer[], sustained = true,
  /** the target's own repair. Omit for a ship that does not rep. */
  defenses: Defenses = NO_DEFENSES,
): TimeToKill {
  const landed = landedDamagePerSecond(weapons, target, e, sustained);
  const perLayer: TimeToKill['perLayer'] = [];
  let total = 0;
  let dead = false;
  let ehpTotal = 0;
  const repairFor = (name: string) =>
    (name === 'Shield' ? (defenses.shieldRepairHps ?? 0)
      : name === 'Armor' ? (defenses.armorRepairHps ?? 0)
        // hull repairers exist (effect 26, attr 83) and counted for nothing
        // here for a year — a hull-tanked ship deserves its repper too
        : (defenses.hullRepairHps ?? 0));
  for (const layer of layers) {
    const dps = afterResists(landed, layer.resonance);
    // effective HP of THIS layer against THIS damage mix
    const incoming = totalDamage(landed);
    const ehp = incoming > 0 ? (layer.hp * incoming) / Math.max(dps, 1e-12) : layer.hp;
    ehpTotal += Number.isFinite(ehp) ? ehp : layer.hp;
    // BOTH SIDES ARE RAW HP PER SECOND and compare directly: afterResists
    // already returns the HP actually stripped per second, and a booster
    // restores raw HP. No conversion, and converting would double-count the
    // resistance that afterResists has applied.
    const rawRepair = repairFor(layer.name);
    // the capacitor is SHARED and does not reset per layer, so the deadline is
    // measured from the START OF THE FIGHT, not from the start of this layer
    // passive regen only exists on the shield, and never runs out
    // ?? 0 is load-bearing: a Defenses built before this field existed would
    // otherwise make rawRepair + free NaN, which silently reports NO repair
    // at all rather than the active repair it does have
    const free = layer.name === 'Shield' ? (defenses.shieldPassiveHps ?? 0) : 0;
    const secs = layerSeconds(layer.hp, dps, rawRepair, defenses.capOutSeconds, total, free);
    perLayer.push({
      name: layer.name, seconds: secs, ehp, dps,
      repairHps: rawRepair + free > 0 ? rawRepair + free : undefined,
    });
    if (secs === null) { dead = true; continue; }
    total += secs;
  }
  return { seconds: dead ? null : total, perLayer, ehpVsThisDamage: ehpTotal };
}

/** the three layers of a fit, from the engine's own hull result */
export function layersOf(hp: { shield: number; armor: number; structure: number }, r: ResonanceLayers): Layer[] {
  return [
    { name: 'Shield', hp: hp.shield, resonance: r.shield },
    { name: 'Armor', hp: hp.armor, resonance: r.armor },
    { name: 'Hull', hp: hp.structure, resonance: r.structure },
  ];
}

// ---------------------------------------------------------------------------
// GEOMETRY — what the pilots are DOING, turned into what the guns experience
// ---------------------------------------------------------------------------

export type Behaviour = 'orbit' | 'keepAtRange' | 'approach' | 'stationary';

/**
 * A HEADING, in degrees, measured from the line running to the target.
 *
 *     0   = straight at it        — all speed radial, NO transversal
 *    90   = across, one way       — all speed tangential (a perfect orbit)
 *   180   = straight away         — all speed radial, still no transversal
 *   270   = across, the other way — tangential, opposite rotation
 *
 * A ship can fly in ANY direction, which four presets could never express. The
 * signed sine is what makes two ships composable honestly: co-rotating (both
 * near 90) their transversals CANCEL, counter-rotating (90 against 270) they
 * ADD. That used to be my assumption; now it is the player's.
 */
export const PRESET_ANGLE: Record<Behaviour, number> = {
  approach: 0, orbit: 90, keepAtRange: 0, stationary: 0,
};

const rad = (deg: number) => (deg * Math.PI) / 180;

/** the component of a ship's velocity ACROSS the line of sight (signed) */
export const tangentialOf = (speed: number, angleDeg: number): number =>
  speed * Math.sin(rad(angleDeg));

/** the component ALONG it: positive closes the distance, negative opens it */
export const radialOf = (speed: number, angleDeg: number): number =>
  speed * Math.cos(rad(angleDeg));

export const BEHAVIOUR_LABEL: Record<Behaviour, string> = {
  orbit: 'orbiting',
  keepAtRange: 'keeping range',
  approach: 'closing',
  stationary: 'not moving',
};

/** how much of a ship's speed is across the line of sight, from a preset */
export function tangentialSpeed(behaviour: Behaviour, shipSpeed: number): number {
  return Math.abs(tangentialOf(shipSpeed, PRESET_ANGLE[behaviour]));
}

/** the speed that matters to a MISSILE — its explosion velocity is raced
 * against how fast the target moves, in ANY direction */
export function movingSpeed(behaviour: Behaviour, shipSpeed: number): number {
  return behaviour === 'stationary' ? 0 : Math.max(0, shipSpeed);
}

export interface Flying {
  /** m/s the ship is ACTUALLY doing — not necessarily its maximum */
  speed: number;
  /** heading relative to the line to the other ship, degrees */
  angleDeg: number;
}

export interface Geometry {
  engagement: Engagement;
  /** derived, and SHOWN — the player should be able to check our arithmetic */
  transversal: number;
  /** rad/s, the number the tracking formula actually consumes */
  angularVelocity: number;
  /** m/s the gap is closing (negative = opening) */
  closingSpeed: number;
  /** the target's speed as the missile formula sees it */
  targetSpeed: number;
}

/**
 * Turn two flying ships into one engagement.
 *
 * The transversal a turret experiences is the RELATIVE tangential velocity, so
 * the two contributions are SUBTRACTED as signed quantities: same rotational
 * direction cancels, opposite adds. No worst-case assumption is baked in.
 */
export function geometryFrom(
  attacker: Flying & { range: number },
  target: Flying,
  droneOrbit: number,
  droneControlRange?: number,
): Geometry {
  const transversal = Math.abs(
    tangentialOf(attacker.speed, attacker.angleDeg) - tangentialOf(target.speed, target.angleDeg),
  );
  const distance = Math.max(0, attacker.range);
  return {
    engagement: { distance, transversal, droneOrbit, droneControlRange },
    transversal,
    angularVelocity: distance > 0 ? transversal / distance : 0,
    // each dial reads 0° = toward the OTHER ship (mirrored frames), so the
    // gap closes at the SUM: head-on at v each closes at 2v, a tail chase at
    // equal speeds cancels. The original SUBTRACTION here was dead code that
    // nothing consumed until the event sim grew motion — and the sign was
    // wrong the moment it went live (a fleeing target pulled the range IN).
    closingSpeed: radialOf(attacker.speed, attacker.angleDeg) + radialOf(target.speed, target.angleDeg),
    targetSpeed: Math.abs(target.speed),
  };
}

/** BACK-COMPAT: the preset form, expressed through the angle model */
export function geometryOf(
  attacker: { behaviour: Behaviour; speed: number; range: number },
  target: { behaviour: Behaviour; speed: number },
  droneOrbit: number,
  droneControlRange?: number,
): Geometry {
  return geometryFrom(
    {
      speed: attacker.behaviour === 'stationary' ? 0 : attacker.speed,
      angleDeg: PRESET_ANGLE[attacker.behaviour],
      range: attacker.range,
    },
    {
      speed: target.behaviour === 'stationary' ? 0 : target.speed,
      // the presets never expressed a direction, so two orbiting ships were
      // ADDED as a worst case; opposing them here preserves that reading
      angleDeg: target.behaviour === 'orbit' ? 270 : PRESET_ANGLE[target.behaviour],
    },
    droneOrbit,
    droneControlRange,
  );
}

// ---------------------------------------------------------------------------
// LOCAL REPAIR — the tank that was missing
// ---------------------------------------------------------------------------

export interface Defenses {
  /** HP per second, post-skill, post-overheat, straight from the engine */
  shieldRepairHps: number;
  armorRepairHps: number;
  /**
   * PEAK passive shield regeneration, which costs no capacitor and therefore
   * has NO deadline — a passive tank keeps going after a booster has run dry.
   *
   * Peak is reached at about 25-30% shield, not at full, so this is the number
   * a passive fit is designed around rather than an average over the whole
   * bar. Every fitting tool quotes the peak; the UI says which it is.
   */
  shieldPassiveHps: number;
  /**
   * Seconds until the capacitor runs dry, or null when it is stable.
   *
   * This is the honest limit on repair: a repairer runs on capacitor, and the
   * engine already simulates the capacitor tick by tick. Reps therefore run at
   * full duty up to a MEASURED hard stop rather than forever — which is what
   * made time-to-kill unusable for a shield-tanked ship, and what previously
   * made me refuse to model reps at all.
   */
  capOutSeconds: number | null;
  /**
   * HULL repair, which nothing modelled before. A hull repairer is the last
   * layer's tank and was simply absent from the defence picture.
   */
  hullRepairHps?: number;
  /**
   * THE UNDIVIDED TRUTH — every local repair module as an amount and a
   * duration, never a rate. The averages above are derived FROM this and are
   * kept only for the closed-form time-to-kill; the discrete simulation reads
   * these instead.
   */
  cycles?: RepairCycle[];
  /**
   * hp/s while everything is actually cycling, as opposed to the duty-cycle
   * average above. For an ancillary module the two differ enormously: a Large
   * Ancillary Shield Booster restores 390 every 4 s for three cycles (97.5
   * hp/s) and then stands idle for 60 seconds (16.2 hp/s averaged). Which
   * number is right depends entirely on how long the fight lasts, which is
   * why the simulation must have both.
   */
  burst?: { shield: number; armor: number; hull: number };
  /** repair modules we could see but could not score — never silently zero */
  refused?: RepairRefusal[];
  /** the capacitor as a quantity, for the simulation to spend and recharge */
  capacitor?: CapacitorModel;
  /** loaded capacitor boosters — injection the ENGINE ignores entirely
   * (hull -5/-7 measured unchanged to 1e-15 with a loaded Heavy CB II), so
   * the simulation is the only place this energy exists */
  capBoosters?: CapBoosterCycle[];
  /** passive-regen time constant, seconds (shieldRechargeRate 479 / 1000) —
   * the event sim runs the true level-dependent curve from this */
  shieldRechargeSeconds?: number;
  /** active resist hardeners' aggregate capacitor drain — the modules whose
   * failure COLLAPSES the resist profile (the sim pairs this with a second
   * engine pass computing the hardeners-offline resonance) */
  hardeners?: HardenerDrain | null;
}

export const NO_DEFENSES: Defenses = {
  shieldRepairHps: 0, armorRepairHps: 0, shieldPassiveHps: 0, capOutSeconds: null,
};

/**
 * LOCAL REPAIR, SUMMED FROM THE MODULES THEMSELVES.
 *
 * This used to read the hull's -49 and -45, which are the engine's own
 * pre-divided hp/s. That was wrong in a way that never showed up as an error,
 * only as a number:
 *
 *   THE ENGINE EMITS NEITHER FOR AN ANCILLARY MODULE. Measured on a Drake
 *   with a Large Ancillary Shield Booster: hull -49 is `undefined`. So every
 *   ASB and AAR fit this app has scored was credited with ZERO active tank,
 *   and an ancillary-buffered ship — one of the strongest short-fight tanks
 *   in the game — was being told it had none.
 *
 * The per-module attributes were there the whole time. Reading them also
 * picks up the ancillary armour multiplier the engine does not apply, and
 * hull repairers, which nothing counted at all.
 */
export function defensesOf(result: EngineResult): Defenses {
  const h = result.hull.attributes;
  const dry = num(h, A.capDepletesIn, -1);
  const shieldHp = num(h, A.shieldCapacity);
  const rechargeMs = num(h, A.shieldRechargeRate);
  const { cycles, refused } = repairCycles(result);

  return {
    // the duty-cycle average, so a long fight sees the reload gaps
    shieldRepairHps: dutyHpsOf(cycles, 'shield'),
    armorRepairHps: dutyHpsOf(cycles, 'armor'),
    hullRepairHps: dutyHpsOf(cycles, 'hull'),
    shieldPassiveHps: rechargeMs > 0 ? (2.5 * shieldHp) / (rechargeMs / 1000) : 0,
    capOutSeconds: dry >= 0 ? dry : null,
    cycles,
    burst: {
      shield: burstHpsOf(cycles, 'shield'),
      armor: burstHpsOf(cycles, 'armor'),
      hull: burstHpsOf(cycles, 'hull'),
    },
    refused,
    capacitor: capacitorOf(result),
    capBoosters: capBoosters(result),
    shieldRechargeSeconds: rechargeMs > 0 ? rechargeMs / 1000 : undefined,
    hardeners: hardenerDrain(result),
  };
}

/**
 * How long a layer survives when it is being repaired AND the repair has a
 * deadline.
 *
 * Two phases, because the capacitor does run out: full repair until capOut,
 * then none. Returns null when the layer genuinely never falls — i.e. repair
 * outpaces damage and the capacitor is stable. `elapsed` is how much of the
 * fight has already been spent on earlier layers, since the capacitor is
 * shared and does not reset between them.
 */
export function layerSeconds(
  hp: number, incomingDps: number, repairHps: number,
  capOutSeconds: number | null, elapsed: number,
  /** repair that costs no capacitor and therefore never stops — passive
   * shield regeneration. It applies in BOTH phases. */
  freeRepairHps = 0,
): number | null {
  if (hp <= 0) return 0;
  const effectiveIncoming = incomingDps - freeRepairHps;
  // passive regen alone can hold the layer forever
  if (effectiveIncoming <= 0) return null;
  if (incomingDps <= 0) return null;
  const netWhileRepping = effectiveIncoming - repairHps;
  // the capacitor may already be dry by the time damage reaches this layer
  const repLeft = capOutSeconds === null ? Infinity : Math.max(0, capOutSeconds - elapsed);
  if (repLeft <= 0) return hp / effectiveIncoming;
  if (netWhileRepping <= 0) {
    // repair is winning — the layer only falls once the capacitor gives out
    if (repLeft === Infinity) return null;
    return repLeft + hp / effectiveIncoming;
  }
  const strippedWhileRepping = netWhileRepping * repLeft;
  if (strippedWhileRepping >= hp) return hp / netWhileRepping;
  return repLeft + (hp - strippedWhileRepping) / effectiveIncoming;
}
