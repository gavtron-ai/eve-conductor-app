// THE FIGHT, EVENT BY EVENT. No smoothing anywhere.
//
// battleTick.ts stepped at 0.25 s and smeared every volley across its cycle.
// Its own header claimed that "does NOT affect who wins a fight of any length"
// — and that claim was FALSIFIED by running it: an attacker with one
// 4000-damage volley every 100 s (40 dps smoothed) against a target repairing
// 50 hp/s stalemates under smoothing and dies instantly under discrete
// volleys. Alpha versus active tank IS the fight, and smoothing erased it.
//
// So this is a discrete event queue. Each module schedules its next
// activation; the queue pops the earliest; the module resolves instantly and
// in full; it reschedules. Nothing is averaged, nothing is stepped:
//
//   · a 1400mm volley is ONE hit at one instant
//   · a clip runs dry and the gun goes SILENT for its whole reload
//   · a shield booster heals at the START of its cycle, an armour repairer at
//     the END — the 11-second window where the cap is spent and the hit
//     points have not arrived is real here
//   · the capacitor is a QUANTITY: every activation pays attribute 6 at the
//     instant it fires, recharge follows EVE's closed-form curve between
//     events, and a module that cannot afford its cycle computes the exact
//     second it will be able to and sleeps until then
//   · passive shield regeneration follows the true level-dependent curve —
//     the same law as the capacitor — not a flat peak rate that would
//     overcredit a passive tank at nearly every shield level
//   · ships MOVE: range follows closingSpeed (computed by geometryFrom and,
//     until now, consumed by nothing — the "closing ships never close" bug
//     dies here)
//   · Triglavian disintegrators RAMP: the engine reports the unspooled
//     multiplier and the per-cycle bonus; the ramp lives here and resets on
//     target switch
//
// PURE — no engine, no browser. Consumes SimWeapon/Layer/geometry from fitSim
// and RepairCycle/CapacitorModel from moduleCycle, so fixtures run the shipped
// arithmetic under plain node. Inputs are never mutated: the same EventShip
// array run twice produces byte-identical results.
import {
  applicationOf, missileDamageFactor, afterResists, DEFAULT_DRONE_ORBIT,
  type SimWeapon, type Layer, type Flying, type Damage,
} from './fitSim';
import {
  capAfter, capWakeSeconds,
  type RepairCycle, type CapacitorModel, type CapBoosterCycle,
} from './moduleCycle';
import {
  projFalloffScale,
  type ProjectedModule, type ProjKind, type CommandBurst,
} from './projectedCycle';
import { RollStreams, ROLL } from './battleRng';
import { buffMultiplier, buffValue } from './dbuffTable';

// ---------------------------------------------------------------------------
// DECLARED CHOICES — things no attribute records. Each is a named constant so
// it is visible, arguable and correctable, never buried in an expression.
// ---------------------------------------------------------------------------
export const DECLARED = {
  /** no first-shot-delay attribute exists anywhere in the bundle (proved by
   * enumeration 2026-08-08) — the first volley fires at t=0 */
  FIRST_VOLLEY_AT_ZERO: true,
  /** a solo ship's guns are grouped and fire together; fleet stagger can
   * become an option later */
  WEAPONS_IN_PHASE: true,
  /**
   * THE SERVER TICK IS REAL (v0.93.0). EVE's physics engine (Destiny) steps
   * once per second - "The goal of the server is for a tick to run exactly
   * once per second, or at 1 hertz" (EVE Uni, Server_tick) - and CCP's own
   * dev blog (Facing Destiny) describes a deterministic stepped simulation
   * of ships, drones and missiles. Module DAMAGE, by contrast, is
   * "immediately calculated, immediately applied" with only the client
   * REPORT tick-aligned (same page) - so dogma events here stay continuous
   * and only STEERING (commanded-velocity choices) quantises to the tick.
   * Documented but NOT yet applied (a named follow-up migration, because
   * ~36 lock fixtures pin the continuous values): lock completion rounds UP
   * to whole ticks ("a 1.2-second locking time will be rounded up to 2
   * server ticks"), and pilot commands take effect on the NEXT tick.
   */
  SERVER_TICK_SECONDS: 1.0 as number | null,
  LOCK_ROUNDUP_PENDING: true,
  /** drone travel is a chase, not a teleport: the drone closes on the
   * target's true (closed-form) trajectory at its own speed and ARRIVES at
   * the target's orbit shell - its measured orbit radius, attr 416
   * entityFlyRange (attr 154 is proximityRange, a different thing; probed
   * 2026-08-10 across every drone class). First volley on arrival. A target
   * receding faster than the drone is never reached - kiting drones out is
   * real and now emerges. */
  DRONE_FIRST_VOLLEY_ON_ARRIVAL: true,
  DRONE_TRAVEL_ENDS_AT_ORBIT_SHELL: true,
  /** MISSILES LEAD-INTERCEPT (v0.93.0 - replaces intercept-at-launch-range).
   * The SDE marks every missile aimedLaunch=1; the pursuit law itself is
   * unpublished, so this is DECLARED: a missile lands at the first instant
   * its straight flight from the LAUNCH POINT covers the target's current
   * position - solve |targetPos(t) - launchPos| = v*(t - launch) on the
   * target's closed-form motion, within flight time maxRange/velocity; no
   * root inside the window = the missile expires (out-running missiles is
   * documented EVE behaviour and now emerges instead of being a range
   * cutoff). Re-solved whenever the target's motion changes mid-flight.
   * Application (signature/speed) is still evaluated at LAND time. */
  MISSILE_INTERCEPT_LEAD_PURSUIT: true,
  /** THE LOCK MODEL (v0.88.0 — replaces LOCK_TIME_ZERO). No lock-time
   * attribute exists anywhere in the bundle (proved by sweep; legacy attr 79
   * is wired to nothing modern) — the client rule is DECLARED:
   *   t = 40000 / (scanRes · asinh(sig)²) seconds
   * with scanRes and sig the live effective values at lock start. */
  LOCK_TIME_FORMULA: true,
  /** FIGHTS OPEN UNLOCKED (v0.96.0 — replaces PRELOCKED_AT_START). Every
   * ship begins acquiring its opening target at t=0 and NOTHING targeted —
   * volley, paint, tackle, remote rep on an enemy — lands before its lock
   * completes, exactly as in game. The old convenience ("the fight starts
   * when the shooting starts") let a Hyena paint at t=0, caught live by the
   * owner. Ships without a scanRes input keep instant locks, so pre-lock-
   * model fixtures are untouched. */
  LOCKS_ACQUIRED_FROM_ZERO: true,
  /** a lock's duration is fixed from the effective scan resolution at lock
   * START; a damp landing mid-lock changes the NEXT lock, not this one */
  LOCK_TIME_FIXED_AT_START: true,
  /** a lock, once made, persists even if the target later exceeds the
   * locker's targeting range; a NEW lock cannot start beyond it */
  LOCKS_PERSIST_BEYOND_RANGE: true,
  /** ECM (all client rules, absent from dogma — effect 6470 has
   * electronicChance=false): jam chance = strength(victim's sensor type) ×
   * falloff × resist(2253) / victim sensor strength, clamped [0,1]; rolled
   * per module per cycle at cycle start AFTER the cap is paid; a landed jam
   * drops every lock except toward the JAMMER (Dec-2018 rule) for the jam
   * duration (module cycle; 5 s for EC drones via attr 2822), then victims
   * re-lock at full lock time */
  JAM_IS_A_PER_CYCLE_ROLL: true,
  JAM_ROLLS_ARE_INDEPENDENT_UNIFORMS: true,
  ROLL_AT_CYCLE_START_AFTER_PAYMENT: true,
  /** one draw per completed activation even at chance 0 or 1, so geometry
   * changes never shift a roll stream's sequence */
  DRAW_EVEN_WHEN_CERTAIN: true,
  /** COMMAND BURSTS: buffs apply to every friendly including the booster
   * (fleet membership + self-application are client rules; measured burst
   * ranges 33-66 km at all-V dwarf any plausible ally spread in the 1D
   * model); per buff id the STRONGEST single lease wins (aggregateMode in
   * TQ's dbuff table) with no stacking penalty; buff→attribute mapping is
   * vendored from TQ dbuffs.json (2026-08-10) — ids outside it are skipped
   * with a note. Module-attribute buffs (rep duration/cap, prop boost, EWAR
   * range) are extracted and DISPLAYED but not yet simulated — stated, not
   * silent. */
  BURSTS_HIT_ALL_ALLIES: true,
  BURST_WINNER_TAKE_ALL: true,
  /** BURST JAMMERS (effect 6714, untargeted AoE): each cycle, one
   * independent seeded roll per living enemy within the bubble (range attr
   * 142; pair distance = the victim's own range state, the 1D convention);
   * a hit BREAKS the victim's locks — no sustained jam, no lock-the-jammer
   * exception; re-locking starts immediately and costs full lock time.
   * Client rules, absent from dogma. */
  BURST_JAM_IS_A_LOCK_BREAK: true,
  /** a gun keeps its cycle timer across a target switch; spool does not */
  GUN_CYCLE_SURVIVES_RETARGET: true,
  /** spool resets on target switch and on any cycle gap (reload, cap
   * starvation) — reset rules are not in the data */
  SPOOL_RESETS_ON_GAP: true,
  /** a capacitor booster injects its charge at the ACTIVATION instant, and
   * the injection wakes any module that was sleeping on an empty capacitor */
  CAP_INJECT_AT_ACTIVATION: true,
  /** ships hold their commanded speed from t=0; the inertia machinery
   * (tau = agility·mass/1e6, measured against the engine's own align time)
   * arrives with speed CHANGES — webs, prop toggling — in the projected
   * phase */
  SHIPS_START_AT_COMMANDED_SPEED: true,
  /**
   * TRUE POSITIONS (v0.93.0 - replaces RANGE_IS_PER_SHIP). Every ship is a
   * 3D point; every pair distance is |dP|. The legacy inputs embed exactly:
   * side a on the +x ray at its range scalar, side b at the origin, and the
   * old dial convention IS an equiangular spiral (constant bearing theta to
   * the line of sight): r(t) = r0 - cos(th)*s(t), phi(t) = phi0 -
   * tan(th)*ln(r/r0) - theta 90 degenerates to the exact circle, 0/180 to
   * the radial line, so every shipped fixture value re-derives from real
   * geometry rather than a convention.
   */
  TRUE_POSITIONS_3D: true,
  LEGACY_DIAL_IS_EQUIANGULAR_SPIRAL: true,
  SIDE_B_LEGACY_AT_ORIGIN: true,
  /**
   * THE VECTOR MOTION LAW. What is MEASURED is the 1D inertia law
   * (tau = agility*mass/1e6, 9 significant figures against the engine's own
   * alignTime, mass state-dependent). The per-component vector form
   * v(t) = vCmd + (v0-vCmd)*e^(-dt/tau) is DECLARED: the unique
   * rotation-symmetric linear extension of the measured law (EVE Uni's
   * Acceleration page documents only the magnitude law; community
   * reverse-engineering uses this vector form and its orbit predictions
   * match observed play). Steady-state consequence, hand-checkable: a ship
   * orbiting at speed v cannot hold a circle tighter than
   * r = tau*v^2/sqrt(vmax^2-v^2) - exactly the community orbit-inflation
   * formula, with the already-measured tau.
   */
  MOTION_LAW_ISOTROPIC_LAG: true,
  /** steering (commanded-velocity choice) recomputes only on 1 Hz ticks -
   * the documented Destiny cadence; between ticks motion is the closed form */
  STEERING_AT_TICKS: true,
  /** the orbit controller is tangent-point pursuit at full commanded speed,
   * recomputed per tick - the community-reverse-engineered client rule; the
   * exact client algorithm is UNPUBLISHED, so declared-unverified.
   * Calibration recipe: orbit a wreck at 500 m in a known MWD frigate and
   * read actual distance + speed off the overview - two numbers verify or
   * refit this controller. */
  ORBIT_TANGENT_PURSUIT_UNVERIFIED: true,
  /** keep-at-range holds the EXACT commanded distance and circles there
   * (analytic circle) - model-declared, not game-verified, same status as
   * the orbit controller */
  KEEPATRANGE_HOLDS_EXACT_RADIUS: true,
  /** legacy-dial spirals and hold-circles fly in the plane of the line of
   * sight and its horizontal perpendicular (range-preserving at any
   * elevation); the real client's orbit-plane choice is unpublished */
  ORBIT_PLANE_THROUGH_LOS: true,

  // ---- PROJECTED EFFECTS (v0.83.0). Every projected-EWAR modifierInfo in
  // the bundle is EMPTY except scram 5934, so application rules are ours by
  // construction. Each is named here rather than buried. ----
  /** EWAR strength beyond optimal scales by the turret falloff law
   * 0.5^(((d−optimal)/falloffEffectiveness)²); hard cutoff when the module
   * has no falloff. A grappler (−85%, 1 km + 10 km falloff) tapers; a plain
   * web gates. */
  EWAR_FALLOFF_LAW: true,
  /** a lease's strength (falloff × victim resist) is frozen at CYCLE START
   * from the source's range then; the delta kinds (neut/nos/transfer) use
   * the geometry of the instant they LAND instead — the same asymmetry as
   * turret-at-fire vs missile-at-land */
  LEASE_STRENGTH_AT_CYCLE_START: true,
  /** an EWAR module out of range still cycles and pays cap; it projects
   * nothing (scale 0) */
  OUT_OF_RANGE_CYCLES_ANYWAY: true,
  /** neut/nos/cap-transfer deltas land at CYCLE END (phase 2) — before any
   * same-instant weapon or repair cap payment */
  NEUT_DRAIN_AT_CYCLE_END: true,
  /** a nosferatu drains only while the victim's cap FRACTION exceeds the
   * source's; a Blood hull (1945 nosOverride > 0) ignores the gate. Drained
   * energy credits the source and wakes its cap-sleeping modules. */
  NOS_GATE_CAP_FRACTION: true,
  /** the victim's resist attribute (2113/2114/2115/2045/2116) scales the
   * strength LINEARLY — the how is client logic, the which-attribute is data */
  RESIST_SCALES_STRENGTH: true,
  /** projected chains are resolved over ENGINE-FINAL victim values: our
   * bonus/penalty chains start at index 0 and do not merge with the victim's
   * own local modifier chains (only wrong for a victim with LOCAL penalties
   * on the same attribute — rare, stated) */
  PROJECTED_CHAIN_INDEPENDENT: true,
  /** bonuses and penalties to one attribute form SEPARATE stacking chains —
   * measured locally to 15 digits (mixed-sign modifiers never penalize each
   * other in the engine) */
  CHAIN_SPLIT_BY_SIGN: true,
  /** remote repair lands with local timing: shield at cycle start,
   * armour/hull at cycle end (the owner's rule, extended) — and scales by
   * falloff and the ally's 2116 at the HEAL instant; a source that died
   * mid-cycle never delivers its end-of-cycle heal */
  REMOTE_REPAIR_TIMING_IS_LOCAL: true,
  /** logistics and cap transfer pick the most-damaged living friendly
   * (lowest hp fraction, never self, ties by roster order) */
  LOGI_TARGET_MOST_DAMAGED: true,
  /** offensive projections follow the ship's kill-order target; a running
   * lease survives a retarget and expires naturally */
  EWAR_FOLLOWS_KILL_TARGET: true,
  /** a prop needing High Speed Maneuvering (the data's own filter — ABs are
   * exempt by requiring a different skill) is dead while Σ blockStrength of
   * live scram leases > 0; releasing one of two scrams keeps it dead */
  SCRAM_BLOCK_WHILE_POSITIVE: true,
  /** the pilot restarts the prop the instant the last scram drops, and the
   * signature bloom follows the prop state instantly (bloom decay is not in
   * the data) */
  PROP_RESTART_ON_RELEASE: true,
  SIG_FOLLOWS_PROP_STATE: true,
  /** in-game scrams also block Micro Jump Drives; the BUNDLE's filter
   * exempts them (MJD skill 4385 ≠ 3454). MJDs are not simulated, but any
   * future MJD feature must not inherit the data filter alone. */
  SCRAM_MJD_BLOCK_IS_CLIENT_RULE: true,
} as const;

/** angular-velocity divisor floor, metres — geometry at zero range is a
 * division by zero, not a physical situation */
export const MIN_RANGE_M = 1;


/**
 * EVE's stacking-penalty constant — MEASURED, not quoted. Recovered
 * 2026-08-09 by fitting 1/2/3 Tracking Enhancer IIs through the shipped
 * engine and inverting s(k) = e^(−(k/c)²) from the falloff ratios: the
 * engine's own values imply c = 2.669999999999995 at index 1 and
 * 2.670000000000001 at index 2. Exported for the projected-effect resolver.
 */
export const STACKING_C = 2.67;
export const stackingFactor = (index: number): number =>
  Math.exp(-((index / STACKING_C) ** 2));

/**
 * One attribute's multiplier from a set of percentage contributions.
 * Bonuses and penalties form SEPARATE chains (measured: mixed-sign
 * modifiers never penalize each other, to 15 digits); each chain sorts by
 * |value| descending and applies s(k) = e^(−(k/2.67)²) per index — the
 * constant recovered from the engine at seven consecutive indices.
 * Module-scope and exported (v0.94.0) so the closed-form check panel folds
 * projected effects through the SAME arithmetic the fight uses.
 */
export const chainMultiplier = (contributions: { value: number; stackable: boolean }[]): number => {
  if (contributions.length === 0) return 1;
  const bonus = contributions.filter((c) => c.value > 0).sort((a, b) => b.value - a.value);
  const penalty = contributions.filter((c) => c.value < 0).sort((a, b) => a.value - b.value);
  let mult = 1;
  let bi = 0;
  for (const c of bonus) mult *= 1 + (c.value / 100) * (c.stackable ? 1 : stackingFactor(bi++));
  let pi = 0;
  for (const c of penalty) mult *= 1 + (c.value / 100) * (c.stackable ? 1 : stackingFactor(pi++));
  return mult;
};

/** chart sampling cadence, seconds — presentation only, never sim logic */
export const SAMPLE_DT = 1;

// ---------------------------------------------------------------------------
// INJECT REPPING (v0.110.0) — the human discipline, as a per-ship flag.
//
// A real pilot flying a booster-fed tank (the Phoenix with a cargo of Navy
// 3200s) does NOT free-run reps and injectors the way the sim's default AI
// does. The discipline, verified against the community tanking guides:
//   · shield boosters heal at cycle START, so you WAIT — first activation
//     only once meaningfully damaged, near the passive-regen sweet spot
//     (EVE's shield recharge peaks at 25% shield; guides quote "hold to
//     ~25–33%", the owner says "~20%");
//   · never light a rep whose heal would overflow the layer — a wasted
//     cycle costs cap, and cap costs sticks;
//   · never crack a cap stick the capacitor cannot swallow whole, and only
//     when the reps actually need feeding (or the cap nears the 25%
//     recharge cliff) — sticks are the finite resource the whole tank
//     stands on.
// The thresholds are DECLARED numbers, not tuned magic: ON at the regen
// peak zone, OFF above the band so the tank sawtooths where regen is near
// its maximum instead of idling at full shield.
// ---------------------------------------------------------------------------
export const DISC_REP_ON_FRAC = 0.30; // shield reps engage at/below this fraction
export const DISC_REP_OFF_FRAC = 0.55; // and disengage at/above (hysteresis band)
/**
 * THE CAP RESERVE the disciplined pilot defends — the recharge peak sits
 * at exactly 25%, so this is where a pilot wants the capacitor living.
 *
 * v0.116.0 (owner's correction): sticks are timed against the TANK
 * MODULES' CYCLES, never the injector's own clock — a rep/hardener cycle
 * PULLS a held stick at its own start whenever paying would dip the cap
 * below this reserve (jitPull). One rule covers both regimes: in quiet
 * phases it hovers the cap at the peak; under neut pressure the stick
 * lands and is spent in the same second, leaving nothing idle for the
 * neuts (EVE Uni: injected cap "may be sucked away as soon as it lands").
 * The v0.113 level-triggered own-clock gate survives ONLY for fits with
 * no cap-consuming tank modules, where sticks serve the guns. History:
 * v0.110 fired whenever a stick merely FIT (a capital chain-injecting
 * from 90% cap — caught by the owner); v0.113 gated on ≤25% cap but
 * still on the injector's own clock, exposing up to a whole rep cycle of
 * injected GJ to the neuts (also caught by the owner).
 */
export const DISC_CAP_STICK_FRAC = 0.25;

// ---------------------------------------------------------------------------
// INPUTS
// ---------------------------------------------------------------------------

export type CapPolicy =
  | { mode: 'always' }
  | { mode: 'feather'; floorFrac: number }
  | { mode: 'off' };

export interface Vec3 { x: number; y: number; z: number }

export type Behaviour =
  | { kind: 'orbit'; radiusM: number }
  | { kind: 'keepAtRange'; rangeM: number }
  | { kind: 'approach' }
  | { kind: 'flee' }
  | { kind: 'vector'; dir: Vec3 };

export interface EventShip {
  id: string;
  name: string;
  side: 'a' | 'b';
  weapons: SimWeapon[];
  /** moduleCycle.repairCycles() output, VERBATIM — amount and duration,
   * never a rate */
  repairs: RepairCycle[];
  /** own capacitor boosters — injection the engine ignores entirely
   * (measured: hull -5/-7 unchanged to 1e-15 with a loaded Heavy CB II) */
  capBoosters?: CapBoosterCycle[];
  /** TOTAL cap booster charges carried (cargo + loaded). Undefined =
   * unlimited (the pre-v0.108 behaviour: boosters reloaded forever). The
   * initial module loads draw from this pool; when a reload finds the pool
   * short of one cycle's worth, that booster is DRY for the rest of the
   * fight — exactly the cargo-limits question a real fit answers.
   * v0.111.0: the pool is SHARED with ancillary shield boosters — in the
   * real game ASB reloads eat the same cap booster charges the injector
   * does. ASBs load first (the tank), injectors second; ancillary ARMOR
   * repairers use nanite paste and never touch this pool. */
  capBoosterReserve?: number;
  capacitor: CapacitorModel;
  /** starting capacitor fraction, default 1 (full) */
  capStartFrac?: number;
  /** per-module capacitor policy: weapons keyed `wpn0`…, repairers `rep0`….
   * Default: always run. */
  capPolicy?: Record<string, CapPolicy>;
  /** INJECT REPPING — fly the tank like a person: hold shield reps until
   * the 30% band (peak passive regen), never waste a heal cycle or an
   * injection overflow, feed sticks to reps only when they are running.
   * Default false = the old free-running AI. */
  injectDiscipline?: boolean;
  /** shield / armor / hull, in the order damage eats them */
  layers: Layer[];
  /** ACTIVE RESIST HARDENERS (v0.114.0). The layers above carry the
   * hardeners-RUNNING resonance; when the capacitor cannot pay a hardener
   * cycle the ship's resists COLLAPSE to dryResonance (a second engine
   * pass with the hardeners offline) until it can pay again. capPerCycle
   * is the aggregate drain billed once per cycleSeconds — rate-preserving
   * across mixed cycle times, measured per fit from the engine items. */
  hardeners?: {
    capPerCycle: number;
    cycleSeconds: number;
    /** per-layer resonance with every active hardener offline, same layer
     * order as `layers` */
    dryResonance: Layer['resonance'][];
  };
  /**
   * PASSIVE SHIELD REGEN — τ in seconds (shieldRechargeRate 479 / 1000).
   * Modelled on the true level-dependent curve, the same closed form as the
   * capacitor: peak 2.5·Smax/τ at 25% shield, near zero when full or empty.
   * Zero/undefined = no regeneration.
   */
  shieldRechargeSeconds?: number;
  signatureRadius: number;
  flying: Flying;
  /** metres to the opposing side at t=0 */
  range: number;
  /** true starting position, metres, world frame (the target side's legacy
   * origin is (0,0,0)). Absent = the collinear embed: side a at (range,0,0),
   * side b at the origin - exactly the old declared convention. */
  pos0?: Vec3;
  /** the true-emulation steering path: a per-tick controller under the
   * measured inertia law. Absent = the legacy dial (exact spiral). */
  behaviour?: Behaviour;
  /** roster id of the ship this one's BEHAVIOUR is anchored on (orbit WHAT).
   * Default: the current kill target - follows retargets. */
  anchorId?: string;
  /** the range this ship is TRYING to reach. When its closing speed carries
   * it there it holds and circles (angle → 90°). Default: hold the start. */
  commandedRange?: number;
  droneOrbit?: number;
  /** everything this ship PROJECTS at others — projectedCycles() output */
  projected?: ProjectedModule[];
  /**
   * The two speed/signature states a prop-fitted ship can be in, from TWO
   * engine runs (CalcOpts.propRunning). A scram kills an MWD (the data's own
   * skill-3454 filter); the ship then decays toward the inactive numbers on
   * its inertia ramp. `blockable` = the prop requires High Speed Maneuvering.
   * Measured Hurricane 50MN MWD II: active 1433.74 m/s / sig 1437.5;
   * inactive 225 / 250.
   */
  propPair?: {
    activeMaxVel: number; activeSig: number;
    inactiveMaxVel: number; inactiveSig: number;
    blockable: boolean;
  };
  /** inertia: tau = agility·mass/1e6 s — mass is STATE-DEPENDENT (an MWD
   * adds 500,000 kg only while running, measured), so both values ship */
  tauActive?: number;
  tauInactive?: number;
  /** engine-final EWAR resist gates keyed by attribute id (2045, 2113-2116)
   * — hulls carry 2045; the rest default to 1 (RESIST_SCALES_STRENGTH) */
  resists?: Partial<Record<number, number>>;
  /** hull attr 1945 nosOverride > 0 (Blood ships): nosferatu ignores the
   * cap-fraction gate */
  nosOverride?: boolean;
  /** engine-final hull 564 — the lock-time numerator's divisor. Undefined =
   * the pre-lock-model behaviour (instant locks), keeping old inputs valid */
  scanRes?: number;
  /** engine-final hull 76, metres — a NEW lock cannot start beyond it */
  maxTargetRangeM?: number;
  /** the hull's primary sensor: which attr (208/209/210/211) and its
   * engine-final strength — the jam-chance denominator (ECCM already folded) */
  sensor?: { attr: number; strength: number };
  /** command bursts this ship runs — leases on every friendly each cycle */
  bursts?: CommandBurst[];
  /** metres — the owner's drone control range (engine-final char 458).
   * Drones apply ZERO to a target beyond it, the same rule the closed-form
   * panel has always used. Undefined = unlimited (pre-existing inputs). */
  droneControlRangeM?: number;
}

export interface ShipView {
  id: string;
  name: string;
  side: 'a' | 'b';
  alive: boolean;
  hpTotal: number;
}

/** the fight must have been MOVING this recently (new hp low / a finite
 * stick reserve drawn down) for the horizon to extend past maxSeconds */
export const STALL_WINDOW_S = 120;
/** each extension buys this much more simulated time */
export const EXTEND_STEP_S = 300;

export interface EventBattleOptions {
  maxSeconds?: number;
  /** keep simulating past maxSeconds while the fight is still CONVERGING —
   * a ship's total hp setting new all-time lows, or a finite cap-stick
   * reserve being drawn down, counts as movement; a stable tank's sawtooth
   * does not (it revisits the same floor). Extends in EXTEND_STEP_S steps
   * up to hardMaxSeconds. The owner's rule: a fight with a visible ending
   * must be allowed to reach it; only a true stalemate may be cut off. */
  extendWhileProgressing?: boolean;
  /** cap for the extension (default maxSeconds × 4) */
  hardMaxSeconds?: number;
  /** battle seed for the roll streams (uint32). Same inputs + same seed =
   * byte-identical fight. Only mechanics in RANDOM_KINDS ever draw. */
  seed?: number;
  /** WHO SHOOTS WHOM — kill order is a player decision, not the sim's.
   * Default: finish what is nearest death. */
  pickTarget?: (shooterId: string, enemies: ShipView[]) => string | null;
}

// ---------------------------------------------------------------------------
// RESULT
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  t: number;
  kind: 'death' | 'reloadStart' | 'capStarved' | 'spoolMax' | 'wasted'
  | 'scrammed' | 'scramReleased' | 'neuted' | 'repped'
  | 'jammed' | 'jamEnded' | 'locking' | 'boosted'
  | 'painted' | 'paintEnded' | 'anchorLost' | 'injected'
  | 'hardenersDown' | 'hardenersUp';
  who: string;
  side: 'a' | 'b';
  detail?: string;
}

export interface EventBattleResult {
  /** the seed this fight ran under, and how many random draws it made —
   * drawCount 0 is the structural proof a fight was deterministic */
  seed: number;
  drawCount: number;
  /**
   * When it was DECIDED: one side wiped (their last death), or both sides
   * dead (mutual annihilation — winner null but seconds real). null = a true
   * stalemate: nobody could finish it inside maxSeconds.
   */
  seconds: number | null;
  winner: 'a' | 'b' | null;
  elapsed: number;
  events: TimelineEntry[];
  ships: {
    id: string; name: string; side: 'a' | 'b';
    alive: boolean; diedAt: number | null;
    remaining: number[];
    damageDealt: number;
    volleysFired: number;
    healsApplied: number;
    /** lowest capacitor fraction touched — how close the fit came to dry */
    capMinFrac: number;
  }[];
  /** 1 Hz samples for charts and the replay: per ship id, hp and cap as
   * fractions, range to the CURRENT TARGET in metres (v0.93 semantic: pair
   * distance, no longer a per-side scalar), speed in m/s, transversal versus
   * the current target, and the true position in metres (world frame; the
   * target side's legacy origin is (0,0,0)) — the fight's whole geometry,
   * recorded as it happened rather than recomputed after */
  series: {
    t: number;
    hp: Record<string, number>;
    cap: Record<string, number>;
    range: Record<string, number>;
    speed: Record<string, number>;
    transversal: Record<string, number>;
    /** LIVE effective signature, metres - painter blooms and MWD state are
     * visible here (v0.95.0) */
    sig: Record<string, number>;
    pos: Record<string, [number, number, number]>;
  }[];
}

// ---------------------------------------------------------------------------
// EVENT ORDERING
// ---------------------------------------------------------------------------
//
// Key = (t, phase, shipOrd, slotOrd, seq), compared lexicographically. The
// phase table is a DECLARED rule with consequences:
//
//   · at the same instant a volley lands BEFORE any heal — alpha beats a
//     same-second repair, the owner's stated mechanic
//   · armour's end-of-cycle heal lands before the next cycle pays its cap
//   · an event may schedule at the same t only into a LATER phase (or, for
//     rescheduling into the same phase, a later seq) — time never rewinds
//
// Same inputs therefore produce byte-identical fights.
const PHASE = {
  ARRIVE: 0,      // motion settles before anything reads geometry
  SAMPLE: 0.5,    // 1 Hz chart rows read POST-steer geometry (a tick's
                  // heading change is visible in the same second's sample)
  WAKE: 1,        // capWake / reloads / drone arrivals / cap+burst emitters
  LOCKED: 2,      // completed locks land before anything targeted this second
  PROJ_END: 3,    // leases expire; neut/nos/transfer deltas land HERE — a
                  // same-instant drain beats every cap payment after it
  PROJ_START: 4,  // leases refresh BEFORE volleys, so FIRE sees current EWAR
  FIRE: 5,        // weapon cycles: pay cap, spend clip, advance spool
  LAND: 6,        // damage applied; deaths resolved here
  REP_END: 7,     // armour/hull heal (timing 'end') — LAND beats same-t heals
  REP_START: 8,   // cap+charge paid; shield heal (timing 'start')
  RETARGET: 9,
} as const;

interface LandData {
  shooterOrd: number;
  victimOrd: number;
  weaponIdx: number;
  volley: Damage;
  applicationAtLaunch?: number;
  /** lead-pursuit ordnance: index into the flight registry (gen-guarded) */
  flightIdx?: number;
}

interface Ev {
  t: number;
  phase: number;
  shipOrd: number;
  slotOrd: number;
  seq: number;
  kind: 'fire' | 'land' | 'repStart' | 'repEnd' | 'gunReloadDone' | 'repReloadDone'
  | 'capWake' | 'repWake' | 'droneArrive' | 'retarget' | 'boostStart' | 'arrive'
  | 'hardStart' | 'hardWake'
  | 'projStart' | 'projEnd' | 'projWake' | 'projReloadDone' | 'projCheck'
  | 'paintCheck' | 'lockDone' | 'jamEnd' | 'burstStart' | 'tick' | 'sample';
  /** drone flight generation — a stale arrival or fire chain is discarded */
  gen?: number;
  data?: LandData;
}

const evBefore = (a: Ev, b: Ev): boolean =>
  a.t !== b.t ? a.t < b.t
    : a.phase !== b.phase ? a.phase < b.phase
      : a.shipOrd !== b.shipOrd ? a.shipOrd < b.shipOrd
        : a.slotOrd !== b.slotOrd ? a.slotOrd < b.slotOrd
          : a.seq < b.seq;

/** a plain binary min-heap — ~30k events for a 10-ship 600 s fight */
class Heap {
  private a: Ev[] = [];

  push(e: Ev): void {
    const a = this.a;
    a.push(e);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (evBefore(a[i], a[p])) { [a[i], a[p]] = [a[p], a[i]]; i = p; } else break;
    }
  }

  pop(): Ev | undefined {
    const a = this.a;
    if (a.length === 0) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1; const r = l + 1;
        let m = i;
        if (l < a.length && evBefore(a[l], a[m])) m = l;
        if (r < a.length && evBefore(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]]; i = m;
      }
    }
    return top;
  }

  get size(): number { return this.a.length; }
}

// ---------------------------------------------------------------------------
// RUNTIME STATE (all mutation lives here — inputs are read-only)
// ---------------------------------------------------------------------------

interface WeaponState {
  clipLeft: number;
  spoolCycles: number;
  /** drones must ARRIVE before they may fire */
  eligible: boolean;
  /** waiting on capacitor — a wake event checks this so an injection-driven
   * re-wake can never double-fire a module that is cycling normally */
  sleeping: boolean;
  /** drone flight generation — bumped on every re-fly */
  gen: number;
}

interface RepState {
  chargesLeft: number;
  pendingHeal: number;
  sleeping: boolean;
  /** held by the INJECT-REPPING discipline (distinct from cap-starved
   * `sleeping`) — revived only by discWake when its gate opens */
  discHeld: boolean;
}

/** one live projection from one module onto one victim */
interface Lease {
  srcOrd: number;
  slotOrd: number;
  kind: ProjKind;
  victimOrd: number;
  /** EWAR strength rows scaled by falloff × resist, frozen at cycle start */
  rows: { modifies: number; value: number; stackable: boolean }[];
  blockStrength: number;
  expiresAt: number;
}

interface ProjState {
  chargesLeft: number;
  sleeping: boolean;
  /** mutadaptive ramp — the Triglavian spool state machine reused */
  spoolCycles: number;
  /** armour/hull remote heal locked at cycle start, delivered at end */
  pendingHeal: { victimOrd: number; amount: number } | null;
}

/**
 * One exponential speed segment: v(t) = vinf + (v0−vinf)·e^(−dt/tau).
 * Its displacement is closed-form, so range needs no integration steps:
 *   s(dt) = vinf·dt + (v0−vinf)·tau·(1−e^(−dt/tau))
 * Segments compose exactly (they solve the underlying linear ODE; continuity
 * in v is the only glue) — verified by hand against a 1e-6 trapezoid.
 */
interface SpeedSeg {
  t0: number;
  v0: number;
  vinf: number;
  tau: number;
}

const speedAt = (g: SpeedSeg, t: number): number => {
  const dt = Math.max(0, t - g.t0);
  if (g.tau <= 0) return g.vinf;
  return g.vinf + (g.v0 - g.vinf) * Math.exp(-dt / g.tau);
};

const distanceSince = (g: SpeedSeg, t: number): number => {
  const dt = Math.max(0, t - g.t0);
  if (g.tau <= 0) return g.vinf * dt;
  return g.vinf * dt + (g.v0 - g.vinf) * g.tau * (1 - Math.exp(-dt / g.tau));
};

// ---------------------------------------------------------------------------
// VECTORS AND MOTION KINDS - three closed forms, no numerical integrator
// ---------------------------------------------------------------------------

const v3 = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
const vAdd = (a: Vec3, b: Vec3): Vec3 => v3(a.x + b.x, a.y + b.y, a.z + b.z);
const vSub = (a: Vec3, b: Vec3): Vec3 => v3(a.x - b.x, a.y - b.y, a.z - b.z);
const vScale = (a: Vec3, k: number): Vec3 => v3(a.x * k, a.y * k, a.z * k);
const vCross = (a: Vec3, b: Vec3): Vec3 =>
  v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
const vLen = (a: Vec3): number => Math.hypot(a.x, a.y, a.z);
const vNorm = (a: Vec3): Vec3 => {
  const L = vLen(a);
  return L > 0 ? vScale(a, 1 / L) : v3(1, 0, 0);
};

/**
 * - 'radial': straight flight along the line to a fixed centre (approach,
 *   flee, hold-range burns); magnitude rides a SpeedSeg - the measured
 *   inertia law untouched. r(t) floors at MIN_RANGE_M exactly like the old
 *   scalar did.
 * - 'spiral': the legacy dial made geometric (constant bearing to the LOS;
 *   90 degrees is the exact circle). Magnitude on a SpeedSeg:
 *     r(t) = r0 - cos(th)*ds,  phi(t) = phi0 - tan(th)*ln(r/r0)
 *   (phi0 + ds/r0 at 90 degrees).
 * - 'lag': free velocity vectors under the measured law per component; the
 *   true-emulation path steered by per-tick controllers.
 * Kinds re-anchor exactly (closed to t, continued) whenever speed caps, tau,
 * or steering change - the same segment-composition rule SpeedSeg proved.
 */
type Motion =
  | {
    kind: 'radial'; center: Vec3; uHat: Vec3; r0: number; sign: 1 | -1;
    t0: number; s0: number; mseg: SpeedSeg;
  }
  | {
    kind: 'spiral'; center: Vec3; e1: Vec3; e2: Vec3; r0: number;
    phase0: number; angleRad: number; t0: number; s0: number; mseg: SpeedSeg;
  }
  | { kind: 'lag'; t0: number; p0: Vec3; v0: Vec3; vCmd: Vec3; tau: number };

const spiralPolar = (
  m: Extract<Motion, { kind: 'spiral' }>, t: number,
): { r: number; phi: number } => {
  const ds = distanceSince(m.mseg, t) - m.s0;
  const c = Math.cos(m.angleRad);
  const r = Math.max(MIN_RANGE_M, m.r0 - c * ds);
  const phi = Math.abs(c) < 1e-9
    ? m.phase0 + Math.sin(m.angleRad) * (ds / m.r0)
    : m.phase0 - Math.tan(m.angleRad) * Math.log(r / m.r0);
  return { r, phi };
};

const motPos = (m: Motion, t: number): Vec3 => {
  if (m.kind === 'lag') {
    const dt = Math.max(0, t - m.t0);
    if (m.tau <= 0) return vAdd(m.p0, vScale(m.vCmd, dt));
    const a = Math.exp(-dt / m.tau);
    return vAdd(vAdd(m.p0, vScale(m.vCmd, dt)),
      vScale(vSub(m.v0, m.vCmd), m.tau * (1 - a)));
  }
  if (m.kind === 'radial') {
    const ds = distanceSince(m.mseg, t) - m.s0;
    const r = Math.max(MIN_RANGE_M, m.r0 + m.sign * ds);
    return vAdd(m.center, vScale(m.uHat, r));
  }
  const { r, phi } = spiralPolar(m, t);
  return vAdd(m.center,
    vAdd(vScale(m.e1, r * Math.cos(phi)), vScale(m.e2, r * Math.sin(phi))));
};

const motVel = (m: Motion, t: number): Vec3 => {
  if (m.kind === 'lag') {
    const dt = Math.max(0, t - m.t0);
    if (m.tau <= 0) return m.vCmd;
    const a = Math.exp(-dt / m.tau);
    return vAdd(m.vCmd, vScale(vSub(m.v0, m.vCmd), a));
  }
  const v = speedAt(m.mseg, t);
  if (m.kind === 'radial') return vScale(m.uHat, m.sign * v);
  const { phi } = spiralPolar(m, t);
  const rHat = vAdd(vScale(m.e1, Math.cos(phi)), vScale(m.e2, Math.sin(phi)));
  const n = vCross(m.e1, m.e2);
  const tHat = vCross(n, rHat);
  const c = Math.cos(m.angleRad);
  const sn = Math.sin(m.angleRad);
  return vAdd(vScale(rHat, -c * v), vScale(tHat, sn * v));
};

/** the spiral/circle plane: LOS direction and its horizontal perpendicular
 * (range-preserving at any elevation; ORBIT_PLANE_THROUGH_LOS) */
const planeOf = (rel: Vec3): { e1: Vec3; e2: Vec3 } => {
  const e1 = vNorm(rel);
  const up = v3(0, 0, 1);
  const c = vCross(up, e1);
  const e2 = vLen(c) > 1e-9 ? vNorm(c) : v3(0, 1, 0);
  return { e1, e2 };
};

interface ShipState {
  ship: EventShip;
  ord: number;
  hp: number[];
  alive: boolean;
  diedAt: number | null;
  dealt: number;
  volleys: number;
  heals: number;
  targetOrd: number | null;
  cap: number;
  capAt: number;
  capMin: number;
  starvedReported: Set<string>;
  weapons: WeaponState[];
  reps: RepState[];
  boosts: { chargesLeft: number; discHeld: boolean }[];
  /** cap booster charges still in cargo (Infinity = unlimited carried) */
  boostReserve: number;
  /** inject-repping hysteresis: shield reps engaged (ON ≤30%, OFF ≥55%) */
  repBandOn: boolean;
  /** resists live at the fit's computed values only while this is true —
   * a hardener cycle the capacitor cannot pay collapses them to dry */
  hardenersOn: boolean;
  /** hardener chain parked on an empty capacitor, waiting for energy */
  hardSleeping: boolean;
  /** all-time low of total hp — a NEW low is fight progress (a stable
   * tank's sawtooth revisits its floor and sets none) */
  minTotalHp: number;
  shieldAt: number;
  flying: Flying;
  /** the ship's true motion - one of the three closed forms */
  mot: Motion;
  /** hold-range burn finished - the ship now circles */
  arrived: boolean;
  /** resolved behaviour anchor ord (from anchorId), null = kill target */
  anchorOrd: number | null;
  projs: ProjState[];
  /** scram state: whether the prop is currently dead */
  propBlocked: boolean;
  /** targets this ship holds a LOCK on (ords) */
  locks: Set<number>;
  /** locks in progress: victimOrd → completion time; gen guards stale events */
  locking: Map<number, number>;
  lockGen: number;
  /** a live painter lease is on this ship (drives the painted/paintEnded
   * timeline transitions - state dumps would spam an icon per cycle) */
  painted: boolean;
  /** jammed until this instant; the only lockable ship while jammed */
  jammedUntil: number;
  jammerOrd: number | null;
  /** live command-burst buffs ON this ship */
  buffLeases: { buffId: number; value: number; expiresAt: number }[];
  burstStates: { chargesLeft: number }[];
  /** index of the LAST layer with any capacity — the ship dies when THIS
   * layer empties. Total-HP death was wrong: a hull-stripped ship whose
   * passive shield regen trickled a few points back between volleys stayed
   * "alive" forever (caught live: a Guardian at zero hull tanking a Tengu
   * on 20 hp of regenerating shield). Hull zero is dead, full stop. */
  deathLayer: number;
}

const totalHp = (s: ShipState): number => s.hp.reduce((n, x) => n + x, 0);

/** advance the capacitor to `t` on the exact closed form — no drift */
function capNow(s: ShipState, t: number): number {
  if (!s.alive) return s.cap;
  if (t > s.capAt) {
    s.cap = capAfter(s.cap, t - s.capAt, s.ship.capacitor);
    s.capAt = t;
  }
  return s.cap;
}

/** advance the SHIELD layer to `t` on the same law. Regeneration continues
 * from zero — EVE's passive regen never stops while the ship lives. */
function shieldNow(s: ShipState, t: number): void {
  // THE DEAD DO NOT REGENERATE. Without this guard the 1 Hz sampler kept
  // advancing corpses' shields on the closed form — a killed Hyena's chart
  // line curved back up to 98% shield after its death (caught live, and the
  // ledger's `left` column showed it too).
  if (!s.alive) { s.shieldAt = t; return; }
  const tau = s.ship.shieldRechargeSeconds;
  const smax = s.ship.layers[0]?.hp ?? 0;
  if (!tau || tau <= 0 || smax <= 0) { s.shieldAt = t; return; }
  if (t > s.shieldAt && s.hp[0] < smax) {
    s.hp[0] = capAfter(s.hp[0], t - s.shieldAt, { capacity: smax, tau });
  }
  s.shieldAt = t;
}

const rad = (deg: number): number => (deg * Math.PI) / 180;

/** default focus fire: finish what is nearest death */
const nearestDeath = (_shooter: string, enemies: ShipView[]): string | null => {
  let best: ShipView | null = null;
  for (const e of enemies) {
    if (!e.alive) continue;
    if (!best || e.hpTotal < best.hpTotal) best = e;
  }
  return best?.id ?? null;
};

// ---------------------------------------------------------------------------
// THE SIMULATION
// ---------------------------------------------------------------------------

/**
 * N OF THE SAME SHIP (v0.108.0). A card with count N expands into N
 * independent combatants — same fit, same behaviour, same anchors — before
 * the sim runs. The first copy keeps the original id (so anchors and kill
 * orders that reference it still bind); copies get "#k" ids and "×k" names
 * and are targeted as individuals.
 */
export function expandCounts(
  ships: EventShip[], countOf: (id: string) => number,
): EventShip[] {
  const out: EventShip[] = [];
  for (const s of ships) {
    const n = Math.max(1, Math.min(50, Math.floor(countOf(s.id) || 1)));
    out.push(s);
    for (let k = 2; k <= n; k += 1) {
      out.push({ ...s, id: `${s.id}#${k}`, name: `${s.name} ×${k}` });
    }
  }
  return out;
}

export function simulateBattleEvents(
  ships: EventShip[], opts: EventBattleOptions = {},
): EventBattleResult {
  const maxSeconds = opts.maxSeconds ?? 600;
  const hardMax = opts.extendWhileProgressing
    ? (opts.hardMaxSeconds ?? maxSeconds * 4)
    : maxSeconds;
  /** the CURRENT end of patience — slides forward at the boundary while
   * the fight was still moving inside the stall window */
  let horizon = maxSeconds;
  let lastProgressT = 0;
  const markProgress = (at: number): void => { lastProgressT = at; };
  const pick = opts.pickTarget ?? nearestDeath;

  const states: ShipState[] = ships.map((ship, ord) => ({
    ship,
    ord,
    hp: ship.layers.map((l) => l.hp),
    alive: ship.layers.some((l) => l.hp > 0),
    diedAt: null,
    dealt: 0,
    volleys: 0,
    heals: 0,
    targetOrd: null,
    cap: ship.capacitor.capacity * (ship.capStartFrac ?? 1),
    capAt: 0,
    capMin: ship.capStartFrac ?? 1,
    starvedReported: new Set<string>(),
    weapons: ship.weapons.map((w) => ({
      clipLeft: w.clip?.size ?? Infinity,
      spoolCycles: 0,
      eligible: w.kind !== 'drone',
      sleeping: false,
      gen: 0,
    })),
    ...(() => {
      // ONE carried pool of cap-booster charges (total = loaded + cargo,
      // the v0.108 semantic) feeds BOTH the ancillary shield boosters and
      // the capacitor injectors — in the real game they eat the same Navy
      // 400s. DECLARED load order: the ASBs (the tank itself) fill first,
      // then the injectors; the remainder feeds reloads. Ancillary ARMOR
      // repairers run on nanite paste — a different resource entirely —
      // and never touch this pool.
      let reserve = ship.capBoosterReserve ?? Infinity;
      const reps = ship.repairs.map((r) => {
        let loaded = r.charges?.count ?? Infinity;
        if (r.charges && r.kind === 'shield') {
          loaded = Math.min(r.charges.count, reserve);
          reserve -= loaded;
        }
        return { chargesLeft: loaded, pendingHeal: 0, sleeping: false, discHeld: false };
      });
      const boosts = (ship.capBoosters ?? []).map((b) => {
        const take = Math.min(b.charges.count, reserve);
        reserve -= take;
        return { chargesLeft: take, discHeld: false };
      });
      return { reps, boosts, boostReserve: reserve };
    })(),
    repBandOn: false,
    hardenersOn: ship.hardeners !== undefined,
    hardSleeping: false,
    minTotalHp: ship.layers.reduce((n, l) => n + l.hp, 0),
    shieldAt: 0,
    flying: { ...ship.flying },
    // still placeholder at the ship's embedded start - the real Motion is
    // derived in the seed pass, once every ship's position exists
    // (SIDE_B_LEGACY_AT_ORIGIN embed: side a at (range,0,0), side b origin)
    mot: {
      kind: 'lag',
      t0: 0,
      p0: ship.pos0 !== undefined
        ? { ...ship.pos0 }
        : ship.side === 'b'
          ? v3(0, 0, 0)
          : v3(Math.max(MIN_RANGE_M, ship.range), 0, 0),
      v0: v3(0, 0, 0),
      vCmd: v3(0, 0, 0),
      tau: 0,
    },
    arrived: false,
    anchorOrd: null,
    projs: (ship.projected ?? []).map((pm) => ({
      chargesLeft: pm.rep?.charges?.count ?? Infinity,
      sleeping: false,
      spoolCycles: 0,
      pendingHeal: null,
    })),
    propBlocked: false,
    painted: false,
    locks: new Set<number>(),
    locking: new Map<number, number>(),
    lockGen: 0,
    jammedUntil: 0,
    jammerOrd: null,
    buffLeases: [],
    burstStates: (ship.bursts ?? []).map((b) => ({ chargesLeft: b.charges?.count ?? Infinity })),
    deathLayer: (() => {
      for (let i = ship.layers.length - 1; i >= 0; i--) {
        if (ship.layers[i].hp > 0) return i;
      }
      return 0;
    })(),
  }));

  const rng = new RollStreams(opts.seed ?? 0);

  const timeline: TimelineEntry[] = [];
  const leases: Lease[] = [];
  /** the current sim time for helpers that lack a t parameter path */
  const nowRef = { t: 0 };
  const heap = new Heap();
  let seq = 0;
  let pendingLand = 0;
  const push = (e: Omit<Ev, 'seq'>): void => {
    if (e.kind === 'land') pendingLand += 1;
    heap.push({ ...e, seq: seq++ });
  };

  /** one reloadStart per (ship, weapon TYPE, instant) — six identical guns
   * reloading together are ONE event, not six icons */
  const reloadLogged = new Set<string>();
  const log = (at: number, kind: TimelineEntry['kind'], s: ShipState, detail?: string): void => {
    if (kind === 'reloadStart') {
      const key = `${s.ord}|${detail ?? ''}|${at.toFixed(4)}`;
      if (reloadLogged.has(key)) return;
      reloadLogged.add(key);
    }
    timeline.push({ t: at, kind, who: s.ship.name, side: s.ship.side, detail });
  };

  const sideAlive = (side: 'a' | 'b'): boolean =>
    states.some((s) => s.ship.side === side && s.alive);

  // -------------------------------------------------------------------------
  // THE RESOLVER — every projected effect enters the arithmetic through here
  // -------------------------------------------------------------------------

  /** rows of the given kinds targeting `victimOrd` that modify `attr`.
   * Rows are namespaced by KIND — a web's 37 is the victim's ship speed, a
   * guidance disruptor's 37 is the shooter's missile velocity; same id,
   * different domain, never mixed. */
  const leaseRows = (victimOrd: number, kinds: ProjKind[], attr: number) => {
    const out: { value: number; stackable: boolean }[] = [];
    for (const l of leases) {
      if (l.victimOrd !== victimOrd || !kinds.includes(l.kind)) continue;
      for (const r of l.rows) {
        if (r.modifies === attr && r.value !== 0) out.push(r);
      }
    }
    return out;
  };

  /** the victim as guns and missiles SEE it right now */
  const victimState = (v: ShipState, t: number): { sig: number; speed: number } => {
    // SIG_FOLLOWS_PROP_STATE: MWD bloom vanishes the instant the prop dies
    const baseSig = v.ship.propPair
      ? (v.propBlocked ? v.ship.propPair.inactiveSig : v.ship.propPair.activeSig)
      : v.ship.signatureRadius;
    const sigMult = chainMultiplier(leaseRows(v.ord, ['painter'], 552));
    const burstSig = buffMultiplier(v.buffLeases.filter((l) => l.expiresAt > t), 552);
    return { sig: baseSig * sigMult * burstSig, speed: vLen(velOf(v, t)) };
  };

  /** what the shooter's OWN incoming disruption does to one of its weapons */
  const disruptedWeapon = (shooter: ShipState, w: SimWeapon): SimWeapon => {
    if (leases.length === 0) return w;
    if (w.kind === 'turret' || w.kind === 'drone') {
      const trackingMult = chainMultiplier(leaseRows(shooter.ord, ['trackingDisruptor'], 160));
      const optimalMult = chainMultiplier(leaseRows(shooter.ord, ['trackingDisruptor'], 54));
      const falloffMult = chainMultiplier(leaseRows(shooter.ord, ['trackingDisruptor'], 158));
      if (trackingMult === 1 && optimalMult === 1 && falloffMult === 1) return w;
      return {
        ...w,
        tracking: (w.tracking ?? 0) * trackingMult,
        optimal: (w.optimal ?? 0) * optimalMult,
        falloff: (w.falloff ?? 0) * falloffMult,
      };
    }
    if (w.kind === 'missile') {
      const mv = chainMultiplier(leaseRows(shooter.ord, ['guidanceDisruptor'], 37));
      const ft = chainMultiplier(leaseRows(shooter.ord, ['guidanceDisruptor'], 281));
      const ev = chainMultiplier(leaseRows(shooter.ord, ['guidanceDisruptor'], 653));
      const er = chainMultiplier(leaseRows(shooter.ord, ['guidanceDisruptor'], 654));
      if (mv === 1 && ft === 1 && ev === 1 && er === 1) return w;
      return {
        ...w,
        missileVelocity: w.missileVelocity !== undefined ? w.missileVelocity * mv : undefined,
        maxRange: w.maxRange !== undefined ? w.maxRange * mv * ft : undefined,
        expVelocity: w.expVelocity !== undefined ? w.expVelocity * ev : undefined,
        expRadius: w.expRadius !== undefined ? w.expRadius * er : undefined,
      };
    }
    return w;
  };

  // -------------------------------------------------------------------------
  // MOTION - true positions; three closed forms; per-tick steering
  // -------------------------------------------------------------------------

  const firstFoe = (s: ShipState): ShipState | null =>
    states.find((e) => e.ship.side !== s.ship.side) ?? null;

  const posOf = (x: ShipState, t: number): Vec3 => motPos(x.mot, t);
  const velOf = (x: ShipState, t: number): Vec3 => motVel(x.mot, t);

  /** TRUE pair distance - |dP|, floored at the zero-range guard */
  const pairDistance = (x: ShipState, y: ShipState, t: number): number =>
    Math.max(MIN_RANGE_M, vLen(vSub(posOf(x, t), posOf(y, t))));

  /** a ship's range series and lock-gate distance: to its CURRENT target
   * (fallback: the first foe) - the declared v0.93 semantic */
  const rangeNow = (s: ShipState, t: number): number => {
    const foe = s.targetOrd !== null ? states[s.targetOrd] : firstFoe(s);
    if (!foe) return MIN_RANGE_M;
    return pairDistance(s, foe, t);
  };

  /** the behaviour anchor: explicit anchor ship, else the kill target, else
   * the first foe */
  const anchorOf = (s: ShipState): ShipState | null => {
    if (s.anchorOrd !== null && states[s.anchorOrd].alive) return states[s.anchorOrd];
    if (s.targetOrd !== null) return states[s.targetOrd];
    return firstFoe(s);
  };

  /** the speed this ship is TRYING to fly, under scram, webs, and Rapid
   * Deployment (buff 22 boosts the PROP's speedFactor - modelled as the
   * pilot holding full burn: both the ceiling and the commanded speed scale
   * while the prop runs; declared) */
  const commandedVinf = (s: ShipState): number => {
    const boost = s.ship.propPair && !s.propBlocked
      ? 1 + shipBuffValue(s, 22, nowRef.t) / 100 : 1;
    const commanded = Math.abs(s.ship.flying.speed) * boost;
    const velMult = chainMultiplier(leaseRows(s.ord, ['web'], 37));
    let cap: number;
    if (s.ship.propPair) {
      const baseMax = s.propBlocked
        ? s.ship.propPair.inactiveMaxVel : s.ship.propPair.activeMaxVel * boost;
      cap = baseMax * velMult;
    } else {
      cap = commanded * velMult;
    }
    return Math.min(commanded, cap);
  };

  /** current inertia constant - prop state (state-dependent mass, measured)
   * times Evasive Maneuvers (60: negative value shrinks tau) */
  const tauNow = (s: ShipState, t: number): number => {
    const agilityBuff = 1 + shipBuffValue(s, 60, t) / 100;
    return (s.propBlocked
      ? (s.ship.tauInactive ?? s.ship.tauActive ?? 0)
      : (s.ship.tauActive ?? 0)) * agilityBuff;
  };

  // ---- in-flight ordnance: lead-intercept solves (missiles + drones) ----
  interface Flight {
    live: boolean;
    gen: number;
    kind: 'missile' | 'drone';
    shooterOrd: number;
    slotOrd: number;
    targetOrd: number;
    launchPos: Vec3;
    t0: number;
    speed: number;
    /** drones arrive at the target's orbit shell; missiles at the point */
    shell: number;
    /** missiles expire here; drones chase to the horizon */
    deadline: number;
    land: LandData | null;
  }
  const flights: Flight[] = [];

  /**
   * First t in [from, deadline] where the straight flight from launchPos
   * covers the target: f(t) = |targetPos(t) - launchPos| - shell
   * - speed*(t - t0) crosses zero. Scanned in 128 steps for the first
   * crossing, bisected to ~1e-12 s. A reach that closes only to within
   * 1e-6 m AT the deadline still lands (the r == maxRange knife edges of
   * the shipped fixtures are float-exact boundaries, preserved).
   */
  const interceptTime = (fl: Flight, from: number): number | null => {
    const victim = states[fl.targetOrd];
    const f = (tt: number): number =>
      vLen(vSub(posOf(victim, tt), fl.launchPos)) - fl.shell - fl.speed * (tt - fl.t0);
    const EPS = 1e-6;
    let a = Math.max(from, fl.t0);
    if (a > fl.deadline + 1e-12) return null;
    let fa = f(a);
    if (fa <= EPS) return a;
    const N = 128;
    const step = (fl.deadline - a) / N;
    if (step <= 0) return null;
    for (let i = 1; i <= N; i++) {
      const b = i === N ? fl.deadline : a + step;
      const fb = f(b);
      if (fb <= EPS) {
        if (fb > 0) return b; // float-fuzz reach exactly at the boundary
        let lo = a;
        let hi = b;
        for (let k = 0; k < 100; k++) {
          const mid = (lo + hi) / 2;
          if (f(mid) <= 0) hi = mid; else lo = mid;
        }
        return hi;
      }
      a = b;
      fa = fb;
    }
    void fa;
    return null;
  };

  const pushMissileLand = (fl: Flight, at: number): void => {
    const when = interceptTime(fl, at);
    if (when === null) { fl.live = false; return; } // expires - silent, as the old out-of-reach skip
    push({
      t: when, phase: PHASE.LAND, shipOrd: fl.shooterOrd, slotOrd: fl.slotOrd,
      kind: 'land', gen: fl.gen, data: fl.land!,
    });
  };

  const pushDroneArrive = (fl: Flight, at: number): void => {
    const when = interceptTime(fl, at);
    if (when === null) { fl.live = false; return; } // kited out - never arrives
    push({
      t: when, phase: PHASE.WAKE, shipOrd: fl.shooterOrd, slotOrd: fl.slotOrd,
      kind: 'droneArrive', gen: fl.gen,
    });
  };

  /** a victim's MOTION changed at t: every live flight chasing it re-solves
   * (the intercept equation keeps its launch point and start instant) */
  const resolveFlightsAt = (victimOrd: number, at: number): void => {
    for (const fl of flights) {
      if (!fl.live || fl.targetOrd !== victimOrd) continue;
      if (fl.kind === 'missile') {
        fl.gen += 1;
        pushMissileLand(fl, at);
      } else {
        const ws = states[fl.shooterOrd].weapons[fl.slotOrd];
        ws.gen += 1; // invalidates the previously scheduled arrival
        fl.gen = ws.gen;
        pushDroneArrive(fl, at);
      }
    }
  };

  /** speed cap or tau changed (webs, scram, prop, buffs): close the motion
   * at t and continue - exact segment composition, per kind */
  const reMotion = (s: ShipState, t: number): void => {
    nowRef.t = t;
    const cap = commandedVinf(s);
    const tau = tauNow(s, t);
    const m = s.mot;
    if (m.kind === 'lag') {
      const v = motVel(m, t);
      const dir = vLen(m.vCmd) > 1e-12 ? vNorm(m.vCmd)
        : vLen(v) > 1e-12 ? vNorm(v) : v3(1, 0, 0);
      s.mot = {
        kind: 'lag', t0: t, p0: motPos(m, t), v0: v, vCmd: vScale(dir, cap), tau,
      };
    } else if (m.kind === 'radial') {
      const ds = distanceSince(m.mseg, t) - m.s0;
      const r = Math.max(MIN_RANGE_M, m.r0 + m.sign * ds);
      s.mot = {
        ...m, r0: r, t0: t, s0: 0,
        mseg: { t0: t, v0: speedAt(m.mseg, t), vinf: cap, tau },
      };
    } else {
      const { r, phi } = spiralPolar(m, t);
      s.mot = {
        ...m, r0: r, phase0: phi, t0: t, s0: 0,
        mseg: { t0: t, v0: speedAt(m.mseg, t), vinf: cap, tau },
      };
    }
    resolveFlightsAt(s.ord, t);
  };

  /** enter the exact analytic circle at radius R about `center` -
   * KEEPATRANGE_HOLDS_EXACT_RADIUS (model-declared, not game-verified) */
  const snapCircle = (
    s: ShipState, t: number, center: Vec3, R: number, cap: number, tau: number,
  ): void => {
    const m = s.mot;
    if (m.kind === 'spiral' && Math.abs(m.angleRad - Math.PI / 2) < 1e-12
      && Math.abs(m.r0 - R) < 1e-9 && vLen(vSub(m.center, center)) < 1e-9) return;
    const rel = vSub(posOf(s, t), center);
    const { e1, e2 } = planeOf(rel);
    const vNow = vLen(velOf(s, t));
    s.mot = {
      kind: 'spiral', center, e1, e2, r0: Math.max(MIN_RANGE_M, R),
      phase0: 0, angleRad: Math.PI / 2, t0: t, s0: 0,
      mseg: { t0: t, v0: vNow, vinf: cap, tau },
    };
    resolveFlightsAt(s.ord, t);
  };

  /** exact hold-radius crossing within the coming tick (bisected on the
   * closed form) - keep-at-range reaches its ring event-exactly, off-grid */
  const scheduleHoldCross = (s: ShipState, t: number, R: number): void => {
    const anchor = anchorOf(s);
    if (!anchor) return;
    const f = (tt: number): number => pairDistance(s, anchor, tt) - R;
    const f0 = f(t);
    // one-tick micro-window; scheduling past the sim end is harmless (the
    // boundary check eats it), and clamping to a FIXED maxSeconds silently
    // blinded keep-at-range ships during a progress extension
    const microHorizon = t + 1;
    const f1 = f(microHorizon);
    if (f0 === 0 || (f0 > 0) === (f1 > 0)) return; // no crossing this tick
    let lo = t;
    let hi = microHorizon;
    for (let k = 0; k < 80; k++) {
      const mid = (lo + hi) / 2;
      if ((f(mid) > 0) === (f0 > 0)) lo = mid; else hi = mid;
    }
    push({ t: hi, phase: PHASE.ARRIVE, shipOrd: s.ord, slotOrd: 0, kind: 'arrive' });
  };

  /**
   * One steering decision - the per-tick commanded-velocity choice
   * (STEERING_AT_TICKS). Only behaviour ships steer; the legacy dial is
   * analytic and never re-aims.
   */
  const steer = (s: ShipState, t: number): void => {
    const b = s.ship.behaviour;
    if (!b || !s.alive) return;
    const anchor = anchorOf(s);
    nowRef.t = t;
    const cap = commandedVinf(s);
    const tau = tauNow(s, t);
    const p = posOf(s, t);
    const v = velOf(s, t);
    const anchorP = anchor ? posOf(anchor, t) : v3(0, 0, 0);
    const rel = vSub(p, anchorP);
    const r = Math.max(MIN_RANGE_M, vLen(rel));
    const rHat = vScale(rel, 1 / r);
    const lag = (dir: Vec3): void => {
      const vCmd = vScale(dir, cap);
      const m = s.mot;
      // a no-op re-aim keeps the segment - straight lines stay one segment
      if (m.kind === 'lag' && Math.abs(m.tau - tau) < 1e-15
        && vLen(vSub(m.vCmd, vCmd)) < 1e-9) return;
      // SHIPS_START_AT_COMMANDED_SPEED: the t=0 aim starts AT the commanded
      // vector; later re-aims inherit the true velocity and converge on the
      // measured lag law
      const v0 = t === 0 && vLen(v) < 1e-12 ? vCmd : v;
      s.mot = { kind: 'lag', t0: t, p0: p, v0, vCmd, tau };
      resolveFlightsAt(s.ord, t);
    };
    switch (b.kind) {
      case 'approach': lag(vScale(rHat, -1)); break;
      case 'flee': lag(rHat); break;
      case 'vector': lag(vNorm(b.dir)); break;
      case 'keepAtRange': {
        const R = Math.max(MIN_RANGE_M, b.rangeM);
        if (Math.abs(r - R) > 1e-6) {
          lag(vScale(rHat, r > R ? -1 : 1));
          scheduleHoldCross(s, t, R);
        } else {
          snapCircle(s, t, anchorP, R, cap, tau);
        }
        break;
      }
      case 'orbit': {
        // ORBIT_TANGENT_PURSUIT_UNVERIFIED: aim at the tangent point of the
        // commanded circle at full commanded speed, re-aimed each tick. The
        // radius inflation of fast/heavy ships EMERGES from this law plus
        // the tick - steady state r = tau*v^2/sqrt(vmax^2 - v^2), the
        // community-measured formula, with the measured tau.
        const R = Math.max(MIN_RANGE_M, b.radiusM);
        const { e2 } = planeOf(rel);
        const tHat = e2;
        if (r > R * (1 + 1e-9)) {
          const q = Math.sqrt(Math.max(0, r * r - R * R));
          lag(vNorm(vAdd(vScale(rHat, -q / r), vScale(tHat, R / r))));
        } else if (r < R * (1 - 1e-9)) {
          lag(vNorm(vAdd(tHat, vScale(rHat, (R - r) / R))));
        } else {
          lag(tHat);
        }
        break;
      }
    }
  };

  /** derive each ship's Motion from its legacy inputs, every position now
   * known (behaviour ships stay still until their seed-time steer) */
  const deriveMotion = (s: ShipState): void => {
    s.anchorOrd = (() => {
      if (s.ship.anchorId === undefined) return null;
      const i = states.findIndex((x) => x.ship.id === s.ship.anchorId);
      return i >= 0 && i !== s.ord ? i : null;
    })();
    if (s.ship.behaviour !== undefined) {
      const m0 = s.mot;
      s.mot = {
        kind: 'lag', t0: 0, p0: motPos(m0, 0), v0: v3(0, 0, 0),
        vCmd: v3(0, 0, 0), tau: tauNow(s, 0),
      };
      return;
    }
    // LEGACY_DIAL_IS_EQUIANGULAR_SPIRAL: the dial maps to exact geometry
    const p0 = motPos(s.mot, 0);
    const foe = firstFoe(s);
    const anchorP = foe ? motPos(foe.mot, 0) : v3(0, 0, 0);
    const speed0 = s.ship.flying.speed;
    if (speed0 === 0 || !foe) {
      s.mot = { kind: 'lag', t0: 0, p0, v0: v3(0, 0, 0), vCmd: v3(0, 0, 0), tau: 0 };
      return;
    }
    const rel = vSub(p0, anchorP);
    const r0 = Math.max(MIN_RANGE_M, vLen(rel));
    const { e1, e2 } = planeOf(rel);
    const theta = ((s.ship.flying.angleDeg % 360) + 360) % 360;
    const mseg: SpeedSeg = { t0: 0, v0: speed0, vinf: speed0, tau: 0 };
    if (theta === 0 || theta === 180) {
      s.mot = {
        kind: 'radial', center: anchorP, uHat: e1, r0,
        sign: theta === 0 ? -1 : 1, t0: 0, s0: 0, mseg,
      };
    } else {
      s.mot = {
        kind: 'spiral', center: anchorP, e1, e2, r0, phase0: 0,
        angleRad: rad(theta), t0: 0, s0: 0, mseg,
      };
    }
  };

  const views = (): ShipView[] => states.map((s) => ({
    id: s.ship.id,
    name: s.ship.name,
    side: s.ship.side,
    alive: s.alive,
    hpTotal: totalHp(s),
  }));

  const retarget = (s: ShipState, at: number): void => {
    const enemies = views().filter((v) => v.side !== s.ship.side);
    const chosen = pick(s.ship.id, enemies);
    const next = chosen === null ? null
      : states.find((x) => x.ship.id === chosen && x.alive)?.ord ?? null;
    if (next === s.targetOrd) return;
    s.targetOrd = next;
    // locking starts the moment you switch, not when a gun next cycles —
    // the retarget IS the lock command (caught by fixture R7: the old code
    // wasted up to a full weapon cycle before even starting the lock)
    if (next !== null && !isLocked(s, next)) beginLock(s, states[next], at);
    for (const w of s.weapons) w.spoolCycles = 0;
    // mutadaptive spool follows the Trig rules: reset on switch
    for (const ps of s.projs) ps.spoolCycles = 0;
    s.weapons.forEach((ws, i) => {
      const w = s.ship.weapons[i];
      if (w.kind === 'drone' && next !== null) {
        ws.eligible = false;
        ws.gen += 1;
        for (const fl of flights) {
          if (fl.live && fl.kind === 'drone' && fl.shooterOrd === s.ord
            && fl.slotOrd === i) fl.live = false;
        }
        const speed = w.droneSpeed ?? 0;
        if (speed > 0) {
          // DRONE_TRAVEL_ENDS_AT_ORBIT_SHELL: chase the target's true
          // trajectory; arrive at the drone's own orbit radius (attr 416)
          const fl: Flight = {
            live: true, gen: ws.gen, kind: 'drone', shooterOrd: s.ord,
            slotOrd: i, targetOrd: next, launchPos: posOf(s, at), t0: at,
            speed,
            shell: Math.max(0, w.droneOrbit ?? s.ship.droneOrbit ?? DEFAULT_DRONE_ORBIT),
            deadline: hardMax + 60,
            land: null,
          };
          flights.push(fl);
          pushDroneArrive(fl, at);
        } else {
          push({
            t: at, phase: PHASE.WAKE, shipOrd: s.ord, slotOrd: i,
            kind: 'droneArrive', gen: ws.gen,
          });
        }
      }
    });
  };

  /** most-damaged living friendly, never self — the logistics rule */
  const woundedFriend = (s: ShipState): ShipState | null => {
    let best: ShipState | null = null;
    let bestFrac = 1 + 1e-9;
    for (const e of states) {
      if (e.ord === s.ord || e.ship.side !== s.ship.side || !e.alive) continue;
      const max = e.ship.layers.reduce((n, l) => n + l.hp, 0);
      const frac = max > 0 ? totalHp(e) / max : 1;
      if (frac < bestFrac) { bestFrac = frac; best = e; }
    }
    return best;
  };

  const affordOrSleep = (
    s: ShipState, at: number, cost: number, policyKey: string,
    slotOrd: number, retryKind: 'capWake' | 'repWake' | 'projWake' | 'hardWake',
    markSleeping: () => void,
  ): boolean => {
    const policy: CapPolicy = s.ship.capPolicy?.[policyKey] ?? { mode: 'always' };
    if (policy.mode === 'off') return false;
    if (cost <= 0) return true;
    const have = capNow(s, at);
    const floor = policy.mode === 'feather'
      ? policy.floorFrac * s.ship.capacitor.capacity : 0;
    if (have - cost >= floor) return true;
    markSleeping();
    // a module whose cost cannot be met even at FULL capacitor can never wake
    // by recharge — park it (one report, never a spin). An injection that
    // raises the capacitor still re-wakes it, and it re-checks then.
    if (cost + floor > s.ship.capacitor.capacity) {
      if (!s.starvedReported.has(policyKey)) {
        s.starvedReported.add(policyKey);
        log(at, 'capStarved', s, policyKey);
      }
      return false;
    }
    const target = cost + floor;
    const wait = capWakeSeconds(have, target, s.ship.capacitor);
    if (wait === null) {
      if (!s.starvedReported.has(policyKey)) {
        s.starvedReported.add(policyKey);
        log(at, 'capStarved', s, policyKey);
      }
      return false;
    }
    push({
      t: at + Math.max(wait, 1e-9), phase: PHASE.WAKE,
      shipOrd: s.ord, slotOrd, kind: retryKind,
    });
    return false;
  };

  const spend = (s: ShipState, at: number, cost: number): void => {
    if (cost <= 0) return;
    capNow(s, at);
    s.cap = Math.max(0, s.cap - cost);
    const frac = s.ship.capacitor.capacity > 0 ? s.cap / s.ship.capacitor.capacity : 0;
    if (frac < s.capMin) s.capMin = frac;
    // a falling capacitor is what OPENS the injection gate (headroom for the
    // full stick / the 25% cliff) — held boosters re-check on every spend
    // (deferred call: discWake is defined later in this closure, and spend
    // only ever runs inside the event loop, after everything is initialized)
    if (s.ship.injectDiscipline && s.boosts.some((b) => b.discHeld)) discWake(s, at);
  };

  /** external energy arriving (nos gain, cap transfer, booster injection)
   * wakes every module sleeping on an empty capacitor */
  const creditCap = (s: ShipState, at: number, gj: number): void => {
    if (gj <= 0) return;
    capNow(s, at);
    s.cap = Math.min(s.ship.capacitor.capacity, s.cap + gj);
    s.weapons.forEach((ws, i) => {
      if (ws.sleeping) push({ t: at, phase: PHASE.WAKE, shipOrd: s.ord, slotOrd: i, kind: 'capWake' });
    });
    s.reps.forEach((rs, i) => {
      if (rs.sleeping) push({ t: at, phase: PHASE.WAKE, shipOrd: s.ord, slotOrd: i, kind: 'repWake' });
    });
    s.projs.forEach((ps, i) => {
      if (ps.sleeping) push({ t: at, phase: PHASE.WAKE, shipOrd: s.ord, slotOrd: i, kind: 'projWake' });
    });
    if (s.hardSleeping) {
      push({ t: at, phase: PHASE.WAKE, shipOrd: s.ord, slotOrd: 0, kind: 'hardWake' });
    }
  };

  /** the victim's resist gate for a projected kind — engine-final hull attr,
   * default 1 (RESIST_SCALES_STRENGTH) */
  const resistGate = (victim: ShipState, attr?: number): number => {
    if (attr === undefined) return 1;
    const v = victim.ship.resists?.[attr];
    return v === undefined || !Number.isFinite(v) ? 1 : v;
  };

  // -------------------------------------------------------------------------
  // COMMAND-BURST BUFFS — winner-take-all per buff id, live leases only
  // -------------------------------------------------------------------------
  /** the winning value of a MODULE-attribute buff (11 rep cycles, 14 armor/
   * hull rep cycles, 21 tackle range, 22 prop boost, 60 agility) on a ship */
  const shipBuffValue = (v: ShipState, buffId: number, at: number): number => {
    if (v.buffLeases.length === 0) return 0;
    return buffValue(v.buffLeases.filter((l) => l.expiresAt > at), buffId);
  };

  /** buffed maximum of a layer — Extension/Reinforcement charges raise
   * shield (12) and armor (15) CAPACITY; heals fill the new headroom and
   * passive regen aims at the buffed ceiling */
  const layerMax = (v: ShipState, li: number, at: number): number => {
    const base = v.ship.layers[li]?.hp ?? 0;
    if (base <= 0) return 0;
    const bid = li === 0 ? 12 : li === 1 ? 15 : 0;
    if (bid === 0) return base;
    return base * (1 + shipBuffValue(v, bid, at) / 100);
  };

  const buffMult = (v: ShipState, attr: number, at: number): number => {
    if (v.buffLeases.length === 0) return 1;
    const live = v.buffLeases.filter((l) => l.expiresAt > at);
    if (live.length !== v.buffLeases.length) v.buffLeases = live;
    return buffMultiplier(live, attr);
  };

  // -------------------------------------------------------------------------
  // THE LOCK MODEL
  // -------------------------------------------------------------------------

  /** effective scan resolution: hull-final 564 × damp/RSB leases × buff 16 */
  const scanResEff = (v: ShipState, at: number): number => {
    const base = v.ship.scanRes;
    if (base === undefined || base <= 0) return Infinity; // pre-lock-model input
    return base
      * chainMultiplier(leaseRows(v.ord, ['damp', 'remoteSensorBooster'], 564))
      * buffMult(v, 564, at);
  };

  const targetRangeEff = (v: ShipState, at: number): number => {
    const base = v.ship.maxTargetRangeM;
    if (base === undefined || base <= 0) return Infinity;
    return base
      * chainMultiplier(leaseRows(v.ord, ['damp', 'remoteSensorBooster'], 76))
      * buffMult(v, 76, at);
  };

  /** DECLARED LOCK_TIME_FORMULA: 40000 / (scanRes · asinh(sig)²), from the
   * LIVE effective values at lock start */
  const lockSeconds = (locker: ShipState, victim: ShipState, at: number): number => {
    const sr = scanResEff(locker, at);
    if (!Number.isFinite(sr)) return 0;
    const sig = victimState(victim, at).sig;
    const a = Math.asinh(Math.max(1, sig));
    return 40000 / Math.max(1e-6, sr * a * a);
  };

  const isLocked = (locker: ShipState, victimOrd: number): boolean =>
    locker.ship.scanRes === undefined || locker.locks.has(victimOrd);

  /** begin (or continue) locking; returns when the lock will complete, or
   * null when locking is impossible right now (jammed at someone else,
   * target beyond range) */
  const beginLock = (locker: ShipState, victim: ShipState, at: number): number | null => {
    if (locker.ship.scanRes === undefined) { locker.locks.add(victim.ord); return at; }
    if (locker.locks.has(victim.ord)) return at;
    const pending = locker.locking.get(victim.ord);
    if (pending !== undefined) return pending;
    if (at < locker.jammedUntil && victim.ord !== locker.jammerOrd) return null;
    if (pairDistance(locker, victim, at) > targetRangeEff(locker, at)) return null;
    const done = at + lockSeconds(locker, victim, at);
    locker.locking.set(victim.ord, done);
    push({ t: done, phase: PHASE.LOCKED, shipOrd: locker.ord, slotOrd: victim.ord, kind: 'lockDone', gen: locker.lockGen });
    return done;
  };

  // APPLICATION — the SHIPPED formulas, fed the geometry of the event's
  // instant, through the resolver (disruption on the shooter, painter/web/
  // prop state on the victim). Nothing re-derived.
  const applicationOfNow = (s: ShipState, victim: ShipState, w0: SimWeapon, at: number): number => {
    const w = disruptedWeapon(s, w0);
    const vs = victimState(victim, at);
    // TRUE transversal: the relative velocity component perpendicular to
    // the line of sight - vectors, not a dial convention
    const dvec = vSub(posOf(victim, at), posOf(s, at));
    const dist = Math.max(MIN_RANGE_M, vLen(dvec));
    const u = vSub(velOf(victim, at), velOf(s, at));
    const transversal = vLen(vCross(dvec, u)) / dist;
    return applicationOf(w, {
      name: victim.ship.name,
      signatureRadius: vs.sig,
      velocity: Math.abs(vs.speed),
      resonance: { em: 1, thermal: 1, kinetic: 1, explosive: 1 },
    }, {
      distance: dist,
      transversal,
      droneOrbit: s.ship.droneOrbit ?? DEFAULT_DRONE_ORBIT,
      // a drone whose OWNER is beyond control range fights with nothing —
      // the shipped applicationOf rule, finally wired into the event sim
      // (caught live: a Guardian's drones were killing at 100 km on a
      // 60 km control range)
      droneControlRange: s.ship.droneControlRangeM,
    });
  };

  function healLayerOn(victim: ShipState, layerIdx: number, amount: number, at: number): number {
    const layer = victim.ship.layers[layerIdx];
    if (!layer || layer.hp <= 0 || amount <= 0) return 0;
    if (layerIdx === 0) shieldNow(victim, at);
    const before = victim.hp[layerIdx];
    // Extension/Reinforcement bursts raise the CEILING (buff 12/15) — heals
    // fill the buffed headroom
    victim.hp[layerIdx] = Math.min(layerMax(victim, layerIdx, at), victim.hp[layerIdx] + amount);
    return victim.hp[layerIdx] - before;
  }

  function healLayer(s: ShipState, r: RepairCycle, at: number): void {
    const li = r.kind === 'shield' ? 0 : r.kind === 'armor' ? 1 : 2;
    const gained = healLayerOn(s, li, r.amount, at);
    if (gained > 0) s.heals += gained;
  }

  // -------------------------------------------------------------------------
  // INJECT-REPPING DISCIPLINE (constants + rationale at DISC_REP_ON_FRAC)
  // -------------------------------------------------------------------------

  /** may this rep START a cycle right now, under the discipline?
   * Shield reps ride the hysteresis band (ON ≤30% — the passive-regen peak
   * zone — OFF ≥55%); armour/hull reps have no band because their heal lands
   * at cycle END — waiting low with a 10 s delayed heal is how ships die —
   * so they get only the no-waste rule: never start a cycle whose full heal
   * would overflow the layer. */
  const discRepAllowed = (s: ShipState, r: RepairCycle, at: number): boolean => {
    const li = r.kind === 'shield' ? 0 : r.kind === 'armor' ? 1 : 2;
    if (li === 0) shieldNow(s, at);
    const max = layerMax(s, li, at);
    if (max <= 0) return true; // degenerate layer — the discipline has no opinion
    if (li === 0) {
      const frac = s.hp[0] / max;
      if (frac <= DISC_REP_ON_FRAC) s.repBandOn = true;
      else if (frac >= DISC_REP_OFF_FRAC) s.repBandOn = false;
      if (!s.repBandOn) return false;
    }
    return max - s.hp[li] >= r.amount - 1e-9; // the whole heal must land
  };

  /** CYCLE-SYNCED INJECTION (v0.116.0, owner's correction): best practice
   * times sticks against the TANK MODULES' cycles, not the cap level — a
   * level-triggered stick can fire mid-way between booster cycles and its
   * GJ then sits exposed to neuts for up to a whole cycle before being
   * spent. So under discipline, an injector whose ship has cap-consuming
   * tank modules NEVER fires on its own clock: sticks leave the magazine
   * only through the jitPull at a rep/hardener cycle start (which defends
   * the 25% reserve — see jitPull), landing and being spent in the same
   * second. The own-clock gate below survives ONLY for fits with no
   * cap-consuming tank (ASB gunboats etc.), where the sticks serve the
   * guns and the recharge-peak hover is the whole doctrine. */
  const discBoostAllowed = (s: ShipState, b: CapBoosterCycle, at: number): boolean => {
    const tankConsumers = s.ship.repairs.some((r) => r.capPerCycle > 0)
      || s.ship.hardeners !== undefined;
    if (tankConsumers) return false; // pull-only — the tank's cycles are the clock
    const cap = s.ship.capacitor.capacity;
    if (cap <= 0) return true;
    capNow(s, at);
    // RELATIVE tolerance: the closed-form recharge trickle leaves a few
    // nano-GJ above zero, which an absolute 1e-9 rejected when the stick
    // equalled the whole capacitor (caught by fixture H2's first run)
    if (cap - s.cap < b.injectGj - Math.max(1e-9, b.injectGj * 1e-6)) return false;
    return s.cap / cap <= DISC_CAP_STICK_FRAC;
  };

  /** the injection itself — shared by the booster's own cycle (boostStart)
   * and the tank's just-in-time pull (repStart). Decrements the magazine,
   * logs the auditable timeline entry, credits the cap (waking sleepers),
   * and schedules the module's next cycle. False = the magazine cannot
   * cover a cycle right now (mid-reload / dry). */
  const fireBoost = (s: ShipState, slotOrd: number, t: number): boolean => {
    const b = s.ship.capBoosters?.[slotOrd];
    const bs = s.boosts[slotOrd];
    if (!b || !bs || bs.chargesLeft < b.charges.perCycle) return false;
    bs.chargesLeft -= b.charges.perCycle;
    const before = capNow(s, t);
    const landed = Math.min(s.ship.capacitor.capacity - before, b.injectGj);
    log(t, 'injected', s, `${Math.round(landed)} of ${Math.round(b.injectGj)} GJ landed`);
    creditCap(s, t, b.injectGj);
    push({
      t: t + b.cycleSeconds, phase: PHASE.WAKE,
      shipOrd: s.ord, slotOrd, kind: 'boostStart',
    });
    return true;
  };

  /** JUST-IN-TIME stick pull (v0.113.0; v0.116.0 it became the ONLY
   * injection path for tanked fits): a rep/hardener cycle pulls a HELD
   * stick at its own start whenever paying would leave the cap below the
   * 25% reserve (callers pass needCost = cycle cost + reserve) — inject
   * and spend in the same second, nothing left idle for the neuts. In
   * quiet phases the same rule hovers the cap at the recharge peak; the
   * two regimes need no separate logic. Only held boosters can be pulled
   * (one mid-cycle is genuinely unavailable — the module's own cadence is
   * a hard ceiling), and the whole stick must land. */
  const jitPull = (s: ShipState, at: number, needCost: number): void => {
    if (!s.ship.injectDiscipline) return;
    for (let bi = 0; bi < s.boosts.length; bi += 1) {
      const bb = s.ship.capBoosters![bi];
      const bbs = s.boosts[bi];
      if (!bbs.discHeld) continue;
      if (s.ship.capacitor.capacity - capNow(s, at)
        < bb.injectGj - Math.max(1e-9, bb.injectGj * 1e-6)) continue;
      if (fireBoost(s, bi, at)) bbs.discHeld = false;
      if (capNow(s, at) >= needCost) break;
    }
  };

  /** gates only OPEN when shield/cap FALL — damage (land), own cap spend and
   * enemy neut/nos drains call this; reps re-check first so a newly-woken
   * rep lets its boosters follow. Both wakes schedule into REP_START phase:
   * callers sit at LAND (6), REP_START (8) and PROJ_END (3), and the
   * declared heap rule forbids a same-t push into an EARLIER phase — the
   * boostStart handler is phase-agnostic, so this is safe. */
  const discWake = (s: ShipState, at: number): void => {
    if (!s.ship.injectDiscipline || !s.alive) return;
    s.reps.forEach((rs, i) => {
      if (rs.discHeld && discRepAllowed(s, s.ship.repairs[i], at)) {
        rs.discHeld = false;
        push({ t: at, phase: PHASE.REP_START, shipOrd: s.ord, slotOrd: i, kind: 'repStart' });
      }
    });
    s.boosts.forEach((bs, i) => {
      if (bs.discHeld && discBoostAllowed(s, s.ship.capBoosters![i], at)) {
        bs.discHeld = false;
        push({ t: at, phase: PHASE.REP_START, shipOrd: s.ord, slotOrd: i, kind: 'boostStart' });
      }
    });
  };

  /** scram bookkeeping: total live block strength on a victim */
  const blockSum = (victimOrd: number): number =>
    leases.reduce((n, l) => (l.victimOrd === victimOrd && l.kind === 'scram'
      ? n + l.blockStrength : n), 0);

  /** re-evaluate a victim's prop state after lease changes.
   * SCRAM_BLOCK_WHILE_POSITIVE; PROP_RESTART_ON_RELEASE. */
  const refreshPropState = (victim: ShipState, at: number): void => {
    if (!victim.ship.propPair?.blockable) return;
    const blocked = blockSum(victim.ord) > 0;
    if (blocked === victim.propBlocked) return;
    victim.propBlocked = blocked;
    log(at, blocked ? 'scrammed' : 'scramReleased', victim);
    reMotion(victim, at);
  };

  // -------------------------------------------------------------------------
  // SEED
  // -------------------------------------------------------------------------
  // motion first: every ship's true position and closed form exists before
  // anything (drone travel, lock gates) reads geometry
  for (const s of states) {
    if (s.alive) deriveMotion(s);
  }
  for (const s of states) {
    if (!s.alive) continue;
    retarget(s, 0);
    // behaviour ships aim NOW, with targets picked - the t=0 steer starts
    // them at their commanded vector (SHIPS_START_AT_COMMANDED_SPEED)
    if (s.ship.behaviour !== undefined) steer(s, 0);
    s.ship.weapons.forEach((w, i) => {
      if (w.kind !== 'drone') {
        push({ t: 0, phase: PHASE.FIRE, shipOrd: s.ord, slotOrd: i, kind: 'fire' });
      }
    });
    s.ship.repairs.forEach((_, i) => {
      push({ t: 0, phase: PHASE.REP_START, shipOrd: s.ord, slotOrd: i, kind: 'repStart' });
    });
    (s.ship.capBoosters ?? []).forEach((_, i) => {
      push({ t: 0, phase: PHASE.WAKE, shipOrd: s.ord, slotOrd: i, kind: 'boostStart' });
    });
    if (s.ship.hardeners) {
      push({ t: 0, phase: PHASE.WAKE, shipOrd: s.ord, slotOrd: 0, kind: 'hardStart' });
    }
    (s.ship.projected ?? []).forEach((_, i) => {
      push({ t: 0, phase: PHASE.PROJ_START, shipOrd: s.ord, slotOrd: i, kind: 'projStart' });
    });
    // LOCKS_ACQUIRED_FROM_ZERO: the opening target is NOT pre-locked — the
    // seed-time retarget above already began the lock at t=0, and the fire/
    // projection gates hold everything targeted until it completes. A ship
    // without scanRes locks instantly (isLocked short-circuits), keeping
    // pre-lock-model inputs exactly as they were.
    // a running burst's buffs are ON the fleet before the first volley
    (s.ship.bursts ?? []).forEach((b, i) => {
      for (const ally of states) {
        if (ally.ship.side !== s.ship.side) continue;
        for (const buff of b.buffs) {
          ally.buffLeases.push({ buffId: buff.buffId, value: buff.value, expiresAt: b.buffSeconds });
        }
      }
      push({ t: b.cycleSeconds, phase: PHASE.WAKE, shipOrd: s.ord, slotOrd: i, kind: 'burstStart' });
    });
    // legacy hold range: estimate the crossing on the radial closed form
    // (advisory - the arrive handler re-checks the true radius when it pops)
    if (s.ship.behaviour === undefined && s.mot.kind === 'radial'
      && s.ship.commandedRange !== undefined) {
      const m = s.mot;
      const commanded = s.ship.commandedRange;
      const closing0 = -m.sign * speedAt(m.mseg, 0);
      if (Math.abs(commanded - m.r0) > 1e-9 && Math.abs(closing0) > 1e-9) {
        const dt = (m.r0 - commanded) / closing0;
        if (dt > 0) push({ t: dt, phase: PHASE.ARRIVE, shipOrd: s.ord, slotOrd: 0, kind: 'arrive' });
      }
    }
  }

  // 1 Hz steering ticks - only when a true-emulation behaviour exists; the
  // legacy dial is analytic and needs none (STEERING_AT_TICKS)
  if (states.some((x) => x.ship.behaviour !== undefined)) {
    push({ t: 1, phase: PHASE.ARRIVE, shipOrd: 0, slotOrd: 0, kind: 'tick' });
  }

  // SPEED BUFFS APPLY FROM THE FIRST METRE: a ship holding Rapid Deployment
  // (22) or Evasive Maneuvers (60) re-opens its motion segment at t=0 so the
  // boost is in its speed from the start — without this the buff only landed
  // on the NEXT segment change and a buffed closer flew at unbuffed speed
  // (caught by fixture BB4)
  for (const s of states) {
    if (!s.alive) continue;
    if (shipBuffValue(s, 22, 0) !== 0 || shipBuffValue(s, 60, 0) !== 0) {
      reMotion(s, 0);
    }
  }

  // -------------------------------------------------------------------------
  // SAMPLER - 1 Hz chart series, presentation only. Rows are emitted by
  // queue events at phase SAMPLE (post-steer geometry); the closing fill
  // covers the tail after the loop drains.
  // -------------------------------------------------------------------------
  const series: EventBattleResult['series'] = [];
  let nextSample = 0;
  const sampleRow = (at: number): void => {
    const hp: Record<string, number> = {};
    const cap: Record<string, number> = {};
    const range: Record<string, number> = {};
    const speed: Record<string, number> = {};
    const transversal: Record<string, number> = {};
    const sig: Record<string, number> = {};
    const pos: Record<string, [number, number, number]> = {};
    for (const s of states) {
      shieldNow(s, at);
      const max = s.ship.layers.reduce((n, l) => n + l.hp, 0);
      hp[s.ship.id] = max > 0 ? totalHp(s) / max : 0;
      cap[s.ship.id] = s.ship.capacitor.capacity > 0
        ? capNow(s, at) / s.ship.capacitor.capacity : 0;
      range[s.ship.id] = rangeNow(s, at);
      const vv = velOf(s, at);
      speed[s.ship.id] = vLen(vv);
      const foe = s.targetOrd !== null ? states[s.targetOrd] : firstFoe(s);
      if (foe) {
        const dvec = vSub(posOf(foe, at), posOf(s, at));
        const u = vSub(velOf(foe, at), velOf(s, at));
        transversal[s.ship.id] = vLen(vCross(dvec, u))
          / Math.max(MIN_RANGE_M, vLen(dvec));
      } else {
        transversal[s.ship.id] = 0;
      }
      sig[s.ship.id] = victimState(s, at).sig;
      const pp = posOf(s, at);
      pos[s.ship.id] = [pp.x, pp.y, pp.z];
    }
    series.push({ t: at, hp, cap, range, speed, transversal, sig, pos });
  };
  const sample = (upTo: number): void => {
    while (nextSample <= upTo + 1e-12) {
      sampleRow(nextSample);
      nextSample += SAMPLE_DT;
    }
  };
  push({ t: 0, phase: PHASE.SAMPLE, shipOrd: 0, slotOrd: 0, kind: 'sample' });

  // -------------------------------------------------------------------------
  // LOOP. After a side is wiped, ordnance already in flight still resolves.
  // -------------------------------------------------------------------------
  let t = 0;
  let lastDeathT: number | null = null;
  let guard = 0;
  const GUARD_MAX = 2_000_000;

  while (heap.size > 0) {
    const bothUp = sideAlive('a') && sideAlive('b');
    if (!bothUp && pendingLand === 0) break;
    const e = heap.pop()!;
    if (e.kind === 'land') pendingLand -= 1;
    if (e.t > horizon) {
      // at the boundary: was the fight still MOVING inside the stall
      // window? Then buy more time (up to hardMax) instead of cutting a
      // fight whose ending is visible. A true equilibrium stops here.
      if (horizon < hardMax && horizon - lastProgressT < STALL_WINDOW_S) {
        horizon = Math.min(hardMax, Math.max(horizon + EXTEND_STEP_S, lastProgressT + STALL_WINDOW_S));
      }
      if (e.t > horizon) { t = horizon; break; }
    }
    if (!bothUp && e.kind !== 'land' && e.kind !== 'sample') continue;
    if (++guard > GUARD_MAX) break;
    t = e.t;
    const s = states[e.shipOrd];

    switch (e.kind) {
      case 'arrive': {
        if (!s.alive) break;
        // keep-at-range behaviour: the ring crossing computed by
        // scheduleHoldCross - snap onto the exact circle
        if (s.ship.behaviour?.kind === 'keepAtRange') {
          const anchor = anchorOf(s);
          if (!anchor) break;
          const R = Math.max(MIN_RANGE_M, s.ship.behaviour.rangeM);
          if (Math.abs(pairDistance(s, anchor, t) - R) <= 1e-3) {
            nowRef.t = t;
            snapCircle(s, t, posOf(anchor, t), R, commandedVinf(s), tauNow(s, t));
          }
          break;
        }
        if (s.arrived || s.mot.kind !== 'radial') break;
        // legacy hold: advisory event - re-check the REAL radius (webs may
        // have slowed the burn); if short, re-estimate and go around again
        const m = s.mot;
        const ds = distanceSince(m.mseg, t) - m.s0;
        const here = Math.max(MIN_RANGE_M, m.r0 + m.sign * ds);
        const commanded = s.ship.commandedRange ?? here;
        if (here - commanded > 1) {
          const v = Math.max(1e-6, -m.sign * speedAt(m.mseg, t));
          push({ t: t + (here - commanded) / v, phase: PHASE.ARRIVE, shipOrd: s.ord, slotOrd: 0, kind: 'arrive' });
          break;
        }
        s.arrived = true;
        // approach-then-orbit: the exact legacy semantic (angle -> 90) - the
        // ship circles at the radius it arrived on, magnitude seg untouched
        s.flying = { ...s.flying, angleDeg: 90 };
        const relArr = vSub(motPos(m, t), m.center);
        const { e1, e2 } = planeOf(relArr);
        s.mot = {
          kind: 'spiral', center: m.center, e1, e2,
          r0: here, phase0: 0, angleRad: Math.PI / 2,
          t0: t, s0: distanceSince(m.mseg, t), mseg: m.mseg,
        };
        resolveFlightsAt(s.ord, t);
        break;
      }

      case 'tick': {
        // the 1 Hz server tick: every behaviour ship re-aims, ord order
        for (const x of states) {
          if (x.alive && x.ship.behaviour !== undefined) steer(x, t);
        }
        // unconditional: the horizon can EXTEND, and a chain that stopped
        // scheduling at the old boundary would leave the extension blind
        // (unsteered, unsampled). One surplus event past the end is free —
        // the boundary check above eats it.
        push({ t: t + 1, phase: PHASE.ARRIVE, shipOrd: 0, slotOrd: 0, kind: 'tick' });
        break;
      }

      case 'sample': {
        if (t >= nextSample - 1e-12) {
          sampleRow(nextSample);
          nextSample += SAMPLE_DT;
        }
        push({ t: t + SAMPLE_DT, phase: PHASE.SAMPLE, shipOrd: 0, slotOrd: 0, kind: 'sample' });
        break;
      }

      case 'droneArrive': {
        if (!s.alive) break;
        const ws = s.weapons[e.slotOrd];
        if (e.gen !== undefined && e.gen !== ws.gen) break;
        for (const fl of flights) {
          if (fl.live && fl.kind === 'drone' && fl.shooterOrd === s.ord
            && fl.slotOrd === e.slotOrd) fl.live = false;
        }
        ws.eligible = true;
        push({ t, phase: PHASE.FIRE, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'fire', gen: ws.gen });
        break;
      }

      case 'capWake': {
        const ws = s.weapons[e.slotOrd];
        if (!ws || !ws.sleeping) break;
        ws.sleeping = false;
        push({ t, phase: PHASE.FIRE, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'fire', gen: ws.gen });
        break;
      }

      case 'fire': {
        if (!s.alive) break;
        const w = s.ship.weapons[e.slotOrd];
        const ws = s.weapons[e.slotOrd];
        if (!ws.eligible) break;
        if (e.gen !== undefined && w.kind === 'drone' && e.gen !== ws.gen) break;
        if (s.targetOrd === null || !states[s.targetOrd].alive) {
          retarget(s, t);
          if (s.targetOrd === null) break;
        }
        const victim = states[s.targetOrd];
        if (!victim.alive) break;
        if (w.kind === 'drone' && !ws.eligible) break;

        // THE LOCK GATE: no targeted action mid-lock. An unlocked target
        // starts (or continues) locking and the weapon's cycle resumes the
        // instant the lock completes — guns auto-fire on lock in EVE too.
        if (!isLocked(s, victim.ord)) {
          const done = beginLock(s, victim, t);
          push({
            t: done !== null ? Math.max(done, t + 1e-9) : t + 1,
            phase: PHASE.FIRE, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'fire', gen: ws.gen,
          });
          break;
        }

        if (w.clip && ws.clipLeft < w.clip.perCycle) {
          ws.spoolCycles = 0;
          log(t, 'reloadStart', s, `${w.typeId}`);
          push({
            t: t + w.clip.reloadSeconds, phase: PHASE.WAKE,
            shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'gunReloadDone',
          });
          break;
        }

        if (!affordOrSleep(s, t, w.capPerCycle, `wpn${e.slotOrd}`, e.slotOrd, 'capWake',
          () => { ws.sleeping = true; })) {
          ws.spoolCycles = 0;
          break;
        }
        spend(s, t, w.capPerCycle);
        if (w.clip) ws.clipLeft -= w.clip.perCycle;

        let spoolMult = 1;
        if (w.spool) {
          const bonus = Math.min(ws.spoolCycles * w.spool.perCycle, w.spool.max);
          spoolMult = 1 + bonus;
          if (bonus >= w.spool.max
            && (ws.spoolCycles - 1) * w.spool.perCycle < w.spool.max) {
            log(t, 'spoolMax', s, `${w.typeId}`);
          }
          ws.spoolCycles += 1;
        }

        s.volleys += 1;
        const volley: Damage = {
          em: w.volley.em * spoolMult,
          thermal: w.volley.thermal * spoolMult,
          kinetic: w.volley.kinetic * spoolMult,
          explosive: w.volley.explosive * spoolMult,
        };
        // guidance disruption shrinks reach and stretches flight - judged at
        // launch through the shooter's own disrupted weapon
        const dw = w.kind === 'missile' ? disruptedWeapon(s, w) : w;
        if (dw.kind === 'missile' && dw.missileVelocity && dw.missileVelocity > 0) {
          // MISSILE_INTERCEPT_LEAD_PURSUIT: land when the straight flight
          // from the launch point covers the target's true position, within
          // maxRange/velocity; no root = the missile expires (silent, as
          // the old out-of-reach skip was)
          const fl: Flight = {
            live: true, gen: 0, kind: 'missile', shooterOrd: s.ord,
            slotOrd: e.slotOrd, targetOrd: victim.ord,
            launchPos: posOf(s, t), t0: t, speed: dw.missileVelocity,
            shell: 0,
            deadline: dw.maxRange !== undefined
              ? t + dw.maxRange / dw.missileVelocity : hardMax + 60,
            land: null,
          };
          fl.land = {
            shooterOrd: s.ord, victimOrd: victim.ord, weaponIdx: e.slotOrd,
            volley, flightIdx: flights.length,
          };
          flights.push(fl);
          pushMissileLand(fl, t);
        } else {
          push({
            t, phase: PHASE.LAND, shipOrd: s.ord, slotOrd: e.slotOrd,
            kind: 'land',
            data: {
              shooterOrd: s.ord,
              victimOrd: victim.ord,
              weaponIdx: e.slotOrd,
              volley,
              applicationAtLaunch: w.kind === 'missile'
                ? undefined : applicationOfNow(s, victim, w, t),
            },
          });
        }

        push({
          t: t + w.cycleSeconds + (w.reactivationSeconds ?? 0),
          phase: PHASE.FIRE, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'fire', gen: ws.gen,
        });
        break;
      }

      case 'land': {
        const d = e.data!;
        if (d.flightIdx !== undefined) {
          const fl = flights[d.flightIdx];
          if (!fl.live || (e.gen ?? 0) !== fl.gen) break; // superseded schedule
          fl.live = false;
        }
        const shooter = states[d.shooterOrd];
        const victim = states[d.victimOrd];
        if (!victim.alive) {
          log(t, 'wasted', shooter, victim.ship.name);
          break;
        }
        const w = shooter.ship.weapons[d.weaponIdx];
        // missiles: application from the victim's CURRENT signature and
        // speed (a painter landing mid-flight matters), through the
        // shooter's own guidance disruption
        let application: number;
        if (d.applicationAtLaunch !== undefined) {
          application = d.applicationAtLaunch;
        } else {
          const dw = disruptedWeapon(shooter, w);
          const vs = victimState(victim, t);
          application = missileDamageFactor(dw, vs.sig, Math.abs(vs.speed));
        }
        if (application <= 0) break;

        shieldNow(victim, t);

        let remainingScale = 1;
        for (let li = 0; li < victim.hp.length && remainingScale > 1e-12; li++) {
          if (victim.hp[li] <= 0) continue;
          const layer = victim.ship.layers[li];
          const scaled: Damage = {
            em: d.volley.em * application * remainingScale,
            thermal: d.volley.thermal * application * remainingScale,
            kinetic: d.volley.kinetic * application * remainingScale,
            explosive: d.volley.explosive * application * remainingScale,
          };
          // command-burst resistance buffs (shield 10 / armor 13) multiply
          // the layer's resonance — negative value = less damage through
          const resBuff = li === 0 ? buffMult(victim, 271, t)
            : li === 1 ? buffMult(victim, 267, t) : 1;
          // hardeners the capacitor cannot feed provide NOTHING — the layer
          // takes damage at the hardeners-dry resonance until they restart
          const reso = !victim.hardenersOn && victim.ship.hardeners
            ? victim.ship.hardeners.dryResonance[li] ?? layer.resonance
            : layer.resonance;
          const hit = afterResists(scaled, reso) * resBuff;
          if (hit <= 0) break;
          const take = Math.min(victim.hp[li], hit);
          victim.hp[li] -= take;
          shooter.dealt += take;
          remainingScale *= (hit - take) / hit;
        }

        // a NEW all-time hp low = the fight is still converging
        {
          const total = victim.hp.reduce((n, v) => n + v, 0);
          if (total < victim.minTotalHp - 1e-9) {
            victim.minTotalHp = total;
            markProgress(t);
          }
        }

        // damage is the ONLY thing that drops shield below the discipline
        // band — re-check held reps (and their boosters) right here
        if (victim.hp[victim.deathLayer] > 1e-9) discWake(victim, t);

        if (victim.hp[victim.deathLayer] <= 1e-9) {
          victim.alive = false;
          victim.diedAt = t;
          lastDeathT = t;
          timeline.push({
            t, kind: 'death', who: victim.ship.name, side: victim.ship.side,
            detail: `killed by ${shooter.ship.name}`,
          });
          // a dead ship projects nothing: drop its leases and re-evaluate
          // every prop/web state they touched
          const touched: ShipState[] = [];
          for (let i = leases.length - 1; i >= 0; i--) {
            if (leases[i].srcOrd === victim.ord) {
              const v = states[leases[i].victimOrd];
              if (v.alive) touched.push(v);
              leases.splice(i, 1);
            }
          }
          for (const v of touched) {
            refreshPropState(v, t);
            reMotion(v, t);
            push({ t, phase: PHASE.RETARGET, shipOrd: v.ord, slotOrd: 0, kind: 'paintCheck' });
          }
          for (const other of states) {
            if (other.alive && other.targetOrd === victim.ord) {
              push({ t, phase: PHASE.RETARGET, shipOrd: other.ord, slotOrd: 0, kind: 'retarget' });
            }
          }
          /**
           * ANCHOR DEATH (v0.98.2). A ship whose EXPLICIT behaviour anchor
           * (the "vs" picker - a logi orbiting its wingmate) just died must
           * NOT fall through to its kill target: that sent the logi flying
           * at the enemy. DECLARED: it re-anchors on its nearest living
           * ALLY, logged on the timeline; with no allies left the anchor
           * clears and the default (kill target) takes over - at that point
           * the ship IS alone and fighting. The next 1 Hz steer flies the
           * new anchor. Default-anchored ships already follow retargets.
           */
          for (const other of states) {
            if (!other.alive || other.anchorOrd !== victim.ord) continue;
            let nearest: ShipState | null = null;
            let bestD = Infinity;
            for (const ally of states) {
              if (!ally.alive || ally.ord === other.ord
                || ally.ship.side !== other.ship.side) continue;
              const dd = pairDistance(other, ally, t);
              if (dd < bestD) { bestD = dd; nearest = ally; }
            }
            other.anchorOrd = nearest?.ord ?? null;
            log(t, 'anchorLost', other,
              nearest ? `now flying ${nearest.ship.name}` : 'no allies left - flying the kill target');
          }
        }
        break;
      }

      // ------------------------------------------------------------------
      // PROJECTED MODULES
      // ------------------------------------------------------------------

      case 'projWake': {
        const ps = s.projs[e.slotOrd];
        if (!ps || !ps.sleeping) break;
        ps.sleeping = false;
        push({ t, phase: PHASE.PROJ_START, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'projStart' });
        break;
      }

      case 'projReloadDone': {
        if (!s.alive) break;
        const pm = s.ship.projected![e.slotOrd];
        if (pm.rep?.charges) {
          s.projs[e.slotOrd].chargesLeft = pm.rep.charges.count;
          push({ t, phase: PHASE.PROJ_START, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'projStart' });
        }
        break;
      }

      case 'projStart': {
        if (!s.alive) break;
        const pm = s.ship.projected![e.slotOrd];
        const ps = s.projs[e.slotOrd];

        // warp points do nothing in a sim with no warping
        if (pm.kind === 'point') break;

        // BURST JAMMER — untargeted AoE lock-break, one roll per enemy in
        // the bubble (no lock needed to fire: it is self-activated)
        if (pm.kind === 'burstJam') {
          if (!affordOrSleep(s, t, pm.capPerCycle, `proj${e.slotOrd}`, e.slotOrd, 'projWake',
            () => { ps.sleeping = true; })) break;
          spend(s, t, pm.capPerCycle);
          for (const enemy of states) {
            if (enemy.ship.side === s.ship.side || !enemy.alive) continue;
            const dist = pairDistance(s, enemy, t);
            // DRAW_EVEN_WHEN_CERTAIN: the roll happens even out of range so
            // geometry changes never shift the stream
            const u = rng.draw(ROLL.BURST_JAM, s.ord, e.slotOrd, enemy.ord);
            if (dist > pm.optimal) continue;
            const js = pm.jamStrength!;
            const sensor = enemy.ship.sensor;
            const strength = sensor?.attr === 211 ? js.grav
              : sensor?.attr === 209 ? js.ladar
                : sensor?.attr === 210 ? js.mag
                  : sensor?.attr === 208 ? js.radar
                    : Math.max(js.grav, js.ladar, js.mag, js.radar);
            const denom = (sensor?.strength ?? 0)
              * (sensor ? buffMult(enemy, sensor.attr, t) : 1)
              * resistGate(enemy, pm.resistAttr);
            const chance = denom > 0 ? Math.min(1, strength / denom) : 1;
            if (u < chance) {
              // a lock BREAK: everything drops, re-lock starts at once
              enemy.locks.clear();
              enemy.locking.clear();
              enemy.lockGen += 1;
              log(t, 'jammed', enemy, `lock break by ${s.ship.name}'s burst`);
              if (enemy.targetOrd !== null && states[enemy.targetOrd].alive) {
                beginLock(enemy, states[enemy.targetOrd], t);
              }
            }
          }
          push({
            t: t + pm.cycleSeconds, phase: PHASE.PROJ_START,
            shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'projStart',
          });
          break;
        }

        // pick the victim NOW: offense follows the kill target, assistance
        // the most-damaged friendly (LOGI_TARGET_MOST_DAMAGED)
        const assist = pm.kind === 'remoteShield' || pm.kind === 'remoteArmor'
          || pm.kind === 'remoteHull' || pm.kind === 'capTransfer';
        let victim: ShipState | null;
        if (assist) {
          victim = woundedFriend(s);
        } else {
          if (s.targetOrd === null || !states[s.targetOrd].alive) retarget(s, t);
          victim = s.targetOrd !== null ? states[s.targetOrd] : null;
        }
        if (!victim || !victim.alive) {
          // nothing to project at — idle this cycle without paying
          push({
            t: t + pm.cycleSeconds, phase: PHASE.PROJ_START,
            shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'projStart',
          });
          break;
        }

        // ancillary remote charges gate the cycle exactly like local reps
        if (pm.rep?.charges && ps.chargesLeft < pm.rep.charges.perCycle) {
          ps.spoolCycles = 0;
          log(t, 'reloadStart', s, `proj${e.slotOrd}`);
          push({
            t: t + pm.rep.charges.reloadSeconds, phase: PHASE.WAKE,
            shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'projReloadDone',
          });
          break;
        }

        // offensive projections need a lock exactly like guns do
        if (!assist && !isLocked(s, victim.ord)) {
          const done = beginLock(s, victim, t);
          push({
            t: done !== null ? Math.max(done, t + 1e-9) : t + 1,
            phase: PHASE.PROJ_START, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'projStart',
          });
          break;
        }

        // remote reps ride the same rep-cycle buffs, read on the SOURCE
        // (the buff targets the module owner's fitted modules)
        const projRepBuff = pm.rep
          ? 1 + shipBuffValue(s, pm.rep.layer === 'shield' ? 11 : 14, t) / 100 : 1;
        if (!affordOrSleep(s, t, pm.capPerCycle * projRepBuff, `proj${e.slotOrd}`, e.slotOrd, 'projWake',
          () => { ps.sleeping = true; })) {
          ps.spoolCycles = 0;
          break;
        }
        spend(s, t, pm.capPerCycle * projRepBuff);
        if (pm.rep?.charges) ps.chargesLeft -= pm.rep.charges.perCycle;

        const dist = pairDistance(s, victim, t);
        // Interdiction Maneuvers (21) stretches this ship's scram/point/web
        // reach — applied to the module's optimal at lease creation
        const tackleBuff = pm.kind === 'web' || pm.kind === 'scram'
          ? 1 + shipBuffValue(s, 21, t) / 100 : 1;
        // LEASE_STRENGTH_AT_CYCLE_START: falloff × victim resist, frozen now.
        // Buff 19 (Electronic Hardening) multiplies the damp/TD gates.
        const gateBuff = pm.resistAttr === 2112 || pm.resistAttr === 2113
          ? buffMult(victim, pm.resistAttr, t) : 1;
        const scale = projFalloffScale(dist, pm.optimal * tackleBuff, pm.falloff)
          * resistGate(victim, pm.resistAttr) * gateBuff;

        // THE ECM ROLL — one seeded draw per completed activation, after the
        // cap is paid (ROLL_AT_CYCLE_START_AFTER_PAYMENT), even when the
        // outcome is certain (DRAW_EVEN_WHEN_CERTAIN keeps streams stable).
        if (pm.kind === 'ecm') {
          const u = rng.draw(ROLL.ECM_JAM, s.ord, e.slotOrd);
          const js = pm.jamStrength!;
          const sensor = victim.ship.sensor;
          // pair the jammer's strength attr to the victim's sensor type
          const strength = sensor?.attr === 211 ? js.grav
            : sensor?.attr === 209 ? js.ladar
              : sensor?.attr === 210 ? js.mag
                : sensor?.attr === 208 ? js.radar
                  : Math.max(js.grav, js.ladar, js.mag, js.radar);
          const denom = (sensor?.strength ?? 0) * (sensor ? buffMult(victim, sensor.attr, t) : 1);
          const chance = denom > 0 ? Math.min(1, (strength * scale) / denom) : (scale > 0 ? 1 : 0);
          if (u < chance && victim.alive) {
            // A JAM LANDS: every lock except toward the jammer drops, every
            // lock-in-progress dies, and nothing re-locks until it ends
            const until = t + (pm.jamSeconds ?? pm.cycleSeconds);
            victim.jammedUntil = Math.max(victim.jammedUntil, until);
            victim.jammerOrd = s.ord;
            for (const l of [...victim.locks]) if (l !== s.ord) victim.locks.delete(l);
            victim.locking.clear();
            victim.lockGen += 1;
            log(t, 'jammed', victim, `${Math.round(chance * 100)}% by ${s.ship.name}`);
            push({ t: until, phase: PHASE.WAKE, shipOrd: victim.ord, slotOrd: 0, kind: 'jamEnd' });
          }
          // jam or miss, the module cycles on: schedule and stop here — ECM
          // has no lease rows to push
          push({
            t: t + pm.cycleSeconds, phase: PHASE.PROJ_START,
            shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'projStart',
          });
          break;
        }

        if (pm.rep) {
          // remote repair rides the repair timing so alpha beats heals
          const spoolMult = pm.rep.spool
            ? 1 + Math.min(ps.spoolCycles * pm.rep.spool.perCycle, pm.rep.spool.max)
            : 1;
          if (pm.rep.spool) ps.spoolCycles += 1;
          const amount = pm.rep.amount * spoolMult;
          if (pm.rep.timing === 'start') {
            const gained = healLayerOn(victim, 0, amount * scale, t);
            if (gained > 0) { s.heals += gained; log(t, 'repped', s, victim.ship.name); }
          } else {
            ps.pendingHeal = { victimOrd: victim.ord, amount };
          }
        } else if (pm.kind !== 'neut' && pm.kind !== 'nos' && pm.kind !== 'capTransfer') {
          // EWAR lease — OUT_OF_RANGE_CYCLES_ANYWAY: scale 0 projects nothing
          // but the cap is already paid
          leases.push({
            srcOrd: s.ord,
            slotOrd: e.slotOrd,
            kind: pm.kind,
            victimOrd: victim.ord,
            rows: (pm.rows ?? []).map((r) => ({
              modifies: r.modifies,
              value: r.value * scale,
              stackable: r.stackable,
            })),
            blockStrength: pm.kind === 'scram' && scale > 0 ? (pm.blockStrength ?? 0) : 0,
            expiresAt: t + pm.cycleSeconds,
          });
          if (pm.kind === 'scram') refreshPropState(victim, t);
          if (pm.kind === 'web') reMotion(victim, t);
          // PAINT IS VISIBLE (v0.95.0): log the TRANSITION onto the victim,
          // not every 5 s cycle - same lazy-transition pattern as scram
          if (pm.kind === 'painter' && scale > 0 && !victim.painted) {
            victim.painted = true;
            log(t, 'painted', victim, `by ${s.ship.name}`);
          }
        }

        const projCycle = pm.cycleSeconds * projRepBuff;
        push({
          t: t + projCycle, phase: PHASE.PROJ_END,
          shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'projEnd',
          data: {
            shooterOrd: s.ord, victimOrd: victim.ord, weaponIdx: e.slotOrd,
            volley: { em: 0, thermal: 0, kinetic: 0, explosive: 0 },
          },
        });
        push({
          t: t + projCycle, phase: PHASE.PROJ_START,
          shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'projStart',
        });
        break;
      }

      case 'projEnd': {
        const pm = s.ship.projected![e.slotOrd];
        const ps = s.projs[e.slotOrd];
        const victim = states[e.data!.victimOrd];

        // drop this module's lease (death may have removed it already)
        let hadLease = false;
        for (let i = leases.length - 1; i >= 0; i--) {
          if (leases[i].srcOrd === s.ord && leases[i].slotOrd === e.slotOrd) {
            hadLease = true;
            leases.splice(i, 1);
          }
        }
        if (hadLease && victim.alive && pm.kind === 'painter') {
          // DEFERRED past the same-t projStart: a refreshing painter never
          // observably released (the scram-flicker lesson, reapplied)
          push({ t, phase: PHASE.RETARGET, shipOrd: victim.ord, slotOrd: 0, kind: 'paintCheck' });
        }
        if (hadLease && victim.alive && (pm.kind === 'scram' || pm.kind === 'web')) {
          // DEFERRED past the same-t projStart (phase 3): if the module
          // refreshes its lease this instant, the state never observably
          // changed and no release is logged — the design's lazy-read rule.
          // A real release (starved, reloading, retargeted, dead) is caught
          // by the check at phase 8, after every same-t re-add has run.
          push({ t, phase: PHASE.RETARGET, shipOrd: victim.ord, slotOrd: 0, kind: 'projCheck' });
        }

        // delta kinds land at cycle END with the geometry of THIS instant
        // (NEUT_DRAIN_AT_CYCLE_END — the stated asymmetry with leases)
        if (s.alive && victim.alive && (pm.kind === 'neut' || pm.kind === 'nos')) {
          const dist = pairDistance(s, victim, t);
          const scale = projFalloffScale(dist, pm.optimal, pm.falloff)
            * resistGate(victim, pm.resistAttr);
          const raw = (pm.drainGj ?? 0) * scale;
          if (raw > 0) {
            let allowed = true;
            if (pm.kind === 'nos' && !s.ship.nosOverride) {
              // NOS_GATE_CAP_FRACTION at the drain instant
              const vFrac = victim.ship.capacitor.capacity > 0
                ? capNow(victim, t) / victim.ship.capacitor.capacity : 0;
              const sFrac = s.ship.capacitor.capacity > 0
                ? capNow(s, t) / s.ship.capacitor.capacity : 0;
              allowed = vFrac > sFrac;
            }
            if (allowed) {
              capNow(victim, t);
              const drained = Math.min(victim.cap, raw);
              victim.cap -= drained;
              const frac = victim.ship.capacitor.capacity > 0
                ? victim.cap / victim.ship.capacitor.capacity : 0;
              if (frac < victim.capMin) victim.capMin = frac;
              if (pm.kind === 'nos') creditCap(s, t, drained);
              // ATTRIBUTED TO THE ACTOR (v0.115.2, owner's rule): strip icons
              // are actions a ship DID — the neut belongs to the neuting
              // ship's row, with the victim named in the detail. This also
              // keeps 20 neuting Sentinels from drowning their victim's row.
              else if (drained > 0) {
                log(t, 'neuted', s, `${Math.round(drained)} GJ from ${victim.ship.name}`);
              }
              // a drain opening cap headroom is exactly when a disciplined
              // pilot cracks a stick — held boosters re-check right here
              if (drained > 0) discWake(victim, t);
            }
          }
        }
        if (s.alive && victim.alive && pm.kind === 'capTransfer') {
          const dist = pairDistance(s, victim, t);
          const scale = projFalloffScale(dist, pm.optimal, pm.falloff)
            * resistGate(victim, pm.resistAttr);
          creditCap(victim, t, (pm.transferGj ?? 0) * scale);
        }

        // an end-timing remote heal lands only if the SOURCE survived its
        // whole cycle — a dead logistics ship delivers nothing
        if (pm.rep && pm.rep.timing === 'end' && ps.pendingHeal) {
          const ally = states[ps.pendingHeal.victimOrd];
          if (s.alive && ally.alive) {
            const dist = pairDistance(s, ally, t);
            const scale = projFalloffScale(dist, pm.optimal, pm.falloff)
              * resistGate(ally, pm.resistAttr);
            const li = pm.rep.layer === 'armor' ? 1 : 2;
            const gained = healLayerOn(ally, li, ps.pendingHeal.amount * scale, t);
            if (gained > 0) { s.heals += gained; log(t, 'repped', s, ally.ship.name); }
          } else if (!ally.alive) {
            log(t, 'wasted', s, ally.ship.name);
          }
          ps.pendingHeal = null;
        }
        break;
      }

      // ------------------------------------------------------------------
      // LOCAL REPAIR / RELOADS / BOOSTERS
      // ------------------------------------------------------------------

      case 'repWake': {
        const rs = s.reps[e.slotOrd];
        if (!rs || !rs.sleeping) break;
        rs.sleeping = false;
        push({ t, phase: PHASE.REP_START, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'repStart' });
        break;
      }

      case 'repStart': {
        if (!s.alive) break;
        const r = s.ship.repairs[e.slotOrd];
        const rs = s.reps[e.slotOrd];
        if (r.charges && rs.chargesLeft < r.charges.perCycle) {
          // an ASB reloads from the SHARED cap-stick pool — when the pool
          // cannot fill even one cycle, the booster is DRY for the fight
          // (AAR paste is its own unlimited pool, exactly as before)
          if (r.kind === 'shield'
            && Math.min(r.charges.count, s.boostReserve) < r.charges.perCycle) {
            break;
          }
          log(t, 'reloadStart', s, `rep${e.slotOrd}`);
          push({
            t: t + r.charges.reloadSeconds, phase: PHASE.WAKE,
            shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'repReloadDone',
          });
          break;
        }
        // the discipline holds the cycle BEFORE any cap is considered —
        // a held rep costs nothing and revives on the next damage/spend
        if (s.ship.injectDiscipline && !discRepAllowed(s, r, t)) {
          rs.discHeld = true;
          break;
        }
        // Active Shielding (11) / Rapid Repair (14) shorten the cycle AND
        // the cap cost of this ship's repairers (14 covers armour and hull —
        // both require Repair Systems, measured)
        const repBuff = 1 + shipBuffValue(s, r.kind === 'shield' ? 11 : 14, t) / 100;
        const capCost = r.capPerCycle * repBuff;
        // CYCLE-SYNCED INJECTION — the rep's own cycle is the trigger: pull
        // a stick if paying would dip the cap below the 25% reserve (see
        // jitPull). Idle injected GJ is neut food (EVE Uni: injected cap
        // "may be sucked away as soon as it lands").
        if (s.ship.injectDiscipline
          && capNow(s, t) < capCost + DISC_CAP_STICK_FRAC * s.ship.capacitor.capacity) {
          jitPull(s, t, capCost);
        }
        if (!affordOrSleep(s, t, capCost, `rep${e.slotOrd}`, e.slotOrd, 'repWake',
          () => { rs.sleeping = true; })) break;
        spend(s, t, capCost);
        if (r.charges) rs.chargesLeft -= r.charges.perCycle;

        if (r.timing === 'start') healLayer(s, r, t);
        else rs.pendingHeal = r.amount;

        push({
          t: t + r.cycleSeconds * repBuff, phase: PHASE.REP_END,
          shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'repEnd',
        });
        break;
      }

      case 'repEnd': {
        if (!s.alive) break;
        const r = s.ship.repairs[e.slotOrd];
        const rs = s.reps[e.slotOrd];
        if (r.timing === 'end' && rs.pendingHeal > 0) {
          healLayer(s, r, t);
          rs.pendingHeal = 0;
        }
        push({ t, phase: PHASE.REP_START, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'repStart' });
        break;
      }

      case 'gunReloadDone': {
        if (!s.alive) break;
        const w = s.ship.weapons[e.slotOrd];
        if (w?.clip) {
          s.weapons[e.slotOrd].clipLeft = w.clip.size;
          push({ t, phase: PHASE.FIRE, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'fire', gen: s.weapons[e.slotOrd].gen });
        }
        break;
      }

      case 'repReloadDone': {
        if (!s.alive) break;
        const r = s.ship.repairs[e.slotOrd];
        if (r?.charges) {
          let take = r.charges.count;
          if (r.kind === 'shield') {
            // deduct from the shared pool at COMPLETION — the injector's
            // own reload may have eaten it meanwhile; completion order
            // arbitrates who gets the last sticks (declared rule)
            take = Math.min(r.charges.count, s.boostReserve);
            if (take < r.charges.perCycle) break; // went dry while reloading
            s.boostReserve -= take;
            if (Number.isFinite(s.boostReserve)) markProgress(t); // sticks thinning
          }
          s.reps[e.slotOrd].chargesLeft = take;
          push({ t, phase: PHASE.REP_START, shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'repStart' });
        }
        break;
      }

      case 'boostStart': {
        if (!s.alive) break;
        const b = s.ship.capBoosters![e.slotOrd];
        const bs = s.boosts[e.slotOrd];
        if (bs.chargesLeft < b.charges.perCycle) {
          const take = Math.min(b.charges.count, s.boostReserve);
          if (take < b.charges.perCycle) break; // DRY: the carried pool is spent
          s.boostReserve -= take;
          if (Number.isFinite(s.boostReserve)) markProgress(t); // sticks thinning = converging
          bs.chargesLeft = take;
          push({
            t: t + b.charges.reloadSeconds, phase: PHASE.WAKE,
            shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'boostStart',
          });
          break;
        }
        // the discipline holds the stick until the cap sits at/below the
        // recharge peak AND can swallow ALL of it (reloads above still
        // proceed — reloading while held is free time). A held stick can
        // still be PULLED early by a rep that cannot pay (JIT, repStart).
        if (s.ship.injectDiscipline && !discBoostAllowed(s, b, t)) {
          bs.discHeld = true;
          break;
        }
        fireBoost(s, e.slotOrd, t);
        break;
      }

      // ------------------------------------------------------------------
      // ACTIVE RESIST HARDENERS (v0.114.0) — resists are only as alive as
      // the capacitor feeding them. One aggregate cycle bills the fit's
      // hardener drain; a cycle the cap cannot pay COLLAPSES the resist
      // profile to the hardeners-dry resonance until energy returns. Both
      // transitions are timeline entries — a resist collapse decides
      // fights and must never happen silently.
      // ------------------------------------------------------------------

      case 'hardWake': {
        if (!s.alive || !s.hardSleeping) break;
        s.hardSleeping = false;
        push({ t, phase: PHASE.WAKE, shipOrd: s.ord, slotOrd: 0, kind: 'hardStart' });
        break;
      }

      case 'hardStart': {
        if (!s.alive || !s.ship.hardeners) break;
        const h = s.ship.hardeners;
        // the tank's FIRST claim on a held stick — hardeners before reps,
        // which same-t phase order already grants (WAKE before REP_START);
        // cycle-synced: pull when paying would dip below the 25% reserve
        if (s.ship.injectDiscipline
          && capNow(s, t) < h.capPerCycle + DISC_CAP_STICK_FRAC * s.ship.capacitor.capacity) {
          jitPull(s, t, h.capPerCycle);
        }
        if (!affordOrSleep(s, t, h.capPerCycle, 'hardeners', 0, 'hardWake', () => {
          s.hardSleeping = true;
          if (s.hardenersOn) {
            s.hardenersOn = false;
            log(t, 'hardenersDown', s, 'capacitor cannot feed the hardeners — resists COLLAPSED');
          }
        })) break;
        spend(s, t, h.capPerCycle);
        if (!s.hardenersOn) {
          s.hardenersOn = true;
          log(t, 'hardenersUp', s, 'hardeners cycling again — resists restored');
        }
        push({
          t: t + h.cycleSeconds, phase: PHASE.WAKE,
          shipOrd: s.ord, slotOrd: 0, kind: 'hardStart',
        });
        break;
      }

      case 'lockDone': {
        if (!s.alive) break;
        if (e.gen !== undefined && e.gen !== s.lockGen) break; // jam killed it
        const victimOrd = e.slotOrd;
        if (!s.locking.has(victimOrd)) break;
        s.locking.delete(victimOrd);
        if (!states[victimOrd].alive) break;
        s.locks.add(victimOrd);
        break;
      }

      case 'jamEnd': {
        if (!s.alive) break;
        if (t < s.jammedUntil - 1e-9) break; // a later jam superseded this one
        s.jammerOrd = null;
        log(t, 'jamEnded', s);
        // re-acquire the current target at full lock time
        if (s.targetOrd !== null && states[s.targetOrd].alive
          && !s.locks.has(s.targetOrd)) {
          const done = beginLock(s, states[s.targetOrd], t);
          if (done !== null) log(t, 'locking', s, `${Math.round((done - t) * 10) / 10}s`);
        }
        break;
      }

      case 'burstStart': {
        if (!s.alive) break;
        const b = s.ship.bursts![e.slotOrd];
        const bs = s.burstStates[e.slotOrd];
        if (b.charges && bs.chargesLeft < b.charges.perCycle) {
          bs.chargesLeft = b.charges.count;
          push({
            t: t + b.charges.reloadSeconds, phase: PHASE.WAKE,
            shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'burstStart',
          });
          break;
        }
        if (b.charges) bs.chargesLeft -= b.charges.perCycle;
        spend(s, t, b.capPerCycle);
        for (const ally of states) {
          if (ally.ship.side !== s.ship.side || !ally.alive) continue;
          for (const buff of b.buffs) {
            ally.buffLeases.push({ buffId: buff.buffId, value: buff.value, expiresAt: t + b.buffSeconds });
          }
        }
        log(t, 'boosted', s);
        push({
          t: t + b.cycleSeconds, phase: PHASE.WAKE,
          shipOrd: s.ord, slotOrd: e.slotOrd, kind: 'burstStart',
        });
        break;
      }

      case 'projCheck': {
        // s here is the VICTIM whose lease set may have changed this instant
        if (!s.alive) break;
        refreshPropState(s, t);
        reMotion(s, t);
        break;
      }

      case 'paintCheck': {
        if (!s.alive || !s.painted) break;
        const still = leases.some((l) => l.victimOrd === s.ord && l.kind === 'painter'
          && l.rows.some((r) => r.value !== 0));
        if (!still) {
          s.painted = false;
          log(t, 'paintEnded', s);
        }
        break;
      }

      case 'retarget': {
        if (!s.alive) break;
        retarget(s, t);
        break;
      }
    }
  }

  sample(Math.min(t, horizon));
  const aUp = sideAlive('a');
  const bUp = sideAlive('b');
  const decided = aUp !== bUp || (!aUp && !bUp);

  return {
    seed: opts.seed ?? 0,
    drawCount: rng.drawCount,
    seconds: decided ? lastDeathT : null,
    winner: aUp !== bUp ? (aUp ? 'a' : 'b') : null,
    elapsed: Math.min(t, horizon),
    events: timeline,
    ships: states.map((s) => ({
      id: s.ship.id,
      name: s.ship.name,
      side: s.ship.side,
      alive: s.alive,
      diedAt: s.diedAt,
      remaining: s.hp.map((hp, i) => (s.ship.layers[i].hp > 0 ? hp / s.ship.layers[i].hp : 0)),
      damageDealt: s.dealt,
      volleysFired: s.volleys,
      healsApplied: s.heals,
      capMinFrac: s.capMin,
    })),
    series,
  };
}
