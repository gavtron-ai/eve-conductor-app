// v0.242.0: THE DESKTOP BRIDGE IS HELD TO ITS DECLARATION AND TO ITS USES.
//
// electron/preload.cjs is plain script — the type checker never reads it — and from 0.238.0 to 0.241.0 a
// text patch left `sso.refresh` inside the `notices` block: every token refresh the page asked for threw
// "refresh is not a function", and only the planet watcher's warning line said so, an hour later.
//
// This fixture loads the REAL preload with a stand-in for Electron (contextBridge captures what is
// exposed; ipcRenderer answers the two synchronous calls the preload makes at load) and checks:
//   1. every member the page's declaration (src/lib/auth.ts, `window.appInfo`) names exists on the
//      exposed object, one level down as well — the declaration is read with the TypeScript compiler,
//      interfaces resolved by name across src/lib;
//   2. every `appInfo.a.b` path the page's source reaches exists too (a second, independent net);
//   3. the members the fault moved are functions where they belong.
const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const APP = path.join(__dirname, '..');

// ---- 1. load the real preload with a stand-in Electron
const exposed = {};
const syncAnswers = { 'sso-scopes': 'publicData', 'sso-callback': 'http://localhost:53138/callback', 'tokens-available': false };
const electronStub = {
  contextBridge: { exposeInMainWorld: (name, api) => { exposed[name] = api; } },
  ipcRenderer: {
    invoke: async () => null, send: () => {}, on: () => {}, once: () => {}, removeListener: () => {}, removeAllListeners: () => {},
    sendSync: (channel) => (channel in syncAnswers ? syncAnswers[channel] : null),
  },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) { return request === 'electron' ? electronStub : origLoad.call(this, request, ...rest); };
require(path.join(APP, 'electron', 'preload.cjs'));
Module._load = origLoad;
const bridge = exposed.appInfo;
eq('1 the preload exposes window.appInfo', typeof bridge, 'object');

// ---- 2. the declared shape, read with the TypeScript compiler
const libDir = path.join(APP, 'src', 'lib');
const sources = new Map(fs.readdirSync(libDir).filter((f) => f.endsWith('.ts')).map((f) => [f, ts.createSourceFile(f, fs.readFileSync(path.join(libDir, f), 'utf8'), ts.ScriptTarget.Latest, true)]));
const interfaces = new Map(); // name → InterfaceDeclaration (across src/lib)
for (const sf of sources.values()) {
  const walk = (n) => { if (ts.isInterfaceDeclaration(n)) interfaces.set(n.name.text, n); ts.forEachChild(n, walk); };
  walk(sf);
}
const memberNames = (typeNode) => {
  if (!typeNode) return null;
  if (ts.isTypeLiteralNode(typeNode)) return typeNode.members.filter(ts.isPropertySignature).map((m) => m.name.getText());
  if (ts.isTypeReferenceNode(typeNode)) {
    const decl = interfaces.get(typeNode.typeName.getText());
    return decl ? decl.members.filter(ts.isPropertySignature).map((m) => m.name.getText()) : null;
  }
  return null; // a function, a primitive, an array: a leaf
};
let appInfoType = null;
{
  const auth = sources.get('auth.ts');
  const walk = (n) => {
    if (ts.isPropertySignature(n) && n.name.getText() === 'appInfo' && n.type && ts.isTypeLiteralNode(n.type)) appInfoType = n.type;
    ts.forEachChild(n, walk);
  };
  walk(auth);
}
eq('2 the page declares window.appInfo as a type literal in src/lib/auth.ts', appInfoType !== null, true);
const declared = appInfoType.members.filter(ts.isPropertySignature).map((m) => ({ name: m.name.getText(), nested: memberNames(m.type) }));
const missingTop = declared.filter((d) => !(d.name in bridge)).map((d) => d.name);
eq(`3 every declared top-level member exists on the bridge (${declared.length} declared)`, missingTop, []);
const missingNested = [];
let nestedChecked = 0;
for (const d of declared) {
  if (!d.nested || !(d.name in bridge) || typeof bridge[d.name] !== 'object' || bridge[d.name] === null) continue;
  for (const k of d.nested) { nestedChecked++; if (!(k in bridge[d.name])) missingNested.push(`${d.name}.${k}`); }
}
eq(`4 every declared nested member exists (${nestedChecked} checked)`, missingNested, []);
const unresolved = declared.filter((d) => d.nested === null && d.name in bridge && typeof bridge[d.name] === 'object' && bridge[d.name] !== null).map((d) => d.name);
eq('5 every object-valued member has a declaration this fixture could read (an interface by name, or a literal)', unresolved, []);

// ---- 3. every path the page's source reaches
const used = new Set();
const walkSrc = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { walkSrc(p); continue; }
    if (!/\.(ts|tsx)$/.test(e.name)) continue;
    const text = fs.readFileSync(p, 'utf8');
    for (const m of text.matchAll(/appInfo\??\.([A-Za-z_]+)\??\.([A-Za-z_]+)/g)) used.add(`${m[1]}.${m[2]}`);
  }
};
walkSrc(path.join(APP, 'src'));
const missingUsed = [...used].filter((p) => { const [a, b] = p.split('.'); return !(a in bridge) || bridge[a] === null || typeof bridge[a] !== 'object' || !(b in bridge[a]); });
eq(`6 every appInfo.a.b path the page reaches exists (${used.size} paths)`, missingUsed, []);

// ---- 4. the members the fault moved
eq('7 sso has login, refresh and meter as functions', ['login', 'refresh', 'meter'].map((k) => typeof bridge.sso[k]), ['function', 'function', 'function']);
eq('8 notices has read and nothing that belongs to sso', [typeof bridge.notices.read, Object.keys(bridge.notices)], ['function', ['read']]);

// ---- 5. every channel the preload calls has a handler in the main process, and every event it listens
// for is one the main process sends (an invoke on a channel nobody handles rejects at run time only)
{
  const pre = fs.readFileSync(path.join(APP, 'electron', 'preload.cjs'), 'utf8');
  const called = new Set([...pre.matchAll(/ipcRenderer\.(?:invoke|send|sendSync)\('([^']+)'/g)].map((m) => m[1]));
  const listened = new Set([...pre.matchAll(/ipcRenderer\.on\('([^']+)'/g)].map((m) => m[1]));
  const handled = new Set(), sent = new Set();
  for (const f of fs.readdirSync(path.join(APP, 'electron')).filter((f) => f.endsWith('.cjs') && f !== 'preload.cjs')) {
    const text = fs.readFileSync(path.join(APP, 'electron', f), 'utf8');
    for (const m of text.matchAll(/ipcMain\.(?:handle|on)\('([^']+)'/g)) handled.add(m[1]);
    for (const m of text.matchAll(/\.send\('([^']+)'/g)) sent.add(m[1]);
  }
  eq(`9 every channel the preload calls is handled by the main process (${called.size} channels)`, [...called].filter((c) => !handled.has(c)), []);
  eq(`10 every event the preload listens for is one the main process sends (${listened.size} events)`, [...listened].filter((c) => !sent.has(c)), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
