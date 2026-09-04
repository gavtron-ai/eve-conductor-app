// MAKE A BATTLE REPORT — the zkill walk, automated.
//
// The manual flow this replaces: open the corp on zKillboard, scroll to the
// FIRST kill of the most recent fight (fights are time-clustered chunks with
// dead air between them), open that kill, click "related", click the
// br.evetools.org link, paste the result into game chat. Every step of that
// is derivable: zKillboard's API lists the corp's recent kills and losses,
// ESI gives each killmail's time and solar system, the newest fight is the
// newest time-cluster, and the br link is just
//   https://br.evetools.org/related/{systemID}/{YYYYMMDDHH00}
// — the first kill's system and its UTC hour bucket, exactly what zkill's
// own "related" page links to.
//
// MULTI-SYSTEM FIGHTS (v0.99.1): a related URL can only name ONE system, so
// a fight that rolls across systems loses every kill outside the first one
// (a real fight spanning J170127 + J151045 rendered as "Team B (1)"). For
// those, use br.evetools' own saved-report API — captured by instrumenting
// the site's XHR while clicking "Create new BR":
//   POST /newapi/br/analyze        {"timings":[{"systemID":"...","start":s,"end":s}, ...]}
//   POST /newapi/old/br/create-new {"timings":[...],"teams":[["allyOrCorpId",...],[...]]}
// start/end are epoch SECONDS, systemID a STRING, team members are alliance
// ids (or corporation ids for unallied entities) as strings; create-new
// answers {"_id":"..."} and the report lives at br.evetools.org/br/{_id}.
import { ESI_BASE } from './constants';

/** chunks separated by more than this are DIFFERENT fights — declared from
 * the owner's own description ("chunks of time ... with space in between") */
export const FIGHT_GAP_MINUTES = 40;

/** how many recent killmails to hydrate from ESI — a fight bigger than this
 * still resolves (the walk only needs to reach the fight's first kill) */
const HYDRATE_LIMIT = 60;

interface ZkbEntry {
  killmail_id: number;
  zkb: { hash: string; totalValue?: number };
}

/** victim/attacker as public ESI killmails carry them */
interface EsiParticipant {
  alliance_id?: number; corporation_id?: number; character_id?: number; ship_type_id?: number;
  damage_done?: number; damage_taken?: number; final_blow?: boolean;
}
interface EsiKillmail {
  killmail_time: string;
  solar_system_id: number;
  victim: EsiParticipant;
  attackers: EsiParticipant[];
}

export interface BattleReportResult {
  url: string;
  systemId: number;
  /** every system the fight touched, joined for display ("J170127 + J151045") */
  systemName: string | null;
  /** the fight's first and last corp killmail times */
  startedAt: string;
  endedAt: string;
  /** corp kills + losses inside the fight window (of those hydrated) */
  kills: number;
  /** set when the honest link could not cover the whole fight */
  caveat?: string;
  /** what to hand fetchFightData when the write-up is wanted */
  window: FightWindow;
  /** the corp's own killmails of the fight, fully hydrated from zkill+ESI —
   * the summary's fallback when br.evetools has not ingested the fight yet
   * (measured: their feed can run HOURS behind zkill) */
  corpKms: BrKm[];
  /** zKillboard's related page for the fight's first system — rendered from
   * the SAME database whose API had the kills the moment they happened, so
   * it is the link that works while br.evetools is still catching up */
  liveUrl: string;
  /** WarBeacon's battle report for the same bucket — measured LIVE seconds
   * after a fight ended (teams, ISK, composition, kill feed), and a far
   * nicer chat link than a raw related page while br.evetools lags */
  warbeaconUrl: string;
}

/**
 * EVERY call here is bounded. Browser fetch has no overall deadline: a
 * server that accepts the connection and then goes quiet leaves the promise
 * pending forever, and this chain sits in front of the LINK — the thing the
 * user actually clicked for. A timeout turns "hangs until the app is
 * restarted" into "falls back and says why".
 */
const NET_TIMEOUT_MS = 15_000;

async function getJson<T>(url: string, opts?: { noStore?: boolean }): Promise<T> {
  const r = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    // the zkill FEEDS are volatile truth — an HTTP-cached copy is exactly
    // the "stale most-recent fight" bug (seen: a relaunch 10s after a
    // correct answer reported the previous fight). Killmails themselves
    // are immutable and stay cacheable.
    ...(opts?.noStore ? { cache: 'no-store' as RequestCache } : {}),
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(NET_TIMEOUT_MS),
  });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.json() as Promise<T>;
}

/** window padding around the fight when asking br.evetools for its kills —
 * must stay under half of FIGHT_GAP_MINUTES so a neighbouring fight in the
 * same system cannot bleed in */
const BR_WINDOW_PAD_MINUTES = 15;

export interface BrParticipant {
  ally: number; corp: number; char: number; ship: number;
  /** damage dealt (attacker rows) or taken (victim rows) — br.evetools'
   * analyze kms carry it as `dmg` natively; ESI maps damage_done/taken */
  dmg?: number;
  /** landed the final blow — known on ESI-hydrated mails; analyze kms
   * don't mark it, so it can be absent */
  fb?: boolean;
}
/** one killmail as br.evetools' analyze endpoint returns it (time in ms) */
export interface BrKm {
  id: number;
  time: number;
  system: number;
  victim: BrParticipant & { lossValue: number };
  attackers: BrParticipant[];
}
interface BrAnalyze {
  relateds: { systemID: number; kms: BrKm[] }[];
}
export type BrTiming = { systemID: string; start: number; end: number };

/** everything the fight write-up needs, straight from the killmails */
export interface FightData {
  kms: BrKm[];
  /** [my side, their side] as entity ids */
  teams: [number[], number[]];
  myEntity: number;
  /** true when built from the CORP'S OWN killmails only (the zkill/ESI
   * fallback) — other groups' losses may be missing and the write-up must
   * say so */
  partial?: boolean;
}

/** what the fight covers — the analyze windows plus the TRUE span of the
 * corp's own killmails, which is narrower than the padded windows and is
 * what the write-up must be measured over */
export interface FightWindow {
  timings: BrTiming[];
  corpId: number;
  startMs: number;
  endMs: number;
}

/** an entity on a battle report is the alliance, or the corporation when
 * unallied — exactly how br.evetools' own kms encode participants */
export const entityOf = (p: BrParticipant): number => (p.ally || p.corp || 0);

/** a public ESI killmail in br.evetools' km shape — so the whole digest
 * pipeline (teams, phases, losses) runs identically on either source.
 * lossValue comes from zkill's zkb.totalValue (ESI carries no ISK). */
export const esiKmToBr = (id: number, km: EsiKillmail, totalValue: number): BrKm => {
  const part = (p: EsiParticipant): BrParticipant => ({
    ally: p.alliance_id ?? 0,
    corp: p.corporation_id ?? 0,
    char: p.character_id ?? 0,
    ship: p.ship_type_id ?? 0,
    dmg: p.damage_done ?? p.damage_taken ?? 0,
    ...(p.final_blow !== undefined ? { fb: p.final_blow } : {}),
  });
  return {
    id,
    time: new Date(km.killmail_time).getTime(),
    system: km.solar_system_id,
    victim: { ...part(km.victim), lossValue: totalValue || 0 },
    attackers: (km.attackers ?? []).map(part),
  };
};

const fightTimings = (systems: number[], startMs: number, endMs: number): BrTiming[] => {
  const padMs = BR_WINDOW_PAD_MINUTES * 60_000;
  return systems.map((s) => ({
    systemID: String(s),
    start: Math.floor((startMs - padMs) / 1000),
    end: Math.floor((endMs + padMs) / 1000),
  }));
};

/** every killmail br.evetools sees in the fight window, chronological */
async function analyzeFight(timings: BrTiming[]): Promise<BrKm[]> {
  const analyzed = await postJson<BrAnalyze>(
    'https://br.evetools.org/newapi/br/analyze', { timings },
  );
  return analyzed.relateds
    .flatMap((r) => r.kms.map((km) => ({ ...km, system: km.system || r.systemID })))
    .sort((a, b) => a.time - b.time);
}

/** the attackers that represent PLAYERS — br.evetools zeroes NPC rows
 * (ally 0 / corp 0 / char 0), but a named NPC corp whoring a mail would
 * otherwise be counted as a combatant group */
const playersOf = (ps: BrParticipant[]): BrParticipant[] => ps.filter((p) => p.char);

/**
 * Teams, derived from the killmails themselves.
 *
 * WEIGHT OF EVIDENCE, NOT A SINGLE MAIL (v0.100.0). The first cut of this
 * assigned a side from any one killmail, which meant one accident flipped a
 * whole group: a fleet-mate killed by the enemy while OUR smartbomb clipped
 * him puts him on his own killers' team, and from there his corp-mates can
 * cascade the wrong way. EVE is full of those mails — smartbombs, bombs,
 * drone aggro, a stray missile volley.
 *
 * So every entity is SCORED against my own:
 *   friend evidence — killmails where it shoots the same victim I shoot
 *   enemy  evidence — killmails where it shoots me, or where I shoot it
 * and the bigger pile wins (ties go to enemy, so a stranger is never
 * silently absorbed into my fleet). Kill credit on a shared mail is the
 * strongest grouping signal a killboard has: it means the same target in
 * the same seconds.
 *
 * Entities that never touch my side directly are then propagated from that
 * base — co-attackers on a known enemy's loss are friends, attackers on a
 * known friend's loss are enemies — and whatever is still unclassified
 * lands in the enemy column rather than being dropped: misgrouping a
 * bystander is cosmetic, hiding a kill is not.
 */
function deriveTeams(kms: BrKm[], corpId: number): FightData {
  // measured 2026-08-17: a fight on zkill was STILL absent from br.evetools
  // hours later — even their own related page said "No killmails". Their
  // feed runs behind zkill by anywhere from minutes to hours, so say that
  // instead of implying the fight is not real
  if (kms.length === 0) {
    throw new Error('br.evetools has no killmails for this fight yet'
      + ' (their feed can run hours behind zkill — retry later)');
  }

  // my entity: any appearance of the corp on either side of any mail
  let myEntity = 0;
  for (const km of kms) {
    if (km.victim.corp === corpId) myEntity = entityOf(km.victim);
    const mine = km.attackers.find((a) => a.corp === corpId);
    if (mine) myEntity = entityOf(mine);
    if (myEntity) break;
  }
  if (!myEntity) throw new Error('the corporation appears on none of the fight’s killmails');

  // ---- 1. score every entity's direct evidence against mine ----
  const friendPts = new Map<number, number>();
  const enemyPts = new Map<number, number>();
  const bump = (m: Map<number, number>, e: number) => m.set(e, (m.get(e) ?? 0) + 1);
  for (const km of kms) {
    const v = entityOf(km.victim);
    const atk = playersOf(km.attackers).map(entityOf).filter((e) => e && e !== myEntity);
    const iShot = km.attackers.some((a) => entityOf(a) === myEntity);
    // ONE MAIL = ONE UNIT OF EVIDENCE, on both scales (the Set dedupes an
    // entity's multiple pilots on the same mail) — otherwise a fleet-mate
    // whose five pilots landed on one of my losses out-scored his three
    // shared kills, and the count decided the wrong way
    if (iShot && v && v !== myEntity) bump(enemyPts, v); // I shot it
    if (v === myEntity) for (const e of new Set(atk)) bump(enemyPts, e); // it shot me
    if (iShot) for (const e of new Set(atk)) bump(friendPts, e); // we shot together
  }

  const friends = new Set<number>([myEntity]);
  const enemies = new Set<number>();
  for (const e of new Set([...friendPts.keys(), ...enemyPts.keys()])) {
    const f = friendPts.get(e) ?? 0;
    const n = enemyPts.get(e) ?? 0;
    // a shared kill outweighs an equal number of accidents; a tie is not
    // enough to claim someone as an ally
    if (f > n) friends.add(e); else enemies.add(e);
  }

  // ---- 2. propagate to entities with no direct contact, to a fixed point ----
  for (let pass = 0; pass < 4; pass += 1) {
    let changed = false;
    for (const km of kms) {
      const v = entityOf(km.victim);
      const atk = playersOf(km.attackers).map(entityOf).filter(Boolean);
      // fought WITH us against a known enemy
      if (enemies.has(v)) {
        for (const e of atk) {
          if (!enemies.has(e) && !friends.has(e)) { friends.add(e); changed = true; }
        }
      }
      // killed one of ours
      if (friends.has(v)) {
        for (const e of atk) {
          if (!friends.has(e) && !enemies.has(e)) { enemies.add(e); changed = true; }
        }
      }
    }
    if (!changed) break;
  }

  // ---- 3. leftovers are VISIBLE, on the enemy column ----
  for (const km of kms) {
    for (const e of [entityOf(km.victim), ...playersOf(km.attackers).map(entityOf)]) {
      if (e && !friends.has(e) && !enemies.has(e)) enemies.add(e);
    }
  }
  return { kms, teams: [[...friends], [...enemies]], myEntity };
}

/** a SAVED report via br.evetools' own API — the only link form that can
 * carry a fight spanning several systems */
async function createSavedReport(timings: BrTiming[], fd: FightData): Promise<string> {
  const created = await postJson<{ _id: string }>(
    'https://br.evetools.org/newapi/old/br/create-new',
    {
      timings,
      teams: [fd.teams[0].map(String), fd.teams[1].map(String)],
    },
  );
  if (!created._id) throw new Error('br.evetools did not return a report id');
  return `https://br.evetools.org/br/${created._id}`;
}

/** UTC hour bucket the related pages key on: YYYYMMDDHH00 */
const hourBucket = (ms: number): string => {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}00`;
};

/** a logged-in character whose OWN killmails can be read live from ESI */
export interface LiveSource { characterId: number; token: string }

/**
 * The character's own recent killmails, straight from ESI — the
 * AUTHORITATIVE live feed. Measured 2026-08-17: zkill's API (all three
 * endpoint styles) was missing a 30-minute-old loss its own website
 * displayed, so the fight feed cannot rest on zkill alone. A token from
 * before the killmail scope answers 403 — that character contributes
 * nothing until re-login, and must not break the report.
 */
async function esiKillmailList(url: string, token: string): Promise<ZkbEntry[]> {
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    });
    if (!r.ok) return []; // 403 = scope or role missing — contribute nothing
    const rows = await r.json() as { killmail_id: number; killmail_hash: string }[];
    return rows.map((k) => ({ killmail_id: k.killmail_id, zkb: { hash: k.killmail_hash } }));
  } catch {
    return []; // one feed failing must not kill the report
  }
}

const esiOwnKillmails = (src: LiveSource): Promise<ZkbEntry[]> =>
  esiKillmailList(`${ESI_BASE}/characters/${src.characterId}/killmails/recent/`, src.token);

/** the WHOLE corp's killmails, live — ESI grants this only to Directors,
 * so it is attempted with every source and whoever has the role delivers */
const esiCorpKillmails = (corpId: number, src: LiveSource): Promise<ZkbEntry[]> =>
  esiKillmailList(`${ESI_BASE}/corporations/${corpId}/killmails/recent/`, src.token);

/** how many page-only killmails get individual lookups — the page and the
 * API overlap almost entirely, so this is normally 0-3 ids; the cap only
 * bounds a pathological gap */
const PAGE_LOOKUP_CAP = 25;

/**
 * The corp PAGE's killmail ids (extracted by the hidden window in
 * zkillPage.cjs) minus what the API feeds already delivered, each resolved
 * through /api/killID/{id}/ — measured to serve hash + price even for
 * mails the cached list endpoints are still missing.
 */
async function resolvePageOnlyIds(pageIds: number[], have: Set<number>): Promise<ZkbEntry[]> {
  const missing = pageIds.filter((id) => !have.has(id)).slice(0, PAGE_LOOKUP_CAP);
  const rows = await Promise.all(missing.map(async (id) => {
    try {
      const r = await getJson<ZkbEntry[]>(`https://zkillboard.com/api/killID/${id}/`, { noStore: true });
      return r[0] ?? null;
    } catch {
      return null; // one unpriced mail must not kill the report
    }
  }));
  return rows.filter((x): x is ZkbEntry => x !== null);
}

/** one hydrated feed row — the clustering unit */
export interface FeedMail {
  id: number; t: number; system: number; time: string; br: BrKm;
}

/** consecutive mails ≤ gap apart are ONE fight — the owner's own
 * "chunks of time with space in between" rule, exported pure for fixtures.
 * Input must be sorted newest-first; output fights are newest-first, each
 * fight's mails newest-first. */
export function clusterFights<T extends { t: number }>(sortedDesc: T[], gapMs: number): T[][] {
  const fights: T[][] = [];
  let cur: T[] = [];
  for (const m of sortedDesc) {
    if (cur.length > 0 && cur[cur.length - 1].t - m.t > gapMs) {
      fights.push(cur);
      cur = [];
    }
    cur.push(m);
  }
  if (cur.length > 0) fights.push(cur);
  return fights;
}

/** the whole recent history the tab shows — fights clustered from the
 * merged live feed, newest first */
export interface BattleHistory {
  fights: BattleReportResult[];
  newestKillmailId: number;
  liveFeeds: number;
}

/** history depth: the owner asked for the last 3 days of corp fights */
export const HISTORY_DAYS = 3;

export async function makeBattleReports(
  corpId: number, sources: LiveSource[] = [], pageIds: number[] = [],
): Promise<BattleHistory> {
  // kills AND losses — a fight the corp lost still deserves its report —
  // PLUS every logged-in character's own mails live from ESI, PLUS the
  // corp-wide feed through any source holding the Director role
  const [kills, losses, corpFeed, ...own] = await Promise.all([
    getJson<ZkbEntry[]>(`https://zkillboard.com/api/kills/corporationID/${corpId}/`, { noStore: true }),
    getJson<ZkbEntry[]>(`https://zkillboard.com/api/losses/corporationID/${corpId}/`, { noStore: true }),
    (async () => {
      for (const src of sources) {
        const rows = await esiCorpKillmails(corpId, src);
        if (rows.length > 0) return rows; // a Director answered — corp-wide live
      }
      return [] as ZkbEntry[];
    })(),
    ...sources.map(esiOwnKillmails),
  ]);
  const byId = new Map<number, ZkbEntry>();
  for (const e of [...kills, ...losses, ...corpFeed, ...own.flat()]) byId.set(e.killmail_id, e);
  // the PAGE is the live source of truth — ids it has that no feed served
  // are exactly the mails the cached APIs are still missing
  const pageOnly = await resolvePageOnlyIds(pageIds, new Set(byId.keys()));
  for (const e of pageOnly) byId.set(e.killmail_id, e);
  const liveFeeds = own.filter((rows) => rows.length > 0).length
    + (corpFeed.length > 0 ? 1 : 0) + (pageIds.length > 0 ? 1 : 0);
  const entries = [...byId.values()]
    .sort((a, b) => b.killmail_id - a.killmail_id) // ids are chronological
    .slice(0, HYDRATE_LIMIT);
  if (entries.length === 0) {
    throw new Error('zKillboard lists no recent kills or losses for this corporation');
  }
  const detail: FeedMail[] = (await Promise.all(entries.map(async (e) => {
    try {
      const km = await getJson<EsiKillmail>(
        `${ESI_BASE}/killmails/${e.killmail_id}/${e.zkb.hash}/`,
      );
      return {
        id: e.killmail_id,
        t: new Date(km.killmail_time).getTime(),
        system: km.solar_system_id,
        time: km.killmail_time,
        // the FULL killmail, in br shape — the summary's fallback source
        br: esiKmToBr(e.killmail_id, km, e.zkb.totalValue ?? 0),
      };
    } catch {
      return null; // one unfetchable killmail must not kill the report
    }
  }))).filter((x): x is FeedMail => x !== null)
    .sort((a, b) => b.t - a.t);
  if (detail.length === 0) {
    throw new Error('ESI returned no killmail details');
  }

  // EVERY fight in the window, newest first — same gap rule that used to
  // find only the newest one
  const gapMs = FIGHT_GAP_MINUTES * 60_000;
  const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
  const clusters = clusterFights(detail, gapMs)
    .filter((f) => f[0].t >= cutoff);
  if (clusters.length === 0) {
    throw new Error(`no corp fights in the last ${HISTORY_DAYS} days`);
  }

  // one names lookup for every system the history touched
  const allSystems = [...new Set(detail.map((k) => k.system))];
  const sysNames = new Map<number, string>();
  try {
    const r = await fetch(`${ESI_BASE}/universe/names/`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(allSystems),
      signal: AbortSignal.timeout(NET_TIMEOUT_MS),
    });
    if (r.ok) for (const row of await r.json() as { id: number; name: string }[]) sysNames.set(row.id, row.name);
  } catch { /* ids render as numbers — the links still work */ }

  const fights = clusters.map((fight) => {
    const first = fight[fight.length - 1];
    const systems: number[] = [];
    for (const k of [...fight].reverse()) {
      if (!systems.includes(k.system)) systems.push(k.system);
    }
    // SAVED multi-system BRs are created ON SELECTION (the component calls
    // createSavedBr once analyze answers) — creating one per history fight
    // up front would spam their database for reports nobody opens
    const caveat = systems.length > 1
      ? `fight spans ${systems.length} systems — this link covers the first; the full`
        + ' multi-system report is created when br.evetools has the fight'
      : undefined;
    return {
      url: `https://br.evetools.org/related/${first.system}/${hourBucket(first.t)}`,
      systemId: first.system,
      systemName: systems.map((s) => sysNames.get(s) ?? String(s)).join(' + '),
      startedAt: first.time,
      endedAt: fight[0].time,
      kills: fight.length,
      caveat,
      window: {
        timings: fightTimings(systems, first.t, fight[0].t),
        corpId,
        startMs: first.t,
        endMs: fight[0].t,
      },
      corpKms: [...fight].reverse().map((k) => k.br),
      liveUrl: `https://zkillboard.com/related/${first.system}/${hourBucket(first.t)}/`,
      // WarBeacon's RANGE form: start bucket to end bucket in 30-minute
      // steps — covers a fight that crosses the hour, unlike the 1-bucket
      // related URLs (probed: comma-separated systems are ignored, so this
      // still shows the FIRST system only)
      warbeaconUrl: `https://warbeacon.net/br/related/${first.system}/${bucket30(first.t)}/${bucket30(fight[0].t + 30 * 60_000)}`,
    };
  });

  return {
    fights,
    newestKillmailId: detail[0].id,
    liveFeeds,
  };
}

/** UTC 30-minute bucket, floored — WarBeacon's range URLs step in these */
const bucket30 = (ms: number): string => {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${d.getUTCMinutes() >= 30 ? '30' : '00'}`;
};

/** the saved multi-system report, created ON DEMAND for a selected fight
 * once br.evetools' analyze has its killmails */
export async function createSavedBr(timings: BrTiming[], fd: FightData): Promise<string> {
  return createSavedReport(timings, fd);
}

/** the write-up's data, fetched on its own time — never in front of the link */
export async function fetchFightData(w: FightWindow): Promise<FightData> {
  return deriveTeams(await analyzeFight(w.timings), w.corpId);
}

/** the summary built from the corp's OWN killmails — already in hand from
 * zkill+ESI, so it exists the moment the fight does. Marked partial: mails
 * no corp member is on (an ally's loss we never whored) are missing, and
 * everything downstream must say so. */
export function fallbackFightData(corpKms: BrKm[], corpId: number): FightData {
  return { ...deriveTeams(corpKms, corpId), partial: true };
}

/** the character's corporation, from public ESI — per-player, never in code */
export async function corporationOf(characterId: number): Promise<number> {
  const c = await getJson<{ corporation_id: number }>(
    `${ESI_BASE}/characters/${characterId}/`,
  );
  return c.corporation_id;
}
