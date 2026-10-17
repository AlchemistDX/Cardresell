// Shipped UI and real browser storage. Synthetic post-scan rows; no provider,
// account or marketplace writes. Draft persistence is covered by bulk-batch-draft.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import assert from 'node:assert/strict';
const root = resolve(new URL('..', import.meta.url).pathname), origin = 'http://localhost:8459';
const browser = await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
let checks=0;
const check=(name,value,expected=true)=>{assert.deepEqual(value,expected,name);checks++;};
try {
 for(const [width,height] of [[320,740],[390,844],[844,390],[1280,900]]) {
  const page=await browser.newPage({viewport:{width,height}}), errors=[], writes=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
  await page.route('**/*',async route=>{
   const req=route.request(),u=new URL(req.url());
   if(req.method()!=='GET')writes.push(u.pathname);
   if(u.origin!==origin||u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'offline_fixture'}});
   try {const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+'/'))throw Error('path');return route.fulfill({body:readFileSync(p),contentType:({'.js':'application/javascript','.css':'text/css','.html':'text/html','.svg':'image/svg+xml'}[extname(p)]||'application/octet-stream')});}
   catch{return route.fulfill({status:404,body:''});}
  });
  await page.goto(origin);await page.waitForFunction(()=>typeof _bulkFinishQueue==='function');
  await page.evaluate(()=>{
   window.googleUser={uid:'workflow-owner',email:'workflow@example.test'};
   window._fbAuth={currentUser:{uid:'workflow-owner',getIdToken:async()=>'x'.repeat(40)}};
   window._googleIdToken='x'.repeat(40);
   window.seedWorkflow=(onlyMisses=false)=>{
    closeBulkScan();localStorage.removeItem('cs_collection');
    // Keep the real account-scoped load/save functions; clear only fixture entries.
    savePortData([]);
    openBulkScan();
    const file=new File(['synthetic'],'card.jpg',{type:'image/jpeg'});
    window._bulkResults=Array.from({length:3},(_,i)=>({rowId:'bulk-row-'+i,scanUid:'copy-'+i,copyUids:i===0?['copy-0','copy-extra']:['copy-'+i],qty:i===0?2:1,file,objectUrl:URL.createObjectURL(file),success:!onlyMisses&&i<2,cardName:!onlyMisses&&i<2?'Fixture '+i:'',setName:'Fixture set',cardNumber:String(i),cardType:'pokemon',marketPrice:!onlyMisses&&i<2?10:null,condition:'LP',conditionChosen:true,definiteMiss:onlyMisses||i===2,error:onlyMisses||i===2?'Could not identify card':''}));
    window._bulkQueue=_bulkResults.map(r=>({file:r.file,objectUrl:r.objectUrl,scanUid:r.scanUid}));
    window._bulkStartPackCost=20;
    _bulkShowSection('processing');
    document.getElementById('bulkResultsList').innerHTML=_bulkResults.map(r=>'<div id="'+r.rowId+'" style="display:flex;gap:12px;padding:12px"></div>').join('');
    _bulkResults.forEach(r=>_bulkUpdateRow(r.rowId,r));_bulkFinishQueue(4);
   };
   seedWorkflow(true);
  });
  check(width+' no identified cards cannot offer a working save',await page.locator('#bulkAddAllBtn').isDisabled());
  check(width+' unresolved next step is visible',await page.locator('#bulkReviewNextBtn').isVisible());
  check(width+' recovery action explains free search',await page.locator('#bulkReviewNextBtn').textContent(),'Find next card by name · free');
  await page.locator('#bulkReviewNextBtn').click();
  check(width+' next step opens catalogue recovery directly',await page.locator('#bulkLookupDialog').isVisible());
  check(width+' opening recovery preserves unidentified rows',await page.evaluate(()=>_bulkResults.every(r=>!r.success)));
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{_bulkResults[0].definiteMiss=false;_bulkResults[0].error='Temporary connection failure';CardResellBulkWorkflow.sync();});
  await page.locator('#bulkReviewNextBtn').click();
  check(width+' free recovery skips transient failures',await page.evaluate(()=>CardResellBulkLookup.isEditing(_bulkResults[1])));
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{_bulkResults.forEach(r=>{r.definiteMiss=false;r.photoRejected=false;});CardResellBulkWorkflow.sync();});
  check(width+' retry-only rows get an accurate action label',await page.locator('#bulkReviewNextBtn').textContent(),'Review an unfinished card');
  await page.locator('#bulkReviewNextBtn').click();
  check(width+' retry-only action focuses the row without opening search',await page.evaluate(()=>!document.getElementById('bulkLookupDialog')&&document.activeElement.closest('#bulk-row-0')!==null));
  await page.evaluate(()=>seedWorkflow());
  if(process.env.CR_SHOT_DIR){await page.screenshot({path:process.env.CR_SHOT_DIR+'/workflow-ready-'+width+'.png'});}
  check(width+' save explains which copies it includes',await page.locator('#bulkAddAllBtn').textContent(),'Save 3 identified cards');
  await page.locator('#bulkAddAllBtn').scrollIntoViewIfNeeded();
  check(width+' save action is reachable inside the viewport',await page.locator('#bulkAddAllBtn').evaluate(e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));
  await page.locator('#bulkAddAllBtn').click();
  check(width+' partial save writes three physical copies',await page.evaluate(()=>loadPortData().length),3);
  check(width+' partial save allocates pack cost across all four physical cards',await page.evaluate(()=>loadPortData().map(r=>r.buyPrice)),[5,5,5]);
  check(width+' partial save keeps unresolved card usable',await page.evaluate(()=>!_bulkSaved&&_bulkResults[2].definiteMiss));
  check(width+' saved cards cannot be accidentally redrafted from scan selection',await page.evaluate(()=>_bulkDraftSelectable().length),0);
  check(width+' save disabled until another card is identified',await page.locator('#bulkAddAllBtn').isDisabled());
  await page.evaluate(()=>bulkAddAllToCollection());
  check(width+' repeated save cannot duplicate copies',await page.evaluate(()=>loadPortData().length),3);
  const chooser=page.waitForEvent('filechooser');
  await page.locator('#bulk-row-2').getByRole('button',{name:'Choose new photo',exact:true}).click();
  await(await chooser).setFiles([]);
  check(width+' replacement input still opens after partial save',true);
  // A recovered provider result, preserving the same physical row, resumes the
  // existing real save path. Provider confirmation is tested in its own gate.
  await page.evaluate(()=>{const r=_bulkResults[2];Object.assign(r,{success:true,definiteMiss:false,error:'',cardName:'Recovered',marketPrice:4});_bulkUpdateRow(r.rowId,r);_bulkRefreshResultSummary();});
  await page.locator('#bulkAddAllBtn').click();
  check(width+' second save adds only the recovered physical card',await page.evaluate(()=>loadPortData().length),4);
  check(width+' total pack cost is not applied a second time',await page.evaluate(()=>loadPortData().reduce((s,r)=>s+r.buyPrice,0)),20);
  check(width+' all saved copies have distinct inventory identities',await page.evaluate(()=>new Set(loadPortData().map(r=>r.id)).size),4);
  await page.evaluate(()=>{bulkSetCondition('bulk-row-0','NM');bulkMergeDuplicates();bulkAddAllToCollection();});
  check(width+' saved rows cannot silently overwrite condition or duplicate copies',await page.evaluate(()=>loadPortData().length===4&&loadPortData().every(r=>r.condition==='LP')));
  await page.evaluate(()=>switchCollectionSection('drafts'));
  await page.locator('#bulkViewCollectionBtn').click();
  check(width+' inventory handoff opens Cards even after visiting Drafts',await page.evaluate(()=>_crCollectionSection),'cards');
  check(width+' handoff retains scan rows',await page.evaluate(()=>_bulkResults.length),3);
  await page.locator('#backToBulkPill').click();
  check(width+' back returns to saved batch',await page.locator('#bulkScanOverlay').isVisible());
  await page.evaluate(()=>seedWorkflow());
  await page.evaluate(()=>{window._originalSet=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k===getUserKey('portfolio'))throw new DOMException('Fixture quota','QuotaExceededError');return _originalSet.call(this,k,v)};});
  await page.locator('#bulkAddAllBtn').click();
  check(width+' failed storage leaves every ready row unsaved',await page.evaluate(()=>!_bulkSaved&&_bulkResults.every(r=>!r.collectionSaved)&&loadPortData().length===0));
  await page.evaluate(()=>{Storage.prototype.setItem=_originalSet;window._bulkDraftBusy=true;_bulkDraftSyncSelectionUI();});
  check(width+' save waits for draft preparation',await page.locator('#bulkAddAllBtn').isDisabled());
  await page.evaluate(()=>CardResellBulkWorkflow.navigate('drafts'));
  check(width+' in-flight batch stays visible',await page.locator('#bulkScanOverlay').isVisible());
  await page.evaluate(()=>{_bulkDraftBusy=false;_bulkDraftSyncSelectionUI();});
  await page.evaluate(()=>{_bulkDraftOutcomes['copy-0']={status:'created',draftId:'fixture-draft'};_bulkDraftShowDraftsLink();_bulkDraftSel=['copy-1'];_bulkDraftSyncSelectionUI();});
  check(width+' review drafts is visible without opening More actions',await page.locator('#bulkGoToDraftsBtn').isVisible());
  await page.locator('#bulkGoToDraftsBtn').focus();await page.evaluate(()=>_bulkDraftSyncSelectionUI());
  check(width+' row refresh preserves keyboard focus on the handoff',await page.evaluate(()=>document.activeElement.id),'bulkGoToDraftsBtn');
  await page.locator('#bulkGoToDraftsBtn').click();
  check(width+' review opens Drafts',await page.evaluate(()=>_crCollectionSection),'drafts');
  check(width+' draft review does not discard photos or selection',await page.evaluate(()=>_bulkResults.length===3&&_bulkQueue.length===3&&_bulkDraftSel.includes('copy-1')));
  await page.locator('#backToBulkPill').click();
  check(width+' return target at least 44px',await page.locator('#bulkScanHeader button').evaluate(e=>e.getBoundingClientRect().height>=44));
  await page.locator('#bulkScanHeader button').click();
  check(width+' closing results retains the current batch',await page.evaluate(()=>_bulkPaused&&_bulkResults.length===3));
  await page.evaluate(()=>openBulkScan());
  check(width+' scanning entry resumes existing batch',await page.locator('#bulkProcessing').isVisible());
  await page.keyboard.press('Escape');
  check(width+' Escape retains results just like the close button',await page.evaluate(()=>_bulkPaused&&_bulkResults.length===3));
  await page.locator('#backToBulkPill').click();
  await page.evaluate(()=>{_bulkProcessing=true;CardResellBulkWorkflow.close();});
  check(width+' background scanning is not cancelled by leaving the screen',await page.evaluate(()=>_bulkProcessing&&_bulkPaused&&_bulkQueue.length===3));
  await page.evaluate(()=>{openBulkScan();_bulkProcessing=false;_bulkDraftSyncSelectionUI();});
  await page.locator('#bulkMoreActions summary').click();
  await page.locator('#bulkScanMoreBtn').click();
  check(width+' new batch asks before discarding unsaved cards',await page.locator('#bulkNewBatchDialog').isVisible());
  await page.getByRole('button',{name:'Keep this batch',exact:true}).click();
  check(width+' cancel new batch leaves all cards intact',await page.evaluate(()=>_bulkResults.length),3);
  if(process.env.CR_SHOT_DIR){mkdirSync(process.env.CR_SHOT_DIR,{recursive:true});await page.screenshot({path:process.env.CR_SHOT_DIR+'/workflow-'+width+'.png'});}
  check(width+' footer and results fit viewport',await page.locator('#bulkScanOverlay').evaluate(e=>e.scrollWidth<=innerWidth&&document.getElementById('bulkResultsList').getBoundingClientRect().height>=64));
  await page.locator('#bulkScanMoreBtn').click();
  await page.getByRole('button',{name:'Discard and start new batch',exact:true}).click();
  check(width+' confirmed new batch clears only old scan work',await page.evaluate(()=>_bulkResults.length===0&&_bulkQueue.length===0&&document.getElementById('bulkModePicker').style.display==='flex'));
  // The previous inventory was intentionally cleared by seedWorkflow; starting
  // another scan must not create or mutate account data.
  await page.evaluate(()=>{
   seedWorkflow();const r=_bulkResults[2];
   CardResellBulkMatchReview.stage(r,{needsPicker:true,confirmation_id:'a'.repeat(64),candidate_set:'b'.repeat(64),scan_id:'pending-fixture',candidates:[{card_name:'Choice one',set_name:'A',card_number:'1'},{card_name:'Choice two',set_name:'B',card_number:'2'}]});
   _bulkUpdateRow(r.rowId,r);bulkAddAllToCollection();
  });
  check(width+' partial save leaves pending confirmation available',await page.evaluate(()=>loadPortData().length===3&&!_bulkSaved&&!_bulkResults[2].success));
  await page.locator('#bulkReviewNextBtn').click();
  check(width+' next review opens the retained receipt choices',await page.locator('.bulk-match-choices button').count(),2);
  await page.keyboard.press('Escape');
  await page.evaluate(()=>{closeBulkScan();openBulkScan();_bulkQueue=[{file:new File(['photo'],'queued.jpg',{type:'image/jpeg'}),objectUrl:'',scanUid:'queued-photo'}];_bulkShowSection('creditConfirm');CardResellBulkWorkflow.close();});
  await page.evaluate(()=>openBulkScan());
  check(width+' queued photos also survive closing and reopening',await page.evaluate(()=>_bulkQueue.length===1&&document.getElementById('bulkCreditConfirm').style.display==='flex'));
  await page.evaluate(()=>{seedWorkflow();window.googleUser={uid:'different-owner'};window._fbAuth.currentUser={uid:'different-owner'};bulkAddAllToCollection();});
  check(width+' account change cannot save another seller’s scan rows',await page.evaluate(()=>loadPortData().length),0);
  await page.evaluate(()=>openBulkScan());
  check(width+' new account sees an empty batch',await page.evaluate(()=>_bulkResults.length===0&&_bulkQueue.length===0));
  check(width+' no provider or marketplace write requests',writes.filter(p=>/^\/api\/(scan(?:-debit-id)?|drafts|ebay-listing-operations)$/.test(p)),[]);
  check(width+' no browser exceptions',errors,[]);
  await page.close();
 }
} finally {await browser.close();}
console.log(`bulk-workflow-browser: ${checks} passed, 0 failed -- SUITE COMPLETE`);
