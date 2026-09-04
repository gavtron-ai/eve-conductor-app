import { useMemo, useState } from 'react';
import { useAuth, charLabel, ownerLabel } from '../lib/auth';
import { useStock, unsoldCosts } from '../lib/stock';
import { useMyMarket } from '../lib/myMarket';
import { getStation } from '../lib/mapdata';
import { openMarketWindowEverywhere } from '../lib/esiChar';
import {
  attributeBrokerFees,
  computeStats,
  exportCsv,
  ledger,
  onMarketValue,
  regionOfLocation,
  syncAllLedgers,
} from '../lib/ledger';
import { getType, categoryOf } from '../lib/typedb';
import { useSort } from '../lib/useSort';
import { iskShort, int, pct } from '../lib/format';
import Tip from './Tip';
import ItemDetailModal from './ItemDetailModal';
import NetWorthChart from './NetWorthChart';
import { useApp } from '../lib/store';

// dataviz palette (validated for this dark surface): series-1 blue, series-2 aqua
const C_BUY = '#3987e5';
const C_SELL = '#199e70';

const RANGES = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
  { label: 'All', days: 0 },
];

function HBars({ rows, color }: { rows: [string, number][]; color: string }) {
  const max = Math.max(1, ...rows.map(([, v]) => Math.abs(v)));
  return (
    <div>
      {rows.map(([label, v]) => (
        <div className="hbar-row" key={label}>
          <span className="hbar-label" title={label}>{label}</span>
          <span className="hbar-track">
            <span
              className="hbar-fill"
              style={{ width: `${(Math.abs(v) / max) * 100}%`, background: v >= 0 ? color : 'var(--bad)' }}
              title={`${label}: ${iskShort(v)} ISK`}
            />
          </span>
          <span className="hbar-val">{iskShort(v)}</span>
        </div>
      ))}
      {rows.length === 0 && <div className="empty" style={{ padding: '24px 0' }}>No data in this range yet.</div>}
    </div>
  );
}

/** cumulative realized profit as a simple SVG area with hover readout */
function CumulativeChart({ points }: { points: [number, number][] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 560;
  const H = 150;
  const PAD = { l: 8, r: 8, t: 10, b: 20 };
  if (points.length < 2) {
    return <div className="empty" style={{ padding: '30px 0' }}>Not enough sales in this range for a trend yet.</div>;
  }
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const yMin = Math.min(0, ...ys);
  const yMax = Math.max(1, ...ys);
  const X = (t: number) => PAD.l + ((t - x0) / Math.max(1, x1 - x0)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - (v - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(' ');
  const area = `${path} L${X(x1).toFixed(1)},${Y(Math.max(0, yMin)).toFixed(1)} L${X(x0).toFixed(1)},${Y(Math.max(0, yMin)).toFixed(1)} Z`;
  const hp = hover !== null ? points[hover] : null;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 'auto', display: 'block' }}
      onMouseMove={(e) => {
        const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
        const t = x0 + ((e.clientX - rect.left) / rect.width) * (x1 - x0);
        let best = 0;
        for (let i = 1; i < points.length; i++) {
          if (Math.abs(points[i][0] - t) < Math.abs(points[best][0] - t)) best = i;
        }
        setHover(best);
      }}
      onMouseLeave={() => setHover(null)}
    >
      <line x1={PAD.l} x2={W - PAD.r} y1={Y(0)} y2={Y(0)} stroke="var(--baseline)" strokeWidth={1} />
      <path d={area} fill={C_BUY} opacity={0.14} />
      <path d={path} fill="none" stroke={C_BUY} strokeWidth={2} strokeLinejoin="round" />
      {hp && (
        <g>
          <line x1={X(hp[0])} x2={X(hp[0])} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeDasharray="3 3" strokeWidth={1} />
          <circle cx={X(hp[0])} cy={Y(hp[1])} r={4} fill={C_BUY} stroke="var(--surface)" strokeWidth={2} />
          <text x={Math.min(X(hp[0]) + 8, W - 150)} y={PAD.t + 12} fill="var(--ink)" fontSize={12}>
            {new Date(hp[0]).toLocaleDateString()} · {iskShort(hp[1])} ISK
          </text>
        </g>
      )}
      <text x={PAD.l} y={H - 6} fill="var(--muted)" fontSize={10}>{new Date(x0).toLocaleDateString()}</text>
      <text x={W - PAD.r} y={H - 6} fill="var(--muted)" fontSize={10} textAnchor="end">{new Date(x1).toLocaleDateString()}</text>
    </svg>
  );
}

/** daily bought vs sold ISK, grouped thin bars, 2-series legend */
function FlowChart({ days }: { days: { t: number; bought: number; sold: number }[] }) {
  const W = 560;
  const H = 150;
  const PAD = { l: 8, r: 8, t: 10, b: 20 };
  if (days.length === 0) {
    return <div className="empty" style={{ padding: '30px 0' }}>No activity in this range yet.</div>;
  }
  const max = Math.max(1, ...days.map((d) => Math.max(d.bought, d.sold)));
  const slot = (W - PAD.l - PAD.r) / days.length;
  const bw = Math.max(2, Math.min(10, slot / 2 - 2));
  const Y = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
      <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} stroke="var(--baseline)" strokeWidth={1} />
      {days.map((d, i) => {
        const x = PAD.l + i * slot + slot / 2;
        return (
          <g key={d.t}>
            <rect x={x - bw - 1} width={bw} y={Y(d.bought)} height={Math.max(0, H - PAD.b - Y(d.bought))} rx={2} fill={C_BUY}>
              <title>{`${new Date(d.t).toLocaleDateString()} — bought ${iskShort(d.bought)} ISK`}</title>
            </rect>
            <rect x={x + 1} width={bw} y={Y(d.sold)} height={Math.max(0, H - PAD.b - Y(d.sold))} rx={2} fill={C_SELL}>
              <title>{`${new Date(d.t).toLocaleDateString()} — sold ${iskShort(d.sold)} ISK`}</title>
            </rect>
          </g>
        );
      })}
      <text x={PAD.l} y={H - 6} fill="var(--muted)" fontSize={10}>{new Date(days[0].t).toLocaleDateString()}</text>
      <text x={W - PAD.r} y={H - 6} fill="var(--muted)" fontSize={10} textAnchor="end">{new Date(days[days.length - 1].t).toLocaleDateString()}</text>
    </svg>
  );
}

interface ItemRow {
  typeId: number;
  name: string;
  category: string;
  qty: number;
  /** ALL-TIME ISK spent buying this item (full ledger, ignores the range) */
  spent: number;
  revenue: number;
  profit: number;
  brokerAttr: number;
  net: number;
  marginPct: number | null;
}
type ItemCol = 'name' | 'cat' | 'qty' | 'spent' | 'rev' | 'profit' | 'broker' | 'net' | 'margin';

interface InvRow {
  typeId: number;
  name: string;
  category: string;
  /** who actually HOLDS it (asset owner / order owner) */
  charId: number | null;
  where: string;
  /** 'hangar' = sitting in a station hangar; 'listed' = inside an open sell order */
  status: 'hangar' | 'listed';
  qty: number;
  cost: number;
  unitCost: number;
  ageDays: number;
}
type InvCol = 'name' | 'cat' | 'who' | 'where' | 'status' | 'qty' | 'cost' | 'unit' | 'age';

export default function Dashboard() {
  const characters = useAuth((s) => s.characters);
  const characterId = characters.length > 0 ? characters[0].characterId : null;
  const [rangeDays, setRangeDays] = useState(30);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [market, setMarket] = useState<{ ask: number; escrow: number } | null>(null);
  const [version, setVersion] = useState(0); // bump to recompute after sync
  const [detailTypeId, setDetailTypeId] = useState<number | null>(null);
  /** null = the whole team's books; otherwise one character's slice */
  const [charFilter, setCharFilter] = useState<number | null>(null);

  const excludedFromBooks = useApp((s) => s.excludedFromBooks);
  const toggleExcludeBooks = useApp((s) => s.toggleExcludeBooks);

  const sinceMs = rangeDays > 0 ? Date.now() - rangeDays * 86_400_000 : 0;
  const stats = useMemo(
    () => computeStats(sinceMs, charFilter),
    // excludedFromBooks length changes recompute the books
    [sinceMs, version, excludedFromBooks, charFilter],
  );
  const feeAttr = useMemo(() => attributeBrokerFees(sinceMs), [sinceMs, version]);

  async function sync() {
    if (syncing || !characterId) return;
    setSyncing(true);
    setError(null);
    try {
      await syncAllLedgers(setProgress); // every team character's wallet
      setProgress('Checking live orders…');
      setMarket(await onMarketValue().catch(() => null));
      setVersion((v) => v + 1);
      setProgress('Team wallets synced.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }

  const cumulative = useMemo(() => {
    let run = 0;
    const pts: [number, number][] = [];
    for (const s of stats.sales) {
      if (s.profit === null) continue;
      run += s.profit;
      pts.push([s.date, run]);
    }
    return pts;
  }, [stats]);

  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stats.sales) {
      if (s.profit === null) continue;
      const c = categoryOf(s.typeId);
      m.set(c, (m.get(c) ?? 0) + s.profit);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [stats]);

  const byRegion = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of stats.sales) {
      if (s.profit === null) continue;
      const r = regionOfLocation(s.locationId);
      m.set(r, (m.get(r) ?? 0) + s.profit);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [stats]);

  const flow = useMemo(() => {
    const m = new Map<number, { t: number; bought: number; sold: number }>();
    const dayOf = (ms: number) => Math.floor(ms / 86_400_000) * 86_400_000;
    for (const t of ledger.tx) {
      if (sinceMs && t.date < sinceMs) continue;
      const d = dayOf(t.date);
      const e = m.get(d) ?? { t: d, bought: 0, sold: 0 };
      if (t.isBuy) e.bought += t.qty * t.unitPrice;
      else e.sold += t.qty * t.unitPrice;
      m.set(d, e);
    }
    return [...m.values()].sort((a, b) => a.t - b.t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sinceMs, version]);

  const itemRows = useMemo(() => {
    const m = new Map<number, ItemRow>();
    for (const s of stats.sales) {
      if (s.profit === null) continue;
      let r = m.get(s.typeId);
      if (!r) {
        r = {
          typeId: s.typeId,
          name: getType(s.typeId)?.name ?? `#${s.typeId}`,
          category: categoryOf(s.typeId),
          qty: 0,
          spent: 0,
          revenue: 0,
          profit: 0,
          brokerAttr: 0,
          net: 0,
          marginPct: null,
        };
        m.set(s.typeId, r);
      }
      r.qty += s.qty;
      r.revenue += s.revenue;
      r.profit += s.profit;
    }
    // all-time purchase spend per item — the ledger keeps everything, so old
    // buys count even when the range chips only window the SALES
    const spentByType = new Map<number, number>();
    for (const t of ledger.tx) {
      if (t.isBuy) spentByType.set(t.typeId, (spentByType.get(t.typeId) ?? 0) + t.qty * t.unitPrice);
    }
    for (const r of m.values()) {
      const cost = r.revenue - r.profit;
      r.marginPct = cost > 0 ? r.profit / cost : null;
      r.brokerAttr = feeAttr.byType.get(r.typeId) ?? 0;
      r.net = r.profit - r.brokerAttr;
      r.spent = spentByType.get(r.typeId) ?? 0;
    }
    return [...m.values()];
  }, [stats, feeAttr]);

  const { sorted: sortedItems, clickHeader, indicator } = useSort<ItemRow, ItemCol>(
    itemRows,
    {
      name: (r) => r.name,
      cat: (r) => r.category,
      qty: (r) => r.qty,
      spent: (r) => r.spent,
      rev: (r) => r.revenue,
      profit: (r) => r.profit,
      broker: (r) => r.brokerAttr,
      net: (r) => r.net,
      margin: (r) => r.marginPct,
    },
    { key: 'net', dir: 'desc' },
  );

  // Unsold stock = what the team ACTUALLY holds right now (hangar assets +
  // stock sitting inside open sell orders), priced at ledger cost. The ledger
  // alone drifts from reality — a consumed skill injector stays "unsold" on
  // paper forever; the assets endpoint is ground truth for quantity.
  const stockByType = useStock((s) => s.byType);
  const stockSynced = useStock((s) => s.fetchedAt) > 0;
  const sellsByType = useMyMarket((s) => s.sellsByType);
  const invRows = useMemo(() => {
    const out: InvRow[] = [];
    if (!stockSynced) {
      // assets not synced yet — fall back to the ledger view so the panel
      // isn't blank; a hint below marks it as unverified
      const m = new Map<number, InvRow>();
      for (const lot of stats.inventory) {
        let r = m.get(lot.typeId);
        if (!r) {
          r = {
            typeId: lot.typeId,
            name: getType(lot.typeId)?.name ?? `#${lot.typeId}`,
            category: categoryOf(lot.typeId),
            charId: null,
            where: '—',
            status: 'hangar',
            qty: 0,
            cost: 0,
            unitCost: 0,
            ageDays: 0,
          };
          m.set(lot.typeId, r);
        }
        r.qty += lot.qty;
        r.cost += lot.qty * lot.unitCost;
        r.ageDays = Math.max(r.ageDays, (Date.now() - lot.date) / 86_400_000);
      }
      for (const r of m.values()) r.unitCost = r.cost / Math.max(1, r.qty);
      return [...m.values()];
    }
    const costs = unsoldCosts(); // team-wide FIFO cost basis per item
    const businessTypes = new Set(stats.inventory.map((l) => l.typeId));
    const excluded = new Set(excludedFromBooks);
    // duty scoping: a hauler's cargo is IN TRANSIT, not idle stock; once any
    // character is marked "Hub trader", only trader hangars count. A TRADER's
    // whole hangar is stock by definition (user rule) — anything personal
    // goes in a station container, which the assets filter skips naturally.
    const traderIds = characters.filter((c) => c.tradeRole === 'trader').map((c) => c.characterId);
    const holderCounts = (id: number | undefined) => {
      if (id === undefined) return true;
      const c = characters.find((x) => x.characterId === id);
      if (c?.tradeRole === 'hauler') return false;
      return traderIds.length === 0 || traderIds.includes(id);
    };
    const isTrader = (id: number | undefined) => id !== undefined && traderIds.includes(id);
    const base = (typeId: number) => {
      const c = costs.get(typeId);
      return {
        typeId,
        name: getType(typeId)?.name ?? `#${typeId}`,
        category: categoryOf(typeId),
        unitCost: c?.avgCost ?? 0,
        ageDays: c?.oldestDays ?? 0,
      };
    };
    for (const [typeIdStr, holdings] of Object.entries(stockByType)) {
      const typeId = Number(typeIdStr);
      if (excluded.has(typeId)) continue;
      for (const h of holdings) {
        if (h.transit) continue; // moving cargo isn't idle stock
        if (charFilter !== null && h.charId !== charFilter) continue;
        if (!holderCounts(h.charId)) continue;
        // traders: everything in the hangar is stock; others: books-qualified only
        if (!isTrader(h.charId) && !businessTypes.has(typeId)) continue;
        const b = base(typeId);
        out.push({
          ...b,
          charId: h.charId,
          where: getStation(h.locationId)?.name.split(' - ')[0] ?? `Structure …${String(h.locationId).slice(-4)}`,
          status: 'hangar',
          qty: h.qty,
          cost: h.qty * b.unitCost,
        });
      }
    }
    for (const [typeIdStr, sells] of Object.entries(sellsByType)) {
      const typeId = Number(typeIdStr);
      if (excluded.has(typeId)) continue;
      for (const s of sells) {
        if (charFilter !== null && s.ownerId !== charFilter) continue;
        if (!holderCounts(s.ownerId)) continue;
        const b = base(typeId);
        out.push({
          ...b,
          charId: s.ownerId ?? null,
          where: s.locationName.split(' - ')[0],
          status: 'listed',
          qty: s.remain,
          cost: s.remain * b.unitCost,
        });
      }
    }
    return out;
  }, [stats, stockByType, stockSynced, sellsByType, charFilter, characters]);

  const { sorted: sortedInv, clickHeader: clickInv, indicator: indInv } = useSort<InvRow, InvCol>(
    invRows,
    {
      name: (r) => r.name,
      cat: (r) => r.category,
      who: (r) => (r.charId !== null ? ownerLabel(r.charId) : ''),
      where: (r) => r.where,
      status: (r) => r.status,
      qty: (r) => r.qty,
      cost: (r) => r.cost,
      unit: (r) => r.unitCost,
      age: (r) => r.ageDays,
    },
    { key: 'cost', dir: 'desc' },
  );

  function downloadCsv() {
    const blob = new Blob([exportCsv()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `eve-trade-ledger-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  if (!characterId) {
    return (
      <div className="panel">
        <h2>Dashboard</h2>
        <div className="empty">Log in with EVE (Settings → EVE login) to start tracking your trading performance.</div>
      </div>
    );
  }

  return (
    <>
      <NetWorthChart />
      <div className="panel">
        <h2>
          Dashboard
          <span className="sub">
            your MARKET BUSINESS only — items you've listed for sale or bid on with buy orders
            (personal instant purchases never enter the books; "exclude" covers the rest) ·
            stored locally forever, sync regularly since EVE only remembers ~30 days
          </span>
          <span className="panel-filter" style={{ display: 'inline-flex', gap: 8 }}>
            <button className="btn" onClick={downloadCsv} disabled={ledger.tx.length === 0}
              title="Save the full ledger as a spreadsheet-friendly CSV file (backup / Excel)">
              Export CSV
            </button>
            <button className="btn primary" onClick={sync} disabled={syncing}>
              {syncing ? 'Syncing…' : '⟳ Sync wallet'}
            </button>
          </span>
        </h2>
        <div className="finder-options" style={{ marginTop: 0 }}>
          {characters.length > 1 && (
            <select value={charFilter ?? 'all'} style={{ fontSize: 12, marginRight: 8 }}
              title="Whose books to show. A single character's slice is their ACTIVITY (what they bought/sold/paid in fees) — profit on goods one character bought and another sold only fully resolves in the Whole team view."
              onChange={(e) => setCharFilter(e.target.value === 'all' ? null : Number(e.target.value))}>
              <option value="all">Whole team</option>
              {characters.map((c) => (
                <option key={c.characterId} value={c.characterId}>{charLabel(c)}</option>
              ))}
            </select>
          )}
          <div className="range-tabs" style={{ display: 'flex', gap: 6 }}>
            {RANGES.map((r) => (
              <button key={r.label}
                className={`btn ${rangeDays === r.days ? 'primary' : ''}`}
                style={{ padding: '3px 12px', fontSize: 12 }}
                onClick={() => setRangeDays(r.days)}>
                {r.label}
              </button>
            ))}
          </div>
          {progress && <span className="progress-text">{progress}</span>}
          {ledger.lastSync && !progress && (
            <span className="hint" style={{ margin: 0 }}>
              Last sync {new Date(ledger.lastSync).toLocaleString()} · {int(ledger.tx.length)} transactions on record
            </span>
          )}
        </div>
        {error && <div className="form-error">{error}</div>}

        <div className="dash-tiles" style={{ marginTop: 12 }}>
          <div className="dash-tile">
            <Tip tip="Total ISK you paid buying items in this time range (item cost only — broker fees are shown separately because EVE charges them per order, not per item)."><span className="lbl">Spent buying</span></Tip>
            <span className="val">{iskShort(stats.totalBought)}</span>
          </div>
          <div className="dash-tile">
            <Tip tip="Total ISK received from everything you sold in this range, before taxes and fees."><span className="lbl">Sales revenue</span></Tip>
            <span className="val">{iskShort(stats.totalSold)}</span>
          </div>
          <div className="dash-tile">
            <Tip tip="Actual profit on completed round-trips: sale price minus sales tax minus what you originally paid for those exact units (matched oldest-purchase-first). Only counts sales where the app knows your buy price."><span className="lbl">Realized profit</span></Tip>
            <span className={`val ${stats.realizedProfit >= 0 ? 'pos' : 'neg'}`}>{iskShort(stats.realizedProfit)}</span>
          </div>
          <div className="dash-tile">
            <Tip tip="EVERY broker fee (placing, modifying and relisting orders — all captured from your wallet journal) plus sales tax in this range. Sales tax is linked to each sale; broker fees are real but EVE doesn't say which order they belong to."><span className="lbl">Fees paid</span></Tip>
            <span className="val neg">{iskShort(stats.totalBrokerFees + stats.totalSalesTax)}</span>
            <span className="sub2">
              {iskShort(stats.totalBrokerFees)} broker/relist · {iskShort(stats.totalSalesTax)} tax
              {stats.totalBrokerFees > 0 && (
                <> · {pct(feeAttr.matchedTotal / Math.max(1, feeAttr.matchedTotal + feeAttr.unmatchedTotal))} matched to orders</>
              )}
            </span>
          </div>
          <div className="dash-tile">
            <Tip tip="THE bottom line: realized profit minus ALL broker/relist fees in this range. Item-level profits can't include broker fees (EVE doesn't attribute them per order), so this tile is where the whole truth lives."><span className="lbl">Net after all fees</span></Tip>
            <span className={`val ${stats.realizedProfit - stats.totalBrokerFees >= 0 ? 'pos' : 'neg'}`}>
              {iskShort(stats.realizedProfit - stats.totalBrokerFees)}
            </span>
          </div>
          <div className="dash-tile">
            <Tip tip="ISK tied up in stock you ACTUALLY hold (hangar assets + stock inside open sell orders), at what you paid for it. Verified against character assets when synced — consumed items don't count."><span className="lbl">Inventory at cost</span></Tip>
            <span className="val">{iskShort(stockSynced ? invRows.reduce((s, r) => s + r.cost, 0) : stats.inventoryAtCost)}</span>
            <span className="sub2">{int(invRows.reduce((s, r) => s + r.qty, 0))} units across {int(new Set(invRows.map((r) => r.typeId)).size)} items</span>
          </div>
          <div className="dash-tile">
            <Tip tip="Your active sell orders valued at YOUR OWN listing prices (price × remaining) — what you'd receive if everything sold as listed. This is an ASPIRATION number; the Trading value chart above marks the same stock at the MARKET's current ask instead, which is why the two can disagree."><span className="lbl">At your asks</span></Tip>
            <span className="val">{market ? iskShort(market.ask) : '—'}</span>
            {market && market.escrow > 0 && <span className="sub2">{iskShort(market.escrow)} in buy-order escrow</span>}
          </div>
          {stats.unmatchedRevenue > 0 && (
            <div className="dash-tile">
              <Tip tip="Revenue from units the app never saw you buy (loot, mission rewards, stock from before you started syncing). Kept separate so it doesn't inflate your trading profit. Counted per UNIT, not per sale: if 60 of 100 units had a recorded purchase, the profit on those 60 is real and counted above, and only the other 40 units' revenue lands here."><span className="lbl">Loot / pre-app sales</span></Tip>
              <span className="val">{iskShort(stats.unmatchedRevenue)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="dash-grid">
        <div className="panel">
          <h2><Tip tip="Running total of realized profit over time — each completed sale adds (or subtracts) its profit. A healthy line climbs steadily.">Cumulative profit</Tip></h2>
          <CumulativeChart points={cumulative} />
        </div>
        <div className="panel">
          <h2><Tip tip="ISK spent buying vs ISK received selling, per day. Blue = bought, teal = sold. Big blue days are stock-up runs; teal should follow.">Daily buy vs sell</Tip></h2>
          <div className="chart-legend">
            <span><span className="swatch" style={{ background: C_BUY }} />Bought</span>
            <span><span className="swatch" style={{ background: C_SELL }} />Sold</span>
          </div>
          <FlowChart days={flow} />
        </div>
        <div className="panel">
          <h2><Tip tip="Realized profit grouped by the item's market category (from the in-game market tree). Shows where your trading actually makes its money.">Profit by category</Tip></h2>
          <HBars rows={byCategory} color={C_BUY} />
        </div>
        <div className="panel">
          <h2><Tip tip="Realized profit grouped by the region where the sale happened — 'where you sold it', not where you bought it. Reveals your best markets.">Profit by region sold into</Tip></h2>
          <HBars rows={byRegion} color={C_SELL} />
        </div>
      </div>

      <div className="panel">
        <h2>
          <Tip tip="Every item you completed round-trips on in this range, with total quantity sold, revenue, profit after tax and cost, and return on the ISK you invested.">Item performance</Tip>
          <span className="sub">click headers to sort</span>
        </h2>
        {sortedItems.length === 0 ? (
          <div className="empty">No completed buy→sell round-trips in this range yet. Sync your wallet after trading.</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => clickHeader('name')}>Item{indicator('name')}</th>
                <th className="sortable" onClick={() => clickHeader('cat')}><Tip tip="The item's top-level market category, same grouping as the in-game market tree.">Category</Tip>{indicator('cat')}</th>
                <th className="sortable" onClick={() => clickHeader('qty')}><Tip tip="Units sold in this range (only sales with a known purchase price).">Qty sold</Tip>{indicator('qty')}</th>
                <th className="sortable" onClick={() => clickHeader('spent')}><Tip tip="Everything you have EVER spent buying this item — the full ledger, not just this range. Old purchases count; the range chips only window the sales.">Spent (all-time)</Tip>{indicator('spent')}</th>
                <th className="sortable" onClick={() => clickHeader('rev')}><Tip tip="Total ISK received for this item before tax.">Revenue</Tip>{indicator('rev')}</th>
                <th className="sortable" onClick={() => clickHeader('profit')}><Tip tip="Revenue minus sales tax minus what you paid for these exact units (before broker fees).">Profit</Tip>{indicator('profit')}</th>
                <th className="sortable" onClick={() => clickHeader('broker')}><Tip tip="Broker fees matched to this item's orders by placement/modification timestamps (relists included). Unmatched fees stay in the global Fees tile.">Broker (matched)</Tip>{indicator('broker')}</th>
                <th className="sortable" onClick={() => clickHeader('net')}><Tip tip="Profit minus the matched broker fees — the closest thing to this item's true bottom line.">Net</Tip>{indicator('net')}</th>
                <th className="sortable" onClick={() => clickHeader('margin')}><Tip tip="Profit (before broker) divided by what you invested — 20% means every 100m ISK spent came back as 120m.">Return</Tip>{indicator('margin')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.slice(0, 100).map((r) => (
                <tr key={r.typeId}>
                  <td className="hub-name">{r.name}</td>
                  <td className="dim">{r.category}</td>
                  <td className="dim">{int(r.qty)}</td>
                  <td className="dim">{r.spent > 0 ? iskShort(r.spent) : '—'}</td>
                  <td>{iskShort(r.revenue)}</td>
                  <td className={r.profit >= 0 ? 'pos' : 'neg'}>{iskShort(r.profit)}</td>
                  <td className="dim">{r.brokerAttr > 0 ? iskShort(r.brokerAttr) : '—'}</td>
                  <td className={r.net >= 0 ? 'pos' : 'neg'}>{iskShort(r.net)}</td>
                  <td className={r.marginPct !== null && r.marginPct >= 0 ? 'pos' : 'neg'}>
                    {r.marginPct !== null ? pct(r.marginPct) : '—'}
                  </td>
                  <td className="row-actions">
                    <button className="btn mini" title="Item details in a popup"
                      onClick={() => setDetailTypeId(r.typeId)}>
                      details
                    </button>
                    <button className="btn mini" title="Open this item's market window in the EVE client"
                      onClick={() => openMarketWindowEverywhere(r.typeId).catch(() => {})}>
                      game
                    </button>
                    <button className="btn mini" title="Exclude this item from the books entirely (PLEX-for-ISK, personal purchases…) — reversible in Settings"
                      onClick={() => toggleExcludeBooks(r.typeId)}>
                      exclude
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
          <Tip tip="What the team ACTUALLY holds right now — hangar assets (verified against each character's inventory) plus stock sitting inside open sell orders — priced at what you paid (oldest-first lots). Consumed or moved items drop off automatically.">Inventory (unsold stock)</Tip>
          <span className="sub">
            {stockSynced
              ? `verified against actual character assets${characters.some((c) => c.tradeRole === 'hauler') ? ' · hauler cargo excluded (in transit)' : ''} · click headers to sort`
              : 'syncing actual assets… showing ledger view (unverified quantities)'}
          </span>
        </h2>
        {sortedInv.length === 0 ? (
          <div className="empty">No unsold stock on the books.</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => clickInv('name')}>Item{indInv('name')}</th>
                <th className="sortable" onClick={() => clickInv('cat')}>Category{indInv('cat')}</th>
                <th className="sortable" onClick={() => clickInv('who')}><Tip tip="Which character actually HOLDS this stock — where to look for it.">Char</Tip>{indInv('who')}</th>
                <th className="sortable" onClick={() => clickInv('where')}><Tip tip="The station the stock sits at.">Where</Tip>{indInv('where')}</th>
                <th className="sortable" onClick={() => clickInv('status')}><Tip tip="'hangar' = sitting unlisted in a hangar (candidate for a sell order). 'listed' = inside an open sell order, waiting to sell.">Status</Tip>{indInv('status')}</th>
                <th className="sortable" onClick={() => clickInv('qty')}><Tip tip="Units ACTUALLY held right now (verified against your characters' assets — consumed or moved items drop off automatically).">Qty</Tip>{indInv('qty')}</th>
                <th className="sortable" onClick={() => clickInv('unit')}><Tip tip="Average price you paid per unit (oldest-first lots).">Avg cost</Tip>{indInv('unit')}</th>
                <th className="sortable" onClick={() => clickInv('cost')}><Tip tip="Total ISK sunk into this stock.">Tied up</Tip>{indInv('cost')}</th>
                <th className="sortable" onClick={() => clickInv('age')}><Tip tip="Age of the OLDEST unsold lot — big numbers mean stock that isn't moving (or personal items that shouldn't be on the books).">Oldest</Tip>{indInv('age')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedInv.slice(0, 100).map((r, i) => (
                <tr key={`${r.typeId}-${r.charId ?? 'x'}-${r.status}-${i}`}>
                  <td className="hub-name">{r.name}</td>
                  <td className="dim">{r.category}</td>
                  <td className="dim">{r.charId !== null ? ownerLabel(r.charId) : '—'}</td>
                  <td className="dim">{r.where}</td>
                  <td>
                    {r.status === 'listed'
                      ? <span className="flag info">listed</span>
                      : <span className="flag warn" title="Unlisted stock — it earns nothing sitting in a hangar.">hangar</span>}
                  </td>
                  <td className="dim">{int(r.qty)}</td>
                  <td>{r.unitCost > 0 ? iskShort(r.unitCost) : <span className="dim" title="No purchase on the books for this item (loot, gift, or pre-app stock) — cost unknown.">—</span>}</td>
                  <td>{r.cost > 0 ? iskShort(r.cost) : <span className="dim">—</span>}</td>
                  <td className={r.ageDays > 30 ? 'neg' : 'dim'}>{r.ageDays > 0 ? `${r.ageDays.toFixed(0)}d` : '—'}</td>
                  <td className="row-actions">
                    <button className="btn mini" title="Item details in a popup"
                      onClick={() => setDetailTypeId(r.typeId)}>
                      details
                    </button>
                    <button className="btn mini" title="Open this item's market window in the EVE client"
                      onClick={() => openMarketWindowEverywhere(r.typeId).catch(() => {})}>
                      game
                    </button>
                    <button className="btn mini" title="Exclude this item from the books entirely (a ship you fly isn't stock) — reversible in Settings"
                      onClick={() => toggleExcludeBooks(r.typeId)}>
                      exclude
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
    </>
  );
}
