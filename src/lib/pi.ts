// PLANETARY INDUSTRY — what needs you, when, and what it is worth.
//
// PI is the one part of EVE that punishes inattention with SILENT LOSS. When
// a planet's storage fills, the extractors keep running and their output is
// simply DISCARDED — no message, no mail, nothing in game tells you. The
// whole point of this module is to say "planet X fills in 6 hours" before
// that happens. Every other feature here is secondary to that one.
//
// WHAT COSTS MONEY, IN ORDER:
//   1. storage full          -> extraction is thrown away, continuously
//   2. extractor expired     -> the planet produces nothing at all
//   3. factory starved       -> installed capacity sits idle
//   4. heads in a dead spot  -> the same program yields less every cycle
//
// RATES ARE MEASURED, NOT MODELLED (rule 2). Extractor output decays over a
// program along a curve this app cannot verify without watching a live
// account, and a projection built on a formula I cannot check is exactly the
// kind of confident-but-wrong number this project keeps banning. So the
// collector snapshots each planet and DIFFS consecutive snapshots: the fill
// rate is what the planet actually did, not what a formula says it should.
// Before there are two snapshots the app says "measuring", the same way the
// price watcher says "analyzing cadence".
import { esiAuth } from './esiChar';
import { useAuth, type CharAccount } from './auth';
import { useApp } from './store';
import { getType } from './typedb';
import { pinRole, STORAGE_ROLES } from './piTypes';
import { loadSchematics, type Schematic } from './piSchematics';
import { programAvgPerHour } from './piYield';
import { flowBalance, balanceProblem, type FlowBalance } from './piBalance';
import { systemLabel, resolveSystems, isWormhole } from './systemNames';
import { BUILTIN_HUBS } from './constants';
import { mergeCarryForward } from './piCarry';
import { fetchAggregates } from './market';
import { logInfo, logWarn } from './devlog';
import { notifyPi } from './notify';

/** unattended collector: yields to the overlay and to whatever is on screen */
const LANE = { lane: 'background' as const };

/** ESI caches the planet list and each planet's layout for 10 minutes, so
 * asking more often than this only spends error budget for the same answer */
export const PI_INTERVAL_MS = 11 * 60_000;

/** concurrent ESI reads inside one PI pass. Modest on purpose: this is the
 * background lane, and the point is to stop 36 planets taking 36 round trips
 * in a row — not to race the rest of the app for the error budget. */
const POOL = 5;

// ---------------------------------------------------------------------------
// ESI shapes
// ---------------------------------------------------------------------------

export interface EsiPlanetRow {
  planet_id: number;
  solar_system_id: number;
  planet_type: string;
  num_pins: number;
  upgrade_level: number;
  last_update: string;
}

export interface EsiPin {
  pin_id: number;
  type_id: number;
  schematic_id?: number;
  install_time?: string;
  expiry_time?: string;
  last_cycle_start?: string;
  contents?: { type_id: number; amount: number }[];
  extractor_details?: {
    product_type_id?: number;
    cycle_time?: number;
    head_radius?: number;
    heads?: { head_id: number; latitude: number; longitude: number }[];
    qty_per_cycle?: number;
  };
  factory_details?: { schematic_id: number };
}

export interface EsiPlanetDetail {
  pins: EsiPin[];
  links: { source_pin_id: number; destination_pin_id: number; link_level: number }[];
  routes: { route_id: number; source_pin_id: number; destination_pin_id: number; content_type_id: number; quantity: number }[];
}

// ---------------------------------------------------------------------------
// Storage capacity
//
// The bundled fit data does NOT carry attribute 38 (capacity) for PI
// structures — verified by decoding typeDogma.pb2 — so it comes from ESI's
// public /universe/types/, which returns `capacity` as a top-level field.
// There are only a couple of dozen such types and they change at patches, so
// one persistent cache covers it forever.
// ---------------------------------------------------------------------------

const CAP_KEY = 'etc-pi-capacity-v1';
const capacity = new Map<number, number>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(CAP_KEY) ?? '{}'))
        .map(([k, v]) => [Number(k), Number(v)] as [number, number]);
    } catch {
      return [];
    }
  })(),
);

function saveCapacities(): void {
  try {
    localStorage.setItem(CAP_KEY, JSON.stringify(Object.fromEntries(capacity)));
  } catch {
    // the cache is a convenience; a full localStorage must not break PI
  }
}

/** m³ a storage-capable pin type holds; 0 when it is not a storage type */
export function capacityOf(typeId: number): number {
  return capacity.get(typeId) ?? 0;
}

/**
 * Resolve any capacities we do not know yet. Uses the AUTHENTICATED helper so
 * the call is gated and reported like every other ESI request.
 */
async function ensureCapacities(typeIds: number[], charId: number): Promise<void> {
  const missing = [...new Set(typeIds)].filter((t) => !capacity.has(t));
  if (missing.length === 0) return;
  const q = [...missing];
  await Promise.all(Array.from({ length: Math.min(POOL, q.length) }, async () => {
    for (;;) {
      const t = q.shift();
      if (t === undefined) return;
      try {
        const { data } = await esiAuth<{ capacity?: number }>(`/universe/types/${t}/`, undefined, charId, LANE);
        capacity.set(t, typeof data.capacity === 'number' ? data.capacity : 0);
      } catch {
        // leave it unknown rather than recording 0 — a wrong capacity would
        // make a full planet look empty, which is the exact failure this
        // module exists to prevent
      }
    }
  }));
  saveCapacities();
}

// ---------------------------------------------------------------------------
// Snapshots — the measured half
// ---------------------------------------------------------------------------

export interface PlanetSnapshot {
  /** when this observation was taken */
  t: number;
  /** ESI's own last_update for the planet. TWO READS INSIDE THE 10-MINUTE
   * CACHE RETURN IDENTICAL DATA — recording both made the diff zero and the
   * planet read "not filling" when it was filling perfectly well. A snapshot
   * is only worth keeping when EVE says the planet actually changed. */
  u?: string;
  /** m³ stored across every storage-capable pin */
  usedM3: number;
  /** m³ the planet can hold in total */
  capM3: number;
  /** ISK the contents would fetch at the Jita ask */
  value: number;
}

const SNAP_KEY = 'etc-pi-snapshots-v1';
type SnapStore = Record<string, PlanetSnapshot[]>;

function loadSnaps(): SnapStore {
  try {
    return (JSON.parse(localStorage.getItem(SNAP_KEY) ?? 'null') as SnapStore) ?? {};
  } catch {
    return {};
  }
}
let snaps: SnapStore = loadSnaps();

/** keep a short history per planet — enough to measure a rate, not a log */
const MAX_SNAPS = 12;

function recordSnapshot(key: string, s: PlanetSnapshot): void {
  const list = snaps[key] ?? [];
  // same server-side revision as the last one = the same numbers, not a new
  // observation. Keeping it would dilute the measured rate toward zero.
  const prev = list[list.length - 1];
  if (prev && s.u !== undefined && prev.u === s.u) return;
  list.push(s);
  snaps[key] = list.slice(-MAX_SNAPS);
  try {
    localStorage.setItem(SNAP_KEY, JSON.stringify(snaps));
  } catch {
    // history is a nicety; the current state still displays
  }
}

/**
 * m³ per hour, measured across the observations we actually have.
 *
 * Returns null until there are two of them — "measuring" is an honest answer
 * and a made-up rate is not. A DROP (the player collected) resets the
 * baseline rather than producing a negative rate: the question is always
 * "how fast is it filling from where it is NOW".
 */
export function fillRatePerHour(key: string): { m3PerHour: number; spanHours: number } | null {
  const list = snaps[key] ?? [];
  if (list.length < 2) return null;
  // walk back only as far as the last collection (a drop in usedM3)
  let start = list.length - 1;
  for (let i = list.length - 1; i > 0; i--) {
    if (list[i].usedM3 < list[i - 1].usedM3) break;
    start = i - 1;
  }
  const a = list[start];
  const b = list[list.length - 1];
  const hours = (b.t - a.t) / 3_600_000;
  if (hours <= 0.01) return null;
  const delta = b.usedM3 - a.usedM3;
  if (delta <= 0) return { m3PerHour: 0, spanHours: hours };
  return { m3PerHour: delta / hours, spanHours: hours };
}

export function snapshotsFor(key: string): PlanetSnapshot[] {
  return snaps[key] ?? [];
}

export const planetKey = (charId: number, planetId: number) => `${charId}:${planetId}`;

// ---------------------------------------------------------------------------
// The computed view of one planet
// ---------------------------------------------------------------------------

export type PlanetProblem =
  | 'storage-full'
  | 'storage-filling'
  | 'extractor-expired'
  | 'extractor-expiring'
  | 'factory-idle'
  | 'unbalanced'
  | 'no-extractor'
  | 'ok';

export interface PlanetState {
  charId: number;
  characterName: string;
  planetId: number;
  planetName: string;
  systemId: number;
  systemName: string;
  /** J-space: the bundled map has no wormholes, so the name is resolved live */
  inWormhole: boolean;
  planetType: string;
  upgradeLevel: number;

  usedM3: number;
  capM3: number;
  /** 0..1; 1 = full and throwing output away */
  fullFrac: number;
  /** ISK the stored contents would fetch at the Jita ask */
  value: number;
  /** what the contents are, biggest first */
  contents: { typeId: number; name: string; amount: number; m3: number; value: number }[];

  /** measured, null while still learning */
  m3PerHour: number | null;
  /** hours until storage is full at the measured rate; null when unknown */
  hoursToFull: number | null;
  /** ms epoch the storage is projected to fill; null when unknown */
  fullAt: number | null;

  /** soonest extractor program expiry across the planet */
  extractorExpiry: number | null;
  extractorCount: number;
  /** extractors whose program has already ended */
  expiredExtractors: number;
  factoryCount: number;
  /** factories with no input in their own contents AND nothing routed in */
  idleFactories: number;

  problem: PlanetProblem;
  /** worst-first ranking: 0 is the most urgent */
  rank: number;
  /** the single sentence to act on */
  advice: string;

  /** units/hour the ACTIVE extractor programs pull, summed — EXACT, straight
   * from ESI's extractor_details (qty_per_cycle × 3600/cycle_time). null =
   * no extractor carries detail (never guessed). Expired programs pull 0. */
  extractorPullPerHour: number | null;
  /** per-extractor breakdown for the detail popup; program params carried
   * so the popup can draw the official per-cycle yield bars (piYield) */
  extractors: {
    productTypeId: number | null; perHour: number; expiry: number | null; active: boolean;
    qtyPerCycle?: number; cycleTimeSec?: number; installMs?: number | null;
  }[];
  /** which schematic each factory runs, aggregated — the component joins this
   * with the SDE schematic table (piSchematics) for exact burn/output rates */
  factorySchematics: { schematicId: number; count: number }[];
  /** head-vs-factory flow balance (piBalance) — null when not judgeable
   * (no schematic table, no factories, or import-fed) */
  balance?: FlowBalance | null;
  /** ms epoch this state was actually READ from ESI — carried-forward and
   * restart-restored planets keep their old stamp so the view can say
   * "as of" honestly (optional: pre-v0.175 persisted data lacks it) */
  observedAt?: number;
}

// pin classification comes from the GENERATED table (piTypes.ts), not from
// typedb — typedb only carries an inventory group for ships, so a factory
// would have fallen through as "not a PI structure" and its contents would
// have been invisible.

/** planet names come from the universe endpoint; cached forever (they never change) */
const NAME_KEY = 'etc-pi-names-v1';
const planetNames = new Map<number, string>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(NAME_KEY) ?? '{}'))
        .map(([k, v]) => [Number(k), String(v)] as [number, string]);
    } catch {
      return [];
    }
  })(),
);

async function ensurePlanetNames(ids: number[], charId: number): Promise<void> {
  const missing = ids.filter((id) => !planetNames.has(id));
  if (missing.length === 0) return;
  // A SMALL WORKER POOL, NOT A SEQUENTIAL WALK. Six characters with six
  // planets each is 36 round trips; doing them one at a time is why the first
  // load felt broken. These are permanent public facts, fetched once ever.
  const queue = [...missing];
  await Promise.all(Array.from({ length: Math.min(POOL, queue.length) }, async () => {
    for (;;) {
      const id = queue.shift();
      if (id === undefined) return;
      try {
        const { data } = await esiAuth<{ name?: string }>(`/universe/planets/${id}/`, undefined, charId, LANE);
        if (typeof data.name === 'string') planetNames.set(id, data.name);
      } catch {
        // a missing name is cosmetic — the system name still identifies it
      }
    }
  }));
  try {
    localStorage.setItem(NAME_KEY, JSON.stringify(Object.fromEntries(planetNames)));
  } catch { /* cosmetic */ }
}

export const planetNameOf = (id: number): string | null => planetNames.get(id) ?? null;

// ---------------------------------------------------------------------------
// Thresholds — configurable, because "enough" depends on how often you play
// ---------------------------------------------------------------------------

export interface PiThresholds {
  /** warn when storage is this full (fraction) */
  fullWarnFrac: number;
  /** warn when storage will fill within this many hours */
  fullWarnHours: number;
  /** warn when an extractor program ends within this many hours */
  expiryWarnHours: number;
  /** treat a factory as idle after this many hours with no input */
  factoryIdleHours: number;
}

export const DEFAULT_PI_THRESHOLDS: PiThresholds = {
  fullWarnFrac: 0.85,
  fullWarnHours: 24,
  expiryWarnHours: 24,
  factoryIdleHours: 6,
};

export function piThresholds(): PiThresholds {
  const t = useApp.getState().alerts.pi;
  return { ...DEFAULT_PI_THRESHOLDS, ...(t ?? {}) };
}

// ---------------------------------------------------------------------------
// Building one planet's state
// ---------------------------------------------------------------------------

/** which characters this module watches — an INDEPENDENT flag, because a
 * PI character is usually also a trader or a hauler */
export function piCharacters(): CharAccount[] {
  return useAuth.getState().characters.filter((c) => c.piRole === true);
}

export function buildPlanetState(
  char: { characterId: number; characterName: string },
  row: EsiPlanetRow,
  detail: EsiPlanetDetail,
  markPrice: (typeId: number) => number,
  now = Date.now(),
  /** the SDE schematic table — lets factory starvation be judged against
   * actual input STOCK instead of a stale cycle timestamp (v0.179) */
  schem: Map<number, Schematic> | null = null,
): PlanetState {
  const key = planetKey(char.characterId, row.planet_id);

  let usedM3 = 0;
  let capM3 = 0;
  let value = 0;
  const byType = new Map<number, number>();

  let extractorCount = 0;
  let expiredExtractors = 0;
  let factoryCount = 0;
  let idleFactories = 0;
  let extractorExpiry: number | null = null;
  /** shortest ACTIVE program's total length — the expiry warning scales to
   * it (a flat 24h threshold kept 2-day programs in "ending soon" for HALF
   * their life, the reported noise) */
  let shortestProgramMs: number | null = null;
  let pullPerHour: number | null = null;
  const staleFactorySchematics: number[] = [];
  const extractors: PlanetState['extractors'] = [];
  const schemCounts = new Map<number, number>();

  for (const pin of detail.pins) {
    const role = pinRole(pin.type_id);

    if (role !== null && STORAGE_ROLES.has(role)) capM3 += capacityOf(pin.type_id);

    // CONTENTS COUNT WHEREVER THEY SIT. Goods inside a factory or an
    // extractor buffer are still on the planet and still worth ISK; only the
    // CAPACITY figure is storage-only, because that is what actually limits
    // the planet.
    for (const c of pin.contents ?? []) {
      const vol = getType(c.type_id)?.volume ?? 0;
      usedM3 += c.amount * vol;
      byType.set(c.type_id, (byType.get(c.type_id) ?? 0) + c.amount);
    }

    if (role === 'extractor') {
      extractorCount++;
      const exp = pin.expiry_time ? Date.parse(pin.expiry_time) : NaN;
      const inst = pin.install_time ? Date.parse(pin.install_time) : NaN;
      if (Number.isFinite(exp)) {
        if (exp <= now) expiredExtractors++;
        extractorExpiry = extractorExpiry === null ? exp : Math.min(extractorExpiry, exp);
        if (exp > now && Number.isFinite(inst) && exp > inst) {
          const len = exp - inst;
          shortestProgramMs = shortestProgramMs === null ? len : Math.min(shortestProgramMs, len);
        }
      } else {
        // no program installed at all
        expiredExtractors++;
      }
      // ESI's qty_per_cycle is the BASE of CCP's published decay/wobble
      // formula, NOT the per-cycle amount (v0.180, official PI dev guide) —
      // the honest rate is the program's whole-schedule average from
      // piYield. Without an install stamp there is no schedule to average,
      // so fall back to the nominal base rate and accept it understates.
      // An expired (or absent) program pulls nothing — counted at 0, active
      // flag false, so the card's total is what the planet is pulling NOW.
      const d = pin.extractor_details;
      const active = Number.isFinite(exp) && exp > now;
      if (d && typeof d.qty_per_cycle === 'number' && typeof d.cycle_time === 'number' && d.cycle_time > 0) {
        const perHour = Number.isFinite(exp) && Number.isFinite(inst) && exp > inst
          ? programAvgPerHour(d.qty_per_cycle, d.cycle_time, (exp - inst) / 1000)
          : d.qty_per_cycle * (3600 / d.cycle_time);
        extractors.push({
          productTypeId: d.product_type_id ?? null, perHour, expiry: Number.isFinite(exp) ? exp : null, active,
          qtyPerCycle: d.qty_per_cycle, cycleTimeSec: d.cycle_time,
          installMs: Number.isFinite(inst) ? inst : null,
        });
        pullPerHour = (pullPerHour ?? 0) + (active ? perHour : 0);
      } else {
        extractors.push({ productTypeId: d?.product_type_id ?? null, perHour: 0, expiry: Number.isFinite(exp) ? exp : null, active });
      }
    }

    if (role === 'factory') {
      factoryCount++;
      const sid = pin.factory_details?.schematic_id ?? pin.schematic_id;
      if (typeof sid === 'number') schemCounts.set(sid, (schemCounts.get(sid) ?? 0) + 1);
      // A WORKING FACTORY LOOKS EMPTY. It consumes its inputs the moment a
      // cycle starts, so `contents: []` is the NORMAL state of a healthy
      // factory — treating that as starvation flagged all 36 planets at once,
      // which is worse than saying nothing.
      //
      // The only honest evidence of starvation is a cycle that has not
      // STARTED for far longer than a cycle takes. If ESI does not give us
      // last_cycle_start at all we simply do not know, and say nothing —
      // "unknown" must never render as "broken".
      // SECOND HONESTY GATE (v0.179): ESI's colony state only advances when
      // the OWNER opens the colony in game, so last_cycle_start goes stale
      // on perfectly healthy planets — the chronic false "factory starved".
      // A stale cycle alone proves nothing; it only counts as starvation
      // when the planet ALSO holds ZERO of that factory's schematic inputs
      // anywhere (checked after the content scan, when byType is complete).
      const started = pin.last_cycle_start ? Date.parse(pin.last_cycle_start) : NaN;
      if (Number.isFinite(started)) {
        const idleHours = (now - started) / 3_600_000;
        if (idleHours > piThresholds().factoryIdleHours && typeof sid === 'number') {
          staleFactorySchematics.push(sid);
        }
      }
    }
  }

  for (const [typeId, amount] of byType) value += amount * markPrice(typeId);

  // starvation = stale cycle AND no input stock on the whole planet. With
  // no schematic table yet, say nothing — unknown must never render broken.
  if (schem !== null) {
    for (const sid of staleFactorySchematics) {
      const sc = schem.get(sid);
      if (!sc || sc.inputs.length === 0) continue;
      const hasStock = sc.inputs.some((i) => (byType.get(i.typeId) ?? 0) > 0);
      if (!hasStock) idleFactories++;
    }
  }

  // head-vs-factory ratio — pure rate math (SDE burn vs yield-formula
  // supply), so it works even while ESI's lazy colony sim is stale
  const factorySchematics = [...schemCounts.entries()].map(([schematicId, count]) => ({ schematicId, count }));
  const balance = extractorCount > 0 ? flowBalance({ extractors, factorySchematics }, schem) : null;

  const contents = [...byType.entries()]
    .map(([typeId, amount]) => {
      const t = getType(typeId);
      return {
        typeId,
        name: t?.name ?? `#${typeId}`,
        amount,
        m3: amount * (t?.volume ?? 0),
        value: amount * markPrice(typeId),
      };
    })
    .sort((a, b) => b.value - a.value);

  const fullFrac = capM3 > 0 ? Math.min(1, usedM3 / capM3) : 0;
  const rate = fillRatePerHour(key);
  const m3PerHour = rate ? rate.m3PerHour : null;
  const remaining = Math.max(0, capM3 - usedM3);
  const hoursToFull = m3PerHour !== null && m3PerHour > 0 ? remaining / m3PerHour : null;
  const fullAt = hoursToFull !== null ? now + hoursToFull * 3_600_000 : null;

  const th = piThresholds();


  // rank worst-first by what it COSTS, not by how alarming it looks
  let problem: PlanetProblem = 'ok';
  let rank = 9;
  let advice = 'Nothing needed.';

  if (capM3 > 0 && fullFrac >= 0.999) {
    problem = 'storage-full';
    rank = 0;
    advice = 'FULL — extractor output is being discarded right now. Collect immediately.';
  } else if (extractorCount > 0 && expiredExtractors === extractorCount) {
    problem = 'extractor-expired';
    rank = 1;
    advice = 'Every extractor program has ended — this planet is producing nothing. Restart them.';
  } else if (
    (hoursToFull !== null && hoursToFull <= th.fullWarnHours) ||
    fullFrac >= th.fullWarnFrac
  ) {
    problem = 'storage-filling';
    rank = 2;
    advice = hoursToFull !== null
      ? `Storage fills in about ${hoursToFull < 1 ? '<1' : Math.round(hoursToFull)}h — collect before output starts being thrown away.`
      : `Storage is ${Math.round(fullFrac * 100)}% full — collect soon.`;
  } else if (expiredExtractors > 0) {
    problem = 'extractor-expired';
    rank = 3;
    advice = `${expiredExtractors} of ${extractorCount} extractor programs have ended — restart them to get the planet back to full output.`;
  } else if (
    extractorExpiry !== null &&
    extractorExpiry - now <= Math.min(
      th.expiryWarnHours * 3_600_000,
      // scale to the program itself: warn in the last quarter, so a 2-day
      // program warns in its final ~12h instead of half its life
      shortestProgramMs !== null ? shortestProgramMs * 0.25 : Infinity,
    )
  ) {
    problem = 'extractor-expiring';
    rank = 4;
    const h = Math.max(0, Math.round((extractorExpiry - now) / 3_600_000));
    advice = `An extractor program ends in about ${h}h — plan a reset trip.`;
  } else if (idleFactories > 0) {
    problem = 'factory-idle';
    rank = 5;
    advice = `${idleFactories} of ${factoryCount} factories have had no input for over ${th.factoryIdleHours}h — extraction is not keeping up with what they consume.`;
  } else if (balanceProblem(balance) === 'underfed' && balance) {
    // the head-to-factory ratio is off: factories duty-cycle at fedFrac —
    // a REBALANCE signal for the next reset trip, not an emergency
    problem = 'unbalanced';
    rank = 6;
    const worst = balance.flows[0];
    const bName = getType(worst.typeId)?.name ?? `#${worst.typeId}`;
    advice = `Factories can only run ~${Math.round(balance.fedFrac * 100)}% of the time: ${bName} arrives at ${Math.round(worst.supplyPerHour).toLocaleString()}/h but they burn ${Math.round(worst.demandPerHour).toLocaleString()}/h flat out. Shift heads toward ${bName} or drop a factory next reset.`;
  } else if (balanceProblem(balance) === 'overfed' && balance && balance.surplusTypeId !== null) {
    problem = 'unbalanced';
    rank = 6;
    const sName = getType(balance.surplusTypeId)?.name ?? `#${balance.surplusTypeId}`;
    advice = `Heads pull ${Math.round(balance.surplusPerHour).toLocaleString()}/h of ${sName} more than the factories can eat — it piles up until storage caps. Add a factory or shift heads off ${sName} next reset.`;
  } else if (extractorCount === 0) {
    problem = 'no-extractor';
    rank = 7;
    advice = 'No extractors on this planet — it only processes what is routed to it.';
  }

  return {
    charId: char.characterId,
    characterName: char.characterName,
    planetId: row.planet_id,
    planetName: planetNames.get(row.planet_id) ?? `Planet ${row.planet_id}`,
    systemId: row.solar_system_id,
    systemName: systemLabel(row.solar_system_id),
    inWormhole: isWormhole(row.solar_system_id),
    planetType: row.planet_type,
    upgradeLevel: row.upgrade_level,
    usedM3,
    capM3,
    fullFrac,
    value,
    contents,
    m3PerHour,
    hoursToFull,
    fullAt,
    extractorExpiry,
    extractorCount,
    expiredExtractors,
    factoryCount,
    idleFactories,
    problem,
    rank,
    advice,
    extractorPullPerHour: pullPerHour,
    extractors,
    factorySchematics,
    balance,
  };
}

// ---------------------------------------------------------------------------
// The collector
// ---------------------------------------------------------------------------

/** LAST-KNOWN STATE SURVIVES RESTARTS (v0.175): the computed list is
 * persisted after every successful tick and loaded here, so the module
 * renders instantly with "as of" data instead of sitting blank until the
 * first 11-minute tick — silent update relaunches were wiping the
 * in-memory list every ship. */
const STATE_KEY = 'etc-pi-state-v1';
let lastRun = 0;
let cached: PlanetState[] = [];
try {
  const raw = JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null') as
    { at: number; planets: PlanetState[] } | null;
  if (raw && typeof raw.at === 'number' && Array.isArray(raw.planets)) {
    cached = raw.planets;
    lastRun = raw.at;
  }
} catch { /* fresh start */ }
export const piPlanets = (): PlanetState[] => cached;
export const piLastRun = (): number => lastRun;

/**
 * One pass over every PI character's planets.
 *
 * INTEGRITY GATE (rule 3): a planet whose detail read failed is skipped
 * entirely rather than recorded as empty — an unreadable planet must never
 * look like a collected one, because "0% full, nothing to do" is the single
 * most expensive wrong answer this module could give.
 */
export async function runPiTick(): Promise<number> {
  const chars = piCharacters();
  if (chars.length === 0) return 0;
  // schematic table (tiny, cached forever) — powers the stock-aware
  // starvation check; null on failure = starvation stays unjudged
  const schem = await loadSchematics().catch(() => null);

  const states: PlanetState[] = [];
  let failed = 0;
  /** charId → planet ids a SUCCESSFUL list fetch reported — drives the
   * carry-forward semantics (see piCarry.ts) */
  const listed = new Map<number, Set<number>>();

  for (const c of chars) {
    let rows: EsiPlanetRow[];
    try {
      rows = (await esiAuth<EsiPlanetRow[]>(`/characters/${c.characterId}/planets/`, undefined, c.characterId, LANE)).data;
    } catch (e) {
      failed++;
      logWarn('pi', `${c.characterName}: could not read the planet list`, {
        error: e instanceof Error ? e.message : String(e),
      });
      continue;
    }
    listed.set(c.characterId, new Set(rows.map((r) => r.planet_id)));
    if (rows.length === 0) continue;

    await ensurePlanetNames(rows.map((r) => r.planet_id), c.characterId);
    // the bundled map is k-space only; wormhole systems need a live lookup
    await resolveSystems(rows.map((r) => r.solar_system_id));

    const details = new Map<number, EsiPlanetDetail>();
    const pending = [...rows];
    await Promise.all(Array.from({ length: Math.min(POOL, pending.length) }, async () => {
      for (;;) {
        const r = pending.shift();
        if (!r) return;
        try {
          details.set(r.planet_id, (await esiAuth<EsiPlanetDetail>(
            `/characters/${c.characterId}/planets/${r.planet_id}/`, undefined, c.characterId, LANE,
          )).data);
        } catch (e) {
          failed++;
          logWarn('pi', `${c.characterName}: could not read planet ${r.planet_id} — SKIPPED`, {
            error: e instanceof Error ? e.message : String(e),
            why: 'an unreadable planet must not be recorded as empty',
          });
        }
      }
    }));
    if (details.size === 0) continue;

    // capacities for every storage pin we have not seen before
    const storageTypes: number[] = [];
    for (const d of details.values()) {
      for (const p of d.pins) {
        const r = pinRole(p.type_id);
        if (r !== null && STORAGE_ROLES.has(r)) storageTypes.push(p.type_id);
      }
    }
    await ensureCapacities(storageTypes, c.characterId);

    // ONE YARDSTICK, same as the net-worth chart: what it would fetch as a
    // sell order in Jita, wherever it currently sits
    const typeIds = [...new Set(
      [...details.values()].flatMap((d) => d.pins.flatMap((p) => (p.contents ?? []).map((x) => x.type_id))),
    )];
    let book = new Map<number, { sell: { min: number; orderCount: number } }>();
    if (typeIds.length > 0) {
      try {
        const jita = BUILTIN_HUBS.find((h) => h.id === 'jita')!;
        book = (await fetchAggregates(jita, typeIds)) as unknown as typeof book;
      } catch {
        // no prices this pass — the planet still reports fullness, which is
        // the part that actually costs money
      }
    }
    const mark = (typeId: number): number => {
      const j = book.get(typeId);
      return j && j.sell.orderCount > 0 && j.sell.min > 0 ? j.sell.min : 0;
    };

    for (const r of rows) {
      const d = details.get(r.planet_id);
      if (!d) continue; // failed read — already logged, never guessed at
      const st = buildPlanetState(c, r, d, mark, Date.now(), schem);
      st.observedAt = Date.now();
      states.push(st);
      // record the observation AFTER computing, so the rate uses the
      // previous snapshots rather than this one
      recordSnapshot(planetKey(c.characterId, r.planet_id), {
        t: Date.now(), usedM3: st.usedM3, capM3: st.capM3, value: st.value, u: r.last_update,
      });
    }
  }

  // A PASS THAT OBSERVED NOTHING (every list read failed) must not touch
  // the last-known state OR its timestamp — bumping lastRun here laundered
  // 3-hour-old data as fresh and hid the staleness banner (caught by the
  // rig, v0.175). The freshness backoff schedules the retry.
  if (listed.size === 0) {
    logInfo('pi', 'tick observed nothing — last-known state left untouched', {
      characters: chars.length, failedReads: failed,
    });
    return cached.length;
  }

  // planets this pass could not re-read keep their LAST-KNOWN state (see
  // piCarry.ts — dropping a real planet over one failed HTTP call is the
  // same lie as recording an unread one as empty)
  const merged = mergeCarryForward(cached, states, listed, new Set(chars.map((c) => c.characterId)));
  merged.sort((a, b) => a.rank - b.rank || b.value - a.value);
  cached = merged;
  lastRun = Date.now();
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify({ at: lastRun, planets: merged }));
  } catch { /* display cache only — a full localStorage must not break PI */ }

  const carried = merged.length - states.length;
  const urgent = merged.filter((s) => s.rank <= 2).length;

  // WARN BEFORE THE LOSS, not after. EVE says nothing when a planet fills.
  const toSend = piAlertsToSend(merged);
  if (toSend.length > 0) {
    notifyPi(toSend.map((s) => ({
      characterName: s.characterName, planetName: s.planetName, systemName: s.systemName,
      problem: s.problem, advice: s.advice, value: s.value, hoursToFull: s.hoursToFull,
    })));
    markPiAlerted(merged);
    logInfo('pi', `alerted on ${toSend.length} planet(s)`, {
      planets: toSend.map((s) => `${s.planetName}: ${s.problem}`),
    });
  } else {
    markPiAlerted(merged);
  }

  logInfo('pi', 'tick ok', {
    characters: chars.length, planets: merged.length, carriedForward: carried,
    needingAttention: urgent, failedReads: failed,
  });
  return merged.length;
}

// ---------------------------------------------------------------------------
// Alerting
//
// PI is the one thing in EVE where the game itself tells you NOTHING before
// you start losing output, so this is the module's whole reason to exist. It
// goes out on the same channel as the trade alerts: a desktop toast, and the
// user's ntfy topic for their phone if they configured one.
//
// ONE ALERT PER PROBLEM PER PLANET, not one per tick. A collector that runs
// every 11 minutes would otherwise send the same "storage filling" message
// 130 times a day, which trains the user to ignore it — and the one time it
// matters, they would.
// ---------------------------------------------------------------------------

const ALERTED_KEY = 'etc-pi-alerted-v1';
type AlertedStore = Record<string, { problem: PlanetProblem; at: number }>;

function loadAlerted(): AlertedStore {
  try {
    return (JSON.parse(localStorage.getItem(ALERTED_KEY) ?? 'null') as AlertedStore) ?? {};
  } catch {
    return {};
  }
}
let alerted: AlertedStore = loadAlerted();

/** re-raise a problem that is STILL happening after this long */
const REMIND_AFTER_MS = 12 * 3_600_000;

/**
 * Which planets deserve a message right now. Pure, so the decision can be
 * tested without sending anything.
 */
export function piAlertsToSend(states: PlanetState[], now = Date.now()): PlanetState[] {
  const cfg = useApp.getState().alerts.pi;
  if (cfg && cfg.enabled === false) return [];
  const out: PlanetState[] = [];
  for (const s of states) {
    // only the things that actually cost something RIGHT NOW — 'unbalanced'
    // is a next-reset-trip tuning signal, not a phone-buzz
    if (s.problem === 'ok' || s.problem === 'no-extractor' || s.problem === 'unbalanced') continue;
    const key = planetKey(s.charId, s.planetId);
    const prev = alerted[key];
    const isNew = !prev || prev.problem !== s.problem;
    const stale = prev && now - prev.at > REMIND_AFTER_MS;
    if (isNew || stale) out.push(s);
  }
  return out;
}

/** record that these were sent, so the next tick stays quiet */
export function markPiAlerted(states: PlanetState[], now = Date.now()): void {
  for (const s of states) alerted[planetKey(s.charId, s.planetId)] = { problem: s.problem, at: now };
  // planets that are fine again drop out, so recovering re-arms the alert
  const live = new Set(states.map((s) => planetKey(s.charId, s.planetId)));
  for (const k of Object.keys(alerted)) {
    if (!live.has(k) && now - alerted[k].at > REMIND_AFTER_MS) delete alerted[k];
  }
  try {
    localStorage.setItem(ALERTED_KEY, JSON.stringify(alerted));
  } catch { /* alert state is a nicety */ }
}

/** clear the memory of what has been alerted — used when a planet recovers */
export function clearPiAlert(charId: number, planetId: number): void {
  delete alerted[planetKey(charId, planetId)];
  try {
    localStorage.setItem(ALERTED_KEY, JSON.stringify(alerted));
  } catch { /* nicety */ }
}
