// Full local-data backup & transfer. One JSON file carries everything the app
// saves locally, so upgrading or moving machines never loses history.
//
// Two deliberate rules ("smart, not blind"):
// - TOKENS ARE NEVER EXPORTED. EVE rotates refresh tokens; a copied token used
//   from a second machine revokes the whole session (the v14.2 401 disaster,
//   RULES #17). The backup carries the team's structure (ids, names,
//   nicknames, roles) and each machine logs in fresh — same rule as the
//   multi-machine sync plan.
// - IMPORT MERGES DATA, ONLY SETTINGS ARE REPLACED. Ledger transactions/fees/
//   order events and trend events are unioned by their natural keys, so
//   importing an old backup onto a machine with newer data cannot delete
//   anything. Preferences (settings, hubs, alerts, watchlist, ignore lists)
//   are taken from the backup wholesale — that's what "restore" should mean.
//
// Rebuildable caches (price history day-cache, freshness timers, watcher
// snapshots) are deliberately NOT exported — they regenerate from ESI and
// would bloat the file for zero preserved value.
import { useAuth, type CharAccount } from './auth';

const FORMAT = 'eve-trade-conductor-backup';
const APP_STORE_KEY = 'eve-trade-conductor';
const AUTH_KEY = 'eve-trade-conductor-auth';
const LEDGER_KEY = 'etc-ledger-v1';
const STRUCT_KEY = 'etc-structure-names-v1';
const DEV_EVENTS_KEY = 'etc-trends-events-v1';

interface StatsFile {
  name: string;
  content: string;
}

export interface BackupPayload {
  format: typeof FORMAT;
  version: 1;
  exportedAt: number;
  /** app-store persist JSON (settings/hubs/alerts/lists) — restored wholesale */
  appStore: string | null;
  /** auth persist JSON with all tokens stripped — team structure only */
  auth: string | null;
  /** forever-ledger JSON — merged by ids on import */
  ledger: string | null;
  /** resolved player-structure names (small, saves re-resolving) */
  structureNames: string | null;
  /** trend-event NDJSON files — merged line-exact on import */
  statsFiles: StatsFile[];
  /** radar files (summary/coverage/monthly rollups) — imported ONLY onto a
   * machine with no radar history for that file: radar data is per-machine
   * observation, and merging two machines' counts would double-count. A
   * fresh PC gets seeded; an active machine keeps its own. */
  auxFiles?: StatsFile[];
}

function stripTokens(authJson: string): string {
  const parsed = JSON.parse(authJson) as { state?: { characters?: CharAccount[] } };
  for (const c of parsed.state?.characters ?? []) {
    c.accessToken = null;
    c.refreshToken = null;
    c.expiresAt = 0;
  }
  return JSON.stringify(parsed);
}

export async function buildBackup(): Promise<BackupPayload> {
  const bridge = window.appInfo?.stats;
  let statsFiles: StatsFile[] = [];
  let auxFiles: StatsFile[] = [];
  if (bridge) {
    statsFiles = await bridge.files();
    auxFiles = (await bridge.auxFiles?.()) ?? [];
  } else {
    const dev = localStorage.getItem(DEV_EVENTS_KEY);
    if (dev) {
      const lines = (JSON.parse(dev) as unknown[]).map((e) => JSON.stringify(e)).join('\n');
      statsFiles = [{ name: 'trend-events-dev-export.ndjson', content: lines + '\n' }];
    }
  }
  const authRaw = localStorage.getItem(AUTH_KEY);
  return {
    format: FORMAT,
    version: 1,
    exportedAt: Date.now(),
    appStore: localStorage.getItem(APP_STORE_KEY),
    auth: authRaw ? stripTokens(authRaw) : null,
    ledger: localStorage.getItem(LEDGER_KEY),
    structureNames: localStorage.getItem(STRUCT_KEY),
    statsFiles,
    auxFiles,
  };
}

/** export to a file; returns where it went (or null if the user cancelled) */
export async function exportBackup(): Promise<string | null> {
  const payload = JSON.stringify(await buildBackup());
  const name = `eve-conductor-backup-${new Date().toISOString().slice(0, 10)}.json`;
  const bridge = window.appInfo?.backup;
  if (bridge) return bridge.save(name, payload);
  // browser dev: plain download
  const url = URL.createObjectURL(new Blob([payload], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  return name;
}

// ---- import (merge) ----

function mergeLedger(currentRaw: string | null, importedRaw: string): string {
  interface L {
    tx: { id: number }[];
    fees: { id: number }[];
    orderEvents: { orderId: number; issued: number }[];
    lastSync: number | null;
  }
  const empty: L = { tx: [], fees: [], orderEvents: [], lastSync: null };
  const cur = currentRaw ? ({ ...empty, ...JSON.parse(currentRaw) } as L) : empty;
  const imp = { ...empty, ...JSON.parse(importedRaw) } as L;
  const byId = <T extends { id: number }>(a: T[], b: T[]) => {
    const seen = new Set(a.map((x) => x.id));
    return [...a, ...b.filter((x) => !seen.has(x.id))];
  };
  const oeKey = (e: { orderId: number; issued: number }) => `${e.orderId}:${e.issued}`;
  const oeSeen = new Set(cur.orderEvents.map(oeKey));
  // CHRONOLOGICAL ORDER IS LOAD-BEARING, and load() does not restore it.
  // computeStats walks ledger.tx in array order building FIFO lots, and
  // attributeBrokerFees advances a single forward cursor through orderEvents
  // assuming both arrays are sorted. Appending the imported rows AFTER the
  // local ones (which is what a plain concat does) puts older transactions
  // last, so a sell can consume lots that were bought later — silently
  // changing the cost basis and the realized profit of an imported history.
  const byDate = <T extends { date?: number; id: number }>(xs: T[]) =>
    [...xs].sort((a, b) => (a.date ?? 0) - (b.date ?? 0) || a.id - b.id);
  return JSON.stringify({
    tx: byDate(byId(cur.tx, imp.tx)),
    fees: byDate(byId(cur.fees, imp.fees)),
    orderEvents: [...cur.orderEvents, ...imp.orderEvents.filter((e) => !oeSeen.has(oeKey(e)))]
      .sort((a, b) => a.issued - b.issued),
    lastSync: Math.max(cur.lastSync ?? 0, imp.lastSync ?? 0) || null,
  });
}

function mergeAuth(importedRaw: string): { added: number; updated: number } {
  const imp = JSON.parse(importedRaw) as {
    state?: { clientId?: string; characters?: CharAccount[]; activeId?: number | null };
  };
  const impChars = imp.state?.characters ?? [];
  const s = useAuth.getState();
  let added = 0;
  let updated = 0;
  const characters = [...s.characters];
  for (const ic of impChars) {
    const i = characters.findIndex((c) => c.characterId === ic.characterId);
    if (i >= 0) {
      // keep THIS machine's tokens; take the backup's labels AND DUTIES.
      // tradeRole/homeHubId were silently dropped for any character that
      // already existed locally — and those two drive the hauler-hangar
      // exclusion, per-hub fee math and net-worth scoping, so losing them
      // quietly changes money numbers rather than obviously breaking.
      characters[i] = {
        ...characters[i],
        nickname: ic.nickname ?? characters[i].nickname,
        role: ic.role || characters[i].role,
        tradeRole: ic.tradeRole ?? characters[i].tradeRole,
        homeHubId: ic.homeHubId ?? characters[i].homeHubId,
      };
      updated += 1;
    } else {
      characters.push({ ...ic, accessToken: null, refreshToken: null, expiresAt: 0 });
      added += 1;
    }
  }
  useAuth.setState({
    characters,
    clientId: s.clientId || imp.state?.clientId || '',
    activeId: s.activeId ?? imp.state?.activeId ?? characters[0]?.characterId ?? null,
  });
  return { added, updated };
}

async function mergeStatsFiles(files: StatsFile[]): Promise<number> {
  if (files.length === 0) return 0;
  const bridge = window.appInfo?.stats;
  if (bridge) return bridge.import(files);
  // browser dev: union into the localStorage event list by exact line identity
  const cur = JSON.parse(localStorage.getItem(DEV_EVENTS_KEY) ?? '[]') as unknown[];
  const seen = new Set(cur.map((e) => JSON.stringify(e)));
  let addedLines = 0;
  for (const f of files) {
    for (const line of f.content.split('\n')) {
      if (!line.trim() || seen.has(line)) continue;
      try {
        cur.push(JSON.parse(line));
        seen.add(line);
        addedLines += 1;
      } catch {
        // skip corrupt lines
      }
    }
  }
  localStorage.setItem(DEV_EVENTS_KEY, JSON.stringify(cur));
  return addedLines;
}

/**
 * Apply a backup file's contents. Returns a human summary. The caller should
 * reload the app afterwards so every store rehydrates from the merged state.
 */
export async function importBackupText(text: string): Promise<string> {
  let p: BackupPayload;
  try {
    p = JSON.parse(text) as BackupPayload;
  } catch {
    throw new Error('Not a valid backup file (unreadable JSON).');
  }
  if (p.format !== FORMAT) throw new Error('Not an EVE Conductor backup file.');

  // VALIDATE AND PRE-MERGE EVERY BLOB BEFORE THE FIRST WRITE — a damaged
  // blob must fail with NOTHING applied. (The old order committed appStore
  // first; a later parse failure left a half-imported machine that either
  // reverted silently on the next settings change or applied the "failed"
  // import on the next launch.)
  let mergedLedger: string | null = null;
  let mergedStructs: string | null = null;
  try {
    if (p.appStore) JSON.parse(p.appStore);
    if (p.auth) JSON.parse(p.auth);
    if (p.ledger) mergedLedger = mergeLedger(localStorage.getItem(LEDGER_KEY), p.ledger);
    if (p.structureNames) {
      const cur = JSON.parse(localStorage.getItem(STRUCT_KEY) ?? '{}') as Record<string, unknown>;
      mergedStructs = JSON.stringify({ ...(JSON.parse(p.structureNames) as Record<string, unknown>), ...cur });
    }
  } catch {
    throw new Error('Backup file is damaged (a data blob inside it failed to parse) — nothing was imported.');
  }

  // ---- all localStorage writes together (synchronous, no awaits between) ----
  const parts: string[] = [];
  if (p.appStore) {
    localStorage.setItem(APP_STORE_KEY, p.appStore);
    parts.push('settings restored');
  }
  if (mergedLedger) {
    localStorage.setItem(LEDGER_KEY, mergedLedger);
    parts.push('ledger merged');
  }
  if (mergedStructs) localStorage.setItem(STRUCT_KEY, mergedStructs);
  if (p.auth) {
    const a = mergeAuth(p.auth);
    parts.push(`team: ${a.added} added, ${a.updated} updated (log in each character on this machine)`);
  }
  // stats files are disk IO — a failure here must not abort the restore
  // that already happened above; report it instead
  try {
    const lines = await mergeStatsFiles(p.statsFiles ?? []);
    parts.push(`${lines} trend events merged`);
  } catch {
    parts.push('⚠ trend-event files could not be written (disk/permissions) — settings/ledger/team WERE applied; re-import to retry the trend merge');
  }
  // radar files: seed a FRESH machine only — never overwrite local radar
  // history (per-machine observation; merging counts would double-count)
  const bridge = window.appInfo?.stats;
  if (bridge && (p.auxFiles?.length ?? 0) > 0) {
    let seeded = 0;
    let kept = 0;
    for (const f of p.auxFiles!) {
      try {
        if ((await bridge.auxRead(f.name)) === null) {
          await bridge.auxWrite(f.name, f.content);
          seeded += 1;
        } else {
          kept += 1;
        }
      } catch {
        // bad name / IO issue — skip the file, never fail the whole import
      }
    }
    parts.push(
      seeded > 0
        ? `radar data: ${seeded} file(s) seeded${kept > 0 ? `, ${kept} kept local` : ''}`
        : 'radar data: local history kept',
    );
  }
  return `Imported backup from ${new Date(p.exportedAt).toLocaleString()}: ${parts.join(' · ')}.`;
}
