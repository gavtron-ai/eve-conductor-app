// WHICH WAY IS THIS SHIP POINTED, and how fast.
//
// A dropdown with four presets is not movement — a ship flies in any direction
// it likes, and the direction is the whole game against turrets. This is the
// control for that: drag around the ring to set a heading relative to the line
// running to the other ship, and the transversal falls out of it.
//
//   right (0°)  = straight AT the other ship — all speed radial, no transversal
//   up   (90°)  = across, one way — a perfect orbit, all speed tangential
//   left (180°) = straight away
//   down (270°) = across, the other way
//
// Two ships pointed the same way around cancel their transversal; opposed,
// they add. That used to be my worst-case assumption and is now the player's
// choice, which is the difference between a simulator and a guess.
import { useEffect, useRef } from 'react';

const R = 34, CX = 44, CY = 44;

/** where the pointer is, as an angle in the same convention as the model:
 * 0 = right = toward the target, 90 = up, measured anticlockwise */
function angleFromPointer(ev: { clientX: number; clientY: number }, el: SVGSVGElement): number {
  const box = el.getBoundingClientRect();
  const x = ((ev.clientX - box.left) / box.width) * (CX * 2) - CX;
  // SVG y grows downward; negate so "up" is a positive angle
  const y = -(((ev.clientY - box.top) / box.height) * (CY * 2) - CY);
  const deg = (Math.atan2(y, x) * 180) / Math.PI;
  return Math.round((deg + 360) % 360);
}

export default function HeadingDial({ angleDeg, speed, maxSpeed, onChange, label }: {
  angleDeg: number;
  /** the speed actually being flown, m/s */
  speed: number;
  maxSpeed: number;
  onChange: (patch: { angleDeg?: number; speed?: number }) => void;
  label: string;
}) {
  const ref = useRef<SVGSVGElement | null>(null);
  const dragging = useRef(false);
  // the handler is re-created on every render, but the window listener is
  // attached once — a ref keeps the listener calling the CURRENT one
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const maxRef = useRef(maxSpeed);
  maxRef.current = maxSpeed;

  const frac = maxSpeed > 0 ? Math.max(0, Math.min(1, speed / maxSpeed)) : 0;
  const rad = (angleDeg * Math.PI) / 180;
  // DEAD CENTRE AT ZERO. The arrow used to keep a 25% stub at a standstill,
  // which read as "still moving a bit" — it is now exactly proportional.
  const len = R * frac;
  const tipX = CX + Math.cos(rad) * len;
  const tipY = CY - Math.sin(rad) * len;

  /**
   * A DRAG THAT LEAVES THE CIRCLE IS STILL A DRAG. Tracking on the element
   * alone meant the angle stopped following the moment the pointer crossed the
   * ring — which is most of the time, because the natural motion is a wide
   * sweep. The listeners live on the window until the button comes up.
   */
  useEffect(() => {
    const move = (ev: MouseEvent) => {
      if (!dragging.current || !ref.current) return;
      ev.preventDefault();
      onChangeRef.current({ angleDeg: angleFromPointer(ev, ref.current) });
    };
    const up = () => { dragging.current = false; };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);

    /**
     * SPEED ON THE SCROLL WHEEL, and it must NOT nudge the heading — the two
     * are separate decisions. Attached natively with passive:false because
     * React registers wheel handlers as PASSIVE, where preventDefault is a
     * silent no-op and the page scrolls out from under the dial instead.
     */
    const el = ref.current;
    const wheel = (ev: WheelEvent) => {
      const max = maxRef.current;
      if (max <= 0) return;
      ev.preventDefault();
      const stepSize = Math.max(1, Math.round(max / 40));
      const next = speedRef.current + (ev.deltaY < 0 ? stepSize : -stepSize);
      onChangeRef.current({ speed: Math.max(0, Math.min(max, Math.round(next))) });
    };
    el?.addEventListener('wheel', wheel, { passive: false });

    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      el?.removeEventListener('wheel', wheel);
    };
  }, []);

  return (
    <div className="heading">
      <svg ref={ref} viewBox={`0 0 ${CX * 2} ${CY * 2}`} className="heading-dial"
        role="img" aria-label={`${label} heading ${angleDeg}°`}
        onMouseDown={(e) => {
          dragging.current = true;
          if (ref.current) onChange({ angleDeg: angleFromPointer(e, ref.current) });
        }}
>
        <circle cx={CX} cy={CY} r={R} fill="var(--surface-2)" stroke="var(--border)" />
        {/* the line to the other ship — 0° points at it */}
        <line x1={CX} y1={CY} x2={CX + R} y2={CY}
          stroke="var(--muted)" strokeWidth="1" strokeDasharray="2 2" />
        <circle cx={CX + R} cy={CY} r="3" fill="var(--muted)" />
        {/* the four quarter marks: pure radial vs pure tangential */}
        {[0, 90, 180, 270].map((d) => {
          const a = (d * Math.PI) / 180;
          return (
            <line key={d} x1={CX + Math.cos(a) * (R - 4)} y1={CY - Math.sin(a) * (R - 4)}
              x2={CX + Math.cos(a) * R} y2={CY - Math.sin(a) * R}
              stroke="var(--baseline)" strokeWidth="1" />
          );
        })}
        <line x1={CX} y1={CY} x2={tipX} y2={tipY} stroke="var(--accent)" strokeWidth="2.5" />
        <circle cx={tipX} cy={tipY} r="4" fill="var(--accent)" />
        <circle cx={CX} cy={CY} r="2" fill="var(--ink-2)" />
      </svg>

      <div className="heading-fields">
        <label>
          <span className="dim">heading</span>
          <input type="number" min={0} max={359} value={angleDeg}
            onChange={(e) => onChange({ angleDeg: ((Number(e.target.value) % 360) + 360) % 360 })} />°
        </label>
        <label>
          <span className="dim">speed</span>
          <input type="number" min={0} max={Math.round(maxSpeed)} value={Math.round(speed)}
            onChange={(e) => onChange({ speed: Math.max(0, Math.min(maxSpeed, Number(e.target.value))) })} />
          m/s
        </label>
        <input className="heading-slider" type="range" min={0} max={Math.max(1, Math.round(maxSpeed))}
          value={Math.round(Math.min(speed, maxSpeed))}
          onChange={(e) => onChange({ speed: Number(e.target.value) })} />
        <span className="dim">
          max {Math.round(maxSpeed)} m/s · {Math.round(Math.abs(Math.sin(rad)) * speed)} across,{' '}
          {Math.round(Math.cos(rad) * speed)} toward
        </span>
      </div>
    </div>
  );
}
