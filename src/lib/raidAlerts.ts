// Nearby-raidable-skyhook alerts for the overlay — the PURE shaping, split out
// from overlayFeed (which drags in the whole ESI/clone stack) so it can be
// fixtured on its own.

/** a raidable skyhook near the user's imported map — surfaced on the overlay so
 * he can fly over, read the surplus bar (calibration) or just take the raid */
export interface RaidAlert {
  planetId: number;
  systemName: string;
  jumps: number;
  /** which mapped system the jump count is measured from */
  viaName: string | null;
  planetType: string | null; // 'Lava' | 'Ice'
  state: 'open' | 'soon';
  minsLeft: number;          // open: until it closes; soon: until it opens
  lastRaidDays: number | null; // days since the app last SAW it raided (a hint)
}

/**
 * PURE: shape the raidable feed into overlay alerts — keep only skyhooks within
 * `radius` jumps of the map (and, with openOnly, only windows open RIGHT NOW),
 * mark open vs soon, attach the via-system, planet type + last-raid age, and
 * sort (currently-open first, then nearest). Side-effect-free.
 */
export function buildRaidAlerts(
  feed: { planetId: number; systemId: number; startMs: number; endMs: number }[],
  reach: Map<number, { jumps: number; viaId?: number }>,
  radius: number,
  now: number,
  get: {
    systemName: (systemId: number) => string;
    planetType: (planetId: number) => string | null;
    lastRaidMs: (planetId: number) => number;
  },
  openOnly = false,
): RaidAlert[] {
  return feed
    .filter((s) => {
      const r = reach.get(s.systemId);
      if (r === undefined || r.jumps > radius) return false;
      return !openOnly || (now >= s.startMs && now < s.endMs);
    })
    .map((s) => {
      const open = now >= s.startMs && now < s.endMs;
      const lastRaid = get.lastRaidMs(s.planetId);
      const r = reach.get(s.systemId)!;
      return {
        planetId: s.planetId,
        systemName: get.systemName(s.systemId),
        jumps: r.jumps,
        viaName: r.viaId !== undefined ? get.systemName(r.viaId) : null,
        planetType: get.planetType(s.planetId),
        state: (open ? 'open' : 'soon') as 'open' | 'soon',
        minsLeft: Math.round(((open ? s.endMs : s.startMs) - now) / 60_000),
        lastRaidDays: lastRaid > 0 ? (now - lastRaid) / 86_400_000 : null,
      };
    })
    .sort((a, b) => (a.state === b.state ? a.jumps - b.jumps : a.state === 'open' ? -1 : 1));
}
