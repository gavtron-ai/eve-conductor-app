// FIGHT WRITE-UPS — every fact computed here, prose optionally by Claude.
//
// The rule that governs this file is the app's oldest one: every number must
// trace to ground truth — here, the killmails br.evetools returned for the
// fight window. This module reduces them to a DIGEST (sides, losses, a
// timeline of phases, notable kills) that is fully deterministic and
// hand-checkable. The digest is then either rendered through a plain
// template, or handed to a Claude call (main process, narrative.cjs) that is
// forbidden to add anything the digest does not contain. AI never touches
// the numbers — it only phrases them.
import { ESI_BASE } from './constants';
import type { BrKm, BrParticipant, FightData } from './battleReport';
import { entityOf } from './battleReport';

/** Capsule and Capsule - Genolution 'Auroral' 197-variant: pod losses are
 * counted separately — "5 ships and 3 pods" reads truer than "8 ships" */
const POD_TYPE_IDS = new Set([670, 33328]);

/** a lull this long between kills splits the fight into phases */
const PHASE_GAP_MINUTES = 10;
/** a change of who-is-dying splits phases only when it SUSTAINS this many
 * consecutive killmails — a lone whored blip is not a turnaround */
const PHASE_FLIP_SUSTAIN = 3;
/** more phases than this collapse into neighbours — a 1-2 paragraph write-up
 * cannot carry more structure than this */
const MAX_PHASES = 4;
/** ESI name lookups are cosmetic — they must never outlast the write-up */
const NAMES_TIMEOUT_MS = 10_000;

export interface PhaseDigest {
  start: string; end: string;
  systems: string[];
  oursLost: { ships: number; pods: number; isk: string };
  theirsLost: { ships: number; pods: number; isk: string };
  notable: { ship: string; value: string; time: string; system: string; side: 'ours' | 'theirs' }[];
}

/** one loss, the way a killboard shows it: who died in what, for how much,
 * who hurt it most and who finished it */
export interface LossRow {
  /** the killmail id — the ship icon links to this kill on zKillboard */
  killmailId: number;
  time: string;
  shipId: number;
  ship: string;
  pilotId: number;
  pilot: string;
  group: string;
  isk: string;
  iskNum: number;
  system: string;
  topDmg?: { pilotId: number; name: string; dmg: number };
  /** absent when the source (br.evetools analyze) does not mark it */
  finalBlow?: { pilotId: number; name: string };
}

/** one organisation on a side: the alliance umbrella (allyId 0 = unallied)
 * with its member corps as they actually appeared on the killmails */
export interface OrgGroup {
  allyId: number;
  allyName: string | null;
  pilots: number;
  corps: { id: number; name: string; pilots: number }[];
}

/** a side's damage leaderboard entry — summed over the OTHER side's losses */
export interface DmgLeader {
  pilotId: number;
  name: string;
  dmg: number;
  finalBlows: number;
}

export interface FightDigest {
  /** set when the digest covers the CORP'S OWN killmails only — the AI
   * prompt receives it inside the digest and the template appends it, so
   * partial numbers are never presented as the whole fight */
  caveat?: string;
  fight: {
    date: string; start: string; end: string; durationMin: number;
    systems: string[]; totalKills: number; totalLost: string;
  };
  ours: {
    groups: number; pilots: number; leadGroups: string[];
    /** the alliance/corp id of the biggest group — for its logo */
    leadGroupId: number;
    /** pilots holds at most 4 names — pilotCount is the real number */
    myCorp: { name: string; pilotCount: number; pilots: string[] } | null;
    shipsLost: number; podsLost: number; iskLost: string;
    iskLostNum: number;
    /** the other side's iskLostNum — what this side destroyed */
    iskDestroyedNum: number;
    /** ISK efficiency, destroyed/(destroyed+lost), 0-100 */
    efficiency: number;
    losses: LossRow[];
    dmgLeaders: DmgLeader[];
    orgs: OrgGroup[];
  };
  theirs: {
    groups: number; pilots: number; leadGroups: string[];
    leadGroupId: number;
    shipsLost: number; podsLost: number; iskLost: string;
    iskLostNum: number;
    iskDestroyedNum: number;
    efficiency: number;
    losses: LossRow[];
    dmgLeaders: DmgLeader[];
    orgs: OrgGroup[];
  };
  phases: PhaseDigest[];
}

/** ISK, in the units a killboard uses. The tier is chosen AFTER rounding:
 * testing v >= 1e9 first printed 999,999,999 as "1000m" instead of "1.00b". */
const fmtIsk = (v: number): string => {
  if (v <= 0) return '0';
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}b`;
  if (Math.round(v / 1e6) >= 1000) return `${(v / 1e9).toFixed(2)}b`;
  if (v >= 1e6) return `${Math.round(v / 1e6)}m`;
  if (Math.round(v / 1e3) >= 1000) return `${Math.round(v / 1e6)}m`;
  return `${Math.round(v / 1e3)}k`;
};

const hm = (ms: number): string => new Date(ms).toISOString().slice(11, 16);

/**
 * ESI bulk name resolution — characters, corps, alliances, systems and ship
 * types all through the one endpoint.
 *
 * /universe/names/ IS ALL-OR-NOTHING (probed: [30000142, 999999999] → HTTP
 * 404 "Ensure all IDs are valid before resolving", the same body minus the
 * bogus id → 200). A digest is usually one batch, so ONE unresolvable id —
 * a pilot who biomassed after the fight is enough — would turn every name
 * in the write-up into a raw number. So a failed batch is bisected: the bad
 * id ends up alone in a batch of one and only it renders as a number.
 */
export async function resolveNames(ids: number[]): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  const uniq = [...new Set(ids)].filter((x) => x > 0);

  const batch = async (part: number[]): Promise<void> => {
    if (part.length === 0) return;
    let okRows: { id: number; name: string }[] | null = null;
    try {
      const r = await fetch(`${ESI_BASE}/universe/names/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(part),
        signal: AbortSignal.timeout(NAMES_TIMEOUT_MS),
      });
      if (r.ok) okRows = await r.json() as { id: number; name: string }[];
    } catch { /* fall through to the split below */ }
    if (okRows) {
      for (const n of okRows) out.set(n.id, n.name);
      return;
    }
    // one id in here is unknown to ESI: halve until it is alone
    if (part.length === 1) return; // that one renders as its number
    const mid = Math.floor(part.length / 2);
    await batch(part.slice(0, mid));
    await batch(part.slice(mid));
  };

  for (let i = 0; i < uniq.length; i += 250) await batch(uniq.slice(i, i + 250));
  return out;
}

/**
 * Phase boundaries: a long lull, or a SUSTAINED flip of who is dying.
 *
 * The flip is measured against the phase's OWN side — the side it was
 * established on — not against the previous killmail. Comparing to the
 * previous mail split the phase one mail after every blip: the enemy whores
 * one of our losses mid-brawl (T T T O T T T), the lone O correctly fails
 * the sustain test, and then the T after it counted as a flip away from the
 * O and split there instead. Two phases for one continuous engagement.
 */
function splitPhases(kms: BrKm[], ourTeam: Set<number>): BrKm[][] {
  const sideOf = (km: BrKm): 'ours' | 'theirs' => (ourTeam.has(entityOf(km.victim)) ? 'ours' : 'theirs');
  const phases: BrKm[][] = [];
  let cur: BrKm[] = [];
  let curSide: 'ours' | 'theirs' | null = null;
  for (let i = 0; i < kms.length; i += 1) {
    const km = kms[i];
    if (cur.length > 0) {
      const gap = km.time - cur[cur.length - 1].time >= PHASE_GAP_MINUTES * 60_000;
      let flip = sideOf(km) !== curSide;
      if (flip) {
        // sustained? this mail plus the next PHASE_FLIP_SUSTAIN-1 all agree
        for (let j = 1; j < PHASE_FLIP_SUSTAIN && i + j < kms.length; j += 1) {
          if (sideOf(kms[i + j]) !== sideOf(km)) { flip = false; break; }
        }
        // a flip right at the end of the list with nothing to sustain it
        if (i + PHASE_FLIP_SUSTAIN > kms.length) flip = false;
      }
      if (gap || flip) { phases.push(cur); cur = []; curSide = null; }
    }
    if (curSide === null) curSide = sideOf(km);
    cur.push(km);
  }
  if (cur.length > 0) phases.push(cur);

  // collapse to MAX_PHASES: fold the smallest-ISK phase into the
  // neighbour it is closest to in time, until the story fits
  while (phases.length > MAX_PHASES) {
    let smallest = 0; let low = Infinity;
    for (let i = 0; i < phases.length; i += 1) {
      const isk = phases[i].reduce((s, k) => s + (k.victim.lossValue || 0), 0);
      if (isk < low) { low = isk; smallest = i; }
    }
    const prevGap = smallest > 0
      ? phases[smallest][0].time - phases[smallest - 1][phases[smallest - 1].length - 1].time : Infinity;
    const nextGap = smallest < phases.length - 1
      ? phases[smallest + 1][0].time - phases[smallest][phases[smallest].length - 1].time : Infinity;
    const into = prevGap <= nextGap ? smallest - 1 : smallest + 1;
    phases[Math.min(into, smallest)].push(...phases[Math.max(into, smallest)]);
    phases.splice(Math.max(into, smallest), 1);
  }
  return phases;
}

/** a lull this long ends the fight — the same "chunks of time with space in
 * between" rule the zkill walk clusters on, applied to the fight's own
 * killmails instead of the corp's */
const FIGHT_CONTIGUITY_MINUTES = 10;

/**
 * THE FIGHT'S OWN KILLMAILS, and only those.
 *
 * br.evetools is asked for a window padded ±15 minutes around the fight so
 * its link catches the stragglers, and that padding also sweeps in
 * unrelated kills from the same systems — which deriveTeams then files
 * under "theirs". Left unfiltered they became fight.start, phantom phases
 * and enemy losses we never inflicted: a gank 12 minutes before the fight
 * turned a 20-minute brawl into a "32-minute fight", contradicting the
 * banner directly above it.
 *
 * The fix is NOT to clamp to the corp's own killmails: that span starts at
 * the first mail my corp-mate happened to be on, so on a real 88-killmail
 * roam it amputated the opening exchange and the final pod slaughter — and
 * the write-up then disagreed with the battle report it was attached to.
 * Instead the corp's span SEEDS the fight, which grows outward through
 * killmails while they stay contiguous. A bystander gank separated by a
 * quiet 12 minutes is excluded; the kills two minutes either side of our
 * own are the same fight and are kept.
 *
 * A killmail with no usable time is dropped outright: time 0 sorts first
 * and dates the whole write-up to 1970, and an absent one makes
 * toISOString() throw. Integrity gate over a false number (RULE 3).
 */
const inFight = (kms: BrKm[], span?: { startMs: number; endMs: number }): BrKm[] => {
  const timed = kms
    .filter((k) => Number.isFinite(k.time) && k.time > 0)
    .sort((a, b) => a.time - b.time);
  if (!span || timed.length === 0) return timed;
  let lo = timed.findIndex((k) => k.time >= span.startMs);
  let hi = -1;
  for (let i = timed.length - 1; i >= 0; i -= 1) {
    if (timed[i].time <= span.endMs) { hi = i; break; }
  }
  // the seed must exist: if our own mails are not in this set, we have no
  // anchor to grow from and guessing a window would be worse than keeping all
  if (lo === -1 || hi < lo) return timed;
  const gap = FIGHT_CONTIGUITY_MINUTES * 60_000;
  while (lo > 0 && timed[lo].time - timed[lo - 1].time <= gap) lo -= 1;
  while (hi < timed.length - 1 && timed[hi + 1].time - timed[hi].time <= gap) hi += 1;
  return timed.slice(lo, hi + 1);
};

/** the digest: every field computed from the killmails, nothing guessed */
export async function buildFightDigest(
  fd: FightData, corpId: number, span?: { startMs: number; endMs: number },
): Promise<FightDigest> {
  const { teams } = fd;
  const kms = inFight(fd.kms, span);
  if (kms.length === 0) throw new Error('no killmail in the fight window carried a usable time');
  const ourTeam = new Set(teams[0]);
  const sideOf = (e: number): 'ours' | 'theirs' => (ourTeam.has(e) ? 'ours' : 'theirs');

  // pilots + groups per side (chars only — NPC rows carry char 0)
  const pilots: Record<'ours' | 'theirs', Set<number>> = { ours: new Set(), theirs: new Set() };
  const corpChars = new Set<number>();
  for (const km of kms) {
    for (const p of [km.victim, ...km.attackers]) {
      const e = entityOf(p);
      if (!e || !p.char) continue;
      pilots[sideOf(e)].add(p.char);
      if (p.corp === corpId) corpChars.add(p.char);
    }
  }
  // lead groups: the entities fielding the most pilots
  const pilotsByEntity = new Map<number, Set<number>>();
  for (const km of kms) {
    for (const p of [km.victim, ...km.attackers]) {
      const e = entityOf(p);
      if (!e || !p.char) continue;
      if (!pilotsByEntity.has(e)) pilotsByEntity.set(e, new Set());
      pilotsByEntity.get(e)!.add(p.char);
    }
  }
  const lead = (team: number[]): number[] => [...team]
    .sort((a, b) => (pilotsByEntity.get(b)?.size ?? 0) - (pilotsByEntity.get(a)?.size ?? 0))
    .slice(0, 3);

  const losses = (side: 'ours' | 'theirs', of: BrKm[]) => {
    const mine = of.filter((k) => sideOf(entityOf(k.victim)) === side);
    // a mail that arrived via ESI before zkill priced it has lossValue 0 —
    // the total is then a FLOOR, and must say so rather than undercount
    const unpriced = mine.some((k) => !k.victim.lossValue);
    return {
      ships: mine.filter((k) => !POD_TYPE_IDS.has(k.victim.ship)).length,
      pods: mine.filter((k) => POD_TYPE_IDS.has(k.victim.ship)).length,
      isk: (unpriced && mine.length > 0 ? '≥' : '')
        + fmtIsk(mine.reduce((s, k) => s + (k.victim.lossValue || 0), 0)),
    };
  };

  const phasesRaw = splitPhases(kms, ourTeam);

  // ---- the killboard view: per-loss credits and damage leaderboards ----
  // top damage / final blow per loss (player rows only — NPCs have char 0)
  const topDmgOf = (km: BrKm): BrParticipant | null => {
    let best: BrParticipant | null = null;
    for (const a of km.attackers) {
      if (a.char && (a.dmg ?? 0) > (best?.dmg ?? 0)) best = a;
    }
    return best;
  };
  const finalBlowOf = (km: BrKm): BrParticipant | null =>
    km.attackers.find((a) => a.fb === true && a.char) ?? null;

  // a side's leaderboard: its pilots' damage summed over the OTHER side's
  // losses (whored friendly fire does not score)
  const leaderMap: Record<'ours' | 'theirs', Map<number, DmgLeader>> = {
    ours: new Map(), theirs: new Map(),
  };
  for (const km of kms) {
    const victimSide = sideOf(entityOf(km.victim));
    for (const a of km.attackers) {
      if (!a.char) continue;
      const aSide = sideOf(entityOf(a));
      if (aSide === victimSide) continue;
      const m = leaderMap[aSide];
      const row = m.get(a.char) ?? { pilotId: a.char, name: '', dmg: 0, finalBlows: 0 };
      row.dmg += a.dmg ?? 0;
      if (a.fb === true) row.finalBlows += 1;
      m.set(a.char, row);
    }
  }
  const leadersOf = (side: 'ours' | 'theirs'): DmgLeader[] =>
    [...leaderMap[side].values()].sort((a, b) => b.dmg - a.dmg).slice(0, 8);
  const oursLeaders = leadersOf('ours');
  const theirsLeaders = leadersOf('theirs');

  // the org tree per side: which corps flew, under which alliance umbrella
  // — read from the killmails themselves, pilots counted per corp
  const corpPilots = new Map<number, Set<number>>();
  const corpAlly = new Map<number, number>();
  const corpSide = new Map<number, 'ours' | 'theirs'>();
  for (const km of kms) {
    for (const p of [km.victim, ...km.attackers]) {
      if (!p.char || !p.corp) continue;
      if (!corpPilots.has(p.corp)) corpPilots.set(p.corp, new Set());
      corpPilots.get(p.corp)!.add(p.char);
      corpAlly.set(p.corp, p.ally || 0);
      corpSide.set(p.corp, sideOf(entityOf(p)));
    }
  }
  const orgsOf = (side: 'ours' | 'theirs', nameFn: (id: number) => string): OrgGroup[] => {
    const byAlly = new Map<number, { id: number; pilots: number }[]>();
    for (const [corp, chars] of corpPilots) {
      if (corpSide.get(corp) !== side) continue;
      const ally = corpAlly.get(corp) ?? 0;
      if (!byAlly.has(ally)) byAlly.set(ally, []);
      byAlly.get(ally)!.push({ id: corp, pilots: chars.size });
    }
    return [...byAlly.entries()]
      .map(([allyId, corps]) => ({
        allyId,
        allyName: allyId ? nameFn(allyId) : null,
        pilots: corps.reduce((s, c) => s + c.pilots, 0),
        corps: corps.sort((a, b) => b.pilots - a.pilots)
          .map((c) => ({ id: c.id, name: nameFn(c.id), pilots: c.pilots })),
      }))
      .sort((a, b) => b.pilots - a.pilots);
  };

  // names: entities, systems, my corp + its pilots, EVERY victim (pilot +
  // ship type), and the credited attackers — the visual rows need them all
  const notableKms = new Set<BrKm>();
  for (const ph of phasesRaw) {
    for (const km of [...ph].sort((a, b) => b.victim.lossValue - a.victim.lossValue).slice(0, 2)) {
      if (km.victim.lossValue >= 100e6) notableKms.add(km);
    }
  }
  for (const km of [...kms].sort((a, b) => b.victim.lossValue - a.victim.lossValue).slice(0, 3)) {
    if (km.victim.lossValue >= 100e6) notableKms.add(km);
  }
  const names = await resolveNames([
    ...teams[0], ...teams[1],
    ...kms.map((k) => k.system),
    ...kms.map((k) => k.victim.ship),
    ...kms.map((k) => k.victim.char),
    ...kms.map((k) => topDmgOf(k)?.char ?? 0),
    ...kms.map((k) => finalBlowOf(k)?.char ?? 0),
    ...oursLeaders.map((l) => l.pilotId),
    ...theirsLeaders.map((l) => l.pilotId),
    ...corpPilots.keys(),
    ...corpAlly.values(),
    ...corpChars, corpId,
  ]);
  const nameOf = (id: number): string => names.get(id) ?? String(id);
  for (const l of [...oursLeaders, ...theirsLeaders]) l.name = nameOf(l.pilotId);

  const lossRowsOf = (side: 'ours' | 'theirs'): LossRow[] => kms
    .filter((k) => sideOf(entityOf(k.victim)) === side)
    .map((k) => {
      const top = topDmgOf(k);
      const fb = finalBlowOf(k);
      return {
        killmailId: k.id,
        time: hm(k.time),
        shipId: k.victim.ship,
        ship: nameOf(k.victim.ship),
        pilotId: k.victim.char,
        pilot: k.victim.char ? nameOf(k.victim.char) : '—',
        group: nameOf(entityOf(k.victim)),
        isk: fmtIsk(k.victim.lossValue || 0),
        iskNum: k.victim.lossValue || 0,
        system: nameOf(k.system),
        ...(top ? { topDmg: { pilotId: top.char, name: nameOf(top.char), dmg: top.dmg ?? 0 } } : {}),
        ...(fb ? { finalBlow: { pilotId: fb.char, name: nameOf(fb.char) } } : {}),
      };
    })
    .sort((a, b) => b.iskNum - a.iskNum);

  const systemsSeen: number[] = [];
  for (const km of kms) if (!systemsSeen.includes(km.system)) systemsSeen.push(km.system);

  const phases: PhaseDigest[] = phasesRaw.map((ph) => {
    const sys: number[] = [];
    for (const km of ph) if (!sys.includes(km.system)) sys.push(km.system);
    return {
      start: hm(ph[0].time),
      end: hm(ph[ph.length - 1].time),
      systems: sys.map(nameOf),
      oursLost: losses('ours', ph),
      theirsLost: losses('theirs', ph),
      notable: [...ph].filter((k) => notableKms.has(k))
        .sort((a, b) => b.victim.lossValue - a.victim.lossValue)
        .map((k) => ({
          ship: nameOf(k.victim.ship),
          value: fmtIsk(k.victim.lossValue),
          time: hm(k.time),
          system: nameOf(k.system),
          side: sideOf(entityOf(k.victim)),
        })),
    };
  });

  const t0 = kms[0].time; const t1 = kms[kms.length - 1].time;
  const iskOf = (side: 'ours' | 'theirs') => kms
    .filter((k) => sideOf(entityOf(k.victim)) === side)
    .reduce((s, k) => s + (k.victim.lossValue || 0), 0);
  const oursIskNum = iskOf('ours');
  const theirsIskNum = iskOf('theirs');
  /** ISK efficiency the way killboards show it: destroyed/(destroyed+lost) */
  const eff = (destroyed: number, lost: number): number =>
    (destroyed + lost > 0 ? Math.round((destroyed / (destroyed + lost)) * 100) : 0);
  return {
    caveat: fd.partial
      ? `counted from ${nameOf(corpId)}'s own killmails only — br.evetools has not`
        + ' ingested this fight yet, so losses on mails no corp member is on are missing'
      : undefined,
    fight: {
      date: new Date(t0).toISOString().slice(0, 10),
      start: hm(t0),
      end: hm(t1),
      durationMin: Math.max(1, Math.round((t1 - t0) / 60_000)),
      systems: systemsSeen.map(nameOf),
      totalKills: kms.length,
      totalLost: (kms.some((k) => !k.victim.lossValue) ? '≥' : '')
        + fmtIsk(kms.reduce((s, k) => s + (k.victim.lossValue || 0), 0)),
    },
    ours: {
      groups: teams[0].length,
      pilots: pilots.ours.size,
      leadGroups: lead(teams[0]).map(nameOf),
      leadGroupId: lead(teams[0])[0] ?? 0,
      myCorp: corpChars.size > 0
        ? {
          name: nameOf(corpId),
          pilotCount: corpChars.size,
          pilots: [...corpChars].slice(0, 4).map(nameOf),
        }
        : null,
      shipsLost: losses('ours', kms).ships,
      podsLost: losses('ours', kms).pods,
      iskLost: losses('ours', kms).isk,
      iskLostNum: oursIskNum,
      iskDestroyedNum: theirsIskNum,
      efficiency: eff(theirsIskNum, oursIskNum),
      losses: lossRowsOf('ours'),
      dmgLeaders: oursLeaders,
      orgs: orgsOf('ours', nameOf),
    },
    theirs: {
      groups: teams[1].length,
      pilots: pilots.theirs.size,
      leadGroups: lead(teams[1]).map(nameOf),
      leadGroupId: lead(teams[1])[0] ?? 0,
      shipsLost: losses('theirs', kms).ships,
      podsLost: losses('theirs', kms).pods,
      iskLost: losses('theirs', kms).isk,
      iskLostNum: theirsIskNum,
      iskDestroyedNum: oursIskNum,
      efficiency: eff(oursIskNum, theirsIskNum),
      losses: lossRowsOf('theirs'),
      dmgLeaders: theirsLeaders,
      orgs: orgsOf('theirs', nameOf),
    },
    phases,
  };
}

/** the deterministic fallback: the same digest, plainly worded — what the
 * user gets when no AI key is configured or the call fails */
export function templateWriteup(d: FightDigest): string {
  const n = (c: number, word: string): string => `${c} ${word}${c === 1 ? '' : 's'}`;
  const lost = (l: { ships: number; pods: number; isk: string }): string => {
    const bits: string[] = [];
    if (l.ships) bits.push(n(l.ships, 'ship'));
    if (l.pods) bits.push(n(l.pods, 'pod'));
    return bits.length > 0 ? `${bits.join(' and ')} (${l.isk})` : 'nothing';
  };
  const roam = d.fight.systems.length > 1;
  const sysArc = roam
    ? `${d.fight.systems.length} systems (${d.fight.systems.join(' → ')})`
    : d.fight.systems[0];
  const corpBit = (c: NonNullable<FightDigest['ours']['myCorp']>): string => (
    c.pilotCount <= 3
      ? `${c.pilots.join(', ')} flying for ${c.name}`
      : `${c.pilotCount} ${c.name} pilots in fleet`);
  const us = d.ours.myCorp
    ? `${d.ours.leadGroups.join(', ')} (${n(d.ours.pilots, 'pilot')} in ${n(d.ours.groups, 'group')}, ` +
      `${corpBit(d.ours.myCorp)})`
    : `${d.ours.leadGroups.join(', ')} (${n(d.ours.pilots, 'pilot')})`;
  const them = `${d.theirs.leadGroups.join(', ')} (${n(d.theirs.pilots, 'pilot')})`;
  const p1 = `${d.fight.date}, ${d.fight.start}–${d.fight.end} EVE — a ${d.fight.durationMin}-minute fight `
    + `through ${sysArc}: ${us} against ${them}. ${n(d.fight.totalKills, 'killmail')}, ${d.fight.totalLost} lost — `
    + `they lost ${lost({ ships: d.theirs.shipsLost, pods: d.theirs.podsLost, isk: d.theirs.iskLost })}, `
    + `we lost ${lost({ ships: d.ours.shipsLost, pods: d.ours.podsLost, isk: d.ours.iskLost })}.`;

  const parts = d.phases.map((ph) => {
    const bits: string[] = [];
    if (ph.theirsLost.ships + ph.theirsLost.pods > 0) bits.push(`they lost ${lost(ph.theirsLost)}`);
    if (ph.oursLost.ships + ph.oursLost.pods > 0) bits.push(`we lost ${lost(ph.oursLost)}`);
    const where = ph.systems.join('/');
    const notable = ph.notable.length > 0
      ? ` — biggest: ${ph.notable[0].ship} (${ph.notable[0].value}, ${ph.notable[0].time})`
      : '';
    const span = ph.start === ph.end ? ph.start : `${ph.start}–${ph.end}`;
    return `${span} in ${where}: ${bits.join(', ') || 'no losses recorded'}${notable}`;
  });
  const tail = d.caveat ? `\n\n(${d.caveat})` : '';
  return `${p1}\n\n${parts.join('. ')}.${tail}`;
}

// (the fightWriteup orchestrator that auto-ran AI after every report was
// removed in v0.101.0 — the Battle Reports tab builds the digest itself and
// spends the AI key only when its button is clicked; every network leg it
// uses is individually bounded: names 10s, killboard 15s, AI call 30s)
