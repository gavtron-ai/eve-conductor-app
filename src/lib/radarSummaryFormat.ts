// THE RADAR SUMMARY ON DISK — the renderer's codec (v0.229.0, audit B2). The twin of
// electron/radarSummary.cjs, which carries the reasoning and does the one-time migration in the
// main process; tests/radarsummary.test.cjs proves the two agree byte for byte. One file per
// region, radar-summary-<regionId>.json:
//   {"v":2,"r":<regionId>,"entries":[[t, s, [[dayNum, rp, fi, fk, co, bp], …], hfa[24], hra[24]], …]}
// dayNum = UTC days since 1970-01-01; fk and hfa whole ISK; bp two decimals.
import type { SummaryEntry } from './radar';

export const regionFile = (r: number): string => `radar-summary-${r}.json`;
/** the pre-0.229 single blob, read only when a region file is missing and the main process could not split it */
export const LEGACY_FILE = 'radar-summary.json';

const DAY = 86_400_000;
export const dayNum = (d: string): number => Math.round(Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / DAY);
export const dayStr = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);
const r2 = (x: number): number => Math.round(x * 100) / 100;

type Row = [number, number, [number, number, number, number, number, number][], number[], number[]];

/** one region's entries → the file text */
export function encodeRegion(regionId: number, entries: Iterable<SummaryEntry>): string {
  const rows: Row[] = [];
  for (const e of entries) {
    if (e.r !== regionId) continue;
    rows.push([
      e.t, e.s,
      e.days.map((d) => [dayNum(d.d), d.rp, d.fi, Math.round(d.fk), d.co, r2(d.bp)]),
      e.hfa.map(Math.round),
      e.hra.map(Math.round),
    ]);
  }
  return JSON.stringify({ v: 2, r: regionId, entries: rows });
}

/** the file text → entries in the shape every reader uses; throws on anything else */
export function decodeRegion(text: string): SummaryEntry[] {
  const doc = JSON.parse(text) as { v?: number; r?: number; entries?: Row[] } | null;
  if (!doc || doc.v !== 2 || typeof doc.r !== 'number' || !Array.isArray(doc.entries)) throw new Error('not a v2 region summary');
  const r = doc.r;
  return doc.entries.map(([t, s, days, hfa, hra]) => ({
    r, t, s: s as 0 | 1,
    days: days.map(([dn, rp, fi, fk, co, bp]) => ({ d: dayStr(dn), rp, fi, fk, co, bp })),
    hfa, hra,
  }));
}
