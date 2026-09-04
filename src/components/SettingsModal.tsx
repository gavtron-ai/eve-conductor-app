import { useEffect, useRef, useState } from 'react';
import { readLogTail, logDirPath, flushLog } from '../lib/devlog';
import { useStock } from '../lib/stock';
import { useApp } from '../lib/store';
import { brokerFeeRate, salesTaxRate } from '../lib/fees';
import { BUILTIN_HUBS, DEFAULT_SETTINGS } from '../lib/constants';
import { isElectron, ssoLogin, useAuth, dutyLabel } from '../lib/auth';
import { brokerRateForHub, salesTaxForHub } from '../lib/broker';
import { syncCharacter } from '../lib/esiChar';
import { getType } from '../lib/typedb';
import { iskShort, pct } from '../lib/format';
import HubManager from './HubManager';
import { sendTestNotification } from '../lib/notify';
import { exportBackup, importBackupText } from '../lib/backup';
import { saveSetup, setupPath } from '../lib/appConfig';
import { useFreshness } from '../lib/freshness';

// NEVER a second copy of the port. The main process reports the callback the
// login server actually binds; a hardcoded copy here was wrong (:53137, the
// other app's) and quietly guaranteed a failed login for anyone who followed
// these instructions.
const SSO_CALLBACK: string = window.appInfo?.ssoCallback ?? 'http://localhost:53138/callback';
// live list from the main process; fallback text for browser-dev mode
const SSO_SCOPES = window.appInfo?.ssoScopes ?? '(run the desktop app to see the scope list)';

function EveLoginSection() {
  const characters = useAuth((s) => s.characters);
  const activeId = useAuth((s) => s.activeId);
  const clientId = useAuth((s) => s.clientId);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(task: () => Promise<string>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      setStatus(await task());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const login = () =>
    run(async () => {
      const id = await ssoLogin();
      setStatus('Logged in — syncing character…');
      const summary = await syncCharacter(id);
      return `Synced: ${summary}`;
    });

  if (!isElectron && characters.length === 0) {
    return (
      <div className="sso-section">
        <h3 className="section-title">EVE login</h3>
        <div className="hint">
          EVE login needs the desktop app (it opens your browser and catches the login callback
          locally). Run <code>npm run dev:app</code> or use the installed app.
        </div>
      </div>
    );
  }

  return (
    <div className="sso-section">
      <h3 className="section-title">
        Team characters ({characters.length})
      </h3>
      {characters.map((c) => (
        <div className="sso-character" key={c.characterId} style={{ marginBottom: 10 }}>
          <img
            src={`https://images.evetech.net/characters/${c.characterId}/portrait?size=64`}
            alt=""
            width={40}
            height={40}
          />
          <div style={{ minWidth: 0 }}>
            <div className="sso-name">
              {c.characterName}
              {c.characterId === activeId && <span className="flag info" style={{ marginLeft: 6 }}>active</span>}
              {c.wallet !== null && (
                <span className="sso-wallet"> · {iskShort(c.wallet)} ISK</span>
              )}
            </div>
            <div className="hint" style={{ margin: 0 }}>
              {c.lastSync
                ? `Synced ${new Date(c.lastSync).toLocaleTimeString()} · ${c.ships?.length ?? 0} ships`
                : 'Not synced yet'}
            </div>
            <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
              <select
                value={c.tradeRole === 'hauler' ? 'hauler' : c.tradeRole === 'trader' ? `trader:${c.homeHubId ?? ''}` : ''}
                title="Duty on the team — it drives the math. A hub trader's OWN skills and standings are used for that hub's fees (never the 'active' character's), their hangar counts as business stock, and their duty shorthand (J-Trader…) names them in every list. A hauler's cargo is in transit, not idle stock. 'Active' only steers the in-game window/waypoint buttons."
                style={{ fontSize: 12 }}
                onChange={(e) => {
                  const v = e.target.value;
                  useAuth.getState().setCharacterData(c.characterId,
                    v === 'hauler'
                      ? { tradeRole: 'hauler', homeHubId: undefined }
                      : v.startsWith('trader:')
                        ? { tradeRole: 'trader', homeHubId: v.slice(7) }
                        : { tradeRole: undefined, homeHubId: undefined });
                  // duty changes what counts as stock — refetch NOW, not in 30 min
                  useStock.setState({ fetchedAt: 0 });
                  void useStock.getState().ensureFresh();
                }}
              >
                <option value="">duty…</option>
                {BUILTIN_HUBS.map((h) => (
                  <option key={h.id} value={`trader:${h.id}`}>{h.name} trader</option>
                ))}
                <option value="hauler">Hauler</option>
              </select>
              {/* PI IS A SEPARATE FLAG, NOT A THIRD DUTY. Almost every PI
                  character is also a trader or a hauler, so folding it into
                  the one-of duty select would have forced a false choice. */}
              <label
                title="Watch this character's planets in the PI module: storage fullness, when each planet needs collecting, extractor programs about to end, and what is sitting on them. Independent of the duty on the left — a trader can run PI too."
                style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, whiteSpace: 'nowrap' }}
              >
                <input
                  type="checkbox"
                  checked={c.piRole === true}
                  onChange={(e) => {
                    useAuth.getState().setCharacterData(c.characterId, { piRole: e.target.checked });
                    // a newly watched character should appear without waiting
                    // out the collector's 11-minute cadence
                    // runNow, NOT fail. fail() applies an escalating backoff
                    // (2, 4, 8… minutes) — ticking six characters once put the
                    // first PI read half an hour away.
                    if (e.target.checked) useFreshness.getState().runNow('pi');
                  }}
                />
                PI
              </label>
              <input
                type="text"
                placeholder="notes — e.g. also does scouting…"
                value={c.role}
                style={{ fontSize: 12, width: 200 }}
                onChange={(e) =>
                  useAuth.getState().setCharacterData(c.characterId, { role: e.target.value })
                }
              />
            </div>
          </div>
          <span style={{ flex: 1 }} />
          {c.characterId !== activeId && (
            <button className="btn" onClick={() => useAuth.getState().setActive(c.characterId)}
              title="Make this the acting character: wallet %, 📍 location, 🚢 ship, in-game windows">
              Set active
            </button>
          )}
          <button className="btn" disabled={busy}
            onClick={() => run(async () => `Synced: ${await syncCharacter(c.characterId)}`)}>
            Sync
          </button>
          <button className="btn" disabled={busy}
            onClick={() => useAuth.getState().removeCharacter(c.characterId)}>
            Log out
          </button>
        </div>
      ))}
      <button className="btn primary" onClick={login} disabled={busy}>
        {busy
          ? 'Waiting for login…'
          : characters.length === 0
            ? 'Log in with EVE Online'
            : '+ Add another character'}
      </button>
      <div className="hint">
        Each character logs in with their own EVE session (your browser opens; the app never
        sees passwords). The team's orders, selling markers and books combine everyone; the
        ACTIVE character drives wallet %, 📍 location, 🚢 ship and in-game windows.
      </div>
      <details className="sso-advanced" open={!false && characters.length === 0}>
        <summary>
          {false ? 'Advanced: use your own EVE application' : 'Set up your EVE application (required)'}
        </summary>
        {!false && (
          <p className="hint" style={{ marginTop: 8 }}>
            This copy has no EVE application built in, so it needs yours. It is free, takes about a
            minute, and means your logins are your own — nothing goes through anybody else's
            registration.
          </p>
        )}
        <ol className="hint" style={{ marginTop: 8, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>
            Go to <b>developers.eveonline.com</b> → <b>Manage Applications</b> → <b>Create New
            Application</b>. Name it anything.
          </li>
          <li>Connection Type: <b>Authentication &amp; API Access</b>.</li>
          <li>
            Paste this <b>exact</b> callback URL:
            <CopyRow value={SSO_CALLBACK} label="Callback URL" />
            It must match character for character, or EVE refuses the login.
          </li>
          <li>
            Add these scopes — all of them, or the matching features stay dark:
            <CopyRow value={SSO_SCOPES} label="Scopes" multiline />
          </li>
          <li>Create it, then copy the <b>Client ID</b> and paste it below.</li>
        </ol>
        <div className="field-grid" style={{ marginTop: 10 }}>
          <label>Client ID</label>
          <input
            type="text"
            style={{ width: '100%' }}
            value={clientId}
            placeholder={false ? 'leave empty for built-in' : 'paste your Client ID here'}
            onChange={(e) => { void saveSetup({ eveClientId: e.target.value }); }}
            spellCheck={false}
          />
        </div>
        <p className="hint" style={{ marginTop: 6 }}>
          The Client ID is not a secret — it identifies the application, not you. This app never asks
          for the Secret Key, because it uses PKCE and does not need one.
        </p>
      </details>
      {status && <div className="hint" style={{ color: 'var(--good)' }}>{status}</div>}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}


/** a value with a Copy button — setup steps fail on a single mistyped character */
function CopyRow({ value, label, multiline }: { value: string; label: string; multiline?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start', margin: '4px 0 8px' }}>
      <code style={{
        flex: 1, wordBreak: 'break-all', fontSize: 11,
        maxHeight: multiline ? 90 : undefined, overflow: 'auto',
        background: 'rgba(0,0,0,.25)', padding: '4px 6px', borderRadius: 3,
      }}>{value}</code>
      <button className="btn mini" title={`Copy the ${label}`}
        onClick={() => {
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }).catch(() => {});
        }}>
        {copied ? '✓' : 'copy'}
      </button>
    </div>
  );
}


/**
 * PER-PLAYER SETUP. These two used to be one player's values compiled into
 * the app; both drive real behaviour, so a stranger silently got the wrong
 * answer instead of an empty one.
 */
function YourSetupSection() {
  const settings = useApp((s) => s.settings);
  const [cfgPath, setCfgPath] = useState<string | null>(null);
  useEffect(() => { void setupPath().then(setCfgPath); }, []);
  const ship = settings.transitShipName ?? '';
  const map = settings.apertureUrl ?? '';
  return (
    <div className="sso-section">
      <h3 className="section-title">Your setup</h3>
      <p className="hint">
        These live in a <b>file outside the app</b>, so they survive reinstalls and can be copied to
        another machine. The app itself carries nobody's settings.
        {cfgPath && <> <code style={{ fontSize: 11 }}>{cfgPath}</code></>}
      </p>
      <div className="field-grid">
        <label>Transit ship name</label>
        <input
          type="text"
          style={{ width: '100%' }}
          value={ship}
          placeholder="e.g. HAULER-1 (leave empty if you don't haul)"
          onChange={(e) => { void saveSetup({ transitShipName: e.target.value }); }}
          spellCheck={false}
        />
      </div>
      <p className="hint">
        The <b>exact</b> in-game name of the ship you haul with. Its cargo counts as{' '}
        <b>goods in transit</b> in your stock and net-worth figures; every other ship's cargo is
        treated as personal and ignored. The match is exact, including spaces and symbols — rename
        the ship in game and this must change too.
        {ship === '' && <> Empty right now, so <b>nothing is counted as in transit</b>.</>}
      </p>
      <div className="field-grid" style={{ marginTop: 10 }}>
        <label>Corporation map (Aperture)</label>
        <input
          type="text"
          style={{ width: '100%' }}
          value={map}
          placeholder="https://your-corp-map.example/map/1"
          onChange={(e) => { void saveSetup({ apertureUrl: e.target.value }); }}
          spellCheck={false}
        />
      </div>
      <p className="hint">
        A web map your corporation runs, embedded as the Aperture module with its own persistent
        login. {map === ''
          ? <>Empty, so Aperture loads nothing at all — it will not open a page you did not choose.</>
          : <>Loaded in a real browser tab inside the app, so signing in sticks across restarts.</>}
      </p>
    </div>
  );
}

/**
 * AI FIGHT SUMMARIES — the Anthropic key, write-only. The field sends the
 * key to the MAIN process, which stores it in Documents/EVE Conductor/
 * anthropic.json (a secret file, deliberately NOT config.json — that one
 * promises to be safe to copy). Nothing here ever reads the key back:
 * the only answer is whether one is configured and which model it uses.
 */
function AiSummarySection() {
  const [st, setSt] = useState<{ configured: boolean; model: string | null } | null>(null);
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => {
    void window.appInfo?.narrative?.status().then(setSt).catch(() => {});
  }, []);
  if (!isElectron || !window.appInfo?.narrative) return null;
  const apply = async (key: string) => {
    const r = await window.appInfo!.narrative!.setKey(key);
    setSt(r);
    setDraft('');
    setNote(r.configured
      ? `saved — fight summaries will be written by ${r.model}`
      : (key === '' ? 'key cleared — the plain summary still works' : 'could not save the key'));
  };
  return (
    <div className="sso-section">
      <h3 className="section-title">AI fight summaries</h3>
      <p className="hint">
        Battle Reports can turn a fight&apos;s computed numbers into short prose with a Claude call.
        The numbers are always computed by the app — the AI only phrases them, and without a key
        the plain summary works exactly the same.
        {' '}Status: {st === null ? '…' : st.configured
          ? <b style={{ color: 'var(--good)' }}>configured — {st.model}</b>
          : <b>not set</b>}
      </p>
      <div className="field-grid">
        <label>Anthropic API key</label>
        <input
          type="password"
          style={{ width: '100%' }}
          value={draft}
          placeholder={st?.configured ? 'a key is stored — paste a new one to replace it' : 'sk-ant-…'}
          onChange={(e) => setDraft(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="btn mini" disabled={draft.trim() === ''}
          onClick={() => { void apply(draft); }}>
          save key
        </button>
        {st?.configured && (
          <button className="btn mini" onClick={() => { void apply(''); }}>
            remove key
          </button>
        )}
      </div>
      <p className="hint" style={{ marginTop: 6 }}>
        Stored in <code style={{ fontSize: 11 }}>Documents/EVE Conductor/anthropic.json</code> and
        read only by the app&apos;s background process — it is a <b>secret</b>: unlike the rest of
        your setup it is never included in backups and must not be copied to anyone. Keys come from{' '}
        <b>console.anthropic.com</b>; a fight summary costs well under a cent.
      </p>
      {note && <div className="hint" style={{ color: 'var(--good)' }}>{note}</div>}
    </div>
  );
}

function AppWindowSection() {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  if (!isElectron) return null;
  return (
    <div className="sso-section">
      <h3 className="section-title">App window</h3>
      <div className="checkline">
        <input id="winTop" type="checkbox" checked={settings.alwaysOnTop ?? false}
          onChange={(e) => setSettings({ alwaysOnTop: e.target.checked })} />
        <label htmlFor="winTop">Keep window above all other applications</label>
      </div>
      <div className="checkline">
        <input id="winTray" type="checkbox" checked={settings.closeToTray ?? true}
          onChange={(e) => setSettings({ closeToTray: e.target.checked })} />
        <label htmlFor="winTray">✕ minimizes to the system tray instead of closing</label>
        <input id="winOverlay" type="checkbox" checked={settings.overlayAutoStart ?? true}
          onChange={(e) => setSettings({ overlayAutoStart: e.target.checked })} />
        <label htmlFor="winOverlay"
          title="The pod/clone overlay is the one thing on screen all the time, and its job is to stop you undocking in the wrong clone. Starting it by hand means it is off on the day it mattered. Nothing is drawn until characters are logged in.">
          Start the pod overlay automatically
        </label>
      </div>
      <div className="hint">
        The app is a 24/7 collector — with the tray option on, the ✕ button only hides the
        window (radar, trends and the raid watcher keep running) and the tray icon brings it
        back. Really quitting is the tray icon's right-click → Quit.
      </div>
    </div>
  );
}

function AlertsSection() {
  const alerts = useApp((s) => s.alerts);
  const setAlerts = useApp((s) => s.setAlerts);
  return (
    <div className="sso-section">
      <h3 className="section-title">Alerts</h3>
      <div className="checkline">
        <input id="alertOutbid" type="checkbox" checked={alerts.outbid}
          onChange={(e) => setAlerts({ outbid: e.target.checked })} />
        <label htmlFor="alertOutbid">Notify when a team order gets outbid</label>
      </div>
      <div className="checkline">
        <input id="alertSale" type="checkbox" checked={alerts.sale}
          onChange={(e) => setAlerts({ sale: e.target.checked })} />
        <label htmlFor="alertSale">Notify when a sell order fills</label>
      </div>
      <div className="field-grid" style={{ marginTop: 8 }}>
        <label title="Mirrors every alert to your phone. Install the free 'ntfy' app (iPhone/Android), subscribe to a topic with a hard-to-guess name, and paste its URL here — e.g. https://ntfy.sh/eve-conductor-x7k2p9. Anyone who knows the topic name can read it, so make it unguessable.">Phone push (ntfy URL)</label>
        <input type="text" style={{ width: '100%' }} value={alerts.ntfyUrl}
          placeholder="https://ntfy.sh/your-secret-topic (optional)"
          onChange={(e) => setAlerts({ ntfyUrl: e.target.value })} spellCheck={false} />
      </div>
      <button className="btn" style={{ marginTop: 8 }} onClick={sendTestNotification}>
        Send test alert
      </button>
      <div className="hint">
        Desktop alerts come from the watcher (checks ~every 5 min while the app runs). For
        iPhone: App Store → <b>ntfy</b> → subscribe to your topic → paste the topic URL above.
        Alerts contain only item/system/price — still, pick an unguessable topic name.
      </div>
    </div>
  );
}

function BackupSection() {
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  async function doExport() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const dest = await exportBackup();
      setStatus(dest ? `Backup saved: ${dest}` : 'Export cancelled.');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }


/**
 * THE DEV LOG, readable without leaving the app.
 *
 * The user runs this daily and does not test each change immediately — so
 * "did the fix work?" has to be answerable after the fact. This shows the
 * most recent entries and the folder they live in, so a problem can be
 * pasted rather than described from memory.
 */
function DiagnosticsPanel() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [dir, setDir] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [reported, setReported] = useState(false);

  // ONE PASTE = A USABLE BUG REPORT (v0.186, beta prep). Corp mates will
  // not screenshot logs — this bundles version, platform, where they were,
  // team SHAPE (counts only, never character names: it lands in Discord)
  // and the recent log, ready to paste.
  const copyReport = async () => {
    await flushLog();
    const tail = await readLogTail(200);
    const chars = useAuth.getState().characters;
    const s = useApp.getState();
    const header = [
      '=== EVE Conductor bug report ===',
      `version: ${__APP_VERSION__} · ${navigator.platform} · ${new Date().toISOString()}`,
      `where: module ${s.activeModule} / view ${s.activeView}`,
      `team: ${chars.length} character(s) · ${chars.filter((c) => c.tradeRole).length} with trade duty · ${chars.filter((c) => c.piRole).length} PI-watched`,
      '',
      'WHAT HAPPENED (please fill in):',
      '',
      '--- last 200 log lines ---',
    ].join(String.fromCharCode(10));
    await navigator.clipboard.writeText(header + String.fromCharCode(10) + (tail || '(no log lines available)'));
    setReported(true);
    setTimeout(() => setReported(false), 1800);
  };

  const load = async () => {
    await flushLog();               // include anything still buffered
    setText(await readLogTail(400));
    setDir(await logDirPath());
  };
  useEffect(() => { if (open) void load(); }, [open]);

  const errors = text.split(String.fromCharCode(10)).filter((l) => /"level":"(error|warn)"/.test(l));

  return (
    <details className="adv-details" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>Diagnostics — what the app has been doing</summary>
      <p className="hint" style={{ marginTop: 6 }}>
        A plain record of which collectors ran, whether they worked, and any errors —
        written continuously so a problem can be looked at afterwards instead of
        reproduced on demand. <b>Safe to delete</b>; it is not your trading history.
        No EVE tokens are ever written here.
      </p>
      {dir && <p className="hint" style={{ marginTop: 4 }}><code>{dir}</code></p>}
      <div style={{ display: 'flex', gap: 8, marginBottom: 6 }}>
        <button className="btn mini" onClick={() => void load()}>Refresh</button>
        <button className="btn mini"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }).catch(() => {});
          }}>
          {copied ? 'copied ✓' : 'Copy all'}
        </button>
        <button className="btn mini"
          title="Copies version, platform, current module, team shape (counts only — no character names) and the last 200 log lines, ready to paste into Discord."
          onClick={() => void copyReport().catch(() => {})}>
          {reported ? 'report copied ✓' : '🐛 Copy bug report'}
        </button>
        <span className="hint" style={{ alignSelf: 'center' }}>
          {errors.length > 0
            ? `${errors.length} warning/error line(s) in view`
            : 'no warnings or errors in view'}
        </span>
      </div>
      <pre style={{
        maxHeight: 260, overflow: 'auto', fontSize: 11, lineHeight: 1.45,
        background: 'rgba(0,0,0,.25)', padding: 8, borderRadius: 4, whiteSpace: 'pre-wrap',
      }}>
        {text || 'No log entries yet — they appear as the app runs.'}
      </pre>
    </details>
  );
}

  async function doImport(file: File) {
    if (busy) return;
    if (
      !window.confirm(
        'Import this backup?\n\n· Settings/hubs/alerts/lists are RESTORED from the file.\n· Ledger and trend history are MERGED — nothing local is deleted.\n· Characters are added without logins (you log each in fresh on this machine).\n\nThe app reloads afterwards.',
      )
    )
      return;
    setBusy(true);
    setError(null);
    try {
      await importBackupText(await file.text());
      // reload IMMEDIATELY: zustand persist re-serializes the live store on
      // ANY set(), so every millisecond between the localStorage restore and
      // the reload is a window where a click (or a finishing character sync)
      // silently overwrites the just-imported state with the old one
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sso-section">
      <DiagnosticsPanel />
      <h3 className="section-title">Backup &amp; transfer</h3>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" onClick={doExport} disabled={busy}
          title="One JSON file with everything this app saves locally: settings, hubs, alerts, ignore/exclude lists, the forever-ledger, resolved structure names, your team's nicknames & roles, and the full trend-event history. EVE login tokens are deliberately NOT included — a copied token used from two machines gets your session revoked by EVE; you log in fresh after importing.">
          Export backup…
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()} disabled={busy}
          title="Restore from a backup file. Settings are restored; ledger and trend history MERGE with what's already here (dedup by transaction/event identity) — importing an old backup can never delete newer data.">
          Import backup…
        </button>
        <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f) void doImport(f);
          }} />
      </div>
      <div className="hint">
        Hit <b>Export</b> before upgrading or when moving machines — the file restores
        everything except EVE logins (each machine logs in fresh; that's what keeps EVE from
        revoking your sessions). Trend history in the Do-Not-Delete folder survives
        reinstalls by itself; the backup carries a copy anyway so ONE file moves everything.
      </div>
      {status && <div className="hint" style={{ color: 'var(--good)' }}>{status}</div>}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

function IgnoredItemsSection() {
  const ignoredTypeIds = useApp((s) => s.ignoredTypeIds);
  const toggleIgnore = useApp((s) => s.toggleIgnore);
  const clearIgnored = useApp((s) => s.clearIgnored);
  if (ignoredTypeIds.length === 0) return null;
  return (
    <div className="sso-section">
      <h3 className="section-title">
        Ignored items ({ignoredTypeIds.length})
        <button className="btn" style={{ float: 'right', padding: '2px 10px', fontSize: 12 }}
          onClick={clearIgnored}>
          Clear all
        </button>
      </h3>
      <div className="hint" style={{ marginTop: 0 }}>
        Hidden from trade searches and auto hauls (still visible in item search). Click ✕ to
        bring one back.
      </div>
      <div className="ignored-list">
        {ignoredTypeIds.map((id) => (
          <span className="ignored-chip" key={id}>
            {getType(id)?.name ?? `#${id}`}
            <button title="Stop ignoring" onClick={() => toggleIgnore(id)}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function StationTradeSection() {
  const ids = useApp((s) => s.stationTradeIds);
  const toggle = useApp((s) => s.toggleStationTrade);
  const clear = useApp((s) => s.clearStationTrades);
  if (ids.length === 0) return null;
  return (
    <div className="sso-section">
      <h3 className="section-title">
        Station-trade items ({ids.length})
        <button className="btn" style={{ float: 'right', padding: '2px 10px', fontSize: 12 }}
          onClick={clear}>
          Clear all
        </button>
      </h3>
      <div className="hint" style={{ marginTop: 0 }}>
        ⚑ Bought where they sell — flipped at one hub, never suggested for hauling. Click ✕ to
        put one back in the normal pipeline.
      </div>
      <div className="ignored-list">
        {ids.map((id) => (
          <span className="ignored-chip" key={id}>
            {getType(id)?.name ?? `#${id}`}
            <button title="Back to the normal pipeline" onClick={() => toggle(id)}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

function ExcludedBooksSection() {
  const excluded = useApp((s) => s.excludedFromBooks);
  const toggle = useApp((s) => s.toggleExcludeBooks);
  const clear = useApp((s) => s.clearExcludedBooks);
  if (excluded.length === 0) return null;
  return (
    <div className="sso-section">
      <h3 className="section-title">
        Excluded from books ({excluded.length})
        <button className="btn" style={{ float: 'right', padding: '2px 10px', fontSize: 12 }}
          onClick={clear}>
          Clear all
        </button>
      </h3>
      <div className="hint" style={{ marginTop: 0 }}>
        These items are left out of the Dashboard's numbers entirely (PLEX sold for wallet ISK,
        ships you fly, personal purchases). Click ✕ to put one back on the books.
      </div>
      <div className="ignored-list">
        {excluded.map((id) => (
          <span className="ignored-chip" key={id}>
            {getType(id)?.name ?? `#${id}`}
            <button title="Put back on the books" onClick={() => toggle(id)}>✕</button>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function SettingsModal({ onClose }: { onClose: () => void }) {
  const settings = useApp((s) => s.settings);
  const setSettings = useApp((s) => s.setSettings);
  const allCharacters = useAuth((s) => s.characters);
  const hubTraders = allCharacters.filter((c) => c.tradeRole === 'trader' && c.homeHubId);

  function num(v: string, fallback = 0): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>Trading settings</h2>

        <EveLoginSection />
      <YourSetupSection />
      <AiSummarySection />
      <AppWindowSection />
        <AlertsSection />
        <BackupSection />
        <HubManager />
        <IgnoredItemsSection />
        <ExcludedBooksSection />
        <StationTradeSection />

        <div className="rates">
          <div>
            <span className="lbl">Sales tax (fallback)</span>
            <span className="val">{pct(salesTaxRate(settings), 2)}</span>
          </div>
          <div>
            <span className="lbl">Broker fee (fallback)</span>
            <span className="val">{pct(brokerFeeRate(settings), 2)}</span>
          </div>
          {hubTraders.map((c) => {
            const hub = BUILTIN_HUBS.find((h) => h.id === c.homeHubId);
            if (!hub) return null;
            return (
              <div key={c.characterId}
                title={`${hub.name} math uses ${c.characterName}'s own synced skills and standings — regardless of which character is "active". Sync this character after training trade skills.`}>
                <span className="lbl">{dutyLabel(c)} @ {hub.name}</span>
                <span className="val">
                  broker {pct(brokerRateForHub(hub, settings), 2)} · tax {pct(salesTaxForHub(hub, settings), 2)}
                </span>
              </div>
            );
          })}
        </div>
        <div className="hint" style={{ marginTop: -8, marginBottom: 12 }}>
          Each hub's fees come from ITS trader's synced skills and standings (set duties above).
          The numeric fields below are the fallback for hubs without an assigned trader.
        </div>

        <div className="field-grid">
          <label>Accounting skill (0–5)</label>
          <input type="number" min={0} max={5}
            value={settings.accountingLevel}
            onChange={(e) => setSettings({ accountingLevel: Math.max(0, Math.min(5, num(e.target.value))) })} />
          <label>Broker Relations skill (0–5)</label>
          <input type="number" min={0} max={5}
            value={settings.brokerRelationsLevel}
            onChange={(e) => setSettings({ brokerRelationsLevel: Math.max(0, Math.min(5, num(e.target.value))) })} />
          <label>Faction standing (−10 to 10)</label>
          <input type="number" min={-10} max={10} step={0.01}
            value={settings.factionStanding}
            onChange={(e) => setSettings({ factionStanding: num(e.target.value) })} />
          <label>Corporation standing (−10 to 10)</label>
          <input type="number" min={-10} max={10} step={0.01}
            value={settings.corpStanding}
            onChange={(e) => setSettings({ corpStanding: num(e.target.value) })} />
        </div>

        <div className="checkline">
          <input
            id="customBroker"
            type="checkbox"
            checked={settings.useCustomBrokerRate}
            onChange={(e) => setSettings({ useCustomBrokerRate: e.target.checked })}
          />
          <label htmlFor="customBroker">Use flat broker rate (player structures)</label>
        </div>
        {settings.useCustomBrokerRate && (
          <div className="field-grid">
            <label>Broker rate (%)</label>
            <input type="number" min={0} max={10} step={0.01}
              value={settings.customBrokerRate * 100}
              onChange={(e) => setSettings({ customBrokerRate: num(e.target.value) / 100 })} />
          </div>
        )}

        <div className="field-grid">
          <label>Base sales tax (%) — CCP patchable</label>
          <input type="number" min={0} max={20} step={0.1}
            value={settings.salesTaxBase * 100}
            onChange={(e) => setSettings({ salesTaxBase: num(e.target.value) / 100 })} />
          <label>Base broker fee (%) — CCP patchable</label>
          <input type="number" min={0} max={20} step={0.1}
            value={settings.brokerFeeBase * 100}
            onChange={(e) => setSettings({ brokerFeeBase: num(e.target.value) / 100 })} />
        </div>

        <div className="actions">
          <button className="btn" onClick={() => setSettings(DEFAULT_SETTINGS)}>
            Reset defaults
          </button>
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
        <div className="hint" style={{ textAlign: 'right', marginTop: 8 }}>
          EVE Conductor v{__APP_VERSION__}
        </div>
      </div>
    </div>
  );
}
