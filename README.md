# EVE Conductor

An EVE Online tool suite for people who play with measured numbers instead
of guesses. One Electron app, six modules behind the title dropdown:

- **Trade Conductor** — a market radar that snapshots entire regional order
  books every ~30 minutes and diffs them (reprices = war tempo, volume
  drops = real fills), plus order babysitting, haul planning, a trading
  ledger and long-term trend analysis of your own orders.
- **Skill & Fit Conductor** — dogma-exact fitting tools: skill gap
  comparisons, a fit skill maxer, a graphical fit wizard simulated live by
  the same engine math the client uses, and a fit propagator that keeps
  every character's saved fits in sync.
- **Battle Conductor** — corp killboard reports, a live game-log visualizer
  (combat and mining), and a fleet simulator where every ship is a real fit
  flown by a real character's skills and clone.
- **Theft Conductor** — skyhook raid windows from CCP's public feed, with
  raid history measured by diffing the feed, and honest ceilings on what
  might be banked.
- **Planetary Industry** — a fleet-wide deadline horizon, worst-first planet
  cards, and head↔factory flow balance computed from CCP's own published
  yield formula.
- **Aperture** — the tab for your corporation's Aperture map is switched off
  (since 0.216.0): the app makes no contact with Aperture at all until its
  developer has agreed a method of reading it. The tab says so and offers to
  open the map in your own browser instead.

Prebuilt Windows installers (with automatic updates) live in
[eve-conductor-releases](https://github.com/gavtron-ai/eve-conductor-releases).

## Third parties — the owner rule

A third party's service is used only in the way its owner has said is fine, and
the app states, in its own policy page (⚖ in the header), exactly what it asks
of each one and how often — with live request counts. A fixture holds that
page to the code on every build.

- **CCP's ESI** — within the developer licence and the best-practice rules:
  every answer's cache timer honoured, the error-limit headers read (a 420
  pauses everything), one shared reader per pilot, identified by a user agent
  that carries this repository's URL.
- **zKillboard** — its JSON API only, from the main process: one request at a
  time, 1.1 s apart, `429` and `Retry-After` honoured, identified. Never its
  web pages.
- **Fuzzwork** — price aggregates in batches, cached ten minutes; the Static
  Data Export mirror only when the bundled data files are rebuilt.
- **ntfy** — one post per alert, only to a topic you set yourself.
- **GitHub** — the release feed once an hour, an installer only when newer.
- **br.evetools and WarBeacon** — links you copy; never fetched.
- **Aperture** — nothing, until its developer agrees a method.

## Building from source

Requirements: Node 20+, Windows (primary target; a mac build target exists).

```bash
npm install
npm run dev:app     # dev server + Electron shell
npm run dist:win    # build a Windows installer into release/
```

The bundled EVE static data (`src/data/`) ships in the repo and can be
regenerated from CCP's SDE and ESI with the `npm run build:*` scripts.

## The privacy model

- **Every user registers their own free EVE application** on
  [developers.eveonline.com](https://developers.eveonline.com) — no API
  identity ships in this code, and the first-run tour walks through the
  one-minute setup. Login uses EVE's own SSO with PKCE; there is no secret
  key, tokens never leave the machine, and the app never sees a password.
- **Per-player state lives outside the code**: settings in
  `Documents\EVE Conductor`, diagnostics in `Documents\EVE Conductor Logs`,
  long-term measured history in
  `Documents\EVE Conductor Stats (Do Not Delete)`.
- **The shareability guard** (`scripts/check-shareable.mjs`) scans every
  built payload for the operator's personal data before it can be
  distributed. The pattern list itself is personal, so it lives in a
  gitignored `scripts/owner-patterns.local.json` — create your own (format
  in `scripts/ownerPatterns.mjs`) if you distribute builds.
- **The go-live check** (`scripts/golive-check.mjs`, `npm run golive:check`)
  runs before anything is published: the fixture suite (which holds the
  policy page's hosts, services and cadence numbers to the code), both
  shareability guards, a dry run of the public source export, and the
  installed app's own diagnostics for the last day. It writes a stamp, and
  `npm run publish:beta` refuses to run without a passing one for the same
  version, younger than 30 minutes, made with the same emergency decision.

## Repository notes

- `tests/` holds the fixture suite (hand-computed expectations; the README
  there has the run recipe — the sim libraries compile into `tests/sim`
  first).
- The fitting engine wasm in `src/vendor/dogma-engine/` is a build of the
  EVEShipFit team's [dogma-engine](https://github.com/EVEShipFit/dogma-engine)
  (MIT).
- This repo is a curated export of a private working tree; issues and PRs
  are welcome, and changes land here with each release sync.

## Code signing policy

Windows builds are **not signed yet**. This project is applying to the
[SignPath Foundation](https://signpath.org/) for the free code signing it
offers open-source software. The pipeline is in place: this repository's
`windows-build` workflow builds the installer on a GitHub runner and, once the
SignPath project exists, signs the executables inside the app and then the
installer through SignPath.io (`signing/signpath/` holds the artifact
configurations; `scripts/repair-feed.mjs` re-derives the update feed from the
signed file). When approved, this section will read: *Free code signing
provided by SignPath.io, certificate by SignPath Foundation.*

- **Committers and reviewers:** gavtron-ai (the maintainer). Changes from anyone
  else are reviewed by the maintainer before they are merged.
- **Approvers:** gavtron-ai. Every release is approved for signing by hand; a
  build nobody approved is never signed.
- **Privacy policy:** the app sends no data about you to this project or to
  anyone else. From your machine it makes only the requests listed under
  "Third parties — the owner rule" above, to those services, and it collects no
  telemetry. The diagnostics log stays on your disk unless you paste it
  somewhere yourself. The in-app policy page (⚖ in the header) states the same
  with live request counts.

## License

MIT — see [LICENSE](LICENSE). Bundled third-party components: the fitting
engine wasm is a build of the EVEShipFit team's dogma-engine (MIT; its licence
is in `src/vendor/dogma-engine/LICENSE`), and the bundled EVE static data
derives from CCP's Static Data Export and ESI. The licences of every package the
app ships with are generated into `THIRD-PARTY-NOTICES.txt` at build time and
shown in the app under Help → About. EVE Online and all related materials are
the intellectual property of CCP hf.; this project is not affiliated with or
endorsed by CCP hf.
