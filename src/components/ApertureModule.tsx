// APERTURE — YOUR corporation's own web map, embedded as a module so the
// whole workflow lives in one app.
//
// The URL is a PER-PLAYER SETTING (Settings → Your setup). It used to be one
// corporation's address compiled into the app, which meant anyone else who
// installed it silently loaded a stranger's private map — and that map's
// login page. Unset, this module explains itself instead of loading anything.
//
// In Electron this is a <webview>: a real guest page with its OWN PERSISTENT
// session (partition "persist:aperture"), so the Aperture login survives
// restarts. An iframe would be a third-party context — the session cookie
// wouldn't be sent and the login would break — which is why the browser-dev
// fallback below is only for layout work, with a link out to a real browser.
//
// v0.215.0 — A PLAIN BROWSER TAB, AND NOTHING ELSE (lib/apertureAccess.ts has the whole story).
// This file used to run scripts inside the map page and call its data routes; all of that is
// deleted. Two rules are left, both about not being a burden on somebody else's server:
//   · the page exists only while the Corp Map tab is on screen — not under the Σ Summary, not
//     under another module, not "kept warm";
//   · and only while a PERSON CAN SEE the window. The app's windows run with background
//     throttling off (the collectors need it), so a page never learns it was minimised — a
//     window left on this tab and sent to the tray kept Aperture's page polling all day. The
//     main process knows, and says so (win.onShown); two minutes after the window disappears the
//     page is unloaded, and it loads again when the window comes back.
import { useEffect, useRef, useState } from 'react';
import { isElectron } from '../lib/auth';
import { useApp } from '../lib/store';
import Tip from './Tip';
import { useZoom } from '../lib/zoom';
import ApertureBlocker from './ApertureBlocker';

/** how long a window may be out of sight before the map page is unloaded (a quick alt-tab or a
 * minimise-and-back must not cost Aperture a fresh page load) */
const HIDDEN_GRACE_MS = 2 * 60_000;

/** minimal typing for Electron's <webview> guest element */
interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  /** zoom the GUEST page (per-screen zoom, v0.200.8) */
  setZoomFactor(factor: number): void;
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string;
        partition?: string;
        allowpopups?: string;
        preload?: string;
        useragent?: string;
      };
    }
  }
}

/** true while this window is on screen, or left it less than HIDDEN_GRACE_MS ago */
function useWindowInSight(): boolean {
  const [inSight, setInSight] = useState(true);
  useEffect(() => {
    const win = window.appInfo?.win;
    if (!win?.onShown) return undefined;   // the browser rig: always in sight
    let timer: ReturnType<typeof setTimeout> | null = null;
    const apply = (shown: boolean) => {
      if (timer) { clearTimeout(timer); timer = null; }
      if (shown) setInSight(true);
      else timer = setTimeout(() => setInSight(false), HIDDEN_GRACE_MS);
    };
    const off = win.onShown(apply);
    void win.isShown?.().then((v) => { if (v === false) apply(false); }).catch(() => undefined);
    return () => { if (timer) clearTimeout(timer); if (typeof off === 'function') off(); };
  }, []);
  return inSight;
}

export default function ApertureModule({ view = 'map', onOpenMap }: { view?: 'map' | 'summary'; onOpenMap?: () => void }) {
  const ref = useRef<WebviewEl | null>(null);
  const configured = (useApp((st) => st.settings.apertureUrl) ?? '').trim();
  const [url, setUrl] = useState(configured);
  const [busy, setBusy] = useState(true);
  const inSight = useWindowInSight();
  const summaryTab = view === 'summary';
  /** the map page exists only while the map is on screen AND the window can be seen */
  const guestMounted = !summaryTab && inSight;

  // PER-SCREEN ZOOM: this screen hosts another page, so the level is
  // applied to the guest (its own text and drawing scale) rather than to
  // the <webview> box; the toolbar follows via CSS zoom below
  const { zoom } = useZoom('aperture');
  useEffect(() => {
    const wv = ref.current;
    if (!wv) return undefined;
    const apply = () => { try { wv.setZoomFactor(zoom); } catch { /* guest not ready yet */ } };
    apply();
    wv.addEventListener('dom-ready', apply);
    return () => wv.removeEventListener('dom-ready', apply);
  }, [zoom, configured, guestMounted]);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return undefined;
    const start = () => { setBusy(true); };
    const stop = () => {
      setBusy(false);
      try {
        setUrl(wv.getURL());
      } catch {
        // guest not ready yet
      }
    };
    wv.addEventListener('did-start-loading', start);
    wv.addEventListener('did-stop-loading', stop);
    // the guest-side shim (webviewPreload.cjs) converts window.open and
    // target=_blank clicks into these messages — the native popup path
    // crashed the guest renderer outright (exit 3, measured twice)
    const onIpc = (e: Event) => {
      const m = e as Event & { channel?: string; args?: unknown[] };
      if (m.channel === 'etc-open-window' && typeof m.args?.[0] === 'string') {
        void window.appInfo?.aperture?.openPopup(m.args[0]);
      }
    };
    wv.addEventListener('ipc-message', onIpc);
    return () => {
      wv.removeEventListener('did-start-loading', start);
      wv.removeEventListener('did-stop-loading', stop);
      wv.removeEventListener('ipc-message', onIpc);
    };
  }, [guestMounted]);

  const nav = (fn: (wv: WebviewEl) => void) => () => {
    const wv = ref.current;
    if (wv) {
      try {
        fn(wv);
      } catch {
        // guest not ready
      }
    }
  };

  // THE Σ SUMMARY was built on reading the map from inside the app — gone (v0.215.0)
  if (summaryTab) {
    return (
      <div className="aperture-wrap" style={{ position: 'relative' }}>
        <ApertureBlocker feature="Σ Summary — what is out there to do in chain" onOpenMap={onOpenMap} />
      </div>
    );
  }

  // NOTHING CONFIGURED = LOAD NOTHING. Embedding a default would point a
  // stranger's app at somebody else's corporation map and its login page.
  if (configured === '') {
    return (
      <div className="aperture-wrap">
        <div className="panel" style={{ margin: 24, maxWidth: 620 }}>
          <h2>Aperture — not set up yet</h2>
          <p className="hint">
            This module embeds <b>your corporation's own web map</b> as a real browser tab with its
            own persistent login, so you can sign in once and copy system lists straight into the
            Theft Conductor.
          </p>
          <p className="hint">
            It has no address yet. Put your map's URL in <b>Settings → Your setup → Corporation map
            (Aperture)</b> and it will appear here.
          </p>
          <p className="hint">
            Nothing is loaded until you do — the app will not open a page you did not choose.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="aperture-wrap" style={{ position: 'relative' }}>
      <div className="aperture-bar" style={{ zoom }}>
        <button className="btn mini" title="Back" onClick={nav((w) => w.canGoBack() && w.goBack())}>←</button>
        <button className="btn mini" title="Forward" onClick={nav((w) => w.canGoForward() && w.goForward())}>→</button>
        <button className="btn mini" title="Reload the map" onClick={nav((w) => w.reload())}>⟳</button>
        <button className="btn mini" title="Jump back to the corp map" onClick={nav((w) => { w.src = configured; })}>🗺 map</button>
        {/* minWidth:0 is load-bearing: a flex item's min-width defaults to its
            CONTENT width, and the SSO login URL is hundreds of nowrap chars —
            without it the bar (and the webview below) stretched the whole app
            wider than the window every time the map wanted a login */}
        <span className="dim" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
          {!guestMounted ? 'unloaded while the window is out of sight' : busy ? 'loading…' : url}
        </span>
        <Tip tip="Aperture runs here as an ordinary browser tab with its OWN persistent login — sign in once and it sticks across restarts. The app reads nothing from it and asks it for nothing; the page is unloaded when you leave this tab or when the window has been out of sight for two minutes. To use your system list: copy it here, then switch to Theft Conductor and hit 'import map from clipboard'.">
          <span className="dim" style={{ fontSize: 12 }}>corp map</span>
        </Tip>
        <button className="btn mini" title="Open Aperture in your normal browser instead"
          onClick={() => window.open(configured, '_blank')}>
          ↗ browser
        </button>
      </div>
      <div className="hint" style={{ margin: '2px 8px 4px', fontSize: 11.5 }}>
        ⚠ The map's <b>overlay pop-out does not work inside the app yet</b> — for the overlay,
        use <b>↗ browser</b> above. Everything else works here.
      </div>
      {guestMounted ? (
        <div className="aperture-guest" style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {isElectron ? (
            // NO allowpopups: the native webview popup path crashes the guest
            // renderer (exit 3) before any handler runs. Popups happen via the
            // preload shim -> ipc-message -> main builds the window.
            <webview
              ref={ref as unknown as React.Ref<HTMLElement>}
              src={configured}
              partition="persist:aperture"
              preload={window.appInfo?.aperturePreloadPath}
              className="aperture-view"
            />
          ) : (
            <iframe title="Aperture" src={configured} className="aperture-view" />
          )}
        </div>
      ) : (
        <div className="panel" style={{ margin: 24, maxWidth: 560 }}>
          <p className="hint">The map was unloaded because this window was out of sight — the app does not keep Aperture’s page running when nobody is looking. It loads again as soon as the window is back.</p>
        </div>
      )}
    </div>
  );
}
