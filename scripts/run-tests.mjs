// THE FIXTURE SUITE, AS ONE COMMAND (v0.222.0, audit F4) — `npm test`.
//
// Compiles src/lib to tests/sim (the fixtures run the REAL library code, compiled to CommonJS),
// then runs every tests/*.test.cjs and reads each one's "N passed, M failed" line. Any failure,
// any file without a summary line, or any file that dies → exit 1. This is what `npm run check`
// and the CI workflow run; `npm run ship` refuses to build without it.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(import.meta.dirname, '..');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

// 1. compile the libraries the fixtures drive (tsc reports two known, harmless errors here — a
//    worker's ?url import and a .tsx reach — and still emits; the fixtures decide, not tsc)
const libs = fs.readdirSync(path.join(APP, 'src', 'lib')).filter((f) => f.endsWith('.ts')).map((f) => path.join('src', 'lib', f));
const tsc = spawnSync(npx, ['tsc', ...libs, '--outDir', 'tests/sim', '--module', 'commonjs', '--target', 'es2020', '--skipLibCheck', '--moduleResolution', 'node', '--resolveJsonModule', '--esModuleInterop'], { cwd: APP, encoding: 'utf8', shell: process.platform === 'win32' });
if (!fs.existsSync(path.join(APP, 'tests', 'sim', 'lib'))) {
  console.error('the fixture compile produced nothing:\n' + (tsc.stdout || '') + (tsc.stderr || ''));
  process.exit(1);
}

// 2. run every fixture file
const files = fs.readdirSync(path.join(APP, 'tests')).filter((f) => f.endsWith('.test.cjs')).sort();
let passed = 0, failed = 0, broken = 0;
const rows = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join('tests', f)], { cwd: APP, encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const m = [...out.matchAll(/(\d+) passed, (\d+) failed/g)].pop();
  if (!m) { broken++; rows.push(`  ${f.padEnd(28)} NO SUMMARY (exit ${r.status})\n${out.split('\n').filter(Boolean).slice(-6).map((l) => '      ' + l.slice(0, 160)).join('\n')}`); continue; }
  const p = Number(m[1]), q = Number(m[2]);
  passed += p; failed += q;
  if (q > 0 || r.status !== 0) rows.push(`  ${f.padEnd(28)} ${p} passed, ${q} failed${r.status !== 0 ? ` (exit ${r.status})` : ''}\n${out.split('\n').filter((l) => /FAIL/.test(l)).slice(0, 8).map((l) => '      ' + l.slice(0, 160)).join('\n')}`);
}
if (rows.length > 0) console.log(rows.join('\n'));
console.log(`fixtures: ${files.length} files, ${passed} passed, ${failed} failed${broken ? `, ${broken} without a summary` : ''}`);
process.exit(failed > 0 || broken > 0 ? 1 : 0);
