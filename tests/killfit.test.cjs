// KILLMAIL → FIT (v0.203.0) — which loss describes the ship you fought and
// how sure that is; killmail items → racks with charges paired; the EFT text
// the game imports. Every expectation below is worked by hand.
const K = require('./sim/lib/killFit.js');
const { parseFit } = require('./sim/lib/skillRelevance.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };
const MIN = 60_000, HOUR = 3_600_000, DAY = 86_400_000;

// ---- P: pickLoss. The window is the fight in the screenshot: 23:24, 11 m 27 s long.
const T0 = Date.parse('2026-09-18T23:24:00Z');
const T1 = T0 + 11 * MIN + 27_000;
const SNAKE = 17918, GILA = 17715;
const ctx = (over = {}) => ({ seenShipTypeId: SNAKE, sharedKillIds: new Set(), t0: T0, t1: T1, ...over });
const loss = (killId, shipTypeId, time) => ({ killId, shipTypeId, time });

check('P1 no losses → null', K.pickLoss([], ctx()) === null);
const p2 = K.pickLoss([loss(9, SNAKE, T0 + 11 * MIN)], ctx({ sharedKillIds: new Set([9]) }));
check('P2 the screenshot: the Rattlesnake died at 23:35 on a mail you are on → CONFIRMED', p2.certainty === 'confirmed' && p2.onMail && p2.inWindow && p2.sameHull && p2.gapMs === 0 && p2.lossesInWindow === 1 && p2.killId === 9, JSON.stringify(p2));
const p3 = K.pickLoss([loss(9, SNAKE, T0 + 5 * MIN)], ctx());
check('P3 died inside the window, none of your characters on the mail → still confirmed, onMail false', p3.certainty === 'confirmed' && !p3.onMail && p3.inWindow);
const p4 = K.pickLoss([loss(9, SNAKE, T1 + 20 * MIN)], ctx({ sharedKillIds: new Set([9]) }));
check('P4 a mail you are on counts as this fight even past the window edge (a narrowly scoped window)', p4.certainty === 'confirmed' && p4.onMail && p4.inWindow && p4.gapMs === 0);
const p5a = K.pickLoss([loss(9, SNAKE, T1 + 4 * MIN)], ctx());
const p5b = K.pickLoss([loss(9, SNAKE, T1 + 6 * MIN)], ctx());
check('P5 grace after the last logged event is 5 min: +4 min is inside, +6 min is a "likely" 6 min after', p5a.certainty === 'confirmed' && p5b.certainty === 'likely' && p5b.gapMs === 6 * MIN && !p5b.inWindow, JSON.stringify([p5a, p5b]));
const p6a = K.pickLoss([loss(9, SNAKE, T0 - 30_000)], ctx());
const p6b = K.pickLoss([loss(9, SNAKE, T0 - 2 * MIN)], ctx());
check('P6 grace before the window is 1 min: −30 s inside, −2 min is "likely", gap −120,000', p6a.certainty === 'confirmed' && p6b.certainty === 'likely' && p6b.gapMs === -2 * MIN);
const p7 = K.pickLoss([loss(1, SNAKE, T0 + 2 * MIN), loss(2, SNAKE, T0 + 10 * MIN)], ctx({ sharedKillIds: new Set([1]) }));
check('P7 two of the hull lost in the window: the one you are on wins over the later one; the count says 2', p7.killId === 1 && p7.lossesInWindow === 2 && p7.certainty === 'confirmed');
const p8 = K.pickLoss([loss(1, SNAKE, T0 + 2 * MIN), loss(2, SNAKE, T0 + 10 * MIN)], ctx({ sharedKillIds: new Set([1, 2]) }));
check('P8 on both mails → the last one', p8.killId === 2 && p8.lossesInWindow === 2);
const p9 = K.pickLoss([loss(1, SNAKE, T0 - 3 * DAY), loss(2, SNAKE, T1 + HOUR), loss(3, GILA, T0 + 3 * MIN)], ctx());
check('P9 no Rattlesnake lost in the window: the NEAREST Rattlesnake loss (1 h after, not 3 d before), "likely" — the Gila they lost in the window is not the ship the log named', p9.killId === 2 && p9.certainty === 'likely' && p9.gapMs === HOUR && p9.sameHull && p9.lossesInWindow === 0, JSON.stringify(p9));
const p9b = K.pickLoss([loss(1, SNAKE, T1 + 9 * DAY), loss(2, SNAKE, T0 - 2 * DAY)], ctx());
check('P9b a fight looked at later does not borrow next week\'s fit: 2 d before beats 9 d after', p9b.killId === 2 && p9b.gapMs === -2 * DAY);
// v0.203.1 — the owner's call: "if there is no fit for that hull on the character I don't want to see a different hull"
check('P10 no loss of the named hull at all → NOTHING, even with a Gila lost inside this window', K.pickLoss([loss(3, GILA, T0 + 3 * MIN), loss(4, GILA, T0 - DAY)], ctx()) === null);
check('P10b …and nothing for another hull on another day', K.pickLoss([loss(4, GILA, T0 - DAY), loss(5, GILA, T1 + 5 * DAY)], ctx()) === null);
check('P10c …not even on a mail you are on: the Gila you killed is not the Rattlesnake on screen', K.pickLoss([loss(3, GILA, T0 + 3 * MIN)], ctx({ sharedKillIds: new Set([3]) })) === null);
const p11a = K.pickLoss([loss(3, GILA, T0 + 3 * MIN)], ctx({ seenShipTypeId: 0 }));
check('P11 the log named no hull: a death in the window is confirmed for that ship (sameHull stays false); a loss on another day is nothing', p11a.certainty === 'confirmed' && !p11a.sameHull && K.pickLoss([loss(3, GILA, T0 - DAY)], ctx({ seenShipTypeId: 0 })) === null);
const p12 = K.pickLoss([loss(1, SNAKE, T0 - HOUR), loss(2, SNAKE, T1 + HOUR)], ctx());
check('P12 equally near before and after → the later one', p12.killId === 2);

// ---- F: flags
check('F1 slot and bay flags', K.flagKind(27) === 'high' && K.flagKind(34) === 'high' && K.flagKind(19) === 'mid' && K.flagKind(26) === 'mid' && K.flagKind(11) === 'low' && K.flagKind(18) === 'low' && K.flagKind(92) === 'rig' && K.flagKind(99) === 'rig' && K.flagKind(125) === 'sub' && K.flagKind(132) === 'sub' && K.flagKind(87) === 'drone' && K.flagKind(158) === 'drone' && K.flagKind(163) === 'drone' && K.flagKind(5) === 'cargo');
check('F2 fleet hangar, boosters and the rest are not part of a fit; implants have their own kind', K.flagKind(89) === 'implant' && K.flagKind(88) === 'other' && K.flagKind(155) === 'other' && K.flagKind(0) === 'other' && K.flagKind(10) === 'other' && K.flagKind(35) === 'other' && K.flagKind(133) === 'other');

// ---- K: killFit. Fake ids, real names (the round trip below needs them real).
const NAMES = {
  100: 'Rapid Heavy Missile Launcher II', 101: 'Heavy Energy Nosferatu II', 110: 'X-Large Ancillary Shield Booster',
  111: 'Multispectrum Shield Hardener II', 120: 'Drone Damage Amplifier II', 130: 'Large Warhead Rigor Catalyst II',
  140: 'Loki Core - Augmented Nuclear Reactor', 200: 'Caldari Navy Scourge Heavy Missile', 210: 'Navy Cap Booster 400',
  300: 'Wasp II', 301: 'Hornet II', 999: 'High-grade Crystal Alpha',
};
const nameOf = (id) => NAMES[id] ?? `#${id}`;
const isCharge = (id) => id === 200 || id === 210;
const it = (typeId, qty, flag) => ({ typeId, qty, flag });
// deliberately out of order, with the dropped/destroyed split a killmail makes
const ITEMS = [
  it(120, 1, 12), it(200, 400, 5), it(100, 1, 28), it(300, 2, 87), it(200, 5, 27), it(110, 1, 19),
  it(999, 1, 89), it(100, 1, 27), it(200, 4, 27), it(101, 1, 29), it(210, 9, 19), it(111, 1, 20),
  it(120, 1, 11), it(130, 1, 92), it(300, 3, 87), it(301, 1, 87), it(200, 100, 5), it(210, 18, 5), it(200, 3, 30),
];
const fit = K.killFit(ITEMS, isCharge);
check('K1 high rack in slot order; the launcher in slot 27 carries 5 + 4 = 9 missiles, slot 28 is empty-handed', fit.high.length === 3 && fit.high[0].typeId === 100 && fit.high[0].chargeTypeId === 200 && fit.high[0].chargeQty === 9 && fit.high[1].typeId === 100 && fit.high[1].chargeTypeId === undefined && fit.high[2].typeId === 101, JSON.stringify(fit.high));
check('K2 the booster holds its 9 cap charges; the hardener none', fit.mid.length === 2 && fit.mid[0].typeId === 110 && fit.mid[0].chargeTypeId === 210 && fit.mid[0].chargeQty === 9 && fit.mid[1].chargeTypeId === undefined);
check('K3 lows and rigs', fit.low.length === 2 && fit.low.every((m) => m.typeId === 120) && fit.rig.length === 1 && fit.rig[0].typeId === 130 && fit.sub.length === 0);
check('K4 drones stack across the split: 2 + 3 Wasps = 5, 1 Hornet', fit.drones.length === 2 && fit.drones[0].typeId === 300 && fit.drones[0].qty === 5 && fit.drones[1].qty === 1);
check('K5 cargo stacks: 400 + 100 missiles = 500, 18 cap boosters; the implant (flag 89) is in neither the hold nor a rack', fit.cargo.length === 2 && fit.cargo[0].qty === 500 && fit.cargo[1].qty === 18 && !fit.cargo.some((s) => s.typeId === 999) && JSON.stringify([fit.high, fit.mid, fit.low, fit.rig, fit.sub, fit.drones]).indexOf('999') < 0);
check('K6 a charge in a slot with no module (flag 30) is kept as loose, never dropped', fit.looseCharges.length === 1 && fit.looseCharges[0].typeId === 200 && fit.looseCharges[0].qty === 3);
check('K7 moduleCount = 3 + 2 + 2 + 1 + 0 = 8', K.moduleCount(fit) === 8);
const t3 = K.killFit([it(140, 1, 125), it(100, 1, 27)], isCharge);
check('K8 subsystems (flag 125) are part of the fit — the first version dropped them', t3.sub.length === 1 && t3.sub[0].typeId === 140);
const twoCharges = K.killFit([it(100, 1, 27), it(200, 9, 27), it(210, 1, 27)], isCharge);
check('K9 two charge types under one flag: the first is the load, the second stays visible as loose', twoCharges.high[0].chargeTypeId === 200 && twoCharges.looseCharges.length === 1 && twoCharges.looseCharges[0].typeId === 210);
check('K10 a zero quantity (a mail with neither dropped nor destroyed) counts as one', K.killFit([it(300, 0, 87)], isCharge).drones[0].qty === 1);
check('K11 nothing in → empty racks', K.moduleCount(K.killFit([], isCharge)) === 0);
// v0.203.2 — implants are kept apart: a pod's killmail holds nothing else
check('K12 the implant is captured as an implant, and only there', fit.implants.length === 1 && fit.implants[0].typeId === 999 && fit.implants[0].qty === 1 && K.flagKind(89) === 'implant');
const pod = K.killFit([it(999, 1, 89), it(998, 1, 89)], isCharge);
check('K13 a capsule: no modules, two implants; its EFT is the bare header — implants are never exported', K.moduleCount(pod) === 0 && pod.implants.length === 2 && K.killFitEft('Capsule', 'x', pod, nameOf) === '[Capsule, x]');

// ---- G: the fallback — corp mates' losses of the hull folded into distinct fits (v0.203.1)
const mod = (typeId, flag) => it(typeId, 1, flag);
// DOCTRINE: 3 launchers, booster + hardener, 2 DDAs, a rig = 8 modules. Charges, drones and cargo differ per loss.
const doctrine = (extra = []) => K.killFit([mod(100, 27), mod(100, 28), mod(100, 29), mod(110, 19), mod(111, 20), mod(120, 11), mod(120, 12), mod(130, 92), ...extra], isCharge);
const shuffled = K.killFit([mod(130, 92), mod(120, 12), mod(111, 19), mod(110, 20), mod(100, 29), mod(100, 27), mod(120, 11), mod(100, 28)], isCharge);
const variant = K.killFit([mod(100, 27), mod(100, 28), mod(101, 29), mod(110, 19), mod(111, 20), mod(120, 11), mod(120, 12), mod(130, 92)], isCharge);
const bare = K.killFit([mod(100, 27), mod(120, 11)], isCharge);
check('G1 fitKey ignores charges, drones and cargo: the doctrine with missiles loaded, Wasps out and a full hold is the same fit', K.fitKey(SNAKE, doctrine()) === K.fitKey(SNAKE, doctrine([it(200, 9, 27), it(300, 5, 87), it(210, 40, 5)])));
check('G2 fitKey ignores the order within a rack (booster in slot 19 or 20) but not the rack contents, nor the hull', K.fitKey(SNAKE, doctrine()) === K.fitKey(SNAKE, shuffled) && K.fitKey(SNAKE, doctrine()) !== K.fitKey(SNAKE, variant) && K.fitKey(SNAKE, doctrine()) !== K.fitKey(GILA, doctrine()));
const cand = (killId, charId, time, fit, value = 9e8) => ({ killId, charId, time, value, fit });
const win = { t0: T0, t1: T1 };
// five losses read: the doctrine lost by pilots 11, 12 and 12 again; the variant by pilot 13; a stripped hull by pilot 14
const CANDS = [cand(1, 11, T0 - 9 * DAY, doctrine()), cand(2, 12, T0 - 2 * DAY, shuffled), cand(3, 12, T1 + 20 * DAY, doctrine([it(200, 9, 27)])), cand(4, 13, T0 - HOUR, variant), cand(5, 14, T0 - DAY, bare)];
const g = K.groupFitOptions(CANDS, SNAKE, win);
check('G3 five read, the 2-module hull left out as stripped, two distinct fits', g.considered === 5 && g.bare === 1 && g.distinct === 2 && g.options.length === 2, JSON.stringify({ considered: g.considered, bare: g.bare, distinct: g.distinct }));
check('G4 the doctrine leads: 3 losses across 2 pilots; its sample is the loss NEAREST the fight (2 d before, not 9 d before or 20 d after)', g.options[0].losses === 3 && g.options[0].pilots === 2 && g.options[0].sample.killId === 2 && g.options[0].gapMs === -2 * DAY, JSON.stringify(g.options[0]));
check('G5 the variant follows: one loss, one pilot, 1 h before', g.options[1].losses === 1 && g.options[1].pilots === 1 && g.options[1].sample.killId === 4 && g.options[1].gapMs === -HOUR);
const tie = K.groupFitOptions([cand(1, 11, T0 - 5 * DAY, doctrine()), cand(4, 13, T0 - HOUR, variant)], SNAKE, win);
check('G6 equal counts → the fit lost nearer the fight first', tie.options[0].sample.killId === 4 && tie.options[1].sample.killId === 1);
const many = K.groupFitOptions([0, 1, 2, 3, 4, 5].map((i) => cand(10 + i, 20 + i, T0 - (i + 1) * DAY, K.killFit([mod(100, 27), mod(100, 28), mod(110, 19), mod(111, 20), mod(120, 11), mod(900 + i, 12)], isCharge))), SNAKE, win);
check('G7 six different fits → the four nearest shown, and the count of distinct fits says six', many.options.length === 4 && many.distinct === 6 && many.options.map((o) => o.sample.killId).join(',') === '10,11,12,13');
check('G8 nothing read → no options; only stripped hulls → no options, counted', K.groupFitOptions([], SNAKE, win).options.length === 0 && K.groupFitOptions([cand(5, 14, T0, bare)], SNAKE, win).bare === 1 && K.groupFitOptions([cand(5, 14, T0, bare)], SNAKE, win).options.length === 0);
check('G9 MIN_FIT_MODULES is 5: a 5-module ship counts, a 4-module one does not', K.groupFitOptions([cand(6, 15, T0, K.killFit([mod(100, 27), mod(110, 19), mod(111, 20), mod(120, 11), mod(130, 92)], isCharge))], SNAKE, win).options.length === 1 && K.groupFitOptions([cand(7, 15, T0, K.killFit([mod(100, 27), mod(110, 19), mod(111, 20), mod(120, 11)], isCharge))], SNAKE, win).options.length === 0);
const order = K.nearestFirst([{ id: 'a', time: T0 - 9 * DAY }, { id: 'b', time: T1 + HOUR }, { id: 'c', time: T0 + MIN }, { id: 'd', time: T0 - 2 * DAY }], T0, T1, 3).map((r) => r.id).join('');
check('G10 nearestFirst: inside the window, then 1 h after, then 2 d before; the 9-day-old one is cut at 3', order === 'cbd', order);

// ---- E: the EFT text, line for line
const EXPECT = [
  '[Rattlesnake, Pilot - lost 23:35]',
  'Drone Damage Amplifier II',
  'Drone Damage Amplifier II',
  '',
  'X-Large Ancillary Shield Booster, Navy Cap Booster 400',
  'Multispectrum Shield Hardener II',
  '',
  'Rapid Heavy Missile Launcher II, Caldari Navy Scourge Heavy Missile',
  'Rapid Heavy Missile Launcher II',
  'Heavy Energy Nosferatu II',
  '',
  'Large Warhead Rigor Catalyst II',
  '',
  '',
  'Wasp II x5',
  'Hornet II x1',
];
const noCargo = K.killFitEft('Rattlesnake', 'Pilot - lost 23:35', fit, nameOf, { cargo: false });
check('E1 without cargo: low / mid / high / rigs, a blank line between racks, two before the drones', noCargo === EXPECT.join('\n'), '\n' + noCargo);
const withCargo = K.killFitEft('Rattlesnake', 'Pilot - lost 23:35', fit, nameOf);
check('E2 with cargo (the default): one blank line, the hold, the loose charges last', withCargo === [...EXPECT, '', 'Caldari Navy Scourge Heavy Missile x500', 'Navy Cap Booster 400 x18', 'Caldari Navy Scourge Heavy Missile x3'].join('\n'), '\n' + withCargo);
const noDrones = K.killFitEft('Loki', 'x', { ...t3, cargo: [{ typeId: 210, qty: 4 }] }, nameOf);
check('E3 subsystems follow the rigs; with no drones the hold still sits two blank lines down', noDrones === ['[Loki, x]', 'Rapid Heavy Missile Launcher II', '', 'Loki Core - Augmented Nuclear Reactor', '', '', 'Navy Cap Booster 400 x4'].join('\n'), '\n' + noDrones);
check('E4 a name with brackets or a newline cannot break the header', K.killFitEft('Gila', 'a [b] c\nd', t3, nameOf).split('\n')[0] === '[Gila, a b c d]');
const long = K.killFitEft('Gila', 'x'.repeat(80), t3, nameOf).split('\n')[0];
check('E5 the fit name is cut to 50 characters; an empty one falls back to the hull', long === `[Gila, ${'x'.repeat(50)}]` && K.killFitEft('Gila', '  ', t3, nameOf).split('\n')[0] === '[Gila, Gila]');
check('E6 an empty fit is just the header', K.killFitEft('Gila', 'x', K.killFit([], isCharge), nameOf) === '[Gila, x]');

// ---- R: round trip through the app's own EFT parser (the one the Skill & Fit
// module feeds pasted fits to) — the text must be EFT it fully understands
const back = parseFit(withCargo);
const qtyOf = (name) => back.items.find((x) => x.name === name)?.qty ?? 0;
check('R1 the parser resolves the hull and every line', back.shipName === 'Rattlesnake' && back.shipId !== null && back.unresolved.length === 0 && back.extraFits === 0, JSON.stringify(back.unresolved));
check('R2 …and counts what was written: 2 launchers, 2 DDAs, 1 booster, 5 Wasps, 1 Hornet', qtyOf('Rapid Heavy Missile Launcher II') === 2 && qtyOf('Drone Damage Amplifier II') === 2 && qtyOf('X-Large Ancillary Shield Booster') === 1 && qtyOf('Wasp II') === 5 && qtyOf('Hornet II') === 1, JSON.stringify(back.items.map((x) => [x.name, x.qty])));

console.log(`killfit.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
