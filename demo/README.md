# Demo

Seven fictional leads in [`leads.json`](leads.json). Every name, company and address is invented (`.example` domains). There are two ways to see the product work.

## Option 1: offline, no accounts (recommended first)

```bash
npm run demo:local
```

It runs the seven leads, twice, through the **real generated Code nodes** of `workflows/leadflow-sales-ai.json`. Google Sheets is replaced by an in-memory table and the language model by the canned answers in [`ai-responses.json`](ai-responses.json). It prints the result as Markdown, the same text as [`expected-output.md`](expected-output.md), and a test fails if that file is out of date.

Useful variants: `npm run demo:local -- --json` (raw tables) and `npm run demo:local -- --write` (regenerate `expected-output.md`).

![Demo run](../docs/images/demo-summary.png)

*Rendered from the output of `npm run demo:local`. Simulated model and sheet; real decision code.*

What it shows, and what it does not:

| Shows | Does not show |
| --- | --- |
| Validation, redaction, duplicate handling, scoring, drafts and human-review routing | What a live model extracts from these messages |
| Hostile or broken model answers ([`ai-invalid-examples.json`](ai-invalid-examples.json)) ending in an error status or in review, never in a score | Google Sheets, n8n or Groq behaviour |

## Option 2: against your own n8n instance

After [docs/SETUP.md](../docs/SETUP.md):

```bash
export WEBHOOK_URL="https://YOUR-INSTANCE.app.n8n.cloud/webhook/leadflow-sales"
export WEBHOOK_TOKEN="your-token"
npm run demo:send              # one round
npm run demo:send -- --twice   # the second round shows duplicate handling
```

PowerShell users can send a single lead with `Invoke-WebRequest` (see [docs/SETUP.md](../docs/SETUP.md)).

## Example input and output

Input (the first lead of [`leads.json`](leads.json)):

```json
{
  "full_name": "Marta Sanz Ortega",
  "email": "marta.sanz@norteclima-demo.example",
  "company": "Norteclima Demo S.L.",
  "phone": "+34 600 123 456",
  "message": "Queremos contratar vuestro servicio de automatizacion de facturas. Necesitamos empezar este mes y tenemos un presupuesto de 12.000 euros. Podeis enviarnos una propuesta?",
  "source": "landing-demo",
  "company_size": "51_200",
  "consent_to_contact": true
}
```

Immediate answer: `202 {"ok":true,"status":"accepted","submission_id":"L-..."}`.

Stored result (simulated run, abridged): status `tarea_creada`, priority `alta`, score 90 (`intent +30, budget +18, timeframe +20, company size +12, business e-mail +5, phone +3, company +2`), task `llamar` due in 4 hours, draft pending approval, asks who decides. Full detail: [`expected-output.md`](expected-output.md) and the images below.

| | |
| --- | --- |
| ![Processing](../docs/images/lead-processing.png) | ![Classification](../docs/images/lead-classification.png) |
| ![Scoring](../docs/images/lead-scoring.png) | ![Follow-up](../docs/images/follow-up-task.png) |

## What to expect from each lead

| Lead | HTTP | Result |
| --- | --- | --- |
| Marta Sanz (hot, Spanish) | 202 | `tarea_creada`, `alta`, score 90. Task `llamar` due in 4 h. |
| Jorge Ibanez (cold) | 202 | `baja`, score 12, task `nutrir`. The draft asks for budget, timeframe, company size and phone. |
| Priya Nair (English, evaluating) | 202 | Intent `evaluating`, `media`, score 45, task `enviar_email`; the draft is in English. |
| Carlos Vega (no consent declared) | 202 | Scored (`media`, 45), status `sin_consentimiento`, **no task**. |
| Test Injection | 202 | Flag `posible_inyeccion`, model intent ignored, `baja`, score 7, task `revisar_manual` with human review. |
| Temp Sender (disposable e-mail) | 202 | Flag `email_desechable`, score capped at 10 even though the model read a purchase intent, review required. |
| No Email | 422 | Rejected with `email: obligatorio`. Nothing is written. |

These values come from the simulated run above (6 leads, 5 tasks). On the second round every accepted lead answers `200` with `duplicate: true` and no row is added. On a live stack the exact scores depend on what the model extracts; the rules that turn the signals into a score are fixed ([docs/SCORING.md](../docs/SCORING.md)).

## A realistic business case (fictional)

A small B2B services company has a contact form on its website. Today someone reads every message, guesses which ones matter and writes a first reply from scratch. With LeadFlow:

1. The form posts to a proxy that adds the webhook token.
2. The lead is validated, de-duplicated and stored immediately.
3. A language model extracts intent, timing and budget **only from what the person wrote**, with quotes that are checked.
4. Rules, not the model, decide the priority; unclear or suspicious leads go to a person.
5. The sales person opens the `seguimiento` tab, sees the due time, the reasons for the priority and a draft, edits it and sends it from their own mailbox.

No claim is made about time saved or revenue; measure that in your own team.

## How to present it (about 5 minutes)

1. Run `npm run demo:local` and show the table: seven leads, seven different outcomes.
2. Open the hot lead: the redacted text the model sees, the score breakdown, the draft.
3. Show the injection lead and the bad-model-answer table: the system stays safe when the model misbehaves.
4. Show round two: nothing is duplicated.
5. Say plainly what is simulated, and what the limits are ([docs/KNOWN_LIMITATIONS.md](../docs/KNOWN_LIMITATIONS.md)).
