"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SKILL_IDS_CARGO = void 0;
exports.computeShipCargo = computeShipCargo;
exports.cargoBreakdown = cargoBreakdown;
exports.SKILL_IDS_CARGO = {
    transportShips: 19719,
    industrialCommandShips: 29637,
};
/** raceID → racial Industrial / Freighter skill typeID */
const RACE_INDUSTRIAL = { 1: 3342, 2: 3341, 4: 3343, 8: 3340 };
const RACE_FREIGHTER = { 1: 20526, 2: 20528, 4: 20524, 8: 20527 };
const GROUP = { industrial: 28, dst: 380, blockadeRunner: 1202, freighter: 513, jumpFreighter: 902, ics: 941 };
const BAY_LABELS = {
    ore: 'ore hold',
    ammo: 'ammo hold',
    mineral: 'mineral hold',
    pi: 'planetary hold',
};
/**
 * `skills` is a typeID→level map (null when not logged in → base values).
 * `mods` are the ship's actual fitted cargo modules (owned ships only).
 * Expanders/rigs apply to the main cargo bay only, multiplicatively —
 * cargo multipliers are not stacking-penalized in EVE.
 */
function computeShipCargo(t, skills, mods) {
    const lvl = (id) => (id && skills ? (skills[id] ?? 0) : 0);
    const bonus = (id) => 1 + 0.05 * lvl(id);
    let cargoBay = t.cargo ?? 0;
    const bays = { ...(t.bays ?? {}) };
    let fleetHangar = bays.fleet ?? 0;
    delete bays.fleet;
    switch (t.group) {
        case GROUP.industrial: {
            const racial = RACE_INDUSTRIAL[t.race ?? 0];
            const specialist = Object.keys(bays).length > 0;
            if (specialist) {
                for (const k of Object.keys(bays))
                    bays[k] *= bonus(racial);
            }
            else {
                cargoBay *= bonus(racial);
            }
            break;
        }
        case GROUP.dst:
            fleetHangar *= bonus(exports.SKILL_IDS_CARGO.transportShips);
            break;
        case GROUP.blockadeRunner:
            cargoBay *= bonus(exports.SKILL_IDS_CARGO.transportShips);
            break;
        case GROUP.freighter:
        case GROUP.jumpFreighter:
            cargoBay *= bonus(RACE_FREIGHTER[t.race ?? 0]);
            break;
        case GROUP.ics:
            if (bays.ore)
                bays.ore *= bonus(exports.SKILL_IDS_CARGO.industrialCommandShips);
            break;
    }
    for (const m of mods?.expanderMultipliers ?? [])
        cargoBay *= m;
    for (const r of mods?.rigBonusesPct ?? [])
        cargoBay *= 1 + r / 100;
    return {
        general: Math.floor(cargoBay + fleetHangar),
        cargoBay: Math.floor(cargoBay),
        fleetHangar: Math.floor(fleetHangar),
        restricted: Object.entries(bays)
            .filter(([, size]) => size && size > 0)
            .map(([k, size]) => ({ label: BAY_LABELS[k] ?? k, size: Math.floor(size) })),
    };
}
const fmt = (n) => n.toLocaleString('en-US');
/** "5,000 cargo + 62,500 fleet hangar = 67,500 m³ · ore hold 52,500 (ore only)" */
function cargoBreakdown(r) {
    const parts = [];
    let main = `${fmt(r.cargoBay)} cargo`;
    if (r.fleetHangar > 0)
        main += ` + ${fmt(r.fleetHangar)} fleet hangar = ${fmt(r.general)} m³`;
    else
        main += ' m³';
    parts.push(main);
    for (const b of r.restricted)
        parts.push(`${b.label} ${fmt(b.size)} (${b.label.split(' ')[0]} only)`);
    return parts.join(' · ');
}
