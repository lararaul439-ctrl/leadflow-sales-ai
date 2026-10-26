-- LeadFlow Sales AI - relational schema for the strong-idempotency option.
--
-- STATUS: prepared, NOT wired into the n8n workflow and NOT executed on PostgreSQL by this project.
-- The statements use a portable subset (TEXT, INTEGER, PRIMARY KEY, UNIQUE, ON CONFLICT ... DO NOTHING,
-- RETURNING). tests/db.test.js executes them unchanged on SQLite as a stand-in to prove the constraint
-- semantics, including concurrent claims from several threads. PostgreSQL itself was not available.
-- Timestamps are ISO-8601 strings, as in the Google Sheets version. On PostgreSQL you may prefer
-- timestamptz and jsonb for row_json; the queries in db/queries.js do not depend on that.

CREATE TABLE IF NOT EXISTS leads (
  submission_id TEXT PRIMARY KEY,
  lead_id       TEXT NOT NULL,
  content_hash  TEXT NOT NULL,
  email         TEXT NOT NULL,
  status        TEXT NOT NULL,
  retry_count   INTEGER NOT NULL DEFAULT 0,
  received_at   TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  row_json      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS leads_lead_id_idx ON leads (lead_id);

CREATE TABLE IF NOT EXISTS tasks (
  task_id       TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL REFERENCES leads (submission_id),
  status        TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  row_json      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS errors (
  error_id      TEXT PRIMARY KEY,
  submission_id TEXT,
  timestamp     TEXT NOT NULL,
  row_json      TEXT NOT NULL
);
