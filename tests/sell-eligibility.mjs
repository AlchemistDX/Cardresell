// tests/sell-eligibility.mjs
//
// D1's gate. The point of this suite is not that the boolean is right — it is
// that there is exactly ONE boolean, and the two places that consume it cannot
// drift apart. The Sell button is drawn from the stamp; the create refuses on
// the same rule. A test that only checked the stamp would let the create
// diverge and the failure would look like "the button does nothing".

import { readFileSync } from 'node:fs';
import { harness } from './_assert.mjs';

const { check, done } = harness('sell-eligibility');

const SELL  = await import('../api/_sellEligibility.js');
const IDENT = await import('../api/_cardIdentity.js');
const TITLE = await import('../api/_listingTitle.js');
const EP    = await import('../api/drafts.js');

const CARD = () => ({
  game: 'pokemon', set_name: 'Champions Path', card_number: '074/073',
  card_name: 'Charizard VMAX', rarity: 'Secret Rare', language: 'en',
});

console.log('\na complete card is sellable');
{
  const st = SELL.sellStamp(CARD());
  check('eligible', st.eligible === true);
  check('nothing is named as missing', st.missing.length === 0);
  check('and no message is invented for a card that is fine', st.message === null);
}

console.log('\nthe stamp names what is missing, and does not count it');
for (const [drop, code] of [
  ['set_name',    SELL.SELL_BLOCKED.NO_SET],
  ['card_number', SELL.SELL_BLOCKED.NO_NUMBER],
]) {
  const row = CARD(); delete row[drop];
  const st = SELL.sellStamp(row);
  check(`missing ${drop} blocks the sell entry point`, st.eligible === false);
  check(`and names it as ${code}`, st.missing.includes(code));
  check(`and carries a sentence a seller can act on`,
        typeof st.message === 'string' && st.message.length > 0);
}

console.log('\nmore than one missing axis is listed, not summarised');
{
  const row = CARD(); delete row.set_name; delete row.card_number;
  const st = SELL.sellStamp(row);
  check('🔴 both axes are named', st.missing.length === 2,
        '"2 fields missing" makes the seller hunt; naming them is actionable');
}

console.log('\nno row at all is a refusal, not a crash');
for (const bad of [null, undefined, 'charizard', 42, []]) {
  const st = SELL.sellStamp(bad);
  check(`${JSON.stringify(bad)} is not eligible`, st.eligible === false);
  check(`and still produces a message`, typeof st.message === 'string');
}

console.log('\nan unknown reason code still yields a sentence');
check('🔴 a code this module does not recognise never reaches a seller raw',
      !SELL.sellBlockedMessage('SELL_SOMETHING_NEW').includes('SELL_'),
      'showing a raw code is a screen that made the seller guess');

console.log('\nthe stamp agrees with the packet builder, on every shape');
{
  // The stamp exists to avoid a second copy of this rule, but the implication
  // runs ONE WAY only, and pretending otherwise is what shipped the nameless
  // dead button. hasSufficientIdentity answers "can this be a SKU" (three
  // axes). The stamp answers "can this be LISTED", which additionally needs a
  // name for the title. So eligible ⟹ hasSufficientIdentity, and never the
  // reverse. The earlier version of this test asserted equality and passed,
  // which is precisely how a nameless card was stamped eligible.
  const rows = [
    CARD(),
    { ...CARD(), set_name: '' },
    { ...CARD(), card_number: '' },
    { ...CARD(), game: 'unknown' },
    { ...CARD(), game: '' },
    { game: 'mtg', set_name: 'Alpha', card_number: '1' },
    {},
  ];
  rows.push({ game: 'pokemon', set_name: 'Champions Path', card_number: '074/073' });
  let agree = 0;
  for (const r of rows) {
    // eligible must never exceed SKU sufficiency; it may be stricter.
    if (!SELL.sellStamp(r).eligible || IDENT.hasSufficientIdentity(r)) agree++;
  }
  check('🔴 eligible never claims more than hasSufficientIdentity allows',
        agree === rows.length,
        `${rows.length - agree} disagreed — the button and the create would diverge`);
}

console.log('\nstampList returns one stamp per position, malformed rows included');
{
  const rows = [CARD(), { ...CARD(), set_name: '' }];
  const out  = SELL.stampList(rows);
  check('the first is eligible', out[0].eligible === true);
  check('the second is not',    out[1].eligible === false);
  check('🔴 the original rows are not mutated',
        rows[0].sell === undefined,
        'stamping in place would write the flag into the stored collection blob');
  check('a non-array is an empty list, not a throw', SELL.stampList(null).length === 0);

  // The regression this replaced: stampRows() passed non-objects through
  // unstamped, and its only caller read row.sell — undefined for those
  // positions — then substituted {eligible:false, missing:[], message:null}.
  // A refusal with no reason is the one thing this module must never emit.
  const bad = SELL.stampList([null, undefined, 'x', 5, [], CARD()]);
  // null/undefined/string/number are "not a row at all" — SELL_NEEDS_CARD.
  check('🔴 non-row positions are refused as SELL_NEEDS_CARD with a sentence',
        bad.slice(0, 4).every((s) => s.eligible === false
          && s.missing[0] === 'SELL_NEEDS_CARD' && typeof s.message === 'string' && s.message),
        JSON.stringify(bad.slice(0, 4)));
  // An empty array IS typeof object, so it is treated as a row with no fields
  // and refused for its missing axes. Different reason, still a reason.
  check('an empty array is refused for its missing axes, not silently',
        bad[4].eligible === false && bad[4].missing.length > 0 && !!bad[4].message,
        JSON.stringify(bad[4]));
  check('positions are preserved, so the last good row is still eligible',
        bad[5].eligible === true);
  check('🔴 no stamp anywhere is an unexplained refusal',
        bad.every((s) => s.eligible === true || (s.missing.length > 0 && s.message)),
        'a missing button with no sentence is exactly the reason contract failing');
}

console.log('\na card with no name is refused by the gate, not by the title builder');
{
  // The row the review supplied: game, set and number all present, no name.
  // hasSufficientIdentity() said yes (a SKU needs only the three axes), the
  // title builder says NO_CARD_NAME, so the seller got a button that refused.
  const nameless = { game: 'pokemon', set_name: 'Champions Path', card_number: '074/073' };
  const st = SELL.sellStamp(nameless);
  check('🔴 the supplied nameless row is NOT eligible', st.eligible === false, JSON.stringify(st));
  check('the reason names the name', st.missing[0] === 'SELL_NEEDS_CARD_NAME');
  check('and it has an actionable sentence', !!st.message && /name/i.test(st.message));

  // Each accepted spelling individually, as asked. A gate that recognises only
  // one of three spellings refuses real cards saved under the other two.
  for (const k of ['card', 'card_name', 'name']) {
    const row = { ...nameless, [k]: 'Charizard VMAX' };
    check(`'${k}' alone satisfies the name axis`, SELL.sellStamp(row).eligible === true);
  }
  // Whitespace is not a name.
  for (const v of ['', '   ', '\n']) {
    check(`a name of ${JSON.stringify(v)} does not count`,
          SELL.sellStamp({ ...nameless, card: v }).eligible === false);
  }
  check('the gate and the title builder read the same alias list',
        ['card', 'card_name', 'name'].every((k) =>
          IDENT.displayNameOf({ [k]: 'X' }) === 'X'));

  // The three axes hasSufficientIdentity owns still imply each other, so the
  // SKU rule and the sell gate stay aligned without being the same function.
  check('🔴 hasSufficientIdentity still implies the three axes it owns',
        IDENT.hasSufficientIdentity(nameless) === true
        && SELL.missingIdentityAxes(nameless).every((m) => m === 'SELL_NEEDS_CARD_NAME'),
        'name is a listing requirement, not a SKU requirement — that is the point');
}

console.log('\nthe eligibility wire schema cannot drift from what the server reads');
{
  // S3: the client sends an allowlist now. An allowlist fails silently — drop a
  // field the server reads and a good card goes ineligible with no visible
  // cause — so this comparison is the mitigation, not a nicety.
  const core = readFileSync(new URL('../js/core.569ff536.js', import.meta.url), 'utf8');
  const m = core.match(/const CR_SELL_WIRE_FIELDS = \[([\s\S]*?)\];/);
  check('the client declares a wire field list', !!m);
  const clientFields = [...(m ? m[1] : '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
  const server = IDENT.IDENTITY_WIRE_FIELDS;

  const missingOnClient = server.filter((f) => !clientFields.includes(f));
  const extraOnClient   = clientFields.filter((f) => !server.includes(f));
  check('🔴 the client carries every field the server reads',
        missingOnClient.length === 0,
        `client would drop ${JSON.stringify(missingOnClient)} — those cards go quietly ineligible`);
  check('🔴 and sends nothing the server does not read',
        extraOnClient.length === 0,
        `client sends unread ${JSON.stringify(extraOnClient)}`);

  const vm = core.match(/const CR_SELL_WIRE_VERSION = (\d+);/);
  check('both sides declare the same schema version',
        !!vm && Number(vm[1]) === IDENT.SELL_WIRE_SCHEMA_VERSION);

  // Every recognised alias spelling must be on the wire, or the conflict
  // detector on the server can never see the spelling that conflicts.
  const aliasKeys = IDENT.IDENTITY_ALIAS_GROUPS.flatMap((g) => g.keys);
  check('🔴 every alias spelling the server recognises is carried',
        aliasKeys.every((k) => server.includes(k) && clientFields.includes(k)),
        JSON.stringify(aliasKeys.filter((k) => !clientFields.includes(k))));

  // And the projection still cannot change a verdict.
  const rows = [CARD(), { ...CARD(), img: 'x'.repeat(5000), notes: 'private' }];
  check('projection does not alter any stamp',
        JSON.stringify(SELL.sellStamp(IDENT.projectIdentityForWire(rows[1])))
        === JSON.stringify(SELL.sellStamp(rows[1])));
  check('and it strips the photo and the notes',
        IDENT.projectIdentityForWire(rows[1]).img === undefined
        && IDENT.projectIdentityForWire(rows[1]).notes === undefined);
}

console.log('\nboth client row shapes are accepted without translation');
{
  // The Collection row (saved) spells these card/set/number. The live scan
  // panel object spells them name/setName/number. Neither client should have to
  // rewrite a row on its way to the server, so the server reads both.
  const saved = { game: 'pokemon', card: 'Charizard VMAX', set: 'Champions Path', number: '074/073', rarity: 'Secret Rare' };
  const live  = { game: 'pokemon', name: 'Charizard VMAX', setName: 'Champions Path', number: '074/073', rarity: 'Secret Rare' };

  check('the saved Collection row shape is sellable', SELL.sellStamp(saved).eligible === true);
  check('🔴 the live scan panel row shape is sellable too',
        SELL.sellStamp(live).eligible === true,
        'if this fails, the Sell button never appears on a fresh scan');

  const t1 = TITLE.buildListingTitle(saved, { maxLength: 80 });
  const t2 = TITLE.buildListingTitle(live,  { maxLength: 80 });
  check('a title builds from the saved shape', t1.ok === true);
  check('🔴 a title builds from the live shape as well', t2.ok === true,
        `reason: ${t2.reason} — a Sell button whose create dies on NO_CARD_NAME`);
  check('and both produce the same title', t1.title === t2.title);

  // The widened reads are display-only plus a set-axis fallback. A row that was
  // already identifiable must keep its SKU, or existing drafts orphan.
  check('🔴 setCode still wins over any set name spelling',
        IDENT.skuFor({ ...saved, setCode: 'swsh35' }) === IDENT.skuFor({ ...live, setCode: 'swsh35' }),
        'the stable machine id must not be displaced by a display string');
  check('a display name is not part of the SKU',
        IDENT.skuFor(saved) === IDENT.skuFor({ ...saved, card: 'Charizard VMAX (Alt Art)' }));
}

console.log('\nthe create refuses exactly what the stamp refuses');
{
  // The drift test. Same rows, both sides.
  //
  // The earlier version of this passed only `{card, instanceId, slot, price}`
  // and proved parity for IDENTITY alone. That was too weak to be the contract
  // it claimed to be: the stamp can say "eligible" while the create refuses on
  // a field the stamp never looks at. The payload below is the one
  // startListingDraft actually builds, priceSource included.
  const rows = [
    CARD(),
    { ...CARD(), set_name: '' },
    { ...CARD(), card_number: '' },
    { ...CARD(), game: 'unknown' },
    { ...CARD(), card_name: 'Blastoise', name: 'Charizard' },   // alias conflict
    { ...CARD(), number: '004/102', card_number: '074/073' },   // conflicting numbers
  ];
  let agree = 0;
  for (const card of rows) {
    const stampSaysOk = SELL.sellStamp(card).eligible;
    let createSaysOk = true;
    try {
      EP.normalizeCreateInput({ card, instanceId: 'inst_1', slot: 'ebay:fixed-price',
                                price: 10, priceSource: 'comp' });
    } catch (e) {
      if (e.message.startsWith('DRAFT_FIELD_INVALID:card:')) createSaysOk = false;
      else throw e;
    }
    if (stampSaysOk === createSaysOk) agree++;
  }
  check('🔴 the button gate and the create gate never disagree',
        agree === rows.length,
        `${rows.length - agree} row(s) would show a Sell button whose create refuses`);
}

console.log('\nevery payload D1 can actually build is accepted');
{
  // D1's payload space is small and fully enumerable, which is the only reason
  // this can be proved rather than sampled: slot is the CR_D1_SLOT constant,
  // price is guarded `> 0` on the client before the call, and priceSource is
  // 'seller' or 'comp' and is never defaulted.
  const eligible = CARD();
  check('the row used here is genuinely eligible', SELL.sellStamp(eligible).eligible);

  const payloads = [];
  for (const priceSource of ['seller', 'comp']) {
    for (const price of [0.01, 1, 10, 400, 99999.99]) {
      payloads.push({ card: eligible, instanceId: 'inst_scan_x', slot: 'ebay:fixed-price',
                      price, priceSource });
    }
  }
  let ok = 0, firstErr = '';
  for (const pl of payloads) {
    try { EP.normalizeCreateInput(pl); ok++; }
    catch (e) { if (!firstErr) firstErr = `${e.message} for ${JSON.stringify({ p: pl.price, s: pl.priceSource })}`; }
  }
  check('🔴 eligible ⟹ the create accepts every price/source pair D1 can send',
        ok === payloads.length, firstErr);
}

console.log('\nthe refusals D1 cannot trigger are still refusals');
{
  // Proving the create is strict about the fields D1 happens to get right is
  // what stops a future caller from getting them wrong quietly.
  const base = { card: CARD(), instanceId: 'inst_1', slot: 'ebay:fixed-price',
                 price: 10, priceSource: 'comp' };
  const refuses = (o) => {
    try { EP.normalizeCreateInput(o); return null; } catch (e) { return e.message; }
  };
  check('an unrecognised priceSource is refused, not coerced',
        refuses({ ...base, priceSource: 'vibes' }) === 'DRAFT_FIELD_INVALID:priceSource:unrecognised');
  check('a negative price is refused', /price:negative/.test(refuses({ ...base, price: -1 }) || ''));
  check('a non-numeric price is refused', /price:not-a-number/.test(refuses({ ...base, price: NaN }) || ''));
  check('a client-supplied sku is still refused',
        /sku:derived-from-card/.test(refuses({ ...base, sku: 'v2-AAA-0000000000000000' }) || ''));

  // normalizeCreateInput still accepts $0 and an unsupported slot; per the
  // review, those belong to the slot registry and must not be duplicated here.
  // What IS refused here now is a provenance claim with nothing to describe:
  // priceSource without a price. An unpriced draft is legal (B2) and makes no
  // claim about where its absent number came from.
  check('$0 with no source passes normalize; the slot rules are its gate',
        !refuses({ ...base, price: 0, priceSource: undefined }));
  check('🔴 but a priceSource with no price is refused as an empty claim',
        /priceSource:no-price/.test(refuses({ ...base, price: 0, priceSource: 'comp' }) || ''));
  check('🔴 and an unpriced draft with no source is allowed to exist',
        !refuses({ ...base, price: undefined, priceSource: undefined }));
  check('note: an unsupported slot passes normalize and is caught later',
        refuses({ ...base, slot: 'etsy:fixed-price' }) === null,
        'if this now fails, normalize got stricter — good, update the note');
}

console.log('\naliases may differ in spelling, never in meaning');
{
  const conflicted = (r) => SELL.sellStamp(r).missing[0] === SELL.SELL_BLOCKED.CONFLICT;
  const base = CARD();

  check('two spellings of the card name disagreeing is refused',
        conflicted({ ...base, card_name: 'Blastoise', name: 'Charizard' }));
  check('two spellings of the set disagreeing is refused',
        conflicted({ ...base, set: 'Base Set', setName: 'Champions Path' }));
  check('two spellings of the number disagreeing is refused',
        conflicted({ ...base, number: '004/102', card_number: '074/073' }));
  check('two spellings of the language disagreeing is refused',
        conflicted({ ...base, language: 'en', lang: 'ja' }));
  check('two spellings of the cert disagreeing is refused',
        conflicted({ ...base, cert: '12345678', certNumber: '87654321', grader: 'PSA', grade: '10' }));
  check('game and cardType disagreeing is refused',
        conflicted({ ...base, game: 'pokemon', cardType: 'magic' }));

  // The false positives that would have made this feature unshippable.
  check('a set CODE and a set NAME are not a conflict',
        !conflicted({ ...base, setCode: 'CPA', set: 'Champions Path' }),
        'a machine code and a display name are different fields, not two spellings');
  check('pokemonjp against cardType pokemon is not a conflict',
        !conflicted({ ...base, game: 'pokemonjp', cardType: 'pokemon' }));
  check('spellings that normalize equal are not a conflict',
        !conflicted({ ...base, card_name: 'Pokémon-EX', name: 'pokemon ex' }));
  check('an empty alias is not an assertion and cannot conflict',
        !conflicted({ ...base, card_name: 'Charizard VMAX', name: '' }));

  // Ordering invariance. This is the property that makes the refusal honest:
  // if the answer depended on key order, "conflict" would just mean "the reads
  // happened in an unlucky sequence".
  const keys = ['card', 'card_name', 'name'];
  const vals = { card: 'Blastoise', card_name: 'Charizard', name: 'Pikachu' };
  const perms = [[0,1,2],[0,2,1],[1,0,2],[1,2,0],[2,0,1],[2,1,0]];
  const answers = new Set(perms.map((order) => {
    const row = { ...base };
    for (const k of keys) delete row[k];
    for (const i of order) row[keys[i]] = vals[keys[i]];
    return JSON.stringify(SELL.sellStamp(row));
  }));
  check('🔴 alias ordering cannot change the answer',
        answers.size === 1, `${answers.size} different verdicts across key orderings`);
}

console.log('\nthe HTTP endpoint preserves every reason, including for malformed rows');
{
  // A real handler invocation. Only the network is stubbed (Google tokeninfo
  // and the KV uid lookup); the policy, the routing and the response shape are
  // the shipped ones. The bug this covers lived in the endpoint file itself and
  // was invisible to every module-level test: stampRows() passed non-objects
  // through unstamped, and the endpoint substituted an empty refusal for them.
  process.env.KV_REST_API_URL   = process.env.KV_REST_API_URL   || 'https://kv.test';
  process.env.KV_REST_API_TOKEN = process.env.KV_REST_API_TOKEN || 'tok';

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes('oauth2.googleapis.com/tokeninfo')) {
      return { ok: true, json: async () => ({
        aud: 'cardresell-e0329', email: 'seller@example.com',
        email_verified: true, name: 'Seller',
      }) };
    }
    if (u.includes('/get/')) return { ok: true, json: async () => ({ result: 'uid_test_1' }) };
    return { ok: true, json: async () => ({}) };
  };

  const { default: handler } = await import('../api/sell-eligibility.js');
  const call = async (body) => {
    let code = 0; let payload = null;
    const res = {
      setHeader() {}, end() { return res; },
      status(c) { code = c; return res; },
      json(p) { payload = p; return res; },
    };
    await handler({ method: 'POST', headers: { authorization: 'Bearer t' }, body }, res);
    return { code, payload };
  };

  const good = CARD();
  const { code, payload } = await call({ rows: [good, null, 'x', 7, { game: 'pokemon' }] });
  check('the endpoint answers 200', code === 200, String(code));
  check('one stamp per row, positionally', payload && payload.stamps.length === 5);
  check('the good row is eligible', payload.stamps[0].eligible === true);

  for (const i of [1, 2, 3]) {
    const s = payload.stamps[i];
    check(`🔴 malformed row ${i} is refused as SELL_NEEDS_CARD over HTTP`,
          s.eligible === false && s.missing[0] === 'SELL_NEEDS_CARD',
          JSON.stringify(s));
    check(`🔴 malformed row ${i} still carries an actionable sentence`,
          typeof s.message === 'string' && s.message.length > 0,
          'this is the exact regression: an unexplained missing button');
  }
  check('a sparse row is refused for its own missing axes',
        payload.stamps[4].eligible === false
        && payload.stamps[4].missing[0] !== 'SELL_NEEDS_CARD'
        && !!payload.stamps[4].message,
        JSON.stringify(payload.stamps[4]));
  check('🔴 no stamp in the HTTP response is a refusal without a reason',
        payload.stamps.every((s) => s.eligible || (s.missing.length && s.message)));

  // And the nameless row (B1) over the wire, which is where a seller meets it.
  const nameless = { game: 'pokemon', set_name: 'Champions Path', card_number: '074/073' };
  const r2 = await call({ rows: [nameless] });
  check('🔴 the nameless row is refused over HTTP too',
        r2.payload.stamps[0].eligible === false
        && r2.payload.stamps[0].missing[0] === 'SELL_NEEDS_CARD_NAME',
        JSON.stringify(r2.payload.stamps[0]));

  // The projection the client actually sends must not change any verdict.
  const projected = await call({ rows: [IDENT.projectIdentityForWire(good)] });
  check('a wire-projected row gets the same verdict as the full row',
        JSON.stringify(projected.payload.stamps[0]) === JSON.stringify(payload.stamps[0]));

  globalThis.fetch = realFetch;
}


// ── S2: one transport, and the comment that describes it is true ──────────
// The second review caught a header comment claiming scan responses were
// stamped by api/scan.js. They never were. A false description of where a
// check happens survives review indefinitely because it reads like a fact, so
// the claim is now pinned to the code rather than to my memory of it.
console.log('\nboth Sell entry points ask the one endpoint');
{
  const scanSrc = readFileSync(new URL('../api/scan.js', import.meta.url), 'utf8');
  check('\ud83d\udd34 api/scan.js does not stamp eligibility',
        !/_sellEligibility|sellStamp|stampList/.test(scanSrc),
        'if scan.js starts stamping there are two transports — fine — but the '
        + 'endpoint header describes one, so update it in the same commit');

  const clientSrc = readFileSync(new URL('../js/core.569ff536.js', import.meta.url), 'utf8');
  // The scan panel path.
  check('the scan panel asks the endpoint',
        /applySellGate\(card\)/.test(clientSrc) && /fetchSellStamps\(\[card\]\)/.test(clientSrc));
  // The collection path.
  check('the collection table asks the same endpoint',
        /hydrateCollectionSellButtons/.test(clientSrc)
        && /const res = await fetchSellStamps\(rows\)/.test(clientSrc));
  // One transport function, so one place the rule is fetched from.
  const fetches = clientSrc.match(/fetch\('\/api\/sell-eligibility'/g) || [];
  check('\ud83d\udd34 and there is exactly one place that request is made',
        fetches.length === 1, `${fetches.length} call sites — a second one drifts`);

  // No client-side reimplementation of the rule sneaking back in.
  // Comments are stripped first. The D1 block CONTAINS the four-token
  // shortcut inside a comment explaining why it must not be written, and a
  // grep over prose would fail on the warning against the thing it warns
  // about. Strip comments, then look for real code.
  // Start at the banner's OPENING /*, not at the banner text: slicing mid
  // comment leaves an unpaired opener, the stripper mispairs on the first */
  // it finds, and the rest of the banner survives as if it were code.
  const _at = clientSrc.indexOf('D1 — THE LISTING DRAFT ENTRY POINT');
  const d1raw = clientSrc.slice(clientSrc.lastIndexOf('/*', _at));
  const d1 = d1raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  check('the comment stripper left real code behind', d1.length > 5000, String(d1.length));
  check('\ud83d\udd34 the client never decides sufficiency itself',
        !/game\s*&&\s*set\s*&&\s*(number|card_number)/.test(d1),
        'that four-token shortcut is the second implementation this module exists to prevent');

  // And the endpoint header no longer asserts the thing that was false.
  const epSrc = readFileSync(new URL('../api/sell-eligibility.js', import.meta.url), 'utf8');
  // The false sentence still appears in the file — quoted, inside the
  // correction that retracts it. What must not exist is an ASSERTION of it.
  // So: every occurrence has to be a quotation.
  const claims = epSrc.match(/[^\n]*stamped server-side on the way out[^\n]*/g) || [];
  check('\ud83d\udd34 the endpoint header no longer asserts that scan.js stamps',
        claims.length > 0 && claims.every((l) => /were "stamped|\bwas never true|CORRECTION/.test(l)
                                              || /^\/\/ results were "/.test(l.trim())),
        JSON.stringify(claims));
  check('\ud83d\udd34 and the retraction is recorded rather than quietly deleted',
        /CORRECTION \(D1 second review\)/.test(epSrc)
        && /does not import _sellEligibility and does not/.test(epSrc));
}


done();
