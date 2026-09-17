// Actual local HTTP + real handlers/signature verifier + native service worker.
// Only SDK/JWKS and deployment origin are offline fixtures; not managed sign-in.
import { createServer } from 'node:http';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import stageRoute from '../api/preview-id-authenticated-acceptance.js';
import workerRoute from '../api/preview-id-authenticated-worker.js';
import debit from '../api/scan-debit-id.js';
import pro from '../api/pro-status.js';
import * as stage from '../api/_previewIdStage2.js';
import * as loss from '../api/_previewIdStage2Loss.js';
export async function stage2WorkerPageCheck({ check, reset, getStore }) {
  globalThis.crypto ||= webcrypto;
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'worker-offline' };
  const uid='worker-local-dedicated',email='worker-local@example.test';
  const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url'),now=Math.floor(Date.now()/1000);
  const unsigned=enc({alg:'RS256',kid:jwk.kid})+'.'+enc({sub:uid,email,email_verified:true,firebase:{sign_in_provider:'password'},
    aud:'cardresell-e0329',iss:'https://securetoken.google.com/cardresell-e0329',iat:now,exp:now+3600});
  const token=unsigned+'.'+sign('RSA-SHA256',Buffer.from(unsigned),privateKey).toString('base64url');
  process.env.VERCEL_URL='worker-offline.vercel.app';
  const root=resolve(new URL('..',import.meta.url).pathname);
  const previous=globalThis.fetch;
  let jwksReads=0,attempts=[],proofCalls=[],origin,dropClaim=false,dropReport=false,depleteOnAccept=false;
  let pauseAccept=false,acceptPaused,releaseAccept;
  globalThis.fetch=async(input,init)=>{
    if(String(input)==='https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'){
      jwksReads++;return Response.json({keys:[jwk]});
    }
    const args=init?.body?JSON.parse(init.body):[];
    if(pauseAccept&&args[0]==='EVAL'&&args[6]==='accept'){
      pauseAccept=false;acceptPaused();
      await new Promise(r=>releaseAccept=r);
    }
    return previous(input,init);
  };
  const server=createServer(async(req,res)=>{
    try{
      const u=new URL(req.url,'http://localhost'),path=u.pathname;
      if(path==='/unrelated-worker.js'){
        res.writeHead(200,{'Content-Type':'application/javascript'});
        res.end("self.addEventListener('install',e=>e.waitUntil(self.skipWaiting()));");return;
      }
      const routes={
        [stage.STAGE2_PATH]:stageRoute,
        '/api/preview-id-authenticated-worker':workerRoute,
        '/api/scan-debit-id':debit,'/api/pro-status':pro,
      };
      if(routes[path]){
        let raw='';for await(const c of req){raw+=c;if(raw.length>50000)throw Error()}
        const body=raw?JSON.parse(raw):null;
        if(body?.action?.startsWith('loss-'))proofCalls.push(body.action);
        let status=200;
        const attempt=path==='/api/scan-debit-id'?{body:raw,status:null}:null;
        if(attempt)attempts.push(attempt);
        if(attempt&&depleteOnAccept){
          depleteOnAccept=false;const active=await stage.stage2State();
          getStore().set(stage.stage2Keys(active)[0],'5');getStore().set(stage.stage2Keys(active)[1],'0');
        }
        const headers={...req.headers,host:process.env.VERCEL_URL};
        // Local-origin fixture only. Production route guard itself is unchanged.
        if(headers.origin===origin)headers.origin='https://'+process.env.VERCEL_URL;
        await routes[path]({method:req.method,url:req.url,query:Object.fromEntries(u.searchParams),headers,body},{
          setHeader:(k,v)=>res.setHeader(k,v),status(n){status=n;return this},
          json(payload){
            if(attempt)attempt.status=status;
            if((dropClaim&&body?.action==='loss-claim')||(dropReport&&body?.action==='loss-commit')){
              dropClaim=false;dropReport=false;res.destroy();return this;
            }
            res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(payload));return this;
          },
          send(payload){
            res.writeHead(status);
            res.end(typeof payload==='string'?payload.replaceAll('https://'+process.env.VERCEL_URL,origin):payload);
            return this;
          },
        });return;
      }
      if(path.startsWith('/api/')){res.writeHead(503);res.end('{}');return}
      const file=resolve(root,'.'+(path==='/'?'/index.html':path));
      if(!file.startsWith(root+'/'))throw Error();
      res.setHeader('Content-Type',extname(file)==='.js'?'application/javascript':'text/html');
      res.end(readFileSync(file));
    }catch(_){if(!res.headersSent)res.writeHead(500);res.end('{}')}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  origin=`http://127.0.0.1:${server.address().port}`;
  const {chromium,devices}=(await import('/home/user/node_modules/playwright/index.js')).default;
  const browser=await chromium.launch();
  let ctx,page;
  async function fresh(){
    if(ctx)await ctx.close();
    reset();attempts=[];proofCalls=[];
    ctx=await browser.newContext({...devices['iPhone 13'],serviceWorkers:'allow'});
    ctx.on('serviceworker',w=>w.evaluate(()=>self.addEventListener('message',e=>{
      self.__localMessageObservation={kind:e.data?.type,sourceType:e.source?.type,
        frameType:e.source?.frameType,originMatches:e.origin===self.location.origin,
        exactParent:e.source?.url===self.location.origin+'/api/preview-id-authenticated-acceptance'};
    })).catch(()=>{}));
    await ctx.route('**/*',async r=>{
      const u=new URL(r.request().url());
      if(u.origin===origin)return r.continue();
      if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-app.js'))
        return r.fulfill({contentType:'application/javascript',body:'export const initializeApp=()=>({});'});
      if(u.hostname==='www.gstatic.com'&&u.pathname.endsWith('firebase-auth.js')){
        const user=JSON.stringify({uid,email,emailVerified:true,isAnonymous:false,providerData:[{providerId:'password'}]});
        return r.fulfill({contentType:'application/javascript',body:`
          const user={...${user},getIdToken:async()=>${JSON.stringify(token)},reload:async()=>{}};
          export const initializeAuth=()=>({currentUser:user});
          export const onAuthStateChanged=(a,cb)=>{setTimeout(()=>cb(user),20);return ()=>{}};
          export const signOut=async()=>{},signInWithPopup=async()=>{},createUserWithEmailAndPassword=async()=>{},
            signInWithEmailAndPassword=async()=>{},sendPasswordResetEmail=async()=>{},sendEmailVerification=async()=>{};
          export class GoogleAuthProvider{}
          export const indexedDBLocalPersistence={},browserLocalPersistence={},browserSessionPersistence={},browserPopupRedirectResolver={};
        `});
      }
      return r.abort('blockedbyclient');
    });
    page=await ctx.newPage();page.setDefaultTimeout(12000);
    await page.goto(origin+stage.STAGE2_PATH);
    await page.waitForFunction(()=>document.querySelector('#app').contentWindow._fbAuth?.currentUser
      &&document.querySelector('#app').contentWindow._stage2WorkerMessage);
    await page.locator('#attest').check();await page.click('#bind');
    await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('"step": "idle"'));
    await page.click('#next');await frame().getByTestId('identity-cancel').click();
    await page.click('#next');await pick();await settled();
    await page.click('#next');
    await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('"phase": 2'));
  }
  const frame=()=>page.frameLocator('#app');
  async function pick(){await frame().getByTestId('identity-more').click();await frame().locator('[data-candidate-set="Synthetic Set 7"]').click()}
  const settled=()=>page.waitForFunction(()=>document.querySelector('#app').contentWindow._scanCandidateDebitPending===false);
  const keys=s=>stage.stage2Keys(s);
  const arm=async()=>{
    await page.click('#armLoss');
    try { await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('"browserLossPhase": "ARMED"')); }
    catch(e){
      console.log('Local worker arm observation',await page.locator('#output').textContent(),
        await page.evaluate(()=>({controlled:!!navigator.serviceWorker.controller,
          frameControlled:!!document.querySelector('#app').contentWindow.navigator.serviceWorker.controller})));
      for(const w of ctx.serviceWorkers())console.log('Local worker message flags',await w.evaluate(()=>self.__localMessageObservation));
      throw e;
    }
  };
  try{
    await fresh();await arm();
    check('actual page normal-auth setup arms exact third phase',(await loss.stage2LossStatus(await stage.stage2State())).state==='armed');
    check('actual srcdoc inherits worker controller',await page.evaluate(()=>!!document.querySelector('#app').contentWindow.navigator.serviceWorker.controller));
    const scope=await page.evaluate(async()=>(await navigator.serviceWorker.getRegistration()).scope);
    check('registration scope is fixed acceptance path, never root',scope===origin+stage.STAGE2_PATH);
    const controlledFrame=page.frames().find(f=>f.url()==='about:srcdoc');
    const pending=await stage.stage2State();
    const matchingBody=JSON.stringify({confirmation_id:pending.fixtures[2].receipt,scan_id:pending.fixtures[2].scan,
      candidate_set:pending.confirmation.candidate_set,mode:'identify',candidate:stage.stage2Candidates()[6]});
    const otherClient=await page.evaluate(async body=>(await fetch('/api/scan-debit-id',
      {method:'POST',headers:{'Content-Type':'application/json'},body})).status,matchingBody);
    const wrongMethod=await controlledFrame.evaluate(async()=>(await fetch('/api/scan-debit-id')).status);
    const wrongQuery=await controlledFrame.evaluate(async body=>(await fetch('/api/scan-debit-id?wrong=1',
      {method:'POST',headers:{'Content-Type':'application/json'},body})).status,matchingBody);
    check('other client/method/query are not suppressed or claimed',otherClient===401&&wrongMethod===405&&wrongQuery===503
      &&(await loss.stage2LossStatus(pending)).state==='armed'&&!proofCalls.includes('loss-claim'));
    const prefix=await ctx.newPage();await prefix.goto(origin+stage.STAGE2_PATH+'-unrelated');
    const prefixArm=await prefix.evaluate(async()=>Promise.race([
      new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);
        navigator.serviceWorker.controller.postMessage({type:'stage2-loss-parent'},[c.port2])}),
      new Promise(resolve=>setTimeout(()=>resolve({ignored:true}),250)),
    ]));
    check('same-scope-prefix unrelated page cannot link or rearm worker',prefixArm.ignored===true
      &&(await loss.stage2LossStatus(pending)).state==='armed');
    await prefix.close();
    const cdp=await ctx.newCDPSession(page);await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.stopAllWorkers');
    const before=attempts.length;
    await pick();await settled();
    const s=await stage.stage2State(),proof=await loss.stage2LossStatus(s);
    check('worker forwards acceptance exactly once before real Retry',attempts.length===before+1&&attempts.at(-1).status===200);
    check('native worker restart retains binding and one durable claim',proofCalls.filter(x=>x==='loss-claim').length===1);
    check('real Redis journal and free-first balance corroborate committed response',proof.commitCorroborated
      &&getStore().get(keys(s)[0])==='5'&&getStore().get(keys(s)[1])==='1');
    check('unchanged picker exposes real Retry without accepted client persistence',await frame().getByTestId('identity-retry').isVisible()
      &&await page.evaluate(()=>!document.querySelector('#app').contentWindow._pendingIdScanCard
        &&!localStorage.getItem('cr:lastCard:v1:ident')));
    const first=attempts.at(-1).body;
    await cdp.send('ServiceWorker.stopAllWorkers');
    await frame().getByTestId('identity-retry').click();await settled();
    check('real Retry has identical receipt and selection bytes',attempts.length===before+2&&attempts.at(-1).body===first);
    check('restart after suppression never reclaims or suppresses retry',proofCalls.filter(x=>x==='loss-claim').length===1
      &&proofCalls.filter(x=>x==='loss-retry').length===1);
    check('matching retry corroborates unchanged journal/balances',(await loss.stage2LossStatus(s)).matchingRetryCorroborated
      &&getStore().get(keys(s)[0])==='5'&&getStore().get(keys(s)[1])==='1');
    check('real client accepts canonical seventh printing after retry',await page.evaluate(()=>
      document.querySelector('#app').contentWindow._pendingIdScanCard?.setName==='Synthetic Set 7'));
    await page.click('#status');
    await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('MATCHING_RETRY_RESPONSE_OBSERVED'));
    check('inline evidence includes actual Retry click without server claim',await page.locator('#output').textContent().then(x=>x.includes('"browserRetryClicks": 1')));
    const evidence=JSON.parse(await page.locator('#output').textContent());
    const dir='/home/user/workspace/stage2-worker-browser-evidence';mkdirSync(dir,{recursive:true});
    writeFileSync(dir+'/committed-response-retry.json',JSON.stringify({scope:'LOCAL HTTP/native worker/real handler and Redis; synthetic SDK/JWKS; not managed Safari',evidence},null,2));
    await page.screenshot({path:dir+'/committed-response-retry.png',fullPage:true});
    await page.evaluate(()=>navigator.serviceWorker.register('/unrelated-worker.js',{scope:'/unrelated/'}));
    await page.click('#cleanup');
    await page.waitForFunction(()=>document.querySelector('#output').textContent.includes('"registrationRemoved": true'));
    check('cleanup disarms durable evidence before local worker teardown',(await loss.stage2LossStatus(await stage.stage2State())).disarmed
      &&getStore().get(keys(s)[0])===null&&getStore().get(keys(s)[1])===null);
    check('cleanup removes only fixed worker registration and preserves unrelated registration',await page.evaluate(async()=>{
      const registrations=await navigator.serviceWorker.getRegistrations();
      return registrations.length===1&&registrations[0].scope===location.origin+'/unrelated/';
    }));
    const afterCleanup=await page.evaluate(async body=>(await fetch('/api/scan-debit-id',
      {method:'POST',headers:{'Content-Type':'application/json'},body})).status,matchingBody);
    check('still-controlled parent passes requests after durable disarm/unregister',afterCleanup===401
      &&(await loss.stage2LossStatus(await stage.stage2State())).disarmed);
    await fresh();await arm();dropClaim=true;
    const attemptsBeforeLostClaim=attempts.length;
    await pick();await settled();
    const unknown=await loss.stage2LossStatus(await stage.stage2State());
    check('lost durable claim acknowledgement makes no acceptance forward',attempts.length===attemptsBeforeLostClaim);
    check('lost claim outcome is unknown, not commit proof',unknown.state==='unknown'&&!unknown.commitCorroborated);
    await frame().getByTestId('identity-retry').click();await settled();
    check('user Retry after ambiguous claim forwards once without suppression',attempts.length===attemptsBeforeLostClaim+1&&attempts.at(-1).status===200);
    check('ambiguous claim does not fabricate managed suppression success',!(await loss.stage2LossStatus(await stage.stage2State())).commitCorroborated);
    await fresh();await arm();dropReport=true;
    const reportStart=attempts.length;
    await pick();await settled();
    const reportUnknown=await loss.stage2LossStatus(await stage.stage2State());
    check('lost corroboration acknowledgement returns original success without deliberate suppression',
      attempts.length===reportStart+1&&reportUnknown.state==='unknown'
      &&reportUnknown.diagnosticCategory==='corroboration_unavailable'
      &&await page.evaluate(()=>!!document.querySelector('#app').contentWindow._pendingIdScanCard));
    check('server commit observation is preserved separately from unknown suppression',reportUnknown.commitCorroborated
      &&!reportUnknown.matchingRetryCorroborated);
    await fresh();await arm();depleteOnAccept=true;
    const rejectedStart=attempts.length;
    await pick();await settled();
    const rejected=await loss.stage2LossStatus(await stage.stage2State());
    check('real post-claim 402 is passed through without suppression/pass',attempts.length===rejectedStart+1
      &&attempts.at(-1).status===402&&rejected.state==='unknown'&&!rejected.commitCorroborated);
    check('402 leaves no accepted browser persistence',await page.evaluate(()=>!localStorage.getItem('cr:lastCard:v1:ident')));
    await fresh();await arm();
    let pausedResolve;const paused=new Promise(r=>pausedResolve=r);acceptPaused=pausedResolve;pauseAccept=true;
    await pick();await paused;
    const cleanupWhileInflight=await page.evaluate(async token=>(await fetch('/api/preview-id-authenticated-acceptance',
      {method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
        body:JSON.stringify({action:'cleanup'})})).json(),token);
    releaseAccept();await settled();
    check('in-flight authorized acceptance is fenced after durable disarm and cleanup',
      cleanupWhileInflight.ok&&cleanupWhileInflight.loss.disarmed&&attempts.at(-1).status!==200
      &&(await stage.stage2State()).state==='closed');
    check('in-flight cleanup race never fabricates commit proof',!(await loss.stage2LossStatus(await stage.stage2State())).commitCorroborated
      &&stage.stage2Keys(await stage.stage2State()).every(k=>getStore().get(k)===null));
    await fresh();await arm();
    const expiresStart=attempts.length;
    // Local worker-only clock fault: server clock and real handler remain live.
    // This proves the exact native worker's hard-expiry pass-through boundary.
    await ctx.serviceWorkers()[0].evaluate(end=>{Date.now=()=>end+1},stage.STAGE2_END);
    await pick();await settled();
    check('expired worker passes original acceptance without claiming or suppressing',
      attempts.length===expiresStart+1&&attempts.at(-1).status===200&&!proofCalls.includes('loss-claim')
      &&await page.evaluate(()=>!!document.querySelector('#app').contentWindow._pendingIdScanCard));
    check('expiry pass-through is not labeled response-loss proof',
      !(await loss.stage2LossStatus(await stage.stage2State())).commitCorroborated);
    check('real normal signature verifier reached synthetic local JWKS',jwksReads>0);
  }finally{
    if(ctx)await ctx.close();await browser.close();
    await new Promise(r=>server.close(r));globalThis.fetch=previous;
  }
}
