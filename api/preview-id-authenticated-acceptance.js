// Temporary protected normal-auth confirmation acceptance. Synthetic offer, NOT
// live initial scan/vision. All identities come from normal Firebase verification.
import { randomBytes } from 'node:crypto';
import { stage2VerifiedIdentity, stage2MatchBrowserIdentity } from './_previewIdStage2Auth.js';
import { stage2LossAction, stage2LossStatus, stage2LossDisarm } from './_previewIdStage2Loss.js';
import { STAGE2_PATH, STAGE2_CONTROL, STAGE2_END, STAGE2_RECOVERY_END,
  stage2Guard, stage2State, stage2Bind, stage2Next, stage2Payload, stage2Observation,
  stage2Cleanup, stage2KV, stage2Keys, STAGE2_DEPLETE, Stage2Error } from './_previewIdStage2.js';
export const config = { maxDuration: 60 };

const escape = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function stage2Html(nonce, host) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Protected authenticated confirmation acceptance</title>
<style nonce="${nonce}">body{font:16px system-ui;max-width:1000px;margin:auto;padding:20px;background:#111827;color:#f3f4f6}button,a{margin:5px;padding:10px;color:inherit}button{background:#334155;border:1px solid #94a3b8;border-radius:5px}a{display:inline-block}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#1f2937;padding:14px}iframe{width:100%;height:85vh;max-height:760px;border:1px solid #64748b}label{display:block;margin:15px 0}</style>
<h1>Authenticated confirmation acceptance</h1>
<p>Normal Firebase sign-in; deterministic synthetic offer; unchanged shipped picker and acceptance handler. Not live scan accuracy or physical Safari proof.</p>
<p>Execution ends September 18, 2026, 8:00 PM EDT (September 19, 00:00 UTC). Recovery ends September 23, 2026, 2:00 PM EDT (18:00 UTC). Never reuse your ordinary account. No purchases, grading, collection, drafts or referral actions.</p>
<a href="/signin?next=${STAGE2_PATH}">Sign in normally with the dedicated test account</a>
<p id="account">Checking dedicated account with the server…</p><button id="signout">Sign out and use dedicated test account</button>
<label><input type="checkbox" id="attest"> I confirm this is a fresh dedicated test account in the isolated Preview.</label>
<button id="bind" disabled>Bind account once</button><button id="next">Start next fixed phase</button>
<button id="show">Show current offer again</button><button id="duplicate">Send six same-selection duplicates</button>
<button id="armLoss">Arm response suppression once (phase 3 only)</button>
<button id="deplete">Deplete final rejection fixture</button><button id="status">Read observations</button>
<button id="cleanup">Finish and clean up</button><button id="copy">Copy observations</button><button id="download">Download observations</button>
<p>Phases: 1 cancel; 2 choose Synthetic Set 7, then duplicates; 3 click Arm response suppression once, choose Set 7, wait for the real Retry button, then click Retry and Read observations; 4 deplete then choose Set 7 and verify rejection. This is browser-network response suppression after a corroborated server response, not physical packet loss. Phase 3 acceptance alone is not proof. Read/copy observations before advancing. Cleanup retains four terminal journals, consumed setup and loss guards; credit fixtures are removed.</p>
<iframe id="app" title="Unchanged CardResell picker with normal authentication"></iframe><pre id="output">No test executed. GET does not claim or seed anything.</pre>
<script nonce="${nonce}">
const app=document.getElementById('app'), out=document.getElementById('output');
let payload=null;
let confirmedIdentity=null,authGeneration=0,checkingAuth=false,lastAuthFingerprint='',lastAuthCheck=0,bindAvailable=false,lastSDKUser=null,signedOutSDKUser=null;
const authMessage='Sign out and use dedicated test account';
function browserIdentity(){
 const u=app.contentWindow._fbAuth?.currentUser;
 if(!u||u===signedOutSDKUser||u.isAnonymous!==false||u.emailVerified!==true||typeof u.uid!=='string'||!u.uid.trim()
   ||typeof u.email!=='string'||!u.email.includes('@')||!Array.isArray(u.providerData))throw Error('normal_signin_required');
 const providers=[...new Set(u.providerData.map(p=>p.providerId))].sort();
 if(!providers.length||providers.some(p=>!['password','google.com','apple.com'].includes(p)))throw Error('normal_signin_required');
 return {uid:u.uid,email:u.email,providers};
}
function invalidateAuth(){confirmedIdentity=null;bindAvailable=false;document.getElementById('bind').disabled=true;document.getElementById('account').textContent=authMessage}
async function preflight(force=false){
 if(checkingAuth&&!force)return;
 const generation=++authGeneration;checkingAuth=true;invalidateAuth();
 try{
  const identity=browserIdentity(),fingerprint=JSON.stringify(identity),sdkUser=app.contentWindow._fbAuth.currentUser;
  lastAuthFingerprint=fingerprint;
  const token=await app.contentWindow._fbAuth.currentUser.getIdToken(true);
  const r=await fetch('${STAGE2_PATH}',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},
   body:JSON.stringify({action:'preflight',identity}),signal:AbortSignal.timeout(12000)});
  const d=await r.json();
  if(generation!==authGeneration)return;
  if(!r.ok||!d.ok||d.identity?.uid!==identity.uid||d.identity?.email!==identity.email
    ||!identity.providers.includes(d.identity?.provider)||app.contentWindow._fbAuth.currentUser!==sdkUser
    ||JSON.stringify(browserIdentity())!==fingerprint)throw Error('identity_mismatch');
  confirmedIdentity=identity;lastAuthFingerprint=fingerprint;bindAvailable=d.setup==='NOT_BOUND'&&d.canBind===true;
  document.getElementById('account').textContent='Server confirmed dedicated sign-in as '+d.identity.email+'. Confirm this is the dedicated account before binding.';
  document.getElementById('bind').disabled=!bindAvailable||!document.getElementById('attest').checked;
 }catch(_){if(generation===authGeneration)invalidateAuth()}
 finally{if(generation===authGeneration){checkingAuth=false;lastAuthCheck=Date.now()}}
}
document.getElementById('attest').onchange=()=>{document.getElementById('bind').disabled=!confirmedIdentity||!bindAvailable||!document.getElementById('attest').checked};
document.getElementById('signout').onclick=async()=>{
 signedOutSDKUser=app.contentWindow._fbAuth?.currentUser;
 ++authGeneration;checkingAuth=false;lastAuthFingerprint='';invalidateAuth();
 try{await app.contentWindow._fbSignOut()}catch(_){}
 invalidateAuth();
};
let browserLossPhase='NOT_ARMED',browserRetryClicks=0;
const workerPath='/api/preview-id-authenticated-worker',workerScope='${STAGE2_PATH}';
const bounded=p=>Promise.race([p,new Promise((_,reject)=>setTimeout(()=>reject(Error('worker_timeout')),12000))]);
function workerMessage(worker,message){return bounded(new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);worker.postMessage(message,[c.port2])}))}
async function disarmBrowserWorker(){
 const reg=await navigator.serviceWorker?.getRegistration(workerScope);
 if(!reg||reg.scope!==location.origin+workerScope)return {state:'NOT_REGISTERED'};
 const worker=reg.active||reg.waiting;
 if(!worker||worker.scriptURL!==location.origin+workerPath)throw Error('worker_mismatch');
 const reply=await workerMessage(worker,{type:'stage2-loss-disarm'});
 if(!reply.ok||reply.state!=='disarmed')throw Error('worker_disarm_failed');
 const unregistered=await reg.unregister();
 if(!unregistered)throw Error('worker_unregister_failed');
 browserLossPhase='DISARMED';
 return {state:'DISARMED',registrationRemoved:true,retainedLocalGuard:true};
}
addEventListener('message',e=>{
 if(e.source!==app.contentWindow||!(e.origin===location.origin
   ||(e.origin==='null'&&app.contentDocument?.URL==='about:srcdoc')))return;
 if(e.data?.type==='stage2-loss-view'&&['UNKNOWN','RESPONSE_SUPPRESSION_SCHEDULED','MATCHING_RETRY_RESPONSE_OBSERVED'].includes(e.data.phase))browserLossPhase=e.data.phase;
 if(e.data?.type==='stage2-loss-retry-click')browserRetryClicks++;
});
// Only explicit non-credential app keys; never enumerate/read Firebase storage.
const localKeys=['cr:lastCard:v1:ident','lastAuthUid'],sessionKeys=['verifyBannerDismissed','_pendingUpgradeTier'];
const baselineKey='preview_stage2_browser_baseline_v1';
let localBaseline=localKeys.map(k=>[k,localStorage.getItem(k)]),sessionBaseline=sessionKeys.map(k=>[k,sessionStorage.getItem(k)]);
try{const old=JSON.parse(sessionStorage.getItem(baselineKey)||'null');const valid=(a,keys)=>Array.isArray(a)&&a.length===keys.length&&a.every((x,i)=>Array.isArray(x)&&x[0]===keys[i]&&(x[1]===null||typeof x[1]==='string'));if(old&&valid(old.local,localKeys)&&valid(old.session,sessionKeys)){localBaseline=old.local;sessionBaseline=old.session}}catch(_){}
function restoreBrowserBaseline(){for(const [k,v] of localBaseline)v===null?localStorage.removeItem(k):localStorage.setItem(k,v);for(const [k,v] of sessionBaseline)v===null?sessionStorage.removeItem(k):sessionStorage.setItem(k,v);sessionStorage.removeItem(baselineKey)}
function display(value){out.textContent=JSON.stringify(value,null,2)}
function clientObservation(){
 const w=app.contentWindow,d=w.document;
 let persisted=null;try{const p=JSON.parse(w.localStorage.getItem('cr:lastCard:v1:ident')||'null');persisted=p?true:false}catch(_){}
 return {scope:'browser observation, not automated acceptance verdict',browserLossPhase,browserRetryClicks,pendingIdentity:!!w._pendingIdScanCard,
 persistedIdentity:persisted,successVisible:!!d.getElementById('scanSuccessBadge')&&d.getElementById('scanSuccessBadge').style.display!=='none',
 selectedSeventhDisplayed:(d.getElementById('scanStatus')?.textContent||'').includes('Synthetic Set 7')||(d.getElementById('cardMetaEl')?.textContent||'').includes('Synthetic Set 7'),
 seventhVisible:(d.getElementById('cardMetaEl')?.textContent||'').includes('Synthetic Set 7')};
}
async function session(){const u=app.contentWindow._fbAuth?.currentUser;if(!u)throw Error('normal_signin_required');return u.getIdToken()}
async function request(action,extra={}){
 if(action==='bind'){await preflight(true);if(!confirmedIdentity)throw Error('normal_signin_required')}
 if(action==='bind')sessionStorage.setItem(baselineKey,JSON.stringify({local:localBaseline,session:sessionBaseline}));
 if(action==='cleanup'&&app.contentWindow._scanCandidateDebitPending)throw Error('wait_for_pending_request');
 const body=action==='bind'?{action,attest:document.getElementById('attest').checked,identity:confirmedIdentity}:{action,...extra};
 const r=await fetch('${STAGE2_PATH}',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+await session()},body:JSON.stringify(body)});
 const d=await r.json();const {payload:offered,binding,...observed}=d;display({server:observed,client:clientObservation()});
 if(!r.ok)throw Error(d.error||'request_failed');if(offered)payload=offered;return d;
}
function show(){if(!payload)throw Error('read_current_offer_first');const w=app.contentWindow;
 w.localStorage.removeItem('cr:lastCard:v1:ident');
 w.document.getElementById('scanOverlay').style.display='flex';
 w._renderIdentityConfirmation(payload,w.document.getElementById('scanStatus'),w.document.getElementById('scanResult'),null);app.scrollIntoView({block:'start'})}
for(const action of ['bind','next','deplete','status','cleanup'])document.getElementById(action).onclick=async()=>{
 try{const d=await request(action);if(action==='next')show();
 if(action==='cleanup'){const worker=await disarmBrowserWorker();display({server:d,worker,client:clientObservation()});payload=null;app.onload=()=>{restoreBrowserBaseline();app.onload=null};app.srcdoc='<p>Test finished. Terminal and worker disarm guards retained.</p>'}}
 catch(e){if(!out.textContent.includes('"error"'))display({error:['normal_signin_required','read_current_offer_first'].includes(e.message)?e.message:'request_failed'})}
};
document.getElementById('show').onclick=async()=>{try{await request('status');show()}catch(_){display({error:'offer_unavailable'})}};
document.getElementById('duplicate').onclick=async()=>{try{
 if(!payload)throw Error('no_offer');const t=await session();const body={confirmation_id:payload.confirmation_id,scan_id:payload.scan_id,candidate_set:payload.candidate_set,mode:'identify',candidate:payload.identity_resolution.all_candidates[6]};
 const r=await Promise.all(Array.from({length:6},()=>fetch('/api/scan-debit-id',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify(body)})));
 display({duplicateResponses:r.length,statuses:r.map(x=>x.status),note:'Read server observations to verify one accepted journal and debit.'});
}catch(_){display({error:'duplicate_request_failed'})}};
document.getElementById('copy').onclick=()=>navigator.clipboard.writeText(out.textContent);
document.getElementById('download').onclick=()=>{const u=URL.createObjectURL(new Blob([out.textContent],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download='authenticated-confirmation-observations.json';a.click();setTimeout(()=>URL.revokeObjectURL(u),1000)};
// Use the exact shipped HTML/bundles and normal Firebase persistence. This
// connect-src restriction only prevents unrelated price/data side effects;
// the SERVER policy independently prevents every Stripe fallback.
async function loadApp(){
 const html=await fetch('/').then(r=>r.text());
 const policy="connect-src https://${host}${STAGE2_PATH} https://${host}/api/scan-debit-id https://${host}/api/pro-status https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com";
 const loaded=new Promise(resolve=>app.onload=resolve);
 app.srcdoc=html.replace(/<head[^>]*>/i,m=>m+'<base href="https://${host}/"><meta http-equiv="Content-Security-Policy" content="'+policy+'">');
 await bounded(loaded);app.onload=null;
 const script=app.contentDocument.createElement('script');
 script.textContent="window._stage2WorkerMessage=(message)=>new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.controller.postMessage(message,[c.port2])});navigator.serviceWorker?.addEventListener('message',e=>{if(e.source===navigator.serviceWorker.controller&&e.data?.type==='stage2-loss-observation')parent.postMessage({type:'stage2-loss-view',phase:e.data.phase},parent.location.origin)});document.addEventListener('click',e=>{if(e.target.closest('[data-testid=identity-retry]'))parent.postMessage({type:'stage2-loss-retry-click'},parent.location.origin)},true)";
 app.contentDocument.head.appendChild(script);
}
loadApp().catch(()=>display({error:'app_unavailable'}));
document.getElementById('armLoss').onclick=async()=>{
 try{
  if(app.contentWindow._scanCandidateDebitPending)throw Error('pending');
  const current=await request('status');
  if(current.phase!==2||current.state!=='active'||current.step!=='ready')throw Error('wrong_phase');
  app.style.visibility='hidden';
  await navigator.serviceWorker.register(workerPath,{scope:workerScope,updateViaCache:'none'});
  await bounded(navigator.serviceWorker.ready);
  if(!navigator.serviceWorker.controller)await bounded(new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true})));
  const linked=await workerMessage(navigator.serviceWorker.controller,{type:'stage2-loss-parent'});
  if(!linked.ok)throw Error('worker_link_failed');
  await loadApp();
  const deadline=Date.now()+12000;
  while(!app.contentWindow._fbAuth?.currentUser&&Date.now()<deadline)await new Promise(r=>setTimeout(r,50));
  const hello=await bounded(app.contentWindow._stage2WorkerMessage({type:'stage2-loss-hello',challenge:linked.challenge}));
  if(!hello.ok||!hello.nested)throw Error('iframe_not_controlled');
  const armed=await request('loss-arm',{clientId:hello.clientId});
  const ack=await bounded(app.contentWindow._stage2WorkerMessage({type:'stage2-loss-arm',binding:armed.binding}));
  if(!ack.ok)throw Error('worker_arm_failed');
  browserLossPhase='ARMED';show();await request('status');
 }catch(_){
  browserLossPhase='UNKNOWN';
  try{await request('loss-disarm');await disarmBrowserWorker()}catch(_){}
  display({error:'response_suppression_unavailable',browserLossPhase,note:'Do not rearm or infer a pass. Read observations and clean up.'});
 }finally{app.style.visibility='visible'}
};
setInterval(()=>{
 const sdkUser=app.contentWindow._fbAuth?.currentUser;
 if(sdkUser!==lastSDKUser){lastSDKUser=sdkUser;lastAuthFingerprint='';++authGeneration;checkingAuth=false;invalidateAuth()}
 let fingerprint='';try{fingerprint=JSON.stringify(browserIdentity())}catch(_){}
 if(!fingerprint){++authGeneration;checkingAuth=false;lastAuthFingerprint='';invalidateAuth();return}
 if(!checkingAuth&&(fingerprint!==lastAuthFingerprint||Date.now()-lastAuthCheck>30000))preflight();
},500);
</script></html>`;
}
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try {
    stage2Guard(req, STAGE2_PATH, true);
    if (req.method === 'GET') {
      const nonce = randomBytes(16).toString('hex');
      // srcdoc inherits this policy. The unchanged application uses inline
      // event handlers, so nonce-only would disable the real picker. No user
      // content is interpolated; the stricter child connect-src is additive.
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self' 'unsafe-inline' https://www.gstatic.com https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob: https:; connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com; frame-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; worker-src 'self'");
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(200).send(stage2Html(nonce, process.env.VERCEL_URL));
    }
    if (req.method !== 'POST') throw new Stage2Error('method_guard');
    const body = req.body;
    const lossFields = {
      'loss-arm': ['clientId'], 'loss-claim': ['clientId','requestBody'],
      'loss-commit': ['clientId','requestBody','responseBody'],
      'loss-retry': ['clientId','requestBody','responseBody'],
      'loss-unknown': ['clientId','requestBody','category'],
    };
    if (!body || typeof body !== 'object' || Array.isArray(body)
        || !['preflight', 'bind', 'next', 'status', 'deplete', 'cleanup', 'loss-disarm', ...Object.keys(lossFields)].includes(body.action)
        || Object.keys(body).some(k => !['action', ...(body.action === 'bind' ? ['attest','identity'] : body.action === 'preflight' ? ['identity'] : lossFields[body.action] || [])].includes(k))
        || (body.action === 'bind' && body.attest !== true)) throw new Stage2Error('input_guard');
    if (!['preflight', 'status', 'cleanup', 'loss-disarm'].includes(body.action) && Date.now() >= STAGE2_END) throw new Stage2Error('expired');
    const user = await stage2VerifiedIdentity((req.headers.authorization || '').replace('Bearer ', '').trim());
    if (['preflight','bind'].includes(body.action)) {
      const identity = stage2MatchBrowserIdentity(user, body.identity);
      if (body.action === 'preflight') {
        const existing = await stage2State();
        return res.status(200).json({ ok: true, identity, canBind: !existing && Date.now() < STAGE2_END,
          setup: !existing ? 'NOT_BOUND' : existing.owner === user.uid ? 'BOUND_TO_THIS_ACCOUNT' : 'BOUND_TO_OTHER_ACCOUNT' });
      }
    }
    let s = await stage2State();
    if (s && s.owner !== user.uid) throw new Stage2Error('owner_guard');
    if (body.action === 'bind') s = await stage2Bind(user);
    if (!s) throw new Stage2Error('setup_required');
    if (lossFields[body.action]) {
      const result = await stage2LossAction(s, body.action, body);
      const { binding, ...loss } = result;
      return res.status(200).json({ ok: true, loss, ...(binding ? { binding } : {}) });
    }
    if (body.action === 'loss-disarm') return res.status(200).json({ ok: true, loss: await stage2LossDisarm(s) });
    if (body.action === 'next') s = await stage2Next(s);
    if (body.action === 'deplete') {
      if (s.state !== 'active' || s.phase !== 3 || s.step !== 'ready') throw new Stage2Error('phase_guard');
      if (await stage2KV('EVAL', STAGE2_DEPLETE, 4, STAGE2_CONTROL, ...stage2Keys(s),
        `id_billing:${s.fixtures[s.phase].receipt}`, JSON.stringify(s)) !== 1)
        throw new Stage2Error('state_conflict');
    }
    if (body.action === 'cleanup') s = await stage2Cleanup(s);
    const observation = s.state === 'closed' ? s.finalObservation : s.step === 'ready' ? await stage2Observation(s) : null;
    const remaining = s.state === 'closed' ? await stage2KV('EXISTS', ...stage2Keys(s)) : null;
    return res.status(200).json({ ok: true, scope: 'normal-auth synthetic-offer confirmation; not live scan',
      state: s.state, phase: s.phase, step: s.step, observation, priorObservations: s.observations || [],
      loss: await stage2LossStatus(s),
      cleanup: s.state === 'closed' ? { financialKeysRemaining: remaining, terminalJournalGuardsRetained: 4,
        controlRetained: true, lossDisarmGuardRetained: true, mappingUntouched: true } : null,
      ...(s.state === 'active' && s.step === 'ready' ? { payload: stage2Payload(s) } : {}) });
  } catch (e) {
    // No raw provider/JWT/transport error, account detail or configuration value.
    const code = e instanceof Stage2Error ? e.code : 'authentication_or_state_unavailable';
    if (req.method === 'GET') {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(404).send(`<h1>Protected acceptance unavailable</h1><p>${escape(code)}</p>`);
    }
    return res.status(409).json({ ok: false, error: code });
  }
}
