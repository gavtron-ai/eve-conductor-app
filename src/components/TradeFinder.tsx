import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp, useHubs } from '../lib/store';
import { fetchStationHeat, type Heat } from '../lib/heat';
import { estimateDefense, entryEase, defenseModel, heatForecast, FILL_WINDOW_DEFAULT_DAYS, FILL_WINDOW_CAP_DAYS } from '../lib/defense';
import { useStock } from '../lib/stock';
import { useMyMarket, teamOrderIds } from '../lib/myMarket';
import HeatChip from './HeatChip';
import { useActiveChar, useAuth, charForHub, shortLabel } from '../lib/auth';
import { brokerRateForHub } from '../lib/broker';
import { openMarketWindowEverywhere } from '../lib/esiChar';
import { findTrades, type TradeRow } from '../lib/scanner';
import { allTypes, findByName } from '../lib/typedb';
import { computeShipCargo, cargoBreakdown } from '../lib/cargo';
import { useSort } from '../lib/useSort';
import { isk, iskShort, int, pct, m3 } from '../lib/format';
import Tip from './Tip';
import ItemDetailModal from './ItemDetailModal';
import SellingChip from './SellingChip';
import StockChip from './StockChip';
import MiniHistory from './MiniHistory';
import { allocate } from '../lib/allocator';
import { tickPriceText } from '../lib/priceTick';

/** common hauler hulls offered before login; cargo comes from the type database */
const PRESET_HULLS = [
  'Sunesis', 'Badger', 'Tayra', 'Wreathe', 'Hoarder', 'Mammoth', 'Nereus', 'Kryos',
  'Epithal', 'Miasmos', 'Iteron Mark V', 'Sigil', 'Bestower',
  'Bustard', 'Crane', 'Mastodon', 'Prowler', 'Impel', 'Occator', 'Viator', 'Prorator',
  'Charon', 'Obelisk', 'Fenrir', 'Providence', 'Rhea', 'Anshar', 'Nomad', 'Ark',
];

type ColKey =
  | 'name' | 'dest' | 'buy' | 'psell' | 'heat' | 'defense' | 'adj' | 'pmargin' | 'qmargin'
  | 'units' | 'cost' | 'cargopct' | 'ivol' | 'trip' | 'pday' | 'stime' | 'dvol' | 'maxsold' | 'trend';

const HEAT_FETCH_LIMIT = 80; // heat loads for the top rows in the current sort

/** "0.3d" / "2.5d" — how long one load takes to sell */
const fmtDays = (d: number | null) =>
  d === null ? '?' : d < 0.05 ? '<0.1d' : `${d.toFixed(1)}d`;

export default function TradeFinder() {
  const hubs = useHubs();
  const finder = useApp((s) => s.finder);
  const setFinder = useApp((s) => s.setFinder);
  const settings = useApp((s) => s.settings);
  const watchlist = useApp((s) => s.watchlist);
  const toggleWatch = useApp((s) => s.toggleWatch);
  const ignoredTypeIds = useApp((s) => s.ignoredTypeIds);
  const toggleIgnore = useApp((s) => s.toggleIgnore);
  const stationTradeIds = useApp((s) => s.stationTradeIds);
  const toggleStationTrade = useApp((s) => s.toggleStationTrade);

  const active = useActiveChar();
  const ownedShips = active?.ships ?? null;
  const skills = active?.skills ?? null;

  const [rows, setRows] = useState<TradeRow[] | null>(null);
  const [heatMap, setHeatMap] = useState<Record<string, Heat | null>>({});
  // capital allocator settings persist — set once, stop babysitting the box
  const alloc = useApp((s) => s.alloc);
  const setAlloc = useApp((s) => s.setAlloc);
  const [allocCopied, setAllocCopied] = useState<number | null>(null);
  const teamCharacters = useAuth((s) => s.characters);
  // ISK moves fluidly between the team — the allocator treats it as ONE pool
  const teamPool = teamCharacters.reduce((s, c) => s + (c.wallet ?? 0), 0);
  const stockByType = useStock((s) => s.byType);
  const mySells = useMyMarket((s) => s.sellsByType);
  const myBuys = useMyMarket((s) => s.buysByType);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [detailTypeId, setDetailTypeId] = useState<number | null>(null);
  const characterId = active?.characterId ?? null;
  const ensureMyMarket = useMyMarket((s) => s.ensureFresh);
  useEffect(() => {
    void ensureMyMarket();
  }, [ensureMyMarket, characterId]);

  // presets: effective general cargo with the character's skills (no fit modules)
  const presets = useMemo(
    () =>
      PRESET_HULLS.map((n) => findByName(n))
        .filter((t): t is NonNullable<typeof t> => Boolean(t))
        .map((t) => {
          const c = computeShipCargo(t, skills);
          return { id: t.id, name: t.name, cargo: c.general, breakdown: cargoBreakdown(c) };
        })
        .filter((p) => p.cargo > 0)
        .sort((a, b) => a.cargo - b.cargo),
    [skills],
  );

  function pickShip(choice: string) {
    let cargo: number | undefined;
    if (choice.startsWith('preset:')) {
      cargo = presets.find((t) => t.id === Number(choice.slice(7)))?.cargo;
    } else if (choice.startsWith('owned:')) {
      cargo = ownedShips?.find((s) => s.itemId === Number(choice.slice(6)))?.cargo;
    }
    setFinder({ shipChoice: choice, ...(cargo ? { cargoM3: cargo } : {}) });
  }

  const source = hubs.find((h) => h.id === finder.sourceHubId) ?? hubs[0];
  const dests =
    finder.destHubId === 'all'
      ? hubs.filter((h) => h.id !== source.id)
      : finder.destHubId === 'same'
        ? [source] // station trading: buy and sell in the same hub
        : hubs.filter((h) => h.id === finder.destHubId && h.id !== source.id);
  const stationTrading = finder.destHubId === 'same';

  async function scan() {
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      const ignored = new Set(ignoredTypeIds);
      const typeIds = (finder.universe === 'watchlist' ? watchlist : allTypes().map((t) => t.id))
        .filter((t) => !ignored.has(t));
      const result = await findTrades({
        source,
        dests,
        typeIds,
        minMarginPct: finder.minMarginPct,
        cargoM3: finder.cargoM3,
        budgetISK: finder.budgetISK,
        maxDaysToSell: finder.maxDaysToSell,
        depth: finder.scanDepth,
        buyMode: finder.buyMode,
        sellMode: finder.sellMode,
        settings,
        onProgress: setProgress,
      });
      setRows(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
      setProgress('');
    }
  }

  const visible = (rows ?? []).filter(
    (r) =>
      !ignoredTypeIds.includes(r.typeId) &&
      (!finder.hideUnsustainable || (!r.flagDestAboveNorm && !r.flagSrcBelowNorm)),
  );

  const { sorted, clickHeader, indicator } = useSort<TradeRow, ColKey>(
    visible,
    {
      name: (r) => r.name,
      dest: (r) => r.destName,
      buy: (r) => r.buyPrice,
      psell: (r) => r.patientSell,
      pmargin: (r) => r.patientMargin,
      qmargin: (r) => r.quickMargin,
      units: (r) => r.unitsPerTrip,
      cost: (r) => r.unitsPerTrip * r.buyPrice,
      cargopct: (r) =>
        r.destId === source.id ? null : (r.unitsPerTrip * r.itemVolume) / finder.cargoM3,
      ivol: (r) => r.itemVolume,
      trip: (r) => r.profitPerTrip,
      pday: (r) => (r.profitPerDay > 0 ? r.profitPerDay : null),
      stime: (r) => r.daysToSell,
      dvol: (r) => r.dailyVolDest,
      maxsold: (r) => (r.maxSold ? r.maxSold[1] : null),
      trend: (r) => r.trendPct,
      heat: (r) => {
        // sort follows the FORECAST CYCLE: 🌱 early → 🌡 heating → ❄ cooling,
        // untagged grouped at the bottom; live heat breaks ties inside a group
        const f = heatForecast(r.crowd7, r.crowd30, r.volWindows?.[0] ?? null, r.volWindows?.[1] ?? null);
        const cycle = f === 'early' ? 30 : f === 'heating' ? 20 : f === 'cooling' ? 10 : 0;
        const h = heatMap[`${r.destId}:${r.typeId}`];
        const live = h == null ? 0 : h.level === 'hot' ? 3 : h.level === 'warm' ? 2 : 1;
        return cycle + live;
      },
      defense: (r) => defenseFor(r)?.costPerDay ?? null,
      adj: (r) => adjPday(r),
    },
    { key: 'adj', dir: 'desc' },
  );

  // competition-adjusted economics: profit/day minus the expected cost of
  // DEFENDING the sell order (reprice fees × realistic reprice cadence)
  function defenseFor(r: TradeRow) {
    if (r.patientSell === null) return null;
    const heat = heatMap[`${r.destId}:${r.typeId}`];
    // fee size follows the DESTINATION hub's trader — same routing as
    // placement fees everywhere else (audit fix: no base-rate stragglers)
    const destHub = hubs.find((h) => h.id === r.destId);
    return estimateDefense(heat, r.patientSell, r.unitsPerTrip, brokerRateForHub(destHub, settings));
  }
  function adjPday(r: TradeRow): number | null {
    const base = r.profitPerDay > 0 ? r.profitPerDay : null;
    if (base === null) return null;
    const d = defenseFor(r);
    return d ? base - d.costPerDay : base;
  }

  // ---- capital allocator: turn the scan into ONE executable buy plan ----
  // Greedy by defense-adjusted profit per ISK invested, under budget /
  // per-item share / item-count caps. Deterministic and explainable — every
  // number traces to a row in the table above.
  // deployable capital: the whole team's ISK minus the opportunity reserve
  // (kept liquid for other people's mistakes) — manual budget overrides
  const effectiveBudget =
    alloc.budgetISK > 0
      ? alloc.budgetISK
      : teamPool > 0
        ? Math.max(0, Math.round(teamPool * (1 - alloc.reservePct / 100)))
        : 0;

  // who should HOLD what: buyer needs the plan cost at the source; each dest
  // hub's trader needs listing fees + a defense budget; the rest stays liquid
  interface Placement {
    who: string;
    purpose: string;
    isk: number;
  }
  /**
   * Listing fees + defense budget the plan's sellers will need, per dest hub.
   * Defense budget = PREDICTED reprices (my pace capped by the item's live
   * rival tempo, over the sell window) + a per-order BUFFER of extra rounds.
   * The buffer is held capital, NOT expected spend — Adj P/day stays on the
   * point estimate; reserves provision above the mean.
   */
  function planOverhead(lines: { c: { r: TradeRow }; units: number; cost: number }[]): {
    byDest: Map<string, { fees: number; defense: number; predicted: number; buffer: number }>;
    buyer: { fees: number; predicted: number; buffer: number };
    total: number;
  } {
    const relistRatio = defenseModel().relistFeeRatio;
    const byDest = new Map<string, { fees: number; defense: number; predicted: number; buffer: number }>();
    for (const l of lines) {
      const destHub = hubs.find((h) => h.id === l.c.r.destId);
      if (!destHub || l.c.r.patientSell === null) continue;
      const e =
        byDest.get(destHub.id) ??
        byDest.set(destHub.id, { fees: 0, defense: 0, predicted: 0, buffer: 0 }).get(destHub.id)!;
      const destBroker = brokerRateForHub(destHub, settings);
      const listValue = l.c.r.patientSell * l.units;
      e.fees += listValue * destBroker;
      const d = defenseFor(l.c.r);
      if (d) e.predicted += d.costPerDay * (l.units / Math.max(1, l.c.r.unitsPerTrip)) * Math.min(l.c.r.daysToSell ?? FILL_WINDOW_DEFAULT_DAYS, FILL_WINDOW_CAP_DAYS);
      e.buffer += alloc.bufferReprices * relistRatio * destBroker * listValue;
    }
    let total = 0;
    for (const e of byDest.values()) {
      e.defense = Math.ceil(e.predicted + e.buffer);
      total += Math.ceil(e.fees) + e.defense;
    }
    const buyer = buyerNeeds(lines);
    total += buyer.fees + buyer.predicted + buyer.buffer;
    return { byDest, buyer, total };
  }

  /**
   * The BUYER's costs beyond the goods themselves (buy-order mode): exact
   * placement fees + PREDICTED bid reprices (buy-side book tempo capped by my
   * pace, over the expected fill window) + the same per-order buffer.
   */
  function buyerNeeds(lines: { c: { r: TradeRow }; units: number; cost: number }[]): {
    fees: number;
    predicted: number;
    buffer: number;
  } {
    if (finder.buyMode !== 'order') return { fees: 0, predicted: 0, buffer: 0 };
    const srcBroker = brokerRateForHub(source, settings);
    const relistRatio = defenseModel().relistFeeRatio;
    let fees = 0;
    let predicted = 0;
    let buffer = 0;
    for (const l of lines) {
      const bid = l.c.r.topBid ?? l.c.r.buyPrice;
      const orderValue = bid * l.units;
      fees += orderValue * srcBroker;
      const daysToFill = l.c.r.fillPerDay !== null && l.c.r.fillPerDay > 0
        ? Math.min(l.units / l.c.r.fillPerDay, FILL_WINDOW_CAP_DAYS)
        : FILL_WINDOW_DEFAULT_DAYS;
      const est = estimateDefense(heatMap[`buy:${l.c.r.typeId}`], bid, l.units, srcBroker);
      if (est) predicted += est.costPerDay * daysToFill;
      buffer += alloc.bufferReprices * relistRatio * srcBroker * orderValue;
    }
    return { fees: Math.ceil(fees), predicted: Math.ceil(predicted), buffer: Math.ceil(buffer) };
  }

  function placements(lines: { c: { r: TradeRow }; units: number; cost: number }[]): Placement[] {
    const out: Placement[] = [];
    const planCost = lines.reduce((s, l) => s + l.cost, 0);
    const srcChar = charForHub(source.id);
    const { byDest, buyer } = planOverhead(lines);
    out.push({
      who: srcChar ? shortLabel(srcChar) : `buyer @ ${source.name}`,
      purpose:
        finder.buyMode === 'order'
          ? `buy via orders at ${source.name} — goods ${iskShort(planCost)} + placement fees ${iskShort(buyer.fees)} + PREDICTED bid reprices ${iskShort(buyer.predicted)} + buffer ${iskShort(buyer.buffer)} (${alloc.bufferReprices} extra rounds/order)`
          : `buy the plan instantly at ${source.name} (no broker fee on instant buys — the opportunity reserve below is your restock float)`,
      isk: planCost + buyer.fees + buyer.predicted + buyer.buffer,
    });
    for (const [destId, e] of byDest) {
      const hub = hubs.find((h) => h.id === destId)!;
      const seller = charForHub(destId);
      out.push({
        who: seller ? shortLabel(seller) : `seller @ ${hub.name}`,
        purpose: `list + defend at ${hub.name} — fees ${iskShort(e.fees)} + PREDICTED reprices ${iskShort(e.predicted)} + buffer ${iskShort(e.buffer)} (${alloc.bufferReprices} extra rounds/order)`,
        isk: Math.ceil(e.fees) + e.defense,
      });
    }
    if (teamPool > 0) {
      out.push({
        who: 'anyone',
        purpose: 'opportunity reserve — dry powder for other people’s mistakes',
        isk: Math.round(teamPool * (alloc.reservePct / 100)),
      });
      const committed = out.reduce((s, p) => s + p.isk, 0);
      out.push({
        who: '—',
        purpose: teamPool - committed >= 0 ? 'uncommitted (stays wherever it is)' : 'SHORTFALL — trim the plan or the reserve',
        isk: teamPool - committed,
      });
    }
    return out;
  }
  const allocation = useMemo(() => {
    const candidates = (rows === null ? [] : visible).map((r) => ({
      r,
      typeId: r.typeId,
      adjPday: adjPday(r) ?? 0,
      unitsPerTrip: r.unitsPerTrip,
      buyPrice: r.buyPrice,
      heating:
        heatForecast(r.crowd7, r.crowd30, r.volWindows?.[0] ?? null, r.volWindows?.[1] ?? null) === 'heating',
      owned:
        (stockByType[r.typeId]?.length ?? 0) > 0 ||
        (mySells[r.typeId]?.length ?? 0) > 0 ||
        (myBuys[r.typeId]?.length ?? 0) > 0,
    }));
    const opts = {
      maxItems: alloc.maxItems,
      maxShare: alloc.maxSharePct / 100,
      skipHeating: alloc.skipHeating,
      skipOwned: alloc.skipOwned,
    };
    // the budget must cover the PLAN plus its sellers' fees/defense — shrink
    // the buying budget until everything (incl. the reserve) fits the pool
    let res = allocate(candidates, { budget: effectiveBudget, ...opts });
    for (let i = 0; i < 3; i++) {
      const overhead = planOverhead(res.lines).total;
      const planCost = res.lines.reduce((s, l) => s + l.cost, 0);
      if (planCost + overhead <= effectiveBudget || res.lines.length === 0) break;
      res = allocate(candidates, { budget: Math.max(0, effectiveBudget - overhead), ...opts });
    }
    return res;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, visible, heatMap, effectiveBudget, alloc.maxItems, alloc.maxSharePct, alloc.bufferReprices, alloc.skipHeating, alloc.skipOwned, stockByType, mySells, myBuys]);

  // BUY-side heat for the allocator's bid-defense prediction: the buy book's
  // own tempo at the source station, per planned line (lazy, cached 5 min)
  const buyHeatRequested = useRef(new Set<number>());
  useEffect(() => {
    if (finder.buyMode !== 'order' || source.kind !== 'station') return;
    const wanted = allocation.lines
      .map((l) => l.c.r.typeId)
      .filter((t) => !buyHeatRequested.current.has(t));
    if (wanted.length === 0) return;
    for (const t of wanted) buyHeatRequested.current.add(t);
    void (async () => {
      for (const t of wanted) {
        const h = await fetchStationHeat(source.regionId, t, source.locationId, 'buy', teamOrderIds());
        setHeatMap((m) => ({ ...m, [`buy:${t}`]: h }));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allocation]);

  const allocChunks = useMemo(() => {
    const lines = allocation.lines.map((l) => `${l.c.r.name} ${l.units}`);
    const chunks: string[] = [];
    for (let i = 0; i < lines.length; i += 100) chunks.push(lines.slice(i, i + 100).join('\n'));
    return chunks;
  }, [allocation]);

  async function copyAlloc(i: number) {
    try {
      await navigator.clipboard.writeText(allocChunks[i] ?? '');
    } catch {
      /* clipboard denied — the text is visible via multibuy in game anyway */
    }
    setAllocCopied(i);
    setTimeout(() => setAllocCopied(null), 2500);
  }

  // undercut heat, lazily for the top rows of the current sort (book per
  // dest×item, cached ~5 min in lib/heat) — station-kind destinations only
  const heatRequested = useRef(new Set<string>());
  useEffect(() => {
    const wanted = sorted.slice(0, HEAT_FETCH_LIMIT).flatMap((r) => {
      const hub = hubs.find((h) => h.id === r.destId);
      if (!hub || hub.kind !== 'station') return [];
      const key = `${r.destId}:${r.typeId}`;
      return heatRequested.current.has(key) ? [] : [{ key, hub, typeId: r.typeId }];
    });
    if (wanted.length === 0) return;
    for (const w of wanted) heatRequested.current.add(w.key);
    let cancelled = false;
    void (async () => {
      // small parallel batches — these are single-type book fetches
      for (let i = 0; i < wanted.length && !cancelled; i += 4) {
        const batch = wanted.slice(i, i + 4);
        const results = await Promise.all(
          batch.map(async (w) => [w.key, await fetchStationHeat(w.hub.regionId, w.typeId, w.hub.locationId, 'sell', teamOrderIds())] as const),
        );
        if (!cancelled) setHeatMap((m) => ({ ...m, ...Object.fromEntries(results) }));
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sorted]);

  function num(v: string): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  return (
    <>
      <div className="panel">
        <h2>
          Trade Finder
          <span className="sub">buy at the source hub, haul, sell at the destination — net of your fees</span>
        </h2>
        <div className="finder-form">
          <label>
            <span>From</span>
            <select
              value={source.id}
              onChange={(e) => setFinder({ sourceHubId: e.target.value })}
            >
              {hubs.map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>To</span>
            <select
              value={finder.destHubId}
              onChange={(e) => setFinder({ destHubId: e.target.value })}
            >
              <option value="all">All other hubs</option>
              <option value="same">Same hub — station trading</option>
              {hubs.filter((h) => h.id !== source.id).map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Items</span>
            <select
              value={finder.universe}
              onChange={(e) => setFinder({ universe: e.target.value as 'all' | 'watchlist' })}
            >
              <option value="all">Whole market</option>
              <option value="watchlist">Watchlist only</option>
            </select>
          </label>
          <label>
            <span>Min margin %</span>
            <input type="number" min={0} step={1} value={finder.minMarginPct}
              onChange={(e) => setFinder({ minMarginPct: num(e.target.value) })} />
          </label>
          <label>
            <span>Ship</span>
            <select value={finder.shipChoice} onChange={(e) => pickShip(e.target.value)}>
              <option value="custom">Custom cargo</option>
              {ownedShips && ownedShips.length > 0 && (
                <optgroup label="Your ships (skills + fit applied)">
                  {ownedShips.map((s) => (
                    <option key={s.itemId} value={`owned:${s.itemId}`} title={s.breakdown}>
                      {s.customName ? `${s.customName} (${s.typeName})` : s.typeName} — {int(s.cargo)} m³
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={skills ? 'Common haulers (your skills, no fit)' : 'Common haulers (base, no skills)'}>
                {presets.map((t) => (
                  <option key={t.id} value={`preset:${t.id}`} title={t.breakdown}>
                    {t.name} — {int(t.cargo)} m³
                  </option>
                ))}
              </optgroup>
            </select>
          </label>
          <label>
            <span>Cargo m³</span>
            <input type="number" min={1} step={100} value={finder.cargoM3}
              onChange={(e) =>
                setFinder({ cargoM3: Math.max(1, num(e.target.value)), shipChoice: 'custom' })
              } />
          </label>
          <label>
            <span>Budget (ISK)</span>
            <input type="number" min={0} placeholder="no limit"
              value={finder.budgetISK ?? ''}
              onChange={(e) =>
                setFinder({ budgetISK: e.target.value === '' ? null : num(e.target.value) })
              } />
          </label>
          <label title={teamPool <= 0 ? 'Log in and sync to link your wallets' : `TEAM wallet (all ${teamCharacters.length} characters combined — the ISK moves freely between them): ${isk(teamPool)} ISK`}>
            <span>% of team wallet</span>
            <input type="number" min={0} max={100} step={5} placeholder={teamPool <= 0 ? '—' : '%'}
              disabled={teamPool <= 0}
              value={
                teamPool > 0 && finder.budgetISK !== null
                  ? Math.round((finder.budgetISK / teamPool) * 1000) / 10
                  : ''
              }
              onChange={(e) => {
                if (teamPool <= 0) return;
                const pct = num(e.target.value);
                setFinder({ budgetISK: pct > 0 ? Math.floor((teamPool * pct) / 100) : null });
              }} />
          </label>
          <label title="Positions are sized so one trip's load sells within this many days at the destination (units capped at daily volume × days). Items with no usable trade history are dropped. 0 = no liquidity logic.">
            <span>Sell within (days)</span>
            <input type="number" min={0} step={0.5} value={finder.maxDaysToSell}
              onChange={(e) => setFinder({ maxDaysToSell: num(e.target.value) })} />
          </label>
          <label title="How you ACQUIRE items at the source. 'Sell orders' = pay the ask, instant. 'My buy order' = place a buy order and wait for sellers — better margins, but slower. Costs and fill rates come from actual trade prints: sells into buy orders execute at the day's LOW, so history reveals both the realistic bid price and how much volume flows into bids.">
            <span>Buy via</span>
            <select value={finder.buyMode}
              onChange={(e) => setFinder({ buyMode: e.target.value as 'instant' | 'order' })}>
              <option value="instant">Sell orders (instant)</option>
              <option value="order">My buy order</option>
            </select>
          </label>
          <label title="Which exit the margin filter and ranking use. 'Sell order' = list and wait (broker+tax). 'Buy orders' = dump instantly (tax only). 'Best of both' = whichever is higher per item.">
            <span>Sell via</span>
            <select value={finder.sellMode}
              onChange={(e) => setFinder({ sellMode: e.target.value as 'order' | 'instant' | 'best' })}>
              <option value="best">Best of both</option>
              <option value="order">Sell order</option>
              <option value="instant">Buy orders (instant)</option>
            </select>
          </label>
          <label title="Deep checks every candidate that passes the margin filter (first run fetches each item's history once — cached for the day). Fast spot-checks the top 100.">
            <span>Scan depth</span>
            <select value={finder.scanDepth}
              onChange={(e) => setFinder({ scanDepth: e.target.value as 'deep' | 'fast' })}>
              <option value="deep">Deep (everything)</option>
              <option value="fast">Fast (top 100)</option>
            </select>
          </label>
          <button className="btn primary scan-btn" onClick={scan} disabled={scanning || dests.length === 0}>
            {scanning ? 'Scanning…' : 'Scan'}
          </button>
        </div>
        <div className="finder-options">
          <label className="checkline" style={{ margin: 0 }}>
            <input type="checkbox" checked={finder.hideUnsustainable}
              onChange={(e) => setFinder({ hideUnsustainable: e.target.checked })} />
            <span>Hide flagged prices (unlikely to hold / one-off dumps)</span>
          </label>
          {progress && <span className="progress-text">{progress}</span>}
          {stationTrading && (finder.buyMode !== 'order' || finder.sellMode === 'instant') && (
            <span className="hint" style={{ margin: 0 }}>
              Station trading only works as "My buy order" → "Sell order" — buying and selling
              at market prices in the same hub just pays the spread and fees.
            </span>
          )}
          {finder.shipChoice !== 'custom' && (
            <span className="hint" style={{ margin: 0 }}>
              Cargo counts the main bay + fleet hangar (skills{ownedShips ? ' and fitted expanders/rigs on your ships' : ''} included).
              Ore/PI/ammo bays carry only their commodity, so they're listed in the tooltip but
              not counted — and no implant affects cargo in EVE.
            </span>
          )}
        </div>
        {error && <div className="form-error">Scan failed: {error}</div>}
      </div>

      {rows !== null && (
        <div className="panel">
          <h2>
            Recommended buys
            <span className="sub">
              {visible.length} of {rows.length} candidates · buy price = 5%-depth sell price at {source.name} ·
              daily vol is region-wide (ESI has no station granularity)
            </span>
          </h2>
          {visible.length === 0 ? (
            <div className="empty">
              No trades pass the current filters: ≥{finder.minMarginPct}% margin
              {finder.maxDaysToSell > 0 && <>, load sells within {finder.maxDaysToSell} day{finder.maxDaysToSell === 1 ? '' : 's'}</>}
              {finder.budgetISK ? <>, ≤{iskShort(finder.budgetISK)} budget</> : null}
              {finder.hideUnsustainable && rows.length > visible.length && (
                <>, {rows.length - visible.length} hidden by the flagged-prices filter</>
              )}
              . Try a lower margin, a higher sell-time limit, or untick the flag filter.
            </div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th className="sortable" onClick={() => clickHeader('name')}>Item{indicator('name')}</th>
                  <th className="sortable" onClick={() => clickHeader('dest')}><Tip tip="The hub where you'd sell this item after hauling it.">Sell at</Tip>{indicator('dest')}</th>
                  <th className="sortable" onClick={() => clickHeader('buy')}>
                    {finder.buyMode === 'order'
                      ? <Tip tip="Your cost per unit if you place a buy order at the current top bid — broker fee included. You'll wait for fills.">Bid cost @</Tip>
                      : <Tip tip="What you'd pay per unit at the source — based on the cheapest 5% of listings, so a single bait order can't fake a low price.">Buy @</Tip>}
                    {indicator('buy')}
                  </th>
                  {finder.buyMode === 'order' && (
                    <th><Tip tip="Estimated units/day your buy order captures — measured from trade prints (share of daily volume that executed at the day's low = sells into bids). Quantities are sized so filling AND reselling both fit your time window; Sell time includes the fill wait.">Est. fills/day</Tip></th>
                  )}
                  <th className="sortable" onClick={() => clickHeader('psell')}><Tip tip="The price you'd list a sell order at — matching the destination's current lowest listing.">Sell @ (order)</Tip>{indicator('psell')}</th>
                  <th className="sortable" onClick={() => clickHeader('heat')}><Tip tip="Undercut heat at the destination, read from the live book's own reprice timestamps (no waiting needed): 🔥 = the sell front line is repricing right now — expect a fight for the top spot. ~ = occasional undercuts. quiet = the best ask hasn't moved in over a day. Loads for the top rows of the current sort. Sorting this column follows the forecast cycle: 🌱 early → 🌡 heating → ❄ cooling, untagged rows grouped at the bottom.">Heat</Tip>{indicator('heat')}</th>
                  <th className="sortable" onClick={() => clickHeader('defense')}><Tip tip="Expected ISK/day spent on reprice fees DEFENDING this sell order: rival tempo (from the live book's timestamps) capped at YOUR historical reprice pace (from your own order history), × your measured relist charge (from your actual paid fees; ~50% of the broker fee until enough history). 🚪 marks structurally easy-entry items (cheap per unit / tiny to haul / fat margin) — crowds keep coming even after today's rivals leave.">Defense/d</Tip>{indicator('defense')}</th>
                  <th className="sortable" onClick={() => clickHeader('adj')}><Tip tip="Profit/day MINUS the expected defense cost — the honest number for contested items. An item can look great on paper and be worse than a quiet one once the reprice war is priced in. Default sort.">Adj P/day</Tip>{indicator('adj')}</th>
                  <th className="sortable" onClick={() => clickHeader('pmargin')}><Tip tip="Your % return selling via a sell order at the destination, after broker fee and sales tax.">Margin</Tip>{indicator('pmargin')}</th>
                  <th className="sortable" onClick={() => clickHeader('qmargin')}><Tip tip="Your % return if you dump instantly into standing buy orders instead — immediate but usually worse.">Quick margin</Tip>{indicator('qmargin')}</th>
                  <th className="sortable" onClick={() => clickHeader('units')}><Tip tip="How many units the app recommends per trip — limited by your cargo, budget, the source's supply, and what the destination actually absorbs within your sell window.">Units/trip</Tip>{indicator('units')}</th>
                  <th className="sortable" onClick={() => clickHeader('cost')}><Tip tip="Total ISK to buy the whole recommended quantity at the source.">Order cost</Tip>{indicator('cost')}</th>
                  <th className="sortable" onClick={() => clickHeader('cargopct')}><Tip tip="How much of your cargo space this order fills. Low % on a liquidity-limited item means room to combine it with other trades.">Cargo %</Tip>{indicator('cargopct')}</th>
                  <th className="sortable" onClick={() => clickHeader('ivol')}><Tip tip="Packaged size of a single unit.">m³/unit</Tip>{indicator('ivol')}</th>
                  <th className="sortable" onClick={() => clickHeader('trip')}><Tip tip="Total expected profit for one haul of the recommended quantity, after fees.">Profit/trip</Tip>{indicator('trip')}</th>
                  <th className="sortable" onClick={() => clickHeader('pday')}><Tip tip="Trip profit divided by how many days the load takes to sell (minimum 1 day). THE number for 'profitable AND sells fast'.">Profit/day</Tip>{indicator('pday')}</th>
                  <th className="sortable" onClick={() => clickHeader('stime')}><Tip tip="How long the destination market needs to absorb your whole load, based on its daily traded volume. 0.5d = sells in half a day.">Sell time</Tip>{indicator('stime')}</th>
                  <th className="sortable" onClick={() => clickHeader('dvol')}><Tip tip="Units traded per CALENDAR day in the destination's region — quiet days count as zero, and the app uses the lower of the 30-day and 90-day rates so a one-off spike can't inflate it. Hover a value to see the 7/30/90-day breakdown.">Day vol</Tip>{indicator('dvol')}</th>
                  <th className="sortable" onClick={() => clickHeader('maxsold')}><Tip tip="The highest price anything ACTUALLY SOLD for in the destination's region in the last 7 days — real completed trades, not hopeful listings. Hover a value for the day/week/month breakdown.">Max sold (7d)</Tip>{indicator('maxsold')}</th>
                  <th><Tip tip="The last 2 weeks of daily trading in the destination region — bar height is units sold that day. Hover a bar for that day's units and the min / average / max prices actually paid.">2w history</Tip></th>
                  <th className="sortable" onClick={() => clickHeader('trend')}><Tip tip="Price direction: last 7 days' average vs last 30 days'. ↑ rising, ↓ falling, → flat.">Trend</Tip>{indicator('trend')}</th>
                  <th><Tip tip="Warnings: 'price high' = the destination price is far above its normal level and probably won't hold. 'dump?' = the source price is far below normal — great one-off buy, but may not restock.">Flags</Tip></th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={`${r.typeId}-${r.destId}`}>
                    <td className="hub-name">{r.name}<SellingChip typeId={r.typeId} /><StockChip typeId={r.typeId} refPrice={r.patientSell} /></td>
                    <td>{r.destName}</td>
                    <td
                      title={finder.buyMode === 'order' && r.estBidFill !== null
                        ? `Current top bid: ${r.topBid !== null ? isk(r.topBid) : '—'} · sellers historically accept ~${isk(r.estBidFill)} — your cost assumes the realistic level (broker fee included)`
                        : undefined}>
                      {isk(r.buyPrice)}
                    </td>
                    {finder.buyMode === 'order' && (
                      <td className="dim">
                        {r.fillPerDay !== null
                          ? r.fillPerDay < 10 ? r.fillPerDay.toFixed(1) : int(r.fillPerDay)
                          : '?'}
                      </td>
                    )}
                    <td>{r.patientSell !== null ? isk(r.patientSell) : <span className="dim">—</span>}</td>
                    <td>
                      {hubs.find((h) => h.id === r.destId)?.kind === 'station'
                        ? <HeatChip heat={heatMap[`${r.destId}:${r.typeId}`]} />
                        : <span className="dim" title="Heat needs a station-scoped destination (region hubs cover many stations).">—</span>}
                      {(() => {
                        const f = heatForecast(r.crowd7, r.crowd30, r.volWindows?.[0] ?? null, r.volWindows?.[1] ?? null);
                        if (f === null) return null;
                        const cr = r.crowd7 !== null && r.crowd30 !== null && r.crowd30 > 0 ? r.crowd7 / r.crowd30 : null;
                        const detail = `orders-per-unit 7d/30d ${cr !== null ? cr.toFixed(2) + '×' : '—'} · volume rate 7d/30d ${r.volWindows && r.volWindows[1] > 0 ? (r.volWindows[0] / r.volWindows[1]).toFixed(2) + '×' : '—'}`;
                        return f === 'early' ? (
                          <span className="flag good" style={{ marginLeft: 4 }}
                            title={`🌱 EARLY: demand is growing but competitors are NOT (yet) — the window to profit BEFORE the crowd arrives. ${detail}`}>🌱 early</span>
                        ) : f === 'heating' ? (
                          <span className="flag warn" style={{ marginLeft: 4 }}
                            title={`🌡 HEATING: orders-per-traded-unit is rising — competitors are flowing in ahead of what today's book shows; expect defense costs to climb. ${detail}`}>🌡 heating</span>
                        ) : (
                          <span className="flag info" style={{ marginLeft: 4 }}
                            title={`❄ COOLING: crowding is falling — rivals leaving, margins may recover. ${detail}`}>❄ cooling</span>
                        );
                      })()}
                    </td>
                    <td className="dim">
                      {(() => {
                        const d = defenseFor(r);
                        const e = entryEase(r.buyPrice, r.itemVolume, r.patientMargin);
                        const entryTip = e.easy ? `🚪 easy entry — expect crowds even after today's rivals leave: ${e.factors.join('; ')}.` : '';
                        if (!d) return <span title={entryTip || undefined}>{e.easy ? '🚪 ' : ''}—</span>;
                        const m = defenseModel();
                        return (
                          <span title={
                            `≈${d.repricesPerDay.toFixed(1)} reprices/day (rival tempo, capped at ${d.assumedPace ? 'an assumed modest pace — no personal reprice history yet' : 'YOUR historical pace'}) × ${iskShort(d.perReprice)} per reprice (${
                              m.relistSource === 'measured'
                                ? 'your measured relist charge'
                                : m.relistSource === 'skills'
                                  ? `from your skills: Advanced Broker Relations ${m.abrLevel} → relist = ${Math.round(m.relistFeeRatio * 100)}% of the broker fee`
                                  : '50% of the broker fee — untrained baseline'
                            }).` +
                            (entryTip ? `\n${entryTip}` : '')
                          }>
                            {e.easy ? '🚪 ' : ''}{iskShort(d.costPerDay)}
                          </span>
                        );
                      })()}
                    </td>
                    <td className={(() => { const a = adjPday(r); return a === null ? 'dim' : a > 0 ? 'pos' : 'neg'; })()}
                      title="Profit/day minus expected defense fees — negative means the reprice war eats the whole edge.">
                      {(() => { const a = adjPday(r); return a === null ? '—' : iskShort(a); })()}
                    </td>
                    <td className={r.patientMargin !== null && r.patientMargin > 0 ? 'pos' : 'neg'}>
                      {r.patientMargin !== null ? pct(r.patientMargin) : '—'}
                    </td>
                    <td className={r.quickMargin !== null && r.quickMargin > 0 ? 'pos' : 'neg'}>
                      {r.quickMargin !== null ? pct(r.quickMargin) : '—'}
                    </td>
                    <td className="dim">{int(r.unitsPerTrip)}</td>
                    <td>{iskShort(r.unitsPerTrip * r.buyPrice)}</td>
                    <td className="dim">
                      {r.destId === source.id
                        ? '—'
                        : pct((r.unitsPerTrip * r.itemVolume) / finder.cargoM3)}
                    </td>
                    <td className="dim">{m3(r.itemVolume)}</td>
                    <td className={r.profitPerTrip > 0 ? 'pos' : 'neg'}>{iskShort(r.profitPerTrip)}</td>
                    <td className={r.profitPerDay > 0 ? 'pos' : 'dim'}>
                      {r.profitPerDay > 0 ? iskShort(r.profitPerDay) : '—'}
                    </td>
                    <td className={r.daysToSell !== null && r.daysToSell <= 1 ? 'pos' : 'dim'}>
                      {fmtDays(r.daysToSell)}
                    </td>
                    <td className="dim"
                      title={r.volWindows
                        ? `Units/day by calendar window (quiet days count as zero): last 7d ${r.volWindows[0].toFixed(1)} · 30d ${r.volWindows[1].toFixed(1)} · 90d ${r.volWindows[2].toFixed(1)}. The app uses the LOWER of 30d/90d so a recent spike can't trick it.`
                        : undefined}>
                      {r.dailyVolDest !== null
                        ? r.dailyVolDest < 10 ? r.dailyVolDest.toFixed(1) : int(r.dailyVolDest)
                        : '?'}
                    </td>
                    <td className="dim"
                      title={r.maxSold
                        ? `Highest actual sale in the destination region: last day ${r.maxSold[0] > 0 ? isk(r.maxSold[0]) : 'no trades'} · 7d ${r.maxSold[1] > 0 ? isk(r.maxSold[1]) : 'no trades'} · 30d ${r.maxSold[2] > 0 ? isk(r.maxSold[2]) : 'no trades'}`
                        : undefined}>
                      {r.maxSold && r.maxSold[1] > 0 ? iskShort(r.maxSold[1]) : '—'}
                    </td>
                    <td>
                      {(() => {
                        const destRegion = hubs.find((h) => h.id === r.destId)?.regionId;
                        return destRegion !== undefined
                          ? <MiniHistory regionId={destRegion} typeId={r.typeId} />
                          : <span className="dim">—</span>;
                      })()}
                    </td>
                    <td className={r.trendPct !== null ? (r.trendPct > 0.02 ? 'pos' : r.trendPct < -0.02 ? 'neg' : 'dim') : 'dim'}>
                      {r.trendPct !== null
                        ? (r.trendPct > 0.02 ? '↑ ' : r.trendPct < -0.02 ? '↓ ' : '→ ') + pct(r.trendPct)
                        : '—'}
                    </td>
                    <td>
                      {r.flagDestAboveNorm && (
                        <span className="flag warn" title="The destination's asking price sits above what the item actually trades at there (recent prints / 90-day median / CCP's global average) — the sell figure shown has already been cut to the level buyers really pay">
                          price high
                        </span>
                      )}
                      {r.flagSrcBelowNorm && (
                        <span className="flag info" title="Source price is well below CCP's global average for this item — possibly a one-off dump that may not restock at this price">
                          dump?
                        </span>
                      )}
                      {r.flagLowBid && (
                        <span className="flag info" title="The current top bid is well below what sellers historically accept — your bid would raise the market (cost shown already assumes the realistic level)">
                          bid up
                        </span>
                      )}
                    </td>
                    <td className="row-actions">
                      <button
                        className={`star ${watchlist.includes(r.typeId) ? 'on' : ''}`}
                        style={{ fontSize: 14 }}
                        title="Watchlist"
                        onClick={() => toggleWatch(r.typeId)}
                      >
                        {watchlist.includes(r.typeId) ? '★' : '☆'}
                      </button>
                      <button
                        className="btn mini"
                        title="Item details in a popup — your scan results stay right here"
                        onClick={() => setDetailTypeId(r.typeId)}
                      >
                        details
                      </button>
                      {characterId && (
                        <button
                          className="btn mini"
                          title="Open this item's market window in the EVE client"
                          onClick={() => openMarketWindowEverywhere(r.typeId).catch(() => {})}
                        >
                          game
                        </button>
                      )}
                      <button
                        className={`btn mini ${stationTradeIds.includes(r.typeId) ? 'primary' : ''}`}
                        title={stationTradeIds.includes(r.typeId)
                          ? 'STATION-TRADE item: flipped where it sits, never suggested for hauling. Click to unmark.'
                          : "Mark as a STATION-TRADE item: bought at the hub it sells at — its stock is flipped in place, never suggested for hauling. Stays until untoggled."}
                        onClick={() => toggleStationTrade(r.typeId)}
                      >
                        {stationTradeIds.includes(r.typeId) ? '⚑' : '⚐'}
                      </button>
                      <button
                        className="btn mini"
                        title="Ignore this item — hidden from trade searches and auto hauls until you remove it in Settings"
                        onClick={() => toggleIgnore(r.typeId)}
                      >
                        🚫
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
      {rows !== null && visible.length > 0 && (
        <div className="panel">
          <h2>
            <Tip tip="One executable buy plan from this scan: capital spread across the best defense-adjusted opportunities, greedy by adjusted ISK/day earned per ISK invested, capped per item so no single market can sink the day. Every line traces to a row in the table above — this is a lens, not new math.">Capital allocator</Tip>
            <span className="sub">turn the scan into one buy plan — sized, diversified, defense-adjusted</span>
          </h2>
          <div className="finder-form">
            <label title={`ISK to deploy. 0 = the TEAM's combined wallets minus the opportunity reserve${teamPool > 0 ? ` (pool ${iskShort(teamPool)} → ${iskShort(effectiveBudget)})` : ''} — your ISK moves fluidly between characters, so the allocator plans it as one pool and tells you who should hold what below.`}>
              <span>Budget (ISK)</span>
              <input type="number" min={0} value={alloc.budgetISK}
                onChange={(e) => setAlloc({ budgetISK: Math.max(0, num(e.target.value)) })} />
            </label>
            <label title="Percent of the team pool kept LIQUID and unallocated — dry powder for mispriced orders, crossed books, and other people's mistakes.">
              <span>Reserve %</span>
              <input type="number" min={0} max={90} value={alloc.reservePct}
                onChange={(e) => setAlloc({ reservePct: Math.max(0, Math.min(90, num(e.target.value))) })} />
            </label>
            <label title="Attention cap — more items = more orders to babysit. 10–15 is a comfortable station-trading load.">
              <span>Max items</span>
              <input type="number" min={1} max={50} value={alloc.maxItems}
                onChange={(e) => setAlloc({ maxItems: Math.max(1, Math.min(50, num(e.target.value))) })} />
            </label>
            <label title="Extra reprice rounds held PER ORDER on top of the PREDICTED reprices (your pace × each item's live rival tempo). Predictions are averages — this is the safety margin so a hotter-than-average war never leaves an order undefendable. Held capital, not expected spend: it doesn't change Adj P/day.">
              <span>Reprice buffer</span>
              <input type="number" min={0} max={10} value={alloc.bufferReprices}
                onChange={(e) => setAlloc({ bufferReprices: Math.max(0, Math.min(10, num(e.target.value))) })} />
            </label>
            <label title="Diversification cap — no single item may take more than this share of the budget.">
              <span>Max % per item</span>
              <input type="number" min={5} max={100} value={alloc.maxSharePct}
                onChange={(e) => setAlloc({ maxSharePct: Math.max(5, Math.min(100, num(e.target.value))) })} />
            </label>
            <label className="checkline" title="Skip items whose crowding is rising (🌡) — the war is arriving; let it pass.">
              <input type="checkbox" checked={alloc.skipHeating}
                onChange={(e) => setAlloc({ skipHeating: e.target.checked })} />
              <span>skip 🌡 heating</span>
            </label>
            <label className="checkline" title="Skip items the team already holds, sells, or bids on — sell what you have before buying more.">
              <input type="checkbox" checked={alloc.skipOwned}
                onChange={(e) => setAlloc({ skipOwned: e.target.checked })} />
              <span>skip owned/listed</span>
            </label>
          </div>
          {allocation.lines.length === 0 ? (
            <div className="empty">
              Nothing allocatable{effectiveBudget <= 0 ? ' — set a budget (or log in so half the wallet can be used)' : ' with positive defense-adjusted returns under these filters'}.
            </div>
          ) : (
            <>
              <div className="load-totals">
                <div>
                  <span className="lbl">Capital deployed</span>
                  <span className="val">{iskShort(allocation.lines.reduce((s, l) => s + l.cost, 0))}</span>
                </div>
                <div>
                  <span className="lbl">Expected ISK/day (adj)</span>
                  <span className="val pos">{iskShort(allocation.lines.reduce((s, l) => s + l.expPday, 0))}</span>
                </div>
                <div>
                  <span className="lbl">Items</span>
                  <span className="val">{allocation.lines.length}</span>
                </div>
                <div>
                  <span className="lbl">Skipped</span>
                  <span className="val dim">{allocation.skippedHeating} heating · {allocation.skippedOwned} owned</span>
                </div>
              </div>
              <table className="data">
                <thead>
                  <tr>
                    <th>Item</th><th>Dest</th>
                    <th><Tip tip="Units to buy — the scan's liquidity-sized quantity, scaled down to fit the budget caps.">Units</Tip></th>
                    <th><Tip tip="ISK for this line at the source buy price.">Cost</Tip></th>
                    <th><Tip tip="Share of the deployed capital.">Share</Tip></th>
                    <th><Tip tip="Expected defense-adjusted ISK/day from this line (scaled to the allocated quantity).">Exp/day</Tip></th>
                    <th><Tip tip="How many to LIST AT ONCE (≈1 day of the destination's absorption). Placement fees are proportional to quantity, so tranches cost the same in total — but reprice fees scale with what's LISTED, and listed stock is committed to that station. Small tranches = cheaper wars and freedom to stop feeding a market that turns hot. Fees already paid on listed stock are sunk: always let listed orders finish.">First listing</Tip></th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {allocation.lines.map((l) => (
                    <tr key={`${l.c.r.typeId}-${l.c.r.destId}`}>
                      <td className="hub-name">{l.c.r.name}</td>
                      <td className="dim">{l.c.r.destName}</td>
                      <td>{int(l.units)}</td>
                      <td>{iskShort(l.cost)}</td>
                      <td className="dim">{pct(l.cost / Math.max(1, allocation.lines.reduce((s, x) => s + x.cost, 0)))}</td>
                      <td className="pos">{iskShort(l.expPday)}</td>
                      <td className="dim">
                        {(() => {
                          const dv = l.c.r.dailyVolDest;
                          const tranche = dv !== null && dv > 0 ? Math.max(1, Math.min(l.units, Math.ceil(dv))) : l.units;
                          return tranche >= l.units
                            ? 'all at once'
                            : `${int(tranche)} now, rest as it sells`;
                        })()}
                      </td>
                      <td className="row-actions">
                        <button className="btn mini"
                          title={
                            finder.buyMode === 'order' && l.c.r.topBid !== null
                              ? `Open this item's market window in game (on ${charForHub(source.id) ? shortLabel(charForHub(source.id)!) : 'the buyer'}) AND copy ${tickPriceText(l.c.r.topBid, 'above')} — the 4-significant-digit price that beats the current top bid of ${isk(l.c.r.topBid)}. Paste straight into the buy-order price box.`
                              : l.c.r.patientSell !== null
                                ? `Open this item's market window in game AND copy ${tickPriceText(l.c.r.patientSell, 'below')} — the price that undercuts the destination's lowest ask (${isk(l.c.r.patientSell)}) by one 4-digit tick, for when you list.`
                                : 'Open this item\'s market window in the EVE client.'
                          }
                          onClick={async () => {
                            const target =
                              finder.buyMode === 'order' && l.c.r.topBid !== null
                                ? tickPriceText(l.c.r.topBid, 'above')
                                : l.c.r.patientSell !== null
                                  ? tickPriceText(l.c.r.patientSell, 'below')
                                  : null;
                            if (target !== null) {
                              try { await navigator.clipboard.writeText(target); } catch { /* clipboard denied */ }
                            }
                            void openMarketWindowEverywhere(l.c.r.typeId, charForHub(source.id)?.characterId).catch(() => {});
                          }}>
                          game 📋
                        </button>
                        <button className="btn mini" title="Item details in a popup — the plan stays right here"
                          onClick={() => setDetailTypeId(l.c.r.typeId)}>details</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid var(--baseline)' }}>
                    <td className="hub-name">Total — your expected daily profit from following this plan →</td>
                    <td></td>
                    <td className="dim">{int(allocation.lines.reduce((s, l) => s + l.units, 0))}</td>
                    <td>{iskShort(allocation.lines.reduce((s, l) => s + l.cost, 0))}</td>
                    <td className="dim">100%</td>
                    <td className="pos" style={{ fontWeight: 700 }}>{iskShort(allocation.lines.reduce((s, l) => s + l.expPday, 0))}</td>
                    <td></td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
              <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
                {allocChunks.map((_, i) => (
                  <button key={i} className="btn" onClick={() => copyAlloc(i)}>
                    {allocCopied === i ? '✓ copied' : `Copy multibuy${allocChunks.length > 1 ? ` ${i + 1}/${allocChunks.length}` : ''}`}
                  </button>
                ))}
                <span className="hint" style={{ margin: 0 }}>
                  paste into EVE's multibuy at the source hub · list in the suggested tranches — if a
                  market turns 🌡, LET LISTED ORDERS FINISH (their fees are sunk) but hold the unlisted
                  remainder back until it cools
                </span>
              </div>

              <div className="order-group-title" style={{ marginTop: 14 }}>
                <Tip tip="Where the team's ISK should SIT to execute this plan: the source-hub trader holds the purchase capital, each destination trader holds their listing fees plus a reprice/defense budget (from the defense model, capped at 7 days), the opportunity reserve stays liquid on anyone, and the remainder doesn't need to move.">Who holds what</Tip>
              </div>
              <table className="data" style={{ maxWidth: 720 }}>
                <thead>
                  <tr><th>Who</th><th>Purpose</th><th>ISK</th></tr>
                </thead>
                <tbody>
                  {placements(allocation.lines).map((p, i) => (
                    <tr key={i}>
                      <td className="hub-name">{p.who}</td>
                      <td className="dim" style={{ textAlign: 'left', whiteSpace: 'normal' }}>{p.purpose}</td>
                      <td className={p.isk < 0 ? 'neg' : undefined}>{iskShort(p.isk)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
      {detailTypeId !== null && (
        <ItemDetailModal typeId={detailTypeId} onClose={() => setDetailTypeId(null)} />
      )}
    </>
  );
}
