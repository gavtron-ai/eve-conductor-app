// Authenticated ESI calls, per character (defaults to the active one).
import { ESI_BASE } from './constants';
import { activeChar, ensureToken, useAuth, type OwnedShip, type Standings } from './auth';
import { useApp } from './store';
import { getType, isShip } from './typedb';
import { computeShipCargo, cargoBreakdown, type FittedCargoMods } from './cargo';
import { cargoModAttrs } from './dogma';
import { rateAcquire, rateObserve, esiGate, noteEsiResponse, FITTING_GROUP, type RateGroupSpec, type EsiLane } from './esiRate';

export const SKILL_IDS = {
  accounting: 16622,
  brokerRelations: 3446,
} as const;

// how long until the server will have NEW data for the last esiAuth response —
// computed from its own Expires/Date headers (no client-clock skew)
let lastExpiry = 0;
export function lastEsiExpiryMs(): number {
  return lastExpiry;
}

export async function esiAuth<T>(
  path: string,
  init?: RequestInit,
  charId?: number,
  /** `spec`: CCP publishes a per-route token budget (`x-rate-limit` in the
   * OpenAPI spec) — pass it and this call waits its turn and records what it
   * cost. `lane`: which priority lane this request belongs to; the overlay
   * lane is the last thing to be paused when the error budget tightens.
   * See esiRate.ts. */
  rate?: { spec?: RateGroupSpec; abort?: () => boolean; lane?: EsiLane },
): Promise<{ data: T; pages: number; expiresIn: number | null }> {
  // DEFAULT 'interactive', deliberately: mislabelling a foreground call as
  // background would make the thing the user is waiting on yield early, which
  // is the wrong direction. Unattended collectors pass their own lane — see
  // the `lane` parameters on getTeamOrders / refreshWalletBalance / syncLedger.
  const lane: EsiLane = rate?.lane ?? 'interactive';
  // a 401 means the server rejected a token we thought was valid (e.g. EVE
  // revoked the session) — force one refresh and retry before giving up
  for (let attempt = 0; ; attempt++) {
    const token = await ensureToken(charId, attempt > 0);
    if (rate?.spec) await rateAcquire(rate.spec, rate.abort);
    // EVERY authenticated call spends from the shared 100-errors-per-60s
    // budget too, and a 420 from that closes the fitting routes as surely as
    // a fitting-group overrun does — so gate and report unconditionally, not
    // just for the routes that carry a published token group.
    await esiGate(lane, rate?.abort);
    const res = await fetch(`${ESI_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
    noteEsiResponse(res.status, res.headers, lane);
    if (rate?.spec) rateObserve(rate.spec, res.status, res.headers);
    // the server explicitly asked us to slow down or stop — surface it as
    // itself rather than as a generic failure, and never hammer past it
    if (res.status === 429 || res.status === 420) {
      throw new Error(
        res.status === 420
          ? 'ESI error limit reached (420) — everything is paused until the window resets.'
          : 'EVE rate limited this request (429) — the tool will wait and continue.',
      );
    }
    if (res.status === 401 && attempt === 0) continue;
    if (res.status === 401) {
      throw new Error(
        'EVE rejected the session (expired or revoked) — log this character out and back in (Settings → EVE login).',
      );
    }
    if (res.status === 403) {
      throw new Error('Scope not granted on this login — log this character out and back in (Settings → EVE login).');
    }
    if (!res.ok) throw new Error(`ESI ${res.status} on ${path}`);
    const exp = Date.parse(res.headers.get('expires') ?? '');
    const srv = Date.parse(res.headers.get('date') ?? '');
    // seconds until ESI will serve anything new. Measured against the
    // SERVER's clock, so a skewed local clock cannot distort it.
    const expiresIn = !Number.isNaN(exp) && !Number.isNaN(srv) ? Math.max(0, Math.round((exp - srv) / 1000)) : null;
    if (!Number.isNaN(exp) && !Number.isNaN(srv)) lastExpiry = Math.max(0, exp - srv);
    if (res.status === 204) return { data: undefined as T, pages: 1, expiresIn };
    return { data: await res.json(), pages: Number(res.headers.get('x-pages') ?? '1'), expiresIn };
  }
}

interface SkillsResponse {
  skills: { skill_id: number; active_skill_level: number }[];
}

/** Pull the full skill map. The ACTIVE character's skills drive the fee settings. */
export async function syncSkills(characterId: number): Promise<Record<number, number>> {
  const { data } = await esiAuth<SkillsResponse>(`/characters/${characterId}/skills/`, undefined, characterId);
  const skills: Record<number, number> = {};
  for (const s of data.skills) skills[s.skill_id] = s.active_skill_level;
  useAuth.getState().setCharacterData(characterId, { skills });
  if (useAuth.getState().activeId === characterId) {
    useApp.getState().setSettings({
      accountingLevel: skills[SKILL_IDS.accounting] ?? 0,
      brokerRelationsLevel: skills[SKILL_IDS.brokerRelations] ?? 0,
    });
  }
  return skills;
}

interface StandingEntry {
  from_id: number;
  from_type: 'agent' | 'npc_corp' | 'faction';
  standing: number;
}

/** Pull NPC corp + faction standings (base values, before Connections/Diplomacy). */
export async function syncStandings(characterId: number): Promise<Standings> {
  const { data } = await esiAuth<StandingEntry[]>(`/characters/${characterId}/standings/`, undefined, characterId);
  const standings: Standings = { corps: {}, factions: {} };
  for (const e of data) {
    if (e.from_type === 'npc_corp') standings.corps[e.from_id] = e.standing;
    else if (e.from_type === 'faction') standings.factions[e.from_id] = e.standing;
  }
  useAuth.getState().setCharacterData(characterId, { standings });
  return standings;
}

/** Wallet + implants — optional scopes; degrade to null when not granted. */
export async function syncWalletAndImplants(characterId: number): Promise<void> {
  let wallet: number | null = null;
  let implants: number[] | null = null;
  try {
    wallet = (await esiAuth<number>(`/characters/${characterId}/wallet/`, undefined, characterId)).data;
  } catch {
    // scope not granted on this token — re-login picks it up
  }
  try {
    implants = (await esiAuth<number[]>(`/characters/${characterId}/implants/`, undefined, characterId)).data;
  } catch {
    // ditto
  }
  useAuth.getState().setCharacterData(characterId, { wallet, implants });
}

interface AssetEntry {
  item_id: number;
  type_id: number;
  location_id: number;
  is_singleton: boolean;
  location_flag: string;
}

/**
 * Pull all assets; keep assembled ships with their fitted cargo modules
 * (children in Lo/Rig slots), compute effective cargo with the skill map,
 * and resolve player-assigned ship names.
 */
export async function syncShips(characterId: number): Promise<OwnedShip[]> {
  const first = await esiAuth<AssetEntry[]>(`/characters/${characterId}/assets/?page=1`, undefined, characterId);
  let entries = first.data;
  for (let page = 2; page <= first.pages; page++) {
    entries = entries.concat(
      (await esiAuth<AssetEntry[]>(`/characters/${characterId}/assets/?page=${page}`, undefined, characterId)).data,
    );
  }
  // assembled (singleton) ships only — packaged hulls in a hangar can't be flown as-is
  const shipEntries = entries.filter((e) => e.is_singleton && isShip(e.type_id));

  // fitted modules live as children of the ship item in Lo/Rig slots
  const fittedByShip = new Map<number, number[]>();
  for (const e of entries) {
    if (/^(LoSlot|RigSlot)/.test(e.location_flag)) {
      const list = fittedByShip.get(e.location_id) ?? [];
      list.push(e.type_id);
      fittedByShip.set(e.location_id, list);
    }
  }
  const allModuleTypes = [...fittedByShip.values()].flat();
  const modAttrs = await cargoModAttrs(allModuleTypes);
  const skills =
    useAuth.getState().characters.find((c) => c.characterId === characterId)?.skills ?? null;

  const names = new Map<number, string>();
  for (let i = 0; i < shipEntries.length; i += 1000) {
    const ids = shipEntries.slice(i, i + 1000).map((e) => e.item_id);
    try {
      const { data } = await esiAuth<{ item_id: number; name: string }[]>(
        `/characters/${characterId}/assets/names/`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(ids) },
        characterId,
      );
      for (const n of data) {
        if (n.name && n.name !== 'None') names.set(n.item_id, n.name);
      }
    } catch {
      // names are cosmetic — a failure here shouldn't sink the sync
    }
  }

  const ships: OwnedShip[] = shipEntries
    .map((e) => {
      const t = getType(e.type_id)!;
      const mods: FittedCargoMods = { expanderMultipliers: [], rigBonusesPct: [] };
      for (const modType of fittedByShip.get(e.item_id) ?? []) {
        const attrs = modAttrs[modType];
        if (attrs?.mult) mods.expanderMultipliers.push(attrs.mult);
        if (attrs?.rigPct) mods.rigBonusesPct.push(attrs.rigPct);
      }
      const cargo = computeShipCargo(t, skills, mods);
      return {
        itemId: e.item_id,
        typeId: e.type_id,
        typeName: t.name,
        customName: names.get(e.item_id) ?? null,
        cargo: cargo.general,
        breakdown: cargoBreakdown(cargo),
      };
    })
    .filter((s) => s.cargo > 0)
    .sort((a, b) => b.cargo - a.cargo);
  useAuth.getState().setCharacterData(characterId, { ships });
  return ships;
}

// ---------- game-client integration (v7) ----------

/** current solar system of a character (default: active) */
export async function getLocation(charId?: number): Promise<{ solar_system_id: number }> {
  const id = charId ?? activeChar()?.characterId;
  if (!id) throw new Error('Not logged in.');
  return (await esiAuth<{ solar_system_id: number }>(`/characters/${id}/location/`, undefined, id)).data;
}

/** fresh wallet BALANCE (ESI caches it only ~120s — cheap to keep honest).
 * The stored balance otherwise only updates on a full character sync, which
 * made the net-worth chart show sale proceeds as vanished ISK. */
export async function refreshWalletBalance(charId: number, lane?: EsiLane): Promise<number | null> {
  try {
    const bal = (await esiAuth<number>(`/characters/${charId}/wallet/`, undefined, charId, { lane })).data;
    useAuth.getState().setCharacterData(charId, { wallet: bal });
    return bal;
  } catch {
    return null; // stale balance is better than a crashed snapshot
  }
}

/** current ship: hull type + the actual ship item id (matches synced assets) */
export async function getCurrentShip(charId?: number): Promise<{ ship_type_id: number; ship_item_id: number; ship_name: string }> {
  const id = charId ?? activeChar()?.characterId;
  if (!id) throw new Error('Not logged in.');
  return (
    await esiAuth<{ ship_type_id: number; ship_item_id: number; ship_name: string }>(
      `/characters/${id}/ship/`,
      undefined,
      id,
    )
  ).data;
}

export interface MyOrder {
  order_id: number;
  type_id: number;
  region_id: number;
  location_id: number;
  price: number;
  volume_remain: number;
  volume_total: number;
  is_buy_order?: boolean;
  issued: string;
  duration: number;
  escrow?: number;
  /** which team character owns this order (added client-side) */
  ownerId?: number;
  ownerName?: string;
}

export async function getMyOrders(charId?: number, lane?: EsiLane): Promise<MyOrder[]> {
  const id = charId ?? activeChar()?.characterId;
  if (!id) throw new Error('Not logged in.');
  const orders = (await esiAuth<MyOrder[]>(`/characters/${id}/orders/`, undefined, id, { lane })).data;
  const name = useAuth.getState().characters.find((c) => c.characterId === id)?.characterName;
  return orders.map((o) => ({ ...o, ownerId: id, ownerName: name }));
}

// characters whose orders fetch FAILED on the last getTeamOrders pass —
// consumers that must not act on partial data (net-worth snapshots, the
// statusbar warning) check this instead of trusting a silently smaller list
let teamOrderFailures: number[] = [];
export function lastTeamOrderFailures(): number[] {
  return teamOrderFailures;
}

/** every team character's active orders, owner-tagged (chars in parallel) */
export async function getTeamOrders(lane?: EsiLane): Promise<MyOrder[]> {
  const chars = useAuth.getState().characters;
  const failed: number[] = [];
  const results = await Promise.all(
    chars.map(async (c) => {
      try {
        return await getMyOrders(c.characterId, lane);
      } catch {
        // one character's session issue mustn't hide the rest — but it must
        // not be SILENT either
        failed.push(c.characterId);
        return [] as MyOrder[];
      }
    }),
  );
  teamOrderFailures = failed;
  return results.flat();
}

/** most recent page of closed orders (filled / expired / cancelled, ~90 days) */
export async function getMyOrderHistory(charId?: number, lane?: EsiLane): Promise<MyOrder[]> {
  const id = charId ?? activeChar()?.characterId;
  if (!id) throw new Error('Not logged in.');
  const orders = (
    await esiAuth<MyOrder[]>(`/characters/${id}/orders/history/?page=1`, undefined, id, { lane })
  ).data;
  const name = useAuth.getState().characters.find((c) => c.characterId === id)?.characterName;
  return orders.map((o) => ({ ...o, ownerId: id, ownerName: name }));
}

export async function getTeamOrderHistory(lane?: EsiLane): Promise<MyOrder[]> {
  const chars = useAuth.getState().characters;
  const results = await Promise.all(
    chars.map(async (c) => {
      try {
        return await getMyOrderHistory(c.characterId, lane);
      } catch {
        return [] as MyOrder[]; // best-effort per character
      }
    }),
  );
  return results.flat();
}

// structure names: visible only with docking access; cached across sessions
const STRUCT_KEY = 'etc-structure-names-v1';
const structNames: Record<string, string | null> = (() => {
  try {
    return JSON.parse(localStorage.getItem(STRUCT_KEY) ?? '{}');
  } catch {
    return {};
  }
})();

/** Resolve a player structure's name (null when no ACL access). */
export async function structureName(structureId: number): Promise<string | null> {
  const key = String(structureId);
  if (key in structNames) return structNames[key];
  let name: string | null = null;
  try {
    name = (await esiAuth<{ name: string }>(`/universe/structures/${structureId}/`)).data.name;
  } catch {
    name = null; // no access — remember that too
  }
  structNames[key] = name;
  try {
    localStorage.setItem(STRUCT_KEY, JSON.stringify(structNames));
  } catch {
    // cache only
  }
  return name;
}

// ---------- in-game UI actions (require the EVE client to be running) ----------
// These act in the game client where THAT character is logged in — pass the
// order's owner so the window opens on the right screen.

/** Open an item's market window in the running EVE client. */
export async function openMarketWindow(typeId: number, charId?: number): Promise<void> {
  await esiAuth<void>(`/ui/openwindow/marketdetails/?type_id=${typeId}`, { method: 'POST' }, charId);
}

// Which of the team's game clients are running right now. In-game window
// pushes only reach a RUNNING client, and the user's characters aren't
// always where their duty says — so every "open in game" button opens on
// EVERY online character (user rule: an extra window is fine to close).
export interface OnlineCheck {
  online: boolean;
  /** set when the CHECK ITSELF failed — "offline" is then unknown, not fact */
  error?: string;
}
let onlineDetail = new Map<number, OnlineCheck>();
/** per-character result of the last online sweep — for honest error text */
export function lastOnlineDetail(): Map<number, OnlineCheck> {
  return onlineDetail;
}

let onlineCache: { at: number; ids: number[] } = { at: 0, ids: [] };
export async function onlineCharIds(): Promise<number[]> {
  if (Date.now() - onlineCache.at < 25_000) return onlineCache.ids;
  const chars = useAuth.getState().characters;
  const detail = new Map<number, OnlineCheck>();
  const flags = await Promise.all(
    chars.map(async (c) => {
      try {
        const { data } = await esiAuth<{ online: boolean }>(
          `/characters/${c.characterId}/online/`,
          undefined,
          c.characterId,
        );
        detail.set(c.characterId, { online: data.online });
        return data.online;
      } catch (e) {
        detail.set(c.characterId, { online: false, error: e instanceof Error ? e.message : String(e) });
        return false; // unknown — callers must FAIL OPEN, never gate on this
      }
    }),
  );
  onlineDetail = detail;
  onlineCache = { at: Date.now(), ids: chars.filter((_, i) => flags[i]).map((c) => c.characterId) };
  return onlineCache.ids;
}

/** Open the item's market window on EVERY online character; falls back to
 * the given char (else the active one) when nobody reads as online. */
export async function openMarketWindowEverywhere(typeId: number, fallbackCharId?: number): Promise<void> {
  const ids = await onlineCharIds();
  if (ids.length === 0) return openMarketWindow(typeId, fallbackCharId);
  await Promise.all(ids.map((id) => openMarketWindow(typeId, id).catch(() => {})));
}

/** Add a station/structure/system to the autopilot route in the running client. */
export async function setWaypoint(destinationId: number, clearOthers = false, charId?: number): Promise<void> {
  await esiAuth<void>(
    `/ui/autopilot/waypoint/?destination_id=${destinationId}&add_to_beginning=false&clear_other_waypoints=${clearOthers}`,
    { method: 'POST' },
    charId,
  );
}

/** Full character sync: skills → settings/cargo math, standings, ships, wallet. */
/** does this character's CURRENT token carry a scope? Tokens only carry
 * what was requested at login, so a scope added in a later app version
 * needs a re-login — decoded locally from the JWT, nothing is sent. */
export function tokenHasScope(characterId: number, scope: string): boolean {
  const c = useAuth.getState().characters.find((x) => x.characterId === characterId);
  if (!c?.accessToken) return false;
  try {
    const part = c.accessToken.split('.')[1];
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(json) as { scp?: string | string[] };
    const scopes = Array.isArray(payload.scp) ? payload.scp : payload.scp ? [payload.scp] : [];
    return scopes.includes(scope);
  } catch {
    return false; // unreadable token → assume not granted (honest default)
  }
}

export const FITTINGS_WRITE_SCOPE = 'esi-fittings.write_fittings.v1';

/** save a fit into the character's IN-GAME fitting manager. Returns the
 * new fitting id. Requires the write scope (see tokenHasScope). */
export async function saveFitting(
  characterId: number,
  payload: { name: string; description: string; ship_type_id: number; items: { type_id: number; flag: string; quantity: number }[] },
  abort?: () => boolean,
): Promise<number> {
  const { data } = await esiAuth<{ fitting_id: number }>(
    `/characters/${characterId}/fittings/`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) },
    characterId,
    { spec: FITTING_GROUP, abort },
  );
  return data.fitting_id;
}

export const FITTINGS_READ_SCOPE = 'esi-fittings.read_fittings.v1';

/** every saved fitting in the character's PERSONAL folder. (Corporation
 * fittings have no ESI endpoint at all — verified.) */
export interface EsiFittingRow {
  fitting_id: number; name: string; description?: string; ship_type_id: number;
  items: { type_id: number; flag: string; quantity: number }[];
}

/**
 * EVE publishes this list on a FIVE MINUTE cache (x-cached-seconds 300,
 * verified against the live spec). A fit created in game moments ago does
 * not exist as far as ESI is concerned until that window rolls over — no
 * amount of re-asking changes it. `expiresIn` is returned so the UI can say
 * so out loud instead of silently showing an incomplete list.
 */
export async function listFittings(characterId: number): Promise<{ fits: EsiFittingRow[]; expiresIn: number | null }> {
  const { data, expiresIn } = await esiAuth<EsiFittingRow[]>(
    `/characters/${characterId}/fittings/`,
    // force revalidation so a REscan is a real question to ESI, not a
    // locally cached copy of the previous answer
    { cache: 'no-cache' },
    characterId,
    { spec: FITTING_GROUP },
  );
  return { fits: data, expiresIn };
}

/** DESTRUCTIVE: removes a fit from the character's in-game fitting manager.
 * There is no undo in EVE, which is why the library backs every fitting up
 * to disk before it deletes anything. */
export async function deleteFitting(characterId: number, fittingId: number, abort?: () => boolean): Promise<void> {
  await esiAuth<void>(
    `/characters/${characterId}/fittings/${fittingId}/`,
    { method: 'DELETE' },
    characterId,
    { spec: FITTING_GROUP, abort },
  );
}

/** quiet skills+implants refresh for the Skill & Fit module — the fit tools
 * feed on skill data, so it must not go stale while the user is looking at
 * it. Stamps lastSync so dependent views recompute. */
export async function resyncSkillsAndImplants(characterId: number): Promise<void> {
  await syncSkills(characterId);
  await syncWalletAndImplants(characterId);
  useAuth.getState().markSynced(characterId);
}

export async function syncCharacter(charId?: number): Promise<string> {
  const id = charId ?? activeChar()?.characterId;
  if (!id) throw new Error('Not logged in.');
  const skills = await syncSkills(id); // first: ship cargo needs the skill map
  const [, ships] = await Promise.all([
    syncStandings(id),
    syncShips(id),
    syncWalletAndImplants(id),
  ]);
  useAuth.getState().markSynced(id);
  return `Accounting ${skills[SKILL_IDS.accounting] ?? 0} · Broker Relations ${skills[SKILL_IDS.brokerRelations] ?? 0} · ${ships.length} ships`;
}
