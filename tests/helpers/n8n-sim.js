'use strict';
/*
 * Minimal n8n simulator for the Code nodes of workflows/*.json.
 *
 * It runs the REAL jsCode of every Code node inside a vm sandbox that provides $input, $(), $execution and
 * $getWorkflowStaticData. Google Sheets reads/writes and the AI call are simulated in memory: this is NOT
 * n8n and NOT Google. IF / Respond expressions are not interpreted; the routing that they implement is
 * mirrored by hand below and checked structurally by tests/workflow.test.js.
 *
 * Executions are generators that yield before every external I/O step, so tests can interleave several
 * executions deterministically (simulated concurrency) and inject failures at any step.
 */
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs');
const core = require('../../src/lead-core.js');

const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../workflows', f), 'utf8'));
const WORKFLOW = load('leadflow-sales-ai.json');
const ERROR_WORKFLOW = load('leadflow-sales-ai-error-handler.json');

const scripts = new Map();
function scriptOf(wf, name) {
  const key = wf.name + '|' + name;
  if (!scripts.has(key)) {
    const n = wf.nodes.find((x) => x.name === name);
    if (!n) throw new Error('No node ' + name);
    scripts.set(key, new vm.Script('(function($input, $, $execution, $getWorkflowStaticData){' + n.parameters.jsCode + '\n})'));
  }
  return scripts.get(key);
}

/** In-memory Google Sheet with the tabs; upsert matches on a key column like the real node. */
class FakeSheet {
  constructor() {
    this.tabs = { leads: [], seguimiento: [], errores: [], claims: [] };
    this.writes = [];
    this.staticData = {};
  }
  read(tab, filter) {
    return this.tabs[tab].filter((r) => !filter || String(r[filter.col]) === String(filter.val)).map((r) => JSON.parse(JSON.stringify(r)));
  }
  check(tab, row) {
    const missing = core.COLUMNS[tab].filter((c) => !(c in row));
    if (missing.length) throw new Error('Row for ' + tab + ' misses columns: ' + missing.join(','));
    const extra = Object.keys(row).filter((c) => !core.COLUMNS[tab].includes(c));
    if (extra.length) throw new Error('Row for ' + tab + ' has undocumented columns: ' + extra.join(','));
  }
  upsert(tab, key, row) {
    this.check(tab, row);
    const idx = this.tabs[tab].findIndex((r) => String(r[key]) === String(row[key]));
    this.writes.push({ tab, key: row[key], mode: idx >= 0 ? 'update' : 'append' });
    if (idx >= 0) this.tabs[tab][idx] = Object.assign({}, row); else this.tabs[tab].push(Object.assign({}, row));
  }
  append(tab, row) {
    this.check(tab, row);
    this.writes.push({ tab, key: row[core.COLUMNS[tab][0]], mode: 'append' });
    this.tabs[tab].push(Object.assign({}, row));
  }
}

let counter = 0;

function makeRunner(wf, now, execId, sheet, outputs) {
  const RealDate = Date;
  const frozen = class extends RealDate {
    constructor(...a) { if (a.length) { super(...a); } else { super(now); } }
    static now() { return new RealDate(now).getTime(); }
  };
  return (name, input) => {
    const sandboxInput = { all: () => input.map((j) => ({ json: j })) };
    const dollar = (n) => {
      const items = outputs[n];
      if (!items) throw new Error('Node "' + n + '" has not run');
      return { all: () => items.map((j) => ({ json: j })), first: () => ({ json: items[0] }), item: { json: items[0] } };
    };
    const ctx = vm.createContext({ Date: frozen, Math, JSON, String, Number, Array, Object, RegExp, isFinite, parseInt, parseFloat });
    const fn = scriptOf(wf, name).runInContext(ctx, { timeout: 5000 });
    const out = fn(sandboxInput, dollar, { id: execId }, () => sheet.staticData).map((r) => r.json);
    outputs[name] = out;
    return out;
  };
}

/** HTTP Request node semantics: up to 3 tries, then the error item is passed on (continueRegularOutput). */
function callAi(opts, request, lead) {
  let out;
  for (let attempt = 1; attempt <= 3; attempt++) {
    out = opts.aiResponder(request, lead, attempt);
    if (!out || !out.error) return out;
  }
  return out;
}

const responseFor = (d) => {
  if (d.action === 'conflict') return { code: 409, body: { ok: false, error: 'identifier_conflict' } };
  if (d.reason === 'limite_por_contacto') return { code: 429, body: { ok: false, error: 'rate_limited' } };
  if (d.reason === 'ganador_pendiente') return { code: 503, body: { ok: false, error: 'in_progress', retry_after_seconds: 30 } };
  return { code: 200, body: { ok: true, duplicate: true } };
};

/**
 * One webhook execution as a generator. Yields the name of the I/O stage that is about to happen.
 * opts: now, execId, aiResponder(request, lead, attempt), fail(stage, attempt) -> true to fail that attempt,
 *       failTaskWrite (shortcut), rate: { rate_max_requests, rate_window_seconds }
 */
function* webhookExecution(sheet, payload, opts) {
  const now = opts.now;
  const execId = opts.execId || ('sim-' + (++counter));
  const outputs = {};
  const run = makeRunner(WORKFLOW, now, execId, sheet, outputs);
  const failFn = opts.fail || (opts.failTaskWrite ? (st) => st === 'task-write' : null);
  const result = { responded: null, steps: [], execId };

  // Google Sheets nodes retry up to 3 times (retryOnFail); each attempt is a scheduling point.
  function* io(stage, fn) {
    let lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      yield stage;
      try {
        if (failFn && failFn(stage, attempt)) throw new Error('simulated Google Sheets failure at ' + stage);
        return fn();
      } catch (e) { lastErr = e; }
    }
    throw lastErr;
  }

  try {
    const validated = run('Validar y normalizar', [Object.assign({ body: payload, headers: {} }, opts.rate || {})]);
    if (!validated[0].valid) {
      result.responded = { code: validated[0].http_status || 422, body: { ok: false, errors: validated[0].errors } };
      return result;
    }
    const lead = validated[0].lead;
    const history = yield* io('lookup', () => sheet.read('leads', { col: 'lead_id', val: lead.lead_id }));
    outputs['Buscar historial del lead'] = history.length ? history : [{}];
    const decided = run('Decidir duplicado', history.length ? history : [{}])[0];
    if (decided.action !== 'process') { result.responded = responseFor(decided); return result; }

    let resolved;
    if (opts.skipClaim) {
      // Negative control: the original design without claim arbitration (used to prove the race exists).
      resolved = { won: true, reason: 'sin_reclamacion', row: decided.row };
    } else {
      yield* io('claim-append', () => sheet.append('claims', decided.claim));
      const claims = yield* io('claims-read', () => sheet.read('claims', { col: 'submission_id', val: decided.lead.submission_id }));
      outputs['Leer reclamaciones'] = claims.length ? claims : [{}];
      resolved = run('Resolver reclamación', claims.length ? claims : [{}])[0];
    }
    result.claim = resolved.reason;
    if (!resolved.won) {
      const again = yield* io('winner-lookup', () => sheet.read('leads', { col: 'lead_id', val: lead.lead_id }));
      const verdict = run('Confirmar ganador', again.length ? again : [{}])[0];
      result.responded = responseFor(verdict);
      return result;
    }

    yield* io('received-write', () => sheet.upsert('leads', 'submission_id', resolved.row));
    result.responded = { code: 202, body: { ok: true, status: 'accepted', submission_id: resolved.row.submission_id } };

    const prepared = run('Preparar petición IA', [resolved.row]);
    yield 'ai';
    const httpOut = prepared.map((p) => callAi(opts, p.ai_request, p.lead));
    outputs['Analizar con IA'] = httpOut;
    const evaluated = run('Evaluar y puntuar', httpOut);
    result.evaluated = evaluated;
    for (const ev of evaluated) {
      if (ev.has_task) yield* io('task-write', () => sheet.upsert('seguimiento', 'task_id', ev.task_row));
      yield* io('lead-write', () => sheet.upsert('leads', 'submission_id', ev.lead_row));
      if (ev.has_error) yield* io('error-write', () => sheet.upsert('errores', 'error_id', ev.error_row));
    }
  } catch (e) {
    result.executionError = e.message; // the n8n execution fails here
    if (!result.responded) result.responded = { code: 500, body: { message: 'Error in workflow' } };
  }
  return result;
}

function drive(gen) {
  let r = gen.next();
  while (!r.done) r = gen.next();
  return r.value;
}

/** Runs several generators step by step following `order` (indices); the rest is round-robin. */
function interleave(gens, order) {
  const done = new Array(gens.length).fill(false);
  const results = new Array(gens.length);
  const step = (i) => {
    if (done[i]) return;
    const r = gens[i].next();
    if (r.done) { done[i] = true; results[i] = r.value; }
  };
  (order || []).forEach(step);
  let guard = 0;
  while (done.some((d) => !d) && guard++ < 10000) gens.forEach((g, i) => step(i));
  return results;
}

function sendWebhook(sheet, payload, opts) { return drive(webhookExecution(sheet, payload, opts)); }

/** Manual retry branch. */
function runRetry(sheet, opts) {
  const now = opts.now;
  const outputs = {};
  const run = makeRunner(WORKFLOW, now, opts.execId || ('sim-' + (++counter)), sheet, outputs);
  const rows = sheet.read('leads');
  const retry = run('Preparar reintentos', rows);
  const result = { retried: retry.length };
  if (!retry.length) return result;
  const prepared = run('Preparar petición IA', retry);
  const httpOut = prepared.map((p) => callAi(opts, p.ai_request, p.lead));
  outputs['Analizar con IA'] = httpOut;
  const evaluated = run('Evaluar y puntuar', httpOut);
  evaluated.forEach((ev) => {
    if (ev.has_task) sheet.upsert('seguimiento', 'task_id', ev.task_row);
    sheet.upsert('leads', 'submission_id', ev.lead_row);
    if (ev.has_error) sheet.upsert('errores', 'error_id', ev.error_row);
  });
  result.evaluated = evaluated;
  return result;
}

/** Runs the Code node of the optional error-handler workflow on an Error Trigger payload. */
function runErrorHandler(info, now) {
  const run = makeRunner(ERROR_WORKFLOW, now, 'sim-handler', new FakeSheet(), {});
  return run('Construir fila de error', [info])[0];
}

module.exports = { WORKFLOW, ERROR_WORKFLOW, FakeSheet, webhookExecution, drive, interleave, sendWebhook, runRetry, runErrorHandler };
