// Builds src/data/typedb.json from the Fuzzwork SDE dump + ESI packaged volumes.
// Output: array of [typeID, typeName, packagedVolume] for every published market item.
// Rerun with `npm run build:typedb` after EVE expansions add new items.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, '.sde-cache');
mkdirSync(cacheDir, { recursive: true });

const UA = { 'User-Agent': 'eve-trade-conductor typedb build (beta build)' };

async function download(name) {
  const csv = path.join(cacheDir, `${name}.csv`);
  if (!existsSync(csv)) {
    console.log(`downloading ${name}.csv ...`);
    const res = await fetch(`https://www.fuzzwork.co.uk/dump/latest/csv/${name}.csv`, {
      headers: UA,
    });
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    writeFileSync(csv, Buffer.from(await res.arrayBuffer()));
  }
  // strip UTF-8 BOM — the dump files start with one and it corrupts the first header
  return readFileSync(csv, 'utf8').replace(/^﻿/, '');
}

// Minimal RFC-4180 CSV parser — invTypes has quoted multiline descriptions,
// so naive line splitting corrupts the data.
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

const [typesCsv, groupsCsv, marketGroupsCsv] = await Promise.all([
  download('invTypes'),
  download('invGroups'),
  download('invMarketGroups'),
]);

// groupID -> categoryID (category 6 = Ship: the only category whose packaged
// volume differs meaningfully from the SDE volume)
const groupCategory = new Map();
for (const r of parseCSV(groupsCsv).slice(1)) groupCategory.set(r[0], Number(r[1]));

// marketGroupID -> root market group name ("Ships", "Minerals", …) for the
// dashboard's per-category analytics
const mgRows = parseCSV(marketGroupsCsv);
const mgCol = Object.fromEntries(mgRows[0].map((h, i) => [h, i]));
const mgParent = new Map();
const mgName = new Map();
for (const r of mgRows.slice(1)) {
  if (r.length < mgRows[0].length) continue;
  const id = r[mgCol.marketGroupID];
  mgParent.set(id, r[mgCol.parentGroupID]);
  mgName.set(id, r[mgCol.marketGroupName]);
}
function rootMarketGroup(id) {
  let cur = id;
  for (let i = 0; i < 12; i++) {
    const parent = mgParent.get(cur);
    if (!parent || parent === 'None' || parent === '' || !mgName.has(parent)) break;
    cur = parent;
  }
  return mgName.get(cur) ?? 'Other';
}
const catNames = [];
const catIndex = new Map(); // root name -> index
function catIdxFor(marketGroupID) {
  const name = rootMarketGroup(marketGroupID);
  if (!catIndex.has(name)) {
    catIndex.set(name, catNames.length);
    catNames.push(name);
  }
  return catIndex.get(name);
}

const typeRows = parseCSV(typesCsv);
const header = typeRows[0];
const col = Object.fromEntries(header.map((h, i) => [h, i]));

const items = []; // [id, name, volume] — ships get volume patched below
const shipIds = [];
const shipMeta = new Map(); // id -> {group, race}
for (const r of typeRows.slice(1)) {
  if (r.length < header.length) continue;
  if (r[col.published] !== '1') continue;
  const marketGroupID = r[col.marketGroupID];
  if (marketGroupID === 'None' || marketGroupID === '') continue;
  const id = Number(r[col.typeID]);
  items.push([id, r[col.typeName], Number(r[col.volume]) || 0, catIdxFor(marketGroupID)]);
  if (groupCategory.get(r[col.groupID]) === 6) {
    shipIds.push(id);
    shipMeta.set(id, { group: Number(r[col.groupID]), race: Number(r[col.raceID]) || 0 });
  }
}

// Packaged (repackaged) ship volumes + cargo bays from ESI, cached across runs.
// The SDE dump's invVolumes.csv is empty as of 2026-07 (see LEARNINGS/API-NOTES.md).
// v3 cache adds bay capacities from dogma (attribute ids verified live 2026-07-16):
// 912 fleet hangar · 1556 ore hold · 1557 ammo hold · 1558 mineral hold · 1653 PI hold
const BAY_ATTRS = { 912: 'fleet', 1556: 'ore', 1557: 'ammo', 1558: 'mineral', 1653: 'pi' };
const pvCachePath = path.join(cacheDir, 'packaged-volumes-v3.json');
const pvCache = existsSync(pvCachePath) ? JSON.parse(readFileSync(pvCachePath, 'utf8')) : {};
const missing = shipIds.filter((id) => pvCache[id] === undefined);
console.log(`${items.length} market types, ${shipIds.length} ships, ${missing.length} ship details to fetch from ESI`);

const CONCURRENCY = 20;
let fetched = 0;
async function worker(queue) {
  for (;;) {
    const id = queue.pop();
    if (id === undefined) return;
    const res = await fetch(`https://esi.evetech.net/latest/universe/types/${id}/`, { headers: UA });
    if (!res.ok) throw new Error(`ESI type ${id}: HTTP ${res.status}`);
    const j = await res.json();
    const bays = {};
    for (const a of j.dogma_attributes ?? []) {
      const bay = BAY_ATTRS[a.attribute_id];
      if (bay && a.value > 0) bays[bay] = a.value;
    }
    pvCache[id] = { pv: j.packaged_volume ?? j.volume ?? 0, cap: j.capacity ?? 0, bays };
    if (++fetched % 100 === 0) console.log(`  ${fetched}/${missing.length}`);
  }
}
if (missing.length) {
  const queue = [...missing];
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  writeFileSync(pvCachePath, JSON.stringify(pvCache));
}

// ships extend to: [id, name, pv, catIdx, cargoCap, groupID, raceID, baysObj]
for (const it of items) {
  const entry = pvCache[it[0]];
  if (entry !== undefined) {
    const meta = shipMeta.get(it[0]) ?? { group: 0, race: 0 };
    it[2] = entry.pv;
    it.push(entry.cap, meta.group, meta.race, entry.bays ?? {});
  }
}

items.sort((a, b) => a[1].localeCompare(b[1]));

const outDir = path.join(root, 'src', 'data');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'typedb.json');
writeFileSync(outFile, JSON.stringify({ cats: catNames, items }));
console.log(
  `wrote ${items.length} market types (${catNames.length} categories) to ${path.relative(root, outFile)}`,
);
