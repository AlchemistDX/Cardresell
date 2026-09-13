/**
 * Cloudflare R2, spoken directly over fetch.
 *
 * WHY THIS FILE EXISTS AS RAW SIGV4
 *
 * There is no tracked package.json in this repository, so `@aws-sdk/*` and
 * `@vercel/blob` are both unavailable. R2 speaks the S3 API at
 * https://<ACCOUNT_ID>.r2.cloudflarestorage.com with region `auto`, and both
 * PutObject and DeleteObject are implemented, so AWS Signature Version 4 over
 * `fetch` plus WebCrypto is the whole dependency list.
 *
 * WHY THE BROWSER UPLOADS DIRECTLY
 *
 * The first implementation relayed base64 image bodies through the API
 * function. A 2.5 MB iPhone photograph becomes ~3.4 MB of base64, which can
 * exceed the platform request-body boundary BEFORE any application validation
 * runs -- the seller would see an opaque platform error instead of the app's
 * own refusal, and the byte gate would never execute. So the function signs a
 * short-lived PUT and the bytes go browser -> R2. No image body ever enters a
 * CardResell function.
 *
 * WHAT IS SIGNED, AND WHAT IS NOT TRUSTED
 *
 * The presigned URL pins the method, the object key, and the expiry. It does
 * NOT let the client choose its own key: the key is computed server-side from
 * an HMAC of the owner, the draft, the photo id and the content hash. The
 * completion endpoint then does a real HEAD against R2 before recording
 * anything, so a client claim of "uploaded" is never taken as fact.
 */

import { createHmac, createHash } from 'node:crypto';
import {
  EBAY_PHOTO_EXTENSIONS,
  PHOTO_HOST_ERR,
  checkExportablePhotoUrl,
} from './_photoHost.js';

/** How long a presigned PUT stays valid.
 *
 *  Five minutes, set by the work order. A leaked URL is near-worthless that
 *  quickly, and it is still ample for a single photograph: the byte gate caps
 *  one upload at 20 MB, which needs roughly 40 s on a 4 Mbit/s mobile uplink.
 *  A seller on a genuinely slower link gets PUT_HTTP_403 from R2 rather than a
 *  silent failure, and the retry re-tickets. */
export const R2_PRESIGN_TTL_SECONDS = 5 * 60;

/** R2's S3 API region is the literal string `auto`. */
const R2_REGION = 'auto';
const SERVICE = 's3';

const hmac = (key, data) => createHmac('sha256', key).update(data, 'utf8').digest();
const sha256hex = (data) => createHash('sha256').update(data, 'utf8').digest('hex');

/**
 * The owner namespace in an object key.
 *
 * The raw Google subject and the seller's email must never appear in a public
 * URL: those keys are handed to eBay's importer and are, in practice, public.
 * An HMAC under a server-held secret is stable (so the same seller always maps
 * to the same prefix, which is what makes deletion-by-prefix and
 * unchanged-photo reuse possible) while being useless to anyone who sees the
 * URL and does not hold PHOTO_KEY_SECRET.
 *
 * Truncated to 32 hex characters: 128 bits of a keyed digest, which is not a
 * collision risk at any plausible seller count, and keeps the key short.
 */
export function ownerNamespace(secret, ownerSub) {
  const s = String(secret || '');
  const o = String(ownerSub || '');
  if (!s) throw new Error('ownerNamespace: PHOTO_KEY_SECRET is not configured');
  if (!o) throw new Error('ownerNamespace: missing owner');
  return createHmac('sha256', s).update(o, 'utf8').digest('hex').slice(0, 32);
}

/**
 * The object key for one photo, including its content hash.
 *
 * The hash in the name is what makes case 8 work: an unchanged photograph
 * re-exported produces the SAME key, so the object already present in R2 is
 * reused rather than uploaded again. Replacing a photo changes its bytes,
 * which changes the hash, which changes the key -- so case 9 falls out of the
 * same property rather than needing separate bookkeeping.
 */
export function r2ObjectKey({ ownerNs, draftId, photoId, sha256, ext }) {
  const safe = (v) => String(v || '').replace(/[^A-Za-z0-9_-]/g, '');
  const ns = safe(ownerNs);
  const draft = safe(draftId);
  const photo = safe(photoId);
  const hash = String(sha256 || '').toLowerCase();
  if (!ns || !draft || !photo) throw new Error('r2ObjectKey: missing component');
  if (!/^[0-9a-f]{64}$/.test(hash)) throw new Error('r2ObjectKey: sha256 must be 64 hex characters');
  const e = EBAY_PHOTO_EXTENSIONS.includes(String(ext)) ? String(ext) : '.jpg';
  return `seller-photos/${ns}/${draft}/${photo}-${hash.slice(0, 16)}${e}`;
}

/** RFC 3986 encoding for a path segment; S3 signing is unforgiving here. */
function uriEncode(str, encodeSlash) {
  let out = '';
  for (const ch of String(str)) {
    if (/[A-Za-z0-9_.~-]/.test(ch)) { out += ch; continue; }
    if (ch === '/') { out += encodeSlash ? '%2F' : '/'; continue; }
    for (const b of Buffer.from(ch, 'utf8')) {
      out += '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
  }
  return out;
}

function amzDates(now) {
  const iso = new Date(now).toISOString().replace(/[:-]|\.\d{3}/g, '');
  return { amzDate: iso, dateStamp: iso.slice(0, 8) };
}

function signingKey(secretKey, dateStamp) {
  return hmac(hmac(hmac(hmac('AWS4' + secretKey, dateStamp), R2_REGION), SERVICE), 'aws4_request');
}

/**
 * A presigned URL for one S3 operation, as query-string authentication.
 *
 * `PUT` is what the browser uses. `HEAD` and `DELETE` are signed the same way
 * and used server-side, so there is exactly one signing implementation rather
 * than one per verb.
 */
export function presignR2({
  method, accountId, accessKeyId, secretAccessKey, bucket, key,
  contentType = '', expiresIn = R2_PRESIGN_TTL_SECONDS, now = Date.now(),
}) {
  for (const [n, v] of Object.entries({ method, accountId, accessKeyId, secretAccessKey, bucket, key })) {
    if (!v) throw new Error(`presignR2: missing ${n}`);
  }
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${uriEncode(bucket, true)}/${uriEncode(key, false)}`;
  const { amzDate, dateStamp } = amzDates(now);
  const scope = `${dateStamp}/${R2_REGION}/${SERVICE}/aws4_request`;

  /* WHY CONTENT-TYPE IS SIGNED WHEN PRESENT.
     With `host` alone in SignedHeaders, the presigned PUT would accept any
     Content-Type the browser felt like sending, and R2 would store it. The
     object's stored type is what the completion HEAD compares against the
     ticket, and what eBay's importer reads -- so a URL that let the client
     choose it would make that comparison meaningless. Signing it pins it: a
     PUT with a different Content-Type is refused by R2 itself, before any of
     our code runs.

     HEAD and DELETE are signed with `host` only: they carry no body and
     therefore no content type. */
  const ct = String(contentType || '').toLowerCase();
  const signedHeaders = ct ? 'content-type;host' : 'host';

  const q = new Map([
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${accessKeyId}/${scope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(Math.max(1, Math.floor(expiresIn)))],
    ['X-Amz-SignedHeaders', signedHeaders],
  ]);
  const canonicalQuery = [...q.entries()]
    .map(([k, v]) => [uriEncode(k, true), uriEncode(v, true)])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`).join('&');

  const canonicalHeaders = ct
    ? `content-type:${ct}\nhost:${host}\n`
    : `host:${host}\n`;

  const canonicalRequest = [
    String(method).toUpperCase(), canonicalUri, canonicalQuery,
    canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonicalRequest),
  ].join('\n');

  const signature = createHmac('sha256', signingKey(secretAccessKey, dateStamp))
    .update(stringToSign, 'utf8').digest('hex');

  return {
    url: `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`,
    expiresAt: new Date(now + Math.floor(expiresIn) * 1000).toISOString(),
    /* Exactly the headers the signature covers. The browser must send these
       and nothing else that is signed, so they are returned rather than
       reconstructed at the call site from a convention. */
    requiredHeaders: ct ? { 'Content-Type': ct } : {},
    signedHeaders,
  };
}

/**
 * The R2 host.
 *
 * `put` is deliberately ABSENT. This provider never accepts image bytes
 * server-side; that is the architectural point. It offers a ticket
 * (presigned PUT), a verification HEAD, and deletion.
 */
export function makeR2Host(cfg) {
  const {
    accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl,
    keySecret, fetchImpl,
  } = cfg;
  const doFetch = fetchImpl || ((...a) => globalThis.fetch(...a));
  const base = String(publicBaseUrl || '').replace(/\/+$/, '');

  const sign = (method, key, ttl, now, contentType) => presignR2({
    method, accountId, accessKeyId, secretAccessKey, bucket, key, contentType,
    expiresIn: ttl || R2_PRESIGN_TTL_SECONDS, now: now || Date.now(),
  });

  return {
    name: 'r2',
    bucket,

    ownerNamespace: (ownerSub) => ownerNamespace(keySecret, ownerSub),

    objectKey: (parts) => r2ObjectKey(parts),

    /** The public URL eBay's importer will fetch. Validated against the
     *  export contract here, so an unusable base URL fails at configuration
     *  time rather than as a blank photo in a listing. */
    publicUrl(key) {
      const url = `${base}/${String(key).split('/').map((s) => encodeURIComponent(s)).join('/')}`;
      const chk = checkExportablePhotoUrl(url);
      if (!chk.ok) {
        const e = new Error('r2: public base url yields a non-exportable url: ' + chk.detail);
        e.code = PHOTO_HOST_ERR.BAD_URL;
        throw e;
      }
      return url;
    },

    /** A short-lived PUT the browser uses directly. The content type is part
     *  of the signature, so the returned `requiredHeaders` are mandatory. */
    presignPut(key, opts = {}) {
      return sign('PUT', key, opts.expiresIn, opts.now, opts.contentType);
    },

    /**
     * Does the object really exist, and is it what was claimed?
     *
     * Returns the observed size and content type rather than a boolean, so
     * the completion endpoint can compare them against the ticket instead of
     * trusting the client's numbers.
     */
    async head(key, opts = {}) {
      const { url } = sign('HEAD', key, 60, opts.now);
      let r;
      try {
        r = await doFetch(url, { method: 'HEAD' });
      } catch (e) {
        const err = new Error('r2: HEAD failed: ' + e.message);
        err.code = PHOTO_HOST_ERR.UPLOAD_FAILED;
        throw err;
      }
      if (r.status === 404) return { exists: false };
      if (!r.ok) {
        const err = new Error('r2: HEAD returned ' + r.status);
        err.code = PHOTO_HOST_ERR.UPLOAD_FAILED;
        throw err;
      }
      const len = Number(r.headers.get('content-length'));
      return {
        exists: true,
        byteLength: Number.isFinite(len) ? len : null,
        contentType: (r.headers.get('content-type') || '').toLowerCase() || null,
        /* R2's ETag for a single PUT is the MD5 of the stored bytes. It is
           recorded as an OPAQUE storage identity -- proof that the object we
           later serve is the object we verified -- and never used as our
           content hash. The content hash stays sha256, computed in the
           browser, per the standing rule against md5 for our own naming. */
        etag: (r.headers.get('etag') || '').replace(/^"|"$/g, '') || null,
      };
    },

    /** Delete one object. A 404 counts as deleted: the goal state is absence. */
    async remove(key, opts = {}) {
      const { url } = sign('DELETE', key, 60, opts.now);
      let r;
      try {
        r = await doFetch(url, { method: 'DELETE' });
      } catch (e) {
        return { ok: false, detail: 'network: ' + e.message };
      }
      if (r.status === 404 || (r.status >= 200 && r.status < 300)) return { ok: true, status: r.status };
      return { ok: false, status: r.status, detail: 'r2 refused the delete' };
    },
  };
}

/**
 * Build the R2 host from the environment, or return a reason it cannot be.
 *
 * A REASON, not null. `photoHostFromEnv` returning a bare null could not tell
 * "no provider chosen" from "r2 chosen but PHOTO_KEY_SECRET missing", and
 * those need different answers: the first is the documented pre-hosting state,
 * the second is a misconfiguration that should be visible rather than silently
 * degrading to blank photo columns.
 */
export function r2HostFromEnv(env = process.env, fetchImpl) {
  const need = {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicBaseUrl: env.PHOTO_HOST_PUBLIC_BASE_URL,
    keySecret: env.PHOTO_KEY_SECRET,
  };
  const missing = Object.entries(need).filter(([, v]) => !String(v || '').trim()).map(([k]) => k);
  if (missing.length) return { ok: false, missing };

  /* FAIL CLOSED ON MALFORMED, NOT ONLY ON ABSENT.
     A present-but-wrong setting is worse than a missing one: it produces
     signed URLs nothing will accept, or public URLs eBay cannot fetch, and the
     seller sees photographs that silently never arrive. Each check below is a
     shape the value cannot possibly be right in. No value is ever echoed --
     only the NAME of the setting -- because these are credentials.

     `invalid` is reported through the same `missing` channel the callers
     already render, so a misconfiguration surfaces as MISCONFIGURED rather
     than as a 500 with no explanation. */
  const invalid = [];
  const acct = String(need.accountId).trim();
  if (!/^[0-9a-f]{32}$/i.test(acct)) invalid.push('R2_ACCOUNT_ID');
  const bkt = String(need.bucket).trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bkt)) invalid.push('R2_BUCKET');
  const pub = String(need.publicBaseUrl).trim();
  if (!/^https:\/\/[^\s/]+/.test(pub)) invalid.push('PHOTO_HOST_PUBLIC_BASE_URL');
  /* The secret both derives the owner namespace and signs upload receipts, so
     a placeholder must not pass. The floor is deliberately 16 rather than 32:
     the point is to catch 'changeme' and 'test', not to reject a working
     deployment's already-provisioned secret and block testing on a value this
     code is forbidden to print. 32+ random characters is the recommendation,
     recorded in audit/PHOTO_HOSTING_R2_PACKET.md, not an enforced minimum. */
  if (String(need.keySecret).length < 16) invalid.push('PHOTO_KEY_SECRET');
  if (String(need.accessKeyId).trim().length < 16) invalid.push('R2_ACCESS_KEY_ID');
  if (String(need.secretAccessKey).trim().length < 32) invalid.push('R2_SECRET_ACCESS_KEY');
  if (invalid.length) return { ok: false, missing: invalid, invalid };

  return { ok: true, host: makeR2Host({ ...need, fetchImpl }) };
}
