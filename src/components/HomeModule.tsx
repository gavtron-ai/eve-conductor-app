// HOME (v0.207.0) — the player's own dashboards. A fixed grid of square cells (8 across), phone
// style: every dashlet comes in a couple of fixed versions, ✎ arrange is the placement tool
// (drag to place — the others make room as you move — and pick a version, options, or remove),
// and the ＋ store is where dashlets come from. Placement rules: lib/homeGrid.ts (pure, fixtures).
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/store';
import {
  COLS_CHOICES, MAX_BOARDS, MAX_ITEMS, SIZE_CELLS, SIZE_LABEL, activeBoard, addBoard, addItem, cellAt, colsOf, configureItem, moveItem, removeBoard, removeItem,
  renameBoard, repack, resizeItem, rowsUsed, sanitizeHome, setBoardCols, withItems, type DashItem, type HomeState,
} from '../lib/homeGrid';
import { dashTitle, dashletOf, optionOf, sizesOf, starterItems } from '../lib/dashlets';
import { DashletBody, headView } from './HomeDashlets';
import DashletStore from './DashletStore';
import { destOf, type SavedView } from '../lib/favorites';
import { logUser } from '../lib/devlog';

// the app re-renders once a second (the status bar's countdowns). A dashlet must not: it re-renders
// on its OWN beat or when its data changes — measured, this was the board's whole steady-state cost
const Body = memo(DashletBody);
const GAP = 12;
// THE GRID FILLS THE WINDOW (v0.211.0): cells are as wide as the room divided by the board's columns —
// no upper limit (it used to stop at 210 px and leave a blank strip down the right of a wide
// window). What is capped instead is the TYPE: past a point bigger cells mean more rows, not
// bigger letters. Below CELL_MIN the board scrolls sideways rather than crush a dashlet.
const CELL_MIN = 104;
const TYPE_MIN = 0.8, TYPE_MAX = 1.3;

export default function HomeModule({ onGo }: { onGo: (dest: string, view?: SavedView) => void }) {
  const raw = useApp((s) => s.home);
  const setHome = useApp((s) => s.setHome);
  const home = useMemo(() => sanitizeHome(raw, sizesOf), [raw]);
  const board = activeBoard(home);
  const goRef = useRef(onGo); goRef.current = onGo;
  const go = useCallback((dest: string, view?: SavedView) => goRef.current(dest, view), []);
  const cols = colsOf(board);
  const [editing, setEditing] = useState(false);
  const [store, setStore] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [optsFor, setOptsFor] = useState<string | null>(null);
  const commit = (next: HomeState, what: string) => { setHome(next); logUser(`home: ${what}`, { board: activeBoard(next).name, items: activeBoard(next).items.length }); };
  const setItems = (items: DashItem[], what: string) => commit(withItems(home, board.id, items), what);
  // Enter and leaving the field both finish a rename (once: the blur that follows Enter finds it done)
  const finishRename = (id: string, name: string) => { if (renaming !== id) return; setRenaming(null); const next = renameBoard(home, id, name); if (next !== home) commit(next, 'board renamed'); };

  // ---- the grid's cell size follows the room: 8 across, square, within sane bounds
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [cell, setCell] = useState(160);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return undefined;
    // to the hundredth of a pixel: the last column ends where the window does
    const fit = () => { const w = el.clientWidth; if (w > 0) setCell(Math.max(CELL_MIN, Math.floor(((w - GAP * (cols - 1)) / cols) * 100) / 100)); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [cols]);
  const step = cell + GAP;

  // ---- dragging (arrange mode): the others reflow live under the pointer, phone style
  const gridRef = useRef<HTMLDivElement | null>(null);
  // the screen may be zoomed (the header's per-screen zoom is CSS zoom on an ancestor): a pointer's
  // viewport px are turned into the grid's own px by the ratio of its drawn width to its laid-out width
  const pointIn = (cx: number, cy: number) => {
    const r = gridRef.current!.getBoundingClientRect();
    const k = r.width > 0 ? (cols * step - GAP) / r.width : 1;
    return { px: (cx - r.left) * k, py: (cy - r.top) * k };
  };
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number; px: number; py: number } | null>(null);
  const preview = useMemo(() => {
    if (!drag) return board.items;
    const it = board.items.find((i) => i.id === drag.id);
    if (!it) return board.items;
    const at = cellAt(drag.px - drag.dx, drag.py - drag.dy, cell, GAP, it.size, cols);
    return moveItem(board.items, drag.id, at.x, at.y, cols);
  }, [drag, board.items, cell, cols]);
  const previewRef = useRef(preview); previewRef.current = preview;
  useEffect(() => {
    if (!drag) return undefined;
    const rel = (e: PointerEvent) => pointIn(e.clientX, e.clientY);
    const move = (e: PointerEvent) => setDrag((d) => (d ? { ...d, ...rel(e) } : d));
    const up = () => { setItems(previewRef.current, 'dashlet moved'); setDrag(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.id]);
  useEffect(() => { if (!editing) { setOptsFor(null); setDrag(null); } }, [editing]);
  // Esc leaves arrange mode
  useEffect(() => {
    if (!editing) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !store) setEditing(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing, store]);

  const rows = Math.max(rowsUsed(preview) + (editing ? 2 : 0), 3);
  const boxOf = (i: Pick<DashItem, 'x' | 'y' | 'size'>) => ({ left: i.x * step, top: i.y * step, width: SIZE_CELLS[i.size].w * cell + (SIZE_CELLS[i.size].w - 1) * GAP, height: SIZE_CELLS[i.size].h * cell + (SIZE_CELLS[i.size].h - 1) * GAP });
  const startMeOff = () => {
    let items = board.items;
    for (const [kind, size] of starterItems()) items = addItem(items, kind, size, undefined, cols); // v0.245.0: nothing that cannot work today
    setItems(items, 'starter board laid down');
  };

  return (
    <div className="home">
      <div className="home-bar">
        <div className="home-boards">
          {home.boards.map((b) => (renaming === b.id ? (
            <input key={b.id} autoFocus className="home-rename" defaultValue={b.name} maxLength={20}
              onBlur={(e) => finishRename(b.id, e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') finishRename(b.id, (e.target as HTMLInputElement).value); if (e.key === 'Escape') setRenaming(null); }} />
          ) : (
            <button key={b.id} className={`home-board${b.id === board.id ? ' on' : ''}`} title={b.id === board.id ? 'double-click to rename this board' : `show the “${b.name}” board`}
              onClick={() => { if (b.id !== board.id) commit({ ...home, active: b.id }, 'board shown'); }} onDoubleClick={() => setRenaming(b.id)}>
              {b.name}<span className="home-count">{b.items.length}</span>
            </button>
          )))}
          {home.boards.length < MAX_BOARDS && (
            <button className="home-board add" title={`another board — a page of its own, like a phone’s home screens (up to ${MAX_BOARDS})`}
              onClick={() => { const next = addBoard(home, ''); commit(next, 'board added'); setRenaming(next.active); setEditing(true); }}>＋ board</button>
          )}
        </div>
        <span className="home-grow" />
        {editing && (
          <label className="home-cols" title="how many cells across this board is. The grid always fills the window, so this is density: fewer = bigger dashlets, more = more of them side by side (10 or 12 suit a wide monitor). Dashlets keep their places where the new width allows.">
            grid
            <select value={cols} onChange={(e) => commit(setBoardCols(home, board.id, Number(e.target.value)), 'board columns set')}>
              {COLS_CHOICES.map((c) => <option key={c} value={c}>{c} across</option>)}
            </select>
          </label>
        )}
        {editing && board.items.length > 1 && (
          <button className="btn mini" title="pack every dashlet again, in the order they read now, into the width this board has — handy after changing how many cells across it is" onClick={() => setItems(repack(board.items, cols), 'board re-packed')}>⇆ re-pack</button>
        )}
        {editing && (
          <button className="btn mini" title={home.boards.length === 1 ? 'take every dashlet off this board' : 'remove this board and everything on it'}
            onClick={() => { if (window.confirm(home.boards.length === 1 ? `Take every dashlet off “${board.name}”?` : `Remove the board “${board.name}”?`)) commit(removeBoard(home, board.id), 'board removed'); }}>
            🗑 {home.boards.length === 1 ? 'clear board' : 'remove board'}
          </button>
        )}
        <button className={`btn mini${editing ? ' primary' : ''}`} onClick={() => setEditing((e) => !e)}
          title="the placement tool: drag dashlets where you want them — the others make room — pick a version (small, medium, large, wide), set options, or remove">
          {editing ? '✓ done' : '✎ arrange'}
        </button>
        <button className="btn mini primary" onClick={() => setStore(true)} title="the dashlet store — everything you can put on a board, by shelf">＋ add dashlets</button>
      </div>

      <div className="home-wrap" ref={wrapRef}>
        {board.items.length === 0 ? (
          <div className="home-empty">
            <h2>Build your own front page</h2>
            <p>Dashlets are small live panels — ISK on field in your chain, where the gneiss is today, raid windows, planets that need you, your trading value, the corp’s latest fights. Each comes in a couple of sizes and snaps to a grid, like the widgets on a phone.</p>
            <div className="home-empty-actions">
              <button className="btn primary" onClick={() => setStore(true)}>＋ open the dashlet store</button>
              <button className="btn" onClick={startMeOff} title="lays down one board with a bit of everything; rearrange or remove whatever you like afterwards">✨ start me off</button>
            </div>
          </div>
        ) : (
          <div ref={gridRef} className={`home-grid${editing ? ' editing' : ''}`}
            style={{ width: cols * step - GAP, height: rows * step - GAP, backgroundSize: `${step}px ${step}px`, ['--cell' as string]: `${cell}px`, ['--k' as string]: String(Math.min(TYPE_MAX, Math.max(TYPE_MIN, cell / 160))) }}>
            {preview.map((it) => {
              const spec = dashletOf(it.kind);
              if (!spec) return null;
              const dragging = drag?.id === it.id;
              const box = boxOf(it);
              const dest = spec.dest && destOf(spec.dest) ? spec.dest : '';
              return (
                <div key={it.id}>
                  {dragging && <div className="dash-ghost" style={box} />}
                  <section className={`dash size-${it.size}${dragging ? ' dragging' : ''}${optsFor === it.id ? ' opts-open' : ''}`}
                    style={dragging ? { ...box, left: drag.px - drag.dx, top: drag.py - drag.dy } : box}
                    onPointerDown={editing ? (e) => {
                      if ((e.target as HTMLElement).closest('.dash-tools, .dash-opts')) return;
                      const { px, py } = pointIn(e.clientX, e.clientY);
                      e.preventDefault();
                      setOptsFor(null);
                      setDrag({ id: it.id, dx: px - box.left, dy: py - box.top, px, py });
                    } : undefined}>
                    <header className={`dash-head${dest && !editing ? ' link' : ''}`} onClick={dest && !editing ? () => onGo(dest, headView(it.kind, it.cfg)) : undefined}
                      title={editing ? 'drag to place' : dest ? `open ${destOf(dest)!.label}` : spec.blurb}>
                      <span className="dash-icon">{spec.icon}</span>
                      <span className="dash-title">{dashTitle(spec, it.cfg)}</span>
                      {dest && !editing && <span className="dash-open">↗</span>}
                    </header>
                    <Body kind={it.kind} size={it.size} cfg={it.cfg} onGo={go} />
                    {editing && (
                      <div className="dash-tools">
                        <span className="dash-sizes">
                          {spec.sizes.map((s) => (
                            <button key={s} className={s === it.size ? 'on' : ''} title={`the ${SIZE_LABEL[s]} version (${SIZE_CELLS[s].w} × ${SIZE_CELLS[s].h} cells)`}
                              onClick={() => { if (s !== it.size) setItems(resizeItem(board.items, it.id, s, cols), 'dashlet resized'); }}>{s}</button>
                          ))}
                        </span>
                        {spec.options && <button className="dash-tool" title="this dashlet’s options" onClick={() => setOptsFor((o) => (o === it.id ? null : it.id))}>⚙</button>}
                        <button className="dash-tool x" title="take it off the board" onClick={() => setItems(removeItem(board.items, it.id, cols), 'dashlet removed')}>✕</button>
                      </div>
                    )}
                    {editing && optsFor === it.id && spec.options && (
                      <div className="dash-opts">
                        {spec.options.map((o) => (
                          o.text ? (
                            <textarea key={o.key} className="dash-note-edit" autoFocus maxLength={o.text.max} placeholder={o.text.placeholder} defaultValue={optionOf(spec, it.cfg, o.key)}
                              onBlur={(e) => { if (e.target.value !== optionOf(spec, it.cfg, o.key)) setItems(configureItem(board.items, it.id, { [o.key]: e.target.value }), 'note written'); }} />
                          ) : (
                            <label key={o.key}>{o.label}
                              <select value={optionOf(spec, it.cfg, o.key)} onChange={(e) => setItems(configureItem(board.items, it.id, { [o.key]: e.target.value }), 'dashlet configured')}>
                                {(o.choices ?? []).map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                              </select>
                            </label>
                          )
                        ))}
                      </div>
                    )}
                  </section>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {editing && board.items.length > 0 && <div className="home-hint">Arranging “{board.name}” — drag a dashlet and the others make room; S · M · L · XL are its versions; ⚙ its options; ✕ removes it. {board.items.length}/{MAX_ITEMS} on this board. <b>Esc</b> or ✓ done to finish.</div>}
      {store && (
        <DashletStore board={board} onGo={onGo} onClose={() => setStore(false)}
          onAdd={(kind, size, cfg) => setItems(addItem(board.items, kind, size, cfg, cols), `dashlet added: ${kind} ${size}`)} />
      )}
    </div>
  );
}
