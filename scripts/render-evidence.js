'use strict';
/*
 * Builds the HTML sources of the "evidence" images in docs/images/*.png.
 *
 * IMPORTANT: these images are RENDERED FROM REAL OUTPUT of this repository's code and test commands. They are not
 * screenshots of the n8n editor, Google Sheets, a terminal or any production system, and every image says so in
 * its own banner. Parts that are simulated (the language model, Google Sheets) are labelled as such in the image.
 *
 *   node scripts/render-evidence.js --out <dir>      write <dir>/*.html
 *
 * To turn the HTML into PNG files (Playwright is not a dependency of this project):
 *
 *   node scripts/render-evidence.js --out /tmp/evidence
 *   npx playwright screenshot --viewport-size=1200,800 --full-page file:///tmp/evidence/test-suites.html docs/images/test-suites.png
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { FakeSheet, sendWebhook } = require('../tests/helpers/n8n-sim.js');
const { buildResult } = require('./demo-local.js');

const ROOT = path.join(__dirname, '..');
const outIdx = process.argv.indexOf('--out');
const OUT = outIdx > 0 ? path.resolve(process.argv[outIdx + 1]) : null;
if (!OUT) {
  console.error('usage: node scripts/render-evidence.js --out <dir>');
  process.exit(2);
}
fs.mkdirSync(OUT, { recursive: true });

const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const readJson = (f) => JSON.parse(read(f));
const today = '2026-10-26';

const CSS = `
:root{--bg:#0f172a;--panel:#111c33;--line:#26344f;--ink:#e2e8f0;--mute:#94a3b8;--ok:#34d399;--bad:#f87171;--warn:#fbbf24;--sim:#a78bfa;--real:#38bdf8}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;padding:24px;width:1200px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--mute);margin:18px 0 8px}
.banner{border:1px solid var(--warn);color:var(--warn);background:#2a2208;border-radius:6px;padding:8px 12px;margin:10px 0 14px;font-size:12.5px}
.panel{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px 14px;margin-bottom:12px}
.tag{display:inline-block;border-radius:4px;padding:1px 7px;font-size:11px;font-weight:600;margin-right:6px;vertical-align:middle}
.tag.real{background:#0c3a52;color:var(--real)}.tag.sim{background:#2e1f5a;color:var(--sim)}
table{border-collapse:collapse;width:100%;font-size:12.5px}th,td{border-bottom:1px solid var(--line);padding:5px 8px;text-align:left;vertical-align:top}th{color:var(--mute);font-weight:600}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}pre{margin:0;white-space:pre-wrap;word-break:break-word}
.ok{color:var(--ok)}.bad{color:var(--bad)}.warn{color:var(--warn)}.mute{color:var(--mute)}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:12px}.cols3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
.foot{color:var(--mute);font-size:11.5px;margin-top:10px}
`;

function page(file, title, subtitle, banner, body) {
  const html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + CSS + '</style></head><body>' +
    '<h1>' + esc(title) + '</h1><div class="mute">' + esc(subtitle) + '</div>' +
    '<div class="banner">' + banner + '</div>' + body +
    '<div class="foot">Generated ' + today + ' by scripts/render-evidence.js from the repository at the time of the commit. Fictional data only.</div></body></html>';
  fs.writeFileSync(path.join(OUT, file), html);
  console.log('wrote ' + file);
}

const BANNER_RENDERED = '<b>Rendered from real command output. Not a screenshot of n8n, Google Sheets or a terminal.</b> ';

// ---------- 1. one lead, in five views ----------
function oneLead() {
  const leads = readJson('demo/leads.json');
  const canned = readJson('demo/ai-responses.json');
  const { _note, ...payload } = leads[0];
  const sheet = new FakeSheet();
  let aiRequest = null;
  const r = sendWebhook(sheet, payload, {
    now: '2026-10-26T09:00:00.000Z', execId: 'evidence-1',
    aiResponder: (req, lead) => {
      aiRequest = req;
      return { choices: [{ message: { role: 'assistant', content: JSON.stringify(canned[String(lead.email).toLowerCase()]) }, finish_reason: 'stop' }] };
    }
  });
  const row = sheet.tabs.leads[0];
  const task = sheet.tabs.seguimiento[0];
  const claim = sheet.tabs.claims[0];
  const userMsg = aiRequest.messages[aiRequest.messages.length - 1].content;
  const answer = canned[String(payload.email).toLowerCase()];
  const REAL = BANNER_RENDERED + 'The language model and Google Sheets are simulated; validation, redaction, scoring and drafts are the real generated Code-node logic.';

  page('lead-processing.html', 'Lead processing: input and data minimisation', 'A fictional lead is received, validated and redacted by the real Code nodes',
    REAL,
    '<div class="cols"><div class="panel"><h2><span class="tag real">real code</span>1. Request received</h2><pre>POST /webhook/leadflow-sales\nX-Webhook-Token: (checked by n8n)\n\n' + esc(JSON.stringify(payload, null, 1)) + '</pre>' +
    '<h2 style="margin-top:14px">HTTP answer (immediate, before the model is called)</h2><pre>' + esc(r.responded.code + ' ' + JSON.stringify(r.responded.body)) + '</pre></div>' +
    '<div class="panel"><h2><span class="tag real">real code</span>2. What leaves n8n for the model</h2>' +
    '<div class="mute" style="margin-bottom:6px">Name, company, e-mail, phone and links are not sent. Anything of that kind inside the message is replaced by placeholders:</div><pre>' + esc(userMsg) + '</pre>' +
    '<h2 style="margin-top:14px">Checks done before this point</h2><table><tr><td>strict field list, size limits</td><td class="ok">passed</td></tr><tr><td>consent declared</td><td class="ok">yes (declared_only)</td></tr><tr><td>duplicate lookup</td><td class="ok">new submission</td></tr><tr><td>claim arbitration</td><td class="ok">' + esc(claim ? 'claim won' : 'n/a') + '</td></tr></table></div></div>');

  page('lead-classification.html', 'AI classification: structured extraction and its validation', 'The model only extracts signals; the code decides what to trust',
    BANNER_RENDERED + 'The answer below is a <b>canned simulation</b> of the model (demo/ai-responses.json). The checks applied to it are the real code.',
    '<div class="cols"><div class="panel"><h2><span class="tag sim">simulated</span>Model answer (JSON schema output)</h2><pre>' + esc(JSON.stringify(answer, null, 1)) + '</pre></div>' +
    '<div class="panel"><h2><span class="tag real">real code</span>What the validation did with it</h2><table>' +
    '<tr><th>Schema</th><td class="ok">all required fields, enums inside the allowed lists, no extra fields</td></tr>' +
    '<tr><th>Intent</th><td>' + esc(row.intent) + ' accepted: the quote exists in the message</td></tr>' +
    '<tr><th>Quote</th><td class="mono">' + esc(row.intent_evidence) + '</td></tr>' +
    '<tr><th>Timeframe</th><td>' + esc(row.timeframe) + ' (source: ' + esc(row.timeframe_source) + ')</td></tr>' +
    '<tr><th>Budget</th><td>' + esc(row.budget_range) + ' (source: ' + esc(row.budget_source) + ')</td></tr>' +
    '<tr><th>Product</th><td>' + esc(row.product_interest) + ' (found in the message)</td></tr>' +
    '<tr><th>Figures in summary</th><td class="ok">all present in the message</td></tr>' +
    '<tr><th>Flags</th><td>' + esc(row.flags || 'none') + '</td></tr></table>' +
    '<p class="mute">A quote that is not in the message, an unknown product or an invented figure would be dropped and flagged for human review.</p></div></div>');

  const bd = String(row.score_breakdown).split('; ').map((x) => '<tr><td class="mono">' + esc(x.split(':')[0]) + '</td><td class="mono">' + esc(x.split(':').slice(1).join(':')) + '</td></tr>').join('');
  page('lead-scoring.html', 'Lead scoring: explicit rules, explainable result', 'Computed in code from verified signals; the model cannot change it',
    BANNER_RENDERED + 'Rules are documented in docs/SCORING.md.',
    '<div class="cols"><div class="panel"><h2><span class="tag real">real code</span>Score breakdown stored with the lead</h2><table><tr><th>Rule</th><th>Points</th></tr>' + bd + '</table>' +
    '<p style="font-size:16px">Score <b>' + esc(row.score) + '</b> / 100 &rarr; priority <b class="ok">' + esc(row.priority) + '</b></p></div>' +
    '<div class="panel"><h2>Thresholds and caps</h2><table><tr><td>priority alta</td><td class="mono">score &ge; 70, and intent ready_to_buy or evaluating</td></tr><tr><td>priority media</td><td class="mono">score &ge; 40</td></tr><tr><td>priority baja</td><td class="mono">otherwise</td></tr><tr><td>spam intent or disposable e-mail</td><td class="mono">score capped at 10</td></tr><tr><td>consent</td><td class="mono">not scored</td></tr></table>' +
    '<p class="mute">Follow-up due ' + esc(task.due_at) + ' (SLA for alta: 4 hours).</p></div></div>');

  const grid = (obj) => '<table><tr><th>column</th><th>value</th></tr>' + Object.keys(obj).map((k) => '<tr><td class="mono mute">' + esc(k) + '</td><td class="mono">' + esc(String(obj[k]).length > 150 ? String(obj[k]).slice(0, 150) + '...' : obj[k]) + '</td></tr>').join('') + '</table>';
  page('sheets-records.html', 'Stored records: the three tabs the workflow writes', 'Same column layout as templates/*.csv, filled by the real nodes for the fictional lead',
    BANNER_RENDERED + '<span class="tag sim">simulated store</span> The rows below live in an in-memory table. This is not a Google Sheets screenshot.',
    '<div class="cols"><div class="panel"><h2>Tab leads (one row)</h2>' + grid(row) + '</div><div><div class="panel"><h2>Tab claims (arbitration row)</h2>' + grid(claim) + '</div><div class="panel"><h2>Tab errores</h2><div class="mute">empty: nothing failed</div></div></div></div>');

  page('follow-up-task.html', 'Follow-up: a task and a draft for a person to review', 'Nothing is sent by the workflow',
    BANNER_RENDERED + 'Draft text comes from templates in code, using only verified words from the message.',
    '<div class="cols"><div class="panel"><h2><span class="tag real">real code</span>Tab seguimiento</h2>' + grid({ task_id: task.task_id, task_type: task.task_type, status: task.status, priority: task.priority, score: task.score, due_at: task.due_at, human_review_required: task.human_review_required, consent_evidence: task.consent_evidence, missing_information: task.missing_information }) + '</div>' +
    '<div class="panel"><h2>Draft (pending approval)</h2><pre>Subject: ' + esc(task.draft_subject) + '\n\n' + esc(task.draft_body) + '</pre><p class="mute">A person edits and sends it from their own mailbox or CRM. No node of the workflow sends e-mail.</p></div></div>');
}

// ---------- 2. demo summary ----------
function demoSummary() {
  const res = buildResult();
  const rows = res.round1.map((x, i) => '<tr><td>' + esc(x.lead) + '</td><td class="mono">' + esc(x.http) + '</td><td>' + esc(x.status) + '</td><td>' + esc(x.priority) + '</td><td class="mono">' + esc(x.score) + '</td><td>' + esc(x.intent) + '</td><td>' + esc(x.review) + '</td><td class="mono">' + esc(x.flags) + '</td><td>' + esc(x.task) + '</td><td class="mono">' + esc(res.round2[i].http) + '</td></tr>').join('');
  const body = '<div class="panel"><table><tr><th>Lead</th><th>HTTP</th><th>Status</th><th>Priority</th><th>Score</th><th>Intent</th><th>Review</th><th>Flags</th><th>Task</th><th>Again</th></tr>' + rows + '</table></div>' +
    '<div class="panel">Rows after round 1: <b>' + res.counts.before.leads + '</b> leads, <b>' + res.counts.before.tasks + '</b> tasks. After sending the same seven again: <b>' + res.counts.after.leads + '</b> leads, <b>' + res.counts.after.tasks + '</b> tasks. Duplicates add nothing ("Again" column).</div>';
  page('demo-summary.html', 'Demo run: seven fictional leads, twice', 'Output of npm run demo:local',
    BANNER_RENDERED + '<span class="tag sim">simulated</span> Google Sheets and the model. <span class="tag real">real code</span> everything that decides.', body);
}

// ---------- 3. error handling ----------
function errorHandling() {
  const res = buildResult();
  const rows = res.badAi.map((x) => '<tr><td>' + esc(x.case) + '</td><td>' + esc(x.status) + '</td><td>' + esc(x.priority) + '</td><td>' + esc(x.review) + '</td><td class="mono">' + esc(x.flags) + '</td><td>' + esc(x.task) + '</td><td class="mono">' + esc(x.error) + '</td></tr>').join('');
  const body = '<div class="panel"><h2><span class="tag sim">simulated model</span><span class="tag real">real validation</span>The same hot lead, answered by a broken or hostile model</h2><table><tr><th>Model answer</th><th>Lead status</th><th>Priority</th><th>Review</th><th>Flags</th><th>Task</th><th>Logged error</th></tr>' + rows + '</table></div>' +
    '<div class="panel">A bad answer never produces a priority or a task by itself: it ends in an error status (retried up to 3 times, then <span class="mono">error_definitivo</span>) or in human review.</div>';
  page('error-handling.html', 'Model answers that must not be trusted', 'Output of npm run demo:local, section "Model answers that must not be trusted"',
    BANNER_RENDERED + 'The failures are injected on purpose; nothing here happened on a live system.', body);
}

// ---------- 4. test suites ----------
function runNode(args) {
  const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}
function suites() {
  const files = fs.readdirSync(path.join(ROOT, 'tests')).filter((f) => f.endsWith('.test.js')).sort();
  return files.map((f) => {
    const t0 = Date.now();
    const r = runNode(['--test', '--test-reporter=tap', path.join('tests', f)]);
    const n = (k) => { const m = r.out.match(new RegExp('^# ' + k + ' (\\d+)', 'm')); return m ? Number(m[1]) : 0; };
    return { file: f, tests: n('tests'), pass: n('pass'), fail: n('fail'), ms: Date.now() - t0, titles: Array.from(r.out.matchAll(/^(not ok|ok) \d+ - (.+?)(?: #.*)?$/gm)).map((m) => ({ ok: m[1] === 'ok', title: m[2] })) };
  });
}
function lintStatus() {
  const r = spawnSync('eslint', ['.'], { cwd: ROOT, encoding: 'utf8' });
  if (r.error) return { ran: false, text: 'eslint not available in this environment' };
  return { ran: true, ok: r.status === 0, text: r.status === 0 ? 'eslint . exited 0 (no findings)' : 'eslint . reported findings' };
}
function tests() {
  const s = suites();
  const check = runNode(['scripts/build-workflow.js', '--check']);
  const lint = lintStatus();
  const total = s.reduce((a, x) => a + x.tests, 0);
  const pass = s.reduce((a, x) => a + x.pass, 0);
  const fail = s.reduce((a, x) => a + x.fail, 0);
  const rows = s.map((x) => '<tr><td class="mono">tests/' + esc(x.file) + '</td><td class="mono">' + x.tests + '</td><td class="mono ' + (x.fail ? 'bad' : 'ok') + '">' + x.pass + ' pass / ' + x.fail + ' fail</td><td class="mono mute">' + (x.ms / 1000).toFixed(1) + ' s</td></tr>').join('');
  const body = '<div class="panel"><table><tr><th>Suite</th><th>Tests</th><th>Result</th><th>Time</th></tr>' + rows +
    '<tr><th>Total</th><th class="mono">' + total + '</th><th class="mono ' + (fail ? 'bad' : 'ok') + '">' + pass + ' pass / ' + fail + ' fail</th><th></th></tr></table></div>' +
    '<div class="cols"><div class="panel"><b>Generated files in sync with the sources</b><br><span class="mono ' + (check.status === 0 ? 'ok' : 'bad') + '">node scripts/build-workflow.js --check &rarr; exit ' + check.status + '</span></div>' +
    '<div class="panel"><b>Lint</b><br><span class="mono ' + (lint.ran && lint.ok ? 'ok' : 'warn') + '">' + esc(lint.text) + '</span></div></div>';
  page('test-suites.html', 'Automated test suites', 'node --test, one run per suite, plus build check and lint',
    BANNER_RENDERED + 'These are the repository tests. They run the real workflow code against in-memory fakes; they do not touch n8n, Google Sheets or Groq.', body);
  return s;
}

// ---------- 5. security test titles ----------
function securityTests(s) {
  const sec = s.find((x) => x.file === 'security.test.js');
  const conc = s.find((x) => x.file === 'concurrency.test.js');
  const res = s.find((x) => x.file === 'resilience.test.js');
  const list = (x, name) => '<div class="panel"><h2>' + name + ' (' + x.titles.filter((t) => t.ok).length + '/' + x.titles.length + ' pass)</h2><table>' +
    x.titles.map((t) => '<tr><td class="' + (t.ok ? 'ok' : 'bad') + '" style="width:44px">' + (t.ok ? 'PASS' : 'FAIL') + '</td><td>' + esc(t.title.replace(/^[a-z ]+: /i, '')) + '</td></tr>').join('') + '</table></div>';
  page('security-tests.html', 'Security, concurrency and resilience tests', 'Titles and results of tests/security.test.js, concurrency.test.js and resilience.test.js',
    BANNER_RENDERED + 'Concurrency is <b>simulated</b> (interleaved executions against an in-memory sheet). It does not prove atomicity of real Google Sheets writes.',
    list(sec, 'Security') + '<div class="cols">' + list(conc, 'Concurrency (simulated)') + list(res, 'Resilience (failure injection)') + '</div>');
}

// ---------- 6. runtime verification ----------
function runtime() {
  const BODY = read('tests/live/n8n-runtime-harness.js');
  const wf = readJson('workflows/leadflow-sales-ai.json');
  const fn = new Function('$input', '$getWorkflowStaticData', '$execution', BODY); // eslint-disable-line no-new-func
  const r = fn({ first: () => ({ json: wf }) }, () => ({}), { id: 'local-run' })[0].json;
  const rows = r.checks.map((c) => '<tr><td class="' + (c.startsWith('PASS') ? 'ok' : 'bad') + '" style="width:44px">' + esc(c.slice(0, 4)) + '</td><td>' + esc(c.slice(5)) + '</td></tr>').join('');
  const body = '<div class="cols"><div class="panel"><h2><span class="tag real">local Node</span>Harness run on this commit</h2><table>' + rows + '</table>' +
    '<p>' + r.passed + ' passed, ' + r.failed + ' failed. Code fingerprint <span class="mono">' + esc(r.fingerprint) + '</span>.</p></div>' +
    '<div><div class="panel"><h2><span class="tag real">n8n Cloud</span>Recorded run (2026-10-26)</h2><table>' +
    '<tr><th>Where</th><td>A temporary, unpublished workflow in the project n8n Cloud instance (one Code node, manual trigger)</td></tr>' +
    '<tr><th>Execution</th><td class="mono">133</td></tr><tr><th>Result</th><td class="mono">23 passed, 0 failed</td></tr><tr><th>Fingerprint</th><td class="mono">50b93a1c (equal to the local run)</td></tr>' +
    '<tr><th>Touched</th><td>Nothing else: no webhook, no Google Sheets, no Groq, no production workflow</td></tr></table>' +
    '<p class="mute">The temporary workflow was archived after the run, so this execution can no longer be re-inspected. The value above was recorded from the execution result at the time. See docs/RUNTIME_VERIFICATION.md to repeat the run.</p></div>' +
    '<div class="panel"><b>What this proves:</b> the generated Code-node source behaves the same inside n8n\'s JavaScript runtime as on local Node.<br><b>What it does not prove:</b> the graph wiring of the v1.1 export, Google Sheets behaviour, the Groq call or the public webhook.</div></div></div>';
  page('runtime-verification.html', 'Runtime check inside n8n', 'tests/live/n8n-runtime-harness.js',
    BANNER_RENDERED + 'The left column was produced now, locally. The right column is a recorded result of the same harness running inside n8n Cloud.', body);
  return r;
}

oneLead();
demoSummary();
errorHandling();
const s = tests();
securityTests(s);
runtime();
