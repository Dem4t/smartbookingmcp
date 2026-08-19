/**
 * Minimal stand-in for the n8n Code-node runtime, so the node sources in
 * src/nodes/ can be executed by the test suite exactly as n8n would run them.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const wrap = items => items.map(json => ({ json }));

function runNode(relPath, { input = [], prev = {}, prelude = '' } = {}) {
  const src = prelude + fs.readFileSync(path.join(__dirname, '..', '..', relPath), 'utf8');
  const ctx = {
    console, Date, Number, String, Math, JSON, Array, Object, RegExp, Boolean, Error,
    $input: { all: () => wrap(input), first: () => ({ json: input[0] || {} }) },
    $: name => ({
      first: () => ({ json: (prev[name] || [{}])[0] }),
      all:   () => wrap(prev[name] || []),
    }),
  };
  return vm.runInNewContext('(function(){' + src + '})', ctx, { filename: relPath })();
}

/** The engine is inlined into the Compute Slots node by scripts/build-workflow.js. */
function enginePrelude() {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'src/availability-engine.js'), 'utf8')
    .split('\n').filter(l => !l.startsWith('if (typeof module')).join('\n');
}

module.exports = { runNode, enginePrelude, wrap };
