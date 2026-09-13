// FEED PANEL (v0.199.5) — the Log Visualizer's raw feed, made easy to
// look through: free-text search, filters by what YOU were doing (dealt /
// received / EWAR / mining / ship changes), a filter by OPPONENT ("I was
// trying to kill someone — show me that attempt"), and a scrubbable
// timeline over the scoped window whose ticks are the filtered events —
// drag it and the list follows and highlights; scroll the list and the
// cursor follows. Gavin, 2026-09-13: "search and filter settings, and a
// timeline … which also shows all the events of interactions and has the
// feed scroll and maybe highlight … like I was trying to kill someone, let
// me filter by that attempt."
//
// The filtering is pure (filterFeed, exported) so fixtures pin it; the
// component owns only the UI state.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Engagement, GameLogEvent } from '../lib/gamelogParse';

export type FeedGroup = 'dealt' | 'received' | 'ewar' | 'mining' | 'ship' | 'other';

/** which "what I was doing" bucket a log line falls into */
export const FEED_GROUP_OF: Record<GameLogEvent['kind'], FeedGroup> = {
  dmgOut: 'dealt', missOut: 'dealt', neutOut: 'dealt', repOut: 'dealt',
  dmgIn: 'received', missIn: 'received', neutIn: 'received', repIn: 'received',
  ewar: 'ewar', jammed: 'ewar',
  mine: 'mining', mineCrit: 'mining', residue: 'mining',
  reship: 'ship', bounty: 'other', other: 'other',
};
export const FEED_GROUPS: FeedGroup[] = ['dealt', 'received', 'ewar', 'mining', 'ship', 'other'];
const GROUP_LABEL: Record<FeedGroup, string> = {
  dealt: 'you dealt', received: 'you received', ewar: 'EWAR', mining: 'mining', ship: 'ship changes', other: 'other',
};
const GROUP_COLOR: Record<FeedGroup, string> = {
  dealt: '#4da3ff', received: '#ff5b5b', ewar: '#e0a13a', mining: '#8dc169', ship: '#7fc8ff', other: '#9aa0aa',
};
const CRIT_COLOR = '#e8e04a';
const RESIDUE_COLOR = '#ff5b60';

const FEED_TAG: Record<GameLogEvent['kind'], { tag: string; cls: string }> = {
  dmgOut: { tag: '→', cls: 'pos' }, dmgIn: { tag: '←', cls: 'neg' },
  missOut: { tag: '∅', cls: 'dim' }, missIn: { tag: '∅', cls: 'dim' },
  neutOut: { tag: '▽', cls: 'pos' }, neutIn: { tag: '▽', cls: 'neg' },
  repIn: { tag: '+', cls: 'pos' }, repOut: { tag: '+', cls: 'dim' },
  ewar: { tag: 'EW', cls: 'flag warn' }, jammed: { tag: 'J', cls: 'flag warn' },
  mine: { tag: 'M', cls: 'pos' }, mineCrit: { tag: 'M✦', cls: 'flag good' },
  residue: { tag: 'R', cls: 'neg' }, bounty: { tag: 'ISK', cls: 'pos' },
  reship: { tag: 'SHIP', cls: 'flag info' }, other: { tag: '·', cls: 'dim' },
};

/** "Pilot[CORP](Ship)" → "Pilot"; an NPC or plain name comes through whole */
export const pilotOf = (entity?: string): string | null => {
  if (!entity) return null;
  const p = entity.split('[')[0].split('(')[0].trim();
  return p.length > 0 ? p : null;
};

/** everything a row shows, lowercased — what the search box matches */
export const searchText = (e: GameLogEvent): string => [
  e.kind, e.entity, e.weapon, e.quality, e.text, e.ore,
  e.amount !== undefined ? String(Math.round(e.amount)) : '',
].filter(Boolean).join(' ').toLowerCase();

export interface FeedFilter {
  /** free text; every space-separated word must match */
  query: string;
  /** which buckets are ON */
  groups: Set<FeedGroup>;
  /** an opponent's pilot name, or null for everyone */
  pilot: string | null;
}

/** pure: the events that pass the filter, in the order given */
export function filterFeed(events: readonly GameLogEvent[], f: FeedFilter): GameLogEvent[] {
  const words = f.query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return events.filter((e) => {
    if (!f.groups.has(FEED_GROUP_OF[e.kind])) return false;
    if (f.pilot !== null && pilotOf(e.entity) !== f.pilot) return false;
    if (words.length > 0) {
      const s = searchText(e);
      for (const w of words) if (!s.includes(w)) return false;
    }
    return true;
  });
}

/** opponents in the events, most-mentioned first */
export function pilotsIn(events: readonly GameLogEvent[]): { name: string; n: number }[] {
  const m = new Map<string, number>();
  for (const e of events) { const p = pilotOf(e.entity); if (p) m.set(p, (m.get(p) ?? 0) + 1); }
  return [...m.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n || a.name.localeCompare(b.name));
}

const fmtN = (n: number): string => Math.round(n).toLocaleString();
const hhmmss = (t: number): string => new Date(t).toISOString().slice(11, 19);
/** rows this close to the cursor light up */
const HIGHLIGHT_MS = 3_000;
/** the list draws at most this many rows (the most recent) — a session is
 * rarely bigger, and the search/filters are the way to narrow it */
const ROW_CAP = 4_000;

function Row({ e }: { e: GameLogEvent }) {
  switch (e.kind) {
    case 'dmgOut': return <><b>{fmtN(e.amount ?? 0)}</b> to {e.entity}{e.quality ? <span className="dim"> ({e.quality})</span> : ''}{e.weapon ? <span className="dim"> · {e.weapon}</span> : ''}</>;
    case 'dmgIn': return <><b>{fmtN(e.amount ?? 0)}</b> from {e.entity}{e.quality ? <span className="dim"> ({e.quality})</span> : ''}{e.weapon ? <span className="dim"> · {e.weapon}</span> : ''}</>;
    case 'missOut': return <>missed {e.entity}</>;
    case 'missIn': return <>{e.entity} missed you</>;
    case 'neutOut': return <>drained {e.entity} for <b>{fmtN(e.amount ?? 0)}</b> GJ</>;
    case 'neutIn': return <>drained by {e.entity} for <b>{fmtN(e.amount ?? 0)}</b> GJ</>;
    case 'repIn': return <><b>{fmtN(e.amount ?? 0)}</b> hp rep from {e.entity}</>;
    case 'repOut': return <><b>{fmtN(e.amount ?? 0)}</b> hp rep to {e.entity}</>;
    case 'jammed': return <>ECM jammed by {e.entity}{e.weapon ? <span className="dim"> ({e.weapon})</span> : ''}</>;
    case 'mine': return <>mined <b>{fmtN(e.amount ?? 0)}</b> {e.ore}</>;
    case 'mineCrit': return <b style={{ color: CRIT_COLOR }}>critical! +{fmtN(e.amount ?? 0)} {e.ore}</b>;
    case 'residue': return <span style={{ color: RESIDUE_COLOR }}><b>{fmtN(e.amount ?? 0)}</b> units lost as residue</span>;
    case 'bounty': return <><b>{fmtN(e.isk ?? 0)}</b> ISK bounty</>;
    default: return <>{e.text}</>;
  }
}

export default function FeedPanel({ events, domain, fights }: {
  /** the scoped events, oldest first */
  events: readonly GameLogEvent[];
  domain: [number, number] | null;
  fights?: readonly Engagement[];
}) {
  const [query, setQuery] = useState('');
  const [groups, setGroups] = useState<Set<FeedGroup>>(() => new Set(FEED_GROUPS));
  const [pilot, setPilot] = useState<string | null>(null);
  const [cursorT, setCursorT] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const stripRef = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  /** scrolls we caused ourselves must not move the cursor back */
  const programmaticUntil = useRef(0);

  const [d0, d1] = domain ?? (events.length > 0 ? [events[0].t, events[events.length - 1].t] : [0, 1]);
  const span = Math.max(1, d1 - d0);
  const pilots = useMemo(() => pilotsIn(events), [events]);
  const groupCounts = useMemo(() => {
    const c: Record<FeedGroup, number> = { dealt: 0, received: 0, ewar: 0, mining: 0, ship: 0, other: 0 };
    for (const e of events) c[FEED_GROUP_OF[e.kind]]++;
    return c;
  }, [events]);
  const filtered = useMemo(() => filterFeed(events, { query, groups, pilot }), [events, query, groups, pilot]);
  const rows = filtered.length > ROW_CAP ? filtered.slice(filtered.length - ROW_CAP) : filtered;

  const toggleGroup = (g: FeedGroup) => setGroups((cur) => {
    const next = new Set(cur);
    if (next.has(g)) next.delete(g); else next.add(g);
    return next;
  });

  // the STRIP drives the LIST: put the first row at/after the cursor mid-view
  const scrollListTo = (t: number) => {
    const list = listRef.current;
    if (!list || rows.length === 0) return;
    let lo = 0, hi = rows.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (rows[mid].t < t) lo = mid + 1; else hi = mid; }
    const rowH = list.scrollHeight / rows.length;
    programmaticUntil.current = Date.now() + 400;
    list.scrollTo({ top: Math.max(0, lo * rowH - list.clientHeight / 2 + rowH / 2) });
  };
  const timeAtStrip = (clientX: number): number => {
    const r = stripRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return d0;
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    return d0 + frac * span;
  };
  const pickAt = (clientX: number) => {
    const t = timeAtStrip(clientX);
    setCursorT(t);
    scrollListTo(t);
  };
  useEffect(() => {
    if (!dragging.current) return undefined;
    const move = (e: MouseEvent) => { if (dragging.current) pickAt(e.clientX); };
    const up = () => { dragging.current = false; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging.current]);

  // the LIST drives the STRIP: the row at mid-view is where the cursor sits
  const onListScroll = () => {
    if (Date.now() < programmaticUntil.current) return;
    const list = listRef.current;
    if (!list || rows.length === 0) return;
    const rowH = list.scrollHeight / rows.length;
    const idx = Math.max(0, Math.min(rows.length - 1, Math.floor((list.scrollTop + list.clientHeight / 2) / rowH)));
    setCursorT(rows[idx].t);
  };

  const xOf = (t: number) => (1000 * (t - d0)) / span;
  const nearestIdx = useMemo(() => {
    if (cursorT === null || rows.length === 0) return -1;
    let best = 0, bestD = Infinity;
    for (let i = 0; i < rows.length; i++) { const d = Math.abs(rows[i].t - cursorT); if (d < bestD) { bestD = d; best = i; } }
    return best;
  }, [cursorT, rows]);

  return (
    <div className="feed-panel">
      {/* ---- search + filters ---- */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <input type="text" value={query} placeholder="search the feed… (pilot, ship, weapon, ore, amount)" spellCheck={false}
          style={{ minWidth: 260, fontSize: 13 }} onChange={(e) => setQuery(e.target.value)} />
        <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {FEED_GROUPS.map((g) => (
            <button key={g} className={`btn mini feed-group${groups.has(g) ? ' on' : ''}`}
              title={`${groups.has(g) ? 'hide' : 'show'} ${GROUP_LABEL[g]} (${groupCounts[g]})`}
              style={{ borderColor: groups.has(g) ? GROUP_COLOR[g] : undefined, color: groups.has(g) ? GROUP_COLOR[g] : undefined }}
              onClick={() => toggleGroup(g)}>
              {GROUP_LABEL[g]} <span className="dim">{groupCounts[g]}</span>
            </button>
          ))}
        </span>
        <span className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>
          {filtered.length.toLocaleString()} of {events.length.toLocaleString()} events
          {filtered.length > ROW_CAP ? ` · showing the last ${ROW_CAP.toLocaleString()} — narrow with the filters` : ''}
        </span>
      </div>
      {pilots.length > 0 && (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6, fontSize: 12 }}>
          <span className="dim" title="everyone the log names — pick one to see just your exchange with them">opponents:</span>
          <button className={`btn mini${pilot === null ? ' on' : ''}`} onClick={() => setPilot(null)}>everyone</button>
          {pilots.slice(0, 8).map((p) => (
            <button key={p.name} className={`btn mini feed-pilot${pilot === p.name ? ' on' : ''}`}
              title={`${p.n} lines with ${p.name} — dealt, received, EWAR`}
              onClick={() => setPilot(pilot === p.name ? null : p.name)}>
              {p.name} <span className="dim">{p.n}</span>
            </button>
          ))}
          {pilots.length > 8 && (
            <select value={pilot ?? ''} style={{ fontSize: 12 }} onChange={(e) => setPilot(e.target.value || null)}>
              <option value="">…{pilots.length - 8} more</option>
              {pilots.slice(8).map((p) => <option key={p.name} value={p.name}>{p.name} ({p.n})</option>)}
            </select>
          )}
        </div>
      )}

      {/* ---- the scrubbable timeline: ticks are the FILTERED events ---- */}
      <div style={{ position: 'relative', marginBottom: 6 }}>
        <svg ref={stripRef} className="feed-strip" viewBox="0 0 1000 44" preserveAspectRatio="none" width="100%" height={44}
          style={{ display: 'block', background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 6, cursor: 'ew-resize' }}
          role="img" aria-label="timeline of the filtered events — click or drag to move the feed"
          onMouseDown={(e) => { e.preventDefault(); dragging.current = true; pickAt(e.clientX); }}>
          {(fights ?? []).map((f, i) => (
            <rect key={i} x={xOf(f.t0)} y={0} width={Math.max(2, xOf(f.t1) - xOf(f.t0))} height={44} fill="rgba(255,91,91,0.12)" />
          ))}
          {rows.map((e, i) => {
            const g = FEED_GROUP_OF[e.kind];
            const lane = g === 'dealt' ? 4 : g === 'received' ? 16 : g === 'ewar' ? 28 : 34;
            return <rect key={i} x={xOf(e.t)} y={lane} width={1.6} height={g === 'mining' || g === 'ship' || g === 'other' ? 8 : 10} fill={GROUP_COLOR[g]} />;
          })}
          {cursorT !== null && <rect x={xOf(cursorT) - 1} y={0} width={2} height={44} fill="var(--ink)" opacity={0.9} />}
        </svg>
        <div className="dim" style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, marginTop: 2 }}>
          <span>{hhmmss(d0)}</span>
          <span>{cursorT !== null ? `cursor ${hhmmss(cursorT)} · drag the strip, or scroll the list` : 'click or drag the strip — the list follows; scroll the list — the cursor follows'}</span>
          <span>{hhmmss(d1)}</span>
        </div>
      </div>

      {/* ---- the list, oldest first so the strip reads left → right ---- */}
      <div ref={listRef} className="feed-list" onScroll={onListScroll}
        style={{ maxHeight: 520, overflowY: 'auto', fontSize: 13.5, lineHeight: 1.7 }}>
        {rows.length === 0 && <div className="hint" style={{ padding: 8 }}>nothing matches — clear the search or turn a group back on</div>}
        {rows.map((e, i) => {
          const k = FEED_TAG[e.kind];
          const near = cursorT !== null && Math.abs(e.t - cursorT) <= HIGHLIGHT_MS;
          const exact = i === nearestIdx;
          return (
            <div key={i} data-t={e.t} className={`feed-row${near ? ' near' : ''}${exact ? ' exact' : ''}`}
              style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', borderRadius: 6,
                background: exact ? 'var(--accent-dim)' : near ? 'rgba(77,163,255,0.12)' : i % 2 === 0 ? 'rgba(128,128,128,.05)' : 'transparent',
                outline: exact ? '1px solid var(--accent)' : undefined,
              }}>
              <span className="dim" style={{ flex: 'none', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{hhmmss(e.t)}</span>
              <span className={k.cls} style={{ flex: 'none', minWidth: 34, textAlign: 'center', fontWeight: 700, fontSize: 11.5, padding: '2px 6px', borderRadius: 5, background: 'rgba(128,128,128,.14)' }}>{k.tag}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><Row e={e} /></span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
