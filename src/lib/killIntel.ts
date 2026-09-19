// KILL INTEL — real kills and losses from zKillboard, the layer the game
// log cannot provide (the client never records a kill or a death).
//
// PIPELINE, reusing the Battle Reports approach: zKillboard's character
// REST feed (main process, no CORS) gives killmail id + hash + ISK; each
// resolves through PUBLIC ESI /killmails/{id}/{hash}/ for time, system,
// victim and attackers. A mail is a LOSS when the character is the victim,
// otherwise a KILL they were on.
//
// HONEST LIMIT (shown in the UI): zKillboard's cached API runs ~30 min
// behind the live site (measured), and only mails posted to zKill exist —
// so this complements the always-complete log, it does not replace it.

import { resolveNames } from './battleNarrative';

const ESI = 'https://esi.evetech.net/latest';

export interface KillMark {
  id: number;
  /** the killmail's hash (v0.203.1): with it the mail is read straight from
   * CCP's public route, no killboard lookup needed */
  hash: string;
  t: number;               // ms epoch (killmail_time, UTC)
  kind: 'kill' | 'loss';
  system: number;
  value: number;           // ISK (zkb.totalValue)
  victimName: string;      // resolved elsewhere; id kept for lookup
  victimCharId: number;
  victimShipId: number;
  finalBlow: boolean;      // did THIS character land the final blow (kills)
  /** how many of the selected characters are on this killmail (mergeKillMarks); 1 for a single feed */
  pilots?: number;
}

/**
 * ONE MARK PER KILLMAIL (v0.204.1). The Log Visualizer reads every selected
 * character's feed; a kill four of your pilots are on came back four times —
 * four cards, and four times its value in the destroyed / lost / efficiency
 * tiles. Merged by killmail id: it is a LOSS if any of your characters is the
 * victim; the final blow counts if any of them landed it; `pilots` says how
 * many of them are on it. Output oldest first, like the feeds.
 */
export function mergeKillMarks(lists: readonly (readonly KillMark[])[]): KillMark[] {
  const byId = new Map<number, KillMark>();
  for (const list of lists) {
    const seenHere = new Set<number>();
    for (const k of list) {
      if (seenHere.has(k.id)) continue; // a feed listing one mail twice is still one pilot
      seenHere.add(k.id);
      const cur = byId.get(k.id);
      if (!cur) { byId.set(k.id, { ...k, pilots: 1 }); continue; }
      cur.pilots = (cur.pilots ?? 1) + 1;
      if (k.kind === 'loss') cur.kind = 'loss';
      if (k.finalBlow) cur.finalBlow = true;
      if (!cur.victimName && k.victimName) cur.victimName = k.victimName;
      if (!cur.hash && k.hash) cur.hash = k.hash;
      if (!cur.value && k.value) cur.value = k.value;
    }
  }
  return [...byId.values()].sort((a, b) => a.t - b.t || a.id - b.id);
}

interface EsiKm {
  killmail_time: string;
  solar_system_id: number;
  victim: { character_id?: number; ship_type_id?: number };
  attackers: { character_id?: number; final_blow?: boolean }[];
}

/** resolve up to `cap` of a character's recent killmails into marks.
 * Never throws — a dead feed yields an empty layer, never a broken tab. */
export async function characterKillMarks(charId: number, cap = 80): Promise<KillMark[]> {
  const bridge = window.appInfo?.zkill;
  if (!bridge?.charKills || !charId) return [];
  let list: { killmail_id: number; hash: string; value: number }[];
  try {
    list = await bridge.charKills(charId);
  } catch {
    return [];
  }
  const recent = list.slice(0, cap);
  const marks = await Promise.all(recent.map(async (k) => {
    try {
      const r = await fetch(`${ESI}/killmails/${k.killmail_id}/${k.hash}/`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(12_000),
      });
      if (!r.ok) return null;
      const km = await r.json() as EsiKm;
      const isLoss = km.victim.character_id === charId;
      const mine = km.attackers.find((a) => a.character_id === charId);
      return {
        id: k.killmail_id,
        hash: k.hash,
        t: new Date(km.killmail_time).getTime(),
        kind: isLoss ? 'loss' : 'kill',
        system: km.solar_system_id,
        value: k.value,
        victimName: '',
        victimCharId: km.victim.character_id ?? 0,
        victimShipId: km.victim.ship_type_id ?? 0,
        finalBlow: mine?.final_blow ?? false,
      } as KillMark;
    } catch {
      return null;
    }
  }));
  const out = marks.filter((m): m is KillMark => m !== null).sort((a, b) => a.t - b.t);
  // resolve victim NAMES so a kill can be matched to a pilot seen in the log
  const victimIds = [...new Set(out.map((m) => m.victimCharId).filter((x) => x > 0))];
  if (victimIds.length > 0) {
    try {
      const names = await resolveNames(victimIds);
      for (const m of out) m.victimName = names.get(m.victimCharId) ?? '';
    } catch { /* names are a nicety — marks still chart without them */ }
  }
  return out;
}
