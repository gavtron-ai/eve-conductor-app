import { useEffect, useMemo, useState } from 'react';
import { fetchHistory } from '../lib/market';
import { useElementWidth } from '../lib/useElementWidth';
import { useHubs } from '../lib/store';
import { isk, iskShort, int } from '../lib/format';
import type { HistoryDay } from '../lib/types';

const REGION_NAMES: Record<number, string> = {
  10000002: 'The Forge (Jita)',
  10000043: 'Domain (Amarr)',
  10000032: 'Sinq Laison (Dodixie)',
  10000030: 'Heimatar (Rens)',
  10000042: 'Metropolis (Hek)',
};

const RANGES = [30, 90, 180, 365] as const;

// layout constants (px)
const ML = 60, MR = 12, MT = 8;
const PRICE_H = 190, GAP = 26, VOL_H = 56, XLBL = 22;
const TOTAL_H = MT + PRICE_H + GAP + VOL_H + XLBL;

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? mag * 10;
  const start = Math.ceil(min / step) * step;
  const out: number[] = [];
  for (let v = start; v <= max + 1e-9; v += step) out.push(v);
  return out;
}

export default function HistoryChart({ typeId }: { typeId: number }) {
  const hubs = useHubs();
  // one tab per distinct region among the active hubs
  const regions = useMemo(() => {
    const seen = new Map<number, string>();
    for (const h of hubs) {
      if (!seen.has(h.regionId)) {
        seen.set(h.regionId, REGION_NAMES[h.regionId] ?? `${h.name} region`);
      }
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [hubs]);

  const [regionId, setRegionId] = useState(regions[0]?.id ?? 10000002);
  const [range, setRange] = useState<(typeof RANGES)[number]>(90);
  const [days, setDays] = useState<HistoryDay[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<{ i: number; px: number; py: number } | null>(null);
  // three-path width tracking — a bare ResizeObserver can stay silent
  // forever (lib/useElementWidth.ts), which would pin this at its default
  const [wrapRef, width] = useElementWidth(320, 800);

  useEffect(() => {
    if (!regions.some((r) => r.id === regionId) && regions.length > 0) {
      setRegionId(regions[0].id);
    }
  }, [regions, regionId]);

  useEffect(() => {
    let alive = true;
    setDays(null);
    setError(null);
    setHover(null);
    fetchHistory(regionId, typeId)
      .then((d) => alive && setDays(d))
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [regionId, typeId]);

  const view = useMemo(() => (days ? days.slice(-range) : []), [days, range]);

  const plotW = Math.max(50, width - ML - MR);
  const n = view.length;

  const geom = useMemo(() => {
    if (n === 0) return null;
    let pMin = Infinity, pMax = -Infinity, vMax = 0;
    for (const d of view) {
      pMin = Math.min(pMin, d.lowest);
      pMax = Math.max(pMax, d.highest);
      vMax = Math.max(vMax, d.volume);
    }
    if (pMin === pMax) { pMin *= 0.95; pMax *= 1.05; }
    const pad = (pMax - pMin) * 0.06;
    pMin = Math.max(0, pMin - pad);
    pMax += pad;
    const x = (i: number) => ML + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yP = (v: number) => MT + PRICE_H - ((v - pMin) / (pMax - pMin)) * PRICE_H;
    const volTop = MT + PRICE_H + GAP;
    const yV = (v: number) => volTop + VOL_H - (vMax > 0 ? (v / vMax) * VOL_H : 0);
    const line = view.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yP(d.average).toFixed(1)}`).join('');
    const band =
      view.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${yP(d.highest).toFixed(1)}`).join('') +
      [...view].reverse().map((d, j) => `L${x(n - 1 - j).toFixed(1)},${yP(d.lowest).toFixed(1)}`).join('') +
      'Z';
    return { pMin, pMax, vMax, x, yP, yV, volTop, line, band };
  }, [view, n, plotW]);

  function onMove(e: React.MouseEvent<SVGSVGElement>) {
    if (!geom || n === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const frac = (mx - ML) / plotW;
    const i = Math.max(0, Math.min(n - 1, Math.round(frac * (n - 1))));
    setHover({ i, px: e.clientX - rect.left, py: e.clientY - rect.top });
  }

  const hovered = hover && view[hover.i] ? view[hover.i] : null;

  return (
    <div className="panel">
      <h2>
        Price history
        <span className="sub">daily average with high–low band · region-wide (ESI)</span>
      </h2>
      <div className="chart-controls">
        {regions.map((r) => (
          <button
            key={r.id}
            className={`chip ${r.id === regionId ? 'on' : ''}`}
            onClick={() => setRegionId(r.id)}
          >
            {r.name}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {RANGES.map((d) => (
          <button key={d} className={`chip ${d === range ? 'on' : ''}`} onClick={() => setRange(d)}>
            {d}d
          </button>
        ))}
      </div>
      <div className="chart-wrap" ref={wrapRef}>
        {error && <div className="empty">History unavailable: {error}</div>}
        {!error && !days && <div className="empty">Loading history…</div>}
        {!error && days && n === 0 && <div className="empty">No trades recorded.</div>}
        {!error && geom && n > 0 && (
          <svg
            width={width}
            height={TOTAL_H}
            onMouseMove={onMove}
            onMouseLeave={() => setHover(null)}
            style={{ display: 'block' }}
          >
            {/* price grid + y labels */}
            {niceTicks(geom.pMin, geom.pMax).map((t) => (
              <g key={`p${t}`}>
                <line x1={ML} x2={ML + plotW} y1={geom.yP(t)} y2={geom.yP(t)} stroke="var(--grid)" />
                <text x={ML - 8} y={geom.yP(t) + 4} textAnchor="end" fontSize="10"
                  fill="var(--muted)" style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {iskShort(t)}
                </text>
              </g>
            ))}
            {/* high-low band + average line */}
            <path d={geom.band} fill="var(--accent)" opacity={0.14} />
            <path d={geom.line} fill="none" stroke="var(--accent)" strokeWidth={2} />
            {/* volume panel */}
            <text x={ML} y={geom.volTop - 7} fontSize="10" fill="var(--muted)">
              VOLUME (units/day) · max {int(geom.vMax)}
            </text>
            <line x1={ML} x2={ML + plotW} y1={geom.volTop + VOL_H} y2={geom.volTop + VOL_H}
              stroke="var(--baseline)" />
            {view.map((d, i) => {
              const step = plotW / n;
              const bw = Math.max(1, Math.min(step - 2, step * 0.7));
              return (
                <rect
                  key={d.date}
                  x={geom.x(i) - bw / 2}
                  y={geom.yV(d.volume)}
                  width={bw}
                  height={geom.volTop + VOL_H - geom.yV(d.volume)}
                  fill="var(--accent-dim)"
                  rx={1}
                />
              );
            })}
            {/* x labels */}
            {view
              .map((d, i) => ({ d, i }))
              .filter(({ i }) => i % Math.max(1, Math.floor(n / 6)) === 0)
              .map(({ d, i }) => (
                <text key={`x${d.date}`} x={geom.x(i)} y={geom.volTop + VOL_H + 15}
                  textAnchor="middle" fontSize="10" fill="var(--muted)">
                  {d.date.slice(5)}
                </text>
              ))}
            {/* crosshair */}
            {hovered && hover && (
              <g pointerEvents="none">
                <line x1={geom.x(hover.i)} x2={geom.x(hover.i)} y1={MT}
                  y2={geom.volTop + VOL_H} stroke="var(--muted)" strokeDasharray="3 3" />
                <circle cx={geom.x(hover.i)} cy={geom.yP(hovered.average)} r={4}
                  fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
              </g>
            )}
          </svg>
        )}
        {hovered && hover && (
          <div
            className="chart-tip"
            style={{
              left: Math.min(hover.px + 14, Math.max(0, width - 190)),
              top: Math.max(0, hover.py - 90),
            }}
          >
            <div className="d">{hovered.date}</div>
            <div className="row"><span>Average</span><span>{isk(hovered.average)}</span></div>
            <div className="row"><span>High</span><span>{isk(hovered.highest)}</span></div>
            <div className="row"><span>Low</span><span>{isk(hovered.lowest)}</span></div>
            <div className="row"><span>Volume</span><span>{int(hovered.volume)}</span></div>
            <div className="row"><span>Orders</span><span>{int(hovered.order_count)}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}
