// INSPECT AND COMPARE LIBRARY FITS — reusing the app's existing fitting
// pipeline end to end: toEft → parseFit → the vendored EVEShip.fit dogma
// engine → the same FitSummary the rest of the app judges fits by.
//
// WHY AMMO GETS ITS OWN TABLE: a turret fit's DPS and range are properties
// of the LOADED CHARGE as much as the guns. Showing one DPS number for a
// fit that can swap between Barrage and Hail states something that isn't
// true of the fit, only of one loadout of it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { toEft, typeNameOf, rackOf, type RawFitItem } from '../lib/fitSerial';
import { parseFit, type ParsedFit } from '../lib/skillRelevance';
import { calculateFitStats, getEsfData, type FitStats } from '../lib/dogmaStats';
import { chargesForAll, ammoWeapons, withAmmo, type DogmaLookup } from '../lib/fitCharges';
import { pairCharges, type ChargePairing } from '../lib/chargeMatch';
import SimPanel from './SimPanel';
import { logUser } from '../lib/devlog';
import { moduleDiff, statDiff, verdictOf } from '../lib/fitDiff';
import type { LibraryEntry } from '../lib/fitLibrary';
import { useAuth } from '../lib/auth';

const n0 = (v: number) => Math.round(v).toLocaleString();
const nd = (v: number, d: number) => v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
const km = (m: number | undefined) => (m === undefined ? '—' : m >= 1000 ? `${nd(m / 1000, 1)} km` : `${n0(m)} m`);

/**
 * A library entry → the app's standard ParsedFit.
 *
 * EVE does not store which gun the ammo was in: a saved fitting comes back
 * with its launchers in HiSlot0…n and the ammo as a loose Cargo row. A weapon
 * carries no damage attributes of its own, so an unloaded one scores ZERO —
 * every turret and launcher fit in this library was reporting drone damage
 * only. pairCharges puts the ammo back where dogma says it must have been,
 * and refuses when that answer is not forced.
 */
function parseEntry(e: LibraryEntry, data: DogmaLookup | null): {
  fit: ParsedFit;
  inferred: ChargePairing['inferred'];
  ambiguous: ChargePairing['ambiguous'];
} {
  const raw = e.items as RawFitItem[];
  // before the dogma bundle lands there is nothing to match against; the fit
  // still renders, just without recovered ammo
  const paired = data ? pairCharges(raw, data) : { items: raw, inferred: [], ambiguous: [] };
  return {
    fit: parseFit(toEft(e.hullName, e.name, paired.items)),
    inferred: paired.inferred,
    ambiguous: paired.ambiguous,
  };
}

interface AmmoRow { chargeId: number; name: string; dps: number; volley: number; range: number | undefined }

/** WHAT produced a set of ammo rows. The rows are rendered only when this
 * still matches the live selection, so a missed invalidation path hides the
 * table rather than captioning one fit's numbers with another fit's name. */
interface AmmoStamp { entryKey: string; weaponId: number; charId: number | null }
const sameStamp = (a: AmmoStamp | null, b: AmmoStamp) =>
  a !== null && a.entryKey === b.entryKey && a.weaponId === b.weaponId && a.charId === b.charId;

export default function FitInspector({
  entry, compare, onClearCompare,
}: { entry: LibraryEntry; compare: LibraryEntry | null; onClearCompare: () => void }) {
  const characters = useAuth((s) => s.characters);
  const activeId = useAuth((s) => s.activeId);
  const [charId, setCharId] = useState<number | null>(activeId);
  const char = characters.find((c) => c.characterId === charId) ?? characters[0];

  const [stats, setStats] = useState<FitStats | null>(null);
  const [cmpStats, setCmpStats] = useState<FitStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DogmaLookup | null>(null);
  const [tab, setTab] = useState<'modules' | 'ammo' | 'sim' | 'diff'>('modules');
  /** see FitStatsPanel: a saved fit is always scored with its prop mod cycling
   * because ESI cannot say otherwise. Same default, same toggle, same wording. */
  const [propRunning, setPropRunning] = useState(true);

  const [weaponId, setWeaponId] = useState<number | null>(null);
  const [ammoRows, setAmmoRows] = useState<AmmoRow[] | null>(null);
  const [ammoStamp, setAmmoStamp] = useState<AmmoStamp | null>(null);
  const [ammoBusy, setAmmoBusy] = useState<{ done: number; total: number } | null>(null);
  const ammoRun = useRef(0);

  useEffect(() => { void getEsfData().then((d) => setData(d as unknown as DogmaLookup)).catch(() => {}); }, []);

  // `data` is a dependency, not an afterthought: the ammo pairing needs dogma,
  // so the fit is re-parsed once the bundle lands and the stats recompute with
  // the guns loaded
  const entryParse = useMemo(() => parseEntry(entry, data), [entry, data]);
  const parsed = entryParse.fit;
  const cmpParsed = useMemo(() => (compare ? parseEntry(compare, data).fit : null), [compare, data]);

  /**
   * THE INTEGRITY GATE the rest of the app already applies (Fit Skill Maxer
   * and the Fit Wizard both do this): parseFit DROPS a line it cannot
   * resolve and records it in `unresolved`. The dogma engine then happily
   * computes a complete-looking fit that is quietly missing a module —
   * plausible CPU/PG/EHP/DPS for a fit that would not even fit in game.
   * Numbers are withheld rather than shown wrong.
   */
  const withheld = parsed.unresolved.length > 0 ? parsed.unresolved : null;
  const cmpWithheld = cmpParsed && cmpParsed.unresolved.length > 0 ? cmpParsed.unresolved : null;

  // base stats for A and B
  useEffect(() => {
    let live = true;
    setError(null);
    setStats(null);
    void calculateFitStats(parsed, char?.skills ?? null, char?.implants ?? null, { propRunning })
      .then((s) => { if (live) setStats(s); })
      .catch((e) => { if (live) setError(e instanceof Error ? e.message : String(e)); });
    return () => { live = false; };
  }, [parsed, char?.skills, char?.implants, propRunning]);

  useEffect(() => {
    let live = true;
    setCmpStats(null);
    if (!cmpParsed) return;
    void calculateFitStats(cmpParsed, char?.skills ?? null, char?.implants ?? null, { propRunning })
      .then((s) => { if (live) setCmpStats(s); })
      .catch(() => { if (live) setCmpStats(null); });
    return () => { live = false; };
  }, [cmpParsed, char?.skills, char?.implants, propRunning]);

  // weapons that take ammo
  const weapons = useMemo(() => {
    if (!data) return [];
    return ammoWeapons(data, parsed.items.map((i) => ({ typeId: i.typeId, qty: i.qty })));
  }, [data, parsed]);

  /**
   * INVALIDATE any in-flight sweep whenever what it was computed FOR
   * changes. Every one of these inputs is captured by the running loop, so
   * without this the loop keeps writing the OLD fit's numbers into a table
   * captioned with the new fit's name.
   *
   * Clearing ammoBusy here is load-bearing, not tidiness: the loop only
   * clears it for a run that is still current, while the button that would
   * start a new run is disabled precisely while it is non-null — so bumping
   * the run counter alone would leave the tab deadlocked forever.
   */
  useEffect(() => {
    ammoRun.current++;
    setAmmoRows(null);
    setAmmoStamp(null);
    setAmmoBusy(null);
  }, [entry.key, weaponId, char?.characterId, char?.skills, char?.implants]);

  useEffect(() => {
    setWeaponId(weapons.length > 0 ? weapons[0].typeId : null);
  }, [weapons]);

  /** compute the fit's numbers once per compatible charge. Sequential and
   * genuinely cancellable — 50 engine runs must not lock the window, and a
   * superseded run must never reach the screen. */
  async function runAmmo(wid: number) {
    if (!data) return;
    const run = ++ammoRun.current;
    const stamp: AmmoStamp = { entryKey: entry.key, weaponId: wid, charId: char?.characterId ?? null };
    const charges = chargesForAll(data, [wid]);
    const fit = parsed;
    const skills = char?.skills ?? null;
    const implants = char?.implants ?? null;
    setAmmoRows([]);
    setAmmoStamp(stamp);
    setAmmoBusy({ done: 0, total: charges.length });
    const rows: AmmoRow[] = [];
    let skipped = 0;
    for (let i = 0; i < charges.length; i++) {
      if (ammoRun.current !== run) return; // superseded before starting this charge
      const cid = charges[i];
      try {
        const s = await calculateFitStats(withAmmo(fit, wid, cid), skills, implants);
        // RE-CHECK AFTER THE AWAIT: the engine run takes real time, and the
        // selection can change while it is in flight
        if (ammoRun.current !== run) return;
        const line = s.summary.weapons.find((w) => w.typeId === wid);
        rows.push({
          chargeId: cid,
          name: typeNameOf(cid),
          dps: s.summary.dps,
          volley: s.summary.volley,
          range: line?.missileRange ?? (line?.optimal !== undefined ? line.optimal + (line.falloff ?? 0) : undefined),
        });
      } catch {
        skipped++; // a charge the engine can't model is SKIPPED, never shown as zero
      }
      if (i % 4 === 3 || i === charges.length - 1) {
        if (ammoRun.current !== run) return;
        setAmmoRows([...rows].sort((a, b) => b.dps - a.dps));
        setAmmoBusy({ done: i + 1, total: charges.length });
        await new Promise((r) => setTimeout(r, 0)); // let the UI paint
      }
    }
    if (ammoRun.current !== run) return;
    setAmmoBusy(null);
    setAmmoSkipped(skipped);
  }

  /** charges the engine could not model — reported rather than hidden, so a
   * short table is never mistaken for "these are all the options" */
  const [ammoSkipped, setAmmoSkipped] = useState(0);

  const modulesByRack = useMemo(() => {
    const byRack = new Map<string, { name: string; qty: number }[]>();
    for (const it of entry.items as RawFitItem[]) {
      const rack = rackOf(it.flag);
      const list = byRack.get(rack) ?? [];
      list.push({ name: typeNameOf(it.type_id), qty: Math.max(1, it.quantity) });
      byRack.set(rack, list);
    }
    const ORDER = ['HiSlot', 'MedSlot', 'LoSlot', 'RigSlot', 'SubSystemSlot', 'ServiceSlot', 'DroneBay', 'FighterBay', 'Cargo', 'Invalid'];
    return [...byRack.entries()].sort((a, b) => {
      const ia = ORDER.indexOf(a[0]); const ib = ORDER.indexOf(b[0]);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
  }, [entry]);

  const diffRows = useMemo(
    () => (compare ? moduleDiff(entry.items as RawFitItem[], compare.items as RawFitItem[], rackOf, typeNameOf) : []),
    [entry, compare]);
  const statRows = useMemo(() => (stats && cmpStats ? statDiff(stats, cmpStats) : []), [stats, cmpStats]);

  /** the numbers, or null when they must not be shown at all */
  const st = withheld ? null : stats;
  const S = st?.summary;

  return (
    <div className="insp">
      <div className="insp-head">
        <div className="insp-title">
          <b>{entry.name}</b> <span className="dim">· {entry.hullName}</span>
        </div>
        <label className="insp-char">
          skills of
          <select value={char?.characterId ?? ''} onChange={(e) => setCharId(Number(e.target.value))}>
            {characters.map((c) => <option key={c.characterId} value={c.characterId}>{c.characterName}</option>)}
          </select>
        </label>
      </div>

      {error && <div className="fitlib-warn">⚠ {error}</div>}

      {st && S && (
        <div className="insp-stats">
          <span title={S.dpsSustained < S.dps - 0.05
            ? `${nd(S.dpsSustained, 1)} dps once reloading is counted`
            : 'nothing in this fit reloads'}>
            <i>DPS</i> {nd(S.dps, 1)}
            {S.dpsSustained < S.dps - 0.05 && <span className="dim"> / {nd(S.dpsSustained, 1)} sust</span>}
          </span>
          <span><i>Volley</i> {n0(S.volley)}</span>
          <span><i>EHP</i> {n0(S.ehp)}</span>
          <span><i>Speed</i> {n0(S.maxVelocity)} m/s</span>
          <span><i>Align</i> {nd(S.alignTime, 2)} s</span>
          <span><i>Lock</i> {km(S.targetRange)}</span>
          <span><i>Sig</i> {n0(S.signatureRadius)} m</span>
          <span className={st.cpu.load > st.cpu.output ? 'over' : ''}>
            <i>CPU</i> {nd(st.cpu.output - st.cpu.load, 1)} left
          </span>
          <span className={st.power.load > st.power.output ? 'over' : ''}>
            <i>PG</i> {nd(st.power.output - st.power.load, 1)} left
          </span>
          <span><i>Cap</i> {st.cap.peakDelta >= 0 ? 'stable' : `${nd(st.cap.depletesIn / 60, 1)} min`}</span>
        </div>
      )}
      {/* WHERE THE AMMO CAME FROM. EVE stores a saved fit's ammo as loose
          cargo, so the gun↔charge link is inferred from dogma here. Saying so
          matters: these numbers are a reconstruction, not something ESI
          returned, and the user must be able to tell the difference. */}
      {st && entryParse.inferred.length > 0 && (
        <div className="insp-note">
          Ammo pairing inferred: {entryParse.inferred
            .map((r) => `${typeNameOf(r.chargeTypeId)} ×${r.count} → ${typeNameOf(r.moduleTypeId)}`)
            .join(', ')}. EVE does not record which gun holds which charge; dogma left only this
          answer. Use the Ammo tab to score any other compatible charge.
        </div>
      )}
      {st && entryParse.ambiguous.length > 0 && (
        <div className="insp-note insp-nodps">
          Ammo NOT loaded — the fit carries {entryParse.ambiguous.map((a) => typeNameOf(a.chargeTypeId)).join(' and ')},
          and {entryParse.ambiguous[0].reason}. Loading a guess would invent a damage type, so the
          guns are scored empty. Use the Ammo tab to pick one.
        </div>
      )}
      {st && S && S.dps === 0 && weapons.length > 0 && entryParse.ambiguous.length === 0 && (
        <div className="insp-note insp-nodps">
          DPS reads 0 because this fit carries no ammo for its weapons — a saved fit records the
          modules, and there was no charge in it to place. Use the Ammo tab for damage per charge.
        </div>
      )}
      {st && st.nonFit.length > 0 && (
        <div className="insp-note">
          Not counted as fitted (cargo/spares): {st.nonFit.slice(0, 6).join(', ')}
          {st.nonFit.length > 6 ? ` +${st.nonFit.length - 6} more` : ''}
        </div>
      )}
      {withheld && (
        <div className="fitlib-warn">
          ⚠ Fitting stats withheld: {withheld.length} line(s) could not be resolved
          ({withheld.slice(0, 3).join(', ')}{withheld.length > 3 ? '…' : ''}).
          A fit that is quietly missing a module produces numbers that look right and are not.
        </div>
      )}
      {!S && !error && !withheld && <div className="insp-loading">computing…</div>}

      <label className="prop-toggle" title="Propulsion modules cycling. Off = fitted and powered but not running: lower signature and speed, less capacitor drain. ESI cannot record this, so saved fits default to running.">
        <input type="checkbox" checked={propRunning}
          onChange={(e) => {
            setPropRunning(e.target.checked);
            logUser('inspector: prop modules ' + (e.target.checked ? 'RUNNING' : 'off'), { fit: entry.name });
          }} />
        propulsion running
      </label>
      <div className="insp-tabs">
        <button className={tab === 'modules' ? 'on' : ''} onClick={() => setTab('modules')}>Modules</button>
        <button className={tab === 'ammo' ? 'on' : ''} onClick={() => setTab('ammo')}>
          Ammo{weapons.length === 0 ? ' (none)' : ''}
        </button>
        <button className={tab === 'sim' ? 'on' : ''} onClick={() => setTab('sim')} disabled={!st}>
          Applied damage
        </button>
        <button className={tab === 'diff' ? 'on' : ''} onClick={() => setTab('diff')} disabled={!compare}>
          Compare{compare ? ` → ${compare.name}` : ''}
        </button>
      </div>

      {tab === 'sim' && st && (
        <div className="insp-body"><SimPanel stats={st} /></div>
      )}

      {tab === 'modules' && (
        <div className="insp-body">
          {modulesByRack.map(([rack, list]) => (
            <div key={rack} className="insp-rack">
              <div className="insp-rack-name">{rack.replace('Slot', '')}</div>
              {list.map((m, i) => (
                <div key={`${m.name}-${i}`} className="insp-mod">{m.qty > 1 ? `${m.qty}× ` : ''}{m.name}</div>
              ))}
            </div>
          ))}
          {S && S.weapons.length > 0 && (
            <div className="insp-rack">
              <div className="insp-rack-name">Weapons</div>
              {S.weapons.map((w, i) => (
                <div key={`${w.typeId}-${i}`} className="insp-mod">
                  {typeNameOf(w.typeId)} — {nd(w.dps, 1)} dps
                  {w.dpsSustained !== undefined && ` (${nd(w.dpsSustained, 1)} with reload)`}
                  {w.chargeTypeId ? ` · ${typeNameOf(w.chargeTypeId)}` : ''}
                  {w.missileRange !== undefined ? ` · ${km(w.missileRange)}` : ''}
                  {w.optimal !== undefined ? ` · ${km(w.optimal)}${w.falloff ? ` +${km(w.falloff)}` : ''}` : ''}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === 'ammo' && (
        <div className="insp-body">
          {withheld ? (
            <div className="insp-loading">Ammo comparison needs a fully resolved fit — see the warning above.</div>
          ) : weapons.length === 0 ? (
            <div className="insp-loading">No weapon in this fit takes a charge.</div>
          ) : (
            <>
              <div className="insp-ammo-head">
                <select value={weaponId ?? ''} onChange={(e) => { setWeaponId(Number(e.target.value)); setAmmoRows(null); }}>
                  {weapons.map((w) => <option key={w.typeId} value={w.typeId}>{w.qty}× {w.name}</option>)}
                </select>
                <button className="btn" disabled={weaponId === null || ammoBusy !== null}
                  onClick={() => weaponId !== null && void runAmmo(weaponId)}>
                  {ammoBusy ? `computing ${ammoBusy.done}/${ammoBusy.total}…` : 'Compare every compatible ammo'}
                </button>
              </div>
              <div className="insp-note">
                Whole-fit numbers with that ammo loaded in every copy of the selected weapon, using {char?.characterName ?? 'no'} skills.
              </div>
              {ammoRows && ammoRows.length > 0 && weaponId !== null
                && sameStamp(ammoStamp, { entryKey: entry.key, weaponId, charId: char?.characterId ?? null }) && (
                <table className="fitlib-table insp-ammo">
                  <thead><tr><th>Ammo</th><th className="c-num">Fit DPS</th><th className="c-num">Volley</th><th className="c-num">Range</th></tr></thead>
                  <tbody>
                    {ammoRows.map((r) => (
                      <tr key={r.chargeId}>
                        <td>{r.name}</td>
                        <td className="c-num">{nd(r.dps, 1)}</td>
                        <td className="c-num">{n0(r.volley)}</td>
                        <td className="c-num">{km(r.range)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {ammoSkipped > 0 && ammoBusy === null && (
                <div className="insp-note">
                  {ammoSkipped} charge(s) the dogma engine could not model are omitted — not shown as zero.
                </div>
              )}
            </>
          )}
        </div>
      )}

      {tab === 'diff' && compare && (
        <div className="insp-body">
          <div className="insp-ammo-head">
            <span className="dim">A: <b>{entry.name}</b> → B: <b>{compare.name}</b></span>
            <button className="btn" onClick={onClearCompare}>clear</button>
          </div>
          {cmpWithheld && (
            <div className="fitlib-warn">
              ⚠ Stat comparison withheld: the other fit has {cmpWithheld.length} unresolved line(s), so its
              numbers would be computed from an incomplete fit. The module differences below are still exact.
            </div>
          )}
          {!cmpStats && !cmpWithheld && <div className="insp-loading">computing the other fit…</div>}
          {!withheld && !cmpWithheld && statRows.length > 0 && (
            <table className="fitlib-table insp-diff">
              <thead><tr><th>Stat</th><th className="c-num">A</th><th className="c-num">B</th><th className="c-num">Δ</th></tr></thead>
              <tbody>
                {statRows.map((r) => {
                  const v = verdictOf(r);
                  return (
                    <tr key={r.label}>
                      <td>{r.label}</td>
                      <td className="c-num">{nd(r.a, r.digits)}{r.unit}</td>
                      <td className="c-num">{nd(r.b, r.digits)}{r.unit}</td>
                      <td className={`c-num ${v === 'better' ? 'd-up' : v === 'worse' ? 'd-down' : 'd-same'}`}>
                        {v === null ? '—' : `${r.delta > 0 ? '+' : ''}${nd(r.delta, r.digits)}${r.unit}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="insp-rack-name" style={{ marginTop: 10 }}>Module differences</div>
          {diffRows.length === 0 ? (
            <div className="insp-loading">Identical modules — only the name differs.</div>
          ) : (
            <table className="fitlib-table insp-diff">
              <thead><tr><th>Slot</th><th>Module</th><th className="c-num">A</th><th className="c-num">B</th></tr></thead>
              <tbody>
                {diffRows.map((r) => (
                  <tr key={`${r.rack}-${r.typeId}`}>
                    <td className="dim">{r.rack.replace('Slot', '')}</td>
                    <td>{r.name}</td>
                    <td className={`c-num ${r.a === 0 ? 'd-down' : ''}`}>{r.a || '—'}</td>
                    <td className={`c-num ${r.b === 0 ? 'd-down' : 'd-up'}`}>{r.b || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
