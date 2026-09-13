// THEFT — skyhooks and ESS. The book.
import type { ModuleHelp, PanelHelp } from './types';
import { Btn, Fig, Flow, Limit, Steps, Table, Try } from './figures';

export const THEFT_HELP: ModuleHelp = {
  title: 'EVE Theft Conductor',
  blurb: 'skyhooks · ESS',
  intro: [
    {
      id: 'what', title: 'What this module is for',
      figure: (
        <Fig caption="Where the numbers come from — and why some are facts and some are ceilings.">
          <Flow steps={["CCP's public raidable-skyhooks feed", 'diffed every check', 'window = FACT', 'banked = CEILING', 'your bar readings settle it']} />
        </Fig>
      ),
      body: (
        <>
          <p>
            What can be robbed near you, and when. Theft windows come from CCP's own public data and are facts. What is <i>in</i> a skyhook is a ceiling: the feed cannot see raids at the very end of a window or after it, so "should be full" can be quietly empty. The module says which is which in every column.
          </p>
          <Steps items={[
            <>Tell it where you are: type a <b>near system</b>, or press <b>pull from Aperture</b> once so distances come from your own map.</>,
            <>Read the <b>Window</b> column — OPEN rows can be robbed right now.</>,
            <>Read <b>Danger/hr</b>, <b>Jumps/hr</b> and the route ⚠ before undocking.</>,
            <>When you fly by a skyhook, read its Surplus Bay bar and enter the tics with <b>bar</b>. The history corrects itself, including raids the feed never saw.</>,
          ]} />
        </>
      ),
    },
  ],
  groups: [
    {
      id: 'skyhooks', title: 'Skyhooks',
      pages: [
        {
          id: 'controls', title: 'The controls',
          body: (
            <ul>
              <li><b>⟳ refresh now</b> — re-pull the feed immediately (it also refreshes on its own).</li>
              <li><b>near system</b> — distances are stargate jumps from here. Leave it blank and distances come from the <i>nearest k-space system on your imported map</i> (the row says "via" which one).</li>
              <li><b>ignore radius</b> — list every skyhook in the feed, however far.</li>
              <li><b>open now only</b> — hide windows that have not opened yet.</li>
              <li><b>pull from Aperture</b> — loads your logged-in corp map in a hidden window and imports its systems as the distance origin. <b>forget map</b> clears them.</li>
            </ul>
          ),
        },
        {
          id: 'table', title: 'Reading the table',
          figure: (
            <Fig caption="One row per raidable skyhook. Hover any header in the app for the full measurement note.">
              <Table head={['', 'Jumps', 'Planet', 'Window', 'Bar', 'Raids', 'Last empty', 'Sec', 'Danger/hr', 'Jumps/hr', 'NPC/hr', 'Held by']}
                rows={[
                  [<Btn mini>▸ ⚠</Btn>, '4 via Tama', 'Kedama VI · Lava', 'OPEN · 48m left', '0.7', '3 seen · 1 mine', '5d ago', '-0.3', '2', '31', '140', 'Corp X'],
                  [<Btn mini>▸</Btn>, '7', 'Nourv III · Ice', 'in 2h 10m', '0.2', 'usually survives', '1d ago', '-0.5', '0', '4', '0', 'Corp Y'],
                ]} />
            </Fig>
          ),
          body: (
            <ul>
              <li><b>▸ waypoint</b> — set the running client's autopilot to the system. A <b>⚠</b> beside it marks recent kills on the shortest route in — click it for the system-by-system breakdown.</li>
              <li><b>Jumps</b> — stargate jumps from your near system (or "via" the nearest mapped system).</li>
              <li><b>Planet</b> — as it reads in game, with its class. Skyhooks only exist on Lava and Ice planets.</li>
              <li><b>Window</b> — <b>OPEN</b> with time left, or a countdown to opening. Facts.</li>
              <li><b>Bar</b> — the estimated Surplus Bay fill (0–1), calibrated from real bar readings paired with witnessed raids. A ceiling until someone reads the bar.</li>
              <li><b>Raids</b> — measured history: the watcher sees a skyhook vanish mid-window when someone empties it; "usually survives" means windows have closed without a raid.</li>
              <li><b>Last empty</b> — when the silo was last known empty (an observed raid or your own mark).</li>
              <li><b>Danger/hr</b> — ship + pod kills in the system in the last hour. <b>Jumps/hr</b> — gate traffic: witnesses and competing thieves. <b>NPC/hr</b> — locals active in space; "usually survives" plus ratting usually means defended.</li>
            </ul>
          ),
        },
        {
          id: 'actions', title: 'Row actions & popups',
          body: (
            <>
              <ul>
                <li><b>bar</b> — enter the surplus bar's filled tic count (the right gauge; count solid tics, about one per day of roughly 125). It resolves any uncertain window closes for that skyhook and recalibrates the fill estimate.</li>
                <li><b>I raided it</b> — log your own raid. Kept in your history beside the observed ones (the feed cannot see your raid if it happened at the end of the window).</li>
                <li><b>Route ⚠</b> — a popup listing every hot system on the shortest route with recent kills, a bubble hint when an interdictor was on a kill, and a window chip to widen or narrow the look-back. Click a system for its kills, or open it on zKillboard.</li>
                <li><b>Incursion</b> chip — a Sansha incursion in the constellation; click for the system effects.</li>
              </ul>
              <Try>Sort by <b>Window</b>, pick an OPEN row with low Danger/hr and low Jumps/hr, press <b>▸</b>, undock. On the way out, press <b>bar</b> and type what the gauge showed.</Try>
            </>
          ),
        },
        {
          id: 'limits', title: 'Honest limits',
          body: (
            <Limit>
              The public feed never lists a skyhook past its window end and drops it the moment a raid empties it — so raids in the last minutes of a window, and anything after, are invisible. That is why <b>Bar</b> is a ceiling and <b>Raids</b> says "seen". Your own bar readings and "I raided it" marks are the only settled truth, which is why the buttons are on every row.
            </Limit>
          ),
        },
      ],
    },
    {
      id: 'ess', title: 'ESS',
      pages: [
        {
          id: 'ess-table', title: 'Reading the table',
          body: (
            <>
              <p>Every system in range that <b>has</b> an ESS (CCP puts one in every sovereign nullsec system with the right index), with:</p>
              <ul>
                <li><b>Jumps</b> — from your near system or nearest mapped system.</li>
                <li><b>NPC/hr</b> — ratting is exactly what fills an ESS bank, so this is the best available proxy for a worthwhile one.</li>
                <li><b>Danger/hr</b> — ship + pod kills in the last hour.</li>
                <li><b>My raids</b> — your own logged ESS raids here.</li>
                <li><b>▸</b> sets a waypoint; <b>log raid</b> records one.</li>
              </ul>
              <Limit>EVE offers <b>no data route for ESS bank contents</b>. This tab lists locations and activity and never pretends to know what is inside — an honest map, not a fake ledger.</Limit>
            </>
          ),
        },
      ],
    },
  ],
};

export const THEFT_PANELS: Record<string, PanelHelp> = {
  'theft.skyhooks': {
    title: 'Reading this table',
    body: (
      <p>
        Rows come from CCP's public raidable-skyhooks feed. <b>Window</b> times are facts.
        <b> Bar</b> is a <i>ceiling</i>: it assumes nothing was stolen since the last
        known emptying, and the feed is provably blind to end-of-window and post-window
        raids — so treat a full bar as "up to this much". A fly-by reading of the in-game
        Surplus Bay bar is the only settled truth: enter its tics via the <b>bar</b> button
        and the raid history corrects itself, including raids the feed never saw.
      </p>
    ),
  },
};
