/*
 * LeadFlow Sales AI - public form proxy (reference implementation for Cloudflare Workers).
 *
 * Why it exists: the n8n webhook needs a secret header. A browser must never hold that secret, so a public
 * web form posts to this proxy instead. The proxy keeps the token in a server-side secret, enforces size and
 * origin limits, drops every field the workflow does not accept, stamps the consent provenance itself and
 * forwards the request. It is deliberately small and has no dependencies.
 *
 * Status: tested with mocks (tests/proxy.test.js). It has NOT been deployed anywhere by this project.
 *
 * Environment (secrets and variables):
 *   WEBHOOK_URL               production URL of the n8n webhook                      (secret)
 *   WEBHOOK_TOKEN             value of the Header Auth credential in n8n             (secret)
 *   ALLOWED_ORIGINS           comma-separated list, e.g. https://www.example.com     (variable)
 *   CONSENT_NOTICE_VERSION    version id of the privacy notice shown next to the form (variable)
 *   MAX_BODY_BYTES            optional, default 8192
 *   TURNSTILE_SECRET          optional: enables Cloudflare Turnstile verification    (secret)
 *   RATE_LIMITER              optional: Cloudflare Rate Limiting binding              (binding)
 */

const ALLOWED_FIELDS = ['full_name', 'email', 'company', 'phone', 'message', 'source', 'budget_range', 'timeframe', 'company_size', 'consent_to_contact'];
const HONEYPOT_FIELDS = ['website', 'url', 'hp'];

function json(status, body, extra) {
  return new Response(JSON.stringify(body), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }, extra || {})
  });
}

function corsHeaders(origin) {
  return { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' };
}

export async function handle(request, env, deps) {
  const doFetch = (deps && deps.fetch) || fetch;
  const now = (deps && deps.now) ? deps.now() : new Date();
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = request.headers.get('Origin') || '';
  const originOk = allowed.includes(origin);
  const cors = originOk ? corsHeaders(origin) : {};

  if (request.method === 'OPTIONS') {
    if (!originOk) return json(403, { ok: false, error: 'origin_not_allowed' });
    return new Response(null, { status: 204, headers: Object.assign({ 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }, cors) });
  }
  if (request.method !== 'POST') return json(405, { ok: false, error: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
  // The Origin header is only enforced by browsers. It stops other websites from using this endpoint
  // from a visitor's browser; it does not authenticate non-browser clients (rate limiting and Turnstile do that job).
  if (!originOk) return json(403, { ok: false, error: 'origin_not_allowed' });
  if (!String(request.headers.get('Content-Type') || '').toLowerCase().startsWith('application/json')) return json(415, { ok: false, error: 'json_required' }, cors);

  const maxBytes = Number(env.MAX_BODY_BYTES) || 8192;
  const declared = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(declared) && declared > maxBytes) return json(413, { ok: false, error: 'payload_too_large' }, cors);

  if (env.RATE_LIMITER) {
    const key = request.headers.get('CF-Connecting-IP') || 'unknown';
    const verdict = await env.RATE_LIMITER.limit({ key });
    if (!verdict.success) return json(429, { ok: false, error: 'rate_limited' }, Object.assign({ 'Retry-After': '60' }, cors));
  }

  const text = await readLimited(request, maxBytes);
  if (text === null) return json(413, { ok: false, error: 'payload_too_large' }, cors);
  let body;
  try { body = JSON.parse(text); } catch (e) { return json(400, { ok: false, error: 'invalid_json' }, cors); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json(400, { ok: false, error: 'invalid_json' }, cors);

  // Honeypot: bots fill hidden fields. Pretend success and forward nothing.
  if (HONEYPOT_FIELDS.some((f) => typeof body[f] === 'string' && body[f].trim() !== '')) return json(202, { ok: true }, cors);

  if (env.TURNSTILE_SECRET) {
    const token = typeof body['cf-turnstile-response'] === 'string' ? body['cf-turnstile-response'] : '';
    const ok = token && await verifyTurnstile(doFetch, env.TURNSTILE_SECRET, token, request.headers.get('CF-Connecting-IP'));
    if (!ok) return json(403, { ok: false, error: 'challenge_failed' }, cors);
  }

  // Whitelist: nothing else is forwarded. In particular the caller cannot choose the consent provenance.
  const clean = {};
  ALLOWED_FIELDS.forEach((f) => { if (body[f] !== undefined) clean[f] = body[f]; });
  // Strict on purpose: only the boolean true or the string "true" count. Arrays, numbers and objects never coerce into consent.
  const raw = clean.consent_to_contact;
  const consent = raw === true || (typeof raw === 'string' && raw.trim().toLowerCase() === 'true');
  clean.consent_to_contact = consent;
  if (consent && env.CONSENT_NOTICE_VERSION) {
    clean.consent_notice_version = String(env.CONSENT_NOTICE_VERSION);
    clean.consent_given_at = now.toISOString();
  }

  let upstream;
  try {
    upstream = await doFetch(env.WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': env.WEBHOOK_TOKEN },
      body: JSON.stringify(clean),
      signal: AbortSignal.timeout(10000)
    });
  } catch (e) {
    return json(502, { ok: false, error: 'upstream_unavailable' }, cors);
  }

  if (upstream.status === 202 || upstream.status === 200) return json(202, { ok: true }, cors);
  if (upstream.status === 422) {
    // Only field-level validation messages are relayed, bounded in size.
    let errors = [];
    try { const j = await upstream.json(); if (Array.isArray(j.errors)) errors = j.errors.slice(0, 10).map((x) => String(x).slice(0, 200)); } catch (e) { /* keep empty */ }
    return json(422, { ok: false, errors }, cors);
  }
  if (upstream.status === 429) return json(429, { ok: false, error: 'rate_limited' }, Object.assign({ 'Retry-After': '60' }, cors));
  // The workflow answers 503 while an identical submission is still being stored (for example a double click).
  // The page may retry once after the delay and will then be told the lead is already known.
  if (upstream.status === 503) return json(503, { ok: false, error: 'in_progress' }, Object.assign({ 'Retry-After': '30' }, cors));
  // Anything else (401/403 from a wrong token, 5xx, ...) is an operator problem: nothing from upstream is relayed.
  return json(502, { ok: false, error: 'upstream_error' }, cors);
}

async function readLimited(request, maxBytes) {
  const reader = request.body && request.body.getReader ? request.body.getReader() : null;
  if (!reader) return '';
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { try { await reader.cancel(); } catch (e) { /* ignore */ } return null; }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  chunks.forEach((c) => { all.set(c, off); off += c.byteLength; });
  return new TextDecoder().decode(all);
}

async function verifyTurnstile(doFetch, secret, token, ip) {
  try {
    const form = new URLSearchParams({ secret, response: token });
    if (ip) form.set('remoteip', ip);
    const res = await doFetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const j = await res.json();
    return j && j.success === true;
  } catch (e) { return false; }
}

export default { fetch: (request, env) => handle(request, env) };
