/* Private manual-fill journal. No broker orders are sent. */
(() => {
  'use strict';
  const root=document.getElementById('trade-log'); if(!root)return;
  const api='https://edge-backend-r1ng.onrender.com/api/v1/trades';
  let token='',busy=false,pending=null;
  const $=id=>document.getElementById(id);
  const money=n=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
  async function request(path='',payload) {
    if(busy)return;busy=true;root.setAttribute('aria-busy','true');
    root.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const response=await fetch(api+path,{method:payload?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(20000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');
      pending=null;render(data);
      if(path==='/import'){
        const imported=data.importResult||{},status=$('kite-import-status');
        status.textContent='Import complete: '+Number(imported.added||0)+' new fills, '+Number(imported.duplicates||0)+
          ' already imported. Gross profit only; exact net profit needs broker charges. Live trading limits unchanged.';
      }
      $('journal-status').textContent='Saved records refreshed. '+new Date().toLocaleTimeString();
    }catch(e){$('journal-status').textContent=e.message+'. '+(payload?'If the response was lost, retry the same form to avoid duplicate records.':'Check your owner code and connection.');}
    finally{busy=false;root.removeAttribute('aria-busy');root.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  function mutate(path,data){const signature=JSON.stringify([path,data]);if(!pending||pending.signature!==signature)pending={signature,id:crypto.randomUUID()};return request(path,{...data,requestId:pending.id});}
  function render(data){
    $('journal-private').hidden=false;
    const b=data.budget;
    $('journal-budget').textContent=`Capital available ${money(b.availableCapital)} / ₹10,000 · Net realised today ${money(b.netRealizedPnl)} · Open planned risk ${money(b.openRisk)} · Loss allowance available ${money(b.availableRisk)} / ₹1,000`;
    $('journal-state').textContent=b.locked?'Daily loss limit reached. New entries blocked.':b.confirmed?'Today’s reconciliation confirmed. All other EDGE gates still apply.':'Reconcile all broker positions and today’s completed trades before confirming below.';
    const list=$('journal-trades');list.replaceChildren();
    data.trades.slice().reverse().forEach(t=>{
      const card=document.createElement('div');card.className='journal-trade';
      const label=document.createElement('p');label.textContent=`${t.contract} · ${t.quantity} units · Entry ${money(t.entry)} · ${t.closedAt?'Closed · Net '+money(t.netPnl):'Open · Planned risk '+money(t.reservedRisk)}`;card.append(label);
      if(!t.closedAt){const form=document.createElement('form');form.className='journal-grid';
        const fields=[['exit','Exit premium'],['charges','Actual total charges (entry + exit)']];if(t.strategy==='OTHER')fields.push(['grossPnl','Gross P&L (signed)']);
        fields.forEach(([name,title])=>{const l=document.createElement('label');l.textContent=title;const input=document.createElement('input');input.name=name;input.type='number';input.step='0.01';if(name!=='grossPnl')input.min='0';input.required=true;l.append(input);form.append(l);});
        const button=document.createElement('button');button.textContent='Record full close';form.append(button);form.addEventListener('submit',e=>{e.preventDefault();const d={tradeId:t.id};new FormData(form).forEach((v,k)=>d[k]=Number(v));mutate('/close',d);});card.append(form);
      }list.append(card);
    });
    renderBroker(data.broker);
  }
  function renderBroker(broker){
    const summary=$('kite-history-summary'),list=$('kite-history-list');
    list.replaceChildren();
    if(!broker||!broker.summary){
      summary.textContent='No Kite broker history found. Imported fills are separate from the manual risk ledger.';
      return;
    }
    const s=broker.summary;
    const signed=n=>(Number(n)>=0?'+':'')+money(n);
    summary.textContent=String(s.importedFills||0)+' imported fills · '+String(s.completedTrades||0)+
      ' completed NIFTY option trades · Gross P&L '+signed(s.grossPnl||0)+
      ' (before charges). This history does not affect available capital, daily loss or READY eligibility.';
    if(s.openBuyQuantity||s.unmatchedSellQuantity){
      const warning=document.createElement('p');
      warning.textContent='Unmatched quantities: '+(s.openBuyQuantity||0)+' open buys; '+
        (s.unmatchedSellQuantity||0)+' sells without a matching buy. Review the complete date range.';
      list.append(warning);
    }
    (broker.episodes||[]).slice(0,30).forEach(t=>{
      const row=document.createElement('div');row.className='kite-history-row';
      row.textContent=t.openedAt.slice(0,10)+' · '+t.symbol+' · '+t.quantity+' units · '+
        money(t.entry)+' → '+money(t.exit)+' · Gross '+signed(t.grossPnl);
      const note=document.createElement('small');note.textContent='Kite fill times '+t.openedAt.slice(11)+' – '+
        t.closedAt.slice(11)+' IST · Actual charges unavailable · Net P&L not calculated';
      row.append(note);list.append(row);
    });
  }
  $('journal-login').addEventListener('submit',e=>{e.preventDefault();token=$('journal-code').value.trim();$('journal-code').value='';request();});
  $('journal-refresh').addEventListener('click',()=>request());
  $('journal-confirm').addEventListener('submit',e=>{e.preventDefault();mutate('/confirm',{reconciled:$('journal-reconciled').checked});});
  const strategy=$('journal-strategy');strategy.addEventListener('change',()=>{root.querySelectorAll('[data-other]').forEach(el=>{el.hidden=strategy.value!=='OTHER';el.querySelectorAll('input').forEach(i=>i.required=!el.hidden);});$('journal-stop').required=strategy.value!=='OTHER';});
  $('journal-open').addEventListener('submit',e=>{e.preventDefault();const d={};new FormData(e.target).forEach((v,k)=>{if(v!=='')d[k]=['contract','strategy','signalId'].includes(k)?v:Number(v);});mutate('/open',d);});
  root.addEventListener('kite:import',e=>{
    if(!token){$('kite-import-status').textContent='Unlock Trade Log with your owner code first.';return;}
    if(!e.detail||!Array.isArray(e.detail.fills))return;
    mutate('/import',e.detail);
  });
})();
