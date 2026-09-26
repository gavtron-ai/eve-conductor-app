// REPAIR THE UPDATE FEED AFTER SIGNING (2026-09-23, code signing) — `node scripts/repair-feed.mjs [release-dir]`
//
// electron-builder writes latest.yml (the installer's sha512 and size) and the .blockmap
// (differential updates) from the installer's bytes at build time. Signing the installer afterwards
// — which is how the SignPath Foundation signs: the finished file, in their pipeline — changes the
// bytes, so electron-updater would reject the download as corrupt ("sha512 checksum mismatch") and
// the blockmap would describe the unsigned file. This script recomputes both from the installer as
// it is NOW, using electron-builder's own blockmap builder so the result is byte-for-byte what a
// build would have produced for these bytes. Every other line of latest.yml is left as it is.
//
// Idempotent: run on an unsigned build it changes nothing but the blockmap file's timestamp.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap.js');

/** PURE: latest.yml with the installer's sha512 and size replaced, everything else untouched */
export function patchLatestYml(text, fileName, sha512, size) {
  const lines = text.split('\n');
  let inFile = false, touched = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*-\s*url:\s*(.+)$/.test(l)) inFile = l.trim().endsWith(fileName);
    else if (/^[a-zA-Z]/.test(l)) inFile = false; // a top-level key ends the file entry
    if (inFile && /^\s+sha512:/.test(l)) { lines[i] = l.replace(/sha512:.*$/, `sha512: ${sha512}`); touched++; }
    if (inFile && /^\s+size:/.test(l)) { lines[i] = l.replace(/size:.*$/, `size: ${size}`); touched++; }
    if (/^sha512:/.test(l)) { lines[i] = `sha512: ${sha512}`; touched++; }
  }
  return { text: lines.join('\n'), touched };
}

/** the blockmap builder, re-exported so a fixture can measure it on a file of its own */
export { buildBlockMap };

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const dir = path.resolve(APP, process.argv[2] ?? 'release');
  const version = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8')).version;
  const installer = path.join(dir, `EVE-Conductor-Setup-${version}.exe`);
  const latestYml = path.join(dir, 'latest.yml');
  const die = (m) => { console.error(m); process.exit(1); };
  if (!fs.existsSync(installer)) die(`no installer at ${installer}`);
  if (!fs.existsSync(latestYml)) die(`no latest.yml at ${latestYml}`);
  const before = fs.readFileSync(latestYml, 'utf8');
  const oldSha = /^sha512: (.+)$/m.exec(before)?.[1] ?? '';
  const info = await buildBlockMap(installer, 'gzip', installer + '.blockmap');
  const { text, touched } = patchLatestYml(before, path.basename(installer), info.sha512, info.size);
  if (touched !== 3) die(`expected to touch 3 lines of latest.yml (files.sha512, files.size, sha512), touched ${touched} — the file's shape changed; nothing written`);
  fs.writeFileSync(latestYml, text);
  console.log(`feed repaired for ${path.basename(installer)}: size ${info.size}, blockmap ${fs.statSync(installer + '.blockmap').size} bytes, sha512 ${info.sha512.slice(0, 12)}… (${oldSha === info.sha512 ? 'unchanged — the file was not re-signed' : 'was ' + oldSha.slice(0, 12) + '…'})`);
}
