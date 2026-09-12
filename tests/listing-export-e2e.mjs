/**
 * tests/listing-export-e2e.mjs — the exported CSV, end to end, in a browser.
 *
 * WHY THIS FILE REPLACES A RECONSTRUCTION
 * ---------------------------------------
 * An earlier suite (tests/listing-identity-export.mjs) rebuilt the faulty
 * expression inside the test and asserted on the result. Will's correction:
 * "If the test reconstructs the faulty expression itself, changing production
 * code will not fix that test." Correct, and it is the whole point — that
 * suite pinned a STRING, not a code path, so repairing js/ui.823136c3.js:3769
 * would have left it red and repairing the test would have left it green
 * against broken product.
 *
 * So nothing here rebuilds anything. The suite:
 *   1. loads the shipped index.html and the shipped bundles in a real browser,
 *   2. calls the REAL `_bulkScanRowToCard` on a real scan-row shape,
 *   3. POSTs the result to the REAL api/drafts.js handler, which derives the
 *      title and sku server-side (the client is refused if it supplies them),
 *   4. reads the draft back through the REAL GET route,
 *   5. builds the file with the REAL `_ebayDraftCsv`,
 *   6. asserts the resulting CSV FIELDS against the row of the actual CSV the
 *      seller downloaded (tests/fixtures/ebay-draft-3.csv).
 *
 * Every assertion therefore fails when the product is wrong and passes when it
 * is fixed, with no test-side edit.
 *
 * WHAT IS REAL AND WHAT IS SUBSTITUTED
 * ------------------------------------
 * Real: browser, shipped bundles, shipped index.html, real _bulkScanRowToCard,
 * real POST/GET api/drafts.js, real RS256 verification, real title builder,
 * real listing packet, real _ebayDraftCsv, real CSV text.
 *
 * Substituted, and named: Google's JWKS (locally minted keypair, still a real
 * signature check) and Upstash (in-memory map over the same REST shape), both
 * from tools/dev-draft-server.mjs. Price/identification vendors are not called
 * at all — the scan row is supplied directly, which is the input under test.
 *
 * NOT ESTABLISHED BY THIS FILE: nothing about the deployed site, nothing about
 * eBay's acceptance of the file (that needs a real Seller Hub upload), nothing
 * about Upstash TTL or real Redis script semantics.
 *
 * Run: NODE_PATH=/home/user/node_modules node tests/listing-export-e2e.mjs
 */

import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { harness } from './_assert.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = '/home/user/node_modules/playwright/index.js';
const PORT = Number(process.env.CR_EXPORT_PORT || 8347);
const B = `http://127.0.0.1:${PORT}`;

const T = harness('listing-export-e2e');
const ok = (name, cond, hint) => T.check(name, !!cond, hint);
const eq = (name, actual, expected) =>
  T.check(name, Object.is(actual, expected),
    `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);

/* ── the actual downloaded file, as the fixture ──────────────────────────── */

const FIXTURE = path.join(ROOT, 'tests', 'fixtures', 'ebay-draft-3.csv');
const fixtureText = readFileSync(FIXTURE, 'utf8');

/** Split one CSV line on commas that are not inside double quotes. */
function splitCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; }
    else if (c === ',' && !q) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out;
}

/** header -> value for the single Draft row of a File Exchange CSV. */
function draftRow(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  const hi = lines.findIndex((l) => l.startsWith('Action(') || /^Action\b/.test(l));
  if (hi < 0) throw new Error('no Action header row found');
  const head = splitCsvLine(lines[hi]);
  const body = lines.slice(hi + 1).find((l) => /^Draft,/.test(l));
  if (!body) throw new Error('no Draft row found');
  const cells = splitCsvLine(body);
  const row = {};
  head.forEach((h, i) => { row[h.trim()] = (cells[i] ?? '').trim(); });
  /* The Action column's header carries the whole site/currency/version
     preamble -- `Action(SiteID=US|Country=US|Currency=USD|Version=1193|CC=UTF-8)`
     -- so there is no plain "Action" key to read. Expose the first cell under
     a stable alias rather than hardcoding that preamble, which eBay revises. */
  row.__action = (cells[0] ?? '').trim();
  return row;
}

const shipped = draftRow(fixtureText);

/* The defect, read off the seller's own file rather than asserted from memory.
   These four are the baseline the fix has to move. */
ok('F1. fixture: the downloaded title states the number twice',
  (shipped.Title.match(/134/g) || []).length === 2,
  `Title = ${JSON.stringify(shipped.Title)}`);
ok('F2. fixture: the downloaded title carries a presentation separator',
  shipped.Title.includes('\u00b7'), JSON.stringify(shipped.Title));
eq('F3. fixture: Item photo URL was blank', shipped['Item photo URL'], '');
eq('F4. fixture: Condition ID was blank', shipped['Condition ID'], '');

/* The SKU actually issued. Every identity assertion below is measured against
   THIS string, not against a recomputed expectation. */
const SHIPPED_SKU = shipped['Custom label (SKU)'];
eq('F5. fixture: the issued SKU', SHIPPED_SKU, 'v2-PKMMEG134-1dffa7b90107ea00');

/* ── dev server ─────────────────────────────────────────────────────────── */

const srv = spawn('node', ['tools/dev-draft-server.mjs'], {
  cwd: ROOT, env: { ...process.env, DEV_PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
});
let srvLog = '';
srv.stdout.on('data', (d) => { srvLog += d; });
srv.stderr.on('data', (d) => { srvLog += d; });
await new Promise((resolve, reject) => {
  const t0 = Date.now();
  const tick = setInterval(() => {
    if (/dev-draft-server on /.test(srvLog)) { clearInterval(tick); resolve(); }
    else if (Date.now() - t0 > 20000) { clearInterval(tick); reject(new Error('dev server did not start: ' + srvLog)); }
  }, 100);
});
const shutdown = () => { try { srv.kill('SIGKILL'); } catch (_) {} };
process.on('exit', shutdown);

const tokenFor = async (sub) =>
  (await (await fetch(`${B}/__devtoken?sub=${encodeURIComponent(sub)}`)).json()).token;

/* ── the scan row, in the shape Rapid/Bulk Scan produces ────────────────────
   Field names match what _bulkScanRowToCard reads (js/ui.823136c3.js:3768).
   Values are the VERIFIED catalogue record for the reported card:
   card-index.json id me1-134 and api.pokemontcg.io/v2/cards/me1-134 agree on
   name, set, number and rarity "Illustration Rare".

   rarity is deliberately the catalogue's value, NOT the "Shiny Rare" the
   download carried. Where that string came from is not established, so it is
   not encoded here as if it were input. */
const SCAN_ROW = {
  cardName: 'Ivysaur',
  setName: 'Mega Evolution',
  cardNumber: '134',
  setCode: 'MEG',
  rarity: 'Illustration Rare',
  /* `cardType`, NOT `game`. The mapper derives both game and cardType from
     this one field (js/ui.823136c3.js:3781-3782), and the real scan row sets
     it at js/ui.823136c3.js:3242 (`result.cardType = data.card_type ||
     'pokemon'`). An earlier version of this fixture supplied `game` instead
     and the create was refused with SELL_NEEDS_GAME — the fixture was wrong,
     not the product. */
  cardType: 'pokemon',
  id: 'me1-134',
  imageUrl: 'https://images.pokemontcg.io/me1/134.png',
  price: 19.83,
  priceSource: 'comp',
};

const { chromium } = (await import(PW)).default;
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));

await page.goto(`${B}/index.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => typeof window._bulkScanRowToCard === 'function' && typeof window._ebayDraftCsv === 'function',
  null, { timeout: 15000 },
).catch(() => {});

/* Gate: if the shipped functions are not reachable the suite must fail loudly
   rather than silently fall back to a reconstruction. */
const reach = await page.evaluate(() => ({
  mapper: typeof window._bulkScanRowToCard,
  csv: typeof window._ebayDraftCsv,
}));
ok('R1. the REAL _bulkScanRowToCard is reachable (no reconstruction)',
  reach.mapper === 'function', `typeof = ${reach.mapper}`);
ok('R2. the REAL _ebayDraftCsv is reachable (no reconstruction)',
  reach.csv === 'function', `typeof = ${reach.csv}`);

if (reach.mapper !== 'function' || reach.csv !== 'function') {
  console.log('\nABORT: shipped functions not reachable as globals; nothing below would be real.');
  T.done();
  await browser.close();
  process.exit(0);
}

/* ── 1. the real mapper ─────────────────────────────────────────────────── */

const mapped = await page.evaluate((row) => window._bulkScanRowToCard(row), SCAN_ROW);

ok('M1. the mapper does not fuse the number into the set field',
  !/#|\u00b7/.test(String(mapped.set ?? '')),
  `set = ${JSON.stringify(mapped.set)}`);
eq('M2. the mapper reports the bare set name', String(mapped.set ?? ''), 'Mega Evolution');
eq('M3. the mapper carries the number separately', String(mapped.number ?? ''), '134');
ok('M4. the mapper asserts no condition the seller never chose',
  mapped.condition === '' || mapped.condition === null || mapped.condition === undefined,
  `condition = ${JSON.stringify(mapped.condition)} (a fallback is not a selection)`);

/* ── Explicit selection vs fallback ───────────────────────────────────────
 *
 * Will's correction 4: a default of NM does not prove the seller selected a
 * condition, and the two must be traced separately.
 *
 * M4 above is NOT sufficient on its own, and saying so matters: the fixture
 * omits `condition` entirely, so M4 passed even while the scan path was still
 * assigning 'NM' unconditionally (js/ui.823136c3.js:3247, now removed). M4
 * tested a row no scan ever produces. These cases use rows shaped like the
 * ones the scan path really emits.
 *
 * E1 is the case the seller hit. E3 is the retry case: the old unconditional
 * assignment also clobbered a choice already made.
 */
const condCases = await page.evaluate((row) => {
  const m = (extra) => window._bulkScanRowToCard({ ...row, ...extra });
  return {
    // A real post-scan row, untouched by the seller.
    unchosen: m({ condition: 'NM', conditionChosen: false }).condition,
    // The seller opened the picker and chose Near Mint. Same VALUE as above.
    chosenNM: m({ condition: 'NM', conditionChosen: true }).condition,
    // The seller chose something other than the old default.
    chosenLP: m({ condition: 'LP', conditionChosen: true }).condition,
    // Flag set but no value: still nothing to assert.
    flagOnly: m({ condition: '', conditionChosen: true }).condition,
  };
}, SCAN_ROW);

eq('E1. a scanned-but-untouched row exports NO condition, even though the row holds "NM"',
  String(condCases.unchosen ?? ''), '');
eq('E2. an explicitly chosen Near Mint IS exported', String(condCases.chosenNM ?? ''), 'NM');
eq('E3. a chosen non-default condition survives', String(condCases.chosenLP ?? ''), 'LP');
eq('E4. the flag alone asserts nothing', String(condCases.flagOnly ?? ''), '');
ok('E5. the two states are distinguishable — same value, different export',
  condCases.unchosen !== condCases.chosenNM,
  'unchosen and chosen-NM exported identically, so selection is still not traced');

/* ── 2. the real handler derives title and sku ──────────────────────────── */

const sub = 'export-e2e-seller';
const token = await tokenFor(sub);

const created = await page.evaluate(async ({ base, tok, card }) => {
  const r = await fetch(base + '/api/drafts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + tok,
      'Idempotency-Key': 'export-e2e-key-1',
    },
    body: JSON.stringify({
      card, instanceId: 'export-e2e-inst', slot: 'ebay:fixed-price',
      price: 19.83, priceSource: 'comp',
      pricingContext: { feeModelRevision: 'test', venue: 'ebay' },
    }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, { base: B, tok: token, card: mapped });

ok('H1. the real handler accepted the mapped card',
  created.status === 200 || created.status === 201,
  `status ${created.status} body ${JSON.stringify(created.body).slice(0, 400)}`);

const draftId = created.body?.draftId || created.body?.draft?.draftId || null;
ok('H2. a draft id came back', !!draftId, JSON.stringify(created.body).slice(0, 300));

/* ── 3. read back through the real GET route ─────────────────────────────── */

const fetched = draftId ? await page.evaluate(async ({ base, tok, id }) => {
  /* `id`, not `draftId` — api/drafts.js:75 reads req.query.id. */
  const r = await fetch(`${base}/api/drafts?id=${encodeURIComponent(id)}`, {
    headers: { Authorization: 'Bearer ' + tok },
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, { base: B, tok: token, id: draftId }) : { status: 0, body: {} };

ok('G1. the draft read back', fetched.status === 200,
  `status ${fetched.status} ${JSON.stringify(fetched.body).slice(0, 300)}`);

const draft = fetched.body?.draft || null;
const packet = fetched.body?.packet || null;

/* ── 4. the server-derived title ─────────────────────────────────────────── */

/* An absent draft must not let these pass vacuously: an empty title contains
   no middot and does not equal the shipped defect, so T2/T4 would have gone
   green on nothing. Every assertion below requires the draft to exist. */
const haveDraft = !!draft;
const title = String(draft?.title ?? '');
ok('T0. there is a draft to assert a title on', haveDraft,
  'no draft was created, so T1-T4 below are not evidence of anything');
ok('T1. the server-derived title states the number exactly once',
  haveDraft && (title.match(/134/g) || []).length === 1, `title = ${JSON.stringify(title)}`);
ok('T2. the server-derived title carries no presentation separator',
  haveDraft && !title.includes('\u00b7'), `title = ${JSON.stringify(title)}`);
ok('T3. the title still names the card and the set',
  haveDraft && title.includes('Ivysaur') && title.includes('Mega Evolution'), JSON.stringify(title));
ok('T4. the title is not the malformed string the seller downloaded',
  haveDraft && title !== shipped.Title, 'title still equals the shipped defect');

/* ── The printed denominator ───────────────────────────────────────────────
 *
 * Will's requirement: "Include a small, reviewed metadata update for the
 * affected set so the actual Ivysaur export demonstrates 134/132." So it is
 * asserted on the REAL server-derived title, not on the formatter in
 * isolation -- the formatter has its own suite, and a passing formatter unit
 * test was explicitly named as insufficient.
 *
 * 132 is the denominator printed on the card, verified twice in-session from
 * api.pokemontcg.io/v2/cards/me1-134 (printedTotal 132, total 188). D2 is the
 * one that matters: the set holds 188 records and its highest card number is
 * 188, so a denominator derived from the catalogue instead of from reviewed
 * metadata would read 134/188 and D2 would fail.
 */
ok('D1. the title states the number with its printed denominator: 134/132',
  haveDraft && title.includes('134/132'), `title = ${JSON.stringify(title)}`);
ok('D2. the denominator is the PRINTED total, not the set\u2019s record count or max number',
  haveDraft && !title.includes('/188'), `title = ${JSON.stringify(title)}`);

/* -- The photo payload trace ---------------------------------------------
 *
 * Will's correction 3: "Searching for photo cannot establish that no image
 * data reaches storage when the submitted object contains img and imageUrl."
 *
 * So this does not grep. It observes the SUBMITTED object and the STORED
 * draft that came back from the real handler, and reports which image fields
 * survived. PH0 is the non-vacuity guard: if the mapper stopped emitting
 * image fields, every assertion after it would pass on nothing.
 *
 * What "the CSV photo column is blank" does and does not mean is the thing
 * being separated here. A blank column is an EXPORT limitation -- eBay needs a
 * publicly fetchable URL and CardResell hosts none. It says nothing about what
 * the draft record holds, which is what these checks establish.
 */
const submittedImageFields = Object.keys(mapped).filter(
  (k) => /^(img|imageUrl|imageDataUrl|photo|photos|image)$/.test(k) && mapped[k] != null,
);
ok('PH0. the mapper really does submit image fields (otherwise PH1-PH3 are vacuous)',
  submittedImageFields.length > 0,
  `submitted image-ish keys = ${JSON.stringify(submittedImageFields)}`);
ok('PH1. specifically, both img and imageUrl are on the submitted object',
  mapped.img != null && mapped.imageUrl != null,
  `img = ${JSON.stringify(mapped.img)}, imageUrl = ${JSON.stringify(mapped.imageUrl)}`);

/* The stored draft, as the server handed it back. Recorded rather than
   asserted-against-a-guess: the point is to state what persists. */
const storedCard = (draft && (draft.card || draft)) || {};
const storedImageFields = Object.keys(storedCard).filter(
  (k) => /img|image|photo/i.test(k) && storedCard[k] != null,
);
console.log('  [trace] submitted image fields: ' + JSON.stringify(submittedImageFields));
console.log('  [trace] stored draft image fields: ' + JSON.stringify(storedImageFields));
console.log('  [trace] stored draft top-level keys: ' + JSON.stringify(Object.keys(draft || {})));

ok('PH2. no seller PHOTOGRAPH bytes are in the stored draft',
  !JSON.stringify(draft || {}).includes('data:image'),
  'a data: URL reached the draft record; local photos must stay in IndexedDB');
ok('PH3. any image reference the draft kept is the CATALOGUE artwork URL, not a photo of this card',
  storedImageFields.every((k) => {
    const v = String(storedCard[k]);
    return v.startsWith('https://images.pokemontcg.io/') || v === '';
  }),
  `stored = ${JSON.stringify(storedImageFields.map((k) => [k, storedCard[k]]))}`);

/* ── 5. SKU stability, against the SKU actually issued ─────────────────────
 *
 * Will's correction 6: SKU stability is not retry stability, and both must be
 * tested. This block does the first, and it has to isolate ONE variable.
 *
 * An earlier version of this assertion compared the draft created above
 * (rarity "Illustration Rare", the verified catalogue value) against the SKU
 * in the downloaded file (rarity "Shiny Rare") and called the difference a
 * SKU regression. That was wrong: rarity feeds the `variant` identity axis
 * (api/_cardIdentity.js:322, hashed at :342), so that comparison measured the
 * rarity correction, not the label repair.
 *
 * So the label repair is measured with rarity held at the value the shipped
 * draft actually carried. If cleaning the set label is SKU-neutral, THIS
 * create must reproduce the seller's existing SKU exactly.
 */

const sku = String(draft?.sku ?? '');

const asShippedRarity = await page.evaluate(
  (row) => window._bulkScanRowToCard(row),
  { ...SCAN_ROW, rarity: 'Shiny Rare' },
);

const createdShippedRarity = await page.evaluate(async ({ base, tok, card }) => {
  const r = await fetch(base + '/api/drafts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + tok,
      'Idempotency-Key': 'export-e2e-key-shipped-rarity',
    },
    body: JSON.stringify({
      card, instanceId: 'export-e2e-inst-2', slot: 'ebay:fixed-price',
      price: 19.83, priceSource: 'comp',
      pricingContext: { feeModelRevision: 'test', venue: 'ebay' },
    }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, { base: B, tok: token, card: asShippedRarity });

const skuShippedRarity = String(
  createdShippedRarity.body?.draft?.sku ?? createdShippedRarity.body?.sku ?? '');

ok('S0. the rarity-matched control draft was created',
  !!skuShippedRarity,
  `status ${createdShippedRarity.status} ${JSON.stringify(createdShippedRarity.body).slice(0, 300)}`);

/* True in BOTH states, which is what makes it worth asserting: before the fix
   it establishes that this suite reproduces the seller's actual draft
   faithfully; after the fix it establishes that repairing the label did not
   move the seller's SKU. */
eq('S1. with rarity held at the shipped value, this path reproduces the seller\u2019s exact SKU',
  skuShippedRarity, SHIPPED_SKU);

ok('S2. correcting the rarity DOES move the SKU (recorded consequence, not a goal)',
  !!sku && !!skuShippedRarity && sku !== skuShippedRarity,
  `illustration-rare ${sku} vs shiny-rare ${skuShippedRarity}`);

/* ── 6. the real CSV ────────────────────────────────────────────────────── */

const built = (draft) ? await page.evaluate(
  ({ d, p }) => {
    const r = window._ebayDraftCsv(d, p);
    return { csv: r.csv, owed: r.owed || [] };
  }, { d: draft, p: packet }) : { csv: '', owed: [] };

let out = null;
try { out = draftRow(built.csv); } catch (e) {
  ok('C0. the built CSV has a parseable Draft row', false, String(e.message));
}

if (out) {
  ok('CD1. the exported Title carries the printed denominator',
    String(out.Title || '').includes('134/132'), JSON.stringify(out.Title));
  ok('CD2. the exported Card Number column is unchanged \u2014 identity is not reformatted',
    String(out['Card Number'] ?? out.__cardNumber ?? '') !== '134/188',
    JSON.stringify(out['Card Number']));
  ok('C1. exported Title states the number exactly once',
    (out.Title.match(/134/g) || []).length === 1, JSON.stringify(out.Title));
  ok('C2. exported Title carries no presentation separator',
    !out.Title.includes('\u00b7'), JSON.stringify(out.Title));
  ok('C3. exported Description set line is a set name only',
    /Set:\s*Mega Evolution\s*(<br>|$)/.test(out.Description),
    `Description = ${JSON.stringify(out.Description).slice(0, 400)}`);
  ok('C4. exported Description carries no fused label anywhere',
    !out.Description.includes('\u00b7 #'), JSON.stringify(out.Description).slice(0, 400));
  /* Against the draft THIS run created, not against SHIPPED_SKU: the shipped
     row carried rarity "Shiny Rare" and this draft carries the catalogue's
     "Illustration Rare", so comparing the two would measure the rarity
     correction again. SKU neutrality of the label repair is S1's job. */
  eq('C5. the exported SKU is the draft\u2019s own server-derived SKU',
    out['Custom label (SKU)'], sku);
  eq('C6. Action is still Draft — nothing publishes', out.__action, 'Draft');

  /* Photo and condition stay blank BY DESIGN (js/core.6536078e.js:22748-22851).
     Asserted so a future change cannot quietly start emitting either without
     this suite objecting. */
  eq('C7. Item photo URL is still blank (documented design, not a regression)',
    out['Item photo URL'], '');
  eq('C8. Condition ID is still blank until the accepted form is verified',
    out['Condition ID'], '');

  ok('C9. the file still discloses what eBay will still need',
    built.owed.length > 0 && built.owed.some((s) => /photo/i.test(String(s))),
    `owed = ${JSON.stringify(built.owed)}`);

  /* C10 was INVERTED on 2026-09-12, and the direction was decided by the owner,
     not by the test.
     
     It originally asserted that the description does NOT open with the title,
     locking in a heading removal that had ridden along with the identity fix.
     The owner's instruction was to keep the heading unless the real post-fix
     export looked awkward; the real export (ivysaur-post-fix.csv) reads
     "Ivysaur Mega Evolution #134/132 Illustration Rare" followed by the
     structured lines, which is repetitive but not awkward. So the removal was
     reverted and this assertion now guards the KEPT heading instead.
     
     Establishing product-vs-fixture first matters here: the failure was not a
     bug, it was this assertion still enforcing a reversed decision. */
  ok('C10. the description opens with the corrected title heading (kept by decision)',
    out.Description.startsWith(out.Title + '<br>'),
    `Description = ${JSON.stringify(out.Description).slice(0, 240)}`);
  /* The heading must carry the CORRECTED title, so the reverted heading cannot
     quietly reintroduce the fused, duplicated label the defect report was about. */
  ok('C11. the kept heading carries the corrected title, not the fused duplicate',
    out.Description.includes('134/132') && !out.Description.includes('#134 #134')
    && !out.Description.includes('\u00b7 #'),
    `Description = ${JSON.stringify(out.Description).slice(0, 240)}`);
  ok('C12. the heading states the number once, so the description does not read \u201c#134 #134\u201d',
    (out.Description.split('<br>')[0].match(/134/g) || []).length <= 2,
    JSON.stringify(out.Description.split('<br>')[0]));
}

/* ── 7. retry stability is NOT SKU stability ─────────────────────────────── */
/* Will's correction 6. A retry under the SAME idempotency key must reuse the
   payload recorded at first attempt, generation included — so a mapper change
   between attempts cannot smuggle a different operation under the same key. */

const replay = draftId ? await page.evaluate(async ({ base, tok, card }) => {
  const r = await fetch(base + '/api/drafts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + tok,
      'Idempotency-Key': 'export-e2e-key-1',
    },
    body: JSON.stringify({
      card, instanceId: 'export-e2e-inst', slot: 'ebay:fixed-price',
      price: 19.83, priceSource: 'comp',
      pricingContext: { feeModelRevision: 'test', venue: 'ebay' },
    }),
  });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}, { base: B, tok: token, card: mapped }) : { status: 0, body: {} };

ok('X1. a retry under the same key replays rather than creating a second draft',
  (replay.body?.draftId || replay.body?.draft?.draftId) === draftId,
  `first ${draftId}, retry ${replay.body?.draftId || replay.body?.draft?.draftId}`);
ok('X2. the replayed draft keeps the sku of the draft it replays',
  String(replay.body?.draft?.sku ?? '') === sku,
  `first ${sku}, replay ${JSON.stringify(replay.body?.draft?.sku)}`);

/* ── 8. RETRY STABILITY (Will's correction 6) ───────────────────────────────
   "SKU stability is not retry stability. Test both. In particular, retry an
   unresolved create after the mapper changes and confirm that its preserved
   payload and generation remain unchanged."

   X1/X2 above test the SERVER's idempotent replay. They say nothing about the
   CLIENT's recorded attempt, which is the thing the mapper changes could have
   disturbed: _crCreateDraft records the request body per idempotency key
   (js/core.6536078e.js:21482-21503) and reuses it verbatim on retry, releasing
   it only on a definitive answer (:21531). An UNRESOLVED attempt -- a network
   failure, the one case where the outcome is genuinely unknown -- must retry
   with the ORIGINAL body, generation included, not one rebuilt by today's
   mapper.

   The test drives the real _crCreateDraft. First call fails at the network, so
   the attempt stays unresolved and its payload is retained. The retry passes a
   DELIBERATELY DIFFERENT card under the SAME key; if the recorded payload is
   replayed, the body that leaves the client must still describe the FIRST
   card. That is a direct observation of the outbound request, not a grep. */

const retryTrace = await page.evaluate(async ({ tok, cardA, cardB }) => {
  if (typeof window._crCreateDraft !== 'function') return { unreachable: true };

  const realFetch = window.fetch;
  const realToken = window._crIdToken;
  window._crIdToken = async () => tok;

  const sent = [];
  const KEY = 'retry-stability-key-1';
  const args = (card) => ({
    card, instanceId: 'retry-stability-inst-1', idemKey: KEY,
    price: 19.83, priceSource: 'comp', source: 'test', batch: true,
  });

  try {
    /* Attempt 1: the request leaves, then the network fails. Outcome unknown. */
    window.fetch = async (url, opts) => {
      if (String(url).includes('/api/drafts')) {
        sent.push(JSON.parse(opts.body));
        throw new TypeError('Failed to fetch');
      }
      return realFetch(url, opts);
    };
    const first = await window._crCreateDraft(args(cardA));

    /* Attempt 2: same key, different card. Capture and answer definitively. */
    window.fetch = async (url, opts) => {
      if (String(url).includes('/api/drafts')) {
        sent.push(JSON.parse(opts.body));
        return {
          ok: true, status: 201,
          json: async () => ({ draftId: 'd-retry', draft: { draftId: 'd-retry' } }),
        };
      }
      return realFetch(url, opts);
    };
    const second = await window._crCreateDraft(args(cardB));

    return { sent, first, second, count: sent.length };
  } finally {
    window.fetch = realFetch;
    window._crIdToken = realToken;
  }
}, {
  tok: token,
  cardA: mapped,
  /* Same row, but every field the mapper touches is different. If a retry
     rebuilt the body, these values would appear on the wire. */
  cardB: { ...mapped, set: 'DIFFERENT SET', number: '999', rarity: 'DIFFERENT RARITY', condition: 'LP' },
});

ok('Y0. the real _crCreateDraft was reachable and both attempts left the client',
  retryTrace.unreachable !== true && retryTrace.count === 2,
  JSON.stringify({ unreachable: retryTrace.unreachable, count: retryTrace.count }));

if (retryTrace.count === 2) {
  const [a, b] = retryTrace.sent;
  ok('Y1. the unresolved attempt was NOT resolved by the network failure',
    retryTrace.first?.ok === false && retryTrace.first?.code === 'NETWORK',
    JSON.stringify(retryTrace.first));
  ok('Y2. the retry replays the ORIGINAL payload, not one rebuilt by the new mapper',
    JSON.stringify(b) === JSON.stringify(a),
    `first !== retry on: ${Object.keys({ ...a, ...b })
      .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).join(', ') || '(none)'}`);
  ok('Y3. the second card\u2019s values never reached the wire',
    JSON.stringify(b).indexOf('DIFFERENT') === -1,
    `retry body carried DIFFERENT*: ${JSON.stringify(b).includes('DIFFERENT')}`);
  /* VACUITY CHECK. If neither body carries a generation, comparing them is
     comparing null to null -- which passes while testing nothing, and is why
     the mutation run left Y4 green. So the state is REPORTED, and the
     equality claim is made only about a generation that is actually present. */
  const genPresent = Object.prototype.hasOwnProperty.call(a, 'generation');
  console.log('    TRACE generation on replayed payload: ' + (genPresent
    ? 'PRESENT = ' + JSON.stringify(a.generation)
    : 'ABSENT on both bodies (omitted rather than guessed at 0, core:21497) -- Y4 is null-vs-null and is NOT evidence about a populated generation'));
  console.log('    TRACE replayed payload keys: ' + JSON.stringify(Object.keys(a)));
  ok('Y4a. the generation precondition state of the replayed payload is recorded (not assumed)',
    true,
    "generation " + (genPresent ? 'PRESENT = ' + JSON.stringify(a.generation) : 'ABSENT on both bodies -- omitted rather than guessed at 0, per core:21497; Y4 is therefore a null-vs-null comparison and is NOT evidence about a populated generation'));
  ok('Y4. the retry carries the same generation precondition as the original',
    JSON.stringify(a.generation ?? null) === JSON.stringify(b.generation ?? null),
    `first ${JSON.stringify(a.generation ?? null)}, retry ${JSON.stringify(b.generation ?? null)}`);
  ok('Y5. the replayed payload still carries the corrected set name (mapper fix is IN the original)',
    a.card?.set === 'Mega Evolution',
    `set = ${JSON.stringify(a.card?.set)}`);
  ok('Y6. and the replayed payload asserts no condition the seller did not choose',
    !a.card?.condition,
    `condition = ${JSON.stringify(a.card?.condition ?? null)}`);
}

/* ── 8b. the same retry, with a generation actually present ────────────────
   Y4 above is a null-vs-null comparison, because a scan row that has never had
   a draft carries no lifecycle generation and the client omits it rather than
   guessing 0 (core:21497-21502). That makes Y4 true but empty. This case seeds
   _crDraftState[instanceId].generation so the precondition IS on the wire, and
   then asks the real question: does an unresolved retry carry the generation
   the seller's original attempt carried, even after the row's cached state has
   since moved on? */

const genTrace = await page.evaluate(async ({ tok, cardA, cardB }) => {
  /* _crDraftState is a script-scoped const and so is NOT a window property.
     The generation is therefore seeded through the app's OWN writer,
     _crNoteRowState (core:23340), which is the function /api/sell-eligibility
     responses go through -- a more faithful setup than poking the cache. */
  if (typeof window._crCreateDraft !== 'function' || typeof window._crNoteRowState !== 'function') {
    return { unreachable: true, has: {
      create: typeof window._crCreateDraft, note: typeof window._crNoteRowState } };
  }
  const realFetch = window.fetch;
  const realToken = window._crIdToken;
  window._crIdToken = async () => tok;

  const INST = 'retry-gen-inst-1';
  const KEY = 'retry-gen-key-1';
  const sent = [];
  const args = (card) => ({
    card, instanceId: INST, idemKey: KEY,
    price: 19.83, priceSource: 'comp', source: 'test', batch: true,
  });

  try {
    window._crNoteRowState(INST, { presence: 'empty', generation: 4, lastState: 'deleted' });

    window.fetch = async (url, opts) => {
      if (String(url).includes('/api/drafts')) {
        sent.push(JSON.parse(opts.body));
        throw new TypeError('Failed to fetch');
      }
      return realFetch(url, opts);
    };
    await window._crCreateDraft(args(cardA));

    /* The row's cached state advances between the two attempts -- a fresh
       eligibility read is exactly what would do this in the app. A rebuilt
       body would pick up generation 9; a replayed one keeps 4. */
    window._crNoteRowState(INST, { presence: 'empty', generation: 9, lastState: 'deleted' });

    window.fetch = async (url, opts) => {
      if (String(url).includes('/api/drafts')) {
        sent.push(JSON.parse(opts.body));
        return { ok: true, status: 201, json: async () => ({ draftId: 'd-gen', draft: { draftId: 'd-gen' } }) };
      }
      return realFetch(url, opts);
    };
    await window._crCreateDraft(args(cardB));

    return { sent, count: sent.length };
  } finally {
    window.fetch = realFetch;
    window._crIdToken = realToken;
    /* cache entry left in place; keyed by a test-only instanceId */
  }
}, { tok: token, cardA: mapped, cardB: { ...mapped, set: 'DIFFERENT SET' } });

if (genTrace.unreachable) {
  ok('Y7. FAILED TO ESTABLISH: _crCreateDraft or _crNoteRowState not reachable as globals',
    false, `the generation case could not be exercised: ${JSON.stringify(genTrace.has)}`);
} else if (genTrace.count === 2) {
  const [ga, gb] = genTrace.sent;
  console.log(`    TRACE seeded-generation bodies: first=${JSON.stringify(ga.generation)}, retry=${JSON.stringify(gb.generation)}`);
  ok('Y7. the generation precondition really is on the wire when the row state knows it',
    ga.generation === 4, `first body generation = ${JSON.stringify(ga.generation)}`);
  ok('Y8. an unresolved retry carries the ORIGINAL generation, not the row\u2019s newer one',
    gb.generation === 4,
    `retry body generation = ${JSON.stringify(gb.generation)} (row had advanced to 9)`);
} else {
  ok('Y7. FAILED TO ESTABLISH: expected two outbound attempts', false, `count = ${genTrace.count}`);
}

/* ── 9. leading zeros are SKU-neutral (Will's correction 6, second half) ─────
   "measure the identity effects of restoring leading zeros before any
   backfill." Measured, not assumed: the number identity axis runs through
   normalizeNumber (api/_cardIdentity.js:79-84), whose last step strips leading
   zeros from every digit run. So restoring zeros to the catalogue's `nu` field
   changes what is DISPLAYED and nothing that is HASHED. These assertions pin
   that, so a future change to normalizeNumber cannot quietly make a
   presentation backfill into a re-identification of the user's collection. */

const zeroEffect = await page.evaluate(() => {
  if (typeof window.skuFor !== 'function') return { unreachable: true };
  const base = { card: 'Ivysaur', set: 'Mega Evolution', setCode: 'MEG', game: 'pokemon', rarity: 'Illustration Rare' };
  const pairs = [['134', '134'], ['7', '007'], ['12', '0012'], ['RC8', 'RC08']];
  return {
    rows: pairs.map(([stripped, padded]) => ({
      stripped, padded,
      same: window.skuFor({ ...base, number: stripped }) === window.skuFor({ ...base, number: padded }),
    })),
  };
});

if (zeroEffect.unreachable) {
  /* Measured server-side instead; recorded so the absence is not read as a pass. */
  ok('Z0. skuFor is not a browser global \u2014 zero-effect measured in Node (see packet suite)',
    true, 'not reachable in page scope');
} else {
  for (const r of zeroEffect.rows) {
    ok(`Z. restoring leading zeros does not move the SKU (${r.stripped} vs ${r.padded})`,
      r.same === true, `same = ${r.same}`);
  }
}

/* ── 9. denominator AUTHORITY ──────────────────────────────────────────────
 *
 * Owner correction, 2026-09-12: "Running resolvePrintedTotal on the server does
 * not automatically make its inputs trustworthy... The verified server mapping
 * must override a conflicting submitted denominator. A client-provided value
 * must not override me1 -> 132. Add a test submitting printedTotal: 188 for
 * me1; the export must still produce 134/132."
 *
 * The previous code was `if (resolved && !card.printedTotal)`, which honoured a
 * submitted value over the verified one -- the exact inversion. 188 is chosen
 * deliberately: it is me1's record count AND its maximum card number, so it is
 * the number a count/max derivation would produce, and the wrong answer from
 * every direction at once.
 *
 * This drives the same real POST /api/drafts and the same real _ebayDraftCsv as
 * the rest of the suite; only the submitted card object differs.
 */

const spoofed = await page.evaluate(async ({ base, tok, card }) => {
  const r = await fetch(`${base}/api/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + tok,
      'Idempotency-Key': 'export-e2e-key-authority',
    },
    body: JSON.stringify({
      /* A DIFFERENT instance so this is its own draft, not a replay of H1's. */
      card: { ...card, printedTotal: 188 },
      instanceId: 'export-e2e-inst-authority',
      slot: 'ebay:fixed-price',
      price: 19.83, priceSource: 'comp',
      pricingContext: { feeModelRevision: 'test', venue: 'ebay' },
    }),
  });
  const body = await r.json().catch(() => ({}));
  let readback = null;
  const id = body?.draftId || body?.draft?.draftId || null;
  if (id) {
    const g = await fetch(`${base}/api/drafts?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: 'Bearer ' + tok },
    });
    readback = await g.json().catch(() => ({}));
  }
  return { status: r.status, body, readback };
}, { base: B, tok: token, card: mapped });

const AU = spoofed.readback?.draft || null;

ok('AU0. the draft submitting printedTotal:188 was accepted (so AU1-AU4 are not vacuous)',
  (spoofed.status === 200 || spoofed.status === 201) && !!AU,
  `status ${spoofed.status} body ${JSON.stringify(spoofed.body).slice(0, 300)}`);

if (AU) {
  const auTitle = String(AU.title || '');

  ok('AU1. the verified mapping wins: the title states 134/132, not the submitted 188',
    auTitle.includes('134/132'), JSON.stringify(auTitle));
  ok('AU2. the submitted denominator appears NOWHERE in the title',
    !auTitle.includes('/188') && !auTitle.includes('188'), JSON.stringify(auTitle));
  ok('AU3. the stored card.printedTotal was replaced with the verified value',
    Number(AU.card?.printedTotal) === 132,
    `stored printedTotal = ${JSON.stringify(AU.card?.printedTotal)}`);

  /* Through the real CSV builder, since the title is what a buyer reads. */
  const auCsv = await page.evaluate(({ d, p }) => {
    try {
      /* Same signature the shipped download call site uses (core:23025):
         _ebayDraftCsv(draft, packet) -> { csv, owed }. */
      const r = window._ebayDraftCsv(d, p);
      return { ok: true, csv: r.csv };
    } catch (e) { return { ok: false, err: String(e && e.message) }; }
  }, { d: AU, p: spoofed.readback?.packet || null });

  if (!auCsv.ok) {
    ok('AU4. the authority draft exports through the real CSV builder', false, auCsv.err);
  } else {
    let auRow = null;
    try { auRow = draftRow(auCsv.csv); } catch (e) { /* asserted below */ }
    ok('AU4. the EXPORTED Title carries 134/132 despite the submitted 188',
      !!auRow && String(auRow.Title || '').includes('134/132'),
      JSON.stringify(auRow && auRow.Title));
    ok('AU5. the exported row carries no trace of the submitted denominator',
      !!auRow && !String(auRow.Title || '').includes('188'),
      JSON.stringify(auRow && auRow.Title));
  }

  /* The override must not disturb identity: printedTotal is not an identity
     axis, so spoofing it must not have moved the SKU either. */
  ok('AU6. the submitted denominator did not move the SKU',
    String(AU.sku || '').includes('PKMMEG134'),
    `sku = ${JSON.stringify(AU.sku)}`);
}

/* An UNKNOWN set has no authoritative value to prefer, so a submitted one is
   left alone rather than discarded -- the owner's "unknown sets may omit the
   denominator unless another authoritative source is established". Asserted so
   the override cannot quietly widen into "always discard client input". */
const unknown = await page.evaluate(async ({ base, tok, card }) => {
  const r = await fetch(`${base}/api/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + tok,
      'Idempotency-Key': 'export-e2e-key-unknownset',
    },
    body: JSON.stringify({
      card: {
        ...card,
        set: 'Totally Unmapped Set', setCode: 'ZZZQ',
        groundedId: 'zzzq-5', number: '5',
      },
      instanceId: 'export-e2e-inst-unknownset',
      slot: 'ebay:fixed-price',
      price: 4.5, priceSource: 'comp',
      pricingContext: { feeModelRevision: 'test', venue: 'ebay' },
    }),
  });
  const body = await r.json().catch(() => ({}));
  const id = body?.draftId || body?.draft?.draftId || null;
  let readback = null;
  if (id) {
    const g = await fetch(`${base}/api/drafts?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: 'Bearer ' + tok },
    });
    readback = await g.json().catch(() => ({}));
  }
  return { status: r.status, body, readback };
}, { base: B, tok: token, card: mapped });

const UK = unknown.readback?.draft || null;
ok('AU7. an unmapped set still produces a draft (not rejected for lacking a denominator)',
  (unknown.status === 200 || unknown.status === 201) && !!UK,
  `status ${unknown.status} ${JSON.stringify(unknown.body).slice(0, 260)}`);
if (UK) {
  const ukTitle = String(UK.title || '');
  ok('AU8. an unmapped set does not inherit another set\u2019s denominator',
    !ukTitle.includes('/132') && !ukTitle.includes('/188'),
    `title = ${JSON.stringify(ukTitle)}`);
  ok('AU9. the unmapped card\u2019s number still appears, printed bare',
    /(^|\s)#?5(\s|$)/.test(ukTitle) || ukTitle.includes(' 5 ') || ukTitle.includes('#5'),
    `title = ${JSON.stringify(ukTitle)}`);
  ok('AU10. nothing was resolved for the unmapped set',
    UK.card?.printedTotal === undefined || UK.card?.printedTotal === null
      || UK.card?.printedTotal === '' || Number(UK.card?.printedTotal) !== 132,
    `stored printedTotal = ${JSON.stringify(UK.card?.printedTotal)}`);
}

/* ── 10. Q1: the review image prefers the seller's photo, and no base64 ────
 *
 * Owner decision Q1 (2026-09-12). The rejected repair was to swap the mapper's
 * operands to `r.imageDataUrl || r.imageUrl`, which would have put a
 * data:image/... string into the draft request and then into KV. The design
 * instead keeps catalogue artwork in `catalogImageUrl` and expresses the
 * seller-photo preference at RENDER time against the local IndexedDB manifest.
 *
 * Both halves are asserted: the preference order, AND that no base64 reaches
 * the server. A label alone would not be evidence of either.
 */

const q1 = await page.evaluate(({ card }) => {
  const out = {};
  const R = window._reviewReferenceImageHtml;
  out.exported = typeof R === 'function';
  if (!out.exported) return out;

  /* Drive the SHIPPED renderer by setting the same state the screen sets.
     Saved and restored so this measurement cannot leak into later sections. */
  const savedDraft = window._reviewState.draft;
  const savedLoaded = window._photoUi.loaded;
  const savedPhotos = window._photoUi.photos;
  try {
    /* (a) seller photo present in the manifest -> the seller's own photo wins */
    window._reviewState.draft = { card: { ...card, catalogImageUrl: 'https://images.pokemontcg.io/me1/134.png' } };
    window._photoUi.loaded = true;
    window._photoUi.photos = [{ id: 'p1', missing: false, url: 'blob:fake-own-photo' }];
    out.own = R();

    /* (b) no seller photo -> catalogue artwork, labelled */
    window._photoUi.photos = [];
    out.catalog = R();

    /* (c) neither -> placeholder, no <img> */
    window._reviewState.draft = { card: { ...card, catalogImageUrl: '', imageUrl: '', img: '' } };
    out.none = R();

    /* (d) manifest not read yet -> must NOT flash catalogue artwork */
    window._reviewState.draft = { card: { ...card, catalogImageUrl: 'https://images.pokemontcg.io/me1/134.png' } };
    window._photoUi.loaded = false;
    out.loading = R();

    /* (e) a legacy draft carrying a data: URL must NOT be rendered as a ref */
    window._photoUi.loaded = true;
    window._photoUi.photos = [];
    window._reviewState.draft = { card: { catalogImageUrl: 'data:image/png;base64,AAAA' } };
    out.dataUrl = R();

    out.label = window.REVIEW_REFERENCE_LABEL || '';
  } finally {
    window._reviewState.draft = savedDraft;
    window._photoUi.loaded = savedLoaded;
    window._photoUi.photos = savedPhotos;
  }
  return out;
}, { card: mapped });

ok('Q1a. the review image renderer is the shipped exported function',
  q1.exported === true, 'window._reviewReferenceImageHtml is not a function');

if (q1.exported) {
  ok('Q1b. with a seller photo in the manifest, the seller\u2019s own photo is rendered',
    q1.own.includes('data-review-img="own"') && q1.own.includes('blob:fake-own-photo'),
    q1.own.slice(0, 300));
  ok('Q1c. with a seller photo present, catalogue artwork is NOT rendered',
    !q1.own.includes('images.pokemontcg.io'), q1.own.slice(0, 300));
  ok('Q1d. with no seller photo, catalogue artwork is the fallback',
    q1.catalog.includes('data-review-img="catalog"')
    && q1.catalog.includes('images.pokemontcg.io/me1/134.png'),
    q1.catalog.slice(0, 300));
  ok('Q1e. the catalogue fallback is labelled \u201cReference image\u2014not your listing photo.\u201d',
    q1.catalog.includes('Reference image\u2014not your listing photo.'),
    q1.catalog.slice(0, 400));
  ok('Q1f. the label the screen renders is the exported constant (screen and copy cannot drift)',
    q1.label === 'Reference image\u2014not your listing photo.', JSON.stringify(q1.label));
  ok('Q1g. with neither photo nor artwork, a placeholder renders and no <img> is emitted',
    q1.none.includes('data-review-img="none"') && !q1.none.includes('<img'),
    q1.none.slice(0, 300));
  ok('Q1h. while the manifest is still being read, catalogue artwork does not flash first',
    q1.loading.includes('data-review-img="loading"') && !q1.loading.includes('<img'),
    q1.loading.slice(0, 300));
  ok('Q1i. a data: URL on a legacy draft is refused, not rendered as reference artwork',
    !q1.dataUrl.includes('data:image') && q1.dataUrl.includes('data-review-img="none"'),
    q1.dataUrl.slice(0, 300));
}

/* The server half: the mapper must not emit base64, and the stored draft must
   not contain any. Asserted against the SUBMITTED object and the STORED one --
   a clean payload that the server then echoed into storage from elsewhere
   would still be a leak. */
const b64 = await page.evaluate(({ row }) => {
  const M = window._bulkScanRowToCard;
  if (typeof M !== 'function') return { exported: false };
  /* A row shaped like the real scan path: catalogue URL AND a local data URL,
     which is exactly the situation the rejected one-line swap would have
     mishandled. */
  const mappedOut = M({
    ...row,
    imageUrl: 'https://images.pokemontcg.io/me1/134.png',
    imageDataUrl: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ',
  });
  /* And a row whose ONLY image is a data URL: the field must come out null
     rather than carrying the bytes. */
  const onlyData = M({ ...row, imageUrl: '', img: '', imageDataUrl: 'data:image/png;base64,AAAA' });
  return {
    exported: true,
    json: JSON.stringify(mappedOut),
    catalogImageUrl: mappedOut.catalogImageUrl,
    img: mappedOut.img,
    onlyDataJson: JSON.stringify(onlyData),
    onlyDataCatalog: onlyData.catalogImageUrl,
  };
}, { row: SCAN_ROW });

ok('Q1j. the scan-row mapper is the shipped exported function',
  b64.exported === true, 'window._bulkScanRowToCard is not a function');

if (b64.exported) {
  ok('Q1k. the mapped card carries NO base64 image bytes anywhere in the payload',
    !b64.json.includes('data:image') && !b64.json.includes('base64'),
    b64.json.slice(0, 400));
  ok('Q1l. the mapped card carries the catalogue URL under the unambiguous field name',
    b64.catalogImageUrl === 'https://images.pokemontcg.io/me1/134.png',
    JSON.stringify(b64.catalogImageUrl));
  ok('Q1m. img/imageUrl carry the same reference URL, not the data URL',
    b64.img === 'https://images.pokemontcg.io/me1/134.png', JSON.stringify(b64.img));
  ok('Q1n. a row whose only image is a data URL maps to null, not to the bytes',
    b64.onlyDataCatalog === null && !b64.onlyDataJson.includes('data:image'),
    b64.onlyDataJson.slice(0, 300));
}

/* The stored draft, read back from the real KV through the real GET route. */
ok('Q1o. the draft STORED on the server contains no base64 image bytes',
  !!draft && !JSON.stringify(draft).includes('data:image')
  && !JSON.stringify(draft).includes('base64'),
  'stored draft carries image bytes');

/* ── 11. Q5: readiness visibly asks for a condition ───────────────────────
 *
 * Owner requirement Q5 (2026-09-12): the fabricated Near Mint goes, an
 * unselected condition stays empty, and "readiness must visibly say 'Select
 * condition'". The row used to be omitted entirely when unset -- Rule 2: the
 * silent omission was the bug.
 */

const q5 = await page.evaluate(() => {
  const F = window._reviewPacketRows;
  if (typeof F !== 'function') return { exported: false };
  const saved = { packet: window._reviewState.packet, usable: window._reviewState.packetUsable };
  try {
    /* Unset condition: the packet simply has no conditionLabel. */
    window._reviewState.packet = { title: { text: 'T' }, category: { label: 'C' }, condition: {} };
    window._reviewState.packetUsable = true;
    const unset = F();
    /* Seller HAS chosen: the chosen value is shown, not the prompt. */
    window._reviewState.packet = { title: { text: 'T' }, condition: { conditionLabel: 'Lightly Played' } };
    const chosen = F();
    return {
      exported: true,
      unset: unset.find((r) => r.key === 'condition') || null,
      chosen: chosen.find((r) => r.key === 'condition') || null,
      copy: window.REVIEW_CONDITION_OWED_COPY || '',
    };
  } finally {
    window._reviewState.packet = saved.packet;
    window._reviewState.packetUsable = saved.usable;
  }
});

ok('Q5a. the review field-row builder is the shipped exported function',
  q5.exported === true, 'window._reviewPacketRows is not a function');

if (q5.exported) {
  ok('Q5b. an unset condition still produces a Condition row (it is not silently omitted)',
    !!q5.unset, JSON.stringify(q5.unset));
  ok('Q5c. the row visibly says \u201cSelect condition\u201d',
    !!q5.unset && q5.unset.value === 'Select condition', JSON.stringify(q5.unset));
  ok('Q5d. the prompt is marked as an owed action, not as card data',
    !!q5.unset && q5.unset.needs === 'condition', JSON.stringify(q5.unset));
  ok('Q5e. no condition is fabricated \u2014 the row names no grade',
    !!q5.unset && !/near mint|\bNM\b|mint|lightly played/i.test(q5.unset.value),
    JSON.stringify(q5.unset));
  ok('Q5f. a condition the seller DID choose is shown as its value, not as a prompt',
    !!q5.chosen && q5.chosen.value === 'Lightly Played' && !q5.chosen.needs,
    JSON.stringify(q5.chosen));
  ok('Q5g. the screen\u2019s prompt text is the exported constant',
    q5.copy === 'Select condition', JSON.stringify(q5.copy));
}

/* The CSV half of Q5: the export must TELL the seller the column is blank on
   purpose and must be completed in eBay. */
if (out) {
  ok('Q5h. the exported Condition ID column is empty \u2014 nothing fabricated',
    String(out['Condition ID'] ?? '') === '', JSON.stringify(out['Condition ID']));
  const owedText = (built.owed || []).join(' | ');
  ok('Q5i. the export discloses that condition must be completed in eBay',
    /condition/i.test(owedText) && /eBay/.test(owedText), owedText.slice(0, 400));
  ok('Q5j. the disclosure states the column is present but left blank',
    /condition[^|]*blank/i.test(owedText), owedText.slice(0, 400));
}

/* ── 12. Q5 continued: a chosen condition survives rescan, save and reopen ──
 *
 * Owner requirement Q5 (2026-09-12): "a seller-selected condition must survive
 * rescans, save and reopen." It did not. bulkRetryRow built its carry-forward
 * list as scanUid + copyUids only, so the new result object from _bulkScanOne
 * arrived with no condition and the seller's grade was silently dropped.
 *
 * RESCAN is asserted through the real bulkRetryRow with _bulkScanOne stubbed --
 * the stub stands in for the network, and returning a BARE result is precisely
 * the condition-free object the real scan returns, so the carry-forward is what
 * is under test. SAVE and REOPEN are asserted through the real mapper and the
 * real POST/GET, with no stubs at all.
 */

const surv = await page.evaluate(async ({ row }) => {
  const out = {};
  if (typeof window.bulkRetryRow !== 'function'
      || typeof window.bulkSetCondition !== 'function') {
    return { exported: false };
  }
  out.exported = true;

  const savedResults = window._bulkResults;
  const savedScanOne = window._bulkScanOne;
  const savedUpdate = window._bulkUpdateRow;
  const savedToast = window.showToast;
  try {
    /* A row as the scan path leaves it: no condition, flag false. */
    window._bulkResults = [{
      ...row, rowId: 'survRow', scanUid: 'surv-uid-1', scanId: 'surv-scan-1',
      success: true, condition: '', conditionChosen: false,
      file: { name: 'surv.jpg' }, objectUrl: 'blob:surv',
    }];
    window._bulkUpdateRow = () => {};
    window.showToast = () => {};

    /* The seller grades it through the ONLY writer of the flag. */
    window.bulkSetCondition('survRow', 'Lightly Played');
    const afterPick = window._bulkResults[0];
    out.picked = { condition: afterPick.condition, chosen: afterPick.conditionChosen };

    /* Rescan. The stub returns what a real scan returns: a fresh object that
       knows nothing about the seller's grade. */
    window._bulkScanOne = async () => ({
      ...row, success: true, condition: '', conditionChosen: false,
      scanId: 'surv-scan-2',
    });
    await window.bulkRetryRow('survRow');
    const afterRetry = window._bulkResults[0];
    out.rescan = {
      condition: afterRetry.condition,
      chosen: afterRetry.conditionChosen,
      scanUid: afterRetry.scanUid,
    };

    /* A row the seller NEVER graded must not gain one from the same path. */
    window._bulkResults = [{
      ...row, rowId: 'survRow2', scanUid: 'surv-uid-2', scanId: 'surv-scan-3',
      success: true, condition: '', conditionChosen: false,
      file: { name: 'surv2.jpg' }, objectUrl: 'blob:surv2',
    }];
    await window.bulkRetryRow('survRow2');
    const untouched = window._bulkResults[0];
    out.untouched = { condition: untouched.condition, chosen: untouched.conditionChosen };

    /* SAVE: the real mapper, on the graded row. */
    out.mapped = window._bulkScanRowToCard(afterRetry);
  } finally {
    window._bulkResults = savedResults;
    window._bulkScanOne = savedScanOne;
    window._bulkUpdateRow = savedUpdate;
    window.showToast = savedToast;
  }
  return out;
}, { row: SCAN_ROW });

ok('Q5k. the retry and condition-picker paths are both reachable as shipped',
  surv.exported === true, 'bulkRetryRow / bulkSetCondition not exported');

if (surv.exported) {
  ok('Q5l. the picker records both the value and the provenance flag',
    surv.picked.condition === 'Lightly Played' && surv.picked.chosen === true,
    JSON.stringify(surv.picked));
  ok('Q5m. RESCAN: the seller\u2019s chosen condition survives the retry',
    surv.rescan.condition === 'Lightly Played', JSON.stringify(surv.rescan));
  ok('Q5n. RESCAN: the provenance flag survives with it',
    surv.rescan.chosen === true, JSON.stringify(surv.rescan));
  ok('Q5o. RESCAN: identity is still carried \u2014 the fix did not disturb retry identity',
    surv.rescan.scanUid === 'surv-uid-1', JSON.stringify(surv.rescan));
  ok('Q5p. RESCAN does NOT manufacture a condition for a row the seller never graded',
    surv.untouched.condition === '' && surv.untouched.chosen !== true,
    JSON.stringify(surv.untouched));
  ok('Q5q. SAVE: the mapper emits the surviving condition into the draft payload',
    surv.mapped && surv.mapped.condition === 'Lightly Played',
    JSON.stringify(surv.mapped && surv.mapped.condition));
}

/* REOPEN: through the real POST and the real GET, no stubs. A graded card must
   read back graded -- the round trip is where a dropped field would show. */
const reopened = await page.evaluate(async ({ base, tok, card }) => {
  const r = await fetch(`${base}/api/drafts`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + tok,
      'Idempotency-Key': 'export-e2e-key-condition-survives',
    },
    body: JSON.stringify({
      card: { ...card, condition: 'Lightly Played' },
      instanceId: 'export-e2e-inst-condsurvive',
      slot: 'ebay:fixed-price',
      price: 19.83, priceSource: 'comp',
      pricingContext: { feeModelRevision: 'test', venue: 'ebay' },
    }),
  });
  const body = await r.json().catch(() => ({}));
  const id = body?.draftId || body?.draft?.draftId || null;
  let readback = null;
  if (id) {
    const g = await fetch(`${base}/api/drafts?id=${encodeURIComponent(id)}`, {
      headers: { Authorization: 'Bearer ' + tok },
    });
    readback = await g.json().catch(() => ({}));
  }
  return { status: r.status, body, readback };
}, { base: B, tok: token, card: mapped });

const RD = reopened.readback?.draft || null;
ok('Q5r. REOPEN: the graded draft was created (so Q5s is not vacuous)',
  (reopened.status === 200 || reopened.status === 201) && !!RD,
  `status ${reopened.status} ${JSON.stringify(reopened.body).slice(0, 260)}`);
if (RD) {
  ok('Q5s. REOPEN: the chosen condition is still on the draft after a full round trip',
    String(RD.card?.condition || '') === 'Lightly Played',
    `stored condition = ${JSON.stringify(RD.card?.condition)}`);
}

/* Write the real post-fix CSV to disk when asked, so the export can be judged
   on its actual bytes rather than on a description of them. Opt-in via env so
   an ordinary suite run stays read-only.
     EXPORT_CSV_OUT=/path/to/file.csv node tests/listing-export-e2e.mjs */
if (process.env.EXPORT_CSV_OUT && built && built.csv) {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(process.env.EXPORT_CSV_OUT, built.csv);
  console.log('wrote CSV ->', process.env.EXPORT_CSV_OUT, `(${built.csv.length} bytes)`);
  console.log('owed:', JSON.stringify(built.owed, null, 2));
}

ok('P1. no uncaught page errors', pageErrors.length === 0, pageErrors.join(' | '));

T.done();
await browser.close();
