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
    version: '0.215.0', date: '2026-09-21', headline: 'Aperture: the code that read the map is deleted, the map no longer runs when nobody can see it, and the features built on it show a clear “unavailable” blocker',
    changes: [
      <><b>We are reworking how EVE Conductor talks to Aperture.</b> Aperture&apos;s developer told us that each copy of this app was costing their server 6,000–7,000 requests and about 1 GB a day, skewing their user numbers, and reading their data in a way they never agreed to. Our own logs agreed with them. Until a proper path is worked out <i>with</i> them, the features built on reading the map are unavailable, and say so.</>,
      <><b>Deleted, not switched off.</b> 0.214.0 turned the reading off behind a switch. This version removes the code: the scripts that ran inside the map page and called its data routes, the hidden window that loaded the whole map every thirty minutes and clicked through it, the route and bridge that reached it, the five-minute re-reads and their retry loop, and the scan of the map&apos;s script files. There is no setting or flag that brings any of it back.</>,
      <><b>One more leak found and closed.</b> The app&apos;s windows deliberately keep running at full speed in the background (the collectors need that), which means a page never finds out it was minimised. So a copy left on the Corp Map tab and sent to the tray still kept Aperture&apos;s page polling all day. The main process now tells the window when it is out of sight; after two minutes the map page is unloaded, and it loads again when the window comes back. The map now exists only while the Corp Map tab is on screen <i>and</i> a person can see it.</>,
      <><b>A blocker where the features were.</b> The <b>Σ Summary</b> tab (and its pop-out window) shows a panel explaining what happened and what still works, with buttons to the Corp Map tab and to Aperture in your own browser. The Home <b>chain dashlets</b> say they are unavailable instead of showing a chain from days ago as if it were current. The Theft Conductor&apos;s <b>refresh from Aperture</b> is marked unavailable.</>,
      <><b>A correction.</b> The 0.214.0 note said “import map from clipboard” still worked in the Theft Conductor. It did not — that button had been replaced by the automatic pull long ago. It is back in this version: copy your system list on the Corp Map tab (Map info → Systems), press <b>📋 import map from clipboard</b>, and the raid alert has its distance origin again. The app reads your clipboard once, when you press; it reads nothing from the map.</>,
      <>What the app still does with Aperture: shows it in an ordinary embedded browser tab while you look at it, opens links you click, and opens it in your own browser when you ask. Nothing else.</>,
    ],
    why: <>The owner, after Aperture&apos;s developer wrote to him: “check to make sure we are cutting these negatively viewed interaction types completely off … put up a blocker pop up on those tabs that explains that we are reworking the method of interaction with Aperture and until that is solved properly the feature will be unavailable.”</>,
    policy: <>Sanctioned sources only — and a third-party service is sanctioned when its <b>owner</b> says so, not when a login makes it reachable. Reading a private web application through the user&apos;s session, calling its internal routes and keeping its page alive in the background was never agreed with the people who run it and pay for it. These features return only through a data path Aperture&apos;s developer designs.</>,
    published: true,
  },
  {
    version: '0.214.0', date: '2026-09-20', headline: 'Reading the corp map is switched off — at the request of Aperture’s developer, and rightly',
    changes: [
      <><b>The app no longer reads anything from Aperture, and makes no automated request to it.</b> Aperture&apos;s developer told us that each copy of this app was costing their server 6,000–7,000 requests and about 1 GB a day, skewing their user numbers, and reading their data in a way they never agreed to. Our own log agrees with them. This version stops all of it, today, in every install that updates.</>,
      <><b>What it had been doing</b> (so nobody has to guess): once opened, the map page stayed loaded — invisible — for as long as the app ran, so the page&apos;s own polling ran around the clock and every user looked online all day. Every five minutes the app fetched the whole map document and the whole system-data document again from the page&apos;s session; a hidden page never finished drawing, so each cycle re-tried up to ten times — measured on one machine in one day: 119 readings, 632 retries, 1,502 full-document fetches. With the raid alert on, a hidden window loaded the whole map application every thirty minutes. And each page load re-downloaded up to forty of the map&apos;s script and style files to look for colours.</>,
      <><b>What is left</b> is an ordinary embedded browser tab: the map loads only while the Corp Map tab is on screen and is unloaded the moment you leave it — not under the Σ Summary, not under Home, not in the background. No script is run in the page and none of its data routes is called. The switch is enforced twice, in the window and in the main process, so no screen can reach the old route.</>,
      <><b>What you lose for now</b>: the Σ Summary and the Home chain dashlets stop updating (dashlets keep their last reading and say “paused”), the Theft Conductor&apos;s “pull from Aperture” button is gone, and the raid alert no longer refreshes its map by itself. <b>What still works</b>: the map itself in its tab, and <i>import map from clipboard</i> in the Theft Conductor — that is you copying your own list, by hand.</>,
      <>These features come back only through a data path Aperture&apos;s developer designs and agrees to. They have offered to work one out.</>,
    ],
    why: <>A message from Aperture&apos;s developer: the app “scrapes data from Aperture in a very hacky way … ethically questionable … throws off some of our user metrics as well as artificially inflating server load … every user of your EVE Conductor cost our server 6000 to 7000 requests and about 1GB of data per day.” The owner: “I want to fix it immediately.”</>,
    policy: <>The rule this app holds itself to — sanctioned sources only — applies to third-party services as much as to CCP: a source is sanctioned when its <b>owner</b> says so, not when a login happens to make it reachable. Reading a private web application through the user&apos;s session, calling its internal routes and keeping its page alive in the background was never agreed with the people who run it and pay for it. It is off until they say how, if at all, they want it done.</>,
  },
  {
    version: '0.213.0', date: '2026-09-20', headline: 'Every update now brings fresh history with it: skyhook raids and market rates fill the gaps your own app missed',
    changes: [
      <><b>The seed is refreshed with every build.</b> The installer has carried a starter history since 0.188 — market rates measured by the radar and the skyhook raid log — but it was baked by hand and had not been refreshed since 15 September. It is now baked from the newest measurements as part of every build, behind the same personal-data guard: a hit refuses the whole build.</>,
      <><b>An update now fills the gaps in the history you already have.</b> Until now the seed only helped a brand-new install; once you had files of your own it was never looked at again. On the first launch after an update, before the window opens, the app now merges the newer seed into your own history — <b>only where your app was not watching</b>. Raid log: a seeded verdict is added only when you recorded nothing of your own in that hour and hold no verdict for the same planet within 12 hours (measured on 52,706 verdicts: the same planet never yields two less than 63.9 hours apart, so that can only be the same window seen twice). Market radar: a whole region-day is taken only when you have no coverage and no rows for that region on that day. Nothing of yours is replaced, nothing is counted twice, the raid log is only ever appended to, and the all-time hour-of-day profiles are left alone because they cannot be split by day.</>,
      <><b>Measured on real data</b>: a history five days behind gained 4,654 raid verdicts and 25 region-days (218,580 market rows) in 6.3 seconds, once; every seeded verdict ended up held exactly once, and the next launch did nothing. If you have no gaps it costs a fraction of a second. What happened is written to the dev log.</>,
      <><b>Found while building it:</b> the raid seed was a straight copy of the collected log, hand-made marks included — so a seeded install can show one “I raided it” mark it never made. The seed now carries only the public feed&apos;s own verdicts (raided / survived / unknown), never a mark, a bar reading, or a verdict a bar reading changed. A stray mark already on a seeded install cannot be told apart from a real one, so it stays: one planet, one mark.</>,
      <>The corporation killmail archive is deliberately <b>not</b> seeded: it is one corporation&apos;s data in a build meant for anyone, and the personal-data guard refuses it. It fills in by itself in the background since 0.212.</>,
    ],
    why: <>"All of this type of information should be seeded as we get more up to date data and it should update on the build locally as well so that I can seed the updates with refreshed information to be used and cut down load times."</>,
    policy: <>The seed holds only measurements derived from CCP&apos;s public data — public market order books and the public skyhook feed — and nothing from any player&apos;s login. Seeding them spares every new install weeks of repeated public reads.</>,
  },
  {
    version: '0.212.0', date: '2026-09-20', headline: 'Leaderboard: the history loads itself, the board opens in under a second, and a “held” strip shows exactly what you are looking at',
    changes: [
      <><b>Nothing to click.</b> The ⤓ load history button is gone. Opening the Leaderboard shows what is already held at once, reads the corp&apos;s newest kills and losses (two requests), and then reads the past <b>by itself in the background</b> — month by month, newest first, until two years are held. It carries on while you use the rest of the app, saves after every month, resumes where it stopped after a restart, and can be paused. A corp dashlet on Home keeps the same archive current, so the tab does not even have to be visited first.</>,
      <><b>It was slow because of one loop — fixed.</b> With 40,000 killmails held, opening the board took <b>53 seconds</b>: the step that works out why each fight started and ended compared every fight with every killmail. It now looks only at the killmails next to each fight. Measured on that same archive: 58.7 s → 0.8 s with <b>identical</b> results (11,960 fights, 0 differences), and the board appears in about <b>0.6 s</b>. Fights are now worked out only for the range on screen, and a refresh no longer reads new killmails one by one from ESI — zKillboard&apos;s lists already carry them whole.</>,
      <><b>“Am I seeing all of it?” — the held strip.</b> Under the ranges there is one cell per month for two years: green = whole month held, blue = this month so far, amber = only part, empty = not read yet, gold outline = the range on screen; click a month to show it. Beside it: how many killmails are held, <i>complete from…</i>, and what the background read is doing. The line below answers for the view in front of you — <b>✓ every killmail in this range is held</b> or <b>⚠ SHORTENED</b> from a date — and every page and every Home corp dashlet follows the same rule.</>,
      <><b>A data bug behind “I don&apos;t know if I see all the data”.</b> In 0.211 a refresh and a history read could run side by side (leave the tab mid-read, come back) and each saved its own idea of how complete the archive was — the later one overwrote the other, so an archive of 40,000 killmails claimed to be complete only from a few days ago, and views were cut short. There is now one archive in memory and one writer, and “complete from” is <b>worked out from what was actually read</b> every time instead of being remembered. An archive written by 0.211 repairs itself on the first run. The 40,000-killmail cap, which a busy corp passes well inside two years, is now 150,000.</>,
      <>A 7-day view opened before the first refresh showed <i>everything</i> held with a ✓; it now shows the range asked for and says it is still checking. The help&apos;s board table uses the clear board names from 0.211.</>,
    ],
    why: <>"The leaderboard and back data loading is not really user friendly, people will not go click load, and it seems to take a long time to load after and i dont even know if I see all the data in some or all of the views."</>,
    policy: <>The background history uses the same two zKillboard routes as before — a corporation&apos;s newest kills and losses, and its kills and losses by year and month — through the app&apos;s single requester: identified, one request at a time, 1.1 seconds apart. A past month is read once, ever; a month too large to read politely is left incomplete and marked so. The refresh now costs two zKillboard requests and <b>no</b> ESI killmail reads.</>,
  },
  {
    version: '0.211.0', date: '2026-09-20', headline: 'Leaderboard: two years of history on tap, any time range, board names that say what they count · Home: fills the window, 60 dashlets a board · a sanity pass over every number',
    changes: [
      <><b>The leaderboard&apos;s reach was needlessly short — fixed.</b> zKillboard serves a corporation&apos;s killmails <b>month by month, whole</b> (measured: a month&apos;s rows equal zKillboard&apos;s own monthly count, 18 months back answered) and every row already carries the full killmail, so <b>⤓ load history</b> reads 3 months, 6 months, a year or two years with one spaced request per 200 killmails and <b>no ESI reads at all</b> — three months of a test corp took 9 seconds. A past month read once is kept and never asked for again; the app now keeps <b>two years</b> (it was 100 days). Big blob killmails are trimmed for storage without changing a single number the board shows.</>,
      <><b>Any time range.</b> New presets (14 d, 90 d, this year), a <b>month picker</b> over every month held, and <b>from / to dates</b>, both included. Rank arrows compare with the equal span before — still only when that span is held whole. The corp&apos;s timeline switches to weeks past 92 days and months past 550, so two years is a chart and not a smear.</>,
      <><b>Board names that explain themselves</b>: “Solo kills”, “Final blows”, “Top damage on the kill”, “Longest kill streak”, “First kill of the fight”, “Most valuable kill”, “ISK efficiency”, “Fights attended”, “Assists (tackle &amp; EWAR)”, “Battleships &amp; capitals killed”, “Most expensive loss”… The old names (Lone wolf, Whale hunter, Whelped…) stay as small nicknames beside them.</>,
      <><b>Home fills the window.</b> The grid stopped at 210-pixel cells and left a blank strip down the right of a wide window; cells now take the full width to the pixel, and past a point bigger cells mean more rows shown, not bigger letters. In ✎ arrange, <b>grid: 6 / 8 / 10 / 12 across</b> sets a board&apos;s density (10 or 12 suit a wide monitor) and <b>⇆ re-pack</b> lays the dashlets out again for the new width.</>,
      <><b>The dashlet limit: 24 → 60 a board, 6 → 8 boards — after measuring why there is one.</b> 96 dashlets mount in about 150 ms and cost under 1 % of the main thread, so it was never performance; the limit is there because a board is a glance, not a report, and to stop a broken settings file mounting thousands of panels. Along the way the board stopped re-rendering on the app&apos;s once-a-second status tick, all dashlets now share one ticker and one leaderboard computation.</>,
      <><b>A sanity pass over the numbers, against real data.</b> Found and fixed: a lone tractor-unit or bubble kill counted as a <b>solo kill</b> (deployables carry their owner as the victim) — structures and deployables are no longer “ships”, and count on Structures killed instead. <b>Trading value</b> said “+174 %” for a week whose whole change was a wallet transfer — it now splits the change into <i>wallets</i> and <i>goods</i>. “Robberies seen … today” was a rolling 24 hours — it says so (the numbers themselves hold up: about a quarter of skyhook windows end robbed, median 46 minutes in). Collectors listed “My orders 7 d ago”, which was the My Orders <i>tab&apos;s</i> own read — it now shows the team-orders refresh the rest of the app uses.</>,
    ],
    why: <>"Make the names of leaderboard cards more clear … I also dont like that we dont fill the width of the screen … the dashlet limit seems a little low, evaluate why we are limiting … sanity check the dashlets on both … the timeline is unnecessarily limited right? could we not pull the info to have tons of back data? more time filtering options as well with better control."</>,
    policy: <>The history uses one new zKillboard route — a corporation&apos;s kills and losses by year and month — through the same single requester as every other zKillboard call: identified, one request at a time, 1.1 seconds apart, and only when you press ⤓ load history. It replaces thousands of ESI killmail reads with none.</>,
  },
  {
    version: '0.210.0', date: '2026-09-20', headline: '🏆 Leaderboard, rebuilt wide: 25 boards in five groups, a card for every pilot, head to head, a hall of fame, seasons and rank arrows',
    changes: [
      <><b>Twice the boards — 12 → 25, in five groups.</b> <i>Kills</i>: Kill streak (kills in a row with no loss between), First blood (on the first kill of a fight that went on to have two). <i>Damage &amp; ISK</i>: One big hit. <i>Showing up</i>: Regular (EVE days with a killmail), Wingman (different corp mates you shared a kill with). <i>Style</i>: <b>Helping hand</b> — kills you are on without a point of damage, the one trace tackle and EWAR leave on a killmail — Big game (battleship-or-bigger kills), Demolition, Egg hunter, Hangar queen, Globetrotter. <i>Wooden spoons</i>: Expensive taste, Whelped. The medals table now runs over the 21 honour boards.</>,
      <><b>A card for every pilot</b> — click any name or portrait, anywhere. His place on the medals table and on every board, eight headline numbers, the hulls he flies with a class bar, when he is on killmails by EVE hour, <b>the people in his story</b> (his wingman, his nemesis, his favourite prey), and his killmails newest first, each a link to zKillboard. The portrait opens his zKillboard page.</>,
      <><b>⚔ Head to head</b>: any two pilots, sixteen rows, a score — it opens on your best pilot against the leader, and a pilot&apos;s card can send him there. <b>🏛 Hall of fame</b>: the window&apos;s records (biggest kill and loss, hardest single hit, longest streak, most kills in one fight, busiest day, biggest turnout) and <b>the corp&apos;s days</b> — kills above the line, losses below.</>,
      <><b>Seasons and arrows.</b> Two new windows, <i>this month</i> and <i>last month</i> (EVE calendar months), and ▲▼ arrows on the medals table against the window before. An arrow is only drawn when the window before is <b>held whole</b> — otherwise the line says there are no arrows and why, rather than compare with half a window. The app now keeps 100 days of the corp&apos;s killmails (was 45) so a finished month stays whole.</>,
      <><b>📋 Copy for chat</b> puts the medals and every board&apos;s winner on the clipboard as plain text. <b>Find a pilot</b> filters the boards and the table. Three more Home dashlets on the Corp shelf — Movers, Hall of fame, The corp&apos;s days — and Board leader offers all 25 boards.</>,
    ],
    why: <>"I want you to do a similar expansive extension on the leaderboard as well."</>,
    policy: <>Still public killmails only, the same ruler for everyone. The one new request is made when a pilot&apos;s card is opened: ESI&apos;s public names route, for the two outsiders in his story. Hull classes come from the type list the app already ships.</>,
  },
  {
    version: '0.209.0', date: '2026-09-20', headline: '🏠 Home: 49 dashlets on ten shelves — and a layout that never clips a headline or cuts a row in half',
    changes: [
      <><b>The layout, fixed.</b> In the medium size the big figure of “ISK on field” was squeezed under its title and cut off, large dashlets left half their box empty, and lists ended in half a row. Every dashlet is now built from the same three parts: a <b>headline that is never squeezed or clipped</b> (it shrinks its type to fit instead), <b>detail that shows only whole rows</b> — as many as the box really holds, measured, at any window size or zoom — and a one-line footer. Medium dashlets, which are wide and short, put the headline on the left and the detail on the right; large ones list as far as they have room.</>,
      <><b>Three and a half times the dashlets: 14 → 49, on ten shelves.</b> <i>Chain</i>: Close to home (ISK within N jumps, by distance), Site finder (nearest combat / relic / data…), Ways to known space (every exit, with gate jumps on to Jita), System effects, Map freshness (how much is unscanned, how stale), Chain shape. <i>Harvest</i> (new): Gas finder (where is the C320?), My hauls, Mining fleet. <i>Theft</i>: Most robbed, When thieves strike (by EVE hour), Robbed or left alone. <i>Planets</i>: Extractor resets, Fullest planets, On the ground (products at the Jita ask), Planets by pilot. <i>Wealth</i> (new): Where the ISK sits, Wallets, Profit by day, Unsold stock. <i>Market</i> (new): Market events, Best sellers, Watchlist. <i>Battle</i>: Kill feed, My pilots&apos; record, When we fight. <i>Corp</i> (new): Board leader (any leaderboard board), The corp&apos;s week, What the corp flies, Who we meet. <i>Pilots</i>: Logins (who needs logging in again). <i>Utility</i>: ESI budget, a sticky Note, Shortcuts (your favorites as buttons), What&apos;s new.</>,
      <>Numbers brought into line with their tabs: <b>Planets</b> said “37 need you” by counting every planet with anything to tune; it now uses the PI tab&apos;s own bands — <i>need you NOW</i> (full, filling, every head dead), <i>worth a trip soon</i>, <i>to tune</i>. <b>Robberies seen</b> says it covers all of New Eden. <b>Collectors</b> no longer reads “next 1167m 25s”. The kill feed names a capsule instead of “type 670”.</>,
      <>Still the rule: <b>no dashlet asks EVE for anything</b>. The new ones read the raid watcher&apos;s log, the planet collector, the value snapshots, your wallet ledger, the trend watcher&apos;s events, the price book the watchlist already keeps, the killmails the Leaderboard holds, and the last reading of your map — and each says how old that is. The Watchlist is labelled for what it is: Jita&apos;s lowest ask and highest bid — the book, not what anything sold for.</>,
    ],
    why: <>"Check out some of the formatting here, and come up with literally 3x the dashlets, scour all of the data we gather with the app and see what cool stats we can show off, make new categories, expand existing, go all out on this."</>,
    policy: <>Nothing new is read from EVE, zKillboard or anywhere else — every new dashlet is a new view of data the app had already collected.</>,
  },
  {
    version: '0.208.0', date: '2026-09-20', headline: '🏆 Corp leaderboard: everyone on a public killmail, ranked on a dozen boards — the same ruler for all',
    changes: [
      <>A new <b>Leaderboard</b> tab in the Battle Conductor. Everyone in your corporation who is on a public killmail in the window — 24 h, 3, 7 or 30 days — ranked on twelve boards: Most kills, Heavy hitter, ISK destroyed, Killing blows, Carried it, Whale hunter, Lone wolf, Always there, Untouchable, Trade balance, and two wooden spoons (Big spender, Pod express). A <b>medals table</b> sits on top: gold 3, silver 2, bronze 1 over the ten honour boards. Your own pilots get a ★ — and appear under a board&apos;s top five when they are further down. The full table of every pilot and every number is at the bottom, sortable.</>,
      <>It is built on one rule: <b>only compare what is known equally about everyone</b>. The only source is public killmails — the same feed as Battle Reports — and nothing from your own logs, wallet or logins is mixed in. “ISK destroyed” is each kill&apos;s value times the pilot&apos;s share of the damage, so a blob does not hand everyone the whole mail. What a killmail cannot see (logistics, boosts, scouts) is said on the page: it is a bit of fun, not a performance review.</>,
      <>It is <b>honest about how far back it reaches</b>. zKillboard hands out 200 kills and 200 losses at a time; when a list comes back full, the app only claims completeness from its oldest row, shortens the window to that <i>for everyone alike</i>, says so, and offers <b>⤓ reach further back</b> (the next 200, up to five pages). The killmails read are kept for 45 days on your machine — a killmail never changes — so the board reaches further the longer you use the app.</>,
      <>A <b>Leaderboard dashlet</b> on the Battle shelf of the Home store: the medals table, or just where your best pilot stands, from what the tab already holds — it asks nobody. The Leaderboard tab can be pinned to favorites like any other.</>,
      <>Battle Reports: a killmail first seen through your own login (no price yet) now picks up zKillboard&apos;s value once its list carries it, instead of staying unpriced for the session.</>,
    ],
    why: <>"I want to only compare things where you have equal stats for everyone you are comparing yourself to … a cool leaderboard style thing … it is just public data and it creates a light competitive fun environment … make everyone included that has activity relevant to the stats you are showing."</>,
    policy: <>Public data only, through the routes the app already used: zKillboard&apos;s corporation kill and loss lists (now also by page, through the same single identified and spaced requester) and ESI&apos;s public killmail and names routes. The killmails are kept in your stats folder; nothing is sent anywhere.</>,
  },
  {
    version: '0.207.0', date: '2026-09-20', headline: '🏠 Home: build your own dashboards out of dashlets — a snap grid, a few sizes each, and a store to pick them from',
    changes: [
      <>A new <b>Home</b> module (top of the module menu). A board is a grid of square cells, eight across; <b>dashlets</b> snap to it in fixed versions — small, medium, large, wide — like the widgets on a phone. <b>✎ arrange</b> is the placement tool: drag a dashlet and the others make room as you move, switch its version, set its option, or remove it. Up to six named boards (a “Mining day” board, a “PvP” board…).</>,
      <>The <b>dashlet store</b> (＋ add dashlets) has shelves — Chain, Theft, Industry, Trade, Battle, Pilots, Utility — and every card previews the dashlet <b>live with your own data</b> before you add it. Thirteen to start: ISK on field, an Ore finder (“where is the gneiss today?”), Ways out of home, Raid windows, Robberies seen, Planets, Trading value, My orders, Sales, Latest fights, Where everyone is, EVE time and Collectors. They are purpose-built glances, not tabs squeezed into boxes: the title bar opens the tab with the full story, already filtered where that makes sense (the Gneiss finder opens the Σ Summary on gneiss; a way out of home opens it down that part of the chain).</>,
      <><b>No dashlet asks EVE for anything.</b> Each reads what the app already holds — the background collectors, the order refresh, the last reading of your corp map — and says in its footer how old that is; a figure the app cannot stand behind reads “—” with the reason. Chain dashlets use the Σ Summary&apos;s own parser and valuation, so their totals are the tab&apos;s totals; after a restart they show the <b>last known</b> chain with its age until the map is read again.</>,
      <>Home can be pinned to the favorites strip like any tab, so “open my first favorite when the app starts” can land you on your own dashboard.</>,
    ],
    why: <>"It might also be nice to be able to make customizable dashboards of things that the player focuses on" — and the brief that followed: "the primary placement tool accompanied with resizeable versions similar to apple or google widgets on the phone… instead of making copies from the initial tabs lets make unique dashlets in nice little categories like a curated dashboard storefront."</>,
    policy: <>Nothing new is read from EVE or anywhere else: dashlets only show data the app had already collected. Boards are stored with your other settings on your machine.</>,
  },
  {
    version: '0.206.0', date: '2026-09-19', headline: '★ Favorites: pin the tabs you live in — and save a view, like “Gneiss in the C3 branch”',
    changes: [
      <>A <b>☆</b> after the tab names pins the tab you are on. Pinned tabs sit in a <b>favorites strip</b> under the header — Corp Map, Σ Summary, Skyhooks, Battle Reports, the Log Visualizer, whatever you use — one click from any module. Drag to reorder, right-click to rename or remove, <b>Alt+1 … Alt+9</b> to jump, and an option to open your first favorite when the app starts. Up to twelve; they travel with your settings.</>,
      <>The Σ Summary can <b>★ save its view</b> as a favorite: set ore Gneiss and chain C3, save, and a chip “Σ Summary · Gneiss · C3 branch” opens the tab with exactly that. The part of the chain is saved as <b>intent, not identity</b> — the class of the system off home, never today&apos;s J-code — so the view still works after the chain rerolls: it picks whichever C3 hangs off home that day (all of them if there are several), on every new reading, and says so plainly when there is none.</>,
      <>A picked rock the chain does not carry right now stays on, as a chip reading 0, instead of being dropped on the next reading — a saved “Gneiss” view no longer turns into “everything” on a day with no gneiss.</>,
    ],
    why: <>"I want to add a customizable module with all of the favorites of the user — for me Aperture, Summary, Skyhooks, Battle Reports and Log Visualizer. Some users may want to save the state of a certain tab, like people who just log in and want to mine only gneiss in the C3 segment of the chain."</>,
    policy: <>Nothing new is read; favorites are stored with your other settings on your machine.</>,
  },
  {
    version: '0.205.1', date: '2026-09-19', headline: 'Σ Summary: the chain chips carry the map’s letter, the chain filter dims instead of hiding, and the drawing fills its panel', published: true,
    changes: [
      <>The <b>chain</b> chips show the class <b>with the map&apos;s letter</b> — “C4B J123456”, exactly as the card does — not just “C4”.</>,
      <>Picking a part of the chain no longer takes the rest off the drawing: those systems <b>dim</b>, like under every other filter, and the links that only touch them dim with them. The tiles, table and charts still show only the picked part.</>,
      <>The chain drawing now <b>fills its panel</b>. Dragging the panel taller (or a taller right-hand column stretching the row) left the bottom half empty; the rows now spread over the height there is and the columns over the width, cards keeping their size. It only ever stretches — a panel smaller than the drawing scrolls as before — and the drawing&apos;s size no longer feeds back into the panel&apos;s height, so letting go returns it to where it was.</>,
    ],
    why: <>"I want to see the letter at the end, not just the type — if it says C4B is attached to home the filter button should say C4B. When filtering it should not hide things, it should dim them like we do for other filters. And the chain panel is not resizing correctly: when I drag it down the bottom half is just empty."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.205.0', date: '2026-09-19', headline: 'Σ Summary: a “chain” filter — pick the part of the chain you are roaming through',
    changes: [
      <>A new <b>chain</b> row in the Σ Summary filters: one chip per system <b>directly off home</b> (or off you, when the origin is 🧍 me) — its class, its name, and how many systems lie down that way. Pick the C3, the HS, the NS, or several, and <b>only that part of the chain stays</b> in the tiles, the table and the charts; on the drawing the rest of the chain dims (0.205.1).</>,
      <>A chip stands for that system and everything whose way home runs through it. A system two branches reach equally fast — a loop in the chain — is on both, so either pick shows it; a longer way round does not count. Home&apos;s own sites are down no branch. It stacks with every other filter, <b>✕ clear filters</b> resets it, and a picked branch that closes is dropped from the filter instead of filtering invisibly.</>,
    ],
    why: <>"I want a new dynamic filter that filters by which part of the chain you are interested in roaming through. The filter description will be &lsquo;chain&rsquo; and it will filter by each system off home — if there is a C3, HS, and NS attached to home you can select one of them or multiple and it will filter out anything that is not down that part of the chain."</>,
    policy: <>Nothing new — computed from the map reading the tab already has.</>,
  },
  {
    version: '0.204.2', date: '2026-09-19', headline: 'Battle Reports: a hoverable timeline, everyone involved, corp logos on the cards — and the pilot panel’s pictures are its links',
    changes: [
      <><b>The report shows everyone involved.</b> Below the two team panels, both sides in full: every pilot seen on the fight&apos;s killmails with their portrait, the hulls they were seen in (a red ring marks one lost here), corporation, damage dealt, killmails, final blows and what they lost. Sort by damage, kills, lost or name. Every picture opens the pilot panel.</>,
      <><b>A real timeline.</b> Every killmail on a time axis, with the running totals per side as step lines, in four modes: <b>ships lost</b>, <b>ISK lost</b>, <b>damage taken</b> and <b>pilots seen</b>. Hover for the kill under the cursor — who lost what, when, for how much, to how many attackers, and both totals at that moment; click it to open that pilot. Every number is a sum over killmails, and each mode states its own limit (damage that killed nothing is on no killmail; pilots seen is a floor, not a fleet count).</>,
      <><b>The pilot panel&apos;s links are its pictures now</b>, each with a zKill ↗ badge and a caption: the headshot opens the pilot, the ship up top opens <i>that kill</i>, and the picture in the fit section opens the killmail the fit was read from (the same kill when confirmed, the similar loss when likely). The zKill button, the “killmail in this battle” card and the text links are gone — the kill&apos;s time is in the summary line instead. If a killmail in scope cannot be read, the panel now says so instead of claiming the pilot has no such loss.</>,
      <><b>Cards show the two sides as corporation logos</b>, ours left and theirs right, instead of enemy names in red — red on a card now only ever means ISK lost and their ships.</>,
    ],
    why: <>"The enemy team name should be in a different color — red is for ISK lost and ships fought against — let&apos;s show the two sides by their corp icons… the links are inconsistent, repetitive, and ugly: the headshot should link to the player, the ship up top to that kill, the killmail card is repetition… I hate that the report doesn&apos;t show everyone involved, and I want a timeline that is hoverable and toggleable between modes while maintaining accuracy."</>,
    policy: <>Nothing new is read. The roster and the timeline are computed from the same killmails the report already had; corporation names for the logo tooltips use CCP&apos;s public names route.</>,
  },
  {
    version: '0.204.1', date: '2026-09-19', headline: 'One pilot panel everywhere, no more duplicate kills, poster-style battle cards — and the write-summary tool is gone',
    changes: [
      <><b>Every pilot or ship picture now does the same thing.</b> In the Log Visualizer a <b>Kills &amp; losses</b> card used to jump to zKillboard while a row in <b>Top targets</b>, right above it, opened the pilot panel. The cards open the <b>same panel</b> now, with the killmail you clicked as the evidence — the exact fit from it, a copy for the game, the damage you traded with that pilot, and the zKillboard links inside. A loss card opens your own pilot and what died. In Battle Reports the top-damage <b>portraits</b> open the panel too, like the ship pictures.</>,
      <><b>Duplicate kills are gone — and so was an inflated number.</b> With several characters selected, a kill four of your pilots were on showed as four cards. Worse, the <b>destroyed / lost / efficiency tiles were summed over those duplicates</b>, so a 39m kill shared by four pilots counted as 156m. Killmails are now merged by id: one card (“×4 pilots”), one value.</>,
      <><b>Battle cards read like posters</b>, most important first: <b>ships on each side</b> (large, ours blue, theirs red), <b>ISK destroyed vs lost</b>, <b>when</b> in words (“Today 05:07 · 30 min · 3 h ago”), <b>who it was against</b>, then <b>where</b>. All from the corp&apos;s own killmails, so the card is complete before any report loads.</>,
      <>The <b>write-summary tool is removed completely</b>: the button and its text in Battle Reports, the “AI fight summaries” key field in Settings, the Anthropic call in the app&apos;s main process, its help and its row in the ⚖ policy table. The app no longer talks to Anthropic at all. If you had saved a key, the file <code>Documents/EVE Conductor/anthropic.json</code> is left alone — delete it if you like; nothing reads it.</>,
    ],
    why: <>"I really don&apos;t like that the log visualizer and battle reports don&apos;t act the same when you click on a ship portrait, I am seeing lots of duplicates in the kills and losses panel, and clicking on top targets reacts totally different than kills and losses ON THE SAME TAB… In battle reports I really hate the write summary tool — remove it completely — and make the cards readable like posters: ships on each side, ISK destroyed vs lost, time in a human readable format, who we fought against, then location."</>,
    policy: <>One service fewer: Anthropic is no longer contacted. Nothing new is read.</>,
  },
  {
    version: '0.204.0', date: '2026-09-19', headline: 'Battle Reports: fights are told apart by who fought whom, where, and at what tempo — not by the clock',
    changes: [
      <>The list had turned into one giant battle. The old rule was time alone: any two corp killmails under 40 minutes apart were the same fight. <b>Measured on the corp&apos;s real feed</b> (160 killmails in 30 hours, 31 pilots active): the median gap between corp killmails is one minute, so a whole night chained into a single battle — 252 minutes, 60 killmails, 10 systems, three crews that never shared a killmail. The new rule reads the killmails: a killmail joins a fight for <b>same system and same people</b>, <b>same system and same moment</b>, <b>the fight moved</b> (same crew and same enemy elsewhere), <b>spilled into another system</b> within minutes, or <b>round two</b> (same place, enemy and crew within half an hour). A fight <b>ends by its own tempo</b> — a fast brawl after 6 silent minutes, a slow camp after up to 15 — and two skirmishes a later killmail ties together are merged. The same night now reads as 14 fights, the longest 33 minutes.</>,
      <>The selected card <b>says how it was grouped and why it ended</b> (“same system, same people ×7 · the fight moved ×1 · round two ×2 — kills every 67 s — ended: 22 min of quiet…”), and shows the corp pilots involved. <b>★ yours</b> marks fights your own characters were in; <b>my fights</b> and <b>hide single kills</b> filter the list and are remembered.</>,
      <>The list really covers three days now: it read only the newest 60 killmails (about four hours at this pace). All of zKillboard&apos;s list is read, in batches, and kept — a refresh fetches only what is new (first read 2.7 s, refresh 0.1 s, measured).</>,
      <>“Stuff we were not involved in” is gone from the reports: br.evetools is asked for <b>each system over its own part of the fight</b>, not every system over the whole span (measured on the giant battle: 73 killmails came back, 8 with no corp member, 7 of them from a system with one corp kill), and killmails that share no pilot with the fight&apos;s own are dropped.</>,
    ],
    why: <>"The battle report is just everything we have fought and even some stuff I don&apos;t see us involved in. It used to be these clean succinct battles… time alone is not perfect — make it really smart, look at how fights start and end and link together, and really get it so these fights are more split up."</>,
    policy: <>Nothing new — the same zKillboard lists, CCP&apos;s public killmails and br.evetools&apos; analyze. More killmails are read once (the whole list instead of 60), then cached; the br.evetools windows are smaller than before.</>,
  },
  {
    version: '0.203.2', date: '2026-09-19', headline: 'Battle Reports: click a ship picture for the pilot panel — exact fit, copy for the game, zKillboard inside',
    changes: [
      <>In <b>Battle Reports</b>, clicking a <b>ship picture</b> on a loss row now opens the <b>pilot panel</b> first instead of jumping to zKillboard: the <b>exact fit from that killmail</b> (✓ confirmed — it is the ship that died), a <b>copy for the game</b>, the pilot&apos;s part in the battle (what they lost, when, to whom; their damage), and the <b>zKillboard link</b> for the kill right there. Every other ship the pilot lost in the battle is listed as a picture — click one and the panel switches to its fit. A pod shows the <b>implants</b> that died with it.</>,
      <>Each <b>top damage</b> row gained the <b>hull that pilot did most of their damage in</b>, as a clickable picture: their fit is exact if they lost that hull in the battle, otherwise their own nearest loss of it, otherwise their corp mates&apos; fits in the same hull — the same rules as the Log Visualizer, never another hull. A loss with no pilot (a structure) still opens zKillboard directly.</>,
      <>One panel, two tabs: the Log Visualizer and Battle Reports now share the same component, so a change to one is a change to both. Switching pilots or losses while a read is still in flight can no longer land the old answer on the new panel.</>,
    ],
    why: <>"I want to add this feature to Battle Reports as well — link to this pop-up first when you click a ship picture, and the zKillboard link can be there too if it died, just like they do now. It embodies the &lsquo;make things interactable and visual&rsquo; vibe that makes the app better."</>,
    policy: <>One more zKillboard query, measured first: a single killmail&apos;s list row by its id, used only when a battle knows a kill&apos;s id but not its hash (CCP&apos;s public killmail route needs both). Same identified, one-at-a-time module as every other zKillboard call.</>,
  },
  {
    version: '0.203.1', date: '2026-09-19', headline: 'Log Visualizer: never another hull — corp mates’ fits in the same hull instead',
    changes: [
      <>The pilot panel <b>no longer shows a different hull</b> when the pilot has no loss of the ship you fought. It says so, and shows nothing of theirs. The exact fit of a ship you killed is unchanged — and now costs <b>no killboard request at all</b>: the killmail you are on is read straight from CCP.</>,
      <>The fallback is <b>corp mates&apos; fits</b>: what other pilots of their corporation lost in the <b>same hull</b> (the alliance is asked when the corporation has nothing). The losses nearest in time to your fight are read and folded into up to four <b>distinct fits</b>, each a row you can open to look at and <b>copy for the game</b> on its own. A fit lost by several pilots is a shared doctrine and leads the list (“lost by 3 pilots · 5 losses”); stripped hulls are left out and counted; the pilot&apos;s own losses are excluded. Under a <i>likely</i> fit the same list is one click away. NPC-corporation pilots get a plain “no shared fits to read”.</>,
      <>Their own losses are now asked for <b>by hull</b> (one request, all their losses of that ship, however old) instead of walking their last 200 mixed killmails and opening up to 60 of them — so an older loss of the hull is found, and far fewer killmails are opened.</>,
    ],
    why: <>"I don&apos;t like the way the guessing currently works. If there is no fit for that hull on the character we were fighting, I don&apos;t want to see a different hull. I do definitely want to see the exact fit if we killed them. A good fallback would be the fits of corp mates in the same hull — show a couple of options with a drop-down for each so we can copy them and look at them; it is pretty common to share fits amongst corp mates."</>,
    policy: <>One new zKillboard query, measured before it shipped: losses of one hull by a character, a corporation or an alliance. It goes through the app&apos;s one identified, one-at-a-time module like every other zKillboard call; killmail contents still come from CCP&apos;s public route. Fewer requests overall than before.</>,
  },
  {
    version: '0.203.0', date: '2026-09-18', headline: 'Log Visualizer: an enemy who died in your fight now shows a CONFIRMED fit — and it copies into the game',
    changes: [
      <>The pilot panel no longer calls every fit a guess. When the pilot <b>lost the hull you fought inside the window on screen</b>, the fit is read from that killmail and labeled <b>✓ confirmed fit</b> — a killmail is what was fitted when the ship died. A killmail one of your characters is on is picked first and <b>loads by itself</b> (one feed read and one killmail). Otherwise the panel takes their loss of that hull <b>nearest in time to the fight</b> — not simply their newest, so an old fight does not borrow next week&apos;s fit — and says so: <b>likely fit</b>, “lost 3 d before it”. (With no loss of that hull, 0.203.1 shows corp mates&apos; fits in the same hull — never a different hull.)</>,
      <><b>⧉ copy fit for the game</b>: the fit goes to the clipboard as EFT text. In game, open the fitting window → Import &amp; Export → Import from clipboard, then open the fit and press Simulate. Drones are always included; tick <b>+ cargo</b> for the hold. Pyfa reads the same text. The text is checked against the app&apos;s own EFT parser in the fixtures.</>,
      <>The fit itself is fuller: each module shows the <b>charge that was loaded in it</b> beneath it (they used to be listed as loose rows), and <b>subsystems, drones and cargo</b> — which were dropped — are shown. Module, charge and rig <b>icons</b> now draw (the panel asked for a ship render of every type, so they came up blank). A killmail shared by several of your characters is listed once, with its hull and time.</>,
    ],
    why: <>"I really like this zKill fit guesser, but I would like to improve it. That Rattlesnake died — could it not be 100% certain of that fit based on that? Also I should be able to copy from this to sim in game."</>,
    policy: <>Same sources as before — zKillboard&apos;s API through the app&apos;s one identified module, and CCP&apos;s public killmail route. The confirmed case now reads <b>fewer</b> killmails than the old guess did (one, instead of walking the feed). The clipboard copy is the player pasting text into the game&apos;s own import, by hand.</>,
  },
  {
    version: '0.202.12', date: '2026-09-18', headline: 'Σ Summary: the filter row tidied into two lines', published: true,
    changes: [
      <>The filters now sit on two lines: <b>jumps</b>, <b>max age</b>, <b>class</b> and <b>linked only</b> on the first, <b>activity</b> and <b>ore</b> (the rock chips) on the second. <b>✕ clear filters</b> lives in the panel&apos;s top-right corner at all times, greyed when nothing is set. Every label is styled alike and every control is the same height, centred on its line — no more labels sitting high while their neighbours sit low.</>,
    ],
    why: <>"Let&apos;s make these filters look a bit better: jumps, max age, class on the top row in that order, then activity on the next row with ore next to it. Clear filters should be the very top-right corner. Make sure the text is all formatted the same — some are aligned top and others centre."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.202.11', date: '2026-09-18', headline: 'Σ Summary: a filter per rock — pick Gneiss and see every gneiss site and where it is',
    changes: [
      <>The filter row has a new <b>ore</b> line: one chip for every rock the chain&apos;s ore sites carry, with the number of sites holding it. Grades and variants are folded together — <b>Gneiss</b> covers Prismatic Gneiss and Gneiss IV-Grade as well. Pick a rock and only the ore sites holding it stay; each is <b>valued on that rock&apos;s share alone</b> (the Basis column lists the units counted and says “Gneiss only”), the Ore tile totals it, and every other system dims on the chain drawing. Pick several rocks to see them together. The chip&apos;s tooltip gives the total units across the chain. Measured over the shipped site tables: 126 rock names fold into 28 families.</>,
      <>An ore site whose contents the tables do not know is counted apart (“hidden (contents unknown)”) rather than silently dropped. Picking a rock lifts an activity filter that would have left ore out.</>,
      <>Dark Ochre&apos;s variants (Jet, Onyx, Obsidian Ochre, Ochre III-Grade) now take Dark Ochre&apos;s price as their floor — they were the one family whose variant names do not contain the base ore&apos;s name, so they had no estimate.</>,
    ],
    why: <>"I had a request to add more granularity for mining certain ores. Add a filter for just the rocks, one filter for each rock, and it shows all rocks that match that — not grade specific. I want to be able to select gneiss and see a dashboard of all the gneiss and where it is."</>,
    policy: <>Nothing new — the rock lists are the same published site contents the estimates already use.</>,
  },
  {
    version: '0.202.10', date: '2026-09-16', headline: 'Chain drawing: filtered-out systems dim; lighter class and effect tags', published: true,
    changes: [
      <>Filter the summary — say C1 to C3 combat sites — and the chain drawing now <b>dims every card that has nothing in view</b> under those filters, and the links that only touch dimmed cards. The systems stay where they are so the chain remains readable; the ones that matter stand out at a glance, and the header counts the dimmed ones.</>,
      <>The class tag (“C2A”) and the effect tag (“MAG”) on each card, and the chips on the route strip, are set lighter — the heaviest weight made the letters bleed together.</>,
    ],
    why: <>"When I filter the summary by for example C1–C3 combat sites only it should dim anything that does not match in the chain table, with all the systems shown… make the data easier to glance at as you filter and sort. Also the text in the rectangles within the system box is a bit hard to read due to being too bold."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.202.9', date: '2026-09-16', headline: 'The Σ Summary never sits empty: unsettled readings are retried, the origin always lands', published: true,
    changes: [
      <>A reading taken before the map&apos;s drawing had settled could carry no signature list, or label every system by its J-code — then the typed home was not found, nothing was linked, and the tab sat empty until the five-minute re-read. Three fixes: the app <b>does not publish a reading until the drawing has settled</b> (it keeps the last good one and reads again in a few seconds); when the typed home label is not on a reading the <b>map&apos;s own home system</b> is used under whatever label that reading carries; and if the tab still comes up empty it <b>asks for another reading on its own</b>, says so on screen, and only after a dozen tries tells you plainly what to do.</>,
      <>The status line now explains an empty table in words (“the map&apos;s drawing had not settled when it was read — reading again…”) instead of a blank.</>,
    ],
    why: <>"As a user that doesn&apos;t know what to look for, the summary tab opens and never loads. Most users won&apos;t troubleshoot, it just needs to work — and if something is holding it up we need to be working on getting that dashboard running again ASAP."</>,
    policy: <>Nothing new: the same reads of the map&apos;s own data, only better timed and retried.</>,
  },
  {
    version: '0.202.8', date: '2026-09-16', headline: 'Ore variants are priced at their base ore, so fewer sites read "without an estimate"',
    changes: [
      <>The site tables name rocks by their exact variant — Golden Omber, Concentrated Veldspar, the Grade-II and Grade-III belts — and the app&apos;s type list carries the base ores only, so those rocks went unpriced and their sites showed no estimate. A variant yields at least its base ore, so a rock the list does not know now takes its <b>base ore&apos;s Jita price as a floor</b>. Measured: 74 of the 151 priceable names resolved before; the rest were all variants (and three comma typos, now healed).</>,
    ],
    why: <>Found while measuring the summary&apos;s load: the price fetch resolved only 74 of 151 names.</>,
    policy: <>Nothing new. Still Jita sell, still a floor: a variant is never valued above what its base ore fetches.</>,
  },
  {
    version: '0.202.7', date: '2026-09-16', headline: 'Aperture stays warm: no page reload when you come back, and a lighter map read',
    changes: [
      <>Once opened, the <b>Aperture module stays alive in the background</b> when you visit another module, hidden rather than torn down. Coming back is instant: the corp map is where you left it, logged in, and the Σ Summary shows its last reading immediately instead of waiting for the page to load again.</>,
      <>Each map read used to fetch and comb through every script and stylesheet of the map page — 28 files, 2.6 MB — hunting for the effect colours, on every single read. That hunt now runs once per page load and its result is reused.</>,
      <>The read now leaves its timings in the diagnostic log (how long the page took, the feed, the app&apos;s own number crunching and the price fetch), so any remaining slowness can be measured rather than guessed.</>,
    ],
    why: <>"It really lags there for a minute, I feel like you can find an efficiency gain."</>,
    policy: <>Nothing new. The map page keeps running in the background exactly as it does under the Σ tab today; nothing is sent to it.</>,
  },
  {
    version: '0.202.6', date: '2026-09-16', headline: 'The Σ Summary fills in on its own when you open Aperture',
    changes: [
      <>Opening Aperture from another module and going straight to <b>Σ Summary</b> used to leave the tab on “reading the map…” until you pressed ⟳ or five minutes passed: the map page was still loading when the tab asked for its first reading, the read failed quietly, and nothing tried again. Now a read asked for too early waits for the page and runs the moment it has loaded, the first load reads on its own, and an empty or failed read tries again a few times.</>,
      <>Coming back to Aperture shows the <b>previous reading straight away</b> (with its time) while the fresh one is fetched, instead of a blank tab.</>,
    ],
    why: <>"Do a quick check on the loading of the Aperture summary — it takes a minute for it to populate and felt like I might need to open Aperture to populate it or something."</>,
    policy: <>Nothing new: the same read of the map's own data through your own login.</>,
  },
  {
    version: '0.202.5', date: '2026-09-16', headline: 'Chain summary table: click a heading to sort, again to reverse',
    changes: [
      <>Every column heading in the chain summary&apos;s table sorts the table — jumps, system, class, activity, site, value, age, basis. The first click sorts the way you would expect (value richest first, jumps nearest first, age freshest first); a second click reverses; a third returns to the default order. The active heading shows an arrow, and the choice is remembered.</>,
      <>Rows with no distance, value, age or name go <b>last either way</b>, so a “?” never sits at the top. Equal rows keep the default order beneath the sort (nearest, then richest).</>,
    ],
    why: <>"What about sorting the tables by category label clicks, both ways."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.202.4', date: '2026-09-15', headline: 'Summary charts really fill their panels now, and a grabbed panel follows the mouse',
    changes: [
      <>The three charts on the right of the chain summary <b>draw to the room they have from the moment they appear</b>. Before, they only re-fitted if the panel changed size after the data was already there, which in the real app it never was — so they sat at a fixed small size in a tall panel. The ISK bars widen and their labels grow with the panel, the activity mix rows and bars thicken, the freshness bars stretch.</>,
      <>Grabbing a right-hand panel&apos;s corner <b>no longer makes it jump bigger first</b>. The panel is pinned at its current height the moment you press on the corner, and from then on only the handle sizes it; the other two share what is left. The three split spare room four parts to two to two.</>,
    ],
    why: <>"The bars and resizing is really not great, when I grab the bottom it jumps bigger then I need to drag up and they all look bad and not taking up the proportions they have to fill with their graphics."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.202.3', date: '2026-09-15', headline: 'Summary panels drag again; the mining alert leaves a trail in the log',
    changes: [
      <>The <b>drag handles on the three right-hand panels</b> of the chain summary work again — the first cut of 0.202.2 sized those panels in a way that ignored the handle. Drag one and the other two share what is left; drag the drawing and the three grow with it, three parts to two to two.</>,
      <>Every time the ⛏ mining alert names or clears a character it now writes a line to the diagnostic log (Documents → EVE Conductor Logs) with the cycle length it measured, the counts it compared and the delay in force — so a real mining session can be checked afterwards against what the box said.</>,
    ],
    why: <>"I can't adjust the size of the panels in summary page."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.202.2', date: '2026-09-15', headline: 'Chain summary: a linked-only toggle, the filters where the eye goes, and charts that fit their panels',
    changes: [
      <>A <b>linked only</b> tick in the filter row leaves out the systems that are on the map but have no drawn link back to the origin: their dashed column leaves the drawing, their sites leave the tiles and the table, and the header says how many are hidden. The tick is remembered.</>,
      <>The <b>filter row now sits between the tiles and the drawing</b>, not under it.</>,
      <>The three charts on the right — ISK by jumps, activity mix, freshness — now <b>share the column&apos;s height and draw to whatever room they have</b>: the bars, rows and freshness columns scale with the panel. Drag a panel&apos;s bottom-right handle, or let a long chain stretch the row, and nothing sits marooned in empty space any more.</>,
    ],
    why: <>"There should be a toggle to filter out the systems that are not connected, also the filters should be between the top panels and the chain panel, not below that panel. Also I would like the right panel to self dynamic fit the content to the resized panels."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.202.1', date: '2026-09-15', headline: 'Mining alert: faster by default, your own knobs, and a page to dismiss or snooze any overlay alert',
    changes: [
      <>The mining alert now reacts after <b>30 seconds</b> by default instead of two minutes — at the crew&apos;s 15-second cycles a dead module is named about a minute after it died — and the wait is yours to set: the ⛏ Mining Alert page has a <b>react-after</b> slider (0–180 s), <b>what counts as a drop</b> (any module lost / a third of the rate / half), which of the two things to say (dropped rate, stopped miner), <b>blink</b> on or off, and how long a “not mining” line stays on screen. Every control explains itself.</>,
      <>A new <b>🔔 Alerts</b> page in the overlay settings window lists what the ⛏ mining, 🪐 planets and 🎯 raids boxes are showing right now, with <b>dismiss</b> (hidden until it goes away on its own), <b>snooze</b> (10 min / 1 h), <b>snooze everything</b> (15 min / 1 h / 4 h) and the three master switches in one place. <b>Alt+]</b> in game opens that page directly, without setup mode.</>,
    ],
    why: <>"2 min is too long of a calibration time, we want to bring those mining cycles online ASAP… controls in the overlay settings pop up in its own tab with nice descriptions… calibration should be control delay time, maybe some other things like turning on and off completely and better settings for it. Also we should be able to quickly dismiss these or snooze these types of alerts or even disable these alerts."</>,
    policy: <>Nothing new. A global hotkey (Alt+]) opens the app&apos;s own settings window; nothing is sent to the game.</>,
  },
  {
    version: '0.202.0', date: '2026-09-15', headline: 'Mining alert on the overlay: the miner who is not pulling gets named',
    changes: [
      <>A new <b>⛏ box on the multibox overlay</b> names a character whose <b>mining rate dropped</b> — a module has stopped feeding the log and stayed that way for two minutes (a crystal gone, a rock depleted and not retargeted) — or who has <b>stopped mining</b> while the rest of the crew is still going (a full hold, a forgotten module). It says who, and for how long; it does not guess why. New alerts blink for their first seconds.</>,
      <>Read from each character&apos;s own game log, the same lines the Log Visualizer&apos;s mining dashboard uses (<i>“You mined …”</i>, one per module per cycle), followed live by byte offset — read-only, nothing is ever written to the game&apos;s files. The cycle length is learned from the lines themselves, so lasers, strips, ice and gas all work.</>,
      <>Deliberately quiet when <b>nobody in the crew is still mining</b> (the whole crew stopped: a move, an unload run), for about two cycles after the first of them starts again, when a character <b>docks or leaves the system</b>, <b>changes ship</b>, or is a <b>lone miner</b> stopping. A crystal swap or a retarget stays silent.</>,
      <><b>On by default; switch it off</b> in the overlay settings window (Tools ▾ → Multibox overlay settings… → ⛏ Mining Alert). Off means no log is read at all. The box has its own position and width in setup mode (Alt+\), like the other notice boxes.</>,
    ],
    why: <>The CEO&apos;s ask: "Add mining alert for a drop in mining rate using the logs we can already read… notify when a mining module shuts down due to crystal loss, full capacity, etc. You don&apos;t need to specify why, just state which character is not running optimally. This should be toggleable… you need to not notify when every single miner stops, that will happen a lot when moving."</>,
      policy: <>Nothing new: the game&apos;s own log files, read as before, plus the location the overlay already polls from ESI. No input is ever sent to the client.</>,
  },
  {
    version: '0.201.11', date: '2026-09-15', headline: 'Florida is the chain summary\'s home out of the box', published: true,
    changes: [
      <>The chain summary's <b>home</b> is <b>Florida</b> by default — prefilled in ⚙ Settings → Your setup and in the tab's own field — so a fresh install counts jumps from the corp's home without typing anything. An install set up before this version, whose file never had the key, gets the same default.</>,
      <>Change it if your map labels home differently. Clear it, and the summary follows whatever the map itself marks as home; a cleared field stays cleared across restarts.</>,
    ],
    why: <>"I want Florida entered in app as a default, that is not super secret info."</>,
    policy: <>The label was on the personal-data guard list until now and is removed from it on the owner's decision. Character names and ids, the map's address, the ship name and the home J-code stay guarded.</>,
  },
  {
    version: '0.201.10', date: '2026-09-15', headline: 'Baked dataset refreshed: measurements through 15 September', published: true,
    changes: [
      <>A <b>new install</b> now starts with the project's collected history to date: the market radar summary (108,269 item rates, up from 102,632 in the previous bake), its region coverage, and the skyhook raid history (48,055 observations, the last on 15 September). Same three files, same format, same allowlist — only impersonal measurements derived from public data; never wallets, orders, fits or trend events.</>,
      <>An <b>existing install</b> is untouched. The app seeds only files missing from your stats folder, so your own collected history always wins.</>,
      <>Housekeeping on the public source repository: its history was rebuilt so a test fixture's map label is gone from every past commit, not only the current one.</>,
    ],
    why: <>"We should update our public dataset, again ensuring we keep things in the same format and prevent anything private to me from being shared."</>,
    policy: <>The bake is scanned against the owner's personal-pattern list before a byte is copied, and the ship guard scans it again inside the packaged app; the file shapes were compared record for record against the previous bake before building.</>,
  },
  {
    version: '0.201.9', date: '2026-09-15', headline: 'Jumps, not holes; the selected system glows apart from its route', published: true,
    changes: [
      <>Distance reads as <b>jumps</b> everywhere — the column heads, the filter, the table column, the bar chart, the card labels and tooltips.</>,
      <>The system you click now <b>glows white</b>, while the systems and links merely on its route keep their coloured stroke, so the selection and the path read apart.</>,
    ],
    why: <>"Nobody says a hole is x holes away, it is x jumps away." and "make the selection glow a bit so it is clear what part is highlighted due to being part of the path and what is highlighted due to selection."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.201.8', date: '2026-09-15', headline: 'Systems on the map with no link to the origin are shown as such, not hidden',
    changes: [
      <>The chain is walked outward from the origin along the wormholes the map has drawn. A system that is on the map but has no drawn link back to the origin used to be left off the drawing silently. It now sits in a last, dashed column headed "on the map, not linked", its card says "no link to origin", and the header line names them. Their sites still show "?" for holes and drop out under a distance filter; draw the link on the map and they join the chain on the next read.</>,
    ],
    why: <>"I don't see the systems I added to the map on the dashboard — is that purposeful because we cannot get to them? If so that makes a lot of sense, but we need to be clear about how it works."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.201.7', date: '2026-09-15', headline: 'Shattered systems carry the map\'s dotted circle',
    changes: [
      <>A shattered wormhole shows a dotted circle after its name on the card and on the route strip, with a tooltip. The 108 shattered systems come from CCP's static data (every planet in them is the shattered kind): the 75 regular shattered holes, the 25 small-ship C13 ones, Thera and its neighbours. C13 has its own class colour.</>,
    ],
    why: <>"I added some systems with a shattered symbol, that is important to show as well (the dotted circle)."</>,
    policy: <>CCP's public static data; nothing new.</>,
  },
  {
    version: '0.201.6', date: '2026-09-15', headline: 'All six effect colours are now the map\'s own',
    changes: [
      <>The hunt paid off: the map page's own script chunk carries its effect palette, and the six colours are baked in — Magnetar <b>#e06fdf</b>, Red Giant <b>#d9534f</b>, Pulsar <b>#428bca</b>, Wolf-Rayet <b>#e28a0d</b>, Cataclysmic Variable <b>#ffffbb</b>, Black Hole <b>#000000</b>. The four the map had drawn matched the measured badges exactly. A live reading still overrides them, so if the map is ever recoloured the summary follows.</>,
      <>The reader's palette scan now takes the colour that follows an effect's name rather than the nearest one, which had picked up a neighbouring status palette.</>,
    ],
    why: <>"Can you find what the other colour codes are somehow?" — the map's own front-end code, reached through your login, the same palette Aperture uses for its little squares.</>,
    policy: <>The map's own script, read through your login; colours only.</>,
  },
  {
    version: '0.201.5', date: '2026-09-15', headline: 'Effect box without the inner square; a wider hunt for the two effect colours the map has not shown',
    changes: [
      <>The effect box is just the box: the effect's colour as border and text, no swatch inside. Same for the route strip.</>,
      <>Pulsar and Wolf-Rayet have not been drawn on the map since the reader started measuring, and the map's public files carry no palette, so the reader now searches every script and stylesheet the logged-in map page has loaded — the lazily loaded route chunks included — for each effect's name beside a colour, on every read. The two colours get baked in as soon as a read finds them or the map draws them.</>,
    ],
    why: <>"Can you find what the other colour codes are somehow? Hunt through the F12 stuff. Also the square in the effect box is not necessary."</>,
    policy: <>The map's own page and scripts, through your login, structure and colours only.</>,
  },
  {
    version: '0.201.4', date: '2026-09-15', headline: 'Effect colours taken from your map; calmer class tags; low-sec and tags fixed',
    changes: [
      <>The effect box now shows the same little coloured square your map draws, in the map's own colours: the reader measured the map's badges (Magnetar magenta, Cataclysmic Variable pale yellow, Black Hole black, Red Giant red) and adopts the colours of whatever is on the map at each read; Pulsar and Wolf-Rayet keep placeholders until they appear, and the reader also looks for the full palette in the map's own code.</>,
      <>Class tags are outlined instead of solid: a dark translucent pill with the class colour as border and text, still large, without the glare.</>,
      <>A hole's letter tag was missing when the map's card began with an age badge ("7h"); the reader now skips age and count badges. A k-space hole with no signatures showed no class colour; every system's class now comes from the map, not only from its signatures. Low-sec yellow leans orange.</>,
    ],
    why: <>"The colours for the effects should be colour-coded to match the little squares on the map … too much contrast on the C#X boxes … J131304 is a C3A but shows no letter … Shalne is low-sec but wasn't colour-coded … make the low-sec yellow a bit more orange."</>,
    policy: <>Colours are read from the map's own page and its scripts through your login, structure only. Nothing new leaves the machine.</>,
  },
  {
    version: '0.201.3', date: '2026-09-15', headline: 'The whole way home lights up; a smaller, colour-coded effect box on the card\'s bottom edge',
    changes: [
      <>Click a hole and the <b>whole route from home</b> to it is highlighted, every link and every card, with a strip listing the systems. When your active character is somewhere else on the chain, their own way there is drawn too, in green, as a second line.</>,
      <>The effect box is now small, the same width as the class tag, anchored to the card's bottom edge, and abbreviated: WR, PULS, MAG, BH, RG, CATA. Hover it for the full name and the modifiers. Each effect has its own colour, and the reader now records how your map colours its effect badges so the summary can adopt the map's palette on the next read.</>,
    ],
    why: <>"The whole path back to home hole should be highlighted, not just one line on the way back. The effects should be smaller and anchored to the bottom side, a truncated name, the same size as the C#X box, the full name on hover. See if you can steal colour coding from Aperture."</>,
    policy: <>Nothing new. The palette probe reads only computed colours of the map's own badges, structure only.</>,
  },
  {
    version: '0.201.2', date: '2026-09-15', headline: 'The effect sits in its own box under the class tag; hover it for the exact modifiers',
    changes: [
      <>Each card's effect is now an amber box directly under the class tag. Hover it and a panel lists what that effect does in that class — armor HP, signature radius, resistances, weapon damage, capacitor, velocity and the rest, with the exact percentages — for example Wolf-Rayet in a C6: armor HP +100%, signature radius −50%, shield resistances +50%, small weapon damage +200%. The route strip's effect chips carry the same list.</>,
    ],
    why: <>"The hole effect should be in a box below the C#X box and when you hover over that it should show the effects of that (sig radius +X etc.)." The percentages are read from CCP's static data export — each system's effect beacon carries the modifiers the game applies — not from a wiki table, so every class of every effect is exact.</>,
    policy: <>CCP's public static data; nothing new is read from the game or sent anywhere.</>,
  },
  {
    version: '0.201.1', date: '2026-09-15', headline: 'Chain cards: a route from you to the clicked hole, bigger class tags, and the wormhole effect',
    changes: [
      <>Click a hole and a <b>route strip</b> appears above the drawing: from your active character's current system to that hole, system by system with class tags and effects, and the jump count; the links and cards on the way light up and your card gets a 🧍. If you are not on the chain, it says where you are.</>,
      <>The <b>class tag</b> is now a large filled pill — dark text on the class colour — at the top right of every card, on the route strip too. Cards grew to fit.</>,
      <>Every system's <b>effect</b> shows on its card and in the route: Wolf-Rayet, Pulsar, Magnetar, Black Hole, Red Giant, Cataclysmic Variable. It comes from the map's own feed when the map records one, otherwise from CCP's static data export, which the app now carries for every wormhole system.</>,
    ],
    why: <>"When you select a hole I want a route from the selected character and the system you selected, and I want deeper contrast under the C#X tags, which are extremely important pieces of info, so they should also be a larger part of the cards. Make sure we are showing system effects like Wolf-Rayet."</>,
    policy: <>Your character's location is the same CCP route already read for the "me" origin; the effect table is CCP's public static data. Nothing new is sent anywhere.</>,
  },
  {
    version: '0.201.0', date: '2026-09-15', headline: 'Every kind of site priced: k-space anomalies by bounty, pirate cans by your own hauls, k-space gas and ore by contents',
    changes: [
      <><b>K-space combat anomalies</b> — every Angel, Blood Raider, Guristas, Sansha and Serpentis Hideaway through Sanctum (Hidden, Forsaken and Forlorn variants included) and the ten Rogue Drone sites — are priced by NPC bounties: every rat in the initial spawn and the listed waves at CCP's kill bounty from the static data export, before any ESS or dynamic-bounty modifier. Random, faction and escalation spawns are noted, not counted.</>,
      <><b>Pirate relic and data sites</b> use your own history. A <b>＋ haul</b> button on the row opens a logger: paste the loot from your inventory (select all, Ctrl+C) and it is appraised at Jita sell, or type the ISK. The site's estimate is the average of your logged hauls and updates with every new one; a site you have never run borrows the average of its tier (Crumbling, Decayed, Ruined; Local, Regional, Central) across factions. The hauls live in a portable file beside your setup.</>,
      <><b>K-space gas sites and ore anomalies</b> are priced from their published contents at Jita sell, ore by security band where the wiki gives it. Your logged hauls also stand in for any site the tables do not know.</>,
    ],
    why: <>"Do the k-space thing, I want it calculated. For relic and data sites it's okay to use the player's historical averages in game; track that and update numbers as that is updated. Add all the sites from all types of systems — the chain is almost always going to contain all types of systems." Bounties are deterministic from CCP's data; can loot is not, so it is measured from your own runs.</>,
    policy: <>CCP's static data export is public data; the wiki pages are public; your hauls are typed or pasted by you and stay in your Documents folder. No new game-side reads.</>,
  },
  {
    version: '0.200.12', date: '2026-09-15', headline: 'The chain summary is a tab of the Aperture module',
    changes: [
      <>Aperture now has two tabs: <b>Corp Map</b> and <b>Σ Summary</b>. The summary opens in place, reads the map the moment the tab opens, and re-reads every five minutes while it is showing. The map page stays loaded underneath, so its login persists and switching back is instant.</>,
      <>The summary follows the Aperture screen's zoom level; the pop-out window and its own zoom are gone.</>,
    ],
    why: <>"I want the summary to be a separate tab now instead of a pop up. It is a very good module now."</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.200.11', date: '2026-09-15', headline: 'Every filter drives the whole chain dashboard',
    changes: [
      <>The clicked system, holes out, class, activity and max age now shape everything at once: the tiles, the numbers on the chain cards, ISK by holes out, the activity mix, freshness and the table. The drawing keeps every system so the chain stays navigable; a system with nothing in view says so and stays clickable.</>,
    ],
    why: <>"Combat sites with one hole as the filter filtered the results below but not the panels at the top or the graphs to the right. All filters should change the dashboard." The charts had been reading a copy of the view without the clicked system.</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.200.10', date: '2026-09-15', headline: 'Chain map colours by class',
    changes: [
      <>Cards, the class column and the class filter now share one scheme: <b>C1–C3 blue</b>, light to bright; <b>C4</b> yellowish orange; <b>C5–C6</b> red; <b>high-sec</b> green; <b>low-sec</b> traffic-sign yellow; <b>null-sec</b> purple-maroon. A legend sits above the chain drawing.</>,
    ],
    why: <>Asked for exactly this scheme; the old one graded only by difficulty and gave every k-space hole the same blue.</>,
    policy: <>Nothing new.</>,
  },
  {
    version: '0.200.8', date: '2026-09-15', headline: 'Zoom any screen; every screen remembers its own level',
    changes: [
      <>A <b>− 100% +</b> control in the header of every window. Each screen — every module, the chain summary, the overlay setup window — keeps its own level, remembered across restarts; a popped-out module follows its module. Click the percentage to go back to 100%. <b>Ctrl +</b>, <b>Ctrl −</b> and <b>Ctrl 0</b> do the same for the screen you are on.</>,
      <>Zoom is real layout zoom, not a stretched picture: text, charts, tables and buttons grow together and the screen reflows to the window — lines wrap, grids collapse, scrollbars appear where needed — so a zoomed screen stays readable. Aperture zooms the map page itself.</>,
    ],
    why: <>"I want to be able to click zoom in and zoom out to modify any screen and I want them remembered individually … think about readability." Ten steps from 70% to 200%, 100% in the middle.</>,
    policy: <>Nothing new: a display preference kept on your machine.</>,
  },
  {
    version: '0.200.7', date: '2026-09-15', headline: 'A modified pod is the same pod: old fingerprints fold once EVE\'s clone list disowns them',
    changes: [
      <>After every poll that reads both your worn implants and your complete jump-clone list, any pod the app once saw you wearing that is neither worn now nor on EVE's list is folded into whichever real body it is a small edit from — the pod you are wearing or a listed jump clone — when the implants differ by plugging in, pulling out, or up to two swapped. Name, alert and history carry over. The pod you modified and then jumped out of keeps its name on the jump clone it became.</>,
      <>A once-worn pod that EVE still lists as a jump clone stays separate. A once-worn pod whose implants differ a lot (you were podded, or refitted heavily) is left alone and ages out as before.</>,
    ],
    why: <>0.200.5's rule looked at timing (worn within a day, not listed since) and folded nothing on a real registry with 48 once-worn records. EVE's clone list is the proof that a fingerprint is a separate body; the rule now waits for it, which is at most two minutes.</>,
    policy: <>Unchanged: your own characters' implant and clone lists from CCP, already read for the overlay.</>,
  },
  {
    version: '0.200.5', date: '2026-09-15', headline: 'Chain cards name systems properly and show the class tag; a modified pod is no longer a second pod',
    changes: [
      <>Chain cards show the system's <b>custom name</b> when the map has one, else the <b>system name</b> — never the region. The first live read had picked "The Forge" for a k-space hole because the region also appears on the map's card.</>,
      <>The class chip carries the map's tag: <b>C2A</b>, <b>C4F</b>, and so on, on the cards and in the table.</>,
      <>Plugging an implant into the pod you are wearing no longer produces a second pod (finished in 0.200.6, below).</>,
    ],
    why: <>"I want the holes to say the system name when one is available, if it has a custom name that is most important. I also want to see C#X … it would be C2A." and "When I change my pod by adding a new implant … it seems to think I now have 2 pods." A worn pod is one body; only a jump-clone listing proves an old fingerprint is a separate one.</>,
    policy: <>Unchanged. The pod rule uses only the implant and clone lists CCP already provides for your own characters.</>,
  },
  {
    version: '0.200.4', date: '2026-09-14', headline: 'Chain summary: a graphical dashboard, and home taken from the map itself',
    changes: [
      <>A dashboard above the table: the <b>chain drawn by distance</b> (one column per hole out, every system a card with its class, ISK on field and site count, links drawn between them), <b>ISK on field by holes out</b> (stacked by activity; click a bar to set the filter), the <b>activity mix</b>, and <b>freshness</b> (signatures by age of the map's last look).</>,
      <>Click a system on the drawing and the tiles and table focus on it; the drawing keeps showing the whole chain.</>,
      <>The map's feed names its own home system, so the origin is prefilled from the map when nothing is typed; a typed label still overrides it.</>,
      <>Signatures that name their system by CCP's id (rather than the map's) are matched too; the diagnostics log now records each list's field names flat, so a first real read can be checked line by line.</>,
    ],
    why: <>"I like what you have so far but I want a graphical dashboard as well." The first real read also showed the map's document carries a home-system id and all signatures inline, so the reader was tightened to that shape.</>,
    policy: <>Unchanged — the same feed, the same cadence; the drawing is computed locally from it.</>,
  },
  {
    version: '0.200.3', date: '2026-09-14', headline: 'Chain summary reads the complete signature list from the map itself — no panel needed',
    changes: [
      <>The app now reads the map's own data feed — the same JSON the map page loads — for every system drawn on the chain: all signatures, all types, all classes, whatever the Signature Search panel shows or whether it is open at all. The panel table is only a fallback.</>,
      <>The feed's field names are not assumed. Which list holds the systems, which field is the id, which two fields make a link, which field is the signature id, group, site name and timestamp — each is inferred from the values and checked against the drawn chain, the ABC-123 pattern, the activity words and the app's own site tables. When the feed carries a group code instead of a word, the activity comes from the site name.</>,
      <>The window says which source it used ("map feed · N systems known" or "Signature Search panel") and the diagnostics log records what was matched and how well.</>,
    ],
    why: <>"Can you not just do this yourself in the background as a function of the app? I thought we would remove the complication of the sig search panel needing to be open and unfiltered." Yes — reading the page's own data instead of its screen is the way to do that. The schema is private, so the reader adapts to it rather than guessing it; verified against three plausible schemas plus decoys, and the first real read reports its matches.</>,
    policy: <>Your own map, your own login, the same routes the page itself requests, once per press or every five minutes while the window is open (one request per drawn system, four at a time). Nothing is sent anywhere else.</>,
  },
  {
    version: '0.200.2', date: '2026-09-14', headline: 'Chain summary: relic and data sites priced, home prefilled, the map is never touched',
    changes: [
      <>Sleeper relic ("Forgotten …") and data ("Unsecured …") sites are now priced at the blue loot their guards drop — all 24, C1 to C6, from EVE University's per-site pages. The hackable cans on top are random and stay uncounted; the basis column says so.</>,
      <>The home system's label is a per-player setting (⚙ Settings → Your setup → Home system on the map) and prefills the summary window; typing it in the window saves it to the same file.</>,
      <>The reader no longer clicks the map's tabs. If the Signature Search panel is not on screen it keeps the last list, still updates the chain drawing, and says what to do. A structure-only look at the map's own data feeds is recorded so the next version can read the complete list without the panel at all.</>,
    ],
    why: <>"These sites should be priced, why would you not?" — the guards' blue loot is a fixed NPC price, so that part is priceable; the cans are not. "Auto ensure everything is selected right in Aperture without disrupting what the user is doing on the map" — clicking the map's own controls was the wrong tool; the map's data feed is the right one, and this version measures its shape first. Pirate relic/data cans and k-space anomaly bounties have no published per-site figures yet.</>,
    policy: <>Unchanged: your own map, your own login, read on demand. The feed probe requests the same paths the page itself just loaded, once per press, and stores only key names and value types.</>,
  },
  {
    version: '0.200.1', date: '2026-09-14', headline: 'Chain summary: reads the real map — classes, distances and filters now work',
    changes: [
      <>The first read of a real map showed every class as "—" and every distance as "?", so any filter emptied the table. The map renders the class chip glued to the system name and identifies its chain links by bare numbers, which the first reader could not follow.</>,
      <>The reader now takes the Signature Search table cell by cell, and the chain links from what the map's own drawing library puts in the page (its "Edge from A to B" labels, or the drawn line's endpoints against the system boxes).</>,
      <>The origin line says how many links were read; when a filter hides rows only because their class or distance is unknown, the window says so instead of showing an empty table.</>,
    ],
    why: <>"Filters seem to completely clear the results no matter what you have selected, holes is always a question mark and class is always a dash." Verified with 48 hand-computed fixtures and a synthetic copy of the map's page structure, since the map itself is private.</>,
    policy: <>Unchanged: the same page you are looking at, read in place through your own login. The structure probe records shapes only (letters and digits masked) in the local diagnostics log.</>,
  },
  {
    version: '0.200.0', date: '2026-09-14', headline: 'Chain summary: what is out there to do in chain, in its own window',
    changes: [
      <>A <b>Σ Summary</b> button on the Aperture module opens a pop-out window: ISK on field per activity (combat, ore, gas, relic, data) and every site with its distance in wormhole hops.</>,
      <>Two origins: <b>home</b> (the map's home system) or <b>me</b> (the active character's current system from CCP's location route).</>,
      <>Filters: holes out, wormhole class C1 to C6 plus HS/LS/NS, activity, max age. Re-read on demand or every five minutes.</>,
      <>Valuation tables: the 24 sleeper combat sites at their blue-loot totals, 10 gas sites and 10 ore anomalies at their published contents times live Jita sell.</>,
    ],
    why: <>"Scrape the aperture map to put together a dashboard for what is out there to do in chain, x ISK on field per activity … filter by distance from home and wormhole level … on a pop-out window … x jumps from me and x jumps from home." The map is the only source of what is in chain; it is read in place through your own login, exactly as the Theft import does, and every figure is labelled "if untouched".</>,
    policy: <>The corp's own map, your own login, read on demand at a low cadence — not CCP data, and nothing leaves your machine. Site values come from public wiki pages (facts, cited in the code) and CCP's public market data.</>,
  },
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
