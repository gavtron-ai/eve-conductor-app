// THE CURVE, AGAINST THE ACTUAL TARGET.
//
// The Applied Damage tab draws a fit against a target you describe. This draws
// the whole attacking team against the ship you actually put in the fight —
// real signature, real speed, real per-layer resistances — and marks where each
// attacker is currently sitting, so "should I be closer?" has an answer you can
// see rather than one you have to binary-search by hand.
//
// One line per attacker plus the team total, because the useful question is
// usually which SHIP is in the wrong place, not what the sum does.
import { useMemo, useRef, useState } from 'react';
import {
  geometryFrom, landedDamagePerSecond, afterResists,
  type SimTarget, type SimWeapon, type Layer,
} from '../lib/fitSim';

export interface ChartShip {
  id: string;
  name: string;
  weapons: SimWeapon[];
  /** the heading and speed it is ACTUALLY flying — the same numbers the
   * outcome table used, so the curve and the table cannot disagree */
  angleDeg: number;
  speed: number;
  /** where it is now — drawn as a marker on its own line */
  range: number;
}

import { shipColour } from '../lib/teamColours';

const n0 = (v: number) => Math.round(v).toLocaleString();
const kmLabel = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(0)} km` : `${Math.round(m)} m`);

/**
 * Applied dps for one attacker at an arbitrary range, against the real target.
 *
 * Resistances are applied to the SHIELD layer here rather than walked through
 * all three: a curve is about where damage lands, and re-deriving a full
 * time-to-kill at 120 sample points per ship would be both slow and harder to
 * read. The outcome table beside it carries the layer-by-layer truth, and the
 * caption says which layer this line is drawn against.
 */
function dpsAt(
  ship: ChartShip, target: SimTarget, targetAngle: number, targetSpeed: number,
  range: number, layer: Layer, sustained: boolean,
): number {
  const g = geometryFrom(
    { speed: ship.speed, angleDeg: ship.angleDeg, range },
    { speed: targetSpeed, angleDeg: targetAngle },
    1000,
  );
  const landed = landedDamagePerSecond(
    ship.weapons, { ...target, velocity: g.targetSpeed }, g.engagement, sustained,
  );
  return afterResists(landed, layer.resonance);
}

export default function BattleChart({
  ships, target, targetAngle, targetSpeed, layer, sustained, maxRange,
  showTotal = true, header = true, palette, legendColumn = false,
}: {
  ships: ChartShip[];
  target: SimTarget;
  targetAngle: number;
  targetSpeed: number;
  /** the layer the curve is drawn against — named in the caption */
  layer: Layer;
  sustained: boolean;
  maxRange: number;
  /** the ammo-comparison reuse (v0.98.1): variants of ONE ship have no
   * meaningful team total, and their card supplies its own header */
  showTotal?: boolean;
  header?: boolean;
  /** distinct line colours (v0.98.2) — eight ammo variants in the team's
   * blue family were indistinguishable (caught by screenshot) */
  palette?: string[];
  /** ammo mode (v0.98.4): names live in a FIXED legend column right of the
   * plot (floating labels kept overlapping at scale — caught twice), and a
   * strip under the curves shows the BEST line per range band, pyfa-style */
  legendColumn?: boolean;
}) {
  const STEPS = 90;
  const H = 280, PAD_L = 58, PAD_B = 34, PAD_T = 12, PAD_R = 12;
  // the legend column extends the canvas; the PLOT keeps its width
  const LEGEND_W = 232;
  const W = legendColumn ? 760 + LEGEND_W : 760;
  const plotR = legendColumn ? 760 - PAD_R : W - PAD_R;
  /** which sample the pointer is nearest — a chart you cannot read a value off
   * is a picture, not an instrument */
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const series = useMemo(() => {
    const xs = Array.from({ length: STEPS + 1 }, (_, i) => (maxRange * i) / STEPS);
    const perShip = ships.map((s) => ({
      ship: s,
      points: xs.map((x) => ({ x, y: dpsAt(s, target, targetAngle, targetSpeed, x, layer, sustained) })),
    }));
    const total = xs.map((x, i) => ({
      x,
      y: perShip.reduce((sum, p) => sum + p.points[i].y, 0),
    }));
    return { perShip, total };
  }, [ships, target, targetAngle, targetSpeed, layer, sustained, maxRange]);

  const yMax = showTotal
    ? Math.max(1, ...series.total.map((p) => p.y))
    : Math.max(1, ...series.perShip.flatMap((p) => p.points.map((q) => q.y)));
  const step = Math.pow(10, Math.floor(Math.log10(yMax))) / 2;
  const yTop = Math.max(step, Math.ceil(yMax / step) * step);

  const sx = (x: number) => PAD_L + (x / Math.max(1, maxRange)) * (plotR - PAD_L);
  const sy = (y: number) => H - PAD_B - (y / yTop) * (H - PAD_B - PAD_T);
  const path = (pts: { x: number; y: number }[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');

  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const lineColour = (i: number) => palette?.[i % (palette.length || 1)] ?? shipColour('a', i).core;

  return (
    <div className="battle-chart sim-card">
      {header && (
        <div className="fight-timeline-head">
          <span className="sim-card-title">Applied damage by range</span>
          <span className="dim">
            what each Team A ship would land on {target.name}'s {layer.name.toLowerCase()} from any
            distance, at its current heading — markers show where each sits now
          </span>
        </div>
      )}
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Applied damage against ${target.name} by range`}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(ev) => {
          const el = svgRef.current;
          if (!el) return;
          // the SVG scales, so client pixels must be mapped back through the
          // viewBox rather than assumed 1:1
          const box = el.getBoundingClientRect();
          const x = ((ev.clientX - box.left) / box.width) * W;
          const frac = (x - PAD_L) / (plotR - PAD_L);
          if (frac < 0 || frac > 1) { setHover(null); return; }
          setHover(Math.round(frac * STEPS));
        }}>
        {ticks.map((f) => {
          const v = f * yTop;
          return (
            <g key={`y${f}`}>
              <line x1={PAD_L} x2={plotR} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" strokeWidth="1" />
              <text x={PAD_L - 8} y={sy(v) + 4} textAnchor="end" className="sim-tick">{n0(v)}</text>
            </g>
          );
        })}
        {ticks.map((f) => (
          <text key={`x${f}`} x={sx(f * maxRange)} y={H - PAD_B + 16} textAnchor="middle" className="sim-tick">
            {kmLabel(f * maxRange)}
          </text>
        ))}

        {/* the TEAM total, heaviest line (meaningless for ammo variants) */}
        {showTotal && (
          <path d={path(series.total)} fill="none" stroke="var(--ink)" strokeWidth="2.5" opacity="0.9" />
        )}

        {series.perShip.map((p, i) => {
          const colour = lineColour(i);
          const here = dpsAt(p.ship, target, targetAngle, targetSpeed, p.ship.range, layer, sustained);
          return (
            <g key={p.ship.id}>
              <path d={path(p.points)} fill="none" stroke={colour} strokeWidth="1.6" opacity="0.85" />
              {/* WHERE THIS SHIP ACTUALLY IS. The whole point of the chart is
                  seeing whether it is standing in the wrong place. */}
              {p.ship.range <= maxRange && (
                <>
                  <line x1={sx(p.ship.range)} x2={sx(p.ship.range)} y1={sy(here)} y2={H - PAD_B}
                    stroke={colour} strokeWidth="1" strokeDasharray="2 3" opacity="0.6" />
                  <circle cx={sx(p.ship.range)} cy={sy(here)} r="4" fill={colour} />
                  {/* the number AT the dot — a marker you have to hover to read
                      is a marker you do not read. Flipped to the left near the
                      right edge so it never runs off the plot. Suppressed for
                      ammo variants: they all stand at the SAME range and the
                      numbers piled onto one spot (hover carries them). */}
                  {showTotal && (
                    <text
                      x={sx(p.ship.range) + (sx(p.ship.range) > W - 90 ? -8 : 8)}
                      y={sy(here) - 6}
                      textAnchor={sx(p.ship.range) > W - 90 ? 'end' : 'start'}
                      className="sim-tick" style={{ fill: colour }}>
                      {n0(here)}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}

        {hover !== null && series.total[hover] && legendColumn && (() => {
          const hx = sx(series.total[hover].x);
          return (
            <g>
              <line x1={hx} x2={hx} y1={PAD_T} y2={H - PAD_B}
                stroke="var(--ink-2)" strokeWidth="1" opacity="0.5" />
              {series.perShip.map((p, i) => (
                <circle key={`hd${p.ship.id}`} cx={hx} cy={sy(p.points[hover].y)} r="3"
                  fill={lineColour(i)} />
              ))}
            </g>
          );
        })()}
        {hover !== null && series.total[hover] && !legendColumn && (() => {
          const hx = sx(series.total[hover].x);
          const flip = hx > W / 2;
          /**
           * NAMED HOVER LABELS (v0.98.1) — "when hovering it should show
           * which ammo is for each line". Every line gets `name value` at
           * the crosshair, labels SETTLE downward so they never overlap
           * (the map's dodge discipline), and a dotted leader runs from
           * each label back to its point on the line.
           */
          const entries: { name: string; colour: string; y: number }[] = [
            ...(showTotal ? [{ name: 'team total', colour: 'var(--ink)', y: series.total[hover].y }] : []),
            ...series.perShip.map((p, i) => ({
              name: p.ship.name, colour: lineColour(i), y: p.points[hover].y,
            })),
          ];
          const placed = entries
            .map((e) => ({ ...e, py: sy(e.y), ly: sy(e.y) }))
            .sort((a, b) => a.py - b.py);
          for (let i = 0; i < placed.length; i++) {
            // 16px steps: the rendered label height, measured — 13 still
            // touched at the app's inherited font size
            const minY = i === 0 ? PAD_T + 10 : placed[i - 1].ly + 16;
            placed[i].ly = Math.max(placed[i].ly, minY);
          }
          const over = placed.length > 0
            ? placed[placed.length - 1].ly - (H - PAD_B - 4) : 0;
          if (over > 0) for (const e of placed) e.ly -= over;
          const lx = hx + (flip ? -10 : 10);
          return (
            <g>
              <line x1={hx} x2={hx} y1={PAD_T} y2={H - PAD_B}
                stroke="var(--ink-2)" strokeWidth="1" opacity="0.5" />
              {placed.map((e) => (
                <g key={`h${e.name}`}>
                  <circle cx={hx} cy={e.py} r="3" fill={e.colour} />
                  <line x1={hx} y1={e.py} x2={lx} y2={e.ly - 4}
                    stroke={e.colour} strokeWidth="1" strokeDasharray="2 2" opacity="0.7" />
                  <text x={lx + (flip ? -2 : 2)} y={e.ly}
                    textAnchor={flip ? 'end' : 'start'} className="sim-tick"
                    style={{ fontSize: 10, fill: e.colour }}>
                    {e.name} {n0(e.y)}
                  </text>
                </g>
              ))}
            </g>
          );
        })()}
        <line x1={PAD_L} x2={plotR} y1={sy(0)} y2={sy(0)} stroke="var(--baseline)" strokeWidth="1" />
        <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={H - PAD_B} stroke="var(--baseline)" strokeWidth="1" />
        {/* the y caption used to sit at x=4,y=top and ran straight through the
            highest tick number — rotated up the axis it collides with nothing */}
        <text x={plotR} y={H - 4} textAnchor="end" className="sim-axis">
          Range to {target.name}
        </text>

        {legendColumn && (() => {
          /**
           * THE FIXED LEGEND (v0.98.4): one row per curve, sorted by the
           * value at the hovered range (or each ship's own fight range at
           * rest). Fixed rows cannot overlap — the floating labels kept
           * colliding at monitor scale no matter the spacing.
           */
          const lx = plotR + 16;
          const rows = series.perShip.map((p, i) => ({
            name: p.ship.name,
            colour: lineColour(i),
            v: hover !== null
              ? p.points[hover].y
              : dpsAt(p.ship, target, targetAngle, targetSpeed, p.ship.range, layer, sustained),
          })).sort((a, b) => b.v - a.v);
          return (
            <g>
              <text x={lx} y={PAD_T + 8} className="sim-tick" style={{ fontSize: 10 }}
                fill="var(--muted)">
                {hover !== null ? `at ${kmLabel(series.total[hover].x)}` : 'at fight range'}
              </text>
              {rows.map((e, i) => {
                const y = PAD_T + 24 + i * 17;
                return (
                  <g key={`lg${e.name}`}>
                    <rect x={lx} y={y - 8} width="10" height="10" rx="2" fill={e.colour} />
                    <text x={lx + 15} y={y} className="sim-tick" style={{ fontSize: 10 }}
                      fill="var(--ink-2)">
                      {e.name.length > 26 ? `${e.name.slice(0, 25)}…` : e.name}
                    </text>
                    <text x={W - 8} y={y} textAnchor="end" className="sim-tick"
                      style={{ fontSize: 10, fill: e.colour }}>
                      {n0(e.v)}
                    </text>
                  </g>
                );
              })}
            </g>
          );
        })()}

        {legendColumn && !showTotal && (() => {
          /**
           * THE ENVELOPE STRIP (v0.98.4) — the pyfa read: ammo curves CROSS
           * (ammo mode only: team-mates are not alternatives to choose
           * between, so a who-wins strip would be noise there)
           * (range and tracking modifiers are in the engine numbers, so the
           * starts AND ends of the curves genuinely differ), and each band
           * of the strip is coloured by whichever charge WINS that range.
           * Hover a band for "best from X to Y: name".
           */
          const win: number[] = [];
          for (let i = 0; i <= STEPS; i++) {
            let best = -1;
            let bv = 0.5; // below half a dps nothing "wins"
            series.perShip.forEach((p, j) => {
              if (p.points[i].y > bv) { bv = p.points[i].y; best = j; }
            });
            win.push(best);
          }
          const segs: { from: number; to: number; who: number }[] = [];
          for (let i = 0; i <= STEPS; i++) {
            const w2 = win[i];
            if (segs.length > 0 && segs[segs.length - 1].who === w2) segs[segs.length - 1].to = i;
            else segs.push({ from: i, to: i, who: w2 });
          }
          const yBand = H - PAD_B - 7;
          return (
            <g>
              {segs.filter((g2) => g2.who >= 0).map((g2, k) => {
                const x1 = sx((maxRange * g2.from) / STEPS);
                const x2 = sx((maxRange * Math.min(STEPS, g2.to + 1)) / STEPS);
                const p = series.perShip[g2.who];
                return (
                  <rect key={`seg${k}`} x={x1} y={yBand} width={Math.max(0, x2 - x1)} height="5"
                    fill={lineColour(g2.who)} opacity="0.9">
                    <title>{`best from ${kmLabel((maxRange * g2.from) / STEPS)} to ${kmLabel((maxRange * Math.min(STEPS, g2.to + 1)) / STEPS)}: ${p.ship.name}`}</title>
                  </rect>
                );
              })}
            </g>
          );
        })()}
        <text className="sim-axis" textAnchor="middle"
          transform={`translate(12, ${(H - PAD_B + PAD_T) / 2}) rotate(-90)`}>
          dps onto {layer.name.toLowerCase()}
        </text>
      </svg>

      {/* THE READOUT. Values at the hovered range, per ship and in total. */}
      <div className="battle-hover">
        {hover !== null && series.total[hover] ? (
          <>
            <b>{kmLabel(series.total[hover].x)}</b>
            <span><i>total</i> {n0(series.total[hover].y)} dps</span>
            {series.perShip.map((p, i) => (
              <span key={p.ship.id}>
                <i style={{ color: shipColour('a', i).core }}>{p.ship.name}</i>
                {n0(p.points[hover].y)}
              </span>
            ))}
          </>
        ) : <span className="dim">hover the chart for values at any range</span>}
      </div>

      <div className="battle-legend">
        <span><i style={{ background: 'var(--ink)' }} />team total</span>
        {ships.map((s, i) => (
          <span key={s.id}>
            <i style={{ background: shipColour('a', i).core }} />
            {s.name} <span className="dim">· {kmLabel(s.range)}</span>
          </span>
        ))}
      </div>
      <div className="hint">
        Drawn against <b>{target.name}</b>’s real {layer.name.toLowerCase()} resistances, with every
        ship keeping the behaviour you set — so moving an attacker along its own line is exactly what
        changing its range would do. The dot is where it is now. Damage onto armour and hull differs;
        the table above walks all three layers in order.
      </div>
    </div>
  );
}
