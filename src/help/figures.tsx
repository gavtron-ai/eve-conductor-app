// HELP FIGURES — small, theme-aware building blocks for the guide pages.
// Everything is drawn from the app's own CSS variables and classes, so a
// figure looks like the real thing in light and dark, scales with the
// window, and cannot go stale the way a pasted screenshot would.
import type { ReactNode } from 'react';

const ink2 = 'var(--ink-2)';
const border = '1px solid var(--border)';

/** a framed figure with a caption underneath */
export function Fig({ caption, children }: { caption?: ReactNode; children: ReactNode }) {
  return (
    <figure style={{ margin: '4px 0 12px', padding: 10, border, borderRadius: 6, background: 'var(--surface-2)' }}>
      <div style={{ overflowX: 'auto' }}>{children}</div>
      {caption && <figcaption style={{ marginTop: 6, fontSize: 11.5, color: ink2 }}>{caption}</figcaption>}
    </figure>
  );
}

/** a numbered badge — put one in a figure, explain it in <Callouts/> */
export function N({ n }: { n: number }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      width: 16, height: 16, borderRadius: '50%', background: 'var(--accent)', color: '#fff',
      fontSize: 10, fontWeight: 800, marginRight: 4, verticalAlign: 'middle', flex: 'none',
    }}>{n}</span>
  );
}

export function Callouts({ items }: { items: { n: number; text: ReactNode }[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 10px' }}>
      {items.map((it) => (
        <li key={it.n} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', margin: '3px 0' }}>
          <N n={it.n} /><span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

/** an inline fake button, styled exactly like the real ones */
export function Btn({ children, primary, on, mini, danger, icon }: {
  children: ReactNode; primary?: boolean; on?: boolean; mini?: boolean; danger?: boolean; icon?: boolean;
}) {
  const cls = ['btn', primary ? 'primary' : '', mini ? 'mini' : '', danger ? 'danger' : '', icon ? 'icon' : '', on ? 'on' : ''].filter(Boolean).join(' ');
  return <span className={cls} style={{ pointerEvents: 'none', display: 'inline-block', verticalAlign: 'middle', margin: '0 2px' }}>{children}</span>;
}

/** a mock of the header bar: brand ▾ · tabs · right-hand tools */
export function Bar({ brand, tabs, active, right }: {
  brand: ReactNode; tabs: string[]; active?: string; right?: ReactNode;
}) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', border, borderRadius: 6,
      background: 'var(--surface)', flexWrap: 'wrap', fontSize: 12,
    }}>
      <span style={{ fontWeight: 800, letterSpacing: '0.02em' }}>{brand} <span style={{ color: ink2 }}>▾</span></span>
      <span style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        {tabs.map((t) => (
          <span key={t} style={{
            padding: '3px 8px', borderRadius: 4, border,
            background: t === active ? 'var(--accent-dim)' : 'transparent',
            color: t === active ? 'var(--ink)' : ink2, fontWeight: t === active ? 700 : 500,
          }}>{t}</span>
        ))}
      </span>
      {right && <span style={{ marginLeft: 'auto', display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>{right}</span>}
    </div>
  );
}

/** a row of stat tiles like the ones at the top of a module */
export function Tiles({ tiles }: { tiles: { big: ReactNode; sub: ReactNode; tone?: 'good' | 'bad' | 'warn' }[] }) {
  const color = (t?: string) => (t === 'good' ? 'var(--good)' : t === 'bad' ? 'var(--bad)' : t === 'warn' ? '#e0a13a' : 'var(--ink)');
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {tiles.map((t, i) => (
        <div key={i} style={{ flex: '1 1 120px', minWidth: 110, padding: '8px 10px', border, borderRadius: 6, background: 'var(--surface)' }}>
          <div style={{ fontSize: 20, fontWeight: 800, color: color(t.tone), fontVariantNumeric: 'tabular-nums' }}>{t.big}</div>
          <div style={{ fontSize: 11, color: ink2 }}>{t.sub}</div>
        </div>
      ))}
    </div>
  );
}

/** a compact table with the app's own .data styling */
export function Table({ head, rows, note }: { head: ReactNode[]; rows: ReactNode[][]; note?: ReactNode }) {
  return (
    <>
      <table className="data" style={{ fontSize: 11.5 }}>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}
        </tbody>
      </table>
      {note && <div style={{ fontSize: 11, color: ink2, marginTop: 4 }}>{note}</div>}
    </>
  );
}

/** filter / status chips */
export function Chips({ chips }: { chips: { label: ReactNode; tone?: 'good' | 'bad' | 'warn' | 'on' }[] }) {
  const style = (t?: string) => ({
    padding: '2px 8px', borderRadius: 12, border, fontSize: 11,
    background: t === 'on' ? 'var(--accent-dim)' : 'var(--surface)',
    color: t === 'good' ? 'var(--good)' : t === 'bad' ? 'var(--bad)' : t === 'warn' ? '#e0a13a' : 'var(--ink)',
  });
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {chips.map((c, i) => <span key={i} style={style(c.tone)}>{c.label}</span>)}
    </div>
  );
}

/** left-to-right boxes joined by arrows — how data moves */
export function Flow({ steps }: { steps: ReactNode[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 6, flexWrap: 'wrap' }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <div style={{
            padding: '6px 10px', border, borderRadius: 6, background: 'var(--surface)',
            fontSize: 11.5, minWidth: 90, textAlign: 'center',
          }}>{s}</div>
          {i < steps.length - 1 && <span style={{ color: ink2, fontSize: 14 }}>→</span>}
        </div>
      ))}
    </div>
  );
}

/** a numbered walkthrough */
export function Steps({ items }: { items: ReactNode[] }) {
  return (
    <ol style={{ paddingLeft: 0, listStyle: 'none', margin: '0 0 10px' }}>
      {items.map((it, i) => (
        <li key={i} style={{ display: 'flex', gap: 8, margin: '4px 0', alignItems: 'flex-start' }}>
          <span style={{
            flex: 'none', width: 20, height: 20, borderRadius: 4, background: 'var(--accent)', color: '#fff',
            fontSize: 11, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          }}>{i + 1}</span>
          <span>{it}</span>
        </li>
      ))}
    </ol>
  );
}

/** a worked example — "try this now" */
export function Try({ title, children }: { title?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ margin: '8px 0 10px', padding: '8px 10px', borderLeft: '3px solid var(--accent)', background: 'var(--surface-2)', borderRadius: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--accent)' }}>{title ?? 'Try it'}</div>
      <div style={{ fontSize: 12.5 }}>{children}</div>
    </div>
  );
}

/** an honest limit — what the tool cannot know */
export function Limit({ children }: { children: ReactNode }) {
  return (
    <div style={{ margin: '8px 0 10px', padding: '8px 10px', borderLeft: '3px solid #e0a13a', background: 'var(--surface-2)', borderRadius: 4 }}>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#e0a13a' }}>Honest limit</div>
      <div style={{ fontSize: 12.5 }}>{children}</div>
    </div>
  );
}

/** keyboard keys */
export function Keys({ keys }: { keys: string[] }) {
  return (
    <span style={{ display: 'inline-flex', gap: 3, verticalAlign: 'middle' }}>
      {keys.map((k, i) => (
        <kbd key={i} style={{
          padding: '1px 6px', border, borderBottomWidth: 2, borderRadius: 4, background: 'var(--surface)',
          fontSize: 11, fontFamily: 'inherit',
        }}>{k}</kbd>
      ))}
    </span>
  );
}

/** a planet-style card with a coloured band */
export function Card({ band, tone, title, who, lines }: {
  band: ReactNode; tone: 'bad' | 'warn' | 'good' | 'info'; title: ReactNode; who?: ReactNode; lines: ReactNode[];
}) {
  const color = tone === 'bad' ? 'var(--bad)' : tone === 'warn' ? '#e0a13a' : tone === 'good' ? 'var(--good)' : 'var(--accent)';
  return (
    <div style={{ width: 210, border, borderRadius: 6, overflow: 'hidden', background: 'var(--surface)', fontSize: 11.5 }}>
      <div style={{ background: color, color: '#fff', padding: '3px 8px', fontWeight: 800, fontSize: 10.5, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{band}</div>
      <div style={{ padding: '6px 8px' }}>
        <div style={{ fontWeight: 700 }}>{title} {who && <span style={{ color: ink2, fontWeight: 400 }}>· {who}</span>}</div>
        {lines.map((l, i) => <div key={i} style={{ color: ink2 }}>{l}</div>)}
      </div>
    </div>
  );
}

/** a shared-clock timeline: rows of deadlines on one axis (hours) */
export function Timeline({ hours, rows }: {
  hours: number;
  rows: { label: ReactNode; at: number; kind: 'fill' | 'end'; overdue?: boolean }[];
}) {
  const W = 420, L = 120, H = 18;
  const x = (h: number) => L + Math.max(0, Math.min(1, h / hours)) * (W - L - 10);
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * H + 22}`} width="100%" style={{ maxWidth: W, display: 'block', fontSize: 10 }}>
      {[0, hours / 3, (2 * hours) / 3, hours].map((h, i) => (
        <g key={i}>
          <line x1={x(h)} x2={x(h)} y1={14} y2={rows.length * H + 16} stroke="var(--grid)" strokeDasharray="2 3" />
          <text x={x(h)} y={10} textAnchor="middle" fill={ink2}>{Math.round(h)}h</text>
        </g>
      ))}
      {rows.map((r, i) => {
        const y = 22 + i * H;
        const color = r.overdue ? 'var(--bad)' : r.at < hours / 3 ? 'var(--bad)' : r.at < (2 * hours) / 3 ? '#e0a13a' : 'var(--accent)';
        return (
          <g key={i}>
            <text x={0} y={y + 4} fill="var(--ink)">{r.label}</text>
            <line x1={L} x2={x(r.at)} y1={y} y2={y} stroke={color} strokeWidth={2} opacity={0.5} />
            {r.kind === 'fill'
              ? <rect x={x(r.at) - 4} y={y - 4} width={8} height={8} fill={color} />
              : <polygon points={`${x(r.at)},${y - 5} ${x(r.at) + 5},${y + 4} ${x(r.at) - 5},${y + 4}`} fill={color} />}
          </g>
        );
      })}
    </svg>
  );
}

/** the fitting wheel, schematically: rings of high / mid / low / rig slots */
export function Wheel() {
  const ring = (r: number, n: number, color: string, filled: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = (-Math.PI / 2) + (i / n) * Math.PI * 2;
      return <circle key={`${r}-${i}`} cx={110 + r * Math.cos(a)} cy={110 + r * Math.sin(a)} r={8}
        fill={i < filled ? color : 'var(--surface)'} stroke={color} strokeWidth={1.5} />;
    });
  return (
    <svg viewBox="0 0 220 220" width="100%" style={{ maxWidth: 220, display: 'block', margin: '0 auto', fontSize: 10 }}>
      <circle cx={110} cy={110} r={96} fill="none" stroke="var(--grid)" />
      <circle cx={110} cy={110} r={72} fill="none" stroke="var(--grid)" />
      <circle cx={110} cy={110} r={48} fill="none" stroke="var(--grid)" />
      <circle cx={110} cy={110} r={24} fill="var(--surface-2)" stroke="var(--grid)" />
      {ring(96, 8, 'var(--bad)', 5)}
      {ring(72, 6, '#e0a13a', 4)}
      {ring(48, 6, 'var(--accent)', 3)}
      <text x={110} y={113} textAnchor="middle" fill={ink2}>hull</text>
      <text x={110} y={210} textAnchor="middle" fill={ink2}>outer = high · middle = mid · inner = low · rigs sit below the wheel</text>
    </svg>
  );
}

/** two boxes side by side — a before / after or a compare */
export function Pair({ left, right }: { left: ReactNode; right: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
      <div style={{ padding: 8, border, borderRadius: 6, background: 'var(--surface)' }}>{left}</div>
      <div style={{ padding: 8, border, borderRadius: 6, background: 'var(--surface)' }}>{right}</div>
    </div>
  );
}

/** the overlay's boxes, schematically */
export function OverlayMock() {
  const box = (x: number, y: number, w: number, h: number, label: string, color: string, handles?: boolean) => (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={4} fill="rgba(10,10,10,0.7)" stroke={color} />
      <text x={x + 8} y={y + 15} fill="#fff" fontSize={10}>{label}</text>
      {handles && [[x, y], [x + w, y], [x, y + h], [x + w, y + h]].map(([hx, hy], i) => (
        <rect key={i} x={hx - 4} y={hy - 4} width={8} height={8} fill="var(--accent)" stroke="#fff" />
      ))}
    </g>
  );
  return (
    <svg viewBox="0 0 420 150" width="100%" style={{ maxWidth: 420, display: 'block', background: '#1b1e24', borderRadius: 6 }}>
      {box(12, 12, 130, 38, 'Alice · Jita · Heron', 'var(--accent)', true)}
      {box(12, 58, 130, 38, 'Bob · J-space · Loki', 'var(--accent)', true)}
      {box(12, 104, 130, 38, 'Cid · null · pod ⚠', '#ff4d4d', true)}
      {box(160, 12, 240, 30, '⚠ EVE API problem — notice box', '#ff5b5b', true)}
      {box(160, 52, 200, 30, '🪐 planets need you', '#d06a4a', true)}
      {box(160, 92, 250, 30, '🎯 raidable skyhooks near you', '#ff9d3d', true)}
    </svg>
  );
}
