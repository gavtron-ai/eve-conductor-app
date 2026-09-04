import { useEffect, useMemo, useState } from 'react';
import { ESI_BASE } from '../lib/constants';
import { esiFetch } from '../lib/esiRate';
import { attributeBrokerFees, ledger } from '../lib/ledger';
import { getType } from '../lib/typedb';
import { getStation, getSystem } from '../lib/mapdata';
import { openMarketWindowEverywhere, type MyOrder } from '../lib/esiChar';
import { statsFor } from '../lib/historyCache';
import { useApp } from '../lib/store';
import { salesTaxRate } from '../lib/fees';
import { isk, iskShort, int, pct } from '../lib/format';
import MiniHistory from './MiniHistory';
import Tip from './Tip';
import type { HistoryStats } from '../lib/market';

interface LadderRow {
  order_id: number;
  price: number;
  volume_remain: number;
  mine: boolean;
}

/**
 * Everything about one of your orders: the live price ladder at its station
 * (you highlighted), your actual fills + exact sales tax from the ledger,
 * and the item's recent trading. Fees note: broker/relist fees are real and
 * counted in dashboard totals, but EVE doesn't say which order they belong to.
 */
export default function OrderDetailModal({ order, onClose }: { order: MyOrder; onClose: () => void }) {
  const item = getType(order.type_id);
  const isBuy = order.is_buy_order === true;
  const station = getStation(order.location_id);
  const locationName = station?.name ?? `Structure …${String(order.location_id).slice(-4)}`;
  const [ladder, setLadder] = useState<LadderRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    esiFetch(`${ESI_BASE}/markets/${order.region_id}/orders/?type_id=${order.type_id}&order_type=${isBuy ? 'buy' : 'sell'}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: { order_id: number; location_id: number; price: number; volume_remain: number }[]) => {
        if (!alive) return;
        const atStation = rows
          .filter((o) => o.location_id === order.location_id)
          .sort((a, b) => (isBuy ? b.price - a.price : a.price - b.price))
          .slice(0, 10)
          .map((o) => ({ ...o, mine: o.order_id === order.order_id }));
        setLadder(atStation);
      })
      .catch(() => alive && setLadder([]));
    return () => {
      alive = false;
    };
  }, [order, isBuy]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // this order's fills from the local ledger: same item, same station, right
  // side, after the order was PLACED. `issued` bumps on every modification, so
  // the placement time is the earliest event we've recorded for this order id.
  const issuedMs = new Date(order.issued).getTime();
  const placedMs = ledger.orderEvents
    .filter((e) => e.orderId === order.order_id)
    .reduce((min, e) => Math.min(min, e.issued), issuedMs);
  const fills = ledger.tx.filter(
    (t) =>
      t.typeId === order.type_id &&
      t.locationId === order.location_id &&
      t.isBuy === isBuy &&
      t.date >= placedMs,
  );
  const taxByTx = new Map<number, number>();
  for (const f of ledger.fees) {
    if (f.kind === 'transaction_tax' && f.contextId) {
      taxByTx.set(f.contextId, (taxByTx.get(f.contextId) ?? 0) + f.amount);
    }
  }
  const fillQty = fills.reduce((s, t) => s + t.qty, 0);
  const fillValue = fills.reduce((s, t) => s + t.qty * t.unitPrice, 0);
  const fillTax = fills.reduce((s, t) => s + (taxByTx.get(t.id) ?? 0), 0);

  // broker fees matched to THIS order by placement/modification timestamps
  const matchedFees = useMemo(() => {
    const attribution = attributeBrokerFees();
    return ledger.fees.filter(
      (f) => f.kind === 'brokers_fee' && attribution.byFee.get(f.id)?.orderId === order.order_id,
    );
  }, [order.order_id]);
  const matchedFeeTotal = matchedFees.reduce((s, f) => s + f.amount, 0);

  const daysLeft = Math.max(0, order.duration - (Date.now() - issuedMs) / 86_400_000);
  const sys = station ? getSystem(station.systemId) : undefined;

  const settings = useApp((s) => s.settings);
  const [regionStats, setRegionStats] = useState<HistoryStats | null>(null);
  useEffect(() => {
    let alive = true;
    if (sys) {
      statsFor(sys.regionId, order.type_id)
        .then((s) => alive && setRegionStats(s))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.order_id]);

  // ---- order economics (sell orders): all inputs from YOUR data ----
  const econ = useMemo(() => {
    if (isBuy) return null;
    const tax = salesTaxRate(settings);
    // stack cost: cover the order's starting quantity from your most recent
    // purchases of this item (closest to what you actually paid for the stack)
    let need = order.volume_total;
    let stackCost = 0;
    let covered = 0;
    for (const t of [...ledger.tx].reverse()) {
      if (need <= 0) break;
      if (t.typeId !== order.type_id || !t.isBuy) continue;
      const take = Math.min(need, t.qty);
      stackCost += take * t.unitPrice;
      covered += take;
      need -= take;
    }
    const coverage = order.volume_total > 0 ? covered / order.volume_total : 0;
    if (coverage < 1 && covered > 0) {
      stackCost = (stackCost / covered) * order.volume_total; // scale avg to full stack
    }
    if (covered === 0) return { kind: 'nocost' } as const;

    const receivedNet = fillValue - fillTax;
    const daysSince = Math.max(0.25, (Date.now() - placedMs) / 86_400_000);

    // price trajectory from your own modification events (undercut race pace)
    const events = ledger.orderEvents
      .filter((e) => e.orderId === order.order_id)
      .sort((a, b) => a.issued - b.issued);
    const currentPrice = order.price;
    let declinePerDay = 0;
    if (events.length >= 2) {
      const span = (events[events.length - 1].issued - events[0].issued) / 86_400_000;
      if (span > 0.1) declinePerDay = Math.max(0, (events[0].price - currentPrice) / span);
    }

    // your personal fill pace, falling back to a conservative share of region volume
    const myPace = fillQty > 0 ? fillQty / daysSince : 0;
    const regionPace = regionStats ? regionStats.dailyVol14 * 0.25 : 0;
    const pace = myPace > 0 ? myPace : regionPace;
    if (pace <= 0) return { kind: 'nopace', coverage, stackCost, receivedNet } as const;
    const estDays = order.volume_remain / pace;

    // projected average future sale price: current price minus half the decline
    // over the remaining period, floored at recent prints
    const printFloor = regionStats ? Math.min(regionStats.avg7, regionStats.median90) * 0.85 : 0;
    const projPrice = Math.max(printFloor, currentPrice - (declinePerDay * estDays) / 2);

    // projected relist fees at your observed relist pace. The FIRST charge is
    // the one-time placement fee — extrapolating it as a recurring cost once
    // projected a fresh 5b order into a −46b disaster. Only charges AFTER the
    // first are relists, and pace uses at least a 1-day baseline.
    const relistCount = Math.max(0, matchedFees.length - 1);
    const relistPace = relistCount / Math.max(1, daysSince);
    const avgFee = matchedFees.length > 0 ? matchedFeeTotal / matchedFees.length : 0;
    // fees only accrue while THIS order lives — don't project past its expiry
    const projFees = relistPace * Math.min(estDays, daysLeft) * avgFee;

    const estRemainingNet = order.volume_remain * projPrice * (1 - tax) - projFees;
    const totalIn = receivedNet - matchedFeeTotal + estRemainingNet;
    const estProfit = totalIn - stackCost;
    const estReturn = stackCost > 0 ? estProfit / stackCost : 0;
    return {
      kind: 'full',
      estProfit,
      coverage,
      stackCost,
      receivedNet,
      estDays,
      projPrice,
      declinePerDay,
      estRemainingNet,
      estReturn,
      paceSource: myPace > 0 ? 'your fills' : 'region volume share',
    } as const;
  }, [order, isBuy, settings, fillValue, fillTax, fillQty, placedMs, matchedFees, matchedFeeTotal, regionStats]);

  if (!item) return null;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="item-head" style={{ marginBottom: 12 }}>
          <h1>{item.name}</h1>
          {isBuy ? <span className="flag info">buy order</span> : <span className="flag good">sell order</span>}
          <span className="meta" title={locationName}>
            {locationName.length > 48 ? locationName.slice(0, 48) + '…' : locationName}
          </span>
          <button className="btn mini" title="Open this item's market window in the EVE client"
            onClick={() => openMarketWindowEverywhere(order.type_id).catch(() => {})}>
            open in game
          </button>
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={onClose}>✕ Close</button>
        </div>

        <div className="load-totals">
          <div><span className="lbl"><Tip tip="Your order's current price per unit.">My price</Tip></span><span className="val">{isk(order.price)}</span></div>
          <div><span className="lbl"><Tip tip="Units still open / units the order started with.">Remaining</Tip></span><span className="val">{int(order.volume_remain)} / {int(order.volume_total)}</span></div>
          <div><span className="lbl"><Tip tip="ISK still riding on this order (price × remaining).">Open value</Tip></span><span className="val">{iskShort(order.price * order.volume_remain)}</span></div>
          {order.escrow !== undefined && order.escrow > 0 && (
            <div><span className="lbl"><Tip tip="ISK locked in escrow for this buy order.">Escrow</Tip></span><span className="val">{iskShort(order.escrow)}</span></div>
          )}
          <div><span className="lbl"><Tip tip="Days until the order expires and returns unsold/unfilled.">Expires</Tip></span><span className="val">{daysLeft.toFixed(1)}d</span></div>
        </div>

        <div className="dash-grid">
          <div className="panel">
            <h2>
              <Tip tip={`The live ${isBuy ? 'bid' : 'ask'} ladder at this station right now (EVE refreshes this data ~every 5 minutes). Your order is highlighted — anything ${isBuy ? 'above' : 'below'} you gets hit first.`}>Price ladder (live)</Tip>
            </h2>
            {ladder === null ? (
              <div className="empty">Loading order book…</div>
            ) : ladder.length === 0 ? (
              <div className="empty">No orders visible at this station.</div>
            ) : (
              <table className="data">
                <thead>
                  <tr><th>#</th><th>Price</th><th>Units</th><th></th></tr>
                </thead>
                <tbody>
                  {ladder.map((l, i) => (
                    <tr key={l.order_id} style={l.mine ? { background: 'rgba(57,135,229,0.12)' } : undefined}>
                      <td className="dim">{i + 1}</td>
                      <td className={l.mine ? 'pos' : ''}>{isk(l.price)}</td>
                      <td className="dim">{int(l.volume_remain)}</td>
                      <td>{l.mine && <span className="flag info">you</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <div className="panel">
            <h2><Tip tip="Actual fills recorded in your local ledger since this order was placed (same item, station and side). Sales tax is exact — it's linked to each sale in your wallet journal.">Fills so far</Tip></h2>
            {fills.length === 0 ? (
              <div className="empty">No fills recorded yet (sync the Dashboard wallet to pull the latest).</div>
            ) : (
              <div className="load-totals" style={{ paddingTop: 4 }}>
                <div><span className="lbl">Units filled</span><span className="val">{int(fillQty)}</span></div>
                <div><span className="lbl">Avg price</span><span className="val">{isk(fillValue / Math.max(1, fillQty))}</span></div>
                <div><span className="lbl">{isBuy ? 'Spent' : 'Revenue'}</span><span className="val">{iskShort(fillValue)}</span></div>
                {!isBuy && (
                  <div><span className="lbl"><Tip tip="Exact sales tax paid on these fills (from your wallet journal).">Tax paid</Tip></span><span className="val neg">{iskShort(fillTax)} ({fillValue > 0 ? pct(fillTax / fillValue) : '—'})</span></div>
                )}
              </div>
            )}
            <h2 style={{ marginTop: 12 }}>
              <Tip tip="Broker fees matched to THIS order: EVE stamps the order's 'issued' time on every placement and modification, and the fee lands in your wallet journal at that same moment — equal timestamps identify the order. Fees from modifications made before the app started watching may stay unmatched (they remain in the Dashboard's global fee total).">Broker fees on this order (matched)</Tip>
            </h2>
            {matchedFees.length === 0 ? (
              <div className="empty" style={{ padding: '14px 0' }}>
                No fees matched yet — they match up after a wallet sync that saw the
                placement/modification.
              </div>
            ) : (
              <>
                <div className="load-totals" style={{ paddingTop: 4 }}>
                  <div><span className="lbl">Total</span><span className="val neg">{iskShort(matchedFeeTotal)}</span></div>
                  <div><span className="lbl">Charges</span><span className="val">{matchedFees.length}</span></div>
                  {!isBuy && fillValue > 0 && (
                    <div><span className="lbl"><Tip tip="Matched broker fees as a share of this order's revenue so far.">Fee drag</Tip></span><span className="val">{pct(matchedFeeTotal / fillValue)}</span></div>
                  )}
                </div>
                <div className="hint" style={{ marginTop: 4 }}>
                  {matchedFees.map((f) => `${new Date(f.date).toLocaleString()}: ${iskShort(f.amount)}`).join(' · ')}
                </div>
              </>
            )}
            {econ && (
              <>
                <h2 style={{ marginTop: 12 }}>
                  <Tip tip="Estimated full economics of this order, built ONLY from your own data: what you paid for the stack (your most recent purchases of this item), what came back so far (net of exact taxes and matched fees), and a projection for the rest — your fill pace, your price-decline pace from your own modifications, floored at recent prints, minus projected relist fees at your observed relist rate.">Order economics (estimate)</Tip>
                </h2>
                {econ.kind === 'nocost' ? (
                  <div className="empty" style={{ padding: '12px 0' }}>
                    No purchases of this item in the ledger — can't establish what the stack cost
                    you (loot or pre-app stock?).
                  </div>
                ) : (
                  <div className="load-totals" style={{ paddingTop: 4 }}>
                    <div><span className="lbl"><Tip tip={`What the ${int(order.volume_total)} units likely cost you, from your most recent purchases of this item${econ.coverage < 1 ? ` (only ${pct(econ.coverage)} of the stack found in the ledger — average extrapolated)` : ''}.`}>Stack cost</Tip></span><span className="val">{iskShort(econ.stackCost)}</span></div>
                    <div><span className="lbl"><Tip tip="Revenue from fills so far, minus exact sales tax and this order's matched broker/relist fees.">Back so far</Tip></span><span className="val">{iskShort(econ.receivedNet - matchedFeeTotal)}</span></div>
                    {econ.kind === 'nopace' ? (
                      <div><span className="lbl">Remaining</span><span className="val dim">no fill data yet</span></div>
                    ) : (
                      <>
                        <div><span className="lbl"><Tip tip={`Projected income from the remaining ${int(order.volume_remain)} units: ~${isk(econ.projPrice)} average (your price${econ.declinePerDay > 0 ? `, declining ~${iskShort(econ.declinePerDay)}/day in the undercut race` : ''}, floored at recent prints), net of tax and projected relist fees.`}>Est. remaining</Tip></span><span className="val">{iskShort(econ.estRemainingNet)}</span></div>
                        <div><span className="lbl"><Tip tip={`Time to sell out at your current pace (based on ${econ.paceSource}). ${econ.estDays > daysLeft ? 'Longer than the order has left — it may expire first.' : ''}`}>Est. time</Tip></span><span className={`val ${econ.estDays > daysLeft ? 'neg' : ''}`}>{econ.estDays.toFixed(1)}d</span></div>
                        <div><span className="lbl"><Tip tip="Bottom line if the projection holds: everything back (net of all costs) minus what the stack cost you — shown as a % of the stack cost and as hard ISK.">Est. return</Tip></span><span className={`val ${econ.estReturn >= 0 ? 'pos' : 'neg'}`}>{pct(econ.estReturn)} · {econ.estProfit >= 0 ? '+' : ''}{iskShort(econ.estProfit)}</span></div>
                      </>
                    )}
                  </div>
                )}
              </>
            )}
            {sys && (
              <>
                <h2 style={{ marginTop: 12 }}><Tip tip="The last 2 weeks of this item's trades in this region — bar height is units sold; hover for min/avg/max paid.">2w trading here</Tip></h2>
                <MiniHistory regionId={sys.regionId} typeId={order.type_id} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
