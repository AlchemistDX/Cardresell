// Executes the actual page scripts with explicit synthetic SDK/DOM dependencies.
// Unit evidence only: not Firebase, real credentials, enrollment or browser sign-in.
const vm = require('node:vm');
module.exports = async function(check, source) {
  function setup(origin = 'https://cardresell-membership-v2-preview.vercel.app', search = '?reauth=1&next=%2F%3Fshop%3D1', options = {}) {
    const nodes = new Map(), navigations = [], verification = [], callbacks = [];
    const element = id => {
      if (!nodes.has(id)) nodes.set(id, {value:id === 'siEmail' ? 'synthetic@example.invalid' : 'synthetic',
        classList:{add(){},remove(){}},style:{},textContent:'',appendChild(){},focus(){this.focused=true;},select(){this.selected=true;},querySelector(){return null;}});
      return nodes.get(id);
    };
    const user = {uid:'synthetic',emailVerified:true,getIdToken:async()=> 'synthetic-only'};
    const auth = {currentUser:user};
    const location = {origin,search,replace: url=>navigations.push(url)};
    const window = {location,history:{state:options.historyState || null},addEventListener(){}};
    const storage = new Map([['existing-billing','unchanged']]), clipboard=[];
    const sessionStorage = {
      setItem(k,v){if(options.storageBlocked)throw Error('blocked');storage.set(k,v);},
      getItem(k){if(options.storageBlocked)throw Error('blocked');return options.storageMismatch?null:storage.get(k)||null;},
      removeItem(k){if(options.storageBlocked)throw Error('blocked');storage.delete(k);}
    };
    const context = vm.createContext({window,location,URL,URLSearchParams,Promise,
      console:{log(){},error(){}},navigator:{userAgent:options.ua || 'synthetic unit test',clipboard:{writeText:async(text)=>{if(options.clipboardBlocked)throw Error('blocked');clipboard.push(text);}}},
      document:{getElementById:element,querySelector:()=>element('card'),createElement:()=>element('created')},
      indexedDB:{open:()=>({})},sessionStorage,setTimeout:fn=>{fn();return 1;},
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
    return {window,auth,user,context,navigations,verification,callback:callbacks[0],element,storage,clipboard};
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
  const direct=setup(); let invoked=false;
  direct.window._fbPersistenceReady=new Promise(()=>{});
  direct.window._fbGoogleSignIn=()=>{invoked=true;return Promise.resolve({user:direct.user});};
  const directResult=vm.runInContext('googleSignIn()',direct.context);
  check('mobile: popup invoked synchronously before any pre-popup await',invoked);
  await directResult;
  check('mobile: successful storage probe preserves unrelated records',direct.storage.get('existing-billing') === 'unchanged' && [...direct.storage.keys()].every(k=>!k.startsWith('__cardresell_auth_probe_')));
  check('mobile: fresh recovery link stays on Preview and keeps Shop',direct.window._externalBrowserSignInLink() === 'https://cardresell-membership-v2-preview.vercel.app/signin?reauth=1&next=%2F%3Fshop%3D1');
  await direct.window.copyBrowserSignIn();
  check('mobile: copy works only after explicit action',direct.clipboard.length === 1 && direct.navigations.length === 1);
  for(const query of [
    '?next='+encodeURIComponent('/?shop=1&membership_recovery='+'a'.repeat(64)),
    '?next='+encodeURIComponent('/?membership_return=1&session_id=cs_test_example'),
    '?membership_recovery=invalid', '?session_id=cs_test_example',
    '?next='+encodeURIComponent('/?membership_recovery='),
    '?next=%2F&next='+encodeURIComponent('/?membership_recovery=pending'),
    '?next='+encodeURIComponent('https://external.invalid/?membership_recovery=pending'),
  ]) {
    const blocked=setup(undefined,query);await blocked.window.copyBrowserSignIn();
    check('mobile: tab-bound billing URL is never copied '+query,blocked.window._externalBrowserSignInLink() === null && blocked.clipboard.length === 0 && blocked.element('copyBrowserSignIn').disabled && blocked.element('browserTransferHelp').hidden && blocked.element('browserSignInLabel').hidden);
  }
  const history=setup(undefined,undefined,{historyState:{membershipPurchases:{owner:{requestId:'pending'}}}});
  check('mobile: pending history prevents cross-browser recovery',history.window._externalBrowserSignInLink() === null);
  for(const key of ['membershipPurchase','membershipCommands']){
    const state=setup(undefined,undefined,{historyState:{[key]:{pending:true}}});
    check('mobile: all legacy and command history forms retained '+key,state.window._externalBrowserSignInLink() === null);
  }
  const unreadable=setup();Object.defineProperty(unreadable.window.history,'state',{get(){throw Error('blocked');}});
  await unreadable.window.copyBrowserSignIn();
  check('mobile: inaccessible history fails closed on copy activation',unreadable.clipboard.length===0 && unreadable.element('copyBrowserSignIn').disabled);
  const stale=setup();stale.window.history.state={membershipPurchase:{pending:true}};
  await stale.window.copyBrowserSignIn();
  check('mobile: newly pending history rechecked on copy activation',stale.clipboard.length===0 && stale.element('browserSignInLink').value==='');
  for(const options of [{storageBlocked:true},{storageMismatch:true}]){
    const unavailable=setup(undefined,undefined,options); let popups=0;
    unavailable.window._fbGoogleSignIn=()=>{popups++;return Promise.resolve({user:unavailable.user});};
    await vm.runInContext('googleSignIn()',unavailable.context);
    check('mobile: page storage warning does not preempt Firebase popup authority '+JSON.stringify(options),popups===1 && unavailable.navigations.length===1 && unavailable.window._signInFlowPending===false && unavailable.element('browserRecovery').open);
  }
  const copyfail=setup(undefined,undefined,{clipboardBlocked:true});await copyfail.window.copyBrowserSignIn();
  check('mobile: denied clipboard has selectable same-site link fallback',copyfail.element('browserSignInLink').selected && copyfail.clipboard.length===0);
  const active=setup();active.window._signInFlowPending=true;await active.window.copyBrowserSignIn();
  check('mobile: active popup cannot launch competing copy recovery',active.clipboard.length===0 && /Close the existing/.test(active.element('browserRecoveryStatus').textContent));
  for(const ua of ['Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Mobile/15E148','Instagram 1.0']){
    const embedded=setup(undefined,undefined,{ua});
    check('mobile: embedded-browser hint opens help without blocking sign-in '+ua,embedded.element('browserRecovery').open && embedded.window._signInSessionStorageAvailable);
  }
  const ordinary=setup(undefined,undefined,{ua:'Mozilla/5.0 (iPhone) Version/18.0 Mobile/15E148 Safari/604.1'});
  check('mobile: ordinary Safari is not labeled unsupported',!ordinary.element('browserRecovery').open);
  const missing=setup();missing.window._fbGoogleSignIn=async()=>{throw Error('Unable to process request due to missing initial state. sensitive-query');};
  await vm.runInContext('googleSignIn()',missing.context);
  check('mobile: missing state is actionable without echoing provider text or navigating',missing.navigations.length===0 && missing.element('browserRecovery').open && /could not recover/.test(missing.element('errSignIn').textContent) && !/sensitive-query/.test(missing.element('errSignIn').textContent));
  const untrusted=setup('https://unapproved.vercel.app');
  check('mobile: unsupported host cannot supply external-browser sign-in URL',untrusted.window._externalBrowserSignInLink()===null);
  const cleaned=setup(undefined,'?next='+encodeURIComponent('/?shop=1&token=should-not-copy#secret'));
  check('mobile: copied clean link never includes arbitrary query or fragment',!cleaned.window._externalBrowserSignInLink().includes('secret')&&!cleaned.window._externalBrowserSignInLink().includes('token'));
  check('mobile: no automatic redirect flow or storage clearing added',!/\bsignInWithRedirect\s*\(|\bgetRedirectResult\s*\(|(?:sessionStorage|localStorage)\.clear\s*\(/.test(source));
  check('mobile: blanket private-mode diagnosis and Production instructions removed',!source.includes('Private Browsing detected')&&!source.includes('go to <strong>cardresell.org'));
};
