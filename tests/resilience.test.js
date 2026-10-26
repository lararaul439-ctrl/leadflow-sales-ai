'use strict';
/*
 * Failure handling. Everything here runs on the in-memory simulator (real generated Code nodes, simulated
 * Google Sheets and simulated AI). It shows what the workflow LOGIC does when a step fails; it does not show
 * how Google Sheets or Groq behave in production.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/lead-core.js');
const F = require('./fixtures/leads.js');
const { FakeSheet, sendWebhook, runRetry, runErrorHandler } = require('./helpers/n8n-sim.js');

const T0 = F.NOW;
const at = (sec) => new Date(Date.parse(T0) + sec * 1000).toISOString();
const ok = () => F.aiResponse(F.HOT_AI);
const STAGES = ['lookup', 'claim-append', 'claims-read', 'received-write', 'task-write', 'lead-write', 'error-write'];

function snapshot(sheet) {
  return {
    leads: sheet.tabs.leads.length,
    status: sheet.tabs.leads[0] ? sheet.tabs.leads[0].status : null,
    tasks: sheet.tabs.seguimiento.length,
    errors: sheet.tabs.errores.length
  };
}

// ------------------------------------------------------------------ Google Sheets failures
test('sheets: a failure that lasts through all 3 attempts never loses or doubles a lead, at any stage', () => {
  for (const stage of STAGES) {
    const sheet = new FakeSheet();
    const ai = stage === 'error-write' ? () => ({ error: 'provider down' }) : ok;
    const first = sendWebhook(sheet, F.HOT, { now: T0, aiResponder: ai, fail: (s) => s === stage });
    assert.ok(first.executionError, stage + ': the execution is marked as failed, so the operator can see it');

    // The caller is never told "duplicate" while no lead row exists.
    const probes = [[5, ok], [60, ok]];
    for (const [sec, responder] of probes) {
      const r = sendWebhook(sheet, F.HOT, { now: at(sec), aiResponder: responder });
      if (r.responded.code === 200) assert.equal(sheet.tabs.leads.length, 1, stage + ': "duplicate" answered without a stored lead at +' + sec + 's');
      assert.ok([200, 202, 503].includes(r.responded.code), stage + ' +' + sec + 's -> ' + r.responded.code);
    }
    // The retry path (manual trigger) finishes whatever is left. Never more than one lead / one task.
    runRetry(sheet, { now: at(3600), aiResponder: ok });
    runRetry(sheet, { now: at(7200), aiResponder: ok });
    const s = snapshot(sheet);
    assert.equal(s.leads, 1, stage + ': exactly one lead row');
    assert.equal(s.tasks, 1, stage + ': exactly one follow-up task');
    assert.equal(s.status, 'tarea_creada', stage + ': ends in a completed state');
  }
});

test('sheets: a failure that hits only the first attempt is absorbed by the node retries', () => {
  const reference = new FakeSheet();
  sendWebhook(reference, F.HOT, { now: T0, aiResponder: ok });
  for (const stage of STAGES.filter((s) => s !== 'error-write')) {
    const sheet = new FakeSheet();
    const r = sendWebhook(sheet, F.HOT, { now: T0, aiResponder: ok, fail: (s, attempt) => s === stage && attempt <= 2 });
    assert.equal(r.executionError, undefined, stage);
    assert.equal(r.responded.code, 202, stage);
    assert.deepEqual(snapshot(sheet), snapshot(reference), stage);
  }
});

test('sheets: three consecutive failures exhaust the retries and fail the execution loudly', () => {
  const sheet = new FakeSheet();
  let calls = 0;
  const r = sendWebhook(sheet, F.HOT, { now: T0, aiResponder: ok, fail: (s) => { if (s === 'lookup') { calls++; return true; } return false; } });
  assert.equal(calls, 3, 'exactly 3 tries, not an endless loop');
  assert.equal(r.responded.code, 500);
  assert.match(r.executionError, /simulated Google Sheets failure/);
  assert.equal(sheet.writes.length, 0, 'nothing was written');
});

test('sheets: a lead whose task was written but whose lead row was not does not get a second task', () => {
  const sheet = new FakeSheet();
  sendWebhook(sheet, F.HOT, { now: T0, aiResponder: ok, fail: (s) => s === 'lead-write' });
  assert.equal(sheet.tabs.seguimiento.length, 1);
  assert.equal(sheet.tabs.leads[0].status, 'recibido');
  const aiCalls = [];
  runRetry(sheet, { now: at(3600), aiResponder: (req) => { aiCalls.push(1); return ok(); } });
  assert.equal(sheet.tabs.seguimiento.length, 1, 'same deterministic task id -> overwritten, not duplicated');
  assert.equal(sheet.tabs.seguimiento[0].status, 'pendiente_aprobacion');
  assert.equal(sheet.tabs.leads[0].status, 'tarea_creada');
  assert.equal(aiCalls.length, 1);
});

test('sheets: an error-log failure does not hide the lead or its state', () => {
  const sheet = new FakeSheet();
  sendWebhook(sheet, F.HOT, { now: T0, aiResponder: () => ({ error: 'down' }), fail: (s) => s === 'error-write' });
  assert.equal(sheet.tabs.leads[0].status, 'error_ia');
  assert.equal(sheet.tabs.errores.length, 0);
  runRetry(sheet, { now: at(3600), aiResponder: ok });
  assert.equal(sheet.tabs.leads[0].status, 'tarea_creada');
});

// ------------------------------------------------------------------ AI failures
const H = F.HOT_AI;
const AI_FAILURES = [
  ['HTTP 429 rate limit', () => ({ error: 'Rate limit reached (429)' }), 'error_ia', /429/],
  ['HTTP 500 with an error object', () => ({ error: { message: 'Internal Server Error', httpCode: '500' } }), 'error_ia', /500/],
  ['timeout', () => ({ error: 'timeout of 30000ms exceeded' }), 'error_ia', /timeout/],
  ['empty choices', () => ({ choices: [] }), 'error_ia', /vac/],
  ['no choices field', () => ({}), 'error_ia', /vac/],
  ['null body', () => null, 'error_ia', /vac/],
  ['content is null', () => ({ choices: [{ message: { content: null }, finish_reason: 'stop' }] }), 'error_ia', /vac/],
  ['truncated output (finish_reason=length)', () => F.aiResponse('{"intent":"ready_to_buy","intent_evid', 'length'), 'error_validacion_ia', /truncad/],
  ['complete JSON but finish_reason=length', () => F.aiResponse(H, 'length'), 'error_validacion_ia', /truncad/],
  ['prose instead of JSON', () => F.aiResponse('Claro, aquí tienes el análisis: el lead es muy bueno.'), 'error_validacion_ia', /JSON/],
  ['a JSON array', () => F.aiResponse('[1,2,3]'), 'error_validacion_ia', /objeto/],
  ['a JSON string', () => F.aiResponse('"hola"'), 'error_validacion_ia', /objeto/],
  ['enum value outside the schema', () => F.aiResponse(Object.assign({}, H, { intent: 'super_hot' })), 'error_validacion_ia', /intent/],
  ['required fields missing', () => F.aiResponse({ intent: 'ready_to_buy' }), 'error_validacion_ia', /summary/],
  ['oversized answer', () => F.aiResponse(Object.assign({}, H, { summary: 'x'.repeat(100000) })), 'error_validacion_ia', /grande/]
];

test('ai: every failure mode keeps the lead, logs a bounded reason and creates no task', () => {
  for (const [name, responder, status, reason] of AI_FAILURES) {
    const sheet = new FakeSheet();
    const r = sendWebhook(sheet, F.HOT, { now: T0, aiResponder: responder });
    assert.equal(r.responded.code, 202, name + ': the caller was already answered');
    assert.equal(r.executionError, undefined, name + ': no workflow crash');
    const lead = sheet.tabs.leads[0];
    assert.equal(lead.status, status, name);
    assert.equal(lead.priority, '', name + ': no score is invented');
    assert.equal(sheet.tabs.seguimiento.length, 0, name + ': no task from an unusable answer');
    assert.equal(sheet.tabs.errores.length, 1, name);
    assert.match(sheet.tabs.errores[0].message, reason, name);
    assert.ok(sheet.tabs.errores[0].message.length <= core.CONFIG.limits.error, name + ': bounded');
  }
});

test('ai: unusable answers are retried a bounded number of times and then handed to a person', () => {
  for (const [name, responder] of AI_FAILURES) {
    const sheet = new FakeSheet();
    sendWebhook(sheet, F.HOT, { now: T0, aiResponder: responder });
    for (let i = 1; i <= 6; i++) runRetry(sheet, { now: at(i * 1200), aiResponder: responder });
    const lead = sheet.tabs.leads[0];
    assert.equal(lead.status, 'error_definitivo', name);
    assert.equal(lead.human_review_required, 'sí', name);
    assert.equal(Number(lead.retry_count), core.CONFIG.maxRetries, name + ': never more than the configured attempts');
    assert.equal(sheet.tabs.seguimiento.length, 0, name);
  }
});

test('ai: partially wrong but well-formed answers are accepted only with the right penalty', () => {
  const run = (answer) => { const sheet = new FakeSheet(); sendWebhook(sheet, F.HOT, { now: T0, aiResponder: () => answer }); return sheet; };
  // JSON wrapped in a markdown fence is tolerated
  assert.equal(run(F.aiResponse('```json\n' + JSON.stringify(H) + '\n```')).tabs.leads[0].status, 'tarea_creada');
  // out-of-range or non-numeric confidence -> low confidence -> human review
  for (const confidence of [7, -1, 'alta', null]) {
    const s = run(F.aiResponse(Object.assign({}, H, { confidence })));
    assert.ok(s.tabs.leads[0].flags.includes('confianza_baja'), String(confidence));
    assert.equal(s.tabs.leads[0].human_review_required, 'sí');
  }
  // evidence that is not in the message -> the claim is discarded and the lead is reviewed
  const invented = run(F.aiResponse(Object.assign({}, H, { intent_evidence: 'esto no aparece en el mensaje' })));
  assert.ok(invented.tabs.leads[0].flags.includes('evidencia_no_encontrada'));
  assert.equal(invented.tabs.leads[0].human_review_required, 'sí');
  assert.notEqual(invented.tabs.leads[0].priority, 'alta');
  // extra fields (priority, score) are ignored: the model cannot set them
  const extra = run(F.aiResponse(Object.assign({}, H, { priority: 'baja', score: 1, human_review_required: 'no' })));
  assert.ok(extra.tabs.leads[0].flags.includes('ia_campos_inesperados'));
  assert.equal(extra.tabs.leads[0].priority, 'alta', 'priority comes from the deterministic score, not from the model');
  assert.equal(Number(extra.tabs.leads[0].score), 90);
});

test('ai: a failing provider does not block unrelated leads and does not leak between them', () => {
  const sheet = new FakeSheet();
  const flaky = (req, lead) => (String(lead.email).endsWith('@a-demo.example') ? { error: 'down' } : ok());
  sendWebhook(sheet, Object.assign({}, F.HOT, { email: 'x@a-demo.example' }), { now: T0, aiResponder: flaky });
  sendWebhook(sheet, Object.assign({}, F.HOT, { email: 'y@b-demo.example' }), { now: at(1), aiResponder: flaky });
  const byStatus = sheet.tabs.leads.map((l) => l.status).sort();
  assert.deepEqual(byStatus, ['error_ia', 'tarea_creada']);
  assert.equal(sheet.tabs.seguimiento.length, 1);
});

// ------------------------------------------------------------------ error handler workflow
test('error handler: odd or hostile error-trigger payloads still produce one bounded row', () => {
  const inputs = [
    undefined, null, {}, { execution: null }, { execution: {} }, { execution: { id: 12345, lastNodeExecuted: 7 } },
    { execution: { id: 'ab\ncd', lastNodeExecuted: '=HYPERLINK("http://evil.example")', error: { message: '=cmd|calc', stack: 's'.repeat(50000) } } },
    { execution: { id: 'x'.repeat(5000), lastNodeExecuted: 'n'.repeat(5000), error: 'e'.repeat(50000) } },
    { execution: { error: { message: 'Authorization: Bearer gsk_abcdefghijklmnopqrstuvwxyz0123456789' } } }
  ];
  for (const info of inputs) {
    const row = runErrorHandler(info === undefined ? {} : info, T0);
    assert.deepEqual(Object.keys(row), core.COLUMNS.errores);
    assert.equal(row.stage, 'ejecucion_fallida');
    assert.ok(row.message.length <= core.CONFIG.limits.error);
    assert.ok(String(row.execution_id).length <= 40);
    assert.ok(!/gsk_[A-Za-z0-9]{10,}/.test(JSON.stringify(row)));
    assert.ok(!/^[=+\-@]/.test(row.message), 'cell does not start with a formula character');
  }
});

test('error handler: the same failed execution maps to the same row id (no row per notification)', () => {
  const info = { execution: { id: '991', lastNodeExecuted: 'Guardar lead', error: { message: 'boom' } } };
  assert.equal(runErrorHandler(info, T0).error_id, runErrorHandler(info, at(60)).error_id);
  assert.notEqual(runErrorHandler(info, T0).error_id, runErrorHandler({ execution: { id: '992', lastNodeExecuted: 'Guardar lead' } }, T0).error_id);
});

// ------------------------------------------------------------------ mixed soak
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('soak: 200 leads with random AI and Sheets faults converge with no duplicates, no lost leads and bounded retries', () => {
  const rnd = mulberry32(424242);
  const sheet = new FakeSheet();
  const accepted = new Set();
  const aiModes = [ok, ok, ok, () => ({ error: 'Rate limit reached (429)' }), () => F.aiResponse('no es json'), () => F.aiResponse(F.HOT_AI, 'length')];
  for (let i = 0; i < 200; i++) {
    const payload = Object.assign({}, F.HOT, { email: 'soak' + i + '@empresa' + (i % 11) + '-demo.example', message: F.HOT.message + ' Referencia ' + (5000 + i) + '.' });
    const responder = aiModes[Math.floor(rnd() * aiModes.length)];
    const failStage = rnd() < 0.15 ? STAGES[Math.floor(rnd() * STAGES.length)] : null;
    const persistent = rnd() < 0.3;
    const r = sendWebhook(sheet, payload, { now: at(i * 20), aiResponder: responder, fail: failStage ? (s, a) => s === failStage && (persistent || a === 1) : null });
    if (r.responded.code === 202) accepted.add(core.normalizeLead(payload, { now: at(i * 20) }).lead.submission_id);
    // clients re-send on 5xx
    if (r.responded.code >= 500) {
      const again = sendWebhook(sheet, payload, { now: at(i * 20 + 100), aiResponder: ok });
      if (again.responded.code === 202) accepted.add(core.normalizeLead(payload, { now: at(i * 20 + 100) }).lead.submission_id);
    }
  }
  // Operator runs the retry branch a few times; attempts are bounded by configuration.
  for (let round = 1; round <= 8; round++) runRetry(sheet, { now: at(100000 + round * 3600), aiResponder: ok });

  const ids = sheet.tabs.leads.map((l) => l.submission_id);
  assert.equal(new Set(ids).size, ids.length, 'one row per submission');
  const taskIds = sheet.tabs.seguimiento.map((t) => t.task_id);
  assert.equal(new Set(taskIds).size, taskIds.length, 'one task per task id');
  for (const id of accepted) assert.ok(ids.includes(id), 'accepted lead ' + id + ' is stored');
  const open = sheet.tabs.leads.filter((l) => ['recibido', 'error_ia', 'error_validacion_ia'].includes(l.status));
  assert.equal(open.length, 0, 'nothing is left in a limbo state after the retry rounds');
  assert.equal(sheet.tabs.seguimiento.length, sheet.tabs.leads.filter((l) => l.status === 'tarea_creada').length, 'every completed consenting lead has exactly one task');
  for (const l of sheet.tabs.leads) assert.ok(Number(l.retry_count) <= core.CONFIG.maxRetries, 'retry_count bounded');
  assert.equal(sheet.tabs.leads.length, 200, 'every lead was stored exactly once, whatever failed on the way');
});
