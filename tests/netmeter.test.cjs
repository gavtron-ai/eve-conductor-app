// NET METER (v0.221.0, audit A3/F6) — the pure parts: host labels and the per-day fold.
//   node tests/netmeter.test.cjs
const M = require('./sim/lib/netMeter.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

eq('H1 ESI', M.hostLabel('https://esi.evetech.net/latest/characters/1/location/?datasource=tranquility'), 'ESI (CCP)');
eq('H2 images', M.hostLabel('https://images.evetech.net/characters/1/portrait?size=64'), 'images (CCP)');
eq('H3 Fuzzwork, either host', [M.hostLabel('https://market.fuzzwork.co.uk/aggregates/?region=1'), M.hostLabel('https://www.fuzzwork.co.uk/dump/latest/csv/x.csv')], ['Fuzzwork', 'Fuzzwork']);
eq('H4 zKillboard', M.hostLabel('https://zkillboard.com/api/kills/corporationID/1/'), 'zKillboard');
eq('H5 GitHub, both hosts', [M.hostLabel('https://github.com/x/y/releases/download/v1/latest.yml'), M.hostLabel('https://objects.githubusercontent.com/x')], ['GitHub', 'GitHub']);
eq('H6 ntfy', M.hostLabel('https://ntfy.sh/some-topic'), 'ntfy');
eq('H7 not counted: localhost, file, blob, data', [M.hostLabel('http://localhost:5173/src/x.ts'), M.hostLabel('file:///C:/x.js'), M.hostLabel('blob:file:///abc'), M.hostLabel('data:image/png;base64,xx')], [null, null, null, null]);
eq('H8 an unknown host is "other" (never its name)', M.hostLabel('https://example.org/a'), 'other');
eq('H9 junk is not counted', M.hostLabel('not a url'), null);

const D0 = Date.UTC(2026, 8, 23, 23, 59, 0);
let st = M.emptyMeter(D0);
let r = M.foldUrls(st, ['https://esi.evetech.net/a', 'https://esi.evetech.net/b', 'https://images.evetech.net/c', 'http://localhost:5173/x'], D0);
eq('F1 fold: counted per label, localhost ignored', r.state.today, { day: '2026-09-23', hosts: { 'ESI (CCP)': 2, 'images (CCP)': 1 } });
eq('F2 no day closed', r.closed, null);
r = M.foldUrls(r.state, ['https://zkillboard.com/api/x'], D0 + 2 * 60_000);   // 00:01 next day
eq('F3 midnight UTC: yesterday closed with its totals, today starts fresh', [r.closed, r.state.yesterday, r.state.today], [
  { day: '2026-09-23', hosts: { 'ESI (CCP)': 2, 'images (CCP)': 1 } },
  { day: '2026-09-23', hosts: { 'ESI (CCP)': 2, 'images (CCP)': 1 } },
  { day: '2026-09-24', hosts: { zKillboard: 1 } },
]);
eq('F4 total', [M.meterTotal(r.closed), M.meterTotal(r.state.today), M.meterTotal(null)], [3, 1, 0]);
r = M.foldUrls(r.state, [], D0 + 3 * 60_000);
eq('F5 folding nothing changes nothing', r.state.today, { day: '2026-09-24', hosts: { zKillboard: 1 } });

console.log(`netmeter.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
