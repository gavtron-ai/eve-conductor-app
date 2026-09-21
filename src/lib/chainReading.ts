// A MAP READING, PARSED (v0.207.0) — lifted out of the Σ Summary unchanged so the Home
// dashlets read the chain through the SAME code as the tab: one parser, so a dashlet's number
// and the tab's number cannot drift apart. PURE.
import type { ChainExtract } from './apertureExtract';
import { parseSigSearch, resolveEdges, systemOfNodeText, tagOfNodeText, type ChainSig, type SigGroup } from './chain';
import { normEffect, paletteFromProbe } from './chainViz';
import WH_SYSTEMS from '../data/whSystems.json';

export interface ParsedReading {
  sigs: ChainSig[];
  edges: [string, string][];
  how: ReturnType<typeof resolveEdges>["how"];
  nodeCount: number;
  systems: Set<string>;
  tagOf: Map<string, string>;
  effectOf: Map<string, string>;
  clsOf: Map<string, string>;
  shattered: Set<string>;
  palette: ReturnType<typeof paletteFromProbe>;
  source: string;
  nodeText: { id: string; text: string }[];
  nodeSys: Map<string, string>;
}

export function parseReading(data: ChainExtract): ParsedReading {
  const feed = data.feedRead && data.feedRead.sigs.length > 0 ? data.feedRead : null;
  // THE FEED FIRST (v0.200.3): the complete list from the map's own
  // JSON, whatever the panel shows. The panel table is the fallback.
  const sigs: ChainSig[] = feed ? feed.sigs.map((s) => ({ ...s, group: s.group as SigGroup })) : parseSigSearch(data.sigText);
  const known = [...new Set(sigs.map((s) => s.system))];
  const nodeSys = new Map<string, string>();
  const nodeCls = new Map<string, string>();
  if (feed) {
    for (const s of feed.systems) { nodeSys.set(s.id, s.label); if (s.cls) nodeCls.set(s.label, s.cls); }
  }
  for (const n of data.graph.nodes) {
    if (nodeSys.has(n.id)) continue;
    const { system, cls } = systemOfNodeText(n.text, known);
    if (n.id && system) { nodeSys.set(n.id, system); if (cls) nodeCls.set(system, cls); }
  }
  // links: the feed's pairs when it has them; else node-id pairs from the
  // drawing (data attributes, React Flow's aria-label, or path geometry —
  // v0.200.1: the real map's edge ids are bare numbers)
  const dom = resolveEdges(data.graph.nodes, data.graph.edges);
  const pairs = feed && feed.edges.length > 0 ? feed.edges : dom.pairs;
  const edges = pairs.filter(([a, b]) => nodeSys.has(a) && nodeSys.has(b)).map(([a, b]) => [nodeSys.get(a)!, nodeSys.get(b)!] as [string, string]);
  // a sig row without a class chip borrows the node's
  for (const s of sigs) if (!s.cls && nodeCls.has(s.system)) s.cls = nodeCls.get(s.system)!;
  const drawnIds = new Set(data.graph.nodes.map((n) => n.id));
  const drawnCount = feed ? feed.systems.filter((s) => drawnIds.has(s.id)).length || nodeSys.size : nodeSys.size;
  // the map's per-system tag ("C2A"): from the feed, else from the node text
  const tagOf = new Map<string, string>();
  if (feed) for (const s of feed.systems) if (s.tag) tagOf.set(s.label, s.tag);
  for (const n of data.graph.nodes) { const label = nodeSys.get(n.id); if (label && !tagOf.has(label)) { const t = tagOfNodeText(n.text); if (t) tagOf.set(label, t); } }
  // the wormhole effect (v0.201.1): the feed's own field first, else CCP's
  // data by J-code — a custom-labelled system still has its J-code in the feed
  const effectOf = new Map<string, string>();
  // shattered systems (v0.201.7): CCP's data by J-code — the map's
  // dotted circle
  const shattered = new Set<string>();
  const jOf = (label: string): string => { const s = feed?.systems.find((x) => x.label === label); return s?.jcode || (/^J\d{6}$/.test(label) ? label : ''); };
  for (const label of new Set([...known, ...nodeSys.values()])) {
    const fromFeed = feed ? normEffect(feed.systems.find((x) => x.label === label)?.effect) : '';
    const j = jOf(label);
    const ccp = j ? (WH_SYSTEMS as Record<string, { cls: string; effect?: string; shattered?: boolean }>)[j] : undefined;
    const fromCcp = normEffect(ccp?.effect);
    const e = fromFeed || fromCcp;
    if (e) effectOf.set(label, e);
    if (ccp?.shattered) shattered.add(label);
  }
  // the class of EVERY system (v0.201.4): the feed / node class first,
  // a signature row's class second — a k-space hole with no signatures
  // still has its class
  const clsOf = new Map<string, string>(nodeCls);
  for (const s of sigs) if (s.cls && !clsOf.has(s.system)) clsOf.set(s.system, s.cls);
  return {
    sigs, edges, how: dom.how, nodeCount: drawnCount, systems: new Set([...known, ...nodeSys.values()]), tagOf, effectOf, clsOf, shattered,
    // the map's own effect colours, when the reading measured its badges
    palette: paletteFromProbe((data.probe as { effectStyles?: unknown }).effectStyles),
    source: feed ? (`map feed · ${feed.systems.length} systems known` + (feed.edges.length > 0 ? '' : ' · links from the drawing')) : 'Signature Search panel',
    nodeText: data.graph.nodes.map((n) => ({ id: n.id, text: n.text })), nodeSys,
  };
}

/** a typed label or an ESI system name may not be the label the graph uses (custom name vs
 * J-code): match it through the drawn node's text */
export function labelOnReading(parsed: ParsedReading, want: string): string | null {
  if (parsed.systems.has(want)) return want;
  const hit = parsed.nodeText.find((n) => ` ${n.text.replace(/\s+/g, ' ')} `.toLowerCase().includes(` ${want.toLowerCase()} `));
  if (!hit) return null;
  return parsed.nodeSys.get(hit.id) ?? systemOfNodeText(hit.text, [...parsed.systems]).system ?? null;
}

/** the HOME origin as a label on this reading: what was typed / set in Settings, else the
 * map's own home system when its feed names one */
export function homeOrigin(parsed: ParsedReading, typedHome: string, feedHome: string): string {
  const homeLabel = typedHome.trim() || feedHome;
  const typed = homeLabel ? labelOnReading(parsed, homeLabel) : null;
  if (typed) return typed;
  // the typed label is not on THIS reading (v0.202.9: a reading taken before the drawing
  // settled labels systems by J-code) — the map's own home is the same system
  if (feedHome && parsed.systems.has(feedHome)) return feedHome;
  return homeLabel || '';
}
