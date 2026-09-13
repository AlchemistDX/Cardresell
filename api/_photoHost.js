/**
 * Seller-photo hosting: the provider seam, the eBay URL contract, and a fake.
 *
 * WHY THIS FILE EXISTS. eBay's bulk-draft CSV carries photos as URLs and
 * nothing else. eBay says it twice: the column takes a link to a web-hosted
 * image, and the binary route is explicitly not available in this file format.
 *
 *   "Photos need to be provided in the file template via URL links to the
 *    web-hosted images."
 *   "The photo URL needs to start with the hypertext https:// and end with a
 *    file extension like .jpg or .png."
 *     -- https://pages.ebay.com/sh/reports/help/create-listings-bulk/
 *
 *   "To add images to EPS, the UploadSiteHostedPictures API must be used (not
 *    directly supported in File Exchange)."
 *     -- https://pics.ebay.com/aw/pics/pdf/us/file_exchange/File_Exchange_User_Guide.pdf
 *
 * Our seller photos are IndexedDB blobs on the seller's device. For eBay's
 * importer to fetch one, it has to exist at an https URL that eBay's fetcher
 * can reach. That is the whole reason a host is needed: not storage for its
 * own sake, but reachability by a third party we do not control.
 *
 * WHAT IS DELIBERATELY NOT HERE. No live provider. Standing instruction is
 * that new paid infrastructure requires a concrete review first, so this file
 * ships the SEAM and a FAKE, and `photoHostFromEnv` returns null until a real
 * adapter is registered by name. An unconfigured host is a first-class,
 * reported outcome -- never a blank column under a claim that photos went.
 *
 * NO SDK. There is no tracked package.json in this repo, so an adapter may
 * use `fetch` and nothing else. Every provider under consideration exposes a
 * plain HTTPS upload, so this costs nothing but is worth stating: an adapter
 * that needs an npm dependency cannot be added here without that decision
 * being taken first.
 */

/** eBay's documented ceiling for this column: "Up to 12 images per listing is
 *  supported by Seller Hub Reports." Not a guess and not ours to raise. */
export const EBAY_PHOTO_MAX = 12;

/** "Character limit: Max length 2048" -- per URL, not per field. */
export const EBAY_PHOTO_URL_MAX = 2048;

/** eBay separates multiple URLs in the one field with a pipe: "use the pipe
 *  ( | ) character to separate the values". */
export const EBAY_PHOTO_SEPARATOR = '|';

/** "you must include at least one photo that is 500 pixels on the longest
 *  side" -- https://www.ebay.com/help/policies/listing-policies/picture-policy?id=4370 */
export const EBAY_PHOTO_MIN_LONGEST_SIDE = 500;

/** The extensions eBay names. Kept as the documented pair, not widened to
 *  every format a browser can decode -- eBay is the consumer here. */
export const EBAY_PHOTO_EXTENSIONS = Object.freeze(['.jpg', '.jpeg', '.png']);

/** Content types we will accept for upload, mapped to the extension the
 *  emitted URL must end in. A type outside this map is refused rather than
 *  uploaded and named `.jpg` regardless -- a mislabelled image is the kind of
 *  silent substitution that produces a listing eBay rejects. */
export const UPLOAD_CONTENT_TYPES = Object.freeze({
  'image/jpeg': '.jpg',
  'image/png': '.png',
});

export const PHOTO_HOST_ERR = Object.freeze({
  NOT_CONFIGURED: 'PHOTO_HOST_NOT_CONFIGURED',
  UNSUPPORTED_TYPE: 'PHOTO_UNSUPPORTED_TYPE',
  TOO_LARGE: 'PHOTO_TOO_LARGE',
  EMPTY: 'PHOTO_EMPTY',
  BAD_URL: 'PHOTO_HOST_RETURNED_BAD_URL',
  UPLOAD_FAILED: 'PHOTO_UPLOAD_FAILED',
});

/** 20 MB. A card photograph from a phone is 2-6 MB; this is a ceiling against
 *  accidental uploads, not a quality target. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/**
 * Is this a URL eBay's importer could actually fetch, per eBay's own rules?
 *
 * Returns `{ ok }` or `{ ok: false, reason, detail }`. Called on what a
 * provider HANDS BACK, not only on what we construct: a provider that returns
 * an http:// link, a pre-signed URL past 2048 characters, or a path with no
 * extension has produced something eBay will silently drop, and the moment to
 * catch that is before it reaches a CSV the seller uploads.
 */
export function checkExportablePhotoUrl(value) {
  const url = String(value == null ? '' : value);
  if (!url) return { ok: false, reason: PHOTO_HOST_ERR.BAD_URL, detail: 'empty' };
  // "The photo URL needs to start with the hypertext https://". http:// is not
  // a near miss to be upgraded silently; it is refused.
  if (!/^https:\/\//i.test(url)) {
    return { ok: false, reason: PHOTO_HOST_ERR.BAD_URL, detail: 'not https' };
  }
  if (url.length > EBAY_PHOTO_URL_MAX) {
    return { ok: false, reason: PHOTO_HOST_ERR.BAD_URL, detail: 'over 2048 characters' };
  }
  // The separator cannot appear inside a member of a pipe-separated list. A
  // URL containing one would split into two unfetchable fragments.
  if (url.includes(EBAY_PHOTO_SEPARATOR)) {
    return { ok: false, reason: PHOTO_HOST_ERR.BAD_URL, detail: 'contains a pipe' };
  }
  // "If an image URL has blank spaces, you must replace the blank spaces with
  // %20; otherwise, the image will not appear in the listing." We refuse the
  // raw space rather than encoding it here: the host that minted the URL is
  // the only thing that knows whether the space is significant.
  if (/\s/.test(url)) {
    return { ok: false, reason: PHOTO_HOST_ERR.BAD_URL, detail: 'contains whitespace' };
  }
  // "...and end with a file extension like .jpg or .png". The extension is
  // checked on the PATH: a query string is allowed (pre-signed URLs carry
  // one) but it may not be what the path ends in.
  let pathname;
  try { pathname = new URL(url).pathname; }
  catch { return { ok: false, reason: PHOTO_HOST_ERR.BAD_URL, detail: 'unparseable' }; }
  const lower = pathname.toLowerCase();
  if (!EBAY_PHOTO_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
    return { ok: false, reason: PHOTO_HOST_ERR.BAD_URL, detail: 'no .jpg/.png extension' };
  }
  return { ok: true };
}

/**
 * Join ordered URLs into the one `Item photo URL` field.
 *
 * Order is the seller's order and is preserved: eBay treats the first URL as
 * the gallery image, so reordering here would change which photograph fronts
 * the listing. Over the documented maximum the extras are DROPPED and
 * REPORTED, never silently truncated -- `dropped` exists so the caller can
 * say so on screen.
 */
export function joinPhotoUrls(urls) {
  const all = (Array.isArray(urls) ? urls : []).map((u) => String(u || '')).filter(Boolean);
  const kept = all.slice(0, EBAY_PHOTO_MAX);
  return {
    field: kept.join(EBAY_PHOTO_SEPARATOR),
    kept,
    dropped: all.length - kept.length,
  };
}

/**
 * Validate bytes offered for upload. Type first, because the extension of the
 * emitted URL is derived from it.
 */
export function checkUploadable({ contentType, byteLength } = {}) {
  const ext = UPLOAD_CONTENT_TYPES[String(contentType || '').toLowerCase()];
  if (!ext) return { ok: false, reason: PHOTO_HOST_ERR.UNSUPPORTED_TYPE };
  const n = Number(byteLength);
  if (!Number.isFinite(n) || n <= 0) return { ok: false, reason: PHOTO_HOST_ERR.EMPTY };
  if (n > UPLOAD_MAX_BYTES) return { ok: false, reason: PHOTO_HOST_ERR.TOO_LARGE };
  return { ok: true, ext };
}

/**
 * The object key for a seller's photo.
 *
 * Scoped by owner AND draft, so one seller's key can never address another's
 * object, and a per-draft prefix is what makes deletion-on-draft-delete a
 * prefix operation rather than a scan. `photoId` is already opaque; nothing
 * here is derived from a card name, so the key leaks no collection contents.
 */
export function photoObjectKey({ ownerSub, draftId, photoId, ext }) {
  const safe = (s) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '');
  const owner = safe(ownerSub);
  const draft = safe(draftId);
  const photo = safe(photoId);
  if (!owner || !draft || !photo) throw new Error('photoObjectKey: missing component');
  const e = EBAY_PHOTO_EXTENSIONS.includes(String(ext)) ? String(ext) : '.jpg';
  return `seller-photos/${owner}/${draft}/${photo}${e}`;
}

/**
 * A fake host, for tests.
 *
 * It is a fake and not a mock: it really records what it was handed, so an
 * assertion can check the bytes, the content type and the key rather than
 * only that a function was called. `baseUrl` must be https and the emitted
 * URL is put through `checkExportablePhotoUrl`, so the fake cannot hand back
 * something the real contract would reject -- a fake that is laxer than
 * production is how a passing suite stops meaning anything.
 */
export function makeFakePhotoHost({ baseUrl = 'https://photos.test.invalid', failOn = null } = {}) {
  const puts = [];
  return {
    name: 'fake',
    puts,
    async put({ key, bytes, contentType }) {
      puts.push({ key, contentType, byteLength: bytes ? bytes.length : 0 });
      if (failOn && failOn(key, puts.length)) {
        const e = new Error('fake host refused');
        e.code = PHOTO_HOST_ERR.UPLOAD_FAILED;
        throw e;
      }
      const url = `${String(baseUrl).replace(/\/+$/, '')}/${key}`;
      const chk = checkExportablePhotoUrl(url);
      if (!chk.ok) {
        const e = new Error('fake host built a non-exportable url: ' + chk.detail);
        e.code = PHOTO_HOST_ERR.BAD_URL;
        throw e;
      }
      return { url };
    },
    async deletePrefix(prefix) {
      const before = puts.length;
      for (let i = puts.length - 1; i >= 0; i--) {
        if (String(puts[i].key).startsWith(prefix)) puts.splice(i, 1);
      }
      return { deleted: before - puts.length };
    },
  };
}

/**
 * Resolve the configured host, or null.
 *
 * NULL IS A SUPPORTED ANSWER and the current one. No provider is registered,
 * because choosing one commits to paid storage and that decision is the
 * seller's to take on a costed proposal. Every caller must therefore handle
 * null by SAYING photos were not hosted -- which is the whole point of
 * returning null rather than a stub that yields unreachable URLs.
 *
 * When a provider is chosen, it is registered here by name and selected with
 * PHOTO_HOST_PROVIDER; nothing else in the codebase changes.
 */
export function photoHostFromEnv(env = process.env) {
  const provider = String((env && env.PHOTO_HOST_PROVIDER) || '').trim().toLowerCase();
  if (!provider) return null;
  if (provider === 'fake') {
    // Reachable only where the base URL is also supplied, so a stray value in
    // a real environment cannot silently route seller photographs to a fake.
    const baseUrl = String((env && env.PHOTO_HOST_BASE_URL) || '').trim();
    if (!baseUrl) return null;
    return makeFakePhotoHost({ baseUrl });
  }
  // Unknown name: null, not a throw. An environment typo must degrade to
  // "photos were not hosted, and we said so" rather than 500 the export.
  return null;
}
