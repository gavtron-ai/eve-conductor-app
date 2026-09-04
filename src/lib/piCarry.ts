// PI CARRY-FORWARD — pure, fixtured.
//
// The module must NEVER open empty when the app has data from ANY earlier
// run (user report v0.175: silent update relaunches wiped the in-memory
// list every ship, so the page sat blank until the next 11-minute tick).
// The collector persists its last computed state; on the next tick, a
// planet that could not be re-read is CARRIED FORWARD as last-known rather
// than silently dropped — rule 3's inverse: dropping a real planet because
// one HTTP call failed is the same lie as recording an unread one as empty.
//
// Per-planet semantics:
//   · character's planet LIST read failed  → keep all their previous planets
//   · list read OK, planet ABSENT from it  → truly gone, drop it
//   · listed, but the DETAIL read failed   → carry that planet's last state
//   · fresh state exists                   → fresh wins
//   · character no longer watched          → drop

export interface CarryKey { charId: number; planetId: number }

export function mergeCarryForward<T extends CarryKey>(
  prev: T[],
  fresh: T[],
  /** charId → the planet ids a SUCCESSFUL list fetch reported this tick */
  listed: Map<number, Set<number>>,
  watched: Set<number>,
): T[] {
  const freshKeys = new Set(fresh.map((p) => `${p.charId}:${p.planetId}`));
  const kept = prev.filter((p) => {
    if (!watched.has(p.charId)) return false;
    if (freshKeys.has(`${p.charId}:${p.planetId}`)) return false;
    const ids = listed.get(p.charId);
    if (ids === undefined) return true; // list read failed — assume unchanged
    return ids.has(p.planetId); // listed but unreadable — carry last known
  });
  return [...fresh, ...kept];
}
