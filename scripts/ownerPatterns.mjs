// OWNER PATTERNS LOADER — the personal-data guard's pattern list lives in
// scripts/owner-patterns.local.json, which is GITIGNORED: the list of an
// owner's secrets must never itself ship or be committed. Each entry:
//   { "label": "what it is", "pattern": "regex source", "flags": "i" }
//
// The public source release carries this MECHANISM with no patterns; every
// operator protects their own data by creating their own local file.
import fs from 'node:fs';
import path from 'node:path';

export const PATTERNS_PATH = path.join(
  path.resolve(import.meta.dirname), 'owner-patterns.local.json');

/** load the owner's pattern list; null when the file does not exist */
export function loadOwnerPatterns() {
  let raw;
  try {
    raw = fs.readFileSync(PATTERNS_PATH, 'utf8');
  } catch {
    return null;
  }
  const parsed = JSON.parse(raw); // malformed file = loud crash, never silence
  if (!Array.isArray(parsed.patterns)) throw new Error('owner-patterns.local.json: "patterns" must be an array');
  return parsed.patterns.map((p) => ({
    label: String(p.label ?? 'owner data'),
    pattern: new RegExp(p.pattern, p.flags ?? ''),
  }));
}
