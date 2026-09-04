import { useMyMarket, sellingTooltip, buyingTooltip } from '../lib/myMarket';

/**
 * "You're already on this market" markers — one for the team's sell orders,
 * one for its BUY orders (so a trade check can't recommend bidding on
 * something a teammate is already bidding on). Hover shows each order: who,
 * how many, the price, and the best competing order at that station.
 */
export default function SellingChip({ typeId }: { typeId: number }) {
  const sells = useMyMarket((s) => s.sellsByType[typeId]);
  const buys = useMyMarket((s) => s.buysByType[typeId]);
  const undercut = sells?.some((s) => s.bestOther !== null && s.bestOther < s.price);
  const outbid = buys?.some((b) => b.bestOther !== null && b.bestOther > b.price);
  return (
    <>
      {sells && sells.length > 0 && (
        <span
          className={`tip selling-chip ${undercut ? 'neg' : ''}`}
          data-tip={sellingTooltip(sells)}
          style={{ borderBottom: 'none' }}
        >
          {undercut ? '⚠' : '◉'} selling
        </span>
      )}
      {buys && buys.length > 0 && (
        <span
          className={`tip selling-chip buying ${outbid ? 'neg' : ''}`}
          data-tip={buyingTooltip(buys)}
          style={{ borderBottom: 'none' }}
        >
          {outbid ? '⚠' : '◎'} buying
        </span>
      )}
    </>
  );
}
