// tests/ebay-credential-check.mjs
//
// Output handling for tools/verify-ebay-credential.mjs, against mocked
// responses. No network. No real credentials.
//
// The point of this suite is narrower than "does the checker work": it is
// whether the SUPPLIED CREDENTIALS and the RETURNED ACCESS TOKEN can reach
// the output on ANY path, including the error paths. "It reports eBay's own
// error description" is an assumption until that description is shown not to
// echo the client identifier back.
//
//   NODE_PATH=/home/user/node_modules node tests/ebay-credential-check.mjs

import { checkCredential, redact, TOKEN_URL } from '../tools/verify-ebay-credential.mjs';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
};

// Distinctive fakes so a leak is unmistakable in any output.
const APP  = 'FakeAppI-dcardres-PRD-0000000ab-0000aaaa';
const CERT = 'PRD-0000000abcde-0000-0000-0000-aaaabbbb';
const BASIC = Buffer.from(`${APP}:${CERT}`).toString('base64');
const TOKEN = 'v^1.1#i^1#f^0#FAKEACCESSTOKENVALUE0000000000000000000000';

const SECRETS = [APP, CERT, BASIC, TOKEN];

/** Every line the checker would print, on both streams. */
const allLines = (res) => [...res.out, ...res.err];

function assertNoSecrets(label, res) {
  const blob = allLines(res).join('\n');
  for (const s of SECRETS) {
    check(`${label}: does not leak ${s.slice(0, 8)}…`, !blob.includes(s),
      'secret appeared in output');
  }
}

const mockFetch = (impl) => async (...args) => impl(...args);
const jsonRes = (status, body) => ({
  status,
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

console.log('\n— redact() —');
check('removes a supplied value', redact(`saw ${APP} here`, [APP]) === 'saw [redacted] here');
check('removes every occurrence', redact(`${CERT} ${CERT}`, [CERT]) === '[redacted] [redacted]');
check('removes the basic header value', redact(`Basic ${BASIC}`, [BASIC]) === 'Basic [redacted]');
check('catches an eBay-shaped token not in the secret list', !redact(`tok ${TOKEN}`, []).includes('FAKEACCESS'));
check('catches a JWT shape', redact(`a.${'x'.repeat(45)}.${'y'.repeat(25)}.${'z'.repeat(25)} b`, []).includes('[redacted-token]'));
check('ignores a too-short secret', redact('abc def', ['abc']) === 'abc def');
check('leaves clean text alone', redact('HTTP 200 token_type Application', SECRETS) === 'HTTP 200 token_type Application');

console.log('\n— success —');
{
  const res = await checkCredential({
    appId: APP, certId: CERT,
    fetchImpl: mockFetch(async () => jsonRes(200, {
      access_token: TOKEN, token_type: 'Application', expires_in: 7200,
      scope: 'https://api.ebay.com/oauth/api_scope',
    })),
    now: () => new Date('2026-09-10T22:45:00Z'),
  });
  check('status is pass', res.status === 'pass');
  check('ok is true', res.ok === true);
  check('reports expires_in', res.out.some((l) => l.includes('7200')));
  check('reports token_type', res.out.some((l) => l.includes('Application')));
  check('reports the endpoint', res.out.some((l) => l.includes(TOKEN_URL)));
  check('states what it does not establish', res.out.some((l) => l.includes('does NOT establish')));
  check('nothing on the error stream', res.err.length === 0);
  assertNoSecrets('success', res);
}

console.log('\n— rejection (invalid_client) —');
{
  const res = await checkCredential({
    appId: APP, certId: CERT,
    fetchImpl: mockFetch(async () => jsonRes(401, {
      error: 'invalid_client',
      error_description: 'client authentication failed',
    })),
  });
  check('status is fail', res.status === 'fail');
  check('surfaces the error code', res.err.some((l) => l.includes('invalid_client')));
  check('surfaces the description', res.err.some((l) => l.includes('client authentication failed')));
  check('reports the http status', res.err.some((l) => l.includes('401')));
  check('nothing on the success stream', res.out.length === 0);
  assertNoSecrets('rejection', res);
}

console.log('\n— rejection whose description echoes the credential —');
{
  // This is the case the "eBay's error is non-secret" assumption missed.
  const res = await checkCredential({
    appId: APP, certId: CERT,
    fetchImpl: mockFetch(async () => jsonRes(401, {
      error: 'invalid_client',
      error_description: `client_id ${APP} not recognised; secret ${CERT} rejected`,
    })),
  });
  check('status is fail', res.status === 'fail');
  check('still surfaces the error code', res.err.some((l) => l.includes('invalid_client')));
  check('description is redacted, not dropped', res.err.some((l) => l.includes('[redacted]')));
  assertNoSecrets('echoing rejection', res);
}

console.log('\n— malformed response —');
{
  const res = await checkCredential({
    appId: APP, certId: CERT,
    fetchImpl: mockFetch(async () => jsonRes(200, `<html>gateway error ${TOKEN}</html>`)),
  });
  check('status is fail', res.status === 'fail');
  check('says the body was not JSON', res.err.some((l) => l.includes('not JSON')));
  check('does not print the body', !allLines(res).join('\n').includes('gateway error'));
  assertNoSecrets('malformed', res);
}

console.log('\n— 200 with no access_token —');
{
  const res = await checkCredential({
    appId: APP, certId: CERT,
    fetchImpl: mockFetch(async () => jsonRes(200, { token_type: 'Application' })),
  });
  check('treated as failure, not pass', res.status === 'fail' && res.ok === false);
  assertNoSecrets('tokenless 200', res);
}

console.log('\n— network failure —');
{
  const res = await checkCredential({
    appId: APP, certId: CERT,
    fetchImpl: mockFetch(async () => { throw new Error('getaddrinfo ENOTFOUND api.ebay.com'); }),
  });
  check('status is incomplete, not fail', res.status === 'incomplete');
  check('ok is false', res.ok === false);
  check('says it is neither a pass nor a failed credential',
    res.err.some((l) => l.includes('not a pass either')));
  assertNoSecrets('network failure', res);
}

console.log('\n— network failure whose message carries the header —');
{
  const res = await checkCredential({
    appId: APP, certId: CERT,
    fetchImpl: mockFetch(async () => { throw new Error(`request failed: Basic ${BASIC}`); }),
  });
  check('status is incomplete', res.status === 'incomplete');
  assertNoSecrets('leaky exception', res);
}

console.log(`\nebay-credential-check: ${pass} passed, ${fail} failed`);
console.log(`suite completed: true; exiting ${fail === 0 ? 0 : 1}`);
process.exit(fail === 0 ? 0 : 1);
