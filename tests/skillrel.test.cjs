// SKILL RELEVANCE (v0.147) — the ECM-drone attribution bug, pinned.
//
// Verified against the shipped SDE protobuf (decoded 2026-08-26): Signal
// Dispersion's bonus is a LocationRequiredSkillModifier on domain shipID keyed
// to Electronic Warfare — it reaches fitted ECM MODULES only. Drones in space
// are not in the ship; every skill CCP intends to reach drones (Drone
// Interfacing etc.) uses OwnerRequiredSkillModifier on domain charID instead.
// The old kind-2 pool excluded only charges, so EC-300s (which REQUIRE
// Electronic Warfare) were wrongly told to train Signal Dispersion.

const store = new Map();
global.localStorage = {
  getItem: (k) => store.get(k) ?? null,
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};

const { relevantForFit } = require('./sim/lib/skillRelevance.js');

let pass = 0, fail = 0;
const check = (label, ok) => { if (ok) pass++; else { fail++; console.error('FAIL ' + label); } };

const fitOf = (typeId, name) => ({ shipId: null, shipName: 'test', items: [{ typeId, name }] });
const find = (rel, name) => rel.find((r) => r.skill.name === name);

// A: EC-300 drones — Signal Dispersion must NOT be attributed (the game never
// applies it to drones), but the OWNER-path drone skills still must be.
{
  const rel = relevantForFit(fitOf(23707, 'Hornet EC-300'));
  check('A1 Signal Dispersion NOT listed for EC-300 drones', find(rel, 'Signal Dispersion') === undefined);
  const di = find(rel, 'Drone Interfacing');
  check('A2 Drone Interfacing still cites the drone', !!di && di.boosts.some((b) => b.includes('Hornet EC-300')));
}

// B: a FITTED ECM module — Signal Dispersion must still apply (location path),
// with the jammer-strength boosts, and drone skills must NOT appear.
{
  const rel = relevantForFit(fitOf(19929, 'Induced Compact Multispectral ECM'));
  const sd = find(rel, 'Signal Dispersion');
  check('B1 Signal Dispersion listed for a fitted ECM module', !!sd);
  check('B2 cites the module with jammer strength', !!sd && sd.boosts.some((b) => /ECM Jammer Strength/.test(b) && b.includes('Multispectral ECM')));
  check('B3 Drone Interfacing not listed for a lone module', find(rel, 'Drone Interfacing') === undefined);
}

// ---- SP math (v0.192) — hand-computed against EVE's published table ----
{
  const { spAtLevel, spMissing, spShort } = require('./sim/lib/skillRelevance.js');
  // canonical rank-1 cumulative totals: 250 / 1,414 / 8,000 / 45,255 / 256,000
  const canon = [250, 1414, 8000, 45255, 256000];
  for (let l = 1; l <= 5; l++) check('SP rank-1 L' + l, spAtLevel(1, l) === canon[l - 1]);
  check('SP rank scales linearly: rank 5 at V = 1,280,000', spAtLevel(5, 5) === 1_280_000);
  check('SP level 0 costs nothing', spAtLevel(3, 0) === 0);
  check('SP missing III->V (rank 2) = 496,000', spMissing(2, 3, 5) === 496_000);
  check('SP already past target -> 0', spMissing(1, 5, 3) === 0);
  check('SP untrained to IV (rank 1) = 45,255', spMissing(1, 0, 4) === 45_255);
  check('spShort 45,255 -> 45.3k', spShort(45_255) === '45.3k');
  check('spShort 1,280,000 -> 1.28M', spShort(1_280_000) === '1.28M');
}

console.log(`skillrel.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
