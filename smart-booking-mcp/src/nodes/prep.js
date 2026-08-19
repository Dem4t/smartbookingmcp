// ═══ CONFIG ═══════════════════════════════════════════════════════
const CONFIG = {
  calendar_id:      'abdulrhman.a.otb@gmail.com', // '' or 'primary' = the account's default calendar
  timezone_offset:  '+03:00',                     // Saudi Arabia, no DST
  city:             'Riyadh',
  country:          'SA',
  prayer_method:    4,                            // 4 = Umm Al-Qura
  duration_minutes: 30,
  day_start_hour:   9,
  day_end_hour:     18,
  buffer_minutes:   10,                           // breathing room around existing meetings
  max_results:      12,
  days_to_scan:     5,
  skip_weekend:     true,                         // Friday + Saturday
};

// ── Read the tool's arguments, apply defaults, work out which days to scan ──
const raw = $input.first().json || {};
// When the tool is called with a free-text `query` instead of typed fields,
// try to read a JSON object out of it before falling back to defaults.
let p = raw;
if (typeof raw.query === 'string' && raw.query.trim().startsWith('{')) {
  try { p = Object.assign({}, raw, JSON.parse(raw.query)); } catch (e) { /* keep raw */ }
}
const val = (v, d) => (v === undefined || v === null || v === '' ) ? d : v;
const num = (v, d) => { if (v === undefined || v === null || v === '') return d; const n = Number(v); return Number.isFinite(n) ? n : d; };

const offset       = val(p.timezone_offset, CONFIG.timezone_offset);
const city         = val(p.city, CONFIG.city);
const country      = val(p.country, CONFIG.country);
const method       = num(p.prayer_method, CONFIG.prayer_method);          // 4 = Umm Al-Qura (KSA)
const calendarId   = val(p.calendar_id, CONFIG.calendar_id);
const duration     = num(p.duration_minutes, CONFIG.duration_minutes);
const dayStartHour = num(p.day_start_hour, CONFIG.day_start_hour);
const dayEndHour   = num(p.day_end_hour, CONFIG.day_end_hour);
const buffer       = num(p.buffer_minutes, CONFIG.buffer_minutes);
const maxResults   = num(p.max_results, CONFIG.max_results);
const skipWeekend  = val(p.skip_weekend, CONFIG.skip_weekend) !== false && val(p.skip_weekend, CONFIG.skip_weekend) !== 'false';

const pad = n => String(n).padStart(2, '0');
const offMin = (() => { const m = String(offset).match(/([+-])(\d{2}):?(\d{2})/); return m ? (m[1] === '-' ? -1 : 1) * (+m[2] * 60 + +m[3]) : 0; })();
const fmt = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const todayLocal = fmt(new Date(Date.now() + offMin * 60000));
const startDate  = /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || '')) ? p.date : todayLocal;
const explicit   = /^\d{4}-\d{2}-\d{2}$/.test(String(p.date || ''));
// 0 (or missing) means "decide for me": one day when a date was named, a scan otherwise.
const asked      = num(p.days_to_scan, 0);
const scan       = asked > 0 ? Math.min(asked, 14) : (explicit ? 1 : CONFIG.days_to_scan);

const days = [];
let cur = Date.parse(startDate + 'T12:00:00Z');
let guard = 0;
while (days.length < scan && guard++ < 40) {
  const d = new Date(cur);
  const dow = d.getUTCDay();                       // 5 = Friday, 6 = Saturday
  const isWeekend = (dow === 5 || dow === 6);
  // A weekend day is skipped unless the caller named that exact date.
  if (!(skipWeekend && isWeekend && !(explicit && fmt(d) === startDate))) {
    days.push({ date: fmt(d), date_ddmmyyyy: `${pad(d.getUTCDate())}-${pad(d.getUTCMonth() + 1)}-${d.getUTCFullYear()}` });
  }
  cur += 86400000;
}

const rangeStart = days[0].date + 'T00:00:00' + offset;
const last = days[days.length - 1].date;
const rangeEnd = fmt(new Date(Date.parse(last + 'T12:00:00Z') + 86400000)) + 'T00:00:00' + offset;

return [{ json: {
  offset, city, country, method, calendarId,
  duration_minutes: duration, day_start_hour: dayStartHour, day_end_hour: dayEndHour,
  buffer_minutes: buffer, max_results: maxResults,
  attendee_emails: val(p.attendee_emails, ''),
  days, range_start: rangeStart, range_end: rangeEnd,
} }];
