// CHAIN DASHBOARD MATH (v0.200.4) — hand-computed layout and aggregates.
const V = require('./sim/lib/chainViz.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };

const rows = [
  { system: 'Homebase', cls: 'C2', group: 'Ore', hops: 0, isk: 10, ageH: 0.5 },
  { system: 'A', cls: 'C3', group: 'Combat', hops: 1, isk: 100, ageH: 2 },
  { system: 'A', cls: 'C3', group: 'Data', hops: 1, isk: 50, ageH: 4 },
  { system: 'B', cls: 'C4', group: 'Combat', hops: 1, isk: null, ageH: 7 },
  { system: 'C', cls: 'C5', group: 'Gas', hops: 2, isk: 30, ageH: 13 },
  { system: 'X', cls: 'C1', group: 'Relic', hops: null, isk: 5, ageH: 30 },
  { system: 'Y', cls: '', group: 'Combat', hops: 3, isk: 7, ageH: null },
];

// ISK by hop
const bars = V.iskByHop(rows);
check('H1 one bar per hop 0..3, rows with no distance left out', bars.length === 4 && bars.map((b) => b.hop).join() === '0,1,2,3', JSON.stringify(bars.map((b) => b.hop)));
check('H2 hop 1 = 150 ISK over 3 rows, split Combat 100 / Data 50', bars[1].total === 150 && bars[1].count === 3 && bars[1].byGroup.Combat === 100 && bars[1].byGroup.Data === 50, JSON.stringify(bars[1]));
check('H3 hop 0 = 10, hop 2 = 30, hop 3 = 7', bars[0].total === 10 && bars[2].total === 30 && bars[3].total === 7);
check('H4 no rows at all → no bars', V.iskByHop([]).length === 0);

// freshness
const ages = V.ageBuckets(rows);
check('F1 seven bands in order', ages.length === 7 && ages[0].label === '< 1 h' && ages[6].label === 'no age');
check('F2 counts: <1h 1, 1–3h 1, 3–6h 1, 6–12h 1, 12–24h 1, >24h 1, no age 1', ages.map((a) => a.count).join() === '1,1,1,1,1,1,1', JSON.stringify(ages.map((a) => a.count)));
check('F3 ISK follows the rows (>24h band = 5, no-age band = 7, unvalued counts 0)', ages[5].isk === 5 && ages[6].isk === 7 && ages[3].isk === 0);

// layout: Homebase → A, Homebase → B, A → C, C → Y; X unreachable
const hops = new Map([['Homebase', 0], ['A', 1], ['B', 1], ['C', 2], ['Y', 3]]);
const edges = [['Homebase', 'A'], ['Homebase', 'B'], ['A', 'C'], ['C', 'Y'], ['A', 'Homebase'], ['X', 'Q']];
const L = V.layoutChain([{ system: 'Homebase', cls: 'C2' }, { system: 'A', cls: 'C3' }, { system: 'B', cls: 'C4' }, { system: 'C', cls: 'C5' }, { system: 'Y', cls: '' }], edges, hops, rows, { colW: 100, rowH: 50 });
const n = (s) => L.nodes.find((x) => x.system === s);
check('L1 five linked nodes laid out; X (drawn on the map, no link) is not among them', L.nodes.filter((x) => x.hop >= 0).length === 5 && !n('X'));
// v0.201.8: a system in the drawn list with no distance sits in a detached last column, hop −1
const LU = V.layoutChain([{ system: 'Homebase', cls: 'C2' }, { system: 'A', cls: 'C3' }, { system: 'Lost', cls: 'C4' }, { system: 'Alone', cls: 'HS' }], [['Homebase', 'A'], ['Lost', 'Alone']], new Map([['Homebase', 0], ['A', 1]]), [], { colW: 100, rowH: 50 });
const u = (s) => LU.nodes.find((x) => x.system === s);
check('L10 unlinked systems listed, placed in one extra column after the last hop, hop −1, sorted by name', JSON.stringify(LU.unlinked) === '["Alone","Lost"]' && u('Alone').hop === -1 && u('Lost').hop === -1 && u('Alone').x === 250 && u('Lost').x === 250 && u('Alone').y === 25 && u('Lost').y === 75, JSON.stringify(LU.nodes.map((x) => [x.system, x.hop, x.x, x.y])));
check('L11 the canvas grows by that column; a link between two unlinked systems is still drawn', LU.width === 300 && LU.edges.some((e) => (e.a === 'Lost' && e.b === 'Alone') || (e.a === 'Alone' && e.b === 'Lost')), JSON.stringify([LU.width, LU.edges]));
check('L12 no unlinked systems → no extra column, empty list', L.unlinked.length === 0 && L.width === 400);
check('L2 columns by hop: origin x=50, hop1 x=150, hop2 x=250, hop3 x=350', n('Homebase').x === 50 && n('A').x === 150 && n('B').x === 150 && n('C').x === 250 && n('Y').x === 350, JSON.stringify(L.nodes.map((x) => [x.system, x.x])));
check('L3 within hop 1, A above B (same parent, by name); heights 25 and 75', n('A').y === 25 && n('B').y === 75, JSON.stringify([n('A').y, n('B').y]));
check('L4 node ISK and counts: A 150 over 2 sites, B 0 with 1 unvalued', n('A').isk === 150 && n('A').count === 2 && n('B').isk === 0 && n('B').count === 1 && n('B').unvalued === 1, JSON.stringify([n('A'), n('B')]));
check('L5 origin flagged, class carried (Y has none)', n('Homebase').isOrigin && !n('A').isOrigin && n('C').cls === 'C5' && n('Y').cls === '');
const LT = V.layoutChain([{ system: 'Homebase', cls: 'C2', tag: '🐊' }, { system: 'A', cls: 'C3', tag: 'C' }], [['Homebase', 'A']], new Map([['Homebase', 0], ['A', 1]]), [], {});
check('L9 tags carried onto the cards, empty when the system has none', LT.nodes.find((x) => x.system === 'Homebase').tag === '🐊' && LT.nodes.find((x) => x.system === 'A').tag === 'C' && n('A').tag === '');
check('L6 edges deduplicated (A–Homebase twice) and off-layout pairs dropped: 4 edges', L.edges.length === 4, JSON.stringify(L.edges));
check('L7 canvas: 4 columns × 100 wide, tallest column 2 × 50 high, maxHop 3', L.width === 400 && L.height === 100 && L.maxHop === 3, JSON.stringify([L.width, L.height, L.maxHop]));
// ordering under parents: a hop-2 child of B should sit below a hop-2 child of A
const hops2 = new Map([['H', 0], ['A', 1], ['B', 1], ['ca', 2], ['cb', 2]]);
const L2 = V.layoutChain([], [['H', 'A'], ['H', 'B'], ['B', 'cb'], ['A', 'ca']], hops2, [], { colW: 100, rowH: 10 });
const m = (s) => L2.nodes.find((x) => x.system === s);
check('L8 children follow their parents\' order (ca under A above cb under B)', m('ca').y < m('cb').y && m('A').y < m('B').y, JSON.stringify(L2.nodes.map((x) => [x.system, x.y])));

// colours
// colours — Gavin's scheme (v0.200.9)
const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114; };
const hue = (hex) => { const n = parseInt(hex.slice(1), 16); const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (!d) return 0; let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; return h < 0 ? h + 360 : h; };
const c = (k) => V.classColor(k);
check('C1 C1–C3 are blues that brighten: same blue hue, C1 lightest, C3 most saturated', [c('C1'), c('C2'), c('C3')].every((h) => hue(h) > 195 && hue(h) < 225) && lum(c('C1')) > lum(c('C2')) && lum(c('C2')) > lum(c('C3')), JSON.stringify([c('C1'), c('C2'), c('C3')]));
check('C2 C4 is a yellowish orange', hue(c('C4')) > 25 && hue(c('C4')) < 50, c('C4'));
check('C3 C5 and C6 are red, the same red', c('C5') === c('C6') && hue(c('C5')) < 8, c('C5'));
check('C4 high-sec green, low-sec a yellow leaning orange, null-sec purple-maroon', hue(c('HS')) > 120 && hue(c('HS')) < 160 && hue(c('LS')) > 36 && hue(c('LS')) < 50 && lum(c('LS')) > 160 && hue(c('NS')) > 280 && hue(c('NS')) < 330 && lum(c('NS')) < 110, JSON.stringify([c('HS'), c('LS'), c('NS')]));
check('C6 low-sec is more orange than C4 is yellow? no — C4 stays the more orange of the two so they read apart', hue(c('C4')) < hue(c('LS')), JSON.stringify([c('C4'), c('LS')]));
check('C5 unknown grey; the legend order is C1…C6, HS, LS, NS', c('') === '#9aa0aa' && V.CLASS_ORDER.join() === 'C1,C2,C3,C4,C5,C6,HS,LS,NS');

// routes (v0.201.1)
const RE = [['Homebase', 'A'], ['Homebase', 'B'], ['A', 'C'], ['C', 'Y'], ['B', 'Y'], ['X', 'Q']];
check('R1 shortest route, both ways, endpoints included', JSON.stringify(V.routeBetween('Homebase', 'Y', RE)) === JSON.stringify(['Homebase', 'A', 'C', 'Y']) || JSON.stringify(V.routeBetween('Homebase', 'Y', RE)) === JSON.stringify(['Homebase', 'B', 'Y']), JSON.stringify(V.routeBetween('Homebase', 'Y', RE)));
check('R2 the SHORTEST wins (via B is 2 jumps, via A is 3)', V.routeBetween('Homebase', 'Y', RE).length === 3 && V.routeBetween('Y', 'Homebase', RE)[0] === 'Y');
check('R3 same system → a one-element route; unknown or disconnected → null', JSON.stringify(V.routeBetween('A', 'A', RE)) === '["A"]' && V.routeBetween('A', 'X', RE) === null && V.routeBetween('A', 'nope', RE) === null && V.routeBetween('', 'A', RE) === null);
// effects
check('E1 any spelling of an effect normalises; unknown → empty', V.normEffect('Wolf-Rayet Star') === 'Wolf-Rayet' && V.normEffect('wolfRayet') === 'Wolf-Rayet' && V.normEffect('Black Hole') === 'Black Hole' && V.normEffect('cataclysmicVariable') === 'Cataclysmic Variable' && V.normEffect('Red Giant') === 'Red Giant' && V.normEffect(null) === '' && V.normEffect('Nebula') === '');
const LE = V.layoutChain([{ system: 'Homebase', cls: 'C2', effect: 'Wolf-Rayet' }, { system: 'A', cls: 'C3' }], [['Homebase', 'A']], new Map([['Homebase', 0], ['A', 1]]), [], {});
check('E2 the effect rides on the card; none when the system has none', LE.nodes.find((x) => x.system === 'Homebase').effect === 'Wolf-Rayet' && LE.nodes.find((x) => x.system === 'A').effect === '');
const W = require('../src/data/whSystems.json');
const effs = Object.values(W).map((s) => s.effect).filter(Boolean);
check('E3 CCP data: ~2,600 wormhole systems with a class, six effect names only, a good share with an effect', Object.keys(W).length > 2500 && Object.values(W).every((s) => /^(C[1-6]|C13|Drifter|Thera|class\d+)$/.test(s.cls)) && effs.every((e) => V.EFFECTS.includes(e)) && effs.length > 800, JSON.stringify([Object.keys(W).length, effs.length, [...new Set(effs)]]));
const shat = Object.entries(W).filter(([, s]) => s.shattered);
check('E4 shattered systems flagged from CCP data: 108, every C13 among them, C13 has its own colour', shat.length === 108 && Object.entries(W).filter(([, s]) => s.cls === 'C13').every(([, s]) => s.shattered) && /^#[0-9a-f]{6}$/i.test(V.classColor('C13')) && V.classColor('C13') !== V.classColor(''), JSON.stringify([shat.length, shat.slice(0, 3)]));
const LS2 = V.layoutChain([{ system: 'H', cls: 'C2' }, { system: 'S', cls: 'C13', shattered: true }], [['H', 'S']], new Map([['H', 0], ['S', 1]]), [], {});
check('E5 the shattered flag rides on the card', LS2.nodes.find((x) => x.system === 'S').shattered === true && LS2.nodes.find((x) => x.system === 'H').shattered === false);

// effect modifiers from the beacons (v0.201.2) — hand-checked against the export's dogma
const wr6 = V.effectMods('Wolf-Rayet', 'C6');
const line = (mods, label) => mods.find((m) => m.label === label)?.value;
check('M1 Wolf-Rayet C6: armor HP +100%, signature radius −50%, shield resistances +50%, small weapon damage +200%', line(wr6, 'Armor HP') === '+100%' && line(wr6, 'Signature radius') === '−50%' && line(wr6, 'Shield resistances') === '+50%' && line(wr6, 'Small weapon damage') === '+200%', JSON.stringify(wr6));
const wr1 = V.effectMods('Wolf-Rayet', 'C1');
check('M2 Wolf-Rayet C1 is the mild end: armor HP +30%, sig −15%, resists +15%, small weapons +60%', line(wr1, 'Armor HP') === '+30%' && line(wr1, 'Signature radius') === '−15%' && line(wr1, 'Shield resistances') === '+15%' && line(wr1, 'Small weapon damage') === '+60%', JSON.stringify(wr1));
const p1 = V.effectMods('Pulsar', 'C1');
check('M3 Pulsar C1: shield HP +30%, sig +30%, armor resistances +15%, cap recharge time −15%, neut strength +30%', line(p1, 'Shield HP') === '+30%' && line(p1, 'Signature radius') === '+30%' && line(p1, 'Armor resistances') === '+15%' && line(p1, 'Capacitor recharge time') === '−15%' && line(p1, 'Neut / nos strength') === '+30%', JSON.stringify(p1));
const bh3 = V.effectMods('Black Hole', 'C3');
check('M4 Black Hole C3: velocity +58%, targeting range +58%, inertia +29%, web strength −29%', line(bh3, 'Ship velocity') === '+58%' && line(bh3, 'Targeting range') === '+58%' && line(bh3, 'Inertia (align time)') === '+29%' && line(bh3, 'Stasis web strength') === '−29%', JSON.stringify(bh3));
const cv4 = V.effectMods('Cataclysmic Variable', 'C4');
check('M5 Cataclysmic C4: local reps −36%, remote reps +72%, cap capacity +72%, recharge time +36%, cap transfer −36%', line(cv4, 'Local armor repair') === '−36%' && line(cv4, 'Remote shield boost') === '+72%' && line(cv4, 'Capacitor capacity') === '+72%' && line(cv4, 'Capacitor recharge time') === '+36%' && line(cv4, 'Remote capacitor transfer') === '−36%', JSON.stringify(cv4));
check('M6 all six effects × six classes present; every list has 4–8 lines; a misspelling still resolves; unknown → []', V.EFFECTS.every((e) => ['C1', 'C2', 'C3', 'C4', 'C5', 'C6'].every((c) => { const m = V.effectMods(e, c); return m.length >= 4 && m.length <= 8; })) && V.effectMods('wolfRayet', 'C2').length > 0 && V.effectMods('Nebula', 'C2').length === 0 && V.effectMods('Pulsar', 'HS').length === 0);
check('M7 the text form is one line per modifier', V.effectModsText('Magnetar', 'C6').split('\n').length === 5 && /Weapon damage \+100%/.test(V.effectModsText('Magnetar', 'C6')));
check('M8 abbreviations for the card box, every effect coloured, unknown → empty / fallback', V.effectAbbrev('Wolf-Rayet') === 'WR' && V.effectAbbrev('Cataclysmic Variable') === 'CATA' && V.effectAbbrev('Black Hole') === 'BH' && V.effectAbbrev('pulsar') === 'PULS' && V.effectAbbrev('Nebula') === '' && V.EFFECTS.every((e) => /^#[0-9a-f]{6}$/i.test(V.effectColor(e))) && V.effectColor('Nebula') === '#e0a13a');
// the map's own palette (v0.201.4): read from its badges on 2026-09-15
check('M9 defaults are the map\'s own palette object, all six: Magnetar #e06fdf, Red Giant #d9534f, Pulsar #428bca, Wolf-Rayet #e28a0d, Cataclysmic #ffffbb, Black Hole #000000', V.effectColor('Magnetar') === '#e06fdf' && V.effectColor('Red Giant') === '#d9534f' && V.effectColor('Pulsar') === '#428bca' && V.effectColor('Wolf-Rayet') === '#e28a0d' && V.effectColor('Cataclysmic Variable') === '#ffffbb' && V.effectColor('Black Hole') === '#000000');
const pal = V.paletteFromProbe({ magnetar: { bg: 'rgb(224, 111, 223)' }, pulsar: { bg: 'rgb(30, 140, 255)' }, wolf: { bg: 'rgba(0, 0, 0, 0)' }, nebula: { bg: 'rgb(1, 2, 3)' }, blackhole: { bg: '' } });
check('M10 a live probe becomes a palette: real backgrounds kept, transparent / empty / unknown dropped, and it overrides the defaults', JSON.stringify(pal) === JSON.stringify({ Magnetar: 'rgb(224, 111, 223)', Pulsar: 'rgb(30, 140, 255)' }) && V.effectColor('Pulsar', pal) === 'rgb(30, 140, 255)' && V.effectColor('Red Giant', pal) === '#d9534f', JSON.stringify(pal));
check('M11 dark detection for text contrast: black and rgb(0,0,0) dark; pale yellow, magenta and the red not', V.isDarkColor('#000000') && V.isDarkColor('rgb(0, 0, 0)') && V.isDarkColor('#1a1a2e') && !V.isDarkColor('#ffffbb') && !V.isDarkColor('rgb(224, 111, 223)') && !V.isDarkColor('#d9534f') && !V.isDarkColor('nonsense'));

console.log(`chainViz.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
