// Fixtures for computeStats() in the SHIPPED ledger.ts.
//
// USER: "report whatever profit is provably true, never allow a lie to get
// to me". A part-covered sale used to report NO profit at all, dump the whole
// revenue in the loot bucket — AND still consume the matched lots, so their
// cost disappeared from the books entirely. Selling 100 units of which 60
// were bought at a known price makes the profit on those 60 a FACT.

const TX = [];
const FEES = [];
const EVENTS = [];
const DAY = 86_400_000;
const T0 = Date.now() - 10 * DAY;

const TRIT = 34;
const STATION = 60003760;

// the item qualifies for the books because we have listed it
EVENTS.push({ orderId: 1, typeId: TRIT, locationId: STATION, issued: T0, price: 10, isBuy: false });

let txId = 1000;
const buy = (qty, unit, dayOffset) =>
  TX.push({ id: ++txId, date: T0 + dayOffset * DAY, typeId: TRIT, qty, unitPrice: unit, locationId: STATION, isBuy: true, charId: 1 });
const sell = (qty, unit, dayOffset, tax) => {
  const id = ++txId;
  TX.push({ id, date: T0 + dayOffset * DAY, typeId: TRIT, qty, unitPrice: unit, locationId: STATION, isBuy: false, charId: 1 });
  if (tax) FEES.push({ id: ++txId, date: T0 + dayOffset * DAY, kind: 'transaction_tax', amount: tax, contextId: id, charId: 1 });
};

// 60 units bought at 100 ISK. Then 100 units sold at 200 ISK with 400 tax.
// 40 of those units are loot: there is no purchase behind them.
buy(60, 100, 1);
sell(100, 200, 2, 400);

const store = new Map();
store.set('etc-ledger-v1', JSON.stringify({ tx: TX, fees: FEES, orderEvents: EVENTS, lastSync: null }));
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { computeStats } = require('./led/ledger.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = Math.abs(got - want) < 0.0001 || JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const s = computeStats();
const sale = s.sales[0];

// 60 of 100 units are covered -> 60% of the revenue and 60% of the tax
//   matched revenue = 20000 * 0.60 = 12000
//   matched tax     =   400 * 0.60 =   240
//   matched cost    =    60 * 100  =  6000
//   PROVABLE PROFIT = 12000 - 240 - 6000 = 5760
eq('the sale records how many units were actually covered', sale.matchedQty, 60);
eq('PROVABLE profit on the 60 covered units is reported', sale.profit, 5760);
eq('...and it lands in the realized total', s.realizedProfit, 5760);
eq('the matched cost basis is the real 6000, not null', sale.costBasis, 6000);

// the other 40 units have no cost basis: their revenue, and ONLY their
// revenue, goes to the honest bucket. Not the whole 20000.
eq('only the UNCOVERED 40 units land in loot/pre-app revenue', s.unmatchedRevenue, 8000);
eq('the full sale value is still the full sale value', s.totalSold, 20000);

// nothing was invented: matched + unmatched revenue = the sale
eq('matched revenue + unmatched revenue = total sold',
  (sale.revenue - 8000) + 8000, s.totalSold);

// and the lots really were consumed
eq('the 60-unit lot is gone from inventory', s.inventory.length, 0);
eq('so nothing is left at cost', s.inventoryAtCost, 0);

// ---- a FULLY covered sale must be unchanged by all this ------------------
TX.length = 0; FEES.length = 0;
buy(100, 100, 1);
sell(100, 200, 2, 400);
store.set('etc-ledger-v1', JSON.stringify({ tx: TX, fees: FEES, orderEvents: EVENTS, lastSync: null }));
delete require.cache[require.resolve('./led/ledger.js')];
const s2 = require('./led/ledger.js').computeStats();
eq('a fully covered sale still reports the whole profit', s2.realizedProfit, 20000 - 400 - 10000);
eq('...and nothing at all in the loot bucket', s2.unmatchedRevenue, 0);
eq('...with every unit matched', s2.sales[0].matchedQty, 100);

// ---- a sale with NO purchase behind it at all ---------------------------
TX.length = 0; FEES.length = 0;
sell(100, 200, 2, 400);
store.set('etc-ledger-v1', JSON.stringify({ tx: TX, fees: FEES, orderEvents: EVENTS, lastSync: null }));
delete require.cache[require.resolve('./led/ledger.js')];
const s3 = require('./led/ledger.js').computeStats();
eq('pure loot claims NO profit', s3.sales[0].profit, null);
eq('...its whole revenue is unmatched', s3.unmatchedRevenue, 20000);
eq('...and it adds nothing to realized profit', s3.realizedProfit, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
