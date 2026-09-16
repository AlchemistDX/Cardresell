// Temporary Preview-only evidence. Normal verified account required by caller.
// Durable, fixed synthetic browser-response-suppression evidence only.
import { createHash } from 'node:crypto';
import { STAGE2_CONTROL, STAGE2_END, STAGE2_RECOVERY_END, Stage2Error,
  stage2KV, stage2Keys, stage2Candidates } from './_previewIdStage2.js';
import { candidateHash, canonicalPick } from './_idBilling.js';
export const STAGE2_LOSS_CONTROL = 'preview_id_authenticated_http_loss:v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const hex = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const client = v => typeof v === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(v);
const only = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).every(k => keys.includes(k));
const stable = v => v === null || typeof v !== 'object' ? JSON.stringify(v)
  : Array.isArray(v) ? '[' + v.map(stable).join(',') + ']'
  : '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
const fail = code => { throw new Stage2Error(code); };
function record(raw, owner) {
  if (raw === null) return null;
  let r;
  try { r = JSON.parse(raw); } catch (_) { fail('loss_invalid_state'); }
  if (!r || r.version !== 1 || r.owner !== owner || typeof r.disarmed !== 'boolean') fail('loss_invalid_state');
  if (r.stage === 'not_armed' && r.disarmed && only(r, ['version','owner','stage','disarmed'])) return r;
  if (!only(r, ['version','owner','stage','disarmed','clientId','receipt','scan','candidateSet',
      'expires','requestHash','commitCorroborated','retryCorroborated','category'])
      || !client(r.clientId) || !hex(r.receipt) || !hex(r.scan) || !hex(r.candidateSet)
      || r.expires !== STAGE2_END || (r.requestHash !== null && !hex(r.requestHash))
      || !['armed','claimed','commit_observed','retry_observed','unknown'].includes(r.stage)
      || typeof r.commitCorroborated !== 'boolean' || typeof r.retryCorroborated !== 'boolean'
      || !['none','claim_unavailable','acceptance_unavailable','response_invalid','corroboration_unavailable'].includes(r.category))
    fail('loss_invalid_state');
  if ((r.stage === 'armed' && (r.requestHash !== null || r.commitCorroborated || r.retryCorroborated))
      || (['claimed','commit_observed','retry_observed'].includes(r.stage) && !hex(r.requestHash))
      || (r.stage === 'claimed' && (r.commitCorroborated || r.retryCorroborated))
      || (r.stage === 'commit_observed' && (!r.commitCorroborated || r.retryCorroborated))
      || (r.stage === 'retry_observed' && (!r.commitCorroborated || !r.retryCorroborated))
      || (r.stage === 'unknown' && (r.retryCorroborated || (r.commitCorroborated && !hex(r.requestHash))))
      || (r.stage === 'unknown' ? r.category === 'none' : r.category !== 'none'))
    fail('loss_invalid_state');
  return r;
}
function phase(s) {
  if (Date.now() >= STAGE2_END || s.state !== 'active' || s.phase !== 2 || s.step !== 'ready')
    fail('loss_phase_guard');
}
async function snapshot(s) {
  const f = s.fixtures[2];
  const keys = [STAGE2_CONTROL, STAGE2_LOSS_CONTROL, `id_billing:${f.receipt}`,
    ...stage2Keys(s), `scan:${f.scan}`];
  const values = await stage2KV('MGET', ...keys);
  if (!Array.isArray(values) || values.length !== keys.length
      || values.some(v => v !== null && typeof v !== 'string')) fail('loss_state_unavailable');
  if (values[0] !== JSON.stringify(s)) fail('state_conflict');
  return { keys, values, loss: record(values[1], s.owner) };
}
function journal(s, snap, state) {
  let j;
  try { j = JSON.parse(snap.values[2]); } catch (_) { fail('loss_journal_invalid'); }
  if (!j || j.state !== state || j.owner !== s.owner || j.scan !== s.fixtures[2].scan
      || j.mode !== 'identify' || j.candidate_set !== s.confirmation.candidate_set
      || snap.values[5] !== null) fail('loss_journal_invalid');
  return j;
}
function binding(s, r, body) {
  if (!r || r.disarmed || r.clientId !== body.clientId || r.receipt !== s.fixtures[2].receipt
      || r.scan !== s.fixtures[2].scan || r.candidateSet !== s.confirmation.candidate_set)
    fail('loss_binding_guard');
}
function request(s, text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 16384) fail('loss_input_guard');
  let b;
  try { b = JSON.parse(text); } catch (_) { fail('loss_input_guard'); }
  if (!only(b, ['confirmation_id','scan_id','candidate_set','mode','candidate'])
      || b.confirmation_id !== s.fixtures[2].receipt || b.scan_id !== s.fixtures[2].scan
      || b.candidate_set !== s.confirmation.candidate_set || b.mode !== 'identify'
      || !b.candidate || stable(b.candidate) !== stable(stage2Candidates()[6])) fail('loss_binding_guard');
  return hash(text);
}
function accepted(s, snap, responseText) {
  const j = journal(s, snap, 'accepted');
  if (snap.values[3] !== '5' || snap.values[4] !== '1'
      || j.selected !== candidateHash(stage2Candidates()[6])) fail('loss_commit_unconfirmed');
  let recorded, response;
  try { recorded = JSON.parse(j.result_json); response = JSON.parse(responseText); }
  catch (_) { fail('loss_response_invalid'); }
  if (!recorded || !response || response.ok !== true || response.bucket !== 'id_free'
      || response.scan_id !== s.fixtures[2].scan
      || stable(recorded) !== stable(j.result) || stable(response) !== stable(recorded)
      || stable(recorded.pickedCard) !== stable(canonicalPick(stage2Candidates()[6])))
    fail('loss_response_invalid');
}
export const STAGE2_LOSS_TRANSITION = `
local now=tonumber(redis.call('TIME')[1])*1000
if now>=tonumber(ARGV[1]) then return -1 end
for i=1,#KEYS do
 local value=redis.call('GET',KEYS[i]);local offset=3+(i-1)*2
 if ARGV[offset]=='0' then
  if value~=false then return 0 end
 elseif value~=ARGV[offset+1] then return 0 end
end
redis.call('SET',KEYS[2],ARGV[2])
return 1`;
async function transition(snap, next, recovery = false) {
  const r = await stage2KV('EVAL', STAGE2_LOSS_TRANSITION, snap.keys.length, ...snap.keys,
    recovery ? STAGE2_RECOVERY_END : STAGE2_END, JSON.stringify(next),
    ...snap.values.flatMap(v => v === null ? ['0',''] : ['1',v]));
  if (r !== 1) fail(r === -1 ? 'expired' : 'state_conflict');
  return next;
}
export function stage2LossProjection(r) {
  return {
    scope: 'browser-network response suppression, not physical packet loss',
    state: r?.stage || 'not_armed', disarmed: r?.disarmed || false,
    durableClaimConsumed: !!r?.requestHash,
    commitCorroborated: r?.commitCorroborated || false,
    matchingRetryCorroborated: r?.retryCorroborated || false,
    diagnosticCategory: r?.category || 'none',
    browserRetryClick: 'NOT_OBSERVED_BY_SERVER',
    responseSuppressionDelivery: 'NOT_OBSERVED_BY_SERVER',
  };
}
export async function stage2LossStatus(s) {
  return stage2LossProjection(record(await stage2KV('GET', STAGE2_LOSS_CONTROL), s.owner));
}
export async function stage2LossDisarm(s) {
  const snap = await snapshot(s);
  if (snap.loss?.disarmed) return stage2LossProjection(snap.loss);
  const r = snap.loss ? { ...snap.loss, disarmed: true }
    : { version: 1, owner: s.owner, stage: 'not_armed', disarmed: true };
  return stage2LossProjection(await transition(snap, r, true));
}
export async function stage2LossAction(s, action, body) {
  phase(s);
  const extras = action === 'loss-arm' ? ['clientId']
    : action === 'loss-claim' ? ['clientId','requestBody']
    : action === 'loss-unknown' ? ['clientId','requestBody','category']
    : ['clientId','requestBody','responseBody'];
  if (!['loss-arm','loss-claim','loss-commit','loss-retry','loss-unknown'].includes(action)
      || !only(body, ['action', ...extras]) || !client(body.clientId)) fail('loss_input_guard');
  const snap = await snapshot(s), r = snap.loss;
  if (action === 'loss-arm') {
    if (r) fail('loss_already_consumed');
    journal(s, snap, 'pending');
    if (snap.values[3] !== '4' || snap.values[4] !== '1') fail('loss_balance_guard');
    const armed = { version: 1, owner: s.owner, stage: 'armed', disarmed: false,
      clientId: body.clientId, receipt: s.fixtures[2].receipt, scan: s.fixtures[2].scan,
      candidateSet: s.confirmation.candidate_set, expires: STAGE2_END, requestHash: null,
      commitCorroborated: false, retryCorroborated: false, category: 'none' };
    await transition(snap, armed);
    return { ...stage2LossProjection(armed), binding: {
      clientId: armed.clientId, receipt: armed.receipt, scan: armed.scan,
      candidateSet: armed.candidateSet, expires: armed.expires } };
  }
  binding(s, r, body);
  const digest = request(s, body.requestBody);
  if (action === 'loss-unknown') {
    if (!['armed','claimed','commit_observed'].includes(r.stage)
        || (r.requestHash !== null && r.requestHash !== digest)
        || !['claim_unavailable','acceptance_unavailable','response_invalid','corroboration_unavailable'].includes(body.category))
      fail('loss_input_guard');
    return stage2LossProjection(await transition(snap, { ...r, stage: 'unknown', category: body.category }));
  }
  if (action === 'loss-claim') {
    if (r.stage !== 'armed' || r.requestHash !== null) fail('loss_already_consumed');
    journal(s, snap, 'pending');
    if (snap.values[3] !== '4' || snap.values[4] !== '1') fail('loss_balance_guard');
    return stage2LossProjection(await transition(snap, { ...r, stage: 'claimed', requestHash: digest }));
  }
  if (r.requestHash !== digest || (action === 'loss-commit' ? r.stage !== 'claimed' : r.stage !== 'commit_observed'))
    fail('loss_binding_guard');
  if (typeof body.responseBody !== 'string' || Buffer.byteLength(body.responseBody) > 16384)
    fail('loss_input_guard');
  accepted(s, snap, body.responseBody);
  return stage2LossProjection(await transition(snap, { ...r,
    stage: action === 'loss-commit' ? 'commit_observed' : 'retry_observed',
    commitCorroborated: true, retryCorroborated: action === 'loss-retry' }));
}
