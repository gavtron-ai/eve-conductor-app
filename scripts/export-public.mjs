// PUBLIC SOURCE EXPORT (v0.191) — syncs a curated, scrubbed copy of the app
// tree into the public source repo. The corp asked for the code; this is
// how it leaves the building.
//
//   npm run export:source
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

const APP = path.resolve(import.meta.dirname, '..');
const DEST = path.resolve(APP, '..', 'public-export');
const REPO = 'gavtron-ai/eve-conductor-app';
const version = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;

const die = (m) => { console.error(m); process.exit(1); };

const patterns = loadOwnerPatterns();
if (patterns === null) die(`No ${PATTERNS_PATH} — the export refuses to run unscanned.`);

/** top-level entries of app/ that export */
const ALLOW = new Set([
  'src', 'electron', 'scripts', 'tests', 'build',
  'index.html', 'package.json', 'package-lock.json', 'tsconfig.json',
  'vite.config.ts', 'README.md', 'LICENSE',
]);
/** subtrees pruned wherever they appear */
const PRUNE = new Set([
  'node_modules', 'dist', 'release', 'handout', 'baseline', '.sde-cache',
  '.claude', 'sim', 'pi', 'led', 'r3', 'sch',   // tests/*: compiled snapshots
  'owner-patterns.local.json',
]);

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
  const text = buf.toString('utf8') + buf.toString('latin1');
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
