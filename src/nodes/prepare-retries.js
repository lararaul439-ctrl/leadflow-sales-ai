//#uses duplicates
const now = new Date().toISOString();
const rows = $input.all().map(function (i) { return i.json; });
return selectRetryable(rows, { now: now }).map(function (lead) { return { json: { lead: lead } }; });
