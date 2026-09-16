// OVERLAY ALERT MUTES (v0.202.1) — dismiss and snooze for the notice-type
// boxes (⛏ mining, 🪐 planets, 🎯 raids).
//
// The overlay is click-through, so the buttons live in the settings
// window (Alt+] opens it on the Alerts page). That window has its own
// store copy, so the mutes are NOT store state: they live under their own
// localStorage key, written by the settings window and read FRESH by the
// main window's overlay feed on every push — the same cross-window rule the
// alert toggles follow. The feed also writes a snapshot of what it is
// showing under ALERTS_SNAPSHOT_KEY, which is what the Alerts page lists.
//
// A mute is keyed by the alert's identity: a mining alert by character,
// kind and the moment it was raised, so "dismiss" hides THIS occurrence
// and a fresh one shows again; a planet by character, planet and
// severity; a raid by skyhook and open/soon state. `until` is an epoch
// ms; 0 means "until it goes away on its own" (pruned after a day).
//
// Pure functions — the fixture suite runs this exact code.

export const MUTES_KEY = 'etc-overlay-mutes-v1';
export const ALERTS_SNAPSHOT_KEY = 'etc-overlay-alerts-v1';

export interface MuteEntry { until: number; at: number }
export interface MuteStore {
  v: 1;
  /** everything on every notice box is snoozed until this (0 = not) */
  all: number;
  items: Record<string, MuteEntry>;
}

export const DISMISS_TTL_MS = 24 * 3600_000;

export const emptyMutes = (): MuteStore => ({ v: 1, all: 0, items: {} });

/** parse the persisted store, tolerating garbage */
export function parseMutes(raw: string | null | undefined): MuteStore {
  if (!raw) return emptyMutes();
  try {
    const j = JSON.parse(raw) as Partial<MuteStore> | null;
    if (!j || typeof j !== 'object') return emptyMutes();
    const items: Record<string, MuteEntry> = {};
    for (const [k, v] of Object.entries(j.items ?? {})) {
      const e = v as Partial<MuteEntry> | null;
      if (e && typeof e.until === 'number' && typeof e.at === 'number') items[k] = { until: e.until, at: e.at };
    }
    return { v: 1, all: typeof j.all === 'number' ? j.all : 0, items };
  } catch {
    return emptyMutes();
  }
}

export const miningKey = (a: { charId: number; kind: string; since: number }): string => `mining:${a.charId}:${a.kind}:${a.since}`;
export const piKey = (a: { charName: string; planetName: string; sev: number }): string => `pi:${a.charName}:${a.planetName}:${a.sev}`;
export const raidKey = (r: { planetId: number; state: string }): string => `raid:${r.planetId}:${r.state}`;

/** is this alert hidden right now? */
export function isMuted(m: MuteStore, key: string, now: number): boolean {
  if (m.all > now) return true;
  const e = m.items[key];
  if (!e) return false;
  return e.until === 0 || e.until > now;
}

/** why it is hidden, for the settings page ('' = shown) */
export function muteReason(m: MuteStore, key: string, now: number): '' | 'all' | 'dismissed' | 'snoozed' {
  if (m.all > now) return 'all';
  const e = m.items[key];
  if (!e) return '';
  if (e.until === 0) return 'dismissed';
  return e.until > now ? 'snoozed' : '';
}

/** hide one alert: untilMs = 0 dismisses it until it goes away on its own */
export function mute(m: MuteStore, key: string, untilMs: number, now: number): MuteStore {
  return { ...m, items: { ...m.items, [key]: { until: untilMs, at: now } } };
}
export function unmute(m: MuteStore, key: string): MuteStore {
  const items = { ...m.items };
  delete items[key];
  return { ...m, items };
}
export function muteAll(m: MuteStore, untilMs: number): MuteStore {
  return { ...m, all: untilMs };
}
export function clearMutes(): MuteStore {
  return emptyMutes();
}

/** drop what no longer hides anything: expired snoozes, day-old dismissals */
export function pruneMutes(m: MuteStore, now: number): MuteStore {
  const items: Record<string, MuteEntry> = {};
  for (const [k, e] of Object.entries(m.items)) {
    if (e.until === 0 ? now - e.at < DISMISS_TTL_MS : e.until > now) items[k] = e;
  }
  return { v: 1, all: m.all > now ? m.all : 0, items };
}

/** what the feed last pushed, for the Alerts page */
export interface AlertsSnapshot {
  at: number;
  mining: { charId: number; charName: string; kind: 'stopped' | 'reduced'; since: number }[];
  pi: { charName: string; planetName: string; text: string; sev: number }[];
  raids: { planetId: number; systemName: string; state: 'open' | 'soon'; minsLeft: number; jumps: number }[];
}
export function parseSnapshot(raw: string | null | undefined): AlertsSnapshot | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Partial<AlertsSnapshot> | null;
    if (!j || typeof j !== 'object' || typeof j.at !== 'number') return null;
    return { at: j.at, mining: Array.isArray(j.mining) ? j.mining : [], pi: Array.isArray(j.pi) ? j.pi : [], raids: Array.isArray(j.raids) ? j.raids : [] };
  } catch {
    return null;
  }
}
