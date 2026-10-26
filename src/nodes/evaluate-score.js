//#uses evaluate
const now = new Date().toISOString();
const bases = $('Preparar petición IA').all();
return $input.all().map(function (resp, i) {
  const lead = bases[i].json.lead;
  const r = evaluateAi(resp.json, lead, { now: now });
  return {
    json: {
      lead_row: r.leadRow,
      task_row: r.taskRow,
      error_row: r.errorRow,
      has_task: r.taskRow !== null,
      has_error: r.errorRow !== null,
      status: r.status
    }
  };
});
