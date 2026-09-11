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
  const [tab, setTab] = useState<'pods' | 'notice' | 'raid'>('pods');
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
    <div className="cfg-root">
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
          <button onClick={() => void window.appInfo?.clones?.closeConfig()}>Done</button>
        </div>
      </header>

      <nav className="tabs" style={{ marginBottom: 14 }}>
        <button className={tab === 'pods' ? 'on' : ''} onClick={() => setTab('pods')}>🧍 Pod Overlay</button>
        <button className={tab === 'notice' ? 'on' : ''} onClick={() => setTab('notice')}>⚠ Notification Box</button>
        <button className={tab === 'raid' ? 'on' : ''} onClick={() => setTab('raid')}>🎯 Raid Alert</button>
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
          (this one, 🪐 planets, 🎯 raids) share a width of their own — drag a corner in setup mode to change
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
    </div>
  );
}
