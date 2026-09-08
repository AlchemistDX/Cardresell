import { verifyTokenFlexible } from './_verifyToken.js';
import {
  createDraft, readDraft, updateDraft, deleteDraftOp, listDrafts,
  listDraftSummaries, LIST_PAGE_DEFAULT, LIST_PAGE_MAX, DRAFT_CAP,
  SERVICE_ERR,
} from './_draftService.js';
import { ERR as STORE_ERR, DRAFT_STATUS, PRICE_SOURCES, isSyntheticTestSub, isDraftId } from './_draftStore.js';
import { SLOT_RULES } from './_draftStore.js';
import { skuFor, identityReadiness } from './_cardIdentity.js';
import { buildListingTitle } from './_listingTitle.js';
import { buildListingPacket } from './_listingPacket.js';
import { sellReasons } from './_sellEligibility.js';
import { IDEMPOTENCY_STATE, validIdempotencyKey } from './_idempotency.js';

// /api/drafts — listing draft CRUD
//
//   GET    /api/drafts                 → list this user's draft ids
//   GET    /api/drafts?id=<draftId>    → read one draft
//   POST   /api/drafts                 → create   (Idempotency-Key REQUIRED)
//   PATCH  /api/drafts?id=<draftId>    → update   (expectedRev REQUIRED)
//   DELETE /api/drafts?id=<draftId>    → delete   (expectedRev REQUIRED)
//
// ── This endpoint NORMALIZES; it does not re-implement the rules ──────────
//
// The split is deliberate and was the subject of its own review round:
//
//   this file        parses and NORMALIZES request input
//   _idempotency.js  ASSERTS the input was normalized, and refuses if not
//   _draftStore.js   owns revisions, guards and tombstones
//   _draftIndex.js   owns rebuildable secondary indexes
//
// There is exactly one normalization implementation, and it is here. If this
// file coerced nothing and _idempotency.js coerced instead, there would be two,
// and they would drift.
//
// ── Why no draft is ever published from here ─────────────────────────────
//
// There is no publish path in this file and there will not be one until
// Phase 3. A draft is working state.

const MONEY_MAX = 999999.99;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const kvUrl   = process.env.KV_REST_API_URL;
  const kvToken = process.env.KV_REST_API_TOKEN;
  if (!kvUrl || !kvToken) return res.status(503).json({ error: 'Storage unavailable' });

  const idToken = (req.headers['authorization'] || '').replace('Bearer ', '').trim();
  if (!idToken || idToken.length < 20) return res.status(401).json({ error: 'Sign in required' });

  let googleSub = '';
  try {
    const info = await verifyTokenFlexible(idToken);
    googleSub = info.uid;
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  if (!googleSub) return res.status(401).json({ error: 'Sign in required' });

  // The reserved synthetic-test namespace is refused here, at the only door
  // real traffic comes through. This is what makes `ktest-*` genuinely ours:
  // no authenticated request can write into it, so anything found there was
  // put there by a test and is safe for a test to delete.
  if (isSyntheticTestSub(googleSub)) {
    return res.status(403).json({ error: 'Reserved account namespace' });
  }

  const kv = makeKv(kvUrl, kvToken);
  const draftId = (req.query && req.query.id) ? String(req.query.id) : '';

  try {
    if (req.method === 'GET')    return await handleGet(req, res, kv, googleSub, draftId);
    if (req.method === 'POST')   return await handleCreate(req, res, kv, googleSub);
    if (req.method === 'PATCH')  return await handleUpdate(req, res, kv, googleSub, draftId);
    if (req.method === 'DELETE') return await handleDelete(req, res, kv, googleSub, draftId);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    const msg = String((e && e.message) || e);
    // A normalization refusal is the CLIENT's error, and it names the field, so
    // the client can fix the one value rather than guessing at the whole body.
    if (msg.startsWith('DRAFT_FIELD_INVALID') || msg.startsWith('MUTATION_FIELD_')) {
      return res.status(400).json({ error: msg, code: msg.split(':')[0] });
    }
    if (msg === SERVICE_ERR.IDEMPOTENCY_KEY_REQUIRED) {
      return res.status(400).json({ error: msg, code: msg });
    }
    // 409, not 429. Nothing is rate-limited and waiting will not help — the
    // seller has to delete a draft or finish one. `retryable: false` says so,
    // and the reservation for this idempotency key was already released on the
    // way out, so the same key works again once they have made room.
    if (msg === SERVICE_ERR.DRAFT_CAP_REACHED) {
      const d = (e && e.detail) || {};
      return res.status(409).json({
        error: `You have reached the maximum of ${DRAFT_CAP} saved drafts. Finish or delete one to save another.`,
        code: SERVICE_ERR.DRAFT_CAP_REACHED,
        cap: DRAFT_CAP,
        count: d.count === undefined ? null : d.count,
        retryable: false,
      });
    }
    return res.status(500).json({ error: 'Draft operation failed', code: msg });
  }
}

// ── GET ───────────────────────────────────────────────────────────────────

function qs(req, name) {
  const v = req && req.query ? req.query[name] : undefined;
  if (v === undefined || v === null) return '';
  return Array.isArray(v) ? String(v[0]) : String(v);
}

async function handleGet(req, res, kv, googleSub, draftId) {
  if (!draftId) {
    // ── Two list shapes, one endpoint ──────────────────────────────────────
    //
    // `?ids=1` keeps the original bare-id answer, which reconciliation and the
    // index tests depend on. The default is now the hydrated list, because a
    // list of opaque ids is not something Block D's draft screen can render.
    const wantIds = String((qs(req, 'ids') || '')) === '1';

    if (wantIds) {
      const listed = await listDrafts(googleSub);
      // `listDraftIds` already distinguishes a failed read from an empty index.
      // A failure must not be rendered as "you have no drafts" — that is the one
      // response that makes a seller think their work is gone.
      if (listed.unavailable) {
        return res.status(503).json({ error: 'Could not load your drafts', retryable: true });
      }
      return res.status(200).json({
        draftIds: listed.draftIds || [],
        count: (listed.draftIds || []).length,
        source: listed.source || null,
        degraded: !!listed.degraded,
        reconciled: !!listed.reconciled,
      });
    }

    const limitRaw = qs(req, 'limit');
    const cursorRaw = qs(req, 'cursor');
    // Bad paging params are refused, not silently clamped. A client asking for
    // limit=abc has a bug, and quietly serving 25 rows hides it.
    if (limitRaw !== '' && !/^[0-9]+$/.test(limitRaw)) {
      return res.status(400).json({ error: 'limit must be a positive integer', code: 'LIST_LIMIT_INVALID' });
    }
    if (cursorRaw !== '' && !/^[0-9]+$/.test(cursorRaw)) {
      return res.status(400).json({ error: 'cursor must be a non-negative integer', code: 'LIST_CURSOR_INVALID' });
    }
    if (limitRaw !== '' && (Number(limitRaw) < 1 || Number(limitRaw) > LIST_PAGE_MAX)) {
      return res.status(400).json({ error: `limit must be between 1 and ${LIST_PAGE_MAX}`, code: 'LIST_LIMIT_RANGE' });
    }
    // `focus` asks the server which page a draft is on, so the client never
    // pages forward hunting for an id it just created.
    const focusRaw = qs(req, 'focus');
    if (focusRaw !== '' && !isDraftId(focusRaw)) {
      return res.status(400).json({ error: 'focus must be a draft id', code: 'LIST_FOCUS_INVALID' });
    }
    // Both supplied is a caller defect, not a preference to resolve. Picking a
    // winner would hide the bug in whichever one lost.
    if (focusRaw !== '' && cursorRaw !== '') {
      return res.status(400).json({ error: 'focus and cursor cannot be combined', code: 'LIST_FOCUS_CURSOR_CONFLICT' });
    }

    const page = await listDraftSummaries(kv, googleSub, {
      limit: limitRaw === '' ? LIST_PAGE_DEFAULT : Number(limitRaw),
      cursor: cursorRaw === '' ? 0 : Number(cursorRaw),
      focus: focusRaw === '' ? null : focusRaw,
    });
    if (page.unavailable) {
      return res.status(503).json({ error: 'Could not load your drafts', retryable: true });
    }
    return res.status(200).json({
      rows: page.rows,
      count: page.count,
      total: page.total,
      nextCursor: page.nextCursor,
      cap: DRAFT_CAP,
      source: page.source,
      degraded: page.degraded,
      focusOffset: page.focusOffset === undefined ? null : page.focusOffset,
    });
  }

  const got = await readDraft(kv, googleSub, draftId);
  if (got.ok) {
    return res.status(200).json({ draft: got.draft, validation: got.validation, readiness: got.readiness });
  }
  return res.status(statusForStoreError(got.error)).json(errorBody(got));
}

// ── POST (create) ─────────────────────────────────────────────────────────

async function handleCreate(req, res, kv, googleSub) {
  const key = idempotencyKeyOf(req);
  if (!key) {
    // NOT auto-generated. A server-minted key is indistinguishable from a new
    // operation on every retry, which silently removes the protection at the
    // exact moment it is needed — when a response was lost.
    return res.status(400).json({
      error: 'Idempotency-Key header is required to create a draft',
      code: SERVICE_ERR.IDEMPOTENCY_KEY_REQUIRED,
    });
  }
  if (!validIdempotencyKey(key)) {
    return res.status(400).json({ error: 'Idempotency-Key is not a valid key', code: 'IDEMPOTENCY_KEY_INVALID' });
  }

  const body = readBody(req);
  const input = normalizeCreateInput(body);

  const out = await createDraft(kv, googleSub, input, key);

  if (out.state === IDEMPOTENCY_STATE.MISMATCH) {
    // Same key, different mutation. 409 rather than 400: the request is
    // well-formed, it conflicts with a recorded operation.
    return res.status(409).json({
      error: 'This Idempotency-Key was already used for a different request',
      code: out.error, retryable: false,
    });
  }
  if (out.state === IDEMPOTENCY_STATE.UNAVAILABLE) {
    return res.status(503).json({ error: out.message, code: 'IDEMPOTENCY_UNAVAILABLE', retryable: true });
  }
  if (out.state === IDEMPOTENCY_STATE.IN_FLIGHT) {
    return res.status(409).json({ error: 'This request is already being processed', retryable: true });
  }

  const r = out.result || {};
  // A replay returns 200, a fresh create 201. Same body either way: a client
  // that retried must not have to care which one it got.
  const code = out.replayed ? 200 : 201;
  return res.status(code).json({
    draft: r.draft || null,
    draftId: r.draftId || (r.draft && r.draft.draftId) || null,
    saved: r.saved !== false,
    replayed: !!out.replayed,
    idempotencyState: out.state,
    // Rule 2, surfaced to the client: the draft IS saved. Only finding it in a
    // list may lag.
    degraded: !!r.degraded,
    repairRequired: !!r.repairRequired,
    index: r.index || null,
    validation: r.validation || null,
  });
}

// ── PATCH (update) ────────────────────────────────────────────────────────

async function handleUpdate(req, res, kv, googleSub, draftId) {
  if (!draftId) return res.status(400).json({ error: 'id is required' });
  const key = idempotencyKeyOf(req) || `rev-${draftId}`;
  const body = readBody(req);

  const expectedRev = body.expectedRev;
  if (expectedRev === undefined || expectedRev === null) {
    return res.status(428).json({
      error: 'expectedRev is required to edit a draft',
      code: STORE_ERR.REV_REQUIRED,
      hint: 'Read the draft, then send the rev you saw. This prevents one device silently overwriting another.',
    });
  }
  if (!Number.isInteger(expectedRev)) {
    return res.status(400).json({ error: 'expectedRev must be an integer', code: STORE_ERR.FIELD_INVALID });
  }

  const patch = normalizePatch(body);
  const out = await updateDraft(kv, googleSub, draftId, patch, expectedRev, key);
  if (out.ok) {
    return res.status(200).json({ draft: out.draft, replayed: !!out.replayed, validation: out.validation });
  }
  return res.status(statusForStoreError(out.error)).json(errorBody(out));
}

// ── DELETE ────────────────────────────────────────────────────────────────

async function handleDelete(req, res, kv, googleSub, draftId) {
  if (!draftId) return res.status(400).json({ error: 'id is required' });
  const key = idempotencyKeyOf(req) || `del-${draftId}`;

  const raw = (req.query && req.query.expectedRev !== undefined)
    ? req.query.expectedRev
    : readBody(req).expectedRev;

  let expectedRev;
  if (raw !== undefined && raw !== null && raw !== '') {
    const n = Number(raw);
    if (!Number.isInteger(n)) {
      return res.status(400).json({ error: 'expectedRev must be an integer', code: STORE_ERR.FIELD_INVALID });
    }
    expectedRev = n;
  }

  const out = await deleteDraftOp(kv, googleSub, draftId, expectedRev, key);
  if (out.ok) {
    return res.status(200).json({
      deleted: true,
      alreadyDeleted: !!out.alreadyDeleted,
      rev: out.draft ? out.draft.rev : null,
      degraded: !!out.degraded,
      repairRequired: !!out.repairRequired,
    });
  }
  return res.status(statusForStoreError(out.error)).json(errorBody(out));
}

// ── HTTP mapping ──────────────────────────────────────────────────────────

/**
 * One place decides the status code, so the same condition cannot answer 404
 * from one route and 409 from another.
 */
export function statusForStoreError(err) {
  switch (err) {
    case STORE_ERR.NOT_FOUND:      return 404;
    // 410 Gone, not 404. A tombstone is positive evidence the draft existed
    // and was intentionally deleted, and it is TERMINAL: 409 would invite the
    // client to re-read and retry at a higher revision, which is precisely the
    // resurrection the store refuses.
    case STORE_ERR.DELETED:        return 410;
    case STORE_ERR.REV_CONFLICT:   return 409;
    case STORE_ERR.REV_REQUIRED:   return 428;  // Precondition Required
    case STORE_ERR.REV_IN_FLIGHT:  return 409;
    case STORE_ERR.NOT_EDITABLE:   return 409;
    // 409, not 500. The server is fine; this build is too old to read the
    // record safely, and the honest answer is "update the app", not "error".
    case STORE_ERR.SCHEMA_TOO_NEW: return 409;
    case STORE_ERR.UNREADABLE:     return 500;
    // 409, not 400. The request was well formed; the state it names is one
    // this operation will not act on, and the client cannot fix it by
    // rewriting the request.
    case STORE_ERR.NOT_DISCARDABLE: return 409;
    case STORE_ERR.STORE_UNAVAILABLE: return 503;
    default:
      if (typeof err === 'string' && err.startsWith(STORE_ERR.FIELD_INVALID)) return 400;
      return 500;
  }
}

function errorBody(out) {
  const body = { error: out.error, code: String(out.error || '').split(':')[0] };
  if (out.retryable !== undefined) body.retryable = out.retryable;
  if (out.retryAfterMs) body.retryAfterMs = out.retryAfterMs;
  // On a conflict the current record is returned, so the UI can show the seller
  // the edit they did not have. "Someone changed this" is only actionable if
  // you can also say what it now says.
  if (out.current) {
    body.current = out.current;
    body.currentRev = out.current.rev;
  }
  if (out.error === STORE_ERR.SCHEMA_TOO_NEW) {
    body.message = 'This draft was saved by a newer version of CardResell. Refresh to load the latest version.';
  }
  if (out.error === STORE_ERR.DELETED) {
    body.message = 'This draft was deleted.';
  }
  if (out.error === STORE_ERR.REV_IN_FLIGHT) {
    body.message = 'Another change to this draft is still saving. Try again in a moment.';
  }
  return body;
}

// ── Normalization (the only implementation) ───────────────────────────────

function idempotencyKeyOf(req) {
  const h = req.headers || {};
  const v = h['idempotency-key'] || h['Idempotency-Key'] || h['x-idempotency-key'];
  return v ? String(v).trim() : '';
}

function readBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b) || {}; } catch { throw new Error('DRAFT_FIELD_INVALID:body:not-json'); }
  }
  if (typeof b !== 'object' || Array.isArray(b)) throw new Error('DRAFT_FIELD_INVALID:body:not-an-object');
  return b;
}

/** Tokens are a closed vocabulary, so lowercasing them is normalization. */
function normToken(v, field) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim().toLowerCase();
  if (!s) throw new Error(`DRAFT_FIELD_INVALID:${field}:empty`);
  if (/\s/.test(s)) throw new Error(`DRAFT_FIELD_INVALID:${field}:whitespace-in-token`);
  return s;
}

/**
 * Ids are OPAQUE. Casing is meaningful: real SKUs look like
 * `v2-XXX7473-592a391e7b472559`, so a blanket lowercase would corrupt every id
 * it touched and refuse every genuine retry.
 */
function normId(v, field) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (!s) throw new Error(`DRAFT_FIELD_INVALID:${field}:empty`);
  return s;
}

function normMoney(v, field) {
  if (v === undefined || v === null) return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).trim().replace(/^\$/, ''));
  if (!Number.isFinite(n)) throw new Error(`DRAFT_FIELD_INVALID:${field}:not-a-number`);
  if (n < 0) throw new Error(`DRAFT_FIELD_INVALID:${field}:negative`);
  if (n > MONEY_MAX) throw new Error(`DRAFT_FIELD_INVALID:${field}:too-large`);
  // Round to cents HERE, once. Storing 19.999 makes every later fee
  // calculation disagree with the listing by a fraction of a cent.
  return Math.round(n * 100) / 100;
}

function normText(v, field, max) {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  if (s.length > max) throw new Error(`DRAFT_FIELD_INVALID:${field}:too-long`);
  return s;
}

/**
 * ── The client says WHICH card, never what it is called or worth ──────────
 *
 * Create used to accept `sku` and `title` directly. That is the wrong shape
 * for a boundary, for a reason that only shows up later: a client that can
 * post its own `sku` can create a draft whose stored identity disagrees with
 * the card the seller actually scanned, and a client that can post its own
 * `title` can put anything above a price that we then stamp with provenance.
 * Neither is a hypothetical attack — both are what a refactor on the browser
 * side does by accident.
 *
 * So identity is DERIVED here, from the card row, using the same `skuFor()`
 * and `buildListingTitle()` the packet builder uses. A request carrying an
 * explicit `sku` or `title` is refused rather than having the field quietly
 * dropped: a caller who thought they were setting the title needs to be told
 * they were not.
 *
 * `price` is a different matter and stays a client input, because the one
 * implementation of price basis genuinely lives in core.js today. That is a
 * trust boundary this endpoint does not close — it is recorded in
 * audit/BLOCK_D1_REVIEW.md as a Phase 2 item rather than papered over. What
 * this endpoint does enforce is that the price says where it came from, which
 * is why `priceSource` has no default.
 */
export function normalizeCreateInput(body) {
  const slot = normToken(body.slot, 'slot');

  // Refuse, don't drop. See above.
  //
  // `packet` joins sku and title, and it is the most important of the three.
  // A listing packet CONTAINS sku, title, category, aspects and condition. So
  // accepting a client-supplied packet would not merely widen the trust
  // boundary these two refusals draw — it would reopen the very refusal by
  // another route, letting a client post the title this endpoint just rejected
  // by nesting it one level deeper. The packet is built HERE, from the same
  // `card` the sku and title are derived from, and never accepted.
  for (const derived of ['sku', 'title', 'packet']) {
    if (body[derived] !== undefined && body[derived] !== null) {
      throw new Error(`DRAFT_FIELD_INVALID:${derived}:derived-from-card`);
    }
  }

  const card = body.card;
  if (!card || typeof card !== 'object' || Array.isArray(card)) {
    throw new Error('DRAFT_FIELD_INVALID:card:required');
  }

  // The same gate the Sell button was drawn from — literally the same
  // function, called on the same row. If these disagree, the button is the
  // thing that is wrong, and this is the side that must hold: a draft with no
  // usable identity is unlistable at every later step.
  //
  // One readiness result, translated once. Calling identityReadiness here and
  // sellReasons on its output means the create cannot refuse a row for a
  // reason the gate would not have given, and cannot accept one the gate
  // refused. Recomputing sufficiency is precisely what let a nameless card
  // through, so it is not recomputed.
  const readiness = identityReadiness(card);
  if (!readiness.sufficient) {
    throw new Error(`DRAFT_FIELD_INVALID:card:${sellReasons(readiness).join(',')}`);
  }

  // Title is built to the VENUE's limit, not to a generic maximum. Building
  // an 80-char title for eBay and a 40-char one for Mercari is the same
  // function with a different bound; building one 500-char title and letting
  // slot validation reject it is a dead end the seller cannot act on.
  const titleMax = (SLOT_RULES[slot] && SLOT_RULES[slot].titleMax) || undefined;

  // buildListingTitle returns a RESULT, not a string — `{title, ok, dropped,
  // reason}`. Storing the object itself is a mistake this endpoint made for
  // exactly one commit, and it is worth a word: `title: buildListingTitle(...)`
  // reads correct, type-checks nowhere, and produced a draft whose title was
  // `[object Object]` by the time anything rendered it.
  const built = buildListingTitle(card, titleMax ? { maxLength: titleMax } : {});
  if (!built.ok) {
    // A title the builder could not fit is not a draft worth creating. Dropped
    // SEGMENTS are normal and fine — the builder trimming rarity to fit 80
    // chars is it doing its job, and `dropped` is reported on the draft rather
    // than refused. `ok: false` is the different case: nothing usable came out.
    throw new Error(`DRAFT_FIELD_INVALID:title:${built.reason || 'unbuildable'}`);
  }

  const out = {
    sku:        skuFor(card),
    instanceId: normId(body.instanceId, 'instanceId'),
    slot,
    title:      built.title,
    price:      normMoney(body.price, 'price'),
  };
  if (built.dropped && built.dropped.length) out.titleDropped = built.dropped;
  // `strategy` is derivable from the slot (`ebay:auction` → `auction`), so it
  // is accepted for clarity but must AGREE. Silently preferring one over the
  // other would make two requests that look different behave identically.
  const strategy = normToken(body.strategy, 'strategy');
  if (strategy) {
    const fromSlot = slot ? slot.split(':')[1] : undefined;
    if (fromSlot && strategy !== fromSlot) {
      throw new Error('DRAFT_FIELD_INVALID:strategy:disagrees-with-slot');
    }
    out.strategy = strategy;
  }
  // Where the price came from. Accepted but NEVER defaulted: a default here
  // would mark every price as seller-entered and permanently silence the
  // warning that exists to catch prices of unknown origin.
  const priceSource = normToken(body.priceSource, 'priceSource');
  // A source with no number claims provenance for nothing. A draft may legally
  // exist without a price (the seller sets it on the review screen, and the
  // slot rules raise a blocking PRICE_REQUIRED until they do) — but it may not
  // arrive carrying "this came from a comp" with no comp attached, because D4
  // puts that claim on screen next to the number it describes.
  //
  // ABSENCE, not falsiness. This read `!(out.price > 0)`, which refused the
  // provenance of a $0 price — the exact conflation the D1 verdict ruled out:
  // "$0 should remain an invalid eBay price and be refused by the slot rules",
  // not folded into "no price". A seller who types 0 HAS stated a number and
  // its origin is knowable; the slot registry is what refuses it, as
  // ZERO_PRICE. Deciding it twice, in two vocabularies, is how the seller ends
  // up told to add a price they just entered.
  if (priceSource && (out.price === undefined || out.price === null)) {
    throw new Error('DRAFT_FIELD_INVALID:priceSource:no-price');
  }
  if (priceSource) {
    if (!PRICE_SOURCES.includes(priceSource)) {
      throw new Error('DRAFT_FIELD_INVALID:priceSource:unrecognised');
    }
    out.priceSource = priceSource;
  }
  // ── The listing packet — produced here, from the server's own row ───────
  //
  // Placement, because it is the whole argument. This function is already the
  // one place that derives from `card`: skuFor, identityReadiness, sellReasons
  // and buildListingTitle all run above, and their results are what get stored.
  // The packet is the same kind of thing — a server derivation of the scanned
  // card — so it is produced beside them, by the only producer that exists.
  //
  // What the CLIENT declares, and why that is not a widening of the boundary:
  // feeModelRevision, feeScheduleVerified, pricing and basisMeta are facts
  // about what the client COMPUTED, not claims about which card the seller
  // scanned. They sit in the same category as `price` and `priceSource`, which
  // this endpoint already accepts as declared inputs. The boundary stays
  // exactly where it was; four fields join the side that was already declaring.
  //
  // The context is assembled FIELD BY FIELD and the request object is never
  // spread into it. That is not tidiness. `ctx.maxTitleLength` would let a
  // client widen the venue's title bound, and `ctx.now` would let it choose the
  // clock that stamps priceBasis.retrievedAt — dating a stale comp to whenever
  // it liked. Both are set here, from the server, and cannot be reached from
  // the body.
  //
  // The two client-supplied OBJECTS are safe to pass whole because the packet
  // builder already whitelists them field by field on the way in:
  // stampPriceBasis picks eight named keys and pricing picks five, so an
  // unexpected key on either arrives nowhere. Re-listing those keys here would
  // be a second whitelist to drift against the first.
  const pc = (body.pricingContext && typeof body.pricingContext === 'object'
              && !Array.isArray(body.pricingContext)) ? body.pricingContext : {};
  for (const forbidden of ['now', 'maxTitleLength', 'taxonomyTreeVersion']) {
    if (pc[forbidden] !== undefined) {
      throw new Error(`DRAFT_FIELD_INVALID:pricingContext.${forbidden}:server-owned`);
    }
  }
  // NOT defaulted, and the packet's own ERROR is the reporting channel. An
  // absent revision produces MISSING_FEE_MODEL_REVISION and blocked:true — a
  // packet that says out loud it cannot name the fee logic that priced it.
  // Substituting a server-side FEE_MODEL_REVISION here would make every such
  // packet claim a revision that never priced it, unfalsifiably, because the
  // packet would stop recording that it did not know.
  //
  // The create still SUCCEEDS. A blocked packet is a bad snapshot, not a bad
  // draft, and the existing policy already says the draft is authoritative and
  // the packet advisory. Refusing the create would take the seller's work away
  // over a field the seller never saw.
  const packetCtx = {
    feeModelRevision:    Number.isInteger(pc.feeModelRevision) ? pc.feeModelRevision : undefined,
    feeScheduleVerified: typeof pc.feeScheduleVerified === 'string' ? pc.feeScheduleVerified : undefined,
    pricing:             (pc.pricing   && typeof pc.pricing   === 'object' && !Array.isArray(pc.pricing))   ? pc.pricing   : undefined,
    basisMeta:           (pc.basisMeta && typeof pc.basisMeta === 'object' && !Array.isArray(pc.basisMeta)) ? pc.basisMeta : undefined,
    // Server-owned. The title bound is the VENUE's, the same one used for
    // out.title above, so the packet cannot report a title this endpoint
    // would not have stored.
    maxTitleLength:      titleMax,
    now:                 Date.now(),
  };
  out.packet = buildListingPacket(card, packetCtx);

  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

export function normalizePatch(body) {
  const patch = {};
  if ('title' in body) patch.title = normText(body.title, 'title', 500);
  if ('price' in body) patch.price = normMoney(body.price, 'price');
  if ('status' in body) patch.status = normToken(body.status, 'status');
  if ('notes' in body) patch.notes = normText(body.notes, 'notes', 2000);
  return patch;
}

// ── Upstash REST, same shape as the rest of api/ ──────────────────────────

function makeKv(url, token) {
  return async function kv(...args) {
    const path = args.map((a) => encodeURIComponent(String(a))).join('/');
    const r = await fetch(`${url}/${path}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) throw new Error(`kv_${r.status}`);
    const j = await r.json();
    return j.result;
  };
}

export { DRAFT_STATUS };
