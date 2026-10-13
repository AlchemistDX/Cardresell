// 2026-10-13 owner decision: complimentary ("comp") accounts.
//
// MEMBERSHIP_COMP_GRANTS is a sensitive JSON array (max 5) of
//   { "grant": "comp-YYYYMMDD-name", "email": "...", "id": 500, "grade": 500, "plan": "business" }
// Each grant is claimed ONCE, by the first signed-in account whose
// provider-verified email matches. The claim runs through the audited ledger
// (kind 'comp'): permanent credits plus, for plan "business", a feature record
// keyed by that account's UID. The grant ID is the ledger operation, so a
// second UID can never claim the same grant (operation_conflict), and a replay
// never adds credits twice. No Stripe object, subscription or price changes.
// Removing a grant from the env stops its Business features; credits already
// issued are permanent, like any other permanent credit.
import { createHash } from 'node:crypto';
import { grantMembership, MembershipLedgerError } from './_membershipLedger.js';
import { MEMBERSHIP_VERSION } from './_launchMembershipConfig.js';

const digest = value => createHash('sha256').update(value).digest('hex');
const prefix = `membership:${MEMBERSHIP_VERSION}:`;
export const COMP_MAX_GRANTS = 5;
export const COMP_MAX_CREDITS = 1000;
const GRANT_RE = /^comp-[a-z0-9-]{3,60}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function compFeatureKey(owner) { return `${prefix}comp_feature:${digest(owner)}`; }
export function compOperationKey(grant) { return `${prefix}comp:${digest(grant)}`; }

// Fail closed: any malformed entry disables the whole list.
export function parseCompGrants(raw) {
  if (raw === undefined || raw === null || raw === '') return [];
  let list;
  try { list = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(list) || list.length > COMP_MAX_GRANTS) return [];
  const seen = new Set(), out = [];
  for (const g of list) {
    if (!g || typeof g !== 'object' || Array.isArray(g)) return [];
    const keys = Object.keys(g).sort().join(',');
    if (keys !== 'email,grade,grant,id,plan') return [];
    const email = typeof g.email === 'string' ? g.email.trim().toLowerCase() : '';
    const ok = typeof g.grant === 'string' && GRANT_RE.test(g.grant) && !seen.has(g.grant)
      && email.length <= 254 && EMAIL_RE.test(email)
      && Number.isSafeInteger(g.id) && g.id >= 0 && g.id <= COMP_MAX_CREDITS
      && Number.isSafeInteger(g.grade) && g.grade >= 0 && g.grade <= COMP_MAX_CREDITS
      && (g.id + g.grade) > 0 && (g.plan === 'business' || g.plan === 'none');
    if (!ok) return [];
    seen.add(g.grant);
    out.push(Object.freeze({ grant: g.grant, email, id: g.id, grade: g.grade, plan: g.plan }));
  }
  return out;
}

// Business features for a UID that claimed a still-listed business comp grant.
export async function compFeaturePlan(owner, execute, env = process.env) {
  if (typeof owner !== 'string' || !owner || typeof execute !== 'function') return null;
  const grants = parseCompGrants(env.MEMBERSHIP_COMP_GRANTS);
  if (!grants.some(g => g.plan === 'business')) return null;
  let rec;
  try { rec = JSON.parse(await execute(['GET', compFeatureKey(owner)])); } catch { return null; }
  if (!rec || rec.version !== MEMBERSHIP_VERSION || rec.owner !== owner || rec.plan !== 'business') return null;
  return grants.some(g => g.grant === rec.grant && g.plan === 'business') ? 'business' : null;
}

// Claim any grant listed for this provider-verified email. Returns the
// grants newly applied for this owner (empty when nothing changed).
export async function claimCompGrants(identity, execute, env = process.env) {
  const grants = parseCompGrants(env.MEMBERSHIP_COMP_GRANTS);
  if (!grants.length || !identity || identity.emailVerified !== true
      || typeof identity.uid !== 'string' || !identity.uid || typeof identity.email !== 'string') return [];
  const email = identity.email.trim().toLowerCase();
  const applied = [];
  for (const g of grants.filter(x => x.email === email)) {
    // Cheap pre-check: a claimed grant (by anyone) is never re-evaluated here.
    if (await execute(['GET', compOperationKey(g.grant)]) !== null) continue;
    try {
      const r = await grantMembership(execute, 'comp',
        { owner: identity.uid, grantId: g.grant, idGrant: g.id, gradeGrant: g.grade, plan: g.plan });
      if (r.granted) applied.push(g.grant);
    } catch (e) {
      if (!(e instanceof MembershipLedgerError)) throw e;
      console.error('[comp] claim failed', g.grant, e.code);
    }
  }
  return applied;
}
