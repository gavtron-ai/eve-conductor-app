// THE VIEW BUS (v0.206.0) — how a favorite (or a Home dashlet) hands a saved
// view to the tab that knows how to apply it. The tab may not be mounted yet
// when the click happens (App switches module first), so a request WAITS: the
// tab takes it when it mounts, or at once if it is already listening. One
// request per kind; a newer one replaces an older one nobody took.
import type { SavedView } from './favorites';

type Listener = (view: SavedView) => void;
const pending = new Map<string, SavedView>();
const listeners = new Map<string, Set<Listener>>();

/** ask the tab of this kind to show this view */
export function requestView(view: SavedView): void {
  const ls = listeners.get(view.kind);
  if (ls && ls.size > 0) { for (const l of ls) l(view); return; }
  pending.set(view.kind, view);
}

/** a tab listens for its kind; a request that was waiting is delivered at once. Returns the unsubscribe. */
export function onViewRequest(kind: string, listener: Listener): () => void {
  const ls = listeners.get(kind) ?? new Set<Listener>();
  ls.add(listener);
  listeners.set(kind, ls);
  const waiting = pending.get(kind);
  if (waiting) { pending.delete(kind); listener(waiting); }
  return () => { ls.delete(listener); };
}

/** for fixtures */
export function _resetViewBus(): void { pending.clear(); listeners.clear(); }
