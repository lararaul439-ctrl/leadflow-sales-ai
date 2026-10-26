# Architecture

## Design goals

1. Safe with hostile input (lead text is untrusted).
2. Idempotent: the same lead sent twice never creates two records or two tasks.
3. Explainable: every score can be reconstructed from the stored breakdown.
4. Recoverable: a failure at any step leaves the lead in a state the workflow can pick up again.
5. Testable: all decisions live in plain JavaScript that tests import directly.

## Flow

1. **Webhook de leads** (POST, header token). The workflow answers early through *Respond to Webhook*, so the form is never blocked by the AI call.
2. **Configuración** sets the sheet id and the run mode (`webhook` or `retry`).
3. **Validar y normalizar** checks required fields, cleans text, masks payment and ID numbers, flags injection patterns, disposable e-mails and link spam, and derives ids:
   - `lead_id = "L-" + sha256(email)[:12]`
   - `submission_id = lead_id + "-" + sha256(email | normalised message | source)[:10]`
4. Invalid input gets `422` with field errors. Values are not echoed back.
5. **Buscar historial del lead** reads rows for the `lead_id`; **Decidir duplicado** returns one of:
   - `process / nuevo`: first time this exact message is seen.
   - `process / recibido_caducado`: a previous run stopped after saving `recibido` more than 15 minutes ago; retry counter increases.
   - `ignore`: already processed, in progress, queued for retry or needing manual review (answers `200 duplicate`).
   - `conflict`: same submission id with a different e-mail (hash collision), answers `409`.
   A new message from the same e-mail is processed and flagged `contacto_repetido`.
6. **Registrar recibido** upserts the lead with status `recibido`, then the flow answers `202` and continues in parallel with the AI step.
7. **Preparar petición IA** builds a chat-completions request with a strict JSON schema. Only the cleaned message is sent (no name, e-mail, phone or company).
8. **Analizar con IA** (Groq, OpenAI-compatible). 30 s timeout, 3 tries, errors do not stop the flow.
9. **Evaluar y puntuar** validates the answer and builds the rows:
   - invalid JSON, enum outside the schema, missing summary or a truncated reply produce `error_validacion_ia`; API errors or empty replies produce `error_ia`;
   - evidence quotes must appear in the message, product interest must appear in the message, summary figures must appear in the message;
   - form values override model values for budget and timeframe;
   - with an injection flag the intent is forced to `unknown` and the product is removed from the draft;
   - score and priority come from `computeScore`;
   - without `consent_to_contact` the status is `sin_consentimiento` and no task is created.
10. **Guardar tarea** then **Guardar lead**. The task is written first, so a failed task write leaves the lead as `recibido` and recoverable.
11. **Registrar error** logs a bounded, e-mail-masked message when a failure occurred.

Retry mode: *Reintentar fallidos* reads all rows, selects `error_ia`, `error_validacion_ia` and stale `recibido` rows with fewer than 3 attempts, and re-enters at step 7.

## Statuses

`recibido`, `tarea_creada`, `sin_consentimiento`, `error_ia`, `error_validacion_ia`, `error_definitivo`. Every transition is appended to `status_history` with a timestamp.

## Why one JavaScript file

n8n Code nodes cannot import local modules. `scripts/build-workflow.js` copies only the regions each node needs (marked with `//#region` comments) plus a small glue file from `src/nodes/` into the node's code. Tests load the same `src/lead-core.js`, and a separate test runs the generated node code inside a Node `vm` sandbox that mimics `$input` and `$()`. A test fails if the committed export is out of sync with the sources.

## Safety design

- Lead text is data: it is wrapped in `<lead_message>` tags with angle brackets removed, and the system prompt tells the model to ignore instructions inside it. This is a mitigation, not a guarantee, which is why priority never depends on the model alone.
- Cells are written with `RAW` format and cells that start with `= + - @` are flagged, to avoid spreadsheet formula injection.
- The export contains no secrets; credentials are placeholders.
- No node sends e-mail or messages.
