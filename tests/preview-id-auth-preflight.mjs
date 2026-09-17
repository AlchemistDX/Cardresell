// LOCAL ONLY: actual protected handler/signature verifier, synthetic RSA/JWKS,
// isolated Redis and unchanged app/auth bundles with an offline SDK state fixture.
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { harness } from './_assert.mjs';
import { redisStore, redisRest } from './_idRedis.mjs';
import route from '../api/preview-id-authenticated-acceptance.js';
import pro from '../api/pro-status.js';
import * as stage from '../api/_previewIdStage2.js';
const { check, done } = harness('preview-id-auth-preflight');
globalThis.crypto ||= webcrypto;
Object.assign(process.env, { VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:stage.STAGE2_BRANCH,
 VERCEL_URL:'auth-offline.vercel.app',KV_REST_API_URL:'https://auth-offline.upstash.io',
 KV_REST_API_TOKEN:'local-fixture-not-credential' });
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'preflight-offline'};
const uid='preflight-dedicated',email='dedicated@example.test';
const identity={uid,email,providers:['password']};
const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
function token(patch={},header={}) {
 const now=Math.floor(Date.now()/1000);
 const data=enc({alg:'RS256',kid:jwk.kid,...header})+'.'+enc({sub:uid,email,email_verified:true,
  firebase:{sign_in_provider:'password'},aud:'cardresell-e0329',
  iss:'https://securetoken.google.com/cardresell-e0329',iat:now,exp:now+3600,...patch});
 return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');
}
const validToken=token();
let store=redisStore(),commands=[],external=[];
const priorFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 if(String(input)===process.env.KV_REST_API_URL)return redisRest(input,init,commands);
 if(String(input)==='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
  return Response.json({keys:[jwk]});
 external.push(String(input));throw Error('local_network_only');
};
async function invoke(body,auth=validToken,extra={},handler=route) {
 const req={method:'POST',url:stage.STAGE2_PATH,query:{},body,headers:{
  host:process.env.VERCEL_URL,origin:'https://'+process.env.VERCEL_URL,authorization:'Bearer '+auth},...extra};
 const res={statusCode:200,headers:{},payload:null,setHeader(k,v){this.headers[k]=v},
  status(n){this.statusCode=n;return this},json(p){this.payload=p;return this},send(p){this.payload=p;return this}};
 await handler(req,res);return res;
}
const mutating=()=>commands.filter(c=>!['get','mget','exists'].includes(c.cmd));
try {
 const get=await invoke(null,'',{method:'GET'});
 check('GET is read-only and initially disables binding',get.statusCode===200&&commands.length===0
  &&get.payload.includes('id="bind" disabled')&&!get.payload.includes('account without email'));
 for(const [name,t] of [
  ['anonymous',token({firebase:{sign_in_provider:'anonymous'}})],
  ['unrecognized provider',token({firebase:{sign_in_provider:'custom'}})],
  ['missing provider',token({firebase:{}})],
  ['missing UID',token({sub:''})],['nonstring UID',token({sub:4})],
  ['missing email',token({email:''})],
  ['recovered email not raw email',token({email:undefined,firebase:{sign_in_provider:'password',identities:{email:[email]}}})],
  ['unverified',token({email_verified:false})],
  ['Apple implied verification',token({email_verified:false,firebase:{sign_in_provider:'apple.com'}})],
  ['missing expiry',token({exp:undefined})],['nonnumeric expiry',token({exp:'9999999999'})],
  ['expired',token({exp:1})],['missing issued-at',token({iat:undefined})],
  ['future issued-at',token({iat:Math.floor(Date.now()/1000)+900})],
  ['wrong algorithm despite RSA signature',token({}, {alg:'HS256'})],
  ['invalid signature',validToken.slice(0,-8)+'abcdefgh'],
  ['invalid token','not-a-token']
 ]) {
  const count=commands.length;
  const p=await invoke({action:'preflight',identity},t),b=await invoke({action:'bind',identity,attest:true},t);
  check(name+' rejected for preflight and direct bind before KV',p.statusCode!==200&&b.statusCode!==200
   &&commands.length===count&&!JSON.stringify(p.payload).includes(t));
 }
 for(const [name,browser] of [
  ['missing identity',undefined],['UID mismatch',{...identity,uid:'different'}],
  ['email mismatch',{...identity,email:'different@example.test'}],
  ['provider mismatch',{...identity,providers:['google.com']}],
  ['provider missing',{...identity,providers:[]}],
  ['arbitrary identity field',{...identity,admin:true}]
 ]) {
  const count=commands.length;
  check(name+' cannot bypass direct bind',(await invoke({action:'bind',attest:true,identity:browser})).statusCode!==200
   &&commands.length===count);
 }
 const pre=await invoke({action:'preflight',identity});
 check('verified matched identity sees absent setup without consuming it',pre.statusCode===200
  &&pre.payload.setup==='NOT_BOUND'&&pre.payload.identity.email===email&&store.get(stage.STAGE2_CONTROL)===null
  &&mutating().length===0);
 check('strict password provider is server confirmed',pre.payload.identity.provider==='password');
 const originalNow=Date.now;Date.now=()=>stage.STAGE2_END+1000;
 const recoveryToken=token();
 const recovery=await invoke({action:'preflight',identity},recoveryToken);
 Date.now=originalNow;
 check('recovery-window preflight is read-only and cannot enable new bind',recovery.statusCode===200
  &&recovery.payload.canBind===false&&store.get(stage.STAGE2_CONTROL)===null&&mutating().length===0);
 for(const provider of ['google.com','apple.com']) {
  const p=await invoke({action:'preflight',identity:{...identity,providers:[provider]}},
   token({firebase:{sign_in_provider:provider}}));
  check('explicit verified '+provider+' accepted read-only',p.statusCode===200&&mutating().length===0);
 }
 const bind=await invoke({action:'bind',attest:true,identity});
 const before=store.get(stage.STAGE2_CONTROL),writes=mutating().length;
 check('strict matched direct bind consumes once',bind.statusCode===200&&!!before);
 const again=await invoke({action:'preflight',identity});
 check('consumed setup preflight preserves exact control bytes',again.payload.setup==='BOUND_TO_THIS_ACCOUNT'
  &&store.get(stage.STAGE2_CONTROL)===before&&mutating().length===writes);
 const other=await invoke({action:'preflight',identity:{...identity,uid:'another-dedicated'}},token({sub:'another-dedicated'}));
 check('other verified account gets no owner identifier or control payload',other.payload.setup==='BOUND_TO_OTHER_ACCOUNT'
  &&!JSON.stringify(other.payload).includes(uid)&&store.get(stage.STAGE2_CONTROL)===before);

 // Real rendered temporary page and actual shipped auth.js; SDK transitions are
 // explicitly local synthetic fixtures, never a managed-auth or Safari claim.
 store=redisStore();commands=[];
 const {chromium,devices}=(await import('/home/user/node_modules/playwright/index.js')).default;
 const browser=await chromium.launch();
 const ctx=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
 const origin='https://'+process.env.VERCEL_URL,root=resolve(new URL('..',import.meta.url).pathname);
 let preflights=0;
 await ctx.route('**/*',async r=>{
  const req=r.request(),u=new URL(req.url());
  if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-app.js'))
   return r.fulfill({contentType:'application/javascript',body:'export const initializeApp=()=>({});'});
  if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-auth.js'))
   return r.fulfill({contentType:'application/javascript',body:`
    let auth={currentUser:null},callback=()=>{};
    window.__localSetSDK=(user,token)=>{auth.currentUser=user?{...user,getIdToken:async()=>token,reload:async()=>{}}:null;callback(auth.currentUser)};
    export const initializeAuth=()=>auth,onAuthStateChanged=(a,cb)=>{callback=cb;cb(auth.currentUser);return ()=>{}};
    export const signOut=async()=>{auth.currentUser=null;callback(null)},signInWithPopup=async()=>{},
     createUserWithEmailAndPassword=async()=>{},signInWithEmailAndPassword=async()=>{},
     sendPasswordResetEmail=async()=>{},sendEmailVerification=async()=>{};
    export class GoogleAuthProvider{}
    export const indexedDBLocalPersistence={},browserLocalPersistence={},browserSessionPersistence={},browserPopupRedirectResolver={};
   `});
  if(u.origin===origin&&[stage.STAGE2_PATH,'/api/pro-status'].includes(u.pathname)){
   const b=req.method()==='POST'?req.postDataJSON():null;
   if(b?.action==='preflight')preflights++;
   const res=await invoke(b,'',{method:req.method(),url:u.pathname,headers:{...req.headers(),host:u.host}},u.pathname===stage.STAGE2_PATH?route:pro);
   return r.fulfill({status:res.statusCode,headers:res.headers,
    body:typeof res.payload==='string'?res.payload:JSON.stringify(res.payload)});
  }
  if(u.origin===origin&&!u.pathname.startsWith('/api/')){
   const f=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));
   try{if(!f.startsWith(root+'/'))throw Error();return r.fulfill({contentType:f.endsWith('.js')?'application/javascript':'text/html',body:readFileSync(f)})}
   catch(_){return r.fulfill({status:404,body:''})}
  }
  return r.abort('blockedbyclient');
 });
 try{
  const page=await ctx.newPage();await page.goto(origin+stage.STAGE2_PATH);
  await page.waitForFunction(()=>!!document.querySelector('#app').contentWindow.__localSetSDK);
  const sdk={uid,email,emailVerified:true,isAnonymous:false,providerData:[{providerId:'password'}]};
  const set=async(user,t=validToken)=>page.evaluate(({user,t})=>document.querySelector('#app').contentWindow.__localSetSDK(user,t),{user,t});
  const rejected=()=>page.waitForFunction(()=>document.querySelector('#account').textContent==='Sign out and use dedicated test account'&&document.querySelector('#bind').disabled);
  await rejected();
  check('signed-out first load never claims normal authentication',await page.locator('#bind').isDisabled()&&preflights===0);
  for(const [name,user,t] of [
   ['anonymous SDK',{...sdk,isAnonymous:true},validToken],
   ['SDK without email',{...sdk,email:null},validToken],
   ['unverified SDK',{...sdk,emailVerified:false},validToken],
   ['SDK provider absent',{...sdk,providerData:[]},validToken],
   ['SDK/server UID mismatch',{...sdk,uid:'stale-uid'},validToken],
   ['SDK/server email mismatch',{...sdk,email:'stale@example.test'},validToken],
   ['SDK/server provider mismatch',{...sdk,providerData:[{providerId:'google.com'}]},validToken],
   ['expired cached session',sdk,token({exp:1})]
  ]){
   await set(null);await rejected();await set(user,t);
   // Explicit user bind attempt would re-preflight; invoke only the page's
   // read-only check here to wait for rejection rather than sampling stale UI.
   await page.evaluate(()=>preflight(true));await rejected();
   check(name+' cannot enable bind or claim normal auth',await page.locator('#bind').isDisabled()
    &&mutating().length===0);
  }
  await set(null);await rejected();await set(sdk);
  await page.waitForFunction(()=>document.querySelector('#account').textContent.startsWith('Server confirmed'));
  check('valid transition is labeled confirmed only after real verifier preflight',preflights>0
   &&await page.locator('#account').textContent().then(t=>t.includes(email))&&mutating().length===0);
  check('valid preflight still requires explicit attestation',await page.locator('#bind').isDisabled());
  await page.locator('#attest').check();
  check('matching verified identity and attestation enable bind',await page.locator('#bind').isEnabled());
  await set(sdk,token({exp:1}));await page.click('#bind');await rejected();
  check('stale token on bind rechecked before any setup mutation',mutating().length===0&&store.get(stage.STAGE2_CONTROL)===null);
  await page.click('#signout');await rejected();
  check('explicit normal SDK signout leaves controls untouched',await page.evaluate(()=>!document.querySelector('#app').contentWindow._fbAuth.currentUser)
   &&mutating().length===0);
  await set(sdk);await page.waitForFunction(()=>!document.querySelector('#bind').disabled);
  await page.click('#bind');await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('"step": "idle"'));
  check('fresh valid sign-in after signout can bind once',!!store.get(stage.STAGE2_CONTROL));
  const consumed=store.get(stage.STAGE2_CONTROL),count=mutating().length;
  await page.click('#signout');await rejected();
  check('signout after binding never resets consumed control',store.get(stage.STAGE2_CONTROL)===consumed&&mutating().length===count);
  const dir='/home/user/workspace/stage2-auth-preflight-evidence';mkdirSync(dir,{recursive:true});
  await page.screenshot({path:dir+'/signed-out-bind-disabled.png',fullPage:true});
 }finally{await browser.close()}
 check('no external provider, Stripe or managed network request was made',external.length===0);
}finally{globalThis.fetch=priorFetch}
done();
