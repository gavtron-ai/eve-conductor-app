// Per-character REAL fitting numbers from the vendored dogma engine — the
// same simulation eveship.fit runs, with each character's actual skills and
// implants. Shared by the Fit Skill Maxer and the Fit Wizard.
//   · resource rows read REMAINING / total (in-game layout) with a
//     utilization bar heat-mapped green → red → dark red past 100%
//   · the full ship-attribute panel lists EVERY attribute the engine
//     computed, grouped the way the SDE groups them
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharAccount } from '../lib/auth';
import type { ParsedFit } from '../lib/skillRelevance';
import { attrDef, attrCategory, formatAttrValue } from '../lib/skillRelevance';
import { calculateFitStats, calculateFromEsfFit, ESF_DATA_TAG, type FitStats } from '../lib/dogmaStats';
import type { EsfFitShape } from '../lib/dogmaFit';
import Tip from './Tip';
import {
  fittingGapSkills, headroom, RESOURCE_LABEL,
  type ResourceKey, type GapResult,
} from '../lib/fitGap';
import MakeItFitPopover from './MakeItFitPopover';
import { fittingProblems } from '../lib/fitFix';
import { DAMAGE_TYPES, type DamageType } from '../lib/fitSim';
import { logUser } from '../lib/devlog';
import SimPanel from './SimPanel';
import { WeaponTable, AmmoTables, ProjectedTable } from './WeaponTables';
import { totalDamage } from '../lib/fitSim';

type CharStats = FitStats | { error: string } | 'loading' | 'unsynced';

const fmtSecs = (s: number) => (s >= 3600 ? `${(s / 3600).toFixed(1)}h` : s >= 60 ? `${(s / 60).toFixed(1)}m` : `${s.toFixed(0)}s`);
/** REMAINING / total — the way the in-game fitting window reads (user rule) */
const fmtFree = (load: number, output: number) => `${(output - load).toFixed(1)} / ${output.toFixed(1)}`;

/** resource meter fill (v0.165): STATUS colors, not a rainbow — the value
 * text stays in ink (text never wears the data color); the bar alone
 * carries state: normal → amber when nearly full → red once over budget */
const barColor = (ratio: number): string =>
  (ratio > 1 ? 'var(--bad)' : ratio >= 0.9  ? '#e0a13a' : 'var(--accent)');

// the game's own damage-type identities, in the game's display order
const DMG_COLOR: Record<DamageType, string> = {
  em: '#4c9de8', thermal: '#e05252', kinetic: '#9aa5b1', explosive: '#e6a23c',
};
const DMG_LABEL: Record<DamageType, string> = { em: 'EM', thermal: 'TH', kinetic: 'KIN', explosive: 'EXP' };

/** IN-GAME defense block (v0.166): per layer, hit points + the four
 * resistances — the fill length repeats the number the way the client's
 * own resist boxes do; percentages come straight off the engine's
 * resonances (resist = 1 − resonance). */
function DefenseGrid({ s }: { s: FitStats }) {
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  const layers = [
    { name: 'Shield', hp: s.summary.shieldHp, r: s.resonance.shield },
    { name: 'Armor', hp: s.summary.armorHp, r: s.resonance.armor },
    { name: 'Hull', hp: s.summary.structureHp, r: s.resonance.structure },
  ];
  return (
    <div className="fsp-def">
      <div className="fsp-def-row fsp-def-head">
        <span /><span />
        {DAMAGE_TYPES.map((dt) => (
          <span key={dt} className="fsp-def-dt" style={{ color: DMG_COLOR[dt] }} title={dt}>{DMG_LABEL[dt]}</span>
        ))}
      </div>
      {layers.map((l) => (
        <div key={l.name} className="fsp-def-row">
          <span className="fsp-def-layer">{l.name}</span>
          <span className="fsp-def-hp" title={`${l.name.toLowerCase()} hit points`}>{fmt(l.hp)}</span>
          {DAMAGE_TYPES.map((dt) => {
            const res = Math.max(0, Math.min(1, 1 - l.r[dt]));
            return (
              <span key={dt} className="fsp-def-cell" title={`${l.name} ${dt} resistance: ${(res * 100).toFixed(1)}%`}>
                <span className="fsp-def-fill" style={{ width: `${res * 100}%`, background: DMG_COLOR[dt] }} />
                <b>{Math.round(res * 100)}%</b>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** peak recharge = 2.5·C/τ (EVE's sqrt recharge curve at its peak) — the
 * same identity the engine's own capacitor pass uses, verified by fixture */
const capUtilization = (s: FitStats): number => {
  const peak = s.cap.rechargeRate > 0 ? (2.5 * s.cap.capacity) / s.cap.rechargeRate : 0;
  if (peak <= 0) return 0;
  const drain = peak - s.cap.peakDelta;
  return drain / peak;
};

interface Row {
  label: string;
  tip: string;
  text: (s: FitStats) => string;
  ratio: (s: FitStats) => number;
  /** which resource this row is, for the "what should I train" comparison */
  resource?: ResourceKey;
}

const ROWS: Row[] = [
  {
    label: 'CPU',
    tip: "CPU REMAINING / total (the in-game fitting-window layout) — with this character's skills AND implants applied. The bar shows utilization; dark red = over available, the fit does not go on grid.",
    text: (s) => `${fmtFree(s.cpu.load, s.cpu.output)} tf`,
    ratio: (s) => (s.cpu.output > 0 ? s.cpu.load / s.cpu.output : 0),
    resource: 'cpu',
  },
  {
    label: 'Powergrid',
    tip: 'Powergrid REMAINING / total, skills and implants applied. Dark red = over available.',
    text: (s) => `${fmtFree(s.power.load, s.power.output)} MW`,
    ratio: (s) => (s.power.output > 0 ? s.power.load / s.power.output : 0),
    resource: 'power',
  },
  {
    label: 'Calibration',
    tip: 'Rig calibration REMAINING / total.',
    text: (s) => fmtFree(s.calibration.load, s.calibration.output),
    ratio: (s) => (s.calibration.output > 0 ? s.calibration.load / s.calibration.output : 0),
    resource: 'calibration',
  },
  {
    label: 'Capacitor',
    tip: 'Tick-by-tick simulation of every active module drawing capacitor. STABLE = recharge outruns the drain at the peak point; otherwise how long until dry. The bar is drain ÷ peak recharge — past 100% the cap cannot hold.',
    text: (s) => (s.cap.depletesIn < 0
      ? `stable · ${s.cap.capacity.toFixed(0)} GJ`
      : `⚠ lasts ${fmtSecs(s.cap.depletesIn)} · ${s.cap.capacity.toFixed(0)} GJ`),
    ratio: capUtilization,
    resource: 'cap',
  },
];

/**
 * "Train these to fix it" — hover a fitting bar on the character who is
 * short, and see which of the OTHER character's skills would actually help,
 * measured one at a time by the engine.
 */
const POP_WIDTH = 520;
const POP_MARGIN = 8;

function GapPopover({ me, other, resource, fit, esfFit, anchor, onEnter, onLeave }: {
  me: CharAccount;
  other: CharAccount;
  resource: ResourceKey;
  fit: ParsedFit;
  esfFit?: EsfFitShape;
  /** drones the caller could not put in space (bandwidth / 5-drone cap) */
  benchedDrones?: string[];
  /** the cell the popover belongs to, in VIEWPORT coordinates */
  anchor: DOMRect;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const [res, setRes] = useState<GapResult | null>(null);
  const [busy, setBusy] = useState(true);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number }>(() => ({
    left: anchor.right - POP_WIDTH, top: anchor.bottom + 4,
  }));

  /**
   * KEEP IT ON THE MONITOR. The popover is portalled to <body> — an absolute
   * child was clipped by the panel's own `overflow:auto`, which is what cut
   * the gain column off. Fixed positioning escapes every ancestor, so the
   * only remaining job is clamping to the viewport: flip above the cell when
   * there is no room below, and never let either edge leave the screen.
   */
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const h = el.offsetHeight;
    const w = el.offsetWidth;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = anchor.right - w;
    left = Math.min(left, vw - w - POP_MARGIN);
    left = Math.max(POP_MARGIN, left);
    let top = anchor.bottom + 4;
    if (top + h > vh - POP_MARGIN) {
      // no room below — put it above, and if it doesn't fit there either,
      // pin it to the top rather than letting it run off
      top = anchor.top - h - 4;
      if (top < POP_MARGIN) top = Math.max(POP_MARGIN, vh - h - POP_MARGIN);
    }
    setPos({ left, top });
  }, [anchor, res, busy]);

  useEffect(() => {
    let dead = false;
    setRes(null);
    setBusy(true);
    void fittingGapSkills({
      fit, esfFit,
      mine: me.skills ?? {},
      myImplants: me.implants ?? null,
      theirs: other.skills ?? {},
      theirImplants: other.implants ?? null,
      resource,
      cancelled: () => dead,
    })
      .then((r) => { if (!dead) { setRes(r); setBusy(false); } })
      .catch(() => { if (!dead) setBusy(false); });
    return () => { dead = true; };
  }, [me, other, resource, fit, esfFit]);

  const n = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}`;
  return createPortal(
    <div className="gap-pop" ref={boxRef}
      style={{ left: pos.left, top: pos.top, width: POP_WIDTH, maxWidth: 'calc(100vw - 16px)' }}
      onMouseEnter={onEnter} onMouseLeave={onLeave}
      onMouseDown={(e) => e.stopPropagation()}>
      <div className="gap-head">
        To close the {RESOURCE_LABEL[resource]} gap on <b>{me.characterName}</b>,
        compared with <b>{other.characterName}</b>
      </div>
      {busy && <div className="gap-busy">measuring each skill with the dogma engine…</div>}
      {res && res.rows.length === 0 && !busy && (
        <div className="gap-busy">
          {res.bestPossible - res.base > 1e-6
            ? `Training everything ${other.characterName} has would give ${n(res.bestPossible - res.base)}${res.unit}, but no single skill accounted for it — it comes from skills with no direct modifier on this resource.`
            : res.implants.length > 0
              ? `No SKILL of ${other.characterName}'s would help — it is the clone. See below.`
              : `Nothing ${other.characterName} has trained or plugged in would improve this. The difference is the modules themselves.`}
        </div>
      )}
      {res && res.rows.length > 0 && (
        <>
          <table className="gap-table">
            <tbody>
              {res.rows.slice(0, 8).map((r) => (
                <tr key={r.skillId}>
                  <td>{r.name}</td>
                  <td className="gap-lvl">{r.from} → {r.to}</td>
                  <td className="gap-gain">{n(r.gain)}{res.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="gap-foot">
            Now {res.base.toFixed(2)}{res.unit} spare · training everything {other.characterName} has
            would give {res.bestPossible.toFixed(2)}{res.unit}.
            <br />
            These do NOT add up — EVE stacking-penalises bonuses to the same attribute, so the total
            is measured separately, not summed.
            {res.untested > 0 && <> {res.untested} other higher skill(s) had no modifier on this resource and were not tested individually.</>}
          </div>
        </>
      )}

      {res && !busy && res.implants.length > 0 && (
        <div className="gap-implants">
          <div className="gap-sub">Implants {other.characterName} has that you don't</div>
          <table className="gap-table">
            <tbody>
              {res.implants.slice(0, 6).map((i) => (
                <tr key={i.typeId}>
                  <td>
                    {i.name}
                    {i.replaces && <span className="gap-swap"> replaces {i.replaces.name}</span>}
                  </td>
                  <td className="gap-lvl">{i.slot !== null ? `slot ${i.slot}` : ''}</td>
                  <td className="gap-gain">{n(i.gain)}{res.unit}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="gap-foot">
            A slot holds ONE implant, so these are measured as SWAPS — plugging theirs in displaces
            yours in that slot.
            {res.theirClone !== null && <> Their whole clone in your head would give {res.theirClone.toFixed(2)}{res.unit}.</>}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

export default function FitStatsPanel({ fit, chars, onStats, esfFit, benchedDrones = [], podOverride }: {
  fit: ParsedFit;
  chars: CharAccount[];
  /** the Fit Wizard uses these numbers for its "fits in what's left" filter */
  onStats?: (byChar: Record<number, FitStats>) => void;
  /** prepared engine fit — preserves module run states (EFT can't express
   * overheating), used by the Fit Wizard instead of the parsed fit */
  esfFit?: EsfFitShape;
  /** drones the caller could not put in space (bandwidth / 5-drone cap) */
  benchedDrones?: string[];
  /** the wizard's pod picker (v0.193): slot array (nulls = empty) worn by
   * EVERY character instead of their own implants; undefined = old behavior */
  podOverride?: (number | null)[];
}) {
  const [stats, setStats] = useState<Record<number, CharStats>>({});
  const [showAttrs, setShowAttrs] = useState(false);
  const [showSim, setShowSim] = useState(false);
  /** EFT and ESI have no notation for "fitted, powered, not cycling", so every
   * fit from those sources is scored with the prop mod RUNNING — which inflates
   * signature ~6x (a Raven reads 1,025 m instead of 410) and halves time-to-dry.
   * Defaults to the historical behaviour; the toggle makes it visible. */
  const [propRunning, setPropRunning] = useState(true);
  /** whose skills the applied-damage curves are drawn for. Defaults to the
   * first character and follows the roster if that one goes away. */
  const [simCharPick, setSimCharPick] = useState<number | null>(null);
  const simChar = simCharPick !== null && chars.some((c) => c.characterId === simCharPick)
    ? simCharPick
    : chars[0]?.characterId ?? null;
  const setSimChar = setSimCharPick;
  /** which (character, resource) bar the mouse is over — the comparison is
   * only computed while it is actually being looked at */
  const [hover, setHover] = useState<{ charId: number; resource: ResourceKey; anchor: DOMRect } | null>(null);
  /** which cell has its "make it fit" panel open. A CLICK, not a hover: the
   * search runs the dogma engine dozens of times and must not fire from a
   * mouse crossing the table. */
  const [fixing, setFixing] = useState<{ charId: number; resource: ResourceKey; anchor: DOMRect } | null>(null);
  /** the popover lives in a PORTAL, so moving the mouse from the cell onto
   * it counts as leaving the cell. A short grace period bridges the gap;
   * entering the popover cancels it. */
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = () => { if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null; } };
  const closeSoon = () => { cancelClose(); closeTimer.current = setTimeout(() => setHover(null), 160); };
  useEffect(() => cancelClose, []);
  // lastSync moves on every skill sync — a level-up of an already-known
  // skill changes NO key count, so counting keys showed stale numbers.
  // Implants are part of the fingerprint too: a new hardwiring moves outputs.
  // the wizard's POD (v0.193): an array overrides EVERY character's own
  // implants — "what do these numbers become in THIS pod"; undefined keeps
  // the old behavior (each character wears their own synced clone)
  const podFor = (c: { implants?: number[] | null }): number[] | null =>
    podOverride !== undefined
      ? podOverride.filter((x): x is number => x !== null)
      : c.implants ?? null;
  const charKey = chars.map((c) => `${c.characterId}:${c.lastSync ?? 'never'}:${c.skills ? 1 : 0}:${podFor(c)?.join('|') ?? 'null'}`).join(',');
  const esfKey = esfFit ? JSON.stringify(esfFit) : '';
  useEffect(() => {
    let cancelled = false;
    const initial: Record<number, CharStats> = {};
    for (const c of chars) initial[c.characterId] = c.skills ? 'loading' : 'unsynced';
    setStats(initial);
    // INVALIDATE consumers immediately: the wizard's "fits what's left"
    // filter would otherwise prune against the PREVIOUS fit's headroom
    onStats?.({});
    // debounced: the calculation is ~30ms of synchronous WASM per character —
    // running it on every keystroke would judder typing
    const t = setTimeout(() => {
      for (const c of chars) {
        if (!c.skills) continue; // numbers from assumed skills would be lies
        (esfFit
          ? calculateFromEsfFit(esfFit, c.skills, podFor(c), benchedDrones, { propRunning })
          : calculateFitStats(fit, c.skills, podFor(c), { propRunning }))
          .then((s) => {
            if (cancelled) return;
            setStats((cur) => {
              const next = { ...cur, [c.characterId]: s };
              if (onStats) {
                const done: Record<number, FitStats> = {};
                for (const [id, v] of Object.entries(next)) {
                  if (typeof v === 'object' && !('error' in v)) done[Number(id)] = v;
                }
                onStats(done);
              }
              return next;
            });
          })
          .catch((e: unknown) => {
            if (cancelled) return;
            setStats((cur) => ({ ...cur, [c.characterId]: { error: e instanceof Error ? e.message : String(e) } }));
            // no numbers for this character → consumers must stop filtering
            // on whatever they last saw
            onStats?.({});
          });
      }
    }, 350);
    return () => { cancelled = true; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit, charKey, esfKey, propRunning]);

  const ready = chars
    .map((c) => [c.characterId, stats[c.characterId]] as const)
    .filter((e): e is [number, FitStats] => typeof e[1] === 'object' && !('error' in e[1]));

  /** every attribute any character's result carries, grouped by SDE
   * category — published attributes first, internal ones behind a toggle */
  const readyKey = ready.map(([id, s]) => `${id}:${s.hullAttributes.size}`).join(',');
  const attrRows = useMemo(() => {
    const ids = new Set<number>();
    for (const [, s] of ready) {
      for (const id of s.hullAttributes.keys()) {
        // the engine materializes DEFAULTS for anything its effect graph
        // touches (a Rifter came back carrying "Maximum Jump Range") —
        // only what the hull itself actually has belongs in this panel
        if (s.hullOwnAttributes.size === 0 || s.hullOwnAttributes.has(id)) ids.add(id);
      }
    }
    const byCat = new Map<string, { id: number; name: string; unitId: number }[]>();
    for (const id of ids) {
      const def = attrDef(id);
      // a REAL in-game display name is the honest gate: "published" alone
      // hid Rig Slots / Warp Speed Multiplier while letting raw camelCase
      // internals (freighterBonusO1…) through
      if (!def || !def.hasDisplayName) continue;
      const cat = attrCategory(def.catId);
      (byCat.get(cat) ?? byCat.set(cat, []).get(cat)!).push({ id, name: def.name, unitId: def.unitId });
    }
    for (const list of byCat.values()) list.sort((a, b) => a.name.localeCompare(b.name));
    return [...byCat.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readyKey]);

  const anyNonFit = ready.find(([, s]) => s.nonFit.length > 0)?.[1];
  const anyBenched = ready.find(([, s]) => s.benchedDrones.length > 0)?.[1];
  const fmtNum = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d });
  /** the weapon whose reach the Range tile shows: highest-dps non-drone */
  const primaryWeapon = (st: FitStats) => [...st.simWeapons]
    .filter((w) => w.kind !== 'drone')
    .sort((a, b) => totalDamage(b.volley) / b.cycleSeconds - totalDamage(a.volley) / a.cycleSeconds)[0];
  /** the four numbers a fit is judged by (v0.165 layout: ONE prominent
   * number per metric, the breakdown as a quiet second line — the jammed
   * compound strings were the readability complaint) */
  const SUMMARY: { label: string; tip: string; big: (s: FitStats) => string; sub: (s: FitStats) => string | null }[] = [
    {
      label: 'DPS',
      tip: 'Damage per second: every ACTIVE weapon and drone firing, no reload, using each charge\'s computed damage with this character\'s skills. Overheated modules use their overloaded numbers. Range, tracking and application are NOT modelled — this is raw output.',
      // ALPHA is the headline; sustained (reload included) rides the sub-line.
      // Five Rapid Light Missile Launcher IIs: 247.5 alpha, 160.4 sustained —
      // hiding either number misleads on exactly the burst weapons.
      big: (s) => fmtNum(s.summary.dps, 1),
      sub: (s) => (s.summary.dpsSustained < s.summary.dps - 0.05
        ? `${fmtNum(s.summary.dpsSustained, 1)} sustained (reload)`
        : null),
    },
    {
      // ALPHA IS ITS OWN NUMBER (v0.195): as important as DPS and it used to
      // ride a tiny sub-line — the owner's complaint. One full volley from
      // every weapon.
      label: 'Alpha',
      tip: 'One full volley from every fitted weapon and drone at once — the number that decides whether a target survives the first cycle. Same engine pass as DPS.',
      big: (s) => fmtNum(s.summary.volley),
      sub: (s) => `${s.summary.weapons.length} weapon group${s.summary.weapons.length === 1 ? '' : 's'}`,
    },
    {
      // RANGE (v0.195): the highest-dps non-drone weapon's reach. Turrets:
      // optimal + falloff; missiles: the flight ceiling. The weapons table
      // below lists every group.
      label: 'Range',
      tip: "The main weapon's reach — turrets: optimal, then falloff (half damage at optimal+falloff); missiles: the flight ceiling, a missile past it never arrives. Taken from the highest-dps non-drone weapon; the weapons table lists them all.",
      big: (s) => {
        const w = primaryWeapon(s);
        if (!w) return '—';
        const m = w.kind === 'missile' ? w.maxRange : w.optimal;
        return m === undefined ? '—' : `${fmtNum(m / 1000, m < 10_000 ? 2 : 1)} km`;
      },
      sub: (s) => {
        const w = primaryWeapon(s);
        if (!w) return null;
        if (w.kind === 'missile') return `explosion ${fmtNum(w.expRadius ?? 0)} m · ${fmtNum(w.expVelocity ?? 0)} m/s`;
        const fo = w.falloff ?? 0;
        return `+ ${fmtNum(fo / 1000, fo < 10_000 ? 2 : 1)} km falloff · tracking ${(w.tracking ?? 0).toLocaleString(undefined, { maximumFractionDigits: 1 })}`;
      },
    },
    {
      label: 'EHP',
      tip: 'Effective hit points against an even 25/25/25/25 damage profile — shield + armor + structure, each divided by its average resonance.',
      big: (s) => fmtNum(s.summary.ehp),
      sub: (s) => `S ${fmtNum(s.summary.shieldEhp)} · A ${fmtNum(s.summary.armorEhp)} · H ${fmtNum(s.summary.structureEhp)}`,
    },
    {
      label: 'Speed',
      tip: 'Top speed and align time (−ln(0.25)·agility·mass — the standard identity; 75% of max speed is when warp engages).',
      big: (s) => `${fmtNum(s.summary.maxVelocity)} m/s`,
      sub: (s) => `align ${fmtNum(s.summary.alignTime, 2)} s`,
    },
    {
      label: 'Targeting',
      tip: 'Lock range, scan resolution, signature radius and how many targets can be locked at once.',
      big: (s) => `${fmtNum(s.summary.targetRange / 1000, 1)} km`,
      sub: (s) => `${fmtNum(s.summary.scanResolution)} mm scan · sig ${fmtNum(s.summary.signatureRadius)} m · ${fmtNum(s.summary.lockedTargets)} targets`,
    },
  ];
  return (
    <>
      {/* PROP MOD STATE. EFT and ESI cannot express "fitted, powered, not
          cycling", so every fit from those sources has always been scored with
          the microwarpdrive RUNNING — signature 210 instead of 35 on a Rifter,
          speed 3213 instead of 456, and the capacitor dry in 27 s instead of
          54. The default is unchanged so no number moves unasked; this makes
          the assumption visible and reversible. */}
      <label className="prop-toggle" title="Propulsion modules cycling. Off = fitted and powered but not running: lower signature and speed, less capacitor drain. EFT and ESI have no notation for this, so fits from those sources default to running.">
        <input type="checkbox" checked={propRunning}
          onChange={(e) => {
            setPropRunning(e.target.checked);
            logUser('fit: prop modules ' + (e.target.checked ? 'RUNNING' : 'off'));
          }} />
        propulsion running
      </label>
      <div className="fsp-grid" style={{ gridTemplateColumns: `minmax(78px, auto) repeat(${Math.max(1, chars.length)}, minmax(0, 1fr))` }}>
        {/* ONE header row for both sections — the character names were
            repeated twice before, pure noise */}
        <div className="fsp-corner"><Tip tip={`Computed by the EVEShip.fit dogma engine (vendored, MIT) with CCP data bundle ${ESF_DATA_TAG} — per character with THEIR synced skills and implants.`}>Fit summary</Tip></div>
        {chars.map((c) => {
          // ONE WRENCH PER CHARACTER, beside their name — "can this person
          // fly this fit" is a question about the person, not four cells.
          const st = stats[c.characterId];
          const usable = st !== undefined && st !== 'loading' && st !== 'unsynced' && !('error' in st)
            ? st : null;
          const verdict = usable ? fittingProblems(usable, fit) : null;
          const problems: ResourceKey[] = verdict ? verdict.resources : [];
          const capUnknown = verdict?.cap.unknown ? verdict.cap.unloaded : null;
          return (
            <div key={c.characterId} className="fsp-char">
              {c.characterName}
              {problems.length > 0 && (
                <button
                  className="gap-hint"
                  style={{ cursor: 'pointer', border: 0, background: 'none', font: 'inherit', color: '#ff9d3d', marginLeft: 4 }}
                  title={`This fit does not work for ${c.characterName} (${problems.map((r) => RESOURCE_LABEL[r]).join(', ')}) — click for the cheapest way to make it fit.`}
                  onClick={(e) => {
                    e.stopPropagation();
                    setFixing({
                      charId: c.characterId,
                      resource: problems[0],
                      anchor: e.currentTarget.getBoundingClientRect(),
                    });
                  }}
                >
                  🔧
                </button>
              )}
              {capUnknown && (
                <span className="gap-hint" style={{ marginLeft: 4, opacity: .7 }}
                  title={`Capacitor not judged: ${capUnknown.join(', ')} has no charges loaded. An ancillary module without charges drains capacitor a charged one would not, so the reading would measure the loadout rather than the fit.`}>
                  ⚡?
                </span>
              )}
              {fixing?.charId === c.characterId && (
                <MakeItFitPopover
                  me={c} resources={problems} fit={fit} esfFit={esfFit}
                  anchor={fixing.anchor} onClose={() => setFixing(null)}
                />
              )}
            </div>
          );
        })}
        {SUMMARY.map((row) => (
          <React.Fragment key={row.label}>
            <div className="fsp-label"><Tip tip={row.tip}>{row.label}</Tip></div>
            {chars.map((c) => {
              const s = stats[c.characterId];
              if (typeof s !== 'object' || 'error' in s) {
                return <div key={c.characterId} className="fsp-cell dim">{s === 'loading' ? '…' : s === 'unsynced' ? 'not synced' : '—'}</div>;
              }
              const sub = row.sub(s);
              return (
                <div key={c.characterId} className="fsp-cell">
                  <div className="fsp-big">{row.big(s)}</div>
                  {/* EHP expands into the in-game defense block: per-layer
                      hp + all four resistances, not just the S/A/H totals */}
                  {row.label === 'EHP'
                    ? <DefenseGrid s={s} />
                    : sub !== null && <div className="fsp-sub">{sub}</div>}
                </div>
              );
            })}
          </React.Fragment>
        ))}
        <div className="fsp-sec"><Tip tip="Fitting resources, REMAINING / total — the in-game layout. The bar shows utilization: amber when nearly full, red once over budget.">Fitting</Tip></div>
        {ROWS.map((r) => (
          <React.Fragment key={r.label}>
            <div className="fsp-label"><Tip tip={r.tip}>{r.label}</Tip></div>
            {chars.map((c) => {
              const s = stats[c.characterId];
              if (s === 'loading') return <div key={c.characterId} className="fsp-cell dim">…</div>;
              if (s === 'unsynced') return <div key={c.characterId} className="fsp-cell dim" title="Sync this character's skills first — numbers from assumed skills would be wrong.">skills not synced</div>;
              if (s === undefined) return <div key={c.characterId} className="fsp-cell dim">—</div>;
              if ('error' in s) return <div key={c.characterId} className="fsp-cell neg" title={s.error}>engine error</div>;
              const ratio = r.ratio(s);
              // the best OTHER character for this resource — the one worth
              // comparing against when more than two are selected
              const rival = r.resource
                ? chars
                    .filter((o) => o.characterId !== c.characterId && o.skills)
                    .map((o) => ({ o, s: stats[o.characterId] }))
                    .filter((x): x is { o: CharAccount; s: FitStats } =>
                      x.s !== undefined && x.s !== 'loading' && x.s !== 'unsynced' && !('error' in x.s))
                    .sort((x, y) => headroom(y.s, r.resource!) - headroom(x.s, r.resource!))[0]
                : undefined;
              const behind = rival !== undefined && r.resource !== undefined
                && headroom(rival.s, r.resource) - headroom(s, r.resource) > 1e-6;
              const showing = hover?.charId === c.characterId && hover.resource === r.resource;
              return (
                <div key={c.characterId} className={`fsp-cell${behind ? ' gap-cell' : ''}`}
                  onMouseEnter={(e) => {
                    if (!behind || !r.resource) return;
                    cancelClose();
                    setHover({ charId: c.characterId, resource: r.resource, anchor: e.currentTarget.getBoundingClientRect() });
                  }}
                  onMouseLeave={closeSoon}>
                  <div className="fsp-meter-line">
                    <span className="fsp-val">{r.text(s)}</span>
                    {ratio > 1 && r.resource !== 'cap' && <span className="fsp-over">OVER</span>}
                    {behind && !showing && <span className="gap-hint" title={`Behind ${rival.o.characterName} here — hover to see which skills would close it.`}>▾</span>}
                  </div>
                  <div className="fsp-bar" title={`${(ratio * 100).toFixed(1)}% used${ratio > 1 ? ' — OVER available' : ''}`}>
                    <div style={{ width: `${Math.max(0, Math.min(100, ratio * 100))}%`, background: barColor(ratio) }} />
                  </div>
                  {showing && rival && hover && (
                    <GapPopover me={c} other={rival.o} resource={r.resource!} fit={fit} esfFit={esfFit}
                      anchor={hover.anchor} onEnter={cancelClose} onLeave={closeSoon} />
                  )}
                </div>
              );
            })}
          </React.Fragment>
        ))}
      </div>
      {/* WEAPONS + AMMO (v0.195) — right under the headline tiles and NEVER
          inside a fold: these are the numbers a fitter swaps modules and
          charges to move. (First draft mounted them beside SimPanel, inside
          the collapsed "applied damage" section — invisible by default,
          the same mistake as the pod placement in v0.193.) */}
      {simChar !== null && (() => {
        const s = stats[simChar];
        const usable = s !== undefined && s !== 'loading' && s !== 'unsynced' && !('error' in s) ? s : null;
        const sc = chars.find((c) => c.characterId === simChar);
        if (!usable) return null;
        return (
          <>
            <WeaponTable stats={usable} />
            <ProjectedTable stats={usable} />
            {sc?.skills
              ? <AmmoTables stats={usable} fit={fit} skills={sc.skills} implants={podFor(sc)} propRunning={propRunning} />
              : null}
          </>
        );
      })()}
      {anyNonFit && (
        <div className="hint" style={{ marginTop: -4 }}>
          Not counted (cargo, not fitted): {anyNonFit.nonFit.join(', ')}
        </div>
      )}
      {anyBenched && (
        <div className="hint" style={{ marginTop: -4 }}>
          Not counted (spare drones — over the hull's drone bandwidth or past the
          5-drone limit, so they cannot be in space at the same time):{' '}
          {anyBenched.benchedDrones.join(', ')}
        </div>
      )}
      {chars.filter((c) => c.skills && c.implants === null).map((c) => (
        <div className="hint" key={c.characterId} style={{ marginTop: -4 }}>
          ⚠ {c.characterName}: implants not synced — hardwirings (+% CPU/PG/cap) are missing from their
          numbers. Settings → their card → Sync.
        </div>
      ))}

      {/* APPLIED DAMAGE — the paper DPS above is what the fit emits; this is
          what reaches a target. Per character, because tracking and explosion
          radius are skill-driven: the same hull applies very differently for
          someone with Sharpshooter V. Collapsed by default — each curve is
          120 evaluations and most visits to this panel are about fitting. */}
      {simChar !== null && (() => {
        const s = stats[simChar];
        const usable = s !== undefined && s !== 'loading' && s !== 'unsynced' && !('error' in s) ? s : null;
        if (!usable) return null;
        return (
          <>
            <button className="btn" style={{ marginBottom: 6 }} onClick={() => setShowSim((v) => !v)}
              title="What this fit actually lands on a target of a given size, speed and range — hit chance, tracking, falloff, missile application, and EHP against a chosen damage profile.">
              {showSim ? '▾' : '▸'} applied damage vs a target
            </button>
            {showSim && (
              <>
                {chars.length > 1 && (
                  <div className="sim-controls" style={{ marginBottom: 6 }}>
                    <label>
                      Flown by
                      <select value={simChar} onChange={(e) => setSimChar(Number(e.target.value))}>
                        {chars.map((c) => (
                          <option key={c.characterId} value={c.characterId}>{c.characterName}</option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <SimPanel stats={usable} />
              </>
            )}
          </>
        );
      })()}

      {ready.length > 0 && (
        <>
          <button className="btn" style={{ marginBottom: 6 }} onClick={() => setShowAttrs((v) => !v)}
            title="Every attribute the hull itself carries, computed with this fit and these skills, grouped as the SDE groups them. Rows are limited to attributes CCP gave a real in-game display name (raw internal ones are omitted), and to attributes the hull actually has — the engine also fills in defaults for anything its effect graph touches. Percent/resistance units are converted the way the game displays them. DPS/EHP are NOT here: this engine computes attributes, not damage projections.">
            {showAttrs ? '▾' : '▸'} ship attributes ({attrRows.reduce((n, [, list]) => n + list.length, 0)})
          </button>
          {showAttrs && (
            <table className="data">
              <thead>
                <tr>
                  <th>Attribute</th>
                  {chars.map((c) => <th key={c.characterId}>{c.characterName}</th>)}
                </tr>
              </thead>
              <tbody>
                {attrRows.map(([cat, list]) => [
                  <tr key={`c${cat}`}>
                    <td colSpan={1 + chars.length} style={{ fontWeight: 600, paddingTop: 10 }}>{cat}</td>
                  </tr>,
                  ...list.map((a) => (
                    <tr key={a.id}>
                      <td className="hub-name" title={`attribute #${a.id}`}>{a.name}</td>
                      {chars.map((c) => {
                        const s = stats[c.characterId];
                        const v = typeof s === 'object' && !('error' in s) ? s.hullAttributes.get(a.id) : undefined;
                        return (
                          <td key={c.characterId} className={v === undefined ? 'dim' : ''}>
                            {v === undefined ? '—' : formatAttrValue(v, a.unitId)}
                          </td>
                        );
                      })}
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          )}
        </>
      )}
    </>
  );
}
