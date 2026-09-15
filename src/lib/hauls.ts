// HAULS — the player's own history for sites that have no fixed value
// (v0.201): pirate relic and data cans are random, so the only honest
// estimate is what THIS player has actually pulled out of them. Each run
// is logged (site name, class, the loot pasted from the in-game inventory
// and appraised at Jita sell, or a typed total); the estimate for a site
// is the mean of its logged hauls, updated with every new one. Pure; the
// file lives in Documents/EVE Conductor/hauls.json (portable, beside
// config.json) and the Aperture summary tab is the only writer.
import type { SigGroup } from './chain';

export interface HaulItem { name: string; qty: number; /** ISK per unit at appraisal, null when unknown */ unit: number | null }
export interface Haul {
  id: string;
  /** ms */
  at: number;
  site: string;
  group: SigGroup;
  cls: string;
  system: string;
  characterId?: number;
  isk: number;
  items?: HaulItem[];
  note?: string;
}

export interface HaulsFile { v: 1; hauls: Haul[] }

/** the file, tolerant of garbage: only well-formed hauls survive */
export function parseHaulsFile(raw: unknown): HaulsFile {
  const out: HaulsFile = { v: 1, hauls: [] };
  const list = raw && typeof raw === 'object' && Array.isArray((raw as HaulsFile).hauls) ? (raw as HaulsFile).hauls : Array.isArray(raw) ? (raw as Haul[]) : [];
  for (const h of list) {
    if (!h || typeof h !== 'object') continue;
    const x = h as Partial<Haul>;
    if (typeof x.site !== 'string' || !x.site.trim() || typeof x.isk !== 'number' || !Number.isFinite(x.isk) || x.isk < 0) continue;
    out.hauls.push({
      id: typeof x.id === 'string' && x.id ? x.id : `${x.at ?? Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: typeof x.at === 'number' && Number.isFinite(x.at) ? x.at : Date.now(),
      site: x.site.trim(),
      group: (['Combat', 'Ore', 'Gas', 'Relic', 'Data', 'Wormhole', 'Other'] as SigGroup[]).includes(x.group as SigGroup) ? (x.group as SigGroup) : 'Other',
      cls: typeof x.cls === 'string' ? x.cls : '',
      system: typeof x.system === 'string' ? x.system : '',
      characterId: typeof x.characterId === 'number' ? x.characterId : undefined,
      isk: Math.round(x.isk),
      items: Array.isArray(x.items) ? x.items.filter((i): i is HaulItem => !!i && typeof i.name === 'string' && typeof i.qty === 'number').map((i) => ({ name: i.name, qty: i.qty, unit: typeof i.unit === 'number' ? i.unit : null })) : undefined,
      note: typeof x.note === 'string' && x.note ? x.note.slice(0, 200) : undefined,
    });
  }
  return out;
}

/**
 * Loot pasted from the in-game inventory (select all, Ctrl+C): one item
 * per line, tab-separated "Name<TAB>Quantity<TAB>Group…". Also accepts
 * "Name x3", "3 x Name" and a bare name (quantity 1). Header lines and
 * blanks are skipped; quantities may carry thousands separators.
 */
export function parseLootPaste(text: string): { name: string; qty: number }[] {
  const out: { name: string; qty: number }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^(name|item)\t/i.test(line)) continue;
    const cells = line.split('\t').map((c) => c.trim());
    if (cells.length >= 2) {
      const qty = parseInt(cells[1].replace(/[,.\s]/g, ''), 10);
      if (cells[0] && Number.isFinite(qty) && qty > 0) { out.push({ name: cells[0], qty }); continue; }
      if (cells[0] && cells[1] === '') { out.push({ name: cells[0], qty: 1 }); continue; }
    }
    const t = cells.join(' ').trim();
    let m = /^(.+?)\s+[x×]\s*(\d[\d,]*)$/i.exec(t);
    if (m) { out.push({ name: m[1].trim(), qty: parseInt(m[2].replace(/,/g, ''), 10) }); continue; }
    m = /^(\d[\d,]*)\s*[x×]\s+(.+)$/i.exec(t);
    if (m) { out.push({ name: m[2].trim(), qty: parseInt(m[1].replace(/,/g, ''), 10) }); continue; }
    if (t.length > 1 && !/^\d+$/.test(t)) out.push({ name: t, qty: 1 });
  }
  // merge repeated names
  const merged = new Map<string, number>();
  for (const i of out) merged.set(i.name, (merged.get(i.name) ?? 0) + i.qty);
  return [...merged].map(([name, qty]) => ({ name, qty }));
}

/** the site's tier word, so a site never run can borrow the average of
 * its tier across factions: relic Crumbling/Decayed/Ruined, data Local/
 * Regional/Central (and the Forgotten/Unsecured sleeper names, per class) */
export function tierOf(site: string): string {
  const m = /^(Crumbling|Decayed|Ruined|Local|Regional|Central|Forgotten|Unsecured)\b/i.exec(site.trim());
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : '';
}

export interface HaulAvg { n: number; mean: number; last: number; /** true when borrowed from the tier, not this site */ tier: boolean }

export interface HaulStats {
  bySite: Map<string, HaulAvg>;
  byTier: Map<string, HaulAvg>;
  /** the estimate for a site, or null when nothing has been logged that fits */
  lookup: (site: string, group: SigGroup) => HaulAvg | null;
}

export function haulStats(hauls: readonly Haul[]): HaulStats {
  const acc = (m: Map<string, { sum: number; n: number; last: number }>, key: string, h: Haul) => {
    const e = m.get(key) ?? { sum: 0, n: 0, last: 0 };
    e.sum += h.isk; e.n++; e.last = Math.max(e.last, h.at);
    m.set(key, e);
  };
  const site = new Map<string, { sum: number; n: number; last: number }>();
  const tier = new Map<string, { sum: number; n: number; last: number }>();
  for (const h of hauls) {
    acc(site, h.site, h);
    const t = tierOf(h.site);
    if (t) acc(tier, `${h.group}:${t}`, h);
  }
  const fin = (m: Map<string, { sum: number; n: number; last: number }>, isTier: boolean) =>
    new Map([...m].map(([k, e]) => [k, { n: e.n, mean: Math.round(e.sum / e.n), last: e.last, tier: isTier }]));
  const bySite = fin(site, false), byTier = fin(tier, true);
  return {
    bySite, byTier,
    lookup: (s, g) => bySite.get(s.trim()) ?? (tierOf(s) ? byTier.get(`${g}:${tierOf(s)}`) ?? null : null),
  };
}

export const haulBasis = (a: HaulAvg, site: string): string =>
  `your average of ${a.n} haul${a.n === 1 ? '' : 's'}${a.tier ? ` in ${tierOf(site)} sites` : ''} · last ${new Date(a.last).toISOString().slice(0, 10)}`;
