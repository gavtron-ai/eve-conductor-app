// THE FIT PROPAGATOR (Skill & Fit module tab) — pulls every character's
// personal saved fits into one canonical list, merges the identical ones
// (hull + fitting; names ignored), lets the names be cleaned up, and then
// makes every character's personal folder match that list exactly.
//
// Duplicates sort to the TOP: an entry that merged several saved fits is
// the one needing a decision; a fit that exists in one place needs none.
//
// THIS TOOL DELETES FITS IN GAME AND EVE HAS NO UNDO. Three guards:
//   1. every character's fittings are written to a backup file BEFORE the
//      first delete, and the tool refuses to run if that backup fails;
//   2. the full plan is shown and must be confirmed — nothing is implied;
//   3. per character, CREATES run first and a single failure cancels that
//      character's deletes, so a fit is never removed before its
//      replacement exists.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import {
  listFittings, saveFitting, tokenHasScope,
  FITTINGS_WRITE_SCOPE, FITTINGS_READ_SCOPE,
} from '../lib/esiChar';
import {
  buildLibrary, buildPlan, emptyOverrides, ESI_FIT_NAME_MAX,
  verifyBackup, buildRestorePlan,
  type CharFits, type LibraryOverrides, type LibraryEntry, type PushMode, type BackupShape,
} from '../lib/fitLibrary';
import { FITTING_GROUP, rateStatus, estimateMs, humanMs } from '../lib/esiRate';
import { buildFittingXml } from '../lib/fitXml';
import {
  startPush, startRestore, stopPush, pushState, subscribePush, withCreated, clearPushLog,
} from '../lib/fitPush';
import FitInspector from './FitInspector';

const OVERRIDES_KEY = 'eve-conductor-fit-library-v1';
const loadOverrides = (): LibraryOverrides => {
  try {
    const raw = JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? 'null') as LibraryOverrides | null;
    if (raw && typeof raw === 'object' && raw.names && raw.excluded) return raw;
  } catch {
    /* fall through to a clean slate */
  }
  return emptyOverrides();
};

interface LogLine { text: string; kind: 'ok' | 'err' | 'info' }

/** EVE caps saved fittings per character. CCP does not publish the number;
 * community reports say 250 (older) and 500 (newer tooling), and this
 * user's own account proves it is at least 152. Warn at the LOWER claim
 * rather than discover the ceiling mid-import. */
const SAFE_FIT_CAP = 250;

/** Fits per exported file. The EVE import dialog lists every fit in the file
 * with a tick box; a 214-fit file is unwieldy AND lands a character over the
 * cap in one go. Small files import cleanly and, if one is refused, you know
 * exactly which batch. */
const FITS_PER_FILE = 50;

export default function FitLibrary({ characterIds, onLockChange }: {
  characterIds: number[];
  /** the sidebar must not be changeable while a plan is staged or running —
   * the approval is an approval OF THAT ROSTER */
  onLockChange?: (locked: boolean) => void;
}) {
  const allCharacters = useAuth((s) => s.characters);
  /** ONLY the ticked characters. This tool reads, backs up, writes and
   * deletes — so the set it may touch is the set the user ticked, and
   * nothing else is scanned, listed or changed. */
  const characters = allCharacters.filter((c) => characterIds.includes(c.characterId));
  const [chars, setChars] = useState<CharFits[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [overrides, setOverrides] = useState<LibraryOverrides>(loadOverrides);
  /** THE PLAN THE USER ACTUALLY APPROVED. Frozen when the confirm panel
   * opens, and it is this snapshot that runs — not a live-derived plan that
   * could shift under the cursor from a rename or a background rescan
   * between reading the numbers and clicking the button. */
  const [pending, setPending] = useState<
    { plan: ReturnType<typeof buildPlan>; chars: CharFits[]; rosterKey: string } | null>(null);
  /** the run lives OUTSIDE React (lib/fitPush.ts) so it survives leaving
   * this tab — a multi-hour job must not depend on a component staying
   * mounted. This just mirrors it for rendering. */
  const [, forcePushRender] = useState(0);
  useEffect(() => subscribePush(() => forcePushRender((n) => n + 1)), []);
  const push = pushState();
  const applying = push.running;
  const [log, setLog] = useState<LogLine[]>([]);
  const [filter, setFilter] = useState('');
  /** 'add' NEVER deletes. Mirror is opt-in and must be re-armed each time
   * the tab mounts — it is not a setting to leave switched on. */
  const [mode, setMode] = useState<PushMode>('add');
  const [backups, setBackups] = useState<{ name: string; size: number; mtime: number }[]>([]);
  const [statsDir, setStatsDir] = useState<string>('');
  const [restoring, setRestoring] = useState<string | null>(null);
  /** a long run must be stoppable — at EVE's pace a big push takes hours */
  const [rate, setRate] = useState(() => rateStatus(FITTING_GROUP));
  useEffect(() => {
    const t = setInterval(() => setRate(rateStatus(FITTING_GROUP)), 1000);
    return () => clearInterval(t);
  }, []);
  const [checking, setChecking] = useState<string | null>(null);
  const [exported, setExported] = useState<string | null>(null);
  const [restorePlan, setRestorePlan] = useState<{ fileName: string; plans: ReturnType<typeof buildRestorePlan> } | null>(null);
  /** the fit being inspected, and the one it is compared against — by KEY,
   * so a rescan that rebuilds the library keeps the selection */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [compareKey, setCompareKey] = useState<string | null>(null);

  /**
   * WHO is logged in, not the array holding them. `characters` is rebuilt by
   * `.map()` on every background write to the auth store — and this tab now
   * lives in the module that auto-resyncs skills and implants every ~5
   * minutes. Depending on the array identity re-fired a FULL rescan on every
   * one of those, which wiped the log of an operation EVE cannot undo and
   * rebuilt the library from a half-read roster.
   */
  const rosterKey = [...characterIds].sort((a, b) => a - b).join(',');

  /** the roster the running scan must use, read live so the callback does
   * not need the array in its dependencies */
  const rosterKeyRef = useRef(rosterKey);
  rosterKeyRef.current = rosterKey;
  /** identifies the current scan so a superseded one cannot write */
  const scanRun = useRef(0);

  /**
   * WHAT THIS APP HAS CREATED, that EVE has not published yet.
   *
   * EVE caches the fittings list for 300s, so immediately after a push the
   * list ESI serves does NOT contain what we just made. Believing that list
   * made the next operation conclude those fits were missing and create them
   * AGAIN — the duplicates the user found after a push-then-restore. POST
   * returns the new fitting_id, so the app KNOWS what exists; that knowledge
   * is authoritative until the cache catches up.
   */
  // what WE created but EVE has not published yet — owned by the runner so
  // it survives a tab switch (see lib/fitPush.ts)
  const withJustCreated = withCreated;

  const persist = (next: LibraryOverrides) => {
    setOverrides(next);
    try {
      localStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
    } catch {
      // the cleanup still works this session; only its persistence is lost
    }
  };

  /** `keepLog` matters: the post-apply rescan must NOT wipe the record of an
   * operation EVE cannot undo — which failed, which deletes were cancelled,
   * and the name of the backup file. */
  const scan = useCallback(async (keepLog = false) => {
    // a superseded scan must never write: two overlapping scans could leave
    // `chars` holding characters that are no longer ticked, while the counts
    // still happen to match and the tool believes the roster is complete
    const run = ++scanRun.current;
    setScanning(true);
    if (!keepLog) setLog([]);
    const out: CharFits[] = [];
    // read the roster LIVE rather than depending on the array identity —
    // see rosterKey below
    const ids = new Set(rosterKeyRef.current.split(',').filter(Boolean).map(Number));
    for (const c of useAuth.getState().characters.filter((x) => ids.has(x.characterId))) {
      const row: CharFits = {
        characterId: c.characterId,
        characterName: c.characterName,
        fits: [],
        canWrite: tokenHasScope(c.characterId, FITTINGS_WRITE_SCOPE),
      };
      if (!tokenHasScope(c.characterId, FITTINGS_READ_SCOPE)) {
        row.error = 'no fittings scope on this login — log out and back in (Settings → EVE login)';
      } else {
        try {
          const got = await listFittings(c.characterId);
          row.fits = got.fits;
          row.expiresIn = got.expiresIn;
        } catch (e) {
          row.error = e instanceof Error ? e.message : String(e);
        }
      }
      if (scanRun.current !== run) return; // superseded — drop everything
      out.push(row);
      setChars(withJustCreated([...out])); // show progress as it lands
    }
    if (scanRun.current !== run) return;
    setChars(withJustCreated(out));
    setScanning(false);
    setScanned(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rosterKey]);

  useEffect(() => {
    onLockChange?.(pending !== null || applying || restorePlan !== null || restoring !== null);
  }, [pending, applying, restorePlan, restoring, onLockChange]);

  useEffect(() => { void scan(); }, [scan]);

  /** a confirm panel is an approval of a SPECIFIC set of characters —
   * changing that set voids it rather than silently re-arming */
  useEffect(() => {
    setPending(null);
    setRestorePlan(null);
  }, [rosterKey]);


  const library = useMemo(() => buildLibrary(chars, overrides), [chars, overrides]);
  const plan = useMemo(() => buildPlan(chars, library, mode), [chars, library, mode]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return library;
    return library.filter((e) =>
      [e.name, e.hullName, ...e.nameVariants, ...e.sources.map((s) => s.characterName)]
        .join(' ').toLowerCase().includes(q));
  }, [library, filter]);

  const selected = library.find((e) => e.key === selectedKey) ?? null;
  const compared = library.find((e) => e.key === compareKey) ?? null;

  const setName = (entry: LibraryEntry, name: string) =>
    persist({ ...overrides, names: { ...overrides.names, [entry.key]: name } });

  /** Include/exclude everything currently VISIBLE. Deliberately scoped to
   * the filter: a blanket "none" that also excluded rows scrolled out of
   * sight — or filtered away — would queue deletions the user never saw. */
  const setAllShown = (included: boolean) => {
    const excluded = { ...overrides.excluded };
    for (const e of shown) {
      if (included) delete excluded[e.key];
      else excluded[e.key] = true;
    }
    persist({ ...overrides, excluded });
  };

  const toggleInclude = (entry: LibraryEntry) => {
    const excluded = { ...overrides.excluded };
    if (entry.included) excluded[entry.key] = true;
    else delete excluded[entry.key];
    persist({ ...overrides, excluded });
  };

  const totalFits = chars.reduce((n, c) => n + c.fits.length, 0);
  /** when EVE will next have anything new to say, across the scanned set */
  const expiries = chars.map((c) => c.expiresIn).filter((v): v is number => typeof v === 'number');
  const freshestIn = expiries.length > 0 ? Math.min(...expiries) : null;
  const staleIn = expiries.length > 0 ? Math.max(...expiries) : null;
  const readable = chars.filter((c) => !c.error);
  const writable = chars.filter((c) => c.canWrite && !c.error);
  const blocked = plan.chars.filter((p) => p.blocked);
  /** a scan still in flight publishes progress, so `chars` can be a PARTIAL
   * roster — acting on that would skip whole characters and, worse, produce
   * a backup that only covers the ones read so far */
  const rosterComplete = !scanning && scanned && chars.length === characters.length;
  const canApply = rosterComplete && plan.problems.length === 0
    && (plan.totalCreates > 0 || plan.totalDeletes > 0) && writable.length > 0;

  /**
   * Snapshot EVERY fitting to the long-term stats folder. Returns the file
   * name, or null — and null means nothing gets touched.
   *
   * The write is VERIFIED by reading it back and re-parsing it: a backup
   * that silently wrote nothing is worse than no backup, because it is the
   * thing that authorises the deletes. (The write helper returns undefined
   * on success, so its return value is not a usable signal.)
   */
  /**
   * Snapshot EVERY fitting to the long-term stats folder, then PROVE it.
   *
   * Verification is a field-by-field comparison against the live scan —
   * every character, every fit by id, every item including cargo and drones
   * with its flag and quantity. Not "did the write throw": this file is what
   * authorises deleting things EVE cannot restore.
   *
   * Returns the file name, or null with the reasons pushed into `problems`.
   */
  async function backup(snapshot: CharFits[], problems: string[]): Promise<string | null> {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const name = `fits-backup-${stamp}.json`;
    const body = JSON.stringify({
      savedAt: new Date().toISOString(),
      note: "Pre-push snapshot of every character's personal saved fittings, written by the Fit Propagator. Restore it from the Backups panel in that tab.",
      characters: snapshot.map((c) => ({
        characterId: c.characterId, characterName: c.characterName, error: c.error ?? null, fits: c.fits,
      })),
    }, null, 1);
    const write = window.appInfo?.stats?.auxWrite;
    const read = window.appInfo?.stats?.auxRead;
    if (!write || !read) { problems.push('not running in the desktop app — no stats folder to write to'); return null; }
    try {
      await write(name, body);
      const back = await read(name);
      if (typeof back !== 'string') { problems.push('the backup could not be read back after writing'); return null; }
      const parsed = JSON.parse(back) as BackupShape;
      const found = verifyBackup(snapshot, parsed);
      if (found.length > 0) { problems.push(...found); return null; }
      return name;
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
      return null;
    }
  }

  /** re-read the list of backup files (names only — never their contents) */
  const refreshBackups = useCallback(async () => {
    try {
      const list = await window.appInfo?.stats?.auxNames?.();
      setBackups((list ?? []).filter((f) => f.name.startsWith('fits-backup-')));
      const info = await window.appInfo?.stats?.info?.();
      if (info?.dir) setStatsDir(info.dir);
    } catch {
      setBackups([]);
    }
  }, []);
  useEffect(() => { void refreshBackups(); }, [refreshBackups]);

  /**
   * READ-ONLY: compare a snapshot against what is in game RIGHT NOW.
   * No writes at all. This is how you prove a backup is real and readable
   * BEFORE trusting it — and how you confirm a restore actually landed.
   */
  async function checkBackup(fileName: string) {
    setChecking(fileName);
    const add = (text: string, kind: LogLine['kind'] = 'info') => setLog((l) => [...l, { text, kind }]);
    try {
      const raw = await window.appInfo?.stats?.auxRead(fileName);
      if (typeof raw !== 'string') { add(`Could not read ${fileName}.`, 'err'); return; }
      const parsed = JSON.parse(raw) as BackupShape;
      const plans = buildRestorePlan(chars, parsed);
      const totalInFile = (parsed.characters ?? []).reduce((n, c) => n + (c.fits?.length ?? 0), 0);
      add(`${fileName}: readable, holds ${totalInFile} fit(s) across ${(parsed.characters ?? []).length} character(s). Nothing was changed.`, 'ok');
      for (const p of plans) {
        if (p.blocked) { add(`  ${p.characterName}: cannot be checked — ${p.blocked}`, 'err'); continue; }
        add(p.creates.length === 0
          ? `  ${p.characterName}: all ${p.keeps} fit(s) from this snapshot are present in game, under their original names.`
          : `  ${p.characterName}: ${p.keeps} present, ${p.creates.length} missing or RENAMED${(p.renamed ?? 0) > 0 ? ` (${p.renamed} renamed)` : ''} — Restore would recreate: ${p.creates.slice(0, 5).map((c) => `“${c.name}”`).join(', ')}${p.creates.length > 5 ? ` +${p.creates.length - 5}` : ''}`,
          p.creates.length === 0 ? 'ok' : 'info');
      }
    } catch (e) {
      add(`Could not read ${fileName}: ${e instanceof Error ? e.message : String(e)}`, 'err');
    } finally {
      setChecking(null);
    }
  }

  /** stage a restore: show EXACTLY what it would create, then confirm */
  async function previewRestore(fileName: string) {
    try {
      const raw = await window.appInfo?.stats?.auxRead(fileName);
      if (typeof raw !== 'string') return;
      const parsed = JSON.parse(raw) as BackupShape;
      setRestorePlan({ fileName, plans: buildRestorePlan(chars, parsed) });
    } catch {
      setLog((l) => [...l, { text: `Could not read ${fileName}.`, kind: 'err' }]);
    }
  }

  /**
   * RESTORE — now owned by lib/fitPush.ts, exactly like the push.
   * It used to live here, so switching tab or module mid-restore unmounted
   * the only thing holding its log and its stop button while the ESI calls
   * carried on. The runner survives; this just starts it and re-attaches.
   */
  async function runRestore() {
    const staged = restorePlan;
    if (!staged) return;
    setRestorePlan(null);
    setRestoring(staged.fileName);
    try {
      const fresh = await startRestore(
        staged,
        characters.map((c) => ({ characterId: c.characterId, characterName: c.characterName })),
        chars,
        { saveFitting, listFittings },
      );
      if (fresh) setChars(fresh);
    } finally {
      setRestoring(null);
    }
  }

  /**
   * THE BULK PATH. The EVE client imports a whole file of fits in one
   * action, client-side — no API, no tokens, no rate limit, instant. For
   * hundreds of fits that is the difference between seconds and hours.
   * The file is written where the client looks for it.
   */
  /**
   * THE BULK PATH — EVE's own fitting-file import. Client-side, instant,
   * zero API budget.
   *
   * ONE FILE PER CHARACTER, holding only what THAT character lacks, split
   * into batches of FITS_PER_FILE. Both properties are load-bearing:
   *   · per character, because the client does NOT dedupe on import, so a
   *     whole-library file would duplicate everything they already had;
   *   · batched, because a 214-fit file both overwhelms the import dialog
   *     and lands a character past the saved-fitting cap in one go — which
   *     is why the first attempt failed.
   */
  /** PYFA EXPORT (user ask): every INCLUDED library entry — already deduped
   * by hull+fitting — as one EVE XML fitting file each, into a folder the
   * user picks. XML because that is the format pyfa's import dialog
   * PRESELECTS (*.xml); one-file-per-fit keeps re-exports diff-friendly and
   * lets pyfa multi-select the whole folder. */
  async function exportPyfa() {
    const add = (text: string, kind: LogLine['kind'] = 'info') => setLog((l) => [...l, { text, kind }]);
    const write = window.appInfo?.fittings?.exportEftFolder;
    if (!write) { add('pyfa export needs the desktop app.', 'err'); return; }
    const entries = library.filter((e) => e.included);
    if (entries.length === 0) { add('Nothing to export — every entry is excluded.', 'err'); return; }
    const sanitize = (t: string) => t.replace(/[^A-Za-z0-9 ()._'-]/g, '').replace(/\s+/g, ' ').trim();
    const used = new Set<string>();
    const files: { name: string; content: string }[] = [];
    for (const e of entries) {
      const built = buildFittingXml([{ name: e.name, shipTypeId: e.shipTypeId, items: e.items, description: e.description }]);
      if (built.count === 0) {
        add(`skipped “${e.name}” — ${built.skipped.map((x) => x.reason).join('; ') || 'nothing exportable'}`, 'err');
        continue;
      }
      const base = sanitize(`${e.hullName} - ${e.name}`) || `fit ${e.shipTypeId}`;
      let name = `${base}.xml`;
      for (let n = 2; used.has(name); n++) name = `${base} (${n}).xml`;
      used.add(name);
      files.push({ name, content: built.xml });
    }
    if (files.length === 0) { add('Nothing exportable.', 'err'); return; }
    try {
      const r = await write(files);
      if (r === null) { add('pyfa export cancelled — no folder chosen.'); return; }
      add(`pyfa export: ${r.written} unique fit(s) written to ${r.dir} (EVE XML — pyfa's default import type)`, 'ok');
      for (const err of r.errors) add(`  ${err}`, 'err');
      setExported(r.dir);
    } catch (e) {
      add(`pyfa export failed: ${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  }

  async function exportXml() {
    const add = (text: string, kind: LogLine['kind'] = 'info') => setLog((l) => [...l, { text, kind }]);
    const write = window.appInfo?.fittings?.exportXml;
    if (!write) { add('Fitting export needs the desktop app.', 'err'); return; }

    // "missing" means exactly what an ADD push would create, so the file and
    // the API route can never disagree
    const addPlan = buildPlan(chars, library, 'add');
    let files = 0;
    setExported(null);
    // C1, C2 … FIRST in the name: EVE's import dialog truncates the file
    // list, so the character has to be readable in the first few characters
    const indexOf = new Map(addPlan.chars.map((p, i) => [p.characterId, i + 1]));
    add('File key: ' + addPlan.chars.map((p) => `C${indexOf.get(p.characterId)}=${p.characterName}`).join(', '));

    for (const p of addPlan.chars) {
      if (p.blocked) { add(`${p.characterName}: skipped — ${p.blocked}`, 'err'); continue; }
      if (p.creates.length === 0) { add(`${p.characterName}: already has every ticked fit — no file needed.`); continue; }

      const have = chars.find((c) => c.characterId === p.characterId)?.fits.length ?? 0;
      const willEnd = have + p.creates.length;
      // EVE names carry apostrophes and this user's carry ❤ — the filename
      // goes into a path, so keep it plain
      const safeName = p.characterName.replace(/[^A-Za-z0-9 _-]/g, '').trim() || `char ${p.characterId}`;

      const batches: (typeof p.creates)[] = [];
      for (let i = 0; i < p.creates.length; i += FITS_PER_FILE) {
        batches.push(p.creates.slice(i, i + FITS_PER_FILE));
      }
      add(`${p.characterName}: has ${have}, missing ${p.creates.length} → ${batches.length} file(s), would end on ${willEnd}.`);
      if (willEnd > SAFE_FIT_CAP) {
        add(`  ⚠ ${willEnd} is past ${SAFE_FIT_CAP}, the lower of the two caps reported for saved fittings (CCP does not publish it). Import the batches in order and STOP if the client refuses one — that tells us the real ceiling.`, 'err');
      }

      for (let b = 0; b < batches.length; b++) {
        const built = buildFittingXml(batches[b].map((c) => ({
          name: c.name, shipTypeId: c.shipTypeId, items: c.items, description: c.description,
        })));
        if (built.count === 0) {
          add(`  part ${b + 1}: nothing exportable — ${built.skipped.map((x) => x.reason).join('; ')}`, 'err');
          continue;
        }
        const part = batches.length > 1 ? ` p${b + 1}of${batches.length}` : '';
        const file = `C${indexOf.get(p.characterId)} ${safeName}${part}.xml`;
        try {
          // the FIRST write of a run clears our previous exports, so stale
          // parts from an earlier, longer run cannot be imported by mistake
          const full = await write(file, built.xml, files === 0);
          files++;
          setExported(full.replace(/[^\/]+$/, ''));
          add(`  ${built.count} fit(s) → ${file}`, 'ok');
          for (const s2 of built.skipped) add(`    skipped “${s2.name}” — ${s2.reason}`, 'err');
        } catch (e) {
          add(`  part ${b + 1}: could not write — ${e instanceof Error ? e.message : String(e)}`, 'err');
        }
      }
    }

    if (files > 0) {
      add(`Wrote ${files} file(s) into Documents/EVE/fittings.`, 'ok');
      add('In EVE, per character: log that character in → Fitting window → ≡ → Browse/Import fittings → pick THEIR file(s), in part order. Instant, and no API budget.');
      add('Each file holds only what that character lacks, so importing cannot duplicate — but importing the SAME file twice would.');
    }
  }


  /**
   * Validate, back up, then hand the run to the background runner.
   *
   * Everything that must be true BEFORE a single write happens is checked
   * here; the run itself lives in lib/fitPush.ts so it survives leaving
   * this tab. A full sync is hours at EVE's permitted pace — that is a
   * background job, not a screen.
   */
  async function apply() {
    const staged = pending;
    if (!staged) return;
    const approved = staged.plan;
    setPending(null);
    const add = (text: string, kind: LogLine['kind'] = 'info') => setLog((l) => [...l, { text, kind }]);

    // THE SELECTION MAY HAVE CHANGED since this plan was approved. Acting on
    // a stale approval once meant deleting from a character who had been
    // unticked — and who was therefore absent from the backup that
    // authorised it. An approval is an approval OF A ROSTER.
    if (staged.rosterKey !== rosterKeyRef.current) {
      add('STOPPED — the character selection changed after this plan was approved. Nothing was touched. Rescan and approve again.', 'err');
      return;
    }

    const problems: string[] = [];
    const file = await backup(staged.chars, problems);
    if (file === null) {
      add('STOPPED — nothing was changed. The backup could not be written AND verified:', 'err');
      for (const p of problems.slice(0, 8)) add(`  · ${p}`, 'err');
      if (problems.length > 8) add(`  · +${problems.length - 8} more`, 'err');
      return;
    }
    add(`Backup written AND verified: ${file}`, 'ok');
    add('  every character, every fit, every item (incl. cargo) checked against what was just read.', 'ok');

    // THE LOAD-BEARING GUARD: the backup proves it covers the SNAPSHOT. This
    // ties that to what the writes will touch, so a plan can never reach a
    // character the backup does not hold.
    const covered = new Set(staged.chars.map((c) => c.characterId));
    const uncovered = approved.chars.filter((p) => !covered.has(p.characterId));
    if (uncovered.length > 0) {
      add(`STOPPED — nothing was changed. The approved plan covers ${uncovered.map((p) => p.characterName).join(', ')}, who are NOT in the backup.`, 'err');
      return;
    }
    void refreshBackups();

    await startPush(approved, staged.chars);
    // re-read so the table reflects reality; the runner's own record covers
    // anything EVE has not published yet
    await scan(true);
  }


  if (characterIds.length === 0) {
    return (
      <div className="fitlib">
        <div className="fitlib-empty-sel">
          No characters ticked. Use the list on the left to choose which characters this tool may
          read and write — tick a single character to try it out safely.
        </div>
      </div>
    );
  }

  return (
    <div className="fitlib">
        <div className="fitlib-head">
          <div className="fitlib-head-actions">
            <input className="cfg-filter" placeholder="filter fits…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <button className="btn" onClick={() => void scan()} disabled={scanning || applying}>
              {scanning ? 'Scanning…' : '⟳ Rescan'}
            </button>
          </div>
        </div>

        <p className="fitlib-sub">
          Every personal saved fit across your characters, merged where the <b>hull and fitting are identical</b>
          {' '}(names ignored). Clean up the names here, then push the result so every character carries the same list.
        </p>

        <div className="fitlib-scope">
          Acting on <b>{characters.length}</b> of {allCharacters.length} character(s):{' '}
          {characters.map((c) => c.characterName).join(', ')}.
          Everyone else is untouched, and the backup covers exactly these.
        </div>

        <div className="fitlib-rate">
          <b>EVE's published limit for fitting calls:</b> {FITTING_GROUP.maxTokens} tokens per 15 minutes,
          shared by reads, creates and deletes ({Math.floor(FITTING_GROUP.maxTokens / 2)} operations).
          The tool paces itself to stay inside it — about one operation every {Math.round(rate.paceMs / 1000)}s.
          {' '}Budget left now: <b>{Math.max(0, Math.floor(rate.remaining / 2))}</b> operation(s),
          window resets in {humanMs(rate.resetInMs)}.
          {rate.blockedReason && <div className="fitlib-rate-blocked">⏸ {rate.blockedReason}</div>}
        </div>
        {(push.running || push.total > 0) && (
          <div className="fitlib-progress">
            <span>
              {/* the panel is shared by the push and the restore — say which,
                  so someone returning to the tab knows what is running */}
              <b>{push.kind === 'restore' ? 'Restore' : 'Push'}</b>{' '}
              {push.done}/{push.total} operations
              {push.running
                ? <> · about {humanMs(estimateMs(FITTING_GROUP, push.total - push.done))} left{push.current ? ` · ${push.current}` : ''}</>
                : ' · finished'}
            </span>
            <div className="fitlib-progress-bar">
              <div style={{ width: `${push.total > 0 ? (push.done / push.total) * 100 : 0}%` }} />
            </div>
            {push.running
              ? <button className="btn danger" onClick={() => stopPush()}>Stop</button>
              : <button className="btn" onClick={() => clearPushLog()}>Clear</button>}
          </div>
        )}

        <div className="fitlib-cache">
          ⏱ EVE publishes each character's saved-fit list on a <b>5-minute cache</b>. A fit you made in
          game in the last few minutes is <b>not visible to this tool yet</b> — and Rescan cannot
          hurry it, because EVE keeps serving the same answer.
          {freshestIn !== null && (
            <> Newest data refreshes in <b>{freshestIn}s</b>{staleIn !== null && staleIn !== freshestIn ? ` (oldest in ${staleIn}s)` : ''}.</>
          )}
        </div>

        <div className="fitlib-stats">
          <span><b>{readable.length}</b>/{characters.length} characters read</span>
          <span><b>{totalFits}</b> saved fits</span>
          <span><b>{library.length}</b> unique</span>
          <span><b>{library.filter((e) => e.included).length}</b> in the library</span>
          <span><b>{writable.length}</b> can be written to</span>
        </div>

        {chars.filter((c) => c.error).map((c) => (
          <div key={c.characterId} className="fitlib-warn">⚠ {c.characterName}: {c.error}</div>
        ))}
        {scanned && blocked.length > 0 && blocked.every((b) => b.blocked?.includes('write scope')) && (
          <div className="fitlib-warn">
            ⚠ {blocked.length} character(s) cannot be written to until they are logged out and back in — the
            fitting-write permission is only granted at login. They are left completely untouched.
          </div>
        )}

        <div className="fitlib-split">
        <div className="fitlib-table-wrap">
          <table className="fitlib-table">
            <thead>
              <tr>
                <th className="c-inc">
                  <div className="fitlib-allnone">
                    <button title="include every fit shown" onClick={() => setAllShown(true)}>all</button>
                    <button title="exclude every fit shown — they get deleted from every character" onClick={() => setAllShown(false)}>none</button>
                  </div>
                </th>
                <th>Hull</th>
                <th>Name pushed to every character</th>
                <th>Also saved as</th>
                <th className="c-num">On</th>
                <th className="c-cmp"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => {
                const tooLong = e.name.trim().length > ESI_FIT_NAME_MAX;
                return (
                  <tr key={e.key}
                    className={`${e.included ? '' : 'excluded'} ${e.key === selectedKey ? 'sel' : ''} ${e.key === compareKey ? 'cmp' : ''}`}
                    onClick={() => setSelectedKey(e.key)}>
                    <td className="c-inc">
                      <input type="checkbox" checked={e.included} onChange={() => toggleInclude(e)} disabled={applying || pending !== null} />
                    </td>
                    <td className="c-hull">
                      {e.sources.length > 1 && (
                        <span className="fitlib-dup"
                          title={['merged from ' + e.sources.length + ' saved fits:',
                            ...e.sources.map((s2) => `${s2.characterName}: ${s2.name}`)].join('\n')}>
                          ×{e.sources.length}
                        </span>
                      )}
                      {e.hullName}
                      {e.invalidCount > 0 && (
                        <span className="fitlib-invalid" title={`${e.invalidCount} item(s) are in an 'Invalid' slot. EVE discards those when a fit is created, so a character receiving this fit will not get them.`}>
                          ⚠ {e.invalidCount}
                        </span>
                      )}
                    </td>
                    <td>
                      <input className={`fitlib-name ${tooLong ? 'bad' : ''}`} value={e.name}
                        onChange={(ev) => setName(e, ev.target.value)} disabled={applying || pending !== null}
                        maxLength={ESI_FIT_NAME_MAX + 10} />
                      {tooLong && <div className="fitlib-bad">{e.name.trim().length}/{ESI_FIT_NAME_MAX} — EVE will reject this</div>}
                    </td>
                    <td className="c-alts">
                      {e.nameVariants.filter((n) => n !== e.name).map((n) => (
                        <button key={n} className="fitlib-alt" title="use this name" disabled={applying || pending !== null}
                          onClick={() => setName(e, n)}>{n}</button>
                      ))}
                    </td>
                    <td className="c-num" title={e.sources.map((s) => `${s.characterName}: ${s.name}`).join('\n')}>
                      {new Set(e.sources.map((s) => s.characterId)).size}
                    </td>
                    <td className="c-cmp">
                      <button className="fitlib-alt"
                        title={e.key === compareKey ? 'stop comparing against this fit' : 'compare the selected fit against this one'}
                        onClick={(ev) => { ev.stopPropagation(); setCompareKey(e.key === compareKey ? null : e.key); }}>
                        {e.key === compareKey ? 'B ✓' : 'vs'}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr><td colSpan={6} className="fitlib-empty">
                  {scanning ? 'reading fittings…' : filter ? 'nothing matches that filter' : 'no saved fits found'}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        {selected
          ? <FitInspector entry={selected} compare={compared && compared.key !== selected.key ? compared : null}
              onClearCompare={() => setCompareKey(null)} />
          : <div className="insp insp-empty">Click a fit to see its stats, its ammo options, and how it compares.</div>}
        </div>

        {plan.problems.length > 0 && (
          <div className="fitlib-warn">
            {plan.problems.map((p) => <div key={p}>⚠ {p}</div>)}
          </div>
        )}
        {plan.warnings.length > 0 && (
          <div className="fitlib-warn">
            {plan.warnings.map((w) => <div key={w}>⚠ {w}</div>)}
          </div>
        )}

        {plan.totalCreates >= 20 && (
          <div className="fitlib-bulk">
            <b>{plan.totalCreates} creates — about {humanMs(estimateMs(FITTING_GROUP, plan.totalCreates + plan.totalDeletes))} through EVE's API.</b>
            <div>
              The push paces itself inside EVE's published limit and <b>keeps running if you leave this
              tab</b> — start it and come back. Stop and re-run any time; it resumes from wherever it got to.
            </div>
            <details>
              <summary>Export to an EVE fitting file instead (unreliable for bulk — read this)</summary>
              <div className="insp-note">
                EVE's own import dialog can read a file of fits, but in testing it would only accept
                about <b>two fits per import action</b>, hit and miss, and the same happened with a file
                the game client itself had written — so it is not the file, it is the client. For a few
                fits it is instant; for hundreds it is worse than the API. Kept here because it costs
                no API budget at all.
              </div>
              <div className="fitlib-bulk-actions">
                <button className="btn" onClick={() => void exportXml()}>
                  Export fitting files (one per character, only what each is missing)
                </button>
                <button className="btn" onClick={() => void exportPyfa()}
                  title="Every unique fit in the library (duplicates already merged by hull + fitting) as one EVE XML fitting file each, into a folder you choose — the *.xml format pyfa's import dialog preselects. Multi-select them all in one import.">
                  ⬇ Export all to pyfa (XML files, no duplicates)…
                </button>
                {exported && <span className="dim">written into {exported}</span>}
              </div>
            </details>
          </div>
        )}

        <div className="fitlib-mode">
          <label className={mode === 'add' ? 'on' : ''}>
            <input type="radio" checked={mode === 'add'} disabled={applying || pending !== null}
              onChange={() => setMode('add')} />
            <span><b>Add missing fits</b> — ticked fits are created where they're missing. <b>Nothing is ever deleted.</b></span>
          </label>
          <label className={mode === 'mirror' ? 'on danger' : 'danger'}>
            <input type="radio" checked={mode === 'mirror'} disabled={applying || pending !== null}
              onChange={() => setMode('mirror')} />
            <span><b>Mirror</b> — make every character hold EXACTLY the ticked list.
              <b> Every unticked fit is deleted from every character.</b></span>
          </label>
        </div>

        <div className="fitlib-plan">
          <h3>{mode === 'add' ? 'What pushing would do (nothing is deleted)' : 'What pushing would do — MIRROR: unticked fits are DELETED'}</h3>
          <div className="fitlib-plan-rows">
            {plan.chars.map((p) => (
              <div key={p.characterId} className={`fitlib-plan-row ${p.blocked ? 'blocked' : ''}`}>
                <span className="pl-name">{p.characterName}</span>
                {p.blocked
                  ? <span className="pl-blocked">skipped — {p.blocked}</span>
                  : <>
                      <span className="pl-add">+{p.creates.length} create</span>
                      <span className="pl-del">−{p.deletes.length} delete</span>
                      <span className="pl-keep">{p.keeps} unchanged</span>
                      {p.deletes.some((d) => d.reason === 'rename') && (
                        <span className="pl-note" title="EVE has no rename endpoint — a renamed fit must be deleted and recreated">
                          incl. {p.deletes.filter((d) => d.reason === 'rename').length} rename
                        </span>
                      )}
                    </>}
              </div>
            ))}
          </div>
        </div>

        <details className="fitlib-backups">
          <summary>Backups &amp; restore ({backups.length})</summary>
          <div className="insp-note">
            A verified snapshot is written before every push. Restoring recreates any fit in that
            snapshot the character no longer has — it never deletes anything.
            {statsDir && <> Files live in <code>{statsDir}</code>.</>}
          </div>
          {backups.length === 0
            ? <div className="insp-loading">No snapshots yet — one is written the first time you push.</div>
            : backups.map((b) => (
              <div key={b.name} className="fitlib-backup-row">
                <span className="fitlib-backup-name">{b.name}</span>
                <span className="dim">{new Date(b.mtime).toLocaleString()} · {Math.round(b.size / 1024)} KB</span>
                <button className="btn" disabled={checking !== null || restoring !== null || applying || scanning}
                  title="READ-ONLY: compares this snapshot to what is in game right now and reports what is missing. Changes nothing."
                  onClick={() => void checkBackup(b.name)}>
                  {checking === b.name ? 'checking…' : 'Check against game'}
                </button>
                <button className="btn" disabled={checking !== null || restoring !== null || applying || scanning}
                  title="Shows exactly what would be recreated, then asks. A restore only ADDS fits."
                  onClick={() => void previewRestore(b.name)}>
                  {restoring === b.name ? 'restoring…' : 'Restore…'}
                </button>
              </div>
            ))}
        </details>

        {restorePlan && (
          <div className="fitlib-confirm restore">
            <div className="fitlib-confirm-head restore">
              Restore from {restorePlan.fileName} — this only ADDS fits. Nothing is deleted.
            </div>
            <div className="fitlib-plan-rows">
              {restorePlan.plans.map((p) => (
                <div key={p.characterId} className={`fitlib-plan-row ${p.blocked ? 'blocked' : ''}`}>
                  <span className="pl-name">{p.characterName}</span>
                  {p.blocked
                    ? <span className="pl-blocked">skipped — {p.blocked}</span>
                    : <>
                        <span className="pl-add">+{p.creates.length} recreate</span>
                        <span className="pl-keep">{p.keeps} already present</span>
                        {(p.renamed ?? 0) > 0 && (
                          <span className="pl-note" title="Same modules, different name in game — the original name is gone, so restoring puts it back as a second copy. A restore never deletes the renamed one.">
                            incl. {p.renamed} renamed
                          </span>
                        )}
                        {p.creates.length > 0 && (
                          <span className="dim" title={p.creates.map((c) => `${c.hullName} — ${c.name}`).join('\n')}>
                            (hover for the list)
                          </span>
                        )}
                      </>}
                </div>
              ))}
            </div>
            <div className="actions">
              <button className="btn" onClick={() => setRestorePlan(null)}>Cancel</button>
              <button className="btn primary"
                disabled={restorePlan.plans.every((p) => p.blocked || p.creates.length === 0)}
                onClick={() => void runRestore()}>
                Recreate {restorePlan.plans.reduce((n, p) => n + (p.blocked ? 0 : p.creates.length), 0)} fit(s)
              </button>
            </div>
          </div>
        )}

        {(log.length > 0 || push.log.length > 0) && (
          <div className="fitlib-log">
            {log.map((l, i) => <div key={`c${i}`} className={`fl-${l.kind}`}>{l.text}</div>)}
            {push.log.map((l, i) => <div key={`p${i}`} className={`fl-${l.kind}`}>{l.text}</div>)}
          </div>
        )}

        {pending === null ? (
          <div className="actions">
            <button className="btn primary" disabled={!canApply || applying || scanning}
              onClick={() => setPending({ plan, chars, rosterKey })}>
              {applying ? 'Working…'
                : mode === 'add'
                  ? `Add ${plan.totalCreates} missing fit(s) to ${writable.length} character${writable.length === 1 ? '' : 's'}`
                  : `MIRROR ${writable.length} character${writable.length === 1 ? '' : 's'} — deletes ${plan.totalDeletes} fit(s)`}
            </button>
          </div>
        ) : (
          <div className="fitlib-confirm">
            <div className="fitlib-confirm-head">
              {pending.plan.mode === 'add'
                ? 'Adding fits only — nothing will be deleted.'
                : 'MIRROR: this DELETES fits in EVE, and EVE has no undo.'}
            </div>
            <ul>
              <li><b>{pending.plan.totalCreates}</b> fit(s) will be created across {writable.length} character(s)</li>
              {pending.plan.mode === 'add'
                ? <li><b>0</b> fit(s) will be deleted — unticked fits are left exactly as they are</li>
                : <li className="fitlib-confirm-loss"><b>{pending.plan.totalDeletes}</b> fit(s) will be DELETED — every fit not ticked above, on every character</li>}
              <li>Every fitting is backed up first and the backup is VERIFIED field by field (each character, each fit, each item incl. cargo) — if that check fails, nothing is touched</li>
              <li>You can put anything back later from the Backups panel below</li>
              {pending.plan.mode === 'mirror' &&
                <li>Creates run before deletes, per character — if a create fails, that character&apos;s deletes are cancelled</li>}
              {pending.plan.warnings.length > 0 && (
                <li className="fitlib-confirm-loss">
                  <b>{pending.plan.warnings.length} fit(s) carry items EVE cannot place in a slot.</b> EVE discards those when
                  it creates a fit, so those items will be missing wherever the fit is created. They stay in the backup.
                </li>
              )}
            </ul>
            <div className="actions">
              <button className="btn" onClick={() => setPending(null)}>Cancel</button>
              <button className={`btn ${pending.plan.mode === 'mirror' ? 'danger' : 'primary'}`} disabled={applying || scanning || !canApply}
                onClick={() => void apply()}>
                {pending.plan.mode === 'add' ? 'Yes — add the missing fits' : 'Yes — DELETE unticked fits and mirror'}
              </button>
            </div>
          </div>
        )}
    </div>
  );
}
