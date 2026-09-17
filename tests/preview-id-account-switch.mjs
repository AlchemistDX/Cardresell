// LOCAL ONLY. Awaited real temporary SDK bridge, actual strict verifier/handler,
// synthetic SDK/JWKS and private Redis; no managed sign-in, bind or acceptance.
import {generateKeyPairSync,sign,webcrypto} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {harness} from './_assert.mjs';
import {redisStore,redisRest} from './_idRedis.mjs';
import route from '../api/preview-id-authenticated-acceptance.js';
import pro from '../api/pro-status.js';
import {stage2WorkerSource} from '../api/preview-id-authenticated-worker.js';
import * as stage from '../api/_previewIdStage2.js';
import * as loss from '../api/_previewIdStage2Loss.js';
const {check,done}=harness('preview-id-account-switch');
globalThis.crypto ||= webcrypto;
Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:stage.STAGE2_BRANCH,
 VERCEL_URL:'switch-offline.vercel.app',KV_REST_API_URL:'https://switch-offline.upstash.io',KV_REST_API_TOKEN:'synthetic-only'});
const origin='https://'+stage.STAGE2_STABLE_HOST,store=redisStore(),commands=[],blocked=[];
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'switch-offline'};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
const user=(letter)=>({uid:'dedicated-'+letter,email:letter+'@example.test',displayName:'Not the email '+letter,
 emailVerified:true,isAnonymous:false,providerData:[{providerId:'google.com'}]});
const A=user('a'),B=user('b');
const token=u=>{const raw=enc({alg:'RS256',kid:jwk.kid})+'.'+enc({sub:u.uid,email:u.email,email_verified:true,
 firebase:{sign_in_provider:'google.com'},aud:'cardresell-e0329',iss:'https://securetoken.google.com/cardresell-e0329',iat:now,exp:now+3600});
 return raw+'.'+sign('RSA-SHA256',Buffer.from(raw),privateKey).toString('base64url')};
const tokenA=token(A),tokenB=token(B),oldFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 if(String(input)===process.env.KV_REST_API_URL)return redisRest(input,init,commands);
 if(String(input)==='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')return Response.json({keys:[jwk]});
 blocked.push('server_network_blocked');throw Error('offline_only');
};
async function invoke(handler,request){
 const res={statusCode:200,headers:{},payload:null,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},
  json(p){this.payload=p;return this},send(p){this.payload=p;return this}};
 await handler(request,res);return res;
}
const snapshot=()=>JSON.stringify(store.keys().sort().map(k=>[k,store.get(k)]));
try{
 check('new execution deadline is September21 8PM EDT',stage.STAGE2_END===Date.parse('2026-09-22T00:00:00Z'));
 check('recovery deadline unchanged',stage.STAGE2_RECOVERY_END===Date.parse('2026-09-23T18:00:00Z'));
 check('worker config derives new exact execution deadline',stage2WorkerSource().includes('"end":'+stage.STAGE2_END));
 const fixtures=[1,2,3,4].map(n=>({receipt:String(n).repeat(64),scan:String(n+4).repeat(64)}));
 const prior={version:1,namespace:'a'.repeat(64),owner:A.uid,stamp:'2026_09',state:'active',phase:2,step:'ready',
  expires:stage.STAGE2_PREVIOUS_END,fixtures,confirmation:{confirmation_id:fixtures[2].receipt,
   scan_id:fixtures[2].scan,candidate_set:'b'.repeat(64),confirmation_expires_at:stage.STAGE2_PREVIOUS_END}};
 check('existing setup expiry remains a valid historical control',stage.validateStage2(prior)===prior);
 const oldLoss={version:1,owner:A.uid,stage:'claimed',disarmed:false,clientId:'old-client',
  receipt:fixtures[2].receipt,scan:fixtures[2].scan,candidateSet:'b'.repeat(64),expires:stage.STAGE2_PREVIOUS_END,
  requestHash:'c'.repeat(64),commitCorroborated:false,retryCorroborated:false,category:'none'};
 store.set(stage.STAGE2_CONTROL,JSON.stringify(prior));store.set(loss.STAGE2_LOSS_CONTROL,JSON.stringify(oldLoss));
 const historical=snapshot();
 check('consumed historical loss guard remains readable',(await loss.stage2LossStatus(prior)).durableClaimConsumed);
 let refused=false;try{await loss.stage2LossAction(prior,'loss-arm',{action:'loss-arm',clientId:'new-client'})}catch(_){refused=true}
 check('extension cannot rearm/reset prior consumed loss guard',refused&&snapshot()===historical);
 for(const value of [0,stage.STAGE2_END+1,Date.parse('2026-09-20T00:00:00Z')])
  check('unrecognized historical expiry remains rejected '+value,!stage.stage2KnownExpiry(value));
 // Reset only the private test fixture; browser path below has zero mutations.
 store.delete(stage.STAGE2_CONTROL);store.delete(loss.STAGE2_LOSS_CONTROL);commands.length=0;
 const before=snapshot(),root=resolve(new URL('..',import.meta.url).pathname);
 const {chromium,devices}=(await import('/home/user/node_modules/playwright/index.js')).default;
 const browser=await chromium.launch(),ctx=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 let holdPreflight=false,heldReply=null,bootstrapReads=0,authFrameReads=0;
 await ctx.route('**/*',async r=>{
  const req=r.request(),u=new URL(req.url());
  // Exact CSP plumbing probes are fulfilled locally, not fetched from Google.
  if(u.href==='https://apis.google.com/js/api.js'){
   bootstrapReads++;return r.fulfill({contentType:'application/javascript',body:'window.__localBootstrapLoaded=true;'});
  }
  if(u.origin==='https://cardresell-e0329.firebaseapp.com'&&u.pathname==='/__/auth/iframe'){
   authFrameReads++;return r.fulfill({contentType:'text/html',body:'<p>Local auth iframe fixture</p>'});
  }
  if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-app.js'))return r.fulfill({contentType:'application/javascript',body:'export const initializeApp=()=>({});'});
  if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-auth.js'))return r.fulfill({contentType:'application/javascript',body:`
   const auth={currentUser:null};let cb=()=>{};
   const make=(u,t)=>({...u,getIdToken:async()=>t,reload:async()=>{}});
   auth.currentUser=make(${JSON.stringify(A)},${JSON.stringify(tokenA)});
   window.__switchFixture={mode:'delay',popupCalls:0,signOutCalls:0,prompt:null,
    next:${JSON.stringify(B)},token:${JSON.stringify(tokenB)},auth};
   export const initializeAuth=()=>auth,onAuthStateChanged=(a,f)=>{cb=f;setTimeout(()=>cb(auth.currentUser),20);return ()=>{}};
   export const signOut=async(a)=>{
    const f=window.__switchFixture;f.signOutCalls++;f.sameAuth=a===auth;
    if(f.mode==='reject')throw Error('local rejection');
    if(f.mode==='retain')return;
    if(f.mode==='delay')await new Promise(resolve=>{f.finish=()=>{auth.currentUser=null;cb(null);resolve()}});
    else{auth.currentUser=null;cb(null)}
   };
   export class GoogleAuthProvider{setCustomParameters(p){this.params=p}}
   export const signInWithPopup=async(a,p)=>{
    const f=window.__switchFixture;f.popupCalls++;f.prompt=p.params;f.nullBeforePopup=a.currentUser===null;
    auth.currentUser=make(f.next,f.token);cb(auth.currentUser);return {user:auth.currentUser};
   };
   export const createUserWithEmailAndPassword=async()=>{},signInWithEmailAndPassword=async()=>{},sendPasswordResetEmail=async()=>{},sendEmailVerification=async()=>{};
   export const indexedDBLocalPersistence={},browserLocalPersistence={},browserSessionPersistence={},browserPopupRedirectResolver={};
  `});
  if(u.origin===origin&&[stage.STAGE2_PATH,'/api/pro-status'].includes(u.pathname)){
   const body=req.method()==='POST'?req.postDataJSON():null;
   const res=await invoke(u.pathname===stage.STAGE2_PATH?route:pro,{method:req.method(),url:u.pathname,query:{},body,
    headers:{...req.headers(),host:u.host}});
   if(holdPreflight&&body?.action==='preflight'){holdPreflight=false;await new Promise(resolve=>{heldReply=resolve})}
   return r.fulfill({status:res.statusCode,headers:res.headers,body:typeof res.payload==='string'?res.payload:JSON.stringify(res.payload)});
  }
  if(u.origin===origin&&!u.pathname.startsWith('/api/')){
   try{const f=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!f.startsWith(root+'/'))throw Error();
    return r.fulfill({contentType:f.endsWith('.js')?'application/javascript':'text/html',body:readFileSync(f)})}
   catch(_){return r.fulfill({status:404,body:''})}
  }
  return r.abort('blockedbyclient');
 });
 try{
  const page=await ctx.newPage();await page.goto(origin+stage.STAGE2_PATH);
  const fixture=(fn,arg)=>page.evaluate(({fn,arg})=>Function('f','arg','return ('+fn+')(f,arg)')(document.querySelector('#app').contentWindow.__switchFixture,arg),{fn:fn.toString(),arg});
  await page.waitForFunction(()=>document.querySelector('#account').textContent.includes('a@example.test')
   &&typeof document.querySelector('#app').contentWindow._stage2SignOut==='function');
  check('cached A is server-confirmed by email, not display name',(await page.locator('#account').textContent()).includes(A.email)
   &&!(await page.locator('#account').textContent()).includes(A.displayName));
  check('different-account chooser disabled before confirmed signout',await page.locator('#chooseGoogle').isDisabled());
  await page.evaluate(()=>{
   const d=document.querySelector('#app').contentDocument;
   const s=d.createElement('script');s.src='https://apis.google.com/js/api.js';d.head.appendChild(s);
   const f=d.createElement('iframe');f.hidden=true;f.src='https://cardresell-e0329.firebaseapp.com/__/auth/iframe';d.body.appendChild(f);
  });
  await page.waitForFunction(()=>document.querySelector('#app').contentWindow.__localBootstrapLoaded===true);
  for(let i=0;authFrameReads===0&&i<100;i++)await new Promise(r=>setTimeout(r,10));
  check('temporary CSP permits only required Google bootstrap/project auth frame probes locally',bootstrapReads===1&&authFrameReads===1);
  holdPreflight=true;await page.evaluate(()=>{void preflight(true)});
  for(let i=0;!heldReply&&i<100;i++)await new Promise(r=>setTimeout(r,10));
  check('cached A preflight response can be held before UI delivery',!!heldReply);
  await page.click('#signout');
  await page.waitForFunction(()=>document.querySelector('#account').textContent.startsWith('Signing out'));
  check('delayed signout is awaited while A remains current',await fixture(f=>f.auth.currentUser.uid)==='dedicated-a'
   &&await page.locator('#chooseGoogle').isDisabled()&&await page.locator('#bind').isDisabled());
  heldReply();heldReply=null;
  await page.waitForFunction(()=>checkingAuth===false);
  check('late A preflight cannot overwrite signout progress',(await page.locator('#account').textContent()).startsWith('Signing out'));
  check('actual SDK signOut uses exact embedded auth instance',await fixture(f=>f.sameAuth===true&&f.popupCalls===0));
  await fixture(f=>f.finish());
  await page.waitForFunction(()=>!document.querySelector('#chooseGoogle').disabled);
  check('chooser enabled only after awaited promise and actual currentUser null',await fixture(f=>f.auth.currentUser===null)
   &&(await page.locator('#account').textContent()).startsWith('Signed out of embedded Firebase'));
  await fixture((f,t)=>{f.token=t},tokenA);
  await page.click('#chooseGoogle');
  await page.waitForFunction(()=>document.querySelector('#account').textContent.startsWith('Google sign-in not confirmed'));
  check('Google chooser explicitly requests select_account',await fixture(f=>f.prompt.prompt==='select_account'&&f.nullBeforePopup));
  check('B browser with stale A token is never confirmed or bind-enabled',await page.locator('#bind').isDisabled()
   &&!(await page.locator('#account').textContent()).includes('Server confirmed'));
  await fixture(f=>{f.mode='reject'});
  await page.click('#signout');await page.waitForFunction(()=>document.querySelector('#account').textContent.startsWith('Sign-out not confirmed'));
  check('rejected signout retains B and never enables chooser',await fixture(f=>f.auth.currentUser.uid==='dedicated-b')
   &&await page.locator('#chooseGoogle').isDisabled());
  await fixture(f=>{f.mode='retain'});
  await page.click('#signout');await page.waitForFunction(()=>document.querySelector('#account').textContent.startsWith('Sign-out not confirmed'));
  check('resolved signout with nonnull SDK user is not treated as success',await page.locator('#chooseGoogle').isDisabled());
  await fixture((f,t)=>{f.mode='success';f.token=t},tokenB);
  await page.click('#signout');await page.waitForFunction(()=>!document.querySelector('#chooseGoogle').disabled);
  await page.click('#chooseGoogle');
  await page.waitForFunction(()=>document.querySelector('#account').textContent.includes('Server confirmed')&&document.querySelector('#account').textContent.includes('b@example.test'));
  check('verified B confirmed only by strict server token/browser match',(await page.locator('#account').textContent()).includes(B.email)
   &&!(await page.locator('#account').textContent()).includes(B.displayName));
  check('new identity still requires fresh attestation',await page.locator('#bind').isDisabled()&&!await page.locator('#attest').isChecked());
  await page.locator('#attest').check();
  check('binding enabled only after verified B and new attestation',await page.locator('#bind').isEnabled());
  check('all switching/preflight requests preserve absent controls',snapshot()===before&&commands.every(c=>['get','mget','exists'].includes(c.cmd)));
  store.set(stage.STAGE2_CONTROL,JSON.stringify(prior));store.set(loss.STAGE2_LOSS_CONTROL,JSON.stringify(oldLoss));
  const consumed=snapshot();
  await page.click('#signout');await page.waitForFunction(()=>!document.querySelector('#chooseGoogle').disabled);
  await page.click('#chooseGoogle');await page.waitForFunction(()=>document.querySelector('#account').textContent.includes('Server confirmed'));
  check('switching never resets existing owner A setup/loss control for B',snapshot()===consumed&&await page.locator('#bind').isDisabled());
  const dir='/home/user/workspace/stage2-account-switch-evidence';mkdirSync(dir,{recursive:true});
  await page.screenshot({path:dir+'/server-confirmed-b.png',fullPage:true});
  writeFileSync(dir+'/observations.json',JSON.stringify({scope:'LOCAL synthetic SDK/JWKS; not managed Google or physical Safari',
   prompt:await fixture(f=>f.prompt),nullBeforePopup:await fixture(f=>f.nullBeforePopup),
   confirmedEmail:B.email,controlBytesPreserved:snapshot()===consumed,executionEnd:stage.STAGE2_END,recoveryEnd:stage.STAGE2_RECOVERY_END},null,2));
 }finally{if(heldReply)heldReply();await browser.close()}
 check('no external server request or billing mutation executed',blocked.length===0&&commands.every(c=>['get','mget','exists'].includes(c.cmd)));
}finally{globalThis.fetch=oldFetch}
done();
