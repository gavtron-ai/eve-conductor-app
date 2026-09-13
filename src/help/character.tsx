// SKILL & FIT — the book: Skill Match, Fit Skill Maxer, Fit Wizard, Fit
// Propagator. The wizard gets the most pages; it has the most buttons.
import type { ModuleHelp, PanelHelp } from './types';
import { Bar, Btn, Chips, Fig, Flow, Keys, Limit, Pair, Steps, Table, Tiles, Try, Wheel } from './figures';

export const CHARACTER_HELP: ModuleHelp = {
  title: 'EVE Skill & Fit Conductor',
  blurb: 'skill match · fit tools',
  intro: [
    {
      id: 'what', title: 'What this module is for',
      figure: (
        <Fig>
          <Bar brand="EVE Skill & Fit Conductor" tabs={['Skill Match', 'Fit Skill Maxer', 'Fit Wizard', 'Fit Propagator']} active="Fit Wizard" />
        </Fig>
      ),
      body: (
        <>
          <p>
            Skills, fits, and what your characters can actually fly. Everything is computed by the same dogma engine EVE uses — real attributes, real stacking penalties — per character. Skills and implants auto-resync while this module is open.
          </p>
          <Steps items={[
            <><b>Skill Match</b> — which alt gets the next injector, or how far a new character is from replacing a main.</>,
            <><b>Fit Skill Maxer</b> — "what do I train to fly THIS better, and how big is that ask?"</>,
            <><b>Fit Wizard</b> — build and tune fits with live stats for each character, then copy, save or ship them.</>,
            <><b>Fit Propagator</b> — one clean fit list, pushed to every character's in-game folder.</>,
          ]} />
          <p>The left sidebar picks the characters most tabs compute for. <b>Sync</b> a character there first if their numbers read <i>unsynced</i>.</p>
        </>
      ),
    },
  ],
  groups: [
    // ------------------------------------------------------------------ match
    {
      id: 'match', title: 'Skill Match',
      pages: [
        {
          id: 'match-how', title: 'Two characters, side by side',
          figure: (
            <Fig caption="Each column lists exactly what THAT character must train to match the other.">
              <Table head={['Skill', 'Alice · Now', 'Target', 'Gap']} rows={[
                ['Gallente Cruiser', 'III', 'V', '2'],
                ['Medium Hybrid Turret', 'IV', 'V', '1'],
              ]} />
            </Fig>
          ),
          body: (
            <>
              <Steps items={[
                <>Click two portraits in the left sidebar. A third click replaces the older pick.</>,
                <>If a character reads <i>skills not synced</i>, press their <b>Sync</b> button (or Settings → character → Sync).</>,
                <>Read both tables: skill by skill, <b>Now</b>, <b>Target</b> (the other character's level) and <b>Gap</b> in levels.</>,
              ]} />
              <Try>Compare your main against the alt you are thinking of injecting. The shorter column is the cheaper catch-up.</Try>
            </>
          ),
        },
      ],
    },
    // -------------------------------------------------------------------- fit
    {
      id: 'fit', title: 'Fit Skill Maxer',
      pages: [
        {
          id: 'fit-pick', title: 'Picking a fit',
          figure: (
            <Fig caption="Pick a fit, and the analysis runs at once for every selected character.">
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 11.5 }}>
                <span>Whose fits <Btn mini>All characters ▾</Btn></span>
                <span>Source <Btn mini>All sources ▾</Btn></span>
                <span>Fit <Btn mini>Alice · Vexor — Ratting ▾</Btn></span>
                <Btn mini>⟳ refresh fits</Btn>
                <Btn mini>📋 use fit from clipboard</Btn>
              </div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Whose fits</b> — one character's saved fits, or everyone's pooled and deduplicated.</li>
              <li><b>Source</b> — in-game saved fits, ships the character owns, or fits from the Fit Wizard.</li>
              <li><b>Fit</b> — picking one runs the analysis immediately.</li>
              <li><b>⟳ refresh fits</b> — re-pull saved fittings and owned ships from EVE for every character.</li>
              <li><b>📋 use fit from clipboard</b> — copy any fit in game (fitting window → ≡ → Copy) and analyze it without saving.</li>
            </ul>
          ),
        },
        {
          id: 'fit-tiers', title: 'Reading the tiers & SP',
          figure: (
            <Fig caption="Skills tiered by impact, with the SP cost of every level and each character's gap.">
              <Table head={['Skill', 'Need', 'Best', 'Alice', 'Bob', 'What it does']} rows={[
                ['Gallente Cruiser', 'I · 250 SP', 'V · 256k SP', 'V', 'III (+2 · 200k)', 'required by Vexor; +10% drone damage per level'],
                ['Drone Interfacing', '—', 'V · 1.28m SP', 'IV (+1 · 905k)', 'II (+3 · 1.2m)', 'boosts drone damage'],
                ['SP still to train', '', '', '905k', '1.4m', ''],
              ]} />
              <div style={{ marginTop: 6 }}><Btn mini>📋 copy Need plan</Btn> <Btn mini>📋 copy Best plan</Btn> <Btn mini>show fit-wide skills</Btn></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Need</b> — the highest level any fit item demands, requirement chains included, with that level's total SP. "—" means nothing requires it; it only boosts.</li>
              <li><b>Best</b> — the level that maxes the fit: V for every skill that improves it; for pure prerequisites, the required level and nothing past it.</li>
              <li><b>Per-character cells</b> — the current level, and <i>(+N · SP)</i> when short: levels missing and SP left to train. The bottom row totals each character's SP to reach the Best plan.</li>
              <li><b>What it does</b> — requirements name the items that demand it; boosts come from CCP's dogma data (which attribute, on what).</li>
              <li><b>Tiers</b> — required by the hull, required by modules, boosts, and <i>fit-wide</i> skills (hull HP, capacitor, speed…) tucked away under <b>show fit-wide skills</b> because they are true for every fit.</li>
              <li><b>📋 copy plan</b> — <i>Skill Name N</i> lines; paste into the in-game training queue (it imports from the clipboard).</li>
            </ul>
          ),
        },
        {
          id: 'fit-stats', title: 'Per-character fitting stats',
          body: (
            <>
              <p>Under the tiers, the same live stats pane the Fit Wizard uses: CPU, powergrid, calibration and capacitor meters per selected character (REMAINING / total, the in-game layout; amber near a limit, red past it), the defense grid, the DPS / Alpha / Range / EHP / Speed / Targeting tiles, and the weapon, projected and ammo tables. See the Fit Wizard's <i>stats pane</i> page for every piece.</p>
              <p>When one character is short of CPU or grid and another is not, <b>hover the red bar</b>: a popover measures, one skill at a time, which of the other character's skills would close the gap — with a <b>copy</b> button in the in-game queue format.</p>
            </>
          ),
        },
      ],
    },
    // ----------------------------------------------------------------- wizard
    {
      id: 'wizard', title: 'Fit Wizard',
      pages: [
        {
          id: 'wiz-start', title: 'Starting a fit',
          figure: (
            <Fig caption="Three starting points. Most fits are alterations of something, not blank slates.">
              <Flow steps={['+ new fit → pick a hull', '📋 new fit from clipboard', "a character's saved fit"]} />
            </Fig>
          ),
          body: (
            <ul>
              <li><b>+ new fit</b> — type part of a hull name (<i>khiz, loki, rifter</i>), pick it in the ship tree, optionally name the fit (defaults to the hull).</li>
              <li><b>📋 new fit from clipboard</b> — copy any EFT fit in game (fitting window → ≡ → Copy to Clipboard) and it opens here, editable. Modules land in their own racks whatever order the paste had; anything that does not fit its rack goes to cargo, visibly; a pod in the cargo goes back into its implant slots.</li>
              <li><b>Saved fits</b> — the select lists every character's in-game saved fits; picking one opens a <i>copy</i>. The in-game original is never touched.</li>
            </ul>
          ),
        },
        {
          id: 'wiz-wheel', title: 'The wheel & the module browser',
          figure: (
            <Fig caption="The wheel: rings of high, mid and low sockets around the hull; rigs and subsystems below. The browser on the left fills it.">
              <Pair left={<Wheel />} right={
                <div style={{ fontSize: 11.5 }}>
                  <div style={{ color: 'var(--ink-2)', fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '0.04em' }}>module browser</div>
                  <div><Btn mini>filter the tree…</Btn></div>
                  <div style={{ marginTop: 4 }}>☑ fits hull · ☑ my skills · ☐ fits what's left</div>
                  <div style={{ marginTop: 4 }}><Btn mini>+ charges</Btn> <Btn mini>+ drones</Btn> <Btn mini>+ cargo/spares</Btn></div>
                  <div style={{ marginTop: 6, color: 'var(--ink-2)' }}>Shield › Shield Extenders › Large Shield Extender I · II · Republic Fleet…</div>
                </div>
              } />
            </Fig>
          ),
          body: (
            <>
              <ul>
                <li><b>Placing a module</b> — drag it from the tree onto a socket, or double-click to place it in the first free socket of its rack. <b>Drag between sockets</b> to move; <Keys keys={['Shift']} />-drag to copy.</li>
                <li><b>Filters</b> — <i>fits hull</i> (right rack for this ship), <i>my skills</i> (the filter character can use it), <i>fits what's left</i> (CPU, grid and hardpoints still available).</li>
                <li><b>+ charges</b> — browse charges like the in-game Charges tab; pick a fitted module to filter, click a charge to load every module of that type. Dropping a charge on the ship does the same.</li>
                <li><b>+ drones</b> / <b>+ cargo/spares</b> — add to the bay or cargo; each line has a qty and a remove button.</li>
                <li><b>Variants</b> — select a fitted module and its whole variation family (T1, meta, T2, faction, deadspace) appears for one-click swaps.</li>
              </ul>
              <p><b>The slot toolbar</b> (select a socket):</p>
              <ul>
                <li><b>State</b> — only the states the module actually has: passive modules offer <i>offline / online</i>; active ones add <i>active</i>; overheatable ones add <i>overload</i> (simulated).</li>
                <li><b>Charge</b> — shows the loaded charge; click to change.</li>
                <li><b>Locks</b> — <i>soft</i>: Make It Work keeps this <i>kind</i> of module but may swap the variant; <i>hard</i>: keeps exactly this module.</li>
                <li><b>✕</b> — clear the slot.</li>
              </ul>
              <p>Clicking an empty socket opens the <b>slot picker</b>: search anything that fits this rack, tick <i>only fits</i> to hide what would go over, or <i>leave the slot empty</i>.</p>
            </>
          ),
        },
        {
          id: 'wiz-fits', title: 'Fits & variations',
          figure: (
            <Fig caption="A fit is a family: one core, forked into variations you tune separately.">
              <div style={{ fontSize: 11.5 }}>
                <span>FIT <Btn mini>Vexor — Ratting ▾</Btn></span> <span>VARIATION <Btn mini>Core ▾</Btn></span> <Btn mini>new variation name…</Btn> <Btn mini>+ fork variation</Btn> <Btn mini>🗑 variation</Btn>
                <div style={{ marginTop: 6 }}><Btn mini>✎ fit</Btn> <Btn mini>✎ variation</Btn> <Btn mini>ⓘ ship info</Btn> <Btn mini>⟳ change hull</Btn> <Btn mini>✕ clear modules</Btn> <Btn mini>🗑 fit</Btn></div>
              </div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Fit / Variation</b> selects — switch between your fits and a fit's variations. Fits live in the app; there is no in-game size limit.</li>
              <li><b>+ fork variation</b> — type a name, fork the <i>current</i> variation under it, then tune (a shield version, a cap-stable version…). <b>🗑 variation</b> deletes the current one (a fit keeps at least one).</li>
              <li><b>✎ fit / ✎ variation</b> — rename. In-game saves use <i>fit - variation</i> as the name.</li>
              <li><b>ⓘ ship info</b> — the hull's trait bonuses, like the in-game info window.</li>
              <li><b>⟳ change hull</b> — swap the hull; modules that do not fit the new layout move to cargo, visibly, with a note you dismiss with <b>ok</b>.</li>
              <li><b>✕ clear modules</b> — empties every slot of the current variation (charges and locks included); drones and cargo stay.</li>
              <li><b>🗑 fit</b> — delete the whole fit and all its variations.</li>
            </ul>
          ),
        },
        {
          id: 'wiz-stats', title: 'The stats pane',
          figure: (
            <Fig caption="Live for the selected character(s). Pick one or two in the sidebar; their numbers appear as columns.">
              <Tiles tiles={[{ big: '412', sub: 'DPS · 380 sustained' }, { big: '1,240', sub: 'Alpha · 2 weapon groups' }, { big: '18 km', sub: 'Range · + 12 km falloff · tracking 0.09' }, { big: '24.1k', sub: 'EHP' }, { big: '1,180 m/s', sub: 'Speed' }, { big: '5.2 s', sub: 'Targeting · 62 km' }]} />
              <div style={{ marginTop: 6 }}><Chips chips={[{ label: 'CPU 12.4 / 250 tf' }, { label: 'Powergrid 3.1 / 610 MW', tone: 'warn' }, { label: 'Calibration 0 / 400' }, { label: 'Capacitor stable · 1,875 GJ', tone: 'good' }]} /></div>
            </Fig>
          ),
          body: (
            <>
              <ul>
                <li><b>Meters</b> — CPU, powergrid, calibration, capacitor as REMAINING / total (the in-game layout). Amber near a limit; red with an OVER chip past it. Capacitor is a tick-by-tick simulation of every active module: <i>stable</i>, or how long until dry.</li>
                <li><b>Defense</b> — each layer's HP and per-damage-type resistances, filled like the in-game resist boxes.</li>
                <li><b>Tiles</b> — DPS (sustained in the sub-line), <b>Alpha</b>, <b>Range</b> (missiles: flight ceiling; turrets: optimal + falloff and tracking), EHP, Speed, Targeting (lock time and range).</li>
                <li><b>Weapons table</b> — every weapon group with dps, alpha, range, application (tracking or explosion) and the damage split.</li>
                <li><b>Projected table</b> — what the fit does to <i>other</i> ships: painters, webs, points, scrams, neuts, nos, remote reps, cap transfer, damps, ECM — engine-final strength, optimal and falloff, cycle and cap.</li>
                <li><b>Ammo tables</b> — one per weapon group, on demand (open to run): every loadable charge computed with the real engine so the range-vs-damage trade is a glance.</li>
                <li><b>Applied damage</b> (fold) — a mini simulation against a chosen target profile and axis, including your lock time on it.</li>
                <li><b>Ship attributes</b> (fold) — every attribute the engine computed, grouped as the SDE groups them.</li>
              </ul>
              <Limit>A character whose skills are not synced gets no numbers — assumed skills would be wrong. Press Sync in the sidebar.</Limit>
            </>
          ),
        },
        {
          id: 'wiz-pods', title: 'Pods & implants',
          figure: (
            <Fig caption="Under the stats: sit the fit in a different clone and watch the numbers move.">
              <div style={{ fontSize: 11.5 }}>
                <span>🧠 Pod <Btn mini>characters' own implants ▾</Btn></span> <Btn mini>load Alice's current pod</Btn> <Btn mini>name this pod…</Btn> <Btn mini>💾 save as new pod</Btn> <Btn mini>↻ update</Btn> <Btn mini>🗑</Btn>
                <div style={{ marginTop: 6 }}>slot 1 <Btn mini>Ocular Filter — Basic · 9.8m ▾</Btn> slot 2 <Btn mini>— ▾</Btn> …</div>
              </div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>Mode</b> — <i>characters' own</i>: each selected character wears their synced implants. A <i>saved pod</i> or <i>custom</i> is worn by all of them, so the comparison is about the pod.</li>
              <li><b>Ten slot selects</b> — every implant for that slot, alphabetical then by level, with its Jita price.</li>
              <li><b>load … current pod</b> — fills the slots from the multibox registry's live clone (or the last sync).</li>
              <li><b>💾 save as new pod</b> — into the pod library, separate from fits, so any fit can sit in it later. <b>↻ update</b> writes changed slots back; <b>🗑</b> deletes the saved pod (this fit keeps the implants as custom).</li>
              <li>A pod attached to a fit <b>travels with it</b>: its implants ride in cargo on every copy, buy list and save-to-character, and importing that EFT puts them back in their slots.</li>
            </ul>
          ),
        },
        {
          id: 'wiz-export', title: 'Copy, save, export',
          figure: (
            <Fig>
              <div><Btn>⧉ copy EFT</Btn> <Btn>⧉ copy buy list</Btn> <Btn>→ skill maxer</Btn> <span style={{ fontSize: 11.5 }}>save to <Btn mini>Alice ▾</Btn></span> <Btn primary>💾 save to character</Btn> <Btn mini>🔑 re-login to enable saving</Btn></div>
            </Fig>
          ),
          body: (
            <ul>
              <li><b>⧉ copy EFT</b> — paste into EVE's fitting window (≡ → Import from Clipboard) to simulate or fit it in game.</li>
              <li><b>⧉ copy buy list</b> — hull, modules, charges, drones, cargo spares (and the pod) in multibuy format: Market → Multibuy → paste.</li>
              <li><b>→ skill maxer</b> — analyze this variation's skills and per-character plans.</li>
              <li><b>save to character</b> — writes the variation into that character's in-game fitting manager as <i>fit - variation</i>. Needs the fittings <i>write</i> permission, which only comes with a login: a character logged in before it existed shows <b>🔑 re-login to enable saving</b> — one click, then save.</li>
            </ul>
          ),
        },
      ],
    },
    // ------------------------------------------------------------- propagator
    {
      id: 'propagator', title: 'Fit Propagator',
      pages: [
        {
          id: 'prop-what', title: 'What it does & the safety scope',
          figure: (
            <Fig caption="Every character's personal fits → one canonical list → every character's folder matches it.">
              <Flow steps={['tick characters (scope)', '⟳ Rescan', 'merge identical fits', 'clean up names', 'push: add or mirror']} />
            </Fig>
          ),
          body: (
            <>
              <p>Pulls every ticked character's personal saved fits into <b>one list</b>, merges the identical ones (same hull and fitting — names ignored), lets you clean the names, then makes every ticked character's in-game folder match. Duplicates sort to the top because they need a decision.</p>
              <ul>
                <li><b>Sidebar ticks</b> are the safety scope: only ticked characters are scanned, backed up and changed. <b>all / none</b> buttons; tick one character to test safely. The selection locks while a push or restore is staged.</li>
                <li><b>⟳ Rescan</b> re-reads in-game fits; <b>filter fits…</b> narrows the list.</li>
              </ul>
            </>
          ),
        },
        {
          id: 'prop-clean', title: 'Cleaning names & comparing',
          body: (
            <ul>
              <li>Each merged fit lists the names it was saved under — click one (<i>use this name</i>) to make it canonical.</li>
              <li><b>Include</b> checkboxes decide what the canonical list contains; <b>all / none</b> above them.</li>
              <li><b>compare</b> — opens the Fit Inspector's Compare tab against the selected fit: Modules, Ammo (per-charge table), Applied damage, and a Diff; <b>clear</b> stops comparing.</li>
              <li><b>Export fitting files</b> — one XML per character containing only what that character is missing; or every unique fit as its own EVE XML file into a folder; or a pyfa-friendly export.</li>
            </ul>
          ),
        },
        {
          id: 'prop-push', title: 'Pushing & snapshots',
          body: (
            <>
              <p>Two push modes, both shown as a plan before anything happens:</p>
              <ul>
                <li><b>add</b> — creates missing fits on each ticked character; nothing is deleted.</li>
                <li><b>mirror</b> — makes each folder match exactly: <b>unticked fits are DELETED</b>. The confirm dialog lists every fit that would go. <b>EVE has no rename endpoint</b>, so a renamed fit is a delete plus a create.</li>
              </ul>
              <p><b>Stop</b> halts a running push; <b>Clear</b> empties the log. Before any push the tool takes a <b>snapshot</b> of every ticked character's fits: <b>check</b> compares it to the game right now (read-only); <b>restore</b> shows exactly what would be recreated, then asks — a restore only ever <i>adds</i>.</p>
              <Limit>EVE has no undo for a deleted fit. Mirror mode makes you confirm the exact list, and the snapshot exists so a mistake is recoverable.</Limit>
            </>
          ),
        },
      ],
    },
  ],
};

export const CHARACTER_PANELS: Record<string, PanelHelp> = {
  'wizard.browser': {
    title: 'Module browser',
    body: (
      <p>
        The in-game market hierarchy: folders match the client, Standard → Advanced →
        Faction, with meta variants folded under their base item. Drag a module onto the
        wheel (or double-click) to fit it; drag a charge onto the ship to load it everywhere
        it fits. The pane edge drags wider if names are cut off. The three filters hide what
        cannot go on this hull, what the filter character cannot use, and what would not fit
        what is left — CPU, powergrid and hardpoints included.
      </p>
    ),
  },
  'wizard.stats': {
    title: 'Fit stats',
    figure: (
      <Fig>
        <Tiles tiles={[{ big: '412', sub: 'DPS' }, { big: '1,240', sub: 'Alpha' }, { big: '18 km', sub: 'Range' }, { big: '24.1k', sub: 'EHP' }, { big: '1,180 m/s', sub: 'Speed' }, { big: '5.2 s', sub: 'Targeting' }]} />
      </Fig>
    ),
    body: (
      <p>
        Simulated live by the dogma engine for the selected character — the same math as the
        in-game fitting window, including stacking penalties. Meters go amber near a limit
        and red with an OVER chip past it. Defense shows each layer's HP and per-damage-type
        resistances. <b>DPS, Alpha and Range</b> are separate headline numbers; under them the
        weapons table (every group's dps, alpha, range, application, damage split), the
        <b> projected</b> table (painters, webs, points, neuts, remote reps — engine-final
        strength, optimal and falloff), and each weapon's <b>ammo table</b> (every loadable
        charge, computed on demand). The applied-damage fold is a mini simulation against a
        chosen target. The <b>🧠 Pod</b> section under the stats sits the fit in different
        clones; a pod attached to a fit travels with it as cargo on every copy and save.
        The module guide's Fit Wizard pages walk every piece.
      </p>
    ),
  },
};

