import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Overlay from './components/Overlay';
import CloneConfig from './components/CloneConfig';
import ChainSummary from './components/ChainSummary';
import './lib/devHooks';
import './styles.css';

// the extra windows load the SAME bundle with a hash — one build, no second
// entry point, and each window gets only the UI it needs
const route = window.location.hash;
const isOverlay = route === '#overlay';
const isCloneConfig = route === '#clone-config';
// the chain summary pop-out (v0.200) — a report window fed by the Aperture module
const isChain = route === '#chain-summary';
// a pop-out window: `#module:<id>` renders the full App locked to one module
// with every background collector OFF (only the main window collects)
const moduleMatch = route.match(/^#module:([a-z]+)$/);
const secondaryModule = moduleMatch ? moduleMatch[1] : null;
if (isOverlay) document.body.classList.add('overlay-body');
if (isCloneConfig) document.body.classList.add('cfg-window');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOverlay ? <Overlay /> : isCloneConfig ? <CloneConfig /> : isChain ? <ChainSummary /> : <App secondaryModule={secondaryModule} />}
  </React.StrictMode>,
);
