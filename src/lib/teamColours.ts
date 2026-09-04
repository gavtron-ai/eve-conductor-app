// TEAM COLOURS — every fight visual speaks the same language.
//
// The old shared LINE_COLOURS array handed out six arbitrary hues in roster
// order: attacker #3 was green, the target might be orange — "old school
// PowerPoint", as the owner put it, and worse, the colour carried no
// MEANING. Fights have sides. Hostiles are red, friendlies are blue — the
// convention every EVE pilot already reads — so the side is the hue and the
// roster index picks a tint within it.
//
// Each ship gets a core colour and a soft glow tone; SVGs draw lines twice
// (wide translucent underlay + bright core) for the neon-on-dark look
// without filter cost.

export interface ShipColour {
  /** the bright core stroke/fill */
  core: string;
  /** the wide translucent glow underlay (same hue, drawn fat and faint) */
  glow: string;
}

/** attackers — cold electric blues, brightest first */
const BLUE: ShipColour[] = [
  { core: '#3fd4ff', glow: '#0ea5e9' },
  { core: '#7aa8ff', glow: '#3b82f6' },
  { core: '#22e0d0', glow: '#14b8a6' },
  { core: '#9d8cff', glow: '#6366f1' },
  { core: '#5eead4', glow: '#0d9488' },
  { core: '#b7c4ff', glow: '#818cf8' },
];

/** the target side — hot reds and embers, brightest first */
const RED: ShipColour[] = [
  { core: '#ff4d5e', glow: '#e11d48' },
  { core: '#ff8a5c', glow: '#ea580c' },
  { core: '#ff7a9e', glow: '#db2777' },
  { core: '#ffb35c', glow: '#d97706' },
];

export const shipColour = (side: 'a' | 'b', index: number): ShipColour =>
  (side === 'b' ? RED[index % RED.length] : BLUE[index % BLUE.length]);

/**
 * Per-roster colour assignment: each SIDE counts its own ships, so the first
 * attacker is always the same blue and the target the same red, regardless
 * of roster interleaving.
 */
export function rosterColours(ships: { id: string; side: 'a' | 'b' }[]): Map<string, ShipColour> {
  const out = new Map<string, ShipColour>();
  let a = 0; let b = 0;
  for (const s of ships) {
    out.set(s.id, s.side === 'b' ? shipColour('b', b++) : shipColour('a', a++));
  }
  return out;
}
