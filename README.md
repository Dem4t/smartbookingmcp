# Smart Booking MCP — prayer aware

An [n8n](https://n8n.io) **MCP server** that lets an AI assistant book meetings around both
your Google Calendar *and* the five daily prayer times. Point Claude (or any MCP client) at
the server's SSE endpoint and it gets three tools:

| Tool | What it does |
|---|---|
| `find_available_slots` | returns free slots that avoid busy events **and** prayer windows |
| `book_meeting` | creates the event on Google Calendar |
| `list_my_schedule` | reads back what's already booked |

Prayer times come from the [AlAdhan API](https://aladhan.com/prayer-times-api) (default:
Umm Al-Qura, method `4`), so the blocked windows shift correctly day by day.

## How it works

```
MCP Server Trigger ──┬─ find_available_slots ──► sub-workflow:
                     │      Prep Request  →  Get Busy Events (Google Calendar)
                     │                    →  Expand Days
                     │                    →  Get Prayer Times (AlAdhan)
                     │                    →  Compute Slots
                     ├─ book_meeting       (Google Calendar tool)
                     └─ list_my_schedule   (Google Calendar tool)
```

The scheduling logic lives in **`src/availability-engine.js`** as a pure function, so it can be
unit-tested with plain `node --test` outside n8n. `scripts/build-workflow.js` inlines that
engine into the workflow's Code node and emits `workflow/smart-booking-mcp.json`.

**The generated JSON is a build artifact — edit the files in `src/`, then rebuild.**

## Defaults

Set in `src/nodes/prep.js`, all overridable per tool call:

| Setting | Default |
|---|---|
| working hours | 09:00–18:00 |
| meeting length | 30 min |
| buffer around busy blocks | 10 min |
| days scanned | 5 |
| weekend skipped | Friday + Saturday |
| timezone | `+03:00` (Riyadh, no DST) |
| prayer method | `4` (Umm Al-Qura) |

## Usage

```bash
npm test     # 31 unit + integrity tests, no network, no n8n needed
npm run build  # regenerate workflow/smart-booking-mcp.json from src/
```

To point the build at your own n8n credential and calendar:

```bash
cp .env.example .env   # then edit
CALENDAR_ID='you@example.com' \
GOOGLE_CALENDAR_CREDENTIAL_ID='xxxxxxxxxxxx' \
  npm run build
```

Then in n8n: **Workflows → Import from File → `workflow/smart-booking-mcp.json`**, attach your
Google Calendar OAuth2 credential, activate, and copy the MCP Server Trigger's SSE URL into
your MCP client config.

## Tests

`test/` runs the engine directly and also executes the workflow's Code nodes inside a small
n8n sandbox (`test/helpers/n8n-sandbox.js`), plus a workflow-integrity check that the built
JSON still matches `src/`. Requires Node 18+.

## License

MIT
