import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import gradeOpportunity from '../api/grade-opportunity.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const vercel = fs.readFileSync(path.join(root, 'vercel.json'), 'utf8');
const stripeCheckout = fs.readFileSync(path.join(root, 'api/stripe-checkout.js'), 'utf8');
const tierApi = fs.readFileSync(path.join(root, 'api/_tier.js'), 'utf8');
const userDataApi = fs.readFileSync(path.join(root, 'api/user-data.js'), 'utf8');
const collectionApi = fs.readFileSync(path.join(root, 'api/collection.js'), 'utf8');

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    console.log(`  ✗ ${name}`);
    failed++;
  }
}

console.log('\n[Launch audit regressions]');

// RETIRED 2026-09-03. This pinned the shape of the /api/grade-opportunity
// fetch ("send game exactly once"). The tile it fed was withdrawn because the
// endpoint never looked up a graded price -- it returned rawPrice * a
// hardcoded multiplier and the UI called it a "PSA 10 comp". There is no
// longer a call to constrain. Part M now asserts the opposite: that nothing
// calls this endpoint at all. Kept as a note so the deletion is not read as
// coverage quietly going missing.
check(
  'the duplicate-game bug this replaced cannot come back',
  !index.includes("tcgParams.toString() + (card.game ? '&game='"),
  'the double-game param shape must stay gone even with the fetch removed'
);
check(
  'visible payout ranks use the tier-filtered eligible list',
  index.includes('const rankIdx = _eligibleDisplay.indexOf(r);')
);
check(
  // The tile is a tap target via a delegated listener, NOT an outer <a>.
  // Wrapping the whole tile in an anchor would nest the sell link and the
  // details toggle inside it, which is invalid HTML and breaks the toggle.
  'platform result tile is not an outer anchor',
  !index.includes('const cardTag  = sellUrl') &&
    !/html \+= `<a class="\$\{cls\}"/.test(index) &&
    /html \+= `<div class="\$\{cls\}"/.test(index)
);
check(
  // The pill must stay a real anchor with a real aria-label so keyboard and
  // screen-reader users get a focusable destination, not just a div listener.
  'sell destination remains a dedicated accessible link',
  index.includes('<a class="plat-sell-badge"') &&
    index.includes('aria-label="${esc(sellAria)}"') &&
    /Open \$\{info\.name\} to sell this card/.test(index) &&
    index.includes('target="_blank"') && index.includes('rel="noopener"')
);
check(
  'retired Ultimate deep links map to Pro Max with an honest message',
  index.includes("['pro','pro_max','ultimate'].includes(upgradeParam)") &&
    index.includes("Ultimate was retired. Pro Max now includes all 15 venues.")
);
check(
  'non-applicable venues do not receive buyer-paid shipping',
  index.includes('const effectiveShipCharge = p.buyerShippingRevenue === false ? 0 : shipCharge;') &&
    (index.match(/buyerShippingRevenue: false/g) || []).length >= 8
);
check(
  'all-stale rankings show a reference-only warning',
  index.includes('All marketplace fee schedules are past the 45-day verification window.')
);
check(
  'hidden photo-tip images are deferred until the overlay opens',
  !index.includes('loading="lazy" src="/photo-tips/') &&
    index.includes("document.querySelectorAll('#photoTipsOverlay img[data-src]')")
);
check(
  'Stripe checkout requires verified token identity',
  stripeCheckout.includes("if (!idToken || idToken.length < 20)") &&
    !stripeCheckout.includes('fall through to body email')
);
check(
  'Stripe email fallback encodes plus-addressed emails',
  tierApi.includes("encodeURIComponent(email)")
);
check(
  'KV write failures are surfaced instead of returning false success',
  userDataApi.includes('kv_write_failed:') &&
    collectionApi.includes('kv_write_failed:')
);
check(
  'legacy unauthenticated Stripe redirect endpoints are removed',
  !fs.existsSync(path.join(root, 'api/stripe-pro-redirect.js')) &&
    !fs.existsSync(path.join(root, 'api/stripe-grade-redirect.js')) &&
    !fs.existsSync(path.join(root, 'api/stripe-id-redirect.js'))
);
check(
  'MTG pHash index is deployed and cached',
  vercel.includes('"src": "mtg-index.json"') &&
    vercel.includes('"src": "/mtg-index.json"')
);
check(
  'baseline security headers are configured',
  vercel.includes('"X-Content-Type-Options": "nosniff"') &&
    vercel.includes('"Strict-Transport-Security"') &&
    vercel.includes('"X-Frame-Options": "SAMEORIGIN"')
);

/* ── CR-021: mobile shop reachability ────────────────────────────────────
   The credit shop used to live only inside the gear settings panel, and the
   <=480px media query set `.hdr .settings-btn{display:none!important}`. On a
   phone in portrait that left NO route to buy ID scans or AI grades — a total
   revenue block on the majority device. These checks pin the fix. */

// Isolate the <=480px block so we only assert against mobile rules.
const mobileBlock = (index.match(/@media\(max-width:480px\)\{[\s\S]*?\n\}/) || [''])[0];

check(
  'CR-021 mobile media query does not hide the settings button',
  mobileBlock.length > 0 && !/\.hdr\s+\.settings-btn[^{]*\{[^}]*display:\s*none/.test(mobileBlock)
);
check(
  'CR-021 header exposes an always-visible Shop button',
  index.includes('id="shopBtn"') &&
    index.includes('openShop(\'id\',\'header\')') &&
    !/#shopBtn\s*\{[^}]*display:\s*none/.test(mobileBlock)
);
check(
  'CR-021 shop modal exists with both credit tabs',
  index.includes('id="shopOverlay"') &&
    index.includes('id="shopTabId"') &&
    index.includes('id="shopTabGrade"') &&
    index.includes('function openShop(')
);
check(
  'CR-021 shop lists all six credit packs at the canonical prices',
  ["shopBuy('id','10')", "shopBuy('id','50')", "shopBuy('id','100')",
   "shopBuy('grade','10')", "shopBuy('grade','25')", "shopBuy('grade','50')"]
    .every(s => index.includes(s)) &&
  ['$1.99', '$7.99', '$12.99', '$5.99', '$22.99'].every(s => index.includes(s))
);
check(
  'CR-021 shop reuses the hardened Stripe checkout starters',
  /function shopBuy\([\s\S]{0,260}startGradeScanCheckout\(qty\)[\s\S]{0,160}startIdScanCheckout\(qty\)/.test(index)
);
check(
  'CR-021 ?packs= deep link opens the shop, not the pack-less plan modal',
  index.includes("window.openShop(want, 'pricing_page_packs')") &&
    !index.includes("window.openPricingModal('pricing_page_packs_' + want)")
);
check(
  'CR-021 out-of-credit gates route to the shop rather than the plan modal',
  index.includes("openShop('id', 'id_scan_402')") &&
    index.includes("openShop('grade', 'grade_scan_402')") &&
    index.includes("openShop('grade', 'grade_scan_gate')") &&
    !index.includes("openPricingModal('id_scan_402')") &&
    !index.includes("openPricingModal('grade_scan_402')") &&
    !index.includes("openPricingModal('grade_scan_gate')")
);
check(
  'CR-021 low-credit toasts point at Shop, not the hidden Settings gear',
  !index.includes('top up anytime in Settings') &&
    !index.includes('tap Settings to buy more') &&
    index.includes('Shop to buy more')
);
check(
  'CR-021 client stores the monthly ID allowance so balances are not understated',
  index.includes('window._freeIdLeft = d.idFreeLeft || 0;')
);
check(
  'CR-021 shop copy does not claim the monthly allowance rolls over',
  index.includes('purchased credits never expire') &&
    !index.includes('Credits never expire, and unused ones roll over every month')
);

const originalFetch = globalThis.fetch;
globalThis.fetch = async () => ({
  ok: true,
  json: async () => ({
    market: 100,
    cardName: 'Charizard',
    setName: 'Base Set',
  }),
});

const req = {
  method: 'GET',
  query: {
    name: 'Charizard',
    set: 'Base Set',
    number: '4',
    game: ['pokemon', 'pokemon'],
  },
  headers: { host: 'www.cardresell.org' },
};
const res = {
  statusCode: 200,
  headers: {},
  body: null,
  setHeader(k, v) { this.headers[k] = v; return this; },
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
  end() { return this; },
};

try {
  await gradeOpportunity(req, res);
  check('duplicate query values do not crash grade-opportunity', res.statusCode === 200);
  check('grade-opportunity still returns a recommendation', !!res.body?.recommendation);
} catch (error) {
  check(`duplicate query values do not crash grade-opportunity (${error.message})`, false);
} finally {
  globalThis.fetch = originalFetch;
}

// ── CR-023: the shop refused money (2026-09-02) ──────────────────────────────
// A paying Ultimate subscriber could not buy anything. Two independent faults:
//   1. All three Stripe checkout endpoints 401'd when the verified token had no
//      top-level `email` claim -- even though entitlement is keyed on
//      metadata[google_sub] (the uid) and customer_email is only a prefill.
//   2. The toast that reported the failure was 698px wide on a 390px phone
//      (white-space:nowrap, no max-width), so it was clipped off both edges
//      and the user could not read why checkout failed.
{
  const fs = await import('node:fs');
  const rd = (f) => fs.readFileSync(new URL(f, import.meta.url), 'utf8');
  const CHECKOUTS = [
    '../api/stripe-id-checkout.js',
    '../api/stripe-grade-checkout.js',
    '../api/stripe-subscription-checkout.js',
  ];

  for (const f of CHECKOUTS) {
    const src = rd(f);
    const nm = f.split('/').pop();
    check(`${nm}: does not refuse checkout over a missing email`,
          !/missing an email/.test(src));
    check(`${nm}: only prefills customer_email when it is a real address`,
          /if \(userEmail && userEmail\.includes\('@'\)\) params\.set\('customer_email', userEmail\)/.test(src));
    check(`${nm}: never sends an unconditional customer_email`,
          !/^\s*customer_email:\s*userEmail,/m.test(src));
    // Entitlement must stay keyed on the uid, not the email -- that is the
    // whole reason dropping the prefill is safe.
    check(`${nm}: still stamps metadata[google_sub] for entitlement`,
          /metadata\[google_sub\]/.test(src));
  }

  const verifier = rd('../api/_verifyToken.js');
  check('_verifyToken recovers an email from firebase.identities.email',
        /identities\.email/.test(verifier) && /claimEmail/.test(verifier),
        'tokens without a top-level email claim still carry provider emails here');

  const html = rd('../index.html');
  // Strip CSS comments first: the rule carries a comment explaining the old
  // `white-space:nowrap` bug, and matching that prose would fail the check.
  const toast = (html.match(/\.cs-toast\{[^}]*\}/) || [''])[0]
    .replace(/\/\*[\s\S]*?\*\//g, '');
  check('toast is not nowrap (long messages must wrap, not clip)',
        !/white-space:\s*nowrap/.test(toast), toast.slice(0, 90));
  check('toast explicitly wraps', /white-space:\s*normal/.test(toast));
  check('toast is capped to the viewport width',
        /max-width:\s*min\(92vw/.test(toast),
        'an uncapped centered toast is clipped off BOTH edges on a phone');
  // The credit pills silently sliced their own labels: locked to equal flex:1
  // widths with overflow:hidden, "AI Grade · 1191 credits" lost its last
  // characters and looked like a pluralization bug.
  const pillRow = (html.match(/\.scan-sub-row\{[^}]*\}/) || [''])[0]
    .replace(/\/\*[\s\S]*?\*\//g, '');
  const pillBtn = (html.match(/\.scan-sub-btn\{[^}]*\}/) || [''])[0]
    .replace(/\/\*[\s\S]*?\*\//g, '');
  check('credit pill row wraps instead of slicing labels',
        /flex-wrap:\s*wrap/.test(pillRow), pillRow.slice(0, 90));
  check('credit pills do not clip their own text',
        !/overflow:\s*hidden/.test(pillBtn), pillBtn.slice(0, 120));
  check('credit pills can grow to fit a 4-digit balance',
        /min-width:\s*fit-content/.test(pillBtn));
  // Guard the real pluralisation, so a future "fix" for the truncation
  // symptom cannot quietly drop it.
  check('credit labels pluralise from the count',
        (html.match(/credit\$\{n !== 1 \? 's' : ''\}/g) || []).length >= 2);

  check('tier checkout surfaces the server error instead of a generic retry',
        /showToast\?\.\(msg \|\| 'Could not start checkout/.test(html),
        'swallowing data.error left the user staring at a broken shop');
}

/* ── 2026-09-02 · Venue system + Pro welcome ────────────────────────────────
   The invariant: paying for a plan UNLOCKS venues, it does not switch them on.
   A venue the seller never opted into must never be crowned best payout, and a
   foreign venue must never win on a payout that omits transatlantic postage. */
{
  const html = index;
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');   // strip our own comments

  check('venue groups define all four jobs',
        /VENUE_GROUPS\s*=/.test(code) &&
        ['list', 'foreign', 'consign', 'cash'].every(k => new RegExp(`key:\\s*'${k}'`).test(code)));
  check('default enabled venues are eBay + TCGplayer only',
        /VENUE_DEFAULT_ENABLED\s*=\s*\[\s*'ebay'\s*,\s*'tcgplayer'\s*\]/.test(code),
        'defaulting a paid tier to every venue is the whole bug this prevents');
  check('eligibility requires applicable AND unlocked AND enabled AND requirement met',
        /function venueEligible[\s\S]{0,320}?applicable[\s\S]{0,200}?venueUnlocked[\s\S]{0,200}?venueEnabled[\s\S]{0,200}?venueRequirementMet/.test(code));
  check('Cardmarket is gated on BOTH postage and an EU account',
        /VENUE_REQUIRES\s*=\s*\{\s*cardmarket:\s*\[\s*'intlShip',\s*'cmAccount'\s*\]\s*\}/.test(code),
        'postage alone let it win at $370.11 on a tile that says a US seller cannot register');
  check('Cardmarket prices the transatlantic leg, not domestic postage',
        /sellerShip:\s*intlShipCost\(\)\s*\|\|\s*shipCost/.test(code),
        'reverting to shipCost is what let Cardmarket win at $388.61');
  check('ranking derives eligibility through the venue engine',
        /r\.eligible\s*=\s*venueEligible\(r\.pid,\s*r\.applicable\)/.test(code));
  check('card applicability is preserved separately as `applicable`',
        /applicable:\s*true/.test(code) && /applicable:\s*false/.test(code),
        'the Pro upsell needs payouts for venues the plan has not unlocked');
  check('Pro upsell counts plan-locked venues, not disabled ones',
        /!_visible\.has\(r\.pid\)\s*&&\s*r\.applicable/.test(code),
        'filtering on r.eligible rendered "0 More Platforms"');
  check('cash-now AND consignment are held out of the payout ranking',
        /UNRANKED_VENUE_GROUPS\s*=\s*new Set\(\['cash',\s*'consign'\]\)/.test(code),
        'COMC won outright at $395.63 vs TCGplayer $366.13 while taking weeks to pay');
  check('ranking and rank badges both go through venueRanked()',
        (code.match(/venueRanked\(r\.pid\)/g) || []).length >= 2);
  check('unranked venues still render in their own sections',
        /_unranked/.test(code) && /\[\.\.\.eligible,\s*\.\.\._unranked,\s*\.\.\.ineligible\]/.test(code),
        'excluding them from `eligible` once made every buylist vanish');
  check('the consignment section states the float, not just the payout',
        /weeks to months before the cash lands/.test(code),
        'its payout can top every listing venue; the delay is the other half');
  check('fee-condition pills wrap instead of being clipped',
        /\.plat-flag\{[^}]*white-space:normal/.test(html) && !/\.plat-flag\{[^}]*white-space:nowrap/.test(html),
        '.plat-card is overflow-x:hidden, so a nowrap pill lost the end of the condition');
  check('section subtitles are actually rendered',
        /secDef\.sub \? `<div class="plat-section-sub">/.test(code),
        'sectionDefs.sub was dead data -- defined for all 3 sections, never printed');
  check('the buylist section is named to match the Pro Max welcome copy',
        /label:\s*'Cash now'/.test(code));
  check('Cardsphere is not filed under the ~50c-on-the-dollar section',
        /SECTION_OVERRIDES\s*=\s*\{\s*\}/.test(code),
        'it is a ranked buyer-offer marketplace, not a store buylist');
  check('only enabled venues render as tiles',
        /_displayTierPlatforms\.has\(r\.pid\)\s*&&\s*venueEnabled\(r\.pid\)/.test(code));
  check('a blocked venue explains itself',
        /'Add shipping to rank'/.test(code));
  check('the venue picker is reachable from the game row',
        /id="venuesBtn"[\s\S]{0,160}openVenuePicker\(\)/.test(html));
  check('locked picker rows route to Upgrade instead of toggling',
        /vp-row locked[\s\S]{0,200}openTierModal/.test(html));
  check('venue state can never be emptied to zero venues',
        /function setVenueEnabled[\s\S]{0,400}?size/.test(code));

  // Pro welcome
  check('welcome modal carries the approved title verbatim',
        /Thanks for supporting CardResell\./.test(html));
  check('welcome body states the US-defaults rationale verbatim',
        /so nothing foreign \(like Cardmarket\) can show as\s+best\s+payout by accident/.test(html));
  check('Pro Max is told consignment and buylists are both unranked',
        /Both sit in their own sections, out of\s+<strong[^>]*>Best Payout<\/strong>, so a store quote or a\s+weeks-long consignment payout cannot beat TCGPlayer by accident/.test(html),
        'the earlier copy pointed consignment at a Cash now tab it is not on');
  check('welcome offers exactly the three specified actions',
        /Use recommended \(US\)/.test(html) && /Choose venues/.test(html) &&
        /I&rsquo;ll do this later/.test(html));
  check('every exit path marks the user onboarded',
        /function proWelcomeUseRecommended[\s\S]{0,400}?_closeProWelcome/.test(code) &&
        /function proWelcomeChooseVenues[\s\S]{0,300}?_closeProWelcome/.test(code) &&
        /function proWelcomeLater[\s\S]{0,300}?_closeProWelcome/.test(code),
        'a welcome you cannot dismiss is a trap; the default is already safe');
  check('Escape dismisses the welcome',
        /e\.key !== 'Escape'[\s\S]{0,320}?proWelcomeLater/.test(code));
  check('welcome is gated on the paid venue tiers only',
        /tier !== 'pro' && tier !== 'pro_max' && tier !== 'ultimate'/.test(code),
        'buying scan credits unlocks no venues');
  check('welcome waits for the resolved tier before rendering Pro vs Pro Max copy',
        /_proWelcomePending/.test(code));
  check('buying scan credits does not trigger the venue welcome',
        !/scan_paid[\s\S]{0,600}?maybeShowProWelcome/.test(code));

  // Pre-existing crash found during this work.
  check('the post-render hook is actually defined',
        /function _onCardResultShown\s*\(/.test(code),
        'it was called at the end of every render but never defined');
  check('the one-time venue tip does not point at a foreign venue',
        /function _maybeShowVenueTip[\s\S]{0,600}?Whatnot or Mercari/.test(code) &&
        !/function _maybeShowVenueTip[\s\S]{0,600}?Cardmarket/.test(code));
  check('chips sync at the single state write point',
        /function _persistVenues[\s\S]{0,500}?_syncVenueChipsSafe/.test(code),
        'syncing only at the UI callsite let chips drift from persisted state');
}

// ── Time-to-sell tag (2026-09-02) ───────────────────────────────────────────
// The bug this locks: DAYS_TO_CASH gave Poshmark [3,7] — byte-identical to
// eBay — under the label "Estimated end-to-end cash time". That clock is the
// post-sale settlement window, so it silently assumed a buyer. Poshmark does
// not have a trading-card category, so on the axis that actually matters it is
// not eBay's equal. Velocity is now its own dimension.
{
  const html = index;
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');

  check('the payout clock is not labelled end-to-end',
        !/Estimated end-to-end cash time/.test(html) &&
        /Payout time after it sells/.test(html),
        'DAYS_TO_CASH starts once a buyer exists; it never measured listing-to-sale');
  check('sell speed is a separate axis from effort and from DAYS_TO_CASH',
        /const SELL_SPEED\s*=/.test(code) && /function sellSpeed/.test(code));
  check('every venue has a sell-speed entry',
        (() => {
          const ids = [...code.matchAll(/^  (\w+):\s*\{ name:/gm)].map(m => m[1]);
          const seg = code.slice(code.indexOf('const SELL_SPEED'),
                                 code.indexOf('function sellSpeed'));
          return ids.length >= 15 && ids.every(id => new RegExp('\\b' + id + ':\\s*\\{ tier:').test(seg));
        })(),
        'a missing entry renders a tile with a payout and no velocity context');
  check('the tag renders above the payout figure, not below it',
        /\$\{speedHtml\}\s*\n\s*<div class="plat-payout/.test(html),
        'the seller should see whether it sells before they see the number');
  check('every tier ships its sourced reason',
        (() => {
          const seg = code.slice(code.indexOf('const SELL_SPEED'),
                                 code.indexOf('function sellSpeed'));
          const tiers = seg.match(/tier:\s*'/g) || [];
          const whys  = seg.match(/why:\s*'/g) || [];
          return tiers.length === whys.length && tiers.length >= 15;
        })(),
        'a bare "Sells fast" is an assertion; the reason is what makes it checkable');

  // No invented durations. Research across all 15 venues found that none
  // publishes an average days-to-sell for cards, so any day-range in a tier
  // label would be fabricated. Whatnot's "seconds to minutes" is the one
  // allowed duration — it is the published in-show auction length.
  check('no fabricated day-counts in the sell-speed labels',
        (() => {
          const seg = code.slice(code.indexOf('const SELL_SPEED'),
                                 code.indexOf('function sellSpeed'));
          return !/\d+\s*[-–]\s*\d+\s*(days?|weeks?|months?)/i.test(seg) &&
                 !/(average|avg)[^']{0,24}\d+\s*days?/i.test(seg);
        })(),
        'no venue publishes a days-to-sell figure — inventing one stamps a lie');

  // The same rule applies to the venue registry, not just SELL_SPEED. Effort
  // labels, hassle lines and red-flag pills were the original home of guessed
  // durations ("Listings often sit for weeks", "weeks to list") — unsourced,
  // and precisely what the velocity axis was added to replace.
  check('no guessed listing durations in effort labels, hassle lines or red flags',
        (() => {
          const seg = code.slice(code.indexOf('const PLATFORMS'),
                                 code.indexOf('const FREE_PLATFORMS'));
          const claims = [
            ...(seg.match(/effortLabel:\s*'[^']*'/g) || []),
            ...(seg.match(/hassle:\s*'[^']*'/g) || []),
            ...(seg.match(/redFlags:\s*\[[^\]]*\]/g) || []),
          ].join(' | ');
          return !/(sit|sits|sitting|listings?)[^|]{0,40}(for )?(weeks|months)/i.test(claims) &&
                 !/weeks to list/i.test(claims);
        })(),
        'no venue publishes a days-to-sell figure, so a duration here is invented');
  check('effort no longer doubles as an audience-depth claim',
        !/effortLabel:\s*'[^']*(thin|tiny) card audience/i.test(code),
        'effort is workflow; audience depth belongs to SELL_SPEED');

  // Poshmark is a category problem, not a speed problem.
  check('Poshmark is flagged as having no card category at all',
        /poshmark:\s*\{ tier: 'blocked'/.test(code) &&
        /Cards are not a Poshmark category/.test(code),
        'its policy excludes items outside supported categories');
  check('Mercari is not lumped in with Poshmark',
        /mercari:\s*\{ tier: 'fast'/.test(code),
        'Mercari has a real Trading Cards tree and card-only shipping labels');

  // The four buylists have no listing-to-sale clock to be slow on.
  check('buylists are marked instant, never slow',
        ['cardkingdom', 'coolstuffinc', 'scg', 'tcgbulk']
          .every(id => new RegExp(id + ":\\s*\\{ tier: 'instant'").test(code)),
        'they are the buyer — a "slow to sell" warning would be factually wrong');

  // Cardmarket: verified against the live signup form's country <select>.
  check('Cardmarket is flagged as closed to US sellers, not merely expensive',
        /US sellers cannot register/.test(html) &&
        /32 European countries/.test(html),
        'the country list has no United States option');
  check('the Cardmarket warning no longer hedges on eligibility',
        !/may not be able to register at all/.test(html),
        'the registration form was read directly: 32 options, none of them the US');
  check('Cardmarket is a geography block, not a demand claim',
        !/cardmarket[\s\S]{0,400}?(sells? slower|low demand|weak demand)/i.test(code),
        'it has the deepest card demand in Europe — the blocker is access');
}

// ---------------------------------------------------------------------------
// Part H — dead outbound market links (audited 2026-09-02 in real Chromium).
// Every URL banned here returned a genuine 404 with a "page not found" body.
// Every URL required here was loaded and confirmed to render real content.
// If a market moves a route again, fix the URL — do not delete the check.
// ---------------------------------------------------------------------------
{
  const html = index;
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');   // strip our own comments
  check('no links to the retired cgccomics.com card-submit route',
        !/cgccomics\.com\/cards\/submit/.test(html),
        'CGC moved cards to cgccards.com; the old path 404s');
  check('CGC submissions point at cgccards.com/submit/',
        /cgccards\.com\/submit\//.test(html),
        'verified 200, title "How To Submit | Card Submissions | CGC"');
  check('no link to the dead acegrading.com/submit route',
        !/acegrading\.com\/submit(?![\w-])/.test(html),
        'it redirected to a "404 NOT FOUND" page');
  check('Ace Grading points at its how-to-submit page',
        /acegrading\.com\/how-to-submit/.test(html),
        'verified 200 on the real submission guide');
  check('no link to the dead poshmark.com/fee page',
        !/poshmark\.com\/fee(?![\w-])/.test(html),
        '"Page Not Found - Poshmark"');
  check('Poshmark fee source points at the live support article',
        /support\.poshmark\.com\/s\/article\/297755057/.test(html),
        'that article states the $2.95 under-$15 / 20% structure the model uses');
  check('no link to the dead manapool.com/sell route',
        !/manapool\.com\/sell(?![\w-])/.test(html),
        'Mana Pool 404s /sell; seller onboarding lives at /seller-info');
  check('Mana Pool sell CTA points at /seller-info',
        /manapool\.com\/seller-info/.test(html),
        'verified 200, "Information for Sellers"');
  check('no links to the dead fanaticscollect.com/search route',
        !/fanaticscollect\.com\/search/.test(html),
        'Fanatics Collect search returns 404 "Something Went Wrong"');
  check('Fanatics search uses the /marketplace?q= route',
        (html.match(/fanaticscollect\.com\/marketplace\?q=/g) || []).length >= 2,
        'verified 200 with real result counts on both the comp and sell links');

  // The eBay sell URL was double-wrapped: buildEbaySearchUrl already appends the
  // EPN block, so re-wrapping it emitted campid/mkevt/customid twice per URL.
  check('the eBay sell URL is not re-wrapped with affiliate params',
        /ebay:\s*ebaySellRaw,/.test(code) &&
        !/ebay:\s*buildEbayUrl\(ebaySellRaw\)/.test(code),
        'buildEbaySearchUrl already returns an affiliate-tagged URL');
  check('the eBay campaign id is still present exactly once per built URL',
        /campid=\$\{encodeURIComponent\(campId\)\}/.test(code),
        'dedupe must not strip EPN tracking — commission still has to attribute');
}

// ---------------------------------------------------------------------------
// Part I — every venue tile must resolve to a live link, and the whole tile
// must be tappable. Before this, 8 of 15 venues emitted '' for a wrong-game
// scan, so those tiles rendered no CTA at all, and only the small pill was
// clickable — tapping the large tile on a phone did nothing.
// ---------------------------------------------------------------------------
{
  const html = index;
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');

  check('no link to the COMC wildcard buy route',
        !/comc\.com\/Cards\/\*\/buy/.test(html),
        'that path returns HTTP 500 Server Error / Runtime Error');
  check('no link to the COMC bare Search endpoint',
        !/comc\.com\/Search\?q=/.test(html),
        'it silently drops the query and dumps the user on the unfiltered catalog');
  check('COMC search uses the live /Cards,= route',
        /comc\.com\/Cards,=\$\{comcPath\}/.test(code),
        'verified against COMC own search box: 653 hits for Charizard');
  check('COMC query encodes slashes and spaces the way COMC does',
        /'~2f'/.test(code) && /comcPath/.test(code),
        '"Charizard 4/102" must become Charizard+4~2f102 or the search misses');
  check('COMC falls back to a real seller page when the query is empty',
        /comc\.com\/Sell'/.test(code),
        'never emit a bare /Cards,= with nothing after the equals sign');

  check('CardNexus uses its real card search for TCG scans',
        /cardnexus\.com\/en\/search\?q=/.test(code),
        'verified 200 Search Cards - CardNexus, better than the generic explainer');

  for (const v of ['cardsphere', 'cardmarket', 'cardkingdom', 'coolstuffinc',
                   'scg', 'cardnexus', 'tcgbulk', 'manapool']) {
    check(v + ' never emits an empty sell URL',
          !new RegExp(v + ": *[a-zA-Z]+ \\? [a-zA-Z]+Url : ''").test(code),
          'an empty URL renders a tile with no CTA, which reads as dead artwork');
  }
  check('TCGplayer falls back to its homepage instead of an empty string',
        /tcgplayer: *isTCGGame \? tcgpUrl : 'https:\/\/www\.tcgplayer\.com\/'/.test(code),
        'sports scans still deserve a live link, just not a card-specific one');

  check('ineligible venues say View on rather than Sell on',
        /const sellVerb *= *r\.eligible \? 'Sell on' : 'View on'/.test(code),
        'a live link must never promise a sale the venue cannot accept');
  check('the ineligible tile branch still renders its sell badge',
        /<div class="plat-sub">\$\{r\.note\}<\/div>\s*\$\{sellBadge\}/.test(html),
        'this is the branch that previously dropped the CTA entirely');

  check('venue tiles carry the data-sell-url hook',
        (html.match(/data-sell-url="\$\{esc\(sellUrl\)\}"/g) || []).length >= 2,
        'both the eligible and the ineligible tile branch need it');
  check('tiles with a link get a pointer cursor',
        /\.plat-card\[data-sell-url\]\{cursor:pointer\}/.test(html),
        'cursor:default made the tile look unclickable');
  check('a delegated listener opens the tile link',
        /_platTileTapBound/.test(code) &&
        /closest\('\.plat-card\[data-sell-url\]'\)/.test(code),
        'tapping the large tile is the natural phone gesture');
  check('the tile handler defers to real interactive children',
        /closest\('a,button,input,select,textarea,label,\[role="button"\]'\)/.test(code),
        'otherwise the details toggle and venue switches would open the venue');
}


// Part J — sports honesty (2026-09-03).
// Sports cards cannot be priced automatically: PriceCharting's API does not
// reliably resolve them (it ranks Funko POP and Marvel/Star Wars sets above the
// real card), so the sports path is manual-price-only and is labelled as being
// under maintenance (never "beta" — product call 2026-09-03).
// These checks stop the marketing copy from drifting back to claiming the
// sports path prices cards the way the TCG path does.
{
  const html = index;
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');

  check('hero copy no longer claims sports card search',
        !/Search any[^<]*sports card/.test(html),
        'the hero must not advertise a lookup the sports path cannot perform');
  check('intro copy no longer claims sports card search',
        !/Find any[^<]*sports card/.test(html),
        'same claim, second placement');
  check('meta description no longer claims sports pricing',
        !/name="description"[^>]*or sports card is really worth/.test(html),
        'search snippets outlive the page and must not overpromise');

  // 2026-09-03: markers REMOVED. Sports now returns a real graded guide price
  // for an exact user-picked parallel, with the source and its age named on the
  // confirm strip. The label had become the inaccurate part of the screen --
  // it told sellers not to trust a number that is now the same class of number
  // the TCG path shows. If sports pricing ever regresses to manual-only, this
  // check is the thing to flip back, not the label to quietly re-add.
  check('the sports game option no longer claims maintenance',
        !/<option value="sports">[^<]*under maintenance/i.test(html) &&
        !/<option value="sports">[^<]*\u{1F6E0}/u.test(html),
        'sports prices for real now; the marker would be the lie');
  check('the sports form title no longer claims maintenance',
        !/sports-form-title"[^>]*>[\s\S]{0,240}?under maintenance/i.test(html));
  check('the scan gate no longer says sports pricing is under maintenance',
        !/sports pricing is under maintenance/i.test(html),
        'both the static copy and the JS that rewrites it');
  check('the word maintenance is gone from the sports surfaces',
        !/under maintenance/i.test(html));
  check('the sports form explains how pricing works',
        /can’t pull a live sold comp automatically/.test(html) ||
        /Pick your exact variant/.test(code),
        'the form must say where the number comes from, or that there is none');
  check('the sports path is never described as a beta',
        !/beta/i.test(html),
        'product call: say under maintenance, not beta');

  // 2026-09-03: this used to require the literal
  //   key: 'manual', label: 'Manual / Override', market: null
  // to appear at least TWICE -- which pinned a copy-paste duplication rather
  // than the property it was defending. The stated intent is "the tile must
  // not invent a net payout", so assert that directly: a freshly built sports
  // card carries no priced variant, and a price only arrives once the user has
  // picked an exact PriceCharting product.
  check('sports cards start with no priced variant',
        /priceVariants: \[\],\s*\/\/ filled from PriceCharting's real parallel list/.test(code),
        'an empty variant list is what keeps the tile from inventing a net payout');

  check('sports cards are built in exactly one place',
        (code.match(/function _buildSportsCard\(/g) || []).length === 1 &&
        !/const sportCard = \{\s*name: `\$\{emoji\}/.test(code),
        'two copies of the builder is how one gets fixed and the other does not');

  check('the sports pricing facets the API reads are actually set',
        /\/\/ Facets the pricing call needs\. Previously absent\.\s*\n\s*year, sport, brand,/.test(code),
        'the API scores candidates on year/sport/brand; omitting them matched Funko POPs');

  check('a sports price is only fetched for an exact product id',
        /_priceSportsVariant/.test(code) && /game: 'sports', pcid: v\.id/.test(code),
        'fuzzy re-resolution could price a different parallel than the one picked');

  check('the variant confirm strip names the card before pricing it',
        /id="sportsConfirm"/.test(html) && /Pick your exact variant/.test(code),
        'a sports dollar figure is uncheckable without the product it came from');

  check('sports reuses the scan photo instead of a blank image',
        /_sportsScanImageFor/.test(code) &&
        /window\._sportsScanImageUrl/.test(code),
        'sports has no image CDN, so the user photo is the only real picture');
  check('the scan photo is keyed to the player it depicts',
        /want !== own\) return ''/.test(code),
        'otherwise a previous scan leaks onto an unrelated card');
}


// Part K — Cardmarket may not be crowned on access we cannot verify (2026-09-03).
// Entering $18.50 postage used to make Cardmarket BEST at $370.11 over
// TCGplayer's $366.13, on the same tile whose own note says Cardmarket's signup
// form offers 32 European countries and no US option, so a US seller cannot
// register. The payout was right; the crown was not. Cardmarket now needs an
// explicit EU-account confirmation on top of postage.
{
  const html = index;
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');

  check('the EU-account confirmation defaults to false',
        /function cmAccountConfirmed\(\)[\s\S]{0,220}?let v = false/.test(code),
        'we must never assume access to a venue the seller cannot register for');
  check('the confirmation is read from its own storage key',
        /_VENUE_CM_ACCT_KEY = 'cr_cm_account'/.test(code) &&
        /getItem\(_VENUE_CM_ACCT_KEY\) === '1'/.test(code),
        'it must not piggyback on the postage key or the venue-enabled set');

  check('requirements are evaluated as a list, all of which must pass',
        /venueRequirements\(pid\)\.every\(/.test(code),
        'a single-value check silently ignored the second requirement');
  check('the account requirement is wired into requirementMet',
        /req === 'cmAccount'\s*\)\s*return cmAccountConfirmed\(\)/.test(code),
        'without this the array is decorative and the crown still lands');

  check('a missing account produces its own block reason',
        /Needs an EU account to rank/.test(code),
        'the seller must be told which of the two prerequisites is missing');
  check('the tile says why it cannot rank instead of a bare N/A',
        /venueBlockBadge\(r\.pid\)/.test(code) &&
        /badge-na[^`]*\$\{blockBadge\}/.test(code),
        'N/A reads as missing data when the truth is an unmet prerequisite');
  check('the block badge stays short enough for the badge slot',
        /return 'Needs postage'/.test(code) && /return 'Needs EU acct'/.test(code),
        'long strings overflow the rank-badge pill');

  check('the picker exposes the EU-account checkbox',
        /id="vpCmAccount"/.test(html) &&
        /onCmAccountToggle\(this\.checked\)/.test(html),
        'the gate is only fair if the seller can clear it');
  check('toggling the account re-renders the ranking',
        /function onCmAccountToggle[\s\S]{0,200}?_rerenderVenueResults\(\)/.test(code),
        'a stale crown after toggling would contradict the new state');
  check('the picker explains the US signup limitation next to the checkbox',
        /32 European countries and no United States/.test(html),
        'the seller needs the reason, not just a switch');
  check('Cardmarket still shows its payout when unconfirmed',
        /still shows its payout\s*\n?\s*for reference/.test(html),
        'the venue is reference-only when blocked, not hidden');
}


// Part L — paying must never switch venues on for you (P0-3, verified 2026-09-03).
// Browser-verified: landing on ?pro=1 as pro and as pro_max leaves the enabled
// set at exactly ['ebay','tcgplayer'] and ranks 2 tiles; all five exits (Use
// recommended / Choose venues / I'll do this later / X / Escape) leave it at 2;
// the modal fires once; a lapsed subscriber with 15 stored venues still ranks
// only 2. These checks pin the source-level invariants behind that.
{
  const html = index;
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');

  // The bug this whole item guards against is a bulk enable-everything call.
  // Written as a scan over product code so ANY new bulk-enable trips it, not
  // just the shapes we thought of.
  const bulkEnable = /_allVenueIds\(\)[\s\S]{0,80}?setVenueEnabled\([^)]*,\s*true\s*\)/.test(code) ||
                     /venuesEnabled\(\)\s*=\s*new Set\(_allVenueIds\(\)\)/.test(code) ||
                     /_venuesEnabled\s*=\s*new Set\(_allVenueIds\(\)\)/.test(code);
  check('no code path bulk-enables every venue',
        !bulkEnable,
        'paying for a plan unlocks venues; it must never switch them on');

  check('the only writer of venue state is the picker toggle',
        (code.match(/setVenueEnabled\(/g) || []).length === 2,
        'one definition + one caller; a third caller means something else flips venues');

  check('the recommended button RESETS rather than adds',
        /function proWelcomeUseRecommended[\s\S]{0,200}?resetVenuesToRecommended\(\)/.test(code),
        'adding to an existing set would let a stale 15-venue device stay at 15');
  check('reset means exactly the recommended set, not a merge',
        /function resetVenuesToRecommended[\s\S]{0,140}?=\s*new Set\(VENUE_DEFAULT_ENABLED\)/.test(code));

  // A lapsed or downgraded subscriber keeps their stored picks in localStorage.
  // Those must stay inert until the plan covers them again — enforced by the
  // unlocked term inside venueEligible, not by rewriting their saved choices.
  check('stored venues stay inert without the plan that unlocks them',
        /function venueEligible[\s\S]{0,320}?venueUnlocked\(/.test(code),
        'a downgraded device still has 15 venues in localStorage');
  check('unknown or retired venue ids are dropped from storage',
        /stored\)\s*\?\s*stored\.filter\(v => valid\.includes\(v\)\)/.test(code));

  check('the welcome fires once and remembers it',
        /PRO_WELCOME_KEY = 'cr_pro_venues_onboarded'/.test(code) &&
        /function maybeShowProWelcome[\s\S]{0,260}?if \(proVenuesOnboarded\(\)\) return false/.test(code));
  check('the welcome names eBay and TCGPlayer as the recommended pair',
        /eBay and TCGPlayer/.test(html),
        'the spec fixes the recommended set at these two');
}


// Part M — the fabricated grade-opportunity tile stays withdrawn (2026-09-03).
// /api/grade-opportunity never looked up a graded price: it returned
// rawPrice * a hardcoded tier multiplier and the UI called that a "PSA 10
// comp". On Base Set 2 Charizard it printed $1700 against a real PSA 10
// market of $18-30k. Off the air until a datable graded price AND a grade
// distribution exist.
{
  const html = index;
  const code = html.replace(/\/\*[\s\S]*?\*\//g, '');

  check('the grade-opportunity renderer is an unconditional no-op',
        /function renderGradeOpportunity\(g\)\s*\{\s*return '';\s*\}/.test(code),
        'the guard must be first and unconditional, not a branch');

  check('the grade-opportunity endpoint is no longer called',
        !/fetch\(\s*['"`]\/api\/grade-opportunity/.test(code),
        'a withdrawn tile should not still cost a request');

  // The invented figures must not reach the DOM from any other path.
  check('no live caller renders the withdrawn payoff copy',
        !/could be worth \$\$\{gradedEst\} graded[\s\S]{0,40}?(?!_withdrawn)/.test(
          code.replace(/function _renderGradeOpportunity_withdrawn[\s\S]*?\n\}\n/, '')),
        'the dead body is parked behind a _withdrawn name; nothing may call it');

  check('the withdrawn body is parked, not deleted, and unreferenced',
        /function _renderGradeOpportunity_withdrawn/.test(code) &&
        (code.match(/_renderGradeOpportunity_withdrawn/g) || []).length === 1,
        'exactly one occurrence = the definition, with no call sites');

  // Keeps the next person from "fixing" this by swapping in a real PSA 10
  // price, which makes it worse: $1700 becomes $11695 and reads as a promise.
  check('the multiplier rationale is recorded next to the withdrawal',
        /grade distribution/i.test(html) && /expected value/i.test(html),
        'the reason must survive so this is not re-enabled naively');
}

// ── Scanned-card identity: never load a card whose NAME we did not confirm ──
// 2026-09-03 report: scan read "Fennekin" / "080" and the panel said "Loading
// Fennekin - 080", then rendered Snorlax (Flashfire #80) at $4.72 with
// Snorlax's art. No Fennekin printing has number 80, so every name-checked
// path missed and a number-only, name-blind fallback matched on the digits
// alone. Wrong Pokemon, wrong picture, wrong price, presented with confidence.
{
  // Anchor inside _loadScannedCardExactImpl. Do NOT anchor on the first
  // 'let match = null;' in the file -- that one is fetchTPLGradedByNameNumber,
  // whose candidates all come from a name query already.
  const fnAt  = index.indexOf('async function _loadScannedCardExactImpl');
  const start = index.indexOf('let match = null;', fnAt);
  const end   = index.indexOf('NOTE: intentionally NOT falling back', start);
  check('the scanned-card matcher block is still findable',
        fnAt > 0 && start > fnAt && end > start);
  const block = index.slice(start, end);

  // Every candidate pick in this block must be name-constrained.
  const finds = block.match(/match = cards\.find\([\s\S]*?\);/g) || [];
  check('the scanned-card matcher still has candidate-picking branches',
        finds.length >= 4);
  const nameBlind = finds.filter(f => !f.includes('nameMatches(c)'));
  check('every scanned-card match requires the scanned name',
        nameBlind.length === 0,
        nameBlind.length ? `name-blind branch(es):\n${nameBlind.join('\n---\n')}` : '');

  // The specific fallback that produced Snorlax must stay gone.
  check('the number-only match reason is gone',
        !/matchReason = 'number-only'/.test(index));

  // A miss must stay a miss -- no silent first-result fallback.
  check('the matcher still refuses to fall through to cards[0]',
        /intentionally NOT falling back to cards\[0\]/.test(index));

  // Keep the reason on the page so this is not "simplified" back in.
  check('the Fennekin/Snorlax rationale is recorded at the removal site',
        /Fennekin/.test(index) && /Snorlax/.test(index));
}

// ── A scanned sports card must reach the parallel picker on its own ──
// Before this, _routeScannedSportsCard filled the form and stopped. The only
// callers of loadSportsCardFromSearch were comp-source click handlers in the
// dropdown, and every one of them also window.open()s an external tab -- so
// the card panel and the parallel list were unreachable unless the seller
// happened to open eBay first. A scan that cannot produce a price is a scan
// that charged a credit for nothing.
{
  const fnAt = index.indexOf('function _routeScannedSportsCard');
  check('the scanned-sports route is still findable', fnAt > 0);
  const body = index.slice(fnAt, index.indexOf('\nfunction ', fnAt + 10));
  check('a scanned sports card loads the card panel itself',
        /loadSportsCardFromSearch\(/.test(body),
        'otherwise the parallel picker is only reachable via an external tab');
  check('the scanned-sports panel load is guarded to the sports game',
        /activeGame === 'sports'/.test(body),
        'a deferred load must not fire after the user switches games');
  check('the scan toast points at the parallel picker',
        /pick your exact parallel to price it/.test(body),
        'must not tell the user to tap a comp source that no longer prices it');
}

// ── Set matching must prefer the closest set, not the first substring hit ──
// Every set test in the scanned-card matcher is `.includes(scannedSet)`, so a
// scan reading "Base" matched "Base Set 2" as readily as "Base Set" and .find()
// took whichever the API listed first. For Charizard that mistake is most of
// the card's value.
{
  const fnAt = index.indexOf('async function _loadScannedCardExactImpl');
  const start = index.indexOf('let match = null;', fnAt);
  const pre = index.slice(fnAt, start);
  check('candidates are ranked by set specificity before matching',
        /setScore/.test(pre) && /\.sort\(/.test(pre),
        'ranking must happen before the first .find(), not after');
  check('an exact set-name match outranks a substring match',
        /=== wantSet\) return 3/.test(pre));
  check('a whole-word set match outranks a bare substring',
        /return 2/.test(pre) && /includes\(wantSet\) \? 1 : 0/.test(pre));
  check('ties prefer the set with the fewest extra words',
        /wantSetWords/.test(pre),
        '"Base" must prefer "Base Set" over "Base Set 2"');
  check('the ranking sort is stable',
        /\(a\.i - b\.i\)/.test(pre),
        'equal-ranked candidates must keep API order so nothing stops matching');
}

// ── Price integrity: an ask book is never published as a sale price ────────
// Audit 2026-09-03. api/tcg-price.js had a "sanity valve" that fell back to the
// ask blend whenever Market disagreed with the median ask by more than 3x. On
// thin vintage books there are no recent sales, so holdout asks sit far above
// the last real transaction and the valve published those asks as Market.
// EX Dragon Frontiers Charizard Star #100 (product 84198) is the worked case:
// TCGCSV gave marketPrice $1,000 / low $18,500 / mid $20,000 / high $39,500 and
// production served a $19,800 headline -- 19.8x the only actual-sales number.
{
  const tcgPrice = fs.readFileSync(path.join(root, 'api/tcg-price.js'), 'utf8');
  const fnAt = tcgPrice.indexOf('function _headlinePrice');
  const fnEnd = tcgPrice.indexOf('function _trimmedMean');
  const headline = tcgPrice.slice(fnAt, fnEnd);

  check('_headlinePrice is findable', fnAt !== -1 && fnEnd > fnAt);
  check('the ask-blend sanity valve is gone',
        !/M > D \* 3 \|\| M < D \/ 3/.test(headline),
        'a >3x Market/ask gap must not swap in the blend');
  check('the blend survives only as the no-Market fallback',
        (headline.match(/_trimmedMean/g) || []).length === 1
          && /No sale price to trust/.test(headline),
        'an absent marketPrice is the one case where an ask is the best signal');
  check('a present Market is returned unchanged',
        /return Math\.round\(M \* 100\) \/ 100;/.test(headline));
  check('the $1,000 -> $19,800 case is documented in code',
        /19,?800/.test(headline) && /84198/.test(headline),
        'the worked example must stay next to the code it explains');

  check('sharp Market/ask disagreement is disclosed instead of hidden',
        /function _marketAskDivergence/.test(tcgPrice)
          && /marketAskDivergence/.test(tcgPrice),
        'removing the valve must not also remove the signal');
  check('divergence is reported, not silently applied',
        /data\.marketAskDivergence = _div/.test(tcgPrice));

  check('the TCG cache key moved with the pricing change',
        /`v10\|\$\{game\}/.test(tcgPrice) && !/`v[89]\|\$\{game\}/.test(tcgPrice),
        'a code change does NOT invalidate KV -- stale entries would keep serving $19,800');

  check('the high clamp is the 3x the docs now describe',
        /_HIGH_CAP_MULT = 3\.0/.test(tcgPrice));
}

// ── Price integrity: a name-only lookup never substitutes another card ─────
// Measured on 17 name-only Pokemon lookups: median absolute multiplicative
// error 11.14x, in both directions. "Pikachu" resolved to Pikachu & Zekrom GX
// (605.6x) and "Mew" to Mew ex (995.8x), because pickProduct matched loosely and
// the ranking then took the highest market price among whatever matched. The
// failure is identity, not magnitude, so no numeric penalty can repair it.
{
  const tcgcsv = fs.readFileSync(path.join(root, 'api/_tcgcsv.js'), 'utf8');

  check('Pokemon name matching requires the full canonical name',
        /function _canonicalCardName/.test(tcgcsv)
          && /_canonicalCardName\(product\.name\) !== _canonicalCardName\(cardName\)\) continue/.test(tcgcsv),
        '"Mew" must not widen to "Mew ex"');
  check('only catalog decoration is stripped before comparing',
        /\\\(\[\^\)\]\*\\\)/.test(tcgcsv) && /stripCollectorSuffix/.test(tcgcsv),
        'parentheticals and collector suffixes yes; the rest of the name no');
  check('apostrophes are deleted rather than spaced',
        /Farfetch/.test(tcgcsv),
        '"Farfetch\'d" and "Farfetchd" must stay the same card');
  check('sealed product cannot answer a card request',
        /function _isSealedProductName/.test(tcgcsv)
          && /_isSealedProductName\(product\.name\)\) continue/.test(tcgcsv));
  check('collection boxes are treated as sealed',
        /box\|collection\|bundle\|tin\|deck\|pack/.test(tcgcsv));

  check('an ambiguous name-only Pokemon lookup refuses to guess',
        /reason: 'ambiguous_printing'/.test(tcgcsv),
        'ranking several sets by price presents a guess as a valuation');
  check('ambiguity is only raised when no number narrows it',
        /isPokemon && !cardNumber/.test(tcgcsv),
        'a collector number disambiguates honestly');
  check('the refusal names its candidates',
        /candidates: allMatches\.slice/.test(tcgcsv),
        'the caller needs to prompt for a set, so it needs the options');

  check('the resolver returns the real group name',
        /groupName: bestGroupName/.test(tcgcsv),
        'name-only responses were returning an empty setName');
}

// ── /accuracy must describe the clamp the code actually applies ────────────
// Commit 005b683 shipped a universal 3x display clamp; 1607fa1 then documented
// 4x with a max(4 x Market, 1.5 x Low) formula that was never implemented, and
// claimed payout is calculated from High when it is calculated from Market.
{
  const accuracy = fs.readFileSync(path.join(root, 'accuracy.html'), 'utf8');
  check('no unimplemented 4x clamp formula is documented',
        !/max\(4 ?(&times;|×) ?Market/.test(accuracy) && !/4(&times;|×) ?Market/.test(accuracy),
        'do not stamp a lie: the code clamps at 3x');
  check('/accuracy states the real 3x clamp',
        /3 ?(&times;|×) ?Market/.test(accuracy));
  check('/accuracy no longer says payout is calculated from High',
        !/Net Payout is calculated against a clamped/.test(accuracy));
  check('/accuracy states payout comes from Market Value',
        /Net Payout is calculated from Market Value/.test(accuracy));
}

// ── The live TCGplayer fallback cannot resurrect a rejected identity ────
// The tcgcsv resolver's guards ("Mew" != "Mew ex", no sealed product) are
// bypassed if the code falls through to the fuzzy live TCGplayer search,
// which scores by substring hits and has no equality gate. Prod verify
// 2026-09-03: "Iono" (name-only) came back as "Iono Premium Tournament
// Collection Display" through this fallback -- $318 for a sealed product,
// not the card. Same discipline must live in both paths.
{
  const tcgPrice = fs.readFileSync(path.join(root, 'api/tcg-price.js'), 'utf8');

  check('ambiguous_printing short-circuits before the live fallback',
        /rByName\.reason === 'ambiguous_printing'/.test(tcgPrice)
          && /reason: 'ambiguous_printing'/.test(tcgPrice),
        'refusing to guess must not become guessing via a different path');

  const liveStart = tcgPrice.indexOf('// ── FALLBACK: live TCGplayer search');
  const liveEnd = tcgPrice.indexOf('async function priceFromScryfall');
  const live = tcgPrice.slice(liveStart, liveEnd);

  check('live fallback rejects sealed product for Pokemon',
        /categoryId === 3/.test(live) && /_sealed\(r\.productName\)/.test(live),
        'the fuzzy path had no equality gate');
  check('live fallback requires an exact canonical name for Pokemon',
        /_canon\(pnStripped\) !== _targetCanon/.test(live));
  check('the live fallback strips a trailing collector suffix before comparing',
        /pnStripped = productName\.replace/.test(live)
          && /_canon\(pnStripped\)/.test(live),
        'products list "- 185/193" after the name; strip it, then compare');
  check('rejected rows are filtered before picking a winner',
        /const passing = scored\.filter/.test(live)
          && /reason: 'no_valid_match'/.test(live));
}

// ── Freshness contract: no invented refresh cadence ────────────────────
// The per-variant caption used to append "Updated daily" to any source label
// that did not already mention a date. Nothing verified that cadence for any
// source it was applied to -- least of all PriceCharting, which publishes no
// as-of date at all, and which supplies the graded (PSA 10 / BGS 10) guide
// values. The most expensive numbers in the app carried a fabricated
// freshness promise.
{
  const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  check('there is exactly one price-caption renderer',
        (idx.match(/function _renderPriceCaption\(/g) || []).length === 1,
        'three independent formatters made three different claims');

  // Scryfall is the ONE source whose daily cadence is published:
  // "Scryfall syncs prices from each of our affiliates every 24 hours."
  const dailyClaims = idx.split('\n')
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => /Updated daily/.test(l) && !/^\s*\/\//.test(l));
  check('the only live "Updated daily" claim is the documented Scryfall one',
        dailyClaims.length === 1 && /Scryfall/.test(dailyClaims[0][1]),
        `unverified cadence claims at lines ${dailyClaims.map(d => d[0]).join(', ')}`);
  check('the Scryfall cadence claim cites its source',
        /where-do-scryfall-prices-come-from/.test(idx),
        'a cadence claim needs a citation, not a habit');

  check('no fallback appends a daily cadence to an unknown source',
        !/`\$\{srcLabel\} · Updated daily`/.test(idx),
        'this was the line that stamped PriceCharting graded values');

  check('the caption reports our own retrieval age',
        /retrieved \$\{_ageStr\(/.test(idx));
  check('an undated source is labelled as undated',
        /datedBySource === false/.test(idx) && /no price date/.test(idx),
        'silence about a missing date reads as a fresh price');
  check('a real feed date outranks a retrieval age',
        /if \(updatedAt && updatedAt !== 'Enter via override'\)/.test(idx)
          && /\} else if \(cacheAgeSec != null\)/.test(idx),
        'never show both -- they answer different questions');

  // ── PriceCharting citation travels with every PC-sourced price ──
  // A guide value the seller cannot click through to is a number they have to
  // take on faith. Every PC-injected row carries its source URL.
  const pcRowUrls = (idx.match(/source: 'pricecharting',\s*\n(?:.*\n){0,6}?\s*url:\s*pc\.url/g) || []).length;
  const pcRowsTotal = (idx.match(/source: 'pricecharting',/g) || []).length;
  check('every PriceCharting-sourced row carries its source url',
        pcRowUrls >= 3 && pcRowUrls === pcRowsTotal,
        `${pcRowUrls}/${pcRowsTotal} pricecharting rows have a url`);
  check('the caption renders the source as a link when a url exists',
        /rel="noopener"[^`]*\$\{label\}/.test(idx));

  // ── Cross-source disagreement is disclosed, never averaged ──
  // Sol's audit: median TCG-vs-PC spread 75.9% on vintage against 7.8% on
  // modern, identity confirmed on all 30 rows, so the spread is real
  // disagreement rather than printing substitution. Averaging two sources
  // that disagree by 76% produces a number neither source would defend.
  check('a source-disagreement disclosure exists',
        /function _renderSourceDisagreement\(/.test(idx));
  check('the disagreement disclosure is actually rendered',
        /parts\.push\(_renderSourceDisagreement\(/.test(idx),
        'a helper nobody calls discloses nothing');
  check('the disclosure names both values rather than blending them',
        /Not averaged/i.test(idx),
        'the user must see which source said what');
  check('the disclosure refuses to claim a Near Mint basis',
        /Near Mint/.test(idx) && /_renderSourceDisagreement/.test(idx),
        'no condition-level SKUs exist in either feed; see Sol audit');
}

// ── The price-integrity audit checks identity, not set names ───────────
// Every earlier audit's "match sanity" column compared set names only. Two
// feeds can agree on "Base Set" while holding 1st Edition vs Unlimited, or a
// holo vs a reverse holo -- a several-hundred-percent price difference that
// would be reported as a source disagreement rather than the resolver bug it
// is. The permanent harness checks name + set + number per source.
{
  const auditPath = path.join(root, 'qa/price_integrity_audit.mjs');
  check('the price-integrity audit is committed to the repo',
        fs.existsSync(auditPath),
        'a one-off script in /home/user is not a regression guard');
  const audit = fs.readFileSync(auditPath, 'utf8');

  check('identity is a three-part check per source',
        /function identityOf\(/.test(audit)
          && /name:\s*name == null/.test(audit)
          && /set:\s*set\s*== null/.test(audit)
          && /number: num\s*== null/.test(audit));
  check('a missing field is indeterminate, never a match',
        /vals\.includes\(null\) \? 'indeterminate'/.test(audit)
          && /'mismatch'/.test(audit),
        'crediting an unobserved check is how a harness starts lying');
  check('the headline spread is computed on identity-exact rows only',
        /spreadOnIdentityExact/.test(audit)
          && /bothExact = comparableRows\.filter/.test(audit),
        'mixing substitutions into a spread average misattributes the cause');
  check('the audit exits non-zero on an identity mismatch',
        /process\.exit\(summary\.identity\.anyMismatchN > 0 \? 1 : 0\)/.test(audit));
  check('the audit reports variant alignment separately from identity',
        /variantAlignment/.test(audit) && /holofoil.*NOT/s.test(audit),
        'holo vs non-holo is price-bearing and must stay flagged');
  check('the PriceCharting rate limit is respected and documented',
        /sleep\(1100\)/.test(audit) && /1 req\/sec|1 request\/sec/.test(audit),
        'their terms bind us to one request per second');

  // The audit can only check the number because the API now returns it.
  const tcgPrice2 = fs.readFileSync(path.join(root, 'api/tcg-price.js'), 'utf8');
  check('the price endpoint echoes the resolved collector number',
        /cardNumber: r\.product\?\.number/.test(tcgPrice2),
        'without it the TCG side of every identity check is blind');
  check('the live fallback parses a number from the product name',
        /cardNumber: best\.number/.test(tcgPrice2)
          && /\[A-Za-z\]\{0,3\}\\d\+/.test(tcgPrice2),
        'SV/TG promos number as SV049/SV122; digits-only missed them all');
}

// ── Grade upside stays withdrawn until both inputs are real ────────────
// P0-C asked for gem-rate weighting so grade upside became an EV rather than
// a best case. The 2026-09-03 research concluded no honest number exists yet:
// within the single 1999 Pokemon Game set, PSA 10 rates span 0.6% (Charizard-
// Holo, 679/107,255) to 14.7% -- so any era or set baseline applied to a
// specific card is off by up to ~18x. The correct ship was nothing.
{
  const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

  check('renderGradeOpportunity still renders nothing',
        /function renderGradeOpportunity\(g\) \{\s*\n\s*return '';\s*\n\}/.test(idx),
        'a best-case slab figure must not come back without licensed pop data');
  // (An earlier block already asserts the withdrawn body is parked and
  // unreferenced by counting its identifier; not duplicated here.)
  check('the gradeOpp feed is still a resolved null',
        /const gradeOppP = Promise\.resolve\(null\)/.test(idx));

  // The tombstone has to carry the reasoning and the re-entry conditions,
  // otherwise the next person re-adds a gem-rate multiplier believing it is
  // the obvious missing piece.
  check('the tombstone records the intra-set spread that kills a multiplier',
        /0\.6%/.test(idx) && /107,255/.test(idx) && /24x/.test(idx),
        'without the numbers this reads as a stylistic preference');
  check('the tombstone cites its population source',
        /gemrate\.com\/item-details-advanced/.test(idx));
  check('the tombstone states both re-entry conditions',
        /licensed to display/.test(idx) && /real sale DATE/.test(idx),
        'a withdrawal with no re-entry test is just a deletion');
  check('the tombstone rules out a headline EV even with licensed data',
        /true of no actual outcome/.test(idx),
        'the objection is to the shape of the number, not only the data');
  check('the research file backing the decision exists',
        fs.existsSync(path.join(root, '..', 'audit/GEM_RATE_RESEARCH_2026-09-03.md'))
          || /GEM_RATE_RESEARCH_2026-09-03/.test(idx),
        'the tombstone must point somewhere real');
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
