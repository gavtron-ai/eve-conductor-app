// PUBLISH A BETA (v0.187) — puts the CURRENT version on the public
// releases repo so every installed copy self-updates to it.
//
//   npm run publish:beta        (run AFTER npm run ship)
//
// Deliberately NOT part of `npm run ship`: shipping to this machine is a
// per-change ritual; publishing to the corp is a decision. The flow:
//
//   1. the current version's installer must already exist (ship built it)
//   2. the FULL shareability guard re-checks the unpacked payload —
//      a personal build can never be published
//   3. latest.yml must exist and name this exact installer (electron-
//      builder generates it because build.publish is configured; the
//      updater on corp machines reads it to find updates)
//   3b. EMERGENCY OR NOT (v0.217.0) — the owner's call at every go-live:
//          npm run publish:beta                                  an ordinary update: a banner,
//                                                                installed when the user restarts
//          npm run publish:beta -- --emergency "why, one line"   installs BY ITSELF on every copy
//                                                                (0.217.0+) after a 1-minute warning
//      The marker is two fields in latest.yml (electron/updatePolicy.cjs). Without the flag any
//      marker left in the file by an earlier run is REMOVED, so an emergency is never inherited.
//   0. THE GO-LIVE STAMP (v0.237.0, round-two P1): `npm run golive:check` must have PASSED for
//      this exact version less than 30 minutes ago, run with the same emergency decision as this
//      publish. The stamp (release/golive-check-<version>.json) is the machine's record that the
//      check was green, the tree committed at the version, both shareability guards clean, the
//      export dry run clean, the installed app's log clean, and the policy page and the changed
//      help re-read. No stamp, no publish — there is no flag to skip it.
//   4. `gh release create vX.Y.Z` on eve-conductor-releases with the
//      installer + blockmap + latest.yml — auth comes from the gh CLI,
//      so no token is ever stored in this repo or the app
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import updatePolicy from '../electron/updatePolicy.cjs';
import { stampVerdict } from './goliveRules.mjs';
import { signatureOf, commonName } from './signature.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;
const REPO = 'gavtron-ai/eve-conductor-releases';
/** the public source repository, whose windows-build workflow makes the signed build */
const SOURCE_REPO = 'gavtron-ai/eve-conductor-app';

const die = (msg) => { console.error(msg); process.exit(1); };

// FROM CI (2026-09-23, code signing): `--from-ci [run-id]` takes the installer, blockmap and latest.yml from
// the windows-build workflow run for this version's tag on the PUBLIC repository — the build SignPath
// signed — instead of release/ on this machine. Once build.win.publisherName is set this is the only way
// to publish: a local build is unsigned, and a copy that verifies updates would refuse it.
const ciAt = process.argv.indexOf('--from-ci');
const fromCi = ciAt >= 0;
let relDir = path.join(ROOT, 'release');
if (fromCi) {
  const given = process.argv[ciAt + 1];
  let runId = given && !given.startsWith('--') ? given : null;
  if (!runId) {
    const list = spawnSync('gh', ['run', 'list', '--repo', SOURCE_REPO, '--workflow', 'windows-build.yml', '--branch', `v${version}`, '--json', 'databaseId,status,conclusion,createdAt', '--limit', '5'], { encoding: 'utf8' });
    let runs = [];
    try { runs = JSON.parse(list.stdout || '[]'); } catch { runs = []; }
    const ok = runs.find((r) => r.status === 'completed' && r.conclusion === 'success');
    if (!ok) die(`No successful windows-build run for tag v${version} on ${SOURCE_REPO} (${runs.length ? runs.map((r) => `${r.databaseId} ${r.status}/${r.conclusion}`).join(', ') : 'no run seen'}).\nExport first (npm run export:source pushes the tag), approve the signing requests in SignPath, wait for the run, then publish.`);
    runId = String(ok.databaseId);
  }
  relDir = path.join(ROOT, 'release', 'ci', version);
  fs.rmSync(relDir, { recursive: true, force: true });
  fs.mkdirSync(relDir, { recursive: true });
  const dl = spawnSync('gh', ['run', 'download', runId, '--repo', SOURCE_REPO, '-n', 'windows-installer', '-D', relDir], { stdio: 'inherit' });
  if (dl.status !== 0) die(`gh run download ${runId} failed — nothing was published.`);
  console.log(`CI build: ${SOURCE_REPO} run ${runId} → ${path.relative(ROOT, relDir)}`);
}
const rel = (f) => path.join(relDir, f);

const installer = rel(`EVE-Conductor-Setup-${version}.exe`);
const blockmap = installer + '.blockmap';
const latestYml = rel('latest.yml');

if (!fs.existsSync(installer)) die(`No installer for v${version} — ${fromCi ? 'the CI run carried none' : 'run "npm run ship" first'}.\nExpected: ${installer}`);

// THE SIGNATURE (2026-09-23): once build.win.publisherName names the certificate the app verifies updates
// against, an installer that is not validly signed by it is refused here — a copy that verifies would refuse
// it too, and every copy from then on would be stranded. Until then unsigned releases are allowed and said.
{
  const wanted = pkg.build?.win?.publisherName;
  const names = Array.isArray(wanted) ? wanted : wanted ? [wanted] : [];
  const sig = signatureOf(installer);
  const cn = commonName(sig.subject);
  if (names.length === 0) console.log(`installer signature: ${sig.status}${cn ? ' — ' + cn : ''} (no publisherName configured: unsigned releases allowed while the SignPath application is pending)`);
  else if (sig.status !== 'Valid' || !names.includes(cn)) die(`The installer is not validly signed by ${names.join(' | ')} (${sig.status}${cn ? ', ' + cn : ''}) — nothing was published.${fromCi ? '' : '\nPublish the signed CI build: npm run publish:beta -- --from-ci'}`);
  else console.log(`installer signature: Valid — ${cn}`);
}

// emergency or not — decided by the flag, checked against the stamp, written into the feed file below
const ei = process.argv.indexOf('--emergency');
const emergencyReason = ei >= 0 ? (process.argv[ei + 1] ?? '') : null;
if (emergencyReason !== null && (!emergencyReason.trim() || emergencyReason.startsWith('--'))) die('--emergency needs a reason in quotes: it is shown to every user before their app restarts.');

// 0. the go-live stamp
const stampPath = path.join(ROOT, 'release', `golive-check-${version}.json`);
let stamp = null;
try { stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8')); } catch { stamp = null; }
const head = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(ROOT, '..'), encoding: 'utf8' }).stdout.trim();
const verdict = stampVerdict(stamp, version, Date.now(), emergencyReason !== null, head);
if (!verdict.ok) die(`GO-LIVE CHECK: ${verdict.why}.\nRun it first:  npm run golive:check -- ${emergencyReason !== null ? '--emergency "<why>"' : '--ordinary'} --policy-reviewed --help-reviewed "<modules>"\nNothing was published.`);
console.log(`go-live check: passed (${verdict.why})`);

console.log(`Publishing EVE Conductor v${version} to ${REPO}`);
console.log('Re-running the FULL shareability guard…');
const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-shareable.mjs'), 'release', '--require-owner-patterns'], { stdio: 'inherit' });
if (check.status !== 0) die('\nShareability guard REFUSED this build — nothing was published.');

if (!fs.existsSync(latestYml)) die('release/latest.yml is missing — the updater feed cannot be built. Re-run "npm run ship" (build.publish must be configured).');
const yml = fs.readFileSync(latestYml, 'utf8');
if (!yml.includes(version)) die(`release/latest.yml does not mention v${version} — it is from an older build. Re-run "npm run ship".`);
if (!fs.existsSync(blockmap)) die(`Missing ${path.basename(blockmap)} — differential updates need it. Re-run "npm run ship".`);

// emergency or not — written into the feed file, and said out loud
fs.writeFileSync(latestYml, updatePolicy.withEmergencyMarker(yml, emergencyReason));
console.log(emergencyReason !== null
  ? `\n*** EMERGENCY RELEASE *** every installed copy (0.217.0+) will restart into v${version} by itself.\n    reason shown to users: ${emergencyReason.trim()}\n`
  : '\nordinary release — users get a banner and install it when they restart.\n');

const assets = [installer, blockmap, latestYml];
const args = [
  'release', 'create', `v${version}`,
  '--repo', REPO,
  '--title', `EVE Conductor ${version}${emergencyReason !== null ? ' (emergency update)' : ''}`,
  '--notes', `Beta build ${version}. Installed copies update themselves; new installs: run the setup exe (SmartScreen: "More info" → "Run anyway").`,
  ...assets,
];
console.log(`Creating release v${version} with ${assets.length} asset(s)…`);
// NO shell: true — the project path contains a space ("EVE TRADING") and a
// shell join splits the asset paths at it (measured: gh saw a glob and said
// "no matches found"). Windows resolves gh -> gh.exe via CreateProcess.
const res = spawnSync('gh', args, { stdio: 'inherit' });
if (res.status !== 0) die('gh release create failed — is gh authenticated? (gh auth status)');

console.log('');
console.log(`Published: https://github.com/${REPO}/releases/tag/v${version}`);
console.log('Installed copies will pick it up on their next check (at startup, then hourly on 0.217.0+, every 4 h on older copies).');
