// A HUNDRED FIGHTS, NOT ONE — because jams are rolls.
//
// With ECM on the field a single simulation is one draw from a distribution;
// presenting it as THE outcome would be a lie of overconfidence. So the
// battle runs N times over seeds 0..N−1 (a pure function of its inputs —
// adaptive run counts were rejected: a run count that depends on results is
// optional stopping, and reproducibility is this project's spine) and the
// headline becomes a probability: "attackers win 73 of 100 fights".
//
// THE N=1 GUARD IS STRUCTURAL: when nothing on the field rolls (no ECM), the
// wrapper returns the exact simulateBattleEvents result the UI ran before,
// with drawCount === 0 as machine-checkable proof the RNG never participated
// — bit-for-bit identical to the deterministic path by construction.
//
// The representative fight shown in the charts is the MEDIAN run re-run in
// full (pass 1 keeps only per-seed summaries so a hundred 1 Hz series are
// never held at once; determinism makes the re-run identical to its
// summary). It is one sampled fight, labelled as such — never THE fight.
import {
  simulateBattleEvents,
  type EventShip, type EventBattleOptions, type EventBattleResult,
} from './battleEvents';
import { RANDOM_KINDS } from './battleRng';

export function hasRandomMechanics(ships: EventShip[]): boolean {
  return ships.some((s) => (s.projected ?? []).some((p) => RANDOM_KINDS.has(p.kind)));
}

export interface MonteCarloResult {
  mode: 'deterministic' | 'stochastic';
  n: number;
  winCount: { a: number; b: number; mutual: number; stalemate: number };
  /** nearest-rank percentiles of the DECIDED runs' decision times */
  decided: { median: number | null; p10: number | null; p90: number | null };
  representativeSeed: number;
  representative: EventBattleResult;
  perSeed: { seed: number; winner: 'a' | 'b' | null; seconds: number | null }[];
}

type Outcome = 'a' | 'b' | 'mutual' | 'stalemate';

const outcomeOf = (r: { winner: 'a' | 'b' | null; seconds: number | null }): Outcome =>
  (r.winner === 'a' ? 'a' : r.winner === 'b' ? 'b'
    : r.seconds !== null ? 'mutual' : 'stalemate');

const nearestRank = (sorted: number[], q: number): number | null =>
  (sorted.length === 0 ? null : sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)]);

export function runMonteCarlo(
  ships: EventShip[], opts: EventBattleOptions = {}, n = 100,
): MonteCarloResult {
  if (!hasRandomMechanics(ships)) {
    const r = simulateBattleEvents(ships, opts);
    const o = outcomeOf(r);
    return {
      mode: 'deterministic',
      n: 1,
      winCount: { a: o === 'a' ? 1 : 0, b: o === 'b' ? 1 : 0, mutual: o === 'mutual' ? 1 : 0, stalemate: o === 'stalemate' ? 1 : 0 },
      decided: { median: r.seconds, p10: r.seconds, p90: r.seconds },
      representativeSeed: r.seed,
      representative: r,
      perSeed: [{ seed: r.seed, winner: r.winner, seconds: r.seconds }],
    };
  }

  // pass 1: summaries only — the full per-seed results are left to the GC
  const perSeed: MonteCarloResult['perSeed'] = [];
  const winCount = { a: 0, b: 0, mutual: 0, stalemate: 0 };
  for (let seed = 0; seed < n; seed++) {
    const r = simulateBattleEvents(ships, { ...opts, seed });
    perSeed.push({ seed, winner: r.winner, seconds: r.seconds });
    winCount[outcomeOf(r)] += 1;
  }

  const decidedTimes = perSeed
    .filter((x) => x.seconds !== null)
    .map((x) => x.seconds as number)
    .sort((a, b) => a - b);

  // the representative: majority outcome class (ties a > b > mutual >
  // stalemate), then the median by (seconds, seed) — ties to the lowest seed
  const classes: Outcome[] = ['a', 'b', 'mutual', 'stalemate'];
  let majority: Outcome = 'a';
  for (const c of classes) if (winCount[c] > winCount[majority]) majority = c;
  const inClass = perSeed
    .filter((x) => outcomeOf(x) === majority)
    .sort((x, y) => ((x.seconds ?? Infinity) - (y.seconds ?? Infinity)) || (x.seed - y.seed));
  const repSeed = inClass.length > 0 ? inClass[Math.floor((inClass.length - 1) / 2)].seed : 0;

  // pass 2: re-run the representative in full — determinism makes this
  // identical to its pass-1 summary
  const representative = simulateBattleEvents(ships, { ...opts, seed: repSeed });

  return {
    mode: 'stochastic',
    n,
    winCount,
    decided: {
      median: nearestRank(decidedTimes, 0.5),
      p10: nearestRank(decidedTimes, 0.1),
      p90: nearestRank(decidedTimes, 0.9),
    },
    representativeSeed: repSeed,
    representative,
    perSeed,
  };
}
