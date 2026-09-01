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
ok(/data-upgrade-tier="pro"/.test(pr) && /data-upgrade-tier="pro_max"/.test(pr) && /data-upgrade-tier="ultimate"/.test(pr),
   'all three paid CTAs are tagged for interval rewriting');
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
{
  const f = idx.indexOf('ovField.value = Number(bestPrice).toFixed(2)');
  ok(f > 0, 'comps pipeline still fills the override from the ladder');
  const region = idx.slice(f, f + 1800);
  ok(/eBay sold median/.test(region),  'caption can name eBay sold median');
  ok(/PriceCharting guide value/.test(region), 'caption can name PriceCharting');
  ok(/TCGPlayer market/.test(region),  'caption can name TCGPlayer market');
  ok(/ebay\.count\} comps/.test(region),
     'the eBay caption discloses how many comps are behind the median');
  ok(/priceSource\.textContent = _srcLabel/.test(region),
     'the caption element is updated when the override is filled');
}

console.log(fail? `\n${fail} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fail?1:0);
