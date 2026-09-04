// AI FIGHT WRITE-UPS — the main-process half.
//
// The battle-report tool computes every fact of a fight deterministically
// (who, where, when, what died, for how much) and renders a plain template
// write-up from them. THIS module is the optional step that turns that
// digest into nicer prose with a Claude call.
//
// THE KEY NEVER ENTERS THE RENDERER. config.json deliberately refuses
// secrets (looksSecret in appConfig.cjs) and its README promises the file
// is safe to copy — so the Anthropic key lives in its own file,
//   Documents/EVE Conductor/anthropic.json
//   { "apiKey": "sk-ant-...", "model": "claude-sonnet-5" }   (model optional)
// read here in the main process only. The renderer sends a digest of
// numbers and gets prose back; it can ask whether a key exists, never what
// it is. That file is a secret and must never be copied to another person.
//
// THE MODEL INVENTS NOTHING. The prompt hands over the computed digest and
// forbids numbers or events that are not in it — the same integrity rule as
// everywhere else in this app: every figure must trace to a killmail.
const fs = require('fs');
const path = require('path');

const FILE_NAME = 'anthropic.json';
const DEFAULT_MODEL = 'claude-sonnet-5';
const API_URL = 'https://api.anthropic.com/v1/messages';
/** a write-up is a nicety; it must never hold the UI for minutes. Node's
 * fetch only gives up after ~300s by default, and its body timeout is
 * idle-based, so a trickling response can outlast even that. */
const CALL_TIMEOUT_MS = 30_000;
/** thinking is DISABLED below, so this bounds prose only — but a cap that
 * truncates mid-sentence is worse than no write-up, so leave headroom */
const MAX_TOKENS = 2000;

/** { apiKey, model?, baseUrl? } or null; baseUrl exists for the test rig */
function readKeyFile(documentsPath) {
  try {
    const p = path.join(documentsPath, 'EVE Conductor', FILE_NAME);
    if (!fs.existsSync(p)) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (typeof raw?.apiKey !== 'string' || raw.apiKey.trim() === '') return null;
    return {
      apiKey: raw.apiKey.trim(),
      model: typeof raw.model === 'string' && raw.model.trim() !== '' ? raw.model.trim() : DEFAULT_MODEL,
      baseUrl: typeof raw.baseUrl === 'string' && raw.baseUrl.trim() !== '' ? raw.baseUrl.trim() : null,
    };
  } catch {
    // an unreadable key file means "no AI", never a crash
    return null;
  }
}

/** what the renderer may know: is prose available, and through which model */
function status(documentsPath) {
  const cfg = readKeyFile(documentsPath);
  return cfg ? { configured: true, model: cfg.model } : { configured: false, model: null };
}

/**
 * Store (or clear) the key from the Settings field. WRITE-ONLY from the
 * renderer's point of view: the answer is only the resulting status — the
 * key itself is never read back out. Whitespace is stripped wholesale
 * (keys have none), which also kills the interior-newline class of leak
 * at the source. An empty string clears the file entirely. Atomic write,
 * same tmp+rename pattern as config.json; a merge preserves a hand-set
 * model or baseUrl.
 */
function setKey(documentsPath, apiKey) {
  try {
    const dir = path.join(documentsPath, 'EVE Conductor');
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, FILE_NAME);
    const k = (typeof apiKey === 'string' ? apiKey : '').replace(/\s+/g, '');
    if (k === '') {
      if (fs.existsSync(p)) fs.unlinkSync(p);
      return status(documentsPath);
    }
    let prev = {};
    try { prev = JSON.parse(fs.readFileSync(p, 'utf8')) || {}; } catch { /* fresh file */ }
    const next = { ...prev, apiKey: k };
    fs.writeFileSync(`${p}.tmp`, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(`${p}.tmp`, p);
    return status(documentsPath);
  } catch {
    return { configured: false, model: null };
  }
}

const SYSTEM_PROMPT = [
  'You summarise EVE Online fights for a killboard post.',
  'You are given a JSON digest of a fight, computed from killmails. It is the ONLY source of truth.',
  'Write 1-2 short paragraphs, at most 180 words, plain text, no headings, no bullet points, no markdown.',
  'Chronological: open with where and when the fight started and who fought whom, then follow the phases in order with their times (HH:MM, EVE time) and systems, and end with how it finished.',
  'Use the ISK figures, ship names, pilot counts and group names exactly as given; round ISK only as already rounded in the digest.',
  'NEVER invent a number, ship, system, group or event that is not in the digest. If something is not in the digest, it does not appear in the write-up.',
  'If the digest carries a `caveat` field, its numbers are PARTIAL — close the write-up with that caveat in parentheses, and never present the totals as the whole fight.',
].join(' ');

/**
 * Digest in, prose out: { text, model } on success, { error } otherwise.
 * A failure here is ALWAYS survivable — the caller falls back to its
 * deterministic template write-up and says so.
 *
 * NO ERROR TEXT FROM THIS FUNCTION IS EVER PASSED THROUGH RAW. Error
 * messages here are built from a fixed vocabulary, because the messages
 * this code can produce are not safe to show: an interior newline in a
 * hand-edited key makes undici throw `Headers.append: '<the whole key>' is
 * not a valid header value`, which would have carried the secret straight
 * into the renderer, into React state, and onto the screen — in the one
 * module whose entire purpose is that the renderer never sees the key. The
 * same rule kills the smaller leak on the success path, where JSON.parse
 * embeds a snippet of a non-JSON body (a captive portal, a MITM proxy) in
 * its SyntaxError.
 */
async function narrate(documentsPath, digest) {
  const cfg = readKeyFile(documentsPath);
  if (!cfg) return { error: 'no anthropic.json' };
  // an explicit controller rather than AbortSignal.timeout: the timer is
  // CLEARED when the call returns, so a finished request leaves no live
  // handle behind in the main process
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CALL_TIMEOUT_MS);
  let r;
  try {
    r = await fetch(cfg.baseUrl ?? API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: MAX_TOKENS,
        // adaptive thinking is ON by default on Sonnet 5 and counts against
        // max_tokens; a summary of numbers we already computed does not need
        // it, and letting it run risked answers that were all thinking and
        // no text
        thinking: { type: 'disabled' },
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(digest) }],
      }),
      signal: ac.signal,
    });
  } catch (e) {
    // e.message can quote the key or the URL — report only the shape
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      return { error: `no answer within ${Math.round(CALL_TIMEOUT_MS / 1000)}s` };
    }
    return { error: 'Anthropic API unreachable' };
  } finally {
    clearTimeout(timer);
  }
  if (!r.ok) {
    // the status code is diagnostic (401 bad key, 429 out of credit) and
    // safe to show; the response body could be anything, so it is not
    return { error: `Anthropic API HTTP ${r.status}` };
  }
  let j;
  try {
    j = await r.json();
  } catch {
    return { error: 'Anthropic API returned a non-JSON response' };
  }
  const text = Array.isArray(j?.content)
    ? j.content.filter((c) => c?.type === 'text').map((c) => c.text).join('')
    : '';
  if (text.trim() === '') return { error: 'the model returned no text' };
  // a write-up cut off mid-sentence would be pasted into chat as if whole
  if (j?.stop_reason && j.stop_reason !== 'end_turn') {
    return { error: `the model stopped early (${String(j.stop_reason).slice(0, 20)})` };
  }
  return { text: text.trim(), model: cfg.model };
}

module.exports = { status, narrate, setKey, FILE_NAME };
