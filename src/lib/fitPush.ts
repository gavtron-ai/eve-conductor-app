// THE LONG-RUNNING PUSH, owned OUTSIDE React.
//
// EVE permits 75 fitting operations per 15 minutes, so a full sync is hours,
// not seconds. That makes the run a background job, not a screen: switching
// to another tab unmounts the Propagator, and a run living in component
// state would keep firing ESI calls with nobody able to see it or STOP it.
//
// So the run lives here. The UI subscribes; leaving the tab (or the module)
// costs you the view, never the run, and coming back reattaches to it.
import { saveFitting, deleteFitting } from './esiChar';
import { toPostBody, type CharFits, type CharPlan, type EsiFitting, type SyncPlan } from './fitLibrary';
import { fitIdentityKey, type RawFitItem } from './fitSerial';
import { FITTING_GROUP, estimateMs, humanMs } from './esiRate';
import { logUser, logInfo, logError } from './devlog';

export interface PushLogLine { text: string; kind: 'ok' | 'err' | 'info' }

export interface PushState {
  /** which long-running job this is — they share the machinery and are
   * mutually exclusive, which is also correct: a push and a restore racing
   * each other over the same fittings would be a very bad afternoon */
  kind: 'push' | 'restore';
  running: boolean;
  done: number;
  total: number;
  /** what the run is currently working on, for the idle observer */
  current: string;
  log: PushLogLine[];
  startedAt: number | null;
  finishedAt: number | null;
}

const state: PushState = {
  kind: 'push', running: false, done: 0, total: 0, current: '', log: [],
  startedAt: null, finishedAt: null,
};

/**
 * Fits WE created that ESI has not published yet (its list is cached 300s).
 * Kept here rather than in the component so a rescan after a tab switch
 * still knows what exists — believing the stale list is what created
 * duplicates once.
 */
const created = new Map<number, EsiFitting[]>();

let stop = false;
const listeners = new Set<() => void>();
const emit = () => { for (const fn of listeners) fn(); };

export const pushState = (): PushState => state;
export const createdFits = (): Map<number, EsiFitting[]> => created;
/** record a fit WE just made, so a scan taken before EVE publishes it does
 * not conclude it is missing and create it again */
export function noteCreated(
  characterId: number,
  fittingId: number,
  c: { name: string; shipTypeId: number; items: RawFitItem[]; description: string },
): void {
  const list = created.get(characterId) ?? [];
  list.push({ fitting_id: fittingId, name: c.name, ship_type_id: c.shipTypeId, items: c.items, description: c.description });
  created.set(characterId, list);
}
/**
 * Forget a fit we created that has since been deleted. `created` exists to
 * cover ESI's 300s list cache, but it was only ever appended to — so a fit
 * created and then deleted in the same session was resurrected into every
 * later scan by withCreated(), for the rest of the session. That makes the
 * library show a fit the character does not have, and a mirror plan compute
 * against a roster that is wrong.
 */
export function noteDeleted(characterId: number, fittingId: number): void {
  const list = created.get(characterId);
  if (!list) return;
  const next = list.filter((f) => f.fitting_id !== fittingId);
  if (next.length === 0) created.delete(characterId);
  else created.set(characterId, next);
}

export function subscribePush(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function stopPush(): void {
  stop = true;
  logUser(`${state.kind} STOPPED by the user`, { done: state.done, total: state.total });
  emit();
}
export function clearPushLog(): void {
  if (state.running) return;
  state.log = [];
  emit();
}

/** merge our own record into a scan — once EVE publishes a fit, the scan
 * (which carries the real fitting_id) is the better source */
export function withCreated(rows: CharFits[]): CharFits[] {
  return rows.map((c) => {
    const mine = created.get(c.characterId) ?? [];
    if (mine.length === 0) return c;
    const have = new Set(c.fits.map((f) => f.fitting_id));
    const extra = mine.filter((f) => !have.has(f.fitting_id));
    return extra.length === 0 ? c : { ...c, fits: [...c.fits, ...extra] };
  });
}

const log = (text: string, kind: PushLogLine['kind'] = 'info') => {
  state.log.push({ text, kind });
  // mirror to the dev log: these runs take hours and the user is not watching
  // the whole time, so the file is the only durable record of what happened
  if (kind === 'err') logError(state.kind, text);
  else logInfo(state.kind, text);
  emit();
};

const callsIn = (plan: SyncPlan) =>
  plan.chars.reduce((n, p) => n + (p.blocked ? 0 : p.creates.length + p.deletes.length), 0);

/**
 * Run an approved plan. `snapshot` is the scan the plan was built from AND
 * the one the backup covers — the two must be the same, or a delete could
 * reach a character the backup does not hold.
 */
export async function startPush(approved: SyncPlan, snapshot: CharFits[]): Promise<void> {
  if (state.running) return;
  stop = false;
  state.kind = 'push';
  state.running = true;
  logUser('fit push STARTED', { operations: callsIn(approved), characters: approved.chars.length });
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.done = 0;
  state.total = callsIn(approved);
  state.current = '';
  emit();

  const tick = () => {
    state.done++;
    emit();
  };

  log(`EVE allows ${FITTING_GROUP.maxTokens} fitting tokens per 15 minutes (${Math.floor(FITTING_GROUP.maxTokens / 2)} operations). This run needs ${state.total} — about ${humanMs(estimateMs(FITTING_GROUP, state.total))}. It keeps running if you switch tabs; stop it any time and re-run later to continue.`);

  try {
    for (const p of approved.chars) {
      if (stop) { log('STOPPED by you. Nothing further was changed; re-run any time to continue.', 'err'); break; }
      if (p.blocked) { log(`${p.characterName}: skipped — ${p.blocked}`, 'err'); continue; }
      if (p.creates.length === 0 && p.deletes.length === 0) { log(`${p.characterName}: already matches the library.`); continue; }
      state.current = p.characterName;
      emit();

      // CREATES FIRST. A fit must never be deleted before its replacement exists.
      let failed = 0;
      let already = 0;
      const liveNow = snapshot.find((x) => x.characterId === p.characterId);
      const present = new Set(
        [...(liveNow?.fits ?? []), ...(created.get(p.characterId) ?? [])]
          .map((f) => `${fitIdentityKey(f.ship_type_id, f.items)}|${f.name}`),
      );
      for (const c of p.creates) {
        const dupKey = `${c.key}|${c.name}`;
        // a skipped create is still one of `total` — without the tick the bar
        // could never reach 100% and a finished run looked stalled
        if (present.has(dupKey)) { already++; tick(); continue; }
        if (stop) break;
        try {
          const id = await saveFitting(p.characterId, toPostBody(c), () => stop);
          const list = created.get(p.characterId) ?? [];
          list.push({
            fitting_id: id, name: c.name, ship_type_id: c.shipTypeId,
            items: c.items as RawFitItem[], description: c.description,
          });
          created.set(p.characterId, list);
          present.add(dupKey);
          tick();
        } catch (e) {
          if (stop) break;
          failed++;
          log(`${p.characterName}: could not create “${c.name}” (${c.hullName}) — ${e instanceof Error ? e.message : String(e)}`, 'err');
        }
      }
      if (failed > 0) {
        log(`${p.characterName}: ${failed} fit(s) failed to create, so NOTHING was deleted for this character. Existing fits are untouched.`, 'err');
        continue;
      }
      if (already > 0) log(`${p.characterName}: ${already} already present — not duplicated.`);
      if (p.creates.length - already > 0) log(`${p.characterName}: created ${p.creates.length - already} fit(s).`, 'ok');

      let deleted = 0;
      for (const d of p.deletes) {
        if (stop) break;
        try {
          await deleteFitting(p.characterId, d.fittingId, () => stop);
          noteDeleted(p.characterId, d.fittingId);
          deleted++;
          tick();
        } catch (e) {
          if (stop) break;
          log(`${p.characterName}: could not delete “${d.name}” — ${e instanceof Error ? e.message : String(e)}`, 'err');
        }
      }
      if (p.deletes.length > 0) {
        log(`${p.characterName}: deleted ${deleted}/${p.deletes.length} fit(s).`, deleted === p.deletes.length ? 'ok' : 'err');
      }
    }
    log(stop ? 'Run stopped.' : 'Run finished.', stop ? 'err' : 'ok');
  } finally {
    state.running = false;
    state.current = '';
    state.finishedAt = Date.now();
    emit();
  }
}

/**
 * THE RESTORE, also owned outside React.
 *
 * It lived in the FitLibrary component while the push had already been moved
 * out here — so switching tab or module mid-restore unmounted the only thing
 * holding its log, its progress and its stop button, while the ESI calls
 * carried on. Coming back showed a blank panel over a run still in flight.
 * The user is (rightly) nervous about restores; an orphaned one is the worst
 * possible version of that.
 *
 * ADD-ONLY: a restore never deletes anything. Afterwards every intended fit
 * is re-read from EVE and CONFIRMED present, keyed on identity AND NAME —
 * the same key the plan used to decide it was missing.
 */
export async function startRestore(
  staged: { fileName: string; plans: CharPlan[] },
  characters: { characterId: number; characterName: string }[],
  known: CharFits[],
  deps: {
    saveFitting: typeof saveFitting;
    listFittings: (charId: number) => Promise<{ fits: EsiFitting[] }>;
  },
): Promise<CharFits[] | null> {
  if (state.running) return null;
  stop = false;
  state.kind = 'restore';
  state.running = true;
  logUser('fit restore STARTED', { file: staged.fileName, characters: staged.plans.length });
  state.startedAt = Date.now();
  state.finishedAt = null;
  state.done = 0;
  state.total = staged.plans.reduce((n, p) => n + (p.blocked ? 0 : p.creates.length), 0);
  state.current = '';
  emit();

  let out: CharFits[] | null = null;
  try {
    log(`Restoring from ${staged.fileName}. NOTHING will be deleted. ${state.total} operation(s) at EVE's allowed pace — about ${humanMs(estimateMs(FITTING_GROUP, state.total))}. It keeps running if you switch tabs.`);
    const wanted = new Map<number, string[]>();
    for (const p of staged.plans) {
      if (stop) { log('STOPPED by you. Nothing was deleted; re-run any time.', 'err'); break; }
      if (p.blocked) { log(`${p.characterName}: skipped — ${p.blocked}`, 'err'); continue; }
      if (p.creates.length === 0) { log(`${p.characterName}: nothing missing.`); continue; }
      state.current = p.characterName;
      emit();

      let ok = 0;
      let skipped = 0;
      // LAST-DITCH DUPLICATE GUARD: whatever the plan believed, never create
      // a fit this character already has under the same name
      const live = known.find((x) => x.characterId === p.characterId);
      const present = new Set(
        [...(live?.fits ?? []), ...(created.get(p.characterId) ?? [])]
          .map((f) => `${fitIdentityKey(f.ship_type_id, f.items)}|${f.name}`),
      );
      for (const c of p.creates) {
        const k = `${c.key}|${c.name}`;
        if (present.has(k)) { skipped++; state.done++; emit(); continue; }
        if (stop) break;
        try {
          const id = await deps.saveFitting(p.characterId, toPostBody(c), () => stop);
          noteCreated(p.characterId, id, c);
          present.add(k);
          ok++;
          state.done++;
          emit();
        } catch (e) {
          if (stop) break;
          log(`${p.characterName}: could not restore “${c.name}” — ${e instanceof Error ? e.message : String(e)}`, 'err');
        }
      }
      if (skipped > 0) log(`${p.characterName}: ${skipped} already present — not duplicated.`);
      wanted.set(p.characterId, p.creates.map((c) => `${c.key}|${c.name}`));
      log(`${p.characterName}: recreated ${ok}/${p.creates.length}.`, ok === p.creates.length ? 'ok' : 'err');
    }

    // VERIFY: re-read from ESI and confirm each fit is really there now
    log('Re-reading from EVE to confirm what actually landed…');
    log('  (EVE serves this list on a 5-minute cache, so anything just created may not appear yet — the app tracks its own creates so nothing gets made twice.)');
    const fresh: CharFits[] = [];
    for (const c of characters) {
      try {
        fresh.push({
          characterId: c.characterId,
          characterName: c.characterName,
          canWrite: true,
          fits: (await deps.listFittings(c.characterId)).fits,
        });
      } catch {
        log(`${c.characterName}: could not re-read to confirm — check manually.`, 'err');
      }
    }
    for (const [charId, keys] of wanted) {
      const liveNow = fresh.find((f) => f.characterId === charId);
      if (!liveNow) continue;
      const have = new Set(liveNow.fits.map((f) => `${fitIdentityKey(f.ship_type_id, f.items)}|${f.name}`));
      const missing = keys.filter((k) => !have.has(k));
      log(missing.length === 0
        ? `  ${liveNow.characterName}: CONFIRMED by EVE — every restored fit is present.`
        : `  ${liveNow.characterName}: ${missing.length} not visible yet — expected while EVE's 5-minute cache is still serving the old list. Re-check with "Check against game" in a few minutes.`,
        missing.length === 0 ? 'ok' : 'info');
    }
    if (fresh.length === characters.length) out = withCreated(fresh);
    log('Restore finished. (EVE caches the fittings list ~5 min, so the in-game window may lag.)', 'ok');
  } catch (e) {
    log(`Restore failed: ${e instanceof Error ? e.message : String(e)}`, 'err');
  } finally {
    state.running = false;
    state.current = '';
    state.finishedAt = Date.now();
    emit();
  }
  return out;
}
