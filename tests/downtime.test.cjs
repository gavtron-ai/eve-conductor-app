// v0.236.0 (round-two R3): the collectors pause through EVE's daily downtime. Fixtures on the SHIPPED
// eveClock (lib/homeDigests.ts, compiled to sim/lib) — the window is 11:00 to 11:15 UTC — and on the
// external-link guard (electron/safeOpen.cjs, R7).
global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
global.window = { appInfo: undefined, localStorage: global.localStorage };
const { eveClock, DOWNTIME_UTC_HOUR } = require('./sim/lib/homeDigests.js');
const { isSafeExternal } = require('../electron/safeOpen.cjs');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const at = (h, m, s = 0) => Date.UTC(2026, 8, 23, h, m, s);

eq('1 downtime is 11:00 UTC', DOWNTIME_UTC_HOUR, 11);
eq('2 10:59:59 is not downtime; 11:00:00 is; 11:14:59 is; 11:15:00 is not', [at(10, 59, 59), at(11, 0, 0), at(11, 14, 59), at(11, 15, 0)].map((t) => eveClock(t).inDowntimeWindow), [false, true, true, false]);
eq('3 minutes to downtime count to the next 11:00', [eveClock(at(10, 30)).toDowntimeMs / 60_000, eveClock(at(12, 0)).toDowntimeMs / 3_600_000], [30, 23]);
eq('4 the clock reads EVE time', eveClock(at(11, 7)).hhmm, '11:07');

// ---- the link guard
eq('5 http and https links are opened', [isSafeExternal('https://zkillboard.com/character/1/'), isSafeExternal('http://localhost:53138/callback')], [true, true]);
eq('6 anything else is refused', ['javascript:alert(1)', 'file:///C:/Windows/system.ini', 'mailto:x@y', 'ftp://x', '', null, 42, 'https://a b'].map(isSafeExternal), [false, false, false, false, false, false, false, false]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
