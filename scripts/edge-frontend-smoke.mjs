import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const [html, push, worker, pwa, vercel] = await Promise.all([
  readFile("index.html", "utf8"),
  readFile("web-push.js", "utf8"),
  readFile("sw.js", "utf8"),
  readFile("pwa.js", "utf8"),
  readFile("vercel.json", "utf8")
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
new vm.Script(pwa, { filename: "pwa.js" });

const alerts = html.indexOf('id="edge-alert-settings"');
const radar = html.indexOf('id="tab-radar"');
assert.ok(alerts > 0 && alerts < radar, "Alert controls must remain outside market-data tabs");
assert.match(html, /<details class="edge-alerts-entry"/);
assert.match(html, /id="edge-push-slot"/);
assert.match(push, /slot\.replaceChildren\(box\)/);
assert.match(push, /Promise\.race\(/, "Service-worker readiness must have a bounded timeout");
assert.match(worker, /edge-shell-v5/, "Users must get a refreshed PWA shell");
assert.match(worker, /fetch\(request, \{ cache: "no-store" \}\)/, "PWA should prefer uncached app shell and JS");
assert.match(html, /id="edge-refresh-app"/, "Update/reload control must be accessible outside tabs");
assert.match(pwa, /edgeApplyMarketStatus/, "Market status must be applied from the backend");
assert.match(html, /window\.edgeApplyMarketStatus=updateMarketStatusUI/, "UI must expose authoritative market status");
assert.doesNotMatch(html.slice(html.indexOf("  function updateMarketStatusUI()"),html.indexOf("  function startMarketStatusTimer()")), /status=getMarketStatus\(\)/, "Device clock must not set OPEN state");
const headers = JSON.parse(vercel).headers;
assert.ok(headers.some(x=>x.source==="/"&&x.headers.some(h=>/no-store/.test(h.value))), "Root HTML must revalidate");
assert.ok(headers.some(x=>x.source==="/sw.js"&&x.headers.some(h=>/no-store/.test(h.value))), "SW must revalidate");
assert.match(worker, /response\.ok && \(response\.headers\.get\("content-type"\)/,
  "Only valid HTML responses may update the cached app shell");

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
  window: { addEventListener() {}, edgeBackendMarketStatus: { phase: "OPEN" }, edgeBackendMarketStatusCheckedAt: Date.now() },
  navigator: { onLine: true },
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
requests[0].resolve({ ok: true, json: async () => ({spot:12345,timestamp:new Date().toISOString(),market:{phase:"OPEN"}}) });
for(let i=0; i<15; i++) await Promise.resolve();
assert.equal(rendered, 1, "Finished cold start must render");
assert.equal(statuses.at(-1), "live");
assert.equal(aborted, 0, "No automatic abort before watchdog");
const nextPoll = [...timers.values()].find(t=>t.delay===5000);
assert.ok(nextPoll, "Schedule next poll only after successful completion");
nextPoll.callback();
assert.equal(requests.length, 2);
assert.equal(aborted, 0);

// An HTTP 200 carrying a stale market snapshot is NOT live.
requests[1].resolve({ ok: true, json: async () => ({
  spot:12345,timestamp:new Date(Date.now()-180000).toISOString(),market:{phase:"OPEN"}
}) });
for(let i=0;i<18;i++) await Promise.resolve();
assert.equal(rendered, 1, "Stale snapshots must not be rendered as live");
assert.equal(statuses.at(-1), "stale", "Stale snapshot must be explicit");

const retry = [...timers.values()].find(t=>t.delay===5000);
assert.ok(retry, "Polling must continue after stale response");
retry.callback();
assert.equal(requests.length, 3);

// A previous OPEN-phase snapshot remains viewable as historical once the
// backend says the market is CLOSED, but may never be called LIVE.
sandbox.window.edgeBackendMarketStatus = { phase: "CLOSED" };
requests[2].resolve({ ok: true, json: async () => ({
  spot:12345,timestamp:new Date(Date.now()-3600000).toISOString(),market:{phase:"OPEN"}
}) });
for(let i=0;i<18;i++) await Promise.resolve();
assert.equal(rendered, 2, "Last-session history should remain viewable");
assert.equal(statuses.at(-1), "closed", "Historical data must not be labelled live");
const lastPoll=[...timers.values()].find(t=>t.delay===5000);
assert.ok(lastPoll);
lastPoll.callback();
assert.equal(requests.length, 4);

// Explicit reconnect is allowed to replace a pending request.
sandbox.forceReconnect();
assert.equal(requests.length, 5);
assert.equal(aborted, 1);
assert.equal(requests[3].options.signal.aborted, true);

assert.match(html, /id="edge-feed-health-note"/, "A distinct feed-outage panel must exist");
assert.ok(html.includes('var showClosed=verified && (phase==="CLOSED" || phase==="PRE_OPEN")'), "Do not render closed panel during live-feed failures");
assert.ok(html.includes('setText("last-session"'), "Closed-market last-session date must be updated");

// Evaluate actual market-status display transitions in isolation.
const statusStart=html.indexOf("  function updateMarketStatusUI() {");
const statusEnd=html.indexOf("  window.edgeApplyMarketStatus=updateMarketStatusUI;",statusStart);
assert.ok(statusStart>0&&statusEnd>statusStart);
const elements=new Map();
function getEl(id){
  if(!elements.has(id)){
    const classes=new Set();
    elements.set(id,{className:"",textContent:"",hidden:true,classList:{
      toggle(cls,present){if(present)classes.add(cls);else classes.delete(cls);},
      contains(cls){return classes.has(cls);}
    }});
  }
  return elements.get(id);
}
const healthContext={
  window:{edgeBackendMarketStatus:{
    phase:"OPEN",lastFetch:Date.now()-180000,nextOpen:null
  },edgeBackendMarketStatusCheckedAt:Date.now()},
  document:{getElementById:getEl},
  navigator:{onLine:true},
  Date,
  setText(id,value){getEl(id).textContent=String(value);}
};
vm.createContext(healthContext);
vm.runInContext(html.slice(statusStart,statusEnd),healthContext);
healthContext.updateMarketStatusUI();
assert.equal(getEl("market-badge-text").textContent,"FEED WAIT");
assert.equal(getEl("closed-panel").classList.contains("visible"),false,"Open market with stale feed must not show market-closed panel");
assert.equal(getEl("edge-feed-health-note").hidden,false,"Missing live feed requires visible warning");
assert.match(getEl("edge-feed-health-note").textContent,/LIVE DATA NOT CONFIRMED/);

healthContext.window.edgeBackendMarketStatus={
  phase:"CLOSED",
  lastFetch:Date.now()-3600000,
  nextOpen:new Date(Date.now()+86400000).toISOString()
};
healthContext.window.edgeBackendMarketStatusCheckedAt=Date.now();
healthContext.updateMarketStatusUI();
assert.equal(getEl("closed-panel").classList.contains("visible"),true,"Closed session may show last-session panel");
assert.equal(getEl("edge-feed-health-note").hidden,true);
assert.notEqual(getEl("last-session").textContent,"--","Historical session date must be populated");

console.log("EDGE frontend: syntax, accessible alerts and non-overlapping polling PASS");
