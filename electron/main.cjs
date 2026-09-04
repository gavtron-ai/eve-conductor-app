const { app, BrowserWindow, shell, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const sso = require('./sso.cjs');
const stats = require('./stats.cjs');
const windowState = require('./windowState.cjs');
const devlog = require('./devlog.cjs');
const appConfig = require('./appConfig.cjs');
const overlay = require('./overlay.cjs');
const cloneStore = require('./cloneStore.cjs');
const narrative = require('./narrative.cjs');
const zkillPage = require('./zkillPage.cjs');
const storms = require('./storms.cjs');
const gamelog = require('./gamelog.cjs');
const aperturePage = require('./aperturePage.cjs');

// The app is meant to run 24/7 (collectors). A second launch while the window
// is hidden in the tray must surface the existing instance, not start a rival
// collector writing the same stats files.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

// v46 renamed the product to "EVE Conductor". Electron derives userData from
// the APP NAME, so the rename would silently point at an empty folder and the
// ledger, settings, logins, groups and station-trade marks would look wiped
// (they aren't — they're in the old folder, just unread). Keep using the
// original folder wherever it already exists. Must run before app is ready.
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'EVE Trade Conductor');
try {
  if (fs.existsSync(LEGACY_USER_DATA)) app.setPath('userData', LEGACY_USER_DATA);
} catch {
  // a fresh machine has no legacy folder — the default (new name) is correct
}

ipcMain.handle('sso-login', (_event, clientId) => sso.login(clientId));
ipcMain.handle('sso-refresh', (_event, { clientId, refreshToken }) =>
  sso.refresh(clientId, refreshToken),
);
ipcMain.on('sso-scopes', (event) => {
  event.returnValue = sso.SCOPES;
});

// THE CALLBACK THE LOOPBACK SERVER ACTUALLY BINDS. The Settings panel that
// tells a new user what to register in their EVE application used to carry
// its own copy of the port — and it was WRONG (:53137, the other app's), so
// anyone following those instructions built a registration that could never
// complete a login. Deriving it from sso.cjs makes that class of bug
// impossible: there is one number.
ipcMain.on('sso-callback', (event) => {
  event.returnValue = `http://localhost:${sso.SSO_PORT}${sso.CALLBACK_PATH}`;
});

// trend stats live in Documents/"EVE Conductor Stats (Do Not Delete)" — outside
// the install AND userData folders so updates/reinstalls can't take them
ipcMain.handle('stats-info', () => ({ dir: stats.statsDir(app.getPath('documents')) }));

// ---- baseline seeding: new installs inherit the project's measurement
// history (radar + skyhook raids) instead of starting cold. Existing
// files are never touched — the user's own history always wins. ----
app.whenReady().then(() => {
  try {
    const baseline = require('./baseline.cjs');
    const src = path.join(process.resourcesPath ?? '', 'baseline');
    const res = baseline.seedBaseline(src, stats.statsDir(app.getPath('documents')));
    if (res.seeded.length > 0) {
      devlog.append(app.getPath('documents'), [{
        level: 'info', area: 'baseline',
        msg: `seeded ${res.seeded.length} baseline file(s): ${res.seeded.join(', ')}`,
      }]);
    }
  } catch (e) {
    devlog.append(app.getPath('documents'), [{
      level: 'warn', area: 'baseline',
      msg: `baseline seeding failed: ${e instanceof Error ? e.message : String(e)}`,
    }]);
  }
}).catch(() => {});

// ---- dev log: what the app actually did, in a file we can both read ----
ipcMain.handle('devlog-append', (_e, entries) => devlog.append(app.getPath('documents'), entries));
// LAST-RESORT CRASH EVIDENCE (v0.186, beta prep): without these, a
// main-process error is a silent app death with nothing in the log to show
// it ever happened — undiagnosable from a corp mate's "it just closed".
// Registering uncaughtException also keeps the process alive on a
// non-fatal slip instead of killing every window.
for (const [event, label] of [
  ['uncaughtException', 'uncaught exception'],
  ['unhandledRejection', 'unhandled rejection'],
]) {
  process.on(event, (err) => {
    try {
      devlog.append(app.getPath('documents'), [{
        level: 'error', area: 'main',
        msg: `${label}: ${err instanceof Error ? err.message : String(err)}`,
        data: err instanceof Error ? { stack: String(err.stack).slice(0, 4000) } : undefined,
      }]);
    } catch { /* the crash handler must never itself crash */ }
  });
}
app.whenReady().then(() => {
  devlog.prune(app.getPath('documents'));
  // the MAIN process gets its own line: if the renderer never starts, this is
  // the only evidence the app was launched at all
  devlog.append(app.getPath('documents'), [{
    level: 'info', area: 'main', msg: `main process ready — EVE Conductor ${app.getVersion()}`,
    data: { platform: process.platform, electron: process.versions.electron },
  }]);
}).catch(() => {});
ipcMain.handle('devlog-tail', (_e, lines) => devlog.tail(app.getPath('documents'), lines));
ipcMain.handle('devlog-info', () => ({ dir: devlog.logDir(app.getPath('documents')) }));

// ---- self-updates from the PUBLIC releases repo (v0.187, beta prep) ----
// electron-updater reads the feed baked in from package.json build.publish
// (github.com/gavtron-ai/eve-conductor-releases — binaries only, so no
// token is ever needed at runtime). Downloads happen in the background;
// nothing installs until the app quits, and the renderer shows a
// "restart to apply" banner. Every step lands in the devlog. Packaged
// builds only — dev runs must never try to update themselves.
try {
  const { autoUpdater } = require('electron-updater');
  const updLog = (level, msg, data) => {
    try { devlog.append(app.getPath('documents'), [{ level, area: 'updater', msg, data }]); } catch { /* nicety */ }
  };
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => updLog('info', 'checking the release feed'));
  autoUpdater.on('update-not-available', (i) => updLog('info', `up to date (feed offers ${i?.version ?? '?'})`));
  autoUpdater.on('update-available', (i) => updLog('info', `update available: ${i?.version} — downloading`));
  autoUpdater.on('error', (e) => updLog('warn', `update check failed: ${e instanceof Error ? e.message : String(e)}`));
  autoUpdater.on('update-downloaded', (i) => {
    updLog('info', `update ${i?.version} downloaded — installs on quit`);
    for (const w of BrowserWindow.getAllWindows()) {
      try { w.webContents.send('update-ready', { version: i?.version ?? '' }); } catch { /* window may be closing */ }
    }
  });
  ipcMain.handle('update-restart', () => { autoUpdater.quitAndInstall(); });
  app.whenReady().then(() => {
    if (!app.isPackaged) return;
    const check = () => { autoUpdater.checkForUpdates().catch(() => { /* logged above */ }); };
    setTimeout(check, 15_000);              // let startup settle first
    setInterval(check, 4 * 3_600_000);      // then every 4 hours
  }).catch(() => {});
} catch (e) {
  devlog.append(app.getPath('documents'), [{
    level: 'warn', area: 'updater',
    msg: `updater unavailable: ${e instanceof Error ? e.message : String(e)}`,
  }]);
}

// ---- Aperture pop-outs: the corp map's overlay opens a window.open()
// popup. The webview had allowpopups but NO open handler, so Electron
// spawned an unmanaged native window on defaults — which took the whole
// app down (measured 2026-09-04: session ends in silence, no JS
// exception; classic webview-popup native crash). Every webview guest now
// gets a handler: popups become real windows on the SAME persistent
// session, so the map's login carries into them. ----
// MEASURED 2026-09-04 (renderer gone (crashed), exitCode 3, type webview):
// even a MANAGED allow with overrideBrowserWindowOptions crashes the guest
// renderer — the webview native-popup path itself is the broken part. So
// the guest never creates a window at all: DENY, and the main process
// builds the popup itself on the same persistent session.
const openAperturePopup = (url) => {
  const pop = new BrowserWindow({
    width: 480, height: 720, autoHideMenuBar: true,
    webPreferences: { partition: 'persist:aperture', contextIsolation: true, nodeIntegration: false },
  });
  // popups from the popup get the same treatment (never the native path)
  pop.webContents.setWindowOpenHandler(({ url: u }) => {
    openAperturePopup(u);
    return { action: 'deny' };
  });
  void pop.loadURL(url);
};
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() !== 'webview') return;
  // belt only — with the guest-side shim (webviewPreload.cjs) and
  // allowpopups removed, no open request should ever reach this natively
  contents.setWindowOpenHandler(({ url }) => {
    try {
      openAperturePopup(url);
    } catch (e) {
      devlog.append(app.getPath('documents'), [{
        level: 'warn', area: 'main', msg: `aperture popup failed: ${e instanceof Error ? e.message : String(e)}`,
      }]);
    }
    return { action: 'deny' };
  });
});
// the shim's requests, relayed by the host renderer
ipcMain.handle('aperture-open-popup', (_e, url) => {
  if (typeof url !== 'string' || !/^https?:/i.test(url)) return false;
  openAperturePopup(url);
  return true;
});
// the <webview> preload attribute needs an absolute file path, which only
// the main process knows once packaged
ipcMain.on('aperture-preload-path', (event) => {
  event.returnValue = path.join(__dirname, 'webviewPreload.cjs');
});

// ---- native-death evidence: a renderer/GPU/utility process dying leaves
// NO JS exception, so the v0.186 handlers never saw it. These hooks are
// the only way a "the app just closed" gets a cause in the log. ----
app.on('render-process-gone', (_e, contents, details) => {
  try {
    devlog.append(app.getPath('documents'), [{
      level: 'error', area: 'main',
      msg: `renderer gone (${details.reason})`,
      data: { exitCode: details.exitCode, url: contents.getURL().slice(0, 120), type: contents.getType() },
    }]);
  } catch { /* evidence is best-effort */ }
});
app.on('child-process-gone', (_e, details) => {
  if (details.reason === 'clean-exit') return;
  try {
    devlog.append(app.getPath('documents'), [{
      level: 'error', area: 'main',
      msg: `child process gone (${details.type}: ${details.reason})`,
      data: { exitCode: details.exitCode, name: details.name },
    }]);
  } catch { /* evidence is best-effort */ }
});

// ---- per-player setup, read from a file rather than compiled in ----
ipcMain.handle('config-read', () => appConfig.read(app.getPath('documents')));
ipcMain.handle('config-write', (_e, patch) => appConfig.write(app.getPath('documents'), patch));
ipcMain.handle('config-path', () => appConfig.configPath(app.getPath('documents')));

// ---- AI fight write-ups: the key stays in the main process (narrative.cjs) ----
ipcMain.handle('narrative-status', () => narrative.status(app.getPath('documents')));
ipcMain.handle('narrative-write', (_e, digest) => narrative.narrate(app.getPath('documents'), digest));
ipcMain.handle('narrative-set-key', (_e, apiKey) => narrative.setKey(app.getPath('documents'), apiKey));

// ---- the corp killboard read as a PAGE (live) rather than the cached API ----
ipcMain.handle('zkill-page-ids', (_e, corpId) => zkillPage.corpPageKillIds(Number(corpId) || 0));
ipcMain.handle('zkill-char-kills', (_e, charId) => zkillPage.charKillmails(Number(charId) || 0));
ipcMain.handle('zkill-system-kills', (_e, arg) => {
  const systemId = Number(arg && arg.systemId) || 0;
  const pastSeconds = arg && arg.pastSeconds;
  return zkillPage.systemKills(systemId, pastSeconds);
});

// ---- the storm tracker page (no CORS header — main must fetch it) ----
ipcMain.handle('storms-page', () => storms.stormPage());

// ---- Aperture systems, pulled from the owner's own logged-in map in a hidden
// background window (same persist:aperture session as the visible webview) so
// the Theft Conductor can import without him opening Aperture at all ----
ipcMain.handle('aperture-systems', (_e, url) => aperturePage.fetchSystems(String(url || '')));

// ---- the OS clipboard, read-only via main so the Theft Conductor can watch
// for an Aperture system list even when the renderer isn't the focused frame
// (navigator.clipboard.readText throws when the document isn't focused; the
// main-process clipboard has no such gate). Read-only: never writes. ----
ipcMain.handle('clipboard-read', () => {
  try { return require('electron').clipboard.readText() || ''; } catch { return ''; }
});

// ---- the EVE client's own game logs, read-only (never interrupts the
// game: open→read→close per call, no held handles, nothing written) ----
ipcMain.handle('gamelog-list', () => gamelog.list(app.getPath('documents')));
ipcMain.handle('gamelog-read', (_e, file) => gamelog.read(app.getPath('documents'), String(file)));
ipcMain.handle('stats-append', (_event, lines) =>
  stats.appendEvents(app.getPath('documents'), lines),
);
ipcMain.handle('stats-read', () => stats.readAllEvents(app.getPath('documents')));
ipcMain.handle('stats-files', () => stats.listEventFiles(app.getPath('documents')));
ipcMain.handle('stats-aux-write', (_e, { name, content }) => stats.writeAuxFile(app.getPath('documents'), name, content));
ipcMain.handle('stats-aux-read', (_e, name) => stats.readAuxFile(app.getPath('documents'), name));
ipcMain.handle('stats-aux-append', (_e, { name, lines }) => stats.appendAuxLines(app.getPath('documents'), name, lines));
ipcMain.handle('stats-aux-files', () => stats.listAuxFiles(app.getPath('documents')));
ipcMain.handle('stats-aux-names', () => stats.listAuxNames(app.getPath('documents')));
ipcMain.handle('stats-import', (_event, files) =>
  stats.importEventFiles(app.getPath('documents'), files),
);

/**
 * Write a fitting XML where the EVE CLIENT looks for it:
 * Documents/EVE/fittings/. Importing from there is instant and uses no API
 * budget at all — the bulk path for hundreds of fits.
 */
ipcMain.handle('fittings-export', (_e, { fileName, content, clearOurs }) => {
  const dir = path.join(app.getPath('documents'), 'EVE', 'fittings');
  fs.mkdirSync(dir, { recursive: true });
  // wipe OUR previous exports first, so a shorter run cannot leave orphan
  // "part 4 of 4" files behind to be imported by mistake. Only ever files
  // this app wrote — the user's own exports are never touched.
  if (clearOurs) {
    for (const f of fs.readdirSync(dir)) {
      if (/^(C\d+ |Conductor |EVE Conductor library )/.test(f) && f.endsWith('.xml')) {
        try { fs.unlinkSync(path.join(dir, f)); } catch { /* leave it */ }
      }
    }
  }
  // strict name: no separators can escape the folder
  if (typeof fileName !== 'string' || !/^[A-Za-z0-9 ._-]+\.xml$/.test(fileName)) {
    throw new Error('bad fitting file name');
  }
  const full = path.join(dir, fileName);
  fs.writeFileSync(full, String(content), 'utf8');
  return full;
});
ipcMain.handle('fittings-dir', () => path.join(app.getPath('documents'), 'EVE', 'fittings'));

// pyfa export: the user PICKS a folder, and every unique fit is written as one
// EVE XML fitting file — the format pyfa's import dialog preselects. Names are
// validated the same way as the client export — nothing escapes the folder.
ipcMain.handle('fittings-export-folder', async (_e, files) => {
  if (!Array.isArray(files) || files.length === 0) return null;
  const { dialog } = require('electron');
  const r = await dialog.showOpenDialog({
    title: 'Choose a folder for the EFT fit files',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  });
  if (r.canceled || r.filePaths.length === 0) return null;
  const dir = r.filePaths[0];
  let written = 0;
  const errors = [];
  for (const f of files) {
    const name = String(f && f.name ? f.name : '');
    if (!/^[A-Za-z0-9 ()._'-]+\.(txt|xml)$/.test(name)) { errors.push(`bad name: ${name}`); continue; }
    try {
      fs.writeFileSync(path.join(dir, name), String(f.content ?? ''), 'utf8');
      written++;
    } catch (e) {
      errors.push(`${name}: ${e.message}`);
    }
  }
  return { dir, written, errors };
});

// backup export: native save dialog, defaulting into Documents
ipcMain.handle('backup-save', async (_event, { defaultName, content }) => {
  const { dialog } = require('electron');
  const fs = require('fs');
  const r = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'EVE Conductor backup', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return null;
  fs.writeFileSync(r.filePath, content);
  return r.filePath;
});

// ---- window behavior (renderer pushes the persisted settings on boot) ----
let mainWin = null;
let tray = null;
/** hide-to-tray on close; false until the renderer sends the saved setting,
 * so a window closed before the app finishes loading still quits normally */
let closeToTray = false;
let quitting = false;
/** kept in main so focus/show events can RE-ASSERT it: Windows drops or
 * misorders the TOPMOST flag around focus changes (electron#31536 family) —
 * the symptom is the window sinking BEHIND other apps when clicked */
let alwaysOnTop = false;

function assertAlwaysOnTop() {
  if (!mainWin) return;
  mainWin.setAlwaysOnTop(alwaysOnTop);
  if (alwaysOnTop) mainWin.moveTop();
}

const trayIcon = () =>
  nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'icon.png')).resize({ width: 16, height: 16 });

function ensureTray() {
  if (tray) return;
  tray = new Tray(trayIcon());
  tray.setToolTip('EVE Conductor — collectors running');
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open EVE Conductor', click: () => showWindow() },
      { type: 'separator' },
      {
        label: 'Quit (stops the collectors)',
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
  tray.on('click', () => showWindow());
  tray.on('double-click', () => showWindow());
}

function showWindow() {
  if (!mainWin) {
    createWindow();
    return;
  }
  if (mainWin.isMinimized()) mainWin.restore();
  mainWin.show();
  mainWin.focus();
}

app.on('second-instance', () => showWindow());
app.on('before-quit', () => {
  quitting = true;
  overlay.close(); // release the global hotkey and the overlay window
});

ipcMain.handle('win-set-always-on-top', (_event, on) => {
  alwaysOnTop = Boolean(on);
  assertAlwaysOnTop();
});
ipcMain.handle('win-set-close-to-tray', (_event, on) => {
  closeToTray = Boolean(on);
  // the tray icon exists only while the behavior is on — no dead icon
  if (closeToTray && process.platform !== 'darwin') {
    ensureTray();
  } else if (tray) {
    tray.destroy();
    tray = null;
  }
});

function createWindow() {
  // WHERE IT WAS LAST TIME. The app is reinstalled constantly, and every
  // install used to drop the window in the middle of the primary monitor.
  // Bounds that no longer land on an attached display are discarded rather
  // than restored, because an invisible window is worse than a centred one.
  const saved = windowState.usableBounds(app.getPath('documents')) ?? {};
  const win = new BrowserWindow({
    width: saved.width ?? 1440,
    height: saved.height ?? 900,
    ...(typeof saved.x === 'number' && typeof saved.y === 'number'
      ? { x: saved.x, y: saved.y }
      : {}),
    minWidth: 1024,
    minHeight: 640,
    backgroundColor: '#0d1117',
    title: 'EVE Conductor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // the Aperture module embeds the corp's web map as a real guest page
      // (its own persistent session, so the login sticks) — iframes would
      // break that login on third-party cookie rules
      webviewTag: true,
      // THE COLLECTORS MUST KEEP RUNNING WHEN THE WINDOW IS HIDDEN.
      // Chromium throttles timers in backgrounded/occluded windows to about
      // once a minute, which is the whole app's scheduling heartbeat: the
      // radar sweep, the trend watcher, the wallet ledger and the net-worth
      // snapshots all hang off a 1-second interval in App.tsx. Hide-to-tray
      // is a documented, encouraged mode here (this is a 24/7 collector), so
      // throttling it silently starves exactly the background history that
      // cannot be collected retroactively.
      backgroundThrottling: false,
    },
  });

  // External links open in the system browser, not inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Windows mishandles the TOPMOST flag around focus transitions — the
  // window can sink behind other apps the moment it's clicked. Re-assert on
  // every focus/show/restore; no-ops while the toggle is off.
  win.on('focus', assertAlwaysOnTop);
  win.on('show', assertAlwaysOnTop);
  win.on('restore', assertAlwaysOnTop);

  // X hides to the tray instead of quitting (setting, non-mac) — the app is a
  // 24/7 collector and an accidental close must not stop it
  win.on('close', (e) => {
    if (closeToTray && !quitting && process.platform !== 'darwin') {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => {
    if (mainWin === win) mainWin = null;
  });

  // remember where it ends up, including a maximize
  windowState.track(win, app.getPath('documents'));
  if (saved.maximized) win.maximize();

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
  mainWin = win;
}

// ---- pop-out module windows ----
// A second (third, …) window showing one module, so the user can watch e.g.
// the Theft Conductor while trading in the main window. It loads the SAME
// bundle with a `#module:<id>` hash; the renderer reads that, shows that
// module, and — crucially — runs NONE of the background collectors (only the
// main window writes the radar/trend/ship history, so a pop-out never doubles
// the ESI spend or races the NDJSON files). These windows close for real
// (no hide-to-tray) and are never the always-on-top target.
const moduleWins = new Set();

// Persist the CURRENT set of open pop-outs (module + bounds). Called on create
// and on the settle of every move/resize, so the file always reflects what is
// open — quitting keeps that state; a user-closed window removes itself.
function persistModuleWindows() {
  const list = [];
  for (const w of moduleWins) {
    if (!w || w.isDestroyed()) continue;
    // getNormalBounds() is the un-maximized, un-minimized rectangle — stable to
    // save whatever state the window is currently in
    const b = w.getNormalBounds();
    list.push({ moduleId: w.__moduleId || 'trade', x: b.x, y: b.y, width: b.width, height: b.height, maximized: w.isMaximized() });
  }
  windowState.writeModuleLayout(app.getPath('documents'), list);
}

function createModuleWindow(moduleId, saved) {
  const id = String(moduleId || 'trade').replace(/[^a-z]/g, '') || 'trade';
  const b = saved || {};
  const win = new BrowserWindow({
    width: b.width ?? 1200,
    height: b.height ?? 820,
    ...(typeof b.x === 'number' && typeof b.y === 'number' ? { x: b.x, y: b.y } : {}),
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'EVE Conductor',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
      backgroundThrottling: false,
    },
  });
  win.__moduleId = id;
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (saved && saved.maximized) win.maximize();
  moduleWins.add(win);

  // remember placement — debounced on settle, like the main window
  let timer = null;
  const remember = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => persistModuleWindows(), 400);
  };
  win.on('resize', remember);
  win.on('move', remember);
  win.on('maximize', remember);
  win.on('unmaximize', remember);
  // A user closing ONE pop-out means "forget it" (drop from the saved layout);
  // but if the app is quitting, leave the layout intact so every open window
  // comes back next launch.
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    if (quitting) return;
    moduleWins.delete(win);
    persistModuleWindows();
  });
  win.on('closed', () => moduleWins.delete(win));

  const hash = `module:${id}`;
  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#${hash}`);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash });
  }
  persistModuleWindows();
  return win;
}
ipcMain.handle('open-module-window', (_e, moduleId) => {
  createModuleWindow(moduleId);
  return true;
});
// a pop-out reports its CURRENT module when the user switches it, so the saved
// layout tracks what's actually on screen, not just what it opened as
ipcMain.on('module-window-module', (e, moduleId) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (w && moduleWins.has(w)) {
    w.__moduleId = String(moduleId || 'trade').replace(/[^a-z]/g, '') || 'trade';
    persistModuleWindows();
  }
});

/** bring back the pop-outs that were open at last quit, at their saved spots */
function restoreModuleWindows() {
  for (const e of windowState.usableModuleLayout(app.getPath('documents'))) {
    createModuleWindow(e.moduleId, e);
  }
}

app.whenReady().then(() => {
  // Windows toast notifications need the app identity set explicitly
  app.setAppUserModelId('org.gavtron.evetradeconductor');
  overlay.register();
  cloneStore.register();
  createWindow();
  restoreModuleWindows(); // bring back the pop-outs open at last quit
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
