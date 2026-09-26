import { maxOf } from './nums';
// CORP LEADERBOARD (v0.208.0; widened in v0.210.0) — PURE. The owner's brief: "only compare things
// where you have equal stats for everyone you are comparing yourself to … a cool leaderboard style
// thing … it is just public data and it creates a light competitive fun environment … make everyone
// included that has activity relevant to the stats you are showing."
//
// So the ONLY input is public killmails — the one source that records every corp member the same
// way. Nothing from the player's own game logs, wallet or ESI scopes is mixed in: that data exists
// for his characters alone, and a board where one pilot is measured with a better ruler is not a
// board. What a killmail CANNOT see is said out loud (the tab's help): logistics, boosts, scouting
// and tackle that never aggressed are on no killmail, for anyone.
//
// Rules, each pinned by a fixture:
//  · a KILL is a mail whose victim is NOT in the corp and that a corp pilot is on. Shooting a corp
//    mate is nobody's kill; the mate still has the loss.
//  · one credit per pilot per mail, whatever the number of rows.
//  · a LOSS is a mail whose victim is a corp PILOT (a structure has no pilot).
//  · "ISK by damage share" = the mail's value × the pilot's share of ALL damage on it (others'
//    and NPCs' included) — what his guns destroyed, not the whole mail for everyone on it.
//  · top damage = the single highest damage row on the mail; a tie credits every corp pilot tied.
//  · solo = the only PLAYER on a mail whose victim is a player in a SHIP — not a capsule, and not a
//    structure or deployable: a tractor unit has an owner on its killmail, and popping one alone is
//    not a solo kill (v0.211.0, found by the sanity check).
//  · a pilot ATTENDED a fight when he is on any of its mails, either side.
//  · an ASSIST is a kill the pilot is on with no damage at all — a point, a web, a jam: the one
//    trace tackle and EWAR leave on a killmail.
//  · a STREAK is kills in a row with no loss between them, in the order they happened.
//  · FIRST BLOOD is being on the first kill of a fight that went on to have at least two.
//  · equal values share a rank (1, 1, 3); medals 3 / 2 / 1 for ranks 1–3 on the honour boards.

export interface LbPilotRow { char: number; corp: number; ally?: number; ship: number; dmg?: number; fb?: boolean }
export interface LbMail {
  id: number;
  /** ms epoch */
  t: number;
  value: number;
  /** solar system id, when known */
  system?: number;
  victim: LbPilotRow;
  attackers: LbPilotRow[];
  /** the attackers NOT kept row by row (a blob mail trimmed for the archive, see compactMail): how
   * many players they were and what they did — so damage shares, top damage and solo stay exact */
  others?: { players: number; dmg: number; max: number };
}

export const CAPSULES: ReadonlySet<number> = new Set([670, 33328]);

// ---- hull classes, from the inventory group of the hull (MEASURED against the app's own type
// list, 2026-09-20 — every group id below is one the list carries). A hull the list does not
// know (not on the market) is 'other'.
export type ShipClass = 'frigate' | 'destroyer' | 'cruiser' | 'battlecruiser' | 'battleship' | 'capital' | 'industrial' | 'capsule' | 'structure' | 'other';
const CLASS_GROUPS: Record<Exclude<ShipClass, 'capsule' | 'structure' | 'other'>, number[]> = {
  frigate: [25, 31, 237, 324, 830, 831, 834, 893, 1022, 1283, 1527],
  destroyer: [420, 541, 1305, 1534],
  cruiser: [26, 358, 832, 833, 894, 906, 963, 1972],
  battlecruiser: [419, 540, 1201, 4902],
  battleship: [27, 898, 900],
  capital: [30, 485, 513, 547, 659, 883, 902, 1538, 4594],
  industrial: [28, 380, 463, 543, 941, 1202],
};
const GROUP_CLASS = new Map<number, ShipClass>(Object.entries(CLASS_GROUPS).flatMap(([c, gs]) => gs.map((g) => [g, c as ShipClass] as [number, ShipClass])));
export const classOfGroup = (group: number | undefined, shipTypeId = 0): ShipClass => (CAPSULES.has(shipTypeId) ? 'capsule' : group !== undefined ? GROUP_CLASS.get(group) ?? 'other' : 'other');
export const SHIP_CLASS_LABEL: Record<ShipClass, string> = { frigate: 'Frigates', destroyer: 'Destroyers', cruiser: 'Cruisers', battlecruiser: 'Battlecruisers', battleship: 'Battleships', capital: 'Capitals', industrial: 'Industrials', capsule: 'Capsules', structure: 'Structures & deployables', other: 'Other' };
export const BIG_GAME: ReadonlySet<ShipClass> = new Set(['battleship', 'capital']);

export interface PilotStats {
  char: number;
  kills: number;
  finalBlows: number;
  topDamage: number;
  solo: number;
  damage: number;
  /** ISK of every mail the pilot is on, in full — the killboard way */
  iskOn: number;
  /** ISK weighted by the pilot's share of the damage on each mail */
  iskShare: number;
  losses: number;
  iskLost: number;
  pods: number;
  fights: number;
  /** fights attended without losing a ship (a capsule is a ship here too) */
  fightsClean: number;
  biggest: { id: number; value: number; ship: number } | null;
  /** the hull flown on the most mails (kills and losses), ties to the lower type id */
  hull: number;
  hulls: number;
  lastT: number;
  // ---- v0.210.0
  podKills: number;
  /** kills of structures and deployables — no pilot in them, or a structure by the type list */
  structureKills: number;
  /** kills of battleship-or-bigger hulls */
  bigGame: number;
  /** kills the pilot is on without a point of damage */
  assists: number;
  /** the most damage on a single kill */
  maxHit: { id: number; dmg: number } | null;
  /** the longest run of kills with no loss between them */
  streak: number;
  /** distinct EVE days with a killmail, either side */
  days: number;
  systems: number;
  /** distinct corp mates he shared a kill with */
  mates: number;
  firstBloods: number;
  biggestLoss: { id: number; value: number; ship: number } | null;
  /** the most ships lost in one fight */
  worstFight: number;
}

const blank = (char: number): PilotStats => ({
  char, kills: 0, finalBlows: 0, topDamage: 0, solo: 0, damage: 0, iskOn: 0, iskShare: 0, losses: 0, iskLost: 0, pods: 0,
  fights: 0, fightsClean: 0, biggest: null, hull: 0, hulls: 0, lastT: 0,
  podKills: 0, structureKills: 0, bigGame: 0, assists: 0, maxHit: null, streak: 0, days: 0, systems: 0, mates: 0, firstBloods: 0, biggestLoss: null, worstFight: 0,
});

export interface BoardInput {
  mails: readonly LbMail[];
  corpId: number;
  /** the fights the mails fall into (ids per fight) — for attendance; a mail in no fight counts as a fight of its own */
  fights?: readonly (readonly number[])[];
  /** only mails at or after this (ms); null = all */
  since?: number | null;
  /** …and before this (ms); null = up to now */
  until?: number | null;
  /** the class of a hull — injected so this file stays pure (the app passes the type list's) */
  classOf?: (shipTypeId: number) => ShipClass;
}

/** A BLOB MAIL, TRIMMED FOR THE ARCHIVE (v0.211.0): two years of a big corp's killmails would be
 * hundreds of megabytes if every one of 200 attackers were kept. A mail with more than `cap` rows
 * keeps every CORP row and the biggest outsiders, and folds the rest into `others` — their count,
 * their damage, their best hit — which is all the board ever reads of them. Small-gang mails are
 * kept whole. PURE; the numbers a board shows are identical before and after (fixture). */
export function compactMail<T extends LbMail>(m: T, corpId: number, cap = 40): T {
  if (m.attackers.length <= cap) return m;
  const ours = m.attackers.filter((a) => a.corp === corpId);
  const rest = m.attackers.filter((a) => a.corp !== corpId).sort((a, b) => (b.dmg ?? 0) - (a.dmg ?? 0));
  const keep = rest.slice(0, Math.max(0, cap - ours.length)), drop = rest.slice(Math.max(0, cap - ours.length));
  if (drop.length === 0) return m;
  const kept = new Set([...ours, ...keep].filter((a) => a.char > 0).map((a) => a.char));
  const players = new Set(drop.filter((a) => a.char > 0 && !kept.has(a.char)).map((a) => a.char)).size;
  return { ...m, attackers: [...ours, ...keep], others: { players: players + (m.others?.players ?? 0), dmg: drop.reduce((t, a) => t + (a.dmg ?? 0), 0) + (m.others?.dmg ?? 0), max: Math.max(m.others?.max ?? 0, maxOf(drop.map((a) => a.dmg ?? 0))) } };
}

/** the mails of a window, once each */
export function windowMails(inp: Pick<BoardInput, 'mails' | 'since' | 'until'>): LbMail[] {
  const since = inp.since ?? null, until = inp.until ?? null;
  const seen = new Set<number>();
  return inp.mails.filter((m) => { if (seen.has(m.id) || (since !== null && m.t < since) || (until !== null && m.t >= until)) return false; seen.add(m.id); return true; });
}
/** the corp pilots on a kill mail, one row each — the row with the most damage speaks for him */
export function corpRows(m: LbMail, corpId: number): Map<number, LbPilotRow> {
  const mine = new Map<number, LbPilotRow>();
  for (const a of m.attackers) {
    if (a.corp !== corpId || !(a.char > 0)) continue;
    const p = mine.get(a.char);
    if (!p || (a.dmg ?? 0) > (p.dmg ?? 0)) mine.set(a.char, { ...a, fb: a.fb || p?.fb });
    else if (a.fb) p.fb = true;
  }
  return mine;
}
const dayOf = (ms: number) => Math.floor(ms / 86_400_000);

export function pilotStats(inp: BoardInput): PilotStats[] {
  const { corpId } = inp;
  const mails = windowMails(inp);
  const seen = new Set(mails.map((m) => m.id));
  const stats = new Map<number, PilotStats>();
  const hullUse = new Map<number, Map<number, number>>();
  const of = (c: number) => { let s = stats.get(c); if (!s) { s = blank(c); stats.set(c, s); } return s; };
  const flew = (c: number, ship: number) => { if (!ship || CAPSULES.has(ship)) return; let h = hullUse.get(c); if (!h) { h = new Map(); hullUse.set(c, h); } h.set(ship, (h.get(ship) ?? 0) + 1); };
  /** char → the mails he is on, and the mails he lost a ship on */
  const onMail = new Map<number, Set<number>>(); const lostOn = new Map<number, Set<number>>();
  const mark = <T>(m: Map<number, Set<T>>, c: number, v: T) => { let s = m.get(c); if (!s) { s = new Set(); m.set(c, s); } s.add(v); };
  const daysOf = new Map<number, Set<number>>(), systemsOf = new Map<number, Set<number>>(), matesOf = new Map<number, Set<number>>();
  /** char → his kills and losses in the order they happened, for the streak */
  const events = new Map<number, { t: number; id: number; kill: boolean }[]>();
  const event = (c: number, m: LbMail, kill: boolean) => { let e = events.get(c); if (!e) { e = []; events.set(c, e); } e.push({ t: m.t, id: m.id, kill }); };
  const killMails = new Set<number>();
  const seenAt = (c: number, m: LbMail) => { mark(daysOf, c, dayOf(m.t)); if (m.system) mark(systemsOf, c, m.system); };

  for (const m of mails) {
    const victimOurs = m.victim.corp === corpId;
    if (victimOurs && m.victim.char > 0) {
      const s = of(m.victim.char);
      s.losses++; s.iskLost += m.value; s.lastT = Math.max(s.lastT, m.t);
      if (CAPSULES.has(m.victim.ship)) s.pods++;
      if (!s.biggestLoss || m.value > s.biggestLoss.value) s.biggestLoss = { id: m.id, value: m.value, ship: m.victim.ship };
      flew(m.victim.char, m.victim.ship);
      mark(onMail, m.victim.char, m.id); mark(lostOn, m.victim.char, m.id);
      event(m.victim.char, m, false); seenAt(m.victim.char, m);
    }
    if (victimOurs) continue; // shooting a corp mate is nobody's kill
    const mine = corpRows(m, corpId);
    if (mine.size === 0) continue;
    killMails.add(m.id);
    const total = m.attackers.reduce((t, a) => t + (a.dmg ?? 0), 0) + (m.others?.dmg ?? 0);
    const max = Math.max(m.attackers.reduce((t, a) => Math.max(t, a.dmg ?? 0), 0), m.others?.max ?? 0);
    const players = new Set(m.attackers.filter((a) => a.char > 0).map((a) => a.char));
    const playerCount = players.size + (m.others?.players ?? 0);
    // no pilot in it, or the type list says it is a structure / deployable (they carry their OWNER as the victim)
    const notAShip = !(m.victim.char > 0) || (!!inp.classOf && inp.classOf(m.victim.ship) === 'structure');
    const soloMail = playerCount === 1 && !notAShip && !CAPSULES.has(m.victim.ship);
    const big = !!inp.classOf && BIG_GAME.has(inp.classOf(m.victim.ship));
    for (const [c, a] of mine) {
      const s = of(c);
      const dmg = a.dmg ?? 0;
      s.kills++; s.damage += dmg; s.iskOn += m.value; s.lastT = Math.max(s.lastT, m.t);
      if (total > 0) s.iskShare += m.value * (dmg / total);
      if (a.fb) s.finalBlows++;
      if (max > 0 && dmg === max) s.topDamage++;
      if (soloMail) s.solo++;
      if (dmg === 0) s.assists++;
      if (CAPSULES.has(m.victim.ship)) s.podKills++;
      if (notAShip) s.structureKills++;
      if (big) s.bigGame++;
      if (!s.maxHit || dmg > s.maxHit.dmg) s.maxHit = dmg > 0 ? { id: m.id, dmg } : s.maxHit;
      if (!s.biggest || m.value > s.biggest.value) s.biggest = { id: m.id, value: m.value, ship: m.victim.ship };
      flew(c, a.ship);
      mark(onMail, c, m.id); event(c, m, true); seenAt(c, m);
      for (const other of mine.keys()) if (other !== c) mark(matesOf, c, other);
    }
  }

  // attendance: a mail in none of the given fights is a fight of its own
  const inFight = new Set<number>();
  const fights: number[][] = [];
  for (const f of inp.fights ?? []) { const ids = f.filter((id) => seen.has(id)); if (ids.length > 0) { fights.push(ids); for (const id of ids) inFight.add(id); } }
  for (const m of mails) if (!inFight.has(m.id)) fights.push([m.id]);
  const tOf = new Map(mails.map((m) => [m.id, m.t]));
  // first blood: the first kill (by time, then id) of a fight that had at least two
  const firstKill = new Set<number>();
  for (const f of fights) {
    const kills = f.filter((id) => killMails.has(id)).sort((a, b) => (tOf.get(a)! - tOf.get(b)!) || a - b);
    if (kills.length >= 2) firstKill.add(kills[0]);
  }
  for (const [c, ids] of onMail) {
    const s = of(c);
    for (const f of fights) {
      if (!f.some((id) => ids.has(id))) continue;
      s.fights++;
      const lostHere = f.filter((id) => lostOn.get(c)?.has(id)).length;
      if (lostHere === 0) s.fightsClean++;
      s.worstFight = Math.max(s.worstFight, lostHere);
    }
    for (const id of ids) if (firstKill.has(id) && !lostOn.get(c)?.has(id)) s.firstBloods++;
  }
  for (const [c, h] of hullUse) {
    const s = of(c);
    s.hulls = h.size;
    s.hull = [...h.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
  }
  for (const [c, ev] of events) {
    let run = 0, best = 0;
    for (const e of ev.sort((a, b) => a.t - b.t || a.id - b.id)) { run = e.kill ? run + 1 : 0; best = Math.max(best, run); }
    of(c).streak = best;
  }
  for (const s of stats.values()) { s.days = daysOf.get(s.char)?.size ?? 0; s.systems = systemsOf.get(s.char)?.size ?? 0; s.mates = matesOf.get(s.char)?.size ?? 0; }
  return [...stats.values()].sort((a, b) => b.kills - a.kills || b.damage - a.damage || a.char - b.char);
}

// ---- the boards
export type BoardId = 'kills' | 'damage' | 'finalBlows' | 'topDamage' | 'iskShare' | 'solo' | 'whale' | 'fights' | 'untouchable' | 'trade'
  | 'streak' | 'maxHit' | 'bigGame' | 'podKills' | 'structures' | 'assist' | 'firstBlood' | 'mates' | 'days' | 'systems' | 'hulls'
  | 'spender' | 'pods' | 'bigLoss' | 'whelp';
export type BoardGroup = 'kills' | 'isk' | 'showing' | 'style' | 'spoons';
export const BOARD_GROUPS: { id: BoardGroup; title: string; blurb: string }[] = [
  { id: 'kills', title: 'Kills', blurb: 'who gets them, and how' },
  { id: 'isk', title: 'Damage & ISK', blurb: 'what the guns actually did' },
  { id: 'showing', title: 'Showing up', blurb: 'being there counts' },
  { id: 'style', title: 'Style', blurb: 'the ways to make a name' },
  { id: 'spoons', title: 'Wooden spoons', blurb: 'no medals here — somebody has to feed the killboard' },
];
export interface BoardSpec {
  id: BoardId; icon: string; group: BoardGroup;
  /** what is counted, in plain words — readable without the description (v0.211.0) */
  title: string;
  /** the fun name, shown small beside it */
  nick: string;
  /** what is ranked, in words — shown under the title */
  blurb: string;
  unit: 'n' | 'isk' | 'pct' | 'dmg';
  /** an honour board awards medals; the wooden spoons do not */
  honour: boolean;
  value: (s: PilotStats) => number | null;
}
export const UNTOUCHABLE_MIN_FIGHTS = 3;
export const TRADE_MIN_MAILS = 3;
export const BOARDS: BoardSpec[] = [
  { id: 'kills', group: 'kills', icon: '🗡', title: 'Most kills', nick: 'Reaper', blurb: 'killmails the pilot is on', unit: 'n', honour: true, value: (s) => s.kills || null },
  { id: 'finalBlows', group: 'kills', icon: '🎯', title: 'Final blows', nick: 'Closer', blurb: 'final blows landed', unit: 'n', honour: true, value: (s) => s.finalBlows || null },
  { id: 'topDamage', group: 'kills', icon: '🥇', title: 'Top damage on the kill', nick: 'Carried it', blurb: 'kills where the pilot did the most damage of anyone', unit: 'n', honour: true, value: (s) => s.topDamage || null },
  { id: 'solo', group: 'kills', icon: '🐺', title: 'Solo kills', nick: 'Lone wolf', blurb: 'ship kills with no other player on the mail', unit: 'n', honour: true, value: (s) => s.solo || null },
  { id: 'streak', group: 'kills', icon: '🔥', title: 'Longest kill streak', nick: 'On fire', blurb: 'the longest run of kills with no loss in between', unit: 'n', honour: true, value: (s) => (s.streak >= 2 ? s.streak : null) },
  { id: 'firstBlood', group: 'kills', icon: '⚡', title: 'First kill of the fight', nick: 'First blood', blurb: 'on the first kill of a fight that had at least two', unit: 'n', honour: true, value: (s) => s.firstBloods || null },
  { id: 'damage', group: 'isk', icon: '💥', title: 'Total damage dealt', nick: 'Heavy hitter', blurb: 'damage dealt on kills', unit: 'dmg', honour: true, value: (s) => s.damage || null },
  { id: 'maxHit', group: 'isk', icon: '🧨', title: 'Most damage on one kill', nick: 'One big hit', blurb: 'the most damage on a single kill', unit: 'dmg', honour: true, value: (s) => s.maxHit?.dmg || null },
  { id: 'iskShare', group: 'isk', icon: '💰', title: 'ISK destroyed (by damage share)', nick: 'Bank breaker', blurb: 'each kill’s value × the pilot’s share of the damage', unit: 'isk', honour: true, value: (s) => s.iskShare || null },
  { id: 'whale', group: 'isk', icon: '🐋', title: 'Most valuable kill', nick: 'Whale hunter', blurb: 'the single most valuable kill the pilot was on', unit: 'isk', honour: true, value: (s) => s.biggest?.value || null },
  { id: 'trade', group: 'isk', icon: '⚖', title: 'ISK efficiency', nick: 'Good trade', blurb: `ISK destroyed by damage share ÷ (that + ISK lost) — ${TRADE_MIN_MAILS}+ killmails`, unit: 'pct', honour: true, value: (s) => (s.kills + s.losses >= TRADE_MIN_MAILS && s.iskShare + s.iskLost > 0 ? s.iskShare / (s.iskShare + s.iskLost) : null) },
  { id: 'fights', group: 'showing', icon: '🛡', title: 'Fights attended', nick: 'Always there', blurb: 'fights the pilot showed up on a killmail for', unit: 'n', honour: true, value: (s) => s.fights || null },
  { id: 'days', group: 'showing', icon: '📅', title: 'Days active', nick: 'Regular', blurb: 'EVE days with a killmail, either side', unit: 'n', honour: true, value: (s) => (s.days >= 2 ? s.days : null) },
  { id: 'untouchable', group: 'showing', icon: '🍀', title: 'Fights without a loss', nick: 'Untouchable', blurb: `fights attended without losing a ship (${UNTOUCHABLE_MIN_FIGHTS}+ fights)`, unit: 'n', honour: true, value: (s) => (s.fights >= UNTOUCHABLE_MIN_FIGHTS && s.fightsClean > 0 ? s.fightsClean : null) },
  { id: 'mates', group: 'showing', icon: '🤝', title: 'Corp mates flown with', nick: 'Wingman', blurb: 'different corp mates the pilot shared a kill with', unit: 'n', honour: true, value: (s) => s.mates || null },
  { id: 'assist', group: 'style', icon: '🕸', title: 'Assists (tackle & EWAR)', nick: 'Helping hand', blurb: 'kills the pilot is on without a point of damage — the trace tackle and EWAR leave', unit: 'n', honour: true, value: (s) => s.assists || null },
  { id: 'bigGame', group: 'style', icon: '🐘', title: 'Battleships & capitals killed', nick: 'Big game', blurb: 'kills of battleship-or-bigger hulls', unit: 'n', honour: true, value: (s) => s.bigGame || null },
  { id: 'structures', group: 'style', icon: '🏗', title: 'Structures killed', nick: 'Demolition', blurb: 'structures and deployables killed — citadels, tractor units, bubbles', unit: 'n', honour: true, value: (s) => s.structureKills || null },
  { id: 'podKills', group: 'style', icon: '🍳', title: 'Pods killed', nick: 'Egg hunter', blurb: 'capsules killed', unit: 'n', honour: true, value: (s) => s.podKills || null },
  { id: 'hulls', group: 'style', icon: '🎭', title: 'Different ships flown', nick: 'Hangar queen', blurb: 'different hulls flown onto a killmail', unit: 'n', honour: true, value: (s) => (s.hulls >= 2 ? s.hulls : null) },
  { id: 'systems', group: 'style', icon: '🌍', title: 'Different systems fought in', nick: 'Globetrotter', blurb: 'different systems with a killmail', unit: 'n', honour: true, value: (s) => (s.systems >= 2 ? s.systems : null) },
  { id: 'spender', group: 'spoons', icon: '💸', title: 'Most ISK lost', nick: 'Big spender', blurb: 'ISK lost', unit: 'isk', honour: false, value: (s) => s.iskLost || null },
  { id: 'bigLoss', group: 'spoons', icon: '💎', title: 'Most expensive loss', nick: 'Expensive taste', blurb: 'the single most valuable loss', unit: 'isk', honour: false, value: (s) => s.biggestLoss?.value || null },
  { id: 'pods', group: 'spoons', icon: '🥚', title: 'Pods lost', nick: 'Pod express', blurb: 'capsules lost', unit: 'n', honour: false, value: (s) => s.pods || null },
  { id: 'whelp', group: 'spoons', icon: '🪦', title: 'Most ships lost in one fight', nick: 'Whelped', blurb: 'the most ships lost in a single fight', unit: 'n', honour: false, value: (s) => (s.worstFight >= 2 ? s.worstFight : null) },
];

export interface Ranked { char: number; value: number; rank: number }
/** highest first; equal values share a rank (1, 1, 3); pilots with nothing to rank are left off */
export function rankBoard(stats: readonly PilotStats[], spec: BoardSpec): Ranked[] {
  const rows = stats.map((s) => ({ char: s.char, value: spec.value(s) })).filter((r): r is { char: number; value: number } => r.value !== null && r.value > 0)
    .sort((a, b) => b.value - a.value || a.char - b.char);
  let rank = 0;
  return rows.map((r, i) => { if (i === 0 || r.value !== rows[i - 1].value) rank = i + 1; return { ...r, rank }; });
}

export const MEDAL_POINTS = [3, 2, 1];
export interface MedalRow { char: number; gold: number; silver: number; bronze: number; points: number; rank: number }
/** the medals table over the honour boards: 3 / 2 / 1 points for ranks 1 / 2 / 3, ties all paid */
export function medalTable(stats: readonly PilotStats[]): MedalRow[] {
  const acc = new Map<number, MedalRow>();
  for (const spec of BOARDS) {
    if (!spec.honour) continue;
    for (const r of rankBoard(stats, spec)) {
      if (r.rank > 3) break;
      let row = acc.get(r.char);
      if (!row) { row = { char: r.char, gold: 0, silver: 0, bronze: 0, points: 0, rank: 0 }; acc.set(r.char, row); }
      if (r.rank === 1) row.gold++; else if (r.rank === 2) row.silver++; else row.bronze++;
      row.points += MEDAL_POINTS[r.rank - 1];
    }
  }
  const rows = [...acc.values()].sort((a, b) => b.points - a.points || b.gold - a.gold || b.silver - a.silver || a.char - b.char);
  let rank = 0;
  return rows.map((r, i) => { const p = rows[i - 1]; if (i === 0 || r.points !== p.points || r.gold !== p.gold || r.silver !== p.silver) rank = i + 1; return { ...r, rank }; });
}

/** how a pilot's place on the medals table moved against the window before: +2 = up two places,
 * null = he was not on it then */
export function rankMoves(now: readonly MedalRow[], before: readonly MedalRow[]): Map<number, number | null> {
  const was = new Map(before.map((r) => [r.char, r.rank]));
  return new Map(now.map((r) => [r.char, was.has(r.char) ? was.get(r.char)! - r.rank : null]));
}

// ---- windows: rolling days, an EVE calendar month or year, or ANY span the player picks
export interface WindowSpec { id: string; label: string; days: number | null; month?: 0 | -1; year?: 0 }
export const WINDOWS: WindowSpec[] = [
  { id: '1', label: '24 h', days: 1 }, { id: '3', label: '3 d', days: 3 }, { id: '7', label: '7 d', days: 7 }, { id: '14', label: '14 d', days: 14 }, { id: '30', label: '30 d', days: 30 }, { id: '90', label: '90 d', days: 90 },
  { id: 'month', label: 'this month', days: null, month: 0 }, { id: 'last-month', label: 'last month', days: null, month: -1 }, { id: 'year', label: 'this year', days: null, year: 0 },
  { id: 'all', label: 'everything held', days: null },
];
export interface Span { since: number | null; until: number | null }
const DAY_MS = 86_400_000;
const monthStart = (now: number, offset: number) => { const d = new Date(now); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offset, 1); };
/** the equal-length span just before one — what the rank arrows compare with. An open-ended span
 * runs to `now`; "everything" has nothing before it */
export function spanBefore(span: Span, now: number): Span | null {
  if (span.since === null) return null;
  const len = (span.until ?? now) - span.since;
  return len > 0 ? { since: span.since - len, until: span.since } : null;
}
/** the window as asked for; and the window just before it (null for "everything"). A calendar
 * month is compared with the calendar month before it, a year with the year before */
export function windowSpan(w: WindowSpec, now: number): { span: Span; before: Span | null } {
  if (w.month !== undefined) {
    const since = monthStart(now, w.month), until = w.month === 0 ? null : monthStart(now, w.month + 1);
    return { span: { since, until }, before: { since: monthStart(now, w.month - 1), until: since } };
  }
  if (w.year !== undefined) {
    const y = new Date(now).getUTCFullYear();
    return { span: { since: Date.UTC(y, 0, 1), until: null }, before: { since: Date.UTC(y - 1, 0, 1), until: Date.UTC(y, 0, 1) } };
  }
  if (w.days === null) return { span: { since: null, until: null }, before: null };
  const span = { since: now - w.days * DAY_MS, until: null };
  return { span, before: spanBefore(span, now) };
}
/** one EVE calendar month, "2026-05" → 1 May 00:00 up to 1 June 00:00; compared with April. null on nonsense */
export function monthSpan(ym: string): { span: Span; before: Span } | null {
  const m = /^(\d{4})-(\d{2})$/.exec(ym);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return null;
  const y = Number(m[1]), mo = Number(m[2]) - 1;
  return { span: { since: Date.UTC(y, mo, 1), until: Date.UTC(y, mo + 1, 1) }, before: { since: Date.UTC(y, mo - 1, 1), until: Date.UTC(y, mo, 1) } };
}
/** two EVE dates, BOTH INCLUDED: "2026-05-03" … "2026-05-09" is seven whole days. Swapped dates are
 * put right; an empty "to" runs to now; null on nonsense */
export function dateSpan(from: string, to: string, now: number): { span: Span; before: Span | null } | null {
  const day = (s: string): number | null => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return null; const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])); return new Date(t).toISOString().slice(0, 10) === s ? t : null; };
  let a = day(from); let b = to ? day(to) : null;
  if (a === null || (to && b === null)) return null;
  if (b !== null && b < a) [a, b] = [b, a];
  const span = { since: a, until: b === null ? null : b + DAY_MS };
  return { span, before: spanBefore(span, now) };
}
/** the months from this one back `monthsBack`, newest first: ["2026-09", "2026-08", …] — what a history read walks */
export function monthsBackFrom(now: number, monthsBack: number): string[] {
  const d = new Date(now);
  return Array.from({ length: Math.max(0, Math.floor(monthsBack)) + 1 }, (_, i) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
}
// ---- FROM WHEN THE HELD KILLMAILS ARE COMPLETE (v0.212.0) — worked out from WHAT WAS READ, never
// from a remembered number. v0.211 stored "complete since X" in the archive; two loads running at
// once overwrote each other's X and a board holding 40,000 killmails believed it was complete from
// five days ago. Now it is a chain, rebuilt every time from three facts:
//   recentFloor  the newest lists (200 rows each) are complete from here to now (0 = a list that
//                was not full: it is everything zKillboard has)
//   curReadAt    this month was read whole, to date, at this moment
//   whole        the past months read whole
// The chain holds only while each link reaches the next: the recent lists must reach back to the
// moment this month was read (or kills between the two are missing), and the whole months must
// run back without a gap. Where the chain breaks, completeness ends.
export function heldFloor(o: { now: number; recentFloor: number | null; curYm: string | null; curReadAt: number | null; whole: readonly string[] }): number | null {
  if (o.recentFloor === null) return null;
  const months = monthsBackFrom(o.now, 600);
  if (o.curYm !== months[0] || o.curReadAt === null || o.recentFloor > o.curReadAt) return o.recentFloor;
  const whole = new Set(o.whole);
  let ym = months[0];
  for (let i = 1; i < months.length && whole.has(months[i]); i++) ym = months[i];
  const [y, m] = ym.split('-').map(Number);
  return Math.min(o.recentFloor, Date.UTC(y, m - 1, 1));
}

// ---- WHAT IS HELD, MONTH BY MONTH (v0.212.0) — the strip under the title. The owner: "i dont even
// know if I see all the data in some or all of the views". One cell per month, oldest first:
//   whole    every killmail of that month is held (read whole from the history; it cannot change)
//   current  this month: held up to the last read
//   partial  some of it is held, but not known to be all of it (the part before `completeSince`)
//   reading  the history is on it right now
//   none     nothing held yet
export type CellState = 'whole' | 'current' | 'partial' | 'reading' | 'none';
export interface CoverageCell { ym: string; mails: number; state: CellState; inView: boolean }
export function coverageCells(o: { counts: ReadonlyMap<string, number>; whole: readonly string[]; completeSince: number | null; now: number; monthsBack: number; reading?: string | null; view?: Span }): CoverageCell[] {
  const whole = new Set(o.whole);
  const cur = monthsBackFrom(o.now, 0)[0];
  return monthsBackFrom(o.now, o.monthsBack).reverse().map((ym) => {
    const mails = o.counts.get(ym) ?? 0;
    const [y, m] = ym.split('-').map(Number);
    const start = Date.UTC(y, m - 1, 1), end = Date.UTC(y, m, 1);
    // complete from before the month began = whole, however it came to be held
    const complete = o.completeSince !== null && o.completeSince <= start;
    const state: CellState = o.reading === ym ? 'reading' : ym === cur ? (mails > 0 || complete ? 'current' : 'none') : whole.has(ym) || (complete && ym < cur) ? 'whole' : mails > 0 ? 'partial' : 'none';
    const v = o.view;
    const inView = !v ? false : (v.since === null || v.since < end) && (v.until === null ? start <= o.now : v.until > start);
    return { ym, mails, state, inView };
  });
}
/** is every month the view touches held whole (or the current one)? — the one-word answer */
export const viewIsComplete = (cells: readonly CoverageCell[]): boolean => { const v = cells.filter((c) => c.inView); return v.length > 0 && v.every((c) => c.state === 'whole' || c.state === 'current'); };

/** the months a set of killmails touches, newest first — the month picker's choices */
export function monthsHeld(mails: readonly { t: number }[], heldSince: number | null): string[] {
  const out = new Set<string>();
  for (const m of mails) if (heldSince === null || m.t >= heldSince) out.add(new Date(m.t).toISOString().slice(0, 7));
  return [...out].sort().reverse();
}

// ---- how far back the board can honestly reach
export interface Coverage { since: number | null; asked: number | null; short: boolean; /** nothing is known yet about what is complete (the first moments of a session): the range is honoured as asked, and nothing is claimed about it */ unknown?: boolean }
/** `heldSince` = the oldest moment the held killmails are known to be COMPLETE from (null = nothing
 * held). A window that starts before it is shortened to it, and says so. */
export function coverage(heldSince: number | null, now: number, days: number | null): Coverage {
  const asked = days === null ? null : now - days * 86_400_000;
  return coverSpan(heldSince, asked);
}
export function coverSpan(heldSince: number | null, asked: number | null): Coverage {
  // v0.212.0: this returned since = null — "no lower bound" — so a 7-day view showed EVERYTHING held,
  // with a tick, until the first read came back
  if (heldSince === null) return { since: asked, asked, short: false, unknown: true };
  if (asked === null || asked < heldSince) return { since: heldSince, asked, short: asked !== null };
  return { since: asked, asked, short: false };
}
/** the window before can only be compared with when it is held WHOLE */
export const beforeIsHeld = (heldSince: number | null, before: Span | null): boolean => heldSince !== null && !!before && before.since !== null && before.since >= heldSince;

/** zKillboard's lists are capped (200 newest per page), so what is held is COMPLETE only from some
 * moment on. Per list: not full → it is everything zKillboard has (no floor); full and it reaches
 * into what was already held (`overlap`) → the earlier completeness still stands; full with no
 * overlap → older mails may be missing, complete only from its oldest row. The board is complete
 * from the LATEST of the lists' floors; null = as far back as zKillboard goes. */
export function completeSince(lists: readonly { full: boolean; oldestT: number | null; overlap: boolean }[], previous: number | null): number | null {
  let floor: number | null = null;
  for (const l of lists) {
    const f = !l.full ? null : l.overlap && previous !== null ? previous : l.oldestT;
    if (f !== null) floor = floor === null ? f : Math.max(floor, f);
  }
  return floor;
}

export function fmtBoardValue(v: number, unit: BoardSpec['unit'], isk: (n: number) => string): string {
  if (unit === 'isk') return isk(v);
  if (unit === 'pct') return `${(v * 100).toFixed(1)}%`;
  if (unit === 'dmg') return v >= 1e6 ? `${(v / 1e6).toFixed(2)}m` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}k` : String(Math.round(v));
  return String(v);
}
