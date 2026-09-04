// Fixtures for the round-2 fixes, against the SHIPPED compiled modules.
//
//  A. freshness.fail() — a collector that has NEVER succeeded used to write
//     nothing, and App.tsx's 1s scheduler reads a missing entry as "due now".
//     That is an unthrottled retry loop pointed straight at ESI.
//  B. schedule.computeSchedules() — spanDays was ONE global number taken from
//     the oldest event in the entire never-pruned log, so a system first
//     traded yesterday inherited another system's tracking age and passed a
//     readiness gate on data that had nothing to do with it.

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const near = (label, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${got} want≈${want}±${tol}`}`);
  ok ? pass++ : fail++;
};

// ===== A. THE RETRY LOOP =================================================
const { useFreshness } = require('./sch/freshness.js');
const F = () => useFreshness.getState();

eq('a brand-new collector key has no entry', F().sources['raidwatch'], undefined);

// THE BUG: App.tsx treats `undefined` as "due now", so a source that fails on
// its very first attempt was retried once per second, forever.
F().fail('raidwatch');
const first = F().sources['raidwatch'];
eq('the FIRST failure now creates an entry', Boolean(first), true);
eq('...and it is not "due now"', first.nextAt > Date.now(), true);
near('...it waits 2 minutes', first.nextAt - Date.now(), 120_000, 2000);
eq('...and records the streak', first.fails, 1);

F().fail('raidwatch');
near('a second consecutive failure waits 4 min', F().sources['raidwatch'].nextAt - Date.now(), 240_000, 2000);
F().fail('raidwatch');
near('a third waits 8 min', F().sources['raidwatch'].nextAt - Date.now(), 480_000, 2000);
for (let i = 0; i < 10; i++) F().fail('raidwatch');
near('the backoff is capped at 30 min', F().sources['raidwatch'].nextAt - Date.now(), 30 * 60_000, 2000);

F().reportHeader('raidwatch', 60_000);
eq('a success clears the failure streak', F().sources['raidwatch'].fails, 0);
F().fail('raidwatch');
near('...so the next failure starts over at 2 min', F().sources['raidwatch'].nextAt - Date.now(), 120_000, 2000);

// ===== B. PER-SYSTEM TRACKING AGE ========================================
const { computeSchedules } = require('./sch/schedule.js');
const DAY = 86_400_000;
const now = Date.now();
const ev = (t, kind, systemId, extra = {}) => ({
  t, kind, systemId, charId: 1, orderId: 1, typeId: 34, stationId: 60003760, ...extra,
});

// System 100 has been traded for 40 days. System 200's FIRST EVER event was
// yesterday. Both have enough sales/outbids to pass the count gates.
const events = [];
for (let d = 40; d >= 0; d--) {
  events.push(ev(now - d * DAY, 'sale', 100, { qty: 1, isk: 1000, price: 1000 }));
  events.push(ev(now - d * DAY, 'outbid_sell', 100, { price: 10, rival: 9 }));
}
for (let i = 0; i < 12; i++) {
  events.push(ev(now - DAY + i * 60_000, 'sale', 200, { qty: 1, isk: 1000, price: 1000 }));
  events.push(ev(now - DAY + i * 60_000, 'outbid_sell', 200, { price: 10, rival: 9 }));
}
events.sort((a, b) => a.t - b.t);

const scheds = computeSchedules(events, 30 * DAY);
const old = scheds.get(100);
const fresh = scheds.get(200);

eq('the long-tracked system is ready', old.coreReady, true);
// THE BUG: spanDays came from events[0].t — the oldest event of the WHOLE log,
// which here is system 100's, 40 days back. System 200 inherited it and was
// declared "ready" on one day of its own data.
eq('a system first seen YESTERDAY is NOT ready', fresh.coreReady, false);
eq('...even though its sale count clears the bar', fresh.nSales >= 10, true);
eq('...and its outbid count too', fresh.nOutbids >= 10, true);

// the printed denominator must match the counts beside it
near('the new system reports ~1 day tracked', fresh.spanDays, 1, 0.2);
near('the old system reports ~30 (clamped by the window)', old.spanDays, 30, 1.1);

// a system with no in-window events at all does not appear
eq('a system outside the window is absent entirely', scheds.get(999), undefined);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
