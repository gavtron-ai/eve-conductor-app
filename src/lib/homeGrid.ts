// HOME GRID (v0.207.0) — the placement rules of the Home dashboard. PURE.
//
// The owner's brief: "the primary placement tool accompanied with resizeable versions similar to
// apple or google widgets on the phone where there are a couple versions and the grid is a
// specific size." So: a grid of GRID_COLS square cells; a dashlet is one of four fixed sizes; a
// board is a list of placed dashlets. Moving one takes the cell it is dropped on and pushes what
// was there down; everything then floats up as far as it can (no orphan holes, the way a phone's
// home screen closes up) — the same result whatever order the moves were made in.

export type DashSize = 'S' | 'M' | 'L' | 'XL';
export const SIZE_CELLS: Record<DashSize, { w: number; h: number }> = {
  S: { w: 1, h: 1 }, M: { w: 2, h: 1 }, L: { w: 2, h: 2 }, XL: { w: 4, h: 2 },
};
export const SIZE_ORDER: DashSize[] = ['S', 'M', 'L', 'XL'];
export const SIZE_LABEL: Record<DashSize, string> = { S: 'small', M: 'medium', L: 'large', XL: 'wide' };
export const GRID_COLS = 8;
/** how many cells across a board may be (v0.211.0): the grid always fills the window's width, so
 * this is the player's choice of DENSITY — 6 roomy, 8 the default, 10 or 12 for a wide monitor */
export const COLS_CHOICES = [6, 8, 10, 12];
export const colsOf = (b: { cols?: number } | undefined): number => (b && COLS_CHOICES.includes(b.cols ?? -1) ? b.cols! : GRID_COLS);
// WHY THERE IS A LIMIT AT ALL (evaluated v0.211.0, the owner: "the dashlet limit seems a little low,
// evaluate why we are limiting"). MEASURED in the rig, dev build, real data behind every dashlet:
// 24 → 96 dashlets mount in 87 → 151 ms, and 96 of them cost ~0.7 % of the main thread in steady
// state — so it is NOT performance (and a dashlet spends no ESI: they all read shared, already-held
// data; hidden boards are not mounted at all). The two real reasons: a board is a GLANCE — past a
// few screens of scrolling it has become a report, and another board serves better — and a hard cap
// keeps a corrupt or hand-edited settings blob from mounting ten thousand panels. 60 is one of
// everything in the store with room for doubles (a Gneiss finder next to a Kernite finder); it was
// 24, which a single starter board plus a few additions already hit.
export const MAX_BOARDS = 8;
export const MAX_ITEMS = 60;
export const MAX_BOARD_NAME = 20;

export interface DashItem {
  id: string;
  /** the dashlet's catalogue id */
  kind: string;
  size: DashSize;
  x: number;
  y: number;
  /** the dashlet's own options (which rock, which range…) */
  cfg?: Record<string, string>;
}
export interface Board { id: string; name: string; items: DashItem[]; /** cells across; absent = 8 */ cols?: number }
export interface HomeState { boards: Board[]; active: string }

export const EMPTY_HOME: HomeState = { boards: [{ id: 'b1', name: 'Home', items: [] }], active: 'b1' };

const rect = (i: Pick<DashItem, 'x' | 'y' | 'size'>) => ({ x: i.x, y: i.y, ...SIZE_CELLS[i.size] });
export const overlaps = (a: Pick<DashItem, 'x' | 'y' | 'size'>, b: Pick<DashItem, 'x' | 'y' | 'size'>): boolean => {
  const p = rect(a), q = rect(b);
  return p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
};
export const rowsUsed = (items: readonly DashItem[]): number => items.reduce((m, i) => Math.max(m, i.y + SIZE_CELLS[i.size].h), 0);
const clampX = (x: number, size: DashSize, cols = GRID_COLS) => Math.max(0, Math.min(cols - SIZE_CELLS[size].w, Math.round(x)));

/** settle a board: in reading order (the `first` item wins a tie), push each item down until it
 * is clear of those already settled, then let it float up as far as it can */
export function compact(items: readonly DashItem[], first: string | null = null, cols = GRID_COLS): DashItem[] {
  const order = items.map((i) => ({ ...i, x: clampX(i.x, i.size, cols), y: Math.max(0, Math.round(i.y)) }))
    .sort((a, b) => a.y - b.y || (a.id === first ? -1 : b.id === first ? 1 : 0) || a.x - b.x || (a.id < b.id ? -1 : 1));
  const done: DashItem[] = [];
  for (const it of order) {
    const hit = () => done.some((d) => overlaps(d, it));
    while (hit()) it.y++;
    while (it.y > 0) { it.y--; if (hit()) { it.y++; break; } }
    done.push(it);
  }
  // keep the caller's order (it is the order dashlets were added in)
  return items.map((i) => done.find((d) => d.id === i.id)!);
}

/** drop a dashlet with its top-left corner on cell (x, y) */
export function moveItem(items: readonly DashItem[], id: string, x: number, y: number, cols = GRID_COLS): DashItem[] {
  if (!items.some((i) => i.id === id)) return [...items];
  return compact(items.map((i) => (i.id === id ? { ...i, x: clampX(x, i.size, cols), y: Math.max(0, Math.round(y)) } : i)), id, cols);
}

/** another version of the same dashlet; it keeps its corner where the grid allows */
export function resizeItem(items: readonly DashItem[], id: string, size: DashSize, cols = GRID_COLS): DashItem[] {
  if (!items.some((i) => i.id === id)) return [...items];
  return compact(items.map((i) => (i.id === id ? { ...i, size, x: clampX(i.x, size, cols) } : i)), id, cols);
}

/** the first free spot in reading order that holds a w × h dashlet */
export function firstFree(items: readonly DashItem[], size: DashSize, cols = GRID_COLS): { x: number; y: number } {
  const { w } = SIZE_CELLS[size];
  for (let y = 0; y <= rowsUsed(items); y++) {
    for (let x = 0; x + w <= cols; x++) {
      if (!items.some((i) => overlaps(i, { x, y, size }))) return { x, y };
    }
  }
  return { x: 0, y: rowsUsed(items) };
}

const nextId = (taken: readonly string[], prefix: string): string => { let n = 1; while (taken.includes(`${prefix}${n}`)) n++; return `${prefix}${n}`; };

export function addItem(items: readonly DashItem[], kind: string, size: DashSize, cfg?: Record<string, string>, cols = GRID_COLS): DashItem[] {
  if (items.length >= MAX_ITEMS) return [...items];
  const at = firstFree(items, size, cols);
  const it: DashItem = { id: nextId(items.map((i) => i.id), 'd'), kind, size, ...at, ...(cfg && Object.keys(cfg).length > 0 ? { cfg } : {}) };
  return compact([...items, it], null, cols);
}
export const removeItem = (items: readonly DashItem[], id: string, cols = GRID_COLS): DashItem[] => compact(items.filter((i) => i.id !== id), null, cols);
export const configureItem = (items: readonly DashItem[], id: string, cfg: Record<string, string>): DashItem[] =>
  items.map((i) => (i.id === id ? { ...i, cfg: { ...(i.cfg ?? {}), ...cfg } } : i));

// ---- boards
export const activeBoard = (s: HomeState): Board => s.boards.find((b) => b.id === s.active) ?? s.boards[0];
export const withItems = (s: HomeState, boardId: string, items: DashItem[]): HomeState =>
  ({ ...s, boards: s.boards.map((b) => (b.id === boardId ? { ...b, items } : b)) });
const cleanName = (n: string) => n.replace(/\s+/g, ' ').trim().slice(0, MAX_BOARD_NAME);
export function addBoard(s: HomeState, name: string): HomeState {
  if (s.boards.length >= MAX_BOARDS) return s;
  const id = nextId(s.boards.map((b) => b.id), 'b');
  return { boards: [...s.boards, { id, name: cleanName(name) || `Board ${s.boards.length + 1}`, items: [] }], active: id };
}
export const renameBoard = (s: HomeState, id: string, name: string): HomeState =>
  (cleanName(name) ? { ...s, boards: s.boards.map((b) => (b.id === id ? { ...b, name: cleanName(name) } : b)) } : s);
/** PACK A BOARD AGAIN for its width: every dashlet, in the reading order it has now, into the first
 * free spot — what a player wants after changing the columns (settling only ever moves things UP,
 * so a board laid out 8 across would otherwise leave the new columns empty) */
export function repack(items: readonly DashItem[], cols = GRID_COLS): DashItem[] {
  const order = [...items].sort((a, b) => a.y - b.y || a.x - b.x || (a.id < b.id ? -1 : 1));
  const placed: DashItem[] = [];
  for (const it of order) placed.push({ ...it, ...firstFree(placed, it.size, cols) });
  return items.map((i) => placed.find((p) => p.id === i.id)!);
}
/** a board's density: its dashlets keep their places where the new width allows, and settle where it does not */
export const setBoardCols = (s: HomeState, id: string, cols: number): HomeState =>
  (COLS_CHOICES.includes(cols) ? { ...s, boards: s.boards.map((b) => (b.id === id ? { ...b, cols, items: compact(b.items, null, cols) } : b)) } : s);
/** the last board cannot be removed — it is emptied instead */
export function removeBoard(s: HomeState, id: string): HomeState {
  if (!s.boards.some((b) => b.id === id)) return s;
  if (s.boards.length === 1) return withItems(s, id, []);
  const boards = s.boards.filter((b) => b.id !== id);
  return { boards, active: s.active === id ? boards[0].id : s.active };
}

/** what comes back from disk: unknown dashlets, sizes a dashlet does not come in, junk and
 * overlaps all fall away; there is always at least one board */
export function sanitizeHome(raw: unknown, sizesOf: (kind: string) => readonly DashSize[] | null): HomeState {
  const r = (raw ?? {}) as { boards?: unknown; active?: unknown };
  const boards: Board[] = [];
  for (const b of Array.isArray(r.boards) ? r.boards : []) {
    if (!b || typeof b !== 'object' || boards.length >= MAX_BOARDS) continue;
    const o = b as { id?: unknown; name?: unknown; items?: unknown; cols?: unknown };
    const cols = colsOf({ cols: typeof o.cols === 'number' ? o.cols : undefined });
    const id = typeof o.id === 'string' && o.id && !boards.some((x) => x.id === o.id) ? o.id : nextId(boards.map((x) => x.id), 'b');
    const items: DashItem[] = [];
    for (const it of Array.isArray(o.items) ? o.items : []) {
      if (!it || typeof it !== 'object' || items.length >= MAX_ITEMS) continue;
      const i = it as Partial<DashItem>;
      const sizes = typeof i.kind === 'string' ? sizesOf(i.kind) : null;
      if (!sizes || sizes.length === 0) continue;
      const size = sizes.includes(i.size as DashSize) ? (i.size as DashSize) : sizes[0];
      const cfg: Record<string, string> = {};
      if (i.cfg && typeof i.cfg === 'object') for (const [k, v] of Object.entries(i.cfg)) if (typeof v === 'string') cfg[k] = v;
      items.push({
        id: typeof i.id === 'string' && i.id && !items.some((x) => x.id === i.id) ? i.id : nextId(items.map((x) => x.id), 'd'),
        kind: i.kind as string, size,
        x: Number.isFinite(i.x) ? (i.x as number) : 0, y: Number.isFinite(i.y) ? (i.y as number) : 0,
        ...(Object.keys(cfg).length > 0 ? { cfg } : {}),
      });
    }
    boards.push({ id, name: (typeof o.name === 'string' && cleanName(o.name)) || `Board ${boards.length + 1}`, items: compact(items, null, cols), ...(cols !== GRID_COLS ? { cols } : {}) });
  }
  if (boards.length === 0) return { boards: [{ id: 'b1', name: 'Home', items: [] }], active: 'b1' };
  return { boards, active: typeof r.active === 'string' && boards.some((b) => b.id === r.active) ? r.active : boards[0].id };
}

/** the cell under a pointer: px offsets inside the grid → the dragged dashlet's top-left cell */
export function cellAt(px: number, py: number, cell: number, gap: number, size: DashSize, cols = GRID_COLS): { x: number; y: number } {
  const step = cell + gap;
  return { x: clampX(Math.floor((px + gap / 2) / step), size, cols), y: Math.max(0, Math.floor((py + gap / 2) / step)) };
}
