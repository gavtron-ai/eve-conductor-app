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
import { CHAIN_EXTRACT, chainSigsScript, type ChainExtract, type FeedRead } from '../lib/apertureExtract';
import { inferMap, inferSignatures, type FeedReport } from '../lib/chainFeed';
import type { ChainSig } from '../lib/chain';
import { logUser } from '../lib/devlog';
import { useZoom } from '../lib/zoom';
import ChainSummary from './ChainSummary';



/** minimal typing for Electron's <webview> guest element */
interface WebviewEl extends HTMLElement {
  src: string;
  canGoBack(): boolean;
  canGoForward(): boolean;
  goBack(): void;
  goForward(): void;
  reload(): void;
  getURL(): string;
  /** run a script inside the map page — the chain summary's reader */
  executeJavaScript(code: string, userGesture?: boolean): Promise<unknown>;
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

export default function ApertureModule({ view = 'map' }: { view?: 'map' | 'summary' }) {
  const ref = useRef<WebviewEl | null>(null);
  const configured = (useApp((st) => st.settings.apertureUrl) ?? '').trim();
  const [url, setUrl] = useState(configured);
  const [busy, setBusy] = useState(true);
  // the latest map reading, for the Σ Summary tab (v0.200.12 — a tab, not
  // a pop-out; the map's guest page stays mounted underneath, hidden, so
  // it keeps its login and can still be read)
  const [latest, setLatest] = useState<(ChainExtract & { at: number }) | null>(null);
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
  }, [zoom, configured]);

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

  // CHAIN SUMMARY (v0.200): read the map in place — the Signature Search
  // table and the drawn chain — and hand it to the summary window through
  // main. The structure probe rides along into the diagnostics log so the
  // parser can be locked to the real map after the first press.
  const runChainExtract = async () => {
    const w = ref.current;
    if (!w) return;
    try {
      const res = (await w.executeJavaScript(CHAIN_EXTRACT, true)) as ChainExtract;
      const rows = res.sigText ? res.sigText.split('\n').length : 0;
      // THE FEED (v0.200.3): the map's own JSON, complete and unfiltered,
      // whatever the panel shows. Field roles are inferred (chainFeed.ts)
      // and reported; per-system lists come from a second script.
      let feedRead: FeedRead | null = null;
      if (res.feed?.map) {
        const now = Date.now();
        const m = inferMap(res.feed.map, res.graph.nodes);
        const report: FeedReport = { ...m.report, sigs: null };
        let sigs: ChainSig[] = [];
        if (m.systems.length > 0) {
          // signatures may already be inside the map document or system-data
          for (const doc of [res.feed.map, res.feed.systemData]) {
            if (!doc) continue;
            const r = inferSignatures(doc, m.systems, null, now);
            if (r.sigs.length > 0) { sigs = sigs.concat(r.sigs); report.sigs = r.report; }
          }
          if (sigs.length === 0) {
            const drawn = new Set(res.graph.nodes.map((n) => n.id));
            const ids = m.systems.filter((s) => drawn.has(s.id)).map((s) => s.id);
            const per = (await w.executeJavaScript(chainSigsScript(res.feed.mapId, ids), true)) as Record<string, unknown>;
            let lists = 0, failed = 0;
            for (const sid of ids) {
              const doc = per[sid];
              if (!doc || (typeof doc === 'object' && ('__status' in (doc as object) || '__error' in (doc as object)))) { failed++; continue; }
              lists++;
              const r = inferSignatures(doc, m.systems, m.systems.find((s) => s.id === sid) ?? null, now);
              sigs = sigs.concat(r.sigs);
              if (r.report && (!report.sigs || r.report.count > report.sigs.count)) report.sigs = r.report;
            }
            report.notes.push(`per-system lists: ${lists} read, ${failed} failed, of ${ids.length} drawn`);
          }
        }
        feedRead = { systems: m.systems, edges: m.edges, sigs, home: m.home ? { id: m.home.id, label: m.home.label } : null, report, status: res.feed.status };
      }
      logUser('chain: map read', { rows, header: res.sigHeader, probe: res.probe, feed: feedRead ? { systems: feedRead.systems.length, edges: feedRead.edges.length, sigs: feedRead.sigs.length, report: feedRead.report, status: feedRead.status } : null });
      const payload = { ...res, feed: undefined, feedRead, at: Date.now() };
      setLatest(payload);
      window.appInfo?.chain?.post(payload);
    } catch (e) {
      logUser('chain: map read failed', { err: e instanceof Error ? e.message : String(e) });
    }
  };
  useEffect(() => {
    window.appInfo?.chain?.onRefreshRequest?.(() => { void runChainExtract(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const summaryTab = view === 'summary';
  return (
    <div className="aperture-wrap" style={{ position: 'relative' }}>
      {summaryTab && (
        <div className="aperture-summary" style={{ flex: 1, minHeight: 0, overflow: 'auto', zoom }}>
          <ChainSummary embedded={{ reading: latest, onRefresh: () => { void runChainExtract(); } }} />
        </div>
      )}
      {!summaryTab && (
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
      )}
      {!summaryTab && (
      <div className="hint" style={{ margin: '2px 8px 4px', fontSize: 11.5 }}>
        ⚠ The map's <b>overlay pop-out does not work inside the app yet</b> — for the overlay,
        use <b>↗ browser</b> above. Everything else works here.
      </div>
      )}
      {/* the guest stays MOUNTED on the summary tab: visibility (never
          display:none, which unloads a <webview>) hides it at full size,
          so its login persists and the summary can keep reading it */}
      <div className="aperture-guest" style={summaryTab
        ? { position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', visibility: 'hidden', pointerEvents: 'none', zIndex: -1 }
        : { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
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
    </div>
  );
}
