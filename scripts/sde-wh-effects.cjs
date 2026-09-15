// Builds, from CCP's static data export (public):
//   src/data/whSystems.json    — every wormhole system's class and effect
//   src/data/whEffectMods.json — every effect's modifiers per class, as the
//                                game applies them (the effect BEACON's
//                                dogma attributes)
//
//   node scripts/sde-wh-effects.cjs <path to sde.zip>
//
// universe/wormhole/<region>/region.yaml carries wormholeClassID (1–6 for
// C1–C6, 13 shattered, 14–18 drifter, 25 Thera…); each system folder's
// solarsystem.yaml carries secondarySun.typeID and effectBeaconTypeID when
// the system has an effect. The beacon types are named "Class 3 Wolf
// Rayet Effects" and their typeDogma attributes are multipliers
// (1.3 = +30 %, 0.85 = −15 %) or resistance bonuses (15 = +15 points).
// The J-code is the folder name. ~2,600 systems; 36 beacons.
const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');

const zipPath = process.argv[2];
if (!zipPath || !fs.existsSync(zipPath)) { console.error('usage: node scripts/sde-wh-effects.cjs <sde.zip>'); process.exit(2); }

const readEntry = (zip, entry) => new Promise((resolve, reject) => {
  zip.openReadStream(entry, (e, s) => { if (e) return reject(e); let buf = ''; s.on('data', (d) => { buf += d; }); s.on('end', () => resolve(buf)); s.on('error', reject); });
});

function scanTypeNames(text) {
  const names = new Map();
  let cur = 0, inName = false;
  for (const line of text.split('\n')) {
    const m = /^(\d+):\s*$/.exec(line);
    if (m) { cur = Number(m[1]); inName = false; continue; }
    if (/^ {2,4}name:\s*$/.test(line)) { inName = true; continue; }
    if (inName) {
      const en = /^ {4,8}en:\s*(.*)$/.exec(line);
      if (en) { names.set(cur, en[1].trim().replace(/^['"]|['"]$/g, '')); inName = false; continue; }
      if (!/^ {4,}/.test(line)) inName = false;
    }
  }
  return names;
}

/** attribute name per id from fsd/dogmaAttributes.yaml */
function scanAttrNames(text) {
  const names = new Map();
  let cur = 0;
  for (const line of text.split('\n')) {
    const m = /^(\d+):\s*$/.exec(line);
    if (m) { cur = Number(m[1]); continue; }
    const n = /^ {2}name:\s*(.*)$/.exec(line);
    if (n) names.set(cur, n[1].trim());
  }
  return names;
}

/** dogma attributes for the wanted type ids from fsd/typeDogma.yaml */
function scanDogma(text, want) {
  const out = new Map();
  let cur = 0, attr = 0;
  for (const line of text.split('\n')) {
    const m = /^(\d+):\s*$/.exec(line);
    if (m) { cur = Number(m[1]); attr = 0; continue; }
    if (!want.has(cur)) continue;
    const a = /^\s*-\s+attributeID:\s*(\d+)/.exec(line);
    if (a) { attr = Number(a[1]); continue; }
    const v = /^\s+value:\s*([\d.eE+-]+)/.exec(line);
    if (v && attr) { if (!out.has(cur)) out.set(cur, []); out.get(cur).push({ attr, value: Number(v[1]) }); attr = 0; }
  }
  return out;
}

const normEffect = (name) => {
  const n = String(name || '');
  if (/black\s*hole/i.test(n)) return 'Black Hole';
  if (/cataclysmic/i.test(n)) return 'Cataclysmic Variable';
  if (/magnetar/i.test(n)) return 'Magnetar';
  if (/pulsar/i.test(n)) return 'Pulsar';
  if (/red\s*giant/i.test(n)) return 'Red Giant';
  if (/wolf/i.test(n)) return 'Wolf-Rayet';
  return '';
};

/** what each beacon attribute means to a pilot, and how to read its value */
const ATTR = {
  shieldCapacityMultiplier: ['Shield HP', 'mult'],
  armorHPMultiplier: ['Armor HP', 'mult'],
  signatureRadiusMultiplier: ['Signature radius', 'mult'],
  armorEmDamageResistanceBonus: ['Armor resistances', 'resist'], armorKineticDamageResistanceBonus: ['Armor resistances', 'resist'],
  armorThermalDamageResistanceBonus: ['Armor resistances', 'resist'], armorExplosiveDamageResistanceBonus: ['Armor resistances', 'resist'],
  shieldEmDamageResistanceBonus: ['Shield resistances', 'resist'], shieldKineticDamageResistanceBonus: ['Shield resistances', 'resist'],
  shieldThermalDamageResistanceBonus: ['Shield resistances', 'resist'], shieldExplosiveDamageResistanceBonus: ['Shield resistances', 'resist'],
  rechargeRateMultiplier: ['Capacitor recharge time', 'mult'],
  energyWarfareStrengthMultiplier: ['Neut / nos strength', 'mult'],
  agilityMultiplier: ['Inertia (align time)', 'mult'],
  maxTargetRangeMultiplier: ['Targeting range', 'mult'],
  missileVelocityMultiplier: ['Missile velocity', 'mult'],
  maxVelocityMultiplier: ['Ship velocity', 'mult'],
  aoeVelocityMultiplier: ['Missile explosion velocity', 'mult'],
  stasisWebStrengthMultiplier: ['Stasis web strength', 'mult'],
  armorDamageAmountMultiplier: ['Local armor repair', 'mult'],
  shieldBonusMultiplier: ['Local shield boost', 'mult'],
  shieldBonusMultiplierRemote: ['Remote shield boost', 'mult'],
  armorDamageAmountMultiplierRemote: ['Remote armor repair', 'mult'],
  capacitorCapacityMultiplierSystem: ['Capacitor capacity', 'mult'],
  energyTransferAmountBonus: ['Remote capacitor transfer', 'mult'],
  trackingSpeedMultiplier: ['Turret tracking', 'mult'],
  damageMultiplierMultiplier: ['Weapon damage', 'mult'],
  aoeCloudSizeMultiplier: ['Missile explosion radius', 'mult'],
  targetPainterStrengthMultiplier: ['Target painter strength', 'mult'],
  heatDamageMultiplier: ['Heat damage', 'mult'],
  overloadBonusMultiplier: ['Overheat bonus', 'mult'],
  empFieldRangeMultiplier: ['Smartbomb range', 'mult'],
  smartbombDamageMultiplier: ['Smartbomb damage', 'mult'],
  smallWeaponDamageMultiplier: ['Small weapon damage', 'mult'],
};
const fmt = (kind, v) => {
  if (kind === 'resist') return `+${Math.round(v)}%`;
  const pct = Math.round((v - 1) * 100);
  return `${pct >= 0 ? '+' : '−'}${Math.abs(pct)}%`;
};

(async () => {
  const regionClass = new Map();
  const systems = new Map();       // J-code → { region, sunType, beacon }
  let typesText = '', dogmaText = '', attrText = '';
  await new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zip) => {
      if (err) return reject(err);
      zip.readEntry();
      zip.on('entry', async (entry) => {
        try {
          const f = entry.fileName;
          if (f.endsWith('fsd/types.yaml')) typesText = await readEntry(zip, entry);
          else if (f.endsWith('fsd/typeDogma.yaml')) dogmaText = await readEntry(zip, entry);
          else if (f.endsWith('fsd/dogmaAttributes.yaml')) attrText = await readEntry(zip, entry);
          else if (/universe\/wormhole\/[^/]+\/region\.yaml$/.test(f)) {
            const t = await readEntry(zip, entry);
            const m = /wormholeClassID:\s*(\d+)/.exec(t);
            regionClass.set(f.split('/')[2], m ? Number(m[1]) : 0);
          } else if (/universe\/wormhole\/[^/]+\/[^/]+\/[^/]+\/solarsystem\.yaml$/.test(f)) {
            const t = await readEntry(zip, entry);
            const parts = f.split('/');
            const sun = /secondarySun:[\s\S]*?typeID:\s*(\d+)/.exec(t);
            const beacon = /effectBeaconTypeID:\s*(\d+)/.exec(t);
            // SHATTERED (v0.201.7): every planet is the shattered planet
            // type 30889 — 108 systems: the 75 shattered wormholes, the 25
            // small-ship (C13) ones, Thera and its neighbours
            const shattered = /typeID:\s*30889\b/.test(t);
            systems.set(parts[4], { region: parts[2], sunType: sun ? Number(sun[1]) : 0, beacon: beacon ? Number(beacon[1]) : 0, shattered });
          }
          zip.readEntry();
        } catch (e) { reject(e); }
      });
      zip.on('end', resolve);
      zip.on('error', reject);
    });
  });
  const names = scanTypeNames(typesText);
  const attrNames = scanAttrNames(attrText);
  const beaconIds = new Set([...systems.values()].map((s) => s.beacon).filter(Boolean));
  const dogma = scanDogma(dogmaText, beaconIds);

  // systems
  const out = {};
  const effectCounts = {};
  for (const [j, s] of systems) {
    const clsId = regionClass.get(s.region) ?? 0;
    const cls = clsId >= 1 && clsId <= 6 ? `C${clsId}` : clsId === 13 ? 'C13' : clsId >= 14 && clsId <= 18 ? 'Drifter' : clsId === 25 ? 'Thera' : clsId ? `class${clsId}` : '';
    const effect = s.sunType ? normEffect(names.get(s.sunType)) : '';
    if (s.sunType && !effect) console.warn('unrecognised sun type', s.sunType, names.get(s.sunType), 'in', j);
    out[j] = { cls, ...(effect ? { effect } : {}), ...(s.shattered ? { shattered: true } : {}) };
    effectCounts[effect || '(none)'] = (effectCounts[effect || '(none)'] || 0) + 1;
  }
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'whSystems.json'), JSON.stringify(out));
  const shatteredN = Object.values(out).filter((s) => s.shattered).length;
  console.log(`whSystems.json: ${Object.keys(out).length} systems; regions ${regionClass.size}; shattered ${shatteredN}; effects`, effectCounts);

  // modifiers per effect and class, from the beacons: "Class 3 Wolf Rayet Effects"
  const mods = {};
  const unknownAttrs = new Set();
  for (const id of beaconIds) {
    const name = names.get(id) || '';
    const m = /^Class (\d) (.+?) Effects$/.exec(name);
    if (!m) { console.warn('beacon name not understood', id, name); continue; }
    const cls = `C${m[1]}`, effect = normEffect(m[2]);
    const rows = [];
    const grouped = new Map();
    for (const d of dogma.get(id) || []) {
      const an = attrNames.get(d.attr) || String(d.attr);
      const meta = ATTR[an];
      if (!meta) { unknownAttrs.add(an); rows.push({ label: an, value: String(d.value) }); continue; }
      const [label, kind] = meta;
      const key = label;
      const g = grouped.get(key) ?? { label, kind, values: [] };
      g.values.push(d.value);
      grouped.set(key, g);
    }
    for (const g of grouped.values()) {
      const same = g.values.every((v) => v === g.values[0]);
      rows.push({ label: g.label, value: same ? fmt(g.kind, g.values[0]) : g.values.map((v) => fmt(g.kind, v)).join(' / ') });
    }
    if (!mods[effect]) mods[effect] = {};
    mods[effect][cls] = rows;
  }
  fs.writeFileSync(path.join(__dirname, '..', 'src', 'data', 'whEffectMods.json'), `${JSON.stringify(mods, null, 1)}\n`);
  const combos = Object.values(mods).reduce((n, byCls) => n + Object.keys(byCls).length, 0);
  console.log(`whEffectMods.json: ${Object.keys(mods).length} effects, ${combos} class combinations${unknownAttrs.size ? `; attributes without a label: ${[...unknownAttrs].join(', ')}` : ''}`);
})().catch((e) => { console.error(e); process.exit(1); });
