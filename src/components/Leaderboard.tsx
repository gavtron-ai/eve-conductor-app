// CORP LEADERBOARD (v0.208.0; rebuilt wide in v0.210.0) — Battle Conductor → Leaderboard. Everyone
// in the corp who is on a public killmail in the window: a medals table, 25 boards in five groups,
// a card for every pilot, head to head, a hall of fame and the corp's days. Built ONLY from public
// killmails, so every pilot is measured with the same ruler (lib/leaderboard.ts has the rules; its
// fixtures pin them). Light, competitive, and honest about what a killmail cannot see.
import { useEffect, useMemo, useState } from 'react';
import {
  BOARDS, BOARD_GROUPS, SHIP_CLASS_LABEL, WINDOWS, beforeIsHeld, coverSpan, coverageCells, dateSpan, fmtBoardValue, medalTable, monthSpan, monthsHeld, pilotStats, rankBoard, rankMoves, windowSpan,
  type BoardInput, type BoardSpec, type PilotStats,
} from '../lib/leaderboard';
import { boardText, corpDays, hallOfFame, pilotProfile, type Record1 } from '../lib/leaderboardExtras';
import { HISTORY_MONTHS, inputFor, openBoard, resolveBoardNames, resumeHistory, stopHistory, useBoard, type BoardData } from '../lib/leaderboardData';
import { agoShort } from '../lib/homeDigests';
import { iskShort } from '../lib/format';
import { getType } from '../lib/typedb';
import { logUser } from '../lib/devlog';
import { Hist24 } from './DashKit';

const face = (id: number, size = 64) => `https://images.evetech.net/characters/${id}/portrait?size=${size}`;
const render = (id: number) => `https://images.evetech.net/types/${id}/render?size=64`;
const hullName = (id: number) => getType(id)?.name ?? (id === 670 || id === 33328 ? 'Capsule' : id ? `type ${id}` : '—');
const MEDAL = ['🥇', '🥈', '🥉'];
const WINDOW_KEY = 'etc-board-window', PAGE_KEY = 'etc-board-page';
const TOP = 5;
const date = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const openUrl = (url: string) => window.open(url, '_blank');
type Page = 'boards' | 'everyone' | 'records' | 'duel';
interface Ctx { data: BoardData; mine: Set<number>; nameOf: (id: number) => string; open: (char: number) => void }

function Pilot({ id, ctx, big }: { id: number; ctx: Ctx; big?: boolean }) {
  const mine = ctx.mine.has(id);
  return (
    <button className={`lb-pilot${mine ? ' mine' : ''}${big ? ' big' : ''}`} title={`${ctx.nameOf(id)} — open the pilot’s card${mine ? ' (one of yours)' : ''}`} onClick={(e) => { e.stopPropagation(); ctx.open(id); }}>
      <img src={face(id)} alt="" loading="lazy" /><span>{ctx.nameOf(id)}</span>{mine && <i>★</i>}
    </button>
  );
}
const Move = ({ d }: { d: number | null | undefined }) => (d === undefined ? null : d === null ? <span className="lb-move new" title="not on the medals table in the window before">new</span>
  : d > 0 ? <span className="lb-move up" title={`up ${d} place${d === 1 ? '' : 's'} on the window before`}>▲{d}</span>
    : d < 0 ? <span className="lb-move down" title={`down ${-d} place${d === -1 ? '' : 's'} on the window before`}>▼{-d}</span> : <span className="lb-move" title="same place as the window before">＝</span>);

function BoardCard({ spec, stats, ctx }: { spec: BoardSpec; stats: PilotStats[]; ctx: Ctx }) {
  const [all, setAll] = useState(false);
  const rows = useMemo(() => rankBoard(stats, spec), [stats, spec]);
  if (rows.length === 0) return null;
  // the top five, plus the player's own best pilot when he is further down — a board is more fun with yourself on it
  const shown = all ? rows : rows.slice(0, TOP);
  const myBest = all ? null : rows.slice(TOP).find((r) => ctx.mine.has(r.char)) ?? null;
  return (
    <section className={`lb-card${spec.honour ? '' : ' spoon'}`}>
      <header title={spec.blurb}><span className="lb-card-icon">{spec.icon}</span><div><h3>{spec.title} <i className="lb-nick">{spec.nick}</i></h3><p>{spec.blurb}</p></div></header>
      <ol>
        {shown.map((r) => (
          <li key={r.char} className={ctx.mine.has(r.char) ? 'mine' : ''}>
            <span className="lb-rank">{spec.honour && r.rank <= 3 ? MEDAL[r.rank - 1] : r.rank}</span><Pilot id={r.char} ctx={ctx} /><b>{fmtBoardValue(r.value, spec.unit, iskShort)}</b>
          </li>
        ))}
        {myBest && <li className="mine gap"><span className="lb-rank">{myBest.rank}</span><Pilot id={myBest.char} ctx={ctx} /><b>{fmtBoardValue(myBest.value, spec.unit, iskShort)}</b></li>}
      </ol>
      {rows.length > TOP && <button className="lb-more" onClick={() => setAll((a) => !a)}>{all ? 'top five' : `all ${rows.length}`}</button>}
    </section>
  );
}

// ---- a pilot's card
function PilotCard({ char, inp, ctx, move, onClose, onDuel }: { char: number; inp: BoardInput; ctx: Ctx; move: number | null | undefined; onClose: () => void; onDuel: (char: number) => void }) {
  const p = useMemo(() => pilotProfile(inp, char, 14), [inp, char]);
  const [names, setNames] = useState<Map<number, string> | null>(null);
  useEffect(() => { const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey); }, [onClose]);
  // the outsiders in his story are named on demand — public ESI, only when a card is opened
  useEffect(() => { const ids = [p?.nemesis?.char, p?.prey?.char].filter((x): x is number => !!x); if (ids.length > 0) void resolveBoardNames(ids).then((m) => setNames(new Map(m))); }, [p]);
  if (!p) return null;
  const s = p.stats;
  const who = (id: number) => names?.get(id) ?? ctx.data.names.get(id) ?? `pilot ${id}`;
  const classTotal = p.classes.reduce((t, c) => t + c.uses, 0);
  const now = Date.now();
  return (
    <div className="overlay" onClick={onClose}>
      <div className="lb-profile" onClick={(e) => e.stopPropagation()}>
        <header>
          <a className="zk-pic" href={`https://zkillboard.com/character/${char}/`} title={`${ctx.nameOf(char)} on zKillboard`} onClick={(e) => { e.preventDefault(); openUrl(`https://zkillboard.com/character/${char}/`); }}>
            <img src={face(char, 128)} alt="" width={84} height={84} style={{ borderRadius: 10, display: 'block' }} /><span className="zk-badge">zKill ↗</span>
          </a>
          <div className="lb-profile-title">
            <h2>{ctx.nameOf(char)}{ctx.mine.has(char) && <i> ★ yours</i>}</h2>
            <div className="lb-profile-medals">{p.medal ? <><b>#{p.medal.rank}</b> on the medals table · {p.medal.points} pts <span>{p.medal.gold > 0 && `🥇${p.medal.gold} `}{p.medal.silver > 0 && `🥈${p.medal.silver} `}{p.medal.bronze > 0 && `🥉${p.medal.bronze}`}</span> <Move d={move} /></> : 'no medal in this window'}</div>
            <div className="dim" style={{ fontSize: 12 }}>usually in a <b style={{ color: 'var(--ink-2)' }}>{hullName(s.hull)}</b>{s.hulls > 1 ? ` · ${s.hulls} hulls flown` : ''} · last seen on a killmail {agoShort(now - s.lastT)}</div>
          </div>
          <span style={{ flex: 1 }} />
          <button className="btn mini" onClick={() => onDuel(char)} title="put this pilot in the head-to-head">⚔ head to head</button>
          <button className="btn mini" onClick={onClose}>✕</button>
        </header>
        <div className="lb-profile-tiles">
          {[[`${s.kills} – ${s.losses}`, 'kills – losses'], [iskShort(s.iskShare), 'ISK destroyed (by share)'], [s.iskLost ? iskShort(s.iskLost) : '0', 'ISK lost'], [String(s.finalBlows), 'final blows'],
            [String(s.fights), `fights · ${s.fightsClean} without a loss`], [String(s.streak), 'best kill streak'], [String(s.assists), 'assists (no damage)'], [String(s.days), 'days active']].map(([big, sub]) => (
            <div key={sub}><b>{big}</b><span>{sub}</span></div>
          ))}
        </div>
        <div className="lb-profile-cols">
          <section>
            <h4>Where he stands</h4>
            <div className="lb-places">
              {p.places.map((pl) => { const b = BOARDS.find((x) => x.id === pl.id)!; return (
                <span key={pl.id} className={pl.rank <= 3 && b.honour ? 'podium' : ''} title={`${b.title}: ${b.blurb}`}>{b.honour && pl.rank <= 3 ? MEDAL[pl.rank - 1] : `#${pl.rank}`} {b.icon} {b.title} <i>{fmtBoardValue(pl.value, b.unit, iskShort)}</i></span>
              ); })}
            </div>
            <h4>When he is on a killmail <span className="dim">by EVE hour</span></h4>
            <div style={{ height: 70, display: 'flex' }}><Hist24 hours={p.hours} color="var(--accent)" peak={p.hours.indexOf(Math.max(...p.hours))} /></div>
            <h4>The people in his story</h4>
            <div className="lb-people">
              {p.buddy && <button onClick={() => ctx.open(p.buddy!.char)} title="the corp mate on the most of his kills — open their card"><img src={face(p.buddy.char)} alt="" /><span><b>{ctx.nameOf(p.buddy.char)}</b><i>wingman · {p.buddy.n} shared kill{p.buddy.n === 1 ? '' : 's'}</i></span></button>}
              {p.nemesis && <button onClick={() => openUrl(`https://zkillboard.com/character/${p.nemesis!.char}/`)} title="the outsider on the most of his losses — opens zKillboard"><img src={face(p.nemesis.char)} alt="" /><span><b>{who(p.nemesis.char)}</b><i className="bad">nemesis · on {p.nemesis.n} of his losses</i></span></button>}
              {p.prey && <button onClick={() => openUrl(`https://zkillboard.com/character/${p.prey!.char}/`)} title="the pilot he has killed the most — opens zKillboard"><img src={face(p.prey.char)} alt="" /><span><b>{who(p.prey.char)}</b><i className="good">favourite prey · killed {p.prey.n}×</i></span></button>}
              {!p.buddy && !p.nemesis && !p.prey && <span className="dim">nobody yet</span>}
            </div>
          </section>
          <section>
            <h4>What he flies</h4>
            {classTotal > 0 && (
              <div className="lb-classbar" title={p.classes.map((c) => `${SHIP_CLASS_LABEL[c.cls]} ${c.uses}`).join(' · ')}>
                {p.classes.map((c) => <i key={c.cls} className={`cls-${c.cls}`} style={{ flexGrow: c.uses }}>{c.uses / classTotal >= 0.18 ? SHIP_CLASS_LABEL[c.cls] : ''}</i>)}
              </div>
            )}
            <div className="lb-hulls">
              {p.hulls.slice(0, 6).map((h) => <div key={h.ship} title={`${hullName(h.ship)} — on ${h.uses} killmail(s), lost ${h.lost}`}><img src={render(h.ship)} alt="" /><span>{hullName(h.ship)}</span><b>{h.uses}</b>{h.lost > 0 && <i>{h.lost} lost</i>}</div>)}
            </div>
            <h4>His killmails <span className="dim">newest first — click for zKillboard</span></h4>
            <div className="lb-mails">
              {p.recent.map((m) => (
                <button key={m.id} onClick={() => openUrl(`https://zkillboard.com/kill/${m.id}/`)} title={m.kind === 'kill' ? `killed a ${hullName(m.ship)} flying a ${hullName(m.flew)} — ${m.dmg.toLocaleString()} damage${m.fb ? ', the final blow' : ''}` : `lost a ${hullName(m.ship)}`}>
                  <img src={render(m.ship)} alt="" /><span>{hullName(m.ship)}</span>
                  <i className="dim">{m.kind === 'kill' ? `${m.dmg > 0 ? fmtBoardValue(m.dmg, 'dmg', iskShort) : 'assist'}${m.fb ? ' · final blow' : ''}` : 'lost'}</i>
                  <i className="dim">{agoShort(now - m.t).replace(' ago', '')}</i>
                  <b className={m.kind === 'kill' ? 'good' : 'bad'}>{m.kind === 'kill' ? '+' : '−'}{m.value ? iskShort(m.value) : '?'}</b>
                </button>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

// ---- head to head
const DUEL: { key: keyof PilotStats | 'biggest' | 'maxHit'; label: string; unit: 'n' | 'isk' | 'dmg'; lowWins?: boolean }[] = [
  { key: 'kills', label: 'kills', unit: 'n' }, { key: 'finalBlows', label: 'final blows', unit: 'n' }, { key: 'topDamage', label: 'top damage', unit: 'n' }, { key: 'solo', label: 'solo kills', unit: 'n' },
  { key: 'damage', label: 'damage dealt', unit: 'dmg' }, { key: 'maxHit', label: 'biggest hit', unit: 'dmg' }, { key: 'iskShare', label: 'ISK destroyed (by share)', unit: 'isk' }, { key: 'biggest', label: 'biggest kill', unit: 'isk' },
  { key: 'fights', label: 'fights attended', unit: 'n' }, { key: 'fightsClean', label: '…without a loss', unit: 'n' }, { key: 'streak', label: 'best kill streak', unit: 'n' }, { key: 'assists', label: 'assists', unit: 'n' },
  { key: 'days', label: 'days active', unit: 'n' }, { key: 'mates', label: 'wingmen', unit: 'n' }, { key: 'losses', label: 'losses', unit: 'n', lowWins: true }, { key: 'iskLost', label: 'ISK lost', unit: 'isk', lowWins: true },
];
const duelValue = (s: PilotStats | undefined, key: (typeof DUEL)[number]['key']): number => (!s ? 0 : key === 'biggest' ? s.biggest?.value ?? 0 : key === 'maxHit' ? s.maxHit?.dmg ?? 0 : (s[key] as number));
function HeadToHead({ stats, ctx, pair, setPair }: { stats: PilotStats[]; ctx: Ctx; pair: [number, number]; setPair: (p: [number, number]) => void }) {
  const sorted = useMemo(() => [...stats].sort((a, b) => ctx.nameOf(a.char).localeCompare(ctx.nameOf(b.char))), [stats, ctx]);
  const [a, b] = [stats.find((s) => s.char === pair[0]), stats.find((s) => s.char === pair[1])];
  let wa = 0, wb = 0;
  const rows = DUEL.map((d) => { const x = duelValue(a, d.key), y = duelValue(b, d.key); const win = x === y ? 0 : (x > y) !== !!d.lowWins ? 1 : 2; if (win === 1) wa++; if (win === 2) wb++; return { d, x, y, win }; });
  const pick = (i: 0 | 1) => (
    <select value={pair[i]} onChange={(e) => setPair(i === 0 ? [Number(e.target.value), pair[1]] : [pair[0], Number(e.target.value)])}>
      {sorted.map((s) => <option key={s.char} value={s.char}>{ctx.nameOf(s.char)}{ctx.mine.has(s.char) ? ' ★' : ''}</option>)}
    </select>
  );
  return (
    <section className="lb-duel">
      <div className="lb-duel-head">
        <div className="l">{a && <img src={face(a.char, 128)} alt="" onClick={() => ctx.open(a.char)} />}{pick(0)}<b className={wa > wb ? 'win' : ''}>{wa}</b></div>
        <span className="vs">vs</span>
        <div className="r"><b className={wb > wa ? 'win' : ''}>{wb}</b>{pick(1)}{b && <img src={face(b.char, 128)} alt="" onClick={() => ctx.open(b.char)} />}</div>
      </div>
      {rows.map(({ d, x, y, win }) => {
        const max = Math.max(x, y, 1);
        const fmt = (v: number) => (d.unit === 'n' ? String(v) : v ? fmtBoardValue(v, d.unit, iskShort) : '0');
        return (
          <div key={d.key} className="lb-duel-row">
            <b className={win === 1 ? 'win' : ''}>{fmt(x)}</b>
            <span className="bar l"><i style={{ width: `${(x / max) * 100}%` }} className={win === 1 ? 'win' : ''} /></span>
            <span className="what">{d.label}{d.lowWins ? ' ↓' : ''}</span>
            <span className="bar r"><i style={{ width: `${(y / max) * 100}%` }} className={win === 2 ? 'win' : ''} /></span>
            <b className={win === 2 ? 'win' : ''}>{fmt(y)}</b>
          </div>
        );
      })}
      <p className="dim" style={{ fontSize: 11.5, margin: '10px 0 0' }}>The score counts the rows each pilot wins; ↓ = fewer is better. Same public killmails, same window, for both — and still blind to logistics, boosts and scouting.</p>
    </section>
  );
}

// ---- the hall of fame + the corp's days
function Records({ inp, ctx, now }: { inp: BoardInput; ctx: Ctx; now: number }) {
  const h = useMemo(() => hallOfFame(inp), [inp]);
  const days = useMemo(() => corpDays(inp, now), [inp, now]);
  const max = Math.max(1, ...days.map((d) => Math.max(d.kills, d.losses)));
  const rec = (icon: string, title: string, r: Record1 | null, value: string, extra?: string) => (
    <div className="lb-record" onClick={r?.mail ? () => openUrl(`https://zkillboard.com/kill/${r.mail}/`) : undefined} style={r?.mail ? { cursor: 'pointer' } : undefined} title={r?.mail ? 'open the killmail on zKillboard' : undefined}>
      <span className="ico">{icon}</span>
      <div><h4>{title}</h4><b>{r ? value : '—'}</b>{extra && r && <i>{extra}</i>}
        <div className="who">{r?.chars.slice(0, 6).map((c) => <Pilot key={c} id={c} ctx={ctx} />)}{r && r.chars.length > 6 && <span className="dim">+{r.chars.length - 6}</span>}</div></div>
      {r?.ship ? <img className="ship" src={render(r.ship)} alt="" title={hullName(r.ship)} /> : null}
    </div>
  );
  return (
    <>
      <div className="lb-records">
        {rec('🐋', 'Biggest kill', h.biggestKill, iskShort(h.biggestKill?.value ?? 0), h.biggestKill?.ship ? hullName(h.biggestKill.ship) : undefined)}
        {rec('💎', 'Biggest loss', h.biggestLoss, iskShort(h.biggestLoss?.value ?? 0), h.biggestLoss?.ship ? hullName(h.biggestLoss.ship) : undefined)}
        {rec('🧨', 'Hardest single hit', h.hardestHit, fmtBoardValue(h.hardestHit?.value ?? 0, 'dmg', iskShort), h.hardestHit?.ship ? `on a ${hullName(h.hardestHit.ship)}` : undefined)}
        {rec('🔥', 'Longest kill streak', h.longestStreak, `${h.longestStreak?.value ?? 0} in a row`)}
        {rec('⚔', 'Most kills in one fight', h.mostKillsInFight, `${h.mostKillsInFight?.value ?? 0} kills`)}
        <div className="lb-record"><span className="ico">📅</span><div><h4>Busiest day</h4><b>{h.busiestDay ? `${h.busiestDay.value} kills` : '—'}</b>{h.busiestDay && <i>{h.busiestDay.day}</i>}</div></div>
        <div className="lb-record"><span className="ico">🛡</span><div><h4>Biggest turnout</h4><b>{h.biggestFight ? `${h.biggestFight.pilots} pilots` : '—'}</b>{h.biggestFight && <i>{h.biggestFight.kills} kills, {h.biggestFight.losses} losses · {date(h.biggestFight.startT)}</i>}</div></div>
      </div>
      {days.length > 1 && (
        <section className="panel" style={{ marginTop: 14 }}>
          <div className="panel-title">The corp’s {days[0].bucket === 'day' ? 'days' : days[0].bucket === 'week' ? 'weeks' : 'months'} — kills above the line, losses below{days[0].bucket !== 'day' ? ` · one bar per ${days[0].bucket}` : ''}</div>
          <div className="lb-days">
            {days.map((d) => (
              <div key={d.day} className="lb-day" title={`${d.bucket === 'day' ? '' : `${d.bucket} of `}${d.day} — ${d.kills} kill(s) for ${iskShort(d.destroyed)}, ${d.losses} loss(es) for ${iskShort(d.lost)}, ${d.pilots} pilot(s) out`}>
                <span className="up"><i style={{ height: `${(d.kills / max) * 100}%` }} /></span>
                <span className="down"><i style={{ height: `${(d.losses / max) * 100}%` }} /></span>
              </div>
            ))}
          </div>
          <div className="lb-days-axis"><span>{days[0].day}</span><span>{days[days.length - 1].day}</span></div>
        </section>
      )}
    </>
  );
}

type Col = 'name' | 'kills' | 'finalBlows' | 'topDamage' | 'solo' | 'assists' | 'damage' | 'iskShare' | 'iskOn' | 'losses' | 'iskLost' | 'pods' | 'fights' | 'fightsClean' | 'streak' | 'days';
const COLS: [Col, string, string][] = [
  ['name', 'Pilot', ''], ['kills', 'Kills', 'killmails the pilot is on'], ['finalBlows', 'Final', 'final blows'], ['topDamage', 'Top dmg', 'kills where the pilot did the most damage of anyone on the mail'],
  ['solo', 'Solo', 'kills with no other player on the mail'], ['assists', 'Assist', 'kills the pilot is on without a point of damage — tackle and EWAR'], ['damage', 'Damage', 'damage dealt on kills'],
  ['iskShare', 'ISK by share', 'each kill’s value × the pilot’s share of the damage on it'], ['iskOn', 'ISK on mails', 'the full value of every kill the pilot is on — the killboard way'],
  ['losses', 'Losses', ''], ['iskLost', 'ISK lost', ''], ['pods', 'Pods', 'capsules lost'], ['fights', 'Fights', 'fights the pilot is on a killmail for, either side'], ['fightsClean', 'No loss', 'of those, fights without losing a ship'],
  ['streak', 'Streak', 'the longest run of kills with no loss in between'], ['days', 'Days', 'EVE days with a killmail'],
];

export default function Leaderboard() {
  // the data is LIVE from the one archive in memory (lib/leaderboardData): what is on disk shows at
  // once, the newest lists refresh by themselves, and the history fills in by itself in the background
  const { data, busy, error, job } = useBoard();
  useEffect(() => { logUser('leaderboard: open', {}); void openBoard(); }, []);
  const [win, setWin] = useState<string>(() => { try { return localStorage.getItem(WINDOW_KEY) ?? '7'; } catch { return '7'; } });
  const [page, setPage] = useState<Page>(() => { try { return (localStorage.getItem(PAGE_KEY) as Page) || 'boards'; } catch { return 'boards'; } });
  const [sort, setSort] = useState<{ col: Col; dir: 1 | -1 }>({ col: 'kills', dir: -1 });
  const [find, setFind] = useState('');
  const [card, setCard] = useState<number | null>(null);
  const [pair, setPair] = useState<[number, number]>([0, 0]);
  const [copied, setCopied] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(t); }, []);
  useEffect(() => { try { localStorage.setItem(WINDOW_KEY, win); localStorage.setItem(PAGE_KEY, page); } catch { /* nicety */ } }, [win, page]);

  // the minute, not the millisecond: a rolling window must not recompute 25 boards on every tick
  const minute = Math.floor(now / 60_000) * 60_000;
  // the window: a preset ("7"), any month held ("m:2026-05") or any two dates ("c:2026-05-03:2026-05-09")
  const { span, before, label: winLabel } = useMemo(() => {
    if (win.startsWith('m:')) { const r = monthSpan(win.slice(2)); if (r) return { ...r, label: win.slice(2) }; }
    if (win.startsWith('c:')) { const [, a, b] = win.split(':'); const r = dateSpan(a ?? '', b ?? '', minute); if (r) return { ...r, label: `${a} → ${b || 'now'}` }; }
    const spec = WINDOWS.find((w) => w.id === win) ?? WINDOWS[2];
    return { ...windowSpan(spec, minute), label: spec.label };
  }, [win, minute]);
  const months = useMemo(() => (data ? monthsHeld(data.mails, data.heldSince) : []), [data]);
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const cov = useMemo(() => coverSpan(data?.heldSince ?? null, span.since), [data, span.since]);
  const empty = !!data && span.until !== null && cov.since !== null && cov.since >= span.until;
  const inp = useMemo<BoardInput | null>(() => (data ? inputFor(data, cov.since, span.until) : null), [data, cov.since, span.until]);
  // WHAT IS HELD, month by month — and which of it this view is looking at
  const cells = useMemo(() => (data ? coverageCells({ counts: data.counts, whole: data.months, completeSince: data.heldSince, now: minute, monthsBack: HISTORY_MONTHS, reading: job.running ? job.month : null, view: { since: cov.since, until: span.until } }) : []), [data, minute, job.running, job.month, cov.since, span.until]);
  const stats = useMemo(() => (inp && !empty ? pilotStats(inp) : []), [inp, empty]);
  const medals = useMemo(() => medalTable(stats), [stats]);
  // the window before — compared with only when it is held WHOLE, or an arrow would be a guess
  const canCompare = !cov.short && beforeIsHeld(data?.heldSince ?? null, before);
  const moves = useMemo(() => (inp && before && canCompare ? rankMoves(medals, medalTable(pilotStats(inputFor(data!, before.since, before.until)))) : null), [inp, before, canCompare, medals]);
  const inWindow = useMemo(() => (data ? data.mails.filter((m) => (cov.since === null || m.t >= cov.since) && (span.until === null || m.t < span.until)).length : 0), [data, cov.since, span.until]);
  const mine = useMemo(() => new Set(data?.myChars ?? []), [data]);
  const nameOf = (id: number) => data?.names.get(id) ?? `pilot ${id}`;
  const ctx = useMemo<Ctx | null>(() => (data ? { data, mine, nameOf: (id) => data.names.get(id) ?? `pilot ${id}`, open: (c) => { logUser('leaderboard: pilot card', {}); setCard(c); } } : null), [data, mine]);
  const needle = find.trim().toLowerCase();
  const shownStats = useMemo(() => (needle ? stats.filter((s) => nameOf(s.char).toLowerCase().includes(needle)) : stats), [stats, needle, data]); // eslint-disable-line react-hooks/exhaustive-deps
  const table = useMemo(() => {
    const val = (s: PilotStats): number | string => (sort.col === 'name' ? nameOf(s.char).toLowerCase() : (s[sort.col] as number));
    return [...shownStats].sort((a, b) => { const x = val(a), y = val(b); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir || a.char - b.char; });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownStats, sort, data]);
  // head to head starts as: your best pilot against the leader (or the two leaders)
  useEffect(() => {
    if (medals.length === 0 || (stats.some((s) => s.char === pair[0]) && stats.some((s) => s.char === pair[1]))) return;
    const me = medals.find((m) => mine.has(m.char))?.char ?? medals[0].char;
    const other = medals.find((m) => m.char !== me)?.char ?? me;
    setPair([me, other]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [medals]);
  const copy = async () => {
    if (!data) return;
    const text = boardText({ corpName: data.corpName, window: winLabel, since: cov.since, stats, nameOf, isk: iskShort, fmt: (v, u) => fmtBoardValue(v, u, iskShort) });
    try { await navigator.clipboard.writeText(text); setCopied('copied — paste it in chat'); } catch { setCopied('the clipboard refused'); }
    logUser('leaderboard: copied for chat', { pilots: stats.length });
    window.setTimeout(() => setCopied(''), 3500);
  };

  return (
    <div className="lb">
      <div className="lb-bar">
        <h2>🏆 {data?.corpName ? `${data.corpName} — ` : ''}Leaderboard</h2>
        <span className="lb-windows">{WINDOWS.map((w) => <button key={w.id} className={`btn mini${w.id === win ? ' on primary' : ''}`} onClick={() => setWin(w.id)} title={w.month !== undefined ? 'an EVE calendar month — a season' : w.year !== undefined ? 'since 1 January, EVE time' : undefined}>{w.label}</button>)}</span>
        <span style={{ flex: 1 }} />
        {copied && <span className="dim" style={{ fontSize: 12 }}>{copied}</span>}
        <button className="btn mini" disabled={stats.length === 0} onClick={() => void copy()} title="the medals and every board’s winner as plain text, for the corp’s chat">📋 copy for chat</button>
        <button className="btn mini" disabled={busy} onClick={() => void openBoard(true)} title="read the corp’s newest kills and losses again (two requests) — zKillboard caches them for up to an hour. The history fills in by itself.">{busy ? <span className="spin">⟳</span> : '⟳'} refresh</button>
      </div>
      <div className="lb-when">
        <label title="any EVE calendar month the app holds killmails for">month
          <select value={win.startsWith('m:') ? win.slice(2) : ''} onChange={(e) => { if (e.target.value) setWin(`m:${e.target.value}`); }}>
            <option value="">pick…</option>{months.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label title="any two EVE dates, both included; leave the second empty for ‘up to now’">from <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label>to <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <button className={`btn mini${win.startsWith('c:') ? ' on primary' : ''}`} disabled={!from} onClick={() => setWin(`c:${from}:${to}`)}>show these dates</button>
      </div>
      {data && (
        <div className="lb-cover" title="what the app holds of your corporation's public killmails, month by month — the same for every page below">
          <span className="lb-cover-label">held</span>
          <div className="lb-cover-cells">
            {cells.map((c) => (
              <button key={c.ym} className={`lb-cell ${c.state}${c.inView ? ' view' : ''}`} onClick={() => setWin(`m:${c.ym}`)}
                title={`${c.ym} — ${c.mails.toLocaleString()} killmail${c.mails === 1 ? '' : 's'} held · ${c.state === 'whole' ? 'the whole month' : c.state === 'current' ? 'this month, to date' : c.state === 'partial' ? 'only part of it (not yet read whole)' : c.state === 'reading' ? 'being read right now' : 'nothing yet'}${c.inView ? ' · in the range on screen' : ''} — click to show this month`}>
                <i style={{ height: `${Math.max(c.mails > 0 ? 12 : 0, Math.round((c.mails / Math.max(1, ...cells.map((x) => x.mails))) * 100))}%` }} />
                <span>{c.ym.slice(5) === '01' ? c.ym.slice(2, 4) : c.ym.slice(5)}</span>
              </button>
            ))}
          </div>
          <span className="lb-cover-info">
            <b>{data.mails.length.toLocaleString()}</b> killmails · {data.heldSince ? <>complete from <b>{date(data.heldSince)}</b></> : 'reading…'}
            {job.running ? (
              <span className="lb-hist"> · <span className="spin">⟳</span> filling in {job.month} ({job.monthsDone + 1}/{job.monthsTotal}) <button className="lb-link" onClick={stopHistory} title="pause the background history read; it picks up where it stopped">pause</button></span>
            ) : job.note ? (
              <span className="warn"> · {job.note} <button className="lb-link" onClick={resumeHistory}>resume</button></span>
            ) : cells.every((c) => c.state === 'whole' || c.state === 'current') ? <span className="ok"> · ✓ two years held</span> : null}
          </span>
          <span className="lb-cover-key"><i className="whole" />whole month <i className="current" />this month <i className="partial" />part <i className="none" />not yet <i className="view" />on screen</span>
        </div>
      )}
      <div className="lb-note">
        {data ? (<>
          <b>{stats.length}</b> pilot{stats.length === 1 ? '' : 's'} on <b>{inWindow}</b> public killmail{inWindow === 1 ? '' : 's'}
          {cov.since !== null && !empty && <> · {span.until !== null ? <>from <b>{date(cov.since)}</b> to <b>{date(span.until - 1)}</b></> : <>since <b>{date(cov.since)}</b></>}</>}
          {cov.short && !empty && <span className="warn"> · ⚠ SHORTENED: the killmails held are only complete from {date(cov.since!)}, so this view starts there — for everyone alike{job.running ? '. The history is still filling in; it will widen by itself.' : ''}</span>}
          {!cov.short && !empty && !cov.unknown && <span className="ok"> · ✓ every killmail in this range is held</span>}
          {cov.unknown && <span className="dim"> · checking what is complete…</span>}
          {empty && <span className="warn"> · nothing held reaches back into this range yet{job.running ? ' — the history is still filling in' : ''}</span>}
          {data.unpriced > 0 && <span className="warn"> · {data.unpriced} killmail{data.unpriced === 1 ? ' has' : 's have'} no price yet: ISK boards are a floor</span>}
          <span className="dim"> · {moves ? 'arrows compare with the span before' : 'no arrows: the span before is not held whole'} · newest read {agoShort(now - data.at)}</span>
        </>) : busy ? 'Reading the corp’s public killmails…' : ''}
        {error && <span className="err"> {error}</span>}
      </div>
      <div className="lb-fair">
        Everyone is measured with the same ruler: <b>public killmails only</b> — nothing from your own logs or wallet. A killmail never sees logistics, boosts or scouts, for anyone, and tackle only as an <b>assist</b>; this is a bit of fun, not a performance review.
      </div>
      <div className="lb-pages" title="every page below shows the same range and the same killmails">
        {([['boards', '🏅 Boards'], ['everyone', '📋 Everyone'], ['records', '🏛 Hall of fame'], ['duel', '⚔ Head to head']] as [Page, string][]).map(([id, label]) => <button key={id} className={page === id ? 'on' : ''} onClick={() => setPage(id)}>{label}</button>)}
        <span style={{ flex: 1 }} />
        {(page === 'boards' || page === 'everyone') && <input className="lb-find" placeholder="find a pilot…" value={find} onChange={(e) => setFind(e.target.value)} />}
      </div>

      {data && stats.length === 0 && !busy && <div className="empty">No corp pilot is on a killmail in this window.</div>}
      {ctx && inp && stats.length > 0 && (<>
        {page === 'boards' && (<>
          <section className="lb-medals">
            <header><h3>🏅 Medals table</h3><p>gold 3 · silver 2 · bronze 1, over the {BOARDS.filter((b) => b.honour).length} honour boards below — ties all get the medal</p></header>
            <ol>
              {medals.filter((m) => !needle || nameOf(m.char).toLowerCase().includes(needle)).slice(0, needle ? 50 : 12).map((m) => (
                <li key={m.char} className={mine.has(m.char) ? 'mine' : ''}>
                  <span className="lb-rank">{m.rank}</span><Pilot id={m.char} ctx={ctx} />
                  <Move d={moves ? moves.get(m.char) : undefined} />
                  <span className="lb-tally">{m.gold > 0 && <span>🥇{m.gold}</span>}{m.silver > 0 && <span>🥈{m.silver}</span>}{m.bronze > 0 && <span>🥉{m.bronze}</span>}</span>
                  <b>{m.points} pts</b>
                </li>
              ))}
            </ol>
          </section>
          {BOARD_GROUPS.map((g) => {
            const cards = BOARDS.filter((b) => b.group === g.id && rankBoard(shownStats, b).length > 0);
            if (cards.length === 0) return null;
            return (
              <div key={g.id}>
                <h3 className="lb-group">{g.title} <span>{g.blurb}</span></h3>
                <div className="lb-grid">{cards.map((b) => <BoardCard key={b.id} spec={b} stats={shownStats} ctx={ctx} />)}</div>
              </div>
            );
          })}
        </>)}
        {page === 'everyone' && (
          <section className="panel">
            <div className="panel-title">Everyone — {table.length} pilot{table.length === 1 ? '' : 's'} with a killmail in the window · click a name for the pilot’s card</div>
            <div style={{ overflowX: 'auto' }}>
              <table className="lb-table">
                <thead><tr>{COLS.map(([c, label, tip]) => (
                  <th key={c} title={tip} className={c === 'name' ? 'l' : ''} onClick={() => setSort((s) => (s.col === c ? { col: c, dir: s.dir === 1 ? -1 : 1 } : { col: c, dir: c === 'name' ? 1 : -1 }))}>
                    {label}{sort.col === c ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}</th>))}<th className="l" title="the hull the pilot is on the most killmails in">Usual hull</th></tr></thead>
                <tbody>
                  {table.map((s) => (
                    <tr key={s.char} className={mine.has(s.char) ? 'mine' : ''}>
                      <td className="l"><Pilot id={s.char} ctx={ctx} /></td>
                      <td>{s.kills}</td><td>{s.finalBlows}</td><td>{s.topDamage}</td><td>{s.solo}</td><td>{s.assists}</td><td>{fmtBoardValue(s.damage, 'dmg', iskShort)}</td>
                      <td>{iskShort(s.iskShare)}</td><td>{iskShort(s.iskOn)}</td><td>{s.losses}</td><td>{s.iskLost ? iskShort(s.iskLost) : '0'}</td><td>{s.pods}</td><td>{s.fights}</td><td>{s.fightsClean}</td><td>{s.streak}</td><td>{s.days}</td>
                      <td className="l dim">{s.hull ? hullName(s.hull) : '—'}{s.hulls > 1 ? ` +${s.hulls - 1}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
        {page === 'records' && <Records inp={inp} ctx={ctx} now={now} />}
        {page === 'duel' && <HeadToHead stats={stats} ctx={ctx} pair={pair} setPair={setPair} />}
        {card !== null && <PilotCard char={card} inp={inp} ctx={ctx} move={moves ? moves.get(card) : undefined} onClose={() => setCard(null)} onDuel={(c) => { setPair([c, pair[0] === c ? pair[1] : pair[0] || pair[1]]); setCard(null); setPage('duel'); }} />}
      </>)}
    </div>
  );
}
