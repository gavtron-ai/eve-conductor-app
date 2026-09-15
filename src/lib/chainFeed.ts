// THE MAP'S OWN DATA FEED (v0.200.3) — the complete signature list, read
// without the Signature Search panel being open or unfiltered.
//
// The map page loads its systems, links and signatures from same-origin
// JSON routes (/api/map/{id}, /api/map/{id}/systems/{sid}/signatures —
// measured from the page's resource timings 2026-09-14). The app fetches
// the same routes, with the user's own login, and reads them here.
//
// Nothing about the field names is assumed. The map is private and its
// schema unpublished, so every role (which array holds the systems, which
// field is the id, which two fields make a link, which field is the sig
// id / group / site name / timestamp) is INFERRED FROM THE VALUES and
// checked against things we already know: the React-Flow node ids and
// texts drawn on the page, the "ABC-123" signature pattern, the group
// vocabulary, and our own site-name tables. Every choice is reported so
// the diagnostics log shows what was matched and how well. If nothing
// matches, the caller falls back to the panel table as before.
import { COMBAT_BLUE_LOOT, HACK_BLUE_LOOT, parseClassToken, type ChainSig, type SigGroup } from './chain';
import { GAS_SITES, ORE_SITES } from './chainTables';

type Json = unknown;
type Obj = Record<string, Json>;

const isObj = (v: Json): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const SIG_RE = /^[A-Z0-9]{3}-\d{3}$/;
const GROUP_WORDS: Record<string, SigGroup> = {
  combat: 'Combat', ore: 'Ore', gas: 'Gas', relic: 'Relic', data: 'Data', wormhole: 'Wormhole', wh: 'Wormhole',
};

/** every array of plain objects inside a JSON document, by path — arrays
 * at the same path (one per parent item, e.g. systems[].signatures) are
 * merged, and each nested item carries its parent under `__parent` so a
 * signature inside a system still knows which system it belongs to */
export function collectArrays(doc: Json, maxDepth = 7): { path: string; items: Obj[] }[] {
  const byPath = new Map<string, Obj[]>();
  const walk = (v: Json, path: string, depth: number, parent: Obj | null) => {
    if (depth > maxDepth || v === null || typeof v !== 'object') return;
    if (Array.isArray(v)) {
      const objs = v.filter(isObj).map((o) => (parent ? { ...o, __parent: parent } : o));
      if (objs.length > 0) byPath.set(path, [...(byPath.get(path) ?? []), ...objs]);
      for (const item of objs) for (const [k, sub] of Object.entries(item)) if (k !== '__parent' && sub && typeof sub === 'object') walk(sub, `${path}[].${k}`, depth + 1, item);
      return;
    }
    for (const [k, sub] of Object.entries(v as Obj)) walk(sub, path ? `${path}.${k}` : k, depth + 1, parent);
  };
  walk(doc, '', 0, null);
  return [...byPath].map(([path, items]) => ({ path, items }));
}

/** an item's scalar fields, one nesting level flattened ("from.id") */
function flat(item: Obj): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(item)) {
    if (v === null || typeof v !== 'object') { out[k] = v as string | number | boolean | null; continue; }
    if (isObj(v)) for (const [k2, v2] of Object.entries(v)) if (k2 !== '__parent' && (v2 === null || typeof v2 !== 'object')) out[`${k}.${k2}`] = v2 as string | number | boolean | null;
  }
  return out;
}

const keysOf = (items: Obj[]): string[] => [...new Set(items.flatMap((i) => Object.keys(flat(i))))];
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v));

export interface FeedSystem {
  id: string; label: string; jcode: string; cls: string;
  /** CCP's solar system id when the feed carries one (30000000–33000000) */
  eveId: string;
  /** the map's per-system tag (a letter or a glyph) shown after the class */
  tag: string;
  /** the wormhole effect as the feed spells it, '' when none */
  effect: string;
}
const EFFECT_RE = /black\s*hole|cataclysmic|magnetar|pulsar|red\s*giant|wolf/i;

const isTag = (v: unknown): boolean => typeof v === 'string' && (/^[A-Z]$/.test(v) || (v.length > 0 && [...v].length <= 2 && !/[\p{L}\p{N}]/u.test(v)));

const isEveSystemId = (v: unknown): boolean => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && /^\d+$/.test(v) ? Number(v) : NaN;
  return n >= 30_000_000 && n < 33_000_000;
};
export interface FeedReport {
  systems: { path: string; idKey: string; labelKey: string; jKey: string; clsKey: string; eveKey: string; tagKey: string; effectKey: string; count: number; drawnMatched: number } | null;
  edges: { path: string; keys: [string, string]; count: number; coverage: number } | null;
  sigs: { sigKey: string; groupKey: string; nameKey: string; timeKey: string; systemKey: string; count: number; groupFromName: number } | null;
  /** the map's own home system, when the document names one (a scalar
   * whose key says "home" and whose value is a system id) */
  home: { key: string; label: string } | null;
  notes: string[];
}

/** scalars outside any array, with their dotted key path */
function scalarsOf(doc: Json, maxDepth = 4): [string, unknown][] {
  const out: [string, unknown][] = [];
  const walk = (v: Json, path: string, depth: number) => {
    if (depth > maxDepth || v === null || typeof v !== 'object' || Array.isArray(v)) { if (path && !Array.isArray(v) && (v === null || typeof v !== 'object')) out.push([path, v]); return; }
    for (const [k, sub] of Object.entries(v as Obj)) walk(sub, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(doc, '', 0);
  return out;
}

/**
 * The map's systems and links from the map document, matched against the
 * nodes drawn on the page (their data-id and text).
 */
export function inferMap(doc: Json, drawn: readonly { id: string; text: string }[]): { systems: FeedSystem[]; edges: [string, string][]; home: FeedSystem | null; report: Pick<FeedReport, 'systems' | 'edges' | 'home' | 'notes'> } {
  const notes: string[] = [];
  const arrays = collectArrays(doc);
  const drawnIds = new Set(drawn.map((d) => d.id).filter(Boolean));
  const drawnText = new Map(drawn.map((d) => [d.id, ` ${d.text.replace(/\s+/g, ' ')} `]));

  // --- systems: the array + key whose values cover the most DISTINCT drawn
  // node ids (a nested list repeats its parent's id many times and must not
  // win; a parent reference cannot be the systems list itself) ---
  let best: { path: string; items: Obj[]; idKey: string; matched: number } | null = null;
  for (const a of arrays) {
    for (const k of keysOf(a.items)) {
      if (k.startsWith('__parent')) continue;
      const matched = new Set(a.items.map((i) => str(flat(i)[k])).filter((v) => drawnIds.has(v))).size;
      if (matched > 0 && (!best || matched > best.matched)) best = { path: a.path, items: a.items, idKey: k, matched };
    }
  }
  if (!best || best.matched < Math.max(1, Math.ceil(drawnIds.size * 0.5))) {
    notes.push(`systems: no array covers the drawn node ids (best ${best ? `${best.path}.${best.idKey} = ${best.matched}` : 'none'} of ${drawnIds.size})`);
    return { systems: [], edges: [], home: null, report: { systems: null, edges: null, home: null, notes } };
  }
  // label: per drawn system, the longest string value that appears in its
  // node's text (a custom name beats the J-code when both are present);
  // fields ranked by how often they won label undrawn systems
  const sk = keysOf(best.items).filter((k) => !k.startsWith('__parent'));
  const wins = new Map<string, number>();
  const filled = new Map<string, number>();
  const labelOf = (i: Obj): string => {
    const f = flat(i);
    const t = drawnText.get(str(f[best!.idKey]));
    if (!t) return '';
    let bestK = '', bestV = '';
    for (const k of sk) {
      const v = str(f[k]).replace(/\s+/g, ' ').trim();
      if (v.length > 1) filled.set(k, (filled.get(k) ?? 0) + 1);
      if (v.length > 1 && t.includes(` ${v} `) && v.length > bestV.length) { bestK = k; bestV = v; }
    }
    if (bestK) wins.set(bestK, (wins.get(bestK) ?? 0) + 1);
    return bestV;
  };
  const drawnLabels = new Map(best.items.map((i) => [i, labelOf(i)] as const));
  // a field that is the label WHENEVER it is filled (a custom name) ranks
  // above one that only wins when the first is empty (the J-code)
  const ranked = [...wins].sort((a, b) => (b[1] / (filled.get(b[0]) || 1)) - (a[1] / (filled.get(a[0]) || 1)) || b[1] - a[1]).map(([k]) => k);
  const jKey = sk.find((k) => best!.items.filter((i) => /^J\d{6}$/.test(str(flat(i)[k]))).length >= Math.max(1, best!.items.length * 0.3)) ?? '';
  const clsKey = sk.find((k) => best!.items.filter((i) => !!parseClassToken(str(flat(i)[k]).toUpperCase())).length >= Math.max(1, best!.items.length * 0.5)) ?? '';
  // CCP's solar system id, when carried — signatures may reference it
  // instead of the map's own id
  const eveKey = sk.filter((k) => k !== best!.idKey).find((k) => best!.items.filter((i) => isEveSystemId(flat(i)[k])).length >= Math.max(1, best!.items.length * 0.5)) ?? '';
  // the per-system tag: a field of one-letter / glyph values
  const tagKey = sk.filter((k) => k !== best!.idKey && k !== jKey && k !== clsKey).find((k) => {
    const vals = best!.items.map((i) => flat(i)[k]).filter((v) => typeof v === 'string' && v !== '');
    return vals.length >= 2 && vals.filter(isTag).length >= vals.length * 0.5 && new Set(vals).size >= 2;
  }) ?? '';
  // CUSTOM NAME beats SYSTEM NAME beats anything else (v0.200.5 — on the
  // real map the longest match picked k-space REGIONS: "The Forge" for
  // Jita). A custom-name field is one that, on a J-space system, carries a
  // value the drawing shows; a region never does. jKey is the system-name
  // field (J-codes in J-space, "Jita" in k-space).
  const isJ = (i: Obj) => !!jKey && /^J\d{6}$/.test(str(flat(i)[jKey]));
  const customKeys = ranked.filter((k) => k !== jKey && best!.items.some((i) => {
    const f = flat(i); const t = drawnText.get(str(f[best!.idKey]));
    const v = str(f[k]).replace(/\s+/g, ' ').trim();
    return isJ(i) && !!t && v.length > 1 && t.includes(` ${v} `);
  }));
  // the system effect: a string field whose filled values name one of the
  // six effects (the real feed: `effect`, null when none)
  const effectKey = sk.find((k) => {
    const vals = best!.items.map((i) => flat(i)[k]).filter((v) => typeof v === 'string' && v !== '');
    return vals.length >= 1 && vals.every((v) => EFFECT_RE.test(String(v)));
  }) ?? '';
  const systems: FeedSystem[] = best.items.map((i) => {
    const f = flat(i);
    const id = str(f[best!.idKey]);
    const jcode = jKey ? str(f[jKey]) : '';
    let label = '';
    for (const k of customKeys) { const v = str(f[k]).replace(/\s+/g, ' ').trim(); if (v.length > 1) { label = v; break; } }
    if (!label && jcode.length > 1) label = jcode;
    if (!label) label = drawnLabels.get(i) ?? '';
    if (!label) for (const k of ranked) { const v = str(f[k]).replace(/\s+/g, ' ').trim(); if (v.length > 1) { label = v; break; } }
    const cls = clsKey ? parseClassToken(str(f[clsKey]).toUpperCase()) : '';
    const eveId = eveKey ? str(f[eveKey]) : '';
    // once the tag field is known, any short value is the tag ("A", "a",
    // "A1", a glyph) — the strict shape only picks the field
    const rawTag = tagKey ? str(f[tagKey]).trim() : '';
    const tag = rawTag && [...rawTag].length <= 3 ? (/^[a-z]$/.test(rawTag) ? rawTag.toUpperCase() : rawTag) : '';
    const effect = effectKey && typeof f[effectKey] === 'string' ? str(f[effectKey]) : '';
    return { id, label, jcode, cls, eveId, tag, effect };
  }).filter((s) => s.id);
  const sysIds = new Set(systems.map((s) => s.id));
  // the map's home: a scalar (outside the lists) whose key says "home" and
  // whose value is one of the system ids — e.g. homeMapSystemId
  const homeHit = scalarsOf(doc).find(([k, v]) => /home/i.test(k) && sysIds.has(str(v)));
  const home = homeHit ? systems.find((s) => s.id === str(homeHit[1])) ?? null : null;

  // --- edges: an array whose items carry two fields that are both system
  // ids (loops count as candidates but not as links; a signature list, or
  // a field that never changes, is not a link list) ---
  let bestE: { path: string; keys: [string, string]; pairs: [string, string][]; coverage: number; distinct: number } | null = null;
  for (const a of arrays) {
    if (a.path === best.path) continue;
    const ks = keysOf(a.items);
    if (ks.some((k) => a.items.filter((i) => SIG_RE.test(str(flat(i)[k]).toUpperCase())).length >= a.items.length * 0.6)) continue;
    for (const k1 of ks) for (const k2 of ks) {
      if (k1 >= k2) continue;
      if (a.items.length > 2 && (new Set(a.items.map((i) => str(flat(i)[k1]))).size === 1 || new Set(a.items.map((i) => str(flat(i)[k2]))).size === 1)) continue;
      const pairs: [string, string][] = [];
      let candidates = 0;
      for (const i of a.items) {
        const f = flat(i);
        const x = str(f[k1]), y = str(f[k2]);
        if (x && y && sysIds.has(x) && sysIds.has(y)) { candidates++; if (x !== y) pairs.push([x, y]); }
      }
      const coverage = candidates / a.items.length;
      const distinct = new Set(pairs.map(([x, y]) => (x < y ? `${x}|${y}` : `${y}|${x}`))).size;
      if (pairs.length > 0 && coverage >= 0.8 && (!bestE || distinct > bestE.distinct)) bestE = { path: a.path, keys: [k1, k2], pairs, coverage, distinct };
    }
  }
  if (!bestE) notes.push('edges: no array pairs system ids');
  return {
    systems, edges: bestE ? bestE.pairs : [], home,
    report: {
      systems: { path: best.path, idKey: best.idKey, labelKey: customKeys.join('>') || ranked.join('>'), jKey, clsKey, eveKey, tagKey, effectKey, count: systems.length, drawnMatched: best.matched },
      edges: bestE ? { path: bestE.path, keys: bestE.keys, count: bestE.pairs.length, coverage: Number(bestE.coverage.toFixed(2)) } : null,
      home: home && homeHit ? { key: homeHit[0], label: home.label } : null,
      notes,
    },
  };
}

const KNOWN_SITES = new Map<string, SigGroup>([
  ...Object.keys(COMBAT_BLUE_LOOT).map((n) => [n, 'Combat'] as [string, SigGroup]),
  ...Object.entries(HACK_BLUE_LOOT).map(([n, v]) => [n, v.kind] as [string, SigGroup]),
  ...Object.keys(GAS_SITES).map((n) => [n, 'Gas'] as [string, SigGroup]),
  ...Object.keys(ORE_SITES).map((n) => [n, 'Ore'] as [string, SigGroup]),
]);

/** the activity a site name implies, when the feed does not say */
export function groupFromName(name: string): SigGroup | null {
  const n = name.trim();
  if (!n) return null;
  const known = KNOWN_SITES.get(n);
  if (known) return known;
  if (/\b(Hideaway|Burrow|Refuge|Den|Yard|Rally Point|Port|Hub|Haven|Sanctum|Forsaken|Forlorn|Hidden|Scout Outpost|Vigil|Watch|Fortress|Complex)\b/.test(n)) return 'Combat';
  if (/^(Crumbling|Decayed|Ruined)\b/.test(n) || /\b(Relic)\b/i.test(n)) return 'Relic';
  if (/^(Local|Regional|Central)\b/.test(n) || /\b(Data|Mainframe|Server|Database|Backup|Info Shard)\b/i.test(n)) return 'Data';
  if (/\b(Reservoir|Gas|Nebula|Cloud)\b/.test(n)) return 'Gas';
  if (/\b(Deposit|Asteroid|Ore|Belt|Cluster)\b/.test(n)) return 'Ore';
  if (/\b(Wormhole|K162|Unstable)\b/i.test(n) || /^[A-Z]\d{3}$/.test(n)) return 'Wormhole';
  return null;
}

const asTime = (v: unknown): number | null => {
  if (typeof v === 'number') return v > 1e12 ? v : v > 1e9 ? v * 1000 : null;
  if (typeof v === 'string' && /\d{4}-\d{2}-\d{2}/.test(v)) { const t = Date.parse(v); return Number.isFinite(t) ? t : null; }
  return null;
};

/**
 * Signature rows from a JSON document (one system's list, or a document
 * with lists for many systems). `systemOf` maps a system id to its label;
 * `defaultSystem` is the system the route was fetched for.
 */
export function inferSignatures(
  doc: Json, systems: readonly FeedSystem[], defaultSystem: FeedSystem | null, nowMs: number,
): { sigs: ChainSig[]; report: FeedReport['sigs'] } {
  const arrays = collectArrays(doc);
  let best: { items: Obj[]; sigKey: string; hits: number } | null = null;
  for (const a of arrays) {
    for (const k of keysOf(a.items)) {
      const hits = a.items.filter((i) => SIG_RE.test(str(flat(i)[k]).toUpperCase())).length;
      if (hits > 0 && hits >= a.items.length * 0.6 && (!best || hits > best.hits)) best = { items: a.items, sigKey: k, hits };
    }
  }
  if (!best) return { sigs: [], report: null };
  const ks = keysOf(best.items).filter((k) => k !== best!.sigKey);
  // a signature may name its system by the map's id or by CCP's id
  const byId = new Map<string, FeedSystem>();
  for (const s of systems) { byId.set(s.id, s); if (s.eveId) byId.set(s.eveId, s); }
  const score = (k: string, f: (v: unknown) => boolean) => best!.items.filter((i) => f(flat(i)[k])).length;
  const groupKey = ks.map((k) => [k, score(k, (v) => typeof v === 'string' && !!GROUP_WORDS[v.toLowerCase().trim()])] as const)
    .filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  const nameKey = (() => {
    const known = ks.map((k) => [k, score(k, (v) => typeof v === 'string' && KNOWN_SITES.has(v.trim()))] as const).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1])[0];
    if (known) return known[0];
    // else: the string field with the longest typical value that is not a sig, group, id or date
    const cands = ks.filter((k) => k !== groupKey).map((k) => {
      const vals = best!.items.map((i) => flat(i)[k]).filter((v): v is string => typeof v === 'string' && v.length > 0 && !SIG_RE.test(v) && !/\d{4}-\d{2}-\d{2}/.test(v) && !/^[0-9a-f-]{20,}$/i.test(v));
      return [k, vals.length ? vals.reduce((s, v) => s + v.length, 0) / vals.length : 0, vals.length] as const;
    }).filter(([, avg, n]) => avg >= 6 && n >= best!.items.length * 0.3).sort((a, b) => b[1] - a[1]);
    return cands[0]?.[0] ?? '';
  })();
  const timeKeys = ks.filter((k) => score(k, (v) => asTime(v) !== null) >= best!.items.length * 0.5);
  const timeKey = timeKeys.find((k) => /updat|seen|modif|scan|touch/i.test(k)) ?? timeKeys.find((k) => /creat|added|found/i.test(k)) ?? timeKeys[0] ?? '';
  const systemKey = ks.map((k) => [k, score(k, (v) => byId.has(str(v)))] as const).filter(([, s]) => s >= best!.items.length * 0.5).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  let groupFromNameN = 0;
  const sigs: ChainSig[] = [];
  for (const i of best.items) {
    const f = flat(i);
    const sig = str(f[best.sigKey]).toUpperCase();
    if (!SIG_RE.test(sig)) continue;
    const name = nameKey ? str(f[nameKey]).replace(/\s+/g, ' ').trim() : '';
    let group: SigGroup | null = groupKey ? GROUP_WORDS[str(f[groupKey]).toLowerCase().trim()] ?? null : null;
    if (!group) { const g = groupFromName(name); if (g) { group = g; groupFromNameN++; } }
    const sys = systemKey ? byId.get(str(f[systemKey])) ?? defaultSystem : defaultSystem;
    if (!sys) continue;
    const t = timeKey ? asTime(f[timeKey]) : null;
    sigs.push({ sig, group: group ?? 'Other', system: sys.label, cls: sys.cls, name: name === '—' ? '' : name, ageH: t === null ? null : Math.max(0, (nowMs - t) / 3_600_000) });
  }
  return { sigs, report: { sigKey: best.sigKey, groupKey, nameKey, timeKey, systemKey, count: sigs.length, groupFromName: groupFromNameN } };
}
