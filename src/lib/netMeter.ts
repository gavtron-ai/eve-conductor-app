// NET METER — what this copy asks of every outside service, counted per host per UTC day
// (v0.221.0, audit items A3 and F6).
//
// WHY. Aperture's developer had to tell us what the app cost their server; nobody here could have
// said, because nothing counted. Rule 22 wants the number for every service. This is the number.
//
// HOW. A PerformanceObserver sees every resource the renderer loads — fetch, XHR, images, scripts,
// stylesheets — with its URL, so nothing has to remember to count (a wrapper around fetch would
// miss the portraits). Hosts are folded into a few labels; localhost, files and blobs are not
// counted. The main process's zKillboard requester counts its own calls (electron/zkill.cjs) and is
// folded in for display. Today's and yesterday's totals live in localStorage; at midnight UTC the
// closed day goes to the dev log as one line — the durable record an audit can read.
// Nothing is sent anywhere.
import { logInfo } from './devlog';

export const METER_KEY = 'etc-net-meter-v1';
export interface MeterDay { day: string; hosts: Record<string, number> }
export interface MeterState { today: MeterDay; yesterday: MeterDay | null }

export const utcDayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** the label a URL's host is counted under; null = not an outside request */
export function hostLabel(url: string): string | null {
  let h = '';
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) return null; h = u.hostname.toLowerCase(); } catch { return null; }
  if (h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local')) return null;
  if (h === 'esi.evetech.net') return 'ESI (CCP)';
  if (h === 'images.evetech.net') return 'images (CCP)';
  if (h === 'login.eveonline.com') return 'EVE login (CCP)';
  if (h.endsWith('fuzzwork.co.uk')) return 'Fuzzwork';
  if (h === 'zkillboard.com' || h.endsWith('.zkillboard.com')) return 'zKillboard';
  if (h === 'github.com' || h.endsWith('.github.com') || h.endsWith('.githubusercontent.com')) return 'GitHub';
  if (h === 'ntfy.sh' || h.endsWith('.ntfy.sh')) return 'ntfy';
  return 'other';
}

/** PURE: fold request URLs into the day, rolling over when the UTC day has changed */
export function foldUrls(state: MeterState, urls: readonly string[], nowMs: number): { state: MeterState; closed: MeterDay | null } {
  const day = utcDayOf(nowMs);
  let today = state.today;
  let yesterday = state.yesterday;
  let closed: MeterDay | null = null;
  if (today.day !== day) {
    closed = today;
    yesterday = today;
    today = { day, hosts: {} };
  }
  const hosts = { ...today.hosts };
  for (const u of urls) {
    const label = hostLabel(u);
    if (label === null) continue;
    hosts[label] = (hosts[label] ?? 0) + 1;
  }
  return { state: { today: { day, hosts }, yesterday }, closed };
}

export const emptyMeter = (nowMs: number): MeterState => ({ today: { day: utcDayOf(nowMs), hosts: {} }, yesterday: null });

/** the total of one day */
export const meterTotal = (d: MeterDay | null): number => (d ? Object.values(d.hosts).reduce((t, n) => t + n, 0) : 0);

let state: MeterState | null = null;
let dirty = false;
const load = (nowMs: number): MeterState => {
  try {
    const raw = JSON.parse(localStorage.getItem(METER_KEY) ?? 'null') as MeterState | null;
    if (raw && raw.today && typeof raw.today.day === 'string' && raw.today.hosts && typeof raw.today.hosts === 'object') return { today: raw.today, yesterday: raw.yesterday ?? null };
  } catch { /* a corrupt value starts a fresh count */ }
  return emptyMeter(nowMs);
};
const save = (): void => { if (!state || !dirty) return; try { localStorage.setItem(METER_KEY, JSON.stringify(state)); dirty = false; } catch { /* nicety */ } };

/** fold URLs in from anywhere (the observer, main's counts); logs a closed day */
export function meterCount(urls: readonly string[], nowMs = Date.now()): void {
  if (!state) state = load(nowMs);
  const r = foldUrls(state, urls, nowMs);
  state = r.state; dirty = true;
  if (r.closed) logInfo('net', `requests on ${r.closed.day}`, { total: meterTotal(r.closed), ...r.closed.hosts });
}

export function meterSnapshot(nowMs = Date.now()): MeterState {
  if (!state) state = load(nowMs);
  // a day may have rolled over with nothing asked — still close it
  if (state.today.day !== utcDayOf(nowMs)) meterCount([], nowMs);
  return state;
}

let installed = false;
/** start counting in this window — once; the main window only (pop-outs load no data of their own) */
export function installNetMeter(): void {
  if (installed || typeof PerformanceObserver === 'undefined') return;
  installed = true;
  try {
    const obs = new PerformanceObserver((list) => {
      meterCount(list.getEntries().map((e) => e.name));
      // the resource buffer is small (250 by default) and the observer has seen these
      try { performance.clearResourceTimings(); } catch { /* nicety */ }
    });
    obs.observe({ type: 'resource', buffered: true });
  } catch { /* an old engine: no meter, nothing else changes */ }
  setInterval(save, 30_000);
  window.addEventListener('beforeunload', save);
}
