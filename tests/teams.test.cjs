// battleReport: which side is which (v0.100.0 evidence-weighted derivation).
//
// Driven through the REAL exported path — fetchFightData — with the network
// stubbed, so what is tested is the code the app runs.
//
// The rule being pinned: every entity is scored against my own,
//   friend evidence = killmails where it shoots the same victim I shoot
//   enemy  evidence = killmails where it shoots me, or where I shoot it
// bigger pile wins, ties go to enemy. Then friends/enemies propagate to
// entities that never met us directly, and anything still unclassified
// goes in the enemy column (visible beats hidden). NPC rows (char 0) are
// not combatant groups.
//
// Every expectation below is hand-computed from that rule.
const br = require('./sim/lib/battleReport.js');

let pass = 0, fail = 0;
const eq = (l, g, w) => {
  const ok = JSON.stringify(g) === JSON.stringify(w);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${l}${ok ? '' : `  got=${JSON.stringify(g)} want=${JSON.stringify(w)}`}`);
  ok ? pass++ : fail++;
};

const MY_CORP = 101; // corp 101 sits in alliance 100 -> myEntity 100
let nextId = 1;
const p = (ally, char) => ({ ally, corp: ally + 1, char, ship: 600 });
/** victim entity, attacker entities (each gets a distinct pilot) */
const km = (vAlly, attAllies, isk = 50e6) => ({
  id: nextId++, time: 1_700_000_000_000 + nextId * 1000, system: 30000142,
  victim: { ...p(vAlly, 900 + nextId), lossValue: isk },
  attackers: attAllies.map((a, i) => (a === 'NPC'
    ? { ally: 0, corp: 1000125, char: 0, ship: 30426 }
    : p(a, 10 + i))),
});

/** run the real fetchFightData against a stubbed analyze response */
const teamsOf = async (kms) => {
  global.fetch = async () => ({ ok: true, json: async () => ({ relateds: [{ systemID: 30000142, kms }] }) });
  const fd = await br.fetchFightData({
    timings: [{ systemID: '30000142', start: 0, end: 1 }], corpId: MY_CORP, startMs: 0, endMs: 1,
  });
  return { A: fd.teams[0].slice().sort((a, b) => a - b), B: fd.teams[1].slice().sort((a, b) => a - b) };
};

(async () => {
  // ---- T1: the plain case — we and 300 kill 200 ----
  // 200: friend 0 / enemy 1 -> enemy. 300: friend 1 / enemy 0 -> friend.
  eq('T1 co-attacker is a friend, victim is an enemy',
    await teamsOf([km(200, [100, 300])]), { A: [100, 300], B: [200] });

  // ---- T2: THE FIX — a fleet-mate killed with our smartbomb on his mail ----
  // 300 shoots alongside us on three kills of 200, then dies to 200 while
  // our smartbomb clips him. 300: friend 3 / enemy 1 -> FRIEND.
  // 200: friend 1 (the accidental shared mail) / enemy 3 -> enemy.
  // The first cut of this code read that single lossmail and put our own
  // fleet-mate on the enemy team.
  eq('T2 a whored friendly loss does not flip the fleet-mate',
    await teamsOf([
      km(200, [100, 300]), km(200, [100, 300]), km(200, [100, 300]),
      km(300, [100, 200]),
    ]), { A: [100, 300], B: [200] });

  // ---- T2b: one mail is ONE unit of evidence even with many pilots on it ----
  // Fleet-mate 300 shares two kills of 200 with us (friend 2), then FIVE of
  // 300's pilots land on one of OUR losses (drone aggro during a bomb run).
  // Per-pilot counting scored that mail as enemy 5 > friend 2 and flipped
  // him; per-mail it is enemy 1 < friend 2 and he stays ours.
  eq('T2b five pilots on one mail are still one mail',
    await teamsOf([
      km(200, [100, 300]), km(200, [100, 300]),
      { id: nextId++, time: 1_700_000_000_000 + nextId * 1000, system: 30000142,
        victim: { ...p(100, 990), lossValue: 50e6 },
        attackers: [p(200, 21), p(300, 31), p(300, 32), p(300, 33), p(300, 34), p(300, 35)] },
    ]), { A: [100, 300], B: [200] });

  // ---- T3: the honest limit of T2 ----
  // With NO shared-kill history, a friendly who only ever appears as a
  // victim we shot is indistinguishable from an enemy — 300: friend 0 /
  // enemy 1. Recorded so the limit is known, not discovered later.
  eq('T3 with no co-kill evidence the same mail is still ambiguous',
    await teamsOf([km(300, [100, 200]), km(200, [100])]), { A: [100], B: [200, 300] });

  // ---- T4: NPCs are not a combatant group ----
  // Sleepers/gate guns whoring a mail must not become a team entity, or
  // the write-up reports an extra "group" that is not a fleet.
  const t4 = await teamsOf([km(200, [100, 'NPC'])]);
  eq('T4 the NPC corp joins neither side', t4, { A: [100], B: [200] });

  // ---- T5: a third-party fight in the window stays VISIBLE ----
  // 400 and 500 never touch us; they are unclassified, so they land in the
  // enemy column rather than vanishing from the report.
  eq('T5 unrelated parties are shown, not dropped',
    await teamsOf([km(200, [100]), km(400, [500])]), { A: [100], B: [200, 400, 500] });

  // ---- T6: an ally who never shared a mail with us is still recognised ----
  // 300 only ever kills 200 (never alongside us). Direct evidence: none.
  // Propagation: 200 is a known enemy (we killed it), so its killers are
  // ours. Hand-check: A = [100, 300].
  eq('T6 propagation reaches allies with no shared mail',
    await teamsOf([km(200, [100]), km(200, [300])]), { A: [100, 300], B: [200] });

  // ---- T7: attackers on a friend's loss become enemies ----
  // 600 kills our ally 300 (300 is a friend via T1-style co-kill first).
  // 600 has no other contact with us; the friend-side propagation catches it.
  eq('T7 whoever kills our side is on the other side',
    await teamsOf([km(200, [100, 300]), km(300, [600])]),
    { A: [100, 300], B: [200, 600] });

  // ---- T8: the zkill/ESI fallback (v0.102.0) ----
  // esiKmToBr maps a public ESI killmail into br shape; hand-computed:
  // missing alliance -> 0 (entity falls to corp), missing char -> 0 (NPC),
  // lossValue comes from zkill's totalValue since ESI carries no ISK.
  const esiKm = {
    killmail_time: '2026-08-17T02:16:18Z',
    solar_system_id: 30000543,
    victim: { corporation_id: 777, character_id: 9, ship_type_id: 602 },
    attackers: [
      { alliance_id: 100, corporation_id: 101, character_id: 11, ship_type_id: 17715 },
      { corporation_id: 1000125, ship_type_id: 30426 }, // NPC: no char
    ],
  };
  const mapped = br.esiKmToBr(137789237, esiKm, 45_000_000);
  // dmg defaults to 0 when the source ESI km carries none; fb is absent
  // (not false) so analyze-sourced mails and unflagged rows look alike
  eq('T8 mapping', mapped, {
    id: 137789237, time: Date.UTC(2026, 7, 17, 2, 16, 18), system: 30000543,
    victim: { ally: 0, corp: 777, char: 9, ship: 602, dmg: 0, lossValue: 45000000 },
    attackers: [
      { ally: 100, corp: 101, char: 11, ship: 17715, dmg: 0 },
      { ally: 0, corp: 1000125, char: 0, ship: 30426, dmg: 0 },
    ],
  });
  // and the credit fields map through when present
  const credited = br.esiKmToBr(1, {
    killmail_time: '2026-08-17T02:16:18Z', solar_system_id: 30000543,
    victim: { corporation_id: 777, character_id: 9, ship_type_id: 602, damage_taken: 5000 },
    attackers: [
      { alliance_id: 100, corporation_id: 101, character_id: 11, ship_type_id: 17715, damage_done: 4200, final_blow: false },
      { alliance_id: 100, corporation_id: 101, character_id: 12, ship_type_id: 602, damage_done: 800, final_blow: true },
    ],
  }, 0);
  eq('T8b damage and final blow carried',
    [credited.victim.dmg, credited.attackers[0].dmg, credited.attackers[0].fb,
      credited.attackers[1].dmg, credited.attackers[1].fb],
    [5000, 4200, false, 800, true]);
  // fallbackFightData: same team rules, marked partial
  const fb = br.fallbackFightData([mapped], MY_CORP);
  eq('T8 fallback teams', [fb.teams[0].slice().sort(), fb.teams[1].slice().sort(), fb.partial],
    [[100], [777], true]);

  // ---- T10: fight clustering, exported pure (v0.107.0) ----
  // newest-first mails at t = 100, 90, 45, 40, -1 minutes, 40-min gap rule:
  // 100-90 (10 apart, together), 90-45 (45 apart, SPLIT), 45-40 (together),
  // 40 to -1 (41 apart, SPLIT) -> [[100,90],[45,40],[-1]]. (First draft of
  // this fixture used a 40-minute last gap and expected a split — wrong by
  // the rule's own inclusive boundary, which the next assert pins.)
  const M = (mins) => ({ t: mins * 60000 });
  eq('T10 clustering', br.clusterFights([M(100), M(90), M(45), M(40), M(-1)], 40 * 60000)
    .map((f) => f.map((m) => m.t / 60000)), [[100, 90], [45, 40], [-1]]);
  // exactly at the gap threshold stays ONE fight (<= is together)
  eq('T10 boundary is inclusive', br.clusterFights([M(40), M(0)], 40 * 60000).length, 1);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('HARNESS ERROR', e); process.exit(1); });
