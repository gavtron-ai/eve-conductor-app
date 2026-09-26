// PRIVATE NAMES STAY OUT OF THE LOG (v0.236.0, round-two R2). The diagnostics log is meant to be
// pasted into a bug report; a pilot's character names and ids are theirs. Log lines that must
// point at a character use a stable anonymous handle ("pilot #3": the character's position in the
// team list), and the share export replaces every logged-in character's name and id anyway — the
// belt under the braces, for lines written by older versions or by paths not yet converted.

export interface KnownPilot { characterId: number; characterName: string }

/** "pilot #n" by team order; "pilot ?" for an id the team does not hold */
export function pilotHandle(chars: readonly { characterId: number }[], charId: number): string {
  const i = chars.findIndex((c) => c.characterId === charId);
  return i >= 0 ? `pilot #${i + 1}` : 'pilot ?';
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** every known character's name (case-insensitive, longest first so a name that contains another
 * is replaced whole) and id are replaced by the handle; nothing else in the text is touched */
export function redactCharacters(text: string, chars: readonly KnownPilot[]): string {
  let out = text;
  const byLength = [...chars].map((c, i) => ({ ...c, handle: `pilot #${i + 1}` })).sort((a, b) => b.characterName.length - a.characterName.length);
  for (const c of byLength) {
    if (c.characterName.trim().length >= 3) out = out.replace(new RegExp(escapeRe(c.characterName), 'gi'), c.handle);
    if (c.characterId > 0) out = out.replace(new RegExp(`(?<![0-9])${c.characterId}(?![0-9])`, 'g'), c.handle);
  }
  return out;
}
