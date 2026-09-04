// BATTLE SIM — a target, a team of attackers, and what actually happens.
//
// Every ship here is a REAL FIT flown by a REAL PILOT, so signature, speed,
// resistances and EHP all fall out of the dogma engine rather than being typed
// in. That is the whole point: the previous panel let you invent a target with
// no resists, which flattered every fit equally.
//
// Each ship can be flown by a named character, by a pilot with every skill at
// V, or by one with EXACTLY the prerequisites and nothing else — so the gap
// between "best actual" and "barely able to undock it" is visible on either
// side of the fight.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useApp, type Combatant } from '../lib/store';
import { useAuth } from '../lib/auth';
import { parseFit, type ParsedFit } from '../lib/skillRelevance';
import { calculateFitStats, getEsfData, type FitStats } from '../lib/dogmaStats';
import { toEsfFit, moduleKey, moduleStateOptions, type EsfDataShapes, type ModuleState } from '../lib/dogmaFit';
import type { DogmaLookup } from '../lib/fitCharges';
import { minimumProfile, optimalSkills, canFly, PROFILE_LABEL, type SkillRequirement } from '../lib/pilotProfiles';
import { activePodImplants, characterPods, cloneSignature, initCloneRegistry, onCloneRegistry } from '../lib/cloneNames';

/** The pod a pilot wears in the sim. A solver-applied set (c.implants)
 * overrides everything — that is how a recommendation gets TESTED instead
 * of merely printed. Otherwise: the multibox registry's live active pod
 * (lastWorn is stamped every overlay poll, so a clone jump lands within a
 * poll), and the auth store's sync-time snapshot only for a character the
 * registry has never seen worn. */
function podOf(
  c: Combatant,
  char: { characterId: number; implants?: number[] | null } | undefined,
): number[] | null {
  return c.implants
    ?? (c.profile === 'character' && char
      ? (activePodImplants(char.characterId) ?? char.implants ?? null)
      : null);
}
import { ammoWeapons, chargesForAll, withAmmoMap, chargeDealsDamage } from '../lib/fitCharges';
import { typeNameOf } from '../lib/fitSerial';
import {
  timeToKill, layersOf, appliedDps, landedDamagePerSecond, geometryFrom,
  PRESET_ANGLE, BEHAVIOUR_LABEL, NO_RESISTS,
  type SimTarget, type Engagement, type SimWeapon, type Layer, type Behaviour, type Defenses,
} from '../lib/fitSim';
import { loadTeamFits, type TeamFit } from '../lib/teamFits';
import { useApp as useAppStore } from '../lib/store';
import { variationEft } from '../lib/wizardFits';
import { logUser, logInfo, logWarn } from '../lib/devlog';
import AddCombatant from './AddCombatant';
import BattleChart, { type ChartShip } from './BattleChart';
import FightTimeline from './FightTimeline';
import TacticalMap from './TacticalMap';
import { chainMultiplier, type EventShip, type EventBattleResult } from '../lib/battleEvents';
import { projFalloffScale } from '../lib/projectedCycle';
import { runMonteCarlo } from '../lib/battleMonteCarlo';
import { expandCounts } from '../lib/battleEvents';
import HeadingDial from './HeadingDial';
import SlotSwap, { type SlotBudget } from './SlotSwap';
import { solveImplants, type SolveResult } from '../lib/implantSolver';
import { SKILL_CYBERNETICS, implantSlot, type ImplantLookup } from '../lib/implants';
import { attrDef } from '../lib/skillRelevance';
import { fetchMarketPrices, fetchAggregates } from '../lib/market';
import { BUILTIN_HUBS } from '../lib/constants';
import { isk } from '../lib/format';

const n0 = (v: number) => Math.round(v).toLocaleString();
const n1 = (v: number) => v.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const km = (m: number) => `${(m / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 })} km`;
/** a roster written by v0.65.0 has distance/transversal and no behaviour */
const behaviourOf = (c: Combatant): Behaviour => c.behaviour ?? 'orbit';
const rangeOf = (c: Combatant): number => c.range ?? c.distance ?? 10000;
/** a roster written before angles existed maps its preset onto one */
const angleOf = (c: Combatant): number => c.angleDeg ?? PRESET_ANGLE[behaviourOf(c)];
/** the speed being flown — NOT automatically the ship's maximum */
const speedOf = (c: Combatant, maxSpeed: number): number =>
  c.speed !== undefined ? Math.min(c.speed, maxSpeed)
    : (behaviourOf(c) === 'stationary' ? 0 : maxSpeed);
const elevationOf = (c: Combatant): number => c.elevationDeg ?? 0;
/** the day-one-identical spread: the map's old layout formula, negated for
 * the y-flipped azimuth convention — assigned ONCE on add, then persisted
 * (a pure read-fallback would recompute from roster indices and re-spread
 * every placement whenever a ship is added; persistence IS the fix) */
const spreadAzimuth = (i: number, n: number): number =>
  (((90 - (i * 360) / Math.max(3, n)) % 360) + 360) % 360;
/** a fight score back to points-out-of-100: wins count 1, stalemates 0.5
 * (the sub-5000 time tiebreak is floored away) */
const fightPts = (score: number): string =>
  (Math.floor(score / 5000) / 2).toFixed(1).replace(/\.0$/, '');

/** one candidate's gain over the empty-pod baseline, in fight language:
 * outcome moves show points; same-outcome gains are the TIEBREAK, which is
 * seconds*8 by construction, so they read as time */
const fightGain = (score: number, baseline: number): { text: string; better: boolean } => {
  const after = fightPts(score);
  const before = fightPts(baseline);
  if (after !== before) {
    return { text: `${after}/100 (was ${before})`, better: score > baseline };
  }
  const dt = (score - baseline) / 8;
  if (Math.abs(dt) < 0.05) return { text: `${after}/100 — no change`, better: false };
  const winning = Math.floor(score / 5000) / 2 >= 50;
  const t = secs(Math.abs(dt));
  return {
    text: dt > 0
      ? (winning ? `wins ${t} sooner` : `lasts ${t} longer`)
      : (winning ? `wins ${t} later` : `dies ${t} sooner`),
    better: dt > 0,
  };
};
/** how long a fight is simulated before calling it undecided. The owner
 * tests fleets against huge ships — 10-minute horizons called fights that
 * WOULD resolve "never". 30 minutes minimum, per his rule (v0.108.0). */
const SIM_HORIZON_S = 1800;
// the progress extension's ceiling (engine default x4): a fight still
// CONVERGING at 30 min — hp grinding to new lows, stick reserves thinning —
// keeps simulating up to 2 h; only a true stalemate stops at 30 min
const SIM_HARD_MAX_S = SIM_HORIZON_S * 4;
const secs = (s: number | null) =>
  s === null ? `>${SIM_HARD_MAX_S / 3600}h` : s >= 60 ? `${Math.floor(s / 60)}m ${Math.round(s % 60)}s` : `${n1(s)}s`;

/**
 * "online, not cycling" only means something for a module that CAN cycle. A
 * plate is simply online or offline, and saying otherwise describes a
 * distinction that does not exist for it.
 */
/** hi / med / low / rig / subsystem fitting effects — a module carrying one
 * of these occupies a slot and is therefore swappable */
const SWAPPABLE_EFFECTS = new Set([11, 12, 13, 2663, 3772]);

/**
 * WHAT THIS IMPLANT ACTUALLY DOES, in the game's own words.
 *
 * A pod printed as a comma-separated wall of product names is unreadable and
 * says nothing about why any of it was picked. The bonus is right there in the
 * implant's own dogma, and CCP already names the attribute.
 *
 * Skipped: implantness (which slot), the requiredSkill pair, techLevel and the
 * set-multiplier plumbing — none of which is the reason you would wear it.
 */
/**
 * Attributes that are NOT why you would wear the implant.
 *
 * 175-179 are the five ATTRIBUTE enhancers (charisma … willpower). They change
 * TRAINING SPEED and nothing a fight can see, and every set piece carries all
 * five — usually four of them at zero. 633 is metaLevelOld. The rest is
 * fitting plumbing: which slot, which skill, what level, tech level.
 */
const BORING_ATTRS = new Set([
  331, 182, 183, 184, 1285, 1289, 1290, 277, 278, 279, 1286, 1287, 1288,
  422, 633, 1768, 175, 176, 177, 178, 179,
]);

/**
 * WHAT THIS IMPLANT ACTUALLY DOES, in the game's own words.
 *
 * NO UNIT CONVERSION, and that is not a guess: every one of the 2,921 bonus
 * attributes carried by a published implant in this bundle has NO unitID at
 * all. The values are already the percentage the item description quotes — a
 * Zainou 'Deadeye' TA-706 stores falloffBonus = 6 for its +6%. Passing them
 * through a formatter rendered "+500.0 %" for a 6% implant, using unit
 * metadata from skilldb, which is a DIFFERENT SDE snapshot from the bundle the
 * number came from.
 *
 * A set multiplier is shown as a multiplier, because that is what it is: the
 * product across worn pieces, not a percentage.
 */
function implantEffect(data: EsfDataShapes | null, typeId: number): string {
  if (!data) return '';
  const rows = (data.typeDogma[String(typeId)]?.dogmaAttributes ?? [])
    .filter((a) => !BORING_ATTRS.has(a.attributeID) && a.value !== 0)
    .map((a) => {
      const def = attrDef(a.attributeID);
      const name = def?.name;
      if (!name) return null;
      const v = a.value;
      const num = Number.isInteger(v) ? String(v) : v.toFixed(2);
      // implantSetX / setBonusX are the multiplier that makes a set a set
      if (/^implantset|^setbonus/i.test(name)) return `set bonus x${v.toFixed(2)}`;
      return `${name} ${v > 0 ? '+' : ''}${num}%`;
    })
    .filter((x): x is string => x !== null);
  return rows.slice(0, 3).join(' · ');
}

const stateLabel = (st: ModuleState, canActivate: boolean): string => {
  switch (st) {
    case 'Active': return 'running';
    case 'Overload': return 'overloaded';
    case 'Online': return canActivate ? 'online, not cycling' : 'online';
    default: return 'offline';
  }
};

/** everything we know about one combatant once the engine has run */
interface Resolved {
  combatant: Combatant;
  fit: ParsedFit | null;
  stats: FitStats | null;
  /** the OTHER prop state (MWD toggled), for the scram mechanic: a scrammed
   * ship's speed and signature swap to these. Only fetched when an MWD is
   * fitted — a second engine run per ship is not free. */
  statsAlt?: FitStats | null;
  /** the HARDENERS-DRY state (active resist hardeners offline), for the
   * resist collapse a starved capacitor causes. Only fetched when the fit
   * carries active hardeners — same one-extra-engine-run economy as above.
   * NOTE: the win-rate solver's candidate swaps reuse the base fit's dry
   * resonance — advisory numbers, the committed fight always recomputes. */
  statsDry?: FitStats | null;
  /** why we refused, when we did */
  problem: string | null;
  /** requirements the chosen pilot does NOT meet */
  cannotFly: SkillRequirement[];
  /** what the "bare minimum" pilot actually needs, for the requirements panel */
  requirements: SkillRequirement[];
  /** weapons in this fit that take ammo, and what each can load */
  ammoSlots: {
    typeId: number; name: string; qty: number; loaded: number | null; options: number[];
    /** can this module deal damage at all? A probe launcher and a command
     * burst both take charges and neither is a weapon. */
    isWeapon: boolean;
  }[];
  /** module type-ids riding in the hold — the swaps available undocked */
  cargoTypeIds: number[];
  /** every module whose run state can be changed, in fitting order */
  modules: {
    key: string; typeId: number; name: string; state: ModuleState;
    /** what THIS slot currently holds, and everything it could hold. Per slot,
     * because three tracking computers are three separate script decisions. */
    charge: number | null;
    options: number[];
    isWeapon: boolean;
    /** the states this module can legally be in — a plate has no "running" */
    states: ModuleState[];
    /** the engine's rack for this slot, so the swap picker can filter */
    slotType: string;
  }[];
}

export default function BattleSim() {
  const battle = useApp((s) => s.battleSim);
  const setBattle = useApp((s) => s.setBattleSim);
  const characters = useAuth((s) => s.characters);
  const wizardFits = useAppStore((s) => s.wizardFits);

  const [data, setData] = useState<(EsfDataShapes & DogmaLookup) | null>(null);
  const [teamFits, setTeamFits] = useState<TeamFit[] | null>(null);
  const [resolved, setResolved] = useState<Map<string, Resolved>>(new Map());
  /** ship cards whose EVENT ICONS are hidden on the fight-over-time strip —
   * display-only, never part of the fight (so not in the draft/commit) */
  const [eventIconsOff, setEventIconsOff] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<'target' | 'attacker' | 'defender' | null>(null);
  /**
   * PENDING EDITS. Every keystroke used to flow straight into the store, which
   * re-derived the whole outcome and wrote a diagnostic line per character
   * typed — the range box was unusable. Edits land here; Calculate commits.
   */
  const [draft, setDraft] = useState<{
    target: Combatant | null; attackers: Combatant[]; defenders: Combatant[];
  } | null>(null);
  const view = draft ?? {
    target: battle.target,
    attackers: battle.attackers,
    defenders: battle.defenders ?? [],
  };
  const dirty = draft !== null;
  /** TEAM B in full: the reference ship (world origin, closed-form check
   * anchor) plus every other defender — both sides are fleets now (v0.94.0) */
  const teamB = useMemo(
    () => [...(battle.target ? [battle.target] : []), ...(battle.defenders ?? [])],
    [battle.target, battle.defenders],
  );

  useEffect(() => {
    void getEsfData()
      .then((d) => setData(d as unknown as EsfDataShapes & DogmaLookup))
      .catch((e: unknown) => logWarn('battle', 'dogma bundle failed to load', { error: String(e) }));
  }, []);
  useEffect(() => {
    void loadTeamFits()
      .then((c) => setTeamFits(c.fits))
      .catch((e: unknown) => logWarn('battle', 'team fits failed to load', { error: String(e) }));
  }, []);
  // ASSIGN-ONCE azimuth for rosters saved before placement was real: fill
  // with the map's old spread so day one looks identical, then PERSIST — a
  // pure read-fallback would recompute from roster indices and re-spread
  // every placement whenever a ship was added. This is a deliberate write
  // outside the Calculate gate: it changes nothing the sim reads until the
  // user drags a dot, it only pins where the dots already were.
  useEffect(() => {
    const defs = battle.defenders ?? [];
    const aOk = battle.attackers.every((a) => a.azimuthDeg !== undefined);
    const dOk = defs.every((d) => d.azimuthDeg !== undefined);
    if (aOk && dOk) return;
    const n = battle.attackers.length;
    const patch: Partial<typeof battle> = {};
    if (!aOk) {
      patch.attackers = battle.attackers.map((a, i) => (
        a.azimuthDeg !== undefined ? a : { ...a, azimuthDeg: spreadAzimuth(i, n) }));
    }
    if (!dOk) {
      patch.defenders = defs.map((d, i) => (
        d.azimuthDeg !== undefined ? d : { ...d, azimuthDeg: spreadAzimuth(i, Math.max(defs.length, 1)) }));
    }
    setBattle(patch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [battle.attackers, battle.defenders]);

  /** a combatant's fit source → EFT text, whatever kind it is */
  const eftOf = useCallback((c: Combatant): string | null => {
    if (c.source.kind === 'eft') return c.source.text;
    if (c.source.kind === 'library') {
      const f = teamFits?.find((t) => t.key === (c.source as { key: string }).key);
      return f?.eft ?? null;
    }
    // A WIZARD FIT. variationEft is the same serializer the Fit Wizard's own
    // stats path uses, so a fit reads identically in both places. (Overheating
    // is the one thing EFT cannot carry; the wizard states that too.)
    const src = c.source as { fitId: string; variationId: string };
    const wf = wizardFits.find((f) => f.id === src.fitId);
    const v = wf?.variations.find((x) => x.id === src.variationId);
    return wf && v ? variationEft(wf, v) : null;
  }, [teamFits, wizardFits]);

  const all = useMemo(
    () => [...teamB, ...battle.attackers],
    [teamB, battle.attackers],
  );
  // follow the clone registry so a clone jump re-renders; the roster key
  // below uses the RESOLVED pod fingerprint, so the expensive rescoring
  // fires only when a pilot's actual pod changed — never on the registry's
  // every-poll broadcast (which also bumps mere timestamps)
  const [, setCloneRev] = useState(0);
  useEffect(() => {
    void initCloneRegistry();
    return onCloneRegistry(() => setCloneRev((v) => v + 1));
  }, []);
  const rosterKey = all.map((c) =>
    `${c.id}:${c.profile}:${c.characterId ?? 0}:${c.propRunning ? 1 : 0}:${JSON.stringify(c.ammo ?? {})}:${JSON.stringify(c.moduleStates ?? {})}:${JSON.stringify(c.moduleCharges ?? {})}:${JSON.stringify(c.moduleSwaps ?? {})}:${(podOf(c, characters.find((x) => x.characterId === c.characterId)) ?? []).join('.')}`).join(',');

  /**
   * Score every combatant. SEQUENTIAL AND YIELDING: each engine pass is ~25 ms
   * and now runs in a worker, but firing a dozen at once still queues them
   * behind each other with no chance to repaint. One at a time, with the
   * results landing as they arrive, keeps the roster responsive while it fills.
   */
  const resolvedRef = useRef<Map<string, Resolved>>(new Map());
  useEffect(() => { resolvedRef.current = resolved; }, [resolved]);
  useEffect(() => {
    if (!data) return;
    let dead = false;
    setBusy(true);
    const t0 = performance.now();
    void (async () => {
      // START FROM THE PREVIOUS RESULTS (v0.94.0). Beginning empty meant the
      // first ship to finish wiped every other card back to "scoring…" — so
      // the ~5-minute auto-refresh (and every edit) collapsed and rebuilt
      // the whole panel, card by card: the "UI jumps around at times"
      // report. A stale number for two seconds beats a vanished card;
      // ships no longer in the roster still drop out immediately.
      const ids = new Set(all.map((c) => c.id));
      const out = new Map<string, Resolved>(
        [...resolvedRef.current].filter(([id]) => ids.has(id)),
      );
      for (const c of all) {
        if (dead) return;
        const eft = eftOf(c);
        if (eft === null) {
          // TELL THE TRUTH ABOUT WHICH IT IS. The library arrives asynchronously,
          // so on a cold open every fit briefly "could not be found" — which
          // reads as data loss rather than a spinner.
          const stillLoading = c.source.kind === 'library' && teamFits === null;
          out.set(c.id, {
            combatant: c, fit: null, stats: null, cannotFly: [], requirements: [], ammoSlots: [], modules: [], cargoTypeIds: [],
            problem: stillLoading
              ? 'reading your saved fits from EVE…'
              : 'this fit could not be found — it may have been renamed or deleted in game',
          });
          setResolved(new Map(out));
          continue;
        }
        const fit = parseFit(eft);
        // the SAME integrity gate every other fitting surface applies
        if (fit.unresolved.length > 0) {
          out.set(c.id, {
            combatant: c, fit, stats: null, cannotFly: [], requirements: [], ammoSlots: [], modules: [], cargoTypeIds: [],
            problem: `${fit.unresolved.length} line(s) could not be resolved (${fit.unresolved.slice(0, 3).join(', ')}) — numbers withheld rather than computed from a partial fit`,
          });
          setResolved(new Map(out));
          continue;
        }
        // THE FIX FOR "everything reads zero": a saved fit often carries no
        // ammo, and an empty turret has no damage of its own. The user's
        // choice is applied BEFORE the engine sees the fit.
        const fit2 = c.ammo && Object.keys(c.ammo).length > 0 ? withAmmoMap(fit, c.ammo) : fit;
        const guns = ammoWeapons(data, fit2.items.map((i) => ({ typeId: i.typeId, qty: i.qty })));
        const ammoSlots = guns.map((g) => {
          const options = chargesForAll(data, [g.typeId]);
          return {
            typeId: g.typeId,
            name: g.name,
            qty: g.qty,
            loaded: fit2.items.find((i) => i.typeId === g.typeId)?.charges[0] ?? null,
            options,
            // sampled over what it can load: if nothing it accepts deals
            // damage, it is not a weapon and an empty one is not a problem
            isWeapon: options.some((id) => chargeDealsDamage(data, id)),
          };
        });
        // the SAME builder the engine path uses, so the keys line up exactly
        let moduleList: Resolved['modules'] = [];
        try {
          const built = toEsfFit(fit2, data);
          moduleList = built.esfFit.modules
            .filter((m) => m.slot.type !== 'Rig' && m.slot.type !== 'SubSystem')
            .map((m) => {
              const k = moduleKey(m);
              const options = chargesForAll(data, [m.type_id]);
              return {
                key: k,
                typeId: m.type_id,
                name: data.types[String(m.type_id)]?.name ?? `#${m.type_id}`,
                state: (c.moduleStates?.[k] ?? m.state) as ModuleState,
                charge: m.charge?.type_id ?? null,
                options,
                isWeapon: options.some((id) => chargeDealsDamage(data, id)),
                slotType: m.slot.type,
                states: moduleStateOptions(m.type_id, data,
                  (data as unknown as { dogmaEffects: Record<string, { effectCategory?: number }> })
                    .dogmaEffects ?? {}),
              };
            });
        } catch { /* an unresolvable fit is already refused below */ }
        // WHAT IS IN THE HOLD. toEsfFit reports overflow past a rack's
        // capacity in nonFit, but by NAME; the ids are recovered here so the
        // swap picker can offer them first.
        let cargoIds: number[] = [];
        try {
          const built2 = toEsfFit(fit2, data);
          const fitted = new Set(built2.esfFit.modules.map((m) => m.type_id));
          const counts = new Map<number, number>();
          for (const m of built2.esfFit.modules) counts.set(m.type_id, (counts.get(m.type_id) ?? 0) + 1);
          cargoIds = fit2.items
            .filter((it) => {
              const eff = data.typeDogma[String(it.typeId)]?.dogmaEffects ?? [];
              const slotted = eff.some((e) => SWAPPABLE_EFFECTS.has(e.effectID));
              if (!slotted) return false;
              return it.qty > (counts.get(it.typeId) ?? 0) || !fitted.has(it.typeId);
            })
            .map((it) => it.typeId);
        } catch { /* no cargo offered if the fit will not build */ }
        const min = minimumProfile(fit2, data);
        const char = characters.find((x) => x.characterId === c.characterId);
        const skills =
          c.profile === 'optimal' ? optimalSkills()
            : c.profile === 'minimum' ? min.skills
              : char?.skills ?? null;
        const implants = podOf(c, char);

        if (c.profile === 'character' && !char?.skills) {
          out.set(c.id, {
            combatant: c, fit: fit2, stats: null, cannotFly: [], requirements: min.requirements, ammoSlots, modules: moduleList, cargoTypeIds: cargoIds,
            problem: `${char?.characterName ?? 'that character'} has not synced skills — a fit scored with every skill at zero is not their fit`,
          });
          setResolved(new Map(out));
          continue;
        }
        try {
          const stats = await calculateFitStats(fit2, skills, implants, {
            propRunning: c.propRunning, moduleStates: c.moduleStates,
            moduleCharges: c.moduleCharges, moduleSwaps: c.moduleSwaps,
          });
          if (dead) return;
          // SCRAM SUPPORT: an MWD ship has TWO speed/signature states, and a
          // scram swaps between them mid-fight. The pair comes from a second
          // engine run with the prop toggled — measured, never derived.
          let statsAlt: FitStats | null = null;
          if (stats.mwdFitted) {
            statsAlt = await calculateFitStats(fit2, skills, implants, {
              propRunning: !(c.propRunning !== false), moduleStates: c.moduleStates,
              moduleCharges: c.moduleCharges, moduleSwaps: c.moduleSwaps,
            });
            if (dead) return;
          }
          // HARDENERS-DRY resonance: the third engine run, only when the fit
          // actually carries active resist hardeners (measured classifier)
          let statsDry: FitStats | null = null;
          if (stats.defenses.hardeners) {
            statsDry = await calculateFitStats(fit2, skills, implants, {
              propRunning: c.propRunning, moduleStates: c.moduleStates,
              moduleCharges: c.moduleCharges, moduleSwaps: c.moduleSwaps,
              resistHardenersOff: true,
            });
            if (dead) return;
          }
          // the engine NEVER refuses an unflyable fit, so this is our judgement
          const fly = canFly(fit2, data, skills);
          out.set(c.id, {
            combatant: c, fit: fit2, stats, statsAlt, statsDry, problem: null,
            cannotFly: fly.missing, requirements: min.requirements, ammoSlots, modules: moduleList, cargoTypeIds: cargoIds,
          });
        } catch (e: unknown) {
          out.set(c.id, {
            combatant: c, fit: fit2, stats: null, cannotFly: [], requirements: min.requirements, ammoSlots, modules: moduleList, cargoTypeIds: cargoIds,
            problem: e instanceof Error ? e.message : String(e),
          });
        }
        setResolved(new Map(out));
      }
      if (!dead) {
        setBusy(false);
        logInfo('battle', 'roster scored', {
          ships: all.length, ms: Math.round(performance.now() - t0),
        });
      }
    })();
    return () => { dead = true; };
    // rosterKey captures every input that changes a number
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, rosterKey, teamFits, characters]);

  const targetR = battle.target ? resolved.get(battle.target.id) ?? null : null;
  const attackerRs = battle.attackers.map((a) => resolved.get(a.id) ?? null);
  const defenderRs = (battle.defenders ?? []).map((d) => resolved.get(d.id) ?? null);

  /**
   * THE LIVE combatant for a scored ship.
   *
   * `resolved` caches the combatant it scored WITH, and range/behaviour
   * deliberately do NOT trigger a re-score because they change no fit stat —
   * so reading `r.combatant.range` meant the outcome used whatever range was
   * set when the engine last ran. Changing the range appeared to do nothing at
   * all, because it did nothing at all.
   */
  const liveOf = (id: string): Combatant | null =>
    (battle.target?.id === id ? battle.target
      : battle.attackers.find((a) => a.id === id)
      ?? (battle.defenders ?? []).find((d) => d.id === id)) ?? null;

  /** the target as the sim sees it — signature, speed and resists all from
   * ITS OWN fit and pilot, never typed in */
  const simTarget: SimTarget | null = useMemo(() => {
    if (!targetR?.stats || !battle.target) return null;
    const s = targetR.stats.summary;
    return {
      name: targetR.fit?.shipName ?? battle.target.name,
      signatureRadius: s.signatureRadius,
      velocity: s.maxVelocity,
      resonance: NO_RESISTS, // resists are applied PER LAYER in timeToKill
    };
  }, [targetR, battle.target]);

  const layers = useMemo(() => {
    if (!targetR?.stats) return [];
    const s = targetR.stats.summary;
    return layersOf(
      { shield: s.shieldHp, armor: s.armorHp, structure: s.structureHp },
      targetR.stats.resonance,
    );
  }, [targetR]);

  // -------------------------------------------------------------------------
  // FIGHT ASSEMBLY, shared (v0.97.0): the outcome memo and the win-rate
  // solver build the SAME fleet with the SAME kill order - the solver just
  // swaps one ship's engine stats for a candidate's before running it.
  // -------------------------------------------------------------------------
  const asEventShip = (
    r: Resolved, side: 'a' | 'b', range: number, atOrigin = false,
  ): EventShip | null => {
    if (!r.stats) return null;
    const live = liveOf(r.combatant.id) ?? r.combatant;
    const d = r.stats.defenses;
    const tauOf = (st: FitStats) =>
      (st.summary.mass > 0 && st.summary.agility > 0
        ? (st.summary.agility * st.summary.mass) / 1e6 : 0);
    // the MWD pair: `stats` is the state the pilot COMMANDED (propRunning),
    // `statsAlt` the toggled one — which is which depends on the toggle
    const propOn = r.combatant.propRunning !== false;
    const act = propOn ? r.stats : (r.statsAlt ?? r.stats);
    const inact = propOn ? (r.statsAlt ?? r.stats) : r.stats;
    const propPair = r.stats.mwdFitted && r.statsAlt
      ? {
        activeMaxVel: act.summary.maxVelocity,
        activeSig: act.summary.signatureRadius,
        inactiveMaxVel: inact.summary.maxVelocity,
        inactiveSig: inact.summary.signatureRadius,
        blockable: true,
      }
      : undefined;
    const hull = r.stats.hullAttributes;
    return {
      id: r.combatant.id,
      name: r.combatant.name,
      side,
      weapons: r.stats.simWeapons,
      repairs: d.cycles ?? [],
      capBoosters: d.capBoosters,
      capBoosterReserve: live.capBoosterCharges,
      injectDiscipline: live.injectRepping || undefined,
      // resists live only while the cap feeds the hardeners: drain measured
      // from the engine items, dry resonance from the third engine pass
      hardeners: d.hardeners && r.statsDry
        ? {
          capPerCycle: d.hardeners.capPerCycle,
          cycleSeconds: d.hardeners.cycleSeconds,
          dryResonance: layersOf({
            shield: r.stats.summary.shieldHp,
            armor: r.stats.summary.armorHp,
            structure: r.stats.summary.structureHp,
          }, r.statsDry.resonance).map((l) => l.resonance),
        }
        : undefined,
      capacitor: d.capacitor ?? { capacity: 0, tau: 0 },
      layers: layersOf({
        shield: r.stats.summary.shieldHp,
        armor: r.stats.summary.armorHp,
        structure: r.stats.summary.structureHp,
      }, r.stats.resonance),
      shieldRechargeSeconds: d.shieldRechargeSeconds,
      signatureRadius: r.stats.summary.signatureRadius,
      ...(() => {
        const hold = behaviourOf(live) === 'stationary' ? undefined : live.holdRange;
        const speed = speedOf(live, r.stats.summary.maxVelocity);
        // TRUE PLACEMENT (v0.93.0): the spherical inputs become a real 3D
        // position — azimuth on the map, elevation out of the plane. The
        // REFERENCE ship (Team B's first) is the origin; every other ship
        // on either team places relative to it (v0.94.0: both sides are
        // fleets, so Team B teammates get real positions too).
        const az = ((live.azimuthDeg ?? 0) * Math.PI) / 180;
        const el = ((live.elevationDeg ?? 0) * Math.PI) / 180;
        const pos0 = atOrigin ? undefined : {
          x: range * Math.cos(el) * Math.cos(az),
          y: range * Math.cos(el) * Math.sin(az),
          z: range * Math.sin(el),
        };
        // TRUE-EMULATION STEERING: the presets are per-tick controllers
        // under the measured inertia law — orbit is tangent-point pursuit
        // (its radius inflation for fast ships EMERGES), keep-at-range
        // holds the exact ring. A CUSTOM dial angle keeps the declared
        // constant-bearing spiral: it is a geometry statement, not a
        // pilot command, and it stays analytic.
        const b = behaviourOf(live);
        const custom = live.angleDeg !== undefined && live.angleDeg !== PRESET_ANGLE[b];
        const behaviour = custom || b === 'stationary' || speed === 0 ? undefined
          : b === 'orbit' ? { kind: 'orbit' as const, radiusM: hold ?? range }
            : b === 'keepAtRange' ? { kind: 'keepAtRange' as const, rangeM: hold ?? range }
              : hold !== undefined ? { kind: 'keepAtRange' as const, rangeM: hold }
                : { kind: 'approach' as const };
        // the legacy dial path still flies hold ranges the old way: burn
        // radially, arrive, circle
        const outOfPosition = hold !== undefined && Math.abs(range - hold) > 1;
        return {
          flying: {
            speed,
            angleDeg: outOfPosition ? (range > hold ? 0 : 180) : angleOf(live),
          },
          range,
          pos0,
          behaviour,
          anchorId: live.anchorId,
          commandedRange: behaviour === undefined && outOfPosition ? hold : undefined,
        };
      })(),
      droneOrbit: battle.droneOrbit,
      projected: r.stats.projected,
      propPair,
      tauActive: tauOf(act),
      tauInactive: tauOf(inact),
      // the EWAR resist gates, engine-final off the hull (default 1);
      // 2116 is state-gated — siege/bastion hulls carry it near zero
      resists: {
        2045: hull.get(2045) ?? 1,
        2113: hull.get(2113) ?? 1,
        2114: hull.get(2114) ?? 1,
        2115: hull.get(2115) ?? 1,
        2116: hull.get(2116) ?? 1,
      },
      nosOverride: (hull.get(1945) ?? 0) > 0,
      scanRes: hull.get(564),
      maxTargetRangeM: hull.get(76),
      // the primary sensor: the strongest of the four hull sensor attrs
      // (421 of 423 published hulls have exactly one nonzero; for the two
      // shuttles with all four, max is the declared tie-break)
      sensor: (() => {
        const cands: [number, number][] = [211, 209, 210, 208]
          .map((a) => [a, hull.get(a) ?? 0] as [number, number]);
        cands.sort((x, y) => y[1] - x[1]);
        return cands[0][1] > 0 ? { attr: cands[0][0], strength: cands[0][1] } : undefined;
      })(),
      bursts: r.stats.bursts,
      droneControlRangeM: r.stats.droneControlRangeM ?? undefined,
    };
  };

  /** the standing fleet, optionally with one ship rebuilt from candidate
   * stats (the win-rate solver's whole trick) */
  const buildFleet = (swap?: { id: string; r: Resolved }): EventShip[] => {
    const pickR = (r: Resolved | null): Resolved | null =>
      (r && swap && r.combatant.id === swap.id ? swap.r : r);
    const fleet: EventShip[] = [];
    for (const r0 of attackerRs) {
      const r = pickR(r0);
      if (!r?.stats) continue;
      const b = asEventShip(r, 'a', rangeOf(liveOf(r.combatant.id) ?? r.combatant));
      if (b) fleet.push(b);
    }
    // TEAM B: the reference ship anchors the origin; its teammates place
    // like everyone else, by their own range/azimuth/elevation
    const tr = pickR(targetR);
    if (tr?.stats) {
      const tgtShip = asEventShip(tr, 'b',
        rangeOf(liveOf(battle.attackers[0]?.id ?? '') ?? battle.attackers[0] ?? tr.combatant), true);
      if (tgtShip) fleet.push(tgtShip);
    }
    for (const r0 of defenderRs) {
      const r = pickR(r0);
      if (!r?.stats) continue;
      const b = asEventShip(r, 'b', rangeOf(liveOf(r.combatant.id) ?? r.combatant));
      if (b) fleet.push(b);
    }
    // N-of-the-same expansion (v0.108.0): a card with count N flies N
    // independent copies — same fit, behaviour and anchors
    const countById = new Map<string, number>();
    for (const c of [battle.target, ...battle.attackers, ...(battle.defenders ?? [])]) {
      if (c) countById.set(c.id, c.count ?? 1);
    }
    return expandCounts(fleet, (id) => countById.get(id) ?? 1);
  };

  /** THE KILL ORDER IS THE PLAYER'S (v0.95.0). Each team's damage focuses
   * the first ship on its list still alive, then the next; anything
   * unlisted falls back to finish-what-is-nearest-death. Healing
   * (most-damaged ally) and offensive EWAR (follows the kill target) keep
   * the sim's own rules - exactly how fleets are flown. */
  const pickTargetFor = (fleet: EventShip[]) => {
    const sideOfId = new Map(fleet.map((f) => [f.id, f.side]));
    return (shooterId: string, enemies: { id: string; alive: boolean; hpTotal: number }[]) => {
      const order = sideOfId.get(shooterId) === 'a'
        ? (battle.focusA ?? []) : (battle.focusB ?? []);
      for (const id of order) {
        // a multiplied ship's copies (id#2, id#3…) inherit its place in the
        // kill order — the fleet works through them one by one
        const e = enemies.find((x) => (x.id === id || x.id.startsWith(`${id}#`)) && x.alive);
        if (e) return e.id;
      }
      let best: { id: string; hpTotal: number } | null = null;
      for (const e of enemies) {
        if (!e.alive) continue;
        if (!best || e.hpTotal < best.hpTotal) best = e;
      }
      return best?.id ?? null;
    };
  };

  /**
   * ONE FIGHT, ONE NUMBER (the win-rate solver's objective). Wins count 1,
   * stalemates 0.5, losses 0 - averaged over the Monte Carlo seeds and
   * scaled to 1e6. The time tiebreak (win sooner / die later) is capped at
   * 4800, strictly below the 0.5-outcome granularity (5000 at n=100), so
   * time can never outvote an outcome.
   */
  const fightScore = (fleet: EventShip[], side: 'a' | 'b'): number | null => {
    if (fleet.length < 2 || !fleet.some((f) => f.side !== side)) return null;
    const mc = runMonteCarlo(fleet, { pickTarget: pickTargetFor(fleet), maxSeconds: SIM_HORIZON_S, extendWhileProgressing: true }, 100);
    const myWins = side === 'a' ? mc.winCount.a : mc.winCount.b;
    const theirWins = side === 'a' ? mc.winCount.b : mc.winCount.a;
    const nulls = mc.n - myWins - theirWins;
    const points = (myWins + 0.5 * nulls) / mc.n;
    const median = mc.decided.median;
    // tie stays in [0, 4800], strictly below the 0.5-outcome granularity
    // (5000 at n=100) — rescaled when the horizon moved 600 → SIM_HORIZON_S
    const TIE_SCALE = 4800 / SIM_HARD_MAX_S; // median can reach the extension cap
    const tie = median === null ? 2400
      : myWins >= theirWins
        ? Math.max(0, SIM_HARD_MAX_S - median) * TIE_SCALE
        : Math.min(SIM_HARD_MAX_S, median) * TIE_SCALE;
    /**
     * THE MARGIN GRADIENT (v0.97.2). Fights are volley-quantised: +5% and
     * +6% damage often kill on the SAME volley, so whole families of pods
     * tied exactly and the cost sort "recommended" the weaker implant
     * (caught live). Below the outcome and time layers sits a continuous
     * term - my team's mean remaining hp fraction plus the damage fraction
     * taken off the enemy, in the representative fight - scaled under 0.4
     * so it can never outvote a time gain the display would show (0.05 s).
     */
    let margin = 0;
    const rep = mc.representative;
    if (rep) {
      const mine = rep.ships.filter((x) => x.side === side);
      const foes = rep.ships.filter((x) => x.side !== side);
      const remOf = (x: { remaining: number[] }) =>
        (x.remaining.length > 0
          ? x.remaining.reduce((n, v) => n + v, 0) / x.remaining.length : 0);
      const myRem = mine.length > 0
        ? mine.reduce((n, x) => n + (x.alive ? remOf(x) : 0), 0) / mine.length : 0;
      const foeRem = foes.length > 0
        ? foes.reduce((n, x) => n + (x.alive ? remOf(x) : 0), 0) / foes.length : 0;
      margin = ((myRem + (1 - foeRem)) / 2) * 0.39;
    }
    return points * 1e6 + tie + margin;
  };

  /**
   * WHY did this pod change the fight? Re-run the SAME Monte Carlo with the
   * empty pod and with the candidate, diff the representative fights, and
   * say it in fight language - who died when, what this ship landed, where
   * its capacitor bottomed out - plus the engine-stat deltas that drove it.
   * Computed on demand when a candidate row is expanded.
   */
  const explainPod = async (c: Combatant, implants: number[]): Promise<string[]> => {
    if (!data) return ['engine not ready'];
    const eft = eftOf(c);
    if (eft === null) return ['fit not available'];
    const parsed = parseFit(eft);
    if (parsed.unresolved.length > 0) return ['fit does not resolve'];
    const withAmmo = c.ammo && Object.keys(c.ammo).length > 0 ? withAmmoMap(parsed, c.ammo) : parsed;
    const char = characters.find((x) => x.characterId === c.characterId);
    const skills = c.profile === 'optimal' ? optimalSkills()
      : c.profile === 'minimum' ? minimumProfile(withAmmo, data).skills
        : char?.skills ?? null;
    const opts = {
      propRunning: c.propRunning, moduleStates: c.moduleStates,
      moduleCharges: c.moduleCharges, moduleSwaps: c.moduleSwaps,
    };
    const base = resolved.get(c.id);
    if (!base) return ['ship not scored yet'];
    const statsFor = async (pod: number[]) => {
      const st = await calculateFitStats(withAmmo, skills, pod, opts);
      const alt = st.mwdFitted
        ? await calculateFitStats(withAmmo, skills, pod, { ...opts, propRunning: !c.propRunning })
        : null;
      return { st, alt };
    };
    const s0 = await statsFor([]);
    const s1 = await statsFor(implants);
    const mkFleet = (x: { st: typeof s0.st; alt: typeof s0.alt }) =>
      buildFleet({ id: c.id, r: { ...base, stats: x.st, statsAlt: x.alt ?? undefined } });
    const fl0 = mkFleet(s0);
    const fl1 = mkFleet(s1);
    if (fl0.length < 2) return ['no opposing team to fight'];
    const f0 = runMonteCarlo(fl0, { pickTarget: pickTargetFor(fl0), maxSeconds: SIM_HORIZON_S, extendWhileProgressing: true }, 100).representative;
    const f1 = runMonteCarlo(fl1, { pickTarget: pickTargetFor(fl1), maxSeconds: SIM_HORIZON_S, extendWhileProgressing: true }, 100).representative;
    if (!f0 || !f1) return ['the fight would not run'];
    const lines: string[] = [];
    const describe = (f: EventBattleResult): string =>
      f.winner === null
        ? (f.seconds === null ? `stalemate — the fight stopped moving (simulated up to ${SIM_HARD_MAX_S / 3600}h; a converging fight is never cut off)` : `mutual kill at ${secs(f.seconds)}`)
        : `Team ${f.winner.toUpperCase()} wins in ${secs(f.seconds)}`;
    const d0 = describe(f0);
    const d1 = describe(f1);
    if (d0 !== d1) lines.push(`${d0} → ${d1}`);
    for (const sh1 of f1.ships) {
      const sh0 = f0.ships.find((x) => x.id === sh1.id);
      if (!sh0) continue;
      const who = sh1.id === c.id ? 'this ship' : sh1.name;
      if (sh0.diedAt !== null && sh1.diedAt !== null) {
        if (Math.abs(sh0.diedAt - sh1.diedAt) > 0.2) {
          lines.push(`${who} dies at ${secs(sh0.diedAt)} → ${secs(sh1.diedAt)}`);
        }
      } else if (sh0.diedAt === null && sh1.diedAt !== null) {
        lines.push(`${who} now DIES (${secs(sh1.diedAt)}) — it survived before`);
      } else if (sh0.diedAt !== null && sh1.diedAt === null) {
        lines.push(`${who} now SURVIVES — died at ${secs(sh0.diedAt)} before`);
      }
    }
    const me0 = f0.ships.find((x) => x.id === c.id);
    const me1 = f1.ships.find((x) => x.id === c.id);
    if (me0 && me1) {
      if (me0.volleysFired > 0 && me1.volleysFired > 0) {
        const pv0 = me0.damageDealt / me0.volleysFired;
        const pv1 = me1.damageDealt / me1.volleysFired;
        if (pv0 > 0 && Math.abs(pv1 - pv0) > pv0 * 0.005) {
          lines.push(`lands ${n0(pv1)} per volley (was ${n0(pv0)}, ${pv1 > pv0 ? '+' : ''}${(((pv1 - pv0) / pv0) * 100).toFixed(1)}%)`);
        }
      }
      const cd = (me1.capMinFrac - me0.capMinFrac) * 100;
      if (Math.abs(cd) >= 3) {
        lines.push(`capacitor floor ${(me0.capMinFrac * 100).toFixed(0)}% → ${(me1.capMinFrac * 100).toFixed(0)}%`);
      }
    }
    const stat = (label: string, a: number, b: number, unit = '') => {
      if (a > 0 && Math.abs(b - a) > a * 0.005) lines.push(`${label} ${n0(a)}${unit} → ${n0(b)}${unit}`);
    };
    stat('sustained dps', s0.st.summary.dpsSustained, s1.st.summary.dpsSustained);
    stat('speed', s0.st.summary.maxVelocity, s1.st.summary.maxVelocity, ' m/s');
    stat('signature', s0.st.summary.signatureRadius, s1.st.summary.signatureRadius, ' m');
    stat('EHP', s0.st.summary.ehp, s1.st.summary.ehp);
    // inertia is REAL physics in the motion model (orbit tightness, burn
    // ramps) — without this line an agility set's contribution was
    // invisible and its ranking read as arbitrary (caught live: "why is
    // Nomad such a high recommendation?")
    const tau0 = (s0.st.summary.agility * s0.st.summary.mass) / 1e6;
    const tau1 = (s1.st.summary.agility * s1.st.summary.mass) / 1e6;
    if (tau0 > 0 && Math.abs(tau1 - tau0) > tau0 * 0.005) {
      lines.push(`inertia τ ${tau0.toFixed(2)}s → ${tau1.toFixed(2)}s (turns ${tau1 < tau0 ? 'quicker' : 'slower'})`);
    }
    if (lines.length === 0) lines.push('no measurable difference in this fight');
    return lines;
  };

  /**
   * PROJECTED-EFFECT FOLD, generalised (v0.98.7): the painters (sig 552)
   * and webs (speed 37) of ONE side, folded onto ONE victim through the
   * fight's own arithmetic - engine-final rows, falloff at each shooter's
   * fight range, the victim's resist gate, the measured stacking chain.
   * Used by the closed-form check (Team A onto the reference) and by the
   * damage chart for WHICHEVER side is focused.
   */
  const projFold = (
    shooters: (Resolved | null)[], victimR: Resolved,
  ): { sigMult: number; velMult: number } => {
    const paintRows: { value: number; stackable: boolean }[] = [];
    const webRows: { value: number; stackable: boolean }[] = [];
    const resistOf = (attr?: number): number => {
      if (attr === undefined) return 1;
      const v = victimR.stats?.hullAttributes.get(attr);
      return v === undefined || !Number.isFinite(v) ? 1 : v;
    };
    for (const r of shooters) {
      if (!r?.stats?.projected || r.combatant.id === victimR.combatant.id) continue;
      const live = liveOf(r.combatant.id) ?? r.combatant;
      const atRange = behaviourOf(live) !== 'stationary' && live.holdRange !== undefined
        ? live.holdRange : rangeOf(live);
      for (const pm of r.stats.projected) {
        if (pm.kind !== 'painter' && pm.kind !== 'web') continue;
        const scale = projFalloffScale(atRange, pm.optimal, pm.falloff) * resistOf(pm.resistAttr);
        if (scale <= 0) continue;
        for (const row of pm.rows ?? []) {
          if (pm.kind === 'painter' && row.modifies === 552 && row.value !== 0) {
            paintRows.push({ value: row.value * scale, stackable: row.stackable });
          }
          if (pm.kind === 'web' && row.modifies === 37 && row.value !== 0) {
            webRows.push({ value: row.value * scale, stackable: row.stackable });
          }
        }
      }
    }
    return { sigMult: chainMultiplier(paintRows), velMult: chainMultiplier(webRows) };
  };

  /** the shooters and the default victim for a focused chart side: Team A
   * shoots the reference; Team B shoots the FIRST Team A ship - the same
   * convention the return-fire estimate has always used */
  const shooterRsOf = (side: 'a' | 'b'): (Resolved | null)[] =>
    (side === 'a' ? attackerRs : [targetR, ...defenderRs]);
  const victimROf = (side: 'a' | 'b'): Resolved | null =>
    (side === 'a' ? targetR : attackerRs.find((r) => r?.stats) ?? null);

  /** every attacker's landed damage, summed, plus the fight's length */
  const outcome = useMemo(() => {
    if (!simTarget || layers.length === 0 || !targetR?.stats) return null;
    const liveTarget = liveOf(targetR.combatant.id) ?? targetR.combatant;
    const targetSpeed = targetR.stats.summary.maxVelocity;
    const targetFlownSpeed = speedOf(liveTarget, targetSpeed);
    const targetAngle = angleOf(liveTarget);

    /**
     * PROJECTED EFFECTS IN THE PAPER CHECK (v0.94.0, generalised 0.98.7 via
     * projFold): the fight always applied painters and webs; this panel
     * folds Team A's onto the reference through the same arithmetic.
     * Uptime assumed continuous - the fight remains the ground truth.
     */
    const { sigMult, velMult } = projFold(attackerRs, targetR);
    const paintedSig = simTarget.signatureRadius * sigMult;
    const webbedSpeed = targetFlownSpeed * velMult;
    const contributions: {
      name: string; applied: number; sustained: number; landing: number;
      transversal: number; angular: number; weapons: number; note: string | null;
    }[] = [];
    const groups: { w: SimWeapon[]; e: Engagement }[] = [];

    for (const r of attackerRs) {
      if (!r?.stats) continue;
      const live = liveOf(r.combatant.id) ?? r.combatant;
      // the closed-form row describes the ship WHERE IT FIGHTS: its hold
      // range when one is set (the event sim flies there), else its start.
      // Evaluating at a 100 km start while the fight happens at a 20 km hold
      // printed "applied 0" beside a fight that landed 21 dps — both true,
      // one misleading (caught in the Guardian report).
      const fightRange = behaviourOf(live) !== 'stationary' && live.holdRange !== undefined
        ? live.holdRange : rangeOf(live);
      const g = geometryFrom(
        {
          speed: speedOf(live, r.stats.summary.maxVelocity),
          angleDeg: angleOf(live),
          range: fightRange,
        },
        // the target flies at its WEBBED speed for everyone's tracking
        { speed: webbedSpeed, angleDeg: targetAngle },
        battle.droneOrbit,
      );
      // the MISSILE formula reads the target's speed off SimTarget, and that
      // speed depends on what the target is doing — a stationary target cannot
      // outrun an explosion. Signature carries the folded paint.
      const tgt: SimTarget = { ...simTarget, signatureRadius: paintedSig, velocity: g.targetSpeed };
      const shipCount = Math.max(1, Math.floor(r.combatant.count ?? 1));
      for (let k = 0; k < shipCount; k += 1) groups.push({ w: r.stats.simWeapons, e: g.engagement });
      const d = appliedDps(r.stats.simWeapons, tgt, g.engagement);
      contributions.push({
        name: shipCount > 1 ? `${r.combatant.name} ×${shipCount}` : r.combatant.name,
        applied: d.applied * shipCount,
        sustained: d.appliedSustained * shipCount,
        landing: d.raw > 0 ? d.applied / d.raw : 0,
        transversal: g.transversal,
        angular: g.angularVelocity,
        weapons: r.stats.simWeapons.length,
        // THE MISSING EXPLANATION. A fit with no ammo scores exactly zero and
        // said nothing about why — which is what "only getting 0s" looked like.
        note: r.stats.simWeapons.length === 0
          ? 'no weapon in this fit is loaded — a turret or launcher carries no damage of its own, so an empty one scores zero. Saved fits often contain no ammo at all.'
          : d.raw === 0 ? 'weapons found but no damage' : null,
      });
    }
    if (groups.length === 0) return null;
    const tgtForTtk: SimTarget = { ...simTarget, signatureRadius: paintedSig, velocity: webbedSpeed };
    // THE TARGET REPAIRS ITSELF. A Tengu with a big shield booster was being
    // killed as if it had none, which is the single largest error a battle sim
    // can make. Reps run at full duty until the engine's own measured cap-out.
    const ttk = timeToKillTeam(groups, tgtForTtk, layers, battle.sustained, targetR.stats.defenses);

    /**
     * AND THE TARGET SHOOTS BACK.
     *
     * A sim where one side cannot return fire is a damage calculator, not a
     * battle — and it makes the whole "should I tank or should I kill it
     * faster" question unanswerable, because killing faster never showed up as
     * a defence.
     *
     * The target focuses the FIRST attacker: with one gun and several targets
     * that is what actually happens, and splitting damage evenly across a fleet
     * would be a guess about behaviour rather than a measurement.
     *
     * The geometry is the SAME engagement seen from the other end — relative
     * tangential velocity has the same magnitude whichever ship you stand on —
     * so the return fire is scored at the primary's own range and heading.
     */
    let incoming: {
      victim: string;
      ttk: ReturnType<typeof timeToKillTeam>;
      dps: number;
    } | null = null;
    const primary = attackerRs.find((x) => x?.stats && x.stats.simWeapons.length >= 0) ?? null;
    if (primary?.stats && targetR.stats.simWeapons.length > 0) {
      const livePrimary = liveOf(primary.combatant.id) ?? primary.combatant;
      const g = geometryFrom(
        { speed: targetFlownSpeed, angleDeg: targetAngle, range: rangeOf(livePrimary) },
        {
          speed: speedOf(livePrimary, primary.stats.summary.maxVelocity),
          angleDeg: angleOf(livePrimary),
        },
        battle.droneOrbit,
      );
      const victimAsTarget: SimTarget = {
        name: primary.combatant.name,
        signatureRadius: primary.stats.summary.signatureRadius,
        velocity: g.targetSpeed,
        resonance: NO_RESISTS,
      };
      const victimLayers = layersOf(
        {
          shield: primary.stats.summary.shieldHp,
          armor: primary.stats.summary.armorHp,
          structure: primary.stats.summary.structureHp,
        },
        primary.stats.resonance,
      );
      incoming = {
        victim: primary.combatant.name,
        ttk: timeToKillTeam(
          [{ w: targetR.stats.simWeapons, e: g.engagement }],
          victimAsTarget, victimLayers, battle.sustained, primary.stats.defenses,
        ),
        dps: appliedDps(targetR.stats.simWeapons, victimAsTarget, g.engagement).appliedSustained,
      };
    }

    /**
     * AND THE ACTUAL FIGHT — the discrete event simulation.
     *
     * Everything above is closed-form: sum the damage, divide the hit points.
     * That is fine for one-versus-one and quietly wrong for anything else,
     * because it cannot express a ship DYING, a volley LANDING AS ONE HIT, a
     * clip running dry, or a repair cycle mid-heal when the alpha arrives.
     *
     * So the fight is run as events, and THAT is the headline: every weapon
     * fires on its own clock, volleys land whole, clips reload in real
     * silence, shield boosters heal at cycle start and armour repairers at
     * cycle end, the capacitor is a quantity every activation pays, passive
     * regen follows the true level-dependent curve, ancillary charges run
     * out, disintegrators spool, and a closing ship actually closes.
     */
    const fleet = buildFleet();
    const mc = fleet.length >= 2 ? runMonteCarlo(fleet, { pickTarget: pickTargetFor(fleet), maxSeconds: SIM_HORIZON_S, extendWhileProgressing: true }, 100) : null;
    const fight: EventBattleResult | null = mc?.representative ?? null;

    // repair modules the data could not score — a silent zero would be
    // indistinguishable from "no tank", which is the one lie this pipeline
    // exists to never tell
    const refusals = [targetR, ...attackerRs, ...defenderRs].flatMap((r) => [
      ...(r?.stats?.defenses.refused ?? []).map((x) => ({ ship: r!.combatant.name, typeId: x.typeId, why: x.why })),
      ...(r?.stats?.projRefused ?? []).map((x) => ({ ship: r!.combatant.name, typeId: x.typeId, why: x.why })),
    ]);

    return { contributions, ttk, incoming, fight, mc, refusals, sigMult, velMult };
    // battle.target/attackers/defenders are read through liveOf, so they are deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attackerRs, defenderRs, simTarget, layers, targetR, battle.target, battle.attackers, battle.defenders, battle.sustained, battle.droneOrbit, battle.focusA, battle.focusB]);

  // LOG WHAT IT ACTUALLY PRODUCED. "roster scored" told me the engine ran but
  // nothing about the answer, which is exactly what I needed when this first
  // came back all zeros.
  const outcomeKey = outcome
    ? `${outcome.ttk.seconds}|${outcome.fight?.winner ?? '-'}:${outcome.fight?.seconds ?? '-'}|${outcome.contributions.map((c) => `${c.name}:${Math.round(c.applied)}:${c.weapons}`).join(',')}`
    : '';
  useEffect(() => {
    if (!outcome) return;
    logInfo('battle', 'outcome', {
      // the running version, on the line itself: outcome shapes change
      // between releases and "which build produced this" must be one grep
      v: __APP_VERSION__,
      // THE FIGHT is the headline the user sees — it must be the headline the
      // log records, or a loss reported as a bug is undiagnosable
      fight: outcome.fight ? {
        seed: outcome.fight.seed,
        draws: outcome.fight.drawCount,
        mc: outcome.mc?.mode === 'stochastic'
          ? { n: outcome.mc.n, winA: outcome.mc.winCount.a, winB: outcome.mc.winCount.b }
          : null,
        winner: outcome.fight.winner,
        seconds: outcome.fight.seconds === null ? null : Math.round(outcome.fight.seconds * 10) / 10,
        deaths: outcome.fight.events.filter((e) => e.kind === 'death')
          .map((e) => `${e.who}@${Math.round(e.t)}s`),
        capStarved: outcome.fight.events.filter((e) => e.kind === 'capStarved')
          .map((e) => `${e.who}:${e.detail}`),
        reloads: outcome.fight.events.filter((e) => e.kind === 'reloadStart').length,
        scrams: outcome.fight.events.filter((e) => e.kind === 'scrammed' || e.kind === 'scramReleased')
          .map((e) => `${e.who}@${Math.round(e.t)}s ${e.kind}`),
        neuts: outcome.fight.events.filter((e) => e.kind === 'neuted').length,
        remoteHeals: outcome.fight.events.filter((e) => e.kind === 'repped').length,
        // cap-stick audit (v0.112.0): every injection is on the timeline with
        // how much LANDED — partial landings are the greedy-waste signature
        injections: outcome.fight.events.filter((e) => e.kind === 'injected').length,
        injectionsPartial: outcome.fight.events.filter((e) => e.kind === 'injected'
          && e.detail !== undefined && !/^(\d+) of \1 /.test(e.detail)).length,
        // resist collapses (v0.114.0) — fight-deciding, always audited
        hardenerDrops: outcome.fight.events.filter((e) => e.kind === 'hardenersDown')
          .map((e) => `${e.who}@${Math.round(e.t)}s`),
        ships: outcome.fight.ships.map((x) => ({
          name: x.name, alive: x.alive, dealt: Math.round(x.damageDealt),
          volleys: x.volleysFired, healed: Math.round(x.healsApplied),
          capMin: Math.round(x.capMinFrac * 100),
          // per-layer fractions left — a "zero health but alive" report is
          // diagnosable from this line alone (it caught the immortal-hull bug)
          left: x.remaining.map((r2) => Math.round(r2 * 100)),
        })),
      } : null,
      refused: outcome.refusals.map((x) => `${x.ship}:${x.typeId}:${x.why}`),
      ttkSeconds: outcome.ttk.seconds === null ? null : Math.round(outcome.ttk.seconds),
      attackers: outcome.contributions.map((c) => ({
        name: c.name, weapons: c.weapons,
        applied: Math.round(c.applied), landing: Math.round(c.landing * 100),
        transversal: Math.round(c.transversal), note: c.note,
      })),
    });
    // keyed on the CONTENT: `outcome` is a fresh object every render, so
    // depending on it wrote a diagnostic line for every keystroke
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outcomeKey]);

  /** which side the damage chart is looking FROM (v0.98.7) */
  const [chartSide, setChartSide] = useState<'a' | 'b'>('a');

  /** what the curve is drawn from — the SCORED weapons, at the LIVE geometry */
  const chartShipsOf = (side: 'a' | 'b'): ChartShip[] => shooterRsOf(side).flatMap((r) => {
    if (!r?.stats || r.stats.simWeapons.length === 0) return [];
    const live = liveOf(r.combatant.id) ?? r.combatant;
    return [{
      id: r.combatant.id,
      name: r.combatant.name,
      weapons: r.stats.simWeapons,
      angleDeg: angleOf(live),
      speed: speedOf(live, r.stats.summary.maxVelocity),
      range: rangeOf(live),
    }];
  });
  const chartShips = chartShipsOf(chartSide);

  /** the focused side's VICTIM as the chart sees it — signature painted and
   * speed webbed by the SHOOTING side's own projections */
  const victimViewOf = (side: 'a' | 'b') => {
    const vr = victimROf(side);
    if (!vr?.stats) return null;
    const vlive = liveOf(vr.combatant.id) ?? vr.combatant;
    const fold = projFold(shooterRsOf(side), vr);
    const sum = vr.stats.summary;
    return {
      name: vr.combatant.name,
      sim: {
        name: vr.fit?.shipName ?? vr.combatant.name,
        signatureRadius: sum.signatureRadius * fold.sigMult,
        velocity: sum.maxVelocity,
        resonance: NO_RESISTS,
      } as SimTarget,
      layers: layersOf(
        { shield: sum.shieldHp, armor: sum.armorHp, structure: sum.structureHp },
        vr.stats.resonance,
      ),
      angle: angleOf(vlive),
      speed: speedOf(vlive, sum.maxVelocity) * fold.velMult,
      maxVel: sum.maxVelocity,
    };
  };

  /** far enough out that the tail is visible rather than cropped, and never
   * shorter than where the ships are actually standing */
  const chartMaxRange = useMemo(() => {
    const reach = chartShips.flatMap((s2) => s2.weapons.map((w) =>
      w.kind === 'missile' ? (w.maxRange ?? 0)
        : w.kind === 'drone' ? 60000
          : (w.optimal ?? 0) + 3 * (w.falloff ?? 0)));
    const standing = chartShips.map((s2) => s2.range * 1.4);
    return Math.max(20000, Math.ceil((Math.max(0, ...reach, ...standing) * 1.1) / 5000) * 5000);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(chartShips.map((s2) => [s2.id, s2.range, s2.weapons.length]))]);

  /**
   * AMMO COMPARISON (v0.98.0 — "ammunition application graphs for selecting
   * the right ammo for a fight"). Pick a ship and a weapon group: every
   * damage-dealing charge it can load is run through the REAL engine, and
   * each becomes a line on the applied-damage-by-range chart plus a row in
   * a ranking at the ship's own fight range against the painted, webbed
   * reference target. The chart draws the top curves; the table ranks every
   * charge; one click loads a pick (committed by Calculate, as always).
   */
  /** eight visually distinct hues for ammo curves — the team palette's
   * blues were indistinguishable at eight lines (caught by screenshot) */
  const AMMO_PALETTE = ['#ffd166', '#06d6a0', '#ef476f', '#4cc9f0',
    '#f78c6b', '#b388eb', '#e9ff70', '#f2f2f2'];
  const shortCharge = (n: string) => n.replace(' Charge ', ' ');
  const [ammoPick, setAmmoPick] = useState<{ shipId: string; typeId: number } | null>(null);
  /**
   * THE GEOMETRY ASSUMPTION, made visible (v0.98.5). Our curves sweep range
   * with the roster's ACTUAL headings - a head-on or stationary target has
   * zero transversal at every range, so rails plateau from point blank
   * (physically correct for that motion). pyfa's Application Profile
   * instead assumes the target at FULL SPEED PERPENDICULAR at every range,
   * which crushes close-range application and makes the hump. Both are
   * real questions; the toggle picks which one the chart answers.
   */
  const [ammoGeom, setAmmoGeom] = useState<'flown' | 'perp'>('flown');
  const [ammoRows, setAmmoRows] = useState<{
    chargeId: number; name: string; ship: ChartShip; atHold: number;
    /** attribute-identical faction twins folded into this row (v0.98.3) */
    twins: string[];
    marketNote: string | null;
  }[] | null>(null);
  const ammoRun = useRef(0);
  useEffect(() => {
    setAmmoRows(null);
    if (!ammoPick || !data) return;
    const r = resolved.get(ammoPick.shipId);
    const c = liveOf(ammoPick.shipId);
    if (!r?.stats || !c) return;
    const slot = r.ammoSlots.find((a) => a.typeId === ammoPick.typeId);
    if (!slot) return;
    const options = slot.options.filter((id) => chargeDealsDamage(data, id));
    if (options.length === 0) return;
    const mine = ++ammoRun.current;
    const groupKeys = r.modules.filter((m) => m.typeId === ammoPick.typeId).map((m) => m.key);
    const eft = eftOf(c);
    if (eft === null) return;
    const parsed = parseFit(eft);
    if (parsed.unresolved.length > 0) return;
    const withAmmo = c.ammo && Object.keys(c.ammo).length > 0 ? withAmmoMap(parsed, c.ammo) : parsed;
    const char = characters.find((x) => x.characterId === c.characterId);
    const skills = c.profile === 'optimal' ? optimalSkills()
      : c.profile === 'minimum' ? minimumProfile(withAmmo, data).skills
        : char?.skills ?? null;
    const fightRange = behaviourOf(c) !== 'stationary' && c.holdRange !== undefined
      ? c.holdRange : rangeOf(c);
    void (async () => {
      type RawRow = {
        chargeId: number; name: string; ship: ChartShip; atHold: number;
      };
      // the victim is the opposing side's default: the reference for a Team
      // A shooter, the first Team A ship for a Team B shooter
      const pickSide: 'a' | 'b' = battle.attackers.some((x) => x.id === ammoPick.shipId) ? 'a' : 'b';
      const vv = victimViewOf(pickSide);
      const rows: RawRow[] = [];
      for (const chargeId of options) {
        if (ammoRun.current !== mine) return;
        try {
          const charges: Record<string, number | null> = { ...(c.moduleCharges ?? {}) };
          for (const k of groupKeys) charges[k] = chargeId;
          const st = await calculateFitStats(withAmmo, skills, podOf(c, char) ?? [], {
            propRunning: c.propRunning,
            moduleStates: c.moduleStates,
            moduleCharges: charges,
            moduleSwaps: c.moduleSwaps,
          });
          const ship: ChartShip = {
            id: `ammo-${chargeId}`,
            name: shortCharge(typeNameOf(chargeId)),
            weapons: st.simWeapons,
            angleDeg: angleOf(c),
            speed: speedOf(c, st.summary.maxVelocity),
            range: fightRange,
          };
          // ranked at the ship's own fight range, against the same painted,
          // webbed target the closed-form check uses
          let atHold = 0;
          if (vv) {
            const g = geometryFrom(
              { speed: speedOf(c, st.summary.maxVelocity), angleDeg: angleOf(c), range: fightRange },
              { speed: vv.speed, angleDeg: vv.angle },
              battle.droneOrbit,
            );
            atHold = appliedDps(st.simWeapons, {
              ...vv.sim,
              velocity: g.targetSpeed,
            }, g.engagement).appliedSustained;
          }
          rows.push({ chargeId, name: shortCharge(typeNameOf(chargeId)), ship, atHold });
          if (ammoRun.current === mine) {
            setAmmoRows([...rows].sort((a, b) => b.atHold - a.atHold)
              .map((x) => ({ ...x, twins: [], marketNote: null })));
          }
        } catch {
          // a charge the engine refuses is skipped, not faked
        }
      }
      /**
       * FOLD THE FACTION TWINS (v0.98.3). Federation Navy and Caldari Navy
       * Plutonium L are ATTRIBUTE-IDENTICAL in CCP's data (probed
       * 2026-08-12) — equal chart numbers are real, not rounding. Rows
       * whose application-relevant weapon numbers match exactly collapse
       * into one, and the row is NAMED by the variant actually worth
       * buying: enough stock on Jita (>= 100k units preferred) and the
       * cheapest robust ask among those. No market data = first name and
       * an honest note.
       */
      const sig = (ship: ChartShip): string => JSON.stringify(
        ship.weapons.map((w) => [w.volley, w.cycleSeconds, w.optimal, w.falloff,
          w.tracking, w.sigResolution, w.missileVelocity, w.maxRange,
          w.expRadius, w.expVelocity, w.drf, w.capPerCycle]),
      );
      const groups = new Map<string, RawRow[]>();
      for (const row of rows) {
        const k = sig(row.ship);
        groups.set(k, [...(groups.get(k) ?? []), row]);
      }
      let aggs: Awaited<ReturnType<typeof fetchAggregates>> | null = null;
      try {
        aggs = await fetchAggregates(BUILTIN_HUBS[0], rows.map((x) => x.chargeId));
      } catch {
        aggs = null;
      }
      if (ammoRun.current !== mine) return;
      const LIQUID = 100_000;
      const grouped = [...groups.values()].map((g) => {
        let primary = g[0];
        let note: string | null = null;
        if (g.length > 1 && aggs) {
          const scored = g.map((x) => {
            const a = aggs!.get(x.chargeId);
            return { x, stock: a?.sell.volume ?? 0, ask: a?.sell.percentile ?? Infinity };
          });
          const liquid = scored.filter((y) => y.stock >= LIQUID);
          const pool = liquid.length > 0 ? liquid : scored.sort((y, z) => z.stock - y.stock).slice(0, 1);
          pool.sort((y, z) => y.ask - z.ask);
          primary = pool[0].x;
          note = `${Math.round(pool[0].stock / 1000)}k on sale at Jita, ${isk(pool[0].ask)} each`;
        } else if (g.length > 1) {
          note = 'market data unavailable — named arbitrarily among identical twins';
        }
        return {
          ...primary,
          twins: g.filter((x) => x.chargeId !== primary.chargeId).map((x) => x.name),
          marketNote: note,
        };
      }).sort((a, b) => b.atHold - a.atHold);
      if (ammoRun.current === mine) setAmmoRows(grouped);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ammoPick, data, rosterKey, outcomeKey]);

  /**
   * SCORE THIS FIT WITH ONE SLOT SET TO A GIVEN MODULE — the real engine, not
   * an estimate.
   *
   * The cheap version compared a module's SDE cpu attribute against remaining
   * headroom, and that is wrong for every module, not merely for the ones that
   * change the grid: attribute 50 is the BASE cost, before Electronics
   * Upgrades, before implants, before a co-processor. Only the engine knows
   * what a module actually costs this pilot on this hull.
   *
   * Measured against the PENDING fit — every unapplied swap, state and charge —
   * because the whole point is asking "now that I freed up grid, what fits?"
   * before pressing Calculate.
   *
   * `typeId` null empties the slot, which is how the baseline is taken.
   */
  const testSlot = useCallback(async (
    c: Combatant, slotKey: string, typeId: number | null,
  ): Promise<SlotBudget | null> => {
    if (!data) return null;
    const eft = eftOf(c);
    if (eft === null) return null;
    try {
      const parsedFit = parseFit(eft);
      if (parsedFit.unresolved.length > 0) return null;
      const withAmmoApplied = c.ammo && Object.keys(c.ammo).length > 0
        ? withAmmoMap(parsedFit, c.ammo) : parsedFit;
      const char = characters.find((x) => x.characterId === c.characterId);
      const skills = c.profile === 'optimal' ? optimalSkills()
        : c.profile === 'minimum' ? minimumProfile(withAmmoApplied, data).skills
          : char?.skills ?? null;
      const stats = await calculateFitStats(withAmmoApplied, skills,
        podOf(c, char), {
          propRunning: c.propRunning,
          moduleStates: c.moduleStates,
          moduleCharges: c.moduleCharges,
          moduleSwaps: { ...(c.moduleSwaps ?? {}), [slotKey]: typeId },
        });
      return {
        cpu: stats.cpu.output - stats.cpu.load,
        power: stats.power.output - stats.power.load,
        calibration: stats.calibration.output - stats.calibration.load,
      };
    } catch {
      return null;
    }
  }, [data, eftOf, characters]);

  const [solving, setSolving] = useState<{ id: string; done: number; total: number } | null>(null);
  /** one result PER SHIP — searching a second ship used to discard the first,
   * which is exactly when you want to compare them */
  const [solutions, setSolutions] = useState<Map<string, SolveResult & { fight?: boolean }>>(new Map());
  const solveRun = useRef(0);
  /** average price for EVERY type in the game, from one cached ESI call —
   * never one request per implant. Fetched lazily on the first search. */
  const prices = useRef<Map<number, number> | null>(null);

  /**
   * FIND THE BEST POD for one combatant, judged on what it is here to do.
   *
   * The objective is NOT paper DPS. An implant that raises applied damage by a
   * third can leave paper DPS untouched — tracking and range implants do
   * exactly that — so an attacker is scored on how fast it kills THIS target at
   * THIS range, and the target on how long it survives the team. Both are
   * seconds, so both are comparable, and the panel says which was optimised.
   */
  const solveFor = useCallback(async (c: Combatant, deep: boolean) => {
    if (!data) return;
    const mine = ++solveRun.current;
    setSolving({ id: c.id, done: 0, total: 1 });
    const eft = eftOf(c);
    if (eft === null) { setSolving(null); return; }
    const parsedFit = parseFit(eft);
    if (parsedFit.unresolved.length > 0) { setSolving(null); return; }
    const withAmmoApplied = c.ammo && Object.keys(c.ammo).length > 0
      ? withAmmoMap(parsedFit, c.ammo) : parsedFit;
    const char = characters.find((x) => x.characterId === c.characterId);
    const skills = c.profile === 'optimal' ? optimalSkills()
      : c.profile === 'minimum' ? minimumProfile(withAmmoApplied, data).skills
        : char?.skills ?? null;
    const isTargetShip = battle.target?.id === c.id;
    // is there a fight to score against? (decides display semantics too)
    const fightAvailable = buildFleet().length >= 2;

    // ONE call for the whole game's prices, cached by lib/market. Costing 800
    // implants must never mean 800 requests.
    if (!prices.current) {
      try { prices.current = await fetchMarketPrices(); } catch { prices.current = null; }
    }

    const t0 = performance.now();
    const result = await solveImplants({
      deep,
      prices: prices.current ?? undefined,
      data: data as unknown as ImplantLookup,
      cybernetics: skills?.[SKILL_CYBERNETICS] ?? null,
      cancelled: () => solveRun.current !== mine,
      onProgress: (done, total) => {
        if (solveRun.current === mine) setSolving({ id: c.id, done, total });
      },
      score: async (implants) => {
        try {
          const st = await calculateFitStats(withAmmoApplied, skills, implants, {
            propRunning: c.propRunning,
            moduleStates: c.moduleStates,
            moduleCharges: c.moduleCharges,
            moduleSwaps: c.moduleSwaps,
          });
          /**
           * THE OBJECTIVE IS THE FIGHT (v0.97.0). Every candidate pod is
           * flown through the SAME Monte Carlo the headline runs - same
           * fleet, same kill order, same seeds - and scored on wins (1),
           * stalemates (0.5), losses (0), with win-sooner/die-later as a
           * sub-outcome tiebreak. The old paper proxies (applied dps,
           * survival seconds) could not see cross-effects: a pod that
           * flips a loss into a win by out-tracking the web scored the
           * same as one that did nothing.
           */
          const base = resolved.get(c.id);
          if (!base) return null;
          // the prop-OFF engine state rides along so scram interactions
          // stay exact - one extra engine run per candidate on MWD ships
          const alt = st.mwdFitted
            ? await calculateFitStats(withAmmoApplied, skills, implants, {
              propRunning: !c.propRunning,
              moduleStates: c.moduleStates,
              moduleCharges: c.moduleCharges,
              moduleSwaps: c.moduleSwaps,
            })
            : null;
          const candR: Resolved = { ...base, stats: st, statsAlt: alt ?? undefined };
          const side: 'a' | 'b' = battle.attackers.some((x) => x.id === c.id) ? 'a' : 'b';
          const fs = fightScore(buildFleet({ id: c.id, r: candR }), side);
          if (fs !== null) return fs;
          // nobody to fight: fall back to the honest paper metric rather
          // than pretending a fight told us something
          return isTargetShip
            ? st.summary.ehp + (st.defenses.shieldPassiveHps
              + st.defenses.shieldRepairHps + st.defenses.armorRepairHps) * 60
            : st.summary.dpsSustained;
        } catch {
          return null;
        }
      },
    });
    if (solveRun.current !== mine) return;
    setSolving(null);
    if (result) {
      setSolutions((prev) => new Map(prev).set(c.id, { ...result, fight: fightAvailable }));
      logInfo('battle', 'implant search', {
        ship: c.name, runs: result.engineRuns, ms: Math.round(performance.now() - t0),
        deep, cost: result.cost, set: result.setName, gainPct: result.baseline > 0
          ? Math.round(((result.score - result.baseline) / result.baseline) * 100) : null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, eftOf, characters, battle.target, battle.droneOrbit, simTarget, attackerRs]);

  const update = (id: string, patch: Partial<Combatant>) => {
    const cur = draft ?? {
      target: battle.target,
      attackers: battle.attackers,
      defenders: battle.defenders ?? [],
    };
    setDraft({
      target: cur.target?.id === id ? { ...cur.target, ...patch } : cur.target,
      attackers: cur.attackers.map((a) => (a.id === id ? { ...a, ...patch } : a)),
      defenders: cur.defenders.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    });
  };

  /** commit the pending edits — the ONLY thing that recomputes */
  const calculate = () => {
    if (!draft) return;
    logUser('battle: calculate', {
      ships: (draft.target ? 1 : 0) + draft.attackers.length + draft.defenders.length,
    });
    setBattle({ target: draft.target, attackers: draft.attackers, defenders: draft.defenders });
    setDraft(null);
  };

  // swap sides is GONE (v0.94.0): with fleets on both sides there is no
  // attacker/target asymmetry left to reverse — build the fight you mean.

  /** the KILL-ORDER row for one team: opposing ships as chips; clicking one
   * focuses it FIRST (click in reverse priority to build a full order).
   * Committed immediately — targeting is a fight definition, not a fiddly
   * numeric edit, the same rule as adding a ship. */
  const focusRow = (side: 'a' | 'b') => {
    const enemies = side === 'a' ? teamB : battle.attackers;
    if (enemies.length < 2) return null;
    const stored = (side === 'a' ? battle.focusA : battle.focusB) ?? [];
    const explicit = stored.length > 0;
    const order = [
      ...stored.map((id) => enemies.find((e) => e.id === id))
        .filter((x): x is Combatant => x !== undefined),
      ...enemies.filter((e) => !stored.includes(e.id)),
    ];
    const shortName = (n: string) => (n.length > 14 ? `${n.slice(0, 13)}…` : n);
    const commit = (ids: string[]) => {
      logUser('battle: kill order', { side, order: ids.length });
      if (side === 'a') setBattle({ focusA: ids });
      else setBattle({ focusB: ids });
    };
    return (
      <div className="battle-focus">
        <span className="dim"
          title="Who this team's DAMAGE focuses, in order: the first ship still alive gets shot, then the next. Click a ship to focus it first (click in reverse priority to build a full order). Healing always goes to whoever needs it; painting and tackle follow the kill target.">
          shoots{explicit ? '' : ' (auto: nearest death)'}
        </span>
        {order.map((e, i) => (
          <button key={e.id} type="button"
            className={`btn mini${explicit && i === 0 ? ' on' : ''}`}
            title={explicit ? `priority ${i + 1} — click to focus first` : 'click to focus this ship first'}
            onClick={() => commit([e.id, ...order.filter((o) => o.id !== e.id).map((o) => o.id)])}>
            {explicit ? `${i + 1}. ` : ''}{shortName(e.name)}
          </button>
        ))}
        {explicit && (
          <button type="button" className="btn mini" title="back to automatic targeting (finish what is nearest death)"
            onClick={() => commit([])}>
            auto
          </button>
        )}
      </div>
    );
  };

  const remove = (id: string) => {
    logUser('battle: removed a ship');
    setDraft(null);
    const defs = battle.defenders ?? [];
    if (battle.target?.id === id) {
      // the reference ship left: promote the next Team B ship so the origin
      // and the closed-form check keep an anchor
      const [next, ...rest] = defs;
      setBattle({ target: next ?? null, defenders: rest });
    } else if (defs.some((d) => d.id === id)) {
      setBattle({ defenders: defs.filter((d) => d.id !== id) });
    } else {
      setBattle({ attackers: battle.attackers.filter((a) => a.id !== id) });
    }
  };

  return (
    <div className="battle">
      {adding !== null && (
        <AddCombatant
          role={adding}
          teamFits={teamFits}
          wizardFits={wizardFits}
          onClose={() => setAdding(null)}
          onAdd={(c) => {
            logUser(`battle: added ${adding}`, { source: c.source.kind, profile: c.profile });
            // committed immediately: adding a ship is not a fiddly edit, and
            // leaving it pending behind Calculate would just be confusing
            setDraft(null);
            if (adding === 'target') setBattle({ target: c });
            else if (adding === 'defender') {
              // the first Team B ship becomes the reference; the rest join
              // the fleet with real placements (default 5 km out)
              if (!battle.target) setBattle({ target: c });
              else {
                const defs = battle.defenders ?? [];
                const withAz = {
                  ...c,
                  range: c.range > 0 ? c.range : 5000,
                  azimuthDeg: c.azimuthDeg ?? spreadAzimuth(defs.length, defs.length + 1),
                };
                setBattle({ defenders: [...defs, withAz] });
              }
            } else {
              // azimuth assigned ONCE on add and persisted — placements stay
              // put when the roster changes (they used to re-spread)
              const withAz = c.azimuthDeg !== undefined ? c
                : { ...c, azimuthDeg: spreadAzimuth(battle.attackers.length, battle.attackers.length + 1) };
              setBattle({ attackers: [...battle.attackers, withAz] });
            }
            setAdding(null);
          }}
        />
      )}

      <div className="battle-cols">
        {/* ---------------- TEAM A ---------------- */}
        <section className="battle-side">
          <h3>
            Team A ({battle.attackers.length})
            <button className="btn mini" onClick={() => { logUser('battle: add attacker'); setAdding('attacker'); }}>add…</button>
          </h3>
          {battle.attackers.length === 0 && (
            <div className="hint">Add Team A&apos;s ships. Each places itself with its own range and direction.</div>
          )}
          {focusRow('a')}
          {attackerRs.map((r, i) => (r ? (
            <CombatantCard key={r.combatant.id}
              r={{ ...r, combatant: view.attackers.find((a) => a.id === r.combatant.id) ?? r.combatant }}
              characters={characters} dogma={data} testSlot={testSlot} onSolve={solveFor} solving={solving} solution={solutions.get(r.combatant.id) ?? null}
              onUpdate={update} onRemove={() => remove(r.combatant.id)} rangeControls
              explainPod={explainPod}
              allies={[...view.attackers.filter((a) => a.id !== r.combatant.id),
                ...(view.target ? [view.target] : []), ...view.defenders]
                .map((a) => ({ id: a.id, name: a.name }))} />
          ) : <div key={battle.attackers[i].id} className="hint">scoring…</div>))}
        </section>
        {/* ---------------- TEAM B ---------------- */}
        <section className="battle-side">
          <h3>
            Team B ({teamB.length})
            <button className="btn mini" onClick={() => { logUser('battle: add defender'); setAdding(battle.target ? 'defender' : 'target'); }}>add…</button>
          </h3>
          {!battle.target && (
            <div className="hint">
              Add Team B&apos;s ships. The first one is the REFERENCE — it anchors the map&apos;s
              centre and the closed-form check; everyone else places relative to it. Signature,
              speed, resistances and EHP all come from each ship&apos;s own fit and pilot.
            </div>
          )}
          {focusRow('b')}
          {view.target && targetR && (
            <CombatantCard r={{ ...targetR, combatant: view.target }} characters={characters} dogma={data} testSlot={testSlot} onSolve={solveFor} solving={solving} solution={solutions.get(view.target.id) ?? null}
              onUpdate={update} isTarget onRemove={() => remove(view.target!.id)}
              explainPod={explainPod}
              distanceNote={view.attackers.length > 0
                ? `the reference ship (map centre) · ${(rangeOf(view.attackers[0]) / 1000).toFixed(1)} km to ${view.attackers[0].name}`
                : 'the reference ship — the map centre everyone places against'}
              allies={[...view.defenders, ...view.attackers]
                .map((a) => ({ id: a.id, name: a.name }))} />
          )}
          {defenderRs.map((r, i) => (r ? (
            <CombatantCard key={r.combatant.id}
              r={{ ...r, combatant: view.defenders.find((d) => d.id === r.combatant.id) ?? r.combatant }}
              characters={characters} dogma={data} testSlot={testSlot} onSolve={solveFor} solving={solving} solution={solutions.get(r.combatant.id) ?? null}
              onUpdate={update} onRemove={() => remove(r.combatant.id)} rangeControls
              explainPod={explainPod}
              allies={[...(view.target ? [view.target] : []),
                ...view.defenders.filter((d) => d.id !== r.combatant.id), ...view.attackers]
                .map((a) => ({ id: a.id, name: a.name }))} />
          ) : <div key={(battle.defenders ?? [])[i]?.id ?? i} className="hint">scoring…</div>))}
        </section>

      </div>

      {/* ---------------- THE MAP: where everyone starts ---------------- */}
      {view.target && targetR?.stats && attackerRs.some((r) => r?.stats) && (
        <TacticalMap
          target={{
            id: view.target.id,
            name: view.target.name,
            range: 0,
            angleDeg: angleOf(view.target),
            speed: speedOf(view.target, targetR.stats.summary.maxVelocity),
            azimuthDeg: 0,
            elevationDeg: 0,
          }}
          attackers={attackerRs.flatMap((r, i) => {
            if (!r?.stats) return [];
            const live = view.attackers.find((a) => a.id === r.combatant.id) ?? r.combatant;
            return [{
              id: live.id,
              name: live.name,
              range: rangeOf(live),
              angleDeg: angleOf(live),
              speed: speedOf(live, r.stats.summary.maxVelocity),
              azimuthDeg: live.azimuthDeg ?? spreadAzimuth(i, attackerRs.length),
              elevationDeg: elevationOf(live),
              anchorId: live.anchorId,
              holdRange: behaviourOf(live) === 'stationary' ? undefined : live.holdRange,
            }];
          })}
          defenders={defenderRs.flatMap((r, i) => {
            if (!r?.stats) return [];
            const live = view.defenders.find((d) => d.id === r.combatant.id) ?? r.combatant;
            return [{
              id: live.id,
              name: live.name,
              range: rangeOf(live),
              angleDeg: angleOf(live),
              speed: speedOf(live, r.stats.summary.maxVelocity),
              azimuthDeg: live.azimuthDeg ?? spreadAzimuth(i, Math.max(defenderRs.length, 1)),
              elevationDeg: elevationOf(live),
              anchorId: live.anchorId,
              holdRange: behaviourOf(live) === 'stationary' ? undefined : live.holdRange,
            }];
          })}
          onUpdate={update}
        />
      )}

      {/* which ships get EVENT ICONS on the fight-over-time strip — a
          20-ship fleet's icon rows are unreadable with everyone on */}
      {outcome?.fight && (
        <div className="hint" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
          title="Untick a ship to hide ITS event icons (💉 sticks, 🛡 hardeners, ☠ deaths, reloads…) on the fight-over-time chart below. Expanded copies (×2, ×3…) follow their card. Hiding icons never hides information — the hover replay still shows every event.">
          <b>event icons:</b>
          {[battle.target, ...battle.attackers, ...(battle.defenders ?? [])]
            .filter((c): c is Combatant => !!c)
            .map((c) => (
              <label key={c.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                <input type="checkbox" checked={!eventIconsOff.has(c.id)}
                  onChange={() => {
                    logUser('battle: event icons ' + (eventIconsOff.has(c.id) ? 'on' : 'off'), { ship: c.name });
                    setEventIconsOff((prev) => {
                      const n = new Set(prev);
                      if (n.has(c.id)) n.delete(c.id); else n.add(c.id);
                      return n;
                    });
                  }} />
                {c.name}
              </label>
            ))}
        </div>
      )}

      {/* ---------------- OUTCOME ---------------- */}
      <section className="battle-outcome">
        <h3>
          Outcome
          <label className="prop-toggle" style={{ marginLeft: 12 }}>
            <input type="checkbox" checked={battle.sustained}
              onChange={(e) => { setBattle({ sustained: e.target.checked }); logUser('battle: sustained ' + e.target.checked); }} />
            count reloading
          </label>
          {/* NOTHING TO SET: a drone's orbit radius is its OWN stat (attribute
              154 proximityRange — Hobgoblin 1 km, Hammerhead 2 km, Ogre 4 km),
              read per drone. It was never a player's choice. */}
          <button className={`btn${dirty ? ' primary' : ''}`} disabled={!dirty}
            onClick={calculate} style={{ marginLeft: 'auto' }}
            title="Change ranges, behaviours, ammo and pilots freely — nothing recomputes until you press this.">
            {dirty ? 'Calculate ▸' : 'up to date'}
          </button>
          {busy && <span className="hint" style={{ marginLeft: 12 }}>scoring…</span>}
        </h3>

        {!outcome && (
          <div className="hint">
            {battle.target ? 'Add at least one Team A ship that can shoot.' : 'Add a Team B ship to begin — the first one anchors the map.'}
          </div>
        )}

        {outcome && (
          <>
            {outcome.fight && outcome.mc?.mode === 'stochastic' && (
              <div className="sim-readout">
                <span>
                  <i>Fight (ECM rolls — {outcome.mc.n} simulated fights)</i>{' '}
                  <b className={outcome.mc.winCount.a > outcome.mc.n / 2 ? 'pos'
                    : outcome.mc.winCount.b > outcome.mc.n / 2 ? 'bad' : ''}>
                    Team A wins {outcome.mc.winCount.a} of {outcome.mc.n}
                  </b>
                </span>
                {outcome.mc.decided.median !== null && (
                  <span>
                    <i>median kill</i> <b>{secs(outcome.mc.decided.median)}</b>
                    <span className="dim">
                      {' '}(p10 {secs(outcome.mc.decided.p10)}, p90 {secs(outcome.mc.decided.p90)})
                    </span>
                  </span>
                )}
                <span className="dim">
                  charts show seed {outcome.mc.representativeSeed} — the median fight, not THE fight
                </span>
              </div>
            )}
            {outcome.fight && outcome.mc?.mode !== 'stochastic' && (
              <div className="sim-readout">
                <span>
                  <i>Fight</i>{' '}
                  <b className={outcome.fight.winner === 'a' ? 'pos'
                    : outcome.fight.winner === 'b' ? 'bad' : ''}>
                    {outcome.fight.winner === 'a' ? 'Team A wins'
                      : outcome.fight.winner === 'b' ? 'Team B wins'
                        : 'neither side can finish it'}
                  </b>
                </span>
                {outcome.fight.seconds !== null && (
                  <span><i>in</i> <b>{secs(outcome.fight.seconds)}</b></span>
                )}
                <span className="dim">
                  {outcome.fight.ships.filter((x) => x.alive).length} of{' '}
                  {outcome.fight.ships.length} still flying
                </span>
              </div>
            )}
            {outcome.fight && outcome.fight.events.length > 0 && (
              <div className="battle-timeline">
                {outcome.fight.events
                  .filter((e) => e.kind === 'death' || e.kind === 'capStarved'
                    || e.kind === 'spoolMax' || e.kind === 'scrammed' || e.kind === 'scramReleased'
                    || e.kind === 'hardenersDown' || e.kind === 'hardenersUp')
                  .slice(0, 14)
                  .map((e, i) => (
                    <span key={i} className={e.side === 'b' ? 'pos' : 'bad'}>
                      {n1(e.t)}s {e.kind === 'death' ? '☠' : e.kind === 'hardenersDown' ? '🛡' : e.kind === 'hardenersUp' ? '🛡' : '⚡'} {e.who}
                      {e.kind === 'capStarved' ? ' cap dry'
                        : e.kind === 'spoolMax' ? ' max spool'
                          : e.kind === 'scrammed' ? ' scrammed — MWD dead'
                            : e.kind === 'scramReleased' ? ' scram off'
                              : e.kind === 'hardenersDown' ? ' HARDENERS DOWN — resists collapsed'
                                : e.kind === 'hardenersUp' ? ' hardeners back up' : ''}
                    </span>
                  ))}
                {(() => {
                  const reloads = outcome.fight!.events.filter((e) => e.kind === 'reloadStart').length;
                  return reloads > 0
                    ? <span className="dim">{reloads} reload{reloads === 1 ? '' : 's'}</span> : null;
                })()}
              </div>
            )}
            {outcome.refusals.length > 0 && (
              <div className="hint bad">
                <b>Modules the fight runs WITHOUT, by name rather than silently:</b>{' '}
                {outcome.refusals.map((x) => `${x.ship}: type ${x.typeId} (${x.why})`).join('; ')}
                {' '}— refusing beats guessing. A mutated module needs real stats, and damp/ECM
                need a lock-time model, before this sim will count them.
              </div>
            )}
            {outcome.fight && (
              <FightTimeline fight={outcome.fight}
                hideEventsFor={[battle.target, ...battle.attackers, ...(battle.defenders ?? [])]
                  .filter((c): c is Combatant => !!c && eventIconsOff.has(c.id))
                  .map((c) => c.name)} />
            )}

            <div className="sim-readout">
              <span><i>Time to kill</i> <b>{secs(outcome.ttk.seconds)}</b></span>
              {outcome.incoming && (
                <span title={`Return fire from the target onto ${outcome.incoming.victim}, at that ship's own range and heading.`}>
                  <i>It kills {outcome.incoming.victim} in</i>{' '}
                  <b>{secs(outcome.incoming.ttk.seconds)}</b>
                </span>
              )}
              {outcome.incoming && (() => {
                // THE ONLY VERDICT THAT MATTERS in a duel: whose clock runs out
                // first. Killing faster IS a defence, and this is where that
                // finally shows up as a number.
                const mine = outcome.ttk.seconds;
                const theirs = outcome.incoming.ttk.seconds;
                if (mine === null && theirs === null) return <span className="dim">neither side can kill the other</span>;
                if (mine === null) return <span className="bad">you cannot break it — it kills you first</span>;
                if (theirs === null) return <span className="pos">it cannot break you</span>;
                const win = mine < theirs;
                return (
                  <span className={win ? 'pos' : 'bad'}>
                    <i>{win ? 'you win by' : 'you lose by'}</i>{' '}
                    <b>{secs(Math.abs(theirs - mine))}</b>
                  </span>
                );
              })()}
              <span><i>Effective HP vs this damage</i> {n0(outcome.ttk.ehpVsThisDamage)}</span>
              <span><i>Team A ships</i> {battle.attackers.reduce((sum, a) => sum + Math.max(1, Math.floor(a.count ?? 1)), 0)}</span>
              {battle.attackers.length > 0 && (() => {
                // ONE number here lied the moment two attackers sat apart: it
                // was simply the first one's range labelled as "the" range.
                const rs = battle.attackers.map((a) => rangeOf(liveOf(a.id) ?? a));
                const lo = Math.min(...rs), hi = Math.max(...rs);
                return (
                  <span><i>Range</i> {lo === hi ? km(lo) : `${km(lo)} – ${km(hi)}`}</span>
                );
              })()}
            </div>

            <div className="sim-card">
              <div className="fight-timeline-head">
                <span className="sim-card-title">
                  Closed-form check{targetR ? ` — vs ${targetR.combatant.name}` : ''}
                </span>
                <span className="dim">
                  the quick per-layer arithmetic beside the simulation — evaluated at each
                  ship&apos;s hold range against Team B&apos;s reference ship, repair as
                  duty-cycle averages
                  {outcome.sigMult > 1.0001 || outcome.velMult < 0.9999
                    ? ` · painters/webs folded in (sig ×${outcome.sigMult.toFixed(2)}, speed ×${outcome.velMult.toFixed(2)})`
                    : ''}
                </span>
              </div>
              <table className="data">
              <thead>
                <tr><th>Layer</th><th className="c-num">HP</th><th className="c-num">EHP vs this mix</th>
                  <th className="c-num">Incoming dps</th><th className="c-num">Repaired</th>
                  <th className="c-num">Falls in</th></tr>
              </thead>
              <tbody>
                {outcome.ttk.perLayer.map((l, i) => (
                  <tr key={l.name}>
                    <td className="hub-name">{l.name}</td>
                    <td className="c-num">{n0(layers[i]?.hp ?? 0)}</td>
                    <td className="c-num">{n0(l.ehp)}</td>
                    <td className="c-num">{n1(l.dps)}</td>
                    <td className={`c-num${(l.repairHps ?? 0) >= l.dps && l.dps > 0 ? ' pos' : ''}`}>
                      {l.repairHps ? `${n1(l.repairHps)} hp/s` : '—'}
                    </td>
                    <td className={`c-num${l.seconds === null ? ' bad' : ''}`}>{secs(l.seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <table className="data" style={{ marginTop: 8 }}>
              <thead>
                <tr><th>Attacker</th><th className="c-num">Transversal</th><th className="c-num">Applied</th>
                  <th className="c-num">Sustained</th>
                  <th className="c-num" title="Applied damage divided by the fit's paper DPS. It can exceed 100%: one shot in a hundred is a WRECKING hit at 300% damage and lands regardless of tracking, so a turret that never misses averages 101.5% of nominal. Below 100% is tracking, falloff and missile application taking their cut.">vs paper</th></tr>
              </thead>
              <tbody>
                {outcome.contributions.map((c) => [
                  <tr key={c.name}>
                    <td className="hub-name">{c.name}</td>
                    <td className="c-num" title={`${c.angular.toFixed(4)} rad/s — this is what the tracking formula consumes`}>
                      {n0(c.transversal)} m/s
                    </td>
                    <td className="c-num">{n0(c.applied)}</td>
                    <td className="c-num">{n0(c.sustained)}</td>
                    <td className={`c-num${c.landing < 0.5 ? ' bad' : ''}`}>{`${Math.round(c.landing * 100)}%`}</td>
                  </tr>,
                  c.note ? (
                    <tr key={`${c.name}-note`}>
                      <td colSpan={5} className="fitlib-warn">⚠ {c.name}: {c.note}</td>
                    </tr>
                  ) : null,
                ])}
              </tbody>
            </table>
            </div>

            {/* ---- DAMAGE BY RANGE: one card, two views (v0.98.6) — the
                 separate team chart became redundant the day the ammo chart
                 got the better chrome (caught live). Team view by default;
                 picking a ship switches to its ammo comparison. ---- */}
            {battle.attackers.length > 0 && targetR?.stats && (
              <div className="sim-card">
                <div className="fight-timeline-head">
                  <span className="sim-card-title">
                    {ammoPick ? 'Damage by range — ammo comparison' : 'Damage by range'}
                  </span>
                  <span className="dim">
                    {ammoPick
                      ? `every charge this weapon can load, run through the real engine (paint and webs folded in) — the strip marks the best charge per range band; twins folded, named by real Jita stock`
                      : `what each Team ${chartSide.toUpperCase()} ship lands on ${victimViewOf(chartSide)?.name ?? 'its victim'} from any distance at its current heading (paint and webs folded in) — markers show where each stands now`}
                  </span>
                  {!ammoPick && (
                    <span className="battle-presets">
                      <button type="button" className={`btn mini${chartSide === 'a' ? ' on' : ''}`}
                        title="Team A's curves onto Team B's reference ship"
                        onClick={() => setChartSide('a')}>
                        Team A
                      </button>
                      <button type="button" className={`btn mini${chartSide === 'b' ? ' on' : ''}`}
                        title="Team B's curves onto the FIRST Team A ship — the same convention the return-fire estimate uses"
                        onClick={() => setChartSide('b')}>
                        Team B
                      </button>
                    </span>
                  )}
                  <select style={{ marginLeft: 'auto' }}
                    value={ammoPick?.shipId ?? ''}
                    onChange={(e) => {
                      const shipId = e.target.value;
                      const rr = resolved.get(shipId);
                      const firstWeapon = rr?.ammoSlots.find((a) => a.isWeapon);
                      setAmmoPick(shipId && firstWeapon
                        ? { shipId, typeId: firstWeapon.typeId } : null);
                    }}>
                    <option value="">team view — compare ammo for…</option>
                    {[...attackerRs, targetR, ...defenderRs].flatMap((rr) => (
                      rr?.ammoSlots.some((a) => a.isWeapon)
                        ? [<option key={rr.combatant.id} value={rr.combatant.id}>{rr.combatant.name}</option>]
                        : []))}
                  </select>
                  {ammoPick && (() => {
                    const rr = resolved.get(ammoPick.shipId);
                    const weps = rr?.ammoSlots.filter((a) => a.isWeapon) ?? [];
                    return weps.length > 1 ? (
                      <select value={ammoPick.typeId}
                        onChange={(e) => setAmmoPick({ shipId: ammoPick.shipId, typeId: Number(e.target.value) })}>
                        {weps.map((w) => <option key={w.typeId} value={w.typeId}>{w.name}</option>)}
                      </select>
                    ) : null;
                  })()}
                  {ammoPick && (
                    <span className="battle-presets">
                      <button type="button" className={`btn mini${ammoGeom === 'flown' ? ' on' : ''}`}
                        title="the target moves exactly as your roster configures it - a head-on or stationary target has zero transversal at every range, so tracking never bites and curves plateau from point blank (physically correct for that motion)"
                        onClick={() => setAmmoGeom('flown')}>
                        as flown
                      </button>
                      <button type="button" className={`btn mini${ammoGeom === 'perp' ? ' on' : ''}`}
                        title="pyfa's Application Profile assumption: the target at FULL SPEED, PERPENDICULAR, at every range - close-range application collapses under tracking and the curve humps at the tracking/falloff crossover"
                        onClick={() => setAmmoGeom('perp')}>
                        worst case
                      </button>
                    </span>
                  )}
                </div>
                {!ammoPick && chartShips.length === 0 && (
                  <div className="hint">no Team {chartSide.toUpperCase()} ship has loaded weapons — load ammo on the cards above, or pick a ship to compare its charge options</div>
                )}
                {!ammoPick && chartShips.length > 0 && (() => {
                  const v = victimViewOf(chartSide);
                  if (!v || v.layers.length === 0) return null;
                  return (
                    <BattleChart
                      ships={chartShips}
                      header={false} legendColumn
                      // the victim arrives PAINTED and WEBBED by the shooting
                      // side's own projections (projFold)
                      target={v.sim}
                      targetAngle={v.angle}
                      targetSpeed={v.speed}
                      layer={v.layers[0]}
                      sustained={battle.sustained}
                      maxRange={chartMaxRange}
                    />
                  );
                })()}
                {ammoPick && ammoRows === null && <div className="hint">running every charge through the engine…</div>}
                {ammoPick && ammoRows !== null && ammoRows.length > 0 && (() => {
                  const pickSide: 'a' | 'b' = battle.attackers.some((x) => x.id === ammoPick.shipId) ? 'a' : 'b';
                  const v = victimViewOf(pickSide);
                  if (!v || v.layers.length === 0) return null;
                  return (
                  <>
                    <BattleChart
                      ships={ammoRows.slice(0, 8).map((x) => x.ship)}
                      showTotal={false} header={false} palette={AMMO_PALETTE} legendColumn
                      target={v.sim}
                      targetAngle={ammoGeom === 'perp' ? 90 : v.angle}
                      targetSpeed={ammoGeom === 'perp' ? v.maxVel : v.speed}
                      layer={v.layers[0]}
                      sustained={battle.sustained}
                      maxRange={chartMaxRange}
                    />
                    <div className="dim" style={{ fontSize: 12, margin: '2px 0 6px' }}>
                      top {Math.min(8, ammoRows.length)} of {ammoRows.length} charges drawn — the
                      strip under the curves marks the BEST charge for each range band; the table
                      ranks everything
                    </div>
                    <table className="data">
                      <thead>
                        <tr><th>Charge</th><th className="c-num">applied dps at fight range</th><th></th></tr>
                      </thead>
                      <tbody>
                        {ammoRows.map((x, i) => (
                          <tr key={x.chargeId}>
                            <td className="hub-name"
                              title={[
                                x.marketNote ?? '',
                                x.twins.length > 0
                                  ? `identical performance (measured in CCP's own data): ${x.twins.join(', ')}`
                                  : '',
                              ].filter(Boolean).join(' · ') || undefined}>
                              {i === 0 ? '★ ' : ''}{x.name}
                              {x.twins.length > 0 && (
                                <span className="dim"> +{x.twins.length} identical</span>
                              )}
                            </td>
                            <td className="c-num">{n1(x.atHold)}</td>
                            <td>
                              <button className="btn mini"
                                title="load this charge into the whole weapon group (commit with Calculate)"
                                onClick={() => {
                                  const rr = resolved.get(ammoPick.shipId);
                                  const cc = liveOf(ammoPick.shipId);
                                  if (!rr || !cc) return;
                                  const charges: Record<string, number | null> = { ...(cc.moduleCharges ?? {}) };
                                  for (const m of rr.modules.filter((mm) => mm.typeId === ammoPick.typeId)) charges[m.key] = x.chargeId;
                                  logUser('battle: ammo compare pick', { ship: cc.name, charge: x.name });
                                  update(ammoPick.shipId, { moduleCharges: charges });
                                }}>
                                load
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                  );
                })()}
              </div>
            )}

            <div className="hint sim-caveat">
              {!outcome.incoming && (
                <><b>The target is not returning fire</b> — nothing in its fit is a loaded weapon, so
                only one side of this engagement is being simulated. Load its guns to see the duel.{' '}</>
              )}
              <b>The FIGHT line is a discrete event simulation</b> — every weapon fires on its own
              clock and each volley lands as ONE hit; clips empty and reload in real silence; shield
              boosters heal at the start of their cycle and armour repairers at the end (that gap is
              why alpha beats an armour tank that out-heals the same dps on paper); ancillary
              boosters burn their charges and stand silent through the 60-second reload; every
              activation pays its capacitor cost the instant it fires, on EVE's exact recharge
              curve, and a module that cannot afford its cycle waits for the precise second it can;
              cap boosters inject (the engine's own cap-stability number ignores them — this sim is
              the only place that energy exists); passive shield regen follows the true
              level-dependent curve, peaking at 25% shield; disintegrators spool up and reset on
              target switch; a ship that dies stops shooting, and its missiles already in flight
              still land. The time-to-kill figures below are closed-form averages that assume nobody
              dies mid-fight — where they disagree, trust the fight.{' '}
              <b>The fight is flown in true 3D space (v0.93):</b> every ship is a real position —
              two attackers on opposite bearings really are on opposite sides, a logi&apos;s
              wingmate really is 90 km away, and elevation is an input. Steering re-aims on EVE&apos;s
              real one-second server tick under the measured inertia law: orbits are tangent-point
              pursuit, so a fast heavy ship told to orbit at 500 m genuinely can&apos;t — its orbit
              inflates and its speed drops, exactly as in game (the controller&apos;s exact shape is
              declared, not yet verified against Tranquility — a five-minute in-game measurement
              will do that). Transversal falls out of the true velocity vectors; missiles fly a
              declared lead-intercept and genuinely cannot catch a target receding faster than they
              fly; drones chase real trajectories, arrive at their measured orbit radius (attribute
              416 — 154 was the wrong attribute through v0.92), and can be outrun. Speeds come from
              each ship&apos;s own fit and pilot, including whether its prop module is running.
              Time to kill strips shield, then armour, then hull, each against ITS OWN resistances and
              against the damage mix that actually arrives — a single blended resist figure is wrong by
              up to 2.9× on a real fit. <b>Projected effects are IN the fight:</b> webs and
              grapplers slow their victim (with real falloff and the measured stacking penalty),
              painters bloom its signature, tracking and guidance disruptors degrade the guns and
              missiles shooting THROUGH them, neutralizers and nosferatu move real capacitor at
              cycle end, scramblers shut MWDs down — signature bloom vanishes instantly and speed
              decays on the ship&apos;s true inertia — remote repairers heal the most-damaged ally
              with logistics timing, ECM rolls seeded per-cycle jams against real sensor strengths,
              and command bursts buff the whole fleet. Still NOT modelled, stated rather than
              hidden: overheat damage and burnout (the heat tick is not in CCP&apos;s data files),
              warp-outs, lock times rounding UP to whole server ticks and next-tick command latency
              (documented, migration pending), and sentry drones (stationary turrets no current
              model expresses — they sit unchanged and known-wrong).
            </div>
          </>
        )}
      </section>
    </div>
  );
}

/**
 * Team time-to-kill. Each attacker has its OWN range and transversal, so its
 * application must be evaluated separately — but the layers resist the SUM.
 * Summing damage-by-type first and walking the layers once is the only order
 * that gets both right.
 */
function timeToKillTeam(
  groups: { w: SimWeapon[]; e: Engagement }[],
  target: SimTarget,
  layers: Layer[],
  sustained: boolean,
  defenses: Defenses,
) {
  // one pseudo-attacker whose landed damage is the team's total: timeToKill
  // accepts weapons+engagement, so the totals are pre-computed here and handed
  // over as a single already-applied weapon
  const totals = { em: 0, thermal: 0, kinetic: 0, explosive: 0 };
  for (const g of groups) {
    const d = landedDamagePerSecond(g.w, target, g.e, sustained);
    totals.em += d.em; totals.thermal += d.thermal;
    totals.kinetic += d.kinetic; totals.explosive += d.explosive;
  }
  const combined = [{
    typeId: 0, kind: 'untracked' as const, volley: totals, cycleSeconds: 1, capPerCycle: 0,
  }];
  return timeToKill(combined, target, { distance: 0, transversal: 0 }, layers, false, defenses);
}

/** one ship's card: who flies it, how, and what it is worth */
/** "5× Acolyte II (drone), 4× Heavy Missile Launcher II" — the answer to
 * "what is it shooting with", on the card instead of in a support question
 * (a logi Guardian whose saved fit carried five drones killed a Hyena and
 * the UI gave no clue what fired) */
function armamentOf(r: Resolved, dogma: EsfDataShapes | null): string {
  const w = r.stats?.simWeapons ?? [];
  if (w.length === 0) return 'unarmed — nothing in this fit deals damage';
  const counts = new Map<number, { n: number; kind: string }>();
  for (const x of w) {
    const cur = counts.get(x.typeId);
    if (cur) cur.n += 1;
    else counts.set(x.typeId, { n: 1, kind: x.kind });
  }
  return [...counts.entries()]
    .map(([tid, { n, kind }]) => {
      const name = (dogma as unknown as { types?: Record<number, { name?: string }> })
        ?.types?.[tid]?.name ?? `type ${tid}`;
      return `${n}× ${name}${kind === 'drone' ? ' (drone)' : ''}`;
    })
    .join(', ');
}

function CombatantCard({ r, characters, dogma, testSlot, onSolve, solving, solution, onUpdate, onRemove, isTarget, rangeControls, distanceNote, allies, explainPod }: {
  r: Resolved;
  characters: { characterId: number; characterName: string; skills: Record<number, number> | null }[];
  dogma: EsfDataShapes | null;
  /** headroom with one slot emptied, measured from the pending fit */
  /** score this fit with `typeId` in `slotKey` — null empties it */
  testSlot: (c: Combatant, slotKey: string, typeId: number | null) => Promise<SlotBudget | null>;
  onSolve: (c: Combatant, deep: boolean) => void;
  solving: { id: string; done: number; total: number } | null;
  solution: (SolveResult & { fight?: boolean }) | null;
  onUpdate: (id: string, patch: Partial<Combatant>) => void;
  onRemove?: () => void;
  isTarget?: boolean;
  rangeControls?: boolean;
  /** the target's card shows WHERE it is instead of a range input — its
   * distance is set on each attacker, and saying so beats a silent absence */
  distanceNote?: string;
  /** other roster ships this one may anchor its behaviour on (orbit WHAT) */
  allies?: { id: string; name: string }[];
  /** the WHY behind a fight-scored pod: diff of the baseline fight vs the
   * candidate's, in fight language (computed on demand) */
  explainPod?: (c: Combatant, implants: number[]) => Promise<string[]>;
}) {
  const [showReqs, setShowReqs] = useState(false);
  // the module list is the FITTING VIEW now — state and charge per slot — so
  // it opens by default rather than hiding the thing most worth adjusting
  const [showMods, setShowMods] = useState(true);
  /** which implant candidates are expanded to their pieces */
  const [openCand, setOpenCand] = useState<Record<string, boolean>>({});
  /** the per-candidate WHY, keyed like openCand ('loading' while the two
   * comparison fights run) */
  const [podWhy, setPodWhy] = useState<Record<string, string[] | 'loading'>>({});
  const [showSolve, setShowSolve] = useState(true);
  /** which module GROUPS are expanded to their individual slots */
  const [expanded, setExpanded] = useState<Record<number, boolean>>({});
  /** which slot has its swap picker open */
  const [swapping, setSwapping] = useState<string | null>(null);
  const c = r.combatant;
  const s = r.stats?.summary;
  return (
    <div className={`battle-card${r.problem ? ' battle-card-bad' : ''}`}>
      <div className="battle-card-head">
        <b>{c.name}</b>
        <label className="dim" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 8, fontSize: 12 }}
          title="fly N identical copies of this exact fit — same behaviour, same target order, expanded into independent ships in the fight">
          ×
          <input type="number" min={1} max={50} step={1}
            value={c.count ?? 1}
            style={{ width: 52 }}
            onChange={(e) => {
              const v = Math.max(1, Math.min(50, Math.floor(Number(e.target.value) || 1)));
              logUser('battle: ship count', { ship: c.name, count: v });
              onUpdate(c.id, { count: v });
            }} />
        </label>
        {onRemove && <button className="btn mini" onClick={onRemove}>×</button>}
      </div>
      {r.stats && (
        <div className="dim battle-armament" title="every damage source the simulation extracted from this fit — drones included">
          fights with: {armamentOf(r, dogma)}
        </div>
      )}

      <div className="battle-pilot">
        <select value={c.profile}
          onChange={(e) => {
            const profile = e.target.value as Combatant['profile'];
            logUser('battle: pilot profile', { ship: c.name, profile });
            onUpdate(c.id, { profile });
          }}>
          <option value="character">{PROFILE_LABEL.character}</option>
          <option value="optimal">{PROFILE_LABEL.optimal}</option>
          <option value="minimum">{PROFILE_LABEL.minimum}</option>
        </select>
        {c.profile === 'character' && (
          <select value={c.characterId ?? ''}
            onChange={(e) => onUpdate(c.id, { characterId: Number(e.target.value) })}>
            <option value="">pick…</option>
            {characters.filter((x) => x.skills).map((x) => (
              <option key={x.characterId} value={x.characterId}>{x.characterName}</option>
            ))}
          </select>
        )}
        {c.profile === 'character' && c.characterId != null && (() => {
          // POD PICKER — which clone this pilot wears in the sim, backed by
          // the same c.implants field the implant solver writes: the three
          // meanings stay one meaning. undefined = follow the live active
          // pod (registry, sync fallback); [] = bare clone; a set = worn.
          const pods = characterPods(c.characterId);
          const sig = c.implants !== undefined ? cloneSignature(c.implants) : undefined;
          const value = c.implants === undefined ? 'active'
            : c.implants.length === 0 ? 'none'
              : pods.some((p) => cloneSignature(p.implants) === sig) ? `pod:${sig}`
                : 'custom';
          return (
            <select value={value}
              title="The pod this pilot wears in the sim. 'active pod' follows the multibox registry live (a clone jump updates it within an overlay poll); picking a specific pod or 'no pod' pins it for this ship. Implants change real numbers — fitting, speed, tank, damage."
              onChange={(e) => {
                const v = e.target.value;
                const patch = v === 'active' ? { implants: undefined }
                  : v === 'none' ? { implants: [] }
                    : v.startsWith('pod:')
                      ? { implants: pods.find((p) => cloneSignature(p.implants) === v.slice(4))?.implants }
                      : null;
                if (patch) {
                  logUser('battle: pod pick', { ship: c.name, pick: v === 'active' ? 'active' : v === 'none' ? 'none' : 'specific' });
                  onUpdate(c.id, patch);
                }
              }}>
              <option value="active">active pod (live)</option>
              {pods.map((p) => (
                <option key={cloneSignature(p.implants) ?? p.first} value={`pod:${cloneSignature(p.implants)}`}>
                  {p.displayName}
                </option>
              ))}
              <option value="none">no pod</option>
              {value === 'custom' && <option value="custom" disabled>applied set (solver)</option>}
            </select>
          );
        })()}
        <label className="prop-toggle">
          <input type="checkbox" checked={c.propRunning}
            onChange={(e) => {
              logUser('battle: prop ' + (e.target.checked ? 'running' : 'off'), { ship: c.name });
              onUpdate(c.id, { propRunning: e.target.checked });
            }} />
          prop on
        </label>
        {((r.stats?.defenses.capBoosters?.length ?? 0) > 0
          || (r.stats?.defenses.cycles ?? []).some((cy) => cy.kind === 'shield' && cy.charges)) && (
          <label className="dim" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}
            title="TOTAL cap booster charges carried (loaded + cargo), ONE pool shared by capacitor injectors AND ancillary shield boosters — in the real game they eat the same charges. ASBs load first, injectors second. Blank = unlimited (reload forever). With a number, a module whose reload finds the pool short runs DRY, exactly like a real cargohold. (Ancillary ARMOR reps use nanite paste — never counted here.)">
            cap charges
            <input type="number" min={0} step={1}
              value={c.capBoosterCharges ?? ''}
              placeholder="∞"
              style={{ width: 62 }}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const v = raw === '' ? undefined : Math.max(0, Math.floor(Number(raw) || 0));
                logUser('battle: cap booster charges', { ship: c.name, charges: v ?? 'unlimited' });
                onUpdate(c.id, { capBoosterCharges: v });
              }} />
          </label>
        )}
        {((r.stats?.defenses.cycles?.length ?? 0) > 0 || (r.stats?.defenses.capBoosters?.length ?? 0) > 0) && (
          <label className="prop-toggle"
            title="Fly the tank like a real pilot instead of free-running every module: shield reps are HELD until ~30% shield (the passive-regen sweet spot — recharge peaks at 25%), a rep cycle never starts if its heal would overflow, and cap sticks are timed against the TANK'S OWN CYCLES — a booster/hardener cycle pulls a stick at its start whenever paying would dip the cap below the ~25% reserve, so the injection is spent the same second it lands (idle injected cap is neut food; the injector never fires on its own clock). The whole stick must always land, and the magazine + reload cadence is a hard ceiling. Armour/hull reps keep running early — their heal lands at cycle END, so waiting low would be suicide — but never waste a cycle. Every injection lands on the fight log with how much of it the capacitor could swallow. OFF = the old greedy AI: everything cycles from the first second, wasting heals, cap and sticks.">
            <input type="checkbox" checked={c.injectRepping ?? false}
              onChange={(e) => {
                logUser('battle: inject repping ' + (e.target.checked ? 'on' : 'off'), { ship: c.name });
                onUpdate(c.id, { injectRepping: e.target.checked || undefined });
              }} />
            💉 inject repping
          </label>
        )}
      </div>

      {/* HOW THIS SHIP IS FLYING. A heading, not a preset: a ship goes any
          direction it likes, and the direction is the whole game against
          turrets. Speed is what it is ACTUALLY doing, which is rarely its
          maximum — the sim used to assume max for anything that moved. */}
      <div className="battle-range">
        {rangeControls && (
          <>
            <label title="Where this ship STARTS — the opening distance to the target. Drag it on the maps below (top view sets the direction, side view the elevation), or type the distance here.">
              <span className="dim">starts at</span>
              <input type="number" min={0} step={1} value={+(rangeOf(c) / 1000).toFixed(1)}
                onChange={(e) => onUpdate(c.id, { range: Math.max(0, Number(e.target.value) * 1000) })} />
              km
            </label>
          </>
        )}
        {!rangeControls && distanceNote && (
          <span className="dim" title="The reference ship anchors the map's centre; every other ship on both teams places itself relative to it with its own range and direction.">
            {distanceNote}
          </span>
        )}
        <span className="battle-presets">
          {(['approach', 'orbit', 'keepAtRange', 'stationary'] as Behaviour[]).map((b) => {
            // a preset is ON when it is the stored behaviour AND the dial has
            // not been dragged away from its angle — a custom heading shows
            // no preset lit, which is the honest answer
            const selected = behaviourOf(c) === b
              && angleOf(c) === PRESET_ANGLE[b]
              && (b !== 'stationary' || speedOf(c, s?.maxVelocity ?? 0) === 0);
            return (
              <button key={b} className={`btn mini${selected ? ' on' : ''}`}
                title={`set the heading to ${PRESET_ANGLE[b]}°${b === 'stationary' ? ' and the speed to zero' : ''}`}
                onClick={() => {
                  logUser('battle: preset', { ship: c.name, preset: b });
                  onUpdate(c.id, {
                    angleDeg: PRESET_ANGLE[b],
                    speed: b === 'stationary' ? 0 : (s?.maxVelocity ?? 0),
                    behaviour: b,
                    // "keep at range" needs a range to KEEP: default to where
                    // the ship starts; approach means all the way in
                    holdRange: b === 'approach' ? 500
                      : b === 'stationary' ? undefined
                        : (c.holdRange ?? rangeOf(c)),
                  });
                }}>
                {BEHAVIOUR_LABEL[b]}
              </button>
            );
          })}
        </span>
        {behaviourOf(c) !== 'stationary' && (
          <label title="The range this ship is TRYING to reach and hold. The starting position is just where the fight opens — from further out it burns in first, then circles here.">
            <span className="dim">hold at</span>
            <input type="number" min={0} step={1}
              value={+(((c.holdRange ?? rangeOf(c)) / 1000).toFixed(1))}
              onChange={(e) => onUpdate(c.id, { holdRange: Math.max(100, Number(e.target.value) * 1000) })} />
            km
          </label>
        )}
        {rangeControls && behaviourOf(c) !== 'stationary' && (allies?.length ?? 0) > 0 && (
          <label title="What this ship's flying is anchored ON — orbit WHAT, keep range from WHAT. Default: its kill target. A logi orbiting its own wingmate at 5 km while the wingmate fights at 100 km is now real geometry.">
            <span className="dim">vs</span>
            <select value={c.anchorId ?? ''}
              onChange={(e) => {
                logUser('battle: anchor', { ship: c.name, anchor: e.target.value || 'target' });
                onUpdate(c.id, { anchorId: e.target.value === '' ? undefined : e.target.value });
              }}>
              <option value="">the target</option>
              {allies!.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
        )}
      </div>
      <HeadingDial
        label={c.name}
        angleDeg={angleOf(c)}
        speed={speedOf(c, s?.maxVelocity ?? 0)}
        maxSpeed={s?.maxVelocity ?? 0}
        onChange={(patch) => onUpdate(c.id, patch)}
      />

      {/* MODULE STATES. Switching a shield booster off and re-scoring is how
          you find out what it was worth — the tool exists to price a change,
          not only to describe a fit. Overload is here too, because the engine
          already computes overloaded numbers (a Large Shield Booster II goes
          69.0 -> 89.3 hp/s) and it changes an outcome you might actually pick. */}
      {r.modules.length > 0 && (
        <>
          <button className="btn mini" onClick={() => setShowMods((v) => !v)}>
            {showMods ? '▾' : '▸'} slots ({(() => {
              const changed = r.modules.filter(
                (m) => (c.moduleStates?.[m.key] ?? m.state) !== 'Active').length;
              return changed > 0 ? `${changed} changed` : r.modules.length;
            })()})
          </button>
          {showMods && (
            <div className="battle-mods">
              {/* GROUPED BY MODULE TYPE. Setting the same script on five
                  launchers one at a time is a chore, and most of the time every
                  matching module carries the same thing — so the group sets them
                  all at once, and the per-slot rows exist for the times it does
                  not (one tracking script among three optimal ones). */}
              {[...new Map(r.modules.map((m) => [m.typeId, m])).keys()].map((typeId) => {
                const group = r.modules.filter((m) => m.typeId === typeId);
                const head = group[0];
                const stateOf = (m: typeof head) => c.moduleStates?.[m.key] ?? m.state;
                const chargeOf = (m: typeof head) =>
                  (c.moduleCharges && m.key in c.moduleCharges ? c.moduleCharges[m.key] : m.charge);
                // a group speaks with one voice only when its members AGREE;
                // otherwise the control reads "mixed" rather than lying
                const oneState = group.every((m) => stateOf(m) === stateOf(head)) ? stateOf(head) : null;
                const oneCharge = group.every((m) => chargeOf(m) === chargeOf(head)) ? chargeOf(head) : undefined;
                const open = !!expanded[typeId];
                const setAllStates = (v: ModuleState) => {
                  const next = { ...(c.moduleStates ?? {}) };
                  for (const m of group) next[m.key] = v;
                  logUser('battle: state (whole group)', { ship: c.name, module: head.name, state: v });
                  onUpdate(c.id, { moduleStates: next });
                };
                const setAllCharges = (v: number | null) => {
                  const next = { ...(c.moduleCharges ?? {}) };
                  for (const m of group) next[m.key] = v;
                  logUser('battle: charge (whole group)', {
                    ship: c.name, module: head.name, count: group.length,
                    charge: v ? typeNameOf(v) : 'none',
                  });
                  onUpdate(c.id, { moduleCharges: next });
                };
                return (
                  <div key={typeId} className="battle-group">
                    <label>
                      <span className="dim">
                        {group.length > 1 && <b>{group.length}x </b>}{head.name}
                      </span>
                      <select value={oneState ?? ''}
                        onChange={(e) => setAllStates(e.target.value as ModuleState)}
                        className={oneState === 'Overload' ? 'mod-hot' : oneState === 'Passive' ? 'mod-off' : ''}>
                        {oneState === null && <option value="">— mixed —</option>}
                        {head.states.map((st) => (
                          <option key={st} value={st}>
                            {stateLabel(st, head.states.includes('Active'))}
                          </option>
                        ))}
                      </select>
                      {head.options.length > 0 ? (
                        <select
                          value={oneCharge === undefined ? '' : (oneCharge ?? '')}
                          className={oneCharge === null && head.isWeapon ? 'battle-ammo-empty' : ''}
                          onChange={(e) => setAllCharges(e.target.value === '' ? null : Number(e.target.value))}>
                          {oneCharge === undefined && <option value="">— mixed —</option>}
                          <option value="">{head.isWeapon ? '— empty (no damage) —' : '— none —'}</option>
                          {head.options
                            .map((id) => ({ id, name: typeNameOf(id) }))
                            .sort((x, y) => x.name.localeCompare(y.name))
                            .map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                        </select>
                      ) : <span />}
                      {group.length > 1 ? (
                        <button className="btn mini"
                          title="set these individually — one tracking script among three optimal ones"
                          onClick={() => setExpanded((x) => ({ ...x, [typeId]: !x[typeId] }))}>
                          {open ? '▾' : '▸'}
                        </button>
                      ) : <span />}
                    </label>

                    {open && group.map((m) => (
                      <label key={m.key} className="battle-slot">
                        <span className="dim">{m.key}</span>
                        <select value={stateOf(m)}
                          className={stateOf(m) === 'Overload' ? 'mod-hot' : stateOf(m) === 'Passive' ? 'mod-off' : ''}
                          onChange={(e) => onUpdate(c.id, {
                            moduleStates: { ...(c.moduleStates ?? {}), [m.key]: e.target.value as ModuleState },
                          })}>
                          {m.states.map((st) => (
                            <option key={st} value={st}>
                              {stateLabel(st, m.states.includes('Active'))}
                            </option>
                          ))}
                        </select>
                        {m.options.length > 0 ? (
                          <select
                            value={chargeOf(m) ?? ''}
                            className={chargeOf(m) === null && m.isWeapon ? 'battle-ammo-empty' : ''}
                            onChange={(e) => onUpdate(c.id, {
                              moduleCharges: {
                                ...(c.moduleCharges ?? {}),
                                [m.key]: e.target.value === '' ? null : Number(e.target.value),
                              },
                            })}>
                            <option value="">{m.isWeapon ? '— empty —' : '— none —'}</option>
                            {m.options
                              .map((id) => ({ id, name: typeNameOf(id) }))
                              .sort((x, y) => x.name.localeCompare(y.name))
                              .map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
                          </select>
                        ) : <span />}
                        <button className="btn mini" title="put something else in this slot"
                          onClick={() => setSwapping(swapping === m.key ? null : m.key)}>
                          ⇄
                        </button>
                        {swapping === m.key && dogma && (
                          <SlotSwap
                            slotType={m.slotType}
                            data={dogma}
                            cargoTypeIds={r.cargoTypeIds}
                            current={c.moduleSwaps?.[m.key] ?? m.typeId}
                            slotKey={m.key}
                            combatant={c}
                            testSlot={testSlot}
                            onPick={(typeId) => {
                              logUser('battle: swap slot', {
                                ship: c.name, slot: m.key,
                                to: typeId === null ? 'empty' : typeNameOf(typeId),
                              });
                              onUpdate(c.id, {
                                moduleSwaps: { ...(c.moduleSwaps ?? {}), [m.key]: typeId },
                              });
                            }}
                            onClose={() => setSwapping(null)}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                );
              })}
              {(Object.keys(c.moduleStates ?? {}).length > 0
                || Object.keys(c.moduleCharges ?? {}).length > 0) && (
                <button className="btn mini"
                  onClick={() => onUpdate(c.id, { moduleStates: {}, moduleCharges: {} })}>
                  reset slots to the saved fit
                </button>
              )}
            </div>
          )}
        </>
      )}

      {r.problem && (
        <div className={/reading your saved fits/.test(r.problem) ? 'hint' : 'fitlib-warn'}>
          {/reading your saved fits/.test(r.problem) ? r.problem : `⚠ ${r.problem}`}
        </div>
      )}

      {r.cannotFly.length > 0 && (
        <div className="fitlib-warn">
          ⚠ This pilot cannot legally fly it — missing{' '}
          {r.cannotFly.slice(0, 4).map((m) => `${m.name} ${m.level}`).join(', ')}
          {r.cannotFly.length > 4 ? ` +${r.cannotFly.length - 4} more` : ''}.
          The dogma engine does not refuse an unflyable fit, so these numbers describe a ship that
          could not undock.
        </div>
      )}

      {s && (
        <div className="battle-stats">
          <span><i>{isTarget ? 'Sig' : 'DPS'}</i> {isTarget ? `${n0(s.signatureRadius)} m` : n0(s.dps)}</span>
          <span><i>{isTarget ? 'Speed' : 'Sust'}</i> {isTarget ? `${n0(s.maxVelocity)} m/s` : n0(s.dpsSustained)}</span>
          <span><i>EHP</i> {n0(s.ehp)}</span>
        </div>
      )}

      {/* THE BEST POD, searched by measurement. Whole sets are scored as units
          because an Omega is worth nothing alone and multiplies the rest — a
          per-slot search is structurally blind to it. */}
      <div className="battle-solve">
        <button className="btn mini" onClick={() => setShowSolve((v) => !v)}>
          {showSolve ? '▾' : '▸'} implants
        </button>
        {showSolve && (<>
        <div className="slot-swap-row">
          <button className="btn mini" disabled={solving !== null}
            title="WHAT SHOULD I WEAR TO WIN? Every complete implant set, then the strongest per-slot candidates — each pod run through the dogma engine AND flown through the whole Monte Carlo fight (same fleet, same kill order, same seeds as the headline). Scored on wins, stalemates half, faster-win/slower-loss as tiebreak. With no opposing team it falls back to paper survival/damage."
            onClick={() => { logUser('battle: find implants', { ship: c.name }); onSolve(c, false); }}>
            {solving?.id === c.id
              ? `searching ${solving.done}/${solving.total}…`
              : '⌕ pod to win this fight'}
          </button>
          <button className="btn mini" disabled={solving !== null}
            title="EXHAUSTIVE: every reachable implant in every free slot, on top of the best five sets — each candidate is a full engine run PLUS a full Monte Carlo fight, so this takes MINUTES and will keep the app busy during the fight runs."
            onClick={() => {
              logUser('battle: deep implant search', { ship: c.name });
              onSolve(c, true);
            }}>
            ⌕⌕ deep (minutes)
          </button>
        </div>
        {solution && (
          <div className="battle-solution">
            <div>
              <b>{solution.setName ?? 'hardwirings only'}</b>
              {solution.fight ? (
                <span className={fightGain(solution.score, solution.baseline).better ? 'pos' : 'dim'}>
                  {' '}{fightGain(solution.score, solution.baseline).text}
                </span>
              ) : solution.baseline > 0 && (
                <span className="pos"> +{(((solution.score - solution.baseline)
                  / solution.baseline) * 100).toFixed(1)}%</span>
              )}
              <span className="dim"> · {solution.fight
                ? 'to WIN this fight (wins + half for stalemates, over the same 100 seeds as the headline)'
                : isTarget ? 'to survive longest' : 'to kill fastest'}</span>
              {solution.cost !== null && (
                <span className="dim"> · {isk(solution.cost)}</span>
              )}
            </div>
            <div className="dim">
              {solution.implants.map((id) => typeNameOf(id)).join(', ') || 'nothing beat an empty pod'}
            </div>
            {/* THE CHEAP ANSWER. Most of the gain for a fraction of the price is
                usually the one worth acting on, and the app has the prices. */}
            {solution.bestValue
              && solution.bestValue.cost < (solution.cost ?? 0) && (
              <div>
                <span className="dim">cheapest that still helps: </span>
                <b>{solution.bestValue.label}</b>{' '}
                <span className="dim">
                  {isk(solution.bestValue.cost)} for{' '}
                  {solution.score > solution.baseline
                    ? `${Math.round(((solution.bestValue.score - solution.baseline)
                      / (solution.score - solution.baseline)) * 100)}%`
                    : '—'} of the gain
                </span>
              </div>
            )}
            {/* THE WHOLE SHORTLIST, not one line and a runner-up. The set that
                wins is often barely ahead of one costing a tenth as much, and
                that comparison is the decision — so every candidate measured is
                here, expandable to its pieces and its price. */}
            <div className="solve-list">
              {solution.considered.map((cand, i) => {
                const key = `${c.id}:${cand.label}`;
                const open = !!openCand[key];
                const gain = solution.baseline > 0
                  ? ((cand.score - solution.baseline) / solution.baseline) * 100 : 0;
                const fg = fightGain(cand.score, solution.baseline);
                return (
                  <div key={key} className="solve-row">
                    <button className="btn mini"
                      onClick={() => {
                        const opening = !openCand[key];
                        setOpenCand((x) => ({ ...x, [key]: !x[key] }));
                        // fetch the WHY once per candidate, on first expand
                        if (opening && solution.fight && explainPod && podWhy[key] === undefined) {
                          setPodWhy((x) => ({ ...x, [key]: 'loading' }));
                          void explainPod(c, cand.implants).then((lines) => {
                            setPodWhy((x) => ({ ...x, [key]: lines }));
                          });
                        }
                      }}>
                      {open ? '▾' : '▸'} {i + 1}. {cand.label}
                      <span className={(solution.fight ? fg.better : gain > 0) ? 'pos' : 'dim'}>
                        {' '}{solution.fight
                          ? fg.text
                          : gain > 0 ? `+${gain.toFixed(2)}%` : '—'}
                      </span>
                      {cand.sameAs && (
                        <span className="dim" title="Identical score. The set named here changes nothing for the objective being optimised — a shield or armour set cannot raise turret damage.">
                          {' '}· same as “{cand.sameAs}”
                        </span>
                      )}
                    </button>
                    {open && (
                      <div className="dim solve-detail">
                        {cand.implants.length === 0 ? (
                          <div>no implants</div>
                        ) : (
                          <table className="solve-pod">
                            <tbody>
                              {[...cand.implants]
                                .sort((x, y) => (implantSlot(dogma as unknown as ImplantLookup, x) ?? 0)
                                  - (implantSlot(dogma as unknown as ImplantLookup, y) ?? 0))
                                .map((id) => (
                                  <tr key={id}>
                                    <td className="dim">{implantSlot(dogma as unknown as ImplantLookup, id) ?? '?'}</td>
                                    <td>{typeNameOf(id)}</td>
                                    <td className="dim">{implantEffect(dogma, id)}</td>
                                  </tr>
                                ))}
                            </tbody>
                          </table>
                        )}
                        <div>
                          {solution.fight
                            ? `fight score ${fightPts(cand.score)}/100`
                            : `score ${cand.score.toFixed(2)}`}
                          {cand.cost !== null && <> · {isk(cand.cost)}</>}
                        </div>
                        {solution.fight && (
                          <div className="solve-why">
                            {podWhy[key] === 'loading'
                              ? <div className="dim">running the comparison fights…</div>
                              : Array.isArray(podWhy[key])
                                ? (podWhy[key] as string[]).map((l, j) => <div key={j}>{l}</div>)
                                : null}
                          </div>
                        )}
                        {/* FLY IT. A recommendation you cannot apply is a
                            leaflet; this puts the pod on the ship so every
                            other number in the sim moves with it. */}
                        <button className="btn mini"
                          onClick={() => {
                            logUser('battle: wear pod', { ship: c.name, set: cand.label });
                            onUpdate(c.id, { implants: cand.implants });
                          }}>
                          fly this pod
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {c.implants && (
              <button className="btn mini"
                onClick={() => onUpdate(c.id, { implants: undefined })}>
                back to this pilot&rsquo;s own implants
              </button>
            )}
            <div className="hint">{solution.searched}</div>
          </div>
        )}
        </>)}
      </div>

      {r.requirements.length > 0 && (
        <>
          <button className="btn mini" onClick={() => { setShowReqs((v) => !v); logUser('battle: requirements', { ship: c.name }); }}>
            {showReqs ? '▾' : '▸'} entry requirements ({r.requirements.length})
          </button>
          {showReqs && (
            <table className="data">
              <thead><tr><th>Skill</th><th className="c-num">Level</th><th>Needed by</th></tr></thead>
              <tbody>
                {r.requirements.map((q) => (
                  <tr key={q.skillId}>
                    <td className="hub-name">{q.name}</td>
                    <td className="c-num">{q.level}</td>
                    <td className="dim">{q.because}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}
