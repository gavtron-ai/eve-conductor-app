// THE FIGHT FROM ABOVE — drag ships to place them.
//
// The sim's inputs are per-ship: a range to the target, a heading, and (since
// v0.93.0) a TRUE position. Typing "12000" into a box never made the geometry
// click; a top-down view does. The reference ship sits at the centre, every
// other ship is a dot you DRAG — its distance to the centre IS its range
// input and the angle it sits at IS its azimuth input, updated live and
// committed by the same Calculate button as every other edit. Heading arrows
// show what each ship is doing with its speed.
//
// The old honest-limits caveat ("angular placement is presentation") is GONE
// because it stopped being true: the simulation is positional, azimuth is a
// real input, and ship-to-ship distances are simulated geometry.
//
// CONVENTIONS (declared): azimuth is stored 0 = +x/east, CCW positive, and
// rendered y-flipped (screen y grows downward) — the same convention as the
// heading dial. The radial drag snaps the HORIZONTAL distance rho (100 m up
// close, 500 m mid, 1 km far); with elevation set, range = rho/cos(el), so
// the top view never edits elevation and the side view never edits azimuth —
// no drag ever touches a hidden third coordinate.
import { useRef, useState } from 'react';
import type { Combatant } from '../lib/store';

import { shipColour } from '../lib/teamColours';

export interface MapShip {
  id: string;
  name: string;
  range: number;
  angleDeg: number;
  speed: number;
  /** degrees, 0 = +x, CCW positive (rendered y-flipped) */
  azimuthDeg: number;
  /** degrees, -89..89; 0 = the old planar placement */
  elevationDeg: number;
  /** roster id the ship's behaviour is anchored on; undefined = the target */
  anchorId?: string;
  /** the range this ship is TRYING to hold — drawn as a hollow marker on its
   * anchor line when it differs from where it starts */
  holdRange?: number;
}

const kmLabel = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.round(m)} m`);

/** nice ring steps that cover the furthest ship */
const ringsFor = (maxRange: number): number[] => {
  const steps = [1000, 2500, 5000, 10000, 15000, 25000, 50000, 75000, 100000, 150000, 250000];
  const top = steps.find((s) => s >= maxRange * 1.05) ?? 250000;
  return [top / 4, top / 2, (3 * top) / 4, top];
};

const rad = (deg: number) => (deg * Math.PI) / 180;

export default function TacticalMap({ target, attackers, defenders = [], onUpdate }: {
  /** Team B's REFERENCE ship — the world origin everyone places against */
  target: MapShip;
  attackers: MapShip[];
  /** the rest of Team B (v0.94.0: both sides are fleets), placed and
   * dragged exactly like Team A, drawn in Team B's colours */
  defenders?: MapShip[];
  onUpdate: (id: string, patch: Partial<Combatant>) => void;
}) {
  const SIZE = 460;
  const C = SIZE / 2;
  const PAD = 34;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sideRef = useRef<SVGSVGElement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [sideDragging, setSideDragging] = useState<string | null>(null);
  /**
   * THE SCALE FREEZES WHILE YOU DRAG. Without this, dragging outward grew
   * the outer ring, which shrank every pixel's metre value under the cursor
   * mid-drag — a feedback loop that turned "drag to 85 km" into a jump to
   * 250 km and made precise placement impossible. The rings re-fit only
   * after the pointer is released.
   */
  const frozenScale = useRef<number | null>(null);
  /** the user's own zoom (v0.95.1): lock the current scale and the map
   * stops re-fitting to ship distances entirely */
  const [lockedScale, setLockedScale] = useState<number | null>(null);

  /** every placed dot: Team A then Team B's fleet, each with its side's
   * colour index (the reference target is b/0, teammates b/1..) */
  const placed = [
    ...attackers.map((a, i) => ({ ship: a, side: 'a' as const, idx: i })),
    ...defenders.map((d, i) => ({ ship: d, side: 'b' as const, idx: i + 1 })),
  ];

  const maxRange = Math.max(5000, ...placed.map((p) => p.ship.range));
  const rings = ringsFor(frozenScale.current !== null
    ? Math.max(frozenScale.current, 1)
    : lockedScale !== null ? Math.max(lockedScale, 1) : maxRange);
  const rMax = frozenScale.current ?? lockedScale ?? rings[rings.length - 1];

  // sqrt radial scale: close-range brawls stay readable next to snipers
  const px = (m: number) => Math.sqrt(Math.min(m, rMax) / rMax) * (C - PAD);
  const metres = (p: number) => ((p / (C - PAD)) ** 2) * rMax;

  /** snap a horizontal distance to readable steps */
  const snap = (raw: number) => {
    const step = raw < 10000 ? 100 : raw < 50000 ? 500 : 1000;
    return Math.max(100, Math.round(raw / step) * step);
  };

  /** top-view position: azimuth (y-flipped) at the HORIZONTAL distance
   * rho = range·cos(el) — an elevated ship plots at its ground footprint */
  const posOf = (a: MapShip) => {
    const az = rad(a.azimuthDeg);
    const rho = a.range * Math.cos(rad(a.elevationDeg));
    // screen bearing (y grows downward): the y-flip of the world azimuth
    const b = -az;
    return { x: C + Math.cos(b) * px(rho), y: C + Math.sin(b) * px(rho), b };
  };

  const dragTo = (id: string, clientX: number, clientY: number) => {
    const el = svgRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const x = ((clientX - box.left) / box.width) * SIZE - C;
    const y = ((clientY - box.top) / box.height) * SIZE - C;
    const dist = Math.sqrt(x * x + y * y);
    const ship = placed.find((p) => p.ship.id === id)?.ship;
    const elev = rad(ship?.elevationDeg ?? 0);
    const rho = snap(metres(dist));
    // ELEVATION IS PRESERVED: the drag edits the ground footprint; the true
    // (slant) range follows from it
    const range = Math.max(100, Math.round(rho / Math.max(1e-2, Math.cos(elev))));
    const azimuthDeg = ((Math.atan2(-y, x) * 180) / Math.PI + 360) % 360;
    onUpdate(id, { range, azimuthDeg });
  };

  const sideDragTo = (id: string, clientX: number, clientY: number) => {
    const el = sideRef.current;
    if (!el) return;
    const box = el.getBoundingClientRect();
    const xPix = ((clientX - box.left) / box.width) * SIZE;
    const yPix = ((clientY - box.top) / box.height) * SIZE;
    const rho = snap(metres(Math.max(0, xPix - PAD)));
    const zPix = C - yPix; // up is +z
    const z = Math.sign(zPix) * metres(Math.abs(zPix));
    const range = Math.max(100, Math.round(Math.hypot(rho, z)));
    const elevationDeg = Math.max(-89, Math.min(89,
      Math.round((Math.atan2(z, rho) * 180) / Math.PI)));
    onUpdate(id, { range, elevationDeg });
  };

  /** heading arrow: 0° points AT the target (down the radial), 90° across it
   * — the same convention the dial uses (drawn in screen space) */
  const arrow = (cx: number, cy: number, bearing: number, angleDeg: number, colour: string, len = 16) => {
    const toCentre = bearing + Math.PI; // from the dot toward the target
    const a = toCentre + (angleDeg * Math.PI) / 180;
    const x2 = cx + Math.cos(a) * len;
    const y2 = cy + Math.sin(a) * len;
    return (
      <g>
        <line x1={cx} y1={cy} x2={x2} y2={y2} stroke={colour} strokeWidth="2" />
        <circle cx={x2} cy={y2} r="2.2" fill={colour} />
      </g>
    );
  };

  /** where a ship's behaviour anchor plots (the target unless anchored) */
  const anchorPointOf = (a: MapShip) => {
    if (a.anchorId !== undefined) {
      const other = placed.find((x) => x.ship.id === a.anchorId);
      if (other) return posOf(other.ship);
    }
    return { x: C, y: C, b: 0 };
  };

  /**
   * EVERY TEXT ON THE MAP DODGES EVERY OTHER (v0.95.1). The first pass only
   * settled ship names — the range labels on the dashed lines and the hold
   * labels stayed fixed and kept landing on names (caught by a second
   * screenshot). Now every label goes through the same greedy pass in a
   * deterministic order (per ship: range label, hold label, then name):
   * start at the natural spot, shift down a line at a time until it
   * overlaps nothing already placed. Dots are fixed obstacles.
   */
  const labelLayout = (() => {
    type Box = { x1: number; y1: number; x2: number; y2: number };
    const placedBoxes: Box[] = [];
    const boxFor = (cx: number, cy: number, text: string): Box => {
      // generous estimate: glyphs (arrows, degree signs, middle dots) render
      // wider than the average character, and an under-measured box is a
      // collision the pass cannot see - measured against real getBBox output
      const w = text.length * 7.4 + 8;
      return { x1: cx - w / 2, y1: cy - 12, x2: cx + w / 2, y2: cy + 4 };
    };
    const hits = (b: Box) => placedBoxes.some((o) =>
      b.x1 < o.x2 && b.x2 > o.x1 && b.y1 < o.y2 && b.y2 > o.y1);
    const reserveDot = (cx: number, cy: number, r = 10) => {
      placedBoxes.push({ x1: cx - r, y1: cy - r, x2: cx + r, y2: cy + r });
    };
    // ring labels are obstacles too (left-anchored on the vertical axis —
    // a crowded roster slid a ship name straight onto "2.5 km")
    for (const r of rings) {
      const t = kmLabel(r);
      placedBoxes.push({
        x1: C + 4, y1: C - px(r) - 13, x2: C + 4 + t.length * 6.4 + 8, y2: C - px(r) + 1,
      });
    }
    reserveDot(C, C);
    for (const pp of placed) {
      const at = posOf(pp.ship);
      reserveDot(at.x, at.y);
      if (pp.ship.holdRange !== undefined
        && Math.abs(pp.ship.holdRange - pp.ship.range) > 200) {
        const ap = anchorPointOf(pp.ship);
        const dx = at.x - ap.x;
        const dy = at.y - ap.y;
        const cur = Math.max(1e-6, Math.hypot(dx, dy));
        reserveDot(ap.x + (dx / cur) * px(pp.ship.holdRange),
          ap.y + (dy / cur) * px(pp.ship.holdRange), 7);
      }
    }
    const yFor = new Map<string, number>();
    /** place `text` centred on cx at the first free spot: the natural y,
     * then progressively further below, with above-the-dot candidates mixed
     * in (a candidate over a dot self-rejects — dots are obstacles) */
    const OFFSETS = [0, 13, 26, -33, 39, -46, 52, 65, -59, 78, 91, 104, 117, 130];
    const settle = (key: string, cx: number, y0: number, text: string): number => {
      let chosen = y0 + OFFSETS[OFFSETS.length - 1];
      let found = false;
      for (const off of OFFSETS) {
        const b = boxFor(cx, y0 + off, text);
        if (!hits(b)) { placedBoxes.push(b); chosen = y0 + off; found = true; break; }
      }
      // even a defeated label reserves its spot, so nothing else piles on
      if (!found) placedBoxes.push(boxFor(cx, chosen, text));
      yFor.set(key, chosen);
      return chosen;
    };
    return { yFor, settle };
  })();

  const shortName = (n: string) => (n.length > 18 ? `${n.slice(0, 17)}…` : n);

  return (
    <div className="tactical-map sim-card">
      <div className="fight-timeline-head">
        <span className="sim-card-title">Starting positions</span>
        <span className="dim">
          drag a dot on the LEFT map to place a ship (distance + direction);
          drag it on the RIGHT map to lift it above or below the plane; a
          hollow ring on its anchor line is the range it flies to and holds
        </span>
        <button type="button" className={`btn${lockedScale !== null ? ' on' : ''}`}
          style={{ marginLeft: 'auto' }}
          title={lockedScale !== null
            ? `scale locked at ${kmLabel(lockedScale)} — click to let the map fit the roster again`
            : 'lock the current scale — the map stops re-fitting to ship distances'}
          onClick={() => setLockedScale((v) => (v === null ? rMax : null))}>
          {lockedScale !== null ? '🔒' : '🔓'} scale
        </button>
      </div>
      <div className="tactical-views">
      <svg ref={svgRef} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
        aria-label="Tactical map: drag ships to set their range and azimuth to the reference"
        onPointerMove={(ev) => { if (dragging) dragTo(dragging, ev.clientX, ev.clientY); }}
        onPointerUp={() => { setDragging(null); frozenScale.current = null; }}
        onPointerLeave={() => { setDragging(null); frozenScale.current = null; }}>
        {rings.map((r) => (
          <g key={r}>
            <circle cx={C} cy={C} r={px(r)} fill="none" stroke="var(--grid)" strokeWidth="1" />
            <text x={C + 4} y={C - px(r) - 3} className="sim-tick">{kmLabel(r)}</text>
          </g>
        ))}

        {/* the REFERENCE ship, centre of everyone's world */}
        <g>
          <title>{`${target.name} — ${target.speed > 0 ? `${Math.round(target.speed)} m/s` : 'still'}`}</title>
          <circle cx={C} cy={C} r="10" fill={shipColour('b', 0).glow} opacity="0.18" />
          <circle cx={C} cy={C} r="7" fill={shipColour('b', 0).core} opacity="0.95" />
          {target.speed > 0 && arrow(C, C, Math.PI, target.angleDeg, shipColour('b', 0).core, 18)}
          {(() => { labelLayout.settle(target.id, C, C + 22, shortName(target.name)); return null; })()}
          <text x={C} y={labelLayout.yFor.get(target.id)} textAnchor="middle" className="sim-tick">
            {shortName(target.name)}
          </text>
        </g>

        {placed.map(({ ship: a, side, idx }) => {
          const { x, y, b } = posOf(a);
          const colour = shipColour(side, idx).core;
          const glow = shipColour(side, idx).glow;
          const anchorPt = anchorPointOf(a);
          const anchored = a.anchorId !== undefined && (anchorPt.x !== C || anchorPt.y !== C);
          const rangeText = `${anchored ? `${kmLabel(a.range)} · vs ally` : kmLabel(a.range)}${a.elevationDeg !== 0 ? ` · ${a.elevationDeg > 0 ? '▲' : '▼'}${Math.abs(a.elevationDeg)}°` : ''}`;
          const rangeY = labelLayout.settle(`${a.id}:r`,
            (anchorPt.x + x) / 2, (anchorPt.y + y) / 2 - 5, rangeText);
          const showHold = a.holdRange !== undefined && Math.abs(a.holdRange - a.range) > 200;
          let holdPt: { x: number; y: number; labelY: number } | null = null;
          if (showHold) {
            const hdx = x - anchorPt.x;
            const hdy = y - anchorPt.y;
            const hcur = Math.max(1e-6, Math.hypot(hdx, hdy));
            const hx = anchorPt.x + (hdx / hcur) * px(a.holdRange!);
            const hy = anchorPt.y + (hdy / hcur) * px(a.holdRange!);
            holdPt = {
              x: hx,
              y: hy,
              labelY: labelLayout.settle(`${a.id}:h`, hx, hy - 8, `hold ${kmLabel(a.holdRange!)}`),
            };
          }
          labelLayout.settle(a.id, x, y + 22, shortName(a.name));
          return (
            <g key={a.id} style={{ cursor: 'grab' }}
              onPointerDown={(ev) => {
                (ev.target as Element).setPointerCapture?.(ev.pointerId);
                frozenScale.current = rMax;
                setDragging(a.id);
              }}>
              <title>{`${a.name} — ${a.speed > 0 ? `${Math.round(a.speed)} m/s` : 'still'}${a.elevationDeg !== 0 ? `, ${a.elevationDeg > 0 ? '+' : ''}${a.elevationDeg}° elevation` : ''}${a.holdRange !== undefined ? `, holds ${kmLabel(a.holdRange)}` : ''}`}</title>
              {/* the range line IS the number that matters — labelled on it.
                  With a behaviour anchor it runs ship→anchor instead. */}
              <line x1={anchorPt.x} y1={anchorPt.y} x2={x} y2={y} stroke={colour}
                strokeWidth="1" strokeDasharray="4 4" opacity="0.55" />
              <text x={(anchorPt.x + x) / 2} y={rangeY} textAnchor="middle"
                className="sim-tick" style={{ fill: colour }}>
                {rangeText}
              </text>
              {/* where it is TRYING to get: hollow marker on the anchor line */}
              {holdPt && (
                <g>
                  <circle cx={holdPt.x} cy={holdPt.y} r="5" fill="none" stroke={colour} strokeWidth="1.6" strokeDasharray="2 2" />
                  <text x={holdPt.x} y={holdPt.labelY} textAnchor="middle" className="sim-tick" style={{ fill: colour }}>
                    hold {kmLabel(a.holdRange!)}
                  </text>
                </g>
              )}
              <circle cx={x} cy={y} r="11" fill={glow} opacity="0.15" />
              <circle cx={x} cy={y} r="8" fill={colour} opacity={dragging === a.id ? 1 : 0.9} />
              {a.speed > 0 && arrow(x, y, b, a.angleDeg, colour)}
              <text x={x} y={labelLayout.yFor.get(a.id)} textAnchor="middle" className="sim-tick">
                {shortName(a.name)}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="tactical-side-pane">
          <div className="fight-timeline-head">
            <span className="sim-card-title">Elevation</span>
            <span className="dim">
              each ship in its own vertical plane through the reference —
              left-right between DIFFERENT ships is not comparable here
            </span>
          </div>
          <svg ref={sideRef} viewBox={`0 0 ${SIZE} ${SIZE}`} role="img"
            aria-label="Side view: drag ships above or below the reference plane"
            onPointerMove={(ev) => { if (sideDragging) sideDragTo(sideDragging, ev.clientX, ev.clientY); }}
            onPointerUp={() => { setSideDragging(null); frozenScale.current = null; }}
            onPointerLeave={() => { setSideDragging(null); frozenScale.current = null; }}>
            {/* the plane, and the reference on it */}
            <line x1={PAD} y1={C} x2={SIZE - 8} y2={C}
              stroke="var(--grid)" strokeWidth="1" />
            <circle cx={PAD} cy={C} r="6" fill={shipColour('b', 0).core} opacity="0.95" />
            <text x={PAD + 12} y={C + 18} textAnchor="start" className="sim-tick">{shortName(target.name)}</text>
            {placed.map(({ ship: a, side, idx }) => {
              const elv = rad(a.elevationDeg);
              const rho = a.range * Math.cos(elv);
              const z = a.range * Math.sin(elv);
              const x = PAD + px(rho);
              const y = C - Math.sign(z) * px(Math.abs(z));
              const colour = shipColour(side, idx).core;
              return (
                <g key={a.id} style={{ cursor: 'grab' }}
                  onPointerDown={(ev) => {
                    (ev.target as Element).setPointerCapture?.(ev.pointerId);
                    frozenScale.current = rMax;
                    setSideDragging(a.id);
                  }}>
                  <line x1={PAD} y1={C} x2={x} y2={y} stroke={colour}
                    strokeWidth="1" strokeDasharray="4 4" opacity="0.4" />
                  <circle cx={x} cy={y} r="7" fill={colour} opacity={sideDragging === a.id ? 1 : 0.9} />
                  <text x={x} y={y - 10} textAnchor="middle" className="sim-tick" style={{ fill: colour }}>
                    {a.name.length > 16 ? `${a.name.slice(0, 15)}…` : a.name}
                    {a.elevationDeg !== 0 ? ` ${a.elevationDeg > 0 ? '▲' : '▼'}${Math.abs(a.elevationDeg)}°` : ''}
                  </text>
                </g>
              );
            })}
          </svg>
      </div>
      </div>
    </div>
  );
}
