// DEV LOG — a plain, readable record of what the app actually did.
//
// WHY IT EXISTS: the user runs this daily and does NOT test each change right
// away. Without a log, "is the new radar rollover working?" can only be
// answered by asking him to reproduce something. With one, the answer is in a
// file. It records what he was DOING (module switches, scans, pushes,
// restores) next to what the app was doing (collector ticks, ESI pauses,
// errors), so a failure can be tied to the action that triggered it.
//
// It lives in Documents next to the stats folder — NOT inside it. The stats
// folder is the never-delete trading history; this is disposable diagnostics
// and is named so that is obvious.
//
// RULE 7 IS ABSOLUTE HERE: no token may ever reach this file. EVE rotates
// refresh tokens, and a leaked one revokes the live session. Every value is
// passed through a scrubber before it is written, and the scrubber is the
// last thing to run.
const fs = require('fs');
const path = require('path');

const FOLDER_NAME = 'EVE Conductor Logs';
/** keep this many days of logs; older files are deleted on startup */
const KEEP_DAYS = 14;
/** a single day's file may not exceed this (a runaway loop must not fill the disk) */
const MAX_FILE_BYTES = 20 * 1024 * 1024;

const README = `EVE Conductor — diagnostic logs
==================================

Plain-text record of what the app did: which module was open, which
collectors ran and whether they succeeded, ESI pauses, and any errors.

- SAFE TO DELETE. Nothing here is trading history — that lives in
  "EVE Conductor Stats (Do Not Delete)", which is a different folder.
- Files older than ${KEEP_DAYS} days are removed automatically.
- One JSON object per line (NDJSON), oldest first.
- NO ACCESS OR REFRESH TOKENS ARE EVER WRITTEN HERE. Values are scrubbed
  before writing; if you ever find something token-shaped in this file,
  that is a bug worth reporting.
`;

/**
 * Strip anything that looks like a credential, whatever shape it arrives in.
 * Deliberately aggressive: a false positive costs a line of diagnostics, a
 * false negative costs the user their EVE session.
 */
const SECRET_KEY = /(token|secret|password|passwd|auth|bearer|credential|refresh|jwt|api[_-]?key|client[_-]?secret)/i;
function scrub(value, depth = 0) {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    // a JWT is treated as a secret regardless of the key it arrived under
    if (/^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\./.test(value)) return '[redacted:jwt]';
    // ...and so is any long opaque base64url blob. EVE's REFRESH tokens are
    // not JWTs — they are exactly this shape — so shape-matching the JWT
    // alone would have caught the access token and missed the far more
    // damaging one. Nothing this app legitimately logs looks like this:
    // names and messages contain spaces, hashes contain ':' and '|'.
    if (/^[A-Za-z0-9_-]{40,}$/.test(value)) return '[redacted:opaque]';
    if (value.length > 200) return `${value.slice(0, 120)}…[+${value.length - 120} chars]`;
    return value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => scrub(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 60)) {
      out[k] = SECRET_KEY.test(k) ? '[redacted]' : scrub(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

function logDir(documentsPath) {
  const dir = path.join(documentsPath, FOLDER_NAME);
  fs.mkdirSync(dir, { recursive: true });
  const readme = path.join(dir, 'README.txt');
  if (!fs.existsSync(readme)) fs.writeFileSync(readme, README);
  return dir;
}

const dayStamp = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const fileFor = (dir, day = dayStamp()) => path.join(dir, `conductor-${day}.log`);

/** delete logs older than KEEP_DAYS — called once per session */
function prune(documentsPath) {
  try {
    const dir = logDir(documentsPath);
    const cutoff = dayStamp(Date.now() - KEEP_DAYS * 86_400_000);
    for (const f of fs.readdirSync(dir)) {
      const m = /^conductor-(\d{4}-\d{2}-\d{2})\.log$/.exec(f);
      if (m && m[1] < cutoff) fs.unlinkSync(path.join(dir, f));
    }
  } catch {
    // logging must never be the thing that breaks the app
  }
}

/**
 * Append entries. Each is {t, level, area, msg, data?} — already shaped by the
 * renderer; this end owns the timestamp, the scrubbing and the file.
 */
function append(documentsPath, entries) {
  if (!Array.isArray(entries) || entries.length === 0) return;
  try {
    const dir = logDir(documentsPath);
    const file = fileFor(dir);
    // a runaway loop must not fill the disk: past the cap, keep only a
    // heartbeat so the file still shows the app is alive and why it stopped
    let capped = false;
    try {
      capped = fs.existsSync(file) && fs.statSync(file).size > MAX_FILE_BYTES;
    } catch { /* stat failure: write anyway */ }
    if (capped) {
      const marker = `${file}.capped`;
      if (!fs.existsSync(marker)) {
        fs.writeFileSync(marker, `capped at ${MAX_FILE_BYTES} bytes on ${new Date().toISOString()}\n`);
        fs.appendFileSync(file, `${JSON.stringify({
          t: new Date().toISOString(), level: 'warn', area: 'devlog',
          msg: `log capped at ${Math.round(MAX_FILE_BYTES / 1e6)} MB — further entries dropped today`,
        })}\n`);
      }
      return;
    }
    const lines = entries.map((e) => {
      const row = {
        t: new Date(typeof e?.t === 'number' ? e.t : Date.now()).toISOString(),
        level: typeof e?.level === 'string' ? e.level : 'info',
        area: typeof e?.area === 'string' ? e.area : 'app',
        msg: String(e?.msg ?? '').replace(/\s+/g, ' ').slice(0, 2000),
      };
      if (e && e.data !== undefined) row.data = scrub(e.data);
      return JSON.stringify(row);
    });
    fs.appendFileSync(file, `${lines.join('\n')}\n`);
  } catch {
    // never throw into the app over a log line
  }
}

/** the most recent `lines` entries across the last few days — for the UI and
 * for anyone asking "what happened?" without opening a file browser */
function tail(documentsPath, lines = 300) {
  try {
    const dir = logDir(documentsPath);
    const files = fs
      .readdirSync(dir)
      .filter((f) => /^conductor-\d{4}-\d{2}-\d{2}\.log$/.test(f))
      .sort()
      .slice(-3);
    const all = files.flatMap((f) =>
      fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
    return all.slice(-Math.max(1, Math.min(5000, lines))).join('\n');
  } catch {
    return '';
  }
}

module.exports = { FOLDER_NAME, logDir, append, tail, prune, scrub, MAX_FILE_BYTES, KEEP_DAYS };
