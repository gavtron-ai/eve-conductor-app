// COMPARING TWO FITS — PURE, so fixtures run this exact code.
//
// Two halves, because they answer different questions:
//   · moduleDiff — what is physically different (what to swap)
//   · statDiff   — what that costs or buys (whether to bother)
import type { RawFitItem } from './fitSerial';
import type { FitStats } from './dogmaFit';

export interface ModuleDelta {
  typeId: number;
  name: string;
  /** how many in A, in B, and B−A */
  a: number;
  b: number;
  delta: number;
  /** the rack it sits in, for grouping */
  rack: string;
}

/** counts per (rack, typeId) — the rack matters, since the same module
 * fitted vs sitting in cargo is not the same thing */
function countByRackType(items: RawFitItem[], rackOf: (flag: string) => string): Map<string, { rack: string; typeId: number; n: number }> {
  const out = new Map<string, { rack: string; typeId: number; n: number }>();
  for (const it of items) {
    if (it.flag === 'Invalid') continue;
    const rack = rackOf(it.flag);
    const key = `${rack}|${it.type_id}`;
    const cur = out.get(key);
    const n = Math.max(1, it.quantity);
    if (cur) cur.n += n;
    else out.set(key, { rack, typeId: it.type_id, n });
  }
  return out;
}

/**
 * What differs between two fits. Only rows where the counts actually differ
 * are returned — an identical module in both is not news.
 */
export function moduleDiff(
  a: RawFitItem[],
  b: RawFitItem[],
  rackOf: (flag: string) => string,
  nameOf: (typeId: number) => string,
): ModuleDelta[] {
  const ca = countByRackType(a, rackOf);
  const cb = countByRackType(b, rackOf);
  const keys = new Set([...ca.keys(), ...cb.keys()]);
  const rows: ModuleDelta[] = [];
  for (const k of keys) {
    const ra = ca.get(k);
    const rb = cb.get(k);
    const na = ra?.n ?? 0;
    const nb = rb?.n ?? 0;
    if (na === nb) continue;
    const meta = ra ?? rb!;
    rows.push({ typeId: meta.typeId, name: nameOf(meta.typeId), a: na, b: nb, delta: nb - na, rack: meta.rack });
  }
  const RACK_ORDER = ['HiSlot', 'MedSlot', 'LoSlot', 'RigSlot', 'SubSystemSlot', 'ServiceSlot', 'DroneBay', 'FighterBay', 'Cargo'];
  rows.sort((x, y) => {
    const rx = RACK_ORDER.indexOf(x.rack);
    const ry = RACK_ORDER.indexOf(y.rack);
    return (rx === -1 ? 99 : rx) - (ry === -1 ? 99 : ry) || x.name.localeCompare(y.name);
  });
  return rows;
}

export interface StatDelta {
  label: string;
  a: number;
  b: number;
  delta: number;
  /** 0 decimals for HP, 2 for align time, … */
  digits: number;
  unit: string;
  /** true when a HIGHER number is better — drives the colour, and getting
   * this wrong would paint a worse fit green */
  higherIsBetter: boolean;
}

const row = (
  label: string, a: number, b: number, digits: number, unit: string, higherIsBetter: boolean,
): StatDelta => ({ label, a, b, delta: b - a, digits, unit, higherIsBetter });

/**
 * The comparison rows. Everything traces to the engine's own output — no
 * derived "score", because a single number would hide the trade-off that is
 * the entire point of comparing two fits.
 */
export function statDiff(a: FitStats, b: FitStats): StatDelta[] {
  const rows: StatDelta[] = [
    row('DPS (alpha)', a.summary.dps, b.summary.dps, 1, '', true),
    // comparing only alpha ranks a burst fit above a fit that actually holds
    // its damage — the two rows are a different question and both belong here
    row('DPS (sustained)', a.summary.dpsSustained, b.summary.dpsSustained, 1, '', true),
    row('Volley', a.summary.volley, b.summary.volley, 0, '', true),
    row('EHP', a.summary.ehp, b.summary.ehp, 0, '', true),
    row('Shield EHP', a.summary.shieldEhp, b.summary.shieldEhp, 0, '', true),
    row('Armor EHP', a.summary.armorEhp, b.summary.armorEhp, 0, '', true),
    row('Structure EHP', a.summary.structureEhp, b.summary.structureEhp, 0, '', true),
    row('Max velocity', a.summary.maxVelocity, b.summary.maxVelocity, 0, ' m/s', true),
    // LOWER is better — align time and signature are the two rows a naive
    // "bigger is greener" would colour backwards
    row('Align time', a.summary.alignTime, b.summary.alignTime, 2, ' s', false),
    row('Signature', a.summary.signatureRadius, b.summary.signatureRadius, 0, ' m', false),
    row('Targeting range', a.summary.targetRange, b.summary.targetRange, 0, ' m', true),
    row('Scan resolution', a.summary.scanResolution, b.summary.scanResolution, 0, ' mm', true),
    row('Cap capacity', a.cap.capacity, b.cap.capacity, 0, ' GJ', true),
    row('Cap delta', a.cap.peakDelta, b.cap.peakDelta, 2, ' GJ/s', true),
    row('CPU left', a.cpu.output - a.cpu.load, b.cpu.output - b.cpu.load, 1, ' tf', true),
    row('Power left', a.power.output - a.power.load, b.power.output - b.power.load, 1, ' MW', true),
    row('Calibration left', a.calibration.output - a.calibration.load, b.calibration.output - b.calibration.load, 0, '', true),
  ];
  return rows.filter((r) => Number.isFinite(r.a) && Number.isFinite(r.b));
}

/** did B improve on A? null when they are equal (within display precision) */
export function verdictOf(d: StatDelta): 'better' | 'worse' | null {
  const shown = Number(d.delta.toFixed(d.digits));
  if (shown === 0) return null;
  const better = d.higherIsBetter ? d.delta > 0 : d.delta < 0;
  return better ? 'better' : 'worse';
}
