// EVE THEFT CONDUCTOR — raid-target intelligence.
//
// GROUND TRUTH: CCP publishes a PUBLIC rolling list of skyhooks that are
// currently raidable or about to be (GET /skyhooks/raidable, no auth), plus
// per-system sovereignty claims (GET /sovereignty/systems). Both need the
// Equinox-era compatibility date, so they are called on the un-versioned
// host with an X-Compatibility-Date header rather than through /latest.
//
// HONESTY: there is NO ESS endpoint in ESI — no route exposes Encounter
// Surveillance System banks or their contents. Anything this module said
// about ESS payouts would be invented, so it says nothing: ESS targets are
// listed by SYSTEM eligibility (CCP: an ESS in every sovereign nullsec
// system EXCLUDING NPC-held ones — see NO_ESS_REGIONS + faction-claim gate)
// and the module is explicit that bank contents are unknown until you're
// in system.
import { getSystem, regionName, findSystem, type ReachInfo } from './mapdata';
import { esiFetch } from './esiRate';

const ESI_HOST = 'https://esi.evetech.net';
const COMPAT_DATE = '2026-05-19'; // Equinox routes (skyhooks/raidable, sovereignty/systems)

export interface RaidableSkyhook {
  planetId: number;
  systemId: number;
  /** theft window (ms epoch) — the ONLY window the silo can be raided */
  startMs: number;
  endMs: number;
}

export interface SovClaim {
  systemId: number;
  allianceId?: number;
  corporationId?: number;
  factionId?: number;
}

/**
 * These routes live on the bare ESI host rather than ESI_BASE, which is how
 * they escaped the sweep that routed every other call through esiFetch. They
 * are still ESI: they spend from the same shared 100-errors-per-60s budget,
 * and CCP's daily downtime makes them 5xx like anything else. The raid
 * watcher is an unattended collector, so it rides the background lane and
 * yields to the overlay and to whatever is on screen.
 */
async function esiPublic<T>(path: string): Promise<T> {
  const res = await esiFetch(`${ESI_HOST}${path}`, {
    headers: { Accept: 'application/json', 'X-Compatibility-Date': COMPAT_DATE },
  }, { lane: 'background' });
  if (!res.ok) throw new Error(`ESI ${res.status} on ${path}`);
  return (await res.json()) as T;
}

interface RawSkyhooks {
  skyhooks: {
    planet_id: number;
    solar_system_id: number;
    theft_vulnerability: { start: string; end: string };
  }[];
}

/** every skyhook CCP currently reports as raidable or about to be */
/**
 * The raidable feed WITH its server clock. MEASURED 2026-08-30: the
 * endpoint is cached `max-age=300` — everyone on earth sees the same
 * 5-minute snapshot, so Last-Modified (when CCP generated it) is the
 * honest observation time, not our fetch time; the raid watcher's
 * classifications shifted by up to 5 minutes without it.
 */
export async function fetchRaidableSkyhooksMeta(): Promise<{
  list: RaidableSkyhook[];
  /** ms epoch of the server snapshot; null if the header is missing */
  lastModifiedMs: number | null;
}> {
  const res = await esiFetch(`${ESI_HOST}/skyhooks/raidable`, {
    headers: { Accept: 'application/json', 'X-Compatibility-Date': COMPAT_DATE },
  }, { lane: 'background' });
  if (!res.ok) throw new Error(`ESI ${res.status} on /skyhooks/raidable`);
  const lm = res.headers.get('last-modified');
  const parsed = lm ? Date.parse(lm) : NaN;
  const d = (await res.json()) as RawSkyhooks;
  return {
    list: d.skyhooks.map((s) => ({
      planetId: s.planet_id,
      systemId: s.solar_system_id,
      startMs: Date.parse(s.theft_vulnerability.start),
      endMs: Date.parse(s.theft_vulnerability.end),
    })),
    lastModifiedMs: Number.isFinite(parsed) ? parsed : null,
  };
}

export async function fetchRaidableSkyhooks(): Promise<RaidableSkyhook[]> {
  return (await fetchRaidableSkyhooksMeta()).list;
}

interface RawSov {
  solar_systems: {
    solar_system_id: number;
    claim?: {
      alliance?: { alliance_id: number };
      corporation?: { corporation_id: number };
      faction?: { faction_id: number };
    };
  }[];
}

/** who holds each claimable system (alliance / corp / NPC faction) */
export async function fetchSovClaims(): Promise<Map<number, SovClaim>> {
  const d = await esiPublic<RawSov>('/sovereignty/systems');
  const out = new Map<number, SovClaim>();
  for (const s of d.solar_systems) {
    out.set(s.solar_system_id, {
      systemId: s.solar_system_id,
      allianceId: s.claim?.alliance?.alliance_id,
      corporationId: s.claim?.corporation?.corporation_id,
      factionId: s.claim?.faction?.faction_id,
    });
  }
  return out;
}

export type WindowState = 'open' | 'soon' | 'later';

export interface SkyhookTarget extends RaidableSkyhook {
  systemName: string;
  regionName: string;
  /** display security of the system (bundled map data) */
  sec: number;
  /** stargate jumps to the nearest reach centre; null = not reachable/no centre */
  jumps: number | null;
  /** the reach centre the jumps count from (a mapped system's name) */
  viaName?: string;
  state: WindowState;
  /** ms until the window opens (0 when already open) */
  opensInMs: number;
  /** ms until the window closes (only meaningful while open) */
  closesInMs: number;
  claim: SovClaim | undefined;
}

/** PURE: turn the raw feed into ranked targets.
 * reach = precomputed distances (single centre, or multi-source from the
 * user's imported map — jumps then mean "from the NEAREST mapped k-space
 * system", with viaId naming it). null reach = no distance filtering.
 * ignoreRadius = keep everything; jumps still fill in where computable. */
export function rankSkyhookTargets(
  raw: RaidableSkyhook[],
  claims: Map<number, SovClaim>,
  reach: Map<number, ReachInfo> | null,
  nowMs: number,
  ignoreRadius = false,
): SkyhookTarget[] {
  const out: SkyhookTarget[] = [];
  for (const s of raw) {
    const sys = getSystem(s.systemId);
    const r = reach?.get(s.systemId);
    if (!ignoreRadius && reach && !r) continue; // outside the searched range
    const opensInMs = Math.max(0, s.startMs - nowMs);
    const closesInMs = Math.max(0, s.endMs - nowMs);
    if (closesInMs === 0) continue; // window already gone
    const state: WindowState = opensInMs === 0 ? 'open' : opensInMs <= 3_600_000 ? 'soon' : 'later';
    out.push({
      ...s,
      systemName: sys?.name ?? `System ${s.systemId}`,
      regionName: sys ? regionName(sys.regionId) : '—',
      sec: sys?.sec ?? 0,
      jumps: r?.jumps ?? null,
      viaName: r ? getSystem(r.viaId)?.name : undefined,
      state,
      opensInMs,
      closesInMs,
      claim: claims.get(s.systemId),
    });
  }
  // open windows first (closing soonest = most urgent), then by when they open,
  // then by distance when a centre is set
  const rank = (t: SkyhookTarget) => (t.state === 'open' ? 0 : 1);
  return out.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.state === 'open' ? a.closesInMs - b.closesInMs : a.opensInMs - b.opensInMs) ||
      (a.jumps ?? 99) - (b.jumps ?? 99),
  );
}

export interface SystemActivity {
  npcKills: number;
  shipKills: number;
  podKills: number;
}

/** public hourly kill stats — npc_kills is RATTING, which is exactly what
 * fills an ESS bank; ship/pod kills are the danger signal */
export async function fetchSystemActivity(): Promise<Map<number, SystemActivity>> {
  const rows = await esiPublic<
    { system_id: number; npc_kills: number; ship_kills: number; pod_kills: number }[]
  >('/universe/system_kills');
  const out = new Map<number, SystemActivity>();
  for (const r of rows) {
    out.set(r.system_id, { npcKills: r.npc_kills, shipKills: r.ship_kills, podKills: r.pod_kills });
  }
  return out;
}

export interface EssSystem {
  systemId: number;
  systemName: string;
  regionName: string;
  sec: number;
  /** stargate jumps to the nearest reach centre; null = no centre / unreachable */
  jumps: number | null;
  /** the reach centre the jumps count from (a mapped system's name) */
  viaName?: string;
  claim: SovClaim | undefined;
  /** last hour, from CCP's public stats (undefined = no activity reported) */
  activity: SystemActivity | undefined;
}

/** Regions whose nullsec-security systems have NO ESS: Triglavian Pochven,
 * the three Jove regions, and Zarzakh (Yasna Zakh). Ids verified against the
 * bundled mapdata 2026-07-26. */
const NO_ESS_REGIONS = new Set([10000070, 10000004, 10000017, 10000019, 10001000]);

/**
 * Systems within range that HAVE an ESS to rob. CCP's rule (Dynamic
 * Frontiers): a permanent ESS sits in every SOVEREIGN nullsec system,
 * EXCLUDING NPC-held ones — so eligibility is sov-capable nullsec (claimed
 * or currently unclaimed; the structure is permanent), never NPC-faction
 * null (Venal, Stain, …), never Pochven/Jove/Zarzakh. The bank's contents
 * are NOT knowable from ESI — this lists WHERE to look, never how much.
 * reach = precomputed distances (single centre or multi-source from the
 * imported map). ignoreRadius = list EVERY eligible system regardless of
 * distance; jumps still fill in where computable.
 */
export function essSystemsNear(
  reach: Map<number, ReachInfo> | null,
  claims: Map<number, SovClaim>,
  activity: Map<number, SystemActivity> = new Map(),
  ignoreRadius = false,
): EssSystem[] {
  const candidateIds = ignoreRadius ? [...claims.keys()] : [...(reach?.keys() ?? [])];
  const out: EssSystem[] = [];
  for (const systemId of candidateIds) {
    const sys = getSystem(systemId);
    if (!sys || sys.sec > 0.0) continue; // ESS exists in nullsec only
    if (NO_ESS_REGIONS.has(sys.regionId)) continue; // Pochven/Jove/Zarzakh: no ESS
    const claim = claims.get(systemId);
    // NPC-held nullsec has NO ESS (CCP: "excluding NPC-held ones"). The sov
    // feed marks those with a faction claim; player sov = alliance/corp;
    // unclaimed sov-capable systems keep their permanent ESS and stay listed.
    if (claim?.factionId) continue;
    const r = reach?.get(systemId);
    out.push({
      systemId,
      systemName: sys.name,
      regionName: regionName(sys.regionId),
      sec: sys.sec,
      jumps: r?.jumps ?? null,
      viaName: r ? getSystem(r.viaId)?.name : undefined,
      claim,
      activity: activity.get(systemId),
    });
  }
  // busiest ratting first — that is the bank filling fastest — then distance
  return out.sort(
    (a, b) =>
      (b.activity?.npcKills ?? 0) - (a.activity?.npcKills ?? 0) ||
      (a.jumps ?? 9999) - (b.jumps ?? 9999) ||
      a.systemName.localeCompare(b.systemName),
  );
}

// ---- Aperture (corp map) system import ----
// The corp's mapping tool runs in a browser and has no public API we can
// rely on. Instead of scraping someone else's private app, the module takes
// a PASTE: any text containing system names (a copied map list, a route, a
// spreadsheet column). We resolve names against the bundled map and keep
// what matches — no assumptions about Aperture's internals, and it works
// with whatever export/copy the tool allows.

export interface ApertureImport {
  systemIds: number[];
  matched: string[];
  unmatched: string[];
  /** J-code systems seen in the paste — no stargates, no skyhooks/ESS */
  wormholes: string[];
}

/**
 * Parse pasted text into known system ids. Handles BOTH shapes the user's
 * corp map (Aperture) produces:
 *   · the table copy — "60M-TG\tQuerious / YB7B-8\t0.0\tunknown\t—"
 *   · a plain list — one name per line, or comma separated
 * The FIRST field of each line is the candidate; header rows and page chrome
 * simply fail to resolve. Nullsec names start with digits ("60M-TG"), so
 * bullet/numbering is only stripped when the raw name does not resolve.
 * W-space (J-code) systems are reported separately: they have no stargates
 * and no skyhooks/ESS, so they are irrelevant to raiding rather than "bad".
 */
export function parseSystemList(text: string): ApertureImport {
  const seen = new Set<number>();
  const matched: string[] = [];
  const unmatched: string[] = [];
  const wormholes: string[] = [];
  const tryNames = (raw: string): boolean => {
    const base = raw.trim();
    if (base.length < 3) return true; // ignore fragments silently
    const candidates = [
      base,
      base.replace(/\s*\(.*$/, '').trim(), // "J123456 (Home)" → "J123456"
      base.replace(/^[-*•\s]+/, '').replace(/^\d+[.)]\s+/, '').trim(), // "1. Jita" → "Jita"
      base.replace(/^[-*•\s]+/, '').replace(/^\d+[.)]\s+/, '').replace(/\s*\(.*$/, '').trim(), // "1. Jita (0.9)"
    ];
    for (const c of candidates) {
      const sys = findSystem(c);
      if (sys) {
        if (!seen.has(sys.id)) {
          seen.add(sys.id);
          matched.push(sys.name);
        }
        return true;
      }
      if (/^J\d{6}$/i.test(c)) {
        wormholes.push(c.toUpperCase());
        return true;
      }
    }
    return false;
  };
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    // table row: the system is the first tab (or 2+ space) separated field
    const first = line.split(/\t|\s{2,}/)[0];
    if (tryNames(first)) continue;
    // plain list line, possibly comma separated
    let any = false;
    for (const part of line.split(/[,;|]/)) {
      if (tryNames(part)) any = true;
    }
    if (!any) unmatched.push(line.trim().slice(0, 40));
  }
  return { systemIds: [...seen], matched, unmatched, wormholes };
}

// ---------------------------------------------------------------------------
// PLANET IDENTITY. The feed names planets only by id, but in game a skyhook
// hangs over "8OYE-Z IV" — and its TYPE is the loot: Equinox skyhooks sit
// only on Lava (magmatic gas) and Ice (superionic ice) planets. Both facts
// are public ESI and PERMANENT, so they are fetched once ever and cached.
// ---------------------------------------------------------------------------

export interface PlanetInfo {
  /** the in-game designation, e.g. "8OYE-Z IV" */
  name: string;
  /** the class, e.g. "Lava", "Ice" — from the type name "Planet (Lava)" */
  type: string;
}

const PLANET_KEY = 'theft-planet-info-v1';
const planetCache = new Map<number, PlanetInfo>();
try {
  const raw = JSON.parse(localStorage.getItem(PLANET_KEY) ?? '{}') as Record<string, PlanetInfo>;
  for (const [id, info] of Object.entries(raw)) {
    if (info && typeof info.name === 'string' && typeof info.type === 'string') {
      planetCache.set(Number(id), info);
    }
  }
} catch { /* cold cache — everything refetches once */ }

/** planet names + classes for the given ids — a small worker pool over the
 * public planet endpoint, then ONE bulk name lookup for the type ids */
export async function planetInfo(ids: number[]): Promise<Map<number, PlanetInfo>> {
  const missing = [...new Set(ids)].filter((id) => id > 0 && !planetCache.has(id));
  if (missing.length > 0) {
    const fetched = new Map<number, { name: string; typeId: number }>();
    const queue = [...missing];
    await Promise.all(Array.from({ length: Math.min(6, queue.length) }, async () => {
      for (;;) {
        const id = queue.shift();
        if (id === undefined) return;
        try {
          const r = await fetch(`https://esi.evetech.net/latest/universe/planets/${id}/`, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000),
          });
          if (!r.ok) continue;
          const p = await r.json() as { name?: string; type_id?: number };
          if (typeof p.name === 'string' && typeof p.type_id === 'number') {
            fetched.set(id, { name: p.name, typeId: p.type_id });
          }
        } catch { /* cosmetic — the id column still identifies it */ }
      }
    }));
    // one lookup for all the planet TYPE names ("Planet (Lava)" -> "Lava")
    const typeIds = [...new Set([...fetched.values()].map((f) => f.typeId))];
    const typeNames = new Map<number, string>();
    try {
      const r = await fetch('https://esi.evetech.net/latest/universe/names/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(typeIds),
        signal: AbortSignal.timeout(10_000),
      });
      if (r.ok) {
        for (const row of await r.json() as { id: number; name: string }[]) {
          typeNames.set(row.id, row.name.replace(/^Planet \((.+)\)$/, '$1'));
        }
      }
    } catch { /* types render as nothing rather than wrong */ }
    for (const [id, f] of fetched) {
      planetCache.set(id, { name: f.name, type: typeNames.get(f.typeId) ?? '' });
    }
    try {
      localStorage.setItem(PLANET_KEY, JSON.stringify(Object.fromEntries(planetCache)));
    } catch { /* cache is a nicety */ }
  }
  return planetCache;
}

/** public hourly TRAFFIC — stargate ship jumps per system. The witness and
 * competition signal: a survives-with-zero-everything skyhook sits in empty
 * space (uncontested), while survives-with-locals means it is defended. */
export async function fetchSystemJumps(): Promise<Map<number, number>> {
  const rows = await esiPublic<{ system_id: number; ship_jumps: number }[]>('/universe/system_jumps');
  const out = new Map<number, number>();
  for (const r of rows) out.set(r.system_id, r.ship_jumps);
  return out;
}

// ---------------------------------------------------------------------------
// SYSTEM EFFECTS. What ESI actually publishes: INCURSIONS (official, live,
// with the infested system list). What it does NOT publish: metaliminal
// storm locations — the community asked (esi-issues #1224) and CCP never
// shipped it; the only tracker is player-reported (EvE-Scout Rescue). The
// module links the tracker and claims nothing it cannot verify.
// ---------------------------------------------------------------------------

export interface IncursionMark {
  /** this system is the incursion staging system */
  staging: boolean;
  /** Sansha influence 0..1 — penalties scale DOWN as influence falls */
  influence: number;
  state: string;
}

/** every system currently inside an incursion constellation */
export async function fetchIncursions(): Promise<Map<number, IncursionMark>> {
  const rows = await esiPublic<{
    staging_solar_system_id: number;
    infested_solar_systems: number[];
    influence: number;
    state: string;
  }[]>('/incursions');
  const out = new Map<number, IncursionMark>();
  for (const inc of rows) {
    for (const sys of inc.infested_solar_systems) {
      out.set(sys, {
        staging: sys === inc.staging_solar_system_id,
        influence: inc.influence,
        state: inc.state,
      });
    }
  }
  return out;
}
