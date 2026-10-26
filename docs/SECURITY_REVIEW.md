# Security review of v1.0 and the changes in v1.1.0

Date: 2026-10-26. Reviewer: an AI coding agent working under the repository owner's instructions (code review plus automated tests). This is a design and code review, **not** a penetration test, and it was not performed by an independent security professional.

## Scope and method

- Reviewed: `src/lead-core.js`, the Code-node glue in `src/nodes/`, the generated n8n export, the Google Sheets layout, the prompt and its validation, the CI configuration and the documentation.
- Method: read the code, wrote an attack-oriented test for each finding, fixed what could be fixed in the repository, ran the tests.
- **Not done:** no traffic was sent to the live webhook of the owner's n8n instance, no load test, no attempt to attack the AI provider or Google. The published v1.0 workflow was **not modified**.
- Nothing here is a claim of "secure" or "compliant". The aim is to show which risks were found, what was changed and what remains.

## Severity scale

Judgement of the reviewer, not CVSS. It combines how bad the outcome is with how easy it is to cause, for a small deployment that handles real leads.

| Level | Meaning |
| --- | --- |
| High | An unauthenticated or low-effort actor can cause data corruption, cost, or exposure of personal data. |
| Medium | Needs unusual input, a specific setup, or only weakens another control. |
| Low | Defence in depth; hard to exploit on its own. |
| Info | Operational or process finding. |

No Critical finding was identified.

## Summary

| ID | Severity | Finding | Status in this branch |
| --- | --- | --- | --- |
| LF-01 | High | A webhook token that has been pasted into a chat or a browser form must be treated as exposed | **Open** (rotation declined by the owner; see below) |
| LF-02 | High | No limits on request size, field count or unknown fields | Fixed, tested |
| LF-03 | High | Two simultaneous identical submissions could both be processed | Mitigated; proven only in simulation |
| LF-04 | High | A public web form cannot keep the webhook token secret | Reference proxy added; **not deployed** |
| LF-05 | Medium | Personal data written inside the free-text message reached the AI provider | Fixed, tested |
| LF-06 | Medium | Prompt-injection detection looked only at plain text | Improved, tested; not a guarantee |
| LF-07 | Medium | Client-declared consent was stored as if it were a fact | Fixed (recorded as "declared") |
| LF-08 | Medium | Error rows could contain secrets or unbounded provider text; no error workflow, no timeouts | Fixed, tested |
| LF-09 | Medium | Transient Google Sheets failures stopped an execution without retry | Fixed in the export; real behaviour not re-verified |
| LF-10 | Low | The run mode was derived from request data | Fixed |
| LF-11 | Low | Spreadsheet formula injection was flagged but the cell was stored as received | Fixed (neutralised, reversed on read) |
| LF-12 | Low | No lint, no dependency or code scanning, CI permissions not pinned | Fixed (CI added; see LF-14) |
| LF-13 | Info | The published workflow is still v1.0 | **Open**: needs the owner's authorisation |
| LF-14 | Info | Repository settings that need the owner (Dependabot security updates, branch protection, private vulnerability reporting) | **Open** |
| LF-15 | Info | The in-workflow rate limit is best effort | Documented limitation |

## Findings

### LF-01 (High, open): exposed webhook token

A value of the webhook credential was shared in a chat during development. Anyone who has it can post leads to the endpoint, which fills the sheet and spends model calls. The owner decided not to rotate it. That decision is respected; the token is **not** stored in the repository, in the docs or in this report.

Mitigations in v1.1: size and field limits (LF-02), a throttle and a per-contact limit (LF-15), duplicates ignored, and a human always reviewing before anything is sent. None of them replaces rotation.

To close it: create a new random value in the n8n credential *LeadFlow webhook token*, update the client, and treat the old value as burnt. `docs/SETUP.md` step 2 explains how.

### LF-02 (High, fixed): no request limits

v1.0 accepted any JSON object and silently ignored extra fields. v1.1 enforces a strict schema (`schemas/lead-request.schema.json`): unknown fields are rejected with 422, more than 20 fields or more than 20 000 characters with 413, wrong types with 422, per-field caps, and hidden characters are measured on the raw text. Values are never echoed back in error responses.

Tests: `tests/security.test.js` (schema, type confusion, prototype-pollution keys, oversize), `tests/core.test.js`.

Residual: n8n Cloud applies its own body limit before the workflow runs; that setting is outside the repository.

### LF-03 (High, mitigated): simultaneous identical submissions

Google Sheets has no unique constraint. Two executions that read the history before either had written would both create a lead, a task and a model call. v1.1 adds a `claims` tab and an insert-then-verify arbitration (see [CONCURRENCY.md](CONCURRENCY.md)). The relational option in `db/` uses `UNIQUE` plus `INSERT ... ON CONFLICT DO NOTHING`, which is the correct answer for real concurrency.

Verified: interleaved executions in a simulator, including crashes of the winner (`tests/concurrency.test.js`); the SQL option on a SQLite stand-in (`tests/db.test.js`).

**Not verified:** that appends and reads on a real Google Sheet behave as the arbitration assumes (atomic append, read-your-writes). The problem is therefore **not claimed as solved**. Use the PostgreSQL option for a production system with real concurrency.

### LF-04 (High, reference only): public forms and the token

A browser form that posts straight to the webhook has to contain the token, which any visitor can read. v1.1 ships `proxy/worker.mjs`, a Cloudflare Worker reference that keeps the token server-side, checks the origin, caps the body size and normalises types. It is tested with mocks (`tests/proxy.test.js`) and **has not been deployed or run against a real Cloudflare account**. A bot-protection challenge and a verifiable consent log are described as future work.

### LF-05 (Medium, fixed): personal data in free text

v1.0 kept name, e-mail, phone and company out of the request but sent the message as written. People write "call me on 600 123 456" or "I am Marta from Acme". v1.1 replaces e-mail addresses, links, phone numbers, the sender's own name tokens and the company name with placeholders before the request, and validates the answer against the redacted text. The model prompt is told to treat placeholders as opaque.

Tests: `tests/security.test.js` (privacy section). Residual: other people's names, addresses or health details written in the message are not detected.

### LF-06 (Medium, improved): prompt injection

Detection now runs on several normalised views (diacritics folded, homoglyphs, leetspeak, spaced letters), decodes base64, hex and percent-encoded blobs once, reads Unicode tag characters, and looks for structural markers that try to close the delimiter or fake a chat role. A hit **only** sets a human-review flag and discards the model's intent; the score is computed by deterministic rules and the model cannot set the priority. Quotes from the model must exist in the message.

Tests: direct, indirect, multilingual, encoded and hidden-instruction cases in `tests/security.test.js`.

Residual: detection is best effort. A new phrasing can pass; the design assumption is that it cannot do more than produce a wrong signal that a person reviews before any message is sent.

### LF-07 (Medium, fixed): consent recorded as a fact

`consent_to_contact: true` from a client is only a claim. v1.1 stores `consent_declared`, an evidence level (`none`, `declared_only`, `declared_partial`, `declared_with_provenance`), the notice version and timestamp the caller supplied, and says in the docs that the workflow cannot verify consent. Consent does not change the score. Without a declaration no task is created.

This is **not** a GDPR compliance feature; see [PRIVACY.md](PRIVACY.md).

### LF-08 (Medium, fixed): error content, timeouts

Errors are reduced to a fixed set of fields, scrubbed of bearer tokens, JWTs, API-key shapes, `key=value` secrets, long opaque strings and e-mail addresses, and cut to 300 characters. The workflow has an execution timeout (240 s) and an optional error-handler workflow that writes a bounded row (failing node, message, execution id; never the request body or stack trace). Successful executions are not stored.

Residual: n8n stores **failed** executions, including their data, according to the instance settings. Set retention there.

### LF-09 (Medium, fixed in the export)

The nine Google Sheets nodes and the model call retry three times with a 2-second pause. Lead status transitions are written so that a failure between "recorded" and "task created" leaves a row the retry path can pick up (`tests/resilience.test.js`). Real Google API failures were not injected.

### LF-10 (Low, fixed): mode from request data

v1.0 decided between "web" and "retry" with `$json.body !== undefined`. Nothing the caller sends can now select the retry path: each trigger passes through its own constant Set node.

### LF-11 (Low, fixed): formula injection

Cells starting with `=`, `+`, `-`, `@`, tab or carriage return are prefixed with an apostrophe when written and restored when read back; the flag `formula_like` is raised. Tests: `tests/security.test.js`.

### LF-12 (Low, fixed): CI and static checks

`.github/workflows/ci.yml` (build check, lint, tests, `npm audit`, pinned action SHAs, `permissions: contents: read`, timeouts), `codeql.yml`, `dependabot.yml`. There are no runtime dependencies. CodeQL may conflict with GitHub's *default setup* if that is enabled in the repository settings; check the first run.

### LF-13 (Info, open): the published workflow is v1.0

The workflow running in the owner's n8n Cloud instance was **intentionally not changed**: the mission forbids deploying to production without explicit authorisation. v1.1 needs a new sheet tab and columns, so importing it also needs manual steps (see [SETUP.md](SETUP.md)).

### LF-14 (Info, open): repository settings

Checked through the API in this session: secret scanning and push protection are enabled; Dependabot security updates are disabled; the repository has no description or topics. Branch protection, required reviews and private vulnerability reporting need the owner (they are not part of the code).

### LF-15 (Info): throttle is best effort

The workflow-level throttle (120 requests per 10 minutes) and per-contact limit (10) live in n8n workflow static data. Concurrent executions can overwrite each other's counter. They limit cost; they are **not** a defence against a distributed or determined attacker. Do not describe them as DDoS protection. Real rate limiting belongs at the edge (the proxy, a CDN or WAF).

## What remains open

1. Rotate the exposed token (LF-01).
2. Import v1.1 into n8n after reading [SETUP.md](SETUP.md) (LF-13), then repeat the live checks listed in [TEST_REPORT.md](TEST_REPORT.md).
3. Deploy an edge proxy if the form is public (LF-04).
4. Move to PostgreSQL if concurrent traffic is real (LF-03).
5. Decide the retention period for the sheet and for n8n error executions.
6. Complete the repository settings (LF-14).
7. A legal review before processing real personal data.
