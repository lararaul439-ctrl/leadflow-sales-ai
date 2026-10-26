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
