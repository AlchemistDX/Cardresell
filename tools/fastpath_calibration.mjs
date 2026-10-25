// Repeatable evaluation of the SHIPPED local matcher. No paid recognition.
// Usage: node tools/fastpath_calibration.mjs [manifest.json] [report.json]
// A local artwork candidate is not a confirmed card/printing. This measures
// candidate recall and unsafe promotion, never Ximilar or real-world accuracy.
import { chromium } from 'playwright';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
const root=resolve(new URL('..',import.meta.url).pathname);
const manifestPath=resolve(process.argv[2] || root+'/tests/fixtures/scanner-accuracy.json');
const output=process.argv[3] && resolve(process.argv[3]);
const manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
if (!Array.isArray(manifest.inputs) || !manifest.inputs.length) throw Error('A nonempty, labeled manifest is required');
const origin='https://scanner-calibration.test';
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}});
const rows=[],errors=[],requests=[];
await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin || u.pathname.startsWith('/api/')) {
    requests.push(u.href);return route.fulfill({status:503,body:'offline'});
  }
  try {
    const path=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
    if(!path.startsWith(root+'/'))throw Error('path');
    const type={'.js':'application/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png'}[extname(path)]||'text/html';
    return route.fulfill({body:readFileSync(path),contentType:type});
  }catch{return route.fulfill({status:404,body:''})}
});
page.on('pageerror',e=>errors.push(e.message));
async function evaluate(files,expected,label) {
  const data=await page.evaluate(async files=>{
    const out=[];
    for(const input of files) {
      const file=typeof input==='number'?window._bulkQueue[input].file:
        new File([Uint8Array.from(atob(input.base64),c=>c.charCodeAt(0))],input.name,{type:input.type});
      const qc=await CardResellPhotoQC.check(file,{skipDupe:true});
      const fp=await CardResellFastPath.scanFile(file);
      out.push({width:qc.details.width,height:qc.details.height,photoCheck:qc.ok,
        photoReasons:qc.reasons,artworkCandidate:fp.artworkCandidate===true,acceptedIdentity:fp.hit===true,
        candidate:fp.bestGuess?{id:fp.bestGuess.id,name:fp.bestGuess.card_name,number:fp.bestGuess.card_number,set:fp.bestGuess.set_name}:null,
        distance:fp.bestDist,gap:Number.isFinite(fp.secondDist)?fp.secondDist-fp.bestDist:null,reason:fp.reason});
    }
    return out;
  },files);
  data.forEach((r,i)=>{
    const truth=expected[i];
    if(!truth || (!truth.name && truth.negative!==true))throw Error('Missing independent label');
    const nameCorrect=truth.negative?null:r.candidate?.name.toLowerCase()===truth.name.toLowerCase();
    rows.push({label:label+(files.length>1?`/pocket-${i+1}`:''),expected:truth,...r,nameCorrect,
      unsafePromotion:r.acceptedIdentity || (truth.negative && r.artworkCandidate)});
  });
}
try {
  await page.goto(origin,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.CardResellBinder && window.CardResellFastPath && window.CardResellPhotoQC);
  for(const input of manifest.inputs) {
    const path=resolve(dirname(manifestPath),input.path);
    if(input.layout) {
      await page.evaluate(()=>{window._bulkQueue=[];document.getElementById('bulkScanOverlay').style.display='flex';startBinderScan()});
      await page.selectOption('#binderLayout',input.layout);
      await page.setInputFiles('#binderInput',path);
      await page.waitForFunction(()=>!document.getElementById('binderControls').disabled && document.querySelectorAll('.binder-pocket').length>0,null,{timeout:30000});
      const count=await page.locator('.binder-pocket').count();
      if(count!==input.expected.length)throw Error('Pocket count differs from truth labels');
      await page.click('#binderSelectAll');await page.click('#binderContinue');
      await evaluate(Array.from({length:count},(_,i)=>i),input.expected,input.label);
    } else {
      const type=input.type || ({'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[extname(path)]);
      if(!type)throw Error('Unsupported fixture format');
      await evaluate([{name:input.path,type,base64:readFileSync(path).toString('base64')}],[input.expected],input.label);
    }
  }
  const positives=rows.filter(r=>!r.expected.negative),negatives=rows.filter(r=>r.expected.negative);
  const report={version:1,manifestSha256:createHash('sha256').update(readFileSync(manifestPath)).digest('hex'),
    assets:[...readFileSync(root+'/index.html','utf8').matchAll(/src="(\/js\/(?:core|binder|photo-qc)\.[a-f0-9]+\.js)"/g)].map(m=>m[1]),
    inputs:manifest.inputs.map(i=>({path:i.path,sha256:createHash('sha256').update(readFileSync(resolve(dirname(manifestPath),i.path))).digest('hex')})),
    scope:'Offline local artwork candidates and photo preparation only; no Ximilar recognition or printing accuracy measurement',
    description:manifest.description,
    summary:{positivePhotos:positives.length,negativeControls:negatives.length,photoChecksPassed:positives.filter(r=>r.photoCheck).length,
      qualifiedArtworkCandidates:positives.filter(r=>r.artworkCandidate).length,
      qualifiedCorrectNames:positives.filter(r=>r.artworkCandidate&&r.nameCorrect).length,
      nearestNamesCorrect:positives.filter(r=>r.nameCorrect).length,
      acceptedIdentities:rows.filter(r=>r.acceptedIdentity).length,
      unsafePromotions:rows.filter(r=>r.unsafePromotion).length,
      scanRequests:requests.filter(u=>/\/api\/scan(?:[?/-]|$)/.test(u)).length,browserErrors:errors.length},rows,errors};
  if(output){mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n')}
  console.log(JSON.stringify(report.summary));
  if(report.summary.unsafePromotions || report.summary.scanRequests || errors.length)process.exitCode=1;
} finally {await browser.close()}
