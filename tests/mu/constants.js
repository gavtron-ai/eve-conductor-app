"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HISTORY_TTL_MS = exports.PRICE_TTL_MS = exports.DEFAULT_CLIENT_ID = exports.ESI_BASE = exports.FUZZWORK_AGGREGATES = exports.DEFAULT_SETTINGS = exports.BUILTIN_HUBS = void 0;
/**
 * The five major trade hubs, priced at their main market station
 * (station scope matches what premium market tools display).
 */
exports.BUILTIN_HUBS = [
    { id: 'jita', name: 'Jita', kind: 'station', locationId: 60003760, regionId: 10000002, builtin: true },
    { id: 'amarr', name: 'Amarr', kind: 'station', locationId: 60008494, regionId: 10000043, builtin: true },
    { id: 'dodixie', name: 'Dodixie', kind: 'station', locationId: 60011866, regionId: 10000032, builtin: true },
    { id: 'rens', name: 'Rens', kind: 'station', locationId: 60004588, regionId: 10000030, builtin: true },
    { id: 'hek', name: 'Hek', kind: 'station', locationId: 60005686, regionId: 10000042, builtin: true },
];
/** CCP balance-patchable base rates — user-overridable in Settings (RULES.md #6). */
exports.DEFAULT_SETTINGS = {
    accountingLevel: 5,
    brokerRelationsLevel: 5,
    factionStanding: 0,
    corpStanding: 0,
    useCustomBrokerRate: false,
    customBrokerRate: 0.01,
    salesTaxBase: 0.075,
    brokerFeeBase: 0.03,
    alwaysOnTop: false,
    closeToTray: true,
    // per-player; blank by default so a fresh install never inherits
    // somebody else's ship name or corporation map (see types.ts)
    transitShipName: '',
    apertureUrl: '',
};
exports.FUZZWORK_AGGREGATES = 'https://market.fuzzwork.co.uk/aggregates/';
exports.ESI_BASE = 'https://esi.evetech.net/latest';
/**
 * The registered "Eve Trade Conductor" EVE application (developers.eveonline.com).
 * Client IDs are public identifiers (PKCE flow, no secret). Overridable in
 * Settings → EVE login → advanced.
 */
// Trade Conductor's OWN application (2026-07-24) — callback :53138/callback;
// nothing shared with Fleet Conductor (which kept the old app + :53137)
/**
 * The EVE application logins go through. ALWAYS EMPTY IN THE CODE.
 *
 * There is ONE build of this app and it belongs to nobody: it carries no
 * registration, no ship name, no corporation. Per-player setup lives in a
 * config file outside the app (see appConfig.ts) and is loaded at startup.
 * Nothing personal is ever compiled in, so there is no such thing as a
 * "personal build" that could be handed out by mistake.
 */
exports.DEFAULT_CLIENT_ID = '';
/** Fuzzwork refreshes ~every 30 min; don't refetch the same scope more often than this. */
exports.PRICE_TTL_MS = 10 * 60 * 1000;
exports.HISTORY_TTL_MS = 60 * 60 * 1000;
