// AM I ACTUALLY LOOKING AT THIS?
//
// Some data only matters while it is on screen. Re-scanning market prices for
// a Trade Finder nobody has touched in an hour spends the shared ESI budget
// on an answer no one reads — and that budget is the same one the overlay and
// a running fit push draw from.
//
// So: anything whose value is "the screen in front of me is current" goes
// idle after IDLE_MS of no input, and ANY interaction wakes it immediately.
// Anything whose value is "keep a permanent record" (the market radar, the
// trend watcher, the wallet ledger) is NOT gated on this — those exist
// precisely for the hours the user is away, and their history cannot be
// collected retroactively.
//
// The overlay is never gated either: it is on screen at all times by
// definition, and a multiboxer glancing at it has not "interacted" with the
// app in any way this file could see.

import { useEffect, useState } from 'react';

/** no input for this long = the user has walked away */
export const IDLE_MS = 10 * 60_000;

let lastActivity = Date.now();
const listeners = new Set<() => void>();

/** true when the user has not touched the app for `ms` */
export function isIdle(ms: number = IDLE_MS): boolean {
  return Date.now() - lastActivity > ms;
}

export function msSinceActivity(): number {
  return Date.now() - lastActivity;
}

/** Called by the real input listeners, and available for anything that counts
 * as deliberate use (opening a module, starting a scan). */
export function noteActivity(): void {
  const wasIdle = isIdle();
  lastActivity = Date.now();
  // only wake subscribers on the IDLE → ACTIVE edge; every mousemove would
  // otherwise re-render the whole app
  if (wasIdle) for (const fn of listeners) fn();
}

let wired = false;
/** Install the input listeners once, from the app shell. */
export function initActivity(): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;
  // pointerdown/keydown/wheel = deliberate use. Deliberately NOT mousemove:
  // a cursor parked over the window by a multiboxer is not interaction.
  for (const ev of ['pointerdown', 'keydown', 'wheel'] as const) {
    window.addEventListener(ev, noteActivity, { passive: true });
  }
  // coming back to the window is itself a wake
  window.addEventListener('focus', noteActivity);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) noteActivity();
  });
}

/** React hook: re-renders when the user comes back after being idle. */
export function useIsIdle(ms: number = IDLE_MS): boolean {
  const [idle, setIdle] = useState(() => isIdle(ms));
  useEffect(() => {
    const check = () => setIdle(isIdle(ms));
    const t = setInterval(check, 15_000);
    listeners.add(check);
    return () => {
      clearInterval(t);
      listeners.delete(check);
    };
  }, [ms]);
  return idle;
}
