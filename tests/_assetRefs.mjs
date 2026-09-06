// tests/_assetRefs.mjs
//
// One place that answers "which hashed bundle does the app actually load?"
//
// The bug this exists to prevent shipped once already: js/core.js content
// changed by ~36KB across five commits while its content-hash filename stayed
// at the Phase 0 digest. Because vercel.json serves /js/<name>.<8hex>.js with
// `Cache-Control: immutable`, changing bytes under a name that never changes is
// not a cosmetic slip — a cache may keep serving old bytes for the life of the
// freshness lifetime, against new server APIs.
//
// Two rules encoded here, both learned the hard way:
//
//   1. RESOLVE FROM THE DOCUMENT, NEVER FROM THE DIRECTORY. Old assets are
//      deliberately retained during a rename transition, so js/ contains more
//      than one core.<hash>.js on purpose. Globbing the directory and taking
//      the first hit would silently pick the retired file. index.html is the
//      only thing that decides what the browser loads, so index.html is the
//      only authority we read.
//
//   2. AN EMPTY REFERENCE SET IS A FAILURE, NOT A PASS. If this parser stops
//      matching — the markup changes, an attribute is reordered, a build step
//      appears — the honest result is a loud error. Returning [] would let a
//      broken parser certify every future bundle as correct.
//
// Consumers: tests/asset-fingerprints.mjs (the guard) and the D1 suites that
// evaluate the shipped client source.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// The entry document is the authority on what the browser loads.
export const ENTRY = 'index.html';

// Matches src="/js/core.569ff536.js" and href="..." forms, with or without the
// leading slash, at any depth. The 8-hex group is the content fingerprint.
const HASHED_REF =
  /(?:src|href)\s*=\s*"\/?((?:[A-Za-z0-9_.-]+\/)*([A-Za-z0-9_-]+)\.([0-9a-f]{8})\.(js|css))"/g;

/** First 8 hex of SHA-256 — the fingerprint convention these filenames use. */
export function sha8(bytes) {
  return createHash('sha256').update(bytes).digest('hex').slice(0, 8);
}

/**
 * Every distinct hashed asset the entry document references.
 * Throws — never returns [] — if nothing matches.
 */
export function referencedHashedAssets({ root = ROOT, entry = ENTRY } = {}) {
  const htmlPath = join(root, entry);
  if (!existsSync(htmlPath)) {
    throw new Error(`asset-refs: entry document is missing: ${entry}`);
  }
  const html = readFileSync(htmlPath, 'utf8');

  const out = [];
  const seen = new Set();
  for (const m of html.matchAll(HASHED_REF)) {
    const [, rel, base, nameHash, ext] = m;
    if (seen.has(rel)) continue;
    seen.add(rel);
    out.push({ ref: `/${rel}`, rel, base, nameHash, ext, path: join(root, rel) });
  }

  if (out.length === 0) {
    throw new Error(
      `asset-refs: found no hashed asset references in ${entry}. Refusing to ` +
      `report success on an empty set — either the markup changed or this ` +
      `parser is broken, and both must fail loudly rather than certify nothing.`
    );
  }
  return out;
}

/**
 * The one core bundle the app loads. Explicit about absence and ambiguity:
 * zero references and two references are both errors, because "pick one" is
 * how the retired asset gets loaded by mistake.
 */
export function resolveCoreBundle(opts = {}) {
  const hits = referencedHashedAssets(opts)
    .filter((a) => a.ext === 'js' && a.base === 'core');

  if (hits.length === 0) {
    throw new Error(
      `asset-refs: no core.<hash>.js reference found in ${opts.entry ?? ENTRY}. ` +
      `The suites that evaluate the shipped client cannot proceed without it.`
    );
  }
  if (hits.length > 1) {
    throw new Error(
      `asset-refs: ambiguous core bundle — ${opts.entry ?? ENTRY} references ` +
      `${hits.length}: ${hits.map((h) => h.rel).join(', ')}. Exactly one must ` +
      `be live; retired copies stay on disk but must not be referenced.`
    );
  }

  const asset = hits[0];
  if (!existsSync(asset.path)) {
    throw new Error(
      `asset-refs: ${opts.entry ?? ENTRY} references ${asset.ref} but no such ` +
      `file exists. A referenced-but-missing bundle is a broken deploy.`
    );
  }
  return asset;
}

/** resolveCoreBundle plus the source text, for the suites that slice it. */
export function readCoreBundle(opts = {}) {
  const asset = resolveCoreBundle(opts);
  return { ...asset, source: readFileSync(asset.path, 'utf8') };
}
