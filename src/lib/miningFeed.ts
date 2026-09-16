// MINING FEED (v0.202.0) — the incremental reader behind the mining watch.
//
// Each character's CURRENT session file is followed by byte offset: on
// first sight the last 256 KB are read (enough for half an hour of mining
// lines), after that only what the client appended since the last poll.
// The main process opens, reads and closes per call (gamelog.cjs) — no
// handle is held on the game's files, nothing is written. The file list
// is refreshed every 30 s (a directory stat), the tails every poll.
//
// The bridge is a parameter so the fixture suite can drive this with a
// fake one; the app passes window.appInfo.gamelog.
import { parseGameLogLine } from './gamelogParse';
import type { MiningSample } from './miningWatch';

export interface LogFileMeta {
  file: string;
  charId: string | null;
  listener: string | null;
  mtimeMs: number;
  size: number;
}
export interface GamelogBridge {
  list: () => Promise<{ ok: boolean; files: LogFileMeta[] }>;
  readFrom: (file: string, offset: number) => Promise<{ ok: boolean; size?: number; next?: number; text?: string }>;
}

export const LIST_MS = 30_000;
/** a session file this old is not the live one any more */
export const SESSION_MAX_AGE_MS = 6 * 3600_000;
export const TAIL_BYTES = 256 * 1024;

interface Tracked {
  file: string;
  charId: number;
  name: string;
  offset: number;
  /** the unterminated tail of the last chunk */
  rest: string;
  /** the first chunk of a tail read starts mid-line: drop up to the newline */
  skipPartial: boolean;
}

export interface FeedState { tracked: Map<number, Tracked>; listedAt: number }
export const emptyFeed = (): FeedState => ({ tracked: new Map(), listedAt: 0 });

/** pick each character's newest live session file */
export function adoptFiles(state: FeedState, files: readonly LogFileMeta[], now: number): void {
  const newest = new Map<number, LogFileMeta>();
  for (const f of files) {
    if (!f.charId) continue;
    if (now - f.mtimeMs > SESSION_MAX_AGE_MS) continue;
    const id = Number(f.charId);
    const cur = newest.get(id);
    if (!cur || f.mtimeMs > cur.mtimeMs) newest.set(id, f);
  }
  for (const id of [...state.tracked.keys()]) if (!newest.has(id)) state.tracked.delete(id);
  for (const [id, f] of newest) {
    const t = state.tracked.get(id);
    if (t && t.file === f.file) { if (f.listener) t.name = f.listener; continue; }
    const offset = Math.max(0, f.size - TAIL_BYTES);
    state.tracked.set(id, { file: f.file, charId: id, name: f.listener ?? `#${id}`, offset, rest: '', skipPartial: offset > 0 });
  }
}

/** one poll: list when due, then read every followed file's new bytes and
 * return the 'mine' events they carry */
export async function pollMiningSamples(state: FeedState, bridge: GamelogBridge, now: number): Promise<MiningSample[]> {
  if (now - state.listedAt > LIST_MS) {
    state.listedAt = now;
    try {
      const r = await bridge.list();
      if (r.ok) adoptFiles(state, r.files, now);
    } catch { /* the next list will try again */ }
  }
  const out: MiningSample[] = [];
  for (const t of state.tracked.values()) {
    let r: Awaited<ReturnType<GamelogBridge['readFrom']>>;
    try { r = await bridge.readFrom(t.file, t.offset); } catch { continue; }
    if (!r.ok || r.next === undefined) continue;
    if (r.next < t.offset) { t.offset = 0; t.rest = ''; t.skipPartial = false; continue; } // rewritten: start over
    t.offset = r.next;
    if (!r.text) continue;
    let text = t.rest + r.text;
    if (t.skipPartial) {
      const nl = text.indexOf('\n');
      if (nl < 0) { t.rest = ''; continue; }
      text = text.slice(nl + 1);
      t.skipPartial = false;
    }
    const nl = text.lastIndexOf('\n');
    if (nl < 0) { t.rest = text; continue; }
    t.rest = text.slice(nl + 1);
    for (const line of text.slice(0, nl).split(/\r?\n/)) {
      if (!line) continue;
      const e = parseGameLogLine(line);
      if (e && e.kind === 'mine') out.push({ charId: t.charId, charName: t.name, t: e.t });
    }
  }
  return out;
}
