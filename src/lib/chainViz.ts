// CHAIN DASHBOARD MATH (v0.200.4) — pure layout and aggregation for the
// graphical view of the chain summary: the chain drawn by distance, ISK on
// field per hop, and signature freshness. Nothing here draws; the
// component turns these numbers into SVG. Fixtures pin every function.
import type { SigGroup } from './chain';
import WH_EFFECT_MODS from '../data/whEffectMods.json';

export const GROUP_COLOR: Record<SigGroup, string> = {
  Combat: '#ff5b5b', Ore: '#8dc169', Gas: '#7fc8ff', Relic: '#e0a13a', Data: '#c77dff', Wormhole: '#9aa0aa', Other: '#9aa0aa',
};
export const GROUP_ORDER: SigGroup[] = ['Combat', 'Ore', 'Gas', 'Relic', 'Data'];

/** class colour (v0.200.9, Gavin's scheme): C1–C3 blue, light to bright;
 * C4 yellowish orange; C5–C6 red; high-sec green; low-sec traffic-sign
 * yellow; null-sec purple-maroon; unknown grey */
export const CLASS_COLOR: Record<string, string> = {
  C1: '#a8d8ff', C2: '#5eb3ff', C3: '#1e8cff',
  C4: '#f5a623',
  C5: '#ff3b3b', C6: '#ff3b3b',
  HS: '#3ddc84', LS: '#ffbf1f', NS: '#a8309a',
  /** small-ship shattered (v0.201.7) */
  C13: '#b7a6e8',
};
export const CLASS_ORDER = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'HS', 'LS', 'NS'];
export function classColor(cls: string): string {
  return CLASS_COLOR[cls] ?? '#9aa0aa';
}

export interface VizRow { system: string; cls: string; group: SigGroup; hops: number | null; isk: number | null; ageH: number | null }

export interface HopBar { hop: number; total: number; count: number; byGroup: Partial<Record<SigGroup, number>> }

/** ISK on field per hop, 0..maxHop, every hop present even when empty;
 * rows with no distance are left out (the caller reports them) */
export function iskByHop(rows: readonly VizRow[]): HopBar[] {
  const withHops = rows.filter((r) => r.hops !== null);
  const maxHop = withHops.reduce((m, r) => Math.max(m, r.hops!), -1);
  const bars: HopBar[] = [];
  for (let h = 0; h <= maxHop; h++) {
    const bar: HopBar = { hop: h, total: 0, count: 0, byGroup: {} };
    for (const r of withHops) {
      if (r.hops !== h) continue;
      bar.count++;
      if (r.isk !== null) { bar.total += r.isk; bar.byGroup[r.group] = (bar.byGroup[r.group] ?? 0) + r.isk; }
    }
    bars.push(bar);
  }
  return bars;
}

export interface AgeBucket { label: string; maxH: number | null; count: number; isk: number }

/** how fresh the list is: signature counts by age band; unknown ages last */
export function ageBuckets(rows: readonly VizRow[]): AgeBucket[] {
  const bands: AgeBucket[] = [
    { label: '< 1 h', maxH: 1, count: 0, isk: 0 }, { label: '1–3 h', maxH: 3, count: 0, isk: 0 }, { label: '3–6 h', maxH: 6, count: 0, isk: 0 },
    { label: '6–12 h', maxH: 12, count: 0, isk: 0 }, { label: '12–24 h', maxH: 24, count: 0, isk: 0 }, { label: '> 24 h', maxH: Infinity, count: 0, isk: 0 },
    { label: 'no age', maxH: null, count: 0, isk: 0 },
  ];
  for (const r of rows) {
    const b = r.ageH === null ? bands[6] : bands.find((x) => x.maxH !== null && r.ageH! < x.maxH)!;
    b.count++; b.isk += r.isk ?? 0;
  }
  return bands;
}

/** the six wormhole effects, as shown on cards */
export const EFFECTS = ['Black Hole', 'Cataclysmic Variable', 'Magnetar', 'Pulsar', 'Red Giant', 'Wolf-Rayet'] as const;
export type WhEffect = typeof EFFECTS[number];
/** any spelling the map or CCP's data uses → the card label, or '' */
export function normEffect(raw: unknown): WhEffect | '' {
  const n = String(raw ?? '');
  if (!n) return '';
  if (/black\s*hole/i.test(n)) return 'Black Hole';
  if (/cataclysmic/i.test(n)) return 'Cataclysmic Variable';
  if (/magnetar/i.test(n)) return 'Magnetar';
  if (/pulsar/i.test(n)) return 'Pulsar';
  if (/red\s*giant/i.test(n)) return 'Red Giant';
  if (/wolf/i.test(n)) return 'Wolf-Rayet';
  return '';
}
/** short form for a strip: "Cataclysmic Variable" → "Cataclysmic" */
export function effectShort(e: string): string {
  return e === 'Cataclysmic Variable' ? 'Cataclysmic' : e;
}
/** the card's small box: the abbreviations pilots use */
export function effectAbbrev(e: string): string {
  switch (normEffect(e)) {
    case 'Wolf-Rayet': return 'WR';
    case 'Pulsar': return 'PULS';
    case 'Magnetar': return 'MAG';
    case 'Black Hole': return 'BH';
    case 'Red Giant': return 'RG';
    case 'Cataclysmic Variable': return 'CATA';
    default: return '';
  }
}
/** effect colours exactly as the corp's map draws its little effect
 * squares — its own palette object, read from the map page's script
 * chunk 2026-09-15 ({ magnetar, redGiant, pulsar, wolfRayet,
 * cataclysmic, blackHole }); the four that were drawn that day matched
 * the measured badges to the digit. A live reading's palette still
 * overrides these, so a future recolour of the map follows */
export const EFFECT_COLOR: Record<WhEffect, string> = {
  'Magnetar': '#e06fdf', 'Red Giant': '#d9534f', 'Pulsar': '#428bca', 'Wolf-Rayet': '#e28a0d', 'Cataclysmic Variable': '#ffffbb', 'Black Hole': '#000000',
};
export type EffectPalette = Partial<Record<WhEffect, string>>;
export const effectColor = (e: string, palette?: EffectPalette | null): string => {
  const k = normEffect(e) as WhEffect;
  return (palette && palette[k]) || EFFECT_COLOR[k] || '#e0a13a';
};
/** true for colours too dark to carry text on a dark card (black squares) */
export function isDarkColor(css: string): boolean {
  const m = /^#([0-9a-f]{6})$/i.exec(css.trim()) ? [
    parseInt(css.slice(1, 3), 16), parseInt(css.slice(3, 5), 16), parseInt(css.slice(5, 7), 16),
  ] : (/^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(css) ?? []).slice(1, 4).map(Number);
  if (m.length !== 3 || m.some((x) => !Number.isFinite(x))) return false;
  return m[0] * 0.299 + m[1] * 0.587 + m[2] * 0.114 < 70;
}
/**
 * The map's own palette from the extractor's probe of its effect badges
 * ({ magnetar: { bg: 'rgb(224, 111, 223)' }, … }) — only entries with a
 * real, non-transparent background.
 */
export function paletteFromProbe(styles: unknown): EffectPalette {
  const out: EffectPalette = {};
  if (!styles || typeof styles !== 'object') return out;
  for (const [k, v] of Object.entries(styles as Record<string, { bg?: string }>)) {
    const e = normEffect(k) as WhEffect;
    const bg = v && typeof v.bg === 'string' ? v.bg.trim() : '';
    if (!e || !bg || /transparent|rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)/i.test(bg)) continue;
    out[e] = bg;
  }
  return out;
}

export interface EffectMod { label: string; value: string }
/** the modifiers an effect applies in a class, as the game's effect
 * beacon carries them (CCP's static data export, built by
 * scripts/sde-wh-effects.cjs); [] when the effect or class is unknown */
export function effectMods(effect: string, cls: string): EffectMod[] {
  const e = normEffect(effect);
  if (!e) return [];
  const byCls = (WH_EFFECT_MODS as Record<string, Record<string, EffectMod[]>>)[e];
  return byCls?.[cls] ?? [];
}
/** one line per modifier, for a title/tooltip */
export const effectModsText = (effect: string, cls: string): string =>
  effectMods(effect, cls).map((m) => `${m.label} ${m.value}`).join('\n');

/**
 * The shortest route between two systems over the chain's links (BFS,
 * undirected): [from, …, to], [from] when they are the same, null when
 * either is unknown or they are not connected.
 */
export function routeBetween(from: string, to: string, edges: readonly [string, string][]): string[] | null {
  if (!from || !to) return null;
  if (from === to) return [from];
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b); adj.get(b)!.add(a);
  }
  if (!adj.has(from) || !adj.has(to)) return null;
  const prev = new Map<string, string | null>([[from, null]]);
  const q = [from];
  while (q.length) {
    const cur = q.shift()!;
    if (cur === to) break;
    for (const n of adj.get(cur) ?? []) if (!prev.has(n)) { prev.set(n, cur); q.push(n); }
  }
  if (!prev.has(to)) return null;
  const path: string[] = [];
  for (let s: string | null = to; s !== null; s = prev.get(s) ?? null) path.unshift(s);
  return path;
}

export interface VizNode {
  system: string; cls: string;
  /** the map's per-system tag, shown after the class ("C2A") */
  tag: string;
  /** the wormhole effect, '' when none or unknown */
  effect: string;
  /** a shattered system (no moons; the map's dotted circle) — v0.201.7 */
  shattered: boolean;
  hop: number; isk: number; count: number; unvalued: number;
  x: number; y: number; isOrigin: boolean;
}
export interface VizEdge { a: string; b: string }
export interface ChainLayout {
  nodes: VizNode[]; edges: VizEdge[]; width: number; height: number; maxHop: number; colW: number; rowH: number;
  /** systems drawn on the map with NO drawn link back to the origin —
   * shown in a last, detached column (hop −1) so it is clear why they
   * carry no distance (v0.201.8) */
  unlinked: string[];
}

/**
 * The chain by distance: one column per hop, the origin alone at the left.
 * Within a column, systems sit under their parent (the neighbour one hop
 * closer, alphabetically first when several) so links cross as little as
 * a simple rule allows; ties by name. Only systems with a distance appear.
 */
export function layoutChain(
  systems: readonly { system: string; cls: string; tag?: string; effect?: string; shattered?: boolean }[], edges: readonly [string, string][],
  hops: Map<string, number>, rows: readonly VizRow[], opts: { colW?: number; rowH?: number } = {},
): ChainLayout {
  const colW = opts.colW ?? 224, rowH = opts.rowH ?? 78;
  const clsOf = new Map(systems.map((s) => [s.system, s.cls]));
  const tagOf = new Map(systems.map((s) => [s.system, s.tag ?? '']));
  const effectOf = new Map(systems.map((s) => [s.system, s.effect ?? '']));
  const shatteredOf = new Map(systems.map((s) => [s.system, !!s.shattered]));
  for (const r of rows) if (!clsOf.has(r.system) || (!clsOf.get(r.system) && r.cls)) clsOf.set(r.system, r.cls);
  const names = new Set<string>([...hops.keys()]);
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (!names.has(a) || !names.has(b)) continue;
    if (!adj.has(a)) adj.set(a, new Set()); if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b); adj.get(b)!.add(a);
  }
  const parentOf = (s: string): string | null => {
    const h = hops.get(s)!;
    const ps = [...(adj.get(s) ?? [])].filter((n) => hops.get(n) === h - 1).sort();
    return ps[0] ?? null;
  };
  const maxHop = [...hops.values()].reduce((m, h) => Math.max(m, h), 0);
  const cols: string[][] = Array.from({ length: maxHop + 1 }, () => []);
  for (const s of names) cols[hops.get(s)!].push(s);
  const yOf = new Map<string, number>();
  const nodes: VizNode[] = [];
  for (let h = 0; h <= maxHop; h++) {
    const ordered = cols[h].sort((a, b) => {
      const pa = parentOf(a), pb = parentOf(b);
      const ya = pa ? yOf.get(pa) ?? 0 : 0, yb = pb ? yOf.get(pb) ?? 0 : 0;
      return ya - yb || (pa ?? '').localeCompare(pb ?? '') || a.localeCompare(b);
    });
    ordered.forEach((s, i) => {
      const y = i * rowH + rowH / 2;
      yOf.set(s, y);
      const mine = rows.filter((r) => r.system === s);
      nodes.push({
        system: s, cls: clsOf.get(s) ?? '', tag: tagOf.get(s) ?? '', effect: effectOf.get(s) ?? '', shattered: shatteredOf.get(s) ?? false, hop: h,
        isk: mine.reduce((t, r) => t + (r.isk ?? 0), 0), count: mine.length, unvalued: mine.filter((r) => r.isk === null).length,
        x: h * colW + colW / 2, y, isOrigin: h === 0,
      });
    });
  }
  // the detached column: drawn on the map, no link back to the origin
  const unlinked = systems.map((s) => s.system).filter((s) => !hops.has(s)).sort((a, b) => a.localeCompare(b));
  unlinked.forEach((s, i) => {
    const mine = rows.filter((r) => r.system === s);
    nodes.push({
      system: s, cls: clsOf.get(s) ?? '', tag: tagOf.get(s) ?? '', effect: effectOf.get(s) ?? '', shattered: shatteredOf.get(s) ?? false, hop: -1,
      isk: mine.reduce((t, r) => t + (r.isk ?? 0), 0), count: mine.length, unvalued: mine.filter((r) => r.isk === null).length,
      x: (maxHop + 1) * colW + colW / 2, y: i * rowH + rowH / 2, isOrigin: false,
    });
  });
  const seen = new Set<string>();
  const vizEdges: VizEdge[] = [];
  const placed = new Set([...names, ...unlinked]);
  for (const [a, b] of edges) {
    if (!placed.has(a) || !placed.has(b) || a === b) continue;
    const key = a < b ? `${a}|${b}` : `${b}|${a}`;
    if (seen.has(key)) continue;
    seen.add(key);
    vizEdges.push({ a, b });
  }
  const tallest = Math.max(cols.reduce((m, c) => Math.max(m, c.length), 1), unlinked.length);
  return { nodes, edges: vizEdges, width: (maxHop + 1 + (unlinked.length ? 1 : 0)) * colW, height: tallest * rowH, maxHop, colW, rowH, unlinked };
}
