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

// ── Retention: a recorded generation must still be FETCHABLE ────────────────
//
// WHY THIS IS A SEPARATE CHECK. Everything above answers "does each name match
// its bytes?" for the assets index.html references today. That says nothing
// about whether an OLDER asset a returning browser may still ask for is on
// disk. The D4 rename used `git mv`, which passed every check above while
// deleting js/core.86000bf2.js from the working tree — and a reviewer, not a
// suite, caught it. Git recoverability answers the citation question ("what
// did line 21938 say then?"); it does not answer the browser question ("does
// GET /js/core.86000bf2.js return 200?"). Only a file on disk answers that.
//
// THE RULE. Every core generation named in the citation map must be present
// with bytes that hash to its own name, or be listed below as unrecoverable
// with the reason. Adding a hash to that list is a deliberate, reviewable act;
// deleting a file is not.
const MAP = 'audit/BUNDLE_CITATION_MAP.md';

// Hashes no commit holds matching bytes for. These cannot be restored without
// inventing content, so they are excluded by name and by reason, never by a
// wildcard. Verified with `git log --all --diff-filter=A` plus a hash of the
// blob at every commit that carried the path.
const UNRECOVERABLE = new Map([
  ['fec7fb3a', 'never committed under this name'],
  ['611f4efe', 'never committed under this name'],
  ['b7447fe5', 'never committed under this name (BIAS-6 intermediate)'],
  ['69b38a85', 'committed empty at 2ffb351 and with non-matching bytes at ' +
               'fa4739b: no commit holds bytes that hash to 69b38a85'],
  // Not a generation at all: this is what the bytes committed under the name
  // core.69b38a85.js actually hash to. The map states it so the mislabel is
  // legible, and the parser above cannot tell a quoted byte hash from a
  // filename, so it is excluded here by name rather than by loosening the
  // parser -- a looser parser would also stop noticing real deletions.
  ['75f9494e', 'a byte hash quoted in the map, never a filename'],
]);

const mapPath = new URL('../' + MAP, import.meta.url);
const mapText = existsSync(mapPath) ? readFileSync(mapPath, 'utf8') : '';
check(`${MAP} is readable`, mapText.length > 0,
      'the retention rule is derived from this file; an unreadable map must ' +
      'fail loudly rather than silently check nothing');

const named = [...new Set(
  [...mapText.matchAll(/core\.([0-9a-f]{8})\.js/g)].map((m) => m[1])
    .concat([...mapText.matchAll(/`([0-9a-f]{8})`/g)].map((m) => m[1])),
)].sort();

check('the citation map names at least one core generation', named.length > 0,
      'zero matches means the parser stopped matching, not that history is empty');

for (const h of named) {
  if (UNRECOVERABLE.has(h)) {
    check(`${h} is a declared-unrecoverable generation`, true, UNRECOVERABLE.get(h));
    continue;
  }
  const rel = `js/core.${h}.js`;
  const abs = new URL('../' + rel, import.meta.url);
  const there = existsSync(abs);
  check(`${rel} is retained on disk`, there,
        `the citation map records this generation but the file is gone. A ` +
        `browser holding cached HTML that references it gets a 404; the ` +
        `fingerprint checks above pass regardless, because they only look at ` +
        `what index.html references TODAY. Restore it with its committed ` +
        `bytes (git show <commit>:${rel} > ${rel}) rather than removing the ` +
        `entry from the map.`);
  if (!there) continue;
  check(`${rel} still holds the bytes its name claims`,
        sha8(readFileSync(abs)) === h,
        `restored bytes hash to ${sha8(readFileSync(abs))}, not ${h} — a ` +
        `retained file under a name it does not match is worse than an ` +
        `absent one`);
}

done();
