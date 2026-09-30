'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const validation = html.slice(html.indexOf('  function validStrategyName('), html.indexOf('  function renderTimeline('));
const renderer = html.slice(html.indexOf('  function round2('), html.indexOf('  function renderIntel('));
function render(data) {
  const elements = Object.fromEntries(['decision-block', 'decision-card', 'decision-action', 'risk-table-wrap'].map(id => [id, {style: {}, innerHTML: 'stale card'}]));
  const context = {
    document: {getElementById: id => elements[id] || null},
    setSafeHTML: (el, value) => { el.innerHTML = value; },
    setText: () => {}
  };
  vm.createContext(context);
  vm.runInContext(validation + renderer, context);
  context.renderDecision(data, data.decision, 80, 'BULLISH', 'LOW');
  return {markup: elements['risk-table-wrap'].innerHTML, action: elements['decision-action'].textContent};
}
function fixture(status = 'READY_TO_EXECUTE') {
  return {
    orchestration: {status, executionAllowed: status === 'READY_TO_EXECUTE'},
    decision: {
      strategy: 'LONG_CALL',
      tradeLegs: {single: true, entry: 100, target: 150, stopLoss: 75},
      entry: {triggerReady: true, priceReady: true, execution: {current: 101}, timing: {validForMinutes: 5}}
    }
  };
}
test('WAIT_FOR_TRIGGER renders escaped trigger text and a complete, non-stale risk table', () => {
  const d = fixture('WAIT_FOR_TRIGGER');
  d.decision.entry.triggerReady = false;
  d.decision.entry.trigger = `NIFTY < 23000 & "hold" > 'low' <img src=x onerror=alert(1)>`;
  const {markup, action} = render(d);
  assert.equal(action, 'WAIT FOR TRIGGER');
  assert.match(markup, /NIFTY &lt; 23000 &amp; &quot;hold&quot; &gt; &#039;low&#039; &lt;img src=x onerror=alert\(1\)&gt;/);
  for (const label of ['TARGET', 'STOP-LOSS', 'MARKET TRIGGER', 'PRICE CHECK', 'STATUS', 'STARTS ON TRIGGER']) assert.ok(markup.includes(label));
  assert.doesNotMatch(markup, /BUY NOW|TRIGGER CONFIRMED|stale card|<img/);
});
test('final blocked and waiting states override both true entry booleans', () => {
  for (const status of ['POSITION_BLOCKED', 'MARKET_CLOSED', 'NO_TRADE', 'WAIT_FOR_TRIGGER', 'WAIT_FOR_ENTRY', 'WAIT_FOR_PRICE']) {
    const d = fixture(status);
    d.orchestration.executionAllowed = true; // inconsistent payload must still be blocked
    const {markup, action} = render(d);
    assert.match(markup, /CURRENT PREMIUM/);
    assert.ok(markup.includes(action));
    assert.doesNotMatch(markup, /BUY NOW|TRIGGER CONFIRMED/, status);
  }
});
test('purchase instruction requires all four explicit gates', () => {
  assert.match(render(fixture()).markup, /BUY NOW/);
  assert.match(render(fixture()).markup, /TRIGGER CONFIRMED/);
  for (const change of [
    d => { delete d.orchestration; },
    d => { d.orchestration.status = 'UNKNOWN'; },
    d => { d.orchestration.status = 'EXECUTE'; }, // EXECUTE is a UI status, not a backend grant
    d => { d.orchestration.executionAllowed = false; },
    d => { delete d.orchestration.executionAllowed; },
    d => { d.decision.entry.triggerReady = false; },
    d => { d.decision.entry.priceReady = false; },
    d => { d.decision.entry.triggerReady = 'true'; }
  ]) {
    const d = fixture(); change(d);
    assert.doesNotMatch(render(d).markup, /BUY NOW|TRIGGER CONFIRMED/);
  }
});
test('nested orchestration takes precedence; top-level legacy shape remains supported', () => {
  const d = fixture();
  d.decision.orchestration = {status: 'POSITION_BLOCKED', executionAllowed: false};
  assert.equal(render(d).action, 'POSITION BLOCKED');
  assert.doesNotMatch(render(d).markup, /BUY NOW|TRIGGER CONFIRMED/);
  d.decision.orchestration = d.orchestration;
  delete d.orchestration;
  assert.match(render(d).markup, /BUY NOW/);
});
test('reference commit trigger-wait semantics and one-sided price limits survive', () => {
  const d = fixture('WAIT_FOR_ENTRY');
  d.decision.entry.triggerReady = false;
  d.decision.entry.premium = {acceptableMax: 105};
  const result = render(d);
  assert.equal(result.action, 'WAIT FOR TRIGGER');
  assert.match(result.markup, /DO-NOT-CHASE LIMIT/);
  assert.match(result.markup, /≤ 105/);
  assert.match(result.markup, /STARTS ON TRIGGER/);
});
test('all inline scripts parse', () => {
  for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) new vm.Script(match[1]);
});
