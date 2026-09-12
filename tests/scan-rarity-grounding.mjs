/**
 * Where the incorrect rarity entered — and that it no longer does.
 *
 * Will's instruction: "Trace where the incorrect rarity entered; do not
 * silently rewrite existing identities."
 *
 * THE TRACE. The exported CSV said `Rarity: Shiny Rare`. It did not come from
 * the supplemental catalogue: card-index.json record `me1-134` says
 * "Illustration Rare", and while "Shiny Rare" appears on 120 catalogue records
 * it appears on none in set me1. It did not come from pokemontcg.io either —
 * GET /v2/cards/me1-134 returns rarity "Illustration Rare" (verified twice in
 * session). It came from the VISION MODEL, and it survived because the
 * pokemontcg.io grounding pass filled rarity only when the model had left it
 * empty:
 *
 *     if (best.rarity && !cardInfo.rarity) cardInfo.rarity = best.rarity;
 *
 * Every sibling field in that same block — name, number, set name, set code —
 * already let the grounded record win, and the block's own comment claimed it
 * "OVERRIDE[s] set_name/rarity from the authoritative source". Only rarity
 * behaved differently, in three separate copies of the rule (the KV-cached
 * read, the fast path, and the grounding pass).
 *
 * These tests drive the REAL exported groundPokemonCardInfo against a stubbed
 * pokemontcg.io. They do not reconstruct the rule being tested.
 *
 * Run: NODE_PATH=/home/user/node_modules node tests/scan-rarity-grounding.mjs
 */

import { harness } from './_assert.mjs';

const { check, section, done } = harness('scan-rarity-grounding');

/* KV must be absent, or the function takes the cached branch and never reaches
   the HTTP grounding path. Deleting them makes the branch under test the one
   that runs. */
delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;

const { groundPokemonCardInfo } = await import('../api/scan.js');

/* The authoritative record for the card in the seller's export, as
   api.pokemontcg.io/v2/cards/me1-134 actually returns it. */
const ME1_134 = {
  id: 'me1-134',
  name: 'Ivysaur',
  number: '134',
  rarity: 'Illustration Rare',
  hp: '100',
  set: { id: 'me1', name: 'Mega Evolution', ptcgoCode: 'MEG', releaseDate: '2025/09/26' },
};

/* Stub pokemontcg.io. Every fetch returns the one record above, so the only
   variable across cases is what the vision model claimed. */
let calls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  calls += 1;
  if (String(url).includes('api.pokemontcg.io')) {
    return { ok: true, status: 200, json: async () => ({ data: [ME1_134] }) };
  }
  return { ok: false, status: 500, json: async () => ({}) };
};

const scanned = (rarity) => ({
  card_name: 'Ivysaur',
  card_number: '134',
  set_name: 'Mega Evolution',
  set_code: 'MEG',
  card_type: 'pokemon',
  is_japanese: false,
  rarity,
});

await section('the grounded record wins on rarity', async () => {
  /* THE REGRESSION CASE. This is the seller's card: the model said "Shiny
     Rare", the grounded record says "Illustration Rare". */
  const invented = scanned('Shiny Rare');
  await groundPokemonCardInfo(invented);

  check('the stub was actually reached (otherwise nothing below is evidence)', calls > 0, `fetch calls = ${calls}`);
  check('grounding ran and recorded the match', invented._grounded === true && invented._grounded_id === 'me1-134', JSON.stringify({ g: invented._grounded, id: invented._grounded_id }));
  check('an invented rarity is CORRECTED to the grounded one', invented.rarity === 'Illustration Rare', `rarity = ${JSON.stringify(invented.rarity)} (was "Shiny Rare")`);
  check('and it is specifically no longer the model\u2019s claim', invented.rarity !== 'Shiny Rare', String(invented.rarity));
});

await section('the rest of the grounded identity is unaffected', async () => {
  const c = scanned('Shiny Rare');
  await groundPokemonCardInfo(c);
  check('set name still comes from the grounded record', c.set_name === 'Mega Evolution', String(c.set_name));
  check('card name still comes from the grounded record', c.card_name === 'Ivysaur', String(c.card_name));
  check('the number is unchanged', String(c.card_number) === '134', String(c.card_number));
  check('the number was NOT fused with anything', !/[#/\u00b7]/.test(String(c.card_number)), String(c.card_number));
});

await section('an empty rarity is still filled', async () => {
  /* The old rule's ONE correct case must keep working: if the model said
     nothing, the grounded value is used. A fix that only ever overwrote would
     be no better than one that never did. */
  const blank = scanned('');
  await groundPokemonCardInfo(blank);
  check('a missing rarity is filled from the grounded record', blank.rarity === 'Illustration Rare', JSON.stringify(blank.rarity));
});

await section('a correct model rarity is not disturbed', async () => {
  const agreeing = scanned('Illustration Rare');
  await groundPokemonCardInfo(agreeing);
  check('a rarity that already agrees stays put', agreeing.rarity === 'Illustration Rare', JSON.stringify(agreeing.rarity));
});

await section('nothing is invented when grounding does not match', async () => {
  /* Will's standing rule: do not invent missing rarity. If the lookup returns
     no matching card, an absent rarity must stay absent rather than acquiring
     a default. */
  globalThis.fetch = async (url) => {
    if (String(url).includes('api.pokemontcg.io')) {
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    }
    return { ok: false, status: 500, json: async () => ({}) };
  };
  const unmatched = scanned('');
  await groundPokemonCardInfo(unmatched);
  const modelOnly = scanned('Shiny Rare');
  await groundPokemonCardInfo(modelOnly);
  check('an unmatched card gains no rarity', !unmatched.rarity, JSON.stringify(unmatched.rarity));
  check('an unmatched card is not marked grounded', unmatched._grounded !== true, String(unmatched._grounded));
  check('with no grounded record, the model\u2019s value is NOT silently discarded either', modelOnly.rarity === 'Shiny Rare', JSON.stringify(modelOnly.rarity));
});

/* ── the KV-CACHED branch ──────────────────────────────────────────────────
 *
 * Added after a mutation exposed a coverage gap, 2026-09-12. The rule lives in
 * THREE copies, and the sections above only ever reached one of them: the setup
 * deletes KV_REST_API_* precisely so the live HTTP branch runs, which means the
 * cached branch at api/scan.js was never executed by this suite.
 *
 * The gap was demonstrated, not assumed. Reverting the cached copy to the old
 * `if (cached.rarity && !cardInfo.rarity)` left this suite at 13 passed / 0
 * failed -- the defect could have been restored in that copy with every test
 * still green. That is the coverage hole, so it is closed here rather than
 * recorded as a caveat.
 *
 * KV is now PRESENT for these sections, and the stub answers the KV GET with a
 * cached record. That makes the cached branch the one that runs.
 */

process.env.KV_REST_API_URL = 'https://kv.example.invalid';
process.env.KV_REST_API_TOKEN = 'test-token-not-a-secret';

/* The cached record shape is the one the cache WRITES, which is not the raw
   pokemontcg.io shape: flat `number`/`set_name`/`set_code`, not a nested set. */
const CACHED_ME1_134 = {
  id: 'me1-134',
  name: 'Ivysaur',
  number: '134',
  set_name: 'Mega Evolution',
  set_code: 'MEG',
  rarity: 'Illustration Rare',
  hp: '100',
};

let kvReads = 0;
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.includes('kv.example.invalid')) {
    kvReads += 1;
    return { ok: true, status: 200, json: async () => ({ result: JSON.stringify(CACHED_ME1_134) }) };
  }
  /* If the cached branch is taken, this must never be reached. Returning a
     record here would let a cached-branch failure pass on the HTTP path's
     result, so it deliberately returns nothing usable. */
  return { ok: true, status: 200, json: async () => ({ data: [] }) };
};

await section('the cached branch is the one being exercised', async () => {
  kvReads = 0;
  const info = scanned('Shiny Rare');
  await groundPokemonCardInfo(info);
  check('the KV cache was actually read (otherwise the sections below test nothing)',
    kvReads > 0, `kvReads = ${kvReads}`);
  check('grounding came from the cache, not from an HTTP record',
    info._grounded_id === 'me1-134', `_grounded_id = ${JSON.stringify(info._grounded_id)}`);
});

await section('the CACHED record also wins on rarity', async () => {
  const info = scanned('Shiny Rare');
  await groundPokemonCardInfo(info);
  check('an invented rarity is CORRECTED from the cached record',
    info.rarity === 'Illustration Rare', `rarity = ${JSON.stringify(info.rarity)}`);
  check('and it is specifically no longer the model\u2019s claim',
    info.rarity !== 'Shiny Rare', `rarity = ${JSON.stringify(info.rarity)}`);
});

await section('the cached branch fills an empty rarity too', async () => {
  const info = scanned('');
  await groundPokemonCardInfo(info);
  check('an empty rarity is filled from the cached record',
    info.rarity === 'Illustration Rare', `rarity = ${JSON.stringify(info.rarity)}`);
});

await section('the cached branch invents nothing when the cache carries no rarity', async () => {
  const prev = CACHED_ME1_134.rarity;
  delete CACHED_ME1_134.rarity;
  try {
    const info = scanned('Shiny Rare');
    await groundPokemonCardInfo(info);
    /* No authoritative value exists, so the model's claim is LEFT ALONE rather
       than blanked. Overriding with nothing would destroy information on the
       strength of a cache miss. */
    check('a cache record without a rarity does not blank the scanned one',
      info.rarity === 'Shiny Rare', `rarity = ${JSON.stringify(info.rarity)}`);
  } finally {
    CACHED_ME1_134.rarity = prev;
  }
});

delete process.env.KV_REST_API_URL;
delete process.env.KV_REST_API_TOKEN;
globalThis.fetch = realFetch;

done();
