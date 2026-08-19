const { test } = require('node:test');
const assert = require('node:assert');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const WF = path.join(ROOT, 'workflow', 'smart-booking-mcp.json');
const wf = JSON.parse(fs.readFileSync(WF, 'utf8'));
const names = wf.nodes.map(n => n.name);

test('the committed workflow is what the build script produces', () => {
  const before = fs.readFileSync(WF, 'utf8');
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-workflow.js')], { cwd: ROOT });
  assert.strictEqual(fs.readFileSync(WF, 'utf8'), before,
    'workflow/smart-booking-mcp.json is stale — run `npm run build`');
});

test('node names and ids are unique', () => {
  assert.strictEqual(new Set(names).size, names.length);
  const ids = wf.nodes.map(n => n.id);
  assert.strictEqual(new Set(ids).size, ids.length);
});

test('every connection points at a node that exists', () => {
  for (const [source, conn] of Object.entries(wf.connections)) {
    assert.ok(names.includes(source), `unknown source node: ${source}`);
    for (const groups of Object.values(conn))
      for (const group of groups)
        for (const link of group)
          assert.ok(names.includes(link.node), `unknown target node: ${link.node}`);
  }
});

test('all three tools are exposed on the MCP trigger', () => {
  for (const tool of ['find_available_slots', 'book_meeting', 'list_my_schedule']) {
    const link = wf.connections[tool].ai_tool[0][0];
    assert.strictEqual(link.node, 'MCP Server Trigger');
    assert.strictEqual(link.type, 'ai_tool');
  }
});

test('the engine branch is a single unbroken chain', () => {
  const chain = ['When Executed by Another Workflow', 'Prep Request', 'Get Busy Events',
                 'Expand Days', 'Get Prayer Times', 'Compute Slots'];
  for (let i = 0; i < chain.length - 1; i++)
    assert.strictEqual(wf.connections[chain[i]].main[0][0].node, chain[i + 1]);
  assert.ok(!wf.connections['Compute Slots'], 'Compute Slots is the end of the chain');
});

test('every Code node contains valid JavaScript', () => {
  for (const n of wf.nodes.filter(n => n.type === 'n8n-nodes-base.code')) {
    assert.doesNotThrow(
      () => new vm.Script('(function(){' + n.parameters.jsCode + '})'),
      `syntax error in the "${n.name}" node`);
  }
});

test('find_available_slots calls this same workflow', () => {
  const tool = wf.nodes.find(n => n.name === 'find_available_slots');
  assert.strictEqual(tool.parameters.source, 'database');
  assert.strictEqual(tool.parameters.workflowId.value, '={{ $workflow.id }}');
});

test('the tool schema matches the inputs the engine trigger declares', () => {
  const declared = wf.nodes.find(n => n.name === 'When Executed by Another Workflow')
    .parameters.workflowInputs.values.map(v => v.name).sort();
  const mapped = wf.nodes.find(n => n.name === 'find_available_slots')
    .parameters.workflowInputs.schema.map(s => s.id).sort();
  assert.deepEqual(declared, mapped);
});

test('Get Busy Events keeps emitting an item when the calendar is empty', () => {
  const node = wf.nodes.find(n => n.name === 'Get Busy Events');
  assert.strictEqual(node.alwaysOutputData, true,
    'without this the chain stops on a free day and returns no slots at all');
});

test('list_my_schedule uses a fixed range, not $fromAI placeholders', () => {
  // n8n does not surface $fromAI arguments declared inside the Google Calendar
  // node's `options` collection, so they would reach the API unresolved.
  const opts = wf.nodes.find(n => n.name === 'list_my_schedule').parameters.options;
  for (const key of ['timeMin', 'timeMax']) {
    assert.ok(opts[key].startsWith('={{'), `${key} must be an n8n expression`);
    assert.ok(!opts[key].includes('$fromAI'), `${key} must not rely on $fromAI`);
  }
});

test('every $fromAI argument sits where n8n can surface it', () => {
  const tools = wf.nodes.filter(n => /Tool$|toolWorkflow$/.test(n.type));
  assert.ok(tools.length >= 3);
  const found = JSON.stringify(tools).match(/\$fromAI\('([a-z_]+)'/g) || [];
  assert.ok(found.length > 0, 'the tools must expose at least some model-filled arguments');
});
