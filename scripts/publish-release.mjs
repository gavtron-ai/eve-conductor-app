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
//   4. `gh release create vX.Y.Z` on eve-conductor-releases with the
//      installer + blockmap + latest.yml — auth comes from the gh CLI,
//      so no token is ever stored in this repo or the app
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import updatePolicy from '../electron/updatePolicy.cjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const REPO = 'gavtron-ai/eve-conductor-releases';
const rel = (f) => path.join(ROOT, 'release', f);

const installer = rel(`EVE-Conductor-Setup-${version}.exe`);
const blockmap = installer + '.blockmap';
const latestYml = rel('latest.yml');

const die = (msg) => { console.error(msg); process.exit(1); };

if (!fs.existsSync(installer)) die(`No installer for v${version} — run "npm run ship" first.\nExpected: ${installer}`);

console.log(`Publishing EVE Conductor v${version} to ${REPO}`);
console.log('Re-running the FULL shareability guard…');
const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-shareable.mjs'), 'release', '--require-owner-patterns'], { stdio: 'inherit' });
if (check.status !== 0) die('\nShareability guard REFUSED this build — nothing was published.');

if (!fs.existsSync(latestYml)) die('release/latest.yml is missing — the updater feed cannot be built. Re-run "npm run ship" (build.publish must be configured).');
const yml = fs.readFileSync(latestYml, 'utf8');
if (!yml.includes(version)) die(`release/latest.yml does not mention v${version} — it is from an older build. Re-run "npm run ship".`);
if (!fs.existsSync(blockmap)) die(`Missing ${path.basename(blockmap)} — differential updates need it. Re-run "npm run ship".`);

// emergency or not — written into the feed file, and said out loud
const ei = process.argv.indexOf('--emergency');
const emergencyReason = ei >= 0 ? (process.argv[ei + 1] ?? '') : null;
if (emergencyReason !== null && (!emergencyReason.trim() || emergencyReason.startsWith('--'))) die('--emergency needs a reason in quotes: it is shown to every user before their app restarts.');
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
console.log('Installed copies will pick it up on their next check (startup + every 4h).');
