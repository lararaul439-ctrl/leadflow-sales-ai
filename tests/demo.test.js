'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/lead-core.js');

const leads = JSON.parse(fs.readFileSync(path.join(__dirname, '../demo/leads.json'), 'utf8'));
const NOW = '2026-10-26T09:00:00.000Z';

test('demo leads: only the last one is invalid and none reuses an e-mail', () => {
  const results = leads.map((l) => { const { _note, ...p } = l; return core.normalizeLead(p, { now: NOW }); });
  assert.equal(results.filter((r) => !r.valid).length, 1);
  assert.equal(results[results.length - 1].valid, false);
  const emails = results.filter((r) => r.valid).map((r) => r.lead.email);
  assert.equal(new Set(emails).size, emails.length);
});

test('demo leads: injection and disposable e-mail are flagged', () => {
  const byName = (n) => { const { _note, ...p } = leads.find((l) => l.full_name === n); return core.normalizeLead(p, { now: NOW }).lead; };
  assert.ok(byName('Test Injection').flags.includes('posible_inyeccion'));
  assert.ok(byName('Temp Sender').flags.includes('email_desechable'));
});

test('demo leads contain no real-looking secrets', () => {
  const text = JSON.stringify(leads);
  assert.ok(!/gsk_|sk-|Bearer |password/i.test(text));
});

// ------------------------------------------------------------------ offline demo (simulated model and Sheets, real Code nodes)
const demo = require('../scripts/demo-local.js');

test('demo:local - demo/expected-output.md is exactly what the script produces', () => {
  const committed = fs.readFileSync(path.join(__dirname, '../demo/expected-output.md'), 'utf8');
  assert.equal(committed, demo.markdown(demo.buildResult()) + '\n', 'run: npm run demo:local -- --write');
});

test('demo:local - the headline scenarios behave as documented', () => {
  const r = demo.buildResult();
  const by = (name) => r.round1.find((x) => x.lead === name);
  assert.deepEqual([by('Marta Sanz Ortega').priority, by('Marta Sanz Ortega').score], ['alta', 90]);
  assert.equal(by('Jorge Ibanez').priority, 'baja');
  assert.equal(by('Carlos Vega').status, 'sin_consentimiento');
  assert.equal(by('Carlos Vega').task, 'none');
  assert.equal(by('Test Injection').review, 'sí');
  assert.notEqual(by('Test Injection').priority, 'alta');
  assert.equal(by('Temp Sender').score, 10);
  assert.equal(by('No Email').http, 422);
  assert.deepEqual(r.round2.slice(0, 6).map((x) => x.http), [200, 200, 200, 200, 200, 200]);
  assert.deepEqual(r.counts.before, r.counts.after, 'a second round adds nothing');
});

test('demo:local - no broken or hostile model answer ever yields a confident, unreviewed high priority', () => {
  const r = demo.buildResult();
  assert.equal(r.badAi.length, 6);
  for (const c of r.badAi) {
    assert.ok(!(c.priority === 'alta' && c.review === 'no'), c.case);
    if (/^error_/.test(c.status)) assert.equal(c.task, 'none', c.case + ': an unusable answer creates no task');
    if (c.task === 'created') assert.equal(c.review, 'sí', c.case + ': a suspicious answer waits for a person');
  }
});
