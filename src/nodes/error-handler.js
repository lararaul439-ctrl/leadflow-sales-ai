//#uses errhandler
const now = new Date().toISOString();
return $input.all().map(function (i) { return { json: executionErrorRow(i.json, now) }; });
