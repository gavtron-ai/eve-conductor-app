// SHAREABILITY GUARD — refuses to let a build carrying personal data be
// mistaken for one that is safe to hand out.
//
// The owner asked for exactly one thing: "no stuff related to my data makes
// it into the files that I would share." Getting that right once is easy;
// keeping it right across every future change is not, which is what this is
// for. It reads the BUILT OUTPUT — not the source — because the built output
// is what actually ships.
//
//   node scripts/check-shareable.mjs            # check dist/
//   node scripts/check-shareable.mjs release    # also check the packaged app
//
// Exit code 1 = do not share this build.
import fs from 'node:fs';
import path from 'node:path';
import { loadOwnerPatterns, PATTERNS_PATH } from './ownerPatterns.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');

/**
 * Things that must never appear in a build meant for other people. The list
 * itself IS personal data, so it lives in a GITIGNORED local file
 * (owner-patterns.local.json) — the public source release carries this
 * mechanism with no patterns, and every operator supplies their own.
 *
 * With no local file the guard passes with a loud notice: a non-owner
 * building from source has nothing of theirs compiled in to find. On the
 * owner's machine the file exists and the full list is enforced; the
 * owner-only distribution scripts (share/publish/baseline) REQUIRE it.
 */
const FORBIDDEN = loadOwnerPatterns();
if (FORBIDDEN === null) {
  if (process.argv.includes('--require-owner-patterns')) {
    console.error(`No ${path.basename(PATTERNS_PATH)} — distribution scripts refuse to run unguarded.`);
    console.error('Create it (format in scripts/ownerPatterns.mjs) listing YOUR personal strings.');
    process.exit(1);
  }
  console.log('NOTE: no owner-patterns.local.json — nothing personal to scan for.');
  console.log('      (Fine for a non-owner build. To guard your own data, create it —');
  console.log('       see scripts/ownerPatterns.mjs for the format.)');
  process.exit(0);
}

/**
 * Files worth scanning.
 *
 * `.exe` IS DELIBERATELY EXCLUDED. An NSIS installer LZMA-compresses its
 * payload, so a string search over it finds nothing even when the string is
 * definitely inside — the first version of this check scanned installers and
 * happily reported a personal build as clean. A guard that cannot fail is
 * worse than no guard.
 *
 * What IS meaningful: `dist/` (the renderer bundle that goes in) and any
 * `app.asar` (the packed-but-uncompressed application), which is exactly
 * where the earlier real hit was found.
 */
const SCANNABLE = /(\.(js|mjs|cjs|css|html|json|txt|map|ndjson)$|app\.asar$)/i;
/** never scan the bundled EVE data — it is public CCP data and enormous */
const SKIP_DIR = /(^|[/\\])(node_modules|\.git|data)([/\\]|$)/;

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIR.test(full)) continue;
      yield* walk(full);
    } else if (SCANNABLE.test(e.name)) {
      yield full;
    }
  }
}

function scan(dir, label) {
  if (!fs.existsSync(dir)) {
    console.log(`  (${label} not present — skipped)`);
    return [];
  }
  const hits = [];
  let files = 0;
  for (const file of walk(dir)) {
    files++;
    // READ IT BOTH WAYS. A latin1 read walks raw bytes (which is what finds
    // strings inside a packed .asar), but it MANGLES multi-byte UTF-8 — the
    // first version of this check silently missed the owner's ship name
    // because "❤" is three bytes. A guard with a false negative is worse
    // than no guard, so both encodings are searched and either one counts.
    let utf8 = '';
    let bytes = '';
    try {
      const buf = fs.readFileSync(file);
      utf8 = buf.toString('utf8');
      bytes = buf.toString('latin1');
    } catch {
      continue;
    }
    for (const f of FORBIDDEN) {
      if (f.pattern.test(utf8) || f.pattern.test(bytes)) {
        hits.push({ file: path.relative(ROOT, file), label: f.label });
      }
    }
  }
  console.log(`  scanned ${files} file(s) in ${label}`);
  return hits;
}

const alsoRelease = process.argv.includes('release');
console.log('Shareability check — looking for owner data in the BUILT output');
const hits = [
  ...scan(path.join(ROOT, 'dist'), 'dist/'),
  // the UNPACKED payload is what can actually be searched (see SCANNABLE)
  ...(alsoRelease ? scan(path.join(ROOT, 'release', 'win-unpacked'), 'release/win-unpacked/') : []),
  ...(alsoRelease ? scan(path.join(ROOT, 'release', 'win-arm64-unpacked'), 'release/win-arm64-unpacked/') : []),
];

// EVERYTHING ELSE IN release/ IS UNCHECKED AND ALMOST CERTAINLY PERSONAL.
// Every installer built before the multi-user change has the owner's EVE
// application, ship name and corporation map compiled into it. Saying
// "CLEAN" while sixty of those sit in the same folder would be a lie of
// omission, so the count is always reported.
const releaseDir = path.join(ROOT, 'release');
let strays = 0;
if (fs.existsSync(releaseDir)) {
  for (const e of fs.readdirSync(releaseDir, { withFileTypes: true })) {
    if (e.isFile() && /\.exe$/i.test(e.name)) strays++;
    if (e.isDirectory() && !e.name.startsWith('win-')) strays++;
  }
}

if (strays > 0) {
  console.log('');
  console.log(`NOTE: release/ also holds ${strays} older build artifact(s) that were NOT checked.`);
  console.log('      Builds before v0.60.35 had an EVE application, a ship name and a');
  console.log('      corporation map compiled in. Only the CURRENT build is anonymous.');
}

if (hits.length === 0) {
  console.log('');
  console.log('CLEAN — no owner-specific data in what was scanned. Safe to share.');
  console.log('Scanned: the renderer bundle and the unpacked application payload.');
  console.log('NOT scanned: the .exe installers themselves — NSIS compresses them, so a');
  console.log('string search over one proves nothing either way. They are built FROM the');
  console.log('payload above, which is why that is the thing checked.');
  if (!alsoRelease) {
    console.log('(run with "release" to check the unpacked payload too)');
  }
  process.exit(0);
}

console.log('');
console.log('DO NOT SHARE THIS BUILD. Found owner-specific data:');
const byLabel = new Map();
for (const h of hits) {
  if (!byLabel.has(h.label)) byLabel.set(h.label, new Set());
  byLabel.get(h.label).add(h.file);
}
for (const [label, files] of byLabel) {
  console.log(`  - ${label}`);
  for (const f of [...files].slice(0, 6)) console.log(`      ${f}`);
  if (files.size > 6) console.log(`      …and ${files.size - 6} more`);
}
console.log('');
console.log('This is what a PERSONAL build looks like (npm run build:mine).');
console.log('For a build to hand out, run: npm run build   — then re-run this check.');
process.exit(1);
