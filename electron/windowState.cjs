// WHERE THE WINDOW WAS LAST TIME.
//
// The app is reinstalled often (that IS the ship ritual here), and every
// install put the window back in the middle of the primary monitor — on a
// 5120x1440 desktop that is a move every single time.
//
// Stored beside the other portable per-player settings rather than in the
// install directory, so an upgrade cannot lose it. Nothing here is
// account-specific, so it carries no sharing risk.
const fs = require('fs');
const path = require('path');
const { screen } = require('electron');

const FILE = 'window-state.json';

const filePath = (documentsPath) =>
  path.join(documentsPath, 'EVE Conductor', FILE);

/** the saved bounds, or null when there is nothing usable */
function read(documentsPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(filePath(documentsPath), 'utf8'));
    if (typeof raw?.width !== 'number' || typeof raw?.height !== 'number') return null;
    return raw;
  } catch {
    return null;
  }
}

/** atomic write — a half-written file here would cost the whole layout */
function write(documentsPath, state) {
  try {
    const dir = path.dirname(filePath(documentsPath));
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${filePath(documentsPath)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, filePath(documentsPath));
  } catch {
    // a window that cannot remember its place is a nuisance, not a failure
  }
}

/**
 * Saved bounds, but only if they still land on a monitor that EXISTS.
 *
 * Unplugging a screen, or a laptop docking somewhere different, otherwise
 * restores the window to coordinates nothing can display — it opens
 * "successfully" and is invisible, which is far worse than being centred.
 * A window is accepted when its top-left corner sits inside some display's
 * work area with enough margin to grab the title bar.
 */
function usableBounds(documentsPath) {
  const saved = read(documentsPath);
  if (!saved) return null;
  if (typeof saved.x !== 'number' || typeof saved.y !== 'number') {
    // size only — let Electron place it
    return { width: saved.width, height: saved.height, maximized: !!saved.maximized };
  }
  const MARGIN = 80;
  const onScreen = screen.getAllDisplays().some((d) => {
    const a = d.workArea;
    return saved.x + saved.width > a.x + MARGIN
      && saved.x < a.x + a.width - MARGIN
      && saved.y + 40 > a.y
      && saved.y < a.y + a.height - MARGIN;
  });
  if (!onScreen) return { width: saved.width, height: saved.height, maximized: !!saved.maximized };
  return saved;
}

/**
 * Track a window and persist its placement.
 *
 * Saves on the settle of a move/resize rather than on every pixel, and reads
 * the NORMAL bounds when maximized so un-maximizing later restores the size
 * the user actually chose.
 */
function track(win, documentsPath) {
  let timer = null;
  const save = () => {
    if (win.isDestroyed() || win.isMinimized()) return;
    const bounds = win.isMaximized() ? win.getNormalBounds() : win.getBounds();
    write(documentsPath, { ...bounds, maximized: win.isMaximized() });
  };
  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(save, 400);
  };
  win.on('resize', debounced);
  win.on('move', debounced);
  win.on('maximize', debounced);
  win.on('unmaximize', debounced);
  // close is the one that must not be debounced away
  win.on('close', () => {
    if (timer) clearTimeout(timer);
    save();
  });
}

// ---- POP-OUT MODULE WINDOWS ----
// The main window is one saved object; the pop-outs are a LIST — which modules
// were open and where — so quitting with several windows up brings them all
// back next launch. Same portable location, same atomic write, same
// off-a-missing-monitor guard applied per entry.
const MODULE_FILE = 'module-windows.json';
const moduleFilePath = (documentsPath) => path.join(documentsPath, 'EVE Conductor', MODULE_FILE);

function readModuleLayout(documentsPath) {
  try {
    const raw = JSON.parse(fs.readFileSync(moduleFilePath(documentsPath), 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeModuleLayout(documentsPath, list) {
  try {
    const dir = path.dirname(moduleFilePath(documentsPath));
    fs.mkdirSync(dir, { recursive: true });
    const tmp = `${moduleFilePath(documentsPath)}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, moduleFilePath(documentsPath));
  } catch {
    // a layout that cannot be remembered is a nuisance, not a failure
  }
}

/** the saved pop-outs, each with bounds that still land on an attached display
 * (off-screen entries keep their size but drop the coordinates, so Electron
 * places them somewhere visible rather than on a monitor that is gone) */
function usableModuleLayout(documentsPath) {
  const MARGIN = 80;
  const onScreen = (b) =>
    typeof b.x === 'number' && typeof b.y === 'number' &&
    screen.getAllDisplays().some((d) => {
      const a = d.workArea;
      return b.x + b.width > a.x + MARGIN
        && b.x < a.x + a.width - MARGIN
        && b.y + 40 > a.y
        && b.y < a.y + a.height - MARGIN;
    });
  return readModuleLayout(documentsPath)
    .filter((e) => e && typeof e.moduleId === 'string')
    .map((e) => (onScreen(e) ? e : { moduleId: e.moduleId, width: e.width, height: e.height, maximized: !!e.maximized }));
}

module.exports = { usableBounds, track, readModuleLayout, writeModuleLayout, usableModuleLayout };
