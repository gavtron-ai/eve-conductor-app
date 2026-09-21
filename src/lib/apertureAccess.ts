// APERTURE ACCESS — every automated interaction REMOVED (paused in v0.214.0, deleted in v0.215.0).
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
// v0.215.0 — NONE OF THAT CODE EXISTS ANY MORE. The scripts that ran inside the map page, the
// hidden-window reader (electron/aperturePage.cjs), its IPC route and its preload bridge are
// deleted, not switched off: there is no flag that brings them back. What is left is a plain
// embedded browser tab that exists only while a person can actually see it — the Corp Map tab on
// screen, in a window that is not minimised or hidden (components/ApertureModule.tsx).
//
// The features that were built on the reading (Σ Summary, Home chain dashlets, the Theft
// Conductor's "pull from Aperture") show a blocker until Aperture's developer offers a data path
// THEY designed. RULE 21 applies to third-party services too: a source is sanctioned when its
// OWNER says so, not when a login happens to make it reachable.

/** the features built on reading the map: unavailable until a sanctioned path exists */
export const APERTURE_FEATURES_AVAILABLE = false;

export const APERTURE_BLOCK_TITLE = 'Unavailable for now — we are reworking how this talks to Aperture';
export const APERTURE_BLOCK_BODY =
  'This feature was built on reading your corporation’s Aperture map from inside the app. The way it did that put a heavy, unsanctioned load on Aperture’s servers, so it has been removed. We are working with Aperture’s developer on a proper way to get this data. Until that is solved properly, this feature is unavailable.';
export const APERTURE_BLOCK_STILL =
  'What still works: the Corp Map tab (the map itself, as an ordinary browser tab), opening Aperture in your own browser, and “import map from clipboard” in the Theft Conductor — that is you copying your own list by hand.';
export const APERTURE_BLOCK_SHORT = 'Unavailable for now — the way the app reads Aperture is being reworked with its developer.';
