// v0.236.0 (round-two R2): private names stay out of what leaves the machine. Fixtures on the SHIPPED
// lib/redact.ts (compiled to sim/lib): the anonymous handle by team order, and the bug-report
// redaction — every known character's name (case-insensitive, longest first) and id replaced,
// nothing else touched. The names here are invented; the rule is what is tested.
const { pilotHandle, redactCharacters } = require('./sim/lib/redact.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const team = [
  { characterId: 90000001, characterName: 'Ada Lovelace' },
  { characterId: 90000002, characterName: 'Ada Lovelace Jr' },   // contains the first name — must be replaced whole
  { characterId: 90000003, characterName: "O'Brien (Alt)" },     // regex-special characters in a name
];

eq('1 handles follow team order; an unknown id is "pilot ?"', [pilotHandle(team, 90000002), pilotHandle(team, 90000001), pilotHandle(team, 1)], ['pilot #2', 'pilot #1', 'pilot ?']);
eq('2 a log line naming the second character is redacted whole (not as "pilot #1 Jr")', redactCharacters('pi · Ada Lovelace Jr: could not read the planet list', team), 'pi · pilot #2: could not read the planet list');
eq('3 case does not matter', redactCharacters('alert raised: ADA LOVELACE rateDown', team), 'alert raised: pilot #1 rateDown');
eq('4 the id is replaced as a whole number only', redactCharacters('ESI 504 on /characters/90000001/planets/ and 190000001 and 900000011', team), 'ESI 504 on /characters/pilot #1/planets/ and 190000001 and 900000011');
eq('5 a name with regex characters', redactCharacters("O'Brien (Alt) undocked", team), 'pilot #3 undocked');
eq('6 everything else is untouched', redactCharacters('radar: sweep done {regions: 2, pages: 593}', team), 'radar: sweep done {regions: 2, pages: 593}');
eq('7 an empty team changes nothing', redactCharacters('Ada Lovelace', []), 'Ada Lovelace');
eq('8 a very short name is not replaced (it would eat ordinary words)', redactCharacters('a b ab', [{ characterId: 5, characterName: 'ab' }]), 'a b ab');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
