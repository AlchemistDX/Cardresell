/* Dormant, side-effect-free workflow journal. No network, billing, storage or
 * entitlement authority. The integrating client must persist a pending journal
 * BEFORE dispatch and use existing authenticated collection/draft adapters.
 * Receipts are recorded only after those adapters verify their real response. */
export const WORKFLOW_VERSION = 1;
export const MAX_SESSION_COPIES = 500;
export const MAX_SESSION_BYTES = 512000;
const kinds = ['save', 'draft'];
const cardFields = ['name','game','setCode','setName','number','variant','language','condition','grader','grade'];
const fail = code => { throw new Error(code); };
const plain = v => v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
function keys(v, allowed) {
  if (!plain(v) || Object.keys(v).some(k => !allowed.includes(k))) fail('WORKFLOW_INVALID_FIELDS');
}
function id(v) {
  if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) fail('WORKFLOW_INVALID_ID');
  return v;
}
function time(v) {
  if (!Number.isSafeInteger(v) || v < 0) fail('WORKFLOW_INVALID_TIME');
  return v;
}
function cost(v) {
  if (v === null) return null;
  if (!Number.isSafeInteger(v) || v < 0) fail('WORKFLOW_INVALID_COST');
  return v;
}
function card(v) {
  keys(v, cardFields);
  const result = {};
  for (const k of cardFields) {
    const value = v[k] ?? '';
    if (typeof value !== 'string' || value.length > 200 || /[\u0000-\u001f]/.test(value)) fail('WORKFLOW_INVALID_CARD');
    result[k] = value.trim();
  }
  return result;
}
const snapshot = u => ({ copyId:u.copyId, collectionId:u.collectionId, instanceId:u.instanceId,
  card:structuredClone(u.card), costCents:u.costCents });
function unit(v) {
  keys(v, ['copyId','collectionId','instanceId','card','costCents','review','operations']);
  const u = { copyId:id(v.copyId), collectionId:id(v.collectionId), instanceId:id(v.instanceId),
    card:card(v.card), costCents:cost(v.costCents ?? null), review:v.review ?? 'pending', operations:{save:null,draft:null} };
  if (!['pending','confirmed'].includes(u.review)) fail('WORKFLOW_INVALID_REVIEW');
  if (u.review === 'confirmed' && (!u.card.name || !u.card.game)) fail('WORKFLOW_MISSING_IDENTITY');
  keys(v.operations ?? {}, kinds);
  for (const kind of kinds) {
    const op = v.operations?.[kind];
    if (op == null) continue;
    keys(op,['id','state','payload','receipt']);
    if (!['pending','uncertain','blocked','confirmed'].includes(op.state)) fail('WORKFLOW_INVALID_OPERATION');
    // Only canonical metadata enters a recoverable payload. No photos or tokens.
    const expected = snapshot(u);
    keys(op.payload, Object.keys(expected));
    const payload = {copyId:id(op.payload.copyId),collectionId:id(op.payload.collectionId),instanceId:id(op.payload.instanceId),
      card:card(op.payload.card),costCents:cost(op.payload.costCents)};
    if (JSON.stringify(payload) !== JSON.stringify(expected) || u.review !== 'confirmed') fail('WORKFLOW_PAYLOAD_MISMATCH');
    let receipt = null;
    if (op.state === 'confirmed') {
      keys(op.receipt,['id']); receipt={id:id(op.receipt.id)};
      if (kind === 'save' && receipt.id !== u.collectionId) fail('WORKFLOW_RECEIPT_MISMATCH');
      if (kind === 'draft' && !/^drf_[a-f0-9]{32}$/.test(receipt.id)) fail('WORKFLOW_RECEIPT_MISMATCH');
    } else if (op.receipt != null) fail('WORKFLOW_RECEIPT_MISMATCH');
    u.operations[kind] = {id:id(op.id),state:op.state,payload,receipt};
  }
  if (u.operations.draft && u.operations.save?.state !== 'confirmed') fail('WORKFLOW_SAVE_NOT_CONFIRMED');
  return u;
}
function validate(value) {
  keys(value,['version','id','ownerId','revision','createdAt','updatedAt','units']);
  if (value.version !== WORKFLOW_VERSION) fail('WORKFLOW_UNSUPPORTED_VERSION');
  if (!Number.isSafeInteger(value.revision) || value.revision < 0) fail('WORKFLOW_INVALID_REVISION');
  if (!Array.isArray(value.units) || !value.units.length || value.units.length > MAX_SESSION_COPIES) fail('WORKFLOW_INVALID_SIZE');
  const out={version:WORKFLOW_VERSION,id:id(value.id),ownerId:id(value.ownerId),revision:value.revision,
    createdAt:time(value.createdAt),updatedAt:time(value.updatedAt),units:value.units.map(unit)};
  if (out.updatedAt < out.createdAt) fail('WORKFLOW_INVALID_TIME');
  for (const field of ['copyId','collectionId','instanceId']) {
    if (new Set(out.units.map(u=>u[field])).size !== out.units.length) fail('WORKFLOW_DUPLICATE_ID');
  }
  const ops=out.units.flatMap(u=>kinds.map(k=>u.operations[k]?.id).filter(Boolean));
  if (new Set(ops).size !== ops.length) fail('WORKFLOW_DUPLICATE_OPERATION');
  if (new TextEncoder().encode(JSON.stringify(out)).length > MAX_SESSION_BYTES) fail('WORKFLOW_TOO_LARGE');
  return out;
}
export function createSession({id:sessionId,ownerId,units,now}) {
  if (!Array.isArray(units)) fail('WORKFLOW_INVALID_SIZE');
  return validate({version:WORKFLOW_VERSION,id:sessionId,ownerId,revision:0,createdAt:now,updatedAt:now,
    units:units.map(u=>({...u,review:'pending',operations:{save:null,draft:null}}))});
}
function edit(session, {ownerId,revision,now}, mutate) {
  const next=validate(session);
  if (next.ownerId !== ownerId) fail('WORKFLOW_ACCOUNT_CHANGED');
  if (next.revision !== revision) fail('WORKFLOW_REVISION_CONFLICT');
  if (time(now) < next.updatedAt) fail('WORKFLOW_INVALID_TIME');
  if (mutate(next) === false) return next;
  next.revision++;next.updatedAt=now;
  return validate(next);
}
const find = (s,copyId) => s.units.find(u=>u.copyId===copyId) || fail('WORKFLOW_COPY_NOT_FOUND');
export function reviewUnit(session, options) {
  return edit(session,options,s=>{
    const u=find(s,options.copyId);
    if (kinds.some(k=>u.operations[k])) fail('WORKFLOW_OPERATION_LOCKED');
    keys(options.patch ?? {},['card','costCents']);
    if (options.patch?.card) u.card=card({...u.card,...options.patch.card});
    if (Object.hasOwn(options.patch ?? {},'costCents')) u.costCents=cost(options.patch.costCents);
    // The caller presents exact-printing details and receives explicit review.
    // This is not an automatic recognition score or a server eligibility grant.
    u.review=options.confirmed === true?'confirmed':'pending';
  });
}
export function beginOperation(session, options) {
  return edit(session,options,s=>{
    if (!kinds.includes(options.kind)) fail('WORKFLOW_INVALID_KIND');
    const u=find(s,options.copyId), operationId=id(options.operationId);
    if (u.review !== 'confirmed') fail('WORKFLOW_REVIEW_REQUIRED');
    if (s.units.some(row=>kinds.some(k=>row.operations[k]?.state==='uncertain'))) fail('WORKFLOW_RECONCILE_REQUIRED');
    if (options.kind === 'draft' && u.operations.save?.state !== 'confirmed') fail('WORKFLOW_SAVE_NOT_CONFIRMED');
    const prior=u.operations[options.kind];
    if (prior) {
      if (prior.id !== operationId) fail('WORKFLOW_OPERATION_CONFLICT');
      return false; // do not dispatch again merely because prepare was repeated
    }
    u.operations[options.kind]={id:operationId,state:'pending',payload:snapshot(u),receipt:null};
  });
}
export function settleOperation(session, options) {
  return edit(session,options,s=>{
    if (!kinds.includes(options.kind)) fail('WORKFLOW_INVALID_KIND');
    const u=find(s,options.copyId), op=u.operations[options.kind];
    if (!op || op.id !== options.operationId) fail('WORKFLOW_OPERATION_CONFLICT');
    if (!['confirmed','uncertain','blocked'].includes(options.outcome)) fail('WORKFLOW_INVALID_OUTCOME');
    const receipt=options.outcome==='confirmed'?options.receipt:null;
    if (['confirmed','blocked'].includes(op.state)) {
      if (op.state===options.outcome && JSON.stringify(op.receipt)===JSON.stringify(receipt)) return false;
      fail('WORKFLOW_TERMINAL_OPERATION');
    }
    op.state=options.outcome;op.receipt=receipt;
  });
}
export function resumeOperation(session, options) {
  return edit(session,options,s=>{
    if (!kinds.includes(options.kind)) fail('WORKFLOW_INVALID_KIND');
    const op=find(s,options.copyId).operations[options.kind];
    if (!op || op.id!==options.operationId) fail('WORKFLOW_OPERATION_CONFLICT');
    if (!['pending','uncertain'].includes(op.state)) fail('WORKFLOW_TERMINAL_OPERATION');
    op.state='pending'; // same immutable ID and payload for adapter reconciliation
  });
}
export function serializeSession(session) { return JSON.stringify(validate(session)); }
export function restoreSession(serialized, ownerId) {
  if (typeof serialized !== 'string' || new TextEncoder().encode(serialized).length>MAX_SESSION_BYTES) fail('WORKFLOW_TOO_LARGE');
  let value;try{value=JSON.parse(serialized)}catch{fail('WORKFLOW_CORRUPT_RECORD')}
  const s=validate(value);if(s.ownerId!==ownerId)fail('WORKFLOW_ACCOUNT_CHANGED');return s;
}
export function sessionStorageKey(ownerId, sessionId) { return `cr_seller_batch_v1:${id(ownerId)}:${id(sessionId)}`; }
export function allocateCostCents(totalCents, copies) {
  if (!Number.isInteger(copies) || copies<1 || copies>MAX_SESSION_COPIES) fail('WORKFLOW_INVALID_SIZE');
  const total=cost(totalCents);
  if(total===null)return Array(copies).fill(null);
  const each=Math.floor(total/copies), remainder=total%copies;
  return Array.from({length:copies},(_,i)=>each+(i<remainder?1:0));
}
