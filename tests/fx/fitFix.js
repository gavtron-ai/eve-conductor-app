"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeItFit = makeItFit;
exports.capacitorVerdict = capacitorVerdict;
exports.fittingProblems = fittingProblems;
// "MAKE IT FIT" — the fit does not fit; what is the CHEAPEST way to fix it?
//
// A different question from the gap sweep in fitGap.ts. That one asks "what
// does the other character have that I don't". This one asks "this fit is
// over CPU (or power, or calibration) FOR ME — what do I actually have to
// do?", and answers in the order a player would rather hear it:
//
//   1. TRAIN SKILLS      — free, permanent, and helps every future fit
//   2. ONE IMPLANT       — costs ISK, so the CHEAPEST grade that works
//   3. IMPLANT + SKILLS  — when neither alone is enough
//   4. CHANGE THE FIT    — nothing available closes it, and saying so plainly
//                          is more useful than a plan that cannot work
//
// EVERY ANSWER IS MEASURED through the same dogma engine as the fit itself.
// Nothing here is estimated from a percentage: a remedy is only reported once
// running the fit WITH that remedy applied actually produces enough headroom.
// That matters because stacking penalties mean the sum of individual gains is
// not the gain of the combination — quoting the sum would be exactly the
// plausible-but-wrong number this project keeps banning.
const dogmaStats_1 = require("./dogmaStats");
const skillRelevance_1 = require("./skillRelevance");
const typedb_1 = require("./typedb");
const ancillaryTypes_1 = require("./ancillaryTypes");
const fitGap_1 = require("./fitGap");
/**
 * Attributes that make an implant a FITTING implant for a resource. Verified
 * against the bundled catalog: 424 `cpuOutputBonus2` on the Zainou 'Gypsy'
 * CPU line, 313 `powerEngineeringOutputBonus` on Inherent 'Squire'.
 */
const IMPLANT_BONUS_ATTR = {
    cpu: [424],
    power: [313],
    cap: [312],
};
/** Cybernetics — every fitting implant requires it at some level */
const SKILL_CYBERNETICS = 3411;
const ATTR_IMPLANTNESS = 331;
const ATTR_REQ_SKILL = 182;
const ATTR_REQ_LEVEL = 277;
const run = (o, skills, implants) => {
    const imp = implants === undefined ? o.myImplants : implants;
    return o.esfFit
        ? (0, dogmaStats_1.calculateFromEsfFit)(o.esfFit, skills, imp)
        : (0, dogmaStats_1.calculateFitStats)(o.fit, skills, imp);
};
const implantName = (id) => (0, typedb_1.getType)(id)?.name ?? (0, skillRelevance_1.extraTypeName)(id) ?? `implant #${id}`;
async function implantSlots(ids) {
    const out = new Map();
    try {
        const data = await (0, dogmaStats_1.getEsfData)();
        for (const id of ids) {
            const v = data.typeDogma[String(id)]?.dogmaAttributes
                .find((a) => a.attributeID === ATTR_IMPLANTNESS)?.value;
            out.set(id, v === undefined ? null : Math.round(v));
        }
    }
    catch {
        for (const id of ids)
            out.set(id, null);
    }
    return out;
}
/** every fitting implant for a resource, CHEAPEST BONUS FIRST — the user
 * asked for the "lowest required implant", and a +1% hardwiring costs a
 * fraction of a +6% */
async function fittingImplants(resource) {
    const attrs = IMPLANT_BONUS_ATTR[resource];
    if (!attrs)
        return [];
    const out = [];
    try {
        const data = await (0, dogmaStats_1.getEsfData)();
        for (const [idStr, td] of Object.entries(data.typeDogma)) {
            const a = td.dogmaAttributes;
            if (!a.some((x) => x.attributeID === ATTR_IMPLANTNESS))
                continue;
            const bonus = a.find((x) => attrs.includes(x.attributeID))?.value;
            if (bonus === undefined || bonus <= 0)
                continue;
            const reqSkill = a.find((x) => x.attributeID === ATTR_REQ_SKILL)?.value;
            if (reqSkill !== undefined && Math.round(reqSkill) !== SKILL_CYBERNETICS)
                continue;
            const reqLevel = a.find((x) => x.attributeID === ATTR_REQ_LEVEL)?.value ?? 1;
            out.push({ typeId: Number(idStr), bonus, reqLevel: Math.round(reqLevel) });
        }
    }
    catch {
        return [];
    }
    out.sort((a, b) => a.bonus - b.bonus);
    return out;
}
/**
 * How to make an over-budget fit fit, for ONE character and ONE resource.
 * Returns null when it already fits — there is nothing to solve.
 */
async function makeItFit(o) {
    const unit = fitGap_1.RESOURCE_UNIT[o.resource];
    const base = (0, fitGap_1.headroom)(await run(o, o.mine), o.resource);
    if (base >= 0)
        return null;
    const shortBy = -base;
    const EPS = 1e-6;
    const mineImplants = o.myImplants ?? [];
    // candidate skills: THIS character's, below V, that touch this resource
    const watched = new Set(fitGap_1.RESOURCE_ATTRS[o.resource]);
    const trainable = skillRelevance_1.allSkills
        .map((s) => ({ id: s.id, from: o.mine[s.id] ?? 0 }))
        .filter((g) => g.from < 5)
        .filter((g) => (0, skillRelevance_1.skillModAttrs)(g.id).some((a) => watched.has(a)));
    // one run with EVERY candidate at V: the ceiling training can reach, and a
    // cheap way to rule tier 1 out without sweeping at all
    const allTrained = { ...o.mine };
    for (const g of trainable)
        allTrained[g.id] = 5;
    const skillCeiling = trainable.length > 0
        ? (0, fitGap_1.headroom)(await run(o, allTrained), o.resource)
        : base;
    /** measure each candidate on its own, against a given implant set */
    const measure = async (implants) => {
        const rows = [];
        const baseHere = (0, fitGap_1.headroom)(await run(o, o.mine, implants), o.resource);
        for (const g of trainable) {
            if (o.cancelled?.())
                break;
            const gain = (0, fitGap_1.headroom)(await run(o, { ...o.mine, [g.id]: 5 }, implants), o.resource) - baseHere;
            if (gain > EPS) {
                rows.push({ skillId: g.id, name: (0, skillRelevance_1.skillInfo)(g.id)?.name ?? `Skill #${g.id}`, from: g.from, to: 5, gain });
            }
        }
        return rows.sort((a, b) => b.gain - a.gain);
    };
    /** the SMALLEST set that actually closes the gap — greedy by measured gain,
     * then CONFIRMED by running the fit with exactly that set trained */
    const smallestSet = async (rows, implants) => {
        const chosen = [];
        const skills = { ...o.mine };
        for (const r of rows) {
            if (o.cancelled?.())
                break;
            chosen.push(r);
            skills[r.skillId] = 5;
            const got = (0, fitGap_1.headroom)(await run(o, skills, implants), o.resource);
            if (got >= 0)
                return { set: [...chosen], got };
        }
        return null;
    };
    // ---- TIER 1: training alone -------------------------------------------
    if (skillCeiling >= 0) {
        const best = await smallestSet(await measure());
        if (best) {
            return {
                resource: o.resource, unit, shortBy, kind: 'skills', skills: best.set, resulting: best.got,
                summary: best.set.length === 1
                    ? `Train ${best.set[0].name} to V`
                    : `Train to V: ${best.set.map((s) => s.name).join(', ')}`,
            };
        }
    }
    // ---- TIER 2: one implant, the cheapest that works ----------------------
    const implants = await fittingImplants(o.resource);
    const slots = implants.length > 0
        ? await implantSlots([...new Set([...mineImplants, ...implants.map((i) => i.typeId)])])
        : new Map();
    /** plugging one in DISPLACES whatever occupies its slot */
    const withImplant = (typeId) => {
        const slot = slots.get(typeId) ?? null;
        const displaced = slot === null ? undefined : mineImplants.find((m) => slots.get(m) === slot);
        return {
            list: [...mineImplants.filter((m) => m !== displaced), typeId],
            replaces: displaced === undefined ? undefined : { typeId: displaced, name: implantName(displaced) },
        };
    };
    const cyber = o.mine[SKILL_CYBERNETICS] ?? 0;
    let strongest = null;
    for (const i of implants) {
        if (o.cancelled?.())
            break;
        const swap = withImplant(i.typeId);
        let got;
        try {
            got = (0, fitGap_1.headroom)(await run(o, o.mine, swap.list), o.resource);
        }
        catch {
            continue; // no dogma data for it — skip, never count as zero
        }
        if (got >= 0) {
            return {
                resource: o.resource, unit, shortBy, kind: 'implant', skills: [], resulting: got,
                implant: {
                    typeId: i.typeId, name: implantName(i.typeId), bonus: i.bonus,
                    needsCybernetics: i.reqLevel, hasCybernetics: cyber >= i.reqLevel,
                    replaces: swap.replaces,
                },
                summary: `Plug in ${implantName(i.typeId)}${swap.replaces ? ` (replaces ${swap.replaces.name})` : ''}`,
            };
        }
        if (!strongest || i.bonus > strongest.i.bonus)
            strongest = { i, swap };
    }
    // ---- TIER 3: the strongest implant AND training ------------------------
    if (strongest && trainable.length > 0 && !o.cancelled?.()) {
        const best = await smallestSet(await measure(strongest.swap.list), strongest.swap.list);
        if (best) {
            const i = strongest.i;
            return {
                resource: o.resource, unit, shortBy, kind: 'implant+skills', skills: best.set, resulting: best.got,
                implant: {
                    typeId: i.typeId, name: implantName(i.typeId), bonus: i.bonus,
                    needsCybernetics: i.reqLevel, hasCybernetics: cyber >= i.reqLevel,
                    replaces: strongest.swap.replaces,
                },
                summary: `${implantName(i.typeId)} + train ${best.set.map((s) => s.name).join(', ')} to V`,
            };
        }
    }
    // ---- TIER 4: it cannot be trained or implanted into fitting -------------
    return {
        resource: o.resource, unit, shortBy, kind: 'impossible', skills: [],
        resulting: Math.max(skillCeiling, base),
        summary: 'Nothing closes this — the fit itself has to change',
    };
}
/**
 * Is capacitor a real problem for this fit? `groupOf` resolves a type id to
 * its inventory group (injected so this stays testable without the catalog).
 */
function capacitorVerdict(stats, fit) {
    const ancillaries = (fit?.items ?? []).filter((i) => (0, ancillaryTypes_1.isAncillary)(i.typeId));
    // a module is "loaded" when the parsed fit gave it at least one charge
    const unloaded = ancillaries.filter((i) => (i.charges ?? []).length === 0).map((i) => i.name);
    // depletesIn < 0 is the engine's "stable" sentinel
    const dry = stats.cap.depletesIn >= 0;
    if (!dry)
        return { runsDry: false, unloaded, unknown: false };
    if (unloaded.length > 0)
        return { runsDry: false, unloaded, unknown: true };
    return { runsDry: true, unloaded, unknown: false };
}
/** the resources that genuinely stop this fit working, worst first */
function fittingProblems(stats, fit) {
    const out = [];
    // HARD limits — over these the fit cannot be fitted at all
    for (const r of ['cpu', 'power', 'calibration']) {
        if ((0, fitGap_1.headroom)(stats, r) < 0)
            out.push(r);
    }
    const cap = capacitorVerdict(stats, fit);
    if (cap.runsDry)
        out.push('cap');
    return { resources: out, cap };
}
