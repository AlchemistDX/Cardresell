/* Collection selection uses the same per-copy identity as the single-card action.
   Server capacity, eligibility, generations and bulk manifests remain authoritative. */
(() => {
  'use strict';
  let owner, rows = [], busy = false, query = '', message = '';
  const selected = new Set(), results = new Map(), pending = new Map();
  const account = () => window.googleUser?.uid || window.googleUser?.sub || null;
  const key = p => String(p.id);
  const el = (tag, text, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; return n; };
  function button(text, action) { const b = el('button', text); b.type = 'button'; b.onclick = action; return b; }
  function syncOwner() {
    if (owner === account()) return;
    owner = account(); selected.clear(); results.clear(); pending.clear(); query = ''; message = '';
  }
  function current(id) { const found = _crResolveEntry(loadPortData(), id); return found.ambiguous ? null : found.row; }
  function rowMap(list) { const map = new Map(); for (const p of list) { const id = key(p); map.set(id, map.has(id) ? null : p); } return map; }
  function visible(p) { return [p.card,p.set,p.number,p.game,p.grader,p.grade].join(' ').toLowerCase().includes(query.toLowerCase().trim()); }
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
    bar.querySelector('[data-count]').textContent = `${selected.size} selected · ${count} of ${rows.length} shown`;
    bar.querySelector('[data-status]').textContent = message;
    bar.querySelectorAll('button[data-selection]').forEach(b => b.disabled = busy);
    const create = bar.querySelector('[data-create]'); create.disabled = busy || !selected.size;
    create.textContent = busy ? 'Preparing drafts…' : `Prepare ${selected.size || ''} draft${selected.size === 1 ? '' : 's'}`;
  }
  function mount(next) {
    syncOwner(); rows = next;
    for (const id of selected) if (!rows.some(p => key(p) === id)) selected.delete(id);
    document.getElementById('collectionDraftTools')?.remove();
    if (!rows.length) return;
    if (!document.getElementById('collectionDraftStyles')) {
      const style = el('style'); style.id = 'collectionDraftStyles';
      style.textContent = `.collection-draft-tools{padding:1rem;margin-bottom:1rem;border:1px solid var(--border,#333);border-radius:12px;display:flex;flex-wrap:wrap;gap:.65rem;align-items:center}.collection-draft-tools input{width:100%;padding:.7rem;border-radius:8px;border:1px solid #555;background:var(--bg,#171717);color:inherit;box-sizing:border-box;font:inherit}.collection-draft-tools button,.collection-draft-result button{min-height:44px;padding:.55rem .8rem;border:1px solid #666;border-radius:8px;background:#252525;color:#fff;font:inherit;font-size:.8rem;cursor:pointer}.collection-draft-tools button:disabled{opacity:.5;cursor:default}.collection-draft-tools [data-create]{background:#2563eb;border-color:#3b82f6}.collection-draft-tools [data-status]{width:100%;font-size:.85rem;line-height:1.5}.collection-draft-tools [data-count]{font-size:.8rem;width:100%}.collection-draft-select{display:flex;align-items:center;gap:.5rem;min-height:44px;font-size:.8rem;cursor:pointer}.collection-draft-check{width:22px;height:22px;accent-color:#3b82f6}.collection-draft-result{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;white-space:normal;font-size:.75rem;line-height:1.4;margin-top:.3rem}`;
      document.head.append(style);
    }
    const bar = el('div', '', 'collection-draft-tools'); bar.id = 'collectionDraftTools';
    bar.append(el('strong', 'Prepare listing drafts'));
    const search = el('input'); search.type = 'search'; search.placeholder = 'Find cards by name, set, or number'; search.setAttribute('aria-label','Search collection'); search.value = query;
    search.oninput = () => { query = search.value; paint(); }; bar.append(search);
    const select = button('Select visible', () => { syncOwner(); const available = rowMap(loadPortData()); rows.filter(visible).forEach(p => { if (available.get(key(p))) selected.add(key(p)); }); paint(); }); select.dataset.selection = '';
    const clear = button('Clear selection', () => { selected.clear(); paint(); }); clear.dataset.selection = '';
    const create = button('Prepare drafts', prepare); create.dataset.create = '';
    bar.append(select, clear, create, button('View drafts', () => switchView('drafts')));
    const count = el('div'); count.dataset.count = ''; const status = el('div'); status.dataset.status = ''; status.setAttribute('role','status'); bar.append(count,status);
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
    if (!owner) { message = 'Sign in to prepare listing drafts.'; paint(); return; }
    const ids = [...selected], batchOwner = owner; if (!ids.length) return;
    const assertOwner = () => { if (account() !== batchOwner) throw Error('Account changed. Select cards from your current collection.'); };
    busy = true; message = 'Checking draft capacity…'; paint();
    let succeeded = 0;
    try {
      const head = await _bulkDraftHeadroom(); assertOwner();
      if (!head.known) throw Error('Could not confirm draft capacity. Your selection is preserved; please retry.');
      if (ids.length > head.bulkLimit) throw Error(head.bulkLimit <= 1 ? 'Select one card, or choose Starter or above for bulk draft preparation.' : `Your plan supports ${head.bulkLimit} cards per action. Select fewer cards or view Subscriptions.`);
      const cards = ids.map(current); if (cards.some(p => !p)) throw Error('A selected card changed or has an ambiguous ID. Refresh your collection and select it again.');
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
