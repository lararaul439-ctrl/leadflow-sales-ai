# Changelog

Format based on [Keep a Changelog](https://keepachangelog.com/). Versions follow `CONFIG.version` in `src/lead-core.js`.

## [1.1.0] - 2026-10-26

Security hardening and professionalisation. The workflow export changed shape: **importing it needs a new `claims` tab and extra columns** (see [docs/SETUP.md](docs/SETUP.md)). The workflow already running in an n8n instance is not touched by this release.

### Security

- Strict request schema: unknown fields, wrong types, oversize bodies and too many fields are rejected (422/413) and values are never echoed. JSON Schema in `schemas/lead-request.schema.json`.
- Server-derived state: ids, status, score, review flag and the run mode can no longer be influenced by the caller.
- Data minimisation: e-mail addresses, phone numbers, links, the sender's name and the company name are replaced by placeholders before the model sees the message; the model answer is validated against that same text.
- Prompt-injection analysis on several normalised views, with decoding of base64/hex/percent blobs, Unicode tag characters and structural markers; a hit forces human review and discards the model's intent. Scoring stays deterministic.
- Consent is recorded as **declared by the caller**, with an evidence level and the notice version/time the caller supplied. It never affects the score.
- Spreadsheet formula injection: cells are neutralised on write and restored on read.
- Error hygiene: provider errors reduced to fixed fields, secrets and addresses scrubbed, text bounded, optional error-handler workflow, 240 s execution timeout, successful executions not stored.
- Best-effort throttle and a per-contact limit.
- Duplicate arbitration for simultaneous submissions through a `claims` tab (insert, then verify). Proven in simulation only; see [docs/CONCURRENCY.md](docs/CONCURRENCY.md).

### Added

- `proxy/worker.mjs`: reference edge proxy (Cloudflare Worker) that keeps the token server-side. Tested with mocks; not deployed.
- `db/`: relational schema and queries using a unique constraint, tested on a SQLite stand-in.
- Optional error-handler workflow export.
- Retries (3 attempts, 2 s pause) on Google Sheets nodes.
- Test suites: security, concurrency, resilience, proxy, db, runtime harness, hygiene.
- `tests/live/n8n-runtime-harness.js`: runs the real Code-node source inside n8n without touching any service.
- Offline demo `npm run demo:local` with canned model answers and a generated, tested `demo/expected-output.md`.
- Dependency-free ESLint configuration, CI (tests on Node 20/22/24, build check, lint, `npm audit`), CodeQL and Dependabot configuration.
- Documentation: security review, threat model, concurrency, runtime verification, Spanish README, security policy, contributing guide, architecture and evidence images.

### Changed

- The `leads` tab gains `consent_declared`, `consent_notice_version`, `consent_given_at`, `consent_evidence`; `errores` gains `execution_id`; `seguimiento` gains `consent_evidence`; new tab `claims`.
- Webhook answers: `202`, `200` duplicate, `409` identifier conflict, `413` too large, `422` invalid, `429` throttled, `503` another execution is processing the same lead.
- `consent_to_contact` of an unexpected type (object, array) is rejected with 422; the words that count as a declaration are unchanged.
- The sheet column `consent_to_contact` is replaced by `consent_declared` plus the provenance columns. A row written by v1.0 is still read correctly.

### Fixed

- The run mode (web or retry) was derived from request data; it is now set by constant nodes, one per trigger.

### Not done in this release (see the open items in [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md))

- The published workflow was not upgraded.
- The webhook token that was shared in a chat has not been rotated.
- Google Sheets append atomicity and the Groq call were not re-verified for v1.1.
- The proxy and the SQL option are not deployed.

## [1.0.0] - 2026-10-26

First version: webhook intake, validation, duplicate handling, LLM extraction with a JSON schema, evidence-checked signals, rule-based scoring, follow-up tasks with drafts pending human approval, Google Sheets storage, manual retry trigger and 85 simulated tests. Verified end to end on n8n Cloud with fictional leads.
