/* EDGE Trade Planner — observational overlay only.
 * Never changes the A/B/C classifier, market state, candidate cards or trade entry permission.
 */
(()=>{
'use strict';
const API='https://edge-backend-r1ng.onrender.com/api/v1/trade-plans';
let lastStamp='',busy=false;
const safe=(s)=>String(s==null?'':s);
function fmt(n){return Number.isFinite(Number(n))?'₹'+Number(n).toFixed(2):'—';}
function paint(plan,root){
  if(!root)return;
  const tag=root.querySelector('.edge-trade-planner');
  if(tag)tag.remove();
  if(!plan)return;
  const p=document.createElement('div');
  p.className='edge-trade-planner';
  const title=document.createElement('strong');
  title.textContent='TRADE PLAN · RESEARCH ONLY';
  p.append(title);
  const body=document.createElement('div');body.className='edge-trade-planner-grid';
  const entries=plan.status==='MODEL_READY_SHADOW'
    ?[['Observed ask',fmt(plan.entry?.ask)],['Modeled stop',fmt(plan.stop?.premium)],
      ['Modeled target',fmt(plan.targets?.[0]?.premium)],['Estimated R:R',safe(plan.riskReward)+'x']]
    :[['Status','Not enough reliable data'],['Why',(plan.reasons||[]).join(', ').replaceAll('_',' ').toLowerCase()]];
  for(const [label,value] of entries){
    const line=document.createElement('span');
    const name=document.createElement('small');name.textContent=label;
    const val=document.createElement('b');val.textContent=value;line.append(name,val);body.append(line);
  }
  p.append(body);
  const note=document.createElement('small');
  note.className='edge-trade-planner-note';
  note.textContent='No verified entry trigger · 20-min research horizon · Not a trade instruction';
  p.append(note);
  const button=root.querySelector('[data-edge-snapshot-tier]');
  if(button)button.before(p);else root.append(p);
}
async function refresh(){
  if(busy||document.hidden||!navigator.onLine)return;busy=true;
  try{
    const res=await fetch(API,{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!res.ok){if(res.status===404)return;throw Error('Planner offline');}
    const data=await res.json();
    if(!data||data.mode!=='SHADOW'||data.liveDecisionImpact!==false)return;
    // Fail closed: never attach stale/old predictions to a newer candidate.
    const stamp=data.analysisAt;
    if(!stamp||Math.abs(Date.now()-Date.parse(stamp))>120000)return;
    const tiers=data.tiers||{};
    for(const tier of ['A','B','C']){
      const simple=document.getElementById('simple-tier-'+tier.toLowerCase());
      const action=simple?.querySelector('[data-edge-snapshot-tier]');
      if(action&&action.dataset.edgeSnapshotTime===stamp&&tiers[tier]?.analysisAt===stamp)paint(tiers[tier],simple);
      const pro=Array.from(document.querySelectorAll('.candidate-plan [data-edge-snapshot-tier]'))
        .find(b=>b.dataset.edgeSnapshotTier===tier&&b.dataset.edgeSnapshotTime===stamp)?.closest('.candidate-plan');
      if(pro&&tiers[tier]?.analysisAt===stamp)paint(tiers[tier],pro);
    }
    lastStamp=stamp;
  }catch(_){/* Never interfere with the existing market UI when research is unavailable. */}
  finally{busy=false;}
}
setInterval(refresh,15000);
window.addEventListener('focus',refresh);
setTimeout(refresh,3000);
})();
