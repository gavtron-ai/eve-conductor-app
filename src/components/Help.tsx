// HELP SYSTEM (v0.184, rebuilt v0.197) — three pieces, one content source
// (helpContent.tsx, assembled from src/help/*):
//   · HelpButton  — the ⓘ in the header; opens the module's GUIDE: a paged
//     book with a table of contents down the left, one group per tab plus
//     the shared "everywhere" groups, opened on the tab you are looking at
//   · InfoDot     — a small ⓘ beside a panel title for panels whose
//     mechanics are not obvious from the module guide
//   · IntroTour   — the first-run walkthrough (sign in, per-character
//     ticks, where help lives); replayable from any guide's footer
//
// RULE 20: new features ship WITH their help — pages in src/help/<module>.tsx
// as part of the feature, not after.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MODULE_HELP, PANEL_HELP, SHARED_GROUPS } from '../helpContent';
import type { HelpGroup, HelpPage } from '../help/types';
import { RELEASE_NOTES } from '../help/releaseNotes';
import { POLICY_INTRO, POLICY_ROWS, POLICY_THIRD_PARTY, POLICY_QA, POLICY_SOURCES } from '../help/policy';
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

function ModalShell({ wide, onClose, children, style }: {
  wide?: boolean; onClose: () => void; children: React.ReactNode; style?: React.CSSProperties;
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
          ...style,
        }}
        onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// THE GUIDE — a book. Flat page list for prev/next; grouped list for the TOC.
// ---------------------------------------------------------------------------

interface FlatPage { group: string; groupTitle: string; page: HelpPage; index: number }

function flatten(groups: HelpGroup[]): FlatPage[] {
  const out: FlatPage[] = [];
  for (const g of groups) for (const p of g.pages) out.push({ group: g.id, groupTitle: g.title, page: p, index: out.length });
  return out;
}

/** the header ⓘ — the module's guide, opened on the tab in front of you */
export function HelpButton({ module, section }: { module: ModuleId; section?: string }) {
  const [open, setOpen] = useState(false);
  const help = MODULE_HELP[module];
  if (!help) return null;
  return (
    <>
      <button className="btn icon" title={`How to use ${help.title} — a paged guide for every tab`}
        onClick={() => { logUser('help: module guide', { module, section }); setOpen(true); }}>
        ⓘ
      </button>
      {open && <Guide module={module} section={section} onClose={() => setOpen(false)} />}
    </>
  );
}

function Guide({ module, section, onClose }: { module: ModuleId; section?: string; onClose: () => void }) {
  const help = MODULE_HELP[module];
  const groups = useMemo<HelpGroup[]>(() => [
    { id: 'intro', title: help.title, pages: help.intro },
    ...help.groups,
    ...SHARED_GROUPS,
  ], [help]);
  const flat = useMemo(() => flatten(groups), [groups]);
  const [cur, setCur] = useState<number>(() => {
    const hit = section ? flat.find((f) => f.group === section) : undefined;
    return hit?.index ?? 0;
  });
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const tocRef = useRef<HTMLDivElement | null>(null);
  const page = flat[cur];

  // ← / → turn pages; the reader's hands stay where they are
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') setCur((c) => Math.min(flat.length - 1, c + 1));
      if (e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flat.length]);

  // a new page starts at its top, and its TOC entry stays in view
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
    const el = tocRef.current?.querySelector(`[data-page="${cur}"]`);
    if (el) (el as HTMLElement).scrollIntoView({ block: 'nearest' });
    logUser('help: page', { module, page: page?.page.id });
  }, [cur, module, page?.page.id]);

  if (!page) return null;
  return (
    <ModalShell wide onClose={onClose} style={{ maxWidth: 1040, width: 'min(1040px, 96vw)', padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', height: 'min(78vh, 760px)', minHeight: 420 }}>
        {/* ---- table of contents ---- */}
        <nav ref={tocRef} style={{
          width: 250, flex: 'none', overflowY: 'auto', borderRight: '1px solid var(--border)',
          padding: '12px 8px', background: 'var(--surface-2)', fontSize: 12,
        }}>
          <div style={{ fontWeight: 800, fontSize: 13, padding: '0 6px 8px' }}>{help.title}</div>
          {groups.map((g) => (
            <div key={g.id} style={{ marginBottom: 8 }}>
              <div style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--ink-2)', padding: '4px 6px 2px',
              }}>{g.title}</div>
              {g.pages.map((p) => {
                const idx = flat.findIndex((f) => f.group === g.id && f.page.id === p.id);
                const on = idx === cur;
                return (
                  <button key={p.id} data-page={idx}
                    onClick={() => setCur(idx)}
                    style={{
                      display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                      padding: '4px 8px', borderRadius: 4, fontSize: 12,
                      background: on ? 'var(--accent-dim)' : 'transparent',
                      color: on ? 'var(--ink)' : 'var(--ink-2)', fontWeight: on ? 700 : 500,
                    }}>
                    {p.title}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>

        {/* ---- the page ---- */}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 10px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>
              {page.groupTitle}
            </div>
            <h2 style={{ margin: '2px 0 10px' }}>{page.page.title}</h2>
            {page.page.figure}
            <div className="help-body">{page.page.body}</div>
          </div>
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center', padding: '8px 14px',
            borderTop: '1px solid var(--border)', background: 'var(--surface-2)', flexWrap: 'wrap',
          }}>
            <button className="btn mini" disabled={cur === 0} onClick={() => setCur((c) => c - 1)}>◀ Prev</button>
            <button className="btn mini" disabled={cur >= flat.length - 1} onClick={() => setCur((c) => c + 1)}>Next ▶</button>
            <span className="dim" style={{ fontSize: 11 }}>
              page {cur + 1} of {flat.length} · ← → keys turn pages · panels with a small ⓘ have their own notes
            </span>
            <span style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
              <button className="btn mini" onClick={() => { onClose(); replayIntro(); }}>↻ Replay the welcome tour</button>
              <button className="btn" onClick={onClose}>Close</button>
            </span>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// RELEASE NOTES (v0.199.3) — the 📋 in the header: every version since the
// beta, newest first, with the why. Same two-column shape as the guide.
// ---------------------------------------------------------------------------

export function ReleaseNotesButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn icon" title="Release notes — what changed in each version, and why"
        onClick={() => { logUser('help: release notes'); setOpen(true); }}>
        📋
      </button>
      {open && <ReleaseNotes onClose={() => setOpen(false)} />}
    </>
  );
}

function ReleaseNotes({ onClose }: { onClose: () => void }) {
  const [cur, setCur] = useState(0);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const n = RELEASE_NOTES[cur];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowRight') setCur((c) => Math.min(RELEASE_NOTES.length - 1, c + 1));
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') setCur((c) => Math.max(0, c - 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { bodyRef.current?.scrollTo({ top: 0 }); }, [cur]);
  if (!n) return null;
  return (
    <ModalShell wide onClose={onClose} style={{ maxWidth: 1040, width: 'min(1040px, 96vw)', padding: 0, overflow: 'hidden' }}>
      <div style={{ display: 'flex', height: 'min(78vh, 760px)', minHeight: 420 }}>
        <nav style={{
          width: 230, flex: 'none', overflowY: 'auto', borderRight: '1px solid var(--border)',
          padding: '12px 8px', background: 'var(--surface-2)', fontSize: 12,
        }}>
          <div style={{ fontWeight: 800, fontSize: 13, padding: '0 6px 8px' }}>Release notes</div>
          {RELEASE_NOTES.map((r, i) => (
            <button key={r.version} onClick={() => setCur(i)} className="release-nav"
              style={{
                display: 'block', width: '100%', textAlign: 'left', border: 'none', cursor: 'pointer',
                padding: '5px 8px', borderRadius: 4, fontSize: 12,
                background: i === cur ? 'var(--accent-dim)' : 'transparent',
                color: i === cur ? 'var(--ink)' : 'var(--ink-2)', fontWeight: i === cur ? 700 : 500,
              }}>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.version}</span>
              {r.published && <span title="reached the public release feed" style={{ marginLeft: 6, fontSize: 10, color: 'var(--good)' }}>●</span>}
              {r.policy && <span title="a policy decision is recorded" style={{ marginLeft: 4, fontSize: 10 }}>⚖</span>}
              <div style={{ fontSize: 10.5, color: 'var(--ink-2)', fontWeight: 400 }}>{r.date}</div>
            </button>
          ))}
          <div className="hint" style={{ padding: '8px 6px 0', fontSize: 10.5 }}>● reached the public release feed · ⚖ a policy decision is recorded. Versions before 0.186 predate the beta.</div>
        </nav>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div ref={bodyRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 20px 10px' }}>
            <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-2)' }}>
              version {n.version} · {n.date}{n.published ? ' · on the public release feed' : ''}
            </div>
            <h2 style={{ margin: '2px 0 10px' }}>{n.headline}</h2>
            <div className="section-title" style={{ marginTop: 8 }}>What changed</div>
            <ul style={{ paddingLeft: 18 }}>{n.changes.map((c, i) => <li key={i} style={{ margin: '3px 0' }}>{c}</li>)}</ul>
            <div className="section-title" style={{ marginTop: 12 }}>Why</div>
            <p style={{ margin: '4px 0 0' }}>{n.why}</p>
            {n.policy && (
              <div style={{ margin: '12px 0 4px', padding: '8px 10px', borderLeft: '3px solid var(--accent)', background: 'var(--surface-2)', borderRadius: 4 }}>
                <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase', color: 'var(--accent)' }}>⚖ Policy reasoning</div>
                <div style={{ fontSize: 12.5 }}>{n.policy}</div>
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 14px', borderTop: '1px solid var(--border)', background: 'var(--surface-2)' }}>
            <button className="btn mini" disabled={cur === 0} onClick={() => setCur((c) => c - 1)}>▲ Newer</button>
            <button className="btn mini" disabled={cur >= RELEASE_NOTES.length - 1} onClick={() => setCur((c) => c + 1)}>Older ▼</button>
            <span className="dim" style={{ fontSize: 11 }}>{cur + 1} of {RELEASE_NOTES.length} · arrow keys move</span>
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={onClose}>Close</button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// POLICY (v0.199.3) — the ⚖ in the header: CCP's rules that touch a tool
// like this, paraphrased (their text is copyrighted) beside how the app
// keeps to each, plus the questions we asked ourselves.
// ---------------------------------------------------------------------------

export function PolicyButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className="btn icon" title="EVE Online terms — the rules that apply to a tool like this, and how this app keeps to them"
        onClick={() => { logUser('help: policy page'); setOpen(true); }}>
        ⚖
      </button>
      {open && (
        <ModalShell wide onClose={() => setOpen(false)} style={{ maxWidth: 1100, width: 'min(1100px, 96vw)' }}>
          <div style={{ maxHeight: 'min(78vh, 760px)', overflowY: 'auto', paddingRight: 4 }}>
            <h2>EVE Online's rules, and how this app keeps to them</h2>
            {POLICY_INTRO}
            <table className="data policy-table" style={{ fontSize: 12, marginTop: 8 }}>
              <thead>
                <tr>
                  <th style={{ width: '40%' }}>The rule (paraphrased) · source</th>
                  <th>How EVE Conductor keeps to it</th>
                  <th style={{ width: 70 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {POLICY_ROWS.map((r, i) => (
                  <tr key={i}>
                    <td style={{ verticalAlign: 'top' }}>
                      <div>{r.rule}</div>
                      <div className="dim" style={{ fontSize: 10.5, marginTop: 3 }}>{r.source}</div>
                    </td>
                    <td style={{ verticalAlign: 'top' }}>{r.how}</td>
                    <td style={{ verticalAlign: 'top', color: r.status === 'clean' ? 'var(--good)' : '#e0a13a', fontWeight: 700 }}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="section-title" style={{ marginTop: 16 }}>The other services the app talks to</h3>
            <p className="hint" style={{ margin: '4px 0 6px' }}>Not CCP's rules, but each service has its own, and the app is a guest on all of them.</p>
            <table className="data policy-table" style={{ fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ width: '24%' }}>Service</th>
                  <th style={{ width: '28%' }}>Their rules (paraphrased)</th>
                  <th>How EVE Conductor behaves</th>
                  <th style={{ width: 70 }}>Status</th>
                </tr>
              </thead>
              <tbody>
                {POLICY_THIRD_PARTY.map((r, i) => (
                  <tr key={i}>
                    <td style={{ verticalAlign: 'top' }}>{r.service}</td>
                    <td style={{ verticalAlign: 'top' }}>{r.rules}</td>
                    <td style={{ verticalAlign: 'top' }}>{r.how}</td>
                    <td style={{ verticalAlign: 'top', color: r.status === 'clean' ? 'var(--good)' : '#e0a13a', fontWeight: 700 }}>{r.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <h3 className="section-title" style={{ marginTop: 16 }}>Questions we asked ourselves</h3>
            {POLICY_QA.map((q, i) => (
              <div key={i} style={{ margin: '6px 0 10px' }}>
                <div style={{ fontWeight: 700 }}>{q.q}</div>
                <div style={{ fontSize: 12.5 }}>{q.a}</div>
              </div>
            ))}
            <h3 className="section-title" style={{ marginTop: 16 }}>The originals</h3>
            <ul style={{ paddingLeft: 18, fontSize: 12 }}>
              {POLICY_SOURCES.map((s) => (
                <li key={s.url}><b>{s.name}</b> — <a href={s.url} target="_blank" rel="noreferrer">{s.url}</a></li>
              ))}
            </ul>
          </div>
          <div className="actions"><button className="btn" onClick={() => setOpen(false)}>Close</button></div>
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
        <ModalShell wide onClose={() => setOpen(false)}>
          <h2>{entry.title}</h2>
          {entry.figure}
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
            Every module has an <b>ⓘ button in the top bar</b> — a paged guide with a table of
            contents: one group per tab, every control explained with a picture and an example,
            plus shared pages on the header, Settings and the multibox overlay. Panels with a
            small <b>ⓘ</b> beside their title have their own notes. This tour can be replayed
            from any guide's footer.
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
