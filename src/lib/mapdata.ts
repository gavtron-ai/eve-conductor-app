// Stargate map: systems, gate links, NPC stations (built by build-mapdata.mjs).
import raw from '../data/mapdata.json';

export interface MapSystem {
  id: number;
  name: string;
  regionId: number;
  /** rounded to 1 decimal — display security */
  sec: number;
}

export interface MapStation {
  id: number;
  systemId: number;
  name: string;
}

const data = raw as {
  systems: [number, string, number, number][];
  jumps: [number, number][];
  stations: [number, number, string][];
  regions: [number, string][];
};

const regionNames = new Map(data.regions);

export function regionName(id: number): string {
  return regionNames.get(id) ?? `Region ${id}`;
}

const systems: MapSystem[] = data.systems.map(([id, name, regionId, sec]) => ({ id, name, regionId, sec }));
const systemById = new Map(systems.map((s) => [s.id, s]));
const systemByLowerName = new Map(systems.map((s) => [s.name.toLowerCase(), s]));

const adjacency = new Map<number, number[]>();
for (const [a, b] of data.jumps) {
  (adjacency.get(a) ?? adjacency.set(a, []).get(a)!).push(b);
  (adjacency.get(b) ?? adjacency.set(b, []).get(b)!).push(a);
}

const stationsBySystem = new Map<number, MapStation[]>();
const stationById = new Map<number, MapStation>();
for (const [id, systemId, name] of data.stations) {
  const st = { id, systemId, name };
  stationById.set(id, st);
  (stationsBySystem.get(systemId) ?? stationsBySystem.set(systemId, []).get(systemId)!).push(st);
}

export function findSystem(name: string): MapSystem | undefined {
  return systemByLowerName.get(name.trim().toLowerCase());
}

export function getSystem(id: number): MapSystem | undefined {
  return systemById.get(id);
}

export function getStation(id: number): MapStation | undefined {
  return stationById.get(id);
}

export function stationsIn(systemId: number): MapStation[] {
  return stationsBySystem.get(systemId) ?? [];
}

export interface ReachInfo {
  /** stargate jumps to the NEAREST of the given centres */
  jumps: number;
  /** which centre that was */
  viaId: number;
  /** predecessor system on the shortest path TOWARD viaId (a centre's prev is
   * itself) — lets pathTo() rebuild the actual route for a gatecamp check */
  prev: number;
}

/** Multi-source BFS over the stargate graph: distance to the NEAREST of the
 * given centres, remembering which centre ("via"). One centre = plain
 * systemsWithin semantics. Ties go to whichever centre the BFS reached
 * first — equal-distance alternatives exist and are equally valid. */
export function reachFrom(centerIds: number[], maxJumps: number): Map<number, ReachInfo> {
  const dist = new Map<number, ReachInfo>();
  let frontier: number[] = [];
  for (const id of centerIds) {
    if (!dist.has(id) && systemById.has(id)) {
      dist.set(id, { jumps: 0, viaId: id, prev: id });
      frontier.push(id);
    }
  }
  for (let d = 1; d <= maxJumps && frontier.length; d++) {
    const next: number[] = [];
    for (const sys of frontier) {
      const via = dist.get(sys)!.viaId;
      for (const n of adjacency.get(sys) ?? []) {
        if (!dist.has(n)) {
          dist.set(n, { jumps: d, viaId: via, prev: sys });
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/**
 * Rebuild the shortest gate route from a reachFrom() result: ordered system ids
 * [centre, …, targetId] inclusive, or [] if the target was never reached. Used
 * to walk the jumps between staging and a skyhook and flag recent kills on the
 * way (a gatecamp check). O(path length).
 */
export function pathTo(reach: Map<number, ReachInfo>, targetId: number): number[] {
  if (!reach.has(targetId)) return [];
  const out: number[] = [];
  const seen = new Set<number>();
  let cur = targetId;
  while (reach.has(cur) && !seen.has(cur)) {
    seen.add(cur);
    out.push(cur);
    const info = reach.get(cur)!;
    if (info.prev === cur) break; // reached the centre
    cur = info.prev;
  }
  return out.reverse();
}

/** BFS over the stargate graph: systemId → jumps from center, within maxJumps. */
export function systemsWithin(centerId: number, maxJumps: number): Map<number, number> {
  const dist = new Map<number, number>([[centerId, 0]]);
  let frontier = [centerId];
  for (let d = 1; d <= maxJumps && frontier.length; d++) {
    const next: number[] = [];
    for (const sys of frontier) {
      for (const n of adjacency.get(sys) ?? []) {
        if (!dist.has(n)) {
          dist.set(n, d);
          next.push(n);
        }
      }
    }
    frontier = next;
  }
  return dist;
}

/** prefix search for the area-scan input — exact match first, then prefixes */
export function suggestSystems(query: string, limit = 8): MapSystem[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const out: MapSystem[] = [];
  const exact = systemByLowerName.get(q);
  if (exact) out.push(exact);
  for (const s of systems) {
    if (out.length >= limit) break;
    if (s !== exact && s.name.toLowerCase().startsWith(q)) out.push(s);
  }
  return out;
}
