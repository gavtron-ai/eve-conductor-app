// THE LEADERBOARD'S OTHER PAGES (v0.210.0) — PURE, over the same killmails and the same
// definitions as lib/leaderboard.ts: a pilot's card, the hall of fame, the corp's days, and the
// text a player pastes into chat.
import { BOARDS, CAPSULES, corpRows, medalTable, pilotStats, rankBoard, windowMails, type BoardInput, type LbMail, type MedalRow, type PilotStats, type ShipClass } from './leaderboard';

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isLoss = (m: LbMail, corpId: number) => m.victim.corp === corpId && m.victim.char > 0;
const isKill = (m: LbMail, corpId: number) => m.victim.corp !== corpId && corpRows(m, corpId).size > 0;

// ---- one pilot's card
export interface ProfileMail { id: number; t: number; kind: 'kill' | 'loss'; ship: number; value: number; dmg: number; fb: boolean; flew: number }
export interface PilotProfile {
  stats: PilotStats;
  medal: MedalRow | null;
  /** his place on every board he is on, best place first */
  places: { id: string; rank: number; of: number; value: number }[];
  hours: number[];
  hulls: { ship: number; uses: number; lost: number }[];
  classes: { cls: ShipClass; uses: number }[];
  /** the outsider on the most of his losses / the pilot he killed the most; null when there is none */
  nemesis: { char: number; n: number } | null;
  prey: { char: number; n: number } | null;
  /** the corp mate on the most of his kills */
  buddy: { char: number; n: number } | null;
  recent: ProfileMail[];
}
const topOf = (m: Map<number, number>): { char: number; n: number } | null => {
  const best = [...m.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
  return best ? { char: best[0], n: best[1] } : null;
};
export function pilotProfile(inp: BoardInput, char: number, keepRecent = 12): PilotProfile | null {
  const stats = pilotStats(inp);
  const mine = stats.find((s) => s.char === char);
  if (!mine) return null;
  const places = BOARDS.map((b) => { const rows = rankBoard(stats, b); const r = rows.find((x) => x.char === char); return r ? { id: b.id, rank: r.rank, of: rows.length, value: r.value } : null; })
    .filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => a.rank - b.rank || b.of - a.of);
  const hours = new Array<number>(24).fill(0);
  const hulls = new Map<number, { ship: number; uses: number; lost: number }>();
  const classes = new Map<ShipClass, number>();
  const nemesis = new Map<number, number>(), prey = new Map<number, number>(), buddy = new Map<number, number>();
  const recent: ProfileMail[] = [];
  const flew = (ship: number, lost: boolean) => {
    if (!ship || CAPSULES.has(ship)) return;
    let h = hulls.get(ship); if (!h) { h = { ship, uses: 0, lost: 0 }; hulls.set(ship, h); }
    h.uses++; if (lost) h.lost++;
    if (inp.classOf) { const c = inp.classOf(ship); classes.set(c, (classes.get(c) ?? 0) + 1); }
  };
  for (const m of windowMails(inp)) {
    if (isLoss(m, inp.corpId) && m.victim.char === char) {
      hours[new Date(m.t).getUTCHours()]++; flew(m.victim.ship, true);
      for (const c of new Set(m.attackers.filter((a) => a.char > 0 && a.corp !== inp.corpId).map((a) => a.char))) nemesis.set(c, (nemesis.get(c) ?? 0) + 1);
      recent.push({ id: m.id, t: m.t, kind: 'loss', ship: m.victim.ship, value: m.value, dmg: m.victim.dmg ?? 0, fb: false, flew: m.victim.ship });
      continue;
    }
    if (m.victim.corp === inp.corpId) continue;
    const rows = corpRows(m, inp.corpId);
    const me = rows.get(char);
    if (!me) continue;
    hours[new Date(m.t).getUTCHours()]++; flew(me.ship, false);
    if (m.victim.char > 0) prey.set(m.victim.char, (prey.get(m.victim.char) ?? 0) + 1);
    for (const c of rows.keys()) if (c !== char) buddy.set(c, (buddy.get(c) ?? 0) + 1);
    recent.push({ id: m.id, t: m.t, kind: 'kill', ship: m.victim.ship, value: m.value, dmg: me.dmg ?? 0, fb: !!me.fb, flew: me.ship });
  }
  return {
    stats: mine, medal: medalTable(stats).find((r) => r.char === char) ?? null, places, hours,
    hulls: [...hulls.values()].sort((a, b) => b.uses - a.uses || a.ship - b.ship),
    classes: [...classes.entries()].map(([cls, uses]) => ({ cls, uses })).sort((a, b) => b.uses - a.uses || a.cls.localeCompare(b.cls)),
    nemesis: topOf(nemesis), prey: topOf(prey), buddy: topOf(buddy),
    recent: recent.sort((a, b) => b.t - a.t || b.id - a.id).slice(0, keepRecent),
  };
}

// ---- the hall of fame: the window's records
export interface Record1 { chars: number[]; value: number; mail?: number; ship?: number; note?: string }
export interface HallOfFame {
  biggestKill: Record1 | null; biggestLoss: Record1 | null; hardestHit: Record1 | null; longestStreak: Record1 | null;
  mostKillsInFight: Record1 | null; busiestDay: (Record1 & { day: string }) | null;
  /** the fight the most corp pilots were on a killmail for */
  biggestFight: { pilots: number; kills: number; losses: number; mails: number; startT: number } | null;
}
export function hallOfFame(inp: BoardInput): HallOfFame {
  const { corpId } = inp;
  const mails = windowMails(inp);
  const byId = new Map(mails.map((m) => [m.id, m]));
  const stats = pilotStats(inp);
  let biggestKill: Record1 | null = null, biggestLoss: Record1 | null = null, hardestHit: Record1 | null = null;
  const perDay = new Map<string, number>();
  for (const m of mails) {
    if (isLoss(m, corpId)) { if (!biggestLoss || m.value > biggestLoss.value) biggestLoss = { chars: [m.victim.char], value: m.value, mail: m.id, ship: m.victim.ship }; continue; }
    if (!isKill(m, corpId)) continue;
    const rows = corpRows(m, corpId);
    perDay.set(dayKey(m.t), (perDay.get(dayKey(m.t)) ?? 0) + 1);
    if (!biggestKill || m.value > biggestKill.value) biggestKill = { chars: [...rows.keys()].sort((a, b) => a - b), value: m.value, mail: m.id, ship: m.victim.ship };
    for (const [c, a] of rows) if ((a.dmg ?? 0) > 0 && (!hardestHit || (a.dmg ?? 0) > hardestHit.value)) hardestHit = { chars: [c], value: a.dmg ?? 0, mail: m.id, ship: m.victim.ship };
  }
  const bestStreak = Math.max(0, ...stats.map((s) => s.streak));
  // fights: the given ones, plus every loose mail as a fight of its own
  const inFight = new Set<number>(); const fights: number[][] = [];
  for (const f of inp.fights ?? []) { const ids = f.filter((id) => byId.has(id)); if (ids.length > 0) { fights.push(ids); ids.forEach((id) => inFight.add(id)); } }
  for (const m of mails) if (!inFight.has(m.id)) fights.push([m.id]);
  let biggestFight: HallOfFame['biggestFight'] = null, mostKillsInFight: Record1 | null = null;
  for (const f of fights) {
    const pilots = new Set<number>(); const killsBy = new Map<number, number>(); let kills = 0, losses = 0, startT = Infinity;
    for (const id of f) {
      const m = byId.get(id)!; startT = Math.min(startT, m.t);
      if (isLoss(m, corpId)) { losses++; pilots.add(m.victim.char); } else if (isKill(m, corpId)) { kills++; for (const c of corpRows(m, corpId).keys()) { pilots.add(c); killsBy.set(c, (killsBy.get(c) ?? 0) + 1); } }
    }
    if (pilots.size > 0 && (!biggestFight || pilots.size > biggestFight.pilots || (pilots.size === biggestFight.pilots && (f.length > biggestFight.mails || (f.length === biggestFight.mails && startT < biggestFight.startT))))) biggestFight = { pilots: pilots.size, kills, losses, mails: f.length, startT };
    const top = Math.max(0, ...killsBy.values());
    if (top >= 2 && (!mostKillsInFight || top > mostKillsInFight.value)) mostKillsInFight = { chars: [...killsBy.entries()].filter(([, n]) => n === top).map(([c]) => c).sort((a, b) => a - b), value: top };
  }
  const day = [...perDay.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return {
    biggestKill, biggestLoss, hardestHit, mostKillsInFight, biggestFight,
    longestStreak: bestStreak >= 2 ? { chars: stats.filter((s) => s.streak === bestStreak).map((s) => s.char).sort((a, b) => a - b), value: bestStreak } : null,
    busiestDay: day ? { chars: [], value: day[1], day: day[0] } : null,
  };
}

// ---- the corp's days — or weeks, or months, when the span is long
export type Bucket = 'day' | 'week' | 'month';
export interface CorpDay { day: string; kills: number; losses: number; destroyed: number; lost: number; pilots: number; bucket: Bucket }
export const DAILY_UP_TO = 92, WEEKLY_UP_TO = 550;
/** one row per EVE day from the first day of the window (or of what is held) to `now`, empty days
 * kept. Past 92 days the rows are WEEKS (Monday to Sunday, labelled by their Monday), past 550
 * days calendar MONTHS — two years of daily bars would be a smear, not a chart */
export function corpDays(inp: BoardInput, now: number): CorpDay[] {
  const mails = windowMails(inp);
  if (mails.length === 0) return [];
  const first = inp.since ?? Math.min(...mails.map((m) => m.t));
  const last = inp.until !== null && inp.until !== undefined ? inp.until - 1 : now;
  const spanDays = (last - first) / 86_400_000;
  const bucket: Bucket = spanDays <= DAILY_UP_TO ? 'day' : spanDays <= WEEKLY_UP_TO ? 'week' : 'month';
  const keyOf = (t: number): string => {
    if (bucket === 'month') return `${new Date(t).toISOString().slice(0, 7)}-01`;
    const d0 = Math.floor(t / 86_400_000) * 86_400_000;
    return dayKey(bucket === 'day' ? d0 : d0 - ((new Date(d0).getUTCDay() + 6) % 7) * 86_400_000);
  };
  const rows = new Map<string, CorpDay & { who: Set<number> }>();
  for (let t = Math.floor(first / 86_400_000) * 86_400_000; t <= last; t += 86_400_000) { const k = keyOf(t); if (!rows.has(k)) rows.set(k, { day: k, kills: 0, losses: 0, destroyed: 0, lost: 0, pilots: 0, bucket, who: new Set() }); }
  for (const m of mails) {
    const d = rows.get(keyOf(m.t)); if (!d) continue;
    if (isLoss(m, inp.corpId)) { d.losses++; d.lost += m.value; d.who.add(m.victim.char); } else if (isKill(m, inp.corpId)) { d.kills++; d.destroyed += m.value; for (const c of corpRows(m, inp.corpId).keys()) d.who.add(c); }
  }
  return [...rows.values()].map(({ who, ...d }) => ({ ...d, pilots: who.size }));
}

// ---- for the corp's chat
export function boardText(o: { corpName: string; window: string; since: number | null; stats: readonly PilotStats[]; nameOf: (char: number) => string; isk: (n: number) => string; fmt: (v: number, unit: 'n' | 'isk' | 'pct' | 'dmg') => string; top?: number }): string {
  const medals = medalTable(o.stats);
  const lines = [`🏆 ${o.corpName ? `${o.corpName} — ` : ''}leaderboard · ${o.window}${o.since ? ` (since ${dayKey(o.since)})` : ''} · ${o.stats.length} pilots`, '', '🏅 Medals'];
  for (const m of medals.slice(0, o.top ?? 5)) lines.push(`${m.rank}. ${o.nameOf(m.char)} — ${m.points} pts (${[m.gold && `🥇${m.gold}`, m.silver && `🥈${m.silver}`, m.bronze && `🥉${m.bronze}`].filter(Boolean).join(' ')})`);
  lines.push('');
  for (const b of BOARDS) {
    const rows = rankBoard(o.stats, b);
    if (rows.length === 0) continue;
    const winners = rows.filter((r) => r.rank === 1);
    lines.push(`${b.icon} ${b.title}: ${winners.map((r) => o.nameOf(r.char)).join(', ')} — ${o.fmt(winners[0].value, b.unit)}`);
  }
  lines.push('', 'public killmails only — the same ruler for everyone');
  return lines.join('\n');
}
