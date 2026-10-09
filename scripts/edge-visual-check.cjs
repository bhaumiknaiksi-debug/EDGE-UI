// Isolated browser fixtures: no broker, push enrollment, or live API calls.
const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=process.cwd();
const server=http.createServer(async(req,res)=>{
  try {const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':'text/plain');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
});
function fixture(state){
 const closed=['CLOSED','PRE_OPEN'].includes(state),stale=state==='STALE';
 const now=Date.now(),timestamp=new Date(now-(stale?240000:closed?3600000:0)).toISOString();
 const ready=state==='READY_TO_EXECUTE';
 const d={timestamp,spot:25482.6,expiry:'2026-10-13',dte:4,bias:'BULLISH',biasLabel:'Buyers leading',ivRegime:'NORMAL',confidence:60,signalQuality:60,pcr:1.1,avgIV:14,support:{strike:25300},resistance:{strike:25500},alphas:[],market:{phase:closed?state:'OPEN',context:{sessionHigh:25510,sessionLow:25320,sessionChangePct:0.56,futures:{buildup:'LONG_BUILDUP'}},chartIntelligence:{verdict:'BULLISH',previousDay:{high:25490,low:25280,close:25340.25},story:{headline:'Buyers lead, with resistance still overhead.',points:['The 5-minute structure supports buyers.','Participation is above its recent average.']},participation:{state:'ABOVE_RECENT_AVERAGE',relativeVolume:1.25}}},decision:{strategy:'LONG_CALL',reason:'Directional setup under evaluation',entry:{status:ready?'READY_TO_ENTER':'WAIT_FOR_TRIGGER',triggerReady:ready,priceReady:true,liquidityReady:true,reason:'Wait for resistance reclaim.',trigger:'Wait for spot to reclaim resistance with positive momentum.',invalidation:['Spot loses the reclaimed structure']},orchestration:{status:closed?'MARKET_CLOSED':state,executionAllowed:ready,blockers:ready?[]:closed?['MARKET_NOT_OPEN']:['ENTRY_TRIGGER_NOT_CONFIRMED']},signalTier:{tier:ready?'A':'B',executionAllowed:ready,failedGates:ready?[]:['TRIGGER']},researchCandidatePlans:{plans:{A:{available:true,strategy:'LONG_CALL',executionAllowed:ready,backendStatus:ready?'READY_TO_EXECUTE':state,description:'Authoritative long call',legs:{buyLeg:{contractId:'NIFTY 13 OCT 25450 CE',strike:25450,type:'CE',ask:112,bid:110,premium:111}}},B:{available:true,strategy:'BULL_CALL_SPREAD',description:'Research-only spread selected near delta targets',legs:{buyLeg:{contractId:'NIFTY 13 OCT 25450 CE',strike:25450,type:'CE',ask:112,bid:110},sellLeg:{contractId:'NIFTY 13 OCT 25550 CE',strike:25550,type:'CE',ask:62,bid:60}}},C:{available:false}}}}};
 return {data:d,market:{phase:closed?state:'OPEN',lastFetch:Date.parse(timestamp),liveDataFresh:!stale&&!closed,nextOpen:new Date(now+86400000).toISOString()},history:{entries:[-30,-20,-10,0].map((x,i)=>({ts:new Date(Date.parse(timestamp)+x*60000).toISOString(),spot:[25410,25460,25430,25482.6][i],bias:'BULLISH',confidence:60}))}};
}
(async()=>{
 await fs.mkdir('visual-results',{recursive:true});
 await new Promise(r=>server.listen(8765,'127.0.0.1',r));
 const browser=await chromium.launch();
 try {
  for(const width of [320,390,768,1280]){
   const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block'});
   let current=fixture('CLOSED');const errors=[];
   await context.addInitScript(m=>{window.edgeBackendMarketStatus=m;window.edgeBackendMarketStatusCheckedAt=Date.now();},current.market);
   await context.route('**/pwa.js',r=>r.fulfill({body:''}));await context.route('**/web-push.js',r=>r.fulfill({body:''}));
   await context.route('https://edge-backend-r1ng.onrender.com/**',r=>{const url=r.request().url();return r.fulfill({contentType:'application/json',body:JSON.stringify(url.endsWith('/data')?current.data:url.includes('/history')?current.history:{})});});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:8765');await page.waitForFunction(()=>document.getElementById('stitch-decision-state').textContent==='MARKET CLOSED');
   // Invoke the existing history refresh rather than wait for its periodic timer.
   await page.evaluate(()=>pollTimeline());await page.waitForFunction(()=>document.getElementById('stitch-chart-line').getAttribute('points').length>0);
   for(const mode of ['simple','pro']){
    await page.locator('[data-view-mode="'+mode+'"]').click();
    for(const tab of ['radar','trade','flow','lab']){
     await page.locator('[data-edge-tab="'+tab+'"]').click();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px ${mode}/${tab} overflow`);
     if(mode==='simple'){
      const id={radar:'simple-signal-terminal',trade:'stitch-signals',flow:'stitch-insights',lab:'edge-alert-settings'}[tab];assert.equal(await page.locator('#'+id).isVisible(),true,`${mode}/${tab} visible`);
      assert.equal(await page.locator('#edge-alert-settings').isVisible(),tab==='lab','Settings only in Control');
     }
     if(width===390)await page.screenshot({path:`visual-results/${mode}-${tab}.png`,fullPage:true});
    }
   }
   if(width===390){
    await page.locator('[data-view-mode="simple"]').click();await page.locator('[data-edge-tab="radar"]').click();
    for(const state of ['READY_TO_EXECUTE','WAIT_FOR_TRIGGER','WAIT_FOR_PRICE','WAIT_FOR_LIQUIDITY','POSITION_BLOCKED','READY_INVALIDATED','NO_TRADE','STALE','PRE_OPEN']){
     current=fixture(state);await page.evaluate(f=>{window.edgeBackendMarketStatus=f.market;window.edgeBackendMarketStatusCheckedAt=Date.now();lastData=f.data;updateMarketStatusUI();renderSimpleSignals(f.data);},current);
     const title=await page.locator('#stitch-decision-state').textContent();assert.equal(title==='BUY NOW',state==='READY_TO_EXECUTE',state+' execution presentation');
     await page.screenshot({path:`visual-results/state-${state}.png`,fullPage:true});
    }
    await page.locator('[data-edge-tab="trade"]').click();await page.locator('[data-stitch-filter="READY"]').click();assert.match(await page.locator('#stitch-matrix').textContent(),/No ready candidates/);
    await page.locator('[data-edge-tab="radar"]').click();await page.locator('.stitch-intelligence summary').first().click();assert.equal(await page.locator('#stitch-intel-direction-copy').isVisible(),true);
   }
   assert.deepEqual(errors,[],`${width}px JavaScript errors`);await context.close();
  }
  console.log('PASS: four viewport widths, both modes, all tabs, nine execution states, chart, filters, and disclosures');
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
