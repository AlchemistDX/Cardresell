// One authorized setup, two provider-scoped processes. A mode-0600 FIFO carries
// the signing secret in kernel memory, not a regular file, argv or log.
// This creates a DISABLED endpoint only; no purchase activation or DB mutation.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [role, pipe, cataloguePath] = process.argv.slice(2);
const insist = (ok, code) => { if (!ok) throw Error(code); };
const hash = x => createHash('sha256').update(x).digest('hex');
const project = 'prj_NJbWQ7VxpYIjzpCDj7X7vtmEdLbU';
const team = 'team_6s4mtmL1E2PlqUbMADRWtGNs';
try {
  const st = lstatSync(pipe);
  insist(st.isFIFO() && (st.mode & 0o777) === 0o600 && st.uid === process.getuid(), 'private_pipe_required');
  if (role === 'stripe') {
    const c = JSON.parse(readFileSync(cataloguePath, 'utf8'));
    const request = (path, body, operation) => {
      const args = ['--silent', '--show-error', '--max-time', '25', '--cacert',
        '/etc/ssl/certs/ca-certificates.crt', '-H', 'Stripe-Version: 2026-08-26.dahlia'];
      if (body) args.push('-X', 'POST', '-H', 'Idempotency-Key: cr-live-v2-' + hash(operation),
        '--data-binary', '@-');
      args.push('https://api.stripe.com/v1/' + path);
      const r = JSON.parse(execFileSync('curl', args, { encoding: 'utf8',
        input: body ? new URLSearchParams(body).toString() : undefined, stdio: ['pipe', 'pipe', 'pipe'] }));
      insist(!r.error, 'stripe_request_failed');
      return r;
    };
    insist(request('account').id === c.accountId, 'account_mismatch');
    const hooks = request('webhook_endpoints?limit=100');
    const url = c.returnOrigin + '/api/membership-webhook';
    insist(hooks.has_more === false && !hooks.data.some(h => h.url === url), 'existing_endpoint_requires_reconciliation');
    const body = { url, api_version: '2026-08-26.dahlia',
      description: 'CardResell launch-v2 membership fulfillment' };
    c.events.forEach((e, i) => { body[`enabled_events[${i}]`] = e; });
    const hook = request('webhook_endpoints', body, 'webhook-production-v1');
    insist(hook.livemode === true && /^whsec_[A-Za-z0-9]+$/.test(hook.secret), 'webhook_unconfirmed');
    const disabled = request('webhook_endpoints/' + hook.id, { disabled: 'true' }, 'webhook-await-activation-v1');
    insist(disabled.status === 'disabled', 'webhook_disable_unconfirmed');
    writeFileSync(pipe, hook.secret);
    console.log(JSON.stringify({ webhookId: hook.id, url, status: disabled.status,
      apiVersion: hook.api_version, events: hook.enabled_events, secretTransferred: true, activated: false }));
  } else if (role === 'vercel') {
    const api = (path, method = 'GET', body) => {
      const args = ['api', path + '?teamId=' + team, '--scope', 'willsep200-9430s-projects',
        '--token', process.env.VERCEL_TOKEN, '--method', method, '--raw'];
      if (body) args.push('--input', '-');
      return JSON.parse(execFileSync('vercel', args, { encoding: 'utf8',
        input: body ? JSON.stringify(body) : undefined, stdio: ['pipe', 'pipe', 'pipe'] }));
    };
    const key = 'MEMBERSHIP_STRIPE_LIVE_WEBHOOK_SECRET';
    const envs = api(`/v9/projects/${project}/env`).envs;
    insist(!envs.some(e => e.key === key), 'existing_secret_requires_reconciliation');
    const value = readFileSync(pipe, 'utf8');
    insist(/^whsec_[A-Za-z0-9]+$/.test(value), 'invalid_secret_transport');
    const result = api(`/v10/projects/${project}/env`, 'POST', { key, value, type: 'sensitive', target: ['production'] });
    insist(!result.error, 'vercel_write_unconfirmed');
    const rows = api(`/v9/projects/${project}/env`).envs.filter(e => e.key === key);
    insist(rows.length === 1 && rows[0].type === 'sensitive'
      && rows[0].target.length === 1 && rows[0].target[0] === 'production' && !rows[0].gitBranch, 'scope_unconfirmed');
    console.log(JSON.stringify({ key, type: 'sensitive', target: ['production'], verified: true, secretExposed: false }));
  } else insist(false, 'invalid_role');
} catch (e) {
  console.error(/^[a-z_]+$/.test(e?.message || '') ? e.message : 'operation_unconfirmed_reconcile_before_retry');
  process.exitCode = 1;
}
