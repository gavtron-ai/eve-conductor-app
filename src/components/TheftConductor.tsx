// EVE THEFT CONDUCTOR — what can be robbed near you, and when.
//   · Skyhooks: CCP's own public raidable feed (theft windows are FACTS)
//   · ESS: no ESI route exists, so this lists WHERE one is (sov nullsec in
//     range) and never pretends to know what's in the bank.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../lib/store';
import { suggestSystems, regionName, reachFrom, getSystem, findSystem, systemsWithin, pathTo } from '../lib/mapdata';
import { setWaypoint } from '../lib/esiChar';
import {
  fetchRaidableSkyhooks, fetchSovClaims, fetchSystemActivity, fetchSystemJumps, fetchIncursions, rankSkyhookTargets,
  essSystemsNear, parseSystemList, planetInfo,
  type RaidableSkyhook, type SovClaim, type SkyhookTarget, type SystemActivity, type EssSystem,
  type PlanetInfo, type IncursionMark,
} from '../lib/theft';
import {
  fetchStorms, stormExposure, STORM_EFFECTS, STORM_TRACK_URL,
  type StormFeed, type StormMark,
} from '../lib/storms';
import {
  raidHistory, markRaidedByMe, raidVerdict, emptyStats, bankEstimate,
  bankCycles, barFillPct, lastEmptiedMs, applyBarReading,
  type RaidStats, type BankEstimate,
} from '../lib/raidWatch';
import { resolveNames } from '../lib/battleNarrative';
import { fetchRouteKills, type RouteSystemKills } from '../lib/routeIntel';
import { useSort } from '../lib/useSort';
import Tip from './Tip';
import { InfoDot } from './Help';

const fmtIsk = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}b`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}m`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}k`;
  return String(Math.round(n));
};

const ROUTE_RANGES: { s: number; l: string }[] = [
  { s: 3600, l: '1h' }, { s: 21600, l: '6h' }, { s: 86400, l: '24h' }, { s: 259200, l: '3d' },
];

/** hot/cold rating from the age of a system's most recent kill */
function killAge(ms: number | null): { txt: string; icon: string; cls: string } {
  if (ms == null) return { txt: '—', icon: '', cls: 'dim' };
  const mins = Math.max(0, Math.round((Date.now() - ms) / 60_000));
  const rel = mins < 60 ? `${mins}m ago` : mins < 1_440 ? `${Math.round(mins / 60)}h ago` : `${(mins / 1_440).toFixed(1)}d ago`;
  if (mins < 30) return { txt: rel, icon: '🔴', cls: 'neg' };          // active — kill in last half hour
  if (mins < 120) return { txt: rel, icon: '🟠', cls: 'flag warn' };   // hot
  if (mins < 720) return { txt: rel, icon: '🟡', cls: '' };            // warm
  return { txt: rel, icon: '⚪', cls: 'dim' };                          // cold
}

/** the route gatecamp deep-dive: each system on the shortest route in, with its
 * recent player kills, how fresh they are (hot/cold), where they happened, and
 * whether a bubble was up. Click a system with kills to drill into its list. */
function RoutePopup({ target, data, loading, windowSecs, onRange, onClose, onSystem }: {
  target: string;
  data: RouteSystemKills[] | null;
  loading: boolean;
  windowSecs: number;
  onRange: (secs: number) => void;
  onClose: () => void;
  onSystem: (s: RouteSystemKills) => void;
}) {
  const last = data ? data.length - 1 : -1;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span>Route to {target} — kills</span>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {ROUTE_RANGES.map((r) => (
              <button key={r.s} className={`btn mini${windowSecs === r.s ? ' primary' : ''}`}
                onClick={() => onRange(r.s)} title={`show kills from the last ${r.l}`}>
                {r.l}
              </button>
            ))}
          </span>
        </h2>
        {loading && <div className="dim" style={{ padding: '10px 0' }}>reading zKillboard for each system on the shortest route…</div>}
        {!loading && data && (
          <table className="data">
            <thead>
              <tr><th>System</th><th>Ship kills</th><th>Last kill</th><th>Where</th><th>Bubble</th></tr>
            </thead>
            <tbody>
              {data.map((s, i) => {
                const age = killAge(s.lastKillMs);
                return (
                  <tr key={s.systemId}
                    style={{ cursor: s.shipKills > 0 ? 'pointer' : 'default' }}
                    title={s.shipKills > 0 ? 'click for the kill list' : 'no player kills here in this window'}
                    onClick={() => { if (s.shipKills > 0) onSystem(s); }}>
                    <td className="hub-name">
                      {i === 0 ? '🏠 ' : ''}{s.systemName}{i === last ? ' 🎯' : ''}
                    </td>
                    <td className={s.shipKills > 0 ? 'neg' : 'dim'}>{s.shipKills || '—'}</td>
                    <td className={age.cls}>{age.icon} {age.txt}</td>
                    <td className="dim">{s.where || '—'}</td>
                    <td>{s.bubble ? <span className="flag warn">🫧 bubble</span> : <span className="dim">—</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="dim" style={{ fontSize: 12, marginTop: 10 }}>
          🏠 = your origin, 🎯 = the skyhook. Player ship kills only (NPC rats excluded), from zKillboard over the
          chosen window. “Last kill” rates freshness — 🔴 &lt;30m (active), 🟠 &lt;2h, 🟡 &lt;12h, ⚪ older. “Where” is the
          gate a kill happened on; “Bubble” shows when an interdictor or HIC was on a kill (anchored bubbles leave no
          trace, so a blank isn’t proof). Click any system with kills for its clickable kill list.
        </p>
        <div className="modal-actions"><button className="btn" onClick={onClose}>close</button></div>
      </div>
    </div>
  );
}

/** second layer: one system's recent kills, each a link to zKillboard */
function SystemKillsPopup({ sys, onClose }: { sys: RouteSystemKills; onClose: () => void }) {
  return (
    <div className="overlay" onClick={onClose} style={{ zIndex: 200 }}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{sys.systemName} — {sys.shipKills} player kill{sys.shipKills === 1 ? '' : 's'} in this window</h2>
        <div style={{ maxHeight: 400, overflowY: 'auto' }}>
          {sys.kills.length === 0 ? (
            <div className="dim">Kills were counted but no detail loaded — open the system on zKillboard below.</div>
          ) : sys.kills.map((k) => (
            <div key={k.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(128,128,128,.18)' }}>
              <a href="#" onClick={(e) => { e.preventDefault(); window.open(`https://zkillboard.com/kill/${k.id}/`, '_blank'); }}
                title="open this killmail on zKillboard">
                {k.victimShip || `kill ${k.id}`}
              </a>
              {k.bubble && <span className="flag warn" title="an interdictor / HIC was on this kill — bubble almost certainly up">🫧</span>}
              <span className="dim" style={{ fontSize: 12 }}>{k.where}</span>
              <span className="dim" style={{ fontSize: 12, marginLeft: 'auto' }}>{fmtIsk(k.value)} ISK</span>
              {k.time && <span className="dim" style={{ fontSize: 11 }}>{new Date(k.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>}
            </div>
          ))}
        </div>
        {sys.kills.length > 0 && sys.kills.length < sys.shipKills && (
          <p className="dim" style={{ fontSize: 12 }}>Showing the {sys.kills.length} most recent of {sys.shipKills} — open the system on zKillboard for the rest.</p>
        )}
        <div className="modal-actions">
          <button className="btn" onClick={() => window.open(`https://zkillboard.com/system/${sys.systemId}/`, '_blank')}>open system on zKill</button>
          <button className="btn" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}

const fmtWait = (ms: number) => {
  const m = Math.round(ms / 60_000);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
};
const secClass = (s: number) => (s <= 0 ? 'neg' : s < 0.5 ? 'flag warn' : 'dim');

/** who holds the system — logo + NAME (ids helped nobody), clicking
 * through to zKillboard; NPC factions get the name only (no zkill page) */
function HeldBy({ claim, names }: {
  claim: SovClaim | undefined;
  names: Map<number, string>;
}) {
  if (!claim) return <span className="dim">—</span>;
  const id = claim.allianceId ?? claim.corporationId ?? claim.factionId ?? 0;
  if (!id) return <span className="dim">—</span>;
  const name = names.get(id) ?? String(id);
  if (claim.factionId && !claim.allianceId && !claim.corporationId) {
    return <span className="dim" title="NPC faction sovereignty">{name}</span>;
  }
  const kind = claim.allianceId ? 'alliance' : 'corporation';
  const logo = `https://images.evetech.net/${kind}s/${id}/logo?size=64`;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
      title={`open ${name} on zKillboard`}
      onClick={() => window.open(`https://zkillboard.com/${claim.allianceId ? 'alliance' : 'corporation'}/${id}/`, '_blank')}>
      <img src={logo} alt="" width={20} height={20} style={{ borderRadius: 3 }}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      {name}
    </span>
  );
}

/** everything known to affect a system, as clickable chips: player-reported
 * storms (strong ring solid, weak ring informational) and incursions */
interface FxState { systemName: string; incursion?: IncursionMark; storms?: StormMark[] }

function EffectChips({ systemId, systemName, stormMap, incursions, onOpen }: {
  systemId: number; systemName: string;
  stormMap: Map<number, StormMark[]>; incursions: Map<number, IncursionMark>;
  onOpen: (fx: FxState) => void;
}) {
  const marks = stormMap.get(systemId);
  const inc = incursions.get(systemId);
  if (!marks && !inc) return null;
  const open = (e: { stopPropagation(): void }) => {
    e.stopPropagation();
    onOpen({ systemName, incursion: inc, storms: marks });
  };
  return (
    <>
      {(marks ?? []).map((m) => {
        const strong = m.ring <= 1;
        const fx = STORM_EFFECTS[m.type];
        return (
          <span key={m.name} className={strong ? 'flag warn' : 'flag info'}
            style={{ marginLeft: 6, cursor: 'pointer', ...(strong ? {} : { opacity: 0.75 }) }}
            title={`${m.type} storm ${strong ? 'STRONG' : 'weak'} ring (${m.ring}j from ${m.centerName}) — ${fx.headline}. Player-reported (EvE-Scout Rescue) — click for the full effect sheet`}
            onClick={open}>
            {fx.icon} {m.type.toLowerCase()}{m.ring > 1 ? ` ~${m.ring}j` : ''}
          </span>
        );
      })}
      {inc && (
        <span className="flag warn" style={{ marginLeft: 6, cursor: 'pointer' }}
          title="Sansha incursion in this constellation — click for the system effects"
          onClick={open}>
          ☣ incursion{inc.staging ? ' · staging' : ''}
        </span>
      )}
    </>
  );
}

/** the effect sheet for one system: each storm with its documented effect
 * list and its provenance, the incursion facts, and the honest limit on
 * sov-applied effects (which no API publishes) */
function EffectsPopup({ fx, onClose }: { fx: FxState; onClose: () => void }) {
  const inc = fx.incursion;
  const inf = inc ? Math.round(inc.influence * 100) : 0;
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 620 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>System effects — {fx.systemName}</h2>
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          {(fx.storms ?? []).map((m) => {
            const strong = m.ring <= 1;
            const sheet = STORM_EFFECTS[m.type];
            return (
              <div key={m.name} style={{ marginBottom: 12 }}>
                <p style={{ margin: '4px 0' }}>
                  {sheet.icon} <b>{m.type} metaliminal storm</b> — this system is in the{' '}
                  <b>{strong ? 'STRONG' : 'weak'}</b> ring
                  ({m.ring === 0 ? 'the storm centre' : `${m.ring} jump${m.ring === 1 ? '' : 's'} from ${m.centerName}`}).
                  {' '}Strong = centre + 1 jump; weak = 2–3 jumps out.
                </p>
                <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
                  {(strong ? sheet.strong : sheet.weak).map((line) => (
                    <li key={line}>{line.startsWith('CLOAKING') ? <b>{line}</b> : line}</li>
                  ))}
                </ul>
                <p className="dim" style={{ margin: '4px 0', fontSize: 12 }}>
                  Player-reported: seen in <b>{m.centerName}</b>
                  {m.reportedMs !== null && <> at {new Date(m.reportedMs).toUTCString().replace(' GMT', ' EVE')}</>}
                  {m.hoursInSystem !== null && <> ({m.hoursInSystem}h in system)</>}
                  {m.reportedBy && <> by {m.reportedBy}</>} —{' '}
                  <a href="#" onClick={(e) => { e.preventDefault(); window.open(STORM_TRACK_URL, '_blank'); }}>
                    EvE-Scout Rescue Storm Track
                  </a>. Storms move ONE jump every 24–48 h, so an old report may
                  have drifted a jump or two — no API publishes storm positions,
                  scout reports are all anyone has.
                </p>
              </div>
            );
          })}
          {inc && (
            <div style={{ marginBottom: 12 }}>
              <p style={{ margin: '4px 0' }}>
                ☣ <b>Sansha incursion</b>, state <b>{inc.state}</b>
                {inc.staging && <> — this is the <b>staging system</b></>}.
                Constellation-wide effects while it lasts:
              </p>
              <ul style={{ margin: '6px 0', paddingLeft: 20 }}>
                <li><b>Cynosural field jamming</b> — no cynos anywhere in the constellation.</li>
                <li><b>Shield and armor resistances reduced</b> — 10% in Vanguard, 25% in Assault, 50% in HQ systems.</li>
                <li><b>Gun and drone damage reduced</b> — same 10/25/50% tiers.</li>
                <li><b>CONCORD bounties halved.</b></li>
              </ul>
              <p style={{ margin: '4px 0' }}>
                Current Sansha influence: <b>{inf}%</b> — the resistance and damage
                penalties scale with influence and are effectively cancelled at 0%.
                (Which tier a given system is depends on the sites it hosts, which
                ESI does not publish — the tiers above are the possible range.)
              </p>
            </div>
          )}
          <p className="dim" style={{ margin: '4px 0', fontSize: 12 }}>
            HONEST LIMIT — sov-applied effects (Tenebrex cyno jamming, Ansiblex
            gates, and the other sov-hub upgrades) are published by NO API: ESI's
            sovereignty feed lists only the bare hub structure, never what is
            installed in it. Check in game before committing.
          </p>
        </div>
        <div style={{ marginTop: 10, textAlign: 'right' }}>
          <button className="btn mini" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}

/** The IN-GAME silo bar, mirrored: how full the Surplus Bay reads when you warp
 * to the skyhook — a 0–100% fill that CANNOT exceed 100%. MEASURED (four bar
 * readings paired with witnessed raid dates, 2026-08-24): the bar is a
 * DAY-COUNTER — ~1 tic/day on its ~125-tic gauge, ~0.8%/day, ~4 months to full.
 * One theft window (~3.5 d) is only ~3% of it, so % ≈ days-since-raid and the
 * number IS the loot: 22% ≈ 27 days ≈ 8 windows' worth banked. EVERY piece is
 * fixed-width so the tracks line up row after row. */
function BankBar({ est }: { est: BankEstimate | null }) {
  const days = est ? (est.days < 1 ? `${Math.round(est.days * 24)} hours` : `${est.days.toFixed(1)} days`) : '';
  const pct = est ? barFillPct(est.days) : 0;            // clamped 0–100, like the in-game bar
  const cycles = est ? bankCycles(est.days) : 0;         // theft windows' worth banked
  const haulWord = est ? ` ≈${Math.round(Math.max(0, est.days))} tic${Math.round(est.days) === 1 ? '' : 's'} on the in-game bar, ≈${cycles.toFixed(1)} theft-windows' worth of surplus.` : '';
  const tip = !est
    ? 'No observation of this skyhook yet — fill starts once the watcher has seen one of its theft windows complete (or you mark a raid yourself).'
    : est.anchored
      ? `HIGH confidence, but a CEILING: a raid was observed ${days} ago (a raid takes the ENTIRE surplus bay, so it was KNOWN EMPTY then).${haulWord} MEASURED calibration: ~1 tic/day, ~125 days to full. WHY A CEILING, not a fact: a stealth raid — linked near a window's end, finished after the timer — is INVISIBLE to the feed and would leave the real bar far lower than this (confirmed in the field: a "very full" estimate met a ~2% bar). A fly-by bar reading (the "bar" button) is the only settled truth and also teaches the tracker.`
      : `LOW confidence: never seen raided in ${days} of watching, so this is a FLOOR and a CEILING at once — at least this much accumulated IF no unseen raid happened, but a stealth raid (link finished after a window closed, invisible to the feed) could mean it is nearly empty.${haulWord} The striped fill marks the estimate. A fly-by bar reading settles it.`;
  return (
    <span title={tip} style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: 164, justifyContent: 'flex-start' }}>
      <span style={{
        display: 'inline-block', width: 64, height: 11, borderRadius: 3, flex: 'none',
        background: 'rgba(128,128,128,.16)', border: '1px solid rgba(128,128,128,.4)',
        overflow: 'hidden',
      }}>
        {est && (
          <span style={{
            display: 'block', height: '100%', width: `${pct}%`,
            background: est.anchored
              ? '#4da3ff'
              : 'repeating-linear-gradient(-45deg, rgba(77,163,255,.75) 0 4px, rgba(77,163,255,.3) 4px 8px)',
          }} />
        )}
      </span>
      <b style={{ display: 'inline-block', width: 38, fontSize: 13, textAlign: 'right' }}
        className={est ? '' : 'dim'}>
        {est ? `${pct}%` : '—'}
      </b>
      {est ? (
        <span className={est.anchored ? 'flag good' : 'flag info'}
          style={{ display: 'inline-block', width: 34, fontSize: 11, textAlign: 'center', flex: 'none' }}>
          {est.anchored ? 'high' : 'low'}
        </span>
      ) : (
        <span style={{ display: 'inline-block', width: 34, flex: 'none' }} />
      )}
    </span>
  );
}

/** the "Last raided" cell — when the silo was last KNOWN empty (an observed raid
 * or your own mark), the age the capped bar can't show. An UNRESOLVED window
 * close since then means the bank may secretly be empty — flagged, never
 * hidden (v0.176). */
function RaidedCell({ s }: { s: RaidStats }) {
  const raid = s.lastRaidedMs ?? 0;
  const mine = s.lastMineMs ?? 0;
  const ms = Math.max(raid, mine);
  const unknownSince = (s.lastUnknownMs ?? 0) > ms;
  const unknownFlag = unknownSince ? (
    <span style={{ color: '#e0a13a', fontWeight: 700, marginLeft: 4 }}
      title={`A theft window closed ${new Date(s.lastUnknownMs!).toLocaleString()} without a clean verdict — a raider who linked near the end and finished after the timer would look exactly like this. The bank shown may actually be near empty. Fly-by fix: read the surplus bar and enter the filled tic count ("bar" button) — one reading settles it.`}>
      ?
    </span>
  ) : null;
  if (ms <= 0) {
    return (
      <span className="dim" style={{ fontSize: 12 }}
        title="Never seen emptied while watching, so there is no raid date to anchor to — the fill bar is a floor, not a measurement. Hit 'I raided it' when you take it and the clock starts here.">
        not seen{unknownFlag}
      </span>
    );
  }
  const d = new Date(ms);
  const date = d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  const mins = Math.round((Date.now() - ms) / 60_000);
  const rel = mins < 60 ? `${mins}m` : mins < 1_440 ? `${Math.round(mins / 60)}h` : `${(mins / 1_440).toFixed(1)}d`;
  const who = mine >= raid ? 'you marked it raided' : 'the watcher saw it emptied mid-window';
  return (
    <span title={`Last known empty: ${d.toLocaleString()} — ${who}. The fill bar has been refilling since; ${rel} ago.`}>
      {date} <span className="dim" style={{ fontSize: 11 }}>· {rel} ago</span>{unknownFlag}
    </span>
  );
}

/** "bar" — type the surplus bar's FILLED tic count from an in-game fly-by;
 * one reading dates the last emptying (~1 tic/day) and retro-resolves any
 * uncertain window closes for that skyhook */
function BarCheckButton({ systemId, planetId, onDone }: {
  systemId: number; planetId: number; onDone: () => void;
}) {
  const [openInput, setOpenInput] = useState(false);
  const [tics, setTics] = useState('');
  if (!openInput) {
    return (
      <button className="btn mini" title="Enter the surplus bar's filled tic count (right gauge, count the SOLID tics — ~1 tic/day of ~125). Resolves any uncertain window closes for this skyhook and feeds the calibration log."
        onClick={() => setOpenInput(true)}>
        bar
      </button>
    );
  }
  return (
    <span style={{ display: 'inline-flex', gap: 3, alignItems: 'center' }}>
      <input type="number" min={0} max={130} value={tics} placeholder="tics" autoFocus
        style={{ width: 52, fontSize: 12 }}
        onChange={(e) => setTics(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') setOpenInput(false); }} />
      <button className="btn mini" disabled={tics === '' || !Number.isFinite(Number(tics))}
        onClick={() => {
          void applyBarReading(systemId, planetId, Math.max(0, Math.min(130, Number(tics))))
            .then(() => { setOpenInput(false); setTics(''); onDone(); });
        }}>✓</button>
      <button className="btn mini" onClick={() => setOpenInput(false)}>✕</button>
    </span>
  );
}

type Col = 'system' | 'region' | 'sec' | 'jumps' | 'state' | 'planet' | 'banked' | 'raided' | 'ratting' | 'danger' | 'traffic';

/** the feed rolls forward constantly; auto-refresh cadence (also drives the
 * "next update in …" countdown next to the manual refresh button) */
const REFRESH_MS = 5 * 60_000;

/** `view` picks the tab: the skyhook raid table (the module's heart) or the
 * ESS list (weaker — no API exposes bank contents, so it's location-only) */
export default function TheftConductor({ view = 'skyhooks' }: { view?: 'skyhooks' | 'ess' }) {
  const [raw, setRaw] = useState<RaidableSkyhook[] | null>(null);
  const [claims, setClaims] = useState<Map<number, SovClaim>>(new Map());
  const [activity, setActivity] = useState<Map<number, SystemActivity>>(new Map());
  const [traffic, setTraffic] = useState<Map<number, number>>(new Map());
  const [incursions, setIncursions] = useState<Map<number, IncursionMark>>(new Map());
  const [stormFeed, setStormFeed] = useState<StormFeed | null>(null);
  const [fxPopup, setFxPopup] = useState<FxState | null>(null);
  const [routePopup, setRoutePopup] = useState<{ target: string; path: { id: number; name: string }[] } | null>(null);
  const [routeData, setRouteData] = useState<RouteSystemKills[] | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeWindowSecs, setRouteWindowSecs] = useState(86400); // default 24h — sporadic kills mean a short window reads empty
  const [sysKillPopup, setSysKillPopup] = useState<RouteSystemKills | null>(null);
  const [hist, setHist] = useState<{ byPlanet: Map<number, RaidStats>; bySystem: Map<number, RaidStats> }>(
    { byPlanet: new Map(), bySystem: new Map() },
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState(0);
  const [centerName, setCenterName] = useState('');
  const [maxJumps, setMaxJumps] = useState(15);
  const [importMsg, setImportMsg] = useState('');
  const mapped = useApp((s) => s.theftMapSystems);
  const setMapped = useApp((s) => s.setTheftMapSystems);
  const mapImportedAt = useApp((s) => s.theftMapImportedAt);
  const apertureUrl = (useApp((s) => s.settings.apertureUrl) ?? '').trim();
  const ignoreRadius = useApp((s) => s.theftIgnoreRadius);
  const setIgnoreRadius = useApp((s) => s.setTheftIgnoreRadius);
  const openNow = useApp((s) => s.theftOpenNow);
  const setOpenNow = useApp((s) => s.setTheftOpenNow);
  // the VALUE must be kept and fed to the memos below — depending on the
  // (referentially stable) setter froze every countdown for 5 minutes
  const [tickCount, setTick] = useState(0);
  // holder NAMES: one bisecting bulk lookup for every claim id in the data —
  // "alliance 99012042" told the owner nothing
  const [holderNames, setHolderNames] = useState<Map<number, string>>(new Map());
  // planet IDENTITY: "#0994" told him even less — in game it is "8OYE-Z IV",
  // and the TYPE is the loot (Lava = magmatic gas, Ice = superionic ice)
  const [planets, setPlanets] = useState<Map<number, PlanetInfo>>(new Map());
  useEffect(() => {
    if (!raw || raw.length === 0) return;
    let alive = true;
    void planetInfo(raw.map((s) => s.planetId)).then((m) => {
      if (alive) setPlanets(new Map(m));
    });
    return () => { alive = false; };
  }, [raw]);
  useEffect(() => {
    const ids = [...claims.values()]
      .map((c) => c.allianceId ?? c.corporationId ?? c.factionId ?? 0)
      .filter((x) => x > 0);
    if (ids.length === 0) return;
    let alive = true;
    void resolveNames(ids).then((m) => { if (alive) setHolderNames(m); });
    return () => { alive = false; };
  }, [claims]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [sk, cl, act, jmp, inc, h, st] = await Promise.all([
        fetchRaidableSkyhooks(), fetchSovClaims(), fetchSystemActivity().catch(() => new Map()),
        fetchSystemJumps().catch(() => new Map()), fetchIncursions().catch(() => new Map()),
        raidHistory(), fetchStorms(),
      ]);
      setRaw(sk);
      setClaims(cl);
      setActivity(act as Map<number, SystemActivity>);
      setTraffic(jmp as Map<number, number>);
      setIncursions(inc as Map<number, IncursionMark>);
      setHist(h);
      setStormFeed(st);
      setLastLoadedAt(Date.now());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!importMsg) return;
    const t = setTimeout(() => setImportMsg(''), 8000);
    return () => clearTimeout(t);
  }, [importMsg]);

  useEffect(() => {
    void load();
    // the feed rolls forward constantly; auto-refresh every REFRESH_MS and
    // re-render countdowns (window timers + "next update in") every 15s
    const t1 = setInterval(() => void load(), REFRESH_MS);
    const t2 = setInterval(() => setTick((x) => x + 1), 15_000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, []);

  // storm exposure: reported centres → every system within 3 jumps (strong =
  // 0–1, weak = 2–3), resolved against the bundled map. Unresolved report
  // names are surfaced, never dropped silently.
  const stormMap = useMemo(
    () => (stormFeed ? stormExposure(stormFeed.reports, (n) => findSystem(n)?.id, systemsWithin) : new Map<number, StormMark[]>()),
    [stormFeed],
  );
  const stormsUnresolved = useMemo(
    () => (stormFeed ? stormFeed.reports.filter((r) => !findSystem(r.system)).map((r) => `${r.name} @ ${r.system}`) : []),
    [stormFeed],
  );

  const center = centerName.trim() ? suggestSystems(centerName.trim(), 1)[0] : undefined;
  const mappedKey = mapped.join(',');

  // distance origin: an explicitly typed near-system wins; otherwise the
  // imported map's k-space systems — jumps then mean "from the NEAREST
  // known system on my map" and 'via' names it (user rule: wormhole-chain
  // shortcuts are NOT the question; gate distance from a known exit is)
  const reach = useMemo(() => {
    const centers = center ? [center.id] : mapped;
    if (centers.length === 0) return null;
    return reachFrom(centers, ignoreRadius ? Infinity : maxJumps);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center?.id, mappedKey, maxJumps, ignoreRadius]);
  /** distances are measured from the map (several origins) → show 'via' */
  const multiSource = !center && mapped.length > 0;

  // unfiltered first, so an empty FILTERED table can say exactly which
  // filter emptied it instead of looking broken
  const allTargets = useMemo(() => {
    if (!raw) return [];
    return rankSkyhookTargets(raw, claims, reach, Date.now(), ignoreRadius);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw, claims, reach, ignoreRadius, tickCount]);
  // the imported map is a DISTANCE ORIGIN only now — never a table filter.
  // "open now" scopes to windows raidable THIS MINUTE (and the overlay box).
  const targets = useMemo(
    () => (openNow ? allTargets.filter((t) => t.state === 'open') : allTargets),
    [allTargets, openNow],
  );

  // GATECAMP CHECK: walk the shortest gate route origin→skyhook and flag any
  // INTERMEDIATE system with recent ship/pod kills (ESI /universe/system_kills,
  // last hour) — the same live signal the gate-camp sites use, but for exactly
  // your route. Destination kills are the separate Danger column, so they're
  // excluded here (this warns about the JOURNEY). Keyed by target systemId.
  const routeCamp = useMemo(() => {
    const m = new Map<number, { name: string; kills: number }[]>();
    if (!reach) return m;
    for (const t of targets) {
      if (t.jumps === null || t.jumps === 0) continue; // no gate route, or already on it
      const path = pathTo(reach, t.systemId);
      const hot: { name: string; kills: number }[] = [];
      for (let i = 1; i < path.length - 1; i++) { // strictly between origin and target
        const a = activity.get(path[i]);
        const kills = a ? a.shipKills + a.podKills : 0;
        if (kills > 0) hot.push({ name: getSystem(path[i])?.name ?? `#${path[i]}`, kills });
      }
      if (hot.length > 0) m.set(t.systemId, hot);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reach, targets, activity]);

  async function loadRouteKills(path: { id: number; name: string }[], secs: number): Promise<void> {
    setRouteData(null);
    setRouteLoading(true);
    try {
      setRouteData(await fetchRouteKills(path, secs));
    } finally {
      setRouteLoading(false);
    }
  }

  /** open the route deep-dive: rebuild the shortest route in, then pull each
   * system's recent kills from zKillboard for the popup table */
  async function openRoutePopup(t: SkyhookTarget): Promise<void> {
    if (!reach) return;
    const path = pathTo(reach, t.systemId).map((id) => ({ id, name: getSystem(id)?.name ?? `#${id}` }));
    if (path.length === 0) return;
    setSysKillPopup(null);
    setRoutePopup({ target: t.systemName, path });
    void loadRouteKills(path, routeWindowSecs);
  }

  /** re-fetch the open route popup for a different time window */
  function changeRouteRange(secs: number): void {
    setRouteWindowSecs(secs);
    if (routePopup) void loadRouteKills(routePopup.path, secs);
  }

  const ess = useMemo(
    () =>
      reach || ignoreRadius
        ? essSystemsNear(reach, claims, activity, ignoreRadius)
        : [],
    [reach, claims, activity, ignoreRadius],
  );

  const essSort = useSort<EssSystem, 'system' | 'sec' | 'region' | 'jumps' | 'ratting' | 'danger'>(
    ess,
    {
      system: (e) => e.systemName,
      sec: (e) => e.sec,
      region: (e) => e.regionName,
      jumps: (e) => e.jumps,
      ratting: (e) => e.activity?.npcKills ?? 0,
      danger: (e) => (e.activity ? e.activity.shipKills + e.activity.podKills : 0),
    },
    { key: 'ratting', dir: 'desc' },
  );

  const { sorted, clickHeader, indicator } = useSort<SkyhookTarget, Col>(
    targets,
    {
      system: (t) => t.systemName,
      region: (t) => t.regionName,
      sec: (t) => t.sec,
      jumps: (t) => t.jumps,
      state: (t) => (t.state === 'open' ? t.closesInMs : 1e12 + t.opensInMs),
      planet: (t) => t.planetId,
      banked: (t) => bankEstimate(hist.byPlanet.get(t.planetId) ?? emptyStats(), Date.now())?.days ?? -1,
      raided: (t) => lastEmptiedMs(hist.byPlanet.get(t.planetId) ?? emptyStats()),
      ratting: (t) => activity.get(t.systemId)?.npcKills ?? 0,
      danger: (t) => {
        const a = activity.get(t.systemId);
        return a ? a.shipKills + a.podKills : 0;
      },
      traffic: (t) => traffic.get(t.systemId) ?? 0,
    },
    { key: 'jumps', dir: 'asc' }, // nearest first; unresolved (—) sink to the bottom
  );

  /** parse a clipboard string and, if it holds a k-space system list, scope
   * the tables to it. Returns true when it actually imported. `silent` (the
   * auto-watch) suppresses the "nothing here" messages — the OS clipboard is
   * full of non-map text and we only speak up on a real import. */
  function applySystemList(text: string, silent: boolean): boolean {
    if (!text.trim()) {
      if (!silent) setImportMsg('clipboard is empty — copy your Aperture system list first');
      return false;
    }
    const r = parseSystemList(text);
    if (r.systemIds.length === 0) {
      if (!silent) {
        setImportMsg(
          r.wormholes.length > 0
            ? `no k-space systems found (${r.wormholes.length} wormhole system(s) — W-space has no skyhooks or ESS)`
            : 'no EVE system names found in the clipboard',
        );
      }
      return false;
    }
    const prevCount = mapped.length;
    setMapped(r.systemIds);
    // NOTE: deliberately does NOT flip on "only my map" — the map's main job
    // is being the DISTANCE ORIGIN; scoping the tables stays a manual choice
    setImportMsg(
      `${silent ? '✓ auto-imported' : '✓ imported'} ${r.systemIds.length} system(s)` +
        (prevCount > 0 ? ` (replaced the previous ${prevCount})` : '') +
        (r.wormholes.length > 0 ? ` · ${r.wormholes.length} wormhole skipped` : ''),
    );
    return true;
  }

  const [pulling, setPulling] = useState(false);
  /** the whole flow, done for you: load YOUR logged-in Aperture map in a hidden
   * window, read its Systems table, import — no opening Aperture, no copy/paste.
   * `silent` (the auto-refresh on tab open) keeps quiet unless it actually
   * imports, so a not-logged-in session doesn't nag on every open. */
  async function pullFromAperture(silent = false): Promise<void> {
    const fn = window.appInfo?.aperture?.systems;
    if (!fn) { if (!silent) setImportMsg('this needs the desktop app'); return; }
    if (!apertureUrl) { if (!silent) setImportMsg('set your Aperture map URL in Settings → Your setup first'); return; }
    setPulling(true);
    if (!silent) setImportMsg('reading your Aperture map in the background…');
    try {
      const text = await fn(apertureUrl);
      if (!text || !text.trim()) {
        if (!silent) setImportMsg('couldn’t read the map — open Aperture once to sign in, then try again');
        return;
      }
      applySystemList(text, false);
    } catch {
      if (!silent) setImportMsg('couldn’t read the map — open Aperture once to sign in, then try again');
    } finally {
      setPulling(false);
    }
  }

  // AUTO-REFRESH FROM APERTURE on opening the Raid Targets tab: the map is the
  // distance origin, and a stale one means stale jumps. Fires once when the URL
  // is known; silent so a not-logged-in session doesn't nag on every open.
  const autoPulledRef = useRef(false);
  useEffect(() => {
    if (autoPulledRef.current) return;
    if (!window.appInfo?.aperture?.systems || !apertureUrl) return;
    autoPulledRef.current = true;
    void pullFromAperture(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apertureUrl]);

  const mapAge = (() => {
    if (!mapImportedAt) return null;
    const m = Math.round((Date.now() - mapImportedAt) / 60_000);
    return m < 60 ? `${m}m ago` : m < 1_440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1_440)}d ago`;
  })();
  const mappedNames = mapped.map((id) => getSystem(id)?.name ?? `#${id}`);

  return (
    <div className="theft">
      {view === 'skyhooks' && (
      <div className="panel">
        <h2>
          <Tip tip="Raidable skyhooks come from CCP's OWN public feed (/skyhooks/raidable) — the theft windows below are facts, not estimates. The list rolls forward constantly and is refreshed every 5 minutes.">Skyhook raid targets</Tip>
          {' '}<InfoDot id="theft.skyhooks" />
          <span className="sub">
            live theft windows · {raw ? `${raw.length} skyhook(s) in the feed` : 'loading…'}
            {' · '}
            {stormFeed === null ? (
              <span title="EvE-Scout Rescue's Storm Track page could not be fetched — storm chips are OFF this refresh, not 'no storms'. There is no ESI storm endpoint; the player-run tracker is all anyone has.">
                🌩 tracker unreachable
              </span>
            ) : (
              <span title={`Metaliminal storm positions from EvE-Scout Rescue's Storm Track (PLAYER-REPORTED — no ESI endpoint exists). Systems within 3 jumps of a reported centre get a chip: strong ring (centre+1j) solid, weak ring (2–3j) faint. Storms move 1 jump every 24–48 h, so old reports may have drifted.${stormsUnresolved.length > 0 ? `\n\nUnmapped report(s), shown nowhere: ${stormsUnresolved.join(', ')}` : ''}`}>
                🌩 {stormFeed.reports.length} storm{stormFeed.reports.length === 1 ? '' : 's'} tracked
                {stormsUnresolved.length > 0 ? ` (${stormsUnresolved.length} unmapped)` : ''}
              </span>
            )}
          </span>
          <span className="panel-filter" style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span className="dim" style={{ fontSize: 12 }}
              title="The feed refreshes itself on this cadence — the button is only for an early manual refresh.">
              {loading
                ? 'updating…'
                : lastLoadedAt === 0
                  ? 'auto-updates every 5 min'
                  : `auto-updates every 5 min · next in ${fmtWait(Math.max(0, lastLoadedAt + REFRESH_MS - Date.now()))}`}
            </span>
            <button className="btn" onClick={() => void load()} disabled={loading}>
              {loading ? 'refreshing…' : '⟳ refresh now'}
            </button>
          </span>
        </h2>
        {error && <div className="form-error">{error}</div>}
        <div className="finder-form">
          <label title="Optional single origin: STARGATE jumps are measured from this system (k-space only — a wormhole J-code has no gate distance). LEAVE BLANK with a map imported and distances are measured from the NEAREST k-space system on your map instead ('via' column names it).">
            <span>
              Near system
              {centerName.trim().length >= 2 && (
                center
                  ? <span className="dim"> → {center.name} · {regionName(center.regionId)}</span>
                  : <span className="flag warn" style={{ marginLeft: 6 }}
                      title={`Nothing in k-space starts with this — a wormhole J-code or typo. ${mapped.length > 0 ? 'Distances fall back to your imported map systems.' : 'No jump distances or radius filtering are applied while this doesn’t resolve.'}`}>
                      ✗ no k-space match
                    </span>
              )}
            </span>
            <input type="text" value={centerName} placeholder={mapped.length > 0 ? 'blank = from my map' : 'e.g. your staging'}
              style={{ width: 170 }} onChange={(e) => setCenterName(e.target.value)} />
          </label>
          <label title="Search radius in stargate jumps from the origin — the typed near-system, or (blank) the nearest system on your imported map. Drag to widen or tighten the hunt.">
            <span>Radius: {ignoreRadius ? 'off' : `${maxJumps} jump${maxJumps === 1 ? '' : 's'}${multiSource ? ' of my map' : ''}`}</span>
            <input type="range" min={1} max={30} value={maxJumps} style={{ width: 170 }}
              disabled={ignoreRadius}
              onChange={(e) => setMaxJumps(Number(e.target.value))} />
          </label>
          <label title="List every target regardless of distance — for living in a wormhole, where gate distance from k-space is meaningless. Jump counts still show when a near system is set and reachable by gates." style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={ignoreRadius}
              onChange={() => setIgnoreRadius(!ignoreRadius)} />
            <span>ignore radius</span>
          </label>
          <label title="Show only skyhooks whose theft window is open RIGHT NOW — hide everything opening later. Also scopes the overlay's raid-alert box to open windows only." style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={openNow}
              onChange={() => setOpenNow(!openNow)} />
            <span>open now only</span>
          </label>
          {window.appInfo?.aperture?.systems && (
            <button className="btn" onClick={() => void pullFromAperture()} disabled={pulling}
              title="Refresh the distance origin from YOUR logged-in Aperture map: loads it in a hidden background window (the same session the Aperture module uses), opens Map info → Systems, and imports the list — no opening Aperture, no copy, no paste. Runs automatically when you open this tab; click to refresh again. Needs you signed in to Aperture once (open the Aperture module and log in). Wormhole systems are skipped.">
              {pulling ? <span className="spin">⟳</span> : '⤓'} refresh from Aperture
            </button>
          )}
          {mapped.length > 0 && (
            <>
              <span className="dim" style={{ fontSize: 12, cursor: 'help' }}
                title={`Distance origin: the ${mapped.length} k-space system(s) below (imported ${mapAge ?? 'earlier'} — refreshed from Aperture when you open this tab):\n\n${mappedNames.join(', ')}`}>
                🗺 {mapped.length} systems · {mapAge ?? 'imported earlier'} (hover)
              </span>
              <button className="btn" title="Forget the imported map systems"
                onClick={() => { setMapped([]); setImportMsg(''); }}>
                ✕ clear map
              </button>
            </>
          )}
          {importMsg && <span className="dim" style={{ fontSize: 12 }}>{importMsg}</span>}
        </div>
        {raw !== null && sorted.length === 0 && (
          <div className="empty">
            No raidable skyhooks{!ignoreRadius && (center || multiSource) ? ` within ${maxJumps} jumps of ${center ? center.name : 'your map systems'}` : ''} right now — the feed rolls forward, so check back.
          </div>
        )}
        {sorted.length > 0 && (
          <table className="data">
            <thead>
              <tr>
                <th><Tip tip="Set an autopilot waypoint to this skyhook's system in the running EVE client. A ⚠ marks recent ship/pod kills on the SHORTEST ROUTE to it (a possible gatecamp between you and the target) — hover the button to see which systems.">Route</Tip></th>
                <th className="sortable" onClick={() => clickHeader('jumps')}><Tip tip="STARGATE jumps from your 'near system' — or, with none set, from the NEAREST k-space system on your imported map ('via' names which one). '—' = no origin resolved, or not gate-reachable from any origin. Sorted nearest-first by default.">Jumps</Tip>{indicator('jumps')}</th>
                <th className="sortable" onClick={() => clickHeader('planet')}><Tip tip="The planet the skyhook orbits, as it reads in game (system + numeral), with its class — skyhooks only exist on Lava (magmatic gas) and Ice (superionic ice) planets, so the class is the loot.">Planet</Tip>{indicator('planet')}</th>
                <th className="sortable" onClick={() => clickHeader('state')}><Tip tip="OPEN = the silo can be robbed RIGHT NOW (time left shown). Otherwise the countdown is until the window opens.">Window</Tip>{indicator('state')}</th>
                <th className="sortable" onClick={() => clickHeader('banked')}><Tip tip="How full the IN-GAME silo bar is — the Surplus Bay fill you see when you warp to the skyhook. MEASURED (4 bar readings paired with witnessed raids, 2026-08-24): the bar is a DAY-COUNTER — ~1 tic/day on its ~125-tic gauge, ~4 months to full — so % ≈ days since the silo was last emptied, and one theft window (~3.5d) ≈ 3%. Higher % = more loot, linearly. Confidence HIGH (solid) = watcher saw the emptying raid, so this should match the real bar tic-for-tic; LOW (striped) = never seen raided while watching, so it's a floor. Hover any bar for exact days/tics/windows-worth.">Banked</Tip>{indicator('banked')}</th>
                <th><Tip tip="MEASURED raid history for this exact skyhook: the app watches CCP's feed continuously, so a skyhook vanishing mid-window means someone emptied the silo, while one still listed when its window expires survived untouched. 🩸 = rivals farm it (usually empty when you arrive); 🕊 = nobody touches it (full silo). Needs 2+ completed windows.">Raid history</Tip></th>
                <th className="sortable" onClick={() => clickHeader('raided')}><Tip tip="When this silo was last KNOWN empty — an observed raid (watcher saw it vanish mid-window) or your own 'I raided it' mark. This is the age the 0–100% fill bar can't show: two full bars can hold very different amounts, and the older 'last raided' is the fatter surplus. 'not seen' = never observed empty, so the bar is a floor. Sort to bring the longest-untouched (fattest) silos together.">Last raided</Tip>{indicator('raided')}</th>
                <th className="sortable" onClick={() => clickHeader('sec')}>Sec{indicator('sec')}</th>
                <th className="sortable" onClick={() => clickHeader('system')}>System{indicator('system')}</th>
                <th className="sortable" onClick={() => clickHeader('region')}>Region{indicator('region')}</th>
                <th className="sortable" onClick={() => clickHeader('danger')}><Tip tip="Ship + pod kills in the system in the last hour — how likely someone shoots you during the robbery.">Danger/hr</Tip>{indicator('danger')}</th>
                <th className="sortable" onClick={() => clickHeader('traffic')}><Tip tip="Stargate ship jumps through the system in the last hour — witnesses AND competing thieves. 'Hit fast' skyhooks usually sit on busy routes: to win those you arrive AT window open.">Traffic/hr</Tip>{indicator('traffic')}</th>
                <th className="sortable" onClick={() => clickHeader('ratting')}><Tip tip="NPC kills in the system in the last hour — LOCALS ACTIVE IN SPACE. 'Usually survives' + ratting = probably defended; 'usually survives' + zero = probably just empty space and uncontested loot.">Ratting/hr</Tip>{indicator('ratting')}</th>
                <th><Tip tip="Sovereignty holder of the system, when claimed.">Held by</Tip></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.length > 300 && (
                <tr><td colSpan={15} className="dim">showing the first 300 of {sorted.length} — tighten the radius or filters to see the rest</td></tr>
              )}
              {sorted.slice(0, 300).map((t) => (
                <tr key={`${t.planetId}`}>
                  <td className="row-actions" style={{ whiteSpace: 'nowrap' }}>
                    {(() => {
                      const camp = routeCamp.get(t.systemId);
                      return (
                        <>
                          <button className="btn mini"
                            style={camp ? { color: '#ff8a5b', borderColor: '#ff8a5b' } : undefined}
                            title="Set an autopilot waypoint to this system in the running EVE client."
                            onClick={() => void setWaypoint(t.systemId).catch(() => {})}>
                            {camp ? '⚠ ' : ''}route
                          </button>
                          {camp && (
                            <button className="btn mini" style={{ color: '#ff8a5b', borderColor: '#ff8a5b' }}
                              title={`Recent kills on the shortest route in (${camp.length} hot system${camp.length === 1 ? '' : 's'}) — click for the system-by-system breakdown with gates, bubbles, and clickable kills.`}
                              onClick={() => void openRoutePopup(t)}>
                              ⓘ
                            </button>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td>
                    {t.jumps === null ? (
                      <span className="dim">—</span>
                    ) : (
                      <>
                        {t.jumps}
                        {multiSource && t.viaName && (
                          <span className="dim" style={{ fontSize: 12 }}>
                            {t.jumps === 0 ? ' · on map' : ` via ${t.viaName}`}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td>
                    {(() => {
                      const pl = planets.get(t.planetId);
                      if (!pl) return <span className="dim" title={`planet id ${t.planetId}`}>#{String(t.planetId).slice(-4)}</span>;
                      // the in-game label is "<system> <numeral>" — the row
                      // already names the system, so show the numeral
                      const numeral = pl.name.startsWith(t.systemName)
                        ? pl.name.slice(t.systemName.length).trim() : pl.name;
                      const loot = pl.type === 'Lava' ? 'skyhook harvests Magmatic Gas'
                        : pl.type === 'Ice' ? 'skyhook harvests Superionic Ice' : '';
                      return (
                        <span title={`${pl.name}${loot ? ` — ${loot}` : ''}`}>
                          {numeral}
                          {pl.type && (
                            <span className={pl.type === 'Lava' ? 'flag warn' : 'flag info'}
                              style={{ marginLeft: 6 }}>
                              {pl.type}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                  <td>
                    {t.state === 'open' ? (
                      <span className="flag warn" title={`Closes ${new Date(t.endMs).toUTCString()}`}>
                        🔓 open · {fmtWait(t.closesInMs)} left
                      </span>
                    ) : (
                      <span className={t.state === 'soon' ? 'flag info' : 'dim'}
                        title={`Opens ${new Date(t.startMs).toUTCString()} · closes ${new Date(t.endMs).toUTCString()}`}>
                        🕐 in {fmtWait(t.opensInMs)}
                      </span>
                    )}
                  </td>
                  <td>
                    <BankBar est={bankEstimate(hist.byPlanet.get(t.planetId) ?? emptyStats(), Date.now())} />
                  </td>
                  <td>
                    {(() => {
                      const st = hist.byPlanet.get(t.planetId) ?? emptyStats();
                      const v = raidVerdict(st);
                      return (
                        <>
                          {v ? <span className={v.cls} title={v.tip}>{v.txt}</span>
                             : <span className="dim" title="No completed window observed yet — the watcher records one every time a window ends.">—</span>}
                          {st.mine > 0 && (
                            <span className="flag info" style={{ marginLeft: 4 }}
                              title={`You marked this raided ${st.mine}×, last ${new Date(st.lastMineMs!).toLocaleString()}.`}>
                              ⚑ mine ×{st.mine}
                            </span>
                          )}
                        </>
                      );
                    })()}
                  </td>
                  <td style={{ whiteSpace: 'nowrap', fontSize: 12.5 }}>
                    <RaidedCell s={hist.byPlanet.get(t.planetId) ?? emptyStats()} />
                  </td>
                  <td className={secClass(t.sec)}>{t.sec.toFixed(1)}</td>
                  <td className="hub-name">
                    {t.systemName}
                    <EffectChips systemId={t.systemId} systemName={t.systemName}
                      stormMap={stormMap} incursions={incursions} onOpen={setFxPopup} />
                  </td>
                  <td className="dim">{t.regionName}</td>
                  <td className={(() => {
                    const a = activity.get(t.systemId);
                    return a && a.shipKills + a.podKills > 0 ? 'neg' : 'dim';
                  })()}
                    title={(() => {
                      const a = activity.get(t.systemId);
                      return a ? `${a.shipKills} ship + ${a.podKills} pod kills in the last hour` : 'no kills reported this hour';
                    })()}>
                    {(() => {
                      const a = activity.get(t.systemId);
                      return a ? a.shipKills + a.podKills : 0;
                    })()}
                  </td>
                  <td className="dim" title="stargate ship jumps through this system in the last hour">
                    {traffic.get(t.systemId) ?? 0}
                  </td>
                  <td className={(activity.get(t.systemId)?.npcKills ?? 0) >= 100 ? 'pos' : 'dim'}
                    title={(() => {
                      const a = activity.get(t.systemId);
                      return a ? `${a.npcKills} NPC kills in the last hour — locals are in space` : 'no ratting reported this hour';
                    })()}>
                    {activity.get(t.systemId)?.npcKills ?? 0}
                  </td>
                  <td className="dim">
                    <HeldBy claim={t.claim} names={holderNames} />
                  </td>
                  <td className="row-actions">
                    <button className="btn mini" title="Log that YOU raided this skyhook — kept in your history alongside the observed raids"
                      onClick={() => void markRaidedByMe(t.systemId, t.planetId).then(() => raidHistory().then(setHist))}>
                      ⚑ I raided it
                    </button>
                    <BarCheckButton systemId={t.systemId} planetId={t.planetId}
                      onDone={() => void raidHistory().then(setHist)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint">
          Skyhook theft windows are published by CCP itself — a silo can only be robbed inside its
          window, and ONLY currently-raidable (or about-to-be) skyhooks are in the feed at all: a
          quiet system is absent, not broken. Distances are stargate jumps from your typed “near
          system”, or — left blank with a map imported — from the NEAREST k-space system on your
          map, with “via” naming which one. Wormhole hops are never counted.
        </div>
      </div>
      )}

      {view === 'ess' && (
      <div className="panel">
        <h2>
          <Tip tip="ESS banks have NO ESI endpoint — nothing in the API exposes a bank's contents. This lists systems in range that HAVE an ESS: CCP puts one in every sovereign nullsec system EXCLUDING NPC-held ones (so no Venal/Stain/…, no Pochven/Jove). What's inside is only knowable in-system.">ESS systems in range</Tip>
          <span className="sub">where an ESS exists — contents are not knowable from outside</span>
        </h2>
        {!center && !ignoreRadius && mapped.length === 0 ? (
          <div className="empty">Set a “near system” above to list ESS systems within {maxJumps} jumps — or tick “ignore radius” to list them all.</div>
        ) : ess.length === 0 ? (
          <div className="empty">
            {ignoreRadius
              ? 'No sovereignty nullsec found.'
              : `No sovereignty nullsec within ${maxJumps} jumps of ${center ? center.name : 'your map systems'}.`}
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => essSort.clickHeader('system')}>System{essSort.indicator('system')}</th>
                <th className="sortable" onClick={() => essSort.clickHeader('sec')}>Sec{essSort.indicator('sec')}</th>
                <th className="sortable" onClick={() => essSort.clickHeader('region')}>Region{essSort.indicator('region')}</th>
                <th className="sortable" onClick={() => essSort.clickHeader('jumps')}><Tip tip="Stargate jumps from your 'near system' — or, with none set, from the NEAREST k-space system on your imported map ('via' names which one).">Jumps</Tip>{essSort.indicator('jumps')}</th>
                <th className="sortable" onClick={() => essSort.clickHeader('ratting')}><Tip tip="NPC kills in this system in the last hour (CCP's public hourly stats). Ratting is exactly what FILLS an ESS bank, so this is the best available proxy for a fat bank — the contents themselves are never exposed by ESI. Sorted busiest-first by default.">Ratting/hr</Tip>{essSort.indicator('ratting')}</th>
                <th className="sortable" onClick={() => essSort.clickHeader('danger')}><Tip tip="Ship + pod kills in the last hour — how likely someone shoots you while you rob the bank.">Danger/hr</Tip>{essSort.indicator('danger')}</th>
                <th><Tip tip="Your own logged ESS raids in this system (self-reported — ESI publishes nothing about ESS).">My raids</Tip></th>
                <th>Held by</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {essSort.sorted.length > 200 && (
                <tr><td colSpan={9} className="dim">showing the first 200 of {essSort.sorted.length} by the current sort — a quiet system missing here still has an ESS; narrow the radius, sort differently, or use “only my map” to find it</td></tr>
              )}
              {essSort.sorted.slice(0, 200).map((e) => (
                <tr key={e.systemId}>
                  <td className="hub-name">
                    {e.systemName}
                    <EffectChips systemId={e.systemId} systemName={e.systemName}
                      stormMap={stormMap} incursions={incursions} onOpen={setFxPopup} />
                  </td>
                  <td className={secClass(e.sec)}>{e.sec.toFixed(1)}</td>
                  <td className="dim">{e.regionName}</td>
                  <td>
                    {e.jumps === null ? (
                      <span className="dim">—</span>
                    ) : (
                      <>
                        {e.jumps}
                        {multiSource && e.viaName && (
                          <span className="dim" style={{ fontSize: 12 }}>
                            {e.jumps === 0 ? ' · on map' : ` via ${e.viaName}`}
                          </span>
                        )}
                      </>
                    )}
                  </td>
                  <td className={(e.activity?.npcKills ?? 0) >= 100 ? 'pos' : 'dim'}
                    title={e.activity ? `${e.activity.npcKills} NPC kills in the last hour` : 'no activity reported this hour'}>
                    {e.activity?.npcKills ?? 0}
                  </td>
                  <td className={(e.activity ? e.activity.shipKills + e.activity.podKills : 0) > 0 ? 'neg' : 'dim'}
                    title={e.activity ? `${e.activity.shipKills} ship + ${e.activity.podKills} pod kills in the last hour` : 'no kills reported this hour'}>
                    {e.activity ? e.activity.shipKills + e.activity.podKills : 0}
                  </td>
                  <td className="dim">
                    {(() => {
                      const st = hist.bySystem.get(e.systemId);
                      return st && st.mine > 0
                        ? <span className="flag info" title={`Last ${new Date(st.lastMineMs!).toLocaleString()}`}>⚑ ×{st.mine}</span>
                        : '—';
                    })()}
                  </td>
                  <td className="dim">
                    <HeldBy claim={e.claim} names={holderNames} />
                  </td>
                  <td className="row-actions">
                    <button className="btn mini" title="Set an autopilot waypoint to this system in the running EVE client"
                      onClick={() => void setWaypoint(e.systemId).catch(() => {})}>
                      route
                    </button>
                    <button className="btn mini" title="Log that you robbed this ESS — ESI publishes nothing about ESS, so this log is yours alone"
                      onClick={() => void markRaidedByMe(e.systemId, 0).then(() => raidHistory().then(setHist))}>
                      ⚑ I raided it
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <div className="hint">
          HONEST LIMIT: ESI publishes no ESS data — not bank balances, not who is farming them. So
          these are the systems where an ESS EXISTS (sov-capable nullsec — CCP excludes NPC-held
          null like Venal/Stain, and Pochven/Jove have none), ranked by the best legal proxy:
          NPC kills per hour, i.e. how hard the locals are ratting, which is exactly what fills the
          bank. Danger/hr is ship+pod kills in the same hour. Your own raids are logged by the
          ⚑ button — that column is self-reported, nothing else.
        </div>
      </div>
      )}
      {fxPopup && <EffectsPopup fx={fxPopup} onClose={() => setFxPopup(null)} />}
      {routePopup && (
        <RoutePopup target={routePopup.target} data={routeData} loading={routeLoading}
          windowSecs={routeWindowSecs} onRange={changeRouteRange}
          onClose={() => { setRoutePopup(null); setSysKillPopup(null); }}
          onSystem={setSysKillPopup} />
      )}
      {sysKillPopup && <SystemKillsPopup sys={sysKillPopup} onClose={() => setSysKillPopup(null)} />}
    </div>
  );
}
