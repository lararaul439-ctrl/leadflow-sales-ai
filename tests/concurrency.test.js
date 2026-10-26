'use strict';
/*
 * Simulated concurrency. Executions are generators that yield before every Google Sheets or AI step, so the
 * tests can run two or three executions in every possible interleaving of their first steps.
 *
 * What this proves: the claim protocol (insert-then-verify) is logically correct if (1) appending a row is an
 * atomic insert and (2) a read after a successful write sees that write. What it does NOT prove: that Google
 * Sheets really behaves like that under load. See docs/CONCURRENCY.md for the verification status.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/lead-core.js');
const F = require('./fixtures/leads.js');
const { FakeSheet, webhookExecution, interleave, drive, sendWebhook, runRetry } = require('./helpers/n8n-sim.js');

const T0 = F.NOW;
const at = (sec) => new Date(Date.parse(T0) + sec * 1000).toISOString();
const okAi = () => F.aiResponse(F.HOT_AI);

function exec(sheet, payload, extra) {
  let aiCalls = 0;
  const opts = Object.assign({ now: T0, aiResponder: () => { aiCalls++; return okAi(); } }, extra || {});
  const gen = webhookExecution(sheet, payload, opts);
  return { gen, calls: () => aiCalls };
}

function schedulesOf(length) {
  const out = [];
  for (let n = 0; n < 2 ** length; n++) out.push(Array.from({ length }, (_, i) => (n >> i) & 1));
  return out;
}

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function consistent(sheet) {
  const ids = sheet.tabs.leads.map((l) => l.submission_id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate lead rows: ' + ids.join(','));
  const tasks = sheet.tabs.seguimiento.map((t) => t.task_id);
  assert.equal(new Set(tasks).size, tasks.length, 'duplicate task rows');
}

// ------------------------------------------------------------------ two identical requests, every interleaving
test('concurrency: two identical requests in EVERY interleaving of their first 10 steps produce one lead, one task, one AI call', () => {
  const schedules = schedulesOf(10);
  const seen = { inProgress: 0, duplicate: 0 };
  for (const order of schedules) {
    const sheet = new FakeSheet();
    const a = exec(sheet, F.HOT, { execId: 'A' });
    const b = exec(sheet, F.HOT, { execId: 'B' });
    const [ra, rb] = interleave([a.gen, b.gen], order);
    const codes = [ra.responded.code, rb.responded.code].sort();
    assert.equal(codes.filter((c) => c === 202).length, 1, 'exactly one request is accepted: ' + order.join('') + ' -> ' + codes);
    assert.ok(codes.every((c) => [200, 202, 503].includes(c)), 'unexpected codes ' + codes);
    if (codes.includes(503)) seen.inProgress++;
    if (codes.includes(200)) seen.duplicate++;
    assert.equal(a.calls() + b.calls(), 1, 'exactly one AI call: ' + order.join(''));
    assert.equal(ra.executionError || rb.executionError, undefined);
    consistent(sheet);
    assert.equal(sheet.tabs.leads.length, 1);
    assert.equal(sheet.tabs.leads[0].status, 'tarea_creada');
    assert.equal(sheet.tabs.seguimiento.length, 1);
    // a client that got "in progress" simply retries and is told it is a duplicate
    assert.equal(sendWebhook(sheet, F.HOT, { now: at(60), aiResponder: okAi }).responded.code, 200);
  }
  assert.equal(schedules.length, 1024);
  // both loser outcomes are really exercised, so the test is not passing trivially
  assert.ok(seen.inProgress > 0, 'some schedules make the loser answer "in progress"');
  assert.ok(seen.duplicate > 0, 'some schedules make the loser answer "duplicate"');
});

test('concurrency: negative control - WITHOUT the claim step the same interleavings do process the lead twice', () => {
  let doubled = 0;
  for (const order of schedulesOf(10)) {
    const sheet = new FakeSheet();
    const a = exec(sheet, F.HOT, { execId: 'A', skipClaim: true });
    const b = exec(sheet, F.HOT, { execId: 'B', skipClaim: true });
    const [ra, rb] = interleave([a.gen, b.gen], order);
    if ([ra.responded.code, rb.responded.code].filter((c) => c === 202).length === 2 && a.calls() + b.calls() === 2) doubled++;
  }
  assert.ok(doubled > 0, 'the race exists in the original design, so the protection is doing real work');
});

test('concurrency: three simultaneous identical requests (500 seeded random interleavings)', () => {
  const rnd = mulberry32(20261026);
  for (let i = 0; i < 500; i++) {
    const sheet = new FakeSheet();
    const execs = ['A', 'B', 'C'].map((id) => exec(sheet, F.HOT, { execId: id }));
    const order = Array.from({ length: 24 }, () => Math.floor(rnd() * 3));
    const results = interleave(execs.map((e) => e.gen), order);
    assert.equal(results.filter((r) => r.responded.code === 202).length, 1, 'order ' + order.join(''));
    assert.equal(execs.reduce((n, e) => n + e.calls(), 0), 1);
    consistent(sheet);
    assert.equal(sheet.tabs.leads.length, 1);
  }
});

test('concurrency: simultaneous DIFFERENT leads do not block each other', () => {
  const rnd = mulberry32(7);
  for (let i = 0; i < 100; i++) {
    const sheet = new FakeSheet();
    const execs = [0, 1, 2].map((k) => exec(sheet, Object.assign({}, F.HOT, { email: 'user' + k + '@empresa-demo.example' }), { execId: 'X' + k }));
    const order = Array.from({ length: 24 }, () => Math.floor(rnd() * 3));
    const results = interleave(execs.map((e) => e.gen), order);
    assert.deepEqual(results.map((r) => r.responded.code), [202, 202, 202]);
    assert.equal(sheet.tabs.leads.length, 3);
    consistent(sheet);
  }
});

test('concurrency: the same person sending two DIFFERENT messages at once keeps both', () => {
  const sheet = new FakeSheet();
  const a = exec(sheet, F.HOT, { execId: 'A' });
  const b = exec(sheet, Object.assign({}, F.HOT, { message: F.HOT.message + ' Y además queremos formación.' }), { execId: 'B' });
  const results = interleave([a.gen, b.gen], [0, 1, 0, 1, 0, 1, 0, 1]);
  assert.deepEqual(results.map((r) => r.responded.code), [202, 202]);
  assert.equal(sheet.tabs.leads.length, 2);
  consistent(sheet);
});

test('concurrency: two simultaneous resends of a stuck "recibido" lead are recovered exactly once', () => {
  for (const order of schedulesOf(8)) {
    const sheet = new FakeSheet();
    sendWebhook(sheet, F.HOT, { now: T0, aiResponder: okAi, failTaskWrite: true });
    assert.equal(sheet.tabs.leads[0].status, 'recibido');
    const a = exec(sheet, F.HOT, { execId: 'A', now: at(1800) });
    const b = exec(sheet, F.HOT, { execId: 'B', now: at(1800) });
    const [ra, rb] = interleave([a.gen, b.gen], order);
    assert.equal([ra, rb].filter((r) => r.responded.code === 202).length, 1, order.join(''));
    assert.equal(a.calls() + b.calls(), 1);
    assert.equal(sheet.tabs.leads.length, 1);
    assert.equal(sheet.tabs.leads[0].status, 'tarea_creada');
    assert.equal(sheet.tabs.seguimiento.length, 1);
  }
});

// ------------------------------------------------------------------ a crashed winner must not lose the lead
test('concurrency: if the winner dies after claiming, the caller gets 503 (not a false success) and a later retry succeeds', () => {
  const sheet = new FakeSheet();
  const dead = sendWebhook(sheet, F.HOT, { now: T0, aiResponder: okAi, fail: (stage) => stage === 'claims-read', execId: 'dead' });
  assert.equal(dead.responded.code, 500, 'the caller sees an error and knows to retry');
  assert.equal(sheet.tabs.claims.length, 1);
  assert.equal(sheet.tabs.leads.length, 0);
  const soon = sendWebhook(sheet, F.HOT, { now: at(5), aiResponder: okAi, execId: 'soon' });
  assert.equal(soon.responded.code, 503, 'not "duplicate": the lead is not stored yet');
  assert.deepEqual(soon.responded.body, { ok: false, error: 'in_progress', retry_after_seconds: 30 });
  assert.equal(sheet.tabs.leads.length, 0);
  const later = sendWebhook(sheet, F.HOT, { now: at(45), aiResponder: okAi, execId: 'later' });
  assert.equal(later.responded.code, 202, 'the orphan claim expired');
  assert.equal(sheet.tabs.leads.length, 1);
  assert.equal(sheet.tabs.leads[0].status, 'tarea_creada');
  consistent(sheet);
});

test('concurrency: a winner that stored the lead makes the loser answer "duplicate" (200)', () => {
  const sheet = new FakeSheet();
  const a = exec(sheet, F.HOT, { execId: 'A' });
  const b = exec(sheet, F.HOT, { execId: 'B' });
  // Each next() performs the previous stage's I/O. A: lookup, claim, read claims (wins). B: lookup, claim,
  // read claims (loses) - both looked up before anything was stored. Then A stores the lead, then B verifies.
  const [ra, rb] = interleave([a.gen, b.gen], [0, 0, 0, 0, 1, 1, 1, 1, 0, 1, 1]);
  assert.equal(ra.responded.code, 202);
  assert.equal(rb.responded.code, 200);
  assert.deepEqual(rb.responded.body, { ok: true, duplicate: true });
  assert.equal(b.calls(), 0, 'the loser never calls the AI');
});

// ------------------------------------------------------------------ the protocol itself
test('claims: key, arbitration order, window and visibility rules', () => {
  const lead = core.normalizeLead(F.HOT, { now: T0 }).lead;
  const a = core.buildClaim(lead, 'A', T0);
  const b = core.buildClaim(lead, 'B', at(1));
  assert.deepEqual(Object.keys(a), core.COLUMNS.claims);
  assert.equal(a.claim_key, lead.submission_id + '#0');
  assert.notEqual(a.claim_id, b.claim_id);
  assert.equal(core.buildClaim(lead, 'A', T0).claim_id, a.claim_id, 'deterministic for the same execution and time');
  // the first row in sheet order wins, whatever the timestamps say
  assert.deepEqual(core.resolveClaim([a, b], a), { won: true, error: false, reason: 'ganada' });
  assert.deepEqual(core.resolveClaim([a, b], b), { won: false, error: false, reason: 'reclamacion_perdida' });
  assert.deepEqual(core.resolveClaim([b, a], b).won, true);
  // a claim that is not visible must fail loudly instead of guessing
  assert.deepEqual(core.resolveClaim([a], b), { won: false, error: true, reason: 'reclamacion_no_visible' });
  assert.equal(core.resolveClaim([], a).error, true);
  assert.equal(core.resolveClaim(undefined, a).error, true);
  // other attempts, other submissions and old claims are ignored
  const other = Object.assign({}, core.buildClaim(Object.assign({}, lead, { submission_id: 'L-zzz-1' }), 'Z', T0));
  const retryLead = Object.assign({}, lead, { retry_count: 1 });
  const retryClaim = core.buildClaim(retryLead, 'R', T0);
  assert.notEqual(retryClaim.claim_key, a.claim_key);
  assert.equal(core.resolveClaim([other, retryClaim, a], a).won, true);
  const old = core.buildClaim(lead, 'OLD', at(-120));
  assert.equal(core.resolveClaim([old, a], a).won, true, 'a claim older than the window cannot block a later attempt');
  const garbage = Object.assign({}, a, { claimed_at: 'not a date', claim_id: 'C-garbage' });
  assert.equal(core.resolveClaim([garbage, a], a).won, true);
});

test('claims: the retry counter changes the key, so a deliberate recovery is a new attempt', () => {
  const lead = core.normalizeLead(F.HOT, { now: T0 }).lead;
  const stale = Object.assign({}, core.receivedRow(lead, T0), { status: 'recibido' });
  const d = core.decideDuplicate(lead, [stale], { now: at(1800) });
  assert.equal(d.action, 'process');
  assert.equal(d.reason, 'recibido_caducado');
  assert.equal(core.claimKey(d.lead), lead.submission_id + '#1');
});

test('claims: a retry run and a webhook never process the same fresh lead twice', () => {
  const sheet = new FakeSheet();
  const a = exec(sheet, F.HOT, { execId: 'A', failTaskWrite: true });
  drive(a.gen);
  assert.equal(runRetry(sheet, { now: at(60), aiResponder: okAi }).retried, 0, 'a fresh recibido row is left to its owner');
  assert.equal(runRetry(sheet, { now: at(1200), aiResponder: okAi }).retried, 1);
  assert.equal(sheet.tabs.seguimiento.length, 1);
});
