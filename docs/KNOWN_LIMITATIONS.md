# Known limitations

Honest list of what v1.1 does not do or has not proven. Security-related items have an id from [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## Not verified on real services

1. **The v1.1 workflow has not been run on n8n Cloud as a whole.** Its Code-node logic was run inside n8n ([RUNTIME_VERIFICATION.md](RUNTIME_VERIFICATION.md)), and the graph is checked structurally in tests. The webhook, the Sheets nodes and the Groq call of v1.1 were verified only for v1.0. The published workflow is still v1.0 (LF-13).
2. **Duplicate arbitration on Google Sheets (LF-03).** It is proven in a simulator. Whether a real Sheets append is atomic and visible to the next read has not been tested. Do not describe the concurrency problem as solved.
3. **The PostgreSQL option** is exercised on SQLite only, and is not wired into n8n.
4. **The proxy** (`proxy/worker.mjs`) is tested with mocks and was never deployed (LF-04).
5. **Live model behaviour for v1.1.** The prompt and the redaction changed. The v1.0 prompt was verified against the live Groq API for fictional leads; the v1.1 one was not.

## Design limits

6. **Google Sheets as storage.** API quotas apply and every lookup reads rows by `lead_id`. Meant for hundreds or low thousands of leads, not high volume. An accepted lead costs six Sheets calls (history, claim append, claim read, received row, task, final row) plus one if an error is logged.
7. **The workflow throttle is best effort (LF-15).** It lives in n8n static data, which concurrent executions can overwrite. It is not DDoS protection. Use the edge for that.
8. **Prompt-injection detection is best effort (LF-06).** New phrasings can pass. The defence is structural: the model cannot set the priority, its quotes must exist in the message, flagged leads go to a person, and nothing is sent automatically.
9. **Personal data written inside the message** that is not an e-mail, a phone number, a link, the sender's own name or the company still reaches the AI provider (LF-05).
10. **Consent is declared, not verified.** The workflow records what the caller said (LF-07).
11. **n8n keeps failed executions with their data** according to the instance settings (LF-08). Set retention there; the workflow cannot.
12. **The `claims` tab grows.** Rows older than a day can be deleted; nothing does it automatically.
13. **One lead per request.** No bulk import.
14. **Evaluation pairs model answers with leads by position.** Safe while the HTTP node keeps batch size 1 and preserves order; a dependency to keep in mind if the node is changed.
15. **Language support.** Drafts exist in Spanish and English; other languages get the English draft.
16. **Budget tiers are labels**, not currency conversions; the demo assumes EUR.
17. **Retries are manual** unless you attach a Schedule Trigger.
18. **Sheets node without a column schema.** The export omits the Google Sheets `schema` arrays and maps explicit column names. Numbers appear with the sheet's locale (for example `0,99`).
19. **Model behaviour varies** with the model, the language and long messages. Any unusable answer ends in an error status, never in a score.
20. **Dates and times are UTC ISO strings**; the SLA does not know about working hours or holidays.

## Repository and process

21. Dependabot security updates, branch protection and private vulnerability reporting are repository settings that need the owner (LF-14).
22. The CI badge shows real results only once the workflow has run on the default branch. CodeQL may conflict with GitHub's *default setup* if it is enabled.
23. The images in `docs/images/` are generated or rendered from real outputs. None is a screenshot of the n8n editor or of Google Sheets, because no browser was available when they were produced. See [docs/images/README.md](images/README.md).
