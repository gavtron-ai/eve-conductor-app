// THE POD PICKER (v0.194) — sit a fit in different clones and watch the
// numbers move, and keep the clones you like in a library.
//
// PLACEMENT IS LOAD-BEARING: this renders BELOW the stats panel. v0.193 put
// it above, and an open pod list (ten selects, ~170 options each) buried
// the numbers a fitter watches constantly — "where are the stats?". Stats
// come first in the pane, always; this is the thing under them.
//
// Three states, one truth: fit.implants is what the engine and every export
// use. undefined = every character wears their own implants (the default,
// the pre-picker behavior); an array = this pod, worn by EVERYONE so the
// comparison is about the pod. fit.podId is only a bookkeeping link to the
// saved pod the array came from, so "update saved pod" can be offered.
//
// A pod attached to a fit TRAVELS WITH IT: its implants ride in cargo on
// every copy (EFT, buy list) and every save to a character, and importing
// such an EFT puts them straight back in their slots (wizardFits.ts).
import { useMemo, useState } from 'react';
import type { CharAccount } from '../lib/auth';
import type { EsfDataShapes } from '../lib/dogmaFit';
import { implantSlot } from '../lib/implants';
import { activePodImplants } from '../lib/cloneNames';
import { fetchAggregates } from '../lib/market';
import { BUILTIN_HUBS } from '../lib/constants';
import { iskShort } from '../lib/format';
import { useApp } from '../lib/store';
import type { WizardFit, SavedPod } from '../lib/wizardFits';

const EMPTY = (): (number | null)[] => Array(10).fill(null);
const same = (a: (number | null)[] | undefined, b: (number | null)[]) =>
  !!a && a.length === b.length && a.every((x, i) => x === b[i]);

export default function PodPicker({ fit, onFit, chars, data }: {
  fit: WizardFit;
  onFit: (next: WizardFit) => void;
  chars: CharAccount[];
  data: EsfDataShapes;
}) {
  const pods = useApp((s) => s.pods);
  const setPods = useApp((s) => s.setPods);
  const [prices, setPrices] = useState<Map<number, number> | null>(null);
  const [newName, setNewName] = useState('');

  /** every implant in the bundle by pod slot 1–10, natural-sorted so
   * families group alphabetically and grades order numerically
   * (SP-601 < SP-602 < SP-603). Boosters are category 20 too but carry no
   * implantness, so the slot filter drops them for free. */
  const catalog = useMemo(() => {
    const bySlot = new Map<number, { typeId: number; name: string }[]>();
    for (const [idStr, t] of Object.entries(data.types)) {
      if (t.categoryID !== 20) continue;
      const id = Number(idStr);
      const slot = implantSlot(data, id);
      if (slot === undefined || slot < 1 || slot > 10) continue;
      (bySlot.get(slot) ?? bySlot.set(slot, []).get(slot)!).push({ typeId: id, name: t.name });
    }
    for (const arr of bySlot.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
    }
    return bySlot;
  }, [data]);

  /** Jita asks for every implant, fetched once on first open (the market
   * lib chunks and caches aggregates) */
  const loadPrices = () => {
    if (prices !== null) return;
    setPrices(new Map());
    const ids = [...catalog.values()].flat().map((x) => x.typeId);
    const jita = BUILTIN_HUBS.find((h) => h.id === 'jita') ?? BUILTIN_HUBS[0];
    void fetchAggregates(jita, ids).then((agg) => {
      const m = new Map<number, number>();
      for (const [id, a] of agg) if (a.sell?.min) m.set(id, a.sell.min);
      setPrices(m);
    }).catch(() => { /* prices are a nicety; names still work */ });
  };

  const saved = fit.podId ? pods.find((p) => p.id === fit.podId) : undefined;
  const mode = fit.implants === undefined ? 'own' : saved ? `pod:${saved.id}` : 'custom';
  const edited = !!saved && !same(fit.implants, saved.slots);
  const count = (fit.implants ?? []).filter((x) => x !== null).length;
  const status = fit.implants === undefined ? "characters' own implants"
    : saved ? `${saved.name}${edited ? ' (edited)' : ''}`
      : `custom (${count} implant${count === 1 ? '' : 's'})`;

  const loadCharPod = () => {
    const c = chars[0];
    if (!c) return;
    const pod = activePodImplants(c.characterId) ?? c.implants ?? [];
    const slots = EMPTY();
    for (const id of pod) {
      const s = implantSlot(data, id);
      if (s !== undefined && s >= 1 && s <= 10) slots[s - 1] = id;
    }
    onFit({ ...fit, implants: slots, podId: undefined });
  };

  return (
    <details onToggle={(e) => { if ((e.target as HTMLDetailsElement).open) loadPrices(); }}
      style={{ marginTop: 10, borderTop: '1px solid var(--grid)', paddingTop: 6 }}>
      <summary style={{ cursor: 'pointer', fontSize: 12.5 }}>
        🧠 Pod <span className={fit.implants === undefined ? 'dim' : ''}>— {status}</span>
      </summary>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '6px 0' }}>
        <select value={mode} style={{ fontSize: 12 }}
          title="Which pod the numbers above assume. 'characters' own' = each selected character wears their synced implants; a saved or custom pod is worn by ALL of them so the comparison is about the pod."
          onChange={(e) => {
            const v = e.target.value;
            if (v === 'own') onFit({ ...fit, implants: undefined, podId: undefined });
            else if (v === 'custom') onFit({ ...fit, implants: fit.implants ?? EMPTY(), podId: undefined });
            else {
              const p = pods.find((x) => `pod:${x.id}` === v);
              if (p) onFit({ ...fit, implants: [...p.slots], podId: p.id });
            }
          }}>
          <option value="own">characters’ own implants</option>
          {pods.length > 0 && (
            <optgroup label="saved pods">
              {pods.map((p) => <option key={p.id} value={`pod:${p.id}`}>{p.name}</option>)}
            </optgroup>
          )}
          <option value="custom">custom pod</option>
        </select>
        {chars[0] && (
          <button className="btn mini"
            title={`Fill the slots with ${chars[0].characterName}'s current pod — live from the multibox registry, falling back to the last character sync.`}
            onClick={loadCharPod}>
            ⤓ load {chars[0].characterName}'s pod
          </button>
        )}
      </div>

      {fit.implants !== undefined && (
        <>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', margin: '0 0 6px' }}>
            <input type="text" value={newName} placeholder="name this pod…" style={{ fontSize: 12, width: 150 }}
              onChange={(e) => setNewName(e.target.value)} />
            <button className="btn mini" disabled={count === 0}
              title="Save these slots to the pod library as a new named pod — pods live separately from fits, so any fit can sit in them."
              onClick={() => {
                const name = newName.trim() || `Pod ${pods.length + 1}`;
                const p: SavedPod = { id: `pod-${Date.now().toString(36)}`, name, slots: [...fit.implants!] };
                setPods([...pods, p]);
                onFit({ ...fit, podId: p.id });
                setNewName('');
              }}>
              💾 save as new pod
            </button>
            {saved && edited && (
              <button className="btn mini" title={`Write these slots back into the saved pod "${saved.name}".`}
                onClick={() => setPods(pods.map((p) => (p.id === saved.id ? { ...p, slots: [...fit.implants!] } : p)))}>
                ↻ update “{saved.name}”
              </button>
            )}
            {saved && (
              <button className="btn mini" title={`Delete "${saved.name}" from the pod library. This fit keeps the implants as a custom pod.`}
                onClick={() => {
                  setPods(pods.filter((p) => p.id !== saved.id));
                  onFit({ ...fit, podId: undefined });
                }}>
                🗑
              </button>
            )}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '3px 6px', alignItems: 'center', fontSize: 12 }}>
            {Array.from({ length: 10 }, (_, i) => (
              <div key={i} style={{ display: 'contents' }}>
                <span className="dim">{i + 1}</span>
                <select value={fit.implants![i] ?? ''} style={{ width: '100%', fontSize: 11.5 }}
                  onChange={(e) => {
                    const next = [...fit.implants!];
                    next[i] = e.target.value === '' ? null : Number(e.target.value);
                    onFit({ ...fit, implants: next });
                  }}>
                  <option value="">— empty —</option>
                  {(catalog.get(i + 1) ?? []).map((imp) => {
                    const p = prices?.get(imp.typeId);
                    return (
                      <option key={imp.typeId} value={imp.typeId}>
                        {imp.name}{p !== undefined ? ` — ${iskShort(p)}` : prices && prices.size > 0 ? ' — no Jita sell' : ''}
                      </option>
                    );
                  })}
                </select>
              </div>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 6 }}>
            This pod travels with the fit: its implants ride in cargo on every copy, buy list and
            save-to-character, and importing that EFT puts them back in their slots.
          </div>
        </>
      )}
    </details>
  );
}
