// THE OVERLAY'S OWN ENTRY (v0.234.0, audit F8). The always-on-top panel used to load the whole
// app bundle with a #overlay hash and pick its component at run time — 4.3 MB of script and 72 MB
// of JS heap (measured in the rig) for a panel that draws what the main window sends it. This
// entry carries the panel and only what it imports; the main window keeps feeding it as before.
import React from 'react';
import ReactDOM from 'react-dom/client';
import Overlay from './components/Overlay';
import { logWarn } from './lib/devlog';
import './styles.css';

// the same refusal log as main.tsx: a blocked request is never silent
let cspReports = 0;
document.addEventListener('securitypolicyviolation', (e) => {
  if (cspReports++ >= 30) return;
  logWarn('csp', `refused by the security policy: ${e.violatedDirective}`, { blocked: String(e.blockedURI).slice(0, 160), from: String(e.sourceFile || '').split('/').pop()?.slice(0, 60), line: e.lineNumber });
});
document.body.classList.add('overlay-body');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Overlay />
  </React.StrictMode>,
);
