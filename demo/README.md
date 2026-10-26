# Demo

Seven fictional leads in [`leads.json`](leads.json). Every name, company and address is invented (`.example` domains).

```bash
export WEBHOOK_URL="https://YOUR-INSTANCE.app.n8n.cloud/webhook/leadflow-sales"
export WEBHOOK_TOKEN="your-token"
npm run demo:send              # one round
npm run demo:send -- --twice   # second round shows duplicate handling
```

PowerShell users can send a single lead with `Invoke-WebRequest` (see [docs/SETUP.md](../docs/SETUP.md)).

## What to expect

| Lead | HTTP | Result in the sheet |
| --- | --- | --- |
| Marta Sanz (hot, Spanish) | 202 | Status `tarea_creada`, priority `alta`, score about 90. Task `llamar` due in 4 h, draft pending approval, asks who decides. |
| Jorge Ibanez (cold) | 202 | Priority `baja`. Draft asks for budget, timeframe, company size and phone. |
| Priya Nair (English, evaluating) | 202 | Intent `evaluating`, priority `media` or `baja` depending on the model's reading. Draft in English. |
| Carlos Vega (no consent) | 202 | Scored (about 45, `media`), status `sin_consentimiento`, **no task**. |
| Test Injection | 202 | Flag `posible_inyeccion`, model intent ignored, priority `baja`, task `revisar_manual` with human review. |
| Temp Sender (disposable e-mail) | 202 | Flags `email_desechable`, score capped at 10, review required. |
| No Email | 422 | Rejected with the field error. Nothing is written. |

On the second round every accepted lead answers `200` with `duplicate: true` and no row is added.

Exact scores depend on what the language model extracts; the rules that turn those signals into a score are fixed and documented in [docs/SCORING.md](../docs/SCORING.md). Results observed on the real stack (Groq and Google Sheets) are listed in [docs/TEST_REPORT.md](../docs/TEST_REPORT.md).
