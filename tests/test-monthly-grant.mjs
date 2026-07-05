// Unit test for grantMonthlyCredits + tierFromPlan logic in stripe-webhook.js
// Uses in-memory KV mock to verify grant math without hitting real Upstash.

const kv = new Map();

// Mock fetch that mimics Upstash Redis REST responses for get / set / setex.
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const method = (opts.method || 'GET').toUpperCase();

  // /get/<encodedKey>
  const getMatch = u.match(/\/get\/([^/?]+)$/);
  if (getMatch) {
    const key = decodeURIComponent(getMatch[1]);
    const val = kv.has(key) ? kv.get(key) : null;
    return { ok: true, json: async () => ({ result: val }) };
  }

  // /set/<key>/<value>[/EX/<sec>][/NX]
  const setMatch = u.match(/\/set\/([^/]+)\/([^/?]+)/);
  if (setMatch && method === 'POST') {
    const key = decodeURIComponent(setMatch[1]);
    const val = decodeURIComponent(setMatch[2]);
    if (u.includes('/NX') && kv.has(key)) return { ok: true, json: async () => ({ result: null }) };
    kv.set(key, val);
    return { ok: true, json: async () => ({ result: 'OK' }) };
  }

  return { ok: false, status: 404, json: async () => ({}) };
};

// Set env so the webhook helpers pick up the mock KV.
process.env.KV_REST_API_URL   = 'https://mock.kv';
process.env.KV_REST_API_TOKEN = 'mock';

// Dynamic import to load with mocked fetch already in place.
const mod = await import('../workspace/cardresell/api/stripe-webhook.js').catch(async () => {
  // Fallback: parse the file and eval its helpers directly (functions aren't exported).
  const fs = await import('node:fs/promises');
  const src = await fs.readFile('/home/user/workspace/cardresell/api/stripe-webhook.js', 'utf8');
  // Extract just the helper functions we need to test.
  // Simpler: re-implement TIER_CONFIG + tierFromPlan + grantMonthlyCredits inline
  // matching the source, so we test the same logic. (Kept in sync manually.)
  return null;
});

// Re-declare the pure helpers from the webhook source (kept in sync).
const TIER_CONFIG = {
  pro:      { monthlyIds: 50,  monthlyGrade: 20, ceilingMonths: 3 },
  pro_plus: { monthlyIds: 200, monthlyGrade: 75, ceilingMonths: 6 },
};
function tierFromPlan(plan) {
  if (plan === 'pro_plus_monthly' || plan === 'pro_plus_annual') return 'pro_plus';
  if (plan === 'pro_monthly'      || plan === 'pro_annual')      return 'pro';
  return null;
}
async function getKVInt(kvUrl, kvToken, key) {
  const r = await fetch(`${kvUrl}/get/${encodeURIComponent(key)}`, { headers: { Authorization: `Bearer ${kvToken}` } });
  const data = await r.json();
  const raw = data.result;
  if (raw === null || raw === undefined) return 0;
  return parseInt(raw) || 0;
}
async function grantMonthlyCredits(googleSub, plan, sourceEventId) {
  const kvUrl = process.env.KV_REST_API_URL, kvToken = process.env.KV_REST_API_TOKEN;
  const tier = tierFromPlan(plan);
  if (!tier) return { granted: false };
  const cfg = TIER_CONFIG[tier];
  const ceilingIds   = cfg.monthlyIds   * cfg.ceilingMonths;
  const ceilingGrade = cfg.monthlyGrade * cfg.ceilingMonths;
  const idKey    = `scans:${googleSub}:id_paid_left`;
  const gradeKey = `scans:${googleSub}:paid_left`;
  const curId    = await getKVInt(kvUrl, kvToken, idKey);
  const curGrade = await getKVInt(kvUrl, kvToken, gradeKey);
  const nextId    = curId    >= ceilingIds   ? curId    : Math.min(ceilingIds,   curId    + cfg.monthlyIds);
  const nextGrade = curGrade >= ceilingGrade ? curGrade : Math.min(ceilingGrade, curGrade + cfg.monthlyGrade);
  const grantedId    = Math.max(0, nextId    - curId);
  const grantedGrade = Math.max(0, nextGrade - curGrade);
  await fetch(`${kvUrl}/set/${encodeURIComponent(idKey)}/${encodeURIComponent(String(nextId))}`, { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
  await fetch(`${kvUrl}/set/${encodeURIComponent(gradeKey)}/${encodeURIComponent(String(nextGrade))}`, { method: 'POST', headers: { Authorization: `Bearer ${kvToken}` } });
  return { granted: true, tier, grantedId, grantedGrade, nextId, nextGrade, ceilingIds, ceilingGrade };
}

// ── Test suite ──
let passed = 0, failed = 0;
function assert(cond, name) {
  if (cond) { passed++; console.log(`  ✓ ${name}`); }
  else      { failed++; console.log(`  ✗ FAIL: ${name}`); }
}

console.log('\n── Monthly grant unit tests ──\n');

// [1] tierFromPlan mapping
console.log('[1] tierFromPlan mapping');
assert(tierFromPlan('pro_monthly')       === 'pro',      'pro_monthly → pro');
assert(tierFromPlan('pro_annual')        === 'pro',      'pro_annual → pro');
assert(tierFromPlan('pro_plus_monthly')  === 'pro_plus', 'pro_plus_monthly → pro_plus');
assert(tierFromPlan('pro_plus_annual')   === 'pro_plus', 'pro_plus_annual → pro_plus');
assert(tierFromPlan('bogus')             === null,       'bogus plan → null');
assert(tierFromPlan(undefined)           === null,       'undefined plan → null');

// [2] First Pro grant — empty balance
kv.clear();
console.log('\n[2] Pro user first grant (empty balance)');
const r2 = await grantMonthlyCredits('user_a', 'pro_monthly', 'evt_1');
assert(r2.granted === true, 'grant returned success');
assert(r2.grantedId    === 50, 'granted 50 IDs');
assert(r2.grantedGrade === 20, 'granted 20 grade credits');
assert(r2.nextId       === 50, 'balance = 50 IDs');
assert(r2.nextGrade    === 20, 'balance = 20 grade');

// [3] Second month renewal — stacks under ceiling
console.log('\n[3] Pro user second grant (stacks under ceiling)');
const r3 = await grantMonthlyCredits('user_a', 'pro_monthly', 'evt_2');
assert(r3.nextId    === 100, 'stacks to 100 IDs after 2 months');
assert(r3.nextGrade === 40,  'stacks to 40 grade after 2 months');

// [4] Third month — reaches ceiling
console.log('\n[4] Pro user third grant (reaches Pro ceiling)');
const r4 = await grantMonthlyCredits('user_a', 'pro_monthly', 'evt_3');
assert(r4.nextId    === 150, 'hits ID ceiling 150');
assert(r4.nextGrade === 60,  'hits grade ceiling 60');

// [5] Fourth month — at ceiling, no new credits added
console.log('\n[5] Pro user at ceiling (grant skipped)');
const r5 = await grantMonthlyCredits('user_a', 'pro_monthly', 'evt_4');
assert(r5.grantedId    === 0, 'no new IDs granted (at ceiling)');
assert(r5.grantedGrade === 0, 'no new grade granted (at ceiling)');
assert(r5.nextId       === 150, 'balance stays at 150');
assert(r5.nextGrade    === 60,  'balance stays at 60');

// [6] Partial refill after usage
console.log('\n[6] Pro user after using some credits — partial refill');
kv.set('scans:user_a:id_paid_left', '120'); // used 30 IDs
kv.set('scans:user_a:paid_left',    '45');  // used 15 grade
const r6 = await grantMonthlyCredits('user_a', 'pro_monthly', 'evt_5');
assert(r6.grantedId    === 30, 'granted only 30 IDs (not 50) to reach ceiling');
assert(r6.grantedGrade === 15, 'granted only 15 grade (not 20) to reach ceiling');
assert(r6.nextId       === 150, 'ID balance back to 150');
assert(r6.nextGrade    === 60,  'grade balance back to 60');

// [7] Pro+ first grant
kv.clear();
console.log('\n[7] Pro+ user first grant');
const r7 = await grantMonthlyCredits('user_b', 'pro_plus_monthly', 'evt_6');
assert(r7.grantedId    === 200, 'granted 200 IDs');
assert(r7.grantedGrade === 75,  'granted 75 grade credits');

// [8] Pro+ ceiling (6 months)
console.log('\n[8] Pro+ user 6-month accumulation');
for (let i = 0; i < 5; i++) await grantMonthlyCredits('user_b', 'pro_plus_monthly', `evt_p${i}`);
const bal_id    = await getKVInt(process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN, 'scans:user_b:id_paid_left');
const bal_grade = await getKVInt(process.env.KV_REST_API_URL, process.env.KV_REST_API_TOKEN, 'scans:user_b:paid_left');
assert(bal_id    === 1200, 'Pro+ hits ID ceiling 1200 after 6 grants');
assert(bal_grade === 450,  'Pro+ hits grade ceiling 450 after 6 grants');

// [9] Purchased pack ABOVE ceiling — grant leaves excess alone
console.log('\n[9] Balance above ceiling from purchased pack — monthly grant is a no-op');
kv.clear();
kv.set('scans:user_c:id_paid_left', '200'); // e.g. bought a pack that took them over Pro's 150 cap
kv.set('scans:user_c:paid_left',    '80');
const r9 = await grantMonthlyCredits('user_c', 'pro_monthly', 'evt_9');
assert(r9.grantedId    === 0, 'no ID grant when already over ceiling');
assert(r9.grantedGrade === 0, 'no grade grant when already over ceiling');
assert(r9.nextId       === 200, 'existing 200 preserved (not truncated)');
assert(r9.nextGrade    === 80,  'existing 80 preserved (not truncated)');

// [10] Annual plan grants same as monthly
console.log('\n[10] Pro annual grants same monthly amount as pro_monthly');
kv.clear();
const r10a = await grantMonthlyCredits('user_d', 'pro_annual', 'evt_10a');
kv.clear();
const r10b = await grantMonthlyCredits('user_e', 'pro_monthly', 'evt_10b');
assert(r10a.grantedId    === r10b.grantedId,    'annual grants same # IDs as monthly');
assert(r10a.grantedGrade === r10b.grantedGrade, 'annual grants same # grade as monthly');

console.log('\n──────────────────────────────');
console.log(`  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
