// HOW THE APP IDENTIFIES ITSELF (v0.199.2) — one string, used everywhere.
//
// ESI's guidelines, zKillboard's API rules and Fuzzwork all ask the same
// thing: a User-Agent that names the app, its version, and a way to reach
// whoever runs it. The contact is the PUBLIC repository URL — never an
// email: the shareability guard forbids personal data in shipped builds
// (RULES.md), and a corp mate's copy must not carry the owner's address.
//
// main.cjs sets this as the Electron user-agent fallback before any window
// exists, so EVERY renderer request (ESI, Fuzzwork, br.evetools, the zKill
// rig fallback) carries it automatically — Chromium sends the session UA
// on fetch(), which a page cannot override but the app can. The main-
// process fetchers (zkill.cjs, storms.cjs) import it directly.
const { app } = require('electron');

const REPO = 'https://github.com/gavtron-ai/eve-conductor-app';
const USER_AGENT = `EVE-Conductor/${app?.getVersion?.() ?? 'dev'} (+${REPO})`;

module.exports = { USER_AGENT, REPO };
