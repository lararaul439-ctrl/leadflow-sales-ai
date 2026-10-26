'use strict';
/* Sends demo/leads.json to your own n8n webhook. Fictional data only.
 * Usage: WEBHOOK_URL=... WEBHOOK_TOKEN=... node scripts/send-demo.js [--twice]
 * --twice sends every lead a second time to show that duplicates are ignored. */
const fs = require('node:fs');
const path = require('node:path');

const url = process.env.WEBHOOK_URL;
const token = process.env.WEBHOOK_TOKEN;
if (!url || !token) {
  console.error('Set WEBHOOK_URL and WEBHOOK_TOKEN (see .env.example).');
  process.exit(1);
}
const leads = JSON.parse(fs.readFileSync(path.join(__dirname, '../demo/leads.json'), 'utf8'));
const rounds = process.argv.includes('--twice') ? 2 : 1;

async function main() {
  for (let r = 0; r < rounds; r++) {
    for (const item of leads) {
      const { _note, ...lead } = item;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Webhook-Token': token },
        body: JSON.stringify(lead)
      });
      const text = await res.text();
      console.log(`[round ${r + 1}] ${_note}\n  -> HTTP ${res.status} ${text.slice(0, 200)}`);
    }
  }
}
main().catch((e) => { console.error(e.message); process.exit(1); });
