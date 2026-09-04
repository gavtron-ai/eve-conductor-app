import { useApp } from '../lib/store';
import { useStock, unsoldCosts, primaryStockAction, fixItStock } from '../lib/stock';
import { useMyMarket } from '../lib/myMarket';
import { ownerLabel, useAuth } from '../lib/auth';
import { salesTaxRate, brokerFeeRate } from '../lib/fees';
import { getStation } from '../lib/mapdata';
import { isk, int } from '../lib/format';
import { transitShipName } from '../lib/stock';

/**
 * "You already HAVE this and it isn't listed" marker — the guard against
 * buying more of something sitting unsold in a hangar. Verdict against
 * `refPrice` (a gross sell price from the surrounding row) when given:
 * list it (nets above what you paid) vs underwater (it doesn't).
 */
export default function StockChip({ typeId, refPrice }: { typeId: number; refPrice?: number | null }) {
  const holdings = useStock((s) => s.byType[typeId]);
  const sells = useMyMarket((s) => s.sellsByType[typeId]);
  const settings = useApp((s) => s.settings);
  const characters = useAuth((s) => s.characters);
  if (!holdings || holdings.length === 0) return null;
  if (sells && sells.length > 0) return null; // listed — the selling chip covers it

  const qty = holdings.reduce((s, h) => s + h.qty, 0);
  const cost = unsoldCosts().get(typeId);
  const feeRate = salesTaxRate(settings) + brokerFeeRate(settings);
  const net = refPrice != null ? refPrice * (1 - feeRate) : null;
  const verdict =
    net !== null && cost !== undefined ? (net > cost.avgCost ? 'list' : 'underwater') : 'neutral';

  // where it sits decides the pipeline's next step (haul / hand over / list)
  const action = primaryStockAction(holdings);
  const where = holdings
    .map((h) => {
      const who = ownerLabel(h.charId, characters.find((c) => c.characterId === h.charId)?.characterName);
      const loc = h.transit
        ? `the ${transitShipName()} ship`
        : (getStation(h.locationId)?.name ?? `Structure …${String(h.locationId).slice(-4)}`).split(' - ')[0];
      return `${who}: ${int(h.qty)} at ${loc}`;
    })
    .join('\n');
  const tip =
    `You already HAVE ${int(qty)} of these with NO sell order up — ${action.tip}\n${where}\n` +
    (cost !== undefined ? `Paid avg ${isk(cost.avgCost)} per unit.` : 'No purchase on the books (loot / pre-app stock).') +
    (net !== null && cost !== undefined
      ? ` At ${isk(refPrice!)} you'd net ${isk(net)} after base fees → ${net > cost.avgCost ? `+${isk(net - cost.avgCost)}/unit.` : `${isk(net - cost.avgCost)}/unit — underwater at this price; decide to hold or cut.`}`
      : '') +
    "\nClick to fix it: opens the market window on every character that's online right now and copies the one-tick undercut at the online trader's hub (where you're actually listing).";

  return (
    <span
      className={`tip selling-chip ${verdict === 'underwater' ? 'neg' : verdict === 'list' || action.key !== 'hold' ? 'buying' : ''}`}
      data-tip={tip}
      style={{ borderBottom: 'none', cursor: 'pointer' }}
      onClick={(e) => {
        e.stopPropagation();
        void fixItStock(typeId, holdings).catch(() => {});
      }}
    >
      {verdict === 'underwater' ? '📦 underwater' : `📦 ${action.label}`}
    </span>
  );
}
