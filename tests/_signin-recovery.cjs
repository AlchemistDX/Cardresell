// Executes the actual page scripts with explicit synthetic SDK/DOM dependencies.
// Unit evidence only: not Firebase, real credentials, enrollment or browser sign-in.
const vm = require('node:vm');
module.exports = async function(check, source) {
  function setup(origin = 'https://cardresell-membership-v2-preview.vercel.app', search = '?reauth=1&next=%2F%3Fshop%3D1') {
    const nodes = new Map(), navigations = [], verification = [], callbacks = [];
    const element = id => {
      if (!nodes.has(id)) nodes.set(id, {value:id === 'siEmail' ? 'synthetic@example.invalid' : 'synthetic',
        classList:{add(){},remove(){}},style:{},textContent:'',appendChild(){},querySelector(){return null;}});
      return nodes.get(id);
    };
    const user = {uid:'synthetic',emailVerified:true,getIdToken:async()=> 'synthetic-only'};
    const auth = {currentUser:user};
    const location = {origin,search,replace: url=>navigations.push(url)};
    const window = {location,addEventListener(){}};
    const context = vm.createContext({window,location,URL,URLSearchParams,Promise,
      console:{log(){},error(){}},navigator:{userAgent:'synthetic unit test'},
      document:{getElementById:element,querySelector:()=>element('card'),createElement:()=>element('created')},
      indexedDB:{open:()=>({})},sessionStorage:{setItem(){}},setTimeout:fn=>{fn();return 1;},
      initializeApp:()=>({}),initializeAuth:()=>auth,
      indexedDBLocalPersistence:{},browserLocalPersistence:{},browserSessionPersistence:{},browserPopupRedirectResolver:{},
      GoogleAuthProvider:class {setCustomParameters(params){this.params=params;}},
      onAuthStateChanged:(_,fn)=>callbacks.push(fn),
      signInWithPopup:async()=>({user}),signInWithEmailAndPassword:async()=>({user}),
      createUserWithEmailAndPassword:async()=>({user}),sendPasswordResetEmail:async()=>{},
      sendEmailVerification:async(u,settings)=>verification.push(settings),
    });
    const scripts = [...source.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)];
    // Classic scripts run before deferred modules, as in the served page.
    for (const [,attrs,script] of scripts.filter(s=>!s[1].includes('type="module"'))) vm.runInContext(script,context);
    for (const [,attrs,script] of scripts.filter(s=>s[1].includes('type="module"'))) {
      vm.runInContext(script.replace(/import\s+[\s\S]*?\s+from\s+['"][^'"]+['"];\s*/g,''),context);
    }
    return {window,auth,user,context,navigations,verification,callback:callbacks[0],element};
  }
  const h = setup(); h.callback(h.user);
  check('recovery: persisted SDK session does not immediately bounce back', h.navigations.length === 0);
  let release; const pending = new Promise(resolve=>{release=resolve;});
  h.window._fbEmailSignIn = async()=>{h.callback(h.user);await pending;return {user:h.user};};
  const completing = vm.runInContext('doSignIn()',h.context); await Promise.resolve();
  check('recovery: callback during pending password action cannot navigate',h.navigations.length === 0);
  release(); await completing;
  check('recovery: successful password sign-in returns to Shop exactly once',h.navigations.length === 1 && h.navigations[0] === '/?shop=1');
  check('recovery: explicit completion releases in-flight state',h.window._signInFlowPending === false);
  const canceled=setup();
  canceled.window._fbGoogleSignIn=async()=>{throw Object.assign(Error('canceled'),{code:'auth/popup-closed-by-user'});};
  await vm.runInContext('googleSignIn()',canceled.context); canceled.callback(canceled.user);
  check('recovery: canceled Google popup cannot use cached user to navigate',canceled.navigations.length === 0 && !canceled.window._justSignedIn);
  check('recovery: canceled popup produces actionable copy',/Sign-in was canceled/.test(canceled.element('errSignIn').textContent));
  const google=setup(undefined,'?reauth=1&next=%2F%3Fsubscriptions%3D1');
  await vm.runInContext('googleSignIn()',google.context);
  check('recovery: Google completion returns to Subscriptions even with same persisted user',google.navigations.length === 1 && google.navigations[0] === '/?subscriptions=1');
  const failed=setup(); failed.window._fbEmailSignIn=async()=>{throw Object.assign(Error('invalid'),{code:'auth/invalid-credential'});};
  await vm.runInContext('doSignIn()',failed.context); failed.callback(failed.user);
  check('recovery: failed password does not reuse restored user',failed.navigations.length === 0 && !failed.window._signInFlowPending);
  const switched=setup(); switched.window._fbEmailSignIn=async()=>({user:{...switched.user}});
  await vm.runInContext('doSignIn()',switched.context);
  check('recovery: mismatched credential/current user cannot navigate',switched.navigations.length === 0);
  const normal=setup(undefined,'?next=%2F%3Fshop%3D1');normal.callback(normal.user);
  check('normal persisted deep link still returns without forced reauthentication',normal.navigations[0] === '/?shop=1');
  for(const origin of ['https://www.cardresell.org','https://cardresell.org','https://cardresell-membership-v2-preview.vercel.app']){
    const v=setup(origin);const result=await v.window._fbSendVerification();
    check(`verification: ${origin} stays on its own origin`,result.withReturn && v.verification[0].url === origin+'/?verified=1');
  }
  const unknown=setup('https://unapproved.vercel.app');const unknownResult=await unknown.window._fbSendVerification();
  check('verification: unapproved host never silently routes to Production',!unknownResult.withReturn && unknown.verification[0] === undefined);
  const fallback=setup(); let attempts=0;
  fallback.context.sendEmailVerification=async(_,settings)=>{attempts++;if(settings)throw Object.assign(Error('domain'),{code:'auth/unauthorized-continue-uri'});};
  const fallbackResult=await fallback.window._fbSendVerification();
  check('verification: provider rejection falls back to normal verified email flow',attempts === 2 && fallbackResult.withReturn === false);
};
