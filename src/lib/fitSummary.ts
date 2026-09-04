// THE NUMBERS A FIT IS ACTUALLY JUDGED BY — damage, tank, speed, targeting
// — computed from the dogma engine's own per-item results (post-skills,
// post-stacking), not from raw SDE values.
//
// STATED ASSUMPTIONS (shown in the UI, never hidden):
//  · `dps` is ALPHA: every ACTIVE weapon firing with a full clip, drones in
//    space, overheated modules using their overloaded numbers. `dpsSustained`
//    amortises the reload — for five Rapid Light Missile Launcher IIs that is
//    the difference between 247.50 and 160.39.
//  · EHP uses an even 25/25/25/25 damage profile (the engine's default).
//  · Weapon range/tracking/application are NOT modelled — this is raw
//    output, the same caveat every "paper DPS" number carries.

// chargeCount, not a bare read: the engine's -8 is a raw capacity/volume
// division that needs a floor WITH tolerance. moduleCycle imports only TYPES
// from here, so the cycle is erased at compile time.
import { chargeCount } from './moduleCycle';

/** attribute ids (verified against the bundled data) */
const A = {
  damageMultiplier: 64,
  cycleSpeed: 51,
  duration: 73,
  em: 114,
  explosive: 116,
  kinetic: 117,
  thermal: 118,
  shieldCapacity: 263,
  armorHP: 265,
  structureHP: 9,
  shieldRes: [271, 272, 273, 274], // em, explosive, kinetic, thermal
  armorRes: [267, 268, 269, 270],
  hullRes: [113, 111, 109, 110],
  maxVelocity: 37,
  mass: 4,
  agility: 70,
  warpSpeedMultiplier: 600,
  baseWarpSpeed: 1281,
  maxTargetRange: 76,
  scanResolution: 564,
  signatureRadius: 552,
  maxLockedTargets: 192,
  droneBandwidth: 1271,
  droneCapacity: 283,
  // range/application, verified against the bundled data:
  optimal: 54,        // maxRange
  falloff: 158,
  tracking: 160,      // trackingSpeed
  flightTime: 281,    // explosionDelay, ms — missiles
  // ENGINE PSEUDO-ATTRIBUTES (negative ids the dogma engine synthesizes; they
  // are not in the SDE). Measured on the shipped wasm, see dpsSustained.
  chargeAmount: -8,        // rounds in the clip
  reloadTime: -15,         // ms
  cycleWithReload: -16,    // ms — one cycle amortising the reload
};

export interface EngineItem {
  type_id: number;
  state?: string;
  slot?: { type?: string } | string;
  attributes: unknown;
  charge?: { type_id: number; attributes: unknown } | null;
  /** effect ids the engine resolved for this item — verified: a Large Shield
   * Booster II comes back as [4, 13, 16]. The only exact way to tell a LOCAL
   * repairer from a remote one, since both carry the same repair attributes. */
  effects?: number[];
}

export interface EngineResult {
  hull: { attributes: unknown };
  items: EngineItem[];
}

const val = (attributes: unknown, id: number): number | undefined => {
  let e: { value?: number | null; base_value?: number } | undefined;
  if (attributes instanceof Map) e = attributes.get(id) as typeof e;
  else if (attributes && typeof attributes === 'object') e = (attributes as Record<string, typeof e>)[String(id)];
  if (!e) return undefined;
  const v = e.value ?? e.base_value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
const num = (attributes: unknown, id: number, dflt = 0): number => val(attributes, id) ?? dflt;

const damageSum = (attributes: unknown): number =>
  num(attributes, A.em) + num(attributes, A.explosive) + num(attributes, A.kinetic) + num(attributes, A.thermal);

export interface WeaponLine {
  typeId: number;
  /** ALPHA dps — firing with a full clip, no reload. What every "paper DPS"
   * number in every fitting tool means. */
  dps: number;
  /** dps once RELOADING is counted. A Rapid Light Missile Launcher empties a
   * 20-missile clip in 3.2 s per shot and then stands idle for 17.5 s: five of
   * them measure 247.50 alpha and 160.39 sustained — a 35% overstatement that
   * this app printed for a year. Autocannons barely notice (134.42 → 128.09).
   *
   * Undefined when the weapon holds no charge and therefore never reloads. The
   * engine invents a 10 s reload for smartbombs, which is why this is derived
   * from OUR volley and the engine's cycle-with-reload rather than read from
   * its damage attributes. */
  dpsSustained?: number;
  /** rounds in a full clip (Types.capacity ÷ charge volume — reproduces the
   * engine's own chargeAmount bit-exactly) */
  clipSize?: number;
  reloadSeconds?: number;
  volley: number;
  /** the CHARGE loaded, when there is one — so the UI can say which ammo
   * produced these numbers instead of implying it is ammo-independent */
  chargeTypeId?: number;
  /** turrets: optimal + falloff, post-skills, from the engine's own numbers */
  optimal?: number;
  falloff?: number;
  tracking?: number;
  /** missiles: velocity × flight time, i.e. how far it actually reaches */
  missileRange?: number;
}

export interface FitSummary {
  /** ALPHA dps: every active weapon firing with a full clip */
  dps: number;
  /** dps with reloading counted, summed PER WEAPON. Never read from the hull's
   * own -13: that attribute double-counts smartbombs (a Rifter with one Small
   * EMP Smartbomb II measures hull -12 = 9.33 and hull -13 = 13.33 — sustained
   * above alpha, which is impossible). */
  dpsSustained: number;
  volley: number;
  /** per-weapon breakdown, biggest first */
  weapons: WeaponLine[];
  ehp: number;
  shieldEhp: number;
  armorEhp: number;
  structureEhp: number;
  shieldHp: number;
  armorHp: number;
  structureHp: number;
  maxVelocity: number;
  /** kg (attr 4) and the inertia modifier (attr 70) — the sim's acceleration
   * inputs: tau = agility·mass/1e6, v(t) = vmax(1 − e^(−t/tau)), verified
   * against the engine's own alignTime to 9 significant figures */
  mass: number;
  agility: number;
  /** seconds to align (the standard −ln(0.25)·agility·mass/1e6 identity) */
  alignTime: number;
  warpSpeed: number;
  targetRange: number;
  scanResolution: number;
  signatureRadius: number;
  lockedTargets: number;
  droneBandwidthUsed: number;
  droneBandwidth: number;
}

const isActive = (state?: string) => state === 'Active' || state === 'Overload';

/**
 * RELOADING, from the engine's own cycle arithmetic.
 *
 * Returns the seconds one cycle costs once the reload is amortised, or
 * undefined when the weapon does not reload at all.
 *
 * ONLY weapons that consume a charge reload. The engine hands back a 10 s
 * `speedOfReload` for a Small EMP Smartbomb II — a module with no clip, no
 * charge and no reloadTime in the SDE — which would understate it by 57%.
 * Drones do not reload either. So the presence of a real charge is the gate,
 * not the presence of the attribute.
 */
function reloadCycleSeconds(item: EngineItem): number | undefined {
  if (!item.charge) return undefined;
  const withReload = val(item.attributes, A.cycleWithReload);
  if (withReload === undefined || withReload <= 0) return undefined;
  return withReload / 1000;
}

/** one weapon's contribution, from the ENGINE's computed attributes */
function weaponDamage(item: EngineItem):
{ dps: number; volley: number; dpsSustained?: number; clipSize?: number; reloadSeconds?: number } | null {
  const cycleMs = num(item.attributes, A.cycleSpeed) || num(item.attributes, A.duration);
  if (cycleMs <= 0) return null;
  const mult = val(item.attributes, A.damageMultiplier) ?? 1;
  // turret/launcher: the CHARGE carries the damage; drones/smartbombs
  // carry it themselves
  const own = damageSum(item.attributes);
  const charge = item.charge ? damageSum(item.charge.attributes) : 0;
  const volley = charge > 0 ? charge * mult : own * mult;
  if (volley <= 0) return null;
  const reloadCycle = reloadCycleSeconds(item);
  return {
    dps: volley / (cycleMs / 1000),
    volley,
    // derived from OUR volley so it can never disagree with the alpha number
    // beside it — the engine's own -13 is double-counted on smartbombs
    dpsSustained: reloadCycle !== undefined ? volley / reloadCycle : undefined,
    // WHOLE rounds, not the engine's raw capacity/volume float. A 425mm
    // AutoCannon II comes back as 119.99999821186069; flooring it loses a
    // round on every reload, and rounding it would give an ancillary module
    // half a charge it cannot hold. See chargeCount for the measurements.
    clipSize: chargeCount(val(item.attributes, A.chargeAmount)),
    reloadSeconds: reloadCycle !== undefined
      ? (val(item.attributes, A.reloadTime) ?? 0) / 1000
      : undefined,
  };
}

export function summarize(result: EngineResult): FitSummary {
  const h = result.hull.attributes;
  const weapons: WeaponLine[] = [];
  let dps = 0;
  let dpsSustained = 0;
  let volley = 0;
  let droneBandwidthUsed = 0;
  for (const item of result.items) {
    const slotType = typeof item.slot === 'string' ? item.slot : item.slot?.type;
    // 'DroneBay' is what the engine actually reports (verified against the
    // shipped wasm). The old test — undefined or 'None' — matched NOTHING, so
    // droneBandwidthUsed here was always 0 for every fit ever scored.
    const isDrone = slotType === 'DroneBay';
    if (!isActive(item.state)) continue;
    const d = weaponDamage(item);
    if (d) {
      dps += d.dps;
      // a weapon that never reloads contributes its full alpha to the
      // sustained total — it genuinely does sustain it
      dpsSustained += d.dpsSustained ?? d.dps;
      volley += d.volley;
      // range comes from the ENGINE's post-skill numbers, and for missiles
      // from the charge itself (velocity × flight time)
      const optimal = val(item.attributes, A.optimal);
      const falloff = val(item.attributes, A.falloff);
      const tracking = val(item.attributes, A.tracking);
      const mv = item.charge ? val(item.charge.attributes, A.maxVelocity) : undefined;
      const ft = item.charge ? val(item.charge.attributes, A.flightTime) : undefined;
      weapons.push({
        typeId: item.type_id,
        dps: d.dps,
        dpsSustained: d.dpsSustained,
        clipSize: d.clipSize,
        reloadSeconds: d.reloadSeconds,
        volley: d.volley,
        chargeTypeId: item.charge?.type_id,
        optimal,
        falloff,
        tracking,
        missileRange: mv !== undefined && ft !== undefined ? (mv * ft) / 1000 : undefined,
      });
    }
    if (isDrone) droneBandwidthUsed += num(item.attributes, A.droneBandwidth);
  }
  weapons.sort((a, b) => b.dps - a.dps);

  /** average effective HP across an even damage profile */
  const layerEhp = (hp: number, resIds: number[]): number => {
    const res = resIds.map((id) => num(h, id, 1));
    const avgRes = res.reduce((s, r) => s + r, 0) / res.length;
    return avgRes > 0 ? hp / avgRes : hp;
  };
  const shieldHp = num(h, A.shieldCapacity);
  const armorHp = num(h, A.armorHP);
  const structureHp = num(h, A.structureHP);
  const shieldEhp = layerEhp(shieldHp, A.shieldRes);
  const armorEhp = layerEhp(armorHp, A.armorRes);
  const structureEhp = layerEhp(structureHp, A.hullRes);

  const mass = num(h, A.mass);
  const agility = num(h, A.agility);
  // align completes at 75% of max speed ⇒ −ln(0.25) = ln(4) ≈ 1.386
  // (ln 2 is the half-life and gave a Rifter an impossible 1.6 s)
  const alignTime = mass > 0 && agility > 0 ? (Math.log(4) * agility * mass) / 1_000_000 : 0;

  return {
    dps, dpsSustained, volley, weapons,
    ehp: shieldEhp + armorEhp + structureEhp,
    shieldEhp, armorEhp, structureEhp,
    shieldHp, armorHp, structureHp,
    maxVelocity: num(h, A.maxVelocity),
    mass,
    agility,
    alignTime,
    warpSpeed: num(h, A.baseWarpSpeed, 1) * num(h, A.warpSpeedMultiplier, 1),
    targetRange: num(h, A.maxTargetRange),
    scanResolution: num(h, A.scanResolution),
    signatureRadius: num(h, A.signatureRadius),
    lockedTargets: num(h, A.maxLockedTargets),
    droneBandwidthUsed,
    droneBandwidth: num(h, A.droneBandwidth),
  };
}
