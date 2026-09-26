// CHARACTER STATE (v0.221.0, audit A1) — one shared reader for online / ship / location, asked for
// nothing while a pilot is offline, cached to ESI's expiry, shared between the overlay and the ship
// watcher. Every count below is hand-computed from the rules in src/lib/charState.ts.
//   node tests/charstate.test.cjs
const C = require('./sim/lib/charState.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};
const S = 1000;

/** a fake ESI: what each character answers, with a call log */
const calls = [];
const fake = (onlineOf, expiresIn = null) => ({
  online: async (id) => { calls.push(`online:${id}`); return { data: { online: onlineOf(id) }, expiresIn }; },
  ship: async (id) => { calls.push(`ship:${id}`); return { data: { ship_type_id: 100 + id, ship_name: `S${id}` }, expiresIn }; },
  location: async (id) => { calls.push(`loc:${id}`); return { data: { solar_system_id: 30000000 + id }, expiresIn }; },
});

(async () => {
  // ---- 1. an offline pilot costs the flag and nothing else
  C._resetCharState(); calls.length = 0;
  let r = await C.readCharState(1, true, fake(() => false), 0);
  eq('O1 offline: only /online/ asked; no ship, no location', calls, ['online:1']);
  eq('O2 …and the state says so', [r.online, r.ship, r.loc, r.asked], [false, null, null, { online: true, ship: false, loc: false }]);
  r = await C.readCharState(1, true, fake(() => false), 30 * S);
  eq('O3 30 s later, attentive: the flag is still trusted (55 s) — nothing asked', calls, ['online:1']);
  r = await C.readCharState(1, true, fake(() => false), 56 * S);
  eq('O4 56 s later: the flag is re-asked, still nothing else', calls, ['online:1', 'online:1']);
  eq('O5 skipped-offline counter', C.charStateCounts.skippedOffline, 3);

  // ---- 2. an online pilot, someone watching: every tick (5-s cache)
  C._resetCharState(); calls.length = 0;
  r = await C.readCharState(2, true, fake(() => true), 0);
  eq('A1 online + attentive: flag, ship and location asked once', calls.sort(), ['loc:2', 'online:2', 'ship:2']);
  eq('A2 the state carries all three', [r.online, r.ship.ship_type_id, r.loc.solar_system_id], [true, 102, 30000002]);
  calls.length = 0;
  r = await C.readCharState(2, true, fake(() => true), 4 * S);
  eq('A3 4 s later: all three from cache', [calls, r.asked], [[], { online: false, ship: false, loc: false }]);
  r = await C.readCharState(2, true, fake(() => true), 6 * S);
  eq('A4 6 s later (a tick): ship + location re-asked, the flag (55 s) not', calls.sort(), ['loc:2', 'ship:2']);

  // ---- 3. an online pilot, nobody watching: once a minute
  C._resetCharState(); calls.length = 0;
  await C.readCharState(3, false, fake(() => true), 0);
  calls.length = 0;
  await C.readCharState(3, false, fake(() => true), 6 * S);
  await C.readCharState(3, false, fake(() => true), 30 * S);
  await C.readCharState(3, false, fake(() => true), 59 * S);
  eq('I1 idle: ticks at 6, 30 and 59 s ask nothing', calls, []);
  await C.readCharState(3, false, fake(() => true), 61 * S);
  eq('I2 at 61 s: ship + location again (the flag lasts 5 min idle)', calls.sort(), ['loc:3', 'ship:3']);
  calls.length = 0;
  await C.readCharState(3, false, fake(() => true), 301 * S);
  eq('I3 at 301 s: the flag too', calls.sort(), ['loc:3', 'online:3', 'ship:3']);

  // ---- 4. ESI's own expiry lengthens a cache, never shortens it
  C._resetCharState(); calls.length = 0;
  await C.readCharState(4, true, fake(() => true, 30), 0);   // expires in 30 s
  calls.length = 0;
  await C.readCharState(4, true, fake(() => true, 30), 20 * S);
  eq('E1 expires=30 s: an attentive read at 20 s is still cached', calls, []);
  C._resetCharState(); calls.length = 0;
  await C.readCharState(4, false, fake(() => true, 5), 0);    // expires in 5 s, idle floor 60
  calls.length = 0;
  await C.readCharState(4, false, fake(() => true, 5), 30 * S);
  eq('E2 expires=5 s does not shorten the idle minute', calls, []);

  // ---- 5. a failed refresh keeps the last answer for one more poll
  C._resetCharState(); calls.length = 0;
  await C.readCharState(5, true, fake(() => true), 0);
  const failing = { ...fake(() => true), ship: async () => { throw new Error('502'); }, location: async () => { throw new Error('502'); } };
  r = await C.readCharState(5, true, failing, 10 * S);
  eq('F1 ESI down: last known ship and system still returned', [r.ship.ship_type_id, r.loc.solar_system_id], [105, 30000005]);
  C._resetCharState();
  r = await C.readCharState(6, true, failing, 0);
  eq('F2 ESI down, never answered: nulls, not a throw', [r.online, r.ship, r.loc], [true, null, null]);

  // ---- 6. the shared cache: the ship watcher's read is free after the overlay's
  C._resetCharState(); calls.length = 0;
  await C.readCharState(7, true, fake(() => true), 0);       // the overlay, attentive
  calls.length = 0;
  await C.readCharState(7, false, fake(() => true), 3 * S);  // the ship watcher, idle, 3 s later
  eq('S1 the ship watcher reuses the overlay\'s answers', calls, []);
  eq('S2 lastKnown reads the caches without asking', C.lastKnown(7).ship.ship_type_id, 107);

  // ---- 7. the day's cost, 12 pilots, 4 online, 14,400 ticks — the audit's scenario
  C._resetCharState(); calls.length = 0;
  const fx = fake((id) => id <= 4);
  for (let tick = 0; tick < 14_400; tick++) for (let id = 1; id <= 12; id++) await C.readCharState(id, true, fx, tick * 6 * S);
  const perDay = calls.length;
  const before = 12 * 2 * 14_400 + 12 * Math.ceil(86_400 / 55);   // 345,600 ship+location + 18,852 online flags
  eq('D1 12 pilots, 4 online, overlay open all day: ≈ 132k requests, not 364k', [perDay < 140_000, perDay > 120_000, before], [true, true, 364_452]);
  console.log(`   (measured: ${perDay.toLocaleString()} asks in the day — ${(100 * perDay / before).toFixed(0)} % of the old figure)`);

  console.log(`charstate.test: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exitCode = 1;
})();
