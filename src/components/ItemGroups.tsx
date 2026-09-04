// GROUPS: a side-by-side comparer for families of items (abyssal filaments,
// mutaplasmids, officer modules, …) across TWO hubs at once. Each item gets
// one sub-row per hub; the three spread columns answer the three ways to
// work an item — flip it at one hub, haul it bought-instantly, or haul it
// bought-with-a-bid — each with its fee-adjusted return in parentheses.
import { useEffect, useMemo, useState } from 'react';
import { useApp, useHubs } from '../lib/store';
import { searchTypes, getType } from '../lib/typedb';
import { fetchAggregates, fetchMarketPrices } from '../lib/market';
import { itemTradeFlows } from '../lib/radar';
import { brokerRateForHub, salesTaxForHub } from '../lib/broker';
import { unsoldCosts } from '../lib/stock';
import { openMarketWindowEverywhere } from '../lib/esiChar';
import { useSort } from '../lib/useSort';
import { isk, iskShort, int, pct } from '../lib/format';
import Tip from './Tip';
import SellingChip from './SellingChip';
import StockChip from './StockChip';
import ItemDetailModal from './ItemDetailModal';
import type { Hub, TypeAggregate } from '../lib/types';

type Flow = { askUnits: number; bidUnits: number; days: number } | null;
/** unreal = the two legs are >50× apart (penny bid vs aspirational ask) —
 * that's not a market, it's two people not talking; no radar needed to see
 * it, and a real opportunity would show radar fills anyway */
type Spread = { raw: number; pct: number; unreal?: boolean } | null;

const UNREAL_RATIO = 50;
/** an ask above 5× CCP's GLOBAL average price is aspiration, not a market —
 * two matching fantasy asks at both hubs would otherwise pass the ratio
 * check and fake a haul spread (RULES #10: cap fantasies with the ref) */
const FANTASY_ASK_RATIO = 5;

interface HubSide {
  hub: Hub;
  /** scam-resistant ask (avg of cheapest 5% of sell volume) */
  sell5: number | null;
  /** top bid */
  buy: number | null;
  flow: Flow | undefined;
  /** flip AT this hub: own buy order → own sell order */
  hubSpread: Spread;
  /** buy INSTANTLY here, own sell order at the other hub */
  quick: Spread;
  /** own buy order here, own sell order at the other hub */
  slow: Spread;
}

interface ItemRow {
  typeId: number;
  name: string;
  a: HubSide;
  b: HubSide;
  /** the radar watched BOTH hubs ≥2 days and saw ZERO trades either side —
   * the listings are aspirational (a lone 30b ask, penny bids) and spread
   * math on them is fiction. Dead rows sink in sorts and hide by default. */
  dead: boolean;
}

const MIN_DEAD_DAYS = 2;
const ripeZero = (f: Flow | undefined) =>
  f != null && f.days >= MIN_DEAD_DAYS && f.askUnits === 0 && f.bidUnits === 0;

type Col = 'name' | 'sell5' | 'buy' | 'hspread' | 'quick' | 'slow' | 'fask' | 'fbid';

const flowNum = (v: number) => (v >= 10 ? int(v) : v.toFixed(1));
const NEW_GROUP = '__new__';

/** raw spread + fee-adjusted return for one direction (this hub → other) */
function sides(
  hub: Hub,
  other: Hub,
  sell5: number | null,
  buy: number | null,
  oSell5: number | null,
  settings: Parameters<typeof salesTaxForHub>[1],
  sameHub: boolean,
  ccpAvg: number | undefined,
): Pick<HubSide, 'hubSpread' | 'quick' | 'slow'> {
  const fantasyAsk = (p: number) => ccpAvg !== undefined && p > ccpAvg * FANTASY_ASK_RATIO;
  const broker = brokerRateForHub(hub, settings);
  const tax = salesTaxForHub(hub, settings);
  const oBroker = brokerRateForHub(other, settings);
  const oTax = salesTaxForHub(other, settings);
  const unreal = (low: number, high: number) => high > low * UNREAL_RATIO;
  const hubSpread: Spread =
    sell5 !== null && buy !== null && buy > 0
      ? (() => {
          if (unreal(buy, sell5) || fantasyAsk(sell5)) return { raw: sell5 - buy, pct: 0, unreal: true };
          const cost = buy * (1 + broker);
          const rev = sell5 * (1 - broker - tax);
          return { raw: sell5 - buy, pct: (rev - cost) / cost };
        })()
      : null;
  const quick: Spread =
    !sameHub && sell5 !== null && oSell5 !== null && sell5 > 0
      ? (() => {
          if (unreal(sell5, oSell5) || fantasyAsk(sell5) || fantasyAsk(oSell5)) return { raw: oSell5 - sell5, pct: 0, unreal: true };
          const cost = sell5; // instant buy from the ask — no order fees
          const rev = oSell5 * (1 - oBroker - oTax);
          return { raw: oSell5 - sell5, pct: (rev - cost) / cost };
        })()
      : null;
  const slow: Spread =
    !sameHub && buy !== null && oSell5 !== null && buy > 0
      ? (() => {
          if (unreal(buy, oSell5) || fantasyAsk(oSell5)) return { raw: oSell5 - buy, pct: 0, unreal: true };
          const cost = buy * (1 + broker);
          const rev = oSell5 * (1 - oBroker - oTax);
          return { raw: oSell5 - buy, pct: (rev - cost) / cost };
        })()
      : null;
  return { hubSpread, quick, slow };
}

function SpreadCell({ s }: { s: Spread }) {
  if (s === null) return <td className="dim">—</td>;
  if (s.unreal)
    return (
      <td className="dim"
        title={`Not a real market: either the two prices are more than ${UNREAL_RATIO}× apart (a penny bid against an aspirational ask), or a listing sits more than ${FANTASY_ASK_RATIO}× above CCP's global average price for the item. This "spread" (${iskShort(s.raw)}) is not achievable. If real trades ever happen here, the radar's fill data will say so.`}>
        —
      </td>
    );
  return (
    <td className={s.pct > 0 ? 'pos' : 'neg'}>
      {iskShort(s.raw)} <span className="dim">({pct(s.pct)})</span>
    </td>
  );
}

export default function ItemGroups() {
  const hubs = useHubs().filter((h) => h.kind === 'station');
  const groups = useApp((s) => s.itemGroups);
  const addToGroup = useApp((s) => s.addToGroup);
  const removeFromGroup = useApp((s) => s.removeFromGroup);
  const deleteGroup = useApp((s) => s.deleteGroup);
  const settings = useApp((s) => s.settings);

  const [query, setQuery] = useState('');
  const [openGroupId, setOpenGroupId] = useState('');
  const [hub1Id, setHub1Id] = useState('jita');
  const [hub2Id, setHub2Id] = useState('amarr');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [targetGroup, setTargetGroup] = useState(NEW_GROUP);
  const [newName, setNewName] = useState('');
  const [aggs1, setAggs1] = useState<Map<number, TypeAggregate>>(new Map());
  const [aggs2, setAggs2] = useState<Map<number, TypeAggregate>>(new Map());
  const [flows1, setFlows1] = useState<Map<number, Flow>>(new Map());
  const [flows2, setFlows2] = useState<Map<number, Flow>>(new Map());
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [hideDead, setHideDead] = useState(true);
  const [ccp, setCcp] = useState<Map<number, number>>(new Map());
  const [detailTypeId, setDetailTypeId] = useState<number | null>(null);

  const hub1 = hubs.find((h) => h.id === hub1Id) ?? hubs[0];
  const hub2 = hubs.find((h) => h.id === hub2Id) ?? hubs[1] ?? hubs[0];
  const sameHub = hub1?.id === hub2?.id;
  const openGroup = groups.find((g) => g.id === openGroupId) ?? null;

  // what's on screen: an open group wins; otherwise the live search results
  // (no cap — a family like mutaplasmids alone runs past 200 items)
  const typeIds = useMemo(
    () => (openGroup ? openGroup.typeIds : searchTypes(query, Infinity).map((t) => t.id)),
    [openGroup, query],
  );
  const idsKey = typeIds.join(',');

  // CCP global averages: one cached call, the fantasy-ask reference
  useEffect(() => {
    let alive = true;
    void fetchMarketPrices()
      .then((m) => alive && setCcp(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    if (typeIds.length === 0 || !hub1 || !hub2) {
      setAggs1(new Map());
      setAggs2(new Map());
      setFlows1(new Map());
      setFlows2(new Map());
      return;
    }
    setLoading(true);
    void Promise.all([fetchAggregates(hub1, typeIds), sameHub ? null : fetchAggregates(hub2, typeIds)])
      .then(async ([m1, m2]) => {
        if (!alive) return;
        setAggs1(m1);
        setAggs2(sameHub ? m1 : m2!);
        const [f1, f2] = await Promise.all([
          itemTradeFlows(hub1.regionId, typeIds),
          hub2.regionId === hub1.regionId ? null : itemTradeFlows(hub2.regionId, typeIds),
        ]);
        if (alive) {
          setFlows1(f1);
          setFlows2(f2 ?? f1);
        }
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, hub1?.id, hub2?.id]);

  const rows: ItemRow[] = useMemo(() => {
    const side = (
      hub: Hub,
      other: Hub,
      agg: TypeAggregate | undefined,
      oAgg: TypeAggregate | undefined,
      flow: Flow | undefined,
      ccpAvg: number | undefined,
    ): HubSide => {
      const sell5 = agg && agg.sell.orderCount > 0 ? agg.sell.percentile : null;
      const buy = agg && agg.buy.orderCount > 0 ? agg.buy.max : null;
      const oSell5 = oAgg && oAgg.sell.orderCount > 0 ? oAgg.sell.percentile : null;
      return { hub, sell5, buy, flow, ...sides(hub, other, sell5, buy, oSell5, settings, sameHub, ccpAvg) };
    };
    return typeIds.map((typeId) => {
      const ccpAvg = ccp.get(typeId);
      const a = side(hub1, hub2, aggs1.get(typeId), aggs2.get(typeId), flows1.get(typeId), ccpAvg);
      const b = side(hub2, hub1, aggs2.get(typeId), aggs1.get(typeId), flows2.get(typeId), ccpAvg);
      return {
        typeId,
        name: getType(typeId)?.name ?? `#${typeId}`,
        a,
        b,
        dead: ripeZero(a.flow) && ripeZero(b.flow),
      };
    });
  }, [idsKey, aggs1, aggs2, flows1, flows2, settings, hub1, hub2, sameHub, ccp]); // eslint-disable-line react-hooks/exhaustive-deps

  // sorting works on ITEMS (the hub pair stays together) — metric columns
  // sort by the better of the two hub rows
  const best = (r: ItemRow, f: (s: HubSide) => number | null): number | null => {
    const va = f(r.a);
    const vb = f(r.b);
    if (va === null) return vb;
    if (vb === null) return va;
    return Math.max(va, vb);
  };
  const deadCount = rows.filter((r) => r.dead).length;
  const visibleRows = hideDead ? rows.filter((r) => !r.dead) : rows;
  const { sorted, clickHeader, indicator } = useSort<ItemRow, Col>(
    visibleRows,
    {
      name: (r) => r.name,
      sell5: (r) => (r.dead ? null : r.a.sell5),
      buy: (r) => (r.dead ? null : r.a.buy),
      hspread: (r) => (r.dead ? null : best(r, (s) => (s.hubSpread && !s.hubSpread.unreal ? s.hubSpread.pct : null))),
      quick: (r) => (r.dead ? null : best(r, (s) => (s.quick && !s.quick.unreal ? s.quick.pct : null))),
      slow: (r) => (r.dead ? null : best(r, (s) => (s.slow && !s.slow.unreal ? s.slow.pct : null))),
      fask: (r) => (r.dead ? null : best(r, (s) => s.flow?.askUnits ?? null)),
      fbid: (r) => (r.dead ? null : best(r, (s) => s.flow?.bidUnits ?? null)),
    },
    { key: 'hspread', dir: 'desc' },
  );

  const toggleCheck = (id: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allChecked = visibleRows.length > 0 && visibleRows.every((r) => checked.has(r.typeId));

  function addSelected() {
    const ids = [...checked];
    if (ids.length === 0) return;
    const name =
      targetGroup === NEW_GROUP ? newName.trim() : groups.find((g) => g.id === targetGroup)?.name ?? '';
    if (!name) {
      setNotice('Give the new group a name first.');
      return;
    }
    const gid = addToGroup(name, ids);
    setChecked(new Set());
    setNewName('');
    setTargetGroup(gid);
    setNotice(`Added ${ids.length} item(s) to “${name}”.`);
  }

  // referenced so the paid tooltip stays cheap to derive later if wanted
  void unsoldCosts;

  return (
    <div className="panel">
      <h2>
        <Tip tip="Compare a whole family of items across TWO hubs at once — search a word (e.g. 'filament', 'mutaplasmid'), tick the ones you care about, save them as a named group, and reopen the group any time. Each item shows one row per hub; the three spreads are the three ways to work it, each with its fee-adjusted return in parentheses.">Item groups</Tip>
        <span className="sub">search → tick → save as a group · two rows per item, one per hub</span>
      </h2>
      <div className="finder-form">
        <label>
          <span>Search items</span>
          <input
            type="text"
            value={query}
            placeholder="e.g. filament, mutaplasmid…"
            style={{ width: 220 }}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpenGroupId('');
            }}
          />
        </label>
        <label title="Open one of your saved groups — its items replace the search results below.">
          <span>My groups</span>
          <select
            value={openGroupId}
            onChange={(e) => {
              setOpenGroupId(e.target.value);
              setChecked(new Set());
            }}
          >
            <option value="">— search results —</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name} ({g.typeIds.length})
              </option>
            ))}
          </select>
        </label>
        <label title="The first hub — each item's first sub-row.">
          <span>Hub 1</span>
          <select value={hub1Id} onChange={(e) => setHub1Id(e.target.value)}>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label title="The second hub — each item's second sub-row. Haul spreads read 'this row's hub → the other hub'.">
          <span>Hub 2</span>
          <select value={hub2Id} onChange={(e) => setHub2Id(e.target.value)}>
            {hubs.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        {openGroup && (
          <button
            className="btn"
            title="Delete this group (the items themselves are untouched)."
            onClick={() => {
              if (confirm(`Delete the group “${openGroup.name}”?`)) {
                deleteGroup(openGroup.id);
                setOpenGroupId('');
              }
            }}
          >
            🗑 delete group
          </button>
        )}
      </div>
      <div className="finder-form" style={{ alignItems: 'center' }}>
        <span className="dim" style={{ fontSize: 12 }}>
          {visibleRows.length} item(s) · {checked.size} selected
        </span>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
          title="An item is a DEAD MARKET when the radar has watched both hubs for 2+ days and seen ZERO trades on either side — its listings are aspirational (a lone 30b ask, penny bids) and spread math on them is fiction. Hidden by default; they always sort last. If the radar hasn't watched long enough yet, items stay visible.">
          <input type="checkbox" checked={hideDead} onChange={() => setHideDead(!hideDead)} />
          <span>hide 💤 no-trade items{deadCount > 0 ? ` (${deadCount} hidden)` : ''}</span>
        </label>
        <label>
          <span>Add to</span>
          <select value={targetGroup} onChange={(e) => setTargetGroup(e.target.value)}>
            <option value={NEW_GROUP}>+ new group…</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {targetGroup === NEW_GROUP && (
          <label>
            <span>New group name</span>
            <input
              type="text"
              value={newName}
              placeholder="e.g. Abyssal filaments"
              style={{ width: 180 }}
              onChange={(e) => setNewName(e.target.value)}
            />
          </label>
        )}
        <button className="btn primary" disabled={checked.size === 0} onClick={addSelected}
          title="Add every ticked item to the chosen group (creates the group if it's new).">
          Add {checked.size > 0 ? checked.size : ''} selected
        </button>
        {notice && <span className="dim" style={{ fontSize: 12 }}>{notice}</span>}
        {loading && <span className="progress-text">fetching {hub1?.name}/{hub2?.name} prices…</span>}
      </div>
      {rows.length === 0 ? (
        <div className="empty">
          {openGroup
            ? 'This group is empty — search items and add them.'
            : query.trim().length >= 2
              ? 'No items match that search.'
              : 'Type at least two letters to search the market catalogue, or open one of your groups.'}
        </div>
      ) : (
        <table className="data">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={allChecked}
                  title="Tick / untick everything below"
                  onChange={() =>
                    setChecked(allChecked ? new Set() : new Set(visibleRows.map((r) => r.typeId)))
                  } />
              </th>
              <th className="sortable" onClick={() => clickHeader('name')}>Item{indicator('name')}</th>
              <th><Tip tip="Which hub this sub-row describes.">Hub</Tip></th>
              <th className="sortable" onClick={() => clickHeader('sell5')}><Tip tip="Average price of the cheapest 5% of sell volume at this row's hub — resistant to 1-unit bait listings. (Sorts by Hub 1's row.)">Sell 5%</Tip>{indicator('sell5')}</th>
              <th className="sortable" onClick={() => clickHeader('buy')}><Tip tip="Highest standing buy order at this row's hub. (Sorts by Hub 1's row.)">Buy</Tip>{indicator('buy')}</th>
              <th className="sortable" onClick={() => clickHeader('hspread')}><Tip tip="FLIP AT THIS HUB: place your own buy order (~top bid) and later your own sell order (~Sell 5%), both here. The parenthesis is the return after this hub's broker fees and tax. Sorts items by the better of their two hubs.">Hub spread</Tip>{indicator('hspread')}</th>
              <th className="sortable" onClick={() => clickHeader('quick')}><Tip tip="HAUL, BOUGHT INSTANTLY: buy from sell orders at this row's hub (~Sell 5%, no order fees), haul, sell with your own sell order at the OTHER hub. Return in parenthesis is after the destination's fees. Each row is one direction. Sorts by the better direction.">Haul quick spread</Tip>{indicator('quick')}</th>
              <th className="sortable" onClick={() => clickHeader('slow')}><Tip tip="HAUL, BOUGHT WITH A BID: place your own buy order at this row's hub (~top bid + broker fee), haul, sell with your own sell order at the OTHER hub. Slower to fill, cheaper to buy. Sorts by the better direction.">Haul slow spread</Tip>{indicator('slow')}</th>
              <th className="sortable" onClick={() => clickHeader('fask')}><Tip tip="Units per day actually BOUGHT from sell orders at this row's hub — measured by the radar (7-day, coverage-normalized). '—' = region not radar-watched.">Bought/day</Tip>{indicator('fask')}</th>
              <th className="sortable" onClick={() => clickHeader('fbid')}><Tip tip="Units per day actually SOLD into buy orders at this row's hub — measured the same way.">Sold to bids/day</Tip>{indicator('fbid')}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              [r.a, r.b].map((s, i) => (
                <tr key={`${r.typeId}-${s.hub.id}-${i}`} className={i === 1 ? 'grp-b' : ''}>
                  {i === 0 && (
                    <>
                      <td rowSpan={2}>
                        <input type="checkbox" checked={checked.has(r.typeId)} onChange={() => toggleCheck(r.typeId)} />
                      </td>
                      <td rowSpan={2} className="hub-name">
                        {r.name}
                        {r.dead && (
                          <span className="flag info" style={{ marginLeft: 6 }}
                            title={`The radar watched both hubs for ${Math.min(r.a.flow?.days ?? 0, r.b.flow?.days ?? 0)} day(s) and saw ZERO trades on either side — the listings here are aspirational; the spreads are not real opportunities.`}>
                            💤 no trades
                          </span>
                        )}
                        <SellingChip typeId={r.typeId} />
                        <StockChip typeId={r.typeId} refPrice={r.a.sell5} />
                      </td>
                    </>
                  )}
                  <td className="dim">{s.hub.name}</td>
                  <td>{s.sell5 !== null ? isk(s.sell5) : <span className="dim">—</span>}</td>
                  <td>{s.buy !== null ? isk(s.buy) : <span className="dim">—</span>}</td>
                  <SpreadCell s={s.hubSpread} />
                  <SpreadCell s={s.quick} />
                  <SpreadCell s={s.slow} />
                  <td>{s.flow ? <span title={`Measured over ${s.flow.days} day(s) of radar coverage.`}>{flowNum(s.flow.askUnits)}</span> : <span className="dim">—</span>}</td>
                  <td>{s.flow ? <span title={`Measured over ${s.flow.days} day(s) of radar coverage.`}>{flowNum(s.flow.bidUnits)}</span> : <span className="dim">—</span>}</td>
                  {i === 0 && (
                    <td rowSpan={2} className="row-actions">
                      <button className="btn mini" title="Item details in a popup"
                        onClick={() => setDetailTypeId(r.typeId)}>details</button>
                      <button className="btn mini" title="Open the market window in game on every online character"
                        onClick={() => openMarketWindowEverywhere(r.typeId).catch(() => {})}>game</button>
                      {openGroup && (
                        <button className="btn mini" title={`Remove ${r.name} from “${openGroup.name}”`}
                          onClick={() => removeFromGroup(openGroup.id, r.typeId)}>✕</button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            ))}
          </tbody>
        </table>
      )}
      <div className="hint">
        Two rows per item — one per hub. Hub spread = flip it there (own bid → own ask). Haul
        quick = buy instantly at this row's hub, sell with your own order at the other. Haul slow
        = buy with your own bid here, sell with your own order at the other. Every parenthesis is
        the fee-adjusted return for THAT move; Bought/day · Sold to bids/day are the radar's
        measured trades at that hub. Spreads whose two legs are more than 50× apart (penny bid
        vs aspirational ask) show '—' — that's not a market, and such rows sink in every sort.
        Groups are saved locally (and in backups).
      </div>
      {detailTypeId !== null && <ItemDetailModal typeId={detailTypeId} onClose={() => setDetailTypeId(null)} />}
    </div>
  );
}
