// Per-hub fees resolved through the character who actually TRADES there.
// The Jita trader's skills/standings drive Jita math and the Amarr trader's
// drive Amarr math — never whichever character happens to be "active" (the
// active selection only steers in-game window/waypoint buttons).
import { brokerFeeRate, salesTaxRate } from './fees';
import { charForHub, type CharAccount } from './auth';
import type { Hub, Settings } from './types';

const SKILL_ACCOUNTING = 16622;
const SKILL_BROKER_RELATIONS = 3446;

/** owning NPC corp + faction of each builtin hub's market station */
export const HUB_OWNERS: Record<string, { corp: number; faction: number }> = {
  jita: { corp: 1000035, faction: 500001 }, // Caldari Navy / Caldari State
  amarr: { corp: 1000086, faction: 500003 }, // Emperor Family / Amarr Empire
  dodixie: { corp: 1000120, faction: 500004 }, // Federation Navy / Gallente Federation
  rens: { corp: 1000080, faction: 500002 }, // Brutor Tribe / Minmatar Republic
  hek: { corp: 1000160, faction: 500002 }, // Boundless Creation / Minmatar Republic
};

function traderFor(hub: Hub | null | undefined): CharAccount | null {
  return hub ? charForHub(hub.id) : null;
}

/**
 * Broker fee for placing an order at this hub, using the hub's own trader:
 * their synced Broker Relations level and their standings with the station
 * owner. Falls back to the global settings values when unknown.
 */
export function brokerRateForHub(hub: Hub | null | undefined, s: Settings): number {
  if (s.useCustomBrokerRate) return s.customBrokerRate;
  const owner = hub ? HUB_OWNERS[hub.id] : undefined;
  const trader = traderFor(hub);
  const brokerLevel = trader?.skills?.[SKILL_BROKER_RELATIONS] ?? s.brokerRelationsLevel;
  const standings = trader?.standings ?? null;
  if (owner && standings) {
    const faction = standings.factions[owner.faction] ?? 0;
    const corp = standings.corps[owner.corp] ?? 0;
    return Math.max(
      0.005,
      s.brokerFeeBase - 0.003 * brokerLevel - 0.0003 * faction - 0.0002 * corp,
    );
  }
  return brokerFeeRate(s);
}

/** Sales tax at this hub, from the hub trader's synced Accounting level. */
export function salesTaxForHub(hub: Hub | null | undefined, s: Settings): number {
  const level = traderFor(hub)?.skills?.[SKILL_ACCOUNTING];
  if (level === undefined) return salesTaxRate(s);
  return s.salesTaxBase * (1 - 0.11 * level);
}
