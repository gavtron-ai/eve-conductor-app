import { useEffect, useMemo, useState } from 'react';
import { useAuth, charLabel } from '../lib/auth';
import {
  loadTrendEvents,
  lastTrendsTick,
  trendsStorageInfo,
  type TrendEvent,
} from '../lib/trends';
import { useFreshness, countdown } from '../lib/freshness';
import { getSystem } from '../lib/mapdata';
import { getType } from '../lib/typedb';
import { ledger } from '../lib/ledger';
import { useSort } from '../lib/useSort';
import { iskShort, int } from '../lib/format';
import Tip from './Tip';
import ItemDetailModal from './ItemDetailModal';

type CoreKind = 'outbid_sell' | 'outbid_buy' | 'sale';
import { computeSchedules, best3h, ADVICE_WINDOW_MS } from '../lib/schedule';

const CORE = new Set<string>(['outbid_sell', 'outbid_buy', 'sale']);
const RIVAL = new Set<string>(['rival_new', 'rival_reprice', 'rival_gone']);

/** fingerprint gate — below this we say "learning", never guess */
const FINGERPRINT_MIN_REPRICES = 5;

const hh = (h: number) => `${String(h).padStart(2, '0')}:00`;
const winLabel = (start: number) => `${hh(start)}–${hh((start + 3) % 24)}`;

const RANGES = [
  { label: '7d', ms: 7 * 86_400_000 },
  { label: '30d', ms: 30 * 86_400_000 },
  { label: '90d', ms: 90 * 86_400_000 },
  { label: 'All', ms: Infinity },
];

const KINDS: { kind: CoreKind; label: string; tip: string }[] = [
  {
    kind: 'outbid_sell',
    label: 'Outbid on sells',
    tip: 'Moments a competing sell order undercut yours at the same station (recorded once per undercut, at the moment it happens).',
  },
  {
    kind: 'outbid_buy',
    label: 'Outbid on buys',
    tip: 'Moments a competing buy order outbid yours (any order whose range reaches your station counts).',
  },
  {
    kind: 'sale',
    label: 'Sales',
    tip: 'Fills on your sell orders — units and ISK from the order price at the time.',
  },
];

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

interface ItemRow {
  typeId: number;
  name: string;
  systems: string;
  outbidSell: number;
  outbidBuy: number;
  sales: number;
  units: number;
  isk: number;
  /** distinct competitors (relists within 10 min chained into one) */
  rivals: number;
  /** rival reprices observed */
  reprices: number;
  /** the FASTEST competitor's median counter-reprice time (who you're racing) */
  respFastest: number | null;
  /** median across reacting competitors */
  respTypical: number | null;
  /** competitors that demonstrably react to your price changes (≥2 paired) */
  reactors: number;
  /** peak rival activity window start hour (EVE), null until enough data */
  rivalPeakHour: number | null;
}

/** a vanished rival order replaced on the same book within this window is the
 * same competitor relisting, not a new one */
const RELIST_CHAIN_MS = 10 * 60_000;

type ItemCol = 'name' | 'systems' | 'osell' | 'obuy' | 'sales' | 'units' | 'isk' | 'rivals' | 'resp';

interface KindStats {
  count: number;
  units: number;
  isk: number;
  byHour: number[]; // 24, EVE (UTC) hours
  byDay: number[]; // 7, Monday-first
}

function blankStats(): KindStats {
  return { count: 0, units: 0, isk: 0, byHour: new Array(24).fill(0), byDay: new Array(7).fill(0) };
}

function addEvent(s: KindStats, e: TrendEvent): void {
  const d = new Date(e.t);
  s.count += 1;
  s.units += e.qty ?? 0;
  s.isk += e.isk ?? 0;
  s.byHour[d.getUTCHours()] += 1;
  s.byDay[(d.getUTCDay() + 6) % 7] += 1; // JS Sunday-first → Monday-first
}

/** one-hue sequential strip (magnitude): darker/denser = more events */
function Strip({ counts, labels, unit, ticks }: { counts: number[]; labels: string[]; unit: string; ticks?: boolean }) {
  const max = Math.max(1, ...counts);
  return (
    <span className="trend-strip-wrap">
      <span className="trend-strip">
        {counts.map((c, i) => (
          <span
            key={i}
            className="trend-cell"
            style={c > 0 ? { background: `rgba(57, 135, 229, ${0.15 + 0.85 * (c / max)})` } : undefined}
            title={`${labels[i]} — ${c} ${unit}`}
          />
        ))}
      </span>
      {ticks && (
        <span className="trend-ticks">
          <span>00</span><span>06</span><span>12</span><span>18</span><span>24</span>
        </span>
      )}
    </span>
  );
}

const HOUR_LABELS = new Array(24).fill(0).map((_, h) => {
  const hh = String(h).padStart(2, '0');
  return `${hh}:00–${hh}:59 EVE time`;
});

export default function Trends() {
  const characters = useAuth((s) => s.characters);
  const trendsFresh = useFreshness((s) => s.sources['trends']);
  const [events, setEvents] = useState<TrendEvent[] | null>(null);
  const [storage, setStorage] = useState<string>('');
  const [rangeMs, setRangeMs] = useState<number>(30 * 86_400_000);
  const [charFilter, setCharFilter] = useState<number | null>(null);
  const [, forceTick] = useState(0);

  useEffect(() => {
    void loadTrendEvents().then((e) => setEvents([...e]));
    void trendsStorageInfo().then(setStorage);
    // re-read after each watcher pass (events append in-place to the cache)
    const t = setInterval(() => {
      forceTick((x) => x + 1);
      void loadTrendEvents().then((e) =>
        setEvents((prev) => (prev && prev.length === e.length ? prev : [...e])),
      );
    }, 5000);
    return () => clearInterval(t);
  }, []);

  const cutoff = rangeMs === Infinity ? 0 : Date.now() - rangeMs;
  const windowed = useMemo(
    () =>
      (events ?? []).filter(
        (e) => e.t >= cutoff && (charFilter === null || e.charId === charFilter),
      ),
    [events, cutoff, charFilter],
  );
  /** the outbid/sale events the per-system and per-item stats are built from */
  const filtered = useMemo(() => windowed.filter((e) => CORE.has(e.kind)), [windowed]);
  /** market-side competitor observations (fingerprinting) */
  const rivalEvents = useMemo(() => windowed.filter((e) => RIVAL.has(e.kind)), [windowed]);

  // group by system, plus an all-systems overview row
  const bySystem = useMemo(() => {
    const m = new Map<number, Record<CoreKind, KindStats>>();
    for (const e of filtered) {
      let g = m.get(e.systemId);
      if (!g) {
        g = { outbid_sell: blankStats(), outbid_buy: blankStats(), sale: blankStats() };
        m.set(e.systemId, g);
      }
      addEvent(g[e.kind as CoreKind], e);
    }
    return [...m.entries()].sort(
      (a, b) =>
        b[1].outbid_sell.count + b[1].outbid_buy.count + b[1].sale.count -
        (a[1].outbid_sell.count + a[1].outbid_buy.count + a[1].sale.count),
    );
  }, [filtered]);

  const overall = useMemo(() => {
    const g = { outbid_sell: blankStats(), outbid_buy: blankStats(), sale: blankStats() };
    for (const e of filtered) addEvent(g[e.kind as CoreKind], e);
    return g;
  }, [filtered]);

  const trackingSince = events && events.length > 0 ? events[0].t : null;

  // per-item competition profile: which of MY traded items draw the fights
  const itemRows = useMemo(() => {
    const m = new Map<number, ItemRow & { sysIds: Set<number> }>();
    const row = (typeId: number) => {
      let r = m.get(typeId);
      if (!r) {
        r = {
          typeId,
          name: getType(typeId)?.name ?? `#${typeId}`,
          systems: '',
          sysIds: new Set<number>(),
          outbidSell: 0,
          outbidBuy: 0,
          sales: 0,
          units: 0,
          isk: 0,
          rivals: 0,
          reprices: 0,
          respFastest: null,
          respTypical: null,
          reactors: 0,
          rivalPeakHour: null,
        };
        m.set(typeId, r);
      }
      return r;
    };
    for (const e of filtered) {
      const r = row(e.typeId);
      r.sysIds.add(e.systemId);
      if (e.kind === 'outbid_sell') r.outbidSell += 1;
      else if (e.kind === 'outbid_buy') r.outbidBuy += 1;
      else {
        r.sales += 1;
        r.units += e.qty ?? 0;
        r.isk += e.isk ?? 0;
      }
    }
    // fingerprint: rival cadence per item, from the rival observation log.
    // Relist chaining: a rival_gone followed by a rival_new on the same book
    // within 10 min is the SAME competitor with a fresh order id — union them
    // so one relister doesn't inflate the rival count or split their profile.
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while (parent.has(r)) r = parent.get(r)!;
      return r;
    };
    const byBook = new Map<string, { gones: { t: number; id: number; used?: boolean }[]; news: { t: number; id: number }[] }>();
    for (const e of rivalEvents) {
      if (e.rivalOrder === undefined) continue;
      const bk = `${e.typeId}:${e.stationId}:${e.side ?? 'sell'}`;
      const b = byBook.get(bk) ?? byBook.set(bk, { gones: [], news: [] }).get(bk)!;
      if (e.kind === 'rival_gone') b.gones.push({ t: e.t, id: e.rivalOrder });
      else if (e.kind === 'rival_new') b.news.push({ t: e.t, id: e.rivalOrder });
    }
    for (const b of byBook.values()) {
      b.news.sort((x, y) => x.t - y.t);
      for (const n of b.news) {
        const g = b.gones.find(
          (g) => !g.used && Math.abs(n.t - g.t) <= RELIST_CHAIN_MS && find(g.id) !== find(n.id),
        );
        if (g) {
          g.used = true;
          parent.set(find(n.id), find(g.id));
        }
      }
    }

    const rivalRoots = new Map<number, Set<number>>();
    const repriceHours = new Map<number, number[]>();
    /** per type, per competitor-lineage: paired response deltas */
    const respByLineage = new Map<number, Map<number, number[]>>();
    for (const e of rivalEvents) {
      const r = row(e.typeId);
      r.sysIds.add(e.systemId);
      if (e.rivalOrder !== undefined) {
        (rivalRoots.get(e.typeId) ?? rivalRoots.set(e.typeId, new Set()).get(e.typeId)!).add(find(e.rivalOrder));
      }
      if (e.kind === 'rival_reprice') {
        r.reprices += 1;
        (repriceHours.get(e.typeId) ?? repriceHours.set(e.typeId, new Array(24).fill(0)).get(e.typeId)!)[
          new Date(e.t).getUTCHours()
        ] += 1;
        // their response time: gap from OUR latest price change on the same
        // item+station (order-event log) to their counter, within 4h
        let mine = 0;
        for (const oe of ledger.orderEvents) {
          if (oe.typeId === e.typeId && oe.locationId === e.stationId && oe.issued < e.t && oe.issued > mine)
            mine = oe.issued;
        }
        if (mine > 0 && e.t - mine < 4 * 3_600_000 && e.rivalOrder !== undefined) {
          const lin = find(e.rivalOrder);
          const perType = respByLineage.get(e.typeId) ?? respByLineage.set(e.typeId, new Map()).get(e.typeId)!;
          (perType.get(lin) ?? perType.set(lin, []).get(lin)!).push(e.t - mine);
        }
      }
    }
    const median = (a: number[]) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];
    for (const r of m.values()) {
      r.rivals = rivalRoots.get(r.typeId)?.size ?? 0;
      if (r.reprices >= FINGERPRINT_MIN_REPRICES) {
        // per-competitor medians: the FASTEST one is who you're racing
        const perLineage = [...(respByLineage.get(r.typeId)?.values() ?? [])].filter((d) => d.length >= 2);
        r.reactors = perLineage.length;
        if (perLineage.length > 0) {
          const meds = perLineage.map(median);
          r.respFastest = Math.min(...meds);
          r.respTypical = median(meds);
        }
        const hours = repriceHours.get(r.typeId);
        if (hours) r.rivalPeakHour = best3h(hours).start;
      }
    }
    return [...m.values()].map((r) => ({
      ...r,
      systems: [...r.sysIds]
        .map((id) => (id === 0 ? 'structures' : (getSystem(id)?.name ?? `#${id}`)))
        .join(', '),
    }));
  }, [filtered, rivalEvents]);

  const { sorted: sortedItems, clickHeader, indicator } = useSort<ItemRow, ItemCol>(
    itemRows,
    {
      name: (r) => r.name,
      systems: (r) => r.systems,
      osell: (r) => r.outbidSell,
      obuy: (r) => r.outbidBuy,
      sales: (r) => r.sales,
      units: (r) => r.units,
      isk: (r) => r.isk,
      rivals: (r) => r.rivals,
      resp: (r) => r.respFastest,
    },
    { key: 'osell', dir: 'desc' },
  );
  const [detailTypeId, setDetailTypeId] = useState<number | null>(null);

  // when-to-act: the SAME schedule computation the My Orders advice column
  // acts on — this tab is where you inspect it (team-wide, all characters)
  const recommendations = useMemo(() => {
    // ADVICE_WINDOW_MS, not rangeMs: this card is a VIEW of what My Orders is
    // acting on, and it says so at the bottom. The range tabs above still
    // drive every histogram and table on this tab — but they must not quietly
    // re-derive the act-signal from a different sample than the one in play.
    const scheds = computeSchedules(events ?? [], ADVICE_WINDOW_MS);
    return [...scheds.values()]
      .sort((a, b) => b.nSales + b.nOutbids - (a.nSales + a.nOutbids))
      .slice(0, 4)
      .map((sc) => {
        // if My Orders is acting on market windows, this card MUST show them —
        // the two surfaces may never disagree
        if (!sc.coreReady && !(sc.marketReady && sc.prime)) {
          return {
            systemId: sc.systemId,
            ready: false,
            windows: [] as { when: string; action: string; why: string }[],
            note: '',
            learning:
              `${Math.min(sc.nSales, 30)}/30 sales · ${Math.min(sc.nOutbids, 20)}/20 outbids · ` +
              `${Math.min(Math.floor(sc.spanDays), 7)}/7 days tracked · station fills ${sc.mktDays}/5 days — ` +
              `windows unlock as the data fills.`,
          };
        }
        if (sc.marketReady && sc.prime) {
          const windows = sc.overlap
            ? [
                {
                  when: winLabel(sc.prime.start),
                  action: 'Hold top spot',
                  why: `${sc.prime.sharePct}% of observed STATION sales (all traders, ISK-weighted) land here — and the undercut war peaks with it because position pays now. Budget reprices for this window instead of avoiding it.`,
                },
              ]
            : [
                {
                  when: winLabel(sc.prime.start),
                  action: 'Be on top',
                  why: `${sc.prime.sharePct}% of observed STATION sales land here — the hours that matter, measured from everyone's fills, not just yours.`,
                },
                ...(sc.noise
                  ? [{
                      when: winLabel(sc.noise.start),
                      action: 'Ignore the noise',
                      why: `undercuts cluster here but station sales don't — let that fight pass and reprice once before the prime window (~${hh((sc.prime.start + 23) % 24)})`,
                    }]
                  : []),
              ];
          return {
            systemId: sc.systemId,
            ready: true,
            learning: '',
            windows,
            note: `market watch: ${sc.mktDays} day(s) · ${iskShort(sc.mktIsk)} of station sales observed${sc.mktSolid ? '' : ' · EARLY ESTIMATE — sharpens daily'} · the My Orders advice column ACTS on these windows`,
          };
        }
        const windows = [
          ...(sc.noise
            ? [{
                when: winLabel(sc.noise.start),
                action: 'Defend prices',
                why: `${sc.noise.sharePct}% of your undercuts land here — one deliberate reprice near ${hh((sc.noise.start + 3) % 24)} beats reacting all day`,
              }]
            : []),
          ...(sc.mySales
            ? [{
                when: winLabel(sc.mySales.start),
                action: 'List new stock',
                why: `${sc.mySales.sharePct}% of YOUR sales land here (${int(sc.nSales)} sales / ${int(sc.nOutbids)} outbids over ${Math.floor(sc.spanDays)} days) — CAVEAT: your fill times are biased by when you held top spot`,
              }]
            : []),
        ];
        return {
          systemId: sc.systemId,
          ready: true,
          learning: '',
          windows,
          note: `unbiased station-fill observation: ${sc.mktDays}/5 days collected — the schedule (and the My Orders act-signals) upgrade themselves once market data is in`,
        };
      });
  }, [events]);

  const systemName = (id: number) =>
    id === 0 ? 'Player structures' : (getSystem(id)?.name ?? `System ${id}`);

  const section = (title: string, g: Record<CoreKind, KindStats>) => (
    <div className="trend-system" key={title}>
      <div className="order-group-title">{title}</div>
      {KINDS.map(({ kind, label, tip }) => {
        const s = g[kind];
        return (
          <div className="trend-row" key={kind}>
            <span className="trend-label">
              <Tip tip={tip}>{label}</Tip>
            </span>
            <span className="trend-count">
              {int(s.count)}
              {kind === 'sale' && s.count > 0 && (
                <span className="dim" title={`${int(s.count)} sales worth ${iskShort(s.isk)} ISK total — average ${iskShort(s.isk / s.count)} per sale. (Raw unit counts are meaningless across items, so they're not shown.)`}> · {iskShort(s.isk)} · ~{iskShort(s.isk / s.count)}/sale</span>
              )}
            </span>
            <span className="trend-strips">
              <span className="trend-strip-label" title="Which EVE-time (UTC) hours these events land in — darker = more. EVE runs on UTC, so hub activity patterns line up across days.">by hour (EVE)</span>
              <Strip counts={s.byHour} labels={HOUR_LABELS} unit="events" ticks />
              <span className="trend-strip-label" title="Which weekdays these events land in (EVE/UTC days) — darker = more.">by weekday</span>
              <Strip counts={s.byDay} labels={WEEKDAYS} unit="events" />
            </span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="panel">
      <h2>
        <Tip tip="Long-term patterns from watching your orders: every time you get outbid (sell or buy side) and every sale, stamped with time and system. The watcher runs whenever the app is open and re-checks about every 5 minutes.">Trends</Tip>
        <span className="sub">
          when you get outbid and when sales land, per system — recorded live, kept forever
        </span>
        <span className="panel-filter" style={{ display: 'inline-flex', gap: 10, alignItems: 'center' }}>
          {characters.length > 1 && (
            <select value={charFilter ?? 'all'} style={{ fontSize: 12 }}
              onChange={(e) => setCharFilter(e.target.value === 'all' ? null : Number(e.target.value))}>
              <option value="all">Whole team</option>
              {characters.map((c) => (
                <option key={c.characterId} value={c.characterId}>{charLabel(c)}</option>
              ))}
            </select>
          )}
          <span className="range-tabs" style={{ display: 'inline-flex', gap: 6 }}>
            {RANGES.map((r) => (
              <button key={r.label} className={`btn mini ${rangeMs === r.ms ? 'primary' : ''}`}
                onClick={() => setRangeMs(r.ms)}>
                {r.label}
              </button>
            ))}
          </span>
          <span className="hint" style={{ margin: 0 }}
            title="The watcher re-checks your orders against the live market about every 5 minutes while the app is open.">
            {trendsFresh?.nextAt
              ? `next check in ${countdown(trendsFresh.nextAt)}`
              : 'watcher starting…'}
            {lastTrendsTick() ? ` · last ${new Date(lastTrendsTick()!).toLocaleTimeString()}` : ''}
          </span>
        </span>
      </h2>

      <div className="hint" style={{ marginTop: 0 }}
        title="Events are appended to plain files in this folder. It sits OUTSIDE the app's install folder, so updating or deleting the app never touches it. Deleting the folder itself is the only way to lose the history.">
        📁 stored in: <b>{storage || '…'}</b> · {events?.length ?? 0} events total
        {trackingSince ? ` · tracking since ${new Date(trackingSince).toLocaleDateString()}` : ''}
      </div>

      {characters.length === 0 && (
        <div className="empty">Log in with EVE (Settings) — the trend watcher needs your orders.</div>
      )}
      {characters.length > 0 && events !== null && filtered.length === 0 && (
        <div className="empty">
          No events in this window yet. The watcher compares two looks at the market, so the
          first events appear after ~10 minutes with active orders — outbids and sales are
          collected all the time the app is open, and kept forever.
        </div>
      )}

      {recommendations.length > 0 && (
        <div className="trend-recs">
          <div className="order-group-title">
            <Tip tip="Your daily playbook, computed from YOUR recorded sales and outbid times. All times are EVE time (UTC) — the same on every screen, wherever you travel. Updates automatically as more data comes in; stays in 'learning' mode until there's enough to be worth trusting.">Recommended schedule — EVE time (UTC)</Tip>
          </div>
          {recommendations.map((r) => (
            <div className="trend-rec" key={r.systemId}>
              <b>{systemName(r.systemId)}</b>
              {r.ready ? (
                <div className="trend-sched">
                  {r.windows.map((w) => (
                    <div className="trend-sched-row" key={w.action}>
                      <span className="trend-sched-when">{w.when}</span>
                      <span className="trend-sched-action">{w.action}</span>
                      <span className="dim">{w.why}</span>
                    </div>
                  ))}
                  {r.note && <div className="hint" style={{ margin: '2px 0 0' }}>{r.note}</div>}
                </div>
              ) : (
                <span className="dim"> — learning: {r.learning}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {filtered.length > 0 && (
        <>
          {section(`All systems · ${int(filtered.length)} events`, overall)}
          {bySystem.map(([sysId, g]) => section(systemName(sysId), g))}

          <div className="order-group-title" style={{ marginTop: 8 }}>
            <Tip tip="Competition profile per item, from your own orders' history: how often each item you trade gets outbid on either side, and how it sells. High outbid counts = contested item — expect to babysit prices; high sales with low outbids = quiet earners.">By item</Tip>
          </div>
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => clickHeader('name')}>Item{indicator('name')}</th>
                <th className="sortable" onClick={() => clickHeader('systems')}><Tip tip="Where these events happened.">Systems</Tip>{indicator('systems')}</th>
                <th className="sortable" onClick={() => clickHeader('osell')}><Tip tip="Times a rival undercut one of your SELL orders on this item.">Outbid (sell)</Tip>{indicator('osell')}</th>
                <th className="sortable" onClick={() => clickHeader('obuy')}><Tip tip="Times a rival outbid one of your BUY orders on this item.">Outbid (buy)</Tip>{indicator('obuy')}</th>
                <th className="sortable" onClick={() => clickHeader('sales')}><Tip tip="Observed fills on your sell orders for this item.">Sales</Tip>{indicator('sales')}</th>
                <th className="sortable" onClick={() => clickHeader('units')}><Tip tip="Units sold across those fills.">Units</Tip>{indicator('units')}</th>
                <th className="sortable" onClick={() => clickHeader('isk')}><Tip tip="ISK from those fills (at your order prices).">ISK sold</Tip>{indicator('isk')}</th>
                <th className="sortable" onClick={() => clickHeader('rivals')}><Tip tip="Distinct rival orders observed on this item's books (the watcher logs every competitor order it sees next to yours).">Rivals</Tip>{indicator('rivals')}</th>
                <th className="sortable" onClick={() => clickHeader('resp')}><Tip tip="Competitor fingerprint, per rival: ⚡ shows the FASTEST competitor's median counter-reprice time (that's who you're racing) and how many of the rivals demonstrably react to your changes. 'learning n/5' until 5 rival reprices are observed — and it keeps learning forever after; the numbers firm up with every observation. Hover a value for the full breakdown.">Their response</Tip>{indicator('resp')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((r) => (
                <tr key={r.typeId}>
                  <td className="hub-name">{r.name}</td>
                  <td className="dim">{r.systems}</td>
                  <td>{int(r.outbidSell)}</td>
                  <td>{int(r.outbidBuy)}</td>
                  <td>{int(r.sales)}</td>
                  <td className="dim">{int(r.units)}</td>
                  <td>{r.isk > 0 ? iskShort(r.isk) : '—'}</td>
                  <td className="dim" title="Distinct competitors — a rival who cancels and relists within 10 minutes is chained as ONE competitor, not counted again.">{r.rivals > 0 ? int(r.rivals) : '—'}</td>
                  <td>
                    {r.reprices < FINGERPRINT_MIN_REPRICES ? (
                      <span className="dim" title={`Still learning this item's competitors — ${r.reprices} of ${FINGERPRINT_MIN_REPRICES} rival reprices observed. Learning never stops: every number here is recomputed from ALL history and keeps firming up forever.`}>
                        learning {r.reprices}/{FINGERPRINT_MIN_REPRICES}
                      </span>
                    ) : (
                      <span
                        title={
                          `${int(r.reprices)} rival reprices from ${int(r.rivals)} competitors (relists chained). ` +
                          (r.respFastest !== null
                            ? `FASTEST competitor counters your price changes in ~${Math.max(1, Math.round(r.respFastest / 60_000))}m (median) — that's who you're racing. ` +
                              `Typical reactor ~${Math.max(1, Math.round((r.respTypical ?? r.respFastest) / 60_000))}m. ` +
                              `${int(r.reactors)} of ${int(r.rivals)} demonstrably react to you. `
                            : 'None of them show a clear reaction to your price changes — they reprice on their own schedule. ') +
                          (r.rivalPeakHour !== null ? `Most active ${winLabel(r.rivalPeakHour)} EVE. ` : '') +
                          'Keeps learning from every observation, forever.'
                        }
                      >
                        {r.respFastest !== null
                          ? `⚡~${Math.max(1, Math.round(r.respFastest / 60_000))}m · ${int(r.reactors)}/${int(r.rivals)} react`
                          : 'independent'}
                      </span>
                    )}
                  </td>
                  <td className="row-actions">
                    <button className="btn mini" title="Item details in a popup — your trends stay right here"
                      onClick={() => setDetailTypeId(r.typeId)}>
                      details
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {detailTypeId !== null && (
        <ItemDetailModal typeId={detailTypeId} onClose={() => setDetailTypeId(null)} />
      )}

      <div className="hint">
        Hour/weekday strips are EVE time (UTC) — darker blue = more events in that slot. An
        "outbid" is counted once at the moment a rival passes your order, so a camping
        undercutter who repeatedly reprices shows up as repeated events. Sales are your sell
        orders' fills as observed (≈5-minute resolution).
      </div>
    </div>
  );
}
