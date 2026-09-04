// THE BEST POD FOR THIS FIT — searched by measurement, never by arithmetic.
//
// WHY A PER-SLOT SEARCH CANNOT WORK. Measured on the shipped engine: an Omega
// implant scored ALONE is indistinguishable from an empty slot (+0.0000% on a
// bare pod, its bonus attribute absent entirely). It is worth nothing by itself
// and multiplies the whole set — High-grade Snake Omega carries x3.0 — so a
// search that evaluates each slot independently has literally no signal to pick
// it. Argmax captures 78.7% of a High-grade Snake's velocity gain and 61.7% of
// a High-grade Amulet's armour. Greedy sequential still loses ~9%.
//
// So sets are evaluated as WHOLE PODS, one engine pass each, and never merged
// without re-running: High-grade Halo Omega carries the Amulet set EFFECT but
// not its attribute, and that attribute defaults to zero — so putting the two
// together PreMuls every armour bonus by ZERO. Anti-synergy is real and the
// engine is the only thing that sees it.
//
// The search is therefore explicitly RESTRICTED, and says what it searched:
// exhausting six slots over 837 implants is ~1e12 combinations.
import { implantSlot, cyberneticsFor, normalizePod, type ImplantLookup } from './implants';

/** how good is this pod? Higher wins. The caller supplies it, because "best"
 * is not one number — a pod that raises damage can cost tank, and only the
 * person asking knows which they are buying. */
export type PodScore = (implants: number[]) => Promise<number | null>;

export interface SolveOptions {
  data: ImplantLookup;
  /** the pilot's Cybernetics level; null skips the gate (a pilot who will train it) */
  cybernetics: number | null;
  score: PodScore;
  /** called after each candidate so the UI can show progress */
  onProgress?: (done: number, total: number) => void;
  /** return true to abandon — the user closed the panel */
  cancelled?: () => boolean;
  /**
   * How many hardwirings to MEASURE per remaining slot. Defaults to ALL of
   * them, and that default is load-bearing.
   *
   * This used to be 6, chosen by `slice(0, 6)` over the catalog in TYPE-ID
   * ORDER — six arbitrary implants per slot, not the six strongest, despite a
   * comment claiming otherwise. On a turret ship that meant the damage and
   * rate-of-fire hardwirings were essentially never tested, and the search
   * reported "nothing beat an empty pod" while every candidate scored exactly
   * the baseline. Sampling a list nobody sorted is not a search.
   */
  perSlotCandidates?: number;
  /**
   * DEEP MODE: measure EVERY reachable implant in every free slot, and refine
   * on top of the best few sets rather than only the winner.
   *
   * The combinatorics are not as bad as they look. Ten slots of ~60-170
   * implants is ~1e18 pods, which is hopeless — but only SET PIECES interact,
   * and a set's multiplier is a single scalar applied uniformly, so it cannot
   * change the ORDER of candidates within a slot. Per-slot argmax is therefore
   * EXACT once the set is fixed, and the real search is (sets) x (implants per
   * free slot), which is thousands of engine passes, not quintillions.
   *
   * Every candidate still costs a real engine run, so this is minutes, not
   * seconds — and the caller warns before starting.
   */
  deep?: boolean;
  /** how many of the best sets to refine on top of in deep mode */
  refineTop?: number;
  /** average price per type id, for costing the answer. One cached ESI call
   * covers every type in the game — never one call per implant. */
  prices?: Map<number, number>;
}

export interface SolveResult {
  /** the winning pod, legal by construction */
  implants: number[];
  score: number;
  /** the score with no implants at all, for "what did this buy me" */
  baseline: number;
  /** the named set that won, when one did */
  setName: string | null;
  /** every candidate that was measured, best first — the UI shows the runners
   * up, because the second-best set is often a tenth of the price */
  considered: {
    label: string; score: number; implants: number[]; cost: number | null;
    /** this candidate scores EXACTLY the same as an earlier, cheaper one — the
     * set it names does nothing for the objective being optimised. Talisman is
     * armour repair and Crystal is shield boost; against "kill fastest" they
     * are decoration on top of the hardwirings that did the work. */
    sameAs?: string;
  }[];
  /** WHAT WAS AND WAS NOT SEARCHED, in words, for the panel to print verbatim */
  searched: string;
  engineRuns: number;
  /** ISK for the winning pod, when prices were supplied */
  cost: number | null;
  /** the cheapest candidate that still beat the baseline — very often a tiny
   * fraction of the winner's price for most of the gain */
  bestValue: { label: string; score: number; implants: number[]; cost: number } | null;
}

/** implants whose names share a grade+family prefix, e.g. "High-grade Snake" */
function setFamilies(data: ImplantLookup, cybernetics: number | null): Map<string, number[]> {
  const families = new Map<string, number[]>();
  for (const [idStr, t] of Object.entries(data.types)) {
    if (t.published === false) continue;
    const id = Number(idStr);
    const slot = implantSlot(data, id);
    // every set piece in the shipped bundle sits in slots 1-6; a hardwiring in
    // 7-10 is never part of a named family
    if (slot === undefined || slot < 1 || slot > 6) continue;
    if (cybernetics !== null && cyberneticsFor(data, id) > cybernetics) continue;
    // "High-grade Snake Omega" -> "High-grade Snake"
    const m = /^(.*?)\s+(Alpha|Beta|Delta|Epsilon|Gamma|Omega)$/i.exec(t.name);
    if (!m) continue;
    const key = m[1];
    families.set(key, [...(families.get(key) ?? []), id]);
  }
  // a "family" is only worth testing as a unit when it has more than one piece
  for (const [k, v] of families) if (v.length < 2) families.delete(k);
  return families;
}

/** hardwirings that belong to no named set, grouped by the slot they occupy */
function hardwiringsBySlot(
  data: ImplantLookup, cybernetics: number | null, inFamilies: Set<number>,
): Map<number, number[]> {
  const bySlot = new Map<number, number[]>();
  for (const [idStr, t] of Object.entries(data.types)) {
    if (t.published === false) continue;
    const id = Number(idStr);
    if (inFamilies.has(id)) continue;
    const slot = implantSlot(data, id);
    if (slot === undefined || slot < 1 || slot > 10) continue;
    if (cybernetics !== null && cyberneticsFor(data, id) > cybernetics) continue;
    bySlot.set(slot, [...(bySlot.get(slot) ?? []), id]);
  }
  return bySlot;
}

/**
 * Search for the best pod.
 *
 * Two stages, in the only order that respects the measurement:
 *   1. WHOLE SETS. Baseline plus every complete named family, scored as a unit,
 *      because their pieces multiply each other and an Omega is worth zero
 *      alone.
 *   2. REFINE. On top of the winner, fill each still-empty slot with the best
 *      hardwiring that ACTUALLY improves the score — measured, one at a time,
 *      keeping each improvement so later slots are judged on top of earlier
 *      ones. That ordering matters because slot 7-10 hardwirings are
 *      themselves multiplied by a worn set.
 */
export async function solveImplants(o: SolveOptions): Promise<SolveResult | null> {
  const perSlot = o.deep ? Number.POSITIVE_INFINITY
    : (o.perSlotCandidates ?? Number.POSITIVE_INFINITY);
  const refineTop = o.deep ? (o.refineTop ?? 5) : 1;
  const priceOf = (ids: number[]): number | null => {
    if (!o.prices) return null;
    let total = 0;
    for (const id of ids) total += o.prices.get(id) ?? 0;
    return total;
  };
  const considered: SolveResult['considered'] = [];
  const note = (label: string, score: number, implants: number[]) =>
    considered.push({ label, score, implants, cost: priceOf(implants) });
  let runs = 0;
  const dead = () => o.cancelled?.() === true;

  const measure = async (implants: number[]): Promise<number | null> => {
    runs += 1;
    return o.score(implants);
  };

  const baseline = await measure([]);
  if (baseline === null || dead()) return null;

  // ---- stage 1: whole sets -------------------------------------------------
  const families = setFamilies(o.data, o.cybernetics);
  const inFamilies = new Set<number>();
  for (const ids of families.values()) for (const id of ids) inFamilies.add(id);

  let best = { label: 'no implants', score: baseline, implants: [] as number[], setName: null as string | null };
  note('no implants', baseline, []);

  const total = families.size + 4 * perSlot;
  let done = 0;
  for (const [name, ids] of families) {
    if (dead()) return null;
    // legal by construction: one per slot, no duplicates, Cybernetics honoured
    const pod = normalizePod(ids, o.data, o.cybernetics).accepted;
    if (pod.length === 0) continue;
    const s = await measure(pod);
    o.onProgress?.(++done, total);
    if (s === null) continue;
    note(name, s, pod);
    if (s > best.score) best = { label: name, score: s, implants: pod, setName: name };
  }

  // ---- stage 2: refine the empty slots ------------------------------------
  //
  // A set multiplier is a single scalar applied uniformly, so it cannot change
  // the ORDER of candidates within a slot — which makes per-slot argmax EXACT
  // once the set is fixed. That is what keeps an exhaustive search tractable:
  // (sets) x (implants per free slot), not the product of every slot.
  const bySlot = hardwiringsBySlot(o.data, o.cybernetics, inFamilies);
  const seeds = considered
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, refineTop);
  // 'HARDWIRINGS ONLY' IS ALWAYS IN THE MIX (v0.97.4): when one set
  // genuinely leads (the margin gradient broke the old universal ties), the
  // quick search's single refinement seed became that set and the bare-
  // hardwirings answer silently vanished from the shortlist (caught live).
  if (!seeds.some((x) => x.implants.length === 0)) {
    seeds.push({ label: 'no implants', score: baseline, implants: [], cost: priceOf([]) });
  }

  let overall = { implants: [...best.implants], score: best.score, setName: best.setName };

  for (const seed of seeds) {
    if (dead()) return null;
    let current = [...seed.implants];
    let currentScore = seed.score;
    // the SEED's own slots (its set pieces) are never torn apart - the
    // refinement fills and re-fills only the slots the seed left free
    const seedSlots = new Set(current.map((id) => implantSlot(o.data, id)));
    const freeSlots = [...bySlot.keys()].sort((a, b) => a - b)
      .filter((slot) => !seedSlots.has(slot));
    /**
     * SWEEP TO A FIXED POINT (v0.97.2). One pass per slot could not build
     * COMBOS: with a coarse (volley-quantised) objective a lone implant
     * often showed no gain while two together did, so the search stalled
     * on plateaus and the shortlist under-explored exactly the pods worth
     * finding (caught live). Later sweeps may REPLACE an earlier pick in a
     * refinement slot; the loop stops the first sweep that improves
     * nothing (cap 3 - measured convergence, not a magic number: greedy
     * with replacement over a monotone objective settles in 2).
     */
    const slotTop = new Map<number, { id: number; score: number }>();
    for (let sweep = 0; sweep < 3; sweep++) {
      let improved = false;
      for (const slot of freeSlots) {
        if (dead()) return null;
        const existing = current.find((id) => implantSlot(o.data, id) === slot);
        const others = existing === undefined
          ? current : current.filter((id) => id !== existing);
        const all = bySlot.get(slot) ?? [];
        const candidates = Number.isFinite(perSlot) ? all.slice(0, perSlot) : all;
        let bestForSlot: { id: number; score: number } | null = null;
        for (const id of candidates) {
          if (dead()) return null;
          if (id === existing) continue;
          const s2 = await measure(normalizePod([...others, id], o.data, o.cybernetics).accepted);
          o.onProgress?.(++done, Math.max(total, done));
          if (s2 === null) continue;
          // remember the slot's best candidate EVEN when it fails the
          // strict test - the plateau jump below needs it
          const prev = slotTop.get(slot);
          if (!prev || s2 > prev.score) slotTop.set(slot, { id, score: s2 });
          if (s2 > currentScore && (bestForSlot === null || s2 > bestForSlot.score)) {
            bestForSlot = { id, score: s2 };
          }
        }
        if (bestForSlot) {
          current = normalizePod([...others, bestForSlot.id], o.data, o.cybernetics).accepted;
          currentScore = bestForSlot.score;
          improved = true;
        }
      }
      if (!improved) break;
    }
    /**
     * THE PLATEAU JUMP (v0.97.4). A fight quantised to the victim's
     * rep-cycle or volley grid can be immovable by any SINGLE implant while
     * a COMBINATION crosses the boundary - so when the per-slot sweeps
     * stall, the strongest candidate of every still-empty slot goes in AT
     * ONCE. If the bundle measures better, it is kept and then PRUNED:
     * each piece is removed in turn and stays out when the score holds -
     * the tie sort already prefers the cheaper equivalent pod.
     */
    {
      const bundleIds = [...slotTop.entries()]
        .filter(([slot]) => !current.some((id) => implantSlot(o.data, id) === slot))
        .map(([, v]) => v.id);
      if (bundleIds.length >= 2 && !dead()) {
        let pod = normalizePod([...current, ...bundleIds], o.data, o.cybernetics).accepted;
        const sc = await measure(pod);
        o.onProgress?.(++done, Math.max(total, done));
        if (sc !== null && sc > currentScore) {
          let podScore = sc;
          for (const id of bundleIds) {
            if (dead()) break;
            if (!pod.includes(id)) continue;
            const without = pod.filter((x) => x !== id);
            const s3 = await measure(without);
            o.onProgress?.(++done, Math.max(total, done));
            if (s3 !== null && s3 >= podScore) {
              pod = without;
              podScore = s3;
            }
          }
          current = pod;
          currentScore = podScore;
        }
      }
    }
    note(`${seed.label} + hardwirings`, currentScore, current);
    if (currentScore > overall.score) {
      overall = { implants: current, score: currentScore, setName: seed.label === 'no implants' ? null : seed.label };
    }
  }

  // ---- stage 3: the same answer, one grade down ---------------------------
  //
  // "The runner-up should at least be the next lower version of the same
  // implant" — right, and a list of unrelated sets is not that. A grade ladder
  // is where the actual money decision lives: a High-grade set can cost ten
  // times its Mid-grade sibling for a couple of percent.
  //
  // Names carry the ladder: "High-grade Snake Beta" -> "Mid-grade"/"Low-grade",
  // and hardwirings run "...-605" -> "...-604" -> "...-603". Both are rewritten
  // and the result is MEASURED, never assumed to scale.
  const nameOf = (id: number) => o.data.types[String(id)]?.name ?? '';
  const idByName = new Map<string, number>();
  for (const [idStr, t] of Object.entries(o.data.types)) {
    if (t.published !== false) idByName.set(t.name, Number(idStr));
  }
  const downgrade = (id: number): number | null => {
    const n = nameOf(id);
    for (const [from, to] of [['High-grade', 'Mid-grade'], ['Mid-grade', 'Low-grade']]) {
      if (n.startsWith(from)) {
        const alt = idByName.get(n.replace(from, to));
        if (alt !== undefined) return alt;
      }
    }
    // trailing grade digit: EE-606 -> EE-605
    const m = /^(.*?)(\d)$/.exec(n);
    if (m && m[2] !== '1') {
      const alt = idByName.get(`${m[1]}${Number(m[2]) - 1}`);
      if (alt !== undefined) return alt;
    }
    return null;
  };

  if (overall.implants.length > 0) {
    // THE WHOLE LADDER (v0.97.3), not one step: walk the winning pod down a
    // grade at a time until nothing downgrades further, measuring every
    // rung — "where are the -704s and -703s" is a price curve, and a curve
    // needs its points (caught live). Each rung is a real fight score, so
    // rungs that still help rank above no-implants on their own merit.
    let rung = [...overall.implants];
    for (let g = 1; g <= 6; g++) {
      const next = rung.map((id) => downgrade(id) ?? id);
      if (!next.some((id, i) => id !== rung[i])) break;
      const pod = normalizePod(next, o.data, o.cybernetics).accepted;
      if (dead()) break;
      const sc = await measure(pod);
      o.onProgress?.(++done, Math.max(total, done));
      if (sc !== null) {
        note(g === 1 ? 'same pod, one grade down' : `same pod, ${g} grades down`, sc, pod);
      }
      rung = next;
    }
    // and each piece downgraded on its own, so the ladder is visible per slot
    for (const id of overall.implants) {
      if (dead()) break;
      const alt = downgrade(id);
      if (alt === null) continue;
      const pod = normalizePod([alt, ...overall.implants.filter((x) => x !== id)],
        o.data, o.cybernetics).accepted;
      const sc = await measure(pod);
      o.onProgress?.(++done, Math.max(total, done));
      if (sc !== null) note(`one grade down: ${nameOf(id)} → ${nameOf(alt)}`, sc, pod);
    }
  }

  considered.sort((a, b) => b.score - a.score || (a.cost ?? 0) - (b.cost ?? 0));

  // ANNOTATE THE TIES. Eight rows all reading +13.8% looks broken; it is in
  // fact one answer wearing eight different hats, and saying so is the
  // difference between a useful list and a suspicious one. Cheapest wins the
  // name, because that is the one worth buying.
  const firstAtScore = new Map<string, string>();
  for (const cand of considered) {
    const k = cand.score.toFixed(6);
    const owner = firstAtScore.get(k);
    if (owner === undefined) firstAtScore.set(k, cand.label);
    else if (owner !== cand.label) cand.sameAs = owner;
  }

  const searched = [
    `${families.size} complete implant sets, each scored as a whole pod`,
    o.deep
      ? `plus EVERY reachable hardwiring in each free slot, on top of the best ${refineTop} sets`
      : Number.isFinite(perSlot)
        ? `plus ${perSlot} hardwirings per remaining slot`
        : 'plus EVERY reachable hardwiring in each free slot, on top of the winning set',
    'plus the winning pod one grade down, and each of its pieces downgraded singly',
    `${runs} engine runs in total`,
    'NOT searched: arbitrary mixtures of two sets, or partial sets — six slots',
    'over 837 implants is roughly a trillion combinations, and sets can annihilate',
    'each other (a High-grade Halo Omega zeroes an Amulet set), so only combinations',
    'that were actually measured are reported.',
  ].join(' ');

  // the CHEAPEST thing that still beat doing nothing — usually a fraction of
  // the winner's price for most of its gain, and the app has the price data
  // sitting right there
  let bestValue: SolveResult['bestValue'] = null;
  if (o.prices) {
    for (const cand of considered) {
      if (cand.score <= baseline) continue;
      const cost = cand.cost ?? 0;
      if (bestValue === null || cost < bestValue.cost) bestValue = { ...cand, cost };
    }
  }

  return {
    implants: overall.implants,
    score: overall.score,
    baseline,
    setName: overall.setName,
    considered: considered.slice(0, 12),
    searched,
    engineRuns: runs,
    cost: priceOf(overall.implants),
    bestValue,
  };
}
