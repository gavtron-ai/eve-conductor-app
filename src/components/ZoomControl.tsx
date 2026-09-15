// ZOOM BUTTONS (v0.200.8) — "− 100% +" for one screen. The percentage is
// a button too: it resets to 100 %. Lives in the header of every window
// that shows a screen; the level itself is applied by the screen's root
// (see lib/zoom.ts).
import { useZoom, zoomLabel } from '../lib/zoom';

export default function ZoomControl({ screen, keys = true, compact = false }: { screen: string; keys?: boolean; compact?: boolean }) {
  const z = useZoom(screen, keys);
  const off = Math.abs(z.zoom - 1) > 1e-9;
  return (
    <span className={`zoom-ctl${compact ? ' compact' : ''}`} role="group" aria-label="zoom for this screen"
      title="Zoom this screen. Every screen remembers its own level. Ctrl + / Ctrl − / Ctrl 0 do the same.">
      <button className="btn icon" onClick={z.out} disabled={!z.canOut} aria-label="zoom out" title="Zoom out (Ctrl −)">−</button>
      <button className={`zoom-pct${off ? ' on' : ''}`} onClick={z.reset} disabled={!off} aria-label="reset zoom"
        title={off ? 'Back to 100% (Ctrl 0)' : '100% — this screen is at its normal size'}>{zoomLabel(z.zoom)}</button>
      <button className="btn icon" onClick={z.in} disabled={!z.canIn} aria-label="zoom in" title="Zoom in (Ctrl +)">+</button>
    </span>
  );
}
