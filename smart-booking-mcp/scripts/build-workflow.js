#!/usr/bin/env node
/**
 * Assembles workflow/smart-booking-mcp.json from the sources in src/.
 * The engine logic lives in src/availability-engine.js so it can be unit tested
 * with plain `node --test`; this script inlines it into the n8n Code node.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

const CREDENTIALS = {
  googleCalendarOAuth2Api: { id: 'KEa5D2INTqGQ9StC', name: 'Google Calendar account' },
};
const CALENDAR_ID = 'abdulrhman.a.otb@gmail.com';

/* The Code node runs the engine inline: strip the CommonJS export used by tests. */
const engine = read('src/availability-engine.js')
  .split('\n')
  .filter(l => !l.startsWith('if (typeof module'))
  .join('\n');

const prepCode    = read('src/nodes/prep.js');
const expandCode  = read('src/nodes/expand-days.js');
const computeCode = engine + read('src/nodes/compute-slots.js');

const rl = (value, mode = 'id', extra = {}) => Object.assign({ __rl: true, value, mode }, extra);
const fromAI = (name, desc, type, def) =>
  `={{ /*n8n-auto-generated-fromAI-override*/ $fromAI('${name}', '${desc}', '${type}'${def === undefined ? '' : ', ' + JSON.stringify(def)}) }}`;

const sticky = (id, position, width, height, color, content) => ({
  parameters: { color, width, height, content },
  id, name: 'Note ' + id.slice(-1), type: 'n8n-nodes-base.stickyNote', typeVersion: 1, position,
});

const workflow = {
  name: 'Smart Booking MCP — prayer aware',
  nodes: [
    /* ═══ 1. MCP surface: what Claude actually sees ═══════════════════ */
    sticky('c0000000-0000-4000-8000-00000000000a', [-380, -240], 900, 300, 4,
      '## 1 — MCP surface\nThese three tools are what an MCP client (Claude) sees.\n' +
      '`find_available_slots` runs the whole engine below in a single call, so the model never does date maths itself.'),
    {
      parameters: { path: 'smart-booking' },
      id: 'c0000000-0000-4000-8000-000000000001',
      name: 'MCP Server Trigger',
      type: '@n8n/n8n-nodes-langchain.mcpTrigger',
      typeVersion: 2,
      position: [100, -120],
      webhookId: 'c0000000-0000-4000-8000-0000000000ff',
    },
    {
      parameters: {
        name: 'find_available_slots',
        description:
          "Returns bookable meeting slots already filtered against the user's calendar AND against prayer times " +
          "(Fajr, Dhuhr, Asr, Maghrib, Isha, plus a wide Jumu'ah window on Fridays), with buffers around existing " +
          'meetings. ALWAYS call this before book_meeting. Never invent a time — only offer times present in the ' +
          'returned `slots` array.',
        source: 'database',
        workflowId: rl('={{ $workflow.id }}', 'id'),
        workflowInputs: {
          mappingMode: 'defineBelow',
          value: {
            date:             fromAI('date', 'The day to check, format YYYY-MM-DD. Leave empty to scan the next working days.', 'string', ''),
            duration_minutes: fromAI('duration_minutes', 'How long the meeting should be, in minutes.', 'number', 30),
            days_to_scan:     fromAI('days_to_scan', 'How many days ahead to scan. Leave 0 unless the user asked for a range — 0 means one day when a date is given, otherwise the next few working days.', 'number', 0),
            day_start_hour:   fromAI('day_start_hour', 'Earliest acceptable hour, 24h clock.', 'number', 9),
            day_end_hour:     fromAI('day_end_hour', 'Latest acceptable hour, 24h clock.', 'number', 18),
            calendar_id:      CALENDAR_ID,
          },
          matchingColumns: [],
          schema: [
            ['date', 'string'], ['duration_minutes', 'number'], ['days_to_scan', 'number'],
            ['day_start_hour', 'number'], ['day_end_hour', 'number'], ['calendar_id', 'string'],
          ].map(([id, type]) => ({
            id, displayName: id, required: false, defaultMatch: false,
            display: true, canBeUsedToMatch: true, type,
          })),
          attemptToConvertTypes: false,
          convertFieldsToString: false,
        },
      },
      id: 'c0000000-0000-4000-8000-000000000002',
      name: 'find_available_slots',
      type: '@n8n/n8n-nodes-langchain.toolWorkflow',
      typeVersion: 2.2,
      position: [-300, 60],
      notesInFlow: true,
      notes: 'Calls this same workflow via $workflow.id',
    },
    {
      parameters: {
        descriptionType: 'manual',
        toolDescription:
          "Books a meeting on the user's calendar and creates a Google Meet link. Only use start/end values that came " +
          'back from find_available_slots. Times must be full ISO 8601 with the +03:00 offset.',
        calendar: rl(CALENDAR_ID, 'list', { cachedResultName: CALENDAR_ID }),
        start: fromAI('start_time', 'Start of the meeting, ISO 8601 e.g. 2026-08-25T13:30:00+03:00', 'string'),
        end:   fromAI('end_time', 'End of the meeting, ISO 8601 e.g. 2026-08-25T14:00:00+03:00', 'string'),
        additionalFields: {
          summary:     fromAI('title', 'Short meeting title.', 'string'),
          description: fromAI('agenda', 'Agenda or notes for the invite body.', 'string', ''),
          attendees:   [fromAI('attendee_emails', 'Comma separated email addresses of the guests.', 'string', '')],
          conferenceDataUi: { conferenceDataValues: { conferenceSolution: 'hangoutsMeet' } },
        },
      },
      id: 'c0000000-0000-4000-8000-000000000003',
      name: 'book_meeting',
      type: 'n8n-nodes-base.googleCalendarTool',
      typeVersion: 1.3,
      position: [100, 60],
      credentials: CREDENTIALS,
    },
    {
      parameters: {
        descriptionType: 'manual',
        toolDescription:
          "Lists everything already on the user's calendar from the start of today through the next 7 days. " +
          "Use it to answer 'what does my day look like' or to double-check a booking that was just made.",
        resource: 'event',
        operation: 'getAll',
        calendar: rl(CALENDAR_ID, 'list', { cachedResultName: CALENDAR_ID }),
        returnAll: true,
        // The Google Calendar node only accepts a range inside `options`, and n8n does not
        // expose $fromAI placeholders from that collection — so the range is fixed here
        // rather than silently arriving unresolved.
        options: {
          timeMin: "={{ $now.setZone('Asia/Riyadh').startOf('day').toISO() }}",
          timeMax: "={{ $now.setZone('Asia/Riyadh').plus(7, 'days').endOf('day').toISO() }}",
          singleEvents: true,
          orderBy: 'startTime',
        },
      },
      id: 'c0000000-0000-4000-8000-000000000004',
      name: 'list_my_schedule',
      type: 'n8n-nodes-base.googleCalendarTool',
      typeVersion: 1.3,
      position: [340, 60],
      credentials: CREDENTIALS,
    },

    /* ═══ 2. The engine ══════════════════════════════════════════════ */
    sticky('c0000000-0000-4000-8000-00000000000b', [-380, 240], 1420, 320, 7,
      '## 2 — Availability engine\n`find_available_slots` re-enters the workflow here.\n' +
      'Calendar events and prayer times are gathered, then **Compute Slots** subtracts busy blocks, prayer windows ' +
      'and buffers from the working day and returns only slots that survive.'),
    {
      parameters: {
        inputSource: 'workflowInputs',
        workflowInputs: { values: [
          { name: 'date' },
          { name: 'duration_minutes', type: 'number' },
          { name: 'days_to_scan', type: 'number' },
          { name: 'day_start_hour', type: 'number' },
          { name: 'day_end_hour', type: 'number' },
          { name: 'calendar_id' },
        ]},
      },
      id: 'c0000000-0000-4000-8000-000000000005',
      name: 'When Executed by Another Workflow',
      type: 'n8n-nodes-base.executeWorkflowTrigger',
      typeVersion: 1.1,
      position: [-300, 380],
    },
    {
      parameters: { jsCode: prepCode },
      id: 'c0000000-0000-4000-8000-000000000006',
      name: 'Prep Request',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [-80, 380],
      notesInFlow: true,
      notes: 'Defaults + which days to scan',
    },
    {
      parameters: {
        operation: 'getAll',
        calendar: rl('={{ $json.calendarId }}', 'id'),
        returnAll: true,
        options: {
          timeMin: '={{ $json.range_start }}',
          timeMax: '={{ $json.range_end }}',
          singleEvents: true,
          orderBy: 'startTime',
        },
      },
      id: 'c0000000-0000-4000-8000-000000000007',
      name: 'Get Busy Events',
      type: 'n8n-nodes-base.googleCalendar',
      typeVersion: 1.3,
      position: [140, 380],
      alwaysOutputData: true,
      credentials: CREDENTIALS,
    },
    {
      parameters: { jsCode: expandCode },
      id: 'c0000000-0000-4000-8000-000000000008',
      name: 'Expand Days',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [360, 380],
      notesInFlow: true,
      notes: 'One item per day',
    },
    {
      parameters: {
        url: '=https://api.aladhan.com/v1/timingsByCity/{{ $json.date_ddmmyyyy }}',
        sendQuery: true,
        queryParameters: { parameters: [
          { name: 'city',    value: "={{ $('Prep Request').first().json.city }}" },
          { name: 'country', value: "={{ $('Prep Request').first().json.country }}" },
          { name: 'method',  value: "={{ $('Prep Request').first().json.method }}" },
        ]},
        options: {},
      },
      id: 'c0000000-0000-4000-8000-000000000009',
      name: 'Get Prayer Times',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [580, 380],
      notesInFlow: true,
      notes: 'Aladhan API — no key needed',
    },
    {
      parameters: { jsCode: computeCode },
      id: 'c0000000-0000-4000-8000-00000000000c',
      name: 'Compute Slots',
      type: 'n8n-nodes-base.code',
      typeVersion: 2,
      position: [800, 380],
      notesInFlow: true,
      notes: 'The actual decision',
    },
  ],
  connections: {
    find_available_slots: { ai_tool: [[{ node: 'MCP Server Trigger', type: 'ai_tool', index: 0 }]] },
    book_meeting:         { ai_tool: [[{ node: 'MCP Server Trigger', type: 'ai_tool', index: 0 }]] },
    list_my_schedule:     { ai_tool: [[{ node: 'MCP Server Trigger', type: 'ai_tool', index: 0 }]] },
    'When Executed by Another Workflow': { main: [[{ node: 'Prep Request', type: 'main', index: 0 }]] },
    'Prep Request':     { main: [[{ node: 'Get Busy Events',  type: 'main', index: 0 }]] },
    'Get Busy Events':  { main: [[{ node: 'Expand Days',      type: 'main', index: 0 }]] },
    'Expand Days':      { main: [[{ node: 'Get Prayer Times', type: 'main', index: 0 }]] },
    'Get Prayer Times': { main: [[{ node: 'Compute Slots',    type: 'main', index: 0 }]] },
  },
  settings: { executionOrder: 'v1' },
  pinData: {},
};

const outPath = path.join(ROOT, 'workflow', 'smart-booking-mcp.json');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(workflow, null, 2) + '\n');
console.log('wrote', path.relative(ROOT, outPath), '—', workflow.nodes.length, 'nodes');
