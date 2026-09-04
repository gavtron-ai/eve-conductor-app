// Builds src/data/mapdata.json from the Fuzzwork SDE dump: the stargate graph
// (for "within N jumps" searches), K-space systems, and NPC stations.
// Rerun with `npm run build:mapdata` after map-changing expansions.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cacheDir = path.join(root, '.sde-cache');
mkdirSync(cacheDir, { recursive: true });

const UA = { 'User-Agent': 'eve-trade-conductor mapdata build (beta build)' };

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

const [systemsCsv, jumpsCsv, stationsCsv, regionsCsv] = await Promise.all([
  download('mapSolarSystems'),
  download('mapSolarSystemJumps'),
  download('staStations'),
  download('mapRegions'),
]);

const regRows = parseCSV(regionsCsv);
const regCol = Object.fromEntries(regRows[0].map((h, i) => [h, i]));
const regions = [];
for (const r of regRows.slice(1)) {
  if (r.length < regRows[0].length) continue;
  regions.push([Number(r[regCol.regionID]), r[regCol.regionName]]);
}

const sysRows = parseCSV(systemsCsv);
const sysCol = Object.fromEntries(sysRows[0].map((h, i) => [h, i]));
// K-space only: J-space (wormhole) systems have no stargates and IDs >= 31000000
const systems = [];
for (const r of sysRows.slice(1)) {
  if (r.length < sysRows[0].length) continue;
  const id = Number(r[sysCol.solarSystemID]);
  if (id >= 31000000) continue;
  // EVE's DISPLAY rounding: true sec in (0, 0.05) rounds UP to 0.1 (those
  // systems are lowsec in-game — Egbinger et al.); plain rounding wrongly
  // made 13 of them 0.0 "nullsec", and the ESS list believed it.
  const trueSec = Number(r[sysCol.security]);
  const dispSec = trueSec > 0 && trueSec < 0.05 ? 0.1 : Math.round(trueSec * 10) / 10;
  systems.push([
    id,
    r[sysCol.solarSystemName],
    Number(r[sysCol.regionID]),
    dispSec,
  ]);
}

const jmpRows = parseCSV(jumpsCsv);
const jmpCol = Object.fromEntries(jmpRows[0].map((h, i) => [h, i]));
const jumps = [];
for (const r of jmpRows.slice(1)) {
  if (r.length < jmpRows[0].length) continue;
  const a = Number(r[jmpCol.fromSolarSystemID]);
  const b = Number(r[jmpCol.toSolarSystemID]);
  if (a < b) jumps.push([a, b]); // dump lists both directions; keep one
}

const staRows = parseCSV(stationsCsv);
const staCol = Object.fromEntries(staRows[0].map((h, i) => [h, i]));
const stations = [];
for (const r of staRows.slice(1)) {
  if (r.length < staRows[0].length) continue;
  stations.push([
    Number(r[staCol.stationID]),
    Number(r[staCol.solarSystemID]),
    r[staCol.stationName],
  ]);
}

const outDir = path.join(root, 'src', 'data');
mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, 'mapdata.json');
writeFileSync(outFile, JSON.stringify({ systems, jumps, stations, regions }));
console.log(
  `wrote ${systems.length} systems, ${jumps.length} gate links, ${stations.length} NPC stations, ${regions.length} regions to ${path.relative(root, outFile)}`,
);
