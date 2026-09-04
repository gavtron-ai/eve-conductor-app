"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isBayFlag = exports.isSlotFlag = exports.typeNameOf = void 0;
exports.toEft = toEft;
exports.rackOf = rackOf;
exports.fitIdentityKey = fitIdentityKey;
exports.contentKey = contentKey;
// PURE fit serialization — ESI item lists (saved fittings / asset contents)
// → EFT text for the shared parse pipeline, plus the content-identity key
// used to merge exact duplicates. No browser/store imports: node fixtures
// run this exact code.
const typedb_1 = require("./typedb");
const skillRelevance_1 = require("./skillRelevance");
const typeNameOf = (id) => (0, typedb_1.getType)(id)?.name ?? (0, skillRelevance_1.extraTypeName)(id) ?? `#${id}`;
exports.typeNameOf = typeNameOf;
const SLOT_ORDER = ['LoSlot', 'MedSlot', 'HiSlot', 'RigSlot', 'SubSystemSlot', 'ServiceSlot'];
const isSlotFlag = (flag) => SLOT_ORDER.some((p) => flag.startsWith(p));
exports.isSlotFlag = isSlotFlag;
/** fighters live in FighterBay OR loaded launch tubes (FighterTube0-4) —
 * dropping tube-loaded squadrons made every owned carrier fit silently wrong */
const isBayFlag = (flag) => flag === 'DroneBay' || flag === 'FighterBay' || /^FighterTube\d+$/.test(flag);
exports.isBayFlag = isBayFlag;
/** ESI items → EFT text. NOTE: assets list a loaded charge under the SAME
 * slot flag as its module — it comes out as its own line, which the parser
 * classifies correctly (module↔charge pairing is not reconstructable from
 * assets, so cap simulation treats those guns as unloaded — stated limit). */
function toEft(hullName, fitName, items) {
    const lines = [`[${hullName}, ${fitName}]`];
    for (const prefix of SLOT_ORDER) {
        const slotted = items
            .filter((i) => i.flag.startsWith(prefix))
            .sort((a, b) => a.flag.localeCompare(b.flag, undefined, { numeric: true }));
        for (const it of slotted) {
            const base = it.offline ? `${(0, exports.typeNameOf)(it.type_id)}/OFFLINE` : (0, exports.typeNameOf)(it.type_id);
            const line = it.chargeTypeId !== undefined ? `${base}, ${(0, exports.typeNameOf)(it.chargeTypeId)}` : base;
            for (let n = 0; n < Math.max(1, it.quantity); n++)
                lines.push(line);
        }
    }
    const bays = items.filter((i) => (0, exports.isBayFlag)(i.flag));
    const cargo = items.filter((i) => i.flag === 'Cargo');
    for (const group of [bays, cargo]) {
        if (group.length === 0)
            continue;
        lines.push('');
        for (const it of group)
            lines.push(`${(0, exports.typeNameOf)(it.type_id)} x${Math.max(1, it.quantity)}`);
    }
    return lines.join('\n');
}
/**
 * STRICTER identity, for the fitting library. contentKey below throws every
 * flag away, which is right when merging a saved fit against the assembled
 * ship it describes — but WRONG for a library that pushes fits back into the
 * game, because it makes "Damage Control II fitted" and "Damage Control II
 * sitting in cargo" the same fit.
 *
 * Here the RACK matters and the index within it does not: a fit is the same
 * fit whether the web is in MedSlot0 or MedSlot3. That is exactly the user's
 * rule — "only fitting and hull needs to be identical, not the name".
 */
function rackOf(flag) {
    if (/^FighterTube\d+$/.test(flag))
        return 'FighterBay';
    const m = /^([A-Za-z]+?)\d+$/.exec(flag);
    return m ? m[1] : flag;
}
function fitIdentityKey(shipTypeId, items) {
    const byRack = new Map();
    for (const it of items) {
        if (it.flag === 'Invalid')
            continue; // dropped by the fitting service anyway
        const rack = rackOf(it.flag);
        const counts = byRack.get(rack) ?? new Map();
        counts.set(it.type_id, (counts.get(it.type_id) ?? 0) + Math.max(1, it.quantity));
        byRack.set(rack, counts);
    }
    const racks = [...byRack.entries()]
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([rack, counts]) => {
        const items = [...counts.entries()]
            .sort((a, b) => a[0] - b[0])
            .map(([t, q]) => `${t}x${q}`)
            .join(',');
        return `${rack}:${items}`;
    });
    return `${shipTypeId}|${racks.join('|')}`;
}
/** content identity: hull + every item id×qty, flags normalized away — a
 * saved fit and the identical assembled ship dedupe to ONE entry.
 * 'Invalid'-flag items (the fitting service failed to slot them) are
 * excluded here EXACTLY as toEft excludes them — key and text must agree. */
function contentKey(shipTypeId, items) {
    const counts = new Map();
    for (const it of items) {
        if (it.flag === 'Invalid')
            continue;
        counts.set(it.type_id, (counts.get(it.type_id) ?? 0) + Math.max(1, it.quantity));
    }
    const sorted = [...counts.entries()].sort((a, b) => a[0] - b[0]);
    return `${shipTypeId}|${sorted.map(([t, q]) => `${t}x${q}`).join(',')}`;
}
