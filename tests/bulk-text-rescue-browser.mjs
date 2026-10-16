// Shipped manual confirmation -> Magic name recovery, cancellation, mobile UI.
// Catalogue/OCR boundaries are synthetic. Native OCR below checks generated name
// strips only, not recognition accuracy on the owner's real binder photos.
import {chromium} from 'playwright';
import {parse} from 'acorn';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),html=readFileSync(new URL('index.html',root),'utf8');
const asset=name=>readFileSync(new URL(html.match(new RegExp('src="/([^" ]*'+name+'\\.[a-f0-9]+\\.js)"'))[1],root),'utf8');
const ui=asset('ui'),start=ui.indexOf('const _BULK_TEXT_RESCUE'),end=ui.indexOf('window._bulkTextRescueForTest',start);
const block=ui.slice(start,ui.indexOf('\n',end)+1);
const names=new Set(['_bulkUpdateRow','_bulkRefreshResultSummary','closeBulkScan']);
const extracted=parse(ui,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>ui.slice(n.start,n.end)).join('\n');
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
window._idScanCredits=20;window._bulkQueue=[];window._bulkResults=[];window._fbAuth={currentUser:{uid:'synthetic'}};
function _dialogClosed(){}function showToast(m){window.toasts.push(m)}function _bulkClearReplacementPhoto(){}function _bulkRapidTeardown(){}
function _bulkDraftCheckboxHtml(){return ''}function _bulkDraftOutcomeHtml(){return ''}function _bulkDraftSyncSelectionUI(){}function _bulkUpdatePackTracker(){}function _bulkDetectDuplicates(){}
function formatVariantName(v){return v}function _esc(s){const e=document.createElement('div');e.textContent=s||'';return e.innerHTML}function _bulkErrorHint(e){return e||''}
window.toasts=[];window.workers=0;window.terminated=0;window.reads=0;window.releases=[];
window.Tesseract={createWorker:async()=>{workers++;return {setParameters:async()=>{},terminate:async()=>{terminated++},recognize:async()=>{reads++;if(window.holdOCR)await new Promise(r=>releases.push(r));return {data:{text:'Rubble Rouser'}}}}}};
${extracted}\n${asset('scan-finish')}\n${block}\n${asset('bulk-lookup')}
async function resetRows(){
 _bulkCancelTextRescue();CardResellBulkLookup.close();window._bulkProcessing=false;window._bulkSaved=false;window._bulkDraftBusy=false;
 window._fbAuth.currentUser={uid:'synthetic'};window._bulkQueue=[];window.holdOCR=false;window.reads=0;window.releases=[];window.toasts=[];
 const c=document.createElement('canvas');c.width=500;c.height=700;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,500,700);x.fillStyle='#000';x.font='bold 24px Arial';x.fillText('Rubble Rouser',40,220);
 const blob=await new Promise(r=>c.toBlob(r,'image/png'));window.photo=new File([blob],'synthetic.png',{type:'image/png'});
 window._bulkResults=[0,1,2].map(i=>({success:false,definiteMiss:true,file:photo,rowId:'bulk-row-'+i,error:'Could not identify card',objectUrl:URL.createObjectURL(photo),scanUid:'scan-'+i,copyUids:['copy-'+i],condition:'LP',conditionChosen:true,acquisitionCost:1.25,location:'Box A'}));
 window.originalRows=[..._bulkResults];document.getElementById('bulkResultsList').innerHTML=_bulkResults.map(r=>'<div id="'+r.rowId+'"></div>').join('');
 document.getElementById('bulkScanOverlay').style.display='flex';document.getElementById('bulkModePicker').style.display='none';document.getElementById('bulkCreditConfirm').style.display='none';document.getElementById('bulkProcessing').style.display='flex';document.getElementById('bulkBottomBar').style.display='';
 document.getElementById('bulkProgressLabel').textContent='Done!';document.getElementById('bulkProgressBar').style.width='100%';
 _bulkResults.forEach(r=>_bulkUpdateRow(r.rowId,r));_bulkRefreshResultSummary();
}
</script>`;
const styles=new Map([...html.matchAll(/href="(\/[^" ]+\.css)"/g)].map(m=>[m[1],readFileSync(new URL(m[1].slice(1),root))]));
const server=createServer((req,res)=>{const css=styles.get(req.url);res.setHeader('Content-Type',css?'text/css':'text/html');res.end(css||fixture)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
const temp=mkdtempSync(join(tmpdir(),'cardresell-name-strips-'));
let checks=0;function check(label,actual,expected=true){assert.deepEqual(actual,expected,label);checks++;console.log('✓ '+label)}
const card=(name,id,num)=>({id,name,set:'tst',set_name:'Test set',collector_number:num,lang:'en',games:['paper'],finishes:['nonfoil','foil'],prices:{usd:'0.25',usd_foil:'7.00'},image_uris:{normal:'https://cards.scryfall.io/normal/front/test.jpg'}});
try{for(const viewport of [{width:390,height:844},{width:844,height:390}]){
 const page=await browser.newPage({viewport}),errors=[],requests=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',async r=>{const url=r.request().url();if(url===origin+'/'||url.startsWith(origin+'/')&&styles.has(new URL(url).pathname))return r.continue();if(['fetch','xhr'].includes(r.request().resourceType()))requests.push(url);
  if(url.startsWith('https://api.scryfall.com/cards/search'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[card('Fixture Wizard','manual','1')],has_more:false})});
  if(url.startsWith('https://api.scryfall.com/cards/named'))return r.fulfill({status:200,contentType:'application/json',body:JSON.stringify(card('Rubble Rouser','ocr-printing','128'))});return r.abort();});
 await page.goto(origin);await page.evaluate(()=>resetRows());
 const confirmFirst=async()=>{
  await page.locator('#bulk-row-0').getByRole('button',{name:'Find card by name · free'}).click();
  await page.locator('[name=name]').fill('Fixture Wizard');await page.getByRole('button',{name:'Search catalogue'}).click();
  await page.locator('.lookup-results button').click();await page.getByRole('button',{name:'Use this printing'}).click();
 };
 check('zero-match batch does not invent a set',await page.evaluate(async()=>[await _bulkTextRescueMisses(),workers]),[0,0]);
 await page.evaluate(()=>{window.holdOCR=true});await confirmFirst();await page.waitForFunction(()=>reads>0);
 check('manual confirmation starts printed-name recovery',await page.evaluate(()=>[_bulkResults[0].manualIdentity,workers]),[true,1]);
 const status=page.locator('#bulkTextRescueStatus');check('progress visible',await status.isVisible());
 check('progress describes name recovery',(await status.textContent()).includes('Reading printed names'));
 check('Stop target is at least 44px',await status.getByRole('button').evaluate(e=>e.getBoundingClientRect().height>=44));
 check('progress does not overflow mobile width',await status.evaluate(e=>e.scrollWidth<=e.clientWidth));
 if(process.env.CR_SHOT_DIR)await page.screenshot({path:process.env.CR_SHOT_DIR+`/name-recovery-${viewport.width}.png`});
 await page.evaluate(()=>{window.holdOCR=false;releases.splice(0).forEach(r=>r())});
 await page.waitForFunction(()=>!document.getElementById('bulkTextRescueStatus'));
 check('remaining cards recovered',await page.evaluate(()=>_bulkResults.map(r=>[r.success,r.groundedId])),[[true,'manual'],[true,'ocr-printing'],[true,'ocr-printing']]);
 check('header updates after recovery',await page.locator('#bulkScanSubtitle').textContent(),'3/3 cards identified');
 check('review note remains on automatic matches',(await page.locator('#bulk-row-1').textContent()).includes('Matched from the printed name. Please check it.'));
 check('physical cards and seller data preserved',await page.evaluate(()=>_bulkResults.every((r,i)=>r.file===photo&&r.copyUids[0]==='copy-'+i&&r.condition==='LP'&&r.acquisitionCost===1.25&&r.location==='Box A')));
 check('recovery uses no ID credits',await page.evaluate(()=>_idScanCredits),20);
 check('catalogue only, no scan or persistence API calls',requests.every(u=>u.startsWith('https://api.scryfall.com/')||u.startsWith('https://cards.scryfall.io/')));
 await page.evaluate(()=>resetRows());await page.evaluate(()=>{window.holdOCR=true});await confirmFirst();await page.waitForFunction(()=>reads>0);
 await page.getByRole('button',{name:'Stop name recovery'}).click();await page.waitForFunction(()=>!document.getElementById('bulkTextRescueStatus'));
 check('Stop preserves confirmed card and misses',await page.evaluate(()=>originalRows.map(r=>r.success)),[true,false,false]);
 const before=await page.evaluate(()=>terminated);await page.evaluate(()=>releases.splice(0).forEach(r=>r()));
 check('stopped worker already terminated',before>=2);
 check('Stop explains that work was retained',await page.evaluate(()=>toasts.some(t=>t.includes('Recovered cards remain'))));
 // A seller opening manual recovery while OCR is pending owns that row.
 await page.evaluate(()=>resetRows());await page.evaluate(()=>{window.holdOCR=true});await confirmFirst();await page.waitForFunction(()=>reads>0);
 await page.locator('#bulk-row-1').getByRole('button',{name:'Find card by name · free'}).click();
 await page.evaluate(()=>{window.holdOCR=false;releases.splice(0).forEach(r=>r())});await page.waitForFunction(()=>!document.getElementById('bulkTextRescueStatus'));
 check('manual edit is not overwritten',await page.evaluate(()=>[_bulkResults[1].success,CardResellBulkLookup.isEditing(_bulkResults[1])]),[false,true]);
 check('other row can still recover',await page.evaluate(()=>_bulkResults[2].success));await page.keyboard.press('Escape');
 for(const mutation of ['account','close']){
  await page.evaluate(()=>resetRows());await page.evaluate(()=>{window.holdOCR=true});await confirmFirst();await page.waitForFunction(()=>reads>0);
  await page.evaluate(kind=>{if(kind==='account')_fbAuth.currentUser={uid:'other'};else closeBulkScan();},mutation);
  await page.waitForFunction(()=>!document.getElementById('bulkTextRescueStatus'));
  await page.evaluate(()=>releases.splice(0).forEach(r=>r()));
  check('late OCR cannot mutate '+mutation,await page.evaluate(()=>originalRows.map(r=>r.success)),[true,false,false]);
 }
 if(viewport.width===390){
  const samples=await page.evaluate(async()=>{
   const samples=[];
   for(const offset of [.05,.18,.28]){
    const c=document.createElement('canvas');c.width=500;c.height=700;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,500,700);x.fillStyle='#000';x.font='bold 24px Arial';x.textBaseline='top';x.fillText('Rubble Rouser',42,700*offset);
    const file=new File([await new Promise(r=>c.toBlob(r,'image/png'))],'name.png',{type:'image/png'}),strips=[];
    for(const [a,b] of _BULK_TEXT_RESCUE.windows){const s=await _bulkNameStrip(file,a,b);strips.push(s.toDataURL('image/png').split(',')[1]);s.width=s.height=1}samples.push({offset,strips});
   }return samples;
  });
  for(const sample of samples){const reads=sample.strips.map((base64,i)=>{const path=join(temp,`${sample.offset}-${i}.png`);writeFileSync(path,Buffer.from(base64,'base64'));const out=spawnSync(process.env.CR_TESSERACT||'tesseract',[path,'stdout','--psm','6'],{encoding:'utf8',timeout:10000});assert.equal(out.status,0,out.stderr||String(out.error));return out.stdout});
   check('native OCR can read synthetic name at pocket height '+sample.offset,reads.some(t=>t.includes('Rubble Rouser')));
  }
 }
 check('no browser exceptions',errors,[]);await page.close();
}console.log(`SUITE COMPLETE: bulk-text-rescue-browser: ${checks} passed, 0 failed`);
}finally{await browser.close();await new Promise(r=>server.close(r));rmSync(temp,{recursive:true,force:true})}
