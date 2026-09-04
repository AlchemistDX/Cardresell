/**
 * Scan hygiene majors — 2026-09-04
 *
 * Covers the fifth majors group from the Sol E2E audit:
 *   S-1 QC exceptions fail open (a photo we could not validate gets submitted)
 *   S-2 HEIC / PDF / oversized files have no explicit validation
 *   B-1 sports rows show a generic "Price unavailable" though no lookup ran
 *   B-2 bulk-save drops every identity field the single-add path persists
 *   R-1 resilience copy blames the photo for network/auth/rate-limit failures
 *
 * Discipline: extract the real functions and EXECUTE them. A presence check
 * survives neutering the enclosing `if` and survives being commented out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond) { if (cond) pass++; else fails.push(name); }
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}
function grabFn(name) {
  const sig = `function ${name}(`;
  const start = HTML.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found in index.html`);
  let i = HTML.indexOf(')', start);
  i = HTML.indexOf('{', i);
  let depth = 0;
  for (let j = i; j < HTML.length; j++) {
    const c = HTML[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return HTML.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces for ${name}`);
}
const HTML_NC = stripComments(HTML);

/* ═══════════════════════════════════════════════════════════
   S-2. File validation (HEIC / PDF / size / empty type)
   ═══════════════════════════════════════════════════════════ */
const V = new Function(`
  const SCAN_MAX_BYTES  = 15 * 1024 * 1024;
  const SCAN_MIME_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']);
  ${grabFn('_validateScanFile')}
  ${grabFn('_partitionScanFiles')}
  return { _validateScanFile, _partitionScanFiles };
`)();

const f = (type, size, name) => ({ type, size: size == null ? 1000 : size, name: name || 'p' });
const MB = 1024 * 1024;

// Accepted formats produce no error at all.
for (const t of ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']) {
  eq(`${t} is accepted`, V._validateScanFile(f(t)), '');
}
eq('uppercase MIME is accepted (case-insensitive)', V._validateScanFile(f('IMAGE/JPEG')), '');

// HEIC — the format the audit called out. iPhone default, undecodable here.
ok('HEIC is rejected', V._validateScanFile(f('image/heic')) !== '');
ok('HEIC message names the format', /HEIC/.test(V._validateScanFile(f('image/heic'))));
ok('HEIC message gives an actionable fix', /Most Compatible|JPEG/i.test(V._validateScanFile(f('image/heic'))));
ok('HEIF is rejected too', /HEIC/.test(V._validateScanFile(f('image/heif'))));
ok('HEIC by filename with no MIME type is rejected',
   /HEIC/.test(V._validateScanFile(f('', 1000, 'IMG_1234.HEIC'))));
ok('.heif by filename is rejected', /HEIC/.test(V._validateScanFile(f('', 1000, 'x.heif'))));

// PDF — arrives via drag-drop / programmatic flows even though the picker hides it.
ok('PDF is rejected', V._validateScanFile(f('application/pdf')) !== '');
ok('PDF message says it is a PDF', /PDF/.test(V._validateScanFile(f('application/pdf'))));
ok('PDF by filename is rejected', /PDF/.test(V._validateScanFile(f('', 1000, 'scan.pdf'))));

// Size cap — a 20MB photo is decoded full-size before downsampling.
eq('a 14MB photo is accepted', V._validateScanFile(f('image/jpeg', 14 * MB)), '');
ok('a 20MB photo is rejected', V._validateScanFile(f('image/jpeg', 20 * MB)) !== '');
ok('the size message states the actual size',
   /20\.0 MB/.test(V._validateScanFile(f('image/jpeg', 20 * MB))));
ok('the size message states the limit',
   /15 MB/.test(V._validateScanFile(f('image/jpeg', 20 * MB))));
// Exactly at the cap must pass; one byte over must not.
eq('exactly 15MB is accepted', V._validateScanFile(f('image/jpeg', 15 * MB)), '');
ok('15MB + 1 byte is rejected', V._validateScanFile(f('image/jpeg', 15 * MB + 1)) !== '');
// The size check must run before the format check, so an oversized HEIC
// reports the size (the thing the user controls first).
ok('oversized files are reported by size regardless of format',
   /MB/.test(V._validateScanFile(f('image/heic', 20 * MB))));

// Android pickers can hand us an empty file.type.
eq('empty MIME with a .jpg name is accepted', V._validateScanFile(f('', 1000, 'photo.jpg')), '');
eq('empty MIME with a .jpeg name is accepted', V._validateScanFile(f('', 1000, 'photo.jpeg')), '');
eq('empty MIME with a .PNG name is accepted', V._validateScanFile(f('', 1000, 'photo.PNG')), '');
eq('empty MIME with a .webp name is accepted', V._validateScanFile(f('', 1000, 'p.webp')), '');
ok('empty MIME with an unknown extension is rejected',
   V._validateScanFile(f('', 1000, 'photo.tiff')) !== '');

// Other unsupported image types still get a clear message.
ok('image/gif is rejected', /JPEG, PNG, or WebP/.test(V._validateScanFile(f('image/gif'))));
ok('image/bmp is rejected', V._validateScanFile(f('image/bmp')) !== '');
ok('image/tiff is rejected', V._validateScanFile(f('image/tiff')) !== '');

// No file at all.
ok('a missing file is reported', V._validateScanFile(null) !== '');
ok('undefined is reported', V._validateScanFile(undefined) !== '');

// Every message must be user-facing prose, not a code.
for (const bad of [f('image/heic'), f('application/pdf'), f('image/jpeg', 20 * MB), f('image/gif'), null]) {
  const m = V._validateScanFile(bad);
  ok('rejection message ends in a sentence: ' + m.slice(0, 28), /[.!]$/.test(m));
}

/* ── partition: keep the good files, name the rejects ── */
{
  const { okFiles, rejected } = V._partitionScanFiles([
    f('image/jpeg', 1000, 'a.jpg'),
    f('image/heic', 1000, 'b.heic'),
    f('image/png', 1000, 'c.png'),
    f('application/pdf', 1000, 'd.pdf'),
  ]);
  eq('partition keeps every decodable file', okFiles.map(x => x.name), ['a.jpg', 'c.png']);
  eq('partition reports every rejected file', rejected.map(x => x.name), ['b.heic', 'd.pdf']);
  ok('each reject carries its own reason', rejected.every(r => r.error && r.error.length > 10));
  ok('the reject reason is specific to that file', /HEIC/.test(rejected[0].error) && /PDF/.test(rejected[1].error));
}
eq('partition of an empty list is empty', V._partitionScanFiles([]).okFiles, []);
eq('partition tolerates null', V._partitionScanFiles(null).okFiles, []);
{
  const { okFiles, rejected } = V._partitionScanFiles([f('image/heic'), f('image/heic')]);
  eq('an all-bad batch keeps nothing', okFiles, []);
  ok('an all-bad batch reports every file', rejected.length === 2);
}

/* ── the gate must actually be wired into every photo entry point ── */
for (const fname of ['processScanImage', 'processGradeImage', 'processGradeBack', 'processGradeEdge']) {
  const body = stripComments(grabFn(fname));
  // Assert the RESULT is bound and branched on — a bare call, or a call
  // parked behind `if (0)`, is not a gate.
  ok(`${fname} binds the validation result`,
     /const\s+fileError\s*=\s*_validateScanFile\(\s*file\s*\)\s*;/.test(body));
  ok(`${fname} bails on an invalid file`, /if\s*\(\s*fileError\s*\)\s*\{/.test(body));
  ok(`${fname} surfaces the reason to the user`, /showToast\(\s*fileError/.test(body));
  ok(`${fname} clears the input so re-picking the same file works`, /input\.value\s*=\s*''/.test(body));
}
for (const fname of ['processBulkUploadFiles', 'processBulkGradeFiles']) {
  const body = stripComments(grabFn(fname));
  ok(`${fname} partitions the batch`, /_partitionScanFiles\(/.test(body));
  ok(`${fname} tells the user what it skipped`, /rejected\[0\]\.error/.test(body));
  ok(`${fname} still proceeds with the decodable files`, /if\s*\(\s*!files\.length\s*\)\s*return/.test(body));
}
// The gate must run before the credit-confirm screen quotes a price.
{
  const b = stripComments(grabFn('processBulkUploadFiles'));
  const gate = b.search(/_partitionScanFiles\(/);
  const quote = b.search(/bulkCreditConfirmCredit/);
  ok('bulk upload validates before quoting credits', gate !== -1 && quote !== -1 && gate < quote);
}
// And the queue must be built from the filtered list, not the raw one.
{
  const b = stripComments(grabFn('processBulkUploadFiles'));
  ok('bulk queue is built from the validated files',
     /_bulkQueue\s*=\s*files\.map/.test(b) && !/_bulkQueue\s*=\s*allFiles/.test(b));
}

/* ── accept attributes should name the decodable formats ── */
ok('photo inputs name the supported formats',
   (HTML.match(/accept="image\/jpeg,image\/png,image\/webp,image\/\*"/g) || []).length >= 10);
ok('no photo input is left with a bare image/* accept',
   !/<input[^>]*type="file"[^>]*accept="image\/\*"/.test(HTML));

/* ═══════════════════════════════════════════════════════════
   S-1. QC exceptions must fail CLOSED
   ═══════════════════════════════════════════════════════════ */
{
  const body = stripComments(grabFn('processScanImage'));
  const idx = body.search(/catch\s*\(\s*qcErr\s*\)/);
  ok('the QC catch block still exists', idx !== -1);
  const seg = body.slice(idx, idx + 1400);
  ok('the QC catch aborts the scan instead of falling through', /return\s*;/.test(seg));
  ok('the QC catch tells the user the photo was unreadable', /could not read this photo/i.test(seg));
  ok('the QC catch reassures the user no credit was spent', /No credit was used/i.test(seg));
  ok('the QC catch sets the error button state', /_setScanBtns\(\s*'error'\s*\)/.test(seg));
  ok('the QC catch releases the object URL', /revokeObjectURL/.test(seg));
  ok('the QC failure is tracked', /photo_qc_error/.test(seg));
  // The old wording claimed the failure was harmless. It was not.
  ok('the "non-fatally" claim is gone from the source', !/QC failed non-fatally/.test(HTML));
  ok('the fall-through comment is gone', !/don't block the user — fall through to the scan/.test(HTML));
  // The abort must come BEFORE the network call that spends a credit.
  const catchAt = body.search(/catch\s*\(\s*qcErr\s*\)/);
  const scanAt  = body.search(/\/api\/scan/);
  ok('the QC abort precedes the /api/scan request', catchAt !== -1 && scanAt !== -1 && catchAt < scanAt);
}

/* ═══════════════════════════════════════════════════════════
   R-1. Resilience copy must match the actual failure
   ═══════════════════════════════════════════════════════════ */
const H = new Function(`${grabFn('_bulkErrorHint')} return _bulkErrorHint;`)();

const PHOTO = 'Try a clearer photo with the full card visible.';
// The four cases the audit tabulated as failures.
ok('a network failure does not blame the photo', H('Network offline') !== PHOTO);
ok('a network failure suggests checking the connection', /connection/i.test(H('Network offline')));
ok('expired auth does not blame the photo', H('Auth expired') !== PHOTO);
ok('expired auth tells the user to sign in', /sign in/i.test(H('Auth expired')));
ok('a rate limit does not blame the photo', H('Too many requests') !== PHOTO);
ok('a rate limit says to wait', /rate limit|moment/i.test(H('Too many requests')));
ok('a malformed body does not blame the photo', H('Unexpected token < in JSON at position 0') !== PHOTO);
ok('a malformed body says the response was bad', /bad response/i.test(H('Unexpected token < in JSON at position 0')));

// Additional real error strings the code can produce.
ok('a 401 string is treated as auth', /sign in/i.test(H('HTTP 401')));
ok('a 429 string is treated as a rate limit', /rate limit|moment/i.test(H('429 Too Many Requests')));
ok('a credit exhaustion string is named', /credit/i.test(H('Ran out of credits')));
ok('a timeout is named as a timeout', /timed out/i.test(H('The operation timed out')));
ok('an AbortError is treated as a timeout', /timed out/i.test(H('AbortError')));
ok('a 500 is attributed to our scanner', /scanner/i.test(H('Scan failed: 500')));
ok('a 502 is attributed to our scanner', /scanner/i.test(H('502 Bad Gateway')));
ok('a failed fetch is treated as network', /connection/i.test(H('Failed to fetch')));

// The photo hint must STILL be the answer for genuinely photo-shaped failures.
eq('an unidentified card still gets the photo hint', H('Could not identify card'), PHOTO);
eq('an empty error falls back to the photo hint', H(''), PHOTO);
eq('a null error falls back to the photo hint', H(null), PHOTO);
eq('an undefined error falls back to the photo hint', H(undefined), PHOTO);

// Every hint must be actionable prose, and none may be a bare restatement.
for (const e of ['Network offline', 'Auth expired', 'Too many requests', 'Scan failed: 500',
                 'The operation timed out', 'Ran out of credits', 'Could not identify card']) {
  const h = H(e);
  ok(`hint for "${e}" is a sentence`, /[.!]$/.test(h) && h.length > 12);
  ok(`hint for "${e}" is not just the error echoed back`, h.toLowerCase() !== e.toLowerCase());
}

// Wiring: the row renderer must use the mapper, not the hardcoded line.
{
  const body = grabFn('_bulkUpdateRow');
  ok('the failed-row renderer calls the hint mapper', /_bulkErrorHint\(\s*result\.error\s*\)/.test(body));
  ok('the hardcoded blanket line is gone from the renderer',
     !/>Try a clearer photo<\/div>/.test(body));
  ok('the hint is escaped before rendering', /_esc\(_bulkErrorHint\(/.test(body));
}

/* ═══════════════════════════════════════════════════════════
   B-1. Sports rows must say why, not imply an empty lookup
   ═══════════════════════════════════════════════════════════ */
{
  const body = stripComments(grabFn('_bulkFetchPrice'));
  ok('sports no longer returns a bare null', !/if\s*\(\s*type\s*===\s*'sports'\s*\)\s*return null/.test(body));
  ok('sports returns an object carrying a reason', /unavailableReason/.test(body));
  const m = body.match(/unavailableReason:\s*'([^']+)'/);
  ok('the sports reason is present', !!m);
  ok('the sports reason points at the detail view', m && /details|🔍/.test(m[1]));
  ok('the sports reason does not claim a price was searched for and missed',
     m && !/unavailable|not found|no results/i.test(m[1]));
  ok('sports still yields no fabricated price', /marketPrice:\s*null/.test(body));
}
{
  const body = grabFn('_bulkUpdateRow');
  ok('the row renders the reason when present', /result\.unavailableReason/.test(body));
  ok('the generic line is still the fallback for a real miss',
     /result\.unavailableReason\s*\|\|\s*'Price unavailable'/.test(body));
  ok('the reason is escaped before rendering', /_esc\(result\.unavailableReason/.test(body));
}
ok('the scan row carries the reason from the fetcher',
   /result\.unavailableReason\s*=\s*priceInfo\.unavailableReason/.test(HTML_NC));

/* ═══════════════════════════════════════════════════════════
   B-2. Bulk save must persist the identity fields
   ═══════════════════════════════════════════════════════════ */
const B = new Function(`
  const _lsWrite = () => true;
  let _saved = null;
  const loadPortData = () => [];
  const savePortData = (d) => { _saved = d; return true; };
  const _reportStorageFailure = () => {};
  const storageFailureMessage = () => 'x';
  const showToast = () => {};
  const _maybeRerenderCollection = () => {};
  const _bulkShowSection = () => {};
  const _bulkShowPostSaveBar = () => {};
  const getUserKey = (k) => k;
  const localStorage = { getItem: () => JSON.stringify(_saved || []) };
  const window = {};
  const console = { warn(){} };
  ${grabFn('_bulkSaveToCollection')}
  return (rows, costs, skip) => { _bulkSaveToCollection(rows, costs, skip); return _saved; };
`)();

{
  const row = {
    cardName: 'Hades', setName: 'Floodborn', cardNumber: '74', qty: 1,
    marketPrice: 12.5, imageUrl: 'https://img/x.png', tcgplayerUrl: 'https://tcg/x',
    cardType: 'lorcana', isJapanese: false, groundedId: 'g-1', rarity: 'Super Rare',
    setCode: 'ROF', condition: 'NM',
  };
  const saved = B([row], [5], false);
  const e = saved[0];
  eq('bulk save persists game', e.game, 'lorcana');
  eq('bulk save persists cardType', e.cardType, 'lorcana');
  eq('bulk save persists setCode', e.setCode, 'ROF');
  eq('bulk save persists groundedId', e.groundedId, 'g-1');
  eq('bulk save persists rarity', e.rarity, 'Super Rare');
  eq('bulk save persists isJapanese', e.isJapanese, false);
  eq('bulk save records grader as explicitly empty', e.grader, null);
  eq('bulk save records grade as explicitly empty', e.grade, null);
  eq('bulk save still persists the price', e.currentValue, 12.5);
  eq('bulk save still persists the number', e.number, '74');
  eq('bulk save still persists the image', e.img, 'https://img/x.png');
  eq('bulk save still persists the tcgplayer url', e.tcgplayerUrl, 'https://tcg/x');
  eq('bulk save still stamps updatedAt', typeof e.updatedAt, 'number');
  eq('bulk save applies the cost', e.buyPrice, 5);
  ok('bulk save stamps lastRefreshed when a price exists', !!e.lastRefreshed);
}
{
  // Japanese Pokemon: game keeps the JP marker, cardType normalises to pokemon,
  // matching the single-add path exactly.
  const saved = B([{ cardName: 'Pikachu', cardType: 'pokemonjp', isJapanese: true, marketPrice: 1 }], [0], true);
  eq('JP game is preserved', saved[0].game, 'pokemonjp');
  eq('JP cardType normalises to pokemon', saved[0].cardType, 'pokemon');
  eq('JP flag is preserved', saved[0].isJapanese, true);
}
{
  // The zero-price bug: a legitimate $0.00 comp became "no price".
  const saved = B([{ cardName: 'Bulk Common', marketPrice: 0 }], [0], true);
  eq('a $0.00 comp is stored as 0, not null', saved[0].currentValue, 0);
  ok('a $0.00 comp still counts as fetched', saved[0].lastRefreshed !== null);
}
{
  const saved = B([{ cardName: 'No price' }], [0], true);
  eq('a missing price is stored as null', saved[0].currentValue, null);
  eq('a missing price leaves lastRefreshed null', saved[0].lastRefreshed, null);
}
{
  // Sports identity used by the detail comp search.
  const saved = B([{ cardName: 'Mike Trout', cardType: 'sports', sport: 'Baseball', year: '2011' }], [0], true);
  eq('bulk save persists sport', saved[0].sport, 'Baseball');
  eq('bulk save persists year', saved[0].year, '2011');
}
{
  // Quantity: every copy must carry the identity, not just the first.
  const saved = B([{ cardName: 'Dup', qty: 3, cardType: 'mtg', groundedId: 'g9', marketPrice: 2 }], [4], false);
  eq('a qty-3 row writes three entries', saved.length, 3);
  ok('every copy carries the identity', saved.every(r => r.groundedId === 'g9' && r.cardType === 'mtg'));
  ok('every copy carries the same per-slot cost', saved.every(r => r.buyPrice === 4));
  ok('every copy has a distinct id', new Set(saved.map(r => r.id)).size === 3);
}
{
  // Absent identity must be a stable empty string, not undefined, so the
  // Collection renderer's presence branches behave predictably.
  const saved = B([{ cardName: 'Bare' }], [0], true);
  for (const k of ['game', 'cardType', 'setCode', 'groundedId', 'rarity', 'sport', 'year']) {
    eq(`absent ${k} is an empty string`, saved[0][k], '');
  }
  eq('absent isJapanese is false, not undefined', saved[0].isJapanese, false);
}

// The scanner must actually put setCode on the row for bulk save to read.
ok('the scan response set_code is carried onto the bulk row',
   /result\.setCode\s*=\s*data\.set_code/.test(HTML_NC));

// Field parity with the single-add path.
{
  const single = stripComments(grabFn('saveFlipEntry'));
  const bulk   = stripComments(grabFn('_bulkSaveToCollection'));
  for (const field of ['game', 'cardType', 'setCode', 'groundedId', 'rarity', 'isJapanese', 'grader', 'grade']) {
    ok(`single-add writes ${field}`, new RegExp(`${field}:`).test(single));
    ok(`bulk-save writes ${field} too`, new RegExp(`${field}:`).test(bulk));
  }
  ok('bulk save no longer coerces a zero price with ||',
     !/currentValue:\s*r\.marketPrice\s*\|\|\s*null/.test(bulk));
  ok('bulk save no longer gates lastRefreshed on truthiness',
     !/lastRefreshed:\s*r\.marketPrice\s*\?/.test(bulk));
}

/* ═══════════════════════════════════════════════════════════ */
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const x of fails) console.log('  ✗ ' + x);
  process.exit(1);
}
