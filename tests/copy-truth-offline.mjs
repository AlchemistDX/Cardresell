import fs from 'fs';
let fail=0;
const ok=(c,m)=>{ if(!c){console.log('FAIL: '+m); fail++;} else console.log('ok: '+m); };
for (const f of ['index.html','accuracy.html','pricing.html']) {
  const src=fs.readFileSync(f,'utf8');
  // script syntax
  const re=/<script([^>]*)>([\s\S]*?)<\/script>/g; let m,n=0;
  while((m=re.exec(src))){
    const attrs=m[1]||'';
    if(/\bsrc=/.test(attrs)) continue;
    if(/type\s*=\s*["']application\/ld\+json["']/.test(attrs)){
      try{ JSON.parse(m[2]); }catch(e){ console.log(`FAIL ${f} JSON-LD: ${e.message}`); fail++; }
      continue;
    }
    if(/type\s*=\s*["']module["']/.test(attrs)) continue;
    try{ new Function(m[2]); n++; }catch(e){ console.log(`FAIL ${f} script: ${e.message}`); fail++; }
  }
  const o=(src.match(/<div\b/g)||[]).length, c=(src.match(/<\/div>/g)||[]).length;
  ok(o===c, `${f} div balance ${o}/${c} (${n} scripts parsed)`);
}
const idx=fs.readFileSync('index.html','utf8');
const pr=fs.readFileSync('pricing.html','utf8');
const ac=fs.readFileSync('accuracy.html','utf8');
JSON.parse(fs.readFileSync('vercel.json','utf8'));
console.log('ok: vercel.json parses');
// CR-008
for (const t of ['$1.99','$7.99','$12.99','$5.99','$22.99']) ok(pr.includes(t), `pricing.html has real SKU price ${t}`);
{
  const body = pr.replace(/<!--[\s\S]*?-->/g,'');
  const a = body.indexOf('class="packs-title"');
  const b = body.indexOf('class="packs-foot"');
  ok(a>0 && b>a, 'packs block located');
  const packs = body.slice(a,b);
  ok(!/\$4\.99|\$14\.99|\$19\.99/.test(packs), 'packs block has no phantom pack prices');
  ok(!/25 scans|100 scans|40 grades/.test(packs), 'packs block has no phantom pack sizes');
}
ok((pr.match(/class="pack[ "]/g)||[]).length===6 || (pr.match(/class="pack(?: pack-pop)?"/g)||[]).length===6, 'pricing.html renders exactly 6 pack cards');
ok(pr.includes('/?packs=id') && pr.includes('/?packs=grade'), 'pack cards deep-link into the app');
ok(idx.includes("p.get('packs')") && idx.includes('_pendingPacksFocus'), 'index.html handles ?packs=');
ok(idx.includes('id="gradeCreditsBuy"') && idx.includes('id="idCreditsBuy"'), 'pack scroll anchors exist');
// CR-012
ok(pr.includes('Flip calc + Deal Score + Max Buy'), 'Free tier copy credits Max Buy (matches code)');
ok(/Max Buy calculator<\/td><td class="yes">/.test(pr), 'compare table marks Max Buy free');
// CR-014
ok(!idx.includes('Live eBay sold comps'), 'unconditional "Live eBay sold comps" claim removed');
ok(idx.includes('when eBay serves them'), 'eBay comps claim is now conditional');
ok(!idx.includes('pulls live sold comps'), 'hero paragraph claim qualified');
// CR-015
ok(!ac.includes('href="/photo-tips/"'), 'accuracy.html no longer links the dead /photo-tips/ path');
ok(ac.includes('/?photo_tips=1'), 'accuracy.html links the working deep link');
ok(idx.includes("p.get('photo_tips')") && idx.includes('openPhotoTipsModal()'), 'index.html opens the tips overlay from the param');
const vj=JSON.parse(fs.readFileSync('vercel.json','utf8'));
const routes=vj.routes.map(r=>r.src);
ok(routes.indexOf('/photo-tips/(.*\\.webp)') < routes.indexOf('/photo-tips/?'), 'webp route still precedes the redirect');
// CR-013 — annual interval handoff from /pricing into the app
// 2026-09-01: Ultimate retired. Two paid tiers now.
ok(/data-upgrade-tier="pro"/.test(pr) && /data-upgrade-tier="pro_max"/.test(pr),
   'both paid CTAs are tagged for interval rewriting');
ok(!/data-upgrade-tier="ultimate"/.test(pr), 'no Ultimate CTA remains on the pricing page');
ok(pr.includes("'/?upgrade=' + el.dataset.upgradeTier + (mode === 'annual' ? '&p=annual' : '')"),
   'pricing toggle rewrites CTA hrefs with the interval');
ok(idx.includes('_pendingUpgradeInterval') && idx.includes("p.get('p')"),
   'index.html reads and stashes the handed-over interval');
ok(idx.includes('window._applyPendingUpgradeInterval = function'),
   'shared interval applier is defined');
ok((idx.match(/_applyPendingUpgradeInterval && window\._applyPendingUpgradeInterval\(\)/g)||[]).length === 2,
   'both deferred-open paths apply the interval');
ok(idx.includes("p.delete('p');"), 'the interval param is stripped from the URL');
ok(/window\._pricingMode === 'annual' \? 'annual' : 'monthly'/.test(idx),
   'startTierCheckout still derives the Stripe interval from _pricingMode');
{
  // setPricingMode must be a plain global for the applier to reach it.
  const i = idx.indexOf('function setPricingMode(mode)');
  ok(i > 0, 'setPricingMode exists');
  const before = idx.lastIndexOf('<script', i);
  const attrs = idx.slice(before, idx.indexOf('>', before));
  ok(!/type\s*=\s*["']module["']/.test(attrs), 'setPricingMode is not module-scoped');
}
ok(idx.includes('id="pricingBox"'), 'pricingBox exists so setPricingMode will not early-return');

// CR-013b — signed-out visitors from /pricing must not get a dead click.
// Live browser run on 539ad08 showed: no modal, no sign-in prompt, params
// stripped. Root cause was a uid requirement on the deferred-open gate.
ok(!/window\._authInitialized && \(window\._user\?\.uid \|\| window\.googleUser\?\.uid\)/.test(idx),
   'deferred pricing-modal open is no longer gated on a signed-in uid');
{
  const i = idx.indexOf('window._applyPendingUpgradeInterval = function');
  const j = idx.indexOf('const upgradeParam');
  ok(i > 0 && j > 0 && i < j,
     'interval applier is hoisted above the ?upgrade= branch (sign-in round-trip needs it)');
}
ok(/sessionStorage\.setItem\('_pendingUpgradeTier', tier\)/.test(idx),
   'signed-out plan click re-stashes the tier for the sign-in round-trip');
ok(/sessionStorage\.setItem\('_pendingUpgradeInterval', window\._pricingMode === 'annual'/.test(idx),
   'signed-out plan click re-stashes the interval too');
ok(!/Signed-out users get the sign-in dialog first/.test(idx),
   'stale comment claiming a sign-in dialog appears is gone');

// Launch gate — a first visit must land on a finished payout, not an empty
// state or a dropdown the visitor still has to tap.
ok(/async function autoRunExampleCard\(\)/.test(idx),
   'autoRunExampleCard() exists');
ok(/first\.click\(\)/.test(idx),
   'auto-run clicks the first printing (reuses the real user path, no hardcoded card)');
ok(!/autoRunExampleCard[\s\S]{0,400}si\.focus\(\)/.test(idx),
   'auto-run does NOT focus the search input (would pop the mobile keyboard)');
ok(/!_seen && !_deepLink && !_hasSavedCard/.test(idx),
   'auto-run is suppressed by a deep link or a saved card so it cannot race the restore path');
// The first attempt at this shipped green and still did nothing live: the guard
// read _hasDeepLink, a const scoped to a different try block, so it threw a
// ReferenceError that the enclosing catch(_) swallowed. Pin the local variable.
{
  const g = idx.indexOf("const _seen = localStorage.getItem('cs_landing_seen')");
  const region = idx.slice(g, g + 2500);
  ok(!/_hasDeepLink/.test(region.replace(/\/\/[^\n]*/g, '')),
     'auto-run guard does not read _hasDeepLink from another block scope');
  ok(/const _q = new URLSearchParams\(window\._crLandingSearch \|\| location\.search\)/.test(region),
     'auto-run reads the pre-strip URL snapshot, not the already-stripped location.search');
}
// The snapshot must be set before ANY handler calls history.replaceState.
{
  const snap = idx.indexOf('window._crLandingSearch = location.search');
  const mod  = idx.indexOf('<script type="module">');
  const strip = idx.indexOf("p.delete('packs')");
  ok(snap > 0, 'landing-URL snapshot exists');
  ok(snap < mod, 'snapshot runs before the module script (the earliest stripper)');
  ok(snap < strip, 'snapshot runs before the ?packs= stripper');
}
ok(/autoRunExampleCard\(\)\.then\(\(ok\) => \{[\s\S]{0,600}classList\.add\('first-visit'\)/.test(idx),
   'a failed auto-run falls back to the Try Charizard pulse');

// -- Price caption truthfulness (2026-09-01) --------------------------------
// Browser QA: the same Charizard read $489.11 then $272.56 across a reload, and
// BOTH were captioned "TCGPlayer market". The override is filled from a 3-rung
// ladder (eBay median > PriceCharting > TCG market), so the caption has to name
// the rung that actually won rather than whatever selectedCard.source was.
// The rung labels now live where the rung is CHOSEN (_basisMeta), so the caption
// cannot drift from the number: same assignment, same branch.
{
  const f = idx.indexOf('let _basisMeta = null;');
  ok(f > 0, 'the ladder records which rung it took');
  const region = idx.slice(f, f + 2600);
  ok(/eBay sold median/.test(region),  'caption can name eBay sold median');
  ok(/PriceCharting guide value/.test(region), 'caption can name PriceCharting');
  ok(/TCGPlayer market/.test(region),  'caption can name TCGPlayer market');
  ok(/ebay\.count\} comps/.test(region),
     'the eBay caption discloses how many comps are behind the median');
  ok(idx.includes('priceSource.textContent = _srcLabel'),
     'the caption element is updated when the override is filled');
  ok(/_srcLabel = \(window\._crBasis && window\._crBasis\.label\)/.test(idx),
     'the caption reads the recorded rung label, not a float comparison');
  ok(/window\._crBasis && window\._ovAutoFilled[\s\S]{0,90}updatePriceFromPrinting\(\);/.test(idx),
     'recording the basis also repaints the headline from it');
  ok(!/\} catch\(_\) \{\}\n      calc\(\);/.test(idx),
     'the basis block no longer swallows its own failures');
}

// -- Icons and social preview (2026-09-01) ----------------------------------
// Every icon and the og-image were returning HTTP 200 with 1.19MB of index.html
// because the /(.*) catch-all outranked them, so link previews were blank and
// PWA install was broken. Pin the files, the routes, and the route ORDER.
{
  const fs2 = await import('node:fs');
  const vj = JSON.parse(fs2.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  const srcs = vj.routes.map(r => r.src);
  const catchAll = vj.routes.findIndex(r => r.src === '/(.*)' && !r.continue);
  ok(catchAll > 0, 'catch-all route still exists');
  for (const [route, file, ct] of [
    ['/og-image.png', 'og-image.png', 'image/png'],
    ['/favicon.ico', 'favicon.ico', 'image/x-icon'],
    ['/apple-touch-icon.png', 'apple-touch-icon.png', 'image/png'],
    ['/icon-192.png', 'icon-192.png', 'image/png'],
    ['/icon-512.png', 'icon-512.png', 'image/png'],
  ]) {
    const i = srcs.indexOf(route);
    ok(i >= 0, `vercel.json routes ${route}`);
    ok(i < catchAll, `${route} is matched BEFORE the catch-all`);
    const r = vj.routes[i];
    ok(r.headers && r.headers['Content-Type'] === ct,
       `${route} is served as ${ct}, not text/html`);
    const st = fs2.statSync(new URL('../public/' + file, import.meta.url));
    ok(st.size > 1000, `public/${file} exists and is a real asset`);
    ok(st.size < 400000, `public/${file} is not oversized`);
  }
  const mf = JSON.parse(fs2.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));
  ok(mf.icons.some(i => i.sizes === '192x192'), 'manifest ships a 192 icon');
  ok(mf.icons.some(i => i.sizes === '512x512'), 'manifest ships a 512 icon');
  ok(mf.theme_color === '#111009', 'manifest theme_color matches the real brand black');
  ok(!JSON.stringify(mf).includes('0f172a'), 'no stale slate-blue left in manifest');

  for (const page of ['index.html','terms.html','privacy.html','signin.html',
                      'pricing.html','accuracy.html','about.html','contact.html']) {
    const h = fs2.readFileSync(new URL('../' + page, import.meta.url), 'utf8');
    ok(/rel="icon"/.test(h), `${page} declares a favicon`);
    ok(/apple-touch-icon/.test(h), `${page} declares an apple-touch-icon`);
    ok(!h.includes('#0f172a'), `${page} has no stale slate-blue theme-color`);
    ok((h.match(/name="theme-color"/g) || []).length === 1,
       `${page} declares exactly one theme-color`);
  }
}

// -- Single price anchor (2026-09-01) ---------------------------------------
// The click path used to read the dropdown row's rendered price text into the
// override, which blocked the real ladder and made the same card report two
// different payouts across a reload. There must be exactly ONE anchor source.
{
  ok(!/priceSpan\.textContent\.replace/.test(idx),
     'the drop-row DOM-text price prefill is gone');
  ok(!/Auto-populate price override from the displayed price/.test(idx),
     'the old prefill comment is gone too, so it cannot be resurrected by copy-paste');

  // NB: 'let bestPrice = null;' also appears in cardFactory (max variant price),
  // so anchor on the graded/raw split inside the comps resolver instead.
  const f = idx.indexOf('if (gradedRequest)');
  ok(f > 0, 'the price ladder still exists');
  const ladder = idx.slice(f, f + 6500);

  // Graded ladder: PriceCharting leads (unchanged, deliberate).
  const gradedBranch = ladder.slice(ladder.indexOf('if (gradedRequest)'),
                                    ladder.indexOf('Raw context'));
  ok(gradedBranch.indexOf('pc.median') < gradedBranch.indexOf('ebay.median'),
     'graded ladder still prefers PriceCharting over eBay comps');

  // Raw ladder: TCG market leads, then eBay, then PriceCharting.
  // Raw: TCG market leads, but it is applied as the DISPLAY BASIS via
  // currentPrices (see the condition-multiplier block below) rather than written
  // into the override, so the raw branch's first rung deliberately yields null.
  const rawBranch = ladder.slice(ladder.indexOf('Raw context'));
  const iTcg  = rawBranch.indexOf('bestPrice = tcg.market');
  const iEbay = rawBranch.indexOf('bestPrice = ebay.median');
  const iPc   = rawBranch.indexOf('bestPrice = pc.median');
  ok(iTcg >= 0 && iEbay >= 0 && iPc >= 0, 'raw ladder keeps all three rungs');
  ok(iTcg < iEbay, 'raw ladder anchors on TCGplayer market before eBay comps');
  ok(iEbay < iPc, 'eBay comps still outrank the PriceCharting backstop when present');
}

// -- Condition multiplier must reach the payouts (2026-09-01) --------------
// getEffectivePrice() used to return an auto-filled override verbatim, so once
// the ladder populated the field, changing condition moved the headline but not
// a single payout row. A system-filled basis is Near Mint and must be adjusted;
// a user-typed price is their expected sale price and must not be.
{
  const g = idx.indexOf('function getEffectivePrice()');
  ok(g > 0, 'getEffectivePrice exists');
  const body = idx.slice(g, g + 1400);
  ok(/_ovAutoFilled && !isGradedVariant\(\)\) return ov \* getCondMultiplier\(\)/.test(body),
     'a system-filled override gets the condition multiplier');
  ok(/return ov;/.test(body), 'a user-typed override is still returned verbatim');

  ok(/window\._ovAutoFilled = true;/.test(idx), 'the ladder marks its fill as system-filled');
  const inp = idx.indexOf("getElementById('priceOverride')?.addEventListener('input'");
  ok(inp > 0, 'the override input listener exists');
  ok(/_ovAutoFilled = false/.test(idx.slice(inp, inp + 400)),
     'typing in the override clears the auto-fill flag');

  // ONE basis: the ladder records it, the headline renders from it.
  ok(/window\._crBasis = \{/.test(idx), 'the ladder records the basis it chose');
  ok(!/_tcgFreshVariant/.test(idx),
     'the dead currentPrices injection is gone (it matched printing names against condition keys)');
  const upd = idx.indexOf('function updatePriceFromPrinting()');
  const updBody = idx.slice(upd, upd + 2200);
  ok(/window\._crBasis && window\._ovAutoFilled && !isGradedVariant\(key\)/.test(updBody),
     'the headline renders from the basis when the system owns the number');
  ok(/priceMain\.textContent = `\$\$\{\(b\.value \* m\)\.toFixed\(2\)\}`/.test(updBody),
     'headline = basis x condition multiplier, the same product getEffectivePrice uses');
  ok(/priceSource\.textContent = b\.label;[\s\S]{0,80}calc\(\);[\s\S]{0,20}return;/.test(updBody),
     'the basis branch returns before the tail can relabel the caption from selectedCard.source');
  const rawB = idx.slice(idx.indexOf('Raw context'));
  ok(rawB.indexOf("_basisMeta = { label: 'TCGPlayer market'") < rawB.indexOf('bestPrice = ebay.median'),
     'TCG market is the first raw rung and labels itself');
  ok(!/bestPrice === \(ebay && ebay\.median\)/.test(idx),
     'the caption no longer guesses the rung by float comparison');

  // Hand-computed: a $422.40 NM basis at Moderately Played (0.65) is $274.56.
  ok(Math.abs(422.40 * 0.65 - 274.56) < 0.005, 'MP multiplier fixture is 0.65');
  ok(/mp: 0\.65/.test(idx), 'MP multiplier in code is still 0.65');
}

// -- Single-decision venue unlock (2026-09-01) -----------------------------
{
  ok(/function startVenueUnlock\(source\)/.test(idx), 'startVenueUnlock exists');
  const f = idx.indexOf('function startVenueUnlock(source)');
  const body = idx.slice(f, f + 1200);
  ok(/tier === 'free' \? 'pro' : 'pro_max'/.test(body), 'Free upgrades to Pro, Pro upgrades to Pro Max');
  ok(/_pricingMode = 'monthly'/.test(body), 'an impulse unlock defaults to monthly, not annual');
  ok(/startTierCheckout\(target\)/.test(body), 'it goes straight to checkout');

  // The high-intent click must not reopen the 4-plan wall.
  ok(!idx.includes("openPricingModal('calc_gate')"), 'the locked-venue card no longer opens the plan wall');
  ok(idx.includes("openPricingModal('calc_gate_compare')"), 'a "Compare all plans" escape hatch still exists');
  ok(!/openPricingModal && openPricingModal\('ranking_strip_unlock'\)/.test(idx),
     'blurred ranking rows go to checkout, not the wall');

  // The CTA number must be what the TARGET tier unlocks, not what is locked.
  ok(/See \$\{_targetUnlockCount\} more venue/.test(idx),
     'CTA counts what the target tier actually unlocks');
  ok(!/See \$\{_lockedCount\} more venue/.test(idx),
     'CTA does not count all locked venues');
  ok(/_beyondCount > 0 \? ` · \+\$\{_beyondCount\} more on Pro Max`/.test(idx),
     'venues beyond the target tier are disclosed, not implied as included');

  // Hand-computed from the tier sets, independently of the page's own math:
  // Free sees 2, Pro sees 9, Pro Max sees 15. A Free user has 13 locked, of
  // which Pro unlocks 7 and Pro Max the remaining 6.
  const FREE = ['ebay','tcgplayer'];
  const PRO  = ['ebay','tcgplayer','poshmark','whatnot','mercari','manapool','cardsphere','cardmarket','cardnexus'];
  const MAXP = PRO.concat(['comc','fanatics','cardkingdom','coolstuffinc','scg','tcgbulk']);
  ok(FREE.length === 2 && PRO.length === 9 && MAXP.length === 15, 'tier venue counts are 2 / 9 / 15');
  ok(PRO.filter(p => !FREE.includes(p)).length === 7, 'Pro adds exactly 7 venues over Free');
  ok(MAXP.filter(p => !PRO.includes(p)).length === 6, 'Pro Max adds exactly 6 venues over Pro');
  for (const pid of PRO) ok(idx.includes(`'${pid}'`), `PRO_PLATFORMS still lists ${pid}`);
}

// -- Issues 1/2/3/4/5 (2026-09-01) ----------------------------------------
{
  // Issue 1 - accuracy stamp and changelog
  const ac = fs.readFileSync('accuracy.html','utf8');
  ok(/Last updated &middot; Sep 1, 2026|Last updated · Sep 1, 2026/.test(ac),
     'accuracy header stamped Sep 1, 2026');
  ok(/We audit this page every release cycle/.test(ac),
     'accuracy header carries the audit-cadence promise');
  ok(/Poshmark, COMC and Fanatics&nbsp;Collect re-verified/.test(ac),
     'the Sep 1 re-verification changelog entry exists');
  ok(/Terms &amp; Privacy rewritten/.test(ac),
     'the Sep 1 terms rewrite changelog entry exists');
  ok(/TCGplayer and eBay fee corrections/.test(ac),
     'the Aug 31 fee-correction changelog entry exists');
  ok(/<td>Poshmark<\/td>[^<]*<td>[^<]*\$2\.95[^<]*<\/td>[^<]*<td>Sep 2026<\/td>/.test(ac.replace(/\s+/g,' ')),
     'Poshmark row keeps $2.95/20% and stamps Sep 2026');
  ok(/6% below 120%, 12% at or above/.test(ac.replace(/&nbsp;/g,' ')),
     'Fanatics tiered 6/12 fee stated (checklist 8% was wrong)');

  // Issue 1b - stale threshold tightened 60 -> 45
  ok(/verifiedAgeDays\(PLATFORMS\[pid\]\?\.verified\) > 45/.test(idx),
     'stale threshold is 45 days (was 60)');
  ok(/haven\\'t been re-verified in over 45 days/.test(idx),
     'the stale tooltip agrees with the 45-day rule');
  ok(!/re-verified in over 60 days/.test(idx),
     'no stale copy still claims the 60-day threshold');

  // Issue 2 - fee recipe rows on every eligible tile
  ok(/const DAYS_TO_CASH = \{/.test(idx), 'per-venue days-to-cash table exists');
  ok(/daysToCash: daysToCashText\(p\.pid\)/.test(idx),
     'each row carries a daysToCash string');
  ok(/priceUsed: price, priceLabel: _priceLabel/.test(idx),
     'each row carries the price basis it used');
  ok(/<span>Price used <span class="fee-basis">/.test(idx),
     'the recipe renders a "Price used" line with its basis label');
  ok(/<span>Net after all deductions<\/span>/.test(idx),
     'the recipe subtotal is the Net line');

  // Issue 3 - pricing.html spells all 4 buylists
  const pr2 = fs.readFileSync('pricing.html','utf8');
  ok(/Buylist quotes \(Card Kingdom, CoolStuffInc, SCG, TCG&nbsp;Bulk\)/.test(pr2),
     'pricing table names all 4 buylists (was missing TCG Bulk)');
  ok(!/eBay, COMC, Fanatics Collect &amp; more/.test(idx),
     'homepage feature blurb no longer promises COMC/Fanatics on Free');
  ok(/eBay, TCGplayer, Whatnot &amp; more/.test(idx),
     'homepage feature blurb names venues Free actually sees');
  ok(/Unlock 13 more marketplaces &mdash; 7 with Pro, 6 more with Pro Max/.test(idx),
     'the unlock strip splits the 13 into 7 Pro + 6 Pro Max');

  // Issue 4 - Ultimate removed from every user-facing surface
  ok(!/<div class="plan" id="ultimate">/.test(pr2), 'no Ultimate plan card on /pricing');
  ok(!/tier-ultimate/.test(pr2), 'no tier-ultimate DOM on /pricing');
  ok(!/<div class="plan-card tier-ultimate"/.test(idx), 'no Ultimate card in the upgrade modal');
  ok(/Get Ultimate/.test(idx) === false, 'no "Get Ultimate" CTA left in the app');
  ok(/"@type": "Offer", "name": "Pro Max \(monthly\)"/.test(pr2), 'Pro Max offer still in JSON-LD');
  ok(!/"@type": "Offer", "name": "Ultimate \(monthly\)"/.test(pr2), 'Ultimate offer removed from JSON-LD');
  const upTiers = idx.match(/\['pro','pro_max'(?:,'ultimate')?\]\.includes\(upgradeParam\)/);
  ok(upTiers && /ultimate/.test(upTiers[0]) &&
     /upgradeParam === 'ultimate' \? 'pro_max' : upgradeParam/.test(idx) &&
     /Ultimate was retired\. Pro Max now includes all 15 venues\./.test(idx),
     'the ?upgrade=ultimate router safely remaps to Pro Max with disclosure');

  // Issue 5 - cancel copy points at the Stripe portal, not email
  ok(!/emailing <a href="mailto:will@cardresell\.org">will@cardresell\.org<\/a>/.test(pr2) ||
     /billing problems, not the cancel button/.test(pr2),
     'FAQ no longer offers email as an equal cancel path');
  ok(/open the profile menu.*Manage billing/.test(pr2.replace(/\s+/g,' ')),
     'FAQ tells users where the Manage billing button is');
  ok(/Manage billing/.test(idx) && /openBillingPortal/.test(idx),
     'the profile popover button reads "Manage billing" and calls the portal');
  ok(/Cancel or update payment \(Stripe\)/.test(idx),
     'the sub-line names Stripe as the cancel surface');
}

console.log(fail? `\n${fail} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fail?1:0);
