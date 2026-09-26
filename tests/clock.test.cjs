// v0.227.0 (audit F7), corrected in v0.228.0: clock skew measured from ESI's Date header — from
// LIVE answers only (Expires − Date ≤ 60 s), as the maximum of the last fifteen minutes' samples,
// because the renderer's HTTP cache replays earlier answers with their original Date (the
// installed 0.227.0 warned "586 s ahead" from a replayed item-name answer). Fixtures on the
// SHIPPED lib/clock.ts (compiled to sim/lib), hand-computed.
global.window = { appInfo: undefined };
const C = require('./sim/lib/clock.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const gmt = (ms) => new Date(ms).toUTCString(); // what a Date/Expires header looks like (1 s resolution)
const T0 = Date.UTC(2026, 8, 23, 14, 0, 0); // 14:00:00Z on the server
const live = (serverMs, pcMs) => C.noteServerDate(gmt(serverMs), gmt(serverMs + 60_000), pcMs); // a 60-s endpoint (online flag)
const slow = (serverMs, pcMs) => C.noteServerDate(gmt(serverMs), gmt(serverMs + 3_600_000), pcMs); // an hour-long one (types)

C._resetClockForTests();
eq('1 nothing measured yet: no skew, no line, no warning, serverNow = now', [C.skewMs(), C.clockLine(), C.clockWarning(), C.serverNow(123)], [null, null, null, 123]);

// ---- a PC 90 s BEHIND the server: the server says 14:00:00, the PC says 13:58:30
live(T0, T0 - 90_000);
eq('2 one live answer: skew = server − PC = +90,000 ms', C.skewMs(), 90_000);
eq('3 serverNow corrects the PC clock forward', C.serverNow(T0 - 90_000), T0);
eq('4 a killmail 5 min old by EVE time reads 3.5 min by the PC — and 5 min corrected',
  [(T0 - 90_000 - (T0 - 300_000)) / 60_000, (C.serverNow(T0 - 90_000) - (T0 - 300_000)) / 60_000], [3.5, 5]);
eq('5 one sample: the line says so, but no warning yet (three needed)', [C.clockLine(), C.clockWarning()], ['PC clock 90 s behind EVE time', null]);
live(T0 + 55_000, T0 + 55_000 - 90_000);
live(T0 + 110_000, T0 + 110_000 - 90_000);
eq('5b three answers within 110 s: still no warning — a replay lives 60 s, so the samples must span two minutes (0.232.0 warned at start from three replays)', C.clockWarning(), null);
live(T0 + 125_000, T0 + 125_000 - 90_000);
eq('6 four live answers over 125 s: the warning', C.clockWarning(), { skewMs: 90_000, text: 'Your PC clock is 90 s behind EVE time' });

// ---- the 0.227.0 failure, replayed: cached answers with an old Date
C._resetClockForTests();
live(T0, T0 + 500); // fresh: PC 0.5 s ahead (header truncation + latency)
live(T0 + 55_000, T0 + 55_000 + 500);
live(T0 + 110_000, T0 + 110_000 + 500);
slow(T0 - 586_000, T0 + 111_000); // an item-name answer generated 586 s ago, replayed by the HTTP cache
eq('7 a long-lived answer is not a sample at all (its replay could be hours old)', C.skewMs(), -500);
live(T0 + 60_000, T0 + 112_000); // a 60-s endpoint replayed 52 s late (within its Expires)
eq('8 a replayed LIVE answer can only look earlier — the maximum ignores it', [C.skewMs(), C.clockLine(), C.clockWarning()], [-500, 'PC clock matches EVE time', null]);

// ---- the window: fifteen minutes; a stalled answer; the sign for a PC ahead
C._resetClockForTests();
for (let i = 0; i < 10; i++) live(T0 + i * 60_000, T0 + i * 60_000 + 2_000); // steady: PC 2 s ahead → −2000
live(T0 + 10 * 60_000, T0 + 10 * 60_000 + 40_000); // one answer that took 38 s to arrive (or a hiccup)
eq('9 a stalled answer among eleven does not move the skew (max)', [C.skewMs(), C.clockWarning()], [-2_000, null]);
for (let i = 11; i < 30; i++) live(T0 + i * 60_000, T0 + i * 60_000 + 45_000); // the clock really drifts to 45 s ahead
eq('10 once the old samples age out of the fifteen-minute window the skew follows the real drift', C.skewMs(), -45_000);
eq('11 …and warns, "ahead"', C.clockWarning()?.text, 'Your PC clock is 45 s ahead of EVE time');
C._resetClockForTests();
live(T0, T0 + 800);
eq('12 under 1.5 s (the header\'s own resolution plus latency): "matches"', C.clockLine(), 'PC clock matches EVE time');

// ---- bad or missing headers are ignored
C._resetClockForTests();
C.noteServerDate(null, gmt(T0), T0);
C.noteServerDate(gmt(T0), null, T0);
C.noteServerDate(undefined, undefined, T0);
C.noteServerDate('', '', T0);
C.noteServerDate('not a date', gmt(T0), T0);
C.noteServerDate(gmt(T0), 'not a date', T0);
eq('13 missing or unparsable headers leave the clock unmeasured', [C.skewMs(), C.clockLine()], [null, null]);
eq('14 the constants: live ≤ 60 s, window 15 min, warn from 30 s with 3 samples', [C.LIVE_TTL_MS, C.WINDOW_MS, C.CLOCK_WARN_MS, C.MIN_SAMPLES], [60_000, 900_000, 30_000, 3]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
