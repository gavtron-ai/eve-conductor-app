// PUBLIC SOURCE EXPORT (v0.191) — syncs a curated, scrubbed copy of the app
// tree into the public source repo. The corp asked for the code; this is
// how it leaves the building.
//
//   npm run export:source
//   npm run export:source -- --dry-run     (v0.237.0) list + scan what WOULD leave; touch nothing
//
// The allow/prune/never lists live in goliveRules.mjs, shared with the go-live check, which runs
// the dry run before anything is pushed.
//
// Layers of protection, in order:
//   1. ALLOWLIST — only the app tree exports. The private repo's docs
//      (LEARNINGS/, CLAUDE.md) never leave; neither do build outputs,
//      installers, the baked baseline, compiled test snapshots, scratch
//      files, or owner-patterns.local.json (the secrets list itself).
//   2. SCAN — every exported file is checked against the owner's full
//      personal-pattern list (REQUIRED here); one hit aborts the export.
//   3. FRESH HISTORY — the public repo receives sync commits authored by
//      the noreply identity; the private tree's history never leaves.
//
// The destination is a sibling checkout (../public-export, gitignored),
// cloned on first run. Re-running syncs: everything but .git is replaced.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadOwnerPatterns, PATTERNS_PATH } from './ownerPatterns.mjs';
import { ALLOW, PRUNE, exportFileList, forbidden } from './goliveRules.mjs';

const APP = path.resolve(import.meta.dirname, '..');
const DEST = path.resolve(APP, '..', 'public-export');
const REPO = 'gavtron-ai/eve-conductor-app';
const version = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;

const die = (m) => { console.error(m); process.exit(1); };

const patterns = loadOwnerPatterns();
if (patterns === null) die(`No ${PATTERNS_PATH} — the export refuses to run unscanned.`);

const scanText = (buf) => buf.toString('utf8') + buf.toString('latin1');

// DRY RUN (v0.237.0): the exact list that would leave, every file scanned, the never-list checked —
// and nothing cloned, wiped, copied, committed or pushed. This is what the go-live check runs.
if (process.argv.includes('--dry-run')) {
  const list = exportFileList(APP);
  const never = forbidden(list);
  const hits = [];
  for (const rel of list) {
    const text = scanText(fs.readFileSync(path.join(APP, rel)));
    for (const p of patterns) if (p.pattern.test(text)) hits.push(`${rel} :: ${p.label}`);
  }
  const by = (prefix) => list.filter((p) => p.startsWith(prefix)).length;
  if (never.length > 0) { console.error('ON THE NEVER-LIST — the export would be refused:'); for (const n of never) console.error('  ' + n); }
  if (hits.length > 0) { console.error('PERSONAL DATA IN THE EXPORT — the export would be refused:'); for (const h of hits) console.error('  ' + h); }
  if (never.length > 0 || hits.length > 0) process.exit(1);
  console.log(`dry run: ${list.length} files would leave (src ${by('src/')}, electron ${by('electron/')}, scripts ${by('scripts/')}, tests ${by('tests/')}, build ${by('build/')}) — scanned with ${patterns.length} owner patterns, clean, none on the never-list`);
  process.exit(0);
}

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.status !== 0) die(`${cmd} ${args.join(' ')} failed`);
};

// destination checkout
if (!fs.existsSync(path.join(DEST, '.git'))) {
  run('gh', ['repo', 'clone', REPO, DEST]);
}
// wipe everything but .git so deletions in the source propagate
for (const e of fs.readdirSync(DEST)) {
  if (e !== '.git') fs.rmSync(path.join(DEST, e), { recursive: true, force: true });
}

// copy + scan
let files = 0;
const bad = [];
const copy = (src, dst) => {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true });
    for (const e of fs.readdirSync(src)) {
      if (PRUNE.has(e) || e.startsWith('_')) continue;
      copy(path.join(src, e), path.join(dst, e));
    }
    return;
  }
  const buf = fs.readFileSync(src);
  const text = scanText(buf);
  for (const p of patterns) {
    if (p.pattern.test(text)) bad.push(`${path.relative(APP, src)} :: ${p.label}`);
  }
  fs.writeFileSync(dst, buf);
  files++;
};
for (const e of fs.readdirSync(APP)) {
  if (!ALLOW.has(e)) continue;
  copy(path.join(APP, e), path.join(DEST, e));
}
// the never-list, over what was actually copied (the same list the dry run checked)
const never = forbidden(exportFileList(APP));
if (never.length > 0) {
  console.error('ON THE NEVER-LIST — nothing was pushed:');
  for (const n of never) console.error('  ' + n);
  fs.rmSync(DEST, { recursive: true, force: true });
  process.exit(1);
}
fs.writeFileSync(path.join(DEST, '.gitignore'), [
  'node_modules/', 'dist/', 'release/', 'handout/', 'baseline/', '.sde-cache/',
  'tests/sim/', 'tests/pi/', 'scripts/owner-patterns.local.json', '*.log', '',
].join('\n'));

if (bad.length > 0) {
  console.error('PERSONAL DATA IN THE EXPORT — nothing was pushed:');
  for (const b of bad) console.error('  ' + b);
  fs.rmSync(DEST, { recursive: true, force: true }); // leave no scrubbed-but-dirty copy
  process.exit(1);
}
console.log(`copied + scanned ${files} file(s) — clean`);

// commit + push as the noreply identity (the private history never leaves)
const g = (args) => run('git', ['-c', 'user.name=gavtron-ai',
  '-c', 'user.email=gavtron-ai@users.noreply.github.com', ...args], DEST);
g(['add', '-A']);
const st = spawnSync('git', ['status', '--porcelain'], { cwd: DEST, encoding: 'utf8' });
if (st.stdout.trim() === '') {
  console.log('public repo already up to date.');
} else {
  g(['commit', '-m', `sync v${version}`]);
  g(['push', 'origin', 'HEAD:main']);
  console.log(`pushed: https://github.com/${REPO} (sync v${version})`);
}
// THE VERSION TAG (2026-09-23, code signing): it starts the public repository's windows-build workflow,
// whose (signed) artifact `npm run publish:beta -- --from-ci` publishes. Forced, so re-exporting the same
// version moves the tag to the newest sync and runs the build again.
g(['tag', '-f', `v${version}`]);
g(['push', '-f', 'origin', `refs/tags/v${version}`]);
console.log(`tagged v${version} — the windows-build workflow runs at https://github.com/${REPO}/actions`);
