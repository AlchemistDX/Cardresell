// Actual isolated Redis/Lua proof-state checks, followed by native local-browser
// acceptance. Offline SDK/JWKS fixtures are NOT managed normal-auth evidence.
import { harness } from './_assert.mjs';
import { redisStore, redisRest } from './_idRedis.mjs';
import * as stage from '../api/_previewIdStage2.js';
import * as loss from '../api/_previewIdStage2Loss.js';
import { idBilling, candidateHash } from '../api/_idBilling.js';
import { stage2WorkerPageCheck } from './_stage2WorkerPageCheck.mjs';
import workerRoute, { STAGE2_WORKER_PATH } from '../api/preview-id-authenticated-worker.js';
const { check, done } = harness('preview-id-authenticated-worker');
process.env.VERCEL_ENV='preview';
process.env.VERCEL_GIT_COMMIT_REF=stage.STAGE2_BRANCH;
process.env.KV_REST_API_URL='https://prepared-offline.upstash.io';
process.env.KV_REST_API_TOKEN='synthetic-not-credential';
let store=redisStore(),commands=[],beforeTransition;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init={})=>{
 if(String(input)!==process.env.KV_REST_API_URL)throw Error('offline-network-denied');
 const a=JSON.parse(init.body);
 if(a[0]==='EVAL'&&a[1]===loss.STAGE2_LOSS_TRANSITION&&beforeTransition){
  const callback=beforeTransition;beforeTransition=null;await callback();
 }
 return redisRest(input,init,commands);
};
const user={uid:'prepared-local-account',email:'prepared@example.test',emailVerified:true};
let s;
const body=()=>({confirmation_id:s.fixtures[2].receipt,scan_id:s.fixtures[2].scan,
 candidate_set:s.confirmation.candidate_set,mode:'identify',candidate:stage.stage2Candidates()[6]});
const input=(action,extra={})=>({action,clientId:'local-iframe-client',...extra});
const action=(a,b={})=>loss.stage2LossAction(s,a,input(a,b));
const fails=async f=>{try{await f();return false}catch(_){return true}};
async function accept(index=s.phase){
 const f=s.fixtures[index];
 return idBilling('accept',{...f,owner:s.owner,mode:'identify',stamp:s.stamp,grant:5,
  candidate_set:s.confirmation.candidate_set,candidate:candidateHash(stage.stage2Candidates()[6])});
}
async function prepare(){
 store=redisStore();commands=[];
 s=await stage.stage2Bind(user);
 s=await stage.stage2Next(s);s=await stage.stage2Next(s);await accept();
 s=await stage.stage2Next(s);
}
try{
 process.env.VERCEL_URL='worker-offline.vercel.app';
 const route=(change={})=>{
  const result={headers:{},status:0,body:''};
  workerRoute({method:'GET',url:STAGE2_WORKER_PATH,query:{},
   headers:{host:process.env.VERCEL_URL},...change},{
   setHeader:(k,v)=>result.headers[k]=v,status(n){result.status=n;return this},
   send(body){result.body=body;return this}});
  return result;
 };
 const validWorker=route();
 check('worker GET serves only fixed narrow-scope script without KV operations',validWorker.status===200
  &&validWorker.headers['Service-Worker-Allowed']===stage.STAGE2_PATH&&commands.length===0);
 for(const [name,change] of [
  ['query',{url:STAGE2_WORKER_PATH+'?wrong=1'}],
  ['path-prefix',{url:STAGE2_WORKER_PATH+'-other'}],
  ['host',{headers:{host:'other.vercel.app'}}],
  ['method',{method:'POST',headers:{host:process.env.VERCEL_URL,origin:'https://'+process.env.VERCEL_URL}}],
 ]){
  const r=route(change);check('worker rejects '+name+' without configuration disclosure',r.status===404
   &&r.body==='Protected worker unavailable'&&commands.length===0);
 }
 process.env.VERCEL_ENV='production';
 check('worker fails closed outside Preview without any KV operation',route().status===404&&commands.length===0);
 process.env.VERCEL_ENV='preview';
 await prepare();
 check('fixed third phase is pending free1 paid1',(await stage.stage2Observation(s)).free===1&&s.phase===2);
 check('wrong phase cannot arm',await fails(()=>loss.stage2LossAction({...s,phase:1},'loss-arm',input('loss-arm'))));
 check('arbitrary fields refused',await fails(()=>action('loss-arm',{key:'arbitrary'})));
 let armed=await action('loss-arm');
 check('arm records only server fixture and bound client',armed.binding.receipt===s.fixtures[2].receipt
  &&armed.binding.clientId==='local-iframe-client'&&!armed.durableClaimConsumed);
 check('second arm never resets consumed control',await fails(()=>action('loss-arm')));
 check('wrong client cannot claim',await fails(()=>action('loss-claim',{clientId:'another-client',requestBody:JSON.stringify(body())})));
 check('altered candidate cannot claim',await fails(()=>action('loss-claim',
  {requestBody:JSON.stringify({...body(),candidate:{...body().candidate,set:'altered'}})})));
 const requestBody=JSON.stringify(body());
 const claims=await Promise.allSettled([action('loss-claim',{requestBody}),action('loss-claim',{requestBody})]);
 check('concurrent exact native Lua claims consume once',claims.filter(x=>x.status==='fulfilled').length===1);
 check('claim alone does not debit or prove commit',(await stage.stage2Observation(s)).free===1
  &&!(await loss.stage2LossStatus(s)).commitCorroborated);
 check('premature commit cannot manufacture billing success',await fails(()=>action('loss-commit',{requestBody,responseBody:'{}'})));
 const result=await accept();
 check('real unchanged billing module accepts after claim',result.ok&&result.bucket==='id_free');
 check('wrong response rejected despite accepted journal',await fails(()=>action('loss-commit',{requestBody,responseBody:'{}'})));
 const proof=await action('loss-commit',{requestBody,responseBody:JSON.stringify(result)});
 check('commit proof corroborates exact result and observed free-first balance',proof.commitCorroborated&&!proof.matchingRetryCorroborated);
 check('response observation is not falsely labeled suppression delivery',proof.responseSuppressionDelivery==='NOT_OBSERVED_BY_SERVER');
 const replay=await accept();
 check('retry same billing receipt returns recorded result',JSON.stringify(replay)===JSON.stringify(result));
 const retry=await action('loss-retry',{requestBody,responseBody:JSON.stringify(replay)});
 check('matching retry corroboration advances once',retry.matchingRetryCorroborated
  &&await fails(()=>action('loss-retry',{requestBody,responseBody:JSON.stringify(replay)})));
 check('one charge only through proof/replay sequence',(await stage.stage2Observation(s)).free===0
  &&(await stage.stage2Observation(s)).paid===1);
 const disarmed=await loss.stage2LossDisarm(s);
 check('durable disarm retains previous evidence',disarmed.disarmed&&disarmed.matchingRetryCorroborated);
 check('disarmed control cannot rearm or reclaim',await fails(()=>action('loss-arm'))
  &&await fails(()=>action('loss-claim',{requestBody})));
 check('sequential disarm is idempotent',(await loss.stage2LossDisarm(s)).disarmed);
 await prepare();await action('loss-arm');
 const restarted=await import('../api/_previewIdStage2Loss.js?restart');
 check('fresh helper process state cannot rearm existing durable record',await fails(()=>
  restarted.stage2LossAction(s,'loss-arm',input('loss-arm'))));
 const raceBody=JSON.stringify(body());
 beforeTransition=async()=>{await accept()};
 check('accept between claim snapshot and EVAL rejects stale claim',await fails(()=>action('loss-claim',{requestBody:raceBody}))
  &&(await loss.stage2LossStatus(s)).state==='armed'&&(await stage.stage2Observation(s)).free===0);
 await prepare();await action('loss-arm');
 const unknown=await action('loss-unknown',{requestBody:JSON.stringify(body()),category:'claim_unavailable'});
 check('unknown outcome is never a fabricated commit/claim pass',unknown.state==='unknown'
  &&!unknown.commitCorroborated&&!unknown.durableClaimConsumed);
 check('unknown cannot be silently rearmed',await fails(()=>action('loss-arm')));
 await prepare();
 check('cleanup disarms even never-armed run',(await loss.stage2LossDisarm(s)).disarmed
  &&await fails(()=>action('loss-arm')));
 const now=Date.now;Date.now=()=>stage.STAGE2_END+1;
 check('expired cannot arm',await fails(()=>action('loss-arm')));
 Date.now=now;
 check('durable record contains no authorization header or configured token',
  !store.get(loss.STAGE2_LOSS_CONTROL).includes('synthetic-not-credential')
  &&!store.get(loss.STAGE2_LOSS_CONTROL).includes('Authorization'));
 await stage2WorkerPageCheck({check,reset:()=>{store=redisStore();commands=[]},getStore:()=>store});
}finally{globalThis.fetch=originalFetch}
done();
