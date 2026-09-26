// v0.228.0 (audit E1/E2): the renderer's diagnostics helpers on the SHIPPED lib/devlog.ts (compiled
// to sim/lib). logRun's quiet mode: identical results stop being written, a changed result is, an
// hour passes and one line says how many went unwritten, a failure is always written and the next
// success too. swallowed(): a warning per site per ten minutes and a running count for the dashlet.
const captured = [];
global.window = { appInfo: { devlog: { append: async (entries) => { captured.push(...entries); } } } };
const D = require('./sim/lib/devlog.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
let t = 1_700_000_000_000;
const now = () => t;
const lines = async () => {
  await D.flushLog();
  const out = captured.map((e) => `${e.level} ${e.area}: ${e.msg}${e.data && e.data.quietTicks !== undefined ? ` (quietTicks ${e.data.quietTicks})` : ''}`);
  captured.length = 0;
  return out;
};

(async () => {
  D._resetRunMemoForTests();
  // ---- quiet ticks
  eq('1 the first quiet tick is written', (await (async () => { await D.logRun('shipwatch', 'tick', async () => 3, { quiet: true, now }); return lines(); })()), ['info shipwatch: tick ok']);
  for (let i = 0; i < 5; i++) { t += 6_000; await D.logRun('shipwatch', 'tick', async () => 3, { quiet: true, now }); }
  eq('2 five identical ticks write nothing', await lines(), []);
  t += 6_000;
  await D.logRun('shipwatch', 'tick', async () => 4, { quiet: true, now });
  eq('3 a changed result is written, saying five went unwritten', await lines(), ['info shipwatch: tick ok (quietTicks 5)']);
  for (let i = 0; i < 3; i++) { t += 6_000; await D.logRun('shipwatch', 'tick', async () => 4, { quiet: true, now }); }
  t += 60 * 60_000;
  await D.logRun('shipwatch', 'tick', async () => 4, { quiet: true, now });
  eq('4 after an hour the same result is written once, with the count', await lines(), ['info shipwatch: tick ok (quietTicks 3)']);
  t += 6_000;
  let threw = false;
  try { await D.logRun('shipwatch', 'tick', async () => { throw new Error('ESI 502'); }, { quiet: true, now }); } catch { threw = true; }
  eq('5 a failure is always written (and rethrown)', [threw, await lines()], [true, ['error shipwatch: tick FAILED']]);
  t += 6_000;
  await D.logRun('shipwatch', 'tick', async () => 4, { quiet: true, now });
  eq('6 the first success after a failure is written even though the result is unchanged', await lines(), ['info shipwatch: tick ok']);
  // two areas do not share a memo; a non-quiet run is written every time
  await D.logRun('raidwatch', 'tick', async () => 1, { quiet: true, now });
  await D.logRun('raidwatch', 'tick', async () => 1, { quiet: true, now });
  await D.logRun('prices', 'refresh', async () => 'x', { now });
  await D.logRun('prices', 'refresh', async () => 'x', { now });
  eq('7 areas are independent; without quiet every run is written', await lines(), ['info raidwatch: tick ok', 'info prices: refresh ok', 'info prices: refresh ok']);
  eq('8 an object result is compared by its summary (key count), not identity', (await (async () => {
    await D.logRun('pi', 'tick', async () => ({ a: 1, b: 2 }), { quiet: true, now });
    await D.logRun('pi', 'tick', async () => ({ c: 3, d: 4 }), { quiet: true, now });
    await D.logRun('pi', 'tick', async () => ({ e: 5 }), { quiet: true, now });
    return lines();
  })()), ['info pi: tick ok', 'info pi: tick ok (quietTicks 1)']);
  eq('9 the hour is 60 minutes', D.QUIET_TICK_MS, 3_600_000);

  // ---- swallowed persistence errors
  D._resetRunMemoForTests();
  D.swallowed('radar', 'work-in-progress save', new Error('ENOSPC: no space left'), t);
  eq('10 the first swallowed error warns', await lines(), ['warn radar: work-in-progress save failed — carried on without it']);
  D.swallowed('radar', 'work-in-progress save', new Error('ENOSPC'), t + 60_000);
  D.swallowed('radar', 'work-in-progress save', new Error('ENOSPC'), t + 9 * 60_000);
  eq('11 the same site within ten minutes is not written again', await lines(), []);
  D.swallowed('radar', 'work-in-progress save', new Error('ENOSPC'), t + 10 * 60_000);
  eq('12 after ten minutes one more line, marked as repeating', await lines(), ['warn radar: work-in-progress save failed — carried on without it (repeating; one line per 10 min)']);
  D.swallowed('raidwatch', 'raid history append', 'EACCES', t + 10 * 60_000);
  eq('13 a different site is written at once', await lines(), ['warn raidwatch: raid history append failed — carried on without it']);
  const h = D.usePersistHealth.getState();
  eq('14 the dashlet count has every failure, and the last one', [h.failures, h.last.area, h.last.what, h.last.error, h.last.at], [5, 'raidwatch', 'raid history append', 'EACCES', t + 10 * 60_000]);
  eq('15 the quiet window is ten minutes', D.SWALLOW_QUIET_MS, 600_000);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
