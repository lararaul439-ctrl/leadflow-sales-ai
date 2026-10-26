'use strict';
/*
 * Repository hygiene. These are static checks over the working tree: secrets, real-looking personal data, CI
 * permissions, package scripts, documentation links. They are a safety net, not a replacement for GitHub secret
 * scanning, push protection or a human review.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const core = require('../src/lead-core.js');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', 'coverage']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|zip|gz)$/i;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out); else out.push(full);
  }
  return out;
}
const FILES = walk(ROOT, []);
const rel = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const TEXT_FILES = FILES.filter((f) => !BINARY.test(f));
const read = (f) => fs.readFileSync(f, 'utf8');
const exists = (r) => fs.existsSync(path.join(ROOT, r));

// ------------------------------------------------------------------ secrets
const SECRET_PATTERNS = [
  ['Groq key', /\bgsk_[A-Za-z0-9]{20,}/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{30,}/g],
  ['GitHub token', /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/g],
  ['GitHub fine-grained token', /\bgithub_pat_[A-Za-z0-9_]{40,}/g],
  ['AWS access key id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['Slack token', /\bxox[abprs]-[0-9A-Za-z-]{10,}/g],
  ['OpenAI-style key', /\bsk-[A-Za-z0-9]{32,}/g],
  ['private key block', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g],
  ['JSON web token (n8n API keys have this shape)', /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}/g],
  ['bearer credential', /\bBearer\s+[A-Za-z0-9._~+/-]{24,}=*/g]
];
// Obviously fake values used as test input must say so.
const looksFake = (s) => /FAKE|EXAMPLE|PLACEHOLDER|REPLACE|xxxx/i.test(s);

test('hygiene: no credential-shaped strings anywhere in the repository (fake test values must say FAKE)', () => {
  const hits = [];
  for (const f of TEXT_FILES) {
    const text = read(f);
    for (const [label, re] of SECRET_PATTERNS) {
      for (const m of text.matchAll(re)) if (!looksFake(m[0])) hits.push(rel(f) + ': ' + label);
    }
  }
  assert.deepEqual(hits, []);
});

test('hygiene: no Google spreadsheet id or webhook URL with a real host is committed', () => {
  const hits = [];
  for (const f of TEXT_FILES) {
    const text = read(f).replace(/\b[0-9a-f]{40,64}\b/g, ''); // hashes are not ids
    if (/\b1[A-Za-z0-9_-]{43}\b/.test(text)) hits.push(rel(f) + ': spreadsheet-id-like string');
    for (const m of text.matchAll(/https:\/\/([a-z0-9-]+)\.app\.n8n\.cloud/gi)) if (!/^(your|my|example|instance|tu)/i.test(m[1])) hits.push(rel(f) + ': n8n cloud host ' + m[1]);
  }
  assert.deepEqual(hits, []);
});

// ------------------------------------------------------------------ personal data
test('hygiene: every e-mail address in the repository is synthetic (reserved domain) or a mail provider the classifier must know', () => {
  const providers = new Set([].concat(core.CONFIG.freeEmailDomains, core.CONFIG.disposableEmailDomains));
  const reserved = /(?:\.example|\.test|\.invalid|\.localhost|(?:^|\.)example\.(?:com|org|net))$/i;
  const bad = [];
  for (const f of TEXT_FILES) {
    for (const m of read(f).matchAll(/[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,})/g)) {
      const domain = m[1].toLowerCase();
      if (reserved.test(domain) || providers.has(domain) || domain === 'users.noreply.github.com') continue;
      bad.push(rel(f) + ': ' + m[0]);
    }
  }
  assert.deepEqual(bad, []);
});

test('hygiene: demo and fixture data only uses fictional domains for companies and people', () => {
  const demo = JSON.parse(read(path.join(ROOT, 'demo/leads.json')));
  const leads = Array.isArray(demo) ? demo : (demo.leads || []);
  assert.ok(leads.length >= 5);
  const providers = new Set([].concat(core.CONFIG.freeEmailDomains, core.CONFIG.disposableEmailDomains));
  let checked = 0;
  for (const l of leads) {
    const email = String((l.payload || l).email || '');
    if (!email) continue; // some demo cases are deliberately invalid
    checked++;
    const domain = email.split('@')[1] || '';
    assert.ok(/\.example$/i.test(domain) || providers.has(domain.toLowerCase()), 'demo e-mail domain ' + domain);
  }
  assert.ok(checked >= 4);
});

// ------------------------------------------------------------------ environment files
test('hygiene: .env files are ignored, .env.example holds no values', () => {
  const ignore = read(path.join(ROOT, '.gitignore')).split('\n').map((l) => l.trim());
  assert.ok(ignore.includes('.env'));
  assert.ok(ignore.includes('.env.*'));
  assert.ok(ignore.includes('!.env.example'));
  for (const line of read(path.join(ROOT, '.env.example')).split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const [, value] = line.split(/=(.*)/s);
    assert.equal((value || '').trim(), '', 'value in .env.example: ' + line.split('=')[0]);
  }
  assert.ok(!FILES.some((f) => /(^|\/)\.env(\.(?!example$).+)?$/.test(rel(f))), 'a real .env file is present in the tree');
});

// ------------------------------------------------------------------ CI and supply chain
const CI_FILES = FILES.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(rel(f)));

test('hygiene: CI workflows use least privilege, pinned actions and no secrets', () => {
  assert.ok(CI_FILES.length >= 2, 'ci.yml and codeql.yml exist');
  for (const f of CI_FILES) {
    const text = read(f);
    const name = rel(f);
    assert.match(text, /^permissions:\s*\n\s+contents:\s*read\s*$/m, name + ': top-level permissions are read-only');
    assert.ok(!/pull_request_target/.test(text), name + ': pull_request_target runs untrusted code with secrets');
    assert.ok(!/\$\{\{\s*secrets\./.test(text), name + ': no secrets are needed');
    assert.ok(!/(curl|wget)[^\n]*\|\s*(sudo\s+)?(ba)?sh/.test(text), name + ': no pipe-to-shell');
    assert.ok(!/continue-on-error:\s*true/.test(text), name + ': failures must fail the build (no fake-green CI)');
    assert.ok(!/\|\|\s*true\b/.test(text), name + ': no "|| true" masking');
    for (const m of text.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)) {
      assert.match(m[1], /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, name + ': action not pinned to a commit SHA: ' + m[1]);
    }
    const checkouts = (text.match(/actions\/checkout@/g) || []).length;
    const noCreds = (text.match(/persist-credentials:\s*false/g) || []).length;
    assert.equal(noCreds, checkouts, name + ': every checkout drops the token');
    const jobs = (text.match(/^ {4}runs-on:/gm) || []).length;
    assert.ok(jobs >= 1);
    assert.equal((text.match(/^ {4}timeout-minutes:/gm) || []).length, jobs, name + ': every job has a timeout');
  }
  const ci = read(path.join(ROOT, '.github/workflows/ci.yml'));
  for (const step of ['npm run check', 'npm test', 'eslint', 'npm audit']) assert.ok(ci.includes(step), 'ci runs ' + step);
});

test('hygiene: Dependabot watches the GitHub Actions used by CI', () => {
  assert.match(read(path.join(ROOT, '.github/dependabot.yml')), /package-ecosystem:\s*github-actions/);
});

test('hygiene: package.json has no runtime dependencies and no install-time scripts', () => {
  const pkg = JSON.parse(read(path.join(ROOT, 'package.json')));
  assert.equal(pkg.private, true);
  assert.ok(!pkg.dependencies && !pkg.optionalDependencies, 'zero runtime dependencies');
  for (const hook of ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']) assert.ok(!(pkg.scripts || {})[hook], hook + ' script runs code on install');
  for (const name of ['build', 'check', 'lint', 'test']) assert.ok(pkg.scripts[name], 'script ' + name);
  assert.equal(pkg.version, core.CONFIG.version, 'package.json and CONFIG.version agree');
  const lock = JSON.parse(read(path.join(ROOT, 'package-lock.json')));
  assert.equal(lock.version, pkg.version);
});

test('hygiene: the generated workflows declare the same version as the code', () => {
  for (const f of ['workflows/leadflow-sales-ai.json', 'workflows/leadflow-sales-ai-error-handler.json']) {
    assert.ok(read(path.join(ROOT, f)).includes('v' + core.CONFIG.version + ' - generated'), f);
  }
});

// ------------------------------------------------------------------ project conventions
test('hygiene: public text carries no tool attribution banners and no course references', () => {
  const banned = [['gener' + 'ated with', 'tool attribution banner'], ['co-authored' + '-by', 'co-author trailer'], ['claude-' + 'session', 'session link'], ['ud' + 'ia', 'course reference']];
  const hits = [];
  for (const f of TEXT_FILES) {
    if (rel(f) === 'tests/hygiene.test.js' || /^workflows\//.test(rel(f))) continue;
    const text = read(f).toLowerCase();
    for (const [needle, label] of banned) if (new RegExp('\\b' + needle.replace(/[-]/g, '\\-') + '\\b').test(text)) hits.push(rel(f) + ': ' + label);
  }
  assert.deepEqual(hits, []);
});

test('hygiene: no large or unoptimised binaries', () => {
  for (const f of FILES) {
    const size = fs.statSync(f).size;
    if (BINARY.test(f)) assert.ok(size <= 600 * 1024, rel(f) + ' is ' + Math.round(size / 1024) + ' KB (limit 600 KB)');
    else assert.ok(size <= 1.5 * 1024 * 1024, rel(f) + ' is unexpectedly large');
  }
});

// ------------------------------------------------------------------ documentation
const REQUIRED_DOCS = [
  'README.md', 'README.es.md', 'SECURITY.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'LICENSE',
  'docs/SETUP.md', 'docs/PRIVACY.md', 'docs/SCORING.md', 'docs/KNOWN_LIMITATIONS.md', 'docs/TEST_REPORT.md',
  'docs/architecture.md', 'docs/data-schema.md', 'docs/CONCURRENCY.md', 'docs/THREAT_MODEL.md', 'docs/SECURITY_REVIEW.md',
  'demo/README.md', 'proxy/README.md', '.env.example'
];

test('hygiene: the documentation set is complete', () => {
  assert.deepEqual(REQUIRED_DOCS.filter((d) => !exists(d)), []);
});

test('hygiene: every relative link and image in the Markdown files resolves', () => {
  const broken = [];
  for (const f of TEXT_FILES.filter((x) => x.endsWith('.md'))) {
    const text = read(f).replace(/```[\s\S]*?```/g, '');
    for (const m of text.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
      const target = m[1];
      if (/^(https?:|mailto:|#)/i.test(target)) continue;
      const clean = decodeURIComponent(target.split('#')[0]);
      if (!clean) continue;
      if (!fs.existsSync(path.resolve(path.dirname(f), clean))) broken.push(rel(f) + ' -> ' + target);
    }
  }
  assert.deepEqual(broken, []);
});

test('hygiene: the changelog has an entry for the current version and the READMEs make no unsupported claims', () => {
  const log = read(path.join(ROOT, 'CHANGELOG.md'));
  assert.match(log, new RegExp('^## \\[' + core.CONFIG.version.replace(/\./g, '\\.') + '\\]', 'm'));
  for (const f of ['README.md', 'README.es.md']) {
    const text = read(path.join(ROOT, f));
    assert.ok(!/\b(100%|bulletproof|unhackable|GDPR[- ]compliant|RGPD[- ]compliant|military[- ]grade|cumple (con )?el RGPD)\b/i.test(text), f + ' makes an unsupported claim');
  }
});

// ------------------------------------------------------------------ generated pictures and their documentation
test('hygiene: the workflow graph diagram is generated from the committed export and is not stale', () => {
  const { build } = require('../scripts/workflow-to-mermaid.js');
  const wf = JSON.parse(read(path.join(ROOT, 'workflows/leadflow-sales-ai.json')));
  assert.equal(read(path.join(ROOT, 'docs/diagrams/workflow-overview.mmd')), build(wf), 'run: node scripts/workflow-to-mermaid.js and npm run docs:diagrams');
});

test('hygiene: every diagram source has a rendered SVG and PNG, and every image is explained in docs/images/README.md', () => {
  const sources = fs.readdirSync(path.join(ROOT, 'docs/diagrams')).filter((f) => f.endsWith('.mmd')).map((f) => f.replace(/\.mmd$/, ''));
  assert.ok(sources.length >= 4);
  const missing = [];
  sources.forEach((n) => ['svg', 'png'].forEach((e) => { if (!exists('docs/images/' + n + '.' + e)) missing.push(n + '.' + e); }));
  assert.deepEqual(missing, []);
  const guide = read(path.join(ROOT, 'docs/images/README.md'));
  const undocumented = fs.readdirSync(path.join(ROOT, 'docs/images')).filter((f) => /\.(png|svg)$/.test(f)).filter((f) => !guide.includes(f.replace(/\.(png|svg)$/, '')));
  assert.deepEqual(undocumented, []);
});

test('hygiene: the docs never present a rendering as a screenshot of a real interface', () => {
  const text = ['README.md', 'README.es.md', 'demo/README.md', 'docs/images/README.md'].map((f) => read(path.join(ROOT, f))).join('\n');
  assert.match(text, /not a screenshot|No es una captura|None of these images is a screenshot|no se incluye ninguna captura/i);
  assert.ok(!/real screenshot of (n8n|the n8n)/i.test(text));
});
