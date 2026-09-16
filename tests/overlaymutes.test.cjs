// OVERLAY ALERT MUTES (v0.202.1) — dismiss / snooze / snooze-all, keys,
// pruning, and the tolerant parsers. Hand-computed.

const M = require('./sim/lib/overlayMutes.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const NOW = 1_700_000_000_000, MIN = 60_000, H = 3600_000;

// keys
const a = { charId: 1001, charName: 'Alpha', kind: 'stopped', since: NOW - 5 * MIN };
eq('K1 mining key carries the raise time', M.miningKey(a), `mining:1001:stopped:${NOW - 5 * MIN}`);
eq('K2 planet key', M.piKey({ charName: 'Alpha', planetName: 'Kino V', sev: 0 }), 'pi:Alpha:Kino V:0');
eq('K3 raid key', M.raidKey({ planetId: 40000001, state: 'open' }), 'raid:40000001:open');

// empty: nothing muted
let m = M.emptyMutes();
eq('E1 nothing muted', [M.isMuted(m, M.miningKey(a), NOW), M.muteReason(m, M.miningKey(a), NOW)], [false, '']);

// dismiss = until 0 → hidden now, and still hidden hours later (until it goes away on its own)
m = M.mute(m, M.miningKey(a), 0, NOW);
eq('D1 dismissed: hidden now', M.muteReason(m, M.miningKey(a), NOW), 'dismissed');
eq('D2 dismissed: hidden 5 h later', M.isMuted(m, M.miningKey(a), NOW + 5 * H), true);
// a fresh occurrence (new since) is a different key: shown
eq('D3 a fresh raise of the same character shows', M.isMuted(m, M.miningKey({ ...a, since: NOW + 10 * MIN }), NOW + 10 * MIN), false);
// pruned a day later
eq('D4 dismissal pruned after a day', Object.keys(M.pruneMutes(m, NOW + M.DISMISS_TTL_MS).items), []);
eq('D5 …but kept just before', Object.keys(M.pruneMutes(m, NOW + M.DISMISS_TTL_MS - 1).items), [M.miningKey(a)]);

// snooze = until a time
m = M.mute(M.emptyMutes(), 'pi:Alpha:Kino V:0', NOW + 10 * MIN, NOW);
eq('S1 snoozed: hidden inside the window', [M.isMuted(m, 'pi:Alpha:Kino V:0', NOW + 9 * MIN), M.muteReason(m, 'pi:Alpha:Kino V:0', NOW)], [true, 'snoozed']);
eq('S2 snoozed: shown once it lapses', M.isMuted(m, 'pi:Alpha:Kino V:0', NOW + 10 * MIN), false);
eq('S3 lapsed snooze pruned', Object.keys(M.pruneMutes(m, NOW + 10 * MIN).items), []);
eq('S4 unmute removes it', Object.keys(M.unmute(m, 'pi:Alpha:Kino V:0').items), []);

// snooze everything
m = M.muteAll(M.emptyMutes(), NOW + H);
eq('A1 all: any key hidden', [M.isMuted(m, 'raid:1:open', NOW), M.muteReason(m, 'raid:1:open', NOW)], [true, 'all']);
eq('A2 all: lapses', M.isMuted(m, 'raid:1:open', NOW + H), false);
eq('A3 all: pruned to 0 once lapsed', M.pruneMutes(m, NOW + H).all, 0);
eq('A4 clear wipes everything', M.clearMutes(), { v: 1, all: 0, items: {} });

// parsers tolerate garbage and unknown shapes
eq('P1 null → empty', M.parseMutes(null), { v: 1, all: 0, items: {} });
eq('P2 garbage → empty', M.parseMutes('{not json'), { v: 1, all: 0, items: {} });
eq('P3 partial entries dropped', M.parseMutes(JSON.stringify({ all: 5, items: { good: { until: 1, at: 2 }, bad: { until: 'x' }, worse: null } })), { v: 1, all: 5, items: { good: { until: 1, at: 2 } } });
eq('P4 snapshot: null / garbage / no clock → null', [M.parseSnapshot(null), M.parseSnapshot('nope'), M.parseSnapshot('{"mining":[]}')], [null, null, null]);
eq('P5 snapshot: lists default to empty', M.parseSnapshot(JSON.stringify({ at: NOW, mining: [a] })), { at: NOW, mining: [a], pi: [], raids: [] });

console.log(`overlaymutes.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
