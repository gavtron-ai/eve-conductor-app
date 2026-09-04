// Fixtures for adviceFor() — the column the user ACTS from, every day.
//
// THE BUG: nothing in this function ever saw the cost basis, so an order
// already netting less than what the stock cost got "⚔ act NOW — prime hours"
// or "⚑ fix now" — and the button beside it copied a price strictly LOWER
// than the one already losing money. The ⚠ loss chip two columns to the left
// said the opposite at the same time.

const { adviceFor } = require('./r3/orderAdvice.js');

let pass = 0, fail = 0;
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : `   ${extra}`}`);
  cond ? pass++ : fail++;
};

const order = (over = {}) => ({
  order_id: 1, type_id: 34, location_id: 60003760, region_id: 10000002,
  is_buy_order: false, price: 100, volume_total: 100, volume_remain: 100,
  duration: 90, issued: new Date().toISOString(), ...over,
});
const row = (over = {}) => ({
  edge: null, heat: null, order: order(over.order), systemId: 30000142,
  underwater: false, breakEven: null, paid: null,
  ...over,
});

const nowH = new Date().getUTCHours();
/** a system schedule that WOULD produce a confident "act now" */
const primeNow = {
  systemId: 30000142, marketReady: true, mktSolid: true, mktDays: 12,
  mktIsk: 5e9, coreReady: true, spanDays: 30,
  prime: { start: (nowH - 1 + 24) % 24, sharePct: 42 },
  noise: null, sales: null, outbids: null, overlap: false,
  nSales: 40, nOutbids: 40,
};

// ---- THE REGRESSION: beaten + underwater must NOT say "reprice" -----------
const beatenUnderwater = row({
  edge: -0.05,
  underwater: true, paid: 120, breakEven: 124.35,
});
const a1 = adviceFor(beatenUnderwater, primeNow, [nowH]);
ok('an underwater order is NOT told to act now', !/act NOW/i.test(a1.txt), `got "${a1.txt}"`);
ok('...nor to fix now', !/fix now/i.test(a1.txt), `got "${a1.txt}"`);
ok('...nor given a reprice window', !/window/i.test(a1.txt), `got "${a1.txt}"`);
ok('...it says below cost', /below cost/i.test(a1.txt), `got "${a1.txt}"`);
ok('...and offers hold or cut', /hold or cut/i.test(a1.txt), `got "${a1.txt}"`);
ok('...at the top of the worst-first ranking', a1.rank === 0, `rank=${a1.rank}`);
ok('...the tip states the break-even price', a1.tip.includes('124'), a1.tip.slice(0, 120));
ok('...and the cost that was paid', a1.tip.includes('120'), a1.tip.slice(0, 120));
ok('...and says undercutting only loses more', /lose more/i.test(a1.tip), a1.tip.slice(0, 200));

// the check must come BEFORE the radar-window branch, which used to win
const a2 = adviceFor(beatenUnderwater, primeNow, [nowH, (nowH + 3) % 24]);
ok('the radar profitable-window branch cannot override it', /below cost/i.test(a2.txt), `got "${a2.txt}"`);
// ...and before the "next window in Xh" branch too
const a3 = adviceFor(beatenUnderwater, primeNow, [(nowH + 6) % 24]);
ok('nor can the "next window" branch', /below cost/i.test(a3.txt), `got "${a3.txt}"`);

// underwater but NOT beaten: still must not imply the price is fine
const a4 = adviceFor(row({ edge: 0.02, underwater: true, paid: 120, breakEven: 124.35 }), primeNow, null);
ok('underwater while winning still reads below cost', /below cost/i.test(a4.txt), `got "${a4.txt}"`);
ok('...and does NOT say "leave it"', !/leave it/i.test(a4.txt), `got "${a4.txt}"`);
ok('...its tip omits the "also beaten" clause', !/also beaten/i.test(a4.tip), a4.tip.slice(0, 160));

// ---- THE HEALTHY PATHS MUST BE UNCHANGED ---------------------------------
const healthyBeaten = row({ edge: -0.05, underwater: false, paid: 50, breakEven: 51.8 });
const b1 = adviceFor(healthyBeaten, primeNow, null);
ok('a PROFITABLE beaten order still says act now', /act NOW/i.test(b1.txt), `got "${b1.txt}"`);
ok('...at rank 0', b1.rank === 0, `rank=${b1.rank}`);

const b2 = adviceFor(healthyBeaten, primeNow, [nowH]);
ok('...and the radar window branch still fires', /sale window/i.test(b2.txt), `got "${b2.txt}"`);

const winning = row({ edge: 0.05, underwater: false, paid: 50, breakEven: 51.8 });
ok('a winning calm order still says leave it', /leave it/i.test(adviceFor(winning, undefined, null).txt));

const nearlyFilled = row({
  edge: 0.05, underwater: false,
  order: { volume_total: 100, volume_remain: 10 },
});
ok('an 80%-filled winner still says restock', /restock/i.test(adviceFor(nearlyFilled, undefined, null).txt));

// ---- a BUY order can never be underwater by this test --------------------
// (the row builder only sets it for sells; assert the advice honours the flag
// rather than inferring, so a future caller cannot half-set it)
const buyRow = row({ edge: -0.05, underwater: false, paid: 120, breakEven: null,
  order: { is_buy_order: true } });
ok('a buy order with a high cost basis is NOT called below cost',
  !/below cost/i.test(adviceFor(buyRow, primeNow, null).txt));

// ---- no cost basis at all: unchanged behaviour ---------------------------
const noCost = row({ edge: -0.05, underwater: false, paid: null, breakEven: null });
ok('an order with no purchase on the books still gets normal advice',
  /act NOW|fix now|time your fix/i.test(adviceFor(noCost, primeNow, null).txt));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
