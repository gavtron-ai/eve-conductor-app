// "MAKE IT FIT" — shown when a resource is OVER BUDGET for this character.
//
// Different question from the gap popover, which answers "who is better than
// me at this". This one answers "this does not fit for ME — what do I have to
// do?", in the order a player would rather hear it: train, then the cheapest
// implant, then both, and finally the honest "nothing does, change the fit".
//
// The search runs the real dogma engine once per candidate, so it takes a
// moment and is triggered by a CLICK rather than a hover — a mouse crossing
// the table must not kick off dozens of engine runs.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { makeItFit, type FitFix } from '../lib/fitFix';
import { RESOURCE_LABEL, type ResourceKey } from '../lib/fitGap';
import type { CharAccount } from '../lib/auth';
import type { ParsedFit } from '../lib/skillRelevance';
import type { EsfFitShape } from '../lib/dogmaFit';

const KIND_LABEL: Record<FitFix['kind'], string> = {
  skills: 'Training alone fixes this',
  implant: 'One implant fixes this',
  'implant+skills': 'Implant plus training',
  impossible: 'The fit itself has to change',
};
const KIND_ICON: Record<FitFix['kind'], string> = {
  skills: '📚', implant: '💊', 'implant+skills': '💊📚', impossible: '🔧',
};

export default function MakeItFitPopover({ me, resources, fit, esfFit, anchor, onClose }: {
  me: CharAccount;
  /** every resource that genuinely stops this fit working, worst first */
  resources: ResourceKey[];
  fit: ParsedFit;
  esfFit?: EsfFitShape;
  anchor: DOMRect;
  onClose: () => void;
}) {
  const [which, setWhich] = useState<ResourceKey>(resources[0] ?? 'cpu');
  const [fix, setFix] = useState<FitFix | null | 'loading' | 'error'>('loading');
  const resource = which;

  useEffect(() => {
    let cancelled = false;
    setFix('loading');
    void makeItFit({
      fit, esfFit, mine: me.skills ?? {}, myImplants: me.implants,
      resource, cancelled: () => cancelled,
    })
      .then((r) => { if (!cancelled) setFix(r); })
      .catch(() => { if (!cancelled) setFix('error'); });
    return () => { cancelled = true; };
  }, [me.characterId, me.skills, me.implants, resource, fit, esfFit]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const solved = fix !== null && fix !== 'loading' && fix !== 'error' ? fix : null;

  return createPortal(
    <div
      className="fit-fix-pop"
      onMouseDown={(e) => e.stopPropagation()}
      style={{
        left: Math.max(8, Math.min(anchor.left, window.innerWidth - 420)),
        top: Math.min(anchor.bottom + 6, Math.max(8, window.innerHeight - 360)),
        width: 400,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <b>Make it fit — {RESOURCE_LABEL[resource]}</b>
        <button className="btn mini" onClick={onClose}>close</button>
      </div>
      <div className="hint" style={{ marginTop: 2 }}>{me.characterName}</div>

      {/* several things can be short at once — each is solved separately,
          because the remedy for CPU is rarely the remedy for powergrid */}
      {resources.length > 1 && (
        <div style={{ display: 'flex', gap: 4, margin: '6px 0 2px', flexWrap: 'wrap' }}>
          {resources.map((r) => (
            <button key={r} className={`btn mini${r === which ? ' on' : ''}`}
              onClick={() => setWhich(r)}>
              {RESOURCE_LABEL[r]}
            </button>
          ))}
        </div>
      )}

      {fix === 'loading' && (
        <div className="hint">Measuring every remedy against this exact fit…</div>
      )}
      {fix === 'error' && (
        <div className="hint">Could not work this out — the fit or the character data is incomplete.</div>
      )}
      {fix === null && <div className="hint">This already fits. Nothing to do.</div>}

      {solved && (
        <>
          <div className="hint" style={{ marginTop: 4 }}>
            Short by <b>{solved.shortBy.toFixed(2)} {solved.unit}</b>.
          </div>

          <div style={{ margin: '8px 0 2px', fontWeight: 600 }}>
            {KIND_ICON[solved.kind]} {KIND_LABEL[solved.kind]}
          </div>
          <div style={{ fontSize: 12 }}>{solved.summary}</div>

          {solved.implant && (
            <div className="hint" style={{ marginTop: 6 }}>
              +{solved.implant.bonus}% · needs Cybernetics {solved.implant.needsCybernetics}
              {solved.implant.hasCybernetics
                ? ' (trained)'
                : ` — NOT trained yet, so this implant cannot be used until it is`}
              {solved.implant.replaces && (
                <> · displaces <b>{solved.implant.replaces.name}</b>, because that slot holds one implant</>
              )}
            </div>
          )}

          {solved.skills.length > 0 && (
            <table className="data" style={{ marginTop: 6 }}>
              <thead>
                <tr><th>Skill</th><th>Now</th><th>To</th><th>Gain</th></tr>
              </thead>
              <tbody>
                {solved.skills.map((r) => (
                  <tr key={r.skillId}>
                    <td className="hub-name">{r.name}</td>
                    <td>{r.from}</td>
                    <td>{r.to}</td>
                    <td className="pos">+{r.gain.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {solved.kind !== 'impossible' ? (
            <div className="hint" style={{ marginTop: 6 }}>
              Leaves <b>{solved.resulting.toFixed(2)} {solved.unit}</b> spare — measured by running
              this exact fit with the remedy applied, not estimated from percentages.
            </div>
          ) : (
            <div className="hint" style={{ marginTop: 6 }}>
              Even with every relevant skill at V and the strongest implant it is still short. Swap
              a module for a smaller or meta variant, or fit a fitting rig.
            </div>
          )}

          {solved.skills.length > 0 && (
            <button
              className="btn mini"
              style={{ marginTop: 6 }}
              title="Copy as 'Skill Name N' lines — EVE's training queue imports these from the clipboard"
              onClick={() => {
                const text = solved.skills.map((r) => `${r.name} ${r.to}`).join('\n');
                void navigator.clipboard.writeText(text).catch(() => {});
              }}
            >
              copy training plan
            </button>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
