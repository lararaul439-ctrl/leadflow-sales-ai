//#uses normalize, ratelimit
const now = new Date().toISOString();
const sd = $getWorkflowStaticData('global');
return $input.all().map(function (item) {
  const j = item.json || {};
  const rl = rateLimitCheck(sd.rl, Date.now(), { windowSeconds: Number(j.rate_window_seconds), maxRequests: Number(j.rate_max_requests) });
  sd.rl = rl.state;
  if (!rl.allowed) {
    return { json: { valid: false, http_status: 429, errors: ['rate_limited: retry after ' + rl.retryAfter + ' s'], warnings: [], lead: null } };
  }
  const r = normalizeLead(j.body, { now: now });
  return { json: { valid: r.valid, http_status: r.http_status, errors: r.errors, warnings: r.warnings, lead: r.lead || null } };
});
