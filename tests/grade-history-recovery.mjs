import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {webcrypto} from 'node:crypto';
import vm from 'node:vm';
const root=process.env.CARDRESELL_TEST_ROOT||resolve(new URL('..',import.meta.url).pathname);
const {harness}=await import(pathToFileURL(root+'/tests/_assert.mjs'));
const t=harness('grade-history-recovery');
const source=readFileSync(root+'/js/grade-history.js','utf8');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const settle=p=>Promise.race([p.then(value=>({value}),error=>({error:error.message})),wait(100).then(()=>({hung:true}))]);
function fixture(){
 const calls=[],c={TextEncoder,crypto:webcrypto,AbortController,console,setInterval:()=>0,clearTimeout,
  setTimeout:(fn,ms)=>setTimeout(fn,ms===15000?20:ms),document:{getElementById:()=>null},
  googleUser:{sub:'alice'},_googleIdToken:'expired',_fbAuth:{currentUser:{uid:'alice',getIdToken:async force=>{c.refreshed=force;return 'fresh'}}},
  fetch:async(url,options)=>{calls.push({url,...options});return {ok:true,status:200,json:async()=>({ok:true})}}};
 c.window=c;vm.createContext(c);vm.runInContext(source,c);return {c,calls};
}
const data={analysis_id:'same-analysis',card_name:'Fixture',psa_estimate:8};
{
 const {c,calls}=fixture();await c.saveAiGradeReport(data,'first','alice');
 t.check('saving refreshes the Firebase token',c.refreshed===true&&calls[0]?.headers.Authorization==='Bearer fresh');
 await c.saveAiGradeReport(data,'second','alice');
 t.check('retry retains one report ID for the same analysis',JSON.parse(calls[0].body).id===JSON.parse(calls[1].body).id);
}
for(const phase of ['token','headers','body']){
 const {c,calls}=fixture();let release;
 if(phase==='token')c._fbAuth.currentUser.getIdToken=()=>new Promise(r=>release=r);
 else if(phase==='headers')c.fetch=async(url,options)=>{calls.push({url,...options});return new Promise(r=>release=()=>r({ok:true,json:async()=>({ok:true})}))};
 else c.fetch=async(url,options)=>{calls.push({url,...options});return {ok:true,json:()=>new Promise(r=>release=()=>r({ok:true}))}};
 const answer=await settle(c.saveAiGradeReport(data,'report','alice'));
 t.check(phase+' deadline returns a recoverable error',!answer.hung&&/timed out|interrupted/i.test(answer.error||''));
 release?.(phase==='token'?'fresh':undefined);await wait(5);
 t.check(phase+' late completion cannot turn timeout into success',!!answer.error&&(phase!=='token'||calls.length===0));
}
{
 const {c,calls}=fixture();let release;c._fbAuth.currentUser.getIdToken=()=>new Promise(r=>release=r);
 const pending=c.saveAiGradeReport({card_name:'Fixture',psa_estimate:8},'report','alice');
 await wait(5);c.googleUser={sub:'bob'};c._fbAuth.currentUser={uid:'bob',getIdToken:async()=> 'bob-token'};release?.('fresh');
 const answer=await settle(pending);
 t.check('account change during refresh sends no request',calls.length===0&&/account changed/i.test(answer.error||''));
}
{
 const {c,calls}=fixture();c._fbAuth.currentUser={uid:'bob',getIdToken:async()=> 'bob-token'};
 const answer=await settle(c.saveAiGradeReport(data,'report','alice'));
 t.check('a mismatched Firebase account cannot receive the previous account report',calls.length===0&&/account changed/i.test(answer.error||''));
}
{
 const {c,calls}=fixture();let release;c.fetch=async(url,options)=>{calls.push({url,...options});return {ok:true,json:()=>new Promise(r=>release=r)}};
 const pending=c.saveAiGradeReport({card_name:'Fixture',psa_estimate:8},'report','alice');await wait(5);
 c.googleUser={sub:'bob'};c._fbAuth.currentUser={uid:'bob'};release?.({ok:true});
 const answer=await settle(pending);t.check('old account reply cannot confirm a save for the new account',/account changed/i.test(answer.error||''));
}
{
 const {c,calls}=fixture();delete c._fbAuth;c._googleIdToken='legacy-token';await c.saveAiGradeReport(data,'report','alice');
 t.check('legacy signed-in token remains supported',calls[0]?.headers.Authorization==='Bearer legacy-token');
 c.googleUser=null;const answer=await settle(c.saveAiGradeReport(data,'report','alice'));
 t.check('signed-out save is rejected before a request',calls.length===1&&!!answer.error);
}
t.done();
