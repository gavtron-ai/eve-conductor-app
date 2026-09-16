// THE SETUP WINDOW — every pod the app has seen, per character, with a
// custom name and an alert per clone.
//
// WHY THIS EXISTS (user's words): "This will help me not accidentally bring
// my learning pod into a fight." A clone is recognised by its implant
// fingerprint, so a flag set here follows that clone across jumps, sessions
// and machines — it is not tied to a ship, a station or a name EVE might
// drop.
//
// This runs in its OWN window (see overlay.cjs): the overlay is created
// focusable:false so it can never steal focus from the game, which also
// means it can never accept typed text.
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CloneRegistry, CloneRecord } from '../lib/cloneNames';
import ZoomControl from './ZoomControl';
import { useZoom } from '../lib/zoom';
import { DEFAULT_MINING_ALERT, miningAlertSettings, type MiningAlertSettings } from '../lib/store';
import { alertText } from '../lib/miningWatch';
import {
  ALERTS_SNAPSHOT_KEY, MUTES_KEY, clearMutes, miningKey, mute, muteAll, muteReason, parseMutes, parseSnapshot, piKey, pruneMutes, raidKey, unmute,
  type AlertsSnapshot, type MuteStore,
} from '../lib/overlayMutes';

type Tab = 'pods' | 'notice' | 'raid' | 'mining' | 'alerts';
const TABS: Tab[] = ['pods', 'notice', 'raid', 'mining', 'alerts'];
/** '#clone-config/alerts' opens on that page (Alt+] in game) */
const tabFromHash = (): Tab => {
  const t = window.location.hash.split('/')[1] as Tab | undefined;
  return t && TABS.includes(t) ? t : 'pods';
};

/** must track OVERLAY_POLL_MS in overlayFeed.ts. Deliberately NOT imported:
 * that module loads the whole dogma catalog on import, and this window has
 * no use for it. */
const POLL_MS = 6_000;
/** three polls — one dropped poll must not flicker the badge off */
const WORN_WINDOW_MS = 3 * POLL_MS;
const NAME_SAVE_DEBOUNCE_MS = 300;

const PRESET_COLORS = ['#ff4d4d', '#ffa53d', '#ffe14d', '#4dff88', '#4dd2ff', '#c77dff'];
const DEFAULT_COLOR = '#ff4d4d';

/** the registry is keyed by character id then fingerprint; the UI wants a
 * flat, sorted list per character */
interface Row extends CloneRecord {
  characterId: number;
  sig: string;
}

function rowsOf(reg: CloneRegistry): Map<string, Row[]> {
  const byCharacter = new Map<string, Row[]>();
  for (const [charId, clones] of Object.entries(reg.chars ?? {})) {
    for (const [sig, rec] of Object.entries(clones)) {
      const name = rec.characterName || `character ${charId}`;
      if (!byCharacter.has(name)) byCharacter.set(name, []);
      byCharacter.get(name)!.push({ ...rec, characterId: Number(charId), sig });
    }
  }
  for (const list of byCharacter.values()) {
    // the pod they're wearing first, then most recently seen
    list.sort((a, b) => (b.lastWorn ?? 0) - (a.lastWorn ?? 0) || (b.seen ?? 0) - (a.seen ?? 0));
  }
  return new Map([...byCharacter.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

const ago = (t: number): string => {
  if (!t) return 'never';
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 90) return `${s}s ago`;
  if (s < 5400) return `${Math.round(s / 60)}m ago`;
  if (s < 172800) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

export default function CloneConfig() {
  const [reg, setReg] = useState<CloneRegistry>({ v: 1, chars: {} });
  // this window's own zoom level (keys handled by the header control)
  const { zoom: zoomLevel } = useZoom('clone-config');
  const [filter, setFilter] = useState('');
  /** typed text lives here until it's committed, so the registry broadcast
   * can't yank the caret out from under the user mid-word */
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** pending per-row name saves, so a debounce can be cancelled when the
   * same row commits on blur */
  const saveTimers = useRef<Record<string, number>>({});
  // the "wearing now" badge has to decay against the WALL CLOCK. Comparing
  // two stored timestamps to each other kept it lit on a pod the pilot had
  // already jumped out of, and lit forever once observations stopped.
  const [now, setNow] = useState(Date.now());

  // which section is on screen — tabs beat scrolling past ~40 clones to reach
  // the raid-alert settings (user ask, v0.142)
  const [tab, setTab] = useState<Tab>(tabFromHash);
  /** per-character expand/collapse in the pod list (collapsed by default) */
  const [open, setOpen] = useState<Record<string, boolean>>({});

  // the overlay's ON/OFF switch lives HERE now (v0.139) — this window is the
  // overlay's settings. The main process broadcasts every open/close, so the
  // switch stays true whichever window (or Alt+\) flipped it.
  const [overlayOn, setOverlayOn] = useState(false);

  // RAID-ALERT SETTINGS (v0.141) — this window edits exactly two settings keys.
  // It does NOT go through this window's zustand store: persist writes the
  // WHOLE state, and a stale copy here would clobber whatever the main window
  // saved since this window opened. Instead: targeted read-modify-write of the
  // persisted JSON; the main window syncs via the cross-window 'storage' event.
  const [raidAlert, setRaidAlert] = useState(true);
  const [raidJumps, setRaidJumps] = useState(3);
  useEffect(() => {
    try {
      const s = (JSON.parse(localStorage.getItem('eve-trade-conductor') ?? '') as
        { state?: { settings?: { raidAlert?: boolean; raidAlertJumps?: number } } }).state?.settings ?? {};
      setRaidAlert(s.raidAlert !== false);
      setRaidJumps(s.raidAlertJumps ?? 3);
    } catch { /* defaults stand */ }
  }, []);
  const readPiOverlay = (): boolean => {
    try {
      const raw = JSON.parse(localStorage.getItem('eve-trade-conductor') ?? '{}') as
        { state?: { alerts?: { piOverlay?: boolean } } };
      return raw.state?.alerts?.piOverlay !== false;
    } catch { return true; }
  };
  const [piOverlay, setPiOverlay] = useState<boolean>(readPiOverlay);
  const patchPiOverlay = (on: boolean) => {
    setPiOverlay(on);
    try {
      const raw = JSON.parse(localStorage.getItem('eve-trade-conductor') ?? '{}') as
        { state?: { alerts?: Record<string, unknown> } };
      raw.state = raw.state ?? {};
      raw.state.alerts = { ...(raw.state.alerts ?? {}), piOverlay: on };
      localStorage.setItem('eve-trade-conductor', JSON.stringify(raw));
    } catch { /* a lost patch is a nuisance, not a failure */ }
  };

  // the ⛏ MINING ALERT settings (v0.202) — same targeted patch of alerts.*
  const readMining = (): MiningAlertSettings => {
    try {
      const raw = JSON.parse(localStorage.getItem('eve-trade-conductor') ?? '{}') as
        { state?: { alerts?: { mining?: Partial<MiningAlertSettings> } } };
      return miningAlertSettings(raw.state?.alerts?.mining);
    } catch { return { ...DEFAULT_MINING_ALERT }; }
  };
  const [mining, setMining] = useState<MiningAlertSettings>(readMining);
  const patchMining = (patch: Partial<MiningAlertSettings>) => {
    const next = { ...mining, ...patch };
    setMining(next);
    try {
      const raw = JSON.parse(localStorage.getItem('eve-trade-conductor') ?? '{}') as
        { state?: { alerts?: Record<string, unknown> } };
      raw.state = raw.state ?? {};
      raw.state.alerts = { ...(raw.state.alerts ?? {}), mining: next };
      localStorage.setItem('eve-trade-conductor', JSON.stringify(raw));
    } catch { /* a lost patch is a nuisance, not a failure */ }
  };

  // the ALERTS page (v0.202.1): what the overlay is showing right now (the
  // main window writes a snapshot on every push) and the mutes this window
  // writes for it. Both live under their own keys; the cross-window
  // 'storage' event keeps the list live.
  const [snap, setSnap] = useState<AlertsSnapshot | null>(() => { try { return parseSnapshot(localStorage.getItem(ALERTS_SNAPSHOT_KEY)); } catch { return null; } });
  const [mutes, setMutes] = useState<MuteStore>(() => { try { return parseMutes(localStorage.getItem(MUTES_KEY)); } catch { return parseMutes(null); } });
  const writeMutes = (m: MuteStore) => {
    setMutes(m);
    try { localStorage.setItem(MUTES_KEY, JSON.stringify(m)); } catch { /* nicety */ }
  };
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ALERTS_SNAPSHOT_KEY) setSnap(parseSnapshot(e.newValue));
      if (e.key === MUTES_KEY) setMutes(parseMutes(e.newValue));
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const patchRaidSettings = (patch: { raidAlert?: boolean; raidAlertJumps?: number }) => {
    try {
      const raw = JSON.parse(localStorage.getItem('eve-trade-conductor') ?? '{}') as
        { state?: { settings?: Record<string, unknown> } };
      raw.state = raw.state ?? {};
      raw.state.settings = { ...(raw.state.settings ?? {}), ...patch };
      localStorage.setItem('eve-trade-conductor', JSON.stringify(raw));
    } catch { /* a lost patch is a nuisance, not a failure */ }
  };

  useEffect(() => {
    window.appInfo?.clones?.onChanged((r: CloneRegistry) => setReg(r ?? { v: 1, chars: {} }));
    void window.appInfo?.clones?.all().then((r: CloneRegistry) => { if (r) setReg(r); });
    void window.appInfo?.overlay?.isOpen().then((on) => setOverlayOn(on));
    window.appInfo?.overlay?.onOpenChanged?.((on) => setOverlayOn(on));
    // Alt+] while this window is already open: main asks for the Alerts page
    window.appInfo?.clones?.onConfigTab?.((t) => { if (TABS.includes(t as Tab)) setTab(t as Tab); });
    const t = setInterval(() => setNow(Date.now()), 2_000);
    const timers = saveTimers.current;
    return () => {
      clearInterval(t);
      for (const id of Object.values(timers)) window.clearTimeout(id);
    };
  }, []);

  const groups = useMemo(() => rowsOf(reg), [reg]);
  const key = (r: Row) => `${r.characterId}:${r.sig}`;

  const save = (r: Row, patch: { customName?: string; alert?: { blink: boolean; color: string } | null }) => {
    void window.appInfo?.clones?.setConfig({ characterId: r.characterId, sig: r.sig, ...patch });
  };

  const matches = (r: Row) => {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return [r.customName, r.esiName, r.label, r.characterName, ...(r.names ?? [])]
      .filter(Boolean).join(' ').toLowerCase().includes(q);
  };

  const total = [...groups.values()].reduce((n, l) => n + l.length, 0);

  return (
    <div className="cfg-root" style={{ zoom: zoomLevel }}>
      <header className="cfg-head">
        <div>
          <h1>Multibox Overlay Settings</h1>
          <p className="cfg-sub">
            Everything the floating overlay shows over the game. Position any box with <b>Alt+\</b> in
            game — boxes with nothing to show right now appear as draggable templates so you can place
            them before they&apos;re ever needed.
          </p>
        </div>
        <div className="cfg-actions">
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer', whiteSpace: 'nowrap' }}
            title="Show or hide the multibox overlay (the floating per-character boxes over the game). This window stays open either way.">
            <input type="checkbox" checked={overlayOn}
              onChange={() => void window.appInfo?.overlay?.set(!overlayOn).then((on) => setOverlayOn(on))} />
            <span style={{ fontWeight: 700, color: overlayOn ? '#7CFC00' : undefined }}>
              overlay {overlayOn ? 'ON' : 'off'}
            </span>
          </label>
          {tab === 'pods' && (
            <input className="cfg-filter" placeholder="filter clones…" value={filter}
              onChange={(e) => setFilter(e.target.value)} />
          )}
          <ZoomControl screen="clone-config" compact />
          <button onClick={() => void window.appInfo?.clones?.closeConfig()}>Done</button>
        </div>
      </header>

      <nav className="tabs" style={{ marginBottom: 14 }}>
        <button className={tab === 'pods' ? 'on' : ''} onClick={() => setTab('pods')}>🧍 Pod Overlay</button>
        <button className={tab === 'notice' ? 'on' : ''} onClick={() => setTab('notice')}>⚠ Notification Box</button>
        <button className={tab === 'raid' ? 'on' : ''} onClick={() => setTab('raid')}>🎯 Raid Alert</button>
        <button className={tab === 'mining' ? 'on' : ''} onClick={() => setTab('mining')}>⛏ Mining Alert</button>
        <button className={tab === 'alerts' ? 'on' : ''} onClick={() => setTab('alerts')}>🔔 Alerts</button>
      </nav>

      {tab === 'pods' && (<>
      <p className="cfg-sub" style={{ marginBottom: 12 }}>
        Every pod EVE Conductor has seen you wearing, identified by its implants. Name one and the
        name follows it everywhere. Flag one and its box lights up on the overlay — so a learning
        pod can&apos;t quietly follow you into a fight.
      </p>

      {total === 0 && (
        <div className="cfg-empty">
          <p>No clones recorded yet.</p>
          <p className="cfg-hint">
            Clones appear here as the overlay polls: the pod a character is wearing shows up within a
            few seconds, and every other clone within about two minutes. If nothing ever appears, the
            character may need to be logged out and back in to grant the clone-read scope.
          </p>
        </div>
      )}

      {[...groups.entries()].map(([charName, list]) => {
        const shown = list.filter(matches);
        if (shown.length === 0) return null;
        // COLLAPSED by default (user ask, v0.143): the point of the list is
        // finding ONE character, not scrolling past everyone's pods. A typed
        // filter force-expands the matches — a filter that finds things you
        // can't see would look broken.
        const expanded = (open[charName] ?? false) || filter.trim().length > 0;
        const flagged = shown.filter((r) => r.alert).length;
        return (
          <section key={charName} className="cfg-char">
            <h2 style={{ cursor: 'pointer', userSelect: 'none' }}
              title={expanded ? 'click to collapse' : 'click to show this character’s pods'}
              onClick={() => setOpen((o) => ({ ...o, [charName]: !expanded }))}>
              <span style={{ display: 'inline-block', width: 16, fontSize: 12 }}>{expanded ? '▾' : '▴'}</span>
              {charName} <span className="cfg-count">{shown.length} clone{shown.length === 1 ? '' : 's'}{flagged > 0 ? ` · ${flagged} ⚑` : ''}</span>
            </h2>
            {expanded && shown.map((r) => {
              const k = key(r);
              const worn = r.lastWorn > 0 && now - r.lastWorn < WORN_WINDOW_MS;
              const alert = r.alert ?? null;
              const shownName = draft[k] ?? r.customName ?? '';
              return (
                <div key={k} className={`cfg-clone ${alert ? 'flagged' : ''}`}
                  style={alert ? ({ ['--alert' as string]: alert.color } as React.CSSProperties) : undefined}>
                  <div className="cfg-clone-main">
                    <div className="cfg-names">
                      <input
                        className="cfg-name"
                        placeholder={r.esiName || r.label || 'name this clone'}
                        value={shownName}
                        onChange={(e) => {
                          // COMMIT AS THEY TYPE (debounced). Saving only on
                          // blur lost the name whenever the window was closed
                          // the documented way — Alt+\ destroys it without
                          // ever firing blur.
                          const v = e.target.value;
                          setDraft((d) => ({ ...d, [k]: v }));
                          window.clearTimeout(saveTimers.current[k]);
                          saveTimers.current[k] = window.setTimeout(() => {
                            delete saveTimers.current[k];
                            save(r, { customName: v });
                          }, NAME_SAVE_DEBOUNCE_MS);
                        }}
                        onBlur={() => {
                          window.clearTimeout(saveTimers.current[k]);
                          delete saveTimers.current[k];
                          if (draft[k] !== undefined && draft[k] !== (r.customName ?? '')) {
                            save(r, { customName: draft[k] });
                          }
                          setDraft((d) => { const n = { ...d }; delete n[k]; return n; });
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                      />
                      <div className="cfg-meta">
                        {worn && <span className="cfg-badge worn">wearing now</span>}
                        <span className="cfg-badge">{r.label || 'unnamed'}</span>
                        {r.esiName && <span className="cfg-badge esi">EVE: {r.esiName}</span>}
                        <span className="cfg-when">seen {ago(r.seen)}</span>
                      </div>
                    </div>
                    <div className="cfg-alert">
                      <label className="cfg-toggle">
                        <input type="checkbox" checked={Boolean(alert)}
                          onChange={(e) => save(r, {
                            alert: e.target.checked ? { blink: true, color: alert?.color ?? DEFAULT_COLOR } : null,
                          })} />
                        <span>alert</span>
                      </label>
                      {alert && (
                        <>
                          <label className="cfg-toggle">
                            <input type="checkbox" checked={alert.blink}
                              onChange={(e) => save(r, { alert: { blink: e.target.checked, color: alert.color } })} />
                            <span>blink</span>
                          </label>
                          <div className="cfg-swatches">
                            {PRESET_COLORS.map((c) => (
                              <button key={c} className={`cfg-swatch ${alert.color.toLowerCase() === c ? 'on' : ''}`}
                                style={{ background: c }} title={c}
                                onClick={() => save(r, { alert: { blink: alert.blink, color: c } })} />
                            ))}
                          </div>
                        </>
                      )}
                      <button className="cfg-forget" title="forget this clone — it reappears if seen again"
                        onClick={() => void window.appInfo?.clones?.forget({ characterId: r.characterId, sig: r.sig })}>
                        forget
                      </button>
                    </div>
                  </div>
                  <div className="cfg-implants">
                    {(r.names ?? []).length === 0
                      ? <span className="cfg-none">no implants recorded</span>
                      : (r.names ?? []).map((n, i) => <span key={`${n}-${i}`} className="cfg-implant">{n}</span>)}
                  </div>
                </div>
              );
            })}
          </section>
        );
      })}
      </>)}

      {tab === 'notice' && (
      <section style={{ margin: '0 0 20px' }}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px', borderBottom: '1px solid rgba(128,128,128,.25)', paddingBottom: 4 }}>⚠ Notification Box</h2>
        <p className="cfg-sub">
          Appears only when something needs saying — EVE API down, login (SSO) trouble, or rate limiting —
          and explains it in plain language. Position its template with <b>Alt+\</b> in game. Notice boxes
          (this one, 🪐 planets, 🎯 raids, ⛏ mining) each have a width of their own — drag a corner in setup mode to change
          it; the pod boxes keep their separate shared size.
        </p>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, marginTop: 8 }}>
          <input type="checkbox" checked={piOverlay}
            onChange={(e) => patchPiOverlay(e.target.checked)} />
          show urgent PLANET warnings on the overlay (its own 🪐 box: storage full / producing
          nothing / fills within hours — the states that are actively costing ISK)
        </label>
      </section>
      )}

      {tab === 'raid' && (
      <section style={{ margin: '0 0 20px' }}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px', borderBottom: '1px solid rgba(128,128,128,.25)', paddingBottom: 4 }}>🎯 Raid Alert</h2>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}
            title="Show raidable skyhooks near your imported Theft map as an amber box on the overlay.">
            <input type="checkbox" checked={raidAlert}
              onChange={() => { const next = !raidAlert; setRaidAlert(next); patchRaidSettings({ raidAlert: next }); }} />
            <span style={{ fontWeight: 700, color: raidAlert ? '#7CFC00' : undefined }}>raid alert {raidAlert ? 'ON' : 'off'}</span>
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}
            title="How many stargate jumps from a system on your imported map still counts as 'near'.">
            <span>Radius: {raidJumps} jump{raidJumps === 1 ? '' : 's'} of my map</span>
            <input type="range" min={0} max={10} value={raidJumps} style={{ width: 160 }}
              onChange={(e) => { const v = Number(e.target.value); setRaidJumps(v); patchRaidSettings({ raidAlertJumps: v }); }} />
          </label>
        </div>
        <p className="cfg-sub" style={{ marginTop: 6 }}>
          Flags skyhooks whose theft window is open (or opening soon) within the radius of your imported
          Theft map. The map refreshes itself from Aperture in the background while this is on — you never
          need to open the Theft Conductor. The Theft Conductor&apos;s “open now only” filter also scopes this box.
        </p>
      </section>
      )}

      {tab === 'mining' && (
      <section style={{ margin: '0 0 20px' }}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px', borderBottom: '1px solid rgba(128,128,128,.25)', paddingBottom: 4 }}>⛏ Mining Alert</h2>
        <p className="cfg-sub">
          Every mining cycle that finishes writes a <i>“You mined …”</i> line to that character&apos;s own game log,
          one line per module. The app follows each character&apos;s live log (read-only — nothing is ever written to
          the game&apos;s files), learns their cycle length from those lines, and names a character in a ⛏ box on the
          overlay when their lines fall short or stop while the rest of the crew keeps going. It says who and for
          how long — never why; that is for the pilot to look at.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 220px) 1fr', gap: '12px 18px', alignItems: 'start', marginTop: 14, fontSize: 13 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={mining.enabled} onChange={(e) => patchMining({ enabled: e.target.checked })} />
            <span style={{ fontWeight: 700, color: mining.enabled ? '#7CFC00' : undefined }}>mining alert {mining.enabled ? 'ON' : 'off'}</span>
          </label>
          <p className="cfg-sub">The master switch. Off means no game log is read at all and nothing is remembered.</p>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span><b>React after</b>: {mining.delayS === 0 ? 'no extra wait' : `${mining.delayS} s`}</span>
            <input type="range" min={0} max={180} step={5} value={mining.delayS} style={{ width: 200 }}
              onChange={(e) => patchMining({ delayS: Number(e.target.value) })} />
          </label>
          <p className="cfg-sub">
            How much longer than the bare minimum to wait before naming someone. The app needs <b>two missed cycles</b>
            to see a shortfall at all (one missed cycle is a crystal swap); this is the extra time the shortfall must
            hold before “rate down” shows. For “not mining” it is the silence allowed beyond one full cycle (never less
            than 30 s). At the crew&apos;s 15-second cycles the default 30 s names a dead module about a minute after it
            died and a stopped miner about a minute after their last line. Lower = sooner; higher = fewer calls on a
            pilot who is slow to retarget a rock.
          </p>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span><b>What counts as a drop</b></span>
            <select value={String(mining.dropRatio)} style={{ fontSize: 12, width: 200 }}
              onChange={(e) => patchMining({ dropRatio: Number(e.target.value) })}>
              <option value="0.75">any module lost (below ¾ of normal)</option>
              <option value="0.6">a third of the rate gone</option>
              <option value="0.5">half the rate gone</option>
            </select>
          </label>
          <p className="cfg-sub">
            “Normal” is what that character managed over the last half hour (a typical window, not their single best
            one). The first setting catches one module out of two or three; the others only shout when a good chunk
            of the rate is gone — for a character with many small modules, or a pilot who often runs fewer on purpose.
          </p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={mining.rateDown} onChange={(e) => patchMining({ rateDown: e.target.checked })} /> name a <b>dropped rate</b>
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
              <input type="checkbox" checked={mining.notMining} onChange={(e) => patchMining({ notMining: e.target.checked })} /> name a <b>stopped miner</b>
            </label>
          </div>
          <p className="cfg-sub">
            The two things it can say. “Rate down”: fewer lines than normal (a crystal gone, a rock depleted and not
            retargeted). “Not mining”: no line at all while others in the crew are still cycling (a full hold, a
            forgotten module). Untick one to keep only the other.
          </p>

          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }}>
            <input type="checkbox" checked={mining.blink} onChange={(e) => patchMining({ blink: e.target.checked })} /> blink a new alert
          </label>
          <p className="cfg-sub">The box flashes for the first twenty seconds of a new alert, then settles. Untick for a steady box.</p>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span><b>Keep “not mining” on screen</b>: {mining.keepMin} min</span>
            <input type="range" min={1} max={60} step={1} value={mining.keepMin} style={{ width: 200 }}
              onChange={(e) => patchMining({ keepMin: Number(e.target.value) })} />
          </label>
          <p className="cfg-sub">
            A stopped miner who stays stopped is named for this long, then the line leaves on its own. (“Rate down”
            clears by itself once the rate is back, or after half an hour at the lower rate — it becomes the new
            normal.)
          </p>
        </div>

        <p className="cfg-sub" style={{ marginTop: 14 }}>
          Deliberately silent while <b>nobody in the crew is still mining</b> (the whole crew stopped — a move, an
          unload run), for about two cycles after the first of them starts again, when a character <b>docks or leaves
          the system</b> they were mining in, when they <b>change ship</b>, and for a <b>lone miner</b> stopping.
          To hide a particular alert for a while, use the <b>🔔 Alerts</b> page (or <b>Alt+]</b> in game).
        </p>
      </section>
      )}

      {tab === 'alerts' && (() => {
        const live = pruneMutes(mutes, now);
        const hhmm = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const rows: { key: string; icon: string; text: string; color: string }[] = [];
        for (const a of snap?.mining ?? []) rows.push({ key: miningKey(a), icon: '⛏', color: a.kind === 'stopped' ? '#ff8a8a' : '#ffd24d', text: `${a.charName} — ${alertText(a, now)}` });
        for (const a of snap?.pi ?? []) rows.push({ key: piKey(a), icon: '🪐', color: a.sev === 0 ? '#ff8a8a' : '#ffb46b', text: `${a.planetName} · ${a.charName} — ${a.text}` });
        for (const r of snap?.raids ?? []) rows.push({ key: raidKey(r), icon: '🎯', color: r.state === 'open' ? '#ffd24d' : '#c3c2b7', text: `${r.systemName} · ${r.jumps}j — ${r.state === 'open' ? `open, ${r.minsLeft} min left` : `opens in ${r.minsLeft} min`}` });
        const age = snap ? Math.round((now - snap.at) / 1000) : null;
        const btn = (label: string, title: string, onClick: () => void) => (
          <button className="btn mini" title={title} onClick={onClick} style={{ fontSize: 11 }}>{label}</button>
        );
        return (
      <section style={{ margin: '0 0 20px' }}>
        <h2 style={{ fontSize: 15, margin: '0 0 6px', borderBottom: '1px solid rgba(128,128,128,.25)', paddingBottom: 4 }}>🔔 Alerts — dismiss, snooze, switch off</h2>
        <p className="cfg-sub">
          What the overlay&apos;s notice boxes are showing right now (⛏ mining, 🪐 planets, 🎯 raids). The overlay itself
          is click-through, so this is where you act on an alert: <b>dismiss</b> hides that one until it goes away on
          its own (a fresh one shows again), <b>snooze</b> hides it for a while, and <b>snooze everything</b> quiets all
          three boxes at once. <b>Alt+]</b> in game opens this page directly. Changes reach the overlay within a
          poll — a few seconds.
        </p>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 12, fontSize: 13 }}>
          <span><b>Snooze everything</b> for</span>
          {btn('15 min', 'hide every notice box for 15 minutes', () => writeMutes(muteAll(live, now + 15 * 60_000)))}
          {btn('1 h', 'hide every notice box for an hour', () => writeMutes(muteAll(live, now + 3600_000)))}
          {btn('4 h', 'hide every notice box for four hours', () => writeMutes(muteAll(live, now + 4 * 3600_000)))}
          {live.all > now && (
            <span style={{ color: '#ffb347' }}>
              everything snoozed until {hhmm(live.all)} · {btn('show again', 'lift the snooze on everything', () => writeMutes(muteAll(live, 0)))}
            </span>
          )}
          {(live.all > now || Object.keys(live.items).length > 0) && btn('clear all snoozes & dismissals', 'show everything again', () => writeMutes(clearMutes()))}
        </div>

        <h3 style={{ fontSize: 13, margin: '16px 0 6px' }}>On the overlay now</h3>
        {!snap && <p className="cfg-sub">No overlay reading yet — the main window writes one every few seconds while the overlay is on.</p>}
        {snap && rows.length === 0 && <p className="cfg-sub">Nothing on the notice boxes right now{age !== null && age > 30 ? ` (last reading ${age} s ago)` : ''}.</p>}
        {rows.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {rows.map((r) => {
              const reason = muteReason(live, r.key, now);
              const e = live.items[r.key];
              return (
                <div key={r.key} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, opacity: reason ? 0.55 : 1 }}>
                  <span style={{ width: 18, textAlign: 'center' }}>{r.icon}</span>
                  <span style={{ color: r.color, fontWeight: 600, minWidth: 260 }}>{r.text}</span>
                  {reason === '' && btn('dismiss', 'hide this one until it goes away on its own', () => writeMutes(mute(live, r.key, 0, now)))}
                  {reason === '' && btn('10 min', 'hide this one for ten minutes', () => writeMutes(mute(live, r.key, now + 10 * 60_000, now)))}
                  {reason === '' && btn('1 h', 'hide this one for an hour', () => writeMutes(mute(live, r.key, now + 3600_000, now)))}
                  {reason === 'dismissed' && <span className="cfg-sub">dismissed · {btn('show again', 'show it again', () => writeMutes(unmute(live, r.key)))}</span>}
                  {reason === 'snoozed' && e && <span className="cfg-sub">snoozed until {hhmm(e.until)} · {btn('show again', 'show it again', () => writeMutes(unmute(live, r.key)))}</span>}
                  {reason === 'all' && <span className="cfg-sub">everything is snoozed</span>}
                </div>
              );
            })}
            {age !== null && age > 30 && <p className="cfg-sub">last reading {age} s ago</p>}
          </div>
        )}

        <h3 style={{ fontSize: 13, margin: '18px 0 6px' }}>Switch off entirely</h3>
        <div style={{ display: 'flex', gap: 18, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }} title="The ⛏ box. Its other settings are on the Mining Alert page.">
            <input type="checkbox" checked={mining.enabled} onChange={(e) => patchMining({ enabled: e.target.checked })} /> ⛏ mining alert {mining.enabled ? 'ON' : 'off'}
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }} title="The 🪐 box — urgent planet warnings.">
            <input type="checkbox" checked={piOverlay} onChange={(e) => patchPiOverlay(e.target.checked)} /> 🪐 planet warnings {piOverlay ? 'ON' : 'off'}
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, cursor: 'pointer' }} title="The 🎯 box — raidable skyhooks near your map. Radius on the Raid Alert page.">
            <input type="checkbox" checked={raidAlert} onChange={() => { const next = !raidAlert; setRaidAlert(next); patchRaidSettings({ raidAlert: next }); }} /> 🎯 raid alert {raidAlert ? 'ON' : 'off'}
          </label>
        </div>
        <p className="cfg-sub" style={{ marginTop: 6 }}>Off is off: that box never appears and (for mining) no log is read. Snoozes are the gentler option.</p>
      </section>
        );
      })()}
    </div>
  );
}
