// MULTIBOX OVERLAY — a transparent, click-through, always-on-top window
// that floats per-character boxes over the EVE clients.
//
// Click-through is the default (mouse events pass to the game). Pressing
// the EDIT hotkey ("\") flips the window interactive so the boxes can be
// dragged and resized, and flips it back on the next press.
//
// WHY A TOGGLE, NOT HOLD-TO-EDIT: Electron's globalShortcut only fires on
// key PRESS — it has no key-up event — so true hold semantics would need a
// native keyboard hook (an extra native dependency). Press-to-toggle is the
// same two keystrokes and needs nothing extra.
const { BrowserWindow, screen, globalShortcut, ipcMain } = require('electron');
const path = require('path');

/** Alt+\ — a bare "\" would swallow the character while typing in game */
const EDIT_HOTKEY = 'Alt+\\';

let win = null;
let cfgWin = null;
let editMode = false;

function isOpen() {
  return win !== null && !win.isDestroyed();
}

function cfgIsOpen() {
  return cfgWin !== null && !cfgWin.isDestroyed();
}

function applyClickThrough() {
  if (!isOpen()) return;
  // forward:true keeps hover/scroll events flowing to the game underneath
  win.setIgnoreMouseEvents(!editMode, { forward: true });
}

function create() {
  if (isOpen()) return win;
  // FULL display bounds, not workArea: workArea excludes the taskbar strip, so
  // the overlay window ended above the bottom of the screen and anything
  // dragged low (the raid box) was clipped by the window edge — it looked like
  // "a mask over the bottom of the screen". The overlay is click-through, so
  // covering the taskbar area costs nothing.
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds;
  win = new BrowserWindow({
    x, y, width, height,
    transparent: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    hasShadow: false,
    focusable: false,
    // an overlay must never steal focus from the game
    alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // above full-screen game windows where the platform allows it
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  applyClickThrough();

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(`${process.env.VITE_DEV_SERVER_URL}#overlay`);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'overlay' });
  }
  // RESYNC ON LOAD: a send to a webContents that is still navigating is
  // DROPPED, not queued. Opening the setup window from the Tools menu
  // creates the overlay and flips edit mode in the same tick, so without
  // this the main process would hold editMode=true (click-through OFF, the
  // full-screen window eating every click meant for the game) while the
  // renderer still believed edit=false and drew no way out.
  win.webContents.on('did-finish-load', () => {
    if (isOpen()) win.webContents.send('overlay-edit-changed', editMode);
  });
  win.on('closed', () => {
    win = null;
    editMode = false;
    broadcastOpen(); // whatever closed it, every window's toggle must follow
  });
  return win;
}

/**
 * THE SETUP WINDOW — the clone registry editor.
 *
 * A SEPARATE, ORDINARY window on purpose: the overlay itself is created
 * `focusable: false` so it can never steal focus from the game, which also
 * means it can never receive typed text. Custom clone names need a real
 * focusable window.
 */
function openConfig() {
  if (cfgIsOpen()) {
    cfgWin.show();
    cfgWin.focus();
    return cfgWin;
  }
  cfgWin = new BrowserWindow({
    width: 940,
    height: 680,
    minWidth: 620,
    minHeight: 400,
    title: 'EVE Conductor — Multibox Overlay Settings',
    backgroundColor: '#0b0f14',
    // above the game, but a normal focusable window so text can be typed
    alwaysOnTop: true,
    skipTaskbar: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  cfgWin.setAlwaysOnTop(true, 'screen-saver');
  cfgWin.setMenuBarVisibility(false);
  if (process.env.VITE_DEV_SERVER_URL) {
    cfgWin.loadURL(`${process.env.VITE_DEV_SERVER_URL}#clone-config`);
  } else {
    cfgWin.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), { hash: 'clone-config' });
  }
  // closing the setup window LOCKS the boxes again — otherwise the overlay
  // would silently stay interactive and keep swallowing clicks from the game
  cfgWin.on('closed', () => {
    cfgWin = null;
    setEdit(false);
  });
  return cfgWin;
}

function closeConfig() {
  if (cfgIsOpen()) cfgWin.close();
  cfgWin = null;
}

function setEdit(on) {
  editMode = Boolean(on);
  applyClickThrough();
  if (isOpen()) win.webContents.send('overlay-edit-changed', editMode);
  if (!editMode) closeConfig();
}

/** Alt+\ = SETUP MODE: unlock the boxes for dragging AND open the clone
 * editor. One keystroke for "let me set this up", one for "back to flying". */
function toggleEdit() {
  const next = !editMode;
  setEdit(next);
  if (next) openConfig();
}

// the on/off toggle lives in the clone-config window now, but the MAIN window
// owns the feed — every window is told when the overlay opens or closes so the
// feed (and any other toggle UI) tracks it, whichever window flipped it
function broadcastOpen() {
  for (const w of BrowserWindow.getAllWindows()) {
    try { w.webContents.send('overlay-open-changed', isOpen()); } catch { /* closing */ }
  }
}

function open() {
  create();
  win.showInactive(); // visible, but focus stays with the game
  // the edit hotkey only exists while the overlay does
  if (!globalShortcut.isRegistered(EDIT_HOTKEY)) {
    globalShortcut.register(EDIT_HOTKEY, () => toggleEdit());
  }
  broadcastOpen();
}

function close() {
  globalShortcut.unregister(EDIT_HOTKEY);
  editMode = false;
  // NOTE: the config window deliberately STAYS open — its overlay toggle is
  // now how you turn the overlay back on, so closing the overlay must not
  // slam the settings window shut mid-click
  if (isOpen()) win.close();
  win = null;
  broadcastOpen();
}

function register() {
  ipcMain.handle('overlay-set', (_e, on) => {
    if (on) open(); else close();
    return isOpen();
  });
  ipcMain.handle('overlay-is-open', () => isOpen());
  // the MAIN window owns the ESI session; it pushes character data here
  ipcMain.on('overlay-push', (_e, payload) => {
    if (isOpen()) win.webContents.send('overlay-data', payload);
  });
  // the overlay asks to leave edit mode when the user clicks "done"
  ipcMain.on('overlay-edit', (_e, on) => setEdit(on));
  // the setup window can be opened from the Tools menu too, not only Alt+\
  ipcMain.handle('clone-config-open', () => {
    if (!isOpen()) open();
    setEdit(true);
    openConfig();
    return true;
  });
  ipcMain.handle('clone-config-close', () => {
    closeConfig();
    return true;
  });
}

module.exports = { register, open, close, isOpen };
