import type { Settings } from './types';

/** Sales tax fraction, e.g. 0.03375 at Accounting V. Applies to every sale. */
export function salesTaxRate(s: Settings): number {
  return s.salesTaxBase * (1 - 0.11 * s.accountingLevel);
}

/**
 * Broker fee fraction for placing an order in an NPC station.
 * base 3% − 0.3%/Broker Relations level − standings reduction, floored at 0.5%.
 */
export function brokerFeeRate(s: Settings): number {
  if (s.useCustomBrokerRate) return s.customBrokerRate;
  const rate =
    s.brokerFeeBase -
    0.003 * s.brokerRelationsLevel -
    0.0003 * s.factionStanding -
    0.0002 * s.corpStanding;
  return Math.max(0.005, rate);
}

/**
 * Station-trading margin: place a buy order at `buyPrice`, later sell via a
 * sell order at `sellPrice`, both in the same hub.
 * Returns net profit per unit and margin as a fraction of invested cost.
 * `brokerOverride` lets callers pass a hub-specific standings-aware rate.
 */
export function stationTradeMargin(
  buyPrice: number,
  sellPrice: number,
  s: Settings,
  brokerOverride?: number,
) {
  const broker = brokerOverride ?? brokerFeeRate(s);
  const cost = buyPrice * (1 + broker);
  const revenue = sellPrice * (1 - broker - salesTaxRate(s));
  const profit = revenue - cost;
  return { profit, marginPct: cost > 0 ? profit / cost : 0 };
}

/**
 * Hauling profit: buy instantly from sell orders at the source (no broker fee),
 * then sell at the destination.
 * `quick` sells instantly into buy orders (sales tax only);
 * `patient` places a sell order at the destination's lowest sell (broker fee + tax).
 * `destBrokerOverride` lets callers pass the destination hub's standings-aware rate.
 */
export function haulProfit(
  sourceSellMin: number,
  destBuyMax: number,
  destSellMin: number,
  s: Settings,
  destBrokerOverride?: number,
) {
  const tax = salesTaxRate(s);
  const broker = destBrokerOverride ?? brokerFeeRate(s);
  const quick = destBuyMax * (1 - tax) - sourceSellMin;
  const patient = destSellMin * (1 - tax - broker) - sourceSellMin;
  return {
    quick,
    quickPct: sourceSellMin > 0 ? quick / sourceSellMin : 0,
    patient,
    patientPct: sourceSellMin > 0 ? patient / sourceSellMin : 0,
  };
}
