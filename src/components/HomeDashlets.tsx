// THE DASHLETS THEMSELVES (v0.207.0; re-laid and tripled in v0.209.0). Each one answers a single
// question at a glance, in the versions its catalogue entry lists (lib/dashlets.ts), built from
// the same furniture (DashKit): a headline that is never clipped, detail that shows only whole
// rows, a footer with the age or the source. A figure that cannot be stood behind reads "—" with
// the reason, never a guess. None of them fetches from EVE: they read what the collectors and the
// tabs already hold (lib/homeData.ts). The second half lives in HomeDashlets2.tsx.
import { useMemo, type CSSProperties } from 'react';
import { usePersistHealth } from '../lib/devlog';
import type { DashSize } from '../lib/homeGrid';
import { dashletOf, optionOf } from '../lib/dashlets';
import { useBeat, useChainFeed, useResource } from '../lib/homeData';
import { meterSnapshot } from '../lib/netMeter';
import { clockLine } from '../lib/clock';
import { DIGEST_GROUPS, wayChip, withinHops } from '../lib/chainDigest';
import { agoShort, eveClock, inShort, ordersDigest, pilotsDigest, raidLogDigest, windowsDigest, worthDigest } from '../lib/homeDigests';
import { piBands } from '../lib/homeStats';
import { GROUP_COLOR, classColor } from '../lib/chainViz';
import type { SigGroup } from '../lib/chain';
import { iskShort } from '../lib/format';
import { useApp } from '../lib/store';
import { useAuth, shortLabel } from '../lib/auth';
import { useMyMarket } from '../lib/myMarket';
import { useFreshness } from '../lib/freshness';
import { piPlanets, piLastRun } from '../lib/pi';
import { raidSnapshot, raidEvents } from '../lib/raidWatch';
import { loadNetWorthSeries } from '../lib/networth';
import { computeStats, useLedger } from '../lib/ledger';
import { reloadShipHistory } from '../lib/shipHistory';
import { lastBattleHistory } from '../lib/battleReport';
import { fightWhen } from '../lib/fightSplit';
import { findSystem, getSystem, regionName, reachFrom } from '../lib/mapdata';
import { knownSystem } from '../lib/systemNames';
import { getType } from '../lib/typedb';
import type { SavedView } from '../lib/favorites';
import { Detail, Dot, Empty, FitList, Foot, Head, Img, Row, Spark, charFace, corpLogo } from './DashKit';
import { AMBER, ChainFoot, NoChain, SiteLine, chainView, piTone, signed, type DashletProps } from './DashShared';
import { MORE_BODIES } from './HomeDashlets2';
import { maxOf } from '../lib/nums';

export type { DashletProps } from './DashShared';

// ---- CHAIN
function ChainIsk({ size, onGo }: DashletProps) {
  const { digest: d, fromDisk, note } = useChainFeed();
  const now = useBeat(30_000);
  if (!d) return <NoChain />;
  const groups = DIGEST_GROUPS.filter((g) => (d.byGroup[g]?.count ?? 0) > 0);
  return (
    <>
      <Head big={iskShort(d.totalIsk)} title="if untouched — nothing can tell a fresh site from a half-run one; the Σ Summary names the basis of every figure"
        sub={<>{d.sites} site{d.sites === 1 ? '' : 's'} · {d.systems} systems{d.unvalued > 0 ? <> · <span className="dl-dim">{d.unvalued} unvalued</span></> : ''}</>} />
      <Detail>
        <div className="dl-tiles">
          {groups.map((g) => (
            <button key={g} className="dl-tile" style={{ borderColor: GROUP_COLOR[g] }} onClick={(e) => { e.stopPropagation(); onGo('aperture:summary', chainView({ groups: [g] })); }}
              title={`${g}: ${d.byGroup[g]!.count} site(s)${d.byGroup[g]!.unvalued ? `, ${d.byGroup[g]!.unvalued} unvalued` : ''} — open the Σ Summary on ${g}`}>
              <span style={{ color: GROUP_COLOR[g] }}>{g}</span><b>{d.byGroup[g]!.isk > 0 ? iskShort(d.byGroup[g]!.isk) : '—'}</b><i>{d.byGroup[g]!.count}</i>
            </button>
          ))}
          {groups.length === 0 && <span className="dl-dim">nothing scanned down</span>}
        </div>
        {size === 'L' && <FitList>{d.top.map((s, i) => <SiteLine key={i} s={s} onGo={() => onGo('aperture:summary', chainView({ groups: [s.group] }))} />)}</FitList>}
      </Detail>
      <ChainFoot d={d} fromDisk={fromDisk} note={note} now={now} />
    </>
  );
}

function ChainWays({ size, onGo }: DashletProps) {
  const { digest: d, fromDisk, note } = useChainFeed();
  const now = useBeat(30_000);
  if (!d) return <NoChain />;
  const ways = [...d.ways].sort((a, b) => b.isk - a.isk || a.first.localeCompare(b.first));
  return (
    <>
      <Detail>
        {ways.length === 0 && <Empty>{d.originOk ? 'No holes drawn off home.' : 'Home is not linked on this reading.'}</Empty>}
        <FitList className="dl-ways">
          {ways.map((w) => (
            <button key={w.first} className={`dl-way${size === 'L' ? ' tall' : ''}`} onClick={(e) => { e.stopPropagation(); onGo('aperture:summary', chainView({ branchClasses: w.cls ? [w.cls] : [] })); }}
              title={`${w.first} and what lies beyond it: ${w.systems} system${w.systems === 1 ? '' : 's'}, ${w.sites} site${w.sites === 1 ? '' : 's'} — open the Σ Summary down this way`}>
              <span className="dl-way-top">
                <b style={{ color: classColor(w.cls) }}>{wayChip(w) || '?'}</b>
                <span className="dl-grow">{w.first}</span>
                <span className="dl-dim">{w.systems} sys · {w.sites} site{w.sites === 1 ? '' : 's'}</span>
                <b>{w.isk > 0 ? iskShort(w.isk) : '—'}</b>
              </span>
              {size === 'L' && (
                <span className="dl-way-mix">
                  {DIGEST_GROUPS.filter((g) => (w.byGroup[g] ?? 0) > 0).map((g) => <span key={g}><i style={{ background: GROUP_COLOR[g] }} />{g} <b>{iskShort(w.byGroup[g]!)}</b></span>)}
                  {DIGEST_GROUPS.every((g) => !(w.byGroup[g] ?? 0)) && <span className="dl-dim">nothing valued down this way</span>}
                </span>
              )}
              <span className="dl-bar">{DIGEST_GROUPS.filter((g) => (w.byGroup[g] ?? 0) > 0).map((g) => <i key={g} style={{ background: GROUP_COLOR[g], flexGrow: w.byGroup[g] }} />)}</span>
            </button>
          ))}
        </FitList>
      </Detail>
      <ChainFoot d={d} fromDisk={fromDisk} note={note} now={now} />
    </>
  );
}

function ChainNear({ spec, cfg, onGo }: DashletProps) {
  const { digest: d, fromDisk, note } = useChainFeed();
  const now = useBeat(30_000);
  const jumps = Number(optionOf(spec, cfg, 'jumps'));
  if (!d) return <NoChain />;
  const near = withinHops(d, jumps);
  const max = Math.max(1, maxOf(d.byHop.map((h) => h.isk)));
  return (
    <>
      <Head big={d.originOk ? iskShort(near.isk) : '—'} sub={d.originOk ? <>{near.sites} site{near.sites === 1 ? '' : 's'} within {jumps} jump{jumps === 1 ? '' : 's'} of home</> : 'home is not linked on this reading'} />
      <Detail>
        <FitList>
          {d.byHop.map((h) => (
            <Row key={String(h.hops)} onClick={h.hops !== null ? () => onGo('aperture:summary', chainView({ maxHops: h.hops })) : undefined} title={h.hops === null ? 'systems on the map with no drawn link back to home' : `open the Σ Summary within ${h.hops} jump(s)`}>
              <span className="dl-dim" style={{ width: '4.2em' }}>{h.hops === null ? 'unlinked' : h.hops === 0 ? 'at home' : `${h.hops} jump${h.hops === 1 ? '' : 's'}`}</span>
              <span className="dl-meter wide"><i style={{ width: `${(h.isk / max) * 100}%`, background: h.hops !== null && h.hops <= jumps ? 'var(--accent)' : 'var(--muted)' }} /></span>
              <span className="dl-dim">{h.sites}</span>
              <b>{h.isk > 0 ? iskShort(h.isk) : '—'}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <ChainFoot d={d} fromDisk={fromDisk} note={note} now={now} />
    </>
  );
}

function ChainActivity({ spec, cfg, onGo }: DashletProps) {
  const { digest: d, fromDisk, note } = useChainFeed();
  const now = useBeat(30_000);
  const g = optionOf(spec, cfg, 'activity') as SigGroup;
  if (!d) return <NoChain />;
  const sum = d.byGroup[g];
  const open = () => onGo('aperture:summary', chainView({ groups: [g] }));
  return (
    <>
      <Head big={sum && sum.count > 0 ? `${sum.count} site${sum.count === 1 ? '' : 's'}` : 'none'} color={sum && sum.count > 0 ? GROUP_COLOR[g] : undefined}
        sub={sum && sum.count > 0 ? <>{sum.isk > 0 ? iskShort(sum.isk) : 'nothing valued'}{sum.unvalued > 0 ? <span className="dl-dim"> · {sum.unvalued} unvalued</span> : ''}</> : `no ${g.toLowerCase()} sites on the map`} />
      <Detail><FitList>{(d.nearest[g] ?? []).map((s, i) => <SiteLine key={i} s={s} onGo={open} />)}</FitList></Detail>
      <ChainFoot d={d} fromDisk={fromDisk} note={note} now={now} />
    </>
  );
}

function Finder({ kind, spec, cfg, onGo }: DashletProps & { kind: 'rock' | 'gas' }) {
  const { digest: d, fromDisk, note } = useChainFeed();
  const now = useBeat(30_000);
  const what = optionOf(spec, cfg, kind);
  if (!d) return <NoChain />;
  const r = (kind === 'rock' ? d.rocks : d.gases).find((x) => x.family === what);
  const open = () => onGo('aperture:summary', kind === 'rock' ? chainView({ rocks: [what] }) : chainView({ groups: ['Gas'] }));
  const nearest = r?.where.find((w) => w.hops !== null) ?? null;
  return (
    <>
      <Head big={r ? `${r.sites} site${r.sites === 1 ? '' : 's'}` : 'none today'} color={r ? GROUP_COLOR[kind === 'rock' ? 'Ore' : 'Gas'] : undefined}
        title={r ? `${r.units.toLocaleString()} units of ${what} across the chain, valued on ${what} alone at Jita sell` : `no site on the map carries ${what} right now`}
        sub={r ? <>{iskShort(r.isk)} of {what}{nearest ? <> · nearest <b>{nearest.hops}j</b></> : ''}</> : <>no {what} in the chain</>} />
      <Detail><FitList>{(r?.where ?? []).map((w, i) => <SiteLine key={i} s={w} named={false} onGo={open} />)}</FitList></Detail>
      <ChainFoot d={d} fromDisk={fromDisk} note={note} now={now} />
    </>
  );
}

let jitaReach: Map<number, { jumps: number }> | null = null;
const jumpsToJita = (systemName: string): number | null => {
  if (!jitaReach) { const j = findSystem('Jita'); jitaReach = j ? reachFrom([j.id], Infinity) : new Map(); }
  const s = findSystem(systemName);
  return s ? jitaReach.get(s.id)?.jumps ?? null : null;
};
function ChainExits({ onGo }: DashletProps) {
  const { digest: d, fromDisk, note } = useChainFeed();
  const now = useBeat(30_000);
  const rows = useMemo(() => (d?.exits ?? []).map((e) => ({ ...e, jita: jumpsToJita(e.system) })), [d]);
  if (!d) return <NoChain />;
  // the best way to market: fewest jumps in all, among high-sec exits the chain actually reaches
  const best = rows.filter((r) => r.hops !== null && r.jita !== null && r.cls === 'HS').sort((a, b) => (a.hops! + a.jita!) - (b.hops! + b.jita!))[0] ?? null;
  return (
    <>
      <Head big={best ? `${best.hops! + best.jita!} jump${best.hops! + best.jita! === 1 ? '' : 's'}` : rows.length > 0 ? `${rows.length} exit${rows.length === 1 ? '' : 's'}` : 'no exit'} color={best ? 'var(--good)' : undefined}
        title="jumps through the chain to the exit, plus the shortest gate route from there to Jita (any security — check it before you haul)"
        sub={best ? <>to Jita via <b>{best.system}</b> · {best.hops} in chain + {best.jita} gates</> : rows.length > 0 ? 'no high-sec exit linked to home' : 'no known-space system on the map'} />
      <Detail>
        <FitList>
          {rows.map((r) => (
            <Row key={r.system} onClick={() => onGo('aperture:map')} title={`${r.system} (${r.cls})${r.hops !== null ? ` — ${r.hops} jump(s) from home` : ' — not linked to home'}${r.jita !== null ? `, ${r.jita} gate jumps to Jita` : ''}`}>
              <b style={{ color: classColor(r.cls) }}>{r.cls}</b>
              <span className="dl-grow">{r.system}</span>
              <span className="dl-dim">{r.hops !== null ? `${r.hops}j in chain` : 'unlinked'}</span>
              <b>{r.jita !== null ? `${r.jita} to Jita` : '—'}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <ChainFoot d={d} fromDisk={fromDisk} note={note} now={now} />
    </>
  );
}

function ChainEffects({ onGo }: DashletProps) {
  const { digest: d, fromDisk, note } = useChainFeed();
  const now = useBeat(30_000);
  if (!d) return <NoChain />;
  return (
    <>
      <Detail>
        {d.effects.length === 0 && <Empty>No system on the chain carries a wormhole effect right now.</Empty>}
        <FitList>
          {d.effects.map((e) => (
            <Row key={e.system} onClick={() => onGo('aperture:summary')} title={`${e.system} — ${e.effect}`}>
              <b style={{ color: classColor(e.cls) }}>{e.cls}{e.tag}</b>
              <span className="dl-grow">{e.system}</span>
              <span className="dl-dim">{e.hops !== null ? `${e.hops}j` : 'unlinked'}</span>
              <b>{e.effect}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <ChainFoot d={d} fromDisk={fromDisk} note={note} now={now} />
    </>
  );
}

function ChainFresh(_: DashletProps) {
  const { digest: d, fromDisk, note } = useChainFeed();
  const now = useBeat(30_000);
  if (!d) return <NoChain />;
  const total = d.ages.reduce((t, a) => t + a.count, 0) + d.noAge;
  const old = d.ages[d.ages.length - 1].count;
  const max = Math.max(1, maxOf(d.ages.map((a) => a.count)));
  const tones = ['var(--good)', 'var(--accent)', AMBER, 'var(--bad)'];
  return (
    <>
      <Head big={`${d.unscanned} to scan`} color={d.unscanned > 0 ? AMBER : 'var(--good)'} title="signatures on the map that nobody has scanned down yet (wormholes not counted)"
        sub={<>{total} signatures · {old} older than a day</>} />
      <Detail>
        <FitList>
          {d.ages.map((a, i) => (
            <Row key={a.label}><span className="dl-dim" style={{ width: '4.4em' }}>{a.label}</span><span className="dl-meter wide"><i style={{ width: `${(a.count / max) * 100}%`, background: tones[i] }} /></span><b>{a.count}</b></Row>
          ))}
        </FitList>
      </Detail>
      <ChainFoot d={d} fromDisk={fromDisk} note={note} now={now} />
    </>
  );
}

function ChainShape(_: DashletProps) {
  const { digest: d, fromDisk, note } = useChainFeed();
  const now = useBeat(30_000);
  if (!d) return <NoChain />;
  return (
    <>
      <Head big={`${d.systems} systems`} sub={<>{d.ways.length} way{d.ways.length === 1 ? '' : 's'} off home · {d.exits.length} to known space</>} />
      <Detail>
        <div className="dl-tiles">
          {d.classes.map((c) => <span key={c.cls} className="dl-tile flat" style={{ borderColor: classColor(c.cls) }}><span style={{ color: classColor(c.cls) }}>{c.cls}</span><b>{c.systems}</b></span>)}
        </div>
      </Detail>
      <ChainFoot d={d} fromDisk={fromDisk} note={note} now={now} />
    </>
  );
}

// ---- THEFT
const RAID_REACH_JUMPS = 15;
function RaidWindows({ onGo }: DashletProps) {
  const now = useBeat(15_000);
  const mapped = useApp((s) => s.theftMapSystems);
  const reach = useMemo(() => (mapped.length > 0 ? reachFrom(mapped, RAID_REACH_JUMPS) : null), [mapped]);
  const snap = raidSnapshot();
  const d = useMemo(() => (snap ? windowsDigest(snap.list, now, (id) => {
    const sys = getSystem(id);
    return { systemName: sys?.name ?? `System ${id}`, regionName: sys ? regionName(sys.regionId) : '—', jumps: reach?.get(id)?.jumps ?? null };
  }, !!reach) : null), [snap, now, reach]);
  if (!snap || !d) return <Empty>The raid watcher has not looked yet — it reads CCP’s public list every 2½ minutes.</Empty>;
  const rows = [...d.open, ...d.soon];
  return (
    <>
      <Head big={`${d.open.length} open`} color={d.open.length > 0 ? 'var(--good)' : undefined} sub={<>{d.soon.length} opening within the hour<span className="dl-dim"> · {reach ? `within ${RAID_REACH_JUMPS}j of your map` : 'all of New Eden'}</span></>} />
      <Detail>
        <FitList>
          {rows.map((r) => (
            <Row key={r.planetId} onClick={() => onGo('theft:skyhooks')} title={`${r.systemName}, ${r.regionName}${r.jumps !== null ? ` — ${r.jumps} gate jumps from your map` : ''}`}>
              <Dot color={r.open ? 'var(--good)' : AMBER} />
              <span className="dl-grow">{r.systemName}</span>
              <span className="dl-dim">{r.jumps !== null ? `${r.jumps}j` : ''}</span>
              <b>{r.open ? `closes ${inShort(r.inMs)}` : `in ${inShort(r.inMs)}`}</b>
            </Row>
          ))}
          {rows.length === 0 && <span className="dl-dim">nothing open or opening soon{reach ? ' in reach' : ''}</span>}
        </FitList>
      </Detail>
      <Foot warn={now - snap.at > 10 * 60_000}>CCP’s list, looked at {agoShort(now - snap.at)} · {d.listed} listed{!reach ? ' · import your map in Skyhooks for distances' : ''}</Foot>
    </>
  );
}

function RaidLog({ onGo }: DashletProps) {
  const now = useBeat(30_000);
  const ev = useResource('raid-events', raidEvents, 60_000);
  const d = useMemo(() => (ev.value ? raidLogDigest(ev.value, now, 12) : null), [ev.value, now]);
  if (!d) return <Empty>Reading the raid log…</Empty>;
  return (
    <>
      <Head big={`${d.day} in 24 h`} color={d.day > 0 ? 'var(--bad)' : undefined} title="skyhooks the watcher saw vanish from CCP's list in the middle of their window — someone emptied them. All of New Eden."
        sub={<>{d.week} in 7 days<span className="dl-dim"> · all of New Eden</span></>} />
      <Detail>
        <FitList>
          {d.recent.map((e, i) => (
            <Row key={i} onClick={() => onGo('theft:skyhooks')} title={e.intoWindowMin !== undefined ? `${e.intoWindowMin} min into its window` : undefined}>
              <span className="dl-grow">{getSystem(e.systemId)?.name ?? `System ${e.systemId}`}</span>
              <span className="dl-dim">{e.intoWindowMin !== undefined ? `${e.intoWindowMin} min in` : ''}</span>
              <b>{agoShort(now - e.t)}</b>
            </Row>
          ))}
        </FitList>
      </Detail>
      <Foot>{d.watchedSince ? `watching since ${new Date(d.watchedSince).toISOString().slice(0, 10)} · only while the app runs` : 'nothing recorded yet — the watcher only sees what happens while the app runs'}</Foot>
    </>
  );
}

// ---- PLANETS
function PiPlanets({ onGo }: DashletProps) {
  const now = useBeat(30_000);
  const planets = piPlanets();
  const ran = piLastRun();
  const b = useMemo(() => piBands(planets), [planets]);
  const sorted = useMemo(() => [...planets].sort((x, y) => x.rank - y.rank || y.fullFrac - x.fullFrac), [planets]);
  if (planets.length === 0) return <Empty>{ran ? 'No planets found on your logged-in characters.' : 'The planet collector has not run yet — it checks every 11 minutes once a character with planets is logged in.'}</Empty>;
  return (
    <>
      <Head big={b.now > 0 ? `${b.now} need you` : 'nothing urgent'} color={b.now > 0 ? 'var(--bad)' : 'var(--good)'}
        title="the PI tab's own count: storage full or filling, or every extractor dead. 'soon' = some heads dead, a program ending, idle factories"
        sub={<>{b.total} planets{b.soon > 0 ? <> · <b>{b.soon}</b> worth a trip soon</> : ''}{b.tune > 0 ? <span className="dl-dim"> · {b.tune} to tune</span> : ''}</>} />
      <Detail>
        <FitList>
          {sorted.map((p, i) => (
            <Row key={i} onClick={() => onGo('pi:planets')} title={p.advice}>
              <Dot color={piTone(p.rank)} />
              <span className="dl-grow">{p.planetName}</span>
              <span className="dl-dim">{p.characterName.split(' ')[0]}</span>
              <span className="dl-meter"><i style={{ width: `${Math.round(Math.min(1, p.fullFrac) * 100)}%`, background: p.fullFrac >= 0.9 ? 'var(--bad)' : 'var(--accent)' }} /></span>
            </Row>
          ))}
        </FitList>
      </Detail>
      <Foot warn={!!ran && now - ran > 30 * 60_000}>{ran ? `planets checked ${agoShort(now - ran)}` : 'not checked yet'}</Foot>
    </>
  );
}

// ---- WEALTH / MARKET (the first three)
function NetWorth({ spec, size, cfg }: DashletProps) {
  const now = useBeat(60_000);
  const range = Number(optionOf(spec, cfg, 'range'));
  const series = useResource('networth-series', loadNetWorthSeries, 5 * 60_000);
  const d = useMemo(() => (series.value ? worthDigest(series.value, now, range) : null), [series.value, now, range]);
  if (!series.value) return <Empty>Reading the value history…</Empty>;
  if (!d) return <Empty>No value snapshots yet — the first is taken about half an hour after a trading character logs in.</Empty>;
  const color = d.delta === null ? 'var(--ink-2)' : d.delta >= 0 ? 'var(--good)' : 'var(--bad)';
  return (
    <>
      <Head big={iskShort(d.total)} title="hangar stock + goods in transit + sell orders + buy escrow + wallets; goods at what they actually sold for in Jita over the last 7 days (the radar's measured fills), at your own cost where nothing sold, and at the Jita ask (a listing) only where there is neither"
        sub={d.delta === null ? 'one snapshot so far' : <><b style={{ color }}>{signed(d.delta)}</b>{d.deltaPct !== null ? ` (${(d.deltaPct * 100).toFixed(1)}%)` : ''}{d.covers ? '' : <span className="dl-dim"> since {new Date(d.baseAt!).toISOString().slice(0, 10)}</span>}
          <span className="dl-dim" title="the same change split in two. Wallets move with transfers, PLEX, ship purchases and payouts — that is not trading. Goods = hangar stock + in transit + sell orders + buy escrow."> · wallets {signed(d.deltaWallets ?? 0)}, goods {signed(d.deltaGoods ?? 0)}</span></>} />
      <Detail><Spark points={d.spark} color={color} fill={size !== 'S'} /></Detail>
      <Foot warn={now - d.at > 3 * 3_600_000}>{d.covers ? '' : 'history is shorter than this range · '}snapshot {agoShort(now - d.at)}</Foot>
    </>
  );
}

function Orders(_: DashletProps) {
  const now = useBeat(30_000);
  const sells = useMyMarket((s) => s.sellsByType);
  const buys = useMyMarket((s) => s.buysByType);
  const at = useMyMarket((s) => s.fetchedAt);
  const d = useMemo(() => ordersDigest(sells, buys), [sells, buys]);
  if (!at) return <Empty>Orders have not been read yet — log a trading character in.</Empty>;
  return (
    <>
      <Head big={`${d.undercut} undercut`} color={d.undercut > 0 ? AMBER : 'var(--good)'} title="a sell counts as undercut when a rival at the SAME station lists below it; a buy as outbid when a rival at the same station bids above it"
        sub={<>{d.sells} sells · {d.buys} buys{d.outbid > 0 ? ` · ${d.outbid} outbid` : ''}</>} />
      <Detail>
        <div className="dl-pair">
          <div><span className="dl-dim">listed</span><b>{iskShort(d.sellValue)}</b></div>
          <div><span className="dl-dim">bidding</span><b>{iskShort(d.buyValue)}</b></div>
        </div>
      </Detail>
      <Foot warn={now - at > 20 * 60_000}>orders read {agoShort(now - at)}{now - at > 20 * 60_000 ? ' — they refresh while a Trade tab is open' : ''}</Foot>
    </>
  );
}

function TradeToday({ spec, cfg }: DashletProps) {
  const now = useBeat(60_000);
  const range = Number(optionOf(spec, cfg, 'range'));
  const lv = useLedger((st) => st.version); // a new key when the ledger is restored or written
  const stats = useResource(`ledger-stats-${range}-${lv}`, async () => computeStats(Date.now() - range * 86_400_000), 2 * 60_000);
  const wallet = useFreshness((s) => s.sources['wallet']);
  if (!stats.value) return <Empty>Reading the wallet ledger…</Empty>;
  const s = stats.value;
  const foot = <Foot warn={!!wallet?.lastSuccess && now - wallet.lastSuccess > 60 * 60_000}>{wallet?.lastSuccess ? `wallet synced ${agoShort(now - wallet.lastSuccess)}` : 'wallet not synced yet'}</Foot>;
  if (s.sales.length === 0) return (<><Head big="no sales" sub={`in the last ${range === 1 ? '24 hours' : `${range} days`}`} />{foot}</>);
  return (
    <>
      <Head big={signed(s.realizedProfit)} color={s.realizedProfit >= 0 ? 'var(--good)' : 'var(--bad)'}
        title="realized profit: each sale against what that stock actually cost you (first in, first out), after broker fees and sales tax. Sales of stock the app never saw you buy are counted apart."
        sub={<>on {s.sales.length} sale{s.sales.length === 1 ? '' : 's'} · {iskShort(s.totalSold)} sold</>} />
      <Detail>
        <div className="dl-pair">
          <div><span className="dl-dim">fees + tax</span><b>{iskShort(s.totalBrokerFees + s.totalSalesTax)}</b></div>
          <div title="revenue from sales with no recorded purchase — loot, or stock bought before the app was watching"><span className="dl-dim">no cost basis</span><b>{iskShort(s.unmatchedRevenue)}</b></div>
        </div>
      </Detail>
      {foot}
    </>
  );
}

// ---- BATTLE
function LastFights({ onGo }: DashletProps) {
  const now = useBeat(60_000);
  const held = lastBattleHistory();
  if (!held) return <Empty>Open Battle Reports once and the corp’s latest fights appear here — a dashlet never starts a zKillboard read on its own.</Empty>;
  if (held.history.fights.length === 0) return <Empty>No corp fights in the last three days.</Empty>;
  return (
    <>
      <Detail>
        <FitList>
          {held.history.fights.map((f, i) => {
            const w = fightWhen(f.window.startMs, f.window.endMs, now);
            const p = f.poster;
            return (
              <Row key={i} onClick={() => onGo('battle:reports')} title={`${f.systemName ?? ''} — ${w.day} ${w.clock} EVE, ${w.length}`}>
                <span className="dl-fight">
                  <span className="dl-fight-top"><b style={{ color: 'var(--good)' }}>{p.ours}</b> vs <b style={{ color: 'var(--bad)' }}>{p.theirs}</b>
                    <span className="dl-fight-isk"><b style={{ color: 'var(--good)' }}>{p.unpriced ? '≥' : ''}{iskShort(p.destroyed)}</b> / <b style={{ color: 'var(--bad)' }}>{iskShort(p.lost)}</b></span>
                    <span className="dl-logos">{p.corps.theirs.slice(0, 3).map((c) => <Img key={c.id} className="" src={corpLogo(c.id)} title={c.name} />)}</span>
                  </span>
                  <span className="dl-dim">{w.day} {w.clock} · {w.length} · {f.systemName ?? '?'}</span>
                </span>
              </Row>
            );
          })}
        </FitList>
      </Detail>
      <Foot warn={now - held.at > 60 * 60_000}>destroyed / lost · public killmails · built {agoShort(now - held.at)}</Foot>
    </>
  );
}

// ---- PILOTS
function Pilots({ onGo }: DashletProps) {
  const now = useBeat(30_000);
  const chars = useAuth((s) => s.characters);
  const rec = useResource('ship-history', reloadShipHistory, 60_000);
  const rows = useMemo(() => pilotsDigest(rec.value ?? [], chars.map((c) => ({ characterId: c.characterId, name: shortLabel(c) }))), [rec.value, chars]);
  if (chars.length === 0) return <Empty>No characters logged in.</Empty>;
  return (
    <>
      <Detail>
        <FitList>
          {rows.map((p) => {
            const sys = p.last ? (getSystem(p.last.systemId)?.name ?? knownSystem(p.last.systemId)?.name ?? `System ${p.last.systemId}`) : '';
            const hull = p.last ? (getType(p.last.shipTypeId)?.name ?? 'unknown hull') : '';
            return (
              <Row key={p.characterId} onClick={() => onGo('character:match')} title={p.last ? `${p.name}: ${hull}${p.last.shipName ? ` “${p.last.shipName}”` : ''} in ${sys} — the last change the app saw, ${agoShort(now - p.last.t)}` : `${p.name}: not seen yet`}>
                <Img className="dl-face" src={charFace(p.characterId)} />
                <span className="dl-grow">{p.name}</span>
                {p.last ? <><span className="dl-dim">{hull}</span><b>{sys}</b></> : <span className="dl-dim">not seen yet</span>}
              </Row>
            );
          })}
        </FitList>
      </Detail>
      <Foot>last seen, not live — noted when a pilot’s hull or system changes</Foot>
    </>
  );
}

// ---- UTILITY
function EveClockDash(_: DashletProps) {
  const now = useBeat(1_000);
  const c = eveClock(now);
  const local = new Date(now);
  return (
    <>
      <Head big={c.hhmm} sub={<>EVE time · {c.date}</>} />
      <Detail>
        <div className="dl-pair">
          <div><span className="dl-dim">your clock</span><b>{String(local.getHours()).padStart(2, '0')}:{String(local.getMinutes()).padStart(2, '0')}</b></div>
          <div><span className="dl-dim">downtime</span><b>11:00 EVE</b></div>
        </div>
      </Detail>
      <Foot warn={c.inDowntimeWindow || c.toDowntimeMs < 30 * 60_000}>{c.inDowntimeWindow ? 'daily downtime — usually back within 15 min' : `downtime in ${inShort(c.toDowntimeMs)}`}</Foot>
    </>
  );
}

const SOURCE_NAMES: Record<string, string> = {
  prices: 'Watchlist prices', wallet: 'Wallet ledger', networth: 'Trading value', radar: 'Market radar',
  raidwatch: 'Raid watcher', shipwatch: 'Ship watcher', pi: 'Planets', trends: 'Trend watcher', teamorders: 'Team orders',
};
function Collectors({ size }: DashletProps) {
  const now = useBeat(5_000);
  const fresh = useFreshness((s) => s.sources);
  // v0.221.0: what this copy asked of each service today (lib/netMeter) — the number the audit could
  // not find anywhere; the main process's zKillboard calls are folded in
  const meter = meterSnapshot(now);
  const health = usePersistHealth(); // v0.228.0: writes the app carried on without (audit E1)
  const zk = useResource('zkill-meter', () => window.appInfo?.zkill?.meter?.() ?? Promise.resolve(null), 60_000);
  const sso = useResource('sso-meter', () => window.appInfo?.sso?.meter?.() ?? Promise.resolve(null), 60_000); // v0.237.0
  const hosts: Record<string, number> = { ...meter.today.hosts };
  if (zk.value && zk.value.day === meter.today.day && zk.value.count > 0) hosts.zKillboard = (hosts.zKillboard ?? 0) + zk.value.count;
  if (sso.value && sso.value.day === meter.today.day && sso.value.count > 0) hosts['EVE login (CCP)'] = (hosts['EVE login (CCP)'] ?? 0) + sso.value.count;
  const meterLine = Object.entries(hosts).sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n.toLocaleString()}`).join(' · ');
  const ordersAt = useMyMarket((s) => s.fetchedAt);
  // the team's orders are refreshed app-wide (not by a collector with a schedule of its own): shown
  // from that refresh's own clock. "Watchlist prices" pauses while you are away from the keyboard.
  const sources = useMemo(() => (ordersAt ? { ...fresh, teamorders: { kind: 'header' as const, state: 'verified' as const, nextAt: null, lastSuccess: ordersAt, changeTimes: [] } } : fresh), [fresh, ordersAt]);
  const keys = Object.keys(SOURCE_NAMES).filter((k) => sources[k]);
  if (keys.length === 0) return <Empty>No collector has reported yet.</Empty>;
  const failing = keys.filter((k) => (sources[k].fails ?? 0) > 0);
  return (
    <>
      <Detail>
        <div className="dl-sub">{failing.length === 0 ? <b style={{ color: 'var(--good)' }}>all collectors keeping up</b> : <b style={{ color: 'var(--bad)' }}>{failing.length} failing — backing off and retrying</b>}</div>
        <div className="dl-sub" title="every request this copy made today, by service — counted in the app, with the main process's zKillboard calls folded in; the policy page (⚖) shows yesterday's too">requests today: {meterLine || 'none yet'}</div>
        {clockLine() && <div className="dl-sub" title="your PC clock against EVE's, measured from the Date header of every ESI answer (median of the last twelve); raid windows, planet timers and order ages are computed on EVE time">{clockLine()}</div>}
        {health.last && <div className="dl-sub" style={{ color: 'var(--warn, #e0b341)' }} title="a cache, work-in-progress or history write the app carried on without — the diagnostics log (⚙ Settings) names each one; a full disk or a locked file is the usual cause">⚠ {health.failures} write failure{health.failures === 1 ? '' : 's'} this session · last: {health.last.area} {health.last.what} {agoShort(now - health.last.at)}</div>}
        <FitList className={size === 'M' ? 'two' : ''}>
          {keys.map((k) => {
            const s = sources[k];
            return (
              <Row key={k} title={`${SOURCE_NAMES[k]}: last success ${s.lastSuccess ? agoShort(now - s.lastSuccess) : 'never'}${s.fails ? ` · ${s.fails} failure(s) in a row` : ''}${s.nextAt ? ` · next ${s.nextAt > now ? `in ${inShort(s.nextAt - now)}` : 'due now'}` : ''}`}>
                <Dot color={(s.fails ?? 0) > 0 ? 'var(--bad)' : s.lastSuccess ? 'var(--good)' : 'var(--muted)'} />
                <span className="dl-grow">{SOURCE_NAMES[k]}</span>
                <span className="dl-dim">{s.lastSuccess ? agoShort(now - s.lastSuccess) : 'never'}</span>
                {size === 'L' && <b>{s.nextAt ? (s.nextAt > now ? `in ${inShort(s.nextAt - now)}` : 'due') : '—'}</b>}
              </Row>
            );
          })}
        </FitList>
      </Detail>
    </>
  );
}

const BODIES: Record<string, (p: DashletProps) => JSX.Element> = {
  'chain-isk': ChainIsk, 'chain-ways': ChainWays, 'chain-near': ChainNear, 'chain-activity': ChainActivity, 'chain-exits': ChainExits,
  'chain-effects': ChainEffects, 'chain-fresh': ChainFresh, 'chain-shape': ChainShape,
  'chain-ore': (p) => <Finder {...p} kind="rock" />, 'chain-gas': (p) => <Finder {...p} kind="gas" />,
  'raid-windows': RaidWindows, 'raid-log': RaidLog, 'pi-planets': PiPlanets,
  'net-worth': NetWorth, orders: Orders, 'trade-today': TradeToday,
  'last-fights': LastFights, pilots: Pilots, 'eve-clock': EveClockDash, collectors: Collectors,
  ...MORE_BODIES,
};
export const hasBody = (kind: string): boolean => !!BODIES[kind];
/** the view a dashlet's TITLE BAR opens its tab with — the dashlet's own option, where it has one that the tab can filter by */
export function headView(kind: string, cfg?: Record<string, string>): SavedView | undefined {
  const spec = dashletOf(kind);
  if (!spec) return undefined;
  if (kind === 'chain-ore') return chainView({ rocks: [optionOf(spec, cfg, 'rock')] });
  if (kind === 'chain-gas') return chainView({ groups: ['Gas'] });
  if (kind === 'chain-activity') return chainView({ groups: [optionOf(spec, cfg, 'activity')] });
  if (kind === 'chain-near') return chainView({ maxHops: Number(optionOf(spec, cfg, 'jumps')) });
  return undefined;
}

export function DashletBody({ kind, size, cfg, onGo, style }: { kind: string; size: DashSize; cfg?: Record<string, string>; onGo: DashletProps['onGo']; style?: CSSProperties }) {
  const spec = dashletOf(kind);
  const Body = BODIES[kind];
  if (!spec || !Body) return <div className="dl-body" style={style}><Empty>This dashlet is not part of this version.</Empty></div>;
  return <div className={`dl-body size-${size}`} style={style}><Body spec={spec} size={size} cfg={cfg} onGo={onGo} /></div>;
}
