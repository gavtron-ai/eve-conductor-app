// THIRD-PARTY NOTICES (v0.238.0, round-two R6) — `node scripts/build-notices.mjs`, run by `npm run build`.
//
// The installed app carries Electron's and Chromium's licence files (electron-builder writes
// them) and nothing for the rest: React, zustand, protobufjs and electron-updater and their
// dependencies are MIT/ISC/BSD/Apache, and distribution must carry their notices. This script
// walks the PRODUCTION dependency closure (package.json "dependencies", transitively — the set
// electron-builder packs), and writes build/THIRD-PARTY-NOTICES.txt: for each package its name,
// version, licence and the licence text shipped in the package (or a line saying the package
// ships none). The fit engine (a wasm build of a Rust crate, MIT) and CCP's data notice are
// appended from the app's own constants. The file ships in resources/ (extraResources) and
// Help → About shows it. Output path and an optional --check flag (fail if the file would change)
// so the go-live check can hold it to the tree.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const APP = process.env.NOTICES_APP || path.resolve(import.meta.dirname, '..');
const outArg = process.argv.indexOf('--out');
const OUT = outArg >= 0 ? path.resolve(process.argv[outArg + 1]) : path.join(APP, 'build', 'THIRD-PARTY-NOTICES.txt');
const require = createRequire(path.join(APP, 'package.json'));
const app = JSON.parse(fs.readFileSync(path.join(APP, 'package.json'), 'utf8'));

const seen = new Map();
function walk(name) {
  if (seen.has(name)) return;
  let dir;
  try {
    dir = path.dirname(require.resolve(`${name}/package.json`));
  } catch {
    // packages whose "exports" hide package.json: look in node_modules directly
    const candidate = path.join(APP, 'node_modules', name);
    if (!fs.existsSync(path.join(candidate, 'package.json'))) { seen.set(name, { version: '?', license: '?', text: null, missing: true }); return; }
    dir = candidate;
  }
  const pk = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const licenseFile = fs.readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  const license = pk.license || (Array.isArray(pk.licenses) ? pk.licenses.map((l) => l.type).join(' / ') : '?');
  const author = typeof pk.author === 'string' ? pk.author : pk.author && pk.author.name ? pk.author.name : '';
  seen.set(name, { version: pk.version, license, author, homepage: pk.homepage || (pk.repository && (pk.repository.url || pk.repository)) || '', text: licenseFile ? fs.readFileSync(path.join(dir, licenseFile), 'utf8').replace(/\r\n/g, '\n').trim() : null });
  for (const d of Object.keys(pk.dependencies || {})) walk(d);
  for (const d of Object.keys(pk.optionalDependencies || {})) { try { walk(d); } catch { /* optional */ } }
}
for (const d of Object.keys(app.dependencies || {})) walk(d);

const rule = '='.repeat(78);
const lines = [];
lines.push(`THIRD-PARTY NOTICES — EVE Conductor ${app.version}`);
lines.push('');
lines.push('EVE Conductor is free and open source (MIT; see LICENSE). It is built on the');
lines.push('software below, distributed with the app under the licences stated. Electron and');
lines.push('Chromium carry their own files beside this one (LICENSE.electron.txt,');
lines.push('LICENSES.chromium.html).');
lines.push('');
lines.push(`Packages in the production dependency tree (${seen.size}):`);
for (const [name, i] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) lines.push(`  ${name}@${i.version}  ${i.license}`);
lines.push('');
for (const [name, i] of [...seen.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
  lines.push(rule);
  lines.push(`${name} ${i.version} — ${i.license}${i.author ? ` — ${i.author}` : ''}${i.homepage ? `\n${String(i.homepage).replace(/^git\+/, '').replace(/\.git$/, '')}` : ''}`);
  lines.push(rule);
  lines.push(i.text ?? `(the package ships no licence file; its package.json states "${i.license}")`);
  lines.push('');
}

// the fit engine (EVEShipFit's dogma-engine, vendored as wasm; its LICENSE file ships in the source tree
// and is shown on the Skill & Fit pane) and CCP's data notice
let engine = '';
try { engine = fs.readFileSync(path.join(APP, 'src', 'vendor', 'dogma-engine', 'LICENSE'), 'utf8').replace(/\r\n/g, '\n').trim(); } catch { engine = ''; }
if (engine) { lines.push(rule); lines.push('dogma-engine (EVEShipFit, https://github.com/EVEShipFit/dogma-engine) — compiled to WebAssembly — MIT'); lines.push(rule); lines.push(engine); lines.push(''); }
lines.push(rule);
lines.push('EVE Online data and images — CCP hf.');
lines.push(rule);
lines.push('EVE Online and the EVE logo are the registered trademarks of CCP hf. All rights are');
lines.push('reserved worldwide. All other trademarks are the property of their respective owners.');
lines.push('EVE Online, the EVE logo, EVE and all associated logos and designs are the');
lines.push('intellectual property of CCP hf. All artwork, screenshots, characters, vehicles,');
lines.push('storylines, world facts or other recognizable features of the intellectual property');
lines.push('relating to these trademarks are likewise the intellectual property of CCP hf. CCP hf.');
lines.push('has granted permission to EVE Conductor to use EVE Online and all associated logos and');
lines.push('designs for promotional and information purposes on its website but does not endorse,');
lines.push('and is not in any way affiliated with, EVE Conductor. CCP is in no way responsible for');
lines.push('the content on or functioning of this application, nor can it be liable for any damage');
lines.push('arising from the use of this application. Static data comes from CCP\'s Static Data');
lines.push('Export, mirrored by Fuzzwork; images from CCP\'s image service.');
lines.push('');

const text = lines.join('\n');
if (process.argv.includes('--check')) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== text) { console.error(`THIRD-PARTY-NOTICES.txt is stale — run: node scripts/build-notices.mjs`); process.exit(1); }
  console.log(`third-party notices: up to date (${seen.size} packages)`);
  process.exit(0);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
const missing = [...seen.entries()].filter(([, i]) => !i.text).map(([n]) => n);
console.log(`third-party notices: ${seen.size} packages → ${path.relative(APP, OUT)} (${(text.length / 1024).toFixed(0)} KB)${missing.length ? `; no licence file in: ${missing.join(', ')}` : ''}`);
