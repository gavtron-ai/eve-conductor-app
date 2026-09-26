// TRADE — the book. One group per tab, every control named as it appears.
import type { ModuleHelp, PanelHelp } from './types';
import { Bar, Btn, Chips, Fig, Flow, Limit, Steps, Table, Tiles, Try } from './figures';

/** a row of labelled controls, the way a tab's setup strip looks */
function Controls({ items }: { items: { label: string; value: string }[] }) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', fontSize: 11.5 }}>
      {items.map((it) => (
        <span key={it.label} style={{ display: 'inline-flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ color: 'var(--ink-2)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{it.label}</span>
          <span style={{ padding: '3px 8px', border: '1px solid var(--border)', borderRadius: 4, background: 'var(--surface)' }}>{it.value} ▾</span>
        </span>
      ))}
    </div>
  );
}

export const TRADE_HELP: ModuleHelp = {
  title: 'EVE Trade Conductor',
  blurb: 'market radar · orders · hauling',
  intro: [
    {
      id: 'what', title: 'What this module is for',
      figure: (
        <Fig caption="Eight tabs, one cockpit. Left to right: find → buy → babysit → learn → measure → account → inspect → compare.">
          <Bar brand="EVE Trade Conductor" tabs={['Trade Finder', 'Auto Haul', 'My Orders', 'Trends', 'Radar', 'Dashboard', 'Item Explorer', 'Groups']} active="Trade Finder" />
        </Fig>
      ),
      body: (
        <>
          <p>
            One trading cockpit for the whole team. Every number is <b>measured, never guessed</b>: prices from live order books, fills from executed trades, results from your own wallet ledger. Log characters in, give each a duty in ⚙ Settings, and every fee, stock count and in-game button uses the right character automatically.
          </p>
          <Steps items={[
            <><b>Trade Finder</b> when you have cargo space and want to know what is worth moving today.</>,
            <><b>Auto Haul</b> when you want the whole shopping list for one station run, sized and copyable.</>,
            <><b>My Orders</b> while station-trading — who is beating you, and what to relist at.</>,
            <><b>Dashboard</b> at the end of the week — what actually happened, from the ledger.</>,
          ]} />
          <p>The other tabs feed those four: <b>Radar</b> measures the whole market, <b>Trends</b> learns your own order history, <b>Item Explorer</b> looks one item in the eye, <b>Groups</b> compares families across two hubs.</p>
        </>
      ),
    },
    {
      id: 'basis', title: 'Where every number comes from',
          figure: (
            <Fig caption="Rule 1 of this app: a listing is not a price. Every ISK figure traces to one of four kinds of evidence, and the screen says which.">
              <Table head={['Kind', 'What it is', 'Trusted for']}
                rows={[
                  ['executed trades', 'what actually changed hands — ESI market history (yesterday and back), your own wallet transactions and journal, the radar\'s measured fills', 'prices, volumes, profit'],
                  ['your own fees & pace', 'broker fee and sales tax from YOUR skills and standings; how fast YOUR orders filled or were repriced', 'margins, defense cost, sell time'],
                  ['a live book with its timestamps', 'the current order book read from ESI, each order with the time it was placed or last changed', 'heat, tempo, transitions between two reads'],
                  ['a listing', 'one number somebody typed into an order — what they hope for', 'only ever named as such: an ask, a bid, a spread'],
                ]} />
            </Fig>
          ),
          body: (
            <>
              <p>The table below walks every money number in this module (audit item F9, v0.231.0). Hover any header in the app for the same statement in place.</p>
              <Table head={['Number', 'Screen', 'Basis', 'Source']}
                rows={[
                  ['Buy @ / Bid cost @', 'Trade Finder', 'listing — the cheapest 5% of sell listings at the source (a lone bait order cannot set it); in bid mode the top bid plus your broker fee', 'Fuzzwork aggregates of the live book, 10–30 min old'],
                  ['Sell @ (order), Quick margin', 'Trade Finder', 'listing — the destination\'s lowest sell listing you would match; the top 5% of bids you would dump into', 'Fuzzwork aggregates'],
                  ['Margin, Profit/trip, Profit/day, Order cost', 'Trade Finder', 'arithmetic on the two listings above minus YOUR broker fee and sales tax', 'your skills and standings (Settings)'],
                  ['Sell time, Day vol, Qty', 'Trade Finder', 'executed trades — units traded per calendar day in the destination region, the lower of the 30- and 90-day figures; quiet days count as zero', 'ESI market history'],
                  ['Real high (7d), 2w history, Trend, ⚠ price high / dump?', 'Trade Finder', 'executed trades — daily min / average / max actually paid', 'ESI market history'],
                  ['Heat, Defense/day, Adj profit/day', 'Trade Finder', 'a live book with its timestamps — each order\'s issued time gives the reprice tempo; capped at YOUR own historical reprice pace', 'ESI live orders; your wallet journal'],
                  ['Bid fill/day', 'Trade Finder (bid mode)', 'executed trades — the share of daily volume that printed at the day\'s low (sells into bids)', 'ESI market history'],
                  ['Buy @, Sell @, Profit, Order cost', 'Auto Haul', 'listings at the source and the destination (order mode: the lowest sell listing; instant: standing buys), minus YOUR fees; Qty capped by executed daily volume', 'Fuzzwork aggregates; ESI history'],
                  ['Realized profit, ROI, revenue without cost, fees, inventory at cost', 'Dashboard', 'executed trades — YOUR wallet transactions and journal, matched FIFO', 'ESI wallet (the ledger file)'],
                  ['Trading value: stock, transit, listed', 'Dashboard, Home', 'measured Jita sales over 7 days (the radar\'s fills) → your own cost → the Jita ask, named as a listing and counted in the log', 'radar summary; ledger; Fuzzwork'],
                  ['Escrow, wallets', 'Dashboard, Home', 'your own orders\' escrow and wallet balances', 'ESI, your characters'],
                  ['Price, value, days left, pace', 'My Orders, the order popup', 'your own orders (price × remaining); pace from YOUR fills and the order\'s history', 'ESI own orders; the ledger'],
                  ['Undercuts, rival tempo, fill clocks', 'Trends', 'transitions between consecutive reads of the live book, and your own orders\' events', 'ESI live orders; the radar'],
                  ['Flow, fills, reprices, competitors', 'Radar', 'executed trades and transitions — full-book diffs every 30 min: a fill is a volume drop on the same order id', 'ESI regional order books'],
                  ['Best price (Radar)', 'Radar', 'listing — the best price on the book at the read, named so', 'ESI regional order books'],
                  ['Sell, Buy, Spread, vs Jita, Buy vol, Orders', 'Item Explorer (hub table)', 'listings on the books, named so in every header', 'Fuzzwork aggregates'],
                  ['Bought/day, Sold/day', 'Item Explorer (hub table), item groups', 'executed trades — the radar\'s fills per day, normalised to the hours it was watching', 'radar summary'],
                  ['Hauls', 'Home', 'your own haul log — what you recorded', 'the app\'s haul log'],
                  ['Planets value', 'Home, PI', 'stored quantities at Jita listings — the tile says so', 'ESI planets; Fuzzwork'],
                  ['ISK destroyed / lost', 'Home, Battle', 'zKillboard\'s valuation of public killmails', 'zKillboard'],
                ]} />
              <Limit>What no screen claims: a spread between two listings is never an opportunity on its own — every finder row must also show trades (Day vol, Real high) before it is ranked, and the Explorer\'s Bought/Sold columns are the trades beside its listings.</Limit>
            </>
          ),
    },
    {
      id: 'search', title: 'The search bar & the watchlist',
      body: (
        <>
          <p>Type any market item into the search bar under the header (<i>PLEX, Tritanium, Hulk…</i>) and pick it from the list: the Item Explorer opens on it. The ★ on any row adds an item to the <b>watchlist</b> in the left sidebar; ✕ there removes it. Watchlisted items are one click away from every tab.</p>
        </>
      ),
    },
  ],
  groups: [
    // ----------------------------------------------------------------- finder
    {
      id: 'finder', title: 'Trade Finder',
      pages: [
        {
          id: 'finder-setup', title: 'Setting up a scan',
          figure: (
            <Fig caption="The setup strip. Change anything, press Scan.">
              <Controls items={[
                { label: 'Source', value: 'Jita' }, { label: 'Destination', value: 'Amarr' }, { label: 'Universe', value: 'my hubs' },
                { label: 'Ship', value: 'Custom cargo' }, { label: 'Budget ISK', value: 'no limit' }, { label: '% of pool', value: '—' },
                { label: 'Buy', value: 'instant' }, { label: 'Sell', value: 'order' }, { label: 'Depth', value: 'deep' },
              ]} />
              <div style={{ marginTop: 6 }}><Btn primary>Scan</Btn> <span style={{ fontSize: 11.5 }}>☑ hide unsustainable</span></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Source</b> — where you buy. <b>Destination</b> — where you sell; "all" scans every destination in the universe set.</li>
              <li><b>Universe</b> — which hubs count (your hub list from ⚙ Settings, or a region set).</li>
              <li><b>Ship</b> — pick one of your ships to size loads by its <i>effective</i> cargo (skills and fit included), or <i>Custom cargo</i> and type a m³.</li>
              <li><b>Budget ISK</b> — cap the plan; the <b>%</b> box sizes it as a share of the team's wallet pool.</li>
              <li><b>Buy mode</b> — <i>instant</i> (take sell orders now) or <i>order</i> (place a bid and wait; the table then shows bid cost and a measured fill rate).</li>
              <li><b>Sell mode</b> — <i>order</i> (list at the destination), <i>instant</i> (dump into bids), or <i>best</i> of the two per item.</li>
              <li><b>Scan depth</b> — <i>deep</i> reads more of each book; <i>fast</i> is a quick pass.</li>
              <li><b>hide unsustainable</b> — drop items whose destination cannot absorb your load in a reasonable time.</li>
            </ul>
          ),
        },
        {
          id: 'finder-table', title: 'Reading the results',
          figure: (
            <Fig caption="The columns that decide. Hover any header in the app for the exact definition.">
              <Table head={['Item', 'Sell at', 'Buy @', 'Sell @ (order)', 'Heat', 'Adj profit/day', 'Margin', 'Qty', 'Profit/trip', 'Sell time', 'Trend', '⚠']}
                rows={[
                  ['Large Shield Extender II', 'Amarr', '1.02m', '1.31m', '🔥', '38m', '21%', '120', '31m', '0.8d', '→', ''],
                  ['Hobgoblin II', 'Amarr', '410k', '520k', '❄', '12m', '19%', '400', '35m', '2.9d', '↑', 'price high'],
                ]} />
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Buy @</b> — what you pay at the source, from the cheapest 5% of listings (a single bait order cannot fake a low price). In bid mode this becomes <b>Bid cost @</b> (top bid plus broker fee) with a measured <b>Fill/day</b>.</li>
              <li><b>Sell @ (order)</b> — the price you would list at, matching the destination's lowest listing. <b>Margin</b> after broker fee and sales tax; <b>Quick margin</b> if you dump into bids instead.</li>
              <li><b>Heat</b> — read from the live book's own reprice timestamps: 🔥 an active undercut war on the sell front line, ~ occasional, ❄ cooling (rivals leaving). <b>Defense/day</b> is what defending a listing would cost in reprice fees; <b>Adj profit/day</b> subtracts it — the honest number for contested items.</li>
              <li><b>Qty</b> — units per trip, limited by cargo, budget, source supply and what the destination absorbs. <b>Cargo %</b>, <b>m³/unit</b>, <b>Order cost</b> size it.</li>
              <li><b>Profit/trip</b>, <b>Profit/day</b> (trip profit ÷ days to sell, min 1) — the "profitable AND sells fast" number. <b>Sell time</b> from the destination's daily traded volume; <b>Day vol</b> the lower of the 30- and 90-day rates.</li>
              <li><b>Real high (7d)</b> — the highest anything actually sold for; the two-week bars show daily units.</li>
              <li><b>Trend</b> ↑ ↓ → — 7-day average vs 30-day. <b>⚠</b> — <i>price high</i> (destination far above normal, will not hold) or <i>dump?</i> (source far below normal).</li>
            </ul>
          ),
        },
        {
          id: 'finder-actions', title: 'Row buttons',
          figure: (
            <Fig caption="Every row ends with the same five buttons.">
              <div><Btn mini>☆</Btn> <Btn mini>details</Btn> <Btn mini>game</Btn> <Btn mini>⚐</Btn> <Btn mini>🚫</Btn></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>☆ / ★</b> — add to or remove from the watchlist.</li>
              <li><b>details</b> — the item's popup (hub comparison, history) without leaving your scan.</li>
              <li><b>game</b> — open the item's market window in every running EVE client (needs an active character).</li>
              <li><b>⚐ / ⚑</b> — mark as a <i>station-trade</i> item: flipped where it sits, never suggested for hauling. Stays until untoggled (⚙ Settings lists them).</li>
              <li><b>🚫</b> — ignore everywhere: hidden from Trade Finder and Auto Haul until you remove it in ⚙ Settings.</li>
            </ul>
          ),
        },
        {
          id: 'finder-plan', title: 'The buy plan',
          figure: (
            <Fig caption="Below the results: the scan turned into one executable plan.">
              <Table head={['Item', 'Units', 'Cost', 'Share', 'Exp/day', 'List at once']} rows={[
                ['Large Shield Extender II', '120', '122m', '41%', '38m', '60'],
                ['Hobgoblin II', '300', '123m', '41%', '9m', '100'],
              ]} />
              <div style={{ marginTop: 6 }}><Btn>Copy multibuy 1/2</Btn> <Btn>Copy multibuy 2/2</Btn></div>
            </Fig>
          ),
          body: (
            <>
              <p>The allocator spreads your capital across the best defense-adjusted opportunities, greedy by ISK/day earned per ISK invested, and sizes each line down to fit the caps:</p>
              <ul>
                <li><b>Diversification cap</b> — no single item may take more than this share of the budget.</li>
                <li><b>skip heating</b> — leave out items whose crowding is rising (🌡); the war is arriving.</li>
                <li><b>skip owned</b> — leave out items the team already holds.</li>
                <li><b>List at once</b> — how many to list per tranche (≈ one day of absorption); placement fees are proportional to quantity, so tranches cost the same in total.</li>
              </ul>
              <p><b>Copy multibuy</b> hands you paste-ready chunks (EVE's multibuy window accepts 100 lines); the note under the table says <b>where the team's ISK should sit</b> — the source-hub trader holds the purchase capital, each destination trader holds their listing fees.</p>
              <Try>Set a budget of 20% of the pool, tick <b>skip heating</b>, press Scan, copy the multibuy, paste it into Market → Multibuy in game.</Try>
            </>
          ),
        },
      ],
    },
    // --------------------------------------------------------------- autohaul
    {
      id: 'autohaul', title: 'Auto Haul',
      pages: [
        {
          id: 'haul-setup', title: 'Setting up',
          figure: (
            <Fig caption="Tell it where you are and what you fly; it finds the station runs.">
              <Controls items={[{ label: 'From system', value: 'Tama' }, { label: 'Source hub', value: 'Jita' }, { label: 'Cargo m³', value: '12,500' }, { label: 'Budget', value: 'no limit' }, { label: 'Options', value: '8' }]} />
              <div style={{ marginTop: 6 }}><Btn mini>📍 my system</Btn> <Btn mini>🚢 my ship</Btn> <Btn primary>Find hauls</Btn> <span style={{ fontSize: 11.5 }}>☐ include structures</span></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>System</b> — type it (suggestions appear with security), or press <b>📍</b> to use the active character's current system.</li>
              <li><b>Source hub</b> — the station you buy at.</li>
              <li><b>Cargo</b> — type a m³, or press <b>🚢</b> for the active character's current ship with skills and fit applied.</li>
              <li><b>Budget</b> and <b>%</b> — as in Trade Finder.</li>
              <li><b>Options</b> — how many single-station haul options to rank and show.</li>
              <li><b>include structures</b> — let player structures be destinations (their books are only visible with docking access).</li>
              <li><b>Find hauls</b> — needs an exact system name.</li>
            </ul>
          ),
        },
        {
          id: 'haul-options', title: 'Haul options → the load',
          figure: (
            <Fig caption="Pick a destination card; the load for it appears underneath.">
              <Chips chips={[{ label: 'Amarr VIII · 3 jumps · 41m profit', tone: 'on' }, { label: 'Rens VI · 9 jumps · 30m' }, { label: 'Dodixie IX · 12 jumps · 27m' }]} />
              <div style={{ marginTop: 8 }}>
                <Tiles tiles={[{ big: '212m', sub: 'Cost' }, { big: '41m', sub: 'Est. profit', tone: 'good' }, { big: '11,900 / 12,500', sub: 'Cargo' }, { big: 'cargo', sub: 'Limited by' }]} />
              </div>
              <div style={{ marginTop: 6 }}><Btn>▸ set waypoint</Btn> <Btn primary>Copy multibuy 1/1</Btn></div>
            </Fig>
          ),
          body: (
            <>
              <p>Each card is one station run, ranked by profit. Select one and the <b>Load</b> table lists what to buy in priority order, with the four totals: <b>Cost</b>, <b>Est. profit</b> (after taxes and fees), <b>Cargo</b> used, and <b>Limited by</b> — what stopped the load growing: your cargo, your budget, or the station running out of profitable deals.</p>
              <ul>
                <li><b>▸ set waypoint</b> — adds the station to the active character's autopilot.</li>
                <li><b>Copy multibuy</b> — chunks of at most 100 lines (EVE's limit); paste each separately.</li>
              </ul>
              <Try>Press 📍, press 🚢, press Find hauls, pick the top card, copy the multibuy, undock.</Try>
            </>
          ),
        },
        {
          id: 'haul-table', title: 'Load columns & row actions',
          body: (
            <>
              <ul>
                <li><b>#</b> — buy priority. <b>Qty</b> — sized to cargo, budget and what the station absorbs.</li>
                <li><b>Buy @</b> (source, cheapest 5%), <b>Cost</b>, <b>Sell @</b>, <b>Real high</b> (7 days of actual sales), <b>Day vol</b>, two-week bars.</li>
                <li><b>How</b> — <i>instant</i> (standing buy orders pay you on arrival, verified against the live book) or <i>order</i> (list and wait, sized to sell within your sell-days setting).</li>
                <li><b>Heat</b>, <b>Profit</b>, <b>m³</b>.</li>
              </ul>
              <p>Row buttons: <b>details</b>, <b>game</b>, <b>🚫</b> (ignore everywhere), and <b>✕</b> — remove this line from <i>this plan only</i>; it leaves the multibuy export too, and a rescan brings it back.</p>
            </>
          ),
        },
      ],
    },
    // ----------------------------------------------------------------- orders
    {
      id: 'orders', title: 'My Orders',
      pages: [
        {
          id: 'orders-stock', title: 'Held but not on the market',
          figure: (
            <Fig caption="Idle capital: every pile the team holds with no sell order up.">
              <Table head={['Item', 'Held by', 'Where', 'Qty', 'Paid/unit', 'Value', 'Next step']} rows={[
                ['Hobgoblin II', 'Alice', 'Jita hangar', '180', '402k', '72m', <Btn mini>list it</Btn>],
                ['Large Shield Extender II', 'Bob', 'in HAULER-1', '60', '1.01m', '61m', <Btn mini>haul</Btn>],
              ]} />
            </Fig>
          ),
          body: (
            <>
              <p>The stock pipeline, read from hangars (trader duties) and the transit ship (hauler duty, named in ⚙ Settings): what sits where, what it cost (ledger average of the unsold lots — "—" means no purchase on the books: loot or pre-app stock), and the pipeline's <b>next step</b> for where it sits — <i>list it</i> at the selling hub, <i>give to hauler</i> at the source hub, <i>haul</i> when it is loaded.</p>
              <p>Click the <b>next step</b> flag to act: it opens the market window in game on every character online right now and copies the one-tick undercut at the selling hub to the clipboard.</p>
            </>
          ),
        },
        {
          id: 'orders-live', title: 'Live orders',
          figure: (
            <Fig caption="The table you babysit while station-trading.">
              <Table head={['Char', 'Side', 'Item', 'My price', 'Station best', 'Paid', 'Status', 'Heat', 'Progress', 'Expires']} rows={[
                ['Alice', 'sell', 'Hobgoblin II', '520k', '515k', '402k', <span style={{ color: 'var(--bad)' }}>beaten 1.0%</span>, '🔥', '40%', '28d'],
                ['Alice', 'buy', 'Tritanium', '5.10', '5.10', '—', <span style={{ color: 'var(--good)' }}>best here</span>, '~', '85%', '12d'],
              ]} />
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Character filter</b> — one character or the whole team. <b>⟳ Now</b> forces a check (EVE's order data only changes on its own schedule).</li>
              <li><b>Station best</b> — the best competing price at <i>your</i> station, live. <b>Paid</b> — team-wide FIFO cost of the stack you hold.</li>
              <li><b>Status</b> — <i>best here</i> or <i>beaten X%</i>. <b>Click a beaten cell</b>: it copies the one-tick undercut and opens the market window in game — relist in two clicks.</li>
              <li><b>Heat</b> — everyone else's reprice tempo on your side of the book. <b>Progress</b> — filled share, green while winning, red while beaten. <b>Expires</b> — days left.</li>
              <li>Row buttons: <b>breakdown</b> (next page), <b>details</b>, <b>game</b>.</li>
              <li>A ⚠ under an item marks an order <i>underwater</i>: listed below what the stack cost.</li>
            </ul>
          ),
        },
        {
          id: 'orders-detail', title: 'The order breakdown popup',
          body: (
            <p>The <b>breakdown</b> button opens one order in full: the live price ladder at its station (where you sit among the rivals), your fills so far, and the taxes and broker fees the order has cost. <b>game</b> opens the item's market window from there; <b>✕ Close</b> returns to the table.</p>
          ),
        },
        {
          id: 'orders-done', title: 'Sold-out orders',
          body: (
            <p>Orders that filled completely in the last ~90 days (from EVE's order history), kept in their own table so each sorts cleanly: character, price, quantity, total, and age. A 📦 tag marks buy orders. Same <b>details</b> and <b>game</b> buttons.</p>
          ),
        },
      ],
    },
    // ----------------------------------------------------------------- trends
    {
      id: 'trends', title: 'Trends',
      pages: [
        {
          id: 'trends-playbook', title: 'Your daily playbook',
          figure: (
            <Fig caption="Range chips window the history; the clocks show when your things happen, in EVE time.">
              <Chips chips={[{ label: '7d' }, { label: '30d', tone: 'on' }, { label: '90d' }, { label: 'All' }]} />
              <div style={{ marginTop: 8 }}><Flow steps={['your orders watched', 'every outbid + sale stamped', 'hour-of-day clocks', 'weekday heat']} /></div>
            </Fig>
          ),
          body: (
            <>
              <p>The long game, from watching <b>your own orders</b>: every outbid (on sells and on buys) and every sale is recorded with time and system. From that history it builds your playbook: the hours your items actually sell, the hours rivals undercut, and which weekdays they land on (darker = more). All times are EVE time (UTC), the same on every screen.</p>
              <ul>
                <li><b>Character filter</b> — one character or the team.</li>
                <li><b>Range chips</b> — 7d / 30d / 90d / All.</li>
              </ul>
              <Limit>It needs days of your trading to say anything; the longer it watches, the better it gets. An empty clock is a young history, not a quiet market.</Limit>
            </>
          ),
        },
        {
          id: 'trends-items', title: 'Per-item competition',
          figure: (
            <Fig>
              <Table head={['Item', 'Systems', 'Outbid (sell)', 'Outbid (buy)', 'Sales', 'Units', 'ISK sold', 'Rivals', 'Fastest']} rows={[
                ['Hobgoblin II', 'Jita', '14', '2', '9', '1,800', '930m', '6', '⚡ 4m · 2 of 6 under 10m'],
              ]} />
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Outbid (sell) / (buy)</b> — how often a rival beat your order on each side.</li>
              <li><b>Sales / Units / ISK sold</b> — observed fills on your sell orders.</li>
              <li><b>Rivals</b> — distinct competitor orders the watcher logged next to yours.</li>
              <li><b>Fastest</b> — the competitor fingerprint: ⚡ the fastest rival's median counter-reprice time (that is who you are racing) and how many of them reprice within minutes.</li>
              <li><b>details</b> opens the item without leaving the tab. Investigate here; act in My Orders.</li>
            </ul>
          ),
        },
      ],
    },
    // ------------------------------------------------------------------ radar
    {
      id: 'radar', title: 'Radar',
      pages: [
        {
          id: 'radar-how', title: 'How it measures',
          figure: (
            <Fig caption="Transitions, not state dumps: two snapshots, one diff.">
              <Flow steps={['snapshot the ENTIRE order book', '~30 min later, again', 'diff', 'reprices/day = war tempo', 'volume drops = real fills']} />
            </Fig>
          ),
          body: (
            <>
              <p>The whole market, measured directly. Every ~30 minutes the radar snapshots the entire order book of your trading regions and diffs it against the last snapshot. A changed price is a reprice (the undercut war's tempo); a volume drop is a fill (real ISK flow, not listings). It runs in the background whichever module is open.</p>
              <ul>
                <li><b>Region</b> — which watched region to show.</li>
                <li><b>Side</b> — sell, buy, or both.</li>
                <li><b>exact name…</b> — show one item regardless of the filters.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'radar-columns', title: 'The columns',
          figure: (
            <Fig>
              <Table head={['Item', 'Side', 'War/day', 'Heat trend', 'Rivals', 'Flow/day', 'Flow trend', 'Sale hours', 'War hours', 'Days']} rows={[
                ['Large Shield Extender II', 'sell', '38', '🌡 heating', '11', '410m', '↑', '17–21', '18–22', '23'],
                ['Hobgoblin II', 'sell', '6', '❄ cooling', '4', '120m', '→', '19–23', '14–16', '23'],
              ]} />
            </Fig>
          ),
          body: (
            <ul>
              <li><b>War/day</b> — reprices per day, 7-day average (today's live value in the tooltip).</li>
              <li><b>Heat trend</b> — last 7 days vs last 30: 🌡 heating (competitors flowing in), ❄ cooling (leaving). Needs at least 8 days of coverage.</li>
              <li><b>Rivals</b> — distinct competing orders right now, your own excluded.</li>
              <li><b>Flow/day</b> — measured fills, ISK per day. <b>Flow trend</b> — demand direction.</li>
              <li><b>Sale hours / War hours</b> — when fills land and when the reprice war is fought (EVE hours) — the windows worth fighting for.</li>
              <li><b>Days</b> — how much coverage this row has; numbers sharpen daily.</li>
              <li><b>details</b> / <b>game</b> on every row. Use it to find items with real flow and lazy competition, then open the row for the live book.</li>
            </ul>
          ),
        },
      ],
    },
    // -------------------------------------------------------------- dashboard
    {
      id: 'dashboard', title: 'Dashboard',
      pages: [
        {
          id: 'dash-tiles', title: 'Tiles & controls',
          figure: (
            <Fig caption="Your results, from the wallet ledger. The bottom line is the honest one.">
              <Tiles tiles={[
                { big: '1.42b', sub: 'Bought' }, { big: '1.71b', sub: 'Sales revenue' }, { big: '+188m', sub: 'Realized profit', tone: 'good' },
                { big: '61m', sub: 'Fees (broker + tax)' }, { big: '+127m', sub: 'Bottom line', tone: 'good' }, { big: '640m', sub: 'Inventory at cost' },
              ]} />
              <div style={{ marginTop: 6 }}><Btn>Export CSV</Btn> <Btn>⟳ Sync wallet</Btn> <Chips chips={[{ label: '7d' }, { label: '30d', tone: 'on' }, { label: '90d' }, { label: 'All' }]} /></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Bought / Sales revenue</b> — item cost only; fees are their own tile because EVE charges them per order, not per item.</li>
              <li><b>Realized profit</b> — completed round-trips only: each sale matched to the units' actual purchase, oldest first, minus sales tax.</li>
              <li><b>Fees</b> — every broker fee (placing, modifying, relisting — from the wallet journal) plus sales tax.</li>
              <li><b>Bottom line</b> — realized profit minus <i>all</i> broker fees. If it disappoints, it is telling the truth.</li>
              <li><b>Inventory at cost</b> — stock you actually hold (hangars + inside open sell orders), verified against assets. <b>Listed (ask)</b> — your open sell orders at your own prices: an aspiration, not a value.</li>
              <li><b>Unmatched revenue</b> — sales of units the app never saw you buy (loot, missions, pre-app stock), kept separate so they do not inflate results.</li>
              <li><b>Character filter</b> — one character's slice is their <i>activity</i>; profit on goods one bought and another sold belongs to the team view.</li>
              <li><b>Export CSV</b> saves the full ledger; <b>⟳ Sync wallet</b> pulls the journal now.</li>
            </ul>
          ),
        },
        {
          id: 'dash-charts', title: 'The charts',
          body: (
            <ul>
              <li><b>Cumulative profit</b> — running total of realized profit; a healthy line climbs steadily.</li>
              <li><b>Daily buy vs sell</b> — ISK out (blue) and in (teal) per day. Big blue days are stock-up runs; teal should follow.</li>
              <li><b>Profit by category</b> — where your trading actually makes money, by the in-game market tree.</li>
              <li><b>Profit by region</b> — where you <i>sold</i> it, revealing your best markets.</li>
            </ul>
          ),
        },
        {
          id: 'dash-tables', title: 'Items & inventory tables',
          body: (
            <>
              <p><b>Items</b> — every item you completed round-trips on in the range: category, quantity sold, everything ever spent on it (full ledger), revenue, profit (before broker), broker fees matched to its orders, <b>Net</b>, and <b>Return</b> on the ISK invested. Click headers to sort.</p>
              <p><b>Inventory</b> — what the team actually holds now: character, station, status (<i>hangar</i> = unlisted, <i>listed</i> = inside an open sell order), quantity (verified against assets), average cost, ISK tied up, and the age of the oldest unsold lot — big numbers are stock that is not moving.</p>
              <p>Row buttons: <b>details</b>, <b>game</b>, and <b>exclude from books</b> — for PLEX-for-ISK, a ship you fly, a gift. Reversible in ⚙ Settings.</p>
            </>
          ),
        },
      ],
    },
    // --------------------------------------------------------------- explorer
    {
      id: 'explorer', title: 'Item Explorer',
      pages: [
        {
          id: 'explorer-item', title: 'One item, all hubs',
          figure: (
            <Fig caption="The hub comparison. Listings on the left, measured trades on the right.">
              <Table head={['Hub', 'Sell', 'Sell 5%', 'Buy', 'Spread', 'Flip %', 'vs Jita', 'Sell vol', 'Buy vol', 'Bought/day', 'Sold to bids/day', 'Orders']} rows={[
                ['Jita', '1.00m', '1.02m', '0.90m', '10%', '+3.1%', '—', '4,100', '900', '380', '210', '212 / 41'],
                ['Amarr', '1.28m', '1.31m', '1.05m', '18%', '+9.4%', '+28%', '610', '120', '95', '40', '38 / 9'],
              ]} />
            </Fig>
          ),
          body: (
            <>
              <p>Search anything in the bar above (or press <b>details</b> on any row anywhere) and the item is under the microscope: its live books at your hubs side by side, spreads, your stock, and the price history chart.</p>
              <ul>
                <li><b>Sell</b> — cheapest listing; <b>Sell 5%</b> — the cheapest 5% of sell volume, the trustworthy version. <b>Buy</b> — top bid.</li>
                <li><b>Spread</b> and <b>Flip %</b> — station-trading room after your broker fees and tax; positive means flipping pays.</li>
                <li><b>vs Jita</b> — how this hub's cheapest sell compares.</li>
                <li><b>Sell vol / Buy vol</b> — units on the books (supply and demand waiting), not trades.</li>
                <li><b>Bought/day / Sold to bids/day</b> — executed trades, measured by your radar from full-book diffs (7-day average). This pair is the truth about liquidity.</li>
                <li><b>Orders</b> — sell / buy order counts.</li>
              </ul>
              <p><b>★</b> adds it to the watchlist; <b>⚑</b> marks it station-trade.</p>
            </>
          ),
        },
        {
          id: 'explorer-popup', title: 'The item details popup',
          body: (
            <p>Every table in the module has a <b>details</b> button. It opens this same item page in a popup so your scan, plan, orders or radar stay exactly where they were. <b>✕ Close</b> returns.</p>
          ),
        },
      ],
    },
    // ----------------------------------------------------------------- groups
    {
      id: 'groups', title: 'Groups',
      pages: [
        {
          id: 'groups-build', title: 'Search → tick → save',
          figure: (
            <Fig caption="A family of items compared across two hubs at once.">
              <Controls items={[{ label: 'Search', value: 'filament' }, { label: 'Open group', value: 'Abyssal filaments' }, { label: 'Hub 1', value: 'Jita' }, { label: 'Hub 2', value: 'Amarr' }, { label: 'Add to', value: '+ new group…' }]} />
              <div style={{ marginTop: 6 }}><Btn>Add ticked</Btn> <Btn mini>🗑 delete group</Btn> <span style={{ fontSize: 11.5 }}>☑ hide 💤 no-trade items</span></div>
            </Fig>
          ),
          body: (
            <Steps items={[
              <>Type a word (<i>filament, mutaplasmid, officer…</i>). Every matching item appears with two rows, one per hub.</>,
              <>Tick the ones you care about (the header checkbox ticks all).</>,
              <>Choose a target group — <i>+ new group…</i> and a name — and press <b>Add ticked</b>.</>,
              <>Later, pick the group from <b>Open group</b>: its items replace the search results. <b>🗑</b> deletes the group (the items themselves are untouched); <b>✕</b> on a row removes one item.</>,
              <><b>Hub 1 / Hub 2</b> set the pair; <b>hide 💤</b> drops items with no measured trade — two people not talking is not a market.</>,
            ]} />
          ),
        },
        {
          id: 'groups-ways', title: 'Three ways to work an item',
          figure: (
            <Fig>
              <Table head={['Item', 'Hub', 'Sell 5%', 'Buy', 'Flip here', 'Haul instant', 'Haul with bid', 'Bought/day', 'Sold to bids/day']} rows={[
                ['Calm Exotic Filament', 'Jita', '2.1m', '1.8m', '+9% (2d)', '+14% → Amarr', '+22% → Amarr', '140', '60'],
                ['', 'Amarr', '2.6m', '2.0m', '+12% (4d)', '+4% → Jita', '+9% → Jita', '30', '12'],
              ]} />
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Flip here</b> — your own buy order at the top bid, later your own sell order near Sell 5%, both at this hub; the bracket is the return and how long it takes.</li>
              <li><b>Haul, bought instantly</b> — buy from sell orders here (no order fees), haul, list at the other hub.</li>
              <li><b>Haul, bought with a bid</b> — bid here (top bid plus broker fee), wait, haul, list at the other hub. Slower, better.</li>
              <li><b>Bought/day / Sold to bids/day</b> — measured by the radar; "—" means the region is not radar-watched.</li>
              <li><b>details</b>, <b>game</b> (opens on every online character), <b>✕</b> remove from the group.</li>
            </ul>
          ),
        },
      ],
    },
  ],
};

export const TRADE_PANELS: Record<string, PanelHelp> = {};
