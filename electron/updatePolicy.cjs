// EMERGENCY UPDATES (v0.217.0).
//
// WHY: on 2026-09-20 Aperture's developer told the owner that every copy of this app was costing
// their server thousands of requests a day. The fix was written and published within hours — and
// then sat unused, because an update only installs when the app QUITS and this app is built to be
// left running in the tray for days. There was no way to make the fix reach anyone. A tool that
// can harm a third party must be able to stop doing so without waiting for its users.
//
// HOW: the owner decides, per release, at go-live, whether it is an emergency:
//     npm run publish:beta -- --emergency "why, in one sentence"
// The publish script writes two fields into latest.yml (the feed file the updater already reads):
//     emergency: true
//     emergencyReason: "…"
// electron-updater parses that file as-is and hands every field to the app (checked in
// node_modules/electron-updater: Provider.parseUpdateInfo returns the raw YAML object and the
// GitHub provider spreads it). When an update carrying the marker has finished downloading, the
// app says so, counts down, and restarts into it BY ITSELF — silent install, relaunch, collectors
// resume. An ordinary update behaves exactly as before: a banner, installed when the user restarts.
//
// WHAT THIS IS NOT: a remote switch. The only thing the feed can do is make a signed-off release
// install sooner; it cannot run code, change settings or disable features in an installed copy.
// And it only reaches copies that already have this code (0.217.0 and later).
//
// Pure functions only — fixtures in tests/updatepolicy.test.cjs.

/** a visible warning before the restart: long enough to read, short enough to be an emergency */
const EMERGENCY_COUNTDOWN_MS = 60_000;
/** how often the feed is checked (was 4 h — too slow for an emergency; the file is ~400 bytes) */
const CHECK_EVERY_MS = 60 * 60_000;
const REASON_MAX = 240;
/** an update downloaded in an EARLIER run installs at this start after this much warning */
const PENDING_COUNTDOWN_MS = 20_000;

/** is this feed entry marked as an emergency? Only a real boolean `true` counts. */
function emergencyOf(info) {
  const on = !!info && typeof info === 'object' && info.emergency === true;
  const raw = on && typeof info.emergencyReason === 'string' ? info.emergencyReason : '';
  return { emergency: on, reason: raw.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX) };
}

/** latest.yml with the marker set (reason given) or cleared (reason null) — never doubled */
function withEmergencyMarker(yml, reason) {
  const kept = String(yml).replace(/\r\n/g, '\n').split('\n').filter((l) => !/^emergency(Reason)?:/.test(l));
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  if (reason === null || reason === undefined) return kept.join('\n') + '\n';
  const clean = String(reason).replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
  if (!clean) throw new Error('an emergency release needs a reason — it is shown to every user before their app restarts');
  // JSON's string form is valid YAML: quotes, colons and hashes in the reason cannot break the file
  return kept.join('\n') + `\nemergency: true\nemergencyReason: ${JSON.stringify(clean)}\n`;
}

/**
 * AN UPDATE THAT WAS NEVER INSTALLED (v0.219.0). electron-updater installs a downloaded update from
 * the app's quit hook — a Task Manager kill never runs it, and the next start just re-validates the
 * cached installer and shows the banner again (Aperture's developer: "didn't update even after
 * quitting from the task manager"). So: the app remembers, per run, which version it has downloaded;
 * when the SAME version is downloaded again in a LATER run, the app has been restarted without
 * installing it, and it installs now. A download in the current run still waits for a restart.
 * @param marker  what was persisted by the last sighting ({version, runId, at}) or null
 * @param runId   this process's id — different every start
 */
function pendingSighting(marker, version, runId, now) {
  const m = marker && typeof marker === 'object' ? marker : null;
  const installNow = !!m && typeof version === 'string' && version !== '' && m.version === version && typeof m.runId === 'string' && m.runId !== runId;
  return { installNow, marker: { version: String(version || ''), runId: String(runId), at: now } };
}

module.exports = { emergencyOf, withEmergencyMarker, pendingSighting, EMERGENCY_COUNTDOWN_MS, PENDING_COUNTDOWN_MS, CHECK_EVERY_MS };
