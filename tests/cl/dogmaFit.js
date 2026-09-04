"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ATTR = exports.SLOT_EFFECT = void 0;
exports.toEsfFit = toEsfFit;
exports.attrValue = attrValue;
exports.extractStats = extractStats;
const fitSummary_1 = require("./fitSummary");
// fitting-slot effects: which slot a module occupies (from its own dogma).
// Ids verified against the bundled dogmaEffects.pb2: 11=loPower, 12=hiPower,
// 13=medPower — NOT the 11/13/21 misremembering that briefly lived here.
exports.SLOT_EFFECT = {
    11: 'Low',
    12: 'High',
    13: 'Medium',
    2663: 'Rig',
    3772: 'SubSystem',
    6306: 'Service',
};
/** convert a parsed EFT fit into the engine's fit shape. Items that are
 * neither slotted modules nor drones (cargo ammo, spare charges) are NOT
 * part of the flown fit and are skipped — reported in `nonFit`. Items the
 * data bundle doesn't know are reported in `missingData` (callers must
 * REFUSE to compute stats then — a partial fit's numbers are lies). */
function toEsfFit(fit, data) {
    if (fit.shipId === null)
        throw new Error('no hull');
    const modules = [];
    const drones = [];
    const nonFit = [];
    const missingData = [];
    // the HULL is data too — an unknown hull id would panic inside the wasm
    // (opaque "unreachable") instead of the designed refusal
    if (!data.typeDogma[fit.shipId] || !data.types[fit.shipId]) {
        missingData.push(fit.shipName || `hull #${fit.shipId}`);
    }
    const slotCounters = {};
    for (const item of fit.items) {
        const td = data.typeDogma[item.typeId];
        const t = data.types[item.typeId];
        if (!td || !t) {
            missingData.push(item.name);
            continue;
        }
        const slotType = td.dogmaEffects.map((e) => exports.SLOT_EFFECT[e.effectID]).find((s) => s !== undefined);
        if (slotType) {
            for (let i = 0; i < item.qty; i++) {
                const index = (slotCounters[slotType] = (slotCounters[slotType] ?? 0) + 1);
                // the last `offlineQty` copies are fitted but OFFLINE (no CPU/PG/
                // cap — engine state Passive); which exact copy is offline is not
                // knowable from a merged stack, only the count is
                const offline = i >= item.qty - item.offlineQty;
                const charge = item.charges[i]; // per-copy; beyond the list = unloaded
                modules.push({
                    type_id: item.typeId,
                    slot: { type: slotType, index },
                    state: offline || slotType === 'Rig' || slotType === 'SubSystem' ? 'Passive' : 'Active',
                    ...(charge !== undefined ? { charge: { type_id: charge } } : {}),
                });
            }
        }
        else if (t.categoryID === 18) {
            for (let i = 0; i < Math.min(item.qty, 25); i++)
                drones.push({ type_id: item.typeId, state: 'Active' });
        }
        else {
            nonFit.push(item.name); // cargo ammo, spare charges, boosters, …
        }
    }
    return { esfFit: { ship_type_id: fit.shipId, modules, drones, implants: [] }, nonFit, missingData };
}
exports.ATTR = {
    cpuOutput: 48,
    cpuLoad: 49,
    powerOutput: 11,
    powerLoad: 15,
    upgradeCapacity: 1132,
    /** per-RIG calibration cost — the engine never writes hull upgradeLoad
     * (1152), so calibration load is summed from the rig items themselves */
    upgradeCost: 1153,
    capacitorCapacity: 482,
    rechargeRate: 55,
    capacitorPeakDelta: -5,
    capacitorDepletesIn: -7,
};
/** hull attributes come back as a JS Map (serde) — tolerate object form too */
function attrValue(attributes, id) {
    let entry;
    if (attributes instanceof Map)
        entry = attributes.get(id);
    else if (attributes && typeof attributes === 'object')
        entry = attributes[String(id)];
    if (!entry)
        return 0;
    return entry.value ?? entry.base_value ?? 0;
}
/** every hull attribute the engine produced, as id → final value */
function allAttributes(attributes) {
    const out = new Map();
    const put = (k, v) => {
        const id = Number(k);
        const e = v;
        if (!Number.isFinite(id) || !e)
            return;
        const val = e.value ?? e.base_value;
        if (typeof val === 'number' && Number.isFinite(val))
            out.set(id, val);
    };
    if (attributes instanceof Map) {
        for (const [k, v] of attributes)
            put(k, v);
    }
    else if (attributes && typeof attributes === 'object') {
        for (const [k, v] of Object.entries(attributes))
            put(k, v);
    }
    return out;
}
function extractStats(result, nonFit, hullOwn = new Set()) {
    const a = result.hull.attributes;
    // calibration: the engine does NOT accumulate hull upgradeLoad — sum the
    // rigs' own upgradeCost (verified: hull 1152 absent, rig items carry 1153)
    const calibrationLoad = result.items
        .filter((it) => (typeof it.slot === 'string' ? it.slot === 'Rig' : it.slot?.type === 'Rig'))
        .reduce((s, it) => s + attrValue(it.attributes, exports.ATTR.upgradeCost), 0);
    return {
        cpu: { load: attrValue(a, exports.ATTR.cpuLoad), output: attrValue(a, exports.ATTR.cpuOutput) },
        power: { load: attrValue(a, exports.ATTR.powerLoad), output: attrValue(a, exports.ATTR.powerOutput) },
        calibration: { load: calibrationLoad, output: attrValue(a, exports.ATTR.upgradeCapacity) },
        cap: {
            capacity: attrValue(a, exports.ATTR.capacitorCapacity),
            rechargeRate: attrValue(a, exports.ATTR.rechargeRate) / 1000,
            peakDelta: attrValue(a, exports.ATTR.capacitorPeakDelta),
            depletesIn: attrValue(a, exports.ATTR.capacitorDepletesIn),
        },
        nonFit,
        hullAttributes: allAttributes(a),
        hullOwnAttributes: hullOwn,
        summary: (0, fitSummary_1.summarize)(result),
    };
}
