'use strict';
/*
 * Flat ESLint config with NO plugins and NO shared configs: it needs ESLint and nothing else (the project has
 * no dependencies at all). The rule list is a deliberate subset of the usual "recommended" errors plus a few
 * safety rules (no eval, strict equality).
 */
const fs = require('node:fs');
const path = require('node:path');

const nodeGlobals = {
  require: 'readonly', module: 'writable', exports: 'writable', process: 'readonly', console: 'readonly', __dirname: 'readonly', __filename: 'readonly',
  Buffer: 'readonly', setTimeout: 'readonly', clearTimeout: 'readonly', setImmediate: 'readonly', URL: 'readonly', URLSearchParams: 'readonly',
  TextEncoder: 'readonly', TextDecoder: 'readonly', AbortSignal: 'readonly', fetch: 'readonly', Request: 'readonly', Response: 'readonly'
};

// The Code-node glue files in src/nodes/ are fragments: they call functions that scripts/build-workflow.js embeds
// from src/lead-core.js, and they use the n8n helpers. Derive those globals from the source so no-undef stays useful.
const core = fs.readFileSync(path.join(__dirname, 'src/lead-core.js'), 'utf8');
const coreNames = new Set();
for (const m of core.matchAll(/^(?:function\s+([A-Za-z_$][\w$]*)|(?:var|const|let)\s+([A-Za-z_$][\w$]*))/gm)) coreNames.add(m[1] || m[2]);
const n8nGlobals = { $input: 'readonly', $: 'readonly', $execution: 'readonly', $getWorkflowStaticData: 'readonly' };
const glue = Object.assign({}, n8nGlobals);
coreNames.forEach((n) => { glue[n] = 'readonly'; });

const rules = {
  'no-undef': 'error',
  'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none', varsIgnorePattern: '^_' }],
  'no-redeclare': 'error',
  'no-dupe-keys': 'error',
  'no-dupe-args': 'error',
  'no-dupe-else-if': 'error',
  'no-duplicate-case': 'error',
  'no-unreachable': 'error',
  'no-unsafe-finally': 'error',
  'no-unsafe-negation': 'error',
  'no-cond-assign': 'error',
  'no-self-assign': 'error',
  'no-sparse-arrays': 'error',
  'no-const-assign': 'error',
  'no-func-assign': 'error',
  'no-import-assign': 'error',
  'no-inner-declarations': 'error',
  'no-empty': ['error', { allowEmptyCatch: true }],
  'no-fallthrough': 'error',
  'no-extra-boolean-cast': 'error',
  'no-global-assign': 'error',
  'no-obj-calls': 'error',
  'no-unexpected-multiline': 'error',
  'no-useless-catch': 'error',
  'no-shadow-restricted-names': 'error',
  'use-isnan': 'error',
  'valid-typeof': 'error',
  'getter-return': 'error',
  'require-yield': 'error',
  'eqeqeq': ['error', 'always', { null: 'ignore' }],
  'no-eval': 'error',
  'no-implied-eval': 'error',
  'no-new-func': 'error',
  'no-with': 'error',
  'no-throw-literal': 'error',
  'no-prototype-builtins': 'error'
};

module.exports = [
  { ignores: ['node_modules/**', 'workflows/**', 'docs/images/**', 'coverage/**'] },
  {
    files: ['**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: nodeGlobals },
    rules
  },
  {
    files: ['**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals },
    rules
  },
  {
    files: ['src/nodes/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: glue },
    rules: Object.assign({}, rules, { 'no-unused-vars': 'off', 'no-redeclare': 'off' })
  },
  {
    // the structural test deliberately compiles generated code with new Function() to prove it is syntactically valid
    files: ['tests/workflow.test.js'],
    rules: { 'no-new-func': 'off' }
  },
  {
    // The runtime harness is the body of an n8n Code node: it uses the n8n globals and, by design, compiles the
    // generated node code with new Function() to run it exactly as n8n would.
    files: ['tests/live/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'commonjs', globals: Object.assign({}, nodeGlobals, n8nGlobals) },
    rules: Object.assign({}, rules, { 'no-new-func': 'off' })
  },
  {
    files: ['tests/runtime-harness.test.js'],
    rules: { 'no-new-func': 'off' }
  },
  {
    // fixtures and tests that exercise hostile input legitimately contain odd literals
    files: ['tests/**/*.js'],
    rules: { 'no-prototype-builtins': 'off' }
  }
];
