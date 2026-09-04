// WHAT ELSE COULD GO IN THIS SLOT.
//
// Two sources, in the order a player thinks of them:
//   1. WHAT IS ALREADY IN THE HOLD — the swap you could actually make undocked.
//   2. Anything else that fits this rack — the hypothetical.
//
// WHETHER IT FITS IS MEASURED, NOT ESTIMATED. The obvious shortcut is to
// compare a module's CPU attribute against the fit's remaining headroom, and it
// is wrong for every module: attribute 50 is the BASE cost, before Electronics
// Upgrades, before implants, before a co-processor changes the budget itself.
// So each candidate is actually installed in the slot and scored by the engine,
// against the PENDING fit — every unapplied swap, state and charge included,
// because the question is "now that I freed up grid, what fits?" before
// pressing Calculate.
//
// That costs one engine pass per candidate (~25 ms, in the worker), so results
// stream in as they arrive rather than blocking, and a superseded search is
// abandoned mid-flight.
import { useEffect, useMemo, useRef, useState } from 'react';
import { rackForModule, type Rack } from '../lib/wizardFits';
import type { EsfDataShapes } from '../lib/dogmaFit';
import type { Combatant } from '../lib/store';

const RACK_OF_SLOT: Record<string, Rack> = {
  High: 'high', Medium: 'med', Low: 'low', Rig: 'rig', SubSystem: 'sub',
};

export interface SlotBudget {
  cpu: number;
  power: number;
  calibration: number;
}

/** a fit is legal when nothing is over budget */
const fitsWith = (b: SlotBudget | null): boolean =>
  b !== null && b.cpu >= -1e-6 && b.power >= -1e-6 && b.calibration >= -1e-6;

type Verdict = 'checking' | 'fits' | 'over' | 'unknown';

export default function SlotSwap({
  slotType, data, cargoTypeIds, current, slotKey, combatant, testSlot, onPick, onClose,
}: {
  slotType: string;
  data: EsfDataShapes;
  cargoTypeIds: number[];
  current: number | null;
  slotKey: string;
  combatant: Combatant;
  testSlot: (c: Combatant, slotKey: string, typeId: number | null) => Promise<SlotBudget | null>;
  onPick: (typeId: number | null) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState('');
  const [onlyFits, setOnlyFits] = useState(true);
  const [verdicts, setVerdicts] = useState<Map<number, Verdict>>(new Map());
  const [empty, setEmpty] = useState<SlotBudget | null>(null);
  const run = useRef(0);
  const rack = RACK_OF_SLOT[slotType];

  /** every candidate for this rack, cargo first */
  const candidates = useMemo(() => {
    const goes = (typeId: number) => rack !== undefined && rackForModule(typeId, data) === rack;
    const named = (typeId: number) => data.types[String(typeId)]?.name ?? '';
    const cargo = [...new Set(cargoTypeIds)].filter(goes)
      .map((id) => ({ id, name: named(id), inCargo: true }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const needle = q.trim().toLowerCase();
    const found: { id: number; name: string; inCargo: boolean }[] = [];
    if (needle.length >= 2) {
      const seen = new Set(cargo.map((c) => c.id));
      for (const [idStr, t] of Object.entries(data.types)) {
        if ((t as { published?: boolean }).published === false) continue;
        if (!t.name.toLowerCase().includes(needle)) continue;
        const id = Number(idStr);
        if (seen.has(id) || !goes(id)) continue;
        found.push({ id, name: t.name, inCargo: false });
        if (found.length > 200) break;
      }
      // shortest name first puts "Damage Control II" above
      // "Domination Damage Control", which is what a search usually means
      found.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));
    }
    // the verification budget is real engine time, so the list it walks is
    // bounded — and the cap is stated rather than silently applied
    return { cargo, found: found.slice(0, 40) };
  }, [q, rack, data, cargoTypeIds]);

  /**
   * Verify the shown candidates, one engine pass each, newest search wins.
   * The baseline (slot empty) is taken first so the panel can show the room
   * available even before any candidate has been scored.
   */
  useEffect(() => {
    const mine = ++run.current;
    let dead = false;
    const list = [...candidates.cargo, ...candidates.found];
    setVerdicts(new Map(list.map((c) => [c.id, 'checking' as Verdict])));
    void (async () => {
      const base = await testSlot(combatant, slotKey, null);
      if (dead || run.current !== mine) return;
      setEmpty(base);
      for (const c of list) {
        if (dead || run.current !== mine) return;
        const b = await testSlot(combatant, slotKey, c.id);
        if (dead || run.current !== mine) return;
        setVerdicts((prev) => {
          const next = new Map(prev);
          next.set(c.id, b === null ? 'unknown' : fitsWith(b) ? 'fits' : 'over');
          return next;
        });
      }
    })();
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidates, slotKey, combatant.id, JSON.stringify(combatant.moduleSwaps ?? {}),
    JSON.stringify(combatant.moduleStates ?? {}), combatant.propRunning, combatant.profile]);

  const show = (id: number) => !onlyFits || (verdicts.get(id) ?? 'checking') !== 'over';
  const pending = [...verdicts.values()].filter((v) => v === 'checking').length;

  const Row = ({ o }: { o: { id: number; name: string; inCargo: boolean } }) => {
    const v = verdicts.get(o.id) ?? 'checking';
    return (
      <button className={`add-row${o.id === current ? ' on' : ''}${v === 'over' ? ' slot-over' : ''}`}
        onClick={() => { onPick(o.id); onClose(); }}>
        <b>{o.name}</b>
        <span className="dim">{o.inCargo ? 'in the hold' : ''}</span>
        <span className={v === 'over' ? 'bad' : v === 'fits' ? 'pos' : 'dim'}>
          {v === 'checking' ? '…' : v === 'fits' ? 'fits' : v === 'over' ? 'over' : '?'}
        </span>
      </button>
    );
  };

  return (
    <div className="slot-swap" onMouseDown={(e) => e.stopPropagation()}>
      <div className="slot-swap-head">
        <b>{slotType} slot</b>
        <button className="btn mini" onClick={onClose}>close</button>
      </div>

      <div className="slot-swap-row">
        <button className="btn mini" onClick={() => { onPick(null); onClose(); }}>
          leave the slot empty
        </button>
        <label className="prop-toggle"
          title="Each option is actually installed in this slot and scored by the dogma engine against your PENDING changes — so a co-processor that pays for itself shows as fitting, and a module made affordable by something you switched off a moment ago shows up without pressing Calculate first.">
          <input type="checkbox" checked={onlyFits}
            onChange={(e) => setOnlyFits(e.target.checked)} />
          only what fits
        </label>
        {pending > 0 && <span className="dim">checking {pending}…</span>}
      </div>

      {empty && (
        <div className="hint">
          With this slot empty: {empty.cpu.toFixed(1)} tf · {empty.power.toFixed(1)} MW
          {empty.calibration > 0 ? ` · ${empty.calibration.toFixed(0)} calibration` : ''} spare.
          Each option below is scored with it actually installed.
        </div>
      )}

      {candidates.cargo.length > 0 && (
        <div className="slot-swap-list">
          {candidates.cargo.filter((o) => show(o.id)).map((o) => <Row key={o.id} o={o} />)}
        </div>
      )}

      <input className="filter" autoFocus placeholder="search anything that fits this rack…"
        value={q} onChange={(e) => setQ(e.target.value)} />
      {q.trim().length > 0 && q.trim().length < 2 && <div className="hint">two letters or more</div>}

      <div className="slot-swap-list">
        {candidates.found.filter((o) => show(o.id)).map((o) => <Row key={o.id} o={o} />)}
        {q.trim().length >= 2 && candidates.found.length === 0 && (
          <div className="hint">nothing matching that goes in a {slotType.toLowerCase()} slot</div>
        )}
      </div>
      {candidates.found.length >= 40 && (
        <div className="hint">Showing the 40 closest matches — narrow the search to see others.</div>
      )}
    </div>
  );
}
