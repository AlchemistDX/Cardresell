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
 * analytics event is not worth failing a user request over — a failed index
 * write is reported, never silently ignored. It is NOT reported as a failed
 * save, though: see the split-brain contract above. The draft record is
 * authoritative and the index is a rebuildable cache, so a torn index write
 * degrades findability rather than losing work.
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

/**
 * ── Split-brain contract (Block C1 entry criterion) ───────────────────────
 *
 * Two writes make a saved draft: the draft RECORD, and the two indexes that
 * make it findable. They cannot be atomic — Upstash REST gives us no
 * transaction across them — so the question is not "can this tear?" but "what
 * is true when it does?"
 *
 * The failure we refuse to ship is: draft record written, index write threw,
 * user shown an error, record now unreachable forever.
 *
 * Of the three ways out — roll the draft back, mark it unindexed and repair,
 * or make the index rebuildable — we take the third. Rollback is the worst
 * option here because the compensating delete can fail for exactly the same
 * reason the index write did, and then we have lost real user work instead of
 * a cache entry. An "unindexed" flag is little better: finding the records
 * that carry it needs the very scan it is trying to avoid.
 *
 * So: THE DRAFT RECORD IS AUTHORITATIVE AND THE INDEXES ARE A CACHE.
 *
 *   1. The record key is deterministic and prefix-scannable:
 *      `draft:<sub>:<draftId>`. Both indexes are therefore derivable from
 *      primary storage alone, with no extra bookkeeping.
 *   2. Write order is record first, indexes second. A torn write can lose a
 *      cache entry; it can never lose the draft.
 *   3. A failed index write reports INDEX_DEGRADED — the draft SAVED, it is
 *      merely slow to find — instead of a generic error implying data loss.
 *   4. Reads self-heal. listDraftIds() falls back to a prefix scan when the
 *      index is missing or empty, and rewrites the index from what it finds.
 *
 * The recovery path is therefore deterministic and needs no operator: the
 * next list read repairs the damage. `rebuildDraftIndex()` exists to do it
 * on demand.
 *
 * The one case a scan cannot distinguish is a genuinely empty index from a
 * lost one. That is why the scan fallback is cheap to be wrong about: it runs
 * only when the index returns nothing, and finding nothing is the same answer
 * either way.
 */

/** Deterministic, prefix-scannable record key. Primary storage. */
export function draftRecordKey(googleSub, draftId) {
  return `draft:${keyPart(googleSub)}:${keyPart(draftId)}`;
}

/** Prefix matching every draft record for one user. */
export function draftRecordPattern(googleSub) {
  return `draft:${keyPart(googleSub)}:*`;
}

/** Recover the draft id from a record key, or null if it does not match. */
export function draftIdFromRecordKey(googleSub, key) {
  const prefix = `draft:${keyPart(googleSub)}:`;
  if (typeof key !== 'string' || !key.startsWith(prefix)) return null;
  const raw = key.slice(prefix.length);
  if (!raw || raw.includes(':')) return null;
  try { return decodeURIComponent(raw); } catch { return null; }
}

/**
 * Enumerate draft ids straight from primary storage, bypassing the index.
 *
 * This is the recovery path, not the hot path — SCAN is O(keyspace) and only
 * runs when the index has let us down.
 */
export async function scanDraftIds(googleSub) {
  if (!googleSub) return [];
  const pattern = draftRecordPattern(googleSub);
  const ids = [];
  let cursor = '0';
  let guard = 0;
  do {
    const page = await kv('scan', cursor, 'match', pattern, 'count', 200);
    // Upstash returns [nextCursor, keys[]].
    const next = Array.isArray(page) ? page[0] : '0';
    const keys = Array.isArray(page) && Array.isArray(page[1]) ? page[1] : [];
    for (const k of keys) {
      const id = draftIdFromRecordKey(googleSub, k);
      if (id) ids.push(id);
    }
    cursor = String(next ?? '0');
    guard += 1;
  } while (cursor !== '0' && guard < 100);
  return [...new Set(ids)];
}

/**
 * Rebuild the user's draft-list index from primary storage.
 *
 * Deliberately additive: it re-adds every id found by scanning, and does not
 * delete index entries that the scan did not see. A draft record that is
 * mid-write would otherwise be evicted from the index by its own rebuild.
 */
export async function rebuildDraftIndex(googleSub) {
  const ids = await scanDraftIds(googleSub);
  if (!ids.length) return { rebuilt: 0, ids: [] };
  const dk = draftsKey(googleSub);
  await kv('sadd', dk, ...ids);
  await kv('expire', dk, DRAFT_INDEX_TTL_SEC);
  return { rebuilt: ids.length, ids };
}

/**
 * Add a draft to both indexes. Call AFTER the draft record itself is written.
 *
 * Never throws on a storage failure. By the time this runs the draft is
 * already durable, so throwing would surface as "save failed" for a draft that
 * saved fine — the exact misleading outcome the contract above rules out.
 * Instead it reports which index writes failed, and the caller returns
 * INDEX_DEGRADED: the draft is safe, it is just temporarily harder to find,
 * and the next list read repairs it.
 *
 * Bad arguments still throw. That is a programming error, not a storage
 * outage, and it happens before anything is written.
 */
export async function indexDraft(googleSub, sku, draftId) {
  if (!googleSub || !sku || !draftId) throw new Error('index_missing_args');
  const dk = draftsKey(googleSub);
  const sk = skuDraftKey(googleSub, sku);
  const failed = [];

  const attempt = async (label, fn) => {
    try { await fn(); } catch (e) { failed.push({ step: label, error: String(e && e.message || e) }); }
  };

  // The list index is self-healing via scan. The sku pointer is not — it maps
  // card to draft, and rebuilding it requires reading record CONTENTS, which
  // this module deliberately does not do. A lost pointer therefore degrades
  // duplicate detection: the seller may be offered a new draft for a card they
  // already have one for. Recoverable and visible, unlike a lost draft.
  await attempt('drafts_sadd',  () => kv('sadd', dk, draftId));
  await attempt('skudraft_set', () => kv('set', sk, draftId));
  await attempt('drafts_ttl',   () => kv('expire', dk, DRAFT_INDEX_TTL_SEC));
  await attempt('skudraft_ttl', () => kv('expire', sk, DRAFT_INDEX_TTL_SEC));

  return {
    draftId,
    sku,
    ok: failed.length === 0,
    degraded: failed.length > 0,
    // Duplicate detection specifically, so the caller can soften that UI
    // rather than claiming the whole save is suspect.
    skuPointerLost: failed.some((f) => f.step === 'skudraft_set'),
    failed,
    recovery: failed.length ? 'rebuildDraftIndex' : null,
  };
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

/**
 * All draft ids for a user. Unordered — callers sort by the draft's own fields.
 *
 * Self-healing: an empty or unreadable index falls back to a prefix scan of
 * primary storage and rewrites the index from what it finds. This is the
 * deterministic recovery path for a torn index write — it needs no operator
 * and no background job, because the next list read performs it.
 *
 * Falling back on an genuinely-empty index is harmless: the scan returns
 * nothing too, and we have spent one cheap SCAN to prove it.
 */
export async function listDraftIds(googleSub) {
  if (!googleSub) return [];

  let ids = null;
  try {
    const raw = await kv('smembers', draftsKey(googleSub));
    ids = Array.isArray(raw) ? raw : [];
  } catch {
    ids = null; // index unreadable — fall through to the scan
  }

  if (ids && ids.length) return ids;

  const scanned = await scanDraftIds(googleSub);
  if (scanned.length) {
    // Repair on the way past. A failure here is not fatal: we already have
    // the correct answer to return, and the next read will try again.
    try {
      await kv('sadd', draftsKey(googleSub), ...scanned);
      await kv('expire', draftsKey(googleSub), DRAFT_INDEX_TTL_SEC);
    } catch { /* returning the right answer matters more than caching it */ }
  }
  return scanned;
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
