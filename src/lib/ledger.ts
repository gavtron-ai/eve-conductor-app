// Local trading ledger. ESI only keeps ~30 days of wallet history, so every sync
// appends new transactions/fees into localStorage and the record accumulates
// forever — app updates never touch it. All analytics derive from this store.
//
// Accounting model (dummy-proof):
//  - Buys create inventory lots (qty × unit price). Sells consume lots FIFO;
//    realized profit = sale revenue − sales tax − matched cost.
//  - Sales with no recorded purchase (loot, pre-app stock) have no cost basis;
//    their revenue is tracked in a separate honest bucket, not counted as profit.
//  - Broker fees are charged per order, not per item, so they're totaled
//    separately rather than falsely attributed to individual trades.
import { esiAuth, type MyOrder, getMyOrders, getTeamOrders } from './esiChar';
import { useAuth } from './auth';
import { useApp } from './store';
import { getStation, getSystem, regionName } from './mapdata';
import { getType, categoryOf } from './typedb';

export interface LedgerTx {
  id: number;
  /** ms epoch */
  date: number;
  typeId: number;
  qty: number;
  unitPrice: number;
  locationId: number;
  isBuy: boolean;
  /** which team character (absent on pre-multichar entries) */
  charId?: number;
}

export interface LedgerFee {
  id: number;
  date: number;
  kind: 'brokers_fee' | 'transaction_tax';
  /** positive ISK amount paid */
  amount: number;
  /** transaction_tax: the transaction it belongs to */
  contextId: number | null;
  /** which team character (absent on pre-multichar entries) */
  charId?: number;
}

/**
 * One observed placement/modification of one of your orders. EVE bumps an
 * order's `issued` timestamp on every modify, and the broker fee lands in the
 * wallet journal at that same moment — so this log is what lets fees be
 * matched to specific orders.
 */
export interface OrderEvent {
  orderId: number;
  typeId: number;
  locationId: number;
  /** the order's issued timestamp at observation (ms) — one entry per distinct value */
  issued: number;
  price: number;
  isBuy: boolean;
  /** which team character owns the order (absent on pre-multichar entries) */
  charId?: number;
}

interface LedgerData {
  tx: LedgerTx[];
  fees: LedgerFee[];
  orderEvents: OrderEvent[];
  lastSync: number | null;
}

const KEY = 'etc-ledger-v1';

function load(): LedgerData {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (d && Array.isArray(d.tx) && Array.isArray(d.fees)) {
      return { orderEvents: [], ...d }; // orderEvents added later — default old saves
    }
  } catch {
    // fall through
  }
  return { tx: [], fees: [], orderEvents: [], lastSync: null };
}

export const ledger: LedgerData = load();

function persist() {
  localStorage.setItem(KEY, JSON.stringify(ledger));
}

/**
 * Record order sightings into the persistent event log. Call with every batch
 * of orders we see (live orders, order history) — a new (orderId, issued) pair
 * means a placement or a modification happened at that instant.
 */
// every order id that was EVER ours (order-event log, persists forever).
// The character-orders endpoint lags ~20 min and a lapsed session hides a
// character's orders entirely — this set keeps our own orders from ever
// being mistaken for rivals in statuses, heat, or trend events.
let ownIdsCache: Set<number> | null = null;
let ownIdsKey = -1;
export function everOwnedOrderIds(): Set<number> {
  if (ownIdsCache && ownIdsKey === ledger.orderEvents.length) return ownIdsCache;
  ownIdsCache = new Set(ledger.orderEvents.map((e) => e.orderId));
  ownIdsKey = ledger.orderEvents.length;
  return ownIdsCache;
}

export function recordOrderEvents(
  orders: {
    order_id: number;
    type_id: number;
    location_id: number;
    issued: string;
    price: number;
    is_buy_order?: boolean;
    ownerId?: number;
  }[],
  charId?: number,
): number {
  const known = new Set(ledger.orderEvents.map((e) => `${e.orderId}:${e.issued}`));
  let added = 0;
  for (const o of orders) {
    const issued = new Date(o.issued).getTime();
    const key = `${o.order_id}:${issued}`;
    if (known.has(key)) continue;
    known.add(key);
    ledger.orderEvents.push({
      orderId: o.order_id,
      typeId: o.type_id,
      locationId: o.location_id,
      issued,
      price: o.price,
      isBuy: o.is_buy_order === true,
      charId: o.ownerId ?? charId,
    });
    added++;
  }
  if (added > 0) {
    ledger.orderEvents.sort((a, b) => a.issued - b.issued);
    persist();
  }
  return added;
}

/** how close a fee's timestamp must be to an order event to count as a match */
const FEE_MATCH_TOLERANCE_MS = 10_000;

export interface FeeAttribution {
  /** journal fee id → matched order event */
  byFee: Map<number, OrderEvent>;
  /** orderId → total matched broker fees */
  byOrder: Map<number, number>;
  /** typeId → total matched broker fees (within the window) */
  byType: Map<number, number>;
  matchedTotal: number;
  unmatchedTotal: number;
}

/**
 * Match broker-fee journal entries to order events by timestamp: the fee lands
 * the moment an order is placed/modified, so equal-second timestamps identify
 * the order. Ambiguities (two events in the same window) pick the nearest;
 * fees with no matching observed event stay honestly unmatched.
 */
export function attributeBrokerFees(sinceMs = 0): FeeAttribution {
  const events = ledger.orderEvents;
  // a fee can only belong to an order of the SAME character
  const sameChar = (f: LedgerFee, e: OrderEvent) =>
    f.charId === undefined || e.charId === undefined || f.charId === e.charId;
  const byFee = new Map<number, OrderEvent>();
  const byOrder = new Map<number, number>();
  const byType = new Map<number, number>();
  let matchedTotal = 0;
  let unmatchedTotal = 0;

  let i = 0;
  for (const f of ledger.fees) {
    if (f.kind !== 'brokers_fee') continue;
    // events sorted by issued; advance a cursor to the fee's neighborhood
    while (i < events.length && events[i].issued < f.date - FEE_MATCH_TOLERANCE_MS) i++;
    let best: OrderEvent | null = null;
    for (let j = i; j < events.length && events[j].issued <= f.date + FEE_MATCH_TOLERANCE_MS; j++) {
      if (!sameChar(f, events[j])) continue;
      if (!best || Math.abs(events[j].issued - f.date) < Math.abs(best.issued - f.date)) {
        best = events[j];
      }
    }
    if (f.date < sinceMs) {
      if (best) byFee.set(f.id, best);
      continue;
    }
    if (best) {
      byFee.set(f.id, best);
      byOrder.set(best.orderId, (byOrder.get(best.orderId) ?? 0) + f.amount);
      byType.set(best.typeId, (byType.get(best.typeId) ?? 0) + f.amount);
      matchedTotal += f.amount;
    } else {
      unmatchedTotal += f.amount;
    }
  }
  return { byFee, byOrder, byType, matchedTotal, unmatchedTotal };
}

interface EsiTx {
  transaction_id: number;
  date: string;
  type_id: number;
  quantity: number;
  unit_price: number;
  location_id: number;
  is_buy: boolean;
  is_personal: boolean;
}

interface EsiJournal {
  id: number;
  date: string;
  ref_type: string;
  amount?: number;
  context_id?: number;
}

/** Sync every team character's wallet into the ledger. */
export async function syncAllLedgers(onProgress?: (msg: string) => void): Promise<void> {
  for (const c of useAuth.getState().characters) {
    try {
      await syncLedger(c.characterId, onProgress);
    } catch {
      // one character's session issue mustn't block the rest
    }
  }
}

/** Pull new wallet transactions + fee journal entries into the local ledger. */
export async function syncLedger(
  charId?: number,
  onProgress?: (msg: string) => void,
): Promise<{ newTx: number; newFees: number }> {
  const characterId = charId ?? useAuth.getState().activeId;
  if (!characterId) throw new Error('Not logged in.');

  const knownTx = new Set(ledger.tx.map((t) => t.id));
  const knownFees = new Set(ledger.fees.map((f) => f.id));
  let newTx = 0;
  let newFees = 0;

  // transactions paginate backwards via from_id until we hit known ground
  onProgress?.('Fetching wallet transactions…');
  let fromId: number | undefined;
  for (let page = 0; page < 20; page++) {
    const path =
      `/characters/${characterId}/wallet/transactions/` + (fromId ? `?from_id=${fromId}` : '');
    const { data } = await esiAuth<EsiTx[]>(path, undefined, characterId);
    if (data.length === 0) break;
    let sawKnown = false;
    for (const t of data) {
      if (knownTx.has(t.transaction_id)) {
        sawKnown = true;
        continue;
      }
      ledger.tx.push({
        id: t.transaction_id,
        date: new Date(t.date).getTime(),
        typeId: t.type_id,
        qty: t.quantity,
        unitPrice: t.unit_price,
        locationId: t.location_id,
        isBuy: t.is_buy,
        charId: characterId,
      });
      newTx++;
    }
    if (sawKnown || data.length < 1000) break;
    fromId = Math.min(...data.map((t) => t.transaction_id)) - 1;
  }

  onProgress?.('Fetching fee journal…');
  const first = await esiAuth<EsiJournal[]>(
    `/characters/${characterId}/wallet/journal/?page=1`,
    undefined,
    characterId,
  );
  let entries = first.data;
  for (let page = 2; page <= first.pages; page++) {
    entries = entries.concat(
      (
        await esiAuth<EsiJournal[]>(
          `/characters/${characterId}/wallet/journal/?page=${page}`,
          undefined,
          characterId,
        )
      ).data,
    );
  }
  for (const e of entries) {
    if (e.ref_type !== 'brokers_fee' && e.ref_type !== 'transaction_tax') continue;
    if (knownFees.has(e.id)) continue;
    ledger.fees.push({
      id: e.id,
      date: new Date(e.date).getTime(),
      kind: e.ref_type,
      amount: Math.abs(e.amount ?? 0),
      contextId: e.context_id ?? null,
      charId: characterId,
    });
    newFees++;
  }

  // order events power fee→order matching; pull both live and closed orders so
  // modifications made while the app was closed still get their timestamps
  onProgress?.('Recording order events…');
  try {
    recordOrderEvents(await getMyOrders(characterId), characterId);
  } catch {
    // optional enrichment
  }
  try {
    const h1 = await esiAuth<Parameters<typeof recordOrderEvents>[0]>(
      `/characters/${characterId}/orders/history/?page=1`,
      undefined,
      characterId,
    );
    let hist = h1.data;
    for (let page = 2; page <= h1.pages; page++) {
      hist = hist.concat(
        (
          await esiAuth<Parameters<typeof recordOrderEvents>[0]>(
            `/characters/${characterId}/orders/history/?page=${page}`,
            undefined,
            characterId,
          )
        ).data,
      );
    }
    recordOrderEvents(hist, characterId);
  } catch {
    // optional enrichment
  }

  ledger.tx.sort((a, b) => a.date - b.date || a.id - b.id);
  ledger.fees.sort((a, b) => a.date - b.date);
  ledger.lastSync = Date.now();
  persist();
  onProgress?.('');
  return { newTx, newFees };
}

// ---------- analytics (FIFO) ----------

export interface Sale {
  date: number;
  typeId: number;
  qty: number;
  /** units of this sale that had a recorded purchase behind them. Less than
   * `qty` means the profit below covers only that part — the rest is loot or
   * pre-app stock with no cost basis and is counted in unmatchedRevenue. */
  matchedQty: number;
  revenue: number;
  tax: number;
  /** matched FIFO cost; null when there was no recorded purchase at all */
  costBasis: number | null;
  locationId: number;
  /** PROVABLE profit: (revenue − tax) on the matched units, minus their cost.
   * null only when nothing was matched. Never extrapolated to the unmatched
   * part — that revenue is reported as having no cost basis instead. */
  profit: number | null;
}

export interface InventoryLot {
  typeId: number;
  qty: number;
  unitCost: number;
  date: number;
}

export interface LedgerStats {
  sales: Sale[];
  inventory: InventoryLot[];
  totalBought: number;
  totalSold: number;
  realizedProfit: number;
  /** revenue from sales with no recorded purchase (loot / pre-app stock) */
  unmatchedRevenue: number;
  totalBrokerFees: number;
  totalSalesTax: number;
  inventoryAtCost: number;
}

/**
 * FIFO over the whole ledger; `sinceMs` filters *sales* (cost lots use full
 * history). Items on the "excluded from books" list (PLEX sold for wallet ISK,
 * ships bought to fly) are left out entirely — the dashboard tracks the
 * market business, not personal spending.
 */
export function computeStats(sinceMs = 0, charFilter: number | null = null): LedgerStats {
  const excluded = new Set(useApp.getState().excludedFromBooks);
  // THE BOOKS COVER THE MARKET BUSINESS ONLY: an item qualifies if it has ever
  // appeared in one of YOUR orders (listed for sale, or bid on with a buy
  // order). Personal instant purchases (ships to fly, ammo) never qualify and
  // drop out automatically; hauling stock qualifies via its sell listing, so
  // its instant-buy cost basis still counts.
  const qualifying = new Set(ledger.orderEvents.map((e) => e.typeId));
  const taxByTx = new Map<number, number>();
  let totalBrokerFees = 0;
  let totalSalesTax = 0;
  for (const f of ledger.fees) {
    const charOk = charFilter === null || f.charId === undefined || f.charId === charFilter;
    if (f.kind === 'transaction_tax') {
      if (f.contextId) taxByTx.set(f.contextId, (taxByTx.get(f.contextId) ?? 0) + f.amount);
      if (f.date >= sinceMs && charOk) totalSalesTax += f.amount;
    } else if (f.date >= sinceMs && charOk) {
      totalBrokerFees += f.amount;
    }
  }

  const lots = new Map<number, InventoryLot[]>();
  const sales: Sale[] = [];
  let totalBought = 0;
  let totalSold = 0;
  let realizedProfit = 0;
  let unmatchedRevenue = 0;

  for (const t of ledger.tx) {
    if (excluded.has(t.typeId) || !qualifying.has(t.typeId)) continue;
    if (charFilter !== null && t.charId !== undefined && t.charId !== charFilter) continue;
    if (t.isBuy) {
      if (t.date >= sinceMs) totalBought += t.qty * t.unitPrice;
      (lots.get(t.typeId) ?? lots.set(t.typeId, []).get(t.typeId)!).push({
        typeId: t.typeId,
        qty: t.qty,
        unitCost: t.unitPrice,
        date: t.date,
      });
      continue;
    }
    // sell: consume FIFO lots
    const revenue = t.qty * t.unitPrice;
    const tax = taxByTx.get(t.id) ?? 0;
    let remaining = t.qty;
    let cost = 0;
    let matchedQty = 0;
    const typeLots = lots.get(t.typeId) ?? [];
    while (remaining > 0 && typeLots.length > 0) {
      const lot = typeLots[0];
      const take = Math.min(lot.qty, remaining);
      cost += take * lot.unitCost;
      matchedQty += take;
      lot.qty -= take;
      remaining -= take;
      if (lot.qty === 0) typeLots.shift();
    }
    // REPORT WHAT IS PROVABLY TRUE, AND ONLY THAT. A part-covered sale used
    // to report NO profit at all and dump the whole revenue in the unmatched
    // bucket — while still consuming the matched lots, so their cost vanished
    // from the books entirely. Sell 100 units of which 60 have a recorded
    // purchase and the profit on those 60 is a fact; it belongs in the total.
    // The other 40 have no cost basis, so their revenue (and nothing more)
    // goes to the honest bucket.
    const matchedFrac = t.qty > 0 ? matchedQty / t.qty : 0;
    const matchedRevenue = revenue * matchedFrac;
    const matchedTax = tax * matchedFrac;
    const profit = matchedQty > 0 ? matchedRevenue - matchedTax - cost : null;
    if (t.date >= sinceMs) {
      totalSold += revenue;
      if (profit !== null) realizedProfit += profit;
      unmatchedRevenue += revenue - matchedRevenue;
      sales.push({
        date: t.date,
        typeId: t.typeId,
        qty: t.qty,
        matchedQty,
        revenue,
        tax,
        costBasis: matchedQty > 0 ? cost : null,
        locationId: t.locationId,
        profit,
      });
    }
  }

  const inventory = [...lots.values()].flat().filter((l) => l.qty > 0);
  const inventoryAtCost = inventory.reduce((s, l) => s + l.qty * l.unitCost, 0);
  return {
    sales,
    inventory,
    totalBought,
    totalSold,
    realizedProfit,
    unmatchedRevenue,
    totalBrokerFees,
    totalSalesTax,
    inventoryAtCost,
  };
}

/** region name an ISK amount was earned in, from the sale's location */
export function regionOfLocation(locationId: number): string {
  const station = getStation(locationId);
  if (station) {
    const sys = getSystem(station.systemId);
    if (sys) return regionName(sys.regionId);
  }
  return locationId > 1_000_000_000_000 ? 'Player structures' : 'Unknown';
}

/** value of stock currently listed in sell orders (ask value), from live orders */
export async function onMarketValue(): Promise<{ ask: number; escrow: number; orders: MyOrder[] }> {
  const orders = await getTeamOrders(); // the whole team's open positions
  let ask = 0;
  let escrow = 0;
  for (const o of orders) {
    if (o.is_buy_order) escrow += o.escrow ?? 0;
    else ask += o.price * o.volume_remain;
  }
  return { ask, escrow, orders };
}

/** RFC 4180 quoting: a literal quote is doubled, not swapped for an
 * apostrophe. EVE item names really do contain quotes (Zainou 'Gnome', Neural
 * Lace 'Blackglass'), and one of those used to break the row into two fields
 * and shift every column after it. */
const csvCell = (v: string): string => `"${v.replace(/"/g, '""')}"`;

export function exportCsv(): string {
  const head = 'date,side,item,category,qty,unit_price,total,location\n';
  const rows = ledger.tx.map((t) => {
    const item = getType(t.typeId);
    const loc = getStation(t.locationId)?.name ?? String(t.locationId);
    return [
      new Date(t.date).toISOString(),
      t.isBuy ? 'buy' : 'sell',
      csvCell(item?.name ?? String(t.typeId)),
      csvCell(categoryOf(t.typeId)),
      t.qty,
      t.unitPrice,
      t.qty * t.unitPrice,
      csvCell(loc),
    ].join(',');
  });
  return head + rows.join('\n');
}
