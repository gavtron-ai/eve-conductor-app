// PI SCHEMATICS (v0.145) — CSV parse + per-hour rates, hand-computed from the
// REAL fuzzwork rows probed 2026-08-26:
//   planetSchematics.csv:        "65","Superconductors","3600"
//   planetSchematicsTypeMap.csv: 65: in 40×2389 + 40×3645, out 5×9838
// Superconductors is a P2: two P1 inputs at 40/cycle, 5 out, 1h cycle — the
// canonical 80-in/5-out-per-hour advanced factory numbers.

const { parseSchematics, schematicPerHour, csvCells } = require('./sim/lib/piSchematics.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// csvCells: quoted fields, BOM tolerated
eq('C1 cells parse', csvCells('"65","Superconductors","3600"'), ['65', 'Superconductors', '3600']);
eq('C2 BOM stripped', csvCells('﻿"schematicID","schematicName","cycleTime"')[0], 'schematicID');

const SCHEM = '"schematicID","schematicName","cycleTime"\n"65","Superconductors","3600"\n"121","Bacteria","1800"\n';
const MAP = '"schematicID","typeID","quantity","isInput"\n'
  + '"65","2389","40","1"\n"65","3645","40","1"\n"65","9838","5","0"\n'
  + '"121","2073","3000","1"\n"121","2319","20","0"\n';

const m = parseSchematics(SCHEM, MAP);
eq('C3 two schematics parsed', m.size, 2);
const sup = m.get(65);
eq('C4 name + cycle', [sup.name, sup.cycleTime], ['Superconductors', 3600]);
eq('C5 inputs', sup.inputs, [{ typeId: 2389, qty: 40 }, { typeId: 3645, qty: 40 }]);
eq('C6 output', sup.output, { typeId: 9838, qty: 5 });

// rates: 1h cycle → same per hour; totals hand-computed 40+40=80 in, 5 out
const r = schematicPerHour(sup);
eq('C7 P2 inputs 40+40/h', r.inputs.map((i) => i.perHour), [40, 40]);
eq('C8 P2 in-total 80/h', r.inTotalPerHour, 80);
eq('C9 P2 output 5/h', r.output, { typeId: 9838, perHour: 5 });

// Bacteria (P1, basic): 30-min cycle → ×2 per hour: 3000→6000 in, 20→40 out
const bac = schematicPerHour(m.get(121));
eq('C10 P1 in 6000/h', bac.inTotalPerHour, 6000);
eq('C11 P1 out 40/h', bac.output, { typeId: 2319, perHour: 40 });

console.log(`pischematics.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
