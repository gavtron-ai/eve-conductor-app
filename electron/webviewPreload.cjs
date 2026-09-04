// GUEST-SIDE POPUP SHIM (v0.188.3) — runs inside the Aperture webview.
//
// MEASURED (2026-09-04, twice): letting the guest renderer enter Electron's
// native webview-popup path kills it with exit code 3 BEFORE any
// main-process window-open handler runs — deny/allow makes no difference
// because the crash precedes the handler. So the guest must never take
// that path at all: window.open and target=_blank clicks are intercepted
// HERE, the URL leaves via sendToHost, and the main process builds a real
// window on the same session. The stub return object satisfies callers
// that poke the handle of a fire-and-forget popup.
const { ipcRenderer } = require('electron');

const send = (url) => {
  try { ipcRenderer.sendToHost('etc-open-window', String(url ?? '')); } catch { /* host gone */ }
};

const stub = {
  closed: false,
  focus() {}, blur() {}, close() {}, print() {},
  postMessage() {},
  location: { href: '' },
};

window.open = (url) => { send(url); return stub; };

// anchor clicks with target=_blank take the same native path as
// window.open — catch them in the capture phase before the site does
window.addEventListener('click', (e) => {
  const t = e.target;
  const a = t && typeof t.closest === 'function' ? t.closest('a[target="_blank"]') : null;
  if (a && a.href) {
    e.preventDefault();
    send(a.href);
  }
}, true);
