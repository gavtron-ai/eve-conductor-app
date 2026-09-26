// THE GO-LIVE CHECK (v0.237.0, round-two P1)
//
//   npm run golive:check -- --ordinary --policy-reviewed --help-reviewed "trade, home"
//   npm run golive:check -- --emergency "why, one line" --policy-reviewed --help-reviewed "theft"
//
// Publishing is a decision, and until now the decision rested on a person reading logs — twice in
// one day a version was recorded as installed when its ship had failed. This script turns every
// value the app STATES about itself into a line that passes or fails, and `npm run publish:beta`
// refuses to run without a passing stamp from it: for this version, younger than 30 minutes, made
// with the same emergency decision. Nothing here talks to the network. The checks, in order:
//
//   1. the tree is committed and HEAD names this version; the newest release note is this version
//   2. `npm run check` is green — tsc, lint with no errors, every fixture, which since 0.234.0 and
//      0.237.0 includes the ones that hold the policy page's hosts, services and CADENCE numbers,
//      the security policy and the request meter to the code
//   3. both shareability guards (the source tree and the unpacked installer) with the owner's list
//   4. the installer, its blockmap and latest.yml exist for this version
//   5. a dry run of the public export: the exact file list that would leave, scanned, refused if a
//      path is on the never-list (LEARNINGS, CLAUDE.md, owner patterns, logs, builds, snapshots)
//   6. the installed app's own diagnostics, last 24 h: this version's ready line exists, warnings
//      and errors summarised by area, no security-policy refusal; an error refuses the release
//      unless --accept-errors "why" names it
//   7. the request meter's last daily line — what this copy asked of each service yesterday
//   8. the statements only a person can make: --policy-reviewed (RULES 22: the policy page was
//      re-read against this release), --help-reviewed "<modules>" (RULES 20: the changed modules'
//      help pages were re-read), and the emergency decision (RULES 23): --ordinary, or
//      --emergency "why" for "the app is harming someone or losing users' ISK" — never a feature
//   9. the stamp: release/golive-check-<version>.json — every row, when, which decision
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { signatureOf, commonName } from './signature.mjs';

const APP = path.resolve(import.meta.dirname, '..');
const REPO = path.resolve(APP, '..');
const version = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valueOf = (name) => { const i = args.indexOf(name); return i >= 0 ? (args[i + 1] ?? '') : null; };
const said = (v) => typeof v === 'string' && v.trim() !== '' && !v.startsWith('--');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

const rows = [];
let failed = 0;
const row = (name, ok, detail = '') => { rows.push({ name, ok, detail }); if (!ok) failed++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`); };
const note = (text) => console.log(`      ${text}`);
// a shell only for npm.cmd (a .cmd needs one); node and git are spawned directly — through a shell the
// space in "C:\Program Files\nodejs\node.exe" splits the command (the check's first run failed on it)
const sh = (cmd, cmdArgs, cwd = APP) => spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', shell: cmd === npm && process.platform === 'win32' });
const lastLines = (out, n) => out.split('\n').filter(Boolean).slice(-n).join(' | ').slice(0, 200);

console.log(`\nGO-LIVE CHECK — EVE Conductor v${version} — ${new Date().toISOString()}\n`);
let headHash = '';

// ---- 1. committed at this version
{
  const st = sh('git', ['status', '--porcelain'], REPO).stdout.trim();
  row('the tree is committed (nothing uncommitted, nothing untracked)', st === '', st === '' ? '' : `${st.split('\n').length} path(s): ${st.split('\n').slice(0, 3).map((l) => l.trim()).join(', ')}`);
  const head = sh('git', ['log', '-1', '--format=%s'], REPO).stdout.trim();
  headHash = sh('git', ['rev-parse', 'HEAD'], REPO).stdout.trim();
  row(`HEAD names v${version}`, head.startsWith(`v${version}`), `${headHash.slice(0, 7)} ${head.slice(0, 80)}`);
  const notes = fs.readFileSync(path.join(APP, 'src', 'help', 'releaseNotes.tsx'), 'utf8');
  const newest = /version: '([0-9.]+)'/.exec(notes)?.[1];
  row(`the newest release note is v${version}`, newest === version, `newest note ${newest}`);
}

// ---- 2. the check
{
  const t0 = Date.now();
  const r = sh(npm, ['run', 'check']);
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  const fixtures = /fixtures: (\d+) files, (\d+) passed, (\d+) failed/.exec(out);
  const lintErrors = /✖ \d+ problems? \((\d+) errors?/.exec(out)?.[1] ?? '0';
  row('npm run check — tsc, lint, every fixture', r.status === 0, `${fixtures ? `${fixtures[1]} files, ${fixtures[2]} passed, ${fixtures[3]} failed` : 'no fixture summary'}; lint errors ${lintErrors}; ${Math.round((Date.now() - t0) / 1000)} s`);
  if (r.status !== 0) for (const l of out.split('\n').filter((l) => /error TS|FAIL|NO SUMMARY|✖/.test(l)).slice(0, 12)) note(l.slice(0, 160));
}

// ---- 3. shareability, source and installer payload
for (const [label, extra] of [['the source tree', []], ['the unpacked installer', ['release']]]) {
  const r = sh(process.execPath, [path.join(APP, 'scripts', 'check-shareable.mjs'), ...extra, '--require-owner-patterns']);
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  row(`shareability guard over ${label}, with the owner's list`, r.status === 0 && /CLEAN/.test(out), r.status === 0 ? 'CLEAN' : lastLines(out, 2));
}

// ---- 4. the artefacts
{
  const rel = (f) => path.join(APP, 'release', f);
  const inst = rel(`EVE-Conductor-Setup-${version}.exe`);
  const ok = fs.existsSync(inst) && fs.existsSync(inst + '.blockmap') && fs.existsSync(rel('latest.yml')) && fs.readFileSync(rel('latest.yml'), 'utf8').includes(version);
  row('installer + blockmap + latest.yml for this version', ok, ok ? `${(fs.statSync(inst).size / 1048576).toFixed(1)} MB, built ${fs.statSync(inst).mtime.toISOString()}` : 'missing — run npm run ship');
}

// ---- 4a. the signature the local installer carries (2026-09-23, code signing). Informational here: the
// dev machine's build is unsigned by design; the SIGNED build is the CI one, and `publish:beta` refuses
// anything but a valid signature from build.win.publisherName once that is set (--from-ci).
{
  const pkg = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));
  const wanted = pkg.build?.win?.publisherName;
  const names = Array.isArray(wanted) ? wanted : wanted ? [wanted] : [];
  const inst = path.join(APP, 'release', `EVE-Conductor-Setup-${version}.exe`);
  const sig = fs.existsSync(inst) ? signatureOf(inst) : { status: 'missing', subject: '' };
  const cn = commonName(sig.subject);
  row(`installer signature, local build: ${sig.status}${cn ? ' — ' + cn : ''}`, true, names.length === 0 ? 'no publisherName configured — unsigned releases allowed while the SignPath application is pending' : `publish requires ${names.join(' | ')} — use --from-ci for the signed build`);
}

// ---- 4b. the third-party notices shipped in resources/ match the dependency tree (v0.238.0, R6)
{
  const r = sh(process.execPath, [path.join(APP, 'scripts', 'build-notices.mjs'), '--check']);
  row('THIRD-PARTY-NOTICES.txt matches the production dependency tree', r.status === 0, lastLines((r.stdout ?? '') + (r.stderr ?? ''), 1));
}

// ---- 5. the public export, dry
{
  const r = sh(process.execPath, [path.join(APP, 'scripts', 'export-public.mjs'), '--dry-run']);
  const out = (r.stdout ?? '') + (r.stderr ?? '');
  row('public export dry run — what would leave, scanned, none of it on the never-list', r.status === 0, lastLines(out, r.status === 0 ? 1 : 4));
}

// ---- 6. the installed app's own diagnostics, last 24 h
let lastPublished = null;
{
  const dir = path.join(os.homedir(), 'Documents', 'EVE Conductor Logs');
  const since = Date.now() - 24 * 3_600_000;
  const lines = [];
  try {
    // the last week of files: a copy installed days ago and left running is a better witness than a fresh
    // one, so its ready line may be older than the 24-hour census window (2026-09-26: three days running)
    for (const f of fs.readdirSync(dir).filter((x) => /^conductor-\d{4}-\d{2}-\d{2}\.log$/.test(x)).sort().slice(-7)) {
      lines.push(...fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean));
    }
  } catch { /* no log folder on this machine */ }
  const recent = lines.filter((l) => { const t = /"t":"([^"]+)"/.exec(l)?.[1]; return t && Date.parse(t) >= since; });
  // the NEWEST ready line of any version must be this version's — a later start of another version means
  // this build is not the one running
  const readyIdx = lines.map((l, i) => (l.includes('main process ready — EVE Conductor ') ? i : -1)).filter((i) => i >= 0);
  const lastReady = readyIdx.length ? readyIdx[readyIdx.length - 1] : -1;
  const ready = lastReady >= 0 && lines[lastReady].includes(`main process ready — EVE Conductor ${version}`);
  const readyLine = ready ? lines[lastReady] : '';
  const hoursRunning = ready ? Math.round((Date.now() - Date.parse(/"t":"([^"]+)"/.exec(readyLine)[1])) / 3_600_000) : 0;
  row(`the installed app runs v${version} (the newest ready line in the log)`, ready, ready ? `${readyLine.slice(6, 25)}, ${hoursRunning} h ago` : lastReady >= 0 ? `the newest start is ${/EVE Conductor ([0-9.]+)/.exec(lines[lastReady])?.[1]} — run npm run ship` : 'no ready line in the last week — run npm run ship');
  // judged on THIS build: the lines since its ready line. An older build's refusals and errors are
  // history (the first run of this check flagged 0.224.0's fourteen eval refusals against 0.237.0);
  // they are still listed below so the reader sees the day
  const thisBuild = ready ? lines.slice(lastReady) : recent;
  const isErr = (l) => l.includes('"level":"error"');
  const isCsp = (l) => l.includes('"area":"csp"');
  const byKey = new Map();
  for (const l of recent) {
    const m = /"level":"(warn|error)","area":"([^"]*)","msg":"([^"]{0,70})/.exec(l);
    if (!m) continue;
    const k = `${m[1]} · ${m[2]} · ${m[3].replace(/\d{3,}/g, 'N').replace(/pilot #\d+/g, 'pilot #n')}`;
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  const csp = thisBuild.filter(isCsp).length, csp24 = recent.filter(isCsp).length;
  row(`no security-policy refusal since v${version} started (${csp24} in the last 24 h)`, csp === 0, csp ? `${csp} refusal(s) — this build reached for something its policy forbids` : '');
  const errors = thisBuild.filter(isErr).length, errors24 = recent.filter(isErr).length;
  const accept = valueOf('--accept-errors');
  row(`no error lines since v${version} started (${errors}; ${errors24} in the last 24 h)`, errors === 0 || said(accept), errors && said(accept) ? `accepted: ${accept}` : errors ? 'read them below; --accept-errors "why" if they are understood' : '');
  if (byKey.size > 0) {
    note(`warnings and errors, last 24 h (${thisBuild.length} of ${recent.length} lines are this build's):`);
    for (const [k, n] of [...byKey.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) note(`  ${String(n).padStart(4)} × ${k}`);
  }
  // 7. the request meter's last daily line (the renderer writes it at the first request after UTC midnight)
  const daily = recent.filter((l) => l.includes('"area":"net"') && l.includes('requests on')).pop();
  note(`request meter: ${daily ? daily.replace(/^.*"msg":"/, '').replace(/"$/, '').slice(0, 220) : 'no daily line in the last 24 h (the meter closes a day at the first request after UTC midnight)'}`);
  const feed = recent.filter((l) => l.includes('"area":"updater"') && /feed offers ([0-9.]+)/.test(l)).pop();
  lastPublished = feed ? /feed offers ([0-9.]+)/.exec(feed)[1] : null;
  note(`the public feed offers: ${lastPublished ?? 'unknown (no updater line in the last 24 h)'}`);
}

// ---- 8. the statements only a person can make
{
  // what to re-read: the help and policy files touched since the version the feed offers
  const from = valueOf('--since') ?? lastPublished;
  const fromHash = from ? sh('git', ['log', '-1', '--format=%H', `--grep=^v${from.replace(/\./g, '\\.')}`], REPO).stdout.trim() : '';
  if (fromHash) {
    const changed = sh('git', ['diff', '--name-only', `${fromHash}..HEAD`, '--', 'app/src'], REPO).stdout.trim().split('\n').filter(Boolean);
    const help = changed.filter((p) => p.includes('/help/')).map((p) => path.basename(p));
    const comps = [...new Set(changed.filter((p) => p.includes('/components/')).map((p) => path.basename(p).replace(/\.tsx?$/, '')))];
    note(`since v${from}: ${changed.length} source files changed; help/policy files touched: ${help.join(', ') || 'none'}`);
    note(`components touched (re-read their help pages): ${comps.slice(0, 24).join(', ') || 'none'}${comps.length > 24 ? ` … +${comps.length - 24}` : ''}`);
  } else {
    note(`cannot diff against the last published version (${from ?? 'unknown'}) — pass --since <version>`);
  }
  const policy = flag('--policy-reviewed');
  row('RULES 22 — the policy page was re-read against this release: --policy-reviewed', policy, policy ? 'stated by the operator' : 'read src/help/policy.tsx against the diff, then pass --policy-reviewed');
  const help = valueOf('--help-reviewed');
  row('RULES 20 — the changed modules\' help was re-read: --help-reviewed "<modules>"', said(help), said(help) ? help : 'name the modules whose help pages you re-read');
  const emergency = valueOf('--emergency');
  const ordinary = flag('--ordinary');
  const decided = ordinary !== (emergency !== null) && (emergency === null || said(emergency));
  row('RULES 23 — emergency or ordinary, decided: --ordinary | --emergency "why"', decided, emergency !== null ? `EMERGENCY — every copy restarts by itself; reason shown to users: ${emergency}` : ordinary ? 'ordinary — a banner, installed at the next restart' : 'undecided: is the app harming someone or losing users\' ISK? If not, --ordinary');
}

// ---- 9. the stamp
const stampPath = path.join(APP, 'release', `golive-check-${version}.json`);
fs.mkdirSync(path.dirname(stampPath), { recursive: true });
const stamp = { version, at: new Date().toISOString(), head: headHash, passed: failed === 0, failed, emergency: valueOf('--emergency'), ordinary: flag('--ordinary'), helpReviewed: valueOf('--help-reviewed'), rows };
fs.writeFileSync(stampPath, JSON.stringify(stamp, null, 2));
console.log(`\n${failed === 0 ? `GO-LIVE CHECK PASSED — good for 6 hours on this commit: push, npm run export:source (tags the public repo; CI builds and signs), then npm run publish:beta -- --from-ci${stamp.emergency !== null ? ` --emergency "${stamp.emergency}"` : ''}` : `GO-LIVE CHECK FAILED — ${failed} check(s); nothing may be published`}\nstamp: ${path.relative(APP, stampPath)}`);
process.exit(failed === 0 ? 0 : 1);
