// PLANETARY INDUSTRY — the book.
import type { ModuleHelp, PanelHelp } from './types';
import { Btn, Card, Chips, Fig, Limit, Steps, Table, Tiles, Timeline, Try } from './figures';

export const PI_HELP: ModuleHelp = {
  title: 'EVE Planetary Industry',
  blurb: 'planets · deadlines · balance',
  intro: [
    {
      id: 'what', title: 'What this module is for',
      figure: (
        <Fig caption="The question it answers at a glance: do I need to log in, and for whom?">
          <Tiles tiles={[
            { big: '14', sub: 'planets · 3 character(s)' },
            { big: '2', sub: 'need you NOW', tone: 'bad' },
            { big: '5h 20m', sub: 'next deadline · Cid · Tama IV', tone: 'warn' },
            { big: '312m', sub: 'ISK sitting on the ground' },
          ]} />
        </Fig>
      ),
      body: (
        <>
          <p>
            Every watched character's planets in one fleet view, ranked by what they are <b>costing you</b>. EVE gives no warning when storage fills — the extractors keep running and their output is silently discarded — so the module measures each planet's fill and deadlines and puts the worst at the top.
          </p>
          <Steps items={[
            <>Tick <b>PI</b> for a character in ⚙ Settings (or press the one-click <b>watch</b> button that appears here for a logged-in character that is not ticked).</>,
            <>Read the tiles. If <b>need you NOW</b> is not zero, the cards below say which planet and why.</>,
            <>Set the alert thresholds at the bottom once; phone alerts follow if ntfy is set up in Settings.</>,
          ]} />
        </>
      ),
    },
  ],
  groups: [
    {
      id: 'planets', title: 'Planets',
      pages: [
        {
          id: 'tiles', title: 'The top tiles',
          body: (
            <>
              <ul>
                <li><b>planets</b> — how many planets across how many watched characters.</li>
                <li><b>need you NOW</b> — planets already losing output (storage full or extractors ended).</li>
                <li><b>next deadline</b> — the single soonest event and whose planet it is.</li>
                <li><b>ISK sitting on the ground</b> — the value of everything in launchpads and storage at Jita prices.</li>
              </ul>
              <p>A planet that reads <i>measuring since pickup…</i> is not broken: EVE only updates a colony's state when its owner views it in game, and the fill rate is the difference between two such looks. Open the colony twice and the numbers arrive.</p>
            </>
          ),
        },
        {
          id: 'horizon', title: 'Next 72 hours',
          figure: (
            <Fig caption="Every deadline on one clock. ■ storage fills · ▲ extractor program ends. Blue → amber → red as it nears; overdue pins red at the left.">
              <Timeline hours={72} rows={[
                { label: 'Tama IV · Cid', at: 5, kind: 'fill' },
                { label: 'Kedama II · Cid', at: 21, kind: 'end' },
                { label: 'Jita IV · Alice', at: 40, kind: 'fill' },
                { label: 'Nourv III · Bob', at: 66, kind: 'end' },
              ]} />
            </Fig>
          ),
          body: (
            <>
              <p>Every planet with a deadline inside the next 72 hours gets a row. The area stretches with the window — full screen or half, the clock fills what it has.</p>
              <ul>
                <li><b>Click a row</b> to open that planet's detail popup.</li>
                <li>The <b>character chips</b> above filter the rows (and the cards) to one login.</li>
                <li>A planet with both a fill and a program end shows the sooner one here; the card shows both.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'filters', title: 'Character chips & filters',
          figure: (
            <Fig caption="Chips filter everything below them; the ✕ chip clears the filter.">
              <Chips chips={[{ label: 'Alice · 5', tone: 'on' }, { label: 'Bob · 4' }, { label: 'Cid · 5' }, { label: '✕ all' }]} />
            </Fig>
          ),
          body: (
            <>
              <ul>
                <li><b>Character chips</b> — click one to see only that character's planets; click again (or ✕) to clear. Several can be on at once.</li>
                <li><b>only show planets needing something</b> — hides planets that read <i>fine</i> or <i>processing only</i>, so the grid is a to-do list.</li>
                <li><b>Unwatched characters</b> — a logged-in character without the PI tick appears in a row above the grid with a one-click <Btn mini>watch</Btn> button. If their login predates the planet permission, a re-login prompt appears instead.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'cards', title: 'Planet cards & what the colours mean',
          figure: (
            <Fig caption="Worst first, left to right. The band is the problem; the numbers are fill, pull vs burn, and value on the ground.">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Card band="FULL — losing output" tone="bad" title="Tama IV" who="Cid" lines={['storage 100% · 3h overdue', 'pull 1,200/h · burn 900/h', '48m ISK on the ground']} />
                <Card band="fills soon" tone="warn" title="Jita IV" who="Alice" lines={['storage 82% · fills in 9h', 'pull 800/h · burn 800/h', '12m ISK on the ground']} />
                <Card band="⚖ rebalance heads↔factories" tone="info" title="Nourv III" who="Bob" lines={['storage 40%', 'pull 600/h · burn 900/h', 'factories underfed 33%']} />
              </div>
            </Fig>
          ),
          body: (
            <>
              <Table head={['Band', 'Meaning', 'Do']} rows={[
                ['FULL — losing output', 'storage is full; extractors keep running and output is discarded', 'log in, empty it'],
                ['extractors ended', 'every extractor program has expired; nothing is being produced', 'restart programs'],
                ['fills soon', 'storage will fill within your threshold', 'plan a pickup'],
                ['program ending', 'an extractor program ends within your threshold', 'plan a restart'],
                ['factory starved', 'a factory has had no input for longer than your threshold', 'check routes / heads'],
                ['⚖ rebalance heads↔factories', 'average extraction and factory burn are mismatched (see the detail popup)', 'adjust on the next reset trip'],
                ['processing only', 'no extractors — a factory / hub planet', 'nothing'],
                ['fine', 'nothing needs you', 'nothing'],
              ]} />
              <p>Click any card for the detail popup (next page). The portrait says whose planet it is.</p>
            </>
          ),
        },
        {
          id: 'detail', title: "A planet's detail popup",
          body: (
            <>
              <p>Everything Conductor knows about one planet, top to bottom:</p>
              <ul>
                <li><b>Set autopilot</b> — sets that character's waypoint to the planet's system. Only a <i>running</i> client accepts it; otherwise you get a message and nothing changes.</li>
                <li><b>Extractors</b> — each head's program, time left, and its <b>Avg /hour</b>: the whole program's average from CCP's published yield formula (extraction starts high and decays), with a per-cycle yield chart. This is the number to compare with factory burn — not the flat per-cycle figure the game shows.</li>
                <li><b>Factories</b> — what each line consumes and produces per hour when cycling back to back, from the game's own schematic table.</li>
                <li><b>Flow balance</b> — supply (active programs' average plus what upstream factories make) against burn (what every factory line eats). <i>Underfed</i> means more factories than the heads can feed; <i>surplus</i> means heads outrun the factories and the excess piles up. The ⚖ card band comes from here.</li>
                <li><b>On the planet</b> — contents of every pin, with value.</li>
                <li><b>Readings</b> — the raw looks EVE reported; the fill rate is the difference between them, measured rather than predicted.</li>
              </ul>
              <Try>Open a ⚖ planet, read <b>Flow balance</b>. If burn exceeds supply, one factory too many is running dry; if supply exceeds burn by a lot, a head could move to another resource.</Try>
            </>
          ),
        },
        {
          id: 'alerts', title: 'Alert thresholds & phone alerts',
          body: (
            <>
              <p>At the bottom of the page:</p>
              <ul>
                <li><b>PI alerts</b> on/off.</li>
                <li><b>fills within N h</b> — when "fills soon" starts.</li>
                <li><b>warn at N %</b> — the fill fraction that counts as nearly full.</li>
                <li><b>program ends within N h</b> — when "program ending" starts.</li>
                <li><b>N h without input</b> — when a factory counts as starved.</li>
              </ul>
              <p>Phone alerts go through the ntfy topic in ⚙ Settings → Alerts, once per event (not every poll). <b>⚖ rebalance</b> is deliberately never a phone alert — it is a next-trip note, not an emergency.</p>
              <Limit>Colony state only changes when the owner views the colony in game, so a threshold can only fire from the last look. Look at your colonies when you log in and the module stays honest.</Limit>
            </>
          ),
        },
      ],
    },
  ],
};

export const PI_PANELS: Record<string, PanelHelp> = {
  'pi.horizon': {
    title: 'Next 72 hours',
    figure: (
      <Fig>
        <Timeline hours={72} rows={[
          { label: 'Tama IV · Cid', at: 5, kind: 'fill' },
          { label: 'Kedama II · Cid', at: 21, kind: 'end' },
          { label: 'Jita IV · Alice', at: 40, kind: 'fill' },
        ]} />
      </Fig>
    ),
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
    figure: (
      <Fig>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Card band="FULL — losing output" tone="bad" title="Tama IV" who="Cid" lines={['storage 100% · 3h overdue', '48m ISK on the ground']} />
          <Card band="fine" tone="good" title="Nourv III" who="Bob" lines={['storage 40% · fills in 2d', '9m ISK on the ground']} />
        </div>
      </Fig>
    ),
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
};
