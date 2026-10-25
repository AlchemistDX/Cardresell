// Execute the shared shipped auth helper. No real tokens or external calls.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import vm from 'node:vm';
import {parse} from 'acorn';
import {harness} from './_assert.mjs';
const root=process.env.CARDRESELL_TEST_ROOT||resolve(new URL('..',import.meta.url).pathname);
const html=readFileSync(root+'/index.html','utf8');
const core=readFileSync(root+'/'+html.match(/js\/core\.[a-f0-9]{8}\.js/)[0],'utf8');
const ast=parse(core,{ecmaVersion:'latest'}),node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='_crIdToken');
const t=harness('seller-auth-recovery');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const settle=p=>Promise.race([p.then(value=>({value}),error=>({error:error.message})),wait(100).then(()=>({hung:true}))]);
function fixture(){
 const c={console,setTimeout:(fn,ms)=>setTimeout(fn,ms===15000?20:ms),clearTimeout,
  googleUser:{uid:'alice',sub:'alice'},_googleIdToken:'cached-old-token'};
 c._fbCurrentUser={uid:'alice',getIdToken:async force=>{c.forced=force;return 'fresh-alice-token'}};
 c.window=c;vm.createContext(c);vm.runInContext(core.slice(node.start,node.end),c);return c;
}
{
 const c=fixture();t.check('refreshes the current SDK user and caches a timely token',await c._crIdToken()==='fresh-alice-token'&&c.forced===true&&c._googleIdToken==='fresh-alice-token');
}
for(const [name,change] of [
 ['signed-out account',c=>{c.googleUser=null;}],
 ['mismatched SDK account',c=>{c._fbCurrentUser.uid='bob';}],
 ['missing SDK',c=>{delete c._fbCurrentUser;}],
 ['rejected refresh',c=>{c._fbCurrentUser.getIdToken=async()=>{throw Error('offline')};}],
 ['non-string token',c=>{c._fbCurrentUser.getIdToken=async()=>({token:'bad-shape'});}]
]){
 const c=fixture();change(c);const answer=await settle(c._crIdToken());
 t.check(name+' cannot fall back to an unbound cached token',!answer.hung&&answer.value==='');
 t.check(name+' cannot rewrite the token cache',c._googleIdToken==='cached-old-token');
}
{
 const c=fixture();let release;c._fbCurrentUser.getIdToken=()=>new Promise(r=>release=r);
 const answer=await settle(c._crIdToken());
 t.check('stalled token refresh returns control within its deadline',!answer.hung&&answer.value==='');
 release('late-token');await wait(5);
 t.check('late refresh cannot overwrite the cache after timeout',c._googleIdToken==='cached-old-token');
 c._fbCurrentUser.getIdToken=async()=> 'retry-token';
 t.check('a fresh user retry can recover after timeout',await c._crIdToken()==='retry-token');
}
for(const sameOwner of [false,true]){
 const c=fixture();let release;c._fbCurrentUser.getIdToken=()=>new Promise(r=>release=r);
 const pending=c._crIdToken();await wait(1);
 const uid=sameOwner?'alice':'bob';c.googleUser={uid,sub:uid};c._fbCurrentUser={uid,getIdToken:async()=> 'new-session-token'};c._googleIdToken='new-session-token';release('old-session-token');
 t.check((sameOwner?'same-account new session':'account switch')+' retracts the old refresh',await pending==='');
 t.check((sameOwner?'same-account new session':'account switch')+' retains the newer cache',c._googleIdToken==='new-session-token');
}
{
 const c=fixture();c.googleUser={uid:'alice',getIdToken:async()=> 'facade-token'};
 t.check('a current account exposing getIdToken remains supported',await c._crIdToken()==='facade-token');
}
{
 const c=fixture();c._fbAuth={currentUser:{uid:'alice',getIdToken:async()=> 'auth-current-token'}};delete c._fbCurrentUser;
 t.check('Firebase auth currentUser is supported',await c._crIdToken()==='auth-current-token');
}
{
 const c=fixture();c._fbAuth={currentUser:{uid:'bob',getIdToken:async()=> 'wrong-token'}};
 t.check('a stale SDK handle cannot bypass the actual auth account',await c._crIdToken()==='');
}
t.done();
