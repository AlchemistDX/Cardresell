/* A card match is not evidence of its surface finish. No provider calls here. */
function _scanFinishLabel(key) {
  const labels = { normal:'Normal / non-foil', nonfoil:'Normal / non-foil', non_foil:'Normal / non-foil',
    usd:'Normal / non-foil', holofoil:'Holofoil', reverseholofoil:'Reverse Holofoil',
    reverseholo:'Reverse Holofoil', foil:'Foil', usd_foil:'Foil', usd_etched:'Etched Foil', etched:'Etched Foil' };
  return labels[String(key).toLowerCase()] || String(key).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/_/g,' ').replace(/^./,s=>s.toUpperCase());
}
function _scanFinishOptions(info) {
  const prices = info?.prices || {};
  const valid = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  const entries = Object.entries(prices).map(([key,value]) => ({key,
    market: valid(value) ? value : valid(value?.market) ? value.market : valid(value?.mid) ? value.mid : null}));
  if (!entries.length && info?.variant) entries.push({key:info.variant,market:valid(info.marketPrice)?info.marketPrice:null});
  // A source or condition label is not a finish. Never let “TCGplayer Live”
  // or “Near Mint” stand in for a printing the catalogue did not distinguish.
  return entries.filter(o => o.key && !/^(manual|market|raw|tcgplayer(?:[ _]live)?|ebay|cardmarket|nm|lp|mp|hp|dmg|near[ _]mint(?:\s*\(nm\))?|lightly[ _]played|moderately[ _]played|heavily[ _]played|damaged)$/i.test(o.key))
    .map(o=>({...o,label:_scanFinishLabel(o.key)}));
}
// Generic saved values and condition prices are not finish evidence. Only
// preserve a finish explicitly named by the price response.
function _scanPriceVariantsFromFeed(feed) {
  return _scanFinishOptions({prices:feed?.allVariants||{},variant:feed?.variant,marketPrice:feed?.market})
    .map(o=>({key:o.key,label:o.label,market:o.market,low:null,mid:null,high:null}));
}
function _scanFinishFields(row) {
  if (!row?.finishReviewRequired) return {};
  return {finishReviewRequired:true,finishConfirmed:row.finishConfirmed===true,
    finish:row.finishConfirmed ? row.finish || '' : '',finishKey:row.finishConfirmed ? row.finishKey || '' : '',
    finishOptions:(row.finishOptions||[]).map(o=>({...o})),finishPriceDate:row.finishPriceDate||null};
}
function _scanApplyFinishReview(row, info) {
  if (row.cardType === 'sports') return; // existing sports parallel chooser
  row.finishReviewRequired = true;
  row.finishConfirmed = false; row.finish = ''; row.finishKey = '';
  row.finishOptions = _scanFinishOptions(info);
  row.finishPriceDate = new Date().toISOString();
  row.marketPrice = null; row.priceVariant = null; row.priceSource = null;
  row.unavailableReason = 'Check finish before using a market value';
}
function _scanChooseFinish(row, key, custom) {
  const option = (row.finishOptions || []).find(o=>o.key===key);
  const manual = key === '__other' ? String(custom||'').trim().slice(0,80) : '';
  if (key && !option && !manual) return false;
  row.finishConfirmed = !!(option || manual);
  row.finish = option?.label || manual;
  row.finishKey = option?.key || (manual ? '__other' : '');
  row.marketPrice = option?.market ?? null;
  row.priceVariant = option?.key || null;
  row.priceSource = row.marketPrice == null ? null : 'comp';
  row.unavailableReason = row.finishConfirmed ? 'No matching finish price available' : 'Check finish before using a market value';
  return true;
}
function _scanFinishButton(row, action) {
  if (!row?.finishReviewRequired) return '';
  return `<button type="button" onclick="event.stopPropagation();${action}" class="scan-finish-review">${_esc(row.finishConfirmed ? row.finish : 'Check finish / printing')}</button>`;
}
function _scanFinishPicker(row, save) {
  if (_DIALOGS.scanFinishPicker) _DIALOGS.scanFinishPicker();
  const opener = document.activeElement;
  const overlay = document.createElement('div'); overlay.id='scanFinishPicker';
  overlay.className='scan-finish-overlay';overlay.style.display='flex';
  overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="scanFinishTitle" class="scan-finish-box">
    <h2 id="scanFinishTitle">Check finish / printing</h2><p>${_esc(row.cardName || row.card || row.name || 'Your card')}</p>
    <p>A matching name and number do not confirm the finish. Binder plastic, glare and a straight-on photo can hide foil patterns.</p>
    <p>Look at the actual card while tilting it gently under indirect light. Check the shiny area, pattern, texture and any edition or promo stamp. Patterns differ by set; sleeve shine is not card foil.</p>
    <label for="scanFinishChoice">Finish on your card</label>
    <select id="scanFinishChoice"><option value="">Not sure yet — keep unpriced</option>
      ${(row.finishOptions||[]).map(o=>`<option value="${_esc(o.key)}">${_esc(o.label)}${o.market==null?' — no price':' — reference $'+o.market.toFixed(2)}</option>`).join('')}
      <option value="__other">Other finish / printing — enter it</option></select>
    <label for="scanFinishCustom" id="scanFinishCustomLabel" hidden>Finish or printing name
      <input id="scanFinishCustom" maxlength="80" placeholder="For example, a stamped or textured version"></label>
    <p class="scan-finish-note">These are available catalogue prices, not a visual verdict. A missing finish has no automatic price. Checking this does not use scan credits.</p>
    <p id="scanFinishError" role="status"></p><div class="scan-finish-actions"><button type="button" data-finish-cancel>Cancel</button><button type="button" data-finish-save>Save choice</button></div>
    </section>`;
  document.body.appendChild(overlay);
  const select=overlay.querySelector('select'),input=overlay.querySelector('input');
  select.value=row.finishConfirmed ? row.finishKey || '__other' : '';
  input.value=row.finishKey==='__other' ? row.finish||'' : '';
  const changed=()=>{overlay.querySelector('#scanFinishCustomLabel').hidden=select.value!=='__other';};
  changed();select.onchange=changed;
  const close=()=>{overlay.remove();delete _DIALOGS.scanFinishPicker;if(opener?.isConnected)opener.focus();};
  _DIALOGS.scanFinishPicker=close;
  overlay.querySelector('[data-finish-cancel]').onclick=close;
  overlay.onclick=e=>{if(e.target===overlay)close();};
  overlay.querySelector('[data-finish-save]').onclick=()=>{
    const next={...row};
    if(!_scanChooseFinish(next,select.value,input.value)){overlay.querySelector('#scanFinishError').textContent='Enter the finish or choose Not sure yet.';input.focus();return;}
    if(save(next)!==false)close();
  };
  select.focus();
}
function reviewBulkFinish(rowId) {
  const row=_bulkFindResult(rowId),owner=window.googleUser;
  if(!row)return;
  const version=JSON.stringify(row);
  _scanFinishPicker(row,next=>{
    if(window.googleUser!==owner || _bulkFindResult(rowId)!==row || JSON.stringify(row)!==version){showToast('This batch changed. Reopen the card.');return false;}
    Object.assign(row,next);_bulkUpdateRow(rowId,row);_bulkDetectDuplicates();
  });
}
function reviewCollectionFinish(id) {
  const row=_crResolveForMutation(loadPortData(),id),owner=window.googleUser;
  if(!row)return;
  const version=JSON.stringify(row);
  _scanFinishPicker(row,next=>{
    if(window.googleUser!==owner){showToast('Account changed. Reopen your collection.');return false;}
    const port=loadPortData(),current=_crResolveForMutation(port,id);
    if(!current || JSON.stringify(current)!==version){showToast('This card changed. Reopen the finish check.');return false;}
    Object.assign(current,_scanFinishFields(next),{currentValue:next.marketPrice,valueSource:next.priceSource,
      lastRefreshed:next.marketPrice==null?null:next.finishPriceDate,updatedAt:Date.now()});
    if(!savePortData(port)){_reportStorageFailure();return false;}
    renderCollectionView();showToast('Finish choice saved.');
  });
}

function _scanMarkCard(card, pending) {
  if (!card || card.game==='sports') return card;
  const info={prices:Object.fromEntries((card.priceVariants||[]).filter(v=>!isGradedVariant(v.key)).map(v=>[v.key,v.market]))};
  Object.assign(card,{_finishPricesVerified:true,finishReviewRequired:true,finishConfirmed:false,finish:'',finishKey:''},_scanFinishFields(pending));
  const options=_scanFinishOptions(info);
  card.finishOptions=options.length?options:(card.finishOptions||[]);
  card.finishPriceDate=new Date().toISOString();
  return card;
}
function _scanPrepareLookup(card) {
  document.getElementById('scanFinishNotice')?.remove();
  printSelect.querySelectorAll('[data-scan-finish-placeholder]').forEach(el=>el.remove());
  if (!card?.finishReviewRequired || card.game==='sports') return;
  // A restored pre-fix preview may still carry a generic price labelled as
  // holofoil. Retain a seller's written finish, but withdraw the unverified
  // price and choices. Collection records are not rewritten.
  if (!card._finishPricesVerified) {
    card.priceVariants=[];card.finishOptions=[];currentPrices={};printSelect.innerHTML='';
    card.finishKey=card.finishConfirmed?'__other':'';
    card._finishPricesVerified=true;
    window._crBasis=null;window._ovAutoFilled=false;priceOverride.value='';
    try{_persistLastLoadedCard(card);}catch(_){}
  }
  const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Check finish / printing';
  placeholder.dataset.scanFinishPlaceholder='1';
  printSelect.prepend(placeholder);
  printSelect.value=card.finishConfirmed ? card.finishKey : '';
  const note=document.createElement('div');note.id='scanFinishNotice';note.setAttribute('role','status');
  note.innerHTML=`<p>Finish is ${card.finishConfirmed?'seller-confirmed':'not confirmed by the scan'}. Choose the matching printing, or keep this card unpriced.</p>${_scanFinishButton(card,'reviewLookupFinish()')}`;
  printSelect.after(note);
}
function reviewLookupFinish() {
  const card=selectedCard;
  if (!card?.finishReviewRequired) return;
  _scanFinishPicker(card,next=>{
    if(selectedCard!==card){showToast('The card changed. Reopen the finish check.');return false;}
    Object.assign(card,_scanFinishFields(next));
    window._crBasis=null;window._ovAutoFilled=false;priceOverride.value='';
    // Only a matching feed key can drive automatic pricing; custom finishes
    // remain unpriced and can still have a seller-entered value.
    _scanPrepareLookup(card);updatePriceFromPrinting();calc();
    try{_persistLastLoadedCard(card);}catch(_){}
  });
}
function _scanConfirmLookupPrinting(key) {
  if(!selectedCard?.finishReviewRequired || isGradedVariant(key))return;
  const options=_scanFinishOptions({prices:Object.fromEntries((selectedCard.priceVariants||[]).filter(v=>!isGradedVariant(v.key)).map(v=>[v.key,v.market]))});
  selectedCard.finishOptions=options;
  _scanChooseFinish(selectedCard,options.some(o=>o.key===key)?key:'');
  window._crBasis=null;window._ovAutoFilled=false;priceOverride.value='';
  _scanPrepareLookup(selectedCard);
  try{_persistLastLoadedCard(selectedCard);}catch(_){}
}
