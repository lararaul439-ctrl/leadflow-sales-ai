# Setup

Estimated time: 20 minutes for a new installation. You need an n8n instance (Cloud or self-hosted), a Google account and a Groq API key.

> **Upgrading from v1.0?** Read [Upgrading](#upgrading-from-v10) first. v1.1 needs one new tab and a few new columns, and two workflows cannot be published with the same webhook path at the same time.

## 1. Google Sheet

1. Create a new Google Sheet and keep it **private** (not "anyone with the link").
2. Create four tabs named exactly `leads`, `seguimiento`, `errores` and `claims`.
3. In row 1 of each tab paste the header line of `templates/leads.csv`, `templates/seguimiento.csv`, `templates/errores.csv` and `templates/claims.csv`, one name per column. The column order does not matter, the names do.
4. Copy the sheet id from the URL: `https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit`. Do not commit it anywhere.

## 2. Credentials in n8n

| Credential type | Used by | Notes |
| --- | --- | --- |
| Google Sheets OAuth2 | all the Google Sheets nodes | Sign in with the Google account that owns the sheet. |
| Header Auth, name `Groq API key` | node *Analizar con IA* | Header name `Authorization`, value `Bearer <your Groq key>`. |
| Header Auth, name `LeadFlow webhook token` | node *Webhook de leads* | Header name `X-Webhook-Token`, value a long random string you generate (for example 32 random bytes in hex). Do not reuse another secret. |

Never paste keys into the workflow JSON, a chat, a ticket or the repository. If a token has been exposed, replace it (see [Rotating the webhook token](#rotating-the-webhook-token)).

## 3. Import the workflow

1. In n8n: *Workflows, Import from file*, choose `workflows/leadflow-sales-ai.json`.
2. Open every node that shows a credential warning and select your credential.
3. Open the node **Configuración** and replace `PASTE_YOUR_GOOGLE_SHEET_ID_HERE` with your sheet id. The same node holds the throttle (`rate_max_requests` per `rate_window_seconds`, default 120 per 600 s).
4. Save.
5. Optional but recommended: import `workflows/leadflow-sales-ai-error-handler.json`, set its sheet id and credential, then in the main workflow open *Settings* and choose it as **Error workflow**. It writes one bounded row to `errores` when an execution fails.
6. In the main workflow's *Settings* keep "Save successful production executions" off and decide how long n8n keeps failed executions (they contain request data). The export sets a 180 s execution timeout, which is the maximum on n8n Cloud; a different instance limit may need a lower value.
7. Leave the **Use Append** option on in the Google Sheets nodes that add rows (it is set in the export). It makes Sheets choose the row, so two simultaneous executions cannot overwrite each other. It assumes the tabs have no empty rows between data rows.

## 4. Publish and test

1. Publish the workflow and copy the **production** webhook URL.
2. Copy `.env.example` to `.env`, fill `WEBHOOK_URL` and `WEBHOOK_TOKEN` (never commit it) and export them in your shell.
3. Run `npm run demo:send`. Expected: `202` for valid leads, `422` for the invalid one.
4. Run `npm run demo:send -- --twice`: the second round answers `200` with `duplicate: true` and adds no rows.

Sending one lead without Node (Windows PowerShell). Use single quotes around the token:

```powershell
$headers = @{ "X-Webhook-Token" = 'YOUR_TOKEN' }
$body = @{
  full_name = "Laura Test"
  email = "laura.test@demo-company.example"
  message = "We would like to hire your service and start next month. Can you send a proposal?"
  consent_to_contact = $true
} | ConvertTo-Json
Invoke-WebRequest -Method Post -Uri "https://YOUR-INSTANCE.app.n8n.cloud/webhook/leadflow-sales" -Headers $headers -ContentType "application/json" -Body $body -UseBasicParsing
```

5. Open the sheet: `leads` has every lead with status, priority, score and breakdown; `seguimiento` has the follow-up tasks and drafts; `errores` stays empty unless something failed; `claims` fills with one row per accepted submission (clear old rows now and then).

You can try the whole logic without any service: `npm run demo:local` (see [demo/README.md](../demo/README.md)).

## 5. Retrying failures

Leads that hit an AI error are stored as `error_ia` or `error_validacion_ia`. Run **Reintentar fallidos** manually (or attach a Schedule Trigger yourself) to retry them. Each lead is retried at most 3 times, then it becomes `error_definitivo` and needs a person.

## 6. A public web form

Do **not** put the webhook token in a web page. Use an edge proxy that keeps it server-side; a reference is in [proxy/README.md](../proxy/README.md). The proxy is tested with mocks only and has not been deployed.

## 7. Customising

Thresholds, point values, SLA hours, the model name and the limits are in `CONFIG` at the top of `src/lead-core.js`. After editing run `npm run verify` and re-import the generated workflow.

## Upgrading from v1.0

1. **Back up** the sheet (*File, Make a copy*). Do not delete anything.
2. Add the tab `claims` with the header of `templates/claims.csv`.
3. Add these columns (the names must match exactly; old columns can stay):
   - `leads`: `consent_declared`, `consent_notice_version`, `consent_given_at`, `consent_evidence`
   - `seguimiento`: `consent_evidence`
   - `errores`: `execution_id`
4. Import `workflows/leadflow-sales-ai.json` as a **new** workflow. It is imported unpublished. Set credentials and the sheet id as in step 3.
5. Both workflows use the webhook path `leadflow-sales`, so only one can be published. To switch: test the new one with its *test* URL first, then unpublish v1.0 and publish v1.1. To roll back, do the reverse.
6. Rows written by v1.0 stay readable: the old `consent_to_contact` column is still understood.

The project maintainer did **not** perform this upgrade on the owner's instance; it needs the owner's approval.

## Rotating the webhook token

1. In n8n, open the credential *LeadFlow webhook token* and replace its value with a new random string.
2. Update `WEBHOOK_TOKEN` in every client or in the proxy's secret.
3. Call the webhook once with the old value and confirm it is refused (`403`).

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `403` from the webhook | Missing or wrong token header. |
| `413` / `422` | Body too large or too many fields / a field is wrong or not allowed (the answer lists field names, never values). |
| `429` | The throttle or the per-contact limit was reached; wait and retry. |
| `503 in_progress` | Another execution is storing the same lead; retry after 30 s. |
| Sheets node error "sheet not found" | A tab name differs from `leads`, `seguimiento`, `errores`, `claims`, or the sheet id is wrong. |
| A `claims` row is written but nothing else happens | The claim was lost to another execution (a duplicate) or the sheet showed it late; the caller got `200` or `503`. |
| Lead stays in `recibido` | The AI step failed before saving. It is recovered after 15 minutes by the next duplicate submission or by the retry trigger. |
| `error_ia` with an API message | Invalid Groq key, rate limit, or the model name is not available to your account. |
