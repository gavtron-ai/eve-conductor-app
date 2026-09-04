"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FITTINGS_READ_SCOPE = exports.FITTINGS_WRITE_SCOPE = exports.SKILL_IDS = void 0;
exports.lastEsiExpiryMs = lastEsiExpiryMs;
exports.esiAuth = esiAuth;
exports.syncSkills = syncSkills;
exports.syncStandings = syncStandings;
exports.syncWalletAndImplants = syncWalletAndImplants;
exports.syncShips = syncShips;
exports.getLocation = getLocation;
exports.refreshWalletBalance = refreshWalletBalance;
exports.getCurrentShip = getCurrentShip;
exports.getMyOrders = getMyOrders;
exports.lastTeamOrderFailures = lastTeamOrderFailures;
exports.getTeamOrders = getTeamOrders;
exports.getMyOrderHistory = getMyOrderHistory;
exports.getTeamOrderHistory = getTeamOrderHistory;
exports.structureName = structureName;
exports.openMarketWindow = openMarketWindow;
exports.lastOnlineDetail = lastOnlineDetail;
exports.onlineCharIds = onlineCharIds;
exports.openMarketWindowEverywhere = openMarketWindowEverywhere;
exports.setWaypoint = setWaypoint;
exports.tokenHasScope = tokenHasScope;
exports.saveFitting = saveFitting;
exports.listFittings = listFittings;
exports.deleteFitting = deleteFitting;
exports.resyncSkillsAndImplants = resyncSkillsAndImplants;
exports.syncCharacter = syncCharacter;
// Authenticated ESI calls, per character (defaults to the active one).
const constants_1 = require("./constants");
const auth_1 = require("./auth");
const store_1 = require("./store");
const typedb_1 = require("./typedb");
const cargo_1 = require("./cargo");
const dogma_1 = require("./dogma");
const esiRate_1 = require("./esiRate");
exports.SKILL_IDS = {
    accounting: 16622,
    brokerRelations: 3446,
};
// how long until the server will have NEW data for the last esiAuth response —
// computed from its own Expires/Date headers (no client-clock skew)
let lastExpiry = 0;
function lastEsiExpiryMs() {
    return lastExpiry;
}
async function esiAuth(path, init, charId, 
/** `spec`: CCP publishes a per-route token budget (`x-rate-limit` in the
 * OpenAPI spec) — pass it and this call waits its turn and records what it
 * cost. `lane`: which priority lane this request belongs to; the overlay
 * lane is the last thing to be paused when the error budget tightens.
 * See esiRate.ts. */
rate) {
    const lane = rate?.lane ?? 'interactive';
    // a 401 means the server rejected a token we thought was valid (e.g. EVE
    // revoked the session) — force one refresh and retry before giving up
    for (let attempt = 0;; attempt++) {
        const token = await (0, auth_1.ensureToken)(charId, attempt > 0);
        if (rate?.spec)
            await (0, esiRate_1.rateAcquire)(rate.spec, rate.abort);
        // EVERY authenticated call spends from the shared 100-errors-per-60s
        // budget too, and a 420 from that closes the fitting routes as surely as
        // a fitting-group overrun does — so gate and report unconditionally, not
        // just for the routes that carry a published token group.
        await (0, esiRate_1.esiGate)(lane, rate?.abort);
        const res = await fetch(`${constants_1.ESI_BASE}${path}`, {
            ...init,
            headers: {
                Accept: 'application/json',
                ...(init?.headers ?? {}),
                Authorization: `Bearer ${token}`,
            },
        });
        (0, esiRate_1.noteEsiResponse)(res.status, res.headers, lane);
        if (rate?.spec)
            (0, esiRate_1.rateObserve)(rate.spec, res.status, res.headers);
        // the server explicitly asked us to slow down or stop — surface it as
        // itself rather than as a generic failure, and never hammer past it
        if (res.status === 429 || res.status === 420) {
            throw new Error(res.status === 420
                ? 'ESI error limit reached (420) — everything is paused until the window resets.'
                : 'EVE rate limited this request (429) — the tool will wait and continue.');
        }
        if (res.status === 401 && attempt === 0)
            continue;
        if (res.status === 401) {
            throw new Error('EVE rejected the session (expired or revoked) — log this character out and back in (Settings → EVE login).');
        }
        if (res.status === 403) {
            throw new Error('Scope not granted on this login — log this character out and back in (Settings → EVE login).');
        }
        if (!res.ok)
            throw new Error(`ESI ${res.status} on ${path}`);
        const exp = Date.parse(res.headers.get('expires') ?? '');
        const srv = Date.parse(res.headers.get('date') ?? '');
        // seconds until ESI will serve anything new. Measured against the
        // SERVER's clock, so a skewed local clock cannot distort it.
        const expiresIn = !Number.isNaN(exp) && !Number.isNaN(srv) ? Math.max(0, Math.round((exp - srv) / 1000)) : null;
        if (!Number.isNaN(exp) && !Number.isNaN(srv))
            lastExpiry = Math.max(0, exp - srv);
        if (res.status === 204)
            return { data: undefined, pages: 1, expiresIn };
        return { data: await res.json(), pages: Number(res.headers.get('x-pages') ?? '1'), expiresIn };
    }
}
/** Pull the full skill map. The ACTIVE character's skills drive the fee settings. */
async function syncSkills(characterId) {
    const { data } = await esiAuth(`/characters/${characterId}/skills/`, undefined, characterId);
    const skills = {};
    for (const s of data.skills)
        skills[s.skill_id] = s.active_skill_level;
    auth_1.useAuth.getState().setCharacterData(characterId, { skills });
    if (auth_1.useAuth.getState().activeId === characterId) {
        store_1.useApp.getState().setSettings({
            accountingLevel: skills[exports.SKILL_IDS.accounting] ?? 0,
            brokerRelationsLevel: skills[exports.SKILL_IDS.brokerRelations] ?? 0,
        });
    }
    return skills;
}
/** Pull NPC corp + faction standings (base values, before Connections/Diplomacy). */
async function syncStandings(characterId) {
    const { data } = await esiAuth(`/characters/${characterId}/standings/`, undefined, characterId);
    const standings = { corps: {}, factions: {} };
    for (const e of data) {
        if (e.from_type === 'npc_corp')
            standings.corps[e.from_id] = e.standing;
        else if (e.from_type === 'faction')
            standings.factions[e.from_id] = e.standing;
    }
    auth_1.useAuth.getState().setCharacterData(characterId, { standings });
    return standings;
}
/** Wallet + implants — optional scopes; degrade to null when not granted. */
async function syncWalletAndImplants(characterId) {
    let wallet = null;
    let implants = null;
    try {
        wallet = (await esiAuth(`/characters/${characterId}/wallet/`, undefined, characterId)).data;
    }
    catch {
        // scope not granted on this token — re-login picks it up
    }
    try {
        implants = (await esiAuth(`/characters/${characterId}/implants/`, undefined, characterId)).data;
    }
    catch {
        // ditto
    }
    auth_1.useAuth.getState().setCharacterData(characterId, { wallet, implants });
}
/**
 * Pull all assets; keep assembled ships with their fitted cargo modules
 * (children in Lo/Rig slots), compute effective cargo with the skill map,
 * and resolve player-assigned ship names.
 */
async function syncShips(characterId) {
    const first = await esiAuth(`/characters/${characterId}/assets/?page=1`, undefined, characterId);
    let entries = first.data;
    for (let page = 2; page <= first.pages; page++) {
        entries = entries.concat((await esiAuth(`/characters/${characterId}/assets/?page=${page}`, undefined, characterId)).data);
    }
    // assembled (singleton) ships only — packaged hulls in a hangar can't be flown as-is
    const shipEntries = entries.filter((e) => e.is_singleton && (0, typedb_1.isShip)(e.type_id));
    // fitted modules live as children of the ship item in Lo/Rig slots
    const fittedByShip = new Map();
    for (const e of entries) {
        if (/^(LoSlot|RigSlot)/.test(e.location_flag)) {
            const list = fittedByShip.get(e.location_id) ?? [];
            list.push(e.type_id);
            fittedByShip.set(e.location_id, list);
        }
    }
    const allModuleTypes = [...fittedByShip.values()].flat();
    const modAttrs = await (0, dogma_1.cargoModAttrs)(allModuleTypes);
    const skills = auth_1.useAuth.getState().characters.find((c) => c.characterId === characterId)?.skills ?? null;
    const names = new Map();
    for (let i = 0; i < shipEntries.length; i += 1000) {
        const ids = shipEntries.slice(i, i + 1000).map((e) => e.item_id);
        try {
            const { data } = await esiAuth(`/characters/${characterId}/assets/names/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids) }, characterId);
            for (const n of data) {
                if (n.name && n.name !== 'None')
                    names.set(n.item_id, n.name);
            }
        }
        catch {
            // names are cosmetic — a failure here shouldn't sink the sync
        }
    }
    const ships = shipEntries
        .map((e) => {
        const t = (0, typedb_1.getType)(e.type_id);
        const mods = { expanderMultipliers: [], rigBonusesPct: [] };
        for (const modType of fittedByShip.get(e.item_id) ?? []) {
            const attrs = modAttrs[modType];
            if (attrs?.mult)
                mods.expanderMultipliers.push(attrs.mult);
            if (attrs?.rigPct)
                mods.rigBonusesPct.push(attrs.rigPct);
        }
        const cargo = (0, cargo_1.computeShipCargo)(t, skills, mods);
        return {
            itemId: e.item_id,
            typeId: e.type_id,
            typeName: t.name,
            customName: names.get(e.item_id) ?? null,
            cargo: cargo.general,
            breakdown: (0, cargo_1.cargoBreakdown)(cargo),
        };
    })
        .filter((s) => s.cargo > 0)
        .sort((a, b) => b.cargo - a.cargo);
    auth_1.useAuth.getState().setCharacterData(characterId, { ships });
    return ships;
}
// ---------- game-client integration (v7) ----------
/** current solar system of a character (default: active) */
async function getLocation(charId) {
    const id = charId ?? (0, auth_1.activeChar)()?.characterId;
    if (!id)
        throw new Error('Not logged in.');
    return (await esiAuth(`/characters/${id}/location/`, undefined, id)).data;
}
/** fresh wallet BALANCE (ESI caches it only ~120s — cheap to keep honest).
 * The stored balance otherwise only updates on a full character sync, which
 * made the net-worth chart show sale proceeds as vanished ISK. */
async function refreshWalletBalance(charId) {
    try {
        const bal = (await esiAuth(`/characters/${charId}/wallet/`, undefined, charId)).data;
        auth_1.useAuth.getState().setCharacterData(charId, { wallet: bal });
        return bal;
    }
    catch {
        return null; // stale balance is better than a crashed snapshot
    }
}
/** current ship: hull type + the actual ship item id (matches synced assets) */
async function getCurrentShip(charId) {
    const id = charId ?? (0, auth_1.activeChar)()?.characterId;
    if (!id)
        throw new Error('Not logged in.');
    return (await esiAuth(`/characters/${id}/ship/`, undefined, id)).data;
}
async function getMyOrders(charId) {
    const id = charId ?? (0, auth_1.activeChar)()?.characterId;
    if (!id)
        throw new Error('Not logged in.');
    const orders = (await esiAuth(`/characters/${id}/orders/`, undefined, id)).data;
    const name = auth_1.useAuth.getState().characters.find((c) => c.characterId === id)?.characterName;
    return orders.map((o) => ({ ...o, ownerId: id, ownerName: name }));
}
// characters whose orders fetch FAILED on the last getTeamOrders pass —
// consumers that must not act on partial data (net-worth snapshots, the
// statusbar warning) check this instead of trusting a silently smaller list
let teamOrderFailures = [];
function lastTeamOrderFailures() {
    return teamOrderFailures;
}
/** every team character's active orders, owner-tagged (chars in parallel) */
async function getTeamOrders() {
    const chars = auth_1.useAuth.getState().characters;
    const failed = [];
    const results = await Promise.all(chars.map(async (c) => {
        try {
            return await getMyOrders(c.characterId);
        }
        catch {
            // one character's session issue mustn't hide the rest — but it must
            // not be SILENT either
            failed.push(c.characterId);
            return [];
        }
    }));
    teamOrderFailures = failed;
    return results.flat();
}
/** most recent page of closed orders (filled / expired / cancelled, ~90 days) */
async function getMyOrderHistory(charId) {
    const id = charId ?? (0, auth_1.activeChar)()?.characterId;
    if (!id)
        throw new Error('Not logged in.');
    const orders = (await esiAuth(`/characters/${id}/orders/history/?page=1`, undefined, id)).data;
    const name = auth_1.useAuth.getState().characters.find((c) => c.characterId === id)?.characterName;
    return orders.map((o) => ({ ...o, ownerId: id, ownerName: name }));
}
async function getTeamOrderHistory() {
    const chars = auth_1.useAuth.getState().characters;
    const results = await Promise.all(chars.map(async (c) => {
        try {
            return await getMyOrderHistory(c.characterId);
        }
        catch {
            return []; // best-effort per character
        }
    }));
    return results.flat();
}
// structure names: visible only with docking access; cached across sessions
const STRUCT_KEY = 'etc-structure-names-v1';
const structNames = (() => {
    try {
        return JSON.parse(localStorage.getItem(STRUCT_KEY) ?? '{}');
    }
    catch {
        return {};
    }
})();
/** Resolve a player structure's name (null when no ACL access). */
async function structureName(structureId) {
    const key = String(structureId);
    if (key in structNames)
        return structNames[key];
    let name = null;
    try {
        name = (await esiAuth(`/universe/structures/${structureId}/`)).data.name;
    }
    catch {
        name = null; // no access — remember that too
    }
    structNames[key] = name;
    try {
        localStorage.setItem(STRUCT_KEY, JSON.stringify(structNames));
    }
    catch {
        // cache only
    }
    return name;
}
// ---------- in-game UI actions (require the EVE client to be running) ----------
// These act in the game client where THAT character is logged in — pass the
// order's owner so the window opens on the right screen.
/** Open an item's market window in the running EVE client. */
async function openMarketWindow(typeId, charId) {
    await esiAuth(`/ui/openwindow/marketdetails/?type_id=${typeId}`, { method: 'POST' }, charId);
}
let onlineDetail = new Map();
/** per-character result of the last online sweep — for honest error text */
function lastOnlineDetail() {
    return onlineDetail;
}
let onlineCache = { at: 0, ids: [] };
async function onlineCharIds() {
    if (Date.now() - onlineCache.at < 25000)
        return onlineCache.ids;
    const chars = auth_1.useAuth.getState().characters;
    const detail = new Map();
    const flags = await Promise.all(chars.map(async (c) => {
        try {
            const { data } = await esiAuth(`/characters/${c.characterId}/online/`, undefined, c.characterId);
            detail.set(c.characterId, { online: data.online });
            return data.online;
        }
        catch (e) {
            detail.set(c.characterId, { online: false, error: e instanceof Error ? e.message : String(e) });
            return false; // unknown — callers must FAIL OPEN, never gate on this
        }
    }));
    onlineDetail = detail;
    onlineCache = { at: Date.now(), ids: chars.filter((_, i) => flags[i]).map((c) => c.characterId) };
    return onlineCache.ids;
}
/** Open the item's market window on EVERY online character; falls back to
 * the given char (else the active one) when nobody reads as online. */
async function openMarketWindowEverywhere(typeId, fallbackCharId) {
    const ids = await onlineCharIds();
    if (ids.length === 0)
        return openMarketWindow(typeId, fallbackCharId);
    await Promise.all(ids.map((id) => openMarketWindow(typeId, id).catch(() => { })));
}
/** Add a station/structure/system to the autopilot route in the running client. */
async function setWaypoint(destinationId, clearOthers = false, charId) {
    await esiAuth(`/ui/autopilot/waypoint/?destination_id=${destinationId}&add_to_beginning=false&clear_other_waypoints=${clearOthers}`, { method: 'POST' }, charId);
}
/** Full character sync: skills → settings/cargo math, standings, ships, wallet. */
/** does this character's CURRENT token carry a scope? Tokens only carry
 * what was requested at login, so a scope added in a later app version
 * needs a re-login — decoded locally from the JWT, nothing is sent. */
function tokenHasScope(characterId, scope) {
    const c = auth_1.useAuth.getState().characters.find((x) => x.characterId === characterId);
    if (!c?.accessToken)
        return false;
    try {
        const part = c.accessToken.split('.')[1];
        const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
        const payload = JSON.parse(json);
        const scopes = Array.isArray(payload.scp) ? payload.scp : payload.scp ? [payload.scp] : [];
        return scopes.includes(scope);
    }
    catch {
        return false; // unreadable token → assume not granted (honest default)
    }
}
exports.FITTINGS_WRITE_SCOPE = 'esi-fittings.write_fittings.v1';
/** save a fit into the character's IN-GAME fitting manager. Returns the
 * new fitting id. Requires the write scope (see tokenHasScope). */
async function saveFitting(characterId, payload, abort) {
    const { data } = await esiAuth(`/characters/${characterId}/fittings/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }, characterId, { spec: esiRate_1.FITTING_GROUP, abort });
    return data.fitting_id;
}
exports.FITTINGS_READ_SCOPE = 'esi-fittings.read_fittings.v1';
/**
 * EVE publishes this list on a FIVE MINUTE cache (x-cached-seconds 300,
 * verified against the live spec). A fit created in game moments ago does
 * not exist as far as ESI is concerned until that window rolls over — no
 * amount of re-asking changes it. `expiresIn` is returned so the UI can say
 * so out loud instead of silently showing an incomplete list.
 */
async function listFittings(characterId) {
    const { data, expiresIn } = await esiAuth(`/characters/${characterId}/fittings/`, 
    // force revalidation so a REscan is a real question to ESI, not a
    // locally cached copy of the previous answer
    { cache: 'no-cache' }, characterId, { spec: esiRate_1.FITTING_GROUP });
    return { fits: data, expiresIn };
}
/** DESTRUCTIVE: removes a fit from the character's in-game fitting manager.
 * There is no undo in EVE, which is why the library backs every fitting up
 * to disk before it deletes anything. */
async function deleteFitting(characterId, fittingId, abort) {
    await esiAuth(`/characters/${characterId}/fittings/${fittingId}/`, { method: 'DELETE' }, characterId, { spec: esiRate_1.FITTING_GROUP, abort });
}
/** quiet skills+implants refresh for the Skill & Fit module — the fit tools
 * feed on skill data, so it must not go stale while the user is looking at
 * it. Stamps lastSync so dependent views recompute. */
async function resyncSkillsAndImplants(characterId) {
    await syncSkills(characterId);
    await syncWalletAndImplants(characterId);
    auth_1.useAuth.getState().markSynced(characterId);
}
async function syncCharacter(charId) {
    const id = charId ?? (0, auth_1.activeChar)()?.characterId;
    if (!id)
        throw new Error('Not logged in.');
    const skills = await syncSkills(id); // first: ship cargo needs the skill map
    const [, ships] = await Promise.all([
        syncStandings(id),
        syncShips(id),
        syncWalletAndImplants(id),
    ]);
    auth_1.useAuth.getState().markSynced(id);
    return `Accounting ${skills[exports.SKILL_IDS.accounting] ?? 0} · Broker Relations ${skills[exports.SKILL_IDS.brokerRelations] ?? 0} · ${ships.length} ships`;
}
