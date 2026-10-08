'use strict';
// Read-only public smoke test. Never enroll a device, send pushes, or change trades.
const BACKEND = 'https://edge-backend-r1ng.onrender.com';
const FRONTEND = 'https://edge-backend-mbcs.vercel.app';

async function retrieve(url, maxWait = 100000) {
  const response = await fetch(url, {
    cache: 'no-store', redirect: 'follow',
    signal: AbortSignal.timeout(maxWait)
  });
  const text = await response.text();
  return { response, text };
}
function assert(ok, message) {
  if (!ok) throw new Error(message);
}
async function getJson(url) {
  const r = await retrieve(url);
  assert(r.response.ok, 'HTTP ' + r.response.status + ' on ' + new URL(url).pathname);
  let json;
  try { json = JSON.parse(r.text); } catch(_) { throw new Error('Invalid JSON on ' + new URL(url).pathname); }
  return json;
}
async function main() {
  const shell = await retrieve(FRONTEND + '/?edge_smoke=' + Date.now());
  assert(shell.response.ok, 'Deployed EDGE frontend unavailable: HTTP ' + shell.response.status);
  assert(shell.text.includes('id="edge-alert-settings"'), 'Deployed HTML is missing Lock Screen Alerts entry');
  assert(shell.text.includes('id="edge-refresh-app"'), 'Deployed HTML is missing Update & Reload');
  assert(shell.text.includes('/web-push.js'), 'Deployed HTML is missing push UI loader');
  console.log('PASS deployed EDGE HTML: alerts, refresh and script present');

  const sw = await retrieve(FRONTEND + '/sw.js');
  assert(sw.response.ok && sw.text.includes('edge-shell-v5'), 'Deployed service worker is outdated');
  console.log('PASS deployed service worker version v5');
  const js = await retrieve(FRONTEND + '/web-push.js');
  assert(js.response.ok && js.text.includes('ENABLE ALERTS'), 'Deployed push interface script missing');
  console.log('PASS deployed push settings script');

  const root = await getJson(BACKEND + '/');
  assert(String(root.status||'').includes('EDGE'), 'Backend did not return an EDGE heartbeat');
  console.log('PASS Render backend heartbeat; phase=' + root.phase + '; tokenExpired=' + !!root.tokenExpired);

  const market = await getJson(BACKEND + '/api/v1/market/status');
  assert(!!market.phase && !!market.serverTime, 'Backend market-status payload invalid');
  console.log('PASS market status: phase=' + market.phase + '; hasLastFetch=' + !!market.lastFetch);

  const push = await getJson(BACKEND + '/api/v1/push/config');
  assert(push.enabled === true && typeof push.publicKey === 'string' && push.publicKey.length >= 80,
    'Web Push backend has not initialized successfully');
  console.log('PASS Web Push backend configuration; autoAlerts=' + !!push.autoAlerts);
  assert(push.autoAlerts === false, 'Automatic trading alerts must remain disabled');

  // Dashboard may return 503 during a cold start; retry rather than falsely
  // treating a single initial 503 as a dead server.
  let data, lastCode;
  for(let attempt=0;attempt<4;attempt++){
    const r=await retrieve(BACKEND+'/api/v1/dashboard');
    lastCode=r.response.status;
    if(r.response.ok){
      try{data=JSON.parse(r.text)}catch(_){}
      break;
    }
    if(lastCode!==503)break;
    await new Promise(resolve=>setTimeout(resolve,12000));
  }
  if(market.phase==='OPEN'){
    assert(!!data,'Market OPEN but dashboard did not recover (last HTTP '+lastCode+')');
    const ts=Date.parse(String(data.timestamp||''));
    assert(Number.isFinite(ts) && Date.now()-ts < 120000 && Date.now()-ts >= -20000,
      'Dashboard returned an outdated live snapshot');
    console.log('PASS fresh market dashboard while OPEN');
  }else{
    console.log('PASS market ' + market.phase + ': dashboard response HTTP ' + lastCode + ' (historical data permitted)');
  }
}
main().catch(e=>{console.error('EDGE LIVE SMOKE FAILED: '+e.message);process.exitCode=1;});
