// ENTITY INTEL — turning a name the log gives us into a rich profile: who
// they are (portrait, corp/alliance), and — from zKillboard — a LIKELY FIT
// inferred from one of their own recent losses in the same hull.
//
// SOURCES, layered on the log core: ESI /universe/ids (name -> character
// id, public), ESI killmails (public), zKillboard char feed (main-process
// bridge). HOW SURE (v0.203.0): a killmail is ground truth for the ship
// that died. When they lost the hull you fought INSIDE the window on screen
// — a killmail you are on, first — the fit is CONFIRMED, not guessed. A loss
// of that hull at another time is a "likely fit" (a strong guess for a
// doctrine ship, a guess all the same). ANOTHER HULL IS NEVER SHOWN
// (v0.203.1): with no loss of the hull, the fallback is what their corp
// mates (then alliance mates) lost in that same hull, folded into a few
// distinct fits — zKillboard's /losses/<owner>/shipTypeID/ lists.
import { resolveNames } from './battleNarrative';
import { groupFitOptions, killFit, nearestFirst, pickLoss, type FitCandidate, type FitOptions, type KillFit, type KillItem, type LossContext, type LossPick, type LossRef } from './killFit';

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

/** the fit read off a loss killmail, with how sure it is that this is the
 * ship you fought (v0.203.0 — killFit.ts holds the pure rules) */
export interface LikelyFit {
  killId: number;
  shipTypeId: number;
  lossValue: number;
  lossTime: number;
  /** racks with each charge paired to its module, subsystems, drones, cargo */
  fit: KillFit;
  /** which loss this is and how sure: confirmed / likely */
  pick: LossPick;
}

interface EsiLossMail {
  killmail_time: string;
  victim: { character_id?: number; ship_type_id?: number;
    items?: { item_type_id: number; quantity_dropped?: number; quantity_destroyed?: number; flag: number }[] };
}
/** what identifies a killmail on CCP's public route */
export interface MailRef { killmail_id: number; hash: string; value: number }
type ListRow = MailRef & { time?: number; victimCharId?: number; victimShipId?: number };

async function fetchMail(k: MailRef): Promise<EsiLossMail | null> {
  try {
    const r = await fetch(`${ESI}/killmails/${k.killmail_id}/${k.hash}/`, {
      headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(12_000),
    });
    return r.ok ? await r.json() as EsiLossMail : null;
  } catch { return null; }
}
const FETCH_CHUNK = 10;
async function fetchMails(rows: readonly MailRef[]): Promise<{ row: MailRef; km: EsiLossMail }[]> {
  const out: { row: MailRef; km: EsiLossMail }[] = [];
  for (let i = 0; i < rows.length; i += FETCH_CHUNK) {
    const got = await Promise.all(rows.slice(i, i + FETCH_CHUNK).map(async (row) => ({ row, km: await fetchMail(row) })));
    for (const g of got) if (g.km) out.push({ row: g.row, km: g.km });
  }
  return out;
}
const itemsOf = (km: EsiLossMail): KillItem[] => (km.victim.items ?? []).map((it) =>
  ({ typeId: it.item_type_id, qty: (it.quantity_dropped ?? 0) + (it.quantity_destroyed ?? 0), flag: it.flag }));
const timeOf = (km: EsiLossMail): number => new Date(km.killmail_time).getTime();

/** rows whose list entry carried no time are opened to learn it — at most this many */
const UNTIMED_DEPTH = 20;

/**
 * THE PILOT'S OWN FIT for the hull you fought (v0.203.1). Never another hull.
 *   1. the killmails your characters are on (`shared`, with their hashes) are
 *      read straight from CCP — a confirmed fit costs NO killboard request;
 *   2. else their losses OF THAT HULL from zKillboard (one request; the rows
 *      carry the times, so the pick is made before any mail is opened):
 *      one inside the window is confirmed, otherwise the nearest in time is
 *      a "likely" fit;
 *   3. the log named no hull: only a death inside the window counts.
 * null = they have no loss of that hull — the caller turns to `mateFits`.
 */
export async function likelyFit(charId: number, ctx: LossContext, shared: readonly MailRef[], isCharge: (typeId: number) => boolean): Promise<LikelyFit | null> {
  const bridge = window.appInfo?.zkill;
  if (!charId) return null;
  const mails = new Map<number, { row: MailRef; km: EsiLossMail }>();
  const keep = (got: { row: MailRef; km: EsiLossMail }[]) => { for (const g of got) if (g.km.victim.character_id === charId) mails.set(g.row.killmail_id, g); };
  const refsOfMails = (): LossRef[] => [...mails.values()].map(({ row, km }) => ({ killId: row.killmail_id, shipTypeId: km.victim.ship_type_id ?? 0, time: timeOf(km) }));
  const build = async (pick: LossPick, rows: readonly ListRow[]): Promise<LikelyFit | null> => {
    if (!mails.has(pick.killId)) { const row = rows.find((r) => r.killmail_id === pick.killId); if (row) keep(await fetchMails([row])); }
    const m = mails.get(pick.killId);
    if (!m) return null;
    return { killId: m.row.killmail_id, shipTypeId: m.km.victim.ship_type_id ?? 0, lossValue: m.row.value, lossTime: timeOf(m.km), fit: killFit(itemsOf(m.km), isCharge), pick };
  };

  // 1. a killmail in scope (a kill you are on; a loss of the battle on
  //    screen). One that came without its hash is looked up by id first
  //    (v0.203.2 — Battle Reports knows the id only).
  const hashed: MailRef[] = [];
  for (const s of shared) {
    if (s.hash) { hashed.push(s); continue; }
    try { const ref = await bridge?.killRef?.(s.killmail_id); if (ref?.hash) hashed.push({ killmail_id: s.killmail_id, hash: ref.hash, value: s.value || ref.value }); } catch { /* the hull list below may still hold it */ }
  }
  keep(await fetchMails(hashed));
  const first = pickLoss(refsOfMails(), ctx);
  if (first?.certainty === 'confirmed') return build(first, []);

  // 2. their losses of the hull
  if (ctx.seenShipTypeId > 0) {
    if (!bridge?.shipLosses) return first ? build(first, []) : null;
    let rows: ListRow[];
    try { rows = await bridge.shipLosses('character', charId, ctx.seenShipTypeId); } catch { rows = []; }
    const untimed = rows.filter((r) => !r.time && !mails.has(r.killmail_id)).slice(0, UNTIMED_DEPTH);
    if (untimed.length > 0) keep(await fetchMails(untimed));
    const listed: LossRef[] = rows.filter((r) => r.time && !mails.has(r.killmail_id))
      .map((r) => ({ killId: r.killmail_id, shipTypeId: ctx.seenShipTypeId, time: r.time! }));
    const pick = pickLoss([...refsOfMails(), ...listed], ctx);
    return pick ? build(pick, rows) : null;
  }

  // 3. no hull named: only a death inside the window says anything
  if (!bridge?.charKills) return null;
  let feed: ListRow[];
  try { feed = await bridge.charKills(charId); } catch { return null; }
  const timed = feed.filter((r) => r.time);
  const near = timed.length > 0
    ? timed.filter((r) => (!r.victimCharId || r.victimCharId === charId) && pickLoss([{ killId: r.killmail_id, shipTypeId: 0, time: r.time! }], ctx) !== null)
    : feed.slice(0, UNTIMED_DEPTH);
  keep(await fetchMails(near.filter((r) => !mails.has(r.killmail_id)).slice(0, UNTIMED_DEPTH)));
  const pick = pickLoss(refsOfMails(), ctx);
  return pick ? build(pick, feed) : null;
}

// ---------------------------------------------------------------------------
// THE FALLBACK — corp mates' fits in the same hull (v0.203.1)
// ---------------------------------------------------------------------------

/** how many of the mates' losses are opened: the nearest in time to the fight */
export const MATE_READ_DEPTH = 12;
/** CCP's NPC corporations sit in 1,000,000–1,999,999: thousands of strangers, no shared fits */
export const isNpcCorp = (corpId: number): boolean => corpId >= 1_000_000 && corpId < 2_000_000;

export interface MateFits {
  from: 'corporation' | 'alliance';
  ownerId: number; ownerName: string;
  shipTypeId: number;
  /** losses of that hull zKillboard listed for the owner (the pilot's own excluded) */
  listed: number;
  result: FitOptions;
  /** pilot names for the options' sample losses */
  names: Map<number, string>;
}

/**
 * Corp mates' fits in the hull you fought: the corporation's losses of that
 * hull (one zKillboard request), the MATE_READ_DEPTH nearest in time to the
 * fight opened from CCP, folded into distinct fits. If the corporation has
 * none worth showing and there is an alliance, the alliance is asked the
 * same way. null = nothing to show (an NPC corp with no alliance, no such
 * losses, or the killboard did not answer).
 */
export async function mateFits(aff: CharAffiliation, charId: number, shipTypeId: number, win: { t0: number; t1: number },
  isCharge: (typeId: number) => boolean): Promise<MateFits | null> {
  const bridge = window.appInfo?.zkill;
  if (!bridge?.shipLosses || !shipTypeId) return null;
  const owners: { from: 'corporation' | 'alliance'; id: number; name: string }[] = [];
  if (aff.corpId && !isNpcCorp(aff.corpId)) owners.push({ from: 'corporation', id: aff.corpId, name: aff.corpName });
  if (aff.allianceId) owners.push({ from: 'alliance', id: aff.allianceId, name: aff.allianceName });
  const opened = new Set<number>();
  for (const o of owners) {
    let rows: ListRow[];
    try { rows = await bridge.shipLosses(o.from, o.id, shipTypeId); } catch { rows = []; }
    const mates = rows.filter((r) => r.victimCharId !== charId && !opened.has(r.killmail_id));
    const pickRows = nearestFirst(mates.map((r) => ({ ...r, time: r.time ?? 0 })), win.t0, win.t1, MATE_READ_DEPTH);
    const got = await fetchMails(pickRows);
    for (const g of got) opened.add(g.row.killmail_id);
    const cands: FitCandidate[] = got
      .filter((g) => (g.km.victim.ship_type_id ?? 0) === shipTypeId && (g.km.victim.character_id ?? 0) !== charId)
      .map((g) => ({ killId: g.row.killmail_id, charId: g.km.victim.character_id ?? 0, time: timeOf(g.km), value: g.row.value, fit: killFit(itemsOf(g.km), isCharge) }));
    const result = groupFitOptions(cands, shipTypeId, win);
    if (result.options.length === 0) continue;
    let names = new Map<number, string>();
    try { names = await resolveNames(result.options.map((x) => x.sample.charId).filter((x) => x > 0)); } catch { /* names are a nicety */ }
    return { from: o.from, ownerId: o.id, ownerName: o.name, shipTypeId, listed: mates.length, result, names };
  }
  return null;
}
