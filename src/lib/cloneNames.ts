// THE PILOT'S OWN NAME FOR A CLONE — recovered by implant fingerprint.
//
// ESI's /clones/ endpoint DOES carry clone names (verified in the live
// spec: jump_clones[].name), but ONLY for clones the character is not
// currently in. The clone you are flying is absent from jump_clones; all
// ESI will tell you about it is its implants (/implants/).
//
// So the name of the CURRENT clone is not directly readable. The bridge:
// every jump clone is listed WITH its exact implant set, and an implant
// set is that clone's fingerprint. Record name+implants whenever a clone IS
// listed, then when the live implants match a fingerprint we have seen
// named, we know which clone the pilot jumped into.
//
// This is memory — but memory of an IDENTITY (these implants = this name),
// not memory of "the last string I saw", which is exactly the mistake that
// made EVE's auto-generated "Capsule - <name>" stick forever. Change the
// implants and the fingerprint stops matching, as it should.
//
// STORAGE LIVES IN THE MAIN PROCESS (electron/cloneStore.cjs) because three
// windows need it. This module is the renderer's mirror: a synchronous read
// model kept fresh by the registry's change broadcasts.

export interface CloneRecord {
  implants: number[];
  /** implant names, captured at observation time so the config window needs
   * no copy of the type catalog */
  names: string[];
  /** what the derived label reads as today (LEARNING, SNAKE, PG+CAP …) */
  label: string;
  characterName: string;
  /** the name EVE holds for this clone, when it has been seen listed */
  esiName?: string;
  /** the name the USER typed — outranks everything */
  customName?: string;
  alert?: { blink: boolean; color: string } | null;
  first: number;
  seen: number;
  lastWorn: number;
}

export interface CloneRegistry {
  v: number;
  chars: Record<string, Record<string, CloneRecord>>;
}

export interface CloneObservation {
  characterId: number;
  characterName: string;
  sig: string;
  implants: number[];
  names: string[];
  label?: string;
  esiName?: string;
  /** true for the clone the character is wearing right now */
  worn?: boolean;
}

/**
 * A clone's fingerprint. Sorted so listing order never matters; an EMPTY
 * implant set returns null because every bare clone would share it and one
 * name would then leak onto all of them.
 */
export function cloneSignature(implants: readonly number[] | undefined): string | null {
  if (!implants || implants.length === 0) return null;
  return [...new Set(implants)].sort((a, b) => a - b).join(',');
}

let mirror: CloneRegistry = { v: 1, chars: {} };
let started = false;
const listeners = new Set<(r: CloneRegistry) => void>();

/** Load the registry and follow its changes. Safe to call repeatedly. */
export async function initCloneRegistry(): Promise<void> {
  if (started) return;
  started = true;
  window.appInfo?.clones?.onChanged((r: CloneRegistry) => {
    mirror = r ?? { v: 1, chars: {} };
    for (const fn of listeners) fn(mirror);
  });
  try {
    const r = await window.appInfo?.clones?.all();
    if (r) mirror = r;
    for (const fn of listeners) fn(mirror);
  } catch {
    // running outside Electron (browser dev) — the registry is simply empty
  }
}

export function onCloneRegistry(fn: (r: CloneRegistry) => void): () => void {
  listeners.add(fn);
  fn(mirror);
  return () => listeners.delete(fn);
}

export function cloneRegistry(): CloneRegistry {
  return mirror;
}

/** The implants of the pod this character is wearing RIGHT NOW, per the
 * multibox registry — the overlay collector stamps lastWorn on every live
 * poll, so after a clone jump this is current within a poll while the auth
 * store's implants stay frozen at the last character sync. null = the
 * registry has never seen this character worn (fall back to the sync). */
/** Every pod the registry knows for this character, most recently worn
 * first (never-worn ones trail, newest-seen first). The display name
 * follows the registry's own precedence: the user's custom name outranks
 * ESI's clone name outranks the derived label. */
export function characterPods(characterId: number): (CloneRecord & { displayName: string })[] {
  const recs = mirror.chars[String(characterId)];
  if (!recs) return [];
  return Object.values(recs)
    .sort((a, b) => (b.lastWorn - a.lastWorn) || (b.seen - a.seen))
    .map((r) => ({
      ...r,
      displayName: r.customName || r.esiName || r.label || `${r.implants.length} implant(s)`,
    }));
}

export function activePodImplants(characterId: number): number[] | null {
  const recs = mirror.chars[String(characterId)];
  if (!recs) return null;
  let best: CloneRecord | null = null;
  for (const r of Object.values(recs)) {
    if (r.lastWorn > 0 && (!best || r.lastWorn > best.lastWorn)) best = r;
  }
  return best ? best.implants : null;
}

/** Send observations to the registry. One call per poll keeps the registry
 * to a single broadcast instead of one per character. */
export function recordClones(list: CloneObservation[]): void {
  if (list.length === 0) return;
  window.appInfo?.clones?.record(list);
}

/**
 * What we know about the clone these implants belong to — the user's custom
 * name, EVE's name, and any alert. null when the fingerprint is unknown.
 */
export function lookupClone(characterId: number, implants: readonly number[] | undefined): CloneRecord | null {
  const sig = cloneSignature(implants);
  if (sig === null) return null;
  return mirror.chars[String(characterId)]?.[sig] ?? null;
}

/** the name to show, or null to fall back to the derived label */
export function cloneDisplayName(rec: CloneRecord | null): string | null {
  const custom = rec?.customName?.trim();
  if (custom) return custom;
  const esi = rec?.esiName?.trim();
  return esi ? esi : null;
}
