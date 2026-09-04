// v0.175.0 — PI CARRY-FORWARD (pure). The module must never open empty
// when the app has data from any earlier run, and a planet must never
// vanish because one HTTP call failed. Semantics pinned here.

const { mergeCarryForward } = require('./sim/lib/piCarry.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `\n      got=${JSON.stringify(g)}\n     want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};

const P = (charId, planetId, tag) => ({ charId, planetId, tag });
const keys = (list) => list.map((p) => `${p.charId}:${p.planetId}:${p.tag}`);

// C1: fresh wins over previous for the same planet
{
  const prev = [P(1, 10, 'old')];
  const fresh = [P(1, 10, 'new')];
  const out = mergeCarryForward(prev, fresh, new Map([[1, new Set([10])]]), new Set([1]));
  eq('C1 fresh replaces old', keys(out), ['1:10:new']);
}

// C2: list read FAILED for char 2 → all their planets carry forward
{
  const prev = [P(2, 20, 'old'), P(2, 21, 'old')];
  const out = mergeCarryForward(prev, [], new Map(), new Set([2]));
  eq('C2 failed list keeps everything', keys(out), ['2:20:old', '2:21:old']);
}

// C3: list read OK, planet gone from it → truly abandoned, dropped
{
  const prev = [P(3, 30, 'old'), P(3, 31, 'old')];
  const fresh = [P(3, 30, 'new')];
  const out = mergeCarryForward(prev, fresh, new Map([[3, new Set([30])]]), new Set([3]));
  eq('C3 abandoned planet dropped', keys(out), ['3:30:new']);
}

// C4: listed but detail read failed → that planet carries as last-known
{
  const prev = [P(4, 40, 'old'), P(4, 41, 'old')];
  const fresh = [P(4, 40, 'new')]; // 41's detail failed
  const out = mergeCarryForward(prev, fresh, new Map([[4, new Set([40, 41])]]), new Set([4]));
  eq('C4 unreadable planet carries last-known', keys(out), ['4:40:new', '4:41:old']);
}

// C5: character no longer watched → dropped
{
  const prev = [P(5, 50, 'old')];
  const out = mergeCarryForward(prev, [], new Map(), new Set([6]));
  eq('C5 unwatched dropped', keys(out), []);
}

// C6: successful EMPTY list (colony torn down) → previous planets dropped
{
  const prev = [P(7, 70, 'old')];
  const out = mergeCarryForward(prev, [], new Map([[7, new Set()]]), new Set([7]));
  eq('C6 successful empty list clears the char', keys(out), []);
}

console.log(`\npicarry.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exitCode = 1;
