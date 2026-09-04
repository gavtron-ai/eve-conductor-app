// VARIANT PARENTS — the SDE's invMetaTypes table (child typeID → parent
// typeID), the graph the in-game Variations tab draws from: every meta/T2/
// faction/officer variant points at its plain T1 base (250mm Railgun II →
// 250mm Railgun I). Market-leaf siblings are NOT it — the leaf mixes 200mm
// and 250mm lines (31 "variants" where the game shows 9, v0.177).
//
// Fetched once from fuzzwork's CSV mirror (CORS-open, probed v0.153) and
// cached in localStorage — the full table, ~14k pairs, a few hundred KB.

const KEY = 'etc-variant-parents-v2';
let mem: Record<number, number> | null = null;

export async function loadVariantParents(): Promise<Record<number, number>> {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const m = JSON.parse(raw) as Record<number, number>;
      if (m && Object.keys(m).length > 1000) {
        mem = m;
        return m;
      }
    }
  } catch { /* refetch */ }
  const res = await fetch('https://www.fuzzwork.co.uk/dump/latest/csv/invMetaTypes.csv');
  if (!res.ok) throw new Error(String(res.status));
  const text = await res.text();
  const out: Record<number, number> = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const cells = line.replace(/^﻿/, '').split(',').map((c) => c.replace(/^"|"$/g, ''));
    const child = Number(cells[0]);
    const parent = Number(cells[1]);
    if (!Number.isFinite(child) || !Number.isFinite(parent) || !parent) continue;
    out[child] = parent;
  }
  if (Object.keys(out).length > 1000) {
    mem = out;
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* cache only */ }
  }
  return out;
}

/** walk to the family's base type (chains are short; bounded anyway) */
export function baseVariantOf(parents: Record<number, number>, typeId: number): number {
  let cur = typeId;
  for (let hops = 0; hops < 6; hops++) {
    const p = parents[cur];
    if (p === undefined) return cur;
    cur = p;
  }
  return cur;
}
