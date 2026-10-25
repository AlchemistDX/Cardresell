// Execute the actual Firebase adapter with a controlled SDK and task queue.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {harness} from './_assert.mjs';
const root=process.env.CARDRESELL_TEST_ROOT||resolve(new URL('..',import.meta.url).pathname);
const html=readFileSync(root+'/index.html','utf8');
let source=readFileSync(root+'/'+html.match(/js\/auth\.[a-f0-9]{8}\.js/)[0],'utf8');
for(const node of parse(source,{ecmaVersion:'latest',sourceType:'module'}).body.filter(n=>n.type==='ImportDeclaration').reverse())source=source.slice(0,node.start)+source.slice(node.end);
const t=harness('auth-session-lifecycle');
const manualCode=['core','ui'].map(name=>{
 const code=readFileSync(root+'/'+html.match(new RegExp('js/'+name+'\\.[a-f0-9]{8}\\.js'))[0],'utf8');
 const names=['_crIdToken','_verifySendCode','_verifyConfirmCode','_verifyFirebaseLinkDone','doAuthCheckVerified','doAuthResendVerification'];
 return parse(code,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>code.slice(n.start,n.end)).join('\n');
}).join('\n');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture(){
 const events=[],intervals=new Map(),timeouts=new Map(),elements=new Map();let id=0,listener;
 const el=()=>({style:{},classList:{contains:()=>false},textContent:'',remove(){events.push(['remove']);}});
 for(const name of ['googleSignInBtn','googleUserBtn','verifyEmailModal','emailVerifyBanner'])elements.set(name,el());
 const storage=()=>{const map=new Map();return {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};};
 const auth={currentUser:null};
 const c={console,URLSearchParams,AbortController,AbortSignal,location:{search:'',reload(){}},
  initializeApp:()=>({}),initializeAuth:()=>auth,onAuthStateChanged:(_a,fn)=>{listener=fn;},
  fbSignOut:async()=>{},GoogleAuthProvider:class{},signInWithPopup:async()=>{},createUserWithEmailAndPassword:async()=>{},signInWithEmailAndPassword:async()=>{},sendPasswordResetEmail:async()=>{},sendEmailVerification:async()=>{},
  indexedDBLocalPersistence:{},browserLocalPersistence:{},browserSessionPersistence:{},browserPopupRedirectResolver:{},
  document:{getElementById:name=>elements.get(name)||null,createElement:el,body:{appendChild(){}}},
  localStorage:storage(),sessionStorage:storage(),
  setInterval:(fn,ms)=>{intervals.set(++id,{fn,ms});return id;},clearInterval:key=>intervals.delete(key),
  setTimeout:(fn,ms)=>{timeouts.set(++id,{fn,ms});return id;},clearTimeout:key=>timeouts.delete(key),
  applyGoogleUser:()=>events.push(['apply',c.googleUser?.uid,c._googleIdToken]),
  loadUserData:()=>events.push(['load',c.googleUser?.uid,c._googleIdToken]),
  checkProStatus:()=>events.push(['status',c.googleUser?.uid,c._googleIdToken]),
  closeAuthModal:()=>events.push(['close']),loadSettingsScanCredits:()=>{},
  _migrateAnonDataToUser:()=>events.push(['migrate']),_fbErrMsg:e=>e.code||e.message,
  _tsGetToken:()=>'',_tsReset:()=>{},
  showToast:message=>events.push(['toast',message]),
  fetch:async(url,options)=>{events.push(['fetch',url,options?.headers?.Authorization]);return {ok:true,json:async()=>({ok:true,bonusGranted:true})};},
  _updateVerifyBanner:()=>{},updateProUI:()=>{},updateScanBtnCredits:()=>{},
  _maybeRerenderCollection:()=>events.push(['collection',c.googleUser?.uid||null]),
  _cancelUserDataSync:()=>events.push(['cancel-sync']),resetMembershipAccountSetup:()=>{},
  ensureMembershipAccount:async()=>events.push(['membership',c.googleUser?.uid]),
 };
 c.window=c;vm.createContext(c);vm.runInContext(source+'\n'+manualCode,c);
 const user=(uid,verified=true)=>({uid,email:uid+'@example.invalid',emailVerified:verified,providerData:[{providerId:'password'}],getIdToken:async()=>uid+'-token',reload:async()=>{}});
 const emit=(u,{change=true}={})=>{if(change)auth.currentUser=u;return listener(u);};
 const timer=ms=>[...intervals.entries()].find(([,v])=>v.ms===ms);
 return {c,auth,user,emit,events,intervals,timeouts,elements,timer,el};
}
{
 const f=fixture(),a=f.user('alice');await f.emit(a);await flush();
 f.c._isPro=true;f.c._idScanCredits=71;f.c._emailVerified=true;
 await f.emit(null);await flush();
 t.check('SDK sign-out clears identity without an in-tab intent flag',f.c.googleUser===null&&f.c._fbCurrentUser===null&&f.c._googleIdToken===null);
 t.check('SDK sign-out removes prior account verification and credit state',f.c._emailVerified===false&&f.c._idScanCredits===0&&f.c._isPro===false);
 t.check('SDK sign-out removes timers and rerenders the anonymous collection',f.intervals.size===0&&f.events.some(e=>e[0]==='collection'&&e[1]===null));
}
{
 const f=fixture(),a=f.user('alice');await f.emit(a);await flush();
 await f.emit(null,{change:false});await flush();
 t.check('a stale null callback cannot erase the SDK active account',f.c.googleUser?.uid==='alice'&&f.c._googleIdToken==='alice-token');
}
{
 const f=fixture(),a=f.user('alice'),b=f.user('bob');await f.emit(a);await flush();
 const pending=deferred();b.getIdToken=()=>pending.promise;f.events.length=0;await f.emit(b);
 t.check('new account UI is never applied with the old account cached token',f.events.filter(e=>e[0]==='apply').every(e=>e[1]==='bob'&&!e[2]));
 pending.resolve('bob-token');await flush();
 t.check('new account data loads only after its own token resolves',f.events.filter(e=>e[0]==='load').every(e=>e[1]==='bob'&&e[2]==='bob-token'));
}
for(const next of ['bob',null,'alice']){
 const f=fixture(),a=f.user('alice'),pending=deferred();a.getIdToken=()=>pending.promise;
 await f.emit(a);await flush();const b=next?f.user(next):null;await f.emit(b);await flush();f.events.length=0;
 pending.resolve('old-alice-token');await flush();
 t.check('late initial token is discarded after '+String(next),f.c._googleIdToken===(b?next+'-token':null)&&!f.events.some(e=>e[0]==='load'));
}
{
 const f=fixture(),a=f.user('alice',false),initial=deferred();
 a.reload=async()=>{a.emailVerified=true;};
 a.getIdToken=force=>force?Promise.resolve('verified-alice-token'):initial.promise;
 f.c._pendingVerifiedReturn=true;await f.emit(a);await flush();
 t.check('verification return does not block the signed-in workspace',f.events.some(e=>e[0]==='apply'&&e[1]==='alice'));
 t.check('verification return stores the freshly verified token',f.c._googleIdToken==='verified-alice-token');
 initial.resolve('older-initial-token');await flush();
 t.check('late initial token cannot replace newer verification evidence',f.c._googleIdToken==='verified-alice-token'&&f.events.filter(e=>e[0]==='load').every(e=>e[2]==='verified-alice-token'));
}
{
 const f=fixture(),a=f.user('alice');await f.emit(a);await flush();
 const pending=deferred();a.getIdToken=()=>pending.promise;const old=f.timer(55*60*1000)[1].fn;old();await flush();
 await f.emit(f.user('bob'));await flush();const own=f.timer(55*60*1000)[0];pending.resolve('old-alice-token');await flush();
 t.check('late recurring refresh cannot replace the active account token',f.c._googleIdToken==='bob-token');
 t.check('retired timer cannot clear the newer account timer',f.intervals.has(own));
 let calls=0;a.getIdToken=async()=>{calls++;return 'old-again';};old();await flush();
 t.check('retired timer does not start another SDK request',calls===0&&f.c._googleIdToken==='bob-token');
}
for(const entry of ['return','poll']){
 for(const pause of ['reload','token','response']){
  const f=fixture(),a=f.user('alice',false),pending=deferred();
  if(pause==='reload')a.reload=()=>pending.promise.then(()=>{a.emailVerified=true;});
  else a.reload=async()=>{a.emailVerified=true;};
  if(pause==='token'){const initial=a.getIdToken;a.getIdToken=force=>force?pending.promise:initial();}
  if(pause==='response')f.c.fetch=async()=>({ok:true,json:()=>pending.promise});
  if(entry==='return')f.c._pendingVerifiedReturn=true;
  const run=f.emit(a);await flush();
  if(entry==='poll'){await run;f.timer(5000)[1].fn();await flush();}
  const b=f.user('bob',false);await f.emit(b);await flush();const own=f.timer(5000)?.[0];f.events.length=0;
  pending.resolve(pause==='token'?'old-alice-token':pause==='response'?{ok:true,bonusGranted:true}:undefined);await flush();
  t.check(entry+' '+pause+' completion cannot verify the new account',f.c.googleUser?.uid==='bob'&&!f.c.googleUser.emailVerified&&!f.c._emailVerified&&f.c._googleIdToken==='bob-token');
  t.check(entry+' '+pause+' completion cannot claim, notify or close the new account UI',!f.events.some(e=>['fetch','toast','close','remove','membership','load'].includes(e[0])));
  t.check(entry+' '+pause+' completion preserves the new account verification timer',!!own&&f.intervals.has(own));
 }
}
{
 const f=fixture(),a=f.user('alice',false),pending=deferred();let reloads=0;
 a.reload=()=>{reloads++;return pending.promise;};await f.emit(a);await flush();
 const tick=f.timer(5000)[1].fn;tick();tick();tick();await flush();
 t.check('slow verification checks do not overlap SDK reload requests',reloads===1);
 pending.resolve();await flush();tick();await flush();
 t.check('verification polling can check again after a slow response',reloads===2);
}
{
 const f=fixture(),a=f.user('alice');await f.emit(a);await flush();const b=f.user('bob');await f.emit(b);await flush();f.events.length=0;
 await f.emit(a,{change:false});await flush();
 t.check('stale non-null callback cannot restore a previous SDK user',f.c.googleUser?.uid==='bob'&&f.c._googleIdToken==='bob-token'&&!f.events.some(e=>e[0]==='load'));
}
for(const name of ['_verifyConfirmCode','_verifyFirebaseLinkDone','doAuthCheckVerified']){
 for(const pause of ['token','response']){
  const f=fixture(),a=f.user('alice');await f.emit(a);await flush();
  for(const id of ['verifyConfirmBtn','verifyCodeErr','verifyCodeInput','verifyLinkDoneBtn','verifyLinkErr','authVerifyCheckBtn','authVerifyError','authVerifySuccess'])f.elements.set(id,f.el());
  f.elements.get('verifyCodeInput').value='123456';f.c._verifyPendingEmail='alice@example.invalid';
  const pending=deferred();
  if(pause==='token')a.getIdToken=()=>pending.promise;
  else f.c.fetch=async()=>({ok:true,json:()=>pending.promise});
  const request=f.c[name]();await flush();
  await f.emit(f.user('bob',false));await flush();f.events.length=0;
  pending.resolve(pause==='token'?'alice-old-token':{ok:true,email:'alice@example.invalid',bonusGranted:true});await request;await flush();
  t.check(name+' '+pause+' cannot mark the next account verified',f.c.googleUser?.uid==='bob'&&!f.c.googleUser.emailVerified&&!f.c._emailVerified&&f.c._googleIdToken==='bob-token');
  t.check(name+' '+pause+' cannot notify, migrate or close the next account',!f.events.some(e=>['fetch','toast','close','remove','migrate'].includes(e[0])));
  t.check(name+' '+pause+' leaves verification buttons usable',!f.elements.get('verifyConfirmBtn').disabled&&!f.elements.get('authVerifyCheckBtn').disabled&&!f.elements.get('verifyLinkDoneBtn').disabled);
 }
 {
  const f=fixture(),a=f.user('alice');await f.emit(a);await flush();
  for(const id of ['verifyConfirmBtn','verifyCodeErr','verifyCodeInput','verifyLinkDoneBtn','verifyLinkErr','authVerifyCheckBtn','authVerifyError','authVerifySuccess'])f.elements.set(id,f.el());
  f.elements.get('verifyCodeInput').value='123456';f.c._verifyPendingEmail='alice@example.invalid';
  f.c.googleUser.emailVerified=false;f.c._emailVerified=false;f.events.length=0;
  await f.c[name]();await flush();
  t.check(name+' success updates only the active account verification',f.c.googleUser.emailVerified&&f.c._emailVerified&&f.events.filter(e=>e[0]==='fetch').length===1);
  t.check(name+' success refreshes the active account status',f.events.some(e=>e[0]==='status'&&e[1]==='alice'));
 }
}
{
 const f=fixture(),a=f.user('alice');await f.emit(a);await flush();
 for(const id of ['authVerifyCheckBtn','authVerifyError','authVerifySuccess'])f.elements.set(id,f.el());
 const pending=deferred();f.c.fetch=async()=>({ok:true,json:()=>pending.promise});
 const request=f.c.doAuthCheckVerified();await flush();
 await f.emit(a);await flush();f.events.length=0;
 pending.resolve({ok:true,bonusGranted:true});await request;await flush();
 t.check('a same-user replacement session discards the old verification result',!f.events.some(e=>e[0]==='migrate')&&f.elements.get('authVerifySuccess').textContent==='');
 t.check('a same-user replacement session leaves its button usable',!f.elements.get('authVerifyCheckBtn').disabled);
}
{
 const f=fixture(),a=f.user('alice');await f.emit(a);await flush();
 let calls=0;const pending=deferred();f.c.sendEmailVerification=async()=>{calls++;return pending.promise;};
 const request=f.c._fbSendVerification().catch(e=>e.code);await flush();
 await f.emit(f.user('bob'));await flush();
 pending.reject(Object.assign(Error('unsupported return URL'),{code:'auth/unauthorized-continue-uri'}));await request;
 t.check('verification-email fallback cannot send to a new account',calls===1);
}
for(const [name,errorId] of [['_verifySendCode','verifyEmailErr'],['_verifyConfirmCode','verifyCodeErr'],['_verifyFirebaseLinkDone','verifyLinkErr'],['doAuthCheckVerified','authVerifyError'],['doAuthResendVerification','authVerifyError']]){
 const f=fixture();f.elements.set(errorId,f.el());await f.c[name]();
 t.check(name+' gives signed-out users a clear next step',/Sign in again/.test(f.elements.get(errorId).textContent)&&!f.events.some(e=>e[0]==='fetch'));
}
t.done();
