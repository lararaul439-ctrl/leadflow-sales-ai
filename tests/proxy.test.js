'use strict';
/*
 * Tests for proxy/worker.mjs with mocked fetch and a fixed clock. The proxy has NOT been deployed to Cloudflare
 * by this project, so these tests prove the request handling logic only, not the Cloudflare runtime.
 */
const test = require('node:test');
const assert = require('node:assert/strict');

const ORIGIN = 'https://www.example-shop.test';
const TOKEN = 'unit-test-token-not-a-secret-0123456789';
const URL_UP = 'https://automation.example.test/webhook/leadflow-sales';
const NOW = new Date('2026-10-26T09:00:00.000Z');
const ENV = { WEBHOOK_URL: URL_UP, WEBHOOK_TOKEN: TOKEN, ALLOWED_ORIGINS: ORIGIN + ', https://other.example-shop.test', CONSENT_NOTICE_VERSION: 'privacy-2026-10' };
const FORM = { full_name: 'Marta Sanz Ortega', email: 'marta@empresa-demo.example', message: 'Queremos contratar vuestro servicio de automatizacion.', consent_to_contact: true };

let mod;
async function load() { if (!mod) mod = await import('../proxy/worker.mjs'); return mod; }

function req(body, opts) {
  const o = Object.assign({ method: 'POST', origin: ORIGIN, type: 'application/json' }, opts || {});
  const headers = {};
  if (o.origin) headers.Origin = o.origin;
  if (o.type) headers['Content-Type'] = o.type;
  Object.assign(headers, o.headers || {});
  const init = { method: o.method, headers };
  if (o.method !== 'GET' && o.method !== 'HEAD') init.body = typeof body === 'string' ? body : JSON.stringify(body);
  return new Request('https://proxy.example.test/', init);
}

function upstream(status, body) {
  const calls = [];
  const fn = async (url, init) => { calls.push({ url: String(url), init }); return new Response(body === undefined ? '{}' : JSON.stringify(body), { status }); };
  fn.calls = calls;
  return fn;
}

async function run(request, env, fetchFn, extra) {
  const { handle } = await load();
  return handle(request, env || ENV, Object.assign({ fetch: fetchFn || upstream(202, { ok: true }), now: () => NOW }, extra || {}));
}

const json = async (res) => JSON.parse(await res.text());

test('proxy: a valid form is forwarded with the secret added server-side and the caller gets a minimal answer', async () => {
  const f = upstream(202, { ok: true, status: 'accepted', submission_id: 'L-internal-id' });
  const res = await run(req(FORM), ENV, f);
  assert.equal(res.status, 202);
  assert.deepEqual(await json(res), { ok: true }, 'internal ids are not relayed');
  assert.equal(res.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(res.headers.get('Vary'), 'Origin');
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, URL_UP);
  assert.equal(f.calls[0].init.headers['X-Webhook-Token'], TOKEN);
  assert.equal(f.calls[0].init.method, 'POST');
});

test('proxy: the secret never appears in any response, whatever upstream does', async () => {
  for (const status of [200, 202, 401, 403, 404, 409, 422, 429, 500, 502, 503]) {
    const res = await run(req(FORM), ENV, upstream(status, { ok: false, echo: TOKEN, errors: ['x ' + TOKEN] }));
    const text = await res.text();
    const headers = JSON.stringify([...res.headers.entries()]);
    assert.ok(!text.includes(TOKEN) || status === 422, 'body leaks at ' + status);
    assert.ok(!headers.includes(TOKEN), 'headers leak at ' + status);
    assert.ok(!text.includes(new URL(URL_UP).host), 'upstream address leaks at ' + status);
  }
});

test('proxy: only whitelisted fields are forwarded and the caller cannot forge system fields or consent provenance', async () => {
  const f = upstream(202);
  const forged = Object.assign({}, FORM, {
    submission_id: 'L-forged', lead_id: 'x', status: 'tarea_creada', score: 100, priority: 'alta', human_review_required: 'no',
    consent_notice_version: 'forged-v9', consent_given_at: '1999-01-01T00:00:00Z', consent_evidence: 'verified', retry_count: 0, flags: '', __proto__x: 1,
    'cf-turnstile-response': 'abc'
  });
  await run(req(JSON.stringify(forged).replace('"__proto__x"', '"__proto__"')), ENV, f);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.deepEqual(Object.keys(sent).sort(), ['consent_given_at', 'consent_notice_version', 'consent_to_contact', 'email', 'full_name', 'message']);
  assert.equal(sent.consent_notice_version, 'privacy-2026-10', 'set from server configuration');
  assert.equal(sent.consent_given_at, NOW.toISOString(), 'set from the server clock');
  assert.equal(Object.getPrototypeOf(sent), Object.prototype);
  assert.equal({}.polluted, undefined);
});

test('proxy: consent is only stamped when it is really given, and only "true" counts', async () => {
  for (const [value, expected] of [[true, true], ['true', true], ['TRUE', true], [false, false], ['yes', false], ['on', false], [1, false], [undefined, false], [null, false], [{}, false], [['true'], false]]) {
    const f = upstream(202);
    const body = Object.assign({}, FORM); if (value === undefined) delete body.consent_to_contact; else body.consent_to_contact = value;
    await run(req(body), ENV, f);
    const sent = JSON.parse(f.calls[0].init.body);
    assert.equal(sent.consent_to_contact, expected, String(JSON.stringify(value)));
    assert.equal('consent_given_at' in sent, expected, 'no provenance without consent: ' + JSON.stringify(value));
  }
  const f = upstream(202);
  await run(req(FORM), Object.assign({}, ENV, { CONSENT_NOTICE_VERSION: '' }), f);
  const sent = JSON.parse(f.calls[0].init.body);
  assert.equal(sent.consent_to_contact, true);
  assert.ok(!('consent_notice_version' in sent) && !('consent_given_at' in sent), 'no notice configured -> no invented provenance');
});

test('proxy: origin handling - only listed origins pass, preflight is answered, other methods are refused', async () => {
  const f = upstream(202);
  for (const origin of ['https://evil.example', 'http://www.example-shop.test', 'https://www.example-shop.test.evil.example', 'null', '', undefined]) {
    const res = await run(req(FORM, { origin }), ENV, f);
    assert.equal(res.status, 403, String(origin));
    assert.equal(res.headers.get('Access-Control-Allow-Origin'), null);
  }
  assert.equal(f.calls.length, 0, 'nothing forwarded for refused origins');
  const second = await run(req(FORM, { origin: 'https://other.example-shop.test' }), ENV, upstream(202));
  assert.equal(second.status, 202);

  const pre = await run(req(undefined, { method: 'OPTIONS' }), ENV, f);
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.equal(pre.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
  assert.equal(pre.headers.get('Access-Control-Allow-Headers'), 'Content-Type');
  const badPre = await run(req(undefined, { method: 'OPTIONS', origin: 'https://evil.example' }), ENV, f);
  assert.equal(badPre.status, 403);

  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const res = await run(req(FORM, { method }), ENV, f);
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('Allow'), 'POST, OPTIONS');
  }
  assert.equal(f.calls.length, 0);
});

test('proxy: a wildcard or empty ALLOWED_ORIGINS never opens the endpoint', async () => {
  for (const allowed of ['', '*', undefined]) {
    const res = await run(req(FORM), Object.assign({}, ENV, { ALLOWED_ORIGINS: allowed }), upstream(202));
    assert.equal(res.status, 403, String(allowed));
  }
});

test('proxy: content type, size and JSON shape are enforced before anything is forwarded', async () => {
  const f = upstream(202);
  assert.equal((await run(req(FORM, { type: 'text/plain' }), ENV, f)).status, 415);
  assert.equal((await run(req(FORM, { type: 'application/x-www-form-urlencoded' }), ENV, f)).status, 415);
  assert.equal((await run(req(FORM, { type: '' }), ENV, f)).status, 415);
  assert.equal((await run(req(FORM, { type: 'application/json; charset=utf-8' }), ENV, f)).status, 202);
  f.calls.length = 0;

  assert.equal((await run(req(FORM, { headers: { 'Content-Length': '999999' } }), ENV, f)).status, 413, 'declared size');
  const big = JSON.stringify(Object.assign({}, FORM, { message: 'a'.repeat(20000) }));
  assert.equal((await run(req(big), ENV, f)).status, 413, 'actual size without a trustworthy header');
  assert.equal((await run(req(big, { headers: { 'Content-Length': '10' } }), ENV, f)).status, 413, 'a lying Content-Length does not help');
  assert.equal((await run(req(big), Object.assign({}, ENV, { MAX_BODY_BYTES: '50000' }), f)).status, 202, 'limit is configurable');
  f.calls.length = 0;

  for (const bad of ['{not json', '', 'null', '123', '"text"', '[1,2]', '[]']) assert.equal((await run(req(bad), ENV, f)).status, 400, JSON.stringify(bad));
  assert.equal(f.calls.length, 0);
});

test('proxy: the honeypot answers like a success and forwards nothing', async () => {
  const f = upstream(202);
  for (const field of ['website', 'url', 'hp']) {
    const res = await run(req(Object.assign({}, FORM, { [field]: 'http://spam.example' })), ENV, f);
    assert.equal(res.status, 202);
    assert.deepEqual(await json(res), { ok: true });
  }
  assert.equal(f.calls.length, 0);
  // an empty honeypot (what a real browser sends) is fine
  assert.equal((await run(req(Object.assign({}, FORM, { website: '' })), ENV, f)).status, 202);
  assert.equal(f.calls.length, 1);
});

test('proxy: Turnstile - missing, wrong, unreachable and valid tokens', async () => {
  const env = Object.assign({}, ENV, { TURNSTILE_SECRET: 'turnstile-secret-for-tests' });
  const calls = [];
  const mk = (verifyResult) => async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).includes('turnstile')) {
      if (verifyResult === 'throw') throw new Error('network');
      if (verifyResult === 'garbage') return new Response('not json', { status: 200 });
      return new Response(JSON.stringify({ success: verifyResult }), { status: 200 });
    }
    return new Response('{}', { status: 202 });
  };
  const send = (token, verify, headers) => run(req(Object.assign({}, FORM, token === undefined ? {} : { 'cf-turnstile-response': token }), { headers }), env, mk(verify));

  assert.equal((await send(undefined, true)).status, 403, 'no token');
  assert.equal((await send('', true)).status, 403, 'empty token');
  assert.equal((await send(12345, true)).status, 403, 'non-string token');
  assert.equal(calls.length, 0, 'no verification call for a missing token');
  assert.equal((await send('bad', false)).status, 403, 'rejected token');
  assert.equal((await send('bad', 'throw')).status, 403, 'verification service down -> fail closed');
  assert.equal((await send('bad', 'garbage')).status, 403, 'garbage verification answer -> fail closed');
  calls.length = 0;
  const good = await send('good', true, { 'CF-Connecting-IP': '203.0.113.9' });
  assert.equal(good.status, 202);
  const verify = calls[0];
  assert.equal(verify.url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
  const form = String(verify.init.body);
  assert.match(form, /secret=turnstile-secret-for-tests/);
  assert.match(form, /remoteip=203\.0\.113\.9/);
  const forwarded = JSON.parse(calls[1].init.body);
  assert.ok(!('cf-turnstile-response' in forwarded), 'the challenge token is not forwarded to the workflow');
});

test('proxy: the optional rate-limit binding is keyed by client address and blocks with Retry-After', async () => {
  const seen = [];
  const limiter = { limit: async ({ key }) => { seen.push(key); return { success: key !== '198.51.100.7' }; } };
  const env = Object.assign({}, ENV, { RATE_LIMITER: limiter });
  const f = upstream(202);
  const blocked = await run(req(FORM, { headers: { 'CF-Connecting-IP': '198.51.100.7' } }), env, f);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.headers.get('Retry-After'), '60');
  assert.equal(f.calls.length, 0);
  const allowed = await run(req(FORM, { headers: { 'CF-Connecting-IP': '203.0.113.1' } }), env, f);
  assert.equal(allowed.status, 202);
  assert.deepEqual(seen, ['198.51.100.7', '203.0.113.1']);
  await run(req(FORM), env, f);
  assert.equal(seen[2], 'unknown');
});

test('proxy: upstream answers are translated, never relayed', async () => {
  const cases = [
    [200, { ok: true, duplicate: true }, 202, { ok: true }],
    [202, { ok: true }, 202, { ok: true }],
    [429, { ok: false, error: 'rate_limited' }, 429, { ok: false, error: 'rate_limited' }],
    [503, { ok: false, error: 'in_progress', retry_after_seconds: 30 }, 503, { ok: false, error: 'in_progress' }],
    [401, { message: 'Authorization data is wrong!' }, 502, { ok: false, error: 'upstream_error' }],
    [403, { message: 'Forbidden' }, 502, { ok: false, error: 'upstream_error' }],
    [404, { message: 'webhook not registered' }, 502, { ok: false, error: 'upstream_error' }],
    [409, { ok: false, error: 'identifier_conflict' }, 502, { ok: false, error: 'upstream_error' }],
    [413, { ok: false }, 502, { ok: false, error: 'upstream_error' }],
    [500, { message: 'Error in workflow', stack: 'at Object.<anonymous> (/home/node/...)' }, 502, { ok: false, error: 'upstream_error' }]
  ];
  for (const [up, upBody, code, body] of cases) {
    const res = await run(req(FORM), ENV, upstream(up, upBody));
    assert.equal(res.status, code, 'upstream ' + up);
    assert.deepEqual(await json(res), body, 'upstream ' + up);
    if (code === 503) assert.equal(res.headers.get('Retry-After'), '30');
    if (code === 429) assert.equal(res.headers.get('Retry-After'), '60');
  }
});

test('proxy: field-level validation messages are relayed bounded; anything odd is dropped', async () => {
  const many = Array.from({ length: 40 }, (_, i) => 'campo_' + i + ': ' + 'x'.repeat(500));
  const res = await run(req(FORM), ENV, upstream(422, { ok: false, errors: many }));
  const body = await json(res);
  assert.equal(res.status, 422);
  assert.equal(body.errors.length, 10);
  assert.ok(body.errors.every((e) => e.length <= 200));
  const odd = await run(req(FORM), ENV, upstream(422, { errors: 'not an array', message: TOKEN }));
  assert.deepEqual(await json(odd), { ok: false, errors: [] });
  const notJson = await run(req(FORM), ENV, async () => new Response('<html>oops</html>', { status: 422 }));
  assert.deepEqual(await json(notJson), { ok: false, errors: [] });
});

test('proxy: network failure or timeout upstream becomes 502 without detail', async () => {
  for (const err of [new Error('connect ECONNREFUSED 10.0.0.1:5678 ' + TOKEN), Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })]) {
    const res = await run(req(FORM), ENV, async () => { throw err; });
    assert.equal(res.status, 502);
    const text = await res.text();
    assert.deepEqual(JSON.parse(text), { ok: false, error: 'upstream_unavailable' });
    assert.ok(!text.includes('ECONNREFUSED') && !text.includes(TOKEN));
  }
});

test('proxy: the forwarded request carries a timeout signal and exactly the expected headers', async () => {
  const f = upstream(202);
  await run(req(FORM), ENV, f);
  const init = f.calls[0].init;
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(init.headers).sort(), ['Content-Type', 'X-Webhook-Token']);
  assert.equal(init.headers['Content-Type'], 'application/json');
});

test('proxy: the default export is a Worker-style fetch handler', async () => {
  const { default: worker } = await load();
  assert.equal(typeof worker.fetch, 'function');
  const res = await worker.fetch(req(FORM, { origin: 'https://evil.example' }), ENV);
  assert.equal(res.status, 403);
});
