// Product guardrails on the shipped page. Synthetic cards; external/API traffic blocked.
import {chromium} from 'playwright';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import assert from 'node:assert/strict';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('core-values-browser');
const root=resolve(new URL('..',import.meta.url).pathname),origin='http://localhost:8462';
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
let count=0;const check=(v,m)=>{assert.ok(v,m);count++;};
try{for(const width of [320,390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[],writes=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
 await page.route('**/*',route=>{
  const req=route.request(),u=new URL(req.url());if(req.method()!=='GET')writes.push(u.pathname);
  if(u.origin!==origin||u.pathname.startsWith('/api/'))return route.fulfill({status:503,json:{error:'audit_fixture'}});
  try{const p=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!p.startsWith(root+'/'))throw Error();return route.fulfill({body:readFileSync(p),contentType:({'.js':'text/javascript','.html':'text/html','.css':'text/css','.svg':'image/svg+xml'}[extname(p)]||'application/octet-stream')});}catch{return route.fulfill({status:404,body:''});}
 });
 await page.goto(origin);await page.waitForFunction(()=>window.CardResellInventoryRecovery&&typeof openCollectionCardDetail==='function');
 await page.evaluate(()=>{
  window.googleUser={sub:'audit-owner'};window._googleIdToken=null;
  savePortData([{id:'a',card:'Mew',set:'First set',number:'1',game:'pokemon',buyPrice:2,currentValue:10,tcgplayerUrl:'https://www.tcgplayer.com/product/1'},
    {id:'b',card:'Pikachu',set:'Second set',number:'2',game:'pokemon',buyPrice:null,currentValue:15,tcgplayerUrl:'https://www.tcgplayer.com/product/2'}]);
  window.smartLinkResolvers=[];window.realSmartLink=buildTcgpSmart;
  window.buildTcgpSmart=()=>new Promise(resolve=>smartLinkResolvers.push(resolve));
  switchView('collection');openCollectionCardDetail('a');openCollectionCardDetail('b');
  smartLinkResolvers[1]('https://www.tcgplayer.com/product/2');
 });
 await page.evaluate(()=>smartLinkResolvers[0]('https://www.tcgplayer.com/product/1'));
 check((await page.locator('#ccmLookupBtn').getAttribute('href')).includes('/product/2'),'late product lookup cannot replace the currently displayed card link');
 check((await page.locator('#ccmSellBtn').textContent()).includes('research'),'Collection eBay search is labeled research');
 check((await page.locator('#ccmLookupBtn').textContent()).includes('research'),'Collection TCGplayer product link is labeled research');
 const href=new URL(await page.locator('#ccmSellBtn').getAttribute('href'));
 check(href.searchParams.get('LH_Sold')==='1'&&href.searchParams.get('_nkw').includes('Pikachu'),'research link retains current card and sold filter');
 await page.evaluate(()=>{openCollectionCardDetail('a');document.getElementById('collectionCardModal').classList.remove('open');});
 const closedHref=await page.locator('#ccmLookupBtn').getAttribute('href');
 await page.evaluate(()=>smartLinkResolvers[2]('https://www.tcgplayer.com/product/late'));
 check(await page.locator('#ccmLookupBtn').getAttribute('href')===closedHref,'closing the card discards a late product link');
 await page.evaluate(()=>{openCollectionCardDetail('a');googleUser={sub:'different-audit-owner'};});
 const switchedHref=await page.locator('#ccmLookupBtn').getAttribute('href');
 await page.evaluate(()=>smartLinkResolvers[3]('https://www.tcgplayer.com/product/wrong-owner'));
 check(await page.locator('#ccmLookupBtn').getAttribute('href')===switchedHref,'account switch discards the previous account lookup');
 await page.evaluate(()=>{document.getElementById('collectionCardModal').classList.remove('open');googleUser={sub:'audit-owner'};window.buildTcgpSmart=realSmartLink;_collectionSyncNotice('Saved to your account.');});
 check(!await page.locator('#collectionSyncTools').getAttribute('open'),'ordinary Collection view keeps recovery tools collapsed');
 check(!await page.locator('#collectionContent').getByRole('button',{name:'Review sale sync',exact:true}).isVisible(),'recovery controls do not compete with everyday actions');
 check(await page.locator('#collectionImportBtn').isVisible(),'inventory import remains directly available');
 await page.locator('#collectionSyncTools summary').click();
 check(await page.locator('#collectionSyncTools').getByRole('button',{name:'Recover inventory',exact:true}).isVisible(),'recovery remains reachable in one step');
 await page.locator('#collectionSyncTools summary').click();
 await page.evaluate(()=>_collectionSyncNotice('Saved on this device only. Retry sync when connected.',true));
 check(await page.locator('#collectionSyncTools').evaluate(e=>e.open),'a sync failure exposes the recovery controls automatically');
 check(await page.locator('#collectionSyncRetry').isVisible(),'direct retry remains visible outside the collapsed group');
 await page.evaluate(()=>{document.getElementById('collectionSyncTools').open=false;window.realPending=CardResellSaleConflicts.pending;CardResellSaleConflicts.pending=()=>({id:'pending-fixture'});_collectionSyncNotice('A sale choice needs recovery.');CardResellSaleConflicts.pending=realPending;});
 check(await page.locator('#collectionSyncTools').evaluate(e=>e.open),'unfinished saved choice also exposes recovery without requiring a network error');
 check(await page.locator('#collectionSyncTools').evaluate(e=>{const r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1;}),'expanded recovery group fits the viewport');
 if(process.env.CR_CORE_AUDIT_SHOTS){mkdirSync(process.env.CR_CORE_AUDIT_SHOTS,{recursive:true});await page.screenshot({path:process.env.CR_CORE_AUDIT_SHOTS+'/collection-recovery-'+width+'.png'});}
 await page.evaluate(()=>{document.getElementById('flipSyncTools').open=false;_collectionSyncNotice('');switchView('flips');});
 check(!await page.locator('#flipSyncTools').evaluate(e=>e.open),'normal Flips view keeps recovery tools collapsed');
 check(await page.locator('#flipReportToggle').isVisible(),'sales reporting remains directly available');
 await page.locator('#flipSyncTools summary').click();
 check(await page.locator('#flipSyncTools').getByRole('button',{name:'Review inventory sync',exact:true}).isVisible(),'Flips has the same single-step recovery entry');
 check(!(await page.locator('.welcome-source-note').textContent()).includes('when eBay serves them'),'welcome copy does not imply sold-data access follows from connection');
 // Reproduce a real game-switch reset with the previous card's evidence present.
 await page.evaluate(()=>{
  switchView('lookup');
  window._qpChosenTier='high';window._crBasis={amt:1.50};window._ovAutoFilled=true;
  document.getElementById('priceOverride').value='1.50';
  for(const id of ['quickPricing','ebayCompsStatus'])document.getElementById(id).style.display='block';
  document.getElementById('qpTiers').innerHTML='<button>Old card $1.50</button>';
  document.getElementById('ebayCompsStatusText').innerHTML='<a href="https://www.ebay.com/">Old card research</a>';
  window.auditResearchAborted=false;
  window._compsActiveController={abort(){window.auditResearchAborted=true;}};
  window.auditResearchSeq=window._compsRequestSeq||0;
  window.auditImageGen=window._imgGen||0;
  cardImg.onload=()=>{cardImgWrap.style.display='block';};
  cardImg.onerror=()=>{cardImgPhLabel.textContent='Image unavailable';};
  window.auditLateImage=()=>{if(window._imgGen===auditImageGen)cardImgWrap.style.display='block';};
 });
 await page.locator('#gameSelect').selectOption('mtg');
 await page.evaluate(()=>auditLateImage());
 check(await page.locator('#cardImgWrap').isHidden(),'late image upgrade cannot revive the cleared card');
 check(await page.evaluate(()=>cardImg.onload===null&&cardImg.onerror===null&&!cardImg.hasAttribute('src')),'reset detaches image handlers and removes source');
 check(await page.locator('#quickPricing').isHidden(),'game switch hides previous card price choices');
 check(await page.locator('#ebayCompsStatus').isHidden(),'game switch hides previous card research');
 check(await page.locator('#qpTiers').textContent()==='','old price actions are removed');
 check(await page.locator('#ebayCompsStatusText').textContent()==='','old research links are removed');
 check(await page.locator('#priceOverride').inputValue()==='','card-specific override clears on game switch');
 check(await page.evaluate(()=>auditResearchAborted&&window._compsRequestSeq>auditResearchSeq),'game switch aborts and invalidates pending research');
 check(await page.evaluate(()=>!window._crBasis&&!window._qpChosenTier&&!window._ovAutoFilled),'reset clears previous price ownership');
 await page.evaluate(()=>{googleUser=null;switchView('flips');});
 check((await page.locator('#flipsSignInWall').textContent()).includes('10 flips'),'Free sign-in message states the actual flip allowance');
 check(!(await page.locator('#flipsSignInWall').textContent()).includes('all free'),'sign-in message does not imply unlimited free tracking');
 check(!writes.some(p=>/^\/api\/(scan|scan-debit-id|ebay-listing-operations)$/.test(p)),'audit does not make paid or marketplace calls');
 assert.deepEqual(errors,[],'no browser errors');count++;
 await page.close();
}}finally{await browser.close();}
finish(count,0);
