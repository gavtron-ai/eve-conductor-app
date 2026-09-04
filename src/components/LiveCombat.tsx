// LIVE COMBAT — analytics over the EVE client's own game logs.
//
// v0.121.0, to the owner's third critique ("brainstorm what else would be
// useful and implement tons of good stuff"):
//   · RANGE MODES: last 24 h / last 3 days / a picked date — the 24 h
//     window crosses midnight by filtering EVENT TIMES, not file dates;
//   · SELECTION DRIVES EVERYTHING: choosing a fight re-scopes every tile,
//     table and quality stat to that window, not just the chart;
//   · the chart is ROLLING DPS LINES (damage is a flow, not an instant):
//     light fills, shaded fight bands, marked peaks, and a CUMULATIVE
//     toggle — the "who was winning" curve;
//   · FIGHTS TABLE: per engagement — duration, dealt/taken, peak, main
//     target, hit rate, and YOUR ARMAMENT (weapon icons from your own
//     logged shots; the client never names your hull, so your guns are
//     the honest fingerprint of what you flew, and it is labeled as such);
//   · VOLLEY HISTOGRAM: your hit-size distribution (disintegrator spool
//     ramps are visible in it);
//   · NO EMOJI: typographic headers with color accents; the only images
//     are real EVE renders, icons and portraits.
//
// THE GAME IS NEVER TOUCHED: main opens read-only, reads, closes.
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  parseGameLogLine, engagements, miningStats,
  type GameLogEvent, type Engagement, type MiningStats,
} from '../lib/gamelogParse';
import { ensureDogma } from '../lib/dogmaStats';
import { useElementWidth } from '../lib/useElementWidth';
import { InfoDot } from './Help';
import { useAuth } from '../lib/auth';
import { characterKillMarks, type KillMark } from '../lib/killIntel';
import { shipSegmentsSync, primeShipHistory, type ShipSegment } from '../lib/shipHistory';
import { resolveCharIds, charAffiliation, likelyFit, slotOf, type CharAffiliation, type LikelyFit, type FitModule } from '../lib/entityIntel';
import { getSystem } from '../lib/mapdata';
import { logInfo } from '../lib/devlog';
import { fetchAggregates } from '../lib/market';
import { BUILTIN_HUBS } from '../lib/constants';
import { iskShort } from '../lib/format';
import { parseJournal, lastUndocks, computeUndockCuts, UNDOCK_KEY } from '../lib/undockJournal';
import { getType } from '../lib/typedb';

interface LogFileMeta {
  file: string;
  dateKey: string;
  charId: string | null;
  listener: string | null;
  sessionStart: string | null;
  mtimeMs: number;
  size: number;
}

const LIST_POLL_MS = 5000;
const LIVE_MS = 5 * 60_000;
const OUT_COLOR = '#4da3ff';
const IN_COLOR = '#ff5b5b';
const REP_COLOR = '#5fd08a';
// mining palette = the CLIENT'S OWN log colors (yield #8dc169 green, residue
// #ff454b red, crit #f0ff45 yellow — read from the markup in the log lines)
const MINE_COLOR = '#8dc169';
const RESIDUE_COLOR = '#ff5b60';
const CRIT_COLOR = '#e8e04a';
const ISK_COLOR = '#e6c35c';
const CARD: React.CSSProperties = {
  border: '1px solid var(--grid)', borderRadius: 8, padding: '12px 14px', minWidth: 0,
};

const fmtN = (n: number): string => Math.round(n).toLocaleString();
const hhmm = (t: number): string => new Date(t).toISOString().slice(11, 16);
const hhmmss = (t: number): string => new Date(t).toISOString().slice(11, 19);
const durLabel = (ms: number): string => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
};

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
let typeMapLoading = false;

function useTypeIcons(): number {
  const [rev, setRev] = useState(0);
  useEffect(() => {
    if (typeIdByName !== null || typeMapLoading) return;
    typeMapLoading = true;
    void ensureDogma().then((data) => {
      const m = new Map<string, { id: number; cat: number }>();
      const byId = new Map<number, string>();
      for (const [id, t] of Object.entries(data.types as Record<string, { name: string; categoryID: number; groupID?: number }>)) {
        if (t && (ICON_CATS.has(t.categoryID) || t.groupID === GAS_GROUP)) m.set(t.name, { id: Number(id), cat: t.categoryID });
        if (t) byId.set(Number(id), t.name);
      }
      typeIdByName = m;
      typeNameById = byId;
      setRev((r) => r + 1);
    }).catch(() => { typeMapLoading = false; });
  }, []);
  return rev;
}

function parseEntity(raw: string): { pilot: string; corp: string | null; ship: string } {
  const m = /^(.*?)\[(.*?)\]\((.*?)\)$/.exec(raw);
  if (m) return { pilot: m[1], corp: m[2], ship: m[3] };
  return { pilot: raw, corp: null, ship: raw };
}

function TypeIcon({ name, size = 32, title }: { name: string; size?: number; title?: string }) {
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

/** hull/type name from an id (ship history + killmails give ids) */
function typeName(id: number): string { return typeNameById?.get(id) ?? `#${id}`; }

/** icon straight from a type ID (killmails give ship type ids, not names) */
function TypeIconId({ id, size = 32 }: { id: number; size?: number }) {
  if (!id) return <span style={{ width: size, height: size, flex: 'none' }} />;
  return (
    <img src={`https://images.evetech.net/types/${id}/render?size=64`}
      width={size} height={size} alt=""
      style={{ borderRadius: 5, flex: 'none', background: 'rgba(128,128,128,.08)' }}
      onError={(e) => { (e.target as HTMLImageElement).style.visibility = 'hidden'; }} />
  );
}

// ---------------------------------------------------------------------------
// AGGREGATION (pure, over whatever window is selected)
// ---------------------------------------------------------------------------

interface EntityAgg { dmg: number; hits: number; max: number }
/** a weapon or attacker with application detail — powers the "always hits
 * vs rarely-but-big" profile and the incoming-quality read */
interface AppAgg {
  dmg: number; hits: number; misses: number; max: number;
  solid: number; // Wrecks+Smashes+Penetrates (a real hit)
  glance: number; // Grazes+Glances Off (barely connected)
}
interface WindowStats {
  t0: number; t1: number;
  outTotal: number; inTotal: number;
  peakOut10s: number; peakIn10s: number;
  missOut: number; hitsOut: number;
  neutOutGj: number; neutInGj: number; repInHp: number; repEvents: GameLogEvent[];
  byTarget: [string, AppAgg][];
  bySource: [string, EntityAgg][];
  byWeapon: [string, AppAgg][];
  byAttacker: [string, AppAgg][];
  byQuality: [string, number][];
  ewar: GameLogEvent[];
  volleys: number[];
  solidOut: number; glanceOut: number;
  mining: MiningStats;
  bountyIsk: number;
  jams: GameLogEvent[];
}

function windowStats(events: GameLogEvent[]): WindowStats | null {
  if (events.length === 0) return null;
  let t0 = Infinity; let t1 = -Infinity;
  let outTotal = 0; let inTotal = 0; let missOut = 0; let hitsOut = 0;
  let neutOutGj = 0; let neutInGj = 0; let repInHp = 0;
  let bountyIsk = 0;
  const jams: GameLogEvent[] = [];
  const byTarget = new Map<string, AppAgg>();
  const bySource = new Map<string, EntityAgg>();
  const byWeapon = new Map<string, AppAgg>();
  const byAttacker = new Map<string, AppAgg>();
  const byQuality = new Map<string, number>();
  let solidOut = 0; let glanceOut = 0;
  const SOLID = new Set(['Wrecks', 'Smashes', 'Penetrates']);
  const GLANCE = new Set(['Grazes', 'Glances Off']);
  const bumpApp = (m: Map<string, AppAgg>, k: string, amt: number, q: string | undefined, miss: boolean) => {
    const c = m.get(k) ?? { dmg: 0, hits: 0, misses: 0, max: 0, solid: 0, glance: 0 };
    if (miss) { c.misses += 1; } else {
      c.dmg += amt; c.hits += 1; if (amt > c.max) c.max = amt;
      if (q && SOLID.has(q)) c.solid += 1; else if (q && GLANCE.has(q)) c.glance += 1;
    }
    m.set(k, c);
  };
  const out10 = new Map<number, number>();
  const in10 = new Map<number, number>();
  const ewar: GameLogEvent[] = [];
  const repEvents: GameLogEvent[] = [];
  const volleys: number[] = [];
  const bump = (m: Map<string, EntityAgg>, k: string, amt: number) => {
    const c = m.get(k) ?? { dmg: 0, hits: 0, max: 0 };
    c.dmg += amt; c.hits += 1; if (amt > c.max) c.max = amt;
    m.set(k, c);
  };
  for (const e of events) {
    if (e.t < t0) t0 = e.t;
    if (e.t > t1) t1 = e.t;
    if (e.kind === 'dmgOut' && e.amount !== undefined) {
      outTotal += e.amount; hitsOut += 1; volleys.push(e.amount);
      if (e.entity) bumpApp(byTarget, e.entity, e.amount, e.quality, false);
      if (e.weapon) bumpApp(byWeapon, e.weapon, e.amount, e.quality, false);
      if (e.quality) {
        byQuality.set(e.quality, (byQuality.get(e.quality) ?? 0) + 1);
        if (SOLID.has(e.quality)) solidOut += 1; else if (GLANCE.has(e.quality)) glanceOut += 1;
      }
      const b = Math.floor(e.t / 10000);
      out10.set(b, (out10.get(b) ?? 0) + e.amount);
    } else if (e.kind === 'dmgIn' && e.amount !== undefined) {
      inTotal += e.amount;
      if (e.entity) { bump(bySource, e.entity, e.amount); bumpApp(byAttacker, e.entity, e.amount, e.quality, false); }
      const b = Math.floor(e.t / 10000);
      in10.set(b, (in10.get(b) ?? 0) + e.amount);
    } else if (e.kind === 'missOut') { missOut += 1; if (e.weapon) bumpApp(byWeapon, e.weapon, 0, undefined, true); if (e.entity) bumpApp(byTarget, e.entity, 0, undefined, true); }
    else if (e.kind === 'neutOut') neutOutGj += e.amount ?? 0;
    else if (e.kind === 'neutIn') neutInGj += e.amount ?? 0;
    else if (e.kind === 'repIn') { repInHp += e.amount ?? 0; repEvents.push(e); }
    else if (e.kind === 'ewar') ewar.push(e);
    else if (e.kind === 'jammed') jams.push(e);
    else if (e.kind === 'bounty') bountyIsk += e.isk ?? 0;
  }
  const top = (m: Map<string, EntityAgg>, n: number) =>
    [...m.entries()].sort((a, b) => b[1].dmg - a[1].dmg).slice(0, n);
  const topApp = (m: Map<string, AppAgg>, n: number) =>
    [...m.entries()].sort((a, b) => b[1].dmg - a[1].dmg).slice(0, n);
  return {
    t0, t1, outTotal, inTotal,
    peakOut10s: Math.max(0, ...out10.values()) / 10,
    peakIn10s: Math.max(0, ...in10.values()) / 10,
    missOut, hitsOut, neutOutGj, neutInGj, repInHp, repEvents,
    byTarget: topApp(byTarget, 10), bySource: top(bySource, 10),
    byWeapon: topApp(byWeapon, 10), byAttacker: topApp(byAttacker, 10),
    solidOut, glanceOut,
    byQuality: [...byQuality.entries()].sort((a, b) => b[1] - a[1]),
    ewar, volleys,
    mining: miningStats(events),
    bountyIsk, jams,
  };
}

/** the weapons YOU fired in a window — the honest fingerprint of what you
 * were flying (the client never names your own hull) */
function armamentIn(events: GameLogEvent[], t0: number, t1: number, n = 3): [string, number][] {
  const m = new Map<string, number>();
  for (const e of events) {
    if (e.kind !== 'dmgOut' || e.t < t0 || e.t > t1 || !e.weapon) continue;
    m.set(e.weapon, (m.get(e.weapon) ?? 0) + (e.amount ?? 0));
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n);
}

// ---------------------------------------------------------------------------
// PRESENTATION
// ---------------------------------------------------------------------------

// width via the shared three-path hook — ResizeObserver alone is not a
// reliable width source here (see lib/useElementWidth.ts)

function SectionHead({ accent, text, extra }: { accent: string; text: string; extra?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
      <span style={{ width: 10, height: 10, borderRadius: 2, background: accent, flex: 'none' }} />
      <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)' }}>
        {text}
      </span>
      {extra}
    </div>
  );
}

function Hero({ label, value, color, title }: {
  label: string; value: string; color?: string; title?: string;
}) {
  return (
    <div style={{ ...CARD, borderLeft: `3px solid ${color ?? 'var(--grid)'}` }} title={title}>
      <div style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--muted)', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 30, fontWeight: 800, lineHeight: 1.15, fontVariantNumeric: 'tabular-nums', color }}>
        {value}
      </div>
    </div>
  );
}

function Stat({ label, value, color, title }: {
  label: string; value: string; color?: string; title?: string;
}) {
  return (
    <div style={{ ...CARD, padding: '10px 12px' }} title={title}>
      <div style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', fontWeight: 600 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, marginTop: 2, fontVariantNumeric: 'tabular-nums', color }}>
        {value}
      </div>
    </div>
  );
}

/**
 * ROLLING DPS LINES — damage as the flow it is. Sampled on a fixed grid,
 * each sample = damage in the trailing window / window seconds. Fight
 * bands shade the background; peaks are marked; cumulative mode swaps in
 * running totals ("who was winning").
 */
function FlowChart({ events, logins, reships, kills, ships, fights, domain, width, cumulative }: {
  events: GameLogEvent[]; logins: number[]; reships: { t: number; text: string }[];
  kills: KillMark[]; ships: ShipSegment[];
  fights: Engagement[]; domain: [number, number]; width: number; cumulative: boolean;
}) {
  // the ship BAND sits in its own strip above the plot; the plot drops to
  // make room only when there is history to show
  const BAND_H = ships.length > 0 ? 22 : 0;
  const W = width; const H = 260 + BAND_H; const PAD_L = 56; const PAD_R = 10;
  const TOP = 16 + BAND_H; const BASE = H - 34;
  const [d0, d1] = domain;
  const span = Math.max(30_000, d1 - d0);
  const nS = Math.max(120, Math.min(360, Math.floor((W - PAD_L - PAD_R) / 3)));
  const stepMs = span / nS;
  const winMs = Math.max(10_000, stepMs * 3);
  const dmg = events
    .filter((e) => (e.kind === 'dmgOut' || e.kind === 'dmgIn') && e.amount !== undefined && e.t >= d0 - winMs && e.t <= d1)
    .sort((a, b) => a.t - b.t);
  const out = new Array<number>(nS + 1).fill(0);
  const inc = new Array<number>(nS + 1).fill(0);
  const cumOut = new Array<number>(nS + 1).fill(0);
  const cumIn = new Array<number>(nS + 1).fill(0);
  {
    let lo = 0; let hi = 0; let sumO = 0; let sumI = 0; let cO = 0; let cI = 0;
    for (let s = 0; s <= nS; s++) {
      const t = d0 + s * stepMs;
      while (hi < dmg.length && dmg[hi].t <= t) {
        if (dmg[hi].kind === 'dmgOut') { sumO += dmg[hi].amount!; cO += dmg[hi].amount!; }
        else { sumI += dmg[hi].amount!; cI += dmg[hi].amount!; }
        hi += 1;
      }
      while (lo < hi && dmg[lo].t < t - winMs) {
        if (dmg[lo].kind === 'dmgOut') sumO -= dmg[lo].amount!;
        else sumI -= dmg[lo].amount!;
        lo += 1;
      }
      out[s] = sumO / (winMs / 1000);
      inc[s] = sumI / (winMs / 1000);
      cumOut[s] = cO;
      cumIn[s] = cI;
    }
  }
  const A = cumulative ? cumOut : out;
  const B = cumulative ? cumIn : inc;
  const yMax = Math.max(10, ...A, ...B);
  const xOf = (s: number) => PAD_L + (s / nS) * (W - PAD_L - PAD_R);
  const xOfT = (t: number) => PAD_L + ((t - d0) / span) * (W - PAD_L - PAD_R);
  const yOf = (v: number) => BASE - (v / yMax) * (BASE - TOP);
  const lineOf = (arr: number[]) => arr.map((v, s) => `${s === 0 ? 'M' : 'L'}${xOf(s).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const fillOf = (arr: number[]) => `${lineOf(arr)} L${xOf(nS).toFixed(1)},${BASE} L${PAD_L},${BASE} Z`;
  const argmax = (arr: number[]) => arr.reduce((bi, v, i) => (v > arr[bi] ? i : bi), 0);
  const pO = argmax(A); const pI = argmax(B);
  const yLabel = (v: number) => (cumulative ? fmtN(v) : `${fmtN(v)}/s`);
  return (
    <svg width={W} height={H} role="img" aria-label={cumulative ? 'cumulative damage over time' : 'damage per second over time'}>
      {ships.map((seg, i) => {
        const x0 = Math.max(PAD_L, xOfT(seg.t0));
        const x1 = Math.min(W - PAD_R, xOfT(Math.min(seg.t1, d1)));
        const w = Math.max(2, x1 - x0);
        const hull = typeName(seg.shipTypeId);
        const label = (seg.shipName && seg.shipName !== hull) ? `${hull} · ${seg.shipName}` : hull;
        const sys = getSystem(seg.systemId)?.name;
        return (
          <g key={`sb${i}`}>
            <rect x={x0} y={2} width={w} height={BAND_H - 4} rx={3}
              fill="#6ea8ff" fillOpacity={0.18} stroke="#6ea8ff" strokeOpacity={0.5} strokeWidth="1" />
            {w > 46 && (
              <text x={x0 + 5} y={BAND_H - 6} className="sim-tick"
                style={{ fontSize: 11, fill: '#bcd4ff' }}>
                {w > 130 ? label : hull}{sys && w > 200 ? ` — ${sys}` : ''}
              </text>
            )}
            <title>{`${label}${sys ? ` in ${sys}` : ''} · ${hhmm(seg.t0)}${seg.t1 === Infinity ? ' → now' : `–${hhmm(seg.t1)}`}`}</title>
          </g>
        );
      })}
      {fights.map((f, i) => (f.t1 >= d0 && f.t0 <= d1
        ? <rect key={`f${i}`} x={Math.max(PAD_L, xOfT(f.t0))} y={TOP}
            width={Math.max(2, Math.min(W - PAD_R, xOfT(f.t1)) - Math.max(PAD_L, xOfT(f.t0)))}
            height={BASE - TOP} fill="rgba(140,160,200,0.06)">
            <title>{`fight ${hhmmss(f.t0)}–${hhmmss(f.t1)}`}</title>
          </rect>
        : null))}
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <g key={f}>
          <line x1={PAD_L} x2={W - PAD_R} y1={yOf(yMax * f)} y2={yOf(yMax * f)}
            stroke="var(--grid)" strokeWidth="1" opacity={f === 1 ? 0.7 : 0.35} />
          <text x={PAD_L - 7} y={yOf(yMax * f) + 4} textAnchor="end" className="sim-tick" style={{ fontSize: 11 }}>
            {yLabel(yMax * f)}
          </text>
        </g>
      ))}
      <line x1={PAD_L} x2={W - PAD_R} y1={BASE} y2={BASE} stroke="var(--grid)" strokeWidth="1.2" />
      <path d={fillOf(B)} fill={IN_COLOR} opacity="0.14" />
      <path d={fillOf(A)} fill={OUT_COLOR} opacity="0.14" />
      <path d={lineOf(B)} fill="none" stroke={IN_COLOR} strokeWidth="1.6" opacity="0.95" strokeLinejoin="round" />
      <path d={lineOf(A)} fill="none" stroke={OUT_COLOR} strokeWidth="1.6" opacity="0.95" strokeLinejoin="round" />
      {logins.map((t, i) => (t >= d0 && t <= d1
        ? <line key={`l${i}`} x1={xOfT(t)} x2={xOfT(t)} y1={TOP} y2={BASE}
            stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5">
            <title>{`session login ${hhmmss(t)} EVE`}</title>
          </line>
        : null))}
      {reships.map((r, i) => (r.t >= d0 && r.t <= d1
        ? <g key={`r${i}`}>
            <line x1={xOfT(r.t)} x2={xOfT(r.t)} y1={TOP} y2={BASE}
              stroke="#ffb347" strokeWidth="1.4" strokeDasharray="2 3" opacity="0.85">
              <title>{`${r.text} · ${hhmmss(r.t)} EVE`}</title>
            </line>
            <polygon points={`${xOfT(r.t) - 4},${TOP} ${xOfT(r.t) + 4},${TOP} ${xOfT(r.t)},${TOP + 6}`}
              fill="#ffb347">
              <title>{`${r.text} · ${hhmmss(r.t)} EVE`}</title>
            </polygon>
          </g>
        : null))}
      {kills.map((k, i) => (k.t >= d0 && k.t <= d1
        ? <g key={`k${i}`} style={{ cursor: 'default' }}>
            <line x1={xOfT(k.t)} x2={xOfT(k.t)} y1={TOP} y2={BASE}
              stroke={k.kind === 'loss' ? IN_COLOR : '#5fd08a'} strokeWidth="1"
              opacity={k.kind === 'loss' ? 0.7 : 0.4} />
            <text x={xOfT(k.t)} y={k.kind === 'loss' ? BASE - 2 : TOP + 9} textAnchor="middle"
              style={{ fontSize: 12, fill: k.kind === 'loss' ? IN_COLOR : '#5fd08a' }}>
              {k.kind === 'loss' ? '☠' : '⚔'}
              <title>{`${k.kind === 'loss' ? 'LOSS' : 'kill' + (k.finalBlow ? ' (final blow)' : '')} · ${hhmmss(k.t)} EVE · ${fmtN(k.value)} ISK`}</title>
            </text>
          </g>
        : null))}
      {!cumulative && A[pO] > 0 && (
        <g>
          <circle cx={xOf(pO)} cy={yOf(A[pO])} r="3.5" fill={OUT_COLOR} />
          <text x={Math.min(xOf(pO) + 6, W - 90)} y={Math.max(TOP + 10, yOf(A[pO]) - 6)}
            className="sim-tick" style={{ fontSize: 11, fill: OUT_COLOR }}>
            peak {fmtN(A[pO])}/s
          </text>
        </g>
      )}
      {!cumulative && B[pI] > 0 && (
        <g>
          <circle cx={xOf(pI)} cy={yOf(B[pI])} r="3.5" fill={IN_COLOR} />
          <text x={Math.min(xOf(pI) + 6, W - 90)} y={Math.min(BASE - 4, yOf(B[pI]) + 14)}
            className="sim-tick" style={{ fontSize: 11, fill: IN_COLOR }}>
            peak {fmtN(B[pI])}/s
          </text>
        </g>
      )}
      {/* hover columns with exact values */}
      {A.map((v, s) => ((v > 0 || B[s] > 0)
        ? <rect key={`h${s}`} x={xOf(s) - (W - PAD_L - PAD_R) / nS / 2} y={TOP}
            width={(W - PAD_L - PAD_R) / nS} height={BASE - TOP} fill="transparent">
            <title>{`${hhmmss(d0 + s * stepMs)} — ${cumulative
              ? `dealt ${fmtN(v)} · taken ${fmtN(B[s])}`
              : `out ${fmtN(v)}/s · in ${fmtN(B[s])}/s (${Math.round(winMs / 1000)}s window)`}`}</title>
          </rect>
        : null))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={PAD_L + f * (W - PAD_L - PAD_R)} y={H - 12}
          textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}
          className="sim-tick" style={{ fontSize: 11.5 }}>
          {hhmm(d0 + f * span)}
        </text>
      ))}
    </svg>
  );
}

function EntityRow({ name, agg, max, color, onOpen }: {
  name: string; agg: EntityAgg; max: number; color: string; onOpen?: (raw: string) => void;
}) {
  const ent = parseEntity(name);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8, cursor: onOpen ? 'pointer' : 'default' }}
      onClick={() => onOpen?.(name)}
      title={`${name} — ${fmtN(agg.dmg)} damage · ${agg.hits} hits · best volley ${fmtN(agg.max)} · click for pilot detail & likely fit`}>
      <TypeIcon name={ent.ship} size={34} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 14, lineHeight: 1.3 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}>
            {ent.pilot}
          </span>
          <b style={{ flex: 'none', fontVariantNumeric: 'tabular-nums', fontSize: 14.5 }}>{fmtN(agg.dmg)}</b>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ent.corp !== null ? `${ent.corp} · ` : ''}{ent.ship !== ent.pilot ? ent.ship : ''}
          </span>
          <span style={{ flex: 'none' }}>{agg.hits} hits · max {fmtN(agg.max)}</span>
        </div>
        <div style={{ height: 4, borderRadius: 2, background: 'rgba(128,128,128,.16)', marginTop: 3 }}>
          <div style={{ height: '100%', width: `${(agg.dmg / max) * 100}%`, borderRadius: 2, background: color, opacity: 0.9 }} />
        </div>
      </div>
    </div>
  );
}

const QUALITY_COLORS: Record<string, string> = {
  Wrecks: '#ff9d42', Smashes: '#e06bff', Penetrates: '#b48cff',
  Hits: '#8f9dff', Grazes: '#6fbf9f', 'Glances Off': '#6a7683', Missed: '#555b63',
};

function QualityBar({ rows, misses }: { rows: [string, number][]; misses: number }) {
  const total = rows.reduce((n, [, v]) => n + v, 0) + misses;
  if (total === 0) return <div className="dim">no volleys</div>;
  const parts = misses > 0 ? [...rows, ['Missed', misses] as [string, number]] : rows;
  return (
    <div>
      <div style={{ display: 'flex', height: 18, borderRadius: 5, overflow: 'hidden' }}>
        {parts.map(([q, v]) => (
          <div key={q} title={`${q}: ${v} (${Math.round((v / total) * 100)}%)`}
            style={{ width: `${(v / total) * 100}%`, background: QUALITY_COLORS[q] ?? '#555' }} />
        ))}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 8, fontSize: 12.5 }}>
        {parts.map(([q, v]) => (
          <span key={q} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: QUALITY_COLORS[q] ?? '#555' }} />
            {q} <b>{v}</b> <span className="dim">({Math.round((v / total) * 100)}%)</span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** distribution of your volley sizes — spool ramps and wrecking shots
 * separate into visible bands. Horizontal bars: bins are categories. */
function VolleyHistogram({ volleys }: { volleys: number[] }) {
  if (volleys.length === 0) return <div className="dim">no volleys</div>;
  const max = Math.max(...volleys);
  const BINS = 10;
  const step = Math.max(1, Math.ceil(max / BINS / 10) * 10);
  const counts = new Array<number>(BINS).fill(0);
  for (const v of volleys) counts[Math.min(BINS - 1, Math.floor(v / step))] += 1;
  const cMax = Math.max(...counts);
  return (
    <div>
      {counts.map((c, i) => (c > 0 || (i > 0 && counts[i - 1] > 0)
        ? <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
            <span className="dim" style={{ flex: 'none', width: 108, fontSize: 12, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {fmtN(i * step)}–{fmtN((i + 1) * step)}
            </span>
            <div style={{ flex: 1, height: 13, borderRadius: 3, background: 'rgba(128,128,128,.1)' }}>
              <div style={{ height: '100%', width: `${(c / cMax) * 100}%`, borderRadius: 3, background: OUT_COLOR, opacity: 0.8 }} />
            </div>
            <b style={{ flex: 'none', width: 44, fontSize: 12.5, fontVariantNumeric: 'tabular-nums' }}>{c}</b>
          </div>
        : null))}
      <div className="dim" style={{ fontSize: 12, marginTop: 6 }}>
        volley size distribution — a disintegrator's spool shows as a climb
        into the top bins; artillery shows Wrecks as a separate high band
      </div>
    </div>
  );
}

/**
 * CAP PRESSURE over time — the game log never records your own capacitor
 * level (an HONEST LIMIT), but it logs every neut/nos event, and cap
 * pressure is exactly what those are. GJ drained per rolling window,
 * yours-out above the baseline and enemy-in below it.
 */
function CapChart({ events, domain, width }: {
  events: GameLogEvent[]; domain: [number, number]; width: number;
}) {
  const W = width; const H = 200; const PAD_L = 56; const PAD_R = 10; const MID = H / 2 - 6; const AMP = MID - 20;
  const [d0, d1] = domain;
  const span = Math.max(30_000, d1 - d0);
  const nS = Math.max(80, Math.min(300, Math.floor((W - PAD_L - PAD_R) / 4)));
  const stepMs = span / nS;
  const winMs = Math.max(10_000, stepMs * 3);
  const neut = events
    .filter((e) => (e.kind === 'neutOut' || e.kind === 'neutIn') && e.t >= d0 - winMs && e.t <= d1)
    .sort((a, b) => a.t - b.t);
  const out = new Array<number>(nS + 1).fill(0);
  const inc = new Array<number>(nS + 1).fill(0);
  { let lo = 0; let hi = 0; let sO = 0; let sI = 0;
    for (let sIdx = 0; sIdx <= nS; sIdx++) {
      const t = d0 + sIdx * stepMs;
      while (hi < neut.length && neut[hi].t <= t) { if (neut[hi].kind === 'neutOut') sO += neut[hi].amount ?? 0; else sI += neut[hi].amount ?? 0; hi += 1; }
      while (lo < hi && neut[lo].t < t - winMs) { if (neut[lo].kind === 'neutOut') sO -= neut[lo].amount ?? 0; else sI -= neut[lo].amount ?? 0; lo += 1; }
      out[sIdx] = sO / (winMs / 1000); inc[sIdx] = sI / (winMs / 1000);
    } }
  const yMax = Math.max(1, ...out, ...inc);
  const xOf = (sIdx: number) => PAD_L + (sIdx / nS) * (W - PAD_L - PAD_R);
  const upOf = (v: number) => MID - (v / yMax) * AMP;
  const dnOf = (v: number) => MID + (v / yMax) * AMP;
  const fillUp = `M${PAD_L},${MID} ${out.map((v, i) => `L${xOf(i).toFixed(1)},${upOf(v).toFixed(1)}`).join(' ')} L${xOf(nS).toFixed(1)},${MID} Z`;
  const fillDn = `M${PAD_L},${MID} ${inc.map((v, i) => `L${xOf(i).toFixed(1)},${dnOf(v).toFixed(1)}`).join(' ')} L${xOf(nS).toFixed(1)},${MID} Z`;
  const hasAny = yMax > 1;
  return (
    <svg width={W} height={H} role="img" aria-label="cap pressure over time">
      <line x1={PAD_L} x2={W - PAD_R} y1={MID} y2={MID} stroke="var(--grid)" strokeWidth="1.2" />
      <text x={PAD_L - 7} y={upOf(yMax) + 4} textAnchor="end" className="sim-tick" style={{ fontSize: 11 }}>{fmtN(yMax)}/s</text>
      <text x={PAD_L - 7} y={dnOf(yMax) + 4} textAnchor="end" className="sim-tick" style={{ fontSize: 11 }}>{fmtN(yMax)}/s</text>
      <path d={fillUp} fill={OUT_COLOR} opacity="0.5" stroke={OUT_COLOR} strokeWidth="1.2" strokeOpacity="0.9" />
      <path d={fillDn} fill={IN_COLOR} opacity="0.5" stroke={IN_COLOR} strokeWidth="1.2" strokeOpacity="0.9" />
      {out.map((v, i) => ((v > 0 || inc[i] > 0)
        ? <rect key={i} x={xOf(i) - (W - PAD_L - PAD_R) / nS / 2} y={16} width={(W - PAD_L - PAD_R) / nS} height={H - 44} fill="transparent">
            <title>{`${hhmmss(d0 + i * stepMs)} — you drained ${fmtN(v)} GJ/s · drained from you ${fmtN(inc[i])} GJ/s`}</title>
          </rect> : null))}
      {[0, 0.5, 1].map((f) => (
        <text key={f} x={PAD_L + f * (W - PAD_L - PAD_R)} y={H - 6} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="sim-tick" style={{ fontSize: 11 }}>{hhmm(d0 + f * span)}</text>
      ))}
      {!hasAny && <text x={W / 2} y={MID - 6} textAnchor="middle" className="dim" style={{ fontSize: 13 }}>no energy-warfare events in this scope</text>}
      <text x={W - PAD_R} y={14} textAnchor="end" className="sim-tick" style={{ fontSize: 11, fill: OUT_COLOR }}>▲ you drained</text>
      <text x={W - PAD_R} y={H - 20} textAnchor="end" className="sim-tick" style={{ fontSize: 11, fill: IN_COLOR }}>▼ drained from you</text>
    </svg>
  );
}

/**
 * MINING TIMELINE — the same rolling-rate treatment the combat chart gets:
 * yield climbs ABOVE the baseline (crit share stacked in the client's crit
 * yellow), residue mirrors BELOW it in the client's residue red, and every
 * critical success is a marked tick along the top. Units/min, hover for
 * exact numbers.
 */
/** map a click on a chart to the time it points at (shared by the mining
 * timelines for the custom-range picker) */
function svgClickTime(
  e: React.MouseEvent<SVGSVGElement>, d0: number, d1: number, padL: number, padR: number, w: number,
): number {
  const r = e.currentTarget.getBoundingClientRect();
  // the svg can render narrower than its layout box — scale by actual width
  const x = ((e.clientX - r.left) / r.width) * w;
  const t = d0 + ((x - padL) / Math.max(1, w - padL - padR)) * (d1 - d0);
  return Math.max(d0, Math.min(d1, t));
}

function MiningChart({ events, logins, domain, width, onPickTime, picking }: {
  events: GameLogEvent[]; logins: number[]; domain: [number, number]; width: number;
  onPickTime?: (t: number) => void; picking?: boolean;
}) {
  const W = width; const H = 250; const PAD_L = 66; const PAD_R = 10;
  const MID = Math.round(H * 0.58); const TOP = 22; const BOT = H - 26;
  const [d0, d1] = domain;
  const span = Math.max(60_000, d1 - d0);
  const nS = Math.max(80, Math.min(300, Math.floor((W - PAD_L - PAD_R) / 4)));
  const stepMs = span / nS;
  const winMs = Math.max(60_000, stepMs * 3);
  const evs = events
    .filter((e) => (e.kind === 'mine' || e.kind === 'mineCrit' || e.kind === 'residue')
      && e.amount !== undefined && e.t >= d0 - winMs && e.t <= d1)
    .sort((a, b) => a.t - b.t);
  const norm = new Array<number>(nS + 1).fill(0);
  const crit = new Array<number>(nS + 1).fill(0);
  const resid = new Array<number>(nS + 1).fill(0);
  {
    let lo = 0; let hi = 0; let sN = 0; let sC = 0; let sR = 0;
    const add = (e: GameLogEvent, sign: 1 | -1) => {
      const a = (e.amount ?? 0) * sign;
      if (e.kind === 'mine') sN += a; else if (e.kind === 'mineCrit') sC += a; else sR += a;
    };
    for (let s = 0; s <= nS; s++) {
      const t = d0 + s * stepMs;
      while (hi < evs.length && evs[hi].t <= t) { add(evs[hi], 1); hi += 1; }
      while (lo < hi && evs[lo].t < t - winMs) { add(evs[lo], -1); lo += 1; }
      const perMin = winMs / 60_000;
      norm[s] = sN / perMin; crit[s] = sC / perMin; resid[s] = sR / perMin;
    }
  }
  const upMax = Math.max(10, ...norm.map((v, i) => v + crit[i]));
  const dnMax = Math.max(10, ...resid);
  const xOf = (s: number) => PAD_L + (s / nS) * (W - PAD_L - PAD_R);
  const xOfT = (t: number) => PAD_L + ((t - d0) / span) * (W - PAD_L - PAD_R);
  const upOf = (v: number) => MID - (v / upMax) * (MID - TOP);
  const dnOf = (v: number) => MID + (v / dnMax) * (BOT - MID);
  const line = (f: (s: number) => number) =>
    Array.from({ length: nS + 1 }, (_, s) => `${s === 0 ? 'M' : 'L'}${xOf(s).toFixed(1)},${f(s).toFixed(1)}`).join(' ');
  const totalUp = (s: number) => upOf(norm[s] + crit[s]);
  const fillTotal = `${line(totalUp)} L${xOf(nS).toFixed(1)},${MID} L${PAD_L},${MID} Z`;
  // the crit band: between the normal-only curve and the total curve
  const critBand = `${line(totalUp)} ${Array.from({ length: nS + 1 }, (_, i) => nS - i)
    .map((s) => `L${xOf(s).toFixed(1)},${upOf(norm[s]).toFixed(1)}`).join(' ')} Z`;
  const fillDn = `${line((s) => dnOf(resid[s]))} L${xOf(nS).toFixed(1)},${MID} L${PAD_L},${MID} Z`;
  const crits = events.filter((e) => e.kind === 'mineCrit' && e.t >= d0 && e.t <= d1);
  const hasAny = evs.length > 0;
  const pk = norm.reduce((bi, v, i) => (v + crit[i] > norm[bi] + crit[bi] ? i : bi), 0);
  return (
    <svg width={W} height={H} role="img" aria-label="mining yield and residue over time"
      style={picking ? { cursor: 'crosshair' } : undefined}
      onClick={(e) => onPickTime?.(svgClickTime(e, d0, d1, PAD_L, PAD_R, W))}>
      {[0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD_L} x2={W - PAD_R} y1={upOf(upMax * f)} y2={upOf(upMax * f)} stroke="var(--grid)" strokeWidth="1" opacity="0.3" />
          <text x={PAD_L - 7} y={upOf(upMax * f) + 4} textAnchor="end" className="sim-tick" style={{ fontSize: 11 }}>{fmtN(upMax * f)}/min</text>
        </g>
      ))}
      <text x={PAD_L - 7} y={dnOf(dnMax) + 4} textAnchor="end" className="sim-tick" style={{ fontSize: 11, fill: RESIDUE_COLOR }}>{fmtN(dnMax)}/min</text>
      <line x1={PAD_L} x2={W - PAD_R} y1={MID} y2={MID} stroke="var(--grid)" strokeWidth="1.2" />
      <path d={fillDn} fill={RESIDUE_COLOR} opacity="0.28" stroke={RESIDUE_COLOR} strokeWidth="1.2" strokeOpacity="0.85" />
      <path d={fillTotal} fill={MINE_COLOR} opacity="0.22" />
      <path d={critBand} fill={CRIT_COLOR} opacity="0.5" />
      <path d={line(totalUp)} fill="none" stroke={MINE_COLOR} strokeWidth="1.7" opacity="0.95" strokeLinejoin="round" />
      {logins.map((t, i) => (t >= d0 && t <= d1
        ? <line key={`l${i}`} x1={xOfT(t)} x2={xOfT(t)} y1={TOP} y2={BOT}
            stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5">
            <title>{`session login ${hhmmss(t)} EVE`}</title>
          </line>
        : null))}
      {crits.map((e, i) => (
        <polygon key={`c${i}`} points={`${xOfT(e.t) - 4},${TOP - 10} ${xOfT(e.t) + 4},${TOP - 10} ${xOfT(e.t)},${TOP - 3}`}
          fill={CRIT_COLOR} opacity="0.9">
          <title>{`critical success · +${fmtN(e.amount ?? 0)} ${e.ore ?? ''} · ${hhmmss(e.t)} EVE`}</title>
        </polygon>
      ))}
      {!hasAny && <text x={W / 2} y={MID - 8} textAnchor="middle" className="dim" style={{ fontSize: 13 }}>no mining events in this scope</text>}
      {hasAny && norm[pk] + crit[pk] > 0 && (
        <g>
          <circle cx={xOf(pk)} cy={totalUp(pk)} r="3.5" fill={MINE_COLOR} />
          <text x={Math.min(xOf(pk) + 6, W - 110)} y={Math.max(TOP + 10, totalUp(pk) - 6)} className="sim-tick" style={{ fontSize: 11, fill: MINE_COLOR }}>
            peak {fmtN(norm[pk] + crit[pk])}/min
          </text>
        </g>
      )}
      {norm.map((v, s) => ((v > 0 || crit[s] > 0 || resid[s] > 0)
        ? <rect key={`h${s}`} x={xOf(s) - (W - PAD_L - PAD_R) / nS / 2} y={TOP} width={(W - PAD_L - PAD_R) / nS} height={BOT - TOP} fill="transparent">
            <title>{`${hhmmss(d0 + s * stepMs)} — mined ${fmtN(v + crit[s])}/min (${fmtN(crit[s])} from crits) · residue ${fmtN(resid[s])}/min (${Math.round(winMs / 1000)}s window)`}</title>
          </rect>
        : null))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={PAD_L + f * (W - PAD_L - PAD_R)} y={H - 8}
          textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="sim-tick" style={{ fontSize: 11.5 }}>
          {hhmm(d0 + f * span)}
        </text>
      ))}
      <text x={W - PAD_R} y={TOP + 10} textAnchor="end" className="sim-tick" style={{ fontSize: 11, fill: MINE_COLOR }}>▲ mined</text>
      <text x={W - PAD_R} y={BOT - 6} textAnchor="end" className="sim-tick" style={{ fontSize: 11, fill: RESIDUE_COLOR }}>▼ residue</text>
    </svg>
  );
}

/**
 * ONE-SERIES RATE TIMELINE — same rolling-window treatment as the mining
 * chart, for a derived per-event value (ISK, m³). One measure per chart,
 * never a second axis.
 */
function RateChart({ events, logins, domain, width, valueOf, color, fmtY, ariaLabel, onPickTime, picking }: {
  events: GameLogEvent[]; logins: number[]; domain: [number, number]; width: number;
  valueOf: (e: GameLogEvent) => number; color: string;
  fmtY: (v: number) => string; ariaLabel: string;
  onPickTime?: (t: number) => void; picking?: boolean;
}) {
  const W = width; const H = 170; const PAD_L = 66; const PAD_R = 10; const TOP = 14; const BASE = H - 24;
  const [d0, d1] = domain;
  const span = Math.max(60_000, d1 - d0);
  const nS = Math.max(80, Math.min(300, Math.floor((W - PAD_L - PAD_R) / 4)));
  const stepMs = span / nS;
  const winMs = Math.max(60_000, stepMs * 3);
  const evs = events
    .filter((e) => (e.kind === 'mine' || e.kind === 'mineCrit') && e.amount !== undefined && e.t >= d0 - winMs && e.t <= d1)
    .sort((a, b) => a.t - b.t);
  const rate = new Array<number>(nS + 1).fill(0);
  {
    let lo = 0; let hi = 0; let sum = 0;
    for (let s = 0; s <= nS; s++) {
      const t = d0 + s * stepMs;
      while (hi < evs.length && evs[hi].t <= t) { sum += valueOf(evs[hi]); hi += 1; }
      while (lo < hi && evs[lo].t < t - winMs) { sum -= valueOf(evs[lo]); lo += 1; }
      rate[s] = sum / (winMs / 60_000);
    }
  }
  const yMax = Math.max(1e-9, ...rate);
  const xOf = (s: number) => PAD_L + (s / nS) * (W - PAD_L - PAD_R);
  const xOfT = (t: number) => PAD_L + ((t - d0) / span) * (W - PAD_L - PAD_R);
  const yOf = (v: number) => BASE - (v / yMax) * (BASE - TOP);
  const line = rate.map((v, s) => `${s === 0 ? 'M' : 'L'}${xOf(s).toFixed(1)},${yOf(v).toFixed(1)}`).join(' ');
  const fill = `${line} L${xOf(nS).toFixed(1)},${BASE} L${PAD_L},${BASE} Z`;
  const pk = rate.reduce((bi, v, i) => (v > rate[bi] ? i : bi), 0);
  const hasAny = evs.length > 0 && yMax > 1e-9;
  return (
    <svg width={W} height={H} role="img" aria-label={ariaLabel}
      style={picking ? { cursor: 'crosshair' } : undefined}
      onClick={(e) => onPickTime?.(svgClickTime(e, d0, d1, PAD_L, PAD_R, W))}>
      {[0.5, 1].map((f) => (
        <g key={f}>
          <line x1={PAD_L} x2={W - PAD_R} y1={yOf(yMax * f)} y2={yOf(yMax * f)} stroke="var(--grid)" strokeWidth="1" opacity="0.3" />
          <text x={PAD_L - 7} y={yOf(yMax * f) + 4} textAnchor="end" className="sim-tick" style={{ fontSize: 11 }}>{fmtY(yMax * f)}</text>
        </g>
      ))}
      <line x1={PAD_L} x2={W - PAD_R} y1={BASE} y2={BASE} stroke="var(--grid)" strokeWidth="1.2" />
      <path d={fill} fill={color} opacity="0.18" />
      <path d={line} fill="none" stroke={color} strokeWidth="1.6" opacity="0.95" strokeLinejoin="round" />
      {logins.map((t, i) => (t >= d0 && t <= d1
        ? <line key={`l${i}`} x1={xOfT(t)} x2={xOfT(t)} y1={TOP} y2={BASE}
            stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 4" opacity="0.5">
            <title>{`session login ${hhmmss(t)} EVE`}</title>
          </line>
        : null))}
      {!hasAny && <text x={W / 2} y={(TOP + BASE) / 2} textAnchor="middle" className="dim" style={{ fontSize: 12.5 }}>nothing in this scope</text>}
      {hasAny && rate[pk] > 0 && (
        <g>
          <circle cx={xOf(pk)} cy={yOf(rate[pk])} r="3.5" fill={color} />
          <text x={Math.min(xOf(pk) + 6, W - 110)} y={Math.max(TOP + 10, yOf(rate[pk]) - 6)} className="sim-tick" style={{ fontSize: 11, fill: color }}>
            peak {fmtY(rate[pk])}
          </text>
        </g>
      )}
      {rate.map((v, s) => (v > 0
        ? <rect key={`h${s}`} x={xOf(s) - (W - PAD_L - PAD_R) / nS / 2} y={TOP} width={(W - PAD_L - PAD_R) / nS} height={BASE - TOP} fill="transparent">
            <title>{`${hhmmss(d0 + s * stepMs)} — ${fmtY(v)} (${Math.round(winMs / 1000)}s window)`}</title>
          </rect>
        : null))}
      {[0, 0.25, 0.5, 0.75, 1].map((f) => (
        <text key={f} x={PAD_L + f * (W - PAD_L - PAD_R)} y={H - 8}
          textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="sim-tick" style={{ fontSize: 11.5 }}>
          {hhmm(d0 + f * span)}
        </text>
      ))}
    </svg>
  );
}

const FEED_TAG: Record<GameLogEvent['kind'], { tag: string; cls: string }> = {
  dmgOut: { tag: '→', cls: 'pos' }, dmgIn: { tag: '←', cls: 'neg' },
  missOut: { tag: '∅', cls: 'dim' }, missIn: { tag: '∅', cls: 'dim' },
  neutOut: { tag: '▽', cls: 'pos' }, neutIn: { tag: '▽', cls: 'neg' },
  repIn: { tag: '+', cls: 'pos' }, repOut: { tag: '+', cls: 'dim' },
  ewar: { tag: 'EW', cls: 'flag warn' }, jammed: { tag: 'J', cls: 'flag warn' },
  mine: { tag: 'M', cls: 'pos' }, mineCrit: { tag: 'M✦', cls: 'flag good' },
  residue: { tag: 'R', cls: 'neg' }, bounty: { tag: 'ISK', cls: 'pos' },
  reship: { tag: 'SHIP', cls: 'flag info' }, other: { tag: '·', cls: 'dim' },
};

// ---------------------------------------------------------------------------
// ENTITY PANEL — click any pilot/ship to open. Pulls together the log
// exchange, the kills/losses you shared, and a zKill-inferred likely fit.
// ---------------------------------------------------------------------------

const SLOT_LABEL: Record<'high' | 'mid' | 'low' | 'rig', string> = {
  high: 'high slots', mid: 'mid slots', low: 'low slots', rig: 'rigs',
};

function ExchangeCol({ title, agg, color }: { title: string; agg?: AppAgg; color: string }) {
  if (!agg) return (
    <div style={{ flex: 1, minWidth: 140 }}>
      <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>{title}</div>
      <div className="dim" style={{ fontSize: 13 }}>nothing recorded</div>
    </div>
  );
  const lands = agg.hits + agg.misses > 0 ? Math.round((agg.hits / (agg.hits + agg.misses)) * 100) : 100;
  const solid = agg.hits > 0 ? Math.round((agg.solid / agg.hits) * 100) : 0;
  return (
    <div style={{ flex: 1, minWidth: 140 }}>
      <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>{title}</div>
      <div style={{ fontSize: 22, fontWeight: 800, color, fontVariantNumeric: 'tabular-nums' }}>{fmtN(agg.dmg)}</div>
      <div className="dim" style={{ fontSize: 12.5, lineHeight: 1.6 }}>
        {agg.hits} hits · max {fmtN(agg.max)}<br />
        {lands}% land · {solid}% solid
      </div>
    </div>
  );
}

function EntityPanel({ raw, stats, killMarks, onClose }: {
  raw: string; stats: WindowStats; killMarks: KillMark[]; onClose: () => void;
}) {
  const ent = parseEntity(raw);
  const [charId, setCharId] = useState<number | null>(null);
  const [aff, setAff] = useState<CharAffiliation | null>(null);
  const [fit, setFit] = useState<LikelyFit | null>(null);
  const [fitState, setFitState] = useState<'idle' | 'loading' | 'done' | 'none'>('idle');

  useEffect(() => {
    let alive = true;
    setCharId(null); setAff(null); setFit(null); setFitState('idle');
    void resolveCharIds([ent.pilot]).then((m) => {
      const id = m.get(ent.pilot);
      if (!alive || !id) return;
      setCharId(id);
      void charAffiliation(id).then((a) => { if (alive) setAff(a); });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [raw]);

  const iDealt = stats.byTarget.find(([n]) => n === raw)?.[1]
    ?? stats.byTarget.find(([n]) => parseEntity(n).pilot === ent.pilot)?.[1];
  const theyDealt = stats.byAttacker.find(([n]) => n === raw)?.[1]
    ?? stats.byAttacker.find(([n]) => parseEntity(n).pilot === ent.pilot)?.[1];
  const shared = killMarks.filter((k) => k.victimName && k.victimName === ent.pilot);
  const shipId = typeIdByName?.get(ent.ship)?.id ?? 0;

  const loadFit = () => {
    if (charId == null || fitState !== 'idle') return;
    setFitState('loading');
    void likelyFit(charId, shipId || undefined).then((f) => {
      setFit(f); setFitState(f ? 'done' : 'none');
    });
  };

  const groups: Record<'high' | 'mid' | 'low' | 'rig', FitModule[]> = { high: [], mid: [], low: [], rig: [] };
  if (fit) for (const m of fit.modules) { const sl = slotOf(m.flag); if (sl !== 'other') groups[sl].push(m); }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal modal-wide" style={{ maxWidth: 720, maxHeight: '86vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          {charId != null
            ? <img src={`https://images.evetech.net/characters/${charId}/portrait?size=128`} width={64} height={64} alt="" style={{ borderRadius: 8 }} />
            : <span style={{ width: 64, height: 64, borderRadius: 8, background: 'rgba(128,128,128,.12)', flex: 'none' }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 19, fontWeight: 800 }}>{ent.pilot}</div>
            <div className="dim" style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
              {aff?.allianceId ? <img src={`https://images.evetech.net/alliances/${aff.allianceId}/logo?size=32`} width={18} height={18} alt="" /> : null}
              {aff?.corpId ? <img src={`https://images.evetech.net/corporations/${aff.corpId}/logo?size=32`} width={18} height={18} alt="" /> : null}
              {aff ? `${aff.corpName}${aff.allianceName ? ` · ${aff.allianceName}` : ''}` : (ent.corp ?? '')}
            </div>
          </div>
          {ent.ship !== ent.pilot && (
            <div style={{ textAlign: 'center' }}>
              <TypeIcon name={ent.ship} size={48} />
              <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>{ent.ship}</div>
            </div>
          )}
          {charId != null && (
            <button className="btn mini" title="open this pilot on zKillboard"
              onClick={() => window.open(`https://zkillboard.com/character/${charId}/`, '_blank')}>zKill ↗</button>
          )}
        </div>

        <div style={CARD}>
          <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
            what happened between you — {ent.pilot}
          </div>
          <div style={{ display: 'flex', gap: 20 }}>
            <ExchangeCol title="you dealt to them" agg={iDealt} color={OUT_COLOR} />
            <ExchangeCol title="they dealt to you" agg={theyDealt} color={IN_COLOR} />
          </div>
          {shared.length > 0 && (
            <div style={{ marginTop: 10, fontSize: 13 }}>
              <span className="dim">killmails you shared: </span>
              {shared.map((k) => (
                <a key={k.id} href="#" onClick={(e) => { e.preventDefault(); window.open(`https://zkillboard.com/kill/${k.id}/`, '_blank'); }}
                  style={{ marginRight: 10 }}>
                  <b style={{ color: '#5fd08a' }}>⚔ {k.kind === 'loss' ? 'their loss' : 'kill'}</b> {fmtN(k.value / 1e6)}M ISK
                </a>
              ))}
            </div>
          )}
        </div>

        <div style={{ ...CARD, marginTop: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
            <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>likely fit</span>
            <span className="dim" style={{ fontSize: 12 }}>inferred from their own recent loss on zKillboard — a strong guess for a doctrine ship, a guess all the same</span>
          </div>
          {fitState === 'idle' && (
            <button className="btn" onClick={loadFit} disabled={charId == null}
              style={{ fontSize: 13 }}>
              {charId == null ? 'resolving pilot…' : `guess ${ent.ship !== ent.pilot ? ent.ship : 'their'} fit from zKill`}
            </button>
          )}
          {fitState === 'loading' && <div className="dim" style={{ fontSize: 13 }}>reading their killboard…</div>}
          {fitState === 'none' && <div className="dim" style={{ fontSize: 13 }}>no loss on zKillboard to infer a fit from.</div>}
          {fitState === 'done' && fit && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <TypeIconId id={fit.shipTypeId} size={36} />
                <div style={{ fontSize: 14, fontWeight: 700 }}>{typeName(fit.shipTypeId)}</div>
                <a href="#" className="dim" style={{ fontSize: 12.5 }}
                  onClick={(e) => { e.preventDefault(); window.open(`https://zkillboard.com/kill/${fit.killId}/`, '_blank'); }}>
                  lost {hhmm(fit.lossTime)} · {fmtN(fit.lossValue / 1e6)}M ISK ↗
                </a>
                {shipId !== 0 && fit.shipTypeId !== shipId && (
                  <span className="flag warn" style={{ fontSize: 11 }}>different hull than you saw ({ent.ship})</span>
                )}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
                {(['high', 'mid', 'low', 'rig'] as const).map((slot) => (groups[slot].length > 0 ? (
                  <div key={slot}>
                    <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', marginBottom: 4 }}>{SLOT_LABEL[slot]}</div>
                    {groups[slot].map((m, i) => (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3, fontSize: 12.5 }}
                        title={typeName(m.typeId)}>
                        <TypeIconId id={m.typeId} size={22} />
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {m.qty > 1 ? `${m.qty}× ` : ''}{typeName(m.typeId)}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : null))}
              </div>
            </>
          )}
        </div>

        <div style={{ marginTop: 12, textAlign: 'right' }}>
          <button className="btn mini" onClick={onClose}>close</button>
        </div>
      </div>
    </div>
  );
}

type Topic = 'overview' | 'damage' | 'ewar' | 'mining' | 'feed';
type RangeMode = '24h' | '3d' | 'date' | 'undock';

// ---------------------------------------------------------------------------

export default function LiveCombat() {
  const [files, setFiles] = useState<LogFileMeta[]>([]);
  const [dir, setDir] = useState('');
  const [bridgeOk, setBridgeOk] = useState<boolean | null>(null);
  const activeId = useAuth((s) => s.activeId);
  const accounts = useAuth((s) => s.characters);
  /** MULTI-CHARACTER selection (v0.162): checkboxes, so the whole alt crew
   * can be combined into one dashboard. Log files carry the EVE character
   * id in their name, which IS the auth characterId — matched directly.
   * Defaults to the header's active character; switching the header resets
   * the selection to that character. */
  const [selCks, setSelCks] = useState<Set<string>>(
    () => new Set(activeId != null ? [`#${activeId}`] : []),
  );
  useEffect(() => {
    setSelCks(new Set(activeId != null ? [`#${activeId}`] : []));
  }, [activeId]);
  const selKey = [...selCks].sort().join(',');
  const [rangeMode, setRangeMode] = useState<RangeMode>('24h');
  const [selDate, setSelDate] = useState<string>('');
  const [selFight, setSelFight] = useState<number | null>(null);
  /** CUSTOM SCOPE (v0.171): start picked by clicking a mining timeline;
   * end is a second OPTIONAL pick — no end = running total to now, like
   * the since-undock view */
  const [customRange, setCustomRange] = useState<{ t0: number; t1: number | null } | null>(null);
  const [pickingTime, setPickingTime] = useState<'start' | 'end' | null>(null);
  const [topic, setTopic] = useState<Topic>('overview');
  const [cumulative, setCumulative] = useState(false);
  const [events, setEvents] = useState<(GameLogEvent & { ck: string })[]>([]);
  const [loading, setLoading] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const readSizes = useRef(new Map<string, number>());
  const loggedOnce = useRef(false);
  const [chartRef, chartW] = useElementWidth(320, 960);
  const [killMarks, setKillMarks] = useState<KillMark[]>([]);
  const [shipRev, setShipRev] = useState(0);
  const [entityRaw, setEntityRaw] = useState<string | null>(null);
  const typeRev = useTypeIcons();

  // ---- ORE PRICES (Jita) for the mining ISK layer. The app's ONE
  // YARDSTICK (v38.3) marks everything at the Jita ask (sell.min); the bid
  // (buy.max) rides along as the instant-sell mark. An ore with no Jita
  // market stays UNPRICED and the totals say so — never a silent zero. ----
  const [orePrices, setOrePrices] = useState<Map<string, { ask: number; bid: number }>>(new Map());
  const oreNamesKey = useMemo(() => {
    const s = new Set<string>();
    for (const e of events) if ((e.kind === 'mine' || e.kind === 'mineCrit') && e.ore) s.add(e.ore);
    return [...s].sort().join('|');
  }, [events]);
  useEffect(() => {
    let alive = true;
    const names = oreNamesKey === '' ? [] : oreNamesKey.split('|');
    if (names.length === 0 || typeIdByName === null) { setOrePrices(new Map()); return undefined; }
    const withIds = names
      .map((n) => [n, typeIdByName?.get(n)?.id] as const)
      .filter((x): x is readonly [string, number] => x[1] !== undefined);
    if (withIds.length === 0) { setOrePrices(new Map()); return undefined; }
    void fetchAggregates(BUILTIN_HUBS[0], withIds.map(([, id]) => id)).then((aggs) => {
      if (!alive) return;
      const m = new Map<string, { ask: number; bid: number }>();
      for (const [name, id] of withIds) {
        const a = aggs.get(id);
        if (a && a.sell.orderCount > 0 && a.sell.min > 0) {
          m.set(name, { ask: a.sell.min, bid: a.buy.orderCount > 0 ? a.buy.max : 0 });
        }
      }
      setOrePrices(m);
    }).catch(() => { /* fetch failed → everything stays unpriced, view says so */ });
    return () => { alive = false; };
  }, [oreNamesKey, typeRev]);
  useEffect(() => {
    let alive = true;
    void primeShipHistory().then(() => { if (alive) setShipRev((r) => r + 1); });
    const t = setInterval(() => { if (alive) setShipRev((r) => r + 1); }, 10_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // KILLS & LOSSES from zKillboard — the layer the game log cannot give.
  // Refreshed with the file poll (zKill's cache is ~30 min behind anyway).
  // Multi-selection: marks from EVERY checked character, merged by time.
  useEffect(() => {
    let alive = true;
    setKillMarks([]);
    const ids = [...selCks].map((ck) => Number(ck.slice(1))).filter((n) => Number.isFinite(n) && n > 0);
    if (ids.length === 0) return undefined;
    const load = () => {
      void Promise.all(ids.map((id) => characterKillMarks(id).catch(() => [] as KillMark[])))
        .then((lists) => { if (alive) setKillMarks(lists.flat().sort((a, b) => a.t - b.t)); });
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey]);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      const bridge = window.appInfo?.gamelog;
      if (!bridge) { setBridgeOk(false); return; }
      try {
        const r = await bridge.list();
        if (!alive) return;
        setDir(r.dir);
        setBridgeOk(r.ok);
        if (r.ok) setFiles(r.files);
      } catch {
        if (alive) setBridgeOk(false);
      }
    };
    void poll();
    const t = setInterval(poll, LIST_POLL_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const charKeyOf = (f: LogFileMeta) => (f.charId ? `#${f.charId}` : f.listener ?? f.file);

  const dates = useMemo(() => {
    const set = new Set<string>();
    for (const f of files) if (selCks.has(charKeyOf(f))) set.add(f.dateKey);
    return [...set].sort().reverse();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, selKey]);

  useEffect(() => {
    if (rangeMode === 'date' && selCks.size > 0 && (selDate === '' || !dates.includes(selDate)) && dates.length > 0) {
      setSelDate(dates[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeMode, selKey, dates, selDate]);

  /** the time cutoff for rolling ranges — event times, not file dates.
   * 'undock' loads a 3-day file window so the last undock can be found,
   * then cuts per character (below). */
  const rangeCutoff = rangeMode === '24h' ? Date.now() - 24 * 3600_000
    : rangeMode === '3d' || rangeMode === 'undock' ? Date.now() - 3 * 24 * 3600_000
      : null;

  const selFiles = useMemo(() => {
    const mine = files.filter((f) => selCks.has(charKeyOf(f)));
    if (rangeMode === 'date') {
      return mine.filter((f) => f.dateKey === selDate).sort((a, b) => a.mtimeMs - b.mtimeMs);
    }
    // rolling window: any file still WRITTEN inside the window can hold events
    return mine.filter((f) => f.mtimeMs >= (rangeCutoff ?? 0)).sort((a, b) => a.mtimeMs - b.mtimeMs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, selKey, selDate, rangeMode]);

  // RESET only on a real context switch (characters / date / range). Switching
  // what you're looking at justifies a brief empty state; a live log merely
  // GROWING does not — blanking on every refresh was the distracting black
  // flash, and it also kept deselecting the fight you'd pinned.
  useEffect(() => {
    readSizes.current = new Map();
    setEvents([]);
    setTruncated(false);
    setSelFight(null);
    setCustomRange(null);
    setPickingTime(null);
  }, [selKey, selDate, rangeMode]);

  useEffect(() => {
    let alive = true;
    if (selFiles.length === 0) return undefined;
    const load = async () => {
      const bridge = window.appInfo?.gamelog;
      if (!bridge) return;
      const now = Date.now();
      let changed = false;
      for (const f of selFiles) {
        const prev = readSizes.current.get(f.file);
        const isLive = now - f.mtimeMs < LIVE_MS;
        if (prev === undefined || (isLive && f.size > prev)) changed = true;
      }
      if (!changed) return;
      setLoading(true);
      const all: (GameLogEvent & { ck: string })[] = [];
      let trunc = false;
      for (const f of selFiles) {
        const r = await bridge.read(f.file);
        if (!alive) return;
        if (!r.ok) continue;
        readSizes.current.set(f.file, r.size ?? f.size);
        if (r.truncated) trunc = true;
        const ck = charKeyOf(f);
        for (const line of r.lines) {
          const e = parseGameLogLine(line);
          if (e) all.push({ ...e, ck });
        }
      }
      all.sort((a, b) => a.t - b.t);
      if (!alive) return;
      setEvents(all);
      setTruncated(trunc);
      setLoading(false);
      if (!loggedOnce.current) {
        loggedOnce.current = true;
        logInfo('gamelog', 'analytics loaded', {
          chars: selKey, range: rangeMode, sessions: selFiles.length, events: all.length,
        });
      }
    };
    void load();
    const t = setInterval(load, LIST_POLL_MS);
    return () => { alive = false; clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selKey, selDate, rangeMode, selFiles.map((f) => `${f.file}:${f.size}`).join('|')]);

  /** SINCE LAST UNDOCK (v0.167, journal-backed v0.168): each character's
   * window starts at THEIR own most recent undock. TWO sources, later one
   * wins: the game log's "Undocking from …" line (NPC stations ONLY —
   * measured: structure undocks never reach the log) and the app's own
   * undock journal (docked→undocked flips seen by the overlay's ESI
   * location poll, which covers player structures). A character with no
   * undock in either falls back to the last 24 h, and the view says so. */
  const undockCuts = useMemo(() => {
    if (rangeMode !== 'undock') return new Map<string, number>();
    // v0.169: THREE boundary sources, latest wins per character (pure,
    // fixtured — computeUndockCuts): every RESHIP log event (undock line,
    // "Disembarking from ship" when docking to swap hulls, clone jump),
    // the app's journaled ESI docked→undocked flip, and the latest session
    // LOGIN — a structure dweller who logs off tethered has no other
    // boundary, and "I just started a bit ago" must never show yesterday.
    const logins = new Map<string, number>();
    for (const f of selFiles) {
      const mm = f.sessionStart !== null
        ? /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(f.sessionStart)
        : null;
      if (!mm) continue;
      const t = Date.UTC(+mm[1], +mm[2] - 1, +mm[3], +mm[4], +mm[5], +mm[6]);
      const ck = charKeyOf(f);
      if (t > (logins.get(ck) ?? 0)) logins.set(ck, t);
    }
    return computeUndockCuts(
      events, lastUndocks(parseJournal(localStorage.getItem(UNDOCK_KEY))), logins, selCks);
    // shipRev ticks every 10s — it re-reads the journal as the overlay
    // watcher appends to it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, rangeMode, selKey, shipRev, selFiles]);
  const noUndockCks = useMemo(
    () => (rangeMode === 'undock'
      ? [...selCks].filter((ck) => !undockCuts.has(ck) && events.some((e) => e.ck === ck))
      : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rangeMode, selKey, undockCuts, events],
  );

  /** events inside the chosen RANGE (rolling ranges trim by event time) */
  const rangeEvents = useMemo(() => {
    if (rangeMode === 'undock') {
      const fallback = Date.now() - 24 * 3600_000;
      return events.filter((e) => e.t >= (undockCuts.get(e.ck) ?? fallback));
    }
    return rangeCutoff === null ? events : events.filter((e) => e.t >= rangeCutoff);
  }, [events, rangeCutoff, rangeMode, undockCuts]);

  const fights: Engagement[] = useMemo(() => engagements(rangeEvents), [rangeEvents]);
  const fullStats = useMemo(() => windowStats(rangeEvents), [rangeEvents]);

  /** THE SELECTION DRIVES EVERYTHING: a chosen fight — or a hand-picked
   * custom window — re-scopes every panel */
  const domain: [number, number] | null = fullStats === null ? null
    : customRange !== null
      ? [customRange.t0, customRange.t1 ?? Math.max(fullStats.t1, customRange.t0 + 60_000)]
      : selFight !== null && fights[selFight] !== undefined
        ? [fights[selFight].t0 - 15_000, fights[selFight].t1 + 15_000]
        : [fullStats.t0, fullStats.t1];
  const scopedEvents = useMemo(
    () => (domain === null ? [] : selFight === null && customRange === null ? rangeEvents
      : rangeEvents.filter((e) => e.t >= domain[0] && e.t <= domain[1])),
    [rangeEvents, domain?.[0], domain?.[1], selFight, customRange], // eslint-disable-line react-hooks/exhaustive-deps
  );

  /** a timeline click while a pick is armed sets the custom boundary */
  const pickTime = (t: number) => {
    if (pickingTime === 'start') {
      setCustomRange((prev) => ({ t0: t, t1: prev !== null && prev.t1 !== null && prev.t1 > t ? prev.t1 : null }));
      setSelFight(null);
    } else if (pickingTime === 'end') {
      setCustomRange((prev) => (prev === null ? { t0: t - 3600_000, t1: t }
        : t > prev.t0 ? { ...prev, t1: t } : { t0: t, t1: prev.t0 }));
      setSelFight(null);
    }
    setPickingTime(null);
  };
  const stats = useMemo(() => windowStats(scopedEvents), [scopedEvents]);

  const liveNow = selFiles.some((f) => Date.now() - f.mtimeMs < LIVE_MS);
  const logins = useMemo(() => selFiles.flatMap((f) => {
    const m = f.sessionStart !== null
      ? /^(\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(f.sessionStart)
      : null;
    return m ? [Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])] : [];
  }), [selFiles]);
  const reships = useMemo(
    () => scopedEvents.filter((e) => e.kind === 'reship').map((e) => ({ t: e.t, text: e.text ?? 'reship' })),
    [scopedEvents],
  );
  const scopedKills = useMemo(
    () => (domain === null ? [] : killMarks.filter((k) => k.t >= domain[0] && k.t <= domain[1])),
    [killMarks, domain?.[0], domain?.[1]], // eslint-disable-line react-hooks/exhaustive-deps
  );
  // the ship band only makes sense for ONE character — a combined crew view
  // would interleave everyone's hulls into nonsense
  const soloId = selCks.size === 1 ? Number([...selCks][0].slice(1)) : null;
  const shipSegs = useMemo<ShipSegment[]>(
    () => (domain === null || soloId === null || !Number.isFinite(soloId) ? []
      : shipSegmentsSync(soloId, domain[0], domain[1])),
    // shipRev bumps when history primes/collector appends via poll
    [soloId, domain?.[0], domain?.[1], shipRev, killMarks], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const killSummary = useMemo(() => {
    let kills = 0; let losses = 0; let destroyed = 0; let lost = 0;
    for (const k of scopedKills) {
      if (k.kind === 'loss') { losses += 1; lost += k.value; }
      else { kills += 1; destroyed += k.value; }
    }
    const eff = destroyed + lost > 0 ? Math.round((destroyed / (destroyed + lost)) * 100) : null;
    return { kills, losses, destroyed, lost, eff, any: killMarks.length > 0 };
  }, [scopedKills, killMarks]);
  const nameOfCk = (ck: string): string => {
    const acc = accounts.find((c) => `#${c.characterId}` === ck);
    return acc?.nickname || acc?.characterName || ck;
  };
  /** characters that have ANY log file on disk — the pickable crew */
  const logCks = useMemo(() => new Set(files.map(charKeyOf)), [files]);
  const crewLabel = selCks.size === 0 ? 'no character'
    : selCks.size === 1 ? nameOfCk([...selCks][0])
      : `${selCks.size} characters combined`;
  const scopeLabel = customRange !== null
    ? `custom ${hhmm(customRange.t0)}–${customRange.t1 !== null ? hhmm(customRange.t1) : 'now'}`
    : selFight !== null && fights[selFight]
      ? `fight ${hhmm(fights[selFight].t0)}`
      : rangeMode === '24h' ? 'last 24 hours' : rangeMode === '3d' ? 'last 3 days'
        : rangeMode === 'undock'
          ? (undockCuts.size === 1 ? `since undock/login ${hhmm([...undockCuts.values()][0])}` : 'since last undock/login')
          : selDate;

  const fightRows = useMemo(() => fights.map((f) => {
    const evs = rangeEvents.filter((e) => e.t >= f.t0 && e.t <= f.t1);
    const s = windowStats(evs);
    return { f, s, arms: armamentIn(rangeEvents, f.t0, f.t1) };
  }), [fights, rangeEvents]);

  /** per-character mining rows for the crew table (events carry their
   * source character key) */
  const crewMining = useMemo(() => {
    const byCk = new Map<string, GameLogEvent[]>();
    for (const e of scopedEvents) {
      if (e.kind !== 'mine' && e.kind !== 'mineCrit' && e.kind !== 'residue') continue;
      (byCk.get(e.ck) ?? byCk.set(e.ck, []).get(e.ck)!).push(e);
    }
    return [...byCk.entries()].map(([ck, evs]) => ({ ck, m: miningStats(evs) }))
      .sort((a, b) => b.m.total - a.m.total);
  }, [scopedEvents]);

  const toggleCk = (ck: string) => setSelCks((prev) => {
    const next = new Set(prev);
    if (next.has(ck)) next.delete(ck); else next.add(ck);
    return next;
  });

  return (
    <div className="theft">
      <div className="panel">
        <h2>
          Log Visualizer
          <span className="sub">
            {bridgeOk === false
              ? (window.appInfo?.gamelog ? 'game log folder not found' : 'needs the installed app (the main process reads the logs)')
              : 'the client’s own combat logs, charted — read-only, the game is never touched'}
          </span>
        </h2>

        <div className="finder-form" style={{ alignItems: 'center' }}>
          <div style={{ maxWidth: 620 }}>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--muted)', fontWeight: 600, marginBottom: 3 }}>
              Characters — <span style={{ textTransform: 'none' }}>{crewLabel}</span>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, alignItems: 'center' }}>
              {accounts.map((c) => {
                const ck = `#${c.characterId}`;
                const on = selCks.has(ck);
                const hasLogs = logCks.has(ck);
                return (
                  <button key={ck} className={`btn mini${on ? ' on' : ''}`}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5, opacity: hasLogs ? 1 : 0.4, paddingLeft: 4 }}
                    title={`${c.nickname || c.characterName}${hasLogs ? '' : ' — no game logs on this machine'}\nclick to ${on ? 'remove from' : 'add to'} the combined view`}
                    onClick={() => toggleCk(ck)}>
                    <img src={`https://images.evetech.net/characters/${c.characterId}/portrait?size=32`}
                      width={20} height={20} alt="" style={{ borderRadius: 4 }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    {c.nickname || c.characterName}
                  </button>
                );
              })}
              <button className="btn mini" title="select every character that has game logs"
                onClick={() => setSelCks(new Set(accounts.map((c) => `#${c.characterId}`).filter((ck) => logCks.has(ck))))}>
                whole crew
              </button>
              <button className="btn mini" title="back to just the header's active character"
                onClick={() => setSelCks(new Set(activeId != null ? [`#${activeId}`] : []))}>
                active only
              </button>
              <InfoDot id="battle.crew" />
            </div>
          </div>
          <label>
            <span>Range</span>
            <select value={rangeMode} style={{ fontSize: 14 }}
              onChange={(e) => setRangeMode(e.target.value as RangeMode)}>
              <option value="undock">since last undock</option>
              <option value="24h">last 24 hours</option>
              <option value="3d">last 3 days</option>
              <option value="date">pick a date…</option>
            </select>
          </label>
          {rangeMode === 'date' && (
            <label title="Days on which this character STARTED a session. Every log ever written is reachable — nothing expires.">
              <span>Date</span>
              <input type="date" value={selDate} style={{ fontSize: 14 }}
                min={dates.length > 0 ? dates[dates.length - 1] : undefined}
                max={dates.length > 0 ? dates[0] : undefined}
                onChange={(e) => setSelDate(e.target.value)} />
            </label>
          )}
          {rangeMode === 'date' && dates.length > 0 && !dates.includes(selDate) && selDate !== '' && (
            <span className="flag warn">no sessions on {selDate} — has: {dates.slice(0, 6).join(', ')}{dates.length > 6 ? '…' : ''}</span>
          )}
          {rangeMode === 'undock' && noUndockCks.length > 0 && (
            <span className="flag warn"
              title="No undock OR login boundary found for these characters in the last 3 days of logs (the game log only writes undock lines for NPC stations, and the app's location watcher has not seen a docked→undocked flip). Their last 24 hours are shown instead.">
              no undock/login seen for {noUndockCks.map(nameOfCk).join(', ')} — showing their last 24 h
            </span>
          )}
          {liveNow && <span className="flag good">● live · 5s refresh</span>}
          {loading && <span className="dim">reading…</span>}
          {truncated && <span className="flag info" title="a session file over 16 MB is read from its tail">partial</span>}
          <span className="dim" style={{ fontSize: 13 }}>
            {selFiles.length} session{selFiles.length === 1 ? '' : 's'} · {rangeEvents.length.toLocaleString()} events
            {(selFight !== null || customRange !== null) && <> · <b style={{ color: OUT_COLOR }}>scoped to {scopeLabel}</b></>}
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            {(['overview', 'damage', 'ewar', 'mining', 'feed'] as Topic[]).map((tp) => (
              <button key={tp} className={`btn${topic === tp ? ' primary' : ''}`} style={{ fontSize: 13 }}
                onClick={() => setTopic(tp)}>
                {tp === 'overview' ? 'Overview' : tp === 'damage' ? 'Damage'
                  : tp === 'ewar' ? 'EWAR & Cap' : tp === 'mining' ? 'Mining' : 'Feed'}
              </button>
            ))}
          </span>
        </div>

        {(stats === null || domain === null) && !loading && (
          <div className="empty" style={{ fontSize: 14 }}>
            {selFiles.length === 0
              ? 'No sessions in this range — pick a longer range, another date, or another character.'
              : 'No combat events in this range (the client only logs what the ship witnesses).'}
          </div>
        )}

        {stats !== null && domain !== null && fullStats !== null && (
          <>
            {topic === 'overview' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginBottom: 10 }}>
                  <Hero label={`damage dealt — ${scopeLabel}`} value={fmtN(stats.outTotal)} color={OUT_COLOR} />
                  <Hero label={`damage taken — ${scopeLabel}`} value={fmtN(stats.inTotal)} color={stats.inTotal > 0 ? IN_COLOR : undefined} />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 10 }}>
                  <Stat label="peak dps out" value={fmtN(stats.peakOut10s)} title="best 10-second window in the current scope" />
                  <Stat label="peak dps in" value={fmtN(stats.peakIn10s)} title="best 10-second window in the current scope" />
                  <Stat label="hit rate"
                    value={stats.hitsOut + stats.missOut > 0
                      ? `${Math.round((stats.hitsOut / (stats.hitsOut + stats.missOut)) * 100)}%` : '—'}
                    title="landed volleys vs complete misses (the client only logs full misses)" />
                  <Stat label="time in fights" value={durLabel(fights.reduce((n, f) => n + (f.t1 - f.t0), 0))}
                    title={`summed duration of the ${fights.length} detected engagement(s) — the time you were actually shooting or being shot, not the whole session`} />
                  <Stat label="session span" value={durLabel(stats.t1 - stats.t0)}
                    title={`first to last logged event: ${hhmmss(stats.t0)} – ${hhmmss(stats.t1)} EVE`} />
                  {killSummary.any && (
                    <Stat label="kills" value={String(killSummary.kills)} color="#5fd08a"
                      title={`${fmtN(killSummary.destroyed / 1e6)}M ISK destroyed · from zKillboard (its API runs ~30 min behind)`} />
                  )}
                  {killSummary.any && (
                    <Stat label="losses" value={String(killSummary.losses)} color={killSummary.losses > 0 ? IN_COLOR : undefined}
                      title={`${fmtN(killSummary.lost / 1e6)}M ISK lost · from zKillboard`} />
                  )}
                  {killSummary.any && killSummary.eff !== null && (
                    <Stat label="ISK efficiency" value={`${killSummary.eff}%`}
                      color={killSummary.eff >= 50 ? '#5fd08a' : IN_COLOR}
                      title="ISK destroyed ÷ (destroyed + lost) — the killboard's own efficiency metric" />
                  )}
                  {stats.neutOutGj > 0 && (
                    <Stat label="energy you drained" value={`${fmtN(stats.neutOutGj)} GJ`}
                      title="capacitor your energy neutralizers ripped out of enemy ships" />
                  )}
                  {stats.repInHp > 0 && (
                    <Stat label="reps received" value={fmtN(stats.repInHp)} color={REP_COLOR}
                      title="hit points friendly logistics repaired onto you" />
                  )}
                  {stats.mining.total > 0 && (
                    <Stat label="ore mined" value={fmtN(stats.mining.total)} color={MINE_COLOR}
                      title={`${stats.mining.byOre.length} material type(s) · ${fmtN(stats.mining.crit)} from crits — see the Mining tab`} />
                  )}
                  {stats.bountyIsk > 0 && (
                    <Stat label="bounties" value={`${fmtN(stats.bountyIsk / 1e6)}M ISK`}
                      title="ISK added to your bounty payout from NPC kills in this scope" />
                  )}
                </div>
                <div style={{ ...CARD, marginBottom: 10 }}>
                  <SectionHead accent={OUT_COLOR} text="combat timeline" extra={
                    <>
                      <span style={{ fontSize: 12.5, color: OUT_COLOR }}>▬ dealt</span>
                      <span style={{ fontSize: 12.5, color: IN_COLOR }}>▬ taken</span>
                      <span style={{ fontSize: 12.5, color: '#6ea8ff' }}>▬ ship</span>
                      <span style={{ fontSize: 12.5, color: '#5fd08a' }}>⚔ kill</span>
                      <span style={{ fontSize: 12.5, color: IN_COLOR }}>☠ loss</span>
                      <span style={{ fontSize: 12.5, color: '#ffb347' }}>▲ reship</span>
                      <span className="dim" style={{ fontSize: 12.5 }}>shaded = fight · dashed = login</span>
                      <button className={`btn mini${cumulative ? ' on' : ''}`} style={{ marginLeft: 8 }}
                        title="running totals — the 'who was winning' curve"
                        onClick={() => setCumulative(!cumulative)}>
                        cumulative
                      </button>
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button className={`btn mini${selFight === null ? ' on' : ''}`} onClick={() => setSelFight(null)}>
                          whole range
                        </button>
                        {fights.map((f, i) => (
                          <button key={i} className={`btn mini${selFight === i ? ' on' : ''}`}
                            title={`${hhmmss(f.t0)}–${hhmmss(f.t1)} EVE · ${f.n} damage events`}
                            onClick={() => setSelFight(selFight === i ? null : i)}>
                            {hhmm(f.t0)}
                          </button>
                        ))}
                      </span>
                    </>
                  } />
                  <div ref={chartRef}>
                    <FlowChart events={rangeEvents} logins={logins} reships={reships} kills={scopedKills} ships={shipSegs} fights={fights}
                      domain={domain} width={chartW} cumulative={cumulative} />
                  </div>
                </div>
                {fightRows.length > 0 && (
                  <div style={{ ...CARD, marginBottom: 10 }}>
                    <SectionHead accent="#b48cff" text={`fights (${fightRows.length})`} extra={
                      <span className="dim" style={{ fontSize: 12.5 }}>
                        click a row to scope everything to that fight · “armed with” = the weapons you fired that fight, the closest the log comes to naming your hull · amber ▲ on the chart marks reships · the client does not log kills or deaths, so those cannot be shown
                      </span>
                    } />
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto auto 1fr auto auto auto auto', gap: '6px 16px', alignItems: 'center', fontSize: 13.5 }}>
                      <span className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase' }}>start · length</span>
                      <span className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase' }}>armed with</span>
                      <span className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase' }}>main target</span>
                      <span className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', textAlign: 'right' }}>dealt</span>
                      <span className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', textAlign: 'right' }}>taken</span>
                      <span className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', textAlign: 'right' }}>peak/s</span>
                      <span className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', textAlign: 'right' }}>hit rate</span>
                      {fightRows.map(({ f, s, arms }, i) => {
                        const mainTgt = s?.byTarget[0];
                        return (
                          <React.Fragment key={i}>
                            <button className={`btn mini${selFight === i ? ' on' : ''}`}
                              style={{ justifySelf: 'start' }}
                              onClick={() => setSelFight(selFight === i ? null : i)}>
                              {hhmm(f.t0)} · {durLabel(f.t1 - f.t0)}
                            </button>
                            <span style={{ display: 'inline-flex', gap: 4 }}>
                              {arms.map(([w]) => <TypeIcon key={w} name={w} size={24} title={w} />)}
                              {arms.length === 0 && <span className="dim">—</span>}
                            </span>
                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: mainTgt ? 'pointer' : 'default' }}
                              onClick={(ev) => { if (mainTgt) { ev.stopPropagation(); setEntityRaw(mainTgt[0]); } }}
                              title={mainTgt ? 'click for pilot detail & likely fit' : undefined}>
                              {mainTgt ? parseEntity(mainTgt[0]).pilot : '—'}
                              {mainTgt && <span className="dim"> ({parseEntity(mainTgt[0]).ship})</span>}
                            </span>
                            <b style={{ textAlign: 'right', color: OUT_COLOR, fontVariantNumeric: 'tabular-nums' }}>{fmtN(s?.outTotal ?? 0)}</b>
                            <b style={{ textAlign: 'right', color: (s?.inTotal ?? 0) > 0 ? IN_COLOR : undefined, fontVariantNumeric: 'tabular-nums' }}>{fmtN(s?.inTotal ?? 0)}</b>
                            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmtN(s?.peakOut10s ?? 0)}</span>
                            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                              {s !== null && s.hitsOut + s.missOut > 0 ? `${Math.round((s.hitsOut / (s.hitsOut + s.missOut)) * 100)}%` : '—'}
                            </span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
                  <div style={CARD}>
                    <SectionHead accent={OUT_COLOR} text={`top targets — ${scopeLabel}`} extra={<span className="dim" style={{ fontSize: 12 }}>click a pilot for detail + likely fit</span>} />
                    {stats.byTarget.slice(0, 4).map(([n, a]) => (
                      <EntityRow key={n} name={n} agg={a} max={stats.byTarget[0][1].dmg} color={OUT_COLOR} onOpen={setEntityRaw} />
                    ))}
                    {stats.byTarget.length === 0 && <div className="dim" style={{ fontSize: 13 }}>you hit nothing here</div>}
                  </div>
                  <div style={CARD}>
                    <SectionHead accent={IN_COLOR} text={`top attackers — ${scopeLabel}`} />
                    {stats.bySource.slice(0, 4).map(([n, a]) => (
                      <EntityRow key={n} name={n} agg={a} max={stats.bySource[0]?.[1].dmg ?? 1} color={IN_COLOR} onOpen={setEntityRaw} />
                    ))}
                    {stats.bySource.length === 0 && <div className="dim" style={{ fontSize: 13 }}>nothing hit you</div>}
                  </div>
                </div>
                {killSummary.any && scopedKills.length > 0 && (
                  <div style={{ ...CARD, marginTop: 10 }}>
                    <SectionHead accent="#5fd08a" text={`kills & losses — ${scopeLabel}`} extra={
                      <span className="dim" style={{ fontSize: 12.5 }}>
                        from zKillboard (its cached API runs ~30 min behind the live site) · ⚔ kill · ☠ loss
                      </span>
                    } />
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 8 }}>
                      {[...scopedKills].reverse().slice(0, 24).map((k) => (
                        <a key={k.id} href="#" onClick={(ev) => { ev.preventDefault(); window.open(`https://zkillboard.com/kill/${k.id}/`, '_blank'); }}
                          style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none', color: 'inherit',
                            border: '1px solid var(--grid)', borderRadius: 6, padding: '5px 8px' }}
                          title={`${k.kind === 'loss' ? 'LOSS' : 'kill' + (k.finalBlow ? ' (final blow)' : '')} · ${hhmmss(k.t)} EVE · ${fmtN(k.value)} ISK · open on zKillboard`}>
                          <TypeIconId id={k.victimShipId} size={30} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 700, color: k.kind === 'loss' ? IN_COLOR : '#5fd08a' }}>
                              {k.kind === 'loss' ? '☠ loss' : (k.finalBlow ? '⚔ kill · final blow' : '⚔ kill')}
                            </div>
                            <div className="dim" style={{ fontSize: 12 }}>{hhmm(k.t)} · {fmtN(k.value / 1e6)}M ISK</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}

            {topic === 'damage' && (
              <>
                <div style={{ ...CARD, marginBottom: 10 }}>
                  <SectionHead accent={OUT_COLOR} text={`combat timeline — ${scopeLabel}`} extra={
                    <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      <button className={`btn mini${cumulative ? ' on' : ''}`} onClick={() => setCumulative(!cumulative)}>cumulative</button>
                      <button className={`btn mini${selFight === null ? ' on' : ''}`} onClick={() => setSelFight(null)}>whole range</button>
                      {fights.map((f, i) => (
                        <button key={i} className={`btn mini${selFight === i ? ' on' : ''}`}
                          onClick={() => setSelFight(selFight === i ? null : i)}>
                          {hhmm(f.t0)}
                        </button>
                      ))}
                    </span>
                  } />
                  <div ref={chartRef}>
                    <FlowChart events={rangeEvents} logins={logins} reships={reships} kills={scopedKills} ships={shipSegs} fights={fights}
                      domain={domain} width={chartW} cumulative={cumulative} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 10, marginBottom: 10 }}>
                  <div style={CARD}>
                    <SectionHead accent={OUT_COLOR} text={`damage by target (${stats.byTarget.length}) — ${scopeLabel}`} />
                    {stats.byTarget.map(([n, a]) => (
                      <EntityRow key={n} name={n} agg={a} max={stats.byTarget[0][1].dmg} color={OUT_COLOR} onOpen={setEntityRaw} />
                    ))}
                    {stats.byTarget.length === 0 && <div className="dim" style={{ fontSize: 13 }}>you hit nothing here</div>}
                  </div>
                  <div style={CARD}>
                    <SectionHead accent={IN_COLOR} text={`damage taken from (${stats.bySource.length}) — ${scopeLabel}`} />
                    {stats.bySource.map(([n, a]) => (
                      <EntityRow key={n} name={n} agg={a} max={stats.bySource[0]?.[1].dmg ?? 1} color={IN_COLOR} onOpen={setEntityRaw} />
                    ))}
                    {stats.bySource.length === 0 && <div className="dim" style={{ fontSize: 13 }}>nothing hit you</div>}
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
                  <div style={CARD}>
                    <SectionHead accent={OUT_COLOR} text="your weapons" extra={
                      <span className="dim" style={{ fontSize: 12 }}>lands = hit vs full-miss · solid = Wrecks/Smashes/Penetrates (a real hit, not a graze)</span>
                    } />
                    {stats.byWeapon.map(([n, a]) => {
                      const lands = a.hits + a.misses > 0 ? Math.round((a.hits / (a.hits + a.misses)) * 100) : 100;
                      const solid = a.hits > 0 ? Math.round((a.solid / a.hits) * 100) : 0;
                      const avg = a.dmg / Math.max(1, a.hits);
                      // the profile the owner described: does it always land, or rarely-but-big?
                      const profile = lands >= 90 && solid >= 60 ? 'consistent'
                        : lands < 60 ? 'streaky — big when it lands'
                          : a.max > avg * 3 ? 'spiky' : 'steady';
                      return (
                        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 9 }}
                          title={`${n} — ${fmtN(a.dmg)} dmg · ${a.hits} hits, ${a.misses} full misses · avg ${fmtN(avg)} · best ${fmtN(a.max)} · ${solid}% solid hits`}>
                          <TypeIcon name={n} size={32} />
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 13.5 }}>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{n}</span>
                              <b style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{fmtN(a.dmg)}</b>
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                              <span>{lands}% land · {solid}% solid · <span style={{ color: '#b48cff' }}>{profile}</span></span>
                              <span>avg {fmtN(avg)} · max {fmtN(a.max)}</span>
                            </div>
                            {/* stacked lands/solid bar */}
                            <div style={{ display: 'flex', height: 5, borderRadius: 2, overflow: 'hidden', marginTop: 3, background: 'rgba(128,128,128,.16)' }}>
                              <div style={{ width: `${solid}%`, background: '#5fd08a' }} title={`${solid}% solid hits`} />
                              <div style={{ width: `${Math.max(0, lands - solid)}%`, background: OUT_COLOR, opacity: 0.7 }} title="grazing hits" />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <div style={CARD}>
                    <SectionHead accent="#b48cff" text="volley quality" />
                    <QualityBar rows={stats.byQuality} misses={stats.missOut} />
                    <div className="dim" style={{ fontSize: 12.5, marginTop: 10 }}>
                      Wrecks land ~3× damage; Grazes and Glances barely connect — this bar IS
                      your tracking quality against what you were shooting.
                    </div>
                  </div>
                  <div style={CARD}>
                    <SectionHead accent={OUT_COLOR} text="volley sizes" />
                    <VolleyHistogram volleys={stats.volleys} />
                  </div>
                </div>
              </>
            )}

            {topic === 'ewar' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginBottom: 10 }}>
                  <Hero label="energy you drained" value={`${fmtN(stats.neutOutGj)} GJ`} color={OUT_COLOR}
                    title="capacitor your energy neutralizers ripped out of enemy ships — a dry enemy cannot rep, shoot lasers or run hardeners" />
                  <Hero label="energy drained from you" value={`${fmtN(stats.neutInGj)} GJ`}
                    color={stats.neutInGj > 0 ? IN_COLOR : undefined}
                    title="capacitor enemy neutralizers ripped out of YOUR ship" />
                  <Hero label="reps received" value={fmtN(stats.repInHp)} color={REP_COLOR}
                    title="hit points friendly logistics repaired onto you" />
                </div>
                <div style={{ ...CARD, marginBottom: 10 }}>
                  <SectionHead accent={OUT_COLOR} text={`cap pressure — ${scopeLabel}`} extra={
                    <span className="dim" style={{ fontSize: 12.5 }}>
                      GJ neutralized per second · the client never logs your own cap level, so this IS the cap-war picture · hover for numbers
                    </span>
                  } />
                  <div ref={chartRef}>
                    <CapChart events={scopedEvents} domain={domain} width={chartW} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 10 }}>
                  <div style={CARD}>
                    <SectionHead accent="#ffb347" text={`tackle & ewar witnessed (${stats.ewar.length + stats.jams.length}) — ${scopeLabel}`} />
                    <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: 13.5, lineHeight: 1.7 }}>
                      {stats.ewar.length + stats.jams.length === 0 && <div className="dim">none in this scope</div>}
                      {[...stats.ewar, ...stats.jams].sort((a, b) => b.t - a.t).slice(0, 100).map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8 }}>
                          <span className="dim" style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{hhmmss(e.t)}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {e.kind === 'jammed'
                              ? <b className="neg">ECM jammed by {e.entity}{e.weapon ? ` (${e.weapon})` : ''}</b>
                              : e.text?.includes(' you') ? <b className="neg">{e.text}</b> : e.text}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={CARD}>
                    <SectionHead accent={REP_COLOR} text={`repairs received (${stats.repEvents.length}) — ${scopeLabel}`} />
                    <div style={{ maxHeight: 320, overflowY: 'auto', fontSize: 13.5, lineHeight: 1.7 }}>
                      {stats.repEvents.length === 0 && <div className="dim">no remote reps in this scope</div>}
                      {stats.repEvents.slice(-80).reverse().map((e, i) => (
                        <div key={i} style={{ display: 'flex', gap: 8 }}>
                          <span className="dim" style={{ flex: 'none', fontVariantNumeric: 'tabular-nums' }}>{hhmmss(e.t)}</span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <b className="pos">{fmtN(e.amount ?? 0)}</b> hp from {e.entity}{e.weapon ? ` (${e.weapon})` : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </>
            )}

            {topic === 'mining' && (() => {
              const mg = stats.mining;
              const mineEvs = scopedEvents.filter((e) => e.kind === 'mine' || e.kind === 'mineCrit' || e.kind === 'residue');
              const mineSpanMs = mineEvs.length > 1 ? mineEvs[mineEvs.length - 1].t - mineEvs[0].t : 0;
              const perHour = mineSpanMs > 60_000 ? mg.total / (mineSpanMs / 3600_000) : null;
              const critRate = mg.cycles > 0 ? (mg.critCycles / mg.cycles) * 100 : 0;
              const wastePct = mg.total + mg.residue > 0 ? (mg.residue / (mg.total + mg.residue)) * 100 : 0;
              // ---- the ISK layer: units × Jita ask per ore (the app's one
              // yardstick); unpriced ores make every total an honest "≥" ----
              let iskMined = 0; let iskCrit = 0; let iskResidue = 0; let iskBid = 0;
              const unpriced: string[] = [];
              for (const [ore, o] of mg.byOre) {
                const p = orePrices.get(ore);
                if (!p) { if (o.normal + o.crit + o.residue > 0) unpriced.push(ore); continue; }
                iskMined += (o.normal + o.crit) * p.ask;
                iskCrit += o.crit * p.ask;
                iskResidue += o.residue * p.ask;
                iskBid += (o.normal + o.crit) * (p.bid || 0);
              }
              const ge = unpriced.length > 0 ? '≥ ' : '';
              const unpricedNote = unpriced.length > 0
                ? `\nUNPRICED (no Jita market data): ${unpriced.join(', ')} — totals are a floor, not the full value.` : '';
              const iskPerHour = mineSpanMs > 60_000 ? iskMined / (mineSpanMs / 3600_000) : null;
              // judge coverage by the ores IN SCOPE — a priced ore from some
              // other session must not make an all-unpriced gas scope show
              // "≥ 0.00" instead of the honest pending note
              const priceKnown = mg.byOre.some(([ore]) => orePrices.has(ore));
              const charIskOf = (m: MiningStats): { v: number; part: boolean } => {
                let v = 0; let part = false;
                for (const [ore, o] of m.byOre) {
                  const p = orePrices.get(ore);
                  if (!p) { if (o.normal + o.crit > 0) part = true; continue; }
                  v += (o.normal + o.crit) * p.ask;
                }
                return { v, part };
              };
              return (
                <>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginBottom: 10 }}>
                    <Hero label={`ore mined — ${scopeLabel}`} value={fmtN(mg.total)} color={MINE_COLOR}
                      title={`${fmtN(mg.normal)} from plain cycles + ${fmtN(mg.crit)} from criticals · residue never counts as yield`} />
                    <Hero label="mined by crits" value={fmtN(mg.crit)} color={CRIT_COLOR}
                      title={`${mg.critCycles} critical successes · ${mg.total > 0 ? Math.round((mg.crit / mg.total) * 100) : 0}% of everything mined came from crits`} />
                    <Hero label="residue (wasted)" value={fmtN(mg.residue)} color={mg.residue > 0 ? RESIDUE_COLOR : undefined}
                      title="units the asteroid lost WITHOUT reaching your hold — crystal waste, straight from the client's residue lines" />
                    {stats.bountyIsk > 0 && (
                      <Hero label="bounties earned" value={`${fmtN(stats.bountyIsk / 1e6)}M ISK`}
                        title="ISK added to your bounty payout from NPC kills" />
                    )}
                  </div>
                  {mg.total > 0 && priceKnown && (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 10, marginBottom: 10 }}>
                      <Hero label="ISK mined" value={`${ge}${iskShort(iskMined)}`} color={ISK_COLOR}
                        title={`units × Jita ask (lowest sell order) per ore — the app's one-yardstick mark.\nInstant-sell into Jita bids: ${ge}${iskShort(iskBid)}.${unpricedNote}`} />
                      <Hero label="ISK / hour" value={iskPerHour !== null ? `${ge}${iskShort(iskPerHour)}` : '—'} color={ISK_COLOR}
                        title={`${ge}${iskShort(iskMined)} over ${durLabel(mineSpanMs)} of mining (first to last mining event in scope)${unpricedNote}`} />
                      <Hero label="ISK from crits" value={`${ge}${iskShort(iskCrit)}`} color={CRIT_COLOR}
                        title={`the critical-success bonus units alone, at Jita ask${unpricedNote}`} />
                      <Hero label="ISK lost to residue" value={`${ge}${iskShort(iskResidue)}`} color={iskResidue > 0 ? RESIDUE_COLOR : undefined}
                        title={`what the wasted units would have been worth at Jita ask — the crystal's real cost${unpricedNote}`} />
                    </div>
                  )}
                  {mg.total > 0 && !priceKnown && (
                    <div className="hint" style={{ marginBottom: 10 }}>
                      ISK values pending — no Jita price data yet for {unpriced.length > 0 ? unpriced.join(', ') : 'these materials'}
                      {' '}(fetched from the same aggregates feed the Trade module uses; retries with the next refresh).
                    </div>
                  )}
                  {mg.total === 0 && stats.bountyIsk === 0 && (
                    <div className="empty" style={{ fontSize: 14 }}>
                      No mining or bounty activity in this scope. Mining and bounty lines are read from
                      the same game log — this fills whenever you mine or rat.
                    </div>
                  )}
                  {mg.total > 0 && (
                    <>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 10 }}>
                        <Stat label="crit rate" value={`${critRate.toFixed(1)}%`} color={CRIT_COLOR}
                          title={`${mg.critCycles} criticals over ${mg.cycles} mining cycles`} />
                        <Stat label="avg cycle" value={fmtN(mg.cycles > 0 ? mg.normal / mg.cycles : 0)}
                          title="average units per plain mining cycle" />
                        <Stat label="avg crit bonus" value={mg.critCycles > 0 ? fmtN(mg.crit / mg.critCycles) : '—'} color={CRIT_COLOR}
                          title="average BONUS units per critical success" />
                        <Stat label="waste ratio" value={`${wastePct.toFixed(1)}%`} color={mg.residue > 0 ? RESIDUE_COLOR : undefined}
                          title="residue ÷ (mined + residue) — the share of depleted rock that never reached the hold" />
                        {perHour !== null && (
                          <Stat label="units / hour" value={fmtN(perHour)} color={MINE_COLOR}
                            title={`${fmtN(mg.total)} units over ${durLabel(mineSpanMs)} of mining (first to last mining event in scope)`} />
                        )}
                        <Stat label="mining time" value={durLabel(mineSpanMs)}
                          title={`first to last mining event: ${mineEvs.length > 0 ? `${hhmmss(mineEvs[0].t)} – ${hhmmss(mineEvs[mineEvs.length - 1].t)} EVE` : '—'}`} />
                      </div>
                      <div style={{ ...CARD, marginBottom: 10 }}>
                        <SectionHead accent={MINE_COLOR} text={`mining timeline — ${scopeLabel}`} extra={
                          <>
                            <span style={{ fontSize: 12.5, color: MINE_COLOR }}>▬ mined/min</span>
                            <span style={{ fontSize: 12.5, color: CRIT_COLOR }}>▬ crit share · ▲ critical</span>
                            <span style={{ fontSize: 12.5, color: RESIDUE_COLOR }}>▼ residue/min</span>
                            <span className="dim" style={{ fontSize: 12.5 }}>dashed = login · hover for numbers</span>
                            <span style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                              {pickingTime !== null && (
                                <span className="flag info" style={{ fontSize: 12 }}>
                                  click any timeline below to set the {pickingTime}
                                </span>
                              )}
                              <button className={`btn mini${pickingTime === 'start' ? ' on' : ''}`}
                                title="arm, then click a spot on any of the timelines below — everything re-scopes from that moment (running to now until you also set an end)"
                                onClick={() => setPickingTime(pickingTime === 'start' ? null : 'start')}>
                                ⟟ set custom start
                              </button>
                              <button className={`btn mini${pickingTime === 'end' ? ' on' : ''}`}
                                disabled={customRange === null}
                                title={customRange === null ? 'set a custom start first' : 'optional second step: arm, then click a timeline to close the window — leave unset for a running total to now'}
                                onClick={() => setPickingTime(pickingTime === 'end' ? null : 'end')}>
                                set custom end
                              </button>
                              {customRange !== null && (
                                <button className="btn mini on" title="clear the custom window"
                                  onClick={() => { setCustomRange(null); setPickingTime(null); }}>
                                  ✕ {scopeLabel}
                                </button>
                              )}
                            </span>
                          </>
                        } />
                        <div ref={chartRef}>
                          <MiningChart events={rangeEvents} logins={logins} domain={domain} width={chartW}
                            onPickTime={pickTime} picking={pickingTime !== null} />
                        </div>
                        {(() => {
                          const volOf = (ore?: string): number => {
                            const id = ore !== undefined ? typeIdByName?.get(ore)?.id : undefined;
                            return id !== undefined ? getType(id)?.volume ?? 0 : 0;
                          };
                          return (
                            <>
                              <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, margin: '10px 0 2px', color: ISK_COLOR }}>
                                ISK / min <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>— at Jita ask{unpriced.length > 0 ? ` · unpriced excluded: ${unpriced.join(', ')}` : ''}</span>
                              </div>
                              <RateChart events={rangeEvents} logins={logins} domain={domain} width={chartW}
                                color={ISK_COLOR} ariaLabel="isk mined per minute over time"
                                fmtY={(v) => `${iskShort(v)}/min`}
                                valueOf={(e) => (e.amount ?? 0) * (orePrices.get(e.ore ?? '')?.ask ?? 0)}
                                onPickTime={pickTime} picking={pickingTime !== null} />
                              <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.07em', fontWeight: 700, margin: '10px 0 2px', color: '#7fb8d8' }}>
                                m³ / min <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0, color: 'var(--muted)' }}>— unit volumes from the SDE</span>
                              </div>
                              <RateChart events={rangeEvents} logins={logins} domain={domain} width={chartW}
                                color="#7fb8d8" ariaLabel="cubic meters mined per minute over time"
                                fmtY={(v) => `${fmtN(v)} m³/min`}
                                valueOf={(e) => (e.amount ?? 0) * volOf(e.ore)}
                                onPickTime={pickTime} picking={pickingTime !== null} />
                            </>
                          );
                        })()}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: selCks.size > 1 && crewMining.length > 0 ? 'repeat(auto-fit, minmax(380px, 1fr))' : '1fr', gap: 10 }}>
                        <div style={CARD}>
                          <SectionHead accent={MINE_COLOR} text={`by material — ${scopeLabel}`} extra={
                            <span className="dim" style={{ fontSize: 12 }}>residue lines carry no ore name — attributed to the ore mined on the same cycle tick</span>
                          } />
                          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto auto', gap: '5px 14px', alignItems: 'center', fontSize: 13.5 }}>
                            <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>material</span>
                            <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>mined</span>
                            <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>from crits</span>
                            <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>residue</span>
                            <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>waste</span>
                            <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>isk</span>
                            {mg.byOre.map(([ore, o]) => {
                              const oreTotal = o.normal + o.crit;
                              const waste = oreTotal + o.residue > 0 ? Math.round((o.residue / (oreTotal + o.residue)) * 100) : 0;
                              const topTotal = mg.byOre[0][1].normal + mg.byOre[0][1].crit;
                              const p = orePrices.get(ore);
                              return (
                                <React.Fragment key={ore}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                    <TypeIcon name={ore} size={28} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                      <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ore}</div>
                                      <div style={{ height: 4, borderRadius: 2, background: 'rgba(128,128,128,.16)', marginTop: 2, display: 'flex', overflow: 'hidden' }}>
                                        <div style={{ height: '100%', width: `${(o.normal / Math.max(1, topTotal)) * 100}%`, background: MINE_COLOR, opacity: 0.9 }} />
                                        <div style={{ height: '100%', width: `${(o.crit / Math.max(1, topTotal)) * 100}%`, background: CRIT_COLOR, opacity: 0.9 }} />
                                      </div>
                                    </div>
                                  </div>
                                  <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: MINE_COLOR }}>{fmtN(oreTotal)}</b>
                                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: o.crit > 0 ? CRIT_COLOR : 'var(--muted)' }}>
                                    {o.crit > 0 ? `${fmtN(o.crit)} (${Math.round((o.crit / oreTotal) * 100)}%)` : '—'}
                                  </span>
                                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: o.residue > 0 ? RESIDUE_COLOR : 'var(--muted)' }}>
                                    {o.residue > 0 ? fmtN(o.residue) : '—'}
                                  </span>
                                  <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{waste}%</span>
                                  <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: p ? ISK_COLOR : 'var(--muted)' }}
                                    title={p
                                      ? `${p.ask.toLocaleString()} ISK/unit at Jita ask · ${fmtN(oreTotal)} units${o.residue > 0 ? ` · residue worth ${iskShort(o.residue * p.ask)}` : ''}`
                                      : 'no Jita market data for this material'}>
                                    {p ? iskShort(oreTotal * p.ask) : 'unpriced'}
                                  </b>
                                </React.Fragment>
                              );
                            })}
                          </div>
                        </div>
                        {selCks.size > 1 && crewMining.length > 0 && (
                          <div style={CARD}>
                            <SectionHead accent={OUT_COLOR} text={`by character — ${scopeLabel}`} extra={
                              <span className="dim" style={{ fontSize: 12 }}>the whole crew's haul, split by who dug it</span>
                            } />
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: '5px 14px', alignItems: 'center', fontSize: 13.5 }}>
                              <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase' }}>character</span>
                              <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>mined</span>
                              <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>crit rate</span>
                              <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>residue</span>
                              <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', textAlign: 'right' }}>isk</span>
                              {crewMining.map(({ ck, m }) => {
                                const ci = charIskOf(m);
                                return (
                                  <React.Fragment key={ck}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                      <img src={`https://images.evetech.net/characters/${ck.slice(1)}/portrait?size=32`}
                                        width={24} height={24} alt="" style={{ borderRadius: 5 }}
                                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                      <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameOfCk(ck)}</div>
                                        <div style={{ height: 4, borderRadius: 2, background: 'rgba(128,128,128,.16)', marginTop: 2 }}>
                                          <div style={{ height: '100%', width: `${(m.total / Math.max(1, crewMining[0].m.total)) * 100}%`, borderRadius: 2, background: MINE_COLOR, opacity: 0.9 }} />
                                        </div>
                                      </div>
                                    </div>
                                    <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: MINE_COLOR }}>{fmtN(m.total)}</b>
                                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: m.critCycles > 0 ? CRIT_COLOR : 'var(--muted)' }}>
                                      {m.cycles > 0 ? `${((m.critCycles / m.cycles) * 100).toFixed(1)}%` : '—'}
                                    </span>
                                    <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: m.residue > 0 ? RESIDUE_COLOR : 'var(--muted)' }}>
                                      {m.residue > 0 ? fmtN(m.residue) : '—'}
                                    </span>
                                    <b style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: ci.v > 0 ? ISK_COLOR : 'var(--muted)' }}
                                      title={ci.part ? 'some of this character\'s ores have no Jita price — this is a floor' : 'this character\'s haul at Jita ask'}>
                                      {ci.v > 0 ? `${ci.part ? '≥ ' : ''}${iskShort(ci.v)}` : '—'}
                                    </b>
                                  </React.Fragment>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              );
            })()}

            {topic === 'feed' && (
              <div style={CARD}>
                <SectionHead accent="var(--muted)" text={`raw combat feed — ${scopeLabel} (${scopedEvents.length.toLocaleString()} events, newest first)`} />
                <div style={{ maxHeight: 560, overflowY: 'auto', fontSize: 13.5, lineHeight: 1.7 }}>
                  {scopedEvents.slice(-400).reverse().map((e, i) => {
                    const k = FEED_TAG[e.kind];
                    return (
                      <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 8px', borderRadius: 6,
                        background: i % 2 === 0 ? 'rgba(128,128,128,.05)' : 'transparent' }}>
                        <span className="dim" style={{ flex: 'none', fontVariantNumeric: 'tabular-nums', fontSize: 13 }}>{hhmmss(e.t)}</span>
                        <span className={k.cls} style={{ flex: 'none', minWidth: 34, textAlign: 'center', fontWeight: 700,
                          fontSize: 11.5, padding: '2px 6px', borderRadius: 5, background: 'rgba(128,128,128,.14)' }}>{k.tag}</span>
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {e.kind === 'dmgOut' && <><b>{fmtN(e.amount ?? 0)}</b> to {e.entity}{e.quality ? <span className="dim"> ({e.quality})</span> : ''}</>}
                          {e.kind === 'dmgIn' && <><b>{fmtN(e.amount ?? 0)}</b> from {e.entity}{e.quality ? <span className="dim"> ({e.quality})</span> : ''}</>}
                          {e.kind === 'missOut' && <>missed {e.entity}</>}
                          {e.kind === 'missIn' && <>{e.entity} missed you</>}
                          {e.kind === 'neutOut' && <>drained {e.entity} for <b>{fmtN(e.amount ?? 0)}</b> GJ</>}
                          {e.kind === 'neutIn' && <>drained by {e.entity} for <b>{fmtN(e.amount ?? 0)}</b> GJ</>}
                          {e.kind === 'repIn' && <><b>{fmtN(e.amount ?? 0)}</b> hp rep from {e.entity}</>}
                          {e.kind === 'repOut' && <><b>{fmtN(e.amount ?? 0)}</b> hp rep to {e.entity}</>}
                          {e.kind === 'jammed' && <>ECM jammed by {e.entity}{e.weapon ? <span className="dim"> ({e.weapon})</span> : ''}</>}
                          {e.kind === 'mine' && <>mined <b>{fmtN(e.amount ?? 0)}</b> {e.ore}</>}
                          {e.kind === 'mineCrit' && <b style={{ color: CRIT_COLOR }}>critical! +{fmtN(e.amount ?? 0)} {e.ore}</b>}
                          {e.kind === 'residue' && <span style={{ color: RESIDUE_COLOR }}><b>{fmtN(e.amount ?? 0)}</b> units lost as residue</span>}
                          {e.kind === 'bounty' && <><b>{fmtN(e.isk ?? 0)}</b> ISK bounty</>}
                          {e.kind === 'reship' && <>{e.text}</>}
                          {(e.kind === 'ewar' || e.kind === 'other') && <>{e.text}</>}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {entityRaw !== null && stats !== null && (
          <EntityPanel raw={entityRaw} stats={stats} killMarks={killMarks} onClose={() => setEntityRaw(null)} />
        )}
        <div className="hint">
          Read straight from the client's log files in {dir || 'Documents\\EVE\\logs\\Gamelogs'} — the
          same files triff.tools asks you to upload, without the uploading. Times are EVE time.
          HONEST LIMITS: the client logs what THIS character's ship witnesses, nothing else — it
          never names your own hull (the “armed with” column infers from your logged shots), and it
          only writes when something happens. Reading is open→read→close per call, no held handles,
          nothing ever written — the game cannot be affected.
        </div>
      </div>
    </div>
  );
}

