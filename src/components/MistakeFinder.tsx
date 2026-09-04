import { useState } from 'react';
import { useApp, useHubs } from '../lib/store';
import { useActiveChar } from '../lib/auth';
import { openMarketWindowEverywhere } from '../lib/esiChar';
import { findMistakes, type MistakeRow } from '../lib/scanner';
import { allTypes } from '../lib/typedb';
import { useSort } from '../lib/useSort';
import { isk, iskShort, int, pct } from '../lib/format';
import Tip from './Tip';
import ItemDetailModal from './ItemDetailModal';

type MistakeCol = 'name' | 'kind' | 'price' | 'ref' | 'dev' | 'depth' | 'flip';

const KIND_LABEL: Record<MistakeRow['kind'], { text: string; cls: string; hint: string }> = {
  crossed: {
    text: 'crossed book',
    cls: 'flag good',
    hint: 'A sell order is priced below an open buy order — buy the cheap sell, sell to the buy order.',
  },
  'cheap-sell': {
    text: 'sell too low',
    cls: 'flag info',
    hint: 'Sell order far below the global average price — possible mispost.',
  },
  'rich-buy': {
    text: 'buy too high',
    cls: 'flag warn',
    hint: 'Buy order far above the global average price — possible mispost; sell into it.',
  },
};

export default function MistakeFinder() {
  const hubs = useHubs();
  const settings = useApp((s) => s.settings);
  const ignoredTypeIds = useApp((s) => s.ignoredTypeIds);
  const toggleIgnore = useApp((s) => s.toggleIgnore);
  const [detailTypeId, setDetailTypeId] = useState<number | null>(null);

  const active = useActiveChar();
  const ships = active?.ships ?? null;
  const characterId = active?.characterId ?? null;
  const biggestShip = ships && ships.length > 0 ? ships[0].cargo : 440000;

  const [hubId, setHubId] = useState('jita');
  const [maxM3, setMaxM3] = useState<number | null>(null); // null = biggest ship
  const [rows, setRows] = useState<MistakeRow[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);

  const hub = hubs.find((h) => h.id === hubId) ?? hubs[0];
  const effectiveMaxM3 = maxM3 ?? biggestShip;

  const visible = (rows ?? []).filter((r) => !ignoredTypeIds.includes(r.typeId));
  const { sorted, clickHeader, indicator } = useSort<MistakeRow, MistakeCol>(visible, {
    name: (r) => r.name,
    kind: (r) => r.kind,
    price: (r) => r.price,
    ref: (r) => r.refPrice,
    dev: (r) => r.devPct,
    depth: (r) => r.depth,
    flip: (r) => r.estProfit,
  });

  async function scan() {
    if (scanning) return;
    setScanning(true);
    setError(null);
    try {
      const ignored = new Set(ignoredTypeIds);
      const result = await findMistakes({
        hub,
        typeIds: allTypes().map((t) => t.id).filter((t) => !ignored.has(t)),
        maxItemM3: effectiveMaxM3,
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

  return (
    <div className="panel">
      <h2>
        Mistake finder
        <span className="sub">
          mispriced orders: sells under open buys, and orders way off the global average —
          crossed books are verified against the live order book (min-quantity conditions and
          order ranges respected, your tax applied) before being shown
        </span>
      </h2>
      <div className="finder-form">
        <label>
          <span>Hub</span>
          <select value={hub.id} onChange={(e) => setHubId(e.target.value)}>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>{h.name}</option>
            ))}
          </select>
        </label>
        <label title={`Ignore items too big to haul. Defaults to your biggest ship's cargo (${int(biggestShip)} m³) — a packaged capital ship you can't move isn't an actionable mistake.`}>
          <span>Max item m³</span>
          <input type="number" min={1} value={effectiveMaxM3}
            onChange={(e) => {
              const n = Number(e.target.value);
              setMaxM3(Number.isFinite(n) && n > 0 ? n : null);
            }} />
        </label>
        <button className="btn primary scan-btn" onClick={scan} disabled={scanning}>
          {scanning ? 'Scanning…' : 'Scan'}
        </button>
        {progress && <span className="progress-text">{progress}</span>}
      </div>
      {error && <div className="form-error">Scan failed: {error}</div>}

      {rows !== null &&
        (visible.length === 0 ? (
          <div className="empty">No obviously mispriced orders at {hub.name} right now.</div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => clickHeader('name')}>Item{indicator('name')}</th>
                <th className="sortable" onClick={() => clickHeader('kind')}><Tip tip="What kind of mistake: 'crossed book' = a sell listed below an open buy (instant flip). 'sell too low' / 'buy too high' = an order far off the item's global average price.">What</Tip>{indicator('kind')}</th>
                <th className="sortable" onClick={() => clickHeader('price')}><Tip tip="The suspicious order's price per unit.">Price</Tip>{indicator('price')}</th>
                <th className="sortable" onClick={() => clickHeader('ref')}><Tip tip="What the price is being judged against — the opposing order (crossed) or EVE's global average price.">Reference</Tip>{indicator('ref')}</th>
                <th className="sortable" onClick={() => clickHeader('dev')}><Tip tip="How far the price deviates from the reference. -60% on a sell means someone is selling 60% under the norm.">Off by</Tip>{indicator('dev')}</th>
                <th className="sortable" onClick={() => clickHeader('depth')}><Tip tip="How much depth there is: units for crossed books, order count otherwise.">Depth</Tip>{indicator('depth')}</th>
                <th className="sortable" onClick={() => clickHeader('flip')}><Tip tip="For crossed books: ISK from buying the cheap sell and immediately selling to the high buy, after tax, over the overlapping depth.">Est. flip profit</Tip>{indicator('flip')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const k = KIND_LABEL[r.kind];
                return (
                  <tr key={`${r.typeId}-${r.kind}`}>
                    <td className="hub-name">{r.name}</td>
                    <td style={{ textAlign: 'left' }}>
                      <span className={k.cls} title={k.hint}>{k.text}</span>
                    </td>
                    <td>{isk(r.price)}</td>
                    <td className="dim">{isk(r.refPrice)}</td>
                    <td className={r.devPct < 0 ? 'neg' : 'pos'}>
                      {(r.devPct > 0 ? '+' : '') + pct(r.devPct)}
                    </td>
                    <td className="dim">
                      {r.kind === 'crossed' ? `${int(r.depth)} u` : `${int(r.depth)} orders`}
                      {r.minVolume > 1 && (
                        <span className="flag warn" style={{ marginLeft: 6 }}
                          title={`A buy order used here requires selling at least ${int(r.minVolume)} units in one transaction — you must buy enough cheap units first`}>
                          min {int(r.minVolume)}
                        </span>
                      )}
                    </td>
                    <td className={r.estProfit !== null && r.estProfit > 0 ? 'pos' : 'dim'}>
                      {r.estProfit !== null ? iskShort(r.estProfit) : '—'}
                    </td>
                    <td className="row-actions">
                      <button
                        className="btn mini"
                        title="Item details in a popup — your scan stays right here"
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
                        className="btn mini"
                        title="Ignore this item — hidden from trade searches and auto hauls until you remove it in Settings"
                        onClick={() => toggleIgnore(r.typeId)}
                      >
                        🚫
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ))}
      {detailTypeId !== null && (
        <ItemDetailModal typeId={detailTypeId} onClose={() => setDetailTypeId(null)} />
      )}
    </div>
  );
}
