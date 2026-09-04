import { useEffect, useState } from 'react';
import { useApp, useHubs } from '../lib/store';
import { useActiveChar, useAuth } from '../lib/auth';
import { scanArea, multibuyChunks, type AreaResult } from '../lib/areaScan';
import {
  getCurrentShip,
  getLocation,
  openMarketWindowEverywhere,
  setWaypoint,
  structureName,
} from '../lib/esiChar';
import { useMyMarket } from '../lib/myMarket';
import { computeShipCargo } from '../lib/cargo';
import { getType } from '../lib/typedb';
import { findSystem, getSystem, suggestSystems } from '../lib/mapdata';
import MiniHistory from './MiniHistory';
import { useSort } from '../lib/useSort';
import { isk, iskShort, int, m3 } from '../lib/format';
import Tip from './Tip';
import ItemDetailModal from './ItemDetailModal';
import SellingChip from './SellingChip';
import StockChip from './StockChip';
import HeatChip from './HeatChip';
import type { PlanRow } from '../lib/areaScan';

type PlanCol = 'prio' | 'name' | 'qty' | 'buy' | 'cost' | 'sell' | 'maxsold' | 'dvol' | 'how' | 'heat' | 'profit' | 'm3';

const heatRank = (h: PlanRow['heat']) => (h === null ? -1 : h.level === 'hot' ? 2 : h.level === 'warm' ? 1 : 0);

const secClass = (sec: number) => (sec >= 0.5 ? 'pos' : sec > 0 ? 'sec-low' : 'neg');

export default function AutoHaul() {
  const hubs = useHubs();
  const auto = useApp((s) => s.autoHaul);
  const setAuto = useApp((s) => s.setAutoHaul);
  const settings = useApp((s) => s.settings);
  const active = useActiveChar();
  // budgets draw on the TEAM's shared ISK, not whoever is active
  const teamPool = useAuth((s) => s.characters).reduce((sum, c) => sum + (c.wallet ?? 0), 0);
  const characterId = active?.characterId ?? null;
  const ownedShips = active?.ships ?? null;
  const skills = active?.skills ?? null;

  const ignoredTypeIds = useApp((s) => s.ignoredTypeIds);
  const toggleIgnore = useApp((s) => s.toggleIgnore);

  const [result, setResult] = useState<AreaResult | null>(null);
  const [selected, setSelected] = useState(0);
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const [gameError, setGameError] = useState<string | null>(null);
  const [detailTypeId, setDetailTypeId] = useState<number | null>(null);
  /** lines dropped from THIS plan only (kept everywhere else) — reset on scan */
  const [removedKeys, setRemovedKeys] = useState<Set<string>>(new Set());
  const ensureMyMarket = useMyMarket((s) => s.ensureFresh);
  useEffect(() => {
    void ensureMyMarket();
  }, [ensureMyMarket, characterId]);

  const source = hubs.find((h) => h.id === auto.sourceHubId) ?? hubs[0];
  const suggestions = suggestSystems(auto.centerName, 5);
  const exact =
    suggestions.length > 0 && suggestions[0].name.toLowerCase() === auto.centerName.trim().toLowerCase();

  function num(v: string): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  async function gameAction(fn: () => Promise<void>) {
    setGameError(null);
    try {
      await fn();
    } catch (e) {
      setGameError(
        `In-game action failed — is the EVE client running with this character? (${e instanceof Error ? e.message : e})`,
      );
    }
  }

  async function useMyLocation() {
    setError(null);
    try {
      const loc = await getLocation();
      const sys = getSystem(loc.solar_system_id);
      if (!sys) {
        setError("You're in a wormhole (J-space has no gates) — type the K-space exit system instead.");
        return;
      }
      setAuto({ centerName: sys.name });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function useMyShip() {
    setError(null);
    try {
      const ship = await getCurrentShip();
      const owned = ownedShips?.find((s) => s.itemId === ship.ship_item_id);
      const hull = getType(ship.ship_type_id);
      const cargo = owned?.cargo ?? (hull ? computeShipCargo(hull, skills).general : 0);
      if (cargo > 0) setAuto({ cargoM3: cargo });
      else setError(`Couldn't determine cargo for ${hull?.name ?? 'current ship'}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function scan() {
    if (scanning) return;
    setScanning(true);
    setError(null);
    setCopied(null);
    try {
      const r = await scanArea({
        source,
        centerName: auto.centerName,
        maxJumps: auto.maxJumps,
        cargoM3: auto.cargoM3,
        budgetISK: auto.budgetISK,
        sellDays: auto.sellDays,
        optionCount: auto.optionCount,
        includeStructures: auto.includeStructures,
        settings,
        onProgress: setProgress,
      });
      setResult(r);
      setSelected(0);
      setRemovedKeys(new Set());
      // resolve structure names where the character has docking access
      if (characterId && auto.includeStructures) {
        for (const opt of r.options) {
          if (!opt.stationName.startsWith('Player structure')) continue;
          const name = await structureName(opt.locationId).catch(() => null);
          if (name) {
            setResult((prev) =>
              prev
                ? {
                    ...prev,
                    options: prev.options.map((o) =>
                      o.locationId === opt.locationId ? { ...o, stationName: name } : o,
                    ),
                  }
                : prev,
            );
          }
        }
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setScanning(false);
      setProgress('');
    }
  }

  const option = result?.options[selected] ?? null;
  const optionRegionId = option ? findSystem(option.systemName)?.regionId : undefined;
  // ignore-list and per-plan removals apply immediately — and to the multibuy
  const planRows = (option?.plan ?? [])
    .map((r, i) => ({ ...r, prio: i + 1 }))
    .filter(
      (r) => !ignoredTypeIds.includes(r.typeId) && !removedKeys.has(`${r.typeId}-${r.mode}`),
    );
  const edited = {
    cost: planRows.reduce((s, r) => s + r.cost, 0),
    profit: planRows.reduce((s, r) => s + r.profit, 0),
    m3: planRows.reduce((s, r) => s + r.m3, 0),
  };
  const { sorted: sortedPlan, clickHeader, indicator } = useSort<PlanRow & { prio: number }, PlanCol>(
    planRows,
    {
      prio: (r) => r.prio,
      name: (r) => r.name,
      qty: (r) => r.qty,
      buy: (r) => r.buyPrice,
      cost: (r) => r.cost,
      sell: (r) => r.sellPrice,
      maxsold: (r) => (r.maxSold ? r.maxSold[1] : null),
      dvol: (r) => r.dailyVol,
      how: (r) => r.mode,
      heat: (r) => heatRank(r.heat),
      profit: (r) => r.profit,
      m3: (r) => r.m3,
    },
    { key: 'prio', dir: 'asc' },
  );

  // EVE's multibuy window takes at most 100 lines — one copy button per chunk
  const chunks = multibuyChunks(planRows); // removed & ignored lines excluded

  async function copyMultibuy(index: number) {
    const text = chunks[index] ?? '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
    }
    setCopied(index);
    setTimeout(() => setCopied(null), 2500);
  }

  return (
    <>
      <div className="panel">
        <h2>
          Auto Haul
          <span className="sub">
            one pickup, one drop-off: buy everything at {source.name}, sell it all at a single
            station — pick the haul that fits your route
          </span>
        </h2>
        <div className="finder-form">
          <label style={{ position: 'relative' }}>
            <span>
              Sell around (system)
              {characterId && (
                <button className="inline-link" title="Use my character's current system"
                  onClick={useMyLocation}>
                  📍 my location
                </button>
              )}
            </span>
            <input
              type="text"
              value={auto.centerName}
              placeholder="e.g. Tama"
              spellCheck={false}
              onChange={(e) => setAuto({ centerName: e.target.value })}
            />
            {!exact && suggestions.length > 0 && (
              <div className="sys-suggest">
                {suggestions.map((s) => (
                  <button key={s.id} onClick={() => setAuto({ centerName: s.name })}>
                    {s.name} <span className={secClass(s.sec)}>{s.sec.toFixed(1)}</span>
                  </button>
                ))}
              </div>
            )}
          </label>
          <label>
            <span>Within jumps</span>
            <input type="number" min={0} max={10} value={auto.maxJumps}
              onChange={(e) => setAuto({ maxJumps: Math.min(10, Math.max(0, num(e.target.value))) })} />
          </label>
          <label>
            <span>Buy at</span>
            <select value={source.id} onChange={(e) => setAuto({ sourceHubId: e.target.value })}>
              {hubs.filter((h) => h.kind === 'station').map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span>
              Cargo m³
              {characterId && (
                <button className="inline-link" title="Use my current ship's effective cargo (skills + fit)"
                  onClick={useMyShip}>
                  🚢 my ship
                </button>
              )}
            </span>
            <input type="number" min={1} step={100} value={auto.cargoM3}
              onChange={(e) => setAuto({ cargoM3: Math.max(1, num(e.target.value)) })} />
          </label>
          <label>
            <span>Budget (ISK)</span>
            <input type="number" min={0} placeholder="no limit" value={auto.budgetISK ?? ''}
              onChange={(e) => setAuto({ budgetISK: e.target.value === '' ? null : num(e.target.value) })} />
          </label>
          <label title={teamPool <= 0 ? 'Log in and sync to link your wallets' : `TEAM wallet (all characters combined): ${isk(teamPool)} ISK`}>
            <span>% of team wallet</span>
            <input type="number" min={0} max={100} step={5} disabled={teamPool <= 0}
              placeholder={teamPool <= 0 ? '—' : '%'}
              value={teamPool > 0 && auto.budgetISK !== null
                ? Math.round((auto.budgetISK / teamPool) * 1000) / 10 : ''}
              onChange={(e) => {
                if (teamPool <= 0) return;
                const pct = num(e.target.value);
                setAuto({ budgetISK: pct > 0 ? Math.floor((teamPool * pct) / 100) : null });
              }} />
          </label>
          <label title="Sell-order positions are sized to this many days of the area's daily volume. Instant sells (into standing buy orders) aren't time-limited.">
            <span>Sold within (days)</span>
            <input type="number" min={0.5} step={0.5} value={auto.sellDays}
              onChange={(e) => setAuto({ sellDays: Math.max(0.5, num(e.target.value)) })} />
          </label>
          <label title="How many single-station haul options to rank and show.">
            <span>Options</span>
            <select value={auto.optionCount}
              onChange={(e) => setAuto({ optionCount: Number(e.target.value) })}>
              {[3, 4, 6, 8].map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <button className="btn primary scan-btn" onClick={scan} disabled={scanning || !exact}>
            {scanning ? 'Scanning…' : 'Find hauls'}
          </button>
        </div>
        <div className="finder-options">
          <label className="checkline" style={{ margin: 0 }}
            title="Player-built stations can be invisible or closed to you — only include them if you know you can dock.">
            <input type="checkbox" checked={auto.includeStructures}
              onChange={(e) => setAuto({ includeStructures: e.target.checked })} />
            <span>include player structures (risky — must have docking access)</span>
          </label>
          {progress && <span className="progress-text">{progress}</span>}
          {!exact && auto.centerName.trim().length > 1 && suggestions.length === 0 && (
            <span className="hint" style={{ margin: 0 }}>No K-space system matches that name.</span>
          )}
        </div>
        {error && <div className="form-error">{error}</div>}
        {gameError && <div className="form-error">{gameError}</div>}
      </div>

      {result && (
        <div className="panel">
          <h2>
            Haul options
            <span className="sub">
              {result.systemsScanned} systems within {auto.maxJumps} jumps of {result.center.name} ·
              {' '}{result.stationsConsidered} stations had sellable deals · pick the drop-off that fits your route
            </span>
          </h2>
          {result.options.length === 0 ? (
            <div className="empty">
              No station in this area has enough profitable demand right now. Try more jumps, a
              longer sell window, or a different area.
            </div>
          ) : (
            <div className="haul-options">
              {result.options.map((o, i) => (
                <button key={o.locationId}
                  className={`haul-card ${i === selected ? 'on' : ''}`}
                  onClick={() => { setSelected(i); setCopied(null); }}>
                  <span className="hc-station" title={o.stationName}>
                    {o.systemName} <span className={secClass(o.sec)}>{o.sec.toFixed(1)}</span>
                    <span className="hc-jumps"> · {o.jumps}j</span>
                  </span>
                  <span className="hc-name">{o.stationName.length > 44 ? o.stationName.slice(0, 44) + '…' : o.stationName}</span>
                  <span className="hc-profit pos">{iskShort(o.totals.profit)} ISK</span>
                  <span className="hc-meta">
                    {iskShort(o.totals.cost)} cost · {m3(o.totals.m3Used)} · {o.plan.length} items
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {option && (
        <div className="panel">
          <h2>
            Load for {option.systemName} — {option.stationName.length > 50 ? option.stationName.slice(0, 50) + '…' : option.stationName}
            <span className="panel-filter" style={{ display: 'inline-flex', gap: 8 }}>
              {characterId && (
                <button className="btn" onClick={() => gameAction(() => setWaypoint(option.locationId))}
                  title="Add this station to my autopilot route in the EVE client">
                  Set waypoint
                </button>
              )}
              {chunks.map((_, i) => (
                <button key={i} className="btn primary" onClick={() => copyMultibuy(i)}
                  title="EVE's multibuy window accepts at most 100 lines — paste each chunk separately">
                  {copied === i
                    ? '✓ copied'
                    : chunks.length === 1
                      ? 'Copy multibuy'
                      : `Copy ${i * 100 + 1}–${Math.min((i + 1) * 100, i * 100 + chunks[i].split('\n').length)}`}
                </button>
              ))}
            </span>
          </h2>
          <div className="load-totals">
            <div><span className="lbl"><Tip tip="Total ISK to buy everything currently on this list (removed/ignored lines excluded).">Cost</Tip></span><span className="val">{iskShort(edited.cost)} ISK</span></div>
            <div><span className="lbl"><Tip tip="Expected profit after taxes and fees once everything sells (removed/ignored lines excluded).">Est. profit</Tip></span><span className="val pos">{iskShort(edited.profit)} ISK</span></div>
            <div><span className="lbl"><Tip tip="Cargo used by this load out of your ship's capacity.">Cargo</Tip></span><span className="val">{m3(edited.m3)} / {m3(option.totals.cargoM3)}</span></div>
            <div><span className="lbl"><Tip tip="What stopped the load from being bigger: your cargo space, your budget, or simply running out of profitable deals at this station.">Limited by</Tip></span><span className="val">{option.totals.boundBy}</span></div>
            {planRows.length < (option.plan.length) && (
              <div><span className="lbl">Edited</span><span className="val dim" style={{ fontSize: 13 }}>{option.plan.length - planRows.length} line(s) removed</span></div>
            )}
          </div>
          <table className="data">
            <thead>
              <tr>
                <th className="sortable" onClick={() => clickHeader('prio')}><Tip tip="Buy priority — the optimizer's pick order, best deals first.">#</Tip>{indicator('prio')}</th>
                <th className="sortable" onClick={() => clickHeader('name')}>Item{indicator('name')}</th>
                <th className="sortable" onClick={() => clickHeader('qty')}><Tip tip="How many to buy — sized to your cargo, budget, and what this station's market actually absorbs.">Qty</Tip>{indicator('qty')}</th>
                <th className="sortable" onClick={() => clickHeader('buy')}><Tip tip="Price per unit at the source hub (cheapest 5% of listings, bait-resistant).">Buy @ {source.name}</Tip>{indicator('buy')}</th>
                <th className="sortable" onClick={() => clickHeader('cost')}><Tip tip="Total ISK for this line.">Cost</Tip>{indicator('cost')}</th>
                <th className="sortable" onClick={() => clickHeader('sell')}><Tip tip="Expected sale price per unit at this station.">Sell @</Tip>{indicator('sell')}</th>
                <th className="sortable" onClick={() => clickHeader('maxsold')}><Tip tip="The highest price anything ACTUALLY SOLD for in this region in the last 7 days — real completed trades. Hover a value for the day/week/month breakdown.">Max sold (7d)</Tip>{indicator('maxsold')}</th>
                <th className="sortable" onClick={() => clickHeader('dvol')}><Tip tip="Units traded per calendar day in this region (conservative: the lower of the 30d and 90d rates).">Day vol</Tip>{indicator('dvol')}</th>
                <th><Tip tip="The last 2 weeks of daily trading in the target region — bar height is units sold that day. Hover a bar for that day's units sold and the min / average / max prices actually paid.">2w history</Tip></th>
                <th className="sortable" onClick={() => clickHeader('how')}><Tip tip="'instant' = standing buy orders pay you on arrival. 'order' = you list a sell order and wait (better price, takes time).">How</Tip>{indicator('how')}</th>
                <th className="sortable" onClick={() => clickHeader('heat')}><Tip tip="Undercut heat at the destination, read from the order book's own reprice timestamps: 🔥 = active reprice war on the sell front line, ~ = occasional undercuts, quiet = the best ask hasn't moved in over a day. '—' on instant lines (you fill buy orders — no war to fight).">Heat</Tip>{indicator('heat')}</th>
                <th className="sortable" onClick={() => clickHeader('profit')}><Tip tip="Expected profit for this line after taxes and fees.">Profit</Tip>{indicator('profit')}</th>
                <th className="sortable" onClick={() => clickHeader('m3')}><Tip tip="Cargo space this line uses.">m³</Tip>{indicator('m3')}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {sortedPlan.map((r) => (
                <tr key={`${r.typeId}-${r.mode}`}>
                  <td className="dim">{r.prio}</td>
                  <td className="hub-name">{r.name}<SellingChip typeId={r.typeId} /><StockChip typeId={r.typeId} refPrice={r.mode === 'order' ? r.sellPrice : null} /></td>
                  <td>{int(r.qty)}{r.minVolume > 1 && (
                    <span className="flag warn" title={`A buy order used here requires selling at least ${int(r.minVolume)} units per transaction`}> min {int(r.minVolume)}</span>
                  )}</td>
                  <td>{isk(r.buyPrice)}</td>
                  <td className="dim">{iskShort(r.cost)}</td>
                  <td>{isk(r.sellPrice)}</td>
                  <td className="dim"
                    title={r.maxSold
                      ? `Highest actual sale in this region: last day ${r.maxSold[0] > 0 ? isk(r.maxSold[0]) : 'no trades'} · 7d ${r.maxSold[1] > 0 ? isk(r.maxSold[1]) : 'no trades'} · 30d ${r.maxSold[2] > 0 ? isk(r.maxSold[2]) : 'no trades'}`
                      : undefined}>
                    {r.maxSold && r.maxSold[1] > 0 ? iskShort(r.maxSold[1]) : '—'}
                  </td>
                  <td className="dim">
                    {r.dailyVol !== null ? (r.dailyVol < 10 ? r.dailyVol.toFixed(1) : int(r.dailyVol)) : '—'}
                  </td>
                  <td>
                    {optionRegionId !== undefined
                      ? <MiniHistory regionId={optionRegionId} typeId={r.typeId} />
                      : <span className="dim">—</span>}
                  </td>
                  <td>
                    {r.mode === 'instant'
                      ? <span className="flag good" title="Sells immediately into standing buy orders (verified against the live order book)">instant</span>
                      : <span className="flag info" title={`Place a sell order — sized to sell within ~${auto.sellDays} day(s) of region volume`}>order</span>}
                  </td>
                  <td>{r.mode === 'order' ? <HeatChip heat={r.heat} /> : <span className="dim">—</span>}</td>
                  <td className="pos">{iskShort(r.profit)}</td>
                  <td className="dim">{m3(r.m3)}</td>
                  <td className="row-actions">
                    <button className="btn mini" title="Item details in a popup — your haul options stay right here"
                      onClick={() => setDetailTypeId(r.typeId)}>
                      details
                    </button>
                    {characterId && (
                      <button className="btn mini" title="Open this item's market window in the EVE client"
                        onClick={() => gameAction(() => openMarketWindowEverywhere(r.typeId))}>
                        game
                      </button>
                    )}
                    <button className="btn mini" title="Ignore this item everywhere — hidden from trade searches and auto hauls until you remove it in Settings"
                      onClick={() => toggleIgnore(r.typeId)}>
                      🚫
                    </button>
                    <button className="btn mini" title="Remove this line from THIS plan only (also removed from the multibuy export) — rescan to bring it back"
                      onClick={() => setRemovedKeys((prev) => new Set(prev).add(`${r.typeId}-${r.mode}`))}>
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="hint">
            Instant rows fill standing buy orders (real order-book depth). Order rows undercut the
            station's lowest sell and are sized to the region's daily volume (conservative
            calendar-day rate). Verify big positions in game — books move.
          </div>
        </div>
      )}
      {detailTypeId !== null && (
        <ItemDetailModal typeId={detailTypeId} onClose={() => setDetailTypeId(null)} />
      )}
    </>
  );
}
