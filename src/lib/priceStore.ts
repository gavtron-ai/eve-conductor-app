import { create } from 'zustand';
import { fetchAggregates } from './market';
import type { Hub, PriceBook } from './types';

interface PriceState {
  book: PriceBook;
  loading: boolean;
  error: string | null;
  lastUpdated: number | null;
  /** fetch aggregates for all hubs × typeIds (cached unless force) */
  refresh: (hubs: Hub[], typeIds: number[], force?: boolean) => Promise<void>;
}

export const usePrices = create<PriceState>((set) => ({
  book: {},
  loading: false,
  error: null,
  lastUpdated: null,

  refresh: async (hubs, typeIds, force = false) => {
    if (hubs.length === 0 || typeIds.length === 0) return;
    set({ loading: true, error: null });
    try {
      const results = await Promise.all(
        hubs.map(async (hub) => [hub.id, await fetchAggregates(hub, typeIds, force)] as const),
      );
      set((s) => {
        const book: PriceBook = { ...s.book };
        for (const [hubId, aggs] of results) {
          book[hubId] = { ...book[hubId] };
          for (const [typeId, agg] of aggs) book[hubId][typeId] = agg;
        }
        return { book, loading: false, lastUpdated: Date.now() };
      });
    } catch (e) {
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      // RETHROW. Swallowing this made refresh() always resolve, so App.tsx's
      // .then() reported a SUCCESSFUL price refresh to the freshness store on
      // a total Fuzzwork outage — the statusbar then showed a fresh timestamp
      // and a normal countdown over prices that had never arrived.
      throw e;
    }
  },
}));
