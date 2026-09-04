// ADDING A SHIP TO THE FIGHT — pick one of your fits, or paste one.
//
// Two steps and no more: WHICH FIT, then WHO FLIES IT. A paste additionally
// offers to save the fit to every character, because a fit worth simulating is
// usually a fit worth having in game, and the Fit Propagator already knows how
// to push one.
import { useMemo, useState } from 'react';
import type { Combatant } from '../lib/store';
import { useAuth } from '../lib/auth';
import { parseFit } from '../lib/skillRelevance';
import { PROFILE_LABEL } from '../lib/pilotProfiles';
import type { TeamFit } from '../lib/teamFits';
import { fitVariationName, type WizardFit } from '../lib/wizardFits';
import { logUser, logInfo } from '../lib/devlog';

const newId = () => `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export default function AddCombatant({ role, teamFits, wizardFits, onAdd, onClose }: {
  role: 'target' | 'attacker' | 'defender';
  teamFits: TeamFit[] | null;
  /** fits built in the Fit Wizard — app-side, so they never reached ESI and
   * are invisible to the library scan */
  wizardFits: WizardFit[];
  onAdd: (c: Combatant) => void;
  onClose: () => void;
}) {
  const characters = useAuth((s) => s.characters);
  const synced = characters.filter((c) => c.skills);
  const activeId = useAuth((s) => s.activeId);

  const [tab, setTab] = useState<'mine' | 'wizard' | 'paste'>('mine');
  const [pickedWizard, setPickedWizard] = useState<{ fitId: string; variationId: string; label: string } | null>(null);
  const [filter, setFilter] = useState('');
  const [picked, setPicked] = useState<TeamFit | null>(null);
  const [eft, setEft] = useState('');
  const [profile, setProfile] = useState<Combatant['profile']>('character');
  const [charId, setCharId] = useState<number | null>(activeId ?? synced[0]?.characterId ?? null);

  const shown = useMemo(() => {
    if (!teamFits) return [];
    const f = filter.trim().toLowerCase();
    const list = f
      ? teamFits.filter((t) => t.hullName.toLowerCase().includes(f) || t.fitName.toLowerCase().includes(f))
      : teamFits;
    return list.slice(0, 200);
  }, [teamFits, filter]);

  // a pasted fit is only usable if it parses — say so BEFORE it is added
  const pasted = useMemo(() => (eft.trim() ? parseFit(eft) : null), [eft]);
  const pasteProblem = pasted === null ? null
    : pasted.shipId === null ? 'no hull line — an EFT fit starts with [Hull, name]'
      : pasted.unresolved.length > 0
        ? `${pasted.unresolved.length} line(s) not recognised: ${pasted.unresolved.slice(0, 3).join(', ')}`
        : null;

  const ready = tab === 'mine' ? picked !== null
    : tab === 'wizard' ? pickedWizard !== null
      : pasted !== null && pasteProblem === null;

  const submit = () => {
    if (!ready) return;
    const name = tab === 'mine'
      ? `${picked!.hullName} — ${picked!.fitName}`
      : tab === 'wizard' ? pickedWizard!.label
        : `${pasted!.shipName}${pasted!.fitName ? ` — ${pasted!.fitName}` : ''}`;
    onAdd({
      id: newId(),
      source: tab === 'mine'
        ? { kind: 'library', key: picked!.key }
        : tab === 'wizard'
          ? { kind: 'wizard', fitId: pickedWizard!.fitId, variationId: pickedWizard!.variationId }
          : { kind: 'eft', text: eft },
      name,
      profile,
      characterId: profile === 'character' ? charId ?? undefined : undefined,
      propRunning: true,
      // A ship is DOING something. Orbiting is the common case and the one that
      // makes tracking matter; the target defaults to orbiting too, because a
      // stationary target is the easy case and would flatter every fit.
      behaviour: 'orbit',
      range: 10000,
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal add-combatant" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Add {role === 'attacker' ? 'a Team A ship' : 'a Team B ship'}</h3>

        <div className="insp-tabs">
          <button className={tab === 'mine' ? 'on' : ''}
            onClick={() => { setTab('mine'); logUser('battle: pick from my fits'); }}>
            My fits{teamFits ? ` (${teamFits.length})` : '…'}
          </button>
          <button className={tab === 'wizard' ? 'on' : ''}
            onClick={() => { setTab('wizard'); logUser('battle: pick a wizard fit'); }}>
            Wizard fits ({wizardFits.reduce((n, f) => n + f.variations.length, 0)})
          </button>
          <button className={tab === 'paste' ? 'on' : ''}
            onClick={() => { setTab('paste'); logUser('battle: paste a fit'); }}>
            Paste EFT
          </button>
        </div>

        {tab === 'mine' && (
          <>
            <input className="filter" placeholder="filter by hull or name…" value={filter}
              onChange={(e) => setFilter(e.target.value)} />
            {teamFits === null && <div className="hint">reading your saved and owned fits…</div>}
            {teamFits !== null && shown.length === 0 && (
              <div className="hint">{filter ? 'nothing matches that filter' : 'no fits found'}</div>
            )}
            <div className="add-list">
              {shown.map((t) => (
                <button key={t.key}
                  className={`add-row${picked?.key === t.key ? ' on' : ''}`}
                  onClick={() => setPicked(t)}>
                  <b>{t.hullName}</b>
                  <span>{t.fitName}</span>
                  <span className="dim">{t.sources.length} char</span>
                </button>
              ))}
            </div>
          </>
        )}

        {tab === 'wizard' && (
          <div className="add-list">
            {wizardFits.length === 0 && (
              <div className="hint">
                No fits in the Fit Wizard yet. Those are built app-side and never leave for ESI,
                which is why they do not appear under “My fits”.
              </div>
            )}
            {wizardFits.flatMap((f) => f.variations.map((v) => {
              const label = fitVariationName(f, v);
              const on = pickedWizard?.fitId === f.id && pickedWizard?.variationId === v.id;
              return (
                <button key={`${f.id}:${v.id}`} className={`add-row${on ? ' on' : ''}`}
                  onClick={() => setPickedWizard({ fitId: f.id, variationId: v.id, label })}>
                  <b>{f.name}</b>
                  <span>{v.name}</span>
                  <span className="dim">variation</span>
                </button>
              );
            }))}
          </div>
        )}

        {tab === 'paste' && (
          <>
            <textarea className="paste-box" rows={12} value={eft}
              placeholder={'[Raven, My Fit]\nBallistic Control System II\n…\n\nPaste from the in-game fitting window (right-click → Copy to Clipboard).'}
              onChange={(e) => setEft(e.target.value)} />
            {pasteProblem && <div className="fitlib-warn">⚠ {pasteProblem}</div>}
            {pasted && !pasteProblem && (
              <div className="hint">
                {pasted.shipName} — {pasted.items.length} item type(s) recognised.
              </div>
            )}
            {/* THE QUESTION. Asked here rather than buried in a menu, because
                this is the moment the fit exists and the answer is obvious. */}
            {pasted && !pasteProblem && (
              <div className="hint" style={{ marginTop: 6 }}>
                Want this fit saved to all {characters.length} characters in game? Add it here first,
                then use <b>Fit Propagator → push</b> — that flow already handles the per-character
                push, its ESI scope, and the pre-push backup, so this dialog does not duplicate it.
              </div>
            )}
          </>
        )}

        <div className="battle-pilot" style={{ marginTop: 10 }}>
          <label>flown by</label>
          <select value={profile} onChange={(e) => setProfile(e.target.value as Combatant['profile'])}>
            <option value="character">{PROFILE_LABEL.character}</option>
            <option value="optimal">{PROFILE_LABEL.optimal}</option>
            <option value="minimum">{PROFILE_LABEL.minimum}</option>
          </select>
          {profile === 'character' && (
            <select value={charId ?? ''} onChange={(e) => setCharId(Number(e.target.value))}>
              {synced.length === 0 && <option value="">no character has synced skills</option>}
              {synced.map((c) => (
                <option key={c.characterId} value={c.characterId}>{c.characterName}</option>
              ))}
            </select>
          )}
        </div>
        <div className="hint">
          {profile === 'optimal'
            ? 'Every skill at V, no implants. Proven to be the maximum — lowering any one of 511 skills improved nothing across 40,880 engine checks.'
            : profile === 'minimum'
              ? 'Exactly the prerequisites this fit declares, at exactly their levels, and nothing else — what it does for someone who has only just earned it.'
              : 'That character’s actual trained skills and worn implants.'}
        </div>

        <div className="modal-actions">
          <button className="btn" onClick={onClose}>cancel</button>
          <button className="btn primary" disabled={!ready}
            onClick={() => { logInfo('battle', 'combatant added', { role, via: tab, profile }); submit(); }}>
            add to {role === 'attacker' ? 'Team A' : 'Team B'}
          </button>
        </div>
      </div>
    </div>
  );
}
