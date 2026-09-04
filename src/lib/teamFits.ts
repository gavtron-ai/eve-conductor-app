// TEAM FIT CATALOG — every fit the team can analyze, from two live sources:
//   · SAVED fits: ESI /characters/{id}/fittings/ (scope already requested)
//   · OWNED fits: assembled ships in the character's assets, reconstructed
//     with the modules/drones/charges actually inside them + the ship's name
// HONEST LIMIT: corporation saved fittings have NO ESI endpoint — nothing in
// the API exposes them, so the UI shows the option disabled rather than
// pretending. Exact duplicates (same hull + identical contents) are merged,
// keeping every [character, kind] provenance.
//
// Each fit is serialized to EFT text and fed through the SAME parse pipeline
// as a manual paste — one code path, one set of integrity gates.
import { esiAuth } from './esiChar';
import { useAuth } from './auth';
import { getType } from './typedb';
import { toEft, contentKey, typeNameOf, isSlotFlag, isBayFlag, type RawFitItem } from './fitSerial';
import { pairCharges } from './chargeMatch';
import { getEsfData } from './dogmaStats';
import type { DogmaLookup } from './fitCharges';

/**
 * PUT THE AMMO BACK IN THE GUNS before serializing.
 *
 * Neither ESI source records which gun held which charge — a saved fitting
 * files the ammo under Cargo, an assembled ship files it under its module's
 * own slot flag. A turret or launcher carries no damage attributes of its own,
 * so an unpaired weapon scores exactly ZERO in the dogma engine, and these
 * fits feed the Fit Skill Maxer's picker (CharacterConductor sets fitText from
 * `eft`). Every fit in that dropdown was reporting drone damage only.
 *
 * pairCharges places a charge only where dogma leaves one possible answer and
 * reports the rest, so nothing here is guessed.
 */
const pairedEft = (
  hullName: string, fitName: string, items: RawFitItem[], data: DogmaLookup | null,
): string => toEft(hullName, fitName, data ? pairCharges(items, data).items : items);

/** the dogma bundle, or null if it will not load — a catalog that still lists
 * every fit unpaired is far better than one that fails to build at all */
async function chargeData(): Promise<DogmaLookup | null> {
  try {
    return (await getEsfData()) as unknown as DogmaLookup;
  } catch {
    return null;
  }
}

export interface FitSource {
  charId: number;
  charName: string;
  kind: 'saved' | 'owned';
  /** what THIS source calls the fit — merged duplicates keep every name so
   * the dropdown can show the name that exists where the filter points */
  fitName: string;
}

export interface TeamFit {
  /** content-identity key: hull + sorted items — the dedupe basis */
  key: string;
  shipTypeId: number;
  hullName: string;
  fitName: string;
  eft: string;
  sources: FitSource[];
}

export interface TeamFitCatalog {
  fits: TeamFit[];
  /** per-character fetch problems, stated plainly (scope, session, ESI) */
  errors: string[];
  fetchedAt: number;
}

const typeName = typeNameOf;

// ---- sources ----

interface EsiFitting {
  fitting_id: number;
  name: string;
  ship_type_id: number;
  items: { type_id: number; quantity: number; flag: string }[];
}

async function savedFitsOf(charId: number, charName: string, warn: (msg: string) => void, cd: DogmaLookup | null): Promise<TeamFit[]> {
  const { data } = await esiAuth<EsiFitting[]>(`/characters/${charId}/fittings/`, undefined, charId);
  return data.map((f) => {
    const hullName = typeName(f.ship_type_id);
    const invalid = f.items.filter((i) => i.flag === 'Invalid');
    if (invalid.length > 0) {
      warn(`${charName}: saved fit “${f.name}” has ${invalid.length} unfittable item(s) — skipped from the analysis`);
    }
    return {
      key: contentKey(f.ship_type_id, f.items),
      shipTypeId: f.ship_type_id,
      hullName,
      fitName: f.name,
      eft: pairedEft(hullName, f.name, f.items, cd),
      sources: [{ charId, charName, kind: 'saved' as const, fitName: f.name }],
    };
  });
}

interface AssetRow {
  item_id: number;
  type_id: number;
  location_id: number;
  location_flag: string;
  is_singleton: boolean;
  quantity: number;
}

async function ownedFitsOf(charId: number, charName: string, cd: DogmaLookup | null): Promise<TeamFit[]> {
  const first = await esiAuth<AssetRow[]>(`/characters/${charId}/assets/?page=1`, undefined, charId);
  const rows = [...first.data];
  for (let p = 2; p <= first.pages; p++) {
    rows.push(...(await esiAuth<AssetRow[]>(`/characters/${charId}/assets/?page=${p}`, undefined, charId)).data);
  }
  // assembled ships = singleton items whose type is a ship (typedb records
  // cargo capacity for ships only, which isShip keys on — but abyssal-less
  // hulls are always market types, so getType().cargo is reliable here)
  const ships = rows.filter((r) => r.is_singleton && getType(r.type_id)?.cargo !== undefined);
  const byLocation = new Map<number, AssetRow[]>();
  for (const r of rows) {
    (byLocation.get(r.location_id) ?? byLocation.set(r.location_id, []).get(r.location_id)!).push(r);
  }
  const fitted = ships
    .map((ship) => ({
      ship,
      contents: (byLocation.get(ship.item_id) ?? []).filter(
        (r) => isSlotFlag(r.location_flag) || isBayFlag(r.location_flag) || r.location_flag === 'Cargo',
      ),
    }))
    // a bare assembled hull with nothing in any slot is not a "fit"
    .filter((s) => s.contents.some((r) => isSlotFlag(r.location_flag)));
  // ship custom names (chunked; the endpoint takes up to 1000 ids)
  const names = new Map<number, string>();
  const ids = fitted.map((s) => s.ship.item_id);
  for (let i = 0; i < ids.length; i += 1000) {
    try {
      const { data } = await esiAuth<{ item_id: number; name: string }[]>(
        `/characters/${charId}/assets/names/`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids.slice(i, i + 1000)) },
        charId,
      );
      for (const n of data) if (n.name && n.name !== 'None') names.set(n.item_id, n.name);
    } catch {
      // names are cosmetic — the fit itself stays usable
    }
  }
  return fitted.map(({ ship, contents }) => {
    const hullName = typeName(ship.type_id);
    const fitName = names.get(ship.item_id) ?? '(unnamed)';
    const items: RawFitItem[] = contents.map((r) => ({ type_id: r.type_id, quantity: r.quantity, flag: r.location_flag }));
    return {
      key: contentKey(ship.type_id, items),
      shipTypeId: ship.type_id,
      hullName,
      fitName,
      eft: pairedEft(hullName, fitName, items, cd),
      sources: [{ charId, charName, kind: 'owned' as const, fitName }],
    };
  });
}

// ---- catalog (cached; the refresh button forces) ----

let cache: (TeamFitCatalog & { roster: string }) | null = null;
let inflight: Promise<TeamFitCatalog> | null = null;
const TTL_MS = 10 * 60_000;

/** the cache is only valid for the roster it was fetched for — a login or
 * logout must invalidate it, or ghosts linger for the whole TTL */
const rosterKey = () =>
  useAuth.getState().characters.map((c) => c.characterId).sort((a, b) => a - b).join(',');

export async function loadTeamFits(force = false): Promise<TeamFitCatalog> {
  if (!force && cache && cache.roster === rosterKey() && Date.now() - cache.fetchedAt < TTL_MS) {
    return cache;
  }
  if (inflight) return inflight;
  inflight = (async () => {
    const roster = rosterKey();
    const chars = useAuth.getState().characters;
    // loaded ONCE for the whole sweep — pairCharges needs dogma, and fetching
    // the bundle per character would re-read it a dozen times
    const cd = await chargeData();
    const merged = new Map<string, TeamFit>();
    const errors: string[] = [];
    const add = (fit: TeamFit) => {
      const existing = merged.get(fit.key);
      if (existing) {
        // exact duplicate — keep ONE fit, remember every place (and NAME) it lives under
        for (const s of fit.sources) {
          if (!existing.sources.some((x) => x.charId === s.charId && x.kind === s.kind)) {
            existing.sources.push(s);
          }
        }
      } else {
        merged.set(fit.key, fit);
      }
    };
    for (const c of chars) {
      const label = c.characterName;
      try {
        for (const f of await savedFitsOf(c.characterId, label, (m) => errors.push(m), cd)) add(f);
      } catch {
        errors.push(`${label}: saved fittings unavailable (session expired or scope missing — re-login in Settings)`);
      }
      try {
        for (const f of await ownedFitsOf(c.characterId, label, cd)) add(f);
      } catch {
        errors.push(`${label}: assets unavailable (session expired?) — owned fits missing`);
      }
    }
    const fits = [...merged.values()].sort(
      (a, b) => a.hullName.localeCompare(b.hullName) || a.fitName.localeCompare(b.fitName),
    );
    cache = { fits, errors, fetchedAt: Date.now(), roster };
    return cache;
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}
