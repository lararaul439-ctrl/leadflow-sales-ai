'use strict';
/*
 * Runs tests/live/n8n-runtime-harness.js locally on Node. The same file is meant to be pasted into an n8n Code
 * node (see docs/RUNTIME_VERIFICATION.md), so this test also guards that the harness itself stays correct.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BODY = fs.readFileSync(path.join(__dirname, 'live/n8n-runtime-harness.js'), 'utf8');
const WF = JSON.parse(fs.readFileSync(path.join(__dirname, '../workflows/leadflow-sales-ai.json'), 'utf8'));

function runHarness(workflow) {
  const fn = new Function('$input', '$getWorkflowStaticData', '$execution', BODY);
  const out = fn({ first: () => ({ json: workflow }) }, () => ({}), { id: 'local-run' });
  return out[0].json;
}

test('runtime harness: every check passes on the committed export (local Node)', () => {
  const r = runHarness(WF);
  assert.deepEqual(r.failures, []);
  assert.equal(r.failed, 0);
  assert.ok(r.total >= 20, 'the harness covers the main scenarios: ' + r.total);
  assert.ok(r.checks.every((c) => c.startsWith('PASS ')));
  assert.match(r.fingerprint, /^[0-9a-f]{8}$/);
  assert.ok(Object.keys(r.codeHashes).length >= 6);
});

test('runtime harness: the fingerprint is deterministic and changes when the code under test changes', () => {
  const a = runHarness(WF);
  const b = runHarness(WF);
  assert.equal(a.fingerprint, b.fingerprint);
  assert.deepEqual(a.codeHashes, b.codeHashes);
  // Mutation: weaken the scoring inside the exported Evaluate node; the harness must notice.
  const mutated = JSON.parse(JSON.stringify(WF));
  const node = mutated.nodes.find((n) => n.name === 'Evaluar y puntuar');
  assert.ok(/ready_to_buy: 30/.test(node.parameters.jsCode), 'sanity: the scoring table is in the exported code');
  node.parameters.jsCode = node.parameters.jsCode.replace('ready_to_buy: 30', 'ready_to_buy: 99');
  const m = runHarness(mutated);
  assert.ok(m.failed > 0 || m.fingerprint !== a.fingerprint, 'a changed scoring table must be detected');
  assert.notEqual(m.codeHashes['Evaluar y puntuar'], a.codeHashes['Evaluar y puntuar']);
});

test('runtime harness: the body is safe to embed (no backticks, no template placeholders, no external access)', () => {
  assert.ok(!BODY.includes('`'));
  assert.ok(!BODY.includes('${'));
  assert.ok(!/\brequire\s*\(|\bimport\s|\bfetch\s*\(|XMLHttpRequest|child_process/.test(BODY.replace(/^\s*\/\/.*$/gm, '')));
});
