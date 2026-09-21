// FAVORITES (v0.206.0) — the tabs a player actually lives in, one click away,
// each optionally carrying a SAVED VIEW ("Gneiss in the C3 branch"). PURE: no
// store, no DOM — fixtures pin it; the store holds the list and App draws it.
//
// A destination is a module plus one of its tabs. The catalogue below is the
// single list of them; App navigates from it, so a tab added to a module is
// favoritable the moment it is listed here.

export type FavModule = 'home' | 'trade' | 'character' | 'battle' | 'theft' | 'pi' | 'aperture';

export interface Destination {
  /** "module:tab" */
  id: string;
  module: FavModule;
  tab: string;
  /** the tab's name as its button reads */
  label: string;
  /** the module it lives in, for the tooltip and the picker */
  moduleLabel: string;
  icon: string;
}

export const DESTINATIONS: Destination[] = [
  { id: 'home:dashboard', module: 'home', tab: 'dashboard', label: 'Home', moduleLabel: 'Home', icon: '🏠' },
  { id: 'aperture:map', module: 'aperture', tab: 'map', label: 'Corp Map', moduleLabel: 'Aperture', icon: '🗺' },
  { id: 'aperture:summary', module: 'aperture', tab: 'summary', label: 'Σ Summary', moduleLabel: 'Aperture', icon: 'Σ' },
  { id: 'theft:skyhooks', module: 'theft', tab: 'skyhooks', label: 'Skyhooks', moduleLabel: 'Theft Conductor', icon: '🪝' },
  { id: 'theft:ess', module: 'theft', tab: 'ess', label: 'ESS', moduleLabel: 'Theft Conductor', icon: '🏦' },
  { id: 'battle:reports', module: 'battle', tab: 'reports', label: 'Battle Reports', moduleLabel: 'Battle Conductor', icon: '⚔' },
  { id: 'battle:live', module: 'battle', tab: 'live', label: 'Log Visualizer', moduleLabel: 'Battle Conductor', icon: '📈' },
  { id: 'battle:sim', module: 'battle', tab: 'sim', label: 'Battle Sim', moduleLabel: 'Battle Conductor', icon: '🎯' },
  { id: 'battle:board', module: 'battle', tab: 'board', label: 'Leaderboard', moduleLabel: 'Battle Conductor', icon: '🏆' },
  { id: 'pi:planets', module: 'pi', tab: 'planets', label: 'Planets', moduleLabel: 'Planetary Industry', icon: '🪐' },
  { id: 'character:match', module: 'character', tab: 'match', label: 'Skill Match', moduleLabel: 'Skill & Fit Conductor', icon: '🧠' },
  { id: 'character:fit', module: 'character', tab: 'fit', label: 'Fit Skill Maxer', moduleLabel: 'Skill & Fit Conductor', icon: '🛠' },
  { id: 'character:wizard', module: 'character', tab: 'wizard', label: 'Fit Wizard', moduleLabel: 'Skill & Fit Conductor', icon: '🪄' },
  { id: 'character:propagator', module: 'character', tab: 'propagator', label: 'Fit Propagator', moduleLabel: 'Skill & Fit Conductor', icon: '📤' },
  { id: 'trade:finder', module: 'trade', tab: 'finder', label: 'Trade Finder', moduleLabel: 'Trade Conductor', icon: '🔎' },
  { id: 'trade:autohaul', module: 'trade', tab: 'autohaul', label: 'Auto Haul', moduleLabel: 'Trade Conductor', icon: '🚚' },
  { id: 'trade:orders', module: 'trade', tab: 'orders', label: 'My Orders', moduleLabel: 'Trade Conductor', icon: '📋' },
  { id: 'trade:trends', module: 'trade', tab: 'trends', label: 'Trends', moduleLabel: 'Trade Conductor', icon: '📉' },
  { id: 'trade:radar', module: 'trade', tab: 'radar', label: 'Radar', moduleLabel: 'Trade Conductor', icon: '📡' },
  { id: 'trade:dashboard', module: 'trade', tab: 'dashboard', label: 'Dashboard', moduleLabel: 'Trade Conductor', icon: '💰' },
  { id: 'trade:explorer', module: 'trade', tab: 'explorer', label: 'Item Explorer', moduleLabel: 'Trade Conductor', icon: '📦' },
  { id: 'trade:groups', module: 'trade', tab: 'groups', label: 'Groups', moduleLabel: 'Trade Conductor', icon: '🗂' },
];

export const destOf = (id: string): Destination | undefined => DESTINATIONS.find((d) => d.id === id);
export const destId = (module: string, tab: string): string => `${module}:${tab}`;

/** a saved view rides with a favorite; `kind` names the tab that knows how to apply it */
export interface SavedView { kind: string; state: unknown; summary: string }

export interface Favorite {
  /** unique within the list — two favorites may point at one tab with different views */
  id: string;
  dest: string;
  /** the player's own name for it; empty = the tab's label (plus the view's summary) */
  name: string;
  view?: SavedView;
}

export interface FavoritesState {
  list: Favorite[];
  /** open the first favorite when the app starts */
  openFirstOnLaunch: boolean;
}
export const EMPTY_FAVORITES: FavoritesState = { list: [], openFirstOnLaunch: false };
export const MAX_FAVORITES = 12;
export const MAX_NAME = 28;

/** what the chip says */
export function favLabel(f: Favorite): string {
  const d = destOf(f.dest);
  if (f.name.trim()) return f.name.trim();
  return f.view ? `${d?.label ?? f.dest} · ${f.view.summary}` : (d?.label ?? f.dest);
}

const newId = (list: readonly Favorite[], dest: string): string => {
  let n = 1;
  while (list.some((f) => f.id === `${dest}#${n}`)) n++;
  return `${dest}#${n}`;
};

/** is this tab pinned PLAIN (without a saved view)? — what the ☆ in the header toggles */
export const isPinned = (s: FavoritesState, dest: string): boolean => s.list.some((f) => f.dest === dest && !f.view);

/** add a favorite (a plain tab is never pinned twice; saved views may repeat a tab). Full list → unchanged. */
export function addFavorite(s: FavoritesState, dest: string, view?: SavedView, name = ''): FavoritesState {
  if (!destOf(dest) || s.list.length >= MAX_FAVORITES) return s;
  if (!view && isPinned(s, dest)) return s;
  const fav: Favorite = { id: newId(s.list, dest), dest, name: name.trim().slice(0, MAX_NAME), ...(view ? { view } : {}) };
  return { ...s, list: [...s.list, fav] };
}

export const removeFavorite = (s: FavoritesState, id: string): FavoritesState => ({ ...s, list: s.list.filter((f) => f.id !== id) });

/** the ☆ in the header: pin the plain tab, or unpin it */
export function togglePinned(s: FavoritesState, dest: string): FavoritesState {
  const plain = s.list.find((f) => f.dest === dest && !f.view);
  return plain ? removeFavorite(s, plain.id) : addFavorite(s, dest);
}

export function renameFavorite(s: FavoritesState, id: string, name: string): FavoritesState {
  return { ...s, list: s.list.map((f) => (f.id === id ? { ...f, name: name.trim().slice(0, MAX_NAME) } : f)) };
}

/** drag a chip: move `id` to where `beforeId` sits (null = the end) */
export function moveFavorite(s: FavoritesState, id: string, beforeId: string | null): FavoritesState {
  const from = s.list.findIndex((f) => f.id === id);
  if (from < 0 || id === beforeId) return s;
  const rest = s.list.filter((f) => f.id !== id);
  const at = beforeId === null ? rest.length : rest.findIndex((f) => f.id === beforeId);
  if (at < 0) return s;
  return { ...s, list: [...rest.slice(0, at), s.list[from], ...rest.slice(at)] };
}

/** whatever was stored → a valid state: unknown tabs dropped, ids made unique, the cap held */
export function sanitizeFavorites(raw: unknown): FavoritesState {
  const r = (raw ?? {}) as Partial<FavoritesState>;
  const out: Favorite[] = [];
  for (const f of Array.isArray(r.list) ? r.list : []) {
    if (!f || typeof f !== 'object' || typeof f.dest !== 'string' || !destOf(f.dest)) continue;
    const view = f.view && typeof f.view === 'object' && typeof f.view.kind === 'string' ? { kind: f.view.kind, state: f.view.state, summary: String(f.view.summary ?? '') } : undefined;
    if (!view && out.some((x) => x.dest === f.dest && !x.view)) continue;
    const id = typeof f.id === 'string' && f.id && !out.some((x) => x.id === f.id) ? f.id : newId(out, f.dest);
    out.push({ id, dest: f.dest, name: typeof f.name === 'string' ? f.name.slice(0, MAX_NAME) : '', ...(view ? { view } : {}) });
    if (out.length >= MAX_FAVORITES) break;
  }
  return { list: out, openFirstOnLaunch: r.openFirstOnLaunch === true };
}
