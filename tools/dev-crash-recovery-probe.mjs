/**
 * Q-D8-3 — does the create path survive losing the idempotency RESULT record?
 *
 * The question is not cosmetic. `_idempotency.js` documents `createdByOperation`
 * as the record's own provenance, but the reconcile hook in `_draftService.js`
 * recovers from the RESOURCE POINTER, not from that field. So the field being
 * null only matters if the pointer is the sole survivor and it is enough.
 *
 * Three scenarios, run against the real handlers:
 *   A. result record lost, pointer survives   -> must recover to the SAME draft
 *   B. pointer lost, result record survives   -> must replay the SAME draft
 *   C. both lost                              -> the honest worst case; measure it
 *
 * In every case the invariant is: ONE draft, and quota consumption that matches
 * the number of drafts that actually exist.
 */
const BASE = 'http://localhost:8100';
const SLOT = 'ebay:fixed-price';

const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t; } };

async function token(sub) {
  return (await j(await fetch(`${BASE}/__devtoken?sub=${encodeURIComponent(sub)}`))).token;
}
async function del(prefix) {
  return (await j(await fetch(`${BASE}/__kvdel?prefix=${encodeURIComponent(prefix)}`))).deleted;
}
async function kvget(prefix) {
  return j(await fetch(`${BASE}/__kvget?prefix=${encodeURIComponent(prefix)}`));
}

function card(tag) {
  return {
    name: `Charizard ${tag}`, set: 'Base Set', number: '4/102',
    game: 'pokemon', cardType: 'pokemon', condition: 'NM',
  };
}

async function create(tok, key, tag, instanceId) {
  const r = await fetch(`${BASE}/api/drafts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${tok}`, 'idempotency-key': key },
    body: JSON.stringify({
      card: card(tag), instanceId, slot: SLOT, price: 2, priceSource: 'seller', source: 'collection',
    }),
  });
  return { status: r.status, body: await j(r) };
}

async function list(tok) {
  const r = await fetch(`${BASE}/api/drafts`, { headers: { authorization: `Bearer ${tok}` } });
  const b = await j(r);
  return { status: r.status, ids: (b.rows || []).map((x) => x.draftId), total: b.total };
}

const results = [];
function report(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  — ${detail}` : ''}`);
}

async function scenario(label, sub, drop) {
  console.log(`\n=== ${label} ===`);
  const tok = await token(sub);
  const key = `sell-col-${sub}-ebay-fixed-price`;
  const inst = `inst_col_${sub}`;

  const first = await create(tok, key, label, inst);
  const id1 = first.body && first.body.draft && first.body.draft.draftId;
  report(`${label}: first create returns 201`, first.status === 201, `${first.status} ${id1 || ''}`);

  const beforeKeys = Object.keys(await kvget('idem'));
  const quotaBefore = await kvget('draftquota');

  const dropped = [];
  for (const p of drop) dropped.push(...(await del(p)));
  console.log(`     dropped: ${JSON.stringify(dropped)}`);
  report(`${label}: the intended rows were actually removed`, dropped.length > 0, dropped.join(', '));

  const retry = await create(tok, key, label, inst);
  const id2 = retry.body && retry.body.draft && retry.body.draft.draftId;
  const state = retry.body && (retry.body.idempotency || retry.body.state || retry.body.reconciled);

  console.log(`     retry -> ${retry.status} ${id2} state=${JSON.stringify(state)}`);
  report(`${label}: retry does not mint a second draft id`, !!id2 && id2 === id1, `${id1} vs ${id2}`);

  const l = await list(tok);
  report(`${label}: exactly one draft exists`, l.ids.length === 1, `ids=${JSON.stringify(l.ids)}`);

  const quotaAfter = await kvget('draftquota');
  report(`${label}: quota counts one draft, not two`,
    JSON.stringify(quotaBefore) === JSON.stringify(quotaAfter),
    `before=${JSON.stringify(quotaBefore)} after=${JSON.stringify(quotaAfter)}`);

  console.log(`     idem rows before drop: ${JSON.stringify(beforeKeys)}`);

  // Does the surviving record carry its own operation provenance?
  const rec = await kvget('draft:');
  const anyRecord = Object.values(rec)[0] || '';
  const carries = /"createdByOperation":"[^"]+"/.test(anyRecord);
  console.log(`     createdByOperation on the record: ${carries ? 'present' : 'null/absent'}`);
}

await scenario('A-result-lost',  'crash-a', ['idem:crash-a']);
await scenario('B-pointer-lost', 'crash-b', ['idemresource:crash-b']);
await scenario('C-both-lost',    'crash-c', ['idem:crash-c', 'idemresource:crash-c']);

const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
if (failed.length) console.log(failed.map((f) => `  ${f.name}: ${f.detail}`).join('\n'));
