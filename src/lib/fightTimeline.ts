// THE BATTLE TIMELINE'S NUMBERS (v0.204.2). PURE — the chart draws what this
// returns, and fixtures pin it. Every value is a running sum over the fight's
// killmails up to that moment (battleNarrative's TimelinePoint.cum), so the
// chart can never say more than the killmails do:
//   ships   — hulls lost per side (pods counted apart, shown in the tooltip)
//   isk     — ISK lost per side (zKillboard's value of each killmail)
//   damage  — damage TAKEN by each side's lost ships (the killmail's own figure;
//             damage that killed nothing is on no killmail and is not here)
//   pilots  — distinct pilots of each side SEEN on a killmail so far (someone
//             who never got on one is invisible — a floor, not a fleet count)
import type { TimelinePoint } from './battleNarrative';

export type TimelineMode = 'ships' | 'isk' | 'damage' | 'pilots';
export const TIMELINE_MODES: { key: TimelineMode; label: string; ours: string; theirs: string; note: string }[] = [
  { key: 'ships', label: 'ships lost', ours: 'we lost', theirs: 'they lost', note: 'hulls lost so far, from the killmails; pods are counted apart and shown on hover' },
  { key: 'isk', label: 'ISK lost', ours: 'we lost', theirs: 'they lost', note: "ISK lost so far — zKillboard's value of each killmail, pods included" },
  { key: 'damage', label: 'damage taken', ours: 'we took', theirs: 'they took', note: 'damage taken by the ships that died, as each killmail records it — damage that killed nothing is on no killmail' },
  { key: 'pilots', label: 'pilots seen', ours: 'ours', theirs: 'theirs', note: 'distinct pilots seen on a killmail so far — someone who never got on one is invisible, so this is a floor, not a fleet count' },
];

const pick = (p: TimelinePoint, side: 'ours' | 'theirs', mode: TimelineMode): number =>
  (mode === 'ships' ? p.cum[side].ships : mode === 'isk' ? p.cum[side].isk : mode === 'damage' ? p.cum[side].dmg : p.cum[side].seen);

export interface SeriesPoint { t: number; ours: number; theirs: number }
/** the two running totals at every killmail, led by a zero at the first kill's
 * time so the first step is drawn (pilots mode starts at what the first killmail shows) */
export function timelineSeries(points: readonly TimelinePoint[], mode: TimelineMode): SeriesPoint[] {
  if (points.length === 0) return [];
  const rows = points.map((p) => ({ t: p.t, ours: pick(p, 'ours', mode), theirs: pick(p, 'theirs', mode) }));
  return [{ t: points[0].t, ours: 0, theirs: 0 }, ...rows];
}

/** the top of the y axis: the larger side's final value, never 0 */
export function seriesMax(series: readonly SeriesPoint[]): number {
  let m = 0;
  for (const s of series) m = Math.max(m, s.ours, s.theirs);
  return m > 0 ? m : 1;
}

/** the killmail nearest a moment (the hover target); ties go to the earlier one */
export function nearestIndex(points: readonly { t: number }[], t: number): number {
  let best = -1; let bestD = Infinity;
  points.forEach((p, i) => { const d = Math.abs(p.t - t); if (d < bestD) { best = i; bestD = d; } });
  return best;
}

/** an SVG step path ("hold the value until the next killmail") through x/y pairs */
export function stepPath(xy: readonly [number, number][]): string {
  if (xy.length === 0) return '';
  let d = `M${xy[0][0].toFixed(1)},${xy[0][1].toFixed(1)}`;
  for (let i = 1; i < xy.length; i++) d += ` H${xy[i][0].toFixed(1)} V${xy[i][1].toFixed(1)}`;
  return d;
}

/** the value of a side at a killmail, for the hover card */
export const valueAt = pick;
