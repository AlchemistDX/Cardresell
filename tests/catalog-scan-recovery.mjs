// Real shipped catalog -> missed binder row -> explicit approval -> details and
// inventory. Public/paid services are blocked; identity snapshots are real.
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {parse} from 'acorn';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {ROOT,referencedHashedAssets} from './_assetRefs.mjs';
const origin='https://catalog-recovery.test';
let checks=0;const check=(name,actual,expected=true)=>{assert.deepEqual(actual,expected,name);checks++;console.log('✓ '+name)};
const source=readFileSync(referencedHashedAssets().find(x=>x.base==='ui').path,'utf8');
const priceNode=parse(source,{ecmaVersion:'latest'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='_bulkFetchPrice');
for(const kind of ['miss','outage','quote']) {
 let english=0,japanese=0;
 const env={AbortSignal,fetch:async()=>{english++;throw Error('English must not be queried')},
  _bulkFetchPricePokemonJP:async()=>{japanese++;if(kind==='outage')throw Error('offline');return kind==='quote'?{marketPrice:7,variant:'normal'}:null}};
 vm.createContext(env);vm.runInContext(source.slice(priceNode.start,priceNode.end),env);
 let result;try{result=await env._bulkFetchPrice('Pikachu','Japanese set','025','pokemon',true,'en-025','','')}catch{result='unavailable'}
 check(kind+': Japanese pricing never queries English',[english,japanese],[0,1]);
 check(kind+': missing Japanese quotes are not substituted',result?.marketPrice??result,kind==='quote'?7:null);
}
// OCR ambiguity is not a confirmed name, even when both candidates are real.
const module=readFileSync(join(ROOT,'js/search-catalog.js'),'utf8');
const fake={schema:1,game:'onepiece',provider:'fixture',sets:{s:'Set'},cards:[
 ['1','Card Alpha','s','1','','','en'],['2','Card Alphi','s','2','','','en'],['3','Future Name','s','3','','','en','',true]]};
const env={AbortController,setTimeout,clearTimeout,fetch:async url=>({ok:true,json:async()=>url.includes('manifest.')?{schema:1,games:{onepiece:{url:'/data/catalog/onepiece.aaaaaaaaaaaa.json',count:3}}}:fake})};
vm.createContext(env);vm.runInContext(module,env);
check('equally plausible OCR corrections require manual review',await env.CardResellCatalog.suggest('onepiece','Card Alphx'),null);
check('announced products cannot confirm a scanned name',await env.CardResellCatalog.suggest('onepiece','Future Name'),null);

const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try {
 for(const width of [390,1280]) {
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[],requests=[];
  page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>localStorage.setItem('cs_landing_seen','1'));
  await page.route('**/*',async r=>{
   const u=new URL(r.request().url());
   if(['fetch','xhr'].includes(r.request().resourceType()))requests.push({url:u.href,method:r.request().method()});
   if(u.origin!==origin || u.pathname.startsWith('/api/'))return r.fulfill({status:503,contentType:'application/json',body:'{"error":"offline"}'});
   try{const p=join(ROOT,u.pathname==='/'?'index.html':u.pathname);return r.fulfill({body:readFileSync(p),contentType:p.endsWith('.js')?'application/javascript':p.endsWith('.json')?'application/json':p.endsWith('.css')?'text/css':'text/html'})}catch{return r.fulfill({status:404,body:''})}
  });
  await page.goto(origin);await page.waitForFunction(()=>window.CardResellCatalog&&typeof bulkOpenCardInLookup==='function');
  await page.evaluate(()=>{
   window.googleUser={uid:'catalog-test',email:'catalog@example.test'};window._fbAuth={currentUser:{uid:'catalog-test',getIdToken:async()=> 'x'.repeat(40)}};
   window._idScanCredits=20;window.checkProStatus=()=>new Promise(()=>{});
   window.resetCatalogRow=async game=>{
    CardResellBulkLookup.close();CardResellScanTextRecovery.cancelBatch();
    window._bulkTextRescueMisses=async()=>0;window._bulkProcessing=false;window._bulkSaved=false;window._bulkDraftBusy=false;window._bulkQueue=[];
    onGameSelectChange(game);
    const c=document.createElement('canvas');c.width=500;c.height=700;c.getContext('2d').fillRect(0,0,500,700);
    const file=new File([await new Promise(r=>c.toBlob(r))],'copy.png',{type:'image/png'});
    window.row={rowId:'catalog-miss',success:false,definiteMiss:true,scanGameHint:game==='pokemonjp'?'pokemon':game,file,
     objectUrl:URL.createObjectURL(file),scanUid:'scan-copy',copyUids:['physical-copy'],condition:'LP',conditionChosen:true,acquisitionCost:1.25,location:'Box A'};
    window._bulkResults=[row];document.getElementById('bulkResultsList').innerHTML='<div id="catalog-miss"></div>';
    document.getElementById('bulkScanOverlay').style.display='flex';_bulkShowSection('processing');_bulkUpdateRow(row.rowId,row);
   };
  });
  for(const [game,query,title] of [['mtg','Sol Ring','Sol Ring'],['mtg','Insectile Aberration','Insectile Aberration'],['pokemon','Pikachu','Pikachu'],['pokemonjp','Pikachu','Pikachu'],['pokemonjp','ピカチュウ','ピカチュウ'],['yugioh','Dark Magician','Dark Magician'],['lorcana','Mickey','Mickey Mouse - Brave Little Tailor'],['onepiece','Luffy','Monkey.D.Luffy']]) {
   await page.evaluate(async({game,title})=>{
    await resetCatalogRow(game);window.reads=0;window.terminated=0;
    window.Tesseract={createWorker:async()=>({setParameters:async()=>{},terminate:async()=>{terminated++},recognize:async()=>{reads++;return {data:{text:title}}}})};
    await CardResellScanTextRecovery.recoverBatch();
   },{game,title});
   const suggested=await page.evaluate(()=>CardResellScanTextRecovery.suggestion(row));
   check(width+' '+game+' '+query+': all-game batch OCR reaches catalog',suggested?.catalogueMatched,true);
   check(width+' '+game+': OCR remains unconfirmed and unpriced',await page.evaluate(()=>[row.success,row.marketPrice??null,reads,terminated]),[false,null,1,1]);
   await page.locator('#catalog-miss').getByRole('button',{name:'Review read name · free'}).click();
   check(width+' '+game+': recovery preserves language',await page.locator('[name=game]').inputValue(),game);
   await page.locator('[name=name]').fill(query);
   await page.getByRole('button',{name:'Search catalogue',exact:true}).click();
   await page.locator('.lookup-results button').first().waitFor();
   const firstCount=await page.locator('.lookup-results button').count();
   check(width+' '+game+': catalog results have bounded pages',firstCount>0&&firstCount<=24);
   const next=page.getByRole('button',{name:'Next page',exact:true});
   if(await next.isVisible()) {
    const before=await page.locator('.lookup-results button').first().textContent();
    await next.click();await page.waitForFunction(()=>document.querySelector('#bulkLookupDialog [role=status]')?.textContent.startsWith('Page 2'));
    check(width+' '+game+': later printings stay accessible',await page.locator('.lookup-results button').first().textContent()!==before);
   }
   await page.locator('.lookup-results button').first().click();
   check(width+' '+game+': choosing requires explicit approval',await page.evaluate(()=>row.success),false);
   check(width+' '+game+': identity confirmation explains the next price check',await page.getByText('This catalog confirms identity. We’ll check for a matching price when you use this printing.').isVisible());
   if(game==='yugioh')check('YGO does not substitute a card-wide image',await page.locator('.lookup-compare img').count(),1);
   if(process.env.CR_SHOT_DIR&&game==='onepiece')await page.screenshot({path:process.env.CR_SHOT_DIR+'/catalog-binder-'+width+'.png'});
   await page.getByRole('button',{name:'Use this printing',exact:true}).click();
   await page.locator('#bulkLookupDialog').waitFor({state:'detached'});
   const confirmed=await page.evaluate(()=>({game:row.catalogCard.game,name:row.cardName,set:row.setName,number:row.cardNumber,id:row.groundedId,success:row.success,price:row.marketPrice,jp:row.isJapanese,copy:row.copyUids,cost:row.acquisitionCost,location:row.location}));
   check(width+' '+game+': approved catalog identity has no invented price',[confirmed.success,confirmed.price,confirmed.game,confirmed.jp],[true,null,game,game==='pokemonjp']);
   check(width+' '+game+': physical copy and seller data survive',[confirmed.copy,confirmed.cost,confirmed.location],[['physical-copy'],1.25,'Box A']);
   const saved=await page.evaluate(()=>_bulkScanRowToCard(row));
   check(width+' '+game+': collection and draft fields keep the chosen printing',[saved.game,saved.card,saved.set,saved.number,saved.groundedId,saved.isJapanese,saved.condition],[game,confirmed.name,confirmed.set,confirmed.number,confirmed.id,game==='pokemonjp','LP']);
   await page.evaluate(()=>bulkOpenCardInLookup(row.rowId));
   const details=await page.evaluate(()=>({game:activeGame,id:selectedCard.id,name:selectedCard.name,set:selectedCard.setName,number:selectedCard.number,language:selectedCard.language}));
   check(width+' '+game+': details cannot silently choose another printing',details,{game,id:confirmed.id,name:confirmed.name,set:confirmed.set,number:confirmed.number,language:game==='pokemonjp'?'ja':'en'});
  }
  // An entered collector number filters exact printings, never a prefix.
  await page.evaluate(async()=>{await resetCatalogRow('onepiece');CardResellBulkLookup.open(row.rowId)});
  await page.locator('[name=name]').fill('Luffy');await page.locator('[name=number]').fill('OP01-003');
  await page.getByRole('button',{name:'Search catalogue',exact:true}).click();await page.locator('.lookup-results button').first().waitFor();
  check(width+': collector number filters exact printings',await page.locator('.lookup-results button').allTextContents().then(a=>a.length>0&&a.every(t=>t.includes('#OP01-003'))));
  await page.locator('[name=number]').fill('OP01-003-NOT-A-PRINTING');await page.getByRole('button',{name:'Search catalogue',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('#bulkLookupDialog button[type=submit]').disabled);
  check(width+': unknown number never falls back to a different printing',await page.locator('.lookup-results button').count(),0);
  await page.locator('[name=name]').fill('DON!!');await page.locator('[name=number]').fill('');await page.getByRole('button',{name:'Search catalogue',exact:true}).click();
  await page.locator('.lookup-results button').first().waitFor();
  check(width+': unnumbered DON cards remain searchable',await page.locator('.lookup-results button').count()>0);
  await page.keyboard.press('Escape');
  // Delay the shared catalog promise: editing or closing cannot apply late work.
  for(const change of ['edit','close','account','queue']) {
   await page.evaluate(async()=>{await resetCatalogRow('lorcana');window.originalCatalog=CardResellCatalog;
    const found=await originalCatalog.search('lorcana','Mickey');
    window.CardResellCatalog={...originalCatalog,search:()=>new Promise(r=>window.releaseCatalog=()=>r(found))};CardResellBulkLookup.open(row.rowId)});
   await page.locator('[name=name]').fill('Mickey');await page.getByRole('button',{name:'Search catalogue',exact:true}).click();
   await page.waitForFunction(()=>!!window.releaseCatalog);
   if(change==='edit')await page.locator('[name=name]').fill('Elsa');
   else if(change==='close')await page.keyboard.press('Escape');
   else await page.evaluate(change=>{if(change==='account')_fbAuth.currentUser={uid:'changed'};if(change==='queue')_bulkQueue=[]},change);
   await page.evaluate(()=>{releaseCatalog();delete window.releaseCatalog;window.CardResellCatalog=originalCatalog});
   check(width+' '+change+': late catalog response cannot render choices',await page.locator('.lookup-results button').count(),0);
   check(width+' '+change+': late catalog response cannot confirm identity',await page.evaluate(()=>row.success),false);
   await page.evaluate(()=>{CardResellBulkLookup.close();_fbAuth.currentUser={uid:'catalog-test',getIdToken:async()=> 'x'.repeat(40)}});
  }
  // Saving a Japanese physical copy must retain its game after browser storage.
  await page.evaluate(async()=>{await resetCatalogRow('pokemonjp');const f=await CardResellCatalog.search('pokemonjp','ピカチュウ');const c=CardResellCatalog.normalized(f.data,f.rows[0]);Object.assign(row,{success:true,cardType:'pokemon',isJapanese:true,cardName:c.name,setName:c.setName,cardNumber:c.number,groundedId:c.id});_bulkSaveToCollection([row],{0:1.25},false)});
  check(width+': Japanese inventory round-trip retains game and cost',await page.evaluate(()=>{const c=loadPortData().at(-1);return [row.collectionSaved,c.game,c.isJapanese,c.buyPrice,c.condition]}),[true,'pokemonjp',true,1.25,'LP']);
  check(width+': no extra scan/debit requests',requests.filter(r=>/\/api\/(scan|scan-debit-id)(?:$|\?)/.test(r.url)),[]);
  check(width+': credits unchanged',await page.evaluate(()=>_idScanCredits),20);
  check(width+': no browser exceptions',errors,[]);
  await page.close();
 }
 console.log(`catalog-scan-recovery: ${checks} passed, 0 failed -- SUITE COMPLETE`);
} finally {await browser.close()}
