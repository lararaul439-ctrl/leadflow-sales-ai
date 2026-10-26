'use strict';
/*
 * Parameterised statements for the relational option (see db/schema.sql and docs/CONCURRENCY.md).
 * Placeholders are PostgreSQL style ($1, $2, ...). Every statement is a single atomic operation, so no
 * explicit transaction is needed for the guarantees described next to each one.
 * No statement is built by string concatenation with user data.
 */

module.exports = {
  // Atomic claim of a NEW submission. One row comes back for exactly one caller; every concurrent or later
  // caller with the same submission_id gets zero rows and must stop. This is the guarantee Google Sheets
  // cannot give.  params: submission_id, lead_id, content_hash, email, status, retry_count, received_at, updated_at, row_json
  claimNew:
    'INSERT INTO leads (submission_id, lead_id, content_hash, email, status, retry_count, received_at, updated_at, row_json) ' +
    'VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ' +
    'ON CONFLICT (submission_id) DO NOTHING RETURNING submission_id',

  // Atomic recovery of a stuck "recibido" row (compare-and-set): only one caller can move it forward, and only
  // if it has not been touched since the cut-off.  params: submission_id, now, stale_before
  claimStale:
    "UPDATE leads SET retry_count = retry_count + 1, updated_at = $2 " +
    "WHERE submission_id = $1 AND status = 'recibido' AND updated_at < $3 RETURNING submission_id, retry_count",

  // Final state of a lead. The guard keeps a late or repeated writer from overwriting a finished lead.
  // params: submission_id, status, updated_at, row_json
  finishLead:
    "UPDATE leads SET status = $2, updated_at = $3, row_json = $4 " +
    "WHERE submission_id = $1 AND status IN ('recibido', 'error_ia', 'error_validacion_ia') RETURNING submission_id",

  // Follow-up task. DO NOTHING (not DO UPDATE) so that a retry can never overwrite what a person has already
  // done to the task (assignee, approval, notes).  params: task_id, submission_id, status, created_at, row_json
  saveTask:
    'INSERT INTO tasks (task_id, submission_id, status, created_at, row_json) VALUES ($1, $2, $3, $4, $5) ' +
    'ON CONFLICT (task_id) DO NOTHING RETURNING task_id',

  // Idempotent error log.  params: error_id, submission_id, timestamp, row_json
  logError:
    'INSERT INTO errors (error_id, submission_id, timestamp, row_json) VALUES ($1, $2, $3, $4) ' +
    'ON CONFLICT (error_id) DO NOTHING RETURNING error_id',

  // History used by the duplicate decision.  params: lead_id
  historyByLead: 'SELECT submission_id, lead_id, email, status, retry_count, received_at, updated_at FROM leads WHERE lead_id = $1 ORDER BY received_at'
};
