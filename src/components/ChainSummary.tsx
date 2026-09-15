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
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChainExtract } from '../lib/apertureExtract';
import {
  hopsFrom, parseSigSearch, resolveEdges, summarize, systemOfNodeText, tagOfNodeText,
  type ChainFilters, type ChainSig, type SigGroup,
} from '../lib/chain';
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
import { logUser } from '../lib/devlog';
import { GROUP_COLOR, ageBuckets, classColor, iskByHop, layoutChain, normEffect, paletteFromProbe, routeBetween } from '../lib/chainViz';
import WH_SYSTEMS from '../data/whSystems.json';
import ChainDashboard from './ChainDashboard';
import ZoomControl from './ZoomControl';
import { useZoom } from '../lib/zoom';

const HOME_KEY = 'etc-chain-home';
const GROUPS: SigGroup[] = ['Combat', 'Ore', 'Gas', 'Relic', 'Data'];
const CLASSES = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'HS', 'LS', 'NS'];
const AUTO_MS = 5 * 60_000;

type Extract = ChainExtract & { at?: number };

/** in-tab use (v0.200.12): the Aperture module hands the latest reading
 * straight in and reads the map again on request; no window, no IPC */
export interface ChainSummaryEmbed {
  reading: Extract | null;
  onRefresh: () => void;
}

export default function ChainSummary({ embedded = null }: { embedded?: ChainSummaryEmbed | null }) {
  const [data, setData] = useState<Extract | null>(null);
  // the "keep the last good list" adopter, reachable from the in-tab effect
  const adoptRef = useRef<(d: Extract) => void>(() => {});
  const [origin, setOrigin] = useState<'home' | 'me'>('home');
  // the home label is per-player setup (the map's own custom name for the
  // corp's home): prefilled from config.json (Settings → Your setup, or
  // typed here — either way it lands in the file, never in code)
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
    void fetchAggregates(jita, ids).then((agg) => {
      const m = new Map<string, number>();
      for (const n of names) { const id = findByName(n)?.id; const a = id !== undefined ? agg.get(id) : undefined; if (a?.sell?.min) m.set(n, a.sell.min); }
      setPrices(m);
    }).catch(() => setPrices(new Map()));
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
    if (origin === 'home') return homeLabel ? viaLabel(homeLabel) ?? homeLabel : '';
    if (!me.system) return null;
    return viaLabel(me.system);
  }, [parsed, origin, homeLabel, me.system]);

  const hops = useMemo(() => (parsed && originSystem && parsed.edges.length > 0 ? hopsFrom(originSystem, parsed.edges) : null), [parsed, originSystem]);
  // ONE view under EVERY filter, the clicked system included (v0.200.11 —
  // "all filters should change the dashboard"): tiles, the cards' numbers,
  // the charts and the table all read this. The drawing keeps every system
  // so the chain stays navigable; systems outside the view read "nothing
  // in view" and stay clickable.
  const summary = useMemo(() => {
    if (!parsed) return null;
    const filters: ChainFilters = { maxHops, classes, groups, maxAgeH, systems: focus ? new Set([focus]) : new Set() };
    const priceOf = (n: string) => prices?.get(n) ?? null;
    return summarize(parsed.sigs, hops, filters, priceOf, { gas: GAS_SITES, ore: ORE_SITES, kcombat: KSPACE_COMBAT, kgas: KSPACE_GAS, kore: KSPACE_ORE,
      hauls: (site, group) => { const a = haulAvg.lookup(site, group); return a ? { isk: a.mean, basis: haulBasis(a, site) } : null; } });
  }, [parsed, focus, hops, maxHops, classes, groups, maxAgeH, prices, haulAvg]);
  const viz = useMemo(() => {
    if (!parsed || !summary) return null;
    const rows = summary.rows.map((r) => ({ system: r.system, cls: r.cls, group: r.group, hops: r.hops, isk: r.value.isk, ageH: r.ageH }));
    const systems = [...parsed.systems].map((s) => ({ system: s, cls: parsed.clsOf.get(s) ?? '', tag: parsed.tagOf.get(s) ?? '', effect: parsed.effectOf.get(s) ?? '', shattered: parsed.shattered.has(s) }));
    return {
      layout: layoutChain(systems, parsed.edges, hops ?? new Map(), rows),
      bars: iskByHop(rows),
      ages: ageBuckets(rows),
      offChain: rows.filter((r) => r.hops === null).length,
    };
  }, [parsed, summary, hops]);

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
  const originOk = !!originSystem && (!parsed || parsed.systems.has(originSystem) || (hops?.has(originSystem) ?? false));
  const graphReadable = !!parsed && parsed.edges.length > 0;

  return (
    <div className="chain-root" style={embedded ? { padding: 14, boxSizing: 'border-box' } : { padding: 14, minHeight: '100vh', boxSizing: 'border-box', zoom: zoomLevel }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Chain summary</h1>
        <span className="dim" style={{ fontSize: 12 }}>
          {data ? `map read ${data.at ? new Date(data.at).toISOString().slice(11, 16) : ''} EVE · ${parsed?.sigs.length ?? 0} signatures · ${parsed?.nodeCount ?? 0} systems drawn · source: ${parsed?.source ?? '—'}` : embedded ? 'reading the map… (log in on the Corp Map tab first if it asks)' : 'waiting for the map — press Summary on the Aperture module'}
        </span>
        {stale && <span style={{ fontSize: 12, color: 'var(--warn, #e0a13a)', flexBasis: '100%' }}>⚠ {stale}</span>}
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
            placeholder={feedHome ? `${feedHome} (from the map)` : 'home, as the map labels it'} title={feedHome ? `the map names ${feedHome} as home — type a label only to override it` : "the map's home system, as the map labels it — typed once, remembered"} />
          <button className={`btn mini${origin === 'me' ? ' primary' : ''}`} onClick={() => setOrigin('me')} disabled={!activeId}
            title={activeId ? `${activeName}'s current system, from CCP` : 'log a character in first'}>🧍 me{activeName ? ` · ${activeName}` : ''}</button>
          {origin === 'me' && <span className="dim" style={{ fontSize: 12 }}>{me.system ? `in ${me.system}` : me.note || 'locating…'}</span>}
          <span className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>
            {!parsed ? '' : !graphReadable ? '⚠ chain links not readable from this map yet — distances unavailable (structure recorded in Diagnostics)'
              : origin === 'home' && !homeLabel ? '⚠ type your home system\'s label (as the map shows it) to count distances'
              : !originOk ? `⚠ "${originSystem ?? '?'}" is not on the map — distances unavailable`
                : `${hops?.size ?? 0} systems linked to ${originSystem} over ${parsed.edges.length} links${viz && viz.layout.unlinked.length > 0 ? ` · ${viz.layout.unlinked.length} on the map but not linked (${viz.layout.unlinked.slice(0, 4).join(', ')}${viz.layout.unlinked.length > 4 ? '…' : ''})` : ''}${summary && summary.unreachable > 0 ? ` · ${summary.unreachable} site(s) there carry no distance` : ''}`}
            {summary && (summary.hiddenNoClass > 0 || summary.hiddenNoHops > 0) && (
              <> · <span title="rows the filters dropped only because the map showed no class, or no distance could be counted">
                {[summary.hiddenNoClass > 0 ? `${summary.hiddenNoClass} hidden (no class)` : '', summary.hiddenNoHops > 0 ? `${summary.hiddenNoHops} hidden (no distance)` : ''].filter(Boolean).join(' · ')}
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
              <div style={{ fontSize: 11, color: 'var(--ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{g}</div>
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

      {/* ---- the dashboard ---- */}
      {viz && summary && (
        <ChainDashboard
          origin={originSystem ?? ''} layout={viz.layout} bars={viz.bars} ages={viz.ages} byGroup={summary.byGroup}
          focus={focus} onFocus={setFocus} maxHops={maxHops} onMaxHops={setMaxHops} offChain={viz.offChain}
          routeHome={routeHome} routeMe={routeMe} routeNote={routeNote} routeFrom={activeName || 'you'} originLabel={originSystem ?? ''} effectOf={parsed?.effectOf ?? new Map()} tagOf={parsed?.tagOf ?? new Map()} clsOf={parsed?.clsOf ?? new Map()} palette={parsed?.palette ?? null} shattered={parsed?.shattered ?? new Set()}
          note={!graphReadable ? 'the chain links could not be read from the map — distances and the drawing need them' : !originOk ? `"${originSystem ?? '?'}" is not on the map` : ''}
        />
      )}

      {/* ---- filters ---- */}
      <div className="panel" style={{ padding: 10, marginBottom: 8, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12 }}>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          jumps ≤
          <select value={maxHops ?? ''} onChange={(e) => setMaxHops(e.target.value === '' ? null : Number(e.target.value))} style={{ fontSize: 12 }}>
            <option value="">any</option>
            {[0, 1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <span style={{ display: 'flex', gap: 3 }}>
          <span className="dim">class</span>
          {CLASSES.map((c) => (
            <button key={c} className={`btn mini${classes.has(c) ? ' on' : ''}`} onClick={() => toggle(classes, c, setClasses)}
              style={{ color: classColor(c), borderColor: classes.has(c) ? classColor(c) : undefined, fontWeight: 700 }}
              title={classes.size === 0 ? 'all classes shown — click to narrow' : undefined}>{c}</button>
          ))}
        </span>
        <span style={{ display: 'flex', gap: 3 }}>
          <span className="dim">activity</span>
          {GROUPS.map((g) => (
            <button key={g} className={`btn mini${groups.has(g) ? ' on' : ''}`} style={{ borderColor: groups.has(g) ? GROUP_COLOR[g] : undefined }}
              onClick={() => toggle(groups, g, setGroups)}>{g}</button>
          ))}
        </span>
        <label style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          max age
          <select value={maxAgeH ?? ''} onChange={(e) => setMaxAgeH(e.target.value === '' ? null : Number(e.target.value))} style={{ fontSize: 12 }}>
            <option value="">any</option>
            <option value="1">1 h</option><option value="3">3 h</option><option value="6">6 h</option><option value="12">12 h</option><option value="24">24 h</option>
          </select>
        </label>
        {(maxHops !== null || classes.size > 0 || groups.size > 0 || maxAgeH !== null || focus) && (
          <button className="btn mini" onClick={() => { setMaxHops(null); setClasses(new Set()); setGroups(new Set()); setMaxAgeH(null); setFocus(null); }}>✕ clear filters{focus ? ' & focus' : ''}</button>
        )}
      </div>

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
              <th title="jumps from the chosen origin, along the map's drawn links">Jumps</th><th>System</th><th>Class</th><th>Activity</th><th>Site</th>
              <th title="if untouched — see the basis">Value</th><th>Age</th><th>Basis</th>
            </tr>
          </thead>
          <tbody>
            {summary?.rows.map((r) => (
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
              <tr><td colSpan={8} className="dim" style={{ padding: 12 }}>{parsed && parsed.sigs.length > 0
                ? `nothing matches the filters${summary.hiddenNoClass > 0 ? ` — ${summary.hiddenNoClass} row(s) have no class on the map` : ''}${summary.hiddenNoHops > 0 ? ` — ${summary.hiddenNoHops} row(s) have no distance (chain links unread, or the system is not connected to the origin)` : ''}`
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
