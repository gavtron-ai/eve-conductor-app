// "Am I already selling this?" — my active sell orders per item, with the best
// competing price at each order's station, cached ~5 min and shared by the
// finder / auto haul / explorer row icons.
import { create } from 'zustand';
import { ESI_BASE } from './constants';
import { esiFetch } from './esiRate';
import { useAuth, ownerLabel } from './auth';
import { getTeamOrders } from './esiChar';
import { recordOrderEvents, everOwnedOrderIds } from './ledger';
import { getStation } from './mapdata';
import { isk, int } from './format';

export interface MySell {
  typeId: number;
  price: number;
  remain: number;
  total: number;
  locationName: string;
  /** cheapest competing sell at the same station, null = I'm alone */
  bestOther: number | null;
  /** which team character owns this order */
  ownerId?: number;
  ownerName?: string;
}

interface MyMarketState {
  sellsByType: Record<number, MySell[]>;
  /** the team's open BUY orders per item — "you're already bidding on this" */
  buysByType: Record<number, MySell[]>;
  fetchedAt: number;
  loading: boolean;
  /** refresh when older than 5 minutes (no-op when logged out) */
  ensureFresh: () => Promise<void>;
}

const TTL_MS = 5 * 60 * 1000;

// every team order id seen on the last refresh — heat computations exclude
// these so your own reprices can't make a book look "hot" to yourself
let knownOrderIds = new Set<number>();
export function teamOrderIds(): Set<number> {
  return knownOrderIds;
}

export const useMyMarket = create<MyMarketState>((set, get) => ({
  sellsByType: {},
  buysByType: {},
  fetchedAt: 0,
  loading: false,

  ensureFresh: async () => {
    if (useAuth.getState().characters.length === 0) return;
    const s = get();
    if (s.loading || Date.now() - s.fetchedAt < TTL_MS) return;
    set({ loading: true });
    try {
      const all = await getTeamOrders(); // the whole team's orders, both sides
      recordOrderEvents(all);
      const myIds = new Set([...all.map((o) => o.order_id), ...everOwnedOrderIds()]);
      knownOrderIds = myIds;
      // one book per (region, item) any team order touches — both sides at once
      const comp = new Map<
        string,
        { location_id: number; price: number; order_id: number; is_buy_order: boolean }[]
      >();
      for (const o of all) {
        const key = `${o.region_id}:${o.type_id}`;
        if (comp.has(key)) continue;
        const res = await esiFetch(
          `${ESI_BASE}/markets/${o.region_id}/orders/?type_id=${o.type_id}&order_type=all`,
        );
        comp.set(key, res.ok ? await res.json() : []);
      }
      const sellsByType: Record<number, MySell[]> = {};
      const buysByType: Record<number, MySell[]> = {};
      for (const o of all) {
        const isBuy = Boolean(o.is_buy_order);
        // competitors on MY side of the book at MY station — who buyers/sellers
        // compare me against (regional-range buy rivals are My Orders' job)
        const others = (comp.get(`${o.region_id}:${o.type_id}`) ?? []).filter(
          (c) => c.location_id === o.location_id && c.is_buy_order === isBuy && !myIds.has(c.order_id),
        );
        ((isBuy ? buysByType : sellsByType)[o.type_id] ??= []).push({
          typeId: o.type_id,
          price: o.price,
          remain: o.volume_remain,
          total: o.volume_total,
          locationName:
            getStation(o.location_id)?.name ?? `Structure …${String(o.location_id).slice(-4)}`,
          bestOther: others.length
            ? isBuy
              ? Math.max(...others.map((c) => c.price))
              : Math.min(...others.map((c) => c.price))
            : null,
          ownerId: o.ownerId,
          ownerName: o.ownerName,
        });
      }
      set({ sellsByType, buysByType, fetchedAt: Date.now(), loading: false });
    } catch {
      set({ loading: false }); // stale data stays; retry after TTL
    }
  },
}));

/** multi-line tooltip text for the "already selling" icon */
export function sellingTooltip(sells: MySell[]): string {
  return sells
    .map((s) => {
      const shortLoc = s.locationName.length > 40 ? s.locationName.slice(0, 40) + '…' : s.locationName;
      const compare =
        s.bestOther === null
          ? 'no competition'
          : s.bestOther < s.price
            ? `best other ${isk(s.bestOther)} (cheaper than you!)`
            : `best other ${isk(s.bestOther)}`;
      const who = s.ownerId || s.ownerName ? `${ownerLabel(s.ownerId, s.ownerName)}: ` : '';
      return `${who}${int(s.remain)}/${int(s.total)} left @ ${isk(s.price)} — ${compare}\n   at ${shortLoc}`;
    })
    .join('\n');
}

/** multi-line tooltip text for the "already buying" icon */
export function buyingTooltip(buys: MySell[]): string {
  return buys
    .map((b) => {
      const shortLoc = b.locationName.length > 40 ? b.locationName.slice(0, 40) + '…' : b.locationName;
      const compare =
        b.bestOther === null
          ? 'no competing bids at this station'
          : b.bestOther > b.price
            ? `best other bid ${isk(b.bestOther)} (outbids you!)`
            : `best other bid ${isk(b.bestOther)}`;
      const who = b.ownerId || b.ownerName ? `${ownerLabel(b.ownerId, b.ownerName)}: ` : '';
      return `${who}bidding ${isk(b.price)} for ${int(b.remain)}/${int(b.total)} — ${compare}\n   at ${shortLoc}`;
    })
    .join('\n');
}
