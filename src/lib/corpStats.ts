// THE CORP, FROM ITS PUBLIC KILLMAILS (v0.209.0) — the corp-level glances the Home dashlets show,
// over the same held killmails as the Leaderboard and with the same definitions (lib/leaderboard):
// a kill is a mail whose victim is not in the corp and that a corp pilot is on; a loss is a mail
// whose victim is a corp PILOT. PURE.
import { CAPSULES, type LbMail } from './leaderboard';

const inWin = (m: LbMail, since: number | null) => since === null || m.t >= since;
const dedupe = (mails: readonly LbMail[], since: number | null): LbMail[] => { const seen = new Set<number>(); return mails.filter((m) => inWin(m, since) && !seen.has(m.id) && (seen.add(m.id), true)); };
const corpOn = (m: LbMail, corpId: number) => m.attackers.some((a) => a.corp === corpId && a.char > 0);
export const isKill = (m: LbMail, corpId: number) => m.victim.corp !== corpId && corpOn(m, corpId);
export const isLoss = (m: LbMail, corpId: number) => m.victim.corp === corpId && m.victim.char > 0;

export interface CorpTotals {
  kills: number; losses: number; destroyed: number; lost: number;
  /** ISK destroyed ÷ (destroyed + lost); null with nothing either way */
  efficiency: number | null;
  pilots: number; unpriced: number;
  biggestKill: { id: number; value: number; ship: number } | null;
  biggestLoss: { id: number; value: number; ship: number; char: number } | null;
}
export function corpTotals(mails: readonly LbMail[], corpId: number, since: number | null): CorpTotals {
  const pilots = new Set<number>();
  const t: CorpTotals = { kills: 0, losses: 0, destroyed: 0, lost: 0, efficiency: null, pilots: 0, unpriced: 0, biggestKill: null, biggestLoss: null };
  for (const m of dedupe(mails, since)) {
    if (isLoss(m, corpId)) {
      t.losses++; t.lost += m.value; pilots.add(m.victim.char); if (!m.value) t.unpriced++;
      if (!t.biggestLoss || m.value > t.biggestLoss.value) t.biggestLoss = { id: m.id, value: m.value, ship: m.victim.ship, char: m.victim.char };
    } else if (isKill(m, corpId)) {
      t.kills++; t.destroyed += m.value; if (!m.value) t.unpriced++;
      for (const a of m.attackers) if (a.corp === corpId && a.char > 0) pilots.add(a.char);
      if (!t.biggestKill || m.value > t.biggestKill.value) t.biggestKill = { id: m.id, value: m.value, ship: m.victim.ship };
    }
  }
  t.pilots = pilots.size;
  t.efficiency = t.destroyed + t.lost > 0 ? t.destroyed / (t.destroyed + t.lost) : null;
  return t;
}

export interface FeedRow { id: number; t: number; kind: 'kill' | 'loss'; ship: number; value: number; char: number; pilots: number }
/** the newest killmails, kills and losses together; a mail that is neither (a corp structure, a
 * corp mate shot by a corp mate alone) is left out */
export function killFeed(mails: readonly LbMail[], corpId: number, keep = 8): FeedRow[] {
  const rows: FeedRow[] = [];
  for (const m of dedupe(mails, null)) {
    const loss = isLoss(m, corpId);
    if (!loss && !isKill(m, corpId)) continue;
    rows.push({ id: m.id, t: m.t, kind: loss ? 'loss' : 'kill', ship: m.victim.ship, value: m.value, char: loss ? m.victim.char : m.victim.char, pilots: new Set(m.attackers.filter((a) => a.corp === corpId && a.char > 0).map((a) => a.char)).size });
  }
  return rows.sort((a, b) => b.t - a.t || b.id - a.id).slice(0, keep);
}

export interface HullRow { ship: number; uses: number; pilots: number; lost: number }
/** what the corp flies: one use per pilot per mail, either side; capsules and unknown hulls left out */
export function hullsFlown(mails: readonly LbMail[], corpId: number, since: number | null, keep = 8): { rows: HullRow[]; hulls: number } {
  const acc = new Map<number, { ship: number; uses: number; who: Set<number>; lost: number }>();
  const tally = (ship: number, char: number, lost: boolean) => {
    if (!ship || CAPSULES.has(ship) || !(char > 0)) return;
    let r = acc.get(ship);
    if (!r) { r = { ship, uses: 0, who: new Set(), lost: 0 }; acc.set(ship, r); }
    r.uses++; r.who.add(char); if (lost) r.lost++;
  };
  for (const m of dedupe(mails, since)) {
    if (isLoss(m, corpId)) tally(m.victim.ship, m.victim.char, true);
    if (m.victim.corp === corpId) continue;
    const once = new Set<number>();
    for (const a of m.attackers) if (a.corp === corpId && a.char > 0 && !once.has(a.char)) { once.add(a.char); tally(a.ship, a.char, false); }
  }
  const rows = [...acc.values()].map((r) => ({ ship: r.ship, uses: r.uses, pilots: r.who.size, lost: r.lost })).sort((a, b) => b.uses - a.uses || a.ship - b.ship);
  return { rows: rows.slice(0, keep), hulls: rows.length };
}

export interface EnemyRow { corp: number; killed: number; lostTo: number; destroyed: number; lost: number }
/** who the corp meets: per other corporation, the kills on them and the losses they were on —
 * one count per mail however many of their pilots are on it; NPC rows (no pilot) are nobody */
export function enemies(mails: readonly LbMail[], corpId: number, since: number | null, keep = 8): { rows: EnemyRow[]; corps: number } {
  const acc = new Map<number, EnemyRow>();
  const of = (c: number) => { let r = acc.get(c); if (!r) { r = { corp: c, killed: 0, lostTo: 0, destroyed: 0, lost: 0 }; acc.set(c, r); } return r; };
  for (const m of dedupe(mails, since)) {
    if (isKill(m, corpId) && m.victim.corp > 0) { const r = of(m.victim.corp); r.killed++; r.destroyed += m.value; }
    if (isLoss(m, corpId)) for (const c of new Set(m.attackers.filter((a) => a.char > 0 && a.corp > 0 && a.corp !== corpId).map((a) => a.corp))) { const r = of(c); r.lostTo++; r.lost += m.value; }
  }
  const rows = [...acc.values()].sort((a, b) => (b.killed + b.lostTo) - (a.killed + a.lostTo) || (b.destroyed + b.lost) - (a.destroyed + a.lost) || a.corp - b.corp);
  return { rows: rows.slice(0, keep), corps: rows.length };
}

/** the times of the corp's kills and losses in the window — for the hour-of-day histogram */
export const fightTimes = (mails: readonly LbMail[], corpId: number, since: number | null): number[] =>
  dedupe(mails, since).filter((m) => isKill(m, corpId) || isLoss(m, corpId)).map((m) => m.t);
