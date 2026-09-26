// THE GO-LIVE RULES, AS CODE (v0.237.0, round-two P1). Two things the go-live process used to hold
// in prose, made pure so a fixture can hold them and two scripts can share them:
//
//   1. WHAT MAY LEAVE THE PRIVATE TREE — one allow list, one prune list and one never-list, used by
//      the public source export (export-public.mjs) and by the go-live check's dry run, so the check
//      can say, before anything is pushed, exactly which files would go and refuse if one of them is
//      on the never-list. LEARNINGS/ and CLAUDE.md carry the owner's working notes; baseline/ and
//      release/ carry builds; the owner-pattern file is the private list itself; compiled test
//      snapshots and logs are noise or worse; anything encrypted must not travel.
//   2. THE STAMP — golive-check.mjs writes release/golive-check-<version>.json when every check
//      passed; publish-release.mjs refuses to run without one that is for THIS version, passed,
//      younger than STAMP_MAX_AGE_MS, and made with the SAME emergency decision the publish is
//      being run with. A stamp cannot be inherited by the next version or the next day.
import fs from 'node:fs';
import path from 'node:path';

/** top-level entries of app/ that export */
export const ALLOW = new Set([
  'src', 'electron', 'scripts', 'tests', 'build', '.github', 'signing',
  'index.html', 'overlay.html', 'package.json', 'package-lock.json', 'tsconfig.json',
  'vite.config.ts', 'eslint.config.mjs', 'README.md', 'LICENSE', 'CODE_OF_CONDUCT.md',
  // eslint.config.mjs was missing until 2026-09-26: the public repo's first windows-build run failed at
  // `npm run lint` on the runner ("ESLint couldn't find an eslint.config.* file") — the local check never
  // noticed because it runs in the private tree. tests/golive.test.cjs now holds the build-critical files.
]);
/** subtrees pruned wherever they appear */
export const PRUNE = new Set([
  'node_modules', 'dist', 'release', 'handout', 'baseline', '.sde-cache',
  '.claude', 'sim', 'pi', 'led', 'r3', 'sch', 'cl', 'fx', 'mu', 'rate',   // tests/*: compiled snapshots
  'owner-patterns.local.json',
  'THIRD-PARTY-NOTICES.txt',   // generated at every build (scripts/build-notices.mjs); not a source file
]);
/** a relative path (from app/) that must never be in the export, whatever the lists above say */
export const NEVER = [
  /^LEARNINGS(\/|$)/i, /^CLAUDE\.md$/i, /(^|\/)owner-patterns\.local\.json$/i, /\.log$/i,
  /^tests\/(sim|pi|led|r3|sch|cl|fx|mu|rate)\//, /^baseline\//, /^release\//, /^handout\//, /^dist\//,
  /(^|\/)_[^/]*$/, /\.local\.[a-z]+$/i, /\.enc$/i, /^\.env/i,
];

/** every file the export would copy, as paths relative to app/ — no copying, no scanning */
export function exportFileList(appDir) {
  const out = [];
  const walk = (abs, rel) => {
    if (fs.statSync(abs).isDirectory()) {
      for (const e of fs.readdirSync(abs)) {
        if (PRUNE.has(e) || e.startsWith('_')) continue;
        walk(path.join(abs, e), rel ? `${rel}/${e}` : e);
      }
      return;
    }
    out.push(rel);
  };
  for (const e of fs.readdirSync(appDir)) {
    if (!ALLOW.has(e)) continue;
    walk(path.join(appDir, e), e);
  }
  return out.sort();
}

/** the paths in a list that break the never-list */
export const forbidden = (list) => list.filter((p) => NEVER.some((re) => re.test(p)));

/** a passing stamp is good for this long — long enough for the CI build and the signing approvals
 * (2026-09-23; was 30 minutes); what guards the tree is the HEAD the stamp records */
export const STAMP_MAX_AGE_MS = 6 * 3_600_000;

/**
 * PURE: may this publish go ahead on this stamp? `emergencyWanted` is whether the publish is being
 * run with --emergency; the stamp records the decision the check was run with, and they must agree.
 * `head` is the commit the publish sees; the stamp must have been made on the same one.
 */
export function stampVerdict(stamp, version, nowMs, emergencyWanted, head) {
  if (!stamp || typeof stamp !== 'object') return { ok: false, why: 'no go-live stamp for this version' };
  if (stamp.version !== version) return { ok: false, why: `the stamp is for v${stamp.version}, not v${version}` };
  if (stamp.passed !== true) return { ok: false, why: `the go-live check FAILED (${stamp.failed} check(s)) — fix, re-run, then publish` };
  const age = nowMs - Date.parse(stamp.at);
  if (!(age >= 0) || age > STAMP_MAX_AGE_MS) return { ok: false, why: `the stamp is ${Math.round(age / 60_000)} minutes old (limit ${STAMP_MAX_AGE_MS / 60_000}) — re-run the check` };
  if (head) {
    if (!stamp.head) return { ok: false, why: 'the stamp records no commit — re-run the check' };
    if (stamp.head !== head) return { ok: false, why: `the tree moved since the check (${String(stamp.head).slice(0, 7)} → ${String(head).slice(0, 7)}) — re-run the check` };
  }
  const stampedEmergency = typeof stamp.emergency === 'string';
  if (stampedEmergency !== emergencyWanted) return { ok: false, why: `the check was run as ${stampedEmergency ? 'an EMERGENCY' : 'ordinary'} but this publish is ${emergencyWanted ? 'an EMERGENCY' : 'ordinary'} — decide once, then run both the same way` };
  return { ok: true, why: `stamp ${stamp.at}, ${stampedEmergency ? 'emergency' : 'ordinary'}` };
}
