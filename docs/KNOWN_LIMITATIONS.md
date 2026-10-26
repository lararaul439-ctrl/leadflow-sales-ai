# Known limitations

1. **Concurrent identical submissions.** Two simultaneous webhook calls with the same content can both read an empty history before either writes, because Google Sheets has no atomic upsert. Sequential repeats (double click, retries, replays) are handled; the race is not. A production version would need a datastore with unique constraints.
2. **Google Sheets as storage.** API quotas apply and the lookup reads the sheet filtered by `lead_id`. It is meant for hundreds or low thousands of leads, not high volume.
3. **One lead per request.** The webhook accepts a single JSON object. Bulk import is not supported.
4. **Response alignment.** The evaluation step pairs model answers with leads by position. This is safe while the HTTP node preserves order (it does with batch size 1), but it is a dependency to keep in mind if the node is changed.
5. **Prompt-injection mitigation is best effort.** Pattern flags and evidence checks reduce risk but cannot catch every phrasing. That is why priority is rule-based and risky leads go to human review.
6. **Personal data inside the message** still reaches the AI provider (see PRIVACY).
7. **Language support.** Drafts exist in Spanish and English; other languages get the English draft.
8. **Budget tiers** are currency-agnostic labels; the demo assumes EUR.
9. **Retries are manual or need a trigger you add.** The export ships with a manual trigger; attach a Schedule Trigger if you want automatic retries.
10. **Model behaviour varies.** The request was verified against the live Groq API for one fictional lead. Other models, languages or long messages may behave differently; any invalid answer is caught by validation and ends in `error_validacion_ia` for retry or review.
11. **Sheets node without a column schema.** The export omits the Google Sheets `schema` arrays to keep it small; mapping uses explicit column names. This worked against a real sheet in the verification runs. Numbers appear with the sheet locale (for example `0,99` in a Spanish-locale sheet).
12. **Group view.** The canvas has ungrouped nodes; grouping is cosmetic.
