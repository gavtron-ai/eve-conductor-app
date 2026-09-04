// MULTIBOX OVERLAY — one floating box per character over the EVE clients.
// Click-through until the edit hotkey ("\") is pressed; in edit mode every
// box can be dragged and resized from ALL FOUR corners, and its icon and
// text scale with the box.
//
// HONEST LIMIT (stated in the UI too): live shield/armor/hull bars are NOT
// possible. ESI publishes no HP/health route of any kind — verified against
// the live spec — and the only other sources would be reading the game
// client's memory or scraping its pixels, which CCP's third-party policy
// forbids. Everything shown here comes from sanctioned endpoints.
import { useEffect, useRef, useState } from 'react';

import type { OverlayNotice, RaidAlert } from '../lib/overlayFeed';

export interface OverlayChar {
  characterId: number;
  characterName: string;
  shipTypeId: number | null;
  shipName: string | null;
  shipTypeName: string | null;
  /** the CAPSULE's custom name — only readable while the pilot is actually
   * IN the pod (capsules appear in no asset list), so usually null */
  podName: string | null;
  /** the pilot's OWN name for the clone they're flying — either typed in the
   * setup window or recovered by matching live implants against named jump
   * clones (see cloneNames.ts) */
  cloneName?: string;
  /** true when cloneName is the user's own typed label */
  cloneIsCustom?: boolean;
  /** "do not undock in this" — set per clone in the setup window */
  alert?: { blink: boolean; color: string } | null;
  /** where they are right now, and its security band */
  systemName?: string;
  systemSec?: number | null;
  /** the solar system id — WORMHOLE space is identified by its id range,
   * not by security (J-space and nullsec both read negative) */
  systemId?: number;
  /** WHICH CLONE they're flying, from their live implants — the thing a
   * pod name like "PG + Cap + Hack" was always describing */
  cloneLabel?: string;
  cloneDetail?: string;
  /** false when this login predates the clone-read scope, so the missing
   * name is explained rather than silently absent */
  cloneNamesAvailable?: boolean;
  online: boolean;
  /** ISO time the row was refreshed; drives the staleness dot */
  at: number;
  error?: string;
}

interface Pos { x: number; y: number }
interface Size { w: number; h: number }
/** ONE size for every box (user's rule: resizing any box resizes them all),
 * positions per character. The old per-box {x,y,w,h} shape is migrated. */
interface Layout { size: Size; pos: Record<number, Pos> }

const LAYOUT_KEY = 'eve-conductor-overlay-layout-v2';
const LEGACY_KEY = 'eve-conductor-overlay-layout-v1';
const DEFAULT_SIZE: Size = { w: 260, h: 76 };
const DEFAULT_POS: Pos = { x: 40, y: 40 };
/** reserved layout key for the draggable global-notice box */
const NOTICE_ID = -1;
/** reserved layout key for the draggable nearby-raid box */
const RAID_ID = -2;
/** reserved layout key for the PI-warnings box (v0.179) */
const PI_ID = -3;
const MIN_W = 120;
const MIN_H = 48;

const loadLayout = (): Layout => {
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    if (raw) {
      const l = JSON.parse(raw) as Layout;
      if (l?.size && l?.pos) return l;
    }
    // migrate the old per-box format: keep every POSITION, and adopt the
    // first box's size as the shared one
    const old = JSON.parse(localStorage.getItem(LEGACY_KEY) ?? '{}') as Record<number, { x: number; y: number; w: number; h: number }>;
    const entries = Object.entries(old);
    if (entries.length > 0) {
      const first = entries[0][1];
      return {
        size: { w: Math.max(MIN_W, first.w), h: Math.max(MIN_H, first.h) },
        pos: Object.fromEntries(entries.map(([id, b]) => [Number(id), { x: b.x, y: b.y }])),
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return { size: { ...DEFAULT_SIZE }, pos: {} };
};

/**
 * null = RED, low = ORANGE, high = WHITE, J-space = PLUM (user's rule).
 *
 * Wormholes CANNOT be told apart by security — J-space sits at -0.99, the
 * same band as nullsec. They are identified by their system-id range
 * (31000000-31999999, which includes Thera), so the check must come first.
 */
export function isWormhole(systemId: number | undefined): boolean {
  return systemId !== undefined && systemId >= 31000000 && systemId < 32000000;
}

function secColor(sec: number | null | undefined, systemId?: number): string {
  if (isWormhole(systemId)) return '#c77dff'; // plum
  if (sec === null || sec === undefined) return '#c3c2b7';
  if (sec >= 0.45) return '#ffffff';   // EVE rounds 0.45+ up to 0.5 = high
  if (sec > 0.0) return '#ff9d3d';
  return '#ff4d4d';
}

/**
 * LINE 3 — the name the PILOT gave the ship, not the hull: the icon already
 * says what it is. EVE auto-names an unnamed ship "<Character>'s <Hull>",
 * which is not a name they chose, so it is suppressed. A pod name already
 * shown on line 1 is not repeated here either.
 */
function shipLabel(c: OverlayChar): string {
  const name = c.shipName?.trim() ?? '';
  if (!name) return '—';
  const owner = c.characterName.trim().toLowerCase();
  const n = name.toLowerCase();
  if (owner && n.includes(owner)) return '—';   // "Alice's Heron"
  if (/^capsule\b/.test(n)) return '—';         // "Capsule - Alice"
  // already the headline when they are sitting in the pod
  if (c.podName && c.podName.trim() === name) return '—';
  return name;
}

export default function Overlay() {
  const [chars, setChars] = useState<OverlayChar[]>([]);
  const [notice, setNotice] = useState<OverlayNotice | null>(null);
  const [raids, setRaids] = useState<RaidAlert[]>([]);
  const [pi, setPi] = useState<{ charName: string; planetName: string; text: string; sev: number }[]>([]);
  const [edit, setEdit] = useState(false);
  const [layout, setLayout] = useState<Layout>(loadLayout);
  const drag = useRef<{
    id: number; mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    startX: number; startY: number; pos: Pos; size: Size;
  } | null>(null);
  // a ticking clock so the staleness warning appears on its own, without
  // waiting for a push that may never come
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    window.appInfo?.overlay?.onData((payload: OverlayChar[] | { chars: OverlayChar[]; notice: OverlayNotice | null; raids?: RaidAlert[]; pi?: { charName: string; planetName: string; text: string; sev: number }[] }) => {
      if (Array.isArray(payload)) { setChars(payload); setNotice(null); setRaids([]); setPi([]); }
      else { setChars(payload.chars); setNotice(payload.notice); setRaids(payload.raids ?? []); setPi(payload.pi ?? []); }
    });
    window.appInfo?.overlay?.onEdit((on: boolean) => setEdit(on));
  }, []);

  const persist = (next: Layout) => {
    setLayout(next);
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify(next));
    } catch {
      // layout is a convenience — never break the overlay over it
    }
  };

  useEffect(() => {
    if (!edit) return;
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (d.mode === 'move') {
        setLayout((cur) => ({ ...cur, pos: { ...cur.pos, [d.id]: { x: d.pos.x + dx, y: d.pos.y + dy } } }));
        return;
      }
      // RESIZING ANY BOX RESIZES THEM ALL — one shared size. Dragging a
      // north/west handle also moves the box being dragged, so the corner
      // under the cursor stays put.
      const w = Math.max(MIN_W, d.mode === 'ne' || d.mode === 'se' ? d.size.w + dx : d.size.w - dx);
      const h = Math.max(MIN_H, d.mode === 'sw' || d.mode === 'se' ? d.size.h + dy : d.size.h - dy);
      const pos = { ...d.pos };
      if (d.mode === 'nw' || d.mode === 'sw') pos.x = d.pos.x + (d.size.w - w);
      if (d.mode === 'nw' || d.mode === 'ne') pos.y = d.pos.y + (d.size.h - h);
      setLayout((cur) => ({ size: { w, h }, pos: { ...cur.pos, [d.id]: pos } }));
    };
    const up = () => {
      if (drag.current) {
        drag.current = null;
        setLayout((cur) => { persist(cur); return cur; });
      }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
  }, [edit]);

  const start = (id: number, mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.MouseEvent) => {
    if (!edit) return;
    e.preventDefault();
    // a corner handle sits INSIDE the box: without stopping the bubble the
    // box's own mousedown ran next and overwrote the mode with 'move',
    // which is why the handles only ever dragged
    e.stopPropagation();
    drag.current = {
      id, mode, startX: e.clientX, startY: e.clientY,
      pos: layout.pos[id] ?? DEFAULT_POS, size: layout.size,
    };
  };

  return (
    <div className={`ovl-root ${edit ? 'edit' : ''}`}>
      {edit && (
        <div className="ovl-help">
          SETUP MODE — drag a box to move it, grab a blue CORNER square to resize · name clones and set alerts in the setup window · press <b>Alt+\</b> again (or click here) to lock
          <button onClick={() => window.appInfo?.overlay?.setEdit(false)}>done</button>
        </div>
      )}
      {chars.map((c, i) => {
        const size = layout.size;
        const pos = layout.pos[c.characterId] ?? { x: DEFAULT_POS.x, y: DEFAULT_POS.y + i * (size.h + 8) };
        // THREE LINES AT ONE SIZE (user's rule): pod, system, ship. The icon
        // and the text scale together off the shared box height.
        const iconPx = Math.max(16, Math.round(size.h * 0.62));
        const lineFs = Math.max(9, Math.round(size.h * 0.21));
        // the feed stamps every push; if that stops (main window closed,
        // session died) the box must SAY so rather than keep showing old
        // data as if it were live
        const ageS = Math.round((now - c.at) / 1000);
        const stale = ageS > 60;
        // a flagged clone must be unmissable at a glance — that is the whole
        // point of it (don't undock the learning pod into a fight)
        const alert = c.alert ?? null;
        const alertColor = /^#[0-9a-f]{6}$/i.test(alert?.color ?? '') ? alert!.color : '#ff4d4d';
        return (
          <div key={c.characterId}
            className={`ovl-box ${stale ? 'stale' : ''} ${alert ? 'alert' : ''} ${alert?.blink ? 'blink' : ''}`}
            style={{
              left: pos.x, top: pos.y, width: size.w, height: size.h,
              ...(alert ? ({ ['--alert' as string]: alertColor } as React.CSSProperties) : {}),
            }}
            onMouseDown={start(c.characterId, 'move')}>
            {c.shipTypeId !== null ? (
              // a STALE box must not keep flashing a confident hull icon — the
              // ⚠ text alone was easy to miss and the old ship read as current
              <img className="ovl-ship" src={`https://images.evetech.net/types/${c.shipTypeId}/icon?size=64`}
                alt="" width={iconPx} height={iconPx} draggable={false}
                style={stale ? { opacity: 0.35, filter: 'grayscale(0.8)' } : undefined} />
            ) : (
              <div className="ovl-ship ovl-noship" style={{ width: iconPx, height: iconPx, fontSize: lineFs }}>
                {c.online ? '—' : 'off'}
              </div>
            )}
            <div className="ovl-text" style={{ minWidth: 0 }}
              title={[
                c.characterName,
                c.cloneName ? `clone name: ${c.cloneName}${c.cloneIsCustom ? ' (yours)' : ''}` : null,
                alert ? '⚠ this clone is flagged in the setup window (Alt+\\)' : null,
                c.podName ? `pod name: ${c.podName}` : null,
                `ship: ${c.shipTypeName ?? '(unknown)'}${c.shipName ? ` — ${c.shipName}` : ''}`,
                '',
                c.cloneDetail ?? 'implants unavailable',
                '',
                c.cloneName
                  ? 'name matched from your named jump clones'
                  : c.cloneNamesAvailable === false
                    ? 'clone names need a re-login (Settings → EVE login) to grant the clone-read scope'
                    : 'name appears once this clone has been seen in the jump-clone list — i.e. after jumping out of it once',
                'clone updates within ~2 min of a swap (ESI caches implants 120s)',
              ].filter((x) => x !== null).join('\n')}>
              {/* 1 — THE POD. The pilot's own name where there is one; the
                  implant summary otherwise. */}
              <div className="ovl-line ovl-pod" style={{ fontSize: lineFs }}>
                {c.cloneName?.trim() || c.podName?.trim() || c.cloneLabel || '—'}
              </div>
              {/* 2 — WHERE, coloured by security band */}
              <div className="ovl-line" style={{ fontSize: lineFs, color: secColor(c.systemSec, c.systemId) }}>
                {c.systemName ?? '—'}
                {/* a wormhole's -0.99 tells the pilot nothing; the class does */}
                {isWormhole(c.systemId)
                  ? <span className="ovl-sec"> J-space</span>
                  : c.systemSec !== null && c.systemSec !== undefined && (
                    <span className="ovl-sec"> {c.systemSec.toFixed(1)}</span>
                  )}
              </div>
              {/* 3 — WHAT they are flying */}
              <div className="ovl-line ovl-hull" style={{ fontSize: lineFs }}
                title={c.shipTypeName ? `hull: ${c.shipTypeName}` : undefined}>
                {c.error
                  ? c.error
                  : stale
                    ? `⚠ no update for ${ageS < 3600 ? `${Math.round(ageS / 60)}m` : `${Math.round(ageS / 3600)}h`}`
                    : shipLabel(c)}
              </div>
            </div>
            {edit && (['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
              <span key={corner} className={`ovl-handle ovl-${corner}`} onMouseDown={start(c.characterId, corner)} />
            ))}
          </div>
        );
      })}
      {notice && (() => {
        const npos = layout.pos[NOTICE_ID] ?? { x: DEFAULT_POS.x, y: 8 };
        const nw = Math.max(240, layout.size.w * 1.15);
        const color = notice.kind === 'api-down' ? '#ff5b5b' : notice.kind === 'ratelimit' ? '#ffb347' : '#4da3ff';
        return (
          <div className="ovl-box ovl-notice"
            style={{ left: npos.x, top: npos.y, width: nw, minHeight: 44,
              ['--alert' as string]: color } as React.CSSProperties}
            onMouseDown={start(NOTICE_ID, 'move')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color }}>
                {notice.kind === 'api-down' ? '⚠ EVE API problem'
                  : notice.kind === 'ratelimit' ? '⏳ EVE rate limit'
                    : '⚠ EVE login (SSO) issue'}
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.45, color: '#e6e9ef' }}>{notice.text}</div>
            </div>
          </div>
        );
      })()}
      {pi.length > 0 && (() => {
        const ppos = layout.pos[PI_ID] ?? { x: DEFAULT_POS.x, y: 120 };
        const pw = Math.max(240, layout.size.w * 1.15);
        return (
          <div className="ovl-box ovl-notice"
            style={{ left: ppos.x, top: ppos.y, width: pw, minHeight: 40,
              ['--alert' as string]: '#d06a4a' } as React.CSSProperties}
            onMouseDown={start(PI_ID, 'move')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '7px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#d06a4a' }}>
                🪐 planets need you
              </div>
              {pi.map((a, i) => (
                <div key={i} style={{ fontSize: 12, lineHeight: 1.4, color: '#e6e9ef', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <b style={{ color: a.sev === 0 ? '#ff8a8a' : '#ffb46b' }}>{a.planetName}</b>
                  <span style={{ color: '#9aa0aa' }}>{a.charName}</span>
                  <span style={{ color: a.sev === 0 ? '#ff8a8a' : '#e6e9ef' }}>{a.text}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      {raids.length > 0 && (() => {
        const rpos = layout.pos[RAID_ID] ?? { x: DEFAULT_POS.x, y: 64 };
        const rw = Math.max(240, layout.size.w * 1.15);
        return (
          <div className="ovl-box ovl-notice"
            style={{ left: rpos.x, top: rpos.y, width: rw, minHeight: 44,
              ['--alert' as string]: '#ff9d3d' } as React.CSSProperties}
            onMouseDown={start(RAID_ID, 'move')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, padding: '7px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#ff9d3d' }}>
                🎯 raidable skyhook{raids.length === 1 ? '' : 's'} near you
              </div>
              {raids.slice(0, 6).map((r) => (
                <div key={r.planetId} style={{ fontSize: 12, lineHeight: 1.4, color: '#e6e9ef', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <b style={{ color: r.state === 'open' ? '#ffd24d' : '#c3c2b7' }}>{r.systemName}</b>
                  <span style={{ color: '#9aa0aa' }}>
                    {r.jumps}j{r.viaName && r.viaName !== r.systemName ? ` via ${r.viaName}` : r.jumps === 0 ? ' · on your map' : ''}
                  </span>
                  {r.planetType && <span style={{ color: r.planetType === 'Lava' ? '#ff9d3d' : '#7fc8ff' }}>{r.planetType}</span>}
                  <span style={{ color: r.state === 'open' ? '#7CFC00' : '#9aa0aa' }}>
                    {r.state === 'open' ? `open · ${r.minsLeft}m left` : `in ${r.minsLeft}m`}
                  </span>
                  {r.lastRaidDays !== null && r.lastRaidDays < 6 && (
                    <span style={{ color: '#ff6b6b' }} title="recently seen raided — good bar to read for calibration">
                      raided {r.lastRaidDays < 1 ? `${Math.round(r.lastRaidDays * 24)}h` : `${r.lastRaidDays.toFixed(1)}d`} ago
                    </span>
                  )}
                </div>
              ))}
              {raids.length > 6 && <div style={{ fontSize: 11, color: '#9aa0aa' }}>+{raids.length - 6} more…</div>}
            </div>
          </div>
        );
      })()}
      {/* TEMPLATE BOXES (edit mode only): the notice and raid boxes appear
          rarely, so without these they could never be POSITIONED until the
          moment they were already in the way. Same reserved layout ids, so
          dragging a template places the real box. */}
      {edit && !notice && (() => {
        const npos = layout.pos[NOTICE_ID] ?? { x: DEFAULT_POS.x, y: 8 };
        const nw = Math.max(240, layout.size.w * 1.15);
        return (
          <div className="ovl-box ovl-notice" style={{ left: npos.x, top: npos.y, width: nw, minHeight: 44, opacity: 0.65, ['--alert' as string]: '#8b949e' } as React.CSSProperties}
            onMouseDown={start(NOTICE_ID, 'move')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#8b949e' }}>⚠ notification box — template</div>
              <div style={{ fontSize: 12, lineHeight: 1.45, color: '#c9d1d9' }}>Drag me where API-problem notices should appear. Only shown in setup mode.</div>
            </div>
          </div>
        );
      })()}
      {edit && raids.length === 0 && (() => {
        const rpos = layout.pos[RAID_ID] ?? { x: DEFAULT_POS.x, y: 64 };
        const rw = Math.max(240, layout.size.w * 1.15);
        return (
          <div className="ovl-box ovl-notice" style={{ left: rpos.x, top: rpos.y, width: rw, minHeight: 44, opacity: 0.65, ['--alert' as string]: '#8b949e' } as React.CSSProperties}
            onMouseDown={start(RAID_ID, 'move')}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '7px 10px' }}>
              <div style={{ fontSize: 12, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#8b949e' }}>🎯 raid alert — template</div>
              <div style={{ fontSize: 12, lineHeight: 1.45, color: '#c9d1d9' }}>Drag me where nearby-raidable-skyhook alerts should appear. Only shown in setup mode.</div>
            </div>
          </div>
        );
      })()}
      {chars.length === 0 && edit && (
        // nobody logged in = nothing to show; the placeholder only appears
        // in edit mode so an idle overlay never clutters the screen
        <div className="ovl-box ovl-empty" style={{ left: DEFAULT_POS.x, top: DEFAULT_POS.y }}>
          <div className="ovl-text">
            <div className="ovl-name" style={{ fontSize: 13 }}>EVE Conductor overlay</div>
            <div className="ovl-sub" style={{ fontSize: 11 }}>no characters online — boxes appear when they log in</div>
          </div>
        </div>
      )}
    </div>
  );
}
