// EVE GAME LOG PARSING — the client's own combat log, read straight off
// disk (Documents\EVE\logs\Gamelogs), replacing the copy-files-into-
// triff.tools ritual.
//
// EVERY pattern below was measured against the owner's real logs
// (2026-08-20 session files, mid-PvP) — no format is guessed. The log
// embeds font/color markup; lines are stripped first, then classified.
// Anything (combat) that no pattern claims becomes kind 'other' with its
// cleaned text — activity is never silently dropped, only unstyled.
//
// Timestamps are EVE TIME (UTC): "[ 2026.08.21 01:22:28 ]".

export type GameLogKind =
  | 'dmgOut'   // "689 to Will Arts[URSA.](Orthrus) - 1400mm Howitzer Artillery II - Grazes"
  | 'dmgIn'    // "12 from Orco Manic[URSA.](Vedmak) - Stigmella SD-300-I - Penetrates"
  | 'missOut'  // "Your group of 1400mm Howitzer Artillery II misses Michael Marsh completely - …"
  | 'missIn'   // "<ship> misses you completely" (standard client wording; not yet
               //  seen in the sampled sessions — flagged unverified in the fixture)
  | 'neutOut'  // "50 GJ energy neutralized Exequror Navy Issue ASOFC - Small … Neutralizer"
  | 'neutIn'   // same wording with "by" — the source named instead of the target
  | 'repIn'    // "0 remote shield boosted by Tengu - Gistum C-Type …"
  | 'repOut'   // same wording with "to"
  | 'ewar'     // "Warp disruption attempt from Osprey Navy Issue to Naga"
  | 'jammed'   // "Basilisk // Bjorn Skjeggestad jammed - Ladar ECM II" (ECM ON you)
  | 'reship'   // undock / disembark / clone jump — a hull change (notify/None)
  | 'mine'     // "You mined 125 units of Gneiss IV-Grade"
  | 'mineCrit' // "Critical mining success! You mined an additional 411 units of Gneiss IV-Grade"
  | 'residue'  // "Additional 137 units depleted from asteroid as residue" (NO ore name in the line)
  | 'bounty'   // "23,500 ISK added to next bounty payout"
  | 'other';   // any other (combat)/(bounty)/(mining) line, cleaned

export interface GameLogEvent {
  /** ms epoch — EVE time is UTC */
  t: number;
  kind: GameLogKind;
  /** hp for damage, GJ for neuts */
  amount?: number;
  /** the other party as the log names it — "Pilot[CORP](Ship)" for players */
  entity?: string;
  weapon?: string;
  /** Smashes / Penetrates / Grazes / Glances Off / Hits / Wrecks */
  quality?: string;
  /** cleaned text for 'ewar'/'jammed'/'other' */
  text?: string;
  /** ore/material name for 'mine' */
  ore?: string;
  /** ISK for 'bounty' */
  isk?: number;
}

/** drop the client's font/color markup, collapse the leftover whitespace */
export const stripMarkup = (s: string): string =>
  s.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();

const LINE_RE = /^\[ (\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \] \(([A-Za-z]+)\) (.*)$/;

const QUALITIES = new Set(['Hits', 'Smashes', 'Penetrates', 'Grazes', 'Glances Off', 'Wrecks']);

/** "ENTITY - weapon parts - Quality" → the pieces. Weapons contain hyphens
 * WITHOUT spaces (Stigmella SD-300-I), so ' - ' is a safe separator; the
 * quality is only claimed when it is one of the client's six words. */
const splitTail = (rest: string): { entity: string; weapon?: string; quality?: string } => {
  const parts = rest.split(' - ').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { entity: rest.trim() };
  const entity = parts[0];
  let quality: string | undefined;
  let weaponParts = parts.slice(1);
  if (weaponParts.length > 0 && QUALITIES.has(weaponParts[weaponParts.length - 1])) {
    quality = weaponParts[weaponParts.length - 1];
    weaponParts = weaponParts.slice(0, -1);
  }
  return { entity, weapon: weaponParts.length > 0 ? weaponParts.join(' - ') : undefined, quality };
};

export function parseGameLogLine(raw: string): GameLogEvent | null {
  const m = LINE_RE.exec(raw);
  if (!m) return null;
  const t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  const category = m[7];
  const body = stripMarkup(m[8]);

  // RESHIP markers live in (notify)/(None) — the only non-activity lines we
  // promote, and ONLY these exact ones (notify/None are otherwise chatter):
  //   "Disembarking from ship" · "Starting clone jumping" · "Undocking from …"
  if (category === 'notify' || category === 'None') {
    if (/^Disembarking from ship/.test(body)) return { t, kind: 'reship', text: 'left ship (reshipping)' };
    if (/^Starting clone jumping/.test(body)) return { t, kind: 'reship', text: 'clone jump' };
    const ud = /^Undocking from (.+?) to .+ solar system/.exec(body);
    if (ud) return { t, kind: 'reship', text: `undocked from ${ud[1]}` };
    return null;
  }
  // combat + mining + bounty are ACTIVITY; everything else is chatter
  if (category !== 'combat' && category !== 'bounty' && category !== 'mining') return null;

  if (category === 'bounty') {
    // "23,500 ISK added to next bounty payout"
    const b = /^([\d,]+) ISK/.exec(body);
    return { t, kind: 'bounty', isk: b ? Number(b[1].replace(/,/g, '')) : 0, text: body };
  }
  if (category === 'mining') {
    // MEASURED 2026-08-28 against the owner's live session files — the
    // client writes exactly three (mining) shapes:
    //   "You mined 137 units of Gneiss IV-Grade"
    //   "Critical mining success! You mined an additional 411 units of Gneiss IV-Grade"
    //   "Additional 137 units depleted from asteroid as residue"   (no ore name)
    const mm = /^You mined ([\d,]+) units of (.+)$/.exec(body);
    if (mm) return { t, kind: 'mine', amount: Number(mm[1].replace(/,/g, '')), ore: mm[2] };
    const mc = /^Critical mining success! You mined an additional ([\d,]+) units of (.+)$/.exec(body);
    if (mc) return { t, kind: 'mineCrit', amount: Number(mc[1].replace(/,/g, '')), ore: mc[2] };
    const mr = /^Additional ([\d,]+) units depleted from asteroid as residue$/.exec(body);
    if (mr) return { t, kind: 'residue', amount: Number(mr[1].replace(/,/g, '')) };
    return { t, kind: 'other', text: body };
  }

  // damage, both directions
  const dmg = /^(\d+) (to|from) (.+)$/.exec(body);
  if (dmg) {
    const tail = splitTail(dmg[3]);
    return {
      t, kind: dmg[2] === 'to' ? 'dmgOut' : 'dmgIn', amount: Number(dmg[1]),
      entity: tail.entity, weapon: tail.weapon, quality: tail.quality,
    };
  }

  // energy neutralized / drained — "by" names a source, otherwise a target
  const neut = /^(\d+) GJ energy (?:neutralized|drained)( by)? (.+)$/.exec(body);
  if (neut) {
    const tail = splitTail(neut[3]);
    return { t, kind: neut[2] ? 'neutIn' : 'neutOut', amount: Number(neut[1]), entity: tail.entity, weapon: tail.weapon };
  }

  // remote reps — "by" = received, "to" = given
  const rr = /^(\d+) remote (?:shield boosted|armor repaired|hull repaired) (by|to) (.+)$/.exec(body);
  if (rr) {
    const tail = splitTail(rr[3]);
    return {
      t, kind: rr[2] === 'by' ? 'repIn' : 'repOut', amount: Number(rr[1]),
      entity: tail.entity.replace(/\s*\/\/\s*/, ' · '), weapon: tail.weapon,
    };
  }

  // misses (the client writes these WITHOUT markup)
  const missOut = /^Your (?:group of )?(.+?) misses (.+?) completely/.exec(body);
  if (missOut) return { t, kind: 'missOut', entity: missOut[2], weapon: missOut[1] };
  const missIn = /^(.+?) misses you completely/.exec(body);
  if (missIn) return { t, kind: 'missIn', entity: missIn[1] };

  // ECM jam landed on you — the logi/ewar entity format is "Ship // Pilot"
  const jam = /^(.+?) jammed - (.+)$/.exec(body);
  if (jam) return { t, kind: 'jammed', entity: jam[1].replace(/\s*\/\/\s*/, ' · '), weapon: jam[2] };

  // ewar attempts
  if (/^Warp (disruption|scramble) attempt from /.test(body)) {
    return { t, kind: 'ewar', text: body };
  }

  return { t, kind: 'other', text: body };
}

export interface Engagement {
  t0: number;
  t1: number;
  /** damage events inside the window */
  n: number;
}

/**
 * Cluster a day's events into ENGAGEMENTS: damage-bearing events separated
 * by more than gapMs start a new fight; clusters with fewer than minEvents
 * damage events are noise (a stray smartbomb, one rat volley) and dropped.
 * Pure — the Live Combat view's fight chips are built from this.
 */
export function engagements(
  events: GameLogEvent[], gapMs = 300_000, minEvents = 3,
): Engagement[] {
  const out: Engagement[] = [];
  let cur: Engagement | null = null;
  for (const e of events) {
    if ((e.kind !== 'dmgOut' && e.kind !== 'dmgIn') || e.amount === undefined) continue;
    if (cur !== null && e.t - cur.t1 <= gapMs) {
      cur.t1 = e.t;
      cur.n += 1;
    } else {
      if (cur !== null && cur.n >= minEvents) out.push(cur);
      cur = { t0: e.t, t1: e.t, n: 1 };
    }
  }
  if (cur !== null && cur.n >= minEvents) out.push(cur);
  return out;
}

// ---------------------------------------------------------------------------
// MINING AGGREGATION (pure, fixtured)
// ---------------------------------------------------------------------------

export interface OreMining {
  /** units from plain cycles */
  normal: number;
  /** units from critical-success bonus lines */
  crit: number;
  /** residue units attributed to this ore (see attribution note) */
  residue: number;
  /** plain cycle count */
  cycles: number;
  /** critical-success count */
  critCycles: number;
}
export interface MiningStats {
  normal: number;
  crit: number;
  /** normal + crit — everything that reached the hold */
  total: number;
  residue: number;
  cycles: number;
  critCycles: number;
  byOre: [string, OreMining][];
}

/**
 * Aggregate a window's mining events. Residue lines carry NO ore name, so
 * each is attributed to the ore of the NEAREST 'mine' event within ±5s —
 * in real logs the residue line shares the cycle tick's exact timestamp.
 * A residue with no mine event near it lands under "(unattributed)".
 *
 * MULTI-CHARACTER streams: events may carry a `ck` (source-character key).
 * Residue only ever matches a mine event from the SAME character's log —
 * two alts on the same cycle tick otherwise cross-attribute (caught by an
 * independent ISK cross-check in the rig, v0.163).
 */
export function miningStats(events: GameLogEvent[]): MiningStats {
  const byOre = new Map<string, OreMining>();
  const bucket = (ore: string): OreMining => {
    const b = byOre.get(ore) ?? { normal: 0, crit: 0, residue: 0, cycles: 0, critCycles: 0 };
    byOre.set(ore, b);
    return b;
  };
  const ckOf = (e: GameLogEvent): string => (e as { ck?: string }).ck ?? '';
  const mines: { t: number; ore: string; ck: string }[] = [];
  let normal = 0; let crit = 0; let residue = 0; let cycles = 0; let critCycles = 0;
  for (const e of events) {
    if (e.kind === 'mine' && e.amount !== undefined && e.ore) {
      normal += e.amount; cycles += 1;
      const b = bucket(e.ore); b.normal += e.amount; b.cycles += 1;
      mines.push({ t: e.t, ore: e.ore, ck: ckOf(e) });
    } else if (e.kind === 'mineCrit' && e.amount !== undefined && e.ore) {
      crit += e.amount; critCycles += 1;
      const b = bucket(e.ore); b.crit += e.amount; b.critCycles += 1;
    }
  }
  for (const e of events) {
    if (e.kind !== 'residue' || e.amount === undefined) continue;
    residue += e.amount;
    const ck = ckOf(e);
    let best: { ore: string; d: number } | null = null;
    for (const m of mines) {
      if (m.ck !== ck) continue;
      const d = Math.abs(m.t - e.t);
      if (best === null || d < best.d) best = { ore: m.ore, d };
    }
    const ore = best !== null && best.d <= 5000 ? best.ore : '(unattributed)';
    bucket(ore).residue += e.amount;
  }
  return {
    normal, crit, total: normal + crit, residue, cycles, critCycles,
    byOre: [...byOre.entries()].sort((a, b) => (b[1].normal + b[1].crit) - (a[1].normal + a[1].crit)),
  };
}

export interface GameLogHeader {
  listener: string | null;
  sessionStart: string | null;
}

/** the block at the top of every session file:
 *   Listener: Some Pilot
 *   Session Started: 2026.08.20 16:46:17 */
export function parseGameLogHeader(text: string): GameLogHeader {
  const listener = /^\s*Listener:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
  const sessionStart = /^\s*Session Started:\s*(.+?)\s*$/m.exec(text)?.[1] ?? null;
  return { listener, sessionStart };
}
