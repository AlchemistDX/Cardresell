import {createPublicKey,verify as verifySignature} from 'node:crypto';
import {getEbayAppToken} from './_ebayAuth.js';
import {hash,namespace,scripts} from './_ebaySeller.js';
import {kvFromEnv} from './_kv.js';

const publicKeys=new Map();
export async function verifyNotification(raw,header,{fetcher=fetch,appToken=getEbayAppToken}={}) {
  if(typeof header!=='string'||header.length>4096)return false;
  let sig;try{sig=JSON.parse(Buffer.from(header,'base64').toString('utf8'));}catch{return false;}
  if(typeof sig.kid!=='string'||!/^[A-Za-z0-9_-]{1,200}$/.test(sig.kid)||String(sig.alg).toLowerCase()!=='ecdsa'||!['SHA1','SHA256'].includes(String(sig.digest).toUpperCase())||typeof sig.signature!=='string'||sig.signature.length>1024)return false;
  let info=publicKeys.get(sig.kid);
  if(!info||info.until<Date.now()) {
    const token=await appToken();
    const r=await fetcher('https://api.ebay.com/commerce/notification/v1/public_key/'+encodeURIComponent(sig.kid),{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(12000)});
    if(!r.ok)throw Error('notification_key_unavailable');
    const data=await r.json();
    if(typeof data.key!=='string'||data.key.length>4096)throw Error('notification_key_invalid');
    const key=createPublicKey(data.key.includes('-----BEGIN PUBLIC KEY-----')?data.key:{key:Buffer.from(data.key,'base64'),format:'der',type:'spki'});
    if(key.asymmetricKeyType!=='ec'||String(data.algorithm).toLowerCase()!=='ecdsa'||!['SHA1','SHA256'].includes(String(data.digest).toUpperCase()))throw Error('notification_key_invalid');
    info={key,digest:String(data.digest).toUpperCase(),until:Date.now()+3600000};
    if(publicKeys.size>=32)publicKeys.delete(publicKeys.keys().next().value);publicKeys.set(sig.kid,info);
  }
  if(info.digest!==String(sig.digest).toUpperCase())return false;
  return verifySignature(info.digest.toLowerCase(),raw,info.key,Buffer.from(sig.signature,'base64'));
}
export async function readNotificationBody(req) {
  if(Buffer.isBuffer(req.body)||typeof req.body==='string') {
    const b=Buffer.from(req.body);if(b.length>65536)throw Error('notification_too_large');return b;
  }
  if(req.body && typeof req.body==='object')throw Error('notification_raw_body_required');
  const chunks=[];let size=0;
  for await(const c of req){const b=Buffer.from(c);size+=b.length;if(size>65536)throw Error('notification_too_large');chunks.push(b);}
  return Buffer.concat(chunks);
}
export async function deleteSellerData(body,kv=kvFromEnv()) {
  const userId=body?.notification?.data?.userId;
  if(body?.metadata?.topic!=='MARKETPLACE_ACCOUNT_DELETION'||typeof userId!=='string'||!userId||userId.length>200)throw Error('notification_payload_invalid');
  if(!kv)throw Error('notification_storage_unavailable');
  const prefix=namespace('production'),account=hash(userId);
  return kv('EVAL',scripts.deleted,2,prefix+'account:'+account,prefix+'deleted:'+account);
}
