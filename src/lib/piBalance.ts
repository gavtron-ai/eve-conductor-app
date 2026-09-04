// FLOW BALANCE — is the head-to-factory ratio right on this planet?
//
// The question the owner actually plays by: "do I have too many factories for
// the extractor heads (rebalance heads->factories), or too many heads
// (surplus piles up, add a factory)?" Both are pure RATE math over numbers
// we hold exactly: factory burn/output from the SDE schematic table, and
// extractor supply from the program's official yield-formula average
// (piYield). No dependence on ESI's lazy colony simulation — pin CONFIG is
// always current even when the colony state is stale — so unlike the old
// last_cycle_start starvation guess this is deterministic.
//
// Factories under-supplied at ratio r do not take turns; each waits for a
// full input batch, so they ALL duty-cycle at ~r (and at program end they
// all stop). "At least one factory is always running" is NOT a safe
// assumption — the ratio is the signal, not liveness.
//
// Chains (P1->P2 factories fed by other factories) are handled by a
// fixed-point pass: a factory's duty = min coverage of its inputs, and its
// OUTPUT contribution scales by its duty. Duties start at 1 and only
// shrink, so the iteration converges monotonically; PI chains are <=3 deep
// and a handful of iterations is exact enough for a % readout.
//
// IMPORTS ARE INVISIBLE TO RATE MATH: a consumed type with zero on-planet
// supply (no extractor pulls it, no factory makes it) is treated as
// imported via the launchpad and EXCLUDED from coverage — a factory planet
// fed by hauled-in P1 must not read as "starved". (A mis-routed chain looks
// the same from rates alone; detail.routes could split that some day.)

import { schematicPerHour, type Schematic } from './piSchematics';

export interface FlowBalanceInput {
  extractors: { productTypeId: number | null; perHour: number; active: boolean }[];
  factorySchematics: { schematicId: number; count: number }[];
}

export interface TypeFlow {
  typeId: number;
  /** units/hour arriving: active extractor average + duty-scaled factory output */
  supplyPerHour: number;
  /** units/hour all consumers would eat running back to back (duty 1) */
  demandPerHour: number;
  /** supply / demand */
  coverage: number;
}

export interface FlowBalance {
  /** min coverage across supplied+consumed types, capped at 9.99; the
   * fraction of the time the factories can actually run */
  fedFrac: number;
  /** the type that caps fedFrac */
  bottleneckTypeId: number | null;
  /** extractor products consumed on-planet but arriving faster than eaten */
  surplusTypeId: number | null;
  surplusPerHour: number;
  flows: TypeFlow[];
}

const ITERATIONS = 6;

/**
 * null = not judgeable: no schematic table, no factories, or no active
 * extractors (an import-fed factory planet has no rate-based verdict).
 */
export function flowBalance(inp: FlowBalanceInput, schem: Map<number, Schematic> | null): FlowBalance | null {
  if (!schem || inp.factorySchematics.length === 0) return null;
  const extracted = new Map<number, number>();
  for (const e of inp.extractors) {
    if (e.active && e.productTypeId !== null && e.perHour > 0) {
      extracted.set(e.productTypeId, (extracted.get(e.productTypeId) ?? 0) + e.perHour);
    }
  }
  if (extracted.size === 0) return null;

  const groups = inp.factorySchematics
    .map((f) => ({ f, sc: schem.get(f.schematicId) }))
    .filter((g): g is { f: { schematicId: number; count: number }; sc: Schematic } => !!g.sc)
    .map((g) => ({ ...g, rate: schematicPerHour(g.sc), duty: 1 }));
  if (groups.length === 0) return null;

  const demand = new Map<number, number>();
  for (const g of groups) {
    for (const i of g.rate.inputs) demand.set(i.typeId, (demand.get(i.typeId) ?? 0) + i.perHour * g.f.count);
  }

  let coverage = new Map<number, number>();
  for (let pass = 0; pass < ITERATIONS; pass++) {
    // supply at current duties
    const supply = new Map<number, number>(extracted);
    for (const g of groups) {
      const o = g.rate.output;
      if (o) supply.set(o.typeId, (supply.get(o.typeId) ?? 0) + o.perHour * g.f.count * g.duty);
    }
    coverage = new Map();
    for (const [typeId, d] of demand) {
      const s = supply.get(typeId) ?? 0;
      if (s <= 0) continue; // imported — rates cannot see the launchpad
      coverage.set(typeId, s / d);
    }
    for (const g of groups) {
      let duty = 1;
      for (const i of g.rate.inputs) {
        const c = coverage.get(i.typeId);
        if (c !== undefined) duty = Math.min(duty, c);
      }
      g.duty = duty;
    }
  }
  if (coverage.size === 0) return null; // every consumed type is imported

  const flows: TypeFlow[] = [...coverage.entries()].map(([typeId, c]) => ({
    typeId,
    supplyPerHour: c * (demand.get(typeId) ?? 0),
    demandPerHour: demand.get(typeId) ?? 0,
    coverage: c,
  })).sort((a, b) => a.coverage - b.coverage);

  const worst = flows[0];
  let surplusTypeId: number | null = null;
  let surplusPerHour = 0;
  for (const [typeId, pull] of extracted) {
    const d = demand.get(typeId);
    if (d === undefined) continue; // pure export product — a choice, not an imbalance
    const extra = pull - d;
    if (extra > surplusPerHour) { surplusPerHour = extra; surplusTypeId = typeId; }
  }

  return {
    fedFrac: Math.min(9.99, worst.coverage),
    bottleneckTypeId: worst.coverage < 1 ? worst.typeId : null,
    surplusTypeId,
    surplusPerHour,
    flows,
  };
}

/** the two actionable verdicts; anything between is left alone */
export const UNDERFED_BELOW = 0.85;
export const OVERFED_SURPLUS_FRAC = 0.25;

export function balanceProblem(b: FlowBalance | null): 'underfed' | 'overfed' | null {
  if (!b) return null;
  if (b.fedFrac < UNDERFED_BELOW) return 'underfed';
  if (b.surplusTypeId !== null) {
    const flow = b.flows.find((f) => f.typeId === b.surplusTypeId);
    const supply = flow ? flow.supplyPerHour : 0;
    const total = supply > 0 ? b.surplusPerHour / (b.surplusPerHour + flow!.demandPerHour) : 0;
    if (total > OVERFED_SURPLUS_FRAC) return 'overfed';
  }
  return null;
}
