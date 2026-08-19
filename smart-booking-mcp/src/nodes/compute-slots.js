
// ── Wire n8n data into the engine ───────────────────────────────
const cfg = $('Prep Request').first().json;

const prayerByDate = {};
for (const item of $input.all()) {
  const d = item.json && item.json.data;
  if (!d || !d.timings) continue;
  const g = d.date && d.date.gregorian && d.date.gregorian.date;   // 'DD-MM-YYYY'
  if (!g) continue;
  const [dd, mm, yyyy] = g.split('-');
  prayerByDate[`${yyyy}-${mm}-${dd}`] = d.timings;
}

const events = $('Get Busy Events').all()
  .map(i => i.json)
  .filter(e => e && (e.start || e.id));

const result = computeAvailability({
  days: cfg.days.map(d => d.date),
  offset: cfg.offset,
  dayStartHour: cfg.day_start_hour,
  dayEndHour: cfg.day_end_hour,
  durationMinutes: cfg.duration_minutes,
  bufferMinutes: cfg.buffer_minutes,
  maxResults: cfg.max_results,
  events,
  prayerByDate,
});

result.calendar_id = cfg.calendarId;
result.instructions_for_the_assistant =
  'Offer the user 2-3 of these slots in plain language. Never invent a time that is not in "slots". ' +
  'When the user picks one, call book_meeting with that exact start and end value.';

return [{ json: result }];
