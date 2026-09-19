// KILLMAIL → FIT (v0.203.0). PURE: no browser, store or typedb imports —
// the caller injects "is this type a charge" and "what is it called", so
// node fixtures run this exact code.
//
// Three jobs:
//  1. pickLoss — WHICH of a pilot's losses describes the ship you fought,
//     and how sure that is. A killmail is ground truth for what was fitted
//     when that ship died; the only question is whether it is THE ship.
//     Never another hull; with no loss of the hull, groupFitOptions folds
//     the corp mates' losses of that hull into a few distinct fits.
//  2. killFit — killmail items → racks, with each loaded charge paired to
//     its module (a killmail lists both under the same slot flag), plus
//     subsystems, drones and cargo, which the first version dropped.
//  3. killFitEft — canonical EFT text for the clipboard; the game's fitting
//     window imports it (Import & Export → Import from clipboard).

// ---------------------------------------------------------------------------
// 1. WHICH LOSS, HOW SURE
// ---------------------------------------------------------------------------

export interface LossRef { killId: number; shipTypeId: number; time: number }

export interface LossContext {
  /** the hull the log named for this pilot; 0 = the log gave none */
  seenShipTypeId: number;
  /** killmails YOUR characters are on with this pilot as the victim */
  sharedKillIds: ReadonlySet<number>;
  /** the window on screen (the scoped fight, or the whole range), ms */
  t0: number; t1: number;
}

/** how sure the fit is:
 *  confirmed — the killmail of a ship they lost IN this window: exact
 *  likely    — the same hull, lost at another time: a doctrine-ship guess
 * There is NO other-hull tier (v0.203.1, the owner's call: "if there is no
 * fit for that hull on the character I don't want to see a different
 * hull") — no loss of the hull means no fit of theirs; corp mates' fits in
 * the same hull are the fallback (groupFitOptions below). */
export type FitCertainty = 'confirmed' | 'likely';

export interface LossPick {
  killId: number;
  certainty: FitCertainty;
  /** one of your characters is on this killmail */
  onMail: boolean;
  /** the loss falls inside the window (with the grace below) */
  inWindow: boolean;
  /** the lost hull is the hull the log named (false when the log named none) */
  sameHull: boolean;
  /** ms from the window to the loss: 0 inside, negative = before it began,
   * positive = after it ended */
  gapMs: number;
  /** how many ships of that hull they lost inside the window (a pilot who
   * reshipped into the same hull and died again) */
  lossesInWindow: number;
}

/** a killmail is stamped at the death; the last thing the log wrote about
 * the pilot comes a moment before. Both clocks are EVE time. */
export const WINDOW_GRACE_BEFORE_MS = 60_000;
export const WINDOW_GRACE_AFTER_MS = 5 * 60_000;

const gapTo = (time: number, t0: number, t1: number): number =>
  time < t0 - WINDOW_GRACE_BEFORE_MS ? time - t0 : time > t1 + WINDOW_GRACE_AFTER_MS ? time - t1 : 0;

export function pickLoss(losses: readonly LossRef[], ctx: LossContext): LossPick | null {
  if (losses.length === 0) return null;
  const hullKnown = ctx.seenShipTypeId > 0;
  const rows = losses.map((l) => {
    const onMail = ctx.sharedKillIds.has(l.killId);
    const gapMs = gapTo(l.time, ctx.t0, ctx.t1);
    // a mail you are on IS this fight, whatever the window's edges say
    const inWindow = onMail || gapMs === 0;
    return { l, onMail, inWindow, gapMs: inWindow ? 0 : gapMs, sameHull: hullKnown && l.shipTypeId === ctx.seenShipTypeId };
  });
  const latest = <T extends { l: LossRef }>(xs: T[]): T => xs.reduce((a, b) => (b.l.time > a.l.time ? b : a));
  const nearest = <T extends { l: LossRef; gapMs: number }>(xs: T[]): T =>
    xs.reduce((a, b) => (Math.abs(b.gapMs) < Math.abs(a.gapMs) || (Math.abs(b.gapMs) === Math.abs(a.gapMs) && b.l.time > a.l.time) ? b : a));
  const out = (r: typeof rows[number], certainty: FitCertainty, lossesInWindow: number): LossPick =>
    ({ killId: r.l.killId, certainty, onMail: r.onMail, inWindow: r.inWindow, sameHull: r.sameHull, gapMs: r.gapMs, lossesInWindow });

  const hull = hullKnown ? rows.filter((r) => r.sameHull) : [];
  const hullIn = hull.filter((r) => r.inWindow);
  // 1. the hull you fought, lost in this window — a mail you are on first
  if (hullIn.length > 0) {
    const mine = hullIn.filter((r) => r.onMail);
    return out(latest(mine.length > 0 ? mine : hullIn), 'confirmed', hullIn.length);
  }
  // 2. the log named no hull, but they died in this window: that killmail
  //    is the only hull evidence there is, and it is exact for that ship
  const anyIn = rows.filter((r) => r.inWindow);
  if (!hullKnown && anyIn.length > 0) {
    const mine = anyIn.filter((r) => r.onMail);
    return out(latest(mine.length > 0 ? mine : anyIn), 'confirmed', anyIn.length);
  }
  // 3. the same hull at another time — the nearest to this window, not the
  //    newest: a fight looked at a week later should not borrow next week's fit
  if (hull.length > 0) return out(nearest(hull), 'likely', 0);
  // 4. no loss of the named hull: NOTHING. Another hull says nothing about
  //    the ship on screen (v0.203.1) — the caller turns to corp mates
  return null;
}

// ---------------------------------------------------------------------------
// 1b. THE FALLBACK — corp mates' fits in the same hull (v0.203.1)
// ---------------------------------------------------------------------------
// "It is pretty common to share fits amongst corp mates": when the pilot has
// no loss of the hull, the corporation's losses of that hull are read and
// folded into DISTINCT fits, so a doctrine shows as one option lost by many
// pilots instead of nine near-identical rows.

/** which of a list's losses to read first: the nearest in time to the window */
export function nearestFirst<T extends { time: number }>(rows: readonly T[], t0: number, t1: number, n: number): T[] {
  return rows.slice().sort((a, b) => Math.abs(gapTo(a.time, t0, t1)) - Math.abs(gapTo(b.time, t0, t1)) || b.time - a.time).slice(0, n);
}

/** a fit's identity for grouping: the hull and the modules per rack, order
 * within a rack ignored. Charges, drones and cargo are NOT part of it — the
 * same doctrine ship dies with different ammo loaded and different drones left. */
export function fitKey(shipTypeId: number, fit: KillFit): string {
  const rack = (r: Rack) => fit[r].map((m) => m.typeId).sort((a, b) => a - b).join(',');
  return `${shipTypeId}|${(['high', 'mid', 'low', 'rig', 'sub'] as Rack[]).map(rack).join('|')}`;
}

export interface FitCandidate { killId: number; charId: number; time: number; value: number; fit: KillFit }
export interface FitOption {
  key: string;
  /** the loss shown for this fit: the one nearest in time to the window */
  sample: FitCandidate;
  /** how many of the read losses carried exactly these modules … */
  losses: number;
  /** … across how many different pilots */
  pilots: number;
  /** ms from the window to the sample (0 inside, − before, + after) */
  gapMs: number;
}
export interface FitOptions {
  options: FitOption[];
  /** losses read, and how many of those were left out as stripped hulls */
  considered: number; bare: number;
  /** distinct fits found before the cut to `max` */
  distinct: number;
}

/** a ship that died with fewer fitted modules than this was stripped or
 * never fitted — it is nobody's doctrine */
export const MIN_FIT_MODULES = 5;
export const MAX_FIT_OPTIONS = 4;

/**
 * Losses of ONE hull → distinct fits, the most shared first (then the most
 * pilots, then the nearest in time to the window). The pilot's own id is
 * excluded by the caller; stripped hulls are counted and dropped.
 */
export function groupFitOptions(cands: readonly FitCandidate[], shipTypeId: number, win: { t0: number; t1: number },
  opts: { max?: number; minModules?: number } = {}): FitOptions {
  const max = opts.max ?? MAX_FIT_OPTIONS; const minModules = opts.minModules ?? MIN_FIT_MODULES;
  const groups = new Map<string, FitCandidate[]>();
  let bare = 0;
  for (const c of cands) {
    if (moduleCount(c.fit) < minModules) { bare++; continue; }
    const k = fitKey(shipTypeId, c.fit);
    const g = groups.get(k) ?? [];
    g.push(c);
    groups.set(k, g);
  }
  const all: FitOption[] = [...groups.entries()].map(([key, g]) => {
    const sample = nearestFirst(g, win.t0, win.t1, 1)[0];
    return { key, sample, losses: g.length, pilots: new Set(g.map((c) => c.charId)).size, gapMs: gapTo(sample.time, win.t0, win.t1) };
  }).sort((a, b) => b.losses - a.losses || b.pilots - a.pilots || Math.abs(a.gapMs) - Math.abs(b.gapMs) || b.sample.time - a.sample.time);
  return { options: all.slice(0, max), considered: cands.length, bare, distinct: all.length };
}

// ---------------------------------------------------------------------------
// 2. KILLMAIL ITEMS → RACKS
// ---------------------------------------------------------------------------

/** one killmail item: dropped + destroyed already summed by the caller */
export interface KillItem { typeId: number; qty: number; flag: number }

export type Rack = 'high' | 'mid' | 'low' | 'rig' | 'sub';
export type FlagKind = Rack | 'drone' | 'cargo' | 'implant' | 'other';

/** ESI inventory flags. Slots: LoSlot 11-18, MedSlot 19-26, HiSlot 27-34,
 * RigSlot 92-99, SubSystem 125-132. Bays: Cargo 5, DroneBay 87, FighterBay
 * 158, FighterTube 159-163, Implant 89 (kept apart: never in the racks or
 * the EFT text, but a pod's killmail holds nothing else — v0.203.2).
 * Everything else (fleet hangar, ore hold, …) is not part of a fit. */
export function flagKind(flag: number): FlagKind {
  if (flag >= 27 && flag <= 34) return 'high';
  if (flag >= 19 && flag <= 26) return 'mid';
  if (flag >= 11 && flag <= 18) return 'low';
  if (flag >= 92 && flag <= 99) return 'rig';
  if (flag >= 125 && flag <= 132) return 'sub';
  if (flag === 87 || (flag >= 158 && flag <= 163)) return 'drone';
  if (flag === 5) return 'cargo';
  if (flag === 89) return 'implant';
  return 'other';
}

export interface FittedModule {
  typeId: number;
  flag: number;
  /** the charge that was loaded in it when the ship died */
  chargeTypeId?: number;
  chargeQty?: number;
}
export interface Stack { typeId: number; qty: number }

export interface KillFit {
  high: FittedModule[]; mid: FittedModule[]; low: FittedModule[]; rig: FittedModule[]; sub: FittedModule[];
  drones: Stack[];
  cargo: Stack[];
  /** charges found in a slot with no module beside them (a malformed mail);
   * kept so nothing is silently dropped — they join the cargo in the text */
  looseCharges: Stack[];
  /** implants that died with a capsule (flag 89) — shown, never exported */
  implants: Stack[];
}

const stackUp = (items: readonly KillItem[]): Stack[] => {
  const m = new Map<number, number>();
  for (const it of items) m.set(it.typeId, (m.get(it.typeId) ?? 0) + Math.max(1, it.qty));
  return [...m.entries()].map(([typeId, qty]) => ({ typeId, qty }));
};

/**
 * A killmail lists a fitted module and the charge loaded in it under the
 * SAME slot flag, as separate items (and splits one type into a dropped and
 * a destroyed item). Per flag: the non-charge item is the module, the
 * charge items are its load. `isCharge` comes from the caller's type list.
 */
export function killFit(items: readonly KillItem[], isCharge: (typeId: number) => boolean): KillFit {
  const out: KillFit = { high: [], mid: [], low: [], rig: [], sub: [], drones: [], cargo: [], looseCharges: [], implants: [] };
  const byFlag = new Map<number, KillItem[]>();
  const drones: KillItem[] = []; const cargo: KillItem[] = []; const loose: KillItem[] = []; const implants: KillItem[] = [];
  for (const it of items) {
    const kind = flagKind(it.flag);
    if (kind === 'other') continue;
    if (kind === 'drone') { drones.push(it); continue; }
    if (kind === 'cargo') { cargo.push(it); continue; }
    if (kind === 'implant') { implants.push(it); continue; }
    const at = byFlag.get(it.flag) ?? [];
    at.push(it);
    byFlag.set(it.flag, at);
  }
  for (const flag of [...byFlag.keys()].sort((a, b) => a - b)) {
    const rack = flagKind(flag) as Rack;
    const here = byFlag.get(flag)!;
    const mods = here.filter((it) => !isCharge(it.typeId));
    const charges = stackUp(here.filter((it) => isCharge(it.typeId)));
    if (mods.length === 0) { for (const c of charges) loose.push({ typeId: c.typeId, qty: c.qty, flag }); continue; }
    // one module per slot; were a mail ever to list two, both are kept and
    // the load goes to the first
    mods.forEach((m, i) => {
      const load = i === 0 ? charges[0] : undefined;
      out[rack].push(load ? { typeId: m.typeId, flag, chargeTypeId: load.typeId, chargeQty: load.qty } : { typeId: m.typeId, flag });
    });
    // a second charge type under one flag cannot be loaded too — keep it visible
    for (const extra of charges.slice(1)) loose.push({ typeId: extra.typeId, qty: extra.qty, flag });
  }
  out.drones = stackUp(drones);
  out.cargo = stackUp(cargo);
  out.looseCharges = stackUp(loose);
  out.implants = stackUp(implants);
  return out;
}

/** modules in the racks, for a one-line summary */
export function moduleCount(fit: KillFit): number { return fit.high.length + fit.mid.length + fit.low.length + fit.rig.length + fit.sub.length; }

// ---------------------------------------------------------------------------
// 3. EFT TEXT FOR THE CLIPBOARD
// ---------------------------------------------------------------------------

/** the game trims long fit names; keep ours inside what it shows */
export const EFT_NAME_MAX = 50;

/**
 * Canonical EFT: header, then low / mid / high / rigs / subsystems with a
 * blank line between racks, then drones, then cargo (`Name xN`). A loaded
 * module is "Module, Charge". Loose charges ride with the cargo. The game,
 * Pyfa and zKillboard all read this shape.
 */
export function killFitEft(hullName: string, fitName: string, fit: KillFit, nameOf: (typeId: number) => string, opts: { cargo?: boolean } = {}): string {
  const name = fitName.replace(/[\[\]\r\n]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, EFT_NAME_MAX).trim() || hullName;
  const blocks: string[][] = [];
  for (const rack of ['low', 'mid', 'high', 'rig', 'sub'] as Rack[]) {
    if (fit[rack].length === 0) continue;
    blocks.push(fit[rack].map((m) => (m.chargeTypeId !== undefined ? `${nameOf(m.typeId)}, ${nameOf(m.chargeTypeId)}` : nameOf(m.typeId))));
  }
  const lines: string[] = [`[${hullName}, ${name}]`, ...blocks.flatMap((b, i) => (i === 0 ? b : ['', ...b]))];
  const stackLines = (xs: readonly Stack[]) => xs.map((s) => `${nameOf(s.typeId)} x${s.qty}`);
  const hold = opts.cargo === false ? [] : [...fit.cargo, ...fit.looseCharges];
  if (fit.drones.length > 0) lines.push('', '', ...stackLines(fit.drones));
  if (hold.length > 0) lines.push('', ...(fit.drones.length > 0 ? [] : ['']), ...stackLines(hold));
  return lines.join('\n');
}
