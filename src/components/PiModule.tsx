// PLANETARY INDUSTRY — one fleet view: header tiles, a 72h deadline horizon,
// and a single worst-first card grid across every watched character.
//
// THE USER JOURNEY THIS IS BUILT AROUND
//
// PI is not played from a screen; it is played by flying to planets. The
// screen's job is to answer one question at a glance — WHICH PLANET DO I GO
// TO NEXT — and then get out of the way.
//
//   1. an alert fires on desktop and phone ("2 planets need you")
//   2. this screen shows each character's planets as cards, worst first,
//      colour-coded by what they are costing
//   3. clicking a card opens everything else: contents, pins, readings
//   4. "go" sets that character's autopilot to the planet's system
//   5. the next poll sees the new state and the card goes quiet
//
// WHY CARDS AND NOT A TABLE: a 36-row table of near-identical numbers is
// unreadable — the eye has nothing to catch on, and the one planet that is
// actually full looks exactly like the 35 that are fine. Cards were once
// grouped per character, but at 8 characters that meant scrolling past 30
// fine planets to find the one on fire — so it is now ONE worst-first grid
// (each card wears its owner's portrait) plus character chips for the
// "log in as ONE character, do THEIR planets" pass.
//
// Conductor cannot touch a planet — ESI is read-only for PI — so the waypoint
// is the whole extent of what it can do, and it matters: finding a planet in
// game means remembering which system it was in.
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useApp } from '../lib/store';
import { useFreshness, countdown } from '../lib/freshness';
import { setWaypoint, onlineCharIds, tokenHasScope } from '../lib/esiChar';
import {
  piPlanets, piLastRun, piCharacters, snapshotsFor, planetKey, PI_INTERVAL_MS,
  DEFAULT_PI_THRESHOLDS,
  type PlanetProblem, type PlanetState,
} from '../lib/pi';
import { loadSchematics, schematicPerHour, type Schematic } from '../lib/piSchematics';
import { yieldSchedule } from '../lib/piYield';
import { useElementWidth } from '../lib/useElementWidth';
import { InfoDot } from './Help';
import { getType } from '../lib/typedb';
import { isk, iskShort, int } from '../lib/format';
import { logUser } from '../lib/devlog';
import Tip from './Tip';

const PI_SCOPE = 'esi-planets.manage_planets.v1';

/** colour carries the cost, so the eye lands on the expensive thing first */
const TONE: Record<PlanetProblem, { bg: string; bar: string; label: string; text: string }> = {
  'storage-full':      { bg: 'rgba(255,77,77,.14)',  bar: '#ff4d4d', label: 'FULL — losing output', text: '#ff8a8a' },
  'extractor-expired': { bg: 'rgba(255,157,61,.13)', bar: '#ff9d3d', label: 'extractors ended',      text: '#ffb46b' },
  'storage-filling':   { bg: 'rgba(255,157,61,.10)', bar: '#ff9d3d', label: 'fills soon',            text: '#ffb46b' },
  'extractor-expiring':{ bg: 'rgba(201,133,0,.10)',  bar: '#c98500', label: 'program ending',        text: '#e0a53c' },
  'factory-idle':      { bg: 'rgba(201,133,0,.08)',  bar: '#c98500', label: 'factory starved',       text: '#e0a53c' },
  unbalanced:          { bg: 'rgba(77,163,255,.08)', bar: '#4da3ff', label: '⚖ rebalance heads↔factories', text: '#7fb8f0' },
  'no-extractor':      { bg: 'rgba(255,255,255,.03)',bar: '#5b6470', label: 'processing only',       text: '#8b93a0' },
  ok:                  { bg: 'rgba(0,131,0,.08)',    bar: '#3d9970', label: 'fine',                  text: '#6fbf95' },
};

const PLANET_TINT: Record<string, string> = {
  temperate: '#5fa85f', barren: '#a89268', oceanic: '#4a8fc7', ice: '#7fd0e6',
  gas: '#b07fd0', lava: '#d06a4a', storm: '#6a7fd0', plasma: '#d04a8f',
};

/** planet render type ids on the EVE image server (probed: all eight exist) */
const PLANET_TYPE_ID: Record<string, number> = {
  temperate: 11, ice: 12, gas: 13, oceanic: 2014, lava: 2015, barren: 2016, storm: 2017, plasma: 2063,
};

const perHourText = (n: number): string =>
  n >= 10_000 ? `${Math.round(n / 1000)}k/h` : `${Math.round(n).toLocaleString()}/h`;

/** total units/hour the planet's factories consume when ALL are cycling —
 * exact, from the SDE schematic table; null while the table loads */
function factoryBurnPerHour(p: PlanetState, schem: Map<number, Schematic> | null): number | null {
  if (!schem) return null;
  let total = 0;
  for (const f of p.factorySchematics) {
    const sc = schem.get(f.schematicId);
    if (sc) total += schematicPerHour(sc).inTotalPerHour * f.count;
  }
  return total;
}

/** "4h 20m" / "6d 2h" / "overdue" — time is the only unit that matters here */
function untilText(ms: number | null): string {
  if (ms === null) return '—';
  const d = ms - Date.now();
  if (d <= 0) return 'overdue';
  const h = Math.floor(d / 3_600_000);
  if (h < 1) return `${Math.max(1, Math.round(d / 60_000))}m`;
  if (h < 48) return `${h}h ${Math.floor((d % 3_600_000) / 60_000)}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

// ---------------------------------------------------------------------------
// The official per-cycle yield chart — the same bars the in-game program
// window draws (piYield implements CCP's published formula). Elapsed cycles
// are dimmed; the bright ones are what is still coming.
// ---------------------------------------------------------------------------

function YieldBars({ e }: { e: PlanetState['extractors'][number] }) {
  const sched = useMemo(
    () => yieldSchedule(e.qtyPerCycle!, e.cycleTimeSec!, (e.expiry! - e.installMs!) / 1000),
    [e.qtyPerCycle, e.cycleTimeSec, e.expiry, e.installMs],
  );
  if (sched.length < 2) return null;
  const max = Math.max(...sched);
  if (max <= 0) return null;
  const doneCycles = Math.floor((Date.now() - e.installMs!) / (e.cycleTimeSec! * 1000));
  const W = sched.length; const H = 34;
  const name = e.productTypeId ? (getType(e.productTypeId)?.name ?? `#${e.productTypeId}`) : '';
  return (
    <div style={{ margin: '6px 0 2px' }}>
      <div className="dim" style={{ fontSize: 10.5, marginBottom: 2 }}>
        {name} — per-cycle yield over the program ({sched.length} cycles, peak {int(max)})
      </div>
      <svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none"
        role="img" aria-label={`${name} per-cycle yield`}>
        {sched.map((y, i) => (
          <rect key={i} x={i + 0.08} width={0.84} y={H - (y / max) * H} height={(y / max) * H}
            fill={i < doneCycles ? '#5b6470' : '#4da3ff'} opacity={i < doneCycles ? 0.55 : 0.9} />
        ))}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------

function PlanetCard({ p, schem, onOpen }: { p: PlanetState; schem: Map<number, Schematic> | null; onOpen: () => void }) {
  const tone = TONE[p.problem];
  const tint = PLANET_TINT[p.planetType] ?? '#7a8596';
  const pct = Math.round(p.fullFrac * 100);
  const urgent = p.rank <= 1;
  const burn = factoryBurnPerHour(p, schem);
  const readings = p.m3PerHour === null ? snapshotsFor(planetKey(p.charId, p.planetId)).length : 0;
  const iconId = PLANET_TYPE_ID[p.planetType];

  return (
    <button
      onClick={onOpen}
      title={p.advice}
      style={{
        textAlign: 'left', cursor: 'pointer', width: 232,
        background: tone.bg,
        border: `1px solid ${urgent ? tone.bar : 'rgba(255,255,255,.09)'}`,
        borderLeft: `3px solid ${tone.bar}`,
        borderRadius: 6, padding: '8px 10px', color: 'inherit', font: 'inherit',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {iconId
          ? <img src={`https://images.evetech.net/types/${iconId}/icon?size=64`} alt="" width={30} height={30}
              style={{ borderRadius: 15, flex: '0 0 auto', border: `1px solid ${tint}` }} />
          : <span style={{ width: 8, height: 8, borderRadius: 8, background: tint, flex: '0 0 auto' }} />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <b style={{ fontSize: 13, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {p.planetName}
          </b>
          {/* the SYSTEM lives in the detail popup (user: every planet of his is
              in one system — repeating it on 36 cards said nothing) */}
          <span style={{ fontSize: 11, opacity: .65 }}>{p.planetType}{p.inWormhole ? ' · J-space' : ''}</span>
        </div>
        {/* WHO owns it — the flat fleet grid replaced the per-character
            sections, so the card itself carries the pilot (v0.179) */}
        <img src={`https://images.evetech.net/characters/${p.charId}/portrait?size=32`}
          alt="" width={22} height={22} title={p.characterName}
          style={{ borderRadius: 5, flex: '0 0 auto', opacity: .9 }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      </div>
      <div style={{ height: 6 }} />

      {/* fullness is the headline: it is the thing that silently costs money */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'rgba(255,255,255,.10)', overflow: 'hidden' }}>
          <div style={{ width: `${Math.max(2, pct)}%`, height: '100%', background: tone.bar }} />
        </div>
        <span style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', minWidth: 30, textAlign: 'right' }}>
          {p.capM3 > 0 ? `${pct}%` : '—'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 8px', fontSize: 11, marginTop: 7 }}>
        <span style={{ opacity: .6 }}>fills in</span>
        <span style={{ textAlign: 'right' }}>
          {p.m3PerHour === null
            ? <em style={{ opacity: .6 }} title="The fill rate is measured between storage readings and restarts at every pickup — and EVE only reports storage when this character views the colony in game. Two looks since the last pickup and this becomes a time.">
                {readings >= 2 ? 'measuring since pickup…' : `measuring ${readings}/2…`}
              </em>
            : p.hoursToFull === null ? <span style={{ opacity: .6 }}>not filling</span>
              : untilText(p.fullAt)}
        </span>
        <span style={{ opacity: .6 }}>ext pull</span>
        <span style={{ textAlign: 'right' }}
          title="units/hour the ACTIVE extractor programs pull — exact, from ESI's own program numbers. 0 = programs ended.">
          {p.extractorCount === 0 ? '—'
            : p.extractorPullPerHour === null ? <em style={{ opacity: .6 }}>—</em>
              : perHourText(p.extractorPullPerHour)}
        </span>
        <span style={{ opacity: .6 }}>fac burn</span>
        <span style={{ textAlign: 'right' }}
          title="units/hour the factories consume when ALL are cycling — exact, from the game's schematic table. Compare with ext pull: burn above pull slowly starves the factories.">
          {p.factoryCount === 0 ? '—'
            : burn === null ? <em style={{ opacity: .6 }}>…</em>
              : perHourText(burn)}
        </span>
        <span style={{ opacity: .6 }}>program</span>
        <span style={{ textAlign: 'right', color: p.extractorExpiry !== null && p.extractorExpiry <= Date.now() ? '#ff8a8a' : undefined }}>
          {p.extractorCount === 0 ? '—' : untilText(p.extractorExpiry)}
        </span>
        <span style={{ opacity: .6 }}>value</span>
        <span style={{ textAlign: 'right' }}>{p.value > 0 ? iskShort(p.value) : '—'}</span>
      </div>

      <div style={{ marginTop: 7, fontSize: 11, color: tone.text, fontWeight: urgent ? 700 : 400 }}>
        {tone.label}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------

function PlanetDetail({ p, schem, onClose }: { p: PlanetState; schem: Map<number, Schematic> | null; onClose: () => void }) {
  const [note, setNote] = useState<string | null>(null);
  const [online, setOnline] = useState<number[]>([]);
  useEffect(() => { void onlineCharIds().then(setOnline).catch(() => {}); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const tone = TONE[p.problem];
  const readings = snapshotsFor(planetKey(p.charId, p.planetId));

  return (
    <div className="modal-backdrop" onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.55)', zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="panel" onClick={(e) => e.stopPropagation()}
        style={{ width: 'min(720px, 94vw)', maxHeight: '82vh', overflow: 'auto', margin: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          {PLANET_TYPE_ID[p.planetType] && (
            <img src={`https://images.evetech.net/types/${PLANET_TYPE_ID[p.planetType]}/icon?size=64`}
              alt="" width={48} height={48} style={{ borderRadius: 24, flex: '0 0 auto' }} />
          )}
          <div style={{ flex: 1 }}>
            <h2 style={{ marginBottom: 2 }}>{p.planetName}</h2>
            <div className="hint" style={{ marginTop: 0 }}>
              {p.planetType} · {p.systemName}{p.inWormhole ? ' (wormhole)' : ''} · {p.characterName} · upgrade level {p.upgradeLevel}
            </div>
          </div>
          <button className="btn mini" onClick={onClose}>close</button>
        </div>

        <div style={{ background: tone.bg, borderLeft: `3px solid ${tone.bar}`, borderRadius: 4, padding: '8px 10px', margin: '10px 0' }}>
          <b style={{ color: tone.text }}>{tone.label}</b>
          <div style={{ fontSize: 12, marginTop: 3 }}>{p.advice}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, margin: '12px 0' }}>
          {[
            { k: 'Storage', v: p.capM3 > 0 ? `${Math.round(p.fullFrac * 100)}%` : '—',
              s: p.capM3 > 0 ? `${Math.round(p.usedM3).toLocaleString()} / ${Math.round(p.capM3).toLocaleString()} m³` : 'no storage pins' },
            { k: 'Fills in', v: p.m3PerHour === null ? 'measuring' : p.hoursToFull === null ? 'not filling' : untilText(p.fullAt),
              s: p.m3PerHour === null
                ? (readings.length >= 2
                  ? 'rate restarts at each pickup — needs 2 colony looks since the last one'
                  : `${readings.length} of 2 readings`)
                : `${p.m3PerHour.toFixed(1)} m³/h measured` },
            { k: 'Program ends', v: p.extractorCount === 0 ? '—' : untilText(p.extractorExpiry),
              s: `${p.extractorCount} extractor(s)${p.expiredExtractors > 0 ? `, ${p.expiredExtractors} ended` : ''}` },
            { k: 'On the ground', v: p.value > 0 ? iskShort(p.value) : '—',
              s: `${p.factoryCount} factory/ies${p.idleFactories > 0 ? `, ${p.idleFactories} idle` : ''}` },
          ].map((t) => (
            <div key={t.k} style={{ background: 'rgba(255,255,255,.04)', borderRadius: 4, padding: '7px 9px' }}>
              <div style={{ fontSize: 11, opacity: .6 }}>{t.k}</div>
              <div style={{ fontSize: 17, fontVariantNumeric: 'tabular-nums' }}>{t.v}</div>
              <div style={{ fontSize: 10, opacity: .55 }}>{t.s}</div>
            </div>
          ))}
        </div>

        <button className="btn"
          title={`Set ${p.characterName}'s autopilot to ${p.systemName}. Only a RUNNING client accepts this — if that character is not logged in you get a message and nothing else happens.`}
          onClick={async () => {
            logUser('PI: waypoint set', { planet: p.planetName, system: p.systemName });
            setNote(null);
            try {
              // ATTEMPT IT rather than gate on the online flag (rule 4): the
              // advisory check lags, and the action is its own ground truth
              await setWaypoint(p.systemId, false, p.charId);
              setNote(`Waypoint set to ${p.systemName} on ${p.characterName}.`);
            } catch (e) {
              setNote(online.includes(p.charId)
                ? `Could not set the waypoint: ${e instanceof Error ? e.message : String(e)}`
                : `${p.characterName} does not appear to be logged in — EVE only accepts waypoints for a running client.`);
            }
          }}>
          ➤ Set destination on {p.characterName}
        </button>
        {note && <div className="hint" style={{ color: 'var(--good)' }}>{note}</div>}

        <h3 className="section-title" style={{ marginTop: 14 }}>
          <Tip tip="Avg /hour is the whole program's average from CCP's published yield formula (extraction starts high and decays), NOT the flat qty-per-cycle number — that base figure runs 1.2-2.4x low depending on cycle length (2.4x for 1h-cycle 2-day programs). The bar strip is the same per-cycle chart the in-game program window draws: glance at both once and tell Conductor if they disagree.">
            Extractors
          </Tip>
        </h3>
        {p.extractors.length === 0
          ? <p className="hint">No extractors on this planet.</p>
          : (
            <table className="data">
              <thead><tr><th>Pulls</th><th>Avg /hour</th><th>Program ends</th></tr></thead>
              <tbody>
                {p.extractors.map((e, i) => (
                  <tr key={i} style={e.active ? undefined : { opacity: 0.55 }}>
                    <td className="hub-name">
                      {e.productTypeId ? (getType(e.productTypeId)?.name ?? `#${e.productTypeId}`) : '(no program)'}
                    </td>
                    <td>{e.active ? perHourText(e.perHour) : <span className="dim">0 — ended</span>}</td>
                    <td className="dim">{e.expiry ? untilText(e.expiry) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        {p.extractors.filter((e) => e.active && e.qtyPerCycle && e.cycleTimeSec && e.installMs && e.expiry).map((e, i) => (
          <YieldBars key={`yb${i}`} e={e} />
        ))}

        <h3 className="section-title" style={{ marginTop: 14 }}>
          <Tip tip="What each factory line consumes and produces per hour when cycling back to back — exact numbers from the game's own schematic table (SDE via Fuzzwork, static data, cached). Burn above the extractor pull means the factories slowly drain the buffer and starve.">
            Factories
          </Tip>
        </h3>
        {p.factorySchematics.length === 0
          ? <p className="hint">{p.factoryCount === 0 ? 'No factories on this planet.' : 'Factories present but their schematics are not reported.'}</p>
          : !schem
            ? <p className="hint">loading the schematic table…</p>
            : (
              <table className="data">
                <thead><tr><th>Makes</th><th>×</th><th>Eats /hour</th><th>Makes /hour</th></tr></thead>
                <tbody>
                  {p.factorySchematics.map((f) => {
                    const sc = schem.get(f.schematicId);
                    if (!sc) return (
                      <tr key={f.schematicId}><td className="dim" colSpan={4}>unknown schematic #{f.schematicId}</td></tr>
                    );
                    const r = schematicPerHour(sc);
                    return (
                      <tr key={f.schematicId}>
                        <td className="hub-name">{sc.name}</td>
                        <td>{f.count}</td>
                        <td className="dim">
                          {r.inputs.map((i) => `${Math.round(i.perHour * f.count).toLocaleString()} ${getType(i.typeId)?.name ?? `#${i.typeId}`}`).join(' + ')}
                        </td>
                        <td>{r.output ? `${Math.round(r.output.perHour * f.count).toLocaleString()} ${getType(r.output.typeId)?.name ?? ''}` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}

        {p.balance && (
          <>
            <h3 className="section-title" style={{ marginTop: 14 }}>
              <Tip tip="Is the head-to-factory ratio right? Supply = active extractor programs' formula-average plus what upstream factories make (duty-scaled); burn = what every consumer eats running back to back (SDE, exact). Under ~85% fed the factories idle too much — shift heads toward the bottleneck or drop a factory. Types with no on-planet source are treated as hauled in and left out. Pure rate math over the planet's CONFIG, so it stays valid even while EVE's lazy colony state is stale.">
                Flow balance
              </Tip>
              <span className="dim" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
                factories fed ~{Math.round(Math.min(1, p.balance.fedFrac) * 100)}% of the time
              </span>
            </h3>
            <table className="data">
              <thead><tr><th>Input</th><th>Arrives /hour</th><th>Burn /hour</th><th>Fed</th></tr></thead>
              <tbody>
                {p.balance.flows.map((f) => {
                  const short = f.coverage < 0.85;
                  return (
                    <tr key={f.typeId} style={short ? { color: '#ffb46b' } : undefined}>
                      <td className="hub-name">{getType(f.typeId)?.name ?? `#${f.typeId}`}{short ? ' ◀ bottleneck' : ''}</td>
                      <td>{Math.round(f.supplyPerHour).toLocaleString()}</td>
                      <td>{Math.round(f.demandPerHour).toLocaleString()}</td>
                      <td style={{ fontVariantNumeric: 'tabular-nums' }}>{Math.round(f.coverage * 100)}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {p.balance.surplusTypeId !== null && p.balance.surplusPerHour > 0 && (
              <p className="hint">
                Heads pull {Math.round(p.balance.surplusPerHour).toLocaleString()}/h
                of {getType(p.balance.surplusTypeId)?.name ?? ''} beyond what the factories eat —
                surplus accumulates (fine if you export it, wasted once storage caps).
              </p>
            )}
          </>
        )}

        <h3 className="section-title" style={{ marginTop: 14 }}>On the planet</h3>
        {p.contents.length === 0
          ? <p className="hint">Nothing stored right now.</p>
          : (
            <table className="data">
              <thead><tr><th>Item</th><th>Units</th><th>m³</th><th>Value</th></tr></thead>
              <tbody>
                {p.contents.map((c) => (
                  <tr key={c.typeId}>
                    <td className="hub-name">{c.name}</td>
                    <td>{int(c.amount)}</td>
                    <td className="dim">{Math.round(c.m3).toLocaleString()}</td>
                    <td>{c.value > 0 ? isk(c.value) : <span className="dim">no Jita price</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

        <h3 className="section-title" style={{ marginTop: 14 }}>
          <Tip tip="Readings taken from EVE. The fill rate is the difference between them — this app measures what your planet ACTUALLY did rather than predicting from an extractor decay curve it cannot verify. EVE serves planet data on a 10-minute cache, so readings that would be identical are discarded rather than diluting the rate.">
            Readings
          </Tip>
        </h3>
        {readings.length === 0
          ? <p className="hint">None yet.</p>
          : (
            <table className="data">
              <thead><tr><th>When</th><th>Stored m³</th><th>Value</th></tr></thead>
              <tbody>
                {[...readings].reverse().slice(0, 8).map((r, i) => (
                  <tr key={`${r.t}-${i}`}>
                    <td className="dim">{new Date(r.t).toLocaleString()}</td>
                    <td>{Math.round(r.usedM3).toLocaleString()}</td>
                    <td className="dim">{r.value > 0 ? iskShort(r.value) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// HORIZON — the one-glance answer to "when do I log in, and as who": every
// planet with a deadline inside the window gets a row on a shared time
// axis. ■ = storage fills · ▲ = extractor program ends. Overdue pins to
// the left edge in red.
// ---------------------------------------------------------------------------

const SEV_COLOR = (msLeft: number): string =>
  msLeft <= 0 ? '#ff4d4d' : msLeft <= 12 * 3_600_000 ? '#ff6a5b' : msLeft <= 24 * 3_600_000 ? '#ffb347' : '#4da3ff';

/** header tile: one number that decides whether to log in */
function StatTile({ big, sub, tone }: { big: string; sub: string; tone?: string }) {
  return (
    <div style={{
      border: '1px solid var(--grid)', borderRadius: 6, padding: '8px 14px',
      minWidth: 120, background: 'rgba(128,128,128,.04)',
    }}>
      <div style={{ fontSize: 22, fontWeight: 700, color: tone ?? 'var(--ink)', lineHeight: 1.1 }}>{big}</div>
      <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function Horizon({ planets, hours, onOpen }: {
  planets: PlanetState[]; hours: number; onOpen: (key: string) => void;
}) {
  const [ref, W] = useElementWidth(420, 960);
  const now = Date.now();
  const span = hours * 3_600_000;
  const rows = planets
    .map((p) => {
      const evs: { t: number; kind: 'fill' | 'program' }[] = [];
      if (p.fullAt !== null && p.fullAt <= now + span) evs.push({ t: p.fullAt, kind: 'fill' });
      if (p.capM3 > 0 && p.fullFrac >= 0.999) evs.push({ t: now, kind: 'fill' }); // already full
      if (p.extractorExpiry !== null && p.extractorExpiry <= now + span) evs.push({ t: p.extractorExpiry, kind: 'program' });
      return { p, evs, first: Math.min(...evs.map((e) => e.t), Infinity) };
    })
    .filter((r) => r.evs.length > 0)
    .sort((a, b) => a.first - b.first);
  // PAD_R leaves room for the scrollbar and the last axis label
  const PAD_L = 210; const PAD_R = 40; const ROW = 22; const AXIS = 26;
  const H = AXIS + rows.length * ROW + 8;
  const xOf = (t: number) => PAD_L + Math.max(0, Math.min(1, (t - now) / span)) * (W - PAD_L - PAD_R);
  if (rows.length === 0) {
    return (
      <div className="hint">
        Nothing hits a deadline in the next {hours}h — no storage fills, no program ends. The
        tiles below still show everything.
      </div>
    );
  }
  return (
    // height scales with the window: a fixed cap left a scrollbar inside a
    // half-empty maximized screen. Everything above the horizon (header,
    // tiles, chips) is ~400px; give the rows the rest, never less than 300.
    <div ref={ref} style={{ maxHeight: 'max(300px, calc(100vh - 400px))', overflowY: 'auto' }}>
      <svg width={W} height={H} role="img" aria-label={`planet deadlines over the next ${hours} hours`}>
        {[0, 12, 24, 36, 48, 60, 72].filter((h) => h <= hours).map((h) => (
          <g key={h}>
            <line x1={xOf(now + h * 3_600_000)} x2={xOf(now + h * 3_600_000)} y1={AXIS - 8} y2={H - 4}
              stroke="var(--grid)" strokeWidth="1" opacity={h === 0 ? 0.9 : 0.35} />
            <text x={xOf(now + h * 3_600_000) + 3} y={AXIS - 12} className="sim-tick" style={{ fontSize: 10.5 }}>
              {h === 0 ? 'now' : `+${h}h`}
            </text>
          </g>
        ))}
        {rows.map(({ p, evs }, i) => {
          const y = AXIS + i * ROW + ROW / 2;
          const first = Math.min(...evs.map((e) => e.t));
          return (
            <g key={planetKey(p.charId, p.planetId)} style={{ cursor: 'pointer' }}
              onClick={() => onOpen(planetKey(p.charId, p.planetId))}>
              <rect x={0} y={y - ROW / 2} width={W} height={ROW} fill={i % 2 === 0 ? 'rgba(128,128,128,.05)' : 'transparent'} />
              <image href={`https://images.evetech.net/characters/${p.charId}/portrait?size=32`}
                x={4} y={y - 8} width={16} height={16} />
              <text x={26} y={y + 4} className="sim-tick" style={{ fontSize: 11.5, fill: 'var(--ink-2)' }}>
                {p.planetName.length > 26 ? `${p.planetName.slice(0, 25)}…` : p.planetName}
              </text>
              <line x1={PAD_L} x2={xOf(first)} y1={y} y2={y}
                stroke={SEV_COLOR(first - now)} strokeWidth="1.4" opacity="0.55" />
              {evs.map((e, j) => (
                e.kind === 'fill'
                  ? <rect key={j} x={xOf(e.t) - 4} y={y - 4} width={8} height={8}
                      fill={SEV_COLOR(e.t - now)}>
                      <title>{`${p.planetName} (${p.characterName}) — storage ${e.t <= now ? 'is FULL — output being discarded' : `fills ${untilText(e.t)} from now`}`}</title>
                    </rect>
                  : <polygon key={j} points={`${xOf(e.t) - 5},${y + 4} ${xOf(e.t) + 5},${y + 4} ${xOf(e.t)},${y - 5}`}
                      fill="#c98500">
                      <title>{`${p.planetName} (${p.characterName}) — extractor program ${e.t <= now ? 'has ENDED — restart it' : `ends ${untilText(e.t)} from now`}`}</title>
                    </polygon>
              ))}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------

export default function PiModule() {
  const characters = useAuth((s) => s.characters);
  const [, tick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const [onlyProblems, setOnlyProblems] = useState(false);
  // empty set = show everyone; chips toggle characters in and out
  const [selChars, setSelChars] = useState<Set<number>>(new Set());
  const fresh = useFreshness((s) => s.sources['pi']);
  const alertsPi = useApp((s) => s.alerts.pi);
  const setAlerts = useApp((s) => s.setAlerts);
  const th = { ...DEFAULT_PI_THRESHOLDS, ...(alertsPi ?? {}) };
  const writePi = (patch: Partial<typeof DEFAULT_PI_THRESHOLDS> & { enabled?: boolean }) =>
    setAlerts({ pi: { enabled: alertsPi?.enabled ?? true, ...th, ...patch } });
  // the SDE schematic table (tiny, static, cached forever) — factory burn
  // rates render as soon as it lands
  const [schem, setSchem] = useState<Map<number, Schematic> | null>(null);
  useEffect(() => {
    let alive = true;
    void loadSchematics().then((m) => { if (alive) setSchem(m); }).catch(() => {});
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);

  const watched = piCharacters();
  const planets = piPlanets();
  const lastRun = piLastRun();
  const needRelogin = watched.filter((c) => !tokenHasScope(c.characterId, PI_SCOPE));

  /** ONE flat grid, worst first — with 8+ characters the per-character
   * sections meant scrolling past 30 fine planets to find the one on fire.
   * The portrait on each card says whose it is; the chips filter by who. */
  const shown = useMemo(() => {
    let list = onlyProblems ? planets.filter((p) => p.rank <= 6) : planets;
    if (selChars.size > 0) list = list.filter((p) => selChars.has(p.charId));
    return [...list].sort((a, b) =>
      a.rank - b.rank
      || (a.fullAt ?? Infinity) - (b.fullAt ?? Infinity)
      || b.value - a.value);
  }, [planets, onlyProblems, selChars]);

  /** planets the horizon and tiles cover — chip-filtered but NOT problem-
   * filtered, so "only problems" never hides an upcoming deadline */
  const horizonPlanets = useMemo(
    () => (selChars.size > 0 ? planets.filter((p) => selChars.has(p.charId)) : planets),
    [planets, selChars],
  );

  const openPlanet = open ? planets.find((p) => planetKey(p.charId, p.planetId) === open) ?? null : null;

  if (characters.length === 0) {
    return (
      <div className="panel" style={{ margin: 24 }}>
        <h2>Planetary Industry</h2>
        <p className="hint">Log a character in first (Settings → EVE login).</p>
      </div>
    );
  }

  // PI is opt-in per character — logged-in characters that are not ticked
  // are INVISIBLE here, which the owner (and every corp mate after him) read as
  // "my planets are missing". Name them, with a one-click watch.
  const unwatched = characters.filter((c) => c.piRole !== true);
  const watchBtn = (c: (typeof characters)[number]) => (
    <button key={c.characterId} className="btn mini"
      title={`Start watching ${c.characterName}'s planets. Their token needs the planet scope — a re-login prompt appears above if it is missing.`}
      onClick={() => {
        logUser('PI: watch character', { name: c.characterName });
        useAuth.getState().setCharacterData(c.characterId, { piRole: true });
      }}>
      + {c.characterName}
    </button>
  );

  if (watched.length === 0) {
    return (
      <div className="panel" style={{ margin: 24, maxWidth: 640 }}>
        <h2>Planetary Industry</h2>
        <p className="hint">
          No characters watched yet — PI is an opt-in tick per character, independent of their
          trading duty, so a hub trader can run planets too. Watch one now:
        </p>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
          {unwatched.map(watchBtn)}
        </div>
        <p className="hint" style={{ marginTop: 10 }}>
          A character missing from this list is not logged into Conductor yet — add them in
          <b> Settings → EVE login</b> first. Conductor can only read planets with that
          character's own EVE login; running PI in game is not enough on its own.
        </p>
      </div>
    );
  }

  const urgent = planets.filter((p) => p.rank <= 2);
  const totalValue = planets.reduce((n, p) => n + p.value, 0);
  // the single next thing that will start costing money, and who to log in as
  const nextDeadline = planets
    .flatMap((p) => [
      ...(p.fullAt !== null && p.fullAt > Date.now() ? [{ t: p.fullAt, p, what: 'storage fills' }] : []),
      ...(p.extractorExpiry !== null && p.extractorExpiry > Date.now() ? [{ t: p.extractorExpiry, p, what: 'program ends' }] : []),
    ])
    .sort((a, b) => a.t - b.t)[0] ?? null;
  // FULL character names (user: the short labels collided — two groups both
  // read "BOBBY'S" and he couldn't tell which was which)
  const nameOf = (id: number): string => {
    const c = characters.find((x) => x.characterId === id);
    return c ? c.characterName : `#${id}`;
  };

  return (
    // .content (the parent) provides padding + scrolling
    <div>
      <div className="panel" style={{ margin: 0, marginBottom: 12 }}>
        <h2 style={{ marginBottom: 4 }}>
          <Tip tip="Every planet your PI characters own, grouped by character and ranked by what it is COSTING you. EVE gives no warning when a planet's storage fills — the extractors keep running and their output is discarded — so the coloured cards are where the money is going.">
            Planetary Industry
          </Tip>
          <span className="sub">
            {fresh?.nextAt ? `next check ${countdown(fresh.nextAt)}` : ''}
          </span>
        </h2>

        {needRelogin.length > 0 && (
          <div className="form-error" style={{ marginBottom: 8 }}>
            ⚠ {needRelogin.map((c) => c.characterName).join(', ')} logged in before PI support
            existed, so their token carries no planet scope. Log them out and back in (Settings →
            EVE login) — until then their planets cannot be read at all.
          </div>
        )}

        {/* the four numbers that decide whether to log in at all */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', margin: '10px 0' }}>
          <StatTile big={String(planets.length)} sub={`planets · ${watched.length} character(s)`} />
          <StatTile big={String(urgent.length)}
            sub={urgent.length > 0 ? 'need you NOW' : 'nothing urgent'}
            tone={urgent.length > 0 ? '#ff8a8a' : '#6fbf95'} />
          <StatTile
            big={nextDeadline ? untilText(nextDeadline.t) : '—'}
            sub={nextDeadline
              ? `${nextDeadline.what} · ${nextDeadline.p.planetName} (${nameOf(nextDeadline.p.charId)})`
              : 'no deadline in sight'}
            tone={nextDeadline ? SEV_COLOR(nextDeadline.t - Date.now()) : undefined} />
          <StatTile big={iskShort(totalValue)} sub="ISK sitting on the ground" />
        </div>

        {/* character chips — filter the horizon AND the grid to one login */}
        {watched.length > 1 && (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {watched.map((c) => {
              const mine = planets.filter((p) => p.charId === c.characterId);
              const bad = mine.filter((p) => p.rank <= 2).length;
              const on = selChars.has(c.characterId);
              return (
                <button key={c.characterId}
                  onClick={() => setSelChars((prev) => {
                    const next = new Set(prev);
                    if (next.has(c.characterId)) next.delete(c.characterId); else next.add(c.characterId);
                    return next;
                  })}
                  title={on ? 'click to stop filtering by this character' : `show only ${c.characterName}'s planets`}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 6, padding: '3px 10px 3px 4px',
                    borderRadius: 14, cursor: 'pointer', fontSize: 12,
                    border: `1px solid ${on ? 'var(--accent, #d8b25c)' : 'var(--grid)'}`,
                    background: on ? 'rgba(216,178,92,.12)' : 'transparent',
                    color: 'var(--ink-2)', opacity: selChars.size > 0 && !on ? 0.55 : 1,
                  }}>
                  <img src={`https://images.evetech.net/characters/${c.characterId}/portrait?size=32`}
                    width={20} height={20} style={{ borderRadius: '50%' }} alt=""
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  {c.characterName}
                  <span className="dim">{mine.length}</span>
                  {bad > 0 && <b style={{ color: '#ff8a8a' }}>{bad}!</b>}
                </button>
              );
            })}
            {selChars.size > 0 && (
              <button onClick={() => setSelChars(new Set())}
                style={{
                  fontSize: 12, cursor: 'pointer', background: 'none', border: 'none',
                  color: 'var(--ink-2)', textDecoration: 'underline', padding: '3px 6px',
                }}>show all</button>
            )}
          </div>
        )}

        {unwatched.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 8, fontSize: 12 }}>
            <span className="dim">
              logged in, not watched ({unwatched.length}) — their planets stay invisible until ticked:
            </span>
            {unwatched.map(watchBtn)}
            <span className="dim">read at the next check, or hit ⟳ Refresh</span>
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>
            <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} />
            only show planets needing something
          </label>
          {lastRun > 0 && <span className="dim" style={{ fontSize: 11 }}>read {new Date(lastRun).toLocaleTimeString()}</span>}
        </div>

        {/* LAST-KNOWN state renders instantly across restarts (v0.175). If
            the newest read is older than two collector intervals — the app
            just started, or the PC was off — say so instead of pretending
            it is live. */}
        {lastRun > 0 && Date.now() - lastRun > 2 * PI_INTERVAL_MS && (
          <div className="hint" style={{ color: '#e0a13a' }}>
            Showing the last known state from {new Date(lastRun).toLocaleString()} — the collector
            refreshes every {Math.round(PI_INTERVAL_MS / 60_000)} min and this page updates the
            moment it lands. Extractors kept running meanwhile, so real fill is HIGHER than shown.
          </div>
        )}

        {lastRun === 0 && planets.length === 0 && (
          <p className="hint">Reading planets…</p>
        )}
        {lastRun > 0 && planets.length === 0 && needRelogin.length === 0 && (
          <p className="hint">No planets found on the watched characters.</p>
        )}
      </div>

      {/* WHEN things happen, on one shared clock — the fleet's calendar */}
      {planets.length > 0 && (
        <div className="panel" style={{ margin: 0, marginBottom: 12 }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>
            Next 72 hours
            {' '}<InfoDot id="pi.horizon" />
            <span className="dim" style={{ fontWeight: 400, marginLeft: 8, fontSize: 12 }}>
              ■ storage fills · ▲ extractor program ends · click a row to open the planet
            </span>
          </h3>
          <Horizon planets={horizonPlanets} hours={72}
            onOpen={(k) => setOpen(k)} />
        </div>
      )}

      {/* one flat worst-first grid — the portrait says whose planet it is */}
      {shown.length > 0 && (
        <div className="panel" style={{ margin: 0, marginBottom: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              planets — worst first
            </span>
            <InfoDot id="pi.grid" />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            {shown.map((p) => (
              <PlanetCard key={planetKey(p.charId, p.planetId)} p={p} schem={schem}
                onOpen={() => setOpen(planetKey(p.charId, p.planetId))} />
            ))}
          </div>
          {shown.length < planets.length && (
            <div className="hint" style={{ marginTop: 8 }}>
              {planets.length - shown.length} planet(s) hidden by the filters above.
            </div>
          )}
        </div>
      )}
      {shown.length === 0 && planets.length > 0 && (
        <div className="panel hint" style={{ margin: 0, marginBottom: 12 }}>
          Every planet is filtered out — untick “only show planets needing something” or clear
          the character chips.
        </div>
      )}

      {/* thresholds live HERE, next to the cards they colour — not buried in
          settings. They drive the desktop/phone/overlay alerts too. */}
      <details className="panel" style={{ margin: 0, marginBottom: 12 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13 }}>
          Alert thresholds
          <span className="dim" style={{ marginLeft: 8, fontSize: 11.5 }}>
            when a planet counts as “needing you” — drives the colours here and the alerts
          </span>
        </summary>
        <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', marginTop: 10, fontSize: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <input type="checkbox" checked={alertsPi?.enabled ?? true}
              onChange={(e) => writePi({ enabled: e.target.checked })} />
            PI alerts on
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            warn when storage will fill within
            <input type="number" min={1} max={168} value={th.fullWarnHours}
              onChange={(e) => writePi({ fullWarnHours: Math.max(1, Number(e.target.value) || 1) })}
              style={{ width: 52 }} /> h
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            or is over
            <input type="number" min={10} max={100} value={Math.round(th.fullWarnFrac * 100)}
              onChange={(e) => writePi({ fullWarnFrac: Math.min(1, Math.max(0.1, (Number(e.target.value) || 85) / 100)) })}
              style={{ width: 52 }} /> % full
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            warn when a program ends within
            <input type="number" min={1} max={168} value={th.expiryWarnHours}
              onChange={(e) => writePi({ expiryWarnHours: Math.max(1, Number(e.target.value) || 1) })}
              style={{ width: 52 }} /> h
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            factory idle after
            <input type="number" min={1} max={72} value={th.factoryIdleHours}
              onChange={(e) => writePi({ factoryIdleHours: Math.max(1, Number(e.target.value) || 1) })}
              style={{ width: 52 }} /> h without input
          </label>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>
          The program-end warning is additionally capped at a quarter of the program’s own
          length, so 2-day cycles warn at ~12h instead of yelling for half the cycle. The
          multibox-overlay 🪐 box is switched on in the overlay’s ⚙ settings.
        </div>
      </details>

      <div className="fitlib-cache">
        ⏱ EVE publishes planet data on a <b>10-minute cache</b>, so this is at most ~11 minutes
        behind and asking more often returns the same answer. Fill rates are
        <b> measured from consecutive readings</b>, never predicted from a decay curve — which is
        why a planet says “measuring…” until EVE has reported it changed twice.
      </div>

      {openPlanet && <PlanetDetail p={openPlanet} schem={schem} onClose={() => setOpen(null)} />}
    </div>
  );
}
