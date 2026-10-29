// Full shipped workspace and Firebase adapter, with controlled SDK/API edges.
// No real sign-ins, credits, customer records or external services.
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('auth-session-workflow-browser');
import {readFileSync,existsSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {createServer} from 'node:http';
import {chromium} from 'playwright';
import {publicMembershipCatalogue} from '../api/_membershipPurchaseRoutes.js';
const root=resolve(new URL('../',import.meta.url).pathname);
const server=createServer((req,res)=>{
 const pathname=new URL(req.url,'http://local').pathname;
 const file=resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+'/')||!existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',({'.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json'})[extname(file)]||'application/octet-stream');res.end(readFileSync(file));
});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const sdk=`
export const initializeAuth=()=>window.fixtureAuth;
export function onAuthStateChanged(auth,fn){window.fixtureListener=fn;queueMicrotask(()=>fn(auth.currentUser));}
export const signOut=async()=>window.emitFixtureUser(null);
export class GoogleAuthProvider {setCustomParameters(){}}
export const signInWithPopup=async()=>{},createUserWithEmailAndPassword=async()=>{},signInWithEmailAndPassword=async()=>{},sendPasswordResetEmail=async()=>{},sendEmailVerification=async()=>{};
export const indexedDBLocalPersistence={},browserLocalPersistence={},browserSessionPersistence={},browserPopupRedirectResolver={};
`;
const browser=await chromium.launch({executablePath:process.env.CR_CHROMIUM,args:['--no-sandbox']});
let passed=0;const failures=[];
const check=(ok,label)=>{if(ok)passed++;else failures.push(label);};
try{
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];let releaseClaim=null,holdClaim=false;
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   const req=route.request(),url=new URL(req.url());
   if(url.hostname==='www.gstatic.com'&&url.pathname.endsWith('/firebase-app.js'))return route.fulfill({contentType:'text/javascript',body:'export const initializeApp=()=>({});'});
   if(url.hostname==='www.gstatic.com'&&url.pathname.endsWith('/firebase-auth.js'))return route.fulfill({contentType:'text/javascript',body:sdk});
   if(url.origin!==origin)return route.fulfill({status:204,body:''});
   if(!url.pathname.startsWith('/api/'))return route.continue();
   if(url.pathname==='/api/membership-catalogue')return route.fulfill({json:{...publicMembershipCatalogue(),purchaseEnabled:false}});
   if(url.pathname==='/api/pro-status'){
    const uid=(req.headers().authorization||'').replace('Bearer local-','');
    if(!uid)return route.fulfill({status:401,json:{error:'authentication_required'}});
    return route.fulfill({json:{billing_version:'launch-v2',capabilities:{venueTier:uid==='alice'?'pro_max':'free'},isPro:uid==='alice',tier:uid==='alice'?'business':'free',emailVerified:!uid.startsWith('unverified'),paidScansLeft:uid==='alice'?71:7,idPaidLeft:uid==='alice'?123:9,idFreeLeft:0,freeScansLeft:0}});
   }
   if(url.pathname==='/api/verify-claim-firebase'){
    if(holdClaim)await new Promise(r=>releaseClaim=r);
    return route.fulfill({json:{ok:true,bonusGranted:true}});
   }
   return route.fulfill({status:503,json:{error:'offline_fixture'}});
  });
  await page.addInitScript(()=>{
   localStorage.setItem('cs_landing_seen','1');window.fixtureAuth={currentUser:null};window.fixtureUsers={};window.fixtureWaiters={};window.authRequests=[];window.authIntervals=new Map();let intervalId=0;
   const originalSet=setInterval,originalClear=clearInterval;
   window.setInterval=(fn,ms,...args)=>{if(ms===5000||ms===3300000){const id=--intervalId;authIntervals.set(id,{fn,ms});return id;}return originalSet(fn,ms,...args);};
   window.clearInterval=id=>{if(id<0)authIntervals.delete(id);else originalClear(id);};
   window.makeFixtureUser=(uid,verified=true)=>fixtureUsers[uid]||(fixtureUsers[uid]={uid,email:uid+'@example.invalid',displayName:uid,emailVerified:verified,providerData:[{providerId:'password'}],pending:false,
    reload:async()=>{},getIdToken:async function(){if(this.pending)return new Promise(r=>(fixtureWaiters[uid]||=[]).push(r));return 'local-'+uid;}});
   window.emitFixtureUser=user=>{fixtureAuth.currentUser=user;return fixtureListener(user);};
   window.releaseFixtureToken=uid=>{fixtureUsers[uid].pending=false;for(const resolve of fixtureWaiters[uid]||[])resolve('local-'+uid);fixtureWaiters[uid]=[];};
   const originalFetch=fetch;
   window.fetch=(url,opts)=>{authRequests.push({url:String(url),owner:window.googleUser?.uid||null,token:new Headers(opts?.headers).get('Authorization')});return originalFetch(url,opts);};
  });
  await page.goto(origin+'/index.html');await page.waitForFunction(()=>typeof fixtureListener==='function'&&typeof checkProStatus==='function');await page.waitForTimeout(550);
  await page.evaluate(()=>emitFixtureUser(makeFixtureUser('alice')));
  await page.waitForFunction(()=>_idScanCredits===123&&_googleIdToken==='local-alice');
  check((await page.locator('#googleName').textContent())==='alice','signed-in identity renders at '+width);
  check((await page.locator('#idScanSubCredits').textContent()).includes('123'),'first account credits render at '+width);
  const membershipRefresh=await page.evaluate(async()=>{
   const card={name:'Mew',setName:'Fixture set',number:'1',game:'pokemon',priceVariants:[{key:'normal',label:'Normal',market:10}]};
   setSelectedCard(card);loadCardUI(card);
   window._isPro=false;window._userTier='free';window._membershipVenueAccess=null;calc();
   const before=document.getElementById('resultsArea').innerText;
   const requestsBefore=authRequests.length;
   await checkProStatus();
   return {before,after:document.getElementById('resultsArea').innerText,requests:authRequests.slice(requestsBefore).map(r=>r.url)};
  });
  check(/best free payout/i.test(membershipRefresh.before),'fixture begins with free payout at '+width);
  check(!/best free payout/i.test(membershipRefresh.after),'resolved paid membership refreshes existing payout at '+width);
  check(!membershipRefresh.requests.some(url=>/tcg-price|pricecharting|ebay-sold|identify/.test(url)),'membership refresh does not refetch prices or scan at '+width);
  const downgradeRefresh=await page.evaluate(async()=>{
   const original=window.fetch;
   window.fetch=(url,opts)=>String(url).startsWith('/api/pro-status')
    ?Promise.resolve({ok:true,status:200,json:async()=>({isPro:false,tier:'free',billing_version:'launch-v2',capabilities:{venueTier:'free'}})})
    :original(url,opts);
   try {await checkProStatus();return document.getElementById('resultsArea').innerText;}
   finally {window.fetch=original;await checkProStatus();}
  });
  check(/best free payout/i.test(downgradeRefresh),'server-confirmed downgrade refreshes existing payout at '+width);
  await page.evaluate(()=>{savePortData([{id:'fixture-card-a',card:'Alice private card',game:'pokemon',currentValue:2,buyPrice:1}]);switchView('collection');});
  check((await page.locator('#collectionWrap').innerText()).includes('Alice private card'),'first account collection is visible at '+width);
  await page.evaluate(()=>{const b=makeFixtureUser('bob');b.pending=true;return emitFixtureUser(b);});
  check(await page.evaluate(()=>googleUser.uid==='bob'&&!_googleIdToken),'new account appears without old bearer at '+width);
  check(!(await page.locator('#idScanSubCredits').textContent()).includes('123'),'old scan balance is cleared during new sign-in at '+width);
  check(!(await page.locator('#collectionWrap').innerText()).includes('Alice private card'),'old collection leaves the workspace at '+width);
  check(await page.evaluate(()=>!authRequests.some(r=>r.owner==='bob'&&r.token==='Bearer local-alice')),'new account sends no request with old bearer at '+width);
  await page.evaluate(()=>releaseFixtureToken('bob'));
  await page.waitForFunction(()=>_googleIdToken==='local-bob'&&_idScanCredits===9);
  check((await page.locator('#idScanSubCredits').textContent()).includes('9'),'new account gets its own balance at '+width);
  await page.evaluate(()=>emitFixtureUser(null));
  check(await page.evaluate(()=>!googleUser&&!_fbCurrentUser&&!_googleIdToken&&!_emailVerified),'SDK sign-out clears identity without local sign-out intent at '+width);
  check(await page.locator('#googleSignInBtn').isVisible(),'sign-in control returns after SDK sign-out at '+width);
  check(!(await page.locator('#collectionWrap').innerText()).includes('Alice private card'),'signed-out page contains no previous seller card at '+width);
  check(await page.evaluate(()=>JSON.parse(localStorage.getItem('cardsell_alice_portfolio')).length===1),'sign-out preserves account-scoped stored inventory at '+width);

  await page.evaluate(()=>emitFixtureUser(makeFixtureUser('alice')));await page.waitForFunction(()=>_googleIdToken==='local-alice');
  await page.evaluate(()=>{fixtureUsers.alice.pending=true;authIntervals.get(_tokenRefreshInterval).fn();});
  await page.waitForFunction(()=>fixtureWaiters.alice?.length>0);
  await page.evaluate(()=>emitFixtureUser(makeFixtureUser('bob')));await page.waitForFunction(()=>_googleIdToken==='local-bob');
  await page.evaluate(()=>releaseFixtureToken('alice'));await page.waitForTimeout(50);
  check(await page.evaluate(()=>_googleIdToken==='local-bob'),'late recurring refresh cannot replace new token at '+width);

  await page.evaluate(()=>emitFixtureUser(makeFixtureUser('alice')));await page.waitForFunction(()=>_googleIdToken==='local-alice');
  holdClaim=true;
  await page.evaluate(()=>{openAuthModal('signin');showAuthView('verify');window._tsGetToken=()=> 'local-security-proof';});
  await page.locator('#authVerifyCheckBtn').click();
  for(let n=0;n<100&&!releaseClaim;n++)await page.waitForTimeout(20);
  check(!!releaseClaim,'verification request is actually in flight at '+width+': '+await page.locator('#authVerifyError').textContent());
  await page.evaluate(()=>emitFixtureUser(makeFixtureUser('unverified-bob',false)));await page.waitForFunction(()=>_googleIdToken==='local-unverified-bob');
  await page.evaluate(()=>{openAuthModal('signin');showAuthView('verify');window._tsGetToken=()=> 'local-security-proof';});
  holdClaim=false;releaseClaim?.();await page.waitForTimeout(1100);
  check(await page.evaluate(()=>!googleUser.emailVerified&&!_emailVerified),'old verification reply cannot verify the new account at '+width);
  check((await page.locator('#authVerifySuccess').textContent())==='','old verification success is not shown to new account at '+width);
  check(await page.locator('#authVerifyCheckBtn').isVisible()&&await page.locator('#authVerifyCheckBtn').isEnabled(),'new verification view stays open and usable at '+width);
  check(await page.evaluate(()=>!authRequests.some(r=>r.owner==='unverified-bob'&&r.token==='Bearer local-alice')),'verification handoff sends no wrong-account request at '+width);
  check(errors.length===0,'no uncaught browser errors at '+width+': '+errors.join('; '));
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'workspace fits viewport at '+width);
  await page.close();
 }
}finally{await browser.close();await new Promise(r=>server.close(r));}
for(const failure of failures)console.error('FAIL:',failure);
finish(passed,failures.length);
