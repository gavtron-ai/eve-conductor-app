// v0.226.0 (audit B4): the trading ledger lives in a file in the stats folder, not in localStorage.
// These fixtures drive the SHIPPED ledger.ts (compiled to sim/lib) against a fake file bridge and a
// fake localStorage: restore from the file; the one-time move out of localStorage (written, read
// back, only then removed); a move that fails keeps the old copy; a damaged file loads nothing and
// refuses every write; a write before the restore is refused; writes after it reach the file and
// coalesce; the dev-server fallback keeps using localStorage and survives a quota error; a pop-out
// never writes. Every refusal or failure must appear in the diagnostics log.
const path = require('path');
const LEDGER = path.join(__dirname, 'sim', 'lib', 'ledger.js');
const DEVLOG = path.join(__dirname, 'sim', 'lib', 'devlog.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const tick = () => new Promise((r) => setTimeout(r, 15));

const tx = (id, qty = 1) => ({ id, date: 1_700_000_000_000 + id, typeId: 34, qty, unitPrice: 5, locationId: 60003760, isBuy: true, charId: 1 });
const ledgerText = (ids, extra = {}) => JSON.stringify({ tx: ids.map((i) => tx(i)), fees: [], orderEvents: [], lastSync: 1, ...extra });

/** a fresh world: fake localStorage, fake file bridge (or none), a log capture, a fresh ledger module */
function world({ file = null, legacy = null, bridge = true, writeThrows = false, readThrows = false, setItemThrows = false } = {}) {
  const store = new Map();
  if (legacy !== null) store.set('etc-ledger-v1', legacy);
  global.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { if (setItemThrows) throw new Error('QuotaExceededError'); store.set(k, v); },
    removeItem: (k) => { store.delete(k); },
  };
  const files = new Map();
  if (file !== null) files.set('ledger-v1.json', file);
  const logged = [];
  const fakeBridge = {
    auxRead: async (name) => { if (readThrows) throw new Error('EIO'); return files.has(name) ? files.get(name) : null; },
    auxWrite: async (name, content) => { if (writeThrows) throw new Error('ENOSPC'); files.set(name, String(content)); return '/stats/' + name; },
    auxAppend: async () => {},
  };
  global.window = { appInfo: bridge ? { stats: fakeBridge, devlog: { append: async (entries) => { logged.push(...entries); } } } : undefined, localStorage: global.localStorage };
  delete require.cache[LEDGER];
  delete require.cache[DEVLOG];
  const L = require(LEDGER);
  const devlog = require(DEVLOG);
  const logs = async () => { await devlog.flushLog(); return logged.map((e) => `${e.level} ${e.area}: ${e.msg}`); };
  return { L, files, store, logs };
}

(async () => {
  // ---- A. the file is there: restored from it, localStorage untouched
  {
    const w = world({ file: ledgerText([1, 2]), legacy: ledgerText([9]) });
    eq('A1 before the restore the ledger is empty and not loaded', [w.L.ledger.tx.length, w.L.ledgerLoaded(), w.L.useLedger.getState().loaded], [0, false, false]);
    await w.L.restoreLedger();
    eq('A2 restored from the file: 2 transactions, loaded, version bumped', [w.L.ledger.tx.map((t) => t.id), w.L.ledgerLoaded(), w.L.useLedger.getState()], [[1, 2], true, { version: 1, loaded: true }]);
    eq('A3 a stale localStorage copy is ignored when the file exists (and left alone)', w.store.get('etc-ledger-v1'), ledgerText([9]));
    eq('A4 restored is logged with the counts', (await w.logs()).filter((l) => l.startsWith('info ledger')), ['info ledger: ledger restored']);
    eq('A5 the snapshot is the file text', w.L.ledgerSnapshot(), ledgerText([1, 2]));
  }
  // ---- B. no file yet, a localStorage copy: adopted, written, read back, removed
  {
    const w = world({ legacy: ledgerText([1, 2, 3]) });
    await w.L.restoreLedger();
    eq('B1 the old copy is adopted (3 transactions)', w.L.ledger.tx.map((t) => t.id), [1, 2, 3]);
    eq('B2 the file now holds exactly the snapshot', w.files.get('ledger-v1.json'), w.L.ledgerSnapshot());
    eq('B3 the localStorage copy is removed only after the read-back matched', w.store.has('etc-ledger-v1'), false);
    eq('B4 the move is logged', (await w.logs()).some((l) => l.includes('ledger moved from localStorage')), true);
  }
  // ---- C. the move fails (disk): memory keeps the rows, the old copy stays, a warning is logged
  {
    const w = world({ legacy: ledgerText([1, 2, 3]), writeThrows: true });
    await w.L.restoreLedger();
    eq('C1 the rows are in memory', w.L.ledger.tx.length, 3);
    eq('C2 no file was created, the localStorage copy is still there', [w.files.has('ledger-v1.json'), w.store.has('etc-ledger-v1')], [false, true]);
    eq('C3 warned, not silent', (await w.logs()).some((l) => l.startsWith('warn ledger: ledger could not be moved')), true);
  }
  // ---- D. a damaged file: nothing loaded, every write refused, the file untouched
  {
    const w = world({ file: '{"tx": [1, 2', legacy: ledgerText([7]) });
    await w.L.restoreLedger();
    eq('D1 not loaded, empty in memory (the localStorage copy is NOT adopted over a damaged file)', [w.L.ledgerLoaded(), w.L.ledger.tx.length], [false, 0]);
    let threw = false;
    try { w.L.replaceLedger(ledgerText([5])); } catch { threw = true; }
    await tick();
    eq('D2 a write is refused: the damaged file is untouched', [threw, w.files.get('ledger-v1.json')], [false, '{"tx": [1, 2']);
    eq('D3 recordOrderEvents before a load records nothing', w.L.recordOrderEvents([{ order_id: 1, type_id: 34, location_id: 60003760, issued: '2026-09-23T10:00:00Z', price: 5 }], 1), 0);
    const logs = await w.logs();
    eq('D4 damaged file → error; refused write → warning', [logs.some((l) => l.startsWith('error ledger: ledger file is damaged')), logs.some((l) => l.startsWith('warn ledger: write refused'))], [true, true]);
  }
  // ---- E. the file cannot be read at all: same refusal
  {
    const w = world({ file: ledgerText([1]), readThrows: true });
    await w.L.restoreLedger();
    eq('E1 unreadable file → not loaded', w.L.ledgerLoaded(), false);
    eq('E2 logged as an error', (await w.logs()).some((l) => l.startsWith('error ledger: ledger file could not be read')), true);
  }
  // ---- F. writes after the restore reach the file and coalesce
  {
    const w = world({ file: ledgerText([1]) });
    await w.L.restoreLedger();
    const ev = (id, issued) => ({ order_id: id, type_id: 34, location_id: 60003760, issued, price: 5, is_buy_order: false });
    eq('F1 two events recorded', w.L.recordOrderEvents([ev(10, '2026-09-23T10:00:00Z'), ev(11, '2026-09-23T10:01:00Z')], 1), 2);
    eq('F2 a third, immediately (the first write is still in flight)', w.L.recordOrderEvents([ev(12, '2026-09-23T10:02:00Z')], 1), 1);
    await tick();
    const onDisk = JSON.parse(w.files.get('ledger-v1.json'));
    eq('F3 the file ends up with all three events (coalesced writes, last state wins)', onDisk.orderEvents.map((e) => e.orderId), [10, 11, 12]);
    eq('F4 the version bumped once per write', w.L.useLedger.getState().version, 3);
    eq('F5 replaceLedger (a backup import) replaces memory and writes', (() => { w.L.replaceLedger(ledgerText([1, 2, 3, 4])); return w.L.ledger.tx.length; })(), 4);
    await tick();
    eq('F6 …and the file follows', JSON.parse(w.files.get('ledger-v1.json')).tx.length, 4);
  }
  // ---- G. a write that fails after the restore: memory intact, warned
  {
    const w = world({ file: ledgerText([1]) });
    await w.L.restoreLedger();
    w.files.set('__throw', '1');
    // flip the bridge to throwing after the restore
    window.appInfo.stats.auxWrite = async () => { throw new Error('ENOSPC'); };
    w.L.replaceLedger(ledgerText([1, 2]));
    await tick();
    eq('G1 memory has the new rows, the file still the old', [w.L.ledger.tx.length, JSON.parse(w.files.get('ledger-v1.json')).tx.length], [2, 1]);
    eq('G2 warned', (await w.logs()).some((l) => l.startsWith('warn ledger: ledger file write failed')), true);
  }
  // ---- H. no file bridge (the dev server): localStorage as before, and a quota error does not lose memory
  {
    const w = world({ bridge: false, legacy: ledgerText([1, 2]) });
    await w.L.restoreLedger();
    eq('H1 restored from localStorage', w.L.ledger.tx.length, 2);
    w.L.replaceLedger(ledgerText([1, 2, 3]));
    eq('H2 written back to localStorage', JSON.parse(w.store.get('etc-ledger-v1')).tx.length, 3);
    const w2 = world({ bridge: false, legacy: ledgerText([1]), setItemThrows: true });
    await w2.L.restoreLedger();
    let threw = false;
    try { w2.L.replaceLedger(ledgerText([1, 2, 3, 4])); } catch { threw = true; }
    eq('H3 a quota error is swallowed with the memory intact (and the change unsaved)', [threw, w2.L.ledger.tx.length, JSON.parse(w2.store.get('etc-ledger-v1')).tx.length], [false, 4, 1]);
  }
  // ---- I. a pop-out window reads, never writes, never migrates
  {
    const w = world({ legacy: ledgerText([1, 2]) });
    await w.L.restoreLedger({ writer: false });
    eq('I1 a pop-out adopts the copy for reading', w.L.ledger.tx.length, 2);
    eq('I2 …but does not move it (no file, localStorage intact)', [w.files.has('ledger-v1.json'), w.store.has('etc-ledger-v1')], [false, true]);
    w.L.replaceLedger(ledgerText([1, 2, 3]));
    await tick();
    eq('I3 …and a write stays in memory', [w.L.ledger.tx.length, w.files.has('ledger-v1.json')], [3, false]);
  }
  // ---- J. an old save without orderEvents
  {
    const w = world({ file: JSON.stringify({ tx: [tx(1)], fees: [], lastSync: null }) });
    await w.L.restoreLedger();
    eq('J1 orderEvents defaults to [] for a save from before it existed', [w.L.ledger.tx.length, w.L.ledger.orderEvents], [1, []]);
    const w2 = world();
    await w2.L.restoreLedger();
    eq('J2 a fresh install starts empty and loaded', [w2.L.ledgerLoaded(), w2.L.ledger.tx.length, w2.files.has('ledger-v1.json')], [true, 0, false]);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
