// RECOVERING WHICH GUN THE AMMO WAS IN.
//
// EVE's own fitting service does not store the pairing. A saved fitting read
// back from /characters/{id}/fittings/ lists the launchers under HiSlot0…n and
// the ammo as a loose Cargo row; an assembled ship read from assets lists the
// charge under the SAME slot flag as its module, which is no better. Either
// way the module↔charge link is gone by the time it reaches us.
//
// That link is not cosmetic. A turret or launcher has NO damage attributes of
// its own — 114/116/117/118 live on the charge — so the dogma engine scores an
// unloaded weapon at exactly zero. Every fit in the Fit Library was therefore
// showing its guns as contributing nothing: a Raven with six cruise launchers
// reported drone damage only. (Measured, not assumed — fixtures A5/B1.)
//
// The pairing IS recoverable, because dogma says which charge groups a module
// accepts. Where that answer is forced we use it; where it is genuinely
// ambiguous we load NOTHING and say so, because a guessed loadout would put a
// made-up number in front of someone who trades on these (RULES #1, #3).
import { canLoad, chargeGroupsOf, type DogmaLookup } from './fitCharges';
import { isSlotFlag, type RawFitItem } from './fitSerial';

export interface ChargePairing {
  /** the item list with charges folded into the modules that hold them.
   * Charges that could not be placed are left exactly as they were. */
  items: RawFitItem[];
  /** what was inferred, so the UI can say the pairing was worked out rather
   * than read from the fit */
  inferred: { moduleTypeId: number; chargeTypeId: number; count: number }[];
  /** charges deliberately NOT placed, and why — shown, never swallowed */
  ambiguous: { chargeTypeId: number; reason: string }[];
}

const qtyOf = (it: RawFitItem): number => Math.max(1, it.quantity);

/**
 * Fold loose charges into the modules that hold them.
 *
 * A charge is placed only when the answer is FORCED:
 *   · exactly one fitted module type can load it, and
 *   · no other loose charge competes for that same module type.
 * Anything else is reported in `ambiguous` and left as cargo. Two ammo types
 * for one rack of launchers is the common real case — the fit genuinely does
 * not record which was loaded, so neither do we.
 */
export function pairCharges(items: RawFitItem[], data: DogmaLookup): ChargePairing {
  // A module, for this purpose, is a SLOTTED item that declares charge groups.
  // The flag alone is not enough: assets file a loaded charge under its
  // module's own slot flag, so "has a slot flag" would sweep the ammo in too.
  const isWeapon = (it: RawFitItem) =>
    isSlotFlag(it.flag) && chargeGroupsOf(data, it.type_id).length > 0;

  const weaponTypes = [...new Set(items.filter(isWeapon).map((i) => i.type_id))];
  if (weaponTypes.length === 0) return { items, inferred: [], ambiguous: [] };

  // everything that is not one of those modules is candidate ammo, wherever
  // it happens to be filed
  const stockRows = items.filter((it) => !isWeapon(it) && it.chargeTypeId === undefined);

  const candidates = new Map<number, number[]>(); // charge type → module types
  for (const it of stockRows) {
    if (candidates.has(it.type_id)) continue;
    const fits = weaponTypes.filter((m) => canLoad(data, m, it.type_id));
    if (fits.length > 0) candidates.set(it.type_id, fits);
  }
  if (candidates.size === 0) return { items, inferred: [], ambiguous: [] };

  const wantedBy = new Map<number, number[]>(); // module type → charge types
  for (const [chargeId, mods] of candidates) {
    for (const m of mods) wantedBy.set(m, [...(wantedBy.get(m) ?? []), chargeId]);
  }

  const ambiguous: ChargePairing['ambiguous'] = [];
  const assign = new Map<number, number>(); // module type → charge type
  for (const [chargeId, mods] of candidates) {
    if (mods.length > 1) {
      ambiguous.push({ chargeTypeId: chargeId, reason: `${mods.length} fitted modules can load it` });
      continue;
    }
    const rivals = wantedBy.get(mods[0]) ?? [];
    if (rivals.length > 1) {
      ambiguous.push({
        chargeTypeId: chargeId,
        reason: `${rivals.length} ammo types compete for the same module — the fit does not record which was loaded`,
      });
      continue;
    }
    assign.set(mods[0], chargeId);
  }
  if (assign.size === 0) return { items, inferred: [], ambiguous };

  // how much of each assigned charge exists anywhere in the fit
  const stock = new Map<number, number>();
  for (const it of stockRows) {
    if (![...assign.values()].includes(it.type_id)) continue;
    stock.set(it.type_id, (stock.get(it.type_id) ?? 0) + qtyOf(it));
  }

  // load the slots in the order they appear, while stock lasts
  const placed = new Map<number, number>();
  const loaded: RawFitItem[] = [];
  for (const it of items) {
    const chargeId = isWeapon(it) ? assign.get(it.type_id) : undefined;
    if (chargeId === undefined || it.chargeTypeId !== undefined) {
      loaded.push(it); // already-known pairings are authoritative
      continue;
    }
    const left = (stock.get(chargeId) ?? 0) - (placed.get(chargeId) ?? 0);
    const take = Math.min(left, qtyOf(it));
    if (take <= 0) {
      loaded.push(it);
      continue;
    }
    placed.set(chargeId, (placed.get(chargeId) ?? 0) + take);
    if (take === qtyOf(it)) {
      loaded.push({ ...it, chargeTypeId: chargeId });
    } else {
      // a merged stack only partly supplied: split it, so the loaded copies
      // and the empty ones are each represented honestly
      loaded.push({ ...it, quantity: take, chargeTypeId: chargeId });
      loaded.push({ ...it, quantity: qtyOf(it) - take });
    }
  }

  // ammo consumed by the guns is no longer cargo — leaving it would report it
  // a second time as "not part of the flown fit". Drawn down row by row, so a
  // charge split across several rows is debited once in total.
  const owed = new Map(placed);
  const out: RawFitItem[] = [];
  for (const it of loaded) {
    if (isWeapon(it) || it.chargeTypeId !== undefined) {
      out.push(it);
      continue;
    }
    const debt = owed.get(it.type_id);
    if (debt === undefined || debt <= 0) {
      out.push(it);
      continue;
    }
    const take = Math.min(debt, qtyOf(it));
    owed.set(it.type_id, debt - take);
    const left = qtyOf(it) - take;
    if (left > 0) out.push({ ...it, quantity: left });
  }

  const inferred = [...assign.entries()]
    .map(([moduleTypeId, chargeTypeId]) => ({
      moduleTypeId, chargeTypeId, count: placed.get(chargeTypeId) ?? 0,
    }))
    .filter((r) => r.count > 0);

  return { items: out, inferred, ambiguous };
}
