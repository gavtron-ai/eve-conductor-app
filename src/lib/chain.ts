// CHAIN SUMMARY (v0.200) — "what is out there to do in chain": the corp map's
// signature list turned into ISK-on-field per activity, with every site's
// distance in wormhole hops from HOME or from ME.
//
// Pure. The Aperture module reads the map (apertureExtract.ts runs inside
// the map page); this file parses what came back, walks the chain graph,
// values each site and applies the filters. Fixtures pin every function.
//
// HONEST BASIS of every ISK figure: sleeper combat sites are the site's
// blue-loot total (fixed NPC buy prices; EVE University per-site pages,
// read 2026-09-14); gas and ore sites are the site's published cloud/rock
// contents × live Jita sell prices. None of it can see whether a site has
// already been run — every figure is "if untouched", and the window says so.
// Relic, data and k-space combat sites carry no estimate (count only).

/** the corp's home label on the map — the chain summary's origin out of the
 * box (v0.201.11). The main process holds the same value in
 * electron/appConfig.cjs; the config fixture asserts the two agree. */
export const DEFAULT_CHAIN_HOME = 'Florida';

export type SigGroup = 'Combat' | 'Ore' | 'Gas' | 'Relic' | 'Data' | 'Wormhole' | 'Other';

export interface ChainSig {
  sig: string;
  group: SigGroup;
  /** the system as the map names it — a J-code, a k-space name, or the
   * corp's custom label for a system */
  system: string;
  /** C1…C6, HS, LS, NS, or '' when the map showed none */
  cls: string;
  name: string;
  /** hours since the map last saw it, null when unknown */
  ageH: number | null;
}

/** "C4C" → C4 (the trailing letter is the map's per-class label); "0.0" →
 * NS; "L" → LS; "H" → HS; anything else → '' */
export function parseClassToken(tok: string): string {
  const m = /^(C[1-6])[A-Z]?$/.exec(tok);
  if (m) return m[1];
  if (tok === '0.0' || /^NS$/i.test(tok)) return 'NS';
  if (tok === 'L' || /^LS$/i.test(tok)) return 'LS';
  if (tok === 'H' || /^HS$/i.test(tok)) return 'HS';
  if (/^(C13|SH|Shattered)$/i.test(tok)) return 'C13';
  if (tok === 'P' || /^Thera$/i.test(tok)) return 'P';
  return '';
}

/** "J102409 C4C" → { system: 'J102409', cls: 'C4' }; "Hole Tanked C4F" →
 * { system: 'Hole Tanked', cls: 'C4' }; "Chardalane L" → LS; a cell with no
 * class token keeps the whole text as the name */
export function parseSystemCell(cell: string): { system: string; cls: string } {
  const toks = cell.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (toks.length === 0) return { system: '', cls: '' };
  // the map's per-system tag (a single capital letter, or a glyph such as
  // 🐊) may follow the class chip as its own element: "J102409 C4 C"
  if (toks.length >= 3 && /^(?:[A-Z]|[^\p{L}\p{N}]+)$/u.test(toks[toks.length - 1]) && parseClassToken(toks[toks.length - 2])) toks.pop();
  const last = toks[toks.length - 1];
  const cls = parseClassToken(last);
  if (cls && toks.length > 1) return { system: toks.slice(0, -1).join(' '), cls };
  // glued forms — the chip rendered with no whitespace before it
  // ("J102409C4C", "Hole TankedC4F", "MJI3-80.0", "ChardalaneL"): the name
  // must end in a digit or a lowercase letter so a capital-letter name
  // ("MJI3-8") is never split; nullsec is always "0.0", never a bare letter
  const glued = /^(.+?)\s*(C[1-6]|0\.0)([A-Z])?$/.exec(toks.join(' ')) ?? /^(.+[^A-Z\s])\s*(H|L)([A-Z])?$/.exec(toks.join(' '));
  if (glued && glued[1].trim()) { const c = parseClassToken(glued[2]); if (c) return { system: glued[1].trim(), cls: c }; }
  return { system: toks.join(' '), cls: '' };
}

/** "7h ago" → 7; "23m ago" → 0.38; "2d ago" → 48; "—" → null */
export function parseAge(text: string): number | null {
  const m = /(\d+(?:\.\d+)?)\s*([mhd])\b/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  const u = m[2].toLowerCase();
  return u === 'm' ? n / 60 : u === 'h' ? n : n * 24;
}

const GROUPS: Record<string, SigGroup> = {
  combat: 'Combat', ore: 'Ore', gas: 'Gas', relic: 'Relic', data: 'Data', wormhole: 'Wormhole',
};

/**
 * The map's "Signature Search" table as innerText: one row per line, cells
 * tab-separated (SIG · GROUP · SYSTEM · NAME · AGE). Header rows, blank
 * rows and anything without a sig id are skipped. Tolerates a stray icon
 * cell before the sig id and extra trailing cells.
 */
export function parseSigSearch(text: string): ChainSig[] {
  const out: ChainSig[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const cells = raw.split('\t').map((c) => c.trim());
    // sig ids are three alphanumerics + three digits ("AC6-000") — a letters-
    // only pattern silently dropped every id with a digit in it (fixture A1)
    const si = cells.findIndex((c) => /^[A-Z0-9]{3}-\d{3}$/.test(c));
    if (si < 0 || cells.length < si + 4) continue;
    const [sig, groupRaw, systemCell, nameRaw, ...rest] = cells.slice(si);
    // the group cell may carry an icon or a tooltip word — find the group
    // word inside it rather than demanding an exact match
    const gm = /\b(combat|ore|gas|relic|data|wormhole)\b/i.exec(groupRaw);
    const group = gm ? GROUPS[gm[1].toLowerCase()] : 'Other';
    const { system, cls } = parseSystemCell(systemCell);
    const name = nameRaw === '—' || nameRaw === '-' ? '' : nameRaw;
    const ageCell = rest.find((c) => /ago|^—$/.test(c)) ?? '';
    out.push({ sig, group, system, cls, name, ageH: parseAge(ageCell) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// THE CHAIN GRAPH — nodes are the map's system labels, edges are wormholes.
// ---------------------------------------------------------------------------

export interface ChainNode { id: string; label: string; system: string; cls: string }
export interface ChainGraph { nodes: ChainNode[]; edges: [string, string][] }

/** the system name inside a node's text ("C4 A J145848 C3 C4" → J145848;
 * "C2 Homebase 🏠 C3 H" → Homebase). `known` are the names the signature
 * table uses — the longest known name found in the text wins; else the
 * first J-code; else the text after the class badge and label letter */
/** the map's leading badges — a signature count ("42"), an age ("4h"), a
 * pilot count — before the class token: "4h 5 C6 A J100501 C4" */
const LEADING_BADGES = /^(?:\d+[a-z]?\s+)+/i;

export function systemOfNodeText(text: string, known: readonly string[]): { system: string; cls: string } {
  // the real map prefixes badges ("42 C2 🐊 Homebase C3 H" read 2026-09-14;
  // "4h 5 C6 A J100501 C4" read 2026-09-15) — drop them before the class
  const t = text.replace(/\s+/g, ' ').trim().replace(LEADING_BADGES, '');
  const clsTok = /^(C[1-6]|0\.0|H|L|HS|LS|NS|P|C13)\b/.exec(t);
  const cls = clsTok ? parseClassToken(clsTok[1]) : '';
  const hit = [...known].filter((k) => k.length > 1).sort((a, b) => b.length - a.length)
    .find((k) => new RegExp(`(^|\\s)${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(t));
  if (hit) return { system: hit, cls };
  const j = /\bJ\d{6}\b/.exec(t);
  if (j) return { system: j[0], cls };
  // strip the class badge and the map's optional one-letter label, cut at
  // the first static/class token, drop glyphs (🏠, 🔒) — "C2 Homebase 🏠 C3 H"
  // → "Homebase" even when no signature row names the system (rig, v0.200)
  const rest = t
    .replace(/^(C[1-6]|0\.0|H|L|HS|LS|NS|P|C13)\s+(?:[A-Z]\s+)?/, '')
    .split(/\s+(?:C[1-6]|H|L|0\.0|HS|LS|NS)\b/)[0]
    .replace(/[^\p{L}\p{N}\s'-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return { system: rest, cls };
}

/** the map's per-system tag from a node's text — the token right after the
 * class badge when it is a single capital letter or a glyph ("4 C3 C
 * J142951 H" → C; "42 C2 🐊 Homebase C3 H" → 🐊; "3 H Zaveral Aridia" → '') */
export function tagOfNodeText(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim().replace(LEADING_BADGES, '');
  const m = /^(?:C[1-6]|0\.0|H|L|HS|LS|NS|P|C13)\s+(\S{1,2})(?:\s|$)/u.exec(t);
  if (!m) return '';
  const tok = m[1];
  if (/^[A-Z]$/.test(tok)) return tok;
  if (!/[\p{L}\p{N}]/u.test(tok)) return tok;
  return '';
}

/** edge ids in the map's graph carry both node ids ("a-b", "e-a-b",
 * "rf__edge-a-b"…); resolve each to a pair of node labels */
export function edgesFromIds(nodeIds: readonly string[], edgeIds: readonly string[]): [string, string][] {
  const ids = [...nodeIds].sort((a, b) => b.length - a.length);
  const out: [string, string][] = [];
  for (const raw of edgeIds) {
    const id = raw.replace(/^rf__edge-/, '').replace(/^(reactflow__edge-|e-|edge-)/, '');
    let found: [string, string] | null = null;
    for (const a of ids) {
      const i = id.indexOf(a);
      if (i < 0) continue;
      for (const b of ids) {
        if (b === a) continue;
        const j = id.indexOf(b, i + a.length);
        if (j < 0) continue;
        found = [a, b];
        break;
      }
      if (found) break;
    }
    if (found) out.push(found);
  }
  return out;
}

export interface DomNode { id: string; x: number; y: number; w: number; h: number }
export interface DomEdge { id: string; label: string; src: string; tgt: string; d: string }

/** distance from a point to a rectangle (0 inside) */
function rectDist(px: number, py: number, n: DomNode): number {
  const dx = px < n.x ? n.x - px : px > n.x + n.w ? px - (n.x + n.w) : 0;
  const dy = py < n.y ? n.y - py : py > n.y + n.h ? py - (n.y + n.h) : 0;
  return Math.hypot(dx, dy);
}

/** first and last coordinate pair of an SVG path's d attribute */
export function pathEnds(d: string): { a: [number, number]; b: [number, number] } | null {
  const nums = (d.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/gi) ?? []).map(Number);
  if (nums.length < 4) return null;
  return { a: [nums[0], nums[1]], b: [nums[nums.length - 2], nums[nums.length - 1]] };
}

/**
 * Edges as pairs of node ids, from what React Flow puts in the DOM
 * (verified against the library source 2026-09-14): data-source/target
 * when the map sets them, else the wrapper's aria-label "Edge from A to
 * B", else geometry — the path's endpoints against the nodes' boxes
 * (translate(x,y) + size), nearest box within `tol` px. Edge ids alone
 * carry nothing on the real map (bare numbers), which is why v0.200.0
 * showed no distances.
 */
export function resolveEdges(nodes: readonly DomNode[], edges: readonly DomEdge[], tol = 40): { pairs: [string, string][]; how: { attr: number; label: number; geom: number; none: number } } {
  const ids = new Set(nodes.map((n) => n.id));
  const how = { attr: 0, label: 0, geom: 0, none: 0 };
  const pairs: [string, string][] = [];
  for (const e of edges) {
    if (e.src && e.tgt && ids.has(e.src) && ids.has(e.tgt)) { pairs.push([e.src, e.tgt]); how.attr++; continue; }
    const m = /edge from (.+?) to (.+)$/i.exec(e.label || '');
    if (m && ids.has(m[1].trim()) && ids.has(m[2].trim())) { pairs.push([m[1].trim(), m[2].trim()]); how.label++; continue; }
    const ends = pathEnds(e.d || '');
    if (ends && nodes.length > 0) {
      const nearest = (p: [number, number]) => nodes.reduce((best, n) => { const d = rectDist(p[0], p[1], n); return d < best.d ? { n, d } : best; }, { n: nodes[0], d: Infinity });
      const a = nearest(ends.a), b = nearest(ends.b);
      if (a.d <= tol && b.d <= tol && a.n.id !== b.n.id) { pairs.push([a.n.id, b.n.id]); how.geom++; continue; }
    }
    how.none++;
  }
  return { pairs, how };
}

/** breadth-first hops from `origin` over undirected wormhole edges; a
 * system not reached is absent (the caller shows "not connected") */
export function hopsFrom(origin: string, edges: readonly [string, string][]): Map<string, number> {
  const adj = new Map<string, Set<string>>();
  const add = (a: string, b: string) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a)!.add(b); };
  for (const [a, b] of edges) { add(a, b); add(b, a); }
  const hops = new Map<string, number>([[origin, 0]]);
  const q = [origin];
  while (q.length > 0) {
    const cur = q.shift()!;
    const d = hops.get(cur)!;
    for (const n of adj.get(cur) ?? []) if (!hops.has(n)) { hops.set(n, d + 1); q.push(n); }
  }
  return hops;
}

// ---------------------------------------------------------------------------
// VALUATION TABLES
// ---------------------------------------------------------------------------

/** sleeper combat sites: blue-loot totals per EVE University site pages */
export const COMBAT_BLUE_LOOT: Record<string, { cls: number; isk: number }> = {
  'Perimeter Ambush Point': { cls: 1, isk: 8_600_000 },
  'Perimeter Camp': { cls: 1, isk: 9_600_000 },
  'Phase Catalyst Node': { cls: 1, isk: 7_400_000 },
  'The Line': { cls: 1, isk: 10_400_000 },
  'Perimeter Checkpoint': { cls: 2, isk: 12_900_000 },
  'Perimeter Hangar': { cls: 2, isk: 15_600_000 },
  'The Ruins of Enclave Cohort 27': { cls: 2, isk: 15_600_000 },
  'Sleeper Data Sanctuary': { cls: 2, isk: 11_600_000 },
  'Fortification Frontier Stronghold': { cls: 3, isk: 41_100_000 },
  'Outpost Frontier Stronghold': { cls: 3, isk: 45_100_000 },
  'Solar Cell': { cls: 3, isk: 43_000_000 },
  'The Oruze Construct': { cls: 3, isk: 41_600_000 },
  'Frontier Barracks': { cls: 4, isk: 86_700_000 },
  'Frontier Command Post': { cls: 4, isk: 92_300_000 },
  'Integrated Terminus': { cls: 4, isk: 55_300_000 },
  'Sleeper Information Sanctum': { cls: 4, isk: 81_800_000 },
  'Core Garrison': { cls: 5, isk: 253_000_000 },
  'Core Stronghold': { cls: 5, isk: 234_900_000 },
  'Oruze Osobnyk': { cls: 5, isk: 164_700_000 },
  'Quarantine Area': { cls: 5, isk: 146_900_000 },
  'Core Citadel': { cls: 6, isk: 610_100_000 },
  'Core Bastion': { cls: 6, isk: 455_600_000 },
  'Strange Energy Readings': { cls: 6, isk: 293_000_000 },
  'The Mirror': { cls: 6, isk: 363_000_000 },
};

/** Sleeper relic ("Forgotten …") and data ("Unsecured …") sites: the blue
 * loot their GUARDS drop, per EVE University's per-site pages (all 24
 * read 2026-09-14). The hackable cans on top are random and not counted.
 * Note the four C4 pages all state 115,000,000. */
export const HACK_BLUE_LOOT: Record<string, { cls: number; isk: number; kind: 'Relic' | 'Data' }> = {
  'Forgotten Perimeter Coronation Platform': { cls: 1, isk: 12_800_000, kind: 'Relic' },
  'Forgotten Perimeter Power Array': { cls: 1, isk: 9_200_000, kind: 'Relic' },
  'Unsecured Perimeter Amplifier': { cls: 1, isk: 10_200_000, kind: 'Data' },
  'Unsecured Perimeter Information Center': { cls: 1, isk: 11_800_000, kind: 'Data' },
  'Forgotten Perimeter Gateway': { cls: 2, isk: 19_100_000, kind: 'Relic' },
  'Forgotten Perimeter Habitation Coils': { cls: 2, isk: 25_400_000, kind: 'Relic' },
  'Unsecured Perimeter Comms Relay': { cls: 2, isk: 18_300_000, kind: 'Data' },
  'Unsecured Perimeter Transponder Farm': { cls: 2, isk: 26_700_000, kind: 'Data' },
  'Forgotten Frontier Quarantine Outpost': { cls: 3, isk: 76_500_000, kind: 'Relic' },
  'Forgotten Frontier Recursive Depot': { cls: 3, isk: 92_500_000, kind: 'Relic' },
  'Unsecured Frontier Database': { cls: 3, isk: 88_400_000, kind: 'Data' },
  'Unsecured Frontier Receiver': { cls: 3, isk: 75_100_000, kind: 'Data' },
  'Forgotten Frontier Conversion Module': { cls: 4, isk: 115_000_000, kind: 'Relic' },
  'Forgotten Frontier Evacuation Center': { cls: 4, isk: 115_000_000, kind: 'Relic' },
  'Unsecured Frontier Digital Nexus': { cls: 4, isk: 115_000_000, kind: 'Data' },
  'Unsecured Frontier Trinary Hub': { cls: 4, isk: 115_000_000, kind: 'Data' },
  'Forgotten Core Data Field': { cls: 5, isk: 279_000_000, kind: 'Relic' },
  'Forgotten Core Information Pen': { cls: 5, isk: 330_000_000, kind: 'Relic' },
  'Unsecured Frontier Enclave Relay': { cls: 5, isk: 329_900_000, kind: 'Data' },
  'Unsecured Frontier Server Bank': { cls: 5, isk: 272_100_000, kind: 'Data' },
  'Forgotten Core Assembly Hall': { cls: 6, isk: 642_500_000, kind: 'Relic' },
  'Forgotten Core Circuitry Disassembler': { cls: 6, isk: 657_600_000, kind: 'Relic' },
  'Unsecured Core Backup Array': { cls: 6, isk: 688_300_000, kind: 'Data' },
  'Unsecured Core Emergence': { cls: 6, isk: 627_100_000, kind: 'Data' },
};

/** gas sites: cloud contents in units (EVE University per-site pages) —
 * filled in chainTables.ts so this file stays about logic */
export interface CloudSpec { gas: string; units: number }
export interface RockSpec { ore: string; units: number }
/** a k-space combat anomaly priced by its NPC bounties: every rat in the
 * initial spawn and the listed waves at CCP's kill bounty (SDE attribute
 * entityKillBounty), before any ESS / dynamic-bounty modifier; random,
 * faction and escalation spawns excluded */
export interface BountySpec { isk: number; faction: string; tier: string; ships: number; waves: number; note?: string }
/** the player's own average for a site (src/lib/hauls.ts) */
export interface HaulEstimate { isk: number; basis: string }
export interface ValueTables {
  gas: Record<string, CloudSpec[]>;
  ore: Record<string, RockSpec[]>;
  /** k-space combat anomalies by exact site name */
  kcombat?: Record<string, BountySpec>;
  /** k-space gas sites (booster nebulae) by exact site name */
  kgas?: Record<string, CloudSpec[]>;
  /** k-space ore anomalies by exact site name; a security-specific entry
   * "Name|HS" wins over the plain name when the contents differ by band */
  kore?: Record<string, RockSpec[]>;
  /** the player's logged hauls: site + group → estimate, or null */
  hauls?: (site: string, group: SigGroup) => HaulEstimate | null;
}

export interface Valuation { isk: number | null; basis: string }

/** a price getter: Jita sell per unit for a type name, or null */
export type PriceOf = (typeName: string) => number | null;

/** a site's published contents at live prices: rock by rock / cloud by cloud;
 * "no prices" when nothing in it is priced, the unpriced items named otherwise */
export function valueContents(specs: readonly { units: number; item: string }[], priceOf: PriceOf, strip = ''): Valuation {
  let isk = 0; const missing: string[] = [];
  for (const c of specs) { const p = priceOf(c.item); if (p === null) missing.push(c.item); else isk += p * c.units; }
  return missing.length === specs.length ? { isk: null, basis: 'no prices' }
    : { isk, basis: `${specs.map((c) => `${c.units.toLocaleString()} ${strip ? c.item.replace(strip, '') : c.item}`).join(' + ')} · Jita sell${missing.length ? ` (no price: ${missing.join(', ')})` : ''}` };
}

/** the rocks an ore site carries per the tables — the wormhole table by
 * site name, else the k-space table's security-specific entry ("Name|HS"),
 * else its plain entry; null when the site is not in any table */
export function siteRocks(sig: Pick<ChainSig, 'name' | 'cls'>, tables: Pick<ValueTables, 'ore' | 'kore'>): RockSpec[] | null {
  if (!sig.name) return null;
  return tables.ore[sig.name] ?? tables.kore?.[`${sig.name}|${sig.cls}`] ?? tables.kore?.[sig.name] ?? null;
}

// ---- ROCK FAMILIES (v0.202.11): "a filter for just the rocks — one per
// rock, not grade specific". The tables name 126 distinct rocks, every one
// "<variant> <ore>" (Prismatic Gneiss), "<ore>", "<ore> IV-Grade",
// "<ore> Grade-II" or a comma typo "<ore>, IV-Grade" — so the family is
// the last word once grade words are dropped. Dark Ochre is the one
// two-word ore ("Jet Ochre", "Ochre III-Grade" are both Dark Ochre).
const GRADE_WORD = /^(?:(?:I{1,3}|IV)-Grade|Grade-(?:I{1,3}|IV))$/i;
export function rockFamily(name: string): string {
  const words = name.replace(/,/g, ' ').trim().split(/\s+/).filter((w) => w && !GRADE_WORD.test(w));
  const last = words[words.length - 1] ?? '';
  const cap = last ? last[0].toUpperCase() + last.slice(1).toLowerCase() : '';
  return cap === 'Ochre' ? 'Dark Ochre' : cap;
}

export interface RockFamilyPresence { family: string; sites: number; units: number }
/** the rock families the ore sites of a reading carry (any grade or
 * variant), A→Z, with how many sites hold each and the units across them;
 * sites the tables do not know contribute nothing */
export function rockFamiliesIn(sigs: readonly ChainSig[], tables: Pick<ValueTables, 'ore' | 'kore'>): RockFamilyPresence[] {
  const acc = new Map<string, RockFamilyPresence>();
  for (const s of sigs) {
    if (s.group !== 'Ore') continue;
    const rocks = siteRocks(s, tables);
    if (!rocks) continue;
    const seen = new Set<string>();
    for (const r of rocks) {
      const f = rockFamily(r.ore);
      if (!f) continue;
      const e = acc.get(f) ?? { family: f, sites: 0, units: 0 };
      if (!seen.has(f)) { e.sites++; seen.add(f); }
      e.units += r.units;
      acc.set(f, e);
    }
  }
  return [...acc.values()].sort((a, b) => a.family.localeCompare(b.family));
}

export function valueSig(sig: ChainSig, priceOf: PriceOf, tables: ValueTables): Valuation {
  if (!sig.name) return { isk: null, basis: sig.group === 'Combat' ? 'unnamed' : 'unscanned' };
  const own = tables.hauls?.(sig.name, sig.group) ?? null;
  const contents = (specs: { units: number; item: string }[], strip = ''): Valuation => valueContents(specs, priceOf, strip);
  if (sig.group === 'Combat') {
    const c = COMBAT_BLUE_LOOT[sig.name];
    if (c) return { isk: c.isk, basis: `blue loot · C${c.cls} site` };
    const k = tables.kcombat?.[sig.name];
    if (k) return { isk: k.isk, basis: `bounties · ${k.ships} rats in ${k.waves} wave${k.waves === 1 ? '' : 's'} · base, before ESS / bounty modifier${k.note ? ` · ${k.note}` : ''}` };
    if (own) return { isk: own.isk, basis: own.basis };
    return { isk: null, basis: 'k-space anomaly — not in the bounty table' };
  }
  if (sig.group === 'Relic' || sig.group === 'Data') {
    const h = HACK_BLUE_LOOT[sig.name];
    if (h) return { isk: h.isk, basis: `blue loot from the guards · C${h.cls} ${h.kind.toLowerCase()} site · cans extra, not counted` };
    if (own) return { isk: own.isk, basis: own.basis };
    return { isk: null, basis: 'pirate site — random cans; log a haul to start your own average' };
  }
  if (sig.group === 'Gas') {
    const clouds = tables.gas[sig.name] ?? tables.kgas?.[sig.name];
    if (clouds) return contents(clouds.map((c) => ({ units: c.units, item: c.gas })), 'Fullerite-');
    if (own) return { isk: own.isk, basis: own.basis };
    return { isk: null, basis: 'unknown gas site' };
  }
  if (sig.group === 'Ore') {
    const rocks = siteRocks(sig, tables);
    if (rocks) return contents(rocks.map((r) => ({ units: r.units, item: r.ore })));
    if (own) return { isk: own.isk, basis: own.basis };
    return { isk: null, basis: 'unknown ore site' };
  }
  if (own) return { isk: own.isk, basis: own.basis };
  return { isk: null, basis: '' };
}

// ---------------------------------------------------------------------------
// FILTERS + SUMMARY
// ---------------------------------------------------------------------------

export interface ChainFilters {
  /** null = any distance; otherwise at most this many holes from the origin */
  maxHops: number | null;
  /** classes to include: 'C1'…'C6', 'HS', 'LS', 'NS'; empty = all */
  classes: Set<string>;
  /** activity groups to include; empty = all except Wormhole */
  groups: Set<SigGroup>;
  /** hours; null = any */
  maxAgeH: number | null;
  /** only these systems (a click on the chain drawing); empty/absent = all */
  systems?: Set<string>;
  /** drop sites in systems with no drawn link back to the origin (v0.202.2
   * "linked only"); only meaningful when hops are known */
  linkedOnly?: boolean;
  /** rock families (v0.202.11, `rockFamily`): when set, only ore sites that
   * carry one of them pass — any grade or variant — and a passing site is
   * valued on those rocks alone; every other activity is left out */
  rocks?: Set<string>;
}

export interface ChainRow extends ChainSig {
  hops: number | null;
  value: Valuation;
}

export interface ChainSummary {
  rows: ChainRow[];
  byGroup: Record<SigGroup, { count: number; isk: number; unvalued: number }>;
  totalIsk: number;
  unreachable: number;
  /** rows a class filter dropped only because their class is unknown */
  hiddenNoClass: number;
  /** rows a distance filter dropped only because their distance is unknown */
  hiddenNoHops: number;
  /** rows "linked only" dropped: their system has no drawn link to the origin */
  hiddenUnlinked: number;
  /** ore sites a rock filter dropped only because their contents are not in
   * the tables (a site the tables do know, holding other rocks, is simply out) */
  hiddenNoRock: number;
}

export function summarize(
  sigs: readonly ChainSig[], hops: Map<string, number> | null, filters: ChainFilters,
  priceOf: PriceOf, tables: ValueTables,
): ChainSummary {
  const byGroup = {} as ChainSummary['byGroup'];
  for (const g of ['Combat', 'Ore', 'Gas', 'Relic', 'Data', 'Wormhole', 'Other'] as SigGroup[]) byGroup[g] = { count: 0, isk: 0, unvalued: 0 };
  const rows: ChainRow[] = [];
  let unreachable = 0, hiddenNoClass = 0, hiddenNoHops = 0, hiddenUnlinked = 0, hiddenNoRock = 0;
  const rockFilter = filters.rocks && filters.rocks.size > 0 ? filters.rocks : null;
  for (const s of sigs) {
    if (filters.groups.size > 0 ? !filters.groups.has(s.group) : s.group === 'Wormhole') continue;
    // rock filter (v0.202.11): ore sites only, and only those carrying one
    // of the picked families; the site is then valued on those rocks alone
    let mine: RockSpec[] | null = null;
    if (rockFilter) {
      if (s.group !== 'Ore') continue;
      const rocks = siteRocks(s, tables);
      if (!rocks) { hiddenNoRock++; continue; }
      mine = rocks.filter((r) => rockFilter.has(rockFamily(r.ore)));
      if (mine.length === 0) continue;
    }
    if (filters.systems && filters.systems.size > 0 && !filters.systems.has(s.system)) continue;
    if (filters.classes.size > 0 && !filters.classes.has(s.cls)) { if (!s.cls) hiddenNoClass++; continue; }
    if (filters.maxAgeH !== null && s.ageH !== null && s.ageH > filters.maxAgeH) continue;
    const h = hops ? (hops.get(s.system) ?? null) : null;
    if (hops && h === null) unreachable++;
    // "linked only" (v0.202.2): a system with no drawn link to the origin is
    // left out altogether — counted apart from a distance filter's drops
    if (filters.linkedOnly && hops && h === null) { hiddenUnlinked++; continue; }
    if (filters.maxHops !== null && (h === null || h > filters.maxHops)) { if (h === null) hiddenNoHops++; continue; }
    const value = mine
      ? (() => { const v = valueContents(mine.map((r) => ({ units: r.units, item: r.ore })), priceOf); return v.isk === null ? v : { isk: v.isk, basis: `${v.basis} · ${[...rockFilter!].join(' + ')} only` }; })()
      : valueSig(s, priceOf, tables);
    rows.push({ ...s, hops: h, value });
    const g = byGroup[s.group];
    g.count++;
    if (value.isk === null) g.unvalued++; else g.isk += value.isk;
  }
  rows.sort((a, b) => (a.hops ?? 99) - (b.hops ?? 99) || (b.value.isk ?? -1) - (a.value.isk ?? -1) || a.system.localeCompare(b.system));
  const totalIsk = Object.values(byGroup).reduce((s, g) => s + g.isk, 0);
  return { rows, byGroup, totalIsk, unreachable, hiddenNoClass, hiddenNoHops, hiddenUnlinked, hiddenNoRock };
}

// ---- ORE VARIANTS (v0.202.8): the site tables name rocks by their exact
// variant ("Golden Omber", "Concentrated Veldspar", "Bezdnacine Grade-II"),
// and the shipped type list carries the base ores only — measured: 74 of
// 151 priceable names resolved, the 77 others all variants (plus three
// comma typos, "Ytirium, IV-Grade"). A variant yields at least its base
// ore, so the base ore's price is an honest FLOOR for it. Given a name the
// price map does not know, this finds the longest known name it contains.
export function basePriceName(name: string, known: (n: string) => boolean): string | null {
  const clean = name.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
  if (known(clean)) return clean;
  const words = clean.split(' ');
  // every contiguous run of words, longest first
  for (let len = words.length - 1; len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const cand = words.slice(i, i + len).join(' ');
      if (known(cand)) return cand;
    }
  }
  // v0.202.11: the one ore whose variants do not contain its name — "Jet
  // Ochre", "Ochre III-Grade" are Dark Ochre; the family resolver knows
  const fam = rockFamily(clean);
  if (fam && fam !== clean && known(fam)) return fam;
  return null;
}

// ---- COLUMN SORTING (v0.202.5) — the table's headings. Pure; the rows
// come in the default order (nearest, then richest) and that order is the
// tie-break, so a sort never shuffles equal rows. Unknowns (no distance,
// no value, no age, no name, no class) go LAST whichever way the sort
// runs — a "?" is never the top row.
export type ChainSortKey = 'hops' | 'system' | 'cls' | 'group' | 'name' | 'value' | 'age' | 'basis';
export interface ChainSort { key: ChainSortKey; dir: 'asc' | 'desc' }
/** the direction a first click gives each column */
export const CHAIN_SORT_NATURAL: Record<ChainSortKey, 'asc' | 'desc'> = {
  hops: 'asc', system: 'asc', cls: 'asc', group: 'asc', name: 'asc', value: 'desc', age: 'asc', basis: 'asc',
};
/** the class ladder: easiest first, then k-space by security */
export const CLASS_SORT_RANK = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C13', 'HS', 'LS', 'NS'];
export const GROUP_SORT_RANK: SigGroup[] = ['Combat', 'Ore', 'Gas', 'Relic', 'Data', 'Wormhole', 'Other'];

export function sortChainRows(rows: readonly ChainRow[], sort: ChainSort | null): ChainRow[] {
  const base = rows.slice();
  if (!sort) return base;
  const mul = sort.dir === 'asc' ? 1 : -1;
  const rank = (list: readonly string[], v: string): number => { const i = list.indexOf(v); return i < 0 ? list.length : i; };
  const keyOf = (r: ChainRow): number | string | null => {
    switch (sort.key) {
      case 'hops': return r.hops;
      case 'system': return r.system.toLowerCase();
      case 'cls': return r.cls ? rank(CLASS_SORT_RANK, r.cls) : null;
      case 'group': return rank(GROUP_SORT_RANK, r.group);
      case 'name': return r.name ? r.name.toLowerCase() : null;
      case 'value': return r.value.isk;
      case 'age': return r.ageH;
      case 'basis': return r.value.basis.toLowerCase();
    }
  };
  return base
    .map((r, i) => ({ r, i, k: keyOf(r) }))
    .sort((a, b) => {
      if (a.k === null && b.k === null) return a.i - b.i;
      if (a.k === null) return 1;
      if (b.k === null) return -1;
      const c = typeof a.k === 'number' && typeof b.k === 'number' ? a.k - b.k : String(a.k).localeCompare(String(b.k));
      return c !== 0 ? c * mul : a.i - b.i;
    })
    .map((x) => x.r);
}
