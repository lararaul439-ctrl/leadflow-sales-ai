'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/lead-core.js');
const build = require('../scripts/build-workflow.js');
const F = require('./fixtures/leads.js');
const { WORKFLOW, FakeSheet, sendWebhook, runRetry } = require('./helpers/n8n-sim.js');

const { COLUMNS, CONFIG } = core;
const ROOT = path.join(__dirname, '..');
const T0 = F.NOW;
const plusMin = (m) => new Date(Date.parse(T0) + m * 60000).toISOString();

// ------------------------------------------------------------------ structure of the export
test('export: committed workflow JSON and CSV templates are in sync with src/', () => {
  const files = build.outputs();
  for (const rel of Object.keys(files)) {
    assert.equal(fs.readFileSync(path.join(ROOT, rel), 'utf8'), files[rel], rel + ' is out of date: run npm run build');
  }
});

test('export: node names are unique and every connection points to an existing node', () => {
  const names = WORKFLOW.nodes.map((n) => n.name);
  assert.equal(new Set(names).size, names.length);
  assert.equal(new Set(WORKFLOW.nodes.map((n) => n.id)).size, names.length);
  for (const [from, c] of Object.entries(WORKFLOW.connections)) {
    assert.ok(names.includes(from), from);
    for (const outs of c.main) for (const t of outs) assert.ok(names.includes(t.node), from + ' -> ' + t.node);
  }
});

test('export: nothing in the workflow can send an email or message', () => {
  const forbidden = /gmail|sendgrid|mailgun|smtp|emailSend|slack|telegram|twilio|whatsapp|outlook|mailchimp|sendinblue|postmark/i;
  for (const n of WORKFLOW.nodes) {
    assert.ok(!forbidden.test(n.type), n.type);
  }
  const allowedTypes = new Set(['n8n-nodes-base.webhook', 'n8n-nodes-base.manualTrigger', 'n8n-nodes-base.set', 'n8n-nodes-base.if', 'n8n-nodes-base.code', 'n8n-nodes-base.googleSheets', 'n8n-nodes-base.httpRequest', 'n8n-nodes-base.respondToWebhook', 'n8n-nodes-base.stickyNote']);
  for (const n of WORKFLOW.nodes) assert.ok(allowedTypes.has(n.type), 'unexpected node type ' + n.type);
  const http = WORKFLOW.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
  assert.equal(http.length, 1);
  assert.equal(http[0].parameters.url, CONFIG.ai.url);
});

test('export: no secrets, tokens, real credential ids or spreadsheet ids are committed', () => {
  const text = fs.readFileSync(path.join(ROOT, 'workflows/leadflow-sales-ai.json'), 'utf8');
  assert.ok(!/gsk_[A-Za-z0-9]{10,}/.test(text), 'Groq key pattern');
  assert.ok(!/AIza[0-9A-Za-z_-]{20,}/.test(text), 'Google key pattern');
  assert.ok(!/Bearer\s+[A-Za-z0-9._-]{15,}/.test(text), 'bearer token');
  assert.ok(!/\b1[A-Za-z0-9_-]{43}\b/.test(text.replace(/[a-f0-9]{8}-[a-f0-9-]{27}/g, '')), 'spreadsheet-id-like string');
  for (const n of WORKFLOW.nodes) {
    for (const cred of Object.values(n.credentials || {})) assert.equal(cred.id, 'REPLACE_WITH_YOUR_CREDENTIAL', n.name);
  }
  const cfg = WORKFLOW.nodes.find((n) => n.name === 'Configuración');
  assert.equal(cfg.parameters.assignments.assignments[0].value, 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE');
  assert.ok(!/\$env|process\.env/.test(text));
});

test('export: the webhook requires header authentication and replies from a Respond node', () => {
  const wh = WORKFLOW.nodes.find((n) => n.type === 'n8n-nodes-base.webhook');
  assert.equal(wh.parameters.authentication, 'headerAuth');
  assert.equal(wh.parameters.httpMethod, 'POST');
  assert.equal(wh.parameters.responseMode, 'responseNode');
});

test('export: every Sheets write maps every documented column and matches on the right key', () => {
  const expected = {
    'Registrar recibido': ['leads', 'submission_id'],
    'Guardar tarea': ['seguimiento', 'task_id'],
    'Guardar lead': ['leads', 'submission_id'],
    'Registrar error': ['errores', 'error_id']
  };
  for (const [name, [tab, key]] of Object.entries(expected)) {
    const n = WORKFLOW.nodes.find((x) => x.name === name);
    assert.equal(n.parameters.sheetName.value, tab, name);
    assert.deepEqual(n.parameters.columns.matchingColumns, [key], name);
    assert.deepEqual(Object.keys(n.parameters.columns.value), COLUMNS[tab], name);
    assert.equal(n.parameters.options.cellFormat, 'RAW', name + ' must write RAW so cells starting with = are never evaluated');
    assert.equal(n.parameters.options.useAppend, true, name + ' must use the Sheets append API: without it two simultaneous runs can pick the same row and one overwrites the other (seen live)');
  }
});

test('export: AI call has timeout, retries, error pass-through and throttling', () => {
  const n = WORKFLOW.nodes.find((x) => x.name === 'Analizar con IA');
  assert.equal(n.onError, 'continueRegularOutput');
  assert.equal(n.retryOnFail, true);
  assert.equal(n.maxTries, 3);
  assert.equal(n.parameters.options.timeout, 30000);
  assert.ok(n.parameters.options.batching.batch.batchInterval >= 1000);
});

test('export: the retry branch and the webhook branch converge on the same AI step', () => {
  const c = WORKFLOW.connections;
  const targets = (from) => c[from].main.flat().map((t) => t.node);
  assert.ok(targets('Registrar recibido').includes('Preparar petición IA'));
  assert.ok(targets('Preparar reintentos').includes('Preparar petición IA'));
  assert.deepEqual(targets('Registrar recibido')[0], 'Responder aceptado', 'the caller is answered before the AI runs');
});

// ---- graph helpers: prove properties of the wiring, not just that nodes exist
// `skipEdge(node, outputIndex)` removes individual edges, `without` removes a whole node.
function reachable(from, without, skipEdge) {
  const seen = new Set();
  const stack = [from];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n) || n === without) continue;
    seen.add(n);
    const c = WORKFLOW.connections[n];
    if (!c) continue;
    c.main.forEach((outs, index) => { if (!(skipEdge && skipEdge(n, index))) outs.forEach((t) => stack.push(t.node)); });
  }
  return seen;
}
const notRetryBranch = (node, index) => node === '¿Envío web?' && index === 1;
const notWebBranch = (node, index) => node === '¿Envío web?' && index === 0;

test('export: the processing mode is a constant of the wiring, never derived from request data', () => {
  const web = WORKFLOW.nodes.find((n) => n.name === 'Modo: envío web').parameters.assignments.assignments;
  const retry = WORKFLOW.nodes.find((n) => n.name === 'Modo: reintento').parameters.assignments.assignments;
  assert.deepEqual(web.map((a) => [a.name, a.value]), [['mode', 'webhook']], 'plain constant, not an expression');
  assert.deepEqual(retry.map((a) => [a.name, a.value]), [['mode', 'retry']]);
  const cfg = WORKFLOW.nodes.find((n) => n.name === 'Configuración').parameters.assignments.assignments.map((a) => a.name);
  assert.ok(!cfg.includes('mode'), 'the shared config node must not recompute the mode');
  const c = WORKFLOW.connections;
  assert.deepEqual(c['Webhook de leads'].main.flat().map((t) => t.node), ['Modo: envío web']);
  assert.deepEqual(c['Reintentar fallidos'].main.flat().map((t) => t.node), ['Modo: reintento']);
  const inbound = (name) => Object.entries(c).filter(([, v]) => v.main.flat().some((t) => t.node === name)).map(([k]) => k);
  assert.deepEqual(inbound('Modo: envío web'), ['Webhook de leads']);
  assert.deepEqual(inbound('Modo: reintento'), ['Reintentar fallidos']);
  const branch = WORKFLOW.nodes.find((n) => n.name === '¿Envío web?').parameters.conditions.conditions[0];
  assert.equal(branch.leftValue, '={{ $json.mode }}');
  assert.equal(branch.rightValue, 'webhook');
});

test('export: validation is a choke point - webhook traffic reaches Sheets or the AI only through it', () => {
  const unvalidated = reachable('Webhook de leads', 'Validar y normalizar', notRetryBranch);
  for (const n of ['Buscar historial del lead', 'Reclamar envío', 'Registrar recibido', 'Analizar con IA', 'Guardar tarea', 'Guardar lead', 'Registrar error', 'Leer filas para reintento']) {
    assert.ok(!unvalidated.has(n), n + ' must not be reachable around validation');
  }
  assert.ok(reachable('Webhook de leads', null, notRetryBranch).has('Analizar con IA'), 'sanity: the AI is reachable through the validated path');
  assert.ok(!reachable('Webhook de leads', null, notRetryBranch).has('Leer filas para reintento'), 'webhook traffic never reaches the retry reader');
});

test('export: the AI is only reachable through a won claim (webhook) or the retry preparation (manual)', () => {
  assert.ok(!reachable('Webhook de leads', 'Registrar recibido', notRetryBranch).has('Analizar con IA'), 'webhook -> AI must go through "Registrar recibido"');
  const noWin = reachable('Webhook de leads', '¿Reclamación ganada?', notRetryBranch);
  assert.ok(!noWin.has('Analizar con IA') && !noWin.has('Registrar recibido'), 'no AI without the arbitration verdict');
  assert.ok(!reachable('Webhook de leads', 'Reclamar envío', notRetryBranch).has('Analizar con IA'), 'no AI without writing a claim first');
  const manual = reachable('Reintentar fallidos', null, notWebBranch);
  assert.ok(manual.has('Preparar reintentos') && manual.has('Analizar con IA'));
  assert.ok(!manual.has('Validar y normalizar') && !manual.has('Reclamar envío'), 'manual mode does not take new submissions');
  assert.ok(!reachable('Reintentar fallidos', 'Preparar reintentos', notWebBranch).has('Analizar con IA'));
});

test('export: the losing side of the claim can only answer, never process', () => {
  const loser = reachable('Comprobar ganador');
  assert.deepEqual([...loser].sort(), ['Comprobar ganador', 'Confirmar ganador', 'Responder duplicado'].sort());
  const dup = reachable('Responder duplicado');
  assert.deepEqual([...dup], ['Responder duplicado']);
  const c = WORKFLOW.connections;
  assert.equal(c['¿Reclamación ganada?'].main[0][0].node, 'Registrar recibido', 'true branch');
  assert.equal(c['¿Reclamación ganada?'].main[1][0].node, 'Comprobar ganador', 'false branch');
  assert.equal(c['¿Procesar?'].main[0][0].node, 'Reclamar envío');
  assert.equal(c['¿Procesar?'].main[1][0].node, 'Responder duplicado');
});

test('export: the claim is written to its own tab with every documented column', () => {
  const n = WORKFLOW.nodes.find((x) => x.name === 'Reclamar envío');
  assert.equal(n.parameters.operation, 'append');
  assert.equal(n.parameters.sheetName.value, 'claims');
  assert.deepEqual(Object.keys(n.parameters.columns.value), COLUMNS.claims);
  assert.equal(n.parameters.options.cellFormat, 'RAW');
  assert.equal(n.parameters.options.useAppend, true, 'the claim row must be inserted by the append API, not written to a computed row');
  assert.deepEqual(n.parameters.columns.schema.map((c) => c.id), COLUMNS.claims, 'the append operation needs columns.schema (found by the first live run)');
  const read = WORKFLOW.nodes.find((x) => x.name === 'Leer reclamaciones');
  assert.equal(read.parameters.sheetName.value, 'claims');
  assert.equal(read.alwaysOutputData, true, 'an empty read must still reach the arbitration code');
});

test('export: every Google Sheets and HTTP node retries three times with a pause; only the AI call passes errors on', () => {
  const external = WORKFLOW.nodes.filter((n) => n.type === 'n8n-nodes-base.googleSheets' || n.type === 'n8n-nodes-base.httpRequest');
  assert.ok(external.length >= 10);
  for (const n of external) {
    assert.equal(n.retryOnFail, true, n.name);
    assert.equal(n.maxTries, 3, n.name);
    assert.ok(n.waitBetweenTries >= 1000, n.name);
    if (n.name === 'Analizar con IA') assert.equal(n.onError, 'continueRegularOutput');
    else assert.ok(!n.onError || n.onError === 'stopWorkflow', n.name + ' must fail loudly instead of continuing');
  }
});

test('export: execution limits and data-retention settings', () => {
  assert.ok(WORKFLOW.settings.executionTimeout > 0 && WORKFLOW.settings.executionTimeout <= 180, 'n8n Cloud rejects timeouts above 180 s (found live)');
  assert.equal(WORKFLOW.settings.saveDataSuccessExecution, 'none', 'successful executions (which contain personal data) are not stored');
  assert.equal(WORKFLOW.settings.saveManualExecutions, false);
});

test('export: HTTP responses are computed from the server verdict', () => {
  const dup = WORKFLOW.nodes.find((n) => n.name === 'Responder duplicado');
  const code = dup.parameters.options.responseCode;
  for (const status of ['409', '429', '503', '200']) assert.ok(code.includes(status), 'response code ' + status);
  const body = dup.parameters.responseBody;
  for (const key of ['identifier_conflict', 'rate_limited', 'in_progress', 'duplicate: true']) assert.ok(body.includes(key), key);
  const bad = WORKFLOW.nodes.find((n) => n.name === 'Responder error de validación');
  assert.match(bad.parameters.options.responseCode, /http_status \|\| 422/);
  assert.ok(!/\$json\.(email|message|full_name|phone)/.test(bad.parameters.responseBody), 'validation answers never echo personal data');
  const ok = WORKFLOW.nodes.find((n) => n.name === 'Responder aceptado');
  assert.equal(ok.parameters.options.responseCode, 202);
});

test('export: the optional error-handler workflow is wired, credential-free and safe to import', () => {
  const H = require('./helpers/n8n-sim.js').ERROR_WORKFLOW;
  assert.deepEqual(H.nodes.map((n) => n.type).sort(), ['n8n-nodes-base.code', 'n8n-nodes-base.errorTrigger', 'n8n-nodes-base.googleSheets', 'n8n-nodes-base.set']);
  const order = ['Error Trigger', 'Configuración', 'Construir fila de error', 'Registrar ejecución fallida'];
  order.slice(0, -1).forEach((from, i) => assert.equal(H.connections[from].main[0][0].node, order[i + 1], from));
  const sheet = H.nodes.find((n) => n.name === 'Registrar ejecución fallida');
  assert.equal(sheet.parameters.sheetName.value, 'errores');
  assert.deepEqual(Object.keys(sheet.parameters.columns.value), COLUMNS.errores);
  assert.equal(sheet.parameters.options.cellFormat, 'RAW');
  assert.equal(sheet.parameters.options.useAppend, true);
  assert.deepEqual(sheet.parameters.columns.schema.map((c) => c.id), COLUMNS.errores, 'the append operation needs columns.schema');
  assert.equal(sheet.credentials.googleSheetsOAuth2Api.id, 'REPLACE_WITH_YOUR_CREDENTIAL');
  assert.equal(H.settings.saveDataErrorExecution, 'none');
  const text = JSON.stringify(H);
  assert.ok(!/gsk_[A-Za-z0-9]{10,}|Bearer\s+[A-Za-z0-9._-]{15,}|AIza[0-9A-Za-z_-]{20,}|\$env/.test(text));
  assert.ok(H.nodes.find((n) => n.name === 'Configuración').parameters.assignments.assignments[0].value === 'PASTE_YOUR_GOOGLE_SHEET_ID_HERE');
});

test('export: generated Code nodes contain no external dependencies', () => {
  for (const n of WORKFLOW.nodes.filter((x) => x.type === 'n8n-nodes-base.code')) {
    const code = n.parameters.jsCode;
    assert.ok(!/\brequire\s*\(|\bimport\s|process\.|fetch\(|XMLHttpRequest/.test(code), n.name);
    assert.ok(!/module\.exports/.test(code), n.name);
    new Function('$input', '$', code);
  }
});

// ------------------------------------------------------------------ whole-flow scenarios on the simulator
const okAi = (obj) => () => F.aiResponse(obj);
function post(sheet, payload, ai, now, extra) {
  return sendWebhook(sheet, payload, Object.assign({ now: now || T0, aiResponder: ai || okAi(F.HOT_AI) }, extra || {}));
}

test('flow: a valid lead is accepted, scored, saved once and gets one pending task', () => {
  const sheet = new FakeSheet();
  const r = post(sheet, F.HOT);
  assert.equal(r.responded.code, 202);
  assert.equal(sheet.tabs.leads.length, 1);
  assert.equal(sheet.tabs.seguimiento.length, 1);
  assert.equal(sheet.tabs.errores.length, 0);
  const lead = sheet.tabs.leads[0];
  assert.equal(lead.status, 'tarea_creada');
  assert.equal(lead.priority, 'alta');
  assert.match(lead.status_history, /recibido@.*> clasificado@.*> puntuado@.*> tarea_creada@/);
  assert.equal(sheet.tabs.seguimiento[0].status, 'pendiente_aprobacion');
});

test('flow: an invalid lead is rejected with field errors and nothing is written', () => {
  const sheet = new FakeSheet();
  const r = post(sheet, { full_name: 'X', email: 'nope', message: 'corto' });
  assert.equal(r.responded.code, 422);
  assert.ok(r.responded.body.errors.length >= 3);
  assert.ok(!JSON.stringify(r.responded.body).includes('nope'), 'input values are not echoed back');
  assert.equal(sheet.writes.length, 0);
});

test('flow: sending the same lead twice (even 10 times) never duplicates rows or tasks', () => {
  const sheet = new FakeSheet();
  let aiCalls = 0;
  const ai = () => { aiCalls++; return F.aiResponse(F.HOT_AI); };
  const codes = [];
  for (let i = 0; i < 10; i++) codes.push(post(sheet, F.HOT, ai, plusMin(i)).responded.code);
  assert.deepEqual(codes, [202, 200, 200, 200, 200, 200, 200, 200, 200, 200]);
  assert.equal(aiCalls, 1, 'duplicates never reach the AI');
  assert.equal(sheet.tabs.leads.length, 1);
  assert.equal(sheet.tabs.seguimiento.length, 1);
});

test('flow: same person, new message -> second lead row, linked by lead_id and flagged', () => {
  const sheet = new FakeSheet();
  post(sheet, F.HOT);
  post(sheet, { ...F.HOT, message: F.HOT.message + ' Ademas queremos formacion para el equipo.' }, okAi({ ...F.HOT_AI, product_interest: '' }), plusMin(30));
  assert.equal(sheet.tabs.leads.length, 2);
  assert.equal(new Set(sheet.tabs.leads.map((l) => l.lead_id)).size, 1);
  assert.ok(sheet.tabs.leads[1].flags.includes('contacto_repetido'));
  assert.equal(sheet.tabs.seguimiento.length, 2);
});

test('flow: an AI outage keeps the lead, logs the error and creates no task; retries are bounded', () => {
  const sheet = new FakeSheet();
  const down = () => ({ error: 'The service is unavailable' });
  const r = post(sheet, F.HOT, down);
  assert.equal(r.responded.code, 202);
  assert.equal(sheet.tabs.leads[0].status, 'error_ia');
  assert.equal(sheet.tabs.leads[0].retry_count, 1);
  assert.equal(sheet.tabs.seguimiento.length, 0);
  assert.equal(sheet.tabs.errores.length, 1);
  // the same lead sent again does not bypass the retry limit
  assert.equal(post(sheet, F.HOT, okAi(F.HOT_AI), plusMin(1)).responded.code, 200);
  assert.equal(sheet.tabs.leads[0].status, 'error_ia');
  // controlled retries: still failing -> attempt 2, attempt 3 -> definitive
  runRetry(sheet, { now: plusMin(10), aiResponder: down });
  assert.equal(sheet.tabs.leads[0].retry_count, 2);
  runRetry(sheet, { now: plusMin(20), aiResponder: down });
  assert.equal(sheet.tabs.leads[0].status, 'error_definitivo');
  assert.equal(sheet.tabs.leads[0].human_review_required, 'sí');
  assert.equal(runRetry(sheet, { now: plusMin(30), aiResponder: down }).retried, 0, 'no more automatic attempts');
  assert.equal(sheet.tabs.errores.length, 3);
  assert.equal(sheet.tabs.seguimiento.length, 0);
});

test('flow: a failed lead recovers on retry without duplicating anything', () => {
  const sheet = new FakeSheet();
  post(sheet, F.HOT, () => ({ error: 'timeout' }));
  const r = runRetry(sheet, { now: plusMin(10), aiResponder: okAi(F.HOT_AI) });
  assert.equal(r.retried, 1);
  assert.equal(sheet.tabs.leads.length, 1);
  assert.equal(sheet.tabs.leads[0].status, 'tarea_creada');
  assert.equal(sheet.tabs.leads[0].retry_count, 1, 'keeps the failed attempt on record');
  assert.equal(sheet.tabs.seguimiento.length, 1);
  assert.equal(runRetry(sheet, { now: plusMin(20), aiResponder: okAi(F.HOT_AI) }).retried, 0);
  assert.equal(sheet.tabs.seguimiento.length, 1);
});

test('flow: a run that died after "recibido" is recovered by the retry path once it is stale, and not before', () => {
  const sheet = new FakeSheet();
  post(sheet, F.HOT, okAi(F.HOT_AI), T0, { failTaskWrite: true });
  assert.equal(sheet.tabs.leads[0].status, 'recibido', 'the lead stayed retryable because the task write failed first');
  assert.equal(runRetry(sheet, { now: plusMin(5), aiResponder: okAi(F.HOT_AI) }).retried, 0);
  const r = runRetry(sheet, { now: plusMin(20), aiResponder: okAi(F.HOT_AI) });
  assert.equal(r.retried, 1);
  assert.equal(sheet.tabs.leads[0].status, 'tarea_creada');
  assert.equal(sheet.tabs.seguimiento.length, 1);
  assert.equal(sheet.tabs.leads.length, 1);
});

test('flow: the webhook also recovers a stale "recibido" lead when the form is resent', () => {
  const sheet = new FakeSheet();
  post(sheet, F.HOT, okAi(F.HOT_AI), T0, { failTaskWrite: true });
  assert.equal(post(sheet, F.HOT, okAi(F.HOT_AI), plusMin(2)).responded.code, 200);
  assert.equal(post(sheet, F.HOT, okAi(F.HOT_AI), plusMin(30)).responded.code, 202);
  assert.equal(sheet.tabs.leads[0].status, 'tarea_creada');
  assert.equal(sheet.tabs.seguimiento.length, 1);
});

test('flow: a malicious lead is neutralised end to end', () => {
  const sheet = new FakeSheet();
  post(sheet, F.INJECTION, okAi(F.INJECTION_AI));
  const lead = sheet.tabs.leads[0];
  assert.equal(lead.human_review_required, 'sí');
  assert.notEqual(lead.priority, 'alta');
  assert.equal(lead.intent, 'unknown');
  const task = sheet.tabs.seguimiento[0];
  assert.equal(task.status, 'revision_humana');
  assert.ok(!/enterprise/i.test(task.draft_subject + task.draft_body));
});

test('flow: the AI never receives personal identifiers', () => {
  const sheet = new FakeSheet();
  const seen = [];
  post(sheet, { ...F.HOT, message: F.HOT.message + ' Mi IBAN es GB29 NWBK 6016 1331 9268 19 y mi tarjeta 4111 1111 1111 1111.' }, (req) => { seen.push(JSON.stringify(req)); return F.aiResponse(F.HOT_AI); });
  assert.equal(seen.length, 1);
  for (const secret of ['marta.sanz', 'Marta', 'Sanz', '600 123 456', '600123456', 'Norteclima', 'GB29', '4111']) {
    assert.ok(!seen[0].includes(secret), secret);
  }
  const stored = JSON.stringify(sheet.tabs);
  assert.ok(!/GB29 NWBK|4111 1111/.test(stored), 'payment data never reaches the sheet either');
});

test('flow: lead without consent is stored and scored but no follow-up is created', () => {
  const sheet = new FakeSheet();
  post(sheet, { ...F.HOT, consent_to_contact: false });
  assert.equal(sheet.tabs.leads[0].status, 'sin_consentimiento');
  assert.equal(sheet.tabs.seguimiento.length, 0);
});

test('flow: hostile cell content is stored as plain text and flagged', () => {
  const sheet = new FakeSheet();
  post(sheet, { ...F.HOT, company: '=HYPERLINK("http://evil.example","click")' });
  assert.ok(sheet.tabs.leads[0].flags.includes('formula_like'));
});

test('flow: every written row has exactly the documented columns, in order', () => {
  const sheet = new FakeSheet();
  post(sheet, F.HOT); post(sheet, F.COLD, okAi(F.COLD_AI), plusMin(1)); post(sheet, F.INJECTION, okAi(F.INJECTION_AI), plusMin(2));
  post(sheet, { ...F.HOT, email: 'otra@empresa-demo.example' }, () => ({ error: 'x' }), plusMin(3));
  for (const [tab, rows] of Object.entries(sheet.tabs)) {
    for (const row of rows) assert.deepEqual(Object.keys(row), COLUMNS[tab], tab);
  }
});

test('flow: 100 distinct fictional leads are processed with no duplicates and no unsent drafts lost', () => {
  const sheet = new FakeSheet();
  for (let i = 0; i < 100; i++) {
    post(sheet, { ...F.HOT, email: 'lead' + i + '@empresa' + (i % 7) + '-demo.example', message: F.HOT.message + ' Referencia interna ' + (1000 + i) + '.' }, okAi({ ...F.HOT_AI, summary: 'Quiere contratar automatizacion.' }), plusMin(i));
  }
  assert.equal(sheet.tabs.leads.length, 100);
  assert.equal(sheet.tabs.seguimiento.length, 100);
  assert.equal(new Set(sheet.tabs.leads.map((l) => l.submission_id)).size, 100);
  assert.equal(new Set(sheet.tabs.seguimiento.map((t) => t.task_id)).size, 100);
});
