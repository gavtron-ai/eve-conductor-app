// BATTLE REPORTS — the corp's recent fights, killboard-grade (v0.107.0).
//
// The last HISTORY_DAYS of corp fights as cards down the left, newest
// first; selecting one copies its br.evetools link and opens the full
// visual report beside it. Multi-system fights get their SAVED evetools
// report (the full-fight link) created on selection, the moment their
// ingest has the data — never up front for the whole history, which would
// spam their database. Cards are posters (ships, ISK, when, who, where —
// v0.204.1); every pilot or ship picture opens the shared pilot panel. The
// write-summary tool that used to sit at the bottom was removed in v0.204.1.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import {
  makeBattleReports, corporationOf, fetchFightData, fallbackFightData, createSavedBr, POSTER_LOGOS,
} from '../lib/battleReport';
import type { BattleReportResult, FightData } from '../lib/battleReport';
import { buildFightDigest } from '../lib/battleNarrative';
import type { FightDigest, LossRow, DmgLeader, OrgGroup } from '../lib/battleNarrative';
import { logUser } from '../lib/devlog';
import { PilotFitPanel, PANEL_CARD, TypeIconId, useTypeIcons, type PilotKillmail } from './PilotFitPanel';
import { fightWhen } from '../lib/fightSplit';
import { FightRoster, FightTimeline } from './BattleExtras';
import { iskShort } from '../lib/format';

/** EVE's public image CDN — ship icons, portraits, group logos */
const shipIcon = (typeId: number): string => `https://images.evetech.net/types/${typeId}/icon?size=64`;
const portrait = (charId: number): string => `https://images.evetech.net/characters/${charId}/portrait?size=64`;
const corpLogo = (corpId: number): string => `https://images.evetech.net/corporations/${corpId}/logo?size=64`;
const allyLogo = (allyId: number): string => `https://images.evetech.net/alliances/${allyId}/logo?size=64`;

/** every image opens its subject on zKillboard */
const zkKill = (id: number): string => `https://zkillboard.com/kill/${id}/`;
const zkCorp = (id: number): string => `https://zkillboard.com/corporation/${id}/`;
const zkAlly = (id: number): string => `https://zkillboard.com/alliance/${id}/`;

/** team accents, matched to the app's dark theme */
const TEAM_A = '#4da3ff';
const TEAM_B = '#ff5b5b';

interface Battle {
  report: BattleReportResult;
  /** filled lazily on first selection — the card only needs the report */
  fightData?: FightData;
  digest?: FightDigest;
  /** why there is no digest (analyze failed, no usable times, …) */
  digestNote?: string;
  /** the saved multi-system evetools BR was already created (or attempted
   * and found their ingest still empty — retried on next selection) */
  savedBrDone?: boolean;
}

/** survives module switches — reopening the tab must not refetch a history
 * that is already on screen; the ↻ button exists for that */
let cachedBattles: Battle[] | null = null;
let cachedSel = 0;

/**
 * THE FEED MUST NEVER GO BACKWARDS. zkill's API is eventually-consistent:
 * ten seconds after correctly returning the newest fight, a fresh app boot
 * was served an older snapshot and reported the PREVIOUS fight as current
 * (devlog, 2026-08-17 14:15). Killmail ids are chronological, so the
 * highest id ever seen is a high-water mark: a load below it retries once,
 * and if the feed is still behind, the list says so instead of presenting
 * an old fight as the latest.
 */
const HIGH_WATER_KEY = 'battle-report-newest-km';
const highWater = (): number => {
  const v = Number(localStorage.getItem(HIGH_WATER_KEY));
  return Number.isFinite(v) ? v : 0;
};

const hm = (iso: string): string => iso.slice(11, 16);
const day = (iso: string): string => iso.slice(0, 10);
const n = (c: number, word: string): string => `${c} ${word}${c === 1 ? '' : 's'}`;
/** "3 ships and 2 pods (1.2b)" with honest singulars */
const lostLine = (l: { ships: number; pods: number; isk: string }): string => {
  const bits: string[] = [];
  if (l.ships) bits.push(n(l.ships, 'ship'));
  if (l.pods) bits.push(n(l.pods, 'pod'));
  return bits.length > 0 ? `${bits.join(' and ')} (${l.isk})` : 'nothing';
};

/** the pilot panel opened from a ship picture (v0.203.2): a loss row's ship
 * (killId = that killmail — the exact fit) or the hull a damage leader flew */
export interface PilotView { pilotId: number; pilot: string; shipId: number; ship: string; killId: number | null }

export default function BattleReports() {
  useTypeIcons();
  const [pilotView, setPilotView] = useState<PilotView | null>(null);
  // the list's filters (v0.204.0): fights are split finely now, so a busy corp
  // lists many — show only the ones your own characters were in, and/or fold
  // away the single-killmail ones. Both remembered.
  const [onlyMine, setOnlyMine] = useState<boolean>(() => { try { return localStorage.getItem('etc-br-only-mine') === '1'; } catch { return false; } });
  const [hideSingles, setHideSingles] = useState<boolean>(() => { try { return localStorage.getItem('etc-br-hide-singles') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('etc-br-only-mine', onlyMine ? '1' : '0'); localStorage.setItem('etc-br-hide-singles', hideSingles ? '1' : '0'); } catch { /* nicety */ } }, [onlyMine, hideSingles]);
  const [battles, setBattles] = useState<Battle[] | null>(cachedBattles);
  const [selIdx, setSelIdx] = useState(cachedSel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [noLiveFeed, setNoLiveFeed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  // a stale async result must never land on a newer load
  const runRef = useRef(0);

  useEffect(() => {
    if (!cachedBattles) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const putAll = (bs: Battle[] | null) => { cachedBattles = bs; setBattles(bs); };
  const putAt = (idx: number, b: Battle) => {
    setBattles((cur) => {
      if (!cur || !cur[idx]) return cur;
      const next = cur.slice();
      next[idx] = b;
      cachedBattles = next;
      return next;
    });
  };
  const select = (idx: number) => { cachedSel = idx; setSelIdx(idx); };

  async function load() {
    const run = runRef.current + 1;
    runRef.current = run;
    setBusy(true);
    setError(null);
    const t0 = performance.now();
    try {
      const chars = useAuth.getState().characters;
      if (chars.length === 0) {
        throw new Error('log in a character first — the corporation comes from your pilot, never from code');
      }
      const corp = await corporationOf(chars[0].characterId);
      // every logged-in character with a live token feeds its OWN killmails
      // straight from ESI (live); the corp-wide list comes from zKill's
      // API, which zKill caches for up to an hour (v0.199.1 — the hidden
      // page reader that beat that cache was scraping and is gone)
      const sources = chars
        .filter((c) => c.accessToken && c.expiresAt > Date.now())
        .map((c) => ({ characterId: c.characterId, token: c.accessToken! }));
      const myIds = chars.map((c) => c.characterId);
      let h = await makeBattleReports(corp, sources, myIds);
      if (runRef.current !== run) return;
      // feed went backwards? one fresh retry usually lands on a caught-up
      // zkill node; if not, say so rather than presenting an old fight
      let staleNow = false;
      if (h.newestKillmailId < highWater()) {
        const retry = await makeBattleReports(corp, sources, myIds);
        if (runRef.current !== run) return;
        if (retry.newestKillmailId >= h.newestKillmailId) h = retry;
        staleNow = h.newestKillmailId < highWater();
        logUser('battle report stale feed', {
          got: h.newestKillmailId, highWater: highWater(), recovered: !staleNow,
        });
      }
      localStorage.setItem(HIGH_WATER_KEY, String(Math.max(highWater(), h.newestKillmailId)));
      setStale(staleNow);
      setNoLiveFeed(h.liveFeeds === 0);
      const seeded = h.fights.map((report) => ({ report }));
      putAll(seeded);
      select(0);
      logUser('battle reports made', {
        fights: h.fights.length, newest: h.fights[0]?.systemName,
        liveFeeds: h.liveFeeds,
        ms: Math.round(performance.now() - t0),
      });
      // learn EAGERLY whether br.evetools has the newest fight, so the card
      // and its open button are truthful before the first click
      void (async () => {
        const withDigest = await ensureDigest(seeded[0]);
        if (runRef.current === run) putAt(0, withDigest);
      })();
    } catch (e) {
      if (runRef.current !== run) return;
      putAll(null);
      setError(e instanceof Error ? e.message : String(e));
      logUser('battle report failed', { error: String(e) });
    } finally {
      if (runRef.current === run) setBusy(false);
    }
  }

  /** the digest, built once per battle — selection and the write-up button
   * both need it; also upgrades a multi-system fight to its SAVED evetools
   * report the moment their analyze has the data */
  async function ensureDigest(b: Battle): Promise<Battle> {
    if (b.digest || b.digestNote) return b;
    let fd = b.fightData;
    let out = b;
    if (!fd) {
      try {
        fd = await fetchFightData(b.report.window, b.report.corpKms);
      } catch {
        // br.evetools does not have the fight (their feed can run HOURS
        // behind zkill — or, some days, be down entirely) — the corp's own
        // killmails are already in hand, so summarise those and SAY SO
        if (b.report.corpKms.length > 0) {
          fd = fallbackFightData(b.report.corpKms, b.report.window.corpId);
        }
      }
    }
    if (!fd) return { ...b, digestNote: 'no summary: the fight’s killmails could not be read' };
    // THE FULL-FIGHT LINK: a multi-system fight whose analyze answered gets
    // its saved multi-system report NOW — the one URL that covers every
    // system and every related kill
    if (!fd.partial && b.report.window.timings.length > 1 && !b.savedBrDone) {
      try {
        const url = await createSavedBr(b.report.window.timings, fd);
        out = { ...out, report: { ...out.report, url, caveat: undefined }, savedBrDone: true };
        logUser('battle saved br created', { url });
      } catch { /* next selection retries */ }
    }
    try {
      const digest = await buildFightDigest(fd, b.report.window.corpId, {
        startMs: b.report.window.startMs, endMs: b.report.window.endMs,
      });
      return { ...out, fightData: fd, digest };
    } catch (e) {
      return { ...out, digestNote: `no summary: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  /** card click: copy the fight's link (the old one-click deliverable) and
   * open its report */
  async function openBattle(idx: number) {
    if (!battles?.[idx]) return;
    const run = runRef.current;
    const b = battles[idx];
    select(idx);
    try { await navigator.clipboard.writeText(b.report.url); } catch { /* url stays visible */ }
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
    if (!b.digest && !b.digestNote) {
      setSummaryBusy(true);
      const next = await ensureDigest(b);
      if (runRef.current === run) { putAt(idx, next); setSummaryBusy(false); }
    }
  }

  const cur = battles?.[selIdx] ?? null;
  const r = cur?.report;
  const d = cur?.digest;

  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '12px 14px' }}>
      {/* ---- left: the fight history ---- */}
      <div style={{ width: 360, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="sim-card-title">Battles — last 3 days</span>
          <button className="btn mini" disabled={busy} style={{ marginLeft: 'auto' }}
            title="re-read the corp killboard"
            onClick={() => void load()}>
            ↻ refresh
          </button>
        </div>
        {busy && <div className="hint">reading the corp killboard…</div>}
        {error && <div className="hint">battle report failed: {error}</div>}
        {stale && (
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            ⚠ zkill answered from an older snapshot — a newer fight may exist; ↻ to retry
          </div>
        )}
        {noLiveFeed && !busy && battles && (
          <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
            ⚠ no live source answered — this list is zKill's, cached by them for up to an hour; your own characters' kills arrive live from CCP once they are logged in
          </div>
        )}
        {battles && battles.length > 0 && (() => {
          const mineN = battles.filter((b) => b.report.mine).length;
          const singlesN = battles.filter((b) => b.report.kills === 1).length;
          return (
            <div className="dim" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, margin: '6px 0' }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                title="Only the fights one of YOUR logged-in characters is on a killmail of. The list is the whole corporation's.">
                <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} style={{ margin: 0 }} />
                my fights ({mineN})
              </label>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                title="Fold away the fights that are a single killmail — a lone gank, a pilot lost to rats.">
                <input type="checkbox" checked={hideSingles} onChange={(e) => setHideSingles(e.target.checked)} style={{ margin: 0 }} />
                hide single kills ({singlesN})
              </label>
              <span>{n(battles.length, 'fight')}</span>
            </div>
          );
        })()}
        <div style={{ maxHeight: 'calc(100vh - 220px)', overflowY: 'auto' }}>
          {battles?.map((b, i) => ((onlyMine && !b.report.mine) || (hideSingles && b.report.kills === 1) ? null : (
            <div key={`${b.report.window.startMs}-${b.report.systemId}-${b.report.kills}`} className="sim-card" role="button" tabIndex={0}
              onClick={() => void openBattle(i)}
              onKeyDown={(e) => { if (e.key === 'Enter') void openBattle(i); }}
              style={{
                cursor: 'pointer',
                borderColor: i === selIdx ? 'var(--accent, #6aa9ff)' : undefined,
              }}
              title="copy this fight's link and open its report">
              <FightPosterCard report={b.report} />
              {i === selIdx && b.report.why && (
                <div className="dim" style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.45 }} title="how this fight was told apart from the corp's other killmails">
                  {b.report.why}
                </div>
              )}
              {b.digest && (
                <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                  {b.digest.caveat
                    ? '⚠ br.evetools has no data for this fight yet'
                    : (b.report.window.timings.length > 1 && b.savedBrDone
                      ? 'full multi-system report ready ✓' : 'br.evetools ready ✓')}
                </div>
              )}
              {i === selIdx && copied && (
                <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>link copied ✓</div>
              )}
            </div>
          )))}
        </div>
        {!busy && battles && (
          <div className="hint" style={{ marginTop: 8 }}>
            every fight on the corp killboard in the last 3 days, told apart by who
            fought whom, where, and at what tempo — click one to copy its link and
            open the report; the selected fight says how it was grouped.
          </div>
        )}
      </div>

      {/* ---- right: the report ---- */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!cur && !busy && (
          <div className="hint" style={{ marginTop: 26 }}>
            click a battle — its br.evetools link is copied for game chat and
            the full report opens here
          </div>
        )}
        {cur && r && (
          <div className="sim-card" style={{ marginTop: 0 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="sim-card-title" style={{ whiteSpace: 'normal', fontSize: 16 }}>
                {r.systemName ?? r.systemId}
              </span>
              <span className="dim" style={{ fontSize: 12 }}>
                {day(r.startedAt)} · {hm(r.startedAt)}–{hm(r.endedAt)} EVE
              </span>
              <button className="btn mini" style={{ marginLeft: 'auto' }}
                onClick={() => { void navigator.clipboard.writeText(r.url); }}>
                copy link
              </button>
              <button className="btn mini"
                title={d?.caveat
                  ? 'br.evetools is still empty for this fight — opening WarBeacon, which has it live'
                  : 'open the battle report on br.evetools.org'}
                onClick={() => window.open(d?.caveat ? r.warbeaconUrl : r.url, '_blank')}>
                ↗ open in browser
              </button>
            </div>
            <div className="dim" style={{ fontSize: 12, marginTop: 2, wordBreak: 'break-all' }}>{r.url}</div>

            {summaryBusy && <div className="hint">reading the fight’s killmails…</div>}
            {cur.digestNote && <div className="hint">{cur.digestNote} — the link above still works</div>}
            {d?.caveat && (
              <div className="hint" style={{ marginTop: 6 }}>⚠ {d.caveat}</div>
            )}
            {d?.caveat && (
              // br.evetools is behind, so ITS page is empty right now — these
              // run off the board that already has the kills (first system)
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                <span className="dim" style={{ fontSize: 12 }}>
                  works right now — WarBeacon battle report:
                </span>
                <button className="btn mini"
                  onClick={() => { void navigator.clipboard.writeText(r.warbeaconUrl); }}>
                  copy link
                </button>
                <button className="btn mini" onClick={() => window.open(r.warbeaconUrl, '_blank')}>
                  ↗ open
                </button>
                <span className="dim" style={{ fontSize: 12 }}>· zKillboard related:</span>
                <button className="btn mini"
                  onClick={() => { void navigator.clipboard.writeText(r.liveUrl); }}>
                  copy link
                </button>
                <button className="btn mini" onClick={() => window.open(r.liveUrl, '_blank')}>
                  ↗ open
                </button>
              </div>
            )}

            {d && (
              <>
                {/* ---- the fight in numbers ---- */}
                <div style={{ display: 'flex', gap: 18, marginTop: 12, flexWrap: 'wrap' }}>
                  <Stat label="ISK destroyed" value={d.fight.totalLost} />
                  <Stat label="killmails" value={String(d.fight.totalKills)} />
                  <Stat label="pilots" value={String(d.ours.pilots + d.theirs.pilots)} />
                  <Stat label="duration" value={`${d.fight.durationMin}m`} />
                  <Stat label="systems" value={String(d.fight.systems.length)} />
                </div>

                {/* ---- the two sides ---- */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12,
                }}>
                  <TeamPanel colour={TEAM_A} title="Team A — ours" side={d.ours} onPilot={setPilotView}
                    extra={d.ours.myCorp
                      ? `${d.ours.myCorp.pilotCount} from ${d.ours.myCorp.name}` : undefined} />
                  <TeamPanel colour={TEAM_B} title="Team B" side={d.theirs} onPilot={setPilotView} />
                </div>

                {/* ---- the fight over time: every killmail, four modes, hover for the kill (v0.204.2) ---- */}
                <div className="sim-card-title" style={{ marginTop: 14 }}>Timeline</div>
                {d.timeline && d.timeline.length > 0 && (
                  <div style={{ marginTop: 6, marginBottom: 8 }}>
                    <FightTimeline points={d.timeline} onPilot={setPilotView} />
                  </div>
                )}
                {d.phases.map((ph, i) => (
                  <div key={i} className="dim" style={{ fontSize: 13, lineHeight: 1.7 }}>
                    <b>{ph.start === ph.end ? ph.start : `${ph.start}–${ph.end}`}</b>
                    {' '}{ph.systems.join('/')}
                    {ph.theirsLost.ships + ph.theirsLost.pods > 0 && (
                      <> — they lost {lostLine(ph.theirsLost)}</>
                    )}
                    {ph.oursLost.ships + ph.oursLost.pods > 0 && (
                      <> — we lost {lostLine(ph.oursLost)}</>
                    )}
                    {ph.notable[0] && (
                      <> · biggest: {ph.notable[0].ship} ({ph.notable[0].value})</>
                    )}
                  </div>
                ))}

                {/* ---- everyone involved (v0.204.2): both sides, what they flew / did / lost ---- */}
                <div className="sim-card-title" style={{ marginTop: 16 }}>Everyone involved</div>
                <div style={{ marginTop: 6 }}>
                  <FightRoster d={d} onPilot={setPilotView} />
                </div>

              </>
            )}
          </div>
        )}
      </div>
      {pilotView && d && <BattlePilot view={pilotView} d={d} onView={setPilotView} onClose={() => setPilotView(null)} />}
    </div>
  );
}

/**
 * The pilot panel for a ship picture in a battle report (v0.203.2): what the
 * pilot did in this battle, every ship they lost in it (click one to switch
 * to its fit), then the shared panel — the exact fit when the hull on screen
 * died in this battle, else their own nearest loss of it, else corp mates'.
 */
export function BattlePilot({ view, d, onView, onClose }: { view: PilotView; d: FightDigest; onView: (v: PilotView) => void; onClose: () => void }) {
  const allLosses = [...d.ours.losses, ...d.theirs.losses];
  const theirLosses = allLosses.filter((l) => l.pilotId === view.pilotId).sort((a, b) => (a.t ?? 0) - (b.t ?? 0));
  // what they did, from the FULL roster (v0.204.2) — the top-damage list holds eight per side
  const me = [...(d.roster?.ours ?? []), ...(d.roster?.theirs ?? [])].find((r) => r.pilotId === view.pilotId);
  const times = allLosses.map((l) => l.t ?? 0).filter((t) => t > 0);
  const win = times.length > 0 ? { t0: Math.min(...times), t1: Math.max(...times) } : { t0: 0, t1: 0 };
  // a loss row was clicked → THAT killmail is the evidence; a leader's hull →
  // whichever of their losses in this battle were that hull
  const focus = view.killId !== null ? theirLosses.filter((l) => l.killmailId === view.killId) : theirLosses.filter((l) => l.shipId === view.shipId);
  const killmails: PilotKillmail[] = focus.map((l) => ({ id: l.killmailId, value: l.iskNum, t: l.t ?? 0, shipTypeId: l.shipId }));
  const row = view.killId !== null ? focus[0] : undefined;
  const others = theirLosses.filter((l) => l.killmailId !== view.killId);
  return (
    <PilotFitPanel pilot={view.pilot} pilotId={view.pilotId} shipName={view.ship} shipTypeId={view.shipId} win={win}
      killmails={killmails} words={{ onMail: 'a killmail of this battle' }} onClose={onClose}>
      <div style={PANEL_CARD}>
        <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
          in this battle — {view.pilot}
        </div>
        <div style={{ fontSize: 13, lineHeight: 1.7 }}>
          {row && (
            <div>
              lost a <b>{row.ship}</b> at {row.time} in {row.system} · <b>{row.isk}</b>
              {row.topDmg && <span className="dim"> · top damage {row.topDmg.name} ({row.topDmg.dmg.toLocaleString()})</span>}
              {row.finalBlow && row.finalBlow.pilotId !== row.topDmg?.pilotId && <span className="dim"> · final blow {row.finalBlow.name}</span>}
            </div>
          )}
          {me && me.kills > 0
            ? <div>dealt <b>{me.dmg.toLocaleString()}</b> damage on {n(me.kills, 'killmail')}{me.ships[0] ? <> in a {me.ships.map((s) => s.name).join(' / ')}</> : null}{me.finalBlows > 0 ? <> · {n(me.finalBlows, 'final blow')}</> : null}</div>
            : <div className="dim">on no killmail of this battle as an attacker</div>}
          {!row && theirLosses.length === 0 && <div className="dim">did not lose a ship in this battle</div>}
        </div>
        {others.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>{row ? 'also lost in this battle' : 'lost in this battle'} — click one for its fit</div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              {others.map((l) => (
                <div key={l.killmailId} style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer', fontSize: 12.5 }}
                  title={'open the fit of this ' + l.ship + ' — ' + l.isk}
                  onClick={() => onView({ pilotId: view.pilotId, pilot: view.pilot, shipId: l.shipId, ship: l.ship, killId: l.killmailId })}>
                  <TypeIconId id={l.shipId} size={30} />
                  <span>{l.ship} <span className="dim">· {l.time} · {l.isk}</span></span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </PilotFitPanel>
  );
}
/**
 * A FIGHT'S CARD, POSTER-STYLE (v0.204.1) — the owner's order of importance,
 * biggest first: ships on each side, ISK destroyed vs lost, when (in words),
 * who it was against, where. All from the corp's own killmails, so it is
 * there the moment the list is.
 */
function FightPosterCard({ report }: { report: BattleReportResult }) {
  const p = report.poster;
  const w = fightWhen(report.window.startMs, report.window.endMs, Date.now());
  const floor = p.unpriced > 0 ? '≥' : '';
  const isk = (v: number): string => (v > 0 ? iskShort(v) : '0');
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}
        title={`${p.ours} of ours and ${p.theirs} of theirs seen on the corp's ${report.kills} killmail${report.kills === 1 ? '' : 's'} of this fight — an enemy who got away without a killmail either way was never seen`}>
        <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: TEAM_A, fontVariantNumeric: 'tabular-nums' }}>{p.ours}</span>
        <span className="dim" style={{ fontSize: 13 }}>v</span>
        <span style={{ fontSize: 26, fontWeight: 800, lineHeight: 1, color: TEAM_B, fontVariantNumeric: 'tabular-nums' }}>{p.theirs}</span>
        <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>ships</span>
        {report.mine && <span title="one of your logged-in characters is on a killmail of this fight" style={{ marginLeft: 'auto', fontSize: 11, color: '#f0c674', whiteSpace: 'nowrap' }}>★ yours</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 6, flexWrap: 'wrap' }}
        title={`destroyed ${Math.round(p.destroyed).toLocaleString()} ISK over ${p.kills} kill${p.kills === 1 ? '' : 's'} · lost ${Math.round(p.lost).toLocaleString()} ISK over ${p.losses} loss${p.losses === 1 ? '' : 'es'}${p.unpriced > 0 ? ` · ${p.unpriced} killmail${p.unpriced === 1 ? ' has' : 's have'} no price yet, so these are floors` : ''}`}>
        <span style={{ fontSize: 18, fontWeight: 800, color: '#5fd08a', fontVariantNumeric: 'tabular-nums' }}>{p.destroyed > 0 ? floor : ''}{isk(p.destroyed)}</span>
        <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>destroyed</span>
        <span style={{ fontSize: 18, fontWeight: 800, color: p.lost > 0 ? TEAM_B : 'var(--muted)', fontVariantNumeric: 'tabular-nums' }}>{isk(p.lost)}</span>
        <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 }}>lost</span>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }} title={`${day(report.startedAt)} · ${hm(report.startedAt)}–${hm(report.endedAt)} EVE time`}>
        {w.day} {w.clock} <span className="dim" style={{ fontWeight: 400 }}>· {w.length} · {w.ago}</span>
      </div>
      {/* the two sides as corporation logos, not names (v0.204.2): ours left, theirs right */}
      {(p.corps.ours.length > 0 || p.corps.theirs.length > 0) && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <LogoRow corps={p.corps.ours} />
          <span className="dim" style={{ fontSize: 12 }}>v</span>
          <LogoRow corps={p.corps.theirs} />
        </div>
      )}
      <div className="dim" style={{ fontSize: 12, marginTop: 3, whiteSpace: 'normal', lineHeight: 1.35 }}>
        {report.systemName ?? report.systemId} · {n(report.kills, 'killmail')}
      </div>
    </>
  );
}

/** a side of a fight as its corporations' logos, most pilots first; the name and the pilot count are the tooltip */
function LogoRow({ corps }: { corps: { id: number; name: string; pilots: number }[] }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      {corps.slice(0, POSTER_LOGOS).map((c) => (
        <img key={c.id} src={corpLogo(c.id)} alt="" width={24} height={24} title={`${c.name || `corporation ${c.id}`} — ${n(c.pilots, 'pilot')}`}
          style={{ borderRadius: 4, background: 'rgba(128,128,128,.1)' }}
          onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
      ))}
      {corps.length > POSTER_LOGOS && (
        <span className="dim" style={{ fontSize: 11.5 }} title={corps.slice(POSTER_LOGOS).map((c) => `${c.name || c.id} (${c.pilots})`).join(', ')}>+{corps.length - POSTER_LOGOS}</span>
      )}
    </span>
  );
}

/** one big number with a small label — the fight-summary strip */
function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 24, fontWeight: 700, lineHeight: 1.1 }}>{value}</div>
      <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.5 }}>
        {label}
      </div>
    </div>
  );
}

type SideDigest = FightDigest['ours'] | FightDigest['theirs'];

/**
 * One side of the fight, killboard-style: the organisations that flew
 * (with logos linking to zKillboard), ISK lost + efficiency bar, every
 * loss with ship icon / pilot / credits, and the damage leaderboard.
 */
export function TeamPanel({ colour, title, side, extra, onPilot }: {
  colour: string; title: string; side: SideDigest; extra?: string; onPilot: (v: PilotView) => void;
}) {
  return (
    <div style={{
      border: '1px solid var(--border)', borderTop: `3px solid ${colour}`,
      borderRadius: 8, padding: '10px 12px', minWidth: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="sim-card-title" style={{ whiteSpace: 'normal', color: colour, fontSize: 15 }}>{title}</span>
        <span className="dim" style={{ fontSize: 12 }}>
          {n(side.pilots, 'pilot')} · {n(side.groups, 'group')}
        </span>
      </div>
      {extra && <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{extra}</div>}

      {/* the organisations that flew: alliance umbrella, member corps under
          it — every logo opens its zKillboard page */}
      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
        {side.orgs.slice(0, 4).map((org) => <Org key={org.allyId || org.corps[0]?.id} org={org} />)}
        {side.orgs.length > 4 && (
          <span className="dim" style={{ fontSize: 12, alignSelf: 'center' }}>
            +{side.orgs.length - 4} more groups
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 26, fontWeight: 700, color: colour, lineHeight: 1 }}>
            {side.iskLost}
          </div>
          <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>lost</div>
        </div>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}>
            {side.shipsLost > 0 || side.podsLost > 0
              ? lostLine({ ships: side.shipsLost, pods: side.podsLost, isk: side.iskLost }).replace(/ \(.*\)$/, '')
              : 'nothing'}
          </div>
          <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>ships lost</div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.2 }}>{side.efficiency}%</div>
          <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>efficiency</div>
        </div>
      </div>
      {/* efficiency bar: this side's share of the ISK exchange */}
      <div style={{
        height: 5, borderRadius: 3, background: 'rgba(255,255,255,.08)', marginTop: 6, overflow: 'hidden',
      }}>
        <div style={{ width: `${side.efficiency}%`, height: '100%', background: colour, opacity: 0.85 }} />
      </div>

      {side.losses.length > 0 && (
        <>
          <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', marginTop: 10 }}>
            losses
          </div>
          <div style={{ maxHeight: 300, overflowY: 'auto', marginTop: 4 }}>
            {side.losses.map((row, i) => <Loss key={i} row={row} onPilot={onPilot} />)}
          </div>
        </>
      )}

      {side.dmgLeaders.length > 0 && (
        <>
          <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', marginTop: 10 }}>
            top damage
          </div>
          {side.dmgLeaders.slice(0, 5).map((l) => <Leader key={l.pilotId} row={l} colour={colour} max={side.dmgLeaders[0].dmg} onPilot={onPilot} />)}
        </>
      )}
    </div>
  );
}

/**
 * One organisation: the alliance logo as the umbrella with its member
 * corps beneath it — logo AND name for each corp — every image opening
 * its zKillboard page. Unallied corps render without an umbrella.
 */
function Org({ org }: { org: OrgGroup }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-start' }}>
      {org.allyId !== 0 && (
        <div style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}
          title={`open alliance ${org.allyName ?? org.allyId} on zKillboard (${org.pilots} pilots here)`}
          onClick={() => window.open(zkAlly(org.allyId), '_blank')}>
          <img src={allyLogo(org.allyId)} alt="" width={30} height={30}
            style={{ borderRadius: 4 }}
            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          <span className="dim" style={{ fontSize: 12, maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {org.allyName}
          </span>
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: org.allyId !== 0 ? 12 : 0 }}>
        {org.corps.slice(0, 6).map((c) => (
          <div key={c.id} style={{ display: 'flex', gap: 5, alignItems: 'center', cursor: 'pointer' }}
            title={`open ${c.name} on zKillboard (${n(c.pilots, 'pilot')} here)`}
            onClick={() => window.open(zkCorp(c.id), '_blank')}>
            <img src={corpLogo(c.id)} alt="" width={24} height={24}
              style={{ borderRadius: 3 }}
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <span className="dim" style={{ fontSize: 12, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {c.name}
            </span>
          </div>
        ))}
        {org.corps.length > 6 && (
          <span className="dim" style={{ fontSize: 12 }}>+{org.corps.length - 6} more corps</span>
        )}
      </div>
    </div>
  );
}

/** one loss row: ship icon, who died in what, what it cost, who gets credit */
function Loss({ row, onPilot }: { row: LossRow; onPilot: (v: PilotView) => void }) {
  // a loss with a pilot opens the pilot panel: the exact fit from THIS
  // killmail, a copy for the game, and the zKillboard link inside. A loss
  // with no pilot (a structure, an NPC) has no one to open — straight to zKill.
  const open = () => (row.pilotId > 0
    ? onPilot({ pilotId: row.pilotId, pilot: row.pilot, shipId: row.shipId, ship: row.ship, killId: row.killmailId })
    : void window.open(zkKill(row.killmailId), '_blank'));
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', minWidth: 0 }}>
      <img src={shipIcon(row.shipId)} alt="" width={40} height={40}
        style={{ borderRadius: 4, flexShrink: 0, cursor: 'pointer' }}
        title={row.pilotId > 0
          ? `${row.pilot}'s ${row.ship} — open the exact fit from this killmail (copy it for the game; the zKillboard link is inside) · ${row.isk}`
          : `open this kill on zKillboard — ${row.ship}, ${row.isk}`}
        onClick={open}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <b>{row.ship}</b> <span className="dim">— {row.pilot}</span>
        </div>
        <div className="dim" style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.time} · {row.system}
          {row.topDmg && <> · top dmg {row.topDmg.name} ({row.topDmg.dmg.toLocaleString()})</>}
          {row.finalBlow && row.finalBlow.pilotId !== row.topDmg?.pilotId && (
            <> · final blow {row.finalBlow.name}</>
          )}
        </div>
      </div>
      <div style={{ fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{row.isk}</div>
    </div>
  );
}

/** one leaderboard row: portrait, name, damage bar scaled to the side's top */
function Leader({ row, colour, max, onPilot }: { row: DmgLeader; colour: string; max: number; onPilot: (v: PilotView) => void }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
      <img src={portrait(row.pilotId)} alt="" width={30} height={30}
        style={{ borderRadius: 4, flexShrink: 0, cursor: 'pointer' }}
        title={`${row.name} — open the pilot panel (their part in this battle, their fit, the zKillboard links inside)`}
        onClick={() => onPilot({ pilotId: row.pilotId, pilot: row.name, shipId: row.shipId ?? 0, ship: row.ship ?? '', killId: null })}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      {(row.shipId ?? 0) > 0 && (
        <img src={shipIcon(row.shipId)} alt="" width={30} height={30}
          style={{ borderRadius: 4, flexShrink: 0, cursor: 'pointer' }}
          title={`${row.name} flew a ${row.ship} — open their fit: exact if they lost it in this battle, else their own nearest loss of that hull, else their corp mates' fits`}
          onClick={() => onPilot({ pilotId: row.pilotId, pilot: row.name, shipId: row.shipId, ship: row.ship, killId: null })}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.name}{row.ship ? <span className="dim"> · {row.ship}</span> : null}
          {row.finalBlows > 0 && (
            <span className="dim"> · {n(row.finalBlows, 'final blow')}</span>
          )}
        </div>
        <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.08)', marginTop: 2 }}>
          <div style={{
            width: `${max > 0 ? Math.max(3, Math.round((row.dmg / max) * 100)) : 0}%`,
            height: '100%', background: colour, opacity: 0.7, borderRadius: 2,
          }} />
        </div>
      </div>
      <div className="dim" style={{ fontSize: 12, flexShrink: 0 }}>{row.dmg.toLocaleString()}</div>
    </div>
  );
}
