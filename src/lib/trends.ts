// Long-term trend tracking: WHEN do my orders get outbid, WHEN do sales land,
// and WHO is fighting me — per system, kept forever in the Do-Not-Delete
// folder (see MULTI-MACHINE-SYNC-PLAN.md for where this design is heading).
//
// Data-quality rules:
// - Outbid events are timestamped with the RIVAL ORDER's `issued` time (the
//   book records when they set their price), clamped to the window we weren't
//   looking — so overnight undercuts get their real time, not "when the app
//   woke up", and hour-of-day stats stay honest.
// - Sale events come from WALLET TRANSACTIONS (exact fill times, unique tx
//   ids, ~30 days backfillable) — complete even for hours the app was closed.
//   The watcher's volume-drop detection is used only to fire fast alerts.
// - Rival events (new order / reprice / gone) are recorded per book we occupy,
//   transition-based, to fingerprint competitor cadence.
import { ESI_BASE } from './constants';
import { esiFetch } from './esiRate';
import { logWarn } from './devlog';
import { useAuth } from './auth';
import { useApp } from './store';
import { getTeamOrders, type MyOrder } from './esiChar';
import { ledger, everOwnedOrderIds } from './ledger';
import { getStation, systemsWithin } from './mapdata';
import { notifyTrends, type FillNotice } from './notify';

/** an unattended background collector: yields to the overlay and to whatever
 * the user is actually looking at (see the priority lanes in esiRate.ts). */
const BACKGROUND = { lane: 'background' as const };

export type TrendKind =
  | 'outbid_sell'
  | 'outbid_buy'
  | 'sale'
  | 'rival_new'
  | 'rival_reprice'
  | 'rival_gone'
  | 'mkt_hour' // one line per (book, hour): MARKET sales observed at the station
  | 'networth' // periodic snapshot of the team's trading-value stack
  | 'sales_rebased'; // marker: sales are tx-derived from here on

/** the kinds the per-system / per-item stats are built from */
export const CORE_KINDS: TrendKind[] = ['outbid_sell', 'outbid_buy', 'sale'];
export const RIVAL_KINDS: TrendKind[] = ['rival_new', 'rival_reprice', 'rival_gone'];

export interface TrendEvent {
  /** epoch ms — real event time where recoverable (rival issued / tx date) */
  t: number;
  kind: TrendKind;
  charId: number;
  orderId: number;
  typeId: number;
  stationId: number;
  /** 0 = player structure / unknown system */
  systemId: number;
  /** sale: units sold */
  qty?: number;
  /** sale: qty × price */
  isk?: number;
  /** my price (outbid) / fill price (sale) / rival price (rival events) */
  price?: number;
  /** outbid: the rival price that beat mine */
  rival?: number;
  /** outbid + rival events: the rival's order id (dedupe + fingerprinting) */
  rivalOrder?: number;
  /** rival_reprice: their previous price */
  prevPrice?: number;
  /** rival events: which side of the book */
  side?: 'sell' | 'buy';
  /** sale: EVE wallet transaction id (exact + dedupe key) */
  txId?: number;
  /** networth snapshots: the stacked layers, ISK (transit added v31) */
  nw?: { stock: number; transit?: number; listed: number; escrow: number; wallets: number };
}

/** append events produced OUTSIDE the watcher (e.g. net-worth snapshots) */
export async function appendExternalEvents(events: TrendEvent[]): Promise<void> {
  await appendTrendEvents(events);
}

interface OrderSnap {
  /** 'ok' = best/tied/alone, 'beaten' = outbid, 'unknown' = book unavailable */
  standing: 'ok' | 'beaten' | 'unknown';
  remain: number;
  price: number;
  isBuy: boolean;
  charId: number;
  typeId: number;
  stationId: number;
  systemId: number;
  /** when this snapshot was taken (clamps recovered event times) */
  at?: number;
}

interface RivalSnap {
  price: number;
  /** their issued timestamp, ms */
  issued: number;
  /** volume remaining at last look — drops are MARKET fills (unbiased) */
  remain?: number;
  typeId: number;
  stationId: number;
  systemId: number;
  side: 'sell' | 'buy';
  lastSeen: number;
}

/** accumulating market-fill buckets for the CURRENT hour; emitted as one
 * mkt_hour event per active book when the hour closes */
interface MktHourStore {
  hourStart: number;
  buckets: Record<string, { typeId: number; stationId: number; systemId: number; side: 'sell' | 'buy'; qty: number; isk: number }>;
}
const MKT_KEY = 'etc-trends-mkthour-v1';

interface RivalStore {
  /** book keys (`type:station:side`) that were observed last tick */
  watched: string[];
  rivals: Record<string, RivalSnap>;
}

interface BookOrder {
  order_id: number;
  location_id: number;
  system_id: number;
  is_buy_order: boolean;
  price: number;
  volume_remain: number;
  range: string;
  issued: string;
}

const SNAP_KEY = 'etc-trends-snap-v1';
const RIVAL_KEY = 'etc-trends-rivals-v1';
const LOCAL_EVENTS_KEY = 'etc-trends-events-v1'; // browser dev fallback only
/** re-check cadence; matches the ESI region-book cache (~5 min) */
export const TRENDS_INTERVAL_MS = 5 * 60_000;
/**
 * How old a snapshot may be and still say WHEN a fill happened. The watcher
 * runs every 5 minutes, so anything past ~3 cycles means we were not looking
 * — the fill is real, but its hour is unknown and must not vote on the
 * hour-of-day clock that drives "act NOW / fix in Xh".
 */
const HOUR_CLOCK_MAX_GAP_MS = 3 * TRENDS_INTERVAL_MS;
const isStale = (lastSeen: number | undefined): boolean =>
  lastSeen === undefined || Date.now() - lastSeen > HOUR_CLOCK_MAX_GAP_MS;
const BACKFILL_WINDOW_MS = 30 * 86_400_000; // ESI wallet keeps ~30d

// ---- event storage ----

let eventCache: TrendEvent[] | null = null;

function parseNdjson(text: string): TrendEvent[] {
  const out: TrendEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line) as TrendEvent;
      if (typeof e.t === 'number' && typeof e.kind === 'string') out.push(e);
    } catch {
      // a corrupt line loses one event, never the file
    }
  }
  return out;
}

/**
 * All recorded events, oldest first (cached in memory after first load).
 * Once the 'sales_rebased' marker exists, legacy watcher-detected sales
 * (no txId) are dropped in favor of the exact wallet-transaction ones.
 */
export async function loadTrendEvents(): Promise<TrendEvent[]> {
  if (eventCache) return eventCache;
  let all: TrendEvent[];
  const bridge = window.appInfo?.stats;
  if (bridge) {
    all = parseNdjson(await bridge.readAll());
  } else {
    try {
      all = JSON.parse(localStorage.getItem(LOCAL_EVENTS_KEY) ?? '[]') as TrendEvent[];
    } catch {
      all = [];
    }
  }
  if (all.some((e) => e.kind === 'sales_rebased')) {
    all = all.filter((e) => !(e.kind === 'sale' && e.txId === undefined));
  }
  all.sort((a, b) => a.t - b.t);
  eventCache = all;
  return eventCache;
}

async function appendTrendEvents(events: TrendEvent[]): Promise<void> {
  if (events.length === 0) return;
  await loadTrendEvents();
  eventCache!.push(...events);
  eventCache!.sort((a, b) => a.t - b.t);
  const bridge = window.appInfo?.stats;
  if (bridge) {
    await bridge.append(events.map((e) => JSON.stringify(e)));
  } else {
    localStorage.setItem(LOCAL_EVENTS_KEY, JSON.stringify(eventCache));
  }
}

/** where events are stored (shown in the Trends tab) */
export async function trendsStorageInfo(): Promise<string> {
  const bridge = window.appInfo?.stats;
  if (!bridge) return 'browser localStorage (dev mode — desktop app stores to disk)';
  try {
    return (await bridge.info()).dir;
  } catch {
    return 'storage unavailable';
  }
}

// ---- local watcher state (derivable; losing it just skips one diff) ----

function loadJson<T>(key: string, fallback: T): T {
  try {
    return (JSON.parse(localStorage.getItem(key) ?? 'null') as T) ?? fallback;
  } catch {
    return fallback;
  }
}

// ---- standing computation ----

/** can this buy order be hit by a sale at `stationId` (in `systemId`)? */
/**
 * Does this BUY order compete for stock at the given station? EVE buy orders
 * reach by RANGE, not by sitting in the same station — a region-range bid
 * five jumps away takes the sale just as surely as one at your counter.
 * Exported because MyOrders (the screen the user ACTS from) was the one place
 * still comparing buy orders station-only, while trends and the scanner both
 * did this properly.
 */
export function buyOrderReaches(
  o: { location_id: number; system_id?: number; range?: string },
  stationId: number,
  systemId: number,
): boolean {
  if (o.location_id === stationId) return true;
  if (o.range === 'region') return true;
  if (systemId === 0) return false; // unknown system: same-station only
  if (o.system_id === undefined) return false; // no range data: station-only
  if (o.system_id === systemId) return true; // station/system/short ranges, same system
  const jumps = Number(o.range);
  if (!Number.isFinite(jumps)) return false;
  return systemsWithin(o.system_id, jumps).has(systemId);
}

/** the rival orders that actually compete with mine on this book */
function relevantRivals(
  o: MyOrder,
  book: BookOrder[],
  teamOrderIds: Set<number>,
  systemId: number,
): BookOrder[] {
  if (o.is_buy_order) {
    return book.filter(
      (b) =>
        b.is_buy_order && !teamOrderIds.has(b.order_id) && buyOrderReaches(b, o.location_id, systemId),
    );
  }
  return book.filter(
    (b) => !b.is_buy_order && !teamOrderIds.has(b.order_id) && b.location_id === o.location_id,
  );
}

function computeStanding(
  o: MyOrder,
  rivals: BookOrder[],
  book: BookOrder[],
): { standing: 'ok' | 'beaten'; myPrice: number; best?: BookOrder } {
  // my own order in the PUBLIC book is fresher (~5 min) than the character
  // orders endpoint (~20 min) — prefer its price so a recent reprice doesn't
  // create a false outbid event
  const myPrice = book.find((b) => b.order_id === o.order_id)?.price ?? o.price;
  if (rivals.length === 0) return { standing: 'ok', myPrice };
  const best = o.is_buy_order
    ? rivals.reduce((a, b) => (b.price > a.price ? b : a))
    : rivals.reduce((a, b) => (b.price < a.price ? b : a));
  const beaten = o.is_buy_order ? best.price > myPrice + 0.005 : best.price < myPrice - 0.005;
  return beaten ? { standing: 'beaten', myPrice, best } : { standing: 'ok', myPrice };
}

// ---- sales from the wallet (exact times, dedupe by transaction id) ----

function backfillSales(existing: TrendEvent[], now: number): TrendEvent[] {
  const excluded = useApp.getState().excludedFromBooks;
  // a transaction is a sell-order fill if we've ever LISTED that item at that
  // station (order-event log) — instant dumps elsewhere don't qualify
  const sellKeys = new Set(
    ledger.orderEvents.filter((e) => !e.isBuy).map((e) => `${e.typeId}:${e.locationId}`),
  );
  if (sellKeys.size === 0) return [];
  const known = new Set(
    existing.filter((e) => e.kind === 'sale' && e.txId !== undefined).map((e) => e.txId),
  );
  const out: TrendEvent[] = [];
  if (!existing.some((e) => e.kind === 'sales_rebased')) {
    out.push({ t: now, kind: 'sales_rebased', charId: 0, orderId: 0, typeId: 0, stationId: 0, systemId: 0 });
  }
  const cutoff = now - BACKFILL_WINDOW_MS;
  for (const tx of ledger.tx) {
    if (tx.isBuy || tx.date < cutoff || known.has(tx.id)) continue;
    if (!sellKeys.has(`${tx.typeId}:${tx.locationId}`)) continue;
    if (excluded.includes(tx.typeId)) continue;
    out.push({
      t: tx.date,
      kind: 'sale',
      charId: tx.charId ?? 0,
      orderId: 0,
      typeId: tx.typeId,
      stationId: tx.locationId,
      systemId: getStation(tx.locationId)?.systemId ?? 0,
      qty: tx.qty,
      isk: tx.qty * tx.unitPrice,
      price: tx.unitPrice,
      txId: tx.id,
    });
  }
  return out;
}

// ---- the tick ----

let lastTickAt: number | null = null;
export function lastTrendsTick(): number | null {
  return lastTickAt;
}

/**
 * One observation pass: team orders + the live books they sit in, diffed
 * against the previous snapshots. Records outbid + rival events, backfills
 * exact sales from the wallet, fires alerts. Returns events recorded.
 */
export async function runTrendsTick(): Promise<number> {
  if (useAuth.getState().characters.length === 0) return 0;
  const now = Date.now();
  const allOrders = await getTeamOrders('background'); // unattended watcher
  // same business-scope rule as My Orders: books-excluded items and
  // cash-bought PLEX are personal — they must not pollute trends, schedules
  // or market-fill observation either
  const excludedTypes = new Set(useApp.getState().excludedFromBooks);
  const plexBoughtForIsk = ledger.tx.some((t) => t.isBuy && t.typeId === 44992);
  const orders = allOrders.filter(
    (o) => !excludedTypes.has(o.type_id) && (o.type_id !== 44992 || plexBoughtForIsk),
  );
  const teamOrderIds = new Set([...allOrders.map((o) => o.order_id), ...everOwnedOrderIds()]);

  // one live book per (region, item) any team order touches; null = fetch
  // failed (never confused with an actually-empty book)
  const books = new Map<string, BookOrder[] | null>();
  for (const o of orders) {
    const key = `${o.region_id}:${o.type_id}`;
    if (books.has(key)) continue;
    try {
      const res = await esiFetch(
        `${ESI_BASE}/markets/${o.region_id}/orders/?type_id=${o.type_id}&order_type=all`,
        undefined,
        BACKGROUND,
      );
      books.set(key, res.ok ? ((await res.json()) as BookOrder[]) : null);
    } catch {
      books.set(key, null);
    }
  }

  const snaps = loadJson<Record<string, OrderSnap>>(SNAP_KEY, {});
  const rivalStore = loadJson<RivalStore>(RIVAL_KEY, { watched: [], rivals: {} });

  // market-fill buckets: when the hour rolls over, the closed hour's buckets
  // become one mkt_hour event each — station-level "when do people BUY here",
  // unbiased by our own queue position (rival volume drops = real fills)
  const hourStart = Math.floor(now / 3_600_000) * 3_600_000;
  const mkt = loadJson<MktHourStore>(MKT_KEY, { hourStart, buckets: {} });
  const mktEvents: TrendEvent[] = [];
  if (mkt.hourStart < hourStart) {
    for (const b of Object.values(mkt.buckets)) {
      if (b.qty > 0) {
        mktEvents.push({
          t: mkt.hourStart + 1_800_000, // hour midpoint
          kind: 'mkt_hour',
          charId: 0,
          orderId: 0,
          typeId: b.typeId,
          stationId: b.stationId,
          systemId: b.systemId,
          qty: b.qty,
          isk: b.isk,
          side: b.side ?? 'sell',
        });
      }
    }
    mkt.hourStart = hourStart;
    mkt.buckets = {};
  }
  /**
   * THE HOUR CLOCK MUST MEASURE THE STATION, NOT THIS APP'S UPTIME.
   *
   * A volume drop is credited to the hour we OBSERVED it, which is only
   * honest while the gap since the last look is short. Both snapshots persist
   * in localStorage, so the first tick after a closed laptop diffs against a
   * baseline that may be 12 hours old — and every unit filled overnight used
   * to land in the hour the app happened to be opened. Do that every morning
   * and best3h() reports "prime selling window 07:00-10:00" for a station
   * that simply gets looked at over coffee; MyOrders then renders that as
   * "act NOW - prime hours". That is observation bias driving a money
   * decision, and rule 2 (measure transitions, not state dumps) exists
   * precisely because of it.
   *
   * A drop measured across a wide gap is still a REAL fill — we just cannot
   * say WHEN it happened. So the quantity is dropped from the hour clock
   * rather than misfiled. Exact sale times come from wallet transactions
   * anyway (backfillSales), which is the record the profit numbers use;
   * mkt_hour only ever fed the hour-of-day histogram.
   *
   * `staleBaseline` is the caller's judgement about the snapshot it diffed.
   */
  const addMkt = (
    typeId: number, stationId: number, systemId: number, qty: number, price: number,
    side: 'sell' | 'buy' = 'sell',
    staleBaseline = false,
  ) => {
    if (staleBaseline) {
      mktSkipped += qty;
      return;
    }
    const key = `${typeId}:${stationId}:${side}`;
    const b = mkt.buckets[key] ?? (mkt.buckets[key] = { typeId, stationId, systemId, side, qty: 0, isk: 0 });
    b.qty += qty;
    b.isk += qty * price;
  };
  let mktSkipped = 0;
  const prevWatched = new Set(rivalStore.watched);
  const nextRivals: Record<string, RivalSnap> = {};
  const nextWatched = new Set<string>();
  const events: TrendEvent[] = [];
  const fills: FillNotice[] = [];
  const nextSnaps: Record<string, OrderSnap> = {};
  const processedBooks = new Set<string>();

  for (const o of orders) {
    const station = getStation(o.location_id);
    const systemId = station?.systemId ?? 0;
    const book = books.get(`${o.region_id}:${o.type_id}`) ?? null;
    const usable = book !== null && book.length > 0;
    const rivals = usable ? relevantRivals(o, book, teamOrderIds, systemId) : [];
    const { standing, myPrice, best } = usable
      ? computeStanding(o, rivals, book)
      : { standing: 'unknown' as const, myPrice: o.price, best: undefined };
    const prev = snaps[String(o.order_id)];
    const side: 'sell' | 'buy' = o.is_buy_order ? 'buy' : 'sell';

    // outbid: only on the TRANSITION from winning to beaten; the rival's own
    // issued timestamp is the real WHEN (clamped to our observation gap)
    if (prev?.standing === 'ok' && standing === 'beaten' && best) {
      const issuedMs = new Date(best.issued).getTime();
      const t = Math.min(now, Math.max(Number.isFinite(issuedMs) ? issuedMs : now, prev.at ?? 0));
      events.push({
        t,
        kind: o.is_buy_order ? 'outbid_buy' : 'outbid_sell',
        charId: o.ownerId ?? 0,
        orderId: o.order_id,
        typeId: o.type_id,
        stationId: o.location_id,
        systemId,
        price: myPrice,
        rival: best.price,
        rivalOrder: best.order_id,
        side,
      });
    }
    // fill fast-path: volume dropped → alert now; the RECORDED sale event
    // comes from the wallet transaction (exact time) on a later pass
    if (prev && !o.is_buy_order && o.volume_remain < prev.remain) {
      fills.push({ typeId: o.type_id, systemId, qty: prev.remain - o.volume_remain, price: myPrice });
      // our own fills are market fills too — but only vote on the hour clock
      // when we actually saw the book recently enough to know WHEN
      addMkt(o.type_id, o.location_id, systemId, prev.remain - o.volume_remain, myPrice, 'sell',
        isStale(prev.at));
    }

    // rival diffing, once per occupied book+side
    const bookKey = `${o.type_id}:${o.location_id}:${side}`;
    if (usable && !processedBooks.has(bookKey)) {
      processedBooks.add(bookKey);
      nextWatched.add(bookKey);
      const wasWatched = prevWatched.has(bookKey);
      const seen = new Set<string>();
      for (const r of rivals) {
        const rk = String(r.order_id);
        seen.add(rk);
        const rIssued = new Date(r.issued).getTime();
        const rPrev = rivalStore.rivals[rk];
        const base = {
          charId: o.ownerId ?? 0,
          orderId: o.order_id,
          typeId: o.type_id,
          stationId: o.location_id,
          systemId,
          rivalOrder: r.order_id,
          side,
        };
        if (!rPrev) {
          if (wasWatched) {
            events.push({ t: Math.min(now, rIssued || now), kind: 'rival_new', ...base, price: r.price });
          }
        } else if (rPrev.price !== r.price) {
          events.push({
            t: Math.min(now, rIssued || now),
            kind: 'rival_reprice',
            ...base,
            price: r.price,
            prevPrice: rPrev.price,
          });
        }
        // a rival order's remaining volume only ever drops via fills — sell
        // side = market sales; BUY side = sellers dumping into bids. Both are
        // real flow, recorded with the side flag.
        if (rPrev?.remain !== undefined && r.volume_remain < rPrev.remain) {
          // rPrev.lastSeen is when we last actually looked at this rival
          addMkt(o.type_id, o.location_id, systemId, rPrev.remain - r.volume_remain, rPrev.price, side,
            isStale(rPrev.lastSeen));
        }
        nextRivals[rk] = {
          price: r.price,
          issued: rIssued || now,
          remain: r.volume_remain,
          typeId: o.type_id,
          stationId: o.location_id,
          systemId,
          side,
          lastSeen: now,
        };
      }
      if (wasWatched) {
        for (const [rk, rPrev] of Object.entries(rivalStore.rivals)) {
          if (
            rPrev.typeId === o.type_id &&
            rPrev.stationId === o.location_id &&
            rPrev.side === side &&
            !seen.has(rk)
          ) {
            events.push({
              t: now,
              kind: 'rival_gone',
              charId: o.ownerId ?? 0,
              orderId: o.order_id,
              typeId: o.type_id,
              stationId: o.location_id,
              systemId,
              rivalOrder: Number(rk),
              price: rPrev.price,
              side,
            });
          }
        }
      }
    }

    nextSnaps[String(o.order_id)] = {
      standing,
      remain: o.volume_remain,
      price: myPrice,
      isBuy: Boolean(o.is_buy_order),
      charId: o.ownerId ?? 0,
      typeId: o.type_id,
      stationId: o.location_id,
      systemId,
      at: now,
    };
  }

  // exact sales from the wallet ledger (already synced by the app loop)
  const existing = await loadTrendEvents();
  events.push(...backfillSales(existing, now));
  events.push(...mktEvents);

  // NEVER DROP DATA SILENTLY. Units seen filling across a gap we were not
  // watching are real, but their hour is unknown — they are excluded from the
  // hour-of-day clock and said so, rather than quietly misfiled into whatever
  // hour the app happened to wake up in.
  if (mktSkipped > 0) {
    logWarn('trends', 'fills across an unobserved gap excluded from the hour clock', {
      units: mktSkipped, limitMin: HOUR_CLOCK_MAX_GAP_MS / 60_000,
      note: 'still counted as real fills; only their HOUR is unknown',
    });
  }

  localStorage.setItem(SNAP_KEY, JSON.stringify(nextSnaps));
  localStorage.setItem(MKT_KEY, JSON.stringify(mkt));
  localStorage.setItem(RIVAL_KEY, JSON.stringify({ watched: [...nextWatched], rivals: nextRivals }));
  await appendTrendEvents(events);
  notifyTrends(events.filter((e) => e.kind === 'outbid_sell' || e.kind === 'outbid_buy'), fills);
  lastTickAt = now;
  return events.length;
}
