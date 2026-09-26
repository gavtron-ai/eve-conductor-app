// THE DASHLETS, SECOND HALF (v0.209.0) — harvest, theft, planets, wealth, market, battle, corp,
// pilots and utility. Same furniture and the same rule as the first half: read what the app
// already holds, say how old it is, and never fill a gap with a guess.
import { useMemo } from 'react';
import { optionOf } from '../lib/dashlets';
import { useBeat, useResource } from '../lib/homeData';
import { agoShort, inShort } from '../lib/homeDigests';
import {
  bestSellers, byEveHour, eventsDigest, extractorResets, haulsDigest, inventoryDigest, layersDigest, loginsDigest, piByPilot, piProducts, profitByDay,
  raidHot, raidOutcomes, walletsDigest,
} from '../lib/homeStats';
import { corpTotals, enemies, fightTimes, hullsFlown, killFeed } from '../lib/corpStats';
import { BOARDS, CAPSULES, beforeIsHeld, coverage, fmtBoardValue, medalTable, pilotStats, rankBoard, rankMoves, type PilotStats } from '../lib/leaderboard';
import { corpDays, hallOfFame } from '../lib/leaderboardExtras';
import { homeBoardData, inputFor, type BoardData } from '../lib/leaderboardData';
import { iskShort } from '../lib/format';
import { useApp } from '../lib/store';
import { useAuth, shortLabel } from '../lib/auth';
import { usePrices } from '../lib/priceStore';
import { piPlanets, piLastRun } from '../lib/pi';
import { raidEvents } from '../lib/raidWatch';
import { loadNetWorthSeries } from '../lib/networth';
import { loadTrendEvents } from '../lib/trends';
import { computeStats, useLedger } from '../lib/ledger';
import { lastTeamOrderFailures } from '../lib/esiChar';
import { esiErrorState } from '../lib/esiRate';
import { miningWatchView } from '../lib/overlayFeed';
import { parseHaulsFile } from '../lib/hauls';
import { getSystem } from '../lib/mapdata';
import { getType } from '../lib/typedb';
import { destOf, favLabel, sanitizeFavorites } from '../lib/favorites';
import { RELEASE_NOTES } from '../help/releaseNotes';
import { DayBars, Detail, Dot, Empty, FitList, Foot, Head, Hist24, Img, Row, StackBar, charFace, corpLogo, shipRender, typeIcon } from './DashKit';
import { AMBER, GOLD, piTone, signed, type DashletProps } from './DashShared';
import { maxOf } from '../lib/nums';

// the type list is the MARKET's: a capsule is not on it, and a killmail is full of them
const typeName = (id: number) => getType(id)?.name ?? (CAPSULES.has(id) ? 'Capsule' : `type ${id}`);
const sysName = (id: number) => getSystem(id)?.name ?? `System ${id}`;
const rangeWords = (d: number) => (d === 1 ? '24 hours' : `${d} days`);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// ---- HARVEST
function Hauls({ onGo }: DashletProps) {
  const now = useBeat(60_000);
  const file = useResource('hauls-file', async () => parseHaulsFile(await window.appInfo?.hauls?.read()).hauls, 60_000);
  const d = useMemo(() => (file.value ? haulsDigest(file.value, now) : null), [file.value, now]);
  if (!d) return <Empty>Reading your loot log…</Empty>;
  if (d.count === 0) return <Empty>No hauls logged yet — press ＋ haul on a relic or data site in the Σ Summary after you run it, and your own averages start here.</Empty>;
  return (
    <>
      <Head big={iskShort(d.recent)} color="var(--good)" sub={<>{d.recentCount} haul{d.recentCount === 1 ? '' : 's'} in 30 days<span className="dl-dim"> · {iskShort(d.total)} in all ({d.count})</span></>} />
      <Detail>
        <FitList>
          {d.best && <Row onClick={() => onGo('aperture:summary')} title="your best site by average haul"><span className="dl-dim">best</span><span className="dl-grow">{d.best.site}</span><b>{iskShort(d.best.mean)}</b><span className="dl-dim">×{d.best.n}</span></Row>}
          {d.last && <Row onClick={() => onGo('aperture:summary')}><span className="dl-dim">last</span><span className="dl-grow">{d.last.site}</span><b>{iskShort(d.last.isk)}</b><span className="dl-dim">{agoShort(now - d.last.at)}</span></Row>}
        </FitList>
      </Detail>
      <Foot>your own logged loot — what came home, not what the site could hold</Foot>
    </>
  );
}

const MINER_TONE: Record<string, string> = { ok: 'var(--good)', reduced: AMBER, stopped: 'var(--bad)', idle: 'var(--muted)' };
function MiningFleet(_: DashletProps) {
  useBeat(6_000);
  const v = miningWatchView();
  if (!v.running) return <Empty>The multibox overlay is off — the mining watch rides on it. Tools → Multibox overlay settings.</Empty>;
  const working = v.miners.filter((m) => m.status !== 'idle');
  if (working.length === 0) return <Empty>Nobody is mining (or the ⛏ mining alert is switched off in the overlay settings).</Empty>;
  const trouble = working.filter((m) => m.status === 'stopped' || m.status === 'reduced');
  return (
    <>
      <Detail>
        <div className="dl-sub">{v.fleetMove ? <b style={{ color: 'var(--accent)' }}>the whole crew has stopped — moving or unloading</b> : trouble.length > 0 ? <b style={{ color: 'var(--bad)' }}>{trouble.length} of {working.length} not pulling their weight</b> : <b style={{ color: 'var(--good)' }}>all {working.length} miners cycling</b>}</div>
        <FitList>
          {working.map((m) => (
            <Row key={m.charId} title={`${m.charName}: ${m.cur} cycle(s) in the current window, ${m.peak} at their best${m.period ? ` · one cycle every ${Math.round(m.period / 1000)} s` : ''}`}>
              <Img className="dl-face" src={charFace(m.charId)} />
              <span className="dl-grow">{m.charName.split(' ')[0]}</span>
              <span className="dl-dim">{m.cur}/{m.peak} cycles</span>
              <b style={{ color: MINER_TONE[m.status] }}>{m.status}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <Foot>from each miner’s own game log, as the overlay’s mining alert sees it</Foot>
    </>
  );
}

// ---- THEFT
function RaidHot({ spec, cfg, onGo }: DashletProps) {
  const now = useBeat(60_000);
  const days = Number(optionOf(spec, cfg, 'range'));
  const ev = useResource('raid-events', raidEvents, 60_000);
  const d = useMemo(() => (ev.value ? raidHot(ev.value, now, days, 12) : null), [ev.value, now, days]);
  if (!d) return <Empty>Reading the raid log…</Empty>;
  const max = Math.max(1, maxOf(d.rows.map((r) => r.raided)));
  return (
    <>
      <Detail>
        {d.rows.length === 0 && <Empty>No robbery seen in the last {rangeWords(days)}.</Empty>}
        <FitList>
          {d.rows.map((r) => (
            <Row key={r.systemId} onClick={() => onGo('theft:skyhooks')} title={`${sysName(r.systemId)}: robbed ${r.raided}× — last ${agoShort(now - r.lastAt)}`}>
              <span className="dl-grow">{sysName(r.systemId)}</span>
              <span className="dl-meter wide"><i style={{ width: `${(r.raided / max) * 100}%`, background: 'var(--bad)' }} /></span>
              <b>{r.raided}×</b>
              <span className="dl-dim">{agoShort(now - r.lastAt)}</span>
            </Row>
          ))}
        </FitList>
      </Detail>
      <Foot>{d.systems} system{d.systems === 1 ? '' : 's'} robbed · all of New Eden · only while the app runs</Foot>
    </>
  );
}
function RaidHours({ spec, cfg }: DashletProps) {
  const now = useBeat(60_000);
  const days = Number(optionOf(spec, cfg, 'range'));
  const ev = useResource('raid-events', raidEvents, 60_000);
  const d = useMemo(() => (ev.value ? byEveHour(ev.value.filter((e) => e.kind === 'raided' && now - e.t <= days * 86_400_000).map((e) => e.t)) : null), [ev.value, now, days]);
  if (!d) return <Empty>Reading the raid log…</Empty>;
  return (
    <>
      <Head big={d.peak !== null ? `${String(d.peak).padStart(2, '0')}:00` : '—'} color="var(--bad)" sub={d.peak !== null ? <>the busiest EVE hour · {d.total} robberies</> : 'no robbery seen in this range'} />
      <Detail><Hist24 hours={d.hours} color="var(--bad)" peak={d.peak} /></Detail>
      <Foot>when a robbery was SEEN — the watcher looks every 2½ min, while the app runs</Foot>
    </>
  );
}
function RaidOdds({ spec, cfg }: DashletProps) {
  const now = useBeat(60_000);
  const days = Number(optionOf(spec, cfg, 'range'));
  const ev = useResource('raid-events', raidEvents, 60_000);
  const d = useMemo(() => (ev.value ? raidOutcomes(ev.value, now, days) : null), [ev.value, now, days]);
  if (!d) return <Empty>Reading the raid log…</Empty>;
  return (
    <>
      <Head big={d.rate !== null ? `${Math.round(d.rate * 100)}% robbed` : '—'} color={d.rate !== null && d.rate >= 0.5 ? 'var(--bad)' : undefined}
        title="robbed ÷ (robbed + survived). A 'survived' window may still hide a late raid in the minutes the watcher could not see; closes it could not call either way are left out"
        sub={<>{d.raided} robbed · {d.survived} left alone<span className="dl-dim"> · {d.unknown} uncalled</span></>} />
      <Detail>
        <div className="dl-pair">
          <div><span className="dl-dim">typically hit</span><b>{d.medianIntoMin !== null ? `${d.medianIntoMin} min in` : '—'}</b></div>
          <div><span className="dl-dim">windows called</span><b>{d.raided + d.survived}</b></div>
        </div>
      </Detail>
      <Foot>all of New Eden · only the windows watched to their end</Foot>
    </>
  );
}

// ---- PLANETS
const planetsFoot = (now: number) => { const ran = piLastRun(); return <Foot warn={!!ran && now - ran > 30 * 60_000}>{ran ? `planets checked ${agoShort(now - ran)}` : 'not checked yet'}</Foot>; };
const NoPlanets = () => <Empty>{piLastRun() ? 'No planets found on your logged-in characters.' : 'The planet collector has not run yet — it checks every 11 minutes once a character with planets is logged in.'}</Empty>;
function PiResets({ onGo }: DashletProps) {
  const now = useBeat(30_000);
  const planets = piPlanets();
  const d = useMemo(() => extractorResets(planets, now), [planets, now]);
  if (planets.length === 0) return <NoPlanets />;
  const next = d.rows.find((r) => r.expired === 0 && r.at !== null && r.at > now) ?? null;
  return (
    <>
      <Head big={d.expired > 0 ? `${d.expired} stopped` : next ? inShort(next.at! - now) : 'no heads'} color={d.expired > 0 ? 'var(--bad)' : d.within24h > 0 ? AMBER : 'var(--good)'}
        sub={d.expired > 0 ? <>planet{d.expired === 1 ? '' : 's'} with a dead extractor{d.within24h > 0 ? ` · ${d.within24h} more within a day` : ''}</> : next ? <>until the next program ends · {d.within24h} within a day</> : 'no extractor programs running'} />
      <Detail>
        <FitList>
          {d.rows.map((r, i) => (
            <Row key={i} onClick={() => onGo('pi:planets')} title={`${r.planetName} — ${r.expired} of ${r.heads} extractor program(s) ended`}>
              <Dot color={r.expired > 0 ? 'var(--bad)' : r.at !== null && r.at - now <= 86_400_000 ? AMBER : 'var(--good)'} />
              <span className="dl-grow">{r.planetName}</span>
              <span className="dl-dim">{r.characterName.split(' ')[0]}</span>
              <b>{r.expired > 0 ? `${r.expired}/${r.heads} dead` : r.at !== null ? inShort(r.at - now) : '—'}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      {planetsFoot(now)}
    </>
  );
}
function PiStorage({ onGo }: DashletProps) {
  const now = useBeat(30_000);
  const planets = piPlanets();
  const rows = useMemo(() => [...planets].filter((p) => p.capM3 > 0).sort((a, b) => b.fullFrac - a.fullFrac), [planets]);
  if (planets.length === 0) return <NoPlanets />;
  return (
    <>
      <Detail>
        <FitList>
          {rows.map((p, i) => (
            <Row key={i} onClick={() => onGo('pi:planets')} title={p.advice}>
              <span className="dl-grow">{p.planetName}</span>
              <span className="dl-dim">{p.characterName.split(' ')[0]}</span>
              <span className="dl-meter wide"><i style={{ width: `${Math.round(Math.min(1, p.fullFrac) * 100)}%`, background: piTone(p.fullFrac >= 0.999 ? 0 : p.fullFrac >= 0.9 ? 2 : 5) }} /></span>
              <b>{Math.round(p.fullFrac * 100)}%</b>
              <span className="dl-dim" style={{ width: '4.6em', textAlign: 'right' }}>{p.fullFrac >= 0.999 ? 'FULL' : p.hoursToFull !== null ? inShort(p.hoursToFull * 3_600_000) : 'learning'}</span>
            </Row>
          ))}
        </FitList>
      </Detail>
      {planetsFoot(now)}
    </>
  );
}
function PiProducts({ onGo }: DashletProps) {
  const now = useBeat(60_000);
  const planets = piPlanets();
  const d = useMemo(() => piProducts(planets, 12), [planets]);
  if (planets.length === 0) return <NoPlanets />;
  return (
    <>
      <Head big={iskShort(d.value)} sub={<>on the ground · {d.kinds} product{d.kinds === 1 ? '' : 's'} on {planets.length} planets</>} title="what the stored contents would fetch at the Jita ask — before hauling, tax and the time to sell" />
      <Detail>
        <FitList>
          {d.rows.map((r) => (
            <Row key={r.typeId} onClick={() => onGo('pi:planets')}>
              <Img src={typeIcon(r.typeId)} />
              <span className="dl-grow">{r.name}</span>
              <span className="dl-dim">{r.amount.toLocaleString()}</span>
              <b>{iskShort(r.value)}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      {planetsFoot(now)}
    </>
  );
}
function PiPilots({ onGo }: DashletProps) {
  const now = useBeat(60_000);
  const planets = piPlanets();
  const rows = useMemo(() => piByPilot(planets), [planets]);
  if (planets.length === 0) return <NoPlanets />;
  return (
    <>
      <Detail>
        <FitList>
          {rows.map((r) => (
            <Row key={r.characterName} onClick={() => onGo('pi:planets')} title={`${r.characterName}: ${r.planets} planets, fullest ${Math.round(r.fullest * 100)}%`}>
              <Dot color={r.now > 0 ? 'var(--bad)' : 'var(--good)'} />
              <span className="dl-grow">{r.characterName}</span>
              <span className="dl-dim">{r.planets} planets</span>
              <b style={r.now > 0 ? { color: 'var(--bad)' } : undefined}>{r.now > 0 ? `${r.now} now` : 'ok'}</b>
              <b style={{ width: '4.4em', textAlign: 'right' }}>{iskShort(r.value)}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      {planetsFoot(now)}
    </>
  );
}

// ---- WEALTH
function WealthLayers(_: DashletProps) {
  const now = useBeat(60_000);
  const series = useResource('networth-series', loadNetWorthSeries, 5 * 60_000);
  const d = useMemo(() => (series.value ? layersDigest(series.value) : null), [series.value]);
  if (!series.value) return <Empty>Reading the value history…</Empty>;
  if (!d) return <Empty>No value snapshots yet — the first is taken about half an hour after a trading character logs in.</Empty>;
  return (
    <>
      <Detail>
        <StackBar parts={d.rows.map((r) => ({ key: r.key, label: r.label, color: r.color, frac: r.frac, text: iskShort(r.value) }))} />
        <FitList>
          {d.rows.map((r) => (
            <Row key={r.key}><Dot color={r.color} /><span className="dl-grow">{r.label}</span><span className="dl-dim">{(r.frac * 100).toFixed(0)}%</span><b style={{ width: '4.6em', textAlign: 'right' }}>{iskShort(r.value)}</b></Row>
          ))}
        </FitList>
      </Detail>
      <Foot warn={now - d.at > 3 * 3_600_000}>{iskShort(d.total)} in all · goods at Jita's measured sale prices · snapshot {agoShort(now - d.at)}</Foot>
    </>
  );
}
function Wallets(_: DashletProps) {
  const now = useBeat(60_000);
  const chars = useAuth((s) => s.characters);
  const d = useMemo(() => walletsDigest(chars.map((c) => ({ characterId: c.characterId, name: shortLabel(c), refreshToken: c.refreshToken, expiresAt: c.expiresAt, lastSync: c.lastSync, wallet: c.wallet }))), [chars]);
  if (chars.length === 0) return <Empty>No characters logged in.</Empty>;
  const oldest = d.rows.reduce<number | null>((t, r) => (r.lastSync !== null && (t === null || r.lastSync < t) ? r.lastSync : t), null);
  return (
    <>
      <Head big={iskShort(d.total)} sub={<>across {d.rows.length} wallet{d.rows.length === 1 ? '' : 's'}{d.unknown > 0 ? <span className="dl-dim"> · {d.unknown} not read yet</span> : ''}</>} />
      <Detail>
        <FitList>
          {d.rows.map((r) => (
            <Row key={r.characterId} title={r.lastSync ? `as of the last sync, ${agoShort(now - r.lastSync)}` : undefined}>
              <Img className="dl-face" src={charFace(r.characterId)} /><span className="dl-grow">{r.name}</span><b>{iskShort(r.wallet)}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <Foot warn={oldest !== null && now - oldest > 6 * 3_600_000}>{oldest !== null ? `as of each character’s last sync · oldest ${agoShort(now - oldest)}` : 'not synced yet'}</Foot>
    </>
  );
}
function ProfitDays({ spec, cfg }: DashletProps) {
  const now = useBeat(60_000);
  const days = Number(optionOf(spec, cfg, 'range'));
  const lv = useLedger((st) => st.version);
  const stats = useResource(`ledger-stats-${days}-${lv}`, async () => computeStats(Date.now() - days * 86_400_000), 2 * 60_000);
  const d = useMemo(() => (stats.value ? profitByDay(stats.value.sales, now, days) : null), [stats.value, now, days]);
  if (!d) return <Empty>Reading the wallet ledger…</Empty>;
  return (
    <>
      <Head big={signed(d.profit)} color={d.profit >= 0 ? 'var(--good)' : 'var(--bad)'} title="realized profit (first in, first out, after fees and tax), by the EVE day of the sale"
        sub={<>in {days} days · {iskShort(d.revenue)} sold{d.best ? <span className="dl-dim"> · best {d.best.day.slice(5)} {signed(d.best.profit)}</span> : ''}</>} />
      <Detail><DayBars bars={d.bars.map((b) => ({ day: b.day, v: b.profit }))} fmt={signed} /></Detail>
      <Foot>one bar per EVE day, oldest on the left · sales with no cost basis add no profit</Foot>
    </>
  );
}
function Inventory({ onGo }: DashletProps) {
  const now = useBeat(60_000);
  const lv = useLedger((st) => st.version);
  const stats = useResource(`ledger-stats-all-${lv}`, async () => computeStats(0), 5 * 60_000);
  const d = useMemo(() => (stats.value ? inventoryDigest(stats.value.inventory, 12) : null), [stats.value]);
  if (!d) return <Empty>Reading the wallet ledger…</Empty>;
  if (d.lots === 0) return <Empty>The ledger holds no unsold stock — everything it saw you buy has sold.</Empty>;
  return (
    <>
      <Head big={iskShort(d.atCost)} title="what the ledger saw you buy and has not yet seen you sell, at what you paid — not what it would fetch today"
        sub={<>at cost · {d.items} item{d.items === 1 ? '' : 's'}{d.oldestAt ? <span className="dl-dim"> · oldest bought {agoShort(now - d.oldestAt)}</span> : ''}</>} />
      <Detail>
        <FitList>
          {d.top.map((r) => (
            <Row key={r.typeId} onClick={() => onGo('trade:dashboard')} title={`${typeName(r.typeId)} — ${r.qty.toLocaleString()} units, oldest lot bought ${agoShort(now - r.oldestAt)}`}>
              <Img src={typeIcon(r.typeId)} /><span className="dl-grow">{typeName(r.typeId)}</span><span className="dl-dim">{agoShort(now - r.oldestAt).replace(' ago', '')}</span><b>{iskShort(r.cost)}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <Foot>from your wallet’s own buys and sells · stock bought before the app watched is not here</Foot>
    </>
  );
}

// ---- MARKET
const EVENT_WORDS: Record<string, [string, string]> = {
  outbid_sell: ['undercut', AMBER], outbid_buy: ['outbid', AMBER], sale: ['sold', 'var(--good)'],
  rival_new: ['new rival', 'var(--accent)'], rival_reprice: ['rival repriced', 'var(--accent)'], rival_gone: ['rival gone', 'var(--muted)'],
};
function MarketEvents({ onGo }: DashletProps) {
  const now = useBeat(60_000);
  const ev = useResource('trend-events', loadTrendEvents, 2 * 60_000);
  const d = useMemo(() => (ev.value ? eventsDigest(ev.value, now, 24, 14) : null), [ev.value, now]);
  if (!d) return <Empty>Reading the trend watcher’s events…</Empty>;
  const hits = d.outbidSell + d.outbidBuy;
  return (
    <>
      <Head big={`${hits} beaten`} color={hits > 0 ? AMBER : 'var(--good)'} title="orders of yours a rival beat in the last 24 hours, as the trend watcher saw it happen"
        sub={<>{d.sales} sale{d.sales === 1 ? '' : 's'}{d.sales > 0 ? ` for ${iskShort(d.salesIsk)}` : ''}<span className="dl-dim"> · {d.rivalMoves} rival move{d.rivalMoves === 1 ? '' : 's'}</span></>} />
      <Detail>
        <FitList>
          {d.recent.map((e, i) => (
            <Row key={i} onClick={() => onGo('trade:trends')}>
              <Dot color={EVENT_WORDS[e.kind]?.[1] ?? 'var(--muted)'} />
              <span className="dl-grow">{typeName(e.typeId)}</span>
              <span className="dl-dim">{EVENT_WORDS[e.kind]?.[0] ?? e.kind}</span>
              <b>{agoShort(now - e.t).replace(' ago', '')}</b>
            </Row>
          ))}
          {d.recent.length === 0 && <span className="dl-dim">a quiet day — nothing in the last 24 hours</span>}
        </FitList>
      </Detail>
      <Foot>the last 24 hours · seen while the app was running</Foot>
    </>
  );
}
function BestSellers({ spec, cfg, onGo }: DashletProps) {
  const days = Number(optionOf(spec, cfg, 'range'));
  const lv = useLedger((st) => st.version);
  const stats = useResource(`ledger-stats-${days}-${lv}`, async () => computeStats(Date.now() - days * 86_400_000), 2 * 60_000);
  const d = useMemo(() => (stats.value ? bestSellers(stats.value.sales, 12) : null), [stats.value]);
  if (!d) return <Empty>Reading the wallet ledger…</Empty>;
  if (d.items === 0) return <Empty>No sales in the last {rangeWords(days)}.</Empty>;
  return (
    <>
      <Detail>
        <FitList>
          {d.rows.map((r) => (
            <Row key={r.typeId} onClick={() => onGo('trade:dashboard')} title={`${typeName(r.typeId)} — ${r.qty.toLocaleString()} sold in ${r.sales} sale(s) for ${iskShort(r.revenue)}`}>
              <Img src={typeIcon(r.typeId)} /><span className="dl-grow">{typeName(r.typeId)}</span><span className="dl-dim">{iskShort(r.revenue)}</span>
              <b style={{ color: r.profit >= 0 ? 'var(--good)' : 'var(--bad)', width: '4.8em', textAlign: 'right' }}>{signed(r.profit)}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <Foot warn={!!d.worst}>{d.worst ? `worst: ${typeName(d.worst.typeId)} ${signed(d.worst.profit)} · ` : ''}realized profit, {d.items} item{d.items === 1 ? '' : 's'} sold</Foot>
    </>
  );
}
function Watchlist({ onGo }: DashletProps) {
  const now = useBeat(60_000);
  const ids = useApp((s) => s.watchlist);
  const book = usePrices((s) => s.book);
  const at = usePrices((s) => s.lastUpdated);
  if (ids.length === 0) return <Empty>Nothing starred — star an item in Trade → Item Explorer.</Empty>;
  const jita = book['jita'] ?? {};
  return (
    <>
      <Detail>
        <Row className="dl-cols"><span className="dl-grow" /><span className="dl-dim" style={{ width: '5em', textAlign: 'right' }}>lowest ask</span><span className="dl-dim" style={{ width: '5em', textAlign: 'right' }}>highest bid</span></Row>
        <FitList>
          {ids.map((id) => {
            const a = jita[id];
            return (
              <Row key={id} onClick={() => { useApp.getState().select(id); onGo('trade:explorer'); }} title={`${typeName(id)} in Jita — listings, not executed prices`}>
                <Img src={typeIcon(id)} /><span className="dl-grow">{typeName(id)}</span>
                <b style={{ width: '5em', textAlign: 'right' }}>{a?.sell?.min ? iskShort(a.sell.min) : '—'}</b>
                <span className="dl-dim" style={{ width: '5em', textAlign: 'right' }}>{a?.buy?.max ? iskShort(a.buy.max) : '—'}</span>
              </Row>
            );
          })}
        </FitList>
      </Detail>
      <Foot warn={!!at && now - at > 30 * 60_000}>Jita’s book — listings, not what anything sold for{at ? ` · read ${agoShort(now - at)}` : ''}</Foot>
    </>
  );
}

// ---- BATTLE + CORP: everything here reads the corp's public killmails the app keeps — the same
// archive as the Leaderboard tab, kept current by itself (v0.212.0: nobody has to open the tab first)
/** the pilots' stats for a window, computed ONCE for every dashlet that asks (v0.211.0): ten corp
 * dashlets on a board used to mean ten passes over every killmail held, every minute */
const statsCache = new Map<string, PilotStats[]>();
function boardStats(d: BoardData, since: number | null): PilotStats[] {
  const key = `${d.corpId}:${d.rev}:${since}`;
  let v = statsCache.get(key);
  if (!v) {
    v = pilotStats(inputFor(d, since, null));
    if (statsCache.size >= 12) statsCache.delete(statsCache.keys().next().value as string);
    statsCache.set(key, v);
  }
  return v;
}
const NoBoard = () => <Empty>Reading the corp’s public killmails — this fills in by itself in a moment. It needs one logged-in pilot, to know which corporation is yours.</Empty>;
function useBoard(range: number): { d: BoardData | null; since: number | null; short: boolean; now: number } {
  const now = useBeat(60_000);
  const held = useResource('board-held', homeBoardData, 60_000);
  const cov = held.value ? coverage(held.value.heldSince, Math.floor(now / 60_000) * 60_000, range) : null;
  return { d: held.value, since: cov?.since ?? null, short: cov?.short ?? false, now };
}
const BoardFoot = ({ d, since, short, now, lead = 'public killmails' }: { d: BoardData; since: number | null; short: boolean; now: number; lead?: string }) => (
  <Foot warn={short || now - d.at > 6 * 3_600_000}>{lead} · read {agoShort(now - d.at)}{short && since ? ` · only complete since ${day(since)}` : ''}</Foot>
);
const MEDAL = ['🥇', '🥈', '🥉'];

function LbMedals({ spec, size, cfg, onGo }: DashletProps) {
  const { d, since, short, now } = useBoard(Number(optionOf(spec, cfg, 'range')));
  const medals = useMemo(() => (d ? medalTable(boardStats(d, since)) : []), [d, since]);
  if (!d) return <NoBoard />;
  const mine = new Set(d.myChars);
  const best = medals.find((m) => mine.has(m.char)) ?? null;
  const name = (id: number) => d.names.get(id) ?? `pilot ${id}`;
  return (
    <>
      <Head big={best ? `#${best.rank}` : '—'} color={best && best.rank <= 3 ? GOLD : undefined} sub={best ? <>{name(best.char)} · {best.points} pts<span className="dl-dim"> · of {medals.length}</span></> : 'none of your pilots has a medal'} />
      <Detail>
        <FitList>
          {medals.map((m) => (
            <Row key={m.char} onClick={() => onGo('battle:board')} title={`${name(m.char)}: ${m.gold} gold, ${m.silver} silver, ${m.bronze} bronze`}>
              <span className="dl-rank">{m.rank <= 3 ? MEDAL[m.rank - 1] : m.rank}</span>
              <Img className="dl-face" src={charFace(m.char)} />
              <span className="dl-grow" style={mine.has(m.char) ? { color: GOLD } : undefined}>{name(m.char)}{mine.has(m.char) ? ' ★' : ''}</span>
              <b>{m.points} pts</b>
            </Row>
          ))}
          {medals.length === 0 && <span className="dl-dim">no corp pilot on a killmail in this window</span>}
        </FitList>
      </Detail>
      {size !== 'S' ? <BoardFoot d={d} since={since} short={short} now={now} /> : <Foot warn={short}>public killmails · {agoShort(now - d.at)}</Foot>}
    </>
  );
}
function LbBoard({ spec, cfg, onGo }: DashletProps) {
  const { d, since, short, now } = useBoard(Number(optionOf(spec, cfg, 'range')));
  const board = BOARDS.find((b) => b.id === optionOf(spec, cfg, 'board')) ?? BOARDS[0];
  const rows = useMemo(() => (d ? rankBoard(boardStats(d, since), board) : []), [d, since, board]);
  if (!d) return <NoBoard />;
  const mine = new Set(d.myChars);
  const name = (id: number) => d.names.get(id) ?? `pilot ${id}`;
  const top = rows[0] ?? null;
  return (
    <>
      <Head big={top ? fmtBoardValue(top.value, board.unit, iskShort) : '—'} color={top ? GOLD : undefined} title={board.blurb}
        sub={top ? <>{board.icon} {name(top.char)}{mine.has(top.char) ? ' ★' : ''}</> : 'nobody on this board yet'} />
      <Detail>
        <FitList>
          {rows.map((r) => (
            <Row key={r.char} onClick={() => onGo('battle:board')}>
              <span className="dl-rank">{board.honour && r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span>
              <Img className="dl-face" src={charFace(r.char)} />
              <span className="dl-grow" style={mine.has(r.char) ? { color: GOLD } : undefined}>{name(r.char)}{mine.has(r.char) ? ' ★' : ''}</span>
              <b>{fmtBoardValue(r.value, board.unit, iskShort)}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <BoardFoot d={d} since={since} short={short} now={now} lead={board.blurb} />
    </>
  );
}
function CorpTotals({ spec, cfg }: DashletProps) {
  const { d, since, short, now } = useBoard(Number(optionOf(spec, cfg, 'range')));
  const t = useMemo(() => (d ? corpTotals(d.mails, d.corpId, since) : null), [d, since]);
  if (!d || !t) return <NoBoard />;
  return (
    <>
      <Head big={t.efficiency !== null ? `${(t.efficiency * 100).toFixed(1)}%` : '—'} color={t.efficiency === null ? undefined : t.efficiency >= 0.5 ? 'var(--good)' : 'var(--bad)'}
        title="ISK destroyed ÷ (destroyed + lost), from the corp's public killmails in the window" sub={<>ISK efficiency · <b>{t.kills}</b> kills, <b>{t.losses}</b> losses</>} />
      <Detail>
        <div className="dl-pair wrap">
          <div><span className="dl-dim">destroyed</span><b style={{ color: 'var(--good)' }}>{t.unpriced > 0 ? '≥' : ''}{iskShort(t.destroyed)}</b></div>
          <div><span className="dl-dim">lost</span><b style={{ color: 'var(--bad)' }}>{iskShort(t.lost)}</b></div>
          <div><span className="dl-dim">pilots out</span><b>{t.pilots}</b></div>
          <div title={t.biggestKill ? typeName(t.biggestKill.ship) : undefined}><span className="dl-dim">best kill</span><b>{t.biggestKill ? iskShort(t.biggestKill.value) : '—'}</b></div>
        </div>
      </Detail>
      <BoardFoot d={d} since={since} short={short} now={now} lead={d.corpName || 'the corp'} />
    </>
  );
}
function KillFeed({ onGo }: DashletProps) {
  const { d, since, short, now } = useBoard(30);
  const rows = useMemo(() => (d ? killFeed(d.mails, d.corpId, 16) : []), [d]);
  if (!d) return <NoBoard />;
  return (
    <>
      <Detail>
        <FitList>
          {rows.map((r) => (
            <Row key={r.id} onClick={() => onGo('battle:reports')} title={`${r.kind === 'kill' ? 'killed' : 'lost'}: ${typeName(r.ship)} — ${iskShort(r.value)}${r.kind === 'loss' ? ` (${d.names.get(r.char) ?? 'a corp pilot'})` : ` · ${r.pilots} corp pilot(s) on it`}`}>
              <Img src={shipRender(r.ship)} className="dl-icon ship" />
              <span className="dl-grow">{typeName(r.ship)}</span>
              <span className="dl-dim">{agoShort(now - r.t).replace(' ago', '')}</span>
              <b style={{ color: r.kind === 'kill' ? 'var(--good)' : 'var(--bad)', width: '4.6em', textAlign: 'right' }}>{r.kind === 'kill' ? '+' : '−'}{r.value ? iskShort(r.value) : '?'}</b>
            </Row>
          ))}
          {rows.length === 0 && <span className="dl-dim">no kills or losses held</span>}
        </FitList>
      </Detail>
      <BoardFoot d={d} since={since} short={short} now={now} lead="green = a kill, red = a loss" />
    </>
  );
}
function MyRecord({ spec, cfg, onGo }: DashletProps) {
  const { d, since, short, now } = useBoard(Number(optionOf(spec, cfg, 'range')));
  const stats = useMemo(() => (d ? boardStats(d, since) : []), [d, since]);
  if (!d) return <NoBoard />;
  const mine = stats.filter((s) => d.myChars.includes(s.char));
  const kills = mine.reduce((t, s) => t + s.kills, 0), losses = mine.reduce((t, s) => t + s.losses, 0);
  const share = mine.reduce((t, s) => t + s.iskShare, 0), lost = mine.reduce((t, s) => t + s.iskLost, 0);
  return (
    <>
      <Head big={`${kills} – ${losses}`} color={kills >= losses ? 'var(--good)' : 'var(--bad)'} title="kills – losses of your own characters on the corp's public killmails; ISK destroyed is by damage share, as on the Leaderboard"
        sub={<><b style={{ color: 'var(--good)' }}>{iskShort(share)}</b> destroyed · <b style={{ color: 'var(--bad)' }}>{iskShort(lost)}</b> lost</>} />
      <Detail>
        <FitList>
          {mine.map((s) => (
            <Row key={s.char} onClick={() => onGo('battle:board')} title={`${d.names.get(s.char) ?? ''}: ${s.finalBlows} final blow(s), ${s.fights} fight(s), usually in a ${s.hull ? typeName(s.hull) : '—'}`}>
              <Img className="dl-face" src={charFace(s.char)} />
              <span className="dl-grow">{d.names.get(s.char) ?? `pilot ${s.char}`}</span>
              <span className="dl-dim">{s.fights} fight{s.fights === 1 ? '' : 's'}</span>
              <b>{s.kills} – {s.losses}</b>
            </Row>
          ))}
          {mine.length === 0 && <span className="dl-dim">none of your pilots is on a killmail in this window</span>}
        </FitList>
      </Detail>
      <BoardFoot d={d} since={since} short={short} now={now} />
    </>
  );
}
function FightHours({ spec, cfg }: DashletProps) {
  const { d, since, short, now } = useBoard(Number(optionOf(spec, cfg, 'range')));
  const h = useMemo(() => (d ? byEveHour(fightTimes(d.mails, d.corpId, since)) : null), [d, since]);
  if (!d || !h) return <NoBoard />;
  return (
    <>
      <Head big={h.peak !== null ? `${String(h.peak).padStart(2, '0')}:00` : '—'} sub={h.peak !== null ? <>the corp’s busiest EVE hour · {h.total} killmails</> : 'no killmails in this window'} />
      <Detail><Hist24 hours={h.hours} color="var(--accent)" peak={h.peak} /></Detail>
      <BoardFoot d={d} since={since} short={short} now={now} lead="kills and losses by EVE hour" />
    </>
  );
}
function CorpHulls({ spec, cfg, onGo }: DashletProps) {
  const { d, since, short, now } = useBoard(Number(optionOf(spec, cfg, 'range')));
  const h = useMemo(() => (d ? hullsFlown(d.mails, d.corpId, since, 14) : null), [d, since]);
  if (!d || !h) return <NoBoard />;
  const max = Math.max(1, maxOf(h.rows.map((r) => r.uses)));
  return (
    <>
      <Detail>
        <FitList>
          {h.rows.map((r) => (
            <Row key={r.ship} onClick={() => onGo('battle:board')} title={`${typeName(r.ship)}: on ${r.uses} killmail(s), flown by ${r.pilots} pilot(s), ${r.lost} lost`}>
              <Img src={shipRender(r.ship)} className="dl-icon ship" />
              <span className="dl-grow">{typeName(r.ship)}</span>
              <span className="dl-meter"><i style={{ width: `${(r.uses / max) * 100}%`, background: 'var(--accent)' }} /></span>
              <b>{r.uses}</b>
              <span className="dl-dim" style={{ width: '3.4em', textAlign: 'right', color: r.lost > 0 ? 'var(--bad)' : undefined }}>{r.lost > 0 ? `${r.lost} lost` : ''}</span>
            </Row>
          ))}
          {h.rows.length === 0 && <span className="dl-dim">no corp pilot on a killmail in this window</span>}
        </FitList>
      </Detail>
      <BoardFoot d={d} since={since} short={short} now={now} lead={`${h.hulls} hull${h.hulls === 1 ? '' : 's'} seen · one use per pilot per killmail`} />
    </>
  );
}
function CorpEnemies({ spec, cfg, onGo }: DashletProps) {
  const { d, since, short, now } = useBoard(Number(optionOf(spec, cfg, 'range')));
  const e = useMemo(() => (d ? enemies(d.mails, d.corpId, since, 14) : null), [d, since]);
  if (!d || !e) return <NoBoard />;
  return (
    <>
      <Detail>
        <FitList>
          {e.rows.map((r) => (
            <Row key={r.corp} onClick={() => { window.open(`https://zkillboard.com/corporation/${r.corp}/`, '_blank'); void onGo; }} title={`corporation ${r.corp} — ${r.killed} of theirs killed (${iskShort(r.destroyed)}), on ${r.lostTo} of our losses (${iskShort(r.lost)}) · opens their zKillboard page`}>
              <Img src={corpLogo(r.corp)} className="dl-icon corp" />
              <span className="dl-grow"><b style={{ color: 'var(--good)' }}>{r.killed}</b> <span className="dl-dim">killed</span> · <b style={{ color: 'var(--bad)' }}>{r.lostTo}</b> <span className="dl-dim">losses</span></span>
              <b>{iskShort(r.destroyed + r.lost)}</b>
            </Row>
          ))}
          {e.rows.length === 0 && <span className="dl-dim">nobody met in this window</span>}
        </FitList>
      </Detail>
      <BoardFoot d={d} since={since} short={short} now={now} lead={`${e.corps} corporation${e.corps === 1 ? '' : 's'} met · hover a logo’s row for the numbers`} />
    </>
  );
}

function LbMovers({ spec, cfg, onGo }: DashletProps) {
  const range = Number(optionOf(spec, cfg, 'range'));
  const { d, since, short, now } = useBoard(range);
  const view = useMemo(() => {
    if (!d || since === null) return null;
    const len = range * 86_400_000;
    const before = { since: since - len, until: since };
    // an arrow against a window that is not held whole would be a guess
    if (short || !beforeIsHeld(d.heldSince, before)) return { rows: [], held: false };
    const cur = medalTable(boardStats(d, since));
    const moves = rankMoves(cur, medalTable(pilotStats(inputFor(d, before.since, before.until))));
    return { held: true, rows: cur.map((m) => ({ ...m, move: moves.get(m.char) ?? null })).filter((m) => m.move !== 0).sort((a, b) => (b.move ?? 0.5) - (a.move ?? 0.5) || a.rank - b.rank) };
  }, [d, since, short, range]);
  if (!d) return <NoBoard />;
  const mine = new Set(d.myChars);
  const name = (id: number) => d.names.get(id) ?? `pilot ${id}`;
  return (
    <>
      <Detail>
        {view && !view.held && <Empty>The window before is not held whole yet, so there is nothing honest to compare with. It fills as the app is used — or ⤓ reach further back in the Leaderboard.</Empty>}
        {view?.held && view.rows.length === 0 && <Empty>Nobody moved on the medals table since the window before.</Empty>}
        <FitList>
          {(view?.rows ?? []).map((m) => (
            <Row key={m.char} onClick={() => onGo('battle:board')} title={`${name(m.char)}: now #${m.rank} with ${m.points} pts`}>
              <b style={{ width: '2.8em', color: m.move === null ? 'var(--accent)' : m.move > 0 ? 'var(--good)' : 'var(--bad)' }}>{m.move === null ? 'new' : m.move > 0 ? `▲${m.move}` : `▼${-m.move}`}</b>
              <Img className="dl-face" src={charFace(m.char)} />
              <span className="dl-grow" style={mine.has(m.char) ? { color: GOLD } : undefined}>{name(m.char)}{mine.has(m.char) ? ' ★' : ''}</span>
              <span className="dl-dim">#{m.rank}</span><b>{m.points} pts</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <BoardFoot d={d} since={since} short={short} now={now} lead="places on the medals table, against the window before" />
    </>
  );
}
function CorpRecords({ spec, cfg, onGo }: DashletProps) {
  const { d, since, short, now } = useBoard(Number(optionOf(spec, cfg, 'range')));
  const h = useMemo(() => (d ? hallOfFame(inputFor(d, since, null)) : null), [d, since]);
  if (!d || !h) return <NoBoard />;
  const who = (chars: number[]) => (chars.length === 0 ? '' : chars.length <= 2 ? chars.map((c) => d.names.get(c) ?? `pilot ${c}`).join(' & ') : `${d.names.get(chars[0]) ?? `pilot ${chars[0]}`} +${chars.length - 1}`);
  const rows: [string, string, string, string][] = [];
  if (h.biggestKill) rows.push(['🐋', 'biggest kill', iskShort(h.biggestKill.value), `${typeName(h.biggestKill.ship ?? 0)} · ${who(h.biggestKill.chars)}`]);
  if (h.hardestHit) rows.push(['🧨', 'hardest hit', fmtBoardValue(h.hardestHit.value, 'dmg', iskShort), who(h.hardestHit.chars)]);
  if (h.longestStreak) rows.push(['🔥', 'kill streak', `${h.longestStreak.value} in a row`, who(h.longestStreak.chars)]);
  if (h.mostKillsInFight) rows.push(['⚔', 'kills in one fight', String(h.mostKillsInFight.value), who(h.mostKillsInFight.chars)]);
  if (h.biggestFight) rows.push(['🛡', 'biggest turnout', `${h.biggestFight.pilots} pilots`, `${h.biggestFight.kills} kills, ${h.biggestFight.losses} losses`]);
  if (h.busiestDay) rows.push(['📅', 'busiest day', `${h.busiestDay.value} kills`, h.busiestDay.day]);
  if (h.biggestLoss) rows.push(['💎', 'biggest loss', iskShort(h.biggestLoss.value), `${typeName(h.biggestLoss.ship ?? 0)} · ${who(h.biggestLoss.chars)}`]);
  return (
    <>
      <Detail>
        {rows.length === 0 && <Empty>No killmails in this window.</Empty>}
        <FitList>
          {rows.map(([icon, what, value, by]) => (
            <Row key={what} onClick={() => onGo('battle:board')} title={`${what}: ${value} — ${by}`}><span style={{ width: '1.5em', textAlign: 'center' }}>{icon}</span><span className="dl-dim" style={{ width: '7.6em' }}>{what}</span><b>{value}</b><span className="dl-grow dl-dim" style={{ textAlign: 'right' }}>{by}</span></Row>
          ))}
        </FitList>
      </Detail>
      <BoardFoot d={d} since={since} short={short} now={now} />
    </>
  );
}
function CorpDaysDash({ spec, cfg }: DashletProps) {
  const { d, since, short, now } = useBoard(Number(optionOf(spec, cfg, 'range')));
  const days = useMemo(() => (d ? corpDays({ mails: d.mails, corpId: d.corpId, since }, now) : []), [d, since, now]);
  if (!d) return <NoBoard />;
  const kills = days.reduce((t, x) => t + x.kills, 0), losses = days.reduce((t, x) => t + x.losses, 0);
  const max = Math.max(1, maxOf(days.map((x) => Math.max(x.kills, x.losses))));
  const best = days.reduce<typeof days[number] | null>((b, x) => (x.kills > (b?.kills ?? 0) ? x : b), null);
  return (
    <>
      <Head big={`${kills} – ${losses}`} color={kills >= losses ? 'var(--good)' : 'var(--bad)'} sub={<>kills – losses over {days.length} day{days.length === 1 ? '' : 's'}{best ? <span className="dl-dim"> · best {best.day.slice(5)} with {best.kills}</span> : ''}</>} />
      <Detail>
        <div className="dl-days">
          {days.map((x) => (
            <div key={x.day} title={`${x.day} — ${x.kills} kill(s) for ${iskShort(x.destroyed)}, ${x.losses} loss(es) for ${iskShort(x.lost)}`}>
              <span className="up"><i style={{ height: `${(x.kills / max) * 100}%` }} /></span><span className="down"><i style={{ height: `${(x.losses / max) * 100}%` }} /></span>
            </div>
          ))}
        </div>
      </Detail>
      <BoardFoot d={d} since={since} short={short} now={now} lead="kills above the line, losses below · one bar per EVE day" />
    </>
  );
}

// ---- PILOTS
function Logins(_: DashletProps) {
  const now = useBeat(30_000);
  const chars = useAuth((s) => s.characters);
  const d = useMemo(() => loginsDigest(chars.map((c) => ({ characterId: c.characterId, name: shortLabel(c), refreshToken: c.refreshToken, expiresAt: c.expiresAt, lastSync: c.lastSync, wallet: c.wallet })), lastTeamOrderFailures()), [chars]);
  if (chars.length === 0) return <Empty>No characters logged in — ⚙ Settings → add a character.</Empty>;
  return (
    <>
      <Head big={d.relogin > 0 ? `${d.relogin} to log in` : 'all logged in'} color={d.relogin > 0 ? 'var(--bad)' : 'var(--good)'}
        title="a character whose EVE session has ended is invisible to the app: its orders, wallet and planets silently drop out. ⚙ Settings → their card → log out, then log back in"
        sub={<>{chars.length} character{chars.length === 1 ? '' : 's'}</>} />
      <Detail>
        <FitList>
          {d.rows.map((r) => (
            <Row key={r.characterId} title={r.state === 'relogin' ? 'session ended — ⚙ Settings → their card → log out, then log back in' : r.lastSync ? `last synced ${agoShort(now - r.lastSync)}` : undefined}>
              <Img className="dl-face" src={charFace(r.characterId)} /><span className="dl-grow">{r.name}</span>
              <span className="dl-dim">{r.lastSync ? agoShort(now - r.lastSync) : ''}</span>
              <b style={{ color: r.state === 'ok' ? 'var(--good)' : 'var(--bad)' }}>{r.state === 'ok' ? 'ok' : 're-login'}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
    </>
  );
}

// ---- UTILITY
function EsiBudget(_: DashletProps) {
  useBeat(2_000);
  const s = esiErrorState('bulk');
  const left = s.remain;
  return (
    <>
      <Head big={s.hardBlocked ? 'closed' : left !== null ? `${left}/100` : '—'} color={s.hardBlocked || (left !== null && left < 30) ? 'var(--bad)' : left !== null && left < 70 ? AMBER : 'var(--good)'}
        title="EVE counts errored responses against a shared budget of 100 per minute and closes every route when it runs out. The app sheds its least important traffic first."
        sub={s.hardBlocked ? 'EVE has closed every route for this window' : left !== null ? 'errors left in EVE’s budget this minute' : 'no ESI answer seen yet this session'} />
      <Detail>
        <div className="dl-sub">{s.pausedLanes.length === 0 ? <b style={{ color: 'var(--good)' }}>no lane paused</b> : <>paused: <b style={{ color: AMBER }}>{s.pausedLanes.join(', ')}</b>{s.blockedUntil ? <span className="dl-dim"> · back in {inShort(s.blockedUntil - Date.now())}</span> : ''}</>}</div>
      </Detail>
      <Foot>the bulk market sweep is shed first, the overlay last</Foot>
    </>
  );
}
function Notes({ spec, cfg }: DashletProps) {
  const text = optionOf(spec, cfg, 'text');
  return <Detail className="dl-note">{text ? text : <span className="dl-dim">An empty note. ✎ arrange → ⚙ to write in it.</span>}</Detail>;
}
function Shortcuts({ onGo }: DashletProps) {
  const raw = useApp((s) => s.favorites);
  const favs = useMemo(() => sanitizeFavorites(raw).list.filter((f) => f.dest !== 'home:dashboard'), [raw]);
  if (favs.length === 0) return <Empty>No favorites yet — open a tab you use and press the ☆ after the tab names.</Empty>;
  return (
    <Detail>
      <div className="dl-shortcuts">
        {favs.map((f) => (
          <button key={f.id} className={f.view ? 'view' : ''} onClick={(e) => { e.stopPropagation(); onGo(f.dest, f.view); }} title={`${destOf(f.dest)?.moduleLabel ?? ''} → ${favLabel(f)}`}>
            <span>{destOf(f.dest)?.icon}</span>{favLabel(f)}
          </button>
        ))}
      </div>
    </Detail>
  );
}
function WhatsNew(_: DashletProps) {
  return (
    <>
      <Detail>
        <FitList>
          {RELEASE_NOTES.slice(0, 10).map((n, i) => (
            <Row key={n.version} className="tall" title={n.headline}>
              <b style={{ color: i === 0 ? GOLD : undefined, width: '4.4em' }}>{n.version}</b>
              <span className="dl-wrap">{n.headline}</span>
            </Row>
          ))}
        </FitList>
      </Detail>
      <Foot>you are on {__APP_VERSION__} · the 📜 in the header has every change and why</Foot>
    </>
  );
}

export const MORE_BODIES: Record<string, (p: DashletProps) => JSX.Element> = {
  hauls: Hauls, 'mining-fleet': MiningFleet,
  'raid-hot': RaidHot, 'raid-hours': RaidHours, 'raid-odds': RaidOdds,
  'pi-resets': PiResets, 'pi-storage': PiStorage, 'pi-products': PiProducts, 'pi-pilots': PiPilots,
  'wealth-layers': WealthLayers, wallets: Wallets, 'profit-days': ProfitDays, inventory: Inventory,
  'market-events': MarketEvents, 'best-sellers': BestSellers, watchlist: Watchlist,
  'kill-feed': KillFeed, 'my-record': MyRecord, 'fight-hours': FightHours,
  'lb-medals': LbMedals, 'lb-board': LbBoard, 'corp-totals': CorpTotals, 'corp-hulls': CorpHulls, 'corp-enemies': CorpEnemies, 'lb-movers': LbMovers, 'corp-records': CorpRecords, 'corp-days': CorpDaysDash,
  logins: Logins, 'esi-budget': EsiBudget, notes: Notes, shortcuts: Shortcuts, 'whats-new': WhatsNew,
};
