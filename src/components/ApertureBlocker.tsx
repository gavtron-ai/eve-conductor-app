// THE APERTURE BLOCKER (v0.215.0; every Aperture screen since v0.216.0) — shown in place of every
// feature that touched the corp map. It cannot be dismissed: the feature is not there (see
// lib/apertureAccess.ts for why). It says what happened and what still works.
//
// The one button opens the user's OWN browser (the main window's open handler hands every
// window.open to the operating system) at the address he typed in Settings — the app itself
// sends nothing to Aperture, here or anywhere.
import { useApp } from '../lib/store';
import { APERTURE_BLOCK_BODY, APERTURE_BLOCK_STILL, APERTURE_BLOCK_TITLE } from '../lib/apertureAccess';

export default function ApertureBlocker({ feature }: { feature: string }) {
  const url = (useApp((s) => s.settings.apertureUrl) ?? '').trim();
  return (
    <div className="aperture-blocker" role="dialog" aria-modal="true" aria-label={`${feature} is unavailable`}>
      <div className="aperture-blocker-card">
        <div className="aperture-blocker-icon">🚧</div>
        <h2>{feature}</h2>
        <h3>{APERTURE_BLOCK_TITLE}</h3>
        <p>{APERTURE_BLOCK_BODY}</p>
        <p className="dim">{APERTURE_BLOCK_STILL}</p>
        {url && (
          <div className="aperture-blocker-actions">
            <button className="btn primary" title="Opens your normal web browser — EVE Conductor itself does not contact Aperture" onClick={() => window.open(url, '_blank')}>↗ Open Aperture in your own browser</button>
          </div>
        )}
      </div>
    </div>
  );
}
