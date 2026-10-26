# Scoring rules

The score is computed in code (`computeScore` in `src/lead-core.js`) from verified signals. The language model never sees these rules and cannot change the result.

## Points (maximum 100)

| Signal | Points |
| --- | --- |
| Intent: ready_to_buy / evaluating / researching | 30 / 18 / 7 |
| Intent: support / spam / unknown | 0 |
| Budget: ≥ 20k / 5k-20k / 1k-5k / < 1k | 25 / 18 / 10 / 3 |
| Timeframe: immediate / short / long | 20 / 12 / 5 |
| Company size: > 200 / 51-200 / 11-50 / 1-10 | 15 / 12 / 8 / 4 |
| Business e-mail domain (not free, not disposable) | +5 |
| Phone provided | +3 |
| Company provided | +2 |
| Disposable e-mail | -30 |
| Message shorter than 40 characters | -5 |
| More than 3 links | -10 |

The score is clamped to 0-100. Budget tiers assume the currency written in the message (EUR in the demo data).

## Priority

- `alta` ≥ 70, `media` ≥ 40, otherwise `baja`.
- Spam intent or a disposable e-mail caps the score at 10.
- `alta` requires a verified intent of `ready_to_buy` or `evaluating`; otherwise it is lowered to `media`.

## Where each signal comes from

- Budget, timeframe and company size filled in the form always win over the model.
- Model signals count only if the model quoted the supporting text and the quote exists in the message. Otherwise the signal becomes `unknown` and the lead is flagged `evidencia_no_encontrada` for human review.
- If the message looks like a prompt-injection attempt, the model intent is discarded and only form values are used.

## Human review flags

Any of these sets `human_review_required` and turns the task type into `revisar_manual`: `posible_inyeccion`, `evidencia_no_encontrada`, `cifra_no_verificada`, `contenido_no_verificado`, `confianza_baja`, `datos_pago_enmascarados`, `documento_enmascarado`, `email_desechable`, `intencion_spam`, `muchos_enlaces`, `html_oculto`, `ia_enum_invalido`, `producto_no_verificado`.

## Worked example

Hot demo lead: intent ready_to_buy 30 + budget 5k-20k 18 + timeframe immediate 20 + size 51-200 12 + business e-mail 5 + phone 3 + company 2 = 90, priority `alta`, task `llamar`, due in 4 hours.

The threshold tests (69 / 70 and 39 / 40) are in `tests/core.test.js`.
