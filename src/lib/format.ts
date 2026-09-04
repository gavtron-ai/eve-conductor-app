const full = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** 1234567.8 -> "1,234,567.80" */
export function isk(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return full.format(n);
}

/** compact ISK for dense tables: 1.23b / 45.6m / 789.0k */
export function iskShort(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return (n / 1e9).toFixed(2) + 'b';
  if (abs >= 1e6) return (n / 1e6).toFixed(2) + 'm';
  if (abs >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return full.format(n);
}

export function int(n: number): string {
  if (!Number.isFinite(n)) return '—';
  return whole.format(n);
}

export function pct(fraction: number, digits = 1): string {
  if (!Number.isFinite(fraction)) return '—';
  return (fraction * 100).toFixed(digits) + '%';
}

export function m3(n: number): string {
  if (!Number.isFinite(n)) return '—';
  // items like PLEX are 0.0002 m³ — two decimals would show a misleading 0.00
  if (n > 0 && n < 0.01) return `${n.toPrecision(2).replace(/0+$/, '')} m³`;
  return `${full.format(n)} m³`;
}
