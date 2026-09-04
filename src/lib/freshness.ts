// Self-scheduling data freshness. Two kinds of sources:
//  - 'header': ESI tells us exactly when new data will exist (Expires header) —
//    verified immediately, countdown is authoritative.
//  - 'learned': no header (Fuzzwork). We poll, hash the payload, record when the
//    content actually CHANGES, and infer the update period from observed change
//    intervals ("analyzing" until ≥2 intervals confirm it).
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SourceState {
  kind: 'header' | 'learned';
  state: 'analyzing' | 'verified';
  /** when the next auto-refresh should run (ms epoch); null = unknown yet */
  nextAt: number | null;
  /** last successful data pull */
  lastSuccess: number | null;
  /** learned sources: inferred update period */
  periodMs?: number;
  /** learned sources: timestamps when content changed (kept short) */
  changeTimes: number[];
  lastHash?: string;
  /** consecutive failures since the last success — drives the backoff */
  fails?: number;
}

interface FreshnessState {
  sources: Record<string, SourceState>;
  /** header source reported: schedule next just after the server's expiry */
  reportHeader: (key: string, expiresInMs: number) => void;
  /** learned source polled: pass a content hash; change intervals teach the period */
  reportLearned: (key: string, hash: string, basePollMs: number) => void;
  fail: (key: string) => void;
  /** run this source on the very next tick, clearing any failure backoff.
   * For a DELIBERATE user action ("I just ticked this character") — the
   * opposite of fail(), which exists to slow a source down. */
  runNow: (key: string) => void;
}

const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor((xs.length - 1) / 2)];

export const useFreshness = create<FreshnessState>()(
  persist(
    (set) => ({
      sources: {},

      reportHeader: (key, expiresInMs) =>
        set((s) => {
          const now = Date.now();
          const computed = now + Math.max(15_000, expiresInMs) + 2_000;
          // a manual "check now" mustn't reset the countdown: if we already know
          // an earlier upcoming update time, keep it — the schedule belongs to
          // the server, not to button clicks
          const existing = s.sources[key]?.nextAt;
          const nextAt =
            existing !== undefined && existing !== null && existing > now + 15_000
              ? Math.min(existing, computed)
              : computed;
          return {
            sources: {
              ...s.sources,
              [key]: {
                kind: 'header',
                state: 'verified',
                nextAt,
                lastSuccess: now,
                changeTimes: [],
                fails: 0, // a success clears the backoff streak
              },
            },
          };
        }),

      reportLearned: (key, hash, basePollMs) =>
        set((s) => {
          const prev = s.sources[key];
          const now = Date.now();
          let changeTimes = prev?.changeTimes ?? [];
          if (prev?.lastHash !== undefined && prev.lastHash !== hash) {
            changeTimes = [...changeTimes, now].slice(-6);
          }
          const gaps = changeTimes.slice(1).map((t, i) => t - changeTimes[i]);
          const periodMs = gaps.length >= 2 ? median(gaps) : undefined;
          const verified = periodMs !== undefined;
          const lastChange = changeTimes[changeTimes.length - 1] ?? now;
          const nextAt = verified
            ? Math.max(now + 60_000, lastChange + periodMs - 30_000)
            : now + basePollMs;
          return {
            sources: {
              ...s.sources,
              [key]: {
                kind: 'learned',
                state: verified ? 'verified' : 'analyzing',
                nextAt,
                lastSuccess: now,
                fails: 0,
                periodMs,
                changeTimes,
                lastHash: hash,
              },
            },
          };
        }),

      /**
       * A FAILING COLLECTOR MUST BACK OFF — ESPECIALLY ONE THAT HAS NEVER
       * WORKED. This used to bail out when there was no existing entry
       * (`if (!prev) return s`), so nothing was ever written; App.tsx's
       * 1-second scheduler reads a MISSING entry as "due now", and a source
       * that fails on its very first attempt was therefore retried once a
       * second, forever, with no backoff. A key has no entry on a fresh
       * install, after storage is cleared, or any time a NEW collector ships
       * — and CCP's daily downtime is enough to start it. It is also the
       * worst possible traffic to send at ESI: every one of those failures
       * spends from the shared 100-errors-per-60s budget.
       *
       * Now the entry is created on first failure and the wait doubles with
       * each consecutive one (2, 4, 8 … capped at 30 min), resetting on the
       * next success.
       */
      runNow: (key) =>
        set((s) => {
          const prev = s.sources[key];
          const base: SourceState = prev ?? {
            kind: 'header', state: 'analyzing', nextAt: null, lastSuccess: null, changeTimes: [],
          };
          return { sources: { ...s.sources, [key]: { ...base, fails: 0, nextAt: Date.now() } } };
        }),

      fail: (key) =>
        set((s) => {
          const prev = s.sources[key];
          const fails = (prev?.fails ?? 0) + 1;
          const backoff = Math.min(30 * 60_000, 120_000 * 2 ** (fails - 1));
          const base: SourceState = prev ?? {
            kind: 'header',
            state: 'analyzing',
            nextAt: null,
            lastSuccess: null,
            changeTimes: [],
          };
          return {
            sources: { ...s.sources, [key]: { ...base, fails, nextAt: Date.now() + backoff } },
          };
        }),
    }),
    {
      name: 'etc-freshness',
      partialize: (s) => ({ sources: s.sources }),
    },
  ),
);

/** "in 3m 12s" / "due now" */
export function countdown(nextAt: number | null): string {
  if (nextAt === null) return '…';
  const ms = nextAt - Date.now();
  if (ms <= 0) return 'due now';
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}
