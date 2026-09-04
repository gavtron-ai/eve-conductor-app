import { useEffect, useRef, useState } from 'react';
import { ESI_BASE } from '../lib/constants';
import { esiFetch } from '../lib/esiRate';
import { useAuth, charLabel, ownerLabel } from '../lib/auth';
import { getTeamOrders, getTeamOrderHistory, lastEsiExpiryMs, openMarketWindow, openMarketWindowEverywhere, type MyOrder } from '../lib/esiChar';
import { recordOrderEvents, ledger, everOwnedOrderIds } from '../lib/ledger';
import { useFreshness, countdown } from '../lib/freshness';
import { useApp } from '../lib/store';
import { getType } from '../lib/typedb';
import { getStation } from '../lib/mapdata';
import { useSort } from '../lib/useSort';
import { isk, iskShort, int, pct } from '../lib/format';
import { tickPriceText } from '../lib/priceTick';
import { computeHeat, type Heat } from '../lib/heat';
import HeatChip from './HeatChip';
import { computeSchedules, ADVICE_WINDOW_MS, type SystemSchedule } from '../lib/schedule';
import { adviceFor, fillFrac } from '../lib/orderAdvice';
import { loadTrendEvents, buyOrderReaches } from '../lib/trends';
import { itemFlowStatsMany } from '../lib/radar';
import { useStock, unsoldCosts, primaryStockAction, fixItStock, type StockHolding, type StockAction } from '../lib/stock';
import { brokerRateForHub, salesTaxForHub } from '../lib/broker';
import { defenseModel } from '../lib/defense';
import { BUILTIN_HUBS } from '../lib/constants';

import Tip from './Tip';
import ItemDetailModal from './ItemDetailModal';
import OrderDetailModal from './OrderDetailModal';
import StockChip from './StockChip';
import { transitShipName } from '../lib/stock';

// PLEX bought with real cash and dumped for ISK is a wallet injection, not
// trading business — hide it here UNLESS the team has ever bought PLEX with
// ISK (then it's speculation stock like anything else)
const PLEX_TYPE_ID = 44992;

interface OrderRow {
  order: MyOrder;
  name: string;
  locationName: string;
  /** my CURRENT price — from the public book when visible there (fresher than
   * the character-orders endpoint, which lags ~20 min after modifications) */
  myPrice: number;
  /** true when the price came from the live book */
  priceLive: boolean;
  /** best competing price at MY station (live book), null = alone */
  stationBest: number | null;
  /** team-wide FIFO average cost of the CURRENT stack (unsold lots — what
   * was actually spent per unit on what we still have, listed + in stock);
   * null = no purchase on the books */
  paid: number | null;
  /** negative = beaten at my station */
  edge: number | null;
  /** SELL orders only: this price already nets less than the stock cost.
   * Carried on the row so the ACT column can see it — it used to exist only
   * as a chip in the Paid column, and the advice beside it happily said
   * "fix now" (i.e. reprice DOWN) on an order that was already losing money. */
  underwater: boolean;
  /** gross price that breaks even after tax; null when there is no cost basis */
  breakEven: number | null;
  daysLeft: number;
  /** reprice tempo of everyone ELSE's orders on my side of the book */
  heat: Heat | null;
  systemId: number;
}

type ColKey = 'name' | 'who' | 'side' | 'mine' | 'sbest' | 'paid' | 'edge' | 'advice' | 'prog' | 'left';


interface DoneRow {
  order: MyOrder;
  name: string;
  locationName: string;
  total: number;
  ageDays: number;
}

/** stock with NO sell order up — money asleep; gets its OWN table on top */
interface StockRowT {
  typeId: number;
  name: string;
  qty: number;
  holdings: StockHolding[];
  action: StockAction;
  /** where the pile(s) sit, e.g. "Amarr" or "<transit ship> @ Jita" */
  where: string;
  /** ledger avg unit cost — null for loot / pre-app stock */
  paid: number | null;
  /** qty × paid — null when no cost basis exists */
  value: number | null;
}

type StockCol = 'name' | 'who' | 'where' | 'qty' | 'paid' | 'value' | 'step';

const ACTION_EMOJI: Record<StockAction['key'], string> = {
  list: '📋', handoff: '🫳', haul: '🚚', unload: '🫳', hold: '📦',
};

type DoneCol = 'name' | 'who' | 'side' | 'loc' | 'price' | 'qty' | 'total' | 'age';


interface EsiOrder {
  order_id: number;
  location_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  issued: string;
  /** ESI sends both on every row; kept because BUY orders compete by RANGE,
   * not by station (see buyOrderReaches) */
  system_id?: number;
  range?: string;
}

export default function MyOrders() {
  const characters = useAuth((s) => s.characters);
  const hasChars = characters.length > 0;
  const excludedFromBooks = useApp((s) => s.excludedFromBooks);
  const settings = useApp((s) => s.settings);
  const stockByType = useStock((s) => s.byType);
  const [charFilter, setCharFilter] = useState<number | null>(null);
  const [rows, setRows] = useState<OrderRow[] | null>(null);
  const [doneRows, setDoneRows] = useState<DoneRow[]>([]);
  /** per-system act-schedules — shared source of truth with the Trends tab */
  const [schedules, setSchedules] = useState<Map<number, SystemSchedule>>(new Map());
  /** per-item radar flow (hour clock + ISK/day) for the window math */
  const [flowStats, setFlowStats] = useState<Map<number, { hours: number[]; fk7: number }>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [detailTypeId, setDetailTypeId] = useState<number | null>(null);
  const [orderDetail, setOrderDetail] = useState<MyOrder | null>(null);
  const [checkedAt, setCheckedAt] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  /** re-entrancy guard for refresh() — see the comment there */
  const busy = useRef(false);

  async function refresh() {
    // A REF, NOT THE `loading` STATE. The 1s interval below is created in an
    // effect keyed on [hasChars], so it captures the `refresh` closure from
    // that one render — where `loading` was false — and keeps seeing false
    // forever. The re-entrancy guard was therefore dead for every
    // interval-driven call; only the ⟳ Now button (which re-renders) ever saw
    // the live value. A ref is immune to that, because there is only one.
    if (busy.current || !hasChars) return;
    busy.current = true;
    setLoading(true);
    setError(null);
    try {
      const orders = await getTeamOrders(); // every team character's orders (parallel)
      const ordersExpiryMs = lastEsiExpiryMs();
      recordOrderEvents(orders); // feed the fee→order matcher
      // the act-schedule (same computation the Trends tab shows)
      void loadTrendEvents().then((ev) => setSchedules(computeSchedules(ev, ADVICE_WINDOW_MS)));
      // per-item fill clocks from the market radar — BATCHED per region (the
      // per-item lookup copies the whole 5-region summary each call)
      void (async () => {
        const byRegion = new Map<number, number[]>();
        for (const o of orders.filter((x) => !x.is_buy_order)) {
          const list = byRegion.get(o.region_id) ?? byRegion.set(o.region_id, []).get(o.region_id)!;
          if (!list.includes(o.type_id)) list.push(o.type_id);
        }
        const m = new Map<number, { hours: number[]; fk7: number }>();
        for (const [region, ids] of byRegion) {
          const fl = await itemFlowStatsMany(region, ids);
          for (const [t, f] of fl) if (f) m.set(t, f);
        }
        setFlowStats(m);
      })();

      // completed (sold-out) orders: runs CONCURRENTLY with the book fetches
      // below — history is supplementary, the open table never waits on it
      const historyP = (async () => {
        try {
          const hist = await getTeamOrderHistory();
          recordOrderEvents(hist); // history back-fills the fee→order matcher too
          setDoneRows(
            hist
              .filter((o) => o.volume_remain === 0)
              .map((o) => ({
                order: o,
                name: getType(o.type_id)?.name ?? `#${o.type_id}`,
                locationName:
                  getStation(o.location_id)?.name ?? `Structure …${String(o.location_id).slice(-4)}`,
                total: o.price * o.volume_total,
                ageDays: (Date.now() - new Date(o.issued).getTime()) / 86_400_000,
              })),
          );
        } catch {
          // history is supplementary — the open-orders table must not fail on it
        }
      })();

      // LIVE order books per (region, item) — fetched with a small worker
      // pool (they used to load one at a time; ~20 items = ~20 sequential
      // round trips was THE "My Orders is slow" cost). Track the soonest
      // server expiry so the next auto-refresh lands right when data exists.
      const books = new Map<string, EsiOrder[]>();
      let minBookExpiry = Infinity;
      const wanted: { key: string; url: string }[] = [];
      for (const o of orders) {
        const key = `${o.region_id}:${o.type_id}:${o.is_buy_order ? 'b' : 's'}`;
        if (wanted.some((w) => w.key === key)) continue;
        wanted.push({
          key,
          url: `${ESI_BASE}/markets/${o.region_id}/orders/?type_id=${o.type_id}&order_type=${o.is_buy_order ? 'buy' : 'sell'}`,
        });
      }
      const queue = [...wanted];
      async function bookWorker() {
        for (;;) {
          const w = queue.shift();
          if (!w) return;
          try {
            const res = await esiFetch(w.url);
            const exp = Date.parse(res.headers.get('expires') ?? '');
            const srv = Date.parse(res.headers.get('date') ?? '');
            if (!Number.isNaN(exp) && !Number.isNaN(srv)) {
              minBookExpiry = Math.min(minBookExpiry, exp - srv);
            }
            books.set(w.key, res.ok ? ((await res.json()) as EsiOrder[]) : []);
          } catch {
            books.set(w.key, []);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(6, wanted.length) }, bookWorker));
      await historyP;
      // ever-ours union: a fresh second order (char endpoint lags ~20 min) or
      // a logged-out character's orders must never read as rivals
      const myIds = new Set([...orders.map((o) => o.order_id), ...everOwnedOrderIds()]);

      const out: OrderRow[] = [];
      for (const o of orders) {
        const isBuy = o.is_buy_order === true;
        const fullBook = books.get(`${o.region_id}:${o.type_id}:${isBuy ? 'b' : 's'}`) ?? [];
        // my own order in the PUBLIC book carries my CURRENT price (~5 min
        // fresh); the character endpoint lags ~20 min after in-game edits and
        // caused false "beaten" statuses
        const bookMe = fullBook.find((c) => c.order_id === o.order_id);
        const myPrice = bookMe?.price ?? o.price;
        const book = fullBook.filter((c) => !myIds.has(c.order_id));
        // A BUY ORDER'S COMPETITION IS NOT ITS STATION. This screen used to
        // filter rivals with `location_id === o.location_id` for both sides,
        // so a region-range bid a few jumps out — which is taking the stock
        // you are bidding for — did not count as beating you. trends.ts and
        // scanner.ts both already did this correctly; only the ACT screen
        // did not, which is the worst place for it.
        const mySystem = getStation(o.location_id)?.systemId ?? 0;
        const atStation = isBuy
          ? book.filter((c) => buyOrderReaches(c, o.location_id, mySystem))
          : book.filter((c) => c.location_id === o.location_id);
        const best = (list: EsiOrder[]) =>
          list.length === 0 ? null : isBuy
            ? Math.max(...list.map((c) => c.price))
            : Math.min(...list.map((c) => c.price));
        const stationBest = best(atStation);
        const edge =
          stationBest !== null && stationBest > 0
            ? isBuy
              ? myPrice / stationBest - 1
              : stationBest / myPrice - 1
            : null;
        const issuedMs = new Date(o.issued).getTime();
        // cost basis + the tax THIS hub's trader actually pays, resolved once
        const paid = unsoldCosts().get(o.type_id)?.avgCost ?? null;
        // salesTaxForHub ACCEPTS null/undefined and falls back to the
        // settings rate — substituting 0 here threw that away, so an order
        // in any non-builtin region (a player structure, a nullsec market)
        // was tested for underwater at ZERO sales tax and read as profitable
        // when it was not. Pass the hub through, found or not.
        const hub = BUILTIN_HUBS.find((h) => h.regionId === o.region_id) ?? null;
        const hubTax = salesTaxForHub(hub, settings);
        out.push({
          order: o,
          name: getType(o.type_id)?.name ?? `#${o.type_id}`,
          locationName:
            getStation(o.location_id)?.name ?? `Structure …${String(o.location_id).slice(-4)}`,
          myPrice,
          priceLive: bookMe !== undefined,
          stationBest,
          paid,
          underwater: !isBuy && paid !== null && myPrice * (1 - hubTax) < paid,
          breakEven: paid === null ? null : paid / (1 - hubTax),
          edge,
          daysLeft: Math.max(0, o.duration - (Date.now() - issuedMs) / 86_400_000),
          // tempo of EVERYONE ELSE's orders on this side of the book at my
          // station — the team's own orders are excluded so your reprices
          // can't make the book look hot to yourself
          heat: computeHeat(
            fullBook.filter((c) =>
              (isBuy ? buyOrderReaches(c, o.location_id, mySystem) : c.location_id === o.location_id)
              && !myIds.has(c.order_id)),
            isBuy ? 'buy' : 'sell',
          ),
          systemId: getStation(o.location_id)?.systemId ?? 0,
        });
      }
      setRows(out);
      setCheckedAt(Date.now());
      const expiry = Math.min(
        Number.isFinite(minBookExpiry) ? minBookExpiry : Infinity,
        ordersExpiryMs > 0 ? ordersExpiryMs : Infinity,
      );
      useFreshness.getState().reportHeader('orders', Number.isFinite(expiry) ? expiry : 120_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // BACK OFF ON FAILURE, like every other collector in App.tsx. Without
      // this, a throw leaves freshness['orders'].nextAt where it was — and
      // the 1s tick above re-fires the moment it is already past.
      useFreshness.getState().fail('orders');
    } finally {
      busy.current = false;
      setLoading(false);
    }
  }

  // hangar ground truth for the "needs listing" rows (30-min TTL inside)
  useEffect(() => {
    void useStock.getState().ensureFresh();
  }, []);

  // self-scheduling: a 1s tick renders the countdown and fires the refresh the
  // moment the server's own expiry says new data exists
  const [, forceTick] = useState(0);
  const ordersFresh = useFreshness((s) => s.sources['orders']);
  useEffect(() => {
    if (!hasChars) return;
    void refresh();
    timer.current = setInterval(() => {
      forceTick((t) => t + 1);
      const next = useFreshness.getState().sources['orders']?.nextAt;
      if (next !== undefined && next !== null && Date.now() >= next) void refresh();
    }, 1000);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChars]);

  // orders for books-excluded items (PLEX-for-ISK etc.) are personal — hide them.
  // PLEX specifically: only shown when the team has ever BOUGHT PLEX with ISK
  // (speculation) — cash-injected PLEX dumps aren't trading business.
  const plexBoughtForIsk = ledger.tx.some((t) => t.isBuy && t.typeId === PLEX_TYPE_ID);
  const showOrder = (o: MyOrder) =>
    !excludedFromBooks.includes(o.type_id) &&
    (o.type_id !== PLEX_TYPE_ID || plexBoughtForIsk) &&
    (charFilter === null || o.ownerId === charFilter);
  const visibleRows = (rows ?? []).filter((r) => showOrder(r.order));
  const visibleDone = doneRows.filter((r) => showOrder(r.order));
  const {
    sorted: sortedDone,
    clickHeader: clickDone,
    indicator: indDone,
  } = useSort<DoneRow, DoneCol>(
    visibleDone,
    {
      name: (r) => r.name,
      who: (r) => ownerLabel(r.order.ownerId, r.order.ownerName),
      side: (r) => (r.order.is_buy_order ? 'buy' : 'sell'),
      loc: (r) => r.locationName,
      price: (r) => r.order.price,
      qty: (r) => r.order.volume_total,
      total: (r) => r.total,
      age: (r) => r.ageDays,
    },
    { key: 'age', dir: 'asc' },
  );
  const { sorted, clickHeader, indicator } = useSort<OrderRow, ColKey>(
    visibleRows,
    {
      name: (r) => r.name,
      who: (r) => ownerLabel(r.order.ownerId, r.order.ownerName),
      side: (r) => (r.order.is_buy_order ? 'buy' : 'sell'),
      advice: (r) => adviceFor(r, schedules.get(r.systemId), profitableHours(r)).rank,
      mine: (r) => r.myPrice,
      sbest: (r) => r.stationBest,
      paid: (r) => r.paid,
      edge: (r) => r.edge,
      prog: (r) => fillFrac(r.order),
      left: (r) => r.daysLeft,
    },
    { key: 'edge', dir: 'asc' },
  );

  // EVERYTHING the team holds as stock with NO sell order anywhere — its own
  // table above the orders. Membership is purely "is it stock?" (trader-duty
  // hangars + the ${transitShipName()} hold, business scope) — sale history and cost basis
  // don't gate it (loot / pre-app stock shows with paid "—").
  const stockRows: StockRowT[] = (() => {
    const openSell = new Set((rows ?? []).filter((r) => !r.order.is_buy_order).map((r) => r.order.type_id));
    const hubName = (h: StockHolding) =>
      BUILTIN_HUBS.find((b) => b.kind === 'station' && b.locationId === h.stationId)?.name ??
      (h.stationId !== undefined ? (getStation(h.stationId)?.name ?? 'structure').split(' ')[0] : 'in space');
    const out: StockRowT[] = [];
    for (const [tidStr, holdings] of Object.entries(stockByType)) {
      const tid = Number(tidStr);
      if (excludedFromBooks.includes(tid)) continue;
      if (tid === PLEX_TYPE_ID && !plexBoughtForIsk) continue;
      if (openSell.has(tid)) continue;
      const held = charFilter === null ? holdings : holdings.filter((h) => h.charId === charFilter);
      const qty = held.reduce((s, h) => s + h.qty, 0);
      if (qty <= 0) continue;
      const cost = unsoldCosts().get(tid);
      out.push({
        typeId: tid,
        name: getType(tid)?.name ?? `#${tid}`,
        qty,
        holdings: held,
        action: primaryStockAction(held),
        where: [...new Set(held.map((h) => (h.transit ? `${transitShipName()} @ ${hubName(h)}` : hubName(h))))].join(', '),
        paid: cost ? cost.avgCost : null,
        value: cost ? qty * cost.avgCost : null,
      });
    }
    return out;
  })();
  const {
    sorted: sortedStock,
    clickHeader: clickStock,
    indicator: indStock,
  } = useSort<StockRowT, StockCol>(
    stockRows,
    {
      name: (r) => r.name,
      who: (r) => [...new Set(r.holdings.map((h) => ownerLabel(h.charId)))].join(', '),
      where: (r) => r.where,
      qty: (r) => r.qty,
      paid: (r) => r.paid,
      value: (r) => r.value,
      step: (r) => r.action.key,
    },
    { key: 'value', dir: 'desc' },
  );

  /** hours where THIS order's expected captured profit beats one reprice fee
   * (item's own radar fill clock × the order's real margin; ~50% capture
   * assumption, stated in the tooltip). null → no radar data, fall back. */
  function profitableHours(r: OrderRow): number[] | null {
    if (r.order.is_buy_order) return null;
    const f = flowStats.get(r.order.type_id);
    if (!f) return null;
    const cost = unsoldCosts().get(r.order.type_id)?.avgCost;
    if (!cost || cost <= 0) return null;
    const hub = BUILTIN_HUBS.find((h) => h.regionId === r.order.region_id);
    if (!hub) return null;
    const tax = salesTaxForHub(hub, settings);
    const marginFrac = (r.myPrice * (1 - tax) - cost) / r.myPrice;
    if (marginFrac <= 0) return null; // underwater: window math is moot
    const fee = defenseModel().relistFeeRatio * brokerRateForHub(hub, settings) * r.myPrice * r.order.volume_remain;
    const total = f.hours.reduce((a, b) => a + b, 0);
    if (total <= 0 || fee <= 0) return null;
    const set: number[] = [];
    for (let h = 0; h < 24; h++) {
      const evIsk = f.fk7 * (f.hours[h] / total) * marginFrac * 0.5;
      if (evIsk > fee) set.push(h);
    }
    return set.length > 0 ? set : null;
  }

  async function openMarket(typeId: number, charId?: number) {
    await openMarketWindowEverywhere(typeId, charId).catch(() => {});
  }

  if (!hasChars) {
    return (
      <div className="panel">
        <h2>My orders</h2>
        <div className="empty">Log in with EVE (Settings → EVE login) to see your market orders.</div>
      </div>
    );
  }

  return (
    <>
      <div className="panel">
        <h2>
          <Tip tip={`Everything the team HOLDS that has no sell order up anywhere — idle capital, whether or not it has ever been sold before. Stock = trader-duty hangars (packaged items) + the ${transitShipName()} ship's hold; the Hauler's hangars and station containers are never counted. Every Next-step tag is clickable: it opens the market window in game on EVERY character that's online right now (close the spare window if one wasn't needed) and copies the one-tick undercut of the online trader's hub best ask — the hub you're actually listing at (the pile's recorded spot can lag ~30 min behind a haul). Falls back to the pile's hub when nobody is online.`}>Unlisted stock</Tip>
          <span className="sub">held but NOT on the market — earning nothing until listed</span>
        </h2>
        {sortedStock.length === 0 ? (
          <div className="empty">Nothing unlisted — everything the team holds is on the market (or assets haven't synced yet).</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => clickStock('name')}>Item{indStock('name')}</th>
                {characters.length > 1 && (
                  <th className="sortable" onClick={() => clickStock('who')}><Tip tip="Which team character holds it.">Held by</Tip>{indStock('who')}</th>
                )}
                <th className="sortable" onClick={() => clickStock('where')}><Tip tip={`Where the pile physically sits — a hub hangar, or loaded in the ${transitShipName()} ship.`}>Where</Tip>{indStock('where')}</th>
                <th className="sortable" onClick={() => clickStock('qty')}>Qty{indStock('qty')}</th>
                <th className="sortable" onClick={() => clickStock('paid')}><Tip tip="Ledger average unit cost of the unsold lots. '—' = no purchase on the books (loot / pre-app stock).">Paid/unit</Tip>{indStock('paid')}</th>
                <th className="sortable" onClick={() => clickStock('value')}><Tip tip="Quantity × paid average — capital asleep in this pile.">Value</Tip>{indStock('value')}</th>
                <th className="sortable" onClick={() => clickStock('step')}><Tip tip={`The pipeline's next step for where the pile sits: list it (at the selling hub) · give to Hauler (source-hub hangar) · haul (loaded in ${transitShipName()}) · hand to the hub trader (arrived, still in the ship). CLICK the tag to fix it: opens the market window on EVERY character that's online right now and copies the one-tick undercut at the online trader's hub — where the listing actually happens.`}>Next step</Tip>{indStock('step')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedStock.map((s) => (
                <tr key={`stock-${s.typeId}`}>
                  <td className="hub-name" title={s.holdings.map((h) => `${ownerLabel(h.charId)}: ${int(h.qty)}${h.transit ? ' (in the ${transitShipName()} ship)' : ''}`).join('\n')}>{s.name}</td>
                  {characters.length > 1 && (
                    <td className="dim">{[...new Set(s.holdings.map((h) => ownerLabel(h.charId)))].join(', ')}</td>
                  )}
                  <td className="dim">{s.where}</td>
                  <td>{int(s.qty)}</td>
                  <td className="dim">{s.paid !== null ? isk(s.paid) : '—'}</td>
                  <td>{s.value !== null ? iskShort(s.value) : <span className="dim">—</span>}</td>
                  <td>
                    <button className={`flag ${s.action.key === 'list' ? 'warn' : 'info'}`}
                      title={`${s.action.tip} Click to fix it: opens the market window in game on every character that's online right now and copies the one-tick undercut at the online trader's hub (where you're actually listing).`}
                      onClick={() => void fixItStock(s.typeId, s.holdings).catch(() => {})}>
                      {ACTION_EMOJI[s.action.key]} {s.action.label}
                    </button>
                  </td>
                  <td className="row-actions">
                    <button className="btn mini" title="Item details in a popup"
                      onClick={() => setDetailTypeId(s.typeId)}>
                      details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>
          My orders
          <span className="sub">
            statuses from the LIVE order book (auto-rechecked every 2 min; EVE serves it ~5 min
            fresh) · your own order list updates ~20 min on EVE's side · worst-first
          </span>
          <span className="panel-filter" style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
            {characters.length > 1 && (
              <select value={charFilter ?? 'all'} style={{ fontSize: 12 }}
                onChange={(e) => setCharFilter(e.target.value === 'all' ? null : Number(e.target.value))}>
                <option value="all">Whole team</option>
                {characters.map((c) => (
                  <option key={c.characterId} value={c.characterId}>{charLabel(c)}</option>
                ))}
              </select>
            )}
            <span className="hint" style={{ margin: 0 }}
              title="The next update fires automatically the moment EVE's servers say new data exists (from each response's own expiry header) — no clicking needed.">
              {loading
                ? 'updating…'
                : ordersFresh?.nextAt
                  ? `next update in ${countdown(ordersFresh.nextAt)}`
                  : 'analyzing refresh timing…'}
              {checkedAt ? ` · last pull ${new Date(checkedAt).toLocaleTimeString()}` : ''}
            </span>
            <button className="btn" onClick={refresh} disabled={loading} title="Force a check now (data may be unchanged until EVE's next server update)">
              ⟳ Now
            </button>
          </span>
        </h2>
        {error && <div className="form-error">{error}</div>}
        {rows !== null && visibleRows.length > 0 && (
          <div className="order-summary">
            {(() => {
              const beaten = visibleRows.filter((r) => r.edge !== null && r.edge < -1e-9).length;
              const nearly = visibleRows.filter((r) => fillFrac(r.order) >= 0.8).length;
              const healthy = visibleRows.length - beaten;
              return (
                <>
                  <span className={`flag ${beaten > 0 ? 'warn' : 'good'}`}
                    title="Orders a rival currently beats — these are what to act on. The table sorts worst-first by default.">
                    {beaten > 0 ? `✕ ${beaten} need action` : '✓ nothing beaten'}
                  </span>
                  <span className="flag info"
                    title="Orders ≥80% filled — almost done; think about restocking or the next listing.">
                    {nearly} nearly done
                  </span>
                  <span className="flag good" title="Orders currently winning (or alone) at their station.">
                    {healthy} healthy
                  </span>
                </>
              );
            })()}
          </div>
        )}
        {rows !== null && visibleRows.length === 0 && !error && (
          <div className="empty">No active market orders{rows.length > 0 ? ' (all hidden — books-exclusion list, or cash-bought PLEX which this app ignores)' : ''}.</div>
        )}
        {rows !== null && visibleRows.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => clickHeader('name')}>Item{indicator('name')}</th>
                {characters.length > 1 && (
                  <th className="sortable" onClick={() => clickHeader('who')}><Tip tip="Which team character owns this order.">Char</Tip>{indicator('who')}</th>
                )}
                <th className="sortable" onClick={() => clickHeader('side')}><Tip tip="sell = you're offering items. buy = you're offering to purchase.">Side</Tip>{indicator('side')}</th>
                <th className="sortable" onClick={() => clickHeader('mine')}><Tip tip="Your order's current price per unit. Hover the item name for the station (the character's duty tells you the hub).">My price</Tip>{indicator('mine')}</th>
                <th className="sortable" onClick={() => clickHeader('sbest')}><Tip tip="Best competing price AT YOUR STATION right now (live book) — this is who buyers/sellers see next to you.">Station best</Tip>{indicator('sbest')}</th>
                <th className="sortable" onClick={() => clickHeader('paid')}><Tip tip="What was ACTUALLY spent per unit on the stack you have right now — team-wide FIFO over the ledger: sales consume the oldest purchases first, so this is the average of the lots that remain (listed on the market + sitting in stock), not of everything ever bought. Anything that nets below this after tax is selling at a loss. '—' = no purchase on the books (loot / pre-app stock).">Paid/unit</Tip>{indicator('paid')}</th>
                <th className="sortable" onClick={() => clickHeader('edge')}><Tip tip="'best here' = your order wins at your station. 'beaten X%' = someone at your station undercuts (sells) / outbids (buys) you by that much — CLICK a beaten tag to fix it: it copies the 4-digit price that retakes the top and opens the market window in game on the order's owner. (Stock with no sell order lives in the Unlisted stock table above.)">Status</Tip>{indicator('edge')}</th>
                <th className="sortable" onClick={() => clickHeader('advice')}><Tip tip="Trends is where you INVESTIGATE — this column is where you ACT. Heat = everyone ELSE's reprice tempo on your side of the book (the team's own orders are excluded, so you can't make a book look hot to yourself). Advice combines standing, fill and heat; once a system has 5+ days of unbiased station-fill data it becomes TIME-AWARE: act NOW during prime selling hours, fix by HH:00 outside them. Sorts most-urgent first.">Heat · advice</Tip>{indicator('advice')}</th>
                <th className="sortable" onClick={() => clickHeader('prog')}><Tip tip="How much of the order has filled — the bar is green while your price wins, red while beaten. Sort to find orders about to finish.">Progress</Tip>{indicator('prog')}</th>
                <th className="sortable" onClick={() => clickHeader('left')}><Tip tip="Days until the order expires.">Expires</Tip>{indicator('left')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.order.order_id}>
                  <td className="hub-name" title={r.locationName}>{r.name}</td>
                  {characters.length > 1 && (
                    <td className="dim" title={r.order.ownerName}>{ownerLabel(r.order.ownerId, r.order.ownerName)}</td>
                  )}
                  <td>
                    {r.order.is_buy_order
                      ? <span className="flag info">buy</span>
                      : <span className="flag good">sell</span>}
                  </td>
                  <td title={r.priceLive
                    ? 'Confirmed against the live public order book (~5 min fresh) — reflects in-game edits quickly'
                    : "From your order list (updates ~20 min on EVE's side) — a recent in-game edit may not show yet"}>
                    {isk(r.myPrice)}
                    {!r.priceLive && <span className="dim"> *</span>}
                  </td>
                  <td className="dim">{r.stationBest !== null ? isk(r.stationBest) : '—'}</td>
                  <td>
                    {r.paid === null ? (
                      <span className="dim" title="No purchase on the books for this item (loot / pre-app stock).">—</span>
                    ) : (
                      /* one verdict, computed with the row — the ACT column
                         reads the same flag, so the two can never disagree */
                      <span className={r.underwater ? '' : 'dim'}
                        title={`Team-wide FIFO average of the CURRENT stack (listed + in stock). Break-even gross price after tax: ${isk(r.breakEven ?? 0)}.${r.underwater ? ' ⚠ Your current price nets BELOW this — every fill loses money.' : ''}`}>
                        {isk(r.paid)}{r.underwater ? <span className="flag warn" style={{ marginLeft: 4 }}>⚠ loss</span> : null}
                      </span>
                    )}
                  </td>
                  <td>
                    {r.edge === null ? (
                      <span className="flag good">only one here</span>
                    ) : r.edge >= -1e-9 ? (
                      <span className="flag good">best here</span>
                    ) : r.stationBest !== null ? (
                      /* THE COPY BUTTON MUST NOT HAND OVER A LOSS-MAKING PRICE.
                         Undercutting the station best is the right move only
                         while that price still clears cost; below it, the
                         button used to put a price on the clipboard that was
                         guaranteed to lose money on every fill. When the order
                         is underwater it copies the BREAK-EVEN price instead,
                         and says so. */
                      <button className="flag warn"
                        title={r.underwater
                          ? `⚠ BELOW COST. Undercutting to ${tickPriceText(r.stationBest, 'below')} would net less than the ${isk(r.paid ?? 0)}/unit you paid. This copies your BREAK-EVEN price ${isk(r.breakEven ?? 0)} instead — the lowest gross price that does not lose money after tax — and opens the market window on ${ownerLabel(r.order.ownerId, r.order.ownerName)}. Listing at break-even may simply not sell; holding or cutting deliberately are the real options.`
                          : `Click to fix: copies ${tickPriceText(r.stationBest, r.order.is_buy_order ? 'above' : 'below')} — the 4-significant-digit price that beats the station best of ${isk(r.stationBest)} — and opens the market window in game on ${ownerLabel(r.order.ownerId, r.order.ownerName)}. NOTE: only the ORDER OWNER can modify an order, and EVE only opens windows in a RUNNING client — if ${ownerLabel(r.order.ownerId, r.order.ownerName)} isn't logged into the game, you'll get a message instead (the price still copies).`}
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(
                              r.underwater && r.breakEven !== null
                                ? String(Math.ceil(r.breakEven * 100) / 100)
                                : tickPriceText(r.stationBest!, r.order.is_buy_order ? 'above' : 'below'),
                            );
                          } catch { /* clipboard denied */ }
                          void openMarketWindow(r.order.type_id, r.order.ownerId).catch(() => {});
                        }}>
                        beaten {pct(Math.abs(r.edge))} {r.underwater ? '🛑' : '📋'}
                      </button>
                    ) : (
                      <span className="flag warn">beaten {pct(Math.abs(r.edge))}</span>
                    )}
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <HeatChip heat={r.heat} side={r.order.is_buy_order ? 'buy' : 'sell'} />
                    {(() => { const a = adviceFor(r, schedules.get(r.systemId), profitableHours(r)); return <span className={a.cls} style={{ marginLeft: 4 }} title={a.tip}>{a.txt}</span>; })()}
                  </td>
                  <td>
                    <span className="prog-cell" title={`${int(r.order.volume_total - r.order.volume_remain)} of ${int(r.order.volume_total)} ${r.order.is_buy_order ? 'bought' : 'sold'} (${pct(fillFrac(r.order))}) · ${int(r.order.volume_remain)} to go`}>
                      <span className="prog-track">
                        <span className={`prog-fill ${r.edge !== null && r.edge < -1e-9 ? 'bad' : ''}`}
                          style={{ width: `${fillFrac(r.order) * 100}%` }} />
                      </span>
                      <span className="dim prog-num">{Math.round(fillFrac(r.order) * 100)}%</span>
                    </span>
                  </td>
                  <td className="dim">{r.daysLeft.toFixed(1)}d</td>
                  <td className="row-actions">
                    <button className="btn mini" title="Full order breakdown: live price ladder, your fills and taxes"
                      onClick={() => setOrderDetail(r.order)}>
                      breakdown
                    </button>
                    <button className="btn mini" title="Item details in a popup"
                      onClick={() => setDetailTypeId(r.order.type_id)}>
                      details
                    </button>
                    <button className="btn mini" title="Open market window in the EVE client"
                      onClick={() => openMarket(r.order.type_id, r.order.ownerId)}>
                      game
                    </button>
                    <span className="dim" style={{ marginLeft: 6 }}>{iskShort(r.order.price * r.order.volume_remain)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel">
        <h2>
          <Tip tip="Orders that filled completely (from EVE's order history, ~90 days). Kept separate from the open orders so each table sorts cleanly on its own. The 📦 tag flags items you STILL have stock of with no sell order up — completed buys you haven't listed, completed sells where more stock remains.">Completed orders</Tip>
          <span className="sub">sold-out orders, last ~90 days · separate from the live table on purpose</span>
        </h2>
        {visibleDone.length === 0 ? (
          <div className="empty">No completed orders in EVE's history window yet.</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => clickDone('name')}>Item{indDone('name')}</th>
                {characters.length > 1 && (
                  <th className="sortable" onClick={() => clickDone('who')}><Tip tip="Which team character ran this order.">Char</Tip>{indDone('who')}</th>
                )}
                <th className="sortable" onClick={() => clickDone('side')}>Side{indDone('side')}</th>

                <th className="sortable" onClick={() => clickDone('price')}><Tip tip="The order's final price per unit.">Price</Tip>{indDone('price')}</th>
                <th className="sortable" onClick={() => clickDone('qty')}><Tip tip="Units the order filled in total.">Qty</Tip>{indDone('qty')}</th>
                <th className="sortable" onClick={() => clickDone('total')}><Tip tip="Price × quantity — the order's full value.">Total</Tip>{indDone('total')}</th>
                <th className="sortable" onClick={() => clickDone('age')}><Tip tip="Days since the order's last update (≈ when it finished).">Age</Tip>{indDone('age')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedDone.map((r) => (
                <tr key={`done-${r.order.order_id}`}>
                  <td className="hub-name" title={r.locationName}>
                    {r.name}
                    <StockChip typeId={r.order.type_id}
                      refPrice={r.order.is_buy_order ? null : r.order.price} />
                  </td>
                  {characters.length > 1 && (
                    <td className="dim" title={r.order.ownerName}>{ownerLabel(r.order.ownerId, r.order.ownerName)}</td>
                  )}
                  <td>
                    {r.order.is_buy_order
                      ? <span className="flag info">buy</span>
                      : <span className="flag good">sell</span>}
                  </td>

                  <td>{isk(r.order.price)}</td>
                  <td className="dim">{int(r.order.volume_total)}</td>
                  <td>{iskShort(r.total)}</td>
                  <td className="dim">{r.ageDays.toFixed(0)}d</td>
                  <td className="row-actions">
                    <button className="btn mini" title="Item details in a popup"
                      onClick={() => setDetailTypeId(r.order.type_id)}>
                      details
                    </button>
                    <button className="btn mini" title="Open market window in the EVE client"
                      onClick={() => openMarket(r.order.type_id, r.order.ownerId)}>
                      game
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {detailTypeId !== null && (
        <ItemDetailModal typeId={detailTypeId} onClose={() => setDetailTypeId(null)} />
      )}
      {orderDetail !== null && (
        <OrderDetailModal order={orderDetail} onClose={() => setOrderDetail(null)} />
      )}
    </>
  );
}
