// BATTLE REPORTS — the corp's recent fights, killboard-grade (v0.107.0).
//
// The last HISTORY_DAYS of corp fights as cards down the left, newest
// first; selecting one copies its br.evetools link and opens the full
// visual report beside it. Multi-system fights get their SAVED evetools
// report (the full-fight link) created on selection, the moment their
// ingest has the data — never up front for the whole history, which would
// spam their database. The AI write-up runs ONLY from its button at the
// bottom of the panel.
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../lib/auth';
import {
  makeBattleReports, corporationOf, fetchFightData, fallbackFightData, createSavedBr,
} from '../lib/battleReport';
import type { BattleReportResult, FightData } from '../lib/battleReport';
import { buildFightDigest, templateWriteup } from '../lib/battleNarrative';
import type { FightDigest, LossRow, DmgLeader, OrgGroup } from '../lib/battleNarrative';
import { logUser } from '../lib/devlog';

/** EVE's public image CDN — ship icons, portraits, group logos */
const shipIcon = (typeId: number): string => `https://images.evetech.net/types/${typeId}/icon?size=64`;
const portrait = (charId: number): string => `https://images.evetech.net/characters/${charId}/portrait?size=64`;
const corpLogo = (corpId: number): string => `https://images.evetech.net/corporations/${corpId}/logo?size=64`;
const allyLogo = (allyId: number): string => `https://images.evetech.net/alliances/${allyId}/logo?size=64`;

/** every image opens its subject on zKillboard */
const zkKill = (id: number): string => `https://zkillboard.com/kill/${id}/`;
const zkChar = (id: number): string => `https://zkillboard.com/character/${id}/`;
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
  template?: string;
  /** why there is no digest (analyze failed, no usable times, …) */
  digestNote?: string;
  /** the write-up — AI prose, or the plain template when no key is set;
   * EXISTS ONLY after the button at the panel's bottom was pressed */
  writeup?: { text: string; note: string };
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

export default function BattleReports() {
  const [battles, setBattles] = useState<Battle[] | null>(cachedBattles);
  const [selIdx, setSelIdx] = useState(cachedSel);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [noLiveFeed, setNoLiveFeed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ configured: boolean; model: string | null }>(
    { configured: false, model: null },
  );
  // a stale async result must never land on a newer load
  const runRef = useRef(0);

  useEffect(() => {
    void window.appInfo?.narrative?.status().then(setAiStatus).catch(() => {});
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
      // straight from ESI — zkill's API runs ~30 min behind its own site
      const sources = chars
        .filter((c) => c.accessToken && c.expiresAt > Date.now())
        .map((c) => ({ characterId: c.characterId, token: c.accessToken! }));
      // ...and the corp PAGE itself, loaded like a real browser tab in a
      // hidden window: the live list, no scopes, works for any corp member
      const pageIds = await (window.appInfo?.zkill?.pageIds(corp).catch(() => [])
        ?? Promise.resolve([]));
      if (runRef.current !== run) return;
      let h = await makeBattleReports(corp, sources, pageIds);
      if (runRef.current !== run) return;
      // feed went backwards? one fresh retry usually lands on a caught-up
      // zkill node; if not, say so rather than presenting an old fight
      let staleNow = false;
      if (h.newestKillmailId < highWater()) {
        const retry = await makeBattleReports(corp, sources, pageIds);
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
        pageIds: pageIds.length, liveFeeds: h.liveFeeds,
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
        fd = await fetchFightData(b.report.window);
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
      return { ...out, fightData: fd, digest, template: templateWriteup(digest) };
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

  /** THE WRITE-UP BUTTON at the panel's bottom — AI prose with a key, the
   * plain template without one; nothing is written until this is pressed */
  async function writeSummary(idx: number) {
    if (!battles?.[idx] || aiBusy) return;
    const run = runRef.current;
    setAiBusy(true);
    const t0 = performance.now();
    try {
      let b = await ensureDigest(battles[idx]);
      if (runRef.current !== run) return;
      putAt(idx, b);
      if (!b.digest || !b.template) return; // digestNote explains
      if (!aiStatus.configured) {
        putAt(idx, {
          ...b,
          writeup: {
            text: b.template,
            note: 'plain summary — add an Anthropic API key in Settings (⚙) → AI fight summaries for AI prose',
          },
        });
        return;
      }
      const ai = await window.appInfo!.narrative!.write(b.digest);
      if (runRef.current !== run) return;
      if (ai.text) {
        putAt(idx, { ...b, writeup: { text: ai.text, note: `written by ${ai.model ?? aiStatus.model}` } });
        logUser('battle ai summary made', { ms: Math.round(performance.now() - t0) });
      } else {
        putAt(idx, {
          ...b,
          writeup: { text: b.template, note: `plain summary — AI failed: ${ai.error ?? 'unknown'}` },
        });
        logUser('battle ai summary failed', { error: ai.error ?? 'unknown' });
      }
    } finally {
      if (runRef.current === run) setAiBusy(false);
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
            ⚠ no live source answered — the list may lag the killboard by ~30 min
          </div>
        )}
        <div style={{ maxHeight: 'calc(100vh - 190px)', overflowY: 'auto' }}>
          {battles?.map((b, i) => (
            <div key={b.report.window.startMs} className="sim-card" role="button" tabIndex={0}
              onClick={() => void openBattle(i)}
              onKeyDown={(e) => { if (e.key === 'Enter') void openBattle(i); }}
              style={{
                cursor: 'pointer',
                borderColor: i === selIdx ? 'var(--accent, #6aa9ff)' : undefined,
              }}
              title="copy this fight's link and open its report">
              <div className="sim-card-title" style={{ whiteSpace: 'normal', lineHeight: 1.4, fontSize: 14 }}>
                {b.report.systemName ?? b.report.systemId}
              </div>
              <div className="dim" style={{ fontSize: 12, marginTop: 4 }}>
                {day(b.report.startedAt)} · {hm(b.report.startedAt)}–{hm(b.report.endedAt)} EVE
                {' '}· {n(b.report.kills, 'corp killmail')}
              </div>
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
          ))}
        </div>
        {!busy && battles && (
          <div className="hint" style={{ marginTop: 8 }}>
            every fight on the corp killboard in the last 3 days — click one to
            copy its link and open the report.
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
                  <TeamPanel colour={TEAM_A} title="Team A — ours" side={d.ours}
                    extra={d.ours.myCorp
                      ? `${d.ours.myCorp.pilotCount} from ${d.ours.myCorp.name}` : undefined} />
                  <TeamPanel colour={TEAM_B} title="Team B" side={d.theirs} />
                </div>

                <div className="sim-card-title" style={{ marginTop: 14 }}>Timeline</div>
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

                {/* ---- the write-up, ONLY on demand ---- */}
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 14 }}>
                  <button className="btn mini" disabled={aiBusy}
                    title={aiStatus.configured
                      ? `summarise this fight with ${aiStatus.model}`
                      : 'writes the plain summary — add an Anthropic API key in Settings for AI prose'}
                    onClick={() => void writeSummary(selIdx)}>
                    {aiBusy ? 'writing…' : '✨ write summary'}
                  </button>
                  {cur.writeup && (
                    <>
                      <span className="dim" style={{ fontSize: 12 }}>{cur.writeup.note}</span>
                      <button className="btn mini"
                        onClick={() => { void navigator.clipboard.writeText(cur.writeup!.text); }}>
                        copy
                      </button>
                    </>
                  )}
                </div>
                {cur.writeup && (
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55, opacity: 0.92, marginTop: 6 }}>
                    {cur.writeup.text}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
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
function TeamPanel({ colour, title, side, extra }: {
  colour: string; title: string; side: SideDigest; extra?: string;
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
            {side.losses.map((row, i) => <Loss key={i} row={row} />)}
          </div>
        </>
      )}

      {side.dmgLeaders.length > 0 && (
        <>
          <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', marginTop: 10 }}>
            top damage
          </div>
          {side.dmgLeaders.slice(0, 5).map((l) => <Leader key={l.pilotId} row={l} colour={colour} max={side.dmgLeaders[0].dmg} />)}
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
function Loss({ row }: { row: LossRow }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', minWidth: 0 }}>
      <img src={shipIcon(row.shipId)} alt="" width={40} height={40}
        style={{ borderRadius: 4, flexShrink: 0, cursor: 'pointer' }}
        title={`open this kill on zKillboard — ${row.ship}, ${row.isk}`}
        onClick={() => window.open(zkKill(row.killmailId), '_blank')}
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
function Leader({ row, colour, max }: { row: DmgLeader; colour: string; max: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0' }}>
      <img src={portrait(row.pilotId)} alt="" width={30} height={30}
        style={{ borderRadius: 4, flexShrink: 0, cursor: 'pointer' }}
        title={`open ${row.name} on zKillboard`}
        onClick={() => window.open(zkChar(row.pilotId), '_blank')}
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.name}
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
