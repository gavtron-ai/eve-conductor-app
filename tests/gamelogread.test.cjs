// GAME LOG TAIL FOLLOW (v0.202) — electron/gamelog.cjs readFrom() against a
// real temp file tree, and the renderer's incremental reader (miningFeed)
// against a fake bridge. Both are what the mining watch stands on.

const fs = require('fs');
const os = require('os');
const path = require('path');
const gl = require('../electron/gamelog.cjs');
const feed = require('./sim/lib/miningFeed.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const NL = String.fromCharCode(10);

// ---- 1. readFrom on disk --------------------------------------------------------
const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'evegl-'));
const dir = path.join(docs, 'EVE', 'logs', 'Gamelogs');
fs.mkdirSync(dir, { recursive: true });
const FILE = '20260915_120000_1001.txt';
const full = path.join(dir, FILE);
const header = ['------------------------------------------------------------', '  Gamelog', '  Listener: Alpha', '  Session Started: 2026.09.15 12:00:00', '------------------------------------------------------------', ''].join(NL);
const line = (hhmmss, body) => `[ 2026.09.15 ${hhmmss} ] (mining) ${body}`;
fs.writeFileSync(full, header + line('12:03:00', 'You mined 137 units of Gneiss IV-Grade') + NL);
{
  const r = gl.readFrom(docs, FILE, 0);
  eq('R1 whole file from 0', [r.ok, r.next === r.size, r.text.includes('You mined 137')], [true, true, true]);
  const first = r.next;
  const r2 = gl.readFrom(docs, FILE, first);
  eq('R2 nothing appended: empty text, same offset', [r2.ok, r2.text, r2.next], [true, '', first]);
  fs.appendFileSync(full, line('12:06:00', 'You mined 140 units of Gneiss IV-Grade') + NL);
  const r3 = gl.readFrom(docs, FILE, first);
  eq('R3 only the appended line', r3.text, line('12:06:00', 'You mined 140 units of Gneiss IV-Grade') + NL);
  eq('R4 next advances by the appended bytes', r3.next, first + Buffer.byteLength(r3.text));
  const r4 = gl.readFrom(docs, FILE, 10_000_000);
  eq('R5 an offset past the end starts over', [r4.ok, r4.next === r4.size, r4.text.startsWith('---')], [true, true, true]);
  eq('R6 a bad name is refused', gl.readFrom(docs, '../secret.txt', 0).ok, false);
  eq('R7 a missing file is not ok', gl.readFrom(docs, '20260101_000000_5.txt', 0).ok, false);
}

// ---- 2. the incremental reader against a fake bridge ---------------------------
{
  const NOW = Date.UTC(2026, 8, 15, 12, 10, 0);
  // a fake "disk": file → text; the bridge serves bytes like the real one
  const disk = new Map();
  const meta = (file, charId, listener, mtimeMs) => ({ file, charId, listener, mtimeMs, size: Buffer.byteLength(disk.get(file) ?? ''), dateKey: '2026-09-15', sessionStart: null });
  const bridge = {
    list: async () => ({ ok: true, files: [
      meta('20260915_120000_1001.txt', '1001', 'Alpha', NOW - 60_000),
      meta('20260914_120000_1001.txt', '1001', 'Alpha', NOW - 26 * 3600_000),  // yesterday's — stale
      meta('20260915_113000_1002.txt', '1002', 'Bravo', NOW - 120_000),
      meta('20260915_113000.txt', null, null, NOW - 1000),                     // no character id — ignored
    ] }),
    readFrom: async (file, offset) => {
      const text = disk.get(file) ?? '';
      const buf = Buffer.from(text, 'utf8');
      const start = offset > buf.length ? 0 : offset;
      return { ok: true, size: buf.length, next: buf.length, text: buf.toString('utf8', start) };
    },
  };
  disk.set('20260915_120000_1001.txt', header + line('12:03:00', 'You mined 137 units of Gneiss IV-Grade') + NL
    + line('12:03:00', 'Critical mining success! You mined an additional 400 units of Gneiss IV-Grade') + NL
    + line('12:03:01', 'Additional 30 units depleted from asteroid as residue') + NL
    + line('12:06:00', 'You mined 137 units of Gneiss IV-Grade') + NL);
  disk.set('20260914_120000_1001.txt', header + line('09:00:00', 'You mined 999 units of Veldspar') + NL);
  disk.set('20260915_113000_1002.txt', header.replace('Alpha', 'Bravo') + line('12:05:30', 'You mined 50 units of Veldspar') + NL
    + '[ 2026.09.15 12:05:31 ] (combat) 12 from Guristas Rookie - Hits' + NL
    + line('12:06:15', 'You mined 50 units of Veld'));   // unterminated: the client is mid-write
  const st = feed.emptyFeed();
  (async () => {
    let got = await feed.pollMiningSamples(st, bridge, NOW);
    eq('I1 follows one live file per character (the stale one and the id-less one ignored)',
      [...st.tracked.keys()].sort(), [1001, 1002]);
    eq('I2 only "You mined" lines become samples — crit, residue, combat do not; the unterminated line waits',
      got.map((s) => [s.charId, s.charName, new Date(s.t).toISOString().slice(11, 19)]),
      [[1001, 'Alpha', '12:03:00'], [1001, 'Alpha', '12:06:00'], [1002, 'Bravo', '12:05:30']]);
    eq('I3 the partial line is kept as the remainder', st.tracked.get(1002).rest, line('12:06:15', 'You mined 50 units of Veld'));
    // the client finishes the line and adds another; the list is NOT re-read (30 s cadence)
    disk.set('20260915_113000_1002.txt', disk.get('20260915_113000_1002.txt') + 'spar' + NL + line('12:07:00', 'You mined 50 units of Veldspar') + NL);
    got = await feed.pollMiningSamples(st, bridge, NOW + 6000);
    eq('I4 next poll: the completed line and the new one, nothing re-read for Alpha',
      got.map((s) => [s.charId, new Date(s.t).toISOString().slice(11, 19)]), [[1002, '12:06:15'], [1002, '12:07:00']]);
    // a first read that starts mid-file skips its partial first line
    const st2 = feed.emptyFeed();
    feed.adoptFiles(st2, [{ ...meta('20260915_120000_1001.txt', '1001', 'Alpha', NOW - 60_000), size: 10 * 1024 * 1024 }], NOW);
    eq('I5 a big file is picked up from its tail', st2.tracked.get(1001).offset, 10 * 1024 * 1024 - 256 * 1024);
    eq('I6 …and told to drop the partial first line', st2.tracked.get(1001).skipPartial, true);
    // a new session file for the same character replaces the old one and starts from the beginning of the tail
    feed.adoptFiles(st, [meta('20260915_121500_1001.txt', '1001', 'Alpha', NOW + 900_000)], NOW + 900_000);
    eq('I7 a newer session file replaces the followed one', [st.tracked.get(1001).file, st.tracked.get(1001).offset], ['20260915_121500_1001.txt', 0]);
    eq('I8 characters no longer listed are dropped', st.tracked.has(1002), false);
    console.log(`gamelogread.test: ${pass} passed, ${fail} failed`);
    fs.rmSync(docs, { recursive: true, force: true });
    process.exit(fail === 0 ? 0 : 1);
  })();
}
