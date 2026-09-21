// APERTURE — the corp map module. SINCE v0.216.0 IT CONTACTS APERTURE IN NO WAY AT ALL.
//
// It used to embed the corporation's web map as a <webview> guest page (its own persistent login),
// read that page from inside the app, and keep it loaded in the background. Aperture's developer
// told the owner what that cost their server; v0.214–0.215 removed the reading and the background
// loading, and the owner then decided the app should not touch Aperture at all until its
// developer is happy with the method (lib/apertureAccess.ts has the whole story).
//
// So there is no guest page here any more — no <webview>, no session, no pop-up relay; the main
// process does not even grant the window the webview permission. Both tabs show the blocker. The
// one button left opens the user's OWN browser at the address he typed in Settings: that is the
// user visiting the site himself, and the app sends nothing.
import ApertureBlocker from './ApertureBlocker';

export default function ApertureModule({ view = 'map' }: { view?: 'map' | 'summary' }) {
  return (
    <div className="aperture-wrap" style={{ position: 'relative' }}>
      <ApertureBlocker feature={view === 'summary' ? 'Σ Summary — what is out there to do in chain' : 'Corp Map — your corporation’s Aperture map'} />
    </div>
  );
}
