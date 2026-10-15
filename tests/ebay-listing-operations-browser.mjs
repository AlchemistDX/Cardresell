import {readFileSync,mkdirSync} from 'node:fs';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {fixture,kv,env,reference,photo,photoHost} from './_ebayOperationFixture.mjs';
import {createHandler as reviewHandler} from '../api/ebay-listing-review.js';
import {createHandler as operationsHandler} from '../api/ebay-listing-operations.js';
import {saveListingScript} from '../api/_ebayOperations.js';
import {ROOT} from './_assetRefs.mjs';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('ebay-listing-operations-browser');let checks=0;
const check=(v,m)=>{assert.ok(v,m);checks++;};
const f=await fixture('browser-operations'),requests=[];let loseSave=false,hold=false,release=null;
const store=async(...args)=>{const out=await kv(...args);if(loseSave&&args[0]==='EVAL'&&args[1]===saveListingScript){loseSave=false;throw Error('lost acknowledgement');}if(hold&&args[0]==='SMEMBERS'){hold=false;await new Promise(r=>release=r);}return out;};
const handler=operationsHandler({env,verify:async token=>({uid:token}),store,fetcher:f.fetcher,photoHost,referenceLoader:async()=>reference});
const rh=reviewHandler({env,verify:async token=>({uid:token}),store:kv,photoHost,referenceLoader:async()=>reference});
const modules=['ebay-listing-review','ebay-listing-operations'].map(n=>readFileSync(ROOT+'/js/'+n+'.js','utf8')).join('\n');
const html=readFileSync(ROOT+'/index.html','utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
window.googleUser={sub:${JSON.stringify(f.uid)}};
let _reviewState={draft:${JSON.stringify(f.draft)},loading:false,gone:false};
async function _crIdToken(){return googleUser?.sub}
async function photosList(){return {photos:[{id:'ph_front',name:'Front photo'}],hosted:{ph_front:${JSON.stringify(photo)}}}}
document.getElementById('draftsView').style.display='block';document.getElementById('reviewView').style.display='block';document.getElementById('reviewWrap').innerHTML='<section id="review-ebay-step"></section>';
${modules}
</script>`;
const server=createServer(async(req,res)=>{
 try {
  if(!req.url.startsWith('/api/')){res.setHeader('Content-Type','text/html');res.end(html);return;}
  let text='';for await(const chunk of req)text+=chunk;const body=text?JSON.parse(text):{},u=new URL(req.url,'http://localhost');requests.push({method:req.method,action:body.action});
  const request={method:req.method,headers:{...req.headers,origin:env.EBAY_SELLER_ORIGIN},query:Object.fromEntries(u.searchParams),body};
  const response={setHeader:(k,v)=>res.setHeader(k,v),status(n){res.statusCode=n;return this;},json(data){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));return this;}};
  await (u.pathname==='/api/ebay-listing-review'?rh:handler)(request,response);
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:e.message}));}
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});mkdirSync('/tmp/cardresell-ebay-operations-shots',{recursive:true});
try {
 for(const width of [390,1280]) {
  await f.reset();requests.length=0;const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
  const launch=page.getByRole('button',{name:'eBay listing operations',exact:true}),dialog=page.locator('#ebayListingOperations');await launch.click();
  await dialog.getByText(/No saved eBay listing operations\./).waitFor();check(!f.state.writes.length,'global recovery does not send listing requests');
  check((await dialog.textContent()).includes('awaiting setup'),'production gate is truthful in UI');await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.getByRole('button',{name:'Check direct eBay readiness',exact:true}).click();await page.locator('#ebayListingReview').getByRole('button',{name:'Listing plan and recovery'}).click();
  const save=dialog.getByRole('button',{name:'Save listing plan',exact:true});await save.waitFor();check(await save.isDisabled(),'saving a reservation requires separate confirmation');
  await dialog.getByLabel('Reserve this physical copy for the reviewed eBay listing.').check();loseSave=true;await save.click();
  await dialog.getByRole('alert').filter({hasText:'Reload its saved status'}).waitFor();check(JSON.parse(await kv('GET',f.key)).state==='planned','lost browser save acknowledgement still leaves durable plan');
  await dialog.getByRole('button',{name:'Reload saved status',exact:true}).click();await dialog.getByText('Plan saved · not sent',{exact:true}).waitFor();
  check(!await dialog.getByRole('button',{name:'Save listing plan',exact:true}).count(),'reload restores reservation instead of inviting duplicate');
  const cancel=dialog.getByRole('button',{name:'Cancel unsent plan',exact:true});check(await cancel.isDisabled(),'cancel requires fresh explicit confirmation');
  await dialog.getByLabel('Cancel this unsent plan and release its reservation.').check();await cancel.click();await dialog.getByText('Unsent plan cancelled',{exact:true}).waitFor();
  check(JSON.parse(await kv('GET',f.key)).state==='cancelled','browser cancellation updates actual Redis reservation');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await f.call('plan');
  f.state.after=async()=>{throw Error('lost provider response');};await f.call('prepare');f.state.after=null;
  await page.reload();await launch.click();await dialog.getByText('Request outcome uncertain',{exact:true}).waitFor();
  check(!await dialog.getByRole('button',{name:'Cancel unsent plan',exact:true}).count(),'uncertain request cannot be cancelled through UI');
  check(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().width<=innerWidth),'recovery dialog fits '+width+'px');
  await page.screenshot({path:'/tmp/cardresell-ebay-operations-shots/operations-'+width+'.png'});
  const writes=f.state.writes.length;await dialog.getByRole('button',{name:'Recover status',exact:true}).click();await dialog.getByText('Inventory confirmed · offer not created',{exact:true}).waitFor();
  check(f.state.writes.length===writes,'browser recovery only reads provider');
  check(!await dialog.getByRole('button',{name:/Publish|Prepare eBay offer|Change price|End listing/}).count(),'live write controls are unavailable');
  check(await page.evaluate(()=>!JSON.stringify(localStorage).includes('PRIVATE')),'no token or provider journal in browser storage');
  hold=true;await dialog.getByRole('button',{name:'Reload saved status',exact:true}).click();for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,10));check(!!release,'held request reached server');
  await page.evaluate(()=>googleUser={sub:'different-owner'});release();release=null;await page.waitForFunction(()=>!document.querySelector('#ebayListingOperations'));
  check(!requests.some(r=>['prepare','publish','price','end'].includes(r.action)),'browser emits no live mutation intent');
  check(!errors.length,'browser errors: '+errors.join('; '));await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
finish(checks,0);
