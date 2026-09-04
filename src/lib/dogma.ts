// Cargo-relevant dogma lookups for fitted modules, cached in localStorage.
// attr 149 = cargo capacity multiplier (Expanded Cargoholds)
// attr 614 = cargo capacity bonus % (Cargohold Optimization rigs)
import { ESI_BASE } from './constants';
import { esiFetch } from './esiRate';

export interface CargoModAttrs {
  mult?: number;
  rigPct?: number;
}

const CACHE_KEY = 'etc-dogma-cargo-v1';

function loadCache(): Record<number, CargoModAttrs> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

const cache: Record<number, CargoModAttrs> = loadCache();

/** Fetch (and cache forever — dogma is static) cargo attrs for module types. */
export async function cargoModAttrs(typeIds: number[]): Promise<Record<number, CargoModAttrs>> {
  const unique = [...new Set(typeIds)];
  const missing = unique.filter((id) => cache[id] === undefined);
  const CONCURRENCY = 8;
  const queue = [...missing];
  async function worker() {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        const res = await esiFetch(`${ESI_BASE}/universe/types/${id}/`);
        if (!res.ok) throw new Error(String(res.status));
        const j: { dogma_attributes?: { attribute_id: number; value: number }[] } =
          await res.json();
        const entry: CargoModAttrs = {};
        for (const a of j.dogma_attributes ?? []) {
          if (a.attribute_id === 149 && a.value > 1) entry.mult = a.value;
          if (a.attribute_id === 614 && a.value > 0) entry.rigPct = a.value;
        }
        cache[id] = entry;
      } catch {
        cache[id] = {}; // don't retry forever on flaky types
      }
    }
  }
  if (missing.length) {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, worker));
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    } catch {
      // cache is an optimization only
    }
  }
  return cache;
}
