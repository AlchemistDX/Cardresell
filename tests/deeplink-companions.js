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

console.log('\n[Friendlier scan-miss + Add to Collection CTA 2026-08-13]');
check('Scan-miss message softened (no "not in database")',   !INDEX.includes('Scanned — not in database yet'));
check('Scan-miss uses friendly "Live pricing unavailable"',  INDEX.includes('Live pricing unavailable'));
check('Scan-miss has Add to Collection CTA',                 INDEX.includes('_scanMissAddToCollection()'));
check('_scanMissAddToCollection function defined',           /function _scanMissAddToCollection\(\)/.test(INDEX));

console.log('\n[Multi-word scan lookup fix (Mega Lucario EX bug) 2026-08-13]');
check('Query strategy uses identifyingWord (skips prefixes)', INDEX.includes("const identifyingWord = words.find(w => !PREFIXES.has"));
check('PREFIXES set skips Mega/Dark/Radiant/etc',            INDEX.includes("'mega','dark','radiant','shining','team','light','ex','gx','v','vmax','vstar'"));
check('Number-only fallback query exists',                   INDEX.includes("cleanNumber ? `number:${cleanNumber}` : ''"));
check('nameMatches guard prevents wrong-name number collision', INDEX.includes('const nameMatches = (c) =>'));
check('New match reason exact-number+name',                  INDEX.includes("matchReason = 'exact-number+name'"));

console.log('\n[TCGplayer search now includes card number 2026-08-13]');
check('buildTcgpUrl signature accepts cardNumber',           /function buildTcgpUrl\(cardName, setName, cardNumber\)/.test(INDEX));
check('buildTcgpUrl strips /setsize from number',            INDEX.includes("String(cardNumber).replace(/\\/.*$/, '').trim()"));
check('buildTcgpSmart passes card.number through',           INDEX.includes("buildTcgpUrl(card.name || '', card.setName || card.set?.name || '', card.number || '')"));
check('Main lookup view passes number to buildTcgpUrl',      INDEX.includes("buildTcgpUrl(searchName, setName, number)"));
check('Collection modal passes number to buildTcgpUrl',      INDEX.includes("buildTcgpUrl(p.card || '', p.set || '', p.number || '')"));
check('Scan-miss passes number to buildTcgpUrl',             INDEX.includes("buildTcgpUrl(name || '', setName || '', number || '')"));

console.log('\n[Every card link now includes name + number 2026-08-13]');
check('Platform queries share numTail suffix',               INDEX.includes("const numTail    = number ? ' ' + number : '';"));
check('COMC search query includes card number',              INDEX.includes("encodeURIComponent(`${searchName}${numTail}`)"));
check('Poshmark search query includes card number',          INDEX.includes("${setName ? ' ' + setName : ''}${numTail} ${gameTag}"));
check('Fanatics search query includes card number',          INDEX.includes("${numTail}${isPokemon ? ' pokemon' : ''}"));
check('PWCC search query includes card number',              INDEX.includes("${setName ? ' ' + setName : ''}${numTail}`)"));
check('JP EN-ref ebay/PC/sell all use jpRefNum',             INDEX.includes("const jpRefNum = card.number ? ' ' + card.number : '';"));
check('Graded comps banner ebay query includes number',      INDEX.includes("${cardName}${cardNum} ${graderLabel} ${grade} pokemon card"));

console.log('\n[Raw price restoration + faster card display 2026-08-13]');
check('Raw median cached on eBay-sold fetch',                INDEX.includes('window._rawMedianCache = window._rawMedianCache || {}'));
check('Raw click restores cached eBay median',               INDEX.includes('const cachedMedian = window._rawMedianCache[cardKey]'));
check('Small image loads first, upgrades to large in bg',    INDEX.includes('progressive loading: show small'));
check('Image gets fetchPriority=high + eager loading',       INDEX.includes("cardImg.fetchPriority = 'high'; cardImg.loading = 'eager'"));
check('Preconnect to pokemontcg.io image CDN',               INDEX.includes('href="https://images.pokemontcg.io"'));
check('Client-side timeout on ebay-sold fetch',              INDEX.includes("setTimeout(() => _clientController.abort(), 10000)"));

console.log('\n[Raw pill race guard 2026-08-13]');
check('syncGradeToPrintSelect bumps generation counter',     INDEX.includes('const myGen = ++window._syncGen'));
check('Stale-check bail after fetchTPLCardById',             INDEX.includes('if (myGen !== window._syncGen) return;\n        if (fullCard)'));
check('Stale-check bail after fetchTPLGradedByNameNumber',   INDEX.includes('if (myGen !== window._syncGen) return; // stale'));
check('Final stale-check guard before updatePriceFromPrinting', INDEX.includes("if (myGen !== window._syncGen) return;\n  updatePriceFromPrinting()"));
check('fetchAndApplySoldComps skips override when grader != Raw', INDEX.includes("const isRawContext      = currentGraderPill === 'no' && !gradedRequest"));

console.log('\n[Bulk-scan hardening + View full card 2026-08-13]');
check('Bulk fetch has extracted helper _bulkFetchPokemonCards', INDEX.includes('async function _bulkFetchPokemonCards(q, timeoutMs)'));
check('Bulk fetch timeout bumped to 7s',                        INDEX.includes('setTimeout(() => ctrl.abort(), timeoutMs || 7000)'));
check('Bulk fetch falls back to name-only query',               INDEX.includes('queries.push(`name:"${cleanName}"`)'));
check('_bulkScanOne captures thumbnail data URL',               INDEX.includes("result.imageDataUrl = 'data:image/jpeg;base64,' + thumbBase64"));
check('Bulk save uses user-photo thumbnail fallback',           INDEX.includes('const thumb = r.imageUrl || r.imageDataUrl || null'));
check('Bulk save writes img field (single-add compat)',         INDEX.includes("img: thumb,\n        imageUrl: thumb"));
check('Bulk save persists number field',                        INDEX.includes("number: r.cardNumber || ''"));
check('Bulk save persists tcgplayerUrl',                        INDEX.includes("tcgplayerUrl: r.tcgplayerUrl || ''"));
check('Collection modal has View full card button',             INDEX.includes("id=\"ccmViewFullBtn\""));
check('_ccmViewFullCard function exists',                       INDEX.includes("function _ccmViewFullCard()"));
check('_ccmViewFullCard applies saved grader+grade',            INDEX.includes("const graderKey = p.grader ? String(p.grader).toLowerCase() : null"));
check('Collection modal has grade chip element',                INDEX.includes("id=\"ccmGradeChip\""));
check('Grade chip populated when p.grader + p.grade present',   INDEX.includes("if (p.grader && p.grade != null && p.grade !== '')"));
check('No-price entries show placeholder not $0.00',            INDEX.includes("valEl.textContent = 'Price not fetched'"));

console.log('\n[Collection row grade indicator 2026-08-13]');
check('Collection row detects saved grade',                    INDEX.includes("const _hasGrade = p.grader && p.grade != null && p.grade !== ''"));
check('Collection row renders gold corner badge on thumbnail', INDEX.includes("linear-gradient(135deg,#f0b429,#d4af37)"));
check('Collection row shows grade chip inline with card name', INDEX.includes("const cardNameHtml = _hasGrade"));
check('Thumbnail wrapped in position:relative container',      INDEX.includes("position:relative;width:40px;height:56px"));

console.log('\n[Flip modal grade capture 2026-08-13]');
check('Flip modal has gold grade banner element',              INDEX.includes("id=\"mGradeBanner\""));
check('Grade banner has label span',                           INDEX.includes("id=\"mGradeBannerLabel\""));
check('_syncFlipModalGradeBanner helper defined',              INDEX.includes("function _syncFlipModalGradeBanner()"));
check('Add-to-Collection button calls grade sync',             INDEX.includes("_syncFlipModalGradeBanner();\n  modal.classList.add('open');"));
check('Save persists grader field on portfolio entry',         INDEX.includes("grader: savedGrader || null"));
check('Save persists grade field on portfolio entry',          INDEX.includes("grade: savedGrade || null"));
check('Close resets grader dataset to prevent leak',           INDEX.includes("delete modalBox.dataset.grader; delete modalBox.dataset.grade;"));

console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log(`Total: ${pass + fail} checks, ${fail} failure(s)`);
process.exit(fail > 0 ? 1 : 0);
