// A BATTLE, SIMULATED SECOND BY SECOND.
//
// Everything before this was a formula: sum the damage, divide the hit points,
// call it time-to-kill. That answers a one-versus-one with no repairs and no
// deaths, and quietly gets everything else wrong:
//
//   · FOCUS FIRE. EVE does not spread damage; it kills things one at a time.
//     A three-ship gang is not "three times the dps forever" — the moment the
//     first one dies, incoming damage drops for the rest of the fight, and a
//     closed-form TTK cannot express that.
//   · KILL ORDER. Shooting the logistics first, or the highest-dps ship first,
//     changes the whole outcome. That is a decision, and a formula has nowhere
//     to put it.
//   · REPAIR AGAINST A CAPACITOR. A booster that runs at full duty for 52
//     seconds and then stops is a different ship at t=60 than at t=10.
//
// So this ticks. Each step every living ship shoots its current target, damage
// eats shield then armour then hull, repairs put some back, capacitors run
// down, and ships die and stop shooting. The answer is not "how much dps" — it
// is who is still alive, and when the last one fell.
//
// PURE: no engine, no browser. It consumes the same SimWeapon/Layer/Defenses
// the rest of fitSim produces, so fixtures run the shipped arithmetic.
import {
  landedDamagePerSecond, afterResists, geometryFrom, DEFAULT_DRONE_ORBIT,
  type SimWeapon, type SimTarget, type Layer, type Defenses, type Flying,
} from './fitSim';

export interface BattleShip {
  id: string;
  name: string;
  side: 'a' | 'b';
  weapons: SimWeapon[];
  /** shield, armour, hull — in the order damage eats them */
  layers: Layer[];
  defenses: Defenses;
  /** its own signature and speed, as the OTHER side's guns see it */
  signatureRadius: number;
  flying: Flying;
  /** metres to the opposing side */
  range: number;
  /** drone orbit radius default when a drone does not publish its own */
  droneOrbit?: number;
}

export interface BattleOptions {
  /** seconds per step. Smaller is more exact and slower; 0.25 s is well below
   * any weapon cycle, so no volley lands in the wrong tick. */
  step?: number;
  /** give up after this long and call it a stalemate */
  maxSeconds?: number;
  /** amortise reloading into sustained damage */
  sustained?: boolean;
  /**
   * WHO SHOOTS WHOM. Given the enemies still alive, pick one. Defaults to
   * "whoever is closest to dying", which is what focus fire actually means —
   * but the caller can pass "highest dps first" or a fixed order, because kill
   * order is a decision the player makes and the sim should not invent it.
   */
  pickTarget?: (shooter: BattleShip, enemies: BattleState[]) => BattleState | null;
}

export interface BattleState {
  ship: BattleShip;
  /** remaining hit points per layer, same order */
  hp: number[];
  alive: boolean;
  /** when it died */
  diedAt: number | null;
}

export interface BattleEvent {
  t: number;
  kind: 'death' | 'capOut';
  who: string;
  side: 'a' | 'b';
}

export interface BattleResult {
  /** seconds when one side was wiped out; null = neither side could finish */
  seconds: number | null;
  winner: 'a' | 'b' | null;
  events: BattleEvent[];
  /** the final state of every ship, both sides */
  ships: {
    id: string; name: string; side: 'a' | 'b';
    alive: boolean; diedAt: number | null;
    /** fraction of each layer remaining, for a health bar */
    remaining: number[];
    /** total damage this ship actually landed */
    damageDealt: number;
  }[];
  /** how long the simulation ran */
  elapsed: number;
}

const totalHp = (l: Layer[]) => l.reduce((n, x) => n + x.hp, 0);

/** default focus fire: finish what is nearly dead */
const nearestDeath = (_s: BattleShip, enemies: BattleState[]): BattleState | null => {
  let best: BattleState | null = null;
  let bestHp = Infinity;
  for (const e of enemies) {
    if (!e.alive) continue;
    const hp = e.hp.reduce((n, x) => n + x, 0);
    if (hp < bestHp) { bestHp = hp; best = e; }
  }
  return best;
};

/**
 * Run the fight — SUPERSEDED by battleEvents.ts, kept only as the reference
 * implementation for the differential fixture.
 *
 * Damage is applied per tick rather than per weapon cycle. An earlier version
 * of this header claimed the smoothing "does NOT affect who wins a fight of
 * any length". THAT CLAIM WAS FALSIFIED BY RUNNING IT: one 4000-damage volley
 * every 100 s (40 dps smoothed) against a 50 hp/s repairer stalemates here
 * and is an instant kill in reality. Alpha versus active tank is decided by
 * whether a volley lands before or after a repair cycle, which a tick that
 * averages both cannot represent. Nothing in the app calls this any more.
 */
export function simulateBattle(
  ships: BattleShip[], opts: BattleOptions = {},
): BattleResult {
  const step = opts.step ?? 0.25;
  const maxSeconds = opts.maxSeconds ?? 600;
  const sustained = opts.sustained ?? true;
  const pick = opts.pickTarget ?? nearestDeath;

  const states: BattleState[] = ships.map((ship) => ({
    ship,
    hp: ship.layers.map((l) => l.hp),
    alive: totalHp(ship.layers) > 0,
    diedAt: null,
  }));
  const dealt = new Map<string, number>();
  const events: BattleEvent[] = [];
  const capOutReported = new Set<string>();

  const sideAlive = (side: 'a' | 'b') =>
    states.some((s) => s.ship.side === side && s.alive);

  let t = 0;
  while (t < maxSeconds && sideAlive('a') && sideAlive('b')) {
    // EVERY SHOOTER RESOLVES AGAINST THE STATE AT THE START OF THE TICK, so
    // two ships firing in the same step cannot be reordered into different
    // outcomes by their position in the array.
    const pending: { victim: BattleState; byLayer: number[]; from: string }[] = [];

    for (const s of states) {
      if (!s.alive || s.ship.weapons.length === 0) continue;
      const enemies = states.filter((e) => e.ship.side !== s.ship.side);
      const victim = pick(s.ship, enemies);
      if (!victim) continue;

      const g = geometryFrom(
        { ...s.ship.flying, range: s.ship.range },
        victim.ship.flying,
        s.ship.droneOrbit ?? DEFAULT_DRONE_ORBIT,
      );
      const asTarget: SimTarget = {
        name: victim.ship.name,
        signatureRadius: victim.ship.signatureRadius,
        velocity: g.targetSpeed,
        // resistances are applied PER LAYER below, never blended here
        resonance: { em: 1, thermal: 1, kinetic: 1, explosive: 1 },
      };
      const landed = landedDamagePerSecond(s.ship.weapons, asTarget, g.engagement, sustained);
      const byLayer = victim.ship.layers.map((l) => afterResists(landed, l.resonance) * step);
      pending.push({ victim, byLayer, from: s.ship.id });
    }

    // ---- apply ----------------------------------------------------------
    for (const { victim, byLayer, from } of pending) {
      let landedTotal = 0;
      for (let i = 0; i < victim.hp.length; i++) {
        if (victim.hp[i] <= 0) continue;
        const take = Math.min(victim.hp[i], byLayer[i]);
        victim.hp[i] -= take;
        landedTotal += take;
        // damage does NOT spill into the next layer within a tick: at 0.25 s
        // the error is a quarter-second of overkill on the layer boundary, and
        // pretending to know the exact instant a layer breaks would be a lie
        break;
      }
      dealt.set(from, (dealt.get(from) ?? 0) + landedTotal);
    }

    // ---- deaths ---------------------------------------------------------
    //
    // BEFORE repair, not after. Repairing first put hit points back onto a ship
    // whose last layer had just been stripped in the same tick, so a fight that
    // should have ended oscillated forever and reported a stalemate. A ship at
    // zero is dead; the dead do not repair.
    t += step;
    for (const s of states) {
      if (!s.alive) continue;
      if (s.hp.reduce((n, x) => n + x, 0) <= 1e-9) {
        s.alive = false;
        s.diedAt = t;
        events.push({ t, kind: 'death', who: s.ship.name, side: s.ship.side });
      }
    }

    // ---- repair ---------------------------------------------------------
    for (const s of states) {
      if (!s.alive) continue;
      const d = s.ship.defenses;
      const capDry = d.capOutSeconds !== null && t >= d.capOutSeconds;
      if (capDry && !capOutReported.has(s.ship.id)) {
        capOutReported.add(s.ship.id);
        events.push({ t, kind: 'capOut', who: s.ship.name, side: s.ship.side });
      }
      // passive shield regen costs no capacitor and never stops; a booster does
      const shieldRep = ((d.shieldPassiveHps ?? 0) + (capDry ? 0 : d.shieldRepairHps ?? 0)) * step;
      const armorRep = (capDry ? 0 : d.armorRepairHps ?? 0) * step;
      if (shieldRep > 0 && s.ship.layers[0]) {
        s.hp[0] = Math.min(s.ship.layers[0].hp, s.hp[0] + shieldRep);
      }
      if (armorRep > 0 && s.ship.layers[1]) {
        s.hp[1] = Math.min(s.ship.layers[1].hp, s.hp[1] + armorRep);
      }
    }
  }

  const aUp = sideAlive('a');
  const bUp = sideAlive('b');
  const decided = aUp !== bUp;

  return {
    seconds: decided ? t : null,
    winner: decided ? (aUp ? 'a' : 'b') : null,
    events,
    elapsed: t,
    ships: states.map((s) => ({
      id: s.ship.id,
      name: s.ship.name,
      side: s.ship.side,
      alive: s.alive,
      diedAt: s.diedAt,
      remaining: s.hp.map((hp, i) => (s.ship.layers[i].hp > 0 ? hp / s.ship.layers[i].hp : 0)),
      damageDealt: dealt.get(s.ship.id) ?? 0,
    })),
  };
}
