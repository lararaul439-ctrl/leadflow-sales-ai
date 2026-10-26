# Privacy, data flows and costs

This document describes the design. It is **not** a legal assessment and the project does **not** claim GDPR (or any other) compliance. If you process real personal data you remain responsible for a legal basis, privacy notices, retention, processor agreements, data-subject requests and security of your own accounts.

## Data flow

| Data | Stored in | Sent to |
| --- | --- | --- |
| Name, e-mail, phone, company | Your Google Sheet (`leads`, `seguimiento`) | Not sent to the model. Not logged by the workflow. |
| Message text | Your Google Sheet, after cleaning and masking of payment and ID numbers | The AI provider, **after redaction** (next section) |
| Consent declaration and what came with it | Your Google Sheet | Nowhere else |
| Model answer (signals, summary) | Your Google Sheet, validated | Nowhere else |
| Error text | `errores` (bounded to 300 characters, secrets and e-mail addresses scrubbed) | Nowhere else |
| The raw request | n8n execution data **only if an execution fails** (successful executions are not saved by default) | Nowhere else |
| Request in transit | An optional proxy (Cloudflare Workers) sees it in memory; the reference code does not log it | The n8n webhook |

Third parties that receive data when you deploy this: Google (Sheets), n8n (your instance or n8n Cloud), the model provider (Groq by default), and Cloudflare if you use the proxy. Read each one's terms and data-processing terms. The project did not verify any provider's retention or training policy.

## What the model receives

Before the request is built, the message text is processed so that:

- e-mail addresses become `[email]`;
- links become `[enlace]`;
- phone-like numbers (9 digits or more) become `[teléfono]`;
- each name token of the sender (3 letters or more) becomes `[nombre]`;
- the company name becomes `[empresa]`;
- card, IBAN and national-ID-like numbers were already masked at validation.

The prompt tells the model to treat the placeholders as opaque text. The model's answer is checked against the **redacted** text, so quotes verify and no personal data comes back from it.

What this does **not** remove: other people's names, street addresses, health or financial details, and anything unusual written in the message. A person who writes sensitive details in the free text still sends them to the provider. If that matters, add a notice next to the form or stop sending the message to a model.

## Consent

`consent_to_contact` is a **claim made by whoever called the webhook**. The workflow cannot check it. It is stored as `consent_declared` together with an evidence level:

| `consent_evidence` | Meaning |
| --- | --- |
| `none` | Nothing was declared. No follow-up task is created (status `sin_consentimiento`). |
| `declared_only` | A bare true/yes. |
| `declared_partial` | Plus either the notice version or the time. |
| `declared_with_provenance` | Plus both: the notice version and when it was accepted, as supplied by the caller. |

For real use, the form (or the proxy) should keep its own verifiable consent log; the sheet only records what it was told. Consent never changes the score, so it cannot be used to push a lead up the queue.

## Controls in the design

- Webhook protected by a header token; strict schema; size limits; values are never echoed in errors.
- Untrusted text is data: delimiter, schema-bound output, evidence checks, deterministic scoring, human review.
- No automatic outbound communication. A person approves and sends every message.
- Cells are written as plain text, neutralised against formula injection.
- Error messages are bounded and scrubbed; the optional error workflow stores the failing node, a bounded message and the execution id, not the request.

## Retention and deletion (you must decide these)

The workflow never deletes anything. Define and apply:

1. A retention period for rows in `leads`, `seguimiento` and `errores`, and a routine that deletes older rows. `claims` rows can be cleared after a day.
2. A retention period for **failed executions in n8n**, which contain the request body.
3. Who may open the sheet and the n8n instance, and how access is reviewed.
4. A procedure for a person who asks to see or erase their data: find every row with their `lead_id` (it is `L-` plus a hash of the e-mail address, so search by e-mail in `leads` first), delete the rows in all four tabs, and delete matching n8n executions. Drafts that were already copied into a mail client are outside the workflow.

## Costs

- n8n Cloud, the Google Sheets API and the model provider have free or low-cost tiers at the time of writing; limits and prices change, so check the current plans before relying on them.
- One model request per lead, output capped at 1500 tokens, requests spaced 1.5 s apart, three attempts at most. The throttle (120 requests per 10 minutes by default) and the per-contact limit also bound spend, approximately.
- The demo uses fictional data only. `npm run demo:local` makes no network call at all.
