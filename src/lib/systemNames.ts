// SYSTEM NAMES THAT WORK IN WORMHOLE SPACE.
//
// The bundled map is K-SPACE ONLY (5,485 systems): no J-space, no Thera. A
// character living in a wormhole therefore gets a raw id — "system 31000376"
// — everywhere the app names a system. The overlay hit this first; the PI
// module hit it immediately, because wormhole PI is one of the main reasons
// to run planets at all.
//
// So: bundled map first (instant, offline), then ESI's public
// /universe/systems/{id}/ once per system, cached persistently.
import { getSystem } from './mapdata';
import { ESI_BASE } from './constants';
import { esiFetch } from './esiRate';

export interface SystemInfo {
  name: string;
  /** true security value; wormholes sit at -0.99, same as deep null */
  sec: number;
}

const KEY = 'eve-conductor-systems-v1';

const cache = new Map<number, SystemInfo>(
  (() => {
    try {
      return Object.entries(JSON.parse(localStorage.getItem(KEY) ?? '{}'))
        .map(([k, v]) => [Number(k), v as SystemInfo] as [number, SystemInfo]);
    } catch {
      return [];
    }
  })(),
);

function remember(id: number, v: SystemInfo): void {
  cache.set(id, v);
  try {
    localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(cache)));
  } catch {
    // the cache is a convenience — never break a screen over it
  }
}

/** WORMHOLE SPACE BY ID RANGE. J-space cannot be told apart by security:
 * it reads -0.99, exactly like deep nullsec. 31000000-31999999 includes Thera. */
export const isWormhole = (systemId: number | undefined | null): boolean =>
  systemId !== undefined && systemId !== null && systemId >= 31000000 && systemId < 32000000;

/** what we know right now, without asking anyone */
export function knownSystem(id: number): SystemInfo | null {
  const local = getSystem(id);
  if (local) return { name: local.name, sec: local.sec };
  return cache.get(id) ?? null;
}

/** a name to render immediately — falls back to the id, never to nothing */
export function systemLabel(id: number): string {
  return knownSystem(id)?.name ?? (isWormhole(id) ? `J-space ${id}` : `system ${id}`);
}

/** systems we asked about and failed on -> when we may try again. One failed
 * lookup must not be permanent for the session. */
const failedUntil = new Map<number, number>();
const RETRY_MS = 5 * 60_000;

/** Resolve a batch, filling the cache. Safe to call repeatedly. */
export async function resolveSystems(ids: number[]): Promise<void> {
  const now = Date.now();
  const todo = [...new Set(ids)].filter((id) => {
    if (knownSystem(id)) return false;
    const until = failedUntil.get(id);
    return until === undefined || now >= until;
  });
  for (const id of todo) {
    failedUntil.set(id, Date.now() + RETRY_MS);
    try {
      const res = await esiFetch(`${ESI_BASE}/universe/systems/${id}/`, {
        headers: { Accept: 'application/json' },
      }, { lane: 'background' });
      if (!res.ok) continue;
      const j = (await res.json()) as { name?: string; security_status?: number };
      if (typeof j.name !== 'string') continue;
      remember(id, { name: j.name, sec: typeof j.security_status === 'number' ? j.security_status : -1 });
      failedUntil.delete(id);
    } catch {
      // leave it for the retry window
    }
  }
}
