# Data schema

Three tabs in one Google Sheet. Column names are fixed (they are the keys used by the workflow). Values written by the workflow are Spanish keywords for statuses and flags; booleans are written as `sí` / `no`; lists are joined with `; `.

## Webhook payload

| Field | Required | Notes |
| --- | --- | --- |
| `full_name` | yes | At least 2 characters including letters, max 120. |
| `email` | yes | Validated, lower-cased, max 254. |
| `message` | yes | At least 10 characters, truncated at 2000. |
| `company`, `phone`, `source` | no | `source` defaults to `web`. Phone is normalised to digits with optional `+`. |
| `budget_range` | no | `lt_1k`, `1k_5k`, `5k_20k`, `gte_20k`. Unknown values are ignored with a warning. |
| `timeframe` | no | `immediate`, `short`, `long`. |
| `company_size` | no | `1_10`, `11_50`, `51_200`, `gt_200`. |
| `consent_to_contact` | no | `true`, `yes`, `si`, `1`, `on`, `y`, `accepted` count as consent. Anything else is no consent. |

Responses: `202` accepted, `200 {duplicate:true}`, `409` identifier conflict, `422` validation errors, `401/403` bad token.

## Tab `leads` (one row per submission)

| Column | Meaning |
| --- | --- |
| `submission_id` | Primary key: `lead_id` + hash of e-mail, message and source. |
| `lead_id` | Stable id per e-mail address. |
| `content_hash` | SHA-256 of e-mail, normalised message and source. |
| `received_at`, `updated_at` | ISO timestamps. |
| `status` | `recibido`, `tarea_creada`, `sin_consentimiento`, `error_ia`, `error_validacion_ia`, `error_definitivo`. |
| `status_history` | `status@timestamp` entries joined with ` > `. |
| `human_review_required`, `review_reasons` | Review flag and the flags that caused it. |
| `priority`, `score`, `score_breakdown` | `alta` / `media` / `baja`, 0-100, and the points per rule. |
| `intent`, `intent_evidence` | Model signal and the verbatim quote that supports it. |
| `timeframe`, `timeframe_source` | Value and where it came from (`form`, `ai`, `none`). |
| `budget_range`, `budget_source` | Same for budget. |
| `company_size` | From the form only. |
| `product_interest`, `summary`, `missing_information` | Verified product text, short summary, what the team should ask. |
| `language`, `ai_confidence`, `ai_model` | Detected language, model confidence, model id. |
| `flags` | All flags raised. |
| `retry_count`, `last_error` | Failed attempts and the last bounded error message. |
| `full_name`, `email`, `company`, `phone`, `message`, `source`, `consent_to_contact` | Cleaned input. |

## Tab `seguimiento` (follow-up tasks)

`task_id` (`T-` + submission id), `submission_id`, `lead_id`, `created_at`, `due_at` (SLA: alta 4 h, media 24 h, baja 72 h), `priority`, `score`, `task_type` (`llamar`, `enviar_email`, `nutrir`, `revisar_manual`), `status` (`pendiente_aprobacion` or `revision_humana`), `assignee`, `human_review_required`, `review_notes`, contact fields, `summary`, `product_interest`, `missing_information`, `draft_subject`, `draft_body`.

The draft is generated from templates in code (Spanish or English) using only verified words. A person edits and sends it.

## Tab `errores`

`error_id`, `timestamp`, `stage` (`analisis_ia`, `validacion_ia`), `submission_id`, `lead_id`, `status`, `retry_count`, `message` (e-mail addresses masked, max 300 characters).
