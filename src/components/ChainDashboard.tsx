// CHAIN DASHBOARD (v0.200.4) — the graphical half of the chain summary:
// the chain drawn by distance with ISK on field per system, ISK per hop,
// the activity mix and how fresh the list is. Plain SVG, no library; all
// numbers come from chainViz.ts (fixtures) and the summary already shown
// in the tiles. Clicking a system focuses the table on it; clicking a hop
// bar sets the "jumps" filter.
import type { SigGroup } from '../lib/chain';
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { CLASS_ORDER, GROUP_COLOR, GROUP_ORDER, classColor, effectAbbrev, effectColor, effectMods, effectModsText, isDarkColor, type AgeBucket, type ChainLayout, type EffectPalette, type HopBar } from '../lib/chainViz';
import { iskShort } from '../lib/format';

export interface ChainDashboardProps {
  origin: string;
  layout: ChainLayout;
  bars: HopBar[];
  ages: AgeBucket[];
  byGroup: Record<SigGroup, { count: number; isk: number; unvalued: number }>;
  focus: string | null;
  onFocus: (system: string | null) => void;
  maxHops: number | null;
  onMaxHops: (h: number | null) => void;
  /** sites in systems the chain does not reach / rows without a distance */
  offChain: number;
  note: string;
  /** the whole way from the origin (home) to the focused system, and the
   * active character's own way there when they are elsewhere (v0.201.3) */
  routeHome: string[] | null;
  routeMe: string[] | null;
  routeNote: string;
  routeFrom: string;
  originLabel: string;
  effectOf: Map<string, string>;
  tagOf: Map<string, string>;
  clsOf: Map<string, string>;
  /** the map's own effect colours, read from its badges (v0.201.4) */
  palette: EffectPalette | null;
  /** shattered systems — the map's dotted circle (v0.201.7) */
  shattered: Set<string>;
  /** systems "linked only" left out of the drawing (v0.202.2) */
  unlinkedHidden?: number;
}

/** the map's dotted circle for a shattered system */
function ShatteredMark({ x, y, r = 5 }: { x: number; y: number; r?: number }) {
  return (
    <g>
      <title>Shattered wormhole — no moons; nothing can be anchored (small-ship only when the class is C13)</title>
      <circle cx={x} cy={y} r={r} fill="none" stroke="currentColor" strokeWidth={1.4} strokeDasharray="2 1.6" />
    </g>
  );
}
const SHATTERED_GLYPH = '◌';

const NODE_W = 190, NODE_H = 60;
/** how far the drawing may spread to fill a bigger panel (v0.205.1): rows up to this many times
 * their natural spacing, columns a little — beyond that it would read as a different chart */
const MAX_STRETCH_X = 1.6, MAX_STRETCH_Y = 3;
const DIM = 'var(--ink-2, #9aa0aa)';
const LINE = 'var(--border, #3a3f4a)';
const ACCENT = 'var(--accent, #7fc8ff)';
const ME = '#7ee39a';
const PILL_SIZE = 13;
/** the class pill's width for its text — the effect box below takes the same */
const pillWidth = (cls: string, tag: string): number => Math.max(40, Math.round((cls ? `${cls}${tag}` : '—').length * PILL_SIZE * 0.66) + 12);

/** the effect as a small box under the class pill, same width, anchored
 * to the card's bottom edge: the map's little coloured square (its own
 * palette) beside the abbreviation in that colour; hovering it opens the
 * modifier list for that class with the full name (v0.201.3/4) */
function EffectPill({ effect, w, x, y, palette, onEnter, onLeave }: { effect: string; w: number; x: number; y: number; palette: EffectPalette | null; onEnter: (el: SVGGElement) => void; onLeave: () => void }) {
  const size = 10.5;
  const col = effectColor(effect, palette);
  const dark = isDarkColor(col);
  return (
    <g transform={`translate(${x - w},${y})`} onMouseEnter={(e) => onEnter(e.currentTarget)} onMouseLeave={onLeave} style={{ cursor: 'help' }}>
      <rect width={w} height={size + 5} rx={4} fill="rgba(0,0,0,0.35)" stroke={dark ? 'rgba(255,255,255,0.45)' : col} strokeWidth={1.5} />
      <text x={w / 2} y={size + 1} textAnchor="middle" fontSize={size} fontWeight={650} fill={dark ? '#e6e6e6' : col} style={{ letterSpacing: 0.4 }}>{effectAbbrev(effect)}</text>
    </g>
  );
}

/** the class tag as a pill — the most important thing on a card, so it
 * is large; a translucent dark fill with the class colour as border and
 * text reads without glare (v0.201.4: the solid fill was too much) */
function ClassPill({ cls, tag, x, y }: { cls: string; tag: string; x: number; y: number }) {
  const text = cls ? `${cls}${tag}` : '—';
  const w = pillWidth(cls, tag);
  const col = cls ? classColor(cls) : '#9aa0aa';
  return (
    <g transform={`translate(${x - w},${y})`}>
      <rect width={w} height={PILL_SIZE + 7} rx={5} fill="rgba(0,0,0,0.35)" stroke={col} strokeWidth={1.5} />
      <text x={w / 2} y={PILL_SIZE + 1} textAnchor="middle" fontSize={PILL_SIZE} fontWeight={650} fill={col} style={{ letterSpacing: 0.3 }}>{text}</text>
    </g>
  );
}

/** one route as a strip line: system → system with pills, effects and the jump count */
function RouteLine({ label, colour, route, clsOf, tagOf, effectOf, palette, shattered }: { label: string; colour: string; route: string[]; clsOf: Map<string, string>; tagOf: Map<string, string>; effectOf: Map<string, string>; palette: EffectPalette | null; shattered: Set<string> }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: colour, display: 'inline-block' }} />
      <b style={{ fontSize: 11.5 }}>{label}</b>
      {route.map((s, i) => (
        <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {i > 0 && <span className="dim">→</span>}
          <span style={{ fontWeight: i === 0 || i === route.length - 1 ? 700 : 500 }}>{s}{shattered.has(s) ? <span title="shattered wormhole" style={{ marginLeft: 3, fontSize: 12 }}>{SHATTERED_GLYPH}</span> : null}</span>
          <span style={{ padding: '0 5px', borderRadius: 4, fontSize: 10.5, fontWeight: 650, background: 'rgba(0,0,0,0.35)', border: `1px solid ${clsOf.get(s) ? classColor(clsOf.get(s)!) : '#9aa0aa'}`, color: clsOf.get(s) ? classColor(clsOf.get(s)!) : '#9aa0aa' }}>{clsOf.get(s) ? `${clsOf.get(s)}${tagOf.get(s) ?? ''}` : '—'}</span>
          {effectOf.get(s) && (() => { const col = effectColor(effectOf.get(s)!, palette); const dark = isDarkColor(col); return (
            <span title={`${effectOf.get(s)} in ${clsOf.get(s) ?? '?'}\n${effectModsText(effectOf.get(s)!, clsOf.get(s) ?? '')}`} style={{ padding: '0 5px', borderRadius: 4, fontSize: 10.5, fontWeight: 650, background: 'rgba(0,0,0,0.35)', border: `1px solid ${dark ? 'rgba(255,255,255,0.45)' : col}`, color: dark ? '#e6e6e6' : col, cursor: 'help' }}>
              {effectAbbrev(effectOf.get(s)!)}
            </span>); })()}
        </span>
      ))}
      <span className="dim" style={{ marginLeft: 'auto' }}>{route.length - 1} jump{route.length === 2 ? '' : 's'}</span>
    </div>
  );
}

function ChainMap({ origin, layout, focus, onFocus, offChain, note, routeHome, routeMe, routeNote, routeFrom, originLabel, effectOf, tagOf, clsOf, palette, shattered, unlinkedHidden = 0 }: { unlinkedHidden?: number } & Pick<ChainDashboardProps, 'origin' | 'layout' | 'focus' | 'onFocus' | 'offChain' | 'note' | 'routeHome' | 'routeMe' | 'routeNote' | 'routeFrom' | 'originLabel' | 'effectOf' | 'tagOf' | 'clsOf' | 'palette' | 'shattered'>) {
  const pad = 12;
  const maxIsk = layout.nodes.reduce((m, n) => Math.max(m, n.isk), 0) || 1;
  // THE DRAWING FILLS ITS PANEL (v0.205.1 — "when I drag it down the bottom half is just
  // empty"). The cards keep their size; the rows spread over the height there is and the
  // columns over the width, so a taller or wider panel is a roomier chain, never a blank
  // half. It only ever stretches: a panel smaller than the drawing scrolls, as before.
  // The drawing sits in an absolutely placed box, so its size never feeds back into the
  // panel's own height (the ratchet the right-hand charts had in v0.202.4).
  const w0 = layout.width + pad * 2, h0 = Math.max(layout.height, NODE_H + 8) + pad * 2;
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const SCROLLBAR = 14;
  const kx = box.w > w0 + 8 ? Math.min(MAX_STRETCH_X, box.w / w0) : 1;
  const ky = box.h - SCROLLBAR > h0 + 8 ? Math.min(MAX_STRETCH_Y, (box.h - (kx === 1 && box.w < w0 ? SCROLLBAR : 0)) / h0) : 1;
  const colW = layout.colW * kx;
  const nodes = layout.nodes.map((n) => ({ ...n, x: n.x * kx, y: n.y * ky }));
  const pos = new Map(nodes.map((n) => [n.system, n]));
  const w = Math.floor(w0 * kx), h = Math.floor(h0 * ky);
  // QUIET cards (v0.202.10): a system with nothing in view under the current
  // filters stays on the drawing (the chain must stay navigable) but dims,
  // and so do the links that only touch quiet systems — so a class or
  // activity filter makes the systems that matter stand out at a glance
  const quiet = new Set(layout.nodes.filter((n) => n.count === 0 && !n.isOrigin).map((n) => n.system));
  const edgeKeys = (r: string[] | null) => { const s = new Set<string>(); if (r) for (let i = 1; i < r.length; i++) { const a = r[i - 1], b = r[i]; s.add(a < b ? `${a}|${b}` : `${b}|${a}`); } return s; };
  const homeSet = new Set(routeHome ?? []), homeEdges = edgeKeys(routeHome);
  const meSet = new Set(routeMe ?? []), meEdges = edgeKeys(routeMe);
  const meStart = routeMe && routeMe.length > 1 ? routeMe[0] : null;
  // the effect tooltip: positioned inside the scrolling wrapper, from the
  // hovered pill's box
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [tip, setTip] = useState<{ left: number; top: number; system: string; effect: string; cls: string } | null>(null);
  const showTip = (el: SVGGElement, system: string, effect: string, cls: string) => {
    const wrap = wrapRef.current; if (!wrap) return;
    const r = el.getBoundingClientRect(), w = wrap.getBoundingClientRect();
    setTip({ left: r.right - w.left + wrap.scrollLeft - 8, top: r.bottom - w.top + wrap.scrollTop + 4, system, effect, cls });
  };
  return (
    <div className="panel" style={{ padding: 10, flex: '1 1 560px', minWidth: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
        <b style={{ fontSize: 12.5 }}>The chain from {origin || '?'}</b>
        <span className="dim" style={{ fontSize: 11 }}
          title={layout.unlinked.length ? `Drawn on the map but with no drawn link back to ${origin || 'the origin'}: ${layout.unlinked.join(', ')}. The chain is walked along the map's links, so these carry no distance; their sites show "?" for jumps and drop out under a distance filter.` : undefined}>
          {layout.nodes.length - layout.unlinked.length} systems linked · click one to focus the table{focus ? ` · focused on ${focus}` : ''}
          {quiet.size > 0 ? <> · <span title="a system with nothing in view under the current filters stays on the drawing but dims, and so do the links that only touch dimmed systems">{quiet.size} dimmed (nothing in view)</span></> : null}
          {layout.unlinked.length > 0 ? <> · <span style={{ color: '#ff8080' }}>{layout.unlinked.length} on the map but not linked to {origin || 'the origin'}</span></> : unlinkedHidden > 0 ? <> · <span title="untick “linked only” in the filters to draw them">{unlinkedHidden} not linked, hidden</span></> : null}
          {offChain > 0 ? ` · ${offChain} site(s) without a distance` : ''}
        </span>
        {focus && <button className="btn mini" onClick={() => onFocus(null)}>✕ unfocus</button>}
        <span className="chain-legend" style={{ marginLeft: 'auto', display: 'inline-flex', gap: 6, fontSize: 10.5, fontWeight: 700 }} title="card colours by class">
          {CLASS_ORDER.map((k) => <span key={k} style={{ color: classColor(k) }}>{k}</span>)}
        </span>
      </div>
      {/* the routes: the whole way from home to the focused hole, and the
          character's own way there when they are elsewhere */}
      {focus && (
        <div className="chain-route" style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12, margin: '2px 0 8px', padding: '6px 8px', border: `1px solid ${LINE}`, borderRadius: 6 }}>
          {routeHome
            ? <RouteLine label={`From ${originLabel || 'home'}`} colour={ACCENT} route={routeHome} clsOf={clsOf} tagOf={tagOf} effectOf={effectOf} palette={palette} shattered={shattered} />
            : <span className="dim">{originLabel ? `${originLabel} is not connected to ${focus} on this chain` : 'no origin to route from'}</span>}
          {routeMe
            ? <RouteLine label={`${routeFrom}'s way`} colour={ME} route={routeMe} clsOf={clsOf} tagOf={tagOf} effectOf={effectOf} palette={palette} shattered={shattered} />
            : routeNote ? <span className="dim" style={{ fontSize: 11.5 }}>🧍 {routeNote}</span> : null}
        </div>
      )}
      {layout.nodes.length === 0 ? (
        <div className="dim" style={{ fontSize: 12, padding: 12 }}>{note || 'no distances yet — the chain links could not be read, or the origin is not on the map'}</div>
      ) : (
        <div ref={boxRef} style={{ flex: '1 1 auto', minHeight: h0 + SCROLLBAR, position: 'relative' }}>
        <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflowX: 'auto', overflowY: 'hidden' }}>
          {tip && (
            <div className="chain-tip panel" style={{ position: 'absolute', left: tip.left, top: tip.top, transform: 'translateX(-100%)', zIndex: 5, padding: '6px 9px', fontSize: 11.5, pointerEvents: 'none', minWidth: 200, boxShadow: '0 4px 14px rgba(0,0,0,0.35)', border: `1px solid ${isDarkColor(effectColor(tip.effect, palette)) ? 'rgba(255,255,255,0.35)' : effectColor(tip.effect, palette)}` }}>
              <div style={{ fontWeight: 800, marginBottom: 3 }}>{tip.effect} <span className="dim" style={{ fontWeight: 500 }}>in {tip.cls || '?'} · {tip.system}</span></div>
              {effectMods(tip.effect, tip.cls).length === 0 ? <div className="dim">no modifier table for this class</div> : (
                <table style={{ borderCollapse: 'collapse' }}><tbody>
                  {effectMods(tip.effect, tip.cls).map((m) => (
                    <tr key={m.label}><td style={{ paddingRight: 10 }}>{m.label}</td><td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 700, color: m.value.startsWith('−') ? '#ff6b6b' : '#7ee39a' }}>{m.value}</td></tr>
                  ))}
                </tbody></table>
              )}
              <div className="dim" style={{ marginTop: 3, fontSize: 10.5 }}>from CCP's static data (the system's effect beacon)</div>
            </div>
          )}
          <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block', fontFamily: 'inherit' }} role="img" aria-label="the chain by distance">
            <defs>
              {/* the SELECTED card glows; cards merely on a route only take a coloured stroke (v0.201.9) */}
              <filter id="chain-glow" x="-30%" y="-30%" width="160%" height="160%">
                <feGaussianBlur stdDeviation="4" result="blur" />
                <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
              </filter>
            </defs>
            <g transform={`translate(${pad},${pad})`}>
              {/* hop columns, then the detached column for systems the map
                  draws but does not link back to the origin */}
              {Array.from({ length: layout.maxHop + 1 + (layout.unlinked.length ? 1 : 0) }, (_, i) => {
                const detached = i > layout.maxHop;
                return (
                  <g key={`col-${i}`}>
                    <rect x={i * colW} y={-pad + 2} width={colW} height={h - 4} fill={detached ? 'rgba(255,90,90,0.05)' : i % 2 ? 'rgba(127,127,127,0.05)' : 'transparent'} />
                    {detached && <line x1={i * colW} y1={-pad + 2} x2={i * colW} y2={h - 2} stroke={LINE} strokeDasharray="3 3" />}
                    <text x={i * colW + colW / 2} y={-2} textAnchor="middle" fontSize={10} fill={DIM}>{detached ? `on the map, not linked to ${origin || 'the origin'}` : i === 0 ? 'origin' : `${i} jump${i === 1 ? '' : 's'}`}</text>
                  </g>
                );
              })}
              {/* links */}
              {layout.edges.map((e) => {
                const a = pos.get(e.a), b = pos.get(e.b);
                if (!a || !b) return null;
                const [l, r] = a.x <= b.x ? [a, b] : [b, a];
                const x1 = l.x + NODE_W / 2, x2 = r.x - NODE_W / 2, mx = (x1 + x2) / 2;
                const same = l.x === r.x;
                const d = same
                  ? `M ${l.x + NODE_W / 2} ${l.y} C ${l.x + NODE_W / 2 + 30} ${l.y}, ${r.x + NODE_W / 2 + 30} ${r.y}, ${r.x + NODE_W / 2} ${r.y}`
                  : `M ${x1} ${l.y} C ${mx} ${l.y}, ${mx} ${r.y}, ${x2} ${r.y}`;
                const key = e.a < e.b ? `${e.a}|${e.b}` : `${e.b}|${e.a}`;
                const onHome = homeEdges.has(key), onMe = meEdges.has(key);
                const lit = onHome || onMe || (focus && (e.a === focus || e.b === focus));
                const dimEdge = !lit && (quiet.has(e.a) || quiet.has(e.b));
                return <path key={key} d={d} fill="none" stroke={onHome ? ACCENT : onMe ? ME : lit ? ACCENT : LINE} strokeWidth={onHome || onMe ? 3 : lit ? 2 : 1.2} opacity={focus && !lit ? 0.35 : dimEdge ? 0.3 : 1} />;
              })}
              {/* systems */}
              {nodes.map((n) => {
                const x = n.x - NODE_W / 2, y = n.y - NODE_H / 2;
                const isF = focus === n.system;
                const onHome = homeSet.has(n.system), onMe = meSet.has(n.system);
                const onR = onHome || onMe;
                const isStart = meStart === n.system;
                const detached = n.hop < 0;
                const barW = Math.max(0, Math.round((NODE_W - 12) * (n.isk / maxIsk)));
                const name = n.system.length > 14 ? `${n.system.slice(0, 13)}…` : n.system;
                const pw = pillWidth(n.cls, n.tag);
                const isQuiet = quiet.has(n.system) && !isF && !onR;
                return (
                  <g key={n.system} transform={`translate(${x},${y})`} style={{ cursor: 'pointer' }} className={isQuiet ? 'chain-quiet' : undefined}
                    opacity={focus && !isF && !onR ? (isQuiet ? 0.3 : 0.5) : isQuiet ? (detached ? 0.32 : 0.42) : detached ? 0.7 : 1}
                    onClick={() => onFocus(isF ? null : n.system)}>
                    <title>{`${n.system}${n.cls ? ` · ${n.cls}${n.tag}` : ''}${n.shattered ? ' · shattered' : ''}${n.effect ? ` · ${n.effect}` : ''} · ${detached ? `on the map but no drawn link back to ${origin || 'the origin'} — no distance` : `${n.hop} jump${n.hop === 1 ? '' : 's'}`} · ${iskShort(n.isk)} on field over ${n.count} site${n.count === 1 ? '' : 's'}${n.unvalued ? ` (${n.unvalued} without an estimate)` : ''}${isStart ? ` · ${routeFrom} is here` : ''}`}</title>
                    {isF && <rect x={-3} y={-3} width={NODE_W + 6} height={NODE_H + 6} rx={9} fill="none" stroke="#ffffff" strokeWidth={5} opacity={0.55} filter="url(#chain-glow)" className="chain-selected-glow" />}
                    <rect width={NODE_W} height={NODE_H} rx={6} fill={isF ? 'rgba(255,255,255,0.10)' : onR ? 'rgba(127,200,255,0.05)' : 'var(--panel-2, rgba(127,127,127,0.08))'}
                      stroke={isF ? '#ffffff' : n.isOrigin || onHome ? ACCENT : onMe ? ME : classColor(n.cls)} strokeWidth={isF ? 2.5 : n.isOrigin || onR ? 2.5 : 1.4} strokeDasharray={detached ? '4 3' : undefined} />
                    <text x={8} y={17} fontSize={12.5} fontWeight={700} fill="currentColor">{n.isOrigin ? '🏠 ' : isStart ? '🧍 ' : ''}{name}</text>
                    {n.shattered && <ShatteredMark x={8 + Math.min(name.length, 14) * 7.4 + (n.isOrigin || isStart ? 18 : 0) + 9} y={13} />}
                    <ClassPill cls={n.cls} tag={n.tag} x={NODE_W - 6} y={5} />
                    <text x={8} y={36} fontSize={11} fill="currentColor" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {n.count === 0 ? <tspan fill={DIM}>nothing in view</tspan> : <>{n.isk > 0 ? iskShort(n.isk) : '—'}<tspan fill={DIM}> · {n.count} site{n.count === 1 ? '' : 's'}{n.unvalued ? ` · ${n.unvalued}?` : ''}</tspan></>}
                    </text>
                    <text x={8} y={50} fontSize={10} fill={detached ? '#ff8080' : DIM}>{detached ? 'no link to origin' : n.hop === 0 ? 'origin' : `${n.hop} jump${n.hop === 1 ? '' : 's'}`}</text>
                    {n.effect && <EffectPill effect={n.effect} w={pw} x={NODE_W - 6} y={NODE_H - 8 - 16} palette={palette}
                      onEnter={(el) => showTip(el, n.system, n.effect, n.cls)} onLeave={() => setTip(null)} />}
                    <rect x={6} y={NODE_H - 5} width={NODE_W - 12} height={3} rx={1.5} fill="rgba(127,127,127,0.18)" />
                    {barW > 0 && <rect x={6} y={NODE_H - 5} width={barW} height={3} rx={1.5} fill={ACCENT} />}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
        </div>
      )}
    </div>
  );
}

/** the box a chart may fill, measured live — so a panel the pilot resizes
 * (every .panel has a drag handle) re-fits its content (v0.202.2).
 * A CALLBACK ref, not an effect (v0.202.4): the chart bodies mount only
 * once there is data, and an effect that ran at mount found no element
 * and never observed anything — in the real app the dashboard mounts
 * before the map has been read, so every chart sat at its fallback size
 * (the rig had mounted with data and never saw it). The ref attaches the
 * observer whenever the element appears and measures it at once. */
function useBoxSize<T extends HTMLElement>(): [(el: T | null) => void, { w: number; h: number }] {
  const roRef = useRef<ResizeObserver | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const adopt = (w: number, h: number) => setSize((s) => (Math.abs(s.w - w) < 1 && Math.abs(s.h - h) < 1 ? s : { w, h }));
  const ref = useCallback((el: T | null) => {
    roRef.current?.disconnect();
    roRef.current = null;
    if (!el) return;
    const r = el.getBoundingClientRect();
    adopt(r.width, r.height);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (cr) adopt(cr.width, cr.height);
    });
    ro.observe(el);
    roRef.current = ro;
  }, []);
  useEffect(() => () => { roRef.current?.disconnect(); }, []);
  return [ref, size];
}

/** one of the three right-hand panels: they share the column's height
 * 4 : 2 : 2 and draw to whatever they are given.
 *
 * flex-basis AUTO on purpose: the pilot's drag handle writes an inline
 * height, and a basis of 0 ignored it ("I can't adjust the size"). But a
 * basis of auto plus flex-grow has its own trap: the first pixel of a drag
 * makes the dragged height the basis, and flex then GROWS the panel on top
 * of it again — the "jumps bigger, then I have to drag up" report. So the
 * moment the pilot presses on the resize corner the panel is PINNED: its
 * current height becomes its inline height (nothing moves) and its grow
 * factor drops to 0, so from then on the handle is the only thing that
 * sizes it and the other two share what is left. */
function RightPanel({ grow, minHeight, children }: { grow: number; minHeight: number; children: ReactNode }) {
  const [pinned, setPinned] = useState(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const r = el.getBoundingClientRect();
    if (e.clientX >= r.right - 22 && e.clientY >= r.bottom - 22) {
      el.style.height = `${Math.round(r.height)}px`;
      setPinned(true);
    }
  };
  return (
    <div className="panel" onPointerDown={onPointerDown}
      style={{ padding: 10, flex: pinned ? '0 0 auto' : `${grow} 1 auto`, minHeight, display: 'flex', flexDirection: 'column', overflow: 'hidden', boxSizing: 'border-box' }}>
      {children}
    </div>
  );
}

function HopBars({ bars, maxHops, onMaxHops }: Pick<ChainDashboardProps, 'bars' | 'maxHops' | 'onMaxHops'>) {
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const W = Math.max(120, Math.floor(box.w) || 300), H = Math.max(80, Math.floor(box.h) || 110);
  // type and bars grow with the room: 10-px labels in a 110-px chart, 14 in a tall one
  const fs = Math.max(10, Math.min(14, Math.round(H / 24)));
  const padL = 6, padB = fs * 2 + 4, padT = fs + 8;
  const max = bars.reduce((m, b) => Math.max(m, b.total), 0) || 1;
  const bw = bars.length ? Math.min(110, (W - padL * 2) / bars.length) : 0;
  const x0 = padL + ((W - padL * 2) - bw * bars.length) / 2;
  return (
    <RightPanel grow={4} minHeight={150}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 2 }}>
        <b style={{ fontSize: 12.5 }}>ISK on field by jumps</b>
        <span className="dim" style={{ fontSize: 11 }}>click a bar to set the filter</span>
      </div>
      {bars.length === 0 ? <div className="dim" style={{ fontSize: 12, padding: 8 }}>no distances yet</div> : (
        <div ref={ref} style={{ flex: 1, minHeight: 110, position: 'relative' }}>
          {/* absolute, so the chart's own size never feeds back into the panel's */}
          <svg width={W} height={H} style={{ display: 'block', position: 'absolute', left: 0, top: 0 }} role="img" aria-label="ISK by hop">
            {bars.map((b, i) => {
              const x = x0 + i * bw + 3, w = Math.max(4, bw - 6);
              const total = b.total;
              const fullH = total > 0 ? Math.max(2, ((H - padB - padT) * total) / max) : 0;
              const inRange = maxHops === null || b.hop <= maxHops;
              let yCursor = H - padB;
              return (
                <g key={b.hop} style={{ cursor: 'pointer' }} opacity={inRange ? 1 : 0.35} onClick={() => onMaxHops(maxHops === b.hop ? null : b.hop)}>
                  <title>{`${b.hop} jump${b.hop === 1 ? '' : 's'} · ${iskShort(total)} over ${b.count} site${b.count === 1 ? '' : 's'}`}</title>
                  <rect x={x} y={padT} width={w} height={H - padB - padT} fill="transparent" />
                  {GROUP_ORDER.map((g) => {
                    const v = b.byGroup[g] ?? 0;
                    if (v <= 0 || total <= 0) return null;
                    const hh = (fullH * v) / total;
                    yCursor -= hh;
                    return <rect key={g} x={x} y={yCursor} width={w} height={hh} fill={GROUP_COLOR[g]} />;
                  })}
                  {total <= 0 && <rect x={x} y={H - padB - 2} width={w} height={2} fill={LINE} />}
                  <text x={x + w / 2} y={H - padB - fullH - 4} textAnchor="middle" fontSize={fs} fill="currentColor" style={{ fontVariantNumeric: 'tabular-nums' }}>{total > 0 ? iskShort(total) : b.count > 0 ? `${b.count}?` : ''}</text>
                  <text x={x + w / 2} y={H - fs * 0.6} textAnchor="middle" fontSize={fs + 0.5} fill={maxHops === b.hop ? 'var(--accent, #7fc8ff)' : DIM} fontWeight={maxHops === b.hop ? 700 : 400}>{b.hop}</text>
                </g>
              );
            })}
          </svg>
        </div>
      )}
    </RightPanel>
  );
}

function ActivityMix({ byGroup }: Pick<ChainDashboardProps, 'byGroup'>) {
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const total = GROUP_ORDER.reduce((s, g) => s + (byGroup[g]?.isk ?? 0), 0) || 1;
  // rows split the room evenly; the bars thicken and the type grows with it
  const rowH = (box.h || 100) / GROUP_ORDER.length;
  const barH = Math.max(8, Math.min(26, Math.floor(rowH * 0.42)));
  const fs = Math.max(11.5, Math.min(13.5, rowH / 3));
  return (
    <RightPanel grow={2} minHeight={130}>
      <b style={{ fontSize: 12.5 }}>Activity mix</b>
      <div ref={ref} style={{ flex: 1, minHeight: 100, marginTop: 4, display: 'grid', gridTemplateRows: `repeat(${GROUP_ORDER.length}, 1fr)`, alignItems: 'center', fontSize: fs }}>
        {GROUP_ORDER.map((g) => {
          const t = byGroup[g] ?? { count: 0, isk: 0, unvalued: 0 };
          const pct = Math.round((t.isk / total) * 100);
          return (
            <div key={g} style={{ display: 'grid', gridTemplateColumns: '54px 1fr 64px', gap: '0 8px', alignItems: 'center' }}>
              <span style={{ color: GROUP_COLOR[g] }}>{g}</span>
              <div style={{ height: barH, background: 'rgba(127,127,127,0.15)', borderRadius: barH / 2, overflow: 'hidden' }} title={`${g}: ${iskShort(t.isk)} · ${t.count} sites${t.unvalued ? ` · ${t.unvalued} without an estimate` : ''}`}>
                <div style={{ width: `${pct}%`, height: '100%', background: GROUP_COLOR[g] }} />
              </div>
              <span className="dim" style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{t.isk > 0 ? iskShort(t.isk) : t.count > 0 ? `${t.count}?` : '—'}</span>
            </div>
          );
        })}
      </div>
    </RightPanel>
  );
}

function Freshness({ ages }: Pick<ChainDashboardProps, 'ages'>) {
  const [ref, box] = useBoxSize<HTMLDivElement>();
  const max = ages.reduce((m, a) => Math.max(m, a.count), 0) || 1;
  // the count label and the axis label take ~28 px; the rest is bar
  const barMax = Math.max(20, Math.floor(box.h || 62) - 28);
  const fs = Math.max(9.5, Math.min(12, (box.h || 62) / 12));
  return (
    <RightPanel grow={2} minHeight={110}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
        <b style={{ fontSize: 12.5 }}>Freshness</b>
        <span className="dim" style={{ fontSize: 11 }}>signatures by age of the map's last look</span>
      </div>
      {/* the measured body is empty as far as layout is concerned (the bars
          sit in an absolute box), so their height never feeds back into the
          panel's own — with a flex-basis of auto that fed back into a ratchet
          that swallowed the whole column (measured in the rig) */}
      <div ref={ref} style={{ flex: 1, minHeight: 66, position: 'relative', marginTop: 6 }}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', gap: 4, alignItems: 'flex-end' }}>
        {ages.map((a) => (
          <div key={a.label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }} title={`${a.label}: ${a.count} signature${a.count === 1 ? '' : 's'} · ${iskShort(a.isk)}`}>
            <span style={{ fontSize: fs, fontVariantNumeric: 'tabular-nums' }}>{a.count || ''}</span>
            <div style={{ width: '100%', height: Math.max(2, Math.round((barMax * a.count) / max)), background: a.maxH === null ? LINE : a.maxH <= 3 ? '#8dc169' : a.maxH <= 12 ? '#e0a13a' : '#ff5b5b', borderRadius: 2, opacity: a.count ? 1 : 0.35 }} />
            <span className="dim" style={{ fontSize: Math.max(8.5, fs - 1.5), whiteSpace: 'nowrap' }}>{a.label}</span>
          </div>
        ))}
      </div>
      </div>
    </RightPanel>
  );
}

export default function ChainDashboard(p: ChainDashboardProps) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'stretch' }}>
      <ChainMap unlinkedHidden={p.unlinkedHidden} origin={p.origin} layout={p.layout} focus={p.focus} onFocus={p.onFocus} offChain={p.offChain} note={p.note}
        routeHome={p.routeHome} routeMe={p.routeMe} routeNote={p.routeNote} routeFrom={p.routeFrom} originLabel={p.originLabel} effectOf={p.effectOf} tagOf={p.tagOf} clsOf={p.clsOf} palette={p.palette} shattered={p.shattered} />
      <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: 8, minWidth: 280, minHeight: 0 }}>
        <HopBars bars={p.bars} maxHops={p.maxHops} onMaxHops={p.onMaxHops} />
        <ActivityMix byGroup={p.byGroup} />
        <Freshness ages={p.ages} />
      </div>
    </div>
  );
}
