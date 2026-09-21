// JITA SELL FOR EVERYTHING THE CHAIN TABLES CAN VALUE (lifted out of the Σ Summary in v0.207.0
// so the Home dashlets price the chain with the same numbers). One aggregate fetch; the result
// is shared for PRICE_TTL_MS, so a dashboard and the tab open together ask once.
import { basePriceName } from './chain';
import { priceableTypeNames } from './chainTables';
import { findByName } from './typedb';
import { fetchAggregates } from './market';
import { BUILTIN_HUBS } from './constants';
import { logInfo } from './devlog';

export const PRICE_TTL_MS = 30 * 60_000;
let held: { at: number; prices: Map<string, number> } | null = null;
let inflight: Promise<Map<string, number>> | null = null;

export function fetchChainPrices(): Promise<Map<string, number>> {
  if (held && Date.now() - held.at < PRICE_TTL_MS) return Promise.resolve(held.prices);
  if (inflight) return inflight;
  const names = priceableTypeNames();
  const ids = names.map((n) => findByName(n)?.id).filter((x): x is number => typeof x === 'number');
  const jita = BUILTIN_HUBS.find((h) => h.id === 'jita') ?? BUILTIN_HUBS[0];
  const t0 = performance.now();
  inflight = fetchAggregates(jita, ids).then((agg) => {
    const m = new Map<string, number>();
    for (const n of names) { const id = findByName(n)?.id; const a = id !== undefined ? agg.get(id) : undefined; if (a?.sell?.min) m.set(n, a.sell.min); }
    // ore variants the type list does not carry take their base ore's
    // price — a floor, a variant yields at least that (v0.202.8)
    let floored = 0;
    for (const n of names) {
      if (m.has(n)) continue;
      const base = basePriceName(n, (x) => m.has(x));
      if (base) { m.set(n, m.get(base)!); floored++; }
    }
    logInfo('chain', 'prices', { ms: Math.round(performance.now() - t0), types: ids.length, priced: m.size - floored, floored });
    held = { at: Date.now(), prices: m };
    return m;
  }).catch((e) => {
    logInfo('chain', 'prices failed', { ms: Math.round(performance.now() - t0), types: ids.length });
    throw e;
  }).finally(() => { inflight = null; });
  return inflight;
}
