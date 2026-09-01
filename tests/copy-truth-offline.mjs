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

console.log(fail? `\n${fail} FAILURE(S)` : '\nALL CHECKS PASSED');
process.exit(fail?1:0);
