# Data schema

Four tabs in one Google Sheet. Column names are fixed (they are the keys the workflow reads and writes); the order does not matter. Statuses and flags are Spanish keywords; booleans are written as `sí` / `no`; lists are joined with `; `. The header lines are generated into `templates/*.csv`, and the JSON Schema of the request is in [`schemas/lead-request.schema.json`](../schemas/lead-request.schema.json).

## Webhook request

The schema is **strict**: any field not listed here is rejected with 422. Only strings are accepted for text fields (numbers only for `phone`); `consent_to_contact` may be a boolean, string or number.

| Field | Required | Notes |
| --- | --- | --- |
| `full_name` | yes | At least 2 characters including a letter, max 120. |
| `email` | yes | Validated, lower-cased, max 254. |
| `message` | yes | At least 10 characters. Raw input beyond 8000 characters is cut first (flag `campo_truncado`); the cleaned text is truncated at 2000 (flag `mensaje_truncado`). |
| `company` (160), `phone` (40), `source` (60) | no | `source` defaults to `web`. Phone is normalised to digits with an optional `+` (7 to 15 digits). |
| `budget_range` | no | `lt_1k`, `1k_5k`, `5k_20k`, `gte_20k`. Unknown values are ignored with a warning. |
| `timeframe` | no | `immediate`, `short`, `long`. |
| `company_size` | no | `1_10`, `11_50`, `51_200`, `gt_200`. |
| `consent_to_contact` | no | `true`, `yes`, `si`, `sí`, `1`, `on`, `y`, `accepted` count as a **declaration**. Anything else is no declaration. |
| `consent_notice_version` | no | Version id of the privacy notice the person saw: letters, digits, `.`, `_`, `-`, up to 40 characters. Invalid values are ignored with a warning. |
| `consent_given_at` | no | ISO date of the acceptance; implausible dates are ignored with a warning. |

Hard limits: at most 20 fields and 20 000 characters in the body (413).

## Responses

| Code | Body | Meaning |
| --- | --- | --- |
| 202 | `{ok, status:"accepted", submission_id}` | New lead stored as `recibido`; processing continues after the answer. |
| 200 | `{ok, duplicate:true}` | Already known (finished, in progress, queued for retry or awaiting a person). |
| 409 | `{ok:false, error:"identifier_conflict"}` | Same submission id with a different e-mail (hash collision). Nothing written. |
| 413 | `{ok:false, errors:[...]}` | Body too large or too many fields. |
| 422 | `{ok:false, errors:[...]}` | Validation failed. Messages name fields, never echo values. |
| 429 | `{ok:false, error:"rate_limited"}` | Workflow throttle or per-contact limit. |
| 503 | `{ok:false, error:"in_progress", retry_after_seconds:30}` | Another execution is storing the same lead. Retry. |
| 401 / 403 | n8n | Missing or wrong token (answered by n8n before the workflow runs). |

## Tab `leads` (one row per submission)

| Column | Meaning |
| --- | --- |
| `submission_id` | Primary key: `lead_id` plus a hash of e-mail, message and source. |
| `lead_id` | Stable id per e-mail address. |
| `content_hash` | SHA-256 of e-mail, normalised message and source. |
| `received_at`, `updated_at` | ISO timestamps (UTC). |
| `status` | `recibido`, `tarea_creada`, `sin_consentimiento`, `error_ia`, `error_validacion_ia`, `error_definitivo`. |
| `status_history` | `status@timestamp` entries joined with ` > ` (also `clasificado` and `puntuado` steps). |
| `human_review_required`, `review_reasons` | Review flag and the flags that caused it. |
| `priority`, `score`, `score_breakdown` | `alta` / `media` / `baja`, 0-100, and the points per rule. |
| `intent`, `intent_evidence` | Model signal and the verbatim quote that supports it. |
| `timeframe`, `timeframe_source` | Value and where it came from (`form`, `ai`, `none`). |
| `budget_range`, `budget_source` | Same for budget. |
| `company_size` | From the form only. |
| `product_interest`, `summary`, `missing_information` | Verified product text, short summary, what the team should ask. |
| `language`, `ai_confidence`, `ai_model` | Detected language, model confidence, model id. |
| `flags` | All flags raised. |
| `retry_count`, `last_error` | Failed attempts and the last bounded, scrubbed error message. |
| `full_name`, `email`, `company`, `phone`, `message`, `source` | Cleaned input. |
| `consent_declared` | `sí` / `no`: whether the caller **declared** consent. Not verified. |
| `consent_notice_version`, `consent_given_at` | What the caller supplied, if plausible. |
| `consent_evidence` | `none`, `declared_only`, `declared_partial`, `declared_with_provenance`. |

Cells holding sender- or model-controlled text that start with `=`, `+`, `-` or `@` are stored with a leading apostrophe and restored when read.

## Tab `seguimiento` (follow-up tasks)

`task_id` (`T-` plus the submission id), `submission_id`, `lead_id`, `created_at`, `due_at` (SLA: alta 4 h, media 24 h, baja 72 h), `priority`, `score`, `task_type` (`llamar`, `enviar_email`, `nutrir`, `revisar_manual`), `status` (`pendiente_aprobacion` or `revision_humana`), `assignee`, `human_review_required`, `review_notes`, contact fields, `summary`, `product_interest`, `missing_information`, `consent_evidence`, `draft_subject`, `draft_body`.

The draft comes from templates in code (Spanish or English) using only verified words. A person edits and sends it.

## Tab `errores`

`error_id`, `timestamp`, `stage` (`analisis_ia`, `validacion_ia`, or `ejecucion_fallida` for a row written by the optional error workflow, whose `status` is `error_ejecucion`), `submission_id`, `lead_id`, `status`, `retry_count`, `message` (secrets and e-mail addresses scrubbed, max 300 characters), `execution_id`.

## Tab `claims` (duplicate arbitration)

`claim_key` (`submission_id#retry_count`), `submission_id`, `claim_id` (unique per execution), `claimed_at`. Written by every execution that is about to process a lead; the first eligible row in sheet order wins (see [CONCURRENCY.md](CONCURRENCY.md)). Old rows are harmless and can be deleted.
