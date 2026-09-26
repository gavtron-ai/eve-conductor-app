// v0.235.0 (audit E4): the renderer side of tokens-at-rest, on the SHIPPED compiled auth store with a
// fake vault bridge and a fake localStorage. A persisted blob from before (tokens inside) hydrates;
// the store then moves the pairs into the vault, keeps them in memory, and rewrites the blob WITHOUT
// them; a later start with a token-free blob takes the pairs back from the vault; a refresh asks the
// bridge with the character id; removing a character forgets it in the vault. Without a vault (no
// encryption) the blob keeps its tokens, as before.
const tick = () => new Promise((r) => setTimeout(r, 30));
let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}${ok ? '' : `\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const AUTH = require.resolve('./sim/lib/auth.js');
const KEY = 'eve-trade-conductor-auth';
const char = (id, tokens) => ({ characterId: id, characterName: `Pilot ${id}`, role: '', accessToken: tokens ? `access-${id}` : null, refreshToken: tokens ? `refresh-${id}` : null, expiresAt: tokens ? 1_800_000_000_000 : 0, standings: null, ships: null, skills: null, wallet: null, implants: null, lastSync: null });

function world({ blobChars, vault = {}, available = true }) {
  const store = new Map();
  store.set(KEY, JSON.stringify({ state: { clientId: '', characters: blobChars, activeId: blobChars[0]?.characterId ?? null, dutyMemory: {} }, version: 5 }));
  global.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const saved = []; const forgotten = []; const refreshes = [];
  global.window = {
    localStorage: global.localStorage,
    appInfo: {
      isElectron: true,
      tokens: available ? {
        available: true,
        load: async () => ({ ...vault }),
        save: async (list) => { for (const t of list) { vault[String(t.characterId)] = { accessToken: t.accessToken, refreshToken: t.refreshToken, expiresAt: t.expiresAt, characterName: t.characterName }; saved.push(t.characterId); } return list.length; },
        forget: async (id) => { delete vault[String(id)]; forgotten.push(id); return true; },
      } : { available: false, load: async () => ({}), save: async () => 0, forget: async () => true },
      sso: { login: async () => { throw new Error('no login here'); }, refresh: async (clientId, refreshToken, characterId) => { refreshes.push([refreshToken, characterId]); return { characterId, characterName: 'Pilot', accessToken: 'access-new', refreshToken: 'refresh-new', expiresAt: 1_900_000_000_000 }; } },
    },
  };
  delete require.cache[AUTH];
  const A = require(AUTH);
  const blob = () => JSON.parse(store.get(KEY)).state.characters.map((c) => [c.characterId, c.accessToken, c.refreshToken]);
  return { A, blob, vault, saved, forgotten, refreshes };
}

(async () => {
  // ---- the first start after the upgrade: the blob still carries tokens
  {
    const w = world({ blobChars: [char(1, true), char(2, true)] });
    await tick();
    eq('1 the pairs went into the vault', [w.saved, Object.keys(w.vault)], [[1, 2], ['1', '2']]);
    eq('2 …and stay in memory', w.A.useAuth.getState().characters.map((c) => [c.characterId, c.accessToken, c.refreshToken]), [[1, 'access-1', 'refresh-1'], [2, 'access-2', 'refresh-2']]);
    eq('3 …while the persisted blob is rewritten WITHOUT them', w.blob(), [[1, null, null], [2, null, null]]);
    // a refresh goes to the bridge with the character id (the main process answers from the vault)
    const token = await w.A.ensureToken(1, true);
    eq('4 a forced refresh asks the bridge with the id, and the new pair is in memory', [token, w.refreshes, w.A.useAuth.getState().characters[0].refreshToken], ['access-new', [['refresh-1', 1]], 'refresh-new']);
    eq('5 …and still not in the blob', w.blob()[0], [1, null, null]);
    w.A.useAuth.getState().removeCharacter(2);
    await tick();
    eq('6 removing a character forgets it in the vault', [w.forgotten, Object.keys(w.vault)], [[2], ['1']]);
  }
  // ---- a later start: the blob is token-free, the vault has the pairs
  {
    const w = world({ blobChars: [char(1, false), char(3, false)], vault: { '1': { accessToken: 'access-v1', refreshToken: 'refresh-v1', expiresAt: 1, characterName: 'Pilot 1' } } });
    eq('7 before the restore the store holds no tokens (never a stale pair from the blob)', w.A.useAuth.getState().characters.map((c) => c.refreshToken), [null, null]);
    await tick();
    eq('8 the vault\'s pair is back in memory; a character the vault does not know stays logged out; nothing was saved', [w.A.useAuth.getState().characters.map((c) => c.refreshToken), w.saved], [['refresh-v1', null], []]);
  }
  // ---- no encryption on this machine: the blob keeps its tokens
  {
    const w = world({ blobChars: [char(1, true)], available: false });
    await tick();
    eq('9 without a vault the blob still carries the pair (the old behaviour) and nothing was saved', [w.blob(), w.saved], [[[1, 'access-1', 'refresh-1']], []]);
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
})();
