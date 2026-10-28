/* Receipt-bound review for uncertain bulk IDs. A provider's first suggestion
 * is not an identified card. Only the confirmation handler can accept it. */
(() => {
  'use strict';
  const states = new WeakMap();
  const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const label = value => typeof value === 'string' ? value : '';
  const owner = () => window.googleUser?.uid || window.googleUser?.sub || window.googleUser?.email || '';
  let active = null;

  function stage(row, data) {
    if (data.needsPicker !== true && !(data.identified === false && data.card_name)) return false;
    row.success = false; row.providerNeedsReview = true; row.definiteMiss = false;
    row.error = 'Choose the matching card';
    const valid = hex(data.confirmation_id) && hex(data.candidate_set) &&
      typeof data.scan_id === 'string' && data.scan_id.length > 0 && data.scan_id.length <= 64 &&
      Array.isArray(data.candidates) && data.candidates.length >= 2 && data.candidates.length <= 200 &&
      data.candidates.every(c => c && typeof c === 'object' && !Array.isArray(c) && label(c.card_name).trim());
    const s = { row, file:row.file, queue:window._bulkQueue, auth:window._fbAuth?.currentUser,
      owner:owner(), busy:false, uncertain:false, attempt:null, selected:-1,
      message:valid ? '' : 'The scanner did not return usable choices. Scan again for up to 1 ID credit, or choose a new photo.',
      invalid:!valid, terminal:false, foilHint:data.foil_hint };
    if (valid) s.offer = JSON.parse(JSON.stringify({ confirmation_id:data.confirmation_id,
      scan_id:data.scan_id, candidate_set:data.candidate_set, mode:'identify', candidates:data.candidates }));
    states.set(row, s);
    return true;
  }
  function current(s) {
    return states.get(s.row) === s && window._bulkQueue === s.queue &&
      window._fbAuth?.currentUser === s.auth && owner() === s.owner &&
      (window._bulkResults || []).includes(s.row) && s.row.file === s.file && !window._bulkSaved;
  }
  const locked = row => { const s = states.get(row); return !!s && current(s) && (s.busy || s.uncertain); };
  const canSearch = row => { const s = states.get(row); return !!s && current(s) && !row.success && !s.busy && !s.uncertain; };
  function searchHint(row) {
    if (!canSearch(row)) return null;
    const candidates = states.get(row).offer?.candidates || [];
    const same = key => candidates.length && candidates.every(c=>label(c[key]).trim().toLowerCase()===label(candidates[0][key]).trim().toLowerCase());
    return {name:same('card_name') ? label(candidates[0].card_name) : '',
      game:same('card_type') ? label(candidates[0].card_type) : ''};
  }
  function searchOther(s) {
    if (!canSearch(s.row) || window._bulkProcessing || window._bulkDraftBusy) return;
    close(); window.CardResellBulkLookup?.open(s.row.rowId);
  }
  function sameNumber(a, b, game) {
    const normalize = value => String(value || '').normalize('NFKC').trim().toLowerCase();
    const left=normalize(a), right=normalize(b);
    if (left===right) return true;
    const pattern=/^(\d+)(?:\/(\d+))?$/;
    const l=pattern.exec(left), r=pattern.exec(right);
    if (!l || !r) return false;
    if ((l[2] || r[2]) && !['pokemon','pokemonjp','lorcana'].includes(game)) return false;
    const digits=s=>s.replace(/^0+(?=\d)/,'');
    return digits(l[1])===digits(r[1]) && (!l[2] || !r[2] || digits(l[2])===digits(r[2]));
  }
  function guardClose() {
    if (!(window._bulkResults || []).some(locked)) return false;
    window.showToast?.('Finish checking your selected match before closing this batch.');
    return true;
  }
  function guardSave() {
    // Saving acknowledged identities does not end review of the remaining rows.
    // An in-flight or uncertain debit must settle before any handoff/save.
    if (!(window._bulkResults || []).some(locked)) return false;
    window.showToast?.('Finish checking your selected match before saving.');
    return true;
  }
  function node(tag, text, parent, attrs = {}) {
    const e = document.createElement(tag); if (text) e.textContent = text;
    for (const [key,value] of Object.entries(attrs)) e.setAttribute(key,value);
    if (parent) parent.append(e); return e;
  }
  const buttonStyle = 'min-height:44px;padding:10px 14px;border:1px solid #8065b7;border-radius:10px;background:#242032;color:#ede9fe;font:inherit;font-weight:600;cursor:pointer';
  function button(text, parent, action) {
    const b = node('button',text,parent,{type:'button',style:buttonStyle}); b.onclick = action; return b;
  }
  function refresh(s) {
    if (!current(s)) return;
    window._bulkUpdateRow?.(s.row.rowId,s.row);
    window._bulkRefreshResultSummary?.();
    window._bulkUpdatePackTracker?.();
    window._bulkDraftSyncSelectionUI?.();
    if (active?.state === s) draw(active);
  }
  function render(element, row) {
    if (!row.providerNeedsReview || row.success) return false;
    const s = states.get(row);
    if (s?.retake && (row._replacementPhoto || row._photoChecking || row._rescanning)) return false;
    element.replaceChildren(); element.style.opacity = ''; element.style.borderColor = '#a78bfa';
    node('img','',element,{src:row.objectUrl || row.imageDataUrl || '',alt:'Your card photo',
      style:'width:72px;height:100px;object-fit:contain;border-radius:6px;flex-shrink:0'});
    const body = node('div','',element,{style:'flex:1;min-width:0;font-size:14px;line-height:1.5'});
    node('strong',s?.busy ? 'Confirming your choice…' : s?.uncertain ? 'Check your selected match' : 'Match needs review',body);
    node('p',s?.message || 'Choose the card and printing that match your photo. It is not included in inventory or drafts yet.',body,{style:'margin:6px 0;color:#cbd5e1'});
    const actions = node('div','',body,{style:'display:flex;flex-wrap:wrap;gap:8px'});
    if (s && !s.invalid && !s.terminal) button(s.attempt ? 'Check confirmation' : 'Review matches',actions,()=>open(row.rowId));
    else button('Scan photo again · up to 1 credit',actions,()=>window.bulkRetryRow?.(row.rowId));
    if (!locked(row)) {
      if (s && canSearch(row)) button('Search other printings · free',actions,()=>searchOther(s));
      if (s) button('Choose new photo',actions,()=>retake(s));
      button('Remove from batch',actions,()=>window.bulkRemoveResult?.(row.rowId));
    }
    return true;
  }
  function retake(s) {
    if (!current(s) || locked(s.row) || window._bulkProcessing || window._bulkDraftBusy) return;
    s.retake = true; close(); window.bulkChooseNewPhoto?.(s.row.rowId);
  }
  function close() {
    const view = active; active = null;
    if (!view) return;
    clearInterval(view.watch); view.dialog.close(); view.dialog.remove();
    if (view.opener?.isConnected) view.opener.focus({preventScroll:true});
    // Closing the sheet does not abandon an in-flight confirmation. Its exact
    // receipt and selection remain on this row, including a lost response.
  }
  function open(rowId) {
    const row = (window._bulkResults || []).find(r => r?.rowId === rowId), s = states.get(row);
    if (!s || !current(s) || row.success || s.invalid || s.terminal || window._bulkProcessing || window._bulkDraftBusy) return;
    close(); window.CardResellBulkLookup?.close();
    const dialog = node('dialog','',document.body,{id:'bulkMatchDialog','aria-labelledby':'bulkMatchTitle',
      style:'box-sizing:border-box;width:min(680px,calc(100vw - 24px));max-width:calc(100vw - 24px);max-height:calc(100dvh - 24px);margin:auto;padding:0;border:1px solid #8065b7;border-radius:16px;background:#15121d;color:#fff;font:16px/1.5 system-ui;overflow:auto'});
    const style = node('style','',dialog);
    style.textContent = '#bulkMatchDialog::backdrop{background:rgba(0,0,0,.8)}#bulkMatchDialog button:focus-visible{outline:3px solid #fbbf24;outline-offset:2px}#bulkMatchDialog button:disabled{opacity:.55;cursor:wait}';
    const head = node('div','',dialog,{style:'display:flex;align-items:center;gap:12px;padding:16px;position:sticky;top:0;background:#15121d;z-index:1;border-bottom:1px solid #3b304d'});
    node('h2','Review card match',head,{id:'bulkMatchTitle',style:'font-size:20px;flex:1;margin:0'});
    button('Close',head,close);
    const body = node('div','',dialog,{style:'padding:16px'});
    const photo = node('img','',body,{src:row.objectUrl || row.imageDataUrl || '',alt:'Original card to compare',
      style:'display:block;width:100%;height:220px;object-fit:contain;border-radius:8px;background:#0a090d'});
    const content = node('div','',body);
    const view = {state:s,dialog,content,photo,opener:document.activeElement}; active = view;
    dialog.addEventListener('cancel',event=>{event.preventDefault();close()});
    view.watch = setInterval(()=>{if(!current(s) || s.row.success) close()},250);
    draw(view); dialog.showModal();
  }
  function draw(view) {
    if (active !== view) return;
    const s = view.state, area = view.content; area.replaceChildren();
    const picked = s.attempt?.candidate || s.offer.candidates[s.selected];
    const status = node('p',s.message || (picked ? 'Check this printing against your photo before confirming.' : 'Compare the name, set and card number. No choice is selected automatically.'),area,{role:'status','aria-live':'polite'});
    status.style.color = '#d5caee';
    if (!picked) {
      node('p','Uses up to 1 ID credit when you confirm. Closing without confirming costs no ID credit.',area);
      const list = node('div','',area,{class:'bulk-match-choices',style:'display:grid;gap:10px'});
      for (const [i,c] of s.offer.candidates.entries()) {
        const b = button('',list,()=>{if(!current(s))return close();s.selected=i;draw(view)});
        b.style.textAlign = 'left';
        node('strong',label(c.card_name),b,{style:'display:block;overflow-wrap:anywhere'});
        node('span',[label(c.set_name) || label(c.set_code), c.card_number ? '#'+c.card_number : '', c.is_japanese ? 'Japanese' : '', label(c.year), label(c.sport), label(c.variant), label(c.full_name)].filter(Boolean).join(' · '),b,{style:'display:block;color:#cbd5e1;overflow-wrap:anywhere'});
      }
      button('Search other printings · free',area,()=>searchOther(s));
      button('None of these match · choose new photo',area,()=>retake(s));
      return;
    }
    const summary = node('section','',area,{style:'padding:12px;border:1px solid #8065b7;border-radius:10px;overflow-wrap:anywhere'});
    node('strong',label(picked.card_name),summary);
    node('div',[label(picked.set_name)||label(picked.set_code),picked.card_number?'#'+picked.card_number:'',label(picked.variant),label(picked.full_name)].filter(Boolean).join(' · '),summary);
    node('p',s.attempt ? 'Retry checks this same selection. An accepted confirmation is charged only once.' : 'Confirm this printing for up to 1 ID credit. You can set condition and finish afterward.',area);
    const actions = node('div','',area,{style:'display:flex;flex-wrap:wrap;gap:10px'});
    const accept = button(s.busy ? 'Confirming…' : s.attempt ? 'Retry same confirmation' : 'Confirm this match',actions,()=>confirm(s));
    accept.disabled = s.busy;
    if (!s.busy && !s.uncertain) button('Back to matches',actions,()=>{s.selected=-1;s.attempt=null;s.message='';draw(view)});
  }
  async function token() {
    const u = window._fbAuth?.currentUser?.getIdToken ? window._fbAuth.currentUser :
      window.googleUser?.getIdToken ? window.googleUser : window._fbCurrentUser;
    return u?.getIdToken ? await u.getIdToken(true) : window._googleIdToken || '';
  }
  function accepted(body, s) {
    const pick = body?.pickedCard, c = s.attempt.candidate;
    if (body?.ok !== true || body.scan_id !== s.offer.scan_id || !pick || !label(pick.card_name).trim()) return false;
    const canonical = {...c,card_name:c.card_name||c.name||'',card_number:c.card_number||c.number||c.id||'',
      set_name:c.set_name||c.set||c.setName||c.setCode||c.set_code||'',rarity:c.rarity||c.set_rarity||'',hp:c.hp||'',
      card_type:c.card_type||'pokemon',sport:c.sport||'',year:c.year||'',is_japanese:c.is_japanese===true};
    return Object.keys(canonical).every(key=>JSON.stringify(canonical[key])===JSON.stringify(pick[key]));
  }
  async function confirm(s) {
    if (!current(s) || s.busy || s.row.success || window._bulkProcessing || window._bulkDraftBusy) return;
    if (!s.attempt) {
      const candidate = s.offer.candidates[s.selected]; if (!candidate) return;
      s.attempt = {candidate,body:JSON.stringify({confirmation_id:s.offer.confirmation_id,
        scan_id:s.offer.scan_id,candidate_set:s.offer.candidate_set,mode:'identify',candidate})};
    }
    s.busy = true; s.message = 'Confirming your selected printing…'; refresh(s);
    const controller = new AbortController();
    const previouslyUncertain = s.uncertain;
    let timeout, watch, expired = false;
    // Include token refresh and response parsing in the deadline. A late
    // continuation must not send a request after the seller retried or left.
    const deadline = new Promise((_,reject)=>{timeout=setTimeout(()=>{expired=true;controller.abort();reject(Error('timeout'))},15000)});
    try {
      const request = async () => {
        const auth = await token();
        if (expired || !current(s)) throw Error('stale');
        if (!auth) { const e = Error('auth'); e.auth = true; throw e; }
        s.uncertain = true;
        const response = await fetch('/api/scan-debit-id',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+auth},body:s.attempt.body,signal:controller.signal});
        const body = await response.json(); return {response,body};
      };
      watch = setInterval(()=>{if(!current(s))controller.abort()},250);
      const {response,body} = await Promise.race([request(),deadline]);
      if (!current(s)) return;
      if (!response.ok || !accepted(body,s)) {
        // Only a recognized no-accept verdict permits changing the selection.
        // Unknown, malformed, and lost replies retain the immutable attempt.
        // A login failure cannot settle an earlier request with a lost reply.
        const noAccept = body?.ok === false && (response.status === 401 && !previouslyUncertain ||
          response.status === 402 && body.error === 'no_credits' ||
          response.status === 410 && body.error === 'expired_confirmation');
        if (noAccept) s.uncertain = false;
        if (response.status === 410 && noAccept) {
          s.terminal = true; s.message = 'These matches expired. Scan again for up to 1 ID credit, choose a new photo, or remove this card.';
          if (active?.state === s) close();
        } else s.message = response.status === 401 ? 'Sign in again, then retry this confirmation.' :
          response.status === 402 ? 'No ID credits are available. Add credits, then retry this confirmation.' :
          'We could not verify the confirmation. Retry this same selection to check it safely.';
        return;
      }
      const c = body.pickedCard, row = s.row;
      Object.assign(row,{success:true,providerNeedsReview:false,providerConfirmed:true,definiteMiss:false,error:'',
        cardName:c.card_name,setName:c.set_name||'',setCode:c.set_code||'',cardNumber:c.card_number||'',
        rarity:c.rarity||'',cardType:c.card_type||'pokemon',isJapanese:c.is_japanese===true,
        sport:c.sport||'',year:c.year||'',groundedId:c.grounded_id||'',
        foilHint:['foil','non_foil'].includes(s.foilHint)?s.foilHint:'',
        marketPrice:null,priceSource:'',priceVariant:null,imageUrl:null,tcgplayerUrl:null});
      s.uncertain = false;
      window._scanApplyFinishReview?.(row,null);
      if (active?.state === s) close();
      refresh(s);
      try { window._bulkDetectDuplicates?.(); } catch (_) {}
      // Identity is accepted independently of optional market data. Keep the
      // exact accepted fields and seller metadata even if price lookup fails.
      const identity = [row.cardName,row.setName,row.cardNumber,row.cardType,row.groundedId].join('\0');
      Promise.resolve().then(()=>window._bulkFetchPrice?.(row.cardName,row.setName,row.cardNumber,row.cardType,row.isJapanese,row.groundedId,row.rarity,row.foilHint)).then(info=>{
        if (!info || !current(s) || identity !== [row.cardName,row.setName,row.cardNumber,row.cardType,row.groundedId].join('\0') || row.priceSource === 'seller') return;
        // The shared lookup can widen to another printing. A seller's explicit
        // choice must not inherit that other card's price or artwork.
        const normalize = value => String(value || '').trim().toLowerCase();
        if (!info.matchedSet || !info.matchedNumber || normalize(info.matchedSet)!==normalize(row.setName) ||
            !sameNumber(info.matchedNumber,row.cardNumber,row.cardType)) return;
        row.marketPrice=info.marketPrice;row.priceVariant=info.variant;row.imageUrl=info.imageUrl;row.tcgplayerUrl=info.tcgplayerUrl;
        row.unavailableReason=info.unavailableReason||'';if(info.marketPrice!=null)row.priceSource='comp';
        window._scanApplyFinishReview?.(row,info);refresh(s);
      }).catch(()=>{});
      try { Promise.resolve(window.checkProStatus?.()).then(()=>{
        if(!current(s))return;
        const credits=document.getElementById('bulkProgressCredits');
        if(credits)credits.textContent=((window._idScanCredits||0)+(window._freeIdLeft||0))+' credits remaining';
      }).catch(()=>{}); } catch (_) {}
      try { window._bulkTextRescueMisses?.().catch(()=>{}); } catch (_) {}
    } catch (error) {
      if (current(s)) s.message = error.auth ? 'Sign in again, then retry this confirmation.' :
        'The connection was interrupted. Retry this same confirmation to check whether it completed.';
    } finally {
      expired = true; clearTimeout(timeout); clearInterval(watch); s.busy = false; refresh(s);
    }
  }
  window.CardResellBulkMatchReview = {stage,render,open,close,locked,guardClose,guardSave,canSearch,searchHint,
    blocksRescan:row=>locked(row) || row?.providerNeedsReview && !(states.get(row)?.invalid || states.get(row)?.terminal || states.get(row)?.retake)};
})();
