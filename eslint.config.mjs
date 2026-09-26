// LINT (v0.222.0, audit F4). Three things this exists for, in order:
//   1. the rule that would have caught the audit's C1 — `Math.min(...list)` throws past ~125,000
//      items (measured), so spreading a list into Math.min/max is an error; use lib/nums minOf/maxOf;
//   2. typescript-eslint's recommended set and the React hooks rules that find real bugs;
//   3. a single `npm run check` that tsc, lint and the fixture suite all pass before anything ships.
//
// DECISIONS, written down so nobody re-litigates them by accident:
//   · react-hooks 7 ships React-Compiler-readiness rules (set-state-in-effect, purity, refs,
//     use-memo, immutability, globals, static-components). The app does not use the compiler;
//     those rules would demand rewriting dozens of working components (Date.now() in render, refs
//     read in render, setState in effects) for no behavioural gain. Off, here, on purpose.
//     `rules-of-hooks` (an error) and `exhaustive-deps` (a warning) stay — they find real bugs.
//   · vendored code (src/vendor), compiled fixture snapshots (tests/sim, cl, pi, …) and scratch
//     files (_*) are not ours to lint.
//   · the fixture files use `cond ? pass++ : fail++` and `a && b()` on purpose.
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

const NO_SPREAD_INTO_MINMAX = {
  selector: "CallExpression[callee.object.name='Math'][callee.property.name=/^(min|max)$/] SpreadElement",
  message: 'Math.min/max(...list) throws past ~125,000 items (audit C1, measured) — use minOf/maxOf from lib/nums',
};
const UNUSED = ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' }];

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'archive/**', 'baseline/**', 'handout/**', 'node_modules/**', 'public-export/**', 'src/vendor/**', 'src/data/esf/esf.static.js', 'src/data/esf/esf.static.d.ts', 'tests/**/*.js', '_*', '**/_*'] },
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-restricted-syntax': ['error', NO_SPREAD_INTO_MINMAX],
      '@typescript-eslint/no-unused-vars': UNUSED,
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.{mjs,cjs}', 'tests/**/*.cjs'],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
      'no-restricted-syntax': ['error', NO_SPREAD_INTO_MINMAX],
      '@typescript-eslint/no-unused-vars': UNUSED,
      '@typescript-eslint/no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
    },
  },
);
