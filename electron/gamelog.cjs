// EVE GAME LOG ACCESS — main process, read-only, THE GAME IS NEVER
// INTERRUPTED by construction: every operation OPENS read-only, READS,
// and CLOSES — no handle is ever held, no watcher sits on the game's
// files, nothing is ever written into the game's folders. EVE opens its
// logs with share-read, so a read-only open never blocks the client.
//
// Two operations feed the Live Combat analytics view:
//   list() — every session file with its character (header read once and
//            cached: filename+size key), for the character/date pickers
//   read() — one whole session file as lines, for charting
const fs = require('fs');
const path = require('path');

/** header cache: file name + size at header-read time → listener/start.
 * A header never changes after the session begins, so name alone would
 * do — size is belt-and-braces against a name reused across days. */
const headers = new Map();

function gamelogDir(documents) {
  return path.join(documents, 'EVE', 'logs', 'Gamelogs');
}

const NAME_RE = /^(\d{4})(\d{2})(\d{2})_(\d{6})(?:_(\d+))?\.txt$/;

/** the Listener/Session Started block sits in the first few hundred bytes */
function readHeader(full) {
  let fd = null;
  try {
    fd = fs.openSync(full, 'r');
    const buf = Buffer.alloc(512);
    const read = fs.readSync(fd, buf, 0, 512, 0);
    const head = buf.toString('utf8', 0, read);
    return {
      listener: /^\s*Listener:\s*(.+?)\s*$/m.exec(head)?.[1] ?? null,
      sessionStart: /^\s*Session Started:\s*(.+?)\s*$/m.exec(head)?.[1] ?? null,
    };
  } catch {
    return { listener: null, sessionStart: null };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

/** every session file, newest first — the pickers are built from this */
function list(documents) {
  const dir = gamelogDir(documents);
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return { dir, ok: false, files: [] };
  }
  const files = [];
  for (const name of names) {
    const m = NAME_RE.exec(name);
    if (!m) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch {
      continue;
    }
    const key = `${name}|${st.size > 512 ? 'h' : st.size}`;
    let h = headers.get(key);
    if (!h) {
      h = readHeader(full);
      // only cache once the header block is plausibly complete
      if (st.size > 512 || h.listener !== null) headers.set(key, h);
    }
    files.push({
      file: name,
      dateKey: `${m[1]}-${m[2]}-${m[3]}`,
      charId: m[5] ?? null,
      listener: h.listener,
      sessionStart: h.sessionStart,
      mtimeMs: st.mtimeMs,
      size: st.size,
    });
  }
  files.sort((a, b) => b.mtimeMs - a.mtimeMs);
  return { dir, ok: true, files };
}

/** one whole session file as lines. The name is validated against the
 * session pattern and joined under the Gamelogs dir — no path traversal.
 * 16 MB ceiling: bigger than any session ever observed (max seen ~2 MB);
 * a larger file returns only its last 16 MB and says so. */
function read(documents, file) {
  if (!NAME_RE.test(file)) return { ok: false, lines: [], truncated: false };
  const full = path.join(gamelogDir(documents), file);
  let fd = null;
  try {
    const st = fs.statSync(full);
    const CAP = 16 * 1024 * 1024;
    const start = st.size > CAP ? st.size - CAP : 0;
    fd = fs.openSync(full, 'r');
    const buf = Buffer.alloc(st.size - start);
    const got = fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString('utf8', 0, got);
    return {
      ok: true,
      truncated: start > 0,
      size: st.size,
      mtimeMs: st.mtimeMs,
      lines: text.split(/\r?\n/).filter((l) => l.length > 0),
    };
  } catch {
    return { ok: false, lines: [], truncated: false };
  } finally {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch { /* already closed */ }
    }
  }
}

module.exports = { list, read, gamelogDir };
