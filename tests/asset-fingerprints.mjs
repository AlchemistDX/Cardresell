/**
 * Every referenced hashed bundle must be named after its own bytes.
 *
 * WHY THIS SUITE EXISTS. js/core.js gained 743 lines across five Block D
 * commits while its filename kept the Phase 0 digest 569ff536. Nothing caught
 * it. It surfaced only because a reviewer disbelieved a claim that the client
 * bundle was unchanged — and the claim had looked true precisely because the
 * *filename* was unchanged. An unchanged filename is not an unchanged file.
 *
 * WHY IT MATTERS MORE THAN TIDINESS. vercel.json serves
 * /js/<name>.<8hex>.js with `Cache-Control: public, max-age=31536000,
 * immutable`. That header is a promise that the bytes at a URL will not change,
 * which is only safe when the URL changes with the bytes. Break the coupling
 * and a returning browser can execute an old client against new server APIs —
 * intermittent, cache-dependent, and invisible to a clean first-load smoke test.
 *
 * SCOPE. This suite VERIFIES; it never repairs. A check that silently renames
 * files would turn a red build green while the real defect (a generation step
 * nobody ran) survives. Stale names must fail here and be fixed deliberately.
 */
import { existsSync, readFileSync } from 'node:fs';
import { harness } from './_assert.mjs';
import { referencedHashedAssets, resolveCoreBundle, sha8, ENTRY } from './_assetRefs.mjs';

const { check, done } = harness('asset-fingerprints');

// ── The reference set itself must be trustworthy ────────────────────────────
// An empty set is the one result that must never read as success: it means the
// parser or the document changed, and a silent [] would certify all future
// bundles as correct forever.
let assets = [];
let enumerationError = null;
try {
  assets = referencedHashedAssets();
} catch (e) {
  enumerationError = e;
}

check(`${ENTRY} yields a usable hashed-asset reference set`,
      enumerationError === null,
      enumerationError ? `threw: ${enumerationError.message}` : '');

check('the reference set is not empty',
      assets.length > 0,
      'an empty set means a broken parser, not a clean app — it must fail here');

if (assets.length > 0) {
  check(`all ${assets.length} references are unique`,
        new Set(assets.map((a) => a.rel)).size === assets.length,
        'a duplicated reference means the same bundle is loaded twice');
}

// ── Existence, then fingerprint, for every referenced asset ────────────────
for (const a of assets) {
  const exists = existsSync(a.path);
  check(`${a.rel} exists`, exists,
        `${ENTRY} references ${a.ref} but the file is not there — a ` +
        `referenced-but-missing bundle is a broken deploy, not a warning`);
  if (!exists) continue;

  const bytes = readFileSync(a.path);
  const actual = sha8(bytes);
  check(`${a.rel} is named after its own bytes (sha256[:8] = ${actual})`,
        actual === a.nameHash,
        `filename says ${a.nameHash} but the content hashes to ${actual}. ` +
        `This path is served immutable, so shipping changed bytes under an ` +
        `unchanged name can leave caches serving the old client against new ` +
        `APIs. Rename to ${a.base}.${actual}.${a.ext} and update every live ` +
        `reference. Do not edit this expectation to match the stale name.`);
}

// ── The core bundle specifically: exactly one, and it is live ──────────────
// Retired bundles stay on disk during a rename transition, so "exactly one
// referenced core" is the property that keeps the retired copy from being
// picked up by a directory scan.
let core = null;
try {
  core = resolveCoreBundle();
} catch (e) {
  check('exactly one core bundle is referenced and present', false, e.message);
}
if (core) {
  check(`the live core bundle resolves unambiguously (${core.rel})`, true);
  check('the live core bundle carries the D1 client work',
        (() => {
          const src = readFileSync(core.path, 'utf8');
          return ['applySellGate', '_crCreateDraft', '_crScanInstanceId',
                  '_crWireRow', '_crIntentToken'].every((id) => src.includes(id));
        })(),
        'the referenced bundle is missing D1 identifiers — index.html may be ' +
        'pointing at a retired copy');
}

done();
