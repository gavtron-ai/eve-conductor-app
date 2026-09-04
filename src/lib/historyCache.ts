// Persistent per-day cache of computed history stats. ESI region history only
// updates once per day (~11:05 UTC), so caching the derived HistoryStats — five
// numbers, not the raw history — makes a whole-market deep scan cheap after its
// first run and across app restarts. ~10k entries ≈ <1 MB of localStorage.
import { historyStats, type HistoryStats } from './market';

// v6: adds crowd7/crowd30 (v5: activeDays30; v4: bidShare/estBidFill; v3: maxSold)
const CACHE_KEY = 'etc-history-stats-v6';

interface Entry {
  d: string; // UTC day the stats were computed
  s: HistoryStats | null;
}

const today = () => new Date().toISOString().slice(0, 10);

function load(): Record<string, Entry> {
  try {
    const all: Record<string, Entry> = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
    const d = today();
    for (const k of Object.keys(all)) if (all[k].d !== d) delete all[k]; // stale
    return all;
  } catch {
    return {};
  }
}

const cache: Record<string, Entry> = load();
let dirty = 0;

function persist() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
    dirty = 0;
  } catch {
    // quota — the in-memory copy still works for this session
  }
}

/**
 * Day-cached history stats; null = item doesn't meaningfully trade there.
 *
 * ONLY A REAL ANSWER IS CACHED. A transient failure used to be written as
 * `{ s: null }` and persisted, so one bad minute of ESI during a deep scan
 * marked hundreds of items "no usable history" until 00:00 UTC — across app
 * restarts — and every consumer treats that null as fact (areaScan drops the
 * deal, scanner skips destination sizing). A failure now propagates so the
 * caller can treat it as unknown, and the pair is simply retried later.
 */
export async function statsFor(regionId: number, typeId: number): Promise<HistoryStats | null> {
  const key = `${regionId}:${typeId}`;
  const hit = cache[key];
  if (hit && hit.d === today()) return hit.s;
  const s = await historyStats(regionId, typeId); // throws HistoryUnavailable
  cache[key] = { d: today(), s };
  if (++dirty >= 250) persist();
  return s;
}

/** Call at the end of a scan so the last batch survives an app restart. */
export function flushStatsCache() {
  if (dirty > 0) persist();
}

/** How many (region, item) stats are already cached for today. */
export function cachedStatsCount(): number {
  return Object.keys(cache).length;
}
