// Seller OAuth is separate from the application token used for public lookups.
// This first connection stage requests read-only access. No listing writes.
import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {cleanCredential} from './_ebayAuth.js';

export const SCOPES = ['commerce.identity.readonly','sell.account.readonly','sell.inventory.readonly'].map(s=>'https://api.ebay.com/oauth/api_scope/'+s);
export const hash = value => createHash('sha256').update(String(value)).digest('hex');
export const random = () => randomBytes(32).toString('hex');
export const STATE_COOKIE='__Host-cr-ebay-state', PENDING_COOKIE='__Host-cr-ebay-pending';
export function config(env=process.env) {
  const environment=cleanCredential(env.EBAY_SELLER_ENVIRONMENT)||'production';
  if(!['production','sandbox'].includes(environment))return null;
  const prefix=environment==='sandbox'?'EBAY_SANDBOX_':'EBAY_';
  const appId=cleanCredential(env[prefix+'APP_ID']),certId=cleanCredential(env[prefix+'CERT_ID']);
  const ruName=cleanCredential(env[prefix+'SELLER_REDIRECT_NAME']),key=cleanCredential(env.EBAY_SELLER_TOKEN_KEY);
  const origin=cleanCredential(env.EBAY_SELLER_ORIGIN)||'https://www.cardresell.org';
  let u;try{u=new URL(origin);}catch{return null;}
  if(env.EBAY_SELLER_CONNECT_ENABLED!=='true'||!appId||!certId||!ruName||!(/^[a-f\d]{64}$/i.test(key))||u.protocol!=='https:'||u.origin!==origin)return null;
  const sandbox=environment==='sandbox';
  return {environment,appId,certId,ruName,key,origin,api:sandbox?'https://api.sandbox.ebay.com':'https://api.ebay.com',identity:sandbox?'https://apiz.sandbox.ebay.com':'https://apiz.ebay.com',auth:sandbox?'https://auth.sandbox.ebay.com':'https://auth.ebay.com'};
}
export function namespace(environment='production') {return 'ebayseller:v1:'+environment+':';}
export function keys(environment,owner) {
  const prefix=namespace(environment);
  return {prefix,connection:prefix+'connection:'+owner,epoch:prefix+'epoch:'+owner,ownerIndex:prefix+'pending-owner:'+owner};
}
export function seal(payload,cfg,owner) {
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(cfg.key,'hex'),iv);
  cipher.setAAD(Buffer.from(namespace(cfg.environment)+owner));
  const encrypted=Buffer.concat([cipher.update(JSON.stringify(payload),'utf8'),cipher.final()]);
  return [iv,cipher.getAuthTag(),encrypted].map(b=>b.toString('base64url')).join('.');
}
export function unseal(value,cfg,owner) {
  const parts=String(value).split('.');if(parts.length!==3)throw Error('seller_token_invalid');
  const [iv,tag,data]=parts.map(s=>Buffer.from(s,'base64url'));
  if(iv.length!==12||tag.length!==16)throw Error('seller_token_invalid');
  const decipher=createDecipheriv('aes-256-gcm',Buffer.from(cfg.key,'hex'),iv);
  decipher.setAAD(Buffer.from(namespace(cfg.environment)+owner));decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(data),decipher.final()]).toString('utf8'));
}
export function parseRecord(raw) {return raw?JSON.parse(raw):null;}
export function cookie(req,name) {
  const hits=String(req.headers?.cookie||'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name+'='));
  const value=hits.length===1?hits[0].slice(name.length+1):'';
  return /^[a-f\d]{64}$/.test(value)?value:'';
}
export function cookieHeader(name,value,age=600) {return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${age}`;}
export async function limited(kv,key,maximum,seconds) {
  const n=await kv('EVAL',`local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n`,1,key,seconds);
  if(!Number.isFinite(Number(n))||Number(n)>maximum){const e=Error('Please wait before trying again.');e.status=429;throw e;}
}
export async function ebayJson(cfg,path,token,fetcher=fetch,identity=false) {
  const r=await fetcher((identity?cfg.identity:cfg.api)+path,{headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(12000)});
  if(!r.ok){const e=Error(r.status===401?'eBay authorization expired. Reconnect your account.':'eBay could not confirm your seller setup. Try again.');e.status=r.status===401?409:502;throw e;}
  return r.json();
}
export async function mint(cfg,values,fetcher=fetch) {
  const r=await fetcher(cfg.api+'/identity/v1/oauth2/token',{method:'POST',headers:{Authorization:'Basic '+Buffer.from(cfg.appId+':'+cfg.certId).toString('base64'),'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(values).toString(),signal:AbortSignal.timeout(12000)});
  if(!r.ok){const e=Error('eBay authorization could not be renewed. Reconnect your account.');e.status=409;throw e;}
  const data=await r.json();
  if(typeof data.access_token!=='string'||!data.access_token||!Number.isFinite(data.expires_in)||data.expires_in<=0||data.expires_in>86400)throw Error('seller_token_response_invalid');
  return data;
}
export const scripts={
  start:`local e=redis.call('GET',KEYS[2]) or '0';local c=redis.call('GET',KEYS[3]);local v='';if c then v=cjson.decode(c).version end;local s=cjson.decode(ARGV[1]);s.epoch=e;s.previousVersion=v;redis.call('SET',KEYS[1],cjson.encode(s),'EX',600);redis.call('SADD',KEYS[4],KEYS[1]);redis.call('EXPIRE',KEYS[4],1200);return 1`,
  consume:`local s=redis.call('GET',KEYS[1]);if not s then return nil end;local p=cjson.decode(s);if p.nonceHash~=ARGV[1] then return nil end;redis.call('DEL',KEYS[1]);return s`,
  pending:`if redis.call('EXISTS',KEYS[4])==1 or (redis.call('GET',KEYS[2]) or '0')~=ARGV[2] then return 0 end;local active=redis.call('SMEMBERS',KEYS[5]);for _,k in ipairs(active) do if redis.call('EXISTS',k)==0 then redis.call('SREM',KEYS[5],k) end end;if redis.call('SCARD',KEYS[5])>=100 then return -1 end;redis.call('SET',KEYS[1],ARGV[1],'EX',600);redis.call('SADD',KEYS[3],KEYS[1]);redis.call('EXPIRE',KEYS[3],1200);redis.call('SADD',KEYS[5],KEYS[1]);if redis.call('TTL',KEYS[5])<600 then redis.call('EXPIRE',KEYS[5],600) end;return 1`,
  finish:`local raw=redis.call('GET',KEYS[1]);if not raw or raw~=ARGV[1] then return 0 end;local p=cjson.decode(raw);if (redis.call('GET',KEYS[3]) or '0')~=p.epoch or redis.call('EXISTS',KEYS[5])==1 then return 0 end;local current=redis.call('GET',KEYS[2]);local v='';if current then v=cjson.decode(current).version end;if v~=p.previousVersion then return 0 end;local active=redis.call('SMEMBERS',KEYS[4]);local connections=0;for _,k in ipairs(active) do if redis.call('EXISTS',k)==0 then redis.call('SREM',KEYS[4],k) elseif string.find(k,':connection:',1,true) then connections=connections+1 end end;if connections>=20 and redis.call('SISMEMBER',KEYS[4],KEYS[2])==0 then return -1 end;if current then local a=cjson.decode(current).accountHash;redis.call('SREM',ARGV[4]..'account:'..a,KEYS[2]) end;redis.call('SET',KEYS[2],ARGV[2],'EX',ARGV[3]);redis.call('SADD',KEYS[4],KEYS[2]);redis.call('SREM',KEYS[4],KEYS[1]);if redis.call('TTL',KEYS[4])<tonumber(ARGV[3]) then redis.call('EXPIRE',KEYS[4],ARGV[3]) end;redis.call('DEL',KEYS[1]);redis.call('SREM',KEYS[6],KEYS[1]);return 1`,
  refresh:`if redis.call('GET',KEYS[1])~=ARGV[1] or redis.call('EXISTS',KEYS[2])==1 then return 0 end;redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]);return 1`,
  disconnect:`redis.call('INCR',KEYS[2]);local current=redis.call('GET',KEYS[1]);if current then redis.call('SREM',ARGV[1]..'account:'..cjson.decode(current).accountHash,KEYS[1]) end;redis.call('DEL',KEYS[1]);local pending=redis.call('SMEMBERS',KEYS[3]);for _,k in ipairs(pending) do local p=redis.call('GET',k);if p then local a=cjson.decode(p).accountHash;if a then redis.call('SREM',ARGV[1]..'account:'..a,k) end end;redis.call('DEL',k) end;redis.call('DEL',KEYS[3]);return 1`,
  deleted:`redis.call('SET',KEYS[2],'1','EX',3600);local rows=redis.call('SMEMBERS',KEYS[1]);for _,k in ipairs(rows) do redis.call('DEL',k) end;redis.call('DEL',KEYS[1]);return #rows`,
};
// Refresh uses compare-and-set. A concurrent disconnect/reconnect always wins;
// a delayed token response cannot resurrect a removed connection.
export async function access(kv,cfg,owner,fetcher=fetch) {
  const k=keys(cfg.environment,owner),raw=await kv('GET',k.connection),record=parseRecord(raw);
  if(!record){const e=Error('Connect your eBay account first.');e.status=409;throw e;}
  let data=unseal(record.cipher,cfg,owner);
  if(data.refreshExpiresAt<=Date.now()){const e=Error('eBay authorization expired. Reconnect your account.');e.status=409;throw e;}
  if(data.accessExpiresAt>Date.now()+120000)return {data,record,raw};
  const renewed=await mint(cfg,{grant_type:'refresh_token',refresh_token:data.refreshToken},fetcher);
  data={...data,accessToken:renewed.access_token,accessExpiresAt:Date.now()+renewed.expires_in*1000};
  const next={...record,cipher:seal(data,cfg,owner)};
  const ok=await kv('EVAL',scripts.refresh,2,k.connection,k.prefix+'deleted:'+record.accountHash,raw,JSON.stringify(next),Math.max(1,Math.floor((data.refreshExpiresAt-Date.now())/1000)));
  if(Number(ok)!==1){const e=Error('Your eBay connection changed. Refresh before trying again.');e.status=409;throw e;}
  return {data,record:next,raw:JSON.stringify(next)};
}
