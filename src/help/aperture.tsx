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
          <Bar brand="Aperture" tabs={['Corp Map']} active="Corp Map"
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
