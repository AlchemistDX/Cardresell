// Offline unit test for the 2026-09-01 webhook P0 fixes.
// Runs the webhook handler against synthetic events with stub Stripe signature
// verification (skipped when STRIPE_WEBHOOK_SECRET is unset — the handler
// short-circuits sig verification in that path already for local dev if
// coded that way; otherwise we stub the crypto by writing a valid HMAC).
//
// We stub network fetch to capture what would be written to KV.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

process.env.KV_REST_API_URL   = 'https://kv.test';
process.env.KV_REST_API_TOKEN = 'test-token';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_SECRET_KEY = 'sk_test_offline';

const kvWrites = [];
const kvReads  = new Map();

globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://kv.test/set/')) {
    const decoded = decodeURIComponent(u.replace('https://kv.test/set/', ''));
    // For NX (idempotency) form: `${key}/${val}/EX/${ttl}/NX` — split off the key.
    const parts = decoded.split('/');
    const key = parts[0];
    const rest = parts.slice(1).join('/');
    // If the rest starts with EX or NX slash form, val is the piece before /EX or /NX
    let val = rest;
    if (rest.includes('/EX/')) val = rest.split('/EX/')[0];
    kvWrites.push({ key, val });
    kvReads.set(key, val);
    return new Response(JSON.stringify({ result: 'OK' }), { status: 200 });
  }
  if (u.startsWith('https://kv.test/get/')) {
    const key = decodeURIComponent(u.replace('https://kv.test/get/', ''));
    return new Response(JSON.stringify({ result: kvReads.get(key) || null }), { status: 200 });
  }
  if (u.startsWith('https://api.stripe.com/')) {
    // For webhook signature verification we don't hit Stripe. This branch is for
    // subscription lookup fallbacks — return an empty response to force fall-through.
    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  }
  throw new Error('Unexpected fetch: ' + u);
};

// Sign like Stripe does: t=<unix>,v1=<HMAC-SHA256(t + '.' + payload, secret)>
function stripeSig(rawBody, secret) {
  const ts = Math.floor(Date.now() / 1000);
  const payload = `${ts}.${rawBody}`;
  const v1 = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  return `t=${ts},v1=${v1}`;
}

async function runEvent(event) {
  const rawBody = JSON.stringify(event);
  const sig = stripeSig(rawBody, process.env.STRIPE_WEBHOOK_SECRET);
  const req = {
    method: 'POST',
    headers: { 'stripe-signature': sig, 'content-type': 'application/json' },
    on(evt, cb) {
      if (evt === 'data') cb(Buffer.from(rawBody));
      if (evt === 'end') cb();
    },
    body: undefined,
  };
  let statusCode = null;
  let responseBody = null;
  const res = {
    status(code) { statusCode = code; return this; },
    json(body) { responseBody = body; return this; },
    setHeader() { return this; },
    end() {},
  };
  const mod = await import(path.join(ROOT, 'api/stripe-webhook.js'));
  const handler = mod.default;
  await handler(req, res);
  return { statusCode, responseBody };
}

// Helper: pull last KV write to a specific key.
function lastWrite(prefix) {
  for (let i = kvWrites.length - 1; i >= 0; i--) {
    if (kvWrites[i].key.startsWith(prefix)) return kvWrites[i];
  }
  return null;
}

async function main() {
  const sub = 'firebase-uid-alice';
  const failures = [];

  // ── Case 1: invoice.payment_failed with UID only in subscription_details ──
  const case1 = {
    id: 'evt_test_1',
    type: 'invoice.payment_failed',
    data: { object: {
      id: 'in_test_1',
      subscription: 'sub_test_1',
      // Legacy code only read this — leave it empty to prove we now resolve from below
      metadata: {},
      subscription_details: { metadata: { google_sub: sub } },
    }}
  };
  kvWrites.length = 0; kvReads.clear();
  const r1 = await runEvent(case1);
  const w1 = lastWrite(`pro:${sub}`);
  if (r1.statusCode !== 200) failures.push(`case1: expected 200, got ${r1.statusCode}`);
  if (!w1) failures.push('case1: expected a KV write to pro:<sub>, got none');
  else {
    let rec; try { rec = JSON.parse(w1.val); } catch(_) {}
    if (!rec) failures.push('case1: KV write not valid JSON: ' + w1.val);
    else if (rec.status !== 'past_due') failures.push(`case1: expected status=past_due, got ${rec.status}`);
  }

  // ── Case 2: customer.subscription.updated with status past_due ──
  const case2 = {
    id: 'evt_test_2',
    type: 'customer.subscription.updated',
    data: { object: {
      id: 'sub_test_2',
      status: 'past_due',
      metadata: { google_sub: sub, tier: 'pro' },
      items: { data: [{ price: { id: 'price_pro_monthly' } }] },
    }}
  };
  kvWrites.length = 0; kvReads.clear();
  const r2 = await runEvent(case2);
  const w2 = lastWrite(`pro:${sub}`);
  if (r2.statusCode !== 200) failures.push(`case2: expected 200, got ${r2.statusCode}`);
  if (!w2) failures.push('case2: expected a KV write to pro:<sub>, got none');
  else {
    let rec; try { rec = JSON.parse(w2.val); } catch(_) {}
    if (!rec) failures.push('case2: KV write not valid JSON');
    else if (rec.status !== 'past_due') failures.push(`case2: expected status=past_due, got ${rec.status}`);
  }

  // ── Case 3: customer.subscription.updated with status active ──
  const case3 = {
    id: 'evt_test_3',
    type: 'customer.subscription.updated',
    data: { object: {
      id: 'sub_test_3',
      status: 'active',
      metadata: { google_sub: sub, tier: 'pro_max' },
      items: { data: [{ price: { id: 'price_pro_max' } }] },
    }}
  };
  kvWrites.length = 0; kvReads.clear();
  const r3 = await runEvent(case3);
  const w3 = lastWrite(`pro:${sub}`);
  if (r3.statusCode !== 200) failures.push(`case3: expected 200, got ${r3.statusCode}`);
  if (!w3) failures.push('case3: expected KV write, got none');
  else {
    let rec; try { rec = JSON.parse(w3.val); } catch(_) {}
    if (!rec) failures.push('case3: KV write not valid JSON');
    else {
      if (rec.status !== 'active')  failures.push(`case3: expected status=active, got ${rec.status}`);
      if (rec.tier   !== 'pro_max') failures.push(`case3: expected tier=pro_max, got ${rec.tier}`);
    }
  }

  // ── Case 4: customer.subscription.deleted → cancelled ──
  const case4 = {
    id: 'evt_test_4',
    type: 'customer.subscription.deleted',
    data: { object: {
      id: 'sub_test_4',
      status: 'canceled',
      metadata: { google_sub: sub },
    }}
  };
  kvWrites.length = 0; kvReads.clear();
  const r4 = await runEvent(case4);
  const w4 = lastWrite(`pro:${sub}`);
  if (r4.statusCode !== 200) failures.push(`case4: expected 200, got ${r4.statusCode}`);
  if (!w4) failures.push('case4: expected KV write, got none');
  else {
    let rec; try { rec = JSON.parse(w4.val); } catch(_) {}
    if (!rec || rec.status !== 'cancelled') failures.push(`case4: expected status=cancelled, got ${rec && rec.status}`);
  }

  if (failures.length) {
    console.error('FAIL:');
    failures.forEach(f => console.error(' - ' + f));
    process.exit(1);
  }
  console.log('All 4 webhook P0 cases passed.');
}

main().catch(e => { console.error(e); process.exit(1); });
