// DASHLET FURNITURE (v0.209.0) — the few parts every dashlet is built from, so they all lay out
// the same way at every size:
//   <Head>    the headline: one big figure and a line under it. NEVER clipped or squeezed.
//   <Detail>  what a bigger version adds (a list, tiles, a chart). It takes the room that is left
//             and hides what does not fit WHOLE — never half a row.
//   <Foot>    the age / source line, always at the bottom.
// Small shows Head + Foot; Medium puts Head on the left and Detail on the right (a medium dashlet
// is wide and short); Large and Wide stack them.
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { maxOf, minOf } from '../lib/nums';

export const Head = ({ big, color, sub, title }: { big: ReactNode; color?: string; sub?: ReactNode; title?: string }) => (
  <div className="dl-head" title={title}>
    <div className="dl-big" style={color ? { color } : undefined}>{big}</div>
    {sub !== undefined && <div className="dl-sub">{sub}</div>}
  </div>
);
export const Detail = ({ children, className = '' }: { children: ReactNode; className?: string }) => <div className={`dl-detail ${className}`}>{children}</div>;
export const Foot = ({ children, warn }: { children: ReactNode; warn?: boolean }) => <div className={`dl-foot${warn ? ' warn' : ''}`}>{children}</div>;
export const Empty = ({ children }: { children: ReactNode }) => <div className="dl-empty">{children}</div>;
export const Dot = ({ color }: { color: string }) => <span className="dl-dot" style={{ background: color }} />;
export const Row = ({ children, onClick, title, className = '' }: { children: ReactNode; onClick?: () => void; title?: string; className?: string }) => (
  <div className={`dl-row${onClick ? ' link' : ''} ${className}`} onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined} title={title}>{children}</div>
);

/** a list that shows only the rows that fit whole: every row is laid out, then the ones that would
 * be cut by the bottom edge are hidden — measured on the DOM, so it follows any size or zoom */
export function FitList({ children, className = '', style }: { children: ReactNode; className?: string; style?: CSSProperties }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      const room = el.clientHeight;
      for (const kid of Array.from(el.children) as HTMLElement[]) {
        kid.style.visibility = '';
        kid.style.visibility = kid.offsetTop + kid.offsetHeight > room + 1 ? 'hidden' : '';
      }
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  });
  return <div ref={ref} className={`dl-list dl-fit ${className}`} style={style}>{children}</div>;
}

export const typeIcon = (id: number, size = 32) => `https://images.evetech.net/types/${id}/icon?size=${size}`;
export const shipRender = (id: number, size = 64) => `https://images.evetech.net/types/${id}/render?size=${size}`;
export const charFace = (id: number) => `https://images.evetech.net/characters/${id}/portrait?size=64`;
export const corpLogo = (id: number) => `https://images.evetech.net/corporations/${id}/logo?size=64`;
export const Img = ({ src, className = 'dl-icon', title }: { src: string; className?: string; title?: string }) => (
  <img className={className} src={src} alt="" title={title} loading="lazy" onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
);

export function Spark({ points, color, height = 34, fill = false }: { points: { t: number; v: number }[]; color: string; height?: number; fill?: boolean }) {
  if (points.length < 2) return null;
  const W = 200, H = 60;
  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const lo = minOf(points.map((p) => p.v)), hi = maxOf(points.map((p) => p.v));
  const x = (t: number) => (t1 === t0 ? 0 : ((t - t0) / (t1 - t0)) * W);
  const y = (v: number) => (hi === lo ? H / 2 : H - 3 - ((v - lo) / (hi - lo)) * (H - 6));
  const d = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={`dl-spark${fill ? ' fill' : ''}`} style={fill ? undefined : { height }}>
      <path d={`${d} L${W},${H} L0,${H} Z`} fill={color} opacity={0.14} />
      <path d={d} fill="none" stroke={color} strokeWidth={1.6} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

/** 24 bars, one per EVE hour; the peak hour is lit */
export function Hist24({ hours, color, peak }: { hours: number[]; color: string; peak: number | null }) {
  const max = Math.max(1, maxOf(hours));
  return (
    <div className="dl-hist" title="by EVE hour of day, 00 → 23">
      <div className="dl-hist-bars">
        {hours.map((n, h) => <i key={h} title={`${String(h).padStart(2, '0')}:00 EVE — ${n}`} style={{ height: `${Math.max(n > 0 ? 6 : 1, (n / max) * 100)}%`, background: color, opacity: h === peak ? 1 : n > 0 ? 0.55 : 0.18 }} />)}
      </div>
      <div className="dl-hist-axis"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
    </div>
  );
}

/** bars that may go below zero (profit by day) */
export function DayBars({ bars, fmt }: { bars: { day: string; v: number }[]; fmt: (v: number) => string }) {
  const hi = Math.max(0, maxOf(bars.map((b) => b.v))), lo = Math.min(0, minOf(bars.map((b) => b.v)));
  const span = hi - lo || 1;
  const zero = (hi / span) * 100;
  return (
    <div className="dl-daybars">
      {bars.map((b) => {
        const h = (Math.abs(b.v) / span) * 100;
        return (
          <div key={b.day} className="dl-daybar" title={`${b.day} — ${fmt(b.v)}`}>
            <i style={{ top: `${b.v >= 0 ? zero - h : zero}%`, height: `${Math.max(b.v === 0 ? 0 : 1.5, h)}%`, background: b.v >= 0 ? 'var(--good)' : 'var(--bad)' }} />
          </div>
        );
      })}
      <span className="dl-zero" style={{ top: `${zero}%` }} />
    </div>
  );
}

export function StackBar({ parts }: { parts: { key: string; label: string; color: string; frac: number; text: string }[] }) {
  return (
    <div className="dl-stack">
      <div className="dl-stack-bar">{parts.filter((p) => p.frac > 0).map((p) => <i key={p.key} style={{ flexGrow: p.frac, background: p.color }} title={`${p.label} — ${p.text}`} />)}</div>
    </div>
  );
}
