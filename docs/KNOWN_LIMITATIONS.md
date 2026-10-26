# Known limitations

Honest list of what v1.1 does not do or has not proven. Security-related items have an id from [SECURITY_REVIEW.md](SECURITY_REVIEW.md).

## Not verified on real services

1. **The published v1.1 webhook was not exercised.** The whole v1.1 workflow ran on n8n Cloud as an unpublished copy with real Sheets and Groq ([LIVE_VERIFICATION.md](LIVE_VERIFICATION.md)), but requests were injected with manual executions. Header authentication, the HTTP response codes and the public URL of v1.1 were not checked. The published workflow is still v1.0 (LF-13).
2. **Duplicate arbitration on Google Sheets (LF-03).** Proven in a simulator and held in one small live run (three identical submissions gave one lead, one task, one model call). Sheets has no unique constraint; do not describe the concurrency problem as solved.
3. **The PostgreSQL option** is exercised on SQLite only, and is not wired into n8n.
4. **The proxy** (`proxy/worker.mjs`) is tested with mocks and was never deployed (LF-04).
5. **Live model behaviour for v1.1 is a small sample.** Nine real answers from the live Groq model were validated (hot, injection, range budget, no-intent leads). Model behaviour varies with the model, the language and long messages; the validation turns any unusable answer into a review or an error status.

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
18. **Sheets nodes map explicit column names.** The upsert nodes have no `schema` list (not needed); the append nodes carry one (required). All row-adding nodes use the Sheets append API (`useAppend`), which assumes the tab has no gaps between rows. Numbers appear with the sheet's locale (for example `0,99`).
19. **Model behaviour varies** with the model, the language and long messages. Any unusable answer ends in an error status, never in a score.
20. **Dates and times are UTC ISO strings**; the SLA does not know about working hours or holidays.
21. **No orphan detection.** A lead stored as `tarea_creada` whose task row is missing (for example after a lost write) is not noticed or repaired. A periodic reconciliation job would close this.
22. **The instance caps the execution timeout** (180 s on the n8n Cloud instance used here). A self-hosted instance may allow more.

## Repository and process

23. Dependabot security updates, branch protection and private vulnerability reporting are repository settings that need the owner (LF-14).
24. The CI badge shows real results only once the workflow has run on the default branch. CodeQL may conflict with GitHub's *default setup* if it is enabled.
25. The images in `docs/images/` are generated or rendered from real outputs. None is a screenshot of the n8n editor or of Google Sheets, because no browser was available when they were produced. See [docs/images/README.md](images/README.md).
