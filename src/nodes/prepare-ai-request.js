//#uses prompt
return $input.all().map(function (item) {
  const lead = item.json.lead ? item.json.lead : $('Decidir duplicado').first().json.lead;
  return { json: { lead: lead, ai_request: buildAiRequest(lead) } };
});
