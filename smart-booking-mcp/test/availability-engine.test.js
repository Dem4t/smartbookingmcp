const { test } = require('node:test');
const assert = require('node:assert');
const { computeAvailability } = require('../src/availability-engine.js');

const TUE = '2026-08-25', WED = '2026-08-26', FRI = '2026-08-28';
const prayerByDate = {
  [TUE]: { Fajr:'04:22', Dhuhr:'12:06', Asr:'15:36', Maghrib:'18:29', Isha:'19:59' },
  [WED]: { Fajr:'04:23', Dhuhr:'12:06', Asr:'15:36', Maghrib:'18:28', Isha:'19:58' },
  [FRI]: { Fajr:'04:24', Dhuhr:'12:05', Asr:'15:35', Maghrib:'18:25', Isha:'19:55' },
};
const at = (d, t) => ({ dateTime: `${d}T${t}:00+03:00` });
const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const overlaps = (slot, from, to) => {
  const [s, e] = slot.local.split('–').map(toMin);
  return s < toMin(to) && e > toMin(from);
};

test('keeps a buffer around existing meetings', () => {
  const r = computeAvailability({
    days: [TUE], durationMinutes: 60, prayerByDate,
    events: [{ summary: 'Standup', start: at(TUE, '10:00'), end: at(TUE, '11:00') }],
  });
  assert.ok(!r.slots.some(s => overlaps(s, '09:50', '11:10')), 'no slot may touch the 10-min buffer');
  assert.ok(r.slots.length > 0, 'the rest of the day is still bookable');
});

test('never books over a prayer window', () => {
  const r = computeAvailability({ days: [TUE], durationMinutes: 30, prayerByDate });
  assert.ok(!r.slots.some(s => overlaps(s, '12:01', '12:31')), 'Dhuhr is protected');
  assert.ok(!r.slots.some(s => overlaps(s, '15:31', '16:01')), 'Asr is protected');
});

test("Friday gets a wide Jumu'ah window instead of a normal Dhuhr one", () => {
  const r = computeAvailability({ days: [FRI], durationMinutes: 30, prayerByDate });
  const jumuah = r.days[0].prayer_windows.find(p => p.name === 'Jumuah');
  assert.strictEqual(jumuah.blocked, '11:20–13:20');
  assert.ok(!r.slots.some(s => overlaps(s, '11:20', '13:20')));
});

test('an all-day event blocks the whole day', () => {
  const r = computeAvailability({
    days: [WED], durationMinutes: 30, prayerByDate,
    events: [{ summary: 'Annual leave', start: { date: WED }, end: { date: '2026-08-27' } }],
  });
  assert.strictEqual(r.slots.length, 0);
  assert.strictEqual(r.days[0].available, false);
  assert.match(r.days[0].reason, /Annual leave/);
});

test('declined invitations and free-time events do not block', () => {
  const r = computeAvailability({
    days: [TUE], durationMinutes: 30, prayerByDate,
    events: [
      { summary: 'Declined', start: at(TUE, '09:00'), end: at(TUE, '10:00'),
        attendees: [{ self: true, responseStatus: 'declined' }] },
      { summary: 'Free time', transparency: 'transparent', start: at(TUE, '09:00'), end: at(TUE, '10:00') },
    ],
  });
  assert.strictEqual(r.slots[0].local, '09:00–09:30');
});

test('events stored in UTC are compared in local time', () => {
  const r = computeAvailability({
    days: [TUE], durationMinutes: 30, prayerByDate,
    events: [{ summary: 'UTC meeting', start: { dateTime: `${TUE}T06:00:00Z` }, end: { dateTime: `${TUE}T07:00:00Z` } }],
  });
  assert.ok(!r.slots.some(s => overlaps(s, '09:00', '10:00')), '06:00Z is 09:00 in Riyadh');
});

test('a multi-day scan stays ordered and respects max_results', () => {
  const r = computeAvailability({ days: [TUE, WED, FRI], durationMinutes: 45, prayerByDate, maxResults: 5 });
  assert.strictEqual(r.slots.length, 5);
  assert.strictEqual(r.slots[0].date, TUE);
  assert.ok(r.total_found > 5, 'total_found reports everything, slots is the capped view');
});

test('a fully booked day returns nothing rather than a bad suggestion', () => {
  const r = computeAvailability({
    days: [TUE], durationMinutes: 60, prayerByDate,
    events: [{ summary: 'Offsite', start: at(TUE, '08:00'), end: at(TUE, '19:00') }],
  });
  assert.strictEqual(r.slots.length, 0);
  assert.strictEqual(r.days[0].available, false);
});

test('returned slots are valid ISO 8601 with the configured offset', () => {
  const r = computeAvailability({ days: [TUE], durationMinutes: 30, prayerByDate });
  for (const s of r.slots) {
    assert.match(s.start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\+03:00$/);
    assert.strictEqual(Date.parse(s.end) - Date.parse(s.start), 30 * 60000);
  }
});
