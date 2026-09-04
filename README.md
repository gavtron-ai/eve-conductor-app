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
- **Aperture** — your corporation's own web map, embedded with its own
  persistent login.

Prebuilt Windows installers (with automatic updates) live in
[eve-conductor-releases](https://github.com/gavtron-ai/eve-conductor-releases).

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

## Repository notes

- `tests/` holds the fixture suite (hand-computed expectations; the README
  there has the run recipe — the sim libraries compile into `tests/sim`
  first).
- The fitting engine wasm in `src/vendor/dogma-engine/` is a build of the
  EVEShipFit team's [dogma-engine](https://github.com/EVEShipFit/dogma-engine)
  (MIT).
- This repo is a curated export of a private working tree; issues and PRs
  are welcome, and changes land here with each release sync.

## License

MIT — see [LICENSE](LICENSE). EVE Online and all related materials are the
intellectual property of CCP hf.; this project is not affiliated with or
endorsed by CCP hf.
