// SEEDED RANDOMNESS — because a jam that lands decides a fight binarily.
//
// ECM is a per-cycle Bernoulli roll in the client. Expected-value smoothing
// ("the target is 40% jammed") is exactly the sin the tick simulator died
// for: it erases the mechanic that decides fights. So the sim rolls — but
// DETERMINISTICALLY: every random draw comes from a stream seeded by the
// battle seed and the module's identity, so the same inputs and seed produce
// byte-identical fights forever, and a Monte Carlo batch over seeds 0..N−1
// is a pure function of its inputs.
//
// PRNG: mulberry32. One uint32 of state, ~6 integer ops per draw — small
// enough to hand-walk in a fixture, exact under IEEE754 (Math.imul + >>>),
// no zero-state trap, period 2^32 against the ~10^5 draws a batch needs.
// Reference draws (measured): seed 0 → 0.26642920868471265,
// 0.0003297457005828619, 0.22327202744781971; seed 1 → 0.6270739405881613.
//
// STREAM LAYOUT — the reason this file exists. Each (mechanic, ship, slot,
// victim) gets its OWN stream, so a stream's sequence depends only on its
// key and its module's own completed-activation count. Adding a mechanic or
// a module creates new keys and can never perturb an existing stream.
// Declared sub-rules:
//   · DRAW_EVEN_WHEN_CERTAIN — one draw per completed activation even at
//     chance 0 or 1 or out of range, so geometry changes never shift the
//     sequence;
//   · a module gated off (cap-starved, reloading) draws nothing — those
//     gates are deterministic per seed;
//   · per-victim mechanics (burst jammers, later) key the victim too, so
//     roster growth cannot shift existing pairs.
// Stated limit: slotOrd is the projected[] index, so EDITING a fit re-keys
// streams — stability holds across code versions for a fixed input (the
// requirement), not across fit edits.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** murmur3 finalizer — fmix32(1) = 1364076727, murmur3's published vector */
export const fmix32 = (h: number): number => {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16; return h >>> 0;
};

/** key packs mech(6 bits)|shipOrd(8)|slotOrd(8)|victimOrd(8);
 * victim sentinel 255 = "not per-victim". key(1,0,0,255) = 0x10000ff. */
export const streamKey = (mech: number, ship: number, slot: number, victim = 255): number =>
  (((mech & 63) << 24) | ((ship & 255) << 16) | ((slot & 255) << 8) | (victim & 255)) >>> 0;

/** double-fmix32: avalanche the structured key, fold the battle seed,
 * avalanche again. streamSeed(0, 0x10000ff) = 1267541879 (measured). */
export const streamSeed = (battleSeed: number, key: number): number =>
  fmix32(fmix32(key) ^ (battleSeed >>> 0));

/**
 * The roll registry — APPEND-ONLY, ids never reused. Reserving the layout
 * now means adding a mechanic later can never perturb an existing stream.
 */
export const ROLL = {
  ECM_JAM: 1,        // one draw per completed activation, at projStart. LIVE.
  BURST_JAM: 2,      // reserved: AoE 6714, one draw per (activation, victim)
  TURRET_QUALITY: 3, // reserved: EVE's real turret roll is one uniform per
                     // shot (hit/quality/wrecking). Today turrets stay
                     // expected-multiplier — unchanged.
  WRECKING: 4,       // reserved if wrecking is ever split out
  DRONE_AI: 5,       // reserved: drone aggression switching
} as const;

/** projected kinds whose outcomes are rolls — drives the Monte Carlo switch */
export const RANDOM_KINDS: ReadonlySet<string> = new Set(['ecm', 'burstJam']);

export class RollStreams {
  private streams = new Map<number, () => number>();
  private draws = 0;

  constructor(private battleSeed: number) {}

  draw(mech: number, ship: number, slot: number, victim = 255): number {
    const k = streamKey(mech, ship, slot, victim);
    let s = this.streams.get(k);
    if (!s) {
      s = mulberry32(streamSeed(this.battleSeed, k));
      this.streams.set(k, s);
    }
    this.draws += 1;
    return s();
  }

  /** fixture hook: the deterministic path must end a fight with ZERO draws */
  get drawCount(): number { return this.draws; }
}
