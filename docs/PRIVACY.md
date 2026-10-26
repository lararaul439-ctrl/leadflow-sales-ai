# Privacy, security and costs

This document describes the design, not a legal assessment. If you process real personal data you remain responsible for GDPR or equivalent compliance (legal basis, notices, retention, processor agreements).

## Data flow

| Data | Stored in | Sent to |
| --- | --- | --- |
| Name, e-mail, phone, company | Your Google Sheet | Nowhere else. They are **not** included in the model request. |
| Message text | Your Google Sheet (cleaned and masked) | The AI provider (Groq) |
| Execution data | n8n | Success executions are not saved by default (`saveDataSuccessExecution: none`); error executions are saved. |

Names, phone numbers or e-mail addresses that the sender writes **inside the message** are not removed and do reach the provider. Card, IBAN and national-ID-like numbers are masked before storage and before the model call.

## Controls

- Webhook protected by a Header Auth token; no credentials in the repository or in the workflow export.
- Input treated as untrusted (see [architecture](architecture.md)).
- Consent: without `consent_to_contact` the lead is stored and scored but no follow-up task or draft is created.
- No automatic outbound communication.
- Error messages are bounded to 300 characters and e-mail addresses are masked.
- Cells are written as raw text to avoid formula execution in Google Sheets.

## Recommendations for real use

- Restrict sharing of the Google Sheet.
- Define a retention period and delete old rows.
- Review the AI provider's data-use terms and plan before sending real customer text.
- Rotate the webhook token if it leaks.

## Costs

- n8n Cloud, Google Sheets API and Groq all have free tiers at the time of writing, but limits and prices change. Check the current Groq console and n8n plan before relying on them.
- One AI request per lead, with a capped output of 1500 tokens. The HTTP node spaces requests 1.5 s apart.
- The demo uses fictional data only.
