// SMALL NUMBER HELPERS (v0.222.0, audit C1/F4).
//
// Spreading a list into Math.min or Math.max hands every element to one call, and V8 refuses
// ~125,000 arguments (measured 2026-09-23: 100,000 ok, 125,000 RangeError). Two lists in the app
// were on course to cross that; the other forty spread sites were small but the same shape, and
// the lint rule that guards against it (eslint.config.mjs) treats every spread alike. These loops
// return exactly what the spread form returns for the same values, including for an empty list
// (Infinity / -Infinity) and for a NaN among them (NaN).
export function minOf(xs: Iterable<number>): number {
  let m = Infinity;
  for (const x of xs) { if (Number.isNaN(x)) return NaN; if (x < m) m = x; }
  return m;
}
export function maxOf(xs: Iterable<number>): number {
  let m = -Infinity;
  for (const x of xs) { if (Number.isNaN(x)) return NaN; if (x > m) m = x; }
  return m;
}
