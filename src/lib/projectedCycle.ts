// WHAT ONE SHIP DOES *TO ANOTHER* — webs, painters, disruptors, neuts,
// nosferatu, scrams, remote repair, cap transfer.
//
// The vendored engine computes one fit in isolation and every projected-EWAR
// effect in the bundle has an EMPTY modifierInfo (measured twice, two
// sessions), so the application rules are OURS by construction. What IS in
// the data — and is read here rather than declared — is everything else:
// which effect id marks each class, the strength/cycle/cap/range/falloff
// values (engine-final, so hull and skill bonuses are already folded in:
// a Painter II's falloff is 135,000 m after Signature Focusing, not the raw
// 90,000; a Web II on an Immobility-Drivers Loki reaches 22,500 m), which
// hull attribute resists each class, and whether the attribute a chain
// modifies is stacking-penalized (all eight EWAR targets are).
//
// PURE — consumes EngineResult items exactly like moduleCycle does, so
// fixtures run the shipped arithmetic under node.
//
// MEASURED 2026-08-10 against engine v10.4.20260609, all-V, recorded in
// LEARNINGS/API-NOTES.md. Carrier counts per effect id are from a full
// published-type census.
import type { EngineResult } from './fitSummary';
import { chargeCount, type ChargeSupply } from './moduleCycle';
import { DBUFF_TABLE } from './dbuffTable';

export type ProjKind =
  | 'web' | 'painter' | 'trackingDisruptor' | 'guidanceDisruptor'
  | 'neut' | 'nos' | 'scram' | 'point'
  | 'remoteShield' | 'remoteArmor' | 'remoteHull' | 'capTransfer'
  | 'damp' | 'remoteSensorBooster' | 'ecm' | 'burstJam';

/**
 * The effect-id map — the same discrimination rule repair uses (4/27/26).
 * Drone variants (6690/6692/6691) are included: the engine returns drones as
 * ordinary items with skill-folded finals, so they extract for free.
 */
export const PROJECTED_EFFECT: Record<number, ProjKind> = {
  6426: 'web',               // remoteWebifierFalloff — 30 types incl. all 8 Heavy Stasis Grapplers
  6690: 'web',               // remoteWebifierEntity — 7 web drones
  6425: 'painter',           // remoteTargetPaintFalloff — 9
  6692: 'painter',           // remoteTargetPaintEntity — 6 painter drones
  6424: 'trackingDisruptor', // shipModuleTrackingDisruptor — 6
  6423: 'guidanceDisruptor', // shipModuleGuidanceDisruptor — 7
  6187: 'neut',              // energyNeutralizerFalloff — 57
  6691: 'neut',              // entityEnergyNeutralizerFalloff — 6 neut drones (range 98, duration 942)
  6197: 'nos',               // energyNosferatuFalloff — 58
  5934: 'scram',             // warpScrambleBlockMWDWithNPCEffect — 28 (see note below)
  39: 'point',               // warpDisrupt — 29; warp-only, inert in a sim with no warping
  6186: 'remoteShield',      // shipModuleRemoteShieldBooster — 44
  6652: 'remoteShield',      // ancillary remote shield — 4
  6188: 'remoteArmor',       // shipModuleRemoteArmorRepairer — 45
  6651: 'remoteArmor',       // ancillary remote armor — 4
  7166: 'remoteArmor',       // mutadaptive — 5 (spool attrs 2796/2797)
  6185: 'remoteHull',        // shipModuleRemoteHullRepairer — 8
  6184: 'capTransfer',       // shipModuleRemoteCapacitorTransmitter — 37
  6422: 'damp',              // remoteSensorDampFalloff — strengths 309/566, resist 2112
  6693: 'damp',              // remoteSensorDampEntity — SD drones (no falloff)
  6427: 'remoteSensorBooster', // remoteSensorBoostFalloff — assist, resist 2135
  6470: 'ecm',               // remoteECMFalloff — 43 ship modules (+12 POS batteries)
  6695: 'ecm',               // entityECMFalloff — EC drones: cycle 929, range 936, 5 s jam 2822
  6714: 'burstJam',          // ECMBurstJammer — untargeted AoE, range attr 142
};

/**
 * Classes we can SEE but deliberately do not simulate, each with its stated
 * reason. A fitted module silently dropped changes who wins — these are
 * surfaced exactly like repair refusals.
 */
export const REFUSED_PROJECTED: Record<number, string> = {
  6428: 'remote tracking computer — assist buffs not yet modelled',
  3380: 'warp disruption field generator — HIC bubbles, warp-only',
};

/**
 * THE SCRAM EXTRACTION TRAP, measured: the engine STRIPS effects that carry
 * modifierInfo from item.effects — and scram 5934 is the only projected
 * effect that has any. A Warp Scrambler II's engine item reads [13, 16]:
 * indistinguishable from a plain disruptor by effects alone. The scram is
 * identified by attribute 1350 `activationBlockedStrenght` on the item
 * (present only on scrams among category-7 modules; every published 5934
 * carrier has 1350 = 1).
 *
 * The block rule itself IS in the data (the one projected effect with
 * modifierInfo): items requiring skill 3454 High Speed Maneuvering get
 * 1349 += the scram's 1350. MWDs require 3454; afterburners (3450) are
 * exempt by the data's own filter. Warp points (105) are a separate number —
 * a Heavy Warp Scrambler II is 105=6, 1350=1.
 */
export const SCRAM_MARKER_ATTR = 1350;

/** attribute ids read off engine items (all verified present) */
const A = {
  duration: 73,
  droneNeutDuration: 942,   // neut DRONES cycle on 942, not 73
  capacitorNeed: 6,
  optimal: 54,
  droneNeutOptimal: 98,     // and range on 98, not 54 (54 reads 0 — a silent range loss)
  falloff: 2044,            // falloffEffectiveness — EWAR falloff. 158 is 0/absent on EWAR.
  resistPointer: 2138,      // remoteResistanceID on the MODULE (web→2115, painter→2114)
  webStrength: 20,          // speedFactor
  painterStrength: 554,     // signatureRadiusBonus
  tdTracking: 767, tdOptimal: 351, tdFalloff: 349,
  gdMissileVelocity: 547, gdFlightTime: 596, gdExpVelocity: 847, gdExpRadius: 848,
  neutAmount: 97,           // energyNeutralizerAmount
  nosAmount: 90,            // powerTransferAmount (also cap transfer's amount)
  shieldAmount: 68, armorAmount: 84, hullAmount: 83,
  chargedArmorMultiplier: 1886,
  chargeRate: 56,
  chargeAmount: -8,
  reloadTime: 1795,
  spoolPerCycle: 2796,      // repairMultiplierBonusPerCycle (mutadaptive)
  spoolMax: 2797,
  warpScrambleStrength: 105,
  // sensor warfare (all engine-final on items)
  scanResBonus: 566,        // damp/RSB: modifies victim 564
  targetRangeBonus: 309,    // damp/RSB: modifies victim 76
  sensorStrengthPct: [1027, 1028, 1029, 1030] as unknown as number, // RSB ECCM side
  ecmGrav: 238, ecmLadar: 239, ecmMag: 240, ecmRadar: 241,
  droneEcmCycle: 929,       // ECMDuration ms — EC drones cycle on this, not 73
  droneEcmOptimal: 936,     // and range on this, not 54
  droneJamDuration: 2822,   // = 5000 ms: a drone jam lasts 5 s of its 20 s cycle
} as const;

/**
 * Victim resist gate per kind. TD/GD/neut/nos/remote carry it on the EFFECT
 * row (resistanceAttributeID); web and painter rows say 0 and the MODULE
 * carries pointer 2138 instead — both measured. The resolved TARGET attrs:
 */
export const RESIST_ATTR: Partial<Record<ProjKind, number>> = {
  damp: 2112,               // sensorDampenerResistance (via module attr 2138)
  remoteSensorBooster: 2135, // remoteAssistanceImpedance
  ecm: 2253,                // ecmResistance — 1.0 on every normal subcap
  burstJam: 2253,
  web: 2115,                // stasisWebifierResistance
  painter: 2114,            // targetPainterResistance
  trackingDisruptor: 2113,  // weaponDisruptionResistance
  guidanceDisruptor: 2113,
  neut: 2045,               // energyWarfareResistance (present on hulls, default 1)
  nos: 2045,
  remoteShield: 2116,       // remoteRepairImpedance
  remoteArmor: 2116,
  remoteHull: 2116,
  capTransfer: 2116,
};

/**
 * The attributes projected chains MODIFY, with their stacking flag as read
 * from dogmaAttributes: every one is stackable=false (measured census), so
 * every projected chain is penalized. Kept as data-derived constants with
 * provenance rather than a runtime lookup, so this module stays pure.
 */
export const MODIFIED_STACKABLE: Record<number, boolean> = {
  37: false,   // maxVelocity (web)
  552: false,  // signatureRadius (painter)
  160: false,  // trackingSpeed (TD)
  54: false,   // maxRange (TD)
  158: false,  // falloff (TD)
  653: false,  // aoeVelocity (GD)
  654: false,  // aoeCloudSize (GD)
  281: false,  // explosionDelay / flight time (GD)
  564: false,  // scanResolution (damp/RSB)
  76: false,   // maxTargetRange (damp/RSB)
  208: false,  // sensor strengths (RSB ECCM side)
};

export interface ProjStrengthRow {
  /** the attribute this row MODIFIES on the victim/shooter */
  modifies: number;
  /** engine-final percentage, e.g. -60 for a Web II */
  value: number;
  /** from MODIFIED_STACKABLE — true means multiply raw, false means s(k) */
  stackable: boolean;
}

export interface ProjectedModule {
  typeId: number;
  kind: ProjKind;
  slotKey?: string;
  cycleSeconds: number;
  capPerCycle: number;
  /** engine-final optimal (54; 98 for neut drones) */
  optimal: number;
  /** engine-final falloffEffectiveness (2044). 0 = hard cutoff at optimal —
   * note a plain Web II is 0 but a Heavy Stasis Grappler II is 10,000: the
   * same effect id spans both, so this must be per-item, never per-class */
  falloff: number;
  /** hull attribute on the VICTIM that scales this module's strength */
  resistAttr?: number;
  /** EWAR strength rows (web/painter/TD/GD) */
  rows?: ProjStrengthRow[];
  /** GJ per cycle removed (neut) or drained (nos) */
  drainGj?: number;
  /** GJ per cycle delivered to an ally (cap transfer) */
  transferGj?: number;
  /** scram: adds to the victim prop's activationBlocked; blocked while Σ>0 */
  blockStrength?: number;
  /** warp points — carried for display; warp is not simulated */
  warpPoints?: number;
  /**
   * ECM payload: the four racial jam strengths, engine-final (hull bonuses
   * folded — a Falcon's Grav ECM II reads 12.5 where an unbonused hull reads
   * 5.0). The roll pairs the strength attr to the VICTIM's sensor attr:
   * 238→211 grav, 239→209 ladar, 240→210 magnetometric, 241→208 radar.
   */
  jamStrength?: { grav: number; ladar: number; mag: number; radar: number };
  /** a successful jam lasts this long — the module cycle (20 s), except EC
   * drones whose jam is 5 s of a 20 s cycle (attr 2822, declared Jan-2019) */
  jamSeconds?: number;
  /** remote repair payload */
  rep?: {
    layer: 'shield' | 'armor' | 'hull';
    /** engine-final, WITH the ancillary paste multiplier applied when loaded
     * (1886 = 3 — the engine does not apply it, same bug-shape as the local
     * AAR, measured: LARAR reports 290, repairs 870) */
    amount: number;
    timing: 'start' | 'end';
    charges: ChargeSupply | null;
    /** mutadaptive ramp — 2796 = 0.1/cycle, max 2797 = 1.5, measured */
    spool?: { perCycle: number; max: number };
  };
}

export interface ProjRefusal {
  typeId: number;
  why: string;
}

const val = (attributes: unknown, id: number): number | undefined => {
  let e: { value?: number | null; base_value?: number } | undefined;
  if (attributes instanceof Map) e = attributes.get(id) as typeof e;
  else if (attributes && typeof attributes === 'object') {
    e = (attributes as Record<string, typeof e>)[String(id)];
  }
  if (!e) return undefined;
  const v = e.value ?? e.base_value;
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

const isActive = (state?: string): boolean => {
  const s = (state ?? '').toLowerCase();
  return s === 'active' || s === 'overload' || s === 'overloaded';
};

const row = (modifies: number, value: number | undefined): ProjStrengthRow | null =>
  (value !== undefined && value !== 0
    ? { modifies, value, stackable: MODIFIED_STACKABLE[modifies] ?? false }
    : null);

/**
 * Every projected module on a fit, engine-final, plus the ones we refuse.
 *
 * Extraction mirrors repairCycles: keyed by effect id off item.effects, with
 * the scram special case (its effect is stripped because it carries
 * modifierInfo — the ONLY one that does — so attribute 1350 marks it).
 */
export function projectedCycles(result: EngineResult): {
  projected: ProjectedModule[];
  refused: ProjRefusal[];
} {
  const projected: ProjectedModule[] = [];
  const refused: ProjRefusal[] = [];

  for (const item of result.items) {
    if (!isActive(item.state)) continue;
    const effects = (item as { effects?: number[] }).effects;
    const slotType = typeof item.slot === 'string' ? item.slot : item.slot?.type;
    const slotIndex = typeof item.slot === 'object' ? (item.slot as { index?: number })?.index : undefined;
    const slotKey = slotType ? `${slotType}${slotIndex ?? ''}` : undefined;

    let kind: ProjKind | undefined;
    if (Array.isArray(effects)) {
      for (const e of effects) {
        const k = PROJECTED_EFFECT[e];
        if (k) { kind = k; break; }
        const why = REFUSED_PROJECTED[e];
        if (why) refused.push({ typeId: item.type_id, why });
      }
    }
    // the stripped-effect scram: marked by 1350 on the item
    if (!kind && val(item.attributes, SCRAM_MARKER_ATTR) !== undefined) kind = 'scram';
    if (!kind) continue;

    const isNeutDrone = kind === 'neut' && slotType === 'DroneBay';
    const durationMs = isNeutDrone
      ? val(item.attributes, A.droneNeutDuration)
      : val(item.attributes, A.duration);
    if (!durationMs || durationMs <= 0) {
      refused.push({ typeId: item.type_id, why: 'projected module publishes no cycle duration' });
      continue;
    }

    const base: ProjectedModule = {
      typeId: item.type_id,
      kind,
      slotKey,
      cycleSeconds: durationMs / 1000,
      capPerCycle: val(item.attributes, A.capacitorNeed) ?? 0,
      optimal: (isNeutDrone
        ? val(item.attributes, A.droneNeutOptimal)
        : val(item.attributes, A.optimal)) ?? 0,
      // absent and present-as-zero both occur in shipped data and both mean
      // "no falloff curve" (measured: web drones ABSENT, mutadaptive 0)
      falloff: val(item.attributes, A.falloff) ?? 0,
      resistAttr: RESIST_ATTR[kind],
    };

    switch (kind) {
      case 'web': {
        const r = row(37, val(item.attributes, A.webStrength));
        if (!r) { refused.push({ typeId: item.type_id, why: 'web with no speedFactor' }); continue; }
        base.rows = [r];
        break;
      }
      case 'painter': {
        const r = row(552, val(item.attributes, A.painterStrength));
        if (!r) { refused.push({ typeId: item.type_id, why: 'painter with no signature bonus' }); continue; }
        base.rows = [r];
        break;
      }
      case 'trackingDisruptor': {
        base.rows = [
          row(160, val(item.attributes, A.tdTracking)),
          row(54, val(item.attributes, A.tdOptimal)),
          row(158, val(item.attributes, A.tdFalloff)),
        ].filter((x): x is ProjStrengthRow => x !== null);
        break;
      }
      case 'guidanceDisruptor': {
        base.rows = [
          row(37, val(item.attributes, A.gdMissileVelocity)),   // missile velocity
          row(281, val(item.attributes, A.gdFlightTime)),       // flight time
          row(653, val(item.attributes, A.gdExpVelocity)),      // explosion velocity
          row(654, val(item.attributes, A.gdExpRadius)),        // explosion radius (+ = debuff)
        ].filter((x): x is ProjStrengthRow => x !== null);
        break;
      }
      case 'neut': {
        const amt = val(item.attributes, A.neutAmount);
        if (!amt) { refused.push({ typeId: item.type_id, why: 'neutralizer with no amount' }); continue; }
        base.drainGj = amt;
        break;
      }
      case 'nos': {
        const amt = val(item.attributes, A.nosAmount);
        if (!amt) { refused.push({ typeId: item.type_id, why: 'nosferatu with no amount' }); continue; }
        base.drainGj = amt;
        break;
      }
      case 'capTransfer': {
        const amt = val(item.attributes, A.nosAmount);
        if (!amt) { refused.push({ typeId: item.type_id, why: 'cap transmitter with no amount' }); continue; }
        base.transferGj = amt;
        break;
      }
      case 'damp': {
        base.rows = [
          row(564, val(item.attributes, A.scanResBonus)),
          row(76, val(item.attributes, A.targetRangeBonus)),
        ].filter((x): x is ProjStrengthRow => x !== null);
        if (base.rows.length === 0) {
          refused.push({ typeId: item.type_id, why: 'dampener with no strength attributes' });
          continue;
        }
        break;
      }
      case 'remoteSensorBooster': {
        base.rows = [
          row(564, val(item.attributes, A.scanResBonus)),
          row(76, val(item.attributes, A.targetRangeBonus)),
          // ECCM side: 1027-1030 raise the ally's sensor strengths equally —
          // carried as one row against the primary sensor attr family
          row(208, val(item.attributes, 1027)),
        ].filter((x): x is ProjStrengthRow => x !== null);
        break;
      }
      case 'burstJam': {
        const grav = val(item.attributes, A.ecmGrav) ?? 0;
        const ladar = val(item.attributes, A.ecmLadar) ?? 0;
        const mag = val(item.attributes, A.ecmMag) ?? 0;
        const radar = val(item.attributes, A.ecmRadar) ?? 0;
        if (grav + ladar + mag + radar <= 0) {
          refused.push({ typeId: item.type_id, why: 'burst jammer with no strength attributes' });
          continue;
        }
        base.jamStrength = { grav, ladar, mag, radar };
        // AoE radius is attr 142, not 54 (measured: Burst Jammer II 18,000
        // at all-V on an unbonused hull); no falloff — a hard bubble
        base.optimal = val(item.attributes, 142) ?? 0;
        base.falloff = 0;
        break;
      }
      case 'ecm': {
        const isDrone = slotType === 'DroneBay';
        const grav = val(item.attributes, A.ecmGrav) ?? 0;
        const ladar = val(item.attributes, A.ecmLadar) ?? 0;
        const mag = val(item.attributes, A.ecmMag) ?? 0;
        const radar = val(item.attributes, A.ecmRadar) ?? 0;
        if (grav + ladar + mag + radar <= 0) {
          refused.push({ typeId: item.type_id, why: 'jammer with no strength attributes' });
          continue;
        }
        base.jamStrength = { grav, ladar, mag, radar };
        if (isDrone) {
          // EC drones cycle on 929 and range on 936 — reading 73/54 would
          // silently zero their range (measured)
          const cyc = val(item.attributes, A.droneEcmCycle);
          const opt = val(item.attributes, A.droneEcmOptimal);
          if (cyc) base.cycleSeconds = cyc / 1000;
          if (opt !== undefined) base.optimal = opt;
          base.falloff = 0;
          const jam = val(item.attributes, A.droneJamDuration);
          base.jamSeconds = (jam ?? 5000) / 1000;
        } else {
          base.jamSeconds = base.cycleSeconds;
        }
        break;
      }
      case 'scram': {
        base.blockStrength = val(item.attributes, SCRAM_MARKER_ATTR) ?? 0;
        base.warpPoints = val(item.attributes, A.warpScrambleStrength);
        break;
      }
      case 'point': {
        base.warpPoints = val(item.attributes, A.warpScrambleStrength);
        break;
      }
      case 'remoteShield':
      case 'remoteArmor':
      case 'remoteHull': {
        const layer = kind === 'remoteShield' ? 'shield' : kind === 'remoteArmor' ? 'armor' : 'hull';
        // hull reps carry 83, NOT 68/84 — measured (a critic caught the
        // original design reading the wrong attribute for every hull rep)
        const amountAttr = layer === 'shield' ? A.shieldAmount
          : layer === 'armor' ? A.armorAmount : A.hullAmount;
        const amountRaw = val(item.attributes, amountAttr);
        if (!amountRaw || amountRaw <= 0) {
          refused.push({ typeId: item.type_id, why: 'remote repairer with no amount' });
          continue;
        }
        const loaded = !!item.charge;
        const reloadMs = val(item.attributes, A.reloadTime);
        const held = loaded ? chargeCount(val(item.attributes, A.chargeAmount)) : undefined;
        const perCycle = val(item.attributes, A.chargeRate) ?? 1;
        const spoolPer = val(item.attributes, A.spoolPerCycle);
        const spoolMax = val(item.attributes, A.spoolMax);
        // the ancillary-armor paste multiplier the engine does not apply
        const mult = layer === 'armor' && loaded
          ? (val(item.attributes, A.chargedArmorMultiplier) ?? 1) : 1;
        base.rep = {
          layer,
          amount: amountRaw * mult,
          timing: layer === 'shield' ? 'start' : 'end',
          charges: held !== undefined && reloadMs !== undefined && perCycle > 0
            ? {
              count: held,
              perCycle,
              cycles: Math.floor(held / perCycle),
              reloadSeconds: reloadMs / 1000,
            }
            : null,
          // spool attrs exist with value 0 on PLAIN remote armor reps —
          // presence is not a mutadaptive discriminator, a non-zero value is
          spool: spoolPer !== undefined && spoolPer > 0 && spoolMax !== undefined && spoolMax > 0
            ? { perCycle: spoolPer, max: spoolMax }
            : undefined,
        };
        break;
      }
    }
    projected.push(base);
  }

  return { projected, refused };
}

/**
 * The EWAR falloff law — DECLARED, not measured: the turret falloff curve
 * applied to effect strength, which is how the client scales EWAR beyond
 * optimal. Hard cutoff when the module has no falloff (a plain Web II);
 * a Heavy Stasis Grappler (−85%, 1 km optimal + 10 km falloff) genuinely
 * tapers — a binary gate would zero it at 1.5 km, flipping real fights.
 */
export function projFalloffScale(distance: number, optimal: number, falloff: number): number {
  if (distance <= optimal) return 1;
  if (falloff <= 0) return 0;
  const over = (distance - optimal) / falloff;
  return Math.pow(0.5, over * over);
}

// ---------------------------------------------------------------------------
// COMMAND BURSTS — fleet buffs, measured 2026-08-10
// ---------------------------------------------------------------------------
//
// The four burst families mark their modules with effects 6732 (armor) /
// 6733 (shield) / 6734 (skirmish) / 6735 (info), which SURVIVE on
// item.effects. The loaded charge writes the buff ids and multiplies the
// values onto the MODULE item — so the engine-final module attrs
// (2468→2469), (2470→2471), (2472→2473), (2536→2537) ARE the buffs, with
// hull bonuses, specialist skills, and mindlink implants already folded
// (measured chain: Shield Harmonizing −15 unbonused → −17.25 Vulture →
// −21.5625 with mindlink, digit-exact). buffDuration 2535 always outlives
// the 60 s cycle at any Command skill ≥ I.
//
// WITHOUT a charge the module's buff values are garbage (measured: all four
// = 2.15625 with no ids) — extraction REQUIRES a loaded charge. A buff id
// outside the vendored table (mining/expedition) SKIPS that module with a
// note, never the whole fit.

export const BURST_FAMILY_EFFECT = new Set([6732, 6733, 6734, 6735]);

export interface CommandBurst {
  typeId: number;
  slotKey?: string;
  cycleSeconds: number;
  capPerCycle: number;
  /** buff leases this burst emits each cycle, engine-final */
  buffs: { buffId: number; value: number }[];
  /** lease lifetime — engine-final 2535, ms→s (90 s at all-V, 129 s mindlinked) */
  buffSeconds: number;
  charges: ChargeSupply | null;
}

export function commandBursts(result: EngineResult): {
  bursts: CommandBurst[];
  notes: ProjRefusal[];
} {
  const bursts: CommandBurst[] = [];
  const notes: ProjRefusal[] = [];
  for (const item of result.items) {
    const effects = (item as { effects?: number[] }).effects;
    if (!Array.isArray(effects) || !effects.some((e) => BURST_FAMILY_EFFECT.has(e))) continue;
    if (!isActive(item.state)) continue;
    if (!item.charge) {
      notes.push({ typeId: item.type_id, why: 'command burst with no charge loaded — its buff values are meaningless without one (measured), so it emits nothing' });
      continue;
    }
    const pairs: [number, number][] = [[2468, 2469], [2470, 2471], [2472, 2473], [2536, 2537]];
    const buffs: { buffId: number; value: number }[] = [];
    let unknown: number | null = null;
    for (const [idAttr, valAttr] of pairs) {
      const buffId = val(item.attributes, idAttr);
      if (!buffId) continue;
      const v = val(item.attributes, valAttr);
      if (v === undefined) continue;
      buffs.push({ buffId, value: v });
      if (!(buffId in DBUFF_TABLE)) unknown = buffId;
    }
    if (unknown !== null) {
      // mining/expedition buffs land here — out of combat scope, stated
      notes.push({ typeId: item.type_id, why: `burst charge carries buff id ${unknown}, outside the vendored combat table — skipped` });
      continue;
    }
    if (buffs.length === 0) {
      notes.push({ typeId: item.type_id, why: 'command burst resolved no buff ids' });
      continue;
    }
    const durationMs = val(item.attributes, A.duration) ?? 60000;
    const buffMs = val(item.attributes, 2535) ?? durationMs;
    const reloadMs = val(item.attributes, A.reloadTime);
    const held = chargeCount(val(item.attributes, A.chargeAmount));
    const perCycle = val(item.attributes, A.chargeRate) ?? 1;
    bursts.push({
      typeId: item.type_id,
      cycleSeconds: durationMs / 1000,
      capPerCycle: val(item.attributes, A.capacitorNeed) ?? 0,
      buffs,
      buffSeconds: buffMs / 1000,
      charges: held !== undefined && reloadMs !== undefined && perCycle > 0
        ? { count: held, perCycle, cycles: Math.floor(held / perCycle), reloadSeconds: reloadMs / 1000 }
        : null,
    });
  }
  return { bursts, notes };
}
