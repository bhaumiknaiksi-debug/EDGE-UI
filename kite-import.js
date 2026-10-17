/* Kite Tradebook + P&L reader: private, local Excel/CSV parsing and preview. */
(()=>{
  'use strict';
  const root=document.getElementById('trade-log'),fileInput=document.getElementById('kite-file');
  if(!root||!fileInput)return;
  const $=id=>document.getElementById(id);
  const decoder=new TextDecoder('utf-8');
  const MAX_FILE=6*1024*1024, MAX_XML=5*1024*1024, MAX_FILLS=120;
  let approved=null;
  function zipU16(d,p){return d.getUint16(p,true);}
  function zipU32(d,p){return d.getUint32(p,true);}
  function entries(bytes){
    const dv=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    let end=-1;
    for(let p=bytes.length-22;p>=Math.max(0,bytes.length-65557);p--){
      if(zipU32(dv,p)===0x06054b50){end=p;break;}
    }
    if(end<0)throw Error('Not a valid XLSX file.');
    const count=zipU16(dv,end+10),offset=zipU32(dv,end+16);
    if(count>300||offset>bytes.length)throw Error('Workbook is too large or unsupported.');
    const found=new Map();let p=offset;
    for(let i=0;i<count;i++){
      if(p+46>bytes.length||zipU32(dv,p)!==0x02014b50)throw Error('Damaged XLSX directory.');
      const method=zipU16(dv,p+10),flags=zipU16(dv,p+8),size=zipU32(dv,p+20),plain=zipU32(dv,p+24),
        namelen=zipU16(dv,p+28),extra=zipU16(dv,p+30),comment=zipU16(dv,p+32),local=zipU32(dv,p+42);
      if(p+46+namelen+extra+comment>bytes.length)throw Error('Damaged XLSX directory.');
      const name=decoder.decode(bytes.subarray(p+46,p+46+namelen));
      if(name==='xl/sharedStrings.xml'||/^xl\/worksheets\/sheet\d+\.xml$/.test(name)){
        if((flags&1)||![0,8].includes(method)||plain>MAX_XML||size>MAX_FILE||local+30>bytes.length)
          throw Error('Unsupported or oversized XLSX data.');
        if(zipU32(dv,local)!==0x04034b50)throw Error('Damaged worksheet.');
        const begin=local+30+zipU16(dv,local+26)+zipU16(dv,local+28);
        if(begin+size>bytes.length)throw Error('Damaged worksheet data.');
        found.set(name,{method,compressed:bytes.subarray(begin,begin+size),plain});
      }
      p+=46+namelen+extra+comment;
    }
    if(![...found.keys()].some(k=>k.startsWith('xl/worksheets/sheet')))throw Error('No worksheet found in the XLSX.');
    return found;
  }
  async function xmlEntry(part){
    let raw=part.compressed;
    if(part.method===8){
      if(typeof DecompressionStream!=='function')throw Error('This browser cannot open compressed Excel files. Please export CSV from Kite.');
      const stream=new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      const reader=stream.getReader(),chunks=[];let total=0;
      try{
        while(true){
          const part=await reader.read();if(part.done)break;
          total+=part.value.byteLength;
          if(total>MAX_XML){await reader.cancel();throw Error('Oversized XLSX worksheet.');}
          chunks.push(part.value);
        }
      }finally{reader.releaseLock();}
      raw=new Uint8Array(total);let pos=0;
      for(const chunk of chunks){raw.set(chunk,pos);pos+=chunk.byteLength;}
    }
    if(raw.byteLength>MAX_XML||raw.byteLength!==part.plain)throw Error('Oversized or damaged worksheet.');
    const source=decoder.decode(raw);
    if(/<!DOCTYPE|<!ENTITY/i.test(source))throw Error('Unsafe workbook XML.');
    const doc=new DOMParser().parseFromString(source,'application/xml');
    if(doc.getElementsByTagName('parsererror').length)throw Error('Invalid workbook XML.');
    return doc;
  }
  function excelSerial(value){
    const num=Number(value);
    if(!Number.isFinite(num)||num<1||num>200000)throw Error('Unsupported Excel date/time.');
    return new Date(Date.UTC(1899,11,30)+Math.round(num*86400000)).toISOString().slice(0,19);
  }
  function cellIndex(ref){
    const m=/^([A-Z]+)\d+$/.exec(ref||'');
    if(!m)return -1;
    let n=0;for(const c of m[1])n=n*26+c.charCodeAt(0)-64;
    return n-1;
  }
  function sheetRows(doc,shared){
    const rows=[],xmlRows=doc.getElementsByTagNameNS('*','row');
    if(xmlRows.length>3000)throw Error('Please export a smaller Kite date range.');
    for(const row of xmlRows){
      const cells=row.getElementsByTagNameNS('*','c'),arr=[];
      for(const cell of cells){
        const col=cellIndex(cell.getAttribute('r'));if(col<0||col>60)continue;
        const type=cell.getAttribute('t'),v=cell.getElementsByTagNameNS('*','v')[0];
        let value=v?v.textContent.trim():'';
        if(type==='inlineStr'){
          const nodes=cell.getElementsByTagNameNS('*','t');
          value=Array.from(nodes).map(n=>n.textContent).join('');
        }else if(type==='s')value=shared[Number(value)]||'';
        else if(type==='n'&&value!=='')value=Number(value);
        arr[col]=value;
      }
      rows.push(arr);
    }
    return rows;
  }
  async function readXlsx(file){
    const bytes=new Uint8Array(await file.arrayBuffer()),parts=entries(bytes);
    let shared=[];
    if(parts.has('xl/sharedStrings.xml')){
      const doc=await xmlEntry(parts.get('xl/sharedStrings.xml'));
      shared=Array.from(doc.getElementsByTagNameNS('*','si')).map(si=>
        Array.from(si.getElementsByTagNameNS('*','t')).map(t=>t.textContent).join(''));
    }
    for(const [name,part] of parts){
      if(!name.startsWith('xl/worksheets/'))continue;
      const rows=sheetRows(await xmlEntry(part),shared);
      if(findHeader(rows)||findPnlHeader(rows))return rows;
    }
    throw Error('This workbook does not contain a Kite Tradebook table.');
  }
  function csvRows(raw){
    const out=[],row=[];let field='',quoted=false;
    raw=raw.replace(/^\uFEFF/,'');
    for(let i=0;i<raw.length;i++){
      const ch=raw[i];
      if(ch==='"'){
        if(quoted&&raw[i+1]==='"'){field+='"';i++;}
        else quoted=!quoted;
      }else if(ch===','&&!quoted){row.push(field);field='';}
      else if((ch==='\r'||ch==='\n')&&!quoted){
        row.push(field);out.push(row.splice(0));field='';
        if(ch==='\r'&&raw[i+1]==='\n')i++;
      }else field+=ch;
    }
    if(quoted)throw Error('Invalid quoted field in CSV.');
    if(field||row.length){row.push(field);out.push(row);}
    if(out.length>3000)throw Error('Please export a smaller Kite date range.');
    return out;
  }
  const name=s=>String(s===undefined||s===null?'':s).toLowerCase().replace(/[^a-z0-9]/g,'');
  function findHeader(rows){
    for(let i=0;i<Math.min(rows.length,200);i++){
      const cols=(rows[i]||[]).map(name),names=['symbol','tradedate','tradetype','quantity','price','tradeid','orderid','orderexecutiontime'];
      if(names.every(n=>cols.includes(n)))return {row:i,cols};
    }
    return null;
  }
  function findPnlHeader(rows){
    for(let i=0;i<Math.min(rows.length,200);i++){
      const cols=(rows[i]||[]).map(name);
      if(['symbol','quantity','buyvalue','sellvalue','realizedpnl'].every(k=>cols.includes(k)))
        return {row:i,cols};
    }
    return null;
  }
  function clientIdFrom(rows,before){
    for(const row of rows.slice(0,before)){
      const at=(row||[]).findIndex(x=>name(x)==='clientid');
      if(at>=0)return String(row[at+1]||'').trim().toUpperCase();
    }
    return '';
  }
  function numeric(v,context){
    const normalized=String(v===null||v===undefined?'':v).replace(/[,₹\s]/g,'').trim();
    const n=Number(normalized);
    if(normalized===''||!Number.isFinite(n))throw Error('Invalid numeric value in Kite '+context+'.');
    return n;
  }
  function parsePnl(rows){
    const head=findPnlHeader(rows);if(!head)throw Error('No Kite P&L table found.');
    const metadata=rows.slice(0,head.row).flat().map(x=>String(x||'')).find(x=>/P\s*&\s*L Statement for F\s*&\s*O from/i.test(x))||'';
    const range=/from\s+(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/i.exec(metadata);
    if(!range)throw Error('Kite P&L reporting dates not found.');
    const findSummary=(key)=>{
      for(const row of rows.slice(0,head.row)){
        const i=(row||[]).findIndex(x=>name(x)===key);
        if(i>=0&&row[i+1]!==undefined&&row[i+1]!==''&&row[i+1]!==null)
          return numeric(row[i+1],key);
      }
      throw Error('Kite P&L summary missing '+key+'.');
    };
    const at=k=>head.cols.indexOf(k);
    const result=[];
    for(let i=head.row+1;i<rows.length;i++){
      const row=rows[i]||[],symbol=String(row[at('symbol')]||'').trim().toUpperCase();
      if(!symbol)continue;
      // Do not silently discard non-NIFTY profit while displaying the statement's net total.
      if(!/^NIFTY[0-9A-Z]{6,30}(CE|PE)$/.test(symbol))
        throw Error('This P&L export includes instruments other than supported NIFTY options. Use a NIFTY-only report.');
      const quantity=numeric(row[at('quantity')],'quantity');
      const buyValue=numeric(row[at('buyvalue')],'buy value');
      const sellValue=numeric(row[at('sellvalue')],'sell value');
      const realizedPnl=numeric(row[at('realizedpnl')],'realized P&L');
      if(!Number.isInteger(quantity)||quantity<=0)throw Error('Invalid P&L quantity in row '+(i+1));
      result.push({symbol,quantity,buyValue,sellValue,realizedPnl});
    }
    if(!result.length||result.length>150)throw Error('No supported NIFTY option P&L entries found (maximum 150).');
    const grossPnl=findSummary('realizedpnl'),charges=findSummary('charges');
    const otherCredits=findSummary('othercreditdebit'),unrealizedPnl=findSummary('unrealizedpnl');
    const total=Math.round(result.reduce((s,x)=>s+x.realizedPnl,0)*100)/100;
    if(Math.abs(total-grossPnl)>.02)throw Error('P&L statement totals do not match its instrument rows. Check report filters.');
    return {kind:'pnl',clientId:clientIdFrom(rows,head.row),startDate:range[1],endDate:range[2],
      grossPnl,charges,otherCredits,unrealizedPnl,rows:result};
  }
  function day(value){
    if(typeof value==='number')return excelSerial(value).slice(0,10);
    const s=String(value||'').trim();
    if(/^\d{4}-\d{2}-\d{2}/.test(s))return s.slice(0,10);
    const m=/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/.exec(s);
    if(m)return m[3]+'-'+m[2]+'-'+m[1];
    throw Error('Unrecognised trade date: '+s.slice(0,20));
  }
  function clock(value,tradeDate){
    if(typeof value==='number')return excelSerial(value);
    const s=String(value||'').trim().replace(' ','T');
    if(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(s))return s;
    if(/^\d{2}:\d{2}:\d{2}$/.test(s))return tradeDate+'T'+s;
    throw Error('Unrecognised Kite execution time.');
  }
  function parseTrades(rows){
    const head=findHeader(rows);if(!head)throw Error('Kite Tradebook columns not found.');
    const clientId=clientIdFrom(rows,head.row);
    const at=k=>head.cols.indexOf(k),optional=k=>at(k)<0?null:at(k);
    const fills=[];let skipped=0;
    for(let i=head.row+1;i<rows.length;i++){
      const row=rows[i]||[],sym=String(row[at('symbol')]||'').trim().toUpperCase();
      if(!sym)continue;
      const seg=optional('segment'),segment=seg===null?'FO':String(row[seg]||'').toUpperCase().replace('&','');
      if(!/^NIFTY[0-9A-Z]{6,30}(CE|PE)$/.test(sym)||!['FO','F&O','NFO'].includes(segment)){skipped++;continue;}
      const q=Number(String(row[at('quantity')]||'').replace(/,/g,'')),p=Number(String(row[at('price')]||'').replace(/,/g,''));
      const tradeDate=day(row[at('tradedate')]),time=clock(row[at('orderexecutiontime')],tradeDate);
      const side=String(row[at('tradetype')]||'').trim().toLowerCase();
      const exchangeCol=optional('exchange'),exchange=exchangeCol===null?'NSE':String(row[exchangeCol]||'').trim().toUpperCase();
      const tradeId=String(row[at('tradeid')]??'').trim(),orderId=String(row[at('orderid')]??'').trim();
      if(!['buy','sell'].includes(side)||!Number.isInteger(q)||q<=0||!Number.isFinite(p)||p<=0||
         !tradeId||!orderId||!time.startsWith(tradeDate+'T'))throw Error('Incomplete trade data on worksheet row '+(i+1)+'.');
      fills.push({symbol:sym,exchange,tradeDate,time,side,quantity:q,price:p,tradeId,orderId});
    }
    if(!fills.length)throw Error('No supported NIFTY option fills found.');
    if(fills.length>MAX_FILLS)throw Error('This Tradebook has '+fills.length+' fills. Please export a smaller date range (max '+MAX_FILLS+' per upload).');
    return {kind:'tradebook',fills,clientId,skipped};
  }
  function renderPreview(data){
    approved=data;
    const status=$('kite-preview-status'),list=$('kite-preview'),btn=$('kite-import-confirm');
    list.replaceChildren();
    if(data.kind==='pnl'){
      const net=Math.round((data.grossPnl+data.otherCredits-data.charges)*100)/100;
      status.textContent='Kite P&L · '+data.startDate+' to '+data.endDate+' · '+
        data.rows.length+' instruments · Gross ₹'+data.grossPnl.toFixed(2)+
        ' · Charges ₹'+data.charges.toFixed(2)+' · Net ₹'+net.toFixed(2)+
        '. No individual execution times or charges are available.';
      for(const r of data.rows.slice(0,12)){
        const el=document.createElement('div');el.className='kite-preview-row';
        el.textContent=r.symbol+' · '+r.quantity+' units · Gross ₹'+r.realizedPnl.toFixed(2);
        list.append(el);
      }
      btn.textContent='Confirm P&L statement';
    }else{
      const buys=data.fills.filter(f=>f.side==='buy').length,sells=data.fills.length-buys;
      status.textContent=data.fills.length+' NIFTY option fills found · '+buys+' buys · '+sells+' sells. '+
        (data.skipped?data.skipped+' unsupported rows excluded. ':'')+' Gross P&L until a P&L statement is imported.';
      for(const f of data.fills.slice(0,12)){
        const el=document.createElement('div');el.className='kite-preview-row';
        el.textContent=f.tradeDate+' · '+f.side.toUpperCase()+' '+f.symbol+' · '+f.quantity+' @ ₹'+f.price.toFixed(2);
        list.append(el);
      }
      btn.textContent='Import '+data.fills.length+' confirmed fills';
    }
    const size=data.kind==='pnl'?data.rows.length:data.fills.length;
    if(size>12){const more=document.createElement('p');more.textContent='…and '+(size-12)+' more rows';list.append(more);}
    $('kite-client').value=data.clientId||'';
    $('kite-client').placeholder=data.clientId?'Detected from Kite':'Required: broker Client ID';
    btn.disabled=false;btn.hidden=false;
  }
  fileInput.addEventListener('change',async()=>{
    approved=null;$('kite-import-confirm').hidden=true;$('kite-import-confirm').disabled=true;
    $('kite-preview').replaceChildren();
    const file=fileInput.files&&fileInput.files[0];if(!file)return;
    $('kite-preview-status').textContent='Reading workbook on this device…';
    try{
      if(file.size<1||file.size>MAX_FILE)throw Error('File must be below 6 MB.');
      const suffix=file.name.split('.').pop().toLowerCase();
      if(!['xlsx','csv'].includes(suffix))throw Error('Choose a Kite .xlsx or .csv tradebook or P&L statement.');
      const rows=suffix==='csv'?csvRows(await file.text()):await readXlsx(file);
      renderPreview(findPnlHeader(rows)?parsePnl(rows):parseTrades(rows));
    }catch(error){$('kite-preview-status').textContent=error.message||'Could not read the Kite report.';}
  });
  $('kite-import-confirm').addEventListener('click',()=>{
    if(!approved)return;
    const clientId=$('kite-client').value.trim().toUpperCase();
    if(!/^[A-Z0-9_-]{3,24}$/.test(clientId)){
      $('kite-preview-status').textContent='Enter the correct Kite Client ID to protect against importing another account.';
      return;
    }
    $('kite-preview-status').textContent='Saving reviewed Kite '+(approved.kind==='pnl'?'P&L statement':'tradebook')+'…';
    const detail=approved.kind==='pnl'?{...approved,clientId}:{kind:'tradebook',clientId,fills:approved.fills};
    root.dispatchEvent(new CustomEvent('kite:import',{detail}));
  });
})();
