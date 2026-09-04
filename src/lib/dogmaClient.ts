// THE MAIN-THREAD SIDE OF THE DOGMA WORKER.
//
// Callers already await, so moving the engine off-thread changes nothing about
// their shape — only about whether the window keeps painting while a sweep
// runs. If the worker cannot boot (an Electron sandbox change, a packaging
// mistake, a browser without module workers), everything falls back to the
// existing in-process path rather than losing the feature: a slow fitting
// panel beats a broken one.
import { logInfo, logWarn, logError } from './devlog';
import type { EsfFitShape, FitStats } from './dogmaFit';
import type { CalcRequest, WorkerOut } from './dogmaWorker.worker';

type Pending = { resolve: (s: FitStats) => void; reject: (e: Error) => void };

let worker: Worker | null = null;
let workerDead = false;
let nextId = 1;
const pending = new Map<number, Pending>();

/** rolling cost, so the log can show whether the worker is actually earning
 * its 59 MB rather than just existing */
let runs = 0;
let totalMs = 0;

/** the overlay and clone-config windows load the SAME bundle; neither ever
 * scores a fit, and each would otherwise pay for its own copy of the SDE */
const wantsDogma = (): boolean => {
  const h = typeof location === 'undefined' ? '' : location.hash;
  return h !== '#overlay' && h !== '#clone-config';
};

function spawn(): Worker | null {
  if (workerDead || !wantsDogma()) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./dogmaWorker.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      if (m.kind === 'ready') {
        logInfo('dogma', 'worker ready', { bootMs: Math.round(m.ms) });
        return;
      }
      if (m.kind === 'bootFailed') {
        logError('dogma', 'worker boot FAILED — falling back to the main thread', { error: m.error });
        failAll(new Error(m.error));
        workerDead = true;
        worker = null;
        return;
      }
      const p = pending.get(m.id);
      if (!p) return;
      pending.delete(m.id);
      if (m.kind === 'ok') {
        runs += 1;
        totalMs += m.ms;
        p.resolve(m.stats);
      } else {
        p.reject(new Error(m.error));
      }
    };
    worker.onerror = (e) => {
      logError('dogma', 'worker crashed — falling back to the main thread', {
        message: (e as ErrorEvent).message ?? String(e),
      });
      failAll(new Error('dogma worker crashed'));
      workerDead = true;
      worker = null;
    };
    logInfo('dogma', 'worker spawned');
    return worker;
  } catch (e: unknown) {
    logWarn('dogma', 'worker could not be created — staying on the main thread', {
      error: e instanceof Error ? e.message : String(e),
    });
    workerDead = true;
    return null;
  }
}

function failAll(err: Error) {
  for (const [, p] of pending) p.reject(err);
  pending.clear();
}

/** true when the engine is genuinely running off-thread right now */
export const workerActive = (): boolean => worker !== null && !workerDead;

/** average engine cost, for the diagnostics panel */
export const workerStats = (): { runs: number; avgMs: number } => ({
  runs,
  avgMs: runs > 0 ? totalMs / runs : 0,
});

/** boot the worker early so its ~250 ms SDE decode never lands on a click */
export function warmDogmaWorker(): void {
  if (wantsDogma()) spawn();
}

/**
 * Run one fit through the engine in the worker. Rejects with `WORKER_UNAVAILABLE`
 * when there is no worker — the caller then uses the in-process path, which is
 * why this never throws a mystery.
 */
export function calcInWorker(
  esfFit: EsfFitShape,
  skills: Record<string, number>,
  hullOwn: number[],
  benchedDrones: string[],
): Promise<FitStats> {
  const w = spawn();
  if (!w) return Promise.reject(new Error('WORKER_UNAVAILABLE'));
  const id = nextId++;
  const req: CalcRequest = { id, esfFit, skills, hullOwn, benchedDrones };
  return new Promise<FitStats>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage(req);
  });
}

export const WORKER_UNAVAILABLE = 'WORKER_UNAVAILABLE';
