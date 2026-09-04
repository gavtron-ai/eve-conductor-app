"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.typeCount = exports.categories = void 0;
exports.getType = getType;
exports.findByName = findByName;
exports.isShip = isShip;
exports.categoryOf = categoryOf;
exports.allTypes = allTypes;
exports.searchTypes = searchTypes;
const typedb_json_1 = require("../data/typedb.json");
const db = typedb_json_1.default;
exports.categories = db.cats;
const items = db.items.map(([id, name, volume, catIdx, cargo, group, race, bays]) => ({
    id,
    name,
    volume,
    catIdx,
    ...(cargo !== undefined ? { cargo, group, race, bays } : {}),
}));
const byId = new Map(items.map((it) => [it.id, it]));
const byName = new Map(items.map((it) => [it.name.toLowerCase(), it]));
function getType(id) {
    return byId.get(id);
}
/** exact case-insensitive name lookup */
function findByName(name) {
    return byName.get(name.trim().toLowerCase());
}
/** true when the type is a ship (cargo capacity is recorded for ships only) */
function isShip(id) {
    return byId.get(id)?.cargo !== undefined;
}
/** root market-group name, e.g. "Ships", "Ammunition & Charges" */
function categoryOf(id) {
    const it = byId.get(id);
    return it ? (exports.categories[it.catIdx] ?? 'Other') : 'Other';
}
/** every published market item — the Trade Finder's default scan universe */
function allTypes() {
    return items;
}
/**
 * Case-insensitive substring search, ranked: exact match first, then
 * prefix matches, then word-prefix matches, then any substring —
 * shorter names win ties so "Hulk" beats "Hulk Blueprint".
 */
function searchTypes(query, limit = 40) {
    const q = query.trim().toLowerCase();
    if (q.length < 2)
        return [];
    const scored = [];
    for (const it of items) {
        const n = it.name.toLowerCase();
        const idx = n.indexOf(q);
        if (idx === -1)
            continue;
        let score;
        if (n === q)
            score = 0;
        else if (idx === 0)
            score = 1;
        else if (n[idx - 1] === ' ')
            score = 2;
        else
            score = 3;
        scored.push({ it, score: score * 1000 + it.name.length });
    }
    scored.sort((a, b) => a.score - b.score);
    return scored.slice(0, limit).map((s) => s.it);
}
exports.typeCount = items.length;
