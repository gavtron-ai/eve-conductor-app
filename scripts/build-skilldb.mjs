// Builds src/data/skilldb.json from the Fuzzwork SDE dump: everything the
// Character Conductor needs to know WHICH skills matter for a ship fit or a
// topic, straight from CCP's own dogma data — no hand-maintained bonus lists.
//
//   skills : every published skill (category 16) with group, rank, prereqs
//            and description (for topic keyword matching + tooltips)
//   req    : required skills per published type (attrs 182/183/184/1285/1289/
//            1290 paired with levels 277/278/279/1286/1287/1288 — the 4-6
//            slots pair NON-sequentially; that's the SDE, not a bug here)
//   g      : typeID → groupID for every published type (LocationGroupModifier
//            matching + trait lookups)
//   traits : per-skill ship bonuses from invTraits (skillID -1 = role bonus)
//   mods   : per-skill dogma modifiers parsed from dgmEffects.modifierInfo —
//            the machine-readable "this skill modifies attribute A on items
//            requiring skill S / in group G / on the ship itself"
//   attrs  : display names for every attribute id referenced above
//
// Rerun with `npm run build:skilldb` after expansions.
import { mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, '.sde-cache');
mkdirSync(cacheDir, { recursive: true });

const UA = { 'User-Agent': 'eve-trade-conductor skilldb build (beta build)' };

async function download(name) {
  const csv = path.join(cacheDir, `${name}.csv`);
  if (!existsSync(csv)) {
    console.log(`downloading ${name}.csv ...`);
    const res = await fetch(`https://www.fuzzwork.co.uk/dump/latest/csv/${name}.csv`, {
      headers: UA,
    });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    writeFileSync(csv, Buffer.from(await res.arrayBuffer()));
  } else {
    // stale data must be VISIBLE: "rebuild after an expansion" silently
    // reusing a months-old dump would reproduce the old skilldb byte-for-byte
    const ageDays = Math.round((Date.now() - statSync(csv).mtimeMs) / 86_400_000);
    const warn = ageDays > 60 ? '  ⚠ STALE — delete .sde-cache to refetch the current SDE' : '';
    console.log(`using cached ${name}.csv (${ageDays}d old)${warn}`);
  }
  return readFileSync(csv, 'utf8').replace(/^﻿/, '');
}

function parseCSV(text) {
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const cols = (rows) => Object.fromEntries(rows[0].map((h, i) => [h, i]));
const num = (v) => (v === '' || v === 'None' ? null : Number(v));

const [typesCsv, groupsCsv, attrsCsv, attrTypesCsv, effectsCsv, typeEffectsCsv, traitsCsv, attrCatsCsv, unitsCsv] =
  await Promise.all([
    download('invTypes'),
    download('invGroups'),
    download('dgmTypeAttributes'),
    download('dgmAttributeTypes'),
    download('dgmEffects'),
    download('dgmTypeEffects'),
    download('invTraits'),
    download('dgmAttributeCategories'),
    download('eveUnits'),
  ]);
const metaGroupsCsv = await download('invMetaGroups');

// ---- groups & categories ----
const gRows = parseCSV(groupsCsv);
const gCol = cols(gRows);
const groupCategory = new Map(); // groupID -> categoryID
const groupName = new Map();
for (const r of gRows.slice(1)) {
  if (r.length < gRows[0].length) continue;
  groupCategory.set(Number(r[gCol.groupID]), Number(r[gCol.categoryID]));
  groupName.set(Number(r[gCol.groupID]), r[gCol.groupName]);
}

// ---- types ----
const tRows = parseCSV(typesCsv);
const tCol = cols(tRows);
const published = new Map(); // typeID -> { name, groupId, desc }
for (const r of tRows.slice(1)) {
  if (r.length < tRows[0].length) continue;
  if (r[tCol.published] !== '1') continue;
  const id = Number(r[tCol.typeID]);
  published.set(id, {
    name: r[tCol.typeName],
    groupId: Number(r[tCol.groupID]),
    desc: r[tCol.description] ?? '',
  });
}
const isSkill = (id) => {
  const t = published.get(id);
  return t !== undefined && groupCategory.get(t.groupId) === 16;
};

// ---- dogma type attributes (typeID -> attrID -> value) ----
const aRows = parseCSV(attrsCsv);
const aCol = cols(aRows);
const typeAttrs = new Map();
for (const r of aRows.slice(1)) {
  if (r.length < aRows[0].length) continue;
  const typeId = Number(r[aCol.typeID]);
  if (!published.has(typeId)) continue;
  const v = num(r[aCol.valueFloat]) ?? num(r[aCol.valueInt]);
  if (v === null) continue;
  (typeAttrs.get(typeId) ?? typeAttrs.set(typeId, new Map()).get(typeId)).set(
    Number(r[aCol.attributeID]),
    v,
  );
}

// required-skill attr pairs — the 4th/5th/6th slots pair NON-sequentially in
// the SDE: 1285→1286, 1289→1287, 1290→1288 (verified against ESI type data)
const REQ_PAIRS = [
  [182, 277],
  [183, 278],
  [184, 279],
  [1285, 1286],
  [1289, 1287],
  [1290, 1288],
];
const RANK_ATTR = 275;

function requiredSkillsOf(typeId) {
  const attrs = typeAttrs.get(typeId);
  if (!attrs) return [];
  const out = [];
  for (const [skillAttr, lvlAttr] of REQ_PAIRS) {
    const sid = attrs.get(skillAttr);
    if (sid === undefined) continue;
    const skillId = Math.round(sid);
    if (!published.has(skillId)) continue;
    out.push([skillId, Math.max(1, Math.round(attrs.get(lvlAttr) ?? 1))]);
  }
  return out;
}

// ---- skills ----
const skills = [];
for (const [id, t] of published) {
  if (!isSkill(id)) continue;
  const attrs = typeAttrs.get(id);
  skills.push([
    id,
    t.name,
    groupName.get(t.groupId) ?? '',
    Math.round(attrs?.get(RANK_ATTR) ?? 1),
    requiredSkillsOf(id),
    t.desc.slice(0, 500),
  ]);
}
skills.sort((a, b) => a[0] - b[0]);

// ---- required skills + group id for every published type ----
const req = [];
const g = [];
for (const [id, t] of published) {
  g.push([id, t.groupId]);
  const rs = requiredSkillsOf(id);
  if (rs.length > 0 && !isSkill(id)) req.push([id, rs]);
}
req.sort((a, b) => a[0] - b[0]);
g.sort((a, b) => a[0] - b[0]);

// ---- ship traits (per-skill hull bonuses) ----
const trRows = parseCSV(traitsCsv);
const trCol = cols(trRows);
const traitsByShip = new Map();
for (const r of trRows.slice(1)) {
  if (r.length < trRows[0].length) continue;
  const shipId = Number(r[trCol.typeID]);
  if (!published.has(shipId)) continue;
  const skillId = num(r[trCol.skillID]) ?? -1;
  const bonus = num(r[trCol.bonus]);
  const text = (r[trCol.bonusText] ?? '').replace(/<[^>]+>/g, ''); // strip markup
  const unitId = num(r[trCol.unitID]) ?? 0;
  (traitsByShip.get(shipId) ?? traitsByShip.set(shipId, []).get(shipId)).push([
    skillId > 0 && published.has(skillId) ? skillId : -1,
    bonus ?? 0,
    unitId,
    text,
  ]);
}
const traits = [...traitsByShip.entries()].sort((a, b) => a[0] - b[0]);

// ---- skill modifiers from dgmEffects.modifierInfo ----
// In the Fuzzwork CSV export modifierInfo is a JSON array of
// {domain, func, modifiedAttributeID, modifyingAttributeID, operation,
// skillTypeID?, groupID?} (the raw SDE has YAML; Fuzzwork converts).
function parseModifierInfo(text) {
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const eRows = parseCSV(effectsCsv);
const eCol = cols(eRows);
const effectMods = new Map(); // effectID -> parsed modifier entries
for (const r of eRows.slice(1)) {
  if (r.length < eRows[0].length) continue;
  const info = r[eCol.modifierInfo];
  if (!info || info === 'None') continue;
  effectMods.set(Number(r[eCol.effectID]), parseModifierInfo(info));
}

const teRows = parseCSV(typeEffectsCsv);
const teCol = cols(teRows);
// kinds: 0 = ship-wide (ItemModifier@shipID), 1 = character-wide
// (ItemModifier@charID), 2 = items requiring skill X (extra = skillId),
// 3 = items in group G (extra = groupId), 4 = other/unknown domain
const modsBySkill = new Map();
const usedAttrs = new Set();
for (const r of teRows.slice(1)) {
  if (r.length < teRows[0].length) continue;
  const typeId = Number(r[teCol.typeID]);
  if (!isSkill(typeId)) continue;
  const mods = effectMods.get(Number(r[teCol.effectID]));
  if (!mods) continue;
  for (const m of mods) {
    const attr = Number(m.modifiedAttributeID ?? 0);
    if (!attr) continue;
    let kind = 4;
    let extra = 0;
    if (m.func === 'LocationRequiredSkillModifier' || m.func === 'OwnerRequiredSkillModifier') {
      // owner-required (kind 5) applies to OWNED items — charges/drones —
      // not to fitted modules; conflating them cites the wrong item
      kind = m.func === 'OwnerRequiredSkillModifier' ? 5 : 2;
      // skillTypeID -1 means "this skill itself"
      extra = Number(m.skillTypeID ?? -1);
      if (extra === -1) extra = typeId;
    } else if (m.func === 'LocationGroupModifier') {
      kind = 3;
      extra = Number(m.groupID ?? 0);
    } else if (m.func === 'ItemModifier' || m.func === 'LocationModifier') {
      // itemID/otherID domains are the skill writing its OWN attributes
      // (skill Level, its bonus fields) — noise, not a real "affects"
      if (m.domain === 'itemID' || m.domain === 'otherID') continue;
      kind = m.domain === 'charID' ? 1 : 0;
    }
    usedAttrs.add(attr);
    const list = modsBySkill.get(typeId) ?? modsBySkill.set(typeId, []).get(typeId);
    // dedupe identical descriptors (skills repeat modifiers across effects)
    if (!list.some((x) => x[0] === kind && x[1] === attr && x[2] === extra)) {
      list.push([kind, attr, extra]);
    }
  }
}
const mods = [...modsBySkill.entries()].sort((a, b) => a[0] - b[0]);

// ---- attribute display names (only the referenced ones) ----
// [id, name, hasDisplay] — hasDisplay=0 means the name is CCP's internal
// attributeName (shipBonusAB, warpCapacitorNeed…); the engine filters those
// from user-facing boost lines except for a curated allowlist
const atRows = parseCSV(attrTypesCsv);
const atCol = cols(atRows);
const attrs = [];
for (const r of atRows.slice(1)) {
  if (r.length < atRows[0].length) continue;
  const id = Number(r[atCol.attributeID]);
  if (!usedAttrs.has(id)) continue;
  const disp = r[atCol.displayName];
  const hasDisp = disp && disp !== 'None' ? 1 : 0;
  attrs.push([id, hasDisp ? disp : r[atCol.attributeName], hasDisp]);
}
attrs.sort((a, b) => a[0] - b[0]);

// ---- group → category (charges vs drones vs modules for owner-mods) ----
const gcat = [...new Set(g.map(([, gid]) => gid))]
  .map((gid) => [gid, groupCategory.get(gid) ?? 0])
  .sort((a, b) => a[0] - b[0]);

// ---- names for fittable types the market typedb can't resolve ----
// Abyssal/mutated base types, civilian modules, boosters: published=1 but no
// market group, so typedb (market items only) lacks them — yet fits copied
// from the EVE client contain them and their skill requirements are real.
const FITTABLE_CATS = new Set([7, 8, 18, 20, 32]); // module, charge, drone, implant/booster, subsystem
let typedbIds = new Set();
try {
  const typedb = JSON.parse(readFileSync(path.join(root, 'src', 'data', 'typedb.json'), 'utf8'));
  typedbIds = new Set(typedb.items.map((it) => it[0]));
} catch {
  console.warn('typedb.json unreadable — extra-name table will include ALL fittables');
}
const reqIds = new Set(req.map(([id]) => id));
const extra = [];
for (const [id, t] of published) {
  if (typedbIds.has(id) || !reqIds.has(id)) continue;
  if (!FITTABLE_CATS.has(groupCategory.get(t.groupId) ?? 0)) continue;
  extra.push([id, t.name]);
}
extra.sort((a, b) => a[0] - b[0]);

// ---- FULL attribute metadata (the fitting-window attributes panel) ----
// every attribute: display name (falling back to the internal name), unit,
// category, published flag, highIsGood — so the app can render EVERY
// computed attribute the way the game does, grouped and unit-suffixed.
const unitRows = parseCSV(unitsCsv);
const unitCol = cols(unitRows);
const units = [];
for (const r of unitRows.slice(1)) {
  if (r.length < unitRows[0].length) continue;
  units.push([Number(r[unitCol.unitID]), r[unitCol.displayName] || r[unitCol.unitName]]);
}
const catRows = parseCSV(attrCatsCsv);
const catCol = cols(catRows);
const attrCats = [];
for (const r of catRows.slice(1)) {
  if (r.length < catRows[0].length) continue;
  attrCats.push([Number(r[catCol.categoryID]), r[catCol.categoryName]]);
}
const attrsAll = [];
for (const r of atRows.slice(1)) {
  if (r.length < atRows[0].length) continue;
  const id = Number(r[atCol.attributeID]);
  const disp = r[atCol.displayName];
  const hasDisp = disp && disp !== 'None' ? 1 : 0;
  attrsAll.push([
    id,
    hasDisp ? disp : r[atCol.attributeName],
    num(r[atCol.unitID]) ?? 0,
    num(r[atCol.categoryID]) ?? 0,
    r[atCol.published] === '1' ? 1 : 0,
    r[atCol.highIsGood] === '1' ? 1 : 0,
    // a REAL in-game display name is what decides whether the attributes
    // panel shows a row (published alone hid "Rig Slots" while letting
    // raw camelCase internals through)
    hasDisp,
  ]);
}
attrsAll.sort((a, b) => a[0] - b[0]);

// meta-group names (Tech I / Tech II / Faction / Officer / …) — the module
// browser sorts and buckets variants by these
const metaRows = parseCSV(metaGroupsCsv);
const metaCol = cols(metaRows);
const metaGroups = [];
for (const r of metaRows.slice(1)) {
  if (r.length < metaRows[0].length) continue;
  metaGroups.push([Number(r[metaCol.metaGroupID]), r[metaCol.metaGroupName]]);
}
metaGroups.sort((a, b) => a[0] - b[0]);

const outDir = path.join(root, 'src', 'data');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'skilldb.json');
const payload = { skills, req, g, gcat, traits, mods, attrs, extra, attrsAll, units, attrCats, metaGroups };
writeFileSync(outFile, JSON.stringify(payload));
console.log(
  `wrote ${skills.length} skills, ${req.length} types with requirements, ${g.length} type→group rows, ` +
    `${traits.length} ships with traits, ${mods.length} skills with dogma modifiers, ${attrs.length} attr names, ` +
    `${extra.length} non-market fittable names, ${attrsAll.length} full attribute defs, ${units.length} units, ` +
    `${attrCats.length} attribute categories ` +
    `(${Math.round(readFileSync(outFile).length / 1024)} KB) to ${path.relative(root, outFile)}`,
);
