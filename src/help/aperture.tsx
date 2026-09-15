// APERTURE — the corp map, embedded. The book.
import type { ModuleHelp } from './types';
import { Bar, Btn, Fig, Limit, Steps } from './figures';

export const APERTURE_HELP: ModuleHelp = {
  title: 'Aperture',
  blurb: 'the corp map, embedded',
  intro: [
    {
      id: 'what', title: 'What this module is',
      figure: (
        <Fig caption="The map's own toolbar sits above the embedded page.">
          <Bar brand="Aperture" tabs={['Corp Map', 'Σ Summary']} active="Corp Map"
            right={<><Btn mini>←</Btn><Btn mini>→</Btn><Btn mini>⟳</Btn><Btn mini>🗺 map</Btn><Btn mini>↗ browser</Btn></>} />
        </Fig>
      ),
      body: (
        <>
          <p>
            Your corporation's own web map, embedded so the whole workflow lives in one app. It runs as a real browser tab with its <b>own persistent login</b>: sign in once inside the panel and it sticks across restarts. The Theft module can read your system list straight from it.
          </p>
          <Steps items={[
            <>⚙ Settings → <b>Your setup</b> → paste the map's address into <b>Aperture URL</b>. Nothing is hard-coded — a corp mate with a different map pastes theirs.</>,
            <>Open the module and log in inside the panel when the map asks.</>,
          ]} />
        </>
      ),
    },
  ],
  groups: [
    {
      id: 'map', title: 'Corp Map',
      pages: [
        {
          id: 'toolbar', title: 'The toolbar',
          body: (
            <ul>
              <li><b>←</b> / <b>→</b> — back and forward inside the map, like a browser.</li>
              <li><b>⟳</b> — reload the map page.</li>
              <li><b>🗺 map</b> — jump back to the corp map address if you navigated away inside the panel.</li>
              <li><b>↗ browser</b> — open Aperture in your normal browser instead (for the one feature that cannot run here, below).</li>
            </ul>
          ),
        },
        {
          id: 'summary', title: 'Σ Summary — what is out there to do in chain',
          figure: (
            <Fig caption="The Σ Summary tab: ISK on field per activity, every site with its distance in jumps from home or from you.">
              <div style={{ fontSize: 11.5 }}>
                <div>distance counted from <Btn mini primary>🏠 home</Btn> <Btn mini>Florida</Btn> <Btn mini>🧍 me · Pilot</Btn></div>
                <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                  {[['Combat', '312m · 4 sites'], ['Ore', '95m · 5 sites'], ['Gas', '41m · 2 sites'], ['Relic', '— · 1 site'], ['Data', '— · 2 sites']].map(([g, v]) => (
                    <span key={g} style={{ padding: '4px 8px', border: '1px solid var(--border)', borderRadius: 6 }}><b>{g}</b> {v}</span>
                  ))}
                </div>
                <div style={{ marginTop: 6 }}>jumps ≤ <Btn mini>2 ▾</Btn> class <Btn mini on>C3</Btn> <Btn mini on>C4</Btn> <Btn mini>C5</Btn> activity <Btn mini on>Combat</Btn> max age <Btn mini>6 h ▾</Btn></div>
              </div>
            </Fig>
          ),
          body: (
            <>
              <Steps items={[
                <>Log in on the <b>Corp Map</b> tab once, then open the <b>Σ Summary</b> tab. The app reads the map's own data feed for every system drawn on the chain — the complete signature list, all types and classes, no panel needed — through your own login; the map stays loaded underneath. Nothing leaves your machine and nothing on the map is clicked or changed. The <i>Signature Search</i> table is only a fallback if the feed cannot be read.</>,
                <>Pick the origin: <b>🏠 home</b> — <b>Florida</b> out of the box, prefilled in ⚙ Settings → Your setup and in the tab's own field; change it if your map labels home differently, or clear it to follow the home system the map itself marks — or <b>🧍 me</b>, your active character's current system from CCP's location route. Every site shows its distance in jumps from there.</>,
                <>Read the dashboard: the <b>chain drawn by distance</b> (a column per jump; each card shows the system, its class, ISK on field and site count — click one to focus the tiles and table on it), <b>ISK by jumps</b> (stacked by activity — click a bar to set the distance filter), the <b>activity mix</b> and <b>freshness</b> (how long since the map last looked at each signature).</>,
                <>Filter by <b>jumps</b>, <b>class</b> (C1 easiest to C6 hardest, plus HS/LS/NS), <b>activity</b> and <b>max age</b>. The tiles and the table follow; when a filter hides rows only because their class or distance is unknown, the window says so.</>,
                <><b>⟳ refresh</b> asks the map for a fresh reading; the tab re-reads every five minutes on its own while it is open.</>,
              ]} />
              <Limit>Every ISK figure is <b>if untouched</b>; nothing can tell a fresh site from a half-run one. Where each number comes from (the Basis column says it per row): sleeper combat, relic and data sites — the blue loot their sleepers drop (the cans on top are random and not counted); wormhole and k-space gas and ore sites — published contents times live Jita sell; k-space combat anomalies — every rat in the spawn and the listed waves at CCP's kill bounty, before ESS or bounty modifiers, random and escalation spawns excluded; pirate relic and data sites — <b>your own average</b> from hauls you log with the <b>＋ haul</b> button (paste the loot from your inventory or type the ISK); a site you have never run borrows its tier's average. An unscanned signature has no name and no estimate. The tab names its source: "map feed" is the complete list; "Signature Search panel" means the feed could not be read. <b>Distances follow the map's drawn links</b>: the chain is walked outward from the origin along the wormholes the map has drawn, so a system that is on the map but has no drawn link back to the origin sits in the last, dashed column ("on the map, not linked"), its sites show "?" for jumps, and they drop out under a distance filter — draw the link on the map and it joins the chain on the next read.</Limit>
            </>
          ),
        },
        {
          id: 'limits', title: 'Login & limits',
          body: (
            <>
              <p>The panel keeps its own cookies, separate from the rest of the app, so logging in here does not touch your EVE logins and vice versa.</p>
              <Limit>The map's <b>overlay pop-out</b> (the button that opens a floating window) does not work inside the app — the embedded page greys out. Use <b>↗ browser</b> for that feature; everything else works in the panel.</Limit>
              <p>The Theft module's <b>pull from Aperture</b> button uses this same login to read your map's systems in the background — nothing to set up twice.</p>
            </>
          ),
        },
      ],
    },
  ],
};
