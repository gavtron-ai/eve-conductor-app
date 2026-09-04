import { useEffect, useMemo, useState } from 'react';
import { loadRadarSummary, loadRadarCoverage, normalizedRates, radarRegions, coveredMs, type SummaryEntry, type RegionCoverage } from '../lib/radar';
import { getType, findByName } from '../lib/typedb';
import { regionName } from '../lib/mapdata';
import { useSort } from '../lib/useSort';
import { iskShort, int } from '../lib/format';
import Tip from './Tip';
import ItemDetailModal from './ItemDetailModal';
import SellingChip from './SellingChip';
import StockChip from './StockChip';
import { openMarketWindowEverywhere } from '../lib/esiChar';

interface Row {
  key: string;
  regionId: number;
  typeId: number;
  name: string;
  side: 'sell' | 'buy';
  days: number;
  rpDay1: number;
  rpDay7: number;
  rpDay30: number;
  heatTrend: number | null; // rp7/rp30
  competitors: number;
  fkDay7: number;
  fkDay30: number;
  fillTrend: number | null;
  hfa: number[];
  hra: number[];
}

type Col = 'name' | 'side' | 'rp7' | 'trend' | 'co' | 'fk7' | 'ftrend' | 'days';

function TrendChip({ ratio, kind }: { ratio: number | null; kind: 'war' | 'flow' }) {
  if (ratio === null) return <span className="dim">—</span>;
  const rising = ratio >= 1.25;
  const falling = ratio <= 0.8;
  const label = rising ? (kind === 'war' ? '🌡 heating' : '📈 rising') : falling ? (kind === 'war' ? '❄ cooling' : '📉 fading') : '→ steady';
  const cls = rising ? (kind === 'war' ? 'flag warn' : 'flag good') : falling ? 'flag info' : 'flag good';
  return <span className={cls} title={`last 7 days vs last 30 days: ${ratio.toFixed(2)}× — measured directly from full-book snapshots every ~30 min, not from ESI's day-old history.`}>{label}</span>;
}

function HourStrip({ counts, unit }: { counts: number[]; unit: string }) {
  const max = Math.max(1e-9, ...counts);
  return (
    <span className="trend-strip" title="EVE-time hours, 00→24 — darker = more. Normalized per OBSERVED interval, so hours the app was off show as unobserved, not quiet.">
      {counts.map((c, i) => (
        <span key={i} className="trend-cell"
          style={c > 0 ? { background: `rgba(57, 135, 229, ${0.15 + 0.85 * (c / max)})` } : undefined}
          title={`${String(i).padStart(2, '0')}:00 EVE — ${unit === 'ISK' ? iskShort(c) : c >= 10 ? int(c) : c.toFixed(2)} ${unit} per observed interval`} />
      ))}
    </span>
  );
}

/** FULL-MARKET RADAR: every item, both sides, in the duty hubs' regions. */
export default function Radar() {
  const [summary, setSummary] = useState<SummaryEntry[] | null>(null);
  const [coverage, setCoverage] = useState<Map<number, RegionCoverage>>(new Map());
  const [regionId, setRegionId] = useState<number>(radarRegions()[0] ?? 10000002);
  const [side, setSide] = useState<'sell' | 'buy' | 'both'>('sell');
  const [minFk, setMinFk] = useState<number>(10); // millions/day
  const [query, setQuery] = useState('');
  const [detailTypeId, setDetailTypeId] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      void loadRadarSummary().then((s) => alive && setSummary(s));
      void loadRadarCoverage().then((c) => alive && setCoverage(c));
    };
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const rows = useMemo((): Row[] => {
    if (!summary) return [];
    const qId = query.trim() ? findByName(query.trim())?.id : null;
    const cov = coverage.get(regionId);
    return summary
      .filter((e) => e.r === regionId && (side === 'both' || (side === 'sell' ? e.s === 0 : e.s === 1)))
      .filter((e) => (qId ? e.t === qId : true))
      .map((e) => {
        // COVERAGE-normalized rates: only observed intervals vote, so hours
        // and days the app was off don't read as a quiet market
        const n7 = normalizedRates(e, cov, 7);
        const n30 = normalizedRates(e, cov, 30);
        const rp7 = n7?.rp ?? 0;
        const rp30 = n30?.rp ?? 0;
        const fk7 = n7?.fk ?? 0;
        const fk30 = n30?.fk ?? 0;
        const hfa = e.hfa.map((v, h) => (cov && cov.cva[h] > 0 ? v / cov.cva[h] : cov ? 0 : v));
        const hra = e.hra.map((v, h) => (cov && cov.cva[h] > 0 ? v / cov.cva[h] : cov ? 0 : v));
        return {
          key: `${e.r}:${e.t}:${e.s}`,
          regionId: e.r,
          typeId: e.t,
          name: getType(e.t)?.name ?? `#${e.t}`,
          side: (e.s === 0 ? 'sell' : 'buy') as 'sell' | 'buy',
          days: e.days.length,
          rpDay1: e.days[e.days.length - 1]?.rp ?? 0,
          rpDay7: rp7,
          rpDay30: rp30,
          heatTrend: e.days.length >= 8 && rp30 > 0 ? rp7 / rp30 : null,
          competitors: e.days[e.days.length - 1]?.co ?? 0,
          fkDay7: fk7,
          fkDay30: fk30,
          fillTrend: e.days.length >= 8 && fk30 > 0 ? fk7 / fk30 : null,
          hfa,
          hra,
        };
      })
      .filter((r) => qId || r.fkDay7 >= minFk * 1e6 || r.rpDay7 >= 5);
  }, [summary, coverage, regionId, side, minFk, query]);

  const { sorted, clickHeader, indicator } = useSort<Row, Col>(
    rows,
    {
      name: (r) => r.name,
      side: (r) => r.side,
      rp7: (r) => r.rpDay7,
      trend: (r) => r.heatTrend,
      co: (r) => r.competitors,
      fk7: (r) => r.fkDay7,
      ftrend: (r) => r.fillTrend,
      days: (r) => r.days,
    },
    { key: 'fk7', dir: 'desc' },
  );

  const totalDays = summary ? Math.max(0, ...summary.map((e) => e.days.length)) : 0;
  // how much of the last 7 days this region was actually observed
  const covPct7 = (() => {
    const cov = coverage.get(regionId);
    if (!cov) return null;
    const cutoff = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
    // observed TIME, not tick count — the sweep cadence is allowed to change
    // (and a diff after a failed snapshot covers a double-width window)
    const ms = cov.days
      .filter((d) => d.d > cutoff)
      .reduce((s, d) => s + coveredMs(d), 0);
    return Math.min(1, ms / (7 * 86_400_000));
  })();

  return (
    <div className="panel">
      <h2>
        <Tip tip="The whole market, measured directly: every ~30 minutes the radar snapshots the ENTIRE order book of your trading regions and diffs it — reprices (war tempo), fills (real flow, BOTH sides of the book), competitor counts, all per item, kept forever. Nothing here relies on ESI's day-old history; the numbers are at most ~30 minutes old. Your own orders are excluded from war/competitor counts.">Market radar</Tip>
        <span className="sub">
          every item · both sides · {radarRegions().map((r) => regionName(r)).join(' + ')} · {totalDays} day(s) of data
          {covPct7 !== null && (
            <span title="How much of the last 7 days the radar was actually watching this region. All rates are normalized to OBSERVED time — an off laptop doesn't make the market look quiet, those moments just don't count.">
              {' '}· observed {Math.round(covPct7 * 100)}% of the last 7d
            </span>
          )}
        </span>
      </h2>
      <div className="finder-form">
        <label>
          <span>Region</span>
          <select value={regionId} onChange={(e) => setRegionId(Number(e.target.value))}>
            {radarRegions().map((r) => (
              <option key={r} value={r}>{regionName(r)}</option>
            ))}
          </select>
        </label>
        <label title="sell = the ask-side war (undercutting sellers). buy = the bid-side war (competing buy orders).">
          <span>Side</span>
          <select value={side} onChange={(e) => setSide(e.target.value as 'sell' | 'buy' | 'both')}>
            <option value="sell">Sell side</option>
            <option value="buy">Buy side</option>
            <option value="both">Both</option>
          </select>
        </label>
        <label title="Hide items with less flow than this (millions ISK/day, 7-day average) — unless they have a hot reprice war.">
          <span>Min flow (m/day)</span>
          <input type="number" min={0} value={minFk} onChange={(e) => setMinFk(Math.max(0, Number(e.target.value) || 0))} />
        </label>
        <label title="Exact item name — shows that item regardless of filters.">
          <span>Item</span>
          <input type="text" value={query} placeholder="exact name…" onChange={(e) => setQuery(e.target.value)} style={{ width: 180 }} />
        </label>
      </div>
      {summary === null && <div className="empty">Loading radar data…</div>}
      {summary !== null && rows.length === 0 && (
        <div className="empty">
          No radar data yet{totalDays === 0 ? ' — the first snapshot is a baseline; diffs (and this table) begin ~30 minutes later and deepen every day' : ' matching these filters'}.
        </div>
      )}
      {rows.length > 0 && (
        <table className="data">
          <thead>
            <tr>
              <th className="sortable" onClick={() => clickHeader('name')}>Item{indicator('name')}</th>
              <th className="sortable" onClick={() => clickHeader('side')}><Tip tip="Which side of the book this row measures.">Side</Tip>{indicator('side')}</th>
              <th className="sortable" onClick={() => clickHeader('rp7')}><Tip tip="Reprices per day (7-day average) — how fast the war moves. Today's live value in the tooltip.">War/day</Tip>{indicator('rp7')}</th>
              <th className="sortable" onClick={() => clickHeader('trend')}><Tip tip="War tempo, last 7 days vs last 30: 🌡 heating = competitors flowing in, ❄ cooling = leaving. Needs ≥8 days of radar coverage.">Heat trend</Tip>{indicator('trend')}</th>
              <th className="sortable" onClick={() => clickHeader('co')}><Tip tip="Distinct competing orders on this side right now (latest day's max; your own orders excluded).">Rivals</Tip>{indicator('co')}</th>
              <th className="sortable" onClick={() => clickHeader('fk7')}><Tip tip="Observed fill flow, ISK per day (7-day average) — real trades measured from volume drops, not listings.">Flow/day</Tip>{indicator('fk7')}</th>
              <th className="sortable" onClick={() => clickHeader('ftrend')}><Tip tip="Fill flow, last 7 days vs last 30 — demand direction.">Flow trend</Tip>{indicator('ftrend')}</th>
              <th><Tip tip="When this item's fills land (all-time, EVE hours) — the reprice windows worth fighting for.">Sale hours</Tip></th>
              <th><Tip tip="When this item's reprice war is fought (all-time, EVE hours).">War hours</Tip></th>
              <th className="sortable" onClick={() => clickHeader('days')}>Days{indicator('days')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, 200).map((r) => (
              <tr key={r.key}>
                <td className="hub-name">{r.name}<SellingChip typeId={r.typeId} /><StockChip typeId={r.typeId} /></td>
                <td>{r.side === 'sell' ? <span className="flag good">sell</span> : <span className="flag info">buy</span>}</td>
                <td title={`today so far: ${int(r.rpDay1)} · 30d avg: ${r.rpDay30.toFixed(1)}`}>{r.rpDay7.toFixed(1)}</td>
                <td><TrendChip ratio={r.heatTrend} kind="war" /></td>
                <td className="dim">{int(r.competitors)}</td>
                <td title={`30d avg: ${iskShort(r.fkDay30)}/day`}>{iskShort(r.fkDay7)}</td>
                <td><TrendChip ratio={r.fillTrend} kind="flow" /></td>
                <td><HourStrip counts={r.hfa} unit="ISK" /></td>
                <td><HourStrip counts={r.hra} unit="reprices" /></td>
                <td className="dim">{r.days}</td>
                <td className="row-actions">
                  <button className="btn mini" title="Item details in a popup — the radar stays right here"
                    onClick={() => setDetailTypeId(r.typeId)}>details</button>
                  <button className="btn mini" title="Open this item's market window in the EVE client"
                    onClick={() => openMarketWindowEverywhere(r.typeId).catch(() => {})}>game</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="hint">
        The radar diffs full-region books every ~30 minutes: reprices = war tempo, volume drops =
        real fills (both sides — sellers dumping into bids show on the buy side). Every number is
        normalized to OBSERVED time: when the app is off, those hours are marked unobserved and
        excluded — they never read as "the market went quiet". Daily rollups accumulate forever
        in the Do-Not-Delete folder (radar-*.ndjson; excluded from backup files — the folder
        itself carries them). Trends need ≥8 days of data; hour strips sharpen daily.
      </div>
      {detailTypeId !== null && <ItemDetailModal typeId={detailTypeId} onClose={() => setDetailTypeId(null)} />}
    </div>
  );
}
