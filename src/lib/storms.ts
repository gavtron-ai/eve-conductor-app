// METALIMINAL STORMS — the one system effect CCP never put in ESI.
//
// GROUND TRUTH: there is NO storm endpoint (the community asked; CCP never
// shipped one). The only tracker is PLAYER-REPORTED: EvE-Scout Rescue's
// Storm Track page (Signal Cartel), a plain server-rendered HTML table.
// That page has no CORS header, so the fetch happens in the MAIN process
// (storms.cjs) and the renderer parses the HTML here, where the parsing is
// pure and fixture-testable.
//
// HONESTY: every mark this module produces is provenance-stamped — reported
// BY a named scout AT a time, hours-in-system as the tracker counts them —
// and the UI must say so. Storms move one jump every 24–48 h, so an old
// report may have drifted; that caveat ships with the data, never silently.
//
// GEOMETRY (EVE University, verified 2026-08-19): the STRONG effect covers
// the storm's central system and everything exactly ONE jump away; the WEAK
// effect covers systems two and three jumps out.

export type StormType = 'Electric' | 'Exotic' | 'Gamma' | 'Plasma';

export interface StormReport {
  /** system name exactly as the tracker prints it */
  system: string;
  region: string;
  /** the tracker's storm instance label, e.g. "Exotic A" */
  name: string;
  type: StormType;
  /** ms epoch of the report ("Aug-18@18:03" EVE/UTC, year inferred) */
  reportedMs: number | null;
  /** the tracker's own hours-in-system counter */
  hoursInSystem: number | null;
  reportedBy: string;
}

/** one system's exposure to one storm */
export interface StormMark {
  type: StormType;
  /** storm instance label from the tracker ("Exotic A") */
  name: string;
  /** jumps from the reported centre: 0–1 = strong, 2–3 = weak */
  ring: number;
  centerName: string;
  reportedMs: number | null;
  hoursInSystem: number | null;
  reportedBy: string;
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

/** "Aug-18@18:03" (EVE time = UTC, no year printed) → ms epoch.
 * Year inference: assume the current year; a result more than 48 h in the
 * future can only be LAST year's date (Dec report read in Jan). */
export function parseStormDate(s: string, nowMs: number): number | null {
  const m = /^([A-Z][a-z]{2})-(\d{1,2})@(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const mon = MONTHS[m[1]];
  if (mon === undefined) return null;
  const year = new Date(nowMs).getUTCFullYear();
  const t = Date.UTC(year, mon, Number(m[2]), Number(m[3]), Number(m[4]));
  return t > nowMs + 48 * 3_600_000 ? Date.UTC(year - 1, mon, Number(m[2]), Number(m[3]), Number(m[4])) : t;
}

/** PURE: the Storm Track page HTML → reports. Tolerates whitespace and
 * ignores rows that do not look like storm rows (page chrome, headers).
 * Keeps only the NEWEST row per storm instance name — the tracker sometimes
 * carries an older sighting of the same storm. */
export function parseStormTrack(html: string, nowMs: number): StormReport[] {
  const out = new Map<string, StormReport>();
  const rowRe = /<tr>([\s\S]*?)<\/tr>/g;
  for (let rm = rowRe.exec(html); rm; rm = rowRe.exec(html)) {
    const cells = [...rm[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) =>
      c[1].replace(/<[^>]*>/g, '').trim(),
    );
    if (cells.length < 7) continue;
    const type = cells[3] as StormType;
    if (type !== 'Electric' && type !== 'Exotic' && type !== 'Gamma' && type !== 'Plasma') continue;
    const report: StormReport = {
      region: cells[0],
      system: cells[1],
      name: cells[2],
      type,
      reportedMs: parseStormDate(cells[4], nowMs),
      hoursInSystem: /^\d+$/.test(cells[5]) ? Number(cells[5]) : null,
      reportedBy: cells[6],
    };
    const prev = out.get(report.name);
    if (!prev || (report.reportedMs ?? 0) > (prev.reportedMs ?? 0)) out.set(report.name, report);
  }
  return [...out.values()];
}

/**
 * PURE: reports → per-system exposure. `resolve` turns a tracker system
 * name into an id (bundled map); `within` is the stargate BFS
 * (mapdata.systemsWithin) injected so fixtures can use a toy graph.
 * A report whose system name does not resolve contributes nothing — it is
 * still counted in the caller's "N storms tracked" so the miss is visible.
 */
export function stormExposure(
  reports: StormReport[],
  resolve: (name: string) => number | undefined,
  within: (centerId: number, maxJumps: number) => Map<number, number>,
): Map<number, StormMark[]> {
  const out = new Map<number, StormMark[]>();
  for (const r of reports) {
    const centerId = resolve(r.system);
    if (centerId === undefined) continue;
    for (const [sysId, jumps] of within(centerId, 3)) {
      const mark: StormMark = {
        type: r.type, name: r.name, ring: jumps, centerName: r.system,
        reportedMs: r.reportedMs, hoursInSystem: r.hoursInSystem, reportedBy: r.reportedBy,
      };
      const list = out.get(sysId) ?? out.set(sysId, []).get(sysId)!;
      list.push(mark);
    }
  }
  // strongest first per system, so the chip shows the effect that matters
  for (const list of out.values()) list.sort((a, b) => a.ring - b.ring);
  return out;
}

/** the documented effect sheets (EVE University, verified 2026-08-19).
 * strong = centre + 1 jump · weak = 2–3 jumps out. */
export const STORM_EFFECTS: Record<StormType, {
  icon: string;
  /** the single fact a raider cares about most, shown on the chip tooltip */
  headline: string;
  strong: string[];
  weak: string[];
}> = {
  Electric: {
    icon: '⚡',
    headline: 'CLOAKING DISABLED — even in the weak (2–3 jump) ring',
    strong: [
      'CLOAKING DISABLED',
      'EM resists −25%',
      'Capacitor recharge time −25% (faster cap)',
      'Scan probe strength +50%',
      'Hacking virus coherence +25',
      'Extra relic sites spawn',
    ],
    weak: [
      'CLOAKING DISABLED (weak ring too)',
      'EM resists −10%',
      'Capacitor recharge time −10%',
      'Scan probe strength +20%',
      'Hacking virus coherence +10',
    ],
  },
  Exotic: {
    icon: '🌀',
    headline: 'Warp speed +100% strong / +40% weak · kinetic resists down',
    strong: [
      'Kinetic resists −25%',
      'Warp speed +100%',
      'Local shield/armor repairer cycle time −25% (faster reps)',
      'Mining laser cycle time −25%',
      'Scan resolution +25%',
      'Extra ore anomalies spawn',
    ],
    weak: [
      'Kinetic resists −10%',
      'Warp speed +40%',
      'Local shield/armor repairer cycle time −10%',
      'Mining laser cycle time −10%',
      'Scan resolution +10%',
    ],
  },
  Gamma: {
    icon: '☢',
    headline: 'Remote reps −90% strong / −50% weak — logi is crippled',
    strong: [
      'Remote shield/armor reps −90%',
      'Explosive resists −25%',
      'Shield HP +25%',
      'Capacitor capacity +25%',
      'Signature radius −25%',
      'Extra rogue drone sites spawn',
    ],
    weak: [
      'Remote shield/armor reps −50%',
      'Explosive resists −10%',
      'Shield HP +10%',
      'Capacitor capacity +10%',
      'Signature radius −10%',
    ],
  },
  Plasma: {
    icon: '🔥',
    headline: 'Weapon damage +50% strong / +20% weak · thermal resists down',
    strong: [
      'Weapon damage +50%',
      'Thermal resists −25%',
      'Armor HP +25%',
      'Turret & drone tracking −50%',
      'Missile/fighter explosion radius +50%',
      'Extra Triglavian sites spawn',
    ],
    weak: [
      'Weapon damage +20%',
      'Thermal resists −10%',
      'Armor HP +10%',
      'Turret & drone tracking −20%',
      'Missile/fighter explosion radius +20%',
    ],
  },
};

export const STORM_TRACK_URL = 'https://evescoutrescue.com/home/stormtrack.php';

export interface StormFeed {
  reports: StormReport[];
  fetchedMs: number;
}

/** Storm Track is a small community-run page and storms move once a DAY —
 * hammering it on the module's 5-minute refresh would be rude and useless.
 * A good result is held for 30 min; failures retry on the next refresh. */
const STORM_CACHE_MS = 30 * 60_000;
let cached: StormFeed | null = null;

/** fetch + parse the tracker. Electron: via the main process (the page has
 * no CORS header). Plain browser (dev rig): tried directly and allowed to
 * fail — the UI then says the tracker is unreachable rather than guessing. */
export async function fetchStorms(): Promise<StormFeed | null> {
  if (cached && Date.now() - cached.fetchedMs < STORM_CACHE_MS) return cached;
  try {
    const bridge = window.appInfo?.storms;
    const html = bridge
      ? await bridge.page()
      : await (await fetch(STORM_TRACK_URL, { signal: AbortSignal.timeout(15_000) })).text();
    if (!html) return cached;
    cached = { reports: parseStormTrack(html, Date.now()), fetchedMs: Date.now() };
    return cached;
  } catch {
    return cached;
  }
}
