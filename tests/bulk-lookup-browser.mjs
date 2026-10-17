// Shipped binder -> scan payload -> miss -> explicit catalogue confirmation.
// Synthetic photos and catalogue responses only; all external traffic blocked.
import { chromium } from 'playwright';
import { parse } from 'acorn';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
const root=new URL('../',import.meta.url),html=readFileSync(new URL('index.html',root),'utf8');
const asset=name=>readFileSync(new URL(html.match(new RegExp('src="/([^" ]*'+name+'\\.[a-f0-9]+\\.js)"'))[1],root),'utf8');
const names=new Set(['compressImage','_bulkScanOne','_bulkUpdateRow','_bulkRefreshResultSummary','_bulkRapidTeardown','_bulkRapidLayout','_liveCapStopQA','_liveCapRenderQA','_bulkShowSection','processBulkUploadFiles','_bulkNewScanUid','cancelBulkConfirm','closeBulkScan','_partitionScanFiles','_validateScanFile']);
const extracted=['core','ui'].map(name=>{const src=asset(name);return parse(src,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.has(n.id.name)).map(n=>src.slice(n.start,n.end)).join('\n')}).join('\n');
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
const SCAN_MAX_BYTES=15*1024*1024,SCAN_MIME_TYPES=new Set(['image/jpeg','image/png','image/webp']);
window._idScanCredits=20;window._bulkQueue=[];window._bulkResults=[];window._fbAuth={currentUser:{uid:'synthetic'}};
function _dialogClosed(){}function showToast(m){window.toast=m}function _bulkClearReplacementPhoto(){}
function _bulkCheckPhoto(){return Promise.resolve(null)}
function _bulkDraftCheckboxHtml(){return ''}function _bulkDraftOutcomeHtml(){return ''}
function _bulkDraftSyncSelectionUI(){}function _bulkUpdatePackTracker(){}function _bulkDetectDuplicates(){window.dupChecks=(window.dupChecks||0)+1}
function formatVariantName(v){return v}function _esc(s){const e=document.createElement('div');e.textContent=s||'';return e.innerHTML}
function _bulkErrorHint(e){return e||''}
window.sent=[];window.cardResellScanRequest=async(u,o)=>{sent.push(JSON.parse(o.body));return {ok:true,status:200,json:async()=>({identified:false,scan_id:'synthetic-miss'})}};
${extracted}\n${asset('scan-finish')}\n${asset('bulk-lookup')}\n${asset('binder')}
const realCompress=compressImage;window.encodes=[];compressImage=(f,size,opts)=>{encodes.push(size);return realCompress(f,size,opts)};
</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fixture)});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM||undefined,args:['--no-sandbox']});
let checks=0;
function check(label,actual,expected){assert.deepEqual(actual,expected,label);checks++;console.log('✓ '+label)}
const mtg=(id,set='Test set',num='123',extra={})=>({id,name:'Fixture Wizard',set_name:set,set:'tst',collector_number:num,lang:'en',games:['paper'],finishes:['nonfoil','foil'],prices:{usd:'0.25',usd_foil:'7.00'},image_uris:{normal:'https://cards.scryfall.io/normal/front/test.jpg'},...extra});
const pokemon=(id,set='Test expansion',num='44',extra={})=>({id,name:'Fixture Mouse',set:{id:'test',name:set},number:num,images:{large:'https://images.pokemontcg.io/test/44.png'},tcgplayer:{prices:{normal:{market:0.1},reverseHolofoil:{market:8}}},...extra});
try {for(const viewport of [{width:390,height:844},{width:844,height:390}]) {
 const page=await browser.newPage({viewport,hasTouch:true}),errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));
 let response={data:[mtg('first'),mtg('second','Other printing','456')],has_more:false},httpStatus=200,hold=null;
 await page.route('**/*',async r=>{
  const url=r.request().url(); if(url===origin+'/')return r.continue();
  if(url.startsWith('https://api.scryfall.com/cards/search')||url.startsWith('https://api.pokemontcg.io/v2/cards?')){
    requests.push({url,headers:r.request().headers()});
    if(hold){await hold;r.abort().catch(()=>{});return}
    return r.fulfill({status:httpStatus,contentType:'application/json',body:JSON.stringify(response)});
  }
  return r.abort();
 });
 await page.goto(origin);
 const data=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2000;c.height=2800;const x=c.getContext('2d');x.fillStyle='#887777';x.fillRect(0,0,c.width,c.height);return c.toDataURL('image/png').split(',')[1]});
 await page.evaluate(()=>{document.getElementById('bulkScanOverlay').style.display='flex';startBinderScan()});
 await page.selectOption('#binderLayout','2,2');
 await page.setInputFiles('#binderInput',{name:'synthetic-page.png',mimeType:'image/png',buffer:Buffer.from(data,'base64')});
 await page.waitForFunction(()=>!document.getElementById('binderControls').disabled);
 await page.locator('.binder-pocket input').first().check();await page.locator('#binderContinue').click();
 const preparation=await page.evaluate(async()=>{
   const item=_bulkQueue[0], b64=await CardResellBinder.scanImage(item.file);
   const jpeg=Uint8Array.from(atob(b64),c=>c.charCodeAt(0)),original=new Uint8Array(await item.file.arrayBuffer());
   const bitmap=await createImageBitmap(item.file);const size=[bitmap.width,bitmap.height];bitmap.close();
   const result=await _bulkScanOne(item,'bulk-row-0',false);
   window.prepared=item;window.miss=result;window._bulkResults=[result];
   document.getElementById('bulkResultsList').innerHTML='<div id="bulk-row-0"></div>';
   _bulkShowSection('processing');_bulkUpdateRow(result.rowId,result);_bulkRefreshResultSummary();
   return {same:jpeg.length===original.length&&jpeg.every((v,i)=>v===original[i]),submitted:sent[0].imageBase64===b64,size,encodes:[...encodes],miss:result.definiteMiss};
 });
 check('prepared JPEG preserved byte for byte',preparation.same,true);
 check('shipped scan submits original prepared JPEG',preparation.submitted,true);
 check('prepared longest edge stays 1400px',Math.max(...preparation.size),1400);
 check('only thumbnail is recompressed',preparation.encodes,[350]);
 check('definite miss available for recovery',preparation.miss,true);
 const ordinary=await page.evaluate(async()=>{encodes=[];const file=new File([prepared.file],prepared.file.name,{type:'image/jpeg'});const bypass=await CardResellBinder.scanImage(file);await _bulkScanOne({...prepared,file},'ordinary',false);return {bypass,encodes}});
 check('renaming an upload cannot impersonate prepared crop',ordinary.bypass,null);
 check('ordinary upload retains bounded encoder',ordinary.encodes,[1200,350]);
 const open=async()=>{await page.getByRole('button',{name:'Find card by name · free'}).click();await page.locator('#bulkLookupDialog').waitFor()};
 const search=async(game='mtg',name='Fixture Wizard')=>{await page.locator('[name=game]').selectOption(game);await page.locator('[name=name]').fill(name);await page.getByRole('button',{name:'Search catalogue',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('#bulkLookupDialog button[type=submit]').disabled)};
 await open();
 check('phone opens photo without focusing keyboard field',await page.evaluate(()=>document.activeElement.id),'bulkLookupTitle');
 check('reference photo available before searching',await page.locator('.lookup-photo img').getAttribute('src').then(Boolean),true);
 check('reference photo can be collapsed',await page.locator('.lookup-photo').getAttribute('open')!==null,true);
 await page.locator('[name=game]').selectOption('pokemon');
 await page.locator('[name=name]').fill('Plusle');
 await page.locator('[name=number]').fill('44/100');
 await page.keyboard.press('Escape');await open();
 check('reopening retains this card search fields',await page.evaluate(()=>['game','name','number'].map(n=>document.querySelector('[name='+n+']').value)),['pokemon','Plusle','44/100']);
 check('reopening does not search or spend credits',requests.length,0);
 await page.locator('[name=number]').fill('');
 check('dialog fits screen',await page.locator('#bulkLookupDialog').evaluate(e=>e.scrollWidth<=e.clientWidth&&e.getBoundingClientRect().width<=innerWidth),true);
 check('search fields readable on mobile',await page.locator('[name=name]').evaluate(e=>parseFloat(getComputedStyle(e).fontSize)>=16),true);
 check('empty search does not call catalogue',requests.length,0);
 if(process.env.CR_SHOT_DIR)await page.screenshot({path:process.env.CR_SHOT_DIR+`/lookup-search-${viewport.width}.png`});
 await search();
 check('all exact printings shown',await page.locator('.lookup-results button').count(),2);
 check('search never selects first result automatically',await page.evaluate(()=>miss.success),false);
 check('catalogue queries exclude digital cards',new URL(requests.at(-1).url).searchParams.get('q'),'name:"Fixture Wizard" game:paper lang:en');
 check('search includes all printings',new URL(requests.at(-1).url).searchParams.get('unique'),'prints');
 await page.locator('.lookup-results button').nth(1).click();
 check('confirm exact printing number',await page.locator('#bulkLookupDialog section').textContent().then(s=>s.includes('Other printing · #456')),true);
 check('selection alone does not mutate batch',await page.evaluate(()=>miss.success),false);
 if(process.env.CR_SHOT_DIR)await page.screenshot({path:process.env.CR_SHOT_DIR+`/binder-lookup-${viewport.width}.png`});
 await page.getByRole('button',{name:'Back to results'}).click();
 await page.keyboard.press('Escape');
 check('escape cancels without changing row',await page.evaluate(()=>!miss.success&&!document.getElementById('bulkLookupDialog')),true);
 await page.evaluate(()=>{window._fbAuth.currentUser={uid:'different-owner'}});await open();
 check('search text never follows another account',await page.locator('[name=name]').inputValue(),'');
 await page.keyboard.press('Escape');
 await open();await search();await page.locator('.lookup-results button').nth(1).click();
 await page.evaluate(()=>{miss.condition='LP';miss.conditionChosen=true;miss.copyUids=['physical-fixture'];miss.acquisitionCost=1.25;miss.location='Box A';window.before={uid:miss.scanUid,file:miss.file,url:miss.objectUrl}});
 await page.getByRole('button',{name:'Use this printing'}).click();
 const recovered=await page.evaluate(()=>({success:miss.success,id:miss.groundedId,num:miss.cardNumber,set:miss.setName,manual:miss.manualIdentity,photo:miss.file===before.file&&miss.objectUrl===before.url,uid:miss.scanUid===before.uid,copy:miss.copyUids,condition:[miss.condition,miss.conditionChosen],cost:miss.acquisitionCost,location:miss.location,price:miss.marketPrice,finish:miss.finishConfirmed,requests:sent.length,credits:_idScanCredits,sub:document.getElementById('bulkScanSubtitle').textContent}));
 check('confirmation applies exact selected printing',[recovered.success,recovered.id,recovered.num,recovered.set,recovered.manual],[true,'second','456','Other printing',true]);
 check('physical photo and IDs preserved',[recovered.photo,recovered.uid,recovered.copy],[true,true,['physical-fixture']]);
 check('seller data preserved',[recovered.condition,recovered.cost,recovered.location],[['LP',true],1.25,'Box A']);
 check('safe base finish estimate, still correctable',[recovered.price,recovered.finish],[.25,false]);
 check('no extra scans or credits used',[recovered.requests,recovered.credits],[2,20]);
 check('header and source badge updated',[recovered.sub,await page.locator('#bulk-row-0').textContent().then(s=>s.includes('Selected from catalogue'))],['1/1 cards identified',true]);
 async function reset(){await page.evaluate(()=>{CardResellBulkLookup.close();window._bulkProcessing=false;window._bulkSaved=false;window._bulkDraftBusy=false;window._fbAuth.currentUser={uid:'synthetic'};window._bulkQueue=[prepared];window.miss={...window.miss,success:false,definiteMiss:true,photoRejected:false,manualIdentity:false};window._bulkResults=[miss];_bulkUpdateRow(miss.rowId,miss)});httpStatus=200;response={data:[mtg('first')],has_more:false};hold=null}
 for(const mutation of ['account','batch','remove','replacement','rescued','saved','drafting']){
   await reset();await open();await search();await page.locator('.lookup-results button').first().click();
   const untouched=await page.evaluate(kind=>{
     const old=miss.groundedId;
     if(kind==='account')_fbAuth.currentUser={uid:'other'};
     if(kind==='batch')window._bulkQueue=[];
     if(kind==='remove')_bulkResults.splice(0,1);
     if(kind==='replacement')miss._replacementPhoto={};
     if(kind==='rescued')miss.success=true;
     if(kind==='saved')window._bulkSaved=true;
     if(kind==='drafting')window._bulkDraftBusy=true;
     [...document.querySelectorAll('#bulkLookupDialog button')].find(b=>b.textContent==='Use this printing').click();
     delete miss._replacementPhoto;
     return old===miss.groundedId&&!document.getElementById('bulkLookupDialog');
   },mutation);
   check('stale confirmation blocked: '+mutation,untouched,true);
 }
 await reset();await open();response={data:[pokemon('old'),pokemon('chosen','Correct set','55')],totalCount:25};await search('pokemon','Fixture Mouse');
 check('Pokémon name query and bounded page',new URL(requests.at(-1).url).searchParams.get('q'),'name:"Fixture Mouse"');
 check('next page available',await page.getByRole('button',{name:'Next page'}).isVisible(),true);
 response={data:[pokemon('page-two','Second page','99')],totalCount:25};await page.getByRole('button',{name:'Next page'}).click();await page.waitForFunction(()=>document.querySelector('.lookup-results button')?.textContent.includes('#99'));
 check('pagination keeps catalogue query',new URL(requests.at(-1).url).searchParams.get('page'),'2');
 await page.locator('.lookup-results button').click();await page.getByRole('button',{name:'Use this printing'}).click();
 check('Pokémon exact ID and base price kept',await page.evaluate(()=>[miss.groundedId,miss.cardType,miss.marketPrice,miss.foilHint]),['page-two','pokemon',.1,'']);
 await reset();await open();response={data:[mtg('bad-language','Test','1',{lang:'ja'}),mtg('digital','Test','2',{games:['arena']}),mtg('missing','Test','')],has_more:false};await search();
 check('invalid, foreign and digital results rejected',await page.locator('.lookup-results button').count(),0);
 check('empty result keeps batch recoverable',await page.evaluate(()=>miss.success),false);
 httpStatus=503;await search();check('provider failure visible',await page.locator('#bulkLookupDialog [role=status]').textContent(),'Catalogue could not be reached. Please try again.');
 httpStatus=429;await search();check('rate limit visible',await page.locator('#bulkLookupDialog [role=status]').textContent(),'Catalogue is busy. Wait a moment and search again.');
 httpStatus=404;await search();check('not-found is an empty result',await page.locator('#bulkLookupDialog [role=status]').textContent().then(s=>s.startsWith('No matching')),true);
 httpStatus=200;response={data:[mtg('malicious','<img src=x onerror=alert(1)>','5',{image_uris:{normal:'javascript:alert(1)'}})],has_more:false};await search();
 check('untrusted catalogue data is text',await page.locator('.lookup-results button img').count(),0);
 await page.locator('.lookup-results button').click();check('unsafe artwork not rendered',await page.locator('.lookup-compare img').count(),1);
 await page.keyboard.press('Escape');
 await open();let release;hold=new Promise(r=>release=r);await page.locator('[name=name]').fill('Slow request');await page.getByRole('button',{name:'Search catalogue'}).click();
 await page.waitForFunction(()=>document.querySelector('#bulkLookupDialog [role=status]').textContent==='Searching…');
 await page.keyboard.press('Escape');release();hold=null;
 check('closing pending search leaves failed row unchanged',await page.evaluate(()=>!miss.success&&!document.getElementById('bulkLookupDialog')),true);
 check('no auth header sent to public catalogues',requests.every(r=>!r.headers.authorization),true);
 check('no browser exceptions',errors,[]);
 await page.close();
}console.log(`SUITE COMPLETE: bulk-lookup-browser: ${checks} passed, 0 failed`);
}finally{await browser.close();await new Promise(r=>server.close(r))}
