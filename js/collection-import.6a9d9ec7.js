/* Reviewed, append-only CSV imports. Each saved row is one physical copy.
   File data is never HTML, executable code, verified pricing, or a listing. */
(() => {
  'use strict';
  const MAX_COPIES = 2000, MAX_BYTES = 2_000_000;
  const historyKeys=['flips','tombstones','copy_sales_v1','sale_recovery_v1','sale_conflict_v1','inventory_conflict_v1','inventory_restore_v1'];
  const recoveryPolicy=()=>{if(!window.CardResellInventoryRecoveryPolicy?.backupRetired)throw Error('Reload CardResell before importing so its inventory protection is available.');return window.CardResellInventoryRecoveryPolicy;};
  const fields = [
    ['card','Card name',['card','card name','name','product name']],
    ['set','Set',['set','set name']],
    ['number','Card number',['card number','number','collector number']],
    ['game','Game',['game','category','product line']],
    ['quantity','Quantity',['quantity','qty','count']],
    ['buyPrice','Cost per card (USD)',['cost basis','purchase price','cost per card','purchase price per card']],
    ['currentValue','Saved value per card (USD)',['current value','market price','market value','tcg market price']],
    ['condition','Condition',['condition']],
    ['finish','Finish / printing',['finish','printing','variant']],
    ['grader','Grading company',['grader','grading company']],
    ['grade','Grade',['grade']],
    ['cert','Certificate',['certificate','cert','certification number']],
    ['id','CardResell Collection ID',['collection id']],
    ['currency','Currency',['currency']],
    ['addedDate','Acquired date (YYYY-MM-DD)',['added date','acquired date']],
    ['location','Storage location',['storage location','location','bin','box']],
    ['sku','Source SKU / stock code',['source sku','sku','stock code']],
  ];
  const games = [['','Choose a game'],['pokemon','Pokémon'],['pokemonjp','Pokémon (Japanese)'],['mtg','Magic: The Gathering'],['yugioh','Yu-Gi-Oh!'],['lorcana','Lorcana'],['onepiece','One Piece'],['sports','Sports']];
  const norm = v => String(v ?? '').trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
  const gameMap = new Map(games.filter(([key])=>key).flatMap(([key,label])=>[[norm(key),key],[norm(label),key]]));
  for (const [alias,key] of [['magic','mtg'],['pokemonjapanese','pokemonjp'],['pokemontcg','pokemon'],['yugiohtradingcardgame','yugioh'],['disneylorcana','lorcana'],['onepiececardgame','onepiece']]) gameMap.set(alias,key);
  const conditions = new Map([['nm','NM'],['nearmint','NM'],['lp','LP'],['lightlyplayed','LP'],['mp','MP'],['moderatelyplayed','MP'],['hp','HP'],['heavilyplayed','HP'],['dmg','DMG'],['damaged','DMG']]);
  const bytes = s => new TextEncoder().encode(s).byteLength;
  function parse(text) {
    if (typeof text !== 'string' || bytes(text) > MAX_BYTES) throw Error('Choose a CSV file smaller than 2 MB.');
    text = text.replace(/^\uFEFF/,'');
    const rows = []; let row = [], value = '', quoted = false, closed = false;
    const pushCell = () => { if (value.length > 4096) throw Error('A CSV cell is too long (maximum 4,096 characters).'); row.push(value); value=''; closed=false; if (row.length>64) throw Error('A CSV can have at most 64 columns.'); };
    const pushRow = () => { pushCell(); if (row.some(v=>v.trim())) rows.push(row); row=[]; if (rows.length>MAX_COPIES+1) throw Error('Split the file into at most 2,000 data rows per import.'); };
    for (let i=0; i<text.length; i++) {
      const c=text[i];
      if (quoted) { if (c==='"') { if (text[i+1]==='"') { value+='"'; i++; } else { quoted=false; closed=true; } } else value+=c; }
      else if (c===',') pushCell();
      else if (c==='\r' || c==='\n') { if (c==='\r' && text[i+1]==='\n') i++; pushRow(); }
      else if (c==='"') { if (value || closed) throw Error('Invalid CSV quoting. Export the file as CSV again.'); quoted=true; }
      else { if (closed) throw Error('Unexpected text after a quoted CSV cell.'); value+=c; }
    }
    if (quoted) throw Error('An opening quote has no closing quote. Export the file as CSV again.');
    if (value || row.length || closed) pushRow();
    if (rows.length<2) throw Error('Include a header row and at least one card.');
    const headers=rows.shift().map(v=>v.trim());
    if (headers.some(v=>!v) || new Set(headers.map(norm)).size!==headers.length) throw Error('Each CSV column needs a distinct, non-empty heading.');
    if (rows.some(r=>r.length!==headers.length)) throw Error('Some rows have a different number of columns. Check commas and quotes in the CSV.');
    return {headers, rows};
  }
  function autoMap(headers) {
    const out={};
    for (const [key,,aliases] of fields) {
      const matches=headers.map((h,i)=>aliases.some(a=>norm(a)===norm(h))?i:-1).filter(i=>i>=0);
      out[key]=matches.length===1?matches[0]:-1;
    }
    return out;
  }
  function money(raw,label) {
    const s=String(raw??'').trim(); if (!s) return null;
    if (!/^\$?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s)) throw Error(label+' must be a non-negative USD amount with at most two decimal places.');
    const n=Number(s.replace(/[$,]/g,''));
    if (!Number.isFinite(n) || n>999999.99) throw Error(label+' exceeds $999,999.99 per card.');
    return n;
  }
  function textCell(value,limit,label) {
    const s=String(value??'').trim();
    if (s.length>limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) throw Error(label+' is too long or contains unsupported characters.');
    return s;
  }
  async function digest(s) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))].map(b=>b.toString(16).padStart(2,'0')).join(''); }
  function readRows(raw) {
    let rows; try { rows=JSON.parse(raw===null?'[]':raw); } catch { throw Error('Your saved collection could not be read. Import stopped to protect it.'); }
    if (!Array.isArray(rows) || rows.some(p=>!p || typeof p!=='object' || Array.isArray(p) || !(typeof p.id==='string'&&p.id.trim()&&p.id.length<=1024||typeof p.id==='number'&&Number.isFinite(p.id)))) throw Error('Your saved collection needs attention before importing. Export a backup first.');
    if (new Set(rows.map(p=>String(p.id))).size!==rows.length) throw Error('Your saved collection has duplicate IDs. Import stopped to protect your cards.');
    return rows;
  }
  const copyId = key => 'imp_'+key.slice(5).replace(/:/g,'_');
  async function plan(csv,mapping,options,existing,history={}) {
    const used=Object.values(mapping).filter(v=>Number.isInteger(v)&&v>=0);
    if (new Set(used).size!==used.length) throw Error('Use each CSV column only once.');
    if (!Number.isInteger(mapping.card) || mapping.card<0 || mapping.card>=csv.headers.length) throw Error('Choose the column containing card names.');
    if (used.some(i=>i>=csv.headers.length)) throw Error('A selected column is no longer available.');
    if (options.mode==='new' && mapping.id>=0) throw Error('CardResell IDs identify existing copies. Choose “Ignore” for that column only if these are new purchases.');
    const sold=history.flips||[], marks=history.tombstones||{};
    const byId=new Set([...existing,...sold].flatMap(p=>[p.id,p.sourceCollectionId]).filter(v=>v!=null).map(String));
    // A sale report may be deleted while its physical-copy receipt remains.
    // Share the strict recovery rules rather than treating missing reports as stock.
    const retired=new Set([...recoveryPolicy().backupRetired(history),...Object.keys(marks.flips||{})]);
    const imports=new Set([...existing,...sold].map(p=>p.importKey).filter(Boolean));
    const printKey=p=>[p.card,p.set,p.number,p.game].map(norm).join('|');
    const prints=new Set(existing.map(printKey));
    const occurrence=new Map(), ids=new Set(), rows=[], errors=[];
    let copies=0, skipped=0, possible=0, missingCost=0, missingValue=0, inputCopies=0;
    const get=(r,k)=>mapping[k]>=0?String(r[mapping[k]]??'').trim():'';
    for (const [index,raw] of csv.rows.entries()) {
      try {
        const card=textCell(get(raw,'card'),180,'Card name'); if (!card) throw Error('Card name is missing.');
        const gameText=get(raw,'game') || options.game || '';
        const game=gameMap.get(norm(gameText)); if (!game) throw Error(gameText?'Game “'+gameText.slice(0,60)+'” is not recognized. Map the game column or choose a default game.':'Choose a game or map the Game column.');
        const qtyRaw=get(raw,'quantity') || '1', quantity=Number(qtyRaw);
        if (!/^\d+$/.test(qtyRaw) || !Number.isSafeInteger(quantity) || quantity<1 || quantity>MAX_COPIES) throw Error('Quantity must be a whole number from 1 to 2,000.');
        inputCopies+=quantity;
        if(inputCopies>MAX_COPIES)throw Error('The file contains more than 2,000 physical copies. Split it into smaller files.');
        const currency=get(raw,'currency'); if (currency && currency.toUpperCase()!=='USD') throw Error('Only USD imports are supported. Convert amounts to USD first.');
        const conditionText=get(raw,'condition'), condition=conditions.get(norm(conditionText)) || '';
        if (conditionText && !condition) throw Error('Condition is not recognized. Use NM, LP, MP, HP or DMG; leave raw condition blank for graded cards.');
        const grader=textCell(get(raw,'grader'),25,'Grader').toLowerCase(), grade=get(raw,'grade');
        if (Boolean(grader)!==Boolean(grade) || (grade && (!/^\d+(?:\.\d)?$/.test(grade) || Number(grade)<=0 || Number(grade)>10))) throw Error('Graded cards need both a grading company and a numeric grade from 0.1 to 10.');
        const cert=textCell(get(raw,'cert'),100,'Certificate');
        if (cert && (!grader || quantity!==1)) throw Error('A certificate needs a grading company and exactly one physical card.');
        const id=textCell(get(raw,'id'),128,'Collection ID');
        if (id && (quantity!==1 || ids.has(id))) throw Error('Each CardResell Collection ID must occur once with quantity 1.');
        if (id) ids.add(id);
        const date=get(raw,'addedDate');
        if (date && (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date)) throw Error('Acquired date must be a real date in YYYY-MM-DD format.');
        const record={card,set:textCell(get(raw,'set'),180,'Set'),number:textCell(get(raw,'number'),40,'Card number'),game,
          buyPrice:money(get(raw,'buyPrice'),'Cost'),currentValue:money(get(raw,'currentValue'),'Saved value'),
          condition:condition||null,finish:textCell(get(raw,'finish'),80,'Finish'),grader:grader||null,grade:grade||null,cert:cert||null,addedDate:date||null,
          location:textCell(get(raw,'location'),120,'Storage location'),sku:textCell(get(raw,'sku'),100,'Source SKU')};
        const signature=JSON.stringify({...record,quantity});
        const order=(occurrence.get(signature)||0)+1; occurrence.set(signature,order);
        const hash=await digest(signature), entries=[];
        for(let copy=0;copy<quantity;copy++) {
          const importKey='csv1:'+hash+':'+order+':'+copy;
          if ((id && (byId.has(id)||retired.has(id))) || (options.mode!=='new' && (imports.has(importKey)||retired.has(copyId(importKey))||byId.has(copyId(importKey))))) { skipped++; continue; }
          entries.push({...record,...(id?{id}:{}),importKey});
        }
        copies+=entries.length;
        if (copies>MAX_COPIES) throw Error('This import contains more than 2,000 new physical copies. Split it into smaller files.');
        if (prints.has(printKey(record))) possible+=entries.length;
        if (record.buyPrice===null) missingCost+=entries.length;
        if (record.currentValue===null) missingValue+=entries.length;
        rows.push({line:index+2,record,quantity,add:entries.length,entries});
      } catch(e) { errors.push('Row '+(index+2)+': '+e.message); }
    }
    if (existing.length+copies>MAX_COPIES) errors.push('Your collection would exceed 2,000 physical cards. There is room for '+Math.max(0,MAX_COPIES-existing.length)+' more.');
    return {rows,errors,copies,skipped,possible,missingCost,missingValue};
  }
  const el=(tag,text)=>{const n=document.createElement(tag); if(text!=null)n.textContent=text; return n;};
  const button=(label,action)=>{const b=el('button',label);b.type='button';b.onclick=action;return b;};
  const account=()=>window.googleUser?.sub || null;
  let active=null;
  function open() {
    if (!account()) { window.triggerGoogleSignIn?.('collection'); return; }
    if(active) { active.dialog.focus(); return; }
    if (!document.getElementById('collectionImportStyle')) {
      const style=el('style');style.id='collectionImportStyle';style.textContent=`
.collection-import{color:var(--text,#eee);background:var(--bg,#111);border:1px solid var(--border,#444);border-radius:16px;width:min(820px,calc(100vw - 24px));max-height:calc(100dvh - 32px);padding:0;box-sizing:border-box;overflow:auto;overscroll-behavior:contain}
.collection-import::backdrop{background:rgba(0,0,0,.75)}
.collection-import-body{padding:20px;display:grid;gap:16px;line-height:1.5}
.collection-import h2,.collection-import p{margin:0}.collection-import p{font-size:.87rem}
.collection-import header{display:flex;justify-content:space-between;align-items:center;gap:10px}
.collection-import button,.collection-import select,.collection-import input[type=file]{min-height:44px;font:inherit;font-size:.85rem;color:var(--text,#eee);background:var(--surface-2,#222);border:1px solid var(--border,#555);border-radius:8px;padding:10px;box-sizing:border-box;max-width:100%}
.collection-import button{cursor:pointer}.collection-import button:disabled{opacity:.45;cursor:default}
.collection-import :is(button,input,select):focus-visible{outline:2px solid var(--gold,#d4af37);outline-offset:2px}
.collection-import [hidden]{display:none!important}.collection-import label{display:grid;gap:5px;font-size:.8rem;min-width:0}
.collection-import-mapping{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px}
.collection-import footer{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:10px}
.collection-import [data-import-commit]{background:var(--gold,#d4af37);color:#171108;font-weight:700}
.collection-import .import-check{display:flex;align-items:flex-start;gap:10px}.collection-import .import-check input{width:22px;height:22px;flex-shrink:0}
.collection-import table{width:100%;border-collapse:collapse;font-size:.8rem}.collection-import th,.collection-import td{padding:8px;text-align:left;border-bottom:1px solid var(--border,#444);overflow-wrap:anywhere}
.collection-import-preview{overflow:auto;max-height:330px;border:1px solid var(--border,#444);border-radius:8px}
.collection-import [role=alert]{color:var(--danger-text,#ff9999);white-space:pre-line;font-size:.85rem}
@media(max-width:600px){
.collection-import table,.collection-import tbody{display:block}.collection-import thead{display:none}
.collection-import tr{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-bottom:1px solid var(--border,#444)}
.collection-import td{border:0;padding:8px 4px;min-width:0}.collection-import td:first-child{grid-column:1/-1;padding-bottom:0}
.collection-import td[data-label]::before{content:attr(data-label);display:block;color:var(--text-muted,#aaa);font-size:.65rem;margin-bottom:3px}
}
`;document.head.append(style);
    }
    const dialog=el('dialog');dialog.className='collection-import';dialog.id='collectionImportDialog';dialog.setAttribute('aria-labelledby','collectionImportTitle');
    const body=el('div');body.className='collection-import-body';dialog.append(body);
    const state={dialog,owner:account(),key:getUserKey('portfolio'),epoch:0,csv:null,plan:null,mapping:{},busy:false};active=state;
    const header=el('header'),title=el('h2','Import your collection');title.id='collectionImportTitle';
    const close=()=>{state.epoch++;dialog.close();};header.append(title,button('Close',close));body.append(header);
    body.append(el('p','Bring a CSV from CardResell or another inventory app. Match the columns, review the cards, then add them to your collection. Existing cards are never overwritten.'));
    const fileLabel=el('label','Choose CSV file (up to 2 MB)'),file=el('input');file.type='file';file.accept='.csv,text/csv';fileLabel.append(file);body.append(fileLabel);
    const settings=el('div');settings.hidden=true;settings.className='collection-import-mapping';body.append(settings);
    const defaults=el('label','Default game for blank game cells'),game=el('select');game.setAttribute('aria-label','Default game');
    games.forEach(([v,t])=>{const o=el('option',t);o.value=v;game.append(o);});defaults.append(game);settings.append(defaults);
    const modeLabel=el('label','Previously imported rows'),mode=el('select');mode.setAttribute('aria-label','Previously imported rows');
    for(const [v,t] of [['skip','Skip previously imported copies'],['new','Add as new purchases']]){const o=el('option',t);o.value=v;mode.append(o);}modeLabel.append(mode);settings.append(modeLabel);
    const mapping=el('div');mapping.className='collection-import-mapping';body.append(mapping);
    const note=el('p','Amounts are USD per card. Quantity creates separate physical copies. Blank costs and values stay unknown. Imported values are saved estimates; prices and card identities are not verified by this import.');body.append(note);
    const status=el('p');status.setAttribute('role','status');status.dataset.importStatus='';body.append(status);
    const error=el('div');error.setAttribute('role','alert');body.append(error);
    const preview=el('div');preview.hidden=true;preview.className='collection-import-preview';body.append(preview);
    const label=el('label');label.className='import-check';label.hidden=true;const confirm=el('input');confirm.type='checkbox';confirm.id='collectionImportConfirm';label.append(confirm,el('span','I reviewed the columns, USD amounts per card, and quantities. These are copies I want to add.'));body.append(label);
    const review=button('Review import',reviewFile);review.disabled=true;review.dataset.importReview='';
    const commit=button('Add reviewed cards',commitFile);commit.disabled=true;commit.dataset.importCommit='';
    const footer=el('footer');footer.append(button('Cancel',close),review,commit);body.append(footer);
    const current=()=>active===state && dialog.open && account()===state.owner && getUserKey('portfolio')===state.key;
    const historySnapshot=()=>Object.fromEntries(historyKeys.map(key=>[key,localStorage.getItem(getUserKey(key))]));
    function readHistory(snapshot) {
      const read=(key,fallback,label)=>{try{return snapshot[key]===null?fallback:JSON.parse(snapshot[key]);}catch{throw Error('Your saved '+label+' could not be read. Import stopped to protect it. Download a recovery backup before changing these records.');}};
      for(const [key,place] of [['sale_recovery_v1','the saved sale in Collection'],['sale_conflict_v1','the saved choice in Review sale sync'],['inventory_conflict_v1','the saved choice in Review inventory sync'],['inventory_restore_v1','the saved request in Recover inventory']]){
        if(read(key,null,'recovery progress')!==null)throw Error('Finish '+place+' before importing cards.');
      }
      const history={flips:readRows(snapshot.flips),tombstones:read('tombstones',{},'deletion history'),copy_sales_v1:read('copy_sales_v1',null,'sold-copy history')};
      if(!history.tombstones||typeof history.tombstones!=='object'||Array.isArray(history.tombstones))throw Error('Your saved deletion history needs attention before importing.');
      recoveryPolicy().backupRetired(history);return history;
    }
    const unchanged=()=>localStorage.getItem(state.key)===state.snapshot&&JSON.stringify(historySnapshot())===JSON.stringify(state.historySnapshot);
    function invalidate() { state.epoch++;state.plan=null;preview.hidden=true;label.hidden=true;confirm.checked=false;commit.disabled=true;error.textContent='';status.textContent='';review.disabled=!state.csv; }
    function checkAccount() { if(current())return true;close();window.showToast?.('Account changed. Reopen Import CSV in your current collection.','info');return false; }
    game.onchange=invalidate;mode.onchange=invalidate;
    confirm.onchange=()=>{commit.disabled=!confirm.checked || !state.plan || state.plan.errors.length>0 || !state.plan.copies;};
    file.onchange=async()=>{
      invalidate();state.csv=null;review.disabled=true;mapping.replaceChildren();settings.hidden=true;
      const selected=file.files?.[0],epoch=state.epoch;if(!selected)return;
      try {
        if(selected.size>MAX_BYTES)throw Error('Choose a CSV file smaller than 2 MB.');
        const source=await selected.text();if(!current() || epoch!==state.epoch)return;
        state.csv=parse(source);state.mapping=autoMap(state.csv.headers);
        for(const [key,title] of fields) {
          const label=el('label',title),select=el('select');select.dataset.column=key;select.setAttribute('aria-label',title+' column');
          const ignore=el('option',key==='card'?'Choose a column':'Ignore');ignore.value='-1';select.append(ignore);
          state.csv.headers.forEach((h,i)=>{const o=el('option',h);o.value=String(i);select.append(o);});select.value=String(state.mapping[key]);
          select.onchange=()=>{state.mapping[key]=Number(select.value);invalidate();};label.append(select);mapping.append(label);
        }
        settings.hidden=false;review.disabled=false;status.textContent=state.csv.rows.length+' data rows loaded. Check the column matches, then review.';
      } catch(e) { if(current()&&epoch===state.epoch)error.textContent=e.message; }
    };
    async function reviewFile() {
      if(!checkAccount() || !state.csv)return;
      invalidate();const epoch=state.epoch;review.disabled=true;status.textContent='Checking all rows…';
      try {
        const snapshot=localStorage.getItem(state.key),existing=readRows(snapshot),historyState=historySnapshot();
        const result=await plan(state.csv,{...state.mapping},{game:game.value,mode:mode.value},existing,readHistory(historyState));
        if(!current() || epoch!==state.epoch)return;
        if(localStorage.getItem(state.key)!==snapshot||JSON.stringify(historySnapshot())!==JSON.stringify(historyState))throw Error('Your collection or sales history changed during review. Review again to include the latest cards.');
        state.plan=result;state.snapshot=snapshot;state.historySnapshot=historyState;state.newPurchases=mode.value==='new';
        error.textContent=result.errors.slice(0,20).join('\n')+(result.errors.length>20?'\n'+(result.errors.length-20)+' more rows need correction.':'');
        status.textContent=`${result.copies} new copies · ${result.skipped} existing copies skipped · ${result.missingCost} missing costs · ${result.missingValue} missing values.`
          +(result.possible?` ${result.possible} new copies match names/sets already in your collection; check that they are additional purchases.`:'')
          +(result.skipped?' Skipped copies keep their saved details, including recorded sales and deletions.':'');
        preview.replaceChildren();const table=el('table'),head=el('thead'),hr=el('tr');['Card / set','Qty','Adding','Cost each','Value each'].forEach(t=>hr.append(el('th',t)));head.append(hr);table.append(head);const tbody=el('tbody');
        for(const r of result.rows.slice(0,20)){
          const tr=el('tr'),card=el('td',r.record.card+' · '+(r.record.set||'Set unknown'));
          const details=[r.record.number&&'#'+r.record.number,r.record.condition,r.record.finish,
            r.record.grader&&r.record.grader.toUpperCase()+' '+r.record.grade,r.record.cert&&'Cert '+r.record.cert,
            r.record.location&&'Location: '+r.record.location,r.record.sku&&'SKU: '+r.record.sku].filter(Boolean);
          if(details.length)card.append(el('div',details.join(' · ')));
          tr.append(card);[r.quantity,r.add,r.record.buyPrice===null?'Unknown':'$'+r.record.buyPrice.toFixed(2),r.record.currentValue===null?'Unknown':'$'+r.record.currentValue.toFixed(2)].forEach((v,i)=>{const td=el('td',String(v));td.dataset.label=['Qty','Adding','Cost each','Value each'][i];tr.append(td);});tbody.append(tr);
        }table.append(tbody);preview.append(table);
        if(result.rows.length>20)preview.append(el('p',`Showing the first 20 of ${result.rows.length} valid rows. All rows were checked.`));preview.hidden=false;
        label.hidden=result.errors.length>0 || !result.copies;commit.textContent='Add '+result.copies+' reviewed '+(result.copies===1?'card':'cards');
      } catch(e) { if(current()&&epoch===state.epoch){state.plan=null;error.textContent=e.message;status.textContent='';} }
      finally { if(current()&&epoch===state.epoch)review.disabled=false; }
    }
    async function commitFile() {
      if(state.busy || !checkAccount() || !confirm.checked || !state.plan || state.plan.errors.length || !state.plan.copies)return;
      const epoch=state.epoch,lock='cardresell:'+getUserKey('sale_recovery_v1');
      const disabled=new Map([...dialog.querySelectorAll('button,input,select')].map(n=>[n,n.disabled]));
      state.busy=true;disabled.forEach((_,n)=>n.disabled=true);
      try {
        if(!navigator.locks?.request)throw Error('Update your browser to import inventory safely across tabs.');
        await navigator.locks.request(lock,()=>{
        if(!checkAccount() || epoch!==state.epoch)return;
        if(!unchanged()) {invalidate();throw Error('Your collection or sales history changed. Review again before adding cards.');}
        const existing=readRows(state.snapshot),now=Date.now(),taken=new Set(existing.map(p=>String(p.id)));
        const added=state.plan.rows.flatMap(r=>r.entries).map(p=>{
          const id=p.id || (state.newPurchases?crypto.randomUUID():copyId(p.importKey));
          if(taken.has(id))throw Error('A copy ID already exists. Review again.');taken.add(id);
          return {...p,id,updatedAt:now,addedDate:p.addedDate||new Date(now).toISOString().slice(0,10),cardType:p.game==='pokemonjp'?'pokemon':p.game,valueSource:'import',importedAt:now,
            // An exported display label cannot prove a finish was visually confirmed.
            ...(p.finish?{finishReviewRequired:true,finishConfirmed:false}:{})};
        });
        const next=existing.concat(added);
        const {flips,tombstones,copy_sales_v1}=readHistory(state.historySnapshot);
        if(!Array.isArray(flips) || bytes(JSON.stringify({portfolio:next,flips,tombstones,copySales:copy_sales_v1,clientUpdatedAt:now}))+1024>900000)throw Error('This import would exceed the account sync size limit. Split it into a smaller batch.');
        // The shared sale/recovery lock serializes participating tabs. Check and
        // perform the single storage write synchronously inside that lock.
        if(savePortData(next)!==true)throw Error('The cards could not be saved on this device. Free some storage and try again.');
        close();window.renderCollectionView?.();window.showToast?.(added.length+' cards added on this device. Account sync will confirm separately.','success');
        });
      } catch(e) {if(current())error.textContent=e.message;}
      finally{state.busy=false;if(current()){disabled.forEach((was,n)=>n.disabled=was);commit.disabled=!confirm.checked||!state.plan||state.plan.errors.length>0||!state.plan.copies;review.disabled=!state.csv;}}
    }
    dialog.addEventListener('cancel',e=>{if(state.busy)e.preventDefault();});
    const timer=setInterval(()=>{if(active===state && !current())checkAccount();},300);
    dialog.addEventListener('close',()=>{clearInterval(timer);state.epoch++;if(active===state)active=null;dialog.remove();document.getElementById('collectionImportBtn')?.focus();},{once:true});
    document.body.append(dialog);dialog.showModal();file.focus();
  }
  window.CardResellCollectionImport={open,parse,autoMap,plan,readRows};
})();
