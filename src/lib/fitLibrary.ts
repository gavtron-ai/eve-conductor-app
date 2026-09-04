// THE FITTING LIBRARY — one canonical set of saved fits, mirrored to every
// character's PERSONAL fitting folder.
//
// PURE: no ESI, no browser APIs. The whole plan (what gets created, what
// gets deleted, on which character) is computed here so it can be shown to
// the user BEFORE anything is touched, and so fixtures can drive it.
//
// TWO ESI FACTS THAT SHAPE EVERYTHING (verified against the live spec):
//   · there is NO update/rename endpoint. Only GET, POST and DELETE exist,
//     so renaming an in-game fit means DELETE + POST — a rename is a
//     destructive operation, and the plan says so out loud.
//   · POST enforces name 1..50 chars, description ≤500, items 1..512.
import { fitIdentityKey, typeNameOf, type RawFitItem } from './fitSerial';

export const ESI_FIT_NAME_MAX = 50;
export const ESI_FIT_ITEMS_MAX = 512;

export interface EsiFitting {
  fitting_id: number;
  name: string;
  description?: string;
  ship_type_id: number;
  items: RawFitItem[];
}

/** one character's fittings as read from ESI */
export interface CharFits {
  characterId: number;
  characterName: string;
  fits: EsiFitting[];
  /** false when this login predates esi-fittings.write_fittings.v1 */
  canWrite: boolean;
  /** why this character could not be read, if it could not */
  error?: string;
  /** seconds until EVE will publish anything NEW for this character. Its
   * fittings list is cached 300s, so a fit made in game moments ago is
   * genuinely invisible until this reaches 0 — no amount of re-asking
   * changes it, and the UI must say so rather than show a short list. */
  expiresIn?: number | null;
}

/** where a library entry was found */
export interface LibrarySource {
  characterId: number;
  characterName: string;
  fittingId: number;
  name: string;
}

export interface LibraryEntry {
  key: string;
  shipTypeId: number;
  hullName: string;
  /** the name that will be pushed everywhere */
  name: string;
  /** every distinct name this fit is saved under today */
  nameVariants: string[];
  description: string;
  items: RawFitItem[];
  sources: LibrarySource[];
  /** excluded entries are pushed nowhere and deleted everywhere */
  included: boolean;
  /** items sitting in an 'Invalid' slot. ESI's own POST documentation says
   * such entries "will be discarded", so a fit carrying them CANNOT be
   * recreated intact — the user has to be told, not quietly shortchanged. */
  invalidCount: number;
}

/** names the user has chosen, and entries they excluded — persisted so a
 * cleanup survives a restart */
export interface LibraryOverrides {
  names: Record<string, string>;
  excluded: Record<string, true>;
}

export const emptyOverrides = (): LibraryOverrides => ({ names: {}, excluded: {} });

/** the most common name wins, ties broken alphabetically so the result is
 * deterministic rather than dependent on which character was read first */
function preferredName(sources: LibrarySource[]): string {
  const counts = new Map<string, number>();
  for (const s of sources) {
    const n = s.name.trim();
    if (n) counts.set(n, (counts.get(n) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best ? best[0] : '(unnamed fit)';
}

/**
 * Merge every character's saved fits into one library. Fits are identical
 * when the HULL and the FITTING match — names are ignored, exactly as asked.
 */
export function buildLibrary(chars: CharFits[], overrides: LibraryOverrides = emptyOverrides()): LibraryEntry[] {
  const byKey = new Map<string, LibraryEntry>();
  for (const c of chars) {
    for (const f of c.fits) {
      const key = fitIdentityKey(f.ship_type_id, f.items);
      const source: LibrarySource = {
        characterId: c.characterId,
        characterName: c.characterName,
        fittingId: f.fitting_id,
        name: f.name,
      };
      const invalid = f.items.filter((i) => i.flag === 'Invalid').length;
      const existing = byKey.get(key);
      if (existing) {
        existing.sources.push(source);
        if (!existing.nameVariants.includes(f.name)) existing.nameVariants.push(f.name);
        // keep the longest description — the one someone actually wrote
        if ((f.description ?? '').length > existing.description.length) existing.description = f.description ?? '';
        existing.invalidCount = Math.max(existing.invalidCount, invalid);
      } else {
        byKey.set(key, {
          key,
          shipTypeId: f.ship_type_id,
          hullName: typeNameOf(f.ship_type_id),
          name: f.name,
          nameVariants: [f.name],
          description: f.description ?? '',
          items: f.items,
          sources: [source],
          included: true,
          invalidCount: invalid,
        });
      }
    }
  }
  const out = [...byKey.values()].map((e) => ({
    ...e,
    nameVariants: [...e.nameVariants].sort((a, b) => a.localeCompare(b)),
    name: overrides.names[e.key] ?? preferredName(e.sources),
    included: !overrides.excluded[e.key],
  }));
  // DUPLICATES FIRST. An entry that merged several saved fits is the one
  // needing a decision (which name wins, is it really the same fit); a fit
  // that exists in exactly one place needs nothing. Most-duplicated first,
  // then the usual hull/name ordering within each band.
  out.sort((a, b) =>
    b.sources.length - a.sources.length
    || a.hullName.localeCompare(b.hullName)
    || a.name.localeCompare(b.name));
  return out;
}

// ---- the plan ----------------------------------------------------------

export interface PlanCreate {
  key: string;
  name: string;
  shipTypeId: number;
  hullName: string;
  items: RawFitItem[];
  description: string;
}

export interface PlanDelete {
  fittingId: number;
  name: string;
  hullName: string;
  /** why it goes: a duplicate, an excluded fit, or a rename in disguise */
  reason: 'excluded' | 'duplicate' | 'rename';
}

export interface CharPlan {
  characterId: number;
  characterName: string;
  creates: PlanCreate[];
  deletes: PlanDelete[];
  /** already correct: right fit, right name — left alone */
  keeps: number;
  /** restore only: of the creates, how many exist with the same modules but
   * a DIFFERENT name — i.e. renamed, so restoring adds the original name
   * back as a second copy rather than silently calling it present */
  renamed?: number;
  /** set when nothing can be done for this character, with the reason */
  blocked?: string;
}

/**
 * HOW FAR A PUSH GOES.
 *
 * 'add'    — create the ticked fits where they're missing. NOTHING is ever
 *            deleted. An unticked fit is simply not our business.
 * 'mirror' — additionally make each character's folder EXACTLY the ticked
 *            list: duplicates collapsed, renames applied, and everything
 *            else deleted.
 *
 * 'add' is the default because the tick box reads as "propagate this", not
 * as "and destroy everything else" — a distinction that, gotten wrong,
 * proposed deleting 152 of one character's fits.
 */
export type PushMode = 'add' | 'mirror';

export interface SyncPlan {
  mode: PushMode;
  chars: CharPlan[];
  totalCreates: number;
  totalDeletes: number;
  /** entries whose name is unusable — POST would 400. Blocks the push. */
  problems: string[];
  /** things that WILL happen and are lossy but legal — stated out loud
   * rather than blocking, because there is no better outcome available:
   * EVE itself discards 'Invalid' entries on create. */
  warnings: string[];
}

/**
 * What has to happen so every character ends up with EXACTLY the included
 * library, each under the library's name.
 *
 * A character keeps a fit only when it is BOTH in the library AND already
 * carries the library's name; ESI has no rename, so a name mismatch is a
 * delete plus a create, and the plan labels those 'rename' so the count is
 * not mistaken for data loss.
 */
export function buildPlan(chars: CharFits[], library: LibraryEntry[], mode: PushMode = 'add'): SyncPlan {
  const included = library.filter((e) => e.included);
  const byKey = new Map(included.map((e) => [e.key, e]));
  const problems: string[] = [];
  const warnings: string[] = [];

  for (const e of included) {
    const n = e.name.trim();
    if (n.length === 0) problems.push(`${e.hullName}: a library fit has no name — name it or exclude it`);
    else if (n.length > ESI_FIT_NAME_MAX) problems.push(`“${n}” is ${n.length} characters; EVE allows ${ESI_FIT_NAME_MAX}`);
    if (e.items.length === 0) problems.push(`“${n}” has no items — EVE rejects an empty fit`);
    else if (e.items.length > ESI_FIT_ITEMS_MAX) problems.push(`“${n}” has ${e.items.length} items; EVE allows ${ESI_FIT_ITEMS_MAX}`);
    if (e.invalidCount > 0) {
      // NOT a blocker: there is no version of "recreate this fit" that keeps
      // them, because ESI discards Invalid entries on POST. Excluding the
      // entry would delete the fit outright, which is worse. So: say it.
      warnings.push(
        `“${n}” (${e.hullName}) has ${e.invalidCount} item(s) EVE could not place in a slot. ` +
        `EVE discards those when a fit is created, so any character that receives this fit will not get them. ` +
        `The pre-push backup keeps the original item list.`,
      );
    }
  }

  const plans: CharPlan[] = chars.map((c) => {
    const plan: CharPlan = {
      characterId: c.characterId,
      characterName: c.characterName,
      creates: [],
      deletes: [],
      keeps: 0,
    };
    if (c.error) {
      plan.blocked = c.error;
      return plan;
    }
    if (!c.canWrite) {
      // RULE: never pretend. This character is read-only until re-login.
      plan.blocked = 'no write scope on this login — log this character out and back in (Settings → EVE login)';
      return plan;
    }

    // what this character already has, grouped by fit identity
    const mine = new Map<string, EsiFitting[]>();
    for (const f of c.fits) {
      const key = fitIdentityKey(f.ship_type_id, f.items);
      (mine.get(key) ?? mine.set(key, []).get(key)!).push(f);
    }

    for (const [key, copies] of mine) {
      const entry = byKey.get(key);
      if (!entry) {
        // NOT IN THE LIBRARY. In 'add' mode this fit is none of our
        // business — the user unticked it, or never ticked it, and that
        // means LEAVE IT ALONE.
        if (mode === 'add') continue;
        for (const f of copies) {
          plan.deletes.push({ fittingId: f.fitting_id, name: f.name, hullName: typeNameOf(f.ship_type_id), reason: 'excluded' });
        }
        continue;
      }
      if (mode === 'add') {
        // the character already has this fit; its name and any extra copies
        // are theirs to keep
        plan.keeps++;
        continue;
      }
      // keep ONE copy — preferring one that already has the right name, so a
      // correctly-named fit is never needlessly destroyed and recreated
      const correct = copies.find((f) => f.name === entry.name);
      const keeper = correct ?? copies[0];
      for (const f of copies) {
        if (f.fitting_id === keeper.fitting_id) continue;
        plan.deletes.push({ fittingId: f.fitting_id, name: f.name, hullName: entry.hullName, reason: 'duplicate' });
      }
      if (correct) {
        plan.keeps++;
      } else {
        // no rename endpoint exists: replace it
        plan.deletes.push({ fittingId: keeper.fitting_id, name: keeper.name, hullName: entry.hullName, reason: 'rename' });
        plan.creates.push({ key, name: entry.name, shipTypeId: entry.shipTypeId, hullName: entry.hullName, items: entry.items, description: entry.description });
      }
    }

    // library fits this character does not have at all
    for (const e of included) {
      if (!mine.has(e.key)) {
        plan.creates.push({ key: e.key, name: e.name, shipTypeId: e.shipTypeId, hullName: e.hullName, items: e.items, description: e.description });
      }
    }
    plan.creates.sort((a, b) => a.hullName.localeCompare(b.hullName) || a.name.localeCompare(b.name));
    return plan;
  });

  return {
    mode,
    chars: plans,
    totalCreates: plans.reduce((n, p) => n + p.creates.length, 0),
    totalDeletes: plans.reduce((n, p) => n + p.deletes.length, 0),
    problems: [...new Set(problems)],
    warnings: [...new Set(warnings)],
  };
}

// ---- backup integrity --------------------------------------------------

export interface BackupShape {
  savedAt?: string;
  characters?: { characterId: number; characterName: string; error?: string | null; fits?: EsiFitting[] }[];
}

/**
 * Does this backup REALLY hold everything that was scanned?
 *
 * Not "did the write throw" — an actual field-by-field comparison against
 * the live scan: every character present, every fit present by id, and every
 * fit's full item list (hull, modules, cargo, drones) intact down to the
 * flag and quantity. A backup is what authorises deleting things EVE cannot
 * restore, so "probably fine" is not good enough.
 *
 * Returns the problems found; empty means verified.
 */
export function verifyBackup(scanned: CharFits[], backup: BackupShape): string[] {
  const problems: string[] = [];
  const got = new Map((backup.characters ?? []).map((c) => [c.characterId, c]));
  if ((backup.characters ?? []).length !== scanned.length) {
    problems.push(`backup holds ${(backup.characters ?? []).length} characters, ${scanned.length} were scanned`);
  }
  for (const c of scanned) {
    const b = got.get(c.characterId);
    if (!b) {
      problems.push(`${c.characterName} is missing from the backup`);
      continue;
    }
    const bFits = new Map((b.fits ?? []).map((f) => [f.fitting_id, f]));
    if ((b.fits ?? []).length !== c.fits.length) {
      problems.push(`${c.characterName}: backup holds ${(b.fits ?? []).length} fits, ${c.fits.length} were read`);
    }
    for (const f of c.fits) {
      const bf = bFits.get(f.fitting_id);
      if (!bf) {
        problems.push(`${c.characterName}: fit “${f.name}” is missing from the backup`);
        continue;
      }
      if (bf.name !== f.name || bf.ship_type_id !== f.ship_type_id) {
        problems.push(`${c.characterName}: fit “${f.name}” differs in the backup (name or hull)`);
      }
      // EVERY item, including cargo and drones — a backup that lost the
      // cargo would restore a fit that is not the fit that was deleted
      const key = (items: RawFitItem[]) =>
        items.map((i) => `${i.type_id}|${i.flag}|${Math.max(1, i.quantity)}`).sort().join(',');
      if (key(bf.items ?? []) !== key(f.items)) {
        problems.push(`${c.characterName}: fit “${f.name}” has different items in the backup`);
      }
    }
  }
  return problems;
}

/**
 * What restoring a backup would put back on each character (add-only: a
 * restore never deletes anything either).
 *
 * PRESENCE IS KEYED ON IDENTITY **AND NAME**. Keying on the fitting alone
 * would call a renamed fit "already present" — so a mirror run that renamed
 * "Shield Rifter" to "Rifter PVP" could never be undone, and worse, the
 * read-only check would report it green as "all present". A rename IS a
 * loss of the original, and restore puts the original name back (as a second
 * copy, since a restore may not delete the renamed one).
 */
export function buildRestorePlan(chars: CharFits[], backup: BackupShape): CharPlan[] {
  return (backup.characters ?? []).map((b) => {
    const live = chars.find((c) => c.characterId === b.characterId);
    const plan: CharPlan = {
      characterId: b.characterId,
      characterName: b.characterName,
      creates: [],
      deletes: [],
      keeps: 0,
    };
    if (!live) {
      plan.blocked = 'not logged in now — nothing can be restored to this character';
      return plan;
    }
    if (live.error) { plan.blocked = live.error; return plan; }
    if (!live.canWrite) { plan.blocked = 'no write scope on this login — log out and back in'; return plan; }
    const exact = new Set(live.fits.map((f) => `${fitIdentityKey(f.ship_type_id, f.items)}|${f.name}`));
    const byFitting = new Set(live.fits.map((f) => fitIdentityKey(f.ship_type_id, f.items)));
    for (const f of b.fits ?? []) {
      const key = fitIdentityKey(f.ship_type_id, f.items);
      if (exact.has(`${key}|${f.name}`)) { plan.keeps++; continue; }
      // the fitting is there but under a different name — the original name
      // is still lost, so it IS recreated, and the count is reported
      if (byFitting.has(key)) plan.renamed = (plan.renamed ?? 0) + 1;
      plan.creates.push({
        key, name: f.name, shipTypeId: f.ship_type_id,
        hullName: typeNameOf(f.ship_type_id), items: f.items, description: f.description ?? '',
      });
    }
    return plan;
  });
}

/** the POST body for one create — flags are rebuilt from the library items */
export function toPostBody(create: PlanCreate): {
  name: string;
  description: string;
  ship_type_id: number;
  items: { type_id: number; flag: string; quantity: number }[];
} {
  return {
    name: create.name.trim().slice(0, ESI_FIT_NAME_MAX),
    description: (create.description ?? '').slice(0, 500),
    ship_type_id: create.shipTypeId,
    items: create.items
      .filter((i) => i.flag !== 'Invalid')
      .map((i) => ({ type_id: i.type_id, flag: i.flag, quantity: Math.max(1, i.quantity) })),
  };
}
