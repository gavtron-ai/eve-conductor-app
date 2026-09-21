// THE FAVORITES STRIP (v0.206.0) — the player's pinned tabs under the header,
// one click each, in their order. A chip may carry a saved view ("Σ Summary ·
// Gneiss · C3 branch"); clicking it opens the tab AND applies the view.
//   click        → go there          drag        → reorder
//   right-click  → rename / remove   Alt+1 … 9   → the first nine
// The list lives in the persisted store (lib/favorites.ts holds the rules).
import { useState } from 'react';
import {
  MAX_FAVORITES, destOf, favLabel, moveFavorite, removeFavorite, renameFavorite,
  type Favorite, type FavoritesState,
} from '../lib/favorites';

export function FavoritesStrip({ state, currentDest, onGo, onChange }: {
  state: FavoritesState; currentDest: string; onGo: (f: Favorite) => void; onChange: (s: FavoritesState) => void;
}) {
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [gear, setGear] = useState(false);
  if (state.list.length === 0) return null;
  const commitRename = () => { if (renaming) onChange(renameFavorite(state, renaming.id, renaming.text)); setRenaming(null); };

  return (
    <div className="fav-strip" onClick={() => { setMenu(null); setGear(false); }}>
      <span className="fav-strip-label" title="Your pinned tabs. ☆ in the header pins the tab you are on; a tab with filters can save its view here too. Drag to reorder, right-click to rename or remove, Alt+1…9 to jump.">★</span>
      {state.list.map((f, i) => {
        const d = destOf(f.dest);
        const here = !f.view && f.dest === currentDest;
        if (renaming?.id === f.id) {
          return (
            <input key={f.id} className="fav-rename" autoFocus value={renaming.text} maxLength={28}
              onChange={(e) => setRenaming({ id: f.id, text: e.target.value })}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setRenaming(null); }} />
          );
        }
        return (
          <button key={f.id} draggable
            className={`fav-chip${here ? ' on' : ''}${f.view ? ' has-view' : ''}${overId === f.id && dragId !== f.id ? ' drop' : ''}`}
            title={`${d?.moduleLabel ?? ''} → ${d?.label ?? f.dest}${f.view ? ` — saved view: ${f.view.summary}` : ''}${i < 9 ? ` · Alt+${i + 1}` : ''} · drag to reorder · right-click to rename or remove`}
            onClick={(e) => { e.stopPropagation(); onGo(f); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setMenu({ id: f.id, x: e.clientX, y: e.clientY }); }}
            onDragStart={(e) => { setDragId(f.id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', f.id); }}
            onDragOver={(e) => { e.preventDefault(); setOverId(f.id); }}
            onDragLeave={() => setOverId((o) => (o === f.id ? null : o))}
            onDrop={(e) => { e.preventDefault(); if (dragId) onChange(moveFavorite(state, dragId, f.id)); setDragId(null); setOverId(null); }}
            onDragEnd={() => { setDragId(null); setOverId(null); }}>
            <span className="fav-icon">{d?.icon ?? '★'}</span>
            <span className="fav-text">{favLabel(f)}</span>
            {i < 9 && <span className="fav-key">{i + 1}</span>}
          </button>
        );
      })}
      {/* dropping past the last chip moves it to the end */}
      <span className="fav-end" onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); if (dragId) onChange(moveFavorite(state, dragId, null)); setDragId(null); setOverId(null); }} />
      <span className="dim" style={{ fontSize: 11, marginLeft: 'auto', whiteSpace: 'nowrap' }}>{state.list.length} / {MAX_FAVORITES}</span>
      <button className="fav-gear" title="favorites options" onClick={(e) => { e.stopPropagation(); setGear((g) => !g); setMenu(null); }}>⋯</button>
      {gear && (
        <div className="fav-menu" style={{ right: 8, top: 30 }} onClick={(e) => e.stopPropagation()}>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}
            title="When the app starts, go straight to the first favorite (and apply its saved view, if it has one).">
            <input type="checkbox" checked={state.openFirstOnLaunch} onChange={(e) => onChange({ ...state, openFirstOnLaunch: e.target.checked })} />
            open my first favorite when the app starts
          </label>
        </div>
      )}
      {menu && (
        <div className="fav-menu" style={{ left: menu.x, top: menu.y, position: 'fixed' }} onClick={(e) => e.stopPropagation()}>
          <button onClick={() => { const f = state.list.find((x) => x.id === menu.id); if (f) setRenaming({ id: f.id, text: f.name || favLabel(f) }); setMenu(null); }}>rename</button>
          <button onClick={() => { onChange(removeFavorite(state, menu.id)); setMenu(null); }}>remove from favorites</button>
        </div>
      )}
    </div>
  );
}
