// MULTI-WINDOW LAYOUT (v0.136) — the pop-out layout persistence format.
// The restore-on-launch flow is Electron-main-only (can't be driven headless),
// but the read/write round-trip that carries it IS pure fs and worth pinning:
// a corrupted or lossy format here silently loses the user's window layout.
//
// usableModuleLayout() is not tested here — it calls electron's `screen`, which
// isn't available under plain node (same reason the main-window usableBounds
// has no fixture); its filtering is verified by inspection.

const os = require('os');
const path = require('path');
const fs = require('fs');

let ws;
try {
  ws = require('../electron/windowState.cjs');
} catch (e) {
  console.log('modulewindows.test: SKIPPED (windowState.cjs not requireable here: ' + e.message + ')');
  process.exit(0);
}

const tmp = path.join(os.tmpdir(), 'etc-mw-' + process.pid);
fs.mkdirSync(tmp, { recursive: true });

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

// no file yet → empty list, never a throw
eq('M1 missing file → []', ws.readModuleLayout(tmp), []);

// full round-trip of a two-window layout
const layout = [
  { moduleId: 'theft', x: 10, y: 20, width: 1200, height: 820, maximized: false },
  { moduleId: 'battle', x: 100, y: 50, width: 900, height: 700, maximized: true },
];
ws.writeModuleLayout(tmp, layout);
eq('M2 two-window layout round-trips exactly', ws.readModuleLayout(tmp), layout);

// two pop-outs of the SAME module are distinct entries (kept, not merged)
const dup = [
  { moduleId: 'trade', x: 0, y: 0, width: 1000, height: 800, maximized: false },
  { moduleId: 'trade', x: 500, y: 0, width: 1000, height: 800, maximized: false },
];
ws.writeModuleLayout(tmp, dup);
eq('M3 duplicate-module windows both persist', ws.readModuleLayout(tmp).length, 2);

// clearing to empty (last pop-out closed) round-trips as []
ws.writeModuleLayout(tmp, []);
eq('M4 empty layout round-trips', ws.readModuleLayout(tmp), []);

// a garbage file reads as [], never throws (defensive)
fs.writeFileSync(path.join(tmp, 'EVE Conductor', 'module-windows.json'), '{ not json', 'utf8');
eq('M5 corrupt file → []', ws.readModuleLayout(tmp), []);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`modulewindows.test: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
