// BATTLE — the book: Battle Reports, Log Visualizer, Battle Sim.
import type { ModuleHelp, PanelHelp } from './types';
import { Bar, Btn, Chips, Fig, Flow, Limit, Steps, Table, Tiles, Try } from './figures';

export const BATTLE_HELP: ModuleHelp = {
  title: 'EVE Battle Conductor',
  blurb: 'reports · logs · simulation',
  intro: [
    {
      id: 'what', title: 'What this module is for',
      figure: (
        <Fig>
          <Bar brand="EVE Battle Conductor" tabs={['Battle Reports', 'Log Visualizer', 'Battle Sim']} active="Battle Sim" />
        </Fig>
      ),
      body: (
        <>
          <p>Fights: the corp's recent ones, your live ones, and hypothetical ones. All three run on real data — killboard ingests, your actual game log files, and real fits flown by real pilots in the simulator.</p>
          <Steps items={[
            <><b>Battle Reports</b> after a corp fight — the visual report and a shareable link, with an optional AI write-up.</>,
            <><b>Log Visualizer</b> while you play — damage, EWAR and cap timelines, or mining yield and ISK/hour for the whole crew.</>,
            <><b>Battle Sim</b> before you undock — will this team beat that ship, with these pilots' actual skills?</>,
          ]} />
        </>
      ),
    },
  ],
  groups: [
    // ---------------------------------------------------------------- reports
    {
      id: 'reports', title: 'Battle Reports',
      pages: [
        {
          id: 'reports-list', title: 'The list & a report',
          figure: (
            <Fig caption="Cards down the left, newest first. Select one for the full report.">
              <Chips chips={[{ label: '12 Sep · Tama · 14 v 9 · 1.2b lost', tone: 'on' }, { label: '11 Sep · Kedama · 3 v 3' }, { label: '09 Sep · Nourv · 22 v 30' }]} />
              <div style={{ marginTop: 6 }}><Btn mini>⟳</Btn> <Btn mini>↗ open</Btn> <Btn mini>Team A — ours</Btn> <Btn mini>Team B</Btn> <Btn>✍ AI write-up</Btn></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>⟳</b> re-reads the corp killboard. The corp-wide list comes from zKillboard's public API, which zKill caches for up to an hour — so a fight involving corp mates who are not logged into Conductor can take that long to appear. Fights involving your own logged-in characters arrive live from CCP, and a logged-in Director makes the whole corp feed live.</li>
              <li><b>Select a card</b> — opens the visual report and copies its <i>br.evetools</i> link for sharing. <b>↗ open</b> buttons open the report or the live view in your browser.</li>
              <li><b>Team A — ours / Team B</b> — the two sides; alliance and corp rows open on zKillboard with the pilot count; kill rows open the killmail.</li>
              <li><b>AI write-up</b> — turns the fight into prose. Needs an Anthropic key in ⚙ Settings → AI fight summaries; without one the button explains what to do.</li>
            </ul>
          ),
        },
      ],
    },
    // ------------------------------------------------------------------- live
    {
      id: 'live', title: 'Log Visualizer',
      pages: [
        {
          id: 'live-crew', title: 'Crew & time range',
          figure: (
            <Fig caption="Tick the characters whose logs feed the dashboard; pick the window.">
              <Chips chips={[{ label: 'Alice', tone: 'on' }, { label: 'Bob', tone: 'on' }, { label: 'Cid (no logs)' }]} />
              <div style={{ marginTop: 6, fontSize: 11.5 }}><Btn mini>all</Btn> <Btn mini>mine</Btn> · range <Btn mini>since last undock ▾</Btn> · <Btn mini>set custom start</Btn> <Btn mini>set custom end</Btn> <Btn mini>clear</Btn></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Crew checkboxes</b> — tick several to read the crew as one unit (totals, ISK/hour, per-character breakdowns). Dimmed names have no log lines in the range. <b>all</b> selects every character with logs; <b>mine</b> goes back to the header's active character.</li>
              <li><b>Range</b> — <i>since last undock</i> (your last session boundary), <i>last 24 hours</i>, <i>last 3 days</i>, or <i>pick a date…</i>.</li>
              <li><b>set custom start</b> — in the range bar, for every section: arm it, then click a spot on any timeline (damage, cap, mining, the overview curve); everything re-scopes from that moment (running to now). <b>set custom end</b> the same way, or leave it open for a running total. <b>✕</b> on the window chip clears it. The tiles, tables and the feed all follow the window.</li>
            </ul>
          ),
        },
        {
          id: 'live-topics', title: 'Topics & the fight tiles',
          figure: (
            <Fig caption="Overview tiles for the current scope. Every tile's tooltip says how it was measured.">
              <Chips chips={[{ label: 'Overview', tone: 'on' }, { label: 'Damage' }, { label: 'EWAR & Cap' }, { label: 'Mining' }, { label: 'Feed' }]} />
              <div style={{ marginTop: 8 }}>
                <Tiles tiles={[{ big: '1,920', sub: 'peak DPS (best 10 s)', tone: 'good' }, { big: '78%', sub: 'landed vs full misses' }, { big: '2.1b / 0.4b', sub: 'destroyed / lost · 84% efficiency' }, { big: '3,400 GJ', sub: 'cap neuted out of enemies' }, { big: '18k', sub: 'HP repaired onto you' }, { big: '41m', sub: 'bounties' }]} />
              </div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Overview</b> — the tiles above, the running "who was winning" curve (<b>cumulative</b> toggle), and <b>fight chips</b>: each detected fight is a chip; <b>whole range</b> returns to the full scope.</li>
              <li><b>Damage</b> — dealt and received timelines per weapon and per target, hit quality (solid vs grazing), and a per-pilot table with zKill links.</li>
              <li><b>EWAR &amp; Cap</b> — capacitor ripped out of you and by you, reps received, jams and paints as they happened.</li>
              <li><b>Feed</b> — the raw log lines in the scope.</li>
              <li>Destroyed / lost ISK and efficiency come from zKillboard for the pilots in scope.</li>
            </ul>
          ),
        },
        {
          id: 'live-mining', title: 'Mining',
          figure: (
            <Fig>
              <Table head={['Ore', 'Cycles', 'Crits', 'Units', 'Residue', 'ISK', 'ISK/h']} rows={[
                ['Veldspar', '212', '19', '318k', '4%', '31m', '18m'],
                ['Scordite', '96', '8', '140k', '3%', '22m', '13m'],
              ]} />
            </Fig>
          ),
          body: (
            <ul>
              <li>Per ore and per character: cycles, critical successes (and the bonus units alone, priced at Jita ask), units, and <b>residue</b> — the share of depleted rock that never reached the hold.</li>
              <li><b>ISK totals and ISK/hour</b> at live Jita prices for the scope; tick the whole fleet to read the crew's total.</li>
            </ul>
          ),
        },
        {
          id: 'live-feed', title: 'The Feed: search, filters, and the timeline',
          figure: (
            <Fig caption="Filters by what you were doing, an opponent filter, and a strip whose ticks are the filtered events — drag it and the list follows.">
              <div style={{ fontSize: 11.5 }}>
                <Btn mini>search the feed…</Btn> <Chips chips={[{ label: 'you dealt 412', tone: 'on' }, { label: 'you received 388', tone: 'on' }, { label: 'EWAR 9', tone: 'on' }, { label: 'mining 0' }, { label: 'ship changes 2', tone: 'on' }, { label: 'other 31', tone: 'on' }]} />
                <div style={{ marginTop: 6 }}>opponents: <Btn mini on>everyone</Btn> <Btn mini>Zam Slam 140</Btn> <Btn mini>Silent Alaska 96</Btn> <Btn mini>Cormorant Fell 51</Btn></div>
                <div style={{ marginTop: 8, height: 26, border: '1px solid var(--border)', borderRadius: 6, background: 'var(--surface-2)', position: 'relative' }}>
                  {[8, 12, 15, 22, 30, 31, 33, 40, 55, 61, 62, 70, 84, 90].map((x, i) => <span key={i} style={{ position: 'absolute', left: `${x}%`, top: i % 2 ? 4 : 14, width: 2, height: 8, background: i % 2 ? '#ff5b5b' : '#4da3ff' }} />)}
                  <span style={{ position: 'absolute', left: '40%', top: 0, width: 2, height: '100%', background: 'var(--ink)' }} />
                </div>
              </div>
            </Fig>
          ),
          body: (
            <>
              <ul>
                <li><b>Search</b> — every word must match a line: a pilot, a ship, a weapon, an ore, an amount.</li>
                <li><b>Group chips</b> — <i>you dealt</i>, <i>you received</i>, <i>EWAR</i>, <i>mining</i>, <i>ship changes</i>, <i>other</i>, each with its count; click to hide or show.</li>
                <li><b>Opponents</b> — everyone the log names, most-mentioned first. Pick one and the feed becomes your exchange with them: what you did to them and what they did to you, nothing else. That is the "I was trying to kill someone — show me that attempt" filter.</li>
                <li><b>The strip</b> — the scoped window left to right; each tick is one filtered line, coloured by group (blue dealt, red received, amber EWAR, green mining); the red bands are the fights. <b>Click or drag</b> it and the list scrolls there and lights up the lines within three seconds of the cursor. <b>Scroll the list</b> and the cursor follows.</li>
                <li>The list runs oldest to newest so the strip reads left to right. Above four thousand matching lines it shows the most recent four thousand and says so — narrow with the filters.</li>
              </ul>
              <Try>Open the fight where you lost a ship: set a custom window around it, pick the opponent who killed you, and drag the strip through the last thirty seconds.</Try>
            </>
          ),
        },
        {
          id: 'live-limits', title: 'Honest limits',
          body: (
            <Limit>
              The client only logs <i>complete</i> misses, so "landed vs misses" counts full misses, not grazes. A session file over 16 MB is read from its tail. Log files live where EVE writes them; the app reads, never writes.
            </Limit>
          ),
        },
      ],
    },
    // -------------------------------------------------------------------- sim
    {
      id: 'sim', title: 'Battle Sim',
      pages: [
        {
          id: 'sim-teams', title: 'Building the teams',
          figure: (
            <Fig caption="Team B first — the first ship anchors the map. Then Team A, the attackers.">
              <Flow steps={['Team B · add…', 'Team A · add…', 'pilot per ship', 'pod per ship', 'Calculate ▸']} />
              <div style={{ marginTop: 8, fontSize: 11.5 }}>add… → <Btn mini on>mine</Btn> <Btn mini>wizard</Btn> <Btn mini>paste</Btn> · flown by <Btn mini>character skills ▾</Btn> <Btn mini>Alice ▾</Btn> · pod <Btn mini>active pod (live) ▾</Btn></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>add…</b> on either team opens the picker: <b>mine</b> (a character's saved fits and owned ships), <b>wizard</b> (fits from the Fit Wizard, per variation), or <b>paste</b> an EFT fit.</li>
              <li><b>Flown by</b> — a named character's <i>actual</i> skills, an <i>all-V</i> pilot, or one with <i>exactly the prerequisites</i> — so you can see the gap between best case and barely undocks it.</li>
              <li><b>Pod</b> — <i>active pod (live)</i> follows the clone the character is wearing (a clone jump updates it within a poll), or pin any known pod, or <i>no pod</i>. Implants move real numbers: fitting, speed, tank, damage.</li>
              <li><b>×</b> removes a ship; the slots fold shows every damage source the sim extracted from the fit, drones included.</li>
            </ul>
          ),
        },
        {
          id: 'sim-ship', title: 'Per-ship settings',
          body: (
            <ul>
              <li><b>prop running</b> — the propulsion module is on (speed and signature change).</li>
              <li><b>Heading presets</b> — stationary, head-on, orbit… each sets the angle (stationary also zeroes speed); <b>speed</b> can be capped (∞ = the fit's max). This is what the tracking formula consumes.</li>
              <li><b>anchor</b> — which ship this one keeps its geometry relative to.</li>
              <li><b>slots</b> (fold) — every module's state (passive / online / active / overload) and charge; set all at once or individually; <i>put something else in this slot</i> swaps a module without leaving the sim.</li>
              <li><b>inject repping</b> — count cap boosters / paste toward reps.</li>
              <li><b>shoots</b> order chips — who this team's damage focuses, in order; click a ship to focus it first, <b>auto</b> returns to nearest-death.</li>
            </ul>
          ),
        },
        {
          id: 'sim-outcome', title: 'Outcome, timeline & charts',
          figure: (
            <Fig caption="Nothing recomputes until you press Calculate — change anything freely first.">
              <div style={{ fontSize: 11.5 }}>Outcome ☑ count reloading <Btn primary>Calculate ▸</Btn></div>
              <div style={{ marginTop: 6 }}><Chips chips={[{ label: '☠ destroyed', tone: 'bad' }, { label: '⚡ capacitor starved', tone: 'warn' }, { label: '🛠 remote repped', tone: 'good' }, { label: '⛓ scrammed — MWD dead' }, { label: '🎯 PAINTED' }, { label: '📡 JAMMED' }]} /></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>count reloading</b> — sustained mode: each weapon's reload amortised into its DPS.</li>
              <li><b>Calculate ▸</b> — runs the fight; <i>up to date</i> means nothing changed since the last run. The readout says who died when, with confidence when the fight is stochastic (Monte Carlo over many runs).</li>
              <li><b>Timeline</b> — every event as it happened: destroyed, capacitor starved, neutralizing, remote repped, reloading, scrammed, jammed, painted, hardeners down, command bursts… Each event kind has an icon you can toggle off.</li>
              <li><b>Charts</b> — Team A's curves onto Team B's reference ship, or Team B's onto the first Team A ship (the same convention the return-fire estimate uses).</li>
              <li><b>Ammo curves</b> — pick a ship and a charge; <i>flown</i> geometry uses your roster's headings, <i>perpendicular</i> uses pyfa's full-speed-perpendicular assumption. <b>load this charge</b> commits it to the whole weapon group (then Calculate).</li>
            </ul>
          ),
        },
        {
          id: 'sim-solver', title: 'The implant solver',
          body: (
            <>
              <p>Under a character-flown ship, the <b>implants</b> fold asks <i>what should I wear to win?</i></p>
              <ul>
                <li><b>Solve</b> — every complete implant set, then the strongest per-slot candidates; each pod is run through the dogma engine <i>and</i> flown through the fight.</li>
                <li><b>Exhaustive</b> — every reachable implant in every free slot on top of the best five sets. Slower; each candidate is a full engine run plus a full Monte Carlo fight.</li>
                <li>Results show the fight outcome per pod and its <b>entry requirements</b> (skills the implants need), expandable per row.</li>
              </ul>
              <Try>Add your ship flown by yourself, a Team B ship you keep losing to, press Calculate, then open the implants fold and Solve. Compare the winning pod with your active one.</Try>
            </>
          ),
        },
        {
          id: 'sim-how', title: 'How the sim resolves things',
          body: (
            <>
              <ul>
                <li><b>Missiles</b> are flights: launched at the target's predicted position with lead pursuit; a missile that runs out of flight time before intercept simply misses. Max range = velocity × flight time.</li>
                <li><b>Logistics</b> free-run from t=0, need no lock on a damaged ally to start, and retarget the most damaged friend every cycle; a volley resolves before a same-instant heal.</li>
                <li><b>Drones</b> orbit at their own proximity range (Hobgoblin 1 km, Ogre 4 km…) — never a setting.</li>
                <li><b>Tracking</b> consumes the real angular velocity from the headings and speeds you set.</li>
                <li><b>Signature, resists, lock times</b> all fall out of the engine, not out of typed-in guesses.</li>
              </ul>
              <Limit>Human piloting — manual transversal, overheat timing, target switching by feel — is approximated by the presets and the focus order. Treat a close result as a coin flip, a lopsided one as information.</Limit>
            </>
          ),
        },
      ],
    },
  ],
};

export const BATTLE_PANELS: Record<string, PanelHelp> = {
  'battle.crew': {
    title: 'Crew & time range',
    body: (
      <p>
        The checkboxes pick which characters' logs feed the dashboard — tick several to see
        the crew as one unit (totals, ISK/hour, per-character breakdowns). Dimmed names have
        no log lines in the current range. Ranges: since your last undock/login, the last 24
        hours or 3 days, or a date; <b>set custom start</b> (in the range bar, every section) then
        click on any timeline; add a custom end the same way, or leave it open to keep a running
        total. Everything below the bar follows the window.
      </p>
    ),
  },
};
