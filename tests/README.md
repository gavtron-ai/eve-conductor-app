# The fixture suite — 1218 hand-computed tests across 41 files

Every expected value in these files was computed BY HAND (or is explicitly
labelled a model-internal regression pin) before the code ran. They are the
correctness floor of the Battle Sim and its libraries. `events3d.test.cjs`
is the true-3D motion suite (v0.93.0), including the owner's
Hyena/Guardian/Tengu oscillation scenario.

These files were born in a session scratchpad and moved here in v0.93.0 so
they survive temp-dir cleanup. The copies in any old scratchpad are
superseded by these.

## Running

The tests require the sim compiled to CommonJS in `sim/` NEXT TO the test
files (they `require('./sim/lib/...')`). From `app/`:

```bash
npx tsc src/lib/*.ts --outDir tests/sim --module commonjs --target es2020 \
  --skipLibCheck --moduleResolution node --resolveJsonModule --esModuleInterop
```

(vite-only files — devHooks, dogmaStats, dogmaClient — print errors about
`import.meta`/`?url` imports; that is expected and harmless, the pure sim
libraries still emit.)

Then, from this directory:

```bash
for f in *.test.cjs; do node "$f" | tail -1; done
```

Some files also read `sim/data/typedb.json` (engine-extracted type data) —
if a test complains, copy that from the previous compile's output or rebuild
it with the probe scripts described in LEARNINGS/API-NOTES.md.
