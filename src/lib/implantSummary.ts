// PURE: turn a character's implant list into the label a multiboxer means
// when they name a pod "* PG + Cap + Hack" — i.e. WHICH CLONE is this.
//
// WHY THIS EXISTS: ESI exposes a pod's own name only while the pilot is
// literally sitting in the capsule (capsules appear in no asset list —
// verified against 12 characters / 461 ships). Implants, by contrast, are
// always readable — and they ARE the thing the pod name was describing.

export interface ImplantInfo {
  typeId: number;
  name: string;
  /** dogma attr 331 "implantness": 1-5 = attribute implants, 6-10 = hardwirings */
  slot: number | null;
  /** grants one of the five character-attribute bonuses (dogma 175 charisma,
   * 176 intelligence, 177 memory, 178 perception, 179 willpower — verified
   * against the shipped catalog). undefined = dogma not loaded yet */
  attrBonus?: boolean;
  /** carries an `implantSet*` attribute, i.e. belongs to a named SET whose
   * pieces are worn together (Serpentis/Amulet/Christmas/…) */
  setBonus?: boolean;
}

export interface CloneSummary {
  /** matched implant SET, e.g. "Mid-grade Virtue" (empty when none) */
  setName: string;
  /** short hardwiring tags, e.g. ["Astrometric Acquisition", "Net Intrusion"] */
  hardwirings: string[];
  /** how many plain attribute implants (slots 1-5) are plugged in */
  attrCount: number;
  /** of those, how many are plain LEARNING enhancers (no set membership) */
  learningCount: number;
  /** one-line label for the overlay */
  label: string;
  /** full slot-by-slot text for the tooltip */
  detail: string;
}

/** the readable core of an implant name: drop the vendor + nickname and the
 * trailing model code ("Zainou 'Gypsy' CPU Management EE-603" → "CPU Mgmt") */
export function shortImplantName(name: string): string {
  let s = name.replace(/^[^']*'[^']*'\s*/, '');
  s = s.replace(/\s+[A-Z]{1,3}-\d{3,4}$/, '');
  s = s.replace(/\s+\d{3,4}-\d{1,3}$/, '');
  s = s.replace(/\bManagement\b/g, 'Mgmt').replace(/\bOperation\b/g, 'Op');
  return s.trim() || name;
}

/** EVE names every attribute-implant set "<High|Mid|Low>-grade NAME Greek"
 * — all 22 NAMEs verified against the shipped catalog. The SET is what the
 * pilot calls the clone: VIRTUE, SNAKE, CRYSTAL … */
const SET_RE = /^(?:High|Mid|Low)-grade\s+([A-Za-z]+)\s+(?:Alpha|Beta|Gamma|Delta|Epsilon|Omega)$/i;

function setNameOf(name: string): string | null {
  const m = SET_RE.exec(name.trim());
  return m ? m[1] : null;
}

/** the set the clone is wearing, when a majority of the attribute slots
 * agree (a lone Snake Alpha is not "a snake pod") */
function detectSet(names: string[]): string {
  const counts = new Map<string, number>();
  for (const n of names) {
    const s = setNameOf(n);
    if (s) counts.set(s.toUpperCase(), (counts.get(s.toUpperCase()) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? best[0] : '';
}

/** what a hardwiring is FOR, in the shorthand a pilot would write. Ordered:
 * the first pattern that matches wins. Anything unmatched falls back to the
 * implant's own shortened name rather than a wrong guess. */
const FOCUS: [RegExp, string][] = [
  [/power\s*grid/i, 'PG'],
  [/\bCPU\b/i, 'CPU'],
  [/capacitor/i, 'CAP'],
  [/shield/i, 'SHIELD'],
  [/armor|hull\s*upgrade/i, 'ARMOR'],
  [/astrometric|scan(ning)?\b|archaeolog|survey/i, 'SCAN'],
  [/hacking|intrusion|codebreak/i, 'HACK'],
  [/mining|astrogeolog|ice harvest|deep core/i, 'MINING'],
  [/drone/i, 'DRONE'],
  [/missile|launcher|torpedo|rocket|warhead/i, 'MISSILE'],
  [/turret|gunnery|sharpshoot|surgical|motion pred|rapid fire|trajector/i, 'GUNS'],
  [/navigation|afterburner|acceleration|evasive|velocity|agility|warp/i, 'NAV'],
  [/target|signature|sensor/i, 'TARGET'],
  [/accounting|broker|margin|trade|contract|distribution|retail|wholesale/i, 'TRADE'],
  [/industry|manufactur|research|science|laborator|metallurg/i, 'INDY'],
  [/repair|nanite|remote|logistic/i, 'LOGI'],
];

const focusOf = (name: string): string | null => FOCUS.find(([re]) => re.test(name))?.[1] ?? null;

/** implants the pilot doesn't think of as identifying the clone */
const IGNORED = /blackglass/i;

/** A LEARNING CLONE: plain attribute enhancers, nothing else. Verified from
 * the shipped catalog — exactly 29 published types qualify (the 25 in group
 * 745 "Cyber Learning", the two 'Source' special editions, and the two
 * Special Ops Field Enhancers). Deliberately EXCLUDED:
 *   · -grade set pieces (High-grade Snake Alpha gives +4 perception but the
 *     clone is a SNAKE) — caught by SET_RE and by implantSet* attributes
 *   · Mimesis, whose set bonus is NOT an implantSet* attribute, which is why
 *     the name test is kept alongside the dogma test rather than replaced
 *   · Genolution (implantSetChristmas + PG/cap bonuses) — that's a GENO pod
 * Name fallback for when the dogma catalog has not finished loading. */
const LEARNING_NAME_RE =
  /(ocular filter|memory augmentation|neural\s+(?:['’]source['’]\s+)?boost|cybernetic\s+(?:['’]source['’]\s+)?subprocessor|social adaptation chip|special ops field enhancer)/i;

function isLearningImplant(i: ImplantInfo): boolean {
  // only EXCLUDE on slot when the slot is known — an unloaded catalog must
  // not silently suppress the label
  if (i.slot !== null && (i.slot < 1 || i.slot > 5)) return false;
  if (setNameOf(i.name) !== null) return false;
  if (i.setBonus === true) return false;
  return i.attrBonus ?? LEARNING_NAME_RE.test(i.name);
}

/** how many plain attribute enhancers make a clone "a learning clone".
 * Matches detectSet's majority rule — one spare +5 memory implant riding
 * along in a combat pod must not rename it. */
const LEARNING_MIN = 3;

/** Not every set is named with EVE's "<grade> NAME Greek" pattern —
 * Genolution Core Augmentation CA-1…CA-4 fills four attribute slots and
 * would otherwise read "4 implants". Sets like that share a leading word,
 * so three or more attribute-slot implants agreeing on one names the clone.
 * Applied only AFTER the -grade and learning rules, so it can never
 * outrank them. */
function detectPrefixSet(attrLike: ImplantInfo[]): string {
  const counts = new Map<string, number>();
  for (const i of attrLike) {
    const w = /^([A-Za-z]{4,})\b/.exec(i.name.trim())?.[1];
    if (!w) continue;
    const key = w.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best && best[1] >= 3 ? best[0] : '';
}

export function summarizeClone(implants: ImplantInfo[], _fallback?: string): CloneSummary {
  // Blackglass (and anything else ignored) never names a clone
  const naming = implants.filter((i) => !IGNORED.test(i.name));
  const attrs = naming.filter((i) => (i.slot ?? 0) >= 1 && (i.slot ?? 0) <= 5);
  const hard = naming.filter((i) => (i.slot ?? 0) >= 6);

  // 1) a real SET across the attribute slots IS the clone's name: VIRTUE,
  //    SNAKE, CRYSTAL … (slot-6 Omega counts toward the same set)
  const setName = detectSet([...attrs, ...hard].map((i) => i.name));

  // 2) otherwise the clone is named for what its hardwirings DO, slot 6
  //    first — a couple of implants means "the CPU pod" / "the PG pod"
  const bySlot = [...hard].sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99));
  const focuses: string[] = [];
  for (const i of bySlot) {
    const f = focusOf(i.name);
    if (f && !focuses.includes(f)) focuses.push(f);
  }

  const hardwirings = bySlot.filter((i) => setNameOf(i.name) === null).map((i) => shortImplantName(i.name));

  // 3) a rack of plain attribute enhancers IS a learning clone, whatever
  //    else is plugged in alongside it
  const learningCount = naming.filter(isLearningImplant).length;
  // 4) a set EVE didn't name with the -grade pattern (Genolution)
  const prefixSet = detectPrefixSet(
    attrs.filter((i) => setNameOf(i.name) === null && !isLearningImplant(i)),
  );
  const tags = [
    ...(prefixSet ? [prefixSet] : []),
    ...(learningCount >= LEARNING_MIN ? ['LEARNING'] : []),
    ...focuses,
  ];

  const label = setName
    ? setName
    : tags.length > 0
      // at most two tags keeps the box readable; the tooltip has it all
      ? tags.slice(0, 2).join('+')
      : hardwirings.length > 0
        ? hardwirings[0]
        // count only implants that COULD name a clone — a pod carrying
        // nothing but an ignored implant has no name of its own
        // A BARE CLONE SAYS SO. Falling back to the character name told the
        // user nothing they did not already know, and read as if the clone
        // were named after them. Counting uses EVERY implant (Blackglass
        // included) — a clone carrying one is not empty, it is just not
        // named by it.
        : implants.length > 0
          ? `${implants.length} implant${implants.length === 1 ? '' : 's'}`
          : 'EMPTY';

  const detail = implants.length === 0
    ? 'no implants'
    : [...implants]
        .sort((a, b) => (a.slot ?? 99) - (b.slot ?? 99))
        .map((i) => `slot ${i.slot ?? '?'} · ${i.name}`)
        .join('\n');

  return { setName, hardwirings, attrCount: attrs.length, learningCount, label, detail };
}
