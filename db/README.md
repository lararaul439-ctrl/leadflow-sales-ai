# Relational option (strong idempotency)

Google Sheets cannot guarantee that two simultaneous submissions create one lead. A database with a unique constraint can. This folder holds that option.

> **Status: prepared, not wired into the n8n workflow, never run on PostgreSQL.** `tests/db.test.js` executes the same statements on SQLite (`node:sqlite`) as a stand-in, including several worker threads racing for the same submissions.

| File | Content |
| --- | --- |
| `schema.sql` | `leads` (primary key `submission_id`), `tasks` (foreign key to `leads`), `errors` |
| `queries.js` | Parameterised statements: `claimNew` (insert, do nothing on conflict), `claimStale` (compare-and-set recovery), `finishLead`, `saveTask`, `logError`, `historyByLead` |

How it would be used in n8n: replace the Google Sheets nodes with Postgres nodes that run these statements with query parameters, and use the affected-row count of `claimNew` to decide between "I won" and "duplicate". The `claims` tab and the 30-second window are then unnecessary.

What is still needed: a PostgreSQL instance, an n8n credential, the node wiring, and a run against the real database. Types such as `timestamptz` and `jsonb` are an optional refinement.

See [docs/CONCURRENCY.md](../docs/CONCURRENCY.md).
