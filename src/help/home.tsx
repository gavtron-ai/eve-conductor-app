// HOME — your own dashboards. The book.
import type { ModuleHelp } from './types';
import { Bar, Btn, Fig, Limit, Steps, Table, Tiles } from './figures';

export const HOME_HELP: ModuleHelp = {
  title: 'Home',
  blurb: 'your own dashboards',
  intro: [
    {
      id: 'what', title: 'What Home is',
      figure: (
        <Fig caption="A board is a grid of square cells, eight across. Dashlets snap to it in a few fixed sizes.">
          <Bar brand="Home" tabs={['Dashboard']} active="Dashboard" right={<><Btn mini>✎ arrange</Btn><Btn mini primary>＋ add dashlets</Btn></>} />
          <Tiles tiles={[{ big: '1.84b', sub: 'ISK on field · 23 sites' }, { big: '3 sites', sub: 'Gneiss · nearest 2j', tone: 'good' }, { big: '2 open', sub: 'raid windows', tone: 'good' }, { big: '1 need you', sub: 'planets', tone: 'warn' }]} />
        </Fig>
      ),
      body: (
        <>
          <p>
            A front page you build yourself out of <b>dashlets</b> — small live panels that each answer one question at a glance: how much is in the chain, where the gneiss is today, which skyhooks can be robbed now, which planet needs you, what your trading is worth, how the corp&apos;s last fight went. They work like the widgets on a phone: a few fixed sizes, a grid they snap to, and a store to pick them from.
          </p>
          <p>
            A dashlet is never a tab squeezed into a box. It shows the headline, and its <b>title bar opens the tab</b> with the full story — often already filtered: click <i>Gneiss finder</i> and the Σ Summary opens on gneiss; click a way out of home and it opens down that part of the chain.
          </p>
          <Steps items={[
            <>Open <b>Home</b> from the module menu (top left). On an empty board, <b>✨ start me off</b> lays down a bit of everything, or open the <b>dashlet store</b> and choose.</>,
            <>Pin it: the <b>☆</b> after the tab name puts Home on your favorites strip; in the strip&apos;s <b>⋯</b> you can have the app open your first favorite at launch.</>,
          ]} />
        </>
      ),
    },
  ],
  groups: [
    {
      id: 'dashboard', title: 'Dashboard',
      pages: [
        {
          id: 'arrange', title: '✎ Arrange — the placement tool',
          figure: (
            <Fig caption="In arrange mode every dashlet shows its versions, its options and a remove button.">
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 11.5 }}>
                <Btn mini on>S</Btn><Btn mini>M</Btn><Btn mini>L</Btn> <Btn mini>⚙</Btn> <Btn mini danger>✕</Btn>
              </div>
            </Fig>
          ),
          body: (
            <>
              <Steps items={[
                <>Press <b>✎ arrange</b>. The grid shows its cells and every dashlet grows a small toolbar.</>,
                <><b>Drag</b> a dashlet anywhere. It takes the cell you drop it on; whatever was there <b>moves down to make room</b>, live, as you drag — and everything floats up to close gaps, so a board never has orphan holes. Drop on the top edge of a dashlet to take its place.</>,
                <><b>S · M · L · XL</b> switch between the versions that dashlet comes in — small (1 × 1 cell), medium (2 × 1), large (2 × 2), wide (4 × 2). A bigger version shows more of the same answer (a list, a chart), never different numbers.</>,
                <><b>⚙</b> is the dashlet&apos;s own option where it has one — which ore or gas the finder looks for, which range a chart covers, which leaderboard board to show, or the text of a Note. The same dashlet can sit on a board twice with different options: a Gneiss finder next to a Kernite finder.</>,
                <><b>✕</b> takes it off the board. <b>✓ done</b> or <b>Esc</b> leaves arrange mode.</>,
              ]} />
              <Steps items={[
                <><b>grid: 6 / 8 / 10 / 12 across</b> (arrange mode) is the board&apos;s <b>density</b>. The grid always fills the window&apos;s width to the pixel, so fewer across means bigger dashlets and more across means more of them side by side — 10 or 12 suit a wide monitor. Dashlets keep their places where the new width allows; <b>⇆ re-pack</b> lays them all out again, in the order they read now, to use it.</>,
              ]} />
              <Limit>Past a point bigger cells show <b>more rows, not bigger letters</b>. A board holds up to <b>60 dashlets</b> and there can be eight boards. The limit is not about speed — measured, 96 dashlets mount in about 150 ms and cost under 1 % of the processor, because every dashlet reads data the app already holds and a hidden board is not running at all. It is there because a board is a <i>glance</i>: past a few screens of scrolling it has become a report, and a second board serves better.</Limit>
            </>
          ),
        },
        {
          id: 'boards', title: 'Boards',
          body: (
            <>
              <p>Boards are pages, like a phone&apos;s home screens — a “Mining day” board, a “PvP” board, a “Trading” board. The tabs at the top left of Home switch between them; the number on each is how many dashlets it holds.</p>
              <ul>
                <li><b>＋ board</b> adds one (up to eight) and asks for its name.</li>
                <li><b>Double-click</b> the active board&apos;s tab to rename it.</li>
                <li>In arrange mode, <b>🗑 remove board</b> deletes the board in front of you; the last board is emptied rather than removed.</li>
              </ul>
              <p>Boards are stored with your other settings on your machine, and travel in a settings backup.</p>
            </>
          ),
        },
        {
          id: 'store', title: 'The dashlet store',
          figure: (
            <Fig caption="Shelves on the left; each card previews the dashlet live, with your own data.">
              <Table head={['Shelf', 'Dashlets']} rows={[
                ['🕸 Chain', 'ISK on field · Ways out of home · Close to home · Site finder · Ways to known space · System effects · Map freshness · Chain shape'],
                ['⛏ Harvest', 'Ore finder · Gas finder · My hauls · Mining fleet'],
                ['🪝 Theft', 'Raid windows · Robberies seen · Most robbed · When thieves strike · Robbed or left alone'],
                ['🪐 Planets', 'Planets · Extractor resets · Fullest planets · On the ground · Planets by pilot'],
                ['💰 Wealth', 'Trading value · Where the ISK sits · Wallets · Sales · Profit by day · Unsold stock'],
                ['📈 Market', 'My orders · Market events · Best sellers · Watchlist'],
                ['⚔ Battle', 'Latest fights · Kill feed · My pilots’ record · When we fight'],
                ['🏆 Corp', 'Leaderboard · Board leader · Movers · Hall of fame · The corp’s week · The corp’s days · What the corp flies · Who we meet'],
                ['🧑‍🚀 Pilots', 'Where everyone is · Logins'],
                ['🧰 Utility', 'EVE time · Collectors · ESI budget · Note · Shortcuts · What’s new'],
              ]} />
            </Fig>
          ),
          body: (
            <>
              <Steps items={[
                <><b>＋ add dashlets</b> opens the store. Pick a shelf on the left.</>,
                <>Each card shows the dashlet <b>live</b> — the preview is the real thing with your data, so you see exactly what you are adding. Click <b>S / M / L / XL</b> on the card to preview each version, and set its option (the ore, the range) before adding.</>,
                <><b>＋ add</b> puts that version in the first free spot on the board in front of you. The store stays open so you can add several; arrange them afterwards.</>,
                <>A card says what the dashlet <b>needs</b> — a logged-in trading character, your corp map set up in Aperture — so an empty preview explains itself.</>,
              ]} />
            </>
          ),
        },
        {
          id: 'truth', title: 'Where the numbers come from',
          body: (
            <>
              <p>
                <b>No dashlet asks EVE for anything.</b> Each reads what the app already holds: the background collectors (raid watcher, planets, trading value, wallet, ship watcher), the app-wide order refresh, the last reading of your corp map, the last battle history built. So a board of twenty dashlets costs nothing extra against ESI — and every dashlet carries a footer saying <b>how old</b> what it shows is. A footer turns amber when that is older than it should be.
              </p>
              <ul>
                <li><b>Chain dashlets</b> use the same parser and the same valuation as the Σ Summary with no filter on, so “ISK on field” here <i>is</i> the tab&apos;s total. Opening Home with a chain dashlet on a board loads Aperture underneath (hidden), reads the map, and re-reads every five minutes. On a cold start the <b>last known</b> chain is shown with its age until the first reading arrives. Every figure is <i>if untouched</i>, as in the tab.</li>
                <li><b>Ore finder</b> values a site <b>on that ore alone</b> (any grade), exactly like picking the ore chip in the Σ Summary.</li>
                <li><b>Raid windows</b> reads the raid watcher&apos;s own last look at CCP&apos;s public list (every 2½ minutes). Distances are gate jumps from the map you imported in Theft → Skyhooks, within 15; with no map imported it counts all of New Eden and says so.</li>
                <li><b>Robberies seen</b> counts only the watcher&apos;s definitive verdicts — a skyhook that vanished from the list mid-window — and only what happened while the app was running.</li>
                <li><b>Trading value</b> measures change from the last snapshot <i>at or before</i> the start of the range; when your history is shorter than the range it says “since &lt;date&gt;” instead of pretending. It splits the change into <b>wallets</b> and <b>goods</b>: a transfer, a PLEX sale or a ship bought moves the wallets and is not trading.</li>
                <li><b>Sales</b> is realized profit from your own wallet, first-in-first-out, after fees and tax — the Dashboard&apos;s own calculation.</li>
                <li><b>My orders</b> calls a sell “undercut” only when a rival <i>at the same station</i> lists below it.</li>
                <li><b>Where everyone is</b> is <i>last seen</i>, not live: the ship watcher notes a pilot when their hull or system changes.</li>
                <li><b>How a dashlet is laid out</b>: a headline (never clipped — it shrinks its type to fit), detail that shows <i>only whole rows</i> — as many as the box holds at your window size and zoom, so a bigger version simply lists further — and a one-line footer with the age or the source. Small shows the headline alone; medium puts the detail beside it; large and wide stack them.</li>
                <li><b>Planets</b> uses the PI tab&apos;s own bands: <i>need you NOW</i> = storage full or filling, or every extractor dead; <i>worth a trip soon</i> = some heads dead, a program ending, idle factories; the rest is tuning.</li>
                <li><b>Ways to known space</b> adds the jumps through the chain to the shortest <i>gate</i> route from the exit to Jita, any security — check the route before you haul. <b>Gas finder</b> values a site on that one gas alone, like the Ore finder.</li>
                <li><b>Theft</b> dashlets other than Raid windows cover <b>all of New Eden</b> and only what the raid watcher saw while the app was running; “Robbed or left alone” leaves out the closes it could not call either way, and a “survived” window may still hide a late raid.</li>
                <li><b>Best sellers</b>, <b>Profit by day</b> and <b>Unsold stock</b> are the wallet ledger&apos;s first-in-first-out figures; a sale with no recorded purchase adds revenue and <i>no</i> profit. Unsold stock is at what you paid, not what it would fetch.</li>
                <li><b>Watchlist</b> shows Jita&apos;s lowest ask and highest bid — listings, not executed prices — and deliberately draws no spread or “opportunity” from them.</li>
                <li><b>Corp</b> and <b>Battle</b> dashlets (all but Latest fights) read the corp&apos;s public killmails the app keeps — the Leaderboard&apos;s archive, which a corp dashlet keeps current by itself (two zKillboard requests at most every half hour, no ESI; the two-year history fills in the same way) — with its definitions and its honest reach: a window the held killmails do not fully cover is shortened, and the footer says from when.</li>
                <li><b>Mining fleet</b> shows the overlay&apos;s mining alert as it stands — it only has something to say while the multibox overlay and its ⛏ alert are on. <b>Logins</b> flags a character whose EVE session has ended: until you log it in again its orders, wallet and planets silently drop out of everything.</li>
                <li><b>Leaderboard</b> draws the corp&apos;s medals table from the corp&apos;s public killmails the app keeps (names included), so it shows at once after a restart and then brings itself up to date — the Leaderboard tab does not have to be opened first.</li>
                <li><b>Latest fights</b> shows the history Battle Reports last built this session; a dashlet never starts a zKillboard read of its own, so open Battle Reports once.</li>
              </ul>
              <Limit>A figure the app cannot stand behind reads <b>—</b> with the reason in the footer or the tooltip. It is never filled in with a guess.</Limit>
            </>
          ),
        },
      ],
    },
  ],
};
