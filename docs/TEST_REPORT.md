# Test report

Last run: 85 tests, 85 passed, 0 failed (`npm test`, Node 20+, about 1 s, no network).

## Legend

- **Simulated**: runs the real project code, but Google Sheets, the AI API and n8n itself are replaced by in-memory fakes.
- **Verified on the real service**: executed against the real third-party service with fictional data.

## Simulated tests (85)

| Area | What is checked |
| --- | --- |
| Hashing | SHA-256 implementation equals Node `crypto` on varied inputs, including non-ASCII. |
| Validation and normalisation | Required fields, e-mail format, wrong types, truncation, invisible characters, hidden HTML, phone and consent parsing. |
| Sensitive data | Card (Luhn), IBAN and ID-like numbers are masked before anything else uses the text. |
| Injection | Spanish and English injection phrases flagged, honest messages not flagged. |
| Duplicates and retries | New, repeated, same person with a new message, stale `recibido`, id collision, exhausted retries, placeholder rows from an empty lookup. |
| AI request and validation | Only the cleaned message is sent; strict schema; fabricated quotes, products, figures and links are caught; invalid enums; low confidence; malformed, empty and truncated replies. |
| Scoring | Every rule, maximum 100, inclusive thresholds at 70 and 40, caps for spam and disposable e-mails, firmographics alone never reach `alta`, breakdown reconstructs the score. |
| Drafts | Spanish and English, no prices, dates, links or promises, hostile names cannot inject markup. |
| Export | Workflow JSON and CSV templates match `src/`; unique node names; valid connections; no send-mail nodes; no secrets or sheet ids; webhook auth; every Sheets write maps all columns; AI node has timeout, retries and throttling. |
| End-to-end flow on a vm simulator | The real generated Code-node code runs in order: accepted lead, invalid lead, 10 repeats, repeat contact, AI outage with bounded retries, recovery, stale `recibido`, malicious lead, no personal identifiers to the AI, no consent, formula-like cells, 100 distinct leads. |
| Demo data | Demo leads behave as documented and contain no secrets. |

The simulator does **not** interpret IF, Respond to Webhook or Google Sheets expressions, and it cannot reproduce n8n's item pairing or real API quirks.

## Verified on the real service

| Check | Result |
| --- | --- |
| Workflow created in an n8n Cloud instance through the n8n API (25 nodes, 24 connections) | Done. Deployed Code nodes and parameters were compared with the committed export and match. |
| Groq call with the exact production request (model `openai/gpt-oss-120b`, `reasoning_effort`, `max_completion_tokens`, strict `json_schema`) and a fictional lead | Done. HTTP 200, valid JSON that follows the schema, about 1 s. |
| Real model answer through the validation and scoring code | Done, and it found a bug: the model quoted "Podéis" while the message said "Podeis", so the evidence check would have discarded a correct intent. Matching is now accent-insensitive (regression test added). |
| Full path in the real n8n engine with the webhook, Google Sheets nodes and the AI node **pinned** (Code, Set and IF nodes run for real) | Done twice. Fictional hot lead: score 90, priority `alta`, task `llamar`, due in 4 h, draft pending approval. |
| Real end-to-end runs in n8n (manual executions fed with the webhook payload; real Google Sheets and real Groq, fictional leads) | Done. Hot lead: row in `leads` (status `tarea_creada`, score 90, `alta`) and a pending task with draft in `seguimiento`. Same lead sent again: ignored as `duplicado`, no new rows. Lead without e-mail: rejected, nothing written. Prompt-injection lead: flagged `posible_inyeccion`, intent ignored, score 7, `baja`, task `revisar_manual` with human review. Lead without consent: scored (`media`, 45), status `sin_consentimiento`, no task. |
| Google Sheets mapping without column schema, RAW cell format, lookup by `lead_id`, upsert by key | Confirmed by the runs above. |
| Published webhook called from outside n8n with the header token (PowerShell, fictional lead) | Done. First call created the lead and its task in the real sheet; two repeats answered `200` and created nothing. The `202` body, the `422` response and a wrong-token `403` were not checked from outside. |
| Retry trigger on a sheet with a failed row (a fictional `error_ia` row was added by hand) | Done. The row was re-analysed, became `tarea_creada` and got a task; its history keeps the earlier `error_ia`. The model proposed a product that is not in the message, and the validation removed it and flagged `producto_no_verificado` for review. |

## What is still missing

1. Run `npm run demo:send` against the published URL to check the `202`, `422` and wrong-token responses.
2. Force a real AI failure (for example a wrong key) and confirm that the lead is stored as `error_ia` with a row in `errores`.
3. Record the real outcomes in this table.
