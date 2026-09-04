// WHAT EACH MODULE ACTUALLY DOES, ONE CYCLE AT A TIME.
//
// Everything the app has read until now was a RATE: the engine's -49
// shieldBoostRate, -45 armorRepairRate, -15/-16 reload-amortised cycles. A
// rate is an amount divided by a duration, and the division is the entire
// problem — it is exactly the information a fight needs and the only
// information a rate has thrown away.
//
//   A Large Shield Booster II restores 276 hit points, all at once, every
//   4 seconds. As a rate that is "69 hp/s". Against a 1400mm artillery volley
//   that lands 11,000 damage in one instant, those are different ships.
//
// So this module reads the AMOUNT and the DURATION separately and never
// divides them. It is the input the discrete event simulation consumes, and
// it is also what fixes two numbers the app is getting wrong today.
//
// ---------------------------------------------------------------------------
// EVERY VALUE BELOW WAS MEASURED AGAINST THE SHIPPED WASM, NOT RECALLED.
// Measurements taken 2026-08-09, all-V skills, engine build v10.4.20260609.
// ---------------------------------------------------------------------------
//
// THE TWO BUGS THIS FIXES
//
//  1. ANCILLARY MODULES REPORTED ZERO TANK. The engine emits no -49 and no
//     -45 for them at all — measured: a Large Ancillary Shield Booster on a
//     Drake returns `undefined` for both, and defensesOf read only those. So
//     every ASB and AAR fit the app has ever scored was treated as having no
//     active repair whatsoever. Per-module attributes are present and
//     correct; only the pre-divided hull summary is missing.
//
//  2. THE CHARGE COUNT WAS A FRACTION. The engine's -8 `chargeAmount` is a
//     raw capacity/volume division, NOT a whole number of charges — see
//     `chargeCount` below, which is where the real subtlety lives.
//
// WHAT THE DATA CANNOT SAY, stated rather than guessed: the bundle does not
// record WHEN in its cycle a repairer applies. That a shield booster lands at
// the start of its cycle and an armour repairer at the end is game behaviour
// the owner supplied, and it is recorded here as a declared constant
// (`REPAIR_TIMING`) so it is visible and correctable rather than buried.
import type { EngineItem, EngineResult } from './fitSummary';

/** attribute ids, all verified present on real modules in the shipped bundle */
const A = {
  shieldBonus: 68,          // hp per cycle, shield boosters
  armorDamageAmount: 84,    // hp per cycle, armour repairers
  structureDamageAmount: 83, // hp per cycle, hull repairers
  duration: 73,
  cycleSpeed: 51,
  capacitorNeed: 6,
  reloadTime: 1795,
  chargeRate: 56,           // charges CONSUMED per cycle
  chargeAmount: -8,         // engine pseudo-attribute: capacity / charge volume
  chargedArmorMultiplier: 1886,
} as const;

/**
 * LOCAL repair effects — the ones that repair the ship the module is fitted
 * to. Read off `item.effects`, which the engine returns as a plain array of
 * effect ids (verified: a Large Shield Booster II comes back as [4, 13, 16]).
 *
 * This replaces guessing from the slot. Remote repairers carry attribute 68
 * and 84 exactly like local ones do, so an attribute test alone would count a
 * logistics ship's remote armour repairer as its own tank. Counted in the
 * bundle: 45 remote armour, 44 remote shield, 8 remote hull, plus mutadaptive,
 * ancillary-remote and NPC-drone variants — 118 types that must NOT be
 * treated as self-repair.
 */
export const LOCAL_REPAIR_EFFECT: Record<number, RepairKind> = {
  4: 'shield',     // shieldBoosting          — 89 types
  4936: 'shield',  // fueledShieldBoosting    — 10 types (ancillary)
  27: 'armor',     // armorRepair             — 101 types
  5275: 'armor',   // fueledArmorRepair       — 8 types (ancillary)
  26: 'hull',      // structureRepair         — 25 types
};

export type RepairKind = 'shield' | 'armor' | 'hull';

/**
 * WHEN the heal lands within its cycle.
 *
 * NOT from the bundle — there is no attribute for it. This is EVE behaviour,
 * and it is the difference between surviving a volley and not: an armour
 * repairer that pays its capacitor at t=0 and heals at t=11.25 leaves an
 * 11-second window in which the ship has already spent the cap and has none
 * of the hit points.
 */
export const REPAIR_TIMING: Record<RepairKind, 'start' | 'end'> = {
  shield: 'start',
  armor: 'end',
  hull: 'end',
};

export interface ChargeSupply {
  /** whole charges the module holds when full */
  count: number;
  /** charges burned per cycle — attribute 56. Verified: 1 on a Large
   * Ancillary Shield Booster, 8 on a Large Ancillary Armor Repairer, 4 on a
   * Medium, 1 on a Small. */
  perCycle: number;
  /** how many cycles a full load buys, before reloading */
  cycles: number;
  /** the silence afterwards — attribute 1795, measured 60 s on every
   * ancillary repair module */
  reloadSeconds: number;
}

export interface RepairCycle {
  typeId: number;
  kind: RepairKind;
  /** hit points restored per cycle, post-skill, post-hull-bonus,
   * post-overload, and with the ancillary multiplier applied */
  amount: number;
  cycleSeconds: number;
  /** GJ per activation, deducted the instant the module fires */
  capPerCycle: number;
  timing: 'start' | 'end';
  ancillary: boolean;
  /** null for a module that runs purely on capacitor */
  charges: ChargeSupply | null;
  /** hp/s while it is actually cycling — what it feels like under fire */
  burstHps: number;
  /** hp/s averaged across the reload too — what it sustains over a long
   * fight. Equal to burstHps when there is nothing to reload. */
  dutyHps: number;
}

/** a module we can SEE is a repairer but cannot score — never silently zero */
export interface RepairRefusal {
  typeId: number;
  kind: RepairKind;
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

/**
 * HOW MANY WHOLE CHARGES FIT. The single most error-prone number here.
 *
 * The engine's -8 is `capacity / chargeVolume` left as a raw float, and the
 * two things that go wrong pull in OPPOSITE directions:
 *
 *   · FLOATING POINT. A 425mm AutoCannon II reads 119.99999821186069 and a
 *     Heavy Missile Launcher II reads 40.00000248352692. Both are exact
 *     integers in EVE (120 and 40). A plain floor turns a 120-round clip into
 *     119 — an off-by-one on every reload in a long fight.
 *
 *   · GENUINE FRACTIONS. A Large Ancillary Shield Booster has 42 m³ and a
 *     Navy Cap Booster 400 is 12 m³, so -8 reads exactly 3.5. You cannot load
 *     half a cap booster: it holds THREE. Rounding would say four and give
 *     the fit a cycle of repair it does not have.
 *
 * So it is a floor with a relative tolerance — round-trip noise is absorbed,
 * a real half-charge is not. Verified against four known EVE loadouts:
 *
 *     425mm AutoCannon II  + Republic Fleet EMP M    119.999998  -> 120
 *     Heavy Missile Lchr II + Scourge Heavy Missile   40.000002  ->  40
 *     Large Ancillary Shield Booster + Navy 400        3.500000  ->   3
 *     Large Ancillary Armor Repairer + Nanite Paste   64.000000  ->  64
 */
export function chargeCount(raw: number | undefined): number | undefined {
  if (raw === undefined || !Number.isFinite(raw) || raw <= 0) return undefined;
  const tolerance = Math.max(1e-6, Math.abs(raw) * 1e-6);
  return Math.floor(raw + tolerance);
}

const kindOf = (item: EngineItem): RepairKind | undefined => {
  const effects = (item as { effects?: number[] }).effects;
  if (!Array.isArray(effects)) return undefined;
  for (const e of effects) {
    const k = LOCAL_REPAIR_EFFECT[e];
    if (k) return k;
  }
  return undefined;
};

const AMOUNT_ATTR: Record<RepairKind, number> = {
  shield: A.shieldBonus,
  armor: A.armorDamageAmount,
  hull: A.structureDamageAmount,
};

const isActive = (state?: string): boolean => {
  const s = (state ?? '').toLowerCase();
  return s === 'active' || s === 'overload' || s === 'overloaded';
};

/**
 * Every LOCAL repair module on the fit, as discrete cycles.
 *
 * Modules that are switched off are skipped — an offline repairer repairs
 * nothing. Modules we cannot score are REFUSED by name rather than counted as
 * zero, because a silent zero is indistinguishable from a fit with no tank.
 */
export function repairCycles(result: EngineResult): {
  cycles: RepairCycle[];
  refused: RepairRefusal[];
} {
  const cycles: RepairCycle[] = [];
  const refused: RepairRefusal[] = [];

  for (const item of result.items) {
    const kind = kindOf(item);
    if (!kind) continue;
    if (!isActive(item.state)) continue;

    const amountRaw = val(item.attributes, AMOUNT_ATTR[kind]);
    const durationMs = val(item.attributes, A.duration) ?? val(item.attributes, A.cycleSpeed);

    if (!amountRaw || amountRaw <= 0 || !durationMs || durationMs <= 0) {
      // Mutated/abyssal modules carry the repair EFFECT with no amount or no
      // duration. No published type does this, but an abyssal one can, and a
      // guessed number is worse than a stated gap.
      refused.push({
        typeId: item.type_id,
        kind,
        why: !amountRaw
          ? 'the module publishes no repair amount'
          : 'the module publishes no cycle duration',
      });
      continue;
    }

    const cycleSeconds = durationMs / 1000;
    const loaded = !!item.charge;
    const reloadMs = val(item.attributes, A.reloadTime);
    const perCycle = val(item.attributes, A.chargeRate) ?? 1;
    const held = loaded ? chargeCount(val(item.attributes, A.chargeAmount)) : undefined;
    const ancillary = reloadMs !== undefined && held !== undefined && perCycle > 0;

    /**
     * THE ANCILLARY ARMOUR MULTIPLIER, WHICH THE ENGINE DOES NOT APPLY.
     *
     * A Large Ancillary Armor Repairer on a Myrmidon returns amount 712.25 and
     * ALSO returns attribute 1886 `chargedArmorDamageMultiplier` = 3 — but it
     * has not multiplied by it. Loaded with Nanite Repair Paste the module
     * repairs 2136.75 per cycle, three times what the engine reports.
     *
     * Shield ancillaries work the other way and need no multiplier: the LASB
     * returns 390 whether loaded or not, and the charge buys away its
     * CAPACITOR cost instead (measured: 475.2 GJ per cycle empty, 0 loaded).
     * Reading attribute 6 as-is therefore already handles both.
     */
    const multiplier = kind === 'armor' && loaded
      ? (val(item.attributes, A.chargedArmorMultiplier) ?? 1)
      : 1;
    const amount = amountRaw * multiplier;

    const charges: ChargeSupply | null = ancillary && held !== undefined && reloadMs !== undefined
      ? {
        count: held,
        perCycle,
        cycles: Math.floor(held / perCycle),
        reloadSeconds: reloadMs / 1000,
      }
      : null;

    const burstHps = amount / cycleSeconds;
    // across a full load AND the reload that follows it
    const dutyHps = charges && charges.cycles > 0
      ? (amount * charges.cycles)
        / (charges.cycles * cycleSeconds + charges.reloadSeconds)
      : burstHps;

    cycles.push({
      typeId: item.type_id,
      kind,
      amount,
      cycleSeconds,
      capPerCycle: val(item.attributes, A.capacitorNeed) ?? 0,
      timing: REPAIR_TIMING[kind],
      ancillary,
      charges,
      burstHps,
      dutyHps,
    });
  }

  return { cycles, refused };
}

/** total sustained hp/s of one kind — the honest long-fight average */
export const dutyHpsOf = (cycles: RepairCycle[], kind: RepairKind): number =>
  cycles.reduce((n, c) => (c.kind === kind ? n + c.dutyHps : n), 0);

/** total hp/s of one kind while everything is actually cycling */
export const burstHpsOf = (cycles: RepairCycle[], kind: RepairKind): number =>
  cycles.reduce((n, c) => (c.kind === kind ? n + c.burstHps : n), 0);

// ---------------------------------------------------------------------------
// THE CAPACITOR, AS A QUANTITY RATHER THAN A DEADLINE
// ---------------------------------------------------------------------------
//
// The app currently reads -7 `capacitorDepletesIn`, which is the OUTPUT of a
// simulation CCP's engine already ran — a single timestamp, with no way to ask
// "what if this module were feathered" or "what if a neutraliser were on us".
//
// The recharge law was verified against the shipped engine rather than quoted:
// integrating it forward reproduced the engine's own -7 on 13 depleting fits
// and its -5 peak delta to roughly 1e-11.
//
//   C(t+dt) = Cmax * ( 1 + (sqrt(C/Cmax) - 1) * e^(-5*dt/tau) )^2
//
// with tau = rechargeRate(55)/1000 seconds. Peak recharge is 2.5*Cmax/tau and
// occurs at 25% capacitor, which is why a cap-unstable fit can sit stably at a
// quarter bar and die the moment anything neutralises it.

export interface CapacitorModel {
  /** GJ — attribute 482 */
  capacity: number;
  /** seconds — attribute 55, converted from ms */
  tau: number;
}

const HULL = { capacity: 482, rechargeRate: 55 } as const;

export function capacitorOf(result: EngineResult): CapacitorModel {
  const h = result.hull.attributes;
  return {
    capacity: val(h, HULL.capacity) ?? 0,
    tau: (val(h, HULL.rechargeRate) ?? 0) / 1000,
  };
}

/**
 * Advance the capacitor by `dt` seconds with nothing drawing on it.
 *
 * Exact, not a Euler step: EVE's recharge is a closed form, so a simulation
 * can jump straight from one event to the next without accumulating error over
 * a long fight.
 */
export function capAfter(current: number, dt: number, model: CapacitorModel): number {
  const { capacity, tau } = model;
  if (capacity <= 0 || tau <= 0) return current;
  if (dt <= 0) return Math.min(capacity, Math.max(0, current));
  const c = Math.min(capacity, Math.max(0, current));
  const root = Math.sqrt(c / capacity);
  const next = capacity * (1 + (root - 1) * Math.exp((-5 * dt) / tau)) ** 2;
  return Math.min(capacity, Math.max(0, next));
}

/** GJ per second flowing in at a given capacitor level — peaks at 25% */
export function capRecharge(current: number, model: CapacitorModel): number {
  const { capacity, tau } = model;
  if (capacity <= 0 || tau <= 0) return 0;
  const c = Math.min(capacity, Math.max(0, current));
  return ((10 * capacity) / tau) * (Math.sqrt(c / capacity) - c / capacity);
}

/** the peak of that curve, reached at 25% capacitor */
export const capPeakRecharge = (model: CapacitorModel): number =>
  (model.capacity > 0 && model.tau > 0 ? (2.5 * model.capacity) / model.tau : 0);

/**
 * THE INVERSE: seconds until the capacitor CLIMBS from `current` to `target`
 * with nothing drawing on it.
 *
 * This is what lets the event simulation sleep instead of poll: a module that
 * cannot afford its activation computes the exact instant it will be able to,
 * schedules one wake-up there, and the queue stays silent in between. Derived
 * by inverting capAfter; verified by round-trip (fixture: |capAfter(C0, t) −
 * Ct| < 1e-9 across the whole bar).
 *
 * Returns null when the target is unreachable — at or above full, or not
 * above the current level. A module whose cost exceeds Cmax parks forever,
 * and the caller reports that once rather than spinning.
 */
export function capWakeSeconds(
  current: number, target: number, model: CapacitorModel,
): number | null {
  const { capacity, tau } = model;
  if (capacity <= 0 || tau <= 0) return null;
  const c0 = Math.min(capacity, Math.max(0, current));
  const ct = Math.min(capacity, Math.max(0, target));
  if (ct <= c0) return 0;
  if (ct >= capacity) return null;
  const a = 1 - Math.sqrt(c0 / capacity);
  const b = 1 - Math.sqrt(ct / capacity);
  // a > b > 0 here, so the log is positive
  return (tau / 5) * Math.log(a / b);
}

/**
 * CAPACITOR BOOSTERS — the fit's own cap injection, which the engine IGNORES.
 *
 * Measured 2026-08-09: a Heavy Capacitor Booster II with Navy Cap Booster 800
 * loaded changes the hull's -5 peak delta and -7 depletesIn by NOTHING, to
 * 1e-15, on both stable and depleting fits. The injected energy is entirely
 * absent from the engine's own capacitor arithmetic — so the simulation must
 * add it, and any cap-stability number the app shows for a fit with a loaded
 * booster is understated until it does.
 *
 * The injected GJ is attribute 67 ON THE CHARGE (Navy Cap Booster 800 = 800,
 * never modified by skills or hull). The module: effect 48 `powerBooster`,
 * cycle 73 = 12000 ms, reload 1795 = 10000 ms, chargeRate 56 = 1, clip via
 * -8 (Heavy CB II + Navy 800 reads 6.666… → floor 6, the same
 * capacity/volume float as every clip).
 */
export const CAP_BOOSTER_EFFECT = 48; // powerBooster

export interface CapBoosterCycle {
  typeId: number;
  /** GJ injected per activation — charge attr 67 */
  injectGj: number;
  cycleSeconds: number;
  charges: ChargeSupply;
}

// ---------------------------------------------------------------------------
// ACTIVE RESIST HARDENERS — the modules that keep resists up ONLY while the
// capacitor can feed them. Classification MEASURED against the live engine
// (2026-08-19 probe, PLAN v0.114.0): every active hardener carries an
// activation cost (attr 6) + duration (attr 73) AND marks itself with resist
// attrs — shield AND armor hardeners use 984–987 (resistance bonus, nonzero),
// the Reactive Armor Hardener uses resonance multipliers 267–270 (≠ 1).
// Everything that must NOT match, verified by the same probe:
//   · passive plates/membranes/DCU/amps: no attr 6 (no activation cost)
//   · Siege/Triage/Bastion: duration but NO attr 6 either
//   · repairers/boosters/prop: no resist attrs at all
// ---------------------------------------------------------------------------

export interface HardenerDrain {
  /** aggregate GJ billed once per cycleSeconds. Rate-preserving across
   * mixed cycle times: Σ(costᵢ/durationᵢ) × cycleSeconds */
  capPerCycle: number;
  /** the SHORTEST hardener cycle — the first moment a dry cap shows */
  cycleSeconds: number;
  count: number;
}

const RESIST_BONUS_ATTRS = [984, 985, 986, 987];
const RESIST_RESONANCE_ATTRS = [267, 268, 269, 270];

export function hardenerDrain(result: EngineResult): HardenerDrain | null {
  let rate = 0;
  let minCycle = Infinity;
  let count = 0;
  for (const item of result.items) {
    if (!isActive(item.state)) continue;
    const cap = val(item.attributes, A.capacitorNeed);
    const durMs = val(item.attributes, A.duration);
    if (!cap || cap <= 0 || !durMs || durMs <= 0) continue;
    const resist = RESIST_BONUS_ATTRS.some((id) => (val(item.attributes, id) ?? 0) !== 0)
      || RESIST_RESONANCE_ATTRS.some((id) => {
        const v = val(item.attributes, id);
        return v !== undefined && v !== 1;
      });
    if (!resist) continue;
    rate += cap / (durMs / 1000);
    minCycle = Math.min(minCycle, durMs / 1000);
    count += 1;
  }
  if (count === 0) return null;
  return { capPerCycle: rate * minCycle, cycleSeconds: minCycle, count };
}

export function capBoosters(result: EngineResult): CapBoosterCycle[] {
  const out: CapBoosterCycle[] = [];
  for (const item of result.items) {
    const effects = (item as { effects?: number[] }).effects;
    if (!Array.isArray(effects) || !effects.includes(CAP_BOOSTER_EFFECT)) continue;
    if (!isActive(item.state)) continue;
    if (!item.charge) continue; // an empty booster injects nothing
    const inject = val(item.charge.attributes, 67);
    const durationMs = val(item.attributes, A.duration) ?? val(item.attributes, A.cycleSpeed);
    const held = chargeCount(val(item.attributes, A.chargeAmount));
    const reloadMs = val(item.attributes, A.reloadTime);
    if (!inject || !durationMs || held === undefined || reloadMs === undefined) continue;
    const perCycle = val(item.attributes, A.chargeRate) ?? 1;
    out.push({
      typeId: item.type_id,
      injectGj: inject,
      cycleSeconds: durationMs / 1000,
      charges: {
        count: held,
        perCycle,
        cycles: Math.floor(held / perCycle),
        reloadSeconds: reloadMs / 1000,
      },
    });
  }
  return out;
}
