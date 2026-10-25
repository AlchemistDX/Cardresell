// Each Collection entry represents one physical copy. Export reads the current
// account's saved rows; it neither reprices cards nor writes inventory.
(() => {
  'use strict';
  const amount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
  const cell = (value, column) => {
    let text = value == null ? '' : typeof value === 'number'
      ? ([2, 3, 4].includes(column) ? value.toFixed(2) : column === 5 ? value.toFixed(1) : String(value)) : String(value);
    // User-entered names and identifiers are text, never spreadsheet formulas.
    // Escape literal leading apostrophes too so a marked export can remove
    // exactly one protective prefix without changing the original text.
    if (typeof value !== 'number' && (/^\s*[=+\-@]/.test(text) || /^['\t\r\n]/.test(text))) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  };
  window.exportCollection = function (selectedIds) {
    let cards = loadPortData();
    if (!Array.isArray(cards)) { showToast('Your collection could not be read. Reload and try again.', 'error'); return; }
    if (selectedIds !== undefined) {
      if (!Array.isArray(selectedIds) || !selectedIds.length) { showToast('Select cards to export first.', 'info'); return; }
      const ids = [...new Set(selectedIds.map(String))];
      const matches = ids.map(id => cards.filter(p => p && p.id != null && String(p.id) === id));
      if (matches.some(list => list.length !== 1)) {
        showToast('A selected card changed or has an ambiguous ID. Refresh your collection and select it again.', 'warning'); return;
      }
      cards = matches.map(list => list[0]);
    }
    if (!cards.length) { showToast('No cards in your collection to export.', 'info'); return; }
    if (cards.some(p => !p || typeof p !== 'object' || Array.isArray(p))) {
      showToast('A collection row could not be read. Reload and try again.', 'error'); return;
    }
    const rows = [['Card','Set','Cost Basis','Current Value','Unrealized P/L','P/L %','Finish','Finish confirmed',
      'Collection ID','Game','Card Number','Set Code','Condition','Grader','Grade','Certificate','Quantity',
      'Added Date','Value Source','Last Refreshed','Value Status','Currency','Profit Basis','Storage Location','Source SKU','CardResell CSV Format']];
    for (const p of cards) {
      const cost = amount(p.buyPrice), value = amount(p.currentValue);
      const gain = cost !== null && value !== null ? value - cost : null;
      const percentage = cost > 0 && gain !== null ? gain / cost * 100 : null;
      const source = p.valueSource === 'comp' ? 'Provider-derived saved estimate'
        : p.valueSource === 'seller' ? 'Seller-entered estimate' : p.valueSource === 'import' ? 'Imported estimate' : 'Source not recorded';
      const status = [value === null ? 'Current value missing or invalid' : 'Saved estimate',
        ...(cost === null ? ['Cost basis missing or invalid'] : []),
        ...(p.finishReviewRequired && !p.finishConfirmed ? ['Finish needs review'] : [])].join('; ');
      rows.push([p.card || '',p.set || '',cost,value,gain,Number.isFinite(percentage) ? percentage : null,
        p.finish || '',p.finishReviewRequired ? (p.finishConfirmed ? 'Yes' : 'No') : '',p.id ?? '',
        p.game || p.cardType || '',p.number || '',p.setCode || '',p.condition || '',p.grader || '',p.grade ?? '',
        p.cert || '',1,p.addedDate || '',value === null ? '' : source,p.lastRefreshed || '',status,'USD',
        'Unrealized estimate before selling fees, shipping, grading and other expenses',p.location||'',p.sku||'','1']);
    }
    const csv = rows.map(row => row.map(cell).join(',')).join('\r\n');
    const link = document.createElement('a');
    link.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent('\uFEFF' + csv);
    link.download = selectedIds === undefined ? 'cardsell_collection.csv' : 'cardsell_collection_selected.csv';
    link.click();
    showToast('Export started for ' + cards.length + ' saved card' + (cards.length === 1 ? '.' : 's.'), 'success');
  };
})();
