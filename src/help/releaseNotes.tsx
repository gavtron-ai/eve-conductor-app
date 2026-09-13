// RELEASE NOTES — every version since the beta began, newest first: what
// changed, WHY it changed, and — where a change was made to stay clear of
// CCP's rules — the policy reasoning, spelled out. Shown from the 📋
// button in the header (Help.tsx).
//
// RULE 20 (extended v0.199.3): every shipped version adds an entry here
// as part of its definition of done. Write the why, not just the what; a
// corp mate reading this should understand the decision, not just the
// diff. Versions before 0.186 predate the beta and live in the project's
// PLAN log only.
import type { ReactNode } from 'react';

export interface ReleaseNote {
  version: string;
  /** ISO date the version was installed / released */
  date: string;
  headline: string;
  /** what changed, one line each */
  changes: ReactNode[];
  /** why — the request, the bug, or the decision behind it */
  why: ReactNode;
  /** present when the change exists to keep the app inside CCP's terms or a
   * third-party service's rules — the reasoning, plainly */
  policy?: ReactNode;
  /** true when the version reached the public release feed */
  published?: boolean;
}

export const RELEASE_NOTES: ReleaseNote[] = [
  {
    version: '0.199.5', date: '2026-09-13', headline: 'Log Visualizer Feed: search, filters, an opponent filter, and a scrubbable timeline', published: true,
    changes: [
      <>A search box over the feed (pilot, ship, weapon, ore, amount — every word must match).</>,
      <>Filters by what you were doing: you dealt, you received, EWAR, mining, ship changes, other — each with a count.</>,
      <>An opponent filter: pick one pilot and the feed becomes your exchange with them, both directions.</>,
      <>A timeline strip over the scoped window whose ticks are the filtered lines; click or drag it and the list scrolls there and highlights the moment; scroll the list and the cursor follows.</>,
    ],
    why: <>"I want the feed to be a bit easier to look through … a timeline … where I can scroll through and have the feed scroll and maybe highlight … like I was trying to kill someone, let me filter by that attempt." The filtering is a pure function pinned by fixtures; the list now runs oldest to newest so the strip reads left to right.</>,
  },
  {
    version: '0.199.4', date: '2026-09-12', headline: 'Log Visualizer: custom start and end for every section; policy page covers the other services',
    changes: [
      <>The custom window controls moved from the mining section into the range bar, so they work in Overview, Damage, EWAR &amp; Cap, Mining and Feed alike; clicking the damage and cap timelines now sets the time too.</>,
      <>The ⚖ policy page gained a second table: the rules of every other service the app talks to (zKillboard, Fuzzwork, the storm tracker, br.evetools, your corp map, GitHub, Anthropic) and how the app behaves on each.</>,
    ],
    why: <>Two items from the update notice to the corp: custom start and end times "for all sections, not just mining", and a review of the terms "of not only EVE but services such as zKill". The scoping had always been global; only the buttons were parked inside the mining section.</>,
    policy: <>The app is a guest on every third-party service it reads; each one's rules are now stated next to the behaviour, with the same status column as CCP's.</>,
  },
  {
    version: '0.199.3', date: '2026-09-12', headline: 'Release notes and the policy page, in the header',
    changes: [
      <>📋 <b>Release notes</b> next to the ⓘ guide: every version since the beta, with what changed and why.</>,
      <>⚖ <b>Policy</b> page: CCP's rules that touch a tool like this, paraphrased with links to the originals, beside how the app keeps to each one — and the questions we asked ourselves.</>,
    ],
    why: <>Gavin asked for the change history to live in the app, with the reasoning kept along the way, "especially when the goal was to avoid breaking any TOS" — and for the rules themselves to sit next to the evidence of compliance.</>,
    policy: <>CCP's terms are their copyrighted text, so the policy page paraphrases each clause and links to the original rather than copying it.</>,
  },
  {
    version: '0.199.2', date: '2026-09-12', headline: 'The app identifies itself on every request; CCP notice; fewer overlay requests',
    changes: [
      <>Every request the app makes carries one identification string: the app name, its version, and the public source repository as contact. Nothing personal.</>,
      <>The CCP trademark and permission notice now appears inside the app (⚙ Settings → About, and every guide's "About" page), not only in the license file.</>,
      <>The overlay asks CCP for the online flag and the implant list only when CCP's own cache on the last answer has expired.</>,
    ],
    why: <>Follow-ups from the policy audit chosen because none of them changes how the app feels: CCP served the same cached body between expiries anyway, so the overlay shows nothing staler while making a tenth to a twentieth of those requests.</>,
    policy: <>ESI's guidelines ask third-party apps to identify themselves with contact information and to not re-request before a cache expires; the Developer License expects the CCP notice wherever CCP's images and data are shown. Token encryption at rest was deliberately deferred: it would change startup behaviour.</>,
  },
  {
    version: '0.199.1', date: '2026-09-12', headline: 'Battle Reports read zKillboard through its public API only',
    changes: [
      <>The hidden browser that loaded the corp's killboard page is gone; the corp-wide kill list comes from zKill's JSON API, identified, one request at a time, backing off when asked.</>,
      <>Fights involving your own logged-in characters still arrive live from CCP; a logged-in Director would make the whole corp feed live from CCP.</>,
      <>The tab says plainly that zKill caches its lists for up to an hour.</>,
    ],
    why: <>The page reader existed to beat zKill's cache. It was scraping a site that bans scrapers, while presenting itself as a plain browser to pass their bot check — the app's largest exposure to a third party's rules. Gavin chose the honest delay over relying on a Director always being logged in.</>,
    policy: <>zKill's API rules: identify with contact, keep requests spaced, honour rate limits. Measured before deciding: their list cache is one hour, not the thirty minutes previously recorded, and that is what the UI now states.</>,
  },
  {
    version: '0.199.0', date: '2026-09-12', headline: 'The "needs you" trade box is removed; the policy audit is recorded',
    changes: [
      <>The overlay box that tried to flag trade sessions, and the click that brought a client window to the front, are removed entirely.</>,
      <>A full audit of every external contact point in the app is recorded in the project docs and summarised on the ⚖ page.</>,
    ],
    why: <>The box could not do the one thing it was for. EVE writes nothing to its logs when a trade is <i>opened</i> — measured on 250 historical sessions, on a live test with items and ships dropped in, and against the live API specification — so it could only report a trade after it ended. It also caused a real bug: while the cursor was over the box the overlay accepted clicks, and when the box vanished under the cursor the overlay kept swallowing every click until it was toggled.</>,
    policy: <>Gavin's line: "not even close to breaking policy." The one remaining lead for detecting a trade opening (CCP's LogLite debug stream) sits in a grey area and was dropped without being tried.</>,
  },
  {
    version: '0.198.3', date: '2026-09-11', headline: 'Client focus without any synthetic input; rule 21',
    changes: [
      <>The routine that brought an EVE client window to the front stopped tapping the Alt key; it joined the foreground window's input queue instead, which injects nothing.</>,
      <>Rule 21 written into the project rules: sanctioned sources only.</>,
    ],
    why: <>Windows refuses to move the foreground for a process that did not receive the last input. The first fix tapped Alt system-wide to get past that, and the game client in front received the key event. Harmless in effect, but it is synthetic input, which the new hard line rules out.</>,
    policy: <>Rule 21: EVE data comes only from CCP's API through your own registered app, EVE's own log files, and CCP's public data; toward a running client the app does window management only; never memory, pixels, window messages, debug sockets, or synthetic input. When a feature cannot be built from those, the answer is "cannot", with the measurement that proves it.</>,
  },
  {
    version: '0.198.2', date: '2026-09-11', headline: 'The "needs you" box: one row per character, dismiss, shorter life',
    changes: [
      <>One row per character instead of a stack; a ✕ per row; two-minute life instead of five; a brief blink when a new event lands.</>,
      <>The "receiving a ship" line relabelled: it is the confirmation shown when you accept a trade containing a ship, not a mid-session signal.</>,
    ],
    why: <>Gavin's live test: the box stayed open too long, stacked duplicates, and was parked out of view. The test also showed the ship line never fires when ships are merely dropped in.</>,
  },
  {
    version: '0.198.1', date: '2026-09-11', headline: 'A quiet client\'s first new log line is no longer missed',
    changes: [<>The log watcher registers every session file on its first look, idle ones included, and drops anything older than a few minutes by its own timestamp.</>],
    why: <>A docked trader's log had been quiet, so it was first noticed at the very moment its trade line landed and that line was swallowed. Found by reviewing the watcher against Gavin's "I don't see it" report; reproduced with a filesystem fixture.</>,
  },
  {
    version: '0.198.0', date: '2026-09-11', headline: 'Overlay "needs you" box with click-to-focus (later removed)',
    changes: [
      <>A new overlay box listing which client wanted a human, fed by EVE's own game-log lines (trade results, conversation invites).</>,
      <>Clicking it asked Windows to bring that client's window forward; repeated clicks cycled through clients.</>,
    ],
    why: <>Gavin wanted to know, as a multiboxer, when a trade was opened with one of his characters. The version was built around what EVE does log — trade completion and cancellation — with the limit stated up front.</>,
    policy: <>Read-only reading of EVE's own log files and OS-level window management, the same things EVE-O Preview does. Removed in 0.199.0 once it was clear the opening event does not exist anywhere sanctioned.</>,
  },
  {
    version: '0.197.0', date: '2026-09-11', headline: 'Overlay boxes resize on their own; the help becomes paged, illustrated books',
    changes: [
      <>Each notice-type overlay box (⚠ notice, 🪐 planets, 🎯 raids) resizes independently; pod boxes keep one shared size.</>,
      <>Every module's ⓘ guide is a book: one group per tab, a table of contents, figures drawn from the app's own styles, "try it" examples and honest-limit callouts. 35 pages for Trade alone.</>,
    ],
    why: <>A beta tester wanted the PI and alert boxes sized independently; Gavin wanted a deep walk-through of every clickable thing in the app, with pictures, divided into graspable pages.</>,
  },
  {
    version: '0.196.1', date: '2026-09-11', headline: 'Two beta reports: the PI overlay toggle, and notice boxes resizing with pods',
    changes: [
      <>Turning the planet warnings off in the overlay settings now sticks; the main window adopts the change instead of overwriting it on its next save.</>,
      <>Notice boxes stopped following the pod boxes' size.</>,
    ],
    why: <>First reports from a corp tester. The toggle was written by the setup window straight into the saved settings, and the main window's next save wrote its stale copy back over it; measured before and after the fix.</>,
  },
  {
    version: '0.196.0', date: '2026-09-08', headline: 'Fit Wizard: projected-module table',
    changes: [<>Painters, webs, points, scrams, neuts, nos, remote reps, cap transfer, damps and ECM show their engine-final strength, optimal and falloff, cycle and cap under the weapons table.</>],
    why: <>"I can't see the optimal and max range for my target painter anywhere." The engine had computed it all along; nothing rendered it. Verified against the SDE base values on a hull with no bonuses.</>,
  },
  {
    version: '0.195.1', date: '2026-09-08', headline: 'Ammo table restart loop fixed',
    changes: [<>The per-charge ammo computation keys on a fingerprint of its inputs instead of object identity.</>],
    why: <>Opening the ammo drop-down grew the table over and over: a fresh pod array on every render restarted the computation each time.</>,
  },
  {
    version: '0.195.0', date: '2026-09-08', headline: 'Fit Wizard: legal module states, Alpha and Range headline tiles, weapons and ammo tables',
    changes: [
      <>Passive modules offer only offline/online; active ones add active; overheatable ones add overload.</>,
      <>Alpha sits beside DPS as a headline number; Range shows optimal plus falloff (or missile flight ceiling).</>,
      <>A weapons table per group and, on demand, an ammo table computing every loadable charge with the real engine.</>,
    ],
    why: <>"Alpha is just as important as DPS … range is shown nowhere … think about what I would want to see change as I change modules and charges."</>,
  },
  {
    version: '0.194.0', date: '2026-09-08', headline: 'Stats first in the wizard; pod library; pods travel with fits',
    changes: [
      <>The stats pane is back at the top of the wizard, above the pod picker.</>,
      <>Custom pods can be saved to a library and reused by any fit; a pod attached to a fit rides in cargo on every copy, buy list and save-to-character, and comes back into its slots on import.</>,
    ],
    why: <>The previous version buried the stats under the pod picker — "a horrible mess-up" for a fitter who looks at stats constantly.</>,
  },
  {
    version: '0.193.0', date: '2026-09-08', headline: 'Fit Wizard: start from the clipboard or a saved fit; pod picker',
    changes: [
      <>New fits can start from an EFT paste or from any character's in-game saved fits.</>,
      <>Ten implant slots with every implant and its Jita price, to see what different pods do to the numbers.</>,
    ],
    why: <>Most fits are alterations of something, not blank slates.</>,
  },
  {
    version: '0.192.0', date: '2026-09-07', headline: 'Fit Skill Maxer shows skill-point numbers',
    changes: [<>Need and Best columns show each level's SP cost; every character gap shows the SP left to train; a totals row per character.</>],
    why: <>"How big is that ask?" needed a number, not just a level.</>,
  },
  {
    version: '0.191.0', date: '2026-09-04', headline: 'Aperture known-limit warning; the source code goes public', published: true,
    changes: [
      <>A warning line on the Aperture page: the map's overlay pop-out does not work inside the app; use the browser button.</>,
      <>The source is exported to a public repository through a scrubbing allowlist; a guard scans every export and every installer for personal data.</>,
    ],
    why: <>The corp asked for the code. Before release, build-script identifiers carried an email, comments carried a home system and alt names, and test fixtures carried a real client id and machine paths — all scrubbed, and the guard now catches those classes.</>,
    policy: <>Nothing personal or private ships in public code or installers. The Aperture pop-out itself remains a known limit rather than a workaround.</>,
  },
  {
    version: '0.190.0', date: '2026-09-04', headline: 'Battle Sim: a pod picker per ship',
    changes: [<>Each character-flown ship can follow the live active pod, wear a specific known pod, or fly with no pod.</>],
    why: <>Asked for directly after the live-pod change, to compare pods for one ship without touching the character.</>,
  },
  {
    version: '0.189.0', date: '2026-09-04', headline: 'Battle Sim wears the multibox registry\'s live active pod',
    changes: [<>Character pilots' implants come from the pod the overlay last saw them wearing, so a clone jump reaches the sim within a poll.</>],
    why: <>"Use the active clone from the multibox registry."</>,
  },
  {
    version: '0.188.1 – 0.188.3', date: '2026-09-04', headline: 'Aperture pop-out handling; evidence when a native process dies',
    changes: [
      <>Pop-ups from the corp map are handled through a guest-side shim rather than left to spawn unmanaged windows.</>,
      <>Renderer and child-process deaths are recorded in the diagnostics log with their reason.</>,
    ],
    why: <>The map's overlay pop-out was killing the whole app with nothing in the log. The pop-out still does not work in-app (stated in 0.191.0), but the death is no longer silent.</>,
  },
  {
    version: '0.188.0', date: '2026-09-04', headline: 'Baseline dataset baked into new installs', published: true,
    changes: [
      <>New installs start with the project's collected market-radar and skyhook-raid history instead of a cold start.</>,
      <>Every file path derives from the running user's own Documents folder; nothing is fixed to the author's machine.</>,
    ],
    why: <>A corp mate should not wait days for the radar to become useful.</>,
    policy: <>Only data derived from public sources is baked in (radar summaries, coverage, raid observations); never wallets, orders, trends, fits or anything personal. The build and the ship guard both scan the bundle.</>,
  },
  {
    version: '0.187.2', date: '2026-09-04', headline: 'The Windows username scrubbed from the dogma engine binary',
    changes: [<>The build machine's user path baked into the engine's panic strings is patched out; the guard learned that class of leak.</>],
    why: <>"Is all of my personal data out? I want it completely safe." A deep sweep of the actual installer found two leaks the guard had not covered.</>,
    policy: <>Nothing personal ships. The guard runs on every build and every export.</>,
  },
  {
    version: '0.187.0 – 0.187.1', date: '2026-09-02', headline: 'Version control on GitHub; official self-updates',
    changes: [
      <>The project moved into git with a private working repository.</>,
      <>Installed copies check a public release feed on start and every few hours, download in the background, and install on restart or quit.</>,
    ],
    why: <>"Everything done properly and officially at no cost" — GitHub Releases is the free, standard channel, and the updater is the standard Electron one.</>,
  },
  {
    version: '0.186.0 – 0.186.1', date: '2026-09-02', headline: 'Beta preparation: crash evidence, one-paste bug reports, the shareability guard',
    changes: [
      <>Main-process errors are recorded before anything else happens; "it just closed" is diagnosable.</>,
      <>Diagnostics gained "Copy bug report": version, platform, module, team shape as counts only, and the last 200 log lines.</>,
      <>A shareability guard scans every build for personal identifiers and blocks the ship if it finds one — and caught a real leak on its first run.</>,
    ],
    why: <>The first hand-out to corp mates had to be safe for the author and diagnosable from a distance.</>,
    policy: <>Bug reports carry no character names and no login tokens, ever.</>,
  },
];
