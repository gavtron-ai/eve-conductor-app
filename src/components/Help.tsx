// HELP SYSTEM (v0.184) — three pieces, one content source (helpContent.tsx):
//   · HelpButton  — the ⓘ in the header; opens the current module's guide,
//     scrolled to the tab the user is actually looking at
//   · InfoDot     — a small ⓘ beside a panel title for panels whose
//     mechanics are not obvious from the module guide
//   · IntroTour   — the first-run walkthrough (sign in, per-character
//     ticks, where help lives); replayable from any module guide's footer
//
// RULE 20: new features ship WITH their help — add the module section /
// panel entry in helpContent.tsx as part of the feature, not after.
import { useEffect, useRef, useState } from 'react';
import { MODULE_HELP, PANEL_HELP } from '../helpContent';
import type { ModuleId } from '../lib/store';
import { useAuth } from '../lib/auth';
import { logUser } from '../lib/devlog';

const INTRO_KEY = 'etc-intro-seen-v1';
const REPLAY_EVENT = 'etc-intro-replay';

export function replayIntro(): void {
  try { localStorage.removeItem(INTRO_KEY); } catch { /* nicety */ }
  window.dispatchEvent(new Event(REPLAY_EVENT));
}

// ---------------------------------------------------------------------------

function ModalShell({ wide, onClose, children }: {
  wide?: boolean; onClose: () => void; children: React.ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="overlay" onClick={onClose}>
      {/* InfoDots live inside styled titles (uppercase, letter-spaced) and
          text-transform INHERITS into fixed-position children — reset all
          inheritable text styling so the popup reads as body copy */}
      <div className={wide ? 'modal modal-wide' : 'modal'}
        style={{
          textTransform: 'none', letterSpacing: 'normal', fontWeight: 'normal',
          fontSize: 13, lineHeight: 1.55,
          ...(wide ? { maxWidth: 760 } : null),
        }}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

/** the header ⓘ — the current module's full guide, scrolled to its tab */
export function HelpButton({ module, section }: { module: ModuleId; section?: string }) {
  const [open, setOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const help = MODULE_HELP[module];
  useEffect(() => {
    if (!open || !section) return;
    const el = bodyRef.current?.querySelector(`#help-${section}`);
    if (el) el.scrollIntoView({ block: 'start' });
  }, [open, section]);
  if (!help) return null;
  return (
    <>
      <button className="btn icon" title={`How to use ${help.title}`}
        onClick={() => { logUser('help: module guide', { module, section }); setOpen(true); }}>
        ⓘ
      </button>
      {open && (
        <ModalShell wide onClose={() => setOpen(false)}>
          <div ref={bodyRef}>
            <h2>{help.title} — how to use it</h2>
            {help.intro}
            {help.sections.map((s) => (
              <section key={s.id} id={`help-${s.id}`} style={{ scrollMarginTop: 8 }}>
                <h3 className="section-title" style={{ marginTop: 16 }}>{s.title}</h3>
                {s.body}
              </section>
            ))}
            <div className="hint" style={{ marginTop: 16, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <span>Panels with a small ⓘ beside their title have their own notes.</span>
              <button className="btn mini" onClick={() => { setOpen(false); replayIntro(); }}>
                ↻ Replay the welcome tour
              </button>
            </div>
            <div className="actions" style={{ marginTop: 10 }}>
              <button className="btn" onClick={() => setOpen(false)}>Close</button>
            </div>
          </div>
        </ModalShell>
      )}
    </>
  );
}

/** a small ⓘ beside a panel title — content from PANEL_HELP */
export function InfoDot({ id }: { id: string }) {
  const [open, setOpen] = useState(false);
  const entry = PANEL_HELP[id];
  if (!entry) return null;
  return (
    <>
      <button
        onClick={(e) => { e.stopPropagation(); logUser('help: panel', { id }); setOpen(true); }}
        title={`About: ${entry.title}`}
        style={{
          border: '1px solid var(--grid)', background: 'transparent', color: 'var(--ink-2)',
          borderRadius: '50%', width: 18, height: 18, lineHeight: '15px', fontSize: 11,
          padding: 0, cursor: 'pointer', verticalAlign: 'middle', flex: 'none',
        }}>
        i
      </button>
      {open && (
        <ModalShell onClose={() => setOpen(false)}>
          <h2>{entry.title}</h2>
          {entry.body}
          <div className="actions"><button className="btn" onClick={() => setOpen(false)}>Close</button></div>
        </ModalShell>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// FIRST-RUN TOUR — shows once on a cold start with no characters, and on
// demand via replayIntro(). Every step says the same reassurance out loud:
// nothing here is permanent, it is all adjustable later in ⚙ Settings.
// ---------------------------------------------------------------------------

const STEPS = 5;

export function IntroTour({ onOpenSettings }: { onOpenSettings: () => void }) {
  const characters = useAuth((s) => s.characters);
  // this copy ships with NO EVE application built in — creating one is the
  // real first step on a fresh machine, so the tour must walk it
  const clientId = useAuth((s) => s.clientId);
  const [forced, setForced] = useState(false);
  const [seen, setSeen] = useState<boolean>(() => {
    try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return true; }
  });
  const [step, setStep] = useState(0);
  useEffect(() => {
    const onReplay = () => { setSeen(false); setStep(0); setForced(true); };
    window.addEventListener(REPLAY_EVENT, onReplay);
    return () => window.removeEventListener(REPLAY_EVENT, onReplay);
  }, []);
  const show = !seen && (forced || characters.length === 0);
  if (!show) return null;
  const done = () => {
    try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* nicety */ }
    setSeen(true);
    setForced(false);
    logUser('intro tour: finished', { step });
  };
  return (
    <ModalShell onClose={done}>
      <h2>
        {step === 0 && 'Welcome to EVE Conductor'}
        {step === 1 && 'Step 1 — your own EVE application (one minute)'}
        {step === 2 && 'Step 2 — log your characters in'}
        {step === 3 && 'Step 3 — tell it what each character does'}
        {step === 4 && 'Where help lives'}
      </h2>
      {step === 0 && (
        <>
          <p>
            A suite of tools for playing EVE with measured numbers instead of guesses: trading,
            skills &amp; fits, battle analysis, theft windows, and planetary industry. Switch
            between them with the <b>EVE … Conductor ▾</b> title at the top left — and the
            background collectors (market radar, wallet, planet watcher…) keep working
            whichever module is on screen, even minimized.
          </p>
          <p className="hint">
            Two minutes of setup makes everything work: log characters in, tick what they do.
            Every choice can be changed later — nothing in this tour is permanent.
          </p>
        </>
      )}
      {step === 1 && (
        <>
          <p>
            Conductor talks to EVE through an application <b>you</b> register — free, no
            secrets, and it means your logins go through your own registration, nobody
            else's. In <b>⚙ Settings → Set up your EVE application</b>:
          </p>
          <ul style={{ lineHeight: 1.55, paddingLeft: 20 }}>
            <li>Go to <b>developers.eveonline.com</b> → Manage Applications → <b>Create New
              Application</b> (log in with any of your EVE accounts; name it anything).</li>
            <li>Connection type: <b>Authentication &amp; API Access</b>.</li>
            <li>The Settings section has <b>copy buttons</b> for the exact callback URL and
              the full scope list — paste both into the portal form. The callback must match
              character for character, and missing scopes leave features dark.</li>
            <li>Create it, copy the <b>Client ID</b>, paste it into Settings. That's it —
              there is no Secret Key step; the app deliberately never asks for one.</li>
          </ul>
          <p className="hint">
            {clientId
              ? '✓ Already done on this machine — this step is complete, carry on.'
              : 'Until this is done, the yellow banner stays up and logins are refused.'}
          </p>
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn" onClick={onOpenSettings}>Open Settings now</button>
          </div>
        </>
      )}
      {step === 2 && (
        <>
          <p>
            Open <b>⚙ Settings</b> and press <b>Log in with EVE Online</b>. Your browser opens
            EVE's own login page; approve it and the character appears here. Repeat
            <b> + Add another character</b> for every alt — the modules read the whole team.
          </p>
          <p className="hint">
            Logins stay on this machine (EVE's official developer flow — the app never sees
            your password). A character logged in long ago may need a re-login when new
            features need new permissions; the app tells you when.
          </p>
          <div className="actions" style={{ justifyContent: 'flex-start' }}>
            <button className="btn" onClick={onOpenSettings}>Open Settings now</button>
          </div>
        </>
      )}
      {step === 3 && (
        <>
          <p>Each character's row in Settings has a few switches — they drive the math:</p>
          <ul style={{ lineHeight: 1.55, paddingLeft: 20 }}>
            <li><b>duty…</b> — pick <i>hub trader</i> (their skills and standings set that
              hub's fees, and their hangar counts as business stock) or <i>hauler</i> (their
              cargo counts as in-transit, not idle stock). Leave blank for characters that do
              not trade.</li>
            <li><b>PI</b> — tick it to watch that character's planets in the Planetary
              Industry module. Unticked characters are invisible there, on purpose.</li>
            <li><b>notes</b> — free text so you remember who is who.</li>
            <li><b>Set active</b> — only steers in-game actions (market windows, waypoints);
              it never changes whose numbers are used.</li>
          </ul>
          <p className="hint">
            All of it can be changed any time in ⚙ Settings — ticks, duties and even logins
            are freely reversible.
          </p>
        </>
      )}
      {step === 4 && (
        <>
          <p>
            Every module has an <b>ⓘ button in the top bar</b> — a full how-to for the tab you
            are on. Panels with a small <b>ⓘ</b> beside their title have their own notes. This
            tour can be replayed from any module guide's footer.
          </p>
          <p className="hint">
            One habit worth keeping: when a number surprises you, hover it — most numbers
            carry a tooltip saying exactly how they were measured.
          </p>
        </>
      )}
      <div className="actions" style={{ marginTop: 14, justifyContent: 'space-between' }}>
        <button className="btn mini" onClick={done}>skip the tour</button>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className="dim" style={{ fontSize: 11 }}>{step + 1} / {STEPS}</span>
          {step > 0 && <button className="btn" onClick={() => setStep((s) => s - 1)}>← Back</button>}
          {step < STEPS - 1
            ? <button className="btn primary" onClick={() => setStep((s) => s + 1)}>Next →</button>
            : <button className="btn primary" onClick={done}>Done — let's go</button>}
        </span>
      </div>
    </ModalShell>
  );
}
