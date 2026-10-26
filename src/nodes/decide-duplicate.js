//#uses duplicates
const now = new Date().toISOString();
const lead = $('Validar y normalizar').first().json.lead;
const history = $input.all().map(function (i) { return i.json; });
return [{ json: decideDuplicate(lead, history, { now: now }) }];
