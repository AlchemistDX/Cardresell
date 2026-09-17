// TEMPORARY dedicated-account acceptance policy. Never a Production entitlement.
// No secret configuration is read except internally by the existing KV transport.
import { randomBytes } from 'node:crypto';
export const STAGE2_BRANCH = 'fix/listing-export-identity';
export const STAGE2_STABLE_HOST = 'cardresell-git-fix-listing-exp-1de09c-willsep200-9430s-projects.vercel.app';
export const STAGE2_PATH = '/api/preview-id-authenticated-acceptance';
export const STAGE2_CONTROL = 'preview_id_authenticated_acceptance:v1';
export const STAGE2_END = Date.parse('2026-09-19T00:00:00Z');
export const STAGE2_RECOVERY_END = Date.parse('2026-09-23T18:00:00Z');
export const stage2Scoped = () => process.env.VERCEL_ENV === 'preview'
  && (process.env.VERCEL_GIT_COMMIT_REF === STAGE2_BRANCH || !process.env.VERCEL_GIT_COMMIT_REF);
export const stage2Denied = res => res.status(503).json({ ok: false, error: 'preview_acceptance_only' });
export class Stage2Error extends Error {
  constructor(code = 'state_unavailable') { super(code); this.code = code; }
}
export function stage2Configuration() {
  if (!process.env.KV_REST_API_URL || !process.env.KV_REST_API_TOKEN) throw new Stage2Error('configuration');
  try {
    const u = new URL(process.env.KV_REST_API_URL);
    if (!/^https:\/\/[a-z0-9.-]+\.upstash\.io\/?$/i.test(process.env.KV_REST_API_URL)
        || u.protocol !== 'https:' || !u.hostname.endsWith('.upstash.io') || u.username || u.password
        || u.port || u.search || u.hash || u.pathname !== '/') throw new Error();
  } catch (_) { throw new Stage2Error('configuration'); }
}
export async function stage2KV(...args) {
  stage2Configuration();
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  try {
    const r = await fetch(url, { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json' }, body: JSON.stringify(args), signal: AbortSignal.timeout(3000) });
    if (!r.ok) throw new Stage2Error();
    const d = await r.json();
    if (d.error || !Object.hasOwn(d, 'result')) throw new Stage2Error();
    return d.result;
  } catch (_) { throw new Stage2Error(); }
}
export function stage2Guard(req, path, recovery = false) {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== STAGE2_BRANCH)
    throw new Stage2Error('deployment_guard');
  if (Date.now() >= (recovery ? STAGE2_RECOVERY_END : STAGE2_END)) throw new Stage2Error('expired');
  const immutableHost = process.env.VERCEL_URL;
  const host = req.headers.host;
  if (!immutableHost || !/^[a-z0-9-]+\.vercel\.app$/.test(immutableHost)
      || immutableHost === 'cardresell.vercel.app'
      || ![immutableHost, STAGE2_STABLE_HOST].includes(host))
    throw new Stage2Error('host_guard');
  if ((req.query && Object.keys(req.query).length) || (req.url || '').includes('?'))
    throw new Stage2Error('query_guard');
  // Explicit public URL and Vercel's configured fixed .js rewrite only.
  if (![path, path + '.js'].includes(req.url)) throw new Stage2Error('path_guard');
  if (req.method !== 'GET' && (req.headers.origin !== `https://${host}`
      || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')))
    throw new Stage2Error('origin_guard');
  stage2Configuration();
  // Return only the exact accepted request authority; never render a different
  // allowed host into this origin's iframe/CSP or use it for POST validation.
  return host;
}
const id = v => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const only = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).every(k => keys.includes(k));
const observationValid = o => {
  if (only(o, ['status']) && o.status === 'UNAVAILABLE') return true;
  if (only(o, ['phase', 'name']) && o.phase === -1 && o.name === 'not_started') return true;
  return only(o, ['phase', 'name', 'HTTPResponseLossProof', 'free', 'paid',
    'acceptedJournals', 'journalState', 'canonicalSeventh', 'successfulScanRecords'])
    && Number.isInteger(o.phase) && o.phase >= 0 && o.phase <= 3
    && ['cancel', 'accept_and_duplicates', 'acceptance_for_external_HTTP_loss_test', 'reject_after_depletion'].includes(o.name)
    && o.HTTPResponseLossProof === 'NOT_OBSERVED_BY_SERVER_FIXTURE'
    && [o.free, o.paid].every(n => n === null || (Number.isSafeInteger(n) && n >= 0))
    && [0, 1].includes(o.acceptedJournals) && [0, 1].includes(o.successfulScanRecords)
    && ['pending', 'accepted', 'debited', 'cancelled', 'refunded'].includes(o.journalState)
    && typeof o.canonicalSeventh === 'boolean';
};
export function validateStage2(s) {
  if (!only(s, ['version', 'namespace', 'owner', 'stamp', 'state', 'phase', 'step',
    'expires', 'fixtures', 'observations', 'confirmation', 'finalObservation'])
      || s.version !== 1 || typeof s.owner !== 'string' || !s.owner || s.owner.length > 128
      || !id(s.namespace) || !/^\d{4}_\d{2}$/.test(s.stamp)
      || !['active', 'closed'].includes(s.state) || !Number.isInteger(s.phase)
      || s.phase < -1 || s.phase > 3 || !['idle', 'preparing', 'ready', 'closed'].includes(s.step)
      || !Array.isArray(s.fixtures) || s.fixtures.length !== 4
      || !s.fixtures.every(f => only(f, ['receipt', 'scan']) && id(f.receipt) && id(f.scan))
      || new Set(s.fixtures.map(f => f.receipt)).size !== 4
      || new Set(s.fixtures.map(f => f.scan)).size !== 4
      || s.expires !== STAGE2_END
      || (s.observations !== undefined && (!Array.isArray(s.observations) || s.observations.length > 3 || !s.observations.every(observationValid)))
      || (s.finalObservation !== undefined && !observationValid(s.finalObservation))
      || (s.state === 'active' && s.phase === -1 && s.step !== 'idle')
      || (s.state === 'closed' && s.step !== 'closed')
      || (s.step === 'ready' && (!only(s.confirmation, ['confirmation_id', 'scan_id',
        'candidate_set', 'confirmation_expires_at']) || s.confirmation.confirmation_id !== s.fixtures[s.phase]?.receipt
        || s.confirmation.scan_id !== s.fixtures[s.phase]?.scan || !id(s.confirmation.candidate_set)
        || !Number.isSafeInteger(s.confirmation.confirmation_expires_at))))
    throw new Stage2Error('invalid_state');
  return s;
}
export async function stage2State() {
  const raw = await stage2KV('GET', STAGE2_CONTROL);
  if (raw === null) return null;
  try { return validateStage2(JSON.parse(raw)); }
  catch (_) { throw new Stage2Error('invalid_state'); }
}
export async function stage2Owner(user) {
  if (process.env.VERCEL_ENV !== 'preview' || process.env.VERCEL_GIT_COMMIT_REF !== STAGE2_BRANCH
      || Date.now() >= STAGE2_END) throw new Stage2Error('expired');
  const s = await stage2State();
  if (!s || s.state !== 'active' || s.owner !== user.uid || s.step !== 'ready')
    throw new Stage2Error('setup_required');
  return s;
}
export async function stage2Entitlement(user) {
  const s = await stage2Owner(user);
  return { grant: 5, stamp: s.stamp }; // explicitly synthetic verified-free-sized entitlement
}
export function stage2Keys(s) {
  return [`scans:${s.owner}:id_free_used_${s.stamp}`, `scans:${s.owner}:id_paid_left`];
}
export const STAGE2_CAS = `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
redis.call('SET',KEYS[1],ARGV[2])
return 1`;
export async function stage2Replace(before, after) {
  const changed = await stage2KV('EVAL', STAGE2_CAS, 1, STAGE2_CONTROL,
    JSON.stringify(before), JSON.stringify(after));
  if (changed !== 1) throw new Stage2Error('state_conflict');
}
export const STAGE2_CLAIM = `
if redis.call('EXISTS',KEYS[1])==1 then return 0 end
for i=2,#KEYS do if redis.call('EXISTS',KEYS[i])==1 then return -1 end end
redis.call('SET',KEYS[1],ARGV[1])
return 1`;
export async function stage2Bind(user) {
  if (!user.uid || !user.email || !user.emailVerified) throw new Stage2Error('verified_account_required');
  const stamp = new Date().toISOString().slice(0, 7).replace('-', '_');
  const s = { version: 1, namespace: randomBytes(32).toString('hex'), owner: user.uid,
    stamp, state: 'active', phase: -1, step: 'idle', expires: STAGE2_END,
    fixtures: Array.from({ length: 4 }, () => ({ receipt: randomBytes(32).toString('hex'),
      scan: randomBytes(32).toString('hex') })) };
  // Strict fresh-account refusal. All these baselines must be absent. No auth
  // mapping/referral/verification fixture is written by this temporary flow.
  const keys = [STAGE2_CONTROL, 'preview_id_authenticated_http_loss:v1', ...stage2Keys(s), `pro:${user.uid}`,
    `scans:${user.uid}:paid_left`, `email_verified:${user.uid}`, `verified_email:${user.uid}`,
    `uid_by_email:${user.email.toLowerCase().trim()}`,
    ...s.fixtures.flatMap(f => [`id_billing:${f.receipt}`, `scan:${f.scan}`])];
  const result = await stage2KV('EVAL', STAGE2_CLAIM, keys.length, ...keys, JSON.stringify(s));
  if (result !== 1) throw new Stage2Error(result === 0 ? 'already_consumed' : 'account_not_empty');
  return s;
}
export const stage2Candidates = () => Array.from({ length: 9 }, (_, i) => ({
  name: 'Stage 2 Synthetic Card', number: '58', set: `Synthetic Set ${i + 1}`,
  set_code: `stage2-${i + 1}`, card_type: 'pokemon', rarity: 'Synthetic fixture',
}));
export async function stage2Observation(s, snapshot) {
  const f = s.fixtures[s.phase];
  if (!f) return { phase: -1, name: 'not_started' };
  const values = snapshot || await stage2KV('MGET', ...stage2Keys(s), `id_billing:${f.receipt}`, `scan:${f.scan}`);
  if (!Array.isArray(values) || values.length !== 4) throw new Stage2Error();
  const number = v => typeof v === 'string' && /^\d+$/.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null;
  const used = number(values[0]), paid = number(values[1]);
  let journal;
  try { journal = JSON.parse(values[2]); } catch (_) { throw new Stage2Error('journal_invalid'); }
  if (!journal || journal.owner !== s.owner || journal.scan !== f.scan || journal.mode !== 'identify'
      || !['pending', 'accepted', 'debited', 'cancelled', 'refunded'].includes(journal.state))
    throw new Stage2Error('journal_invalid');
  let canonicalSeventh = false;
  if (journal.state === 'accepted') {
    try { canonicalSeventh = JSON.parse(journal.result_json).pickedCard.set_name === 'Synthetic Set 7'; }
    catch (_) { throw new Stage2Error('journal_invalid'); }
  }
  const observation = { phase: s.phase, name: ['cancel', 'accept_and_duplicates', 'acceptance_for_external_HTTP_loss_test', 'reject_after_depletion'][s.phase],
    HTTPResponseLossProof: 'NOT_OBSERVED_BY_SERVER_FIXTURE',
    free: used === null ? null : Math.max(0, 5 - used), paid,
    acceptedJournals: journal.state === 'accepted' ? 1 : 0,
    journalState: journal.state, canonicalSeventh, successfulScanRecords: values[3] === null ? 0 : 1 };
  Object.defineProperty(observation, '_journal', { value: values[2] }); // internal CAS bytes, never projected
  return observation;
}
export const STAGE2_BEGIN = `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
if ARGV[3]~='' then
 if redis.call('GET',KEYS[4])~=ARGV[3] or redis.call('GET',KEYS[2])~=ARGV[5] or redis.call('GET',KEYS[3])~=ARGV[6] then return 0 end
end
local writes={KEYS[1],ARGV[2],KEYS[2],'4',KEYS[3],'1'}
if ARGV[4]~='' then table.insert(writes,KEYS[4]);table.insert(writes,ARGV[4]) end
redis.call('MSET',unpack(writes))
return 1`;
export async function stage2Next(s) {
  if (s.state !== 'active' || s.phase >= 3 || !['idle', 'ready'].includes(s.step)) throw new Stage2Error('phase_guard');
  if (s.phase === 2) await (await import('./_previewIdStage2Loss.js')).stage2LossDisarm(s);
  let prior = null;
  if (s.phase >= 0) {
    prior = await stage2Observation(s);
    const accepted = s.phase !== 0;
    if (prior.free !== (accepted ? 0 : 1) || prior.paid !== 1
        || prior.acceptedJournals !== (accepted ? 1 : 0)
        || (accepted && !prior.canonicalSeventh) || prior.successfulScanRecords !== 0)
      throw new Stage2Error('prior_phase_incomplete');
  }
  const next = { ...s, phase: s.phase + 1, step: 'preparing',
    observations: [...(s.observations || []), ...(prior ? [prior] : [])] };
  const previous = s.fixtures[Math.max(0, s.phase)];
  const terminal = s.phase === 0 ? JSON.stringify({ owner: s.owner, scan: previous.scan,
    mode: 'identify', state: 'cancelled' }) : '';
  if (await stage2KV('EVAL', STAGE2_BEGIN, 4, STAGE2_CONTROL, ...stage2Keys(s),
    `id_billing:${previous.receipt}`, JSON.stringify(s), JSON.stringify(next),
    prior?._journal || '', terminal, prior ? String(5 - prior.free) : '', prior ? String(prior.paid) : '') !== 1)
    throw new Stage2Error('state_conflict');
  // The durable manifest precedes these real billing writes. If interrupted,
  // only cleanup is allowed; no refill or unbounded re-execution endpoint.
  try {
    const { idBilling, offerIdConfirmation } = await import('./_idBilling.js');
    const f = next.fixtures[next.phase], context = { ...f, owner: next.owner, mode: 'identify',
      stamp: next.stamp, grant: 5 };
    const debit = await idBilling('debit', context);
    if (!debit.ok) throw new Stage2Error('billing_unavailable');
    const confirmation = await offerIdConfirmation(context, stage2Candidates());
    const ready = { ...next, step: 'ready', confirmation };
    await stage2Replace(next, ready);
    return ready;
  } catch (_) {
    // Ordinary failures get immediate cleanup. Termination/transport loss may
    // prevent it; the already-persisted manifest enables fixed recovery.
    try {
      const failed = await stage2State();
      if (failed?.state === 'active' && failed.owner === next.owner && failed.phase === next.phase)
        await stage2Cleanup(failed);
    } catch (_) { /* retain consumed control; explicit recovery remains available */ }
    throw new Stage2Error('phase_failed_read_status_or_cleanup');
  }
}
export function stage2Payload(s) {
  const candidates = stage2Candidates();
  return { ...s.confirmation, identified: false, printing: null, needs_confirmation: true,
    end_state: 'NEEDS_CONFIRMATION', identity_resolution: {
      candidates: candidates.slice(0, 3), all_candidates: candidates,
      candidate_count: 9, more_available: true, end_state: 'NEEDS_CONFIRMATION',
    } };
}
export const STAGE2_DEPLETE = `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
local raw=redis.call('GET',KEYS[4])
if not raw then return 0 end
local ok,rec=pcall(cjson.decode,raw)
if not ok or type(rec)~='table' or rec.state~='pending' then return 0 end
redis.call('MSET',KEYS[2],'5',KEYS[3],'0')
return 1`;
export const STAGE2_CLEANUP = `
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
-- Exact snapshot CAS includes missing keys, every journal and scan record.
-- Acceptance does not change the control; control-only CAS loses evidence.
for i=2,#KEYS do
 local value=redis.call('GET',KEYS[i])
 local offset=7+(i-2)*2
 if ARGV[offset]=='0' then
  if value~=false then return 0 end
 elseif value~=ARGV[offset+1] then return 0 end
end
-- Retained terminal journals fence delayed debit/offer/accept EVALs. Never
-- delete a journal and allow a late request to recreate/charge it.
local writes={KEYS[1],ARGV[2]}
for i=4,7 do table.insert(writes,KEYS[i]);table.insert(writes,ARGV[i-1]) end
redis.call('MSET',unpack(writes))
redis.call('DEL',KEYS[2],KEYS[3])
return 1`;
export async function stage2Cleanup(s) {
  if (s.state === 'closed') return s;
  // Server disarm must precede financial teardown and browser unregistration.
  // Retain this independent one-shot guard even when the worker was never armed.
  await (await import('./_previewIdStage2Loss.js')).stage2LossDisarm(s);
  const keys = [...stage2Keys(s), ...s.fixtures.map(f => `id_billing:${f.receipt}`),
    ...s.fixtures.map(f => `scan:${f.scan}`)];
  const snapshot = await stage2KV('MGET', ...keys);
  if (!Array.isArray(snapshot) || snapshot.length !== keys.length
      || snapshot.some(v => v !== null && typeof v !== 'string')) throw new Stage2Error();
  let observation;
  try { observation = await stage2Observation(s, [snapshot[0], snapshot[1],
    snapshot[2 + s.phase], snapshot[6 + s.phase]]); } catch (_) { observation = { status: 'UNAVAILABLE' }; }
  const closed = { ...s, state: 'closed', step: 'closed', finalObservation: observation };
  delete closed.confirmation;
  const tombstones = s.fixtures.map(f => JSON.stringify({ owner: s.owner, scan: f.scan,
    mode: 'identify', state: 'cancelled' }));
  const r = await stage2KV('EVAL', STAGE2_CLEANUP, keys.length + 1, STAGE2_CONTROL, ...keys,
    JSON.stringify(s), JSON.stringify(closed), ...tombstones,
    ...snapshot.flatMap(v => v === null ? ['0', ''] : ['1', v]));
  if (r !== 1) throw new Stage2Error('state_conflict');
  return closed;
}
export async function stage2Status(req, res) {
  try {
    stage2Guard(req, '/api/pro-status');
    if (req.method !== 'GET') return stage2Denied(res);
    const { verifyFirebaseToken } = await import('./_verifyToken.js');
    const user = await verifyFirebaseToken((req.headers.authorization || '').replace('Bearer ', '').trim());
    const s = await stage2Owner(user), o = await stage2Observation(s);
    return res.status(200).json({ tier: 'free', isPro: false, status: 'preview_synthetic_entitlement',
      idFreeLeft: o.free, idPaidLeft: o.paid, idTotalLeft: o.free + o.paid,
      freeScansLeft: 0, paidScansLeft: 0, totalScansLeft: 0 });
  } catch (_) { return stage2Denied(res); }
}
