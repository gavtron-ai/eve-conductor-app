import { useApp } from '../lib/store';
import { usePrices } from '../lib/priceStore';
import { getType } from '../lib/typedb';
import { iskShort } from '../lib/format';

/**
 * Watchlist sidebar — Item Explorer only (the app started life as an item
 * explorer; the watchlist stays useful there and out of the way everywhere
 * else). Hub management moved to Settings.
 */
export default function Sidebar() {
  const watchlist = useApp((s) => s.watchlist);
  const selected = useApp((s) => s.selectedTypeId);
  const select = useApp((s) => s.select);
  const toggleWatch = useApp((s) => s.toggleWatch);
  const book = usePrices((s) => s.book);

  return (
    <aside className="sidebar">
      <section>
        <h3 className="section-title">Watchlist</h3>
        <div className="side-list">
          {watchlist.length === 0 && <div className="hint">Star an item to watch it here.</div>}
          {watchlist.map((id) => {
            const t = getType(id);
            const jitaSell = book['jita']?.[id]?.sell;
            return (
              <div
                key={id}
                className={`side-row ${selected === id ? 'selected' : ''}`}
                onClick={() => select(id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === 'Enter' && select(id)}
              >
                <span className="grow">{t?.name ?? `#${id}`}</span>
                <span className="price">
                  {jitaSell && jitaSell.orderCount > 0 ? iskShort(jitaSell.min) : ''}
                </span>
                <button
                  className="x"
                  title="Remove from watchlist"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleWatch(id);
                  }}
                >
                  ✕
                </button>
              </div>
            );
          })}
        </div>
        <div className="hint">Prices shown are Jita sell.</div>
      </section>
    </aside>
  );
}
