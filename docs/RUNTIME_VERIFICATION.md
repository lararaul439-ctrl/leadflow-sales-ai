# Runtime verification inside n8n

The unit tests run the workflow's JavaScript on Node. n8n runs it in its own sandbox, which could differ (Unicode support, available globals, `Date`). This page explains how the project checks that the **generated Code-node source behaves the same inside n8n**, without touching Google Sheets, the model or any production workflow.

## What the harness is

[`tests/live/n8n-runtime-harness.js`](../tests/live/n8n-runtime-harness.js) is the body of one n8n Code node ("Run once for all items"). Given the workflow export as input, it:

1. compiles the real `jsCode` of each Code node in the export;
2. runs a scripted sequence of fictional leads through them (valid lead, duplicate, claim arbitration, injection variants, oversized body, prototype-pollution key, throttle, provider outage, malformed model output, invented evidence, retry selection);
3. replaces Google Sheets and the model with in-memory values; **no request leaves the node**;
4. returns `{passed, failed, total, failures, checks, fingerprint, codeHashes, runtime}`.

The `fingerprint` is a hash over every output. The same code on the same input must give the same fingerprint in every JavaScript runtime. The local test (`tests/runtime-harness.test.js`) also mutates the scoring table and checks that the harness notices.

## Run it locally

```bash
node --test tests/runtime-harness.test.js
```

The current commit reports 23 checks, 0 failures, fingerprint `50b93a1c`.

## Run it inside n8n (without publishing anything)

1. Create a **new, empty** workflow. Do not use the production one and do not publish the new one.
2. Add a **Manual Trigger**.
3. Add an **HTTP Request** node (GET, response format JSON) that downloads the export from the repository, for example `https://raw.githubusercontent.com/<owner>/<repo>/<branch>/workflows/leadflow-sales-ai.json`. No credentials are needed for a public repository.
4. Add a **Code** node, mode *Run once for all items*, and paste the whole content of `n8n-runtime-harness.js`.
5. Execute the workflow manually and read the output item: `failed` must be `0` and `fingerprint` must equal the local one.
6. Delete or archive the temporary workflow.

If your n8n instance does not allow outbound requests, paste the export into a Set node as JSON instead.

## What was done on 2026-10-26

| Item | Result |
| --- | --- |
| Where | A temporary, unpublished workflow (a Manual Trigger, a node supplying the export and the harness Code node) in the project's n8n Cloud instance |
| Execution id | 133 |
| Outcome recorded | 23 passed, 0 failed, fingerprint `50b93a1c` (equal to the local run) |
| Touched | Nothing else: no webhook, no Google Sheets, no Groq call, no production workflow |
| Afterwards | The temporary workflow was archived |

**Caveat:** because the temporary workflow was archived, the execution can no longer be inspected from this repository or its tooling, so that line rests on the output recorded at the time. Repeat the steps above to reproduce it.

## What this does and does not show

| Shows | Does not show |
| --- | --- |
| The generated source runs in n8n's JavaScript runtime and gives the same results as on Node | That the v1.1 graph wiring is correct in n8n (checked structurally in `tests/workflow.test.js`; the graph was run in [LIVE_VERIFICATION.md](LIVE_VERIFICATION.md)) |
| Unicode normalisation, property escapes and code points are available there | Google Sheets behaviour: append atomicity, read-after-write |
| The code under test is the code in the export (hashes in `codeHashes`) | The Groq call, the webhook, authentication or the public URL |
