// windowState: does an off-screen restore get discarded?
const Module = require('module');
const orig = Module._load;
Module._load = function (req, ...rest) {
  if (req === 'electron') {
    return { screen: { getAllDisplays: () => global.__displays } };
  }
  return orig.call(this, req, ...rest);
};
const ws = require('../electron/windowState.cjs');
const fs = require('fs'), os = require('os'), path = require('path');
const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'ws-'));
fs.mkdirSync(path.join(docs, 'EVE Conductor'), { recursive: true });
const write = (o) => fs.writeFileSync(path.join(docs, 'EVE Conductor', 'window-state.json'), JSON.stringify(o));

let pass = 0, fail = 0;
const eq = (l, g, w) => { const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`); ok ? pass++ : fail++; };

global.__displays = [{ workArea: { x: 0, y: 0, width: 2560, height: 1400 } }];
eq('a nothing saved yet -> null', ws.usableBounds(docs), null);

write({ x: 100, y: 100, width: 1200, height: 800, maximized: false });
eq('b saved bounds on an attached display are restored',
  ws.usableBounds(docs), { x: 100, y: 100, width: 1200, height: 800, maximized: false });

// the second monitor is unplugged: x=3000 no longer exists
write({ x: 3000, y: 200, width: 1200, height: 800, maximized: false });
eq('c bounds on a monitor that is gone drop the POSITION but keep the size',
  ws.usableBounds(docs), { width: 1200, height: 800, maximized: false });

global.__displays = [{ workArea: { x: 0, y: 0, width: 2560, height: 1400 } },
                     { workArea: { x: 2560, y: 0, width: 2560, height: 1440 } }];
eq('d plug it back in and the position is usable again',
  ws.usableBounds(docs), { x: 3000, y: 200, width: 1200, height: 800, maximized: false });

// a window pushed almost entirely off the right edge cannot be grabbed
write({ x: 5100, y: 0, width: 1200, height: 800 });
eq('e a window with no grabbable title bar is rejected',
  ws.usableBounds(docs), { width: 1200, height: 800, maximized: false });

write({ nonsense: true });
eq('f a corrupt file is ignored rather than thrown', ws.usableBounds(docs), null);

fs.writeFileSync(path.join(docs, 'EVE Conductor', 'window-state.json'), '{not json');
eq('g and so is unparseable json', ws.usableBounds(docs), null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
