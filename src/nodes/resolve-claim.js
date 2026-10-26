//#uses claims
const decided = $('Decidir duplicado').first().json;
const rows = $input.all().map(function (i) { return i.json; });
const r = resolveClaim(rows, decided.claim);
if (r.error) { throw new Error('Claim not visible after writing it (' + r.reason + '); the caller must retry'); }
return [{ json: { won: r.won, reason: r.reason, action: r.won ? 'process' : 'ignore', row: decided.row, submission_id: decided.lead.submission_id } }];
