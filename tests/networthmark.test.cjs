// v0.230.0 (audit D2): the trading-value mark traces to executed trades. Fixtures on the SHIPPED
// pure functions (compiled to sim/lib): the radar's executedSellPrice (ISK filled ÷ units filled
// over the window; a listing is not a price) and networth's chooseMark (measured sale → own
// cost → the Jita ask, named as a listing → an order's own price → nothing), hand-computed.
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { appInfo: undefined, localStorage: global.localStorage };
const { executedSellPrice } = require('./sim/lib/radar.js');
const { chooseMark } = require('./sim/lib/networth.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const day = (d, fi, fk) => ({ d, rp: 0, fi, fk, co: 1, bp: 0 });
const entry = (s, days) => ({ r: 10000002, t: 34, s, days, hfa: new Array(24).fill(0), hra: new Array(24).fill(0) });

// ---- the measured sale price
const e = entry(0, [day('2026-09-15', 100, 500_000), day('2026-09-20', 300, 1_800_000), day('2026-09-22', 100, 700_000)]);
eq('1 over the window: (1,800,000 + 700,000) ÷ (300 + 100) = 6,250 ISK — the 09-15 day is before the cutoff', executedSellPrice(e, '2026-09-16'), { price: 6250, units: 400, isk: 2_500_000 });
eq('2 a wider window takes the 09-15 day in: 3,000,000 ÷ 500 = 6,000', executedSellPrice(e, '2026-09-01').price, 6000);
eq('3 nothing filled in the window → null (never a number from a listing)', executedSellPrice(e, '2026-09-22'), null);
eq('4 the buy side (s = 1) is not a sale price', executedSellPrice(entry(1, e.days), '2026-09-01'), null);
eq('5 units without ISK, or ISK without units, is no price', [executedSellPrice(entry(0, [day('2026-09-20', 10, 0)]), '2026-09-01'), executedSellPrice(entry(0, [day('2026-09-20', 0, 10)]), '2026-09-01')], [null, null]);

// ---- the mark, in order
eq('6 a measured sale wins over cost and ask', chooseMark({ price: 6250, units: 400 }, 7000, 9000, 9500), { price: 6250, basis: 'executed' });
eq('7 no sale → own cost', chooseMark(undefined, 7000, 9000, 9500), { price: 7000, basis: 'cost' });
eq('8 no sale, no cost → the ask, named as a listing', chooseMark(undefined, undefined, 9000, 9500), { price: 9000, basis: 'listing' });
eq('9 nothing but the order\'s own price', chooseMark(undefined, undefined, undefined, 9500), { price: 9500, basis: 'order' });
eq('10 nothing at all → 0, named', chooseMark(undefined, undefined, undefined, 0), { price: 0, basis: 'none' });
eq('11 a zero-unit "sale" or a zero cost or a zero ask does not count', chooseMark({ price: 6250, units: 0 }, 0, 0, 9500), { price: 9500, basis: 'order' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
