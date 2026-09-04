// Effective ship cargo model: hull bays + skill bonuses + fitted expanders/rigs.
// Bay attribute ids and required-skill ids were verified live against ESI dogma
// (2026-07-16, see LEARNINGS/API-NOTES.md). Hull bonus rules are EVE ship traits:
//   T1 industrials (group 28): +5%/lvl racial Industrial — on the specialized bay
//     for specialist hulls (Miasmos etc.), on the cargo bay otherwise
//   Deep Space Transports (380): +5%/lvl Transport Ships on the fleet hangar
//   Blockade Runners (1202): +5%/lvl Transport Ships on cargo
//   Freighters (513) & Jump Freighters (902): +5%/lvl racial Freighter on cargo
//   Industrial Command Ships (941): +5%/lvl ICS on the ore hold
// Note: NO implant affects cargo capacity in EVE — implants matter for travel
// time (agility/warp), not hold size.
import type { ItemType } from './types';

export const SKILL_IDS_CARGO = {
  transportShips: 19719,
  industrialCommandShips: 29637,
} as const;

/** raceID → racial Industrial / Freighter skill typeID */
const RACE_INDUSTRIAL: Record<number, number> = { 1: 3342, 2: 3341, 4: 3343, 8: 3340 };
const RACE_FREIGHTER: Record<number, number> = { 1: 20526, 2: 20528, 4: 20524, 8: 20527 };

const GROUP = { industrial: 28, dst: 380, blockadeRunner: 1202, freighter: 513, jumpFreighter: 902, ics: 941 };

const BAY_LABELS: Record<string, string> = {
  ore: 'ore hold',
  ammo: 'ammo hold',
  mineral: 'mineral hold',
  pi: 'planetary hold',
};

export interface FittedCargoMods {
  /** attr 149 of fitted low-slot modules, e.g. 1.275 per Expanded Cargohold II */
  expanderMultipliers: number[];
  /** attr 614 of fitted rigs, e.g. 15 per Cargohold Optimization I */
  rigBonusesPct: number[];
}

export interface CargoResult {
  /** m³ usable for arbitrary goods: cargo bay + fleet hangar */
  general: number;
  cargoBay: number;
  fleetHangar: number;
  /** commodity-restricted bays (ore/PI/ammo/minerals) — NOT in `general` */
  restricted: { label: string; size: number }[];
}

/**
 * `skills` is a typeID→level map (null when not logged in → base values).
 * `mods` are the ship's actual fitted cargo modules (owned ships only).
 * Expanders/rigs apply to the main cargo bay only, multiplicatively —
 * cargo multipliers are not stacking-penalized in EVE.
 */
export function computeShipCargo(
  t: ItemType,
  skills: Record<number, number> | null,
  mods?: FittedCargoMods,
): CargoResult {
  const lvl = (id: number | undefined) => (id && skills ? (skills[id] ?? 0) : 0);
  const bonus = (id: number | undefined) => 1 + 0.05 * lvl(id);

  let cargoBay = t.cargo ?? 0;
  const bays = { ...(t.bays ?? {}) };
  let fleetHangar = bays.fleet ?? 0;
  delete bays.fleet;

  switch (t.group) {
    case GROUP.industrial: {
      const racial = RACE_INDUSTRIAL[t.race ?? 0];
      const specialist = Object.keys(bays).length > 0;
      if (specialist) {
        for (const k of Object.keys(bays)) bays[k as keyof typeof bays]! *= bonus(racial);
      } else {
        cargoBay *= bonus(racial);
      }
      break;
    }
    case GROUP.dst:
      fleetHangar *= bonus(SKILL_IDS_CARGO.transportShips);
      break;
    case GROUP.blockadeRunner:
      cargoBay *= bonus(SKILL_IDS_CARGO.transportShips);
      break;
    case GROUP.freighter:
    case GROUP.jumpFreighter:
      cargoBay *= bonus(RACE_FREIGHTER[t.race ?? 0]);
      break;
    case GROUP.ics:
      if (bays.ore) bays.ore *= bonus(SKILL_IDS_CARGO.industrialCommandShips);
      break;
  }

  for (const m of mods?.expanderMultipliers ?? []) cargoBay *= m;
  for (const r of mods?.rigBonusesPct ?? []) cargoBay *= 1 + r / 100;

  return {
    general: Math.floor(cargoBay + fleetHangar),
    cargoBay: Math.floor(cargoBay),
    fleetHangar: Math.floor(fleetHangar),
    restricted: Object.entries(bays)
      .filter(([, size]) => size && size > 0)
      .map(([k, size]) => ({ label: BAY_LABELS[k] ?? k, size: Math.floor(size!) })),
  };
}

const fmt = (n: number) => n.toLocaleString('en-US');

/** "5,000 cargo + 62,500 fleet hangar = 67,500 m³ · ore hold 52,500 (ore only)" */
export function cargoBreakdown(r: CargoResult): string {
  const parts: string[] = [];
  let main = `${fmt(r.cargoBay)} cargo`;
  if (r.fleetHangar > 0) main += ` + ${fmt(r.fleetHangar)} fleet hangar = ${fmt(r.general)} m³`;
  else main += ' m³';
  parts.push(main);
  for (const b of r.restricted) parts.push(`${b.label} ${fmt(b.size)} (${b.label.split(' ')[0]} only)`);
  return parts.join(' · ');
}
