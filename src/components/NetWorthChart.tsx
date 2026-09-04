import { useEffect, useState } from 'react';
import { loadNetWorthSeries, type NetWorthSnap } from '../lib/networth';
import { iskShort } from '../lib/format';
import Tip from './Tip';

// fixed series order & colors (5-slot stack validated on the app surface
// #1a1a19; the one 6.9-ΔE adjacent pair is covered by the labeled legend
// and the 2px surface gaps — the validator's secondary-encoding rule)
const LAYERS = [
  { key: 'stock' as const, label: 'Hangar stock', color: '#3987e5', tip: 'Trader-held hangar stock, marked at the current JITA ask — the one yardstick every layer uses (ledger cost only when the item has no Jita market).' },
  // NOTE: this array is built at MODULE LOAD, before persisted settings are
  // read, so it must not try to interpolate the configured ship name — it
  // describes the setting instead.
  { key: 'transit' as const, label: 'In transit', color: '#d55181', tip: "Goods on the move: the hold of the ship you named as your transit ship (Settings → Your setup), plus anything in the HAULER's hangars. Other ships' cargo is personal and never counted." },
  { key: 'listed' as const, label: 'In sell orders', color: '#008300', tip: 'Stock sitting inside open sell orders, same mark-to-market.' },
  { key: 'escrow' as const, label: 'Buy-order escrow', color: '#c98500', tip: 'ISK committed to open buy orders — goods not yet delivered.' },
  { key: 'wallets' as const, label: 'Wallets', color: '#9085e9', tip: "The team's liquid ISK (refreshed at every snapshot)." },
];

const W = 960;
const H = 240;
const PAD = { l: 8, r: 8, t: 10, b: 22 };

/** bucket to ≤ n points, always keeping the newest */
function downsample(s: NetWorthSnap[], n = 240): NetWorthSnap[] {
  if (s.length <= n) return s;
  const step = s.length / n;
  const out: NetWorthSnap[] = [];
  for (let i = 0; i < n - 1; i++) out.push(s[Math.floor(i * step)]);
  out.push(s[s.length - 1]);
  return out;
}

/** The master picture: the team's trading value over time, stacked. */
export default function NetWorthChart() {
  const [series, setSeries] = useState<NetWorthSnap[] | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => void loadNetWorthSeries().then((s) => alive && setSeries(s));
    load();
    const t = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const data = downsample(series ?? []);
  const latest = data[data.length - 1];

  return (
    <div className="panel">
      <h2>
        <Tip tip="Your whole trading position over time, stacked bottom-up: hangar stock → stock in sell orders → buy-order escrow → wallets. The top edge is your total trading value — the line that should rise. EVERY goods layer is marked at the JITA ask — what it would fetch via a sell order in Jita, wherever it sits — so the line moves when your TRADING creates value, not when goods hop between differently-priced hubs (yardstick unified 2026-07-23; older points used Amarr-first marks, so there may be one small step there). Wallet balances are FRESH at every snapshot. Honest wobbles that are NOT losses: a sale dips the total by the sales tax (cash in = price minus tax); a filled buy order can dip for up to ~1h because EVE's assets endpoint lags behind the escrow release; rivals undercutting lowers the MARK of unsold stock. Snapshots record on ≥0.5% moves (or 6-hourly), kept forever in the Do-Not-Delete folder; the timeline starts when this feature first ran (EVE keeps no asset history).">Trading value</Tip>
        {latest && (
          <span className="sub">
            total {iskShort(latest.stock + latest.transit + latest.listed + latest.escrow + latest.wallets)} ISK
          </span>
        )}
        <span className="panel-filter" style={{ display: 'inline-flex', gap: 14 }}>
          {LAYERS.map((l) => (
            <span key={l.key} className="nw-legend" title={l.tip}>
              <span className="nw-swatch" style={{ background: l.color }} />
              {l.label}
              {latest && <span className="dim"> {iskShort(latest[l.key])}</span>}
            </span>
          ))}
        </span>
      </h2>
      {data.length < 2 ? (
        <div className="empty">
          Recording started{latest ? ` ${new Date(latest.t).toLocaleString()}` : ' — first snapshot lands with the next watcher pass'}.
          The timeline grows from here (EVE keeps no asset history to backfill) and survives updates.
        </div>
      ) : (
        (() => {
          const t0 = data[0].t;
          const t1 = data[data.length - 1].t;
          const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
          const totals = data.map((d) => d.stock + d.transit + d.listed + d.escrow + d.wallets);
          const maxY = Math.max(1, ...totals);
          const y = (v: number) => H - PAD.b - (v / maxY) * (H - PAD.t - PAD.b);
          // cumulative tops per layer
          const cum = data.map((d) => {
            const c1 = d.stock;
            const c2 = c1 + d.transit;
            const c3 = c2 + d.listed;
            const c4 = c3 + d.escrow;
            const c5 = c4 + d.wallets;
            return [c1, c2, c3, c4, c5];
          });
          const line = (li: number) => data.map((d, i) => `${x(d.t)},${y(cum[i][li])}`).join(' ');
          const area = (li: number) => {
            const top = data.map((d, i) => `${x(d.t)},${y(cum[i][li])}`).join(' ');
            const bottom =
              li === 0
                ? `${x(t1)},${y(0)} ${x(t0)},${y(0)}`
                : data
                    .slice()
                    .reverse()
                    .map((d) => {
                      const i = data.indexOf(d);
                      return `${x(d.t)},${y(cum[i][li - 1])}`;
                    })
                    .join(' ');
            return `${top} ${bottom}`;
          };
          return (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
              {LAYERS.map((l, li) => (
                <polygon key={l.key} points={area(li)} fill={l.color} opacity={0.85} />
              ))}
              {/* 2px surface gaps between stacked fills */}
              {LAYERS.map((l, li) => (
                <polyline key={`b-${l.key}`} points={line(li)} fill="none" stroke="var(--surface)" strokeWidth={2} />
              ))}
              {/* hoverable data points on every boundary */}
              {data.map((d, i) =>
                LAYERS.map((l, li) => (
                  <circle key={`${d.t}-${l.key}`} cx={x(d.t)} cy={y(cum[i][li])} r={3.5}
                    fill={l.color} stroke="var(--surface)" strokeWidth={2}>
                    <title>
                      {`${new Date(d.t).toLocaleString()}\n${l.label}: ${iskShort(d[l.key])} ISK\nstack to here: ${iskShort(cum[i][li])}\nTOTAL: ${iskShort(cum[i][4])} ISK`}
                    </title>
                  </circle>
                )),
              )}
              <text x={PAD.l} y={H - 6} fill="var(--muted)" fontSize={10}>{new Date(t0).toLocaleDateString()}</text>
              <text x={W - PAD.r} y={H - 6} fill="var(--muted)" fontSize={10} textAnchor="end">{new Date(t1).toLocaleDateString()}</text>
              <text x={PAD.l} y={PAD.t + 4} fill="var(--muted)" fontSize={10}>{iskShort(maxY)} ISK</text>
            </svg>
          );
        })()
      )}
    </div>
  );
}
