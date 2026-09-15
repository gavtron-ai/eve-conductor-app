// K-SPACE SITE TABLES (v0.201) — sanity over the built src/data/kspaceSites.json:
// coverage, shape, and the ladder every faction's anomalies must climb.
const K = require('../src/data/kspaceSites.json');

let pass = 0, fail = 0;
const check = (label, ok, extra = '') => { if (ok) pass++; else { fail++; console.error('FAIL ' + label + (extra ? '   ' + extra : '')); } };

const FACTIONS = ['Angel', 'Blood', 'Guristas', 'Sansha', 'Serpentis'];
const TIERS = ['Hideaway', 'Refuge', 'Den', 'Yard', 'Rally Point', 'Port', 'Hub', 'Haven', 'Sanctum'];
const combat = K.combat;
check('C1 115 combat anomalies: 5 factions × 21 + 10 drone sites', Object.keys(combat).length === 115, String(Object.keys(combat).length));
check('C2 every entry has a positive ISK, rat and wave counts, a faction and a source page', Object.entries(combat).every(([, v]) => v.isk > 0 && v.ships > 0 && v.waves > 0 && v.faction && v.source), JSON.stringify(Object.entries(combat).filter(([, v]) => !(v.isk > 0 && v.ships > 0)).map(([k]) => k)));
for (const f of FACTIONS) {
  // the base ladder: a Sanctum must out-pay a Hub must out-pay a Den must out-pay a Hideaway
  const ladder = ['Hideaway', 'Den', 'Hub', 'Sanctum'].map((t) => combat[`${f} ${t}`].isk);
  check(`C3 ${f}: Hideaway < Den < Hub < Sanctum`, ladder[0] < ladder[1] && ladder[1] < ladder[2] && ladder[2] < ladder[3], JSON.stringify(ladder));
  check(`C4 ${f}: all 21 variants present`, TIERS.every((t) => combat[`${f} ${t}`]) && ['Hidden', 'Forsaken', 'Forlorn'].every((v) => ['Hideaway', 'Den', 'Rally Point', 'Hub'].every((t) => combat[`${f} ${v} ${t}`])));
}
check('C5 drone ladder: Cluster < Menagerie < Horde', combat['Drone Cluster'].isk < combat['Drone Menagerie'].isk && combat['Drone Menagerie'].isk < combat['Drone Horde'].isk, JSON.stringify([combat['Drone Cluster'].isk, combat['Drone Menagerie'].isk, combat['Drone Horde'].isk]));
check('C6 no site is absurd: every total between 10k (a Hideaway is a few frigates) and 200M ISK', Object.values(combat).every((v) => v.isk >= 10_000 && v.isk <= 200_000_000), JSON.stringify(Object.entries(combat).filter(([, v]) => !(v.isk >= 10_000 && v.isk <= 200_000_000)).map(([k, v]) => [k, v.isk])));
check('C7 a Haven pays tens of millions (Guristas Haven 15M–60M)', combat['Guristas Haven'].isk >= 15_000_000 && combat['Guristas Haven'].isk <= 60_000_000, String(combat['Guristas Haven'].isk));
check('C8 layouts were averaged, not summed: Serpentis Rally Point carries the layout note and lands near the wiki\'s "around 4.5M"', combat['Serpentis Rally Point'].layouts === 2 && combat['Serpentis Rally Point'].isk > 2_000_000 && combat['Serpentis Rally Point'].isk < 8_000_000, JSON.stringify(combat['Serpentis Rally Point']));
check('C9 unknown rat names are few after either/or resolution', Object.keys(K.unknown).length <= 40, JSON.stringify(Object.keys(K.unknown).slice(0, 40)));

const gas = K.gas;
check('G1 the 63 k-space nebulae, every one a single booster gas with units', Object.keys(gas).length >= 60 && Object.values(gas).every((c) => c.length >= 1 && c.every((x) => /Mykoserocin|Cytoserocin/.test(x.gas) && x.units > 0)), String(Object.keys(gas).length));
const ore = K.ore;
check('O1 k-space ore anomalies keyed by name and security band, rocks with units', Object.keys(ore).length >= 50 && Object.keys(ore).every((k) => /\|(HS|LS|NS)$/.test(k)) && Object.values(ore).every((r) => r.length >= 1 && r.every((x) => x.units > 0)), String(Object.keys(ore).length));
check('O2 a highsec Small Omber Deposit is in the table', !!ore['Small Omber Deposit|HS']);

console.log(`kspace.test: ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
