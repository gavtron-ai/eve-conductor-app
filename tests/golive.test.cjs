// v0.237.0 (round-two P1 + R4): the go-live rules as code, and the zKill cache.
//   goliveRules.mjs — the never-list over a hand-made path list; the export walk over a temp tree
//   that holds one of everything that must stay behind; the stamp verdict on every way a stamp can
//   be wrong (missing, another version, failed, stale, from the future, the other emergency decision).
//   zkill.cjs — cacheTtlMs on the headers zKill can send; the cache itself with a stubbed fetch:
//   a repeat asks nothing and counts as cached, a different URL asks, no-store is not kept, a
//   failed read is not kept.
const fs = require('fs');
const os = require('os');
const path = require('path');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

(async () => {
  const G = await import('../scripts/goliveRules.mjs');

  // ---- the never-list
  eq('1 never-list: the owner\'s notes, the pattern file, logs, builds, snapshots, scratch, encrypted, env',
    G.forbidden(['LEARNINGS/PLAN.md', 'CLAUDE.md', 'scripts/owner-patterns.local.json', 'x/y.log', 'tests/sim/lib/a.js', 'baseline/b.json', 'release/c.exe', 'handout/d.md', 'dist/e.js', 'src/_scratch.ts', 'scripts/k.local.json', 'tokens.enc', '.env.local']),
    ['LEARNINGS/PLAN.md', 'CLAUDE.md', 'scripts/owner-patterns.local.json', 'x/y.log', 'tests/sim/lib/a.js', 'baseline/b.json', 'release/c.exe', 'handout/d.md', 'dist/e.js', 'src/_scratch.ts', 'scripts/k.local.json', 'tokens.enc', '.env.local']);
  eq('2 never-list: the ordinary tree passes', G.forbidden(['src/lib/auth.ts', 'tests/tokenvault.test.cjs', 'electron/tokenVault.cjs', 'README.md', 'scripts/goliveRules.mjs', 'build/icon.ico']), []);

  // ---- the export walk over a temp tree
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'golive-'));
  const put = (rel) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, 'x'); };
  for (const rel of ['src/a.ts', 'src/_scratch.ts', 'tests/t.test.cjs', 'tests/sim/lib/x.js', 'tests/pi/y.json', 'electron/m.cjs', 'scripts/s.mjs', 'scripts/owner-patterns.local.json', 'README.md', 'package.json', 'LEARNINGS/x.md', 'CLAUDE.md', 'release/y.exe', 'baseline/b.json', 'dist/e.js', 'node_modules/m/i.js', 'handout/h.md', '.sde-cache/c', 'build/icon.ico']) put(rel);
  const list = G.exportFileList(tmp);
  eq('3 the export walk keeps the allow list minus the pruned subtrees and _scratch', list, ['README.md', 'build/icon.ico', 'electron/m.cjs', 'package.json', 'scripts/s.mjs', 'src/a.ts', 'tests/t.test.cjs']);
  eq('4 and nothing it keeps is on the never-list', G.forbidden(list), []);
  fs.rmSync(tmp, { recursive: true, force: true });

  // ---- the stamp verdict
  const now = Date.parse('2026-09-23T18:00:00Z');
  const stamp = (over) => ({ version: '0.237.0', at: '2026-09-23T17:50:00Z', passed: true, failed: 0, emergency: null, ordinary: true, ...over });
  eq('5 no stamp → refused', G.stampVerdict(null, '0.237.0', now, false).ok, false);
  eq('6 another version → refused', [G.stampVerdict(stamp({ version: '0.236.0' }), '0.237.0', now, false).ok, G.stampVerdict(stamp({ version: '0.236.0' }), '0.237.0', now, false).why], [false, 'the stamp is for v0.236.0, not v0.237.0']);
  eq('7 a failed check → refused', G.stampVerdict(stamp({ passed: false, failed: 2 }), '0.237.0', now, false).ok, false);
  eq('8 5 h 59 min old → ok; 6 h 1 min old → refused', [G.stampVerdict(stamp({ at: '2026-09-23T12:01:00Z' }), '0.237.0', now, false).ok, G.stampVerdict(stamp({ at: '2026-09-23T11:59:00Z' }), '0.237.0', now, false).ok], [true, false]);
  eq('8b the commit must match when one is given: same → ok, moved → refused, none recorded → refused',
    [G.stampVerdict(stamp({ head: 'abc1234def' }), '0.237.0', now, false, 'abc1234def').ok, G.stampVerdict(stamp({ head: 'abc1234def' }), '0.237.0', now, false, 'fff9999000').why, G.stampVerdict(stamp(), '0.237.0', now, false, 'abc1234def').ok],
    [true, 'the tree moved since the check (abc1234 → fff9999) — re-run the check', false]);
  eq('9 a stamp from the future → refused', G.stampVerdict(stamp({ at: '2026-09-23T18:05:00Z' }), '0.237.0', now, false).ok, false);
  eq('10 ordinary stamp, emergency publish → refused; and the other way', [G.stampVerdict(stamp(), '0.237.0', now, true).ok, G.stampVerdict(stamp({ emergency: 'harming a partner', ordinary: false }), '0.237.0', now, false).ok], [false, false]);
  eq('11 emergency stamp, emergency publish → ok, and says so', G.stampVerdict(stamp({ emergency: 'harming a partner', ordinary: false }), '0.237.0', now, true), { ok: true, why: 'stamp 2026-09-23T17:50:00Z, emergency' });
  eq('12 the limit is 6 hours (a CI build and two signing approvals fit; the commit check guards the tree)', G.STAMP_MAX_AGE_MS, 21_600_000);

  // ---- the zKill cache
  const Z = require('../electron/zkill.cjs');
  eq('13 cacheTtlMs: no header → the hour; max-age honoured; no-store / no-cache / max-age=0 → not kept; a huge max-age capped at a day',
    [Z.cacheTtlMs(null), Z.cacheTtlMs('public, max-age=3600'), Z.cacheTtlMs('max-age=120, public'), Z.cacheTtlMs('no-store'), Z.cacheTtlMs('private, no-cache'), Z.cacheTtlMs('max-age=0'), Z.cacheTtlMs('max-age=999999')],
    [3_600_000, 3_600_000, 120_000, 0, 0, 0, 86_400_000]);
  const log = [];
  let mode = 'cached';
  global.fetch = async (url) => {
    log.push(String(url));
    if (mode === 'throw') throw new Error('offline');
    const cc = mode === 'nostore' ? 'no-store' : 'public, max-age=3600';
    return { status: 200, ok: true, headers: { get: (h) => (h === 'cache-control' ? cc : null) }, json: async () => [{ killmail_id: 7, zkb: { hash: 'h', totalValue: 5 }, killmail_time: '2026-09-23T10:00:00Z', victim: { character_id: 1 } }] };
  };
  const a = await Z.corpRecent(98000001, 'kills');
  const b = await Z.corpRecent(98000001, 'kills');
  const c = await Z.corpKillmails(98000001, 1); // the same kills URL (cached) + the losses URL (asked)
  eq('14 a repeat within the hour asks nothing and counts as cached; a different URL asks', [log.length, Z.zkillMeter().count, Z.zkillMeter().cached, a.n, b.n, c.kills.length, c.losses.length], [2, 2, 2, 1, 1, 1, 1]);
  const queued = await Promise.all([Z.charKillmails(1001), Z.charKillmails(1001)]); // two calls queued at once for one URL
  eq('15 two calls queued together for one URL ask once', [log.length, queued[0].length, queued[1].length, Z.zkillMeter().cached], [3, 1, 1, 3]);
  mode = 'nostore';
  await Z.systemKills(30000142, 3600);
  await Z.systemKills(30000142, 3600);
  eq('16 an answer marked no-store is not kept — the repeat asks again', log.length, 5);
  mode = 'throw';
  const f1 = await Z.corpRecent(98000002, 'losses');
  const f2 = await Z.corpRecent(98000002, 'losses');
  eq('17 a failed read is not kept — the repeat asks again, and both report the failure', [log.length, f1.ok, f2.ok], [7, false, false]);
  eq('18 the cache holds what it kept', Z.cacheStats().entries, 3);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})().catch((e) => { console.log('FAIL: fixture died: ' + (e && e.stack || e)); console.log(`\n${pass} passed, ${fail + 1} failed`); process.exit(1); });
