// HELP CONTENT — every module tab's how-to, plus per-panel entries.
//
// RULE 20 (LEARNINGS/RULES.md): every new feature lands WITH its help.
// A module tab gets a section in MODULE_HELP; a non-obvious panel gets a
// PANEL_HELP entry and an <InfoDot id="…"/> next to its title. The intro
// tour (Help.tsx) is updated when onboarding itself changes.
//
// Voice: written for a corp mate on day one — thorough but concise, says
// what to DO first, and states honest limits (what the tool cannot know)
// rather than glossing over them.
import type { ReactNode } from 'react';
import type { ModuleId } from './lib/store';

export interface HelpSection { id: string; title: string; body: ReactNode }
export interface ModuleHelp { title: string; blurb: string; intro: ReactNode; sections: HelpSection[] }

export const MODULE_HELP: Record<ModuleId, ModuleHelp> = {
  trade: {
    title: 'EVE Trade Conductor',
    blurb: 'market radar · orders · hauling',
    intro: (
      <p>
        One trading cockpit for the whole team. Numbers here are <b>measured, never guessed</b>:
        prices come from live order books, fills from executed trades, results from your own
        wallet ledger. Background collectors (radar, trends, wallet, net-worth) keep running
        whichever tab — or module — is open. Log characters in and give them a duty
        (⚙ Settings) and every fee, stock count and button uses the right character
        automatically.
      </p>
    ),
    sections: [
      {
        id: 'finder', title: 'Trade Finder',
        body: (
          <>
            <p>
              Scans your hubs for items worth hauling or flipping. For each candidate: what
              you would pay at the source (based on the cheapest 5% of listings, so one bait
              order cannot fake a low price), what you would list for at the destination, and
              the fee-adjusted return — using the <b>owning character's</b> skills and standings.
            </p>
            <p>
              The fill-rate column is measured from trade prints (units/day your buy order
              would actually capture), and 🔥 heat chips read the destination's live reprice
              timestamps — a hot front line means you will be undercut quickly. Start here when
              you have cargo space and want to know what is worth moving today.
            </p>
          </>
        ),
      },
      {
        id: 'autohaul', title: 'Auto Haul',
        body: (
          <p>
            Builds the shopping list for a station run: the optimizer picks deals in priority
            order and sizes each buy to your <b>ship's cargo, your budget, and what the
            destination market actually absorbs</b>. It tells you what limited the load
            (cargo, ISK, or the station running out of profitable deals), hands you
            multibuy-ready chunks to paste in game, and can set the waypoint. Undock, paste,
            buy, haul.
          </p>
        ),
      },
      {
        id: 'orders', title: 'My Orders',
        body: (
          <p>
            Every live order across all team characters in one table: who holds it, the
            ledger's true average cost of the unsold units, how much capital is asleep in each
            pile, and whether you have been undercut or outbid. Buttons open the item's market
            window in game on every running client. This is the tab you babysit while
            station-trading.
          </p>
        ),
      },
      {
        id: 'trends', title: 'Trends',
        body: (
          <p>
            The long game, from watching <b>your own orders</b>: every outbid and every sale is
            recorded with time and system. From that history it builds your daily playbook —
            when your items actually sell, when rivals undercut (all in EVE time / UTC) — and a
            per-item competition profile. It needs days of your trading to say anything; the
            longer it watches, the better it gets.
          </p>
        ),
      },
      {
        id: 'radar', title: 'Radar',
        body: (
          <p>
            The whole market, measured directly. Every ~30 minutes the radar snapshots the
            <b> entire order book</b> of your trading regions and diffs it against the last
            snapshot: reprices per day = how fast the undercut war moves, volume drops = real
            fills (ISK/day of actual flow, not listings), 🌡/❄ = the war heating or cooling
            versus the last 30 days. Use it to find items with real flow and lazy competition —
            then open the row for the live book.
          </p>
        ),
      },
      {
        id: 'dashboard', title: 'Dashboard',
        body: (
          <p>
            Your results, from the wallet ledger: what you spent, what you sold,
            <b> realized profit on completed round-trips</b> (each sale matched to the units'
            actual purchase, oldest first), and every broker fee and tax — down to THE bottom
            line, realized profit minus all fees. If a number here disappoints, it is telling
            the truth; the ledger only counts what actually happened.
          </p>
        ),
      },
      {
        id: 'explorer', title: 'Item Explorer',
        body: (
          <p>
            One item under the microscope. Search anything in the bar above, and see its live
            books at your hubs side by side, spreads, your stock, and the price history chart.
            The ⭐ watchlist keeps your regulars one click away. When any other tab makes you
            curious about an item, this is where you look it in the eye.
          </p>
        ),
      },
      {
        id: 'groups', title: 'Groups',
        body: (
          <p>
            Families of items (abyssal filaments, mutaplasmids, officer modules…) compared
            across <b>two hubs at once</b>. Each item shows three fee-adjusted ways to work it:
            flip it at one hub, haul it bought instantly, or haul it bought with a bid. Rows
            with fantasy spreads and no measured fills are filtered — two people not talking
            is not a market.
          </p>
        ),
      },
    ],
  },

  character: {
    title: 'EVE Skill & Fit Conductor',
    blurb: 'skill match · fit tools',
    intro: (
      <p>
        Skills, fits, and what your characters can actually fly. Everything is computed by the
        same dogma engine EVE uses (real attributes, real stacking penalties), per character.
        Skills and implants <b>auto-resync while this module is open</b>, so what you see is
        current.
      </p>
    ),
    sections: [
      {
        id: 'match', title: 'Skill Match',
        body: (
          <p>
            Two characters side by side: what each would have to train to match the other,
            skill by skill. Pick them in the left sidebar. Use it to decide which alt gets the
            next injector, or how far a new character is from replacing a main.
          </p>
        ),
      },
      {
        id: 'fit', title: 'Fit Skill Maxer',
        body: (
          <p>
            Pick or paste a ship fit and see <b>every skill that the hull and modules require
            or that boosts them</b> — tiered by impact, with each character's actual fitting
            stats computed by the dogma engine, and a copyable training plan. Skill point
            numbers ride along: the Need and Best columns show each level's total SP cost,
            every character gap shows the SP left to train, and the bottom row totals each
            character's SP to meet requirements and to the full Best plan. The question it
            answers: "what do I train to fly THIS better — and how big is that ask?"
          </p>
        ),
      },
      {
        id: 'wizard', title: 'Fit Wizard',
        body: (
          <>
            <p>
              A graphical fit builder. Start from scratch, <b>from the clipboard</b> (copy
              any EFT fit in game and import it), or <b>from any character's saved fits</b> —
              most fits are alterations of a starting point, not blank slates. Browse modules
              in the market-style tree on the left (drag one onto the wheel, or double-click),
              drag between sockets to move, shift-drag to copy, and use <b>+ charges</b> — or
              drop a charge on the ship — to load ammo everywhere it fits. The selected module
              shows its whole variation family for one-click swaps.
            </p>
            <p>
              Stats on the right are simulated live for the selected character, including
              per-layer resistances and lock time against a sim target. Recommendations
              respect what is actually left: CPU, powergrid, and turret/launcher hardpoints.
              Fits are saved app-side, so there is no in-game size limit.
            </p>
          </>
        ),
      },
      {
        id: 'propagator', title: 'Fit Propagator',
        body: (
          <p>
            Pulls every character's personal saved fits into <b>one canonical list</b>, merges
            the identical ones (same hull and fitting; names ignored), lets you clean up the
            names, then makes every character's in-game folder match that list exactly.
            Duplicates sort to the top because they are the ones needing a decision.
            <b> It deletes fits in game and EVE has no undo</b> — the tool makes you confirm
            exactly what will be removed before it touches anything.
          </p>
        ),
      },
    ],
  },

  battle: {
    title: 'EVE Battle Conductor',
    blurb: 'reports · logs · simulation',
    intro: (
      <p>
        Fights: the corp's recent ones, your live ones, and hypothetical ones. All three tabs
        run on real data — killboard ingests, your actual game log files, and real fits flown
        by real pilots in the simulator.
      </p>
    ),
    sections: [
      {
        id: 'reports', title: 'Battle Reports',
        body: (
          <p>
            The corp's recent fights as cards down the left, newest first. Selecting one opens
            the full visual report and copies its br.evetools link for sharing. The AI
            write-up button at the bottom turns a fight into prose (needs an Anthropic key in
            <code> Documents/EVE Conductor/anthropic.json</code> — ask whoever set up the app).
          </p>
        ),
      },
      {
        id: 'live', title: 'Log Visualizer',
        body: (
          <>
            <p>
              Reads your EVE game logs — live while you play, or any past session. Combat gets
              damage and cap timelines; mining gets yield, crits, residue and <b>ISK totals
              with ISK/hour</b> at live Jita prices, per ore and per character.
            </p>
            <p>
              The crew checkboxes combine multiple characters into one dashboard — tick your
              whole mining fleet and read the crew's total. Time ranges: the whole file, since
              your last undock/login, or click <b>set custom start</b> and click on any
              timeline (a custom end is optional — without one it runs to now).
            </p>
          </>
        ),
      },
      {
        id: 'sim', title: 'Battle Sim',
        body: (
          <p>
            A target and a team of attackers, resolved by the dogma engine. Every ship is a
            <b> real fit</b>, and every fit is flown by a named character's actual skills — or
            by an all-V pilot, or by one with exactly the prerequisites — so you can see the
            gap between "best case" and "barely undocks it". Signature, speed, resists,
            tracking and lock times all fall out of the engine, not out of typed-in guesses.
            Each character-flown ship has a <b>pod picker</b>: "active pod (live)" follows the
            clone the character is actually wearing (tracked by the multibox overlay, so a
            clone jump updates it within a poll), or pin any known pod — or "no pod" — for
            that ship. Implants move real numbers: fitting, speed, tank, damage.
          </p>
        ),
      },
    ],
  },

  theft: {
    title: 'EVE Theft Conductor',
    blurb: 'skyhooks · ESS',
    intro: (
      <p>
        What can be robbed near you, and when. Windows come from CCP's own public data, and
        the module is honest about the difference between a <b>fact</b> (a theft window) and a
        <b> ceiling</b> (what might still be in the bank).
      </p>
    ),
    sections: [
      {
        id: 'skyhooks', title: 'Skyhooks',
        body: (
          <>
            <p>
              Every raidable skyhook in range, from CCP's public feed: where, when its 2-hour
              theft window opens, and the <b>ceiling</b> on what is banked. Raid history is
              measured by diffing the feed between checks — a skyhook that vanishes mid-window
              was robbed.
            </p>
            <p>
              The banked column is a ceiling, not a promise: the feed cannot see raids at the
              very end of a window or after it (measured — the server never lists past
              window end), so a "should be full" skyhook can be quietly empty. The only
              settled truth is the in-game Surplus Bay bar — fly by, read the tics, and enter
              them with the <b>bar</b> button so the history corrects itself.
            </p>
          </>
        ),
      },
      {
        id: 'ess', title: 'ESS',
        body: (
          <p>
            Where an ESS is, in the sov nullsec around you. EVE offers <b>no data route for
            ESS bank contents</b>, so this tab lists locations and never pretends to know
            what is inside — an honest map, not a fake ledger.
          </p>
        ),
      },
    ],
  },

  pi: {
    title: 'EVE Planetary Industry',
    blurb: 'planets · deadlines · balance',
    intro: (
      <p>
        Every watched character's planets in one fleet view, ranked by what they are
        <b> costing you</b> — EVE gives no warning when storage fills and output is silently
        discarded. Watching is per character: the <b>PI</b> tick in ⚙ Settings (or the
        one-click button that appears here when a logged-in character is unticked).
      </p>
    ),
    sections: [
      {
        id: 'planets', title: 'Planets',
        body: (
          <>
            <p>
              Top tiles answer "do I need to log in": planet count, how many need you NOW, the
              single next deadline and whose it is, and the ISK sitting on the ground. The
              <b> Next 72 hours</b> timeline puts every deadline on one clock (■ storage
              fills, ▲ extractor program ends) — click a row to open that planet. Below, one
              worst-first card grid; character chips filter to one login's planets.
            </p>
            <p>
              Cards are honest about what EVE reports: colony state only updates when the
              owner views the colony in game, so "measuring since pickup…" means Conductor is
              waiting for two looks since your last collection. The <b>⚖ rebalance</b> flag
              compares extractor supply (CCP's own yield formula) against factory burn (exact
              schematic rates) and tells you when the head-to-factory ratio is off — a
              next-reset-trip note, never a phone alert. Alert thresholds live at the bottom
              of the page.
            </p>
          </>
        ),
      },
    ],
  },

  aperture: {
    title: 'Aperture',
    blurb: 'the corp map, embedded',
    intro: (
      <p>
        Your corporation's own web map, embedded so the whole workflow lives in one app. The
        map address is a per-player setting (⚙ Settings → Your setup) — nothing is
        hard-coded. It keeps its own login session across restarts; log in once inside the
        panel and it stays. Known limit: the map's <b>overlay pop-out does not work inside
        the app</b> — use the ↗ browser button for that one feature.
      </p>
    ),
    sections: [],
  },
};

// ---------------------------------------------------------------------------
// PANEL-LEVEL entries — for panels whose mechanics are not obvious from the
// module overview. Keyed "<module>.<panel>".
// ---------------------------------------------------------------------------

export const PANEL_HELP: Record<string, { title: string; body: ReactNode }> = {
  'pi.horizon': {
    title: 'Next 72 hours',
    body: (
      <p>
        Every planet with a deadline in the next 72 hours gets a row on a shared clock:
        <b> ■</b> marks where storage fills (extractors keep running and output is thrown
        away past that point), <b>▲</b> marks where an extractor program ends (the planet
        stops producing). Overdue events pin red at the left edge. Colors go blue → amber →
        red as a deadline approaches. Click any row to open that planet's detail; the
        character chips above filter the rows to one login.
      </p>
    ),
  },
  'pi.grid': {
    title: 'Planet cards',
    body: (
      <p>
        One card per planet, worst first — the card at the top-left is always the most
        expensive thing to ignore. The color band and label say what is wrong (FULL, fills
        soon, program ending, ⚖ rebalance…), the portrait says whose planet it is, and the
        card's numbers show fill, extractor pull vs factory burn, and value on the ground.
        Click a card for the full detail: contents, extractors with their per-cycle yield
        chart, factories, flow balance, and a button to set that character's autopilot to the
        planet.
      </p>
    ),
  },
  'theft.skyhooks': {
    title: 'Reading this table',
    body: (
      <p>
        Rows come from CCP's public raidable-skyhooks feed. <b>Window</b> times are facts.
        <b> Banked</b> is a <i>ceiling</i>: it assumes nothing was stolen since the last
        known emptying, and the feed is provably blind to end-of-window and post-window
        raids — so treat a big number as "up to this much". A fly-by reading of the in-game
        Surplus Bay bar is the only settled truth: enter its tics via the <b>bar</b> button
        and the raid history corrects itself, including raids the feed never saw.
      </p>
    ),
  },
  'battle.crew': {
    title: 'Crew & time range',
    body: (
      <p>
        The checkboxes pick which characters' logs feed the dashboard — tick several to see
        the crew as one unit (totals, ISK/hour, per-character breakdowns). Dimmed names have
        no log lines in the current range. Ranges: the whole file, <b>since undock/login</b>
        (your last session boundary), or click <b>set custom start</b> then click on any
        timeline; add a custom end the same way, or leave it open to keep a running total.
      </p>
    ),
  },
  'wizard.browser': {
    title: 'Module browser',
    body: (
      <p>
        The in-game market hierarchy: folders match the client, Standard → Advanced →
        Faction, with meta variants folded under their base item. Drag a module onto the
        wheel (or double-click) to fit it; drag a charge onto the ship to load it everywhere
        it fits. The pane edge drags wider if names are cut off. The list quietly hides
        modules that cannot fit what is left — CPU, powergrid and hardpoints included.
      </p>
    ),
  },
  'wizard.stats': {
    title: 'Fit stats',
    body: (
      <p>
        Simulated live by the dogma engine for the selected character — the same math as the
        in-game fitting window, including stacking penalties. Meters go amber near a limit
        and red with an OVER chip past it. Defense shows each layer's HP and per-damage-type
        resistances like the in-game display. The applied-damage section is a mini simulation
        against a chosen target, including your lock time on it. The <b>🧠 Pod</b> section
        sits the fit in different clones: ten slots, every implant for each slot with its
        Jita price, and one click to load a character's current pod — by default every
        character wears their own implants, a custom pod overrides for all of them so the
        comparison is about the pod.
      </p>
    ),
  },
};
