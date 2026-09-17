// LOCAL ONLY. Exact host/origin routing + read-only actual strict-auth preflight.
// All browser requests are fulfilled from local files/handlers or blocked.
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { readFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { harness } from './_assert.mjs';
import { redisStore, redisRest } from './_idRedis.mjs';
import route from '../api/preview-id-authenticated-acceptance.js';
import worker, { STAGE2_WORKER_PATH } from '../api/preview-id-authenticated-worker.js';
import pro from '../api/pro-status.js';
import * as stage from '../api/_previewIdStage2.js';
const {check,done}=harness('preview-id-hosts');
globalThis.crypto ||= webcrypto;
const immutable='host-offline-immutable.vercel.app',stable=stage.STAGE2_STABLE_HOST;
Object.assign(process.env,{VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:stage.STAGE2_BRANCH,
 VERCEL_URL:immutable,KV_REST_API_URL:'https://host-offline.upstash.io',KV_REST_API_TOKEN:'synthetic-offline'});
const store=redisStore(),commands=[],unexpected=[];
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'host-offline'};
const uid='host-offline-dedicated',email='host@example.test',identity={uid,email,providers:['password']};
const enc=v=>Buffer.from(JSON.stringify(v)).toString('base64url'),now=Math.floor(Date.now()/1000);
const signed=enc({alg:'RS256',kid:jwk.kid})+'.'+enc({sub:uid,email,email_verified:true,firebase:{sign_in_provider:'password'},
 aud:'cardresell-e0329',iss:'https://securetoken.google.com/cardresell-e0329',iat:now,exp:now+3600});
const token=signed+'.'+sign('RSA-SHA256',Buffer.from(signed),privateKey).toString('base64url');
const oldFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
 if(String(input)===process.env.KV_REST_API_URL)return redisRest(input,init,commands);
 if(String(input)==='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com')
  return Response.json({keys:[jwk]});
 unexpected.push('blocked_server_request');throw Error('offline_only');
};
async function invoke(handler,host,{method='GET',path=stage.STAGE2_PATH,origin='https://'+host,body=null,headers={}}={}){
 const req={method,url:path,query:{},body,headers:{host,origin,authorization:'Bearer '+token,'sec-fetch-site':'same-origin',...headers}};
 const res={statusCode:200,headers:{},payload:null,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},
  json(p){this.payload=p;return this},send(p){this.payload=p;return this}};
 await handler(req,res);return res;
}
const preflight=(host,extra={})=>invoke(route,host,{method:'POST',body:{action:'preflight',identity},...extra});
const snapshots=()=>JSON.stringify(store.keys().sort().map(k=>[k,store.get(k)]));
try{
 check('stable host constant equals only explicitly approved alias',stable==='cardresell-git-fix-listing-exp-1de09c-willsep200-9430s-projects.vercel.app');
 const before=snapshots();
 for(const host of [immutable,stable]){
  const other=host===stable?immutable:stable;
  const get=await invoke(route,host),w=await invoke(worker,host,{path:STAGE2_WORKER_PATH});
  check(host===stable?'stable GET succeeds':'immutable GET succeeds',get.statusCode===200);
  check('rendered iframe/base/connect-src stay on actual validated '+(host===stable?'stable':'immutable')+' host',
   get.payload.includes('<base href=\\"https://'+host+'/')||get.payload.includes('<base href="https://'+host+'/'));
  check('child API policy contains exact current origin, not other allowed host',
   get.payload.includes('connect-src https://'+host+stage.STAGE2_PATH)
   &&get.payload.includes('https://'+host+'/api/scan-debit-id')
   &&get.payload.includes('https://'+host+'/api/pro-status')&&!get.payload.includes('https://'+other));
  check('top-level CSP remains same-origin and narrow-worker only',
   get.headers['Content-Security-Policy'].includes("worker-src 'self'")
   &&get.headers['Content-Security-Policy'].includes("frame-src 'self'")
   &&!get.headers['Content-Security-Policy'].includes(other));
  check('worker GET supports current host without baking in another host',w.statusCode===200
   &&w.headers['Service-Worker-Allowed']===stage.STAGE2_PATH
   &&w.payload.includes("self.location.origin + '/api/scan-debit-id'")
   &&w.payload.includes('e.source.url === endpoint')&&!w.payload.includes(immutable)&&!w.payload.includes(stable));
  check('literal Vercel js rewrite remains allowed without query',(await invoke(route,host,{path:stage.STAGE2_PATH+'.js'})).statusCode===200);
  const p=await preflight(host);
  check('same-host strict-auth preflight succeeds without setup',p.statusCode===200&&p.payload.setup==='NOT_BOUND'
   &&p.payload.identity.uid===uid&&snapshots()===before);
  const n=commands.length;
  check('cross-host Origin rejected even when both hosts allowed',
   (await preflight(host,{origin:'https://'+other})).statusCode!==200&&commands.length===n);
  for(const origin of ['https://cardresell.com','null','http://'+host,'https://'+host+':443','https://'+host+'.evil.test']){
   check('forged Origin rejected before control read: '+origin,
    (await preflight(host,{origin})).statusCode!==200&&commands.length===n);
  }
  check('cross-site Fetch Metadata rejected', (await preflight(host,{headers:{'sec-fetch-site':'cross-site'}})).statusCode!==200);
 }
 for(const host of [
  'cardresell.com','www.cardresell.com','cardresell.vercel.app','other.vercel.app',
  'prefix-'+stable,stable+'.evil.test',stable.replace('.vercel.app','-suffix.vercel.app'),
  '*.'+stable,stable.toUpperCase(),stable+':443',stable+'.',stable+','+immutable,
  stable.replace('1de09c','1de09d')
 ]){
  const count=commands.length;
  check('non-exact host denied for page and worker: '+host,
   (await invoke(route,host)).statusCode!==200&&(await invoke(worker,host,{path:STAGE2_WORKER_PATH})).statusCode!==200
   &&commands.length===count);
 }
 check('forwarded-host cannot authorize unapproved Host',(await invoke(route,'other.vercel.app',
  {headers:{'x-forwarded-host':stable}})).statusCode!==200);
 process.env.VERCEL_ENV='production';
 check('both exact hosts remain denied in Production',(await invoke(route,stable)).statusCode!==200&&(await invoke(route,immutable)).statusCode!==200);
 process.env.VERCEL_ENV='preview';process.env.VERCEL_GIT_COMMIT_REF='other';
 check('stable hostname does not bypass branch guard',(await invoke(route,stable)).statusCode!==200);
 process.env.VERCEL_GIT_COMMIT_REF=stage.STAGE2_BRANCH;
 for(const bad of ['', 'https://'+immutable,immutable+':443','*.vercel.app','cardresell.vercel.app']){
  process.env.VERCEL_URL=bad;
  check('invalid immutable configuration fails closed even on stable host: '+bad,(await invoke(route,stable)).statusCode!==200);
 }
 process.env.VERCEL_URL=immutable;
 check('GET/preflight cases made no KV mutations and preserved exact bytes',
  commands.every(c=>['get','mget','exists'].includes(c.cmd))&&snapshots()===before);
 // Seed a prior-consumed synthetic setup directly in the private local Redis
 // fixture, NOT by invoking bind/accept. Application requests remain read-only.
 const existing={version:1,namespace:'a'.repeat(64),owner:uid,stamp:'2026_09',
  state:'active',phase:-1,step:'idle',expires:stage.STAGE2_END,
  fixtures:[1,2,3,4].map(n=>({receipt:String(n).repeat(64),scan:String(n+4).repeat(64)}))};
 stage.validateStage2(existing);
 const exactExisting=JSON.stringify(existing);store.set(stage.STAGE2_CONTROL,exactExisting);
 const preserved=snapshots();
 for(const host of [immutable,stable]){
  const p=await preflight(host);await invoke(route,host);
  check('existing consumed setup remains byte-identical on '+(host===stable?'stable':'immutable')+' GET/preflight',
   p.payload.setup==='BOUND_TO_THIS_ACCOUNT'&&p.payload.canBind===false&&store.get(stage.STAGE2_CONTROL)===exactExisting);
 }

 const {chromium,devices}=(await import('/home/user/node_modules/playwright/index.js')).default;
 const browser=await chromium.launch(),root=resolve(new URL('..',import.meta.url).pathname);
 try{
  for(const host of [immutable,stable]){
   const origin='https://'+host,ctx=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'block'});
   const calls=[],blocked=[];
   await ctx.route('**/*',async r=>{
    const req=r.request(),u=new URL(req.url());
    if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-app.js'))
     return r.fulfill({contentType:'application/javascript',body:'export const initializeApp=()=>({});'});
    if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-auth.js'))
     return r.fulfill({contentType:'application/javascript',body:`
      const user=${JSON.stringify({uid,email,emailVerified:true,isAnonymous:false,providerData:[{providerId:'password'}]})};
      user.getIdToken=async()=>${JSON.stringify(token)};user.reload=async()=>{};
      const auth={currentUser:user};let callback=()=>{};
      export const initializeAuth=()=>auth,onAuthStateChanged=(a,cb)=>{callback=cb;setTimeout(()=>cb(user),20);return ()=>{}};
      export const signOut=async()=>{auth.currentUser=null;callback(null)},signInWithPopup=async()=>{},
       createUserWithEmailAndPassword=async()=>{},signInWithEmailAndPassword=async()=>{},sendPasswordResetEmail=async()=>{},sendEmailVerification=async()=>{};
      export class GoogleAuthProvider{}
      export const indexedDBLocalPersistence={},browserLocalPersistence={},browserSessionPersistence={},browserPopupRedirectResolver={};
     `});
    if(u.origin===origin&&[stage.STAGE2_PATH,'/api/pro-status'].includes(u.pathname)){
     const body=req.method()==='POST'?req.postDataJSON():null;
     calls.push({origin:u.origin,action:body?.action});
     const res=await invoke(u.pathname===stage.STAGE2_PATH?route:pro,host,{method:req.method(),path:u.pathname,body,headers:req.headers()});
     return r.fulfill({status:res.statusCode,headers:res.headers,body:typeof res.payload==='string'?res.payload:JSON.stringify(res.payload)});
    }
    if(u.origin===origin&&!u.pathname.startsWith('/api/')){
     try{const f=resolve(root,'.'+(u.pathname==='/'?'/index.html':u.pathname));if(!f.startsWith(root+'/'))throw Error();
      return r.fulfill({contentType:f.endsWith('.js')?'application/javascript':'text/html',body:readFileSync(f)})}
     catch(_){return r.fulfill({status:404,body:''})}
    }
    // Never passthrough even if a render regression tries another managed host.
    if(u.hostname.endsWith('.vercel.app'))blocked.push(u.hostname);
    return r.abort('blockedbyclient');
   });
   const page=await ctx.newPage();await page.goto(origin+stage.STAGE2_PATH);
   await page.waitForFunction(()=>document.querySelector('#account').textContent.startsWith('Server confirmed'));
   check('actual readonly browser preflight confirms on '+(host===stable?'stable':'immutable')+' origin',
    calls.some(c=>c.action==='preflight')&&calls.every(c=>c.origin===origin)&&blocked.length===0);
   const base=await page.evaluate(()=>document.querySelector('#app').contentDocument.baseURI);
   check('actual srcdoc base uses request origin with no cross-host iframe',base===origin+'/');
   const preSignout=snapshots(),count=commands.filter(c=>!['get','mget','exists'].includes(c.cmd)).length;
   await page.click('#signout');
   await page.waitForFunction(()=>document.querySelector('#account').textContent==='Sign out and use dedicated test account');
   check('actual signout/GET/preflight retain exact control bytes on current origin',
    snapshots()===preSignout&&commands.filter(c=>!['get','mget','exists'].includes(c.cmd)).length===count
    &&await page.locator('#bind').isDisabled());
   const dir='/home/user/workspace/stage2-exact-host-evidence';mkdirSync(dir,{recursive:true});
   await page.screenshot({path:dir+'/'+(host===stable?'stable':'immutable')+'-readonly.png',fullPage:true});
   await ctx.close();
  }
 }finally{await browser.close()}
 check('all application requests performed zero setup/billing writes or external calls',
  commands.every(c=>['get','mget','exists'].includes(c.cmd))&&snapshots()===preserved&&unexpected.length===0);
}finally{globalThis.fetch=oldFetch}
done();
