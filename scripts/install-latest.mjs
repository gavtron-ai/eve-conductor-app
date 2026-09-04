// BUILD, THEN ACTUALLY INSTALL IT — Windows.
//
// The user runs this app all day and does not want to hunt for an installer
// after every change. This runs the freshly built NSIS setup silently, then
// puts the app back up, because it is a 24/7 collector: the installer closes
// it and does NOT relaunch, so stopping there would silently take the radar,
// trend watcher and wallet ledger offline until someone noticed.
//
//   node scripts/install-latest.mjs
//
// It refuses to install anything but the version in package.json, so a stale
// installer left in release/ can never be the thing that lands.
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = pkg.version;

if (process.platform !== 'win32') {
  console.log(`Not Windows (${process.platform}) — nothing to install. Build output is in release/.`);
  process.exit(0);
}

const setup = path.join(ROOT, 'release', `EVE-Conductor-Setup-${VERSION}.exe`);
if (!fs.existsSync(setup)) {
  console.error(`No installer for the CURRENT version.`);
  console.error(`  expected: ${setup}`);
  console.error(`  build it first:  npm run dist:win`);
  process.exit(1);
}

const INSTALL_ROOT = path.join(
  process.env.LOCALAPPDATA ?? '', 'Programs', 'EVE Trade Conductor', 'EVE Conductor',
);
const INSTALLED_EXE = path.join(INSTALL_ROOT, 'EVE Conductor.exe');

/** the version currently installed, or null when nothing is */
function installedVersion() {
  if (!fs.existsSync(INSTALLED_EXE)) return null;
  try {
    return execFileSync('powershell', [
      '-NoProfile', '-Command',
      `(Get-Item '${INSTALLED_EXE.replace(/'/g, "''")}').VersionInfo.ProductVersion`,
    ], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

const wasRunning = (() => {
  try {
    const out = execFileSync('powershell', [
      '-NoProfile', '-Command',
      "(Get-Process -Name 'EVE Conductor' -ErrorAction SilentlyContinue | Measure-Object).Count",
    ], { encoding: 'utf8' }).trim();
    return Number(out) > 0;
  } catch {
    return false;
  }
})();

console.log(`Installing EVE Conductor ${VERSION}`);
console.log(`  from:  ${path.relative(ROOT, setup)}`);
console.log(`  was:   ${installedVersion() ?? '(nothing installed)'}`);
if (wasRunning) {
  console.log('  NOTE:  the app is running — the installer will close it, and this');
  console.log('         script relaunches it afterwards so the collectors resume.');
}

try {
  // /S = NSIS silent. electron-builder's installer closes a running instance.
  execFileSync(setup, ['/S'], { stdio: 'inherit' });
} catch (e) {
  console.error(`Installer failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
}

const now = installedVersion();
if (now === null || !now.startsWith(VERSION)) {
  console.error(`Install did not take: expected ${VERSION}, found ${now ?? 'nothing'}.`);
  process.exit(1);
}
console.log(`  now:   ${now}  ✓`);

// PUT IT BACK UP — OUTSIDE THIS PROCESS TREE. spawn() here made the app a
// descendant of whatever ran the ship (Claude's desktop app, a terminal…),
// and on Windows the child inherits inheritable HANDLES from that whole
// tree. Measured consequence (2026-08-17): after a Claude crash, Claude
// could not restart — "another application is using that file" — until
// EVE Conductor, its accidental grandchild holding inherited handles on
// Claude's own files, was quit by hand. WMI's Win32_Process.Create spawns
// under the WMI service host instead: no inherited handles, no parent, a
// process that belongs to nobody but the user.
try {
  execFileSync('powershell', [
    '-NoProfile', '-Command',
    `Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = '"${INSTALLED_EXE}"'; CurrentDirectory = '${path.dirname(INSTALLED_EXE)}' } | Out-Null`,
  ], { stdio: 'inherit' });
  console.log('  relaunched (detached via WMI — outside this process tree).');
} catch {
  // WMI refused (hardened box?) — the old way still beats a dead collector
  const child = spawn(INSTALLED_EXE, [], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log('  relaunched (WMI unavailable — direct spawn fallback).');
}
