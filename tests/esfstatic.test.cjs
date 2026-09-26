// v0.224.1: the fit catalog's protobuf decoders are GENERATED at build time (src/data/esf/esf.static.js,
// from esf.proto via scripts/build-esfproto.mjs) so nothing calls Function() at run time — the page's
// Content-Security-Policy refuses eval, and the installed 0.224.0 logged twelve refusals while the
// catalog silently never loaded. This fixture proves, on the REAL shipped .pb2 files, that the static
// decoders return exactly what protobufjs' reflection decoders return: same own fields (JSON), same
// entry counts, and the same reads of every declared field (proto2 defaults live on the prototype in
// both — an absent optional must read the same either way).
const fs = require('fs');
const path = require('path');
const protobuf = require('protobufjs');

const ESF = path.join(__dirname, '..', 'src', 'data', 'esf');
let pass = 0, fail = 0;
const ok = (label, cond, detail) => { console.log(`${cond ? 'PASS' : 'FAIL'}: ${label}${cond || detail === undefined ? '' : `\n   ${detail}`}`); cond ? pass++ : fail++; };

// the module is ES6 for Vite; for node only its two wrapper lines become CommonJS — nothing else changes
const src = fs.readFileSync(path.join(ESF, 'esf.static.js'), 'utf8');
const cjs = src
  .replace('import * as $protobuf from "protobufjs/minimal";', 'const $protobuf = require("protobufjs/minimal");')
  .replace('export const esf = ', 'const esf = exports.esf = ')
  .replace('export { $root as default };', 'exports.default = $root;');
ok('the generated module has exactly the wrapper lines the shim expects (no import/export left)', !/^(import|export) /m.test(cjs));
// (code lines only — a comment may mention the pattern; the code may not use it)
const codeOnly = src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
ok('the generated module contains no runtime code generation', !/\bFunction\s*\(|\beval\s*\(|new Function|Function\.apply/.test(codeOnly));
// (a .js under tests/sim, like the compiled library — lint ignores that tree; node reads it as CommonJS)
fs.mkdirSync(path.join(__dirname, 'sim'), { recursive: true });
const shim = path.join(__dirname, 'sim', 'esf.static.shim.js');
fs.writeFileSync(shim, cjs);
const { esf } = require(shim);

const root = protobuf.parse(fs.readFileSync(path.join(ESF, 'esf.proto'), 'utf8')).root;
const FILES = [
  ['types.pb2', 'Types', 'Type'],
  ['typeDogma.pb2', 'TypeDogma', 'TypeDogmaEntry'],
  ['dogmaAttributes.pb2', 'DogmaAttributes', 'DogmaAttribute'],
  ['dogmaEffects.pb2', 'DogmaEffects', 'DogmaEffect'],
  ['groups.pb2', 'Groups', 'Group'],
  ['marketGroups.pb2', 'MarketGroups', 'MarketGroup'],
];
const decoded = {};
for (const [file, msg, entryMsg] of FILES) {
  const buf = fs.readFileSync(path.join(ESF, file));
  const a = esf[msg].decode(buf);
  const b = root.lookupType(`esf.${msg}`).decode(buf);
  const ka = Object.keys(a.entries), kb = Object.keys(b.entries);
  ok(`${file}: static and reflection decode the same number of entries (${ka.length})`, ka.length === kb.length && ka.length > 0, `${ka.length} vs ${kb.length}`);
  // VALUES, not JSON of the instances: reflection instances carry a toJSON that rewrites enums to
  // their names (and the app never calls it — the engine reads fields), so the comparison is of the
  // decoded own fields as plain data (structuredClone drops prototypes and methods)
  const plain = (x) => JSON.stringify(structuredClone(x));
  ok(`${file}: identical decoded values (own fields, recursively)`, plain(a) === plain(b));
  // every declared field of the entry message, read through the prototype defaults, agrees
  const fields = root.lookupType(`esf.${msg}.${entryMsg}`).fieldsArray.map((f) => f.name);
  let mismatches = 0, checked = 0;
  for (const k of ka.slice(0, 2000)) {
    for (const f of fields) {
      checked++;
      if (plain(a.entries[k][f]) !== plain(b.entries[k][f])) mismatches++;
    }
  }
  ok(`${file}: ${checked} declared-field reads agree (defaults for absent optionals included)`, mismatches === 0, `${mismatches} mismatches`);
  decoded[msg] = a.entries;
}

// hand-known catalog facts (the SDE: 587 = Rifter, group 25 = Frigate, category 6 = Ship)
const rifter = decoded.Types['587'];
ok('type 587 decodes as the Rifter', !!rifter && rifter.name === 'Rifter', JSON.stringify(rifter));
ok('the Rifter is in group 25 (Frigate), category 6 (Ship)', !!rifter && rifter.groupID === 25 && rifter.categoryID === 6);
ok('group 25 is named Frigate', !!decoded.Groups['25'] && decoded.Groups['25'].name === 'Frigate', JSON.stringify(decoded.Groups['25']));
ok('the Rifter carries dogma attributes and effects', Array.isArray(decoded.TypeDogma['587'].dogmaAttributes) && decoded.TypeDogma['587'].dogmaAttributes.length > 10 && decoded.TypeDogma['587'].dogmaEffects.length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
