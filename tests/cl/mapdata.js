"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.regionName = regionName;
exports.findSystem = findSystem;
exports.getSystem = getSystem;
exports.getStation = getStation;
exports.stationsIn = stationsIn;
exports.reachFrom = reachFrom;
exports.systemsWithin = systemsWithin;
exports.suggestSystems = suggestSystems;
// Stargate map: systems, gate links, NPC stations (built by build-mapdata.mjs).
const mapdata_json_1 = require("../data/mapdata.json");
const data = mapdata_json_1.default;
const regionNames = new Map(data.regions);
function regionName(id) {
    return regionNames.get(id) ?? `Region ${id}`;
}
const systems = data.systems.map(([id, name, regionId, sec]) => ({ id, name, regionId, sec }));
const systemById = new Map(systems.map((s) => [s.id, s]));
const systemByLowerName = new Map(systems.map((s) => [s.name.toLowerCase(), s]));
const adjacency = new Map();
for (const [a, b] of data.jumps) {
    (adjacency.get(a) ?? adjacency.set(a, []).get(a)).push(b);
    (adjacency.get(b) ?? adjacency.set(b, []).get(b)).push(a);
}
const stationsBySystem = new Map();
const stationById = new Map();
for (const [id, systemId, name] of data.stations) {
    const st = { id, systemId, name };
    stationById.set(id, st);
    (stationsBySystem.get(systemId) ?? stationsBySystem.set(systemId, []).get(systemId)).push(st);
}
function findSystem(name) {
    return systemByLowerName.get(name.trim().toLowerCase());
}
function getSystem(id) {
    return systemById.get(id);
}
function getStation(id) {
    return stationById.get(id);
}
function stationsIn(systemId) {
    return stationsBySystem.get(systemId) ?? [];
}
/** Multi-source BFS over the stargate graph: distance to the NEAREST of the
 * given centres, remembering which centre ("via"). One centre = plain
 * systemsWithin semantics. Ties go to whichever centre the BFS reached
 * first — equal-distance alternatives exist and are equally valid. */
function reachFrom(centerIds, maxJumps) {
    const dist = new Map();
    let frontier = [];
    for (const id of centerIds) {
        if (!dist.has(id) && systemById.has(id)) {
            dist.set(id, { jumps: 0, viaId: id });
            frontier.push(id);
        }
    }
    for (let d = 1; d <= maxJumps && frontier.length; d++) {
        const next = [];
        for (const sys of frontier) {
            const via = dist.get(sys).viaId;
            for (const n of adjacency.get(sys) ?? []) {
                if (!dist.has(n)) {
                    dist.set(n, { jumps: d, viaId: via });
                    next.push(n);
                }
            }
        }
        frontier = next;
    }
    return dist;
}
/** BFS over the stargate graph: systemId → jumps from center, within maxJumps. */
function systemsWithin(centerId, maxJumps) {
    const dist = new Map([[centerId, 0]]);
    let frontier = [centerId];
    for (let d = 1; d <= maxJumps && frontier.length; d++) {
        const next = [];
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
function suggestSystems(query, limit = 8) {
    const q = query.trim().toLowerCase();
    if (q.length < 2)
        return [];
    const out = [];
    const exact = systemByLowerName.get(q);
    if (exact)
        out.push(exact);
    for (const s of systems) {
        if (out.length >= limit)
            break;
        if (s !== exact && s.name.toLowerCase().startsWith(q))
            out.push(s);
    }
    return out;
}
