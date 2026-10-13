/* Collection selection uses the same per-copy identity as the single-card action.
   Server capacity, eligibility, generations and bulk manifests remain authoritative. */
(() => {
  'use strict';
  let owner, rows = [], busy = false, query = '', valueFilter = 'all', message = '';
  const selected = new Set(), results = new Map(), pending = new Map();
  const account = () => window.googleUser?.uid || window.googleUser?.sub || null;
  const key = p => String(p.id);
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  function button(text, action) { const b = el('button', text); b.type = 'button'; b.onclick = action; return b; }
  function syncOwner() {
    if (owner === account()) return;
    owner = account(); selected.clear(); results.clear(); pending.clear(); query = ''; valueFilter = 'all'; message = '';
  }
  function current(id) { const found = _crResolveEntry(loadPortData(), id); return found.ambiguous ? null : found.row; }
  function rowMap(list) { const map = new Map(); for (const p of list) { if (!p) continue; const id = key(p); map.set(id, p.id == null || map.has(id) ? null : p); } return map; }
  function currentRows(ids) { const available = rowMap(loadPortData()); return ids.map(id => available.get(id) || null); }
  function visible(p) {
    const known = typeof p.currentValue === 'number' && Number.isFinite(p.currentValue) && p.currentValue >= 0;
    const matchesValue = valueFilter === 'all' || (valueFilter === 'under5' && known && p.currentValue < 5)
      || (valueFilter === 'atleast5' && known && p.currentValue >= 5) || (valueFilter === 'missing' && !known);
    return matchesValue && [p.card,p.set,p.number,p.game,p.grader,p.grade].join(' ').toLowerCase().includes(query.toLowerCase().trim());
  }
  function paint() {
    syncOwner();
    const bar = document.getElementById('collectionDraftTools'); if (!bar) return;
    let count = 0; const byId = rowMap(rows), available = rowMap(loadPortData());
    document.querySelectorAll('#collectionWrap tr.col-row').forEach(tr => {
      const id = tr.dataset.entryId, p = byId.get(id), shown = !p || visible(p);
      tr.style.display = shown ? '' : 'none'; if (shown) count++;
      const input = tr.querySelector('.collection-draft-check');
      if (input) { input.checked = selected.has(id); input.disabled = busy || !available.get(id); }
      const status = tr.querySelector('.collection-draft-result');
      if (status) {
        status.replaceChildren(); const result = results.get(id);
        if (result) { status.append(el('span', result.message)); if (result.draftId) status.append(button('Open draft', () => openDraftReview(result.draftId))); }
      }
    });
    const hiddenSelected = [...selected].filter(id => !byId.get(id) || !visible(byId.get(id))).length;
    bar.querySelector('[data-count]').textContent = `${selected.size} selected · ${count} of ${rows.length} shown`
      + (hiddenSelected ? ` · ${hiddenSelected} selected outside this filter` : '');
    bar.querySelector('[data-status]').textContent = message;
    bar.querySelectorAll('button[data-selection]').forEach(b => b.disabled = busy);
    bar.querySelector('[data-select-visible]').disabled = busy || !count;
    bar.querySelector('[data-clear-selection]').disabled = busy || !selected.size;
    const reset = bar.querySelector('[data-clear-filters]');
    reset.hidden = !query.trim() && valueFilter === 'all'; reset.disabled = busy;
    bar.querySelector('[data-no-matches]').hidden = count !== 0;
    bar.querySelector('[data-value-filter]').disabled = busy;
    const only = bar.querySelector('[data-only-visible]'); only.hidden = !hiddenSelected; only.disabled = busy;
    const compare=bar.querySelector('[data-compare]'); if(compare) {compare.disabled=busy || (!selected.size && !count);compare.textContent=selected.size?'Compare '+selected.size+' selected card'+(selected.size===1?'':'s'):(valueFilter !== 'all' || query.trim() ? 'Compare '+count+' shown card'+(count===1?'':'s') : 'Compare entire collection');}
    const create = bar.querySelector('[data-create]'); create.disabled = busy || !selected.size;
    create.textContent = busy ? 'Preparing drafts…' : !owner ? 'Sign in to prepare drafts' : `Prepare ${selected.size || ''} draft${selected.size === 1 ? '' : 's'}`;
  }
  function mount(next) {
    syncOwner(); rows = next;
    const present = new Set(rows.map(key));
    for (const id of selected) if (!present.has(id)) selected.delete(id);
    document.getElementById('collectionDraftTools')?.remove();
    if (!rows.length) return;
    if (!document.getElementById('collectionDraftStyles')) {
      const style = el('style'); style.id = 'collectionDraftStyles';
      style.textContent = `
.collection-draft-tools{padding:1rem;margin-bottom:1rem;border:1px solid var(--border);border-radius:var(--radius-lg,12px);background:var(--surface);color:var(--text);display:grid;gap:1rem}
.collection-plan-heading,.collection-plan-selection,.collection-plan-actions{display:flex;flex-wrap:wrap;align-items:center;gap:.5rem}
.collection-plan-heading{justify-content:space-between;gap:.5rem 1rem}
.collection-plan-heading strong{font-size:.9rem}
.collection-plan-filters{display:flex;flex-wrap:wrap;align-items:end;gap:.75rem}
.collection-plan-filters label{display:grid;gap:.4rem;min-width:0;flex:1 1 170px;font-size:.75rem;font-weight:600;color:var(--text-muted)}
.collection-plan-filters .collection-plan-search{flex:3 1 240px}
.collection-draft-tools input,.collection-draft-tools select{width:100%;min-width:0;min-height:44px;padding:.65rem .75rem;border:1px solid var(--border);border-radius:var(--radius-md,8px);background:var(--bg);color:var(--text);box-sizing:border-box;font:inherit;font-size:.85rem}
.collection-draft-tools button,.collection-draft-result button{min-height:44px;padding:.6rem .8rem;border:1px solid var(--border);border-radius:var(--radius-md,8px);background:var(--surface-2);color:var(--text);font:inherit;font-size:.8rem;font-weight:600;line-height:1.4;cursor:pointer}
.collection-draft-tools button:hover:not(:disabled),.collection-draft-result button:hover{border-color:var(--text-muted)}
.collection-draft-tools :is(button,input,select):focus-visible,.collection-draft-result button:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.collection-draft-tools button:disabled{opacity:.5;cursor:default}
.collection-draft-tools [hidden]{display:none!important}
.collection-draft-tools [data-create]{background:var(--gold);border-color:var(--gold);color:#171108}
.collection-plan-selection{padding-bottom:.75rem;border-bottom:1px solid var(--border)}
.collection-plan-selection button,.collection-draft-tools [data-clear-filters]{background:transparent}
.collection-plan-actions{justify-content:flex-end}
.collection-draft-tools [data-count]{font-size:.75rem;color:var(--text-muted);line-height:1.5}
.collection-draft-tools [data-status]{font-size:.85rem;line-height:1.5}
.collection-draft-tools [data-status]:empty{display:none}
.collection-plan-note{font-size:.73rem;line-height:1.5;color:var(--text-muted);margin:0}
.collection-draft-tools [data-no-matches]{margin:0;padding:.75rem;border-radius:8px;background:var(--surface-2);font-size:.85rem;line-height:1.5}
.collection-draft-select{display:flex;align-items:center;gap:.5rem;min-height:44px;font-size:.8rem;cursor:pointer}
.collection-draft-check{width:22px;height:22px;accent-color:var(--gold)}
.collection-draft-result{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;white-space:normal;font-size:.75rem;line-height:1.4;margin-top:.3rem}
@media(max-width:600px){.collection-plan-actions{display:grid;grid-template-columns:1fr 1fr}.collection-plan-actions [data-create]{grid-column:1/-1;grid-row:1}.collection-plan-selection{gap:.35rem}.collection-plan-selection button{flex:1 1 auto}.collection-plan-filters .collection-plan-search{flex-basis:100%}}
`;
      document.head.append(style);
    }
    const bar = el('div', '', 'collection-draft-tools'); bar.id = 'collectionDraftTools';
    const heading = el('div','','collection-plan-heading'); heading.append(el('strong', 'Plan your sale'));
    const count = el('div'); count.dataset.count = ''; count.setAttribute('role','status'); heading.append(count); bar.append(heading);
    const filters = el('div','','collection-plan-filters'); filters.setAttribute('role','group'); filters.setAttribute('aria-label','Find Collection cards');
    const searchLabel = el('label','Find cards','collection-plan-search');
    const search = el('input'); search.type = 'search'; search.placeholder = 'Find cards by name, set, or number'; search.setAttribute('aria-label','Search collection'); search.value = query;
    search.oninput = () => { query = search.value; paint(); }; searchLabel.append(search); filters.append(searchLabel);
    const filterLabel = el('label', 'Saved card value '), filter = el('select');
    filter.dataset.valueFilter = ''; filter.setAttribute('aria-label', 'Filter collection by saved value');
    for (const [value, text] of [['all','All values'],['under5','Under $5'],['atleast5','$5 and above'],['missing','Missing value']]) {
      const option = el('option',text); option.value=value; filter.append(option);
    }
    filter.value = valueFilter; filter.onchange = () => { valueFilter = filter.value; paint(); };
    filterLabel.append(filter); filters.append(filterLabel);
    const reset = button('Clear filters', () => {
      query = ''; valueFilter = 'all'; search.value = ''; filter.value = 'all'; paint(); search.focus();
    }); reset.dataset.clearFilters = ''; filters.append(reset); bar.append(filters);
    const empty = el('p', 'No cards match these filters. Clear filters to see your collection.');
    empty.dataset.noMatches = ''; empty.hidden = true;
    bar.append(empty);
    const select = button('Select visible', () => { syncOwner(); const available = rowMap(loadPortData()); rows.filter(visible).forEach(p => { if (available.get(key(p))) selected.add(key(p)); }); paint(); }); select.dataset.selection = ''; select.dataset.selectVisible = '';
    const clear = button('Clear selection', () => { selected.clear(); paint(); }); clear.dataset.selection = ''; clear.dataset.clearSelection = '';
    const create = button('Prepare drafts', prepare); create.dataset.create = '';
    const compare=button('Compare selling',()=>{syncOwner();const ids=selected.size?[...selected]:rows.filter(visible).map(key);const cards=currentRows(ids).filter(Boolean);if(cards.length!==ids.length){message='A card changed or has an ambiguous ID. Refresh your collection and select it again.';paint();return;}window.CardResellSellingPlan?.openCollection(cards);});compare.dataset.compare='';
    const only = button('Keep only shown selections', () => { const available = rowMap(loadPortData()); for (const id of selected) { const p = available.get(id); if (!p || !visible(p)) selected.delete(id); } paint(); }); only.dataset.onlyVisible = '';
    const selection = el('div','','collection-plan-selection'); selection.setAttribute('role','group'); selection.setAttribute('aria-label','Select Collection cards'); selection.append(select, clear, only);
    const actions = el('div','','collection-plan-actions'); actions.setAttribute('role','group'); actions.setAttribute('aria-label','Use selected Collection cards'); actions.append(compare, button('View drafts', () => switchView('drafts')), create);
    bar.append(selection,actions);
    bar.append(el('p', 'Values are saved estimates. Refresh prices before deciding; “Under $5” does not include cards with missing values.','collection-plan-note'));
    const status = el('div'); status.dataset.status = ''; status.setAttribute('role','status'); bar.append(status);
    document.getElementById('collectionWrap').before(bar);
    const byId = rowMap(rows);
    document.querySelectorAll('#collectionWrap tr.col-row').forEach(tr => {
      const id = tr.dataset.entryId, cell = tr.querySelector('[data-label="Card"]'); if (!cell) return;
      const label = el('label','','collection-draft-select'); const input = el('input','','collection-draft-check'); input.type = 'checkbox'; input.setAttribute('aria-label','Select '+(byId.get(id)?.card || 'card'));
      label.onclick = ev => ev.stopPropagation(); input.onchange = () => { syncOwner(); input.checked ? selected.add(id) : selected.delete(id); paint(); };
      label.append(input,el('span','Select')); const result = el('div','','collection-draft-result'); result.onclick = ev => ev.stopPropagation(); cell.append(label,result);
    });
    paint();
  }
  async function prepare() {
    if (busy) return; syncOwner();
    if (!owner) { triggerGoogleSignIn('collection'); return; }
    const ids = [...selected], batchOwner = owner; if (!ids.length) return;
    const assertOwner = () => { if (account() !== batchOwner) throw Error('Account changed. Select cards from your current collection.'); };
    busy = true; message = 'Checking draft capacity…'; paint();
    let succeeded = 0;
    try {
      const head = await _bulkDraftHeadroom(); assertOwner();
      if (!head.known) throw Error('Could not confirm draft capacity. Your selection is preserved; please retry.');
      if (ids.length > head.bulkLimit) throw Error(head.bulkLimit <= 1 ? 'Select one card, or choose Starter or above for bulk draft preparation.' : `Your plan supports ${head.bulkLimit} cards per action. Select fewer cards or view Subscriptions.`);
      const cards = currentRows(ids); if (cards.some(p => !p)) throw Error('A selected card changed or has an ambiguous ID. Refresh your collection and select it again.');
      const eligibility = await fetchSellStamps(cards); assertOwner();
      if (!eligibility.ok) throw Error('Could not check card details. Your selection is preserved; please retry.');
      const units = cards.map((card,i) => {
        const id = key(card), instanceId = 'inst_col_' + id;
        return {id,card,instanceId,idemKey:pending.get(id)?.idemKey || _crCreateIdemKey('sell-col',id,instanceId),eligible:eligibility.stamps[i]?.eligible === true,reason:eligibility.stamps[i]?.message};
      });
      let bulkId;
      if (ids.length > 1) {
        const token = await _crIdToken(); assertOwner(); if (!token) throw Error('Sign in again to prepare drafts.');
        bulkId = crypto.randomUUID();
        const response = await fetch('/api/drafts?action=batch', {method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({id:bulkId,rows:units.map(({instanceId,idemKey})=>({instanceId,idemKey}))})});
        const data = await response.json(); assertOwner();
        if (!response.ok) throw Error(data.error || 'Could not prepare this batch. Please retry.');
      }
      let stopped = false;
      for (const u of units) {
        assertOwner();
        if (stopped) { results.set(u.id,{message:'Not attempted. Resolve the earlier save issue, then retry your selection.'}); continue; }
        if (!current(u.id)) { results.set(u.id,{message:'Card is no longer available in this collection.'}); continue; }
        if (!u.eligible && !pending.has(u.id)) { results.set(u.id,{message:u.reason || 'Open this card and add missing details before preparing a draft.'}); continue; }
        const price = Number(u.card.currentValue ?? u.card.buyPrice ?? 0) || 0;
        const args = pending.get(u.id) || {card:u.card,instanceId:u.instanceId,idemKey:u.idemKey,price:price>0?price:undefined,priceSource:price>0 ? (Number(u.card.currentValue)>0 && _crValueProvenance(u.card)==='comp'?'comp':'seller'):undefined,source:'collection',batch:true,batchOwner,bulkId};
        pending.set(u.id,args); results.set(u.id,{message:'Preparing draft…'}); paint();
        const result = await _crCreateDraft(args); assertOwner();
        if (result.ok) {
          pending.delete(u.id); selected.delete(u.id); succeeded++;
          results.set(u.id,{draftId:result.draftId,message:(result.existing || result.replayed ? 'Saved draft recovered.' : 'Draft ready.') + (result.photo?.reason === 'ATTACH_FAILED' ? ' Photo needs attention in the draft.' : '')});
        } else {
          const uncertain = !result.status || result.status >= 500;
          if (!uncertain) pending.delete(u.id);
          results.set(u.id,{message:result.message || 'Could not prepare this draft. Please retry.'});
          stopped = uncertain || result.status === 401 || /CAP|BULK|PLAN/.test(result.code || '');
        }
        paint();
      }
      message = `${succeeded} draft${succeeded===1?'':'s'} ready. ${selected.size ? selected.size+' card(s) still selected; check their results.' : 'Your cards remain in Collection.'}`;
    } catch (error) { message = error.message || 'Could not prepare drafts. Please retry.'; }
    finally { busy = false; paint(); }
  }
  window.CardResellCollectionDrafts = {mount};
})();
