// FAVORITES + SAVED VIEWS (v0.206.0) — the pinned tabs, the rule that a chain
// view saves INTENT (the class of the branch) and not today's system, and the
// bus that hands a view to a tab that may not be mounted yet.
const F = require('./sim/lib/favorites.js');
const V = require('./sim/lib/chainView.js');
const B = require('./sim/lib/viewBus.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };
const ids = (s) => s.list.map((f) => f.id).join(',');

// ---- A: the catalogue
check('A1 every destination id is "module:tab", unique, and resolves', F.DESTINATIONS.every((d) => d.id === `${d.module}:${d.tab}` && F.destOf(d.id) === d) && new Set(F.DESTINATIONS.map((d) => d.id)).size === F.DESTINATIONS.length);
check('A2 the owner\'s five are all favoritable', ['aperture:map', 'aperture:summary', 'theft:skyhooks', 'battle:reports', 'battle:live'].every((id) => !!F.destOf(id)) && F.destId('battle', 'live') === 'battle:live');

// ---- P: pinning
let s = F.EMPTY_FAVORITES;
s = F.togglePinned(s, 'aperture:summary'); s = F.togglePinned(s, 'theft:skyhooks'); s = F.togglePinned(s, 'battle:reports');
check('P1 ☆ pins the tab: three pinned, in the order pinned, ids "dest#1"', ids(s) === 'aperture:summary#1,theft:skyhooks#1,battle:reports#1' && F.isPinned(s, 'theft:skyhooks'));
check('P2 ☆ again unpins it; pinning an unknown tab changes nothing', ids(F.togglePinned(s, 'theft:skyhooks')) === 'aperture:summary#1,battle:reports#1' && F.addFavorite(s, 'nope:nothing') === s);
check('P3 a plain tab is never pinned twice', F.addFavorite(s, 'aperture:summary') === s);
const view = { kind: 'chain-summary', state: { rocks: ['Gneiss'] }, summary: 'Gneiss · C3 branch' };
const withView = F.addFavorite(s, 'aperture:summary', view);
check('P4 …but a SAVED VIEW of a pinned tab is its own favorite (#2), and does not count as "pinned"', ids(withView).endsWith('aperture:summary#2') && withView.list.length === 4 && F.isPinned(F.removeFavorite(withView, 'aperture:summary#1'), 'aperture:summary') === false);
check('P5 the chip: the tab\'s label, "label · view" for a saved view, the player\'s own name when he gave one', F.favLabel(s.list[1]) === 'Skyhooks' && F.favLabel(withView.list[3]) === 'Σ Summary · Gneiss · C3 branch' && F.favLabel(F.renameFavorite(withView, 'aperture:summary#2', '  Gneiss run  ').list[3]) === 'Gneiss run');
check('P6 a name is cut to 28 characters', F.renameFavorite(s, 'theft:skyhooks#1', 'x'.repeat(60)).list[1].name.length === 28);
let full = F.EMPTY_FAVORITES; for (const d of F.DESTINATIONS.slice(0, 14)) full = F.addFavorite(full, d.id);
check('P7 the strip holds 12: the 13th and 14th are refused', full.list.length === 12 && F.MAX_FAVORITES === 12);

// ---- M: dragging
const m = (id, before) => ids(F.moveFavorite(s, id, before));
check('M1 drag the last chip onto the first → it goes before it', m('battle:reports#1', 'aperture:summary#1') === 'battle:reports#1,aperture:summary#1,theft:skyhooks#1');
check('M2 drag the first chip past the end', m('aperture:summary#1', null) === 'theft:skyhooks#1,battle:reports#1,aperture:summary#1');
check('M3 onto itself, an unknown chip, or an unknown target: nothing moves', F.moveFavorite(s, 'theft:skyhooks#1', 'theft:skyhooks#1') === s && F.moveFavorite(s, 'x', null) === s && F.moveFavorite(s, 'theft:skyhooks#1', 'x') === s);

// ---- S: what comes back from disk
const dirty = { openFirstOnLaunch: 'yes', list: [{ id: 'a', dest: 'theft:skyhooks', name: 5 }, { id: 'a', dest: 'battle:live', name: 'Logs' }, { dest: 'gone:tab' }, null, { id: 'b', dest: 'theft:skyhooks' }, { id: 'c', dest: 'aperture:summary', view: { kind: 'chain-summary', state: {}, summary: 7 } }] };
const clean = F.sanitizeFavorites(dirty);
check('S1 unknown tabs and junk dropped, a duplicate plain pin dropped, a clashing id renumbered, a view kept with a string summary', ids(clean) === 'a,battle:live#1,c' && clean.list[0].name === '' && clean.list[2].view.summary === '7' && clean.openFirstOnLaunch === false);
check('S2 nothing stored → empty; the launch tick survives', F.sanitizeFavorites(undefined).list.length === 0 && F.sanitizeFavorites({ list: [], openFirstOnLaunch: true }).openFirstOnLaunch === true);

// ---- V: the chain view saves INTENT, not today's systems
const clsOf = new Map([['J113143', 'C3'], ['J100956', 'C4'], ['Mifrata', 'LS'], ['Piak', 'HS'], ['Unlabelled', '']]);
check('V1 the picked branch J113143 is saved as "C3"; two picks → both classes in ladder order; a branch with no class cannot be saved', JSON.stringify(V.branchClassesOf(new Set(['J113143']), clsOf)) === '["C3"]' && JSON.stringify(V.branchClassesOf(new Set(['Piak', 'J100956', 'Unlabelled']), clsOf)) === '["C4","HS"]');
// tomorrow the chain has rerolled: home now has J222222 (C3), J333333 (C3) and Jita (HS); no C4
const tomorrow = [{ first: 'J222222', systems: [] }, { first: 'J333333', systems: [] }, { first: 'Jita', systems: [] }];
const clsTomorrow = new Map([['J222222', 'C3'], ['J333333', 'C3'], ['Jita', 'HS']]);
const r1 = V.resolveBranchClasses(['C3'], tomorrow, clsTomorrow);
check('V2 "C3" re-applied tomorrow picks EVERY C3 off home — both new systems', [...r1.picked].sort().join(',') === 'J222222,J333333' && r1.missing.length === 0);
const r2 = V.resolveBranchClasses(['C4', 'HS'], tomorrow, clsTomorrow);
check('V3 a saved class with no branch today is reported, the others still apply; all missing → nothing picked', [...r2.picked].join(',') === 'Jita' && r2.missing.join(',') === 'C4' && V.resolveBranchClasses(['C6'], tomorrow, clsTomorrow).picked.size === 0);
const gneiss = V.sanitizeChainView({ origin: 'home', maxHops: null, classes: [], groups: ['Ore'], maxAgeH: null, rocks: ['Gneiss'], linkedOnly: true, branchClasses: ['C3'] });
check('V4 the owner\'s example reads "Gneiss · C3 branch" (Ore is implied by a rock)', V.describeChainView(gneiss) === 'Gneiss · C3 branch', V.describeChainView(gneiss));
check('V5 a fuller one: combat in C4/C5 within 3 jumps, under 6 h, from me', V.describeChainView(V.sanitizeChainView({ origin: 'me', maxHops: 3, classes: ['C5', 'C4'], groups: ['Combat'], maxAgeH: 6, rocks: [], linkedOnly: false, branchClasses: ['HS', 'C3'] })) === 'Combat · C3 + HS branches · in C4/C5 · ≤ 3 jumps · ≤ 6 h old · from me');
check('V6 nothing narrowed is "everything" and not worth saving; "linked only" alone is not a view', V.isPlainChainView(V.sanitizeChainView({})) && V.describeChainView(V.sanitizeChainView({ linkedOnly: true })) === 'everything' && !V.isPlainChainView(gneiss));
const junk = V.sanitizeChainView({ origin: 'mars', maxHops: -2, classes: ['C9', 'C3', 'C3'], groups: ['Wormhole', 'Gas'], maxAgeH: 'x', rocks: [3, 'Kernite', ''], branchClasses: ['C3A', 'NS'], linkedOnly: 'true' });
check('V7 a hand-edited blob cannot break the tab: bad origin, distance, classes, groups and rocks all fall away', JSON.stringify(junk) === JSON.stringify({ origin: 'home', maxHops: null, classes: ['C3'], groups: ['Gas'], maxAgeH: null, rocks: ['Kernite'], linkedOnly: false, branchClasses: ['NS'] }), JSON.stringify(junk));

// ---- B: the bus
B._resetViewBus();
const got = [];
B.requestView({ kind: 'chain-summary', state: 1, summary: 'first' });
B.requestView({ kind: 'chain-summary', state: 2, summary: 'second' });
const off = B.onViewRequest('chain-summary', (v) => got.push(v.summary));
check('X1 a view requested BEFORE the tab mounted is delivered when it listens — the newest one only', got.join(',') === 'second');
B.requestView({ kind: 'chain-summary', state: 3, summary: 'live' });
check('X2 a request while the tab is listening arrives at once, and is not kept for later', got.join(',') === 'second,live');
off();
B.requestView({ kind: 'other-tab', state: 0, summary: 'elsewhere' });
B.requestView({ kind: 'chain-summary', state: 4, summary: 'after unmount' });
const got2 = [];
B.onViewRequest('chain-summary', (v) => got2.push(v.summary));
check('X3 after the tab unmounted a request waits again; another tab\'s request is not delivered here', got.length === 2 && got2.join(',') === 'after unmount');

console.log(`favorites.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
