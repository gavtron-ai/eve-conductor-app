// WIZARD POD (v0.194) — a pod attached to a fit TRAVELS WITH IT: every
// export (EFT copy, multibuy list, ESI save-to-character payload) carries
// the implants as cargo, nulls are skipped, and a fit with no pod exports
// exactly as before. Hand-checked against real implant names from typedb.
const store = new Map();
global.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
global.window = { appInfo: {}, localStorage: global.localStorage };

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };

const W = require('./sim/lib/wizardFits.js');
const { findByName } = require('./sim/lib/typedb.js');

const squire = findByName("Inherent Implants 'Squire' Power Grid Management EG-605");
const gyro = findByName('Gyrostabilizer I');
check('fixture types resolve', !!squire && !!gyro);

const fitOf = (implants) => ({
  id: 'f1', name: 'PodTest', hullId: 587, implants,
  variations: [{
    id: 'v1', name: 'Core',
    high: [{ typeId: null }], med: [{ typeId: null }], low: [{ typeId: gyro.id }],
    rig: [], sub: [], drones: [], cargo: [{ typeId: gyro.id, qty: 2 }],
  }],
});

// A: a pod with one implant + nulls -> exactly one implant cargo line
{
  const fit = fitOf([null, null, null, null, null, squire.id, null, null, null, null]);
  const eft = W.variationEft(fit, fit.variations[0]);
  check('A1 EFT carries the implant as cargo "Name x1"', eft.includes(`${squire.name} x1`), eft);
  check('A2 EFT still carries the real cargo', eft.includes('Gyrostabilizer I x2'));
  const buy = W.buyList(fit, fit.variations[0]);
  check('A3 buy list includes the implant once', buy.split('\n').some((l) => l === squire.name), buy);
  const esi = W.toEsiFitting(fit, fit.variations[0]);
  const imp = esi.payload.items.filter((i) => i.type_id === squire.id);
  check('A4 ESI payload has the implant in Cargo, quantity 1',
    imp.length === 1 && imp[0].flag === 'Cargo' && imp[0].quantity === 1, JSON.stringify(imp));
  check('A5 nulls contribute nothing', esi.payload.items.filter((i) => i.type_id === null).length === 0);
}

// B: no pod (undefined) -> exports identical to a podless fit
{
  const a = fitOf(undefined);
  const b = fitOf([null, null, null, null, null, null, null, null, null, null]);
  const eftA = W.variationEft(a, a.variations[0]);
  const eftB = W.variationEft(b, b.variations[0]);
  check('B1 undefined pod and all-empty pod export identically', eftA === eftB);
  check('B2 no implant line appears without a pod', !eftA.includes(squire.name));
  check('B3 fitImplants drops nulls', W.fitImplants(b).length === 0 && W.fitImplants(a).length === 0);
}

console.log(`wizardpod.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
