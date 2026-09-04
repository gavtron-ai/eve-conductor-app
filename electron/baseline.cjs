// BASELINE SEEDING (v0.188) — a new install starts with the project's
// collected market/theft history instead of a cold start.
//
// The installer carries resources/baseline/ (built by scripts/
// build-baseline.mjs from an ALLOWLIST — only impersonal, publicly
// derived measurements: radar summary/coverage and the skyhook raid
// history; never wallets, orders, fits or trend events). On every launch,
// any baseline file MISSING from the user's stats folder is copied in.
// Existing files are never touched — a user's own collected history
// always wins, and the collectors append to the seeded files from day
// one, so the baseline simply becomes the oldest part of their history.
const fs = require('fs');
const path = require('path');

/**
 * @param {string} baselineDir  resources/baseline in the installed app
 * @param {string} statsDir     the user's stats folder (created if absent)
 * @returns {{seeded: string[], skipped: string[]}}
 */
function seedBaseline(baselineDir, statsDir) {
  const seeded = [];
  const skipped = [];
  let files = [];
  try {
    files = fs.readdirSync(baselineDir).filter((f) => !f.startsWith('.'));
  } catch {
    return { seeded, skipped }; // no baseline packed (dev run) — nothing to do
  }
  fs.mkdirSync(statsDir, { recursive: true });
  for (const f of files) {
    const dest = path.join(statsDir, f);
    if (fs.existsSync(dest)) {
      skipped.push(f);
      continue;
    }
    fs.copyFileSync(path.join(baselineDir, f), dest);
    seeded.push(f);
  }
  return { seeded, skipped };
}

module.exports = { seedBaseline };
