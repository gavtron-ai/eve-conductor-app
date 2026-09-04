// UNDOCK JOURNAL — the app's own record of when each character left a
// station or structure.
//
// WHY IT EXISTS (measured 2026-08-28, 60 live session files): the game log
// only writes "Undocking from …" for NPC STATIONS. Leaving a player
// structure writes NOTHING — so a structure-based mining crew has no
// undock lines at all, and the Log Visualizer's "since last undock" range
// fell back to 24 h for everyone (the reported bug).
//
// The overlay feed already polls ESI /characters/{id}/location/ for every
// character; that response carries station_id/structure_id while docked.
// A docked→undocked flip between polls IS an undock, timestamped at the
// observation (accurate to the poll cadence). This journal persists those
// flips; the Log Visualizer takes the LATER of the log line and the
// journal entry per character.
//
// Pure functions — the fixture suite runs this exact code.

export const UNDOCK_KEY = 'etc-undock-journal-v1';

/** charId (as string key) → undock times, ms epoch, oldest first */
export type UndockJournal = Record<string, number[]>;

const KEEP_MS = 7 * 24 * 3600_000;
const KEEP_N = 50;

/** append one undock, trimming entries older than 7 days and keeping at
 * most the latest 50 per character */
export function pushUndock(j: UndockJournal, charId: number, t: number): UndockJournal {
  const key = String(charId);
  const cutoff = t - KEEP_MS;
  const arr = [...(j[key] ?? []), t].filter((x) => x >= cutoff).slice(-KEEP_N);
  return { ...j, [key]: arr };
}

/** the most recent undock per character, keyed the Log Visualizer's way
 * ("#<charId>") */
export function lastUndocks(j: UndockJournal): Map<string, number> {
  const m = new Map<string, number>();
  for (const [key, arr] of Object.entries(j)) {
    if (arr.length > 0) m.set(`#${key}`, Math.max(...arr));
  }
  return m;
}

/**
 * The per-character "since last undock" boundary (v0.169) — the LATEST of:
 *   · any RESHIP event in the log: the NPC-station undock line, a ship
 *     change ("Disembarking from ship" — docking to swap ships then
 *     undocking leaves this as the last marker, and structure undocks
 *     write nothing else), or a clone jump;
 *   · the app's own journaled docked→undocked flip (ESI location);
 *   · the character's latest session LOGIN — nobody undocks before they
 *     log in, and a structure dweller who logs off tethered has no other
 *     boundary at all.
 * Characters outside selCks are ignored; a character with no boundary is
 * simply absent (the caller falls back and says so).
 */
export interface BoundaryEvent { t: number; kind: string; ck: string }
export function computeUndockCuts(
  events: BoundaryEvent[],
  journal: Map<string, number>,
  logins: Map<string, number>,
  selCks: Set<string>,
): Map<string, number> {
  const m = new Map<string, number>();
  const bump = (ck: string, t: number) => {
    if (selCks.has(ck) && t > (m.get(ck) ?? 0)) m.set(ck, t);
  };
  for (const e of events) if (e.kind === 'reship') bump(e.ck, e.t);
  for (const [ck, t] of journal) bump(ck, t);
  for (const [ck, t] of logins) bump(ck, t);
  return m;
}

/** parse the persisted journal, tolerating garbage */
export function parseJournal(raw: string | null): UndockJournal {
  if (!raw) return {};
  try {
    const j = JSON.parse(raw) as unknown;
    if (typeof j !== 'object' || j === null || Array.isArray(j)) return {};
    const out: UndockJournal = {};
    for (const [k, v] of Object.entries(j)) {
      if (Array.isArray(v)) out[k] = v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
    }
    return out;
  } catch {
    return {};
  }
}
