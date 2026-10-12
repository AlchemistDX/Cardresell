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
  // Shared prices retain their actual coverage. No numeric grade conversion.
  function gradeRows(prices, grader) {
    const defs = [
      ...Array.from({ length: 6 }, (_, i) => ['grade_' + (i + 1), String(i + 1), 'Mixed graders']),
      ['grade_7', '7 / 7.5', 'Mixed graders'], ['grade_8', '8 / 8.5', 'Mixed graders'],
      ['grade_9', '9', 'Mixed graders']
    ];
    if (grader !== 'PSA') defs.push(['grade_95', '9.5', 'Mixed graders']);
    defs.push([grader.toLowerCase() + '_10', '10', grader + ' 10']);
    if (grader === 'CGC') defs.push(['cgc_pristine_10', 'Pristine 10', 'CGC Pristine 10']);
    if (grader === 'BGS') defs.push(['bgs_black_10', 'Black Label 10', 'BGS Black Label 10']);
    return defs.map(([key, grade, basis]) => ({ key, grade, basis,
      price: number(prices?.[key]) > 0 ? number(prices[key]) : null }));
  }
  function priceRow(row, prices, grader, settings, net, now = Date.now()) {
    if (row.price === null) return { ...row, error: 'Price unavailable for this outcome.' };
    const sellingNet = net(row.price), rawPrice = number(prices?.raw);
    const rawNet = rawPrice > 0 ? net(rawPrice) : null;
    if (!Number.isFinite(sellingNet)) return { ...row, error: 'Selling fees unavailable.' };
    const count = number(settings.count, 10000);
    if (!count || !Number.isInteger(count)) return { ...row, sellingNet, error: 'Enter a whole submission size of at least 1.' };
    let tier, fee, days;
    if (settings.tier === 'custom') {
      fee = number(settings.fee); days = number(settings.days, 2000);
      if (fee === null) return { ...row, sellingNet, error: 'Add your grading quote to finish the breakdown.' };
    } else {
      if (!fresh(now)) return { ...row, sellingNet, error: 'Published fees need a refresh. Enter a current quote.' };
      const eligible = tiers.filter(t => t.grader === grader && row.price <= t.maxValue && count >= t.minCards);
      tier = settings.tier === 'auto' ? eligible.sort((a, b) => a.fee - b.fee)[0] : eligible.find(t => t.id === settings.tier);
      if (!tier) return { ...row, sellingNet, error: 'No eligible published tier for this value and submission size. Use a confirmed quote.' };
      fee = tier.fee; days = tier.days;
    }
    const shipping = number(settings.shipping), saleShip = number(settings.saleShip);
    if ((settings.shipping !== '' && shipping === null) || (settings.saleShip !== '' && saleShip === null))
      return { ...row, sellingNet, error: 'Shipping must be a nonnegative dollar amount.' };
    const rate = number(settings.rate, 100), extra = number(settings.extra, 2000);
    if (rate === null || (rate > 0 && (extra === null || days === null || rawNet === null)))
      return { ...row, sellingNet, error: 'Capital adjustment needs raw value, grading wait and additional calendar days.' };
    const completeCosts = shipping !== null && saleShip !== null;
    const proceeds = sellingNet - fee - (shipping ?? 0) - (saleShip ?? 0);
    const calendarDays = days === null ? null : Math.ceil(days * 7 / 5) + (extra ?? 0);
    // Missing expenses stay explicitly excluded; no full net claim until entered.
    if (rate > 0 && !completeCosts) return { ...row, sellingNet, error: 'Enter shipping costs (0 if none) to calculate capital cost.' };
    const rawProceeds = rawNet === null ? null : rawNet - (saleShip ?? 0);
    const holding = rate > 0 ? (Math.max(0, rawProceeds) + fee + shipping) * rate / 100 * calendarDays / 365 : 0;
    return { ...row, sellingNet, sellingFees: row.price - sellingNet, fee, tier, days,
      shipping, saleShip, completeCosts, proceeds: proceeds - holding, holding, calendarDays,
      rawProceeds, difference: rawProceeds === null ? null : proceeds - holding - rawProceeds };
  }
  const states = new Map();
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number.isFinite(n) ? (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2) : '—';
  function mount(el, context) {
    if (!el || typeof el.appendChild !== 'function') return;
    const owner = root.googleUser?.sub || root.googleUser?.uid || 'guest';
    const grader = context.grader || 'PSA';
    const key = owner + '::' + context.scope + '::' + grader;
    if (!states.has(key)) {
      if (states.size >= 100) states.delete(states.keys().next().value);
      states.set(key, { tier: sources[grader] ? 'auto' : 'custom', count: '1', fee: '', days: '',
        shipping: '', saleShip: '', rate: '0', extra: '', open: false, lower: false });
    }
    const state = states.get(key), prices = context.prices || {};
    const panel = document.createElement('section'); panel.className = 'grading-paths';
    const input = (label, field, value) => '<label>' + label + '<input data-field="' + field +
      '" type="number" min="0" step="any" inputmode="decimal" value="' + esc(value) + '"></label>';
    const rows = gradeRows(prices, grader);
    function renderRow(row) {
      const r = priceRow(row, prices, grader, state, context.net);
      const heading = row.basis.startsWith('Mixed') ? 'Grade ' + row.grade : row.basis;
      const subtitle = row.basis.startsWith('Mixed') ? 'Mixed-grader guide · not specific to ' + grader : 'Grader-specific guide';
      const field = (label, value) => '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>';
      return '<details class="gp-grade" data-grade="' + row.key + '"><summary><span><strong>' + heading + '</strong><small>Guide value: ' + money(row.price) + '</small><small>' + subtitle + '</small></span>' +
        '<span class="gp-result">' + money(r.proceeds) + '<small>' + (r.error ? esc(r.error) : r.completeCosts ? 'Estimated net proceeds' : 'Before unentered costs') + '</small></span></summary>' +
        '<dl>' + field('Guide sale value', money(row.price)) + field('eBay selling fees', money(r.sellingFees ?? (row.price !== null && Number.isFinite(r.sellingNet) ? row.price - r.sellingNet : null))) +
        field('Grading fee' + (r.tier ? ' · ' + r.tier.name : ''), money(r.fee)) +
        field('Submission shipping + insurance', r.shipping == null ? 'Not entered' : money(r.shipping)) +
        field('Sale shipping you pay', r.saleShip == null ? 'Not entered' : money(r.saleShip)) +
        field('Capital cost adjustment', r.holding == null ? '—' : money(r.holding)) +
        field(r.completeCosts ? 'Net proceeds' : 'Subtotal before unentered costs', money(r.proceeds)) +
        field('Difference vs selling raw' + (r.completeCosts ? '' : ' · before unentered costs'), money(r.difference)) + '</dl>' +
        (r.error ? '<p>' + r.error + '</p>' : '<p>' + (r.days == null ? 'Wait not entered.' : 'Estimated grading wait: ' + r.days + ' working days. Approx. ' + r.calendarDays + ' calendar days' + (state.extra === '' ? ' before transit and selling time' : ' including your extra days') + '.') + '</p>') + '</details>';
    }
    function drawResults() {
      const opened = new Set([...panel.querySelectorAll('.gp-grade[open]')].map(e => e.dataset.grade));
      panel.querySelector('[data-rows]').innerHTML = rows.filter(r => !/^grade_[1-6]$/.test(r.key)).map(renderRow).join('');
      panel.querySelector('[data-lower-rows]').innerHTML = rows.filter(r => /^grade_[1-6]$/.test(r.key)).map(renderRow).join('');
      for (const row of panel.querySelectorAll('.gp-grade')) row.open = opened.has(row.dataset.grade);
      const summary = panel.querySelector('[data-settings] > summary');
      if (summary) summary.textContent = 'Your submission details · ' + (state.count || '?') + ' card' + (state.count === '1' ? '' : 's');
    }
    function draw() {
      panel.innerHTML = '<h3>Grade-by-grade value</h3><div class="gp-graders" role="group" aria-label="Grading company">' +
        ['PSA','CGC','BGS','SGC'].map(g => '<button type="button" data-grader="' + g + '" aria-pressed="' + (grader === g) + '">' + g + '</button>').join('') + '</div>' +
        '<p>Prices and fees follow your selected company. AI condition estimate: PSA ' + esc(context.psaEst ?? 'unavailable') + '; other grading standards have not been estimated.</p>' +
        '<div class="gp-baseline">Sell raw guide: <strong>' + money(number(prices.raw)) + '</strong> · after eBay fees: ' + (number(prices.raw) > 0 ? money(context.net(number(prices.raw))) : '—') + ' before shipping.</div>' +
        '<label>Grading service<select data-field="tier">' + (sources[grader] ? '<option value="auto"' + (state.tier === 'auto' ? ' selected' : '') + '>Lowest listed fee eligible for each grade value</option>' : '') +
        tiers.filter(t => t.grader === grader).map(t => '<option value="' + t.id + '"' + (state.tier === t.id ? ' selected' : '') + '>' + t.name + ' · $' + t.fee.toFixed(2) + ' · ' + (t.minDays === t.days ? t.days : t.minDays + '–' + t.days) + ' working days</option>').join('') +
        '<option value="custom"' + (state.tier === 'custom' ? ' selected' : '') + '>My actual grading quote</option></select></label>' +
        (sources[grader] ? '<p><a href="' + sources[grader] + '" target="_blank" rel="noopener">Official fees</a> checked ' + checkedAt + '. Direct US base rates, before membership discounts and extras. ' + (grader === 'PSA' ? 'Value services were paused. ' : '') +
          'Tier eligibility is estimated from each guide value and your submission size; the grader determines final value. ' + (!fresh() ? 'Snapshot expired; use a current quote.' : '') + '</p>' : '<p>Current ' + grader + ' fees are not loaded. Add your quote; available guide prices still appear below.</p>') +
        (state.tier === 'custom' ? '<div class="gp-grid">' + input('Grading fee per card ($)', 'fee', state.fee) + input('Grading wait · working days', 'days', state.days) + '</div>' : '') +
        '<details data-settings' + (state.open ? ' open' : '') + '><summary>Your submission details · assumed 1 card unless changed</summary><p>Only details we cannot know. Blank shipping stays excluded; enter 0 if none. Sale shipping below applies to both raw and graded scenarios.</p><div class="gp-grid">' +
        input('Cards in your submission', 'count', state.count) + input('Submission shipping + insurance per card ($)', 'shipping', state.shipping) + input('Sale shipping per card ($)', 'saleShip', state.saleShip) +
        input('Annual capital cost (%) · 0 = off', 'rate', state.rate) + input('Extra calendar days · transit + selling', 'extra', state.extra) + '</div></details>' +
        '<p class="gp-price-note">Guide values, not guaranteed sale prices. Mixed-grader rows remain the same when no company-specific value is available. Tap a grade for its price breakdown.</p><div data-rows></div>' +
        '<details data-lower' + (state.lower ? ' open' : '') + '><summary>Grades 1–6</summary><div data-lower-rows></div></details>' +
        '<p>These are conditional outcomes, not grade predictions or probabilities. Waits are estimates, not guarantees. Calendar estimates use working days × 7/5, excluding holiday delays. Capital cost uses foregone raw net proceeds plus submission costs. Future price movements are not modeled.</p>';
      drawResults();
    }
    panel.addEventListener('click', e => {
      const g = e.target.closest('[data-grader]');
      if (g) {
        root._crSetGradingGrader(g.dataset.grader);
        el.querySelector('[data-grader="' + g.dataset.grader + '"]')?.focus();
      }
    });
    panel.addEventListener('input', e => {
      if (!e.target.dataset.field || e.target.tagName === 'SELECT') return;
      state[e.target.dataset.field] = e.target.value; drawResults();
    });
    panel.addEventListener('change', e => {
      if (e.target.tagName !== 'SELECT') return;
      state.open = panel.querySelector('[data-settings]').open;
      state.lower = panel.querySelector('[data-lower]').open;
      state.tier = e.target.value; draw(); panel.querySelector('select').focus();
    });
    panel.addEventListener('toggle', e => {
      if (!panel.contains(e.target)) return;
      if (e.target.matches('[data-settings]')) state.open = e.target.open;
      if (e.target.matches('[data-lower]')) state.lower = e.target.open;
    }, true);
    draw(); el.replaceChildren(panel);
  }
  root.CardResellGradingPaths = { mount, gradeRows, priceRow, tiers, fresh };
})(typeof window === 'undefined' ? globalThis : window);
