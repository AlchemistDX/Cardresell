/* Reviewed Collection batches. The journal is local to one signed-in account;
   the server remains authoritative for capacity, generations and saved drafts. */
(() => {
  'use strict';
  const PREFIX = 'cr_collection_draft_batch_v1:', MAX_BYTES = 2 * 1024 * 1024;
  const pending = row => ['queued','sending','uncertain'].includes(row.state);
  const active = job => job?.rows.some(pending);
  const account = () => window.googleUser?.uid || window.googleUser?.sub || null;
  const copy = value => JSON.parse(JSON.stringify(value));
  const clean = card => copy(_cardWithoutPhotoBytes(card));
  const node = (tag, text, cls) => {const n=document.createElement(tag);if(text)n.textContent=text;if(cls)n.className=cls;return n;};
  const button = (text, fn) => {const n=node('button',text);n.type='button';n.onclick=fn;return n;};
  const money = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
  const priceText = value => money(value) ? '$'+value.toFixed(2) : 'Needs a price';
  const digest = async text => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),b=>b.toString(16).padStart(2,'0')).join('');
  let owner, job=null, raw=null, readError='', busy=false, pause=false, dialog=null, preview=null, note='';
  let runOwner=null;
  const key = who => PREFIX+encodeURIComponent(who);
  function assertOwner(who) {if(account()!==who)throw Error('Account changed. Reopen Collection for your current account.');}
  function validate(value, who) {
    if(value?.version!==1 || value.owner!==who || typeof value.id!=='string' || !/^[a-f0-9-]{36}$/.test(value.id)
      || !Array.isArray(value.rows) || !value.rows.length || value.rows.length>500 || new Set(value.rows.map(r=>r?.id)).size!==value.rows.length)throw Error('Invalid recovery record');
    for(const row of value.rows) {
      if(!row || typeof row.id!=='string' || !row.card || typeof row.card!=='object' || Array.isArray(row.card)
        || !['queued','sending','uncertain','done','blocked'].includes(row.state) || row.instanceId!=='inst_col_'+row.id
        || !/^[A-Za-z0-9_-]{1,128}$/.test(row.instanceId) || typeof row.idemKey!=='string' || row.idemKey.length>128
        || !row.payload || row.payload.instanceId!==row.instanceId || row.payload.slot!==CR_D1_SLOT
        || typeof row.sourceHash!=='string' || (row.draftId && !/^drf_[a-f0-9]{32}$/.test(row.draftId)))throw Error('Invalid recovery row');
    }
    return value;
  }
  function load(force=false) {
    const who=account();if(who===owner&&!force)return job;
    if(who!==owner){dialog?.close();dialog=null;preview=null;note='';}
    owner=who;job=null;raw=null;readError='';
    if(!who)return null;
    try {raw=localStorage.getItem(key(who));if(raw){if(new TextEncoder().encode(raw).length>MAX_BYTES)throw Error();job=validate(JSON.parse(raw),who);}}
    catch {readError='The saved batch could not be read. Open your drafts to check earlier saves before clearing this recovery record.';}
    return job;
  }
  function save(next) {
    assertOwner(next.owner);
    if(localStorage.getItem(key(next.owner))!==raw)throw Error('This batch changed in another tab. Close this window and reopen its progress.');
    const encoded=JSON.stringify(next);
    if(new TextEncoder().encode(encoded).length>MAX_BYTES)throw Error('This batch is too large to recover in this browser. Select fewer cards.');
    try {localStorage.setItem(key(next.owner),encoded);}catch {throw Error('Batch progress could not be saved in this browser. No further drafts were attempted. Free some browser storage and resume.');}
    raw=encoded;job=next;
  }
  function emit() {window.dispatchEvent(new CustomEvent('cr:collection-draft-progress'));renderProgress();}
  function summary() {
    load();if(readError)return readError;if(!job)return note;
    const done=job.rows.filter(r=>r.state==='done').length,remaining=job.rows.filter(pending).length,blocked=job.rows.filter(r=>r.state==='blocked').length;
    return note || `${done} draft${done===1?'':'s'} ready${remaining?` · ${remaining} to resume`:''}${blocked?` · ${blocked} need review`:''}.`;
  }
  function current() {load();return job;}
  function mount(bar) {
    load();bar.querySelector('[data-batch-recovery]')?.remove();
    if(!job&&!readError)return;
    const box=node('div','','collection-batch-recovery');box.dataset.batchRecovery='';
    box.append(node('span',summary()),button(readError?'Review recovery':active(job)?'Resume saved batch':'View last batch',()=>open()));
    bar.append(box);
  }
  function styles() {
    if(document.getElementById('draftBatchStyles'))return;
    const s=node('style');s.id='draftBatchStyles';s.textContent=`
.draft-batch{width:min(760px,calc(100vw - 28px));max-height:90dvh;box-sizing:border-box;margin:auto;padding:24px;border:1px solid var(--border,#363a46);border-radius:18px;background:var(--surface,#171b24);color:var(--text,#f5f6fa);font:inherit}
.draft-batch::backdrop{background:#000a}.draft-batch h2{margin:0;font-size:1.3rem}.draft-batch p{font-size:.86rem;line-height:1.5;color:var(--text-muted,#adb5c7)}
.draft-batch header,.draft-batch footer,.collection-batch-recovery{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.draft-batch header{margin-bottom:12px}.draft-batch footer{position:sticky;bottom:-24px;background:var(--surface,#171b24);padding:16px 0 4px;margin-top:12px}
.draft-batch button{border:1px solid var(--border,#454958);border-radius:9px;background:var(--surface-2,#262c39);color:inherit;padding:10px 14px;min-height:44px;font:inherit;font-size:.85rem;cursor:pointer}.draft-batch button[data-batch-confirm]{background:var(--gold,#efc45c);border-color:transparent;color:#171108;font-weight:700}.draft-batch button:disabled{opacity:.5;cursor:default}
.draft-batch-fields{display:grid;grid-template-columns:1fr 1fr;gap:14px}.draft-batch label{display:grid;gap:7px;font-size:.8rem}.draft-batch input,.draft-batch select{width:100%;min-height:44px;box-sizing:border-box;padding:10px;border:1px solid var(--border,#454958);border-radius:8px;background:var(--bg,#11151d);color:inherit;font:inherit}.draft-batch [hidden]{display:none!important}
.draft-batch-rows{list-style:none;padding:0;margin:18px 0;display:grid;gap:8px}.draft-batch-rows li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px 16px;padding:12px;border:1px solid var(--border,#363a46);border-radius:10px}.draft-batch-rows small{color:var(--text-muted,#adb5c7);line-height:1.45;overflow-wrap:anywhere}.draft-batch-rows [data-row-message]{grid-column:1/-1;font-size:.8rem;line-height:1.5}.draft-batch [data-batch-note]{font-size:.85rem;line-height:1.5;margin-top:12px}.draft-batch :focus-visible{outline:2px solid var(--gold,#efc45c);outline-offset:2px}
.collection-batch-recovery{border-top:1px solid var(--border);padding-top:12px;font-size:.8rem;line-height:1.5}
@media(max-width:600px){.draft-batch{padding:18px}.draft-batch-fields{grid-template-columns:1fr}.draft-batch footer{bottom:-18px}.draft-batch footer button{flex:1}.draft-batch-rows li{gap:6px 10px}}
`;document.head.append(s);
  }
  function makeDialog(title) {
    dialog?.close();dialog?.remove();styles();
    const d=node('dialog','','draft-batch');dialog=d;d.setAttribute('aria-labelledby','draftBatchHeading');
    const header=node('header'),heading=node('h2',title);heading.id='draftBatchHeading';
    const close=button('Close',()=>d.close());close.setAttribute('aria-label','Close batch preparation');header.append(heading,close);d.append(header);
    d.addEventListener('close',()=>{if(dialog===d){dialog=null;preview=null;}d.remove();});
    document.body.append(d);d.showModal();return d;
  }
  function rowView(row, price) {
    const li=node('li');li.dataset.batchRow=row.id;
    const card=node('div');card.append(node('strong',row.card.card||row.card.name||'Card'),document.createElement('br'),node('small',[row.card.set,row.card.number,row.card.condition,row.card.location].filter(Boolean).join(' · ')));
    li.append(card,node('span',priceText(price)));return li;
  }
  function parseSettings(form) {
    const mode=form.querySelector('[name=priceMode]').value;
    const read=name=>{const value=form.querySelector(`[name=${name}]`).value.trim();if(value==='')return null;if(!/^\d{1,7}(\.\d{1,2})?$/.test(value))throw Error('Use USD amounts with at most two decimal places.');return Number(value);};
    const price=mode==='fixed'?read('fixedPrice'):null;
    if(mode==='fixed'&&!(price>0))throw Error('Enter an asking price above $0.');
    const buyerPays=read('buyerPays'),sellerCost=read('sellerCost');
    if((buyerPays===null)!==(sellerCost===null))throw Error('Enter both shipping amounts, or leave both blank to review them later.');
    return {mode,price,shipping:buyerPays===null?null:{buyerPays:String(buyerPays),sellerCost:String(sellerCost)}};
  }
  function priceFor(card, settings) {
    if(settings.mode==='blank')return {};
    if(settings.mode==='fixed')return {price:settings.price,priceSource:'seller'};
    return money(card.currentValue)?{price:Math.round(card.currentValue*100)/100,priceSource:_crValueProvenance(card)==='comp'?'comp':'seller'}:{};
  }
  function review(ids) {
    const who=account(),rows=ids.map(id=>{const found=_crResolveEntry(loadPortData(),id);if(!found.row||found.ambiguous)throw Error('A selected card changed or has an ambiguous ID. Select it again.');return {id:String(id),card:clean(found.row)};});
    const d=makeDialog(`Prepare ${rows.length} draft${rows.length===1?'':'s'}`);preview={owner:who,rows};
    d.append(node('p','Review prices and shipping for this batch. Existing drafts keep their saved settings.'));
    const form=node('div','','draft-batch-fields');
    const label=node('label','Asking prices'),select=node('select');select.name='priceMode';
    for(const [value,text] of [['saved','Use each saved card value'],['fixed','Same asking price for all'],['blank','Leave prices blank for review']]){const option=node('option',text);option.value=value;select.append(option);}label.append(select);form.append(label);
    for(const [name,title] of [['fixedPrice','Asking price per card (USD)'],['buyerPays','Buyer shipping charge per draft (USD)'],['sellerCost','Your estimated postage per draft (USD)']]){const l=node('label',title),input=node('input');input.name=name;input.inputMode='decimal';input.placeholder=name==='fixedPrice'?'e.g. 2.99':'Leave blank if unknown';input.autocomplete='off';l.append(input);form.append(l);if(name==='fixedPrice')l.hidden=true;}
    d.append(form,node('p','Saved values are estimates. Missing prices stay blank. Shipping applies to each draft.'));
    const list=node('ul','','draft-batch-rows');d.append(list);
    const status=node('div');status.dataset.batchNote='';status.setAttribute('role','status');d.append(status);
    const footer=node('footer'),cancel=button('Cancel',()=>d.close()),confirm=button('Confirm and prepare',()=>start(preview,form));confirm.dataset.batchConfirm='';footer.append(cancel,confirm);d.append(footer);
    function update(){form.querySelector('[name=fixedPrice]').parentElement.hidden=select.value!=='fixed';list.replaceChildren();try{const settings=parseSettings(form);for(const row of rows)list.append(rowView(row,priceFor(row.card,settings).price));status.textContent='';confirm.disabled=busy;}catch(e){for(const row of rows)list.append(rowView(row));status.textContent=e.message;confirm.disabled=true;}}
    form.addEventListener('input',update);form.addEventListener('change',update);update();
  }
  function showProgress() {
    const d=makeDialog('Batch preparation');
    d.append(node('p','Progress stays in this browser for this account. Saved drafts stay on your account. Resume explicitly after an interruption; the original card details and prices are retained.'));
    const list=node('ul','','draft-batch-rows');d.append(list);
    const status=node('div');status.dataset.batchNote='';status.setAttribute('role','status');d.append(status);
    const footer=node('footer');
    const view=button('View drafts',()=>{d.close();switchView('drafts');}),run=button('Resume remaining',()=>resume()),stop=button('Pause after this card',()=>{pause=true;note='Pausing after the current request is confirmed…';emit();});
    run.dataset.batchResume='';stop.dataset.batchPause='';footer.append(view,run,stop);d.append(footer);renderProgress();
  }
  function renderProgress() {
    if(!dialog||preview)return;
    const list=dialog.querySelector('.draft-batch-rows');if(!list)return;
    if(list.dataset.jobId!==(job?.id||'')){list.replaceChildren();list.dataset.jobId=job?.id||'';}
    const existing=new Map([...list.children].map(li=>[li.dataset.batchRow,li]));
    for(const row of job?.rows||[]){let li=existing.get(row.id);if(!li){li=rowView(row,row.payload.price);const message=node('div');message.dataset.rowMessage='';li.append(message);list.append(li);}li.querySelector('[data-row-message]').textContent=row.message||({queued:'Not attempted yet.',sending:'Saving; outcome not yet confirmed.',uncertain:'Saving could not be confirmed. Resume to recover.',done:'Draft ready.',blocked:'Needs review.'}[row.state]);if(row.draftId&&!li.querySelector('button'))li.append(button('Open draft',()=>{dialog.close();openDraftReview(row.draftId);}));}
    dialog.querySelector('[data-batch-note]').textContent=summary();
    const resume=dialog.querySelector('[data-batch-resume]'),stop=dialog.querySelector('[data-batch-pause]');resume.hidden=!active(job)||!!readError;resume.disabled=busy;stop.hidden=!busy;stop.disabled=pause;
  }
  async function locked(who, fn) {
    if(!navigator.locks?.request)throw Error('This browser cannot safely save a recoverable batch. You can still prepare drafts from individual cards.');
    return navigator.locks.request(key(who),{ifAvailable:true},async lock=>{if(!lock)throw Error('This batch is running in another tab. Wait for it to finish or pause there.');assertOwner(who);return fn();});
  }
  async function capacity(count,who) {
    const head=await _bulkDraftHeadroom();assertOwner(who);
    if(!head.known)throw Error('Could not confirm draft capacity. Your selection is preserved; please retry.');
    if(count>head.bulkLimit)throw Error(head.bulkLimit<=1?'Select one card, or choose Starter or above for bulk draft preparation.':`Your plan supports ${head.bulkLimit} cards per action. Select fewer cards or view Subscriptions.`);
  }
  async function start(reviewed,form) {
    if(busy||!reviewed)return;const who=reviewed.owner;let settings;
    // Closing the review withdraws approval while preflight is in progress.
    // Once the journal is saved, closing progress still leaves work recoverable.
    const reviewDialog=dialog;
    const assertReview=()=>{assertOwner(who);if(preview!==reviewed||!reviewDialog?.open)throw Error('Batch preparation cancelled. Your selected cards are unchanged.');};
    try{settings=parseSettings(form);}catch(e){note=e.message;emit();return;}
    busy=true;runOwner=who;pause=false;note='Checking draft capacity…';emit();form.querySelectorAll('input,select').forEach(e=>e.disabled=true);dialog.querySelector('[data-batch-confirm]').disabled=true;
    try{await locked(who,async()=>{
      load(true);if(readError)throw Error(readError);if(active(job))throw Error('An unfinished batch is already saved. Close this window and resume it first.');
      await capacity(reviewed.rows.length,who);
      assertReview();
      const cards=reviewed.rows.map(row=>{const found=_crResolveEntry(loadPortData(),row.id);if(!found.row||found.ambiguous||JSON.stringify(clean(found.row))!==JSON.stringify(row.card))throw Error('A card changed after this preview. Close it and review your selection again.');return found.row;});
      const eligibility=await fetchSellStamps(cards);assertReview();if(!eligibility.ok)throw Error('Could not check card details. Your selection is preserved; please retry.');
      const id=crypto.randomUUID(),next={version:1,owner:who,id,createdAt:Date.now(),settings,rows:[]};
      for(let i=0;i<cards.length;i++){
        const card=clean(cards[i]),rowId=reviewed.rows[i].id,instanceId='inst_col_'+rowId,idemKey=_crCreateIdemKey('sell-col',rowId,instanceId);
        if(!/^[A-Za-z0-9_-]{1,128}$/.test(instanceId))throw Error('A selected card has an unsupported inventory ID. Open that card to review its details.');
        const blocked=eligibility.stamps[i]?.eligible!==true||(card.finishReviewRequired&&!card.finishConfirmed);
        const earlier=_crCreateAttempt[JSON.stringify([who,idemKey])];
        const payload=earlier?copy(earlier):_crBuildDraftPayload({card,instanceId,...priceFor(card,settings),bulkId:cards.length>1?id:undefined,shipping:settings.shipping});
        const photo=_scanPhotoSnapshot(cards[i],instanceId);
        next.rows.push({id:rowId,instanceId,idemKey,card,sourceHash:await digest(JSON.stringify(card)),photoHash:photo?await digest(photo.dataUrl):null,payload,state:earlier?'uncertain':blocked?'blocked':'queued',message:blocked?(card.finishReviewRequired&&!card.finishConfirmed?'Check the finish on this card before preparing a draft.':eligibility.stamps[i]?.message||'Add the missing card details.'):'Not attempted yet.'});
      }
      assertReview();save(next);preview=null;showProgress();emit();await run(next,who);
    });}catch(e){if(account()===who){note=e.message||'Could not prepare this batch. Resume its saved progress.';emit();}}
    finally{busy=false;runOwner=null;if(account()===who){form.querySelectorAll('input,select').forEach(e=>e.disabled=false);dialog?.querySelector('[data-batch-confirm]')?.removeAttribute('disabled');emit();}else{load(true);emit();}}
  }
  async function resume() {
    if(busy)return;const who=account();busy=true;runOwner=who;pause=false;note='Checking saved progress…';emit();
    try{await locked(who,async()=>{load(true);if(readError)throw Error(readError);if(!active(job))return;await capacity(job.rows.length,who);await run(job,who);});}
    catch(e){if(account()===who){note=e.message||'Could not resume this batch. Try again.';emit();}}
    finally{busy=false;runOwner=null;if(account()!==who)load(true);emit();}
  }
  async function run(next,who) {
    // Renew the original admission manifest after its 24-hour server TTL.
    // A retry keeps the same membership/key pairs; a downgrade is not split.
    const groups=new Map();
    for(const row of next.rows){const id=row.payload.bulkId;if(id){if(!groups.has(id))groups.set(id,[]);groups.get(id).push({instanceId:row.instanceId,idemKey:row.idemKey});}}
    for(const [id,rows] of groups){if(!next.rows.some(row=>row.payload.bulkId===id&&pending(row)))continue;assertOwner(who);const token=await _crIdToken();assertOwner(who);if(!token)throw Error('Sign in again to resume your batch.');const r=await fetch('/api/drafts?action=batch',{method:'POST',signal:AbortSignal.timeout(30000),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id,rows})});const data=await r.json();assertOwner(who);if(!r.ok||data.id!==id||data.count!==rows.length)throw Error(data.error||'Could not confirm batch capacity. Resume to retry.');}
    for(const row of next.rows){
      assertOwner(who);if(pause)break;if(!pending(row))continue;
      const found=_crResolveEntry(loadPortData(),row.id);
      if(!found.row||found.ambiguous){row.state='blocked';row.message='This copy is no longer available. Open drafts to check any earlier save.';save(next);emit();continue;}
      if(row.state==='queued'&&await digest(JSON.stringify(clean(found.row)))!==row.sourceHash){row.state='blocked';row.message='This card changed before it was attempted. Review it and select it again.';save(next);emit();continue;}
      let photo=null,photoChanged=false;
      if(row.photoHash){const candidate=_scanPhotoSnapshot(found.row,row.instanceId);if(candidate&&await digest(candidate.dataUrl)===row.photoHash)photo=candidate;else photoChanged=true;}
      assertOwner(who);row.state='sending';row.message='Preparing draft…';save(next);emit();
      const result=await _crCreateDraft({card:row.payload.card,instanceId:row.instanceId,idemKey:row.idemKey,price:row.payload.price,priceSource:row.payload.priceSource,preparedPayload:row.payload,scanPhoto:photo,source:'collection',batch:true,batchOwner:who});assertOwner(who);
      if(result.ok){row.state='done';row.draftId=result.draftId;row.message=(result.existing||result.replayed?'Saved draft recovered; existing settings retained.':'Draft ready.')+(photoChanged||result.photo?.reason==='ATTACH_FAILED'?' Photo needs review in the draft.':'');}
      else{const uncertain=!result.status||result.status>=500,retryable=result.status===401||/CAP|BULK|BATCH|PLAN/.test(result.code||'');row.state=uncertain?'uncertain':retryable?'queued':'blocked';row.message=result.message||'Could not prepare this draft. Review it before trying again.';if(uncertain||retryable)pause=true;}
      save(next);emit();
    }
    note=active(next)?'Batch paused. Resume to recover the current card and continue the remaining cards.':'';emit();
  }
  function open(ids=[]) {
    load();if(!owner){triggerGoogleSignIn('collection');return;}if(busy){showProgress();return;}
    if(readError){const who=owner,unreadableRaw=raw,d=makeDialog('Saved batch needs review');d.append(node('p',readError),button('View drafts',()=>{d.close();switchView('drafts');}),button('Clear unreadable recovery record',async()=>{
      if(!confirm('This only clears the unreadable recovery record in this browser. Saved drafts remain on your account. Have you checked your saved drafts?'))return;
      try{await locked(who,async()=>{assertOwner(who);if(localStorage.getItem(key(who))!==unreadableRaw)throw Error('The saved batch changed in another tab. No recovery record was cleared. Close and reopen its progress.');localStorage.removeItem(key(who));load(true);});d.close();emit();}catch(e){d.append(node('p',e.message));}
    }));return;}
    if(active(job)||!ids.length){preview=null;showProgress();return;}
    try{review(ids);}catch(e){note=e.message;emit();}
  }
  window.addEventListener('storage',event=>{if(owner&&event.key===key(owner)&&!busy){load(true);emit();}});
  window.CardResellDraftBatch={open,current,summary,mount,isBusy:()=>busy,pending:()=>{load();return(job?.rows||[]).filter(pending).map(r=>r.id);}};
})();
