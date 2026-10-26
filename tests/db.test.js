'use strict';
/*
 * The relational option (db/schema.sql + db/queries.js) executed on SQLite as a STAND-IN for PostgreSQL.
 * What this proves: the constraint semantics the design relies on (primary key + ON CONFLICT DO NOTHING
 * as an atomic claim, compare-and-set recovery, guarded updates) behave as described, including with several
 * threads writing to the same file at once.
 * What it does not prove: behaviour on PostgreSQL itself (not available here), connection pooling, or the n8n
 * Postgres node. The database is not wired into the workflow.
 *
 * Needs node:sqlite (Node >= 22.13). On older Node the tests are reported as SKIPPED, never as passed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const Q = require('../db/queries.js');
const core = require('../src/lead-core.js');
const F = require('./fixtures/leads.js');

let sqlite = null;
try { sqlite = require('node:sqlite'); } catch (e) { /* older Node */ }
const skip = sqlite ? false : 'node:sqlite is not available on this Node version (needs >= 22.13): SKIPPED, not passed';

const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/schema.sql'), 'utf8');
const toSqlite = (sql) => sql.replace(/\$(\d+)/g, '?$1');

function open(file) {
  const db = new sqlite.DatabaseSync(file || ':memory:');
  db.exec('PRAGMA busy_timeout = 10000');
  db.exec('PRAGMA foreign_keys = ON'); // PostgreSQL always enforces foreign keys; SQLite needs this switch
  db.exec(SCHEMA);
  return db;
}
const run = (db, name, params) => db.prepare(toSqlite(Q[name])).all(...params);
const T0 = '2026-10-26T09:00:00.000Z';
const at = (min) => new Date(Date.parse(T0) + min * 60000).toISOString();
const leadParams = (id, extra) => Object.assign({ lead_id: 'lead-1', hash: 'h1', email: 'a@x-demo.example', status: 'recibido', retry: 0, received: T0, updated: T0, json: '{}' }, extra || {}, { id });
const claim = (db, p) => run(db, 'claimNew', [p.id, p.lead_id, p.hash, p.email, p.status, p.retry, p.received, p.updated, p.json]);

test('db: the schema loads unchanged and can be applied twice', { skip }, () => {
  const db = open();
  db.exec(SCHEMA);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
  assert.deepEqual(tables, ['errors', 'leads', 'tasks']);
});

test('db: every statement is parameterised, sequentially numbered and free of string building', () => {
  for (const [name, sql] of Object.entries(Q)) {
    assert.equal(typeof sql, 'string', name);
    assert.ok(!/\$\{|\+\s*['"]/.test(sql), name + ' must not interpolate');
    const nums = [...sql.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    assert.ok(nums.length > 0, name + ' uses placeholders');
    const max = Math.max(...nums);
    assert.deepEqual([...new Set(nums)].sort((a, b) => a - b), Array.from({ length: max }, (_, i) => i + 1), name + ' placeholders are contiguous');
  }
});

test('db: claimNew is an atomic claim - the first caller gets a row, every later caller gets none', { skip }, () => {
  const db = open();
  assert.equal(claim(db, leadParams('L-1')).length, 1);
  for (let i = 0; i < 50; i++) assert.equal(claim(db, leadParams('L-1')).length, 0, 'attempt ' + i);
  assert.equal(claim(db, leadParams('L-2')).length, 1, 'a different submission is unaffected');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, 2);
});

test('db: a late duplicate cannot overwrite what the winner stored', { skip }, () => {
  const db = open();
  claim(db, leadParams('L-1', { json: '{"owner":"winner"}' }));
  claim(db, leadParams('L-1', { json: '{"owner":"loser"}', status: 'tarea_creada' }));
  const row = db.prepare('SELECT status, row_json FROM leads WHERE submission_id = ?').get('L-1');
  assert.equal(row.row_json, '{"owner":"winner"}');
  assert.equal(row.status, 'recibido');
});

test('db: 8 threads racing for the same 25 submissions - exactly one winner each, no errors', { skip, timeout: 60000 }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'leadflow-db-'));
  const file = path.join(dir, 'race.db');
  open(file).close();
  const ids = Array.from({ length: 25 }, (_, i) => 'L-race-' + i);
  const code = `
    const { parentPort, workerData } = require('node:worker_threads');
    const { DatabaseSync } = require('node:sqlite');
    const Q = require(workerData.queries);
    const db = new DatabaseSync(workerData.file);
    db.exec('PRAGMA busy_timeout = 10000');
    const sql = Q.claimNew.replace(/\\$(\\d+)/g, '?$1');
    const won = [];
    for (const id of workerData.ids) {
      const rows = db.prepare(sql).all(id, 'lead-1', 'h', 'a@x-demo.example', 'recibido', 0, workerData.t, workerData.t, '{"by":' + workerData.n + '}');
      if (rows.length) won.push(id);
    }
    parentPort.postMessage({ n: workerData.n, won });
  `;
  const results = await Promise.all(Array.from({ length: 8 }, (_, n) => new Promise((resolve, reject) => {
    const w = new Worker(code, { eval: true, workerData: { file, ids: n % 2 ? ids.slice().reverse() : ids, t: T0, n, queries: path.join(__dirname, '../db/queries.js') } });
    w.once('message', resolve); w.once('error', reject);
  })));
  const winsPerId = new Map();
  results.forEach((r) => r.won.forEach((id) => winsPerId.set(id, (winsPerId.get(id) || 0) + 1)));
  assert.equal(winsPerId.size, ids.length, 'every submission was claimed by somebody');
  for (const [id, n] of winsPerId) assert.equal(n, 1, id + ' was claimed ' + n + ' times');
  const check = open(file);
  assert.equal(check.prepare('SELECT COUNT(*) AS n FROM leads').get().n, ids.length);
  check.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('db: claimStale is a compare-and-set - one recoverer wins, a fresh row is untouched', { skip }, () => {
  const db = open();
  claim(db, leadParams('L-1'));
  // fresh: updated_at is not older than the cut-off
  assert.equal(run(db, 'claimStale', ['L-1', at(5), at(-15)]).length, 0, 'fresh row cannot be taken');
  // stale: the first caller wins and bumps retry_count; the second sees the new updated_at and loses
  const first = run(db, 'claimStale', ['L-1', at(30), at(15)]);
  assert.equal(first.length, 1);
  assert.equal(first[0].retry_count, 1);
  assert.equal(run(db, 'claimStale', ['L-1', at(30), at(15)]).length, 0, 'second recoverer loses');
  // rows that are not "recibido" are never claimed
  claim(db, leadParams('L-2', { status: 'tarea_creada' }));
  assert.equal(run(db, 'claimStale', ['L-2', at(60), at(45)]).length, 0);
});

test('db: finishLead only moves unfinished leads and never overwrites a finished one', { skip }, () => {
  const db = open();
  claim(db, leadParams('L-1'));
  assert.equal(run(db, 'finishLead', ['L-1', 'tarea_creada', at(1), '{"v":1}']).length, 1);
  assert.equal(run(db, 'finishLead', ['L-1', 'error_ia', at(2), '{"v":2}']).length, 0, 'a late writer is ignored');
  const row = db.prepare('SELECT status, row_json FROM leads WHERE submission_id = ?').get('L-1');
  assert.deepEqual({ ...row }, { status: 'tarea_creada', row_json: '{"v":1}' });
  claim(db, leadParams('L-2', { status: 'error_ia' }));
  assert.equal(run(db, 'finishLead', ['L-2', 'tarea_creada', at(3), '{}']).length, 1, 'a failed lead can still be completed');
});

test('db: saveTask never overwrites what a person did to the task, and enforces the foreign key', { skip }, () => {
  const db = open();
  claim(db, leadParams('L-1'));
  assert.equal(run(db, 'saveTask', ['T-1', 'L-1', 'pendiente_aprobacion', T0, '{"draft":"v1"}']).length, 1);
  db.prepare("UPDATE tasks SET status = 'aprobada', row_json = '{\"draft\":\"edited by a person\"}' WHERE task_id = 'T-1'").run();
  assert.equal(run(db, 'saveTask', ['T-1', 'L-1', 'pendiente_aprobacion', at(5), '{"draft":"v2"}']).length, 0);
  const row = db.prepare('SELECT status, row_json FROM tasks WHERE task_id = ?').get('T-1');
  assert.deepEqual({ ...row }, { status: 'aprobada', row_json: '{"draft":"edited by a person"}' });
  assert.throws(() => run(db, 'saveTask', ['T-2', 'L-unknown', 'pendiente_aprobacion', T0, '{}']), /FOREIGN KEY/i);
});

test('db: logError is idempotent', { skip }, () => {
  const db = open();
  assert.equal(run(db, 'logError', ['E-1', null, T0, '{"m":"a"}']).length, 1);
  assert.equal(run(db, 'logError', ['E-1', null, at(1), '{"m":"b"}']).length, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM errors').get().n, 1);
});

test('db: hostile values are stored as data and cannot change the statements', { skip }, () => {
  const db = open();
  const evil = ["x'); DROP TABLE leads; --", '1 OR 1=1', '"; DELETE FROM tasks; --', '\u0000nul', '${process.exit(1)}', "' || (SELECT 1) || '"];
  evil.forEach((v, i) => claim(db, leadParams('L-evil-' + i, { email: v, json: JSON.stringify({ v }) })));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM leads').get().n, evil.length);
  assert.equal(db.prepare('SELECT email FROM leads WHERE submission_id = ?').get('L-evil-0').email, evil[0]);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'leads'").get().n, 1);
});

test('db: historyByLead returns the lead history in arrival order', { skip }, () => {
  const db = open();
  claim(db, leadParams('L-b', { received: at(10) }));
  claim(db, leadParams('L-a', { received: at(1) }));
  claim(db, leadParams('L-other', { lead_id: 'lead-2', received: at(5) }));
  assert.deepEqual(run(db, 'historyByLead', ['lead-1']).map((r) => r.submission_id), ['L-a', 'L-b']);
});

test('db: the real pipeline objects fit the claim - two executions of one request, one winner', { skip }, () => {
  const db = open();
  const lead = core.normalizeLead(F.HOT, { now: T0 }).lead;
  const row = core.receivedRow(lead, T0);
  const attempt = () => claim(db, { id: lead.submission_id, lead_id: lead.lead_id, hash: lead.content_hash, email: lead.email, status: row.status, retry: Number(row.retry_count) || 0, received: T0, updated: T0, json: JSON.stringify(row) });
  const outcomes = [attempt().length, attempt().length];
  assert.deepEqual(outcomes.sort(), [0, 1]);
  const stored = JSON.parse(db.prepare('SELECT row_json FROM leads WHERE submission_id = ?').get(lead.submission_id).row_json);
  assert.deepEqual(Object.keys(stored), core.COLUMNS.leads);
});
