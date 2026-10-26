//#uses duplicates, claims
const now = new Date().toISOString();
const lead = $('Validar y normalizar').first().json.lead;
const history = $input.all().map(function (i) { return i.json; });
const d = decideDuplicate(lead, history, { now: now });
if (d.action === 'process') { d.claim = buildClaim(d.lead, $execution.id, now); }
return [{ json: d }];
