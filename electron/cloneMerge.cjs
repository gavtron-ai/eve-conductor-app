// THE SAME POD, MODIFIED (v0.200.6) — pure, no Electron.
//
// The clone registry keys pods by implant fingerprint, so plugging an
// implant into the pod you are wearing creates a NEW fingerprint while
// the old record stays — and the app then showed two pods, "what the pod
// used to be" and "the pod with the added implant". A pilot has exactly
// one body per fingerprint they are wearing or have parked as a jump
// clone. So the evidence is ESI's own clone list: after a poll that saw
// BOTH the worn fingerprint and the complete jump-clone list, any other
// record that was once worn, is not worn now and is not on that list is
// a body that no longer exists as such. When its implants differ from the
// worn pod by a small edit (plugged in, pulled out, up to two swapped) it
// was this pod before the change and is folded into it — the user's
// custom name and alert, EVE's name and the first-seen time carry over.
// A record that differs a lot is left alone (a podded pod, or a heavy
// refit): pinned ones stay, the rest age out with the 90-day prune.
//
// v0.200.5 tried a time-window rule (worn within 24 h, not listed since);
// the live registry had 48 once-worn records over 4 characters — years of
// edits — and the rule folded none of them. The clone list is the proof;
// this waits for it.

const setOf = (a) => new Set(Array.isArray(a) ? a : []);

/** implants plugged in / pulled out / swapped between two sets */
function implantEdit(oldImplants, newImplants) {
  const a = setOf(oldImplants), b = setOf(newImplants);
  const added = [...b].filter((x) => !a.has(x));
  const removed = [...a].filter((x) => !b.has(x));
  return { added, removed, oldSize: a.size, newSize: b.size };
}

/** true when the edit is one a pilot makes to the pod they are wearing */
function isSmallEdit(edit) {
  if (edit.oldSize === 0 || edit.newSize === 0) return false;
  if (edit.added.length === 0 && edit.removed.length === 0) return false;
  if (edit.removed.length === 0) return true;                          // plugged in (any number)
  if (edit.added.length === 0) return true;                            // pulled out / destroyed
  return edit.added.length <= 2 && edit.removed.length <= 2;           // swapped one or two
}

/** fold `oldSig` into `newSig`: labels, alert, EVE's name and first-seen
 * carry over; the old record goes. Returns the new byChar. */
function merge(byChar, oldSig, newSig) {
  const oldRec = byChar[oldSig];
  const newRec = byChar[newSig];
  if (!oldRec || !newRec) return byChar;
  const out = { ...byChar };
  const merged = { ...newRec };
  if (!merged.customName && oldRec.customName) merged.customName = oldRec.customName;
  if (!merged.alert && oldRec.alert) merged.alert = oldRec.alert;
  if (!merged.esiName && oldRec.esiName) merged.esiName = oldRec.esiName;
  merged.first = Math.min(oldRec.first || Infinity, newRec.first || Infinity);
  if (!Number.isFinite(merged.first)) delete merged.first;
  merged.supersedes = [...(merged.supersedes ? [].concat(merged.supersedes) : []), oldSig, ...(oldRec.supersedes ? [].concat(oldRec.supersedes) : [])];
  out[newSig] = merged;
  delete out[oldSig];
  return out;
}

/**
 * After a poll that recorded the worn pod AND the complete jump-clone list
 * (every listed record carries lastListed === listedAt): the BODIES the
 * pilot really has are the worn pod plus every listed jump clone. Every
 * once-worn record that is not one of them is a ghost; when its implants
 * are a small edit away from one of the bodies it was that body before
 * the change (the live registry's case: an 8-implant pod, one implant
 * plugged in → 9, then jumped out of — the ghost's successor is the jump
 * clone, not the pod worn now) and it folds into the closest body: the
 * smallest edit, ties to the body worn most recently.
 * @returns { byChar, folded: [{ oldSig, intoSig, edit }] }
 */
function sweepGhosts(byChar, wornSig, listedAt) {
  const worn = byChar[wornSig];
  if (!worn || !Array.isArray(worn.implants) || worn.implants.length === 0) return { byChar, folded: [] };
  const bodies = Object.entries(byChar).filter(([s, r]) => r && Array.isArray(r.implants) && r.implants.length > 0 && (s === wornSig || (r.lastListed || 0) >= listedAt));
  let out = byChar;
  const folded = [];
  for (const [s, r] of Object.entries(byChar)) {
    if (!r || !(r.lastWorn > 0)) continue;
    if (s === wornSig || (r.lastListed || 0) >= listedAt) continue;   // a body, not a ghost
    let best = null;
    for (const [bs, br] of bodies) {
      const edit = implantEdit(r.implants, br.implants);
      if (!isSmallEdit(edit)) continue;
      const size = edit.added.length + edit.removed.length;
      if (!best || size < best.size || (size === best.size && (br.lastWorn || 0) > best.lastWorn)) best = { sig: bs, edit, size, lastWorn: br.lastWorn || 0 };
    }
    if (!best) continue;
    out = merge(out, s, best.sig);
    folded.push({ oldSig: s, intoSig: best.sig, edit: best.edit });
  }
  return { byChar: out, folded };
}

module.exports = { implantEdit, isSmallEdit, merge, sweepGhosts };
