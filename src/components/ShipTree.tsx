// SHIP TREE — the in-game ship tree's SHAPE, from the SDE's own data:
//   · faction picker = compact grid of faction crests, top-left (like ISIS)
//   · a PAN/ZOOM canvas like the game: fits itself to the pane on open,
//     mouse wheel zooms around the cursor, drag moves the tree
//   · T1 hulls sit on a horizontal SPINE (frig → dess → cru → bc → bs →
//     industrials); specializations CLIMB vertically above their class,
//     every tier captioned with its REAL market sub-group name (Navy
//     Frigates, Interceptors, Transport Ships, Lancer Dreadnoughts, …)
//   · the industrial column owns the whole hauling line: T1 haulers on the
//     spine, transports above them, freighters and jump freighters on top
//   · corvettes and shuttles hang on a LOWER branch
//   · capitals stack up from the branch line on the right edge — each REAL
//     group its own tier (Dreadnoughts / Navy / Lancer, Carriers, Command
//     Carriers, Force Auxiliaries, Supercarriers, Titans)
//   · limited-edition hulls (the SDE's "Special Edition Ships" market
//     branch) are NOT mixed into the tree — they get a boxed side panel
//
// MEASURED (2026-08-27, shipped ESF bundle): every group name below exists
// in the bundle; tier names follow the market tree's own sub-groups (e.g.
// bombers sit under the market's "Covert Ops", Salvation is group "Command
// Carrier", Revelation Navy Issue is "Faction Dreadnoughts > Navy Faction").
// The special-edition test matches exactly 68 hulls + 1 with no market group.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

interface TypeShape {
  name: string;
  groupID: number;
  categoryID?: number;
  factionID?: number;
  metaGroupID?: number;
  marketGroupID?: number;
  published?: boolean;
}

export interface ShipTreeData {
  types: Record<string, TypeShape>;
  groups: Record<string, { name: string }>;
  marketGroups?: Record<string, { name: string; parentGroupID?: number }>;
}

const typeIcon = (id: number) => `https://images.evetech.net/types/${id}/icon?size=64`;
/** faction LOGOS: the image server serves them on the corporations route
 * (probed 2026-08-27: corporations/500003/logo → 200, the Amarr crest) */
const factionLogo = (id: number) => `https://images.evetech.net/corporations/${id}/logo?size=64`;

/** MEASURED (2026-08-26): names from ESI /universe/factions/, cross-checked
 * against which ships actually carry each factionID in the shipped bundle. */
const FACTION_NAMES: Record<number, string> = {
  500001: 'Caldari State', 500002: 'Minmatar Republic', 500003: 'Amarr Empire', 500004: 'Gallente Federation',
  500005: 'Jove Empire', 500006: 'CONCORD Assembly', 500009: 'The Syndicate',
  500010: 'Guristas Pirates', 500011: 'Angel Cartel', 500012: 'Blood Raider Covenant',
  500014: 'ORE', 500016: 'Servant Sisters of EVE', 500017: 'Society of Conscious Thought',
  500018: "Mordu's Legion", 500019: "Sansha's Nation", 500020: 'Serpentis',
  500026: 'Triglavian Collective', 500027: 'EDENCOM', 500029: 'Deathless Circle',
};
/** grid order: the four empires, ORE, then the rest — the game's rough order */
const FACTION_ORDER = [
  500003, 500001, 500004, 500002, 500014,
  500011, 500012, 500010, 500019, 500020,
  500018, 500016, 500009, 500006, 500017,
  500026, 500027, 500029,
];
const EMPIRES = new Set([500001, 500002, 500003, 500004]);

/** a tier = one REAL sub-group (caption above its row). navySplit tiers
 * expand into two: the T1 hulls, then "Navy/Faction <label>" right above. */
interface TierSpec { label: string; groups: string[]; navySplit?: boolean }
/** spine columns, left→right; tiers listed BOTTOM→TOP */
const CLASSES: { key: string; tiers: TierSpec[] }[] = [
  {
    key: 'frig', tiers: [
      { label: 'Frigates', groups: ['Frigate'], navySplit: true },
      { label: 'Assault Frigates', groups: ['Assault Frigate'] },
      { label: 'Interceptors', groups: ['Interceptor'] },
      { label: 'Covert Ops', groups: ['Covert Ops', 'Stealth Bomber'] },
      { label: 'Electronic Attack Frigates', groups: ['Electronic Attack Ship'] },
      { label: 'Logistics Frigates', groups: ['Logistics Frigate'] },
      { label: 'Expedition Frigates', groups: ['Expedition Frigate'] }],
  },
  {
    key: 'dess', tiers: [
      { label: 'Destroyers', groups: ['Destroyer'], navySplit: true },
      { label: 'Interdictors', groups: ['Interdictor'] },
      { label: 'Command Destroyers', groups: ['Command Destroyer'] },
      { label: 'Tactical Destroyers', groups: ['Tactical Destroyer'] }],
  },
  {
    key: 'cru', tiers: [
      { label: 'Cruisers', groups: ['Cruiser'], navySplit: true },
      { label: 'Heavy Assault Cruisers', groups: ['Heavy Assault Cruiser'] },
      { label: 'Recon Ships', groups: ['Combat Recon Ship', 'Force Recon Ship'] },
      { label: 'Logistics', groups: ['Logistics'] },
      { label: 'Heavy Interdiction Cruisers', groups: ['Heavy Interdiction Cruiser'] },
      { label: 'Flag Cruisers', groups: ['Flag Cruiser'] },
      { label: 'Strategic Cruisers', groups: ['Strategic Cruiser'] }],
  },
  {
    key: 'bc', tiers: [
      { label: 'Battlecruisers', groups: ['Combat Battlecruiser', 'Attack Battlecruiser'], navySplit: true },
      { label: 'Command Ships', groups: ['Command Ship'] }],
  },
  {
    key: 'bs', tiers: [
      { label: 'Battleships', groups: ['Battleship'], navySplit: true },
      { label: 'Black Ops', groups: ['Black Ops'] },
      { label: 'Marauders', groups: ['Marauder'] }],
  },
];
/** the lower branch, left→right: mini-columns hanging on the bottom line,
 * each with its own climb (T2 transports above T1 haulers, jump freighters
 * above freighters) — the hauling family lives BELOW the spine, like ISIS */
const BRANCH: { key: string; tiers: TierSpec[] }[] = [
  { key: 'corv', tiers: [{ label: 'Corvette', groups: ['Corvette'] }] },
  { key: 'shut', tiers: [{ label: 'Shuttle', groups: ['Shuttle'] }] },
  {
    key: 'haul', tiers: [
      { label: 'Haulers', groups: ['Hauler'], navySplit: true },
      { label: 'Transport Ships', groups: ['Blockade Runner', 'Deep Space Transport'] }],
  },
  {
    key: 'mine', tiers: [
      { label: 'Mining Barges', groups: ['Mining Barge'] },
      { label: 'Exhumers', groups: ['Exhumer'] }],
  },
  {
    key: 'icmd', tiers: [
      { label: 'Industrial Command Ships', groups: ['Industrial Command Ship', 'Expedition Command Ship'] },
      { label: 'Capital Industrial Ships', groups: ['Capital Industrial Ship'] }],
  },
  {
    key: 'frt', tiers: [
      { label: 'Freighters', groups: ['Freighter'] },
      { label: 'Jump Freighters', groups: ['Jump Freighter'] }],
  },
  { key: 'expl', tiers: [{ label: 'Exploration', groups: ['Prototype Exploration Ship'] }] },
  { key: 'yacht', tiers: [{ label: 'Yachts', groups: ['Special Edition Yachts'] }] },
];
/** the right-edge capital ladder, BOTTOM→TOP, its foot ON the bottom line.
 * The game groups capitals by their RACIAL SKILL, not by invGroup — Archon,
 * Apostle and Aeon all fly on Amarr Carrier, so they share ONE Carriers
 * tier (the owner: "archon, aeon, and apostle are all in carrier"). */
const CAPS: TierSpec[] = [
  { label: 'Dreadnoughts', groups: ['Dreadnought'], navySplit: true },
  { label: 'Lancer Dreadnoughts', groups: ['Lancer Dreadnought'] },
  { label: 'Carriers', groups: ['Carrier', 'Force Auxiliary', 'Supercarrier'], navySplit: true },
  { label: 'Command Carriers', groups: ['Command Carrier'] },
  { label: 'Titans', groups: ['Titan'], navySplit: true },
];

const metaRank = (m: number | undefined): number => {
  const v = m ?? 1;
  if (v === 1) return 0;
  if (v === 2) return 1;
  if (v === 14) return 2;
  if (v === 4) return 3;
  return 4;
};

interface Node { id: number; name: string; meta: number; groupID: number }
interface Tier { label: string; ships: Node[] }

export default function ShipTree({ data, query, onPick }: {
  data: ShipTreeData;
  query: string;
  onPick: (typeId: number) => void;
}) {
  const catalog = useMemo(() => {
    /** does this type's market-group ancestor chain pass a Special Edition
     * branch? (that's the SDE's OWN flag for limited hulls) */
    const isSpecial = (t: TypeShape): boolean => {
      const mg = data.marketGroups;
      if (!mg) return false;
      if (!t.marketGroupID) return true; // unsellable one-offs (AT prizes etc.)
      let cur: number | undefined = t.marketGroupID;
      for (let hops = 0; cur && mg[cur] && hops < 10; hops++) {
        if (/special edition/i.test(mg[cur].name)) return true;
        cur = mg[cur].parentGroupID;
      }
      return false;
    };
    const byFaction = new Map<number, { standard: Node[]; special: Node[] }>();
    for (const [idStr, t] of Object.entries(data.types)) {
      if (t.categoryID !== 6 || t.published === false || (t.name ?? '').startsWith('Capsule')) continue;
      const f = t.factionID ?? 0;
      const bucket = byFaction.get(f) ?? byFaction.set(f, { standard: [], special: [] }).get(f)!;
      // metaGroupID decodes as 0 when the SDE leaves it unset (protobuf
      // default) — that's plain Tech I, same as absent
      const node: Node = { id: Number(idStr), name: t.name, meta: t.metaGroupID || 1, groupID: t.groupID };
      (isSpecial(t) ? bucket.special : bucket.standard).push(node);
    }
    const order = [...byFaction.keys()].sort((a, b) => {
      const ai = FACTION_ORDER.indexOf(a), bi = FACTION_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) || a - b;
    });
    return { byFaction, order };
  }, [data]);

  const [tab, setTab] = useState<number | null>(null);
  const chosen = tab ?? catalog.order[0] ?? 0;
  const q = query.trim().toLowerCase();
  const matches = (s: Node) => !q || s.name.toLowerCase().includes(q);
  const countIn = (f: number): number => {
    const fac = catalog.byFaction.get(f);
    return fac ? [...fac.standard, ...fac.special].filter(matches).length : 0;
  };
  // while filtering, follow the matches: jump off a tab the query emptied
  const active = q && countIn(chosen) === 0
    ? (catalog.order.find((f) => countIn(f) > 0) ?? chosen)
    : chosen;

  const tree = useMemo(() => {
    const fac = catalog.byFaction.get(active) ?? { standard: [], special: [] };
    const groupName = (gid: number) => data.groups[gid]?.name ?? `Group ${gid}`;
    const byGroup = new Map<string, Node[]>();
    for (const s of fac.standard) {
      if (!matches(s)) continue;
      const g = groupName(s.groupID);
      (byGroup.get(g) ?? byGroup.set(g, []).get(g)!).push(s);
    }
    const claimed = new Set<string>();
    const tierSort = (a: Node, b: Node) => metaRank(a.meta) - metaRank(b.meta) || a.name.localeCompare(b.name);
    const navyWord = EMPIRES.has(active) ? 'Navy' : 'Faction';
    /** expand one spec into its tier(s), bottom→top; empty tiers dropped */
    const expand = (spec: TierSpec): Tier[] => {
      spec.groups.forEach((g) => claimed.add(g));
      const all = spec.groups.flatMap((g) => byGroup.get(g) ?? []);
      if (!spec.navySplit) return [{ label: spec.label, ships: all.sort(tierSort) }];
      return [
        { label: spec.label, ships: all.filter((s) => s.meta === 1).sort(tierSort) },
        { label: `${navyWord} ${spec.label}`, ships: all.filter((s) => s.meta !== 1).sort(tierSort) },
      ];
    };
    const expandAll = (specs: TierSpec[]) => specs.flatMap(expand).filter((t) => t.ships.length > 0);
    const columns = CLASSES.map((c) => ({ key: c.key, tiers: expandAll(c.tiers) }))
      .filter((c) => c.tiers.length > 0);
    const branch = BRANCH.map((b) => ({ key: b.key, tiers: expandAll(b.tiers) }))
      .filter((b) => b.tiers.length > 0);
    const caps = expandAll(CAPS);
    // safety net: any group this layout doesn't know yet still shows up
    const stray = [...byGroup.entries()].filter(([g]) => !claimed.has(g)).flatMap(([, ss]) => ss).sort(tierSort);
    if (stray.length > 0) branch.push({ key: 'other', tiers: [{ label: 'Other', ships: stray }] });
    const special = fac.special.filter(matches).sort(tierSort);
    return { columns, branch, caps, special };
  }, [catalog, active, data, q]);

  // ---- pan/zoom canvas, like the game: fit on open, wheel zooms around the
  // cursor, drag pans. All state lives in refs (no re-render per frame). ----
  const vpRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLDivElement | null>(null);
  const view = useRef({ s: 1, tx: 0, ty: 0 });
  const dragged = useRef(false);
  const apply = () => {
    const sc = sceneRef.current;
    if (sc) sc.style.transform = `translate(${view.current.tx}px, ${view.current.ty}px) scale(${view.current.s})`;
  };
  const fit = () => {
    const vp = vpRef.current, sc = sceneRef.current;
    if (!vp || !sc) return;
    const cw = sc.offsetWidth, ch = sc.offsetHeight, vw = vp.clientWidth, vh = vp.clientHeight;
    if (!cw || !ch || !vw || !vh) return;
    const k = Math.max(0.25, Math.min(2.2, Math.min(vw / cw, vh / ch)));
    view.current = { s: k, tx: (vw - cw * k) / 2, ty: (vh - ch * k) / 2 };
    apply();
  };
  useLayoutEffect(fit, [active, q]);
  useEffect(() => {
    const vp = vpRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(fit);
    ro.observe(vp);
    // the observer can stay silent when Chromium throttles the pipeline
    // (lib/useElementWidth.ts) — the window listener catches the actual
    // "user resizes the app" gesture either way
    window.addEventListener('resize', fit);
    // React's onWheel is passive — a native non-passive listener is the only
    // way to keep the page from scrolling while zooming
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = vp.getBoundingClientRect();
      const px = e.clientX - r.left, py = e.clientY - r.top;
      const { s, tx, ty } = view.current;
      const k = Math.max(0.25, Math.min(3, s * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      view.current = { s: k, tx: px - ((px - tx) * k) / s, ty: py - ((py - ty) * k) / s };
      apply();
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); vp.removeEventListener('wheel', onWheel); };
  }, []);
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const start = { x: e.clientX, y: e.clientY, tx: view.current.tx, ty: view.current.ty };
    dragged.current = false;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragged.current = true;
      view.current.tx = start.tx + dx;
      view.current.ty = start.ty + dy;
      apply();
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  /** a drag must not fire the node under the cursor */
  const onClickCapture = (e: React.MouseEvent) => {
    if (dragged.current) { e.preventDefault(); e.stopPropagation(); dragged.current = false; }
  };

  const node = (s: Node) => (
    <button key={s.id} className={`shiptree-node2 meta-${metaRank(s.meta)}`}
      onClick={() => onPick(s.id)} title={`${s.name} — click to select`}>
      <img src={typeIcon(s.id)} alt="" loading="lazy" draggable={false} />
      <span>{s.name}</span>
    </button>
  );
  /** a captioned tier: sub-group name above its row of hulls */
  const tier = (t: Tier, i: number | string) => (
    <div key={i} className="st3-tg">
      <div className="st3-tiercap">{t.label}</div>
      <div className="st3-tier">{t.ships.map(node)}</div>
    </div>
  );

  const empty = tree.columns.length === 0 && tree.branch.length === 0
    && tree.caps.length === 0 && tree.special.length === 0;

  return (
    <div className="shiptree st3">
      <div className="st3-facstack">
        {catalog.order.map((f) => {
          const n = countIn(f);
          return (
            <button key={f} className={`st3-fac ${f === active ? 'on' : ''} ${q && n === 0 ? 'dim' : ''}`}
              onClick={() => setTab(f)} title={`${FACTION_NAMES[f] ?? `faction ${f}`}${q ? ` — ${n} match` : ''}`}>
              <img src={factionLogo(f)} alt="" draggable={false}
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            </button>
          );
        })}
      </div>
      <div className="st3-main">
        <div className="st3-topbar">
          <div className="st3-card">
            <img src={factionLogo(active)} alt="" width={44} height={44} draggable={false} />
            <div>
              <div className="st3-card-name">{FACTION_NAMES[active] ?? (active === 0 ? 'Other' : `Faction ${active}`)}</div>
              <div className="st3-card-sub">{countIn(active)} ships{q ? ' match' : ''}</div>
            </div>
          </div>
          <div className="st3-hint">scroll zooms · drag moves</div>
        </div>
        <div className="st3-canvas" ref={vpRef} onPointerDown={onPointerDown} onClickCapture={onClickCapture}>
        {empty && <div className="dim" style={{ padding: 10 }}>no ships match</div>}
        {!empty && (
          <div className="st3-world" ref={sceneRef}>
            <div className="st3-left">
              <div className="st3-spine">
                {tree.columns.map((col) => (
                  <div key={col.key} className="st3-class">
                    {[...col.tiers].reverse().map((t, i) => tier(t, i))}
                  </div>
                ))}
                {tree.caps.length > 0 && (
                  <div className="st3-caps">
                    {[...tree.caps].reverse().map((t, i) => tier(t, i))}
                  </div>
                )}
              </div>
              {tree.branch.length > 0 && (
                <div className="st3-branch">
                  {tree.branch.map((b) => (
                    <div key={b.key} className="st3-bcol">
                      {[...b.tiers].reverse().map((t, i) => tier(t, i))}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {tree.special.length > 0 && (
              <div className="st3-se">
                <div className="st3-se-head">Special Edition</div>
                <div className="st3-se-grid">{tree.special.map(node)}</div>
              </div>
            )}
          </div>
        )}
        </div>
      </div>
    </div>
  );
}
