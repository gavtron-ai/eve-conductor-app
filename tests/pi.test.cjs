// Fixtures for the SHIPPED src/lib/pi.ts.
//
// PI is the one part of EVE that punishes inattention with SILENT LOSS: when
// a planet's storage fills, the extractors keep running and their output is
// discarded, and the game says nothing. So the expensive wrong answers here
// are, in order:
//   - saying a full planet is fine
//   - saying an unreadable planet is empty
//   - inventing a fill rate before there is anything to measure

const NL = String.fromCharCode(10);
const disk = new Map();
global.localStorage = {
  getItem: (k) => (disk.has(k) ? disk.get(k) : null),
  setItem: (k, v) => disk.set(k, String(v)),
  removeItem: (k) => disk.delete(k),
};
global.window = { appInfo: {}, localStorage: global.localStorage };

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const ok = (label, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond ? '' : `   ${extra}`}`);
  cond ? pass++ : fail++;
};
const near = (label, got, want, tol) =>
  ok(label, got !== null && Math.abs(got - want) <= tol, `got=${got} want≈${want}±${tol}`);

const pi = require('./pi/pi.js');
const { pinRole, STORAGE_ROLES } = require('./pi/piTypes.js');

// ===== A. THE GENERATED TYPE TABLE ======================================
// classification is what decides whether a pin's capacity counts at all
eq('a Temperate Launchpad is a launchpad', pinRole(2256), 'launchpad');
eq('a Temperate Storage Facility is storage', pinRole(2562), 'storage');
eq('a Temperate Extractor Control Unit is an extractor', pinRole(3068), 'extractor');
eq('a Standard Barren Command Center is a command centre', pinRole(2130), 'command');
eq('a random non-PI type is not classified', pinRole(34), null);
ok('launchpads count toward capacity', STORAGE_ROLES.has('launchpad'));
ok('storage facilities count toward capacity', STORAGE_ROLES.has('storage'));
ok('command centres count toward capacity', STORAGE_ROLES.has('command'));
ok('EXTRACTORS DO NOT — their buffer is not planet storage', !STORAGE_ROLES.has('extractor'));
ok('nor do factories', !STORAGE_ROLES.has('factory'));

// ===== B. MEASURED FILL RATE ============================================
const KEY = 'pi-test';
const HOUR = 3_600_000;
const setSnaps = (list) => disk.set('etc-pi-snapshots-v1', JSON.stringify({ [KEY]: list }));

// a rate cannot be invented from one observation
setSnaps([{ t: Date.now(), usedM3: 100, capM3: 10000, value: 0 }]);
delete require.cache[require.resolve('./pi/pi.js')];
let P = require('./pi/pi.js');
eq('one observation gives NO rate — "measuring" is the honest answer',
  P.fillRatePerHour(KEY), null);

// two observations, four hours apart, +400 m3 => 100 m3/h
const now = Date.now();
setSnaps([
  { t: now - 4 * HOUR, usedM3: 100, capM3: 10000, value: 0 },
  { t: now, usedM3: 500, capM3: 10000, value: 0 },
]);
delete require.cache[require.resolve('./pi/pi.js')];
P = require('./pi/pi.js');
near('two observations 4h apart, +400 m3 -> 100 m3/h', P.fillRatePerHour(KEY).m3PerHour, 100, 0.01);

// A COLLECTION (a drop) must reset the baseline, not produce a negative rate
setSnaps([
  { t: now - 8 * HOUR, usedM3: 100, capM3: 10000, value: 0 },
  { t: now - 6 * HOUR, usedM3: 900, capM3: 10000, value: 0 },
  { t: now - 4 * HOUR, usedM3: 50, capM3: 10000, value: 0 },   // <- collected
  { t: now - 2 * HOUR, usedM3: 250, capM3: 10000, value: 0 },
  { t: now, usedM3: 450, capM3: 10000, value: 0 },
]);
delete require.cache[require.resolve('./pi/pi.js')];
P = require('./pi/pi.js');
const r = P.fillRatePerHour(KEY);
near('after a collection the rate measures only since the drop (100 m3/h)', r.m3PerHour, 100, 0.01);
near('...over 4 hours, not 8', r.spanHours, 4, 0.01);
ok('the rate is never negative', r.m3PerHour >= 0);

// a flat planet reads as zero, not as unknown
setSnaps([
  { t: now - 4 * HOUR, usedM3: 500, capM3: 10000, value: 0 },
  { t: now, usedM3: 500, capM3: 10000, value: 0 },
]);
delete require.cache[require.resolve('./pi/pi.js')];
P = require('./pi/pi.js');
eq('a planet producing nothing reads 0 m3/h, not null', P.fillRatePerHour(KEY).m3PerHour, 0);

// ===== C. PLANET STATE AND RANKING ======================================
disk.clear();
delete require.cache[require.resolve('./pi/pi.js')];
P = require('./pi/pi.js');

const CHAR = { characterId: 1, characterName: 'Tester' };
const ROW = { planet_id: 40000001, solar_system_id: 30000142, planet_type: 'temperate', num_pins: 5, upgrade_level: 5, last_update: '' };
const LAUNCHPAD = 2256, EXTRACTOR = 3068, FACTORY = 2473;
const iso = (ms) => new Date(ms).toISOString();
const mark = () => 1000;   // 1000 ISK per unit, whatever it is

// capacity comes from ESI at runtime; seed the cache the same way it would be
disk.set('etc-pi-capacity-v1', JSON.stringify({ [LAUNCHPAD]: 10000 }));
delete require.cache[require.resolve('./pi/pi.js')];
P = require('./pi/pi.js');

const planet = (pins) => P.buildPlanetState(CHAR, ROW, { pins, links: [], routes: [] }, mark, now);

// a FULL planet is the worst thing that can happen and must rank first
// (hand-computed: volume(44) = 0.75 m3, probed from the shipped typedb, so
// 13,334 units = 10,000.5 m3 against the 10,000 m3 launchpad = full)
let st = planet([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [{ type_id: 44, amount: 13334 }] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now + 3 * 24 * HOUR) },
]);
eq('a full planet is flagged as full', st.problem, 'storage-full');
eq('...and ranks first of everything', st.rank, 0);
ok('...and says output is being discarded', /discard/i.test(st.advice), st.advice);

// an expired extractor: producing nothing at all
st = planet([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now - HOUR) },
]);
eq('an expired extractor is flagged', st.problem, 'extractor-expired');
eq('...ranking below a full planet', st.rank, 1);
eq('...and counted', st.expiredExtractors, 1);

// an extractor about to expire is a PLAN, not an emergency
st = planet([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now + 6 * HOUR) },
]);
eq('an extractor expiring within the window is flagged', st.problem, 'extractor-expiring');
ok('...and ranks below the things already losing output', st.rank > 1);

// v0.179: the warning scales to the PROGRAM — warn in its last quarter, so a
// 2-day program warns in its final ~12h instead of spending half its life in
// "ending soon" (hand-computed: 48h x 0.25 = 12h; the flat 24h cap still
// applies to week-long programs, and with no install_time it is all we have)
st = planet([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 2, type_id: EXTRACTOR, install_time: iso(now - 34 * HOUR), expiry_time: iso(now + 14 * HOUR) },
]);
eq('a 48h program with 14h left is NOT "ending soon" (quarter = 12h)', st.problem, 'ok');
st = planet([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 2, type_id: EXTRACTOR, install_time: iso(now - 37 * HOUR), expiry_time: iso(now + 11 * HOUR) },
]);
eq('...but with 11h left it IS', st.problem, 'extractor-expiring');

// a healthy planet says so
st = planet([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [{ type_id: 44, amount: 100 }] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now + 5 * 24 * HOUR) },
]);
eq('a healthy planet is ok', st.problem, 'ok');
eq('...and ranks last', st.rank, 9);

// ---- capacity and value ------------------------------------------------
st = planet([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [{ type_id: 44, amount: 500 }] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now + 5 * 24 * HOUR) },
]);
eq('capacity comes from the storage pins only', st.capM3, 10000);
eq('value is quantity x mark price', st.value, 500 * 1000);
ok('contents are listed biggest-value first', st.contents.length === 1 && st.contents[0].amount === 500);

// TWO launchpads = twice the capacity; an extractor adds none
st = planet([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 2, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 3, type_id: EXTRACTOR, expiry_time: iso(now + 5 * 24 * HOUR), contents: [{ type_id: 44, amount: 10 }] },
]);
eq('two launchpads double the capacity', st.capM3, 20000);
ok('an extractor buffer adds no capacity', st.capM3 === 20000);
ok('...but its contents still count as value on the planet', st.value > 0);

// ---- factory starvation (v0.179: stock-aware) --------------------------
// ESI's colony state only advances when the OWNER views the colony in game,
// so last_cycle_start goes stale on perfectly healthy planets — the chronic
// false "factory starved". A stale cycle alone proves nothing; starvation =
// stale cycle AND zero of that factory's schematic inputs anywhere on the
// planet, judged against the SDE schematic table.
const SCHEM = new Map([[77, {
  id: 77, name: 'Test Schematic', cycleTime: 3600,
  inputs: [{ typeId: 2393, qty: 10 }], output: null,
}]]);
const planetS = (pins) => P.buildPlanetState(CHAR, ROW, { pins, links: [], routes: [] }, mark, now, SCHEM);

// stale cycle + ZERO input stock anywhere -> genuinely starved
st = planetS([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now + 5 * 24 * HOUR) },
  { pin_id: 3, type_id: FACTORY, contents: [], schematic_id: 77, last_cycle_start: iso(now - 20 * HOUR) },
]);
eq('a stale cycle with zero input stock IS starved', st.problem, 'factory-idle');
eq('...and counted', st.idleFactories, 1);

// stale cycle but the planet HOLDS inputs (sitting in the launchpad) — the
// stale clock is ESI laziness, not starvation
st = planetS([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [{ type_id: 2393, amount: 100 }] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now + 5 * 24 * HOUR) },
  { pin_id: 3, type_id: FACTORY, contents: [], schematic_id: 77, last_cycle_start: iso(now - 20 * HOUR) },
]);
ok('a stale cycle WITH input stock on the planet is NOT starved',
  st.problem !== 'factory-idle', st.problem);

// THE 36-FALSE-ALARM BUG: a WORKING factory looks empty. It consumes its
// inputs the moment a cycle starts, so contents:[] is the NORMAL state — and
// treating that as starvation flagged every planet the user owned at once.
st = planetS([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now + 5 * 24 * HOUR) },
  { pin_id: 3, type_id: FACTORY, contents: [], schematic_id: 77, last_cycle_start: iso(now - 20 * 60_000) },
]);
ok('a factory mid-cycle (empty, but started 20 min ago) is NOT starved',
  st.problem !== 'factory-idle', st.problem);

// UNKNOWN IS NOT BROKEN, twice over: with no schematic table loaded we
// cannot judge stock, and with no last_cycle_start we cannot judge the
// clock — either way say nothing rather than inventing an alarm
st = planet([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now + 5 * 24 * HOUR) },
  { pin_id: 3, type_id: FACTORY, contents: [], schematic_id: 77, last_cycle_start: iso(now - 20 * HOUR) },
]);
ok('without the schematic table starvation is not judged',
  st.problem !== 'factory-idle', st.problem);
st = planetS([
  { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
  { pin_id: 2, type_id: EXTRACTOR, expiry_time: iso(now + 5 * 24 * HOUR) },
  { pin_id: 3, type_id: FACTORY, contents: [], schematic_id: 77 },
]);
ok('a factory with NO cycle timestamp is not claimed to be starved',
  st.problem !== 'factory-idle', st.problem);

// ---- head-vs-factory balance (v0.180) ----------------------------------
// an extractor with a real program (details + install stamp) supplying far
// less than the factories burn -> the planet asks for a rebalance
const EXPROG = {
  pin_id: 2, type_id: EXTRACTOR,
  install_time: iso(now - 2 * 24 * HOUR), expiry_time: iso(now + 5 * 24 * HOUR),
  extractor_details: { product_type_id: 2393, qty_per_cycle: 100, cycle_time: 3600 },
};
const HUNGRY = new Map([[88, {
  id: 88, name: 'Hungry', cycleTime: 3600,
  inputs: [{ typeId: 2393, qty: 1_000_000 }], output: { typeId: 9, qty: 1 },
}]]);
st = P.buildPlanetState(CHAR, ROW, {
  pins: [
    { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
    EXPROG,
    { pin_id: 3, type_id: FACTORY, contents: [], schematic_id: 88 },
  ], links: [], routes: [],
}, mark, now, HUNGRY);
eq('factories burning far beyond the pull -> unbalanced', st.problem, 'unbalanced');
eq('...at rank 6 (a next-trip signal, below live losses)', st.rank, 6);
ok('...with the numbers in the advice', /Shift heads|drop a factory/.test(st.advice), st.advice);
ok('...and the pull is the FORMULA average, above the old nominal 100/h',
  st.extractorPullPerHour > 100 * 1.15, String(st.extractorPullPerHour));

// a schematic tuned to eat exactly the formula-average is judged balanced
const YV = require('./pi/piYield.js');
const avgHr = YV.programAvgPerHour(100, 3600, 5 * 24 * 3600 + 2 * 24 * 3600);
st = P.buildPlanetState(CHAR, ROW, {
  pins: [
    { pin_id: 1, type_id: LAUNCHPAD, contents: [] },
    EXPROG,
    { pin_id: 3, type_id: FACTORY, contents: [], schematic_id: 88 },
  ], links: [], routes: [],
}, mark, now, new Map([[88, {
  id: 88, name: 'Tuned', cycleTime: 3600,
  inputs: [{ typeId: 2393, qty: avgHr }], output: { typeId: 9, qty: 1 },
}]]));
eq('a planet eating exactly what it pulls is ok', st.problem, 'ok');

// ===== D. ALERT DE-DUPLICATION ==========================================
// a collector that runs every 11 minutes must not send the same warning
// 130 times a day — that is how people learn to ignore the one that matters
disk.delete('etc-pi-alerted-v1');
delete require.cache[require.resolve('./pi/pi.js')];
P = require('./pi/pi.js');

const full = { charId: 1, planetId: 1, problem: 'storage-full', value: 1, characterName: 'x', planetName: 'p', systemName: 's', advice: 'a', hoursToFull: null };
const okPlanet = { ...full, planetId: 2, problem: 'ok' };

eq('a new problem is alerted', P.piAlertsToSend([full, okPlanet], now).length, 1);
P.markPiAlerted([full, okPlanet], now);
eq('the SAME problem is not alerted again', P.piAlertsToSend([full, okPlanet], now + 60_000).length, 0);
eq('a healthy planet is never alerted', P.piAlertsToSend([okPlanet], now).length, 0);
eq('an unbalanced planet is a next-trip note, never a phone buzz',
  P.piAlertsToSend([{ ...full, planetId: 9, problem: 'unbalanced' }], now).length, 0);

// a DIFFERENT problem on the same planet is worth saying
const expired = { ...full, problem: 'extractor-expired' };
eq('a different problem on the same planet IS alerted',
  P.piAlertsToSend([expired], now + 60_000).length, 1);

// still broken 13 hours later: remind
P.markPiAlerted([full], now);
eq('an unresolved problem is re-raised after 12h',
  P.piAlertsToSend([full], now + 13 * HOUR).length, 1);

console.log(`${NL}${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
