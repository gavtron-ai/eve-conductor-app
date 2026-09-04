// ENTITY INTEL — turning a name the log gives us into a rich profile: who
// they are (portrait, corp/alliance), and — from zKillboard — a LIKELY FIT
// inferred from one of their own recent losses in the same hull.
//
// SOURCES, layered on the log core: ESI /universe/ids (name -> character
// id, public), ESI killmails (public), zKillboard char feed (main-process
// bridge). HONEST LIMIT surfaced in the UI: a "likely fit" is their LAST
// LOSS of that hull — a strong guess for a doctrine ship, a guess all the
// same; it is labeled as inferred, never presented as fact.
import { resolveNames } from './battleNarrative';

const ESI = 'https://esi.evetech.net/latest';

const idCache = new Map<string, number>();

/** exact character name -> id (batched, cached). Names come straight from
 * the game log, which writes them exactly as EVE spells them. */
export async function resolveCharIds(names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const need: string[] = [];
  for (const n of names) {
    if (idCache.has(n)) out.set(n, idCache.get(n)!);
    else if (n && !need.includes(n)) need.push(n);
  }
  // /universe/ids takes up to 1000 names; chunk conservatively
  for (let i = 0; i < need.length; i += 100) {
    const chunk = need.slice(i, i + 100);
    try {
      const r = await fetch(`${ESI}/universe/ids/`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk), signal: AbortSignal.timeout(12_000),
      });
      if (!r.ok) continue;
      const data = await r.json() as { characters?: { id: number; name: string }[] };
      for (const c of data.characters ?? []) { idCache.set(c.name, c.id); out.set(c.name, c.id); }
    } catch { /* leave unresolved — the panel still shows log data */ }
  }
  return out;
}

export interface CharAffiliation {
  corpId: number; allianceId: number;
  corpName: string; allianceName: string;
}

/** corp + alliance of a character, resolved for the portrait header */
export async function charAffiliation(charId: number): Promise<CharAffiliation | null> {
  try {
    const r = await fetch(`${ESI}/characters/${charId}/`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000),
    });
    if (!r.ok) return null;
    const c = await r.json() as { corporation_id?: number; alliance_id?: number };
    const ids = [c.corporation_id, c.alliance_id].filter((x): x is number => !!x);
    const names = await resolveNames(ids);
    return {
      corpId: c.corporation_id ?? 0, allianceId: c.alliance_id ?? 0,
      corpName: c.corporation_id ? names.get(c.corporation_id) ?? '' : '',
      allianceName: c.alliance_id ? names.get(c.alliance_id) ?? '' : '',
    };
  } catch { return null; }
}

export interface FitModule { typeId: number; qty: number; flag: number }
export interface LikelyFit {
  killId: number;
  shipTypeId: number;
  lossValue: number;
  lossTime: number;
  /** fitted modules, high/mid/low/rig grouped by the caller via flag */
  modules: FitModule[];
}

/** ESI inventory flags for fitted slots (the only ones a "fit" cares about) */
const HIGH = [27, 28, 29, 30, 31, 32, 33, 34];
const MID = [19, 20, 21, 22, 23, 24, 25, 26];
const LOW = [11, 12, 13, 14, 15, 16, 17, 18];
const RIG = [92, 93, 94];
export const slotOf = (flag: number): 'high' | 'mid' | 'low' | 'rig' | 'other' =>
  HIGH.includes(flag) ? 'high' : MID.includes(flag) ? 'mid'
    : LOW.includes(flag) ? 'low' : RIG.includes(flag) ? 'rig' : 'other';

/**
 * A LIKELY FIT for an enemy: their most recent LOSS in `shipTypeId` (or, if
 * none, their most recent loss of any hull), read from zKillboard + ESI.
 * Returns null when nothing usable — the panel then says so plainly.
 */
export async function likelyFit(charId: number, shipTypeId?: number): Promise<LikelyFit | null> {
  const bridge = window.appInfo?.zkill;
  if (!bridge?.charKills || !charId) return null;
  let feed: { killmail_id: number; hash: string; value: number }[];
  try { feed = await bridge.charKills(charId); } catch { return null; }
  // walk recent mails, keep the first that is a LOSS (they are the victim)
  // in the wanted hull; fall back to the first loss of any hull
  let anyLoss: LikelyFit | null = null;
  for (const k of feed.slice(0, 60)) {
    try {
      const r = await fetch(`${ESI}/killmails/${k.killmail_id}/${k.hash}/`, {
        headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000),
      });
      if (!r.ok) continue;
      const km = await r.json() as {
        killmail_time: string; victim: { character_id?: number; ship_type_id?: number;
          items?: { item_type_id: number; quantity_dropped?: number; quantity_destroyed?: number; flag: number }[] };
      };
      if (km.victim.character_id !== charId) continue; // a kill, not a loss
      const mods: FitModule[] = (km.victim.items ?? [])
        .filter((it) => slotOf(it.flag) !== 'other')
        .map((it) => ({ typeId: it.item_type_id, qty: (it.quantity_dropped ?? 0) + (it.quantity_destroyed ?? 0), flag: it.flag }));
      const fit: LikelyFit = {
        killId: k.killmail_id, shipTypeId: km.victim.ship_type_id ?? 0,
        lossValue: k.value, lossTime: new Date(km.killmail_time).getTime(), modules: mods,
      };
      if (anyLoss === null) anyLoss = fit;
      if (shipTypeId && fit.shipTypeId === shipTypeId) return fit; // best match
    } catch { /* skip a bad mail */ }
  }
  return anyLoss; // most-recent loss of any hull, or null
}
