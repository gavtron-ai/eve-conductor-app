import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BUILTIN_HUBS, DEFAULT_SETTINGS } from './constants';
import type { Hub, Settings } from './types';

export interface ItemGroup {
  id: string;
  name: string;
  typeIds: number[];
}

export interface FinderSettings {
  sourceHubId: string;
  /** hub id or 'all' for every other hub */
  destHubId: string;
  universe: 'all' | 'watchlist';
  minMarginPct: number;
  cargoM3: number;
  budgetISK: number | null;
  /** max days for the destination to absorb one load; 0 = no limit */
  maxDaysToSell: number;
  /** 'deep' scans every candidate (day-cached); 'fast' spot-checks the top 100 */
  scanDepth: 'deep' | 'fast';
  /** acquisition: buy instantly from sell orders, or place your own buy order */
  buyMode: 'instant' | 'order';
  /** exit: place a sell order, dump into buy orders, or whichever is better */
  sellMode: 'order' | 'instant' | 'best';
  hideUnsustainable: boolean;
  /** 'custom' | 'preset:<typeId>' | 'owned:<assetItemId>' — picking a ship sets cargoM3 */
  shipChoice: string;
}

export interface AutoHaulSettings {
  centerName: string;
  maxJumps: number;
  sourceHubId: string;
  cargoM3: number;
  budgetISK: number | null;
  sellDays: number;
  /** how many single-station haul options to show */
  optionCount: number;
  /** offer player structures as drop-offs (must have docking access) */
  includeStructures: boolean;
}

export const DEFAULT_AUTOHAUL: AutoHaulSettings = {
  centerName: '',
  maxJumps: 4,
  sourceHubId: 'jita',
  cargoM3: 5000,
  budgetISK: null,
  sellDays: 3,
  optionCount: 4,
  includeStructures: false,
};

export const DEFAULT_FINDER: FinderSettings = {
  sourceHubId: 'jita',
  destHubId: 'all',
  universe: 'all',
  minMarginPct: 5,
  cargoM3: 5000,
  budgetISK: null,
  // a load should sell within ~2 days by default — items with no trading history
  // are where troll listings and unrealizable margins live (set 0 to see all)
  maxDaysToSell: 2,
  scanDepth: 'deep',
  buyMode: 'instant',
  sellMode: 'best',
  hideUnsustainable: true,
  shipChoice: 'custom',
};

export interface AlertSettings {
  /** desktop notification when a team order gets outbid */
  outbid: boolean;
  /** desktop notification when a sell order fills */
  sale: boolean;
  /** optional ntfy.sh topic URL — mirrors notifications to the user's phone */
  ntfyUrl: string;
  /**
   * Planetary Industry alerting. Every threshold is configurable because
   * "enough warning" depends entirely on how often someone plays: a daily
   * player wants 24h notice, someone who logs in twice a week wants days.
   */
  pi?: {
    /** master switch for PI alerts */
    enabled: boolean;
    /** warn when storage passes this fraction full */
    fullWarnFrac: number;
    /** warn when storage is projected to fill within this many hours */
    fullWarnHours: number;
    /** warn when an extractor program ends within this many hours */
    expiryWarnHours: number;
    /** call a factory idle after this many hours with no input */
    factoryIdleHours: number;
  };
  /** show urgent PI warnings in the multibox overlay's notice box (v0.179) */
  piOverlay?: boolean;
}

const DEFAULT_ALERTS: AlertSettings = {
  outbid: true, sale: true, ntfyUrl: '',
  pi: { enabled: true, fullWarnFrac: 0.85, fullWarnHours: 24, expiryWarnHours: 24, factoryIdleHours: 6 },
};

export interface AllocSettings {
  /** 0 = team pool minus reserve */
  budgetISK: number;
  reservePct: number;
  maxItems: number;
  maxSharePct: number;
  /** reprice rounds held PER ORDER on top of the predicted reprices —
   * predictions are means; reserves provision above the mean */
  bufferReprices: number;
  skipHeating: boolean;
  skipOwned: boolean;
}

const DEFAULT_ALLOC: AllocSettings = {
  budgetISK: 0,
  reservePct: 10,
  maxItems: 12,
  maxSharePct: 20,
  bufferReprices: 4,
  skipHeating: true,
  skipOwned: true,
};

/** top-level module of the Conductor suite shown in the main area —
 * background collectors (radar, trends, wallet, net-worth) run REGARDLESS */
export type ModuleId = 'trade' | 'character' | 'battle' | 'theft' | 'pi' | 'aperture';

/** one ship in the fight. `source` is how the fit was CHOSEN, so the roster
 * survives a restart even though the resolved fit does not. */
export interface Combatant {
  id: string;
  /** 'library' = a Fit Propagator entry key; 'wizard' = a wizard fit+variation;
   * 'eft' = pasted text kept verbatim */
  source:
    | { kind: 'library'; key: string }
    | { kind: 'wizard'; fitId: string; variationId: string }
    | { kind: 'eft'; text: string };
  name: string;
  /** which pilot flies it */
  profile: 'character' | 'optimal' | 'minimum';
  /** characterId when profile === 'character' */
  characterId?: number;
  /** propulsion module cycling — the biggest single lever on signature/speed */
  propRunning: boolean;
  /**
   * WHAT THIS SHIP IS DOING. Transversal is a CONSEQUENCE of flying, not an
   * input a player has any way to guess — it falls out of the ship's own speed
   * (which the engine already computes from the fit and skills) and what the
   * pilot has told it to do. Asking for a raw m/s figure made this a
   * calculator for someone who already knew the answer.
   */
  behaviour: 'orbit' | 'keepAtRange' | 'approach' | 'stationary';
  /** heading relative to the line to the other ship, degrees. 0 = straight at
   * it, 90 = across. Supersedes `behaviour`, which is kept only so an existing
   * roster maps onto an angle instead of resetting. */
  angleDeg?: number;
  /** the speed actually being flown, m/s. Undefined = the ship's maximum —
   * which is what the sim assumed for every moving ship, and no pilot does. */
  speed?: number;
  /** the STARTING distance to the opposing side, in METRES (the UI reads km) */
  range: number;
  /**
   * The range this ship is TRYING to reach and hold, metres. A starting
   * position is just where the fight opens — "keep at range 20 km" from a
   * 60 km start means burning in for 40 km first, and the sim flies exactly
   * that: close (or open) until here, then circle. Undefined = hold the
   * starting range (no approach leg).
   */
  holdRange?: number;
  /**
   * WHERE the ship opens, as true placement (v0.93.0 — the sim is positional
   * now). `range` stays the slant (true 3D) distance to the target; azimuth
   * is the angle on the top-down map (degrees, 0 = +x/east, CCW positive,
   * world XY); elevation lifts the ship out of the plane (degrees, −89..89,
   * 0 = the old planar behaviour, bit-for-bit). Assigned once on add so
   * placements stop re-spreading when the roster changes.
   */
  azimuthDeg?: number;
  elevationDeg?: number;
  /** roster id this ship's BEHAVIOUR is anchored on — orbit WHAT. Undefined
   * = the kill target, exactly the old reading. */
  anchorId?: string;
  /** fly N identical copies of this exact fit (default 1) — expanded into
   * independent combatants at sim time */
  count?: number;
  /** TOTAL cap booster charges carried (cargo + loaded); blank = unlimited */
  capBoosterCharges?: number;
  /** INJECT REPPING — fly the tank like a person: hold shield reps to the
   * ~30% band (peak passive regen), never waste a heal cycle or an
   * injection overflow, feed cap sticks to reps only when they run */
  injectRepping?: boolean;
  /** weaponTypeId → chargeTypeId the user picked. A saved fit often carries NO
   * ammo at all, and an unloaded turret scores exactly zero because the damage
   * attributes live on the charge — so choosing one has to be possible here,
   * not only in the Fit Inspector. */
  ammo?: Record<number, number | null>;
  /** per-module run state, keyed by dogmaFit.moduleKey. Switching a shield
   * booster off and re-scoring is how you find out what it was worth. */
  moduleStates?: Record<string, 'Passive' | 'Online' | 'Active' | 'Overload'>;
  /** per-SLOT charge. Supersedes `ammo`, which was keyed by module TYPE and so
   * forced every copy of a module to carry the same script. */
  moduleCharges?: Record<string, number | null>;
  /** swap the module in a slot for another, or empty it — "what if this were
   * a plate" without leaving the sim */
  moduleSwaps?: Record<string, number | null>;
  /** implants to fly with, overriding the pilot profile's own. Set by applying
   * a result from the implant search, so a found pod can actually be TESTED
   * rather than only reported. */
  implants?: number[];
  /** LEGACY, v0.65.0 only: the raw inputs behaviour replaced. Read once so an
   * existing roster keeps its range instead of silently resetting. */
  distance?: number;
  transversal?: number;
}

export interface BattleSimState {
  /** TEAM B's reference ship (v0.94.0: sides are Team A / Team B now, and
   * both hold fleets). This one anchors the world origin and the closed-form
   * check panels; the field keeps its old name so existing configs load. */
  target: Combatant | null;
  /** the REST of Team B — every ship beyond the reference (v0.94.0) */
  defenders?: Combatant[];
  /** TEAM A (name kept for config compatibility) */
  attackers: Combatant[];
  /**
   * KILL ORDER (v0.95.0) — who each team's DAMAGE focuses, in order. The
   * ids are opposing-team ships; the fight shoots the first one still
   * alive, then the next, and falls back to finish-what-is-nearest-death
   * for anything unlisted. Healing stays on whoever needs it (most-damaged
   * ally) and offensive EWAR follows the kill target — those rules are the
   * sim's own and match how fleets are actually flown.
   */
  focusA?: string[];
  focusB?: string[];
  /** fallback orbit radius for drones that carry none — the SDE default of
   * attr 416 entityFlyRange (real drones publish their own radius, which
   * always wins; 154 proximityRange was wrongly read as this through v0.92) */
  droneOrbit: number;
  /** amortise reloading into the numbers */
  sustained: boolean;
}

export const DEFAULT_BATTLE_SIM: BattleSimState = {
  target: null,
  defenders: [],
  attackers: [],
  droneOrbit: 500,
  sustained: true,
};

interface AppState {
  activeModule: ModuleId;
  settings: Settings;
  customHubs: Hub[];
  watchlist: number[]; // type ids
  selectedTypeId: number | null;
  activeView: 'finder' | 'autohaul' | 'orders' | 'trends' | 'radar' | 'dashboard' | 'explorer' | 'groups';
  finder: FinderSettings;
  autoHaul: AutoHaulSettings;
  /** items hidden from trade searches & auto hauls (still visible in search/explorer) */
  ignoredTypeIds: number[];
  /** items excluded from the dashboard books (PLEX-for-ISK, personal ships, …) */
  excludedFromBooks: number[];
  /** items the user flips at ONE hub — bought where they'll be sold; their
   * stock never joins the haul pipeline (⚑ toggle, explicit only) */
  stationTradeIds: number[];
  /** user-built item groups for the side-by-side comparer (Groups tab) */
  itemGroups: ItemGroup[];
  /** systems imported from the corp's Aperture map (Theft Conductor scope) */
  theftMapSystems: number[];
  /** Theft Conductor: list targets at ANY distance (wormhole residents have
   * no meaningful gate distance to k-space) */
  theftIgnoreRadius: boolean;
  /** when the current theft map was imported — staleness must be VISIBLE
   * (a map list quietly carried over from a backup looks like a bug) */
  theftMapImportedAt: number | null;
  /** Theft Conductor: watch the OS clipboard and auto-import an Aperture
   * system list the instant it is copied (his click path ended in a manual
   * "paste" button — this removes that last step) */
  theftAutoImport: boolean;
  /** Theft Conductor: show only windows that are open RIGHT NOW (also scopes
   * the overlay raid-alert box) */
  theftOpenNow: boolean;
  /** Character Conductor comparison state — persisted so the chosen fit
   * survives switching modules. fitText holds the EFT of the SELECTED fit
   * (fed to the shared parse pipeline); fitChar/fitSource are the picker
   * filters ('all' or a characterId / 'saved' | 'owned'). Pre-v51 stores
   * lack the filter keys — readers default them with ?? 'all'. */
  charCompare: { mode: 'match' | 'topic' | 'fit' | 'wizard' | 'propagator' | 'battle'; topicId: string; custom: string; fitText: string; fitChar?: string; fitSource?: string };
  /** Battle Sim roster. Stores only what the user CHOSE — a fit source and a
   * pilot profile per combatant. Never derived stats: FitStats carries a Map
   * and a Set, and JSON.stringify flattens both to {}, so a persisted copy
   * would come back silently empty. */
  battleSim: BattleSimState;
  /** Fit Wizard fits — app-side, so a fit can carry unlimited spare/variant
   * modules (the in-game fitting service can't) */
  wizardFits: import('./wizardFits').WizardFit[];
  alerts: AlertSettings;
  alloc: AllocSettings;

  setModule: (m: ModuleId) => void;
  setSettings: (patch: Partial<Settings>) => void;
  setAlerts: (patch: Partial<AlertSettings>) => void;
  setAlloc: (patch: Partial<AllocSettings>) => void;
  toggleIgnore: (typeId: number) => void;
  clearIgnored: () => void;
  toggleExcludeBooks: (typeId: number) => void;
  clearExcludedBooks: () => void;
  toggleStationTrade: (typeId: number) => void;
  clearStationTrades: () => void;
  /** create if name is new, then add the ids (deduped); returns the group id */
  setTheftMapSystems: (ids: number[]) => void;
  setTheftIgnoreRadius: (on: boolean) => void;
  setTheftAutoImport: (on: boolean) => void;
  setTheftOpenNow: (on: boolean) => void;
  setCharCompare: (patch: Partial<AppState['charCompare']>) => void;
  setBattleSim: (patch: Partial<BattleSimState>) => void;
  setWizardFits: (fits: import('./wizardFits').WizardFit[]) => void;
  addToGroup: (name: string, typeIds: number[]) => string;
  removeFromGroup: (groupId: string, typeId: number) => void;
  deleteGroup: (groupId: string) => void;
  addCustomHub: (hub: Hub) => void;
  removeCustomHub: (id: string) => void;
  toggleWatch: (typeId: number) => void;
  select: (typeId: number | null) => void;
  setView: (view: 'finder' | 'autohaul' | 'orders' | 'trends' | 'radar' | 'dashboard' | 'explorer' | 'groups') => void;
  setFinder: (patch: Partial<FinderSettings>) => void;
  setAutoHaul: (patch: Partial<AutoHaulSettings>) => void;
}

export const useApp = create<AppState>()(
  persist(
    (set) => ({
      activeModule: 'trade' as ModuleId,
      settings: DEFAULT_SETTINGS,
      customHubs: [],
      watchlist: [44992, 34], // PLEX + Tritanium as friendly defaults
      selectedTypeId: 44992,
      activeView: 'finder',
      finder: DEFAULT_FINDER,
      autoHaul: DEFAULT_AUTOHAUL,
      ignoredTypeIds: [],
      excludedFromBooks: [],
      stationTradeIds: [],
      itemGroups: [],
      theftMapSystems: [],
      theftIgnoreRadius: false,
      theftMapImportedAt: null,
      theftAutoImport: false,
      theftOpenNow: false,
      charCompare: { mode: 'match' as const, topicId: 'mining', custom: '', fitText: '' },
      battleSim: DEFAULT_BATTLE_SIM,
      wizardFits: [],
      alerts: DEFAULT_ALERTS,
      alloc: DEFAULT_ALLOC,

      setModule: (activeModule) => set({ activeModule }),
      setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
      setAlerts: (patch) => set((s) => ({ alerts: { ...s.alerts, ...patch } })),
      setAlloc: (patch) => set((s) => ({ alloc: { ...s.alloc, ...patch } })),
      toggleIgnore: (typeId) =>
        set((s) => ({
          ignoredTypeIds: s.ignoredTypeIds.includes(typeId)
            ? s.ignoredTypeIds.filter((t) => t !== typeId)
            : [...s.ignoredTypeIds, typeId],
        })),
      clearIgnored: () => set({ ignoredTypeIds: [] }),
      toggleExcludeBooks: (typeId) =>
        set((s) => ({
          excludedFromBooks: s.excludedFromBooks.includes(typeId)
            ? s.excludedFromBooks.filter((t) => t !== typeId)
            : [...s.excludedFromBooks, typeId],
        })),
      clearExcludedBooks: () => set({ excludedFromBooks: [] }),
      toggleStationTrade: (typeId) =>
        set((s) => ({
          stationTradeIds: s.stationTradeIds.includes(typeId)
            ? s.stationTradeIds.filter((t) => t !== typeId)
            : [...s.stationTradeIds, typeId],
        })),
      clearStationTrades: () => set({ stationTradeIds: [] }),
      setTheftMapSystems: (theftMapSystems) =>
        set({ theftMapSystems, theftMapImportedAt: theftMapSystems.length > 0 ? Date.now() : null }),
      setTheftAutoImport: (theftAutoImport) => set({ theftAutoImport }),
      setTheftOpenNow: (theftOpenNow) => set({ theftOpenNow }),
      setTheftIgnoreRadius: (theftIgnoreRadius) => set({ theftIgnoreRadius }),
      setCharCompare: (patch) => set((s) => ({ charCompare: { ...s.charCompare, ...patch } })),
      setBattleSim: (patch) => set((s) => ({ battleSim: { ...s.battleSim, ...patch } })),
      setWizardFits: (wizardFits) => set({ wizardFits }),
      addToGroup: (name, typeIds) => {
        const trimmed = name.trim();
        let id = '';
        set((s) => {
          const existing = s.itemGroups.find((g) => g.name.toLowerCase() === trimmed.toLowerCase());
          if (existing) {
            id = existing.id;
            return {
              itemGroups: s.itemGroups.map((g) =>
                g.id === existing.id
                  ? { ...g, typeIds: [...new Set([...g.typeIds, ...typeIds])] }
                  : g,
              ),
            };
          }
          id = `g${Date.now().toString(36)}`;
          return { itemGroups: [...s.itemGroups, { id, name: trimmed, typeIds: [...new Set(typeIds)] }] };
        });
        return id;
      },
      removeFromGroup: (groupId, typeId) =>
        set((s) => ({
          itemGroups: s.itemGroups.map((g) =>
            g.id === groupId ? { ...g, typeIds: g.typeIds.filter((t) => t !== typeId) } : g,
          ),
        })),
      deleteGroup: (groupId) =>
        set((s) => ({ itemGroups: s.itemGroups.filter((g) => g.id !== groupId) })),
      setView: (view) => set({ activeView: view }),
      setFinder: (patch) => set((s) => ({ finder: { ...s.finder, ...patch } })),
      setAutoHaul: (patch) => set((s) => ({ autoHaul: { ...s.autoHaul, ...patch } })),
      addCustomHub: (hub) =>
        set((s) =>
          s.customHubs.some((h) => h.id === hub.id) ? s : { customHubs: [...s.customHubs, hub] },
        ),
      removeCustomHub: (id) =>
        set((s) => ({ customHubs: s.customHubs.filter((h) => h.id !== id) })),
      toggleWatch: (typeId) =>
        set((s) => ({
          watchlist: s.watchlist.includes(typeId)
            ? s.watchlist.filter((t) => t !== typeId)
            : [...s.watchlist, typeId],
        })),
      select: (typeId) => set({ selectedTypeId: typeId }),
    }),
    {
      name: 'eve-trade-conductor',
      // never persist builtin hubs — they come from constants so updates apply
      partialize: (s) => ({
        activeModule: s.activeModule,
        settings: s.settings,
        customHubs: s.customHubs,
        watchlist: s.watchlist,
        selectedTypeId: s.selectedTypeId,
        activeView: s.activeView,
        finder: s.finder,
        autoHaul: s.autoHaul,
        ignoredTypeIds: s.ignoredTypeIds,
        excludedFromBooks: s.excludedFromBooks,
        stationTradeIds: s.stationTradeIds,
        itemGroups: s.itemGroups,
        theftMapSystems: s.theftMapSystems,
        theftIgnoreRadius: s.theftIgnoreRadius,
        theftAutoImport: s.theftAutoImport,
        theftOpenNow: s.theftOpenNow,
        theftMapImportedAt: s.theftMapImportedAt,
        charCompare: s.charCompare,
        wizardFits: s.wizardFits,
        alerts: s.alerts,
        alloc: s.alloc,
        // partialize is an ALLOWLIST — a slice missing from it is silently
        // never persisted, which looks exactly like a broken feature
        battleSim: s.battleSim,
      }),
      /**
       * SCHEMA VERSION 1 (v0.60.34) — declared so future changes have a
       * migrate hook. It CANNOT do this particular job, which is worth
       * recording: zustand only calls `migrate` when the stored blob carries
       * a NUMERIC version (middleware.js: `typeof value.version === "number"`),
       * and saves written before this version have no version key at all —
       * so migrate never fires for exactly the saves that need it.
       */
      version: 1,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<AppState>;
        const saved = (p.settings ?? {}) as Partial<Settings>;

        // NOTHING IS SEEDED HERE ANY MORE. Per-player setup (EVE application,
        // transit ship, corporation map) lives in a config file outside the
        // app and is loaded at startup by appConfig.ts — so there is nothing
        // compiled in to seed FROM, and no way for one person's values to
        // reach another person's install.
        const settings = { ...DEFAULT_SETTINGS, ...saved };

        // deep-merge nested settings so new fields keep their defaults for old saves
        return {
          ...current,
          ...p,
          settings,
          finder: { ...DEFAULT_FINDER, ...(p.finder ?? {}) },
          autoHaul: { ...DEFAULT_AUTOHAUL, ...(p.autoHaul ?? {}) },
          alerts: { ...DEFAULT_ALERTS, ...(p.alerts ?? {}) },
          alloc: { ...DEFAULT_ALLOC, ...(p.alloc ?? {}) },
          // every save written before this version has NO battleSim key, and
          // `migrate` provably never fires for those (see the version note
          // above) — so the default has to be merged in here
          battleSim: { ...DEFAULT_BATTLE_SIM, ...(p.battleSim ?? {}) },
        };
      },
    },
  ),
);

/** builtin hubs + user's custom hubs, in display order */
export function useHubs(): Hub[] {
  const custom = useApp((s) => s.customHubs);
  return [...BUILTIN_HUBS, ...custom];
}
