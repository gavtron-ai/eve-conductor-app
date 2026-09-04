const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('appInfo', {
  isElectron: true,
  platform: process.platform,
  // sandboxed preload can't require local modules — fetch the scope list from main
  ssoScopes: ipcRenderer.sendSync('sso-scopes'),
  /** the exact callback URL the login server binds — what a user must
   * register on their own EVE application for a login to complete */
  ssoCallback: ipcRenderer.sendSync('sso-callback'),
  /** Aperture webview support: the guest-side popup shim's path, and the
   * relay that asks main to build a popup window (see webviewPreload.cjs) */
  aperturePreloadPath: ipcRenderer.sendSync('aperture-preload-path'),
  updates: {
    /** fires when a new version has finished downloading (installs on quit) */
    onReady: (cb) => ipcRenderer.on('update-ready', (_e, info) => cb(info)),
    restart: () => ipcRenderer.invoke('update-restart'),
  },
  sso: {
    login: (clientId) => ipcRenderer.invoke('sso-login', clientId),
    refresh: (clientId, refreshToken) =>
      ipcRenderer.invoke('sso-refresh', { clientId, refreshToken }),
  },
  stats: {
    info: () => ipcRenderer.invoke('stats-info'),
    append: (lines) => ipcRenderer.invoke('stats-append', lines),
    readAll: () => ipcRenderer.invoke('stats-read'),
    files: () => ipcRenderer.invoke('stats-files'),
    auxWrite: (name, content) => ipcRenderer.invoke('stats-aux-write', { name, content }),
    auxRead: (name) => ipcRenderer.invoke('stats-aux-read', name),
    auxAppend: (name, lines) => ipcRenderer.invoke('stats-aux-append', { name, lines }),
    auxFiles: () => ipcRenderer.invoke('stats-aux-files'),
    /** names+size+mtime only — never pulls file contents */
    auxNames: () => ipcRenderer.invoke('stats-aux-names'),
    import: (files) => ipcRenderer.invoke('stats-import', files),
  },
  /** diagnostics: a plain record of what the app did. Never carries tokens —
   * the main process scrubs every value before it reaches the file. */
  devlog: {
    append: (entries) => ipcRenderer.invoke('devlog-append', entries),
    tail: (lines) => ipcRenderer.invoke('devlog-tail', lines),
    info: () => ipcRenderer.invoke('devlog-info'),
  },
  /** per-player setup, stored in Documents/EVE Conductor/config.json.
   * Never carries login tokens — those stay on the machine that made them. */
  config: {
    read: () => ipcRenderer.invoke('config-read'),
    write: (patch) => ipcRenderer.invoke('config-write', patch),
    path: () => ipcRenderer.invoke('config-path'),
  },
  /** the corp killboard read as a real PAGE in a hidden window — the live
   * list that zkill's cached APIs run ~30 min behind */
  zkill: {
    pageIds: (corpId) => ipcRenderer.invoke('zkill-page-ids', corpId),
    charKills: (charId) => ipcRenderer.invoke('zkill-char-kills', charId),
    /** a system's recent killmails (window in seconds) for the gatecamp check */
    systemKills: (systemId, pastSeconds) => ipcRenderer.invoke('zkill-system-kills', { systemId, pastSeconds }),
  },
  /** EvE-Scout Rescue's Storm Track page (player-reported storm positions)
   * — fetched by main because the page sends no CORS header */
  storms: {
    page: () => ipcRenderer.invoke('storms-page'),
  },
  /** the OS clipboard, READ-ONLY — the Theft Conductor's Aperture auto-import
   * watches this; main reads it without the focus gate the renderer has */
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard-read'),
  },
  /** the owner's Aperture map, read from his own logged-in session in a hidden
   * window — returns the Systems-table text (or '' if it couldn't be read) */
  aperture: {
    systems: (url) => ipcRenderer.invoke('aperture-systems', url),
    /** open a popup window for the map (guest-side shim relays here) */
    openPopup: (url) => ipcRenderer.invoke('aperture-open-popup', url),
  },
  /** the EVE client's game logs, READ-ONLY via main — open/read/close per
   * call, no held handles: the game is never touched */
  gamelog: {
    list: () => ipcRenderer.invoke('gamelog-list'),
    read: (file) => ipcRenderer.invoke('gamelog-read', file),
  },
  /** AI fight write-ups. The Anthropic key lives in Documents/EVE Conductor/
   * anthropic.json and is read by the MAIN process only — the renderer sends
   * a digest of computed facts and gets prose (or an error) back. */
  narrative: {
    status: () => ipcRenderer.invoke('narrative-status'),
    write: (digest) => ipcRenderer.invoke('narrative-write', digest),
    /** write-only: stores (or clears, with '') the key; answers status only */
    setKey: (apiKey) => ipcRenderer.invoke('narrative-set-key', apiKey),
  },
  /** bulk fit import path: write a file the EVE client can import directly */
  fittings: {
    exportXml: (fileName, content, clearOurs) => ipcRenderer.invoke('fittings-export', { fileName, content, clearOurs }),
    dir: () => ipcRenderer.invoke('fittings-dir'),
    /** pyfa export: user picks a folder, one EFT .txt per unique fit */
    exportEftFolder: (files) => ipcRenderer.invoke('fittings-export-folder', files),
  },
  backup: {
    save: (defaultName, content) => ipcRenderer.invoke('backup-save', { defaultName, content }),
  },
  win: {
    setAlwaysOnTop: (on) => ipcRenderer.invoke('win-set-always-on-top', on),
    setCloseToTray: (on) => ipcRenderer.invoke('win-set-close-to-tray', on),
    /** open a second window showing one module (no background collectors) */
    openModule: (moduleId) => ipcRenderer.invoke('open-module-window', moduleId),
    /** a pop-out reports its CURRENT module so the saved layout stays accurate */
    reportModule: (moduleId) => ipcRenderer.send('module-window-module', moduleId),
  },
  overlay: {
    set: (on) => ipcRenderer.invoke('overlay-set', on),
    isOpen: () => ipcRenderer.invoke('overlay-is-open'),
    /** main window → overlay: live per-character data */
    push: (payload) => ipcRenderer.send('overlay-push', payload),
    /** overlay window: receive data / edit-mode changes */
    onData: (cb) => ipcRenderer.on('overlay-data', (_e, payload) => cb(payload)),
    onEdit: (cb) => ipcRenderer.on('overlay-edit-changed', (_e, on) => cb(on)),
    /** every window: the overlay opened/closed (whichever window flipped it) */
    onOpenChanged: (cb) => ipcRenderer.on('overlay-open-changed', (_e, on) => cb(on)),
    setEdit: (on) => ipcRenderer.send('overlay-edit', on),
  },
  /** the clone registry — every pod the app has seen, owned by the main
   * process so all three windows read one copy (see cloneStore.cjs) */
  clones: {
    all: () => ipcRenderer.invoke('clones-all'),
    /** main window → registry: a batch of observations from one poll */
    record: (list) => ipcRenderer.send('clones-record', list),
    setConfig: (cfg) => ipcRenderer.invoke('clones-set', cfg),
    forget: (cfg) => ipcRenderer.invoke('clones-forget', cfg),
    onChanged: (cb) => ipcRenderer.on('clones-changed', (_e, d) => cb(d)),
    openConfig: () => ipcRenderer.invoke('clone-config-open'),
    closeConfig: () => ipcRenderer.invoke('clone-config-close'),
  },
});
