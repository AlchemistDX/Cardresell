import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createHandler} from '../api/ebay-listing-review.js';
import {config,keys,hash,seal} from '../api/_ebaySeller.js';
import {draftKey} from '../api/_draftStore.js';
import {reviewKey} from '../api/_ebaySubmission.js';
import {redisCommand} from './_idRedis.mjs';
import {env,draft,reference,photo,photoHost} from './_ebayReviewFixture.mjs';
import {ROOT} from './_assetRefs.mjs';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('ebay-listing-review-browser');let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const kv=(...args)=>redisCommand(args),who='browser-review-owner',cfg=config(env),k=keys('production',hash(who));
const record={accountHash:hash('browser-seller'),version:'connection-v1',cipher:seal({accessToken:'fixture',refreshToken:'PRIVATE',accessExpiresAt:Date.now()+3600000,refreshExpiresAt:Date.now()+86400000},cfg,hash(who))};
let configured=false,failNext=false,held=false,release=null,requests=[];
const handler=createHandler({env,verify:async token=>({uid:token}),store:kv,photoHost,referenceLoader:async()=>{if(held)await new Promise(r=>release=r);return reference;}});
const off=createHandler({env:{},verify:async token=>({uid:token}),store:kv,photoHost:null});
const module=readFileSync(ROOT+'/js/ebay-listing-review.js','utf8');
const html=readFileSync(ROOT+'/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
window.googleUser={sub:${JSON.stringify(who)}};
let _reviewState={draft:${JSON.stringify(draft)},loading:false,gone:false};
async function _crIdToken(){return googleUser?.sub}
async function photosList(){return {photos:[{id:'ph_front',name:'Front photo',missing:false}],hosted:{ph_front:${JSON.stringify(photo)}}}}
document.getElementById('reviewView').style.display='block';
document.getElementById('reviewWrap').innerHTML='<section id="review-ebay-step"></section>';
${module}
</script>`;
const server=createServer(async(req,res)=>{
 try {
  if(!req.url.startsWith('/api/ebay-listing-review')){res.setHeader('Content-Type','text/html');res.end(html);return;}
  let body='';for await(const part of req)body+=part;requests.push({method:req.method,body:body?JSON.parse(body):null});
  if(failNext){failNext=false;res.statusCode=503;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:'Fixture temporary failure. Reload the saved review to recover.'}));return;}
  const u=new URL(req.url,'http://localhost');
  // The local fixture stands in for the configured HTTPS app origin. Origin
  // refusal itself is exercised by the server suite.
  const request={method:req.method,headers:{...req.headers,origin:env.EBAY_SELLER_ORIGIN},query:Object.fromEntries(u.searchParams),body:body?JSON.parse(body):{}};
  const response={setHeader:(n,v)=>res.setHeader(n,v),status(n){res.statusCode=n;return this;},json(data){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return this;}};
  await (configured?handler:off)(request,response);
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});mkdirSync('/tmp/cardresell-ebay-review-shots',{recursive:true});
try {
 for(const width of [390,1280]) {
  await kv('SET',draftKey(who,draft.draftId),JSON.stringify(draft));await kv('DEL',reviewKey('production',who,draft.draftId));await kv('DEL','ebayreview:rate:'+hash(who));await kv('SET',k.connection,JSON.stringify(record));
  configured=false;requests=[];
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);const launch=page.getByRole('button',{name:'Check direct eBay readiness',exact:true});await launch.waitFor();
  check(await launch.count()===1,'one readiness entry in real review slot');await launch.click();const dialog=page.locator('#ebayListingReview');await dialog.getByRole('button',{name:'Check and save review',exact:true}).waitFor();
  check((await dialog.textContent()).includes('awaiting setup')&&await dialog.getByRole('button',{name:'Load current eBay requirements'}).count()===0,'unconfigured customer sees honest setup state');
  await dialog.getByRole('button',{name:'Check and save review',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ebayListingReview [role=status]').textContent.includes('Review saved.'));
  check((await dialog.textContent()).includes('No listing was created or changed.'),'saved blocked review does not imply publication');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();configured=true;await launch.click();await dialog.getByRole('button',{name:'Load current eBay requirements'}).waitFor();
  check(await dialog.getByRole('button',{name:'Check and save review',exact:true}).isDisabled(),'checking waits for current requirements');
  check(await dialog.getByLabel('I reviewed the card identity, condition, photos and eBay selling terms.').count()===0,'seller cannot confirm unseen policies');
  check((await dialog.textContent()).includes('Your eBay account is connected.'),'review acknowledges existing connection');
  check(await dialog.getByRole('button',{name:'Load current eBay requirements'}).evaluate(b=>b.getBoundingClientRect().top<b.closest('dialog').getBoundingClientRect().top+400),'first action is visible near the top');
  failNext=true;await dialog.getByRole('button',{name:'Load current eBay requirements'}).click();await dialog.getByRole('alert').filter({hasText:'temporary failure'}).waitFor();
  check(await dialog.getByRole('button',{name:'Check and save review',exact:true}).isDisabled(),'failed requirements request cannot enable a check');
  await dialog.getByRole('button',{name:'Load current eBay requirements'}).click();await dialog.getByLabel('Card Condition (required)',{exact:true}).waitFor({timeout:6000}).catch(async e=>{console.log(await dialog.textContent(),errors,requests);throw e;});
  check(await dialog.getByLabel('Card Condition (required)',{exact:true}).inputValue()==='','condition is a deliberate seller selection');
  await dialog.getByLabel('Card Condition (required)',{exact:true}).selectOption('400010');
  await dialog.getByLabel('Shipping policy',{exact:true}).selectOption('fp1');await dialog.getByLabel('Payment policy',{exact:true}).selectOption('pp1');await dialog.getByLabel('Return policy',{exact:true}).selectOption('rp1');await dialog.getByLabel('Inventory location',{exact:true}).selectOption('shelf1');
  await dialog.getByLabel('Use Front photo',{exact:true}).check();await dialog.getByLabel('I confirm this physical copy is still available to sell.').check();await dialog.getByLabel('I reviewed the card identity, condition, photos and eBay selling terms.').check();
  await dialog.getByLabel('Set',{exact:true}).fill('Base Set revised');await dialog.getByLabel('Set',{exact:true}).blur();
  check(!await dialog.getByLabel('I reviewed the card identity, condition, photos and eBay selling terms.').isChecked(),'editing a value clears previous confirmation');
  await dialog.getByLabel('Set',{exact:true}).fill('Base Set');await dialog.getByLabel('Set',{exact:true}).blur();
  await dialog.getByLabel('I reviewed the card identity, condition, photos and eBay selling terms.').check();
  await dialog.getByRole('button',{name:'Check and save review',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ebayListingReview [role=status]').textContent.includes('Review saved.'));
  check((await dialog.textContent()).includes('Preparation checks passed; publishing is not enabled'),'real browser → API → Redis → verified payload succeeds');
  const saved=JSON.parse(await kv('GET',reviewKey('production',who,draft.draftId)));check(saved.report.payload.inventoryItem.product.imageUrls[0].includes('/'+draft.draftId+'/ph_front/'),'owner-verified photo URL reaches payload');
  check(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().width<=innerWidth),'dialog fits '+width+'px');
  await dialog.evaluate(d=>d.scrollTop=0);await page.screenshot({path:'/tmp/cardresell-ebay-review-shots/review-'+width+'.png'});
  await page.reload();await launch.click();await dialog.getByRole('button',{name:'Load current eBay requirements'}).click();await dialog.getByLabel('Card Condition (required)',{exact:true}).waitFor({timeout:6000}).catch(async e=>{console.log(await dialog.textContent(),errors,requests);throw e;});
  check(await dialog.getByLabel('Card Condition (required)',{exact:true}).inputValue()==='400010'&&await dialog.getByLabel('Shipping policy',{exact:true}).inputValue()==='fp1','reload restores reviewed settings');
  check(!await dialog.getByLabel('I reviewed the card identity, condition, photos and eBay selling terms.').isChecked(),'reload requires fresh confirmation');
  check(await page.evaluate(()=>!JSON.stringify(localStorage).includes('PRIVATE')),'no seller token in local recovery');
  failNext=true;await dialog.getByRole('button',{name:'Check and save review',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'temporary failure'}).waitFor();
  check(await dialog.getByLabel('Shipping policy',{exact:true}).inputValue()==='fp1','request failure preserves selections');
  await dialog.getByRole('button',{name:'Reload saved review',exact:true}).click();await page.waitForFunction(()=>document.querySelector('#ebayListingReview [role=alert]').textContent==='');
  check(await dialog.locator('.ebay-review-result').count()===1,'saved check recovers after failure');
  held=true;await dialog.getByRole('button',{name:'Load current eBay requirements'}).click();for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,20));check(!!release,'provider lookup reached');
  await page.evaluate(()=>googleUser={sub:'another-owner'});held=false;release();release=null;await page.waitForFunction(()=>!document.querySelector('#ebayListingReview'));
  check(!requests.some(r=>['publish','end','reprice'].includes(r.body?.action)),'no marketplace action emitted');
  check(errors.length===0,'no browser errors: '+errors.join('; '));await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
finish(checks,0);
