// EVE SKILL & FIT CONDUCTOR — module 2 of the suite.
//   · Skill Match: two characters side by side, what each must train to match the other
//   · Fit Skill Maxer: pick/paste a ship fit — every skill the hull/modules
//     REQUIRE or that BOOSTS them (CCP dogma data), tiered, with per-character
//     fitting stats from the dogma engine and copyable skill plans
// Skills & implants AUTO-RESYNC while this module is open (the fit tools
// feed on them — stale skills were mistaken for wrong recommendations).
import { useEffect, useMemo, useState } from 'react';
import { useAuth, type CharAccount } from '../lib/auth';
import { useApp } from '../lib/store';
import { syncSkills, resyncSkillsAndImplants } from '../lib/esiChar';
import { getType } from '../lib/typedb';
import {
  parseFit, relevantForFit, TIER_LABEL,
  type SkillRelevance, type RelevanceTier,
} from '../lib/skillRelevance';
import { fitAttributeSets, DOGMA_ENGINE_LICENSE } from '../lib/dogmaStats';
import { loadTeamFits, type TeamFitCatalog, type TeamFit } from '../lib/teamFits';
import Tip from './Tip';
import FitStatsPanel from './FitStatsPanel';
import FitWizard from './FitWizard';
import FitLibrary from './FitLibrary';
import BattleSim from './BattleSim';

const ROMAN = ['0', 'I', 'II', 'III', 'IV', 'V'];
const lvl = (n: number | undefined) => ROMAN[Math.max(0, Math.min(5, n ?? 0))];
const levelOf = (c: CharAccount, skillId: number): number => c.skills?.[skillId] ?? 0;

interface Gap {
  skillId: number;
  name: string;
  mine: number;
  theirs: number;
}

/** the skills THIS character must train to match the other */
function gapsToMatch(mine: Record<number, number> | null, theirs: Record<number, number> | null): Gap[] {
  if (!mine || !theirs) return [];
  const out: Gap[] = [];
  for (const [idStr, theirLvl] of Object.entries(theirs)) {
    const id = Number(idStr);
    const myLvl = mine[id] ?? 0;
    if (theirLvl > myLvl) {
      out.push({ skillId: id, name: getType(id)?.name ?? `Skill #${id}`, mine: myLvl, theirs: theirLvl });
    }
  }
  return out.sort((a, b) => (b.theirs - b.mine) - (a.theirs - a.mine) || a.name.localeCompare(b.name));
}

function CompareColumn({ c, other }: { c: CharAccount; other: CharAccount }) {
  const [syncing, setSyncing] = useState(false);
  const [syncingOther, setSyncingOther] = useState(false);
  const gaps = gapsToMatch(c.skills, other.skills);
  const known = c.skills ? Object.keys(c.skills).length : 0;
  return (
    <div className="compare-col">
      <div className="compare-head">
        <img src={`https://images.evetech.net/characters/${c.characterId}/portrait?size=128`} alt="" />
        <div>
          <div className="compare-name">{c.characterName}</div>
          <div className="dim" style={{ fontSize: 12 }}>
            {known > 0 ? `${known} skills known` : 'skills not synced'}
          </div>
        </div>
      </div>
      {!c.skills ? (
        <div className="empty">
          Skills haven't been synced for this character yet.
          <div style={{ marginTop: 8 }}>
            <button className="btn" disabled={syncing}
              onClick={() => {
                setSyncing(true);
                void syncSkills(c.characterId).finally(() => setSyncing(false));
              }}>
              {syncing ? 'syncing…' : '⟳ sync skills now'}
            </button>
          </div>
        </div>
      ) : !other.skills ? (
        // NO comparison happened — saying "nothing to train" here would be a
        // false positive (integrity gate: no answer beats a misleading one)
        <div className="empty">
          Can't compare — {other.characterName}'s skills haven't been synced yet.
          <div style={{ marginTop: 8 }}>
            <button className="btn" disabled={syncingOther}
              onClick={() => {
                setSyncingOther(true);
                void syncSkills(other.characterId).finally(() => setSyncingOther(false));
              }}>
              {syncingOther ? 'syncing…' : `⟳ sync ${other.characterName}'s skills`}
            </button>
          </div>
        </div>
      ) : gaps.length === 0 ? (
        <div className="empty">
          Nothing to train — {c.characterName} matches or exceeds {other.characterName} in every skill they have.
        </div>
      ) : (
        <>
          <div className="hint" style={{ marginTop: 0 }}>
            To match {other.characterName}, {c.characterName} needs {gaps.length} skill{gaps.length === 1 ? '' : 's'} trained
            (biggest deficits first):
          </div>
          <table className="data">
            <thead>
              <tr>
                <th>Skill</th>
                <th><Tip tip="This character's current level.">Now</Tip></th>
                <th><Tip tip="The other character's level — the target.">Target</Tip></th>
                <th><Tip tip="Levels missing.">Gap</Tip></th>
              </tr>
            </thead>
            <tbody>
              {gaps.map((g) => (
                <tr key={g.skillId}>
                  <td className="hub-name">{g.name}</td>
                  <td className="dim">{lvl(g.mine)}</td>
                  <td>{lvl(g.theirs)}</td>
                  <td className={g.theirs - g.mine >= 3 ? 'neg' : 'dim'}>+{g.theirs - g.mine}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

/**
 * A character's level, plus how far BEHIND they are — at a glance.
 *
 * Two deficits, in the user's order:
 *   (+X) vs BEST — the level that maxes this fit out
 *   (+X) vs the best of the SELECTED characters for this skill
 * Nothing is shown when they are level with or above the mark, so the eye
 * only lands on what is actually missing.
 */
function LevelCell({ c, skillId, need, best, peak }: {
  c: CharAccount; skillId: number; need?: number;
  /** the Best-column level for this skill */
  best?: number;
  /** the highest level any selected character has for this skill */
  peak?: number;
}) {
  if (!c.skills) return <td className="dim" title="skills not synced — Settings → character → Sync">?</td>;
  const l = levelOf(c, skillId);
  const cls = need && l < need ? 'neg' : l === 0 ? 'dim' : l >= 5 ? 'pos' : '';
  const vsBest = best !== undefined && best > l ? best - l : 0;
  const vsPeak = peak !== undefined && peak > l ? peak - l : 0;
  return (
    <td className={cls}>
      {lvl(l)}
      {vsBest > 0 && <span className="gap-vs" title={`${vsBest} level(s) below Best (${lvl(best!)})`}> (+{vsBest})</span>}
      {vsPeak > 0 && <span className="gap-vs" title={`${vsPeak} level(s) below the best selected character (${lvl(peak!)})`}> (+{vsPeak})</span>}
    </td>
  );
}

const TIER_ORDER: RelevanceTier[] = [1, 2, 3, 4];

/** the level that maxes the fit out: V for any skill that IMPROVES it
 * (trait/boost/fit-wide); for pure prerequisites just the required level —
 * training past it does nothing for THIS fit */
const bestLevel = (r: SkillRelevance): number => (r.boosts.length > 0 ? 5 : r.requiredLevel);

/** copies 'Skill Name N' lines — the format EVE's training-queue
 * "Add skills listed in clipboard" import accepts */
function CopyPlanButton({ id, copied, onCopy, lines, tip, disabled }: {
  id: string;
  copied: string | null;
  onCopy: (id: string, lines: string[]) => void;
  lines: () => string[];
  tip: string;
  disabled?: boolean;
}) {
  return (
    <button className="btn mini" style={{ marginLeft: 6 }} disabled={disabled} title={tip}
      onClick={() => onCopy(id, lines())}>
      {copied === id ? '✓' : '⧉'}
    </button>
  );
}

function FitView({ chars }: { chars: CharAccount[] }) {
  const { fitText, fitChar, fitSource } = useApp((s) => s.charCompare);
  const setCompare = useApp((s) => s.setCharCompare);
  const allCharacters = useAuth((s) => s.characters);
  const [showFitWide, setShowFitWide] = useState(false);
  const [catalog, setCatalog] = useState<TeamFitCatalog | null>(null);
  const [loadingFits, setLoadingFits] = useState(false);
  // a persisted filter pointing at a logged-out character would render a
  // BLANK select silently filtering everything out — fall back to All
  const charFilter =
    fitChar && allCharacters.some((c) => String(c.characterId) === fitChar) ? fitChar : 'all';
  const sourceFilter = fitSource ?? 'all';

  const refreshFits = (force: boolean) => {
    setLoadingFits(true);
    loadTeamFits(force)
      .then(setCatalog)
      .finally(() => setLoadingFits(false));
  };
  useEffect(() => {
    refreshFits(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const shownFits = useMemo(() => {
    if (!catalog) return [];
    // ONE source must satisfy BOTH filters — two independent .some() calls
    // let a fit that Alice OWNS and Bob SAVED pass "Bob + owned", claiming
    // a provenance that exists for nobody
    return catalog.fits.filter((f) =>
      f.sources.some(
        (s) =>
          (charFilter === 'all' || String(s.charId) === charFilter) &&
          (sourceFilter === 'all' || s.kind === sourceFilter),
      ),
    );
  }, [catalog, charFilter, sourceFilter]);

  /** the name to display = the name used by a source that MATCHES the
   * filters (a merged duplicate can be called different things by different
   * characters; showing Alice's ship name as Bob's saved fit would lie) */
  const displayName = (f: TeamFit): string =>
    f.sources.find(
      (s) =>
        (charFilter === 'all' || String(s.charId) === charFilter) &&
        (sourceFilter === 'all' || s.kind === sourceFilter),
    )?.fitName ?? f.fitName;

  // provenance is shown whenever an 'all' filter makes the origin ambiguous
  const showProvenance = charFilter === 'all' || sourceFilter === 'all';
  const selectedKey = useMemo(
    () => shownFits.find((f) => f.eft === fitText)?.key ?? '',
    [shownFits, fitText],
  );

  const fit = useMemo(() => (fitText.trim() ? parseFit(fitText) : null), [fitText]);
  // attribute inventory of the fit (async, from the ESF bundle): with it,
  // "fit-wide" only lists skills whose modified attribute EXISTS in the fit.
  // 'failed' falls back to the unfiltered list rather than showing nothing.
  const [fitAttrs, setFitAttrs] = useState<Map<number, Set<number>> | 'loading' | 'failed'>('loading');
  useEffect(() => {
    let cancelled = false;
    if (!fit) return;
    setFitAttrs('loading');
    fitAttributeSets(fit)
      .then((s) => { if (!cancelled) setFitAttrs(s); })
      .catch(() => { if (!cancelled) setFitAttrs('failed'); });
    return () => { cancelled = true; };
  }, [fit]);
  const rel = useMemo(
    () => (fit && fitAttrs !== 'loading' ? relevantForFit(fit, fitAttrs === 'failed' ? undefined : fitAttrs) : []),
    [fit, fitAttrs],
  );
  const byTier = useMemo(() => {
    const m = new Map<RelevanceTier, SkillRelevance[]>();
    for (const r of rel) (m.get(r.tier) ?? m.set(r.tier, []).get(r.tier)!).push(r);
    return m;
  }, [rel]);

  const [copied, setCopied] = useState<string | null>(null);
  const copyPlan = (id: string, lines: string[]) => {
    void navigator.clipboard.writeText(lines.join('\n')).then(() => {
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    }).catch(() => {
      // clipboard write refused — nothing to mislead about, button just stays
    });
  };
  return (
    <>
      <div className="finder-form">
        <label title="Whose fits to list — 'all characters' pools everyone's, deduplicated.">
          <span>Character</span>
          <select value={charFilter} onChange={(e) => setCompare({ fitChar: e.target.value })}>
            <option value="all">All characters</option>
            {allCharacters.map((c) => (
              <option key={c.characterId} value={String(c.characterId)}>{c.characterName}</option>
            ))}
          </select>
        </label>
        <label title="Where the fit lives. SAVED = the in-game fitting manager (ESI). OWNED = ships assembled in your assets with modules actually fitted, under their ship name.">
          <span>Source</span>
          <select value={sourceFilter} onChange={(e) => setCompare({ fitSource: e.target.value })}>
            <option value="all">All sources</option>
            <option value="saved">Personal saved fits</option>
            <option value="owned">Owned ships</option>
          </select>
        </label>
        <label title="The fit to analyze — picking one runs the analysis below immediately.">
          <span>Fit{catalog ? ` (${shownFits.length})` : ''}</span>
          <select value={selectedKey} style={{ maxWidth: 340 }}
            onChange={(e) => {
              const f = shownFits.find((x) => x.key === e.target.value);
              if (f) setCompare({ fitText: f.eft });
            }}>
            <option value="" disabled>
              {loadingFits
                ? 'loading fits…'
                : selectedKey === '' && fit
                  ? `current: ${fit.shipName}${fit.fitName ? ` — ${fit.fitName}` : ''} (not in this list)`
                  : shownFits.length === 0
                    ? 'no fits found'
                    : '— pick a fit —'}
            </option>
            {shownFits.map((f) => (
              <option key={f.key} value={f.key}>
                {f.hullName} — {displayName(f)}
                {showProvenance ? ` [${f.sources.map((s) => `${s.charName} ${s.kind}`).join(', ')}]` : ''}
              </option>
            ))}
          </select>
        </label>
        <button className="btn" disabled={loadingFits} onClick={() => refreshFits(true)}
          title="Re-pull saved fittings and owned ships from ESI for every character.">
          {loadingFits ? 'loading…' : '⟳ refresh fits'}
        </button>
        <button className="btn"
          title={fitText.trim()
            ? `Current fit (EFT):\n\n${fitText.trim()}`
            : 'Reads an EFT fit from your clipboard and analyzes it (EVE: Fitting window → ≡ → Copy to Clipboard). After loading, hover here to see the fit text.'}
          onClick={() => {
            void navigator.clipboard.readText().then((t) => {
              if (t.trim()) setCompare({ fitText: t });
            }).catch(() => {
              // clipboard unreadable — leave the current fit untouched
            });
          }}>
          📋 use fit from clipboard
        </button>
      </div>
      {catalog && catalog.errors.length > 0 && (
        <div className="hint" style={{ marginTop: 0 }}>
          {catalog.errors.map((e) => <div key={e}>⚠ {e}</div>)}
        </div>
      )}
      {fit && (
        <>
          <div className="hint" style={{ marginTop: 0 }}>
            {fit.shipId !== null ? (
              <>
                <b>{fit.shipName}</b>{fit.fitName ? ` — ${fit.fitName}` : ''} · {fit.items.length} distinct
                item{fit.items.length === 1 ? '' : 's'} · {rel.length} relevant skill{rel.length === 1 ? '' : 's'}
              </>
            ) : (
              <>No hull recognized{fit.shipName ? ` (“${fit.shipName}”)` : ''} — paste the full fit including the [Hull, name] header.</>
            )}
            {fit.unresolved.length > 0 && (
              <span className="flag warn" style={{ marginLeft: 8 }}
                title={fit.unresolved.join('\n')}>
                ⚠ {fit.unresolved.length} line(s) not recognized — hover to see which
              </span>
            )}
            {fit.extraFits > 0 && (
              <span className="flag warn" style={{ marginLeft: 8 }}
                title="The paste contains more than one [Hull, name] fit. Merging them would produce a table that lies about both, so only the FIRST fit is analyzed.">
                ⚠ extra fit in the paste ignored — only the first is analyzed
              </span>
            )}
          </div>
          {fit.shipId !== null &&
            (fit.unresolved.length > 0 || fit.extraFits > 0 ? (
              // stats from a PARTIAL fit would show "fits fine" while the
              // unresolved module pushes it over CPU/PG in game — refuse
              <div className="hint" style={{ marginTop: 0 }}>
                ⚠ Fitting stats withheld: {fit.unresolved.length > 0 ? `${fit.unresolved.length} line(s) could not be resolved` : 'extra fit in the paste'} —
                numbers computed from a partial fit would be wrong. Fix the lines above (or re-run the type
                database build if this is a brand-new module) to get stats.
              </div>
            ) : (
              <FitStatsPanel fit={fit} chars={chars} />
            ))}
          {rel.length > 0 && (
            <table className="data">
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>
                    <Tip tip="The highest level any fit item demands (requirement chains included). '—' = nothing requires it; it only boosts.">Need</Tip>
                    <CopyPlanButton id="need" copied={copied} onCopy={copyPlan}
                      lines={() => rel.filter((r) => r.requiredLevel > 0).map((r) => `${r.skill.name} ${r.requiredLevel}`)}
                      tip="Copy the REQUIRED skills as 'Skill Name N' lines — in EVE: training queue ≡ → Add skills listed in clipboard." />
                  </th>
                  <th>
                    <Tip tip="The level that maxes this fit out: V for every skill that improves it (traits/boosts/fit-wide); for pure prerequisites, the required level — nothing past it helps THIS fit.">Best</Tip>
                    <CopyPlanButton id="best" copied={copied} onCopy={copyPlan}
                      lines={() => rel.filter((r) => bestLevel(r) > 0).map((r) => `${r.skill.name} ${bestLevel(r)}`)}
                      tip="Copy the ULTIMATE plan (every listed skill at its Best level, fit-wide tier included) as 'Skill Name N' lines for EVE's clipboard import." />
                  </th>
                  {chars.map((c) => (
                    <th key={c.characterId}>
                      {c.characterName}
                      {/* THE WHOLE BEST PLAN, for every character. EVE's
                          clipboard import skips levels already trained, so
                          sending the full plan is both simpler and safe —
                          filtering it per character only risked omitting
                          something the character actually still needs. */}
                      <CopyPlanButton id={`c${c.characterId}`} copied={copied} onCopy={copyPlan}
                        lines={() => rel.filter((r) => bestLevel(r) > 0).map((r) => `${r.skill.name} ${bestLevel(r)}`)}
                        tip={`Copy the FULL Best plan for ${c.characterName} — every listed skill at its Best level. EVE's 'Add skills listed in clipboard' ignores levels they already have, so nothing already trained is added.`} />
                    </th>
                  ))}
                  <th><Tip tip="What this skill does for THIS fit — requirements name the items that demand it; boosts come from CCP's dogma data (which attribute it improves and on which items) and the hull's own per-skill trait bonuses.">Matters because</Tip></th>
                </tr>
              </thead>
              <tbody>
                {TIER_ORDER.map((tier) => {
                  const rows = byTier.get(tier) ?? [];
                  if (rows.length === 0) return null;
                  const collapsed = tier === 4 && !showFitWide;
                  return [
                    <tr key={`h${tier}`}>
                      <td colSpan={4 + chars.length} style={{ fontWeight: 600, paddingTop: 10 }}>
                        {TIER_LABEL[tier]} ({rows.length})
                        {tier === 4 && (
                          <button className="btn mini" style={{ marginLeft: 8 }}
                            title="Skills that affect ANY ship/character (hull HP, capacitor, speed, …) — true for every fit, so they're tucked away by default."
                            onClick={() => setShowFitWide((v) => !v)}>
                            {showFitWide ? 'hide' : 'show'}
                          </button>
                        )}
                      </td>
                    </tr>,
                    ...(collapsed ? [] : rows.map((r) => (
                      <tr key={r.skill.id}>
                        <td className="hub-name" title={r.skill.desc}>{r.skill.name}</td>
                        <td>{r.requiredLevel > 0 ? lvl(r.requiredLevel) : <span className="dim">—</span>}</td>
                        <td title={r.boosts.length > 0 ? 'improves the fit — max it' : 'pure prerequisite — levels past the requirement do nothing for this fit'}>
                          {bestLevel(r) > 0 ? lvl(bestLevel(r)) : <span className="dim">—</span>}
                        </td>
                        {chars.map((c) => (
                          <LevelCell key={c.characterId} c={c} skillId={r.skill.id}
                            need={r.requiredLevel > 0 ? r.requiredLevel : undefined}
                            best={bestLevel(r) > 0 ? bestLevel(r) : undefined}
                            peak={Math.max(0, ...chars.map((x) => levelOf(x, r.skill.id)))} />
                        ))}
                        <td className="dim" style={{ fontSize: 12, maxWidth: 380 }}
                          title={[...r.requiredBy.map((x) => (x.startsWith('prerequisite of') ? x : `required by ${x}`)), ...r.boosts].join('\n')}>
                          {[...r.requiredBy.map((x) => (x.startsWith('prerequisite of') ? x : `required by ${x}`)), ...r.boosts].slice(0, 2).join(' · ')}
                          {r.requiredBy.length + r.boosts.length > 2 ? ' …' : ''}
                        </td>
                      </tr>
                    ))),
                  ];
                })}
              </tbody>
            </table>
          )}
          <div className="hint">
            Tiers: <b>required</b> = the fit cannot go on grid without it (red level = this character
            can't); <b>hull bonus</b> = the ship's own per-skill traits; <b>boosts this fit</b> = dogma
            says the skill improves one of THESE modules/charges; <b>fit-wide</b> = improves any ship
            (tank, cap, speed). Magnitudes aren't simulated — this answers WHICH and WHY, a fitting
            tool answers how much. A handful of internal-only effects with no in-game display name
            (the plumbing behind hull traits) are hidden; the trait rows state those in English.
            <details style={{ marginTop: 6 }}>
              <summary className="dim" style={{ cursor: 'pointer' }}>
                Fitting stats computed by the EVEShip.fit dogma engine (MIT) — license
              </summary>
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: 11 }}>{DOGMA_ENGINE_LICENSE}</pre>
            </details>
          </div>
        </>
      )}
    </>
  );
}

/** how stale a character's data may get while this module is OPEN before a
 * quiet auto-resync fires (ESI caches skills ~2 min; 5 min is respectful) */
const AUTO_RESYNC_MS = 5 * 60_000;

export default function CharacterConductor() {
  const characters = useAuth((s) => s.characters);
  const rawMode = useApp((s) => s.charCompare.mode);
  // 'topic' was removed in v53 — old persisted states land on Skill Match
  const mode: 'match' | 'fit' | 'wizard' | 'propagator' | 'battle' =
    rawMode === 'fit' ? 'fit'
      : rawMode === 'wizard' ? 'wizard'
        : rawMode === 'propagator' ? 'propagator'
          : rawMode === 'battle' ? 'battle'
            : 'match';
  const [selected, setSelected] = useState<number[]>([]);
  /** the Propagator locks the roster while a destructive plan is staged or
   * running — changing it mid-approval once meant deleting from a character
   * the backup did not cover */
  const [scopeLocked, setScopeLocked] = useState(false);

  // AUTO-RESYNC skills+implants while the module is open: check every
  // minute, refresh any character whose data is older than 5 minutes. The
  // fit tools feed on this — stale skills read as wrong recommendations.
  useEffect(() => {
    const busy = new Set<number>();
    const tick = () => {
      for (const c of useAuth.getState().characters) {
        if (busy.has(c.characterId)) continue;
        if ((c.lastSync ?? 0) > Date.now() - AUTO_RESYNC_MS) continue;
        busy.add(c.characterId);
        resyncSkillsAndImplants(c.characterId)
          .catch(() => {
            // expired session etc. — the statusbar already reports those
          })
          .finally(() => busy.delete(c.characterId));
      }
    };
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);

  const toggle = (id: number) =>
    setSelected((cur0) => {
      // prune ids of characters that were logged out since being picked —
      // a ghost id would eat the 2-slot replacement and desync the UI
      const cur = cur0.filter((x) => characters.some((c) => c.characterId === x));
      if (cur.includes(id)) return cur.filter((x) => x !== id);
      // the Propagator acts on MANY characters — and being able to aim it at
      // one character is how a nervous first run gets tested
      if (mode === 'propagator') return [...cur, id];
      if (cur.length >= 2) return [cur[1], id]; // keep the newest pick + this one
      return [...cur, id];
    });

  // entering the Propagator with nothing picked would show an empty tool;
  // start with everyone, which is also what the old behaviour did
  useEffect(() => {
    if (mode !== 'propagator') return;
    setSelected((cur) => (cur.length > 0 ? cur : characters.map((c) => c.characterId)));
  }, [mode, characters]);

  const picked = selected
    .map((id) => characters.find((c) => c.characterId === id))
    .filter((c): c is CharAccount => c !== undefined);
  const [a, b] = picked;

  // THE BATTLE SIM NEEDS NO LOGIN: pasted fits + the optimal/minimum pilot
  // profiles work from the bundled data alone. Gating it behind characters
  // hid the whole simulator from anyone not signed in — including the
  // automated UI tests, which is how the gate got noticed.
  if (characters.length === 0 && mode !== 'battle') {
    return (
      <div className="panel">
        <h2>Skill &amp; Fit Conductor</h2>
        <div className="empty">Log in with EVE (Settings → EVE login) to inspect characters.
          {' '}The <b>Battle Sim</b> tab works without login — pasted fits fly with
          optimal or bare-minimum pilots.</div>
      </div>
    );
  }

  return (
    // 'fill' + panel-flex belong to the PROPAGATOR, which manages its own
    // internal scrollers. Battle mode borrowed them in 0.87.0 and its panel
    // (overflow hidden under panel-flex) silently clipped 2,900px of cards,
    // map and charts with no way to scroll — caught by measuring
    // scrollHeight vs clientHeight in the rig, which "is the content
    // reachable" testing must always do (innerText sees through clipping).
    <div className={`char-conductor ${mode === 'propagator' ? 'fill' : ''}`}>
      {/* THE SIDEBAR IS FOR PICKING COMPARISON CHARACTERS — the Battle Sim
          picks its pilot per ship on each card, so in battle mode the aside
          only stole a column of width from the fight (caught by the browser
          rig: the whole sim was squeezed into a ~350px strip). */}
      {mode !== 'battle' && (
      <aside className="char-side">
        <div className="hint" style={{ margin: '0 0 8px' }}>
          {mode === 'match'
            ? 'Pick TWO characters to compare — a third pick replaces the older selection.'
            : mode === 'propagator'
              ? 'Tick the characters this tool may read AND write. Only these are scanned, backed up and changed — tick one to test safely.'
              : 'Pick one or two characters — their levels appear as columns.'}
        </div>
        {mode === 'propagator' && (
          <div className="char-side-allnone">
            <button className="btn mini" disabled={scopeLocked}
              onClick={() => setSelected(characters.map((c) => c.characterId))}>all</button>
            <button className="btn mini" disabled={scopeLocked} onClick={() => setSelected([])}>none</button>
            <span className="dim">{scopeLocked ? 'locked' : `${selected.length}/${characters.length}`}</span>
          </div>
        )}
        {characters.map((c) => (
          <button key={c.characterId}
            className={`char-side-row ${selected.includes(c.characterId) ? 'on' : ''}`}
            disabled={mode === 'propagator' && scopeLocked}
            title={mode === 'propagator' && scopeLocked ? 'locked while a push or restore is staged — cancel it to change the selection' : undefined}
            onClick={() => toggle(c.characterId)}>
            <img src={`https://images.evetech.net/characters/${c.characterId}/portrait?size=64`} alt="" />
            <span>
              <span className="char-side-name">{c.characterName}</span>
            </span>
            {selected.includes(c.characterId) && <span className="flag good">✓</span>}
          </button>
        ))}
      </aside>
      )}
      <div className={`panel ${mode === 'propagator' ? 'panel-flex' : ''}`} style={{ flex: 1 }}>
        <h2>
          {mode === 'match' ? (
            <Tip tip="Two characters side by side: each column lists exactly what THAT character must train to match the other.">Skill Match</Tip>
          ) : mode === 'fit' ? (
            <Tip tip="Pick a fit (or load one from the clipboard): every skill it requires or that boosts it — from CCP's own dogma data — with per-character fitting stats and copyable EVE skill plans.">Fit Skill Maxer</Tip>
          ) : mode === 'battle' ? (
            <Tip tip="A target and a team of attackers, every ship a real fit flown by a real pilot. Signature, speed, resistances and EHP all come from the dogma engine — nothing is typed in. Each ship can be flown by a character, by all-skills-V, or by exactly the prerequisites.">Battle Sim</Tip>
          ) : mode === 'propagator' ? (
            <Tip tip="Every character's PERSONAL saved fits, merged where the hull and fitting are identical. Clean up the names, inspect and compare fits, then push one list to every character.">Fit Propagator</Tip>
          ) : (
            <Tip tip="Build fits graphically with named variations (fork a core fit, tune each version). Fits live in the APP — no in-game size limits — with live per-character stats, EFT copy, and a full multibuy shopping list.">Fit Wizard</Tip>
          )}
          <span className="sub">
            skills &amp; implants auto-refresh every ~5 min while this module is open
          </span>
        </h2>
        {mode === 'battle' ? (
          <BattleSim />
        ) : mode === 'propagator' ? (
          <FitLibrary characterIds={picked.map((c) => c.characterId)} onLockChange={setScopeLocked} />
        ) : mode === 'match' ? (
          !a || !b ? (
            <div className="empty">Select two characters on the left to compare their skills.</div>
          ) : (
            <div className="compare-grid">
              <CompareColumn c={a} other={b} />
              <CompareColumn c={b} other={a} />
            </div>
          )
        ) : mode === 'wizard' ? (
          <FitWizard chars={picked} />
        ) : picked.length === 0 ? (
          <div className="empty">Select at least one character on the left.</div>
        ) : (
          <FitView chars={picked} />
        )}
      </div>
    </div>
  );
}
