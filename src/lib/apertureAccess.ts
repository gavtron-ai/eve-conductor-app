// APERTURE ACCESS — THERE IS NONE. The app does not contact Aperture in any way (v0.216.0).
//
// Aperture's developer told the owner that what this app did cost their server 6,000–7,000
// requests and about 1 GB a day PER USER, skewed their user metrics, and was not a way they
// sanction reading their data. They were right, and the owner's own log agreed:
//   · once opened, the map page stayed loaded — hidden — for as long as the app ran (the app is
//     meant to run all day), so the page's own polling ran around the clock for every user and
//     every user looked "online" to Aperture 24 hours a day;
//   · every 5 minutes the app fetched the WHOLE map document and the WHOLE system-data document
//     again from the page's own session, and a hidden page never finished drawing, so each cycle
//     re-tried up to ten times (measured on 2026-09-19: 119 readings, 632 retries, 1,502
//     full-document fetches in one day);
//   · with the raid alert on, a hidden window loaded the whole map application every 30 minutes;
//   · each page load re-downloaded up to 40 of the map's script and style files to look for colours.
//
// THE STEPS:
//   v0.214.0  the reading switched off;
//   v0.215.0  the reading code DELETED (in-page scripts, the hidden-window reader, its route and
//             bridge), and the embedded map unloaded whenever its window was out of sight;
//   v0.216.0  the owner: "I don't even want to interact with Aperture like that for now … completely
//             clear of interactions with Aperture until the dev of our corp map is happy with the
//             method of interaction." The embedded map is gone too: no <webview>, no guest preload,
//             no pop-up relay, no Aperture session, and the windows no longer hold the webview
//             permission at all. The app makes NO request to Aperture of any kind.
//
// What is left is a button that opens the user's OWN browser at the address he typed in Settings
// (the user visiting the site himself), and the Theft Conductor's clipboard import (a list the
// user copied himself). Every Aperture screen shows a blocker until Aperture's developer offers
// — and is happy with — a way of doing this. RULE 21 applies to third-party services too: a
// source is sanctioned when its OWNER says so, not when a login happens to make it reachable.

/** the features built on the corp map: unavailable until its developer is happy with a method */
export const APERTURE_FEATURES_AVAILABLE = false;

export const APERTURE_BLOCK_TITLE = 'Unavailable for now — we are reworking how this talks to Aperture';
export const APERTURE_BLOCK_BODY =
  'EVE Conductor used to load and read your corporation’s Aperture map from inside the app. The way it did that put a heavy load on Aperture’s servers that its developer never agreed to, so all of it has been removed: the app no longer contacts Aperture in any way. We are working with Aperture’s developer on a proper way to do this. Until that is solved properly and they are happy with the method, this feature is unavailable.';
export const APERTURE_BLOCK_STILL =
  'What still works: Aperture in your own web browser, exactly as before (the button below only opens your browser — the app itself sends nothing), and “📋 import map from clipboard” in the Theft Conductor, which reads a system list you copied yourself.';
export const APERTURE_BLOCK_SHORT = 'Unavailable for now — how the app works with Aperture is being reworked with its developer; the app does not contact Aperture at all.';
