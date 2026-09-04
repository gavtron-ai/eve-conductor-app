import { useEffect } from 'react';
import { useApp, useHubs } from '../lib/store';
import { useActiveChar } from '../lib/auth';
import { usePrices } from '../lib/priceStore';
import { useMyMarket } from '../lib/myMarket';
import { openMarketWindowEverywhere } from '../lib/esiChar';
import { getType, categoryOf } from '../lib/typedb';
import { m3 } from '../lib/format';
import HubTable from './HubTable';
import ArbitragePanel from './ArbitragePanel';
import HistoryChart from './HistoryChart';
import SellingChip from './SellingChip';
import StockChip from './StockChip';

/**
 * Full item detail as a POPUP so scan results in the tab behind it survive —
 * closing it returns exactly where you were.
 */
export default function ItemDetailModal({ typeId, onClose }: { typeId: number; onClose: () => void }) {
  const hubs = useHubs();
  const refresh = usePrices((s) => s.refresh);
  const loading = usePrices((s) => s.loading);
  const watchlist = useApp((s) => s.watchlist);
  const stationTradeIds = useApp((s) => s.stationTradeIds);
  const toggleStationTrade = useApp((s) => s.toggleStationTrade);
  const toggleWatch = useApp((s) => s.toggleWatch);
  const characterId = useActiveChar()?.characterId ?? null;
  const item = getType(typeId);
  const watched = watchlist.includes(typeId);

  const ensureMyMarket = useMyMarket((s) => s.ensureFresh);
  useEffect(() => {
    refresh(hubs, [typeId]);
    void ensureMyMarket();
    // hubs identity is stable enough for a modal's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!item) return null;

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
        <div className="item-head" style={{ marginBottom: 12 }}>
          <button
            className={`star ${watched ? 'on' : ''}`}
            onClick={() => toggleWatch(typeId)}
            title={watched ? 'Remove from watchlist' : 'Add to watchlist'}
          >
            {watched ? '★' : '☆'}
          </button>
          <h1>{item.name}</h1>
          <SellingChip typeId={typeId} /><StockChip typeId={typeId} />
          <span className="meta">
            {m3(item.volume)} packaged · {categoryOf(typeId)}
          </span>
          {characterId && (
            <button
              className="btn mini"
              title="Open this item's market window in the EVE client (shows the market of wherever your character currently is)"
              onClick={() => openMarketWindowEverywhere(typeId).catch(() => {})}
            >
              open in game
            </button>
          )}
          <button
            className={`btn mini ${stationTradeIds.includes(typeId) ? 'primary' : ''}`}
            title={stationTradeIds.includes(typeId)
              ? 'STATION-TRADE item: flipped where it sits, never suggested for hauling. Click to unmark.'
              : "Mark as a STATION-TRADE item: bought at the hub it sells at — flipped in place, never suggested for hauling. Stays until untoggled."}
            onClick={() => toggleStationTrade(typeId)}
          >
            {stationTradeIds.includes(typeId) ? '⚑ station trade' : '⚐ station trade'}
          </button>
          <span style={{ flex: 1 }} />
          {loading && <span className="progress-text">fetching prices…</span>}
          <button className="btn" onClick={onClose}>✕ Close</button>
        </div>
        <HubTable typeId={typeId} />
        <div style={{ height: 14 }} />
        <ArbitragePanel typeId={typeId} />
        <div style={{ height: 14 }} />
        <HistoryChart typeId={typeId} />
      </div>
    </div>
  );
}
