// EVE price entry allows only 4 significant digits. Beating an order means
// moving the 4th significant digit by one: beat a 1,512 bid with 1,513
// (or 1,512,000,000 with 1,513,000,000); undercut a 1,512 ask with 1,511.
// Results round to EVE's 0.01 ISK minimum step.

/** the next price that beats `price` from `dir` ('above' outbids a buy order,
 * 'below' undercuts a sell order), at 4 significant digits */
export function tickPrice(price: number, dir: 'above' | 'below'): number {
  if (!Number.isFinite(price) || price <= 0) return 0.01;
  const exp = Math.floor(Math.log10(price));
  const scale = Math.pow(10, exp - 3); // 4 significant digits
  // below ~10 ISK the 4-digit tick is finer than EVE's 0.01 minimum step —
  // there the real next price is simply ±0.01
  if (scale < 0.01) {
    const next = dir === 'above' ? price + 0.01 : price - 0.01;
    return Math.max(0.01, Math.round(next * 100) / 100);
  }
  const digits = Math.round(price / scale);
  const next = dir === 'above' ? digits + 1 : digits - 1;
  if (next <= 0) return 0.01;
  return Math.max(0.01, Math.round(next * scale * 100) / 100);
}

/** clipboard-friendly text: EVE's price box takes plain numbers */
export function tickPriceText(price: number, dir: 'above' | 'below'): string {
  const p = tickPrice(price, dir);
  return Number.isInteger(p) ? String(p) : p.toFixed(2);
}
