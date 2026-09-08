// FIT WIZARD (W1) — graphical fit builder. Fits + REQUIRED-named variations
// live app-side (no in-game size limits); every edit is simulated live by
// the dogma engine for the selected characters. W2 adds "Make It Work" +
// save-to-character; W3 adds the zKill fit browser. Slot locks (🔒 hard /
// ◌ soft) are recorded now so W2 can use them.
import { useEffect, useMemo, useState } from 'react';
import type { CharAccount } from '../lib/auth';
import { useApp } from '../lib/store';
import { useElementWidth } from '../lib/useElementWidth';
import { InfoDot } from './Help';
import { getType } from '../lib/typedb';
import { parseFit, shipTraits } from '../lib/skillRelevance';
import { useAuth } from '../lib/auth';
import { saveFitting, tokenHasScope, FITTINGS_WRITE_SCOPE, syncCharacter } from '../lib/esiChar';
import { getEsfData, type EsfCatalog } from '../lib/dogmaStats';
type WizardData = EsfCatalog;
import { buildMarketTree, filterTree, type TreeNode, type CatalogShapes } from '../lib/marketTree';
import {
  RACK_LABEL, rackSizes, rackForModule, cloneVariation, normalizeFitLayout,
  newWizardFit, variationEft, variationEsfFitFull, buyList, fitVariationName, toEsiFitting, ESI_FIT_NAME_MAX,
  wizardFitFromEft,
  type Rack, type WizardFit, type WizardVariation, type WizardSlot, type SlotState,
} from '../lib/wizardFits';
import { findByName } from '../lib/typedb';
import { loadTeamFits, type TeamFitCatalog } from '../lib/teamFits';
import {
  missingSkillsFor, moduleFitsHull, moduleFitsRemaining, overloadable,
  hullHardpoints, usesLauncherHardpoint, usesTurretHardpoint,
} from '../lib/fitFilters';
import type { EsfDataShapes } from '../lib/dogmaFit';
import { canLoad, takesCharges, type DogmaLookup } from '../lib/fitCharges';
import { loadVariantParents, baseVariantOf } from '../lib/variantParents';
import type { FitStats } from '../lib/dogmaFit';
import FitStatsPanel from './FitStatsPanel';
import PodPicker from './PodPicker';
import ShipTree from './ShipTree';

const typeIcon = (id: number) => `https://images.evetech.net/types/${id}/icon?size=64`;

// EVE-style ring (v0.150): sockets sit ON a drawn ring around the hull —
// highs across the top, mids right, lows bottom, rigs left — and the per-slot
// controls moved into ONE toolbar under the wheel for the selected slot
// (permanent per-slot button rays were the clutter the user vetoed).
const SOCKET_PX = 44;
const SOCKET_GAP = 10;
/** margin past the sockets to the wheel box edge */
const RAY_REACH = 34;

/** Each rack owns a 90° sector (highs top, mids right, lows bottom, rigs
 * left) but may SPAN at most 70° of it, so neighbouring racks always keep
 * ≥20° between their end sockets. One pitch function feeds both the angle
 * layout AND the radius — v0.156's overlap (Ferox Navy: two sockets 23px
 * apart, measured) came from the two disagreeing AND from arcs so wide
 * that full racks abutted at the sector borders. */
const RACK_ARC = 70;
const MAX_PITCH = 12;
const rackPitch = (count: number): number =>
  count > 1 ? Math.min(MAX_PITCH, RACK_ARC / (count - 1)) : 0;

/** Radius at which the busiest rack's sockets sit SOCKET_GAP apart:
 * chord = 2·R·sin(pitch/2) ≥ socket + gap. The ≥20° sector borders need
 * far less radius than the intra-rack pitch, so this bound covers both. */
function wheelRadius(maxSlots: number): number {
  if (maxSlots <= 1) return 200;
  const pitch = rackPitch(maxSlots);
  const need = (SOCKET_PX + SOCKET_GAP) / 2 / Math.sin((pitch / 2) * (Math.PI / 180));
  return Math.max(200, Math.ceil(need));
}

/** 0° must point UP: CSS rotate(0) translate(x) moves RIGHT, so every ray
 * is offset by −90° (the whole wheel was a quarter-turn off). */
const rayStyle = (angleDeg: number, center: number, radius: number): React.CSSProperties => ({
  position: 'absolute',
  left: center,
  top: center,
  transform: `rotate(${angleDeg - 90}deg) translate(${radius}px) rotate(${90 - angleDeg}deg)`,
  transformOrigin: '0 0',
  marginTop: -SOCKET_PX / 2,
  marginLeft: -SOCKET_PX / 2,
});

/** sockets CLUSTER around the rack's centre (a 2-high rack shows two
 * ADJACENT sockets, not two at opposite arc ends) */
function socketAngles(count: number, center: number): number[] {
  if (count === 0) return [];
  const pitch = rackPitch(count);
  const span = pitch * (count - 1);
  return Array.from({ length: count }, (_, i) => center - span / 2 + i * pitch);
}

/** the wheel is genuinely big (radius ≥200px) — on a narrow pane it scales
 * itself down as one unit instead of clipping. Width comes from the shared
 * three-path hook: a bare ResizeObserver can stay silent (useElementWidth),
 * which would have left the wheel clipping at full size. */
function ScaledWheel({ size, children }: { size: number; children: React.ReactNode }) {
  const [ref, w] = useElementWidth(40, size);
  const scale = Math.min(1, w / size);
  return (
    <div ref={ref} style={{ width: '100%', height: size * scale, display: 'flex', justifyContent: 'center', overflow: 'visible' }}>
      <div style={{ transform: `scale(${scale})`, transformOrigin: 'top center' }}>{children}</div>
    </div>
  );
}

/** collapsible EVE-style browse tree (market hierarchy / ship tree).
 * nameFor lets the caller fall back to the SDE bundle's own names — the
 * typedb misses a few live types and the tree showed raw "#32461". */
function TreeBrowser({ nodes, depth, forceOpen, onPick, nameFor }: {
  nodes: TreeNode[];
  depth: number;
  forceOpen: boolean;
  onPick: (typeId: number) => void;
  nameFor?: (typeId: number) => string;
}) {
  const label = (id: number) => nameFor?.(id) ?? getType(id)?.name ?? `#${id}`;
  return (
    <>
      {nodes.map((n) => (
        <details key={n.key} open={forceOpen || undefined} className="wiz-tree-node" style={{ marginLeft: depth * 10 }}>
          <summary title={n.name}>
            {/* in-game-style folder icon: the group's meta-first item */}
            {n.iconTypeId !== undefined && (
              <img className="wiz-tree-icon" src={typeIcon(n.iconTypeId)} alt="" width={18} height={18} loading="lazy" />
            )}
            {n.name}
          </summary>
          {/* items BEFORE subfolders — the client lists a group's tech items
              first, then its Faction & Storyline / Deadspace / Officer folds */}
          {n.typeIds.map((id) => (
            <button key={id} className="wiz-result" style={{ marginLeft: (depth + 1) * 8 }}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('text/etc-type-id', String(id));
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onPick(id)}
              title={`${label(id)}\nclick = place · drag onto a slot to choose where`}>
              <img src={typeIcon(id)} alt="" width={22} height={22} loading="lazy" />
              <span>{label(id)}</span>
            </button>
          ))}
          {n.children.length > 0 && (
            <TreeBrowser nodes={n.children} depth={depth + 1} forceOpen={forceOpen} onPick={onPick} nameFor={nameFor} />
          )}
        </details>
      ))}
    </>
  );
}

type Target = { kind: 'slot'; rack: Rack; index: number } | { kind: 'charge'; rack: Rack; index: number }
  | { kind: 'chargesAll'; forType: number | null } | { kind: 'drones' } | { kind: 'cargo' };

/** racks whose modules can take charges (rigs and subsystems never do) */
const CHARGE_RACKS: Rack[] = ['high', 'med', 'low'];

export default function FitWizard({ chars }: { chars: CharAccount[] }) {
  const fits = useApp((s) => s.wizardFits);
  const setFits = useApp((s) => s.setWizardFits);
  const setCompare = useApp((s) => s.setCharCompare);

  const [data, setData] = useState<WizardData | null>(null);
  const [dataError, setDataError] = useState(false);
  useEffect(() => {
    getEsfData().then(setData).catch(() => setDataError(true));
  }, []);
  /** invMetaTypes child->parent — drives the variations strip; the market
   * leaf stands in until it loads */
  const [varParents, setVarParents] = useState<Record<number, number> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadVariantParents().then((m) => { if (alive) setVarParents(m); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  const [activeFitId, setActiveFitId] = useState<string | null>(fits[0]?.id ?? null);
  const fit = fits.find((f) => f.id === activeFitId) ?? null;
  const [activeVarId, setActiveVarId] = useState<string | null>(fit?.variations[0]?.id ?? null);
  const variation = fit?.variations.find((v) => v.id === activeVarId) ?? fit?.variations[0] ?? null;

  // creation forms
  const [newFitName, setNewFitName] = useState('');
  const [hullQuery, setHullQuery] = useState('');
  const [newVarName, setNewVarName] = useState('');
  const [creating, setCreating] = useState(fits.length === 0);
  // import starting points (v0.193): "look at a fit and alter from it"
  const [teamCatalog, setTeamCatalog] = useState<TeamFitCatalog | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  useEffect(() => {
    if (!creating) return;
    let alive = true;
    void loadTeamFits().then((c) => { if (alive) setTeamCatalog(c); }).catch(() => {});
    return () => { alive = false; };
  }, [creating]);
  /** shared landing for both import paths — reports spills/unresolved
   * instead of silently dropping anything */
  const importEft = (eft: string, nameOverride?: string) => {
    if (!data) return;
    const res = wizardFitFromEft(eft, data, findByName);
    if ('error' in res) { setImportNote(`import failed: ${res.error}`); return; }
    if (nameOverride) res.fit.name = nameOverride;
    setFits([...fits, res.fit]);
    setActiveFitId(res.fit.id);
    setActiveVarId(res.fit.variations[0].id);
    setCreating(false);
    setNewFitName('');
    setHullQuery('');
    const notes = [
      ...(res.spilled.length > 0 ? [`rack full — moved to cargo: ${res.spilled.join(', ')}`] : []),
      ...(res.unresolved.length > 0 ? [`could not resolve: ${res.unresolved.join(', ')}`] : []),
    ];
    setImportNote(notes.length > 0 ? notes.join(' · ') : null);
  };
  /** picking a REPLACEMENT hull for the current fit (kept modules that no
   * longer fit the new layout move to cargo, visibly) */
  const [rehulling, setRehulling] = useState(false);

  // module browser
  const [target, setTarget] = useState<Target | null>(null);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  // browser filters (user spec): my skills / this hull / what's left
  const [fSkills, setFSkills] = useState(false);
  const [fHull, setFHull] = useState(true);
  const [fRoom, setFRoom] = useState(false);
  const [showInfo, setShowInfo] = useState(false);
  /** live stats per character, fed back by the panel — drives fRoom */
  const [liveStats, setLiveStats] = useState<Record<number, FitStats>>({});
  /** whose skills/room the filters use (first selected character) */
  const filterChar = chars[0] ?? null;
  const filterStats = filterChar ? liveStats[filterChar.characterId] : undefined;

  // save-to-character (W2)
  const allCharacters = useAuth((s) => s.characters);
  const [saveCharId, setSaveCharId] = useState<number | null>(null);
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'ok' | 'error'; msg?: string }>({ kind: 'idle' });
  const [relogging, setRelogging] = useState(false);

  /** switching fit/variation MUST disarm the module browser — a stale
   * target wrote into out-of-bounds slots of the newly selected fit */
  const disarmBrowser = () => { setTarget(null); setQuery(''); };

  // the ESF bundle carries `published` at runtime; WizardData's type surface
  // just doesn't declare it — one cast, wrapped, instead of five
  const canLoadW = (moduleType: number, chargeType: number): boolean =>
    !!data && canLoad(data as unknown as DogmaLookup, moduleType, chargeType);
  const takesChargesW = (moduleType: number): boolean =>
    !!data && takesCharges(data as unknown as DogmaLookup, moduleType);

  // browse trees, EVE-style (built once per data load, filtered per keystroke)
  const moduleTree = useMemo(() => {
    if (!data) return [];
    const cat = data as unknown as CatalogShapes;
    // NO slot selected: every fittable module — click auto-places by rack,
    // drag chooses the socket (the in-game browse-first workflow)
    if (!target) return buildMarketTree(cat, (id) => rackForModule(id, data) !== null);
    if (target.kind === 'slot') return buildMarketTree(cat, (id) => rackForModule(id, data) === target.rack);
    if (target.kind === 'charge') {
      // FILTERED BY THE MODULE (v0.164): the in-game charge browser only
      // shows what the selected module can actually load — same here
      const modId = variation?.[target.rack]?.[target.index]?.typeId ?? null;
      return buildMarketTree(cat, (id) => data.types[id]?.categoryID === 8
        && (modId === null || canLoadW(modId, id)));
    }
    if (target.kind === 'chargesAll') {
      return buildMarketTree(cat, (id) => data.types[id]?.categoryID === 8
        && (target.forType === null || canLoadW(target.forType, id)));
    }
    if (target.kind === 'drones') return buildMarketTree(cat, (id) => data.types[id]?.categoryID === 18);
    return buildMarketTree(cat, () => true); // cargo: the whole market
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, target?.kind,
    target?.kind === 'slot' || target?.kind === 'charge' ? target.rack : '',
    target?.kind === 'charge' ? variation?.[target.rack]?.[target.index]?.typeId ?? '' : '',
    target?.kind === 'chargesAll' ? target.forType ?? '' : '']);
  /** eligibility filters, applied before the text filter. Each states its
   * own honest limit in the checkbox tooltip. */
  const eligibleTree = useMemo(() => {
    if (!data || !fit) return moduleTree;
    const cpuLeft = filterStats ? filterStats.cpu.output - filterStats.cpu.load : Infinity;
    const pgLeft = filterStats ? filterStats.power.output - filterStats.power.load : Infinity;
    const calLeft = filterStats ? filterStats.calibration.output - filterStats.calibration.load : Infinity;
    // HARDPOINTS (v0.177): free launcher/turret points from the CURRENT
    // loadout — a 7th turret on a 6-point hull passed every cpu/pg check
    const dogma = data as unknown as EsfDataShapes;
    const hp = hullHardpoints(dogma, fit.hullId);
    let usedL = 0; let usedT = 0;
    if (variation) {
      for (const sl of variation.high) {
        if (sl.typeId === null) continue;
        if (usesLauncherHardpoint(dogma, sl.typeId)) usedL += 1;
        if (usesTurretHardpoint(dogma, sl.typeId)) usedT += 1;
      }
    }
    const launchersLeft = hp.launcher - usedL;
    const turretsLeft = hp.turret - usedT;
    // replacing a module? its cost comes back when it leaves the slot —
    // judging the candidate against the fit that still contains it made
    // legal swaps look impossible on a tight fit
    const outgoing =
      target?.kind === 'slot' ? variation?.[target.rack]?.[target.index]?.typeId ?? undefined : undefined;
    const ok = (id: number): boolean => {
      if (fHull && !moduleFitsHull(id, fit.hullId, data)) return false;
      if (fSkills && filterChar?.skills && missingSkillsFor(id, filterChar.skills).length > 0) return false;
      if (fRoom && filterStats && !moduleFitsRemaining(id, data, cpuLeft, pgLeft, calLeft, outgoing, launchersLeft, turretsLeft)) return false;
      return true;
    };
    if (!fHull && !fSkills && !fRoom) return moduleTree;
    void target; void variation; // (deps below cover the replacement case)
    const prune = (n: TreeNode): TreeNode | null => {
      const typeIds = n.typeIds.filter(ok);
      const children = n.children.map(prune).filter((c): c is TreeNode => c !== null);
      if (typeIds.length === 0 && children.length === 0) return null;
      return { ...n, typeIds, children };
    };
    return moduleTree.map(prune).filter((n): n is TreeNode => n !== null);
  }, [data, fit, moduleTree, fHull, fSkills, fRoom, filterChar, filterStats, target, variation]);

  const shownModuleTree = useMemo(
    () => (data ? filterTree(data as unknown as CatalogShapes, eligibleTree, query) : []),
    [data, eligibleTree, query],
  );

  const updateFit = (updated: WizardFit) => setFits(fits.map((f) => (f.id === updated.id ? updated : f)));
  const updateVariation = (mut: (v: WizardVariation) => WizardVariation) => {
    if (!fit || !variation) return;
    updateFit({ ...fit, variations: fit.variations.map((v) => (v.id === variation.id ? mut(JSON.parse(JSON.stringify(v)) as WizardVariation) : v)) });
  };

  const [placeNote, setPlaceNote] = useState<string | null>(null);
  useEffect(() => {
    if (!placeNote) return;
    const t = setTimeout(() => setPlaceNote(null), 4000);
    return () => clearTimeout(t);
  }, [placeNote]);

  /** null = fine; otherwise why this module can't take a hardpoint here
   * (v0.177 — launchers were placeable on turret boats) */
  const hardpointBlock = (typeId: number, replacingTypeId?: number | null): string | null => {
    if (!data || !variation || !fit) return null;
    const dogma = data as unknown as EsfDataShapes;
    const isL = usesLauncherHardpoint(dogma, typeId);
    const isT = usesTurretHardpoint(dogma, typeId);
    if (!isL && !isT) return null;
    const uses = (id: number) => (isL ? usesLauncherHardpoint(dogma, id) : usesTurretHardpoint(dogma, id));
    let used = 0;
    for (const sl of variation.high) if (sl.typeId !== null && uses(sl.typeId)) used += 1;
    if (replacingTypeId != null && uses(replacingTypeId)) used -= 1;
    const total = isL ? hullHardpoints(dogma, fit.hullId).launcher : hullHardpoints(dogma, fit.hullId).turret;
    if (used + 1 > total) {
      return `${getType(typeId)?.name ?? 'That'} needs a ${isL ? 'LAUNCHER' : 'TURRET'} hardpoint — this hull has ${total} and ${used} in use.`;
    }
    return null;
  };

  /** place a module in a SPECIFIC slot (drag-drop target, or click with a
   * slot selected). A charge dropped on a filled module loads it instead. */
  const placeAt = (rack: Rack, index: number, typeId: number) => {
    if (!data || !variation) return;
    const isCharge = data.types[typeId]?.categoryID === 8;
    if (isCharge) {
      const slot = variation[rack][index];
      if (!slot || slot.typeId === null) { setPlaceNote('Load charges into a FITTED module — that slot is empty.'); return; }
      updateVariation((v) => { v[rack][index].chargeTypeId = typeId; return v; });
      return;
    }
    const want = rackForModule(typeId, data);
    if (want === null) { setPlaceNote(`${getType(typeId)?.name ?? 'That'} doesn't fit in any slot.`); return; }
    if (want !== rack) {
      setPlaceNote(`${getType(typeId)?.name ?? 'That module'} is a ${RACK_LABEL[want]}-slot module — drop it on a ${RACK_LABEL[want][0].toUpperCase()} socket.`);
      return;
    }
    const hpErr = hardpointBlock(typeId, variation[rack][index]?.typeId ?? null);
    if (hpErr) { setPlaceNote(hpErr); return; }
    updateVariation((v) => { v[rack][index] = { typeId }; return v; });
    setTarget({ kind: 'slot', rack, index });
  };

  /** in-game style: clicking a module with NO slot selected fits it into the
   * first EMPTY slot of its rack (like drag-to-ship in the fitting window) */
  const autoPlace = (typeId: number): boolean => {
    if (!data || !variation) return false;
    const rack = rackForModule(typeId, data);
    if (rack === null) return false;
    const hpErr = hardpointBlock(typeId);
    if (hpErr) { setPlaceNote(hpErr); return true; }
    const idx = variation[rack].findIndex((sl) => sl.typeId === null);
    if (idx === -1) {
      setPlaceNote(`No free ${RACK_LABEL[rack]} slot — right-click a fitted one to clear it, or drop onto it to replace.`);
      return true;
    }
    updateVariation((v) => { v[rack][idx] = { typeId }; return v; });
    setTarget({ kind: 'slot', rack, index: idx });
    return true;
  };

  const assign = (typeId: number) => {
    if (!target) { autoPlace(typeId); return; }
    // CHARGES MODE (v0.164): clicking a charge loads it into EVERY fitted
    // module of the chosen type — the in-game group-load behaviour. With no
    // module chip picked, a charge only ONE fitted type can take loads that
    // type; an ambiguous charge asks you to pick.
    if (target.kind === 'chargesAll') {
      if (!data || !variation) return;
      let modType = target.forType;
      if (modType === null) {
        const fitted = [...new Set(CHARGE_RACKS.flatMap((r) =>
          variation[r].map((s) => s.typeId).filter((x): x is number => x !== null)))];
        const takers = fitted.filter((m) => canLoadW(m, typeId));
        if (takers.length === 0) {
          setPlaceNote(`Nothing fitted can load ${getType(typeId)?.name ?? 'that charge'}.`);
          return;
        }
        if (takers.length > 1) {
          setPlaceNote(`Several fitted modules can load ${getType(typeId)?.name ?? 'that'} — pick one above to choose.`);
          return;
        }
        modType = takers[0];
      }
      const mt = modType;
      if (!canLoadW(mt, typeId)) {
        setPlaceNote(`${getType(mt)?.name ?? 'That module'} cannot load ${getType(typeId)?.name ?? 'that charge'}.`);
        return;
      }
      const n = CHARGE_RACKS.reduce((s, r) => s + variation[r].filter((sl) => sl.typeId === mt).length, 0);
      updateVariation((v) => {
        for (const r of CHARGE_RACKS) for (const sl of v[r]) if (sl.typeId === mt) sl.chargeTypeId = typeId;
        return v;
      });
      setPlaceNote(`${getType(typeId)?.name ?? 'Charge'} loaded into ${n}× ${getType(mt)?.name ?? 'module'}.`);
      return;
    }
    if (target.kind === 'slot' && data && variation) {
      const isCharge = data.types[typeId]?.categoryID === 8;
      if (!isCharge) {
        const hpErr = hardpointBlock(typeId, variation[target.rack]?.[target.index]?.typeId ?? null);
        if (hpErr) { setPlaceNote(hpErr); return; }
      }
    }
    updateVariation((v) => {
      if (target.kind === 'slot') {
        // a stale target could point past this variation's rack — writing
        // there created array holes that corrupted the persisted store
        if (target.index >= v[target.rack].length) { disarmBrowser(); return v; }
        // fresh module: the OLD module's charge/lock must not carry over
        v[target.rack][target.index] = { typeId };
      } else if (target.kind === 'charge') {
        const slot = v[target.rack][target.index];
        // a charge without a module exists in no view — refuse the orphan
        if (!slot || slot.typeId === null) { disarmBrowser(); return v; }
        slot.chargeTypeId = typeId;
      } else if (target.kind === 'drones') {
        const d = v.drones.find((x) => x.typeId === typeId);
        if (d) d.qty += 1; else v.drones.push({ typeId, qty: 1 });
      } else {
        const c = v.cargo.find((x) => x.typeId === typeId);
        if (c) c.qty += 1; else v.cargo.push({ typeId, qty: 1 });
      }
      return v;
    });
  };

  // reconcile stored rack arrays with the CURRENT bundle's slot counts —
  // CCP moves slots in balance patches; truncated modules go to cargo,
  // VISIBLY (they'd otherwise flow into stats from invisible slots)
  const [layoutNote, setLayoutNote] = useState<string[]>([]);
  /** every variation's subsystem loadout, as one string — changes exactly
   * when a subsystem is added, removed or swapped */
  const subSig = (fit?.variations ?? [])
    .map((v) => v.sub.map((sl) => sl.typeId ?? '_').join(','))
    .join('|');
  useEffect(() => {
    if (!fit || !data) return;
    const norm = normalizeFitLayout(fit, (v) => rackSizes(fit.hullId, data, v.sub));
    if (norm.changed) {
      updateFit(norm.fit);
      if (norm.movedToCargo.length > 0) setLayoutNote(norm.movedToCargo);
    }
    // subSig is in the deps because a T3's rack SIZES come from its fitted
    // subsystems: swapping one genuinely adds or removes high/mid/low slots,
    // exactly as in game, so the layout has to be re-normalised right then
    // rather than only when the fit is first opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.id, data, subSig]);

  const eft = fit && variation ? variationEft(fit, variation) : '';
  const parsed = useMemo(() => (eft ? parseFit(eft) : null), [eft]);
  // stats run from the ENGINE fit, not the EFT text — overheating has no
  // EFT notation and would be lost on the round trip
  // variationEsfFitFull, not variationEsfFit: the wizard must show the SAME
  // drone numbers as every other surface, and name the spares it benched
  const esfBuild = useMemo(
    () => (fit && variation && data ? variationEsfFitFull(fit, variation, data) : undefined),
    [fit, variation, data],
  );
  const esfFit = esfBuild?.esfFit;
  const benchedDrones = esfBuild?.benchedDrones ?? [];

  const copy = (id: string, text: string) => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {});
  };

  if (dataError) {
    return <div className="empty">Dogma data failed to load — the wizard needs it for slot layouts. Restart the app or rebuild the data bundle.</div>;
  }
  if (!data) return <div className="empty">loading dogma data…</div>;

  // ---- hull swap flow ----
  if (rehulling && fit) {
    return (
      <div className="wiz-create">
        <div className="wiz-create-bar">
          <label>
            <span>Filter ships</span>
            <input type="text" value={hullQuery} placeholder="e.g. khiz, loki, rifter" autoFocus
              onChange={(e) => setHullQuery(e.target.value)} />
          </label>
          <button className="btn" onClick={() => { setRehulling(false); setHullQuery(''); }}>cancel</button>
        </div>
        <div className="hint" style={{ margin: '0 0 6px' }}>
          New hull for <b>{fit.name}</b> (currently {getType(fit.hullId)?.name ?? fit.hullId}). Modules in
          slots the new hull doesn't have move to cargo — nothing is silently lost.
        </div>
        <div className="wiz-create-tree">
          <ShipTree data={data} query={hullQuery}
            onPick={(hullId) => {
              const norm = normalizeFitLayout({ ...fit, hullId }, (v) => rackSizes(hullId, data, v.sub));
              updateFit(norm.fit);
              if (norm.movedToCargo.length > 0) setLayoutNote(norm.movedToCargo);
              setRehulling(false);
              setHullQuery('');
              disarmBrowser();
            }} />
        </div>
      </div>
    );
  }

  // ---- creation flow: the SHIP LIST is the page; the name is one field
  // above it and defaults to the hull's own name if left blank ----
  if (creating || !fit) {
    const createFit = (hullId: number) => {
      const name = newFitName.trim() || getType(hullId)?.name || 'New fit';
      const created = newWizardFit(name, hullId, rackSizes(hullId, data));
      setFits([...fits, created]);
      setActiveFitId(created.id);
      setActiveVarId(created.variations[0].id);
      setCreating(false);
      setNewFitName('');
      setHullQuery('');
      disarmBrowser();
    };
    return (
      <div className="wiz-create">
        <div className="wiz-create-bar">
          <label>
            <span>Fit name</span>
            <input type="text" value={newFitName} placeholder="defaults to the hull name"
              onChange={(e) => setNewFitName(e.target.value)} />
          </label>
          <label>
            <span>Filter ships</span>
            <input type="text" value={hullQuery} placeholder="e.g. khiz, loki, rifter" autoFocus
              onChange={(e) => setHullQuery(e.target.value)} />
          </label>
          {fits.length > 0 && (
            <button className="btn" onClick={() => { setCreating(false); setHullQuery(''); }}>cancel</button>
          )}
        </div>
        {/* STARTING POINTS (v0.193): most fits are alterations of an
            existing one, not blank slates */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', margin: '6px 0' }}>
          <button className="btn"
            title="Read an EFT fit from the clipboard (copy one in game: fitting window → ≡ → Copy) and open it here as a new editable fit."
            onClick={() => {
              void navigator.clipboard.readText()
                .then((t) => importEft(t))
                .catch(() => setImportNote('could not read the clipboard'));
            }}>
            📋 new fit from clipboard
          </button>
          <span className="dim" style={{ fontSize: 12 }}>or start from a saved fit:</span>
          <select value="" style={{ maxWidth: 340 }}
            title="Every character's in-game saved fits — pick one to open a copy here as a starting point. The in-game original is never touched."
            onChange={(e) => {
              const f = teamCatalog?.fits.find((x) => x.key === e.target.value);
              if (f) importEft(f.eft, f.fitName);
            }}>
            <option value="">
              {teamCatalog === null ? 'loading saved fits…'
                : teamCatalog.fits.length === 0 ? 'no saved fits found' : 'pick a saved fit…'}
            </option>
            {chars.concat(allCharacters.filter((a) => !chars.some((c) => c.characterId === a.characterId)))
              .map((c) => {
                const own = (teamCatalog?.fits ?? []).filter((f) => f.sources.some((s) => s.charId === c.characterId && s.kind === 'saved'));
                if (own.length === 0) return null;
                return (
                  <optgroup key={c.characterId} label={c.characterName}>
                    {own.map((f) => (
                      <option key={`${c.characterId}:${f.key}`} value={f.key}>
                        {f.fitName} ({f.hullName})
                      </option>
                    ))}
                  </optgroup>
                );
              })}
          </select>
          {importNote && <span className="hint" style={{ margin: 0, color: '#e0a13a' }}>{importNote}</span>}
        </div>
        <div className="hint" style={{ margin: '0 0 6px' }}>
          Pick a hull below to start the fit — rename it any time with ✎. Variations are added inside
          the fit (in-game saves are named “&lt;fit&gt; - &lt;variation&gt;”).
        </div>
        <div className="wiz-create-tree">
          <ShipTree data={data} query={hullQuery} onPick={createFit} />
        </div>
      </div>
    );
  }

  // subsystem-aware: a T3's racks come from its fitted subsystems, not the hull
  const sizes = rackSizes(fit.hullId, data, variation?.sub ?? []);
  // EVE-style quadrants: highs TOP, mids RIGHT, lows BOTTOM, rigs LEFT
  const RACK_CENTER: Record<'high' | 'med' | 'low' | 'rig', number> = {
    high: 0, med: 90, low: 180, rig: 270,
  };
  // the wheel grows with the busiest rack so sockets never overlap
  const wheelR = wheelRadius(Math.max(sizes.high, sizes.med, sizes.low, sizes.rig));
  const wheelCenter = wheelR + RAY_REACH;
  const wheelBox = wheelCenter * 2;

  /** one circular socket ON the ring, in-game style: the module icon in a
   * ring whose COLOUR is the state (red overheat / green active / blue
   * online / grey slash offline), the loaded charge as a small inset, the
   * lock as a corner badge. All controls live in the toolbar below the
   * wheel once a slot is selected. */
  const socket = (rack: Rack, index: number, s: WizardSlot, angleDeg: number) => {
    const isTarget = (target?.kind === 'slot' || target?.kind === 'charge') && target.rack === rack && target.index === index;
    const filled = s.typeId !== null;
    const state = s.state ?? 'active';
    const passiveRack = rack === 'rig' || rack === 'sub';
    const name = filled ? getType(s.typeId as number)?.name ?? `#${s.typeId}` : null;
    return (
      <div key={`${rack}${index}`} className="wiz-ray" style={rayStyle(angleDeg, wheelCenter, wheelR)}>
        <button
          className={[
            'wiz-socket',
            isTarget ? 'on' : '',
            filled ? 'filled' : 'empty',
            filled && !passiveRack ? `st-${state}` : '',
          ].join(' ')}
          title={filled
            ? `${name}${passiveRack ? '' : ` — ${state.toUpperCase()}`}${s.chargeTypeId !== undefined ? `\ncharge: ${getType(s.chargeTypeId)?.name ?? s.chargeTypeId}` : ''}${s.lock ? `\nlock: ${s.lock}` : ''}\nclick = select (controls appear below) · right-click = clear\ndrag = move to another slot · shift-drag = copy (like in-game)`
            : `empty ${RACK_LABEL[rack]} slot — click, then pick a module from the browser`}
          onClick={() => { setTarget({ kind: 'slot', rack, index }); setQuery(''); }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (filled) updateVariation((v) => { v[rack][index] = { typeId: null }; return v; });
          }}
          draggable={filled}
          onDragStart={(e) => {
            if (!filled) return;
            e.dataTransfer.setData('text/etc-slot', JSON.stringify({ rack, index }));
            e.dataTransfer.effectAllowed = 'copyMove';
          }}
          onDragOver={(e) => {
            e.preventDefault();
            const slotDrag = e.dataTransfer.types.includes('text/etc-slot');
            e.dataTransfer.dropEffect = slotDrag ? (e.shiftKey ? 'copy' : 'move') : 'copy';
          }}
          onDrop={(e) => {
            e.preventDefault();
            // socket→socket drag: plain = MOVE (swap with what's there),
            // shift = COPY — the in-game gestures
            const slotRaw = e.dataTransfer.getData('text/etc-slot');
            if (slotRaw && variation) {
              let src: { rack: Rack; index: number } | null = null;
              try { src = JSON.parse(slotRaw) as { rack: Rack; index: number }; } catch { src = null; }
              if (!src || (src.rack === rack && src.index === index)) return;
              const moving = variation[src.rack]?.[src.index];
              if (!moving || moving.typeId === null) return;
              const want = rackForModule(moving.typeId, data);
              if (want !== rack) {
                setPlaceNote(`${getType(moving.typeId)?.name ?? 'That module'} is a ${want ? RACK_LABEL[want] : '?'}-slot module — it can't go in a ${RACK_LABEL[rack]} slot.`);
                return;
              }
              const isCopy = e.shiftKey;
              const from = src;
              updateVariation((v) => {
                const prev = v[rack][index] ?? { typeId: null };
                v[rack][index] = { ...v[from.rack][from.index] };
                if (!isCopy) v[from.rack][from.index] = prev;
                return v;
              });
              return;
            }
            const id = Number(e.dataTransfer.getData('text/etc-type-id'));
            if (id) placeAt(rack, index, id);
          }}>
          {filled
            ? <img src={typeIcon(s.typeId as number)} alt="" draggable={false} />
            : <span className="wiz-slot-letter">{RACK_LABEL[rack][0].toUpperCase()}</span>}
          {filled && s.chargeTypeId !== undefined && (
            <img className="wiz-charge-inset" src={typeIcon(s.chargeTypeId)} alt="" draggable={false} />
          )}
          {filled && s.lock && <span className="wiz-lock-badge">{s.lock === 'hard' ? '🔒' : '◌'}</span>}
        </button>
      </div>
    );
  };

  /** meta tier order for the variations strip (T1, T2, T3, faction,
   * storyline, deadspace, officer, rest) */
  const varMetaRank = (m?: number): number => {
    const v = m || 1;
    return v === 1 ? 0 : v === 2 ? 1 : v === 14 ? 2 : v === 4 ? 3 : v === 3 ? 4 : v === 6 ? 5 : v === 5 ? 6 : 7;
  };
  /** every published variant of this module — the invMetaTypes FAMILY
   * (what the in-game Variations tab shows: 250mm Railgun II chains to
   * 250mm Railgun I). Until the table loads, the same MARKET LEAF is the
   * fallback (broader — it mixes 200mm and 250mm). */
  const variationsOf = (typeId: number): number[] => {
    if (!data) return [];
    const cat = data as unknown as CatalogShapes;
    const t = cat.types[typeId];
    if (!t) return [];
    let ids: number[];
    if (varParents !== null) {
      const base = baseVariantOf(varParents, typeId);
      ids = Object.entries(cat.types)
        .filter(([id, x]) => x.published !== false && baseVariantOf(varParents, Number(id)) === base)
        .map(([id]) => Number(id));
    } else {
      const mg = t.marketGroupID;
      ids = Object.entries(cat.types)
        .filter(([, x]) => x.published !== false
          && (mg !== undefined && mg !== 0 ? x.marketGroupID === mg : x.groupID === t.groupID))
        .map(([id]) => Number(id));
    }
    return ids.sort((a, b) => varMetaRank(cat.types[a]?.metaGroupID) - varMetaRank(cat.types[b]?.metaGroupID)
      || (cat.types[a]?.name ?? '').localeCompare(cat.types[b]?.name ?? ''));
  };
  const modAttr = (typeId: number, attrId: number): number | undefined =>
    (data as unknown as EsfDataShapes | null)?.typeDogma[typeId]?.dogmaAttributes
      .find((a) => a.attributeID === attrId)?.value;
  /** swap the selected slot to a variant, keeping state/lock and the charge
   * when the new module can still load it */
  const swapVariant = (newId: number) => {
    if (!variation || (target?.kind !== 'slot' && target?.kind !== 'charge')) return;
    const t = target as { rack: Rack; index: number };
    updateVariation((v) => {
      const sl = v[t.rack][t.index];
      if (!sl || sl.typeId === null) return v;
      const keepCharge = sl.chargeTypeId !== undefined && canLoadW(newId, sl.chargeTypeId);
      v[t.rack][t.index] = { ...sl, typeId: newId, chargeTypeId: keepCharge ? sl.chargeTypeId : undefined };
      return v;
    });
  };

  /** the SELECTED slot's controls — one clean toolbar under the wheel, in
   * place of four tiny buttons stuck to every socket */
  const slotToolbar = () => {
    if (!variation || (target?.kind !== 'slot' && target?.kind !== 'charge')) return null;
    const t = target as { rack: Rack; index: number };
    const s = variation[t.rack]?.[t.index];
    if (!s || s.typeId === null) return null;
    const passiveRack = t.rack === 'rig' || t.rack === 'sub';
    const state = s.state ?? 'active';
    const canOh = overloadable(s.typeId, data);
    const states: SlotState[] = canOh ? ['offline', 'online', 'active', 'overload'] : ['offline', 'online', 'active'];
    const STATE_WORD: Record<SlotState, string> = { offline: 'offline', online: 'online', active: 'active', overload: 'overheat' };
    return (
      <>
      <div className="wiz-slotbar">
        <img src={typeIcon(s.typeId)} alt="" width={26} height={26} style={{ borderRadius: 13 }} />
        <b className="wiz-slotbar-name">{getType(s.typeId)?.name ?? `#${s.typeId}`}</b>
        {!passiveRack && (
          <span className="wiz-slotbar-states">
            {states.map((st) => (
              <button key={st} className={`wiz-state-btn st-${st} ${state === st ? 'on' : ''}`}
                title={st === 'overload' ? 'overheat (simulated)' : st}
                onClick={() => updateVariation((v) => { v[t.rack][t.index].state = st; return v; })}>
                {STATE_WORD[st]}
              </button>
            ))}
          </span>
        )}
        {/* only modules that actually TAKE charges get the button — it used
            to show on everything (v0.166 fix) */}
        {s.typeId !== null && takesChargesW(s.typeId) && (
          <button className={`btn mini ${target?.kind === 'charge' ? 'primary' : ''}`}
            title={s.chargeTypeId !== undefined ? `charge: ${getType(s.chargeTypeId)?.name ?? s.chargeTypeId} — click to change` : 'load a CHARGE into this module'}
            onClick={() => { setTarget({ kind: 'charge', rack: t.rack, index: t.index }); setQuery(''); }}>
            {s.chargeTypeId !== undefined
              ? <><img src={typeIcon(s.chargeTypeId)} alt="" width={14} height={14} style={{ verticalAlign: -2, marginRight: 4 }} />charge</>
              : 'load charge'}
          </button>
        )}
        <button className={`btn mini ${s.lock === 'soft' ? 'primary' : ''}`}
          title="SOFT lock: Make It Work keeps this KIND of module but may swap the variant"
          onClick={() => updateVariation((v) => { v[t.rack][t.index].lock = v[t.rack][t.index].lock === 'soft' ? undefined : 'soft'; return v; })}>
          {'◌'} soft
        </button>
        <button className={`btn mini ${s.lock === 'hard' ? 'primary' : ''}`}
          title="HARD lock: Make It Work keeps exactly this module"
          onClick={() => updateVariation((v) => { v[t.rack][t.index].lock = v[t.rack][t.index].lock === 'hard' ? undefined : 'hard'; return v; })}>
          🔒 hard
        </button>
        <button className="btn mini" title="Clear this slot"
          onClick={() => updateVariation((v) => { v[t.rack][t.index] = { typeId: null }; return v; })}>
          {'✕'} clear
        </button>
      </div>
      {(() => {
        // VARIATIONS of the fitted module (v0.177, user ask): the same
        // market leaf the in-game Variations tab shows — click to swap in
        // place, keeping state/lock (and the charge when it still loads)
        const vars = variationsOf(s.typeId as number);
        if (vars.length <= 1) return null;
        const cat = data as unknown as CatalogShapes;
        return (
          <div className="wiz-variants">
            <span className="wiz-variants-head">variations</span>
            {vars.map((id) => {
              const cur = id === s.typeId;
              const name = getType(id)?.name ?? cat.types[id]?.name ?? `#${id}`;
              const cpu = modAttr(id, 50);
              const pg = modAttr(id, 30);
              return (
                <button key={id} className={`wiz-variant meta-${varMetaRank(cat.types[id]?.metaGroupID)}${cur ? ' on' : ''}`}
                  disabled={cur}
                  title={`${name}${cpu !== undefined ? `\ncpu ${cpu} tf` : ''}${pg !== undefined ? ` · pg ${pg} MW` : ''}${cur ? '\n(currently fitted)' : '\nclick to swap into this slot'}`}
                  onClick={() => swapVariant(id)}>
                  <img src={typeIcon(id)} alt="" width={22} height={22} loading="lazy" />
                  <span>{name}</span>
                </button>
              );
            })}
          </div>
        );
      })()}
      </>
    );
  };

  return (
    <div className="wiz-layout">
      {showInfo && (
        // in-game-style info window: the hull's TRAITS (per-skill bonuses
        // and role bonuses, straight from the SDE) — what "what does this
        // ship do" actually means
        <div className="overlay" onClick={() => setShowInfo(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>
              <img src={typeIcon(fit.hullId)} alt="" width={32} height={32} style={{ verticalAlign: 'middle', marginRight: 8 }} />
              {getType(fit.hullId)?.name ?? fit.hullId}
            </h2>
            {(() => {
              const traits = shipTraits(fit.hullId);
              if (traits.length === 0) return <div className="empty">This hull has no trait bonuses in the SDE.</div>;
              const bySkill = new Map<string, typeof traits>();
              for (const t of traits) (bySkill.get(t.skillName) ?? bySkill.set(t.skillName, []).get(t.skillName)!).push(t);
              return [...bySkill.entries()].map(([skill, list]) => (
                <div key={skill} style={{ marginBottom: 10 }}>
                  <div className="section-title">{skill}{skill === 'Role bonus' ? '' : ' bonuses per level'}</div>
                  <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
                    {list.map((t, i) => (
                      <li key={i} style={{ fontSize: 13 }}>
                        {t.bonus !== 0 && <b>{t.bonus}{t.isPercent ? '%' : ''} </b>}{t.text}
                      </li>
                    ))}
                  </ul>
                </div>
              ));
            })()}
            <div className="hint">
              Traits come from CCP's own invTraits table. Per-level bonuses apply at the listed skill's
              level; role bonuses always apply. Full computed attributes are in the stats panel.
            </div>
            <div className="actions">
              <button className="btn primary" onClick={() => setShowInfo(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
      {/* left: module browser */}
      <div className="wiz-browser wiz-pane">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>modules</span>
          <InfoDot id="wizard.browser" />
        </div>
        <div className="hint" style={{ margin: '0 0 6px' }}>
          {target === null
            ? 'Click a module to fit it into its first free slot, or drag it onto a specific socket. Click a slot to filter this list to what fits there.'
            : target.kind === 'slot'
              ? `Picking for ${RACK_LABEL[target.rack]} slot ${target.index + 1}`
              : target.kind === 'charge'
                ? 'Picking a CHARGE for the selected module — the list shows only what it can load'
                : target.kind === 'chargesAll'
                  ? 'Charges — pick a fitted module below to filter to what it loads; clicking a charge loads ALL modules of that type'
                  : target.kind === 'drones' ? 'Adding drones' : 'Adding cargo / spares'}
        </div>
        {target?.kind === 'chargesAll' && variation && data && (() => {
          const fitted = [...new Set(CHARGE_RACKS.flatMap((r) =>
            variation[r].map((s) => s.typeId).filter((x): x is number => x !== null)))];
          const takers = fitted.filter((m) => takesChargesW(m));
          const countOf = (m: number) =>
            CHARGE_RACKS.reduce((s, r) => s + variation[r].filter((sl) => sl.typeId === m).length, 0);
          return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '0 0 6px' }}>
              <button className={`btn mini${target.forType === null ? ' on' : ''}`}
                title="every charge in the market, in-game grouping"
                onClick={() => setTarget({ kind: 'chargesAll', forType: null })}>all charges</button>
              {takers.map((m) => (
                <button key={m} className={`btn mini${target.forType === m ? ' on' : ''}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 5, paddingLeft: 4 }}
                  title={`${getType(m)?.name ?? m} — show only charges it can load; clicking a charge loads all ${countOf(m)} of them`}
                  onClick={() => setTarget({ kind: 'chargesAll', forType: target.forType === m ? null : m })}>
                  <img src={typeIcon(m)} width={20} height={20} alt="" />
                  {countOf(m)}× {getType(m)?.name ?? `#${m}`}
                </button>
              ))}
              {takers.length === 0 && (
                <span className="dim" style={{ fontSize: 12 }}>no fitted module takes charges yet — fit some launchers/turrets first</span>
              )}
            </div>
          );
        })()}
        <input type="text" value={query} placeholder="filter the tree…" style={{ width: '100%' }}
          onChange={(e) => setQuery(e.target.value)} />
        <div className="wiz-filters">
          <label title="Hide modules this hull cannot take: rig SIZE must match the hull, and any ship-type/ship-group restriction on the module must include this hull (both straight from the SDE).">
            <input type="checkbox" checked={fHull} onChange={(e) => setFHull(e.target.checked)} /> fits hull
          </label>
          <label title={filterChar?.skills
            ? `Hide modules ${filterChar.characterName} cannot online — every required skill at the required level (their synced skills).`
            : 'Select a character (far left) with synced skills to filter by skills.'}>
            <input type="checkbox" checked={fSkills} disabled={!filterChar?.skills}
              onChange={(e) => setFSkills(e.target.checked)} /> my skills
          </label>
          <label title={filterStats
            ? `Hide modules whose RAW cpu/powergrid exceed what's left (${(filterStats.cpu.output - filterStats.cpu.load).toFixed(1)} tf, ${(filterStats.power.output - filterStats.power.load).toFixed(1)} MW for ${filterChar?.characterName}). Module-side reductions (e.g. Advanced Weapon Upgrades) are NOT modelled here, so a hidden module may still fit in game.`
            : 'Needs live stats — select a character with synced skills.'}>
            <input type="checkbox" checked={fRoom} disabled={!filterStats}
              onChange={(e) => setFRoom(e.target.checked)} /> fits what's left
          </label>
        </div>
        <div className="wiz-results">
          <TreeBrowser nodes={shownModuleTree} depth={0} forceOpen={query.trim().length > 0} onPick={assign}
            nameFor={(id) => getType(id)?.name ?? (data as unknown as CatalogShapes)?.types?.[id]?.name ?? `#${id}`} />
          {shownModuleTree.length === 0 && (
            <div className="dim" style={{ padding: 6 }}>
              {query.trim().length > 0 ? 'nothing matching fits this slot' : 'nothing fits this slot'}
            </div>
          )}
        </div>
        <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn ${target?.kind === 'chargesAll' ? 'primary' : ''}`}
            title="browse charges like the in-game Charges tab — pick a fitted module to filter, click a charge to load every module of that type"
            onClick={() => { setTarget({ kind: 'chargesAll', forType: null }); setQuery(''); }}>+ charges</button>
          <button className={`btn ${target?.kind === 'drones' ? 'primary' : ''}`} onClick={() => { setTarget({ kind: 'drones' }); setQuery(''); }}>+ drones</button>
          <button className={`btn ${target?.kind === 'cargo' ? 'primary' : ''}`} onClick={() => { setTarget({ kind: 'cargo' }); setQuery(''); }}>+ cargo/spares</button>
        </div>
        {variation && (variation.drones.length > 0 || variation.cargo.length > 0) && (
          <div style={{ marginTop: 8 }}>
            {(['drones', 'cargo'] as const).map((kind) =>
              variation[kind].map((q) => (
                <div key={`${kind}${q.typeId}`} className="wiz-qty-row">
                  <img src={typeIcon(q.typeId)} alt="" width={20} height={20} />
                  <span style={{ flex: 1 }}>{getType(q.typeId)?.name ?? `#${q.typeId}`}</span>
                  <input type="number" min={1} value={q.qty} style={{ width: 60 }}
                    onChange={(e) => updateVariation((v) => {
                      const row = v[kind].find((x) => x.typeId === q.typeId);
                      if (row) row.qty = Math.max(1, Number(e.target.value) || 1);
                      return v;
                    })} />
                  <button className="btn mini" onClick={() => updateVariation((v) => {
                    v[kind] = v[kind].filter((x) => x.typeId !== q.typeId);
                    return v;
                  })}>×</button>
                </div>
              )),
            )}
          </div>
        )}
      </div>

      {/* center: fit/variation management + the wheel */}
      <div className="wiz-center wiz-pane">
        <div className="finder-form" style={{ marginBottom: 6 }}>
          <label>
            <span>Fit</span>
            <select value={fit.id} onChange={(e) => {
              disarmBrowser(); // stale targets wrote into the WRONG fit
              if (e.target.value === '__new') { setCreating(true); return; }
              setActiveFitId(e.target.value);
              const f = fits.find((x) => x.id === e.target.value);
              setActiveVarId(f?.variations[0]?.id ?? null);
            }}>
              {fits.map((f) => <option key={f.id} value={f.id}>{f.name} ({getType(f.hullId)?.name ?? f.hullId})</option>)}
              <option value="__new">+ new fit…</option>
            </select>
          </label>
          <label title="Variations are full copies forked from the one you're viewing — name is REQUIRED; in-game saves (W2) are named “fit - variation”.">
            <span>Variation</span>
            <select value={variation?.id ?? ''} onChange={(e) => { disarmBrowser(); setActiveVarId(e.target.value); }}>
              {fit.variations.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          <input type="text" value={newVarName} placeholder="new variation name…" style={{ width: 150 }}
            onChange={(e) => setNewVarName(e.target.value)} />
          <button className="btn" disabled={newVarName.trim().length === 0 || !variation}
            title="Fork the CURRENT variation under the new name"
            onClick={() => {
              if (!variation) return;
              disarmBrowser();
              const forked = cloneVariation(variation, newVarName.trim());
              updateFit({ ...fit, variations: [...fit.variations, forked] });
              setActiveVarId(forked.id);
              setNewVarName('');
            }}>
            + fork variation
          </button>
          <button className="btn" title="Delete the current variation (a fit keeps at least one)"
            disabled={!variation || fit.variations.length <= 1}
            onClick={() => {
              if (!variation) return;
              disarmBrowser();
              const rest = fit.variations.filter((v) => v.id !== variation.id);
              updateFit({ ...fit, variations: rest });
              setActiveVarId(rest[0]?.id ?? null);
            }}>
            🗑 variation
          </button>
          <button className="btn" title="Rename this fit (in-game saves use “fit - variation”)."
            onClick={() => {
              const next = window.prompt('Fit name', fit.name);
              if (next && next.trim()) updateFit({ ...fit, name: next.trim() });
            }}>✎ fit</button>
          <button className="btn" title="Rename the current variation." disabled={!variation}
            onClick={() => {
              if (!variation) return;
              const next = window.prompt('Variation name', variation.name);
              if (next && next.trim()) {
                updateFit({ ...fit, variations: fit.variations.map((v) => (v.id === variation.id ? { ...v, name: next.trim() } : v)) });
              }
            }}>✎ variation</button>
          <button className="btn" title="Ship info: the hull's trait bonuses, like the in-game info window."
            onClick={() => setShowInfo(true)}>ⓘ ship info</button>
          <button className="btn" title="Swap this fit's hull — the ship tree opens; modules that don't fit the new layout move to cargo, visibly."
            onClick={() => { disarmBrowser(); setHullQuery(''); setRehulling(true); }}>
            ⟳ change hull
          </button>
          <button className="btn" title="Reset the CURRENT variation: empties every slot (charges and locks included). Drones and cargo stay."
            disabled={!variation}
            onClick={() => updateVariation((v) => {
              for (const r of ['high', 'med', 'low', 'rig', 'sub'] as const) {
                v[r] = v[r].map(() => ({ typeId: null }));
              }
              return v;
            })}>
            ✕ clear modules
          </button>
          <button className="btn" title="Delete the whole fit and all its variations"
            onClick={() => {
              disarmBrowser();
              const rest = fits.filter((f) => f.id !== fit.id);
              setFits(rest);
              setActiveFitId(rest[0]?.id ?? null);
              setActiveVarId(rest[0]?.variations[0]?.id ?? null);
              if (rest.length === 0) setCreating(true);
            }}>
            🗑 fit
          </button>
        </div>

        {layoutNote.length > 0 && (
          <div className="hint">
            ⚠ This hull's slot layout changed since the fit was saved (EVE balance patch) —
            moved to cargo: {layoutNote.join(', ')}.{' '}
            <button className="btn mini" onClick={() => setLayoutNote([])}>ok</button>
          </div>
        )}
        {variation && (
          <ScaledWheel size={wheelBox}>
            <div className="wiz-wheel" style={{ width: wheelBox, height: wheelBox }}
              onDragOver={(e) => {
                if ((e.target as HTMLElement).closest('.wiz-socket')) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = 'copy';
              }}
              onDrop={(e) => {
                // drop on the SHIP (not a socket): a charge loads EVERY fitted
                // module that accepts it (the in-game drag-to-hull gesture);
                // a module auto-fits into its first free slot
                if ((e.target as HTMLElement).closest('.wiz-socket')) return;
                e.preventDefault();
                const id = Number(e.dataTransfer.getData('text/etc-type-id'));
                if (!id || !data || !variation) return;
                if (data.types[id]?.categoryID === 8) {
                  const takers = CHARGE_RACKS.reduce((s, r) =>
                    s + variation[r].filter((sl) => sl.typeId !== null && canLoadW(sl.typeId as number, id)).length, 0);
                  if (takers === 0) {
                    setPlaceNote(`Nothing fitted can load ${getType(id)?.name ?? 'that charge'}.`);
                    return;
                  }
                  updateVariation((v) => {
                    for (const r of CHARGE_RACKS) {
                      for (const sl of v[r]) if (sl.typeId !== null && canLoadW(sl.typeId, id)) sl.chargeTypeId = id;
                    }
                    return v;
                  });
                  setPlaceNote(`${getType(id)?.name ?? 'Charge'} loaded into ${takers} module${takers === 1 ? '' : 's'}.`);
                } else {
                  autoPlace(id);
                }
              }}>
              <div className="wiz-ring" style={{
                left: wheelCenter - wheelR, top: wheelCenter - wheelR,
                width: wheelR * 2, height: wheelR * 2,
              }} />
              <img className="wiz-hull" src={`https://images.evetech.net/types/${fit.hullId}/render?size=256`} alt=""
                title={`${getType(fit.hullId)?.name ?? fit.hullId} — ${fitVariationName(fit, variation)}`} draggable={false}
                style={{ width: Math.min(256, wheelR * 1.1), height: Math.min(256, wheelR * 1.1) }} />
              {(['high', 'med', 'low', 'rig'] as const).map((rack) =>
                socketAngles(sizes[rack], RACK_CENTER[rack]).map((angle, i) =>
                  socket(rack, i, variation[rack][i] ?? { typeId: null }, angle),
                ),
              )}
            </div>
          </ScaledWheel>
        )}
        {slotToolbar()}
        {placeNote && <div className="hint" style={{ textAlign: 'center', color: '#ffb46b' }}>{placeNote}</div>}
        {variation && sizes.sub > 0 && (
          // subsystems are T3-only and change the hull's own layout — they
          // stay a labelled row rather than joining the slot wheel
          <div className="wiz-sub-row">
            <span className="dim" style={{ alignSelf: 'center', fontSize: 12 }}>Subsystems:</span>
            {Array.from({ length: sizes.sub }, (_, i) => (
              <span className="wiz-sub-slot" key={`sub${i}`}>
                {socket('sub', i, variation.sub[i] ?? { typeId: null }, 90)}
              </span>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          <button className="btn" title="Copy this variation as EFT — paste into EVE's fitting window (≡ → Import from Clipboard) to simulate it in-game."
            onClick={() => copy('eft', eft)}>{copied === 'eft' ? '✓ copied' : '⧉ copy EFT'}</button>
          <button className="btn" title="Copy the FULL shopping list (hull, modules, charges, drones, cargo spares) in EVE multibuy format — Market → Multibuy → paste."
            onClick={() => variation && copy('buy', buyList(fit, variation))}>{copied === 'buy' ? '✓ copied' : '⧉ copy buy list'}</button>
          <button className="btn" title="Analyze this variation in the Fit Skill Maxer (skills required/boosting, per-character plans)."
            onClick={() => setCompare({ mode: 'fit', fitText: eft })}>→ skill maxer</button>
          {(() => {
            if (!variation) return null;
            const target = saveCharId ?? chars[0]?.characterId ?? allCharacters[0]?.characterId ?? null;
            const canWrite = target !== null && tokenHasScope(target, FITTINGS_WRITE_SCOPE);
            const built = toEsiFitting(fit, variation);
            const empty = built.payload.items.length === 0;
            return (
              <>
                <select value={target ?? ''} title="Which character's in-game fitting manager to save into"
                  onChange={(e) => { setSaveCharId(Number(e.target.value)); setSaveState({ kind: 'idle' }); }}>
                  {allCharacters.map((c) => (
                    <option key={c.characterId} value={c.characterId}>{c.characterName}</option>
                  ))}
                </select>
                {canWrite ? (
                  <button className="btn" disabled={saveState.kind === 'saving' || target === null || empty}
                    title={empty
                      ? 'Fit something first — EVE rejects an empty fitting.'
                      : `Saves into ${allCharacters.find((c) => c.characterId === target)?.characterName ?? 'the character'}'s in-game fitting manager as “${built.payload.name}”.${built.nameTruncated ? `\n\n⚠ EVE caps fitting names at ${ESI_FIT_NAME_MAX} characters — the name will be TRUNCATED to the text above.` : ''}${built.skipped.length > 0 ? `\n\n⚠ Not saved in-game (EVE's own limits): ${built.skipped.join(', ')}` : ''}`}
                    onClick={() => {
                      if (target === null) return;
                      setSaveState({ kind: 'saving' });
                      saveFitting(target, built.payload)
                        .then(() => setSaveState({
                          kind: 'ok',
                          msg: `saved as “${built.payload.name}”${built.nameTruncated ? ' (name truncated to 50 chars)' : ''}${built.skipped.length > 0 ? ` · NOT saved: ${built.skipped.join(', ')}` : ''}`,
                        }))
                        .catch((e: unknown) => setSaveState({ kind: 'error', msg: e instanceof Error ? e.message : String(e) }));
                    }}>
                    {saveState.kind === 'saving' ? 'saving…' : '💾 save to character'}
                  </button>
                ) : (
                  <button className="btn" disabled={relogging || target === null}
                    title="Saving fits in-game needs the esi-fittings WRITE scope. Tokens only carry scopes granted AT LOGIN, so this character (logged in before v0.56) must log in once more — your browser opens; nothing else changes."
                    onClick={() => {
                      if (target === null) return;
                      setRelogging(true);
                      setSaveState({ kind: 'idle' });
                      import('../lib/auth')
                        .then((m) => m.ssoLogin())
                        .then((id) => syncCharacter(id))
                        .then(() => setSaveState({ kind: 'ok', msg: 're-login complete — the save button is active now' }))
                        .catch((e: unknown) => setSaveState({ kind: 'error', msg: e instanceof Error ? e.message : String(e) }))
                        .finally(() => setRelogging(false));
                    }}>
                    {relogging ? 'waiting for EVE login…' : '🔑 re-login to enable saving'}
                  </button>
                )}
              </>
            );
          })()}
        </div>

        {saveState.kind !== 'idle' && saveState.msg && (
          <div className={saveState.kind === 'error' ? 'form-error' : 'hint'} style={{ marginTop: 6 }}>
            {saveState.kind === 'ok' ? '✓ ' : '⚠ '}{saveState.msg}
          </div>
        )}
      </div>

      {/* right: live stats */}
      <div className="wiz-stats wiz-pane">
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 2 }}>
          <InfoDot id="wizard.stats" />
        </div>
        {parsed && parsed.shipId !== null ? (
          chars.length > 0 ? (
            <FitStatsPanel benchedDrones={benchedDrones} fit={parsed} chars={chars} podOverride={fit?.implants}
              onStats={(m) => setLiveStats((prev) =>
                // the panel invalidates with {} while the engine recomputes;
                // filtering against NOTHING for that window recommended
                // modules that never fit (v0.177) — hold the LAST-KNOWN
                // numbers instead: one module's delta stale beats Infinity
                (Object.keys(m).length === 0 && Object.keys(prev).length > 0 ? prev : m))}
              esfFit={esfFit} />
          ) : (
            <div className="hint">Pick one or two characters on the far left to see live CPU/PG/cap for this fit with THEIR skills.</div>
          )
        ) : (
          <div className="hint">Fit something to see live stats.</div>
        )}
        {parsed && parsed.unresolved.length > 0 && (
          <div className="flag warn" title={parsed.unresolved.join('\n')}>⚠ {parsed.unresolved.length} item(s) failed round-trip — stats exclude them</div>
        )}
        {/* the pod lives UNDER the stats — an open pod list must never bury
            the numbers a fitter watches constantly (v0.193 had it above) */}
        {fit && <PodPicker fit={fit} onFit={updateFit} chars={chars} data={data} />}
      </div>
    </div>
  );
}
