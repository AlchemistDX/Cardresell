const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const auth = fs.readFileSync(path.join(root, html.match(/src="\/(js\/auth\.[a-f0-9]+\.js)"/)[1]), 'utf8');
const signin = fs.readFileSync(path.join(root, 'signin.html'), 'utf8');
const helper = source => source.slice(source.indexOf('    async function completeGoogleSignIn()'), source.indexOf('    window._fbGoogleSignIn =')).trim();
// signin includes a comment before the alias; compare the actual function only.
const actualHelper = source => helper(source).slice(0, helper(source).lastIndexOf('    }') + 5).trim();
assert.equal(actualHelper(auth), actualHelper(signin));
let passed = 0;
function check(name, value) { assert.ok(value, name); passed++; }
function setup({ error, provider = 'google.com', tokenProvider = 'google.com', switchAt, missing = false } = {}) {
  const elements = new Map();
  const el = () => ({ textContent: '', style: {}, children: [], append(e) { this.children.push(e); }, setAttribute() {}, remove() {} });
  for (const id of ['membershipAccountStatus', 'authSignInError', 'authSignUpError']) elements.set(id, el());
  const counts = { reload: 0, profile: 0, token: 0, redirect: 0, flush: 0 };
  const user = { uid: 'A', emailVerified: false,
    async reload() { counts.profile++; if (switchAt === 'profile') context.auth.currentUser = {uid:'B'}; this.emailVerified = true; },
    async getIdTokenResult(force) { assert.equal(force,true); counts.token++; if (switchAt === 'token') context.auth.currentUser = {uid:'B'}; return {signInProvider:tokenProvider}; } };
  const context = { window: {}, auth: {currentUser:user},
    GoogleAuthProvider: class { setCustomParameters(p) { assert.equal(p.prompt,'select_account'); } },
    signInWithPopup: async () => { if (error) throw Object.assign(Error('sensitive provider detail'), {code:error}); return missing ? {} : {user, providerId:provider}; },
    document: {getElementById:id=>elements.get(id)||null,createElement:el},
    location: {reload() { counts.reload++; }},
    clearErr(){},showErr(id,message){elements.set(id,{textContent:message});},fbMsg:e=>e.code,
    _flushAuthToDisk:async()=>{counts.flush++;},
  };
  context.window._dbg=()=>{};context.window._continueToApp=()=>{counts.redirect++;};
  context.window._fbPersistenceReady=Promise.resolve();
  vm.createContext(context);
  return {context,counts,elements};
}
(async()=>{
  const homeCode = auth.slice(auth.indexOf('    async function completeGoogleSignIn()'), auth.indexOf('    window._fbEmailSignIn ='));
  const pageCode = signin.slice(signin.indexOf('    async function completeGoogleSignIn()'), signin.indexOf('    window._fbEmailSignIn '));
  const pageCaller = signin.slice(signin.indexOf('    async function googleSignIn()'),signin.indexOf('    async function doSignIn()'));
  for (const route of ['home','signin']) {
    const run = async options => {
      const h=setup(options);vm.runInContext(route==='home'?homeCode:pageCode+pageCaller,h.context);
      await (route==='home'?h.context.window._fbGoogleSignIn():h.context.googleSignIn());return h;
    };
    let h=await run({});
    check(route+': completed Google sign-in reloads profile and fresh token',h.counts.profile===1&&h.counts.token===1);
    check(route+': success continues through normal auth setup once',route==='home'?h.counts.reload===1:h.counts.redirect===1&&h.counts.flush===1);
    for(const error of ['auth/popup-closed-by-user','auth/popup-blocked','auth/network-request-failed','auth/internal-error']){
      h=await run({error});
      check(route+': '+error+' never navigates or refreshes old session',h.counts.reload===0&&h.counts.redirect===0&&h.counts.token===0);
      check(route+': '+error+' is shown to the user',route==='home'?h.elements.get('authSignInError').textContent.length>0:h.elements.get('errSignIn').textContent===error);
      check(route+': provider details are not leaked into messages',!JSON.stringify([...h.elements.values()]).includes('sensitive provider detail'));
    }
    for (const options of [{missing:true},{provider:'password'},{tokenProvider:'password'},{switchAt:'profile'},{switchAt:'token'}]) {
      h=await run(options);
      check(route+': incomplete or changed identity cannot continue '+JSON.stringify(options),h.counts.reload===0&&h.counts.redirect===0);
    }
  }
  console.log(`google-signin-recovery: ${passed} passed, 0 failed`);
})().catch(e=>{console.error(e);process.exitCode=1;});
