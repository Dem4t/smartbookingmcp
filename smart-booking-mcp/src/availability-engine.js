/* ── Prayer-aware availability engine ─────────────────────────────
   Pure function so it can be unit-tested outside n8n.            */

const PRAYERS = ['Fajr', 'Dhuhr', 'Asr', 'Maghrib', 'Isha'];
const DOW = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function pad(n){ return String(n).padStart(2,'0'); }

// "04:12 (+03)" -> 252
function hhmmToMin(s){
  const m = String(s).match(/(\d{1,2}):(\d{2})/);
  return m ? (+m[1])*60 + (+m[2]) : null;
}
function minToHHMM(m){ return pad(Math.floor(m/60)) + ':' + pad(m%60); }
function iso(dateStr, min, offset){
  return `${dateStr}T${minToHHMM(((min%1440)+1440)%1440)}:00${offset}`;
}
// offset "+03:00" -> 180
function offsetMin(off){
  const m = String(off).match(/([+-])(\d{2}):?(\d{2})/);
  if(!m) return 0;
  return (m[1]==='-'?-1:1) * ((+m[2])*60 + (+m[3]));
}
// absolute instant -> {date:'YYYY-MM-DD', min:number} in the target offset
function toLocal(isoStr, off){
  const t = Date.parse(isoStr);
  if (Number.isNaN(t)) return null;
  const d = new Date(t + offsetMin(off)*60000);
  return {
    date: `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}`,
    min: d.getUTCHours()*60 + d.getUTCMinutes(),
    abs: t,
  };
}
function dowOf(dateStr, off){
  return new Date(Date.parse(dateStr + 'T12:00:00' + off)).getUTCDay();
}
function mergeBlocks(blocks){
  const s = blocks.filter(b => b.end > b.start).sort((a,b)=> a.start-b.start);
  const out = [];
  for (const b of s){
    const last = out[out.length-1];
    if (last && b.start <= last.end){
      last.end = Math.max(last.end, b.end);
      if (last.labels.indexOf(b.label) === -1) last.labels.push(b.label);
    } else {
      out.push({start:b.start, end:b.end, labels:[b.label]});
    }
  }
  return out;
}

function computeAvailability(cfg){
  const {
    days,                       // ['YYYY-MM-DD', ...]
    offset = '+03:00',
    dayStartHour = 9,
    dayEndHour = 18,
    durationMinutes = 30,
    bufferMinutes = 10,
    granularity = 15,
    prayerBefore = 5,
    prayerAfter = 25,
    jumuahBefore = 45,
    jumuahAfter = 75,
    skipPrayers = [],           // e.g. ['Fajr','Isha'] if outside work hours anyway
    maxResults = 12,
    events = [],                // raw Google Calendar events
    prayerByDate = {},          // { 'YYYY-MM-DD': {Fajr:'04:12', ...} }
  } = cfg;

  const winStart = dayStartHour*60, winEnd = dayEndHour*60;
  const slots = [], report = [];

  for (const date of days){
    const dow = dowOf(date, offset);
    const blocks = [];

    // ── prayer blocks ──────────────────────────────────────────
    const timings = prayerByDate[date] || {};
    const prayerWindows = [];
    for (const p of PRAYERS){
      if (skipPrayers.indexOf(p) !== -1) continue;
      const t = hhmmToMin(timings[p]);
      if (t === null) continue;
      const isJumuah = (dow === 5 && p === 'Dhuhr');
      const b = t - (isJumuah ? jumuahBefore : prayerBefore);
      const e = t + (isJumuah ? jumuahAfter : prayerAfter);
      if (e <= winStart || b >= winEnd) continue;       // outside working hours
      const label = isJumuah ? 'Jumuah' : p;
      blocks.push({start:b, end:e, label});
      prayerWindows.push({name: label, adhan: minToHHMM(t), blocked: `${minToHHMM(Math.max(b,0))}–${minToHHMM(Math.min(e,1439))}`});
    }

    // ── calendar blocks ────────────────────────────────────────
    let allDay = null;
    for (const ev of events){
      if (!ev || ev.status === 'cancelled') continue;
      if (ev.transparency === 'transparent') continue;
      const me = (ev.attendees || []).find(a => a && a.self);
      if (me && me.responseStatus === 'declined') continue;

      if (ev.start && ev.start.date && !ev.start.dateTime){       // all-day
        const s = ev.start.date, e = ev.end && ev.end.date ? ev.end.date : s;
        if (date >= s && date < e){ allDay = ev.summary || 'All-day event'; }
        continue;
      }
      const s = toLocal(ev.start && ev.start.dateTime, offset);
      const e = toLocal(ev.end && ev.end.dateTime, offset);
      if (!s || !e) continue;
      let a = s.min, b = e.min;
      if (s.date !== date && e.date !== date) continue;
      if (s.date !== date) a = 0;                                  // spills in from previous day
      if (e.date !== date) b = 1440;                               // spills into next day
      blocks.push({start: a - bufferMinutes, end: b + bufferMinutes, label: ev.summary || 'Busy'});
    }

    if (allDay){
      report.push({date, weekday: DOW[dow], available: false, reason: `Blocked all day: ${allDay}`, prayer_windows: prayerWindows});
      continue;
    }

    const merged = mergeBlocks(blocks);
    const daySlots = [];
    let cursor = winStart;
    const gaps = [];
    for (const b of merged.concat([{start: winEnd, end: winEnd, labels:[]}])){
      if (b.start > cursor) gaps.push({start: cursor, end: Math.min(b.start, winEnd)});
      cursor = Math.max(cursor, b.end);
      if (cursor >= winEnd) break;
    }
    if (cursor < winEnd) gaps.push({start: cursor, end: winEnd});

    for (const g of gaps){
      let s = Math.ceil(Math.max(g.start, winStart)/granularity)*granularity;
      let taken = 0;
      while (s + durationMinutes <= Math.min(g.end, winEnd) && taken < 3){
        daySlots.push({
          date,
          weekday: DOW[dow],
          start: iso(date, s, offset),
          end: iso(date, s + durationMinutes, offset),
          local: `${minToHHMM(s)}–${minToHHMM(s+durationMinutes)}`,
        });
        s += Math.max(granularity, durationMinutes);
        taken++;
      }
    }

    report.push({
      date, weekday: DOW[dow],
      available: daySlots.length > 0,
      free_slots_found: daySlots.length,
      busy_blocks: merged.map(b => `${minToHHMM(Math.max(b.start,0))}–${minToHHMM(Math.min(b.end,1439))} (${b.labels.join(', ')})`),
      prayer_windows: prayerWindows,
    });
    slots.push(...daySlots);
  }

  return {
    duration_minutes: durationMinutes,
    working_hours: `${pad(dayStartHour)}:00–${pad(dayEndHour)}:00`,
    timezone_offset: offset,
    slots: slots.slice(0, maxResults),
    total_found: slots.length,
    days: report,
  };
}

if (typeof module !== 'undefined') module.exports = { computeAvailability, hhmmToMin, toLocal, mergeBlocks };
