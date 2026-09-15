// LOG A HAUL (v0.201) — what the player pulled out of a random-loot site.
// Paste the loot straight from the in-game inventory (select all, Ctrl+C)
// and it is appraised at Jita sell through the app's type catalogue and
// price feed; or type the ISK. Each saved haul feeds the site's running
// average (src/lib/hauls.ts). Earlier hauls for the same site are listed
// and can be removed.
import { useEffect, useMemo, useState } from 'react';
import type { SigGroup } from '../lib/chain';
import { parseLootPaste, type Haul, type HaulItem } from '../lib/hauls';
import { findByName } from '../lib/typedb';
import { fetchAggregates } from '../lib/market';
import { BUILTIN_HUBS } from '../lib/constants';
import { iskShort } from '../lib/format';
import { logUser } from '../lib/devlog';

export interface HaulTarget { site: string; group: SigGroup; cls: string; system: string }

export default function HaulLogger({ target, hauls, activeId, onSave, onDelete, onClose }: {
  target: HaulTarget; hauls: Haul[]; activeId: number | null;
  onSave: (h: Haul) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const [paste, setPaste] = useState('');
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState('');
  const [items, setItems] = useState<HaulItem[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const parsed = useMemo(() => parseLootPaste(paste), [paste]);

  // appraise the paste at Jita sell whenever it changes (debounced)
  useEffect(() => {
    if (parsed.length === 0) { setItems([]); setUnknown([]); return undefined; }
    const t = setTimeout(() => {
      const known = parsed.map((p) => ({ ...p, type: findByName(p.name) }));
      const ids = known.map((k) => k.type?.id).filter((x): x is number => typeof x === 'number');
      const jita = BUILTIN_HUBS.find((h) => h.id === 'jita') ?? BUILTIN_HUBS[0];
      setBusy(true);
      void fetchAggregates(jita, ids).then((agg) => {
        setItems(known.map((k) => ({ name: k.name, qty: k.qty, unit: k.type ? (agg.get(k.type.id)?.sell?.min ?? null) : null })));
        setUnknown(known.filter((k) => !k.type).map((k) => k.name));
      }).catch(() => {
        setItems(known.map((k) => ({ name: k.name, qty: k.qty, unit: null })));
        setUnknown(known.filter((k) => !k.type).map((k) => k.name));
      }).finally(() => setBusy(false));
    }, 400);
    return () => clearTimeout(t);
  }, [parsed]);

  const appraised = items.reduce((s, i) => s + (i.unit ?? 0) * i.qty, 0);
  const typedIsk = (() => {
    const t = typed.trim().toLowerCase().replace(/,/g, '');
    const m = /^(\d+(?:\.\d+)?)\s*([kmb])?$/.exec(t);
    if (!m) return null;
    const n = Number(m[1]);
    return Math.round(m[2] === 'k' ? n * 1e3 : m[2] === 'm' ? n * 1e6 : m[2] === 'b' ? n * 1e9 : n);
  })();
  const total = typedIsk !== null ? typedIsk : items.length > 0 ? Math.round(appraised) : null;
  const mine = hauls.filter((h) => h.site === target.site).sort((a, b) => b.at - a.at);

  const save = () => {
    if (total === null || total < 0) return;
    const h: Haul = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(), site: target.site, group: target.group, cls: target.cls, system: target.system,
      characterId: activeId ?? undefined, isk: total,
      items: typedIsk === null ? items : undefined, note: note.trim() || undefined,
    };
    logUser('chain: haul logged', { group: h.group, cls: h.cls, isk: h.isk, items: h.items?.length ?? 0, typed: typedIsk !== null });
    onSave(h);
  };

  return (
    <div className="panel" style={{ padding: 10, marginBottom: 8, borderLeft: '3px solid var(--accent, #7fc8ff)' }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <b style={{ fontSize: 12.5 }}>Log a haul · {target.site}</b>
        <span className="dim" style={{ fontSize: 11.5 }}>{target.group}{target.cls ? ` · ${target.cls}` : ''}{target.system ? ` · ${target.system}` : ''}</span>
        <button className="btn mini" style={{ marginLeft: 'auto' }} onClick={onClose}>✕ close</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(220px, 1fr)', gap: 10, marginTop: 8, fontSize: 12 }}>
        <div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 3 }}>Paste the loot from your inventory (select all → Ctrl+C), one item per line</div>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={5} spellCheck={false}
            placeholder={'Intact Armor Plates\t2\nAncient Coordinates Database\t3'}
            style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', fontSize: 12 }} />
          {items.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 11.5 }}>
              {busy ? <span className="dim">appraising…</span> : <>
                <b>{iskShort(appraised)}</b> <span className="dim">at Jita sell over {items.length} item{items.length === 1 ? '' : 's'}</span>
                {unknown.length > 0 && <div style={{ color: 'var(--warn, #e0a13a)' }}>not in the catalogue, counted at 0: {unknown.join(', ')}</div>}
              </>}
            </div>
          )}
        </div>
        <div>
          <div className="dim" style={{ fontSize: 11, marginBottom: 3 }}>…or type the total ISK (e.g. 45m, 1.2b) — this wins over the paste</div>
          <input type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="45m" style={{ width: 140, fontSize: 12 }} />
          <div className="dim" style={{ fontSize: 11, margin: '8px 0 3px' }}>Note (optional)</div>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. one can failed" style={{ width: '100%', boxSizing: 'border-box', fontSize: 12 }} />
          <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
            <button className="btn mini primary" disabled={total === null} onClick={save}>save {total !== null ? iskShort(total) : ''}</button>
            <span className="dim" style={{ fontSize: 11 }}>{mine.length > 0 ? `${mine.length} earlier haul${mine.length === 1 ? '' : 's'} for this site` : 'first haul for this site'}</span>
          </div>
        </div>
      </div>
      {mine.length > 0 && (
        <div style={{ marginTop: 8, fontSize: 11.5, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {mine.slice(0, 12).map((h) => (
            <span key={h.id} className="chip" style={{ display: 'inline-flex', gap: 6, alignItems: 'center', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 6 }}
              title={`${new Date(h.at).toLocaleString()}${h.system ? ` · ${h.system}` : ''}${h.note ? ` · ${h.note}` : ''}${h.items ? ` · ${h.items.length} items` : ' · typed'}`}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{iskShort(h.isk)}</span>
              <span className="dim">{new Date(h.at).toISOString().slice(0, 10)}</span>
              <button className="btn mini" style={{ padding: '0 4px', fontSize: 10 }} title="remove this haul" onClick={() => onDelete(h.id)}>✕</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
