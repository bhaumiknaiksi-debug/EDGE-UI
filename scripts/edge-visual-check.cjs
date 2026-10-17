// Isolated browser fixtures: no broker, push enrollment, or live API calls.
const {chromium}=require('playwright');
const http=require('node:http');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const root=process.cwd();
const server=http.createServer(async(req,res)=>{
  try {const pathname=new URL(req.url,'http://localhost').pathname;const file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));if(!file.startsWith(root+path.sep))throw Error('Invalid path');res.setHeader('Content-Type',file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/plain');res.end(await fs.readFile(file));}catch{res.writeHead(404);res.end();}
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
   const context=await browser.newContext({viewport:{width,height:844},serviceWorkers:'block',reducedMotion:'reduce'});
   let current=fixture('CLOSED');const errors=[];
   await context.addInitScript(m=>{window.edgeBackendMarketStatus=m;window.edgeBackendMarketStatusCheckedAt=Date.now();},current.market);
   await context.route('**/pwa.js',r=>r.fulfill({body:''}));await context.route('**/web-push.js',r=>r.fulfill({body:''}));
   await context.route('https://edge-backend-r1ng.onrender.com/**',r=>{const url=r.request().url();return r.fulfill({contentType:'application/json',body:JSON.stringify(url.endsWith('/data')?current.data:url.includes('/history')?current.history:{})});});
   const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
   await page.goto('http://127.0.0.1:8765');await page.waitForFunction(()=>document.getElementById('stitch-decision-state').textContent==='MARKET CLOSED');
   // Invoke the existing history refresh rather than wait for its periodic timer.
   await page.evaluate(()=>pollTimeline());await page.waitForFunction(()=>document.getElementById('stitch-chart-line').getAttribute('points').length>0);
   assert.equal(await page.locator('#stitch-chart-svg').isVisible(),true,'The populated chart must be visibly rendered');
   for(const mode of ['simple','pro']){
    await page.locator('[data-view-mode="'+mode+'"]').click();
    for(const tab of ['radar','trade','lab']){
     await page.locator('[data-edge-tab="'+tab+'"]').click();
     assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width}px ${mode}/${tab} overflow`);
     if(mode==='simple'){
      const id={radar:'simple-signal-terminal',trade:'stitch-signals',lab:'edge-alert-settings'}[tab];assert.equal(await page.locator('#'+id).isVisible(),true,`${mode}/${tab} visible`);
      assert.equal(await page.locator('#edge-alert-settings').isVisible(),tab==='lab','Settings only in Control');
     }
     if(width===390)await page.screenshot({path:`visual-results/${mode}-${tab}.png`,fullPage:true});
    }
   }
   if(width===390){
    await page.locator('[data-edge-tab="radar"]').click();
     assert.equal(await page.locator('#edge-market-context').isVisible(),true,'Market Context available on Home');
     assert.equal(await page.locator('#stitch-insights').isVisible(),false,'Market Context collapsed by default');
     await page.locator('#edge-market-context > summary').click();
     assert.equal(await page.locator('#stitch-insights').isVisible(),true,'Existing insights appear on demand');
     await page.screenshot({path:'visual-results/home-market-context.png',fullPage:true});
     await page.locator('#edge-market-context > summary').click();
     await page.locator('[data-edge-tab="lab"]').click();
     assert.equal(await page.locator('#edge-advanced-diagnostics').isVisible(),true,'Advanced section remains accessible');
     assert.equal(await page.locator('#funnel-stages').isVisible(),false,'Diagnostics collapsed by default');
     await page.screenshot({path:'visual-results/control-viewport.png'});
    await page.locator('[data-view-mode="simple"]').click();await page.locator('[data-edge-tab="radar"]').click();
    for(const state of ['READY_TO_EXECUTE','WAIT_FOR_TRIGGER','WAIT_FOR_PRICE','WAIT_FOR_LIQUIDITY','POSITION_BLOCKED','READY_INVALIDATED','NO_TRADE','STALE','PRE_OPEN']){
     current=fixture(state);await page.evaluate(f=>{window.edgeBackendMarketStatus=f.market;window.edgeBackendMarketStatusCheckedAt=Date.now();lastData=f.data;updateMarketStatusUI();renderSimpleSignals(f.data);},current);
     const title=await page.locator('#stitch-decision-state').textContent();assert.equal(title==='BUY NOW',state==='READY_TO_EXECUTE',state+' execution presentation');
     await page.screenshot({path:`visual-results/state-${state}.png`,fullPage:true});
    }
    await page.locator('[data-edge-tab="trade"]').click();await page.locator('[data-stitch-filter="READY"]').click();assert.match(await page.locator('#stitch-matrix').textContent(),/No ready candidates/);
    await page.locator('[data-edge-tab="radar"]').click();await page.locator('.stitch-intelligence summary').first().click();assert.equal(await page.locator('#stitch-intel-direction-copy').isVisible(),true);
   }
   if(width===390){
    await page.locator('[data-edge-tab="lab"]').click();
    const journal={budget:{availableCapital:10000,netRealizedPnl:0,openRisk:0,availableRisk:1000,confirmed:false,locked:false},trades:[]};let posts=[];
    await context.route('**/api/v1/trades**',async r=>{assert.equal(r.request().headers().authorization,'Bearer test-owner-code');if(r.request().method()==='POST'){const d=r.request().postDataJSON();posts.push(d);if(r.request().url().endsWith('/open'))journal.trades=[{...d,id:d.requestId,reservedRisk:750}];if(r.request().url().endsWith('/close'))journal.trades[0]={...journal.trades[0],closedAt:new Date().toISOString(),netPnl:550};if(r.request().url().endsWith('/confirm'))journal.budget.confirmed=true;
      if(r.request().url().endsWith('/import')){
        assert.equal(d.clientId,'TEST123');
        assert.equal(d.fills.length,2);
        assert.equal(d.fills[0].symbol,'NIFTY26O1322500CE');
        assert.equal(d.fills[0].time,'2026-10-09T12:10:56');
        journal.broker={summary:{importedFills:2,completedTrades:1,grossPnl:926.25,openBuyQuantity:0,unmatchedSellQuantity:0,affectsRiskLedger:false},
          episodes:[{symbol:'NIFTY26O1322500CE',quantity:65,entry:124.90,exit:139.15,
            openedAt:'2026-10-09T12:10:56',closedAt:'2026-10-09T12:58:16',grossPnl:926.25,netPnl:null,charges:null}]};
        journal.importResult={added:2,duplicates:0};
      }
      if(r.request().url().endsWith('/pnl')){
        assert.equal(d.clientId,'TEST123','P&L import must match protected account');
        assert.equal(d.startDate,'2026-10-10');
        assert.equal(d.endDate,'2026-10-17');
        assert.equal(d.grossPnl,2333.5);
        assert.equal(d.charges,99.1261);
        assert.equal(d.rows.length,2);
        journal.pnlResult={period:'2026-10-10_2026-10-17',unchanged:false,replaced:false};
        journal.pnl={affectsRiskLedger:false,reports:[{
          id:'2026-10-10_2026-10-17',startDate:'2026-10-10',endDate:'2026-10-17',
          grossPnl:2333.5,charges:99.1261,otherCredits:0,unrealizedPnl:0,netPnl:2234.37,
          symbols:2,matchedSymbols:0,unmatchedSymbols:2,items:[
           {kind:'PNL_ONLY',symbol:'NIFTY26O1322500CE',quantity:65,entry:48.25,exit:60.8,grossPnl:815.75,openedAt:null,closedAt:null,detail:'Tradebook needed for execution time'},
           {kind:'PNL_ONLY',symbol:'NIFTY26O1923100CE',quantity:65,entry:90.4,exit:113.75,grossPnl:1517.75,openedAt:null,closedAt:null,detail:'Tradebook needed for execution time'}
          ]
        }]};
      }}await r.fulfill({contentType:'application/json',body:JSON.stringify(journal)});});
    await page.locator('#journal-code').fill('test-owner-code');await page.locator('#journal-login button').click();await page.locator('#journal-private').waitFor({state:'visible'});
    assert.equal(await page.locator('#journal-code').inputValue(),'');
    assert.equal(await page.locator('#journal-login').isVisible(),false,'Owner code form must disappear after unlock');
    assert.equal(await page.locator('#journal-manual-tools').isVisible(),true,'Risk tools available but collapsed');
    assert.equal(await page.locator('#journal-open').isVisible(),false,'Manual entry is not part of the tradebook-first view');
    assert.equal(await page.locator('#journal-budget').isVisible(),false,'Capital and risk figures are not daily UI clutter');
    await page.locator('#journal-manual-tools > summary').click();
    await page.locator('#journal-reconciled').check();await page.locator('#journal-confirm button').click();await page.waitForFunction(()=>document.getElementById('journal-state').textContent.includes('confirmed'));
    await page.locator('#journal-entry-details > summary').click();
    for(const [name,value] of Object.entries({contract:'NIFTY 20 OCT 25000 CE',quantity:'65',entry:'100',stop:'90'}))await page.locator('#journal-open [name="'+name+'"]').fill(value);
    await page.locator('#journal-open button').click();await page.locator('.journal-trade').waitFor();assert.equal(posts.at(-1).quantity,65);assert.ok(posts.at(-1).requestId.length>=16);
    await page.locator('.journal-trade [name="exit"]').fill('110');await page.locator('.journal-trade [name="charges"]').fill('100');await page.locator('.journal-trade button').click();await page.waitForFunction(()=>document.getElementById('journal-trades').textContent.includes('Closed'));
    await page.locator('#journal-entry-details > summary').click();
    await page.locator('#journal-manual-tools > summary').click();
    // Synthetic XLSX mirrors Kite's row-15 header and shared-string tradebook layout.
    // Trade data and Client ID below are fake test fixtures, never the owner's account.
    await page.locator('#kite-import > summary').click();
    const postsBefore=posts.length;
    const sampleWorkbook=Buffer.from('UEsDBBQAAAAIAABKUV000ZEiJQEAAAQDAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWx9ksluwjAURX/Fyh48IKI2CkEVBCkb0irZdGnCK7EUO6mHCv6+RkhtZUOXPu/6vjFfn+WAvkAbMapVQuckWRe5MRZ5rswq6a2dMoxN14PkZj5OoHzkY9SSW//UJ2wmDfxoegArB8wISbHkQiWoG52yq4SlCXJKfDrY/ACfQhS5LTaDAGVRtc2xLXJ8hbdAWzYtZYsQNxd5GIeQVk21jww0PwLacgthpDx3PVeniDdwkr6YGGsB5r59e5kimxfXWT/LEL85rqywl5C/atFFHjf3eCq1PoJ+yMszdO6aG7VCRp77ate+s7SmC8aWhGzKUMAIS2eUzMhz9LWJxLs6JAcX9WZgiHZFCY0Rixq6I6vv6H5r9teSUZIt0/8ly6eM/pFgf+nFN1BLAwQUAAAACAAASlFdMLR4OUQBAADyBAAAGAAAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbH3U326CMBiH4VshPR+lCFQXwGRz7p/b0XYBBDs1k2Jaorv8dbpgf5+RM+ApX8hbIJ/+NNtgr4zdtLpgIoxYoHTdLjd6VbDPj/nNmE3L/NCab7tWqgvccm0Ltu663S3ntl6rprJhu1PayVdrmqpzp2bF7c6oanm8qdnyOIoy3lQbzcr8eG1WdVWZm/YQmIJJd7X+O7iTLOgKZt35voxyvi9zXv/bvW+iN+5m9INE2k9yh+flMRkFOEKcASaID4Ap4hwwQ3wElIhPgGPEZ8AJ4gugIM1eUQXqApVEekMlld5Rkyv7kZ33I/PXp7Q5aEajg0paHXRMy4Je1DupPu1YSuv5KuIknNCA/vBY0ICgFwFB0ysBz5+GkIMB5WBAORhQDgb0NY5oQDkY0FcxmoT0uRc4/eIVBE1oQdCMFOTef4b3P7DyF1BLAQIUAxQAAAAIAABKUV000ZEiJQEAAAQDAAAUAAAAAAAAAAAAAACAAQAAAAB4bC9zaGFyZWRTdHJpbmdzLnhtbFBLAQIUAxQAAAAIAABKUV0wtHg5RAEAAPIEAAAYAAAAAAAAAAAAAACAAVcBAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAIAAgCIAAAA0QIAAAAA','base64');
    await page.locator('#kite-file').setInputFiles({name:'kite-synthetic.xlsx',
      mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:sampleWorkbook});
    await page.waitForFunction(()=>document.getElementById('kite-preview-status').textContent.includes('2 NIFTY option fills found'));
    assert.equal(posts.length,postsBefore,'Preview must never write history before explicit confirmation');
    assert.equal(await page.locator('#kite-client').inputValue(),'TEST123');
    await page.locator('#kite-import-confirm').click();
    await page.waitForFunction(()=>document.getElementById('kite-import-status').textContent.includes('2 new fills'));
    assert.match(await page.locator('#kite-history-summary').textContent(),/1 trade · \+₹926\.25 gross/);
    assert.equal(await page.locator('#kite-import').getAttribute('open'),null,'Successful import closes the tall form automatically');
    assert.match(await page.locator('.kite-history-row .kite-instrument').textContent(),/NIFTY 50.*22500 CE/);
    assert.match(await page.locator('.kite-history-row .kite-date').textContent(),/09\/10/);
    assert.match(await page.locator('.kite-history-row .kite-type').textContent(),/Buy/);
    assert.match(await page.locator('.kite-history-row .kite-entry').textContent(),/₹124\.90/);
    assert.match(await page.locator('.kite-history-row .kite-exit').textContent(),/₹139\.15/);
    assert.match(await page.locator('.kite-history-row .kite-pnl.profit').textContent(),/\+₹926\.25/);
    assert.match(await page.locator('.journal-history-summary').textContent(),/Tradebook-only gross P&L · charges not included/);
    assert.equal(await page.locator('#journal-login').isVisible(),false,'Successful import must not revive auth form');
    assert.equal(await page.locator('#journal-manual-tools').getAttribute('open'),null,'Manual ledger stays collapsed after import');
    await page.locator('#journal-history-filter').selectOption('loss');
    assert.match(await page.locator('#kite-history-list').textContent(),/No trades match this filter/);
    await page.locator('#journal-history-filter').selectOption('all');
    assert.equal(journal.budget.availableCapital,10000,'Import cannot modify live risk ledger capital');
    assert.equal(posts.at(-1).requestId.length>=16,true,'Batch import uses an idempotent request ID');
    await page.locator('#kite-import > summary').click();
    const pbefore=posts.length;
    await page.locator('#kite-file').setInputFiles({name:'kite-pnl-synthetic.xlsx',
      mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer:Buffer.from('UEsDBBQAAAAIAOt1UV3xFeuZ/wEAALQGAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sjZVdb9sgGIX/CuJidzVf81dnu1KTuIo0NVuTTtolTWiMZuMIk3Tpr5+TWbHdQTvJF/DyHh6fAxLJze+qBAehG1mrFBIPQyDUut5ItU3h4yq/iiBoDFcbXtZKpPAoGniTJS+1/tUUQhjQ6lWTwsKY3TVCzboQFW+8eidUu/Jc64qbdqq3qNlpwTdnUVUiinGAKi4VzJJzbcoNzxJdvwCdwrCtrk+D2xACk0KpSqnE0ui2LpssMdmklEIZMJ8myGQJOhXRuhNNXKLVbLkilI0lqGVewIRcyO3Qvsu3T7zaffkKloYbUZ3+orUJ8nN1AZ51XQGKaXBFcPsBU/ez8D2y35N9l+mC661obJY7zSnOQxbHHqEBSdDBBgp6UOAALUwhNJhosZEGnI2BqXiSxkoOBmTsYPYHSlyH8yB4KV/FBnT5WlnhgEUZY57vAEY9MHIAH5X+H2T0sT3W05iLtjxWT3VpIzgl8+X83iKYOgXf91wZaY4W0cwput0fwQ9e7oVFlbvtiLJ0yu6csvcPeRxq3IcaO7a7n+ernzRYEEapj/FkZs3XpabYmm48OPCgv19djMNVRljg0Tct+bgl9qmHxx13o46I+F7ouMaf8SWDdvhBBjFlxJWBU23PoGt3ZDBa9aMweGswH3WELGZDh38zGLUQn4T/hoAGDwO6vDjZH1BLAQIUAxQAAAAIAOt1UV3xFeuZ/wEAALQGAAAYAAAAAAAAAAAAAACAAQAAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAEAAQBGAAAANQIAAAAA','base64')});
    await page.waitForFunction(()=>document.getElementById('kite-preview-status').textContent.includes('Kite P&L · 2026-10-10 to 2026-10-17'));
    assert.equal(posts.length,pbefore,'Viewing P&L report must never write history before confirmation');
    assert.match(await page.locator('#kite-preview-status').textContent(),/Net ₹2234\.37/);
    assert.equal(await page.locator('#kite-client').inputValue(),'TEST123');
    await page.locator('#kite-import-confirm').click();
    await page.waitForFunction(()=>document.getElementById('journal-status').textContent.includes('Kite P&L statement reconciled'));
    assert.equal(await page.locator('#kite-import').getAttribute('open'),null);
    assert.match(await page.locator('#kite-pnl-gross').textContent(),/₹2,333\.50/);
    assert.match(await page.locator('#kite-pnl-charges').textContent(),/₹99\.13/);
    assert.match(await page.locator('#kite-pnl-net').textContent(),/₹2,234\.37/);
    assert.equal(await page.locator('#kite-report-period').inputValue(),'2026-10-10_2026-10-17');
    assert.equal(await page.locator('.kite-history-row').count(),2,'Two instrument-level P&L results');
    assert.equal(await page.locator('.kite-history-row .kite-type').first().textContent(),'P&L');
    assert.match(await page.locator('.kite-history-row .kite-entry').first().textContent(),/≈₹/);
    assert.match(await page.locator('#kite-pnl-scope-note').textContent(),/Rows show gross P&L/);
    await page.screenshot({path:'visual-results/kite-pnl-reconciled-mobile.png',fullPage:true});
    await page.locator('#kite-report-period').selectOption('book');
    assert.match(await page.locator('#kite-history-summary').textContent(),/1 trade · \+₹926\.25 gross/);
    assert.equal(await page.locator('#kite-reconciled-totals').isVisible(),false,'Do not label Tradebook gross as broker net');
    assert.equal(journal.budget.availableCapital,10000,'Either import may not alter live risk');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'journal mobile overflow');
    await page.screenshot({path:'visual-results/kite-trade-history-mobile.png',fullPage:true});
    await page.screenshot({path:'visual-results/manual-trade-log.png',fullPage:true});
   }
   assert.deepEqual(errors,[],`${width}px JavaScript errors`);await context.close();
  }
  console.log('PASS: four viewport widths, both modes, three tabs, tradebook table, hidden owner/manual controls, XLSX import preview, nine execution states, chart, filters, and disclosures');
 } finally {await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);server.close();process.exitCode=1;});
