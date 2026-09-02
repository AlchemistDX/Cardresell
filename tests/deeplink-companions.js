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
// 2026-08-14: sell links now route to buyer's-eye search view (sold comps)
// so users can see market price + use eBay's native 'Sell one like this' flow.
check('gradedSellLink JS wires eBay search URL',           /gradedSellLink[\s\S]{0,300}buildEbaySearchUrl/.test(INDEX));
check('jpEbaySellLink element exists in HTML',              /id="jpEbaySellLink"/.test(INDEX));
check('jpEbaySellLink JS sets URL for both JP branches',    (INDEX.match(/jpEbaySellLink\.href = buildEbaySearchUrl/g) || []).length >= 2);
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
check('Synthetic card populates main view before scan-miss', /source:\s*synthPriceVariants\.length\s*\?[\s\S]*?'Scan \(unmatched\)'/.test(INDEX) && INDEX.includes('loadCardUI(synthCard)'));

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
check('Number + name match reason exists',                  INDEX.includes("matchReason = 'number+name'"));

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
check('Fanatics search query includes card number',          INDEX.includes("const fanaticsQ") && INDEX.includes("${numTail}${isPokemon ? ' pokemon' : ''}"));
check('JP EN-ref ebay/PC/sell all use jpRefNum',             INDEX.includes("const jpRefNum = card.number ? ' ' + card.number : '';"));
check('Graded comps banner ebay query includes number',      INDEX.includes("${cardName}${cardNum} ${graderLabel} ${grade} pokemon card"));

console.log('\n[Raw price restoration + faster card display 2026-08-13]');
check('Raw median cached on eBay-sold fetch',                INDEX.includes('window._rawMedianCache = window._rawMedianCache || {}'));
check('Raw click restores cached eBay median',               INDEX.includes('const cachedMedian = window._rawMedianCache[cardKey]'));
check('Small image loads first, upgrades to large in bg',    INDEX.includes('progressive loading: show small'));
check('Image gets fetchPriority=high + eager loading',       INDEX.includes("cardImg.fetchPriority = 'high'; cardImg.loading = 'eager'"));
check('Preconnect to pokemontcg.io image CDN',               INDEX.includes('href="https://images.pokemontcg.io"'));
check('Client-side timeout on ebay-sold fetch',              /clientTimeoutMs\s*=\s*10000[\s\S]*?setTimeout\(\(\)\s*=>\s*_clientController\.abort\(\),\s*clientTimeoutMs\)/.test(INDEX));

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

console.log('\n[Launch analytics 2026-08-13]');
check('Vercel Insights script loaded',                          INDEX.includes("/_vercel/insights/script.js"));
check('trackEvent helper defined',                              INDEX.includes("window.trackEvent = function trackEvent(name, props)"));
check('trackEvent uses safe try/catch',                         INDEX.includes("analytics must never break the app"));
check('search_zero_results event fires',                        INDEX.includes("'search_zero_results'"));
check('search_results event fires',                             INDEX.includes("'search_results'"));
check('collection_add event fires on single save',              INDEX.includes("'collection_add'"));
check('bulk_scan_save event fires on bulk save',                INDEX.includes("'bulk_scan_save'"));
check('checkout_attempt event fires on Pro monthly',            INDEX.includes("plan: 'pro_monthly'"));
check('checkout_attempt event fires on Pro annual',             INDEX.includes("plan: 'pro_annual'"));
check('checkout_attempt event fires on grade pack',             INDEX.includes("plan: 'grade_pack', tier"));

console.log('\n[Anon-mode Collection + Turnstile 2026-08-14]');
check('Collection wall forced hidden (display:none !important)', INDEX.includes("display:none !important"));
check('Anon sync banner element present',                        INDEX.includes("id=\"anonSyncBanner\""));
check('Anon banner CTA offers Google sign-in',                   INDEX.includes("Sign in + verify email") && INDEX.includes("10 free ID scans + 1 AI Grade"));
check('renderCollectionView no longer bails on signed-out',      !INDEX.includes("if (!signedIn) {\n    // Auth not resolved yet"));
check('_updateCollectionSignInWall toggles banner not wall',     INDEX.includes("if (banner)  banner.style.display  = signedIn ? 'none' : 'flex'"));
check('Turnstile script tag loaded',                             INDEX.includes("challenges.cloudflare.com/turnstile/v0/api.js"));
check('Turnstile site-key meta present',                         INDEX.includes("name=\"turnstile-site-key\""));
check('_tsRenderInto helper defined',                            INDEX.includes("window._tsRenderInto = function _tsRenderInto"));
check('_tsGetToken helper defined',                              INDEX.includes("window._tsGetToken = function _tsGetToken"));
check('Turnstile div mounted in claim modal',                    INDEX.includes("id=\"verifyTurnstile\""));
check('Claim POST sends turnstileToken',                         INDEX.includes("body: JSON.stringify({ turnstileToken })"));

const CLAIM_API = fs.readFileSync(path.join(__dirname, '../api/verify-claim-firebase.js'), 'utf8');
check('API reads TURNSTILE_SECRET_KEY',                          CLAIM_API.includes("process.env.TURNSTILE_SECRET_KEY"));
check('API verifies against Cloudflare siteverify',              CLAIM_API.includes("challenges.cloudflare.com/turnstile/v0/siteverify"));
check('API rejects on no_turnstile_token when configured',       CLAIM_API.includes("code: 'no_turnstile_token'"));
check('API fails closed on Turnstile unreachable',               CLAIM_API.includes("turnstile_unreachable"));

console.log('\n[Email signup verify flow 2026-08-14]');
check('Auth modal has "Check your inbox" verify view',            INDEX.includes("id=\"authViewVerify\""));
check('Verify view has target-email span',                        INDEX.includes("id=\"authVerifyEmail\""));
check('Verify view has claim-bonus button',                       INDEX.includes("id=\"authVerifyCheckBtn\""));
check('Verify view has resend button',                            INDEX.includes("id=\"authVerifyResendBtn\""));
check('Verify view has Turnstile mount point',                    INDEX.includes("id=\"authVerifyTurnstile\""));
check('showAuthView knows about verify view',                     INDEX.includes("verify: 'authViewVerify'"));
check('doEmailSignUp sets _authJustSignedUp before create',       INDEX.includes("window._authJustSignedUp = true;\n    await window._fbEmailSignUp"));
check('doEmailSignUp sends verification email',                   INDEX.includes("await window._fbSendVerification?.()"));
check('doEmailSignUp switches to verify view',                    INDEX.includes("showAuthView('verify')"));
check('onAuthStateChanged skips close during signup',             INDEX.includes("if (!window._authJustSignedUp) {\n          closeAuthModal();"));
check('doAuthCheckVerified force-refreshes token',                INDEX.includes("user.getIdToken(true)"));
check('doAuthCheckVerified sends turnstileToken to API',          INDEX.includes("body: JSON.stringify({ turnstileToken })"));
check('doAuthResendVerification defined',                         INDEX.includes("async function doAuthResendVerification()"));
check('_authBackToSignIn signs out + returns to signin',          INDEX.includes("async function _authBackToSignIn()"));

const SIGNIN = fs.readFileSync(path.join(__dirname, '..', 'signin.html'), 'utf8');
console.log('\n[signin.html alert visibility fix 2026-08-14]');
check('signin.html .alert no longer has base display:none',      !/\.alert\s*\{[^}]*display:\s*none/.test(SIGNIN));
check('signin.html has .alert:not(.show) hidden rule',            SIGNIN.includes(".alert:not(.show)"));
check('signin.html has .alert.show visible rule',                 SIGNIN.includes(".alert.show"));
check('signin.html showErr toggles .show class',                  SIGNIN.includes("el.classList.add('show')"));
check('signin.html clearErr removes .show class',                 SIGNIN.includes("el.classList.remove('show')"));
check('signin.html has email-already-in-use message',             SIGNIN.includes("An account with this email already exists"));

const SCAN = fs.readFileSync(path.join(__dirname, '..', 'api', 'scan.js'), 'utf8');
console.log('\n[Bulk scan multi-TCG routing 2026-08-15]');
check('scan.js prompt lists yugioh/lorcana/onepiece card types',   SCAN.includes('"yugioh"') && SCAN.includes('"lorcana"') && SCAN.includes('"onepiece"'));
check('scan.js prompt asks for is_japanese flag',                   SCAN.includes('is_japanese:'));
check('scan.js response returns card_type + is_japanese',           /is_japanese:\s+cardInfo\.is_japanese/.test(SCAN));
check('Bulk row captures cardType from data.card_type',             INDEX.includes("result.cardType   = data.card_type"));
check('Bulk row captures isJapanese from data.is_japanese',         INDEX.includes("result.isJapanese = data.is_japanese === true"));
check('_bulkFetchPrice accepts cardType + isJapanese params',       /function _bulkFetchPrice\(cardName,\s*setName,\s*cardNumber,\s*cardType,\s*isJapanese(?:,|\))/.test(INDEX));
check('_bulkFetchPriceMTG routes to Scryfall',                      INDEX.includes("api.scryfall.com/cards/search"));
check('_bulkFetchPriceYGO routes to YGOProDeck',                    INDEX.includes("db.ygoprodeck.com/api/v7/cardinfo.php"));
check('_bulkFetchPriceLorcana routes to lorcana-api',               INDEX.includes("api.lorcana-api.com/cards/fetch"));
check('_bulkFetchPrice dispatches by cardType',                     INDEX.includes("if (type === 'mtg') return _bulkFetchPriceMTG"));
check('_bulkFetchPrice tries JP live-price endpoint first',         INDEX.includes("tcg-price?name=") && INDEX.includes("if (isJapanese)"));
check('bulkOpenCardInLookup uses detected cardType not pokemon',    INDEX.includes("const targetGame = GAME_MAP[(r.cardType"));
check('bulkOpenCardInLookup no longer force-sets pokemon',          !INDEX.includes("Bulk scanner always identifies Pokemon"));
check('bulkOpenCardInLookup routes non-Pokemon to searchInput',     INDEX.includes("Non-Pokemon: prefill search, trigger the tab"));
check('bulkOpenCardInLookup auto-clicks best-match dropdown row',   INDEX.includes("auto-click the row that best matches"));
check('MTG bulk price falls back to name-only + strips zero-pad',   INDEX.includes("un-zero-padded") && INDEX.includes("stripDiacritics"));
check('YGO bulk price falls back to first two words',               INDEX.includes("first two words if the exact name misses"));
check('ebayListBtn cleared from display:none when card loads',      INDEX.includes("resetCardPanel() sets this to display:none"));

console.log('\n[Printing/Variant dropdown split 2026-08-15]');
check('variants.forEach filters graded from dropdown UI',           INDEX.includes("if (isGradedVariant(v.key)) return; // hide graded from Printing/Variant dropdown"));
check('ensureGradedOptionInSelect injects hidden graded option',    INDEX.includes("function ensureGradedOptionInSelect"));
check('Hidden graded option marked with dataset.gradedHidden',      INDEX.includes("opt.dataset.gradedHidden = '1'"));
check('Hidden graded option not shown in dropdown',                 INDEX.includes("opt.hidden = true; // don't render in the dropdown UI"));
check('firstRaw skips hidden graded options on Raw switch',         INDEX.includes("opts.find(o => !o.hidden && !/^(psa|bgs|cgc|sgc|ace|tag)_/"));
check('printingLabel notes raw prices only',                        INDEX.includes("raw prices; graded prices set below"));
check('syncGradeToPrintSelect reads currentPrices not options',     INDEX.includes("const graded = currentPrices[targetKey];"));
check('async TPL fallback injects hidden option for graded key',    INDEX.includes("if (!Array.from(printSelect.options).find(o => o.value === useKey2))"));

console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log(`Total: ${pass + fail} checks, ${fail} failure(s)`);
process.exit(fail > 0 ? 1 : 0);
