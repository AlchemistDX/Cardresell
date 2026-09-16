import { verifyTokenFlexible } from './_verifyToken.js';
import { stage2Scoped, stage2Guard, stage2Owner, stage2Denied } from './_previewIdStage2.js';
import { idBilling, idEntitlement, candidateHash, idBillingFailure } from './_idBilling.js';

// Confirmation is not a generic debit API. Only a server-issued pending receipt
// and one of its exact offered candidates may consume a single ID entitlement.
export default async function handler(req, res) {
  if (stage2Scoped()) {
    try { stage2Guard(req, '/api/scan-debit-id'); } catch (_) { return stage2Denied(res); }
  }
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' });
  const token = (req.headers.authorization || '').replace('Bearer ', '').trim();
  if (token.length < 20) return res.status(401).json({ ok: false, error: 'Sign in required.' });
  let user;
  try { user = await verifyTokenFlexible(token, 'id-confirmation'); }
  catch (_) { return res.status(401).json({ ok: false, error: 'Invalid session.' }); }
  const owner = user.uid || user.email;
  if (!owner) return res.status(401).json({ ok: false, error: 'No user identity.' });
  const body = req.body || {};
  if (stage2Scoped()) {
    try {
      const s = await stage2Owner(user), f = s.fixtures[s.phase];
      if (body.confirmation_id !== f.receipt || body.scan_id !== f.scan) return stage2Denied(res);
    } catch (_) { return stage2Denied(res); }
  }
  if (!body.candidate || typeof body.candidate !== 'object' || Array.isArray(body.candidate)
      || typeof body.scan_id !== 'string' || body.scan_id.length > 64
      || typeof body.candidate_set !== 'string' || !/^[a-f0-9]{64}$/.test(body.candidate_set)
      || body.mode !== 'identify' || body.pickedCard !== undefined) {
    return res.status(400).json({ ok: false, error: 'Invalid confirmation.' });
  }
  try {
    const context = {
      receipt: body.confirmation_id, owner, scan: body.scan_id, mode: body.mode,
      candidate: candidateHash(body.candidate), candidate_set: body.candidate_set,
    };
    // Read-only atomic preflight returns completed replays without depending on
    // today's tier, grant, balance or the pending receipt's shorter expiry.
    let result = await idBilling('accept', context);
    if (result.code === 'entitlement_required') {
      result = await idBilling('accept', { ...context, ...await idEntitlement(user) });
    }
    if (!result.ok) return idBillingFailure(res, result);
    return res.status(200).json(result);
  } catch (error) { return idBillingFailure(res, error); }
}
