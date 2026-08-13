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
check('Scan-miss no longer uses joker emoji in thumbnail',    !INDEX.includes('font-size:1.8rem">🃏'));

console.log('\n[TPL secondary source + synthetic card 2026-08-13]');
check('Scan uses TPL as secondary source',                   INDEX.includes('SECONDARY SOURCE: TCGPriceLookup'));
check('TPL fallback calls searchWithTPL(cleanName)',         /tplHits = await searchWithTPL\(cleanName/.test(INDEX));
check('TPL match sets selectedCard + loadCardUI',            /tplCardToNormalized\(tplMatch/.test(INDEX));
check('Synthetic card fallback exists',                      INDEX.includes('SYNTHETIC CARD FALLBACK'));
check('Synthetic card sets _synthetic flag',                 /_synthetic:\s*true/.test(INDEX));
check('Synthetic card populates main view before scan-miss', INDEX.includes("source: 'Scan (unmatched)'"));

console.log('\n[Graded UI fixes 2026-08-13]');
check('Raw regex excludes all 6 graders (sgc|ace|tag added)', INDEX.includes('!/^(psa|bgs|cgc|sgc|ace|tag)_/.test(o.value)'));
check('isGradedVariant covers all 6 graders',                INDEX.includes('/^(psa|bgs|cgc|sgc|ace|tag)_/.test(key'));
check('GRADE_SCALES per-grader constant exists',             INDEX.includes('const GRADE_SCALES = {'));
check('CGC scale has Pristine 10 (10p)',                     /cgc:\s*\[[\s\S]*?10p[\s\S]*?CGC 10 Pristine/.test(INDEX));
check('BGS scale has Black Label 10p',                       INDEX.includes('BGS 10 Pristine — Black Label'));
check('rebuildGradeSelect wired into toggleGrade',           INDEX.includes('if (isGraded) rebuildGradeSelect(grader)'));
check('Scan-miss no longer has mini thumbnail img',          !INDEX.includes('alt="Scanned card" style="width:72px'));
check('Scan-miss inserts AFTER cardHero',                    INDEX.includes('const cardHero = document.getElementById(\'cardHero\')'));
check('Scan scrolls to big hero, not scan-miss panel',       INDEX.includes('const target = cardHero || panel'));
check('Synthetic card scroll target uses cardHero',          INDEX.includes("const mainCard = document.getElementById('cardHero')"));

console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log(`Total: ${pass + fail} checks, ${fail} failure(s)`);
process.exit(fail > 0 ? 1 : 0);
