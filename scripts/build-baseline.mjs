// BASELINE BUILDER (v0.188; part of every ship since v0.213.0) — collects the shareable
// measurement history into app/baseline/ for the installer to carry (build.extraResources).
//
//   npm run baseline                       (by hand; refuses without the owner's patterns)
//   node scripts/build-baseline.mjs --if-owner   (what `npm run ship` runs: on a machine with
//                                           no owner patterns or no stats folder it leaves
//                                           baseline/ as it is and says so, instead of failing
//                                           somebody else's build)
//
// STRICT ALLOWLIST — only impersonal, publicly-derived measurements:
//   radar-summary-<region>.json  per-item market rates measured from public books (one compact
//                         file per region since v0.229.0; a pre-0.229 blob is split on the way)
//   radar-coverage.json   which regions/days the radar has covered
//   theft-raids.ndjson    skyhook raid history diffed from CCP's public feed — ONLY the feed's
//                         own verdicts (raided / survived / unknown). v0.213.0: a raid the owner
//                         MARKED HIMSELF ('mine'), a bar reading ('bar') and any verdict his bar
//                         readings changed are his own doings, not measurements — they used to
//                         be copied along (one 'mine' event shipped in the 0.188–0.212 seed).
// Never: wallets, ledgers, orders, trend events, fits, wip state, raw archives, killmails (the
// guard refuses the corp's killmail archive: the owner's own pilots are in it). Every file is
// scanned for personal patterns before copying — a hit refuses the whole build.
//
// baseline.json is the STAMP: an id made from the content, so an installed app merges a baseline
// once and an unchanged bake is never merged twice (electron/baseline.cjs).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { loadOwnerPatterns, PATTERNS_PATH } from './ownerPatterns.mjs';
const RS = createRequire(import.meta.url)('../electron/radarSummary.cjs');

const ROOT = path.resolve(import.meta.dirname, '..');
const STATS = path.join(os.homedir(), 'Documents', 'EVE Conductor Stats (Do Not Delete)');
const OUT = path.join(ROOT, 'baseline');
const IF_OWNER = process.argv.includes('--if-owner');

const ALLOW = ['radar-coverage.json', 'theft-raids.ndjson'];
const FEED_KINDS = new Set(['raided', 'survived', 'unknown']);
const RAID_FIELDS = ['t', 'planetId', 'systemId', 'kind', 'intoWindowMin', 'windowMin', 'blindTailMin'];

// the owner's personal patterns come from the GITIGNORED local file —
// baking a baseline is an owner act, so the file is REQUIRED here
const loaded = loadOwnerPatterns();
if (loaded === null || !fs.existsSync(STATS)) {
  if (IF_OWNER) {
    console.log(`baseline: not the owner's machine (${loaded === null ? 'no owner patterns' : 'no stats folder'}) — baseline/ left as it is.`);
    process.exit(0);
  }
  console.error(`No ${loaded === null ? PATTERNS_PATH : STATS} — a baseline must be built from YOUR stats and scanned against YOUR personal patterns.`);
  console.error('Create it first (format in scripts/ownerPatterns.mjs).');
  process.exit(1);
}
const FORBIDDEN = loaded.map((p) => p.pattern);

/** only the feed's own verdicts, only their impersonal fields */
function impersonalRaids(buf) {
  const out = [];
  let dropped = 0;
  for (const line of buf.toString('utf8').split('\n')) {
    if (!line.trim()) continue;
    let e;
    try { e = JSON.parse(line); } catch { dropped++; continue; }
    if (!FEED_KINDS.has(e.kind) || e.resolvedBy !== undefined || e.wasKind !== undefined || e.note !== undefined) { dropped++; continue; }
    const clean = {};
    for (const k of RAID_FIELDS) if (e[k] !== undefined) clean[k] = e[k];
    out.push(JSON.stringify(clean));
  }
  console.log(`  theft-raids: ${out.length} feed verdicts kept, ${dropped} personal / unreadable lines left out`);
  return Buffer.from(out.join('\n') + '\n');
}

// the region summaries: the per-region files if the folder has them, else the pre-0.229 blob split
// in memory (the same codec the app uses; the folder itself is not touched here)
const regionSources = [];
const regionFiles = RS.listRegionFiles(STATS);
if (regionFiles.length > 0) {
  for (const { name } of regionFiles) regionSources.push({ f: name, buf: fs.readFileSync(path.join(STATS, name)) });
} else if (fs.existsSync(path.join(STATS, RS.LEGACY))) {
  const by = RS.splitByRegion(JSON.parse(fs.readFileSync(path.join(STATS, RS.LEGACY), 'utf8')));
  for (const [r, list] of by) regionSources.push({ f: RS.regionFile(r), buf: Buffer.from(RS.encodeRegion(r, list)) });
  console.log(`  radar summary: the pre-0.229 blob split into ${by.size} region file(s) for the seed`);
} else {
  console.error('no radar summary in the stats folder — baseline NOT built.');
  process.exit(1);
}

const staged = [];
let total = 0;
const hash = crypto.createHash('sha1');
for (const item of [...ALLOW.map((f) => ({ f })), ...regionSources]) {
  const f = item.f;
  const src = path.join(STATS, f);
  if (!item.buf && !fs.existsSync(src)) {
    console.error(`missing from the stats folder: ${f} — baseline NOT built.`);
    process.exit(1);
  }
  let buf = item.buf ?? fs.readFileSync(src);
  if (f === 'theft-raids.ndjson') buf = impersonalRaids(buf);
  // a seed that does not parse would be copied to every new install
  if (RS.REGION_FILE.test(f)) {
    try { RS.decodeRegion(buf.toString('utf8')); } catch (e) {
      console.error(`${f} does not read as a region summary (${e.message}) — baseline NOT built.`);
      process.exit(1);
    }
  } else if (f.endsWith('.json')) {
    try { if (!Array.isArray(JSON.parse(buf.toString('utf8')))) throw new Error('not a list'); } catch (e) {
      console.error(`${f} does not read as JSON (${e.message}) — baseline NOT built.`);
      process.exit(1);
    }
  }
  const s = buf.toString('latin1');
  for (const re of FORBIDDEN) {
    if (re.test(s)) {
      console.error(`PERSONAL DATA in ${f} (${re}) — baseline NOT built.`);
      process.exit(1);
    }
  }
  hash.update(f).update(buf);
  staged.push({ f, buf });
  total += buf.length;
  console.log(`  ${f}  ${(buf.length / 1e6).toFixed(1)}MB  clean`);
}

// nothing is touched until every file has passed
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const { f, buf } of staged) fs.writeFileSync(path.join(OUT, f), buf);
const stamp = { id: hash.digest('hex').slice(0, 16), builtAt: new Date().toISOString(), files: Object.fromEntries(staged.map(({ f, buf }) => [f, buf.length])) };
fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify(stamp));
console.log(`baseline/ ready — ${(total / 1e6).toFixed(0)}MB raw, stamp ${stamp.id} (LZMA squeezes JSON hard in the installer)`);
