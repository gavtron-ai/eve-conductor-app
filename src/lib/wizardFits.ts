// FIT WIZARD data model + pure helpers. Fits live APP-SIDE (persisted
// store), so a fit can carry unlimited spare/variant modules — the in-game
// fitting service can't. A WizardFit = named fit + REQUIRED-named
// variations; each variation is a full loadout (fork-on-create from the
// one you're looking at).
//
// lock is stored per slot for W2's "Make It Work":
//   'hard' = keep exactly this module; 'soft' = keep this KIND of module
//   (the optimizer may swap variants); unset = free slot, fully ideated.
import { toEft, typeNameOf, type RawFitItem } from './fitSerial';
import { allocateDrones, type EsfDataShapes, type EsfFitShape } from './dogmaFit';
import { implantSlot } from './implants';

/** module run state, cycled in the UI like the game: offline → online →
 * active → overloaded (shift-click walks it backwards). Undefined = the
 * default for that rack (rigs/subsystems are always passive). */
export type SlotState = 'offline' | 'online' | 'active' | 'overload';

export interface WizardSlot {
  typeId: number | null;
  chargeTypeId?: number;
  lock?: 'hard' | 'soft';
  state?: SlotState;
}

export interface WizardQty {
  typeId: number;
  qty: number;
}

export interface WizardVariation {
  id: string;
  name: string;
  high: WizardSlot[];
  med: WizardSlot[];
  low: WizardSlot[];
  rig: WizardSlot[];
  sub: WizardSlot[];
  drones: WizardQty[];
  cargo: WizardQty[];
}

export interface WizardFit {
  id: string;
  name: string;
  hullId: number;
  variations: WizardVariation[];
  /** the POD this fit is evaluated in (v0.193): ten entries, slot 1–10,
   * null = empty slot. undefined = no custom pod — stats use each selected
   * character's own implants, exactly as before the pod picker existed.
   * A pod attached to a fit TRAVELS WITH IT: its implants ride in cargo on
   * every copy (EFT, buy list) and every save to a character (v0.194). */
  implants?: (number | null)[];
  /** the saved pod these implants came from (pod library, v0.194) — a
   * bookkeeping link so the UI can offer "update saved pod"; the implants
   * array above is always the truth the engine and exports use */
  podId?: string;
}

/** a named pod in the app's pod library (v0.194) — saved SEPARATELY from
 * fits so one pod can be sat in by many fits */
export interface SavedPod {
  id: string;
  name: string;
  slots: (number | null)[];
}

/** the implants a fit carries, as cargo-ready type ids (nulls dropped) */
export const fitImplants = (fit: WizardFit): number[] =>
  (fit.implants ?? []).filter((x): x is number => x !== null);

export const RACKS = ['high', 'med', 'low', 'rig', 'sub'] as const;
export type Rack = (typeof RACKS)[number];

export const RACK_LABEL: Record<Rack, string> = {
  high: 'High', med: 'Mid', low: 'Low', rig: 'Rig', sub: 'Subsystem',
};

/** hull slot counts, straight from the hull's dogma (ids verified against
 * the bundled data: hiSlots 14, medSlots 13, lowSlots 12, rigSlots 1137,
 * maxSubSystems 1367) */
const RACK_ATTR: Record<Rack, number> = { high: 14, med: 13, low: 12, rig: 1137, sub: 1367 };

/**
 * TECH III STRATEGIC CRUISERS HAVE NO SLOTS OF THEIR OWN.
 *
 * Loki, Tengu, Legion and Proteus all publish hiSlots=0, medSlots=0,
 * lowSlots=0 — verified by decoding the bundled typeDogma for 29990 / 29984 /
 * 29986 / 29988. Every slot they fly with comes from the SUBSYSTEMS fitted
 * into them, via hiSlotModifier / medSlotModifier / lowSlotModifier. Reading
 * the hull alone therefore gave a T3 an empty fitting window in the wizard.
 *
 * That makes rack sizes a property of the VARIATION, not of the hull: change
 * a subsystem and the racks resize, exactly as in game.
 */
const RACK_MOD_ATTR: Partial<Record<Rack, number>> = { high: 1374, med: 1375, low: 1376 };

const attrOf = (typeId: number | null, attrId: number, data: EsfDataShapes): number => {
  if (typeId === null) return 0;
  return data.typeDogma[typeId]?.dogmaAttributes?.find((a) => a.attributeID === attrId)?.value ?? 0;
};

/**
 * Rack sizes for a hull, plus whatever the fitted subsystems add. Pass the
 * variation's `sub` rack; omit it for a brand-new fit, where a T3 genuinely
 * has nothing yet (the racks fill in as subsystems are chosen).
 */
export function rackSizes(
  hullId: number,
  data: EsfDataShapes,
  subSlots: readonly WizardSlot[] = [],
): Record<Rack, number> {
  const attrs = data.typeDogma[hullId]?.dogmaAttributes ?? [];
  const out = {} as Record<Rack, number>;
  for (const r of RACKS) {
    const base = Math.round(attrs.find((a) => a.attributeID === RACK_ATTR[r])?.value ?? 0);
    const modAttr = RACK_MOD_ATTR[r];
    const fromSubs = modAttr === undefined
      ? 0
      : subSlots.reduce((n, sl) => n + Math.round(attrOf(sl.typeId, modAttr, data)), 0);
    out[r] = Math.max(0, base + fromSubs);
  }
  return out;
}

/** which rack a module type goes into, from ITS OWN fitting effect
 * (11 loPower / 12 hiPower / 13 medPower / 2663 rigSlot / 3772 subSystem) */
export function rackForModule(typeId: number, data: EsfDataShapes): Rack | null {
  const effects = data.typeDogma[typeId]?.dogmaEffects ?? [];
  for (const e of effects) {
    if (e.effectID === 12) return 'high';
    if (e.effectID === 13) return 'med';
    if (e.effectID === 11) return 'low';
    if (e.effectID === 2663) return 'rig';
    if (e.effectID === 3772) return 'sub';
  }
  return null;
}

const newId = () => `w${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export function emptyVariation(name: string, sizes: Record<Rack, number>): WizardVariation {
  const slots = (n: number): WizardSlot[] => Array.from({ length: n }, () => ({ typeId: null }));
  return {
    id: newId(), name,
    high: slots(sizes.high), med: slots(sizes.med), low: slots(sizes.low),
    rig: slots(sizes.rig), sub: slots(sizes.sub),
    drones: [], cargo: [],
  };
}

export function cloneVariation(v: WizardVariation, name: string): WizardVariation {
  return { ...(JSON.parse(JSON.stringify(v)) as WizardVariation), id: newId(), name };
}

export function newWizardFit(name: string, hullId: number, sizes: Record<Rack, number>): WizardFit {
  return { id: newId(), name, hullId, variations: [emptyVariation('Core', sizes)] };
}

/** the exact in-game saved-fit name the user specced: "<fit> - <variation>" */
export const fitVariationName = (fit: WizardFit, v: WizardVariation): string => `${fit.name} - ${v.name}`;

/** serialize a variation to EFT — the SAME pipeline every other fit view
 * uses (parse → relevance → dogma stats), one code path, one set of gates.
 * Module↔charge pairing is PRESERVED as inline "Module, Charge" lines (the
 * wizard is the one place the pairing is authoritatively known), so the
 * dogma engine simulates modules LOADED. Hole/null slot entries (from any
 * historical corruption) are skipped defensively. */
export function variationEft(fit: WizardFit, v: WizardVariation): string {
  const items: RawFitItem[] = [];
  const rackFlag: Record<Rack, string> = { high: 'HiSlot', med: 'MedSlot', low: 'LoSlot', rig: 'RigSlot', sub: 'SubSystemSlot' };
  for (const r of RACKS) {
    v[r].forEach((s, i) => {
      if (!s || s.typeId === null) return;
      items.push({
        type_id: s.typeId, quantity: 1, flag: `${rackFlag[r]}${i}`, chargeTypeId: s.chargeTypeId,
        // EFT can express OFFLINE; it has no notation for overheated, so a
        // copied fit carries the module online (stated in the UI)
        offline: s.state === 'offline',
      });
    });
  }
  for (const d of v.drones) items.push({ type_id: d.typeId, quantity: d.qty, flag: 'DroneBay' });
  for (const c of v.cargo) items.push({ type_id: c.typeId, quantity: c.qty, flag: 'Cargo' });
  // the fit's pod rides along in cargo — importing this EFT back rebuilds it
  for (const imp of fitImplants(fit)) items.push({ type_id: imp, quantity: 1, flag: 'Cargo' });
  return toEft(typeNameOf(fit.hullId), fitVariationName(fit, v), items);
}

/**
 * EFT → WizardFit (v0.193): "look at a fit and alter from a starting
 * point". The inverse of variationEft, built to ROUND-TRIP: importing what
 * variationEft printed reproduces the same racks, charges, states, drones
 * and cargo. Robust to real-world EFT too — sections are ignored and every
 * module is placed by its OWN rack (rackForModule), so mis-ordered pastes
 * still land right. Anything that cannot fit its rack spills to cargo and
 * is REPORTED, never dropped; unresolvable lines are reported the same way.
 */
export function wizardFitFromEft(
  eft: string,
  data: EsfDataShapes,
  findByName: (name: string) => { id: number } | undefined,
): { fit: WizardFit; spilled: string[]; unresolved: string[] } | { error: string } {
  const lines = eft.split(/\r?\n/);
  const head = lines.findIndex((l) => l.trim().startsWith('['));
  const m = head >= 0 ? lines[head].trim().match(/^\[\s*([^,\]]+?)\s*(?:,\s*(.+?)\s*)?\]$/) : null;
  if (!m) return { error: 'no [Hull, Name] header line found' };
  const hull = findByName(m[1]);
  if (!hull) return { error: `unknown hull "${m[1]}"` };
  const sizes = rackSizes(hull.id, data);
  const fit = newWizardFit((m[2] ?? m[1]).trim() || m[1], hull.id, sizes);
  const v = fit.variations[0];
  const spilled: string[] = [];
  const unresolved: string[] = [];
  const catOf = (id: number) => data.types[String(id)]?.categoryID;

  const place = (typeId: number, chargeTypeId: number | undefined, offline: boolean) => {
    const rack = rackForModule(typeId, data);
    if (rack !== null) {
      const free = v[rack].findIndex((s) => s.typeId === null);
      if (free >= 0) {
        v[rack][free] = {
          typeId,
          ...(chargeTypeId !== undefined ? { chargeTypeId } : {}),
          ...(offline ? { state: 'offline' as const } : {}),
        };
        return;
      }
      spilled.push(typeNameOf(typeId));
    }
    // no rack on this hull (or none free): keep the item, honestly, in cargo
    const cur = v.cargo.find((c) => c.typeId === typeId);
    if (cur) cur.qty += 1; else v.cargo.push({ typeId, qty: 1 });
    if (chargeTypeId !== undefined) {
      const ch = v.cargo.find((c) => c.typeId === chargeTypeId);
      if (ch) ch.qty += 1; else v.cargo.push({ typeId: chargeTypeId, qty: 1 });
    }
  };

  for (let i = head + 1; i < lines.length; i++) {
    let line = lines[i].trim();
    if (line === '' || /^\[.*\]$/.test(line)) continue; // blank / [Empty ... slot]
    // the wizard's own serializer emits "Module/OFFLINE" with NO space
    // (caught by the round-trip check); in-game EFT uses " /OFFLINE" —
    // accept both or importing our own exports would lose the flag
    const offline = /\s*\/OFFLINE\s*$/i.test(line);
    line = line.replace(/\s*\/OFFLINE\s*$/i, '').trim();
    const qtyM = line.match(/^(.*?)\s+x(\d+)$/i);
    const qty = qtyM ? Number(qtyM[2]) : 1;
    const name = (qtyM ? qtyM[1] : line).trim();

    let typeId: number | undefined = findByName(name)?.id;
    let chargeTypeId: number | undefined;
    if (typeId === undefined && name.includes(',')) {
      // "Module Name, Charge Name" — split at each comma until both resolve
      const parts = name.split(',');
      for (let cut = parts.length - 1; cut >= 1 && typeId === undefined; cut--) {
        const modName = parts.slice(0, cut).join(',').trim();
        const chName = parts.slice(cut).join(',').trim();
        const mod = findByName(modName);
        const ch = findByName(chName);
        if (mod && ch) { typeId = mod.id; chargeTypeId = ch.id; }
      }
    }
    if (typeId === undefined) { unresolved.push(name); continue; }

    if (qtyM || rackForModule(typeId, data) === null) {
      // an implant in cargo IS the pod travelling with the fit (v0.194) —
      // put it back in its slot so export→import rebuilds the pod
      const slot = catOf(typeId) === 20 ? implantSlot(data, typeId) : undefined;
      if (slot !== undefined && slot >= 1 && slot <= 10) {
        fit.implants ??= Array(10).fill(null) as (number | null)[];
        fit.implants[slot - 1] = typeId;
        continue;
      }
      // quantities are bays: drones fly, everything else is cargo
      const bay = catOf(typeId) === 18 ? v.drones : v.cargo;
      const cur = bay.find((x) => x.typeId === typeId);
      if (cur) cur.qty += qty; else bay.push({ typeId, qty });
    } else {
      place(typeId, chargeTypeId, offline);
    }
  }
  return { fit, spilled, unresolved };
}

/** EVE MULTIBUY lines ("Item Name<TAB>qty", qty omitted when 1 — the
 * in-game parser accepts name-whitespace-quantity) covering hull, modules,
 * charges, drones, and cargo spares. Charges count ONLY when their module
 * exists — every view must agree on what the fit contains. */
export function buyList(fit: WizardFit, v: WizardVariation): string {
  const counts = new Map<number, number>();
  const add = (typeId: number, qty: number) => counts.set(typeId, (counts.get(typeId) ?? 0) + qty);
  add(fit.hullId, 1);
  for (const r of RACKS) {
    for (const s of v[r]) {
      if (!s || s.typeId === null) continue;
      add(s.typeId, 1);
      if (s.chargeTypeId !== undefined) add(s.chargeTypeId, 1);
    }
  }
  for (const d of v.drones) add(d.typeId, d.qty);
  for (const c of v.cargo) add(c.typeId, c.qty);
  for (const imp of fitImplants(fit)) add(imp, 1); // the pod is part of the shopping
  return [...counts.entries()]
    .map(([t, q]) => (q > 1 ? `${typeNameOf(t)}\t${q}` : typeNameOf(t)))
    .join('\n');
}

/** ESI's fitting name limit (swagger: name maxLength 50, minLength 1) */
export const ESI_FIT_NAME_MAX = 50;

export interface EsiFittingPayload {
  name: string;
  description: string;
  ship_type_id: number;
  items: { type_id: number; flag: string; quantity: number }[];
}

/**
 * Build the POST /characters/{id}/fittings/ body for one variation.
 * Slot flags follow ESI's enum (HiSlot0…7, MedSlot0…7, LoSlot0…7,
 * RigSlot0…2, SubSystemSlot0…3); a LOADED charge rides as a Cargo entry
 * (the in-game fitting service stores ammo that way) and drones as
 * DroneBay. Slots beyond ESI's per-rack maximum, and items past the
 * 512-entry cap, are REPORTED — never silently dropped.
 */
export function toEsiFitting(
  fit: WizardFit,
  v: WizardVariation,
): { payload: EsiFittingPayload; nameTruncated: boolean; skipped: string[] } {
  const ESI_MAX: Record<Rack, number> = { high: 8, med: 8, low: 8, rig: 3, sub: 4 };
  const flagBase: Record<Rack, string> = {
    high: 'HiSlot', med: 'MedSlot', low: 'LoSlot', rig: 'RigSlot', sub: 'SubSystemSlot',
  };
  const items: EsiFittingPayload['items'] = [];
  const skipped: string[] = [];
  const charges = new Map<number, number>();
  for (const r of RACKS) {
    v[r].forEach((s, i) => {
      if (!s || s.typeId === null) return;
      if (i >= ESI_MAX[r]) {
        skipped.push(`${typeNameOf(s.typeId)} (${RACK_LABEL[r]} slot ${i + 1} — beyond what EVE stores)`);
        return;
      }
      items.push({ type_id: s.typeId, flag: `${flagBase[r]}${i}`, quantity: 1 });
      if (s.chargeTypeId !== undefined) charges.set(s.chargeTypeId, (charges.get(s.chargeTypeId) ?? 0) + 1);
    });
  }
  for (const [typeId, qty] of charges) items.push({ type_id: typeId, flag: 'Cargo', quantity: qty });
  for (const d of v.drones) items.push({ type_id: d.typeId, flag: 'DroneBay', quantity: d.qty });
  for (const c of v.cargo) items.push({ type_id: c.typeId, flag: 'Cargo', quantity: c.qty });
  // the attached pod travels to the character in cargo (v0.194)
  for (const imp of fitImplants(fit)) items.push({ type_id: imp, flag: 'Cargo', quantity: 1 });
  if (items.length > 512) {
    for (const extra of items.splice(512)) skipped.push(`${typeNameOf(extra.type_id)} ×${extra.quantity} (over EVE's 512-item limit)`);
  }
  const fullName = fitVariationName(fit, v);
  const name = fullName.slice(0, ESI_FIT_NAME_MAX);
  return {
    payload: {
      name,
      description: `Saved by EVE Conductor — ${fullName}`.slice(0, 500),
      ship_type_id: fit.hullId,
      items,
    },
    nameTruncated: name !== fullName,
    skipped,
  };
}

/** Build the ENGINE's fit shape straight from a variation — EFT text has no
 * notation for overheating, so the live stats path must not round-trip
 * through it. (Copy/skill-maxer still use variationEft.) */
/**
 * The wizard's own engine fit. IT MUST OBEY THE SAME DRONE RULE AS
 * toEsfFit — it did not, and reported several flights' DPS for a fit the
 * Fit Library scored correctly, because the bandwidth/5-drone limit was
 * written into toEsfFit only. Returns the benched drones alongside, so the
 * stats panel can name them here too.
 */
export function variationEsfFitFull(
  fit: WizardFit, v: WizardVariation, data: EsfDataShapes,
): { esfFit: EsfFitShape; benchedDrones: string[] } {
  const modules: EsfFitShape['modules'] = [];
  const drones: EsfFitShape['drones'] = [];
  const ENGINE_SLOT: Record<Rack, string> = {
    high: 'High', med: 'Medium', low: 'Low', rig: 'Rig', sub: 'SubSystem',
  };
  const ENGINE_STATE: Record<SlotState, string> = {
    offline: 'Passive', online: 'Online', active: 'Active', overload: 'Overload',
  };
  for (const r of RACKS) {
    v[r].forEach((s, i) => {
      if (!s || s.typeId === null) return;
      const passiveRack = r === 'rig' || r === 'sub';
      const state = passiveRack ? 'Passive' : ENGINE_STATE[s.state ?? 'active'];
      modules.push({
        type_id: s.typeId,
        slot: { type: ENGINE_SLOT[r], index: i + 1 },
        state,
        ...(s.chargeTypeId !== undefined ? { charge: { type_id: s.chargeTypeId } } : {}),
      });
    });
  }
  // ONE rule for what is actually in space, shared with toEsfFit
  const alloc = allocateDrones(
    fit.hullId,
    v.drones.map((d) => ({ typeId: d.typeId, name: typeNameOf(d.typeId), qty: d.qty })),
    data,
  );
  drones.push(...alloc.drones);
  return {
    esfFit: { ship_type_id: fit.hullId, modules, drones, implants: [] },
    benchedDrones: alloc.benchedDrones,
  };
}

/** back-compat shape for callers that only want the fit */
export function variationEsfFit(fit: WizardFit, v: WizardVariation, data: EsfDataShapes): EsfFitShape {
  return variationEsfFitFull(fit, v, data).esfFit;
}

/** reconcile a fit's stored rack arrays with the CURRENT data bundle's slot
 * counts (CCP moves slots in balance patches; stored fits predate that).
 * Short racks pad with empties; modules in TRUNCATED slots move to cargo —
 * visibly reported, never silently dropped (they'd otherwise flow into the
 * EFT/stats from slots the wheel doesn't even render). */
export function normalizeFitLayout(
  fit: WizardFit,
  /** PER VARIATION: a T3's rack sizes depend on its own subsystems, so one
   * shared size map would resize every variation to whichever one was asked
   * about. Callers pass `(v) => rackSizes(hullId, data, v.sub)`. */
  sizesFor: ((v: WizardVariation) => Record<Rack, number>) | Record<Rack, number>,
): { fit: WizardFit; movedToCargo: string[]; changed: boolean } {
  const moved: string[] = [];
  let changed = false;
  const variations = fit.variations.map((v) => {
    const sizes = typeof sizesFor === 'function' ? sizesFor(v) : sizesFor;
    const nv: WizardVariation = { ...v, cargo: v.cargo.map((c) => ({ ...c })) };
    for (const r of RACKS) {
      const cur = v[r] ?? [];
      // explicit index walk: Array.some SKIPS holes in sparse arrays, and
      // holes are exactly what historical out-of-bounds writes left behind
      let dirty = cur.length !== sizes[r];
      for (let i = 0; i < cur.length && !dirty; i++) if (!cur[i]) dirty = true;
      if (dirty) changed = true;
      const dense: WizardSlot[] = Array.from({ length: Math.max(cur.length, sizes[r]) }, (_, i) => cur[i] ?? { typeId: null });
      for (const s of dense.slice(sizes[r])) {
        if (s.typeId !== null) {
          moved.push(typeNameOf(s.typeId));
          const row = nv.cargo.find((c) => c.typeId === s.typeId);
          if (row) row.qty += 1; else nv.cargo.push({ typeId: s.typeId, qty: 1 });
        }
      }
      nv[r] = dense.slice(0, sizes[r]);
    }
    return nv;
  });
  return { fit: { ...fit, variations }, movedToCargo: moved, changed: changed || moved.length > 0 };
}
