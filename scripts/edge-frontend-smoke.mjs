import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [html, push, worker] = await Promise.all([
  readFile("index.html", "utf8"),
  readFile("web-push.js", "utf8"),
  readFile("sw.js", "utf8")
]);

// Compile every inline script: native app/PWA JavaScript syntax must remain valid.
let inlineCount = 0;
for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
  if (!match[1].trim()) continue;
  new vm.Script(match[1], { filename: "index.html inline script" });
  inlineCount++;
}
assert.ok(inlineCount >= 1);
new vm.Script(push, { filename: "web-push.js" });
new vm.Script(worker, { filename: "sw.js" });

const alerts = html.indexOf('id="edge-alert-settings"');
const radar = html.indexOf('id="tab-radar"');
assert.ok(alerts > 0 && alerts < radar, "Alert controls must remain outside market-data tabs");
assert.match(html, /<details class="edge-alerts-entry"/);
assert.match(html, /id="edge-push-slot"/);
assert.match(push, /slot\.replaceChildren\(box\)/);
assert.match(push, /Promise\.race\(/, "Service-worker readiness must have a bounded timeout");
assert.match(worker, /edge-shell-v4/, "Users must get a refreshed PWA shell");
assert.doesNotMatch(worker, /cache\.put\("\/index\.html", copy\)[\s\S]{0,200}\/\//, "unexpected cache code");

// Execute the real polling implementation with a controllable fake network.
const begin = html.indexOf("  // -- Polling ----------------------------------------------------------------");
const finish = html.indexOf("  // -- Main render", begin);
assert.ok(begin > 0 && finish > begin);
const implementation = html.slice(begin, finish);
assert.doesNotMatch(implementation, /setInterval\(fetchData/, "Recurring polls cannot abort in-flight requests");
let timerId = 0;
const timers = new Map();
const requests = [];
const statuses = [];
let rendered = 0;
let aborted = 0;
class FakeAbortController {
  constructor() { this.signal = { aborted: false }; }
  abort() { if (!this.signal.aborted) { this.signal.aborted = true; aborted++; } }
}
const sandbox = {
  AbortController: FakeAbortController,
  setTimeout(callback, delay) { const id = ++timerId; timers.set(id, { callback, delay }); return id; },
  clearTimeout(id) { timers.delete(id); },
  fetch(url, options) { return new Promise((resolve, reject) => requests.push({url, options, resolve, reject})); },
  setStatus(status) { statuses.push(status); },
  setText() {},
  nowStr() { return "12:00:00"; },
  render() { rendered++; },
  window: { addEventListener() {} },
  document: { addEventListener() {}, getElementById() { return null; }, visibilityState: "visible" },
  Date,
  BACKEND: "https://example.test"
};
vm.createContext(sandbox);
vm.runInContext(`
var pollTimer, activeFetchController = null, pollGeneration = 0;
var pollDelay = 5000, maxPollWaitMs = 60000;
var consecutiveFails = 0, lastDataTime = 0, lastData = null;
` + implementation, sandbox);

sandbox.startPolling();
assert.equal(requests.length, 1);
assert.equal(timers.size, 1, "Only the 60-second watchdog should run during an in-flight fetch");
assert.equal([...timers.values()][0].delay, 60000);
assert.equal(aborted, 0);
assert.equal(requests[0].options.cache, "no-store");

// A 15-second cold-start response must be allowed to finish, without a 5-second abort.
requests[0].resolve({ ok: true, json: async () => ({spot:12345}) });
for(let i=0; i<15; i++) await Promise.resolve();
assert.equal(rendered, 1, "Finished cold start must render");
assert.equal(statuses.at(-1), "live");
assert.equal(aborted, 0, "No automatic abort before watchdog");
const nextPoll = [...timers.values()].find(t=>t.delay===5000);
assert.ok(nextPoll, "Schedule next poll only after successful completion");
nextPoll.callback();
assert.equal(requests.length, 2);
assert.equal(aborted, 0);

// Explicit reconnect is allowed to replace a pending request.
sandbox.forceReconnect();
assert.equal(requests.length, 3);
assert.equal(aborted, 1);
assert.equal(requests[1].options.signal.aborted, true);
console.log("EDGE frontend: syntax, accessible alerts and non-overlapping polling PASS");
