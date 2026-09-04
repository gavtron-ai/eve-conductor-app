// narrative.cjs against a mock Anthropic server: proves the request shape,
// header set, response parsing, and every failure fallback — everything
// except Anthropic's actual answer, which needs a real key.
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const narrative = require('../electron/narrative.cjs');

const tmpDocs = fs.mkdtempSync(path.join(os.tmpdir(), 'narr-'));
const dir = path.join(tmpDocs, 'EVE Conductor');
fs.mkdirSync(dir, { recursive: true });

let captured = null;
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    captured = { headers: req.headers, body: JSON.parse(body) };
    if (req.headers['x-api-key'] === 'sk-ant-good') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        content: [{ type: 'text', text: 'A fine fight was had by all.' }],
        stop_reason: 'end_turn',
      }));
    } else if (req.headers['x-api-key'] === 'sk-ant-html') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<html><head><title>Blocked by corporate proxy</title></head></html>');
    } else if (req.headers['x-api-key'] === 'sk-ant-cut') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        content: [{ type: 'text', text: 'The fight began at 20:30 and then' }],
        stop_reason: 'max_tokens',
      }));
    } else {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { type: 'authentication_error' } }));
    }
  });
});

server.listen(0, async () => {
  const base = `http://127.0.0.1:${server.address().port}/v1/messages`;
  const digest = { fight: { start: '20:30' }, phases: [] };
  let fails = 0, passes = 0;
  const check = (name, ok) => {
    console.log(`${ok ? 'PASS' : 'FAIL'}: ${name}`);
    if (ok) passes += 1; else fails += 1;
  };

  // 1. no key file at all -> honest error, no network call
  const r1 = await narrative.narrate(tmpDocs, digest);
  check('no key file -> error', r1.error === 'no anthropic.json');
  check('status unconfigured', narrative.status(tmpDocs).configured === false);

  // 2. good key -> text comes back, request is well-formed
  fs.writeFileSync(path.join(dir, 'anthropic.json'),
    JSON.stringify({ apiKey: 'sk-ant-good', baseUrl: base }));
  const r2 = await narrative.narrate(tmpDocs, digest);
  check('good key -> prose', r2.text === 'A fine fight was had by all.');
  check('default model in body', captured.body.model === 'claude-sonnet-5');
  check('thinking disabled (it competes for max_tokens on Sonnet 5)',
    JSON.stringify(captured.body.thinking) === JSON.stringify({ type: 'disabled' }));
  check('max_tokens leaves room for prose', captured.body.max_tokens >= 1000);
  check('digest is the user message', captured.body.messages[0].content === JSON.stringify(digest));
  check('system prompt forbids invention', /NEVER invent/.test(captured.body.system));
  check('api key header', captured.headers['x-api-key'] === 'sk-ant-good');
  check('anthropic-version header', captured.headers['anthropic-version'] === '2023-06-01');
  check('status configured + model', JSON.stringify(narrative.status(tmpDocs)) === JSON.stringify({ configured: true, model: 'claude-sonnet-5' }));

  // 3. bad key -> HTTP status surfaces, no body leakage
  fs.writeFileSync(path.join(dir, 'anthropic.json'),
    JSON.stringify({ apiKey: 'sk-ant-bad', baseUrl: base, model: 'claude-haiku-4-5-20251001' }));
  const r3 = await narrative.narrate(tmpDocs, digest);
  check('bad key -> HTTP 401 error', r3.error === 'Anthropic API HTTP 401');
  check('model override honoured', captured.body.model === 'claude-haiku-4-5-20251001');

  // 3b. THE KEY MUST NEVER COME BACK. An interior newline makes undici
  // throw `Headers.append: '<the whole key>' is not a valid header value`;
  // forwarding e.message verbatim would hand the secret to the renderer.
  const SECRET = 'sk-ant-api03-SUPERSECRET\nTAIL';
  fs.writeFileSync(path.join(dir, 'anthropic.json'),
    JSON.stringify({ apiKey: SECRET, baseUrl: base }));
  const r3b = await narrative.narrate(tmpDocs, digest);
  const blob = JSON.stringify(r3b);
  check('malformed key -> an error, not a crash', typeof r3b.error === 'string');
  check('the API KEY never appears in the returned error',
    !blob.includes('SUPERSECRET') && !blob.includes('sk-ant'));

  // 3c. a 200 that is not JSON must not echo the body back
  fs.writeFileSync(path.join(dir, 'anthropic.json'),
    JSON.stringify({ apiKey: 'sk-ant-html', baseUrl: base }));
  const r3c = await narrative.narrate(tmpDocs, digest);
  check('non-JSON 200 -> fixed message', r3c.error === 'Anthropic API returned a non-JSON response');
  check('no response-body snippet leaks',
    !JSON.stringify(r3c).includes('proxy') && !JSON.stringify(r3c).includes('<html'));

  // 3d. truncated prose is refused rather than shipped as if whole
  fs.writeFileSync(path.join(dir, 'anthropic.json'),
    JSON.stringify({ apiKey: 'sk-ant-cut', baseUrl: base }));
  const r3d = await narrative.narrate(tmpDocs, digest);
  check('stop_reason max_tokens -> error, not half a write-up',
    !r3d.text && /stopped early/.test(r3d.error || ''));

  // 4. server gone -> unreachable error, never a throw
  if (server.closeAllConnections) server.closeAllConnections();
  await new Promise((res) => server.close(res));
  fs.writeFileSync(path.join(dir, 'anthropic.json'),
    JSON.stringify({ apiKey: 'sk-ant-good', baseUrl: base }));
  const r4 = await narrative.narrate(tmpDocs, digest);
  check('dead server -> unreachable error', r4.error === 'Anthropic API unreachable');

  // 5. malformed key file -> treated as no key
  fs.writeFileSync(path.join(dir, 'anthropic.json'), '{not json');
  const r5 = await narrative.narrate(tmpDocs, digest);
  check('corrupt key file -> no anthropic.json', r5.error === 'no anthropic.json');

  // 6. setKey: the Settings field's write-only path (v0.102.0)
  fs.unlinkSync(path.join(dir, 'anthropic.json'));
  const s1 = narrative.setKey(tmpDocs, 'sk-ant-settings-key');
  check('setKey -> configured with default model',
    s1.configured === true && s1.model === 'claude-sonnet-5');
  check('setKey answer never echoes the key', !JSON.stringify(s1).includes('sk-ant-settings-key'));
  const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'anthropic.json'), 'utf8'));
  check('key is on disk', onDisk.apiKey === 'sk-ant-settings-key');
  // whitespace (incl. the interior-newline leak class) is stripped at write
  narrative.setKey(tmpDocs, '  sk-ant\n-pasted \t');
  check('whitespace stripped wholesale',
    JSON.parse(fs.readFileSync(path.join(dir, 'anthropic.json'), 'utf8')).apiKey === 'sk-ant-pasted');
  // a hand-set model survives a key replacement
  fs.writeFileSync(path.join(dir, 'anthropic.json'),
    JSON.stringify({ apiKey: 'old', model: 'claude-haiku-4-5-20251001' }));
  const s2 = narrative.setKey(tmpDocs, 'sk-ant-new');
  check('hand-set model preserved on key change', s2.model === 'claude-haiku-4-5-20251001');
  check('new key stored beside it',
    JSON.parse(fs.readFileSync(path.join(dir, 'anthropic.json'), 'utf8')).apiKey === 'sk-ant-new');
  // empty string clears the file entirely
  const s3 = narrative.setKey(tmpDocs, '');
  check('empty key -> cleared + unconfigured',
    s3.configured === false && !fs.existsSync(path.join(dir, 'anthropic.json')));

  console.log(`\n${passes} passed, ${fails} failed`);
  // Node keeps undici's connection pool alive after the last fetch; exiting
  // on top of it trips a libuv assert on Windows. Close it, then let the
  // loop drain on its own rather than calling process.exit under a
  // half-torn-down handle.
  process.exitCode = fails === 0 ? 0 : 1;
  const pool = globalThis[Symbol.for('undici.globalDispatcher.1')];
  if (pool && typeof pool.close === 'function') await pool.close().catch(() => {});
});
