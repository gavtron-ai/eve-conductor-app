import { useState } from 'react';
import { useApp, useHubs } from '../lib/store';
import { usePrices } from '../lib/priceStore';
import { haulProfit } from '../lib/fees';
import { brokerRateForHub } from '../lib/broker';
import { getType } from '../lib/typedb';
import { useSort } from '../lib/useSort';
import { isk, iskShort, pct } from '../lib/format';
import Tip from './Tip';

interface Route {
  key: string;
  from: string;
  to: string;
  buyAt: number;
  quick: number;
  quickPct: number;
  patient: number;
  patientPct: number;
  quickPerM3: number;
  patientPerM3: number;
}

type ColKey = 'route' | 'buyAt' | 'quick' | 'quickPct' | 'quickM3' | 'patient' | 'patientPct' | 'patientM3';

/**
 * Every buy-here-sell-there pair across the active hubs for the selected item.
 * "Quick" sells instantly into buy orders (sales tax only);
 * "Patient" places a sell order at the destination (broker fee + tax).
 */
export default function ArbitragePanel({ typeId }: { typeId: number }) {
  const hubs = useHubs();
  const book = usePrices((s) => s.book);
  const settings = useApp((s) => s.settings);
  const volume = getType(typeId)?.volume ?? 0;
  const [profitableOnly, setProfitableOnly] = useState(false);

  const routes: Route[] = [];
  for (const src of hubs) {
    const sAgg = book[src.id]?.[typeId];
    if (!sAgg || sAgg.sell.orderCount === 0) continue;
    for (const dst of hubs) {
      if (dst.id === src.id) continue;
      const dAgg = book[dst.id]?.[typeId];
      if (!dAgg) continue;
      const hasBuy = dAgg.buy.orderCount > 0;
      const hasSell = dAgg.sell.orderCount > 0;
      if (!hasBuy && !hasSell) continue;
      const p = haulProfit(
        sAgg.sell.min,
        hasBuy ? dAgg.buy.max : 0,
        hasSell ? dAgg.sell.min : 0,
        settings,
        brokerRateForHub(dst, settings),
      );
      routes.push({
        key: `${src.id}-${dst.id}`,
        from: src.name,
        to: dst.name,
        buyAt: sAgg.sell.min,
        quick: hasBuy ? p.quick : NaN,
        quickPct: hasBuy ? p.quickPct : NaN,
        patient: hasSell ? p.patient : NaN,
        patientPct: hasSell ? p.patientPct : NaN,
        quickPerM3: hasBuy && volume > 0 ? p.quick / volume : NaN,
        patientPerM3: hasSell && volume > 0 ? p.patient / volume : NaN,
      });
    }
  }

  const visible = profitableOnly
    ? routes.filter(
        (r) =>
          (Number.isFinite(r.quick) && r.quick > 0) ||
          (Number.isFinite(r.patient) && r.patient > 0),
      )
    : routes;

  const { sorted, clickHeader, indicator } = useSort<Route, ColKey>(
    visible,
    {
      route: (r) => `${r.from} → ${r.to}`,
      buyAt: (r) => r.buyAt,
      quick: (r) => (Number.isFinite(r.quick) ? r.quick : null),
      quickPct: (r) => (Number.isFinite(r.quickPct) ? r.quickPct : null),
      quickM3: (r) => (Number.isFinite(r.quickPerM3) ? r.quickPerM3 : null),
      patient: (r) => (Number.isFinite(r.patient) ? r.patient : null),
      patientPct: (r) => (Number.isFinite(r.patientPct) ? r.patientPct : null),
      patientM3: (r) => (Number.isFinite(r.patientPerM3) ? r.patientPerM3 : null),
    },
    { key: 'patient', dir: 'desc' },
  );

  const cls = (v: number) => (!Number.isFinite(v) ? 'dim' : v > 0 ? 'pos' : 'neg');
  const show = (v: number, f: (n: number) => string) => (Number.isFinite(v) ? f(v) : '—');

  return (
    <div className="panel">
      <h2>
        Hauling routes
        <span className="sub">net of taxes &amp; fees, per unit · all {routes.length} hub pairs · click headers to sort</span>
        <label className="checkline panel-filter">
          <input
            type="checkbox"
            checked={profitableOnly}
            onChange={(e) => setProfitableOnly(e.target.checked)}
          />
          <span>profitable only</span>
        </label>
      </h2>
      {sorted.length === 0 ? (
        <div className="empty">
          {routes.length === 0 ? 'No route data yet.' : 'No profitable routes for this item right now.'}
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th className="sortable" onClick={() => clickHeader('route')}><Tip tip="Buy at the first hub, haul to the second, sell there.">Route</Tip>{indicator('route')}</th>
              <th className="sortable" onClick={() => clickHeader('buyAt')}><Tip tip="What one unit costs you at the starting hub (cheapest sell order there).">Buy at</Tip>{indicator('buyAt')}</th>
              <th className="sortable" onClick={() => clickHeader('quick')}><Tip tip="Profit per unit if you sell INSTANTLY into buy orders at the destination — you get paid immediately but at the lower buy-order price. Only sales tax applies.">Quick profit</Tip>{indicator('quick')}</th>
              <th className="sortable" onClick={() => clickHeader('quickPct')}><Tip tip="Quick profit as a % of what you invested. -5% means an instant sell loses 5%.">Quick ROI</Tip>{indicator('quickPct')}</th>
              <th className="sortable" onClick={() => clickHeader('quickM3')}><Tip tip="Quick profit per m³ of cargo space — compare hauls of different-sized items fairly.">Quick /m³</Tip>{indicator('quickM3')}</th>
              <th className="sortable" onClick={() => clickHeader('patient')}><Tip tip="Profit per unit if you list a SELL ORDER at the destination's current lowest price and wait for a buyer. Better price, but broker fee + tax apply and it takes time.">Patient profit</Tip>{indicator('patient')}</th>
              <th className="sortable" onClick={() => clickHeader('patientPct')}><Tip tip="Patient profit as a % of what you invested.">Patient ROI</Tip>{indicator('patientPct')}</th>
              <th className="sortable" onClick={() => clickHeader('patientM3')}><Tip tip="Patient profit per m³ of cargo space.">Patient /m³</Tip>{indicator('patientM3')}</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key}>
                <td className="hub-name">{r.from} → {r.to}</td>
                <td>{isk(r.buyAt)}</td>
                <td className={cls(r.quick)}>{show(r.quick, iskShort)}</td>
                <td className={cls(r.quick)}>{show(r.quickPct, pct)}</td>
                <td className="dim">{show(r.quickPerM3, iskShort)}</td>
                <td className={cls(r.patient)}>{show(r.patient, iskShort)}</td>
                <td className={cls(r.patient)}>{show(r.patientPct, pct)}</td>
                <td className="dim">{show(r.patientPerM3, iskShort)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
