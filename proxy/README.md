# Public-form proxy (reference)

`worker.mjs` is a small Cloudflare Worker that sits between a public web form and the n8n webhook.

> **Status: reference implementation, tested with mocks, never deployed by this project.** It has not been run on a real Cloudflare account, and no claim is made about its behaviour under real traffic.

## Why

The webhook needs a secret header. A page that posts straight to it must contain that secret, and every visitor can read it. The proxy keeps the token in a server-side secret, so the browser only knows the proxy's URL.

## What it does

- Accepts `POST` (and the CORS preflight) from the origins listed in `ALLOWED_ORIGINS` only. The Origin check stops other **websites** from using the endpoint through a visitor's browser; it does not authenticate scripts, which is why a rate limit and a bot challenge are supported.
- Requires `application/json`, caps the body size (`MAX_BODY_BYTES`, default 8192) and drops every field the workflow does not accept.
- Treats consent strictly: only the boolean `true` or the string `"true"` counts; arrays, numbers and objects never become consent.
- Stamps the consent notice version and the time itself instead of trusting the browser.
- Honeypot: if a hidden field is filled in (bots do that), it pretends success and forwards nothing.
- Optionally verifies a Cloudflare Turnstile token and applies a Cloudflare Rate Limiting binding.
- Forwards to the webhook with the token. It answers `202` for an accepted **or** duplicate lead (so the page cannot probe which leads exist), relays at most ten bounded field messages for `422`, relays `429` and `503` with a retry delay, and turns every other upstream answer (wrong token, 5xx) into a generic `502` without details.
- Does not log, and never returns, the token or the request body.

## Configuration

| Name | Kind | Meaning |
| --- | --- | --- |
| `WEBHOOK_URL` | secret | Production URL of the n8n webhook |
| `WEBHOOK_TOKEN` | secret | Value of the Header Auth credential |
| `ALLOWED_ORIGINS` | variable | Comma-separated origins, e.g. `https://www.example.com` |
| `CONSENT_NOTICE_VERSION` | variable | Version id of the privacy notice shown next to the form |
| `MAX_BODY_BYTES` | variable | Optional |
| `TURNSTILE_SECRET` | secret | Optional; enables the challenge |
| `RATE_LIMITER` | binding | Optional; a Cloudflare Rate Limiting binding |

Set secrets with `wrangler secret put`, never in a file in the repository.

## Test it locally

```bash
node --test tests/proxy.test.js
```

The tests call `handle(request, env, deps)` with a fake `fetch`.

## Before using it for real

1. Deploy to your own Cloudflare account and run a manual end-to-end check with fictional data.
2. Add the challenge (Turnstile) and a rate limit; both are optional in the code on purpose.
3. Keep a verifiable record of consent in your own system; the proxy only forwards a declaration.
4. Review the privacy notice that the form shows, with legal advice.
