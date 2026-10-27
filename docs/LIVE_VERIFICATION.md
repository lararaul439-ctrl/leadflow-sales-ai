# Live verification of v1.1 on n8n Cloud

The unit and simulation suites run the real workflow code against in-memory fakes. This page records what happened when v1.1 was run **for real**: n8n Cloud's engine, the real Google Sheets nodes and the real Groq API, with fictional leads. It also lists what that run still does not prove.

## Setup

| Item | Value |
| --- | --- |
| Date | 2026-10-26 |
| What was deployed | A **separate, unpublished copy** of v1.1 (34 nodes, 33 connections) in the project's n8n Cloud instance. The workflow that runs in production (v1.0) was not touched and nothing was published. |
| Where the data went | Four extra tabs in the project's own spreadsheet: `v11_leads`, `v11_seguimiento`, `v11_errores`, `v11_claims`. The production tabs were not read or written. |
| Data | Fictional people and companies on reserved `.example` domains. No message was sent: the workflow has no node that can send one. |
| How a request was injected | n8n's manual execution with the webhook payload supplied as input. The published webhook URL was **not** called (see "Not proven"). |
| Same code as the repository? | The seven Code nodes in the copy were compared byte for byte with the repository export after one documented normalisation (the n8n API turns `\uXXXX` text for code points above U+009F into the character itself; the two spellings are equivalent). The other nodes, their parameters and the 33 connections were compared too: the only differences are the `v11_` tab prefix, the sheet id and test-only execution-data settings. |

## What was run

| Executions | Case | Result |
| --- | --- | --- |
| 134 | First run of the hot-lead case | **Failed** at the claim node (finding 1). |
| 135 | Hot lead (budget, deadline, asks for a proposal) | Stored with a follow-up task; the model's quote contained an ellipsis and was rejected (finding 2). |
| 136 | The same lead again | Recognised as a duplicate; nothing written. |
| 137 | Invalid payload (short name, bad e-mail, unknown field, wrong type of consent) | `422` path; nothing written, nothing sent to the model. |
| 138, 139 | Two different leads at the same moment (a hot lead and a message with an injection attempt) | Both leads and both claims stored; **one task row was lost** although the run reported success (finding 4). The injection lead was flagged `posible_inyeccion`, scored `baja` (7) and sent to manual review; the model itself ignored the instruction. |
| 140 to 143 | Four different leads at the same moment, after the fix for finding 4: no consent; same e-mail with a new message; a message with a budget range; a student with no purchase intent | All four leads, four claims and three tasks stored. No task for the lead without consent (`sin_consentimiento`). The repeated contact carried `contacto_repetido`. The budget range ("entre 3000 y 4000 euros") became `1k_5k` with a verified quote. |
| 144 | Retry trigger on a hand-made `error_ia` row | Re-analysed, became `tarea_creada`, one task created, the earlier `error_ia` kept in the history. |
| 145 to 147 | **Three identical submissions** a few seconds apart | All three passed the history lookup before any row existed and each appended a claim. Exactly **one** won; it stored the lead, called the model once and created one task. One loser found the winner's row ("in progress"), the other found no row yet ("winner pending"); neither wrote anything. |

![The v11_leads tab after the live runs](images/sheet-live-leads.png)

*Real capture of the test tab (some columns hidden for legibility; see [images/README.md](images/README.md)).*

Result of the last case: one lead row, one task row, one model call. The arbitration decided by sheet order, not by timestamp: the claim with the earliest `claimed_at` landed second in the sheet and lost.

## Findings (all fixed in the repository)

| # | Finding | Why tests had not caught it | Fix |
| --- | --- | --- | --- |
| 1 | The Google Sheets **append** operation refuses to run with explicit column mapping unless `columns.schema` lists every column. The new claim node (and the error-handler workflow) failed on the first live run. | The simulator replaces the Sheets nodes. | `appendNode` in `scripts/build-workflow.js` writes the schema; a structural test checks it. |
| 2 | A real model quote that skipped words with an ellipsis in the middle failed the verbatim-quote check, so a correct hot lead dropped to manual review. | The canned answers in the tests were always whole sentences. | `evidenceFound` accepts up to four fragments joined by `...` or `…`, each at least four characters, found verbatim and in order. Invented fragments, wrong order, too short fragments and more than four still fail (test added). |
| 3 | n8n Cloud rejected the execution timeout of 240 s: the instance maximum is 180 s. | Nothing in the repository knows the instance's limits. | `executionTimeout` is 180; a structural test enforces it. |
| 4 | With the Google Sheets nodes' default settings, **simultaneous runs can overwrite each other's row**. Execution 138 reported success for its task node and the task was not in the sheet, while the lead row said `tarea_creada`. By default the node reads the last row and writes to "last + 1", so two runs can choose the same row. | Simulated sheets append atomically by construction. | Every node that adds rows now uses the `useAppend` option (the Sheets append API chooses the row on the server). A structural test checks it. After the fix, a run of four simultaneous leads and one of three identical submissions lost nothing. |

Finding 4 matters beyond this project: any n8n workflow that writes to Google Sheets from several concurrent executions has the same exposure with default settings. The orphan from execution 138 (a lead marked `tarea_creada` without its task) was left in the test tab as evidence. Nothing in v1.1 detects such an orphan; a periodic reconciliation (leads with a task status but no task row) is listed in [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

## Deviations of the test copy from the export

- Tab names carry the prefix `v11_`.
- The webhook is driven with manual executions, so the node that authenticates requests and the HTTP response codes were not exercised.
- Execution data for successful and manual runs was saved so results could be read back; the export keeps `saveDataSuccessExecution: none` (it holds personal data).
- The retry trigger is a manual trigger in the copy; the export has no schedule.
- The optional error-handler workflow was not deployed.
- The hand-made `error_ia` row was typed through the Sheets API with its default input handling, which dropped the `+` of a phone number. Rows written by the workflow use `RAW`, so this only affected the test row.

## Not proven

- The published webhook from outside: header authentication, the `202`, `422`, `429` and `503` answers and the public URL. The v1.0 webhook was checked from outside earlier ([TEST_REPORT.md](TEST_REPORT.md)); v1.1's was not.
- Concurrency at scale. One run of three identical submissions and two runs of simultaneous different leads are evidence, not a guarantee. Google Sheets still has no unique constraint; the PostgreSQL option remains the answer for real concurrent traffic ([CONCURRENCY.md](CONCURRENCY.md)).
- Failure of the model API in v1.1 (it would need breaking a credential on purpose). That path is covered by simulation only.
- The error-handler workflow, the edge proxy and the SQL option.
- Volume, quotas and cost.
- Nothing here was run against the production workflow or the production tabs.
