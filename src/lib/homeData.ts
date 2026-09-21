// LIVE DATA FOR THE HOME DASHLETS (v0.207.0). Nothing here spends ESI calls of its own: every
// hook reads what a background collector, the app-wide order refresh or a tab already holds —
// memory, the stats folder, or the last map reading main keeps. Two dashlets of the same kind
// share one read (`useResource`).
import { useEffect, useMemo, useState } from 'react';
import { APERTURE_READS_ENABLED } from './apertureAccess';
import type { ChainExtract } from './apertureExtract';
import { parseReading, homeOrigin } from './chainReading';
import { digestChain, sanitizeDigest, type ChainDigest } from './chainDigest';
import { fetchChainPrices } from './chainPrices';
import { GAS_SITES, KSPACE_COMBAT, KSPACE_GAS, KSPACE_ORE, ORE_SITES } from './chainTables';
import { haulBasis, haulStats, parseHaulsFile } from './hauls';
import { logInfo } from './devlog';

// ---- a small shared, time-limited read
interface Entry { value: unknown; at: number; error: string | null; busy: boolean; subs: Set<() => void>; timer: ReturnType<typeof setInterval> | null }
const entries = new Map<string, Entry>();
const entryOf = (key: string): Entry => { let e = entries.get(key); if (!e) { e = { value: null, at: 0, error: null, busy: false, subs: new Set(), timer: null }; entries.set(key, e); } return e; };
function refreshEntry(key: string, loader: () => Promise<unknown>): void {
  const e = entryOf(key);
  if (e.busy) return;
  e.busy = true;
  void loader().then((v) => { e.value = v; e.at = Date.now(); e.error = null; })
    .catch((err) => { e.error = err instanceof Error ? err.message : String(err); })
    .finally(() => { e.busy = false; for (const s of e.subs) s(); });
}
/** the value (null until first read), when it was read, and the last error; re-read every ttl */
export function useResource<T>(key: string, loader: () => Promise<T>, ttlMs: number): { value: T | null; at: number; error: string | null } {
  const [, bump] = useState(0);
  useEffect(() => {
    const e = entryOf(key);
    const sub = () => bump((x) => x + 1);
    e.subs.add(sub);
    const check = () => { if (Date.now() - e.at >= ttlMs) refreshEntry(key, loader); };
    check();
    // one timer per RESOURCE however many dashlets read it (v0.211.0)
    if (!e.timer) e.timer = setInterval(check, Math.min(ttlMs, 30_000));
    return () => { e.subs.delete(sub); if (e.subs.size === 0 && e.timer) { clearInterval(e.timer); e.timer = null; } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ttlMs]);
  const e = entryOf(key);
  return { value: e.value as T | null, at: e.at, error: e.error };
}

/** re-render on a beat (countdowns, "x min ago"). ONE timer per period for the whole board
 * (v0.211.0) — sixty dashlets on a 30-second beat are one setInterval and one batch of renders,
 * not sixty timers drifting apart */
const beats = new Map<number, { subs: Set<(now: number) => void>; timer: ReturnType<typeof setInterval> }>();
export function useBeat(ms: number): number {
  const [n, setN] = useState(() => Date.now());
  useEffect(() => {
    let b = beats.get(ms);
    if (!b) { const subs = new Set<(now: number) => void>(); b = { subs, timer: setInterval(() => { const now = Date.now(); for (const f of subs) f(now); }, ms) }; beats.set(ms, b); }
    b.subs.add(setN);
    return () => { const cur = beats.get(ms); if (!cur) return; cur.subs.delete(setN); if (cur.subs.size === 0) { clearInterval(cur.timer); beats.delete(ms); } };
  }, [ms]);
  return n;
}

// ---- the chain: main keeps the last map reading; the digest of it is kept on disk too, so a
// cold start shows the last known chain with its age instead of an empty box
const DIGEST_KEY = 'etc-home-chain-digest';
const HOME_KEY = 'etc-chain-home';
const POLL_MS = 20_000;
const REFRESH_MS = 5 * 60_000;
export interface ChainFeed { digest: ChainDigest | null; /** shown from disk — no reading this session yet */ fromDisk: boolean; note: string }
let feed: ChainFeed = { digest: null, fromDisk: false, note: '' };
const feedSubs = new Set<() => void>();
let feedUsers = 0;
let feedTimers: ReturnType<typeof setInterval>[] = [];
let lastReadingAt = 0;
let pulling = false;
const setFeed = (next: Partial<ChainFeed>) => { feed = { ...feed, ...next }; for (const s of feedSubs) s(); };

async function pullChain(): Promise<void> {
  if (pulling) return;
  pulling = true;
  try {
    const d = (await window.appInfo?.chain?.get()) as (ChainExtract & { at?: number }) | null | undefined;
    if (!d || typeof d !== 'object') return;
    const at = d.at ?? 0;
    const good = !!d.sigText || ((d.feedRead?.sigs.length ?? 0) > 0);
    if (!good || at === lastReadingAt) return;
    const t0 = performance.now();
    let prices: Map<string, number> | null = null;
    try { prices = await fetchChainPrices(); } catch { prices = null; }
    let typed = '';
    try { const cfg = await window.appInfo?.config?.read(); typed = typeof cfg?.chainHome === 'string' ? cfg.chainHome.trim() : ''; } catch { /* file unreadable: the map's own home */ }
    if (!typed) { try { typed = localStorage.getItem(HOME_KEY) ?? ''; } catch { /* nicety */ } }
    let avg = haulStats([]);
    try { avg = haulStats(parseHaulsFile(await window.appInfo?.hauls?.read()).hauls); } catch { /* no hauls logged */ }
    const parsed = parseReading(d);
    const origin = homeOrigin(parsed, typed, d.feedRead?.home?.label ?? '');
    const digest = digestChain(parsed, origin, at || Date.now(), (n) => prices?.get(n) ?? null, {
      gas: GAS_SITES, ore: ORE_SITES, kcombat: KSPACE_COMBAT, kgas: KSPACE_GAS, kore: KSPACE_ORE,
      hauls: (site, group) => { const a = avg.lookup(site, group); return a ? { isk: a.mean, basis: haulBasis(a, site) } : null; },
    });
    lastReadingAt = at;
    logInfo('home', 'chain digest', { ms: Math.round(performance.now() - t0), sites: digest.sites, rocks: digest.rocks.length, ways: digest.ways.length, originOk: digest.originOk, priced: prices !== null });
    setFeed({ digest, fromDisk: false, note: prices === null ? 'Jita prices could not be read — ore and gas are unvalued' : '' });
    try { localStorage.setItem(DIGEST_KEY, JSON.stringify(digest)); } catch { /* nicety */ }
  } catch (e) {
    logInfo('home', 'chain digest failed', { err: e instanceof Error ? e.message : String(e) });
  } finally { pulling = false; }
}

export function useChainFeed(): ChainFeed {
  const [, bump] = useState(0);
  useEffect(() => {
    const sub = () => bump((x) => x + 1);
    feedSubs.add(sub);
    if (feedUsers++ === 0) {
      if (!feed.digest) {
        try { const disk = sanitizeDigest(JSON.parse(localStorage.getItem(DIGEST_KEY) ?? 'null')); if (disk) feed = { digest: disk, fromDisk: true, note: '' }; } catch { /* nothing kept */ }
      }
      void pullChain();
      // v0.214.0: nothing asks the map for a new reading any more (apertureAccess.ts)
      feedTimers = [setInterval(() => void pullChain(), POLL_MS), ...(APERTURE_READS_ENABLED ? [setInterval(() => window.appInfo?.chain?.refresh(), REFRESH_MS)] : [])];
    }
    return () => { feedSubs.delete(sub); if (--feedUsers === 0) { feedTimers.forEach(clearInterval); feedTimers = []; } };
  }, []);
  return feed;
}

/** for the rig: forget what this session has seen */
export function _resetHomeData(): void { entries.clear(); feed = { digest: null, fromDisk: false, note: '' }; lastReadingAt = 0; }

export const useMemoNow = <T,>(fn: (now: number) => T, deps: unknown[], beatMs = 30_000): T => {
  const now = useBeat(beatMs);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => fn(now), [now, ...deps]);
};
