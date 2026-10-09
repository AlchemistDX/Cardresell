import { verifyTokenFlexible } from './_verifyToken.js';

// Private saved AI reports. This is separate from certified grades, public
// shares and the manual submission log. Reports are immutable; repeat saves
// with the same id are idempotent. No membership/credit debit occurs here.
export const GRADE_HISTORY_LIMIT = 500;
const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SAVE = `
if redis.call('EXISTS', KEYS[3]) == 1 then return -2 end
if redis.call('HEXISTS', KEYS[1], ARGV[1]) == 1 then return 0 end
if redis.call('HLEN', KEYS[1]) >= tonumber(ARGV[4]) then return -1 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('HSET', KEYS[2], ARGV[1], ARGV[3])
return 1`;
const REMOVE = `
redis.call('HDEL', KEYS[1], ARGV[1])
redis.call('HDEL', KEYS[2], ARGV[1])
redis.call('SET', KEYS[3], '1', 'EX', 7776000)
return 1`;
const FIELDS = ['card_name','set_name','card_number','card_type','psa_estimate','grade_label',
  'centering','centering_lr','centering_tb','corners','corners_desc','edges','edges_desc',
  'surface','surface_desc','eye_appeal','grade_notes','limiting_factor','grading_standard',
  'deepGrade','cv_downgraded','creditsUsed','credits_refunded','photoCount','analysis_id',
  'confidence','eye_appeal_notes','centering_back','centering_ceiling','cv_source','centering_source'];
export function normalizeGradeReport(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid report');
  const grade = Number(data.psa_estimate ?? data.grades?.final);
  if (!Number.isFinite(grade) || grade < 1 || grade > 10) throw new Error('A completed grade is required');
  const report = {};
  for (const key of FIELDS) {
    const value = data[key];
    if (typeof value === 'string') report[key] = value.slice(0, 2000);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) report[key] = value;
  }
  report.psa_estimate = grade;
  if (Array.isArray(data.confidence_drivers)) report.confidence_drivers = data.confidence_drivers.filter(x => typeof x === 'string').slice(0, 10).map(x => x.slice(0, 200));
  if (data.grades && typeof data.grades === 'object') {
    report.grades = {};
    for (const key of ['final','centering','corners','edges','surface']) {
      const n = data.grades[key];
      if (typeof n === 'number' && Number.isFinite(n)) report.grades[key] = n;
    }
  }
  return report;
}
async function productionKv(...command) {
  const url = process.env.KV_REST_API_URL, token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('Storage unavailable');
  const response = await fetch(url, { method: 'POST', headers: {
    Authorization: `Bearer ${token}`, 'Content-Type': 'application/json'
  }, body: JSON.stringify(command) });
  if (!response.ok) throw new Error('Storage unavailable');
  const result = await response.json();
  if (result.error) throw new Error('Storage unavailable');
  return result.result;
}
export function createGradeHistoryHandler({ verify = verifyTokenFlexible, kv = productionKv } = {}) {
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    if (!['GET','POST','DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });
    let uid;
    try {
      const token = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '');
      if (!token) throw new Error('Missing token');
      uid = (await verify(token)).uid;
      if (!uid || String(uid).startsWith('ktest-')) throw new Error('Invalid account');
    } catch { return res.status(401).json({ error: 'Sign in to save and view your grades.' }); }
    const prefix = `ai_grades:{${encodeURIComponent(uid)}}`;
    const reports = prefix + ':reports', summaries = prefix + ':summaries';
    const id = String(req.query?.id || req.body?.id || '');
    if ((req.method !== 'GET' || id) && !ID.test(id)) return res.status(400).json({ error: 'Invalid report id' });
    try {
      if (req.method === 'GET' && id) {
        const raw = await kv('HGET', reports, id);
        if (!raw) return res.status(404).json({ error: 'Saved grade not found' });
        return res.status(200).json({ report: JSON.parse(raw) });
      }
      if (req.method === 'GET') {
        const rows = await kv('HVALS', summaries);
        return res.status(200).json({ reports: (rows || []).map(x => JSON.parse(x)).sort((a,b) => b.savedAt - a.savedAt), limit: GRADE_HISTORY_LIMIT });
      }
      if (req.method === 'DELETE') {
        await kv('EVAL', REMOVE, 3, reports, summaries, prefix + ':deleted:' + id, id);
        return res.status(200).json({ deleted: true });
      }
      let data;
      try {
        if (Buffer.byteLength(JSON.stringify(req.body || {})) > 32768) throw new Error('Report too large');
        data = normalizeGradeReport(req.body?.data);
      } catch (e) { return res.status(400).json({ error: e.message }); }
      const summary = { id, card: String(data.card_name || 'Unidentified card').slice(0, 200),
        set: String(data.set_name || '').slice(0, 200), number: String(data.card_number || '').slice(0, 50),
        grade: data.psa_estimate, mode: data.cv_downgraded === true ? 'Deep request · Quick fallback' : data.deepGrade === true ? 'Deep' : 'Quick', savedAt: Date.now() };
      const result = await kv('EVAL', SAVE, 3, reports, summaries, prefix + ':deleted:' + id,
        id, JSON.stringify({ ...summary, data }), JSON.stringify(summary), GRADE_HISTORY_LIMIT);
      if (result === -1) return res.status(409).json({ error: `Your history has ${GRADE_HISTORY_LIMIT} saved grades. Download and delete an older report to make room.` });
      if (result === -2) return res.status(409).json({ error: 'This report was deleted. It has not been saved again.' });
      return res.status(200).json({ saved: true, id, replayed: result === 0 });
    } catch { return res.status(503).json({ error: 'Grade history is unavailable. Please retry; your current result is still on screen.' }); }
  };
}
export default createGradeHistoryHandler();
