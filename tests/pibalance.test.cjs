// Fixtures for src/lib/piBalance.ts — head-vs-factory flow balance.
//
// All numbers HAND-COMPUTED. The core chain fixture:
//   extractor pulls 1000/h of A
//   2x factory S101: each eats 600/h A, makes 300/h B  -> demand(A)=1200
//   1x factory S102: eats 450/h B, makes C
//   coverage(A) = 1000/1200 = 5/6 = 0.8333  -> S101 duty 0.8333
//   supply(B)   = 2*300*0.8333 = 500        -> coverage(B) = 500/450 = 1.111
//   fedFrac = 0.8333 (bottleneck A), underfed (< 0.85)

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : `   ${extra}`}`);
  cond ? pass++ : fail++;
};
const eq = (label, got, want) => ok(label, JSON.stringify(got) === JSON.stringify(want), `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
const near = (label, got, want, tol) => ok(label, got !== null && Math.abs(got - want) <= tol, `got=${got} want≈${want}±${tol}`);

const B = require('./pi/piBalance.js');

const A = 1, Bt = 2, C = 3;
const mkSchem = (entries) => new Map(entries);
const S101 = { id: 101, name: 'A->B', cycleTime: 3600, inputs: [{ typeId: A, qty: 600 }], output: { typeId: Bt, qty: 300 } };
const S102 = { id: 102, name: 'B->C', cycleTime: 3600, inputs: [{ typeId: Bt, qty: 450 }], output: { typeId: C, qty: 5 } };
const schem = mkSchem([[101, S101], [102, S102]]);

const ex = (typeId, perHour, active = true) => ({ productTypeId: typeId, perHour, active });

// ---- the chain fixture ---------------------------------------------------
let b = B.flowBalance({
  extractors: [ex(A, 1000)],
  factorySchematics: [{ schematicId: 101, count: 2 }, { schematicId: 102, count: 1 }],
}, schem);
near('fedFrac = 5/6', b.fedFrac, 5 / 6, 1e-6);
eq('bottleneck is A', b.bottleneckTypeId, A);
near('coverage(B) via duty-scaled chain = 1.111', b.flows.find((f) => f.typeId === Bt).coverage, 500 / 450, 1e-6);
near('supply(B) = 500/h', b.flows.find((f) => f.typeId === Bt).supplyPerHour, 500, 1e-6);
eq('flows sorted worst-first', b.flows[0].typeId, A);
eq('no surplus when demand exceeds pull', b.surplusTypeId, null);
eq('verdict: underfed', B.balanceProblem(b), 'underfed');

// ---- overfed: pull 2000/h, factories eat 1000/h -> surplus 1000 = 50% ----
b = B.flowBalance({
  extractors: [ex(A, 2000)],
  factorySchematics: [{ schematicId: 101, count: 1 }],
}, mkSchem([[101, { ...S101, inputs: [{ typeId: A, qty: 1000 }] }]]));
near('coverage(A) = 2', b.fedFrac, 2, 1e-6);
eq('no bottleneck when everything is fed', b.bottleneckTypeId, null);
eq('surplus type is A', b.surplusTypeId, A);
near('surplus = 1000/h', b.surplusPerHour, 1000, 1e-6);
eq('verdict: overfed (50% > 25%)', B.balanceProblem(b), 'overfed');

// ---- balanced: pull 1000, eat 950 -> coverage 1.05, surplus 5% -----------
b = B.flowBalance({
  extractors: [ex(A, 1000)],
  factorySchematics: [{ schematicId: 101, count: 1 }],
}, mkSchem([[101, { ...S101, inputs: [{ typeId: A, qty: 950 }] }]]));
eq('a well-tuned planet raises no verdict', B.balanceProblem(b), null);

// ---- boundaries of judgeability ------------------------------------------
eq('no schematic table -> null', B.flowBalance({ extractors: [ex(A, 1000)], factorySchematics: [{ schematicId: 101, count: 1 }] }, null), null);
eq('no factories -> null', B.flowBalance({ extractors: [ex(A, 1000)], factorySchematics: [] }, schem), null);
eq('no ACTIVE extractors -> null (rates say nothing about an import-fed planet)',
  B.flowBalance({ extractors: [ex(A, 1000, false)], factorySchematics: [{ schematicId: 101, count: 1 }] }, schem), null);
// factory eats only a type nothing on-planet produces: treated as imported
eq('a purely import-fed consumer is excluded -> null',
  B.flowBalance({ extractors: [ex(A, 1000)], factorySchematics: [{ schematicId: 102, count: 1 }] }, schem), null);
// pure export: extractor product no factory eats is a CHOICE, not a surplus
// (A is tuned to balance at 1000/950 so only C is left over)
b = B.flowBalance({
  extractors: [ex(A, 1000), ex(C, 500)],
  factorySchematics: [{ schematicId: 101, count: 1 }],
}, mkSchem([[101, { ...S101, inputs: [{ typeId: A, qty: 950 }] }]]));
ok('the un-consumed product C is never the surplus (only consumed types count)',
  b.surplusTypeId !== C, String(b.surplusTypeId));
near('...A keeps its honest little 50/h leftover', b.surplusPerHour, 50, 1e-6);
eq('...and a 5% leftover does not trigger a verdict', B.balanceProblem(b), null);

// ---- verdict thresholds exactly ------------------------------------------
ok('0.85 is the underfed line (constant exported)', B.UNDERFED_BELOW === 0.85);
ok('0.25 is the overfed surplus line', B.OVERFED_SURPLUS_FRAC === 0.25);

console.log(`pibalance.test: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
