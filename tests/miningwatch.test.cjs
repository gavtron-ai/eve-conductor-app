// MINING WATCH (v0.202) — the pure model behind the overlay's ⛏ box.
// Every expectation below was worked out BY HAND from the rules in
// src/lib/miningWatch.ts before the code ran: period from the events,
// anchored 4-period windows, two missed slots held for the reaction delay
// = reduced, a period (never under 30 s) plus the delay of silence =
// stopped, and the crew / dock / move / reship suppressions.
//
// Most blocks run with a 120-s delay (the figures were worked out at that
// setting); block 12 covers the shipped 30-s default and the other knobs.

const W = require('./sim/lib/miningWatch.js');

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.error(`FAIL ${label}\n  got:  ${JSON.stringify(got)}\n  want: ${JSON.stringify(want)}`); }
};

const S = 1000;
const A = 1001, B = 1002;
/** bursts: `modules` events at each of start, start+period, … (count of them) */
const bursts = (start, period, count, modules = 1) => {
  const out = [];
  for (let i = 0; i < count; i++) for (let m = 0; m < modules; m++) out.push(start + i * period);
  return out;
};
const samples = (charId, name, times) => times.map((t) => ({ charId, charName: name, t }));
const loc = (over = {}) => ({ online: true, docked: false, systemId: 30000142, shipTypeId: 22544, ...over });
const locs = (m) => new Map(Object.entries(m).map(([k, v]) => [Number(k), v]));
const kinds = (alerts) => alerts.map((a) => `${a.charId}:${a.kind}`);
/** the knobs most blocks assume: a 120-s reaction delay, ¾ drop, 15-min keep */
const OPTS = { delayMs: 120 * S, dropRatio: 0.75, keepStoppedMs: 900 * S };
const upd = (st, s, L, now, o = OPTS) => W.updateWatch(st, s, L, now, o);

// ---- 1. PERIOD ESTIMATION ------------------------------------------------
{
  // two synced strip miners: 10 bursts of 2 at 0,180,…,1620 s — period 180 s
  eq('P1 synced pair → 180 s', W.estimatePeriod(bursts(0, 180 * S, 10, 2), 1700 * S), 180 * S);
  // one 45-s laser
  eq('P2 single 45 s laser → 45 s', W.estimatePeriod(bursts(0, 45 * S, 21), 950 * S), 45 * S);
  // too little history
  eq('P3 three events → null', W.estimatePeriod(bursts(0, 180 * S, 3), 400 * S), null);
  // an UNEVEN stagger (second module 60 s behind) still reads the true 180:
  // lag 60 s and lag 120 s each satisfy only half the events
  const staggered = [...bursts(0, 180 * S, 10), ...bursts(60 * S, 180 * S, 10)].sort((a, b) => a - b);
  eq('P4 uneven stagger → 180 s', W.estimatePeriod(staggered, 1800 * S), 180 * S);
  // the documented coincidence: an EXACTLY even stagger reads as half
  const even = [...bursts(0, 180 * S, 10), ...bursts(90 * S, 180 * S, 10)].sort((a, b) => a - b);
  eq('P5 exactly even stagger → 90 s (documented)', W.estimatePeriod(even, 1800 * S), 90 * S);
  // a 137.7-s cycle logged at whole seconds: 0,138,275,413,551,689,826,964,1102.
  // Lags 136…139 all qualify within the ±2 s tolerance (140 misses 138→275
  // by 3 s); the plateau's centre 137.5 rounds to 138
  const frac = [0, 138, 275, 413, 551, 689, 826, 964, 1102].map((t) => t * S);
  eq('P6 137.7 s cycle at 1-s log resolution → 138 s', W.estimatePeriod(frac, 1200 * S), 138 * S);
  // the run the last event belongs to
  eq('P8 run start walks back over ≤ period gaps only', W.runStart([0, 180 * S, 360 * S, 900 * S, 1080 * S], 180 * S), 900 * S);
  // the anchored window for 180 s: 4·180 − 6 = 714 s
  eq('P7 window for 180 s = 714 s', W.windowFor(180 * S), 714 * S);
  // the owner's real cadence (2026-09-08, one character): pairs every ~15 s
  // with a retarget hiccup about once a minute — at the true lag only 0.85
  // of events have a successor, which the 0.8 bar accepts (0.9 did not)
  // the owner's cadence, idealised: a pair of lines (t, t+1) every 15 s for
  // 20 cycles, two cycles skipped for retargets (90 and 195). At lags
  // 13…17 the events before each skipped cycle miss (4 of 34 evaluable =
  // 0.88 ≥ 0.8); lag 12 and lag 18 catch only one line of each pair (0.44).
  // Plateau 13…17 → 15 s. The 90th-percentile gap is 14 s, so lags past
  // 28 s are not tried.
  const pairs = [];
  for (let k = 0; k < 20; k++) { if (k === 6 || k === 13) continue; pairs.push(k * 15 * S, k * 15 * S + 1000); }
  eq('P9 real cadence with retarget hiccups → 15 s', W.estimatePeriod(pairs, 300 * S), 15 * S);
  // a stream with no rhythm at all — every gap different, no two pair
  // differences alike — gets no period (and none of the lags beyond twice
  // its 90th-percentile gap, 130 s, is even tried)
  const noisy = [0, 20, 45, 76, 114, 160, 215, 280].map((t) => t * S);
  eq('P10 an aperiodic stream gets no period', W.estimatePeriod(noisy, 300 * S), null);
}

// ---- 2. STEADY STATE: two miners, nothing to say ---------------------------
// A: 2 strips, bursts at 0…1620 (10 bursts). B: 1 laser, 45 s, 0…1620.
{
  const st0 = W.emptyWatch();
  const now = 1630 * S;
  const { state, alerts } = upd(st0,
    [...samples(A, 'Alpha', bursts(0, 180 * S, 10, 2)), ...samples(B, 'Bravo', bursts(0, 45 * S, 37))],
    locs({ [A]: loc(), [B]: loc({ shipTypeId: 32880 }) }), now);
  eq('S1 no alerts', alerts, []);
  const a = state.miners.find((m) => m.charId === A), b = state.miners.find((m) => m.charId === B);
  // A's window (906, 1620]: bursts 1080,1260,1440,1620 × 2 modules = 8
  eq('S2 A cur = 8, peak = 8, ok', [a.cur, a.peak, a.status, a.period], [8, 8, 'ok', 180 * S]);
  // B's window (1446, 1620]: 1485,1530,1575,1620 = 4
  eq('S3 B cur = 4, peak = 4, ok', [b.cur, b.peak, b.status, b.period], [4, 4, 'ok', 45 * S]);
  eq('S4 nobody quiet, no crew move', [a.quiet, b.quiet, state.fleet.fleetMove], [false, false, false]);
  eq('S5 home recorded from the location', [a.homeSystemId, a.homeShipTypeId], [30000142, 22544]);
}

// ---- 3. ONE OF A'S TWO STRIPS STOPS (crystal gone) -------------------------
// After the 1620 burst only module 1 keeps going: 1800, 1980, 2160…; B runs on.
{
  const L = locs({ [A]: loc(), [B]: loc({ shipTypeId: 32880 }) });
  let st = upd(W.emptyWatch(),
    [...samples(A, 'Alpha', bursts(0, 180 * S, 10, 2)), ...samples(B, 'Bravo', bursts(0, 45 * S, 37))], L, 1630 * S).state;
  // first missed slot: window (1086, 1800] = 1260×2,1440×2,1620×2,1800×1 = 7 → only one short → ok
  let r = upd(st, [...samples(A, 'Alpha', [1800 * S]), ...samples(B, 'Bravo', bursts(1665 * S, 45 * S, 4))], L, 1810 * S);
  st = r.state;
  eq('R1 one missed slot: cur 7 of 8, still ok, no alert', [st.miners[0].cur, st.miners[0].status, r.alerts], [7, 'ok', []]);
  // second missed slot: window (1266, 1980] = 1440×2,1620×2,1800,1980 = 6 = peak − 2 = 0.75·peak
  // → the shortfall starts its two-minute hold; nothing shown yet
  r = upd(st, [...samples(A, 'Alpha', [1980 * S]), ...samples(B, 'Bravo', bursts(1845 * S, 45 * S, 4))], L, 1990 * S);
  st = r.state;
  eq('R2 two missed slots: shortfall seen, hold running, not shown yet', [st.miners[0].cur, st.miners[0].status, st.miners[0].reducedSince, r.alerts],
    [6, 'reduced', 1990 * S, []]);
  // the module is back for the 2160 burst: window (1446, 2160] = 1620×2,1800,1980,2160×2 = 6 → shortfall still there,
  // and the hold (120 s from 1990) is over: shown, since = 1990 + 120 = 2110
  r = upd(st, [...samples(A, 'Alpha', [2160 * S, 2160 * S]), ...samples(B, 'Bravo', bursts(2025 * S, 45 * S, 4))], L, 2170 * S);
  st = r.state;
  eq('R3 hold over: shown, since = first seen + 2 min', [st.miners[0].cur, r.alerts], [6, [{ charId: A, charName: 'Alpha', kind: 'reduced', since: 2110 * S }]]);
  // 2340: (1626, 2340] = 1800,1980,2160×2,2340×2 = 6 → reduced, same since; 2520: (1806, 2520] = 1980,2160×2,2340×2,2520×2 = 7 → ok
  r = upd(st, [...samples(A, 'Alpha', [2340 * S, 2340 * S]), ...samples(B, 'Bravo', bursts(2205 * S, 45 * S, 4))], L, 2350 * S);
  st = r.state;
  eq('R4 two cycles back: still reduced, since unchanged', [st.miners[0].cur, kinds(r.alerts), r.alerts[0].since], [6, [`${A}:reduced`], 2110 * S]);
  r = upd(st, [...samples(A, 'Alpha', [2520 * S, 2520 * S]), ...samples(B, 'Bravo', bursts(2385 * S, 45 * S, 4))], L, 2530 * S);
  st = r.state;
  eq('R5 three cycles back: ok, alert cleared', [st.miners[0].cur, st.miners[0].status, r.alerts], [7, 'ok', []]);
}

// ---- 4. A CRYSTAL SWAP (one missed slot, then back) stays silent ------------
{
  const L = locs({ [A]: loc() });
  let st = upd(W.emptyWatch(), samples(A, 'Alpha', bursts(0, 180 * S, 10, 2)), L, 1630 * S).state;
  st = upd(st, samples(A, 'Alpha', [1800 * S]), L, 1810 * S).state;
  // (1266, 1980] = 1440×2,1620×2,1800,1980×2 = 7 → ok
  const r = upd(st, samples(A, 'Alpha', [1980 * S, 1980 * S]), L, 1990 * S);
  eq('C1 swap = one missed slot: no alert', [r.state.miners[0].cur, r.state.miners[0].status, r.alerts], [7, 'ok', []]);
}

// ---- 5. A STOPS OUTRIGHT (full hold) WHILE B KEEPS GOING --------------------
{
  const L = locs({ [A]: loc(), [B]: loc({ shipTypeId: 32880 }) });
  let st = upd(W.emptyWatch(),
    [...samples(A, 'Alpha', bursts(0, 180 * S, 10, 2)), ...samples(B, 'Bravo', bursts(0, 45 * S, 37))], L, 1630 * S).state;
  // B keeps mining every 45 s. Stopped needs silence > a period (182 with
  // tolerance) + the 120-s delay = 302 s after A's last (1620): not at 1922, yes at 1923.
  let r = upd(st, samples(B, 'Bravo', bursts(1665 * S, 45 * S, 6)), L, 1922 * S);
  st = r.state;
  eq('F1 at 302 s of silence: A quiet, not yet stopped, no alert', [st.miners[0].quiet, st.miners[0].status, r.alerts], [true, 'ok', []]);
  r = upd(st, [], L, 1923 * S);
  st = r.state;
  eq('F2 at 303 s: A stopped, alert (B still mining, so no crew move)', [st.miners[0].status, st.fleet.fleetMove, r.alerts],
    ['stopped', false, [{ charId: A, charName: 'Alpha', kind: 'stopped', since: 1923 * S }]]);
  // it persists with the same since while B keeps cycling (B's last at 2295, 5 s before now)…
  r = upd(st, samples(B, 'Bravo', bursts(1935 * S, 45 * S, 9)), L, 2300 * S);
  st = r.state;
  eq('F3 still stopped later, same since', r.alerts.map((a) => [a.kind, a.since]), [['stopped', 1923 * S]]);
  // …and leaves the screen 15 min after it was raised (1923 + 900 = 2823): shown at 2823, gone at 2824
  r = upd(st, samples(B, 'Bravo', bursts(2340 * S, 45 * S, 11)), L, 2823 * S);
  st = r.state;
  eq('F4 shown at exactly 15 min (B at 2790 still cycling)', kinds(r.alerts), [`${A}:stopped`]);
  r = upd(st, [], L, 2824 * S);
  st = r.state;
  eq('F5 muted after 15 min, state remembers the raise', [r.alerts, st.miners[0].alertSince], [[], 1923 * S]);
}

// ---- 6. THE WHOLE CREW STOPS TOGETHER (a move): silence -------------------
{
  const L = locs({ [A]: loc(), [B]: loc({ shipTypeId: 32880 }) });
  let st = upd(W.emptyWatch(),
    [...samples(A, 'Alpha', bursts(0, 180 * S, 10, 2)), ...samples(B, 'Bravo', bursts(0, 45 * S, 37))], L, 1630 * S).state;
  // both last mined at 1620. A quiet from 1802, B from 1667 → span 135 s ≤ 180 → a crew move
  let r = upd(st, [], L, 2073 * S);
  st = r.state;
  eq('M1 both stopped, went quiet together: crew move, no alert',
    [st.miners[0].status, st.miners[1].status, st.fleet.fleetMove, r.alerts], ['stopped', 'stopped', true, []]);
  // B resumes at 2100 (one event); A does not. The move ended at this evaluation (2110)…
  r = upd(st, samples(B, 'Bravo', [2100 * S]), L, 2110 * S);
  st = r.state;
  eq('M2 B resumes: move over, A within grace (2·180 s), no alert', [st.fleet.fleetMove, st.fleet.moveEndedAt, r.alerts], [false, 2110 * S, []]);
  // …grace runs while now < 2110 + 2·180 = 2470: silent at 2469, named at 2470
  r = upd(st, samples(B, 'Bravo', bursts(2145 * S, 45 * S, 8)), L, 2469 * S);
  st = r.state;
  eq('M3 inside grace: still nothing', r.alerts, []);
  r = upd(st, [], L, 2470 * S);
  st = r.state;
  eq('M4 grace over: A named', r.alerts, [{ charId: A, charName: 'Alpha', kind: 'stopped', since: 2470 * S }]);
  // B's first cycle back must not read as a rate drop either: its window at
  // 2100 held one event against a peak of 4, but the run was brand new
  eq('M5 the resumer is not called reduced on its first cycle', st.miners[1].status, 'ok');
}

// ---- 7. NOT TOGETHER: A stops, B stops 5 minutes later — both named -------
{
  const L = locs({ [A]: loc(), [B]: loc({ shipTypeId: 32880 }) });
  let st = upd(W.emptyWatch(),
    [...samples(A, 'Alpha', bursts(0, 180 * S, 10, 2)), ...samples(B, 'Bravo', bursts(0, 45 * S, 37))], L, 1630 * S).state;
  // B mines on until 2115 (1665 + 10·45), then stops too. At 2120 A is
  // named (B's last cycle is 5 s old)…
  let r = upd(st, samples(B, 'Bravo', bursts(1665 * S, 45 * S, 11)), L, 2120 * S);
  st = r.state;
  eq('N1 B still cycling: A named', [st.fleet.fleetMove, kinds(r.alerts)], [false, [`${A}:stopped`]]);
  // …but at 2600 nobody has completed a cycle within a period (A gap 980,
  // B gap 485): the whole crew is stopped, so neither is named — the CEO's
  // rule, whatever the order they stopped in
  r = upd(st, [], L, 2600 * S);
  eq('N2 nobody mining: the whole crew stopped, no alert', [r.state.fleet.fleetMove, r.alerts], [true, []]);
  // B alone resumes at 2700: the move is over, A is named again after its grace
  st = r.state;
  r = upd(st, samples(B, 'Bravo', [2700 * S]), L, 2705 * S);
  eq('N3 B resumes: grace for A', [r.state.fleet.moveEndedAt, r.alerts], [2705 * S, []]);
  r = upd(r.state, samples(B, 'Bravo', bursts(2745 * S, 45 * S, 8)), L, 3065 * S);
  eq('N4 after grace (2705 + 360): A named afresh', r.alerts, [{ charId: A, charName: 'Alpha', kind: 'stopped', since: 3065 * S }]);
}

// ---- 7b. A TRANSITION must not produce a spurious period -------------------
// After a 400-s move gap, lag 180 still has 8 of 10 evaluable events with a
// successor (only the two before the gap lack one) — exactly the 0.8 bar, so
// the TRUE period survives the gap. A lag of 580 s bridges 1440→2020 and
// 1620→2200, but the gaps' 90th percentile is 180 s, so nothing past 360 s
// is even tried.
{
  const ev = [1440, 1440, 1620, 1620, 2020, 2020, 2200, 2200, 2380, 2380, 2560, 2560].map((t) => t * S);
  eq('E1 the true period survives a bridged gap; the coincidence is out of range', W.estimatePeriod(ev, 2570 * S), 180 * S);
}

// ---- 8. DOCKED / MOVED / RESHIPPED: silence -----------------------------------
{
  const base = () => upd(W.emptyWatch(),
    [...samples(A, 'Alpha', bursts(0, 180 * S, 10, 2)), ...samples(B, 'Bravo', bursts(0, 45 * S, 37))],
    locs({ [A]: loc(), [B]: loc({ shipTypeId: 32880 }) }), 1630 * S).state;
  const keepB = samples(B, 'Bravo', bursts(1665 * S, 45 * S, 10));
  let r = upd(base(), keepB, locs({ [A]: loc({ docked: true }), [B]: loc({ shipTypeId: 32880 }) }), 2073 * S);
  eq('D1 A docked: stopped but not named', [r.state.miners[0].status, r.alerts], ['stopped', []]);
  r = upd(base(), keepB, locs({ [A]: loc({ systemId: 30000143 }), [B]: loc({ shipTypeId: 32880 }) }), 2073 * S);
  eq('D2 A in another system: not named', r.alerts, []);
  r = upd(base(), keepB, locs({ [A]: loc({ shipTypeId: 17476 }), [B]: loc({ shipTypeId: 32880 }) }), 2073 * S);
  eq('D3 A reshipped: history dropped, idle, not named', [r.state.miners.some((m) => m.charId === A), r.alerts], [false, []]);
  r = upd(base(), keepB, locs({ [A]: loc({ online: false }), [B]: loc({ shipTypeId: 32880 }) }), 2073 * S);
  eq('D4 A logged off (ESI): measured from its lines like anyone — stopped — but the silence is explained, not named', [r.state.miners[0].status, r.alerts], ['stopped', []]);
  // RULE 4 (v0.220.0): ESI's online flag lags minutes after a login; a miner whose lines keep
  // arriving is watched from those lines, whatever the flag says — it used to be set idle
  r = upd(base(), [...keepB, ...samples(A, 'Alpha', bursts(1800 * S, 180 * S, 2, 2))], locs({ [A]: loc({ online: false }), [B]: loc({ shipTypeId: 32880 }) }), 2073 * S);
  eq('D6 A "offline" to ESI but still writing lines: ok, cur = peak', [r.state.miners[0].status, r.state.miners[0].cur, r.state.miners[0].peak, r.alerts], ['ok', 8, 8, []]);
  // a character the app has no login for: no location → dock/move cannot suppress, the alert stands
  r = upd(base(), keepB, locs({ [B]: loc({ shipTypeId: 32880 }) }), 2073 * S);
  eq('D5 A unknown to ESI: still named', kinds(r.alerts), [`${A}:stopped`]);
}

// ---- 9. A LONE MINER is the whole crew --------------------------------------
{
  const L = locs({ [A]: loc() });
  let st = upd(W.emptyWatch(), samples(A, 'Alpha', bursts(0, 180 * S, 10, 2)), L, 1630 * S).state;
  let r = upd(st, [], L, 2073 * S);
  eq('L1 lone miner stops: a crew move by definition, no alert', [r.state.miners[0].status, r.state.fleet.fleetMove, r.alerts], ['stopped', true, []]);
  // but a lone miner losing one of two modules IS named (after the 2-min hold)
  st = upd(st, samples(A, 'Alpha', [1800 * S]), L, 1810 * S).state;
  st = upd(st, samples(A, 'Alpha', [1980 * S]), L, 1990 * S).state;
  r = upd(st, samples(A, 'Alpha', [2160 * S]), L, 2170 * S);
  eq('L2 lone miner, one module down for good: named', r.alerts, [{ charId: A, charName: 'Alpha', kind: 'reduced', since: 2110 * S }]);
}

// ---- 9b. THE OWNER'S REAL CADENCE: two modules every 15 s -------------------
// (measured 2026-09-15: pairs of lines every ~15 s, all session long). A
// 30-s retarget pause and a two-slot hiccup must stay silent; a module that
// stays off is named two minutes after its shortfall appears.
{
  const L = locs({ [A]: loc() });
  const P = 15 * S;
  let st = upd(W.emptyWatch(), samples(A, 'Alpha', bursts(0, P, 41, 2)), L, 605 * S).state; // bursts 0…600
  eq('Q1 15-s pairs: period 15 s, window 54 s, cur = peak = 8', [st.miners[0].period, W.windowFor(P), st.miners[0].cur, st.miners[0].peak], [P, 54 * S, 8, 8]);
  // a 45-s retarget pause (615, 630, 645 missed), then both modules from 660
  let r = upd(st, samples(A, 'Alpha', [660, 660, 675, 675, 690, 690].map((t) => t * S)), L, 700 * S);
  eq('Q2 after a pause the run is too young to judge: ok, no alert', [r.state.miners[0].cur, r.state.miners[0].status, r.alerts], [6, 'ok', []]);
  r = upd(r.state, samples(A, 'Alpha', [705, 705, 720, 720].map((t) => t * S)), L, 730 * S);
  eq('Q3 run a window long again: full count, ok', [r.state.miners[0].cur, r.state.miners[0].status, r.alerts], [8, 'ok', []]);
  // one module misses two slots (615, 630 single) then returns: shortfall shorter than the hold → silent
  let st2 = upd(st, samples(A, 'Alpha', [615 * S, 630 * S]), L, 640 * S).state;
  eq('Q4 two-slot hiccup: shortfall clock starts, nothing shown', [st2.miners[0].cur, st2.miners[0].status, st2.miners[0].reducedSince], [6, 'reduced', 640 * S]);
  r = upd(st2, samples(A, 'Alpha', [645, 645, 660, 660, 675, 675, 690, 690].map((t) => t * S)), L, 700 * S);
  eq('Q5 back before two minutes: clock cleared, no alert', [r.state.miners[0].status, r.state.miners[0].reducedSince, r.alerts], ['ok', null, []]);
  // one module stays off from 615: named at 640 + 120 = 760
  let st3 = st2;
  st3 = upd(st3, samples(A, 'Alpha', [645, 660, 675, 690, 705, 720, 735, 750].map((t) => t * S)), L, 759 * S).state;
  r = upd(st3, [], L, 760 * S);
  eq('Q6 a module off for two minutes: named, since = shortfall + 2 min', [r.state.miners[0].cur, r.alerts], [4, [{ charId: A, charName: 'Alpha', kind: 'reduced', since: 760 * S }]]);
  // a shortfall whose lines have ALREADY stopped is not named as a rate drop
  // (it is on its way to "stopped"): module 1 alone until 690, then silence
  let st4 = upd(st2, samples(A, 'Alpha', [645, 660, 675, 690].map((t) => t * S)), L, 700 * S).state;
  r = upd(st4, [], L, 760 * S);
  eq('Q9 hold complete but quiet (70 s since the last line): not named', [r.state.miners[0].status, r.state.miners[0].quiet, r.alerts], ['reduced', true, []]);
  // …and when a line arrives after that 75-s silence it starts a NEW run
  // (the silence was longer than a period), so the shortfall clock is reset
  // rather than the old shortfall being named late
  r = upd(r.state, samples(A, 'Alpha', [765 * S]), L, 770 * S);
  eq('Q10 a line after the silence starts a new run: clock reset, nothing named', [r.state.miners[0].status, r.state.miners[0].reducedSince, r.alerts], ['ok', null, []]);
  // at 15 s per cycle "stopped" is the 30-s quiet floor (+2) plus the delay: 152 s after the last line
  r = upd(st, [], L, (600 + 152) * S);
  eq('Q7 stopped = quiet floor + delay: silent at 152 s (a lone miner anyway)', [r.state.miners[0].status], ['ok']);
  r = upd(st, [], L, (600 + 153) * S);
  eq('Q8 …stopped at 153 s', [r.state.miners[0].status], ['stopped']);
}

// ---- 12. THE KNOBS: the shipped 30-s default, the drop share, the keep time ---
{
  const D = { delayMs: 30 * S, dropRatio: 0.75, keepStoppedMs: 900 * S };   // the defaults
  eq('O1 the shipped defaults', W.DEFAULT_WATCH_OPTIONS, D);
  const L = locs({ [A]: loc(), [B]: loc({ shipTypeId: 32880 }) });
  const P = 15 * S;
  // A: two modules every 15 s (0…600); B: a 45-s laser that keeps going
  let st = W.updateWatch(W.emptyWatch(), [...samples(A, 'Alpha', bursts(0, P, 41, 2)), ...samples(B, 'Bravo', bursts(0, 45 * S, 14))], L, 605 * S).state;
  // one module off from 615: shortfall seen at 640 → named at 640 + 30 = 670
  st = W.updateWatch(st, samples(A, 'Alpha', [615 * S, 630 * S]), L, 640 * S).state;
  st = W.updateWatch(st, [...samples(A, 'Alpha', [645 * S, 660 * S]), ...samples(B, 'Bravo', [630 * S])], L, 669 * S).state;
  let r = W.updateWatch(st, [], L, 669 * S);
  eq('O2 30-s delay: 29 s after the shortfall, nothing yet', r.alerts, []);
  r = W.updateWatch(st, [], L, 670 * S);
  eq('O3 …named at 30 s', r.alerts, [{ charId: A, charName: 'Alpha', kind: 'reduced', since: 670 * S }]);
  // A stops outright after 600 while B keeps going: quiet floor 32 + 30 = 62 s → stopped at 663
  const st0 = W.updateWatch(W.emptyWatch(), [...samples(A, 'Alpha', bursts(0, P, 41, 2)), ...samples(B, 'Bravo', bursts(0, 45 * S, 14))], L, 605 * S).state;
  r = W.updateWatch(st0, samples(B, 'Bravo', [630 * S]), L, 662 * S);
  eq('O4 62 s of silence: not yet', [r.state.miners[0].status, r.alerts], ['ok', []]);
  r = W.updateWatch(r.state, [], L, 663 * S);
  eq('O5 63 s: not mining, named', r.alerts, [{ charId: A, charName: 'Alpha', kind: 'stopped', since: 663 * S }]);
  // the keep time: with keepStoppedMs = 60 s the line leaves at 663 + 60
  const K = { ...D, keepStoppedMs: 60 * S };
  let k = W.updateWatch(st0, samples(B, 'Bravo', [630 * S]), L, 663 * S, K);
  k = W.updateWatch(k.state, samples(B, 'Bravo', bursts(675 * S, 45 * S, 2)), L, 723 * S, K);
  eq('O6 keep 1 min: still shown at 60 s', kinds(k.alerts), [`${A}:stopped`]);
  k = W.updateWatch(k.state, [], L, 724 * S, K);
  eq('O7 …gone at 61 s', k.alerts, []);
  // the drop share: three modules (12 per window); at "half the rate" one
  // module off (8 of 12) is not a drop, two off (4) is
  const H = { ...D, dropRatio: 0.5, delayMs: 0 };
  let h = W.updateWatch(W.emptyWatch(), [...samples(A, 'Alpha', bursts(0, P, 41, 3)), ...samples(B, 'Bravo', bursts(0, 45 * S, 14))], L, 605 * S, H).state;
  h = W.updateWatch(h, [...samples(A, 'Alpha', [615, 615, 630, 630, 645, 645].map((t) => t * S)), ...samples(B, 'Bravo', [630 * S])], L, 650 * S, H).state;
  // window (591, 645] = 600×3, 615×2, 630×2, 645×2 = 9 of a normal 12: above half, so not a drop at this setting
  eq('O8 half-rate setting: one of three modules off (9 of 12 in the window) is not a drop', [h.miners[0].cur, h.miners[0].peak, h.miners[0].status], [9, 12, 'ok']);
  h = W.updateWatch(h, [...samples(A, 'Alpha', [660, 675, 690].map((t) => t * S)), ...samples(B, 'Bravo', [675 * S])], L, 695 * S, H).state;
  eq('O9 …two of three off (window (636,690] = 645×2,660,675,690 = 5) is', [h.miners[0].cur, h.miners[0].status], [5, 'reduced']);
}

// ---- 10. AFTER A MOVE the low count in the window is NOT a rate drop ---------
// Both stop after 1620, both resume at 2020 (A with both modules). A's window at
// 2200 = (1486, 2200] holds 1620×2, 2020×2, 2200×2 = 6 = peak − 2, but a 400-s
// gap sits inside → ok. By 2560 the window is clean again and full.
{
  const L = locs({ [A]: loc(), [B]: loc({ shipTypeId: 32880 }) });
  let st = upd(W.emptyWatch(),
    [...samples(A, 'Alpha', bursts(0, 180 * S, 10, 2)), ...samples(B, 'Bravo', bursts(0, 45 * S, 37))], L, 1630 * S).state;
  st = upd(st, [], L, 2000 * S).state;
  let r = upd(st, [...samples(A, 'Alpha', [2020 * S, 2020 * S, 2200 * S, 2200 * S]), ...samples(B, 'Bravo', bursts(2020 * S, 45 * S, 5))], L, 2210 * S);
  st = r.state;
  eq('G1 window holds the move gap: cur 6 but ok, no alert', [st.miners[0].cur, st.miners[0].status, r.alerts], [6, 'ok', []]);
  r = upd(st, [...samples(A, 'Alpha', [2380 * S, 2380 * S, 2560 * S, 2560 * S]), ...samples(B, 'Bravo', bursts(2245 * S, 45 * S, 8))], L, 2570 * S);
  eq('G2 window clean again: cur 8, ok', [r.state.miners[0].cur, r.state.miners[0].status, r.alerts], [8, 'ok', []]);
}

// ---- 10b. THE BASELINE IS A PERCENTILE, NOT THE MAXIMUM ----------------------
// Three modules every 15 s (12 per window) with one freak window of 18: the
// maximum would call every normal window afterwards a shortfall (12 ≤ 18−2
// and ≤ 13.5); the 80th percentile stays at 12, so normal is normal.
{
  const L = locs({ [A]: loc() });
  const P = 15 * S;
  const ev = bursts(0, P, 41, 3);                       // 0…600, 123 events
  ev.push(...[300, 300, 300, 315, 315, 315].map((t) => t * S)); // a freak burst: 6 extra lines around 300–315
  const st = upd(W.emptyWatch(), samples(A, 'Alpha', ev), L, 605 * S).state;
  eq('B1 a freak spike does not set the baseline: peak 12, cur 12, ok', [st.miners[0].peak, st.miners[0].cur, st.miners[0].status], [12, 12, 'ok']);
}

// ---- 11. THE TEXT ---------------------------------------------------------------
{
  const a = { charId: A, charName: 'Alpha', kind: 'stopped', since: 1000 * S };
  eq('T1 just raised', W.alertText(a, 1010 * S), 'not mining · just now');
  eq('T2 minutes', W.alertText(a, 1000 * S + 7 * 60 * S + 30 * S), 'not mining · 7 min');
  eq('T3 reduced wording', W.alertText({ ...a, kind: 'reduced' }, 1000 * S + 2 * 60 * S), 'rate down · 2 min');
}

console.log(`miningwatch.test: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
