// Fixtures for the SHIPPED esiRate.ts (compiled, not re-implemented).
//
//  A. the GLOBAL error limit — 100 non-2xx per 60s closes EVERY ESI route
//     with a 420, so all traffic must report in and back off before that.
//  B. PRIORITY LANES — the user: "when we are pausing all ESI I get really
//     nervous". Pressure must shed from the bottom: the bulk market sweep
//     stops long before the overlay that is on screen at all times.
//  C. the token window SURVIVING A RESTART — CCP's 15-minute window is
//     wall-clock, so a fresh process must not assume a full budget.

const store = new Map();
global.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const near = (label, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol;
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${got} want≈${want}±${tol}`}`);
  ok ? pass++ : fail++;
};

const path = require.resolve('./rate/esiRate.js');
const fresh = () => { delete require.cache[path]; return require(path); };
let R = fresh();
const H = (o = {}) => new Headers(o);
const blocked = (lane) => R.esiErrorState(lane).blockedUntil !== null;

// ---- token costs, straight from CCP's published table ------------------
eq('2xx costs 2 tokens', R.tokenCost(201), 2);
eq('3xx costs 1', R.tokenCost(304), 1);
eq('4xx costs 5', R.tokenCost(404), 5);
eq('5xx costs 0', R.tokenCost(503), 0);
eq('429 is excluded', R.tokenCost(429), 0);

// ---- A. THE GLOBAL ERROR LIMIT ----------------------------------------
// ABSENT IS NOT ZERO: a response with no rate headers must not read as
// "no budget left" and stall the whole app.
R.noteEsiResponse(200, H());
eq('a header-less 200 blocks nothing', R.esiErrorState().blockedUntil, null);
eq('...and does not invent an error budget', R.esiErrorState().remain, null);

R = fresh();
R.noteEsiResponse(404, H({ 'x-esi-error-limit-remain': '95', 'x-esi-error-limit-reset': '42' }));
eq('95 errors left pauses nothing at all', R.esiErrorState().pausedLanes, []);
eq('the server figure is recorded', R.esiErrorState().remain, 95);

// ---- B. PRESSURE SHEDS FROM THE BOTTOM --------------------------------
// floors: bulk 50, background 35, interactive 20, overlay 5
R = fresh();
R.noteEsiResponse(404, H({ 'x-esi-error-limit-remain': '45', 'x-esi-error-limit-reset': '30' }));
eq('45 left: the BULK market sweep stands down', blocked('bulk'), true);
eq('45 left: background collectors keep going', blocked('background'), false);
eq('45 left: the screen keeps going', blocked('interactive'), false);
eq('45 left: THE OVERLAY KEEPS GOING', blocked('overlay'), false);

R = fresh();
R.noteEsiResponse(404, H({ 'x-esi-error-limit-remain': '30', 'x-esi-error-limit-reset': '30' }));
eq('30 left: bulk AND background are down', [blocked('bulk'), blocked('background')], [true, true]);
eq('30 left: the screen still works', blocked('interactive'), false);
eq('30 left: THE OVERLAY STILL WORKS', blocked('overlay'), false);

R = fresh();
R.noteEsiResponse(404, H({ 'x-esi-error-limit-remain': '15', 'x-esi-error-limit-reset': '30' }));
eq('15 left: everything but the overlay is down', blocked('interactive'), true);
eq('15 left: THE OVERLAY IS STILL UP', blocked('overlay'), false);
eq('...and it reports which lanes are paused, worst first',
  R.esiErrorState().pausedLanes, ['bulk', 'background', 'interactive']);

R = fresh();
R.noteEsiResponse(404, H({ 'x-esi-error-limit-remain': '3', 'x-esi-error-limit-reset': '30' }));
eq('3 left: even the overlay finally yields', blocked('overlay'), true);
eq('...but this is NOT a hard block', R.esiErrorState().hardBlocked, false);

// a 429 is per-group: it must never take the overlay off the screen
R = fresh();
R.noteEsiResponse(429, H({ 'retry-after': '30' }), 'interactive');
eq('a 429 on the fitting push pauses the push', blocked('interactive'), true);
eq('...and the bulk sweep below it', blocked('bulk'), true);
eq('...but NOT the overlay', blocked('overlay'), false);

R = fresh();
R.noteEsiResponse(429, H({ 'retry-after': '30' }), 'bulk');
eq('a 429 on the radar pauses only the radar', blocked('bulk'), true);
eq('...the screen is untouched', blocked('interactive'), false);
eq('...the overlay is untouched', blocked('overlay'), false);

// a 420 means the server is already refusing everything — no lane is spared
R = fresh();
R.noteEsiResponse(420, H({ 'x-esi-error-limit-reset': '30' }), 'bulk');
eq('a 420 stops every lane, overlay included', blocked('overlay'), true);
eq('...and says so plainly', R.esiErrorState().hardBlocked, true);
near('...for the reset the server named, plus 5s margin',
  R.esiErrorState('overlay').blockedUntil - Date.now(), 35_000, 1500);

R = fresh();
R.noteEsiResponse(420, H());
near('a bare 420 falls back to 60s + margin', R.esiErrorState().blockedUntil - Date.now(), 65_000, 1500);
R.noteEsiResponse(200, H({ 'x-esi-error-limit-remain': '100' }));
eq('a healthy 200 cannot cancel an active 420', blocked('overlay'), true);

// the gate really waits, and a stopped run escapes it
R = fresh();
R.noteEsiResponse(429, H({ 'retry-after': '1' }), 'interactive');
(async () => {
  const t0 = Date.now();
  await R.esiGate('interactive');
  near('esiGate() blocks the caller for the full pause', Date.now() - t0, 1000, 400);

  const t1 = Date.now();
  await R.esiGate('overlay');
  near('...while the overlay lane passes straight through', Date.now() - t1, 0, 150);

  R = fresh();
  R.noteEsiResponse(420, H({ 'x-esi-error-limit-reset': '600' }));
  let threw = null;
  try { await R.esiGate('interactive', () => true); } catch (e) { threw = e.message; }
  eq('a stopped run escapes the gate instead of hanging', threw, 'stopped');

  // ---- C. THE WINDOW SURVIVES A RESTART -------------------------------
  store.clear();
  R = fresh();
  const G = R.FITTING_GROUP;
  eq('a clean start has the full safe budget (150 x 0.8)', R.rateStatus(G).remaining, 120);

  for (let i = 0; i < 50; i++) R.rateObserve(G, 201, H());
  eq('after 50 creates, 20 tokens remain', R.rateStatus(G).remaining, 20);

  R = fresh(); // *** RESTART ***
  eq('a RESTART still knows 100 tokens are spent', R.rateStatus(G).remaining, 20);

  store.set('eve-conductor-esi-rate-fitting',
    JSON.stringify({ windowStart: Date.now() - 16 * 60_000, spent: 140 }));
  R = fresh();
  eq('a window older than 15 min is spent, not resumed', R.rateStatus(G).remaining, 120);

  store.set('eve-conductor-esi-rate-fitting', '{"windowStart":"soon","spent":-4}');
  R = fresh();
  eq('a corrupt saved window falls back to a fresh one', R.rateStatus(G).remaining, 120);

  store.set('eve-conductor-esi-rate-fitting',
    JSON.stringify({ windowStart: Date.now() + 3_600_000, spent: 140 }));
  R = fresh();
  eq('a future-dated window (clock moved) is discarded', R.rateStatus(G).remaining, 120);

  store.clear();
  R = fresh();
  eq('pace is one call every 15s', R.rateStatus(G).paceMs, 15_000);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
