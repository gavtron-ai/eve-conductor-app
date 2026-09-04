// The team's ACTUAL station-hangar inventory, from the ESI assets endpoint.
// This is ground truth for "do we still have it?" — the ledger's FIFO lots
// can drift from reality (a skill injector gets injected, loot gets used),
// so anything that claims "you have stock" must check here first.
import { create } from 'zustand';
import { esiAuth, openMarketWindow, onlineCharIds } from './esiChar';
import { useAuth, shortLabel, type CharAccount } from './auth';
import { computeStats } from './ledger';
import { BUILTIN_HUBS, ESI_BASE } from './constants';
import { esiFetch } from './esiRate';
import { useApp } from './store';
import { tickPriceText } from './priceTick';

/** an unattended background collector: yields to the overlay and to whatever
 * the user is actually looking at (see the priority lanes in esiRate.ts). */
const BACKGROUND = { lane: 'background' as const };

/** Only ships with THIS exact name carry goods in transit — whoever owns
 * them and wherever they are (wormholes, structures, deep space). Every
 * other ship's hold carries personal stuff (user's convention). */
/**
 * The ship whose hold counts as goods IN TRANSIT — now a per-player setting
 * (Settings → "Your setup"), because it used to be one player's ship name
 * compiled into the app. Empty string = nobody has configured one, and the
 * transit layer stays empty rather than guessing.
 */
export function transitShipName(): string {
  return (useApp.getState().settings.transitShipName ?? '').trim();
}

export interface StockHolding {
  typeId: number;
  qty: number;
  charId: number;
  locationId: number;
  /** true = in a ship's cargo/fleet hangar (moving, not idle at a station) */
  transit?: boolean;
  /** the STATION the holding effectively sits at: the hangar's station, or —
   * for transit holdings — where the transit ship itself is docked (absent
   * when the ship is in space / unresolvable) */
  stationId?: number;
}

interface StockState {
  /** hangar holdings per item type, across the whole team */
  byType: Record<number, StockHolding[]>;
  fetchedAt: number;
  loading: boolean;
  /** refresh when older than 30 minutes (ESI caches assets ~1h) */
  ensureFresh: () => Promise<void>;
}

interface AssetRow {
  item_id: number;
  type_id: number;
  location_id: number;
  location_flag: string;
  is_singleton: boolean;
  quantity: number;
}

const TTL_MS = 30 * 60_000;

export const useStock = create<StockState>((set, get) => ({
  byType: {},
  fetchedAt: 0,
  loading: false,

  ensureFresh: async () => {
    const chars = useAuth.getState().characters;
    if (chars.length === 0) return;
    const s = get();
    if (s.loading || Date.now() - s.fetchedAt < TTL_MS) return;
    set({ loading: true });
    try {
      const byType: Record<number, StockHolding[]> = {};
      for (const c of chars) {
        // ONLY assigned trade duties hold business stock (user rule):
        //   trader — station hangars AND the transit ship's hold
        //   hauler — the transit ship's hold only (their hangars are personal)
        //   no duty — nothing; a fleet/scout alt's assets are never stock,
        //   so their pages aren't even fetched
        if (!c.tradeRole) continue;
        try {
          const first = await esiAuth<AssetRow[]>(
            `/characters/${c.characterId}/assets/?page=1`,
            undefined,
            c.characterId,
          );
          const pages = first.pages;
          const rows = [...first.data];
          for (let p = 2; p <= pages; p++) {
            rows.push(
              ...(
                await esiAuth<AssetRow[]>(
                  `/characters/${c.characterId}/assets/?page=${p}`,
                  undefined,
                  c.characterId,
                )
              ).data,
            );
          }
          // PACKAGED items in TRADER station hangars (stock) PLUS goods in
          // transit. Transit rule (user's convention): ship-hold contents
          // count ONLY from ships whose name matches the configured transit ship EXACTLY — every other
          // ship's cargo is personal. The named-ship rule applies at EVERY
          // location (wormhole systems, structures, deep space — wherever
          // the route goes, the stock inside stays visible).
          // Container contents (flag Unlocked/Locked) stay excluded;
          // assembled items (is_singleton) are never stock.
          const isTrader = c.tradeRole === 'trader';
          const cargoRows = rows.filter(
            (r) => (r.location_flag === 'Cargo' || r.location_flag === 'FleetHangar') && !r.is_singleton,
          );
          let transitShipIds = new Set<number>();
          // no transit ship configured = no ship-hold contents count as stock,
          // and the /assets/names/ round trip is skipped entirely
          const transitName = transitShipName();
          if (transitName !== '' && cargoRows.length > 0) {
            // resolve the parent ships' names; keep only transit ships
            const parentIds = [...new Set(cargoRows.map((r) => r.location_id))];
            try {
              const { data } = await esiAuth<{ item_id: number; name: string }[]>(
                `/characters/${c.characterId}/assets/names/`,
                { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(parentIds) },
                c.characterId,
              );
              transitShipIds = new Set(
                data.filter((n) => n.name === transitName).map((n) => n.item_id),
              );
            } catch {
              // names unavailable → count no ship cargo rather than guess
            }
          }
          // where each transit ship itself is docked (its own asset row's
          // location is a station when docked, a solar system when in space)
          const shipStation = new Map<number, number | undefined>();
          for (const sid of transitShipIds) {
            const shipRow = rows.find((x) => x.item_id === sid);
            const loc = shipRow?.location_id;
            shipStation.set(sid, loc !== undefined && loc >= 60_000_000 ? loc : undefined);
          }
          const agg = new Map<string, StockHolding>();
          for (const r of rows) {
            const transit =
              (r.location_flag === 'Cargo' || r.location_flag === 'FleetHangar') &&
              transitShipIds.has(r.location_id);
            if ((r.location_flag !== 'Hangar' && !transit) || r.is_singleton) continue;
            // hangars count for TRADERS only (user rule): the hauler's goods
            // move directly into the transit ship; anything else in a
            // non-trader hangar is personal — only the named ship counts
            if (!isTrader && !transit) continue;
            const key = `${r.type_id}:${r.location_id}:${transit ? 't' : 'h'}`;
            const h =
              agg.get(key) ??
              agg
                .set(key, {
                  typeId: r.type_id,
                  qty: 0,
                  charId: c.characterId,
                  locationId: r.location_id,
                  transit,
                  stationId: transit ? shipStation.get(r.location_id) : r.location_id,
                })
                .get(key)!;
            h.qty += r.quantity ?? 1;
          }
          for (const h of agg.values()) (byType[h.typeId] ??= []).push(h);
        } catch {
          // one character's session issue mustn't blank the team's stock
        }
      }
      set({ byType, fetchedAt: Date.now(), loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));

// ---- location-aware next step for a holding ----
// The user's pipeline: goods are ACQUIRED at the finder's source hub (Jita),
// hauled by the Hauler in the transit ship, and LISTED at the destination
// trader's hub (Amarr). The right next step for a pile of stock therefore
// depends on WHERE it sits and WHO holds it — one rule set, used everywhere
// a "list it"-style tag renders.

export interface StockAction {
  key: 'list' | 'handoff' | 'haul' | 'unload' | 'hold';
  /** short tag text, e.g. "list it" / "give to Hauler" / "haul" */
  label: string;
  tip: string;
  /** the character whose in-game client should act (open windows on them) */
  actorId?: number;
}

const hubOfStation = (stationId?: number) =>
  stationId === undefined
    ? undefined
    : BUILTIN_HUBS.find((h) => h.kind === 'station' && h.locationId === stationId);

/** the pipeline's next step for ONE holding. The click actor is always the
 * HUB's own trader (Jita → J-Trader, Amarr → A-Trader — user rule), whatever
 * the tag says. */
export function stockActionFor(h: StockHolding): StockAction {
  const chars = useAuth.getState().characters;
  const holder = chars.find((c) => c.characterId === h.charId);
  const hub = hubOfStation(h.stationId);
  const srcHubId = useApp.getState().finder.sourceHubId; // acquisition hub (Jita)
  const hauler = chars.find((c) => c.tradeRole === 'hauler');
  const traderAt = (hubId?: string): CharAccount | undefined =>
    hubId ? chars.find((c) => c.tradeRole === 'trader' && c.homeHubId === hubId) : undefined;
  const hubTrader = traderAt(hub?.id);

  // in the transit hold (hauler hangars are never looked at)
  if (h.transit) {
    if (hub && hub.id !== srcHubId && hubTrader) {
      return {
        key: 'unload',
        label: `hand to ${shortLabel(hubTrader)}`,
        actorId: hubTrader.characterId,
        tip: `These arrived at ${hub.name} but are still in the ${transitShipName()} ship — trade them over to ${shortLabel(hubTrader)} so they can be listed.`,
      };
    }
    return {
      key: 'haul',
      label: 'haul',
      actorId: hubTrader?.characterId ?? hauler?.characterId ?? h.charId,
      tip: `Loaded in the ${transitShipName()} ship${hub ? ` at ${hub.name}` : ''} — fly the haul; the destination trader lists on arrival.`,
    };
  }

  // a trader's hangar
  if (hub) {
    // ⚑ STATION-TRADE items never join the haul pipeline: bought where
    // they'll be sold (user's explicit per-item toggle) — flip them HERE
    if (useApp.getState().stationTradeIds.includes(h.typeId)) {
      const lister = hubTrader ?? holder;
      return {
        key: 'list',
        label: '⚑ list it',
        actorId: lister?.characterId ?? h.charId,
        tip: `Marked as a STATION-TRADE item — bought at ${hub.name} to be flipped at ${hub.name}; it never joins the haul pile. Make the sell order right here (untoggle the ⚑ in the Item Explorer / Trade Finder if that changes).`,
      };
    }
    if (hub.id === srcHubId && hauler && hubTrader?.characterId === h.charId
      && chars.some((c) => c.tradeRole === 'trader' && c.homeHubId && c.homeHubId !== srcHubId)) {
      return {
        key: 'handoff',
        label: `give to ${shortLabel(hauler)}`,
        actorId: h.charId,
        tip: `Sitting in the ${hub.name} trader's hangar — the pipeline's next step is handing it to ${shortLabel(hauler)} for the haul to the selling hub.`,
      };
    }
    const lister = hubTrader ?? holder;
    return {
      key: 'list',
      label: 'list it',
      actorId: lister?.characterId ?? h.charId,
      tip: `At ${hub.name} in ${lister ? shortLabel(lister) : 'the holder'}'s hangar — ready to go on the market. Make the sell order.`,
    };
  }
  return { key: 'hold', label: 'in stock', tip: 'Held at a non-hub location.' };
}

/** the dominant action across a type's holdings (largest quantity wins) */
export function primaryStockAction(holdings: StockHolding[]): StockAction {
  const biggest = [...holdings].sort((a, b) => b.qty - a.qty)[0];
  return stockActionFor(biggest);
}

/**
 * The FIX-IT click for an unlisted pile (user rule: EVERY unlisted-item tag
 * is clickable): opens the item's market window on EVERY character that is
 * online in the game right now (whoever it wasn't for just closes it), and
 * copies the one-tick undercut of the online TRADER's hub best ask — the
 * hub the listing will actually happen at. The pile's recorded location is
 * NOT used for the price: the assets feed lags ~30 min, so freshly-hauled
 * goods still read as sitting at the source hub. Falls back to the pile's
 * hub (price and actor) when nobody reads as online.
 */
export async function fixItStock(typeId: number, holdings: StockHolding[]): Promise<void> {
  const primary = [...holdings].sort((a, b) => b.qty - a.qty)[0];
  const pileHub = hubOfStation(primary?.stationId);
  const chars = useAuth.getState().characters;
  const onlineIds = await onlineCharIds();
  const onlineChars = chars.filter((c) => onlineIds.includes(c.characterId));
  const onlineTrader = onlineChars.find((c) => c.tradeRole === 'trader' && c.homeHubId);
  // price source = where the listing happens: the online trader's own hub —
  // EXCEPT ⚑ station-trade items, which are flipped at the hub they sit at
  // (bought where they'll be sold, user's explicit toggle)
  const stationTrade = useApp.getState().stationTradeIds.includes(typeId);
  const targetHub = stationTrade
    ? pileHub
    : ((onlineTrader?.homeHubId ? BUILTIN_HUBS.find((h) => h.id === onlineTrader.homeHubId) : undefined) ??
      pileHub);
  if (targetHub) {
    try {
      const res = await esiFetch(
        `${ESI_BASE}/markets/${targetHub.regionId}/orders/?type_id=${typeId}&order_type=sell`,
        undefined,
        BACKGROUND,
      );
      if (res.ok) {
        const book = (await res.json()) as { location_id: number; price: number }[];
        const best = book
          .filter((o) => o.location_id === targetHub.locationId)
          .reduce((m, o) => Math.min(m, o.price), Infinity);
        // no asks at the target hub → copy NOTHING (a wrong-hub price in the
        // clipboard is worse than an empty one; you'd be the first lister)
        if (Number.isFinite(best)) {
          await navigator.clipboard.writeText(tickPriceText(best, 'below'));
        }
      }
    } catch {
      // price copy is best-effort — the window still opens
    }
  }
  if (onlineChars.length > 0) {
    // every running client gets the window — the user closes the spare one
    await Promise.all(
      onlineChars.map((c) => openMarketWindow(typeId, c.characterId).catch(() => {})),
    );
    return;
  }
  const fallback = pileHub
    ? chars.find((c) => c.tradeRole === 'trader' && c.homeHubId === pileHub.id)
    : undefined;
  await openMarketWindow(typeId, fallback?.characterId ?? primary?.charId);
}

// ---- cost basis (ledger FIFO), cached per ledger state ----

let costCacheKey = '';
let costCache: Map<number, { qty: number; avgCost: number; oldestDays: number }> = new Map();

/** avg unit cost + age of the UNSOLD lots per item (business books only) */
export function unsoldCosts(): Map<number, { qty: number; avgCost: number; oldestDays: number }> {
  const stats = computeStats();
  const key = `${stats.inventory.length}:${stats.totalBought}:${stats.totalSold}`;
  if (key === costCacheKey) return costCache;
  const m = new Map<number, { qty: number; cost: number; oldest: number }>();
  for (const lot of stats.inventory) {
    const e = m.get(lot.typeId) ?? m.set(lot.typeId, { qty: 0, cost: 0, oldest: Date.now() }).get(lot.typeId)!;
    e.qty += lot.qty;
    e.cost += lot.qty * lot.unitCost;
    e.oldest = Math.min(e.oldest, lot.date);
  }
  costCache = new Map(
    [...m.entries()].map(([t, e]) => [
      t,
      {
        qty: e.qty,
        avgCost: e.cost / Math.max(1, e.qty),
        oldestDays: (Date.now() - e.oldest) / 86_400_000,
      },
    ]),
  );
  costCacheKey = key;
  return costCache;
}
