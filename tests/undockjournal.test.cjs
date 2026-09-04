// v0.168.0 — UNDOCK JOURNAL (pure). The game log never records structure
// undocks (measured against 60 live session files), so the app journals
// docked→undocked flips seen by the overlay's ESI location poll. These
// fixtures pin the trim rules and the reader.

const { pushUndock, lastUndocks, parseJournal } = require('./sim/lib/undockJournal.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};

const DAY = 24 * 3600_000;
const T0 = 1_800_000_000_000;

// U1: append + last
{
  let j = {};
  j = pushUndock(j, 111, T0);
  j = pushUndock(j, 111, T0 + 1000);
  j = pushUndock(j, 222, T0 + 500);
  eq('U1a arrays per char', j, { '111': [T0, T0 + 1000], '222': [T0 + 500] });
  eq('U1b lastUndocks keys the Log Visualizer way', [...lastUndocks(j).entries()],
    [['#111', T0 + 1000], ['#222', T0 + 500]]);
}

// U2: 7-day trim — an entry 8 days older than the new one drops
{
  let j = pushUndock({}, 111, T0);
  j = pushUndock(j, 111, T0 + 8 * DAY);
  eq('U2 entries older than 7 days trim on push', j['111'], [T0 + 8 * DAY]);
}

// U3: cap at 50 per char, keeping the newest
{
  let j = {};
  for (let i = 0; i < 60; i++) j = pushUndock(j, 111, T0 + i * 1000);
  eq('U3 keeps the latest 50', [j['111'].length, j['111'][0], j['111'][49]],
    [50, T0 + 10_000, T0 + 59_000]);
}

// U4: reader tolerates garbage
{
  eq('U4a null → empty', parseJournal(null), {});
  eq('U4b junk → empty', parseJournal('{nope'), {});
  eq('U4c wrong shapes dropped', parseJournal('{"111":[1,"x",2],"222":"bad"}'), { '111': [1, 2] });
}

// U5: computeUndockCuts — the "docked, changed ships a few times, then
// undocked" case that v0.168 missed. Latest boundary wins per character
// across reship events, the journal, and logins; unselected chars ignored.
{
  const { computeUndockCuts } = require('./sim/lib/undockJournal.js');
  const ev = [
    { t: 1000, kind: 'mine', ck: '#1' },
    { t: 2000, kind: 'reship', ck: '#1' },   // disembark while docked
    { t: 2500, kind: 'reship', ck: '#1' },   // swapped again — LAST marker
    { t: 9000, kind: 'reship', ck: '#3' },   // someone not selected
  ];
  const journal = new Map([['#1', 1800], ['#2', 4000]]);
  const logins = new Map([['#1', 500], ['#2', 3000], ['#3', 9500]]);
  const cuts = computeUndockCuts(ev, journal, logins, new Set(['#1', '#2']));
  eq('U5a last ship-change beats journal and login', cuts.get('#1'), 2500);
  eq('U5b journal beats login when later', cuts.get('#2'), 4000);
  eq('U5c unselected character ignored', cuts.has('#3'), false);
  const none = computeUndockCuts([], new Map(), new Map(), new Set(['#9']));
  eq('U5d no boundary -> absent (caller falls back honestly)', none.has('#9'), false);
}

console.log(`\nundockjournal.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
