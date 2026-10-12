/* Conditional submission scenarios. No AI grade conversion, provider calls,
 * automatic best-grader claim or cross-grader price substitution. */
(function (root) {
  'use strict';
  const checkedAt = '2026-10-12';
  const sources = {
    PSA: 'https://www.psacard.com/services/tradingcardgrading',
    CGC: 'https://www.cgccards.com/submit/services-fees/cgc-grading/'
  };
  const tiers = [
    { id: 'psa-standard', grader: 'PSA', name: 'Standard', fee: 59.99, minDays: 90, days: 100, maxValue: 1000, minCards: 1 },
    { id: 'psa-priority', grader: 'PSA', name: 'Priority', fee: 79.99, minDays: 70, days: 80, maxValue: 1500, minCards: 1 },
    { id: 'psa-express', grader: 'PSA', name: 'Express', fee: 199, minDays: 20, days: 30, maxValue: 2500, minCards: 1 },
    { id: 'cgc-bulk', grader: 'CGC', name: 'Bulk', fee: 17, minDays: 150, days: 150, maxValue: 500, minCards: 25 },
    { id: 'cgc-economy', grader: 'CGC', name: 'Economy', fee: 20, minDays: 90, days: 90, maxValue: 1000, minCards: 1 },
    { id: 'cgc-standard', grader: 'CGC', name: 'Standard', fee: 55, minDays: 10, days: 10, maxValue: 3000, minCards: 1 },
    { id: 'cgc-express', grader: 'CGC', name: 'Express', fee: 100, minDays: 5, days: 5, maxValue: 10000, minCards: 1 }
  ];
  const fresh = (now = Date.now()) => {
    const age = now - Date.parse(checkedAt + 'T00:00:00Z');
    return age >= 0 && age <= 14 * 86400000;
  };
  function number(value, max = 1000000) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const s = String(value).trim();
    if (!/^\d+(?:\.\d+)?$/.test(s)) return null;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 && n <= max ? n : null;
  }
  function calculate(common, path, net, now = Date.now()) {
    const raw = number(common.raw), rawShip = number(common.rawShip);
    const rate = number(common.rate, 100);
    const sale = number(path.sale), fee = number(path.fee), shipping = number(path.shipping);
    const saleShip = number(path.saleShip), days = number(path.days, 2000), extra = number(path.extra, 2000);
    const tier = tiers.find(t => t.id === path.tier && t.grader === path.grader);
    if (!['PSA', 'CGC', 'BGS', 'SGC'].includes(path.grader)) return { error: 'Choose a grading company.' };
    if (path.tier !== 'custom' && !tier) return { error: 'Choose a service tier or enter your own quote.' };
    if (tier && !fresh(now)) return { error: 'Published rates need rechecking. Use a current custom quote.' };
    if (tier) {
      const declared = number(path.declared), count = number(path.count, 10000);
      if (declared === null || count === null || !Number.isInteger(count) || count < 1)
        return { error: 'Enter declared value and submission card count to check this tier.' };
      if (declared > tier.maxValue || (sale !== null && sale > tier.maxValue))
        return { error: 'Value exceeds this tier limit. Choose an eligible tier or a confirmed custom quote.' };
      if (count < tier.minCards) return { error: 'This tier requires at least ' + tier.minCards + ' cards per submission.' };
    }
    if (!String(path.outcome || '').trim()) return { error: 'Enter the grade outcome this sale estimate assumes.' };
    if ([raw, rawShip, rate, sale, fee, shipping, saleShip, days, extra].some(n => n === null))
      return { error: 'Complete the cost, sale and time assumptions. Enter 0 when a cost does not apply.' };
    // Published base fees/times stay attached to their source. Custom quotes are
    // explicit; editing an amount cannot silently misrepresent a published tier.
    if (tier && (fee !== tier.fee || days !== tier.days)) return { error: 'Use a custom quote for a different fee or wait.' };
    const rawNet = net(raw) - rawShip, gradedNet = net(sale) - saleShip;
    if (![rawNet, gradedNet].every(Number.isFinite)) return { error: 'Selling fees are unavailable.' };
    const calendarDays = Math.ceil(days * 7 / 5) + extra;
    const capital = Math.max(0, rawNet) + fee + shipping;
    const holdingCost = capital * rate / 100 * calendarDays / 365;
    const proceeds = gradedNet - fee - shipping;
    return { rawNet, gradedNet, proceeds, calendarDays, capital, holdingCost,
      difference: proceeds - rawNet - holdingCost };
  }
  const states = new Map();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);
  const emptyPath = grader => ({ open: false, grader, tier: '', outcome: '', sale: '', fee: '', shipping: '', saleShip: '', days: '', extra: '', declared: '', count: '' });
  function mount(el, context) {
    if (!el || typeof el.appendChild !== 'function') return;
    // Deliberately memory-only, scoped to signed-in user and exact card/analysis.
    const owner = root.googleUser?.sub || root.googleUser?.uid || 'guest';
    const key = owner + '::' + context.scope;
    if (!states.has(key)) {
      if (states.size >= 50) states.delete(states.keys().next().value);
      states.set(key, { common: { raw: context.rawPrice > 0 ? String(context.rawPrice) : '', rawShip: '', rate: '0' },
        paths: [emptyPath('PSA'), emptyPath('CGC')], open: false });
    }
    const state = states.get(key);
    const panel = document.createElement('details');
    panel.className = 'grading-paths'; panel.open = state.open;
    const input = (label, field, value, readonly = false, text = false) =>
      '<label>' + label + '<input data-field="' + field + '" type="' + (text ? 'text' : 'number') + '" ' +
      (text ? 'maxlength="60"' : 'min="0" step="any" inputmode="decimal"') +
      ' value="' + esc(value) + '"' + (readonly ? ' readonly' : '') + '></label>';
    function draw() {
      panel.innerHTML = '<summary>Compare grading paths</summary><p>Compare conditional outcomes for PSA, CGC, BGS or SGC. Your AI estimate remains PSA-style; no CGC grade or resale premium is inferred.</p>' +
        '<fieldset data-common><legend>Sell raw baseline · USD per card</legend><div class="gp-grid">' +
        input('Raw sale estimate ($)', 'raw', state.common.raw) + input('Raw sale shipping you pay ($)', 'rawShip', state.common.rawShip) +
        input('Annual capital cost (%) · optional, 0 = off', 'rate', state.common.rate) + '</div></fieldset>' +
        '<p>Any prefilled raw price is a guide value to review. Selling fees use your existing eBay profile. All shipping and insurance inputs are your allocated cost per card.</p>' +
        '<div class="gp-paths">' + state.paths.map((p, i) => {
          const tier = tiers.find(t => t.id === p.tier && t.grader === p.grader);
          return '<fieldset data-path="' + i + '"><legend>' + p.grader + ' · Path ' + (i + 1) + '</legend><details data-assumptions' + (p.open ? ' open' : '') + '><summary>Submission &amp; sale assumptions</summary><label>Grading company<select data-field="grader">' +
            ['PSA', 'CGC', 'BGS', 'SGC'].map(g => '<option' + (g === p.grader ? ' selected' : '') + '>' + g + '</option>').join('') + '</select></label>' +
            '<label>Service tier<select data-field="tier"><option value="">Choose a tier</option>' +
            tiers.filter(t => t.grader === p.grader).map(t => '<option value="' + t.id + '"' + (t.id === p.tier ? ' selected' : '') + (!fresh() ? ' disabled' : '') + '>' +
              t.name + ' · $' + t.fee.toFixed(2) + ' · ' + (t.minDays === t.days ? t.days : t.minDays + '–' + t.days) + ' working days</option>').join('') +
            '<option value="custom"' + (p.tier === 'custom' ? ' selected' : '') + '>My current quote</option></select></label>' +
            (sources[p.grader] ? '<p><a target="_blank" rel="noopener" href="' + sources[p.grader] + '">Official rates</a> · checked ' + checkedAt +
              '. ' + (!fresh() ? 'Snapshot expired; enter a current quote. ' : '') + (p.grader === 'PSA' ? 'Value services were paused at this check. ' : '') + 'Direct US base rates; discounts and extras vary.</p>' : '<p>Enter a current quote; no published rate loaded for this company.</p>') +
            (tier ? '<p>Up to $' + tier.maxValue + ' per card; minimum ' + tier.minCards + ' cards. Confirm eligibility with the grader.</p><div class="gp-grid">' +
              input('Declared value per card ($)', 'declared', p.declared) + input('Cards in this submission', 'count', p.count) + '</div>' : '') +
            input(p.grader === 'CGC' ? 'Assumed grade · Gem Mint / Pristine are distinct' : 'Assumed grade', 'outcome', p.outcome, false, true) +
            '<div class="gp-grid">' + input('Sale estimate at that grade ($)', 'sale', p.sale) + input('Grading fee per card ($)', 'fee', p.fee, !!tier) +
            input('Submission shipping + insurance ($)', 'shipping', p.shipping) + input('Graded sale shipping you pay ($)', 'saleShip', p.saleShip) +
            input('Grading wait · working days', 'days', p.days, !!tier) + input('Extra calendar days · transit + sale', 'extra', p.extra) +
            '</div></details><output data-result="' + i + '" aria-live="polite"></output></fieldset>';
        }).join('') + '</div><p>Outcomes are seller scenarios, not expected profit or grade predictions. Waits are estimates, not guarantees. Calendar time uses working days × 7/5 plus your extra days, excluding holiday delays. Capital cost uses foregone raw net proceeds plus submission costs; it does not predict card-price changes. No automatic winner is selected.</p>';
      results();
    }
    function results() {
      state.paths.forEach((path, i) => {
        const r = calculate(state.common, path, context.net);
        const out = panel.querySelector('[data-result="' + i + '"]');
        if (r.error) { out.textContent = r.error; return; }
        out.innerHTML = '<strong>' + money(r.difference) + ' vs selling raw</strong><br>' +
          'If it grades ' + esc(path.outcome) + ' and sells for ' + money(Number(path.sale)) +
          '<br>Graded proceeds after fees, submission and shipping: ' + money(r.proceeds) +
          '<br>Raw proceeds after fees and shipping: ' + money(r.rawNet) +
          '<br>Capital cost adjustment: ' + money(r.holdingCost) +
          '<br>Approximate capital tie-up: ' + r.calendarDays + ' calendar days (' + (r.calendarDays / 30.44).toFixed(1) + ' months)';
      });
    }
    panel.addEventListener('toggle', e => {
      if (e.target === panel) state.open = panel.open;
      else if (panel.contains(e.target) && e.target.matches('[data-assumptions]')) state.paths[Number(e.target.closest('[data-path]').dataset.path)].open = e.target.open;
    }, true);
    panel.addEventListener('input', e => {
      const field = e.target.dataset.field;
      if (!field || e.target.tagName === 'SELECT') return;
      const row = e.target.closest('[data-path]');
      (row ? state.paths[Number(row.dataset.path)] : state.common)[field] = e.target.value;
      results();
    });
    panel.addEventListener('change', e => {
      const field = e.target.dataset.field;
      if (e.target.tagName !== 'SELECT') return;
      const index = Number(e.target.closest('[data-path]').dataset.path);
      const p = state.paths[index];
      // The native toggle event is queued. Snapshot the current DOM before a
      // select-triggered redraw so an immediate change cannot close the form.
      panel.querySelectorAll('[data-assumptions]').forEach(d => {
        state.paths[Number(d.closest('[data-path]').dataset.path)].open = d.open;
      });
      if (field === 'grader') state.paths[index] = { ...emptyPath(e.target.value), open: p.open };
      if (field === 'tier') {
        p.tier = e.target.value;
        const t = tiers.find(t => t.id === p.tier && t.grader === p.grader);
        p.fee = t ? String(t.fee) : ''; p.days = t ? String(t.days) : '';
      }
      draw();
      panel.querySelector('[data-path="' + index + '"] [data-field="' + field + '"]').focus();
    });
    draw(); el.appendChild(panel);
  }
  root.CardResellGradingPaths = { mount, calculate, tiers, fresh };
})(typeof window === 'undefined' ? globalThis : window);
