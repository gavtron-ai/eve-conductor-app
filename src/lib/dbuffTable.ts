// WHAT EACH COMMAND-BURST BUFF ID DOES — vendored, because the app's SDE
// bundle does NOT contain dbuffCollections. Source: Tranquility's live
// dbuffs.json (hoboleaks export), fetched 2026-08-10 and cross-checked
// against engine-measured buff ids on the module items (a Shield Harmonizing
// charge writes buff id 10 with value −15.0 unbonused all-V; measured chain
// −17.25 Vulture, −21.5625 with mindlink — digit-exact).
//
// Every entry is PostPercent on the RECIPIENT. aggregate says how competing
// leases of the SAME buff id combine: 'min' = most negative wins (buffs on
// lower-is-better attributes), 'max' = most positive wins. WINNER-TAKE-ALL:
// two boosters running the same charge do NOT add — the stronger simply
// wins, and buffs are never stacking-penalized against local modules
// (declared client rule, pyfa parity).
//
// A buff id NOT in this table (mining/expedition ids among them) must be
// SKIPPED WITH A SURFACED NOTE, never guessed and never a reason to refuse
// the whole fit.

export interface DbuffTarget {
  kind: 'ship' | 'moduleBySkill' | 'moduleByGroup';
  /** the attribute the buff multiplies */
  attrs: number[];
  /** moduleBySkill: modules requiring any of these skills */
  skills?: number[];
  /** moduleByGroup: modules in any of these SDE groups */
  groups?: number[];
}

export interface DbuffEntry {
  aggregate: 'min' | 'max';
  label: string;
  targets: DbuffTarget[];
  /** true when the sim actually APPLIES this buff; false = extracted,
   * displayed, and surfaced as not-yet-simulated (refuse to pretend) */
  simulated: boolean;
}

export const DBUFF_TABLE: Record<number, DbuffEntry> = {
  // ---- shield ----
  10: {
    aggregate: 'min', label: 'shield resistances',
    targets: [{ kind: 'ship', attrs: [271, 272, 273, 274] }], simulated: true,
  },
  11: {
    aggregate: 'min', label: 'shield booster duration & cap',
    targets: [{ kind: 'moduleBySkill', attrs: [73, 6], skills: [3416, 3422, 24571] }],
    simulated: true,
  },
  12: {
    aggregate: 'max', label: 'shield capacity',
    targets: [{ kind: 'ship', attrs: [263] }], simulated: true,
  },
  // ---- armor ----
  13: {
    aggregate: 'min', label: 'armor resistances',
    targets: [{ kind: 'ship', attrs: [267, 268, 269, 270] }], simulated: true,
  },
  14: {
    aggregate: 'min', label: 'armor repairer duration & cap',
    // 3393 Repair Systems is the required skill of HULL repairers too
    // (measured: Medium Hull Repairer II requiredSkill1 = 3393), so this
    // buff shortens armour AND hull rep cycles
    targets: [{ kind: 'moduleBySkill', attrs: [73, 6], skills: [3393, 16069, 24568] }],
    simulated: true,
  },
  15: {
    aggregate: 'max', label: 'armor HP',
    targets: [{ kind: 'ship', attrs: [265] }], simulated: true,
  },
  // ---- information ----
  16: {
    aggregate: 'max', label: 'scan resolution',
    targets: [{ kind: 'ship', attrs: [564] }], simulated: true,
  },
  17: {
    aggregate: 'max', label: 'EWAR range & strength',
    targets: [{ kind: 'moduleByGroup', attrs: [54, 2044], groups: [201, 208, 291, 379] }],
    simulated: false,
  },
  18: {
    aggregate: 'max', label: 'sensor strength',
    targets: [{ kind: 'ship', attrs: [208, 209, 210, 211] }], simulated: true,
  },
  19: {
    aggregate: 'min', label: 'damp & weapon-disruption resistance',
    targets: [{ kind: 'ship', attrs: [2112, 2113] }], simulated: true,
  },
  26: {
    aggregate: 'max', label: 'targeting range',
    targets: [{ kind: 'ship', attrs: [76] }], simulated: true,
  },
  // ---- skirmish ----
  20: {
    aggregate: 'min', label: 'signature radius',
    targets: [{ kind: 'ship', attrs: [552] }], simulated: true,
  },
  21: {
    aggregate: 'max', label: 'scram/point/web range',
    targets: [{ kind: 'moduleBySkill', attrs: [54], skills: [3435] }], simulated: true,
  },
  22: {
    aggregate: 'max', label: 'prop module speed boost',
    targets: [{ kind: 'moduleBySkill', attrs: [20], skills: [3450, 3454] }], simulated: true,
  },
  60: {
    aggregate: 'min', label: 'agility',
    targets: [{ kind: 'ship', attrs: [70] }], simulated: true,
  },
};

/** the ship-attribute buff multiplier for one recipient: winner-take-all per
 * buff id, then independent PostPercent factors across ids */
export function buffMultiplier(
  leases: { buffId: number; value: number }[], attr: number,
): number {
  let mult = 1;
  const byId = new Map<number, number>();
  for (const l of leases) {
    const entry = DBUFF_TABLE[l.buffId];
    if (!entry || !entry.simulated) continue;
    if (!entry.targets.some((t) => t.kind === 'ship' && t.attrs.includes(attr))) continue;
    const cur = byId.get(l.buffId);
    const wins = cur === undefined
      || (entry.aggregate === 'min' ? l.value < cur : l.value > cur);
    if (wins) byId.set(l.buffId, l.value);
  }
  for (const v of byId.values()) mult *= 1 + v / 100;
  return mult;
}

/** the WINNING value of one buff id across live leases (aggregate-aware),
 * for module-attribute buffs the ship-attr multiplier cannot express.
 * Returns 0 when the buff is absent. */
export function buffValue(
  leases: { buffId: number; value: number }[], buffId: number,
): number {
  const entry = DBUFF_TABLE[buffId];
  if (!entry || !entry.simulated) return 0;
  let win: number | undefined;
  for (const l of leases) {
    if (l.buffId !== buffId) continue;
    if (win === undefined || (entry.aggregate === 'min' ? l.value < win : l.value > win)) {
      win = l.value;
    }
  }
  return win ?? 0;
}
