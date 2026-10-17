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
      $('journal-status').textContent='Updated '+new Date().toLocaleTimeString();
    }catch(e){
      $('journal-status').textContent=e.message+'. '+(payload?'If the response was lost, retry with the same form to avoid duplicate records.':'Check your owner code and connection.');
      if(path==='/import')$('kite-import-status').textContent='Import could not be confirmed: '+e.message+'. No new records are verified saved; review or retry.';
    }
    finally{busy=false;root.removeAttribute('aria-busy');root.querySelectorAll('button').forEach(b=>b.disabled=false);}
  }
  function mutate(path,data){const signature=JSON.stringify([path,data]);if(!pending||pending.signature!==signature)pending={signature,id:crypto.randomUUID()};return request(path,{...data,requestId:pending.id});}
  function render(data){
    $('journal-private').hidden=false;
    $('journal-login').hidden=true;
    $('journal-refresh').hidden=false;
    const b=data.budget;
    $('journal-budget').textContent='Today’s manual-ledger net '+money(b.netRealizedPnl)+' · Open planned risk '+money(b.openRisk)+' · Remaining daily risk '+money(b.availableRisk);
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
  let brokerEpisodes=[];
  const fullMoney=n=>'₹'+Number(n).toLocaleString('en-IN',{minimumFractionDigits:2,maximumFractionDigits:2});
  const signedMoney=n=>(Number(n)>0?'+':Number(n)<0?'−':'')+fullMoney(Math.abs(Number(n)));
  // NIFTY tradebook contract ID includes expiry code and a 5-digit strike.
  function displayContract(symbol){
    const match=/^NIFTY[0-9A-Z]+?(\d{5})(CE|PE)$/.exec(String(symbol||''));
    return match?{name:'NIFTY 50',strike:match[1]+' '+match[2]}:{name:String(symbol||'—'),strike:''};
  }
  function dateLabel(iso){
    const match=/^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso||''));
    return match?match[3]+'/'+match[2]:'—';
  }
  function makeCell(className, label, text){
    const cell=document.createElement('td');cell.className=className;cell.setAttribute('data-label',label);
    if(text!==undefined)cell.textContent=text;
    return cell;
  }
  function renderHistoryRows(){
    const filter=$('journal-history-filter').value,table=$('kite-history-list');
    const results=brokerEpisodes.filter(trade=>{
      const gross=Number(trade.grossPnl);
      return Number.isFinite(gross)&&(filter==='all'||(filter==='profit'&&gross>0)||(filter==='loss'&&gross<0)||(filter==='flat'&&gross===0));
    });
    table.replaceChildren();
    if(!results.length){
      const empty=document.createElement('tr');empty.className='kite-empty';
      const cell=document.createElement('td');cell.colSpan=6;cell.textContent=brokerEpisodes.length?'No trades match this filter.':'No completed Kite trades yet. Import a tradebook to begin.';
      empty.append(cell);table.append(empty);return;
    }
    for(const trade of results){
      const gross=Number(trade.grossPnl);
      const row=document.createElement('tr');row.className='kite-history-row';
      row.append(makeCell('kite-date','Date',dateLabel(trade.openedAt)));
      const cell=makeCell('kite-instrument','Instrument');
      const name=displayContract(trade.symbol);
      const main=document.createElement('strong');main.textContent=name.name;
      const strike=document.createElement('span');strike.className='kite-strike';strike.textContent=name.strike;
      const details=document.createElement('details');details.className='kite-trade-details';
      const summary=document.createElement('summary');summary.textContent='Details';details.append(summary);
      const detail=document.createElement('small');
      detail.textContent=String(trade.quantity)+' units · '+String(trade.openedAt||'').slice(11,16)+'–'+String(trade.closedAt||'').slice(11,16)+' IST · '+String(trade.symbol||'');
      details.append(detail);cell.append(main,strike,details);row.append(cell);
      const type=makeCell('kite-type','Type');
      const pill=document.createElement('span');pill.className='kite-side buy';pill.textContent='Buy';type.append(pill);row.append(type);
      row.append(makeCell('kite-entry','Entry',fullMoney(trade.entry)));
      row.append(makeCell('kite-exit','Exit',fullMoney(trade.exit)));
      const pnl=makeCell('kite-pnl '+(gross>0?'profit':gross<0?'loss':'flat'),'Gross P&L',signedMoney(gross));
      pnl.setAttribute('aria-label','Gross profit or loss, before charges: '+signedMoney(gross));
      row.append(pnl);table.append(row);
    }
  }
  function renderBroker(broker){
    const summary=$('kite-history-summary'),warning=$('kite-unmatched-warning');
    brokerEpisodes=Array.isArray(broker?.episodes)?broker.episodes:[];
    const info=broker?.summary||null;
    const count=Number(info?.completedTrades||brokerEpisodes.length);
    $('kite-history-count').textContent=count?'('+count+')':'';
    warning.hidden=true;
    if(!info){
      summary.textContent='No Kite trades imported';
      brokerEpisodes=[];renderHistoryRows();return;
    }
    summary.textContent=count+' trades · '+signedMoney(Number(info.grossPnl||0))+' gross';
    if(info.unmatchedSellQuantity||info.openBuyQuantity){
      warning.hidden=false;
      warning.textContent='Unmatched fills: '+(info.openBuyQuantity||0)+' open buy units and '+(info.unmatchedSellQuantity||0)+' sells without matching buys. Check your export date range.';
    }
    renderHistoryRows();
  }
  $('journal-history-filter').addEventListener('change',renderHistoryRows);
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
