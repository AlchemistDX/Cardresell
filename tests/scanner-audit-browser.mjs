// Shipped picker, real scan/accept handlers, isolated Redis. No live accounts.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { harness } from './_assert.mjs';
import { billingHarness, ambiguous } from './_scanBillingHarness.mjs';
const t = harness('scanner-audit-browser');
for (const bucket of ['paid', 'free']) {
  for (const [reason, status] of [['record_error',503], ['invalid_response',503], ['unsupported_card_type',200], ['multiple_cards',200]]) {
    const h = billingHarness({ bucket });
    try {
      const stub = ambiguous(); stub.ximilar = { miss: reason };
      const r = await h.scan(stub);
      t.check(`${bucket}/${reason}: appropriate error or miss`, r.statusCode === status &&
        (status === 503 ? r.payload.provider_reason === reason : r.payload.identified === false));
      t.check(`${bucket}/${reason}: fully refunded; no invented identity`, h.net() === 0 && !r.payload.card_name);
      t.check(`${bucket}/${reason}: only one provider attempt`, stub.ximilarCalls === 1);
    } finally { h.restore(); }
  }
}
{
  const h = billingHarness({ bucket: 'paid' });
  try {
    const stub = ambiguous();
    const candidates = ['m10','m11'].map(set => ({ card_name: 'Lightning Bolt', card_type: 'mtg', card_number: '146',
      set_code: set, set_name: set === 'm10' ? 'Magic 2010' : 'Magic 2011',
      _grounded_id: set + '-146', confidence_pct: 99 }));
    stub.ximilar = { needsPicker: true, cardInfo: candidates[0], candidates };
    const fallback = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (new URL(String(url)).hostname !== 'api.scryfall.com') return fallback(url, init);
      const set = String(url).includes('m11') ? 'm11' : 'm10';
      return Response.json({ name: 'Lightning Bolt', set, collector_number:'146',
        set_name: set === 'm10' ? 'Magic 2010' : 'Magic 2011', lang:'en', id:'verified-'+set });
    };
    const r = await h.scan(stub);
    t.check('Magic review keeps verified printing IDs', r.payload.needsPicker &&
      r.payload.candidates.every((c,i) => c.grounded_id === 'verified-'+['m10','m11'][i]));
    t.check('review offers contain no similarity percentage', r.payload.candidates.every(c => c.confidence_pct == null));
    t.check('review does not charge before selection', h.net() === 0);
    const accepted = await h.pick(h.body(r.payload.candidates[1]));
    t.check('accepted Magic printing is the user-selected set and catalog ID', accepted.statusCode === 200 &&
      accepted.payload.pickedCard.grounded_id === 'verified-m11' && accepted.payload.pickedCard.set_name === 'Magic 2011');
    t.check('acceptance charges exactly one credit', h.net() === 1);
  } finally { h.restore(); }
}
{
  const h = billingHarness();
  try {
    const stub = ambiguous();
    stub.ximilar = { cardInfo: { card_type:'sports', card_name:'Fixture Athlete', card_number:'12345678',
      set_name:'Chronicles', sport:'MMA', year:'2021', brand:'Panini' } };
    const r = await h.scan(stub);
    t.check('sports numeric identifier stays sports, with brand and set', r.payload.card_type === 'sports' &&
      r.payload.brand === 'Panini' && r.payload.set_name === 'Chronicles');
  } finally { h.restore(); }
}
const root = resolve(new URL('..', import.meta.url).pathname), origin = 'https://scanner-audit.test';
const browser = await chromium.launch({ executablePath:process.env.CR_CHROMIUM, args:['--no-sandbox'] });
try {
  for (const width of [390, 1280]) {
    const context = await browser.newContext({viewport:{width,height:844}});
    const outbound = [];
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin || url.pathname.startsWith('/api/')) {
        outbound.push(url.href); return route.fulfill({status:503,body:'offline'});
      }
      try {
        const path = resolve(root, '.'+(url.pathname === '/' ? '/index.html' : url.pathname));
        assert.ok(path.startsWith(root+'/'));
        return route.fulfill({body:readFileSync(path),contentType:path.endsWith('.js')?'application/javascript':path.endsWith('.css')?'text/css':'text/html'});
      } catch { return route.fulfill({status:404,body:''}); }
    });
    const page = await context.newPage(); await page.goto(origin);
    await page.waitForFunction(() => typeof _renderScanCandidatesPicker === 'function');
    const result = await page.evaluate(() => {
      const status=document.createElement('div'), result=document.createElement('div');
      result.style.width='100%'; document.body.replaceChildren(status,result);
      const candidates=[{card_name:'<img src=x onerror="window.injected=true">',set_name:'Magic <2010>',card_number:'146',confidence_pct:99},
        {card_name:'Lightning Bolt',set_name:'Magic 2011',card_number:'146',confidence_pct:55}];
      window._setScanBtns=()=>{};
      _renderScanCandidatesPicker(candidates,status,result,null,{confirmation_id:'a'.repeat(64),candidate_set:'b'.repeat(64),scan_id:'fixture'});
      let selected=null;window._pickScanCandidate=i=>{selected=i};result.querySelectorAll('button')[1].click();
      return {text:status.textContent+' '+result.textContent, images:result.querySelectorAll('img').length,
        height:result.querySelector('button').getBoundingClientRect().height, selected,
        pending:window._pendingScanCandidates[1].set_name, injected:!!window.injected};
    });
    t.check(`${width}px: explicit review wording, no percentage claim`, result.text.includes('Review possible matches') && !/%|100/.test(result.text));
    t.check(`${width}px: provider text is escaped`, result.images === 0 && !result.injected && result.text.includes('<img src=x'));
    t.check(`${width}px: readable, tappable options keep selected printing`, result.height >= 48 && result.selected === 1 && result.pending === 'Magic 2011');
    t.check(`${width}px: no scan, debit or persistence request`, !outbound.some(url => /\/api\/(scan|scan-debit-id|user-data|listing-drafts)(?:\?|$)/.test(url)));
    await context.close();
  }
} finally { await browser.close(); }
t.done();
