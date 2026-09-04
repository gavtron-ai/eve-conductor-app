// The team's trading-value stack, snapshotted over time (bottom → top):
//   1. hangar stock, marked at the current JITA ask (ledger cost when no
//      Jita market) — trader-duty hangars only, same rule as Dashboard
//   2. goods in transit + 3. stock inside open sell orders, same mark
//   4. ISK escrowed in open buy orders   5. ISK in the team's wallets
// ONE YARDSTICK (user decision v38.3): everything is valued at what it
// would sell for via a sell order in Jita, wherever it currently sits —
// so the chart line moves when TRADING creates value, not when goods
// cross between differently-priced markets. (Historical points cannot be
// re-marked: snapshots store only the layer totals, not the holdings.)
// Snapshots append to the Do-Not-Delete trend history, so the timeline
// survives updates and reinstalls. HONESTY NOTE: EVE has no historical
// assets/orders API — the series can only start when this version first
// runs; nothing before that is reconstructable.
import { BUILTIN_HUBS } from './constants';
import { fetchAggregates } from './market';
import { useAuth } from './auth';
import { useStock, unsoldCosts } from './stock';
import { getTeamOrders, lastTeamOrderFailures, refreshWalletBalance } from './esiChar';
import { appendExternalEvents, loadTrendEvents, type TrendEvent } from './trends';

export interface NetWorthSnap {
  t: number;
  stock: number;
  /** goods in the transit ship's hold (hauler hangars are never counted) */
  transit: number;
  listed: number;
  escrow: number;
  wallets: number;
}

/** the recorded series, oldest first */
export async function loadNetWorthSeries(): Promise<NetWorthSnap[]> {
  const events = await loadTrendEvents();
  return events
    .filter((e) => e.kind === 'networth' && e.nw)
    .map((e) => ({ t: e.t, transit: 0, ...e.nw! }));
}

/**
 * Take one snapshot and append it when it says something new (any layer moved
 * >0.5%, or >6h since the last one). Returns true when recorded.
 */
export async function snapshotNetWorth(): Promise<boolean> {
  const chars = useAuth.getState().characters;
  if (chars.length === 0) return false;
  const stockState = useStock.getState();
  if (stockState.fetchedAt === 0) return false; // assets not synced yet — a zero would be a lie

  // FRESH balances (ESI ~120s cache) — the stored ones only update on full
  // character syncs, which made sale proceeds invisible and the chart dip
  // unattended: this snapshot runs on a timer, so it yields to the overlay
  // and to whatever the user is actually looking at
  for (const c of chars) await refreshWalletBalance(c.characterId, 'background');
  const freshChars = useAuth.getState().characters;
  // INTEGRITY GATE: a snapshot with any character missing is a lie (a lapsed
  // session once zeroed the escrow layer and carved 3b off the chart) —
  // better no point than a false one
  if (freshChars.some((c) => c.wallet === null)) return false;
  const wallets = freshChars.reduce((s, c) => s + (c.wallet ?? 0), 0);

  const orders = await getTeamOrders('background');
  if (lastTeamOrderFailures().length > 0) return false;
  const buys = orders.filter((o) => o.is_buy_order);
  const sells = orders.filter((o) => !o.is_buy_order);
  const escrow = buys.reduce((s, o) => s + (o.escrow ?? o.price * o.volume_remain), 0);

  // trader-duty scoping for hangar stock (hauler cargo is in transit)
  const traderIds = chars.filter((c) => c.tradeRole === 'trader').map((c) => c.characterId);
  const holderCounts = (id: number) => {
    const c = chars.find((x) => x.characterId === id);
    if (c?.tradeRole === 'hauler') return false;
    return traderIds.length === 0 || traderIds.includes(id);
  };
  const allHoldings = Object.values(stockState.byType).flat();
  const isHauler = (id: number) => chars.find((x) => x.characterId === id)?.tradeRole === 'hauler';
  // stock layer: idle trader hangars; transit layer: anything in a ship's
  // cargo/fleet hangar + everything the HAULER holds (staging included)
  const holdings = allHoldings.filter((h) => !h.transit && !isHauler(h.charId) && holderCounts(h.charId));
  const transitHoldings = allHoldings.filter((h) => h.transit || isHauler(h.charId));

  // ONE YARDSTICK: the Jita ask — what a sell order in Jita would fetch —
  // for every layer, wherever the goods sit (ledger cost only when the item
  // has no Jita market at all)
  const types = [...new Set([...holdings.map((h) => h.typeId), ...transitHoldings.map((h) => h.typeId), ...sells.map((o) => o.type_id)])];
  const jita = BUILTIN_HUBS.find((h) => h.id === 'jita')!;
  const jitaBook = types.length > 0 ? await fetchAggregates(jita, types) : new Map();
  const costs = unsoldCosts();
  const mark = (typeId: number, fallback = 0): number => {
    const j = jitaBook.get(typeId);
    if (j && j.sell.orderCount > 0 && j.sell.min > 0) return j.sell.min;
    return costs.get(typeId)?.avgCost ?? fallback;
  };

  const stock = holdings.reduce((s, h) => s + h.qty * mark(h.typeId), 0);
  const transit = transitHoldings.reduce((s, h) => s + h.qty * mark(h.typeId), 0);
  const listed = sells.reduce((s, o) => s + o.volume_remain * mark(o.type_id, o.price), 0);

  const snap: NetWorthSnap = {
    t: Date.now(),
    stock: Math.round(stock),
    transit: Math.round(transit),
    listed: Math.round(listed),
    escrow: Math.round(escrow),
    wallets: Math.round(wallets),
  };

  // only record when it says something new
  const series = await loadNetWorthSeries();
  const last = series[series.length - 1];
  if (last) {
    const moved = (['stock', 'transit', 'listed', 'escrow', 'wallets'] as const).some((k) => {
      const base = Math.max(1, Math.abs(last[k]));
      return Math.abs(snap[k] - last[k]) / base > 0.005;
    });
    if (!moved && snap.t - last.t < 6 * 3_600_000) return false;
  }

  const event: TrendEvent = {
    t: snap.t,
    kind: 'networth',
    charId: 0,
    orderId: 0,
    typeId: 0,
    stationId: 0,
    systemId: 0,
    nw: { stock: snap.stock, transit: snap.transit, listed: snap.listed, escrow: snap.escrow, wallets: snap.wallets },
  };
  await appendExternalEvents([event]);
  return true;
}
