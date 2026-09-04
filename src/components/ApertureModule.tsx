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
import { useEffect, useRef, useState } from 'react';
import { isElectron } from '../lib/auth';
import { useApp } from '../lib/store';
import Tip from './Tip';



/** minimal typing for Electron's <webview> guest element */
interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
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

export default function ApertureModule() {
  const ref = useRef<WebviewEl | null>(null);
  const configured = (useApp((st) => st.settings.apertureUrl) ?? '').trim();
  const [url, setUrl] = useState(configured);
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    const wv = ref.current;
    if (!wv) return;
    const start = () => setBusy(true);
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
  }, []);

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
    <div className="aperture-wrap">
      <div className="aperture-bar">
        <button className="btn mini" title="Back" onClick={nav((w) => w.canGoBack() && w.goBack())}>←</button>
        <button className="btn mini" title="Forward" onClick={nav((w) => w.canGoForward() && w.goForward())}>→</button>
        <button className="btn mini" title="Reload the map" onClick={nav((w) => w.reload())}>⟳</button>
        <button className="btn mini" title="Jump back to the corp map" onClick={nav((w) => { w.src = configured; })}>🗺 map</button>
        {/* minWidth:0 is load-bearing: a flex item's min-width defaults to its
            CONTENT width, and the SSO login URL is hundreds of nowrap chars —
            without it the bar (and the webview below) stretched the whole app
            wider than the window every time the map wanted a login */}
        <span className="dim" style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12 }}>
          {busy ? 'loading…' : url}
        </span>
        <Tip tip="Aperture runs here as a real browser tab with its OWN persistent login — sign in once and it sticks across restarts. Copy your system list here, then switch to Theft Conductor and hit 'import map from clipboard'.">
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
  );
}
