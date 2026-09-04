"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ESI_FIT_NAME_MAX = exports.fitVariationName = exports.RACK_LABEL = exports.RACKS = void 0;
exports.rackSizes = rackSizes;
exports.rackForModule = rackForModule;
exports.emptyVariation = emptyVariation;
exports.cloneVariation = cloneVariation;
exports.newWizardFit = newWizardFit;
exports.variationEft = variationEft;
exports.buyList = buyList;
exports.toEsiFitting = toEsiFitting;
exports.variationEsfFitFull = variationEsfFitFull;
exports.variationEsfFit = variationEsfFit;
exports.normalizeFitLayout = normalizeFitLayout;
// FIT WIZARD data model + pure helpers. Fits live APP-SIDE (persisted
// store), so a fit can carry unlimited spare/variant modules — the in-game
// fitting service can't. A WizardFit = named fit + REQUIRED-named
// variations; each variation is a full loadout (fork-on-create from the
// one you're looking at).
//
// lock is stored per slot for W2's "Make It Work":
//   'hard' = keep exactly this module; 'soft' = keep this KIND of module
//   (the optimizer may swap variants); unset = free slot, fully ideated.
const fitSerial_1 = require("./fitSerial");
const dogmaFit_1 = require("./dogmaFit");
exports.RACKS = ['high', 'med', 'low', 'rig', 'sub'];
exports.RACK_LABEL = {
    high: 'High', med: 'Mid', low: 'Low', rig: 'Rig', sub: 'Subsystem',
};
/** hull slot counts, straight from the hull's dogma (ids verified against
 * the bundled data: hiSlots 14, medSlots 13, lowSlots 12, rigSlots 1137,
 * maxSubSystems 1367) */
const RACK_ATTR = { high: 14, med: 13, low: 12, rig: 1137, sub: 1367 };
/**
 * TECH III STRATEGIC CRUISERS HAVE NO SLOTS OF THEIR OWN.
 *
 * Loki, Tengu, Legion and Proteus all publish hiSlots=0, medSlots=0,
 * lowSlots=0 — verified by decoding the bundled typeDogma for 29990 / 29984 /
 * 29986 / 29988. Every slot they fly with comes from the SUBSYSTEMS fitted
 * into them, via hiSlotModifier / medSlotModifier / lowSlotModifier. Reading
 * the hull alone therefore gave a T3 an empty fitting window in the wizard.
 *
 * That makes rack sizes a property of the VARIATION, not of the hull: change
 * a subsystem and the racks resize, exactly as in game.
 */
const RACK_MOD_ATTR = { high: 1374, med: 1375, low: 1376 };
const attrOf = (typeId, attrId, data) => {
    if (typeId === null)
        return 0;
    return data.typeDogma[typeId]?.dogmaAttributes?.find((a) => a.attributeID === attrId)?.value ?? 0;
};
/**
 * Rack sizes for a hull, plus whatever the fitted subsystems add. Pass the
 * variation's `sub` rack; omit it for a brand-new fit, where a T3 genuinely
 * has nothing yet (the racks fill in as subsystems are chosen).
 */
function rackSizes(hullId, data, subSlots = []) {
    const attrs = data.typeDogma[hullId]?.dogmaAttributes ?? [];
    const out = {};
    for (const r of exports.RACKS) {
        const base = Math.round(attrs.find((a) => a.attributeID === RACK_ATTR[r])?.value ?? 0);
        const modAttr = RACK_MOD_ATTR[r];
        const fromSubs = modAttr === undefined
            ? 0
            : subSlots.reduce((n, sl) => n + Math.round(attrOf(sl.typeId, modAttr, data)), 0);
        out[r] = Math.max(0, base + fromSubs);
    }
    return out;
}
/** which rack a module type goes into, from ITS OWN fitting effect
 * (11 loPower / 12 hiPower / 13 medPower / 2663 rigSlot / 3772 subSystem) */
function rackForModule(typeId, data) {
    const effects = data.typeDogma[typeId]?.dogmaEffects ?? [];
    for (const e of effects) {
        if (e.effectID === 12)
            return 'high';
        if (e.effectID === 13)
            return 'med';
        if (e.effectID === 11)
            return 'low';
        if (e.effectID === 2663)
            return 'rig';
        if (e.effectID === 3772)
            return 'sub';
    }
    return null;
}
const newId = () => `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
function emptyVariation(name, sizes) {
    const slots = (n) => Array.from({ length: n }, () => ({ typeId: null }));
    return {
        id: newId(), name,
        high: slots(sizes.high), med: slots(sizes.med), low: slots(sizes.low),
        rig: slots(sizes.rig), sub: slots(sizes.sub),
        drones: [], cargo: [],
    };
}
function cloneVariation(v, name) {
    return { ...JSON.parse(JSON.stringify(v)), id: newId(), name };
}
function newWizardFit(name, hullId, sizes) {
    return { id: newId(), name, hullId, variations: [emptyVariation('Core', sizes)] };
}
/** the exact in-game saved-fit name the user specced: "<fit> - <variation>" */
const fitVariationName = (fit, v) => `${fit.name} - ${v.name}`;
exports.fitVariationName = fitVariationName;
/** serialize a variation to EFT — the SAME pipeline every other fit view
 * uses (parse → relevance → dogma stats), one code path, one set of gates.
 * Module↔charge pairing is PRESERVED as inline "Module, Charge" lines (the
 * wizard is the one place the pairing is authoritatively known), so the
 * dogma engine simulates modules LOADED. Hole/null slot entries (from any
 * historical corruption) are skipped defensively. */
function variationEft(fit, v) {
    const items = [];
    const rackFlag = { high: 'HiSlot', med: 'MedSlot', low: 'LoSlot', rig: 'RigSlot', sub: 'SubSystemSlot' };
    for (const r of exports.RACKS) {
        v[r].forEach((s, i) => {
            if (!s || s.typeId === null)
                return;
            items.push({
                type_id: s.typeId, quantity: 1, flag: `${rackFlag[r]}${i}`, chargeTypeId: s.chargeTypeId,
                // EFT can express OFFLINE; it has no notation for overheated, so a
                // copied fit carries the module online (stated in the UI)
                offline: s.state === 'offline',
            });
        });
    }
    for (const d of v.drones)
        items.push({ type_id: d.typeId, quantity: d.qty, flag: 'DroneBay' });
    for (const c of v.cargo)
        items.push({ type_id: c.typeId, quantity: c.qty, flag: 'Cargo' });
    return (0, fitSerial_1.toEft)((0, fitSerial_1.typeNameOf)(fit.hullId), (0, exports.fitVariationName)(fit, v), items);
}
/** EVE MULTIBUY lines ("Item Name<TAB>qty", qty omitted when 1 — the
 * in-game parser accepts name-whitespace-quantity) covering hull, modules,
 * charges, drones, and cargo spares. Charges count ONLY when their module
 * exists — every view must agree on what the fit contains. */
function buyList(fit, v) {
    const counts = new Map();
    const add = (typeId, qty) => counts.set(typeId, (counts.get(typeId) ?? 0) + qty);
    add(fit.hullId, 1);
    for (const r of exports.RACKS) {
        for (const s of v[r]) {
            if (!s || s.typeId === null)
                continue;
            add(s.typeId, 1);
            if (s.chargeTypeId !== undefined)
                add(s.chargeTypeId, 1);
        }
    }
    for (const d of v.drones)
        add(d.typeId, d.qty);
    for (const c of v.cargo)
        add(c.typeId, c.qty);
    return [...counts.entries()]
        .map(([t, q]) => (q > 1 ? `${(0, fitSerial_1.typeNameOf)(t)}\t${q}` : (0, fitSerial_1.typeNameOf)(t)))
        .join('\n');
}
/** ESI's fitting name limit (swagger: name maxLength 50, minLength 1) */
exports.ESI_FIT_NAME_MAX = 50;
/**
 * Build the POST /characters/{id}/fittings/ body for one variation.
 * Slot flags follow ESI's enum (HiSlot0…7, MedSlot0…7, LoSlot0…7,
 * RigSlot0…2, SubSystemSlot0…3); a LOADED charge rides as a Cargo entry
 * (the in-game fitting service stores ammo that way) and drones as
 * DroneBay. Slots beyond ESI's per-rack maximum, and items past the
 * 512-entry cap, are REPORTED — never silently dropped.
 */
function toEsiFitting(fit, v) {
    const ESI_MAX = { high: 8, med: 8, low: 8, rig: 3, sub: 4 };
    const flagBase = {
        high: 'HiSlot', med: 'MedSlot', low: 'LoSlot', rig: 'RigSlot', sub: 'SubSystemSlot',
    };
    const items = [];
    const skipped = [];
    const charges = new Map();
    for (const r of exports.RACKS) {
        v[r].forEach((s, i) => {
            if (!s || s.typeId === null)
                return;
            if (i >= ESI_MAX[r]) {
                skipped.push(`${(0, fitSerial_1.typeNameOf)(s.typeId)} (${exports.RACK_LABEL[r]} slot ${i + 1} — beyond what EVE stores)`);
                return;
            }
            items.push({ type_id: s.typeId, flag: `${flagBase[r]}${i}`, quantity: 1 });
            if (s.chargeTypeId !== undefined)
                charges.set(s.chargeTypeId, (charges.get(s.chargeTypeId) ?? 0) + 1);
        });
    }
    for (const [typeId, qty] of charges)
        items.push({ type_id: typeId, flag: 'Cargo', quantity: qty });
    for (const d of v.drones)
        items.push({ type_id: d.typeId, flag: 'DroneBay', quantity: d.qty });
    for (const c of v.cargo)
        items.push({ type_id: c.typeId, flag: 'Cargo', quantity: c.qty });
    if (items.length > 512) {
        for (const extra of items.splice(512))
            skipped.push(`${(0, fitSerial_1.typeNameOf)(extra.type_id)} ×${extra.quantity} (over EVE's 512-item limit)`);
    }
    const fullName = (0, exports.fitVariationName)(fit, v);
    const name = fullName.slice(0, exports.ESI_FIT_NAME_MAX);
    return {
        payload: {
            name,
            description: `Saved by EVE Conductor — ${fullName}`.slice(0, 500),
            ship_type_id: fit.hullId,
            items,
        },
        nameTruncated: name !== fullName,
        skipped,
    };
}
/** Build the ENGINE's fit shape straight from a variation — EFT text has no
 * notation for overheating, so the live stats path must not round-trip
 * through it. (Copy/skill-maxer still use variationEft.) */
/**
 * The wizard's own engine fit. IT MUST OBEY THE SAME DRONE RULE AS
 * toEsfFit — it did not, and reported several flights' DPS for a fit the
 * Fit Library scored correctly, because the bandwidth/5-drone limit was
 * written into toEsfFit only. Returns the benched drones alongside, so the
 * stats panel can name them here too.
 */
function variationEsfFitFull(fit, v, data) {
    const modules = [];
    const drones = [];
    const ENGINE_SLOT = {
        high: 'High', med: 'Medium', low: 'Low', rig: 'Rig', sub: 'SubSystem',
    };
    const ENGINE_STATE = {
        offline: 'Passive', online: 'Online', active: 'Active', overload: 'Overload',
    };
    for (const r of exports.RACKS) {
        v[r].forEach((s, i) => {
            if (!s || s.typeId === null)
                return;
            const passiveRack = r === 'rig' || r === 'sub';
            const state = passiveRack ? 'Passive' : ENGINE_STATE[s.state ?? 'active'];
            modules.push({
                type_id: s.typeId,
                slot: { type: ENGINE_SLOT[r], index: i + 1 },
                state,
                ...(s.chargeTypeId !== undefined ? { charge: { type_id: s.chargeTypeId } } : {}),
            });
        });
    }
    // ONE rule for what is actually in space, shared with toEsfFit
    const alloc = (0, dogmaFit_1.allocateDrones)(fit.hullId, v.drones.map((d) => ({ typeId: d.typeId, name: (0, fitSerial_1.typeNameOf)(d.typeId), qty: d.qty })), data);
    drones.push(...alloc.drones);
    return {
        esfFit: { ship_type_id: fit.hullId, modules, drones, implants: [] },
        benchedDrones: alloc.benchedDrones,
    };
}
/** back-compat shape for callers that only want the fit */
function variationEsfFit(fit, v, data) {
    return variationEsfFitFull(fit, v, data).esfFit;
}
/** reconcile a fit's stored rack arrays with the CURRENT data bundle's slot
 * counts (CCP moves slots in balance patches; stored fits predate that).
 * Short racks pad with empties; modules in TRUNCATED slots move to cargo —
 * visibly reported, never silently dropped (they'd otherwise flow into the
 * EFT/stats from slots the wheel doesn't even render). */
function normalizeFitLayout(fit, 
/** PER VARIATION: a T3's rack sizes depend on its own subsystems, so one
 * shared size map would resize every variation to whichever one was asked
 * about. Callers pass `(v) => rackSizes(hullId, data, v.sub)`. */
sizesFor) {
    const moved = [];
    let changed = false;
    const variations = fit.variations.map((v) => {
        const sizes = typeof sizesFor === 'function' ? sizesFor(v) : sizesFor;
        const nv = { ...v, cargo: v.cargo.map((c) => ({ ...c })) };
        for (const r of exports.RACKS) {
            const cur = v[r] ?? [];
            // explicit index walk: Array.some SKIPS holes in sparse arrays, and
            // holes are exactly what historical out-of-bounds writes left behind
            let dirty = cur.length !== sizes[r];
            for (let i = 0; i < cur.length && !dirty; i++)
                if (!cur[i])
                    dirty = true;
            if (dirty)
                changed = true;
            const dense = Array.from({ length: Math.max(cur.length, sizes[r]) }, (_, i) => cur[i] ?? { typeId: null });
            for (const s of dense.slice(sizes[r])) {
                if (s.typeId !== null) {
                    moved.push((0, fitSerial_1.typeNameOf)(s.typeId));
                    const row = nv.cargo.find((c) => c.typeId === s.typeId);
                    if (row)
                        row.qty += 1;
                    else
                        nv.cargo.push({ typeId: s.typeId, qty: 1 });
                }
            }
            nv[r] = dense.slice(0, sizes[r]);
        }
        return nv;
    });
    return { fit: { ...fit, variations }, movedToCargo: moved, changed: changed || moved.length > 0 };
}
