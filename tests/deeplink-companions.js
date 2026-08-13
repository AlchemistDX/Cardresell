#!/usr/bin/env node
// Regression tests for TCGplayer product-page deeplink + eBay sell companions
// Verifies: buildTcgpSmart, tcgp-resolve endpoint, gradedSellLink,
// jpEbaySellLink, scan-miss sell-flow link, tcgplayerUrl on port entries.

const fs = require('fs');
const path = require('path');

const INDEX  = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const RESOLVE = fs.readFileSync(path.join(__dirname, '..', 'api', 'tcgp-resolve.js'), 'utf8');

let pass = 0, fail = 0;
const check = (label, cond) => {
  const ok = !!cond;
  console.log(`  ${ok ? '\u2713' : '\u2717'} ${label}`);
  if (ok) pass++; else fail++;
};

console.log('\n[TCGplayer deeplink resolver]');
check('buildTcgpSmart function defined',                    /async function buildTcgpSmart\s*\(/.test(INDEX));
check('_tcgpProductIdFromUrl function defined',             /async function _tcgpProductIdFromUrl\s*\(/.test(INDEX));
check('Resolver calls /api/tcgp-resolve',                   /\/api\/tcgp-resolve\?url=/.test(INDEX));
check('Resolver caches to sessionStorage',                  /sessionStorage\.setItem\(cacheKey/.test(INDEX));
check('Falls back to buildTcgpUrl on failure',              /return buildTcgpUrl\(card\.name/.test(INDEX));

console.log('\n[tcgp-resolve API endpoint]');
check('Endpoint file exists',                               RESOLVE.length > 0);
check('Whitelists prices.pokemontcg.io only (SSRF safe)',   /prices\.pokemontcg\.io\/tcgplayer\//.test(RESOLVE));
check('Extracts numeric product ID from tcgplayer.com URL', RESOLVE.includes('tcgplayer.com/product/') && RESOLVE.includes('(\\d+)'));
check('Uses KV for 30-day cache',                           /tcgp-pid:/.test(RESOLVE) && /2592000/.test(RESOLVE));
check('Sets long CDN cache header',                         /s-maxage=2592000/.test(RESOLVE));
check('Rejects non-GET methods',                            /Method not allowed/.test(RESOLVE));

console.log('\n[Collection modal TCGplayer deeplink]');
check('Collection modal upgrades to product-page URL',      /buildTcgpSmart\(\{ tcgplayer: \{ url: p\.tcgplayerUrl \}/.test(INDEX));
check('Portfolio entries store tcgplayerUrl',               /tcgplayerUrl: cardTcgpUrl/.test(INDEX));
check('tcgplayerUrl sourced from selectedCard',             /selectedCard\.tcgplayer\?\.url/.test(INDEX));

console.log('\n[Sell-flow deeplink on updateSellLinks]');
check('updateSellLinks upgrades TCGplayer to product URL',  /buildTcgpSmart\(card\)\.then/.test(INDEX));

console.log('\n[eBay companion sell links]');
check('gradedSellLink element exists in HTML',              /id="gradedSellLink"/.test(INDEX));
check('gradedSellLink JS wires sell/listing URL',           /gradedSellLink[\s\S]{0,300}sell\/listing\?flow=startSell/.test(INDEX));
check('jpEbaySellLink element exists in HTML',              /id="jpEbaySellLink"/.test(INDEX));
check('jpEbaySellLink JS sets URL for both JP branches',    (INDEX.match(/jpEbaySellLink\.href = buildEbayUrl/g) || []).length >= 2);
check('Scan-miss panel has ebaySellUrl variable',           /const ebaySellUrl = /.test(INDEX));
check('Scan-miss panel renders "List on eBay" button',      /List on eBay \u2192/.test(INDEX));
check('Scan-miss sell URL uses sell/listing flow',          /sell\/listing\?flow=startSell&presetNameSearchQuery=\$\{ebayQ\}/.test(INDEX));

console.log('\n[Scan-miss UX bug fixes 2026-08-13]');
check('Scan-miss enriches pending.imageUrl from candidates',  /if \(!pending\.imageUrl\)/.test(INDEX));
check('Scan-miss fires doSearch to populate main view',      /doSearch\(name\)\.catch/.test(INDEX));
check('Scan-miss fallback thumbnail is NOT joker emoji',     !INDEX.includes('font-size:1.8rem">🃏'));
check('Scan-miss fallback thumbnail uses "?" (not 🃏)',       INDEX.includes('font-weight:900">?</div>'));

console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log(`Total: ${pass + fail} checks, ${fail} failure(s)`);
process.exit(fail > 0 ? 1 : 0);
