// FLUID WIDTH, MEASURED THREE WAYS — the one hook every drawn-to-width
// surface must use (v0.182, after the PI horizon bug).
//
// MEASURED (rig, 2026-08-31): ResizeObserver can deliver NOTHING — not
// even the initial callback the spec mandates — when Chromium throttles
// the rendering pipeline. Code that trusted it alone froze at its first
// guess (the PI horizon at its 420px floor; HistoryChart would have sat on
// its 800px default). So the observer is only ONE of three paths:
//
//   1. ResizeObserver, when the pipeline lets it live
//   2. a window `resize` listener — the actual "user expands the app"
//      gesture, delivered even where the observer is not
//   3. a re-measure after every render — setState with an unchanged
//      width is a React no-op, so this costs one clientWidth read
//
// Rule for future modules: ResizeObserver is an optimization, never the
// sole width source.
import { useCallback, useEffect, useRef, useState } from 'react';

export function useElementWidth(
  /** never report less than this (keeps chart math sane) */
  minPx: number,
  /** width to assume until the first successful measure */
  initial: number,
): [(el: HTMLElement | null) => void, number] {
  const [w, setW] = useState(initial);
  const elRef = useRef<HTMLElement | null>(null);
  const roRef = useRef<ResizeObserver | null>(null);
  const measure = useCallback(() => {
    const el = elRef.current;
    if (el && el.clientWidth > 0) setW(Math.max(minPx, Math.round(el.clientWidth)));
  }, [minPx]);
  const attach = useCallback((el: HTMLElement | null) => {
    elRef.current = el;
    roRef.current?.disconnect();
    roRef.current = null;
    if (el) {
      measure();
      requestAnimationFrame(measure); // commit-time layout can be stale
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      roRef.current = ro;
    }
  }, [measure]);
  useEffect(() => {
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      roRef.current?.disconnect();
    };
  }, [measure]);
  useEffect(measure); // after every render — the belt to the braces above
  return [attach, w];
}
