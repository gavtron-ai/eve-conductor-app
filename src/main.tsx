import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import CloneConfig from './components/CloneConfig';
import ChainSummary from './components/ChainSummary';
import './lib/devHooks';
import { logWarn } from './lib/devlog';
import './styles.css';

// the extra windows load the SAME bundle with a hash and each gets only the UI it needs — except
// the overlay, which has its own slim entry since v0.234.0 (overlay.html → src/overlay.tsx)
const route = window.location.hash;
// '#clone-config' or '#clone-config/<page>' (v0.202.1: Alt+] lands on /alerts)
const isCloneConfig = route === '#clone-config' || route.startsWith('#clone-config/');
// the chain summary pop-out (v0.200) — a report window fed by the Aperture module
const isChain = route === '#chain-summary';
// a pop-out window: `#module:<id>` renders the full App locked to one module
// with every background collector OFF (only the main window collects)
const moduleMatch = route.match(/^#module:([a-z]+)$/);
const secondaryModule = moduleMatch ? moduleMatch[1] : null;
// the Content-Security-Policy (vite.config.ts) refuses any request to a host it does not list — say
// so in the dev log, so a blocked call is diagnosable instead of a silent failure (first 30 only)
let cspReports = 0;
document.addEventListener('securitypolicyviolation', (e) => {
  if (cspReports++ >= 30) return;
  logWarn('csp', `refused by the security policy: ${e.violatedDirective}`, { blocked: String(e.blockedURI).slice(0, 160), from: String(e.sourceFile || '').split('/').pop()?.slice(0, 60), line: e.lineNumber });
});
if (isCloneConfig) document.body.classList.add('cfg-window');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isCloneConfig ? <CloneConfig /> : isChain ? <ChainSummary /> : <App secondaryModule={secondaryModule} />}
  </React.StrictMode>,
);
