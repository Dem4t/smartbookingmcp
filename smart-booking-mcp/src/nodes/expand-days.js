// ── One item per day, so the prayer-times request runs once per day ──
return $('Prep Request').first().json.days.map(d => ({ json: d }));
