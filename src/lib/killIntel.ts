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
  t: number;               // ms epoch (killmail_time, UTC)
  kind: 'kill' | 'loss';
  system: number;
  value: number;           // ISK (zkb.totalValue)
  victimName: string;      // resolved elsewhere; id kept for lookup
  victimCharId: number;
  victimShipId: number;
  finalBlow: boolean;      // did THIS character land the final blow (kills)
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
