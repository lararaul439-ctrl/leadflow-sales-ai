'use strict';
/*
 * Renders every Mermaid source in docs/diagrams/*.mmd to docs/images/<name>.svg and .png.
 *
 * The project has no dependencies, so the Mermaid CLI is NOT installed by npm install. Install it yourself when
 * you want to change a diagram:
 *
 *   npm install -g @mermaid-js/mermaid-cli
 *   npm run docs:diagrams
 *
 * If Chromium cannot be found by the CLI, point it to a Puppeteer config with PUPPETEER_CONFIG=/path/to/pptr.json
 * (for example {"executablePath": "/usr/bin/chromium", "args": ["--no-sandbox"]}).
 */
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'docs/diagrams');
const OUT = path.join(ROOT, 'docs/images');

function run(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit' });
  if (r.error && r.error.code === 'ENOENT') {
    console.error('mmdc (Mermaid CLI) was not found. Install it with: npm install -g @mermaid-js/mermaid-cli');
    process.exit(1);
  }
  if (r.status !== 0) process.exit(r.status || 1);
}

// The workflow graph is generated from the committed export, so refresh its source first.
run(process.execPath, [path.join(__dirname, 'workflow-to-mermaid.js')]);

const sources = fs.readdirSync(SRC).filter((f) => f.endsWith('.mmd')).sort();
fs.mkdirSync(OUT, { recursive: true });
for (const file of sources) {
  const name = file.replace(/\.mmd$/, '');
  for (const ext of ['svg', 'png']) {
    const args = ['-q', '-i', path.join(SRC, file), '-o', path.join(OUT, name + '.' + ext), '-b', 'white'];
    if (ext === 'png') args.push('-s', '2');
    if (process.env.PUPPETEER_CONFIG) args.push('-p', process.env.PUPPETEER_CONFIG);
    run('mmdc', args);
  }
  console.log('rendered ' + name);
}
