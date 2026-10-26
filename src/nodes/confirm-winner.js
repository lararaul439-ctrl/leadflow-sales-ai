//#uses duplicates
const now = new Date().toISOString();
const lead = $('Validar y normalizar').first().json.lead;
const history = $input.all().map(function (i) { return i.json; });
const d = decideDuplicate(lead, history, { now: now });
// If the winner's row is still not there, do not answer "duplicate": the caller must retry.
return [{ json: { action: d.action === 'conflict' ? 'conflict' : 'ignore', reason: d.action === 'process' ? 'ganador_pendiente' : d.reason } }];
