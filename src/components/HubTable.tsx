import { useEffect, useState } from 'react';
import { useApp, useHubs } from '../lib/store';
import { usePrices } from '../lib/priceStore';
import { stationTradeMargin } from '../lib/fees';
import { brokerRateForHub } from '../lib/broker';
import { itemTradeFlow } from '../lib/radar';
import { useSort } from '../lib/useSort';
import { isk, iskShort, int, pct } from '../lib/format';
import Tip from './Tip';
import type { Hub, SideAggregate, TypeAggregate } from '../lib/types';

/** measured units/day per side from the radar; null = region not watched */
type Flow = { askUnits: number; bidUnits: number; days: number } | null;

interface Row {
  hub: Hub;
  agg: TypeAggregate | undefined;
  sell: SideAggregate | null;
  buy: SideAggregate | null;
  spread: number | null;
  marginPct: number | null;
  vsJita: number | null;
  flow: Flow | undefined;
}

type ColKey = 'hub' | 'sell' | 'sell5' | 'buy' | 'spread' | 'margin' | 'vsJita' | 'sellVol' | 'buyVol' | 'fask' | 'fbid';

const flowNum = (v: number) => (v >= 10 ? int(v) : v.toFixed(1));

/**
 * The core view: one row per hub for the selected item.
 * Sell = lowest sell order, Sell 5% = 5th-percentile sell (scam-resistant),
 * Buy = highest buy order. Best sell/buy highlighted. "vs Jita" compares
 * the hub's sell price against Jita's. Headers sort.
 */
export default function HubTable({ typeId }: { typeId: number }) {
  const hubs = useHubs();
  const book = usePrices((s) => s.book);
  const settings = useApp((s) => s.settings);
  // MEASURED trade flow per region from the radar (executed trades, not
  // listings) — the "how many actually move per day" the aggregates can't say
  const [flows, setFlows] = useState<Map<number, Flow>>(new Map());
  const regionKey = hubs.map((h) => h.regionId).join(',');
  useEffect(() => {
    let alive = true;
    // CLEAR FIRST. This component is not remounted when the Item Explorer
    // switches items (same position, no key), so the previous item's
    // Bought/day and Sold-to-bids numbers stayed on screen — under the new
    // item's name, with a confident "measured over N days" tooltip — until
    // the async reload landed. Executed-trade figures attributed to the
    // wrong item is precisely what rule 1 exists to prevent.
    setFlows(new Map());
    const regions = [...new Set(regionKey.split(',').map(Number))];
    void Promise.all(regions.map(async (r) => [r, await itemTradeFlow(r, typeId)] as const)).then(
      (entries) => {
        if (alive) setFlows(new Map(entries));
      },
    );
    return () => {
      alive = false;
    };
  }, [typeId, regionKey]);

  const base = hubs.map((hub) => {
    const agg = book[hub.id]?.[typeId];
    const sell = agg && agg.sell.orderCount > 0 ? agg.sell : null;
    const buy = agg && agg.buy.orderCount > 0 ? agg.buy : null;
    return { hub, agg, sell, buy };
  });
  const jitaSell = base.find((r) => r.hub.id === 'jita')?.sell?.min;
  const rows: Row[] = base.map(({ hub, agg, sell, buy }) => ({
    hub,
    agg,
    sell,
    buy,
    spread: sell && buy ? sell.min - buy.max : null,
    marginPct:
      sell && buy
        ? stationTradeMargin(buy.max, sell.min, settings, brokerRateForHub(hub, settings)).marginPct
        : null,
    vsJita: sell && jitaSell && hub.id !== 'jita' ? (sell.min - jitaSell) / jitaSell : null,
    flow: flows.get(hub.regionId),
  }));

  const bestSell = Math.min(...rows.filter((r) => r.sell).map((r) => r.sell!.min));
  const bestBuy = Math.max(...rows.filter((r) => r.buy).map((r) => r.buy!.max));

  const { sorted, clickHeader, indicator } = useSort<Row, ColKey>(rows, {
    hub: (r) => r.hub.name,
    sell: (r) => r.sell?.min ?? null,
    sell5: (r) => r.sell?.percentile ?? null,
    buy: (r) => r.buy?.max ?? null,
    spread: (r) => r.spread,
    margin: (r) => r.marginPct,
    vsJita: (r) => r.vsJita,
    sellVol: (r) => r.sell?.volume ?? null,
    buyVol: (r) => r.buy?.volume ?? null,
    fask: (r) => r.flow?.askUnits ?? null,
    fbid: (r) => r.flow?.bidUnits ?? null,
  });

  return (
    <div className="panel">
      <h2>
        Hub comparison
        <span className="sub">sell = lowest ask · buy = highest bid · click headers to sort</span>
      </h2>
      <table className="data">
        <thead>
          <tr>
            <th className="sortable" onClick={() => clickHeader('hub')}><Tip tip="The trade hub (or your custom system/region) these prices come from.">Hub</Tip>{indicator('hub')}</th>
            <th className="sortable" onClick={() => clickHeader('sell')}><Tip tip="The cheapest price anyone is selling for here — what YOU would pay to buy one right now.">Sell</Tip>{indicator('sell')}</th>
            <th className="sortable" onClick={() => clickHeader('sell5')}><Tip tip="Average price of the cheapest 5% of sell volume. More trustworthy than the single lowest listing, which can be a 1-unit bait order.">Sell 5%</Tip>{indicator('sell5')}</th>
            <th className="sortable" onClick={() => clickHeader('buy')}><Tip tip="The highest standing buy order — what YOU would receive per unit if you sold instantly right now.">Buy</Tip>{indicator('buy')}</th>
            <th className="sortable" onClick={() => clickHeader('spread')}><Tip tip="Gap between the cheapest sell and the highest buy. A wide spread means room for station traders.">Spread</Tip>{indicator('spread')}</th>
            <th className="sortable" onClick={() => clickHeader('margin')}><Tip tip="Station-trading return at this hub: place a buy order at the top price, resell at the lowest sell, minus your broker fees and tax. Positive = flipping is profitable here.">Margin</Tip>{indicator('margin')}</th>
            <th className="sortable" onClick={() => clickHeader('vsJita')}><Tip tip="How this hub's cheapest sell compares to Jita's. +10% means it's 10% more expensive here than in Jita.">vs Jita</Tip>{indicator('vsJita')}</th>
            <th className="sortable" onClick={() => clickHeader('sellVol')}><Tip tip="Total units LISTED for sale here — supply sitting on the books, not trades.">Sell vol</Tip>{indicator('sellVol')}</th>
            <th className="sortable" onClick={() => clickHeader('buyVol')}><Tip tip="Total units WANTED by standing buy orders — demand waiting on the books, not trades.">Buy vol</Tip>{indicator('buyVol')}</th>
            <th className="sortable" onClick={() => clickHeader('fask')}><Tip tip="Units per day actually BOUGHT from sell orders here — executed trades, measured by your market radar from full-book diffs every ~30 min (7-day average, normalized to observed time). This is real demand at the asks; everything left of here is just listings. '—' = the radar doesn't watch this region (it watches your trading regions).">Bought/day</Tip>{indicator('fask')}</th>
            <th className="sortable" onClick={() => clickHeader('fbid')}><Tip tip="Units per day actually SOLD into buy orders here — executed trades hitting the bids, measured the same way. Together with Bought/day this is the two-sided flow that makes or breaks station trading: both sides must actually move.">Sold to bids/day</Tip>{indicator('fbid')}</th>
            <th><Tip tip="Number of sell / buy orders on the books here — more orders = livelier market.">Orders</Tip></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map(({ hub, agg, sell, buy, spread, marginPct, vsJita, flow }) => (
            <tr key={hub.id}>
              <td className="hub-name">
                {hub.name}
                {!hub.builtin && <span className="hub-kind"> · system</span>}
              </td>
              <td className={sell && sell.min === bestSell ? 'best-sell' : ''}>
                {sell ? isk(sell.min) : <span className="dim">no orders</span>}
              </td>
              <td className="dim">{sell ? isk(sell.percentile) : '—'}</td>
              <td className={buy && buy.max === bestBuy ? 'best-buy' : ''}>
                {buy ? isk(buy.max) : <span className="dim">no orders</span>}
              </td>
              <td>{spread !== null ? iskShort(spread) : '—'}</td>
              <td className={marginPct !== null ? (marginPct > 0 ? 'pos' : 'neg') : ''}>
                {marginPct !== null ? pct(marginPct) : '—'}
              </td>
              <td className={vsJita !== null ? (vsJita > 0 ? 'pos' : 'neg') : 'dim'}>
                {vsJita !== null ? (vsJita > 0 ? '+' : '') + pct(vsJita) : '—'}
              </td>
              <td className="dim">{sell ? int(sell.volume) : '—'}</td>
              <td className="dim">{buy ? int(buy.volume) : '—'}</td>
              <td>
                {flow ? (
                  <span title={`Measured over ${flow.days} day(s) of radar coverage — sharpens daily.`}>{flowNum(flow.askUnits)}</span>
                ) : (
                  <span className="dim" title={flow === null ? "The radar doesn't watch this region — it snapshots your trading regions (duty hubs) every ~30 min." : 'Loading radar data…'}>—</span>
                )}
              </td>
              <td>
                {flow ? (
                  <span title={`Measured over ${flow.days} day(s) of radar coverage — sharpens daily.`}>{flowNum(flow.bidUnits)}</span>
                ) : (
                  <span className="dim" title={flow === null ? "The radar doesn't watch this region — it snapshots your trading regions (duty hubs) every ~30 min." : 'Loading radar data…'}>—</span>
                )}
              </td>
              <td className="dim">
                {agg ? `${int(agg.sell.orderCount)}s / ${int(agg.buy.orderCount)}b` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
