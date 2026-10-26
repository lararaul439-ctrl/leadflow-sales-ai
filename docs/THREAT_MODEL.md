# Threat model

Scope: LeadFlow Sales AI v1.1.0 as shipped in this repository: an n8n workflow, a Google Sheet, an LLM provider (Groq) and an optional edge proxy. This is a working model for a small deployment, not a certification. Findings and their status are in [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## What is being protected

| Asset | Why it matters |
| --- | --- |
| Lead data (name, e-mail, phone, company, message) | Personal data of third parties. |
| The Google Sheet | The only store. Its integrity decides what sales people act on. |
| Credentials (webhook token, Groq key, Google OAuth) | Spend, abuse and data access. |
| Sales team's time and trust | Spam, fake urgency and wrong priorities waste both. |
| The sender's reputation | A message sent by mistake to the wrong person. The workflow never sends one; a person does. |

## Actors

| Actor | Assumed capability |
| --- | --- |
| Anonymous visitor | Can read the public form and its source code. Can post anything the form lets them. |
| Holder of the token | Can post any payload to the webhook. Treated as hostile for content, trusted only to be allowed in. |
| Malicious lead author | Writes the message text. Tries prompt injection, spreadsheet formulas, personal-data bait, oversized or odd Unicode input. |
| Compromised or faulty model | Returns malformed JSON, invented facts or text that follows an injected instruction. |
| Curious insider | Has read access to the sheet or n8n. Not defended against beyond data minimisation. |
| Outage | Google, Groq or n8n unavailable or throttling. |

Out of scope: a compromised n8n instance or Google account, a malicious model provider, and physical access.

## Trust boundaries and data flow

```
Visitor ──(1)──► [optional proxy] ──(2)──► n8n webhook ──(3)──► Code nodes ──(4)──► Google Sheets
                                                              │
                                                              └──(5)──► LLM provider (redacted text only)
Sales person ◄──(6)── reads tasks and drafts, edits and sends them themselves
```

1. Internet to proxy: untrusted input.
2. Proxy to webhook: authenticated with the token (header auth).
3. Everything inside the Code nodes: input is data, never instructions.
4. Writes to the sheet: cell content is neutralised against formula injection.
5. To the provider: name, company, e-mail, phone and links are removed or replaced before the request.
6. Human review is the final control: there is no node that sends a message.

## Threats and controls

| # | Threat | Control | Evidence | Residual risk |
| --- | --- | --- | --- | --- |
| T1 | Unauthenticated posts | Header-auth token on the webhook | n8n feature; export contains no secret (`tests/workflow.test.js`) | Token exposure (LF-01); the token cannot be hidden in a browser form (LF-04) |
| T2 | Flooding to spend model calls or fill the sheet | Size and field limits, workflow throttle, per-contact limit, duplicate suppression; optional edge proxy | `tests/security.test.js` (schema, throttle) | The throttle is best effort and not a security boundary (LF-15) |
| T3 | Malformed or smuggled fields (type confusion, `__proto__`, extra fields, huge strings) | Strict schema, 422/413, no echo of values | `tests/security.test.js` | n8n's own body limit is not controlled here |
| T4 | Forged server-side state (ids, status, score, review flag, consent evidence, run mode) | Everything derived server-side; unknown fields rejected; mode set by constant nodes | `trust:` tests; `tests/workflow.test.js` graph tests | None known |
| T5 | Duplicate or simultaneous submissions | Deterministic ids, history lookup, claim arbitration, optional SQL unique key | `tests/core.test.js`, `tests/concurrency.test.js`, `tests/db.test.js` | Sheets atomicity not verified (LF-03) |
| T6 | Prompt injection in the message, hidden or encoded | Multi-view detection, structural-marker checks, delimiter with angle brackets removed, schema-bound output, evidence quotes must exist, deterministic scoring, flagged leads go to review | 22 attack variants in `tests/security.test.js` | Novel phrasings can evade detection; mitigated by the human gate |
| T7 | Model returns garbage, invented facts or follows the injection | Strict output validation, evidence and figure checks, unknown fields flagged, bounded retries, `error_definitivo` | `tests/core.test.js`, `tests/resilience.test.js` | Model quality is not tested against a live model in this branch |
| T8 | Personal data sent to the provider | Redaction before the request; validation against the redacted text | `privacy:` tests | Third-party personal data inside the message is not detected |
| T9 | Spreadsheet formula injection | Neutralise on write, restore on read, flag | `formula injection:` tests | Behaviour in every spreadsheet product is not tested |
| T10 | Secrets in logs, error rows or the repository | Scrubbing, whitelisted error fields, bounded text; secret-pattern scan of tracked files; GitHub push protection | `secrets:` tests, `tests/hygiene.test.js` | Failed n8n executions keep their data until the instance's retention deletes it |
| T11 | Partial failure leaves inconsistent state | Write order (task before final lead state), `recibido` as recoverable state, retry path, optional error workflow | `tests/resilience.test.js` | Real Google failures not injected |
| T12 | Provider outage, 429, 500, timeouts | Retries with pause, timeouts, error statuses, bounded manual retry | `tests/resilience.test.js` (simulated) | Real provider behaviour not exercised in this branch |
| T13 | Supply chain | No runtime dependencies; pinned action SHAs; Dependabot version updates; CodeQL; `npm audit` | `.github/` | Dependabot security updates are off in the repository settings (LF-14) |
| T14 | A person sends a wrong or harmful draft | Drafts are templates built only from verified words; tasks are `pendiente_aprobacion`; no automated sending | `tests/core.test.js` | A person can still click send on a bad draft |

## Assumptions

- The n8n instance, the Google account and the sheet's sharing settings are controlled by the owner.
- The token is long, random and not reused.
- The model provider processes the redacted text under terms the owner has accepted.
- The sales team reviews tasks flagged `revision_humana` before acting.

## Not covered

Denial of service at network level, insider abuse, legal basis for processing, retention enforcement, and the security of the Google, Groq and n8n platforms themselves.
