import {readFileSync} from 'node:fs';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {ROOT} from './_assetRefs.mjs';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('ebay-connect-browser');let checks=0;
const check=(ok,message)=>{assert.ok(ok,message);checks++;};
const html=readFileSync(ROOT+'/index.html','utf8'),module=readFileSync(ROOT+'/js/ebay-connect.js','utf8');
const fixture=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'')+`<script>
window.googleUser={sub:'owner'};let available=new URL(location.href).searchParams.has('ebay_connection'),connected=false,pending=false,fail=false,held=false,calls=[],signin=0;
async function _crIdToken(){return 'fixture-'+window.googleUser.sub}
function triggerGoogleSignIn(){signin++}
window.fetch=async(url,opts)=>{const action=new URL(url,location.href).searchParams.get('action');calls.push({action,method:opts.method});if(fail)return Response.json({error:'Fixture connection unavailable.'},{status:503});if(action==='status'){if(held)await new Promise(r=>window.releaseStatus=r);return Response.json({available,connected,username:'Seller <b>name</b>',environment:'production',publishingEnabled:false,...(pending?{pending:{username:'Seller <b>name</b>',expiresAt:Date.now()+600000}}:{})});}if(action==='confirm'){connected=true;pending=false;return Response.json({ok:true,connected:true})}if(action==='disconnect'){connected=false;return Response.json({ok:true,connected:false})}if(action==='start')return Response.json({url:'https://not-ebay.example/oauth2/authorize'});if(action==='readiness')return Response.json({sellerRegistered:true,fulfillmentPolicies:2,paymentPolicies:null,returnPolicies:0,inventoryLocations:1,partial:true,publishingEnabled:false});throw Error('unexpected action')};
document.getElementById('collectionView').style.display='block';
${module}
</script>`;
const server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(fixture)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
try {
 for(const width of [390,1280]) {
  const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',r=>r.request().url().startsWith('http://127.0.0.1')?r.continue():r.abort());await page.goto('http://127.0.0.1:'+server.address().port);
  await page.waitForFunction(()=>calls.length===1);check(await page.locator('#ebayConnectionBtn').isHidden(),'unconfigured connection stays out of customer workflow');
  await page.evaluate(async()=>{available=true;await CardResellEbayConnect.mount(true)});await page.locator('#ebayConnectionBtn').click();
  const dialog=page.locator('#ebayConnectDialog');await dialog.getByRole('button',{name:'Continue to eBay',exact:true}).waitFor();
  check((await dialog.textContent()).includes('read-only')&&(await dialog.textContent()).includes('not enabled'),'scope and publishing status stated clearly');
  await dialog.getByRole('button',{name:'Continue to eBay',exact:true}).click();await page.waitForFunction(()=>[...document.querySelectorAll('#ebayConnectDialog [role=alert]')].some(n=>n.textContent.includes('link could not be confirmed')));
  check(page.url().startsWith('http://127.0.0.1'),'untrusted redirect cannot leave app');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>pending=true);await page.locator('#ebayConnectionBtn').click();await dialog.getByRole('button',{name:'Confirm eBay connection',exact:true}).waitFor();
  check(await dialog.locator('b').count()===0,'seller identity is text, never HTML');
  check(await page.evaluate(()=>!connected&&calls.filter(c=>c.action==='confirm').length===0),'pending authorization waits for user confirmation');
  await dialog.getByRole('button',{name:'Confirm eBay connection',exact:true}).click();await dialog.getByRole('button',{name:'Check seller setup',exact:true}).waitFor();
  await dialog.getByRole('button',{name:'Check seller setup',exact:true}).click();await dialog.locator('dl').waitFor();
  check((await dialog.locator('dd').allTextContents()).join('|')==='Complete|2|Could not check|0|1','partial checks distinguish unknown from missing');
  check((await dialog.getByRole('status').textContent()).includes('account is connected'),'partial setup cannot look like failed authorization');
  check((await dialog.getByRole('link',{name:'Open eBay Business Policies'}).getAttribute('href')).startsWith('https://www.ebay.com/help/'),'policy setup has an official recovery path');
  check(await dialog.evaluate(d=>d.scrollWidth<=d.clientWidth+1&&d.getBoundingClientRect().width<=innerWidth),'seller dialog fits '+width+'px');
  check(await dialog.evaluate(d=>Math.abs(d.getBoundingClientRect().left-(innerWidth-d.getBoundingClientRect().width)/2)<2),'seller dialog stays centered at '+width+'px');
  await dialog.getByRole('button',{name:'Disconnect eBay',exact:true}).click();check(await page.evaluate(()=>connected),'disconnect awaits explicit confirmation');
  await dialog.getByRole('button',{name:'Keep connection',exact:true}).click();await dialog.getByRole('button',{name:'Disconnect eBay',exact:true}).click();await dialog.getByRole('button',{name:'Confirm disconnect',exact:true}).click();await dialog.getByRole('button',{name:'Continue to eBay',exact:true}).waitFor();check(await page.evaluate(()=>!connected),'confirmed disconnect updates state');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.evaluate(()=>fail=true);await page.locator('#ebayConnectionBtn').click();await dialog.getByRole('button',{name:'Retry',exact:true}).waitFor();
  check((await dialog.locator('[role=alert]').allTextContents()).join(' ').includes('unavailable'),'network failure is actionable');
  await page.evaluate(()=>fail=false);await dialog.getByRole('button',{name:'Retry',exact:true}).click();await dialog.getByRole('button',{name:'Continue to eBay',exact:true}).waitFor();await dialog.getByRole('button',{name:'Close',exact:true}).click();
  await page.evaluate(()=>held=true);await page.locator('#ebayConnectionBtn').click();await page.waitForFunction(()=>!!window.releaseStatus);await page.evaluate(()=>{googleUser={sub:'other'};held=false;releaseStatus()});await page.waitForFunction(()=>!document.querySelector('#ebayConnectDialog'));
  check(await page.evaluate(()=>calls.filter(c=>c.action==='confirm').length===1),'account switch cannot auto-confirm another seller');
  await page.evaluate(async()=>{googleUser=null;await CardResellEbayConnect.open()});await dialog.getByRole('button',{name:'Sign in',exact:true}).click();check(await page.evaluate(()=>signin===1),'callback without app session offers sign-in');
  // Reproduce the actual browser return: the outcome must survive status and
  // button refreshes, with credentials absent from both the UI and address bar.
  for(const [outcome,fragment] of [['error','could not be completed'],['expired','expired'],['denied','declined'],['unavailable','not available yet'],['review','no longer available']]) {
   await page.goto('http://127.0.0.1:'+server.address().port+'/?keep=1&ebay_connection='+outcome+'#collection');
   await dialog.getByRole('button',{name:'Continue to eBay',exact:true}).waitFor();
   check((await dialog.locator('[data-oauth-outcome]').textContent()).includes(fragment),outcome+' remains visible after status refresh at '+width+'px');
   check(page.url().endsWith('/?keep=1#collection'),'callback parameters removed without losing the app route');
  }
  for(const [issue,fragment] of [['state','could not check'],['token','could not finish'],['identity','verify your seller account'],['storage','could not save'],['application','application settings']]) {
   await page.goto('http://127.0.0.1:'+server.address().port+'/?ebay_connection=error&ebay_issue='+issue+'&ebay_ref=abcdef123456');
   await dialog.getByRole('button',{name:'Continue to eBay',exact:true}).waitFor();
   check((await dialog.locator('[data-oauth-outcome]').textContent()).includes(fragment),'specific '+issue+' failure is visible');
   check((await dialog.locator('[data-oauth-reference]').textContent()).includes('abcdef123456'),'support reference survives refresh');
   check(!page.url().includes('ebay_'),'diagnostic parameters removed from address bar');
  }
  await page.goto('http://127.0.0.1:'+server.address().port+'/?ebay_connection=error&ebay_issue=PRIVATE-TOKEN&ebay_ref=PRIVATE-CODE');
  await dialog.getByRole('button',{name:'Continue to eBay',exact:true}).waitFor();
  check(!(await dialog.textContent()).includes('PRIVATE')&&(await dialog.locator('[data-oauth-outcome]').textContent()).includes('could not be completed'),'unexpected diagnostic values are never reflected');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'detached'});
  await page.evaluate(async()=>{fail=true;await CardResellEbayConnect.open('error',{issue:'identity',reference:'abcdef123456'})});
  await dialog.getByRole('button',{name:'Retry',exact:true}).waitFor();
  check((await dialog.locator('[data-oauth-outcome]').textContent()).includes('verify your seller account'),'status error does not erase the callback failure');
  await page.evaluate(()=>fail=false);await dialog.getByRole('button',{name:'Retry',exact:true}).click();
  await dialog.getByRole('button',{name:'Continue to eBay',exact:true}).waitFor();
  check((await dialog.locator('[data-oauth-outcome]').textContent()).includes('verify your seller account'),'retrying status preserves the original failure');
  await dialog.getByRole('button',{name:'Close',exact:true}).click();await dialog.waitFor({state:'detached'});
  await page.evaluate(async()=>{pending=true;await CardResellEbayConnect.open('review')});
  await dialog.getByRole('button',{name:'Confirm eBay connection',exact:true}).click();
  await dialog.getByRole('button',{name:'Check seller setup',exact:true}).waitFor();
  check(await dialog.locator('[data-oauth-outcome]').textContent()==='','successful confirmation does not show an expired approval warning');
  check(errors.length===0,'no browser errors: '+errors.join('; '));await page.close();
 }
} finally {await browser.close();await new Promise(r=>server.close(r));}
finish(checks,0);
