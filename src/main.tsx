import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import Overlay from './components/Overlay';
import CloneConfig from './components/CloneConfig';
import './lib/devHooks';
import './styles.css';

// the extra windows load the SAME bundle with a hash — one build, no second
// entry point, and each window gets only the UI it needs
const route = window.location.hash;
const isOverlay = route === '#overlay';
const isCloneConfig = route === '#clone-config';
// a pop-out window: `#module:<id>` renders the full App locked to one module
// with every background collector OFF (only the main window collects)
const moduleMatch = route.match(/^#module:([a-z]+)$/);
const secondaryModule = moduleMatch ? moduleMatch[1] : null;
if (isOverlay) document.body.classList.add('overlay-body');
if (isCloneConfig) document.body.classList.add('cfg-window');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isOverlay ? <Overlay /> : isCloneConfig ? <CloneConfig /> : <App secondaryModule={secondaryModule} />}
  </React.StrictMode>,
);
