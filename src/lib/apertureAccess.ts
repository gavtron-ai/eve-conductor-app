// APERTURE ACCESS — PAUSED (v0.214.0, 2026-09-20).
//
// Aperture's developer told the owner that what this app did costs their server 6,000–7,000
// requests and about 1 GB a day PER USER, skews their user metrics, and is not a way they
// sanction reading their data. They are right, and the owner's own log agrees:
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
// Until Aperture offers a path THEY designed for this, the app makes NO automated request to
// Aperture and reads NOTHING from it. What is left is a plain embedded browser tab, loaded only
// while the Aperture module is on screen — the same thing as the user's own browser. This flag is
// enforced here (renderer) and in electron/main.cjs (the hidden-window route answers nothing).
//
// RULE 21 applies to third-party services too: a source is sanctioned when its OWNER says so.
export const APERTURE_READS_ENABLED = false;

export const APERTURE_PAUSED_SHORT = 'map reading is paused';
export const APERTURE_PAUSED_WHY =
  'Reading the corp map is paused. Aperture’s developer asked for it to stop — the way this app read the map cost their server thousands of requests a day per user — and a proper, sanctioned data path is being worked out with them. The map itself still opens in the Aperture tab, and “import map from clipboard” in the Theft Conductor still works, because that is you copying your own list.';
