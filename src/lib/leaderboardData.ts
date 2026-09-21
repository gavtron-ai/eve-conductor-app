// THE LEADERBOARD'S KILLMAILS (v0.208.0; rebuilt in v0.212.0) — public killmails of the player's
// corporation, read from zKillboard and kept in one local archive; a killmail never changes, so
// nothing is asked for twice.
//
// WHAT v0.212.0 CHANGED, AND WHY (the owner: "people will not go click load, and it seems to take a
// long time to load after and i dont even know if I see all the data"):
//  · NOBODY CLICKS ANYTHING. Opening the tab shows what is on disk at once, refreshes the newest
//    lists (two requests), and a background job fills the history in by itself, newest month
//    first, across sessions until two years are held. It survives leaving the tab.
//  · ONE archive in memory, ONE writer. v0.211 let a refresh and a history read run side by side,
//    each reading the file, each writing its own idea of "complete since" — the later one erased
//    the other's (the owner's log: 40,000 killmails held, board complete "from five days ago").
//    Completeness is now derived from what was read (leaderboard.heldFloor), never remembered.
//  · NO ESI READS. zKillboard's rows carry the whole killmail, so the refresh is its two newest
//    lists — it used to hydrate up to 400 killmails from ESI on every visit.
//  · FIGHTS ON DEMAND, for the span on screen. v0.211 split every held killmail into fights on
//    every load — 52 s on the owner's 40,000 (the splitter's quadratic tail, fixed in fightSplit).
// Names come from ESI's public /universe/names/.
import { useEffect, useState } from 'react';
import { corporationOf } from './battleReport';
import { splitFights } from './fightSplit';
import { classOfGroup, compactMail, completeSince, heldFloor, monthsBackFrom, type BoardInput, type LbMail, type ShipClass } from './leaderboard';
import { categories, getType } from './typedb';
import { useAuth } from './auth';
import { logInfo, logWarn } from './devlog';

// the stats bridge only takes names it knows the prefix of (electron/stats.cjs AUX_NAME)
const FILE = 'battle-corp-killmails.ndjson';
const ESI = 'https://esi.evetech.net/latest';
const DAY = 86_400_000;
/** two years: seasons, year on year */
export const KEEP_DAYS = 730;
export const HISTORY_MONTHS = 24;
/** the archive is read whole once a session (measured: 40,000 killmails = 24 MB, read + parsed in
 * 0.15 s), so the cap is about memory, not time: it was 40,000 — which the owner's corp, at 59,000
 * in two years, ran into, silently cutting eight months off */
export const MAX_MAILS = 150_000;
export const ZKILL_PAGE = 200;
/** a month that needs more pages than this is left incomplete rather than hammered */
export const MAX_MONTH_PAGES = 60;
const REWRITE_AFTER = 6_000;
const REFRESH_EVERY = 10 * 60_000;
/** a Home dashlet keeps the board current too, but more gently than the tab */
const HOME_REFRESH_EVERY = 30 * 60_000;

export interface ArchMail extends LbMail { system: number }
/** the archive's meta line — the LAST one in the file speaks */
interface ArchMeta { k: 'meta'; corpId: number; at: number; corpName?: string; names?: Record<string, string>; months?: string[]; curYm?: string | null; curReadAt?: number | null; recentFloor?: number | null; recentAt?: number }

export interface BoardData {
  corpId: number;
  corpName: string;
  /** newest first */
  mails: ArchMail[];
  /** the held mails are known to be complete from here (ms); null = nothing known yet */
  heldSince: number | null;
  /** mails with no price yet — their ISK counts as 0, so ISK boards are a floor */
  unpriced: number;
  myChars: number[];
  names: Map<number, string>;
  /** when the newest lists were last read */
  at: number;
  /** past months read whole from zKillboard's history */
  months: string[];
  /** killmails held per month ("2026-08" → n) */
  counts: Map<string, number>;
  /** changes whenever anything held changes — what caches key on */
  rev: number;
}
export interface HistoryJob { running: boolean; month: string; kind: 'kills' | 'losses'; page: number; read: number; monthsDone: number; monthsTotal: number; note: string }

const NOT_SHIPS = new Set(['Structures', 'Planetary Infrastructure', 'Drones']);
/** a hull's class: from the type list's inventory group; a structure or deployable by its market
 * category (MEASURED: tractor units, depots, bubbles and citadels are all "Structures", a skyhook
 * "Planetary Infrastructure"); anything the list does not know is "other" */
export const shipClassOf = (shipTypeId: number): ShipClass => {
  const t = getType(shipTypeId);
  if (t && t.group === undefined && NOT_SHIPS.has(categories[t.catIdx] ?? '')) return 'structure';
  return classOfGroup(t?.group, shipTypeId);
};

// ---- names
const names = new Map<number, string>();
/** names for a pilot card's outsiders (his nemesis, his prey) — public ESI, asked only when a card is opened */
export async function resolveBoardNames(ids: number[]): Promise<Map<number, string>> { await resolveNames(ids); return names; }
async function resolveNames(ids: Iterable<number>): Promise<void> {
  const want = [...new Set(ids)].filter((id) => id > 0 && !names.has(id));
  for (let i = 0; i < want.length; i += 500) {
    const chunk = want.slice(i, i + 500);
    try {
      const r = await fetch(`${ESI}/universe/names/`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(chunk), signal: AbortSignal.timeout(15_000) });
      if (r.ok) { for (const row of await r.json() as { id: number; name: string }[]) names.set(row.id, row.name); continue; }
      // the route is all-or-nothing: one id it no longer knows fails the lot — ask one by one
      if (r.status === 404 && chunk.length > 1) for (const id of chunk) await resolveNames([id]);
    } catch { /* a name is a nicety — the portrait and the id still show */ }
  }
}

// ---- THE ONE ARCHIVE IN MEMORY
interface State {
  corpId: number; mails: Map<number, ArchMail>; months: Set<string>;
  curYm: string | null; curReadAt: number | null; recentFloor: number | null; recentAt: number;
  /** lines in the file on disk (dead ones included) */
  lines: number;
}
let state: State | null = null;
let loading: Promise<State | null> | null = null;
let rev = 0;
let snapshot: BoardData | null = null;
let busy = false;
let lastError: string | null = null;
let job: HistoryJob = { running: false, month: '', kind: 'kills', page: 1, read: 0, monthsDone: 0, monthsTotal: 0, note: '' };
let stopAsked = false;
/** a month too big to read (MAX_MONTH_PAGES) is not tried again by itself this session — only by "resume" */
let gaveUp = false;
const subs = new Set<() => void>();
const emit = () => { for (const s of subs) s(); };
const touch = () => { rev++; snapshot = null; fightCache.clear(); emit(); };
const ymOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

async function readArchive(): Promise<State | null> {
  const raw = await window.appInfo?.stats?.auxRead(FILE).catch(() => null);
  if (!raw) return null;
  const t0 = performance.now();
  const mails = new Map<number, ArchMail>();
  let meta: ArchMeta | null = null; let lines = 0;
  for (const line of raw.split('\n')) {
    if (!line) continue;
    lines++;
    try {
      const j = JSON.parse(line) as ArchMail | ArchMeta;
      // another corp's archive (the player moved): what came before it is not ours
      if ('k' in j) { if (meta && meta.corpId !== j.corpId) mails.clear(); meta = j; continue; }
      if (typeof j.id === 'number' && typeof j.t === 'number' && j.victim && Array.isArray(j.attackers)) mails.set(j.id, j);   // a later line for the same mail wins (a price that arrived)
    } catch { /* a torn line is skipped */ }
  }
  if (!meta) return null;
  for (const [id, n] of Object.entries(meta.names ?? {})) if (!names.has(Number(id))) names.set(Number(id), n);
  if (meta.corpName) names.set(meta.corpId, meta.corpName);
  logInfo('leaderboard', 'archive read', { ms: Math.round(performance.now() - t0), mb: +(raw.length / 1e6).toFixed(1), lines, mails: mails.size, months: (meta.months ?? []).length });
  return { corpId: meta.corpId, mails, months: new Set(meta.months ?? []), curYm: meta.curYm ?? null, curReadAt: meta.curReadAt ?? null, recentFloor: meta.recentFloor ?? null, recentAt: meta.recentAt ?? meta.at ?? 0, lines };
}
/** the archive, read from disk ONCE a session and shared by everything */
function ensureState(): Promise<State | null> {
  if (state) return Promise.resolve(state);
  if (!loading) loading = readArchive().then((s) => { if (s && !state) { state = s; prune(Date.now()); touch(); } return state; }).finally(() => { loading = null; });
  return loading;
}
/** inside the horizon, and never more than MAX_MAILS (newest kept); returns how many left */
function prune(now: number): number {
  if (!state) return 0;
  let dropped = 0;
  const cutoff = now - KEEP_DAYS * DAY;
  for (const [id, m] of state.mails) if (m.t < cutoff) { state.mails.delete(id); dropped++; }
  if (state.mails.size > MAX_MAILS) {
    const old = [...state.mails.values()].sort((a, b) => a.t - b.t).slice(0, state.mails.size - MAX_MAILS);
    for (const m of old) { state.mails.delete(m.id); dropped++; }
    // a month the count cut into is no longer whole
    let oldest = Infinity; for (const m of state.mails.values()) if (m.t < oldest) oldest = m.t;   // a loop: spreading 150,000 numbers into Math.min overflows the stack
    const floorYm = ymOf(oldest);
    for (const ym of [...state.months]) if (ym <= floorYm) state.months.delete(ym);
  }
  return dropped;
}

// ---- ONE WRITER: every write goes through this chain, in order, from the one state in memory
let writes: Promise<void> = Promise.resolve();
function persist(fresh: ArchMail[]): void {
  const s = state; const bridge = window.appInfo?.stats;
  if (!s || !bridge) return;
  const pilots = pilotsOf(s.mails.values(), s.corpId);
  const meta: ArchMeta = {
    k: 'meta', corpId: s.corpId, at: Date.now(), corpName: names.get(s.corpId) ?? '', months: [...s.months].sort(), curYm: s.curYm, curReadAt: s.curReadAt, recentFloor: s.recentFloor, recentAt: s.recentAt,
    names: Object.fromEntries([...pilots].filter((id) => names.has(id)).map((id) => [String(id), names.get(id)!])),
  };
  const rewrite = s.lines === 0 || s.lines + fresh.length + 1 - s.mails.size > REWRITE_AFTER;
  const body = rewrite ? [...[...s.mails.values()].map((m) => JSON.stringify(m)), JSON.stringify(meta)] : [...fresh.map((m) => JSON.stringify(m)), JSON.stringify(meta)];
  s.lines = rewrite ? body.length : s.lines + body.length;
  writes = writes.then(() => (rewrite ? bridge.auxWrite(FILE, body.join('\n') + '\n') : bridge.auxAppend(FILE, body))).catch((e) => { logWarn('leaderboard', 'archive write failed', { err: e instanceof Error ? e.message : String(e) }); });
}
const pilotsOf = (mails: Iterable<ArchMail>, corpId: number): Set<number> => {
  const ids = new Set<number>();
  for (const m of mails) { if (m.victim.corp === corpId && m.victim.char > 0) ids.add(m.victim.char); for (const a of m.attackers) if (a.corp === corpId && a.char > 0) ids.add(a.char); }
  return ids;
};
/** put a read mail into the archive; returns it when it is new (or brings a price that was missing) */
function fold(mail: ArchMail): ArchMail | null {
  const s = state!;
  const m = compactMail(mail, s.corpId);
  const had = s.mails.get(m.id);
  if (had && (had.value || !m.value)) return null;
  s.mails.set(m.id, m);
  return m;
}

// ---- what the board reads
function build(): BoardData | null {
  const s = state;
  if (!s) return null;
  const now = Date.now();
  const mails = [...s.mails.values()].sort((a, b) => b.t - a.t);
  const counts = new Map<string, number>();
  for (const m of mails) { const k = ymOf(m.t); counts.set(k, (counts.get(k) ?? 0) + 1); }
  const floor = heldFloor({ now, recentFloor: s.recentFloor, curYm: s.curYm, curReadAt: s.curReadAt, whole: [...s.months] });
  // nothing older than the oldest mail still held can be "complete" once the count cap has cut
  const capped = s.mails.size >= MAX_MAILS && mails.length > 0 ? mails[mails.length - 1].t : 0;
  return {
    corpId: s.corpId, corpName: names.get(s.corpId) ?? '', mails, counts, rev,
    heldSince: floor === null || mails.length === 0 ? null : Math.max(floor, capped, now - KEEP_DAYS * DAY),
    unpriced: mails.reduce((t, m) => t + (m.value ? 0 : 1), 0), myChars: useAuth.getState().characters.map((c) => c.characterId), names, at: s.recentAt, months: [...s.months].sort(),
  };
}
export const lastBoardData = (): BoardData | null => (snapshot ??= build());
/** WHAT IS ALREADY HELD, asking nobody (the Home dashlets): the archive from disk, once a session */
export async function heldBoardData(): Promise<BoardData | null> { await ensureState(); return lastBoardData(); }
/** THE HOME DASHLETS: what is held, at once — and the board kept current by itself, so nobody has
 * to visit the tab first: the two newest lists at most every half hour (no ESI), and the history
 * filling in exactly as it does on the tab. Without a logged-in pilot it stays what is on disk. */
export async function homeBoardData(): Promise<BoardData | null> {
  await ensureState();
  if (useAuth.getState().characters.length > 0) void openBoard(false, HOME_REFRESH_EVERY);
  return lastBoardData();
}

// fights, for the span on screen only (padded, so a fight cut by the window's edge groups as it
// would in the whole archive — the splitter's longest link is 30 minutes)
const FIGHT_PAD = 2 * 3_600_000;
const fightCache = new Map<string, number[][]>();
/** everything the engine needs for a span: the mails, the fights among them, the hull classes */
export function inputFor(d: BoardData, since: number | null, until: number | null): BoardInput {
  const key = `${d.rev}:${since}:${until}`;
  let fights = fightCache.get(key);
  if (!fights) {
    const t0 = performance.now();
    const lo = since === null ? -Infinity : since - FIGHT_PAD, hi = until === null ? Infinity : until + FIGHT_PAD;
    const row = (p: ArchMail['victim']) => ({ ...p, ally: p.ally ?? 0 });
    const span = d.mails.filter((m) => m.t >= lo && m.t < hi);
    fights = splitFights(span.map((m) => ({ id: m.id, t: m.t, system: m.system, victim: row(m.victim), attackers: m.attackers.map(row) })), { corpId: d.corpId }).map((f) => f.mails.map((m) => m.id));
    if (fightCache.size >= 8) fightCache.delete(fightCache.keys().next().value as string);
    fightCache.set(key, fights);
    const ms = Math.round(performance.now() - t0);
    if (ms > 250) logInfo('leaderboard', 'fights split', { ms, mails: span.length, fights: fights.length });
  }
  return { mails: d.mails, corpId: d.corpId, fights, since, until, classOf: shipClassOf };
}

// ---- reading zKillboard
type Rows = { ok: boolean; n: number; rows: ArchMail[] };
let rigLastAt = 0;
type P = { alliance_id?: number; corporation_id?: number; character_id?: number; ship_type_id?: number; damage_done?: number; damage_taken?: number; final_blow?: boolean };
async function rigRows(url: string): Promise<Rows> {
  // the browser rig has no bridge: the same endpoints, the same spacing, straight from the page
  const wait = rigLastAt + 1200 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  rigLastAt = Date.now();
  try {
    const r = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!r.ok) return { ok: false, n: 0, rows: [] };
    const raw = await r.json() as { killmail_id: number; killmail_time: string; solar_system_id?: number; victim: P; attackers?: P[]; zkb?: { totalValue?: number } }[];
    const part = (p: P) => ({ ally: p.alliance_id ?? 0, corp: p.corporation_id ?? 0, char: p.character_id ?? 0, ship: p.ship_type_id ?? 0, dmg: p.damage_done ?? p.damage_taken ?? 0, ...(p.final_blow ? { fb: true } : {}) });
    return { ok: true, n: raw.length, rows: raw.filter((k) => k.killmail_id && k.victim).map((k) => ({ id: k.killmail_id, t: Date.parse(k.killmail_time), system: k.solar_system_id ?? 0, value: k.zkb?.totalValue ?? 0, victim: part(k.victim), attackers: (k.attackers ?? []).map(part) })) };
  } catch { return { ok: false, n: 0, rows: [] }; }
}
const recentRows = (corpId: number, kind: 'kills' | 'losses'): Promise<Rows> => {
  const b = window.appInfo?.zkill;
  return b?.corpRecent ? b.corpRecent(corpId, kind) as Promise<Rows> : rigRows(`https://zkillboard.com/api/${kind}/corporationID/${corpId}/`);
};
const monthRows = (corpId: number, kind: 'kills' | 'losses', year: number, month: number, page: number): Promise<Rows> => {
  const b = window.appInfo?.zkill;
  return b?.corpMonth ? b.corpMonth(corpId, kind, year, month, page) as Promise<Rows> : rigRows(`https://zkillboard.com/api/${kind}/corporationID/${corpId}/year/${year}/month/${month}/${page > 1 ? `page/${page}/` : ''}`);
};

let myCorp: { char: number; corp: number } | null = null;
async function whoseCorp(): Promise<number> {
  const chars = useAuth.getState().characters;
  if (chars.length === 0) throw new Error('log in a character first — the corporation comes from your pilot, never from code');
  if (myCorp?.char !== chars[0].characterId) myCorp = { char: chars[0].characterId, corp: await corporationOf(chars[0].characterId) };
  return myCorp.corp;
}
/** the archive for THIS corp, in memory (an archive of another corp is left behind) */
async function stateFor(corpId: number): Promise<State> {
  await ensureState();
  if (!state || state.corpId !== corpId) { state = { corpId, mails: new Map(), months: new Set(), curYm: null, curReadAt: null, recentFloor: null, recentAt: 0, lines: 0 }; touch(); }
  return state;
}

/** THE NEWEST LISTS: two requests, no ESI. Complete from the older of… no — the LATER of the two
 * lists' oldest rows when a list came back full (leaderboard.completeSince) */
async function refreshRecent(): Promise<void> {
  const corpId = await whoseCorp();
  const s = await stateFor(corpId);
  const t0 = performance.now();
  const before = new Set(s.mails.keys());
  const lists = [await recentRows(corpId, 'kills'), await recentRows(corpId, 'losses')];
  if (lists.some((l) => !l.ok)) throw new Error('zKillboard did not answer — showing what is already held');
  const fresh: ArchMail[] = [];
  for (const l of lists) for (const row of l.rows) { const got = fold(row); if (got) fresh.push(got); }
  const info = (l: Rows) => ({ full: l.n >= ZKILL_PAGE, oldestT: l.rows.length > 0 ? Math.min(...l.rows.map((r) => r.t)) : null, overlap: l.rows.some((r) => before.has(r.id)) });
  // a list that overlaps what was held keeps the floor it had; with no floor at all it is everything there is (0)
  s.recentFloor = completeSince(lists.map(info), s.recentFloor) ?? 0;
  s.recentAt = Date.now();
  prune(s.recentAt);
  await resolveNames([corpId, ...pilotsOf(fresh, corpId)]);
  persist(fresh);
  touch();
  logInfo('leaderboard', 'recent lists read', { ms: Math.round(performance.now() - t0), held: s.mails.size, fresh: fresh.length, recentFloor: s.recentFloor });
}

/** does the history have anything left to do? this month not read this month-to-date in a way the
 * lists reach, or a month inside the horizon not yet whole */
function historyOwed(now: number): boolean {
  const s = state;
  if (!s) return false;
  const months = monthsBackFrom(now, HISTORY_MONTHS).filter((ym) => ym >= ymOf(now - KEEP_DAYS * DAY));
  if (s.curYm !== months[0] || s.curReadAt === null || (s.recentFloor ?? Infinity) > s.curReadAt) return true;
  return months.slice(1).some((ym) => !s.months.has(ym));
}

/** THE HISTORY, BY ITSELF: every month from this one backwards, unbroken, newest first. A past
 * month already whole is skipped (it cannot change). It commits after EVERY month, so the board
 * fills in as it goes and nothing is lost if the app closes; it stops at the first month it could
 * not read and picks up there next time. */
async function runHistory(): Promise<void> {
  if (job.running) return;
  const corpId = await whoseCorp();
  const s = await stateFor(corpId);
  const now = Date.now();
  const want = monthsBackFrom(now, HISTORY_MONTHS).filter((ym) => ym >= ymOf(now - KEEP_DAYS * DAY));
  stopAsked = false;
  job = { running: true, month: '', kind: 'kills', page: 1, read: 0, monthsDone: 0, monthsTotal: want.length, note: '' };
  emit();
  const t0 = performance.now();
  let note = '';
  try {
    for (let i = 0; i < want.length; i++) {
      const ym = want[i];
      const isCurrent = i === 0;
      job = { ...job, month: ym, monthsDone: i };
      if (isCurrent ? (s.curYm === ym && s.curReadAt !== null && (s.recentFloor ?? Infinity) <= s.curReadAt) : s.months.has(ym)) continue;
      const [y, mo] = ym.split('-').map(Number);
      const fresh: ArchMail[] = [];
      const startedAt = Date.now();
      let ok = true;
      for (const kind of ['kills', 'losses'] as const) {
        for (let page = 1; ok; page++) {
          if (stopAsked) { ok = false; note = 'paused'; break; }
          if (page > MAX_MONTH_PAGES) { ok = false; gaveUp = true; note = `${ym} has more than ${MAX_MONTH_PAGES * ZKILL_PAGE} ${kind} — left incomplete rather than hammer zKillboard`; break; }
          job = { ...job, kind, page }; emit();
          const res = await monthRows(corpId, kind, y, mo, page);
          if (!res.ok) { ok = false; note = `zKillboard did not answer for ${ym} — the history picks up there next time`; break; }
          for (const row of res.rows) { job.read++; const got = fold(row); if (got) fresh.push(got); }
          if (res.n < ZKILL_PAGE) break;
        }
        if (!ok) break;
      }
      if (!ok) { if (fresh.length > 0) { persist(fresh); touch(); } break; }
      if (isCurrent) { s.curYm = ym; s.curReadAt = startedAt; } else s.months.add(ym);
      prune(Date.now());
      await resolveNames(pilotsOf(fresh, corpId));
      persist(fresh);
      touch();
    }
  } finally {
    logInfo('leaderboard', 'history run', { ms: Math.round(performance.now() - t0), read: job.read, held: state?.mails.size ?? 0, whole: state?.months.size ?? 0, note });
    job = { ...job, running: false, monthsDone: note ? job.monthsDone : want.length, note };
    emit();
  }
}
export const stopHistory = (): void => { stopAsked = true; };
export const resumeHistory = (): void => { gaveUp = false; void runHistory().catch(() => undefined); };

/** OPEN THE BOARD: what is on disk at once; then the newest lists; then the history, by itself.
 * Safe to call as often as a component mounts — one refresh and one history run at a time. */
export async function openBoard(force = false, staleAfter = REFRESH_EVERY): Promise<void> {
  await ensureState();
  if (busy) return;
  busy = true; lastError = null; emit();
  try {
    if (force || !state || Date.now() - state.recentAt > staleAfter) await refreshRecent();
  } catch (e) { lastError = e instanceof Error ? e.message : String(e); }
  finally { busy = false; emit(); }
  if (!job.running && !stopAsked && !gaveUp && historyOwed(Date.now())) void runHistory().catch((e) => { lastError = e instanceof Error ? e.message : String(e); emit(); });
}

export interface BoardView { data: BoardData | null; busy: boolean; error: string | null; job: HistoryJob }
/** the board's data, live: re-renders when the archive, the refresh or the history job change */
export function useBoard(): BoardView {
  const [, bump] = useState(0);
  useEffect(() => { const f = () => bump((x) => x + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  return { data: lastBoardData(), busy, error: lastError, job };
}
