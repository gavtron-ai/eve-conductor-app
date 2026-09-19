// THE PILOT PANEL (v0.203.2) — who a pilot is and what their ship was fitted
// with, shared by the Log Visualizer (click a pilot you fought) and Battle
// Reports (click a ship picture). One component so both tabs say the same
// thing the same way:
//   ✓ confirmed fit — the killmail of the hull in question, from the fight
//                     on screen: what was fitted when it died;
//   likely fit      — their OWN loss of that hull nearest in time;
//   corp mates' fits— the fallback: what their corp (then alliance) mates
//                     lost in the SAME hull, folded into distinct fits;
//   never another hull.
// Every fit copies to the clipboard as EFT for the game's own import.
//
// The type helpers live here too (moved from LiveCombat.tsx): names, icons
// and categories come from the dogma bundle, built once, lazily.
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ensureDogma } from '../lib/dogmaStats';
import { logInfo, logUser } from '../lib/devlog';
import { resolveCharIds, charAffiliation, isNpcCorp, likelyFit, mateFits, type CharAffiliation, type LikelyFit, type MateFits } from '../lib/entityIntel';
import { killFitEft, moduleCount, type FitCertainty, type FittedModule, type KillFit, type Rack, type Stack } from '../lib/killFit';

// ---------------------------------------------------------------------------
// TYPE ICONS — name → typeId via the dogma bundle (built once, lazily)
// ---------------------------------------------------------------------------

const ICON_CATS = new Set([4, 6, 7, 8, 11, 18, 25]); // material/ship/module/charge/NPC/drone/asteroid
/** huffable GAS lives in group 711 "Harvestable Cloud", category 2
 * (Celestial) — measured: Fullerite-C320 id 30377 cat 2 — so the category
 * filter alone dropped it and gas showed unpriced with no icon */
const GAS_GROUP = 711;
let typeIdByName: Map<string, { id: number; cat: number }> | null = null;
let typeNameById: Map<number, string> | null = null;
/** SDE category per type: 8 = Charge pairs a killmail's loaded charge with
 * its module; ships, drones and fighters get a render, the rest an icon */
let typeCatById: Map<number, number> | null = null;
const CHARGE_CATEGORY = 8;
const RENDER_CATEGORIES = new Set([6, 18, 65, 87]);
let typeMapLoading = false;

/** builds the type maps once; the returned number changes when they arrive,
 * so a component that calls this re-renders with names and icons */
export function useTypeIcons(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (typeIdByName !== null) { setRev((r) => r + 1); return; }
    if (typeMapLoading) {
      // another component started the load — look again until it lands
      const t = setInterval(() => { if (typeIdByName !== null) { clearInterval(t); setRev((r) => r + 1); } }, 250);
      return () => clearInterval(t);
    }
    typeMapLoading = true;
    void ensureDogma().then((data) => {
      const m = new Map<string, { id: number; cat: number }>();
      const byId = new Map<number, string>();
      const catById = new Map<number, number>();
      for (const [id, t] of Object.entries(data.types as Record<string, { name: string; categoryID: number; groupID?: number }>)) {
        if (t && (ICON_CATS.has(t.categoryID) || t.groupID === GAS_GROUP)) m.set(t.name, { id: Number(id), cat: t.categoryID });
        if (t) { byId.set(Number(id), t.name); catById.set(Number(id), t.categoryID); }
      }
      typeIdByName = m;
      typeNameById = byId;
      typeCatById = catById;
      setRev((r) => r + 1);
    }).catch(() => { typeMapLoading = false; });
    return undefined;
  }, []);
  return rev;
}

/** the type maps are in (names resolve, icons draw) */
export const typesLoaded = (): boolean => typeIdByName !== null;
/** a type by its exact name: ships, modules, charges, drones, ore, gas */
export const typeByName = (name: string): { id: number; cat: number } | undefined => typeIdByName?.get(name);
/** hull/type name from an id (ship history + killmails give ids) */
export function typeName(id: number): string { return typeNameById?.get(id) ?? `#${id}`; }
export const isChargeType = (id: number): boolean => typeCatById?.get(id) === CHARGE_CATEGORY;

export function TypeIcon({ name, size = 32, title }: { name: string; size?: number; title?: string }) {
  const t = typeIdByName?.get(name);
  if (!t) return <span style={{ width: size, height: size, flex: 'none' }} />;
  const kind = t.cat === 6 || t.cat === 11 ? 'render' : 'icon';
  return (
    <img src={`https://images.evetech.net/types/${t.id}/${kind}?size=64`}
      width={size} height={size} alt="" title={title ?? name}
      style={{ borderRadius: 5, flex: 'none', background: 'rgba(128,128,128,.08)' }}
      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
  );
}

/** icon straight from a type ID (killmails give ship type ids, not names) */
export function TypeIconId({ id, size = 32 }: { id: number; size?: number }) {
  if (!id) return <span style={{ width: size, height: size, flex: 'none' }} />;
  // modules, charges and rigs have no render — asking for one drew a blank;
  // an unknown category keeps the old render
  const cat = typeCatById?.get(id);
  const kind = cat === undefined || RENDER_CATEGORIES.has(cat) ? 'render' : 'icon';
  return (
    <img src={`https://images.evetech.net/types/${id}/${kind}?size=64`}
      width={size} height={size} alt=""
      style={{ borderRadius: 5, flex: 'none', background: 'rgba(128,128,128,.08)' }}
      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
  );
}

// ---------------------------------------------------------------------------
// THE PANEL
// ---------------------------------------------------------------------------

export const PANEL_CARD: CSSProperties = {
  border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px',
  background: 'rgba(128,128,128,.04)',
};
const fmtN = (n: number): string => Math.round(n).toLocaleString();
const hhmm = (t: number): string => new Date(t).toISOString().slice(11, 16);

/** "3 d before" / "2 h after" / "20 min after" — how far a loss sits from the window */
function gapWords(gapMs: number): string {
  const a = Math.abs(gapMs);
  const n = a >= 36 * 3_600_000 ? `${Math.round(a / 86_400_000)} d` : a >= 90 * 60_000 ? `${Math.round(a / 3_600_000)} h` : `${Math.max(1, Math.round(a / 60_000))} min`;
  return `${n} ${gapMs < 0 ? 'before' : 'after'}`;
}

const CERTAINTY_STYLE: Record<FitCertainty, { label: string; color: string }> = {
  confirmed: { label: 'confirmed fit', color: '#5fd08a' },
  likely: { label: 'likely fit', color: '#f0c674' },
};
const MATES_COLOR = '#7fb4e6';
const FIT_RACKS: Rack[] = ['high', 'mid', 'low', 'rig', 'sub'];
const SLOT_LABEL: Record<Rack, string> = {
  high: 'high slots', mid: 'mid slots', low: 'low slots', rig: 'rigs', sub: 'subsystems',
};

/** the racks of one fit: each module with the charge that was loaded in it
 * beneath, then drones, the hold, and — for a pod — the implants */
export function FitRacks({ fit }: { fit: KillFit }) {
  const stackList = (title: string, xs: readonly Stack[]) => (xs.length > 0 ? (
    <div>
      <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>{title}</div>
      {xs.map((s) => (
        <div key={s.typeId} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 12.5 }} title={typeName(s.typeId)}>
          <TypeIconId id={s.typeId} size={22} />
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.qty > 1 ? `${fmtN(s.qty)}× ` : ''}{typeName(s.typeId)}</span>
        </div>
      ))}
    </div>
  ) : null);
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
      {FIT_RACKS.map((rack) => (fit[rack].length > 0 ? (
        <div key={rack}>
          <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>{SLOT_LABEL[rack]}</div>
          {fit[rack].map((m: FittedModule) => (
            <div key={m.flag} style={{ marginBottom: 4, fontSize: 12.5 }}
              title={m.chargeTypeId !== undefined ? `${typeName(m.typeId)} — loaded with ${typeName(m.chargeTypeId)}` : typeName(m.typeId)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <TypeIconId id={m.typeId} size={22} />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{typeName(m.typeId)}</span>
              </div>
              {m.chargeTypeId !== undefined && (
                <div className="dim" style={{ marginLeft: 28, fontSize: 11.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  ↳ {m.chargeQty && m.chargeQty > 1 ? `${fmtN(m.chargeQty)}× ` : ''}{typeName(m.chargeTypeId)}
                </div>
              )}
            </div>
          ))}
        </div>
      ) : null))}
      {stackList('drones', fit.drones)}
      {stackList('cargo', [...fit.cargo, ...fit.looseCharges])}
      {stackList('implants', fit.implants)}
    </div>
  );
}

/**
 * A PICTURE THAT IS A LINK (v0.204.2). The panel had a zKill button that went to the pilot, a text
 * link in the middle that went to the kill, and another beside a second picture of the ship — the
 * owner: "inconsistent, repetitive, and ugly". Now the pictures are the links and they say so: a
 * ring on hover, a zKillboard badge on the corner, a caption underneath. Headshot → the pilot; the
 * ship up top → that kill; a fit's picture → the killmail the fit was read from.
 */
export function ZkPic({ url, caption, title, small, children }: { url: string; caption?: string; title?: string; small?: boolean; children: ReactNode }) {
  return (
    <div style={{ textAlign: 'center', flex: 'none' }}>
      <a className={`zk-pic${small ? ' zk-pic-small' : ''}`} href={url} title={title ?? caption}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); window.open(url, '_blank'); }}>
        {children}
        <span className="zk-badge">zKill ↗</span>
      </a>
      {caption && <div className="dim" style={{ fontSize: 11.5, marginTop: 4, maxWidth: 110 }}>{caption}</div>}
    </div>
  );
}

/** a killmail in the scope on screen with this pilot as the victim */
export interface PilotKillmail {
  id: number;
  /** the killmail's hash when the caller has it; without one it is looked up */
  hash?: string;
  value: number;
  /** ms epoch */
  t: number;
  shipTypeId: number;
}

export interface PilotFitPanelProps {
  pilot: string;
  /** the character id when the caller knows it (Battle Reports); else looked up by name */
  pilotId?: number;
  /** corp ticker or name to show until the affiliation arrives */
  corpHint?: string | null;
  /** the hull in question, by name and/or id; neither = the source named none */
  shipName?: string;
  shipTypeId?: number;
  /** the scope on screen: the fight, the battle, or the whole range (ms) */
  win: { t0: number; t1: number };
  /** killmails in that scope with this pilot as the victim — exact evidence */
  killmails: PilotKillmail[];
  /** how the panel words that evidence */
  words: { onMail: string };
  /** context above the fit (what passed between you, their part in the battle) */
  children?: ReactNode;
  onClose: () => void;
}

export function PilotFitPanel({ pilot, pilotId, corpHint, shipName = '', shipTypeId, win, killmails, words, children, onClose }: PilotFitPanelProps) {
  useTypeIcons();
  const [charId, setCharId] = useState<number | null>(pilotId && pilotId > 0 ? pilotId : null);
  const [aff, setAff] = useState<CharAffiliation | null>(null);
  const [fit, setFit] = useState<LikelyFit | null>(null);
  // 'unread' (v0.204.2): a killmail of this hull IS in scope but could not be read right now —
  // never to be worded as "they have no loss", and no reason to guess from corp mates
  const [fitState, setFitState] = useState<'idle' | 'loading' | 'done' | 'none' | 'unread'>('idle');
  // the fallback: corp mates' fits in the same hull
  const [mates, setMates] = useState<MateFits | null>(null);
  const [matesState, setMatesState] = useState<'idle' | 'loading' | 'done' | 'none'>('idle');
  const [withCargo, setWithCargo] = useState(false);
  /** which fit was copied last (its killmail id), or 'failed' */
  const [copied, setCopied] = useState<number | 'failed' | null>(null);

  const subject = `${pilot}|${pilotId ?? 0}|${shipName}|${shipTypeId ?? 0}|${killmails.map((k) => k.id).join(',')}`;
  // a slow answer for the PREVIOUS pilot or loss must not land on this one
  const subjectRef = useRef(subject);
  subjectRef.current = subject;
  useEffect(() => {
    let alive = true;
    setAff(null); setFit(null); setFitState('idle'); setMates(null); setMatesState('idle'); setCopied(null);
    const known = pilotId && pilotId > 0 ? pilotId : null;
    setCharId(known);
    const withId = (id: number) => { void charAffiliation(id).then((a) => { if (alive) setAff(a); }); };
    if (known) withId(known);
    else void resolveCharIds([pilot]).then((m) => { const id = m.get(pilot); if (alive && id) { setCharId(id); withId(id); } });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subject]);

  // one killmail shows once however many of your characters are on it
  const shared = killmails.filter((k, i, a) => a.findIndex((x) => x.id === k.id) === i);
  const typesReady = typesLoaded();
  const shipId = shipTypeId && shipTypeId > 0 ? shipTypeId : (typeByName(shipName)?.id ?? 0);
  const seenHull = shipName || (shipId ? typeName(shipId) : '');
  // the ship up top opens THAT kill: the killmail in scope for this hull (the one clicked, in
  // Battle Reports), else the only one there is; once a confirmed fit is in, its own killmail
  const topKill = (fit?.pick.certainty === 'confirmed' ? shared.find((k) => k.id === fit.killId) : undefined)
    ?? shared.find((k) => shipId !== 0 && k.shipTypeId === shipId) ?? (shared.length === 1 ? shared[0] : undefined);

  const loadMates = (known?: CharAffiliation | null) => {
    if (charId == null || !shipId || matesState === 'loading') return;
    setMatesState('loading');
    const token = subject;
    void (async () => {
      const a = known ?? aff ?? await charAffiliation(charId);
      const m = a ? await mateFits(a, charId, shipId, win, isChargeType) : null;
      if (subjectRef.current !== token) return;
      setMates(m); setMatesState(m ? 'done' : 'none');
      logInfo('combat', 'corp mates fits read', m
        ? { from: m.from, listed: m.listed, read: m.result.considered, bare: m.result.bare, distinct: m.result.distinct, shown: m.result.options.length }
        : { none: true, npcCorp: a ? isNpcCorp(a.corpId) : null, alliance: !!a?.allianceId });
    })();
  };

  const loadFit = () => {
    if (charId == null || fitState !== 'idle') return;
    setFitState('loading');
    // the hull in question, the killmails in scope and the window decide
    // WHICH loss is read and how sure it is — never another hull; with no
    // loss of the hull, their corp mates' fits
    const ctx = { seenShipTypeId: shipId, sharedKillIds: new Set(shared.map((k) => k.id)), ...win };
    const refs = shared.map((k) => ({ killmail_id: k.id, hash: k.hash ?? '', value: k.value }));
    const token = subject;
    void likelyFit(charId, ctx, refs, isChargeType).then((f) => {
      if (subjectRef.current !== token) return;
      const inScope = shared.some((k) => shipId === 0 || k.shipTypeId === shipId);
      setFit(f); setFitState(f ? 'done' : inScope ? 'unread' : 'none');
      if (f) logInfo('combat', 'enemy fit read', { certainty: f.pick.certainty, onMail: f.pick.onMail, inWindow: f.pick.inWindow, sameHull: f.pick.sameHull, gapMin: Math.round(f.pick.gapMs / 60_000), modules: moduleCount(f.fit), drones: f.fit.drones.length, cargo: f.fit.cargo.length });
      else if (inScope) logInfo('combat', 'enemy fit: the killmail in scope could not be read', { killmails: shared.length });
      else { logInfo('combat', 'enemy fit: no loss of the hull', { hullKnown: shipId > 0 }); if (shipId) loadMates(); }
    });
  };
  // a killmail in scope with them as the victim: the exact fit is one
  // killmail away — no reason to make the user ask
  // (fitState is a dependency on purpose: switching to another loss inside the
  // panel resets it to idle AFTER this effect's first run for the new subject)
  useEffect(() => {
    if (charId != null && typesReady && shared.length > 0 && fitState === 'idle') loadFit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [charId, typesReady, shared.length, subject, fitState]);

  const copyFit = (hullId: number, kf: KillFit, fitName: string, killId: number, what: string) => {
    const text = killFitEft(typeName(hullId), fitName, kf, typeName, { cargo: withCargo });
    void navigator.clipboard.writeText(text).then(() => setCopied(killId)).catch(() => setCopied('failed'));
    logUser('combat: enemy fit copied', { what, withCargo, lines: text.split('\n').length });
  };
  const copyBar = (
    <label className="dim" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer' }}
      title="Also copy what was in the cargo hold when it died — spare ammo and cap boosters, but loot and junk too. Drones are always copied.">
      <input type="checkbox" checked={withCargo} onChange={(e) => { setWithCargo(e.target.checked); setCopied(null); }} style={{ margin: 0 }} />
      + cargo
    </label>
  );
  const COPY_TITLE = 'Copy this fit as EFT text. In game: open the fitting window → Import & Export → Import from clipboard, then open the saved fit and press Simulate. Pyfa reads the same text.';
  const copiedNote = copied === null ? null : (
    <div style={{ fontSize: 12.5, margin: '6px 0', color: copied === 'failed' ? 'var(--bad)' : '#5fd08a' }}>
      {copied === 'failed'
        ? 'the clipboard refused the copy — click the window once and try again.'
        : <>copied ✓ — in game: fitting window → <b>Import &amp; Export</b> → <b>Import from clipboard</b>, then open the fit and press <b>Simulate</b>.</>}
    </div>
  );

  const pick = fit?.pick ?? null;
  const cert = pick ? CERTAINTY_STYLE[pick.certainty] : null;
  const hullName = fit ? typeName(fit.shipTypeId) : seenHull;
  const nothingFitted = !!fit && moduleCount(fit.fit) === 0;
  const basis = !fit || !pick ? '' : pick.certainty === 'confirmed'
    ? `${pick.onMail
      ? `the killmail of the ${hullName} they lost at ${hhmm(fit.lossTime)} — ${words.onMail}`
      : `they lost this ${hullName} at ${hhmm(fit.lossTime)}, inside the window on screen (not one of the killmails listed above)`
    }. This is what was fitted when it died, not an inference.${pick.lossesInWindow > 1 ? ` They lost ${pick.lossesInWindow} of this hull in the window — this is the last one.` : ''}`
    : `no ${hullName} loss inside this window — this is their own ${hullName} lost ${gapWords(pick.gapMs)} it, the nearest in time. A strong guess for a doctrine ship, a guess all the same.`;
  const unreadText = `the killmail of this ${seenHull || 'ship'} could not be read just now — zKillboard or CCP did not answer. The kill page above still opens; try again in a moment.`;
  const noneText = !shipId
    ? 'no hull is known for this pilot here, and they did not die inside this window — nothing to match a fit against.'
    : `they have no ${seenHull} loss on zKillboard. Another hull would say nothing about this ship, so none is shown.`;
  const mateOwner = mates ? `${mates.from === 'alliance' ? 'alliance' : 'corp'} mates` : 'corp mates';

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" style={{ maxWidth: 720, maxHeight: '86vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 14 }}>
          {charId != null
            ? (
              <ZkPic url={`https://zkillboard.com/character/${charId}/`} caption="pilot on zKill" title={`${pilot} on zKillboard`}>
                <img src={`https://images.evetech.net/characters/${charId}/portrait?size=128`} width={72} height={72} alt="" style={{ borderRadius: 8, display: 'block' }} />
              </ZkPic>
            )
            : <span style={{ width: 72, height: 72, borderRadius: 8, background: 'rgba(128,128,128,.12)', flex: 'none' }} />}
          <div style={{ flex: 1, minWidth: 0, paddingTop: 4 }}>
            <div style={{ fontSize: 20, fontWeight: 800 }}>{pilot}</div>
            <div className="dim" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
              {aff?.allianceId ? <img src={`https://images.evetech.net/alliances/${aff.allianceId}/logo?size=32`} width={20} height={20} alt="" /> : null}
              {aff?.corpId ? <img src={`https://images.evetech.net/corporations/${aff.corpId}/logo?size=32`} width={20} height={20} alt="" /> : null}
              {aff ? `${aff.corpName}${aff.allianceName ? ` · ${aff.allianceName}` : ''}` : (corpHint ?? '')}
            </div>
          </div>
          {shipId !== 0 && (topKill
            ? (
              <ZkPic url={`https://zkillboard.com/kill/${topKill.id}/`} caption={`${seenHull} · this kill`}
                title={`the killmail of this ${seenHull} on zKillboard — ${hhmm(topKill.t)} · ${fmtN(topKill.value / 1e6)}M ISK`}>
                <TypeIconId id={shipId} size={72} />
              </ZkPic>
            )
            : (
              <div style={{ textAlign: 'center', flex: 'none' }} title={`${seenHull} — no killmail of it in this scope, so there is no kill page to open`}>
                <TypeIconId id={shipId} size={72} />
                <div className="dim" style={{ fontSize: 11.5, marginTop: 4 }}>{seenHull}</div>
              </div>
            ))}
        </div>

        {children}

        <div style={{ ...PANEL_CARD, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: cert ? cert.color : 'var(--muted)' }}>
              {cert ? `${pick!.certainty === 'confirmed' ? '✓ ' : ''}${cert.label}` : 'their fit'}
            </span>
            <span className="dim" style={{ fontSize: 12, flex: 1, minWidth: 240 }}>
              {basis || (fitState === 'unread' ? unreadText : fitState === 'none' ? noneText : `their own ${seenHull || 'ship'} losses on zKillboard — exact when they lost it in this window, the nearest in time otherwise; never another hull`)}
            </span>
          </div>
          {fitState === 'idle' && (
            <button className="btn" onClick={loadFit} disabled={charId == null}
              style={{ fontSize: 13 }}>
              {charId == null ? 'resolving pilot…' : `read ${seenHull || 'their'} fit from zKill`}
            </button>
          )}
          {fitState === 'loading' && <div className="dim" style={{ fontSize: 13 }}>reading the killmail…</div>}
          {fitState === 'unread' && <button className="btn mini" onClick={() => { setFitState('idle'); }}>try again</button>}
          {fitState === 'done' && fit && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <ZkPic url={`https://zkillboard.com/kill/${fit.killId}/`} small
                  title={pick?.certainty === 'confirmed' ? `the killmail this fit was read from — the ${hullName} that died here` : `the killmail this fit was read from — their ${hullName} lost ${pick ? gapWords(pick.gapMs) : ''} this fight, not the ship on screen`}>
                  <TypeIconId id={fit.shipTypeId} size={40} />
                </ZkPic>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700 }}>{hullName}</div>
                  <div className="dim" style={{ fontSize: 12 }}>lost {hhmm(fit.lossTime)} · {fmtN(fit.lossValue / 1e6)}M ISK{pick?.certainty === 'likely' ? ` · ${gapWords(pick.gapMs)} this fight` : ''}</div>
                </div>
                {!nothingFitted && (
                  <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {copyBar}
                    <button className="btn mini" title={COPY_TITLE}
                      onClick={() => copyFit(fit.shipTypeId, fit.fit, `${pilot} - lost ${hhmm(fit.lossTime)}`, fit.killId, fit.pick.certainty)}>
                      ⧉ copy fit for the game
                    </button>
                  </span>
                )}
              </div>
              {copied === fit.killId || (copied === 'failed' && !mates) ? copiedNote : null}
              {nothingFitted && (
                <div className="dim" style={{ fontSize: 12.5, marginBottom: 8 }}>
                  nothing was fitted — {fit.fit.implants.length > 0 ? 'a capsule; the implants that died with it are below.' : 'a capsule or an empty hull.'}
                </div>
              )}
              <FitRacks fit={fit.fit} />
              {pick?.certainty === 'confirmed' && !nothingFitted && (
                <div className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
                  What no killmail shows: boosters, fleet boosts, heat, and anything they swapped earlier in the fight. Charges are what was loaded at the moment it died; implants appear only on the pod&apos;s own killmail.
                </div>
              )}
              {pick?.certainty === 'likely' && shipId !== 0 && matesState === 'idle' && (
                <button className="btn mini" style={{ marginTop: 10 }} onClick={() => loadMates()}
                  title={`Also read what their corp mates lost in a ${seenHull} — shared doctrine fits show up as one fit lost by several pilots.`}>
                  ＋ corp mates&apos; {seenHull} fits
                </button>
              )}
            </>
          )}

          {/* ---- the fallback: corp mates' fits in the SAME hull ---- */}
          {matesState !== 'idle' && (
            <div style={{ marginTop: fitState === 'done' ? 14 : 4, paddingTop: fitState === 'done' ? 12 : 0, borderTop: fitState === 'done' ? '1px solid var(--border)' : undefined }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, color: MATES_COLOR }}>{mateOwner}&apos; fits</span>
                <span className="dim" style={{ fontSize: 12, flex: 1, minWidth: 240 }}>
                  {matesState === 'loading' ? `reading what their corp mates lost in a ${seenHull}…`
                    : matesState === 'none' ? (aff && isNpcCorp(aff.corpId) && !aff.allianceId
                      ? `they are in an NPC corporation (${aff.corpName}) with no alliance — thousands of strangers, no shared fits to read.`
                      : `no ${seenHull} loss with a real fit on it among their ${aff?.allianceId ? 'corp or alliance' : 'corp'} mates either.`)
                      : mates ? `${seenHull}s lost by other ${mates.ownerName} pilots — not this pilot's ship. ${mates.result.considered} of ${mates.listed} losses read (the nearest in time to this fight), ${mates.result.distinct} distinct fit${mates.result.distinct === 1 ? '' : 's'}${mates.result.bare > 0 ? `, ${mates.result.bare} stripped hull${mates.result.bare === 1 ? '' : 's'} left out` : ''}. A fit several pilots lost is a doctrine.`
                        : ''}
                </span>
                {matesState === 'done' && fitState !== 'done' && copyBar}
              </div>
              {matesState === 'done' && mates && mates.result.options.map((o, i) => (
                <details key={o.key} style={{ marginBottom: 6, border: '1px solid var(--border)', borderRadius: 6, padding: '6px 8px' }}>
                  <summary style={{ cursor: 'pointer', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <b>Fit {i + 1}</b>
                    <span style={{ color: o.pilots > 1 ? '#5fd08a' : undefined }}>
                      {o.pilots > 1 ? `lost by ${o.pilots} pilots` : 'one pilot'}{o.losses > o.pilots ? ` · ${o.losses} losses` : ''}
                    </span>
                    <span className="dim" style={{ fontSize: 12 }}>
                      {mates.names.get(o.sample.charId) ?? 'a corp mate'} · {o.gapMs === 0 ? 'in this window' : `${gapWords(o.gapMs)} it`} · {moduleCount(o.sample.fit)} modules · {fmtN(o.sample.value / 1e6)}M
                    </span>
                    <button className="btn mini" style={{ marginLeft: 'auto' }} title={COPY_TITLE}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); copyFit(mates.shipTypeId, o.sample.fit, `${mates.ownerName} ${typeName(mates.shipTypeId)} fit ${i + 1}`, o.sample.killId, `mates-${mates.from}`); }}>
                      ⧉ copy
                    </button>
                  </summary>
                  <div style={{ marginTop: 8 }}>
                    {copied === o.sample.killId ? copiedNote : null}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                      <ZkPic url={`https://zkillboard.com/kill/${o.sample.killId}/`} small title="the killmail this fit was read from — a corp mate's ship, not this pilot's">
                        <TypeIconId id={mates.shipTypeId} size={40} />
                      </ZkPic>
                      <div className="dim" style={{ fontSize: 12 }}>{mates.names.get(o.sample.charId) ?? 'a corp mate'}&apos;s {typeName(mates.shipTypeId)} · {fmtN(o.sample.value / 1e6)}M ISK</div>
                    </div>
                    <FitRacks fit={o.sample.fit} />
                  </div>
                </details>
              ))}
              {matesState === 'done' && mates && mates.result.options.some((o) => copied === o.sample.killId) && (
                <div className="dim" style={{ fontSize: 11.5 }}>copied ✓ — open that fit&apos;s row for the in-game steps.</div>
              )}
              {copied === 'failed' && mates ? copiedNote : null}
            </div>
          )}
        </div>

        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button className="btn mini" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}
