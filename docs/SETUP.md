# Setup

Estimated time: 15 minutes. You need an n8n instance (Cloud or self-hosted), a Google account and a Groq API key.

## 1. Google Sheet

1. Create a new Google Sheet.
2. Create three tabs named exactly `leads`, `seguimiento` and `errores`.
3. In row 1 of each tab paste the header line from `templates/leads.csv`, `templates/seguimiento.csv` and `templates/errores.csv` (one header per column). The column order does not matter, the names do.
4. Copy the sheet id from its URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`.

## 2. Credentials in n8n

| Credential type | Used by | Notes |
| --- | --- | --- |
| Google Sheets OAuth2 | the six Google Sheets nodes | Sign in with the Google account that owns the sheet. |
| Header Auth, name `Groq API key` | node *Analizar con IA* | Header name `Authorization`, value `Bearer <your Groq key>`. |
| Header Auth, name `LeadFlow webhook token` | node *Webhook de leads* | Header name `X-Webhook-Token`, value a long random string you generate. Do not reuse another credential. |

Never paste keys into the workflow JSON or into the repository.

## 3. Import the workflow

1. In n8n: *Workflows → Import from file* and choose `workflows/leadflow-sales-ai.json`.
2. Open each node that shows a credential warning and select your credential.
3. Open the node **Configuración** and replace `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` with your sheet id.
4. Save. Run the manual trigger **Reintentar fallidos** once with an empty sheet to check that the Sheets connection works (it should finish without items to retry).

## 4. Publish and test

1. Publish the workflow and copy the **production** webhook URL.
2. Copy `.env.example` to `.env`, fill `WEBHOOK_URL` and `WEBHOOK_TOKEN` (do not commit it) and export them in your shell.
3. Run `npm run demo:send`. Expected responses: `202` for valid leads, `422` for the invalid one.
4. Run `npm run demo:send -- --twice` to see that the second round answers `200` with `duplicate: true` and creates no new rows.
5. Open the sheet: `leads` holds every lead with status, priority, score and breakdown; `seguimiento` holds follow-up tasks with drafts; `errores` stays empty unless something failed.

## 5. Retrying failures

Leads that hit an AI error are stored as `error_ia` or `error_validacion_ia`. Run **Reintentar fallidos** manually (or attach a Schedule Trigger yourself) to retry them. Each lead is retried at most 3 times, then it becomes `error_definitivo` and needs a person.

## 6. Customising

Thresholds, point values, SLA hours, model name and limits are in `CONFIG` at the top of `src/lead-core.js`. After editing run `npm test && npm run build` and re-import the workflow.

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| 401/403 from the webhook | Missing or wrong token header. |
| Sheets node error "sheet not found" | Tab names differ from `leads`, `seguimiento`, `errores`, or the sheet id is wrong. |
| Lead stays in `recibido` | The AI step failed before saving. It is recovered after 15 minutes by the next duplicate submission or by the retry trigger. |
| `error_ia` with an API message | Invalid Groq key, rate limit, or the model name is not available to your account. |
