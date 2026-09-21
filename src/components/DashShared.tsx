// what both halves of the dashlet bodies share (kept apart from them so neither imports the other)
import type { DashSize } from '../lib/homeGrid';
import type { DashletSpec } from '../lib/dashlets';
import type { ChainDigest, DigestSite } from '../lib/chainDigest';
import type { SavedView } from '../lib/favorites';
import { CHAIN_VIEW_KIND, describeChainView, sanitizeChainView } from '../lib/chainView';
import { GROUP_COLOR, classColor } from '../lib/chainViz';
import { agoShort } from '../lib/homeDigests';
import { iskShort } from '../lib/format';
import { useApp } from '../lib/store';
import { APERTURE_READS_ENABLED, APERTURE_PAUSED_SHORT, APERTURE_PAUSED_WHY } from '../lib/apertureAccess';
import { Dot, Empty, Foot, Row } from './DashKit';

export interface DashletProps {
  spec: DashletSpec;
  size: DashSize;
  cfg?: Record<string, string>;
  /** open a tab, optionally with a saved view */
  onGo: (dest: string, view?: SavedView) => void;
}

export const AMBER = '#e0a13a';
export const GOLD = '#f0c674';
export const signed = (v: number) => `${v >= 0 ? '+' : '−'}${iskShort(Math.abs(v))}`;
export const piTone = (rank: number) => (rank <= 1 ? 'var(--bad)' : rank <= 2 ? AMBER : rank <= 5 ? 'var(--accent)' : 'var(--good)');

export const chainView = (partial: Record<string, unknown>): SavedView => {
  // 'linked only' is the player's own remembered preference in the tab — a dashlet click keeps it
  let linkedOnly = false;
  try { linkedOnly = localStorage.getItem('etc-chain-linked-only') === '1'; } catch { /* nicety */ }
  const state = sanitizeChainView({ origin: 'home', linkedOnly, ...partial });
  return { kind: CHAIN_VIEW_KIND, state, summary: describeChainView(state) };
};

export function ChainFoot({ d, fromDisk, note, now }: { d: ChainDigest; fromDisk: boolean; note: string; now: number }) {
  const age = now - d.at;
  return (
    <Foot warn={age > 30 * 60_000 || !!note || !d.originOk}>
      {!APERTURE_READS_ENABLED ? `${APERTURE_PAUSED_SHORT} · last ` : fromDisk ? 'last known · ' : ''}map read {agoShort(age)}
      {!d.originOk ? ` · “${d.origin || 'home'}” is not linked on this reading — no distances` : ''}{note ? ` · ${note}` : ''}
    </Foot>
  );
}
export function NoChain() {
  const url = (useApp((s) => s.settings.apertureUrl) ?? '').trim();
  return <Empty>{!APERTURE_READS_ENABLED ? APERTURE_PAUSED_WHY : url ? 'Waiting for the first map reading — it starts once Aperture has loaded.' : 'Set your corp map’s address in ⚙ Settings → Your setup, then open Aperture once and log in.'}</Empty>;
}
/** one site: named (a dot for its activity, the site's name) or by place (class chip, the system) */
export const SiteLine = ({ s, onGo, named = true }: { s: DigestSite; onGo: () => void; named?: boolean }) => (
  <Row onClick={onGo} title={`${s.name || 'not scanned down'} — ${s.system}${s.cls ? ` (${s.cls}${s.tag})` : ''}${s.hops !== null ? ` · ${s.hops} jump${s.hops === 1 ? '' : 's'} from home` : ' · no drawn link to home'}`}>
    {named ? <Dot color={GROUP_COLOR[s.group]} /> : <b style={{ color: classColor(s.cls) }}>{s.cls}{s.tag}</b>}
    <span className="dl-grow">{named ? (s.name || `unscanned ${s.group.toLowerCase()}`) : s.system}</span>
    <span className="dl-dim">{named && <span className="dl-sys">{s.system} · </span>}{s.hops !== null ? `${s.hops}j` : 'unlinked'}</span>
    <b>{s.isk !== null ? iskShort(s.isk) : '—'}</b>
  </Row>
);
