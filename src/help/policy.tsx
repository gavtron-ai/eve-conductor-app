// THE POLICY PAGE (v0.199.3) — CCP's rules that touch a tool like this,
// paraphrased in our own words (CCP's text is copyrighted; the originals
// are linked and govern), beside how EVE Conductor keeps to each one.
//
// Every "how" here points at something real in the code or the audit
// (LEARNINGS/POLICY-AUDIT-2026-09-12.md). When a rule-facing behaviour
// changes, its row changes with it (RULES.md rule 20/21). Paraphrased from
// the documents as published on 2026-09-12; re-read the originals when
// CCP amends them.
import type { ReactNode } from 'react';

export interface PolicyRow {
  rule: ReactNode;
  source: string;
  how: ReactNode;
  status: 'clean' | 'note';
}

export const POLICY_SOURCES: { name: string; url: string }[] = [
  { name: 'EVE Online End User License Agreement (EULA)', url: 'https://support.eveonline.com/hc/en-us/articles/8413329735580' },
  { name: 'EVE Online Terms of Service', url: 'https://support.eveonline.com/hc/en-us/articles/8414770561948' },
  { name: 'Third Party Policies', url: 'https://support.eveonline.com/hc/en-us/articles/8564030965660' },
  { name: 'Botting policy', url: 'https://support.eveonline.com/hc/en-us/articles/7370802950172' },
  { name: 'Developer License Agreement (ESI)', url: 'https://developers.eveonline.com/license-agreement' },
  { name: 'ESI best practices and rate limiting', url: 'https://developers.eveonline.com/docs/services/esi/best-practices/' },
];

export const POLICY_INTRO: ReactNode = (
  <>
    <p>
      Three of CCP's documents govern a tool like this: the <b>EULA</b> (what software may do around the game client),
      the <b>Terms of Service</b> (conduct, and who may distribute EVE tools), and the <b>Developer License Agreement</b>
      (what an application may do with CCP's API and data). CCP's <b>Third Party Policies</b> page explains how they read
      the first two for player-made software. The left column paraphrases each relevant clause in our own words — CCP's
      text is theirs, and the originals linked at the bottom govern. The right column says what this app actually does.
    </p>
    <p className="hint">
      The standing rule inside the project (rule 21): EVE data comes only from CCP's official API through your own
      registered application, the log files EVE itself writes for you, and CCP's public data. Toward a running game
      client the app does operating-system window management at most, and today not even that. Never memory reads,
      screen reads, window messages, debug sockets, or synthetic input. When something cannot be built from those
      sources, the answer is "cannot", with the measurement that proves it, not a grey-area workaround.
    </p>
  </>
);

export const POLICY_ROWS: PolicyRow[] = [
  {
    rule: <>No software, your own or third-party, that modifies content in the game environment or changes how the game is played.</>,
    source: 'EULA §6 Rules of Conduct, item 2 · restated in Third Party Policies',
    how: <>The app never touches the client: no memory reads, no screen reads, no messages to the game window, no files under the client's folders. It reads CCP's API and EVE's own log files, and draws in its own windows. A code search for every input-injection and memory API returns nothing.</>,
    status: 'clean',
  },
  {
    rule: <>No macros, stored keystrokes or "patterns of play" that gain items, ISK, attributes, rank or status faster than ordinary play; no rewriting the interface or manipulating data to the same end.</>,
    source: 'EULA §6 Rules of Conduct, item 3 · Botting policy',
    how: <>The app performs no in-game action on its own. Nothing runs on a timer that affects the game. Market orders are never placed by the app — it copies a list to your clipboard for you to paste. The only in-game actions are CCP's own "open market window" and "set waypoint" endpoints, each behind a single click and authorized by that character's token.</>,
    status: 'clean',
  },
  {
    rule: <>No reverse engineering, decompiling or sniffing of the client or its network traffic.</>,
    source: 'EULA §7 (license restrictions) · Third Party Policies',
    how: <>Not done. The dogma engine the app uses for fit statistics is an open-source re-implementation built from CCP's published Static Data Export, not from the client.</>,
    status: 'clean',
  },
  {
    rule: <>CCP tolerates player-made software that simply enhances enjoyment while keeping gameplay fair, and names voice-chat overlays as an accepted example; software that confers an unfair advantage, or is used beyond its intended purpose, may lead to bans.</>,
    source: 'Third Party Policies · Botting policy',
    how: <>The multibox overlay is a click-through window that shows data the API already gives you (pod, system, ship) and never reads or drives the client — the same category as the overlays CCP names. Every other feature reads, computes and displays; the player still does everything in the game.</>,
    status: 'clean',
  },
  {
    rule: <>Software tools and utilities related to EVE Online may not be distributed without CCP's written permission.</>,
    source: 'Terms of Service (tools and emulators bullet)',
    how: <>The Developer License Agreement is that permission framework for applications that use CCP's API and data: it grants the right to build and share a non-commercial application for the stated purpose. Every user registers their own application on CCP's developer portal and accepts that agreement; the app ships with no key of its own. The app is free, open-source and unaffiliated, and says so in ⚙ Settings → About.</>,
    status: 'note',
  },
  {
    rule: <>Do nothing that raises the difficulty or cost of CCP running the game, servers and services; share the API responsibly.</>,
    source: 'Terms of Service · ESI best practices ("a shared resource, do not abuse it")',
    how: <>Request discipline in code: every API answer's expiry is honoured before it is asked again; the error limit headers are read and everything pauses on a 420; a 429 is backed off. Background collectors run on long cadences (the market radar every 30 minutes, planets every 11).</>,
    status: 'clean',
  },
  {
    rule: <>Identify your application on every API request — name, version and a way to contact whoever runs it.</>,
    source: 'ESI best practices (User-Agent)',
    how: <>Every request carries <code>EVE-Conductor/&lt;version&gt;</code> plus the public source repository as contact, set once for the whole app. No personal email ships in any copy.</>,
    status: 'clean',
  },
  {
    rule: <>Applications must be non-commercial: no fees for access, no real-money monetization; purpose limited to enhancing EVE for players.</>,
    source: 'Developer License Agreement §1.13, §4',
    how: <>Free, MIT-licensed, no paid features, no donations solicited, nothing that facilitates real-money trading.</>,
    status: 'clean',
  },
  {
    rule: <>Do not present yourself as CCP or as CCP's agent; keep CCP's proprietary notices; do not combine EVE's logos with other marks.</>,
    source: 'Developer License Agreement §2.7, §7.1, §7.3',
    how: <>The full CCP trademark and permission notice is shown in ⚙ Settings → About and in every guide; the app states it is unaffiliated. No EVE logo is combined with another mark.</>,
    status: 'clean',
  },
  {
    rule: <>No malware, phishing, tracking players without consent, misappropriating items, or attacking the service.</>,
    source: 'Developer License Agreement §2.3',
    how: <>The app stores its data on your machine only. Login tokens never leave it and are excluded from backups. Bug reports carry no character names. Nothing is sent to a third party except the API calls listed on this page.</>,
    status: 'clean',
  },
  {
    rule: <>Multiple accounts may be played at once only when each is subscribed; software that duplicates one player's input to several clients (input broadcasting or multiplexing) is not permitted.</>,
    source: "EULA §2 (accounts) · CCP's multiboxing rulings",
    how: <>The app never sends input to any client, so nothing can be broadcast. Its "open market window on every online character" button makes one API request per character, each authorized by that character's own token — CCP's endpoint, not replicated keystrokes.</>,
    status: 'clean',
  },
  {
    rule: <>Do not publish another subscriber's personal information.</>,
    source: 'Terms of Service',
    how: <>The app shows your own characters' data to you, and public killboard data. Nothing it stores is published anywhere; the shareability guard blocks any build or source export that contains the author's personal identifiers.</>,
    status: 'clean',
  },
];

/** the services the app talks to besides CCP — each one's stated rules,
 * and what the app does about them (v0.199.4, Gavin's notice: "the TOS of
 * not only EVE but services such as zkill which the tool interacts with") */
export const POLICY_THIRD_PARTY: { service: string; rules: ReactNode; how: ReactNode; status: 'clean' | 'note' }[] = [
  {
    service: 'zKillboard (killmail lists for Battle Reports, pilot intel, route gatecamp checks)',
    rules: <>Use the JSON API, not the website; identify with a user agent that carries contact; keep requests spaced; honour 429 and Retry-After; scraping the site is not welcome.</>,
    how: <>API only since 0.199.1 — the hidden page reader is gone. Every zKill request goes through one main-process module: identified with the app's name, version and repository link, one request at a time with a gap between them, backing off on a 429. zKill caches its lists for up to an hour, which the Battle Reports tab states rather than works around.</>,
    status: 'clean',
  },
  {
    service: 'Fuzzwork (market price aggregates; Static Data Export mirror at build time)',
    rules: <>Public API meant for third-party tools; identify your application; do not hammer it.</>,
    how: <>Requests carry the app's identification; prices are fetched on the app's own cadence and cached between uses. The SDE mirror is read only when the data files are rebuilt, never by users' copies.</>,
    status: 'clean',
  },
  {
    service: 'br.evetools.org and WarBeacon (battle-report links)',
    rules: <>Community battle-report sites; their pages and endpoints are their own.</>,
    how: <>The app makes <b>no request</b> to either site. It builds the address of a fight&apos;s public “related” page as text, for you to paste in chat or open in your own browser. Until 0.217.0 the app called two of br.evetools&apos; internal routes — to fetch a fight&apos;s killmails and, for multi-system fights, to create a saved report on their server by itself. Nobody there had agreed to that, so it was removed; the fight summary is now built from your corporation&apos;s own killmails (zKillboard&apos;s public API and ESI).</>,
    status: 'clean',
  },
  {
    service: 'Your corporation\'s Aperture map',
    rules: <>Whatever the map&apos;s owner allows — and they had not been asked.</>,
    how: <>The app makes <b>no contact</b> with Aperture (since 0.216.0): it does not embed the map, read it, or keep a login for it. Earlier versions kept the map loaded in the background and re-read it every five minutes, which cost Aperture&apos;s server thousands of requests a day per copy; its developer told us, and it was all removed. An earlier version of this page said “nothing is automated on a timer” — that was untrue, and should never have been written. The features return only if Aperture&apos;s developer offers, and is happy with, a way of doing it.</>,
    status: 'clean',
  },
  {
    service: 'EvE-Scout Rescue (metaliminal storm tracker)',
    rules: <>A community site with no API.</>,
    how: <>The app makes <b>no request</b> to it (since 0.217.0). It used to fetch the storm-track web page up to every 30 minutes and draw storm chips in the Theft Conductor. Reading a site&apos;s pages with a tool is not something its owners had agreed to, so the feature was removed rather than kept on a guess.</>,
    status: 'clean',
  },
  {
    service: 'ntfy.sh (optional alerts to your phone)',
    rules: <>A public push-notification service whose documented use is exactly this: post a message to a topic you chose.</>,
    how: <>Off unless you paste your own topic address in ⚙ Settings. Then each alert the app raises is posted once to that topic — nothing is read back, and the app contacts no ntfy address you did not enter.</>,
    status: 'clean',
  },
  {
    service: 'GitHub (updates and the public source)',
    rules: <>Standard release hosting.</>,
    how: <>The installed app checks the public release feed on start and every hour, downloads updates in the background, and installs on quit or restart. A release the author marks as an <b>emergency</b> installs by itself after a one-minute warning that says why — the feed can only make a published release install sooner; it cannot run code, change settings or switch features off. No token is involved.</>,
    status: 'clean',
  },
];

export const POLICY_QA: { q: ReactNode; a: ReactNode }[] = [
  {
    q: 'The buttons that open windows in the game — are those allowed?',
    a: <>Yes. They call CCP's own user-interface endpoints (<code>/ui/openwindow/marketdetails</code>, <code>/ui/autopilot/waypoint</code>), which exist precisely so a third-party app can open a market window or set a destination inside a running client, each authorized by that character's token under the <code>esi-ui</code> scopes. One click, one request per character, never on a timer. The app does not switch focus to a client or send it any input; the window appears inside whichever client that character is already in.</>,
  },
  {
    q: 'Is a floating overlay over the game allowed?',
    a: <>CCP's Third Party Policies name voice-chat overlays as the kind of software they tolerate: it enhances enjoyment without touching the client. The multibox overlay is that kind — a click-through window drawing data the API already provides. It never reads the client's screen or memory and never sends it input. It is the reason the app can never show shield, armor or hull bars: CCP's API publishes no health route, and the only other ways would break the rules.</>,
  },
  {
    q: 'Is reading EVE\'s game log files allowed?',
    a: <>The logs under Documents/EVE/logs are files CCP writes for the player. The app opens them read-only, reads, and closes; it never holds a handle, never writes into EVE's folders, and never touches the client's own settings or cache. This is the same thing every combat-log and mining-log tool does.</>,
  },
  {
    q: 'Why was the "needs you" trade box removed?',
    a: <>Because the one thing it was for — noticing that a trade had been opened — has no sanctioned signal: EVE logs nothing at that moment (measured three ways) and the API has no trade route. The only remaining lead was CCP's debugging log stream, which sits in a grey area, so it was dropped untried. "Cannot" with proof beats a workaround.</>,
  },
  {
    q: 'Why did Battle Reports get slower?',
    a: <>They used to load zKillboard's web page in a hidden browser, disguised as a normal browser to pass its bot check, because zKill's API lags its site. That was scraping a site that bans scrapers. The app now uses only zKill's public API, identified and rate-limited as their rules ask, and says plainly that zKill caches its lists for up to an hour. Fights involving your own logged-in characters still arrive live from CCP.</>,
  },
  {
    q: 'What would the app never do, even if asked?',
    a: <>Read the client's memory or screen, send it keystrokes or mouse input, modify its files, listen on its debug sockets, sniff its traffic, act in the game on a timer, place or edit market orders, or move ISK or items. If a feature needs any of those, the answer is that it cannot be built.</>,
  },
];
