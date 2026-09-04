"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.useApp = exports.DEFAULT_FINDER = exports.DEFAULT_AUTOHAUL = void 0;
exports.useHubs = useHubs;
const zustand_1 = require("zustand");
const middleware_1 = require("zustand/middleware");
const constants_1 = require("./constants");
exports.DEFAULT_AUTOHAUL = {
    centerName: '',
    maxJumps: 4,
    sourceHubId: 'jita',
    cargoM3: 5000,
    budgetISK: null,
    sellDays: 3,
    optionCount: 4,
    includeStructures: false,
};
exports.DEFAULT_FINDER = {
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
const DEFAULT_ALERTS = { outbid: true, sale: true, ntfyUrl: '' };
const DEFAULT_ALLOC = {
    budgetISK: 0,
    reservePct: 10,
    maxItems: 12,
    maxSharePct: 20,
    bufferReprices: 4,
    skipHeating: true,
    skipOwned: true,
};
exports.useApp = (0, zustand_1.create)()((0, middleware_1.persist)((set) => ({
    activeModule: 'trade',
    settings: constants_1.DEFAULT_SETTINGS,
    customHubs: [],
    watchlist: [44992, 34], // PLEX + Tritanium as friendly defaults
    selectedTypeId: 44992,
    activeView: 'finder',
    finder: exports.DEFAULT_FINDER,
    autoHaul: exports.DEFAULT_AUTOHAUL,
    ignoredTypeIds: [],
    excludedFromBooks: [],
    stationTradeIds: [],
    itemGroups: [],
    theftMapSystems: [],
    theftIgnoreRadius: false,
    theftMapImportedAt: null,
    charCompare: { mode: 'match', topicId: 'mining', custom: '', fitText: '' },
    wizardFits: [],
    alerts: DEFAULT_ALERTS,
    alloc: DEFAULT_ALLOC,
    setModule: (activeModule) => set({ activeModule }),
    setSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
    setAlerts: (patch) => set((s) => ({ alerts: { ...s.alerts, ...patch } })),
    setAlloc: (patch) => set((s) => ({ alloc: { ...s.alloc, ...patch } })),
    toggleIgnore: (typeId) => set((s) => ({
        ignoredTypeIds: s.ignoredTypeIds.includes(typeId)
            ? s.ignoredTypeIds.filter((t) => t !== typeId)
            : [...s.ignoredTypeIds, typeId],
    })),
    clearIgnored: () => set({ ignoredTypeIds: [] }),
    toggleExcludeBooks: (typeId) => set((s) => ({
        excludedFromBooks: s.excludedFromBooks.includes(typeId)
            ? s.excludedFromBooks.filter((t) => t !== typeId)
            : [...s.excludedFromBooks, typeId],
    })),
    clearExcludedBooks: () => set({ excludedFromBooks: [] }),
    toggleStationTrade: (typeId) => set((s) => ({
        stationTradeIds: s.stationTradeIds.includes(typeId)
            ? s.stationTradeIds.filter((t) => t !== typeId)
            : [...s.stationTradeIds, typeId],
    })),
    clearStationTrades: () => set({ stationTradeIds: [] }),
    setTheftMapSystems: (theftMapSystems) => set({ theftMapSystems, theftMapImportedAt: theftMapSystems.length > 0 ? Date.now() : null }),
    setTheftIgnoreRadius: (theftIgnoreRadius) => set({ theftIgnoreRadius }),
    setCharCompare: (patch) => set((s) => ({ charCompare: { ...s.charCompare, ...patch } })),
    setWizardFits: (wizardFits) => set({ wizardFits }),
    addToGroup: (name, typeIds) => {
        const trimmed = name.trim();
        let id = '';
        set((s) => {
            const existing = s.itemGroups.find((g) => g.name.toLowerCase() === trimmed.toLowerCase());
            if (existing) {
                id = existing.id;
                return {
                    itemGroups: s.itemGroups.map((g) => g.id === existing.id
                        ? { ...g, typeIds: [...new Set([...g.typeIds, ...typeIds])] }
                        : g),
                };
            }
            id = `g${Date.now().toString(36)}`;
            return { itemGroups: [...s.itemGroups, { id, name: trimmed, typeIds: [...new Set(typeIds)] }] };
        });
        return id;
    },
    removeFromGroup: (groupId, typeId) => set((s) => ({
        itemGroups: s.itemGroups.map((g) => g.id === groupId ? { ...g, typeIds: g.typeIds.filter((t) => t !== typeId) } : g),
    })),
    deleteGroup: (groupId) => set((s) => ({ itemGroups: s.itemGroups.filter((g) => g.id !== groupId) })),
    setView: (view) => set({ activeView: view }),
    setFinder: (patch) => set((s) => ({ finder: { ...s.finder, ...patch } })),
    setAutoHaul: (patch) => set((s) => ({ autoHaul: { ...s.autoHaul, ...patch } })),
    addCustomHub: (hub) => set((s) => s.customHubs.some((h) => h.id === hub.id) ? s : { customHubs: [...s.customHubs, hub] }),
    removeCustomHub: (id) => set((s) => ({ customHubs: s.customHubs.filter((h) => h.id !== id) })),
    toggleWatch: (typeId) => set((s) => ({
        watchlist: s.watchlist.includes(typeId)
            ? s.watchlist.filter((t) => t !== typeId)
            : [...s.watchlist, typeId],
    })),
    select: (typeId) => set({ selectedTypeId: typeId }),
}), {
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
        theftMapImportedAt: s.theftMapImportedAt,
        charCompare: s.charCompare,
        wizardFits: s.wizardFits,
        alerts: s.alerts,
        alloc: s.alloc,
    }),
    merge: (persisted, current) => {
        const p = (persisted ?? {});
        // deep-merge nested settings so new fields keep their defaults for old saves
        return {
            ...current,
            ...p,
            finder: { ...exports.DEFAULT_FINDER, ...(p.finder ?? {}) },
            autoHaul: { ...exports.DEFAULT_AUTOHAUL, ...(p.autoHaul ?? {}) },
            alerts: { ...DEFAULT_ALERTS, ...(p.alerts ?? {}) },
            alloc: { ...DEFAULT_ALLOC, ...(p.alloc ?? {}) },
        };
    },
}));
/** builtin hubs + user's custom hubs, in display order */
function useHubs() {
    const custom = (0, exports.useApp)((s) => s.customHubs);
    return [...constants_1.BUILTIN_HUBS, ...custom];
}
