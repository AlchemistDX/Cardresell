import {verifyTokenFlexible} from './_verifyToken.js';
import {kvFromEnv} from './_kv.js';
import {sellerSetupIssue,usableInventoryLocation} from './_ebaySetup.js';
import {config,hash,random,keys,seal,unseal,parseRecord,cookie,cookieHeader,STATE_COOKIE,PENDING_COOKIE,SCOPES,limited,mint,ebayJson,scripts,access} from './_ebaySeller.js';

const safeText=v=>typeof v==='string'&&v.length<=200&&!/[\x00-\x1f]/.test(v)?v:'';
const tokenTTL=data=>Math.max(1,Math.floor((data.refreshExpiresAt-Date.now())/1000));
export function createHandler({env=process.env,verify=verifyTokenFlexible,store,fetcher=fetch,reportFailure=details=>console.warn('ebay_connection_failed',JSON.stringify(details))}={}) {
 return async function handler(req,res) {
  res.setHeader('Cache-Control','private, no-store');res.setHeader('Referrer-Policy','no-referrer');
  const cfg=config(env),environment=cfg?.environment||(env.EBAY_SELLER_ENVIRONMENT==='sandbox'?'sandbox':'production');
  const kv=store||kvFromEnv(env),action=typeof req.query?.action==='string'?req.query.action:'status';
  if(!['GET','POST','DELETE'].includes(req.method))return res.status(405).json({error:'Method not allowed'});
  const origin=cfg?.origin||'https://www.cardresell.org';
  const redirect=(outcome,details={})=>{res.setHeader('Location',origin+'/?'+new URLSearchParams({ebay_connection:outcome,...details}));return res.status(303).end();};
  let callbackStage='state';
  try {
   if(action==='callback'&&req.method==='GET') {
    if(!cfg||!kv)return redirect('unavailable');
    const state=req.query.state,nonce=cookie(req,STATE_COOKIE);
    if(typeof state!=='string'||!/^[a-f\d]{64}$/.test(state)||!nonce)return redirect('expired');
    const stateKey=keys(environment,'').prefix+'state:'+hash(state);
    const raw=await kv('EVAL',scripts.consume,1,stateKey,hash(nonce));
    if(!raw)return redirect('expired');
    res.setHeader('Set-Cookie',cookieHeader(STATE_COOKIE,'',0));
    const ctx=parseRecord(raw),k=keys(environment,ctx.owner);
    if(String(await kv('GET',k.epoch)||'0')!==ctx.epoch)return redirect('expired');
    if(req.query.error)return redirect('denied');
    if(typeof req.query.code!=='string'||!req.query.code||req.query.code.length>2048)return redirect('expired');
    callbackStage='token';
    const tokens=await mint(cfg,{grant_type:'authorization_code',code:req.query.code,redirect_uri:cfg.ruName},fetcher);
    if(typeof tokens.refresh_token!=='string'||!tokens.refresh_token||!Number.isFinite(tokens.refresh_token_expires_in)||tokens.refresh_token_expires_in<=0||tokens.refresh_token_expires_in>63_072_000)throw Error('seller_refresh_token_missing');
    callbackStage='identity';
    const identity=await ebayJson(cfg,'/commerce/identity/v1/user/',tokens.access_token,fetcher,true);
    const userId=safeText(identity.userId);if(!userId)throw Error('seller_identity_missing');
    const username=safeText(identity.username)||'eBay account ending '+userId.slice(-6);
    callbackStage='storage';
    const now=Date.now(),accountHash=hash(userId),ticket=random();
    const data={userId,username,accessToken:tokens.access_token,refreshToken:tokens.refresh_token,accessExpiresAt:now+tokens.expires_in*1000,refreshExpiresAt:now+tokens.refresh_token_expires_in*1000,connectedAt:now};
    const pending={owner:ctx.owner,epoch:ctx.epoch,previousVersion:ctx.previousVersion,accountHash,expiresAt:now+600000,cipher:seal(data,cfg,ctx.owner)};
    const ok=await kv('EVAL',scripts.pending,5,k.prefix+'pending:'+hash(ticket),k.epoch,k.ownerIndex,k.prefix+'deleted:'+accountHash,k.prefix+'account:'+accountHash,JSON.stringify(pending),ctx.epoch);
    if(Number(ok)!==1)return redirect('expired');
    res.setHeader('Set-Cookie',[cookieHeader(STATE_COOKIE,'',0),cookieHeader(PENDING_COOKIE,ticket)]);
    return redirect('review');
   }
   const token=String(req.headers?.authorization||'').match(/^Bearer (.+)$/)?.[1];
   let identity;try{if(!token)throw Error();identity=await verify(token);}catch{return res.status(401).json({error:'Sign in required'});}
   if(!identity?.uid)return res.status(401).json({error:'Sign in required'});
   const owner=hash(identity.uid),k=keys(environment,owner);
   if(req.method!=='GET'&&req.headers?.origin!==origin)return res.status(403).json({error:'Open this action on CardResell to continue.'});
   if(!kv)return res.status(503).json({error:'Connection storage is unavailable. Try again.'});
   // Disconnect remains available if the feature or credentials are disabled.
   if(action==='disconnect'&&req.method==='DELETE') {
    await kv('EVAL',scripts.disconnect,3,k.connection,k.epoch,k.ownerIndex,k.prefix);
    res.setHeader('Set-Cookie',[cookieHeader(STATE_COOKIE,'',0),cookieHeader(PENDING_COOKIE,'',0)]);
    return res.status(200).json({ok:true,connected:false});
   }
   const pilot=String(env.EBAY_SELLER_PILOT_UIDS||'').split(',').map(s=>s.trim()).filter(Boolean);
   const available=Boolean(cfg)&&(!pilot.length||pilot.includes(identity.uid));
   if(!available) {
    if(action==='status'&&req.method==='GET')return res.status(200).json({available:false,connected:!!await kv('GET',k.connection),publishingEnabled:false});
    return res.status(503).json({error:'Direct eBay connection is not available yet. You can still prepare and export listing drafts.'});
   }
   if(action==='start'&&req.method==='POST') {
    await limited(kv,k.prefix+'start-rate:'+owner,10,3600);
    const state=random(),nonce=random(),stateKey=k.prefix+'state:'+hash(state);
    await kv('EVAL',scripts.start,4,stateKey,k.epoch,k.connection,k.ownerIndex,JSON.stringify({owner,nonceHash:hash(nonce)}));
    res.setHeader('Set-Cookie',cookieHeader(STATE_COOKIE,nonce));
    const url=new URL(cfg.auth+'/oauth2/authorize');url.search=new URLSearchParams({client_id:cfg.appId,redirect_uri:cfg.ruName,response_type:'code',scope:SCOPES.join(' '),state,prompt:'login'}).toString();
    return res.status(200).json({url:url.href});
   }
   const ticket=cookie(req,PENDING_COOKIE),pendingKey=ticket?k.prefix+'pending:'+hash(ticket):'';
   const pendingRaw=pendingKey?await kv('GET',pendingKey):null;
   let pending=parseRecord(pendingRaw);
   if(pending&&(pending.owner!==owner||pending.expiresAt<=Date.now()||String(await kv('GET',k.epoch)||'0')!==pending.epoch))pending=null;
   if(action==='status'&&req.method==='GET') {
    const record=parseRecord(await kv('GET',k.connection));
    const data=record?unseal(record.cipher,cfg,owner):null;
    const candidate=pending?unseal(pending.cipher,cfg,owner):null;
    return res.status(200).json({available:true,environment,connected:!!record,publishingEnabled:false,
      ...(data?{username:data.username,connectedAt:data.connectedAt,reconnectRequired:data.refreshExpiresAt<=Date.now()}:{}),
      ...(candidate?{pending:{username:candidate.username,expiresAt:pending.expiresAt}}:{})});
   }
   if(action==='confirm'&&req.method==='POST') {
    if(!pending)return res.status(409).json({error:'This authorization expired or belongs to a different CardResell account. Start again.'});
    const data=unseal(pending.cipher,cfg,owner),record={accountHash:pending.accountHash,version:random(),cipher:pending.cipher};
    const ok=await kv('EVAL',scripts.finish,6,pendingKey,k.connection,k.epoch,k.prefix+'account:'+pending.accountHash,k.prefix+'deleted:'+pending.accountHash,k.ownerIndex,pendingRaw,JSON.stringify(record),tokenTTL(data),k.prefix);
    if(Number(ok)!==1)return res.status(409).json({error:'Your eBay connection changed or its account limit was reached. Start again.'});
    res.setHeader('Set-Cookie',cookieHeader(PENDING_COOKIE,'',0));
    return res.status(200).json({ok:true,connected:true,username:data.username,publishingEnabled:false});
   }
   if(action==='readiness'&&req.method==='POST') {
    await limited(kv,k.prefix+'check-rate:'+owner,30,3600);
    const {data,raw}=await access(kv,cfg,owner,fetcher);
    const paths=['/sell/account/v1/privilege','/sell/account/v1/fulfillment_policy?marketplace_id=EBAY_US','/sell/account/v1/payment_policy?marketplace_id=EBAY_US','/sell/account/v1/return_policy?marketplace_id=EBAY_US','/sell/inventory/v1/location?limit=100'];
    const results=await Promise.allSettled(paths.map(path=>ebayJson(cfg,path,data.accessToken,fetcher)));
    if(await kv('GET',k.connection)!==raw)return res.status(409).json({error:'Your connection changed. Refresh before checking again.'});
    const values=results.map(r=>r.status==='fulfilled'?r.value:null);
    const count=(i,key)=>Array.isArray(values[i]?.[key])?values[i][key].length:null;
    const report={sellerRegistered:typeof values[0]?.sellerRegistrationCompleted==='boolean'?values[0].sellerRegistrationCompleted:null,
      fulfillmentPolicies:count(1,'fulfillmentPolicies'),paymentPolicies:count(2,'paymentPolicies'),returnPolicies:count(3,'returnPolicies'),
      inventoryLocations:Array.isArray(values[4]?.locations)?values[4].locations.filter(l=>l.merchantLocationStatus==='ENABLED').length:null};
    const checks=['registration','fulfillment','payment','return','location'];
    const issues=Object.values(report).flatMap((value,i)=>value===null?[sellerSetupIssue(checks[i],results[i].reason)]:[]);
    const locationsComplete=Array.isArray(values[4]?.locations)&&!values[4].next&&!(Number(values[4].total)>values[4].locations.length);
    if(Array.isArray(values[4]?.locations)&&!locationsComplete) {
      report.inventoryLocations=null;
      issues.push({check:'location',message:'eBay returned only part of your inventory locations. The current listing review cannot use an incomplete location list.'});
    }
    const usableInventoryLocations=locationsComplete?values[4].locations.filter(usableInventoryLocation).length:null;
    return res.status(200).json({marketplace:'EBAY_US',checkedAt:Date.now(),publishingEnabled:false,...report,usableInventoryLocations,issues,partial:issues.length>0,reconnectRequired:results.some(r=>r.status==='rejected'&&r.reason?.status===409)});
   }
   return res.status(400).json({error:'Unknown connection action'});
  } catch(error) {
   // Never log request URLs, exceptions, authorization codes, token bodies,
   // cookies or user IDs. A random reference joins the UI to safe diagnostics.
   if(action==='callback') {
    const reference=random().slice(0,12),details={reference,stage:callbackStage};
    if(Number.isInteger(error?.providerStatus)&&error.providerStatus>=100&&error.providerStatus<=599)details.providerStatus=error.providerStatus;
    if(['invalid_request','invalid_client','invalid_grant','unauthorized_client','unsupported_grant_type','invalid_scope','access_denied','server_error','temporarily_unavailable'].includes(error?.providerCode))details.providerCode=error.providerCode;
    if(Number.isSafeInteger(error?.providerErrorId)&&error.providerErrorId>=0&&error.providerErrorId<=1_000_000_000)details.providerErrorId=error.providerErrorId;
    if(['TimeoutError','AbortError'].includes(error?.name))details.timeout=true;
    try{reportFailure(details);}catch{/* Diagnostics must not prevent recovery. */}
    const issue=callbackStage==='token'&&['invalid_client','unauthorized_client','invalid_scope'].includes(details.providerCode)?'application':callbackStage;
    res.setHeader('Set-Cookie',cookieHeader(STATE_COOKIE,'',0));
    return redirect('error',{ebay_issue:issue,ebay_ref:reference});
   }
   return res.status(error.status||503).json({error:error.status?error.message:'Could not confirm the eBay connection. Try again.'});
  }
 };
}
export default createHandler();
