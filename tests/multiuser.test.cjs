// Fixtures for the multi-user work (v0.60.34).
//
// ONE BUILD FOR EVERYONE (v0.60.35). Nothing personal is compiled in at all,
// so there is nothing to seed and no way for one player's values to reach
// another's install. These fixtures drive the SHIPPED store through zustand's
// real persist middleware across simulated app launches.

const NL = String.fromCharCode(10);
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `   got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

// ---- a storage that behaves like localStorage across "launches" ----------
const disk = new Map();
global.localStorage = {
  getItem: (k) => (disk.has(k) ? disk.get(k) : null),
  setItem: (k, v) => disk.set(k, String(v)),
  removeItem: (k) => disk.delete(k),
};
// zustand resolves its default storage as window.localStorage, so it has to
// live there too, not only on globalThis
global.window = { appInfo: {}, localStorage: global.localStorage };

const KEY = 'eve-trade-conductor';
const STORE = require.resolve('./mu/store.js');

/** simulate closing and reopening the app: fresh module instances, same disk */
function launch() {
  for (const k of Object.keys(require.cache)) {
    if (k.includes(`${require('path').sep}mu${require('path').sep}`)) delete require.cache[k];
  }
  const { useApp } = require(STORE);
  return useApp;
}

// ===== A NEW USER — the case that was broken ==============================
disk.clear();

let useApp = launch();
let s = useApp.getState().settings;
eq('launch 1: transit ship is blank', s.transitShipName ?? '', '');
eq('launch 1: no corporation map', s.apertureUrl ?? '', '');

// ...they use the app, which makes zustand persist state
useApp.getState().setSettings({ accountingLevel: 4 });
eq('launch 1: using the app writes persisted state', disk.has(KEY), true);

// *** SECOND LAUNCH — this is where the owner's data used to appear ***
useApp = launch();
s = useApp.getState().settings;
eq('LAUNCH 2: transit ship is STILL blank', s.transitShipName ?? '', '');
eq('LAUNCH 2: corporation map is STILL empty', s.apertureUrl ?? '', '');
eq('...and their own setting survived', s.accountingLevel, 4);

// a third launch, for good measure
useApp = launch();
eq('launch 3: still blank', (useApp.getState().settings.transitShipName ?? ''), '');

// nothing owner-shaped anywhere in what was written to disk
const written = disk.get(KEY) ?? '';
eq('nothing owner-shaped was ever persisted',
  /dkvc|TR--|256763e9|9260ac78/.test(written), false);

// ===== A USER WHO DELIBERATELY CLEARS A FIELD ============================
useApp.getState().setSettings({ transitShipName: 'MY-HAULER' });
useApp = launch();
eq('a name they set survives a restart', useApp.getState().settings.transitShipName, 'MY-HAULER');
useApp.getState().setSettings({ transitShipName: '' });   // deliberately cleared
useApp = launch();
eq('CLEARING a field stays cleared — it is not refilled',
  useApp.getState().settings.transitShipName, '');

// ===== AN UPGRADING INSTALL (a save from before the change) ==============
// pre-v0.60.34 saves have NO version field; zustand reads that as version 0
disk.clear();
disk.set(KEY, JSON.stringify({
  state: { settings: { accountingLevel: 5, brokerRelationsLevel: 4 }, watchlist: [34] },
  // no `version` key at all — exactly what the old build wrote
}));
useApp = launch();
s = useApp.getState().settings;
eq('an old save still loads', s.accountingLevel, 5);
eq('...and its watchlist survives', useApp.getState().watchlist, [34]);
// on a SHAREABLE build the legacy values are empty, so even an upgrade seeds
// nothing — the owner's personal build is the only one that carries them
eq('a shareable build seeds nothing even on upgrade', s.transitShipName ?? '', '');



console.log(`${NL}${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
