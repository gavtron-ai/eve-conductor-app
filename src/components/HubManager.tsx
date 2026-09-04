import { useState } from 'react';
import { useApp } from '../lib/store';
import { BUILTIN_HUBS } from '../lib/constants';
import { resolveRegionHub, resolveSystemHub } from '../lib/market';

/**
 * Compare-hub management (built-ins + user-added systems/regions). Lives in
 * the Settings MODAL so it's reachable from any tab without navigating away —
 * navigation destroys scan results, overlays don't.
 */
export default function HubManager() {
  const customHubs = useApp((s) => s.customHubs);
  const addCustomHub = useApp((s) => s.addCustomHub);
  const removeCustomHub = useApp((s) => s.removeCustomHub);

  const [hubName, setHubName] = useState('');
  const [hubError, setHubError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [wholeRegion, setWholeRegion] = useState(false);

  async function addHub() {
    const name = hubName.trim();
    if (!name || adding) return;
    setAdding(true);
    setHubError(null);
    try {
      const hub = wholeRegion ? await resolveRegionHub(name) : await resolveSystemHub(name);
      addCustomHub(hub);
      setHubName('');
    } catch (e) {
      setHubError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  }

  return (
    <div className="sso-section">
      <h3 className="section-title">Trade hubs</h3>
      <div className="side-list">
        {BUILTIN_HUBS.map((h) => (
          <div key={h.id} className="side-row" style={{ cursor: 'default' }}>
            <span className="grow">{h.name}</span>
            <span className="hub-kind">station</span>
          </div>
        ))}
        {customHubs.map((h) => (
          <div key={h.id} className="side-row" style={{ cursor: 'default' }}>
            <span className="grow">{h.name}</span>
            <span className="hub-kind">{h.kind}</span>
            <button className="x" title="Remove hub" onClick={() => removeCustomHub(h.id)}>
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="add-hub">
        <input
          type="text"
          placeholder="Add system…"
          value={hubName}
          onChange={(e) => {
            setHubName(e.target.value);
            setHubError(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && addHub()}
          spellCheck={false}
        />
        <button className="btn" onClick={addHub} disabled={adding || !hubName.trim()}>
          {adding ? '…' : 'Add'}
        </button>
      </div>
      {hubError && <div className="form-error">{hubError}</div>}
      <label className="checkline" title="Adds the system's whole region as a hub — for scouting what sells in an area (e.g. around a wormhole exit)">
        <input
          type="checkbox"
          checked={wholeRegion}
          onChange={(e) => setWholeRegion(e.target.checked)}
        />
        <span>whole region (area scouting)</span>
      </label>
      <div className="hint">
        Exact system name, e.g. “Perimeter” or “Ashab”. With “whole region” the hub covers the
        system's entire region — come out of your wormhole, add the system here (settings open
        over any tab, your scan stays put), and scan Jita → that region.
      </div>
    </div>
  );
}
