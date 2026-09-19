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
            <><b>Battle Reports</b> after a corp fight — the fights told apart, each a poster-style card, the visual report and a shareable link.</>,
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
            <Fig caption="Each fight is a poster: ships on each side, ISK destroyed vs lost, when, who it was against, where.">
              <div style={{ fontSize: 11.5, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px', maxWidth: 260 }}>
                <div><b style={{ fontSize: 20, color: '#4da3ff' }}>19</b> <span style={{ opacity: 0.6 }}>v</span> <b style={{ fontSize: 20, color: '#ff5b5b' }}>9</b> <span style={{ opacity: 0.6, fontSize: 10 }}>SHIPS</span> <span style={{ float: 'right', color: '#f0c674' }}>★ yours</span></div>
                <div><b style={{ fontSize: 15, color: '#5fd08a' }}>1.42b</b> <span style={{ opacity: 0.6, fontSize: 10 }}>DESTROYED</span> <b style={{ fontSize: 15, color: '#ff5b5b' }}>80.00m</b> <span style={{ opacity: 0.6, fontSize: 10 }}>LOST</span></div>
                <div><b>Today 05:07</b> <span style={{ opacity: 0.6 }}>· 30 min · 3 h ago</span></div>
                <div>▣ ▣ <span style={{ opacity: 0.6 }}>v</span> ▣ ▣ ▣ <span style={{ opacity: 0.6, fontSize: 10 }}>corp logos</span></div>
                <div style={{ opacity: 0.6 }}>J123456 + J234567 · 11 killmails</div>
              </div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>⟳</b> re-reads the corp killboard. The corp-wide list comes from zKillboard's public API, which zKill caches for up to an hour — so a fight involving corp mates who are not logged into Conductor can take that long to appear. Fights involving your own logged-in characters arrive live from CCP, and a logged-in Director makes the whole corp feed live.</li>
              <li><b>Select a card</b> — opens the visual report and copies its <i>br.evetools</i> link for sharing. <b>↗ open</b> buttons open the report or the live view in your browser.</li>
              <li><b>Team A — ours / Team B</b> — the two sides; alliance and corp rows open on zKillboard with the pilot count. <b>Click a ship picture</b> on a loss row and the <b>pilot panel</b> opens: the exact fit from that killmail (✓ confirmed), a copy for the game, the pilot&apos;s part in the battle, every other ship they lost in it (click one to switch), and the zKillboard link for the kill. Each <b>top damage</b> row shows the pilot and the hull they did most of their damage in; <b>either picture</b> opens the same panel — exact if they lost that hull in this battle, else their own nearest loss of it, else their corp mates&apos; fits in the same hull. A loss with no pilot (a structure) still opens zKillboard directly. The panel is the same one the Log Visualizer opens — see <i>A pilot you fought</i> there.</li>
              <li><b>The cards</b> read like posters, most important first: <b>ships on each side</b> (ours blue, theirs red — pilots seen on the corp&apos;s killmails of the fight, so an enemy who got away unscathed was never counted), <b>ISK destroyed vs lost</b> (a ≥ marks a killmail that has no price yet), <b>when</b> in words (“Today 05:07 · 30 min · 3 h ago”, EVE time; the exact times are in the tooltip), the <b>two sides as corporation logos</b> — ours on the left, theirs on the right, most pilots first; hover a logo for the name and its pilot count — then <b>where</b>. Red on a card always means ISK lost and their ships, nothing else. These come from the corp&apos;s own killmails, so they are there before any report loads.</li>
              <li><b>Timeline</b> — every killmail of the fight on a time axis, the running totals per side as step lines. Four modes: <b>ships lost</b>, <b>ISK lost</b>, <b>damage taken</b> (by the ships that died, as each killmail records it) and <b>pilots seen</b> (distinct pilots seen on a killmail so far). <b>Hover</b> for the kill under the cursor — who lost what, when, for how much, to how many attackers, and both totals at that moment; <b>click</b> it to open that pilot. ● is a ship, ○ a pod. Every number is a sum over killmails, so the chart cannot say more than they do; each mode&apos;s limit is written under it. The mode is remembered.</li>
              <li><b>Everyone involved</b> — both sides, every pilot seen on the fight&apos;s killmails: portrait, the hulls they were seen in (a red ring = lost here), their corporation, damage dealt, killmails and final blows, and what they lost. Sort by damage, kills, lost or name. Every picture opens the pilot panel. A pilot who neither got on a killmail nor died is invisible to any killboard — the roster says so.</li>
            </ul>
          ),
        },
        {
          id: 'reports-split', title: 'How fights are told apart',
          figure: (
            <Fig caption="The selected card says how it was grouped and why it ended.">
              <div style={{ fontSize: 11.5 }}>
                <div><b>J123456 + J234567</b> <span style={{ color: '#f0c674' }}>★ yours</span></div>
                <div style={{ opacity: 0.7 }}>05:07–05:37 EVE · 11 corp killmails · 19 corp pilots</div>
                <div style={{ opacity: 0.7, marginTop: 4 }}>grouped by: same system, same people ×7 · the fight moved: same crew, same enemy ×1 · round two: they came back ×2 — kills every 67 s — ended: 22 min of quiet before these pilots or this system appear again</div>
                <div style={{ marginTop: 6 }}>☑ my fights (4) &nbsp; ☐ hide single kills (25) &nbsp; 61 fights</div>
              </div>
            </Fig>
          ),
          body: (
            <>
              <p>The list is the <b>whole corporation&apos;s</b> killmails from the last three days. A busy corp is never quiet for long, so silence alone cannot separate fights — the app reads the killmails instead: who fought whom, where, and how fast.</p>
              <Steps items={[
                <>Killmails are walked oldest first. Each one either <b>joins a fight that is still open</b> or <b>starts a new one</b>.</>,
                <><b>Same system, same people</b> — some of the same pilots, or the same enemy group, before the fight has gone quiet. <b>Same system, same moment</b> — within three minutes, whoever is on it (the fringe of a brawl).</>,
                <><b>The fight moved</b> — another system, but the same crew <i>and</i> the same enemy. <b>Spilled into another system</b> — the same crew on a killmail somewhere else within five minutes; no map is needed, the same pilots in two systems minutes apart is the proof they connect (wormhole chains included).</>,
                <><b>Round two</b> — same system, same enemy, most of the same crew, up to thirty minutes later: both sides reshipped and came back.</>,
                <>A fight <b>ends by its own tempo</b>, not a fixed clock: six of its typical gaps between kills, never under 6 minutes, never over 15. A brawl with a kill every 40 seconds is over after six silent minutes; a slow camp with a kill every three minutes is given fifteen.</>,
                <>Two skirmishes that a later killmail ties together by people are <b>merged</b> into one fight.</>,
              ]} />
              <ul>
                <li><b>★ yours</b> marks a fight one of your logged-in characters is on. <b>my fights</b> shows only those; <b>hide single kills</b> folds away the one-killmail entries (a lone gank, a pilot lost to rats). Both are remembered.</li>
                <li>The report asks br.evetools for <b>each system over its own part of the fight</b> (plus ten minutes either side), then keeps only killmails that share a pilot with the corp&apos;s own killmails of that fight — strangers shooting strangers in the same system stay out; an ally&apos;s kill or a third party who shot someone in the fight stays in.</li>
              </ul>
              <Limit>The corp&apos;s killmails are the only evidence. A fight no corp member got on a killmail of does not exist here. Two groups of corp mates fighting the same enemy in two systems with no pilot in common show as two fights until a killmail ties them together. zKillboard lists at most 200 kills and 200 losses, so a very busy three days may not reach all the way back.</Limit>
            </>
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
          id: 'live-pilot', title: 'A pilot you fought: their fit, and copying it into the game',
          figure: (
            <Fig caption="Click a pilot under Top targets. When they died in the fight on screen, the fit is the killmail itself — confirmed, not guessed.">
              <div style={{ fontSize: 11.5 }}>
                <div><b style={{ color: '#5fd08a' }}>✓ CONFIRMED FIT</b> <span style={{ opacity: 0.7 }}>the killmail of the Rattlesnake they lost at 23:35 — a kill you are on</span></div>
                <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center' }}><b>Rattlesnake</b> <span style={{ opacity: 0.7 }}>lost 23:35 · 969M ISK ↗</span> <span style={{ marginLeft: 'auto' }}>☐ + cargo <Btn mini>⧉ copy fit for the game</Btn></span></div>
                <div style={{ marginTop: 6 }}>Rapid Heavy Missile Launcher II<br /><span style={{ opacity: 0.7, marginLeft: 14 }}>↳ 9× Caldari Navy Scourge Heavy Missile</span></div>
              </div>
            </Fig>
          ),
          body: (
            <>
              <Steps items={[
                <>Every pilot or ship picture opens the same panel: a row in <b>Top targets</b> or <b>Top attackers</b>, a card in <b>Kills &amp; losses</b> (that killmail is then the evidence — a pilot who died twice gets the one you clicked; a loss card is your own pilot), and in <b>Battle Reports</b> a loss row or a top-damage pilot. The zKillboard links live inside the panel. The panel shows what passed between you (or their part in the battle), the killmails in scope, and <b>their fit</b>, read from killmails.</>,
                <>Inside the panel the <b>pictures are the links</b>, each with a <b>zKill ↗</b> badge and a caption: the <b>headshot</b> opens the pilot on zKillboard; the <b>ship up top</b> opens <i>that kill</i> when there is a killmail of it in scope (otherwise it is just a picture — there is no kill page to open); the <b>picture in the fit section</b> opens the killmail the fit was read from — the same kill when the fit is confirmed, the similar loss when it is a likely fit, a corp mate&apos;s killmail in the corp-mates rows. There are no other links.</>,
                <>The label says how sure it is. <b>✓ Confirmed fit</b> — they lost the hull you fought <b>inside the window on screen</b>; a killmail one of your characters is on is read first, straight from CCP, and loads by itself. A killmail is what was fitted when the ship died, so this is fact, not inference. <b>Likely fit</b> — no loss of that hull in this window, so it is <b>their own</b> loss of the same hull <b>nearest in time</b> to the fight (the panel says "3 d before" or "2 h after"): a strong guess for a doctrine ship, a guess all the same. <b>Another hull is never shown</b> — it would say nothing about the ship you fought.</>,
                <>Each module carries the <b>charge that was loaded in it</b> on the line beneath; subsystems, drones and the cargo hold are listed too.</>,
                <>No loss of that hull on their killboard? The panel turns to <b>corp mates&apos; fits</b>: what other pilots of their corporation lost in the <b>same hull</b> (the alliance is asked if the corporation has nothing), the losses nearest in time to your fight, folded into up to four <b>distinct fits</b>. Each is a row you can open — and copy without opening. A fit <b>lost by several pilots</b> is a shared doctrine and leads the list; stripped hulls are left out and counted. Under a <i>likely</i> fit the same list is one click away (<b>＋ corp mates&apos; fits</b>). A pilot in an NPC corporation has no corp mates worth reading, and the panel says so.</>,
                <><b>⧉ copy fit for the game</b> puts the fit on the clipboard as EFT text. In game: open the <b>fitting window</b> → <b>Import &amp; Export</b> → <b>Import from clipboard</b>, then open the saved fit and press <b>Simulate</b>. Pyfa reads the same text. Drones are always copied; tick <b>+ cargo</b> to bring the hold along (spare ammo and cap boosters, but loot and junk too).</>,
              ]} />
              <Limit>Even a confirmed fit has edges. No killmail shows <b>implants, boosters, fleet boosts or heat</b>, nor anything they swapped at a depot earlier in the fight; charges are what was loaded at the moment of death. If they lost the same hull twice in the window, the panel shows the last one (a mail you are on first) and says how many there were. The window is the scope on screen: scope to the fight chip before trusting "inside the window" on a long range. <b>Corp mates&apos; fits are other people&apos;s ships</b> — the panel labels them so; a big corporation flies more than one fit per hull, and only the twelve losses nearest your fight are read. zKillboard caches its lists for up to an hour, so a loss from minutes ago may not be listed yet (a kill you are on does not depend on that list).</Limit>
            </>
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
