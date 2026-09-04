// Downloads the EVEShip.fit SDE data bundle (protobuf) for the vendored
// dogma engine. The data is release-tagged by EVEShipFit/data and hosted on
// data.eveship.fit; each release tracks a CCP SDE update, so "rebuild after
// an expansion" here means: rerun this script (it always takes the LATEST
// release) and ship a new installer.
//
// Output: src/data/esf/<name>.pb2 (6 files), esf.proto (decode schema) and
// esf-version.json (which release is bundled + when it was fetched —
// staleness must be visible, RULES #3-adjacent).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outDir = path.join(root, 'src', 'data', 'esf');
mkdirSync(outDir, { recursive: true });

const UA = { 'User-Agent': 'eve-trade-conductor esf-data build (beta build)' };

// newest non-sisi release tag from EVEShipFit/data
const releases = await (
  await fetch('https://api.github.com/repos/EVEShipFit/data/releases?per_page=10', {
    headers: { ...UA, Accept: 'application/vnd.github+json' },
  })
).json();
if (!Array.isArray(releases)) throw new Error(`GitHub releases API: ${JSON.stringify(releases).slice(0, 200)}`);
const release = releases.find((r) => !r.tag_name.includes('sisi') && !r.prerelease);
if (!release) throw new Error('no stable release found');
const tag = release.tag_name;
console.log(`latest EVEShipFit/data release: ${tag} (published ${release.published_at?.slice(0, 10)})`);

const FILES = ['types', 'groups', 'marketGroups', 'typeDogma', 'dogmaEffects', 'dogmaAttributes'];
for (const name of FILES) {
  const url = `https://data.eveship.fit/${tag}/sde/${name}.pb2`;
  const res = await fetch(url, { headers: UA });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(path.join(outDir, `${name}.pb2`), buf);
  console.log(`  ${name}.pb2  ${Math.round(buf.length / 1024)} KB`);
}

// the decode schema, pinned from the same project
const protoRes = await fetch('https://raw.githubusercontent.com/EVEShipFit/data/main/esf.proto', { headers: UA });
if (!protoRes.ok) throw new Error(`esf.proto: HTTP ${protoRes.status}`);
const proto = await protoRes.text();
writeFileSync(path.join(outDir, 'esf.proto'), proto);

// DECODE-VALIDATE the bundle before it ships — a truncated download or a
// schema/data skew must fail THIS build, not the installed app at runtime
const { default: protobuf } = await import('protobufjs');
const schemaRoot = protobuf.parse(proto).root;
const types = schemaRoot
  .lookupType('esf.Types')
  .decode(new Uint8Array((await import('node:fs')).readFileSync(path.join(outDir, 'types.pb2')))).entries;
const typeCount = Object.keys(types).length;
const hasVenture = Object.values(types).some((t) => t.name === 'Venture');
if (typeCount < 20_000 || !hasVenture) {
  throw new Error(`bundle validation FAILED: ${typeCount} types, Venture ${hasVenture ? 'found' : 'MISSING'}`);
}
console.log(`bundle validated: ${typeCount} types decode cleanly (spot-check ok)`);

writeFileSync(
  path.join(outDir, 'esf-version.json'),
  JSON.stringify({ tag, publishedAt: release.published_at, fetchedAt: new Date().toISOString() }, null, 2),
);
console.log(`wrote esf-version.json (bundled data = ${tag})`);
