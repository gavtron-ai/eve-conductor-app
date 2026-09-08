// WEAPON + AMMO TABLES (v0.195) — the numbers a fitter changes modules and
// charges to move, laid out so they can be READ, not hovered for.
//
// WeaponTable: one row per fitted weapon group (type + loaded charge) —
// DPS, alpha, range (optimal + falloff for turrets, flight ceiling for
// missiles), tracking / explosion, damage split. All from the same engine
// pass the panel above uses (stats.simWeapons), so nothing can disagree.
//
// AmmoTable: for each charge-taking weapon type on the fit, EVERY loadable
// damage charge computed by the engine with that charge loaded across the
// group — dps, alpha, range, damage split — so "what does Scorch do to my
// range" is a glance, not a refit. Computed ON DEMAND (open the section):
// each row is an engine pass (~30 ms), run sequentially and cancellable.
import { useEffect, useMemo, useRef, useState } from 'react';
import { getType } from '../lib/typedb';
import { calculateFitStats, getEsfData, type FitStats } from '../lib/dogmaStats';
import { totalDamage, DAMAGE_TYPES, type SimWeapon, type Damage } from '../lib/fitSim';
import { compatibleCharges, takesCharges, chargeDealsDamage, withAmmoMap, type DogmaLookup } from '../lib/fitCharges';
import type { ParsedFit } from '../lib/skillRelevance';
import Tip from './Tip';

const km = (m: number | undefined) =>
  (m === undefined ? '—' : `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: m < 10_000 ? 2 : 1 })} km`);
const n1 = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 1 });
const n0 = (x: number) => x.toLocaleString(undefined, { maximumFractionDigits: 0 });
const DMG_COLOR: Record<string, string> = { em: '#4c9de8', thermal: '#e05252', kinetic: '#9aa5b1', explosive: '#e6a23c' };
const DMG_SHORT: Record<string, string> = { em: 'EM', thermal: 'TH', kinetic: 'KIN', explosive: 'EXP' };

/** damage split as coloured type tags with ink percentages */
function DmgSplit({ d }: { d: Damage }) {
  const t = totalDamage(d);
  if (t <= 0) return <span className="dim">—</span>;
  return (
    <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
      {DAMAGE_TYPES.filter((k) => d[k] > 0).map((k) => (
        <span key={k} style={{ marginRight: 6 }}>
          <span style={{ color: DMG_COLOR[k], fontSize: 10 }}>{DMG_SHORT[k]}</span> {Math.round((d[k] / t) * 100)}%
        </span>
      ))}
    </span>
  );
}

interface Group { key: string; typeId: number; chargeTypeId?: number; kind: SimWeapon['kind']; count: number; w: SimWeapon }

/** fold the per-slot simWeapons into groups by (type, charge), highest
 * group dps first — the per-slot list is what the simulation needs; a
 * fitter reads it per group */
function groupWeapons(list: SimWeapon[]): Group[] {
  const m = new Map<string, Group>();
  for (const w of list) {
    const key = `${w.typeId}:${w.chargeTypeId ?? ''}`;
    const g = m.get(key);
    if (g) g.count++; else m.set(key, { key, typeId: w.typeId, chargeTypeId: w.chargeTypeId, kind: w.kind, count: 1, w });
  }
  const gdps = (g: Group) => (totalDamage(g.w.volley) / g.w.cycleSeconds) * g.count;
  return [...m.values()].sort((a, b) => gdps(b) - gdps(a));
}

const rangeCell = (w: SimWeapon) =>
  w.kind === 'missile'
    ? <>{km(w.maxRange)} <span className="dim" style={{ fontSize: 10 }}>flight</span></>
    : w.kind === 'drone'
      ? <span className="dim">control range</span>
      : <>{km(w.optimal)} <span className="dim">+ {km(w.falloff)}</span></>;

const applicationCell = (w: SimWeapon) =>
  w.kind === 'missile'
    ? <>{n0(w.expRadius ?? 0)} m · {n0(w.expVelocity ?? 0)} m/s</>
    : w.kind === 'turret'
      ? <>{(w.tracking ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })} <span className="dim">tracking</span></>
      : <span className="dim">—</span>;

export function WeaponTable({ stats }: { stats: FitStats }) {
  const groups = useMemo(() => groupWeapons(stats.simWeapons), [stats]);
  if (groups.length === 0) return null;
  return (
    <table className="data" style={{ marginTop: 6 }}>
      <thead>
        <tr>
          <th>Weapon</th>
          <th><Tip tip="Damage per second for the whole group, every listed weapon firing, no reload.">DPS</Tip></th>
          <th><Tip tip="One full volley from the whole group — the number that decides whether a target survives the first cycle.">Alpha</Tip></th>
          <th><Tip tip="Turrets: optimal + falloff (half damage at optimal+falloff). Missiles: the flight ceiling — a missile past it simply never arrives.">Range</Tip></th>
          <th><Tip tip="Turrets: tracking speed. Missiles: explosion radius and velocity — how well the damage applies to small, fast targets.">Application</Tip></th>
          <th>Damage</th>
        </tr>
      </thead>
      <tbody>
        {groups.map((g) => {
          const dps = (totalDamage(g.w.volley) / g.w.cycleSeconds) * g.count;
          const alpha = totalDamage(g.w.volley) * g.count;
          return (
            <tr key={g.key}>
              <td className="hub-name">
                {g.count}× {getType(g.typeId)?.name ?? g.typeId}
                {g.chargeTypeId !== undefined && (
                  <div className="dim" style={{ fontSize: 11 }}>{getType(g.chargeTypeId)?.name ?? g.chargeTypeId}</div>
                )}
              </td>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{n1(dps)}</td>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{n0(alpha)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{rangeCell(g.w)}</td>
              <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{applicationCell(g.w)}</td>
              <td><DmgSplit d={g.w.volley} /></td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

interface AmmoRow { chargeId: number; dps: number; alpha: number; w: SimWeapon | null }

/** every loadable damage charge for one weapon type, engine-computed with
 * that charge loaded across the whole group */
function AmmoRows({ fit, weaponTypeId, count, loaded, skills, implants, propRunning }: {
  fit: ParsedFit; weaponTypeId: number; count: number; loaded?: number;
  skills: Record<number, number>; implants: number[] | null; propRunning: boolean;
}) {
  const [rows, setRows] = useState<AmmoRow[] | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 0]);
  const run = useRef(0);
  // RESTART ONLY WHEN THE INPUTS ACTUALLY CHANGE. The first version keyed
  // this effect on object identity (fit, implants, skills) — the parent
  // re-renders while the engine runs (stats landing, hover state, the pod
  // override producing a fresh array every render), each re-render was a
  // "new" input, the compute restarted, the table regrew, the scrollbar
  // thrashed: the loop the owner saw. Fingerprint the inputs instead and
  // read the live objects through refs when the loop runs.
  const inputKey = [
    fit.shipId, weaponTypeId, count, propRunning ? 1 : 0,
    fit.items.map((i) => `${i.typeId}:${i.qty}:${i.offlineQty}:${i.charges.join('/')}`).join(','),
    (implants ?? []).join('.'),
    Object.keys(skills).length, // a resync replaces the object; levels moving is rare mid-view
  ].join('|');
  const live = useRef({ fit, skills, implants, propRunning });
  live.current = { fit, skills, implants, propRunning };
  useEffect(() => {
    const mine = ++run.current;
    setRows(null);
    const { fit: f, skills: sk, implants: imp, propRunning: prop } = live.current;
    void (async () => {
      const data = await getEsfData();
      const lookup = data as unknown as DogmaLookup;
      const ids = compatibleCharges(lookup, weaponTypeId)
        .filter((id) => chargeDealsDamage(lookup, id))
        .sort((a, b) => (getType(a)?.name ?? '').localeCompare(getType(b)?.name ?? '', undefined, { numeric: true }));
      setProgress([0, ids.length]);
      const out: AmmoRow[] = [];
      for (const chargeId of ids) {
        if (run.current !== mine) return;
        try {
          const st = await calculateFitStats(withAmmoMap(f, { [weaponTypeId]: chargeId }), sk, imp, { propRunning: prop });
          const w = st.simWeapons.find((x) => x.typeId === weaponTypeId) ?? null;
          out.push({
            chargeId,
            dps: w ? (totalDamage(w.volley) / w.cycleSeconds) * count : 0,
            alpha: w ? totalDamage(w.volley) * count : 0,
            w,
          });
        } catch {
          out.push({ chargeId, dps: 0, alpha: 0, w: null });
        }
        if (run.current !== mine) return;
        setProgress([out.length, ids.length]);
        setRows([...out]);
      }
    })();
    return () => { run.current++; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inputKey, weaponTypeId, count]);

  if (rows === null) return <div className="hint">computing {progress[1] || '…'} charges…</div>;
  return (
    <>
      <table className="data" style={{ marginTop: 4 }}>
        <thead>
          <tr><th>Charge</th><th>DPS</th><th>Alpha</th><th>Range</th><th>Application</th><th>Damage</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.chargeId} style={r.chargeId === loaded ? { background: 'rgba(216,178,92,.10)', fontWeight: 600 } : undefined}>
              <td className="hub-name">
                {getType(r.chargeId)?.name ?? r.chargeId}
                {r.chargeId === loaded && <span className="dim"> · loaded</span>}
              </td>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.w ? n1(r.dps) : <span className="dim">—</span>}</td>
              <td style={{ fontVariantNumeric: 'tabular-nums' }}>{r.w ? n0(r.alpha) : <span className="dim">—</span>}</td>
              <td style={{ whiteSpace: 'nowrap' }}>{r.w ? rangeCell(r.w) : <span className="dim">—</span>}</td>
              <td style={{ whiteSpace: 'nowrap', fontSize: 12 }}>{r.w ? applicationCell(r.w) : <span className="dim">—</span>}</td>
              <td>{r.w ? <DmgSplit d={r.w.volley} /> : <span className="dim">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {progress[0] < progress[1] && <div className="hint">{progress[0]} / {progress[1]} computed…</div>}
    </>
  );
}

export function AmmoTables({ stats, fit, skills, implants, propRunning }: {
  stats: FitStats; fit: ParsedFit; skills: Record<number, number>; implants: number[] | null; propRunning: boolean;
}) {
  const [lookup, setLookup] = useState<DogmaLookup | null>(null);
  useEffect(() => {
    void getEsfData().then((d) => setLookup(d as unknown as DogmaLookup)).catch(() => {});
  }, []);
  const groups = useMemo(() => {
    if (!lookup) return [];
    const byType = new Map<number, { count: number; loaded?: number }>();
    for (const w of stats.simWeapons) {
      if (w.kind === 'drone' || !takesCharges(lookup, w.typeId)) continue;
      const g = byType.get(w.typeId);
      if (g) g.count++; else byType.set(w.typeId, { count: 1, loaded: w.chargeTypeId });
    }
    return [...byType.entries()];
  }, [stats, lookup]);
  if (groups.length === 0) return null;
  return (
    <>
      {groups.map(([typeId, g]) => (
        <details key={typeId} style={{ marginTop: 8 }}>
          <summary style={{ cursor: 'pointer', fontSize: 12.5 }}>
            Ammo for {g.count}× {getType(typeId)?.name ?? typeId}
            <span className="dim"> — every loadable charge, engine-computed (open to run)</span>
          </summary>
          <AmmoRows fit={fit} weaponTypeId={typeId} count={g.count} loaded={g.loaded}
            skills={skills} implants={implants} propRunning={propRunning} />
        </details>
      ))}
      <div className="hint" style={{ marginTop: 4 }}>
        Ammo rows are computed with modules at their default run state (prop as toggled above);
        overheat is not folded in, so the loaded row can differ slightly from overheated figures
        above.
      </div>
    </>
  );
}
