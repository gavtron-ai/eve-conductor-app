// SHARED GUIDE GROUPS — shown at the end of every module's book: the header
// bar, Settings, the multibox overlay, updates & bug reports, and how to
// read the numbers. Written once, true everywhere.
import type { HelpGroup } from './types';
import { Bar, Btn, Callouts, Fig, Flow, Keys, Limit, N, OverlayMock, Steps, Table, Try } from './figures';

export const SHARED: HelpGroup[] = [
  {
    id: 'shell', title: 'Everywhere',
    pages: [
      {
        id: 'header', title: 'The header bar',
        figure: (
          <Fig caption="The bar at the top of every module. Numbers refer to the notes below.">
            <Bar brand={<><N n={1} />EVE Trade Conductor</>}
              tabs={['Trade Finder', 'Auto Haul', 'My Orders', 'Trends', 'Radar', 'Dashboard', 'Item Explorer', 'Groups']}
              active="Trade Finder"
              right={<>
                <N n={3} /><Btn mini>◉ Alice · hub trader</Btn>
                <N n={4} /><Btn>⟳ Refresh</Btn>
                <N n={5} /><Btn>Tools ▾</Btn>
                <N n={6} /><Btn icon>⧉</Btn>
                <N n={7} /><Btn icon>⚙</Btn>
                <N n={8} /><Btn icon>ⓘ</Btn>
              </>} />
          </Fig>
        ),
        body: (
          <>
            <Callouts items={[
              { n: 1, text: <><b>Module switcher.</b> Click the title to open the menu: Trade, Skill &amp; Fit, Battle, Theft, Planetary Industry, Aperture. Background collectors (market radar, trends, wallet, net-worth, planet and raid watchers) keep running whichever module is open — even minimized to the tray.</> },
              { n: 2, text: <><b>Tab strip.</b> The module's tabs. The ⓘ guide opens on whichever tab you are looking at.</> },
              { n: 3, text: <><b>Active character bubble.</b> Shows who is <i>active</i> — the character whose wallet share, 📍 location and 🚢 ship the app uses, and whose client receives in-game actions (market windows, waypoints). Click it to pick another. It never changes whose <i>numbers</i> a module uses; those follow duties and per-tab pickers.</> },
              { n: 4, text: <><b>⟳ Refresh</b> forces a price refresh right now instead of waiting for the next cycle.</> },
              { n: 5, text: <><b>Tools ▾</b> opens the overlay tools: <i>Multibox overlay settings…</i> (the setup window — see the Multibox overlay pages). <Keys keys={['Alt', '\\']} /> in game does the same.</> },
              { n: 6, text: <><b>⧉ Open in a new window.</b> A second window with this module — put it on another monitor. Collectors keep running in the main window only.</> },
              { n: 7, text: <><b>⚙ Settings</b> — characters, duties, your EVE application, alerts, backup (next pages).</> },
              { n: 8, text: <><b>ⓘ</b> — this guide. Beside it: <b>📋 Release notes</b> (every version since the beta, what changed and why) and <b>⚖ Policy</b> (CCP's rules that apply to a tool like this, paraphrased with links, beside how the app keeps to each one).</> },
            ]} />
            <Try>Open the module menu now and switch to <b>EVE Planetary Industry</b>, then come back. Nothing stops in the background while you look around.</Try>
          </>
        ),
      },
      {
        id: 'settings-chars', title: 'Settings — characters & duties',
        figure: (
          <Fig caption="A team row in ⚙ Settings. Every switch is reversible.">
            <Table head={['Character', 'duty…', 'PI', 'notes', '']}
              rows={[
                ['Alice', <Btn mini>hub trader: Jita</Btn>, '☑', 'main trader', <><Btn mini>Set active</Btn> <Btn mini>Sync</Btn> <Btn mini>Log out</Btn></>],
                ['Bob', <Btn mini>hauler</Btn>, '☐', 'flies the DST', <><Btn mini>Set active</Btn> <Btn mini>Sync</Btn> <Btn mini>Log out</Btn></>],
                ['Cid', <Btn mini>—</Btn>, '☑', 'PI alt', <><Btn mini>Set active</Btn> <Btn mini>Sync</Btn> <Btn mini>Log out</Btn></>],
              ]} />
          </Fig>
        ),
        body: (
          <>
            <Steps items={[
              <>Press <b>Log in with EVE Online</b>. Your browser opens EVE's own login page (the app never sees your password); approve, and the character appears in the team list. Repeat <b>+ Add another character</b> for every alt.</>,
              <>Give each character a <b>duty</b>: <i>hub trader: &lt;hub&gt;</i> means their skills and standings set that hub's fees and their hangar counts as business stock; <i>hauler</i> means their cargo counts as in transit, not idle stock. Leave it blank for characters that do not trade.</>,
              <>Tick <b>PI</b> for every character whose planets you want watched — unticked characters are invisible to the PI module on purpose.</>,
              <>Use <b>Set active</b> only to steer in-game actions; <b>Sync</b> to re-pull skills, implants and assets now; <b>Log out</b> to remove a character.</>,
            ]} />
            <p>
              A character logged in long ago may need a <b>re-login</b> when a feature needs a permission it did not have at login (saving fits in game, reading planets, clone names). The app says so where it matters — a banner or a 🔑 button — and the re-login is one click.
            </p>
          </>
        ),
      },
      {
        id: 'settings-app', title: 'Settings — your EVE application',
        figure: (
          <Fig caption="The setup section has copy buttons for the two values the portal must receive exactly.">
            <Flow steps={['developers.eveonline.com', 'Create New Application', 'Authentication & API Access', 'paste callback URL', 'paste scopes', 'copy Client ID → Settings']} />
          </Fig>
        ),
        body: (
          <>
            <p>
              Conductor talks to EVE through an application <b>you</b> register — free, no secrets, your logins go through your own registration. Until it is done, a yellow banner stays up and logins are refused.
            </p>
            <Steps items={[
              <>Open <b>⚙ Settings → Set up your EVE application</b>.</>,
              <>On <b>developers.eveonline.com</b> → Manage Applications → <b>Create New Application</b>. Name it anything.</>,
              <>Connection type: <b>Authentication &amp; API Access</b>.</>,
              <>Press <b>copy</b> next to the <b>Callback URL</b> in Settings and paste it into the portal — it must match character for character.</>,
              <>Press <b>copy</b> next to <b>Scopes</b> and paste the whole list — a missing scope leaves that feature dark.</>,
              <>Create it, copy the <b>Client ID</b> from the portal, paste it into the Client ID box in Settings.</>,
            ]} />
            <Limit>The Client ID is not a secret — it identifies the application, not you. The app never asks for the Secret Key: it uses PKCE and does not need one. If a site or person asks you for a Secret Key "for Conductor", that is not us.</Limit>
          </>
        ),
      },
      {
        id: 'settings-more', title: 'Settings — your setup, window, alerts',
        body: (
          <>
            <p><b>Your setup</b></p>
            <ul>
              <li><b>Transit ship name</b> — the hauler's ship. Cargo inside it counts as in transit in My Orders and the Dashboard, not as idle stock. Leave empty if you do not haul.</li>
              <li><b>Aperture URL</b> — your corp map's address, for the Aperture module and the Theft module's map import.</li>
            </ul>
            <p><b>AI fight summaries</b> — paste an Anthropic key to enable the write-up button in Battle Reports. Stored locally only, never in backups. <b>remove key</b> deletes it.</p>
            <p><b>App window</b></p>
            <ul>
              <li><b>Always on top</b> — keep the window above the game.</li>
              <li><b>Close to tray</b> — the ✕ hides to the tray so collectors keep running; quit from the tray icon.</li>
              <li><b>Start the overlay with the app</b> — the multibox overlay comes up on launch.</li>
            </ul>
            <p><b>Alerts</b></p>
            <ul>
              <li><b>Outbid</b> / <b>Sale</b> — desktop notifications when the order watcher sees one.</li>
              <li><b>ntfy URL</b> — paste a private <i>ntfy.sh</i> topic and the same alerts (plus planet warnings) reach your phone. <b>Send test alert</b> proves the wiring.</li>
            </ul>
            <Try>Install the ntfy app on your phone, subscribe to a topic name nobody would guess, paste <code>https://ntfy.sh/that-topic</code> here, press <b>Send test alert</b>.</Try>
          </>
        ),
      },
      {
        id: 'settings-lists', title: 'Settings — lists, backup, diagnostics',
        body: (
          <>
            <p>Three lists collect the per-item decisions you make elsewhere — each entry has a ✕ to undo it:</p>
            <ul>
              <li><b>Ignored items</b> — hidden from Trade Finder and Auto Haul (the 🚫 button on a row).</li>
              <li><b>Station-trade items</b> — flipped where they sit, never suggested for hauling (the ⚑ button on a row).</li>
              <li><b>Excluded from books</b> — kept out of the Dashboard's ledger (PLEX-for-ISK, a ship you fly…).</li>
            </ul>
            <p><b>Backup &amp; transfer</b></p>
            <ul>
              <li><b>Export</b> writes one JSON file with everything the app saves locally — settings, hubs, alerts, the lists above, the forever-ledger, trend history, your fits and pods. <b>EVE logins are never in it</b> (EVE rotates them; a copied one would revoke your session).</li>
              <li><b>Import</b> restores settings and <i>merges</i> ledger and trend history with what is already here, so importing twice cannot double-count.</li>
            </ul>
            <p><b>Diagnostics</b> — a plain record of which collectors ran and any errors, written continuously. <b>Refresh</b> re-reads it, <b>Copy all</b> copies the tail, and <b>🐛 Copy bug report</b> copies version, platform, module, team <i>shape</i> (counts only — no names) and the last 200 lines, ready to paste. No EVE tokens are ever written to it; it is safe to delete.</p>
            <p><b>Reset defaults</b> puts the trading settings back; characters and the ledger stay.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'overlay', title: 'Multibox overlay',
    pages: [
      {
        id: 'overlay-what', title: 'What the overlay shows',
        figure: (
          <Fig caption="One click-through box per logged-in character over the game clients, plus up to three notice boxes.">
            <OverlayMock />
          </Fig>
        ),
        body: (
          <>
            <p>The overlay floats over the EVE clients and never takes focus. Each character box carries three lines at one size:</p>
            <ul>
              <li><b>Pod / clone</b> — the name you gave this clone in the setup window, or the jump-clone name recovered from the implants being worn. A clone flagged as an <b>alert</b> colours the box (and can blink) so the learning pod never undocks into a fight by accident.</li>
              <li><b>System</b> — coloured by security: white high, orange low, red null, plum J-space.</li>
              <li><b>Ship</b> — the name the pilot gave it (not the hull; the icon already says that).</li>
            </ul>
            <p>A box goes dim with <i>⚠ no update for Xm</i> when the feed stops — it says so rather than showing old data as if it were live.</p>
            <p>Three notice boxes appear only when they have something to say: <b>⚠ notice</b> (EVE API down, login trouble, rate limiting — in plain language), <b>🪐 planets need you</b> (storage full / producing nothing / fills within hours), <b>🎯 raidable skyhooks near you</b>.</p>
            <Limit>Live shield / armor / hull bars are not possible. EVE publishes no health route of any kind, and the only other ways (reading the client's memory, scraping pixels) are against CCP's third-party policy. Everything shown comes from sanctioned endpoints.</Limit>
          </>
        ),
      },
      {
        id: 'overlay-setup', title: 'Setup mode — moving and resizing',
        body: (
          <>
            <Steps items={[
              <>Press <Keys keys={['Alt', '\\']} /> in game (or open Tools ▾ → Multibox overlay settings…). A banner says <b>SETUP MODE</b> and blue corner squares appear on every box.</>,
              <>Drag a box to move it. Positions are remembered per character.</>,
              <>Drag a blue corner to resize. <b>Pod boxes share one size</b> — resize any one and they all follow (icon and text scale with the height). <b>Each notice-type box has its own width</b> (⚠ notice, 🪐 planets, 🎯 raids are independent of the pods and of each other); their height follows the text.</>,
              <>Boxes with nothing to show right now appear as dimmed <b>templates</b> in setup mode, so you can place them before they are ever needed.</>,
              <>Press <Keys keys={['Alt', '\\']} /> again, or <b>done</b> in the banner, to lock.</>,
            ]} />
          </>
        ),
      },
      {
        id: 'overlay-window', title: 'The overlay settings window',
        body: (
          <>
            <p>Tools ▾ → <b>⚑ Multibox overlay settings…</b> opens a separate window (the overlay itself cannot accept typing). Three tabs:</p>
            <ul>
              <li><b>🧍 Pod Overlay</b> — the overlay <b>on/off</b> switch; every clone the app has seen, per character (expand a character to see them). Type a <b>name</b> for a clone, set an <b>alert</b> with a colour and optional blink, or forget a clone (it returns if seen again). A "wearing now" badge marks the current clone.</li>
              <li><b>⚠ Notification Box</b> — the tick that lets urgent <b>planet</b> warnings use their own 🪐 box on the overlay.</li>
              <li><b>🎯 Raid Alert</b> — show raidable skyhooks near your imported Theft map as an amber box, and how many jumps still count as near.</li>
            </ul>
            <p>Changes apply within one poll (a few seconds) — no restart.</p>
          </>
        ),
      },
    ],
  },
  {
    id: 'meta', title: 'Updates & help',
    pages: [
      {
        id: 'updates', title: 'Updates',
        body: (
          <>
            <p>The app checks for a new version shortly after it starts and every few hours, downloads it in the background, and shows a banner with <b>Restart now</b> when it is ready. Ignore the banner and the update installs on the next quit instead. Nothing you saved is touched by an update.</p>
          </>
        ),
      },
      {
        id: 'bugs', title: 'Reporting a problem',
        body: (
          <>
            <Steps items={[
              <>⚙ Settings → <b>Diagnostics</b> → <b>🐛 Copy bug report</b>.</>,
              <>Paste it where you got the app (the corp channel, or an issue on the release page) with one line on what you expected and what you saw.</>,
            ]} />
            <p>The report carries the version, platform, module, team shape (counts only — no names) and the last 200 log lines. No character names, no EVE tokens.</p>
          </>
        ),
      },
      {
        id: 'about', title: 'About, sources & the CCP notice',
        body: (
          <>
            <p>EVE Conductor is free, open-source and unaffiliated with CCP. Everything it knows about EVE comes from three places: CCP's official API through the EVE application you registered, the log files EVE itself writes for you, and public data (CCP's Static Data Export, image service and public feeds; zKillboard's public API; Fuzzwork's market aggregates; the EvE-Scout storm tracker). It never reads the game client, never sends it input, and identifies itself on every request with its name, version and the public source repository as contact.</p>
            <p className="hint">
              EVE Online and the EVE logo are the registered trademarks of CCP hf. All rights are reserved worldwide. All other trademarks are the property of their respective owners. EVE Online, the EVE logo, EVE and all associated logos and designs are the intellectual property of CCP hf. All artwork, screenshots, characters, vehicles, storylines, world facts or other recognizable features of the intellectual property relating to these trademarks are likewise the intellectual property of CCP hf. CCP hf. has granted permission to EVE Conductor to use EVE Online and all associated logos and designs for promotional and information purposes but does not endorse, and is not in any way affiliated with, EVE Conductor. CCP is in no way responsible for the content on or functioning of this application, nor can it be liable for any damage arising from its use.
            </p>
          </>
        ),
      },
      {
        id: 'numbers', title: 'How to read the numbers',
        body: (
          <>
            <ul>
              <li><b>Measured, never guessed.</b> Prices come from live order books, fills from executed trades, results from your wallet ledger, ship stats from the same dogma engine the game runs. A listing is not a price.</li>
              <li><b>Hover anything.</b> Most numbers and column headers carry a tooltip that says exactly how they were measured.</li>
              <li><b>Gaps are honest.</b> When part of a measurement failed, the app records nothing rather than a misleading value — a "—" beats a wrong number.</li>
              <li><b>Ceilings vs facts.</b> Where the source can only bound a value (a skyhook's banked amount), the column says so.</li>
              <li><b>EVE time</b> (UTC) everywhere times are shown, the same on every screen wherever you are.</li>
            </ul>
          </>
        ),
      },
    ],
  },
];
