// THE CHAIN, AT A GLANCE (v0.207.0; widened in v0.209.0) — what the Home dashlets show of the
// corp map. PURE. Built from the same parser (chainReading) and the same `summarize` as the Σ
// Summary with NO filter on, so "ISK on field" here is the tab's total by construction. A digest
// is small and plain (no Maps / Sets), so the last one is kept on disk and a cold start shows it
// with its age instead of an empty box.
import { chainBranches, hopsFrom, rockFamiliesIn, summarize, type ChainRow, type PriceOf, type SigGroup, type ValueTables } from './chain';
import type { ParsedReading } from './chainReading';

export const DIGEST_GROUPS: SigGroup[] = ['Combat', 'Ore', 'Gas', 'Relic', 'Data'];
export const DIGEST_TOP = 8;
export const DIGEST_WHERE = 8;
export const KSPACE_CLASSES = ['HS', 'LS', 'NS'];
export const AGE_BANDS: { label: string; maxH: number }[] = [{ label: '< 3 h', maxH: 3 }, { label: '3–12 h', maxH: 12 }, { label: '12–24 h', maxH: 24 }, { label: '> 24 h', maxH: Infinity }];

export interface DigestSite { system: string; cls: string; tag: string; group: SigGroup; name: string; isk: number | null; hops: number | null }
export interface DigestRock { family: string; sites: number; units: number; isk: number; where: DigestSite[] }
export interface DigestWay { first: string; cls: string; tag: string; systems: number; sites: number; isk: number; byGroup: Partial<Record<SigGroup, number>> }
export interface DigestHop { hops: number | null; sites: number; isk: number }
export interface DigestExit { system: string; cls: string; hops: number | null }
export interface DigestEffect { system: string; cls: string; tag: string; effect: string; hops: number | null }
export interface ChainDigest {
  v: 2;
  /** when the map was read (ms) */
  at: number;
  origin: string;
  /** the origin is on the reading and links were readable — distances mean something */
  originOk: boolean;
  source: string;
  systems: number;
  sites: number;
  unvalued: number;
  totalIsk: number;
  byGroup: Partial<Record<SigGroup, { count: number; isk: number; unvalued: number }>>;
  top: DigestSite[];
  rocks: DigestRock[];
  /** one entry per gas the chain's gas sites carry, each site valued ON THAT GAS ALONE */
  gases: DigestRock[];
  ways: DigestWay[];
  /** ISK and sites at each distance from the origin, nearest first; unlinked (null) last */
  byHop: DigestHop[];
  /** per activity: the nearest sites, richest first among equals */
  nearest: Partial<Record<SigGroup, DigestSite[]>>;
  /** the known-space systems on the map — the ways out to empire / null */
  exits: DigestExit[];
  effects: DigestEffect[];
  /** signatures by how long ago the map last saw them (wormholes included — they go stale too) */
  ages: { label: string; count: number }[];
  noAge: number;
  /** signatures nobody has scanned down yet (no name), wormholes left out */
  unscanned: number;
  /** systems per class, in ladder order */
  classes: { cls: string; systems: number }[];
}

const nearestThenRichest = (a: DigestSite, b: DigestSite) => ((a.hops ?? 1e9) - (b.hops ?? 1e9)) || ((b.isk ?? -1) - (a.isk ?? -1)) || a.system.localeCompare(b.system);
const CLASS_LADDER = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'HS', 'LS', 'NS'];
export const gasShort = (gas: string): string => gas.replace(/^Fullerite-/, '');

export function digestChain(parsed: ParsedReading, origin: string, at: number, priceOf: PriceOf, tables: ValueTables): ChainDigest {
  const originOk = !!origin && parsed.edges.length > 0 && parsed.systems.has(origin);
  const hops = originOk ? hopsFrom(origin, parsed.edges) : null;
  const none = { maxHops: null, classes: new Set<string>(), groups: new Set<SigGroup>(), maxAgeH: null };
  const all = summarize(parsed.sigs, hops, none, priceOf, tables);
  const site = (r: ChainRow): DigestSite => ({ system: r.system, cls: r.cls || parsed.clsOf.get(r.system) || '', tag: parsed.tagOf.get(r.system) ?? '', group: r.group, name: r.name, isk: r.value.isk, hops: r.hops });
  const byGroup: ChainDigest['byGroup'] = {};
  for (const g of DIGEST_GROUPS) byGroup[g] = { ...all.byGroup[g] };
  const rows = all.rows.filter((r) => DIGEST_GROUPS.includes(r.group));

  // a rock's sites are valued ON THAT ROCK ALONE — the tab's own rock filter, one family at a time
  const rocks: DigestRock[] = rockFamiliesIn(parsed.sigs, tables).map((f) => {
    const s = summarize(parsed.sigs, hops, { ...none, rocks: new Set([f.family]) }, priceOf, tables);
    return { family: f.family, sites: f.sites, units: f.units, isk: s.totalIsk, where: s.rows.map(site).sort(nearestThenRichest).slice(0, DIGEST_WHERE) };
  });

  // gas, cloud by cloud: a site's clouds from the same tables the valuation reads
  const gasAcc = new Map<string, DigestRock>();
  for (const r of rows) {
    if (r.group !== 'Gas' || !r.name) continue;
    for (const c of tables.gas[r.name] ?? tables.kgas?.[r.name] ?? []) {
      const key = gasShort(c.gas);
      let g = gasAcc.get(key);
      if (!g) { g = { family: key, sites: 0, units: 0, isk: 0, where: [] }; gasAcc.set(key, g); }
      const p = priceOf(c.gas);
      const isk = p === null ? null : p * c.units;
      g.sites++; g.units += c.units; g.isk += isk ?? 0;
      g.where.push({ ...site(r), isk });
    }
  }
  const gases = [...gasAcc.values()].sort((a, b) => a.family.localeCompare(b.family, undefined, { numeric: true }))
    .map((g) => ({ ...g, where: g.where.sort(nearestThenRichest).slice(0, DIGEST_WHERE) }));

  const ways: DigestWay[] = [];
  if (originOk) {
    const b = chainBranches(origin, parsed.edges);
    for (const br of b.branches) {
      const mine = rows.filter((r) => b.via.get(r.system)?.has(br.first));
      const per: DigestWay['byGroup'] = {};
      for (const r of mine) if (r.value.isk) per[r.group] = (per[r.group] ?? 0) + r.value.isk;
      ways.push({ first: br.first, cls: parsed.clsOf.get(br.first) ?? '', tag: parsed.tagOf.get(br.first) ?? '', systems: br.systems.length, sites: mine.length, isk: mine.reduce((t, r) => t + (r.value.isk ?? 0), 0), byGroup: per });
    }
  }

  const hopAcc = new Map<number | null, DigestHop>();
  for (const r of rows) {
    let h = hopAcc.get(r.hops);
    if (!h) { h = { hops: r.hops, sites: 0, isk: 0 }; hopAcc.set(r.hops, h); }
    h.sites++; h.isk += r.value.isk ?? 0;
  }
  const byHop = [...hopAcc.values()].sort((a, b) => (a.hops ?? 1e9) - (b.hops ?? 1e9));

  const nearest: ChainDigest['nearest'] = {};
  for (const g of DIGEST_GROUPS) nearest[g] = rows.filter((r) => r.group === g).map(site).sort(nearestThenRichest).slice(0, DIGEST_WHERE);

  const hopOf = (s: string) => (hops ? hops.get(s) ?? null : null);
  const byDistance = <T extends { system: string; hops: number | null }>(a: T, b: T) => ((a.hops ?? 1e9) - (b.hops ?? 1e9)) || a.system.localeCompare(b.system);
  const exits: DigestExit[] = [...parsed.systems].filter((s) => KSPACE_CLASSES.includes(parsed.clsOf.get(s) ?? ''))
    .map((s) => ({ system: s, cls: parsed.clsOf.get(s)!, hops: hopOf(s) })).sort(byDistance);
  const effects: DigestEffect[] = [...parsed.effectOf.entries()]
    .map(([s, effect]) => ({ system: s, cls: parsed.clsOf.get(s) ?? '', tag: parsed.tagOf.get(s) ?? '', effect, hops: hopOf(s) })).sort(byDistance);

  const ages = AGE_BANDS.map((b) => ({ label: b.label, count: 0 }));
  let noAge = 0;
  for (const s of parsed.sigs) {
    if (s.ageH === null) { noAge++; continue; }
    ages[AGE_BANDS.findIndex((b) => s.ageH! < b.maxH)].count++;
  }
  const clsCount = new Map<string, number>();
  for (const s of parsed.systems) { const c = parsed.clsOf.get(s) ?? ''; if (c) clsCount.set(c, (clsCount.get(c) ?? 0) + 1); }

  return {
    v: 2, at, origin, originOk, source: parsed.source, systems: parsed.systems.size,
    sites: rows.length, unvalued: DIGEST_GROUPS.reduce((t, g) => t + all.byGroup[g].unvalued, 0), totalIsk: all.totalIsk, byGroup,
    top: rows.filter((r) => (r.value.isk ?? 0) > 0).sort((a, b) => (b.value.isk ?? 0) - (a.value.isk ?? 0)).slice(0, DIGEST_TOP).map(site),
    rocks, gases, ways, byHop, nearest, exits, effects, ages, noAge,
    unscanned: parsed.sigs.filter((s) => s.group !== 'Wormhole' && !s.name).length,
    classes: CLASS_LADDER.filter((c) => clsCount.has(c)).map((c) => ({ cls: c, systems: clsCount.get(c)! })),
  };
}

/** what comes back from disk — a digest of another shape is no digest */
export function sanitizeDigest(raw: unknown): ChainDigest | null {
  const d = raw as Partial<ChainDigest> | null;
  if (!d || d.v !== 2 || typeof d.at !== 'number' || !Array.isArray(d.top) || !Array.isArray(d.rocks) || !Array.isArray(d.gases) || !Array.isArray(d.ways) || !Array.isArray(d.byHop) || typeof d.totalIsk !== 'number') return null;
  return d as ChainDigest;
}

/** ISK and sites within `maxHops` jumps of the origin (the origin's own system is 0 jumps) */
export function withinHops(d: Pick<ChainDigest, 'byHop'>, maxHops: number): { isk: number; sites: number } {
  return d.byHop.filter((h) => h.hops !== null && h.hops <= maxHops).reduce((t, h) => ({ isk: t.isk + h.isk, sites: t.sites + h.sites }), { isk: 0, sites: 0 });
}

/** the chip the map shows for a system: class + the map's letter ("C4B"), else what there is */
export const wayChip = (w: Pick<DigestWay, 'cls' | 'tag'>): string => (w.cls ? `${w.cls}${/^[A-Za-z0-9]$/.test(w.tag) ? w.tag : ''}` : '');
