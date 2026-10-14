/* Conditional submission scenarios. No AI grade conversion, provider calls,
 * automatic best-grader claim or cross-grader price substitution. */
(function (root) {
  'use strict';
  const checkedAt = '2026-10-12';
  const sources = {
    PSA: 'https://www.psacard.com/services/tradingcardgrading',
    CGC: 'https://www.cgccards.com/submit/services-fees/cgc-grading/',
    BGS: 'https://beckett.jotform.com/form/beckett-card-grading-submission',
    SGC: 'https://www.gosgc.com/card-grading/services-pricing'
  };
  const tiers = [
    { id: 'psa-standard', grader: 'PSA', name: 'Standard', fee: 59.99, minDays: 90, days: 100, maxValue: 1000, minCards: 1 },
    { id: 'psa-priority', grader: 'PSA', name: 'Priority', fee: 79.99, minDays: 70, days: 80, maxValue: 1500, minCards: 1 },
    { id: 'psa-express', grader: 'PSA', name: 'Express', fee: 199, minDays: 20, days: 30, maxValue: 2500, minCards: 1 },
    { id: 'psa-super-express', grader: 'PSA', name: 'Super Express', fee: 349, minDays: 10, days: 15, maxValue: 5000, minCards: 1 },
    { id: 'psa-premier', grader: 'PSA', name: 'Premier', fee: 599, minDays: 7, days: 10, maxValue: 10000, minCards: 1 },
    { id: 'psa-premium-1', grader: 'PSA', name: 'Premium 1', fee: 999, minDays: 5, days: 7, maxValue: 25000, minCards: 1 },
    { id: 'psa-premium-2', grader: 'PSA', name: 'Premium 2', fee: 1999, minDays: 5, days: 7, maxValue: 50000, minCards: 1 },
    { id: 'psa-premium-3', grader: 'PSA', name: 'Premium 3', fee: 2999, minDays: 5, days: 7, maxValue: 100000, minCards: 1 },
    { id: 'psa-premium-5', grader: 'PSA', name: 'Premium 5', fee: 4999, minDays: 5, days: 7, maxValue: 250000, minCards: 1 },
    { id: 'psa-premium-10', grader: 'PSA', name: 'Premium 10', fee: 9999, minDays: 5, days: 7, maxValue: 1000000, minCards: 1, stepAbove: 350000, stepSize: 10000, stepFee: 399 },
    { id: 'cgc-bulk', grader: 'CGC', name: 'Bulk', fee: 17, minDays: 150, days: 150, maxValue: 500, minCards: 25 },
    { id: 'cgc-economy', grader: 'CGC', name: 'Economy', fee: 20, minDays: 90, days: 90, maxValue: 1000, minCards: 1 },
    { id: 'cgc-standard', grader: 'CGC', name: 'Standard', fee: 55, minDays: 10, days: 10, maxValue: 3000, minCards: 1 },
    { id: 'cgc-express', grader: 'CGC', name: 'Express', fee: 100, minDays: 5, days: 5, maxValue: 10000, minCards: 1 },
    { id: 'cgc-walkthrough', grader: 'CGC', name: 'WalkThrough', fee: 300, minDays: 2, days: 2, maxValue: 100000, minCards: 1 },
    { id: 'cgc-unlimited', grader: 'CGC', name: 'Unlimited Value', fee: 300, valueRate: .01, minDays: 2, days: 2, maxValue: 1000000, minCards: 1 },
    // Current official temporary form offers Express only, with subgrades.
    // It publishes no card-value surcharge/cap; do not invent one.
    { id: 'bgs-express', grader: 'BGS', name: 'Express (subgrades)', fee: 79.95, minDays: 15, days: 15, maxValue: null, minCards: 1, maxCards: 100 },
    { id: 'sgc-standard-1500', grader: 'SGC', name: 'Standard · up to $1,500', fee: 50, minDays: 40, days: 40, daysAtLeast: true, maxValue: 1500, minCards: 1 },
    { id: 'sgc-standard-3500', grader: 'SGC', name: 'Standard · up to $3,500', fee: 85, minDays: 40, days: 40, daysAtLeast: true, maxValue: 3500, minCards: 1 },
    { id: 'sgc-expedited-3500', grader: 'SGC', name: 'Expedited · up to $3,500', fee: 150, minDays: 2, days: 3, maxValue: 3500, minCards: 1 },
    { id: 'sgc-expedited-7500', grader: 'SGC', name: 'Expedited · up to $7,500', fee: 250, minDays: 2, days: 3, maxValue: 7500, minCards: 1 },
    { id: 'sgc-expedited-20000', grader: 'SGC', name: 'Expedited · up to $20,000', fee: 500, minDays: 2, days: 3, maxValue: 20000, minCards: 1 },
    { id: 'sgc-expedited-50000', grader: 'SGC', name: 'Expedited · up to $50,000', fee: 1000, minDays: 2, days: 3, maxValue: 50000, minCards: 1 },
    { id: 'sgc-expedited-100000', grader: 'SGC', name: 'Expedited · up to $100,000', fee: 2000, minDays: 2, days: 3, maxValue: 100000, minCards: 1 }
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
  const tierFee = (tier, value) => tier.fee + (tier.valueRate || 0) * value +
    (tier.stepSize ? Math.ceil(Math.max(0, value - tier.stepAbove) / tier.stepSize) * tier.stepFee : 0);
  const waitLabel = tier => tier.daysAtLeast ? tier.days + '+' : tier.minDays === tier.days ? String(tier.days) : tier.minDays + '–' + tier.days;
  const monthLabel = tier => {
    const months = days => (Math.ceil(days * 7 / 5) / 30.44).toFixed(1);
    return tier.daysAtLeast ? '~' + months(tier.days) + '+ months' :
      '~' + months(tier.minDays) + (tier.minDays === tier.days ? '' : '–' + months(tier.days)) + ' months';
  };
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
    if (!fresh(now)) return { ...row, sellingNet, error: 'Published grading fees need a refresh; fee estimate unavailable.' };
    const eligible = tiers.filter(t => t.grader === grader && (t.maxValue === null || row.price <= t.maxValue) && count >= t.minCards && count <= (t.maxCards || 10000));
    const tier = settings.tier === 'auto' ? eligible.sort((a, b) => tierFee(a, row.price) - tierFee(b, row.price))[0] : eligible.find(t => t.id === settings.tier);
    if (!tier) return { ...row, sellingNet, error: 'No eligible published tier for this value and submission size.' };
    const fee = tierFee(tier, row.price), days = tier.days;
    const shipping = number(settings.shipping), saleShip = number(settings.saleShip);
    if ((settings.shipping !== '' && shipping === null) || (settings.saleShip !== '' && saleShip === null))
      return { ...row, sellingNet, error: 'Shipping must be a nonnegative dollar amount.' };
    const rate = number(settings.rate, 100), extra = number(settings.extra, 2000);
    if (rate === null || (rate > 0 && (extra === null || days === null || rawNet === null)))
      return { ...row, sellingNet, error: 'Capital adjustment needs raw value, grading wait and additional calendar days.' };
    const other = number(settings.other ?? '0');
    if (other === null) return { ...row, sellingNet, error: 'Other grading costs must be a nonnegative dollar amount (0 if none).' };
    const completeCosts = shipping !== null && saleShip !== null;
    const proceeds = sellingNet - fee - (shipping ?? 0) - (saleShip ?? 0) - other;
    const calendarDays = days === null ? null : Math.ceil(days * 7 / 5) + (extra ?? 0);
    // Missing expenses stay explicitly excluded; no full net claim until entered.
    if (rate > 0 && !completeCosts) return { ...row, sellingNet, error: 'Enter shipping costs (0 if none) to calculate capital cost.' };
    const rawProceeds = rawNet === null ? null : rawNet - (saleShip ?? 0);
    const holding = rate > 0 ? (Math.max(0, rawProceeds) + fee + shipping + other) * rate / 100 * calendarDays / 365 : 0;
    return { ...row, sellingNet, sellingFees: row.price - sellingNet, fee, tier, days,
      shipping, saleShip, other, completeCosts, proceeds: proceeds - holding, holding, calendarDays,
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
      states.set(key, { tier: 'auto', count: '1',
        shipping: '', saleShip: '', other: '0', rate: '0', extra: '', open: false, lower: false });
    }
    const state = states.get(key), prices = context.prices || {};
    const panel = document.createElement('section'); panel.className = 'grading-paths';
    const input = (label, field, value) => '<label>' + label + '<input data-field="' + field +
      '" type="number" min="0" step="any" inputmode="decimal" value="' + esc(value) + '"></label>';
    const rows = gradeRows(prices, grader);
    let bestKey = null;
    function renderRow(row) {
      const r = priceRow(row, prices, grader, state, context.net);
      const heading = row.basis.startsWith('Mixed') ? 'Grade ' + row.grade : row.basis;
      const subtitle = row.basis.startsWith('Mixed') ? 'Mixed-grader guide · not specific to ' + grader : 'Grader-specific guide';
      const field = (label, value) => '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>';
      return '<details class="gp-grade' + (row.key === bestKey ? ' gp-highlight' : r.difference < 0 ? ' gp-negative' : '') + '" data-grade="' + row.key + '"><summary><span><strong>' + heading + '</strong><small>Guide value: ' + money(row.price) + '</small><small>Grading fee: ' + money(r.fee) + (r.tier ? ' · ' + esc(r.tier.name) : '') + '</small>' + (r.tier ? '<small class="gp-wait">' + waitLabel(r.tier) + ' working days · ' + monthLabel(r.tier) + '</small>' : '') + '<small>' + subtitle + '</small></span>' +
        '<span class="gp-result">' + money(r.proceeds) + '<small>' + (r.error ? esc(r.error) : r.completeCosts ? 'Estimated net proceeds' : 'Before unentered costs') + '</small>' + (Number.isFinite(r.difference) ? '<small class="gp-difference">' + (r.difference >= 0 ? '+' : '') + money(r.difference) + ' vs raw</small>' : '') + '</span></summary>' +
        '<dl>' + field('Guide sale value', money(row.price)) + field('eBay selling fees', money(r.sellingFees ?? (row.price !== null && Number.isFinite(r.sellingNet) ? row.price - r.sellingNet : null))) +
        field('Grading fee' + (r.tier ? ' · ' + r.tier.name : ''), money(r.fee)) +
        field('Submission shipping + insurance', r.shipping == null ? 'Not entered' : money(r.shipping)) +
        field('Sale shipping you pay', r.saleShip == null ? 'Not entered' : money(r.saleShip)) +
        field('Other grading costs · tax, supplies, time', money(r.other)) +
        field('Capital cost adjustment', r.holding == null ? '—' : money(r.holding)) +
        field(r.completeCosts ? 'Net proceeds' : 'Subtotal before unentered costs', money(r.proceeds)) +
        field('Difference vs selling raw' + (r.completeCosts ? '' : ' · before unentered costs'), money(r.difference)) + '</dl>' +
        (r.error ? '<p>' + r.error + '</p>' : '<p>Estimated grading wait: ' + waitLabel(r.tier) + ' working days. ' + (r.tier.daysAtLeast ? 'At least approx. ' : 'Approx. ') + r.calendarDays + ' calendar days' + (state.extra === '' ? ' before transit and selling time' : ' including your extra days') + '.' + (r.tier.daysAtLeast && r.holding > 0 ? ' Capital cost uses this minimum wait and may be higher.' : '') + '</p>') + '</details>';
    }
    function drawResults() {
      const computed = rows.map(row => priceRow(row, prices, grader, state, context.net));
      const priced = computed.filter(r => !r.error);
      const services = [...new Map(priced.map(r => [r.tier.id, r.tier])).values()];
      panel.querySelector('[data-service-summary]').innerHTML = '<strong>Grading fee &amp; estimated wait</strong>' +
        (services.length ? services.map(t => {
          const fees = priced.filter(r => r.tier.id === t.id).map(r => r.fee);
          const low = Math.min(...fees), high = Math.max(...fees);
          return '<div class="gp-service-line"><span>' + esc(t.name) + ' · ' + money(low) + (high !== low ? '–' + money(high) : '') + ' / card</span><b>' + waitLabel(t) + ' working days · ' + monthLabel(t) + '</b></div>';
        }).join('') + '<small>' + (services.length > 1 ? 'Automatic service varies by grade value. Each outcome below uses its eligible tier. ' : '') + 'Grading time only; transit and selling time are additional.</small>' :
          '<p>' + (!fresh() ? 'Published fee snapshot expired. Updated fee and wait estimates are unavailable.' : 'No eligible estimate. Check available grade values, service and submission details below.') + '</p>');
      const missing = ['shipping', 'saleShip'].filter(field => state[field] === '');
      const invalid = ['shipping', 'saleShip'].some(field => state[field] !== '' && number(state[field]) === null);
      panel.querySelector('[data-cost-coverage]').textContent = invalid ? 'Check shipping amounts below.' : missing.length ?
        'Still excluded: ' + missing.map(field => field === 'shipping' ? 'submission shipping + insurance' : 'sale shipping').join(' and ') + '.' :
        'Both shipping amounts entered. Optional costs set to 0 stay excluded.';
      panel.querySelector('[data-edit-costs]').textContent = missing.length ? 'Add shipping costs' : 'Edit submission costs';
      const comparable = computed.filter(r => !r.error && Number.isFinite(r.difference));
      const best = comparable.sort((a,b) => b.difference-a.difference)[0];
      bestKey = best && best.difference > 0 ? best.key : null;
      const rawPrice = number(prices.raw), saleShip = number(state.saleShip);
      const rawNet = rawPrice > 0 ? context.net(rawPrice) : null;
      const rawAfterShipping = Number.isFinite(rawNet) && saleShip !== null ? rawNet-saleShip : null;
      panel.querySelector('[data-baseline]').innerHTML = '<strong>Sell raw today</strong><br>' +
        (Number.isFinite(rawAfterShipping) ? money(rawAfterShipping) + ' estimated net after eBay fees and entered sale shipping' :
          Number.isFinite(rawNet) && state.saleShip === '' ? money(rawNet) + ' after eBay fees, before unentered shipping' : 'Raw comparison unavailable: check guide value and sale shipping.');
      panel.querySelector('[data-decision]').innerHTML = best ?
        '<strong>' + (best.difference > 0 ? 'Highest available scenario: ' + esc(grader + ' ' + best.grade) : 'No priced ' + esc(grader) + ' outcome beats selling raw') + '</strong><br>' +
        money(best.proceeds) + (best.completeCosts ? ' estimated net' : ' before unentered costs') +
        ' · ' + (best.difference >= 0 ? '+' : '') + money(best.difference) + ' vs raw<br>' +
        esc(best.tier.name) + ' · ' + waitLabel(best.tier) + ' working days · ' + monthLabel(best.tier) +
        '<small>Conditional on this grade and guide value; not a likely outcome or a submission recommendation. ' +
        (best.basis.startsWith('Mixed') ? 'This outcome uses a mixed-grader price. ' : '') + 'Missing grade prices are excluded. Grading time excludes transit and selling time.</small>' :
        '<strong>Compare with selling raw</strong><br>Complete the available value, service and cost details to compare outcomes.';
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
        '<label>Grading service<select data-field="tier"><option value="auto"' + (state.tier === 'auto' ? ' selected' : '') + '>Automatic · lowest eligible published fee</option>' +
        tiers.filter(t => t.grader === grader).map(t => '<option value="' + t.id + '"' + (state.tier === t.id ? ' selected' : '') + '>' + t.name + ' · ' + (t.stepSize || t.valueRate ? 'from ' : '') + '$' + t.fee.toFixed(2) + ' · ' + waitLabel(t) + ' working days</option>').join('') + '</select></label><div class="gp-service-summary" data-service-summary></div>' +
        '<p><a href="' + sources[grader] + '" target="_blank" rel="noopener">Published fees &amp; waits</a> · snapshot checked ' + checkedAt + '. Standard-size, unsigned cards submitted in the US; before tax, shipping, discounts and optional extras. ' + (grader === 'PSA' ? 'Value services are paused. ' : grader === 'BGS' ? 'Express with subgrades is currently available; Base and Standard are paused. No value-based surcharge is published for this service. ' : '') +
          'Fees are calculated from each guide value and your submission size; the grader confirms final value and charges. ' + (!fresh() ? 'Fee snapshot expired; updated fees are unavailable.' : '') + '</p>' +
        '<div class="gp-cost-coverage"><strong>What your estimate includes</strong><p>eBay selling fees and the eligible grading fee are calculated automatically.</p><p data-selling-fee-assumption>' + esc(context.sellingFeeNote || 'Buyer tax is not estimated in eBay selling fees.') + '</p><p data-cost-coverage></p><button type="button" data-edit-costs>Add shipping costs</button></div>' +
        '<details data-settings' + (state.open ? ' open' : '') + '><summary>Your submission details · assumed 1 card unless changed</summary><p>Only details we cannot know. Blank shipping stays excluded; enter 0 if none. Sale shipping below applies to both raw and graded scenarios.</p><div class="gp-grid">' +
        input('Cards in your submission', 'count', state.count) + input('Submission shipping + insurance per card ($)', 'shipping', state.shipping) + input('Sale shipping per card ($)', 'saleShip', state.saleShip) +
        input('Other grading costs per card · tax, supplies, time ($)', 'other', state.other) +
        input('Annual capital cost (%) · 0 = off', 'rate', state.rate) + input('Extra calendar days · transit + selling', 'extra', state.extra) + '</div></details>' +
        '<div class="gp-comparison"><div class="gp-baseline" data-baseline></div><div class="gp-baseline" data-decision></div></div>' +
        '<p class="gp-price-note">PriceCharting guide values, not individual sold listings or guaranteed sale prices. Sale dates and sample sizes are unavailable in this guide. Mixed-grader rows remain the same when no company-specific value is available. Tap a grade for its price breakdown.</p><div data-rows></div>' +
        '<details data-lower' + (state.lower ? ' open' : '') + '><summary>Grades 1–6</summary><div data-lower-rows></div></details>' +
        '<button type="button" data-export>Export ' + grader + ' comparison (.csv)</button><p data-export-status role="status"></p>' +
        '<p>AI percentage weights are not calibrated outcome probabilities, so an expected-profit figure is not available. These are conditional outcomes, not grade predictions or probabilities. Waits are estimates, not guarantees. Calendar estimates use working days × 7/5, excluding holiday delays. Capital cost uses foregone raw net proceeds plus entered submission costs. Optional costs set to 0 are excluded; net proceeds are not profit after your card purchase cost. Future price movements are not modeled.</p>';
      drawResults();
    }
    panel.addEventListener('click', e => {
      if (e.target.closest('[data-edit-costs]')) {
        state.open = true;
        panel.querySelector('[data-settings]').open = true;
        const field = ['shipping', 'saleShip'].find(f => state[f] === '' || number(state[f]) === null) || 'shipping';
        panel.querySelector('[data-field="' + field + '"]').focus();
        return;
      }
      if (e.target.closest('[data-export]')) {
        const header = ['Grader','Grade','Price basis','Guide USD','Service','Working days','Approx grading months','Grading fee USD','Selling fees USD','Submission shipping USD','Sale shipping USD','Other grading costs USD','Capital cost USD','Proceeds USD','Difference vs raw USD','Cost coverage / issue'];
        const records = rows.map(row => {
          const r = priceRow(row, prices, grader, state, context.net);
          return [grader,row.grade,row.basis,row.price,r.tier?.name,r.tier ? waitLabel(r.tier) : '',r.tier ? monthLabel(r.tier) : '',r.fee,r.sellingFees,r.shipping,r.saleShip,r.other,r.holding,r.proceeds,r.difference,r.error || (r.completeCosts ? 'Entered costs included; zero optional costs excluded' : 'Before unentered costs')];
        });
        const cell = value => {
          let text = value == null ? '' : typeof value === 'number' ? value.toFixed(2) : String(value);
          if (typeof value !== 'number' && /^[=+@\-\t\r]/.test(text)) text = "'" + text;
          return '"' + text.replace(/"/g,'""') + '"';
        };
        const metadata = [['CardResell conditional grading comparison',new Date().toISOString()],['Card',context.cardLabel || 'Card identity unavailable'],['Fee snapshot',checkedAt],['eBay buyer-tax assumption',context.sellingFeeNote || 'Buyer tax is not estimated in eBay selling fees.'],['AI condition estimate (PSA only)',context.psaEst ?? 'unavailable'],['Scope','Guide scenarios, not predictions, sold comps, purchase profit or expected value. Sale dates/sample sizes unavailable.'],['Capital annual rate percent',state.rate],['Additional calendar days',state.extra === '' ? 'not entered' : state.extra]];
        const csv = [...metadata,[],header,...records].map(row=>row.map(cell).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));
        const link = document.createElement('a'); link.href=url;link.download='cardresell-'+grader.toLowerCase()+'-grading-'+new Date().toISOString().slice(0,10)+'.csv';
        document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
        panel.querySelector('[data-export-status]').textContent='Comparison exported with the current assumptions and missing-cost labels.';
        return;
      }
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
