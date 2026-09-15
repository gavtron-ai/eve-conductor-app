// Rebuilds scripts/npc-bounties.json — NPC name → kill bounty — from CCP's
// static data export (public: https://developers.eveonline.com/docs/services/sde/).
//
//   node scripts/sde-bounties.cjs <path to sde.zip>
//
// Reads fsd/types.yaml (id → English name) and fsd/typeDogma.yaml
// (attribute 481 = entityKillBounty) with a line scanner — the files are
// 150 MB and 26 MB, a YAML parser is not needed. The export indents with
// two spaces. Several type ids can share a display name (variants); the
// highest bounty is kept under the name. Used by scripts/build-kspace.cjs.
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yauzl = require('yauzl');

const zipPath = process.argv[2];
if (!zipPath || !fs.existsSync(zipPath)) { console.error('usage: node scripts/sde-bounties.cjs <sde.zip>'); process.exit(2); }
const tmp = path.join(require('os').tmpdir(), 'eve-conductor-sde');
fs.mkdirSync(tmp, { recursive: true });

function extract(entryEnds, outName) {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      let found = false;
      zip.readEntry();
      zip.on('entry', (entry) => {
        if (entry.fileName.endsWith(entryEnds)) {
          found = true;
          zip.openReadStream(entry, (e, stream) => {
            if (e) return reject(e);
            const out = fs.createWriteStream(path.join(tmp, outName));
            stream.pipe(out);
            out.on('finish', () => { zip.close(); resolve(entry.fileName); });
          });
        } else zip.readEntry();
      });
      zip.on('end', () => { if (!found) reject(new Error(`no entry ${entryEnds}`)); });
    });
  });
}

async function scanTypes(file) {
  const names = new Map();
  let cur = null, inName = false;
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const m = /^(\d+):\s*$/.exec(line);
    if (m) { cur = { id: Number(m[1]), name: '' }; names.set(cur.id, cur); inName = false; continue; }
    if (!cur) continue;
    if (/^ {2,4}name:\s*$/.test(line)) { inName = true; continue; }
    if (inName) {
      const en = /^ {4,8}en:\s*(.*)$/.exec(line);
      if (en) { cur.name = en[1].trim().replace(/^['"]|['"]$/g, ''); continue; }
      if (!/^ {4,}/.test(line)) inName = false;
    }
  }
  return names;
}

async function scanDogma(file) {
  const bounty = new Map();
  let cur = 0, attr = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) {
    const m = /^(\d+):\s*$/.exec(line);
    if (m) { cur = Number(m[1]); attr = 0; continue; }
    const a = /^\s*-\s+attributeID:\s*(\d+)/.exec(line);
    if (a) { attr = Number(a[1]); continue; }
    const v = /^\s+value:\s*([\d.eE+-]+)/.exec(line);
    if (v && attr === 481) { bounty.set(cur, Number(v[1])); attr = 0; }
  }
  return bounty;
}

(async () => {
  console.log('types:', await extract('fsd/types.yaml', 'types.yaml'));
  console.log('dogma:', await extract('fsd/typeDogma.yaml', 'typeDogma.yaml'));
  const names = await scanTypes(path.join(tmp, 'types.yaml'));
  const bounty = await scanDogma(path.join(tmp, 'typeDogma.yaml'));
  const out = {};
  for (const [id, isk] of bounty) {
    const t = names.get(id);
    if (!t || !t.name || isk <= 0) continue;
    if (!out[t.name] || out[t.name].isk < isk) out[t.name] = { id, isk };
  }
  fs.writeFileSync(path.join(__dirname, 'npc-bounties.json'), JSON.stringify(out));
  console.log(`npc-bounties.json: ${Object.keys(out).length} names with a bounty (types ${names.size}, bounty attributes ${bounty.size})`);
})().catch((e) => { console.error(e); process.exit(1); });
