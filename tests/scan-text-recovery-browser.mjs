// Shipped scanner -> free OCR -> explicit printing review. Services are
// synthetic; native Tesseract checks crop geometry, not phone-photo accuracy.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {chromium} from 'playwright';
const root=resolve(new URL('..',import.meta.url).pathname),origin='https://text-recovery.test';
const html=readFileSync(join(root,'index.html'),'utf8');
const modulePath=html.match(/src="\/(js\/scan-text-recovery\.[a-f0-9]+\.js)"/)[1];
assert.equal(readFileSync(join(root,modulePath),'utf8'),readFileSync(join(root,'js/scan-text-recovery.js'),'utf8'));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
const temp=mkdtempSync(join(tmpdir(),'cardresell-text-recovery-'));
let checks=0;const check=(name,value,expected=true)=>{assert.deepEqual(value,expected,name);checks++;console.log('✓ '+name)};
let detectedGame='mtg';
const card={id:'reviewed-printing',name:'Rubble Rouser',set:'tst',set_name:'Chosen test set',collector_number:'128',lang:'en',games:['paper'],finishes:['nonfoil'],prices:{usd:'0.25'},image_uris:{normal:'https://cards.scryfall.io/test.jpg'}};
try{
 const page=await browser.newPage({viewport:{width:390,height:844}}),requests=[],errors=[];
 page.setDefaultTimeout(8000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
 await page.route('**/*',async route=>{
  const req=route.request(),u=new URL(req.url());
  const json=(value,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(value)});
  if(['fetch','xhr'].includes(req.resourceType()))requests.push({url:u.href,method:req.method()});
  if(u.hostname==='api.scryfall.com')return json(u.pathname.includes('/search')?{data:[card],has_more:false}:card);
  if(u.hostname==='api.pokemontcg.io')return json({data:[{id:'test-Plusle',name:'Plusle',number:'76',set:{id:'test',name:'Test set'},images:{}}]});
  if(u.origin!==origin)return route.fulfill({status:503,body:'offline'});
  if(u.pathname==='/api/scan')return json({success:true,identified:false,card_name:'',card_type:'',detected_game:detectedGame,grounded_id:null,refunded:true});
  if(u.pathname==='/api/pro-status')return json({tier:'pro',idFreeLeft:20,idPaidLeft:0});
  if(u.pathname.startsWith('/api/'))return json({error:'offline'},503);
  try{const file=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!file.startsWith(root+'/'))throw Error('path');return route.fulfill({body:readFileSync(file),contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'text/html'})}
  catch{return route.fulfill({status:404,body:''})}
 });
 await page.goto(origin);await page.waitForFunction(()=>typeof processScanImage==='function'&&window.CardResellScanTextRecovery);
 await page.evaluate(()=>{
  window.googleUser={uid:'ocr-test',email:'ocr@example.test'};window._fbAuth={currentUser:{uid:'ocr-test',getIdToken:async()=> 'x'.repeat(40)}};
  window._idScanCredits=20;window.checkProStatus=()=>new Promise(()=>{});window._scheduleScanAutoAdvance=()=>{};
  window.CardResellPhotoQC.check=async()=>({ok:true});window.CardResellFastPath.scanFile=async()=>({hit:false});
  window.compressImage=async()=> 'synthetic-photo';window._lastIdentifiedCard=null;
  window.makePhoto=async(offset=.28,inverted=false)=>{
   const c=document.createElement('canvas');c.width=500;c.height=700;const x=c.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,500,700);
   if(inverted){x.translate(500,700);x.rotate(Math.PI)}
   x.fillStyle='#000';x.font='bold 24px Arial';x.textBaseline='top';x.fillText('Rubble Rouser',42,700*offset);
   return new File([await new Promise(r=>c.toBlob(r,'image/png'))],'card.png',{type:'image/png'});
  };
  window.readerReset=(texts=['','','Rubble Rouser'])=>{
   window.ocrTexts=texts;window.ocrReads=0;window.ocrTerminated=0;window.ocrWorkers=0;window.ocrLanguages=[];window.ocrImages=[];window.ocrReleases=[];window.ocrHold=false;
   window.Tesseract={createWorker:async language=>{ocrWorkers++;ocrLanguages.push(language);return {
    setParameters:async()=>{},terminate:async()=>{ocrTerminated++},recognize:async canvas=>{
     const n=ocrReads++;ocrImages.push(canvas.toDataURL('image/png').split(',')[1]);
     if(ocrHold)await new Promise(r=>ocrReleases.push(r));return {data:{text:ocrTexts[n%ocrTexts.length]||''}};
    }
   }}};
  };
  window.resetRows=async()=>{
   cancelScan();CardResellBulkLookup.close();CardResellScanTextRecovery.cancelBatch();_bulkCancelTextRescue();
   window._bulkProcessing=false;window._bulkSaved=false;window._bulkDraftBusy=false;window._bulkQueue=[];
   window._fbAuth.currentUser={uid:'ocr-test',getIdToken:async()=> 'x'.repeat(40)};window.activeGame='pokemon';
   window.batchPhoto=await makePhoto();
   window._bulkResults=[0,1].map(i=>({success:false,definiteMiss:true,scanGameHint:'mtg',file:batchPhoto,rowId:'bulk-row-'+i,
    objectUrl:URL.createObjectURL(batchPhoto),scanUid:'scan-'+i,copyUids:['copy-'+i],condition:'LP',conditionChosen:true,acquisitionCost:1.25,location:'Box A'}));
   window.originalRows=[..._bulkResults];document.getElementById('bulkResultsList').innerHTML=_bulkResults.map(r=>'<div id="'+r.rowId+'"></div>').join('');
   document.getElementById('bulkScanOverlay').style.display='flex';document.getElementById('bulkModePicker').style.display='none';
   document.getElementById('bulkCreditConfirm').style.display='none';document.getElementById('bulkProcessing').style.display='flex';
   _bulkResults.forEach(r=>_bulkUpdateRow(r.rowId,r));
  };
 });
 // One bad/empty strip is not the end. The current game selector is Pokémon;
 // the provider's independent visual Magic hint must route to Scryfall.
 const beforeRequests=requests.length;
 await page.evaluate(async()=>{readerReset();window.scanWork=processScanImage({files:[await makePhoto()]})});
 await page.evaluate(()=>scanWork);
 check('single scan tries three title positions',await page.evaluate(()=>ocrReads),3);
 check('worker released after successful suggestion',await page.evaluate(()=>ocrTerminated),1);
 check('name does not silently select a printing',await page.evaluate(()=>!_lastIdentifiedCard&&!_pendingIdScanCard&&!_pendingScanBannerCard));
 check('explicit printing review is offered',await page.getByRole('button',{name:'Review matching printings'}).count(),1);
 check('review button meets touch target',await page.getByRole('button',{name:'Review matching printings'}).evaluate(e=>e.getBoundingClientRect().height>=44));
 if(process.env.CR_SHOT_DIR)await page.screenshot({path:join(process.env.CR_SHOT_DIR,'single-text-recovery.png')});
 check('no extra vision or inventory write',requests.slice(beforeRequests).filter(r=>r.method==='POST'&&/\/api\/(scan|scan-debit-id|user-data|drafts)(?:$|\?)/.test(r.url)).map(r=>new URL(r.url).pathname),['/api/scan']);
 await page.getByRole('button',{name:'Review matching printings'}).click();
 check('review routes to Magic search',await page.evaluate(()=>[activeGame,document.getElementById('searchInput').value]),['mtg','Rubble Rouser']);
 detectedGame='pokemon';
 await page.evaluate(async()=>{onGameSelectChange('pokemonjp');readerReset(['Plusle']);window.scanWork=processScanImage({files:[await makePhoto()]})});await page.evaluate(()=>scanWork);
 check('general Pokémon tag preserves Japanese OCR choice',await page.evaluate(()=>ocrLanguages),['jpn+eng']);
 await page.getByRole('button',{name:'Review matching printings'}).click();
 check('Japanese review stays in Japanese search',await page.evaluate(()=>[activeGame,document.getElementById('searchInput').value]),['pokemonjp','Plusle']);
 await page.evaluate(()=>_scanMissSearchByName('Fixture Player','sports'));
 check('sports recovery reaches the visible sports input',await page.locator('#sportsSearchInput').isVisible());
 check('sports name is preserved',await page.locator('#sportsSearchInput').inputValue(),'Fixture Player');
 await page.evaluate(()=>onGameSelectChange('pokemon'));detectedGame='mtg';
 // General recognition/cleanup boundaries on actual canvases.
 for(const game of ['mtg','pokemon','pokemonjp','yugioh','lorcana','onepiece','sports']){
  const result=await page.evaluate(async game=>{readerReset(['','Unknown title','Rubble Rouser']);window.lookups=[];
   const value=await CardResellScanTextRecovery.find(await makePhoto(),{game,lookup:async(name,key)=>{lookups.push([name,key]);return name==='Rubble Rouser'?{name,number:'wrong',price:99,groundedId:'must-not-leak'}:null}});
   return {value,reads:ocrReads,closed:ocrTerminated,language:ocrLanguages[0]};
  },game);
  check(game+': later attempt returns name only',result,{value:{name:'Rubble Rouser',game,catalogueMatched:true},reads:3,closed:1,language:game==='pokemonjp'?'jpn+eng':'eng'});
 }
 check('provider aliases normalize for recovery',await page.evaluate(()=>['Magic The Gathering','YuGiOh!','One Piece','Pokémon Japanese','Disney Lorcana'].map(CardResellScanTextRecovery.gameKey)),['mtg','yugioh','onepiece','pokemonjp','lorcana']);
 const empty=await page.evaluate(async()=>{readerReset(['']);let completed=0;const v=await CardResellScanTextRecovery.find(await makePhoto(),{game:'mtg',onComplete:()=>completed++});return [v,ocrReads,ocrTerminated,completed]});
 check('blank photo tries all four windows and finishes',empty,[null,4,1,1]);
 const noisy=await page.evaluate(async()=>{readerReset(['a ne S te j a q\nSe aaa\nOse et ks\nae Plusle w.30 ; other noise']);let queries=[];
  const value=await CardResellScanTextRecovery.find(await makePhoto(),{game:'pokemon',lookup:async(name)=>{queries.push(name);return name.includes('Plusle')?{name:'Plusle'}:null}});return [value,queries];});
 check('sleeve noise cannot hide a later title line',noisy,[{name:'Plusle',game:'pokemon',catalogueMatched:true},['ae Plusle']]);
 check('Pokémon catalogue tolerates a leading noise token',await page.evaluate(async()=> (await _confirmCardByName('ae Plusle','pokemon'))?.name),'Plusle');
 check('name recovery uses the audited local catalog',requests.some(r=>/\/data\/catalog\/pokemon\.[a-f0-9]+\.json/.test(r.url)),true);
 const capped=await page.evaluate(async()=>{readerReset(['Name Alpha\nName Bravo','Name Charlie\nName Delta','Name Echo\nName Foxtrot','Name Golf\nName Hotel']);let calls=0;
  const value=await CardResellScanTextRecovery.find(await makePhoto(),{game:'onepiece',lookup:async()=>{calls++;return null}});return [value,ocrReads,calls];});
 check('catalogue attempts bounded; raw text stays unconfirmed',capped,[{name:'Name Alpha',game:'onepiece',catalogueMatched:false},4,6]);
 for(const mode of ['cancel','account','timeout','late-worker']){
  await page.evaluate(async mode=>{
   readerReset();window.ocrHold=true;window.controller=new AbortController();window.stillCurrent=true;
   const oldTimer=window.setTimeout;window.restoreTimer=()=>window.setTimeout=oldTimer;
   if(mode==='timeout')window.setTimeout=(f,ms,...a)=>oldTimer(f,ms===8000?80:ms,...a);
   if(mode==='late-worker')Tesseract.createWorker=()=>new Promise(r=>window.releaseWorker=()=>r({setParameters:async()=>{},recognize:async()=>({data:{text:'Rubble Rouser'}}),terminate:async()=>{ocrTerminated++}}));
   window.directWork=CardResellScanTextRecovery.find(await makePhoto(),{game:'mtg',signal:controller.signal,isCurrent:()=>stillCurrent});
  },mode);
  if(mode==='late-worker'){await page.waitForFunction(()=>!!window.releaseWorker);await page.evaluate(()=>controller.abort());}
  else {await page.waitForFunction(()=>ocrReads>0);if(mode==='cancel')await page.evaluate(()=>controller.abort());if(mode==='account')await page.evaluate(()=>{stillCurrent=false});}
  check(mode+': stops without a result',await page.evaluate(()=>directWork),null);
  await page.evaluate(mode=>{restoreTimer();ocrReleases.splice(0).forEach(r=>r());if(mode==='late-worker')releaseWorker();},mode);
  await page.waitForFunction(()=>ocrTerminated===1);
  check(mode+': worker terminated once',await page.evaluate(()=>ocrTerminated),1);
 }
 // Stop must stop the entire recovery chain, including its next stage.
 await page.evaluate(async()=>{await resetRows();readerReset(['Rubble Rouser']);ocrHold=true;
  Object.assign(_bulkResults[0],{success:true,definiteMiss:false,cardType:'mtg',setCode:'tst'});_bulkFinishQueue(2);
 });
 await page.waitForFunction(()=>ocrReads>0);await page.getByRole('button',{name:'Stop name recovery',exact:true}).click();
 await page.evaluate(()=>{ocrHold=false;ocrReleases.splice(0).forEach(r=>r())});await page.waitForTimeout(50);
 check('stopping the first recovery stage prevents follow-on OCR',await page.evaluate(()=>[ocrWorkers,!!document.getElementById('bulkNameRecoveryStatus')]),[1,false]);
 // Zero-match binder page gets recovery without a previously known set.
 await page.evaluate(async()=>{await resetRows();readerReset(['Rubble Rouser']);_bulkFinishQueue(2)});
 await page.waitForFunction(()=>_bulkResults.every(r=>CardResellScanTextRecovery.suggestion(r)));
 await page.waitForFunction(()=>!document.getElementById('bulkNameRecoveryStatus'));
 check('zero-match page now attempts every eligible row',await page.evaluate(()=>ocrReads),2);
 check('binder names stay unpriced and unconfirmed',await page.evaluate(()=>_bulkResults.every(r=>!r.success&&!r.groundedId&&r.marketPrice==null&&!r.manualIdentity)));
 check('recovery uses no ID credits',await page.evaluate(()=>_idScanCredits),20);
 check('seller data preserved',await page.evaluate(()=>_bulkResults.every((r,i)=>r.file===batchPhoto&&r.copyUids[0]==='copy-'+i&&r.condition==='LP'&&r.acquisitionCost===1.25&&r.location==='Box A')));
 if(process.env.CR_SHOT_DIR)await page.screenshot({path:join(process.env.CR_SHOT_DIR,'binder-text-recovery.png')});
 const catalogueBefore=requests.filter(r=>r.url.includes('/cards/search')).length;
 await page.locator('#bulk-row-0').getByRole('button',{name:'Review read name · free'}).click();
 check('name review prefills the matching game',await page.locator('[name=name]').inputValue(),'Rubble Rouser');
 check('prefill does not query or select automatically',requests.filter(r=>r.url.includes('/cards/search')).length,catalogueBefore);
 await page.getByRole('button',{name:'Search catalogue'}).click();await page.locator('.lookup-results button').click();
 check('printing still needs seller approval',await page.evaluate(()=>_bulkResults[0].success),false);
 // Stop older same-set rescue here so this assertion covers only explicit approval.
 await page.evaluate(()=>{window._bulkTextRescueMisses=async()=>0});
 await page.getByRole('button',{name:'Use this printing'}).click();
 check('explicit approval commits that printing only',await page.evaluate(()=>_bulkResults.map(r=>[r.success,r.groundedId||null])),[[true,'reviewed-printing'],[false,null]]);
 check('confirmed row retains cost and physical copy',await page.evaluate(()=>[_bulkResults[0].copyUids[0],_bulkResults[0].acquisitionCost,_bulkResults[0].location]),['copy-0',1.25,'Box A']);
 for(const change of ['stop','account','photo','queue','close']){
  await page.evaluate(async()=>{await resetRows();readerReset();ocrHold=true;window.batchWork=CardResellScanTextRecovery.recoverBatch()});
  await page.waitForFunction(()=>ocrReads>0);
  if(change==='stop')await page.getByRole('button',{name:'Stop reading card names'}).click();
  else await page.evaluate(async kind=>{if(kind==='account')_fbAuth.currentUser={uid:'other'};if(kind==='photo')originalRows.forEach(r=>r.file=new File(['changed'],'new.png',{type:'image/png'}));if(kind==='queue')_bulkQueue=[];if(kind==='close')closeBulkScan();},change);
  await page.evaluate(()=>{ocrHold=false;ocrReleases.splice(0).forEach(r=>r())});await page.evaluate(()=>batchWork);
  check(change+': stale batch cannot apply names',await page.evaluate(()=>originalRows.every(r=>!r.success&&!CardResellScanTextRecovery.suggestion(r))));
  check(change+': status removed',await page.locator('#bulkNameRecoveryStatus').count(),0);
 }
 await page.evaluate(async()=>{await resetRows();readerReset(['']);_bulkResults[1].providerNeedsReview=true;await CardResellScanTextRecovery.recoverBatch();await CardResellScanTextRecovery.recoverBatch()});
 check('pending provider choices are skipped and blank photos are not repeated',await page.evaluate(()=>ocrReads),4);
 // A late old same-set job cannot start OCR on a replacement batch.
 await page.evaluate(async()=>{await resetRows();readerReset();window._bulkTextRescueMisses=()=>new Promise(r=>window.releaseOld=r);_bulkFinishQueue(2);await resetRows();releaseOld();});
 await page.waitForTimeout(30);
 check('old finish callback cannot start a new batch',await page.evaluate(()=>ocrReads),0);
 // Real OCR consumes the exact crop canvases generated by the shipped module.
 for(const sample of [{game:'mtg',offset:.05},{game:'mtg',offset:.18},{game:'mtg',offset:.28},{game:'mtg',offset:.05,inverted:true},{game:'lorcana',offset:.53},{game:'sports',offset:.79}]){
  const strips=await page.evaluate(async s=>{readerReset(['']);await CardResellScanTextRecovery.find(await makePhoto(s.offset,s.inverted),{game:s.game});return ocrImages},sample);
  const text=[];for(let i=0;i<strips.length;i++){
   const file=join(temp,'strip-'+i+'.png');writeFileSync(file,Buffer.from(strips[i],'base64'));
   const result=spawnSync(process.env.CR_TESSERACT||'tesseract',[file,'stdout','--psm','6'],{encoding:'utf8',timeout:10000,env:{...process.env,OMP_THREAD_LIMIT:'1'}});
   assert.equal(result.status,0,result.stderr||String(result.error));text.push(result.stdout);
  }
  check(`native OCR: ${sample.game}, title ${sample.offset}, inverted ${!!sample.inverted}`,text.some(s=>s.includes('Rubble Rouser')));
 }
 check('no browser exceptions',errors,[]);
 check('no confirmation, inventory or listing writes during recovery',requests.filter(r=>r.method!=='GET'&&/\/api\/(scan-debit-id|user-data|drafts)/.test(r.url)),[]);
 console.log(`scan-text-recovery-browser: ${checks} passed, 0 failed -- SUITE COMPLETE`);
}finally{await browser.close();rmSync(temp,{recursive:true,force:true})}
