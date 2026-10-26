'use strict';
/*
 * Minimal n8n simulator for the Code nodes of workflows/leadflow-sales-ai.json.
 * It runs the REAL jsCode of each node inside a vm sandbox that provides $input and $().
 * Sheets reads/upserts and the AI call are simulated in memory (this is NOT n8n and NOT Google).
 * IF / Switch / Respond expressions are not interpreted here.
 */
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs');
const core = require('../../src/lead-core.js');

const WORKFLOW = JSON.parse(fs.readFileSync(path.join(__dirname, '../../workflows/leadflow-sales-ai.json'), 'utf8'));

function codeOf(name) {
  const n = WORKFLOW.nodes.find((x) => x.name === name);
  if (!n) throw new Error('No node ' + name);
  return n.parameters.jsCode;
}

function runCode(name, inputItems, outputs) {
  const code = codeOf(name);
  const sandbox = {
    $input: { all: () => inputItems.map((j) => ({ json: j })) },
    $: (nodeName) => {
      const items = outputs[nodeName];
      if (!items) throw new Error('Node "' + nodeName + '" has not run');
      return { all: () => items.map((j) => ({ json: j })), first: () => ({ json: items[0] }) };
    },
    console: { log() {} }
  };
  sandbox.$ = sandbox.$;
  const wrapper = '(function($input, $){' + code + '\n})';
  const fn = vm.runInNewContext(wrapper, { Date, Math, JSON, String, Number, Array, Object, RegExp, isFinite, parseInt, parseFloat }, { timeout: 2000 });
  const res = fn(sandbox.$input, sandbox.$);
  return res.map((r) => r.json);
}

/** In-memory Google Sheet with the three tabs; upsert matches on a key column like the real node. */
class FakeSheet {
  constructor() { this.tabs = { leads: [], seguimiento: [], errores: [] }; this.writes = []; }
  read(tab, filter) {
    return this.tabs[tab].filter((r) => !filter || String(r[filter.col]) === String(filter.val)).map((r) => JSON.parse(JSON.stringify(r)));
  }
  upsert(tab, key, row) {
    const missing = core.COLUMNS[tab].filter((c) => !(c in row));
    if (missing.length) throw new Error('Row for ' + tab + ' misses columns: ' + missing.join(','));
    const idx = this.tabs[tab].findIndex((r) => String(r[key]) === String(row[key]));
    this.writes.push({ tab, key: row[key], mode: idx >= 0 ? 'update' : 'append' });
    if (idx >= 0) this.tabs[tab][idx] = Object.assign({}, row); else this.tabs[tab].push(Object.assign({}, row));
  }
}

/**
 * Runs the same path as the webhook branch.
 * opts: now, aiResponder(request) -> http-node-like output, failTaskWrite
 */
function sendWebhook(sheet, payload, opts) {
  const now = opts.now;
  const RealDate = Date;
  const outputs = {};
  const result = { responded: null, steps: [] };
  // Freeze time for the Code nodes: they call new Date().toISOString()
  const frozen = class extends RealDate {
    constructor(...a) { if (a.length) { super(...a); } else { super(now); } }
    static now() { return new RealDate(now).getTime(); }
  };
  const run = (name, input) => {
    const code = codeOf(name);
    const sandbox = {
      $input: { all: () => input.map((j) => ({ json: j })) },
      $: (n) => {
        const items = outputs[n];
        if (!items) throw new Error('Node "' + n + '" has not run');
        return { all: () => items.map((j) => ({ json: j })), first: () => ({ json: items[0] }), item: { json: items[0] } };
      }
    };
    const fn = vm.runInNewContext('(function($input, $){' + code + '\n})', { Date: frozen, Math, JSON, String, Number, Array, Object, RegExp, isFinite, parseInt, parseFloat }, { timeout: 2000 });
    const out = fn(sandbox.$input, sandbox.$).map((r) => r.json);
    outputs[name] = out;
    result.steps.push(name);
    return out;
  };

  const validated = run('Validar y normalizar', [{ body: payload, headers: {} }]);
  if (!validated[0].valid) { result.responded = { code: 422, body: { ok: false, errors: validated[0].errors } }; return result; }
  const lead = validated[0].lead;
  const history = sheet.read('leads', { col: 'lead_id', val: lead.lead_id });
  outputs['Buscar historial del lead'] = history.length ? history : [{}];
  const decided = run('Decidir duplicado', history.length ? history : [{}]);
  if (decided[0].action !== 'process') {
    result.responded = decided[0].action === 'conflict' ? { code: 409, body: { ok: false } } : { code: 200, body: { ok: true, duplicate: true } };
    return result;
  }
  sheet.upsert('leads', 'submission_id', decided[0].row);
  result.responded = { code: 202, body: { ok: true, status: 'accepted', submission_id: decided[0].row.submission_id } };
  try {
    runAiAndSave(sheet, decided[0].row, outputs, run, opts, result);
  } catch (e) {
    result.executionError = e.message; // the n8n execution would fail here; the response was already sent
  }
  return result;
}

function runAiAndSave(sheet, registeredRow, outputs, run, opts, result) {
  const prepared = run('Preparar petición IA', [registeredRow]);
  const httpOut = prepared.map((p) => opts.aiResponder(p.ai_request, p.lead));
  outputs['Analizar con IA'] = httpOut;
  const evaluated = run('Evaluar y puntuar', httpOut);
  evaluated.forEach((ev) => {
    if (ev.has_task) {
      if (opts.failTaskWrite) { throw new Error('simulated Sheets failure while saving the task'); }
      sheet.upsert('seguimiento', 'task_id', ev.task_row);
    }
    sheet.upsert('leads', 'submission_id', ev.lead_row);
    if (ev.has_error) sheet.upsert('errores', 'error_id', ev.error_row);
  });
  result.evaluated = evaluated;
}

/** Manual retry branch. */
function runRetry(sheet, opts) {
  const now = opts.now;
  const RealDate = Date;
  const outputs = {};
  const frozen = class extends RealDate {
    constructor(...a) { if (a.length) { super(...a); } else { super(now); } }
    static now() { return new RealDate(now).getTime(); }
  };
  const run = (name, input) => {
    const code = codeOf(name);
    const sandbox = {
      $input: { all: () => input.map((j) => ({ json: j })) },
      $: (n) => {
        const items = outputs[n];
        if (!items) throw new Error('Node "' + n + '" has not run');
        return { all: () => items.map((j) => ({ json: j })), first: () => ({ json: items[0] }) };
      }
    };
    const fn = vm.runInNewContext('(function($input, $){' + code + '\n})', { Date: frozen, Math, JSON, String, Number, Array, Object, RegExp, isFinite, parseInt, parseFloat }, { timeout: 2000 });
    const out = fn(sandbox.$input, sandbox.$).map((r) => r.json);
    outputs[name] = out;
    return out;
  };
  const rows = sheet.read('leads');
  const retry = run('Preparar reintentos', rows);
  const result = { retried: retry.length };
  if (!retry.length) return result;
  const prepared = run('Preparar petición IA', retry);
  const httpOut = prepared.map((p) => opts.aiResponder(p.ai_request, p.lead));
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

module.exports = { WORKFLOW, FakeSheet, sendWebhook, runRetry, runCode };
