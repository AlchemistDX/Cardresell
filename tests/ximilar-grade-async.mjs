// Ximilar card grading uses the documented async job API (sync endpoint retired).
import { readFileSync } from 'node:fs';
import { gradeAsync, parseGradeResponse, XIMILAR_ASYNC_SUBMIT_URL } from '../api/_ximilar_grade.js';
import { observeProviderAttempt } from '../api/_providerUsage.js';
let pass = 0, fail = 0;
const check = (n, ok) => { ok ? pass++ : (fail++, console.log('  FAIL', n)); };
const record = { _status: { code: 200 }, grades: { corners: 8, edges: 8, surface: 6, centering: 9, final: 7.5, condition: 'Near Mint' },
  corners: [{ name: 'UPPER_LEFT', grade: 8.5 }], edges: [{ name: 'UPPER', grade: 7.5 }],
  card: [{ surface: { grade: 6 }, centering: { 'left/right': '46/54', 'top/bottom': '54/46', pixels: [1, 2, 3, 4], offsets: [0.1] } }] };
function sim(script) {
  const calls = []; let clock = 0;
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.Authorization });
    const step = script(calls.length, url, init);
    if (step.throw) throw Object.assign(new Error('x'), { name: step.throw });
    if (step.stall) return { status: 200, ok: true, json: () => new Promise((_, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('a'), { name: 'AbortError' })))) };
    return { status: step.status ?? 200, ok: (step.status ?? 200) < 400, json: async () => step.body };
  };
  return { calls, opts: { fetch, now: () => clock, sleep: async ms => { clock += ms; }, budgetMs: 55000 }, tick: ms => { clock += ms; } };
}
const imgs = ['RlJPTlQ=', 'QkFDSw=='];
async function observedGrade(s) {
  const log = console.log, observations = [];
  console.log = line => { if (line.startsWith('PROVIDER_USAGE ')) observations.push(JSON.parse(line.slice(15))); };
  try {
    const result = await observeProviderAttempt({ provider: 'ximilar', operation: 'card_grade', mode: 'deep_grade', inputImages: 2 },
      observe => gradeAsync(imgs, 'tok', observe, s.opts));
    check('exactly one usage record per job', observations.length === 1);
    return { result, usage: observations[0] };
  } finally { console.log = log; }
}

// 1. happy path: CREATED -> PROCESSING -> DONE
{ const s = sim(n => n === 1 ? { body: { id: 'job-0001-abcd', status: 'CREATED' } }
    : n === 2 ? { body: { id: 'job-0001-abcd', status: 'PROCESSING' } }
    : { body: { id: 'job-0001-abcd', status: 'DONE', response: { records: [record] } } });
  const seen = []; const r = await gradeAsync(imgs, 'tok', o => seen.push(o), s.opts);
  check('success parsed', r.ok && r.grades.final === 7.5 && r.cv.centering.leftRight === '46/54' && r.grades.surface === 6);
  check('one submit to async URL', s.calls.filter(c => c.method === 'POST').length === 1 && s.calls[0].url === XIMILAR_ASYNC_SUBMIT_URL);
  check('submit body is documented contract', s.calls[0].body.type === 'card-grader' && s.calls[0].body.endpoint === 'grade'
    && s.calls[0].body.records.length === 2 && s.calls[0].body.records[0]._base64 === imgs[0] && s.calls[0].body.records[1].Side === 'Back');
  check('polls GET job url', s.calls.slice(1).every(c => c.method === 'GET' && c.url === XIMILAR_ASYNC_SUBMIT_URL + 'job-0001-abcd'));
  check('token auth header', s.calls.every(c => c.auth === 'Token tok'));
  check('submit status kept separate from polls', seen.filter(o => o.status !== undefined).length === 1 && seen[0].status === 200);
  check('observed completed job and two polls', seen.at(-1).jobStatus === 'DONE' && seen.at(-2).polls === 2 && seen.at(-2).pollStatus === 200);
  check('raw keeps records for holder detection', Array.isArray(r.raw.records));
}
// 2. never resubmits; times out within budget
{ const s = sim(n => n === 1 ? { body: { id: 'job-slow-0001', status: 'CREATED' } } : { body: { id: 'job-slow-0001', status: 'PROCESSING' } });
  const { result: r, usage } = await observedGrade(s);
  check('slow job -> job_timeout', !r.ok && r.reason === 'job_timeout' && r.jobId === 'job-slow-0001');
  check('slow job never resubmitted', s.calls.filter(c => c.method === 'POST').length === 1);
  check('bounded polls', r.polls > 3 && r.polls < 40);
  check('timeout keeps last known job state and actual poll count', usage.reason === 'job_timeout' && usage.job_status === 'PROCESSING'
    && usage.poll_count === r.polls && usage.poll_http_status === 200);
}
// 3. submit failures
{ const s = sim(() => ({ status: 401, body: { status: { code: 401 } } }));
  const r = await gradeAsync(imgs, 'tok', () => {}, s.opts);
  check('401 -> http_401, no poll', r.reason === 'http_401' && s.calls.length === 1);
  check('no raw provider payload in failure', !('error' in r) && !('raw' in r)); }
{ const s = sim(() => ({ throw: 'AbortError' }));
  const r = await gradeAsync(imgs, 'tok', () => {}, s.opts);
  check('ambiguous submit not retried', r.reason === 'submit_timeout_ambiguous' && s.calls.length === 1); }
{ const s = sim(() => ({ body: { status: 'CREATED' } }));
  check('missing job id malformed', (await gradeAsync(imgs, 'tok', () => {}, s.opts)).reason === 'submit_malformed'); }
{ const s = sim(() => ({ body: { id: '../../evil', status: 'CREATED' } }));
  check('unsafe job id rejected', (await gradeAsync(imgs, 'tok', () => {}, s.opts)).reason === 'submit_malformed'); }
// 4. job failure status, poll auth loss, transient poll errors
{ const s = sim(n => n === 1 ? { status: 201, body: { id: 'job-fail-0001', status: 'CREATED' } } : { body: { id: 'job-fail-0001', status: 'ERROR' } });
  const { result: r, usage } = await observedGrade(s);
  check('ERROR status -> job_failed', r.reason === 'job_failed' && r.jobStatus === 'ERROR');
  check('accepted submit is not a completed job', usage.http_status === 201 && usage.poll_http_status === 200
    && usage.job_status === 'ERROR' && usage.poll_count === 1 && usage.outcome === 'failure' && usage.reason === 'job_failed');
  check('failed job billing is still unknown', usage.billed_units === null && usage.cost_usd === null);
  check('failed job never resubmitted', s.calls.filter(c => c.method === 'POST').length === 1); }
{ const s = sim(n => n === 1 ? { status: 201, body: { id: 'job-auth-0001', status: 'CREATED' } } : { status: 403, body: {} });
  const { result: r, usage } = await observedGrade(s);
  check('poll 403 stops', r.reason === 'poll_http_403');
  check('poll auth failure retained separately', usage.http_status === 201 && usage.poll_http_status === 403
    && usage.poll_count === 1 && usage.job_status === 'CREATED' && usage.reason === 'http'); }
{ const s = sim(n => n === 1 ? { body: { id: 'job-flaky-001', status: 'CREATED' } } : n < 4 ? { status: 502, body: null }
    : { body: { id: 'job-flaky-001', status: 'DONE', response: { records: [record] } } });
  const { result: r, usage } = await observedGrade(s);
  check('transient poll 502 recovers', r.ok && s.calls.filter(c => c.method === 'POST').length === 1);
  check('recovered job counts failed polls too', usage.poll_count === 3 && usage.poll_http_status === 200 && usage.job_status === 'DONE'); }
for (const status of ['PRIVATE user@example.test', { private: 'PRIVATE user@example.test' }, null]) {
  const s = sim(n => n === 1 ? { body: { id: 'job-private-01', status: 'CREATED' } } : { body: { status } });
  const { result: r, usage } = await observedGrade(s);
  check('unrecognized job status remains a failure', r.reason === 'job_failed' && usage.job_status === 'UNKNOWN');
  check('diagnostics contain no raw payload or identity', !/PRIVATE|user@|job-private|RlJPTlQ/.test(JSON.stringify(usage)));
}
{ const s = sim(n => n === 1 ? { body: { id: 'job-network-01', status: 'CREATED' } } : { throw: 'TypeError' });
  const { result: r, usage } = await observedGrade(s);
  check('failed network polls counted without inventing HTTP status', r.reason === 'job_timeout' && usage.poll_http_status === null
    && usage.poll_count === r.polls && usage.poll_count > 0 && usage.job_status === 'CREATED'); }
// 5. stalled body is bounded by the request timeout (real timers, tiny budget)
{ const s = sim(() => ({ stall: true }));
  const t0 = Date.now(); const r = await gradeAsync(imgs, 'tok', () => {}, { fetch: s.opts.fetch, budgetMs: 300 });
  check('stalled submit body aborted inside budget', r.reason === 'submit_timeout_ambiguous' && Date.now() - t0 < 2000); }
// 6. parsing edge cases
check('no card detected', parseGradeResponse({ records: [{ _status: { code: 400 } }] }).reason === 'no_card_detected');
check('empty grades', parseGradeResponse({ records: [{ _status: { code: 200 }, grades: {} }] }).reason === 'empty_grades');
check('missing response', parseGradeResponse(undefined).reason === 'no_card_detected');
for (const invalid of ['', ' ', true, false, 'garbage', 0, -2, 11]) {
  check('invalid provider grade refused: '+String(invalid), parseGradeResponse({records:[{grades:{final:invalid}}]}).reason === 'empty_grades');
}
check('valid numeric string accepted', parseGradeResponse({records:[{grades:{final:'9.5'}}]}).grades.final === 9.5);
// 7. retired endpoint gone from runtime code
const src = readFileSync(new URL('../api/_ximilar_grade.js', import.meta.url), 'utf8');
check('retired sync URL not called', !/fetch\([^)]*card-grader\/v2/.test(src) && !src.includes("= 'https://api.ximilar.com/card-grader/v2/grade'"));
console.log(`ximilar-grade-async: ${pass} passed, ${fail} failed -- SUITE COMPLETE, exit=${fail ? 1 : 0}`);
process.exit(fail ? 1 : 0);
