(function(root){
'use strict';
const BASE='https://edge-backend-r1ng.onrender.com/api/v1',SANDBOX=BASE+'/execution/sandbox';
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const fresh=(x,now,ms=10000)=>finite(x)&&now>=x&&now-x<=ms;
const day=t=>new Date(t+19800000).toISOString().slice(0,10);
const money=x=>finite(x)?'₹'+x.toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2}):'Unavailable';
const words=x=>typeof x==='string'?x.replaceAll('_',' '):'Unavailable';
function model(data,now=Date.now()){
 const s=data?.state,p=s?.policy,h=data?.status,g=s?.monthlyGuardian;
 const valid=!!(s&&p&&h&&s.broker==='PAPER'&&h.broker==='PAPER'&&h.liveOrdersSupported===false&&h.mode==='SANDBOX');
 const trades=valid&&s.trades&&typeof s.trades==='object'?Object.values(s.trades):null;
 const orders=valid&&s.orders&&typeof s.orders==='object'?Object.values(s.orders):null;
 const open=trades?.filter(t=>!t.closedAt),working=orders?.filter(o=>!['COMPLETE','CANCELLED','REJECTED','EXPIRED'].includes(o.state));
 const worker=valid&&h.configured===true&&!h.reason&&fresh(Date.parse(h.lastTickAt),now,15000);
 const reconciled=valid&&fresh(s.reconciledAt,now);
 const guardian=valid&&h.monthlyGuardianEnabled===true&&g?.month===day(now).slice(0,7)&&fresh(g.asOf,now)&&typeof g.locked==='boolean'&&Number.isSafeInteger(g.realizedPaise);
 const eligible=valid&&p.entryMode==='AUTOPILOT_PAPER_V1'&&h.autopilotConfigured===true;
 const flat=!!(open&&working&&!open.length&&!working.length),health=worker&&reconciled&&guardian;
 const active=valid&&s.armed===true&&s.killed===false&&s.armedDay===day(now)&&health&&!s.haltReason&&!g.locked&&eligible;
 const closedToday=trades?.filter(t=>t.closedAt&&t.buys>0&&day(t.closedAt)===day(now));
 const pnl=closedToday&&closedToday.every(t=>finite(t.netPnl))?closedToday.reduce((a,t)=>a+t.netPnl,0):null;
 return {valid,health,worker,reconciled,guardian,eligible,flat,active,pnl,open,working,trades,policy:p,
  status:!valid?'Unavailable':!health?'Health unverified':s.haltReason?'Halted':g.locked?'Monthly locked':s.killed?'Stopped':active?'Armed · paper':s.armed?'Arming stale or mode mismatch':'Disarmed',
  canArm:!!(health&&flat&&eligible&&!g.locked&&!s.haltReason&&s.killed===true&&s.armed===false),
  canStop:!!valid,canAck:!!(health&&flat&&s.killed===true&&s.armed===false&&!g.locked&&s.haltReason==='SANDBOX_SERVICE_UNAVAILABLE'),
  budget:guardian?(g.locked?0:Math.max(0,7000+g.realizedPaise/100)):null,monthly:guardian?g.realizedPaise/100:null,
  halt:s?.haltReason,reason:h?.lastEntryResult,exitPolicy:h?.autopilotExitPolicy,accountingAt:g?.asOf,reconciledAt:s?.reconciledAt};
}
if(typeof module!=='undefined'&&module.exports){module.exports={model,money,day};return;}
const d=root.document,el=id=>d.getElementById('cc-'+id);if(!el('command'))return;
let token='',data=null,report=null,epoch=0,requesting=false,reporting=false,commanding=false,lastFetch=0;
const out=(id,v)=>{const e=el(id);if(e)e.textContent=v??'Unavailable';};
const time=x=>finite(x)?new Date(x).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'}):'Unavailable';
function rows(id,items){const target=el(id);target.replaceChildren();for(const [label,value] of items){const r=d.createElement('div'),a=d.createElement('span'),b=d.createElement('strong');a.textContent=label;b.textContent=value;r.append(a,b);target.append(r);}}
async function api(path,body,credential=token){
 const ctl=new AbortController(),timer=setTimeout(()=>ctl.abort(),12000);
 try{
  const r=await fetch(BASE+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+credential,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),cache:'no-store',signal:ctl.signal,redirect:'error'});
  const j=await r.json();if(!r.ok){const err=new Error(typeof j.error==='string'?j.error:'REQUEST_FAILED');err.status=r.status;throw err;}return j;
 }finally{clearTimeout(timer);}
}
function render(){
 const now=Date.now(),m=model(now-lastFetch<=20000?data:null,now);
 out('status',m.status);out('pnl',money(m.pnl));out('budget',money(m.budget));out('goal',money(m.policy?.dailyGoal));out('reason',m.valid?words(m.halt||m.reason):'Unlock to verify executor');
 out('health',m.health?'Worker, reconciliation and GUARDIAN fresh':'Not verified · no arm');out('updated',m.valid?'Reconciled '+time(m.reconciledAt)+' IST':'No verified snapshot');
 out('mode',m.valid?words(m.policy.entryMode):'Unavailable');out('exit',m.valid?words(m.exitPolicy):'Unavailable');
 rows('position',m.open===null||!m.open?[['Position','Unavailable']]:!m.open.length?[['Position','Flat']]:m.open.flatMap(t=>{
  const entry=Object.values(data.state.orders).find(o=>o.tradeId===t.id&&o.kind==='ENTRY');
  return [[t.contractId||'Contract',words(t.entrySource)],['Tier / quantity',String(t.tier??'—')+' / '+String(t.quantity??'—')],['Filled entry',entry?.filled>0?money(entry.averagePrice):'Not filled'],['Stop / target',money(t.stop)+' / '+(t.target===null?'No fixed target':money(t.target))],['Dynamic floor',money(t.exitIqState?.floor)],['Exit reason',words(t.exitReason)]];
 }));
 rows('limits',m.valid?[['Capital ceiling',money(m.policy.capital)],['Risk per trade',money(m.policy.perTradeRisk)],['Daily aspiration',money(m.policy.dailyGoal)],['Daily entries cap',String(m.policy.maxTradesPerDay??'Unavailable')],['Daily loss setting',money(m.policy.dailyLoss)+' · '+words(m.policy.limitMode)],['GUARDIAN realized month',money(m.monthly)],['Working orders',m.working?String(m.working.length):'Unavailable'],['Last risk valuation',time(m.accountingAt)+' IST']]:[['Account','Unlock to view']]);
 el('arm').disabled=commanding||requesting||!m.canArm||!token;el('stop').disabled=commanding||requesting||!token||!m.canStop;el('ack').disabled=commanding||requesting||!token||!m.canAck;
 el('status').dataset.healthy=String(m.health);el('login').hidden=!!token;el('lock').hidden=!token;
}
function renderReport(){
 const b=report?.edgeBrain,x=report?.exitIq,l=report?.timingLab;
 out('report-status',report?'Research only · generated '+(report.generatedAt||'time unavailable'):'Load evidence on demand. No order authority.');
 rows('strategies',['IMPULSE_1M','REAPER_RANGE_RECLAIM_1M','ORB_1M','ORB_3M','FUTURES_VWAP_PULLBACK'].map(k=>[words(k),(finite(l?.eventCount?.[k])?String(l.eventCount[k])+' recorded events':'Unavailable')]));
 rows('proposals',(b?.latestProposals||[]).slice(0,8).map(p=>[words(p.family)+' · '+words(p.direction),p.quote?(p.quote.contractId+' · '+money(p.quote.ask)+' · research only'):words(p.reason)]));
 if(!b?.latestProposals?.length)rows('proposals',[['Recent proposals',report?'None recorded':'Unavailable']]);
 rows('exit-results',(x?.policies||[]).map(p=>[words(p.policy),money(p.scenarios?.STRESS_2PT?.meanNetRupees)+' modeled mean (stress)']));
 if(!x?.policies?.length)rows('exit-results',[['Exit comparison','Unavailable']]);
 out('coverage',x?String(x.matchedRows??'Unknown')+' paired rows · '+String(x.distinctMeasuredSessions??'Unknown')+' sessions':'Coverage unavailable');
}
async function refresh(){
 if(!token||requesting||d.hidden)return;requesting=true;const generation=epoch,credential=token;
 try{const j=await api('/execution/sandbox',null,credential);if(generation!==epoch)return;data=j;lastFetch=Date.now();out('message','');}
 catch(e){if(generation!==epoch)return;data=null;lastFetch=0;out('message','Status unavailable · '+words(e.message));if(e.status===401||e.status===403){token='';report=null;renderReport();}}
 finally{requesting=false;render();}
}
el('login').addEventListener('submit',e=>{e.preventDefault();if(commanding)return;token=el('code').value.trim();el('code').value='';data=null;report=null;epoch++;renderReport();render();void refresh();});
el('lock').addEventListener('click',()=>{if(commanding)return;epoch++;token='';data=null;report=null;lastFetch=0;renderReport();render();});
el('refresh').addEventListener('click',()=>void refresh());
el('report').addEventListener('click',async()=>{if(!token){out('report-status','Unlock on Command first');return;}if(reporting)return;reporting=true;const generation=epoch;el('report').disabled=true;
 try{const j=await api('/opportunities');if(generation===epoch){report=j;renderReport();}}
 catch(e){if(generation===epoch){report=null;renderReport();out('report-status','Research unavailable · '+words(e.message));}}
 finally{reporting=false;el('report').disabled=false;}});
for(const [id,path] of [['arm','arm'],['stop','stop'],['ack','ack-halt']])el(id).addEventListener('click',async()=>{
 const m=model(Date.now()-lastFetch<=20000?data:null);
 if(commanding||requesting||!token||!(id==='arm'?m.canArm:id==='stop'?m.canStop:m.canAck))return;
 if(!root.confirm(id==='arm'?'Arm PAPER AUTOPILOT? Simulated orders only.':id==='stop'?'Stop paper trader and request protective position closure?':'Acknowledge old generic halt and stay stopped?'))return;
 if(!root.crypto?.randomUUID){out('message','Secure request ID unavailable. Use original panel.');return;}
 commanding=true;render();try{await api('/execution/sandbox/'+path,{confirmSandbox:true,requestId:root.crypto.randomUUID()});data=null;await refresh();}
 catch(e){data=null;out('message','Command not confirmed · '+words(e.message)+' · refresh before retrying');}
 finally{commanding=false;render();}
});
render();renderReport();setInterval(()=>{render();if(!d.hidden&&token&&!commanding)void refresh();},5000);
d.addEventListener('visibilitychange',()=>{if(!d.hidden){render();void refresh();}});
})(typeof window!=='undefined'?window:globalThis);
