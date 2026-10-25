import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {createHandler as reviewHandler} from '../api/ebay-listing-review.js';
import {createHandler as connectHandler} from '../api/ebay-connect.js';
import {config,keys,hash,seal} from '../api/_ebaySeller.js';
import {draftKey} from '../api/_draftStore.js';
import {reviewKey} from '../api/_ebaySubmission.js';
import {redisCommand} from './_idRedis.mjs';
import {env,makeDraft,reference,photo,photoHost} from './_ebayReviewFixture.mjs';
import {ROOT} from './_assetRefs.mjs';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('ebay-selling-defaults-browser');let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const kv=(...args)=>redisCommand(args),who='selling-defaults-owner',other='selling-defaults-other',cfg=config(env);
const cards=['a','b','c','d','e','f'].map(x=>makeDraft({instanceId:'inst_defaults_'+x}));
const fullReference=structuredClone(reference);
fullReference.fulfillmentPolicies.push({fulfillmentPolicyId:'fp2',name:'Other flat shipping',marketplaceId:'EBAY_US',shippingOptions:[{costType:'FLAT_RATE'}]},{fulfillmentPolicyId:'calc',name:'Calculated shipping',marketplaceId:'EBAY_US',shippingOptions:[{costType:'CALCULATED'}]},{fulfillmentPolicyId:'foreign',name:'Other marketplace',marketplaceId:'EBAY_GB'});
fullReference.locations.push({merchantLocationKey:'no-address',name:'Missing address',merchantLocationStatus:'ENABLED'},{...structuredClone(reference.locations[0]),merchantLocationKey:'disabled',merchantLocationStatus:'DISABLED'});
fullReference.fulfillmentPolicies.push({name:'Missing policy ID',marketplaceId:'EBAY_US'});
let currentReference=structuredClone(fullReference),failRequirements=false,requests=[],upstream=[];
const connection=(user=who,account='seller-one',version='v1',environment='production')=>({accountHash:hash(account),version,cipher:seal({username:'Fixture seller',accessToken:'PRIVATE-ACCESS',refreshToken:'PRIVATE-REFRESH',accessExpiresAt:Date.now()+3600000,refreshExpiresAt:Date.now()+86400000},cfg,hash(user))});
async function setConnection(user=who,account='seller-one',version='v1'){await kv('SET',keys('production',hash(user)).connection,JSON.stringify(connection(user,account,version)));}
const handler=reviewHandler({env,verify:async token=>({uid:token}),store:kv,photoHost,referenceLoader:async()=>{if(failRequirements){failRequirements=false;throw Object.assign(Error('Fixture current requirements unavailable.'),{status:502});}return structuredClone(currentReference);}});
const seller=connectHandler({env,verify:async token=>({uid:token}),store:kv,fetcher:async(url,options={})=>{
 upstream.push(options.method||'GET');
 if(url.endsWith('/privilege'))return Response.json({sellerRegistrationCompleted:true});
 for(const type of ['fulfillment','payment','return'])if(url.includes('/'+type+'_policy'))return Response.json({[type+'Policies']:currentReference[type+'Policies']});
 if(url.includes('/location?'))return Response.json({locations:currentReference.locations});
 throw Error('Unexpected provider request');
}});
const entry=readFileSync(ROOT+'/index.html','utf8');
const asset=name=>{const path=entry.match(new RegExp('js/'+name+'\\.[a-f0-9]{8}\\.js'))?.[0];if(!path)throw Error('Missing shipped '+name);return readFileSync(ROOT+'/'+path,'utf8');};
const html=entry.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
window.googleUser={sub:${JSON.stringify(who)}};
async function _crIdToken(){return googleUser?.sub}
async function photosList(){return {photos:[{id:'ph_front',name:'Front photo',missing:false}],hosted:{ph_front:${JSON.stringify(photo)}}}}
window.switchView=view=>window.lastView=view;
document.getElementById('collectionView').style.display='block';
${asset('ebay-connect')}
${asset('ebay-listing-review')}
</script>`;
const server=createServer(async(req,res)=>{
 try{
  if(!req.url.startsWith('/api/')){res.setHeader('Content-Type','text/html');res.end(html);return;}
  let body='';for await(const part of req)body+=part;
  const u=new URL(req.url,'http://localhost'),data=body?JSON.parse(body):{};requests.push({path:u.pathname,method:req.method,body:data});
  const request={method:req.method,headers:{...req.headers,origin:env.EBAY_SELLER_ORIGIN},query:Object.fromEntries(u.searchParams),body:data};
  const response={setHeader:(n,v)=>res.setHeader(n,v),status(n){res.statusCode=n;return this;},json(v){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(v));return this;}};
  await (u.pathname==='/api/ebay-connect'?seller:handler)(request,response);
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
mkdirSync('/tmp/cardresell-ebay-defaults-shots',{recursive:true});
try{
 for(const width of [390,1280]){
  for(const user of [who,other]){await setConnection(user);await kv('DEL','ebayreview:rate:'+hash(user));for(const card of cards){await kv('SET',draftKey(user,card.draftId),JSON.stringify(card));await kv('DEL',reviewKey('production',user,card.draftId));}}
  currentReference=structuredClone(fullReference);requests=[];upstream=[];
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
  const dialog=page.locator('#ebayListingReview'),load=()=>dialog.getByRole('button',{name:'Load current eBay requirements',exact:true}).click();
  const close=()=>dialog.getByRole('button',{name:'Close',exact:true}).click();
  const open=async(card)=>{await page.evaluate(id=>CardResellEbayListingReview.open(id),card.draftId);await dialog.getByRole('button',{name:'Load current eBay requirements',exact:true}).waitFor();};
  const loaded=()=>dialog.getByLabel('Card Condition (required)',{exact:true}).waitFor();
  const values=async()=>Promise.all(['Shipping policy','Payment policy','Return policy','Inventory location'].map(label=>dialog.getByLabel(label,{exact:true}).inputValue()));
  const pick=async()=>{for(const [label,value]of [['Shipping policy','fp1'],['Payment policy','pp1'],['Return policy','rp1'],['Inventory location','shelf1']])await dialog.getByLabel(label,{exact:true}).selectOption(value);};
  const save=()=>dialog.getByRole('button',{name:'Save selling defaults',exact:true});
  const result=()=>dialog.locator('.ebay-review-result');
  await open(cards[0]);await load();await loaded();
  check(await save().isDisabled(),'defaults require all four supported settings');
  check(await dialog.getByLabel('Shipping policy',{exact:true}).locator('option').count()===3,'calculated and foreign-market policies are excluded');
  check(await dialog.getByLabel('Inventory location',{exact:true}).locator('option').count()===2,'disabled and addressless locations are excluded');
  await pick();await dialog.getByLabel('Card Condition (required)',{exact:true}).selectOption('400010');await dialog.getByLabel('Use Front photo',{exact:true}).check();
  await dialog.getByLabel('I confirm this physical copy is still available to sell.').check();await dialog.getByLabel('I reviewed the card identity, condition, photos and eBay selling terms.').check();
  await save().click();await dialog.getByText('Selling defaults saved for this browser.',{exact:false}).waitFor();
  const savedPrefs=await page.evaluate(user=>JSON.parse(localStorage.getItem('cr_ebay_terms_v1:'+encodeURIComponent(user))),who);
  check(JSON.stringify(savedPrefs.terms)==='{"fulfillmentPolicyId":"fp1","paymentPolicyId":"pp1","returnPolicyId":"rp1","merchantLocationKey":"shelf1"}','defaults persist only the four chosen seller setting IDs');
  check(!JSON.stringify(savedPrefs).includes('PRIVATE')&&!JSON.stringify(savedPrefs).includes('400010')&&!JSON.stringify(savedPrefs).includes('ph_front')&&!JSON.stringify(savedPrefs).includes('Confirmed'),'no token, condition, photo or approval copied to defaults');
  check(!requests.some(r=>r.body.action==='check'),'saving reusable settings creates no review or marketplace request');
  await dialog.locator('[data-selling-defaults]').scrollIntoViewIfNeeded();await page.screenshot({path:'/tmp/cardresell-ebay-defaults-shots/defaults-'+width+'.png'});
  await dialog.getByRole('button',{name:'Check and save review',exact:true}).click();await result().getByText('Preparation checks passed; publishing is not enabled',{exact:true}).waitFor();
  const stored=JSON.parse(await kv('GET',reviewKey('production',who,cards[0].draftId)));
  check(stored.report.payload.offer.merchantLocationKey==='shelf1'&&stored.report.payload.offer.listingPolicies.fulfillmentPolicyId==='fp1','real saved review uses selected seller policies and location');
  await close();await open(cards[1]);await load();await loaded();
  check((await values()).join('|')==='fp1|pp1|rp1|shelf1','fresh draft reuses current compatible selling defaults');
  check(await dialog.getByLabel('Card Condition (required)',{exact:true}).inputValue()===''&&!await dialog.getByLabel('Use Front photo',{exact:true}).isChecked(),'condition and seller photos remain per physical card');
  check(!await dialog.getByLabel('I confirm this physical copy is still available to sell.').isChecked()&&!await dialog.getByLabel('I reviewed the card identity, condition, photos and eBay selling terms.').isChecked(),'default reuse never carries seller approval');
  await dialog.getByLabel('Shipping policy',{exact:true}).selectOption('fp2');await close();await open(cards[1]);await load();await loaded();
  check((await values())[0]==='fp2','existing draft choice wins over reusable defaults');
  failRequirements=true;await load();await dialog.getByRole('alert').filter({hasText:'current requirements unavailable'}).waitFor();
  check(await dialog.getByRole('button',{name:'Check and save review',exact:true}).isDisabled()&&await dialog.getByLabel('Shipping policy',{exact:true}).count()===0,'failed refresh retracts old requirements and blocks saving');
  check(!(await dialog.getByRole('status').textContent()).includes('Loading'),'failed refresh stops the loading message');
  await load();await loaded();check((await values())[0]==='fp2','successful retry retains current draft choices');
  await dialog.getByRole('button',{name:'Check seller setup',exact:true}).click();
  const setup=page.locator('#ebayConnectDialog');await setup.locator('dl').waitFor();
  check((await setup.getByRole('status').textContent()).includes('Seller setup checked'),'draft recovery action directly runs the actual seller setup handler');
  check((await setup.locator('dd').allTextContents()).at(-1)==='1','seller setup counts only enabled locations with usable addresses');
  check(await setup.locator('[data-primary]').textContent()==='Check seller setup','healthy linked account prioritizes setup over reconnect');
  await setup.getByRole('button',{name:'Close',exact:true}).click();
  check((await values())[0]==='fp2'&&await dialog.getByRole('button',{name:'Check seller setup',exact:true}).evaluate(b=>document.activeElement===b),'setup returns focus and preserves the current draft');
  await close();currentReference.fulfillmentPolicies=[];currentReference.locations=[];
  await open(cards[2]);await load();await loaded();
  check((await values()).every(v=>v==='')&&(await dialog.textContent()).includes('no longer available or supported'),'obsolete defaults cannot silently select a different policy or partially fill');
  check(await dialog.getByRole('link',{name:'Review eBay Business Policies'}).count()===1&&await dialog.getByRole('link',{name:'Inventory location setup guidance'}).count()===1,'empty settings provide official next actions');
  check(await save().isDisabled(),'incomplete settings cannot replace working defaults');
  await dialog.getByRole('button',{name:'Check seller setup',exact:true}).click();await setup.locator('dl').waitFor();
  check((await setup.locator('[data-seller-next-steps]').textContent()).includes('Create US shipping')&&(await setup.locator('[data-seller-next-steps]').textContent()).includes('dispatch address'),'setup identifies missing policies and location separately');
  await setup.getByRole('button',{name:'Close',exact:true}).click();await close();currentReference=structuredClone(fullReference);
  await setConnection(who,'seller-one','same-seller-reconnected');await open(cards[3]);await load();await loaded();
  check((await values()).join('|')==='fp1|pp1|rp1|shelf1','same seller reconnect can reuse defaults after current settings are checked');
  await close();await open(cards[4]);await setConnection(who,'seller-two','other-seller');await load();
  await dialog.getByRole('alert').filter({hasText:'connection changed'}).waitFor();check(await dialog.getByRole('button',{name:'Check and save review',exact:true}).isDisabled(),'seller change during an open review cannot apply old defaults');
  await close();await open(cards[4]);await load();await loaded();check((await values()).every(v=>v===''),'different eBay seller cannot inherit same-named setting IDs');
  check(await dialog.getByRole('button',{name:'Use saved defaults',exact:true}).count()===0,'other seller cannot see or apply original seller defaults');
  await close();await setConnection();await page.evaluate(user=>{googleUser={sub:user};},other);await open(cards[4]);await load();await loaded();
  check((await values()).every(v=>v===''),'different CardResell account cannot inherit defaults');await close();await page.evaluate(user=>{googleUser={sub:user};},who);
  await open(cards[5]);await load();await loaded();await dialog.getByLabel('Shipping policy',{exact:true}).selectOption('fp2');
  await page.evaluate(()=>{window.normalSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k.startsWith('cr_ebay_terms_v1:'))throw Error('quota');return window.normalSetItem.call(this,k,v);};});
  await save().click();await dialog.getByRole('alert').filter({hasText:'could not save selling defaults'}).waitFor();
  check((await values())[0]==='fp2','storage failure preserves current draft choice');
  check((await page.evaluate(user=>JSON.parse(localStorage.getItem('cr_ebay_terms_v1:'+encodeURIComponent(user))).terms.fulfillmentPolicyId,who))==='fp1','failed save cannot claim new defaults were stored');
  await page.evaluate(()=>Storage.prototype.setItem=window.normalSetItem);await dialog.getByRole('button',{name:'Forget saved defaults',exact:true}).click();
  await dialog.getByText('Saved defaults removed.',{exact:false}).waitFor();check((await values())[0]==='fp2','forgetting defaults preserves current draft settings');
  check(await page.evaluate(user=>localStorage.getItem('cr_ebay_terms_v1:'+encodeURIComponent(user))===null,who),'forget removes the saved preference');
  check(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().width<=innerWidth),'new controls fit '+width+'px');
  check(requests.every(r=>r.path==='/api/ebay-connect'||['requirements','check',undefined].includes(r.body.action))&&upstream.every(method=>method==='GET'),'workflow creates no live listing, policy, location or sale');
  check(errors.length===0,'no browser errors: '+errors.join('; '));await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
finish(checks,0);
