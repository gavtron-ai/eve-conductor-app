// Fixtures for the SHIPPED radar.ts (compiled, not re-implemented).
// The bug under test: a WIP file from a PAST day was silently ignored by
// restoreRadarWip, and the first tick of the new day then overwrote it — so
// closing the app before UTC midnight and reopening after it destroyed that
// day's radar record. Also: the WIP save filtered rows more narrowly than the
// rollover flush, so new/gone-only rows never survived a restart at all.

// ---- fake the Electron stats bridge with an in-memory file system ----
const files = new Map();
const appended = [];
global.window = {
  appInfo: {
    stats: {
      auxRead: async (name) => (files.has(name) ? files.get(name) : null),
      auxWrite: async (name, content) => { files.set(name, content); },
      auxAppend: async (name, lines) => {
        appended.push({ name, lines });
        const prev = files.get(name) ?? '';
        files.set(name, prev + lines.join('\n') + '\n');
      },
    },
  },
};

const radar = require('./cl/radar.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const utcDay = (t = Date.now()) => new Date(t).toISOString().slice(0, 10);
const YESTERDAY = utcDay(Date.now() - 86_400_000);
const TODAY = utcDay();

/** a DayRow with only the fields the test cares about */
const row = (over) => ({
  d: YESTERDAY, r: 10000002, t: 34, s: 0,
  rp: 0, fi: 0, fk: 0, nw: 0, gn: 0, co: 0, bp: 0,
  hf: new Array(24).fill(0), hr: new Array(24).fill(0),
  ...over,
});

// ---------------------------------------------------------------------------
// THE BUG: an unflushed day from a previous session
// ---------------------------------------------------------------------------
const repriceRow = row({ t: 34, rp: 7, fi: 100, fk: 5_000_000 });
const churnOnlyRow = row({ t: 35, nw: 4, gn: 2 });   // NO rp/fi — the dropped kind
const emptyRow = row({ t: 36 });                      // genuinely nothing

files.set('radar-wip.json', JSON.stringify({
  day: YESTERDAY,
  rows: [repriceRow, churnOnlyRow, emptyRow],
  cov: [{ r: 10000002, n: 31, cv: new Array(24).fill(1) }],
}));

(async () => {
  await radar.restoreRadarWip();

  // 1. yesterday reached the PERMANENT monthly archive
  const month = YESTERDAY.slice(0, 7);
  const archive = appended.find((a) => a.name === `radar-${month}.ndjson`);
  eq('yesterday was appended to the monthly ndjson', Boolean(archive), true);

  const archivedTypes = (archive?.lines ?? []).map((l) => JSON.parse(l).t).sort();
  // BOTH the reprice row AND the churn-only row survive; the empty one does not
  eq('archive holds the reprice row AND the churn-only row', archivedTypes, [34, 35]);

  // 2. the rolling summary learned about it
  const summary = JSON.parse(files.get('radar-summary.json') ?? '[]');
  const e34 = summary.find((e) => e.t === 34 && e.s === 0);
  eq('summary has a day entry for type 34', e34?.days?.length, 1);
  eq('...with yesterday\'s date', e34?.days?.[0]?.d, YESTERDAY);
  eq('...and its reprice count', e34?.days?.[0]?.rp, 7);

  // 3. coverage was flushed for that day (quiet != unobserved)
  const cov = JSON.parse(files.get('radar-coverage.json') ?? '[]');
  eq('coverage recorded 31 observations for the region', cov[0]?.days?.[0]?.n, 31);
  eq('...filed under yesterday', cov[0]?.days?.[0]?.d, YESTERDAY);

  // 4. the WIP file was reset to today, so the next tick cannot double-append
  const wip = JSON.parse(files.get('radar-wip.json'));
  eq('WIP was reset to today', wip.day, TODAY);
  eq('WIP rows were cleared', wip.rows, []);

  // 5. restore is idempotent — a second call must NOT re-append the day
  const beforeCount = appended.length;
  await radar.restoreRadarWip();
  eq('second restore appends nothing (memoised)', appended.length, beforeCount);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
