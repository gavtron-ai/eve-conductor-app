// PER-SCREEN ZOOM (v0.200.8) — every screen (each module of the main
// window, the chain summary, the overlay setup window) has its own zoom
// level, remembered across restarts and shared by every window that shows
// that screen (a popped-out module follows the module's level).
//
// HOW IT SCALES: CSS `zoom` on the screen's content root. Unlike
// transform: scale(), zoom takes part in layout — text, SVG, images and
// controls all grow together and the page REFLOWS to the same viewport
// (lines wrap, grids collapse, scrollbars appear), which is what keeps a
// zoomed screen readable instead of merely bigger. The one screen that
// hosts another page (Aperture's map) zooms the guest page itself.
//
// STORAGE: one JSON map under its own localStorage key, deliberately NOT
// the zustand settings store — the chain and setup windows must never
// instantiate a second copy of that store (the setup-window lesson). The
// browser's `storage` event carries a change to every other window; a
// same-window custom event covers the window that made it.
import { useCallback, useEffect, useState } from 'react';

export type ZoomScreen = 'home' | 'trade' | 'character' | 'battle' | 'theft' | 'pi' | 'aperture' | 'chain-summary' | 'clone-config';

/** the levels a click steps through — 100 % sits in the middle, the ends
 * are as far as the UI stays usable on a laptop and a 4K panel */
export const ZOOM_STEPS: readonly number[] = [0.7, 0.8, 0.9, 1, 1.1, 1.25, 1.4, 1.6, 1.8, 2];
export const ZOOM_MIN = ZOOM_STEPS[0];
export const ZOOM_MAX = ZOOM_STEPS[ZOOM_STEPS.length - 1];
export const ZOOM_KEY = 'etc-zoom';
const EVENT = 'etc-zoom';

/** clamp to the usable range, 3 decimals, 1 for anything that is not a number */
export function clampZoom(z: unknown): number {
  const n = typeof z === 'number' ? z : typeof z === 'string' ? Number(z) : NaN;
  if (!Number.isFinite(n)) return 1;
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, n)) * 1000) / 1000;
}

/** the next step up or down from `z` — from a level between steps, the
 * nearest step in that direction */
export function stepZoom(z: number, dir: 1 | -1): number {
  const cur = clampZoom(z);
  if (dir > 0) return ZOOM_STEPS.find((s) => s > cur + 1e-9) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((s) => s < cur - 1e-9) ?? ZOOM_MIN;
}

/** the stored map, tolerant of garbage: unknown shapes → {}, bad values dropped */
export function parseZooms(raw: string | null | undefined): Record<string, number> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    const out: Record<string, number> = {};
    for (const [k, z] of Object.entries(v as Record<string, unknown>)) {
      if (typeof z !== 'number' || !Number.isFinite(z)) continue;
      out[k] = clampZoom(z);
    }
    return out;
  } catch {
    return {};
  }
}

export const zoomLabel = (z: number): string => `${Math.round(z * 100)}%`;

function readAll(): Record<string, number> {
  try { return parseZooms(localStorage.getItem(ZOOM_KEY)); } catch { return {}; }
}

export function zoomOf(screen: string): number {
  return readAll()[screen] ?? 1;
}

export function setZoom(screen: string, z: number): number {
  const next = clampZoom(z);
  const all = readAll();
  if (next === 1) delete all[screen]; else all[screen] = next;
  try { localStorage.setItem(ZOOM_KEY, JSON.stringify(all)); } catch { /* storage unavailable: the level still applies for this session */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: { screen, zoom: next } }));
  return next;
}

export interface ZoomApi {
  zoom: number;
  in: () => void;
  out: () => void;
  reset: () => void;
  set: (z: number) => void;
  canIn: boolean;
  canOut: boolean;
}

/** the screen's zoom, live across windows, with the actions the buttons
 * and keys call. Optional `keys` installs Ctrl/⌘ + / − / 0 for this screen
 * while the component is mounted. */
export function useZoom(screen: string, keys = false): ZoomApi {
  const [zoom, setLocal] = useState<number>(() => zoomOf(screen));
  useEffect(() => {
    setLocal(zoomOf(screen));
    const onStorage = (e: StorageEvent) => { if (e.key === ZOOM_KEY || e.key === null) setLocal(zoomOf(screen)); };
    const onLocal = (e: Event) => { const d = (e as CustomEvent<{ screen: string; zoom: number }>).detail; if (d?.screen === screen) setLocal(d.zoom); };
    window.addEventListener('storage', onStorage);
    window.addEventListener(EVENT, onLocal);
    return () => { window.removeEventListener('storage', onStorage); window.removeEventListener(EVENT, onLocal); };
  }, [screen]);
  const set = useCallback((z: number) => { setLocal(setZoom(screen, z)); }, [screen]);
  const zin = useCallback(() => set(stepZoom(zoomOf(screen), 1)), [screen, set]);
  const zout = useCallback(() => set(stepZoom(zoomOf(screen), -1)), [screen, set]);
  const reset = useCallback(() => set(1), [set]);
  useEffect(() => {
    if (!keys) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      // "=" is the unshifted "+" on most layouts; numpad keys come as their symbols
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') { e.preventDefault(); zin(); }
      else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') { e.preventDefault(); zout(); }
      else if (e.key === '0' || e.code === 'Numpad0') { e.preventDefault(); reset(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, zin, zout, reset]);
  return { zoom, in: zin, out: zout, reset, set, canIn: zoom < ZOOM_MAX - 1e-9, canOut: zoom > ZOOM_MIN + 1e-9 };
}
