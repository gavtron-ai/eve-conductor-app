// Trade Finder + Mistake Finder engines.
// All thresholds are heuristics — kept as named constants so they're easy to tune.
import { ESI_BASE } from './constants';
import { esiFetch } from './esiRate';
import { MIN_ACTIVE_DAYS, PRINT_HEADROOM, fetchAggregates, fetchMarketPrices } from './market';
import { statsFor, flushStatsCache } from './historyCache';
import { brokerRateForHub, salesTaxForHub } from './broker';
import { getType } from './typedb';
import { getStation, systemsWithin } from './mapdata';
import type { Hub, Settings, TypeAggregate } from './types';

/** buy/sell prices use the 5%-percentile aggregate, so assume only that slice
 * of the book is fillable near the quoted price */
const DEPTH_FRACTION = 0.05;
/** sentinel detector: no real EVE position is a billion units, so anything at
 * or above this is an unconstrained MAX_SAFE_INTEGER that escaped its caps */
const UNSIZED_UNIT_CAP = 1_000_000_000;
/** destination sell price this far above its norm (90d median / global average)
 * → "may not hold" */
const DEST_ABOVE_NORM = 1.35;
/** source price this far below CCP's GLOBAL average → "one-off dump?". Never
 * compared against the destination's norm — that is what a good haul looks like. */
const SRC_BELOW_NORM = 0.65;
/** fast mode: how many stage-1 candidates get history enrichment */
const FAST_ENRICH_LIMIT = 100;
/** fast mode: shortlist slots per item — one item×5 dests mustn't hog the funnel */
const DESTS_PER_ITEM = 2;
const ENRICH_CONCURRENCY = 8;
/** rows returned to the UI (everything is computed; only display is capped) */
const RESULT_LIMIT = 250;
// Buy-order fills are estimated FROM TRADE PRINTS, not a constant: sells into
// bids print at the day's LOW, so HistoryStats.bidShare and estBidFill carry a
// per-item, data-derived fill rate and realistic fill price (see market.ts).
/** mistake finder: deviation from CCP average_price that counts as suspicious */
const CHEAP_SELL_FACTOR = 0.55;
const RICH_BUY_FACTOR = 1.6;
const MISTAKE_ROW_CAP = 60;

export interface FinderParams {
  source: Hub;
  dests: Hub[];
  typeIds: number[];
  /** e.g. 5 means 5% minimum net margin */
  minMarginPct: number;
  cargoM3: number;
  budgetISK: number | null;
  /**
   * Position-sizing window: units per trip are capped at (destination daily
   * volume × this many days), so tiny-but-expensive items are bought in
   * sellable quantities instead of being filtered out. Items with no usable
   * trade history are dropped. 0 = no liquidity logic at all.
   */
  maxDaysToSell: number;
  /** 'deep' enriches every stage-1 candidate (day-cached); 'fast' only the top shortlist */
  depth: 'deep' | 'fast';
  /** 'instant' = buy from sell orders now; 'order' = place your own buy order at the top bid */
  buyMode: 'instant' | 'order';
  /** which exit the margin filter/ranking uses ('best' = whichever is higher) */
  sellMode: 'order' | 'instant' | 'best';
  settings: Settings;
  onProgress?: (msg: string) => void;
}

export interface TradeRow {
  /** stage-1 shortlist score: profit/unit × buy-book-capped units (internal) */
  rankScore: number;
  typeId: number;
  name: string;
  itemVolume: number;
  destId: string;
  destName: string;
  /** per unit, 5%-percentile sell price at the source */
  buyPrice: number;
  /** place a sell order at the destination's lowest ask (broker fee + tax) */
  patientMargin: number | null;
  patientSell: number | null;
  /** sell instantly into destination buy orders (tax only) */
  quickMargin: number | null;
  quickSell: number | null;
  unitsPerTrip: number;
  /** patient-based when available, else quick */
  profitPerTrip: number;
  profitPerM3: number;
  /** days for the destination to absorb one load (units/trip ÷ daily volume) */
  daysToSell: number | null;
  /** calendar-day volume rates at the destination for display: [7d, 30d, 90d] */
  volWindows: [number, number, number] | null;
  /** highest ACTUAL sale price at the destination region: [day, 7d, 30d] */
  maxSold: [number, number, number] | null;
  /** buy-order mode: estimated units/day your bid captures (from trade prints) */
  fillPerDay: number | null;
  /** buy-order mode: the current top bid (for the cost tooltip) */
  topBid: number | null;
  /** buy-order mode: historical realistic fill price (what sellers accept) */
  estBidFill: number | null;
  /** buy-order mode: realistic bid is far above the current top bid */
  flagLowBid: boolean;
  /** trip profit ÷ sell time (floored at 1 day — assumes ≤1 haul/day) */
  profitPerDay: number;
  /** estimated units fillable near the quoted source price */
  srcDepth: number;
  dailyVolDest: number | null;
  trendPct: number | null;
  /** dest-region crowding (open orders per traded unit), 7d / 30d */
  crowd7: number | null;
  crowd30: number | null;
  flagDestAboveNorm: boolean;
  flagSrcBelowNorm: boolean;
}

function usableSell(agg: TypeAggregate | undefined) {
  return agg && agg.sell.orderCount > 0 && agg.sell.min > 0 ? agg.sell : null;
}
function usableBuy(agg: TypeAggregate | undefined) {
  return agg && agg.buy.orderCount > 0 && agg.buy.max > 0 ? agg.buy : null;
}

export async function findTrades(p: FinderParams): Promise<TradeRow[]> {
  // destination broker fee is standings-aware per hub when logged in
  const brokerByDest = new Map(p.dests.map((d) => [d.id, brokerRateForHub(d, p.settings)]));
  // the hub trader who SELLS there pays the tax with THEIR Accounting level
  const taxByDest = new Map(p.dests.map((d) => [d.id, salesTaxForHub(d, p.settings)]));

  // CCP's global average price (one call) sanity-caps stage-1 sell prices, so a
  // lone 190m ISK sell order in a dead market can't fake a 400,000% margin.
  p.onProgress?.('Fetching global reference prices…');
  const refPrices = await fetchMarketPrices();

  p.onProgress?.(`Fetching ${p.source.name} prices…`);
  const srcBook = await fetchAggregates(p.source, p.typeIds, false, (d, t) =>
    p.onProgress?.(`Fetching ${p.source.name} prices… ${d}/${t}`),
  );
  const destBooks = new Map<string, Map<number, TypeAggregate>>();
  for (const dest of p.dests) {
    p.onProgress?.(`Fetching ${dest.name} prices…`);
    destBooks.set(
      dest.id,
      await fetchAggregates(dest, p.typeIds, false, (d, t) =>
        p.onProgress?.(`Fetching ${dest.name} prices… ${d}/${t}`),
      ),
    );
  }

  const brokerSrc = brokerRateForHub(p.source, p.settings);
  // station trading (dest === source) hauls nothing — cargo doesn't constrain it
  const hasInHubDest = p.dests.some((d) => d.id === p.source.id);

  p.onProgress?.('Computing candidates…');
  const rows: TradeRow[] = [];
  let skippedNoRef = 0;
  for (const typeId of p.typeIds) {
    const item = getType(typeId);
    if (!item || item.volume <= 0) continue;
    if (!hasInHubDest && item.volume > p.cargoM3) continue;
    const agg = srcBook.get(typeId);
    const src = usableSell(agg);
    const srcBuySide = usableBuy(agg);
    // no CCP average_price = the item has no meaningful global trade — these are
    // exactly the dead-market listings that poison the shortlist, and they can
    // never pass a liquidity check. Kept only when the user disables the filter.
    if (p.maxDaysToSell > 0 && !refPrices.has(typeId)) {
      skippedNoRef++;
      continue;
    }
    let buyPrice: number;
    let srcDepth: number;
    let topBid: number | null = null;
    if (p.buyMode === 'order') {
      // acquisition via YOUR buy order. The provisional cost uses the current
      // top bid; enrichment replaces it with the realistic historical fill
      // price (max of the two) and recomputes margins — a lowball bid on the
      // books never survives as a fantasy margin.
      if (!srcBuySide) continue;
      topBid = srcBuySide.max;
      buyPrice = srcBuySide.max * (1 + brokerSrc);
      srcDepth = Number.MAX_SAFE_INTEGER;
    } else {
      if (!src) continue;
      buyPrice = src.percentile > 0 ? src.percentile : src.min;
      srcDepth = Math.max(1, Math.floor(src.volume * DEPTH_FRACTION));
    }

    for (const dest of p.dests) {
      const dAgg = destBooks.get(dest.id)?.get(typeId);
      const dSell = usableSell(dAgg);
      const dBuy = usableBuy(dAgg);
      if (!dSell && !dBuy) continue;

      const ref = refPrices.get(typeId);
      // a sell-order exit is speculative: cap it at the global norm so ranking
      // reflects what a buyer would plausibly pay (quick exits into real buy
      // orders are executable now, so they are never capped)
      const rawPatientSell = dSell ? dSell.min : null;
      let flagDestAboveNorm = false;
      let patientSell = rawPatientSell;
      if (patientSell !== null && ref && patientSell > DEST_ABOVE_NORM * ref) {
        patientSell = DEST_ABOVE_NORM * ref;
        flagDestAboveNorm = true;
      }
      const patientNet =
        patientSell !== null ? patientSell * (1 - taxByDest.get(dest.id)! - brokerByDest.get(dest.id)!) : null;
      const patientMargin = patientNet !== null ? (patientNet - buyPrice) / buyPrice : null;

      const quickSell = dBuy ? (dBuy.percentile > 0 ? dBuy.percentile : dBuy.max) : null;
      const quickNet = quickSell !== null ? quickSell * (1 - taxByDest.get(dest.id)!) : null;
      const quickMargin = quickNet !== null ? (quickNet - buyPrice) / buyPrice : null;

      const flagSrcBelowNorm =
        p.buyMode === 'instant' && Boolean(ref && buyPrice < SRC_BELOW_NORM * ref);

      // margin used for the filter/ranking follows the chosen exit mode
      const modeMargin =
        p.sellMode === 'order'
          ? patientMargin
          : p.sellMode === 'instant'
            ? quickMargin
            : Math.max(patientMargin ?? -Infinity, quickMargin ?? -Infinity);
      if (modeMargin === null || modeMargin === -Infinity || modeMargin * 100 < p.minMarginPct)
        continue;

      const inHub = dest.id === p.source.id;
      if (!inHub && item.volume > p.cargoM3) continue;
      let units = Math.min(
        inHub ? Number.MAX_SAFE_INTEGER : Math.floor(p.cargoM3 / item.volume),
        srcDepth,
      );
      if (p.budgetISK && p.budgetISK > 0) {
        units = Math.min(units, Math.floor(p.budgetISK / buyPrice));
      }
      // NOTHING MAY LEAVE THIS LOOP STILL HOLDING MAX_SAFE_INTEGER. Station
      // trading (dest === source) lifts the cargo cap and buy-order mode lifts
      // the book-depth cap; with no budget and no sell-window they used to
      // cancel out and `profitPerTrip` came out as perUnit × 9.0e15. Fall back
      // to what the destination's standing buy book could actually absorb.
      if (units > UNSIZED_UNIT_CAP) {
        units = Math.max(1, Math.min(UNSIZED_UNIT_CAP, Math.floor((dBuy?.volume ?? 0) * DEPTH_FRACTION)));
      }
      if (units < 1) continue;

      const profitPerUnit =
        p.sellMode === 'instant'
          ? (quickNet ?? buyPrice) - buyPrice
          : patientNet !== null
            ? patientNet - buyPrice
            : (quickNet ?? buyPrice) - buyPrice;
      // shortlist rank: cap the tradeable units at what the destination's standing
      // buy book could absorb — a free liquidity proxy that keeps big-ticket
      // dead-market items from crowding out fast movers before history enrichment
      const destDemand = Math.max(1, Math.floor((dBuy?.volume ?? 0) * DEPTH_FRACTION));
      const rankScore = profitPerUnit * Math.min(units, destDemand);
      rows.push({
        rankScore,
        typeId,
        name: item.name,
        itemVolume: item.volume,
        destId: dest.id,
        destName: dest.name,
        buyPrice,
        patientMargin,
        patientSell,
        quickMargin,
        quickSell,
        unitsPerTrip: units,
        profitPerTrip: profitPerUnit * units,
        profitPerM3: profitPerUnit / item.volume,
        daysToSell: null,
        volWindows: null,
        maxSold: null,
        fillPerDay: null,
        topBid,
        estBidFill: null,
        flagLowBid: false,
        profitPerDay: 0,
        srcDepth,
        dailyVolDest: null,
        trendPct: null,
        crowd7: null,
        crowd30: null,
        flagDestAboveNorm,
        flagSrcBelowNorm,
      });
    }
  }

  rows.sort((a, b) => b.rankScore - a.rankScore);

  // deep mode enriches everything (day-cached history stats keep this cheap);
  // fast mode uses a diversity-capped shortlist
  let top: TradeRow[];
  if (p.depth === 'deep') {
    top = rows;
  } else {
    const perItem = new Map<number, number>();
    top = [];
    for (const row of rows) {
      if (top.length >= FAST_ENRICH_LIMIT) break;
      const seen = perItem.get(row.typeId) ?? 0;
      if (seen >= DESTS_PER_ITEM) continue;
      perItem.set(row.typeId, seen + 1);
      top.push(row);
    }
  }

  // stage 2: enrich with destination history — one call per (region, item),
  // shared across destinations in the same region and cached for the UTC day
  const destById = new Map(p.dests.map((d) => [d.id, d]));
  let enriched = 0;
  const queue = [...top];
  async function worker() {
    for (;;) {
      const row = queue.shift();
      if (!row) return;
      const dest = destById.get(row.destId)!;
      let dStats = null;
      try {
        dStats = await statsFor(dest.regionId, row.typeId);
      } catch {
        // treat as unknown liquidity; the filter below handles it
      }
      // a market that trades a couple of days a month isn't a market
      if (dStats && dStats.activeDays30 < MIN_ACTIVE_DAYS) dStats = null;

      // THE PRICE YOU CAN GET IS WHAT BUYERS ACTUALLY PAY. If the destination
      // ask (even sanity-capped) sits above recent prints, selling means selling
      // at print level — a lone 13.9m listing over 1.1m prints is not a 13.9m
      // (nor a "capped 2.2m") opportunity. Learned from a real near-loss.
      if (dStats && row.patientSell !== null) {
        const printCeiling = Math.max(dStats.avg7, dStats.median90) * PRINT_HEADROOM;
        if (row.patientSell > printCeiling) {
          row.patientSell = printCeiling;
          row.flagDestAboveNorm = true;
          const brokerDest = brokerByDest.get(row.destId)!;
          const taxDest = taxByDest.get(row.destId)!;
          row.patientMargin =
            (row.patientSell * (1 - taxDest - brokerDest) - row.buyPrice) / row.buyPrice;
          if (p.buyMode !== 'order') {
            const perUnit =
              p.sellMode === 'instant'
                ? (row.quickSell ?? 0) * (1 - taxDest) - row.buyPrice
                : row.patientSell * (1 - taxDest - brokerDest) - row.buyPrice;
            row.profitPerTrip = perUnit * row.unitsPerTrip;
            row.profitPerM3 = perUnit / row.itemVolume;
            const mm =
              p.sellMode === 'order'
                ? row.patientMargin
                : p.sellMode === 'instant'
                  ? row.quickMargin
                  : Math.max(row.patientMargin ?? -Infinity, row.quickMargin ?? -Infinity);
            if (mm === null || mm === -Infinity || mm * 100 < p.minMarginPct) {
              row.unitsPerTrip = 0;
            }
          }
        }
      }
      if (p.buyMode !== 'order' && row.unitsPerTrip < 1) {
        enriched++;
        continue;
      }

      // buy-order mode: replace the provisional top-bid cost with the realistic
      // historical fill price and recompute everything honestly
      if (p.buyMode === 'order') {
        let sStats = null;
        try {
          sStats = await statsFor(p.source.regionId, row.typeId);
        } catch {
          // no source history → no fill estimate
        }
        if (sStats && sStats.dailyVol14 > 0 && sStats.estBidFill > 0) {
          row.fillPerDay = sStats.dailyVol14 * sStats.bidShare;
          row.estBidFill = sStats.estBidFill;
          // you pay what sellers actually accept, not today's lowball top bid
          const realisticBid = Math.max(row.topBid ?? 0, sStats.estBidFill);
          row.flagLowBid = (row.topBid ?? 0) < sStats.estBidFill * 0.9;
          const brokerDest = brokerByDest.get(row.destId)!;
          const taxDest = taxByDest.get(row.destId)!;
          row.buyPrice = realisticBid * (1 + brokerSrc);
          row.patientMargin =
            row.patientSell !== null
              ? (row.patientSell * (1 - taxDest - brokerDest) - row.buyPrice) / row.buyPrice
              : null;
          row.quickMargin =
            row.quickSell !== null
              ? (row.quickSell * (1 - taxDest) - row.buyPrice) / row.buyPrice
              : null;
          const perUnit =
            p.sellMode === 'instant'
              ? (row.quickSell ?? 0) * (1 - taxDest) - row.buyPrice
              : row.patientSell !== null
                ? row.patientSell * (1 - taxDest - brokerDest) - row.buyPrice
                : (row.quickSell ?? 0) * (1 - taxDest) - row.buyPrice;
          // size units so filling AND selling both fit inside the window:
          // units × (1/fillRate + 1/sellRate) ≤ window
          if (p.maxDaysToSell > 0 && row.fillPerDay > 0) {
            const dVol = dStats && dStats.dailyVol14 > 0 ? dStats.dailyVol14 : null;
            const daysPerUnit = 1 / row.fillPerDay + (dVol ? 1 / dVol : 0);
            const fillable = Math.floor(p.maxDaysToSell / daysPerUnit);
            row.unitsPerTrip = Math.min(row.unitsPerTrip, Math.max(0, fillable));
          }
          if (p.budgetISK && p.budgetISK > 0) {
            row.unitsPerTrip = Math.min(row.unitsPerTrip, Math.floor(p.budgetISK / row.buyPrice));
          }
          row.profitPerTrip = perUnit * row.unitsPerTrip;
          row.profitPerM3 = perUnit / row.itemVolume;
          // margin re-check at the realistic bid
          const modeMargin =
            p.sellMode === 'order'
              ? row.patientMargin
              : p.sellMode === 'instant'
                ? row.quickMargin
                : Math.max(row.patientMargin ?? -Infinity, row.quickMargin ?? -Infinity);
          if (modeMargin === null || (modeMargin as number) * 100 < p.minMarginPct) {
            row.unitsPerTrip = 0;
          }
        } else {
          row.unitsPerTrip = 0; // can't estimate fills → not actionable
        }
        if (row.unitsPerTrip < 1) {
          enriched++;
          continue;
        }
      }
      if (dStats && dStats.dailyVol14 > 0) {
        row.dailyVolDest = dStats.dailyVol14;
        row.volWindows = dStats.volWindows;
        row.maxSold = dStats.maxSold;
        row.trendPct = dStats.trendPct;
        row.crowd7 = dStats.crowd7;
        row.crowd30 = dStats.crowd30;
        if (row.patientSell !== null && row.patientSell > DEST_ABOVE_NORM * dStats.median90) {
          row.flagDestAboveNorm = true;
        }
        // NO SOURCE CHECK AGAINST THE DESTINATION'S MEDIAN. It used to read
        //     row.buyPrice < SRC_BELOW_NORM * dStats.median90
        // which is the DEFINITION of a profitable haul — buying below what the
        // destination trades at. Every route with >54% gross margin got tagged
        // "possibly a one-off dump", and "hide unsustainable" then filtered out
        // exactly the best trades. The honest source-side check is against the
        // SOURCE's own norm and lives above (global average) and below (buy-order
        // mode, source region history).
        // position sizing: never buy more than the destination absorbs within
        // the window — a cargo-load of skillbooks becomes "2 days' worth" instead
        // of a filtered-out row
        if (p.maxDaysToSell > 0) {
          const sellCap = Math.max(1, Math.floor(dStats.dailyVol14 * p.maxDaysToSell));
          if (sellCap < row.unitsPerTrip) {
            const perUnit = row.profitPerTrip / row.unitsPerTrip;
            row.unitsPerTrip = sellCap;
            row.profitPerTrip = perUnit * sellCap;
          }
        }
        // buy-order mode: the cycle includes waiting for your bid to fill
        const acquireDays = row.fillPerDay ? row.unitsPerTrip / row.fillPerDay : 0;
        row.daysToSell = row.unitsPerTrip / dStats.dailyVol14 + acquireDays;
        row.profitPerDay = row.profitPerTrip / Math.max(row.daysToSell, 1);
      }
      enriched++;
      if (enriched % 25 === 0 || enriched === top.length) {
        p.onProgress?.(`Checking liquidity & trends… ${enriched}/${top.length}`);
      }
    }
  }
  await Promise.all(Array.from({ length: ENRICH_CONCURRENCY }, () => worker()));
  flushStatsCache();

  // cycle time (fills + selling) is measured honestly, so the user's window
  // applies directly — no fudge factors
  const filtered =
    p.maxDaysToSell > 0
      ? top.filter(
          (r) => r.unitsPerTrip >= 1 && r.daysToSell !== null && r.daysToSell <= p.maxDaysToSell,
        )
      : top.filter((r) => r.unitsPerTrip >= 1);
  // "profitable AND sells quickly" is the headline metric
  filtered.sort((a, b) => b.profitPerDay - a.profitPerDay);
  console.debug(
    `[finder] ${rows.length} candidates (${skippedNoRef} skipped: no global trade), ` +
      `${top.length} enriched (${p.depth}), ${filtered.length} pass ${p.maxDaysToSell || '∞'}d sizing`,
  );
  p.onProgress?.('');
  return filtered.slice(0, RESULT_LIMIT);
}

// ---------- mistake finder ----------

export interface MistakeRow {
  typeId: number;
  name: string;
  kind: 'crossed' | 'cheap-sell' | 'rich-buy';
  /** the suspicious order's price */
  price: number;
  /** reference: the opposing side (crossed) or CCP global average */
  refPrice: number;
  /** deviation of price from refPrice, signed fraction */
  devPct: number;
  /** units on the suspicious side (crossed: executable flip units) */
  depth: number;
  /** crossed books: net ISK from the verified executable overlap, after YOUR tax */
  estProfit: number | null;
  /** crossed: largest min-quantity condition among the buy orders used (1 = none) */
  minVolume: number;
}

export interface MistakeParams {
  hub: Hub;
  typeIds: number[];
  /** ignore items too big to haul (biggest owned ship / manual override) */
  maxItemM3: number;
  settings: Settings;
  onProgress?: (msg: string) => void;
}

interface EsiOrder {
  type_id: number;
  location_id: number;
  system_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  min_volume: number;
  range: string;
}

/**
 * Verify a crossed-book candidate against the LIVE order book (ESI, ~5 min
 * fresh vs ~30 min aggregates). Walks cheapest sells into richest eligible
 * buys, respecting buy-order ranges and min-quantity conditions — the two
 * things that make stale "crossed books" lose money in practice.
 */
async function verifyCrossed(
  hub: Hub,
  typeId: number,
  tax: number,
): Promise<{ qty: number; profit: number; sellMin: number; buyMax: number; minVolume: number } | null> {
  const res = await esiFetch(
    `${ESI_BASE}/markets/${hub.regionId}/orders/?type_id=${typeId}&order_type=all`,
  );
  if (!res.ok) return null;
  const orders: EsiOrder[] = await res.json();
  const stationId = hub.kind === 'station' ? hub.locationId : null;
  const systemId = stationId ? getStation(stationId)?.systemId : hub.kind === 'system' ? hub.locationId : null;

  const sells = orders
    .filter((o) => !o.is_buy_order && (stationId ? o.location_id === stationId : o.system_id === systemId))
    .sort((a, b) => a.price - b.price)
    .map((o) => ({ price: o.price, qty: o.volume_remain }));
  // a buy order can be hit only if its range covers our station's system
  const buys = orders
    .filter((o) => {
      if (!o.is_buy_order) return false;
      if (o.range === 'region') return true;
      if (systemId && o.system_id === systemId) return true; // station/system/short ranges in same system
      const jumps = Number(o.range);
      if (!Number.isFinite(jumps) || !systemId) return false;
      const area = systemsWithin(o.system_id, jumps);
      return area.has(systemId);
    })
    .sort((a, b) => b.price - a.price);

  let qty = 0;
  let profit = 0;
  let minVolume = 1;
  let si = 0;
  let sellRemain = sells[si]?.qty ?? 0;
  for (const b of buys) {
    // tentatively match this buy order against the remaining profitable sells;
    // commit only if the matched amount satisfies its min-quantity condition
    let tSi = si;
    let tSellRemain = sellRemain;
    let buyRemain = b.volume_remain;
    let tQty = 0;
    let tProfit = 0;
    while (buyRemain > 0 && tSi < sells.length) {
      const sellPrice = sells[tSi].price;
      const net = b.price * (1 - tax) - sellPrice;
      if (net <= 0) break;
      const take = Math.min(buyRemain, tSellRemain);
      tQty += take;
      tProfit += take * net;
      buyRemain -= take;
      tSellRemain -= take;
      if (tSellRemain === 0) {
        tSi++;
        tSellRemain = sells[tSi]?.qty ?? 0;
      }
    }
    if (tQty < 1 || tQty < b.min_volume) continue; // couldn't meet the order's minimum
    qty += tQty;
    profit += tProfit;
    if (b.min_volume > minVolume) minVolume = b.min_volume;
    si = tSi;
    sellRemain = tSellRemain;
    if (si >= sells.length) break;
  }
  if (qty < 1 || profit <= 0) return null;
  return { qty, profit, sellMin: sells[0]?.price ?? 0, buyMax: buys[0]?.price ?? 0, minVolume };
}

export async function findMistakes(p: MistakeParams): Promise<MistakeRow[]> {
  const tax = salesTaxForHub(p.hub, p.settings); // the hub trader's Accounting
  p.onProgress?.('Fetching global reference prices…');
  const refPrices = await fetchMarketPrices();
  p.onProgress?.(`Fetching ${p.hub.name} prices…`);
  const book = await fetchAggregates(p.hub, p.typeIds, false, (d, t) =>
    p.onProgress?.(`Fetching ${p.hub.name} prices… ${d}/${t}`),
  );

  const rows: MistakeRow[] = [];
  const crossedCandidates: number[] = [];
  for (const [typeId, agg] of book) {
    const item = getType(typeId);
    // skip anything you couldn't physically haul (a packaged dreadnought is
    // 1.3M m³ — no freighter carries it, so it's not an actionable mistake)
    if (!item || item.volume <= 0 || item.volume > p.maxItemM3) continue;
    const sell = usableSell(agg);
    const buy = usableBuy(agg);
    const ref = refPrices.get(typeId);

    if (sell && buy && buy.max > sell.min && buy.max * (1 - tax) - sell.min > 0) {
      crossedCandidates.push(typeId);
      continue;
    }
    if (!ref) continue;
    if (sell && sell.min < CHEAP_SELL_FACTOR * ref) {
      rows.push({
        typeId,
        name: item.name,
        kind: 'cheap-sell',
        price: sell.min,
        refPrice: ref,
        devPct: sell.min / ref - 1,
        depth: sell.orderCount,
        estProfit: null,
        minVolume: 1,
      });
    }
    if (buy && buy.max > RICH_BUY_FACTOR * ref) {
      rows.push({
        typeId,
        name: item.name,
        kind: 'rich-buy',
        price: buy.max,
        refPrice: ref,
        devPct: buy.max / ref - 1,
        depth: buy.orderCount,
        estProfit: null,
        minVolume: 1,
      });
    }
  }

  // verify each crossed candidate against the live book before showing it
  let verified = 0;
  const queue = [...crossedCandidates];
  async function verifyWorker() {
    for (;;) {
      const typeId = queue.shift();
      if (typeId === undefined) return;
      try {
        const v = await verifyCrossed(p.hub, typeId, tax);
        if (v) {
          rows.push({
            typeId,
            name: getType(typeId)!.name,
            kind: 'crossed',
            price: v.sellMin,
            refPrice: v.buyMax,
            devPct: (v.sellMin - v.buyMax) / v.buyMax,
            depth: v.qty,
            estProfit: v.profit,
            minVolume: v.minVolume,
          });
        }
      } catch {
        // treat as not verifiable → drop
      }
      verified++;
      p.onProgress?.(`Verifying crossed books against the live order book… ${verified}/${crossedCandidates.length}`);
    }
  }
  await Promise.all(Array.from({ length: 6 }, verifyWorker));

  rows.sort((a, b) => {
    // crossed books first (real, immediate); then by deviation magnitude × value
    if ((a.kind === 'crossed') !== (b.kind === 'crossed')) return a.kind === 'crossed' ? -1 : 1;
    if (a.kind === 'crossed' && b.kind === 'crossed') {
      return (b.estProfit ?? 0) - (a.estProfit ?? 0);
    }
    return Math.abs(b.devPct) * b.refPrice - Math.abs(a.devPct) * a.refPrice;
  });
  p.onProgress?.('');
  return rows.slice(0, MISTAKE_ROW_CAP);
}
