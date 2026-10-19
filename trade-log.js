/* Private manual-fill journal. No broker orders are sent. */
(() => {
  'use strict';
  const root=document.getElementById('trade-log'); if(!root)return;
  const api='https://edge-backend-r1ng.onrender.com/api/v1/trades';
  let token='',busy=false,pending=null,activeReportId='',lastBroker=null,pnlReports=[];
  const $=id=>document.getElementById(id);
  const money=n=>'₹'+Number(n).toLocaleString('en-IN',{maximumFractionDigits:2});
  async function request(path='',payload) {
    if(busy)return;busy=true;root.setAttribute('aria-busy','true');
    root.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {
      const response=await fetch(api+path,{method:payload?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+token,...(payload?{'Content-Type':'application/json'}:{})},body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(20000)});
      const data=await response.json();if(!response.ok)throw new Error(data.error||'Request failed');
      pending=null;
      if(path==='/pnl'&&data.pnlResult?.period)activeReportId=data.pnlResult.period;
      render(data);
      if(!payload)window.dispatchEvent(new CustomEvent('edge:owner-unlocked',{detail:{token}}));
      if(path==='/import'||path==='/pnl')window.dispatchEvent(new Event('edge:broker-imported'));
      if(path==='/import'){
        const imported=data.importResult||{},status=$('kite-import-status');
        status.textContent='Import complete: '+Number(imported.added||0)+' new fills, '+Number(imported.duplicates||0)+
          ' already imported. Gross P&L only; exact net profit needs broker charges.';
        $('kite-import').open=false; // A completed import returns focus to the trade table.
      }
      if(path==='/pnl'){
        const result=data.pnlResult||{};
        $('kite-import-status').textContent=result.unchanged
          ? 'This P&L period is already saved. No duplicate profit added.'
          : result.replaced?'Updated this reporting period using the latest Kite figures.':'Kite P&L statement saved and reconciled.';
        $('kite-import').open=false;
      }
      $('journal-status').textContent=path==='/import'
        ? 'Tradebook imported · '+Number(data.importResult?.added||0)+' new fills · '+Number(data.importResult?.duplicates||0)+' duplicates'
        : path==='/pnl'?'Kite P&L statement reconciled · '+(data.pnlResult?.period||'')
        : 'Updated '+new Date().toLocaleTimeString();
    }catch(e){
      $('journal-status').textContent=e.message+'. '+(payload?'If the response was lost, retry with the same form to avoid duplicate records.':'Check your owner code and connection.');
      if(path==='/import'||path==='/pnl')$('kite-import-status').textContent='Report not confirmed: '+e.message+'. Review the file or retry.';
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
    renderBroker(data.broker,data.pnl);
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
      const statementOnly=trade.kind==='PNL_ONLY'||trade.kind==='PNL_MISMATCH';
      const row=document.createElement('tr');row.className='kite-history-row';
      row.append(makeCell('kite-date','Date',statementOnly?'—':dateLabel(trade.openedAt)));
      const cell=makeCell('kite-instrument','Instrument');
      const name=displayContract(trade.symbol);
      const main=document.createElement('strong');main.textContent=name.name;
      const strike=document.createElement('span');strike.className='kite-strike';strike.textContent=name.strike;
      const details=document.createElement('details');details.className='kite-trade-details';
      const summary=document.createElement('summary');summary.textContent='Details';details.append(summary);
      const detail=document.createElement('small');
      detail.textContent=statementOnly
        ? String(trade.quantity)+' units · Kite P&L period summary · Execution date/time unavailable · '+
          (trade.detail||'Tradebook required for individual executions.')
        : String(trade.quantity)+' units · '+String(trade.openedAt||'').slice(11,16)+'–'+
          String(trade.closedAt||'').slice(11,16)+' IST · '+String(trade.symbol||'');
      details.append(detail);cell.append(main,strike,details);row.append(cell);
      const type=makeCell('kite-type','Type');
      const pill=document.createElement('span');
      pill.className=statementOnly?'kite-side summary':'kite-side buy';
      pill.textContent=statementOnly?'P&L':'Buy';type.append(pill);row.append(type);
      const entry=makeCell('kite-entry',statementOnly?'Avg entry':'Entry',
        (statementOnly?'≈':'')+fullMoney(trade.entry));
      const exit=makeCell('kite-exit',statementOnly?'Avg exit':'Exit',
        (statementOnly?'≈':'')+fullMoney(trade.exit));
      if(statementOnly){
        entry.title='Average entry premium inferred from total buy value / quantity, not the actual fill price.';
        exit.title='Average exit premium inferred from total sell value / quantity, not the actual fill price.';
      }
      row.append(entry,exit);
      const pnl=makeCell('kite-pnl '+(gross>0?'profit':gross<0?'loss':'flat'),'Gross P&L',signedMoney(gross));
      pnl.setAttribute('aria-label','Broker gross profit or loss, before charges: '+signedMoney(gross));
      row.append(pnl);table.append(row);
    }
  }
  function renderBroker(broker,pnl){
    const summary=$('kite-history-summary'),warning=$('kite-unmatched-warning');
    const period=$('kite-report-period'),totals=$('kite-reconciled-totals');
    lastBroker=broker||null;
    pnlReports=Array.isArray(pnl?.reports)?pnl.reports:[];
    const hasBook=Number(lastBroker?.summary?.completedTrades||0)>0;
    if(!activeReportId)activeReportId=pnlReports.length?pnlReports[0].id:'book';
    if(activeReportId!=='book'&&!pnlReports.some(x=>x.id===activeReportId))
      activeReportId=pnlReports.length?pnlReports[0].id:'book';
    period.replaceChildren();
    for(const report of pnlReports){
      const option=document.createElement('option');option.value=report.id;
      option.textContent=report.startDate.slice(5).replace('-','/')+' – '+
        report.endDate.slice(5).replace('-','/')+' (Kite verified)';
      period.append(option);
    }
    if(hasBook){
      const option=document.createElement('option');option.value='book';
      option.textContent='All Tradebook fills (gross)';period.append(option);
    }
    period.hidden=(!pnlReports.length);
    period.value=activeReportId;
    const chosen=pnlReports.find(x=>x.id===activeReportId);
    warning.hidden=true;
    if(chosen){
      brokerEpisodes=Array.isArray(chosen.items)?chosen.items:[];
      const count=brokerEpisodes.length;
      $('kite-history-count').textContent=count?'('+count+')':'';
      summary.textContent=chosen.symbols+' instruments · '+chosen.unmatchedSymbols+' statement-only / unmatched';
      $('kite-history-basis').textContent='Kite P&L statement · '+chosen.startDate+' to '+chosen.endDate;
      totals.hidden=false;
      $('kite-pnl-gross').textContent=signedMoney(chosen.grossPnl);
      $('kite-pnl-charges').textContent='−'+fullMoney(chosen.charges);
      $('kite-pnl-net').textContent=signedMoney(chosen.netPnl);
      $('kite-pnl-net').className=chosen.netPnl>0?'profit':chosen.netPnl<0?'loss':'flat';
      $('kite-pnl-scope-note').hidden=false;
      $('kite-pnl-scope-note').textContent='Verified net is for this statement period only. Rows show gross P&L; Kite does not itemize individual trade charges. '+
        (chosen.unmatchedSymbols?'Some instruments lack matching complete Tradebook fills.':'All statement instruments match imported Tradebook fills.');
    }else{
      totals.hidden=true;
      $('kite-pnl-scope-note').hidden=true;
      $('kite-history-basis').textContent='Tradebook-only gross P&L · charges not included';
      brokerEpisodes=Array.isArray(lastBroker?.episodes)?lastBroker.episodes:[];
      const info=lastBroker?.summary||null;
      const count=Number(info?.completedTrades||brokerEpisodes.length);
      $('kite-history-count').textContent=count?'('+count+')':'';
      summary.textContent=info
        ? count+' '+(count===1?'trade':'trades')+' · '+signedMoney(Number(info.grossPnl||0))+' gross'
        : 'No Kite trades imported';
      if(info&&(info.unmatchedSellQuantity||info.openBuyQuantity)){
        warning.hidden=false;
        warning.textContent='Unmatched fills: '+(info.openBuyQuantity||0)+' open buy units and '+
          (info.unmatchedSellQuantity||0)+' sells without matching buys. Check your export date range.';
      }
    }
    renderHistoryRows();
  }
  $('journal-history-filter').addEventListener('change',renderHistoryRows);
  $('kite-report-period').addEventListener('change',e=>{
    activeReportId=e.target.value;
    renderBroker(lastBroker,{reports:pnlReports});
  });
  $('journal-login').addEventListener('submit',e=>{e.preventDefault();token=$('journal-code').value.trim();$('journal-code').value='';request();});
  $('journal-refresh').addEventListener('click',()=>request());
  $('journal-confirm').addEventListener('submit',e=>{e.preventDefault();mutate('/confirm',{reconciled:$('journal-reconciled').checked});});
  const strategy=$('journal-strategy');strategy.addEventListener('change',()=>{root.querySelectorAll('[data-other]').forEach(el=>{el.hidden=strategy.value!=='OTHER';el.querySelectorAll('input').forEach(i=>i.required=!el.hidden);});$('journal-stop').required=strategy.value!=='OTHER';});
  $('journal-open').addEventListener('submit',e=>{e.preventDefault();const d={};new FormData(e.target).forEach((v,k)=>{if(v!=='')d[k]=['contract','strategy','signalId'].includes(k)?v:Number(v);});mutate('/open',d);});
  root.addEventListener('kite:import',e=>{
    if(!token){$('kite-import-status').textContent='Unlock Trade Log with your owner code first.';return;}
    if(!e.detail)return;
    if(e.detail.kind==='pnl'){
      const {kind,...statement}=e.detail;
      if(!Array.isArray(statement.rows))return;
      mutate('/pnl',statement);
    }else if(Array.isArray(e.detail.fills)){
      mutate('/import',{clientId:e.detail.clientId,fills:e.detail.fills});
    }
  });
})();
