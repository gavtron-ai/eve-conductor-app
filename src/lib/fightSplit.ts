// FIGHT SPLITTING (v0.204.0) — which of a corporation's killmails are the
// SAME fight. PURE: no network, no store, no map.
//
// WHY: the first rule was time alone — "any two corp killmails ≤ 40 min
// apart are one fight". MEASURED 2026-09-19 on the corp's real feed (160
// mails, 30 h, 31 pilots active): the median gap between consecutive corp
// killmails is 1 minute, so a whole night chained into ONE battle — 252 min,
// 60 mails, 10 systems, three crews that never shared a killmail. A corp
// that busy is never quiet for 40 minutes; only the FIGHTS are.
//
// THE RULE NOW reads the killmails. Mails are walked oldest-first; each one
// either JOINS a fight that is still open or STARTS a new one. It joins when
// the evidence says it is the same engagement:
//   same-people  — same system, some of the same pilots or the same enemy
//                  group, within the fight's own quiet limit;
//   same-moment  — same system within 3 minutes, whoever is on it (the
//                  fringe of a brawl: a third party dying in the crossfire);
//   moved        — another system, but the same crew AND the same enemy,
//                  within the quiet limit (a running fight);
//   spilled      — ANOTHER system within 5 minutes, same crew. No map is
//                  consulted: the same pilots on killmails in two systems
//                  minutes apart IS the proof the systems connect, and a
//                  wormhole chain has no map to consult (measured: a kill at
//                  00:13 and two at 00:15 through a hole were kept apart
//                  while the rule asked for gate adjacency);
//   round-two    — same system, same enemy, same crew, up to 30 minutes
//                  later (both sides reshipped and came back).
// HOW A FIGHT ENDS: by its own tempo, not a fixed clock. A brawl with a kill
// every 40 seconds that goes silent for 6 minutes is over; a slow camp with
// a kill every 3 minutes is given up to 15. Two fights that a later killmail
// ties together by people (two skirmishes converging) are merged.
// Every fight carries WHY it was grouped and why it ended — the tab shows it.

export interface SplitPilot { ally: number; corp: number; char: number }
export interface SplitMail {
  id: number;
  /** ms epoch */
  t: number;
  system: number;
  victim: SplitPilot;
  attackers: SplitPilot[];
}

export type JoinReason = 'same-people' | 'same-moment' | 'moved' | 'spilled' | 'round-two';

export interface SplitOptions {
  corpId: number;
}

export interface SplitFight<T extends SplitMail> {
  /** newest first, like the feed */
  mails: T[];
  /** how many mails joined for each reason (the first mail of a fight joins for none) */
  joins: Partial<Record<JoinReason, number>>;
  /** fights folded into this one because a later killmail tied them together */
  merged: number;
  /** the typical gap between its kills, ms (0 when it has fewer than 2) */
  tempoMs: number;
  /** the quiet that ended it, ms — null when nothing in the feed came after
   * that could have continued it (it may still be running) */
  endedByQuietMs: number | null;
  /** what came before it for the same people or place: the gap, ms — null = nothing in the feed */
  startedAfterMs: number | null;
}

// ---- the limits, in one place --------------------------------------------
const MIN = 60_000;
/** a fight's quiet limit is this many of its typical kill gaps … */
export const QUIET_TEMPO_FACTOR = 6;
/** … never under this, never over that */
export const QUIET_MIN_MS = 6 * MIN;
export const QUIET_MAX_MS = 15 * MIN;
/** a fight too young to have a tempo (fewer than this many mails) gets this */
export const TEMPO_MIN_MAILS = 4;
export const QUIET_DEFAULT_MS = 10 * MIN;
/** same system, anyone at all */
export const SAME_MOMENT_MS = 3 * MIN;
/** another system, same crew: half of the killmail's friendly pilots, or this many of them */
export const SPILL_MS = 5 * MIN;
export const SPILL_CREW_COUNT = 3;
/** same system, same enemy, same crew: they came back */
export const ROUND_TWO_MS = 30 * MIN;
/** "the same crew": this share of the killmail's friendly pilots were already in the fight … */
export const CREW_SHARE = 0.34;
/** … or at least this many of them */
export const CREW_COUNT = 2;
/** round two wants most of them back */
export const ROUND_TWO_SHARE = 0.5;

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** the corporation's alliance, read off its own pilots on the killmails (0 = none) */
export function homeAlliance(mails: readonly SplitMail[], corpId: number): number {
  const count = new Map<number, number>();
  for (const m of mails) for (const p of [m.victim, ...m.attackers]) if (p.corp === corpId && p.ally) count.set(p.ally, (count.get(p.ally) ?? 0) + 1);
  let best = 0; let n = 0;
  for (const [a, c] of count) if (c > n) { best = a; n = c; }
  return best;
}

/** one killmail seen from the corporation's side */
export interface MailSides {
  /** corp / alliance pilots on it */
  friends: Set<number>;
  /** the other side's pilots: the attackers when a friend died, the victim when a friend killed */
  foes: Set<number>;
  /** the other side's groups (alliance, else corporation) */
  foeGroups: Set<number>;
}
export function sidesOf(m: SplitMail, corpId: number, homeAlly: number): MailSides {
  const friendly = (p: SplitPilot) => p.corp === corpId || (homeAlly !== 0 && p.ally === homeAlly);
  const group = (p: SplitPilot) => p.ally || p.corp;
  const friends = new Set<number>(); const foes = new Set<number>(); const foeGroups = new Set<number>();
  const victimFriendly = friendly(m.victim);
  if (victimFriendly && m.victim.char) friends.add(m.victim.char);
  for (const a of m.attackers) if (friendly(a) && a.char) friends.add(a.char);
  if (victimFriendly) {
    for (const a of m.attackers) if (!friendly(a)) { if (a.char) foes.add(a.char); if (group(a)) foeGroups.add(group(a)); }
  } else {
    if (m.victim.char) foes.add(m.victim.char);
    if (group(m.victim)) foeGroups.add(group(m.victim));
  }
  return { friends, foes, foeGroups };
}

interface OpenFight<T extends SplitMail> {
  mails: T[]; // oldest first while building
  friends: Set<number>; foes: Set<number>; foeGroups: Set<number>;
  lastT: number;
  lastInSystem: Map<number, number>;
  joins: Partial<Record<JoinReason, number>>;
  merged: number;
}

const tempoOf = (mails: readonly SplitMail[]): number => median(mails.slice(1).map((m, i) => m.t - mails[i].t));
/** how long this fight may go silent before it is over */
export function quietLimit(mails: readonly SplitMail[]): number {
  if (mails.length < TEMPO_MIN_MAILS) return QUIET_DEFAULT_MS;
  return Math.min(QUIET_MAX_MS, Math.max(QUIET_MIN_MS, QUIET_TEMPO_FACTOR * tempoOf(mails)));
}

const share = (a: Set<number>, b: Set<number>): { n: number; frac: number } => {
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return { n, frac: a.size > 0 ? n / a.size : 0 };
};
const overlaps = (a: Set<number>, b: Set<number>): boolean => { for (const x of a) if (b.has(x)) return true; return false; };

/** the strongest reason this killmail belongs to that fight, or null. Order = strength. */
const RANK: JoinReason[] = ['same-people', 'moved', 'round-two', 'same-moment', 'spilled'];
function reasonToJoin<T extends SplitMail>(m: T, s: MailSides, f: OpenFight<T>): JoinReason | null {
  const crew = share(s.friends, f.friends);
  const sameCrew = crew.n >= CREW_COUNT || crew.frac >= CREW_SHARE;
  const sameEnemy = overlaps(s.foes, f.foes) || overlaps(s.foeGroups, f.foeGroups);
  const quiet = quietLimit(f.mails);
  const inSystem = f.lastInSystem.get(m.system);
  if (inSystem !== undefined) {
    const dt = m.t - inSystem;
    if (dt <= quiet && (crew.n > 0 || sameEnemy)) return 'same-people';
    if (dt <= ROUND_TWO_MS && sameEnemy && crew.frac >= ROUND_TWO_SHARE) return 'round-two';
    if (dt <= SAME_MOMENT_MS) return 'same-moment';
    return null;
  }
  const dt = m.t - f.lastT;
  if (dt <= quiet && sameCrew && sameEnemy) return 'moved';
  // measured against the SMALLER crew: two of a four-pilot gang turning up on
  // an eight-pilot kill next door two minutes later is the same action
  const smaller = Math.min(s.friends.size, f.friends.size);
  if (dt <= SPILL_MS && smaller > 0 && (crew.n / smaller >= ROUND_TWO_SHARE || crew.n >= SPILL_CREW_COUNT)) return 'spilled';
  return null;
}

/**
 * The corporation's killmails → fights. Input in any order; output fights
 * newest-first, each fight's mails newest-first (the shape clusterFights
 * gave). A fight is never older than the oldest mail, never invented: every
 * input mail lands in exactly one fight.
 */
export function splitFights<T extends SplitMail>(input: readonly T[], opts: SplitOptions): SplitFight<T>[] {
  const mails = input.slice().sort((a, b) => a.t - b.t || a.id - b.id);
  const homeAlly = homeAlliance(mails, opts.corpId);
  const open: OpenFight<T>[] = [];
  const all: OpenFight<T>[] = [];
  const absorb = (f: OpenFight<T>, m: T, s: MailSides) => {
    f.mails.push(m);
    for (const x of s.friends) f.friends.add(x);
    for (const x of s.foes) f.foes.add(x);
    for (const x of s.foeGroups) f.foeGroups.add(x);
    f.lastT = Math.max(f.lastT, m.t);
    f.lastInSystem.set(m.system, m.t);
  };
  for (const m of mails) {
    const s = sidesOf(m, opts.corpId, homeAlly);
    // a fight nothing could join any more is closed (the widest window is round two)
    for (let i = open.length - 1; i >= 0; i--) if (m.t - open[i].lastT > ROUND_TWO_MS) open.splice(i, 1);
    const hits = open.map((f) => ({ f, why: reasonToJoin(m, s, f) })).filter((h): h is { f: OpenFight<T>; why: JoinReason } => h.why !== null)
      .sort((a, b) => RANK.indexOf(a.why) - RANK.indexOf(b.why) || b.f.lastT - a.f.lastT);
    if (hits.length === 0) {
      const f: OpenFight<T> = { mails: [], friends: new Set(), foes: new Set(), foeGroups: new Set(), lastT: m.t, lastInSystem: new Map(), joins: {}, merged: 0 };
      absorb(f, m, s);
      open.push(f); all.push(f);
      continue;
    }
    const home = hits[0].f;
    absorb(home, m, s);
    home.joins[hits[0].why] = (home.joins[hits[0].why] ?? 0) + 1;
    // two fights tied together BY PEOPLE are one fight (two skirmishes converging)
    for (const h of hits.slice(1)) {
      if (h.why !== 'same-people' && h.why !== 'moved') continue;
      const other = h.f;
      home.mails = [...home.mails, ...other.mails].sort((a, b) => a.t - b.t || a.id - b.id);
      for (const x of other.friends) home.friends.add(x);
      for (const x of other.foes) home.foes.add(x);
      for (const x of other.foeGroups) home.foeGroups.add(x);
      for (const [sys, t] of other.lastInSystem) home.lastInSystem.set(sys, Math.max(t, home.lastInSystem.get(sys) ?? 0));
      home.lastT = Math.max(home.lastT, other.lastT);
      for (const k of Object.keys(other.joins) as JoinReason[]) home.joins[k] = (home.joins[k] ?? 0) + (other.joins[k] ?? 0);
      home.merged += 1 + other.merged;
      open.splice(open.indexOf(other), 1);
      all.splice(all.indexOf(other), 1);
    }
  }

  // why each fight started and ended: the nearest killmail before / after it
  // that COULD have been part of it (same place or some of the same friends)
  const sidesCache = new Map<number, MailSides>();
  const sides = (m: T) => { let v = sidesCache.get(m.id); if (!v) { v = sidesOf(m, opts.corpId, homeAlly); sidesCache.set(m.id, v); } return v; };
  const related = (f: OpenFight<T>, m: T) => f.lastInSystem.has(m.system) || overlaps(sides(m).friends, f.friends);
  // NEAREST FIRST (v0.212.0). This used to test EVERY killmail against EVERY fight — measured on a
  // real corp's two years: 11,960 fights × 40,000 mails = 52 SECONDS, all of it here, while the
  // grouping above took a fraction of a second. The mails are in time order, so the nearest related
  // one is found by walking outward from the fight's own edges and stopping at the first hit. The
  // answers are identical (checked fight by fight against the old loop on that same archive).
  const times = mails.map((m) => m.t);
  /** first index whose time is > t */
  const upper = (t: number) => { let lo = 0, hi = times.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] <= t) lo = mid + 1; else hi = mid; } return lo; };
  /** first index whose time is >= t */
  const lower = (t: number) => { let lo = 0, hi = times.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (times[mid] < t) lo = mid + 1; else hi = mid; } return lo; };
  return all.map((f) => {
    const own = new Set(f.mails.map((m) => m.id));
    const first = f.mails[0].t; const last = f.mails[f.mails.length - 1].t;
    let before: number | null = null; let after: number | null = null;
    for (let i = upper(first) - 1; i >= 0; i--) { const m = mails[i]; if (own.has(m.id) || !related(f, m)) continue; before = first - m.t; break; }
    for (let i = lower(last); i < mails.length; i++) { const m = mails[i]; if (own.has(m.id) || !related(f, m)) continue; after = m.t - last; break; }
    return { mails: f.mails.slice().reverse(), joins: f.joins, merged: f.merged, tempoMs: tempoOf(f.mails), endedByQuietMs: after, startedAfterMs: before };
  }).sort((a, b) => b.mails[0].t - a.mails[0].t);
}

/**
 * WHAT BELONGS IN THE SUMMARY: a system-and-time window also catches
 * strangers shooting strangers. Keep a killmail when it is one of the fight's
 * own (`seed`) or shares at least one pilot with them — a three-way brawl
 * stays whole (the third party shot someone in the fight), an unrelated gank
 * at the other end of the system goes. ONE step only: pilots of an accepted
 * killmail do not widen the net, or a busy system would chain in. With no
 * seed there is nothing to judge by and everything is kept.
 */
export function relevantKms<K extends { id: number; victim: { char: number }; attackers: { char: number }[] }>(kms: readonly K[], seed: readonly K[]): K[] {
  if (seed.length === 0) return kms.slice();
  const ids = new Set(seed.map((k) => k.id));
  const pilots = new Set<number>();
  for (const k of seed) for (const p of [k.victim, ...k.attackers]) if (p.char) pilots.add(p.char);
  return kms.filter((k) => ids.has(k.id) || [k.victim, ...k.attackers].some((p) => p.char !== 0 && pilots.has(p.char)));
}

/** "kills every 40 s" / "every 3 min" */
export function tempoWords(ms: number): string {
  if (ms <= 0) return '';
  return ms < 90_000 ? `every ${Math.max(1, Math.round(ms / 1000))} s` : `every ${Math.round(ms / MIN)} min`;
}
const REASON_WORDS: Record<JoinReason, string> = {
  'same-people': 'same system, same people', 'same-moment': 'same system, same moment', moved: 'the fight moved: same crew, same enemy',
  spilled: 'spilled into another system within minutes', 'round-two': 'round two: they came back',
};
/** one line for the tab: how this fight was put together and why it ended */
export function fightWhy<T extends SplitMail>(f: SplitFight<T>): string {
  const parts: string[] = [];
  const joins = (Object.keys(REASON_WORDS) as JoinReason[]).filter((k) => (f.joins[k] ?? 0) > 0).map((k) => `${REASON_WORDS[k]} ×${f.joins[k]}`);
  parts.push(f.mails.length === 1 ? 'a single killmail — nothing near it shared its place or its pilots' : `grouped by: ${joins.join(' · ')}`);
  if (f.merged > 0) parts.push(`${f.merged + 1} skirmishes that a later killmail tied together`);
  if (f.tempoMs > 0) parts.push(`kills ${tempoWords(f.tempoMs)}`);
  parts.push(f.endedByQuietMs === null ? 'nothing after it for these pilots or this system yet' : `ended: ${Math.round(f.endedByQuietMs / MIN)} min of quiet before these pilots or this system appear again`);
  return parts.join(' — ');
}

// ---------------------------------------------------------------------------
// THE POSTER (v0.204.1) — what a fight's card says at a glance, in the order
// the owner asked for: ships on each side, ISK destroyed vs lost, when (in
// words), who it was against, where. Computed from the corp's own killmails,
// so it exists the moment the list does — no report needs to load first.
// ---------------------------------------------------------------------------

export interface PosterMail extends SplitMail { victim: SplitPilot & { lossValue?: number } }
export interface FightPoster {
  /** corp / alliance pilots seen on the fight's killmails */
  ours: number;
  /** the other side's pilots seen on them — an enemy who got away without a
   * killmail either way was never seen, so this is a floor */
  theirs: number;
  /** ISK of the killmails where the other side died / where a friend died */
  destroyed: number;
  lost: number;
  kills: number;
  losses: number;
  /** killmails with no price yet: the ISK figures are then a floor */
  unpriced: number;
  /** the other side's groups (alliance, else corporation), most pilots first */
  enemies: { id: number; pilots: number }[];
  /** THE CORPORATIONS on each side, most pilots first — the card shows their
   * logos instead of names (v0.204.2). NPC rows (no pilot) are left out. */
  corps: { ours: { id: number; pilots: number }[]; theirs: { id: number; pilots: number }[] };
}

export function fightPoster(mails: readonly PosterMail[], corpId: number, homeAlly: number): FightPoster {
  const ours = new Set<number>(); const theirs = new Set<number>();
  const byGroup = new Map<number, Set<number>>();
  const byCorp: Record<'ours' | 'theirs', Map<number, Set<number>>> = { ours: new Map(), theirs: new Map() };
  const seeCorp = (side: 'ours' | 'theirs', p: SplitPilot) => {
    if (!p.char || !p.corp) return;
    const s = byCorp[side].get(p.corp) ?? new Set<number>();
    s.add(p.char);
    byCorp[side].set(p.corp, s);
  };
  let destroyed = 0; let lost = 0; let kills = 0; let losses = 0; let unpriced = 0;
  const friendly = (p: SplitPilot) => p.corp === corpId || (homeAlly !== 0 && p.ally === homeAlly);
  const seeFoe = (p: SplitPilot) => {
    const g = p.ally || p.corp;
    if (p.char) theirs.add(p.char);
    if (!g) return;
    const s = byGroup.get(g) ?? new Set<number>();
    if (p.char) s.add(p.char);
    byGroup.set(g, s);
  };
  for (const m of mails) {
    const s = sidesOf(m, corpId, homeAlly);
    for (const c of s.friends) ours.add(c);
    for (const p of [m.victim, ...m.attackers]) {
      if (friendly(p)) seeCorp('ours', p);
      else if (friendly(m.victim) || p === m.victim) seeCorp('theirs', p); // a friend's killers, or the enemy who died
    }
    const value = m.victim.lossValue ?? 0;
    if (!value) unpriced++;
    if (friendly(m.victim)) { lost += value; losses++; for (const a of m.attackers) if (!friendly(a)) seeFoe(a); }
    else { destroyed += value; kills++; seeFoe(m.victim); }
  }
  const enemies = [...byGroup.entries()].map(([id, set]) => ({ id, pilots: set.size }))
    .sort((a, b) => b.pilots - a.pilots || a.id - b.id);
  const corpsOf = (side: 'ours' | 'theirs') => [...byCorp[side].entries()].map(([id, set]) => ({ id, pilots: set.size }))
    .sort((a, b) => b.pilots - a.pilots || a.id - b.id);
  return { ours: ours.size, theirs: theirs.size, destroyed, lost, kills, losses, unpriced, enemies, corps: { ours: corpsOf('ours'), theirs: corpsOf('theirs') } };
}

export interface FightWhen { day: string; clock: string; length: string; ago: string }
/** a fight's time in words, EVE (UTC) days: "Today" / "Yesterday" / "Wednesday";
 * "05:07"; "30 min" / "1 h 12 min" / "under a minute"; "3 h ago" */
export function fightWhen(startMs: number, endMs: number, nowMs: number): FightWhen {
  const dayOf = (ms: number) => Math.floor(ms / 86_400_000);
  const diff = dayOf(nowMs) - dayOf(startMs);
  const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const d = new Date(startMs);
  const day = diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : diff < 7 ? WEEK[d.getUTCDay()] : d.toISOString().slice(0, 10);
  const clock = d.toISOString().slice(11, 16);
  const mins = Math.round((endMs - startMs) / MIN);
  const length = mins < 1 ? 'under a minute' : mins < 60 ? `${mins} min` : `${Math.floor(mins / 60)} h${mins % 60 ? ` ${mins % 60} min` : ''}`;
  const agoMin = Math.max(0, Math.round((nowMs - endMs) / MIN));
  const ago = agoMin < 1 ? 'just now' : agoMin < 60 ? `${agoMin} min ago` : agoMin < 48 * 60 ? `${Math.round(agoMin / 60)} h ago` : `${Math.round(agoMin / 1440)} d ago`;
  return { day, clock, length, ago };
}
