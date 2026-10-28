/* Automatic finish estimates with optional seller correction. No provider calls here. */
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
  const variants = _scanFinishOptions({prices:feed?.allVariants||{},variant:feed?.variant,marketPrice:feed?.market})
    .map(o=>({key:o.key,label:o.label,market:o.market,low:null,mid:null,high:null}));
  if (!variants.length && typeof feed?.market === 'number' && Number.isFinite(feed.market) && feed.market >= 0)
    variants.push({key:'manual',label:'Market estimate',market:feed.market,low:null,mid:null,high:null});
  return variants;
}
function _scanFinishFields(row) {
  if (!row || row.grader || (!row.finishOptions && !row.finishReviewRequired)) return {};
  return {finishReviewRequired:false,finishConfirmed:row.finishConfirmed===true,finishEstimated:row.finishEstimated===true,
    finish:row.finish || '',finishKey:row.finishKey || '',finishBasis:row.finishBasis || '',
    finishOptions:(row.finishOptions||[]).map(o=>({...o})),finishPriceDate:row.finishPriceDate||null};
}
function _scanApplyFinishReview(row, info) {
  if (row.cardType === 'sports' || row.grader) return;
  row.finishReviewRequired = false;
  row.finishConfirmed = false;
  row.finishEstimated = true;
  row.finishOptions = _scanFinishOptions(info);
  row.finishPriceDate = new Date().toISOString();
  // Pokemon's generic foil tag is not evidence of a specific premium printing.
  // Keep a usable automatic base estimate, even if the feed prefers reverse.
  // A missing base price stays missing; never substitute a premium price.
  const options = row.finishOptions;
  const base = row.cardType === 'pokemon'
    ? options.find(o=>/^(normal|nonfoil|non_foil|usd)$/i.test(o.key)) : null;
  const hinted = row.foilHint === 'non_foil'
    ? options.find(o=>/^(normal|nonfoil|non_foil|usd)$/i.test(o.key))
    : row.foilHint === 'foil'
      ? options.find(o=>/^(holofoil|foil|usd_foil)$/i.test(o.key)) : null;
  // A sole catalogue finish is a useful default, including reverse holo.
  // Keep it estimated until the seller chooses; no extra tap is required.
  const guess = base || hinted || options.find(o=>o.key===info?.variant) || (options.length===1 ? options[0] : null);
  row.finishBasis = base && options.length > 1 ? 'base_printing'
    : row.cardType === 'pokemon' && options.length === 1 ? 'sole_available' : '';
  row.finishKey = guess?.key || '';
  row.finish = guess?.label || '';
  if (guess) {
    row.marketPrice = guess.market;
    row.priceVariant = guess.key;
    row.priceSource = guess.market == null ? null : 'comp';
    row.unavailableReason = guess.market == null ? 'No matching finish price available' : '';
  }
}
function _scanChooseFinish(row, key, custom) {
  const option = (row.finishOptions || []).find(o=>o.key===key);
  const manual = key === '__other' ? String(custom||'').trim().slice(0,80) : '';
  if (key && !option && !manual) return false;
  row.finishReviewRequired = false;
  row.finishEstimated = false;
  row.finishBasis = '';
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
  if (!row || row.grader || (!row.finishOptions && !row.finishReviewRequired)) return '';
  const bulk = /^reviewBulkFinish\('([^']+)'\)$/.exec(action);
  if (bulk) return `<button type="button" class="scan-finish-chip" aria-label="Finish / printing: ${_esc(row.finish || 'Automatic')}" aria-haspopup="dialog" onclick="event.stopPropagation();${action}">${_esc(row.finish || 'Finish / printing')} ▾</button>`;
  return `<button type="button" onclick="event.stopPropagation();${action}" class="scan-finish-review">${_esc(row.finish || 'Finish / printing')} ▾</button>`;
}
function bulkSetFinish(rowId, key) {
  const row = _bulkFindResult(rowId);
  if (!row) return;
  if (key === '__other') { _bulkUpdateRow(rowId,row); reviewBulkFinish(rowId); return; }
  if (!_scanChooseFinish(row,key)) return;
  _bulkUpdateRow(rowId,row);
  _bulkDetectDuplicates();
}
function _scanFinishPicker(row, save) {
  if (_DIALOGS.scanFinishPicker) _DIALOGS.scanFinishPicker();
  const opener = document.activeElement;
  const overlay = document.createElement('div'); overlay.id='scanFinishPicker';
  overlay.className='scan-finish-overlay';overlay.style.display='flex';
  overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="scanFinishTitle" class="scan-finish-box">
    <h2 id="scanFinishTitle">Finish / printing</h2><p>${_esc(row.cardName || row.card || row.name || 'Your card')}</p>
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
  select.value=row.finishKey || '';
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
  if (_DIALOGS.scanFinishPicker) _DIALOGS.scanFinishPicker();
  const version=JSON.stringify(row),opener=document.activeElement;
  const save=next=>{
    if(window.googleUser!==owner || _bulkFindResult(rowId)!==row || JSON.stringify(row)!==version){showToast('This batch changed. Reopen the card.');return false;}
    Object.assign(row,next);_bulkUpdateRow(rowId,row);_bulkDetectDuplicates();
  };
  const overlay=document.createElement('div');overlay.id='scanFinishPicker';overlay.className='scan-finish-quick-overlay';
  overlay.innerHTML=`<section role="dialog" aria-modal="true" aria-labelledby="scanFinishTitle" class="scan-finish-quick-box">
    <h2 id="scanFinishTitle">Finish / printing</h2>
    <div class="scan-finish-choices">${(row.finishOptions||[]).map(o=>`<button type="button" data-finish-key="${_esc(o.key)}" aria-pressed="${o.key===row.finishKey}"><span>${_esc(o.label)}</span>${o.key===row.finishKey?'<span class="scan-finish-tick">✓</span>':''}</button>`).join('')}
    <button type="button" data-finish-key="__other"><span>Other finish / printing…</span></button></div>
    <button type="button" data-finish-cancel>Cancel</button></section>`;
  document.body.appendChild(overlay);
  const close=()=>{overlay.remove();delete _DIALOGS.scanFinishPicker;const target=opener?.isConnected?opener:document.getElementById(rowId)?.querySelector('.scan-finish-chip');target?.focus();};
  _DIALOGS.scanFinishPicker=close;
  overlay.querySelector('[data-finish-cancel]').onclick=close;
  overlay.onclick=e=>{if(e.target===overlay)close();};
  overlay.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}
    if(e.key==='Tab'){
      const buttons=[...overlay.querySelectorAll('button')],first=buttons[0],last=buttons[buttons.length-1];
      if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
    }
  };
  overlay.querySelectorAll('[data-finish-key]').forEach(button=>{button.onclick=()=>{
    const key=button.dataset.finishKey;
    if(key==='__other'){close();_scanFinishPicker(row,save);return;}
    const next={...row};
    if(_scanChooseFinish(next,key)&&save(next)!==false)close();
  };});
  (overlay.querySelector('[aria-pressed="true"]')||overlay.querySelector('button')).focus();
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
  Object.assign(card,{_finishPricesVerified:true,finishReviewRequired:false,finishConfirmed:false,finishEstimated:true,finish:'',finishKey:''},_scanFinishFields(pending));
  const options=_scanFinishOptions(info);
  card.finishOptions=options.length?options:(card.finishOptions||[]);
  card.finishPriceDate=new Date().toISOString();
  return card;
}
function _scanPrepareLookup(card) {
  document.getElementById('scanFinishNotice')?.remove();
  printSelect.querySelectorAll('[data-scan-finish-placeholder]').forEach(el=>el.remove());
  if (!card || card.game==='sports' || !card.finishOptions) return;
  card.finishReviewRequired = false;
  if (card.finishKey && [...printSelect.options].some(o=>o.value===card.finishKey)) printSelect.value=card.finishKey;
}
function reviewLookupFinish() {
  const card=selectedCard;
  if (!card?.finishOptions) return;
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
  if(!selectedCard?.finishOptions || isGradedVariant(key))return;
  const options=_scanFinishOptions({prices:Object.fromEntries((selectedCard.priceVariants||[]).filter(v=>!isGradedVariant(v.key)).map(v=>[v.key,v.market]))});
  selectedCard.finishOptions=options;
  _scanChooseFinish(selectedCard,options.some(o=>o.key===key)?key:'');
  window._crBasis=null;window._ovAutoFilled=false;priceOverride.value='';
  _scanPrepareLookup(selectedCard);
  try{_persistLastLoadedCard(selectedCard);}catch(_){}
}

// Explain the recorded basis; internal "comp" is not proof of a completed sale.
// Read-only: opening this disclosure never refreshes prices or spends credits.
function _scanPriceBasisHtml(row) {
  if (!row?.success) return '';
  const priced = typeof row.marketPrice === 'number' && Number.isFinite(row.marketPrice) && row.marketPrice >= 0;
  const seller = row.priceSource === 'seller';
  const baseEstimate = row.finishBasis === 'base_printing' && !row.finishConfirmed;
  const label = !priced ? 'Price details' : seller ? 'Your price' : row.priceSource === 'comp' ? (baseEstimate ? 'Base-printing estimate' : 'Market estimate') : 'Saved price';
  const basis = !priced ? 'No usable price is available for this row. It is not valued at $0.'
    : seller ? 'You entered this amount. It is not a verified sale or buyer offer.'
    : row.priceSource === 'comp' ? 'This is a catalogue reference, not a verified sale of your card or a buyer offer.'
    : 'The source of this saved amount is not recorded. Check it before relying on it.';
  const finish = row.grader ? 'Slab label: '+row.grader+' '+row.grade+'; certification '+row.cert+'. This reads the label; it does not authenticate the holder.' : row.cardType === 'sports' ? 'Check the exact parallel or variation against your card.'
    : row.finishConfirmed && row.finish ? 'Finish / printing: '+row.finish+' — chosen by you, not independently verified.'
    : row.finishBasis === 'sole_available' && row.finish ? 'Finish / printing: '+row.finish+' — selected automatically because it is the only finish returned by the catalogue. You can change it in Finish / printing; no new scan is needed.'
    : row.finishBasis === 'reverse_unconfirmed' ? 'Only a reverse-holo price is available. Choose that finish if it matches your card, or enter your own price. No new scan is needed.'
    : baseEstimate ? 'Foil is not confirmed. The '+row.finish+' catalogue price is used as a base estimate. Choose Finish / printing to price a holo or reverse holo; no new scan is needed.'
    : row.finish ? 'Finish / printing: '+row.finish+' — automatic guess; optional correction is available.'
    : 'Finish / printing has not been confirmed. You can choose it if needed.';
  const condition = row.grader ? 'Pricing must match this grade; raw-card prices are not substituted.' : row.conditionChosen === true && row.condition
    ? 'Condition: '+row.condition+' — chosen by you. This does not certify condition-specific pricing.'
    : 'Condition has not been chosen. Identification does not grade the card.';
  return '<details class="scan-price-basis"><summary>'+label+'</summary><div>'
    + [basis,finish,condition,priced ? 'Amount is per copy, before fees, shipping and purchase cost. Provider update time is not available here.' : 'Enter your own price or check the card details.'].map(t=>'<p>'+_esc(t)+'</p>').join('')
    + '</div></details>';
}
