import { ESI_BASE, FUZZWORK_AGGREGATES, HISTORY_TTL_MS, PRICE_TTL_MS } from './constants';
import { esiFetch } from './esiRate';
import type { Hub, HistoryDay, SideAggregate, TypeAggregate } from './types';

// ---------- Fuzzwork aggregates (prices) ----------

// in-memory cache: hubKey -> typeId -> aggregate
const priceCache = new Map<string, Map<number, TypeAggregate>>();

function hubKey(hub: Hub): string {
  return `${hub.kind}:${hub.locationId}`;
}

function parseSide(raw: Record<string, string>): SideAggregate {
  return {
    weightedAverage: Number(raw.weightedAverage),
    max: Number(raw.max),
    min: Number(raw.min),
    median: Number(raw.median),
    volume: Number(raw.volume),
    orderCount: Number(raw.orderCount),
    percentile: Number(raw.percentile),
  };
}

// Fuzzwork happily serves batched type lists, but keep chunks moderate so URLs
// stay short and single responses stay small (RULES.md #4).
const CHUNK_SIZE = 500;
const CHUNK_CONCURRENCY = 3;

/**
 * Fetch aggregates for the given types at one hub. Serves from cache within
 * PRICE_TTL_MS unless `force`. Large requests are chunked with limited
 * concurrency; `onProgress` reports chunk completion for scan UIs.
 */
export async function fetchAggregates(
  hub: Hub,
  typeIds: number[],
  force = false,
  onProgress?: (done: number, total: number) => void,
): Promise<Map<number, TypeAggregate>> {
  const key = hubKey(hub);
  let cached = priceCache.get(key);
  if (!cached) {
    cached = new Map();
    priceCache.set(key, cached);
  }
  const now = Date.now();
  const missing = force
    ? [...typeIds]
    : typeIds.filter((t) => {
        const hit = cached.get(t);
        return !hit || now - hit.fetchedAt > PRICE_TTL_MS;
      });

  if (missing.length > 0) {
    const chunks: number[][] = [];
    for (let i = 0; i < missing.length; i += CHUNK_SIZE) {
      chunks.push(missing.slice(i, i + CHUNK_SIZE));
    }
    let done = 0;
    let failures = 0;
    onProgress?.(0, chunks.length);
    const queue = [...chunks];
    async function worker() {
      for (;;) {
        const chunk = queue.shift();
        if (!chunk) return;
        try {
          const url = `${FUZZWORK_AGGREGATES}?${hub.kind}=${hub.locationId}&types=${chunk.join(',')}`;
          const res = await fetch(url);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data: Record<string, { buy: Record<string, string>; sell: Record<string, string> }> =
            await res.json();
          for (const t of chunk) {
            const entry = data[String(t)];
            if (!entry) continue;
            cached!.set(t, { buy: parseSide(entry.buy), sell: parseSide(entry.sell), fetchedAt: now });
          }
        } catch {
          failures++;
        }
        done++;
        onProgress?.(done, chunks.length);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, () => worker()),
    );
    if (failures === chunks.length) throw new Error(`Fuzzwork unreachable for ${hub.name}`);
  }

  const out = new Map<number, TypeAggregate>();
  for (const t of typeIds) {
    const hit = cached.get(t);
    if (hit) out.set(t, hit);
  }
  return out;
}

// ---------- ESI ----------

async function esi<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await esiFetch(`${ESI_BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
  });
  if (!res.ok) throw new Error(`ESI ${res.status} on ${path}`);
  return res.json();
}

const historyCache = new Map<string, { at: number; days: HistoryDay[] }>();

export async function fetchHistory(regionId: number, typeId: number): Promise<HistoryDay[]> {
  const key = `${regionId}:${typeId}`;
  const hit = historyCache.get(key);
  if (hit && Date.now() - hit.at < HISTORY_TTL_MS) return hit.days;

  // deep scans 404 constantly (an item that never traded in a region), and
  // every one of those spends from the SHARED error budget — esiFetch is what
  // waits when it runs low, on behalf of the whole app rather than just here
  const res = await esiFetch(`${ESI_BASE}/markets/${regionId}/history/?type_id=${typeId}`, {
    headers: { Accept: 'application/json' },
  });
  // 404 = no trade history in this region — a normal answer, cache as empty
  const days: HistoryDay[] = res.ok ? await res.json() : [];
  if (!res.ok && res.status !== 404) throw new Error(`ESI ${res.status} on history ${typeId}`);
  historyCache.set(key, { at: Date.now(), days });
  return days;
}

// ---------- CCP global average prices (mistake-detection reference) ----------

let marketPricesCache: { at: number; map: Map<number, number> } | null = null;

/**
 * `/markets/prices/` — CCP's global average_price for every type in one call.
 * Used as the sanity reference for spotting way-off orders.
 */
export async function fetchMarketPrices(): Promise<Map<number, number>> {
  if (marketPricesCache && Date.now() - marketPricesCache.at < HISTORY_TTL_MS) {
    return marketPricesCache.map;
  }
  const list = await esi<{ type_id: number; average_price?: number }[]>(`/markets/prices/`);
  const map = new Map<number, number>();
  for (const e of list) {
    if (e.average_price && e.average_price > 0) map.set(e.type_id, e.average_price);
  }
  marketPricesCache = { at: Date.now(), map };
  return map;
}

// ---------- history statistics (trend / sanity / daily volume) ----------

/** items trading on fewer days than this per month are lottery tickets, not markets */
export const MIN_ACTIVE_DAYS = 5;
/** achievable sell price = recent prints × this headroom — never the listing */
export const PRINT_HEADROOM = 1.1;

export interface HistoryStats {
  /** days with at least one trade in the last 30 — market heartbeat */
  activeDays30: number;
  /** median of daily average prices over the last 90 calendar days */
  median90: number;
  /** mean traded price over the last 7 / 30 calendar days (falls back to median) */
  avg7: number;
  avg30: number;
  /**
   * CONSERVATIVE units/day: min of the 30d and 90d calendar-day rates.
   * ESI history omits zero-volume days, so averaging "the last N rows" counts
   * only days the item traded and wildly overstates illiquid items — rates must
   * divide by calendar days, with silent days counting as zero.
   */
  dailyVol14: number;
  /** per-window calendar-day rates for display: [7d, 30d, 90d] */
  volWindows: [number, number, number];
  /**
   * highest price anything ACTUALLY SOLD for (ESI daily 'highest'), maxed over
   * [last day, last 7d, last 30d] calendar windows. 0 = no trades in window.
   * Region-level — ESI has no per-station history.
   */
  maxSold: [number, number, number];
  /** (avg7 − avg30) / avg30 — positive = price trending up */
  trendPct: number;
  /** open orders per traded unit, last 7 / 30 calendar days (null = no trades).
   * crowd7 rising above crowd30 = competitors flowing in BEFORE the book
   * shows it — the leading indicator behind the heat forecast. */
  crowd7: number | null;
  crowd30: number | null;
  /**
   * estimated share of daily volume that sells INTO buy orders. Sells into bids
   * print at the day's LOW, buys from asks print at the HIGH — so where the
   * volume-weighted average sits between them reveals the split.
   */
  bidShare: number;
  /**
   * realistic buy-order fill price: volume-weighted mean of the daily LOWEST
   * traded price (7d window, 30d fallback) — what sellers have actually
   * accepted, regardless of today's possibly-lowball top bid.
   */
  estBidFill: number;
}

/** Stats from ESI region history; null when the item barely trades. */
export class HistoryUnavailable extends Error {
  constructor(cause: unknown) {
    super(`history fetch failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'HistoryUnavailable';
  }
}

export async function historyStats(regionId: number, typeId: number): Promise<HistoryStats | null> {
  let days: HistoryDay[];
  try {
    days = await fetchHistory(regionId, typeId);
  } catch (e) {
    // A FAILED FETCH IS NOT AN ANSWER. Returning null here made a network
    // blip, an ESI 5xx or a 420 indistinguishable from the legitimate "this
    // item barely trades here" — and the day cache then SEALED that fiction
    // in localStorage until 00:00 UTC, silently blanking hundreds of
    // (region, item) pairs for up to a day. Rule 3: record nothing.
    throw new HistoryUnavailable(e);
  }
  if (days.length === 0) return null;
  const now = Date.now();
  const inWindow = (d: HistoryDay, windowDays: number) =>
    now - new Date(d.date).getTime() <= windowDays * 86_400_000;
  const rate = (windowDays: number) =>
    days.filter((d) => inWindow(d, windowDays)).reduce((s, d) => s + d.volume, 0) / windowDays;

  const vol7 = rate(7);
  const vol30 = rate(30);
  const vol90 = rate(90);
  // conservative: a recent spike (30d high) doesn't count unless the longer
  // record (90d) backs it up — "realistic even if it takes a while"
  const dailyVol = Math.min(vol30, vol90);
  if (vol90 === 0) return null; // hasn't traded in 90 days: no usable liquidity

  const rows90 = days.filter((d) => inWindow(d, 90));
  if (rows90.length < 3) return null;
  const sorted = rows90.map((d) => d.average).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : NaN);
  const rows7 = days.filter((d) => inWindow(d, 7)).map((d) => d.average);
  const rows30 = days.filter((d) => inWindow(d, 30)).map((d) => d.average);
  const avg7 = rows7.length ? mean(rows7) : median;
  const avg30 = rows30.length ? mean(rows30) : median;
  // "1 day" uses a 48h window: ESI history lags ~a day, so this is yesterday's data
  const maxIn = (w: number) =>
    days.filter((d) => inWindow(d, w)).reduce((m, d) => Math.max(m, d.highest), 0);

  // bid share: volume-weighted (highest − average) / (highest − lowest)
  let shareNum = 0;
  let shareDen = 0;
  for (const d of rows90.filter((x) => inWindow(x, 30))) {
    if (d.highest > d.lowest && d.volume > 0) {
      shareNum += d.volume * ((d.highest - d.average) / (d.highest - d.lowest));
      shareDen += d.volume;
    }
  }
  const bidShare = shareDen > 0 ? Math.min(0.95, Math.max(0.05, shareNum / shareDen)) : 0.25;

  const fillWindow = (w: number) => {
    let num = 0;
    let den = 0;
    for (const d of days.filter((x) => inWindow(x, w))) {
      num += d.lowest * d.volume;
      den += d.volume;
    }
    return den > 0 ? num / den : 0;
  };
  const estBidFill = fillWindow(7) || fillWindow(30) || median;

  const activeDays30 = days.filter((d) => inWindow(d, 30) && d.volume > 0).length;

  // crowding: open-order churn per traded unit (ESI history's order_count).
  // Rising orders-per-unit = more competitors chasing the same demand — a
  // LEADING indicator of undercut wars, visible before the book heats up.
  const crowd = (w: number): number | null => {
    let orders = 0;
    let vol = 0;
    for (const d of days.filter((x) => inWindow(x, w) && x.volume > 0)) {
      orders += d.order_count;
      vol += d.volume;
    }
    return vol > 0 ? orders / vol : null;
  };

  return {
    activeDays30,
    bidShare,
    estBidFill,
    median90: median,
    avg7,
    avg30,
    dailyVol14: dailyVol,
    volWindows: [vol7, vol30, vol90],
    maxSold: [maxIn(2), maxIn(7), maxIn(30)],
    trendPct: avg30 > 0 ? (avg7 - avg30) / avg30 : 0,
    crowd7: crowd(7),
    crowd30: crowd(30),
  };
}

/**
 * Resolve a solar-system name (exact, case-insensitive) to a custom Hub.
 * Region is found via system -> constellation -> region.
 */
export async function resolveSystemHub(name: string): Promise<Hub> {
  const ids = await esi<{ systems?: { id: number; name: string }[] }>(`/universe/ids/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([name.trim()]),
  });
  const sys = ids.systems?.[0];
  if (!sys) throw new Error(`No solar system named "${name.trim()}" — names must be exact (e.g. "Perimeter").`);
  const sysInfo = await esi<{ constellation_id: number }>(`/universe/systems/${sys.id}/`);
  const constInfo = await esi<{ region_id: number }>(
    `/universe/constellations/${sysInfo.constellation_id}/`,
  );
  return {
    id: `sys-${sys.id}`,
    name: sys.name,
    kind: 'system',
    locationId: sys.id,
    regionId: constInfo.region_id,
  };
}

/**
 * Resolve a system name to a region-scope Hub — prices/volumes across the whole
 * region. For scouting an area ("what sells near this wormhole exit").
 */
export async function resolveRegionHub(systemName: string): Promise<Hub> {
  const sysHub = await resolveSystemHub(systemName);
  const region = await esi<{ name: string }>(`/universe/regions/${sysHub.regionId}/`);
  return {
    id: `reg-${sysHub.regionId}`,
    name: `${region.name} (region)`,
    kind: 'region',
    locationId: sysHub.regionId,
    regionId: sysHub.regionId,
  };
}
