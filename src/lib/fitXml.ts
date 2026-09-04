// EVE FITTING XML — the bulk path that bypasses the API entirely.
//
// The EVE client imports a whole file of fits from Documents/EVE/fittings/
// in one action, client-side, instantly. No ESI, no tokens, no rate limit.
// For hundreds of fits that is seconds instead of hours.
//
// FORMAT VERIFIED FROM CCP'S OWN EXPORT (the user's
// Documents/EVE/fittings/1.xml, written by the game client itself — a far
// better source than the docs, which only show one partial example):
//
//   <?xml version="1.0" ?>
//   <fittings>
//     <fitting name="*3xF_t2exda-gem">
//       <description value=""/>
//       <shipType value="Hawk"/>
//       <hardware slot="hi slot 0" type="Light Missile Launcher II"/>
//       <hardware qty="6000" slot="cargo" type="Mjolnir Rage Rocket"/>
//     </fitting>
//   </fittings>
//
// Slot spellings the client itself emits: "hi slot N" (not "high"),
// "med slot N", "low slot N" (not "lo"), "rig slot N", "subsystem slot N",
// "drone bay", "cargo". Indices seen: hi 0-7, med 0-6, low 0-6, rig 0-2,
// subsystem 0-3. `qty` is used for stacks (cargo, drones).
import { typeNameOf, type RawFitItem } from './fitSerial';

/** ESI flag -> the slot string the EVE client writes and reads */
export function xmlSlot(flag: string): string | null {
  const m = /^([A-Za-z]+?)(\d+)$/.exec(flag);
  if (m) {
    const kind = m[1];
    const idx = Number(m[2]);
    switch (kind) {
      case 'HiSlot': return `hi slot ${idx}`;
      case 'MedSlot': return `med slot ${idx}`;
      case 'LoSlot': return `low slot ${idx}`;
      case 'RigSlot': return `rig slot ${idx}`;
      case 'SubSystemSlot': return `subsystem slot ${idx}`;
      // NOT seen in the client's own export (no Upwell fits in the sample),
      // so this spelling is inferred from the pattern rather than verified.
      case 'ServiceSlot': return `service slot ${idx}`;
      case 'FighterTube': return 'fighter bay';
      default: return null;
    }
  }
  if (flag === 'DroneBay') return 'drone bay';
  if (flag === 'FighterBay') return 'fighter bay';
  if (flag === 'Cargo') return 'cargo';
  return null; // 'Invalid' and anything unknown are dropped, as EVE drops them
}

/**
 * ESI RETURNS NAMES ALREADY HTML-ESCAPED. A fit the user called "<3" comes
 * back as "&lt;3", so escaping it again produced "&amp;lt;3" and the fit
 * imported literally named "&lt;3". Decode first, then escape exactly once.
 * (Verified against this user's real fits: "Stork &lt;3", "&lt;3".)
 */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // &amp; LAST, so "&amp;lt;" becomes "&lt;" not "<"
    .replace(/&amp;/gi, '&');
}

const esc = (raw: string): string =>
  decodeEntities(raw)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

export interface XmlFit {
  name: string;
  shipTypeId: number;
  items: RawFitItem[];
  description?: string;
}

export interface XmlResult {
  xml: string;
  /** fits written */
  count: number;
  /** fits SKIPPED because a type name could not be resolved — the client
   * matches by NAME, so an unresolved id would import as a broken fit */
  skipped: { name: string; reason: string }[];
}

/**
 * Build a multi-fit file. Items whose type or slot cannot be named are a
 * REFUSAL, not a silent omission: the client matches on the name string, so
 * a fit missing a module would import looking complete and be wrong.
 */
export function buildFittingXml(fits: XmlFit[]): XmlResult {
  // MATCH CCP'S OWN FRAMING EXACTLY, tab and all.
  //
  // The client writes "	<fittings>" — the root element INDENTED — and
  // closes with "	</fittings>". A strict XML parser does not care (leading
  // whitespace before the root is legal), but the EVE importer is evidently
  // not strict: a file identical in every other byte, whose fits the import
  // dialog listed correctly, would not import. This was the only remaining
  // difference. Emitting exactly what CCP emits is the right default anyway.
  const lines: string[] = ['<?xml version="1.0" ?>', '	<fittings>'];
  const skipped: { name: string; reason: string }[] = [];
  let count = 0;

  for (const f of fits) {
    const hull = typeNameOf(f.shipTypeId);
    if (hull.startsWith('#')) {
      skipped.push({ name: f.name, reason: `hull type ${f.shipTypeId} has no name in the local database` });
      continue;
    }
    const rows: string[] = [];
    let bad: string | null = null;
    for (const it of f.items) {
      if (it.flag === 'Invalid') continue; // EVE discards these anyway
      const slot = xmlSlot(it.flag);
      if (slot === null) continue; // unknown container — not part of the fit
      const name = typeNameOf(it.type_id);
      if (name.startsWith('#')) {
        bad = `item type ${it.type_id} has no name in the local database`;
        break;
      }
      const qty = Math.max(1, it.quantity);
      // the client emits qty only for stacks; matching that keeps the file
      // byte-similar to its own output
      const qtyAttr = qty > 1 ? ` qty="${qty}"` : '';
      rows.push(`\t\t\t<hardware${qtyAttr} slot="${esc(slot)}" type="${esc(name)}"/>`);
    }
    if (bad !== null) {
      skipped.push({ name: f.name, reason: bad });
      continue;
    }
    if (rows.length === 0) {
      skipped.push({ name: f.name, reason: 'no fittable items' });
      continue;
    }
    lines.push(`\t\t<fitting name="${esc(f.name)}">`);
    lines.push(`\t\t\t<description value="${esc(f.description ?? '')}"/>`);
    lines.push(`\t\t\t<shipType value="${esc(hull)}"/>`);
    lines.push(...rows);
    lines.push('\t\t</fitting>');
    count++;
  }
  lines.push('	</fittings>');
  return { xml: lines.join('\n') + '\n', count, skipped };
}
