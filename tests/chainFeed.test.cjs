// CHAIN FEED (v0.200.3) — the map's own JSON, field roles inferred from
// values. Three plausible schemas, hand-built, plus decoys that a naive
// key-name reader would fall for. The real schema is unpublished; the
// devlog report from the first press says which of these it resembles.
const F = require('./sim/lib/chainFeed.js');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };
const NOW = Date.parse('2026-09-14T20:00:00Z');
const drawn = [
  { id: '1', text: '42 C2 🐊 Homebase C3 H' },
  { id: '618', text: '3 H Zaveral Aridia' },
  { id: '1805', text: '4 C3 C J142951 H' },
];

// ---- A: flat schema, links as from/to, sigs as one list per system ----
const mapA = {
  id: 1, name: 'corp map',
  systems: [
    { id: 1, name: 'J100001', alias: 'Homebase', class: 'C2', locked: true },
    { id: 618, name: 'Zaveral', alias: '', class: 'H' },
    { id: 1805, name: 'J142951', alias: null, class: 'C3' },
    { id: 9999, name: 'J999999', alias: 'Old Static', class: 'C4' },
  ],
  connections: [
    { id: 12766, from: 1, to: 618, mass: 'fresh' },
    { id: 12774, from: 1, to: 1805, mass: 'half' },
  ],
  members: [{ id: 1, name: 'Someone' }, { id: 2, name: 'Other' }],   // decoy: ids overlap a drawn id
};
const mA = F.inferMap(mapA, drawn);
check('A1 systems array + id key found by the drawn ids', mA.report.systems && mA.report.systems.path === 'systems' && mA.report.systems.idKey === 'id' && mA.report.systems.drawnMatched === 3, JSON.stringify(mA.report.systems));
check('A2 label = the field that appears in the node text (alias), J-code kept', mA.systems.find((s) => s.id === '1').label === 'Homebase' && mA.systems.find((s) => s.id === '1').jcode === 'J100001', JSON.stringify(mA.systems[0]));
check('A3 a system with no alias falls back to its J-code / name', mA.systems.find((s) => s.id === '1805').label === 'J142951', JSON.stringify(mA.systems[2]));
check('A4 class read from the class field', mA.systems.find((s) => s.id === '1').cls === 'C2' && mA.systems.find((s) => s.id === '618').cls === 'HS', JSON.stringify(mA.systems.map((s) => s.cls)));
check('A5 edges from the from/to pair, decoy members ignored', mA.edges.length === 2 && mA.report.edges.keys.join('+') === 'from+to', JSON.stringify(mA.report.edges));
const sigsA = { signatures: [
  { id: 'a1', signature: 'AC6-000', type: 'Ore', name: 'Common Perimeter Deposit', updatedAt: '2026-09-14T13:00:00Z', createdAt: '2026-09-13T00:00:00Z' },
  { id: 'a2', signature: 'AHF-430', type: 'Combat', name: 'Guristas Hidden Hub', updatedAt: '2026-09-14T15:00:00Z', createdAt: '2026-09-13T00:00:00Z' },
  { id: 'a3', signature: 'BKU-991', type: '', name: '', updatedAt: '2026-09-14T19:00:00Z', createdAt: '2026-09-14T19:00:00Z' },
] };
const sA = F.inferSignatures(sigsA, mA.systems, mA.systems.find((s) => s.id === '1805'), NOW);
check('A6 sig/group/name/time keys inferred', sA.report && sA.report.sigKey === 'signature' && sA.report.groupKey === 'type' && sA.report.nameKey === 'name' && sA.report.timeKey === 'updatedAt', JSON.stringify(sA.report));
check('A7 rows carry the route\'s system, its class, and age from updatedAt (7 h)', sA.sigs.length === 3 && sA.sigs[0].system === 'J142951' && sA.sigs[0].cls === 'C3' && sA.sigs[0].ageH === 7, JSON.stringify(sA.sigs[0]));
check('A8 empty group + empty name → Other, unscanned', sA.sigs[2].group === 'Other' && sA.sigs[2].name === '', JSON.stringify(sA.sigs[2]));

// ---- B: nested schema, ids inside objects, lower-case sig ids, epoch seconds ----
const mapB = { data: { map: {
  systems: [
    { systemId: 1, solarSystem: { name: 'J100001', wormholeClass: 2 }, label: 'Homebase' },
    { systemId: 618, solarSystem: { name: 'Zaveral', wormholeClass: null }, label: '' },
    { systemId: 1805, solarSystem: { name: 'J142951', wormholeClass: 3 }, label: '' },
  ],
  links: [
    { source: { id: 1 }, target: { id: 618 } },
    { source: { id: 1805 }, target: { id: 1 } },
    { source: { id: 1 }, target: { id: 1 } },          // a loop is not a link
  ],
  history: [{ from: 1, to: 1 }, { from: 1, to: 1 }],   // decoy pair that never differs
} } };
const mB = F.inferMap(mapB, drawn);
check('B1 nested ids resolve (systemId), labels from node text, J-code from solarSystem.name', mB.systems.length === 3 && mB.systems[0].label === 'Homebase' && mB.systems[2].label === 'J142951' && mB.report.systems.jKey === 'solarSystem.name', JSON.stringify(mB.report.systems));
check('A9 an undrawn system is labelled by the field that won for the drawn ones (alias), else its J-code', mA.systems.find((s) => s.id === '9999').label === 'Old Static', JSON.stringify(mA.systems[3]));
// a signature list whose items carry systemId + mapId must never be read as links
const mapF = { id: 1, systems: [{ id: 1, name: 'Homebase' }, { id: 618, name: 'Zaveral' }, { id: 1805, name: 'J142951' }],
  sigs: [{ signature: 'AAA-111', systemId: 618, mapId: 1 }, { signature: 'BBB-222', systemId: 1805, mapId: 1 }, { signature: 'CCC-333', systemId: 618, mapId: 1 }],
  links: [{ from: 1, to: 618 }] };
const mF = F.inferMap(mapF, drawn);
check('A10 a signature list is not mistaken for links', mF.edges.length === 1 && mF.report.edges.path === 'links', JSON.stringify(mF.report.edges));
check('B2 links from source.id/target.id, loop dropped, decoy history ignored', mB.edges.length === 2 && mB.report.edges.path === 'data.map.links', JSON.stringify(mB.report.edges));
const sigsB = { count: 2, items: [
  { sigId: 'ac6-000', group: 'ORE', siteName: 'Common Perimeter Deposit', lastSeen: 1789390800 },   // 2026-09-14T13:00Z
  { sigId: 'aqz-632', group: 'COMBAT', siteName: 'Frontier Barracks', lastSeen: 1789405200 },
] };
const sB = F.inferSignatures(sigsB, mB.systems, mB.systems[0], NOW);
check('B3 lower-case ids upper-cased, ORE → Ore, epoch seconds → 7 h', sB.sigs.length === 2 && sB.sigs[0].sig === 'AC6-000' && sB.sigs[0].group === 'Ore' && Math.abs(sB.sigs[0].ageH - 7) < 1e-6, JSON.stringify(sB.sigs[0]));
check('B4 name key found through our site tables', sB.report.nameKey === 'siteName' && sB.sigs[1].name === 'Frontier Barracks', JSON.stringify(sB.report));

// ---- C: signatures nested under each system, numeric group ids, one system id field ----
const mapC = { systems: [
  { id: 1, name: 'Homebase', signatures: [
    { sig: 'BDQ-174', groupId: 6, site: 'K162', seenAt: 1789408800000 },
    { sig: 'BJP-516', groupId: 2, site: 'Average Frontier Deposit', seenAt: 1789408800000 },
  ] },
  { id: 618, name: 'Zaveral', signatures: [
    { sig: 'BFB-743', groupId: 1, site: 'Serpentis Hideaway', seenAt: 1789408800000 },
    { sig: 'LGM-001', groupId: 5, site: 'Local Guristas Mainframe', seenAt: 1789408800000 },
  ] },
  { id: 1805, name: 'J142951', signatures: [] },
], connections: [{ a: 1, b: 618 }, { a: 1, b: 1805 }] };
const mC = F.inferMap(mapC, drawn);
check('C1 edges from an a/b pair', mC.edges.length === 2 && mC.report.edges.keys.join('+') === 'a+b', JSON.stringify(mC.report.edges));
const sC = F.inferSignatures(mapC, mC.systems, null, NOW);
check('C2 nested sigs merged across systems, each mapped to its parent system', sC.sigs.length === 4 && sC.report.systemKey === '__parent.id' && sC.sigs.find((s) => s.sig === 'BFB-743').system === 'Zaveral', JSON.stringify(sC.report));
check('C3 numeric group ids → group from the site name (4 of 4)', sC.report.groupFromName === 4 && sC.sigs.find((s) => s.sig === 'BJP-516').group === 'Ore' && sC.sigs.find((s) => s.sig === 'BFB-743').group === 'Combat' && sC.sigs.find((s) => s.sig === 'LGM-001').group === 'Data' && sC.sigs.find((s) => s.sig === 'BDQ-174').group === 'Wormhole', JSON.stringify(sC.sigs.map((s) => [s.sig, s.group])));
check('C4 epoch ms → 2 h old', Math.abs(sC.sigs[0].ageH - 2) < 1e-6, String(sC.sigs[0].ageH));

// ---- H: custom name > system name > never the region; tags ----
const drawnH = [
  { id: '1', text: '42 C2 🐊 Homebase C3 H' },
  { id: '618', text: '3 H Jita The Forge' },          // k-space: name + REGION in the text
  { id: '1805', text: '4 C3 C J142951 H' },
  { id: '7', text: '2 C4 F Fly Sideways C3' },        // custom name on a J-space system
];
const mapH = { systems: [
  { id: 1, name: 'J100001', label: 'Homebase', region: 'B-R00005', tag: '🐊', class: 'C2' },
  { id: 618, name: 'Jita', label: null, region: 'The Forge', tag: '', class: 'H' },
  { id: 1805, name: 'J142951', label: '', region: 'C-R00012', tag: 'C', class: 'C3' },
  { id: 7, name: 'J170007', label: 'Fly Sideways', region: 'D-R00020', tag: 'F', class: 'C4' },
  { id: 9, name: 'J190009', label: '', region: 'E-R00001', tag: 'B', class: 'C5' },   // undrawn
] };
const mH = F.inferMap(mapH, drawnH);
const hs = (id) => mH.systems.find((s) => s.id === id);
check('H1 k-space system keeps its NAME, not its region (was "The Forge")', hs('618').label === 'Jita', JSON.stringify(hs('618')));
check('H2 custom names win on J-space systems, J-code otherwise', hs('1').label === 'Homebase' && hs('7').label === 'Fly Sideways' && hs('1805').label === 'J142951' && hs('9').label === 'J190009', JSON.stringify(mH.systems.map((s) => s.label)));
check('H3 the label field is reported as the custom-name field', mH.report.systems.labelKey === 'label', JSON.stringify(mH.report.systems));
check('H4 tags read from the tag field: glyph, letter, empty', hs('1').tag === '🐊' && hs('1805').tag === 'C' && hs('7').tag === 'F' && hs('618').tag === '' && mH.report.systems.tagKey === 'tag', JSON.stringify(mH.systems.map((s) => s.tag)));
const mapT = { systems: [
  { id: 1, name: 'J100001', tag: 'A', security: 'C2' }, { id: 618, name: 'Zaveral', tag: 'a', security: 'L' }, { id: 1805, name: 'J142951', tag: 'B2', security: 'C3' }, { id: 7, name: 'J170007', tag: 'too long to be a tag', security: 'C4' },
  { id: 8, name: 'J180008', tag: 'C', security: 'C5' }, { id: 9, name: 'J190009', tag: 'D', security: 'C6' },
] };
const mT = F.inferMap(mapT, [{ id: '1', text: '42 C2 A Homebase C3 H' }, { id: '618', text: '3 L Zaveral Aridia' }, { id: '1805', text: 'C3 B2 J142951 H' }, { id: '7', text: 'C4 J170007 C3' }, { id: '8', text: 'C5 C J180008 C3' }, { id: '9', text: 'C6 D J190009 C3' }]);
check('H6 once the tag field is known: a lowercase letter is upper-cased, a short code kept, a long value dropped; k-space L → LS', mT.systems.find((s) => s.id === '618').tag === 'A' && mT.systems.find((s) => s.id === '1805').tag === 'B2' && mT.systems.find((s) => s.id === '7').tag === '' && mT.systems.find((s) => s.id === '618').cls === 'LS', JSON.stringify(mT.systems.map((s) => [s.tag, s.cls])));
// the real feed's `effect` field (null when none) — v0.201.1
const mapI = { data: { systems: [
  { id: 1, name: 'J100001', alias: 'Homebase', security: 'C2', effect: null, tag: 'A' },
  { id: 1805, name: 'J142951', alias: null, security: 'C3', effect: 'Wolf-Rayet', tag: 'C' },
  { id: 7, name: 'J170007', alias: '', security: 'C4', effect: 'Pulsar', tag: 'F' },
] } };
const mI = F.inferMap(mapI, [{ id: '1', text: '42 C2 A Homebase C3 H' }, { id: '1805', text: '4 C3 C J142951 H' }, { id: '7', text: '2 C4 F J170007 C3' }]);
check('H5 the effect field is found and carried; none → empty', mI.report.systems.effectKey === 'effect' && mI.systems.find((s) => s.id === '1805').effect === 'Wolf-Rayet' && mI.systems.find((s) => s.id === '7').effect === 'Pulsar' && mI.systems.find((s) => s.id === '1').effect === '', JSON.stringify(mI.systems.map((s) => s.effect)));

// ---- G: the REAL envelope measured 2026-09-14 — { ok, data: { map: { …, homeMapSystemId }, systems, connections, signatures, … } },
// signatures inline for the whole map, referencing systems by CCP's solar system id
const mapG = { ok: true, data: {
  map: { id: 1, name: 'corp', scope: 'corp', type: 'wh', tagScheme: 'letters', homeMapSystemId: 1 },
  systems: [
    { id: 1, solarSystemId: 31000001, name: 'J100001', label: 'Homebase', wormholeClass: 'C2' },
    { id: 618, solarSystemId: 30002187, name: 'Zaveral', label: null, wormholeClass: null },
    { id: 1805, solarSystemId: 31001805, name: 'J142951', label: '', wormholeClass: 'C3' },
  ],
  connections: [{ id: 12766, fromMapSystemId: 1, toMapSystemId: 618 }, { id: 12774, fromMapSystemId: 1, toMapSystemId: 1805 }],
  signatures: [
    { id: 'u1', solarSystemId: 31000001, signatureId: 'BJP-516', group: 'ore', name: 'Average Frontier Deposit', updatedAt: '2026-09-14T18:00:00Z' },
    { id: 'u2', solarSystemId: 31001805, signatureId: 'APH-650', group: 'data', name: 'Unsecured Frontier Database', updatedAt: '2026-09-14T19:00:00Z' },
    { id: 'u3', solarSystemId: 30002187, signatureId: 'BFB-743', group: 'combat', name: 'Serpentis Hideaway', updatedAt: '2026-09-14T19:30:00Z' },
  ],
  notes: [{ id: 5, text: 'hello' }], presence: [{ characterId: 2121000000, mapSystemId: 1 }],
} };
const mG = F.inferMap(mapG, drawn);
check('G1 systems under data.systems, CCP ids found, home read from homeMapSystemId', mG.systems.length === 3 && mG.report.systems.eveKey === 'solarSystemId' && mG.home && mG.home.label === 'Homebase' && mG.report.home.key === 'data.map.homeMapSystemId', JSON.stringify([mG.report.systems, mG.report.home]));
check('G2 links from fromMapSystemId/toMapSystemId; presence (one system id + a character id) is not a link list', mG.edges.length === 2 && mG.report.edges.path === 'data.connections', JSON.stringify(mG.report.edges));
const sG = F.inferSignatures(mapG, mG.systems, null, NOW);
check('G3 inline signatures mapped to systems through CCP ids, lower-case groups read', sG.sigs.length === 3 && sG.report.systemKey === 'solarSystemId' && sG.sigs.find((s) => s.sig === 'BFB-743').system === 'Zaveral' && sG.sigs.find((s) => s.sig === 'BJP-516').group === 'Ore' && sG.sigs.find((s) => s.sig === 'APH-650').system === 'J142951', JSON.stringify(sG.report));
check('G4 ages from updatedAt: 2 h, 1 h, 0.5 h', Math.abs(sG.sigs[0].ageH - 2) < 1e-9 && Math.abs(sG.sigs[1].ageH - 1) < 1e-9 && Math.abs(sG.sigs[2].ageH - 0.5) < 1e-9, JSON.stringify(sG.sigs.map((s) => s.ageH)));

// ---- D: nothing usable ----
const mD = F.inferMap({ ok: true, version: '3' }, drawn);
check('D1 an unrelated document yields no systems and says so', mD.systems.length === 0 && mD.edges.length === 0 && mD.report.notes.length === 1, JSON.stringify(mD.report));
const sD = F.inferSignatures({ items: [{ id: 1 }, { id: 2 }] }, mA.systems, mA.systems[0], NOW);
check('D2 a list with no sig-shaped field yields nothing', sD.sigs.length === 0 && sD.report === null);

// ---- E: group from name ----
const gn = (n) => F.groupFromName(n);
check('E1 site tables win', gn('Frontier Barracks') === 'Combat' && gn('Unsecured Frontier Database') === 'Data' && gn('Forgotten Core Data Field') === 'Relic' && gn('Barren Perimeter Reservoir') === 'Gas' && gn('Common Perimeter Deposit') === 'Ore');
check('E2 k-space anomalies and pirate hack sites by pattern', gn('Guristas Forsaken Hub') === 'Combat' && gn('Ruined Guristas Crystal Quarry') === 'Relic' && gn('Central Serpentis Sparking Transmitter') === 'Data' && gn('K162') === 'Wormhole' && gn('') === null && gn('Something Odd') === null);

console.log(`chainFeed.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
