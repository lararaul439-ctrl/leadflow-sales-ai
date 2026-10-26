# Security policy

## Reporting a vulnerability

Please **do not open a public issue** for a security problem.

Use GitHub's private reporting: *Security* tab of the repository, then *Report a vulnerability*. If that option is not shown, open an issue titled "Security contact request" **without any detail** and the maintainer will arrange a private channel.

Include what you found, how to reproduce it with fictional data, and what you think the impact is. Do not include real personal data or live credentials. This is a personal portfolio project maintained on a best-effort basis; there is no service level agreement and no bug bounty.

## Supported versions

Only the latest release on `main` is maintained.

## What is in scope

- The workflow logic in `src/`, the generated exports in `workflows/`, the proxy reference in `proxy/` and the SQL option in `db/`.
- Documentation that gives unsafe advice.

Out of scope: vulnerabilities in n8n, Google, Groq or Cloudflare themselves (report those to the vendor), social engineering, and findings that need a compromised n8n instance or Google account.

## What the project does and does not promise

It is a lead-triage workflow that treats every incoming message as hostile data, keeps a human in charge of anything that is sent, and documents its limits. It does **not** promise:

- protection against denial of service (the in-workflow throttle is best effort);
- that prompt injection is eliminated (detection reduces risk; the design limits the damage);
- that duplicates cannot race on Google Sheets under real concurrency (see [docs/CONCURRENCY.md](docs/CONCURRENCY.md));
- legal compliance for personal data (see [docs/PRIVACY.md](docs/PRIVACY.md)).

The current review, with findings and their status, is in [docs/SECURITY_REVIEW.md](docs/SECURITY_REVIEW.md) and the threat model in [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md).

## If you deploy it

1. Create the webhook token yourself, long and random, and keep it only in n8n credentials. **If a token has ever been pasted into a chat, a ticket or a browser form, replace it.**
2. Keep the Google Sheet private and restrict who can open the n8n instance.
3. Do not let a public web page hold the token: put a proxy in front (`proxy/`).
4. Set a retention period for the sheet and for n8n's failed executions, which contain request data.
5. Review the AI provider's data terms before sending real customer text.
6. Never commit `.env`, exports that contain credentials, or a Google Sheet id. A test fails if a credential-shaped string or a spreadsheet id appears in the repository, and GitHub push protection is enabled.

## Secrets that appear in the project

| Secret | Where it lives | Never in |
| --- | --- | --- |
| Webhook token | n8n credential "LeadFlow webhook token", the client that calls the webhook | repository, docs, issue text |
| Groq API key | n8n credential "Groq API key" | repository, workflow export |
| Google OAuth | n8n credential | repository |
| Google Sheet id | the *Configuración* node after import | repository |
