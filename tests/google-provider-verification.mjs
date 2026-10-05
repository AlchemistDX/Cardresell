import assert from 'node:assert/strict';
import { generateKeyPairSync, sign, webcrypto } from 'node:crypto';
import { readGoogleProviderVerification } from '../api/_googleProviderVerification.js';
import { verifyFirebaseToken } from '../api/_verifyToken.js';
import { createMembershipAuthenticator } from '../api/_membershipAuthentication.js';

globalThis.crypto ||= webcrypto;
const now = Math.floor(Date.now()/1000);
const claims = { sub:'firebase-test-owner', aud:'cardresell-e0329',
  iss:'https://securetoken.google.com/cardresell-e0329', iat:now, exp:now+3600,
  email_verified:false, firebase:{sign_in_provider:'google.com',identities:{'google.com':['google-test-subject']}} };
const account = { localId:claims.sub, emailVerified:false,
  providerUserInfo:[{providerId:'google.com',rawId:'google-test-subject',email:'test-only@gmail.com'}] };
const clone = x => structuredClone(x);
const response = user => async () => ({ok:true,json:async()=>({users:[user]})});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS '+name);}
await test('current Google session with matching server Gmail identity verifies absent primary email', async()=>{
  const result=await readGoogleProviderVerification('test-token',claims,async(url,options)=>{
    assert.match(url,/^https:\/\/identitytoolkit.googleapis.com\/v1\/accounts:lookup\?key=/);
    assert.deepEqual(JSON.parse(options.body),{idToken:'test-token'});
    assert.equal(options.method,'POST'); assert.ok(options.signal);
    return {ok:true,json:async()=>({users:[account]})};
  });
  assert.deepEqual(result,{email:'test-only@gmail.com',emailVerified:true});
});
await test('matching case-insensitive primary email accepted',async()=>{
  assert.ok(await readGoogleProviderVerification('t',{...claims,email:'TEST-ONLY@gmail.com'},response({...account,email:'test-only@gmail.com'})));
});
for(const provider of ['password','custom','facebook.com']) await test(provider+' session cannot borrow linked Google proof',async()=>{
  let calls=0;assert.equal(await readGoogleProviderVerification('t',{...claims,firebase:{...claims.firebase,sign_in_provider:provider}},async()=>{calls++;}),null);assert.equal(calls,0);
});
for(const subjects of [undefined,[],['a','b'],[17],['']]) await test('invalid signed Google subject rejected '+JSON.stringify(subjects),async()=>{
  let calls=0;assert.equal(await readGoogleProviderVerification('t',{...claims,firebase:{...claims.firebase,identities:{'google.com':subjects}}},async()=>{calls++;}),null);assert.equal(calls,0);
});
for(const [label,mutate] of [
  ['different Firebase UID',a=>a.localId='other'],
  ['disabled account',a=>a.disabled=true],
  ['tenant account',a=>a.tenantId='other'],
  ['revoked token',a=>a.validSince=String(now+1)],
  ['malformed validSince',a=>a.validSince='NaN'],
  ['different Google subject',a=>a.providerUserInfo[0].rawId='other'],
  ['missing Google subject',a=>delete a.providerUserInfo[0].rawId],
  ['non-Gmail provider address',a=>a.providerUserInfo[0].email='test@example.com'],
  ['Gmail suffix spoof',a=>a.providerUserInfo[0].email='test@gmail.com.evil.invalid'],
  ['malformed Gmail',a=>a.providerUserInfo[0].email='victim@gmail.com@test@gmail.com'],
  ['missing provider email',a=>delete a.providerUserInfo[0].email],
  ['different primary email',a=>a.email='different@gmail.com'],
  ['missing Google provider',a=>a.providerUserInfo=[]],
  ['ambiguous Google providers',a=>a.providerUserInfo.push({...a.providerUserInfo[0]})],
]) await test(label+' fails closed',async()=>{const a=clone(account);mutate(a);assert.equal(await readGoogleProviderVerification('t',claims,response(a)),null);});
await test('different token email cannot be verified',async()=>{
  assert.equal(await readGoogleProviderVerification('t',{...claims,email:'other@gmail.com'},response(account)),null);
});
await test('ambiguous lookup users rejected',async()=>{
  assert.equal(await readGoogleProviderVerification('t',claims,async()=>({ok:true,json:async()=>({users:[account,account]})})),null);
});
await test('lookup outage has no verification fallback',async()=>{
  await assert.rejects(()=>readGoogleProviderVerification('t',claims,async()=>({ok:false})),/google_verification_unavailable/);
});
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwk={...publicKey.export({format:'jwk'}),kid:'test-google-provider-key'};
function jwt(change={}){const enc=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const data=enc({alg:'RS256',kid:jwk.kid})+'.'+enc({...claims,...change});return data+'.'+sign('RSA-SHA256',Buffer.from(data),privateKey).toString('base64url');}
let lookups=0, failLookup=false;
globalThis.fetch=async(url,options)=>{
  if(url.includes('/service_accounts/'))return {ok:true,json:async()=>({keys:[jwk]})};
  assert.match(url,/^https:\/\/identitytoolkit.googleapis.com\/v1\/accounts:lookup\?key=/);
  lookups++; assert.ok(JSON.parse(options.body).idToken);if(failLookup)throw Error('private upstream detail');
  return {ok:true,json:async()=>({users:[account]})};
};
await test('real signature verification recovers Google proof and preserves Firebase UID',async()=>{
  const user=await verifyFirebaseToken(jwt()); assert.equal(user.uid,claims.sub);assert.equal(user.emailVerified,true);assert.equal(user.email,'test-only@gmail.com');
});
await test('membership accepts provider proof using original UID',async()=>{
  const auth=createMembershipAuthenticator(); assert.deepEqual(await auth(jwt()),{uid:claims.sub,verified:true,email:'test-only@gmail.com'});
});
await test('already verified claim avoids provider lookup',async()=>{
  const before=lookups;assert.equal((await verifyFirebaseToken(jwt({email_verified:true,email:'test-only@gmail.com'}))).emailVerified,true);assert.equal(lookups,before);
});
await test('wrong audience, issuer and tampering never invoke provider lookup',async()=>{
  const before=lookups;
  await assert.rejects(()=>verifyFirebaseToken(jwt({aud:'other'})));
  await assert.rejects(()=>verifyFirebaseToken(jwt({iss:'other'})));
  const parts=jwt().split('.');parts[1]=Buffer.from(JSON.stringify({...claims,sub:'victim'})).toString('base64url');
  await assert.rejects(()=>verifyFirebaseToken(parts.join('.')));
  assert.equal(lookups,before);
});
await test('provider lookup outage denies membership without leaking details',async()=>{
  failLookup=true;const messages=[];const warn=console.warn;console.warn=(...args)=>messages.push(args);
  try{await assert.rejects(()=>createMembershipAuthenticator({onReject:reason=>messages.push(reason)})(jwt()),{code:'authentication_required'});}finally{console.warn=warn;failLookup=false;}
  assert.equal(JSON.stringify(messages).includes('private upstream detail'),false);
  assert.ok(JSON.stringify(messages).includes('email_not_verified_google'));
});
console.log(`${passed} passed, 0 failed`);
