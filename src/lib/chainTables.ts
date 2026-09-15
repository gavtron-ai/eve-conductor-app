// SITE CONTENTS for the chain summary's valuation — gas cloud and ore rock
// quantities per site name, as published on EVE University's per-site
// pages (read 2026-09-14). Units, valued at live Jita sell per unit.
// Both spellings of "Sizeable" are keyed: the wiki writes Sizeable, some
// maps write Sizable.
import type { BountySpec, CloudSpec, RockSpec } from './chain';
import KSPACE from '../data/kspaceSites.json';

/** k-space combat anomalies priced by NPC bounties (v0.201): every rat in
 * the initial spawn and the listed waves, at CCP's kill bounty from the
 * static data export (attribute entityKillBounty), wave lists from EVE
 * University's per-site pages read by agents and spot-checked; built by
 * scripts/build-kspace.cjs into src/data/kspaceSites.json */
export const KSPACE_COMBAT: Record<string, BountySpec> = KSPACE.combat as Record<string, BountySpec>;
/** k-space gas sites (booster nebulae) — clouds per site, same source */
export const KSPACE_GAS: Record<string, CloudSpec[]> = KSPACE.gas as Record<string, CloudSpec[]>;
/** k-space ore anomalies — rocks per site, "Name|HS" when contents differ by band */
export const KSPACE_ORE: Record<string, RockSpec[]> = KSPACE.ore as Record<string, RockSpec[]>;

const gas = (a: string, na: number, b: string, nb: number): CloudSpec[] => [
  { gas: `Fullerite-${a}`, units: na }, { gas: `Fullerite-${b}`, units: nb },
];

export const GAS_SITES: Record<string, CloudSpec[]> = {
  'Barren Perimeter Reservoir': gas('C50', 12_000, 'C60', 6_000),
  'Token Perimeter Reservoir': gas('C60', 12_000, 'C70', 6_000),
  'Minor Perimeter Reservoir': gas('C70', 12_000, 'C72', 6_000),
  'Ordinary Perimeter Reservoir': gas('C72', 12_000, 'C84', 6_000),
  'Sizeable Perimeter Reservoir': gas('C84', 12_000, 'C50', 6_000),
  'Sizable Perimeter Reservoir': gas('C84', 12_000, 'C50', 6_000),
  'Bountiful Frontier Reservoir': gas('C28', 20_000, 'C32', 4_000),
  'Vast Frontier Reservoir': gas('C32', 20_000, 'C28', 4_000),
  'Instrumental Core Reservoir': gas('C320', 24_000, 'C540', 2_000),
  'Vital Core Reservoir': gas('C540', 24_000, 'C320', 2_000),
};

const rocks = (spec: [string, number][]): RockSpec[] => spec.map(([ore, units]) => ({ ore, units }));

export const ORE_SITES: Record<string, RockSpec[]> = {
  'Common Perimeter Deposit': rocks([['Arkonor', 20_000], ['Bistot', 30_000], ['Gneiss', 40_000], ['Kernite', 300_000], ['Omber', 300_000], ['Pyroxeres', 520_000]]),
  'Ordinary Perimeter Deposit': rocks([['Arkonor', 10_000], ['Bistot', 20_000], ['Gneiss', 20_000], ['Kernite', 200_000], ['Omber', 200_000], ['Pyroxeres', 1_620_000]]),
  'Average Frontier Deposit': rocks([['Arkonor', 30_000], ['Bistot', 39_999], ['Gneiss', 450_000], ['Kernite', 300_000], ['Omber', 300_000], ['Pyroxeres', 700_000]]),
  'Unexceptional Frontier Deposit': rocks([['Arkonor', 30_000], ['Bistot', 50_000], ['Gneiss', 60_000], ['Kernite', 400_000], ['Omber', 400_000]]),
  'Uncommon Core Deposit': rocks([['Arkonor', 40_000], ['Bistot', 60_000], ['Gneiss', 70_000], ['Kernite', 590_000], ['Omber', 600_000], ['Pyroxeres', 500_000]]),
  'Unusual Core Deposit': rocks([['Arkonor', 70_000], ['Bistot', 100_000], ['Gneiss', 120_000], ['Kernite', 800_000], ['Omber', 800_000]]),
  'Infrequent Core Deposit': rocks([['Arkonor', 50_000], ['Bistot', 70_000], ['Gneiss', 90_000], ['Kernite', 400_000], ['Omber', 400_000], ['Pyroxeres', 868_000]]),
  'Exceptional Core Deposit': rocks([['Arkonor', 80_000], ['Bistot', 120_000], ['Gneiss', 160_000], ['Kernite', 1_000_000], ['Omber', 1_000_000], ['Pyroxeres', 1_530_000]]),
  'Isolated Core Deposit': rocks([['Arkonor', 36_000], ['Bistot', 48_000], ['Gneiss', 72_000], ['Kernite', 720_000], ['Omber', 720_000]]),
  'Rarified Core Deposit': rocks([['Arkonor', 100_000], ['Bistot', 160_000], ['Gneiss', 200_000], ['Kernite', 1_200_000], ['Omber', 1_000_000], ['Pyroxeres', 960_000]]),
};

/** every type name the tables price — resolved to type ids once per window */
export function priceableTypeNames(): string[] {
  const s = new Set<string>();
  for (const clouds of Object.values(GAS_SITES)) for (const c of clouds) s.add(c.gas);
  for (const rs of Object.values(ORE_SITES)) for (const r of rs) s.add(r.ore);
  for (const clouds of Object.values(KSPACE_GAS)) for (const c of clouds) s.add(c.gas);
  for (const rs of Object.values(KSPACE_ORE)) for (const r of rs) s.add(r.ore);
  return [...s];
}
