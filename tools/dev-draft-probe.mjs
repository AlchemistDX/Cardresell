// tools/dev-draft-probe.mjs — LOCAL ONLY. Drives tools/dev-draft-server.mjs.
const B = 'http://localhost:8100';
const tok = (await (await fetch(B + '/__devtoken')).json()).token;

const CARD = { name: 'Charizard ISO-CHECK-20260910-K7M2Q9', set: 'Base Set — isolation test', number: '4/102', game: 'pokemon' };
const INSTANCE = 'inst_col_1757900000000';
const SLOT = 'ebay:fixed-price';

async function post(key, extra = {}) {
  const r = await fetch(B + '/api/drafts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok, ...(key ? { 'Idempotency-Key': key } : {}) },
    body: JSON.stringify({ card: CARD, instanceId: INSTANCE, slot: SLOT, price: 2, priceSource: 'seller', ...extra }),
  });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, code: j.code, error: j.error, id: j.draftId || j.draft?.id, replayed: j.replayed, state: j.idempotencyState };
}

async function list() {
  const r = await fetch(B + '/api/drafts', { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({}));
  const rows = j.rows || [];
  return { status: r.status, count: rows.length, ids: rows.map(x => x.draftId), prices: rows.map(x => x.summary?.price), publishable: rows.map(x => x.summary?.readiness?.publishable) };
}

async function get(id) {
  const r = await fetch(B + '/api/drafts/' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + tok } });
  const j = await r.json().catch(() => ({}));
  const d = j.draft || j;
  return { status: r.status, id: d.draftId || d.id, price: d.price, priceSource: d.priceSource, state: d.status, rev: d.rev, createdByOperation: d.createdByOperation, title: (d.title||'').slice(0,34) };
}

// exactly what _crIdemKey() in the bundle now produces
const idemPart = (v) => String(v ?? '').replace(/[^A-Za-z0-9._~-]+/g, '-');
const idemKey = (...p) => p.map(idemPart).filter(Boolean).join('-').slice(0, 128);
const REAL_KEY = idemKey('sell-col', '1757900000000', SLOT);
const OLD_KEY  = 'sell-col-1757900000000-' + SLOT;   // what shipped before
const out = [];
out.push(['A. real popup key, first tap', await post(REAL_KEY)]);
out.push(['B. same key, second tap (double tap)', await post(REAL_KEY)]);
out.push(['C. same key, third tap (retry)', await post(REAL_KEY)]);
out.push(['D. card-panel key shape', await post(idemKey('sell', INSTANCE, SLOT))]);
out.push(['D2. the key that SHIPPED (raw slot)', await post(OLD_KEY)]);
out.push(['E. no header at all', await post(null)]);
out.push(['F. key with a colon (namespace escape)', await post('sell:col:1')]);
out.push(['G. key too short', await post('abc')]);
out.push(['H. uuid still accepted', await post('7f9c03ad-1a2b-4c3d-8e4f-0123456789ab')]);

for (const [label, r] of out) console.log(label.padEnd(40), JSON.stringify(r));

const l = await list();
console.log('\nLIST after 8 attempts:', JSON.stringify(l));
if (l.ids && l.ids.length) {
  for (const id of l.ids) console.log('REOPEN', JSON.stringify(await get(id)));
}
