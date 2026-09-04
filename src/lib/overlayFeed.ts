// Feeds the multibox overlay. The MAIN window owns the ESI session, so it
// polls and pushes; the overlay window is a dumb, transparent renderer.
//
// Sources (all sanctioned, both 5s-cached server-side):
//   /characters/{id}/ship/    → ship type + the ship's NAME
//   /characters/{id}/online/  → online flag
// There is NO live shield/armor/hull anywhere in ESI (verified against the
// live spec), so the overlay never pretends to show health.
import { esiAuth, tokenHasScope } from './esiChar';
import { useAuth } from './auth';
import {
  cloneSignature,
  lookupClone,
  cloneDisplayName,
  recordClones,
  initCloneRegistry,
  onCloneRegistry,
  type CloneObservation,
} from './cloneNames';
import { getType } from './typedb';
import { getEsfData } from './dogmaStats';
import { extraTypeName } from './skillRelevance';
import { decodeEsiName } from './esiNames';
import { summarizeClone, type ImplantInfo } from './implantSummary';
import { getSystem, reachFrom } from './mapdata';
import { ESI_BASE } from './constants';
import { esiFetch, esiErrorState } from './esiRate';
import { fetchRaidableSkyhooks, planetInfo, parseSystemList } from './theft';
import { raidHistory } from './raidWatch';
import { useApp } from './store';
import { buildRaidAlerts, type RaidAlert } from './raidAlerts';
import { piPlanets } from './pi';
import { parseJournal, pushUndock, UNDOCK_KEY } from './undockJournal';
import type { OverlayChar } from '../components/Overlay';

export type { RaidAlert } from './raidAlerts';

/** dogma attr 331 "implantness" = which implant slot a type occupies */
const ATTR_IMPLANTNESS = 331;
/** the five character-attribute bonuses — verified against the shipped
 * catalog: 175 charisma, 176 intelligence, 177 memory, 178 perception,
 * 179 willpower */
const ATTR_BONUS_IDS = new Set([175, 176, 177, 178, 179]);
let esfDogma: Record<string, { dogmaAttributes: { attributeID: number; value: number }[] }> | null = null;
/** ids of every `implantSet*` attribute, read from the catalog rather than
 * hardcoded so a new set shipped by CCP is recognised without a code change */
let setBonusIds: Set<number> | null = null;

const dogmaOf = (typeId: number) => esfDogma?.[String(typeId)]?.dogmaAttributes;
const implantSlot = (typeId: number): number | null => {
  const v = dogmaOf(typeId)?.find((a) => a.attributeID === ATTR_IMPLANTNESS)?.value;
  return v === undefined ? null : Math.round(v);
};
/** undefined (not false) while the catalog is still loading, so the caller
 * can fall back to a name test instead of concluding "no" */
const hasAttrBonus = (typeId: number): boolean | undefined =>
  dogmaOf(typeId)?.some((a) => ATTR_BONUS_IDS.has(a.attributeID) && a.value !== 0);
const hasSetBonus = (typeId: number): boolean | undefined => {
  const da = dogmaOf(typeId);
  if (!da || !setBonusIds) return undefined;
  return da.some((a) => setBonusIds!.has(a.attributeID) && a.value !== 0);
};

/** CAPSULES ARE NOT MARKET ITEMS: type 670 is absent from typedb, so a
 * podded character showed no ship type at all. The ESF catalog carries
 * every published type — fall back to it. */
let esfTypes: Record<string, { name: string }> | null = null;
void getEsfData().then((d) => {
  esfTypes = d.types as Record<string, { name: string }>;
  esfDogma = d.typeDogma as typeof esfDogma;
  const attrNames = (d as unknown as { dogmaAttributes?: Record<string, { name?: string }> }).dogmaAttributes;
  if (attrNames) {
    setBonusIds = new Set(
      Object.entries(attrNames)
        .filter(([, a]) => /^implantset/i.test(a?.name ?? ''))
        .map(([id]) => Number(id)),
    );
  }
}).catch(() => {});
const typeName = (id: number): string | null =>
  getType(id)?.name ?? esfTypes?.[String(id)]?.name ?? extraTypeName(id) ?? null;

/** Poll cadence. ESI's own server-side caches set the real freshness
 * ceiling — ship 5s, online 60s, IMPLANTS 120s (verified in the live
 * spec). So a clone swap can take up to ~2 minutes to appear no matter
 * how often we ask; that is CCP's cache, not a bug here. */
/** THE OVERLAY IS ON SCREEN AT ALL TIMES, so it is the LAST thing that may
 * be paused when the shared ESI error budget tightens — everything else
 * yields first (see the priority lanes in esiRate.ts). */
const OVERLAY = { lane: 'overlay' as const };

export const OVERLAY_POLL_MS = 6_000;
export const IMPLANT_CACHE_S = 120;

const CAPSULE_TYPE_ID = 670;

/**
 * EVE auto-names an unnamed capsule "Capsule - <character>" (and ships
 * "<character>'s <Ship>"). Those are not labels the pilot chose, so they
 * must never stand in for the clone summary.
 */
function isAutoShipName(name: string, characterName: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  const c = characterName.trim().toLowerCase();
  if (/^capsule\b/.test(n)) return true;
  if (c && n.includes(c)) return true; // "Capsule - Alice", "Alice's Heron"
  return false;
}
// NOTE: pod names are NOT remembered across polls any more. They were —
// and EVE's default "Capsule - <name>" got cached permanently, outranking
// the clone label and sticking forever. A pod name is now used only while
// the pilot is ACTUALLY in that pod, where it is live truth.

// NOTE: an ASSETS lookup for the capsule was tried and REMOVED — verified
// against this user's real data that a Capsule appears in NO character's
// assets (0 across 12 characters / 461 ships). ESI only ever reveals the
// pod's name while the pilot is actually sitting in it, which is why the
// overlay also supports a manual per-character label.

const CLONES_SCOPE = 'esi-clones.read_clones.v1';
/** ESI caches /clones/ for 120s, so asking on every 6s poll would be 20
 * wasted round-trips per answer. */
const CLONES_TTL_MS = 110_000;
const clonesAskedAt = new Map<number, number>();

interface JumpCloneRow {
  name?: string;
  implants?: number[];
}

/** the label a clone reads as, from its implants alone — used both for the
 * overlay box and to show the user, in the config window, what a clone is
 * currently called before they override it */
function labelFor(implantIds: readonly number[], fallback: string) {
  const infos: ImplantInfo[] = implantIds.map((id) => ({
    typeId: id,
    name: typeName(id) ?? `#${id}`,
    slot: implantSlot(id),
    attrBonus: hasAttrBonus(id),
    setBonus: hasSetBonus(id),
  }));
  return { infos, summary: summarizeClone(infos, fallback) };
}

/** Harvest jump clones so the clone the pilot is currently flying can be
 * recognised by its implants — and so every pod they own shows up in the
 * setup window, named or not. Never throws: a character whose login predates
 * the scope simply contributes nothing. */
async function harvestCloneNames(charId: number, charName: string, out: CloneObservation[]): Promise<boolean> {
  if (!tokenHasScope(charId, CLONES_SCOPE)) return false;
  const last = clonesAskedAt.get(charId) ?? 0;
  if (Date.now() - last < CLONES_TTL_MS) return true;
  clonesAskedAt.set(charId, Date.now());
  try {
    const { data } = await esiAuth<{ jump_clones?: JumpCloneRow[] }>(
      `/characters/${charId}/clones/`,
      undefined,
      charId,
      OVERLAY,
    );
    for (const c of data.jump_clones ?? []) {
      const sig = cloneSignature(c.implants);
      if (sig === null) continue; // an empty clone has no fingerprint
      const ids = c.implants ?? [];
      const { infos, summary } = labelFor(ids, charName);
      out.push({
        characterId: charId,
        characterName: charName,
        sig,
        implants: [...ids],
        names: infos.map((i) => i.name),
        label: summary.label,
        // clone names carry ESI's Python-repr quirk exactly like ship names
        esiName: decodeEsiName(c.name ?? '').trim() || undefined,
        worn: false,
      });
    }
    return true;
  } catch {
    return false; // scope revoked or ESI hiccup — fall back to the summary
  }
}

/**
 * WHERE THEY ARE, including WORMHOLE space.
 *
 * The bundled map is K-SPACE ONLY (5,485 systems) — no J-space, no Thera.
 * In a wormhole `getSystem` misses, which showed a raw id AND coloured it
 * white, i.e. "highsec". For a user who lives in a wormhole that is the
 * worst possible answer.
 *
 * `/universe/systems/{id}/` is PUBLIC (no auth) and returns the name and
 * security, so an unknown system is resolved once and remembered — system
 * names never change, and the result is persisted so a restart does not
 * re-ask.
 */
const SYS_CACHE_KEY = 'eve-conductor-systems-v1';
const sysCache = new Map<number, { name: string; sec: number }>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(SYS_CACHE_KEY) ?? '{}') as Record<string, { name: string; sec: number }>)
        .map(([id, v]) => [Number(id), v] as [number, { name: string; sec: number }]);
    } catch {
      return [];
    }
  })(),
);
/** systems we asked about and failed on → when we may try again. ONE failed
 * lookup used to be permanent for the session, so a single ESI hiccup left a
 * wormhole reading "#31001234" until the app was restarted. */
const sysFailedUntil = new Map<number, number>();
const SYS_RETRY_MS = 5 * 60_000;

function rememberSystem(id: number, v: { name: string; sec: number }) {
  sysCache.set(id, v);
  try {
    localStorage.setItem(SYS_CACHE_KEY, JSON.stringify(Object.fromEntries(sysCache)));
  } catch {
    // the cache is a convenience — never break the overlay over it
  }
}

/** name + security for any system, k-space or wormhole */
async function resolveSystem(id: number): Promise<{ name: string; sec: number } | null> {
  const local = getSystem(id);
  if (local) return { name: local.name, sec: local.sec };
  const cached = sysCache.get(id);
  if (cached) return cached;
  const retryAt = sysFailedUntil.get(id);
  if (retryAt !== undefined && Date.now() < retryAt) return null;
  sysFailedUntil.set(id, Date.now() + SYS_RETRY_MS); // clears itself on success
  try {
    const res = await esiFetch(`${ESI_BASE}/universe/systems/${id}/`, { headers: { Accept: 'application/json' } }, OVERLAY);
    if (!res.ok) return null;
    const j = (await res.json()) as { name?: string; security_status?: number };
    if (typeof j.name !== 'string') return null;
    const v = { name: j.name, sec: typeof j.security_status === 'number' ? j.security_status : -1 };
    rememberSystem(id, v);
    sysFailedUntil.delete(id);
    return v;
  } catch {
    return null;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let inflight = false;

// ---- UNDOCK JOURNAL: a docked→undocked flip between location polls IS an
// undock (structure undocks never reach the game log — measured). Only
// transitions are recorded: a character first seen in space has no known
// undock time, and the Log Visualizer says so. ----
const lastDockedState = new Map<number, boolean>();
function recordDockState(charId: number, docked: boolean): void {
  const prev = lastDockedState.get(charId);
  lastDockedState.set(charId, docked);
  if (prev !== true || docked) return;
  try {
    const j = parseJournal(localStorage.getItem(UNDOCK_KEY));
    localStorage.setItem(UNDOCK_KEY, JSON.stringify(pushUndock(j, charId, Date.now())));
  } catch { /* journal only — never let bookkeeping break the feed */ }
}

async function readOne(charId: number, name: string, obs: CloneObservation[]): Promise<OverlayChar> {
  const row: OverlayChar = {
    characterId: charId,
    characterName: name,
    shipTypeId: null,
    shipName: null,
    shipTypeName: null,
    podName: null,
    online: false,
    at: Date.now(),
  };
  try {
    const [ship, online, implants, cloneScope, location] = await Promise.all([
      esiAuth<{ ship_type_id: number; ship_name: string }>(`/characters/${charId}/ship/`, undefined, charId, OVERLAY),
      esiAuth<{ online: boolean }>(`/characters/${charId}/online/`, undefined, charId, OVERLAY).catch(() => null),
      // the CLONE the pilot is flying — what a pod name was ever describing
      esiAuth<number[]>(`/characters/${charId}/implants/`, undefined, charId, OVERLAY).catch(() => null),
      harvestCloneNames(charId, name, obs),
      // WHERE they are — the security band is the thing a multiboxer needs
      // at a glance (scope esi-location.read_location.v1, cached 5s).
      // station_id/structure_id ride along while docked — the docked flag
      // feeds the undock journal (the game log never records structure
      // undocks, measured v0.168).
      esiAuth<{ solar_system_id: number; station_id?: number; structure_id?: number }>(`/characters/${charId}/location/`, undefined, charId, OVERLAY).catch(() => null),
    ]);
    row.cloneNamesAvailable = cloneScope;
    if (implants) {
      const { infos, summary } = labelFor(implants.data, name);
      row.cloneLabel = summary.label;
      row.cloneDetail = summary.detail;
      // the clone the pilot is wearing RIGHT NOW — the only observation that
      // can ever teach the registry about the pod they are actually in
      const sig = cloneSignature(implants.data);
      wornImplants.set(charId, [...implants.data]);
      if (sig !== null) {
        obs.push({
          characterId: charId,
          characterName: name,
          sig,
          implants: [...implants.data],
          names: infos.map((i) => i.name),
          label: summary.label,
          worn: true,
        });
      }
      // the pilot's OWN name for this clone, matched by implant fingerprint
      const rec = lookupClone(charId, implants.data);
      row.cloneName = cloneDisplayName(rec) ?? undefined;
      row.cloneIsCustom = Boolean(rec?.customName?.trim());
      row.alert = rec?.alert ?? null;
    } else {
      // the implant read FAILED — forget what they were last wearing rather
      // than let a later repaint dress this row in a clone they may have
      // long since jumped out of
      wornImplants.delete(charId);
    }
    if (location) {
      const id = location.data.solar_system_id;
      row.systemId = id;
      const sys = await resolveSystem(id);
      row.systemName = sys?.name ?? `#${id}`;
      row.systemSec = sys?.sec ?? null;
      recordDockState(charId, location.data.station_id !== undefined || location.data.structure_id !== undefined);
    }
    row.shipTypeId = ship.data.ship_type_id;
    row.shipTypeName = typeName(ship.data.ship_type_id);
    row.online = online?.data.online ?? false;
    const shipName = decodeEsiName(ship.data.ship_name);
    row.shipName = shipName;
    // a CUSTOM pod name, only while the pilot is actually in the pod
    row.podName =
      ship.data.ship_type_id === CAPSULE_TYPE_ID && !isAutoShipName(shipName, name)
        ? shipName
        : null;
  } catch {
    // an expired session must show as such, not as an empty ship
    row.error = 'session expired — re-login';
  }
  return row;
}

/** a hung request must never freeze the feed: without this, one request
 * that never settles leaves `inflight` true and the overlay stops updating
 * for the rest of the session */
function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}


export interface OverlayNotice {
  kind: 'api-down' | 'sso' | 'ratelimit';
  text: string;
}

// The raidable feed + distances are recomputed at most this often — the ESI
// feed is server-cached anyway, and the overlay tick runs every 6s.
const RAID_ALERT_MS = 180_000;
let raidCache: { at: number; alerts: RaidAlert[] } = { at: 0, alerts: [] };

/**
 * The theft map + settings, read FRESH from localStorage rather than this
 * window's zustand store. With pop-out windows (v0.128) each window holds its
 * OWN copy of the store, and zustand never re-reads localStorage — so a map
 * refreshed in a pop-out Theft window left the MAIN window's in-memory copy
 * stale, and the overlay alert measured jumps from YESTERDAY'S chain (his
 * "alert says 0j, table says 3j" report). localStorage is shared and always
 * current, whichever window last imported.
 */
function freshTheftState(): { map: number[]; raidAlert: boolean; radius: number; openOnly: boolean; importedAt: number } {
  const st = useApp.getState();
  let map = st.theftMapSystems;
  let raidAlert = st.settings.raidAlert !== false;
  let radius = st.settings.raidAlertJumps ?? 3;
  let openOnly = st.theftOpenNow === true;
  let importedAt = st.theftMapImportedAt ?? 0;
  try {
    const raw = JSON.parse(localStorage.getItem('eve-trade-conductor') ?? '') as {
      state?: { theftMapSystems?: number[]; theftOpenNow?: boolean; theftMapImportedAt?: number | null; settings?: { raidAlert?: boolean; raidAlertJumps?: number } };
    };
    if (Array.isArray(raw.state?.theftMapSystems)) map = raw.state.theftMapSystems;
    if (raw.state?.settings) {
      raidAlert = raw.state.settings.raidAlert !== false;
      radius = raw.state.settings.raidAlertJumps ?? radius;
    }
    if (typeof raw.state?.theftOpenNow === 'boolean') openOnly = raw.state.theftOpenNow;
    if (typeof raw.state?.theftMapImportedAt === 'number') importedAt = raw.state.theftMapImportedAt;
  } catch { /* fall back to the in-memory store */ }
  return { map: map ?? [], raidAlert, radius: Math.max(0, Math.min(10, radius)), openOnly, importedAt };
}

// BACKGROUND MAP REFRESH (user rule): with the raid alert on, the distance
// origin must stay fresh WITHOUT ever opening the Theft Conductor — the alert
// is only as good as the map, and his chain changes daily. Pull the Aperture
// systems in a hidden window (same authenticated session the Aperture module
// uses) whenever the imported map is older than this. Silent: a failed pull
// (not logged in, map unreachable) keeps the old map and retries next cycle.
const MAP_REFRESH_MS = 30 * 60_000;
let mapPullBusy = false;
let lastMapPullAt = 0;

async function refreshMapFromAperture(): Promise<void> {
  if (mapPullBusy) return;
  const fn = window.appInfo?.aperture?.systems;
  const url = (useApp.getState().settings.apertureUrl ?? '').trim();
  if (!fn || !url) return;
  // don't hammer a failing pull — at most one attempt per refresh interval
  if (Date.now() - lastMapPullAt < MAP_REFRESH_MS) return;
  mapPullBusy = true;
  lastMapPullAt = Date.now();
  try {
    const text = await fn(url);
    if (!text || !text.trim()) return;
    const r = parseSystemList(text);
    if (r.systemIds.length > 0) useApp.getState().setTheftMapSystems(r.systemIds);
  } catch {
    /* keep the old map; retry next cycle */
  } finally {
    mapPullBusy = false;
  }
}

/** nearby raidable skyhooks, using the imported Theft map as the distance
 * origin. Empty when the feature is off, no map is imported, or none are near. */
async function computeRaidAlerts(): Promise<RaidAlert[]> {
  const { map, raidAlert, radius, openOnly } = freshTheftState();
  if (!raidAlert || map.length === 0) return [];
  const reach = reachFrom(map, radius);
  const feed = await fetchRaidableSkyhooks();
  const near = feed.filter((s) => (reach.get(s.systemId)?.jumps ?? 99) <= radius);
  if (near.length === 0) return [];
  const [hist, planets] = await Promise.all([
    raidHistory().catch(() => ({ byPlanet: new Map() })),
    planetInfo(near.map((s) => s.planetId)).catch(() => new Map()),
  ]);
  return buildRaidAlerts(near, reach, radius, Date.now(), {
    systemName: (id) => getSystem(id)?.name ?? `#${id}`,
    planetType: (pid) => planets.get(pid)?.type ?? null,
    lastRaidMs: (pid) => {
      const s = hist.byPlanet.get(pid);
      return s ? Math.max(s.lastRaidedMs ?? 0, s.lastMineMs ?? 0) : 0;
    },
  }, openOnly);
}

/** when the whole batch fails, tell WHY: hit ESI's public /status/ (no auth)
 * to separate "EVE API is down" from "your tokens couldn't refresh (SSO)". */
async function diagnoseOutage(): Promise<OverlayNotice> {
  try {
    const r = await fetch('https://esi.evetech.net/latest/status/?datasource=tranquility', {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      return { kind: 'api-down', text: r.status >= 500
        ? `EVE API is having problems (ESI returned ${r.status}). Nothing you did — this usually clears on its own.`
        : `EVE API returned ${r.status}. If this persists, check the EVE status page.` };
    }
    const st = await r.json() as { players?: number; vip?: boolean };
    if (st.vip) return { kind: 'api-down', text: 'Tranquility is in VIP mode (CCP maintenance) — normal API access is restricted right now.' };
    // ESI is fine, yet every character failed to refresh → the SSO login
    // service is the likely culprit, not you
    return { kind: 'sso', text: 'EVE’s login service (SSO) could not refresh your sessions, though the game API is up. This usually fixes itself in a few minutes — only re-login if it sticks.' };
  } catch {
    return { kind: 'api-down', text: 'Cannot reach EVE’s API at all — it may be down, or your connection dropped. Nothing you did.' };
  }
}

async function tick(): Promise<void> {
  if (inflight) return;
  inflight = true;
  try {
    const chars = useAuth.getState().characters;
    // every clone seen this poll, sent to the registry in ONE batch —
    // per-character sends would rebroadcast to three windows a dozen times
    const obs: CloneObservation[] = [];
    // PER-CHARACTER timeout (v0.146): one wedged read (a hung token refresh
    // was the culprit) used to trip the GLOBAL timeout, whose "keep the last
    // good push" froze EVERY box on stale data — the reshipped character sat
    // "stuck on the wrong ship" while idle ones still looked right. Now a slow
    // character degrades to an honest error row and the rest keep flowing.
    const timedOutRow = (c: { characterId: number; characterName: string }): OverlayChar => ({
      characterId: c.characterId, characterName: c.characterName,
      shipTypeId: null, shipName: null, shipTypeName: null, podName: null,
      online: false, at: Date.now(), error: 'read timed out — retrying',
    });
    const rows = await withTimeout(
      Promise.all(chars.map((c) =>
        withTimeout(readOne(c.characterId, c.characterName, obs), 15_000, timedOutRow(c)))),
      25_000,
      [],
    );
    recordClones(obs);
    if (rows.length === 0 && chars.length > 0) return; // catastrophic only — per-char rows normally survive

    // GLOBAL NOTICE: an error that hits EVERY character at once is almost
    // never four expired tokens — it is ESI or SSO. Diagnose it, and relabel
    // the per-box text so it stops telling the user to re-login when it is
    // not their fault.
    let notice: OverlayNotice | null = null;
    const errored = rows.filter((r) => r.error !== undefined);
    const es = esiErrorState();
    if (es.blockedUntil) {
      notice = { kind: 'ratelimit', text: `${es.reason ?? 'ESI is throttling requests'} — the overlay resumes automatically.` };
    } else if (chars.length >= 2 && errored.length === chars.length) {
      notice = await diagnoseOutage();
    }
    if (notice && notice.kind !== 'sso') {
      // an API outage / rate block: none of these are "session expired"
      for (const r of rows) if (r.error !== undefined) r.error = 'waiting on EVE API…';
    }

    // nearby raidable skyhooks — refreshed on its own slower cadence, but
    // pushed with every poll so the box tracks the char boxes
    if (Date.now() - raidCache.at > RAID_ALERT_MS) {
      // keep the DISTANCE ORIGIN fresh without the Theft tab ever opening:
      // fire-and-forget so a slow hidden-window pull never stalls the feed —
      // the next recompute picks up whatever it imported
      const fresh = freshTheftState();
      if (fresh.raidAlert && Date.now() - fresh.importedAt > MAP_REFRESH_MS) {
        void refreshMapFromAperture();
      }
      raidCache = { at: Date.now(), alerts: await computeRaidAlerts().catch(() => []) };
    }

    lastRows = rows;
    push(rows, notice, raidCache.alerts);
  } finally {
    inflight = false;
  }
}

/** ONLY characters actually logged into the game get a box (user rule).
 * Session problems still surface — an unreadable character is a thing the
 * user needs to see, not something to hide as "offline". */
export interface PiOverlayAlert {
  charName: string;
  planetName: string;
  text: string;
  /** 0 = losing output NOW, 1 = producing nothing, 2 = fills soon */
  sev: number;
}

/** urgent PI states for the overlay notice box (rank ≤2 = actual money
 * being lost or about to be), worst first, capped so the box stays a
 * glance not a report */
function piOverlayAlerts(): PiOverlayAlert[] {
  // read FRESH from the persisted store, not this window's copy — the
  // toggle lives in the config WINDOW, whose patch this window would not
  // see until reload (the same cross-window rule freshTheftState follows)
  let enabled = useApp.getState().alerts.piOverlay !== false;
  try {
    const raw = JSON.parse(localStorage.getItem('eve-trade-conductor') ?? '{}') as
      { state?: { alerts?: { piOverlay?: boolean } } };
    if (raw.state?.alerts) enabled = raw.state.alerts.piOverlay !== false;
  } catch { /* fall back to the in-memory copy */ }
  if (!enabled) return [];
  return piPlanets()
    .filter((p) => p.rank <= 2)
    .slice(0, 4)
    .map((p) => ({
      charName: p.characterName,
      planetName: p.planetName,
      text: p.problem === 'storage-full' ? 'FULL — losing output'
        : p.problem === 'extractor-expired' ? 'producing nothing'
          : p.hoursToFull !== null ? `fills in ~${Math.max(1, Math.round(p.hoursToFull))}h` : 'nearly full',
      sev: p.rank,
    }));
}

function push(rows: OverlayChar[], notice: OverlayNotice | null = null, raids: RaidAlert[] = raidCache.alerts): void {
  window.appInfo?.overlay?.push({
    chars: rows.filter((r) => r.online || r.error !== undefined),
    notice,
    pi: piOverlayAlerts(),
    raids,
  });
}

let lastRows: OverlayChar[] = [];

/**
 * Re-decorate the last poll from the registry and push again. Saving a name
 * or an alert must show up AT ONCE — waiting for the next poll would be up
 * to 6s, and re-polling ESI on every keystroke would be dozens of pointless
 * requests. Nothing here touches the network.
 */
function repaintFromRegistry(): void {
  if (lastRows.length === 0) return;
  lastRows = lastRows.map((r) => {
    // ONLY a row whose implants were actually read on the poll that produced
    // it may be re-decorated. cloneLabel is assigned solely inside
    // `if (implants)`, so its absence marks a failed live read — painting a
    // name or an ALERT from the last good read would be stale memory
    // outranking live truth, which is precisely the bug that pinned
    // "Capsule - <name>" on every box.
    if (r.error !== undefined || r.cloneLabel === undefined) return r;
    const ids = wornImplants.get(r.characterId);
    if (!ids) return r;
    const rec = lookupClone(r.characterId, ids);
    return {
      ...r,
      cloneName: cloneDisplayName(rec) ?? undefined,
      cloneIsCustom: Boolean(rec?.customName?.trim()),
      alert: rec?.alert ?? null,
    };
  });
  push(lastRows);
}

/** what each character is wearing right now, so a registry edit can be
 * applied without asking ESI again */
const wornImplants = new Map<number, number[]>();

export function startOverlayFeed(): void {
  if (timer !== null) return;
  // the registry must be mirrored BEFORE the first push, or that push would
  // carry no custom names and no alerts and the boxes would flash the wrong
  // identity for a poll
  void initCloneRegistry().then(() => {
    if (!registryHooked) {
      registryHooked = true;
      // skip the initial call — the tick below already paints it
      let first = true;
      onCloneRegistry(() => {
        if (first) { first = false; return; }
        repaintFromRegistry();
      });
    }
    return tick();
  });
  timer = setInterval(() => void tick(), OVERLAY_POLL_MS);
}

let registryHooked = false;

export function stopOverlayFeed(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
