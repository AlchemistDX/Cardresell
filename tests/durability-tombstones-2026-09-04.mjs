/**
 * Data-durability majors — 2026-09-04
 *
 * Covers the fourth majors group from the Sol E2E audit:
 *   5.2 signed-in delete resurrection (union is not a delete strategy)
 *   5.3 multi-tab refresh clobbers concurrent state
 *   5.4 localStorage-full failure is silent
 *
 * Discipline: extract the real functions from index.html / api/user-data.js and
 * EXECUTE them. Presence assertions survive both neutering the enclosing `if`
 * and being commented out, so anything executable is executed.
 */
import fs from 'node:fs';
import { readAppSource } from './_appsource.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = readAppSource();
const API  = fs.readFileSync(path.join(ROOT, 'api', 'user-data.js'), 'utf8');

let pass = 0;
const fails = [];
function ok(name, cond) { if (cond) pass++; else fails.push(name); }
function eq(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++; else fails.push(`${name}\n      expected ${e}\n      actual   ${a}`);
}

/** Strip comments so a commented-out call cannot satisfy a presence check. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}

/** Pull `function NAME(...) { ... }` out of a source string by brace matching. */
function grabFrom(src, name, label) {
  const sig = `function ${name}(`;
  const start = src.indexOf(sig);
  if (start === -1) throw new Error(`function ${name} not found in ${label}`);
  let i = src.indexOf(')', start);
  i = src.indexOf('{', i);
  let depth = 0;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error(`unbalanced braces for ${name} in ${label}`);
}
const grabFn = (n) => grabFrom(HTML, n, 'index.html');

const HTML_NC = stripComments(HTML);
const API_NC  = stripComments(API);

/* ═══════════════════════════════════════════════════════════
   Build a live client-side module out of the real source.
   ═══════════════════════════════════════════════════════════ */
const CLIENT_SRC = `
  const _TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
  const _TOMBSTONE_MAX    = 500;
  ${grabFn('_compactTombstones')}
  ${grabFn('_mergeTombstones')}
  ${grabFn('_applyTombstones')}
  ${grabFn('_unionById')}
  return { _compactTombstones, _mergeTombstones, _applyTombstones, _unionById };
`;
const C = new Function(CLIENT_SRC)();

const DAY = 24 * 60 * 60 * 1000;
// Anchor the fixture INSIDE the 90-day retention window. A hardcoded epoch
// silently expired under _compactTombstones' TTL once the wall clock moved
// past it, which made every merge assertion fail for the wrong reason.
const T0 = Date.now() - DAY;

/* ═══════════════════════════════════════════════════════════
   1. Delete resurrection (audit 5.2)
   ═══════════════════════════════════════════════════════════ */

// The audit's exact reproduction: _unionById([{id:77}], []) returns the row.
// That behaviour is CORRECT for a union — the bug was relying on union alone.
eq('union still returns a remote-only row (unchanged primitive)',
   C._unionById([{ id: 77, card: 'Deleted remote' }], []).map(r => r.id), [77]);

// With a tombstone the row must not come back.
{
  const marks = { '77': T0 };
  const merged = C._applyTombstones(C._unionById([{ id: 77, card: 'Deleted remote' }], []), marks);
  eq('tombstoned remote row is NOT resurrected by pull', merged, []);
}

// A row the user never deleted survives.
{
  const rows = C._unionById([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 3 }]);
  const kept = C._applyTombstones(rows, { '2': T0 });
  eq('only the tombstoned id is removed', kept.map(r => r.id).sort((a, b) => a - b), [1, 3]);
}

// Delete-then-re-add must survive: the re-added row is NEWER than the delete.
{
  const readded = { id: 77, card: 'Re-added', updatedAt: T0 + 5000 };
  eq('re-added row (updatedAt > deletedAt) survives its old tombstone',
     C._applyTombstones([readded], { '77': T0 }).map(r => r.card), ['Re-added']);
}

// A row whose updatedAt predates the delete stays deleted.
eq('stale row (updatedAt < deletedAt) stays deleted',
   C._applyTombstones([{ id: 77, updatedAt: T0 - 5000 }], { '77': T0 }), []);

// Equal timestamps: the delete wins (delete is the later intent at same ms).
eq('tie on timestamp resolves to deleted',
   C._applyTombstones([{ id: 77, updatedAt: T0 }], { '77': T0 }), []);

// Legacy rows (no updatedAt at all) lose to an explicit deletion.
eq('legacy row with no updatedAt loses to the tombstone',
   C._applyTombstones([{ id: 77, card: 'Legacy' }], { '77': T0 }), []);

// Rows without ids cannot be reasoned about and are dropped, not kept blindly.
eq('row with null id is discarded', C._applyTombstones([{ id: null }, { id: 5 }], {}).map(r => r.id), [5]);

// Guard shapes.
eq('applyTombstones tolerates non-array rows', C._applyTombstones(null, { '1': T0 }), []);
ok('applyTombstones with no marks returns rows unchanged',
   C._applyTombstones([{ id: 1 }], null).length === 1);

// String vs number ids must not let a delete slip through.
eq('numeric tombstone key matches string row id',
   C._applyTombstones([{ id: '77' }], { '77': T0 }), []);
eq('string row id survives when untombstoned',
   C._applyTombstones([{ id: '78' }], { '77': T0 }).map(r => r.id), ['78']);

/* ── tombstone merge ── */
{
  const a = { portfolio: { '1': T0 }, flips: {} };
  const b = { portfolio: { '2': T0 }, flips: { '9': T0 } };
  const m = C._mergeTombstones(a, b);
  eq('merge unions portfolio marks', Object.keys(m.portfolio).sort(), ['1', '2']);
  eq('merge carries flips marks', Object.keys(m.flips), ['9']);
}
{
  // Latest deletedAt wins so a stale device cannot rewind a delete.
  const m = C._mergeTombstones({ portfolio: { '1': T0 } }, { portfolio: { '1': T0 + 9999 } });
  eq('merge keeps the LATEST deletedAt', m.portfolio['1'], T0 + 9999);
  const m2 = C._mergeTombstones({ portfolio: { '1': T0 + 9999 } }, { portfolio: { '1': T0 } });
  eq('merge keeps the latest regardless of argument order', m2.portfolio['1'], T0 + 9999);
}
eq('merge tolerates undefined inputs', C._mergeTombstones(undefined, undefined), { portfolio: {}, flips: {} });
eq('merge tolerates garbage inputs', C._mergeTombstones({ portfolio: 'nope' }, 7), { portfolio: {}, flips: {} });

/* ── compaction ── */
{
  const now = T0;
  const t = { portfolio: { fresh: now - DAY, old: now - 200 * DAY, zero: 0 }, flips: {} };
  const c = C._compactTombstones(t, now);
  ok('compaction keeps a fresh mark', c.portfolio.fresh === now - DAY);
  ok('compaction drops a mark past the 90-day TTL', c.portfolio.old === undefined);
  ok('compaction drops a zero timestamp', c.portfolio.zero === undefined);
}
{
  // Over the cap: newest survive, oldest are trimmed.
  const src = {};
  for (let i = 0; i < 600; i++) src[`id${i}`] = T0 - i * 1000;
  const c = C._compactTombstones({ portfolio: src, flips: {} }, T0);
  ok('compaction caps at 500 marks', Object.keys(c.portfolio).length === 500);
  ok('compaction keeps the newest mark', c.portfolio.id0 === T0);
  ok('compaction trims the oldest mark', c.portfolio.id599 === undefined);
}
ok('compaction always returns both collections',
   (() => { const c = C._compactTombstones({}); return !!c.portfolio && !!c.flips; })());

/* ═══════════════════════════════════════════════════════════
   2. Multi-tab clobber (audit 5.3)
   ═══════════════════════════════════════════════════════════ */
function makeCommitHarness(store) {
  const src = `
    const _PRICE_REFRESH_FIELDS = ['currentValue','lastRefreshed','img','imageUrl','tcgplayerUrl'];
    ${grabFn('_commitPortfolioRefresh')}
    return _commitPortfolioRefresh;
  `;
  const saved = [];
  const fn = new Function('loadPortData', 'savePortData', 'Date', src)(
    () => JSON.parse(JSON.stringify(store.rows)),
    (data) => { if (store.failWrite) return false; store.rows = data; saved.push(data); return true; },
    Date
  );
  return { fn, saved };
}

// The audit's exact two-tab race.
{
  const store = {
    // Tab A began its refresh with ids 1 and 2. Tab B has since deleted 1 and added 3.
    rows: [{ id: 2, card: 'Keep' }, { id: 3, card: 'Added Concurrently' }],
  };
  const { fn } = makeCommitHarness(store);
  // Tab A's stale in-flight array, carrying freshly fetched prices.
  const stale = [
    { id: 1, card: 'Delete Me', currentValue: 11, lastRefreshed: 'T' },
    { id: 2, card: 'Keep',      currentValue: 22, lastRefreshed: 'T' },
  ];
  const res = fn(stale);
  const ids = store.rows.map(r => r.id).sort((a, b) => a - b);
  eq('deleted-mid-refresh row is NOT resurrected, added row is NOT lost', ids, [2, 3]);
  ok('refresh reports the row it could not apply', res.dropped === 1);
  ok('refresh reports the row it did apply', res.grafted === 1);
  eq('surviving row received the fresh price', store.rows.find(r => r.id === 2).currentValue, 22);
  eq('concurrently added row keeps its own state',
     store.rows.find(r => r.id === 3).card, 'Added Concurrently');
  ok('concurrently added row is not given a price it never fetched',
     store.rows.find(r => r.id === 3).currentValue === undefined);
}

// Only the price fields are grafted; user edits made during the refresh survive.
{
  const store = { rows: [{ id: 1, card: 'Renamed by user', buyPrice: 99, currentValue: 5 }] };
  const { fn } = makeCommitHarness(store);
  fn([{ id: 1, card: 'Old name', buyPrice: 1, currentValue: 50, lastRefreshed: 'T' }]);
  const row = store.rows[0];
  eq('concurrent rename is preserved', row.card, 'Renamed by user');
  eq('concurrent buyPrice edit is preserved', row.buyPrice, 99);
  eq('fetched price is applied', row.currentValue, 50);
  eq('lastRefreshed is applied', row.lastRefreshed, 'T');
}

// Commit stamps updatedAt so the row can outlive an older tombstone.
{
  const store = { rows: [{ id: 1, currentValue: 1 }] };
  const { fn } = makeCommitHarness(store);
  fn([{ id: 1, currentValue: 2 }]);
  ok('grafted row gets an updatedAt stamp', typeof store.rows[0].updatedAt === 'number');
}

// A no-op refresh must not bump updatedAt (it would defeat tombstones).
{
  const store = { rows: [{ id: 1, currentValue: 7 }] };
  const { fn } = makeCommitHarness(store);
  const res = fn([{ id: 1, currentValue: 7 }]);
  ok('unchanged row is not counted as grafted', res.grafted === 0);
  ok('unchanged row gets no updatedAt stamp', store.rows[0].updatedAt === undefined);
}

// Empty / absent refresh sets are safe.
{
  const store = { rows: [{ id: 1 }, { id: 2 }] };
  const { fn } = makeCommitHarness(store);
  const res = fn([]);
  eq('empty refresh preserves every row', store.rows.map(r => r.id), [1, 2]);
  ok('empty refresh grafts nothing', res.grafted === 0 && res.dropped === 0);
  fn(null);
  eq('null refresh preserves every row', store.rows.map(r => r.id), [1, 2]);
}

// A failed write is reported, not swallowed.
{
  const store = { rows: [{ id: 1, currentValue: 1 }], failWrite: true };
  const { fn } = makeCommitHarness(store);
  ok('commit reports ok:false when the write is refused', fn([{ id: 1, currentValue: 2 }]).ok === false);
}

// Every awaited refresh path must commit through the merge, not savePortData.
for (const fname of ['refreshCollectionPrices', 'refreshSingleCardPrice', '_refetchCardMeta']) {
  const body = stripComments(grabFn(fname));
  ok(`${fname} commits via _commitPortfolioRefresh`, /_commitPortfolioRefresh\(/.test(body));
  ok(`${fname} no longer writes a stale full array with savePortData`,
     !/savePortData\(\s*port\s*\)/.test(body));
}

/* ═══════════════════════════════════════════════════════════
   3. Silent storage failure (audit 5.4)
   ═══════════════════════════════════════════════════════════ */
function makeWriteHarness(behaviour) {
  const src = `
    const window = { _lastStorageFailure: null };
    const console = { error(){}, warn(){} };
    ${grabFn('_lsWrite')}
    ${grabFn('storageFailureMessage')}
    return { _lsWrite, storageFailureMessage, window };
  `;
  const localStorage = { setItem: behaviour };
  return new Function('localStorage', src)(localStorage);
}

{
  const H = makeWriteHarness(() => {});
  ok('_lsWrite returns true on success', H._lsWrite('k', 'v') === true);
  ok('successful write records no failure', H.window._lastStorageFailure === null);
}
{
  const quota = () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; };
  const H = makeWriteHarness(quota);
  ok('_lsWrite returns false on quota error', H._lsWrite('k', 'v') === false);
  ok('quota failure is recorded', !!H.window._lastStorageFailure);
  ok('quota failure is flagged as quota', H.window._lastStorageFailure.quota === true);
  ok('quota failure records the key', H.window._lastStorageFailure.key === 'k');
  const msg = H.storageFailureMessage();
  ok('quota message says storage is full', /storage is full/i.test(msg));
  ok('quota message does not claim the save succeeded', !/saved/i.test(msg) || /not be saved/i.test(msg));
  ok('quota message offers a concrete next step', /CSV/i.test(msg));
}
{
  // Firefox reports quota via a different name; Safari private mode via code.
  const ff = () => { const e = new Error('x'); e.name = 'NS_ERROR_DOM_QUOTA_REACHED'; throw e; };
  ok('Firefox quota name is recognised', makeWriteHarness(ff).window ? (() => {
    const H = makeWriteHarness(ff); H._lsWrite('k', 'v');
    return H.window._lastStorageFailure.quota === true;
  })() : false);
  const legacy = () => { const e = new Error('x'); e.name = 'Whatever'; e.code = 22; throw e; };
  const H2 = makeWriteHarness(legacy); H2._lsWrite('k', 'v');
  ok('legacy code 22 is recognised as quota', H2.window._lastStorageFailure.quota === true);
  const legacy1014 = () => { const e = new Error('x'); e.name = 'Whatever'; e.code = 1014; throw e; };
  const H3 = makeWriteHarness(legacy1014); H3._lsWrite('k', 'v');
  ok('legacy code 1014 is recognised as quota', H3.window._lastStorageFailure.quota === true);
}
{
  // A non-quota rejection (private mode) must still be reported, with different copy.
  const denied = () => { const e = new Error('denied'); e.name = 'SecurityError'; throw e; };
  const H = makeWriteHarness(denied);
  ok('non-quota rejection returns false', H._lsWrite('k', 'v') === false);
  ok('non-quota rejection is not mislabelled as quota', H.window._lastStorageFailure.quota === false);
  ok('non-quota message mentions private browsing', /private browsing/i.test(H.storageFailureMessage()));
}

/* ── save wrappers must propagate the boolean ── */
for (const fname of ['savePortData', 'saveFlipsData', 'saveGradingData']) {
  const body = stripComments(grabFn(fname));
  ok(`${fname} routes through _lsWrite`, /_lsWrite\(/.test(body));
  ok(`${fname} no longer swallows exceptions with an empty catch`, !/catch\s*\(\s*e\s*\)\s*\{\s*\}/.test(body));
  ok(`${fname} returns a status`, /return\s+(ok|_lsWrite)/.test(body));
}

/* ── callers must not close their modal on a refused write ── */
{
  const save = stripComments(grabFn('saveFlipEntry'));
  ok('saveFlipEntry bails when the collection write fails',
     /if\s*\(\s*!savePortData\([^)]*\)\s*\)\s*\{[^}]*return/.test(save));
  ok('saveFlipEntry bails when the flip write fails',
     /if\s*\(\s*!saveFlipsData\([^)]*\)\s*\)\s*\{[^}]*return/.test(save));
  ok('saveFlipEntry reports the failure to the user',
     /_reportStorageFailure\(\)/.test(save));
}
{
  const cms = stripComments(grabFn('confirmMarkSold'));
  ok('confirmMarkSold bails before deleting the card if the flip did not persist',
     /if\s*\(\s*!saveFlipsData\([^)]*\)\s*\)\s*\{[^}]*return/.test(cms));
  // Order matters: the flip must be durable BEFORE the collection row is dropped.
  const flipGate = cms.search(/!saveFlipsData\(/);
  const removal  = cms.search(/savePortData\(\s*port\.filter/);
  ok('the flip-write gate precedes the collection removal',
     flipGate !== -1 && removal !== -1 && flipGate < removal);
  ok('confirmMarkSold reports a failed removal too', /_reportStorageFailure\(\)/.test(cms));
}
{
  const g = stripComments(grabFn('saveGradingEntry'));
  ok('grading save bails on a refused write',
     /if\s*\(\s*!saveGradingData\([^)]*\)\s*\)\s*\{[^}]*return/.test(g));
}
{
  const b = stripComments(grabFn('_bulkSaveToCollection'));
  ok('bulk save captures the write status', /bulkSaveOk/.test(b));
  ok('bulk save surfaces the real reason on failure', /storageFailureMessage\(\)/.test(b));
  ok('bulk save no longer only offers "tap Refresh" for a quota failure',
     /if\s*\(\s*!bulkSaveOk\s*\)/.test(b));
}

/* ═══════════════════════════════════════════════════════════
   4. Delete sites all record a tombstone
   ═══════════════════════════════════════════════════════════ */
for (const [fname, kind] of [
  ['deleteFlip', 'flips'],
  ['deletePort', 'portfolio'],
  ['deletePortEntry', 'portfolio'],
  ['confirmMarkSold', 'portfolio'],
  ['_ccmRemoveCard', 'portfolio'],
  ['clearCollection', 'portfolio'],
]) {
  const body = stripComments(grabFn(fname));
  ok(`${fname} records a ${kind} tombstone`,
     new RegExp(`_addTombstones\\(\\s*'${kind}'`).test(body));
}
{
  const cc = stripComments(grabFn('clearCollection'));
  ok('clearCollection tombstones flips as well as the portfolio',
     /_addTombstones\(\s*'flips'/.test(cc));
  ok('clearCollection sends tombstones with its immediate server push',
     /tombstones:\s*loadTombstones\(\)/.test(cc));
}
{
  const df = stripComments(grabFn('deleteFlip'));
  const mark = df.search(/_addTombstones\(/);
  const save = df.search(/saveFlipsData\(/);
  ok('the tombstone is recorded before the save, so a failed write keeps the intent',
     mark !== -1 && save !== -1 && mark < save);
}

/* ═══════════════════════════════════════════════════════════
   5. Sync path wiring
   ═══════════════════════════════════════════════════════════ */
{
  const pull = stripComments(grabFn('_pullUserData'));
  ok('pull applies tombstones to the merged portfolio',
     /_applyTombstones\(\s*_unionById\(\s*remotePort/.test(pull));
  ok('pull applies tombstones to the merged flips',
     /_applyTombstones\(\s*_unionById\(\s*remoteFlips/.test(pull));
  ok('pull merges the server tombstones with local ones', /_mergeTombstones\(/.test(pull));
  ok('pull persists the merged tombstones', /_saveTombstones\(/.test(pull));
  ok('pull no longer writes the raw union straight to storage',
     !/setItem\(getUserKey\('portfolio'\),\s*JSON\.stringify\(mergedPort\)\)/.test(pull)
     || /_lsWrite\(getUserKey\('portfolio'\)/.test(pull));
}
{
  const push = stripComments(grabFn('_pushUserData'));
  ok('push sends tombstones to the server', /tombstones/.test(push));
  ok('push reads tombstones from storage', /loadTombstones\(\)/.test(push));
}
{
  ok('a storage listener exists for cross-tab reconciliation',
     /addEventListener\(\s*'storage'/.test(HTML_NC));
  const idx = HTML_NC.search(/addEventListener\(\s*'storage'/);
  const seg = HTML_NC.slice(idx, idx + 1400);
  ok('storage listener re-renders the collection', /_maybeRerenderCollection/.test(seg));
  ok('storage listener re-renders the flip log', /renderFlipsView/.test(seg));
  ok('storage listener reacts to remote tombstones', /getUserKey\('tombstones'\)/.test(seg));
}

/* ═══════════════════════════════════════════════════════════
   6. Rows carry updatedAt so re-adds beat old tombstones
   ═══════════════════════════════════════════════════════════ */
ok('at least five add paths stamp updatedAt',
   (HTML_NC.match(/updatedAt:\s*Date\.now\(\)/g) || []).length >= 5);
for (const fname of ['saveFlipEntry', 'confirmMarkSold', '_bulkSaveToCollection']) {
  ok(`${fname} stamps updatedAt on rows it writes`,
     /updatedAt:\s*Date\.now\(\)/.test(stripComments(grabFn(fname))));
}

/* ═══════════════════════════════════════════════════════════
   7. Server: /api/user-data must honour tombstones
   ═══════════════════════════════════════════════════════════ */
const S = await import(path.join(ROOT, 'api', 'user-data.js'));

eq('server drops a tombstoned row', S._applyTombstones([{ id: 77 }], { '77': T0 }), []);
eq('server keeps an untombstoned row', S._applyTombstones([{ id: 78 }], { '77': T0 }).map(r => r.id), [78]);
eq('server honours a re-add newer than the delete',
   S._applyTombstones([{ id: 77, updatedAt: T0 + 1 }], { '77': T0 }).map(r => r.id), [77]);
eq('server keeps a stale row deleted',
   S._applyTombstones([{ id: 77, updatedAt: T0 - 1 }], { '77': T0 }), []);
eq('server drops rows without ids', S._applyTombstones([{ id: null }], {}), []);
ok('server passes rows through when marks are absent',
   S._applyTombstones([{ id: 1 }], null).length === 1);
eq('server tolerates a non-array payload', S._applyTombstones('nope', {}), []);

{
  const m = S._mergeTombstones({ portfolio: { '1': T0 } }, { portfolio: { '1': T0 + 5, '2': T0 } });
  eq('server merge keeps the latest deletedAt', m.portfolio['1'], T0 + 5);
  eq('server merge unions ids', Object.keys(m.portfolio).sort(), ['1', '2']);
}
eq('server merge tolerates undefined', S._mergeTombstones(undefined, undefined), { portfolio: {}, flips: {} });
{
  const c = S._compactTombstones({ portfolio: { old: T0 - 200 * DAY, fresh: T0 - DAY }, flips: {} }, T0);
  ok('server compaction drops expired marks', c.portfolio.old === undefined);
  ok('server compaction keeps fresh marks', c.portfolio.fresh === T0 - DAY);
}
{
  const src = {};
  for (let i = 0; i < 600; i++) src[`id${i}`] = T0 - i * 1000;
  const c = S._compactTombstones({ portfolio: src, flips: {} }, T0);
  ok('server compaction caps the mark count', Object.keys(c.portfolio).length === 500);
}

// Server source wiring: the union must be followed by a subtraction.
ok('server applies tombstones after the union on POST',
   (() => {
     const i = API_NC.search(/finalPortfolio\s*=\s*_mergeById/);
     const j = API_NC.search(/finalPortfolio\s*=\s*_applyTombstones/);
     return i !== -1 && j !== -1 && i < j;
   })());
ok('server applies tombstones to flips on POST too',
   /finalFlips\s*=\s*_applyTombstones/.test(API_NC));
ok('server persists tombstones in the stored blob', /tombstones:\s*marks/.test(API_NC));
ok('server returns tombstones on GET', /tombstones:\s*marks/.test(API_NC));
ok('server applies tombstones on GET as well as POST',
   /portfolio:\s*_applyTombstones\(/.test(API_NC));
ok('server reads client tombstones from the POST body', /body\.tombstones/.test(API_NC));
ok('server merges client and stored tombstones',
   /_mergeTombstones\(\s*existing\s*&&\s*existing\.tombstones/.test(API_NC));
ok('server GET returns an empty tombstone shape for a brand-new user',
   /tombstones:\s*\{\s*portfolio:\s*\{\}\s*,\s*flips:\s*\{\}\s*\}/.test(API_NC));

/* ═══════════════════════════════════════════════════════════
   8. End-to-end: the audit's resurrection scenario, both sides
   ═══════════════════════════════════════════════════════════ */
{
  // Device A deletes id 1. Server still has it. Device A pulls.
  const remotePort = [{ id: 1, card: 'Delete Me' }, { id: 2, card: 'Keep' }];
  const localPort  = [{ id: 2, card: 'Keep' }];
  const marks = C._mergeTombstones({ portfolio: { '1': T0 } }, {});
  const merged = C._applyTombstones(C._unionById(remotePort, localPort), marks.portfolio);
  eq('client pull does not resurrect the deleted card', merged.map(r => r.id), [2]);

  // The same payload reaching the server must also drop it.
  const serverFinal = S._applyTombstones(
    // server-side union of its stored copy with the client's shorter array
    [{ id: 1, card: 'Delete Me' }, { id: 2, card: 'Keep' }],
    marks.portfolio
  );
  eq('server push does not retain the deleted card', serverFinal.map(r => r.id), [2]);
}
{
  // Device B (never saw the delete) learns about it from the server's tombstones.
  const serverMarks = { portfolio: { '1': T0 }, flips: {} };
  const deviceBLocal = [{ id: 1, card: 'Delete Me' }, { id: 5, card: 'B only' }];
  const marks = C._mergeTombstones({ portfolio: {}, flips: {} }, serverMarks);
  const merged = C._applyTombstones(C._unionById([], deviceBLocal), marks.portfolio);
  eq('a second device honours a delete it never performed', merged.map(r => r.id), [5]);
}

/* ═══════════════════════════════════════════════════════════ */
console.log(`\n${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log('\nFAILURES:');
  for (const f of fails) console.log('  ✗ ' + f);
  process.exit(1);
}
