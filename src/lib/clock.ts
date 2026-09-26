// CLOCK SKEW (v0.227.0, audit F7; corrected in v0.228.0). Raid windows, planet timers and order
// ages compare an EVE-server timestamp with the PC clock; a corp mate whose clock is minutes off
// used to get wrong verdicts with no explanation. Every ESI answer carries a `Date` header — the
// server's clock, 1 s resolution, latency under a second — so the skew is measured from answers
// and exposed as serverNow() for the places that compare against EVE time.
//
// WHAT 0.227.0 GOT WRONG, measured in its own first minute: "586 s ahead", then "109 s ahead", a
// false status-bar warning. ESI's Date IS current on every answer it serves (curl, 2026-09-23) —
// but the renderer's HTTP cache replays an earlier answer, Date and all, for as long as its
// Expires allows (types and names: up to a day), and a median cannot survive a burst of replays.
// So: (1) only answers from LIVE endpoints count, Expires − Date ≤ 60 s (online, ship, location),
// whose replay can be at most a minute old; (2) the skew is the MAXIMUM of the last fifteen
// minutes' samples — a replay can only make the server look earlier, never later, and a stalled
// answer likewise; (3) the warning needs three samples. The freshest live answer is within a
// second of the truth. NOT applied to the mining watch: the game log's stamps are written by the
// EVE client, and whether they follow the PC clock or the server's is not established by
// measurement — correcting either way would be a guess (RULES #5).
import { logInfo, logWarn } from './devlog';

/** an endpoint whose answers live at most this long is "live" — a replay is at most this stale */
export const LIVE_TTL_MS = 60_000;
/** samples older than this are dropped */
export const WINDOW_MS = 15 * 60_000;
/** the status bar and the log speak up from this much skew … */
export const CLOCK_WARN_MS = 30_000;
/** … once this many live answers agree … */
export const MIN_SAMPLES = 3;
/** … spread over at least this long: right after a start the first answers are the HTTP cache
 * replaying what the app read a minute before the restart (0.232.0 warned "30 s ahead" from three
 * of them); a fresh live answer is certain only once a replay's whole lifetime has passed */
export const WARMUP_MS = 2 * LIVE_TTL_MS;
const samples: { at: number; skew: number }[] = [];
let warned = false;

const fmt = (ms: number): string => `${Math.round(Math.abs(ms) / 1000)} s`;

/** server clock minus PC clock: the maximum over the last fifteen minutes' live answers; null before the first */
export function skewMs(): number | null {
  if (samples.length === 0) return null;
  let m = -Infinity;
  for (const s of samples) if (s.skew > m) m = s.skew;
  return m;
}

/** feed every ESI answer's Date and Expires headers (esiRate.noteEsiResponse does) */
export function noteServerDate(dateHeader: string | null | undefined, expiresHeader: string | null | undefined, nowMs = Date.now()): void {
  if (!dateHeader || !expiresHeader) return;
  const t = Date.parse(dateHeader);
  const exp = Date.parse(expiresHeader);
  if (!Number.isFinite(t) || !Number.isFinite(exp)) return;
  if (exp - t > LIVE_TTL_MS) return; // a long-lived answer: a replay could be hours old — no evidence
  samples.push({ at: nowMs, skew: t - nowMs });
  while (samples.length > 0 && nowMs - samples[0].at > WINDOW_MS) samples.shift();
  const k = skewMs() ?? 0;
  const w = warmedUp() && Math.abs(k) >= CLOCK_WARN_MS;
  if (w !== warned) {
    warned = w;
    if (w) logWarn('clock', `PC clock is ${fmt(k)} ${k > 0 ? 'behind' : 'ahead of'} EVE time (measured from ESI answers) — raid windows and planet timers are corrected; fix the clock`, { skewMs: k, samples: samples.length });
    else logInfo('clock', 'PC clock back within 30 s of EVE time', { skewMs: k, samples: samples.length });
  }
}

/** enough live answers, spread over longer than a replay can live */
const warmedUp = (): boolean => samples.length >= MIN_SAMPLES && samples[samples.length - 1].at - samples[0].at >= WARMUP_MS;

/** the PC clock corrected to EVE time — for every comparison with an EVE-server timestamp */
export const serverNow = (nowMs = Date.now()): number => nowMs + (skewMs() ?? 0);

/** what the Collectors dashlet shows; null until the first live answer */
export function clockLine(): string | null {
  const k = skewMs();
  if (k === null) return null;
  return Math.abs(k) < 1500 ? 'PC clock matches EVE time' : `PC clock ${fmt(k)} ${k > 0 ? 'behind' : 'ahead of'} EVE time`;
}

/** the status-bar warning past 30 s with three live answers; null otherwise */
export function clockWarning(): { skewMs: number; text: string } | null {
  const k = skewMs();
  if (k === null || !warmedUp() || Math.abs(k) < CLOCK_WARN_MS) return null;
  return { skewMs: k, text: `Your PC clock is ${fmt(k)} ${k > 0 ? 'behind' : 'ahead of'} EVE time` };
}

/** fixtures only */
export function _resetClockForTests(): void {
  samples.length = 0;
  warned = false;
}
