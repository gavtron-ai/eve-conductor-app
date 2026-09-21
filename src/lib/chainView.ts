// A SAVED Σ SUMMARY VIEW (v0.206.0) — "log in, mine only gneiss in the C3 part
// of the chain". PURE.
//
// THE RULE: SAVE INTENT, NOT IDENTITY. A wormhole chain rerolls every day, so
// a view that remembered "J113143" would be dead tomorrow. The part of the
// chain is saved as the CLASS of the system directly off the origin ("C3",
// "HS", "NS") — the letter the map adds (C3A, C3B) is the order it was found
// in, not a property of the hole, so it is not saved. Re-applied, the view
// picks EVERY branch of that class that exists today, and says which saved
// classes have no branch right now instead of silently showing the whole chain
// as if it had worked. Rocks, classes and activities are stable names already.
import type { ChainBranch, SigGroup } from './chain';

export const CHAIN_VIEW_KIND = 'chain-summary';

export interface ChainViewState {
  origin: 'home' | 'me';
  maxHops: number | null;
  classes: string[];
  groups: SigGroup[];
  maxAgeH: number | null;
  rocks: string[];
  linkedOnly: boolean;
  /** the classes of the first systems off the origin, e.g. ['C3'] */
  branchClasses: string[];
}

const GROUPS: SigGroup[] = ['Combat', 'Ore', 'Gas', 'Relic', 'Data'];
const CLASS_ORDER = ['C1', 'C2', 'C3', 'C4', 'C5', 'C6', 'C13', 'HS', 'LS', 'NS', 'P'];
const byOrder = (order: readonly string[]) => (a: string, b: string) => {
  const ia = order.indexOf(a), ib = order.indexOf(b);
  return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
};

/** the picked branches → the classes they stand for (a branch whose class the map does not show cannot be saved) */
export function branchClassesOf(picked: ReadonlySet<string>, clsOf: ReadonlyMap<string, string>): string[] {
  const out = new Set<string>();
  for (const first of picked) { const c = clsOf.get(first) ?? ''; if (c) out.add(c); }
  return [...out].sort(byOrder(CLASS_ORDER));
}

export interface ResolvedBranches {
  /** today's first-hop systems of the saved classes */
  picked: Set<string>;
  /** saved classes with no branch off the origin right now */
  missing: string[];
}
export function resolveBranchClasses(classes: readonly string[], branches: readonly ChainBranch[], clsOf: ReadonlyMap<string, string>): ResolvedBranches {
  const picked = new Set<string>(); const missing: string[] = [];
  for (const c of classes) {
    const hits = branches.filter((b) => (clsOf.get(b.first) ?? '') === c);
    if (hits.length === 0) missing.push(c); else for (const h of hits) picked.add(h.first);
  }
  return { picked, missing };
}

/** "Gneiss · C3 branch · ≤ 3 jumps" — what the favorite's chip says after the tab's name */
export function describeChainView(v: ChainViewState): string {
  const bits: string[] = [];
  if (v.rocks.length > 0) bits.push(v.rocks.join(' + '));
  if (v.groups.length > 0 && !(v.rocks.length > 0 && v.groups.length === 1 && v.groups[0] === 'Ore')) bits.push(v.groups.join(' + '));
  if (v.branchClasses.length > 0) bits.push(`${v.branchClasses.join(' + ')} branch${v.branchClasses.length === 1 ? '' : 'es'}`);
  if (v.classes.length > 0) bits.push(`in ${v.classes.join('/')}`);
  if (v.maxHops !== null) bits.push(`≤ ${v.maxHops} jump${v.maxHops === 1 ? '' : 's'}`);
  if (v.maxAgeH !== null) bits.push(`≤ ${v.maxAgeH} h old`);
  if (v.origin === 'me') bits.push('from me');
  return bits.length > 0 ? bits.join(' · ') : 'everything';
}

/** nothing narrowed — not worth saving as a view (the plain tab can be pinned instead) */
export const isPlainChainView = (v: ChainViewState): boolean =>
  v.maxHops === null && v.classes.length === 0 && v.groups.length === 0 && v.maxAgeH === null && v.rocks.length === 0 && v.branchClasses.length === 0 && v.origin === 'home';

/** whatever was stored → a valid view (a hand-edited or older blob must not break the tab) */
export function sanitizeChainView(raw: unknown): ChainViewState {
  const r = (raw ?? {}) as Partial<Record<keyof ChainViewState, unknown>>;
  const strs = (x: unknown): string[] => (Array.isArray(x) ? [...new Set(x.filter((s): s is string => typeof s === 'string' && s.length > 0 && s.length < 40))] : []);
  const num = (x: unknown, lo: number, hi: number): number | null => (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi ? x : null);
  return {
    origin: r.origin === 'me' ? 'me' : 'home',
    maxHops: num(r.maxHops, 0, 20),
    classes: strs(r.classes).filter((c) => CLASS_ORDER.includes(c)).sort(byOrder(CLASS_ORDER)),
    groups: strs(r.groups).filter((g): g is SigGroup => (GROUPS as string[]).includes(g)),
    maxAgeH: num(r.maxAgeH, 0, 24 * 30),
    rocks: strs(r.rocks).sort(),
    linkedOnly: r.linkedOnly === true,
    branchClasses: strs(r.branchClasses).filter((c) => CLASS_ORDER.includes(c)).sort(byOrder(CLASS_ORDER)),
  };
}
