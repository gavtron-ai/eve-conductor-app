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
// NO REQUEST IS MADE TO br.evetools.org (v0.217.0). From v0.99.1 the app called two of that site's
// INTERNAL routes (/newapi/br/analyze and /newapi/old/br/create-new — found by instrumenting the
// site's own page) to fetch a fight's killmails and to CREATE saved multi-system reports on their
// server, the latter by itself whenever such a fight was selected. Nobody there agreed to that.
// It is deleted. The app now only BUILDS the public related-page address above, as text, for the
// pilot to paste in chat or open in his own browser; the summary is built from the corp's own
// killmails (zKillboard's public API + ESI), which are already in hand.
import { ESI_BASE } from './constants';
import { fightPoster, fightWhy, homeAlliance, splitFights, type FightPoster, type SplitFight } from './fightSplit';

/** THE OLD RULE (kept for its fixtures; no longer decides anything): chunks of
 * corp killmails separated by more than this were different fights. Measured
 * 2026-09-19: with 31 pilots active the corp is never quiet for 40 minutes —
 * a whole night chained into one battle. fightSplit.ts reads the killmails
 * instead (who, where, against whom, at what tempo). */
export const FIGHT_GAP_MINUTES = 40;

/** how many recent killmails to hydrate from ESI. Was 60 — measured 2026-09-19:
 * at this corp's pace 60 mails reach back ~4 hours, so the "3 days" list held
 * one night. zKill lists 200 kills + 200 losses; all of them are read, in
 * batches, and kept (a killmail never changes) so a refresh fetches only the
 * new ones. */
const HYDRATE_LIMIT = 400;
const HYDRATE_BATCH = 25;
/** how many corporation logos a card shows per side */
export const POSTER_LOGOS = 5;
const mailCache = new Map<number, FeedMail>();

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
  /** corp / alliance pilots on those killmails */
  corpPilots: number;
  /** one of the user's own logged-in characters is on one of them */
  mine: boolean;
  /** how the fight was put together and why it ended (fightSplit.ts), for the tab */
  why: string;
  /** the card's headline numbers, from the corp's own killmails (v0.204.1):
   * pilots seen on each side, ISK destroyed vs lost, the enemy groups by name */
  poster: Omit<FightPoster, 'enemies' | 'corps'> & {
    enemies: { id: number; name: string; pilots: number }[];
    corps: Record<'ours' | 'theirs', { id: number; name: string; pilots: number }[]>;
  };
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

/** window padding around each system's part of the fight when asking
 * br.evetools for its kills. Whatever the pad lets in that shares no pilot
 * with the fight is dropped again (relevantKms). */
const BR_WINDOW_PAD_MINUTES = 10;

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

/** EACH SYSTEM ITS OWN WINDOW (v0.204.0): from that system's first killmail of
 * the fight to its last, padded. It used to be every system over the WHOLE
 * fight — measured on a 10-system, 282-minute battle: 73 killmails came back,
 * 8 with no corp member on them, 7 of those from a system where the corp had
 * one kill. Exported pure for fixtures. */
export const fightTimings = (mails: readonly { system: number; t: number }[]): BrTiming[] => {
  const padMs = BR_WINDOW_PAD_MINUTES * 60_000;
  const span = new Map<number, { lo: number; hi: number }>();
  for (const m of [...mails].sort((a, b) => a.t - b.t)) {
    const s = span.get(m.system);
    if (s) { s.lo = Math.min(s.lo, m.t); s.hi = Math.max(s.hi, m.t); } else span.set(m.system, { lo: m.t, hi: m.t });
  }
  return [...span.entries()].map(([sys, s]) => ({
    systemID: String(sys),
    start: Math.floor((s.lo - padMs) / 1000),
    end: Math.floor((s.hi + padMs) / 1000),
  }));
};

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

/**
 * The corp's recent kills + losses from zKillboard's JSON API — through
 * the main process, which identifies the app and spaces requests the way
 * zKill's API rules ask (v0.199.1). zKill caches these lists for up to an
 * hour (measured: max-age=3600), which is the honest price of not
 * scraping their site. In the browser rig (no bridge) the renderer fetches
 * the same two endpoints directly.
 */
async function corpLists(corpId: number, page = 1): Promise<{ kills: ZkbEntry[]; losses: ZkbEntry[] }> {
  const bridge = window.appInfo?.zkill;
  if (bridge?.corpKills) return bridge.corpKills(corpId, page) as Promise<{ kills: ZkbEntry[]; losses: ZkbEntry[] }>;
  const tail = page > 1 ? `page/${page}/` : '';
  const [kills, losses] = await Promise.all([
    getJson<ZkbEntry[]>(`https://zkillboard.com/api/kills/corporationID/${corpId}/${tail}`, { noStore: true }),
    getJson<ZkbEntry[]>(`https://zkillboard.com/api/losses/corporationID/${corpId}/${tail}`, { noStore: true }),
  ]);
  return { kills, losses };
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

/** the last history this session built (v0.207.0, the Home "Latest fights" dashlet) — read-only,
 * so a dashlet never starts a zKillboard read of its own */
let lastHistory: { at: number; history: BattleHistory } | null = null;
export const lastBattleHistory = (): { at: number; history: BattleHistory } | null => lastHistory;

/** zKillboard hands out 200 rows a page */
export const ZKILL_PAGE = 200;

export interface CorpFeed {
  /** every hydrated mail, newest first */
  detail: FeedMail[];
  liveFeeds: number;
  /** the zKillboard lists as they came back — for the leaderboard's completeness rule: the ids of
   * each list, and whether its LAST page came back full (older rows may exist beyond it) */
  lists: { kills: number[]; losses: number[]; killsFull: boolean; lossesFull: boolean };
}

/** THE CORP'S KILLMAIL FEED (split out of makeBattleReports in v0.208.0 so the leaderboard reads
 * the very same mails): zKillboard's lists (`pages` × 200 kills and losses) + every logged-in
 * character's own mails from ESI + the corp-wide ESI feed when a Director is logged in, hydrated
 * from ESI's public killmail route and cached for the session. */
export async function corpFeedMails(corpId: number, sources: LiveSource[] = [], pages = 1): Promise<CorpFeed> {
  let lastPage = { kills: 0, losses: 0 };
  // kills AND losses — a fight the corp lost still deserves its report —
  // PLUS every logged-in character's own mails live from ESI, PLUS the
  // corp-wide feed through any source holding the Director role
  const [{ kills, losses }, corpFeed, ...own] = await Promise.all([
    (async () => {
      const all = { kills: [] as ZkbEntry[], losses: [] as ZkbEntry[] };
      for (let p = 1; p <= pages; p++) {
        const one = await corpLists(corpId, p);
        all.kills.push(...one.kills); all.losses.push(...one.losses);
        lastPage = { kills: one.kills.length, losses: one.losses.length };
        if (one.kills.length < ZKILL_PAGE && one.losses.length < ZKILL_PAGE) break;
      }
      return all;
    })(),
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
  // "live" = straight from ESI: own mails, or the corp feed via a Director
  const liveFeeds = own.filter((rows) => rows.length > 0).length
    + (corpFeed.length > 0 ? 1 : 0);
  const entries = [...byId.values()]
    .sort((a, b) => b.killmail_id - a.killmail_id) // ids are chronological
    .slice(0, HYDRATE_LIMIT * pages);
  if (entries.length === 0) {
    throw new Error('zKillboard lists no recent kills or losses for this corporation');
  }
  const hydrate = async (e: ZkbEntry): Promise<FeedMail | null> => {
    const hit = mailCache.get(e.killmail_id);
    if (hit) {
      // a mail first seen through ESI carries no price; take zKillboard's once its list has it
      if (!hit.br.victim.lossValue && e.zkb.totalValue) hit.br.victim.lossValue = e.zkb.totalValue;
      return hit;
    }
    try {
      const km = await getJson<EsiKillmail>(
        `${ESI_BASE}/killmails/${e.killmail_id}/${e.zkb.hash}/`,
      );
      const fm: FeedMail = {
        id: e.killmail_id,
        t: new Date(km.killmail_time).getTime(),
        system: km.solar_system_id,
        time: km.killmail_time,
        // the FULL killmail, in br shape — the summary's fallback source
        br: esiKmToBr(e.killmail_id, km, e.zkb.totalValue ?? 0),
      };
      mailCache.set(fm.id, fm);
      return fm;
    } catch {
      return null; // one unfetchable killmail must not kill the report
    }
  };
  const detail: FeedMail[] = [];
  for (let i = 0; i < entries.length; i += HYDRATE_BATCH) {
    const got = await Promise.all(entries.slice(i, i + HYDRATE_BATCH).map(hydrate));
    for (const g of got) if (g) detail.push(g);
  }
  detail.sort((a, b) => b.t - a.t);
  if (detail.length === 0) {
    throw new Error('ESI returned no killmail details');
  }
  return { detail, liveFeeds, lists: { kills: kills.map((k) => k.killmail_id), losses: losses.map((k) => k.killmail_id), killsFull: lastPage.kills >= ZKILL_PAGE, lossesFull: lastPage.losses >= ZKILL_PAGE } };
}

export async function makeBattleReports(
  corpId: number, sources: LiveSource[] = [], myCharIds: readonly number[] = sources.map((s) => s.characterId),
): Promise<BattleHistory> {
  const { detail, liveFeeds } = await corpFeedMails(corpId, sources);

  // EVERY fight in the window, newest first — split by who fought whom,
  // where, and at what tempo (fightSplit.ts), not by corp-wide silence
  const cutoff = Date.now() - HISTORY_DAYS * 86_400_000;
  const split: SplitFight<FeedMail & { victim: BrParticipant; attackers: BrParticipant[] }>[] = splitFights(
    detail.map((m) => ({ ...m, victim: m.br.victim, attackers: m.br.attackers })), { corpId },
  ).filter((f) => f.mails[0].t >= cutoff);
  const whyOf = new Map(split.map((f) => [f.mails[0].id, f] as const));
  const clusters: FeedMail[][] = split.map((f) => f.mails);
  const mine = new Set(myCharIds);
  if (clusters.length === 0) {
    throw new Error(`no corp fights in the last ${HISTORY_DAYS} days`);
  }

  // the cards' headline numbers, from the corp's own killmails
  const homeAlly = homeAlliance(detail.map((m) => ({ ...m, victim: m.br.victim, attackers: m.br.attackers })), corpId);
  const posters = new Map(clusters.map((fight) => [fight[0].id,
    fightPoster(fight.map((m) => ({ ...m, victim: m.br.victim, attackers: m.br.attackers })), corpId, homeAlly)] as const));
  // one names lookup for every system the history touched — and the two
  // biggest enemy groups of every fight (the card says who it was against)
  const allSystems = [...new Set(detail.map((k) => k.system))];
  // the corporations whose logos the cards show (their names are the tooltips) — a
  // SEPARATE lookup: /universe/names/ is all-or-nothing, and a corp that no longer
  // resolves must not take the system names down with it
  const groupIds = [...new Set([...posters.values()].flatMap((p) => [...p.corps.ours.slice(0, POSTER_LOGOS), ...p.corps.theirs.slice(0, POSTER_LOGOS)].map((e) => e.id)))];
  const groupNames = new Map<number, string>();
  try {
    for (let i = 0; i < groupIds.length; i += 500) {
      const r = await fetch(`${ESI_BASE}/universe/names/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(groupIds.slice(i, i + 500)), signal: AbortSignal.timeout(NET_TIMEOUT_MS),
      });
      if (r.ok) for (const row of await r.json() as { id: number; name: string }[]) groupNames.set(row.id, row.name);
    }
  } catch { /* logos still draw; the tooltip falls back to the id */ }
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
    const caveat = systems.length > 1
      ? `fight spans ${systems.length} systems — a related link can only name one, so this link covers the first`
      : undefined;
    return {
      url: `https://br.evetools.org/related/${first.system}/${hourBucket(first.t)}`,
      systemId: first.system,
      systemName: systems.map((s) => sysNames.get(s) ?? String(s)).join(' + '),
      startedAt: first.time,
      endedAt: fight[0].time,
      kills: fight.length,
      caveat,
      corpPilots: new Set(fight.flatMap((k) => [k.br.victim, ...k.br.attackers]).filter((p) => p.corp === corpId && p.char).map((p) => p.char)).size,
      mine: fight.some((k) => [k.br.victim, ...k.br.attackers].some((p) => p.char !== 0 && mine.has(p.char))),
      why: fightWhy(whyOf.get(fight[0].id)!),
      poster: (() => {
        const p = posters.get(fight[0].id)!;
        const named = (xs: { id: number; pilots: number }[]) => xs.map((e) => ({ ...e, name: groupNames.get(e.id) ?? '' }));
        return { ...p, enemies: named(p.enemies), corps: { ours: named(p.corps.ours), theirs: named(p.corps.theirs) } };
      })(),
      window: {
        timings: fightTimings(fight),
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

  lastHistory = { at: Date.now(), history: { fights, newestKillmailId: detail[0].id, liveFeeds } };
  return lastHistory.history;
}

/** UTC 30-minute bucket, floored — WarBeacon's range URLs step in these */
const bucket30 = (ms: number): string => {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${p2(d.getUTCMonth() + 1)}${p2(d.getUTCDate())}${p2(d.getUTCHours())}${d.getUTCMinutes() >= 30 ? '30' : '00'}`;
};

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
