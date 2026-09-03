// tools/fastpath_calibration.mjs
//
// EMPIRICAL calibration harness for the offline pHash fastpath. tests/
// scanner-fastpath.mjs pins the code's SHAPE; this measures whether it
// actually works. Re-run it by hand whenever you touch hashing, cropping,
// CONFIDENCE_MAX, GAP_MIN, or the seeder's preprocessing.
//
// Method: download reference images straight from the index and feed them
// BACK through scanFile(). A card's own catalog image is the easiest possible
// input, so the accept rate here is an UPPER BOUND on real-world recall. If
// this number is low, the matcher is broken — that is how the 0%-hit-rate
// crop/index mismatch was found on 2026-09-03.
//
// Prereqs:
//   1. python3 -m http.server 8099   (from the repo root)
//   2. reference images + meta.json  (see PREP below)
//   3. Playwright available to node
//
// PREP — build the sample set:
//   python3 - <<'EOF'
//   import json,random,urllib.request,os
//   idx=json.load(open('card-index.json'))
//   sc=[c for c in idx if 'scrydex.com' in (c.get('i') or '')]
//   random.seed(7); samp=random.sample(sc,30)
//   os.makedirs('/tmp/selftest',exist_ok=True); meta=[]
//   for c in samp:
//       p=f"/tmp/selftest/{c['id']}.png"
//       req=urllib.request.Request(c['i'],headers={'User-Agent':'Mozilla/5.0'})
//       open(p,'wb').write(urllib.request.urlopen(req,timeout=20).read())
//       meta.append({'id':c['id'],'n':c['n'],'path':p})
//   json.dump(meta,open('/tmp/selftest/meta.json','w'))
//   EOF
//
// BASELINE (2026-09-03, n=30, after the dual-hash fix):
//   A. accepted 26/30, WRONG-ACCEPTED 0
//      4 honest fall-throughs, all gap-rule (gap 0-1) on near-duplicate arts
//   B. matchedOn: uncropped for all tight scans (expected — index is uncropped)
//   C. phone photos of full-art holos still miss, and do NOT guess wrong
//   D. negative control (icon-512.png) does not match
//
// BEFORE the fix the same harness reported 0/30 accepted.
//
// A drop in A, or ANY non-zero WRONG-ACCEPTED, is a release blocker: a false
// accept shows the user a confidently wrong card, which is worse than an
// honest "not recognized".
import { chromium } from '/home/user/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const meta = JSON.parse(readFileSync('/tmp/selftest/meta.json','utf8'));
const b = await chromium.launch();
const pg = await b.newPage({ viewport:{width:430,height:900} });
await pg.addInitScript(()=>{ Object.defineProperty(window,'autoRunExampleCard',
  { value: async()=>false, writable:true, configurable:true }); });
await pg.goto('http://localhost:8099/index.html',{waitUntil:'domcontentloaded'});
await pg.waitForTimeout(2500);

const run = async (path,type='image/png') => {
  const b64 = readFileSync(path).toString('base64');
  return pg.evaluate(async ({b64,type}) => {
    const bin=atob(b64); const arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    const r=await window.CardResellFastPath.scanFile(new File([arr],'c',{type}));
    return { hit:!!r.hit, id:r.hit?r.card.id:null,
             name:r.hit?(r.card.card_name+' #'+r.card.card_number):null,
             matchedOn:r.matchedOn||null, dist:r.hit?r.distance:r.bestDist,
             reason:r.reason||null,
             guess:r.bestGuess?(r.bestGuess.card_name+' #'+r.bestGuess.card_number):null };
  }, {b64,type});
};

console.log('=== A. FALSE-ACCEPT CHECK (n=30 reference images) ===');
let hit=0, wrong=0; const misses=[];
for (const m of meta) {
  const r = await run(m.path);
  if (r.hit) { hit++; if (r.id!==m.id) { wrong++; console.log(`  WRONG: ${m.id} -> ${r.id}`); } }
  else misses.push(`${m.id} (${r.reason})`);
}
console.log(`  accepted ${hit}/30, WRONG-ACCEPTED ${wrong}`);
console.log(`  honest fall-through (${misses.length}):`);
misses.forEach(x=>console.log('    '+x));

console.log('\n=== B. matchedOn distribution (should be "uncropped" for tight scans) ===');
const d={};
for (const m of meta.slice(0,10)) { const r=await run(m.path); d[r.matchedOn||'miss']=(d[r.matchedOn||'miss']||0)+1; }
console.log('  '+JSON.stringify(d));

console.log('\n=== C. GRENINJA PHOTOS \u2014 must still honestly miss, NOT guess wrong ===');
for (const [lab,p] of [['wood','/home/user/gren_wood_preview.png'],
                       ['hand','/home/user/gren_hand_preview.png']]) {
  const r = await run(p);
  console.log(`  ${lab}: hit=${r.hit}  ${r.hit?('ACCEPTED '+r.name+' <-- FALSE POSITIVE!'):('miss, '+r.reason+', best guess would have been '+r.guess)}`);
}

console.log('\n=== D. NEGATIVE CONTROL \u2014 a non-card image must not match ===');
const r = await run('/home/user/workspace/cardresell/public/icon-512.png');
console.log(`  icon-512.png: hit=${r.hit} ${r.hit?('ACCEPTED '+r.name+' <-- FALSE POSITIVE!'):('miss ('+r.reason+')')}`);
await b.close();
import { chromium } from '/home/user/node_modules/playwright/index.mjs';
import { readFileSync } from 'node:fs';

const meta = JSON.parse(readFileSync('/tmp/selftest/meta.json','utf8'));
const b = await chromium.launch();
const pg = await b.newPage({ viewport:{width:430,height:900} });
await pg.addInitScript(()=>{ Object.defineProperty(window,'autoRunExampleCard',
  { value: async()=>false, writable:true, configurable:true }); });
await pg.goto('http://localhost:8099/index.html',{waitUntil:'domcontentloaded'});
await pg.waitForTimeout(2500);

const run = async (path,type='image/png') => {
  const b64 = readFileSync(path).toString('base64');
  return pg.evaluate(async ({b64,type}) => {
    const bin=atob(b64); const arr=new Uint8Array(bin.length);
    for(let i=0;i<bin.length;i++) arr[i]=bin.charCodeAt(i);
    const r=await window.CardResellFastPath.scanFile(new File([arr],'c',{type}));
    return { hit:!!r.hit, id:r.hit?r.card.id:null,
             name:r.hit?(r.card.card_name+' #'+r.card.card_number):null,
             matchedOn:r.matchedOn||null, dist:r.hit?r.distance:r.bestDist,
             reason:r.reason||null,
             guess:r.bestGuess?(r.bestGuess.card_name+' #'+r.bestGuess.card_number):null };
  }, {b64,type});
};

console.log('=== A. FALSE-ACCEPT CHECK (n=30 reference images) ===');
let hit=0, wrong=0; const misses=[];
for (const m of meta) {
  const r = await run(m.path);
  if (r.hit) { hit++; if (r.id!==m.id) { wrong++; console.log(`  WRONG: ${m.id} -> ${r.id}`); } }
  else misses.push(`${m.id} (${r.reason})`);
}
console.log(`  accepted ${hit}/30, WRONG-ACCEPTED ${wrong}`);
console.log(`  honest fall-through (${misses.length}):`);
misses.forEach(x=>console.log('    '+x));

console.log('\n=== B. matchedOn distribution (should be "uncropped" for tight scans) ===');
const d={};
for (const m of meta.slice(0,10)) { const r=await run(m.path); d[r.matchedOn||'miss']=(d[r.matchedOn||'miss']||0)+1; }
console.log('  '+JSON.stringify(d));

console.log('\n=== C. GRENINJA PHOTOS \u2014 must still honestly miss, NOT guess wrong ===');
for (const [lab,p] of [['wood','/home/user/gren_wood_preview.png'],
                       ['hand','/home/user/gren_hand_preview.png']]) {
  const r = await run(p);
  console.log(`  ${lab}: hit=${r.hit}  ${r.hit?('ACCEPTED '+r.name+' <-- FALSE POSITIVE!'):('miss, '+r.reason+', best guess would have been '+r.guess)}`);
}

console.log('\n=== D. NEGATIVE CONTROL \u2014 a non-card image must not match ===');
const r = await run('/home/user/workspace/cardresell/public/icon-512.png');
console.log(`  icon-512.png: hit=${r.hit} ${r.hit?('ACCEPTED '+r.name+' <-- FALSE POSITIVE!'):('miss ('+r.reason+')')}`);
await b.close();
