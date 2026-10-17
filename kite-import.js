/* Kite Tradebook reader: local XLSX/CSV preview, no external scripts or third-party upload. */
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
      raw=new Uint8Array(await new Response(stream).arrayBuffer());
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
      if(findHeader(rows))return rows;
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
    let clientId='';
    for(const row of rows.slice(0,head.row)){
      const at=(row||[]).findIndex(x=>name(x)==='clientid');
      if(at>=0){clientId=String(row[at+1]||'').trim().toUpperCase();break;}
    }
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
    return {fills,clientId,skipped};
  }
  function renderPreview(data){
    approved=data;
    const status=$('kite-preview-status'),list=$('kite-preview'),btn=$('kite-import-confirm');
    const buys=data.fills.filter(f=>f.side==='buy').length,sells=data.fills.length-buys;
    status.textContent=data.fills.length+' NIFTY option fills found · '+buys+' buys · '+sells+' sells. '+
      (data.skipped?data.skipped+' non-NIFTY / unsupported rows excluded. ':'')+
      'Preview only; imported history has GROSS P&L, not net P&L.';
    list.replaceChildren();
    data.fills.slice(0,12).forEach(f=>{
      const div=document.createElement('div');div.className='kite-preview-row';
      div.textContent=f.tradeDate+' · '+f.side.toUpperCase()+' '+f.symbol+' · '+f.quantity+' @ ₹'+f.price.toFixed(2);
      list.append(div);
    });
    if(data.fills.length>12){const more=document.createElement('p');more.textContent='…and '+(data.fills.length-12)+' more fills';list.append(more);}
    $('kite-client').value=data.clientId||'';
    $('kite-client').placeholder=data.clientId?'Detected from Kite':'Required: broker Client ID';
    btn.disabled=false;btn.hidden=false;
    btn.textContent='Import '+data.fills.length+' confirmed fills';
  }
  fileInput.addEventListener('change',async()=>{
    approved=null;$('kite-import-confirm').hidden=true;$('kite-import-confirm').disabled=true;
    $('kite-preview').replaceChildren();
    const file=fileInput.files&&fileInput.files[0];if(!file)return;
    $('kite-preview-status').textContent='Reading workbook on this device…';
    try{
      if(file.size<1||file.size>MAX_FILE)throw Error('File must be below 6 MB.');
      const suffix=file.name.split('.').pop().toLowerCase();
      if(!['xlsx','csv'].includes(suffix))throw Error('Choose a Kite .xlsx or .csv tradebook.');
      const rows=suffix==='csv'?csvRows(await file.text()):await readXlsx(file);
      renderPreview(parseTrades(rows));
    }catch(error){$('kite-preview-status').textContent=error.message||'Could not read Kite tradebook.';}
  });
  $('kite-import-confirm').addEventListener('click',()=>{
    if(!approved)return;
    const clientId=$('kite-client').value.trim().toUpperCase();
    if(!/^[A-Z0-9_-]{3,24}$/.test(clientId)){
      $('kite-preview-status').textContent='Enter the correct Kite Client ID to protect against importing another account.';
      return;
    }
    $('kite-preview-status').textContent='Submitting validated fills to your private EDGE journal…';
    root.dispatchEvent(new CustomEvent('kite:import',{detail:{clientId,fills:approved.fills}}));
  });
})();
