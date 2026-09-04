"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.attrName = void 0;
exports.summarize = summarize;
// THE NUMBERS A FIT IS ACTUALLY JUDGED BY — damage, tank, speed, targeting
// — computed from the dogma engine's own per-item results (post-skills,
// post-stacking), not from raw SDE values.
//
// STATED ASSUMPTIONS (shown in the UI, never hidden):
//  · DPS is sustained-with-no-reload, every ACTIVE weapon firing, drones
//    in space. Overheated modules use their overloaded numbers.
//  · EHP uses an even 25/25/25/25 damage profile (the engine's default).
//  · Weapon range/tracking/application are NOT modelled — this is raw
//    output, the same caveat every "paper DPS" number carries.
const skillRelevance_1 = require("./skillRelevance");
/** attribute ids (verified against the bundled data) */
const A = {
    damageMultiplier: 64,
    cycleSpeed: 51,
    duration: 73,
    em: 114,
    explosive: 116,
    kinetic: 117,
    thermal: 118,
    shieldCapacity: 263,
    armorHP: 265,
    structureHP: 9,
    shieldRes: [271, 272, 273, 274], // em, explosive, kinetic, thermal
    armorRes: [267, 268, 269, 270],
    hullRes: [113, 111, 109, 110],
    maxVelocity: 37,
    mass: 4,
    agility: 70,
    warpSpeedMultiplier: 600,
    baseWarpSpeed: 1281,
    maxTargetRange: 76,
    scanResolution: 564,
    signatureRadius: 552,
    maxLockedTargets: 192,
    droneBandwidth: 1271,
    droneCapacity: 283,
    // range/application, verified against the bundled data:
    optimal: 54, // maxRange
    falloff: 158,
    tracking: 160, // trackingSpeed
    flightTime: 281, // explosionDelay, ms — missiles
};
const val = (attributes, id) => {
    let e;
    if (attributes instanceof Map)
        e = attributes.get(id);
    else if (attributes && typeof attributes === 'object')
        e = attributes[String(id)];
    if (!e)
        return undefined;
    const v = e.value ?? e.base_value;
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};
const num = (attributes, id, dflt = 0) => val(attributes, id) ?? dflt;
const damageSum = (attributes) => num(attributes, A.em) + num(attributes, A.explosive) + num(attributes, A.kinetic) + num(attributes, A.thermal);
const isActive = (state) => state === 'Active' || state === 'Overload';
/** one weapon's contribution, from the ENGINE's computed attributes */
function weaponDamage(item) {
    const cycleMs = num(item.attributes, A.cycleSpeed) || num(item.attributes, A.duration);
    if (cycleMs <= 0)
        return null;
    const mult = val(item.attributes, A.damageMultiplier) ?? 1;
    // turret/launcher: the CHARGE carries the damage; drones/smartbombs
    // carry it themselves
    const own = damageSum(item.attributes);
    const charge = item.charge ? damageSum(item.charge.attributes) : 0;
    const volley = charge > 0 ? charge * mult : own * mult;
    if (volley <= 0)
        return null;
    return { dps: volley / (cycleMs / 1000), volley };
}
function summarize(result) {
    const h = result.hull.attributes;
    const weapons = [];
    let dps = 0;
    let volley = 0;
    let droneBandwidthUsed = 0;
    for (const item of result.items) {
        const slotType = typeof item.slot === 'string' ? item.slot : item.slot?.type;
        const isDrone = slotType === undefined || slotType === 'None';
        if (!isActive(item.state))
            continue;
        const d = weaponDamage(item);
        if (d) {
            dps += d.dps;
            volley += d.volley;
            // range comes from the ENGINE's post-skill numbers, and for missiles
            // from the charge itself (velocity × flight time)
            const optimal = val(item.attributes, A.optimal);
            const falloff = val(item.attributes, A.falloff);
            const tracking = val(item.attributes, A.tracking);
            const mv = item.charge ? val(item.charge.attributes, A.maxVelocity) : undefined;
            const ft = item.charge ? val(item.charge.attributes, A.flightTime) : undefined;
            weapons.push({
                typeId: item.type_id,
                dps: d.dps,
                volley: d.volley,
                chargeTypeId: item.charge?.type_id,
                optimal,
                falloff,
                tracking,
                missileRange: mv !== undefined && ft !== undefined ? (mv * ft) / 1000 : undefined,
            });
        }
        if (isDrone)
            droneBandwidthUsed += num(item.attributes, A.droneBandwidth);
    }
    weapons.sort((a, b) => b.dps - a.dps);
    /** average effective HP across an even damage profile */
    const layerEhp = (hp, resIds) => {
        const res = resIds.map((id) => num(h, id, 1));
        const avgRes = res.reduce((s, r) => s + r, 0) / res.length;
        return avgRes > 0 ? hp / avgRes : hp;
    };
    const shieldHp = num(h, A.shieldCapacity);
    const armorHp = num(h, A.armorHP);
    const structureHp = num(h, A.structureHP);
    const shieldEhp = layerEhp(shieldHp, A.shieldRes);
    const armorEhp = layerEhp(armorHp, A.armorRes);
    const structureEhp = layerEhp(structureHp, A.hullRes);
    const mass = num(h, A.mass);
    const agility = num(h, A.agility);
    // align completes at 75% of max speed ⇒ −ln(0.25) = ln(4) ≈ 1.386
    // (ln 2 is the half-life and gave a Rifter an impossible 1.6 s)
    const alignTime = mass > 0 && agility > 0 ? (Math.log(4) * agility * mass) / 1000000 : 0;
    return {
        dps, volley, weapons,
        ehp: shieldEhp + armorEhp + structureEhp,
        shieldEhp, armorEhp, structureEhp,
        shieldHp, armorHp, structureHp,
        maxVelocity: num(h, A.maxVelocity),
        alignTime,
        warpSpeed: num(h, A.baseWarpSpeed, 1) * num(h, A.warpSpeedMultiplier, 1),
        targetRange: num(h, A.maxTargetRange),
        scanResolution: num(h, A.scanResolution),
        signatureRadius: num(h, A.signatureRadius),
        lockedTargets: num(h, A.maxLockedTargets),
        droneBandwidthUsed,
        droneBandwidth: num(h, A.droneBandwidth),
    };
}
/** display name for an attribute id (for the weapon breakdown tooltips) */
const attrName = (id) => (0, skillRelevance_1.attrDef)(id)?.name ?? `#${id}`;
exports.attrName = attrName;
