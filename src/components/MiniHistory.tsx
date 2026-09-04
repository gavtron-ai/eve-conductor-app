import { useEffect, useState } from 'react';
import { fetchHistory } from '../lib/market';
import { isk, int } from '../lib/format';
import type { HistoryDay } from '../lib/types';

const DAYS = 14;
const W = 112;
const H = 26;

/**
 * Two weeks of daily trades in the target region as tiny bars (height = units
 * sold). Hover a bar: date, units sold, min / avg / max price actually paid.
 * Region-level — ESI has no per-station history.
 */
export default function MiniHistory({ regionId, typeId }: { regionId: number; typeId: number }) {
  const [days, setDays] = useState<(HistoryDay | null)[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetchHistory(regionId, typeId)
      .then((rows) => {
        if (!alive) return;
        const byDate = new Map(rows.map((r) => [r.date, r]));
        const out: (HistoryDay | null)[] = [];
        for (let i = DAYS - 1; i >= 0; i--) {
          const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
          out.push(byDate.get(d) ?? null);
        }
        setDays(out);
      })
      .catch(() => alive && setDays([]));
    return () => {
      alive = false;
    };
  }, [regionId, typeId]);

  if (days === null) return <span className="dim">…</span>;
  if (days.length === 0) return <span className="dim">—</span>;

  const maxVol = Math.max(1, ...days.map((d) => d?.volume ?? 0));
  const slot = W / DAYS;
  const bw = Math.max(2, slot - 2);
  return (
    <svg width={W} height={H} className="mini-history" role="img">
      <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} stroke="var(--baseline)" strokeWidth={1} />
      {days.map((d, i) => {
        const x = i * slot + 1;
        const vol = d?.volume ?? 0;
        const h = vol > 0 ? Math.max(2, (vol / maxVol) * (H - 4)) : 0;
        const date = new Date(Date.now() - (DAYS - 1 - i) * 86_400_000).toISOString().slice(0, 10);
        return (
          <g key={i}>
            {/* invisible full-height hit area so tiny bars are hoverable */}
            <rect x={x - 1} y={0} width={slot} height={H} fill="transparent">
              <title>
                {d
                  ? `${date} — sold ${int(d.volume)}\nmin ${isk(d.lowest)} · avg ${isk(d.average)} · max ${isk(d.highest)}`
                  : `${date} — no trades`}
              </title>
            </rect>
            {h > 0 && (
              <rect x={x} y={H - 1 - h} width={bw} height={h} rx={1.5} fill="var(--accent)"
                style={{ pointerEvents: 'none' }} />
            )}
          </g>
        );
      })}
    </svg>
  );
}
