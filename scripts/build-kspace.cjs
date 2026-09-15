// Builds src/data/kspaceSites.json — the k-space site tables for the chain
// summary — from two inputs:
//   1. npc-bounties.json (this folder): NPC name → kill bounty, extracted
//      from CCP's static data export (fsd/types.yaml + fsd/typeDogma.yaml,
//      attribute 481 entityKillBounty) with scripts/sde-bounties.cjs.
//   2. a reading of EVE University's per-site pages (wave lists for every
//      combat anomaly; clouds for gas sites; rocks for ore anomalies),
//      produced by the agent run of 2026-09-15 and kept as
//      scripts/kspace-reading.json.
// Every combat site = Σ count × bounty over the initial spawn and the
// listed waves; random / faction / escalation spawns are excluded (they
// are noted). Ship names the export does not know are listed under
// `unknown` and contribute 0 — the table says how many per site.
//
//   node scripts/build-kspace.cjs
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const bounties = JSON.parse(fs.readFileSync(path.join(__dirname, 'npc-bounties.json'), 'utf8'));
const reading = JSON.parse(fs.readFileSync(path.join(__dirname, 'kspace-reading.json'), 'utf8'));

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const words = (s) => norm(s).toLowerCase().split(' ').filter(Boolean);
const NAMES = Object.keys(bounties);
const NAME_WORDS = NAMES.map((n) => ({ n, w: words(n) }));
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, k = b.length;
  if (!m || !k) return Math.max(m, k);
  let prev = Array.from({ length: k + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= k; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[k];
}
/**
 * One name → bounty. Exact first; then the wiki's habits: a plural, a
 * stray article, words in another order ("Cardinal Corpus" for "Corpus
 * Cardinal"), a dropped middle word ("Corpum Engraver" for "Corpum Arch
 * Engraver" — the shortest export name containing every word wins), and
 * typos of a letter or two per word ("Pith Ursurper", "Pithii
 * Destructor", "Colerior Artillery"). Anything looser stays unknown and
 * is reported rather than guessed.
 */
function bountyOfOne(name) {
  const n = norm(name);
  if (!n) return null;
  if (bounties[n]) return bounties[n].isk;
  const singular = n.replace(/s$/, '');
  if (bounties[singular]) return bounties[singular].isk;
  const stripped = n.replace(/^(the|a|an)\s+/i, '');
  if (bounties[stripped]) return bounties[stripped].isk;
  const w = words(n);
  if (w.length === 0) return null;
  // a bare CLASS prefix ("Corpus" = the Blood Raider battleships, "Elder
  // Corpum" = their elite cruisers, "Corpatis" = battlecruisers) names a
  // family, not a ship: use the average bounty of every export name that
  // starts with it, when there are at least three
  const family = NAME_WORDS.filter((c) => c.w.length === w.length + 1 && w.every((x, i) => c.w[i] === x));
  if (family.length >= 3) return family.reduce((t, c) => t + bounties[c.n].isk, 0) / family.length;
  // every word present, any order, fewest extra words
  const contain = NAME_WORDS.filter((c) => w.every((x) => c.w.includes(x))).sort((a, b) => a.w.length - b.w.length);
  if (contain.length && contain[0].w.length <= w.length + 1) return bounties[contain[0].n].isk;
  // same word count, each word within two edits, three edits in all
  let best = null;
  for (const c of NAME_WORDS) {
    if (c.w.length !== w.length) continue;
    let total = 0, ok = true;
    for (let i = 0; i < w.length && ok; i++) { const d = lev(w[i], c.w[i]); if (d > 2) ok = false; total += d; }
    if (ok && total <= 3 && (!best || total < best.total)) best = { n: c.n, total };
  }
  return best ? bounties[best.n].isk : null;
}
/**
 * The wiki writes either/or spawns as "Gist Cherubim/Seraphim",
 * "Corpus Pope / Patriarch", "Centus Dark Lord/Centus Overlord", "Dire
 * Pithi Arrogator/Imputor": the later parts may drop the shared prefix.
 * Each alternative is resolved (borrowing the first name's leading words
 * when a bare part is unknown) and the AVERAGE bounty is used — the
 * expected value of a spawn that is one or the other.
 */
function bountyOf(name) {
  const n = norm(name);
  if (!n.includes('/')) return { isk: bountyOfOne(n), alt: false };
  const parts = n.split('/').map((p) => norm(p)).filter(Boolean);
  if (parts.length < 2) return { isk: bountyOfOne(n), alt: false };
  const firstWords = parts[0].split(' ');
  const vals = [];
  for (const [i, p] of parts.entries()) {
    let v = bountyOfOne(p);
    if (v === null && i > 0) {
      for (let k = firstWords.length - 1; k >= 1 && v === null; k--) v = bountyOfOne(`${firstWords.slice(0, k).join(' ')} ${p}`);
    }
    if (v !== null) vals.push(v);
  }
  if (vals.length === 0) return { isk: null, alt: true };
  return { isk: vals.reduce((a, b) => a + b, 0) / vals.length, alt: true };
}

const combat = {};
const unknown = {};
const skipped = [];
for (const batch of reading.anomalies || []) {
  for (const site of (batch.read && batch.read.sites) || []) {
    if (!site.found || !site.waves || site.waves.length === 0) { skipped.push({ site: site.site, why: site.notes || 'not found' }); continue; }
    // LAYOUT VARIANTS: 28 pages describe two (or four) layouts of the same
    // site ("Silo spawn - Wave 1", "Workers' Quarters - Wave 1"; "Gas Haven
    // variant", "Rock Haven variant (Pirate Gate)"). A run gets ONE layout,
    // so the waves are grouped by layout and the layouts AVERAGED — summing
    // them (what the first pass and its checker both did) double-counts.
    const variantKey = (w) => {
      if (!/\s[-–—:]\s/.test(w.wave)) return '';
      const pre = w.wave.split(/\s[-–—:]\s/)[0].replace(/\([^)]*\)/g, '').replace(/\b(variant|layout|type|spawn)\b/gi, '').trim().toLowerCase();
      return pre.split(/\s+/)[0] || '';
    };
    const keys = [...new Set(site.waves.map(variantKey))];
    const layouts = keys.length >= 2 && !keys.includes('') ? keys.map((k) => site.waves.filter((w) => variantKey(w) === k)) : [site.waves];
    const miss = new Set();
    const perLayout = layouts.map((waves) => {
      let isk = 0, ships = 0, missing = 0, eitherOr = 0;
      for (const w of waves) {
        for (const s of w.ships || []) {
          const count = Number(s.count) || 0;
          if (count <= 0) continue;
          const kind = String(s.kind || '').toLowerCase();
          const { isk: b, alt } = bountyOf(s.name);
          if (b === null) {
            // sentries / structures carry no bounty — expected; anything else is a name miss
            if (!/sentry|structure|battery|tower|bunker/.test(kind) && !/Battery|Tower|Bunker|Sentry|Stargate|Beacon|Outpost$/i.test(norm(s.name))) { missing += count; miss.add(norm(s.name)); }
            continue;
          }
          isk += b * count;
          ships += count;
          if (alt) eitherOr += count;
        }
      }
      return { isk, ships, missing, eitherOr, waves: waves.length };
    });
    for (const m of miss) unknown[m] = (unknown[m] || 0) + 1;
    const avg = (f) => perLayout.reduce((t, l) => t + f(l), 0) / perLayout.length;
    const notes = [];
    notes.push('lowest of every range');
    if (layouts.length > 1) notes.push(`${layouts.length} layouts averaged (${perLayout.map((l) => Math.round(l.isk / 1e5) / 10 + 'M').join(' / ')})`);
    if (avg((l) => l.eitherOr) > 0) notes.push(`either/or spawns at the average of the alternatives`);
    if (avg((l) => l.missing) > 0) notes.push(`${Math.round(avg((l) => l.missing))} rat(s) with no bounty in the export, counted at 0`);
    combat[norm(site.site)] = {
      isk: Math.round(avg((l) => l.isk)),
      faction: batch.faction,
      tier: norm(site.site).replace(/^(Angel|Blood|Guristas|Sansha|Serpentis|Drone)\s+/, ''),
      ships: Math.round(avg((l) => l.ships)), waves: Math.round(avg((l) => l.waves)),
      ...(layouts.length > 1 ? { layouts: layouts.length } : {}),
      ...(notes.length ? { note: notes.join('; ') } : {}),
      ...(site.escalation ? { escalation: norm(site.escalation).slice(0, 160) } : {}),
      source: site.url || '',
    };
  }
}

const gas = {};
for (const s of (reading.gas && reading.gas.sites) || []) {
  const clouds = (s.clouds || []).filter((c) => c && c.gas && Number(c.units) > 0).map((c) => ({ gas: norm(c.gas), units: Number(c.units) }));
  if (clouds.length) gas[norm(s.site)] = clouds;
}
const ore = {};
for (const s of (reading.ore && reading.ore.sites) || []) {
  const rocks = (s.rocks || []).filter((r) => r && r.ore && Number(r.units) > 0).map((r) => ({ ore: norm(r.ore), units: Number(r.units) }));
  if (!rocks.length) continue;
  const band = /high/i.test(s.space || '') ? 'HS' : /low/i.test(s.space || '') ? 'LS' : /null/i.test(s.space || '') ? 'NS' : '';
  const key = band ? `${norm(s.site)}|${band}` : norm(s.site);
  ore[key] = rocks;
}

const out = { built: new Date().toISOString().slice(0, 10), combat, gas, ore, unknown, skipped };
fs.writeFileSync(path.join(root, 'src', 'data', 'kspaceSites.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(`combat sites ${Object.keys(combat).length} · gas ${Object.keys(gas).length} · ore ${Object.keys(ore).length} · unknown rat names ${Object.keys(unknown).length} · skipped ${skipped.length}`);
for (const [n, c] of Object.entries(unknown).sort((a, b) => b[1] - a[1]).slice(0, 25)) console.log('  unknown:', n, '×', c);
for (const s of skipped.slice(0, 12)) console.log('  skipped:', s.site, '—', s.why);
