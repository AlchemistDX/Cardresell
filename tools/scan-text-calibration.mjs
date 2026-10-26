// Native OCR on the shipped recovery crops. No paid recognizer or catalogue.
// Usage: CR_CHROMIUM=<binary> CR_TESSERACT=<binary> node tools/scan-text-calibration.mjs [report.json]
import {chromium} from 'playwright';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join,extname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const root=resolve(new URL('..',import.meta.url).pathname),origin='https://ocr-calibration.test';
const html=readFileSync(join(root,'index.html'),'utf8');
const manifest=JSON.parse(readFileSync(join(root,'tests/fixtures/scanner-accuracy.json'),'utf8'));
const input=manifest.inputs.find(i=>i.label==='real-binder-page');
const path=resolve(root,'tests/fixtures',input.path),temp=mkdtempSync(join(tmpdir(),'cr-ocr-calibration-'));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[],rows=[],outbound=[];
let calls=0;
try{
 await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
 await page.route('**/*',route=>{
  const u=new URL(route.request().url());
  if(u.origin!==origin||u.pathname.startsWith('/api/')){outbound.push(u.href);return route.fulfill({status:503,body:'offline'})}
  try{const file=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+'/'))throw Error('path');
   return route.fulfill({body:readFileSync(file),contentType:{'.js':'application/javascript','.css':'text/css','.json':'application/json','.jpg':'image/jpeg','.png':'image/png'}[extname(file)]||'text/html'});
  }catch{return route.fulfill({status:404,body:''})}
 });
 await page.exposeFunction('__nativeOCR',base64=>{
  calls++;const file=join(temp,'strip.png');writeFileSync(file,Buffer.from(base64,'base64'));
  const r=spawnSync(process.env.CR_TESSERACT||'tesseract',[file,'stdout','--psm','6'],{encoding:'utf8',timeout:10000,env:{...process.env,OMP_THREAD_LIMIT:'1'}});
  if(r.status!==0)throw Error(r.stderr||String(r.error));return r.stdout;
 });
 page.on('pageerror',e=>errors.push(e.message));
 await page.goto(origin);await page.waitForFunction(()=>window.CardResellBinder&&window.CardResellScanTextRecovery);
 await page.evaluate(()=>{window._bulkQueue=[];document.getElementById('bulkScanOverlay').style.display='flex';startBinderScan()});
 await page.selectOption('#binderLayout',input.layout);await page.setInputFiles('#binderInput',path);
 await page.waitForFunction(()=>!document.getElementById('binderControls').disabled&&document.querySelectorAll('.binder-pocket').length===9);
 await page.click('#binderSelectAll');await page.click('#binderContinue');
 await page.evaluate(()=>{
  window.readTexts=[];window.Tesseract={createWorker:async()=>({setParameters:async()=>{},terminate:async()=>{},recognize:async c=>{
   const text=await __nativeOCR(c.toDataURL('image/png').split(',')[1]);readTexts.push(text);return {data:{text}};
  }})};
 });
 const normalized=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
 for(let i=0;i<input.expected.length;i++){
  const r=await page.evaluate(async i=>{readTexts=[];const value=await CardResellScanTextRecovery.find(_bulkQueue[i].file,{game:'pokemon'});return {suggestion:value,reads:readTexts}},i);
  const name=input.expected[i].name,found=r.reads.some(s=>normalized(s).includes(normalized(name)));
  rows.push({pocket:i+1,expectedName:name,exactNameVisibleToOCR:found,rawSuggestionContainsName:normalized(r.suggestion?.name).includes(normalized(name)),...r});
 }
 const report={date:'2026-10-26',scope:'Native Tesseract text on shipped browser crops from one saved Pokémon binder photo. No live Ximilar or catalogue calls; does not measure identity, printing, finish or general recognition accuracy.',
  source:{path:input.path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')},
  assets:[...html.matchAll(/src="(\/js\/(?:core|ui|binder|scan-text-recovery)\.[a-f0-9]+\.js)"/g)].map(m=>m[1]),
  total:rows.length,exactNamesVisibleToOCR:rows.filter(r=>r.exactNameVisibleToOCR).length,rawSuggestionsContainingName:rows.filter(r=>r.rawSuggestionContainsName).length,
  nativeOCRCalls:calls,scanRequests:outbound.filter(u=>/\/api\/scan(?:[?/#]|$)/.test(u)).length,browserErrors:errors,rows};
 if(process.argv[2])writeFileSync(resolve(process.argv[2]),JSON.stringify(report,null,2)+'\n');
 console.log(JSON.stringify({total:report.total,exactNamesVisibleToOCR:report.exactNamesVisibleToOCR,rawSuggestionsContainingName:report.rawSuggestionsContainingName,nativeOCRCalls:calls,scanRequests:report.scanRequests,browserErrors:errors}));
 if(errors.length||report.scanRequests||rows.length!==9)process.exitCode=1;
}finally{await browser.close();rmSync(temp,{recursive:true,force:true})}
