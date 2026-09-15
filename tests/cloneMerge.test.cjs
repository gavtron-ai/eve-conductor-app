// THE SAME POD, MODIFIED (v0.200.6) — the sweep that folds a once-worn
// fingerprint into the worn pod when ESI's clone list does not carry it
// and the implants differ by a small edit. Hand-built registries.
const M = require('../electron/cloneMerge.cjs');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };
const NOW = 1_800_000_000_000;
const MIN = 60_000;
const OLD = [1, 2, 3];
const NEW = [1, 2, 3, 4];
const sigOf = (a) => [...a].sort((x, y) => x - y).join(',');

// the edit itself
check('E1 plugged in: one added, none removed', JSON.stringify(M.implantEdit(OLD, NEW)) === JSON.stringify({ added: [4], removed: [], oldSize: 3, newSize: 4 }));
check('E2 small edits: plug in, pull out, swap one, swap two; not a whole new set, not identical', M.isSmallEdit(M.implantEdit(OLD, NEW)) && M.isSmallEdit(M.implantEdit(NEW, OLD)) && M.isSmallEdit(M.implantEdit([1, 2, 3], [1, 2, 9])) && M.isSmallEdit(M.implantEdit([1, 2, 3, 4], [1, 2, 8, 9])) && !M.isSmallEdit(M.implantEdit([1, 2, 3, 4, 5], [6, 7, 8, 9, 10])) && !M.isSmallEdit(M.implantEdit([1, 2, 3], [1, 2, 3])));
check('E3 an empty set never counts', !M.isSmallEdit(M.implantEdit([], [1])) && !M.isSmallEdit(M.implantEdit([1], [])));

// the registry after a poll: worn pod NEW just recorded (lastWorn = NOW), the jump-clone
// list recorded in the same batch (lastListed = NOW), and the ghost OLD from before the implant went in
const base = () => ({
  [sigOf(OLD)]: { implants: OLD, names: [], label: 'PG+CAP', customName: 'Ratting pod', alert: { blink: true, color: '#ff4d4d' }, first: NOW - 30 * 24 * 60 * MIN, seen: NOW - MIN, lastWorn: NOW - MIN, lastListed: 0 },
  [sigOf(NEW)]: { implants: NEW, names: [], label: 'PG+CAP', first: NOW, seen: NOW, lastWorn: NOW, lastListed: 0 },
  '50,60,70,80,90': { implants: [50, 60, 70, 80, 90], names: [], label: 'SNAKE', esiName: 'Snake', first: NOW - 100 * MIN, seen: NOW, lastWorn: NOW - 50 * MIN, lastListed: NOW },
  '7,8,9': { implants: [7, 8, 9], names: [], label: 'LEARNING', first: NOW - 400 * MIN, seen: NOW, lastWorn: 0, lastListed: NOW - 3 * 24 * 60 * MIN },
});
const r1 = M.sweepGhosts(base(), sigOf(NEW), NOW);
check('S1 the ghost (once worn, not listed, one implant fewer) is folded; the listed jump clone and the never-worn record stay', r1.folded.length === 1 && r1.folded[0].oldSig === sigOf(OLD) && !r1.byChar[sigOf(OLD)] && !!r1.byChar['50,60,70,80,90'] && !!r1.byChar['7,8,9'] && Object.keys(r1.byChar).length === 3, JSON.stringify(r1.folded));
check('S2 the fold carries the custom name, alert, first-seen and records what it absorbed', r1.byChar[sigOf(NEW)].customName === 'Ratting pod' && r1.byChar[sigOf(NEW)].alert.blink === true && r1.byChar[sigOf(NEW)].first === NOW - 30 * 24 * 60 * MIN && r1.byChar[sigOf(NEW)].supersedes.join() === sigOf(OLD), JSON.stringify(r1.byChar[sigOf(NEW)]));
// a once-worn pod that ESI DOES list this batch is a real jump clone
const listed = base(); listed[sigOf(OLD)].lastListed = NOW;
const r2 = M.sweepGhosts(listed, sigOf(NEW), NOW);
check('S3 a once-worn pod on ESI\'s current clone list is kept', r2.folded.length === 0 && !!r2.byChar[sigOf(OLD)]);
// a once-worn pod with a very different set is not "this pod modified"
const other = base(); other[sigOf(OLD)].implants = [10, 11, 12, 13, 14];
const r3 = M.sweepGhosts(other, sigOf(NEW), NOW);
check('S4 a very different once-worn set (a podded pod, a heavy refit) is left for the prune', r3.folded.length === 0 && !!r3.byChar[sigOf(OLD)]);
// a chain of edits over months: A ⊂ B ⊂ C, C worn now, none listed → both fold
const chain = {
  '1,2': { implants: [1, 2], names: [], label: '', customName: 'First name', first: NOW - 900 * MIN, seen: NOW - 800 * MIN, lastWorn: NOW - 800 * MIN, lastListed: 0 },
  '1,2,3': { implants: [1, 2, 3], names: [], label: '', first: NOW - 700 * MIN, seen: NOW - 100 * MIN, lastWorn: NOW - 100 * MIN, lastListed: 0 },
  '1,2,3,4': { implants: [1, 2, 3, 4], names: [], label: '', first: NOW - 50 * MIN, seen: NOW, lastWorn: NOW, lastListed: 0 },
};
const r4 = M.sweepGhosts(chain, '1,2,3,4', NOW);
check('S5 months of one-implant edits fold into the worn pod, oldest name carried, both fingerprints recorded', r4.folded.length === 2 && Object.keys(r4.byChar).length === 1 && r4.byChar['1,2,3,4'].customName === 'First name' && r4.byChar['1,2,3,4'].supersedes.length === 2, JSON.stringify(r4.byChar));
// a name on the worn record wins over the ghost's
const named = base(); named[sigOf(NEW)].customName = 'New name';
check('S6 a name already on the worn record wins', M.sweepGhosts(named, sigOf(NEW), NOW).byChar[sigOf(NEW)].customName === 'New name');
// no worn record / an empty worn set → nothing happens
check('S7 no worn record, no sweep', M.sweepGhosts(base(), 'nope', NOW).folded.length === 0);
const bare = base(); bare[sigOf(NEW)].implants = [];
check('S8 an empty worn set never absorbs anything', M.sweepGhosts(bare, sigOf(NEW), NOW).folded.length === 0);
// the sweep is idempotent
const again = M.sweepGhosts(r1.byChar, sigOf(NEW), NOW);
check('S9 running the sweep twice changes nothing', again.folded.length === 0 && Object.keys(again.byChar).length === 3);
// THE LIVE CASE: an 8-implant pod (named) worn 22 min ago, one implant plugged in → 9, then the
// pilot jumped into a 5-implant pod; ESI now lists the 9 as a jump clone. The ghost's successor
// is the LISTED jump clone, not the worn pod.
const P8 = [1, 2, 3, 4, 5, 6, 7, 8], P9 = [...P8, 9], P5 = [20, 21, 22, 23, 24];
const live = {
  [sigOf(P8)]: { implants: P8, names: [], label: '', customName: 'Ratting pod', first: NOW - 500 * MIN, seen: NOW - 22 * MIN, lastWorn: NOW - 22 * MIN, lastListed: 0 },
  [sigOf(P9)]: { implants: P9, names: [], label: '', esiName: 'Ratting', first: NOW - 20 * MIN, seen: NOW, lastWorn: NOW - 12 * MIN, lastListed: NOW },
  [sigOf(P5)]: { implants: P5, names: [], label: '', first: NOW - 10 * MIN, seen: NOW, lastWorn: NOW, lastListed: 0 },
};
const r10 = M.sweepGhosts(live, sigOf(P5), NOW);
check('S10 the ghost folds into the listed jump clone it became, carrying its name; the worn pod is untouched', r10.folded.length === 1 && r10.folded[0].intoSig === sigOf(P9) && r10.byChar[sigOf(P9)].customName === 'Ratting pod' && !r10.byChar[sigOf(P8)] && r10.byChar[sigOf(P5)].customName === undefined, JSON.stringify(r10.folded));
// two possible successors: the closer edit wins; equal edits go to the body worn most recently
const two = {
  '1,2,3': { implants: [1, 2, 3], names: [], label: '', first: NOW - 900 * MIN, seen: NOW - 300 * MIN, lastWorn: NOW - 300 * MIN, lastListed: 0 },
  '1,2,3,4': { implants: [1, 2, 3, 4], names: [], label: '', first: NOW - 200 * MIN, seen: NOW, lastWorn: NOW - 200 * MIN, lastListed: NOW },
  '1,2,3,4,5': { implants: [1, 2, 3, 4, 5], names: [], label: '', first: NOW - 100 * MIN, seen: NOW, lastWorn: NOW, lastListed: 0 },
};
const r11 = M.sweepGhosts(two, '1,2,3,4,5', NOW);
check('S11 the ghost goes to the closest body (one implant away), not the worn pod two away', r11.folded.length === 1 && r11.folded[0].intoSig === '1,2,3,4', JSON.stringify(r11.folded));
const tie = { ...two, '1,2,3,4': { ...two['1,2,3,4'], implants: [1, 2, 3, 9] }, '1,2,3,4,5': { ...two['1,2,3,4,5'], implants: [1, 2, 3, 8] } };
const r12 = M.sweepGhosts(tie, '1,2,3,4,5', NOW);
check('S12 equal edits: the body worn most recently (the worn pod) takes the ghost', r12.folded.length === 1 && r12.folded[0].intoSig === '1,2,3,4,5', JSON.stringify(r12.folded));

console.log(`cloneMerge.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
