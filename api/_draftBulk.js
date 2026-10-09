import { createHash } from 'node:crypto';
import { validIdempotencyKey } from './_idempotency.js';
export const bulkKey = (owner, id) => 'draftbulk:' + createHash('sha256').update(JSON.stringify([owner, id])).digest('hex');
const reject = (code, policy) => { throw Object.assign(Error(code), { policy }); };
export async function prepareDraftBulk(kv, owner, body, policy) {
  if (!body || !validIdempotencyKey(body.id) || !Array.isArray(body.rows) || !body.rows.length
      || body.rows.length > 500 || body.rows.some(r => !r || typeof r.instanceId !== 'string'
        || !/^[A-Za-z0-9_-]{1,128}$/.test(r.instanceId) || !validIdempotencyKey(r.idemKey))
      || new Set(body.rows.map(r => r.instanceId)).size !== body.rows.length) reject('DRAFT_BATCH_INVALID');
  if (policy.bulkLimit <= 1 || body.rows.length > policy.bulkLimit) reject('DRAFT_BATCH_LIMIT', policy);
  const record = JSON.stringify({ owner, rows: body.rows.map(({instanceId, idemKey})=>({instanceId,idemKey})) });
  const key = bulkKey(owner, body.id);
  const prior = await kv('GET', key);
  if (prior !== null && prior !== record) reject('DRAFT_BATCH_MISMATCH');
  if (prior === null && await kv('SET', key, record, 'NX', 'EX', '86400') !== 'OK'
      && await kv('GET',key) !== record) reject('DRAFT_BATCH_MISMATCH');
  return { id: body.id, count: body.rows.length, bulkLimit: policy.bulkLimit };
}
export async function validateDraftBulk(kv, owner, id, instanceId, idemKey, policy) {
  if (!validIdempotencyKey(id)) reject('DRAFT_BATCH_INVALID');
  const raw=await kv('GET',bulkKey(owner,id));
  let record; try { record=JSON.parse(raw); } catch { reject('DRAFT_BATCH_UNAVAILABLE'); }
  if (!record || record.owner!==owner || !Array.isArray(record.rows)
    || !record.rows.some(r=>r.instanceId===instanceId && r.idemKey===idemKey)) reject('DRAFT_BATCH_UNAVAILABLE');
  if (policy.bulkLimit<=1 || record.rows.length>policy.bulkLimit) reject('DRAFT_BATCH_LIMIT',policy);
}
