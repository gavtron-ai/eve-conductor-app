// BASELINE BUILDER (v0.188) — collects the shareable measurement history
// into app/baseline/ for the installer to carry (build.extraResources).
//
//   npm run baseline     (run before a ship that should refresh the bake)
//
// STRICT ALLOWLIST — only impersonal, publicly-derived measurements:
//   radar-summary.json    per-item market rates measured from public books
//   radar-coverage.json   which regions/days the radar has covered
//   theft-raids.ndjson    skyhook raid history diffed from CCP's public feed
// Never: wallets, ledgers, orders, trend events, fits, wip state, raw
// archives. Every file is scanned for personal patterns before copying —
// a hit refuses the whole build.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadOwnerPatterns, PATTERNS_PATH } from './ownerPatterns.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const STATS = path.join(os.homedir(), 'Documents', 'EVE Conductor Stats (Do Not Delete)');
const OUT = path.join(ROOT, 'baseline');

const ALLOW = ['radar-summary.json', 'radar-coverage.json', 'theft-raids.ndjson'];
// the owner's personal patterns come from the GITIGNORED local file —
// baking a baseline is an owner act, so the file is REQUIRED here
const loaded = loadOwnerPatterns();
if (loaded === null) {
  console.error(`No ${PATTERNS_PATH} — a baseline must be scanned against YOUR personal patterns.`);
  console.error('Create it first (format in scripts/ownerPatterns.mjs).');
  process.exit(1);
}
const FORBIDDEN = loaded.map((p) => p.pattern);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

let total = 0;
for (const f of ALLOW) {
  const src = path.join(STATS, f);
  if (!fs.existsSync(src)) {
    console.error(`missing from the stats folder: ${f} — baseline NOT built.`);
    process.exit(1);
  }
  const buf = fs.readFileSync(src);
  const s = buf.toString('latin1');
  for (const re of FORBIDDEN) {
    if (re.test(s)) {
      console.error(`PERSONAL DATA in ${f} (${re}) — baseline NOT built.`);
      fs.rmSync(OUT, { recursive: true, force: true });
      process.exit(1);
    }
  }
  fs.writeFileSync(path.join(OUT, f), buf);
  total += buf.length;
  console.log(`  ${f}  ${(buf.length / 1e6).toFixed(1)}MB  clean`);
}
console.log(`baseline/ ready — ${(total / 1e6).toFixed(0)}MB raw (LZMA squeezes JSON hard in the installer)`);
