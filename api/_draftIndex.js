// api/_draftIndex.js — secondary indexes for listing drafts
//
// Phase 1, Block A2. Platform-neutral, like _cardIdentity.js: a draft is
// "this user intends to sell this card", and the venue is a field on the
// draft rather than part of its identity.
//
// Answers two questions without ever scanning the keyspace:
//   1. "Which drafts does this user have?"        → drafts:<sub>
//   2. "Do I already have a draft for this card?" → skudraft:<sub>:<sku>
//
// ── 🔴 Correction to the Phase 1 checklist ──
// The checklist specified the second index as `sku_draft:${sku}` — global,
// unscoped by user. That is a cross-tenant collision: two different sellers
// listing the same PSA 10 Charizard would map to one key, and whoever wrote
// second would silently take over the first seller's draft pointer. Both
// indexes are user-scoped here. The `sku` alone is intentionally never a key.
//
// Storage is Upstash REST, matching the rest of api/ — no npm SDK, no
// package.json. Redis command helper mirrors api/events.js.

const KV_URL   = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;

// Drafts are working state, not a permanent archive. 180 days is well past
// any realistic "I'll get to it later" window, and it means an abandoned
// account stops costing storage without us running a reaper.
export const DRAFT_INDEX_TTL_SEC = 180 * 24 * 60 * 60;

/**
 * Encoding contract for key components.
 *
 * These keys are built by joining components with ':', so a component that
 * itself contains ':' could forge another user's key. Google's `sub` is
 * numeric today, but relying on an upstream format we do not control is how
 * that stops being true quietly. Every component is percent-encoded, which
 * removes ':' from the alphabet a component can contain and makes the
 * separator unambiguous by construction rather than by luck.
 *
 * This is separate from the URL encoding in kv() — that one is transport, this
 * one is the logical key.
 */
function keyPart(v) {
  return encodeURIComponent(String(v));
}

export function draftsKey(googleSub) {
  return `drafts:${keyPart(googleSub)}`;
}

export function skuDraftKey(googleSub, sku) {
  return `skudraft:${keyPart(googleSub)}:${keyPart(sku)}`;
}

export function storageAvailable() {
  return !!(KV_URL && KV_TOKEN);
}

/**
 * Upstash REST command. Same shape as api/events.js.
 *
 * Unlike events.js — which deliberately swallows errors, because a dropped
 * analytics event is not worth failing a user request over — index writes
 * THROW. A draft that exists but isn't indexed is invisible to its owner,
 * which is data loss wearing a success response.
 */
async function kv(cmd, ...args) {
  if (!storageAvailable()) throw new Error('kv_unconfigured');
  const path = [cmd, ...args].map((a) => encodeURIComponent(String(a))).join('/');
  const res  = await fetch(`${KV_URL}/${path}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` },
  });
  if (!res.ok) throw new Error(`kv_${cmd}_failed:${res.status}`);
  const j = await res.json().catch(() => ({}));
  return j.result;
}

/** Add a draft to both indexes. Call after the draft record itself is written. */
export async function indexDraft(googleSub, sku, draftId) {
  if (!googleSub || !sku || !draftId) throw new Error('index_missing_args');
  const dk = draftsKey(googleSub);
  const sk = skuDraftKey(googleSub, sku);
  await kv('sadd', dk, draftId);
  await kv('set', sk, draftId);
  // Refresh TTL on write so an actively-used account never expires.
  await kv('expire', dk, DRAFT_INDEX_TTL_SEC);
  await kv('expire', sk, DRAFT_INDEX_TTL_SEC);
  return { draftId, sku };
}

/**
 * Remove a draft from both indexes.
 *
 * The sku pointer is only cleared when it still points at THIS draft. A user
 * who discards draft A and creates draft B for the same card, then has A's
 * deletion arrive late, must not have B's pointer erased by it.
 */
export async function unindexDraft(googleSub, sku, draftId) {
  if (!googleSub || !draftId) throw new Error('unindex_missing_args');
  await kv('srem', draftsKey(googleSub), draftId);
  if (sku) {
    const current = await kv('get', skuDraftKey(googleSub, sku));
    if (current === draftId) await kv('del', skuDraftKey(googleSub, sku));
  }
  return { removed: draftId };
}

/** All draft ids for a user. Unordered — callers sort by the draft's own fields. */
export async function listDraftIds(googleSub) {
  if (!googleSub) return [];
  const ids = await kv('smembers', draftsKey(googleSub));
  return Array.isArray(ids) ? ids : [];
}

/** Existing draft id for this card, or null. */
export async function draftIdForSku(googleSub, sku) {
  if (!googleSub || !sku) return null;
  const id = await kv('get', skuDraftKey(googleSub, sku));
  return id || null;
}

/** How many drafts a user has — for Block C5's active cap, without fetching them. */
export async function countDrafts(googleSub) {
  if (!googleSub) return 0;
  const n = await kv('scard', draftsKey(googleSub));
  return Number(n) || 0;
}
