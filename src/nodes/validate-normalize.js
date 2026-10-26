//#uses normalize
const now = new Date().toISOString();
return $input.all().map(function (item) {
  const j = item.json || {};
  const payload = j.body !== undefined ? j.body : j;
  const r = normalizeLead(payload, { now: now });
  return { json: { valid: r.valid, errors: r.errors, warnings: r.warnings, lead: r.lead || null } };
});
