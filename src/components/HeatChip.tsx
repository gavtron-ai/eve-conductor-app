import type { Heat } from '../lib/heat';
import { heatTip, heatAge } from '../lib/heat';

/** Undercut-heat chip: green quiet market, orange knife fight. */
export default function HeatChip({ heat, side = 'sell' }: { heat: Heat | null | undefined; side?: 'sell' | 'buy' }) {
  if (heat === undefined) return <span className="dim">…</span>;
  if (heat === null) return <span className="dim" title="No orders on this side of the book here — you'd be first.">—</span>;
  const cls = heat.level === 'hot' ? 'flag warn' : heat.level === 'warm' ? 'flag info' : 'flag good';
  const label =
    heat.level === 'hot'
      ? `🔥 ${heat.rivals} · ${heatAge(heat.freshestMs)}`
      : heat.level === 'warm'
        ? `~ ${heat.rivals} · ${heatAge(heat.freshestMs)}`
        : `quiet · ${heatAge(heat.freshestMs)}`;
  return (
    <span className={cls} title={heatTip(heat, side)}>
      {label}
    </span>
  );
}
