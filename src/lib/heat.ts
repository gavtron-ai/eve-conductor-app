// Undercut heat: how contested a market is RIGHT NOW, measured without any
// monitoring — every order in the book carries `issued` (when its owner set
// its current price), so the age distribution of the front line tells you the
// reprice tempo before you commit ISK. Front line = orders within 2% of the
// best price on that side.
import { ESI_BASE } from './constants';
import { esiFetch } from './esiRate';

export interface Heat {
  /** orders on the front line (within 2% of best) */
  rivals: number;
  /** ms since the most recent front-line reprice */
  freshestMs: number;
  /** median ms since front-line reprices */
  medianAgeMs: number;
  level: 'hot' | 'warm' | 'quiet';
}

const FRONT_LINE_BAND = 0.02;

export function computeHeat(
  orders: { price: number; issued: string | number }[],
  side: 'sell' | 'buy',
  now = Date.now(),
): Heat | null {
  if (orders.length === 0) return null;
  const best =
    side === 'sell'
      ? Math.min(...orders.map((o) => o.price))
      : Math.max(...orders.map((o) => o.price));
  const front = orders.filter((o) =>
    side === 'sell' ? o.price <= best * (1 + FRONT_LINE_BAND) : o.price >= best * (1 - FRONT_LINE_BAND),
  );
  const ages = front
    .map((o) => now - new Date(o.issued).getTime())
    .filter((a) => Number.isFinite(a) && a >= 0)
    .sort((a, b) => a - b);
  if (ages.length === 0) return null;
  const freshestMs = ages[0];
  const medianAgeMs = ages[Math.floor(ages.length / 2)];
  const H = 3_600_000;
  const level: Heat['level'] =
    freshestMs < 0.5 * H || (ages.length >= 2 && medianAgeMs < 2 * H)
      ? 'hot'
      : freshestMs < 24 * H
        ? 'warm'
        : 'quiet';
  return { rivals: ages.length, freshestMs, medianAgeMs, level };
}

export function heatAge(ms: number): string {
  if (ms < 3_600_000) return `${Math.max(1, Math.round(ms / 60_000))}m`;
  if (ms < 86_400_000) return `${Math.round(ms / 3_600_000)}h`;
  return `${Math.round(ms / 86_400_000)}d`;
}

export function heatTip(h: Heat, side: 'sell' | 'buy'): string {
  const what = side === 'sell' ? 'sell orders within 2% of the best ask' : 'buy orders within 2% of the top bid';
  return (
    `Competition tempo from the live book's own timestamps: ${h.rivals} ${what}, ` +
    `newest repriced ${heatAge(h.freshestMs)} ago (median ${heatAge(h.medianAgeMs)}). ` +
    (h.level === 'hot'
      ? 'HOT — expect a reprice war; you will be babysitting this price.'
      : h.level === 'warm'
        ? 'Warm — occasional undercuts; check in daily.'
        : 'Quiet — the front line has not moved in over a day.')
  );
}

// ---- lazy per-station heat for scan results (cached ~5 min, book TTL) ----
// The cache stores the station's BOOK rows, and heat is computed per call so
// the caller can exclude the team's own orders — your reprices must never
// make a book look hot to yourself.

interface HeatRow {
  order_id: number;
  price: number;
  issued: string;
  location_id: number;
}

const cache = new Map<string, { at: number; rows: HeatRow[] | null }>();
const TTL = 5 * 60_000;
const inflight = new Map<string, Promise<HeatRow[] | null>>();

export async function fetchStationHeat(
  regionId: number,
  typeId: number,
  stationId: number,
  side: 'sell' | 'buy' = 'sell',
  excludeOrderIds?: Set<number>,
): Promise<Heat | null> {
  const key = `${regionId}:${typeId}:${stationId}:${side}`;
  const hit = cache.get(key);
  let rows: HeatRow[] | null;
  if (hit && Date.now() - hit.at < TTL) {
    rows = hit.rows;
  } else if (inflight.has(key)) {
    rows = await inflight.get(key)!;
  } else {
    const p = (async (): Promise<HeatRow[] | null> => {
      try {
        const res = await esiFetch(
          `${ESI_BASE}/markets/${regionId}/orders/?type_id=${typeId}&order_type=${side}`,
        );
        if (!res.ok) return null;
        const orders = (await res.json()) as HeatRow[];
        const station = orders.filter((o) => o.location_id === stationId);
        cache.set(key, { at: Date.now(), rows: station });
        return station;
      } catch {
        return null;
      } finally {
        inflight.delete(key);
      }
    })();
    inflight.set(key, p);
    rows = await p;
  }
  if (rows === null) return null;
  const rivals = excludeOrderIds ? rows.filter((o) => !excludeOrderIds.has(o.order_id)) : rows;
  return computeHeat(rivals, side);
}
