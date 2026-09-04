// EVE-style browse trees for the Fit Wizard: modules organized by the REAL
// market-group hierarchy (what the in-game fitting simulator's left panel
// shows), ships organized ship-tree-style (faction → hull class). Pure —
// node fixtures run this exact code.

export interface CatalogType {
  name: string;
  groupID: number;
  categoryID: number;
  published?: boolean;
  marketGroupID?: number;
  factionID?: number;
  metaGroupID?: number;
}

export interface CatalogShapes {
  types: Record<string, CatalogType>;
  marketGroups: Record<string, { name: string; parentGroupID?: number }>;
  groups: Record<string, { name: string; categoryID: number }>;
}

export interface TreeNode {
  key: string;
  name: string;
  children: TreeNode[];
  /** type ids directly in this node, name-sorted */
  typeIds: number[];
  /** a representative type whose icon stands for the group */
  iconTypeId?: number;
}

/** meta tiers, in the order players think about them: plain T1 and its
 * named/compact variants, then T2, then the rarities. Names come from the
 * SDE (invMetaGroups); 0/unknown rides with Tech I. */
const META_ORDER = [1, 2, 3, 4, 6, 5, 14, 15, 17, 19, 52, 53, 54];
const metaRank = (id: number): number => {
  const i = META_ORDER.indexOf(id);
  return i === -1 ? 0 : i;
};

/** standard EVE faction ids → names (stable constants; unknown ids get a
 * visible generic label rather than being dropped) */
const FACTION_NAMES: Record<number, string> = {
  500001: 'Caldari State',
  500002: 'Minmatar Republic',
  500003: 'Amarr Empire',
  500004: 'Gallente Federation',
  500005: 'Jove Empire',
  500006: 'CONCORD',
  500008: 'Khanid Kingdom',
  500009: 'The Syndicate',
  500010: 'Guristas Pirates',
  500011: 'Angel Cartel',
  500012: 'Blood Raider Covenant',
  500014: 'ORE',
  500015: 'Thukker Tribe',
  500016: 'Sisters of EVE',
  500017: 'Society of Conscious Thought',
  500018: "Mordu's Legion",
  500019: "Sansha's Nation",
  500020: 'Serpentis',
  500026: 'Triglavian Collective',
  500027: 'EDENCOM',
  500029: 'Deathless Circle',
};

const nameOf = (data: CatalogShapes, id: number) => data.types[id]?.name ?? `#${id}`;
const byName = (data: CatalogShapes) => (a: number, b: number) => nameOf(data, a).localeCompare(nameOf(data, b));

/**
 * Market-group tree containing exactly the types that pass `include`.
 * Chains are built bottom-up from each type's marketGroupID, so only
 * branches with actual content exist. Types without a market group land in
 * a visible "Ungrouped" root.
 */
export function buildMarketTree(
  data: CatalogShapes,
  include: (typeId: number) => boolean,
): TreeNode[] {
  const nodes = new Map<number, TreeNode>();
  const roots = new Map<number, TreeNode>();
  const nodeFor = (mgId: number): TreeNode | null => {
    const existing = nodes.get(mgId);
    if (existing) return existing;
    const mg = data.marketGroups[mgId];
    if (!mg) return null;
    const node: TreeNode = { key: `m${mgId}`, name: mg.name, children: [], typeIds: [] };
    nodes.set(mgId, node);
    if (mg.parentGroupID !== undefined && mg.parentGroupID !== 0) {
      const parent = nodeFor(mg.parentGroupID);
      if (parent) parent.children.push(node);
      else roots.set(mgId, node);
    } else {
      roots.set(mgId, node);
    }
    return node;
  };

  // A type with no market group still belongs SOMEWHERE — put it with the
  // rest of its inventory group (the Mining Lasers, Scan Probe Launchers
  // and friends CCP never market-grouped). "Ungrouped" was a dead end.
  const marketGroupOfInvGroup = new Map<number, Map<number, number>>();
  for (const t of Object.values(data.types)) {
    if (t.published === false || !t.marketGroupID) continue;
    const counts = marketGroupOfInvGroup.get(t.groupID) ?? marketGroupOfInvGroup.set(t.groupID, new Map()).get(t.groupID)!;
    counts.set(t.marketGroupID, (counts.get(t.marketGroupID) ?? 0) + 1);
  }
  const inferMarketGroup = (groupId: number): number | undefined => {
    const counts = marketGroupOfInvGroup.get(groupId);
    if (!counts) return undefined;
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  };

  const orphans: number[] = [];
  for (const [idStr, t] of Object.entries(data.types)) {
    const id = Number(idStr);
    if (t.published === false) continue;
    if (!include(id)) continue;
    const mgId = t.marketGroupID && t.marketGroupID !== 0 ? t.marketGroupID : inferMarketGroup(t.groupID);
    const node = mgId !== undefined ? nodeFor(mgId) : null;
    if (node) node.typeIds.push(id);
    else orphans.push(id);
  }
  // anything still homeless goes under its inventory GROUP name, never a
  // meaningless "Ungrouped" pile
  if (orphans.length > 0) {
    const byInvGroup = new Map<number, number[]>();
    for (const id of orphans) {
      const gid = data.types[id]?.groupID ?? 0;
      (byInvGroup.get(gid) ?? byInvGroup.set(gid, []).get(gid)!).push(id);
    }
    for (const [gid, ids] of byInvGroup) {
      roots.set(-gid, {
        key: `g${gid}`,
        name: data.groups[gid]?.name ?? `Group ${gid}`,
        children: [],
        typeIds: ids,
      });
    }
  }

  /** IN-GAME ordering (user rule, v0.152): a leaf market group lists ALL its
   * items in ONE flat list, sorted by meta tier then name — exactly how the
   * client's market and fitting browser show them. The Tech-I/Tech-II
   * SUBFOLDERS this used to invent don't exist in game and were vetoed. */
  const flatSort = (n: TreeNode) => {
    n.children.forEach(flatSort);
    n.typeIds.sort((a, b) => {
      const ma = metaRank(data.types[a]?.metaGroupID ?? 1);
      const mb = metaRank(data.types[b]?.metaGroupID ?? 1);
      return ma - mb || nameOf(data, a).localeCompare(nameOf(data, b));
    });
  };

  /** tier rank for sibling subgroups (user rule v0.165, matching the
   * client): Standard X before Advanced X before Faction X; everything
   * else keeps alphabetical order among itself. */
  const tierRank = (name: string): number =>
    /^standard\b/i.test(name) ? 0 : /^advanced\b/i.test(name) ? 1 : /^faction\b/i.test(name) ? 2 : 1.5;
  const sortRec = (n: TreeNode) => {
    // subgroups: tier rank first (Standard → Advanced → Faction), then
    // alphabetical — plain alphabetical put Advanced ammo above Standard
    n.children.sort((a, b) => tierRank(a.name) - tierRank(b.name) || a.name.localeCompare(b.name));
    n.children.forEach(sortRec);
  };

  /** FOLDER ICONS (user ask v0.173, reversing the v0.152 removal with a
   * better rule): the representative is the first item of the node's
   * META-SORTED list — the plain T1, so Damage Controls wears Damage
   * Control I — and parents inherit their first child's pick. v0.152's
   * failure was an ALPHABETICAL representative (a compressor on Ship
   * Equipment); meta-first plus the hoisted wrapper roots removes it. */
  const assignIcons = (n: TreeNode): number | undefined => {
    let icon: number | undefined = n.typeIds.length > 0 ? n.typeIds[0] : undefined;
    for (const c of n.children) {
      const ci = assignIcons(c);
      if (icon === undefined) icon = ci;
    }
    n.iconTypeId = icon;
    return icon;
  };

  /** Civilian items live under "Faction X" in the SDE's market tree, but
   * belong at the HEAD of the "Standard X" sibling (user rule v0.165 —
   * a Civilian Scourge is nobody's idea of faction ammo). */
  const moveCivilians = (n: TreeNode) => {
    n.children.forEach(moveCivilians);
    const faction = n.children.find((c) => /^faction\b/i.test(c.name));
    const standard = n.children.find((c) => /^standard\b/i.test(c.name));
    if (!faction || !standard) return;
    const civ = faction.typeIds.filter((id) => /^civilian\b/i.test(nameOf(data, id)));
    if (civ.length === 0) return;
    faction.typeIds = faction.typeIds.filter((id) => !civ.includes(id));
    standard.typeIds = [...civ.sort((a, b) => nameOf(data, a).localeCompare(nameOf(data, b))), ...standard.typeIds];
  };

  /** IN-GAME meta folders (user screenshot of the fitting window, v0.160):
   * a leaf keeps its tech-tier items inline (Prototype I, Improved II, …)
   * but folds the rare tiers into the client's own subfolders — "Faction &
   * Storyline", "Deadspace", "Officer" — each sorted by plain name. These
   * folders are REAL in game (unlike the invented Tech-I/II ones v0.152
   * removed). */
  const META_FOLDERS: { name: string; metas: number[] }[] = [
    { name: 'Faction & Storyline', metas: [3, 4] },
    { name: 'Deadspace', metas: [6] },
    { name: 'Officer', metas: [5] },
  ];
  const foldMetas = (n: TreeNode) => {
    n.children.forEach(foldMetas);
    if (n.typeIds.length === 0) return;
    for (const f of META_FOLDERS) {
      const ids = n.typeIds.filter((id) => f.metas.includes(data.types[id]?.metaGroupID ?? 1));
      if (ids.length === 0) continue;
      n.typeIds = n.typeIds.filter((id) => !ids.includes(id));
      ids.sort((a, b) => nameOf(data, a).localeCompare(nameOf(data, b)));
      n.children.push({ key: `${n.key}~${f.name}`, name: f.name, children: [], typeIds: ids });
    }
  };

  let out = [...roots.values()];
  out.forEach(flatSort);
  out.forEach(sortRec);
  out.forEach(moveCivilians);
  out.forEach(foldMetas);
  // the in-game fitting browser lists the CHILDREN of Ship Equipment (its
  // Modules tab) and of Ammunition & Charges (its Charges tab) as top-level
  // categories — hoist them rather than nest everything one level deep
  const HOIST = new Set(['Ship Equipment', 'Ammunition & Charges']);
  out = out.flatMap((n) => (HOIST.has(n.name) && n.typeIds.length === 0 ? n.children : [n]));
  // REAL market roots first (alphabetical, the client's order); the inferred
  // inventory-group fallbacks (keys start 'g') trail at the bottom — they're
  // the never-market-grouped stragglers, not headline categories
  out.sort((a, b) => {
    const ag = a.key.startsWith('g') ? 1 : 0;
    const bg = b.key.startsWith('g') ? 1 : 0;
    return ag - bg || a.name.localeCompare(b.name);
  });
  out.forEach(assignIcons);
  return out;
}

/** ship-tree-style: faction → hull class (invGroup name) → ships */
export function buildShipTree(data: CatalogShapes): TreeNode[] {
  const factions = new Map<number, Map<number, number[]>>();
  for (const [idStr, t] of Object.entries(data.types)) {
    if (t.categoryID !== 6 || t.published === false) continue;
    const id = Number(idStr);
    const f = t.factionID ?? 0;
    const perClass = factions.get(f) ?? factions.set(f, new Map()).get(f)!;
    (perClass.get(t.groupID) ?? perClass.set(t.groupID, []).get(t.groupID)!).push(id);
  }
  const out: TreeNode[] = [];
  for (const [factionId, perClass] of factions) {
    const children: TreeNode[] = [];
    for (const [groupId, ids] of perClass) {
      ids.sort(byName(data));
      children.push({ key: `g${factionId}:${groupId}`, name: data.groups[groupId]?.name ?? `Group ${groupId}`, children: [], typeIds: ids, iconTypeId: ids[0] });
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    out.push({
      key: `f${factionId}`,
      name: FACTION_NAMES[factionId] ?? (factionId === 0 ? 'Other' : `Faction ${factionId}`),
      children,
      typeIds: [],
      iconTypeId: children[0]?.typeIds[0],
    });
  }
  // the four empires first, then everyone else alphabetically
  const empireOrder = [500003, 500001, 500004, 500002];
  out.sort((a, b) => {
    const ai = empireOrder.indexOf(Number(a.key.slice(1)));
    const bi = empireOrder.indexOf(Number(b.key.slice(1)));
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.name.localeCompare(b.name);
  });
  return out;
}

/** prune a tree to types whose name matches the filter (case-insensitive
 * substring); empty branches disappear. Empty filter returns the input. */
export function filterTree(data: CatalogShapes, nodes: TreeNode[], filter: string): TreeNode[] {
  const q = filter.trim().toLowerCase();
  if (!q) return nodes;
  const prune = (n: TreeNode): TreeNode | null => {
    const typeIds = n.typeIds.filter((id) => nameOf(data, id).toLowerCase().includes(q));
    const children = n.children.map(prune).filter((c): c is TreeNode => c !== null);
    if (typeIds.length === 0 && children.length === 0) return null;
    return { ...n, typeIds, children };
  };
  return nodes.map(prune).filter((n): n is TreeNode => n !== null);
}
