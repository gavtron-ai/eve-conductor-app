// PI FACTORY SCHEMATICS — what each factory consumes and produces, EXACTLY.
//
// ESI tells us which schematic a factory runs (factory_details.schematic_id)
// but NOT the recipe — /universe/schematics/{id}/ returns only name + cycle
// time. The recipes live in the SDE. Fuzzwork publishes the two tables as tiny
// CSVs (~10 KB total, CORS-open — probed 2026-08-26: Access-Control-Allow-
// Origin *), and the data is STATIC game design (unchanged since 2010), so
// they are fetched once and cached in localStorage forever. No guessing: every
// rate shown traces to the SDE rows.
//   planetSchematics.csv        schematicID,schematicName,cycleTime
//   planetSchematicsTypeMap.csv schematicID,typeID,quantity,isInput

const BASE = 'https://www.fuzzwork.co.uk/dump/latest/csv';
const CACHE_KEY = 'etc-pi-schematics-v1';

export interface Schematic {
  id: number;
  name: string;
  cycleTime: number; // seconds
  inputs: { typeId: number; qty: number }[];
  output: { typeId: number; qty: number } | null;
}

/** parse one fuzzwork CSV line: quoted fields, numeric content */
export function csvCells(line: string): string[] {
  return line.replace(/^﻿/, '').split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
}

/** PURE: the two CSV bodies → schematic map (exported for the fixture) */
export function parseSchematics(schemCsv: string, mapCsv: string): Map<number, Schematic> {
  const out = new Map<number, Schematic>();
  for (const line of schemCsv.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [id, name, cycle] = csvCells(line);
    const sid = Number(id);
    if (!Number.isFinite(sid)) continue;
    out.set(sid, { id: sid, name, cycleTime: Number(cycle) || 3600, inputs: [], output: null });
  }
  for (const line of mapCsv.split(/\r?\n/).slice(1)) {
    if (!line.trim()) continue;
    const [id, typeId, qty, isInput] = csvCells(line);
    const s = out.get(Number(id));
    if (!s) continue;
    const row = { typeId: Number(typeId), qty: Number(qty) };
    if (isInput === '1') s.inputs.push(row);
    else s.output = row;
  }
  return out;
}

/** PURE: per-hour rates for one schematic — inputs consumed and output made
 * by ONE factory running it back to back */
export function schematicPerHour(s: Schematic): {
  inputs: { typeId: number; perHour: number }[];
  output: { typeId: number; perHour: number } | null;
  inTotalPerHour: number;
} {
  const f = 3600 / s.cycleTime;
  const inputs = s.inputs.map((i) => ({ typeId: i.typeId, perHour: i.qty * f }));
  return {
    inputs,
    output: s.output ? { typeId: s.output.typeId, perHour: s.output.qty * f } : null,
    inTotalPerHour: inputs.reduce((n, i) => n + i.perHour, 0),
  };
}

let mem: Map<number, Schematic> | null = null;
let inflight: Promise<Map<number, Schematic>> | null = null;

/** the full schematic table — memory → localStorage → one network fetch */
export async function loadSchematics(): Promise<Map<number, Schematic>> {
  if (mem) return mem;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const arr = JSON.parse(raw) as Schematic[];
      if (Array.isArray(arr) && arr.length > 10) {
        mem = new Map(arr.map((s) => [s.id, s]));
        return mem;
      }
    }
  } catch { /* refetch */ }
  if (inflight) return inflight;
  inflight = (async () => {
    const [a, b] = await Promise.all([
      fetch(`${BASE}/planetSchematics.csv`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); }),
      fetch(`${BASE}/planetSchematicsTypeMap.csv`).then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.text(); }),
    ]);
    const m = parseSchematics(a, b);
    if (m.size > 10) {
      mem = m;
      try { localStorage.setItem(CACHE_KEY, JSON.stringify([...m.values()])); } catch { /* cache only */ }
    }
    return m;
  })().finally(() => { inflight = null; });
  return inflight;
}
