import type { ItemType } from './types';
import raw from '../data/typedb.json';

// typedb.json: { cats: rootMarketGroupNames, items: rows }
// rows: [typeID, typeName, packagedVolume, catIdx] — ships extend to
// [id, name, vol, catIdx, cargoCap, groupID, raceID, baysObj]
type Bays = NonNullable<ItemType['bays']>;
const db = raw as {
  cats: string[];
  items: [number, string, number, number, number?, number?, number?, Bays?][];
};
export const categories: readonly string[] = db.cats;
const items: ItemType[] = db.items.map(([id, name, volume, catIdx, cargo, group, race, bays]) => ({
  id,
  name,
  volume,
  catIdx,
  ...(cargo !== undefined ? { cargo, group, race, bays } : {}),
}));

const byId = new Map(items.map((it) => [it.id, it]));
const byName = new Map(items.map((it) => [it.name.toLowerCase(), it]));

export function getType(id: number): ItemType | undefined {
  return byId.get(id);
}

/** exact case-insensitive name lookup */
export function findByName(name: string): ItemType | undefined {
  return byName.get(name.trim().toLowerCase());
}

/** true when the type is a ship (cargo capacity is recorded for ships only) */
export function isShip(id: number): boolean {
  return byId.get(id)?.cargo !== undefined;
}

/** root market-group name, e.g. "Ships", "Ammunition & Charges" */
export function categoryOf(id: number): string {
  const it = byId.get(id);
  return it ? (categories[it.catIdx] ?? 'Other') : 'Other';
}

/** every published market item — the Trade Finder's default scan universe */
export function allTypes(): readonly ItemType[] {
  return items;
}

/**
 * Case-insensitive substring search, ranked: exact match first, then
 * prefix matches, then word-prefix matches, then any substring —
 * shorter names win ties so "Hulk" beats "Hulk Blueprint".
 */
export function searchTypes(query: string, limit = 40): ItemType[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const scored: { it: ItemType; score: number }[] = [];
  for (const it of items) {
    const n = it.name.toLowerCase();
    const idx = n.indexOf(q);
    if (idx === -1) continue;
    let score: number;
    if (n === q) score = 0;
    else if (idx === 0) score = 1;
    else if (n[idx - 1] === ' ') score = 2;
    else score = 3;
    scored.push({ it, score: score * 1000 + it.name.length });
  }
  scored.sort((a, b) => a.score - b.score);
  return scored.slice(0, limit).map((s) => s.it);
}

export const typeCount = items.length;
