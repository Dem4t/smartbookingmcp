const { test } = require('node:test');
const assert = require('node:assert');
const { runNode, enginePrelude } = require('./helpers/n8n-sandbox.js');

const PREP = 'src/nodes/prep.js';
const EXPAND = 'src/nodes/expand-days.js';
const COMPUTE = 'src/nodes/compute-slots.js';

test('Prep Request: empty call falls back to every default', () => {
  const [{ json }] = runNode(PREP, { input: [{}] });
  assert.strictEqual(json.duration_minutes, 30);
  assert.strictEqual(json.day_start_hour, 9);
  assert.strictEqual(json.day_end_hour, 18);
  assert.strictEqual(json.days.length, 5);
});

test('Prep Request: nulls from the trigger are treated as "not provided"', () => {
  // Regression: Number(null) === 0, which silently produced a 00:00–00:00 working day.
  const [{ json }] = runNode(PREP, { input: [{
    date: null, duration_minutes: null, days_to_scan: null,
    day_start_hour: null, day_end_hour: null, calendar_id: null,
  }] });
  assert.strictEqual(json.duration_minutes, 30);
  assert.strictEqual(json.day_start_hour, 9);
  assert.strictEqual(json.day_end_hour, 18);
  assert.strictEqual(json.days.length, 5);
  assert.notStrictEqual(json.calendarId, null);
});

test('Prep Request: a scan skips Friday and Saturday', () => {
  const [{ json }] = runNode(PREP, { input: [{ days_to_scan: 7 }] });
  const weekdays = json.days.map(d => new Date(d.date + 'T12:00:00Z').getUTCDay());
  assert.ok(!weekdays.includes(5) && !weekdays.includes(6), 'weekend days must not be scanned');
  assert.strictEqual(json.days.length, 7);
});

test('Prep Request: an explicitly requested Friday is honoured anyway', () => {
  const [{ json }] = runNode(PREP, { input: [{ date: '2026-08-28' }] });
  assert.strictEqual(json.days.map(d => d.date).join(), '2026-08-28');
});

test('Prep Request: accepts a JSON string in `query` as a fallback', () => {
  const [{ json }] = runNode(PREP, { input: [{ query: '{"duration_minutes":90,"day_start_hour":8}' }] });
  assert.strictEqual(json.duration_minutes, 90);
  assert.strictEqual(json.day_start_hour, 8);
});

test('Expand Days: emits one item per scanned day', () => {
  const [{ json: prep }] = runNode(PREP, { input: [{ days_to_scan: 3 }] });
  const items = runNode(EXPAND, { prev: { 'Prep Request': [prep] } });
  assert.strictEqual(items.length, 3);
  assert.match(items[0].json.date_ddmmyyyy, /^\d{2}-\d{2}-\d{4}$/);
});

test('Compute Slots: full pipeline over mocked calendar + prayer payloads', () => {
  const [{ json: prep }] = runNode(PREP, { input: [{ duration_minutes: 45 }] });
  const [d0, d1] = prep.days;

  const prayerItems = prep.days.map(d => ({
    data: {
      timings: { Fajr: '04:22', Dhuhr: '12:06', Asr: '15:36', Maghrib: '18:29', Isha: '19:59' },
      date: { gregorian: { date: d.date_ddmmyyyy } },
    },
  }));
  const events = [
    { id: '1', summary: 'Sprint review',
      start: { dateTime: d0.date + 'T10:00:00+03:00' }, end: { dateTime: d0.date + 'T11:00:00+03:00' } },
    { id: '2', summary: 'Training day', start: { date: d1.date },
      end: { date: new Date(Date.parse(d1.date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10) } },
  ];

  const [{ json: out }] = runNode(COMPUTE, {
    prelude: enginePrelude(),
    input: prayerItems,
    prev: { 'Prep Request': [prep], 'Get Busy Events': events },
  });

  assert.strictEqual(out.duration_minutes, 45);
  assert.strictEqual(out.working_hours, '09:00–18:00');
  assert.ok(out.slots.length > 0, 'should find bookable time');
  assert.ok(!out.slots.some(s => s.date === d1.date), 'the all-day event day must yield nothing');
  assert.strictEqual(out.days[1].available, false);
  assert.ok(out.days[0].busy_blocks.some(b => b.includes('Sprint review')));
  assert.ok(out.days[0].prayer_windows.some(p => p.name === 'Dhuhr'));
});

test('Prep Request: a named date means that day only, even with the tool default of 0', () => {
  const [{ json }] = runNode(PREP, { input: [{ date: '2026-08-25', days_to_scan: 0 }] });
  assert.strictEqual(json.days.map(d => d.date).join(), '2026-08-25');
});

test('Prep Request: a named weekend day is honoured, the rest of the range still skips weekends', () => {
  // 2026-08-28 is a Friday. Asking for it explicitly plus 3 days must not pull in Saturday.
  const [{ json }] = runNode(PREP, { input: [{ date: '2026-08-28', days_to_scan: 3 }] });
  const dates = json.days.map(d => d.date);
  assert.strictEqual(dates[0], '2026-08-28', 'the requested Friday is kept');
  assert.ok(!dates.includes('2026-08-29'), 'the following Saturday is still skipped');
  assert.strictEqual(dates.length, 3);
});

test('Prep Request: an explicit days_to_scan always wins', () => {
  const [{ json }] = runNode(PREP, { input: [{ days_to_scan: 2 }] });
  assert.strictEqual(json.days.length, 2);
});
