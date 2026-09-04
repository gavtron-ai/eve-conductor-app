// Capital allocator core: turn scored opportunities into ONE buy plan.
// Greedy by defense-adjusted ISK/day per ISK invested, under a total budget,
// a per-item share cap (diversification) and an item-count cap (attention).
// Pure and deterministic — every output line traces to one input candidate.

export interface AllocCandidate {
  typeId: number;
  /** defense-adjusted expected ISK/day at full recommended quantity */
  adjPday: number;
  unitsPerTrip: number;
  buyPrice: number;
  /** 🌡 crowding rising — excluded when skipHeating */
  heating: boolean;
  /** team already holds / sells / bids this item — excluded when skipOwned */
  owned: boolean;
}

export interface AllocOptions {
  budget: number;
  maxItems: number;
  /** max fraction of the budget for any single item (0–1] */
  maxShare: number;
  skipHeating: boolean;
  skipOwned: boolean;
}

export interface AllocLine<T extends AllocCandidate> {
  c: T;
  units: number;
  cost: number;
  /** adjPday scaled to the allocated quantity */
  expPday: number;
}

export interface AllocResult<T extends AllocCandidate> {
  lines: AllocLine<T>[];
  skippedHeating: number;
  skippedOwned: number;
}

export function allocate<T extends AllocCandidate>(
  candidates: T[],
  opts: AllocOptions,
): AllocResult<T> {
  const lines: AllocLine<T>[] = [];
  let skippedHeating = 0;
  let skippedOwned = 0;
  if (opts.budget <= 0) return { lines, skippedHeating, skippedOwned };

  // one candidate per item — the best adjusted economics wins
  const best = new Map<number, T>();
  for (const c of candidates) {
    if (c.adjPday <= 0 || c.unitsPerTrip < 1 || c.buyPrice <= 0) continue;
    const cur = best.get(c.typeId);
    if (!cur || c.adjPday > cur.adjPday) best.set(c.typeId, c);
  }
  const pool = [...best.values()].filter((c) => {
    if (opts.skipHeating && c.heating) {
      skippedHeating++;
      return false;
    }
    if (opts.skipOwned && c.owned) {
      skippedOwned++;
      return false;
    }
    return true;
  });

  // efficiency: adjusted ISK/day earned per ISK tied up
  pool.sort(
    (a, b) => b.adjPday / (b.unitsPerTrip * b.buyPrice) - a.adjPday / (a.unitsPerTrip * a.buyPrice),
  );
  let remaining = opts.budget;
  const shareCap = opts.maxShare * opts.budget;
  for (const c of pool) {
    if (lines.length >= opts.maxItems || remaining <= 0) break;
    const cap = Math.min(remaining, shareCap);
    const units = Math.min(c.unitsPerTrip, Math.floor(cap / c.buyPrice));
    if (units < 1) continue;
    const cost = units * c.buyPrice;
    lines.push({ c, units, cost, expPday: c.adjPday * (units / c.unitsPerTrip) });
    remaining -= cost;
  }
  return { lines, skippedHeating, skippedOwned };
}
