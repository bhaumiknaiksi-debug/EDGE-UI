/* Owner-only observational snapshots. No order placement or signal modification. */
(()=>{
  'use strict';
  const API='https://edge-backend-r1ng.onrender.com/api/v1/trade-snapshots';
  let ownerToken='',enabled=false,pending=null,busy=false;
  const saved=new Set();
  window.edgeSnapshotWasSaved=(tier,timestamp)=>saved.has(tier+'|'+timestamp);
  const $=id=>document.getElementById(id);
  const escape=str=>String(str==null?'':str).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const fmt=x=>Number.isFinite(Number(x))&&x!==null?'₹'+Number(x).toFixed(2):'—';
  const readable=iso=>iso?new Date(iso).toLocaleString('en-IN',{timeZone:'Asia/Kolkata',day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
  const status=msg=>{const el=$('edge-snapshot-status');if(el)el.textContent=msg;};
  const dlg=$('edge-snapshot-auth');
  async function config(){
    try{
      const r=await fetch(API+'/status',{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if(!r.ok)throw Error('Snapshot service unavailable');
      const d=await r.json();
      enabled=d.enabled===true;
      document.documentElement.classList.toggle('edge-snapshots-enabled',enabled);
      if(enabled){clearInterval(configTimer);if(ownerToken)refresh();}
    }catch(_){/* Disabled by default while offline. Retry when backend recovers. */}
  }
  const configTimer=setInterval(config,30000);
  config();
  window.addEventListener('edge:owner-unlocked',e=>{
    if(e.detail&&typeof e.detail.token==='string'){
      ownerToken=e.detail.token; if(enabled)refresh();
    }
  });
  async function authorized(path,method='GET',payload){
    const r=await fetch(API+path,{
      method,cache:'no-store',headers:{Authorization:'Bearer '+ownerToken,...(payload?{'Content-Type':'application/json'}:{})},
      body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(20000)
    });
    const d=await r.json().catch(()=>({error:'INVALID_SERVER_RESPONSE'}));
    if(!r.ok)throw Error(d.error||'SNAPSHOT_REQUEST_FAILED');
    return d;
  }
  function showAuth(){
    const note=$('edge-snapshot-auth-note');
    if(note)note.textContent='Unlock once with the same EDGE owner code used by Trade Log. The code stays in memory only.';
    if(dlg&&typeof dlg.showModal==='function')dlg.showModal();
    else status('Unlock Trade Log with your owner code, then tap I Traded This again.');
  }
  async function save(){
    if(!pending||busy)return;
    if(!ownerToken){showAuth();return;}
    busy=true;status('Saving the exact backend market snapshot…');
    try{
      const d=await authorized('','POST',{requestId:pending.requestId,tier:pending.tier,analysisTimestamp:pending.timestamp});
      if(d.saved!==true)throw Error('SNAPSHOT_NOT_CONFIRMED');
      const key=pending;pending=null;
      saved.add(key.tier+'|'+key.timestamp);
      document.querySelectorAll('[data-edge-snapshot-tier]').forEach(b=>{
        if(b.dataset.edgeSnapshotTier===key.tier&&b.dataset.edgeSnapshotTime===key.timestamp){
          b.textContent='✓ Snapshot saved';b.setAttribute('data-edge-snapshot-saved','true');
        }
      });
      status('Snapshot saved at '+readable(d.payload.capturedAt)+' · Kite verification pending.');
      refresh();
    }catch(err){
      if(err.message==='OWNER_AUTH_REQUIRED'){ownerToken='';status('Owner code not accepted. Please unlock to retry.');showAuth();}
      else status('Snapshot NOT saved: '+err.message+'. Tap the button to retry safely.');
    }finally{busy=false;}
  }
  document.addEventListener('click',e=>{
    const button=e.target.closest('[data-edge-snapshot-tier]');
    if(!button||!enabled||button.disabled||busy)return;
    const tier=button.getAttribute('data-edge-snapshot-tier');
    const timestamp=button.getAttribute('data-edge-snapshot-time');
    if(!['A','B','C'].includes(tier)||!timestamp){status('No backend-confirmed candidate is available.');return;}
    const age=Date.now()-Date.parse(timestamp);
    if(!Number.isFinite(age)||age>120000||age< -20000){status('Snapshot is stale. Refresh live EDGE data before capturing.');return;}
    if(button.getAttribute('data-edge-snapshot-saved')==='true'){status('Already captured for this market analysis.');return;}
    if(!pending||pending.tier!==tier||pending.timestamp!==timestamp)pending={tier,timestamp,requestId:crypto.randomUUID()};
    save();
  });
  if(dlg){
    dlg.querySelector('form').addEventListener('submit',e=>{
      e.preventDefault();
      const field=$('edge-snapshot-owner-code');
      ownerToken=(field.value||'').trim();field.value='';dlg.close();
      if(pending)save();else refresh();
    });
    const cancel=$('edge-snapshot-auth-cancel');
    if(cancel)cancel.addEventListener('click',()=>dlg.close());
  }
  function render(rows){
    const root=$('edge-snapshot-history');if(!root)return;
    root.replaceChildren();
    if(!rows.length){root.textContent='No snapshots yet. Tap I Traded This after a Kite execution.';return;}
    for(const row of rows){if(row.payload)saved.add(row.payload.tier+'|'+row.payload.analysisAt);}
    document.querySelectorAll('[data-edge-snapshot-tier]').forEach(b=>{
      if(window.edgeSnapshotWasSaved(b.dataset.edgeSnapshotTier,b.dataset.edgeSnapshotTime)){
        b.textContent='✓ Snapshot saved';b.setAttribute('data-edge-snapshot-saved','true');
      }
    });
    for(const row of rows.slice(0,30)){
      const p=row.payload||{},candidate=p.selectedCandidate||{},legs=p.selectedLegs||[];
      const card=document.createElement('div');
      card.className='edge-snapshot-history-item';
      const title=document.createElement('strong');
      title.textContent='Tier '+p.tier+' · '+(p.strategy||'Strategy')+' · '+readable(p.capturedAt);
      const contracts=document.createElement('small');
      contracts.textContent=legs.map(l=>l.side+' '+(l.contractId||l.strike+' '+l.type)).join(' · ');
      const match=document.createElement('small');
      const detail=row.matchDetails||{};
      match.textContent='Kite: '+(row.matchStatus||'PENDING_TRADEBOOK').replace(/_/g,' ') +
        (Number.isFinite(detail.grossPnl)?' · Gross '+(detail.grossPnl>=0?'+':'')+'₹'+detail.grossPnl.toFixed(2):'')+
        ' · Net per trade not verified';
      const hypothesis=p.tradePlan;
      const evaluation=detail.planEvaluation;
      const summary=document.createElement('small');
      summary.textContent=hypothesis?.status==='MODEL_READY_SHADOW'
        ?'PRE-TRADE SHADOW ESTIMATE · Ask '+fmt(hypothesis.entry?.ask)+' · Stop '+fmt(hypothesis.stop?.premium)+' · Target '+fmt(hypothesis.targets?.[0]?.premium)
        :'Pre-trade price estimate unavailable or not supported';
      card.append(title,contracts,summary,match);
      if(evaluation){
        const comparison=document.createElement('small');
        comparison.textContent='ACTUAL KITE · Bought '+fmt(evaluation.brokerEntry)+' · Sold '+fmt(evaluation.brokerExit)+
          ' · Entry difference '+fmt(evaluation.entrySlippagePoints)+' · Model not independently validated';
        card.append(comparison);
      }
      root.append(card);
    }
  }
  async function refresh(){
    if(!enabled||!ownerToken)return;
    try{const data=await authorized();render(data.snapshots||[]);}
    catch(e){status('Could not load snapshots: '+e.message);}
  }
  async function reconcile(){
    if(!enabled||!ownerToken)return;
    try{const result=await authorized('/reconcile','POST',{});status('Kite reconciliation completed for '+result.count+' saved snapshots.');await refresh();}
    catch(e){status('Reconciliation unavailable: '+e.message);}
  }
  const button=$('edge-snapshot-reconcile');
  if(button)button.addEventListener('click',reconcile);
  window.addEventListener('edge:broker-imported',reconcile);
})();
