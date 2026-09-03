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

check(
  'grade-opportunity client sends game exactly once',
  index.includes("fetch('/api/grade-opportunity?' + tcgParams.toString(),") &&
    !index.includes("tcgParams.toString() + (card.game ? '&game='")
);
check(
  'visible payout ranks use the tier-filtered eligible list',
  index.includes('const rankIdx = _eligibleDisplay.indexOf(r);')
);
check(
  'platform result tile is not an outer anchor',
  !index.includes('const cardTag  = sellUrl') &&
    index.includes('html += `<div class="${cls}">')
);
check(
  'sell destination remains a dedicated accessible link',
  index.includes('<a class="plat-sell-badge"') &&
    index.includes('aria-label="Open ${esc(info.name)} to sell this card"')
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
  check('Cardmarket is the venue gated on international postage',
        /VENUE_REQUIRES\s*=\s*\{\s*cardmarket:\s*'intlShip'\s*\}/.test(code));
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

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
