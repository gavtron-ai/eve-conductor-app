// BATTLE REPORT — the two things the page lacked (v0.204.2, the owner: "I hate
// that it doesn't show everyone involved… I also want a timeline that is
// hoverable and toggleable between modes… while maintaining accuracy"):
//   FightTimeline — every killmail on a time axis, the running totals per side
//                   as step lines, four modes, a hover card, click a kill to
//                   open that pilot. Numbers come from fightTimeline.ts, which
//                   only ever sums killmails.
//   FightRoster   — everyone seen on the fight's killmails, both sides: what
//                   they flew, what they did, what they lost. Pictures open the
//                   pilot panel like everywhere else.
import { useMemo, useRef, useState } from 'react';
import type { FightDigest, RosterRow, TimelinePoint } from '../lib/battleNarrative';
import { TIMELINE_MODES, nearestIndex, seriesMax, stepPath, timelineSeries, valueAt, type TimelineMode } from '../lib/fightTimeline';
import { iskShort } from '../lib/format';
import { maxOf } from '../lib/nums';

const OURS = '#4da3ff';
const THEIRS = '#ff5b5b';
const hms = (t: number): string => new Date(t).toISOString().slice(11, 19);
const hm = (t: number): string => new Date(t).toISOString().slice(11, 16);
const num = (v: number): string => Math.round(v).toLocaleString();
const shipIcon = (typeId: number): string => `https://images.evetech.net/types/${typeId}/icon?size=64`;
const portrait = (charId: number): string => `https://images.evetech.net/characters/${charId}/portrait?size=64`;
const corpLogo = (corpId: number): string => `https://images.evetech.net/corporations/${corpId}/logo?size=32`;

export interface PilotOpen { pilotId: number; pilot: string; shipId: number; ship: string; killId: number | null }

// ---------------------------------------------------------------------------
// TIMELINE
// ---------------------------------------------------------------------------

const W = 1000; const H = 230; const PAD = { l: 58, r: 16, t: 14, b: 26 };

export function FightTimeline({ points, onPilot }: { points: TimelinePoint[]; onPilot: (v: PilotOpen) => void }) {
  const [mode, setMode] = useState<TimelineMode>(() => { try { const m = localStorage.getItem('etc-br-timeline-mode'); return TIMELINE_MODES.some((x) => x.key === m) ? m as TimelineMode : 'ships'; } catch { return 'ships'; } });
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const meta = TIMELINE_MODES.find((m) => m.key === mode)!;
  const series = useMemo(() => timelineSeries(points, mode), [points, mode]);
  const fmt = (v: number): string => (mode === 'isk' ? (v > 0 ? iskShort(v) : '0') : num(v));

  if (points.length === 0) return null;
  const t0 = points[0].t; const t1 = points[points.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const max = seriesMax(series);
  const x = (t: number) => PAD.l + ((t - t0) / span) * (W - PAD.l - PAD.r);
  const y = (v: number) => H - PAD.b - (v / max) * (H - PAD.t - PAD.b);
  const path = (side: 'ours' | 'theirs') => stepPath(series.map((s) => [x(s.t), y(s[side])] as [number, number]));
  const ticks = [0, 0.5, 1].map((f) => f * max);
  const timeTicks = span > 60_000 ? [t0, t0 + span / 2, t1] : [t0];
  const hp = hover !== null ? points[hover] : null;

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    const t = t0 + ((px - PAD.l) / (W - PAD.l - PAD.r)) * span;
    setHover(nearestIndex(points, t));
  };
  const pickMode = (m: TimelineMode) => { setMode(m); try { localStorage.setItem('etc-br-timeline-mode', m); } catch { /* nicety */ } };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
        {TIMELINE_MODES.map((m) => (
          <button key={m.key} className={`btn mini${mode === m.key ? ' on' : ''}`} onClick={() => pickMode(m.key)} title={m.note}>{m.label}</button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 12, fontSize: 12 }}>
          <span><span style={{ color: OURS }}>━</span> {meta.ours} <b style={{ color: OURS }}>{fmt(series[series.length - 1].ours)}</b></span>
          <span><span style={{ color: THEIRS }}>━</span> {meta.theirs} <b style={{ color: THEIRS }}>{fmt(series[series.length - 1].theirs)}</b></span>
        </span>
      </div>
      <div style={{ position: 'relative' }}>
        <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', cursor: 'crosshair' }}
          onMouseMove={onMove} onMouseLeave={() => setHover(null)}
          onClick={() => { if (hp && hp.pilotId > 0) onPilot({ pilotId: hp.pilotId, pilot: hp.pilot, shipId: hp.shipId, ship: hp.ship, killId: hp.killmailId }); }}>
          {ticks.map((v) => (
            <g key={v}>
              <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--grid, rgba(128,128,128,.18))" strokeWidth={1} />
              <text x={PAD.l - 8} y={y(v) + 4} textAnchor="end" fontSize={12} fill="var(--muted)">{fmt(v)}</text>
            </g>
          ))}
          {timeTicks.map((t, i) => (
            <text key={t} x={x(t)} y={H - 6} textAnchor={i === 0 ? 'start' : i === timeTicks.length - 1 ? 'end' : 'middle'} fontSize={12} fill="var(--muted)">{hm(t)}</text>
          ))}
          <path d={path('ours')} fill="none" stroke={OURS} strokeWidth={2.5} strokeLinejoin="round" />
          <path d={path('theirs')} fill="none" stroke={THEIRS} strokeWidth={2.5} strokeLinejoin="round" />
          {/* one mark per killmail, on the line of the side that lost it; pods smaller and hollow */}
          {points.map((p, i) => {
            const cx = x(p.t); const cy = y(valueAt(p, p.side, mode));
            const c = p.side === 'ours' ? OURS : THEIRS;
            return p.pod
              ? <circle key={p.killmailId} cx={cx} cy={cy} r={hover === i ? 5 : 3} fill="var(--panel, #14181f)" stroke={c} strokeWidth={1.5} />
              : <circle key={p.killmailId} cx={cx} cy={cy} r={hover === i ? 6.5 : 4} fill={c} stroke="var(--panel, #14181f)" strokeWidth={1.5} />;
          })}
          {hp && <line x1={x(hp.t)} x2={x(hp.t)} y1={PAD.t} y2={H - PAD.b} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 4" />}
        </svg>
        {hp && (
          <div style={{
            position: 'absolute', top: 4, pointerEvents: 'none', zIndex: 2, minWidth: 250, maxWidth: 330,
            ...(x(hp.t) / W > 0.55 ? { right: `${(1 - x(hp.t) / W) * 100 + 1.5}%` } : { left: `${(x(hp.t) / W) * 100 + 1.5}%` }),
            background: 'var(--panel, #14181f)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: 12.5, lineHeight: 1.5,
            boxShadow: '0 6px 18px rgba(0,0,0,.35)',
          }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <img src={shipIcon(hp.shipId)} alt="" width={34} height={34} style={{ borderRadius: 5 }} />
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: hp.side === 'ours' ? OURS : THEIRS }}>{hp.side === 'ours' ? 'we lost' : 'they lost'} a {hp.ship}</div>
                <div className="dim" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{hp.pilot} · {hms(hp.t)} EVE</div>
              </div>
            </div>
            <div style={{ marginTop: 4 }}><b>{hp.isk}</b> <span className="dim">· took {num(hp.dmgTaken)} damage from {hp.attackers} {hp.attackers === 1 ? 'attacker' : 'attackers'}</span></div>
            <div className="dim" style={{ marginTop: 4 }}>
              by then — <span style={{ color: OURS }}>{meta.ours} {fmt(valueAt(hp, 'ours', mode))}</span> · <span style={{ color: THEIRS }}>{meta.theirs} {fmt(valueAt(hp, 'theirs', mode))}</span>
              {mode === 'ships' && (hp.cum.ours.pods + hp.cum.theirs.pods > 0) ? <> · pods {hp.cum.ours.pods} / {hp.cum.theirs.pods}</> : null}
            </div>
            {hp.pilotId > 0 && <div className="dim" style={{ marginTop: 2, fontSize: 11.5 }}>click for the pilot and the exact fit</div>}
          </div>
        )}
      </div>
      <div className="dim" style={{ fontSize: 11.5, marginTop: 2 }}>{meta.note}. ● a ship · ○ a pod.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// EVERYONE INVOLVED
// ---------------------------------------------------------------------------

type RosterSort = 'dmg' | 'kills' | 'lost' | 'name';
const SORTS: { key: RosterSort; label: string }[] = [{ key: 'dmg', label: 'damage' }, { key: 'kills', label: 'kills' }, { key: 'lost', label: 'lost' }, { key: 'name', label: 'name' }];
const lostIsk = (r: RosterRow): number => r.losses.reduce((s, l) => s + l.iskNum, 0);

function RosterSide({ title, colour, rows, sort, onPilot }: { title: string; colour: string; rows: RosterRow[]; sort: RosterSort; onPilot: (v: PilotOpen) => void }) {
  const sorted = useMemo(() => rows.slice().sort((a, b) => (sort === 'dmg' ? b.dmg - a.dmg : sort === 'kills' ? b.kills - a.kills || b.dmg - a.dmg
    : sort === 'lost' ? lostIsk(b) - lostIsk(a) || b.dmg - a.dmg : a.name.localeCompare(b.name))), [rows, sort]);
  const maxDmg = Math.max(1, maxOf(rows.map((r) => r.dmg)));
  const open = (r: RosterRow, ship?: { id: number; name: string }) => {
    const hull = ship ?? r.ships[0] ?? { id: 0, name: '' };
    const died = r.losses.find((l) => l.shipId === hull.id);
    onPilot({ pilotId: r.pilotId, pilot: r.name, shipId: hull.id, ship: hull.name, killId: died ? died.killmailId : null });
  };
  return (
    <div style={{ border: '1px solid var(--border)', borderTop: `3px solid ${colour}`, borderRadius: 8, padding: '8px 10px', minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
        <span style={{ color: colour, fontWeight: 700, fontSize: 14 }}>{title}</span>
        <span className="dim" style={{ fontSize: 12 }}>{rows.length} {rows.length === 1 ? 'pilot' : 'pilots'} · {rows.filter((r) => r.losses.some((l) => !l.pod)).length} lost a ship</span>
      </div>
      <div style={{ maxHeight: 420, overflowY: 'auto', paddingRight: 4 }}>
        {sorted.map((r) => (
          <div key={r.pilotId} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '3px 0', minWidth: 0 }}>
            <img src={portrait(r.pilotId)} alt="" width={30} height={30} style={{ borderRadius: 4, flexShrink: 0, cursor: 'pointer' }}
              title={`${r.name} — open the pilot panel`} onClick={() => open(r)}
              onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
            <span style={{ display: 'inline-flex', gap: 2, flexShrink: 0 }}>
              {r.ships.slice(0, 3).map((s) => {
                const died = r.losses.some((l) => l.shipId === s.id);
                return (
                  <img key={s.id} src={shipIcon(s.id)} alt="" width={30} height={30}
                    style={{ borderRadius: 4, cursor: 'pointer', outline: died ? `2px solid ${THEIRS}` : undefined, outlineOffset: -2 }}
                    title={`${s.name}${died ? ' — LOST in this battle: the exact fit' : ' — their fit (their own nearest loss of it, else corp mates’)'}`}
                    onClick={() => open(r, s)} onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
                );
              })}
              {r.ships.length === 0 && <span style={{ width: 30, height: 30 }} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {r.corpId > 0 && <img src={corpLogo(r.corpId)} alt="" width={14} height={14} title={r.corp} style={{ borderRadius: 2, verticalAlign: -2, marginRight: 4 }} />}
                {r.name}
                <span className="dim"> · {r.ships.map((s) => s.name).join(', ') || (r.losses.some((l) => l.pod) ? 'pod only' : '—')}</span>
              </div>
              <div style={{ height: 3, borderRadius: 2, background: 'rgba(255,255,255,.08)', marginTop: 2 }}>
                <div style={{ width: `${Math.round((r.dmg / maxDmg) * 100)}%`, height: '100%', background: colour, opacity: 0.7, borderRadius: 2 }} />
              </div>
            </div>
            <div style={{ textAlign: 'right', flexShrink: 0, fontSize: 12, lineHeight: 1.35, fontVariantNumeric: 'tabular-nums' }}>
              <div>{num(r.dmg)} <span className="dim">dmg</span></div>
              <div className="dim">
                {r.kills > 0 ? `${r.kills} ${r.kills === 1 ? 'kill' : 'kills'}${r.finalBlows > 0 ? ` · ${r.finalBlows} fb` : ''}` : 'no kills'}
                {r.losses.length > 0 && <span style={{ color: THEIRS }}> · ☠ {iskShort(lostIsk(r))}</span>}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function FightRoster({ d, onPilot }: { d: FightDigest; onPilot: (v: PilotOpen) => void }) {
  const [sort, setSort] = useState<RosterSort>('dmg');
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
        <span className="dim" style={{ fontSize: 12 }}>sort</span>
        {SORTS.map((s) => <button key={s.key} className={`btn mini${sort === s.key ? ' on' : ''}`} onClick={() => setSort(s.key)}>{s.label}</button>)}
        <span className="dim" style={{ fontSize: 11.5, marginLeft: 8 }}>everyone seen on this fight&apos;s killmails — a pilot who neither got on a killmail nor died is invisible to any killboard. A red ring = that hull was lost here.</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <RosterSide title="Team A — ours" colour={OURS} rows={d.roster?.ours ?? []} sort={sort} onPilot={onPilot} />
        <RosterSide title="Team B" colour={THEIRS} rows={d.roster?.theirs ?? []} sort={sort} onPilot={onPilot} />
      </div>
    </div>
  );
}
