// Auto Haul: station-specific deals within N jumps of a system, plus a greedy
// load optimizer ("fill my cargo with the most profitable sellable stuff").
//
// Data: ESI regional order books (exact per-station orders — real depth, not
// aggregates) + source-hub prices from Fuzzwork + day-cached history stats for
// sell-order sizing.
import { ESI_BASE } from './constants';
import { esiFetch } from './esiRate';
import { MIN_ACTIVE_DAYS, PRINT_HEADROOM, fetchAggregates, fetchMarketPrices } from './market';
import { statsFor, flushStatsCache } from './historyCache';
import { salesTaxRate, brokerFeeRate } from './fees';
import { getType } from './typedb';
import { getStation, getSystem, findSystem, systemsWithin } from './mapdata';
import { useApp } from './store';
import { computeHeat, type Heat } from './heat';
import { teamOrderIds } from './myMarket';
import type { Hub, Settings } from './types';

/** the bulk market sweep: the FIRST traffic to yield when the shared ESI
 * error budget tightens, so it can never crowd out the overlay or the
 * screen the user is actually looking at (see esiRate.ts lanes). */
const BULK = { lane: 'bulk' as const };

const DEPTH_FRACTION = 0.05; // matches scanner.ts — 5%-percentile source pricing
const DEST_ABOVE_NORM = 1.35;
const ORDER_PAGE_CONCURRENCY = 6;

export interface AreaParams {
  source: Hub;
  centerName: string;
  maxJumps: number;
  cargoM3: number;
  budgetISK: number | null;
  /** sell-order positions sized to this many days of region volume */
  sellDays: number;
  /** how many single-station haul options to return */
  optionCount: number;
  /** player structures can be invisible/undockable — opt-in only */
  includeStructures: boolean;
  settings: Settings;
  onProgress?: (msg: string) => void;
}

export interface AreaDeal {
  typeId: number;
  name: string;
  itemVolume: number;
  /** where to sell */
  locationId: number;
  stationName: string;
  systemName: string;
  jumps: number;
  sec: number;
  /** 'instant' = fill standing buy orders; 'order' = place a sell order */
  mode: 'instant' | 'order';
  buyPrice: number; // per unit at source
  sellPrice: number; // gross per unit at destination (volume-weighted for instant)
  profitPerUnit: number; // net of fees
  /** max sensible units: real buy-book depth (instant) or sellDays × daily volume (order) */
  maxUnits: number;
  /** units realistically buyable near the source price (5% of source sell depth) */
  srcDepth: number;
  /** highest ACTUAL sale price in the destination region: [day, 7d, 30d] */
  maxSold: [number, number, number] | null;
  /** conservative units/day in the destination region */
  dailyVol: number | null;
  /** largest min-quantity condition among used buy orders (instant; 1 = none) */
  minVolume: number;
  daysToSell: number | null; // null for instant (standing demand)
  /** undercut tempo of the destination's sell front line (order mode) */
  heat: Heat | null;
}

export interface PlanRow extends AreaDeal {
  qty: number;
  cost: number;
  profit: number;
  m3: number;
}

export interface HaulTotals {
  cost: number;
  profit: number;
  m3Used: number;
  cargoM3: number;
  boundBy: 'cargo' | 'budget' | 'deals';
}

/** one "pick up everything at the source, drop everything at THIS station" plan */
export interface HaulOption {
  locationId: number;
  stationName: string;
  systemName: string;
  jumps: number;
  sec: number;
  plan: PlanRow[];
  totals: HaulTotals;
}

export interface AreaResult {
  center: { name: string; id: number };
  systemsScanned: number;
  stationsConsidered: number;
  options: HaulOption[];
}

interface EsiOrder {
  order_id: number;
  type_id: number;
  location_id: number;
  system_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  min_volume: number;
  issued: string;
}

async function fetchRegionOrders(
  regionId: number,
  onProgress?: (msg: string) => void,
): Promise<EsiOrder[]> {
  const first = await esiFetch(`${ESI_BASE}/markets/${regionId}/orders/?order_type=all&page=1`, undefined, BULK);
  if (!first.ok) throw new Error(`ESI ${first.status} fetching region ${regionId} orders`);
  const pages = Number(first.headers.get('x-pages') ?? '1');
  const all: EsiOrder[] = await first.json();
  let done = 1;
  const pageNums = Array.from({ length: pages - 1 }, (_, i) => i + 2);
  async function worker() {
    for (;;) {
      const page = pageNums.shift();
      if (!page) return;
      const res = await esiFetch(`${ESI_BASE}/markets/${regionId}/orders/?order_type=all&page=${page}`, undefined, BULK);
      if (res.ok) all.push(...((await res.json()) as EsiOrder[]));
      done++;
      onProgress?.(`Reading order books… region ${regionId}: ${done}/${pages} pages`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(ORDER_PAGE_CONCURRENCY, pages) }, worker));
  return all;
}

export async function scanArea(p: AreaParams): Promise<AreaResult> {
  const center = findSystem(p.centerName);
  if (!center) throw new Error(`Unknown system "${p.centerName}" — K-space names must be exact.`);
  const area = systemsWithin(center.id, p.maxJumps);

  // regions touched by the area
  const regionIds = new Set<number>();
  for (const sysId of area.keys()) {
    const s = getSystem(sysId);
    if (s) regionIds.add(s.regionId);
  }

  p.onProgress?.(`Reading order books for ${regionIds.size} region(s)…`);
  const orders: EsiOrder[] = [];
  for (const regionId of regionIds) {
    const regionOrders = await fetchRegionOrders(regionId, p.onProgress);
    for (const o of regionOrders) if (area.has(o.system_id)) orders.push(o);
  }

  // group per (type, location)
  interface Book {
    buys: EsiOrder[];
    sells: { order_id: number; price: number; issued: string }[];
    sellMin: number;
  }
  const books = new Map<string, Book>();
  const candidateTypes = new Set<number>();
  for (const o of orders) {
    const key = `${o.type_id}:${o.location_id}`;
    let b = books.get(key);
    if (!b) {
      b = { buys: [], sells: [], sellMin: Infinity };
      books.set(key, b);
    }
    if (o.is_buy_order) b.buys.push(o);
    else {
      b.sells.push({ order_id: o.order_id, price: o.price, issued: o.issued });
      b.sellMin = Math.min(b.sellMin, o.price);
    }
    candidateTypes.add(o.type_id);
  }

  const typeIds = [...candidateTypes].filter((t) => {
    const it = getType(t);
    return it && it.volume > 0 && it.volume <= p.cargoM3;
  });

  p.onProgress?.(`Pricing ${typeIds.length} items at ${p.source.name}…`);
  const [srcBook, refPrices] = await Promise.all([
    fetchAggregates(p.source, typeIds, false, (d, t) =>
      p.onProgress?.(`Pricing at ${p.source.name}… ${d}/${t}`),
    ),
    fetchMarketPrices(),
  ]);

  const tax = salesTaxRate(p.settings);
  const broker = brokerFeeRate(p.settings); // area stations: standings unknown → base rate

  // selling in the source hub's own system isn't a haul — exclude it
  const sourceSystemId =
    p.source.kind === 'station' ? getStation(p.source.locationId)?.systemId : p.source.locationId;

  p.onProgress?.('Computing deals…');
  const deals: AreaDeal[] = [];
  const orderModeCandidates: AreaDeal[] = [];

  const ignored = new Set(useApp.getState().ignoredTypeIds);
  for (const [key, book] of books) {
    const [typeIdStr, locStr] = key.split(':');
    const typeId = Number(typeIdStr);
    const locationId = Number(locStr);
    if (ignored.has(typeId)) continue; // user's ignore list
    // player structures can be invisible or undockable to this character —
    // only offer them as drop-offs when explicitly asked
    if (!p.includeStructures && locationId > 1_000_000_000_000) continue;
    const item = getType(typeId);
    if (!item || item.volume <= 0 || item.volume > p.cargoM3) continue;
    const src = srcBook.get(typeId);
    if (!src || src.sell.orderCount === 0 || src.sell.min <= 0) continue;
    const buyPrice = src.sell.percentile > 0 ? src.sell.percentile : src.sell.min;
    const srcDepth = Math.max(1, Math.floor(src.sell.volume * DEPTH_FRACTION));

    const station = getStation(locationId);
    const systemId = station?.systemId ?? book.buys[0]?.system_id;
    const sys = systemId ? getSystem(systemId) : undefined;
    if (!sys || sys.id === sourceSystemId) continue;
    const stationName = station?.name ?? `Player structure …${String(locationId).slice(-4)}`;
    const common = {
      typeId,
      name: item.name,
      itemVolume: item.volume,
      locationId,
      stationName,
      systemName: sys.name,
      jumps: area.get(sys.id) ?? 0,
      sec: sys.sec,
    };

    // instant: walk the real buy book, take orders while they beat source cost
    if (book.buys.length > 0) {
      const sorted = [...book.buys].sort((a, b) => b.price - a.price);
      let units = 0;
      let revenue = 0;
      let minVolume = 1;
      for (const o of sorted) {
        if (o.price * (1 - tax) - buyPrice <= 0) break;
        units += o.volume_remain;
        revenue += o.price * o.volume_remain;
        if (o.min_volume > minVolume) minVolume = o.min_volume;
      }
      if (units > 0) {
        const sellPrice = revenue / units;
        const profitPerUnit = sellPrice * (1 - tax) - buyPrice;
        deals.push({
          ...common,
          mode: 'instant',
          buyPrice,
          sellPrice,
          profitPerUnit,
          maxUnits: Math.min(units, srcDepth),
          srcDepth,
          maxSold: null,
          dailyVol: null,
          minVolume,
          daysToSell: null,
          heat: null, // instant mode fills standing buys — no undercut war
        });
      }
    }

    // order: undercut the local lowest sell (needs history sizing — deferred below).
    // Requires a CCP reference price — without one, a lone speculative listing
    // (rare SKINs, dead blueprints) would be taken at face value.
    const ref = refPrices.get(typeId);
    if (book.sellMin !== Infinity && ref) {
      let sellPrice = book.sellMin;
      if (sellPrice > DEST_ABOVE_NORM * ref) sellPrice = DEST_ABOVE_NORM * ref;
      const profitPerUnit = sellPrice * (1 - tax - broker) - buyPrice;
      if (profitPerUnit > 0) {
        orderModeCandidates.push({
          ...common,
          mode: 'order',
          buyPrice,
          sellPrice,
          profitPerUnit,
          maxUnits: srcDepth, // refined by history below
          srcDepth,
          maxSold: null,
          dailyVol: null,
          minVolume: 1,
          daysToSell: null,
          heat: computeHeat(book.sells.filter((x) => !teamOrderIds().has(x.order_id)), 'sell'),
        });
      }
    }
  }

  // size sell-order deals by region daily volume (day-cached history)
  let sized = 0;
  const queue = [...orderModeCandidates];
  async function sizeWorker() {
    for (;;) {
      const deal = queue.shift();
      if (!deal) return;
      const sys = findSystem(deal.systemName)!;
      try {
        const stats = await statsFor(sys.regionId, deal.typeId);
        // require a real market heartbeat AND at least one whole unit sellable
        // within the window — no qty=1 for items that trade twice a month
        const sellable = stats ? Math.floor(stats.dailyVol14 * p.sellDays) : 0;
        if (stats && stats.activeDays30 >= MIN_ACTIVE_DAYS && sellable >= 1) {
          // achievable price = what buyers actually pay, never the listing
          const printCeiling = Math.max(stats.avg7, stats.median90) * PRINT_HEADROOM;
          if (deal.sellPrice > printCeiling) {
            deal.sellPrice = printCeiling;
            deal.profitPerUnit = deal.sellPrice * (1 - tax - broker) - deal.buyPrice;
          }
          if (deal.profitPerUnit > 0) {
            deal.maxUnits = Math.min(deal.maxUnits, sellable);
            deal.daysToSell = deal.maxUnits / stats.dailyVol14;
            deal.maxSold = stats.maxSold;
            deal.dailyVol = stats.dailyVol14;
            deals.push(deal);
          }
        }
      } catch {
        // treat as no history → skip
      }
      sized++;
      if (sized % 20 === 0 || sized === orderModeCandidates.length) {
        p.onProgress?.(`Sizing sell orders… ${sized}/${orderModeCandidates.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, sizeWorker));
  flushStatsCache();

  // ---- per-station greedy load optimizer ----
  // One haul = pick everything up at the source, drop it ALL at one station.
  // For each candidate station, run two greedy passes (profit/m³ for
  // cargo-bound, profit/ISK for budget-bound) and keep the better plan;
  // then rank the stations and return the best few as options.
  function buildPlan(stationDeals: AreaDeal[], density: (d: AreaDeal) => number) {
    const sortedDeals = [...stationDeals].sort((a, b) => density(b) - density(a));
    const plan: PlanRow[] = [];
    let m3Left = p.cargoM3;
    let iskLeft = p.budgetISK ?? Infinity;
    const perTypeUsed = new Map<number, number>();
    for (const d of sortedDeals) {
      if (d.profitPerUnit <= 0) break;
      // the same item may appear as instant AND order deal — don't buy more at
      // the source than its 5%-depth combined
      const already = perTypeUsed.get(d.typeId) ?? 0;
      const qty = Math.floor(
        Math.min(d.maxUnits, m3Left / d.itemVolume, iskLeft / d.buyPrice, d.srcDepth - already),
      );
      if (qty < 1 || qty < d.minVolume) continue;
      plan.push({
        ...d,
        qty,
        cost: qty * d.buyPrice,
        profit: qty * d.profitPerUnit,
        m3: qty * d.itemVolume,
      });
      perTypeUsed.set(d.typeId, already + qty);
      m3Left -= qty * d.itemVolume;
      iskLeft -= qty * d.buyPrice;
      if (m3Left < 0.01 || iskLeft < 1) break;
    }
    return plan;
  }
  const total = (rows: PlanRow[]) => rows.reduce((s, r) => s + r.profit, 0);

  const byStation = new Map<number, AreaDeal[]>();
  for (const d of deals) {
    (byStation.get(d.locationId) ?? byStation.set(d.locationId, []).get(d.locationId)!).push(d);
  }

  const options: HaulOption[] = [];
  for (const [locationId, stationDeals] of byStation) {
    const byM3 = buildPlan(stationDeals, (d) => d.profitPerUnit / d.itemVolume);
    const byISK = buildPlan(stationDeals, (d) => d.profitPerUnit / d.buyPrice);
    const plan = total(byM3) >= total(byISK) ? byM3 : byISK;
    if (plan.length === 0) continue;
    const m3Used = plan.reduce((s, r) => s + r.m3, 0);
    const cost = plan.reduce((s, r) => s + r.cost, 0);
    const first = stationDeals[0];
    options.push({
      locationId,
      stationName: first.stationName,
      systemName: first.systemName,
      jumps: first.jumps,
      sec: first.sec,
      plan,
      totals: {
        cost,
        profit: total(plan),
        m3Used,
        cargoM3: p.cargoM3,
        boundBy:
          m3Used > p.cargoM3 * 0.98
            ? 'cargo'
            : p.budgetISK && cost > p.budgetISK * 0.98
              ? 'budget'
              : 'deals',
      },
    });
  }
  options.sort((a, b) => b.totals.profit - a.totals.profit);
  const picked = options.slice(0, p.optionCount);

  // enrich the final plan rows with "max actually sold" (day-cached history)
  p.onProgress?.('Fetching sale-price history for the shortlisted loads…');
  for (const opt of picked) {
    for (const row of opt.plan) {
      if (row.maxSold) continue;
      const sys = findSystem(row.systemName);
      if (!sys) continue;
      try {
        const stats = await statsFor(sys.regionId, row.typeId);
        if (stats) {
          row.maxSold = stats.maxSold;
          row.dailyVol = stats.dailyVol14;
        }
      } catch {
        // display-only enrichment
      }
    }
  }
  flushStatsCache();

  p.onProgress?.('');
  return {
    center: { name: center.name, id: center.id },
    systemsScanned: area.size,
    stationsConsidered: options.length,
    options: picked,
  };
}

/** EVE multibuy format: one "Item Name qty" per line, quantities summed per item. */
export function multibuyText(plan: PlanRow[]): string {
  return multibuyChunks(plan).join('\n');
}

/** EVE's multibuy window accepts at most 100 lines — split into pasteable chunks. */
export function multibuyChunks(plan: PlanRow[]): string[] {
  const byName = new Map<string, number>();
  for (const r of plan) byName.set(r.name, (byName.get(r.name) ?? 0) + r.qty);
  const lines = [...byName.entries()].map(([name, qty]) => `${name} ${qty}`);
  const chunks: string[] = [];
  for (let i = 0; i < lines.length; i += 100) chunks.push(lines.slice(i, i + 100).join('\n'));
  return chunks.length > 0 ? chunks : [''];
}
