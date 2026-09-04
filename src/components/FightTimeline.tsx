// THE FIGHT, DRAWN OVER TIME — and replayed.
//
// BattleChart answers "where should I be standing" — damage by range. This
// answers "how did the fight actually go", four ways: hit points, capacitor,
// DISTANCE and TRANSVERSAL per ship per second, from the simulation's own
// 1 Hz sampler. The kink where an ancillary runs dry, the neut volley that
// started a capacitor slide, the approach leg flattening as a ship arrives
// on its hold range — visible, not narrated.
//
// Every discrete event is an ICON on the strip under the chart (☠ death,
// ⚡ cap, ▼ neut, ✚ remote heal, ↻ reload, ⛔ scram…) with the detail on
// hover. And hovering anywhere replays the BATTLEFIELD: a mini-map shows
// where every ship actually was at that second, using the sampled ranges —
// recorded as the fight happened, not recomputed after.
//
// Nothing here recomputes the fight.
import { useMemo, useRef, useState } from 'react';
import type { EventBattleResult, TimelineEntry } from '../lib/battleEvents';
import { rosterColours } from '../lib/teamColours';

type Mode = 'hp' | 'cap' | 'range' | 'transversal' | 'sig';

const MODE_LABEL: Record<Mode, string> = {
  hp: 'hit points',
  cap: 'capacitor',
  range: 'distance',
  transversal: 'transversal',
  sig: 'signature',
};

const EVENT_GLYPH: Record<TimelineEntry['kind'], { glyph: string; label: string }> = {
  death: { glyph: '☠', label: 'destroyed' },
  capStarved: { glyph: '⚡', label: 'capacitor starved' },
  neuted: { glyph: '▼', label: 'neutralizing' },
  repped: { glyph: '✚', label: 'remote repped' },
  reloadStart: { glyph: '↻', label: 'reloading' },
  scrammed: { glyph: '⛔', label: 'scrammed — MWD dead' },
  scramReleased: { glyph: '▶', label: 'scram released' },
  spoolMax: { glyph: '▲', label: 'max spool' },
  wasted: { glyph: '∅', label: 'volley wasted (target already dead)' },
  jammed: { glyph: '✖', label: 'JAMMED — all locks dropped' },
  jamEnded: { glyph: '◉', label: 'jam ended — re-locking' },
  locking: { glyph: '…', label: 're-acquiring lock' },
  boosted: { glyph: '♦', label: 'command burst applied' },
  painted: { glyph: '◎', label: 'PAINTED — signature bloomed' },
  paintEnded: { glyph: '○', label: 'paint dropped' },
  anchorLost: { glyph: '⌖', label: 'anchor died — re-anchored' },
  injected: { glyph: '💉', label: 'cap stick injected' },
  hardenersDown: { glyph: '🛡', label: 'HARDENERS DOWN — resists collapsed' },
  hardenersUp: { glyph: '🛡', label: 'hardeners back up — resists restored' },
};

const secLabel = (s: number) => (s >= 60 ? `${Math.floor(s / 60)}m${Math.round(s % 60).toString().padStart(2, '0')}` : `${Math.round(s)}s`);
const kmLabel = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);

export default function FightTimeline({ fight, hideEventsFor }: {
  fight: EventBattleResult;
  /** ships whose EVENT ICONS are hidden from the strip under the chart —
   * base card names; expanded copies ("name ×2") follow their card. The
   * hover replay stays complete: this hides icons, never information. */
  hideEventsFor?: string[];
}) {
  const W = 760, PAD_L = 46, PAD_B = 14, PAD_T = 12, PAD_R = 12;
  /** the CHART band is fixed; the event strip below it grows row by row */
  const chartBottom = 212;
  const ICON_W = 14, ROW_H = 16, CLUSTER_SPAN = 20;
  const [hover, setHover] = useState<number | null>(null);
  const [mode, setMode] = useState<Mode>('hp');
  /** legend entries toggle their ship's series — a six-ship fight is
   * unreadable with every line on at once */
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  /** the CLICKED event square — its full story pins into the readout row
   * (hover was a 1px target on a dense strip; a click is deliberate) */
  const [pinnedIdx, setPinnedIdx] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { ids, names, sides, colours, tMax } = useMemo(() => ({
    ids: fight.ships.map((s) => s.id),
    names: new Map(fight.ships.map((s) => [s.id, s.name])),
    sides: new Map(fight.ships.map((s) => [s.id, s.side])),
    colours: rosterColours(fight.ships),
    tMax: Math.max(1, fight.series.length ? fight.series[fight.series.length - 1].t : fight.elapsed),
  }), [fight]);

  const sx = (t: number) => PAD_L + (t / tMax) * (W - PAD_L - PAD_R);

  /**
   * THE EVENT STRIP, rebuilt (v0.115.1, from the owner's screenshot):
   *  · icons sit at the event's TRUE time — the old row-packer NUDGED them
   *    rightward to avoid overlap, so icons drifted off their moment;
   *  · a run of the SAME event on the SAME ship (a neut landing every few
   *    seconds for twenty minutes) coalesces into one square with a ×count
   *    — one icon per happening, not four thousand triangles;
   *  · overlap is solved by adding ROWS, never by moving icons sideways;
   *  · every square is a real CLICK target that pins its full story
   *    (what, who, when-to-when, aggregate GJ) into the readout row.
   */
  const clusters = useMemo(() => {
    const iconHidden = (who: string): boolean =>
      (hideEventsFor ?? []).some((n) => who === n || who.startsWith(`${n} ×`));
    const byKey = new Map<string, TimelineEntry[]>();
    for (const e of fight.events) {
      if (!EVENT_GLYPH[e.kind] || iconHidden(e.who)) continue;
      const k = `${e.who}|${e.kind}`;
      (byKey.get(k) ?? byKey.set(k, []).get(k)!).push(e);
    }
    const out: {
      who: string; kind: TimelineEntry['kind']; x: number; w: number;
      t0: number; t1: number; n: number; details: string[]; row: number;
    }[] = [];
    for (const list of byKey.values()) {
      list.sort((a, b) => a.t - b.t);
      for (const e of list) {
        const x = sx(e.t);
        const cur = out.length > 0 ? out[out.length - 1] : null;
        if (cur && cur.who === e.who && cur.kind === e.kind && x - cur.x <= CLUSTER_SPAN) {
          cur.n += 1;
          cur.t1 = e.t;
          if (e.detail) cur.details.push(e.detail);
        } else {
          out.push({
            who: e.who, kind: e.kind, x, w: ICON_W, t0: e.t, t1: e.t,
            n: 1, details: e.detail ? [e.detail] : [], row: 0,
          });
        }
      }
    }
    // width follows the label — "×420" must FIT (owner's screenshot caught
    // counts spilling out of fixed-width boxes)
    for (const c of out) {
      if (c.n > 1) c.w = ICON_W + 6 + `×${c.n}`.length * 5.5;
    }
    // rows, never nudges: place each square (in time order) on the first
    // row with space at its TRUE x; add rows until everything fits
    out.sort((a, b) => a.x - b.x || a.who.localeCompare(b.who));
    const rowEnds: number[] = [];
    for (const c of out) {
      c.x = Math.min(c.x, W - PAD_R - c.w); // right-edge clamp only
      let r = rowEnds.findIndex((end) => c.x >= end + 2);
      if (r === -1) { r = rowEnds.length; rowEnds.push(-Infinity); }
      c.row = r;
      rowEnds[r] = c.x + c.w;
    }
    return { list: out, rows: Math.max(1, rowEnds.length) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fight, hideEventsFor?.join('|'), tMax]);

  const stripTop = chartBottom + 6;
  const stripBottom = stripTop + clusters.rows * ROW_H;
  const H = stripBottom + 16 + PAD_B;

  if (fight.series.length < 2) return null;

  // fractional modes are 0..1; metric modes scale to their own maximum
  const fractional = mode === 'hp' || mode === 'cap';
  const yMax = fractional ? 1
    : Math.max(1, ...fight.series.flatMap((p) => ids.map((id) => p[mode][id] ?? 0)));

  const sy = (v: number) => chartBottom - Math.max(0, Math.min(1, v / yMax)) * (chartBottom - PAD_T);

  const pathFor = (id: string) =>
    fight.series
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.t).toFixed(1)},${sy(p[mode][id] ?? 0).toFixed(1)}`)
      .join(' ');

  // the replay panel is PERMANENT: hovering scrubs it, resting shows how the
  // fight ENDED — it popping in and out on hover made the layout jump
  const shownPoint = fight.series[Math.min(
    hover ?? fight.series.length - 1, fight.series.length - 1,
  )];
  const hoverPoint = hover !== null ? shownPoint : null;
  const hoverEvents = hoverPoint
    ? fight.events.filter((e) => Math.abs(e.t - hoverPoint.t) <= 0.5)
    : [];

  const fmt = (v: number) => (fractional ? `${Math.round(v * 100)}%`
    : mode === 'range' || mode === 'sig' ? kmLabel(v) : `${Math.round(v)} m/s`);

  // ---- the replay minimap: where everyone WAS at the hovered second -------
  // v0.93.0: the series carries TRUE positions, so the replay plots real
  // (x, y) geometry with a ▲/▼ note when a ship sits out of the plane. Old
  // results without positions fall back to the radial fold and SAY SO —
  // ranges dressed up as positions would be a lie.
  const replay = () => {
    if (!shownPoint) return null;
    const RS = 190;
    const RC = RS / 2;
    const RPAD = 22;
    const targetIds = ids.filter((id) => sides.get(id) === 'b');
    const attackerIds = ids.filter((id) => sides.get(id) === 'a');
    const hasPos = shownPoint.pos !== undefined
      && attackerIds.every((id) => shownPoint.pos![id] !== undefined);
    const rmax = hasPos
      ? Math.max(2000, ...ids.map((id) => {
        const p = shownPoint.pos![id];
        return p ? Math.hypot(p[0], p[1]) : 0;
      }))
      : Math.max(2000, ...attackerIds.map((id) => shownPoint.range[id] ?? 0));
    const rpx = (m: number) => Math.sqrt(Math.min(m, rmax) / rmax) * (RC - RPAD);
    const deadAt = (id: string) => {
      const ship = fight.ships.find((x) => x.id === id);
      return ship !== undefined && ship.diedAt !== null && ship.diedAt <= shownPoint.t;
    };
    /** true position → screen (y-flipped, sqrt-scaled radially) */
    const screenOf = (id: string): { x: number; y: number; z: number } => {
      const p = shownPoint.pos![id]!;
      const rho = Math.hypot(p[0], p[1]);
      const s = rho > 0 ? rpx(rho) / rho : 0;
      return { x: RC + p[0] * s, y: RC - p[1] * s, z: p[2] };
    };
    const sideH = 110;
    const sideView = hasPos ? (
      <svg viewBox={`0 0 ${RS} ${sideH}`} className="fight-replay" role="img"
        aria-label={`Ship elevations at ${secLabel(shownPoint.t)}`}>
        <line x1={8} y1={sideH / 2} x2={RS - 8} y2={sideH / 2}
          stroke="var(--grid)" strokeWidth="1" />
        {ids.map((id) => {
          const pp = shownPoint.pos![id];
          if (!pp) return null;
          const rho = Math.hypot(pp[0], pp[1]);
          const z = pp[2];
          // the same sqrt radial scale as the top panel, folded per ship:
          // horizontal = distance from the reference, vertical = z
          const x = 10 + (rpx(rho) / (RC - RPAD)) * (RS - 20);
          const zPix = (rpx(Math.abs(z)) / (RC - RPAD)) * (sideH / 2 - 10);
          const y = sideH / 2 - Math.sign(z) * zPix;
          const c = colours.get(id)!;
          const dead = deadAt(id);
          return (
            <g key={`sv${id}`}>
              <circle cx={x} cy={y} r="4" fill={dead ? 'none' : c.core}
                stroke={c.core} strokeWidth="1.4" opacity={dead ? 0.5 : 0.95} />
              {dead && <text x={x} y={y + 3} textAnchor="middle" className="sim-tick">☠</text>}
            </g>
          );
        })}
        <text x={RC} y={sideH - 3} textAnchor="middle" className="sim-tick">
          elevation — up is above the plane
        </text>
      </svg>
    ) : null;
    return (
      <div className="fight-replay-col">
      <svg viewBox={`0 0 ${RS} ${RS}`} className="fight-replay" role="img"
        aria-label={`Ship positions at ${secLabel(shownPoint.t)}`}>
        {[0.5, 1].map((f) => (
          <circle key={f} cx={RC} cy={RC} r={rpx(rmax * f)} fill="none" stroke="var(--grid)" strokeWidth="1" />
        ))}
        <text x={RC + 2} y={RC - rpx(rmax) - 2} className="sim-tick">{kmLabel(rmax)}</text>
        {targetIds.map((id) => {
          const at = hasPos ? screenOf(id) : { x: RC, y: RC, z: 0 };
          const c = colours.get(id)!;
          return (
            <g key={id}>
              <circle cx={at.x} cy={at.y} r="8.5" fill={c.glow} opacity={deadAt(id) ? 0 : 0.18} />
              <circle cx={at.x} cy={at.y} r="5.5" fill={deadAt(id) ? 'none' : c.core}
                stroke={c.core} strokeWidth="1.5" opacity={deadAt(id) ? 0.5 : 0.95} />
              {deadAt(id) && <text x={at.x} y={at.y + 3} textAnchor="middle" className="sim-tick">☠</text>}
            </g>
          );
        })}
        {attackerIds.map((id, i) => {
          const at = hasPos
            ? screenOf(id)
            : (() => {
              const b = (-90 + (i * 360) / Math.max(3, attackerIds.length)) * (Math.PI / 180);
              const r = rpx(shownPoint.range[id] ?? 0);
              return { x: RC + Math.cos(b) * r, y: RC + Math.sin(b) * r, z: 0 };
            })();
          const c = colours.get(id)!;
          const dead = deadAt(id);
          return (
            <g key={id}>
              <line x1={RC} y1={RC} x2={at.x} y2={at.y} stroke={c.glow} strokeWidth="1" strokeDasharray="3 3" opacity="0.45" />
              <circle cx={at.x} cy={at.y} r="7" fill={c.glow} opacity={dead ? 0 : 0.15} />
              <circle cx={at.x} cy={at.y} r="4.5" fill={dead ? 'none' : c.core} stroke={c.core} strokeWidth="1.5" opacity={dead ? 0.5 : 0.95} />
              {dead && <text x={at.x} y={at.y + 3} textAnchor="middle" className="sim-tick">☠</text>}
              <text x={at.x} y={at.y - 9} textAnchor="middle" className="sim-tick" style={{ fill: c.core }}>
                {kmLabel(shownPoint.range[id] ?? 0)}
              </text>
            </g>
          );
        })}
        {/* SHORT captions that FIT the 190px panel — the old sentence ran
            off the right edge (caught by screenshot); details live in rows */}
        {!hasPos && (
          <text x={RC} y={RS - 15} textAnchor="middle" className="sim-tick">
            ranges only — radial layout
          </text>
        )}
        <text x={RC} y={RS - 4} textAnchor="middle" className="sim-tick">
          {hover !== null ? `at ${secLabel(shownPoint.t)}` : `ended ${secLabel(shownPoint.t)} — hover to scrub`}
        </text>
      </svg>
      {sideView}
      </div>
    );
  };

  return (
    <div className="battle-chart sim-card">
      <div className="fight-timeline-head">
        <span className="sim-card-title">Fight over time</span>
        <span className="dim">
          hover for numbers, events, and the battlefield at that second
        </span>
        <span className="battle-presets">
          {(['hp', 'cap', 'range', 'transversal', 'sig'] as Mode[]).map((m) => (
            <button key={m} type="button" className={`btn mini${mode === m ? ' on' : ''}`}
              onClick={() => setMode(m)}>
              {MODE_LABEL[m]}
            </button>
          ))}
        </span>
      </div>
      <div className="fight-timeline-row">
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
          aria-label={`Per-ship ${MODE_LABEL[mode]} over the simulated fight`}
          onMouseLeave={() => setHover(null)}
          onMouseMove={(ev) => {
            const el = svgRef.current;
            if (!el) return;
            const box = el.getBoundingClientRect();
            const x = ((ev.clientX - box.left) / box.width) * W;
            const frac = (x - PAD_L) / (W - PAD_L - PAD_R);
            if (frac < 0 || frac > 1) { setHover(null); return; }
            setHover(Math.min(fight.series.length - 1, Math.round(frac * tMax)));
          }}>
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <g key={`y${f}`}>
              <line x1={PAD_L} x2={W - PAD_R} y1={sy(f * yMax)} y2={sy(f * yMax)} stroke="var(--grid)" strokeWidth="1" />
              <text x={PAD_L - 6} y={sy(f * yMax) + 4} textAnchor="end" className="sim-tick">
                {fractional ? `${Math.round(f * 100)}%` : mode === 'range' ? kmLabel(f * yMax) : Math.round(f * yMax)}
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={`x${f}`} x={sx(f * tMax)} y={stripBottom + 12} textAnchor="middle" className="sim-tick">
              {secLabel(f * tMax)}
            </text>
          ))}

          {ids.filter((id) => !hidden.has(id)).map((id) => {
            const c = colours.get(id)!;
            const w = sides.get(id) === 'b' ? 2.2 : 1.6;
            const d = pathFor(id);
            return (
              <g key={id}>
                <path d={d} fill="none" stroke={c.glow} strokeWidth={w + 2.2}
                  opacity="0.15" strokeLinejoin="round" strokeLinecap="round" />
                <path d={d} fill="none" stroke={c.core} strokeWidth={w}
                  opacity="0.95" strokeLinejoin="round" strokeLinecap="round" />
              </g>
            );
          })}

          {/* THE EVENT STRIP — squares at the event's TRUE time, one square
              per happening (runs coalesce with a ×count), rows added until
              nothing overlaps. Click a square to pin its story below. */}
          <line x1={PAD_L} x2={W - PAD_R} y1={chartBottom + 2} y2={chartBottom + 2} stroke="var(--grid)" strokeWidth="1" />
          {clusters.list.map((c, i) => {
            const g = EVENT_GLYPH[c.kind]!;
            const shipId = fight.ships.find((s2) => s2.name === c.who)?.id;
            const colour = shipId ? colours.get(shipId)!.core : 'var(--muted)';
            const yy = stripTop + c.row * ROW_H;
            const pinned = pinnedIdx === i;
            return (
              <g key={i} style={{ cursor: 'pointer' }}
                onClick={(ev) => { ev.stopPropagation(); setPinnedIdx(pinned ? null : i); }}>
                <title>{`${secLabel(c.t0)}${c.t1 > c.t0 ? `–${secLabel(c.t1)}` : ''} — ${c.who}: ${g.label}${c.n > 1 ? ` ×${c.n}` : ''} — click to pin`}</title>
                <rect x={c.x} y={yy} width={c.w} height={ROW_H - 2} rx="3"
                  fill={colour} fillOpacity={pinned ? 0.4 : 0.14}
                  stroke={colour} strokeWidth={pinned ? 1.6 : 0.8} />
                <text x={c.x + 7} y={yy + 11} textAnchor="middle"
                  className="sim-tick" style={{ fill: colour, fontSize: 10, pointerEvents: 'none' }}>
                  {g.glyph}
                </text>
                {c.n > 1 && (
                  <text x={c.x + 14} y={yy + 11} textAnchor="start"
                    className="sim-tick" style={{ fill: colour, fontSize: 9, pointerEvents: 'none' }}>
                    ×{c.n}
                  </text>
                )}
              </g>
            );
          })}

          {hoverPoint && (() => {
            // the scrub line CARRIES its time — reading it off the axis
            // meant losing your place (owner's ask)
            const lx = sx(hoverPoint.t);
            const lbl = secLabel(hoverPoint.t);
            const lw = lbl.length * 5.6 + 10;
            const flip = lx + 4 + lw > W - PAD_R; // hug the left side near the edge
            const bx = flip ? lx - 4 - lw : lx + 4;
            return (
              <g pointerEvents="none">
                <line x1={lx} x2={lx} y1={PAD_T} y2={chartBottom}
                  stroke="var(--muted)" strokeWidth="1" opacity="0.6" />
                <rect x={bx} y={PAD_T} width={lw} height={14} rx="3"
                  fill="rgba(10,12,16,0.92)" stroke="var(--grid)" strokeWidth="1" />
                <text x={bx + lw / 2} y={PAD_T + 10.5} textAnchor="middle"
                  className="sim-tick" style={{ fontSize: 10, fill: '#cfd6df' }}>
                  {lbl}
                </text>
              </g>
            );
          })()}

          {(() => {
            // THE PINNED CALLOUT — a clicked square tells its story right
            // where it happened, not in a little line at the bottom
            const pin = pinnedIdx !== null ? clusters.list[pinnedIdx] : undefined;
            if (!pin) return null;
            const g = EVENT_GLYPH[pin.kind]!;
            const shipId = fight.ships.find((s2) => s2.name === pin.who)?.id;
            const colour = shipId ? colours.get(shipId)!.core : 'var(--muted)';
            let landed = 0; let full = 0; let numeric = pin.details.length > 0;
            for (const d of pin.details) {
              const m = /^(\d+)(?: of (\d+))? GJ/.exec(d);
              if (!m) { numeric = false; break; }
              landed += Number(m[1]);
              if (m[2] !== undefined) full += Number(m[2]);
            }
            const lines: string[] = [
              `${g.glyph} ${g.label}${pin.n > 1 ? ` ×${pin.n}` : ''}`,
              pin.who,
              pin.t1 > pin.t0 ? `${secLabel(pin.t0)} – ${secLabel(pin.t1)}` : `at ${secLabel(pin.t0)}`,
            ];
            if (pin.n === 1 && pin.details[0]) lines.push(pin.details[0]);
            else if (pin.n > 1 && numeric) {
              lines.push(`${landed.toLocaleString()}${full > 0 ? ` of ${full.toLocaleString()}` : ''} GJ total`);
            }
            const boxW = Math.max(...lines.map((l) => l.length)) * 5.8 + 18;
            const boxH = lines.length * 13 + 10;
            const iconMidX = pin.x + pin.w / 2;
            const bx = Math.max(PAD_L + 2, Math.min(iconMidX - boxW / 2, W - PAD_R - boxW - 2));
            const iconTop = stripTop + pin.row * ROW_H;
            const by = iconTop - boxH - 7;
            return (
              <g style={{ cursor: 'pointer' }} onClick={() => setPinnedIdx(null)}>
                <line x1={iconMidX} y1={by + boxH} x2={iconMidX} y2={iconTop}
                  stroke={colour} strokeWidth="1" opacity="0.8" />
                <rect x={bx} y={by} width={boxW} height={boxH} rx="4"
                  fill="rgba(10,12,16,0.96)" stroke={colour} strokeWidth="1.4" />
                {lines.map((l, li) => (
                  <text key={li} x={bx + 8} y={by + 17 + li * 13}
                    className="sim-tick"
                    style={{ fontSize: 10.5, fill: li === 0 ? colour : '#cfd6df' }}>
                    {l}
                  </text>
                ))}
              </g>
            );
          })()}
        </svg>
        {replay()}
      </div>
      {/* STABLE LAYOUT (v0.94.0): the legend always shows values (at the
          hovered second, or the end) and the event readout always occupies
          its row — hover must never grow or shrink anything, because the
          resulting reflow made the whole panel "jump around" (caught live) */}
      <div className="battle-legend">
        {ids.map((id) => {
          const v = shownPoint ? shownPoint[mode][id] : undefined;
          const off = hidden.has(id);
          return (
            <button key={id} type="button" className="legend-toggle"
              title={off ? 'show this ship' : 'hide this ship'}
              style={{ color: colours.get(id)!.core, opacity: off ? 0.35 : 1 }}
              onClick={() => setHidden((h) => {
                const n = new Set(h);
                if (n.has(id)) n.delete(id); else n.add(id);
                return n;
              })}>
              {sides.get(id) === 'b' ? '◆' : '●'} {names.get(id)}
              {!off && v !== undefined ? ` ${fmt(v)}` : ''}
            </button>
          );
        })}
        <span className="dim">
          {hoverPoint ? `at ${secLabel(hoverPoint.t)}` : `at the end (${secLabel(shownPoint?.t ?? 0)})`}
        </span>
      </div>
      <div className="battle-hover">
        {hoverEvents.length > 0
          ? hoverEvents.slice(0, 6).map((e, i) => (
            <span key={i}>
              <i>{secLabel(e.t)}</i> {EVENT_GLYPH[e.kind]?.glyph} {e.who}: {EVENT_GLYPH[e.kind]?.label}
              {e.detail ? ` (${e.detail})` : ''}
            </span>
          ))
          : (
            <span className="dim">
              {hover !== null ? 'no events this second' : 'hover the chart to scrub — click an event square for its full story'}
            </span>
          )}
      </div>
    </div>
  );
}
