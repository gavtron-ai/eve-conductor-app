// THE DASHLET STORE (v0.207.0) — "nice little categories like a curated dashboard storefront".
// Shelves on the left; on the right each dashlet as a card: a LIVE preview with your own data,
// the question it answers, the versions it comes in (pick one), what it needs, and ＋ add.
import { useEffect, useState } from 'react';
import { CATEGORIES, byCategory, dashTitle, type DashCategory, type DashletSpec } from '../lib/dashlets';
import { MAX_ITEMS, SIZE_CELLS, SIZE_LABEL, type Board, type DashSize } from '../lib/homeGrid';
import { DashletBody } from './HomeDashlets';
import type { SavedView } from '../lib/favorites';

const PREVIEW_CELL = 150, PREVIEW_GAP = 12;
/** the preview pane's room; a bigger version is scaled down to fit it */
const PANE_W = 330, PANE_H = 230, PANE_PAD = 14;

function StoreCard({ spec, board, onAdd, onGo }: { spec: DashletSpec; board: Board; onAdd: (kind: string, size: DashSize, cfg?: Record<string, string>) => void; onGo: (dest: string, view?: SavedView) => void }) {
  const [size, setSize] = useState<DashSize>(spec.sizes[Math.min(1, spec.sizes.length - 1)]);
  const [cfg, setCfg] = useState<Record<string, string>>({});
  const [added, setAdded] = useState(0);
  const onBoard = board.items.filter((i) => i.kind === spec.id).length;
  const full = board.items.length >= MAX_ITEMS;
  const w = SIZE_CELLS[size].w * PREVIEW_CELL + (SIZE_CELLS[size].w - 1) * PREVIEW_GAP;
  const h = SIZE_CELLS[size].h * PREVIEW_CELL + (SIZE_CELLS[size].h - 1) * PREVIEW_GAP;
  const k = Math.min(1, PANE_W / w, (PANE_H - 2 * PANE_PAD) / h);
  return (
    <article className="store-card">
      <div className="store-preview" style={{ height: PANE_H }}>
        <div style={{ width: w * k, height: h * k }}>
          <section className={`dash size-${size} in-store`} style={{ position: 'relative', width: w, height: h, zoom: k, ['--k' as string]: String(PREVIEW_CELL / 160) }}>
            <header className="dash-head"><span className="dash-icon">{spec.icon}</span><span className="dash-title">{dashTitle(spec, cfg)}</span></header>
            <DashletBody kind={spec.id} size={size} cfg={cfg} onGo={onGo} style={{ pointerEvents: 'none' }} />
          </section>
        </div>
      </div>
      <div className="store-info">
        <h3>{spec.icon} {spec.title}{onBoard > 0 && <span className="store-have" title={`already on “${board.name}”`}>on this board{onBoard > 1 ? ` ×${onBoard}` : ''}</span>}</h3>
        <p>{spec.blurb}</p>
        {spec.needs && <p className="store-needs">needs: {spec.needs}</p>}
        <div className="store-row">
          <span className="dash-sizes" title="the versions it comes in">
            {spec.sizes.map((s) => <button key={s} className={s === size ? 'on' : ''} onClick={() => setSize(s)} title={`${SIZE_LABEL[s]} — ${SIZE_CELLS[s].w} × ${SIZE_CELLS[s].h} cells`}>{s}</button>)}
          </span>
          {spec.options?.filter((o) => o.choices).map((o) => (
            <select key={o.key} value={cfg[o.key] ?? o.def} onChange={(e) => setCfg({ ...cfg, [o.key]: e.target.value })} title={o.label}>
              {o.choices!.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
            </select>
          ))}
          <span style={{ flex: 1 }} />
          <button className="btn mini primary" disabled={full} title={full ? `“${board.name}” is full (${MAX_ITEMS}) — remove one, or use another board` : `put the ${SIZE_LABEL[size]} version on “${board.name}”`}
            onClick={() => { onAdd(spec.id, size, cfg); setAdded((n) => n + 1); }}>
            {added > 0 ? `✓ added${added > 1 ? ` ×${added}` : ''} · add another` : '＋ add'}
          </button>
        </div>
      </div>
    </article>
  );
}

export default function DashletStore({ board, onAdd, onGo, onClose }: {
  board: Board; onAdd: (kind: string, size: DashSize, cfg?: Record<string, string>) => void; onGo: (dest: string, view?: SavedView) => void; onClose: () => void;
}) {
  const [cat, setCat] = useState<DashCategory>('chain');
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  const shelf = CATEGORIES.find((c) => c.id === cat)!;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="store" onClick={(e) => e.stopPropagation()}>
        <nav className="store-shelves">
          <div className="store-brand">Dashlet store</div>
          {CATEGORIES.map((c) => (
            <button key={c.id} className={c.id === cat ? 'on' : ''} onClick={() => setCat(c.id)}>
              <span className="store-shelf-icon">{c.icon}</span>
              <span><b>{c.label}</b><i>{byCategory(c.id).length} dashlet{byCategory(c.id).length === 1 ? '' : 's'}</i></span>
            </button>
          ))}
          <div className="store-foot">Adding to <b>“{board.name}”</b> · {board.items.length}/{MAX_ITEMS}<br />Previews are live — your own data.</div>
        </nav>
        <div className="store-main">
          <div className="store-head">
            <div><h2>{shelf.icon} {shelf.label}</h2><span>{shelf.blurb}</span></div>
            <button className="btn mini" onClick={onClose}>✓ done</button>
          </div>
          <div className="store-cards" key={cat}>
            {byCategory(cat).map((spec) => <StoreCard key={spec.id} spec={spec} board={board} onAdd={onAdd} onGo={onGo} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
