// PURE: ESI hands back some player-set names as PYTHON REPR strings —
// `u'\u2764 DAILY-(c)'` where the pilot typed `❤ DAILY-(c)`. Anything that
// isn't a repr comes back untouched.
export function decodeEsiName(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = /^[ub]*(['"])([\s\S]*)\1$/.exec(raw.trim());
  if (!m) return raw;
  return m[2]
    .replace(/\\U([0-9a-fA-F]{8})/g, (_s, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_s, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_s, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\(['"\\])/g, '$1');
}
