import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {Readable} from 'node:stream';
import {createHandler} from '../api/ebay-connect.js';
import {config,keys,hash,seal,unseal,STATE_COOKIE,PENDING_COOKIE,scripts} from '../api/_ebaySeller.js';
import {verifyNotification,readNotificationBody,deleteSellerData} from '../api/_ebayDeletion.js';
import notificationHandler from '../api/ebay-notifications.js';
import {redisCommand,redisRest} from './_idRedis.mjs';
import {completionGuard} from './_complete.mjs';
const {finish}=completionGuard('ebay-seller-connect');let checks=0;
const check=(ok,message)=>{assert.ok(ok,message);checks++;};
const kv=(...args)=>redisCommand(args);
const env={EBAY_APP_ID:'fixture-app\n',EBAY_CERT_ID:'fixture-cert\n',EBAY_SELLER_CONNECT_ENABLED:'true',EBAY_SELLER_TOKEN_KEY:'41'.repeat(32),EBAY_SELLER_REDIRECT_NAME:'fixture-runame',EBAY_SELLER_ORIGIN:'https://www.cardresell.org'};
const cfg=config(env),owner='fixture-owner',other='other-owner',k=keys('production',hash(owner));
 let calls=[],sellerId='seller-123',sellerName='Fixture Seller',mintHook=null,identityHook=null,failPolicy=false;
const fetcher=async(url,opts={})=>{
 calls.push({url:String(url),method:opts.method||'GET'});
 if(String(url).endsWith('/identity/v1/oauth2/token')) {
  if(mintHook){const h=mintHook;mintHook=null;await h();}
  check(opts.headers.Authorization=== 'Basic '+Buffer.from('fixture-app:fixture-cert').toString('base64'),'sanitized credentials used');
  const body=new URLSearchParams(opts.body);if(body.get('grant_type')==='authorization_code')check(body.get('redirect_uri')==='fixture-runame','token exchange uses RuName');
  return Response.json({access_token:'PRIVATE-ACCESS',expires_in:7200,refresh_token:'PRIVATE-REFRESH',refresh_token_expires_in:47304000});
 }
 if(String(url).includes('/commerce/identity/')) {if(identityHook){const h=identityHook;identityHook=null;await h();}return Response.json({userId:sellerId,username:sellerName,email:'not-stored@example.test'});}
 if(String(url).endsWith('/privilege'))return Response.json({sellerRegistrationCompleted:true});
 if(String(url).includes('/fulfillment_policy'))return Response.json({fulfillmentPolicies:[{}]});
 if(String(url).includes('/payment_policy'))return failPolicy?Response.json({errors:[{errorId:20403,message:'PRIVATE-PROVIDER-DETAILS',parameters:[{value:'PRIVATE-ACCESS'}]}]},{status:failPolicy===401?401:503}):Response.json({paymentPolicies:[{}]});
 if(String(url).includes('/return_policy'))return Response.json({returnPolicies:[]});
 if(String(url).includes('/location?'))return Response.json({locations:[{merchantLocationStatus:'ENABLED'},{merchantLocationStatus:'DISABLED'}]});
 throw Error('unexpected external request');
};
const verify=async(token)=>{if(![owner,other].includes(token))throw Error('invalid');return {uid:token};};
const handler=createHandler({env,store:kv,verify,fetcher});
const response=()=>({headers:{},code:0,data:null,setHeader(k,v){this.headers[k.toLowerCase()]=v;},status(c){this.code=c;return this;},json(d){this.data=d;return this;},end(){return this;}});
async function call(action,method='GET',{who=owner,cookies='',query={},origin=cfg.origin,h=handler}={}) {
 const r=response();await h({method,query:{action,...query},headers:{...(who?{authorization:'Bearer '+who}:{}),...(origin?{origin}:{}),cookie:cookies}},r);return r;
}
const cookies=r=>(Array.isArray(r.headers['set-cookie'])?r.headers['set-cookie']:[r.headers['set-cookie']]).filter(Boolean).map(c=>c.split(';')[0]).join('; ');
async function start(who=owner) {const r=await call('start','POST',{who});check(r.code===200,'start accepted');const url=new URL(r.data.url);return {r,state:url.searchParams.get('state'),cookies:cookies(r),url};}
async function pending(who=owner) {const s=await start(who);const r=await call('callback','GET',{who:null,cookies:s.cookies,query:{state:s.state,code:'fixture-code'}});check(r.code===303&&r.headers.location.endsWith('=review'),'valid callback awaits app confirmation');return {s,r,cookies:cookies(r)};}
async function connected(who=owner) {const p=await pending(who);const r=await call('confirm','POST',{who,cookies:p.cookies});check(r.code===200&&r.data.connected,'explicit confirmation saves connection');return p;}
try {
 check(config({...env,EBAY_SELLER_TOKEN_KEY:'short'})===null,'invalid encryption key disables connection');
 check(config({...env,EBAY_SELLER_CONNECT_ENABLED:'false'})===null,'feature flag fails closed');
 check(config({...env,EBAY_SELLER_ENVIRONMENT:'sandbox'})===null,'sandbox cannot reuse production credentials');
 check(config({...env,EBAY_SELLER_ORIGIN:'https://evil.example/path'})===null,'callback origin must be an HTTPS origin');
 const encrypted=seal({secret:'fixture'},cfg,hash(owner));check(!encrypted.includes('fixture')&&unseal(encrypted,cfg,hash(owner)).secret==='fixture','authenticated token encryption');
 assert.throws(()=>unseal(encrypted,cfg,hash(other)));checks++;
 check((await call('start','POST',{who:null})).code===401,'unsigned start refused');
 check((await call('start','POST',{origin:'https://other.example'})).code===403,'cross-origin start refused');
 check((await call('status','PATCH')).code===405,'unsupported verb refused');
 const s=await start();
 check(s.url.origin==='https://auth.ebay.com'&&s.url.searchParams.get('redirect_uri')==='fixture-runame','official authorization host and RuName');
 check(s.url.searchParams.get('scope').split(' ').every(v=>v.endsWith('.readonly')),'only read-only scopes requested');
 check(/HttpOnly/.test(s.r.headers['set-cookie'])&&/Secure/.test(s.r.headers['set-cookie'])&&/SameSite=Lax/.test(s.r.headers['set-cookie']),'cookie is secure and browser-bound');
 check(Number(await kv('TTL',k.prefix+'state:'+hash(s.state)))<=600,'state expires in ten minutes');
 let r=await call('callback','GET',{who:null,cookies:STATE_COOKIE+'='+'00'.repeat(32),query:{state:s.state,code:'fixture-code'}});
 check(r.headers.location.endsWith('=expired')&&calls.length===0,'wrong browser cookie cannot consume or exchange state');
 r=await call('callback','GET',{who:null,cookies:s.cookies,query:{state:s.state,code:'fixture-code'}});const pendingCookies=cookies(r);
 check(r.headers.location.endsWith('=review')&&!await kv('GET',k.connection),'callback does not silently bind an account');
 const previousCalls=calls.length;r=await call('callback','GET',{who:null,cookies:s.cookies,query:{state:s.state,code:'fixture-code'}});
 check(r.headers.location.endsWith('=expired')&&calls.length===previousCalls,'single-use callback state');
 r=await call('status','GET',{who:other,cookies:pendingCookies});check(!r.data.pending&&!r.data.connected,'different app account cannot inspect pending seller identity');
 check((await call('confirm','POST',{who:other,cookies:pendingCookies})).code===409,'different app account cannot confirm');
 r=await call('status','GET',{cookies:pendingCookies});check(r.data.pending.username===sellerName&&!JSON.stringify(r.data).includes('PRIVATE'),'status returns identity but no tokens');
 r=await call('confirm','POST',{cookies:pendingCookies});check(r.code===200,'original owner can finish');
 check((await call('confirm','POST',{cookies:pendingCookies})).code===409,'confirm replay cannot create a second connection');
 const stored=await kv('GET',k.connection);check(!stored.includes('PRIVATE')&&!stored.includes(sellerName)&&!stored.includes('not-stored'),'tokens and identity encrypted; unnecessary email discarded');
 r=await call('readiness','POST');check(r.data.sellerRegistered===true&&r.data.inventoryLocations===1&&r.data.returnPolicies===0&&!r.data.publishingEnabled,'read-only seller readiness reflects actual responses');
 failPolicy=true;r=await call('readiness','POST');check(r.data.partial&&r.data.paymentPolicies===null,'failed provider lookup is unknown, not zero or ready');
 check(r.data.issues[0].check==='payment'&&r.data.issues[0].providerStatus===503&&r.data.issues[0].providerErrorId===20403&&r.data.issues[0].message.includes('Business Policies'),'unavailable policies carry actionable safe details');
 check(!JSON.stringify(r.data).includes('PRIVATE'),'seller checks never reflect provider messages, parameters or credentials');failPolicy=false;
 failPolicy=401;r=await call('readiness','POST');check(r.data.reconnectRequired&&r.data.paymentPolicies===null,'revoked authorization asks for reconnection instead of repeated setup retries');failPolicy=false;
 await call('disconnect','DELETE',{who:other});check(await kv('GET',k.connection)===stored,'one user cannot disconnect another');
 const awaiting=await pending();await call('disconnect','DELETE');check((await call('confirm','POST',{cookies:awaiting.cookies})).code===409&&!await kv('GET',k.connection),'disconnect invalidates pending authorization');
 const disconnected=await start();await call('disconnect','DELETE');r=await call('callback','GET',{who:null,cookies:disconnected.cookies,query:{state:disconnected.state,code:'fixture-code'}});check(r.headers.location.endsWith('=expired'),'disconnect invalidates OAuth still in flight');
 await connected();
 let record=JSON.parse(await kv('GET',k.connection)),data=unseal(record.cipher,cfg,hash(owner));data.accessExpiresAt=Date.now()-1;record.cipher=seal(data,cfg,hash(owner));await kv('SET',k.connection,JSON.stringify(record));
 r=await call('readiness','POST');check(r.code===200&&unseal(JSON.parse(await kv('GET',k.connection)).cipher,cfg,hash(owner)).accessExpiresAt>Date.now(),'expired access token refreshes securely');
 record=JSON.parse(await kv('GET',k.connection));data=unseal(record.cipher,cfg,hash(owner));data.accessExpiresAt=0;record.cipher=seal(data,cfg,hash(owner));await kv('SET',k.connection,JSON.stringify(record));
 mintHook=()=>call('disconnect','DELETE');r=await call('readiness','POST');check(r.code===409&&!await kv('GET',k.connection),'late refresh cannot resurrect disconnected tokens');
 // Isolate the rest from the deliberately bounded start rate above.
 await kv('DEL',k.prefix+'start-rate:'+hash(owner));
 await connected();const pendingDeletion=await pending();
 const body={metadata:{topic:'MARKETPLACE_ACCOUNT_DELETION'},notification:{data:{userId:sellerId},notificationId:'fixture-deletion'}};
 check(Number(await deleteSellerData(body,kv))===2,'deletion erases both confirmed and pending token records');
 check(!await kv('GET',k.connection)&&(await call('confirm','POST',{cookies:pendingDeletion.cookies})).code===409,'deleted account cannot be reattached by pending confirmation');
 const race=await start();identityHook=()=>deleteSellerData(body,kv);r=await call('callback','GET',{who:null,cookies:race.cookies,query:{state:race.state,code:'fixture-code'}});check(r.headers.location.endsWith('=expired'),'deletion during identity lookup blocks pending token save');
 sellerId='seller-new';await connected();const off=createHandler({env:{...env,EBAY_SELLER_CONNECT_ENABLED:'false'},store:kv,verify,fetcher});
 r=await call('status','GET',{h:off});check(!r.data.available&&r.data.connected,'disabled feature acknowledges an existing connection');
 check((await call('disconnect','DELETE',{h:off})).code===200&&!await kv('GET',k.connection),'disconnect works while rollout is disabled');
 const pilot=createHandler({env:{...env,EBAY_SELLER_PILOT_UIDS:other},store:kv,verify,fetcher});check((await call('status','GET',{h:pilot})).data.available===false,'pilot is restricted to explicit account IDs');
 await kv('SET',k.prefix+'start-rate:'+hash(owner),10,'EX',3600);check((await call('start','POST')).code===429,'authorization starts are rate limited');
 check(calls.every(c=>c.method==='GET'||c.url.endsWith('/identity/v1/oauth2/token')),'no listing mutations sent to eBay');

 // Provider/storage failures used to collapse into an invisible generic return.
 // Exercise real callbacks and encryption/Lua with injected failures only at
 // external boundaries; no production accounts, tokens or stores are used.
 await kv('DEL',k.prefix+'start-rate:'+hash(owner));await connected();
 const beforeFailure=await kv('GET',k.connection),diagnostics=[];
 const privateText='PRIVATE-AUTH-CODE TOKEN cookie account';
 const failureCases=[
  {stage:'state',issue:'state',command:scripts.consume},
  {stage:'token',issue:'token',reply:()=>Response.json({error:'invalid_grant',error_description:privateText},{status:400}),providerStatus:400,providerCode:'invalid_grant'},
  {stage:'token',issue:'application',reply:()=>Response.json({error:'invalid_client',error_description:privateText},{status:401}),providerStatus:401,providerCode:'invalid_client'},
  {stage:'token',issue:'token',reply:()=>Response.json({error:privateText},{status:403}),providerStatus:403},
  {stage:'token',issue:'token',reply:()=>new Response(privateText,{status:502}),providerStatus:502},
  {stage:'token',issue:'token',reply:()=>Response.json({access_token:'PRIVATE-ACCESS',expires_in:7200})},
  {stage:'token',issue:'token',reply:()=>{throw new DOMException(privateText,'TimeoutError')},timeout:true},
  {stage:'identity',issue:'identity',reply:()=>Response.json({errors:[{errorId:1100,message:privateText,parameters:[{value:privateText}]}]},{status:403}),providerStatus:403,providerErrorId:1100},
  {stage:'identity',issue:'identity',reply:()=>Response.json({username:'PRIVATE-NAME'})},
  {stage:'identity',issue:'identity',reply:()=>{throw Error(privateText)}},
  {stage:'storage',issue:'storage',command:scripts.pending},
 ];
 for(const failure of failureCases) {
  await kv('DEL',k.prefix+'start-rate:'+hash(owner));const attempt=await start();
  const failing=createHandler({env,verify,
   store:async(...args)=>{if(args[1]===failure.command)throw Error(privateText);return kv(...args);},
   fetcher:async(url,opts)=>{if((failure.stage==='token'&&url.endsWith('/identity/v1/oauth2/token'))||(failure.stage==='identity'&&url.includes('/commerce/identity/')))return failure.reply();return fetcher(url,opts);},
   reportFailure:details=>diagnostics.push(details)});
  r=await call('callback','GET',{who:null,h:failing,cookies:attempt.cookies,query:{state:attempt.state,code:privateText}});
  const location=new URL(r.headers.location),detail=diagnostics.at(-1);
  check(r.code===303&&location.searchParams.get('ebay_connection')==='error'&&location.searchParams.get('ebay_issue')===failure.issue,'failed '+failure.stage+' returns an actionable outcome');
  check(/^[a-f\d]{12}$/.test(detail.reference)&&location.searchParams.get('ebay_ref')===detail.reference&&detail.stage===failure.stage,'safe reference connects the visible failure to diagnostics');
  check(['providerStatus','providerCode','providerErrorId','timeout'].every(key=>detail[key]===failure[key]),'diagnostics retain only the expected machine codes');
  check(!JSON.stringify({detail,headers:r.headers}).includes('PRIVATE')&&!JSON.stringify(detail).includes(owner),'diagnostics and redirect exclude tokens, codes, messages and account identity');
  check((await kv('GET',k.connection))===beforeFailure,'failed reconnect leaves the existing connection intact');
 }
 await kv('DEL',k.prefix+'start-rate:'+hash(owner));const failedReport=await start();
 const badReporter=createHandler({env,store:kv,verify,fetcher:async()=>{throw Error(privateText);},reportFailure:()=>{throw Error('report unavailable');}});
 r=await call('callback','GET',{who:null,h:badReporter,cookies:failedReport.cookies,query:{state:failedReport.state,code:privateText}});
 check(r.code===303&&new URL(r.headers.location).searchParams.get('ebay_issue')==='token','diagnostic failure cannot break recovery');

 // Verify real ECDSA signatures over exact bytes, with a synthetic eBay key.
 const {publicKey,privateKey}=generateKeyPairSync('ec',{namedCurve:'prime256v1'});
 const keyData={key:publicKey.export({format:'der',type:'spki'}).toString('base64'),algorithm:'ECDSA',digest:'SHA256'};
 const raw=Buffer.from(JSON.stringify(body));
 const signature=(payload,kid='fixture-key')=>Buffer.from(JSON.stringify({alg:'ecdsa',digest:'SHA256',kid,signature:sign('sha256',payload,privateKey).toString('base64')})).toString('base64');
 const deps={fetcher:async()=>Response.json(keyData),appToken:async()=>'fixture-app-token'};
 check(await verifyNotification(raw,signature(raw),deps),'valid signed payload accepted');
 check(!await verifyNotification(Buffer.from(raw+' '),signature(raw),deps),'any raw byte change invalidates signature');
 check(!await verifyNotification(raw,'malformed',deps),'invalid signature header rejected without fetching');
 const stream=Readable.from([raw.subarray(0,7),raw.subarray(7)]);check((await readNotificationBody(stream)).equals(raw),'raw request body retains exact bytes');
 const originalFetch=globalThis.fetch,previousUrl=process.env.KV_REST_API_URL,previousKey=process.env.KV_REST_API_TOKEN,previousApp=process.env.EBAY_APP_ID,previousCert=process.env.EBAY_CERT_ID;
 try {
  process.env.KV_REST_API_URL='https://fixture-kv.invalid';process.env.KV_REST_API_TOKEN='fixture';process.env.EBAY_APP_ID='fixture-app';process.env.EBAY_CERT_ID='fixture-cert';
  globalThis.fetch=async(input,init={})=>{const url=String(input);if(url.startsWith('https://fixture-kv.invalid'))return redisRest(input,init);if(url.includes('/identity/v1/oauth2/token'))return Response.json({access_token:'fixture-app-token',expires_in:3600});if(url.includes('/commerce/notification/v1/public_key/'))return Response.json(keyData);throw Error('unexpected HTTP request');};
  r=response();await notificationHandler({method:'POST',headers:{'x-ebay-signature':signature(raw,'route-key')},body:raw},r);check(r.code===200&&r.data.received,'real notification handler verifies and completes deletion');
  r=response();await notificationHandler({method:'POST',headers:{'x-ebay-signature':signature(raw)},body:Buffer.from(raw+' ')},r);check(r.code===412,'tampered notification never acknowledged');
  globalThis.fetch=async(input,init={})=>{if(String(input).startsWith('https://fixture-kv.invalid'))throw Error('storage offline');return Response.json(keyData);};
  r=response();await notificationHandler({method:'POST',headers:{'x-ebay-signature':signature(raw)},body:raw},r);check(r.code===503&&!r.data.received,'deletion storage failure requests retry instead of false success');
 } finally {
  globalThis.fetch=originalFetch;for(const [name,value] of [['KV_REST_API_URL',previousUrl],['KV_REST_API_TOKEN',previousKey],['EBAY_APP_ID',previousApp],['EBAY_CERT_ID',previousCert]]){if(value===undefined)delete process.env[name];else process.env[name]=value;}
 }
} finally { /* _idRedis owns the isolated process and stops it on exit. */ }
finish(checks,0);
