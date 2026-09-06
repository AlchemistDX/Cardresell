// tests/sell-eligibility.mjs
//
// D1's gate. The point of this suite is not that the boolean is right — it is
// that there is exactly ONE boolean, and the two places that consume it cannot
// drift apart. The Sell button is drawn from the stamp; the create refuses on
// the same rule. A test that only checked the stamp would let the create
// diverge and the failure would look like "the button does nothing".

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
  // The whole reason the stamp exists is to avoid a second copy of this rule.
  // If it ever disagrees with hasSufficientIdentity, the button promises a
  // create that then refuses — which is worse than no button.
  const rows = [
    CARD(),
    { ...CARD(), set_name: '' },
    { ...CARD(), card_number: '' },
    { ...CARD(), game: 'unknown' },
    { ...CARD(), game: '' },
    { game: 'mtg', set_name: 'Alpha', card_number: '1' },
    {},
  ];
  let agree = 0;
  for (const r of rows) {
    if (SELL.sellStamp(r).eligible === IDENT.hasSufficientIdentity(r)) agree++;
  }
  check('🔴 stamp and hasSufficientIdentity agree on all sample rows',
        agree === rows.length,
        `${rows.length - agree} disagreed — the button and the create would diverge`);
}

console.log('\nstampRows leaves the row otherwise untouched');
{
  const rows = [CARD(), { ...CARD(), set_name: '' }];
  const out  = SELL.stampRows(rows);
  check('every row is stamped', out.every((r) => r && r.sell));
  check('the first is eligible', out[0].sell.eligible === true);
  check('the second is not',    out[1].sell.eligible === false);
  check('🔴 the original rows are not mutated',
        rows[0].sell === undefined,
        'stamping in place would write the flag into the stored collection blob');
  check('the card fields survive', out[0].card_name === 'Charizard VMAX');
  check('a non-object row is passed through rather than crashing the list',
        SELL.stampRows([null, 'x'])[0] === null);
  check('a non-array is an empty list, not a throw', SELL.stampRows(null).length === 0);
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
  // This is the drift test. Same rows, both sides.
  const rows = [
    CARD(),
    { ...CARD(), set_name: '' },
    { ...CARD(), card_number: '' },
    { ...CARD(), game: 'unknown' },
  ];
  let agree = 0;
  for (const card of rows) {
    const stampSaysOk = SELL.sellStamp(card).eligible;
    let createSaysOk = true;
    try {
      EP.normalizeCreateInput({ card, instanceId: 'inst_1', slot: 'ebay:fixed-price', price: 10 });
    } catch (e) {
      // Only an identity refusal counts as the create saying "no" here.
      if (e.message.startsWith('DRAFT_FIELD_INVALID:card:')) createSaysOk = false;
      else throw e;
    }
    if (stampSaysOk === createSaysOk) agree++;
  }
  check('🔴 the button gate and the create gate never disagree',
        agree === rows.length,
        `${rows.length - agree} row(s) would show a Sell button whose create refuses`);
}

done();
