// CHAIN SUMMARY WINDOW (v0.200) — its own pop-out, opened by the Summary
// button on the Aperture module. "What is out there to do in chain":
// ISK on field per activity, every site with its distance in holes from
// HOME (the map's home system, as the map labels it, typed once here) or
// from ME (the active
// character's current system from CCP's location route), filtered by
// distance, wormhole class, activity and age.
//
// Data arrives from the main window's Aperture module (the user's own
// logged-in map, read in place — apertureExtract.ts) through the main
// process, which keeps the latest reading for a reopened window. Refresh
// asks the main window to read again. This window writes nothing to the
// shared store (the setup-window lesson: a second store instance would
// clobber the main one); its one preference lives under its own key.
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { ChainExtract } from '../lib/apertureExtract';
import {
  CHAIN_SORT_NATURAL, basePriceName, chainBranches, hopsFrom, onBranch, parseSigSearch, resolveEdges, rockFamiliesIn, sortChainRows, summarize, systemOfNodeText, tagOfNodeText,
  type ChainFilters, type ChainSig, type ChainSort, type ChainSortKey, type SigGroup,
} from '../lib/chain';

/** the table's headings, in column order, with the sort key each carries */
const SORT_COLUMNS: [ChainSortKey, string, string][] = [
  ['hops', 'Jumps', "jumps from the chosen origin, along the map's drawn links"],
  ['system', 'System', ''], ['cls', 'Class', ''], ['group', 'Activity', ''], ['name', 'Site', ''],
  ['value', 'Value', 'if untouched — see the basis'], ['age', 'Age', ''], ['basis', 'Basis', ''],
];
const SORT_KEY = 'etc-chain-sort';
const readSort = (): ChainSort | null => {
  try {
    const j = JSON.parse(localStorage.getItem(SORT_KEY) ?? 'null') as ChainSort | null;
    return j && SORT_COLUMNS.some(([k]) => k === j.key) && (j.dir === 'asc' || j.dir === 'desc') ? j : null;
  } catch { return null; }
};
import { GAS_SITES, KSPACE_COMBAT, KSPACE_GAS, KSPACE_ORE, ORE_SITES, priceableTypeNames } from '../lib/chainTables';
import { haulBasis, haulStats, parseHaulsFile, type Haul } from '../lib/hauls';
import HaulLogger from './HaulLogger';
import { findByName } from '../lib/typedb';
import { fetchAggregates } from '../lib/market';
import { BUILTIN_HUBS } from '../lib/constants';
import { getLocation } from '../lib/esiChar';
import { knownSystem, resolveSystems } from '../lib/systemNames';
import { useAuth } from '../lib/auth';
import { iskShort } from '../lib/format';
import { logInfo, logUser } from '../lib/devlog';
import { GROUP_COLOR, ageBuckets, classColor, iskByHop, layoutChain, normEffect, paletteFromProbe, routeBetween } from '../lib/chainViz';
import WH_SYSTEMS from '../data/whSystems.json';
import ChainDashboard from './ChainDashboard';
import ZoomControl from './ZoomControl';
import { useZoom } from '../lib/zoom';

const HOME_KEY = 'etc-chain-home';
const GROUPS: SigGroup[] = ['Combat', 'Ore', 'Gas', 'Relic', 'Data'];
const CLASSES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'HS', 'LS', 'NS'];

// ---- the filter row's furniture (v0.202.12): every filter is a dim label
// followed by its control(s), all centred on one line, so "jumps ≤", "max
// age", "class", "linked only", "activity" and "ore" read alike. A row
// wraps when the window is narrow; the selects are trimmed to the mini
// buttons' height so nothing sits taller than its neighbours.
const FILTER_ROW: CSSProperties = { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', minHeight: 24 };
const FILTER_SELECT: CSSProperties = { fontSize: 11, padding: '0 6px', height: 28, lineHeight: 1.4, boxSizing: 'border-box' };
function FilterGroup({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
      <span className="dim" title={title} style={{ whiteSpace: 'nowrap' }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>{children}</span>
    </span>
  );
}
const AUTO_MS = 5 * 60_000;

type Extract = ChainExtract & { at?: number };

/** in-tab use (v0.200.12): the Aperture module hands the latest reading
 * straight in and reads the map again on request; no window, no IPC */
export interface ChainSummaryEmbed {
  reading: Extract | null;
  onRefresh: () => void;
  /** the map page is loading or being read right now (v0.202.6) */
  busy?: boolean;
}

export default function ChainSummary({ embedded = null }: { embedded?: ChainSummaryEmbed | null }) {
  const [data, setData] = useState<Extract | null>(null);
  // the "keep the last good list" adopter, reachable from the in-tab effect
  const adoptRef = useRef<(d: Extract) => void>(() => {});
  const [origin, setOrigin] = useState<'home' | 'me'>('home');
  // the home label: "Florida" out of the box (the main process's default
  // when config.json has no such key — v0.201.11, the owner's call), or
  // whatever was typed in Settings → Your setup or here; either way it
  // lands in the file. Cleared on purpose = use the map's own home.
  const [home, setHome] = useState<string>(() => { try { return localStorage.getItem(HOME_KEY) ?? ''; } catch { return ''; } });
  const [homeFromFile, setHomeFromFile] = useState<string | null>(null);
  useEffect(() => {
    void window.appInfo?.config?.read().then((cfg) => {
      const v = typeof cfg?.chainHome === 'string' ? cfg.chainHome.trim() : '';
      setHomeFromFile(v);
      if (v) setHome(v);
    }).catch(() => setHomeFromFile(''));
  }, []);
  // a label typed here is written through to the file once it settles
  useEffect(() => {
    if (homeFromFile === null || home.trim() === homeFromFile) return undefined;
    const t = setTimeout(() => { void window.appInfo?.config?.write({ chainHome: home.trim() }).then(() => setHomeFromFile(home.trim())); }, 800);
    return () => clearTimeout(t);
  }, [home, homeFromFile]);
  // a reading with no table on screen must not blank a good one
  const [stale, setStale] = useState<string>('');
  // a system clicked on the chain drawing: the table and tiles follow it,
  // the drawing itself keeps showing the whole chain
  const [focus, setFocus] = useState<string | null>(null);
  // zoom: the window has its own level; in-tab the Aperture screen's level
  // is applied by the module, so none here
  const { zoom: ownZoom } = useZoom('chain-summary');
  const zoomLevel = embedded ? 1 : ownZoom;
  const [me, setMe] = useState<{ system: string | null; note: string }>({ system: null, note: '' });
  const [prices, setPrices] = useState<Map<string, number> | null>(null);
  /** where this window's own time goes per reading (v0.202.7) — logged once per read */
  const timings = useRef({ summarizeMs: 0, vizMs: 0 });
  // THE PLAYER'S OWN HAULS (v0.201): the estimate for random-loot sites.
  // Loaded from the portable file, written back on every change.
  const [hauls, setHauls] = useState<Haul[]>([]);
  useEffect(() => {
    void window.appInfo?.hauls?.read().then((raw) => setHauls(parseHaulsFile(raw).hauls)).catch(() => setHauls([]));
  }, []);
  const haulAvg = useMemo(() => haulStats(hauls), [hauls]);
  const saveHauls = (next: Haul[]) => {
    setHauls(next);
    void window.appInfo?.hauls?.write({ v: 1, hauls: next });
  };
  /** the row a haul is being logged for */
  const [logging, setLogging] = useState<{ site: string; group: SigGroup; cls: string; system: string } | null>(null);
  const [auto, setAuto] = useState(true);
  const [maxHops, setMaxHops] = useState<number | null>(null);
  const [classes, setClasses] = useState<Set<string>>(() => new Set());
  const [groups, setGroups] = useState<Set<SigGroup>>(() => new Set());
  const [maxAgeH, setMaxAgeH] = useState<number | null>(null);
  // "linked only" (v0.202.2): leave out the systems with no drawn link back
  // to the origin — a view preference, remembered, not cleared with the filters
  const [linkedOnly, setLinkedOnly] = useState<boolean>(() => { try { return localStorage.getItem('etc-chain-linked-only') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('etc-chain-linked-only', linkedOnly ? '1' : '0'); } catch { /* nicety */ } }, [linkedOnly]);
  // rock filter (v0.202.11 — "select gneiss and see a dashboard of all the
  // gneiss and where it is"): families, not grades; empty = no rock filter
  const [rocks, setRocks] = useState<Set<string>>(() => new Set());
  // chain filter (v0.205.0 — "which part of the chain you are interested in roaming
  // through"): the picked systems directly off the origin; empty = the whole chain
  const [branchPick, setBranchPick] = useState<Set<string>>(() => new Set());
  // column sorting (v0.202.5): a heading click sorts its natural way, a
  // second reverses, a third returns to the default order; remembered
  const [sort, setSort] = useState<ChainSort | null>(readSort);
  useEffect(() => { try { if (sort) localStorage.setItem(SORT_KEY, JSON.stringify(sort)); else localStorage.removeItem(SORT_KEY); } catch { /* nicety */ } }, [sort]);
  const cycleSort = (k: ChainSortKey) => setSort((s) => {
    if (!s || s.key !== k) return { key: k, dir: CHAIN_SORT_NATURAL[k] };
    if (s.dir === CHAIN_SORT_NATURAL[k]) return { key: k, dir: s.dir === 'asc' ? 'desc' : 'asc' };
    return null;
  });
  const activeId = useAuth((s) => s.activeId);
  const activeName = useAuth((s) => s.characters.find((c) => c.characterId === s.activeId)?.characterName ?? '');

  // the latest reading, then every new one
  useEffect(() => {
    const good = (x: Extract | null) => !!x && (!!x.sigText || ((x.feedRead?.sigs.length ?? 0) > 0));
    const adopt = (d: Extract) => {
      setData((prev) => {
        // neither the feed nor the panel gave a list: keep the last good
        // one, but take the fresh graph (the chain drawing is always there)
        if (prev && !good(d) && good(prev)) {
          setStale(`neither the map's feed nor its Signature Search panel gave a list at ${d.at ? new Date(d.at).toISOString().slice(11, 16) : 'the last read'} — sites are from the reading of ${prev.at ? new Date(prev.at).toISOString().slice(11, 16) : 'earlier'} EVE`);
          return { ...prev, graph: d.graph, probe: d.probe };
        }
        setStale('');
        return d;
      });
    };
    adoptRef.current = adopt;
    if (embedded) return;                        // in-tab: readings arrive as a prop
    void window.appInfo?.chain?.get().then((d) => { if (d) adopt(d as Extract); });
    window.appInfo?.chain?.onData?.((d) => adopt(d as Extract));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // in-tab: the module's latest reading, and a first read on opening the tab
  const embeddedReading = embedded?.reading ?? null;
  useEffect(() => {
    if (!embedded) return;
    if (embeddedReading) adoptRef.current(embeddedReading);
  }, [embedded, embeddedReading]);
  useEffect(() => {
    if (embedded && !embedded.reading) embedded.onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const refresh = () => {
    logUser('chain: refresh requested');
    if (embedded) embedded.onRefresh(); else window.appInfo?.chain?.refresh();
  };
  useEffect(() => {
    if (!auto) return undefined;
    const t = setInterval(refresh, AUTO_MS);
    return () => clearInterval(t);
  }, [auto]);
  useEffect(() => { try { localStorage.setItem(HOME_KEY, home); } catch { /* nicety */ } }, [home]);

  // prices for every gas and ore the tables can value — one fetch per window
  useEffect(() => {
    const names = priceableTypeNames();
    const ids = names.map((n) => findByName(n)?.id).filter((x): x is number => typeof x === 'number');
    const jita = BUILTIN_HUBS.find((h) => h.id === 'jita') ?? BUILTIN_HUBS[0];
    const t0 = performance.now();
    void fetchAggregates(jita, ids).then((agg) => {
      const m = new Map<string, number>();
      for (const n of names) { const id = findByName(n)?.id; const a = id !== undefined ? agg.get(id) : undefined; if (a?.sell?.min) m.set(n, a.sell.min); }
      // ore variants the type list does not carry take their base ore's
      // price — a floor, a variant yields at least that (v0.202.8)
      let floored = 0;
      for (const n of names) {
        if (m.has(n)) continue;
        const base = basePriceName(n, (x) => m.has(x));
        if (base) { m.set(n, m.get(base)!); floored++; }
      }
      logInfo('chain', 'prices', { ms: Math.round(performance.now() - t0), types: ids.length, priced: m.size - floored, floored });
      setPrices(m);
    }).catch(() => { logInfo('chain', 'prices failed', { ms: Math.round(performance.now() - t0), types: ids.length }); setPrices(new Map()); });
  }, []);

  // the active character's current system, from CCP — the "me" origin and
  // (v0.201.1) the start of the route to a clicked hole, so always read
  useEffect(() => {
    if (!activeId) return;
    let stop = false;
    (async () => {
      try {
        const loc = await getLocation(activeId);
        await resolveSystems([loc.solar_system_id]);
        const name = knownSystem(loc.solar_system_id)?.name ?? null;
        if (!stop) setMe({ system: name, note: name ? '' : 'system name unknown' });
      } catch (e) {
        if (!stop) setMe({ system: null, note: `location unavailable — ${e instanceof Error ? e.message : String(e)}` });
      }
    })();
    return () => { stop = true; };
  }, [activeId, data?.at]);

  const parsed = useMemo(() => {
    if (!data) return null;
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
  }, [data]);

  // home: what was typed / set in Settings, else the map's own home system
  // when its feed names one (v0.200.4 — homeMapSystemId on the real map)
  const feedHome = data?.feedRead?.home?.label ?? '';
  const homeLabel = home.trim() || feedHome;

  /** the origin as a map label: the home name, or the character's system —
   * a J-code the map may label with a custom name, so fall back to a node
   * whose text carries the J-code */
  const originSystem = useMemo(() => {
    if (!parsed) return null;
    // a typed label or an ESI system name may not be the label the graph
    // uses (custom name vs J-code): match it through the drawn node's text
    const viaLabel = (want: string): string | null => {
      if (parsed.systems.has(want)) return want;
      const hit = parsed.nodeText.find((n) => ` ${n.text.replace(/\s+/g, ' ')} `.toLowerCase().includes(` ${want.toLowerCase()} `));
      if (!hit) return null;
      return parsed.nodeSys.get(hit.id) ?? systemOfNodeText(hit.text, [...parsed.systems]).system ?? null;
    };
    if (origin === 'home') {
      const typed = homeLabel ? viaLabel(homeLabel) : null;
      if (typed) return typed;
      // the typed label is not on THIS reading (v0.202.9: a reading taken
      // before the drawing settled labels systems by J-code) — the map's own
      // home is the same system under whatever label this reading uses
      if (feedHome && parsed.systems.has(feedHome)) return feedHome;
      return homeLabel || '';
    }
    if (!me.system) return null;
    return viaLabel(me.system);
  }, [parsed, origin, homeLabel, feedHome, me.system]);

  const hops = useMemo(() => (parsed && originSystem && parsed.edges.length > 0 ? hopsFrom(originSystem, parsed.edges) : null), [parsed, originSystem]);
  /** the parts of the chain: one branch per system directly off the origin */
  const branchInfo = useMemo(() => (parsed && originSystem && parsed.edges.length > 0 ? chainBranches(originSystem, parsed.edges) : null), [parsed, originSystem]);
  // a picked branch that is no longer off the origin (a new reading, a hole that
  // closed, the origin switched to "me") must not keep filtering invisibly
  useEffect(() => {
    if (branchPick.size === 0) return;
    const present = new Set((branchInfo?.branches ?? []).map((b) => b.first));
    if ([...branchPick].every((b) => present.has(b))) return;
    setBranchPick(new Set([...branchPick].filter((b) => present.has(b))));
  }, [branchInfo, branchPick]);
  // ONE view under EVERY filter, the clicked system included (v0.200.11 —
  // "all filters should change the dashboard"): tiles, the cards' numbers,
  // the charts and the table all read this. The drawing keeps every system
  // so the chain stays navigable; systems outside the view read "nothing
  // in view" and stay clickable.
  const summary = useMemo(() => {
    if (!parsed) return null;
    const filters: ChainFilters = { maxHops, classes, groups, maxAgeH, systems: focus ? new Set([focus]) : new Set(), linkedOnly, rocks,
      branches: branchInfo && branchPick.size > 0 ? { picked: branchPick, via: branchInfo.via } : undefined };
    const priceOf = (n: string) => prices?.get(n) ?? null;
    const t0 = performance.now();
    const out = summarize(parsed.sigs, hops, filters, priceOf, { gas: GAS_SITES, ore: ORE_SITES, kcombat: KSPACE_COMBAT, kgas: KSPACE_GAS, kore: KSPACE_ORE,
      hauls: (site, group) => { const a = haulAvg.lookup(site, group); return a ? { isk: a.mean, basis: haulBasis(a, site) } : null; } });
    timings.current.summarizeMs = Math.round(performance.now() - t0);
    return out;
  }, [parsed, focus, hops, maxHops, classes, groups, maxAgeH, prices, haulAvg, linkedOnly, rocks, branchInfo, branchPick]);
  /** the rock families the reading's ore sites carry — one chip each */
  const rockChips = useMemo(() => (parsed ? rockFamiliesIn(parsed.sigs, { ore: ORE_SITES, kore: KSPACE_ORE }) : []), [parsed]);
  // a chip whose rock left the reading (a new map read) must not keep
  // filtering invisibly
  useEffect(() => {
    if (rocks.size === 0) return;
    const present = new Set(rockChips.map((r) => r.family));
    if ([...rocks].every((r) => present.has(r))) return;
    setRocks(new Set([...rocks].filter((r) => present.has(r))));
  }, [rockChips, rocks]);
  const pickRock = (family: string) => {
    toggle(rocks, family, setRocks);
    // a rock filter means ore sites; an activity filter that leaves ore out
    // would show nothing, so it is lifted
    if (groups.size > 0 && !groups.has('Ore')) setGroups(new Set());
  };
  /** every system on the map with no drawn link back to the origin */
  const unlinkedAll = useMemo(() => (parsed && hops ? [...parsed.systems].filter((s) => !hops.has(s)) : []), [parsed, hops]);
  /** the table's rows in the chosen column order (the summary's own order when none) */
  const rowsShown = useMemo(() => (summary ? sortChainRows(summary.rows, sort) : []), [summary, sort]);
  const viz = useMemo(() => {
    if (!parsed || !summary) return null;
    const rows = summary.rows.map((r) => ({ system: r.system, cls: r.cls, group: r.group, hops: r.hops, isk: r.value.isk, ageH: r.ageH }));
    // "linked only" drops the unlinked systems from the drawing too
    // the chain filter does NOT take systems off the drawing (v0.205.1, the owner: "it should
    // not hide things it should dim them like we do for other filters"): a system off the
    // picked branch has nothing in view, so the drawing dims it like any other filter does
    const drawn = linkedOnly && hops ? [...parsed.systems].filter((s) => hops.has(s)) : [...parsed.systems];
    const systems = drawn.map((s) => ({ system: s, cls: parsed.clsOf.get(s) ?? '', tag: parsed.tagOf.get(s) ?? '', effect: parsed.effectOf.get(s) ?? '', shattered: parsed.shattered.has(s) }));
    const t0 = performance.now();
    const out = {
      layout: layoutChain(systems, parsed.edges, hops ?? new Map(), rows),
      bars: iskByHop(rows),
      ages: ageBuckets(rows),
      offChain: rows.filter((r) => r.hops === null).length,
      unlinkedHidden: parsed.systems.size - drawn.length,
    };
    timings.current.vizMs = Math.round(performance.now() - t0);
    return out;
  }, [parsed, summary, hops, linkedOnly, branchInfo, branchPick, originSystem]);
  // one line per NEW reading with where this window's time went
  useEffect(() => {
    if (!data || !summary) return;
    logInfo('chain', 'summary computed', {
      ...timings.current, sigs: parsed?.sigs.length ?? 0, rows: summary.rows.length, systems: parsed?.systems.size ?? 0,
      // why rows may be missing (v0.202.9)
      hiddenUnlinked: summary.hiddenUnlinked, hiddenNoHops: summary.hiddenNoHops, hiddenNoClass: summary.hiddenNoClass, hiddenNoRock: summary.hiddenNoRock,
      origin: originSystem, originOk, hops: hops?.size ?? null, edges: parsed?.edges.length ?? 0, drawnNodes: data.graph.nodes.length, linkedOnly, maxHops,
      rocks: rocks.size > 0 ? [...rocks] : undefined, rockChips: rockChips.length,
      branches: branchInfo?.branches.length ?? 0, branchesPicked: branchPick.size, hiddenOffBranch: summary.hiddenOffBranch,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.at]);

  // THE ROUTE (v0.201.1): from the active character's system to the clicked
  // hole, over the chain's links; the character's system is mapped to the
  // graph's label the same way the "me" origin is
  const meLabel = useMemo(() => {
    if (!parsed || !me.system) return null;
    if (parsed.systems.has(me.system)) return me.system;
    const hit = parsed.nodeText.find((n) => ` ${n.text.replace(/\s+/g, ' ')} `.toLowerCase().includes(` ${me.system!.toLowerCase()} `));
    return hit ? parsed.nodeSys.get(hit.id) ?? null : null;
  }, [parsed, me.system]);
  // two routes (v0.201.3): the whole way back to the ORIGIN (home, or the
  // character when that origin is chosen), and the character's own way
  // there when they are somewhere else on the chain
  const routeHome = useMemo(() => (parsed && focus && originSystem ? routeBetween(originSystem, focus, parsed.edges) : null), [parsed, focus, originSystem]);
  const routeMe = useMemo(() => (parsed && focus && meLabel && meLabel !== originSystem ? routeBetween(meLabel, focus, parsed.edges) : null), [parsed, focus, meLabel, originSystem]);
  const routeNote = !focus ? '' : !activeId ? 'log a character in to see your own route' : !me.system ? (me.note || 'locating your character…') : !meLabel ? `${activeName} is in ${me.system}, which is not on this chain` : meLabel === originSystem ? `${activeName} is at ${originSystem}` : routeMe ? '' : `${meLabel} is not connected to ${focus} on this chain`;

  const toggle = <T,>(set: Set<T>, v: T, setter: (s: Set<T>) => void) => { const n = new Set(set); if (n.has(v)) n.delete(v); else n.add(v); setter(n); };
  /** anything narrowing the view — the ✕ clear filters button is live only then */
  const anyFilter = maxHops !== null || classes.size > 0 || groups.size > 0 || maxAgeH !== null || !!focus || rocks.size > 0 || branchPick.size > 0;
  const originOk = !!originSystem && (!parsed || parsed.systems.has(originSystem) || (hops?.has(originSystem) ?? false));
  const graphReadable = !!parsed && parsed.edges.length > 0;

  // SELF-HEAL (v0.202.9): a reading with no signature list, or one on which
  // the origin cannot be placed (nothing linked), must not leave the tab
  // empty until the 5-minute timer — "most users won't troubleshoot, it
  // just needs to work". Ask the map for another reading in a few seconds,
  // say so on screen, and give up loudly (with what to do) after a dozen.
  const healTries = useRef<{ at: number; n: number; total: number }>({ at: 0, n: 0, total: 0 });
  const [healing, setHealing] = useState('');
  // the module hands a fresh `embedded` object on every render; the effect
  // keys on the facts, not on that identity, or a re-render would count as
  // a try
  const onRefreshRef = useRef<(() => void) | null>(null);
  onRefreshRef.current = embedded?.onRefresh ?? null;
  const inTab = !!embedded;
  useEffect(() => {
    if (!inTab || !data) return undefined;
    const sigs = parsed?.sigs.length ?? 0;
    const empty = sigs === 0;
    const unplaced = !!summary && sigs > 0 && summary.rows.length === 0 && (summary.hiddenUnlinked + summary.hiddenNoHops) >= sigs * 0.5;
    const lost = !!parsed && sigs > 0 && !originOk;
    if (!empty && !unplaced && !lost) { setHealing(''); return undefined; }
    const key = data.at ?? 0;
    if (healTries.current.at !== key) healTries.current = { ...healTries.current, at: key, n: 0 };
    if (healTries.current.n >= 3 || healTries.current.total >= 12) {
      setHealing(empty
        ? 'the map gave no signature list — log in on the Corp Map tab if it asks, then press ⟳ refresh'
        : 'the origin could not be placed on the map from this reading — press ⟳ refresh once the map has drawn, or check the home label');
      return undefined;
    }
    healTries.current.n++; healTries.current.total++;
    setHealing(empty ? 'the map has not answered with its signature list yet — reading again…' : 'the map\'s drawing had not settled when it was read — reading again…');
    logInfo('chain', 'self-heal read', { why: empty ? 'no sigs' : unplaced ? 'nothing placed' : 'origin lost', sigs, rows: summary?.rows.length ?? 0, origin: originSystem, n: healTries.current.total });
    const t = window.setTimeout(() => onRefreshRef.current?.(), 3000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inTab, data?.at, summary?.rows.length, parsed?.sigs.length, originOk]);

  return (
    <div className="chain-root" style={embedded ? { padding: 14, boxSizing: 'border-box' } : { padding: 14, minHeight: '100vh', boxSizing: 'border-box', zoom: zoomLevel }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Chain summary</h1>
        <span className="dim" style={{ fontSize: 12 }}>
          {data ? `map read ${data.at ? new Date(data.at).toISOString().slice(11, 16) : ''} EVE · ${parsed?.sigs.length ?? 0} signatures · ${parsed?.nodeCount ?? 0} systems drawn · source: ${parsed?.source ?? '—'}` : embedded ? (embedded.busy ? 'reading the map… (the map page is loading; a few seconds)' : 'waiting for the map — log in on the Corp Map tab if it asks, or press ⟳ refresh') :'waiting for the map — press Summary on the Aperture module'}
        </span>
        {stale && <span style={{ fontSize: 12, color: 'var(--warn, #e0a13a)', flexBasis: '100%' }}>⚠ {stale}</span>}
        {healing && <span style={{ fontSize: 12, color: 'var(--warn, #e0a13a)', flexBasis: '100%' }}>⟳ {healing}</span>}
        {!stale && data && !data.sigText && !(data.feedRead && data.feedRead.sigs.length > 0) && data.probe?.tableVisible === false && (
          <span style={{ fontSize: 12, color: 'var(--warn, #e0a13a)', flexBasis: '100%' }}>⚠ the map's Signature Search panel is not on screen — open it on the map once (any filter) and the list appears here; the app never changes what the map shows</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          <label style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
            <input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> re-read every 5 min
          </label>
          <button className="btn mini" onClick={refresh} title="ask the map for a fresh reading now">⟳ refresh</button>
          {!embedded && <ZoomControl screen="chain-summary" compact />}
        </span>
      </div>

      {/* ---- origin ---- */}
      <div className="panel" style={{ padding: 10, marginBottom: 8 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <span className="dim">distance counted from</span>
          <button className={`btn mini${origin === 'home' ? ' primary' : ''}`} onClick={() => setOrigin('home')}>🏠 home</button>
          <input type="text" value={home} onChange={(e) => setHome(e.target.value)} style={{ width: 120, fontSize: 12 }}
            placeholder={feedHome ? `${feedHome} (from the map)` : 'home, as the map labels it'} title={feedHome ? `the map names ${feedHome} as home — clear this field to follow the map, or type a label to override it` : "the map's home system, as the map labels it — Florida unless you change it"} />
          <button className={`btn mini${origin === 'me' ? ' primary' : ''}`} onClick={() => setOrigin('me')} disabled={!activeId}
            title={activeId ? `${activeName}'s current system, from CCP` : 'log a character in first'}>🧍 me{activeName ? ` · ${activeName}` : ''}</button>
          {origin === 'me' && <span className="dim" style={{ fontSize: 12 }}>{me.system ? `in ${me.system}` : me.note || 'locating…'}</span>}
          <span className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {!parsed ? '' : !graphReadable ? '⚠ chain links not readable from this map yet — distances unavailable (structure recorded in Diagnostics)'
              : origin === 'home' && !homeLabel ? '⚠ type your home system\'s label (as the map shows it) to count distances'
              : !originOk ? `⚠ "${originSystem ?? '?'}" is not on the map — distances unavailable`
                : `${hops?.size ?? 0} systems linked to ${originSystem} over ${parsed.edges.length} links${unlinkedAll.length > 0 ? ` · ${unlinkedAll.length} on the map but not linked (${unlinkedAll.slice(0, 4).join(', ')}${unlinkedAll.length > 4 ? '…' : ''})${linkedOnly ? ' · hidden' : ''}` : ''}${summary && summary.unreachable > 0 ? ` · ${summary.unreachable} site(s) there carry no distance` : ''}`}
            {summary && (summary.hiddenNoClass > 0 || summary.hiddenNoHops > 0 || summary.hiddenUnlinked > 0 || summary.hiddenNoRock > 0) && (
              <> · <span title="rows the filters dropped only because the map showed no class, no distance could be counted, or an ore site's contents are not in the tables">
                {[summary.hiddenNoClass > 0 ? `${summary.hiddenNoClass} hidden (no class)` : '', summary.hiddenNoHops > 0 ? `${summary.hiddenNoHops} hidden (no distance)` : '', summary.hiddenUnlinked > 0 ? `${summary.hiddenUnlinked} hidden (not linked)` : '', summary.hiddenNoRock > 0 ? `${summary.hiddenNoRock} ore site${summary.hiddenNoRock === 1 ? '' : 's'} hidden (contents unknown)` : ''].filter(Boolean).join(' · ')}
              </span></>
            )}
          </span>
        </div>
      </div>

      {/* ---- tiles ---- */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        {GROUPS.map((g) => {
          const t = summary?.byGroup[g];
          return (
            <div key={g} className="panel" style={{ flex: '1 1 150px', padding: '8px 10px', borderTop: `3px solid ${GROUP_COLOR[g]}` }}>
              <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{g === 'Ore' && rocks.size > 0 ? `Ore · ${[...rocks].join(' + ')}` : g}</div>
              <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{t && t.isk > 0 ? iskShort(t.isk) : t && t.count > 0 ? '—' : '0'}</div>
              <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>{t ? `${t.count} site${t.count === 1 ? '' : 's'}${t.unvalued > 0 ? ` · ${t.unvalued} without an estimate` : ''}` : ''}</div>
            </div>
          );
        })}
        <div className="panel" style={{ flex: '1 1 150px', padding: '8px 10px', borderTop: '3px solid var(--accent)' }}>
          <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>on field · if untouched</div>
          <div style={{ fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' }}>{summary ? iskShort(summary.totalIsk) : '—'}</div>
          <div style={{ fontSize: 11, color: 'var(--ink-2)' }}>{summary ? `${summary.rows.length} sites in view` : ''}</div>
        </div>
      </div>

      {/* ---- filters (v0.202.2: between the tiles and the drawing, where the
           eye goes; every filter drives the tiles, the drawing and the table) ---- */}
      <div className="panel chain-filters" style={{ padding: '8px 10px', marginBottom: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
        {/* row 1 (v0.202.12 layout): jumps · max age · class · linked only,
            with ✕ clear filters pinned to the top-right corner */}
        <div style={FILTER_ROW}>
          <FilterGroup label="jumps ≤">
            <select value={maxHops ?? ''} onChange={(e) => setMaxHops(e.target.value === '' ? null : Number(e.target.value))} style={FILTER_SELECT}>
              <option value="">any</option>
              {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </FilterGroup>
          <FilterGroup label="max age">
            <select value={maxAgeH ?? ''} onChange={(e) => setMaxAgeH(e.target.value === '' ? null : Number(e.target.value))} style={FILTER_SELECT}>
              <option value="">any</option>
              <option value="1">1 h</option><option value="3">3 h</option><option value="6">6 h</option><option value="12">12 h</option><option value="24">24 h</option>
            </select>
          </FilterGroup>
          <FilterGroup label="class" title={classes.size === 0 ? 'all classes shown — click one to narrow' : undefined}>
            {CLASSES.map((c) => (
              <button key={c} className={`btn mini${classes.has(c) ? ' on' : ''}`} onClick={() => toggle(classes, c, setClasses)}
                style={{ color: classColor(c), borderColor: classes.has(c) ? classColor(c) : undefined, fontWeight: 700 }}>{c}</button>
            ))}
          </FilterGroup>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
            title={`Leave out the systems that are on the map but have no drawn link back to ${originSystem || 'the origin'} — they carry no distance. Their sites leave the tiles and the table and the dashed column leaves the drawing. Remembered.`}>
            <input type="checkbox" checked={linkedOnly} onChange={(e) => setLinkedOnly(e.target.checked)} style={{ margin: 0 }} />
            <span className="dim" style={{ whiteSpace: 'nowrap' }}>linked only{unlinkedAll.length > 0 ? ` (${unlinkedAll.length} unlinked)` : ''}</span>
          </label>
          <button className="btn mini" disabled={!anyFilter} style={{ marginLeft: 'auto', opacity: anyFilter ? 1 : 0.45, height: 28, boxSizing: 'border-box', lineHeight: 1 }}
            title={anyFilter ? 'back to every site in the chain' : 'no filter set'}
            onClick={() => { setMaxHops(null); setClasses(new Set()); setGroups(new Set()); setMaxAgeH(null); setFocus(null); setRocks(new Set()); setBranchPick(new Set()); }}>✕ clear filters{focus ? ' & focus' : ''}</button>
        </div>
        {/* the chain row (v0.205.0): one chip per system directly off the origin — pick one
            or several and only what lies down those parts of the chain stays: tiles, table,
            charts, and the drawing itself. A system two branches reach equally fast is on both. */}
        {branchInfo && branchInfo.branches.length > 0 && (
          <div style={FILTER_ROW}>
            <FilterGroup label="chain" title={`Which part of the chain to look at: each chip is a system directly off ${originSystem || 'the origin'}, and stands for it and everything beyond it. Pick one or several; the rest of the chain leaves the view. ${originSystem || 'The origin'}'s own sites are down no branch.`}>
              {branchInfo.branches.map((b) => {
                const cls = parsed?.clsOf.get(b.first) ?? '';
                // the map's per-system letter rides with the class, as on the cards: "C4B", not "C4"
                const tag = parsed?.tagOf.get(b.first) ?? '';
                const badge = cls ? `${cls}${/^[A-Za-z0-9]$/.test(tag) ? tag : ''}` : '';
                const on = branchPick.has(b.first);
                const sites = parsed ? parsed.sigs.filter((s) => s.group !== 'Wormhole' && onBranch(s.system, new Set([b.first]), branchInfo.via)).length : 0;
                return (
                  <button key={b.first} className={`btn mini${on ? ' on' : ''}`} onClick={() => toggle(branchPick, b.first, setBranchPick)}
                    style={{ borderColor: on ? classColor(cls) : undefined }}
                    title={`${b.first}${badge ? ` (${badge})` : ''} and what lies beyond it: ${b.systems.length} system${b.systems.length === 1 ? '' : 's'}, ${sites} site${sites === 1 ? '' : 's'} — ${b.systems.slice(0, 8).join(' · ')}${b.systems.length > 8 ? ' …' : ''}`}>
                    {badge && <b style={{ color: classColor(cls), marginRight: 4 }}>{badge}</b>}{b.first}<span className="dim" style={{ marginLeft: 4, fontWeight: 400 }}>{b.systems.length}</span>
                  </button>
                );
              })}
            </FilterGroup>
            {summary && branchPick.size > 0 && summary.hiddenOffBranch > 0 && (
              <span className="dim" style={{ fontSize: 11.5 }}>{summary.hiddenOffBranch} site{summary.hiddenOffBranch === 1 ? '' : 's'} elsewhere in the chain left out</span>
            )}
          </div>
        )}
        {/* row 2: activity · ore (v0.202.11: one chip per rock family the
            reading's ore sites carry, grades and variants folded together; a
            picked rock narrows the view to the ore sites holding it, valued
            on that rock alone — the drawing dims every other system) */}
        <div style={FILTER_ROW}>
          <FilterGroup label="activity">
            {GROUPS.map((g) => (
              <button key={g} className={`btn mini${groups.has(g) ? ' on' : ''}`} style={{ borderColor: groups.has(g) ? GROUP_COLOR[g] : undefined }}
                onClick={() => toggle(groups, g, setGroups)}>{g}</button>
            ))}
          </FilterGroup>
          {rockChips.length > 0 && (
            <FilterGroup label="ore" title="Only the ore sites that carry a picked rock stay in view — any grade or variant of it — and each site's value becomes that rock's share alone. Pick several to see them together.">
              {rockChips.map((r) => (
                <button key={r.family} className={`btn mini${rocks.has(r.family) ? ' on' : ''}`} style={{ borderColor: rocks.has(r.family) ? GROUP_COLOR.Ore : undefined }}
                  onClick={() => pickRock(r.family)}
                  title={`${r.family} · in ${r.sites} ore site${r.sites === 1 ? '' : 's'} · ${r.units.toLocaleString()} units in total, any grade`}>
                  {r.family}<span className="dim" style={{ marginLeft: 3, fontWeight: 400 }}>{r.sites}</span>
                </button>
              ))}
            </FilterGroup>
          )}
        </div>
      </div>

      {/* ---- the dashboard ---- */}
      {viz && summary && (
        <ChainDashboard
          origin={originSystem ?? ''} layout={viz.layout} bars={viz.bars} ages={viz.ages} byGroup={summary.byGroup}
          focus={focus} onFocus={setFocus} maxHops={maxHops} onMaxHops={setMaxHops} offChain={viz.offChain} unlinkedHidden={viz.unlinkedHidden}
          routeHome={routeHome} routeMe={routeMe} routeNote={routeNote} routeFrom={activeName || 'you'} originLabel={originSystem ?? ''} effectOf={parsed?.effectOf ?? new Map()} tagOf={parsed?.tagOf ?? new Map()} clsOf={parsed?.clsOf ?? new Map()} palette={parsed?.palette ?? null} shattered={parsed?.shattered ?? new Set()}
          note={!graphReadable ? 'the chain links could not be read from the map — distances and the drawing need them' : !originOk ? `"${originSystem ?? '?'}" is not on the map` : ''}
        />
      )}

      {/* ---- log a haul (v0.201) ---- */}
      {logging && (
        <HaulLogger target={logging} hauls={hauls} activeId={activeId}
          onSave={(h) => { saveHauls([...hauls, h]); setLogging(null); }}
          onDelete={(id) => saveHauls(hauls.filter((h) => h.id !== id))}
          onClose={() => setLogging(null)} />
      )}

      {/* ---- the table ---- */}
      <div className="panel" style={{ padding: 0, overflow: 'auto', maxHeight: '56vh' }}>
        <table className="data chain-table" style={{ fontSize: 12.5 }}>
          <thead>
            <tr>
              {SORT_COLUMNS.map(([k, label, title]) => {
                const on = sort?.key === k;
                const hint = !on ? 'click to sort' : sort!.dir === CHAIN_SORT_NATURAL[k] ? 'click again to reverse' : 'click again for the default order (nearest, then richest)';
                return (
                  <th key={k} onClick={() => cycleSort(k)} aria-sort={on ? (sort!.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', color: on ? 'var(--accent)' : undefined }}
                    title={`${title ? `${title} · ` : ''}${hint}`}>
                    {label}{on ? <span style={{ marginLeft: 4, fontSize: 10 }}>{sort!.dir === 'asc' ? '▲' : '▼'}</span> : null}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rowsShown.map((r) => (
              <tr key={`${r.system}-${r.sig}`}>
                <td style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>{r.hops ?? <span className="dim">?</span>}</td>
                <td>{r.system}</td>
                <td style={{ color: r.cls ? classColor(r.cls) : undefined, fontWeight: r.cls ? 700 : undefined }}>{r.cls ? <>{r.cls}{parsed?.tagOf.get(r.system) ? <span className="dim">{parsed.tagOf.get(r.system)}</span> : null}</> : <span className="dim">—</span>}</td>
                <td style={{ color: GROUP_COLOR[r.group] }}>{r.group}</td>
                <td>
                  {r.name || <span className="dim">unscanned</span>} <span className="dim" style={{ fontSize: 11 }}>{r.sig}</span>
                  {r.name && (r.group === 'Relic' || r.group === 'Data' || r.value.isk === null || /your average/.test(r.value.basis)) && (
                    <button className="btn mini" style={{ marginLeft: 6, padding: '0 5px', fontSize: 10.5 }}
                      title="Log what you pulled out of this site — paste the loot from your inventory, or type the ISK — and the estimate becomes your own running average"
                      onClick={() => setLogging({ site: r.name, group: r.group, cls: r.cls, system: r.system })}>＋ haul</button>
                  )}
                </td>
                <td style={{ fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}>{r.value.isk !== null ? iskShort(r.value.isk) : <span className="dim">—</span>}</td>
                <td className="dim">{r.ageH === null ? '—' : r.ageH < 1 ? `${Math.round(r.ageH * 60)}m` : `${Math.round(r.ageH)}h`}</td>
                <td className="dim" style={{ fontSize: 11, maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={r.value.basis}>{r.value.basis}</td>
              </tr>
            ))}
            {summary && summary.rows.length === 0 && (
              <tr><td colSpan={8} className="dim" style={{ padding: 12 }}>{healing ? `⟳ ${healing}` : parsed && parsed.sigs.length > 0
                ? `nothing matches the filters${summary.hiddenNoClass > 0 ? ` — ${summary.hiddenNoClass} row(s) have no class on the map` : ''}${summary.hiddenNoHops > 0 ? ` — ${summary.hiddenNoHops} row(s) have no distance (chain links unread, or the system is not connected to the origin)` : ''}${rocks.size > 0 ? ` — no ore site in view carries ${[...rocks].join(' or ')}${summary.hiddenNoRock > 0 ? ` (${summary.hiddenNoRock} ore site(s) have contents the tables do not know)` : ''}` : ''}`
                : 'no signatures read from the map — is the Signature Search panel showing all types and classes?'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="hint" style={{ marginTop: 8, fontSize: 11.5 }}>
        Values are <b>if untouched</b>: sleeper combat sites at their blue-loot totals, gas and ore sites at their published contents × live Jita sell.
        Nothing here can tell a fresh site from a half-run one. Relic, data and k-space combat sites are counted, not priced. Everything is read
        from your own map through your own login; the map's Signature Search filters apply to what it shows, so keep it on all types and classes.
      </div>
    </div>
  );
}
