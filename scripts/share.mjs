// HANDOUT BUILDER (v0.186, beta prep) — makes sharing un-fumbleable.
//
// release/ holds YEARS of installers, and every one built before v0.60.35
// has the owner's EVE application, ship name and corporation map compiled
// in. Grabbing a file from that folder to paste into Discord is exactly the
// mistake this script exists to prevent: it re-runs the shareability guard
// against the CURRENT unpacked payload, then copies ONLY the current
// version's installer into a clean handout/ folder (outside release/, so
// the guard's stray-artifact warning never counts our own output) together
// with a recipient README.
//
//   npm run share      (after npm run ship — it does not build anything)
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const version = pkg.version;

const installer = path.join(ROOT, 'release', `EVE-Conductor-Setup-${version}.exe`);
if (!fs.existsSync(installer)) {
  console.error(`No installer for the CURRENT version (${version}).`);
  console.error(`Expected: ${installer}`);
  console.error('Run "npm run ship" first, then "npm run share".');
  process.exit(1);
}

// the guard is the gate: a personal build must never reach the handout dir
console.log('Re-running the shareability guard against the unpacked payload…');
const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-shareable.mjs'), 'release', '--require-owner-patterns'], {
  stdio: 'inherit',
});
if (check.status !== 0) {
  console.error('');
  console.error('Shareability guard REFUSED this build — nothing was copied.');
  process.exit(1);
}

const outDir = path.join(ROOT, 'handout', `EVE-Conductor-v${version}`);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
fs.copyFileSync(installer, path.join(outDir, path.basename(installer)));

const readme = `EVE CONDUCTOR — beta v${version}
================================

Thanks for testing! Setup takes about two minutes, and the app walks you
through all of it on first run.

1) INSTALL
   Run "EVE-Conductor-Setup-${version}.exe".
   Windows will warn "Windows protected your PC" because this beta is not
   code-signed yet. Click "More info", then "Run anyway". That warning is
   about the missing signature, not about what the app does.

2) FIRST RUN — the tour opens automatically and covers:
   - registering your own free EVE application (about a minute; Settings
     has copy buttons for the two values you need, and there is no secret
     key involved)
   - logging in your characters on EVE's own login page (the app never
     sees your password; logins stay on your machine)
   - ticking what each character does — all of it changeable later

3) HELP
   Every module has an "i" button in the top bar with a full how-to for
   the tab you are on; panels carry their own small "i" notes. The welcome
   tour can be replayed from the footer of any guide.

WHERE YOUR DATA LIVES (all under your own Documents folder)
   Documents\\EVE Conductor        — your settings; yours to back up
   Documents\\EVE Conductor Logs   — diagnostics; safe to delete
   Documents\\EVE Conductor Stats (Do Not Delete)
        — your long-term market/theft history. Deleting it loses measured
          data the app cannot re-create.

FOUND A BUG?
   Settings (gear icon) -> Diagnostics -> "Copy bug report", and paste
   what it copied. It contains the app version, your OS, which screen you
   were on, team counts (never character names) and the recent app log —
   no EVE tokens, ever.

UPDATES
   The beta updates often. New installers install right over the old
   version — your settings, logins and history all survive updates and
   reinstalls.

OPTIONAL
   The AI battle write-up feature needs your own Anthropic API key in
   Documents\\EVE Conductor\\anthropic.json. Skip it unless you want it —
   everything else works without it.
`;
fs.writeFileSync(path.join(outDir, 'README.txt'), readme);

console.log('');
console.log(`Handout folder ready: ${outDir}`);
console.log('  - ' + path.basename(installer));
console.log('  - README.txt');
console.log('');
console.log('Share ONLY this folder. Never share files straight out of release/.');
