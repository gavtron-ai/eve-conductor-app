// APPLIED DAMAGE — the pyfa-style graphs, against a target you describe.
//
// Everything above this panel reports what a fit EMITS. This one reports what
// it LANDS: the same volley meets a signature, a speed, a range and a set of
// resistances, and most of it can miss. A 1400mm artillery Tempest and a
// 220mm autocannon Tempest have similar paper DPS and could not be more
// different against an orbiting frigate — that gap is the whole point.
//
// The curves are computed from the SAME engine pass the stats panel uses
// (FitStats.simWeapons), so a number here can never disagree with the number
// above it. All arithmetic lives in lib/fitSim.ts and is fixture-verified.
import { useMemo, useState } from 'react';
import {
  appliedDps, rangeCurve, transversalCurve, signatureCurve, layerEhp,
  DAMAGE_PROFILES, DAMAGE_TYPES, NO_RESISTS,
  type SimTarget, type SimWeapon, type CurvePoint, type Damage,
} from '../lib/fitSim';
import type { FitStats } from '../lib/dogmaFit';
import { typeNameOf } from '../lib/fitSerial';

/** Preset targets, from the real hull attributes in the shipped bundle
 * (Rifter sig 35 / 365 m/s, Vexor 145 / 195, Raven 410 / 113). Resistances
 * are left at zero deliberately: a T1 hull's own resists are near enough to
 * nothing, and inventing a tanked target would flatter every fit equally. */
const TARGETS: { name: string; signatureRadius: number; velocity: number }[] = [
  { name: 'Frigate', signatureRadius: 35, velocity: 365 },
  { name: 'Frigate (MWD)', signatureRadius: 175, velocity: 1800 },
  { name: 'Destroyer', signatureRadius: 65, velocity: 320 },
  { name: 'Cruiser', signatureRadius: 145, velocity: 195 },
  { name: 'Battlecruiser', signatureRadius: 285, velocity: 150 },
  { name: 'Battleship', signatureRadius: 410, velocity: 113 },
  { name: 'Freighter', signatureRadius: 3000, velocity: 100 },
];

type Axis = 'range' | 'transversal' | 'signature';
const AXIS_LABEL: Record<Axis, string> = {
  range: 'Range to target',
  transversal: 'Target transversal',
  signature: 'Target signature',
};

const n0 = (v: number) => Math.round(v).toLocaleString();
const n1 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const km = (m: number) => (m >= 1000 ? `${n1(m / 1000)} km` : `${n0(m)} m`);
const pct = (v: number) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;

/** a small pure SVG line chart — no dependency, no canvas, scales to the box */
function Chart({ series, xLabel, yLabel, marker, formatX }: {
  series: { name: string; colour: string; points: CurvePoint[]; dashed?: boolean }[];
  xLabel: string;
  yLabel: string;
  /** the x value the readout below is describing, drawn as a vertical rule */
  marker?: number;
  formatX: (v: number) => string;
}) {
  const W = 720, H = 260, PAD_L = 56, PAD_B = 34, PAD_T = 12, PAD_R = 12;
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return null;
  const xMax = Math.max(...all.map((p) => p.x)) || 1;
  const yMax = Math.max(...all.map((p) => p.y)) || 1;
  // a y-axis that ends on a round number reads far better than one ending on 487.3
  const step = Math.pow(10, Math.floor(Math.log10(yMax))) / 2;
  const yTop = Math.max(step, Math.ceil(yMax / step) * step);

  const sx = (x: number) => PAD_L + (x / xMax) * (W - PAD_L - PAD_R);
  const sy = (y: number) => H - PAD_B - (y / yTop) * (H - PAD_B - PAD_T);
  const path = (pts: CurvePoint[]) =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yTop);
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * xMax);

  return (
    <svg className="sim-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${yLabel} against ${xLabel}`}>
      {yTicks.map((v) => (
        <g key={`y${v}`}>
          <line x1={PAD_L} x2={W - PAD_R} y1={sy(v)} y2={sy(v)} stroke="var(--grid)" strokeWidth="1" />
          <text x={PAD_L - 8} y={sy(v) + 4} textAnchor="end" className="sim-tick">{n0(v)}</text>
        </g>
      ))}
      {xTicks.map((v) => (
        <text key={`x${v}`} x={sx(v)} y={H - PAD_B + 16} textAnchor="middle" className="sim-tick">
          {formatX(v)}
        </text>
      ))}
      {marker !== undefined && marker <= xMax && (
        <line x1={sx(marker)} x2={sx(marker)} y1={PAD_T} y2={H - PAD_B}
          stroke="var(--ink-2)" strokeWidth="1" strokeDasharray="3 3" />
      )}
      {series.map((s) => (
        <path key={s.name} d={path(s.points)} fill="none" stroke={s.colour} strokeWidth="2"
          strokeDasharray={s.dashed ? '5 4' : undefined} />
      ))}
      <line x1={PAD_L} x2={W - PAD_R} y1={sy(0)} y2={sy(0)} stroke="var(--baseline)" strokeWidth="1" />
      <line x1={PAD_L} x2={PAD_L} y1={PAD_T} y2={H - PAD_B} stroke="var(--baseline)" strokeWidth="1" />
      <text x={PAD_L} y={H - 4} className="sim-axis">{xLabel}</text>
      <text x={4} y={PAD_T + 4} className="sim-axis">{yLabel}</text>
    </svg>
  );
}

export default function SimPanel({ stats }: { stats: FitStats }) {
  const [targetIdx, setTargetIdx] = useState(3); // Cruiser
  const [sig, setSig] = useState<number | null>(null);
  const [vel, setVel] = useState<number | null>(null);
  const [axis, setAxis] = useState<Axis>('range');
  const [distance, setDistance] = useState(10000);
  const [transversal, setTransversal] = useState(0);
  const [profileIdx, setProfileIdx] = useState(0);

  const preset = TARGETS[targetIdx];
  const target: SimTarget = {
    name: preset.name,
    signatureRadius: sig ?? preset.signatureRadius,
    velocity: vel ?? preset.velocity,
    resonance: NO_RESISTS,
  };

  const weapons: SimWeapon[] = stats.simWeapons;

  // how far out the range graph should reach: past everything that can shoot,
  // so the falloff tail is visible rather than cropped
  const maxRange = useMemo(() => {
    const reach = weapons.map((w) =>
      w.kind === 'missile' ? (w.maxRange ?? 0) : (w.optimal ?? 0) + 3 * (w.falloff ?? 0));
    return Math.max(20000, Math.ceil((Math.max(0, ...reach) * 1.1) / 5000) * 5000);
  }, [weapons]);

  const here = appliedDps(weapons, target, { distance, transversal });

  const points = useMemo(() => {
    if (weapons.length === 0) return [];
    if (axis === 'range') return rangeCurve(weapons, target, { maxRange, transversal, steps: 120 });
    if (axis === 'transversal') {
      return transversalCurve(weapons, target, { distance, maxTransversal: 3000, steps: 120 });
    }
    return signatureCurve(weapons, target, { distance, transversal, maxSig: 1000, steps: 120 });
  }, [weapons, axis, maxRange, transversal, distance, target.signatureRadius, target.velocity]);

  const axisMax = axis === 'range' ? maxRange : axis === 'transversal' ? 3000 : 1000;
  const marker = axis === 'range' ? distance : axis === 'transversal' ? transversal : target.signatureRadius;
  const formatX = axis === 'signature' ? (v: number) => `${n0(v)} m`
    : axis === 'transversal' ? (v: number) => `${n0(v)} m/s` : km;

  const profile = DAMAGE_PROFILES[profileIdx].damage;
  const tank = {
    shield: layerEhp(stats.summary.shieldHp, stats.resonance.shield, profile),
    armor: layerEhp(stats.summary.armorHp, stats.resonance.armor, profile),
    structure: layerEhp(stats.summary.structureHp, stats.resonance.structure, profile),
  };
  const tankTotal = tank.shield + tank.armor + tank.structure;

  if (weapons.length === 0) {
    return (
      <div className="sim-panel">
        <div className="hint">
          Nothing in this fit deals damage with the weapons active, so there is no application to
          simulate. Turrets and launchers score zero until they are loaded — check the ammo note above.
        </div>
      </div>
    );
  }

  return (
    <div className="sim-panel">
      <div className="sim-controls">
        <label>
          Target
          <select value={targetIdx} onChange={(e) => { setTargetIdx(Number(e.target.value)); setSig(null); setVel(null); }}>
            {TARGETS.map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}
          </select>
        </label>
        <label>
          Signature
          <input type="number" min={1} value={Math.round(target.signatureRadius)}
            onChange={(e) => setSig(Math.max(1, Number(e.target.value)))} />
          <span className="sim-unit">m</span>
        </label>
        <label>
          Speed
          <input type="number" min={0} value={Math.round(target.velocity)}
            onChange={(e) => setVel(Math.max(0, Number(e.target.value)))} />
          <span className="sim-unit">m/s</span>
        </label>
        <div className="sim-axis-pick">
          {(['range', 'transversal', 'signature'] as Axis[]).map((a) => (
            <button key={a} className={`btn mini${axis === a ? ' on' : ''}`} onClick={() => setAxis(a)}>
              vs {a}
            </button>
          ))}
        </div>
      </div>

      <Chart
        xLabel={AXIS_LABEL[axis]}
        yLabel="Applied DPS"
        marker={marker}
        formatX={formatX}
        series={[
          { name: 'applied', colour: 'var(--accent)', points },
          // the paper number as a flat reference: the gap between the two IS
          // the story, and without it a curve peaking at 180 looks fine until
          // you notice the fit emits 600
          { name: 'emitted', colour: 'var(--muted)', dashed: true,
            points: [{ x: 0, y: here.raw }, { x: axisMax, y: here.raw }] },
        ]}
      />

      <div className="sim-sliders">
        <label>
          Range <b>{km(distance)}</b>
          <input type="range" min={0} max={maxRange} step={250} value={Math.min(distance, maxRange)}
            onChange={(e) => setDistance(Number(e.target.value))} />
        </label>
        <label>
          Transversal <b>{n0(transversal)} m/s</b>
          <input type="range" min={0} max={3000} step={25} value={transversal}
            onChange={(e) => setTransversal(Number(e.target.value))} />
        </label>
      </div>

      <div className="sim-readout">
        {/* time to LOCK this target — the client's own identity:
            40000 ÷ (scanRes × asinh(sig)²), with this fit's computed scan
            resolution (sensor boosters included, skills included) */}
        {stats.summary.scanResolution > 0 && (
          <span title={`Time to lock a ${n0(target.signatureRadius)} m signature with this fit's ${n0(stats.summary.scanResolution)} mm scan resolution — 40000 ÷ (scanRes × asinh(sig)²), the client's own lock-time formula. Remote sensor boosts/dampeners are not modelled.`}>
            <i>Lock time</i> {(40000 / (stats.summary.scanResolution * Math.asinh(target.signatureRadius) ** 2)).toFixed(1)} s
          </span>
        )}
        <span><i>Applied</i> {n0(here.applied)} dps</span>
        {here.appliedSustained < here.applied - 0.05 && (
          <span title="the same, once each weapon's reload is amortised">
            <i>Sustained</i> {n0(here.appliedSustained)} dps
          </span>
        )}
        <span><i>Emitted</i> {n0(here.raw)} dps</span>
        <span title="Applied damage divided by the fit's paper DPS. It can exceed 100%: one shot in a hundred is a WRECKING hit at 300% damage and lands regardless of tracking, so a turret that never misses averages 101.5% of nominal. Below 100% is tracking, falloff and missile application taking their cut."
          className={here.raw > 0 && here.applied / here.raw < 0.5 ? 'bad' : ''}>
          <i>vs paper</i> {here.raw > 0 ? pct(here.applied / here.raw) : '—'}
        </span>
        <span><i>At</i> {km(distance)}, {n0(transversal)} m/s transversal vs {target.name}</span>
      </div>

      <table className="data sim-weapons">
        <thead>
          <tr><th>Weapon</th><th>Ammo</th><th className="c-num">Emitted</th>
            <th className="c-num" title="Applied damage divided by the fit's paper DPS. It can exceed 100%: one shot in a hundred is a WRECKING hit at 300% damage and lands regardless of tracking, so a turret that never misses averages 101.5% of nominal. Below 100% is tracking, falloff and missile application taking their cut.">Applies</th><th className="c-num">Landed</th>
            <th className="c-num">Sustained</th></tr>
        </thead>
        <tbody>
          {/* one row per weapon TYPE+AMMO, since eight identical guns are one
              decision, not eight */}
          {[...new Map(here.perWeapon.map((w) => [`${w.typeId}:${w.chargeTypeId ?? 0}`, w])).values()]
            .map((w) => {
              const n = here.perWeapon.filter(
                (o) => o.typeId === w.typeId && o.chargeTypeId === w.chargeTypeId).length;
              return (
                <tr key={`${w.typeId}:${w.chargeTypeId ?? 0}`}>
                  <td className="hub-name">{typeNameOf(w.typeId)}{n > 1 ? ` ×${n}` : ''}</td>
                  <td className="hub-name">{w.chargeTypeId !== undefined ? typeNameOf(w.chargeTypeId) : '—'}</td>
                  <td className="c-num">{n0(w.raw * n)}</td>
                  <td className={`c-num${w.application < 0.5 ? ' bad' : ''}`}>{pct(w.application)}</td>
                  <td className="c-num">{n0(w.applied * n)}</td>
                  <td className="c-num">{n0(w.appliedSustained * n)}</td>
                </tr>
              );
            })}
        </tbody>
      </table>

      <div className="sim-tank">
        <label>
          Incoming damage
          <select value={profileIdx} onChange={(e) => setProfileIdx(Number(e.target.value))}>
            {DAMAGE_PROFILES.map((p, i) => <option key={p.name} value={i}>{p.name}</option>)}
          </select>
        </label>
        <span><i>EHP</i> {n0(tankTotal)}</span>
        <span><i>Shield</i> {n0(tank.shield)}</span>
        <span><i>Armor</i> {n0(tank.armor)}</span>
        <span><i>Hull</i> {n0(tank.structure)}</span>
      </div>

      <table className="data sim-resists">
        <thead>
          <tr><th>Resists</th>{DAMAGE_TYPES.map((t) => <th key={t} className="c-num">{t.slice(0, 2).toUpperCase()}</th>)}</tr>
        </thead>
        <tbody>
          {([['Shield', stats.resonance.shield], ['Armor', stats.resonance.armor],
            ['Hull', stats.resonance.structure]] as [string, Damage][]).map(([name, res]) => (
            <tr key={name}>
              <td className="hub-name">{name}</td>
              {DAMAGE_TYPES.map((t) => {
                // the weakest face of a layer is where a smart opponent aims
                const worst = Math.max(...DAMAGE_TYPES.map((k) => res[k]));
                return (
                  <td key={t} className={`c-num${res[t] === worst && worst > 0 ? ' bad' : ''}`}>
                    {pct(1 - res[t])}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="hint sim-caveat">
        Turret hit chance is 0.5^((angular·sigRes ÷ tracking·sig)² + (max(0, range−optimal) ÷ falloff)²),
        averaged over hit quality including the 1% wrecking chance. Missiles use
        min(1, sig÷expRadius, ((sig÷expRadius)·(expVel÷speed))^drf). Both run on the engine's
        post-skill, post-ammo numbers. This panel is closed-form: reload is amortised into the
        sustained figure rather than simulated as real silences, the capacitor is not spent, and
        the target has no resistances here. The Battle Sim tab runs the discrete fight where all
        of that is exact. Damage profiles above apply to YOUR tank, not to the target.
      </div>
    </div>
  );
}
