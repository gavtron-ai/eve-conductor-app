// THE APERTURE BLOCKER (v0.215.0) — shown in place of every feature that was built on reading the
// corp map from inside the app. It cannot be dismissed: the feature is not there (see
// lib/apertureAccess.ts for why). It says what happened, what still works, and offers the two
// things a pilot can do instead.
import { useApp } from '../lib/store';
import { APERTURE_BLOCK_BODY, APERTURE_BLOCK_STILL, APERTURE_BLOCK_TITLE } from '../lib/apertureAccess';

export default function ApertureBlocker({ feature, onOpenMap }: { feature: string; onOpenMap?: () => void }) {
  const url = (useApp((s) => s.settings.apertureUrl) ?? '').trim();
  return (
    <div className="aperture-blocker" role="dialog" aria-modal="true" aria-label={`${feature} is unavailable`}>
      <div className="aperture-blocker-card">
        <div className="aperture-blocker-icon">🚧</div>
        <h2>{feature}</h2>
        <h3>{APERTURE_BLOCK_TITLE}</h3>
        <p>{APERTURE_BLOCK_BODY}</p>
        <p className="dim">{APERTURE_BLOCK_STILL}</p>
        <div className="aperture-blocker-actions">
          {onOpenMap && <button className="btn primary" onClick={onOpenMap}>🗺 Open the Corp Map tab</button>}
          {url && <button className="btn" onClick={() => window.open(url, '_blank')}>↗ Open Aperture in your browser</button>}
        </div>
      </div>
    </div>
  );
}
