# Contributing

Thanks for looking. This is a small project with one rule that matters more than the others: **anything that decides something about a lead lives in `src/lead-core.js`, and the n8n export is generated from it.**

## Setup

Node 22 or newer is recommended (Node 20 works but skips the SQLite tests). There are no runtime dependencies.

```bash
npm run verify     # build check, lint, all tests
```

`npm run lint` needs ESLint available globally or via `npx --yes eslint@10.1.0 .`.

## Changing behaviour

1. Edit `src/lead-core.js` or the glue in `src/nodes/`.
2. Run `npm run build` to regenerate `workflows/*.json`, `templates/*.csv` and the schema. Commit the generated files: a test fails when they are out of date.
3. Add or change a test next to the behaviour. A security fix needs a test that fails without it.
4. If the node graph changed, run `node scripts/workflow-to-mermaid.js` and re-render the diagrams (`npm run docs:diagrams`, needs the Mermaid CLI).
5. Update the docs that describe it: [docs/data-schema.md](docs/data-schema.md), [docs/SCORING.md](docs/SCORING.md), [CHANGELOG.md](CHANGELOG.md).

## Rules for this repository

- **Fictional data only.** Use reserved domains (`example`, `example.com`, `test`) in tests and demos. A test checks this.
- **No secrets, no real sheet ids, no real webhook URLs**, even in examples. A test checks this, and GitHub push protection is on.
- **Do not claim more than was verified.** In docs, say whether something was run on a real service, simulated, or only prepared. See the vocabulary in [docs/TEST_REPORT.md](docs/TEST_REPORT.md).
- No outbound messages: the workflow prepares drafts for a person. A pull request that adds an automatic send needs a separate design discussion first.
- Keep the code in `src/lead-core.js` free of backticks, `require()` and external dependencies (it is embedded into n8n Code nodes).
- Do not add dependencies without a strong reason. Pin GitHub Actions to a full commit SHA.

## Commit and pull request style

- Small commits with an imperative subject line ("Add ...", "Fix ...").
- A pull request describes what changed, why, how it was tested and what was **not** tested.
- Do not merge your own pull request on `main` without a review if you are not the maintainer.

## Reporting problems

Bugs and ideas: open an issue with a fictional example. Security problems: see [SECURITY.md](SECURITY.md).
