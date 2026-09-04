// WHAT THE APP ACTUALLY DID — the renderer half of the dev log.
//
// The user runs this daily and does not test each change immediately. This
// exists so "did the new rollover actually fire?" is answerable from a file
// instead of by asking him to reproduce something. It records what he was
// DOING alongside what the app was doing, because a failure is only useful
// next to the action that caused it.
//
// DESIGN RULES
//  - Buffered. A log must never become the performance problem it was added
//    to diagnose; entries batch and flush on a timer.
//  - Transitions, not spam. `logState` only writes when a value CHANGES, so
//    a 1-second scheduler does not produce 86,400 lines a day.
//  - Never throws. Every call is safe to make from anywhere, including a
//    catch block.
//  - No tokens, ever (rule 7). The main process scrubs, but callers should
//    not pass credentials in the first place.

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  t: number;
  level: LogLevel;
  /** subsystem: 'radar' | 'trends' | 'push' | 'user' | 'esi' | … */
  area: string;
  msg: string;
  data?: unknown;
}

const buffer: LogEntry[] = [];
/** hard cap so a failure storm cannot grow the buffer without bound */
const MAX_BUFFER = 2000;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let dropped = 0;

function schedule() {
  if (flushTimer !== null) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushLog();
  }, 2000);
}

export async function flushLog(): Promise<void> {
  if (buffer.length === 0) return;
  const batch = buffer.splice(0, buffer.length);
  if (dropped > 0) {
    batch.unshift({
      t: Date.now(), level: 'warn', area: 'devlog',
      msg: `${dropped} entries dropped — the buffer filled faster than it could be written`,
    });
    dropped = 0;
  }
  try {
    await window.appInfo?.devlog?.append(batch);
  } catch {
    // a failed write must not take the app with it, and must not retry
    // forever: the batch is simply gone
  }
}

export function log(level: LogLevel, area: string, msg: string, data?: unknown): void {
  if (buffer.length >= MAX_BUFFER) { dropped++; return; }
  buffer.push({ t: Date.now(), level, area, msg, ...(data !== undefined ? { data } : {}) });
  // errors are what we most want to survive a crash — flush them immediately
  if (level === 'error') void flushLog();
  else schedule();
}

export const logInfo = (area: string, msg: string, data?: unknown) => log('info', area, msg, data);
export const logWarn = (area: string, msg: string, data?: unknown) => log('warn', area, msg, data);
export const logError = (area: string, msg: string, data?: unknown) => log('error', area, msg, data);

/**
 * WHAT THE USER IS DOING. Deliberately separate from logInfo so these lines
 * are greppable: `grep '"area":"user"'` is the timeline of the session.
 */
export const logUser = (action: string, data?: unknown) => log('info', 'user', action, data);

/** only writes when the value CHANGES — for anything polled on a timer */
const lastState = new Map<string, string>();
export function logState(area: string, key: string, value: unknown, data?: unknown): void {
  const s = JSON.stringify(value ?? null);
  const id = `${area}:${key}`;
  if (lastState.get(id) === s) return;
  const had = lastState.has(id);
  lastState.set(id, s);
  log('info', area, `${key}: ${s}${had ? '' : ' (first seen)'}`, data);
}

/** time an operation and record how it ended — the shape most collector
 * questions reduce to ("did it run, did it work, how long did it take") */
export async function logRun<T>(area: string, what: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now();
  try {
    const out = await fn();
    log('info', area, `${what} ok`, { ms: Date.now() - t0, result: summarize(out) });
    return out;
  } catch (e) {
    log('error', area, `${what} FAILED`, {
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

/** keep a result line short: counts and scalars, never whole payloads */
function summarize(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (Array.isArray(v)) return `[${v.length} items]`;
  if (v instanceof Map) return `{${v.size} entries}`;
  if (typeof v === 'object') return `{${Object.keys(v as object).length} keys}`;
  return String(v);
}

let wired = false;
/**
 * Install the global error hooks and the session banner. Called once from the
 * app shell. An uncaught error the user never mentions is exactly the kind of
 * thing this log exists to catch.
 */
export function initDevLog(version: string): void {
  if (wired || typeof window === 'undefined') return;
  wired = true;

  window.addEventListener('error', (e) => {
    log('error', 'uncaught', e.message, {
      source: `${e.filename}:${e.lineno}:${e.colno}`,
      stack: e.error instanceof Error ? String(e.error.stack).slice(0, 1200) : undefined,
    });
  });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    log('error', 'unhandled-rejection', r instanceof Error ? r.message : String(r), {
      stack: r instanceof Error ? String(r.stack).slice(0, 1200) : undefined,
    });
  });

  // console.error is where most of the app's own complaints already go —
  // mirror it rather than asking every call site to log twice
  const realError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    realError(...args);
    log('error', 'console', args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ').slice(0, 800));
  };

  log('info', 'session', `EVE Conductor ${version} started`, {
    ua: navigator.userAgent.slice(0, 160),
    screen: `${window.screen.width}x${window.screen.height}`,
  });

  // a flush on the way out, so the last thing before a crash or a quit is
  // not the thing that never made it to disk
  window.addEventListener('beforeunload', () => { void flushLog(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) void flushLog(); });
}

/** read the log back without leaving the app */
export async function readLogTail(lines = 300): Promise<string> {
  try {
    return (await window.appInfo?.devlog?.tail(lines)) ?? '';
  } catch {
    return '';
  }
}

export async function logDirPath(): Promise<string | null> {
  try {
    return (await window.appInfo?.devlog?.info())?.dir ?? null;
  } catch {
    return null;
  }
}
